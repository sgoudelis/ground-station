# Copyright (c) 2026 Efstratios Goudelis
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.

"""Tests for the rebuildable filesystem library catalogue."""

import asyncio
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from common.events import EventBroker
from handlers.entities import filebrowser, library
from library import inventory as inventorymodule
from library.inventory import LibraryInventory
from server import startup


def _write(path: Path, content: bytes | str = b"") -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, str):
        path.write_text(content)
    else:
        path.write_bytes(content)
    return path


def _backdate(path: Path, days: int) -> None:
    """Make every file under a path appear older than the given age."""
    stamp = time.time() - days * 86400
    if path.is_dir():
        for member in path.rglob("*"):
            if member.is_file():
                os.utime(member, (stamp, stamp))
    else:
        os.utime(path, (stamp, stamp))


def _cutoff(days: int) -> str:
    return (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()


@pytest.fixture
def inventory(tmp_path):
    backend = tmp_path / "backend"
    recordings = backend / "data" / "recordings"
    _write(recordings / "capture.sigmf-data", b"iq")
    _write(
        recordings / "capture.sigmf-meta",
        json.dumps(
            {
                "global": {
                    "core:sample_rate": 48_000,
                    "gs:session_id": "session-1",
                    "gs:recording_in_progress": False,
                },
                "captures": [{"core:frequency": 137_100_000}],
            }
        ),
    )
    _write(backend / "data" / "snapshots" / "waterfall.png", b"png")
    _write(backend / "data" / "decoded" / "packet.bin", b"packet")
    _write(
        backend / "data" / "decoded" / "packet.json",
        json.dumps({"decoder": {"type": "ax25", "session_id": "session-1"}}),
    )
    _write(backend / "data" / "audio" / "voice.wav", b"wav")
    _write(backend / "data" / "audio" / "voice.json", json.dumps({"sample_rate": 12_000}))
    _write(
        backend / "data" / "transcriptions" / "voice.txt",
        "# Provider: local\n# Session: session-1\n# Language: en\n\nhello\n",
    )
    _write(
        backend / "data" / "observations" / "NOAA.gsobs" / "manifest.json",
        json.dumps({"satellite": {"name": "NOAA 19"}, "status": "complete"}),
    )
    _write(backend / "data" / "observations" / "NOAA.gsobs" / "decoded" / "image.png", b"png")
    _write(
        backend / "data" / "observations" / "NOAA.gsobs" / "transcriptions" / "voice.txt",
        "transcript",
    )
    result = LibraryInventory(backend)
    result.rebuild()
    return result


def test_inventory_returns_compact_server_side_pages(inventory):
    page = inventory.query(sort_by="name", sort_order="asc", page=1, page_size=2)

    assert page["total"] == 6
    assert len(page["items"]) == 2
    assert page["has_more"] is True
    assert all("_path" not in item for item in page["items"])
    assert {item["id"].split(":", 1)[0] for item in page["items"]} <= {
        "recording",
        "snapshot",
        "decoded",
        "audio",
        "transcription",
        "observation",
    }

    last_page = inventory.query(page=99, page_size=2)
    assert last_page["page"] == 3
    assert len(last_page["items"]) == 2


def test_inventory_filters_without_rescanning_filesystem(inventory):
    page = inventory.query(
        filters={
            "showRecordings": False,
            "showSnapshots": False,
            "showDecoded": False,
            "showAudio": True,
            "showTranscriptions": False,
        }
    )

    assert page["total"] == 1
    assert page["items"][0]["id"] == "audio:voice.wav"


def test_observation_filter_is_independent_of_decoded_products(inventory):
    decoded_folder = inventory.roots.decoded / "METEOR_M2.satdump_meteor_m2-x_lrpt"
    _write(decoded_folder / "dataset.json", b"{}")
    _write(decoded_folder / "image.png", b"image")
    inventory.rebuild()
    other_types_off = {
        "showRecordings": False,
        "showSnapshots": False,
        "showAudio": False,
        "showTranscriptions": False,
    }

    observations = inventory.query(
        filters={**other_types_off, "showDecoded": False, "showObservations": True}
    )
    decoded = inventory.query(
        filters={**other_types_off, "showDecoded": True, "showObservations": False}
    )

    assert {item["id"] for item in observations["items"]} == {"observation:NOAA.gsobs"}
    assert {item["id"] for item in decoded["items"]} == {
        "decoded:packet.bin",
        "decoded_folder:METEOR_M2.satdump_meteor_m2-x_lrpt",
    }


def test_inventory_filters_a_single_observation_session(inventory):
    page = inventory.query(session_id="session-1")

    assert {item["id"] for item in page["items"]} == {
        "recording:capture",
        "decoded:packet.bin",
        "transcription:voice.txt",
    }

    by_observation = inventory.query(observation_id="packet")
    assert [item["id"] for item in by_observation["items"]] == ["decoded:packet.bin"]


def test_observation_summary_includes_the_visible_artifact_count_and_size(inventory):
    page = inventory.query()
    observation = next(item for item in page["items"] if item["id"] == "observation:NOAA.gsobs")

    assert observation["artifact_count"] == 2
    assert observation["size"] == 13


def test_inventory_deletes_a_decoded_folder(inventory):
    folder = inventory.roots.decoded / "METEOR_M2.satdump_meteor_m2-x_lrpt"
    _write(folder / "image.png", b"image")
    inventory.rebuild()

    result = inventory.delete(["decoded_folder:METEOR_M2.satdump_meteor_m2-x_lrpt"])

    assert result["results"] == [
        {"id": "decoded_folder:METEOR_M2.satdump_meteor_m2-x_lrpt", "success": True}
    ]
    assert not folder.exists()


def test_decoded_folder_summary_includes_nested_meteor_size_and_image_count(inventory):
    folder = inventory.roots.decoded / "METEOR_M2.satdump_meteor_m2-x_lrpt"
    _write(folder / "dataset.json", b"{}")
    _write(folder / "products" / "image.png", b"image data")
    _write(folder / "products" / "packets.cadu", b"packets")
    inventory.rebuild()

    summary = inventory.get("decoded_folder:METEOR_M2.satdump_meteor_m2-x_lrpt")
    detail = inventory.detail(summary["id"])
    page_item = next(item for item in inventory.query()["items"] if item["id"] == summary["id"])

    assert summary["size"] == 2 + 10 + 7
    assert summary["image_count"] == page_item["image_count"] == detail["image_count"] == 1
    assert detail["size"] == summary["size"]


def test_observation_detail_uses_waterfall_previews_and_groups_recording_files(inventory):
    folder = inventory.roots.observations / "NOAA.gsobs"
    recording_root = folder / "recordings"
    _write(recording_root / "capture.sigmf-data", b"iq")
    _write(recording_root / "capture.sigmf-meta", json.dumps({"global": {}}))
    _write(recording_root / "capture.png", b"full waterfall")
    _write(recording_root / "capture_waterfall_thumb.png", b"waterfall preview")
    _write(folder / "decoded" / "product.png", b"full image")
    _write(folder / "decoded" / "thumbnails" / "product.jpg", b"image preview")
    inventory.rebuild()

    detail = inventory.detail("observation:NOAA.gsobs")
    recording = detail["recordings"][0]
    artifacts = {artifact["path"]: artifact for artifact in detail["artifacts"]}
    product = next(image for image in detail["images"] if image["path"] == "decoded/product.png")

    assert recording["observation_bundle"] == "NOAA.gsobs"
    assert recording["download_urls"]["data"] == (
        "/observations/NOAA.gsobs/recordings/capture.sigmf-data"
    )
    assert recording["snapshot"]["url"].startswith(
        "/observations/NOAA.gsobs/recordings/capture.png?v="
    )
    assert recording["snapshot"]["thumbnail_url"].startswith(
        "/observations/NOAA.gsobs/recordings/capture_waterfall_thumb.png?v="
    )
    assert artifacts["recordings/capture.png"]["recording_name"] == "capture"
    assert artifacts["recordings/capture_waterfall_thumb.png"]["recording_name"] == "capture"
    assert artifacts["recordings/capture.sigmf-data"]["recording_name"] == "capture"
    assert product["thumbnail_url"].startswith(
        "/observations/NOAA.gsobs/decoded/thumbnails/product.jpg?v="
    )


def test_regenerated_waterfall_changes_all_observation_image_urls(inventory):
    folder = inventory.roots.observations / "NOAA.gsobs"
    recording_root = folder / "recordings"
    _write(recording_root / "capture.sigmf-data", b"iq")
    _write(recording_root / "capture.sigmf-meta", json.dumps({"global": {}}))
    image = _write(recording_root / "capture.png", b"old waterfall")
    thumbnail = _write(recording_root / "capture_waterfall_thumb.png", b"old preview")
    inventory.rebuild()

    before_summary = inventory.get("observation:NOAA.gsobs")
    before_detail = inventory.detail("observation:NOAA.gsobs")
    before_snapshot = before_detail["recordings"][0]["snapshot"]
    before_image = next(
        artifact for artifact in before_detail["images"] if artifact["name"] == "capture.png"
    )

    # Regeneration can replace both files in one second. Use nanosecond mtimes
    # so the browser always requests the new image instead of its cached copy.
    for path, content in ((image, b"new waterfall"), (thumbnail, b"new preview")):
        previous_mtime = path.stat().st_mtime_ns
        path.write_bytes(content)
        os.utime(path, ns=(previous_mtime + 1_000_000, previous_mtime + 1_000_000))
    inventory.rebuild()

    after_summary = inventory.get("observation:NOAA.gsobs")
    after_detail = inventory.detail("observation:NOAA.gsobs")
    after_snapshot = after_detail["recordings"][0]["snapshot"]
    after_image = next(
        artifact for artifact in after_detail["images"] if artifact["name"] == "capture.png"
    )

    assert after_snapshot["url"] != before_snapshot["url"]
    assert after_snapshot["thumbnail_url"] != before_snapshot["thumbnail_url"]
    assert after_summary["thumbnail_url"] != before_summary["thumbnail_url"]
    assert after_image["url"] != before_image["url"]


def test_rebuild_only_advances_revision_when_filesystem_changes(inventory):
    revision = inventory.revision

    assert inventory.rebuild() == revision
    _write(inventory.roots.snapshots / "external.png", b"png")

    assert inventory.rebuild() == revision + 1
    assert inventory.query()["total"] == 7


def test_artifact_ready_is_emitted_once_after_new_or_completed_item(inventory, monkeypatch):
    broker = EventBroker()
    subscription = broker.subscribe("artifact-token", ["artifacts:read"])
    monkeypatch.setattr(inventorymodule, "public_events", broker)
    inventorymodule.publish_ready_artifacts(inventory)
    assert subscription.queue.empty()  # Startup inventory is a baseline, not new work.

    _write(inventory.roots.snapshots / "new.png", b"png")
    inventory.rebuild()
    inventorymodule.publish_ready_artifacts(inventory)
    assert subscription.queue.get_nowait() == (
        "artifact.ready",
        {"id": "snapshot:new.png", "type": "snapshot", "name": "new"},
    )
    inventory.rebuild()
    inventorymodule.publish_ready_artifacts(inventory)
    assert subscription.queue.empty()

    metadata = inventory.roots.recordings / "capture.sigmf-meta"
    capture = json.loads(metadata.read_text())
    capture["global"]["gs:recording_in_progress"] = True
    metadata.write_text(json.dumps(capture))
    inventory.rebuild()
    inventorymodule.publish_ready_artifacts(inventory)
    assert subscription.queue.empty()
    capture["global"]["gs:recording_in_progress"] = False
    metadata.write_text(json.dumps(capture))
    inventory.rebuild()
    inventorymodule.publish_ready_artifacts(inventory)
    assert subscription.queue.get_nowait()[1]["id"] == "recording:capture"


@pytest.mark.asyncio
async def test_periodic_reconcile_publishes_external_artifact(inventory, monkeypatch):
    broker = EventBroker()
    subscription = broker.subscribe("artifact-token", ["artifacts:read"])
    monkeypatch.setattr(inventorymodule, "public_events", broker)
    monkeypatch.setattr(startup, "get_inventory", lambda: inventory)
    _write(inventory.roots.snapshots / "external.png", b"png")

    class FakeSio:
        def __init__(self):
            self.events = []

        async def emit(self, event, payload, room=None):
            self.events.append((event, payload, room))

    sio = FakeSio()
    monkeypatch.setattr(startup, "sio", sio)
    calls = 0

    async def one_scan(_delay):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise asyncio.CancelledError

    monkeypatch.setattr(startup.asyncio, "sleep", one_scan)
    with pytest.raises(asyncio.CancelledError):
        await startup._reconcile_library_periodically()

    assert subscription.queue.get_nowait()[1]["id"] == "snapshot:external.png"
    assert sio.events[0][0] == "library.changed"


def test_inventory_deletes_recording_companions_and_rebuilds(inventory):
    result = inventory.delete(["recording:capture"])

    assert result["results"] == [{"id": "recording:capture", "success": True}]
    assert inventory.query()["total"] == 5
    recording_root = inventory.roots.recordings
    assert not (recording_root / "capture.sigmf-data").exists()
    assert not (recording_root / "capture.sigmf-meta").exists()


@pytest.mark.asyncio
async def test_library_delete_command_acknowledges_per_item_result(inventory, monkeypatch):
    monkeypatch.setattr(library, "get_inventory", lambda: inventory)

    class FakeSio:
        def __init__(self):
            self.events = []

        async def emit(self, event, payload, room=None):
            self.events.append((event, payload, room))

    sio = FakeSio()
    reply = await library.delete_library_items(
        sio, {"ids": ["snapshot:waterfall.png", "missing:item"]}, None, "sid"
    )

    assert reply["success"] is True
    assert reply["data"]["results"] == [
        {"id": "snapshot:waterfall.png", "success": True},
        {"id": "missing:item", "success": False, "error": "Item not found"},
    ]
    assert sio.events[0][0] == "library.changed"


@pytest.mark.asyncio
async def test_transcription_file_creation_rebuilds_and_notifies_library(monkeypatch):
    calls = []

    class FakeInventory:
        def rebuild(self):
            calls.append("rebuild")
            return 7

        def take_ready(self):
            return []

    class FakeSio:
        def __init__(self):
            self.events = []

        async def emit(self, event, payload, room=None):
            self.events.append((event, payload, room))

    monkeypatch.setattr(filebrowser, "get_inventory", lambda: FakeInventory())
    sio = FakeSio()

    await filebrowser.emit_file_browser_state(
        sio, {"action": "transcription-file-created"}, logger=logging.getLogger(__name__)
    )

    assert calls == ["rebuild"]
    assert sio.events[0][0] == "library.changed"


def test_purge_preview_counts_each_group_as_a_single_item(inventory):
    folder = inventory.roots.decoded / "METEOR_M2.satdump_meteor_m2-x_lrpt"
    _write(folder / "dataset.json", "{}")
    _write(folder / "products" / "image.png", b"image data")
    _write(folder / "products" / "packets.cadu", b"packets")
    _backdate(inventory.roots.data, 400)
    inventory.rebuild()

    preview = inventory.purge_preview(_cutoff(100))

    # Bundles and multi-file products collapse into one item each.
    assert preview["items"] == 7
    bundle = inventory.roots.observations / "NOAA.gsobs"
    bundle_bytes = sum(path.stat().st_size for path in bundle.rglob("*") if path.is_file())
    assert preview["categories"]["observation"] == {"items": 1, "files": 3, "bytes": bundle_bytes}
    assert preview["categories"]["decoded_folder"]["items"] == 1
    assert preview["categories"]["decoded_folder"]["files"] == 3
    assert preview["categories"]["audio"]["files"] == 2  # wav + metadata
    assert preview["oldest"] and preview["newest"]
    assert preview["skippedInProgress"] == 0


def test_purge_preview_and_purge_skip_in_progress_work(inventory):
    _backdate(inventory.roots.data, 400)
    recording_root = inventory.roots.recordings
    _write(
        recording_root / "live.sigmf-meta",
        json.dumps({"global": {"gs:recording_in_progress": True}}),
    )
    _write(recording_root / "live.sigmf-data", b"iq")
    _write(
        inventory.roots.observations / "RUNNING.gsobs" / "manifest.json",
        json.dumps({"status": "running", "in_progress": True}),
    )
    _backdate(recording_root / "live.sigmf-meta", 400)
    _backdate(recording_root / "live.sigmf-data", 400)
    _backdate(inventory.roots.observations / "RUNNING.gsobs", 400)
    inventory.rebuild()

    preview = inventory.purge_preview(_cutoff(100))

    assert preview["skippedInProgress"] == 2
    assert inventory.purge_preview(_cutoff(500))["skippedInProgress"] == 0
    assert preview["categories"]["recording"]["items"] == 1  # only the finished capture
    assert preview["categories"]["observation"]["items"] == 1  # only the finished bundle

    result = inventory.purge(_cutoff(100))

    assert result["deleted"] == 6
    assert (recording_root / "live.sigmf-data").exists()
    assert (inventory.roots.observations / "RUNNING.gsobs").exists()
    assert not (inventory.roots.snapshots / "waterfall.png").exists()
    assert not (inventory.roots.audio / "voice.json").exists()  # metadata cascade


def test_purge_keeps_recent_items_and_reports_progress(inventory):
    _backdate(inventory.roots.data, 400)
    recent_audio = inventory.roots.audio / "voice.wav"
    os.utime(recent_audio, None)  # keep one item fresh
    inventory.rebuild()

    events = []
    revision_before = inventory.revision
    result = inventory.purge(_cutoff(100), progress_callback=events.append)

    assert result["deleted"] == 5
    assert recent_audio.exists()
    assert (inventory.roots.audio / "voice.json").exists()  # kept together with its wav
    assert not (inventory.roots.observations / "NOAA.gsobs").exists()  # whole bundle removed
    assert not (inventory.roots.recordings / "capture.sigmf-meta").exists()
    assert result["bytesFreed"] > 0
    assert result["revision"] == inventory.revision > revision_before
    assert events[0]["total"] == 5 and events[0]["done"] == 0
    assert events[-1]["done"] == 5 and events[-1]["current"] is None
    assert any(event["current"] for event in events)  # per-item progress names

    assert inventory.purge_preview(_cutoff(100))["items"] == 0


def test_purge_rechecks_a_recording_that_became_active(inventory):
    _backdate(inventory.roots.data, 400)
    inventory.rebuild()
    data = inventory.roots.recordings / "capture.sigmf-data"
    meta = inventory.roots.recordings / "capture.sigmf-meta"

    # The index still says this capture is finished when its writer resumes.
    meta.write_text(json.dumps({"global": {"gs:recording_in_progress": True}}))
    assert inventory.purge_preview(_cutoff(100))["categories"]["recording"]["items"] == 0
    assert inventory.purge(_cutoff(100))["deleted"] == 5
    assert data.exists()


def test_purge_rechecks_status_during_the_sweep(inventory):
    _backdate(inventory.roots.data, 400)
    inventory.rebuild()
    meta = inventory.roots.recordings / "capture.sigmf-meta"

    def on_progress(progress):
        if progress["current"] == "capture":
            meta.write_text(json.dumps({"global": {"gs:recording_in_progress": True}}))

    result = inventory.purge(_cutoff(100), on_progress)
    assert result["deleted"] == 5
    assert (inventory.roots.recordings / "capture.sigmf-data").exists()


def test_purge_includes_owned_metadata_and_thumbnails(inventory):
    snapshot_thumbnail = _write(
        inventory.roots.snapshots / "thumbnails" / "waterfall.jpg", b"thumb"
    )
    _backdate(inventory.roots.data, 400)
    inventory.rebuild()

    preview = inventory.purge_preview(_cutoff(100))
    assert preview["categories"]["decoded"]["files"] == 2
    assert preview["categories"]["snapshot"]["files"] == 2
    assert preview["categories"]["decoded"]["bytes"] == len(b"packet") + len(
        (inventory.roots.decoded / "packet.json").read_bytes()
    )

    inventory.purge(_cutoff(100))
    assert not (inventory.roots.decoded / "packet.json").exists()
    assert not snapshot_thumbnail.exists()


def test_purge_rejects_invalid_cutoff(inventory):
    with pytest.raises(ValueError):
        inventory.purge_preview("yesterday")
    with pytest.raises(ValueError):
        inventory.purge("yesterday")


@pytest.mark.asyncio
async def test_purge_preview_command_returns_aggregates(inventory, monkeypatch):
    monkeypatch.setattr(library, "get_inventory", lambda: inventory)
    _backdate(inventory.roots.data, 400)
    inventory.rebuild()

    reply = await library.purge_preview_library(None, {"cutoff": _cutoff(100)}, None, "sid")

    assert reply["success"] is True
    assert reply["data"]["items"] == 6
    assert set(reply["data"]["categories"]) == {
        "observation",
        "decoded_folder",
        "recording",
        "snapshot",
        "decoded",
        "audio",
        "transcription",
    }

    bad = await library.purge_preview_library(None, {"cutoff": "nope"}, None, "sid")
    assert bad["success"] is False


@pytest.mark.asyncio
async def test_purge_command_streams_progress_and_done_events(inventory, monkeypatch):
    monkeypatch.setattr(library, "get_inventory", lambda: inventory)
    _backdate(inventory.roots.data, 400)
    inventory.rebuild()

    class FakeSio:
        def __init__(self):
            self.events = []

        async def emit(self, event, payload, room=None):
            self.events.append((event, payload))

    sio = FakeSio()
    reply = await library.purge_library(
        sio, {"cutoff": _cutoff(100)}, logging.getLogger(__name__), "sid"
    )
    assert reply == {"success": True, "data": {"started": True}}

    # The purge task runs asynchronously; wait for its terminal event.
    for _ in range(200):
        if any(event == "library_purge_done" for event, _payload in sio.events):
            break
        await asyncio.sleep(0.01)

    done = next(payload for event, payload in sio.events if event == "library_purge_done")
    assert done["success"] is True
    assert done["deleted"] == 6
    assert any(event == "library.changed" for event, _payload in sio.events)
    assert not inventory.purge_preview(_cutoff(100))["items"]

    # The concurrency guard releases so a second purge can start.
    second = await library.purge_library(
        sio, {"cutoff": _cutoff(100)}, logging.getLogger(__name__), "sid"
    )
    assert second["success"] is True
    for _ in range(200):
        done_events = [payload for event, payload in sio.events if event == "library_purge_done"]
        if len(done_events) >= 2:
            break
        await asyncio.sleep(0.01)
    assert len(done_events) >= 2 and done_events[-1]["deleted"] == 0
