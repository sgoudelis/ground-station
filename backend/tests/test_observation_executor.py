# Copyright (c) 2026 Efstratios Goudelis

import importlib
import json
import sys
import types
from datetime import datetime
from unittest.mock import AsyncMock

import pytest

from observations import events as observation_events
from observations import helpers as observation_helpers
from observations.bundle import create_observation_bundle
from observations.constants import STATUS_FAILED


class _DummyAsyncSessionContext:
    async def __aenter__(self):
        return object()

    async def __aexit__(self, exc_type, exc, tb):
        return False


def _build_observation(rotator=None):
    return {
        "id": "obs-1",
        "name": "Test observation",
        "enabled": True,
        "status": "scheduled",
        "satellite": {"name": "ISS", "norad_id": 25544, "group_id": "grp-1"},
        "pass": {
            "event_start": "2026-08-16T12:13:00+00:00",
            "event_end": "2026-08-16T12:19:00+00:00",
            "peak_altitude": 47.25,
        },
        "task_start": "2026-08-16T12:12:45+00:00",
        "task_end": "2026-08-16T12:19:15+00:00",
        "task_start_elevation": 10,
        "rotator": rotator or {},
        "sessions": [
            {
                "sdr": {"id": "sdr-1"},
                "tasks": [{"type": "decoder", "config": {"transmitter_id": "tx-1"}}],
            }
        ],
    }


def _patch_common_start_dependencies(monkeypatch, executor_module, observation, tmp_path):
    async def _fetch_observation(_session, _observation_id):
        return {"success": True, "data": observation}

    async def _noop(*_args, **_kwargs):
        return None

    monkeypatch.setattr(executor_module, "AsyncSessionLocal", lambda: _DummyAsyncSessionContext())
    monkeypatch.setattr(executor_module, "fetch_scheduled_observations", _fetch_observation)
    monkeypatch.setattr(executor_module, "log_execution_event", _noop)
    monkeypatch.setattr(executor_module, "update_observation_status", _noop)
    monkeypatch.setattr(executor_module, "remove_scheduled_stop_job", _noop)
    monkeypatch.setattr(
        executor_module.session_tracker,
        "get_sessions_for_sdr",
        lambda _sdr_id: [],
    )
    monkeypatch.setattr(
        executor_module,
        "create_observation_bundle",
        lambda observation_id, satellite, _backend_dir: create_observation_bundle(
            observation_id, satellite, tmp_path
        ),
    )


def _new_executor(executor_module):
    dummy_process_manager = types.SimpleNamespace()
    return executor_module.ObservationExecutor(process_manager=dummy_process_manager, sio=None)


def _load_executor_module(monkeypatch):
    tasks_pkg = types.ModuleType("tasks")
    tasks_pkg.__path__ = []  # Make it behave like a package for "tasks.registry" resolution.
    registry_mod = types.ModuleType("tasks.registry")
    registry_mod.get_task = lambda _task_name: None

    monkeypatch.setitem(sys.modules, "tasks", tasks_pkg)
    monkeypatch.setitem(sys.modules, "tasks.registry", registry_mod)

    module = importlib.import_module("observations.executor")
    return importlib.reload(module)


@pytest.mark.unit
@pytest.mark.asyncio
@pytest.mark.parametrize(
    "settings",
    [
        None,
        {
            "gains": {"RFGR": 4, "IFGR": 35},
            "bandwidth": 1536000,
            "clockSource": "external",
            "timeSource": "internal",
            "bitpack": True,
        },
    ],
)
async def test_scheduled_session_forwards_device_settings_and_agc(monkeypatch, settings):
    executor_module = _load_executor_module(monkeypatch)
    monkeypatch.setattr(executor_module, "AsyncSessionLocal", lambda: _DummyAsyncSessionContext())
    monkeypatch.setattr(
        executor_module,
        "fetch_sdr",
        AsyncMock(
            return_value={"success": True, "data": {"id": "sdr-1", "type": "soapysdrremote"}}
        ),
    )
    register = AsyncMock(return_value="internal:obs-1:radio")
    monkeypatch.setattr(executor_module.session_service, "register_internal_observation", register)
    observation = _build_observation()
    session = {
        "sdr": {
            "id": "sdr-1",
            "sample_rate": 2048000,
            "gain": 0,
            "tuner_agc": True,
            "soapy_agc": True,
            "rtl_agc": True,
            **({"sdr_settings": settings} if settings is not None else {}),
        },
        "tasks": [],
    }

    await _new_executor(executor_module)._execute_observation_session(
        "obs-1", "radio", observation, session
    )

    config = register.await_args.kwargs["sdr_config"]
    assert config["sdr_settings"] == (settings or {})
    assert config["sample_rate"] == 2048000
    assert config["gain"] == 0
    assert config["tuner_agc"] is True
    assert config["soapy_agc"] is True
    assert config["rtl_agc"] is True


