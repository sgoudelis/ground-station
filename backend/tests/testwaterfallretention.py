"""Survey captures discard samples only after producing a usable waterfall."""

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import numpy as np
import pytest
from PIL import Image

from handlers.entities.filebrowser import build_observation_bundle_item
from observations.tasks.recorderhandler import RecorderHandler
from observations.validation import validate_satdump_postprocessing
from pipeline.managers.recordermanager import RecorderManager
from server import runtimestate
from tasks import waterfallgenerator

pytestmark = pytest.mark.unit


@pytest.fixture
def capture(tmp_path, monkeypatch):
    monkeypatch.setattr(waterfallgenerator, "HAS_SETPROCTITLE", False)
    base = tmp_path / "survey.gsobs" / "recordings" / "capture"
    base.parent.mkdir(parents=True)
    samples = np.exp(2j * np.pi * np.arange(4096) / 32).astype(np.complex64)
    samples.tofile(f"{base}.sigmf-data")
    Path(f"{base}.sigmf-meta").write_text(
        json.dumps(
            {
                "global": {
                    "core:sample_rate": 2400000,
                    "core:datatype": "cf32_le",
                    "gs:start_time": "2026-11-25T10:00:00Z",
                    "gs:finalized_time": "2026-11-25T10:01:00Z",
                    "gs:target_satellite_norad_id": "25544",
                },
                "captures": [{"core:frequency": 145800000}],
            }
        )
    )
    return base


@pytest.mark.parametrize("delete", [False, True])
def test_generated_waterfall_stays_viewable_with_or_without_iq(capture, delete):
    result = waterfallgenerator.generate_waterfall_task(
        str(capture), options={"fft_size": 512}, delete_after_waterfall=delete
    )

    assert result["status"] == "completed"
    assert Path(f"{capture}.sigmf-data").exists() is not delete
    with Image.open(f"{capture}.png") as image:
        image.verify()
    assert capture.with_name("capture_waterfall_thumb.png").is_file()
    item = build_observation_bundle_item(capture.parent.parent)
    assert len(item["recordings"]) == 1
    recording = item["recordings"][0]
    assert recording["iq_data_deleted"] is delete
    assert ("data" in recording["download_urls"]) is not delete
    assert bool(recording["data_file"]) is not delete
    assert recording["metadata"]["sample_rate"] == 2400000
    assert recording["metadata"]["center_frequency"] == 145800000
    assert recording["metadata"]["target_satellite_norad_id"] == "25544"
    assert recording["metadata"]["finalized_time"] == "2026-11-25T10:01:00Z"
    assert recording["snapshot"]["url"].startswith("/observations/survey.gsobs/recordings/")
    # Retained files stay grouped, so previews and metadata never appear as stray artifacts.
    assert all(artifact["recording_name"] == "capture" for artifact in item["artifacts"])


@pytest.mark.parametrize("failure", ["false", "exception", "missing_image", "metadata"])
def test_failed_generation_or_finalization_preserves_samples(capture, monkeypatch, failure):
    def generate(_generator, _path):
        if failure == "exception":
            raise RuntimeError("Cannot render image")
        if failure == "metadata":
            Path(f"{capture}.png").write_bytes(b"image")
            Path(f"{capture}.sigmf-meta").write_text("invalid json")
        return failure != "false"

    monkeypatch.setattr(waterfallgenerator.WaterfallGenerator, "generate_from_sigmf", generate)
    with pytest.raises((RuntimeError, ValueError)):
        waterfallgenerator.generate_waterfall_task(str(capture), delete_after_waterfall=True)
    assert Path(f"{capture}.sigmf-data").stat().st_size == 4096 * 8


@pytest.mark.parametrize("post_processing", [False, True])
async def test_observation_policy_reaches_recorder_and_protects_satdump(tmp_path, post_processing):
    manager = SimpleNamespace(start_recorder=Mock(return_value=True))
    config = {
        "delete_after_waterfall": True,
        "enable_post_processing": post_processing,
        "delete_after_post_processing": post_processing,
    }
    result = validate_satdump_postprocessing(
        {"sessions": [{"tasks": [{"type": "iq_recording", "config": config}]}]}
    )
    assert result["success"] is not post_processing
    path = await RecorderHandler(manager).start_iq_recording_task(
        "observation", "session", "radio", {"name": "ISS"}, config, bundle_dir=tmp_path
    )
    assert path
    kwargs = manager.start_recorder.call_args.kwargs
    assert kwargs["delete_after_waterfall"] is not post_processing
    assert kwargs["skip_auto_waterfall"] is post_processing


async def test_mixed_session_applies_waterfall_policy_per_recorder(tmp_path):
    recorders = {}
    for key, delete, skip in [("survey", True, False), ("satdump", False, True)]:
        recorder = type("IQRecorder", (), {})()
        recorder.session_id = "session"
        recorder.recording_path = tmp_path / key
        recorder.delete_after_waterfall = delete
        recorder.skip_auto_waterfall = skip
        recorder.stop = Mock()
        recorder.join = Mock()
        recorders[key] = recorder
    manager = RecorderManager({"radio": {"recorders": recorders}}, sio=Mock())
    manager._emit_recording_stopped_notification = AsyncMock()
    manager._generate_waterfall_async = AsyncMock()

    assert manager.stop_all_recorders_for_session("radio", "session") == 2
    await asyncio.sleep(0)
    manager._generate_waterfall_async.assert_awaited_once_with(tmp_path / "survey", True)


@pytest.mark.parametrize("background", [False, True])
async def test_background_and_fallback_waterfalls_receive_cleanup_policy(
    capture, monkeypatch, background
):
    process_name = waterfallgenerator.multiprocessing.current_process().name
    task_manager = SimpleNamespace(start_task=AsyncMock(return_value="waterfall"))
    monkeypatch.setattr(
        runtimestate, "background_task_manager", task_manager if background else None
    )
    manager = RecorderManager({}, sio=None)

    await manager._generate_waterfall_async(str(capture), delete_after_waterfall=True)
    assert waterfallgenerator.multiprocessing.current_process().name == process_name

    if background:
        assert task_manager.start_task.await_args.kwargs["kwargs"] == {
            "delete_after_waterfall": True
        }
        assert Path(f"{capture}.sigmf-data").exists()
    else:
        assert Path(f"{capture}.png").is_file()
        assert not Path(f"{capture}.sigmf-data").exists()
