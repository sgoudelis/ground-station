"""Observation-owned SatDump products, worker lifecycle, and archive coverage."""

import json
import zipfile
from queue import Empty
from unittest.mock import AsyncMock

import pytest
from fastapi import BackgroundTasks, HTTPException, Request

from handlers.entities.filebrowser import build_observation_bundle_item
from library.inventory import LibraryInventory
from observations.bundle import create_observation_bundle, finalize_observation_bundle
from server import startup
from tasks import manager as taskmanager
from tasks.satdumpprocessor import satdump_process_recording

pytestmark = pytest.mark.unit


@pytest.mark.parametrize("outcome", ["completed", "failed", "stopped", "launch-failed"])
async def test_worker_lifecycle_keeps_ownership_until_exit(tmp_path, monkeypatch, outcome):
    bundle = create_observation_bundle("obs-1", {}, tmp_path)
    recording = bundle / "recordings" / "capture.sigmf-data"
    recording.write_bytes(b"iq")
    output = bundle / "decoded" / "capture.satdump_meteor_hrpt"
    monkeypatch.setattr(taskmanager, "__file__", str(tmp_path / "tasks" / "manager.py"))
    publish = AsyncMock()
    monkeypatch.setattr(taskmanager, "emit_file_browser_state", publish)

    class Process:
        pid = 123
        exitcode = 1 if outcome == "failed" else 0
        alive = False

        def __init__(self, **kwargs):
            pass

        def start(self):
            manifest = json.loads((bundle / "manifest.json").read_text())
            assert manifest["processing_tasks"][0]["status"] == "running"
            if outcome == "launch-failed":
                raise OSError("Unable to start worker")
            self.alive = outcome == "stopped"
            if outcome == "completed":
                output.mkdir()
                (output / "image.png").write_bytes(b"image")
                recording.unlink()

        def is_alive(self):
            return self.alive

        def join(self, **kwargs):
            pass

        def terminate(self):
            self.alive = False

    class Queue:
        def get_nowait(self):
            raise Empty

        def close(self):
            pass

    monkeypatch.setattr(taskmanager.mp, "Process", Process)
    monkeypatch.setattr(taskmanager.mp, "Queue", Queue)
    manager = taskmanager.BackgroundTaskManager(type("Socket", (), {"emit": AsyncMock()})())
    arguments = dict(
        func=satdump_process_recording,
        args=(str(recording), str(output), "meteor_hrpt"),
        kwargs={
            "observation_bundle": str(bundle),
            "delete_input_after": True,
            "retain_input_on_failure": False,
        },
        name="SatDump: capture",
        task_id="job-1",
    )
    if outcome == "launch-failed":
        with pytest.raises(RuntimeError, match="Unable to start worker"):
            await manager.start_task(**arguments)
        finalize_observation_bundle(bundle, "completed")
    else:
        await manager.start_task(**arguments)
        assert finalize_observation_bundle(bundle, "completed") is True
        assert json.loads((bundle / "manifest.json").read_text())["in_progress"] is True
        if outcome == "stopped":
            assert await manager.stop_task("job-1") is True
        else:
            await manager._monitor_tasks["job-1"]
        assert publish.await_count >= 1

    manifest = json.loads((bundle / "manifest.json").read_text())
    assert manifest["status"] == "completed"
    assert manifest["in_progress"] is False
    assert manifest["processing_status"] == ("completed" if outcome == "completed" else "failed")
    assert manifest["processing_tasks"][0]["status"] == (
        "failed" if outcome == "launch-failed" else outcome
    )
    assert recording.exists() is (outcome != "completed")