@pytest.mark.unit
@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["failure", "exception", "success"])
@pytest.mark.parametrize(
    ("task_type", "handler_name", "method_name"),
    [
        ("decoder", "decoder_handler", "start_decoder_task"),
        ("iq_recording", "recorder_handler", "start_iq_recording_task"),
        ("audio_recording", "recorder_handler", "start_audio_recording_task"),
        ("transcription", "transcription_handler", "start_transcription_task"),
    ],
)
async def test_task_failures_only_log_events_and_allow_remaining_tasks(
    monkeypatch, task_type, handler_name, method_name, outcome
):
    executor_module = _load_executor_module(monkeypatch)
    monkeypatch.setattr(executor_module, "AsyncSessionLocal", lambda: _DummyAsyncSessionContext())
    monkeypatch.setattr(
        executor_module,
        "fetch_sdr",
        AsyncMock(return_value={"success": True, "data": {"id": "sdr-1"}}),
    )
    monkeypatch.setattr(
        executor_module.session_service,
        "register_internal_observation",
        AsyncMock(return_value="internal:obs-1:radio"),
    )
    log_event = AsyncMock()
    update_status = AsyncMock()
    monkeypatch.setattr(executor_module, "log_execution_event", log_event)
    monkeypatch.setattr(executor_module, "update_observation_status", update_status)
    executor = _new_executor(executor_module)
    next_task = AsyncMock(return_value=True)
    monkeypatch.setattr(executor.decoder_handler, "start_decoder_task", next_task)
    success_result = "/tmp/audit-recording" if task_type == "iq_recording" else True
    result = {
        "failure": None if task_type == "iq_recording" else False,
        "exception": RuntimeError("Task worker unavailable"),
        "success": success_result,
    }[outcome]
    start_task = AsyncMock(side_effect=[result, True] if task_type == "decoder" else [result])
    monkeypatch.setattr(getattr(executor, handler_name), method_name, start_task)
    session = {
        "sdr": {"id": "sdr-1"},
        "tasks": [
            {"type": task_type, "config": {}},
            {"type": "decoder", "config": {"decoder_type": "aprs"}},
        ],
    }

    await executor._execute_observation_session("obs-1", "radio", _build_observation(), session)

    decoder_start = executor.decoder_handler.start_decoder_task
    assert decoder_start.await_count == (2 if task_type == "decoder" else 1)
    assert decoder_start.await_args.args[4]["decoder_type"] == "aprs"
    update_status.assert_not_awaited()
    if outcome == "success":
        log_event.assert_not_awaited()
    else:
        log_event.assert_awaited_once()
        observation_id, message, level = log_event.await_args.args
        assert observation_id == "obs-1"
        assert f"Failed to start {task_type} task 1 in SDR session radio" in message
        assert ("VFO 1" in message) == (task_type != "iq_recording")
        assert level == "error"
        if outcome == "exception":
            assert "Task worker unavailable" in message
    recordings = executor._iq_recording_info.get("obs-1", {}).get("radio", {})
    assert bool(recordings) == (task_type == "iq_recording" and outcome == "success")


