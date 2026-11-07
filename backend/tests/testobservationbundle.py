import json

from observations.bundle import (
    ARTIFACT_DIRECTORIES,
    add_bundle_processing_task,
    add_bundle_session,
    create_observation_bundle,
    finalize_interrupted_observation_bundles,
    finalize_observation_bundle,
    finish_bundle_processing_task,
    observation_snapshot,
    prune_finalized_empty_observation_bundles,
    recover_interrupted_bundle_processing,
)


def test_create_observation_bundle_has_readable_name_and_manifest(tmp_path):
    bundle_dir = create_observation_bundle(
        "observation-12345678",
        {"name": "NOAA 19", "norad_id": 33591},
        tmp_path,
    )

    assert bundle_dir.name.endswith(".gsobs")
    assert bundle_dir.name.startswith("NOAA_19_")
    assert all((bundle_dir / name).is_dir() for name in ARTIFACT_DIRECTORIES)

    add_bundle_session(bundle_dir, "internal:observation-12345678:sdr-1", "sdr-1")
    manifest = json.loads((bundle_dir / "manifest.json").read_text())
    assert manifest["observation_id"] == "observation-12345678"
    assert manifest["sessions"] == [
        {"session_id": "internal:observation-12345678:sdr-1", "session_key": "sdr-1"}
    ]
    assert manifest["status"] == "in_progress"
    assert manifest["in_progress"] is True


def test_finalize_observation_bundle_deletes_empty_bundle(tmp_path):
    bundle_dir = create_observation_bundle("observation-empty", {}, tmp_path)

    retained = finalize_observation_bundle(bundle_dir, "completed")

    assert retained is False
    assert not bundle_dir.exists()


def test_finalize_observation_bundle_retains_artifacts_and_metadata(tmp_path):
    bundle_dir = create_observation_bundle("observation-artifact", {}, tmp_path)
    (bundle_dir / "decoded" / "image.png").write_bytes(b"image")

    retained = finalize_observation_bundle(bundle_dir, "completed")

    manifest = json.loads((bundle_dir / "manifest.json").read_text())
    assert retained is True
    assert manifest["status"] == "completed"
    assert manifest["in_progress"] is False
    assert manifest["finalized_at"]


def test_observation_snapshot_persists_schedule_and_final_status(tmp_path):
    observation = {
        "name": "NOAA 19 morning pass",
        "enabled": True,
        "status": "running",
        "satellite": {"name": "NOAA 19", "norad_id": 33591, "group_id": "weather"},
        "pass": {
            "event_start": "2026-08-16T12:13:00+00:00",
            "event_end": "2026-08-16T12:19:00+00:00",
            "peak_altitude": 47.25,
        },
        "task_start": "2026-08-16T12:12:45+00:00",
        "task_end": "2026-08-16T12:19:15+00:00",
        "task_start_elevation": 10,
        "sessions": [{"sdr": {"id": "sdr-1"}, "tasks": [{"type": "iq_recording"}]}],
    }
    bundle_dir = create_observation_bundle(
        "observation-artifact", observation["satellite"], tmp_path
    )
    (bundle_dir / "decoded" / "image.png").write_bytes(b"image")
    manifest_path = bundle_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text())
    manifest["scheduled_observation"] = observation_snapshot(observation)
    manifest_path.write_text(json.dumps(manifest))

    finalize_observation_bundle(bundle_dir, "completed")

    manifest = json.loads(manifest_path.read_text())
    snapshot = manifest["scheduled_observation"]
    assert snapshot["pass"]["peak_altitude"] == 47.25
    assert snapshot["task_start_elevation"] == 10
    assert snapshot["sessions"] == observation["sessions"]
    assert snapshot["status"] == "completed"


def test_finalize_interrupted_observation_bundles_uses_manifest_identity(tmp_path):
    interrupted = create_observation_bundle("observation-interrupted", {}, tmp_path)
    (interrupted / "decoded" / "image.png").write_bytes(b"image")
    unrelated = create_observation_bundle("observation-unrelated", {}, tmp_path)

    finalized_count = finalize_interrupted_observation_bundles("observation-interrupted", tmp_path)

    interrupted_manifest = json.loads((interrupted / "manifest.json").read_text())
    unrelated_manifest = json.loads((unrelated / "manifest.json").read_text())
    assert finalized_count == 1
    assert interrupted_manifest["status"] == "failed"
    assert interrupted_manifest["in_progress"] is False
    assert unrelated_manifest["status"] == "in_progress"