@pytest.mark.parametrize("pipeline", ["meteor_m2-x_lrpt", "meteor_hrpt"])
def test_nested_product_detail_and_thumbnail_are_owned_by_observation(tmp_path, pipeline):
    bundle = create_observation_bundle("obs-1", {"name": "METEOR"}, tmp_path)
    product = bundle / "decoded" / f"capture.satdump_{pipeline}"
    product.mkdir()
    (product / "image.png").write_bytes(b"image")
    (product / "thumbnail.jpg").write_bytes(b"thumbnail")
    (product / "capture.cadu").write_bytes(b"cadu")
    (product / "product.cbor").write_bytes(b"cbor")
    (product / "dataset.json").write_text(json.dumps({"products": ["MSU-MR"]}))
    (product / "telemetry.json").write_text(json.dumps([{"digital_tlm": {"voltage": 5}}]))
    finalize_observation_bundle(bundle, "completed")
    inventory = LibraryInventory(tmp_path)
    inventory.rebuild()
    page = inventory.query()
    assert page["total"] == 1
    assert "thumbnail.jpg" in page["items"][0]["thumbnail_url"]
    detail = inventory.detail(f"observation:{bundle.name}")
    legacy = build_observation_bundle_item(bundle)
    for payload in (detail, legacy):
        assert payload["decoded_products"][0]["pipeline"] == pipeline
        dataset = payload["decoded_products"][0]
        assert dataset["image_count"] == 1
        assert dataset["images"][0]["filename"] == "image.png"
        assert dataset["images"][0]["url"].startswith(f"/observations/{bundle.name}/decoded/")
        assert dataset["metadata"]["products"] == ["MSU-MR"]
        assert dataset["telemetry"]["digital_tlm"]["voltage"] == 5
        assert dataset["satellite_name"] == "METEOR"
        assert dataset["has_cadu"] is True
        assert "/api/observations/" in dataset["download_url"]
        assert all(
            artifact["product_path"] == f"decoded/{product.name}"
            for artifact in payload["artifacts"]
        )
        assert not any(artifact["name"] == "thumbnail.jpg" for artifact in payload["artifacts"])
    assert (
        inventory.resolve_download(
            f"observation:{bundle.name}", member=f"decoded/{product.name}/dataset.json"
        )
        == product / "dataset.json"
    )


def test_deletion_and_purge_recheck_processing_after_index_refresh(tmp_path):
    bundle = create_observation_bundle("obs-1", {}, tmp_path)
    (bundle / "decoded" / "image.png").write_bytes(b"image")
    finalize_observation_bundle(bundle, "completed")
    inventory = LibraryInventory(tmp_path)
    inventory.rebuild()
    # The snapshot is stale: a worker registered after the catalogue was built.
    manifest = json.loads((bundle / "manifest.json").read_text())
    manifest["in_progress"] = True
    (bundle / "manifest.json").write_text(json.dumps(manifest))
    result = inventory.delete([f"observation:{bundle.name}"])
    assert result["results"][0]["success"] is False
    assert "processing" in result["results"][0]["error"]
    assert inventory.purge("2100-01-01T00:00:00Z")["deleted"] == 0
    assert bundle.exists()


async def test_product_zip_keeps_complete_dataset_and_excludes_other_artifacts(
    tmp_path, monkeypatch
):
    bundle = create_observation_bundle("obs-1", {}, tmp_path)
    product = bundle / "decoded" / "capture.satdump_meteor_hrpt"
    product.mkdir()
    for name in ("dataset.json", "telemetry.json", "product.cbor", "image.png", "capture.cadu"):
        (product / name).write_bytes(b"product")
    (bundle / "recordings" / "capture.sigmf-data").write_bytes(b"iq")
    monkeypatch.setattr(startup, "observations_dir", str(bundle.parent))
    monkeypatch.setattr(startup, "_require_request_auth", AsyncMock())
    response = await startup.download_observation_bundle(
        bundle.name,
        Request({"type": "http"}),
        BackgroundTasks(),
        product=f"decoded/{product.name}",
    )
    try:
        with zipfile.ZipFile(response.path) as archive:
            assert set(archive.namelist()) == {
                "dataset.json",
                "telemetry.json",
                "product.cbor",
                "image.png",
                "capture.cadu",
            }
    finally:
        await response.background()


@pytest.mark.parametrize(
    "product",
    [
        "../decoded/escape",
        "recordings/capture.satdump_meteor_hrpt",
        "decoded",
        "decoded/escape.satdump_meteor_hrpt",
    ],
)
async def test_product_zip_rejects_escape_and_symlink(tmp_path, monkeypatch, product):
    bundle = create_observation_bundle("obs-1", {}, tmp_path)
    outside = tmp_path / "outside"
    outside.mkdir()
    (bundle / "decoded" / "escape.satdump_meteor_hrpt").symlink_to(
        outside, target_is_directory=True
    )
    monkeypatch.setattr(startup, "observations_dir", str(bundle.parent))
    monkeypatch.setattr(startup, "_require_request_auth", AsyncMock())
    with pytest.raises(HTTPException) as error:
        await startup.download_observation_bundle(
            bundle.name, Request({"type": "http"}), BackgroundTasks(), product=product
        )
    assert error.value.status_code == 400