@pytest.mark.unit
@pytest.mark.asyncio
async def test_vfo_limit_is_logged_and_does_not_skip_iq_recording(monkeypatch):
    executor_module = _load_executor_module(monkeypatch)
    monkeypatch.setattr(executor_module, "INTERNAL_VFO_NUMBER", 1)
    monkeypatch.setattr(executor_module, "AsyncSessionLocal", lambda: _DummyAsyncSessionContext())
    monkeypatch.setattr(
        executor_module,
        "fetch_sdr",
        AsyncMock(return_value={"success": True, "data": {"id": "sdr-1"}}),
    )
    monkeypatch.setattr(
        executor_module.session_service,
        "register_internal_observation",
        AsyncMock(return_value="internal:obs-1:radio"),
    )
    log_event = AsyncMock()
    monkeypatch.setattr(executor_module, "log_execution_event", log_event)
    executor = _new_executor(executor_module)
    decoder = AsyncMock(return_value=True)
    recorder = AsyncMock(return_value="/tmp/audit-recording")
    monkeypatch.setattr(executor.decoder_handler, "start_decoder_task", decoder)
    monkeypatch.setattr(executor.recorder_handler, "start_iq_recording_task", recorder)
    session = {
        "sdr": {"id": "sdr-1"},
        "tasks": [
            {"type": "decoder", "config": {}},
            {"type": "decoder", "config": {}},
            {"type": "iq_recording", "config": {}},
        ],
    }

    await executor._execute_observation_session("obs-1", "radio", _build_observation(), session)

    decoder.assert_awaited_once()
    recorder.assert_awaited_once()
    log_event.assert_awaited_once_with(
        "obs-1",
        "Skipped decoder task 2 in SDR session radio: maximum of 1 VFOs reached",
        "warning",
    )


@pytest.mark.asyncio
async def test_finalizing_bundle_notifies_library_immediately(monkeypatch, tmp_path):
    executor_module = _load_executor_module(monkeypatch)
    bundle_dir = create_observation_bundle("obs-1", {"name": "ISS"}, tmp_path)
    artifact = bundle_dir / "decoded" / "image.png"
    artifact.write_bytes(b"image")
    notifications = []

    async def _notify(_sio, state, _logger):
        notifications.append(state)

    monkeypatch.setattr(executor_module, "emit_file_browser_state", _notify)
    executor = executor_module.ObservationExecutor(
        process_manager=types.SimpleNamespace(), sio=object()
    )

    retained = await executor._finalize_bundle("obs-1", bundle_dir, "completed")

    assert retained is True
    assert notifications == [
        {
            "action": "observation-bundle-finalized",
            "observation_id": "obs-1",
            "retained": True,
        }
    ]


@pytest.mark.asyncio
async def test_start_observation_starts_tracker_before_session_tasks(monkeypatch, tmp_path):
    executor_module = _load_executor_module(monkeypatch)
    observation = _build_observation()
    _patch_common_start_dependencies(monkeypatch, executor_module, observation, tmp_path)

    executor = _new_executor(executor_module)
    events = []

    async def _mock_update_status(_sio, _observation_id, status, *_args, **_kwargs):
        events.append(status)
        return True

    async def _mock_start_tracker(*_args, **_kwargs):
        assert (
            _kwargs["handoff_deadline"]
            == datetime.fromisoformat(observation["pass"]["event_end"]).timestamp()
        )
        events.append("tracker")
        return {
            "success": True,
            "tracker_id": "target-1",
            "created": True,
            "reused_existing": False,
            "ephemeral": True,
        }

    async def _mock_execute_session(*_args, **_kwargs):
        events.append("session")

    monkeypatch.setattr(executor.tracker_handler, "start_tracker_task", _mock_start_tracker)
    monkeypatch.setattr(executor, "_execute_observation_session", _mock_execute_session)
    monkeypatch.setattr(executor_module, "update_observation_status", _mock_update_status)

    result = await executor.start_observation("obs-1")

    assert result["success"] is True
    assert events == ["running", "tracker", "session"]
    assert executor._tracker_context_by_observation["obs-1"]["tracker_id"] == "target-1"
    bundle = next((tmp_path / "data" / "observations").glob("*.gsobs"))
    manifest = json.loads((bundle / "manifest.json").read_text())
    assert manifest["scheduled_observation"]["status"] == "running"
    assert manifest["scheduled_observation"]["pass"]["peak_altitude"] == 47.25
    assert manifest["scheduled_observation"]["task_start_elevation"] == 10


