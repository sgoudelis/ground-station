"""SatDump cache and recording cleanup coverage."""

import sqlite3
from queue import Empty
from types import SimpleNamespace

import pytest

from observations.bundle import create_observation_bundle
from tasks import satdumpprocessor
from tasks.manager import BackgroundTaskManager, TaskInfo, TaskStatus
from tasks.satdumpprocessor import (
    _build_tle_file_from_ground_station_db,
    _count_omm_only_satellites,
)


def test_satdump_cache_excludes_omm_only_six_digit_satellites(tmp_path):
    db_path = tmp_path / "gs.db"
    output_path = tmp_path / "satdump_tles.txt"
    connection = sqlite3.connect(db_path)
    try:
        connection.execute("CREATE TABLE satellites (name TEXT, tle1 TEXT, tle2 TEXT)")
        connection.execute(
            "INSERT INTO satellites VALUES (?, ?, ?)",
            (
                "Five digit object",
                "1 25544U 98067A   25001.50000000  .00012345  00000-0  21914-3 0  9999",
                "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.50000000999999",
            ),
        )
        connection.execute("INSERT INTO satellites VALUES (?, ?, ?)", ("OMM only", None, None))
        connection.commit()
    finally:
        connection.close()

    assert _build_tle_file_from_ground_station_db(db_path, output_path) == 1
    assert _count_omm_only_satellites(db_path) == 1
    cache = output_path.read_text()
    assert "Five digit object" in cache
    assert "OMM only" not in cache


@pytest.mark.parametrize(
    ("has_images", "return_code", "retain_on_failure", "expected_deleted"),
    [
        (False, 0, True, False),
        (False, 0, False, True),
        (True, 2, True, False),
        (True, 0, True, True),
        (True, 1, True, True),
    ],
)
@pytest.mark.parametrize("automated", [False, True])
def test_satdump_deletes_iq_only_when_policy_allows(
    monkeypatch, tmp_path, has_images, return_code, retain_on_failure, expected_deleted, automated
):
    bundle = create_observation_bundle("obs-1", {}, tmp_path) if automated else None
    recording_base = (bundle / "recordings" if bundle else tmp_path) / "capture"
    data_file = recording_base.with_suffix(".sigmf-data")
    meta_file = recording_base.with_suffix(".sigmf-meta")
    data_file.write_bytes(b"iq")
    meta_file.write_text("{}")
    monkeypatch.setattr(
        satdumpprocessor, "__file__", str(tmp_path / "tasks" / "satdumpprocessor.py")
    )
    output_dir = (bundle / "decoded" if bundle else tmp_path / "data" / "decoded") / "capture"

    class FakeProcess:
        def __init__(self):
            self.stdout = SimpleNamespace(readline=lambda: "")

        def wait(self):
            return return_code

    def fake_popen(_command, **_kwargs):
        if has_images:
            output_dir.joinpath("image.png").write_bytes(b"png")
        return FakeProcess()

    monkeypatch.setattr(satdumpprocessor, "GracefulKiller", lambda: SimpleNamespace(kill_now=False))
    monkeypatch.setattr(
        satdumpprocessor,
        "_prepare_satdump_tle_cache",
        lambda *_args: tmp_path / "missing-tles.txt",
    )
    monkeypatch.setattr(satdumpprocessor.subprocess, "Popen", fake_popen)
    monkeypatch.setattr(
        satdumpprocessor, "generate_decoded_thumbnail", lambda *_args, **_kwargs: None
    )

    def run():
        return satdumpprocessor.satdump_process_recording(
            str(data_file),
            str(output_dir),
            "meteor_m2-x_lrpt",
            samplerate=1_000_000,
            baseband_format="f32",
            delete_input_after=True,
            retain_input_on_failure=retain_on_failure,
            observation_bundle=str(bundle) if bundle else None,
        )

    if has_images and return_code in (0, 1):
        assert run()["status"] == "completed"
    else:
        with pytest.raises(RuntimeError):
            run()

    assert data_file.exists() is not expected_deleted
    assert meta_file.exists() is not expected_deleted


@pytest.mark.parametrize("retain_on_failure", [True, False])
@pytest.mark.asyncio
async def test_failed_satdump_schedules_waterfall_only_for_retained_iq(
    tmp_path, monkeypatch, retain_on_failure
):
    recording_base = tmp_path / "capture"
    data_file = recording_base.with_suffix(".sigmf-data")
    meta_file = recording_base.with_suffix(".sigmf-meta")
    data_file.write_bytes(b"iq")
    meta_file.write_text("{}")

    class FakeSocket:
        async def emit(self, *_args, **_kwargs):
            pass

    class FakeProcess:
        exitcode = 1

        def is_alive(self):
            return False

        def join(self, **_kwargs):
            pass

    class FakeQueue:
        def get_nowait(self):
            raise Empty

        def close(self):
            pass

    manager = BackgroundTaskManager(FakeSocket())
    task = TaskInfo(
        task_id="failed-satdump",
        name="SatDump: capture",
        func_name="satdump_process_recording",
        args=(str(data_file), str(tmp_path / "decoded"), "meteor_m2-x_lrpt"),
        kwargs={"delete_input_after": True, "retain_input_on_failure": retain_on_failure},
        status=TaskStatus.FAILED,
        process=FakeProcess(),
        queue=FakeQueue(),
    )
    manager.tasks[task.task_id] = task
    scheduled = []

    async def fake_start_task(**kwargs):
        scheduled.append(kwargs)
        return "waterfall-task"

    monkeypatch.setattr(manager, "start_task", fake_start_task)
    await manager._monitor_task(task.task_id)

    assert len(scheduled) == (1 if retain_on_failure else 0)
    if retain_on_failure:
        assert scheduled[0]["args"] == (str(recording_base),)
        assert scheduled[0]["name"] == "Waterfall: capture"
        assert scheduled[0]["func"].__name__ == "generate_waterfall_task"
