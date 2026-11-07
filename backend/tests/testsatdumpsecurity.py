"""SatDump traversal regression coverage at command and filesystem boundaries."""

from unittest.mock import Mock

import pytest

from common.satdump import SATDUMP_PIPELINES, resolve_satdump_output_dir, validate_satdump_pipeline
from handlers.entities import scheduler
from observations.bundle import create_observation_bundle
from observations.validation import validate_satdump_postprocessing
from tasks import satdumpprocessor

pytestmark = pytest.mark.unit

INVALID_PIPELINES = [
    "../../../../escape",
    "/tmp/escape",
    r"..\..\escape",
    "meteor_m2-x_lrpt/../../escape",
    "meteor_m2-x_lrpt\n",
    "--help",
    "unknown_pipeline",
    "",
    None,
    [],
    {},
    123,
]


def _observation(pipeline, enabled=True):
    return {
        "id": "obs-1",
        "pass": {
            "event_start": "2026-11-06T12:00:00Z",
            "event_end": "2026-11-06T12:10:00Z",
        },
        "sessions": [
            {"tasks": []},
            {
                "tasks": [
                    {
                        "type": "iq_recording",
                        "config": {
                            "enable_post_processing": enabled,
                            "post_process_pipeline": pipeline,
                        },
                    }
                ]
            },
        ],
    }


@pytest.mark.parametrize("pipeline", sorted(SATDUMP_PIPELINES))
def test_supported_pipelines_are_accepted(pipeline):
    assert validate_satdump_pipeline(pipeline) == pipeline
    assert validate_satdump_postprocessing(_observation(pipeline))["success"] is True


@pytest.mark.parametrize("pipeline", INVALID_PIPELINES)
@pytest.mark.parametrize(
    "handler",
    [
        scheduler.create_scheduled_observation,
        scheduler.update_scheduled_observation,
        scheduler.create_monitored_satellite,
        scheduler.update_monitored_satellite,
    ],
)
async def test_invalid_pipeline_is_rejected_before_database_write(monkeypatch, pipeline, handler):
    database = Mock(side_effect=AssertionError("Invalid pipelines must not reach the database"))
    monkeypatch.setattr(scheduler, "AsyncSessionLocal", database)

    result = await handler(None, _observation(pipeline), Mock(), "operator")

    assert result["success"] is False
    assert "SatDump" in result["error"]
    database.assert_not_called()


def test_disabled_postprocessing_does_not_require_a_pipeline():
    assert validate_satdump_postprocessing(_observation(None, enabled=False))["success"] is True
    assert validate_satdump_postprocessing(_observation("", enabled=False))["success"] is True
    # Disabling the task must not be a way to persist a malicious pipeline for later use.
    assert (
        validate_satdump_postprocessing(_observation("../../escape", enabled=False))["success"]
        is False
    )


@pytest.mark.parametrize("pipeline", INVALID_PIPELINES)
def test_worker_rejects_invalid_pipeline_before_any_filesystem_side_effect(
    monkeypatch, tmp_path, pipeline
):
    monkeypatch.setattr(
        satdumpprocessor, "__file__", str(tmp_path / "tasks" / "satdumpprocessor.py")
    )
    popen = Mock(side_effect=AssertionError("Invalid pipelines must not launch SatDump"))
    monkeypatch.setattr(satdumpprocessor.subprocess, "Popen", popen)
    output = tmp_path / "data" / "decoded" / "capture"

    with pytest.raises(ValueError, match="SatDump pipeline"):
        satdumpprocessor.satdump_process_recording("capture.sigmf-data", str(output), pipeline)

    assert not (tmp_path / "data").exists()
    popen.assert_not_called()


@pytest.mark.parametrize(
    "destination", ["absolute", "relative", "app-path", "sibling", "root", "symlink"]
)
def test_worker_rejects_escaped_output_without_writing_or_deleting(
    monkeypatch, tmp_path, destination
):
    backend_dir = tmp_path / "backend"
    monkeypatch.setattr(
        satdumpprocessor, "__file__", str(backend_dir / "tasks" / "satdumpprocessor.py")
    )
    decoded_root = backend_dir / "data" / "decoded"
    decoded_root.mkdir(parents=True)
    outside = backend_dir / "data" / "decoded-other"
    outside.mkdir()
    marker = outside / "image.png"
    marker.write_bytes(b"existing image must survive")
    recording = tmp_path / "capture.sigmf-data"
    recording.write_bytes(b"iq")

    outputs = {
        "absolute": tmp_path / "new-output",
        "relative": "decoded/../../../new-output",
        "app-path": "/decoded/../../../new-output",
        "sibling": outside,
        "root": decoded_root,
        "symlink": decoded_root / "linked-output",
    }
    if destination == "symlink":
        outputs["symlink"].symlink_to(outside, target_is_directory=True)

    popen = Mock(side_effect=AssertionError("Escaped output must not launch SatDump"))
    cleanup = Mock(side_effect=AssertionError("Rejected paths must not enter cleanup"))
    monkeypatch.setattr(satdumpprocessor.subprocess, "Popen", popen)
    monkeypatch.setattr(satdumpprocessor, "_cleanup_empty_directory", cleanup)

    with pytest.raises(ValueError, match="SatDump output directory"):
        satdumpprocessor.satdump_process_recording(
            str(recording), str(outputs[destination]), "meteor_m2-x_lrpt"
        )

    assert marker.read_bytes() == b"existing image must survive"
    assert not (tmp_path / "new-output").exists()
    assert not (outside / "thumbnail.jpg").exists()
    assert decoded_root.exists()
    popen.assert_not_called()
    cleanup.assert_not_called()


@pytest.mark.parametrize("output", ["decoded/capture", "/decoded/capture"])
def test_app_output_paths_resolve_inside_decoded(tmp_path, output):
    assert resolve_satdump_output_dir(output, tmp_path) == tmp_path / "data" / "decoded" / "capture"


def test_existing_symlinked_parent_is_rejected(tmp_path):
    decoded_root = tmp_path / "data" / "decoded"
    decoded_root.mkdir(parents=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    link = decoded_root / "parent"
    link.symlink_to(outside, target_is_directory=True)

    with pytest.raises(ValueError, match="SatDump output directory"):
        resolve_satdump_output_dir(link / "new-output", tmp_path)

    assert not (outside / "new-output").exists()


@pytest.mark.parametrize(
    "destination", ["bundle", "decoded-root", "recordings", "other-bundle", "symlink"]
)
def test_automated_output_is_limited_to_owning_bundle_decoded_subdirectory(tmp_path, destination):
    bundle = create_observation_bundle("obs-1", {}, tmp_path)
    other = create_observation_bundle("obs-2", {}, tmp_path)
    outputs = {
        "bundle": bundle,
        "decoded-root": bundle / "decoded",
        "recordings": bundle / "recordings" / "product",
        "other-bundle": other / "decoded" / "product",
        "symlink": bundle / "decoded" / "linked",
    }
    if destination == "symlink":
        outputs[destination].symlink_to(other / "decoded", target_is_directory=True)
    with pytest.raises(ValueError, match="SatDump output directory"):
        resolve_satdump_output_dir(outputs[destination], tmp_path, bundle)
    assert (
        resolve_satdump_output_dir(bundle / "decoded" / "product", tmp_path, bundle)
        == bundle / "decoded" / "product"
    )
    # UI jobs cannot opt into observation storage merely by choosing its path.
    with pytest.raises(ValueError, match="SatDump output directory"):
        resolve_satdump_output_dir(bundle / "decoded" / "product", tmp_path)