def test_prune_finalized_empty_observation_bundles_preserves_active_and_artifact_bundles(tmp_path):
    finalized_empty = create_observation_bundle("observation-empty", {}, tmp_path)
    finalized_empty_manifest = finalized_empty / "manifest.json"
    finalized_empty_data = json.loads(finalized_empty_manifest.read_text())
    finalized_empty_data.update({"status": "completed", "in_progress": False})
    finalized_empty_manifest.write_text(json.dumps(finalized_empty_data))

    active_empty = create_observation_bundle("observation-active", {}, tmp_path)
    finalized_with_artifact = create_observation_bundle("observation-artifact", {}, tmp_path)
    (finalized_with_artifact / "recordings" / "capture.sigmf-data").write_bytes(b"iq")
    artifact_manifest = finalized_with_artifact / "manifest.json"
    artifact_data = json.loads(artifact_manifest.read_text())
    artifact_data.update({"status": "completed", "in_progress": False})
    artifact_manifest.write_text(json.dumps(artifact_data))

    removed_count = prune_finalized_empty_observation_bundles(tmp_path)

    assert removed_count == 1
    assert not finalized_empty.exists()
    assert active_empty.exists()
    assert finalized_with_artifact.exists()


def test_processing_protects_empty_bundle_until_every_worker_finishes(tmp_path):
    bundle = create_observation_bundle("obs-processing", {}, tmp_path)
    for index in (1, 2):
        add_bundle_processing_task(
            bundle,
            str(index),
            str(bundle / "recordings" / f"capture{index}.sigmf-data"),
            str(bundle / "decoded" / f"capture{index}.satdump_meteor_hrpt"),
            "meteor_hrpt",
        )
    assert finalize_observation_bundle(bundle, "completed") is True
    assert prune_finalized_empty_observation_bundles(tmp_path) == 0
    finish_bundle_processing_task(bundle, "1", "completed")
    assert json.loads((bundle / "manifest.json").read_text())["in_progress"] is True
    finish_bundle_processing_task(bundle, "2", "failed")
    assert not bundle.exists()


def test_processing_failure_keeps_retained_iq_and_acquisition_outcome(tmp_path):
    bundle = create_observation_bundle("obs-processing", {}, tmp_path)
    recording = bundle / "recordings" / "capture.sigmf-data"
    recording.write_bytes(b"iq")
    add_bundle_processing_task(
        bundle, "job", str(recording), str(bundle / "decoded" / "product"), "meteor_hrpt"
    )
    finalize_observation_bundle(bundle, "completed")
    finish_bundle_processing_task(bundle, "job", "failed", "No decoded images")
    manifest = json.loads((bundle / "manifest.json").read_text())
    assert manifest["status"] == "completed"
    assert manifest["processing_status"] == "failed"
    assert manifest["in_progress"] is False
    assert manifest["processing_tasks"][0]["error"] == "No decoded images"
    assert recording.exists()


def test_restart_reconciles_processing_after_scheduler_acquisition_completed(tmp_path):
    bundle = create_observation_bundle("obs-processing", {}, tmp_path)
    (bundle / "decoded" / "image.png").write_bytes(b"image")
    add_bundle_processing_task(
        bundle,
        "job",
        str(bundle / "recordings" / "capture.sigmf-data"),
        str(bundle / "decoded" / "product"),
        "meteor_hrpt",
    )
    finalize_observation_bundle(bundle, "completed")
    assert recover_interrupted_bundle_processing(tmp_path) == 1
    manifest = json.loads((bundle / "manifest.json").read_text())
    assert manifest["status"] == "completed"
    assert manifest["in_progress"] is False
    assert manifest["processing_status"] == "failed"
    assert "restarted" in manifest["processing_tasks"][0]["error"]
    assert recover_interrupted_bundle_processing(tmp_path) == 0