@pytest.mark.asyncio
async def test_start_observation_skips_bundle_for_disposable_satdump_iq_only(monkeypatch, tmp_path):
    executor_module = _load_executor_module(monkeypatch)
    observation = _build_observation()
    observation["sessions"][0]["tasks"] = [
        {
            "type": "iq_recording",
            "config": {
                "enable_post_processing": True,
                "post_process_pipeline": "meteor_m2-x_lrpt",
                "delete_after_post_processing": True,
            },
        }
    ]
    _patch_common_start_dependencies(monkeypatch, executor_module, observation, tmp_path)

    executor = _new_executor(executor_module)

    async def _mock_start_tracker(*_args, **_kwargs):
        return {"success": True, "tracker_id": "target-1"}

    async def _mock_execute_session(*_args, **_kwargs):
        return None

    def _unexpected_bundle(*_args, **_kwargs):
        raise AssertionError("disposable SatDump-only observation must not create a bundle")

    monkeypatch.setattr(executor.tracker_handler, "start_tracker_task", _mock_start_tracker)
    monkeypatch.setattr(executor, "_execute_observation_session", _mock_execute_session)
    monkeypatch.setattr(executor_module, "create_observation_bundle", _unexpected_bundle)

    result = await executor.start_observation("obs-1")

    assert result["success"] is True
    assert "obs-1" not in executor._bundle_dirs


def test_requires_observation_bundle_for_retained_or_mixed_artifacts(monkeypatch):
    executor_module = _load_executor_module(monkeypatch)

    disposable_iq = {
        "type": "iq_recording",
        "config": {
            "enable_post_processing": True,
            "post_process_pipeline": "meteor_m2-x_lrpt",
            "delete_after_post_processing": True,
        },
    }

    assert (
        executor_module.ObservationExecutor._requires_observation_bundle(
            [{"tasks": [disposable_iq]}]
        )
        is False
    )
    assert (
        executor_module.ObservationExecutor._requires_observation_bundle(
            [
                {
                    "tasks": [
                        {
                            **disposable_iq,
                            "config": {
                                **disposable_iq["config"],
                                "delete_after_post_processing": False,
                            },
                        }
                    ]
                }
            ]
        )
        is True
    )
    assert (
        executor_module.ObservationExecutor._requires_observation_bundle(
            [{"tasks": [disposable_iq, {"type": "decoder", "config": {}}]}]
        )
        is True
    )


@pytest.mark.parametrize("retain_setting", [None, False, True])
@pytest.mark.asyncio
async def test_satdump_receives_failure_retention_setting(monkeypatch, tmp_path, retain_setting):
    executor_module = _load_executor_module(monkeypatch)
    executor = _new_executor(executor_module)
    recording_base = tmp_path / "capture"
    executor._iq_recording_info = {
        "obs-1": {"session-1": {1: {"recording_path": str(recording_base)}}}
    }
    task_config = {
        "enable_post_processing": True,
        "post_process_pipeline": "meteor_m2-x_lrpt",
        "delete_after_post_processing": True,
    }
    if retain_setting is not None:
        task_config["retain_iq_on_satdump_failure"] = retain_setting
    calls = []

    class FakeBackgroundManager:
        async def start_task(self, **kwargs):
            calls.append(kwargs)
            return "satdump-task"

    monkeypatch.setattr(
        executor_module.runtimestate, "background_task_manager", FakeBackgroundManager()
    )
    await executor._start_satdump_postprocessing(
        "obs-1",
        "session-1",
        [{"type": "iq_recording", "config": task_config}],
        {"sample_rate": 1_000_000},
    )

    assert len(calls) == 1
    assert calls[0]["kwargs"]["retain_input_on_failure"] is (retain_setting is not False)
    assert calls[0]["kwargs"]["delete_input_after"] is True


@pytest.mark.unit
@pytest.mark.asyncio
@pytest.mark.parametrize("pipeline", ["../../../../escape", "unknown_pipeline", None, [], {}])
async def test_saved_unsafe_satdump_pipeline_never_starts_worker(monkeypatch, tmp_path, pipeline):
    executor_module = _load_executor_module(monkeypatch)
    executor = _new_executor(executor_module)
    executor._iq_recording_info = {
        "obs-1": {"session-1": {1: {"recording_path": str(tmp_path / "capture")}}}
    }
    start_task = AsyncMock()
    monkeypatch.setattr(
        executor_module.runtimestate,
        "background_task_manager",
        types.SimpleNamespace(start_task=start_task),
    )

    await executor._start_satdump_postprocessing(
        "obs-1",
        "session-1",
        [
            {
                "type": "iq_recording",
                "config": {"enable_post_processing": True, "post_process_pipeline": pipeline},
            }
        ],
        {},
    )

    start_task.assert_not_awaited()
    assert "obs-1" not in executor._iq_recording_info


