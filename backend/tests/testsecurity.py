# Copyright (c) 2026 Efstratios Goudelis

import base64
from pathlib import Path

import pytest

from common.filenames import (
    looks_like_path_input,
    resolve_base_path_within_root,
    sanitize_filename_component,
)
from common.pathguard import resolve_sigmf_meta_path
from observations.tasks.recorderhandler import RecorderHandler
from server.snapshots import save_waterfall_snapshot


def _data_url(payload: bytes) -> str:
    encoded = base64.b64encode(payload).decode()
    return f"data:image/png;base64,{encoded}"


def test_save_waterfall_snapshot_rejects_absolute_snapshot_name(tmp_path):
    result = save_waterfall_snapshot(
        _data_url(b"snapshot-test"),
        snapshot_name="/tmp/evil",
        snapshots_root=tmp_path,
    )

    assert result["success"] is False
    assert "Invalid snapshot name" in result["error"]


def test_save_waterfall_snapshot_rejects_traversal_snapshot_name(tmp_path):
    result = save_waterfall_snapshot(
        _data_url(b"snapshot-test"),
        snapshot_name="../../outside",
        snapshots_root=tmp_path,
    )

    assert result["success"] is False
    assert "Invalid snapshot name" in result["error"]


def test_save_waterfall_snapshot_writes_within_snapshots_root(tmp_path):
    result = save_waterfall_snapshot(
        _data_url(b"snapshot-test"),
        snapshot_name="safe_snapshot",
        snapshots_root=tmp_path,
    )

    assert result["success"] is True
    saved_path = Path(result["snapshot_path"]).resolve()
    assert saved_path.exists()
    assert saved_path.suffix == ".png"
    assert saved_path.is_relative_to(tmp_path.resolve())


def test_resolve_sigmf_meta_path_rejects_outside_default_root(tmp_path):
    recordings_root = tmp_path / "recordings"
    recordings_root.mkdir()
    outside_path = tmp_path / "outside" / "secret.sigmf-meta"
    outside_path.parent.mkdir()
    outside_path.write_text("{}")

    with pytest.raises(ValueError, match="outside allowed directories"):
        resolve_sigmf_meta_path(
            str(outside_path),
            recordings_root=recordings_root,
            allowed_roots=[recordings_root],
        )


def test_resolve_sigmf_meta_path_allows_explicit_trusted_root(tmp_path):
    recordings_root = tmp_path / "recordings"
    recordings_root.mkdir()
    trusted_root = tmp_path / "trusted"
    trusted_root.mkdir()
    trusted_meta = trusted_root / "mirror.sigmf-meta"
    trusted_meta.write_text("{}")

    resolved = resolve_sigmf_meta_path(
        str(trusted_meta),
        recordings_root=recordings_root,
        allowed_roots=[recordings_root, trusted_root],
    )

    assert resolved == trusted_meta.resolve()


def test_sanitize_filename_component_flattens_path_like_satellite_names():
    sanitized = sanitize_filename_component("RS-44 & BREEZE-KM R/B", default="unknown")
    assert sanitized == "RS-44_BREEZE-KM_R_B"


def test_looks_like_path_input_detects_traversal_and_absolute_paths():
    assert looks_like_path_input("../../tmp/pwn")
    assert looks_like_path_input("/tmp/pwn")
    assert looks_like_path_input(r"..\\..\\pwn")
    assert not looks_like_path_input("NOAA_19")


def test_resolve_base_path_within_root_rejects_path_traversal(tmp_path):
    recordings_root = tmp_path / "recordings"
    recordings_root.mkdir()

    with pytest.raises(ValueError, match="outside allowed directories"):
        resolve_base_path_within_root(recordings_root, "../escape")


@pytest.mark.asyncio
async def test_observation_iq_recording_path_sanitizes_satellite_name():
    class DummyProcessManager:
        def __init__(self):
            self.recording_path = None

        def start_recorder(self, _sdr_id, _session_id, _recorder_class, **kwargs):
            self.recording_path = kwargs.get("recording_path")
            return True

    process_manager = DummyProcessManager()
    handler = RecorderHandler(process_manager)
    satellite = {"name": "RS-44 & BREEZE-KM R/B", "norad_id": 44909}

    recording_path = await handler.start_iq_recording_task(
        observation_id="obs-1",
        session_id="internal:obs-1:sdr-1",
        sdr_id="sdr-1",
        satellite=satellite,
        task_config={},
        recorder_id="internal:obs-1:sdr-1:iq:1",
    )

    assert recording_path is not None
    basename = Path(recording_path).name
    assert "/" not in basename
    assert "\\" not in basename
    assert ".." not in basename
    assert basename.startswith("RS-44_BREEZE-KM_R_B_")
    assert process_manager.recording_path == recording_path
    assert Path(recording_path).parent.name == "recordings"