@pytest.mark.unit
def test_satdump_output_builder_rejects_symlink_escape(monkeypatch, tmp_path):
    executor_module = _load_executor_module(monkeypatch)
    monkeypatch.setattr(executor_module, "__file__", str(tmp_path / "observations" / "executor.py"))
    executor = _new_executor(executor_module)
    decoded_root = tmp_path / "data" / "decoded"
    decoded_root.mkdir(parents=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    output = decoded_root / "capture.satdump_meteor_m2-x_lrpt"
    output.symlink_to(outside, target_is_directory=True)

    with pytest.raises(ValueError, match="SatDump output directory"):
        executor._build_satdump_output_dir("capture", "meteor_m2-x_lrpt")


@pytest.mark.asyncio
async def test_start_observation_fails_fast_when_tracker_start_fails(monkeypatch, tmp_path):
    executor_module = _load_executor_module(monkeypatch)
    observation = _build_observation()
    _patch_common_start_dependencies(monkeypatch, executor_module, observation, tmp_path)

    executor = _new_executor(executor_module)
    session_started = {"value": False}
    status_updates = []

    async def _mock_start_tracker(*_args, **_kwargs):
        return {
            "success": False,
            "error": "missing_target",
            "message": "Tracker target missing",
        }

    async def _mock_execute_session(*_args, **_kwargs):
        session_started["value"] = True

    async def _mock_update_status(_sio, _observation_id, status, *_args, **_kwargs):
        status_updates.append(status)

    monkeypatch.setattr(executor.tracker_handler, "start_tracker_task", _mock_start_tracker)
    monkeypatch.setattr(executor, "_execute_observation_session", _mock_execute_session)
    monkeypatch.setattr(executor_module, "update_observation_status", _mock_update_status)

    result = await executor.start_observation("obs-1")

    assert result["success"] is False
    assert session_started["value"] is False
    assert STATUS_FAILED in status_updates
    assert "obs-1" not in executor._running_observations


@pytest.mark.asyncio
async def test_start_observation_cleans_up_tracker_when_session_start_raises(monkeypatch, tmp_path):
    executor_module = _load_executor_module(monkeypatch)
    observation = _build_observation()
    _patch_common_start_dependencies(monkeypatch, executor_module, observation, tmp_path)

    executor = _new_executor(executor_module)
    stop_calls = []

    async def _mock_start_tracker(*_args, **_kwargs):
        return {
            "success": True,
            "tracker_id": "target-7",
            "created": True,
            "reused_existing": False,
            "ephemeral": True,
        }

    async def _mock_execute_session(*_args, **_kwargs):
        raise RuntimeError("session startup failed")

    async def _mock_stop_tracker(_observation_id, _rotator_config, tracker_context=None):
        stop_calls.append(tracker_context or {})
        return True

    monkeypatch.setattr(executor.tracker_handler, "start_tracker_task", _mock_start_tracker)
    monkeypatch.setattr(executor.tracker_handler, "stop_tracker_task", _mock_stop_tracker)
    monkeypatch.setattr(executor, "_execute_observation_session", _mock_execute_session)

    result = await executor.start_observation("obs-1")

    assert result["success"] is False
    assert len(stop_calls) == 1
    assert stop_calls[0]["tracker_id"] == "target-7"
    assert stop_calls[0]["ephemeral"] is True
    assert "obs-1" not in executor._tracker_context_by_observation


@pytest.mark.asyncio
async def test_sdr_failure_during_start_transitions_from_running_to_failed(monkeypatch, tmp_path):
    executor_module = _load_executor_module(monkeypatch)
    observation = _build_observation()
    _patch_common_start_dependencies(monkeypatch, executor_module, observation, tmp_path)

    executor = _new_executor(executor_module)
    status_updates = []
    stopped_sessions = []

    async def _mock_start_tracker(*_args, **_kwargs):
        return {"success": True, "tracker_id": "target-9", "ephemeral": True}

    async def _mock_execute_session(*_args, **_kwargs):
        await executor.handle_sdr_failure(
            "sdr-1", {"internal:obs-1:sdr-1"}, "device stopped responding"
        )

    async def _mock_stop_session(_observation_id, session_key, *_args, **_kwargs):
        stopped_sessions.append(session_key)

    async def _mock_stop_tracker(*_args, **_kwargs):
        return True

    async def _mock_update_status(_sio, _observation_id, status, *_args, **_kwargs):
        status_updates.append(status)

    monkeypatch.setattr(executor.tracker_handler, "start_tracker_task", _mock_start_tracker)
    monkeypatch.setattr(executor.tracker_handler, "stop_tracker_task", _mock_stop_tracker)
    monkeypatch.setattr(executor, "_execute_observation_session", _mock_execute_session)
    monkeypatch.setattr(executor, "_stop_observation_session", _mock_stop_session)
    monkeypatch.setattr(executor_module, "update_observation_status", _mock_update_status)
    monkeypatch.setattr(
        executor_module.session_tracker,
        "get_session_metadata",
        lambda _session_id: {"observation_id": "obs-1"},
    )

    result = await executor.start_observation("obs-1")

    assert result["success"] is False
    assert status_updates == ["running", STATUS_FAILED]
    assert stopped_sessions == ["sdr-1"]
    assert "obs-1" not in executor._starting_observations


@pytest.mark.asyncio
async def test_stop_observation_task_passes_tracker_context_and_clears_it(monkeypatch):
    executor_module = _load_executor_module(monkeypatch)
    executor = _new_executor(executor_module)
    executor._tracker_context_by_observation["obs-1"] = {
        "tracker_id": "target-5",
        "ephemeral": True,
    }
    captured_context = {}

    async def _mock_stop_tracker(_observation_id, _rotator_config, tracker_context=None):
        captured_context.update(tracker_context or {})
        return True

    async def _mock_stop_session(*_args, **_kwargs):
        return None

    monkeypatch.setattr(executor.tracker_handler, "stop_tracker_task", _mock_stop_tracker)
    monkeypatch.setattr(executor, "_stop_observation_session", _mock_stop_session)

    await executor._stop_observation_task(
        "obs-1",
        {"satellite": {"name": "ISS"}, "sessions": [], "rotator": {}},
    )

    assert captured_context["tracker_id"] == "target-5"
    assert captured_context["ephemeral"] is True
    assert "obs-1" not in executor._tracker_context_by_observation


@pytest.mark.asyncio
async def test_failed_tracker_removal_retains_context_and_reports_cleanup_failure(monkeypatch):
    executor_module = _load_executor_module(monkeypatch)
    executor = _new_executor(executor_module)
    context = {"tracker_id": "obs-one", "ephemeral": True}
    executor._tracker_context_by_observation["one"] = context
    stopped_sessions = []

    async def stop_tracker(*_args, **_kwargs):
        return False

    async def stop_session(_observation_id, session_key, *_args):
        stopped_sessions.append(session_key)

    monkeypatch.setattr(executor.tracker_handler, "stop_tracker_task", stop_tracker)
    monkeypatch.setattr(executor, "_stop_observation_session", stop_session)
    with pytest.raises(RuntimeError, match="OBS tracker cleanup could not be completed"):
        await executor._stop_observation_task("one", _build_observation())
    assert executor._tracker_context_by_observation["one"] == context
    assert stopped_sessions == ["sdr-1"]


@pytest.mark.asyncio
async def test_remove_scheduled_stop_job_uses_initialized_scheduler(monkeypatch):
    removed_jobs = []
    scheduler = types.SimpleNamespace(remove_job=removed_jobs.append)
    monkeypatch.setattr(
        observation_events,
        "observation_sync",
        types.SimpleNamespace(scheduler=scheduler),
    )

    await observation_helpers.remove_scheduled_stop_job("obs-1")

    assert removed_jobs == ["obs_obs-1_stop"]


@pytest.mark.asyncio
async def test_stop_observation_does_not_overwrite_failed_status(monkeypatch):
    executor_module = _load_executor_module(monkeypatch)
    observation = _build_observation()
    observation["status"] = STATUS_FAILED
    status_updates = []

    async def _fetch_observation(_session, _observation_id):
        return {"success": True, "data": observation}

    async def _update_status(_sio, _observation_id, status, *_args, **_kwargs):
        status_updates.append(status)

    async def _unexpected_stop(*_args, **_kwargs):
        raise AssertionError("terminal observation must not be stopped again")

    monkeypatch.setattr(executor_module, "AsyncSessionLocal", lambda: _DummyAsyncSessionContext())
    monkeypatch.setattr(executor_module, "fetch_scheduled_observations", _fetch_observation)
    monkeypatch.setattr(executor_module, "update_observation_status", _update_status)
    executor = _new_executor(executor_module)
    monkeypatch.setattr(executor, "_stop_observation_task", _unexpected_stop)

    result = await executor.stop_observation("obs-1")

    assert result == {"success": True, "skipped": True, "status": STATUS_FAILED}
    assert status_updates == []


@pytest.mark.asyncio
async def test_sdr_runtime_failure_marks_observation_failed_and_cleans_up(monkeypatch):
    executor_module = _load_executor_module(monkeypatch)
    observation = _build_observation()
    observation["status"] = "running"
    status_updates = []
    execution_events = []
    removed_jobs = []
    stopped_observations = []

    async def _fetch_observation(_session, _observation_id):
        return {"success": True, "data": observation}

    async def _update_status(_sio, _observation_id, status, error=None):
        status_updates.append((status, error))

    async def _log_event(_observation_id, event, level):
        execution_events.append((level, event))

    async def _remove_job(observation_id):
        removed_jobs.append(observation_id)

    async def _stop_task(observation_id, _observation):
        stopped_observations.append(observation_id)

    monkeypatch.setattr(executor_module, "AsyncSessionLocal", lambda: _DummyAsyncSessionContext())
    monkeypatch.setattr(executor_module, "fetch_scheduled_observations", _fetch_observation)
    monkeypatch.setattr(executor_module, "update_observation_status", _update_status)
    monkeypatch.setattr(executor_module, "log_execution_event", _log_event)
    monkeypatch.setattr(executor_module, "remove_scheduled_stop_job", _remove_job)
    monkeypatch.setattr(
        executor_module.session_tracker,
        "get_session_metadata",
        lambda _session_id: {"observation_id": "obs-1"},
    )

    executor = _new_executor(executor_module)
    executor._running_observations.add("obs-1")
    monkeypatch.setattr(executor, "_stop_observation_task", _stop_task)

    await executor.handle_sdr_failure("sdr-1", {"internal:obs-1:sdr-1"}, "USB transfer failed")

    assert status_updates == [(STATUS_FAILED, "SDR sdr-1 failed: USB transfer failed")]
    assert execution_events == [("error", "SDR sdr-1 failed: USB transfer failed")]
    assert removed_jobs == ["obs-1"]
    assert stopped_observations == ["obs-1"]
    assert "obs-1" not in executor._running_observations


@pytest.mark.asyncio
async def test_interrupt_running_observations_fails_before_runtime_cleanup(monkeypatch):
    executor_module = _load_executor_module(monkeypatch)
    observation = _build_observation()
    observation["status"] = "running"
    events = []

    async def _fetch_observation(_session, observation_id=None):
        if observation_id is None:
            return {"success": True, "data": [observation]}
        return {"success": True, "data": observation}

    async def _update_status(_sio, _observation_id, status, error=None):
        events.append(("status", status, error))
        return True

    async def _log_event(_observation_id, event, level):
        events.append(("log", level, event))

    async def _remove_job(_observation_id):
        events.append(("remove-job",))

    async def _stop_task(_observation_id, _observation):
        events.append(("cleanup",))

    monkeypatch.setattr(executor_module, "AsyncSessionLocal", lambda: _DummyAsyncSessionContext())
    monkeypatch.setattr(executor_module, "fetch_scheduled_observations", _fetch_observation)
    monkeypatch.setattr(executor_module, "update_observation_status", _update_status)
    monkeypatch.setattr(executor_module, "log_execution_event", _log_event)
    monkeypatch.setattr(executor_module, "remove_scheduled_stop_job", _remove_job)
    monkeypatch.setattr(
        executor_module, "finalize_interrupted_observation_bundles", lambda *_args: 0
    )

    executor = _new_executor(executor_module)
    executor._running_observations.add("obs-1")
    monkeypatch.setattr(executor, "_stop_observation_task", _stop_task)

    stats = await executor.interrupt_running_observations("Backend restarted")

    assert stats == {"found": 1, "failed": 1, "timed_out": 0, "errors": 0}
    assert events == [
        ("log", "error", "Backend restarted"),
        ("status", STATUS_FAILED, "Backend restarted"),
        ("remove-job",),
        ("cleanup",),
    ]
    assert "obs-1" not in executor._running_observations
