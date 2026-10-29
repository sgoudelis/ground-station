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

"""Library search uses cached, explicit metadata across artifact categories."""

import base64
import json
import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from handlers.entities import library
from handlers.entities.filebrowser import delete_snapshot_file
from library import inventory as inventorymodule
from library.inventory import LibraryInventory
from server.snapshots import save_waterfall_snapshot


def _write(path: Path, content: str = "artifact") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


@pytest.fixture
def catalogue(tmp_path):
    backend = tmp_path / "private-storage-root"
    data = backend / "data"
    satellite = {"name": "ISS (ZARYA)", "norad_id": 25544}
    target = {"target_satellite_name": satellite["name"], "target_satellite_norad_id": "25544"}
    _write(data / "recordings" / "capture.sigmf-data")
    _write(
        data / "recordings" / "capture.sigmf-meta",
        json.dumps({"global": {f"gs:{key}": value for key, value in target.items()}}),
    )
    _write(data / "snapshots" / "waterfall.png")
    _write(data / "snapshots" / "waterfall.json", json.dumps(target))
    _write(data / "decoded" / "packet.bin")
    _write(
        data / "decoded" / "packet.json",
        json.dumps(
            {
                "satellite": satellite,
                "decoder": {"type": "aprs", "session_id": "session-1"},
                "decoder_config": {"payload_protocol": "ax25"},
                "ax25": {"from_callsign": "N0CALL-7", "to_callsign": "APRS"},
                "transmitter": {"description": "Packet downlink", "mode": "AFSK"},
                "packet": {"hex": "deadbeef"},
                "telemetry": {"text": "secret-payload"},
            }
        ),
    )
    _write(data / "audio" / "voice.wav")
    _write(data / "audio" / "voice.json", json.dumps({**target, "demodulator_type": "NFM"}))
    _write(
        data / "transcriptions" / "words.txt",
        "# Provider: whisper\n# Session: session-1\n"
        "# Satellite: ISS (ZARYA) (NORAD: 25544)\n"
        "# Transmitter: Voice downlink\n# Transmitter Mode: FM\n"
        "# Language: en\n# Translate To: el\n\nsecret-transcript\n",
    )
    _write(
        data / "observations" / "pass.gsobs" / "manifest.json",
        json.dumps({"satellite": satellite}),
    )
    _write(data / "observations" / "pass.gsobs" / "decoded" / "unique-beacon.bin")
    _write(data / "observations" / "pass.gsobs" / "decoded" / "second.bin")
    _write(data / "observations" / "pass.gsobs" / "thumbnails" / "hidden-preview.jpg")
    _write(
        data / "decoded" / "weather.satdump_meteor_lrpt" / "dataset.json",
        json.dumps({"satellite": satellite["name"], "norad_id": 25544}),
    )
    _write(data / "decoded" / "weather.satdump_meteor_lrpt" / "products" / "unique-image.png")
    result = LibraryInventory(backend)
    result.rebuild()
    return result


def _ids(result):
    return {item["id"] for item in result["items"]}


@pytest.mark.parametrize("search", ["25544", "  iSs   zArYa  "])
def test_satellite_search_covers_every_category_without_reading_files(
    catalogue, monkeypatch, search
):
    def unexpected_read(*_args, **_kwargs):
        pytest.fail("A search must use cached metadata")

    monkeypatch.setattr(catalogue, "rebuild", unexpected_read)
    monkeypatch.setattr(inventorymodule, "_read_json", unexpected_read)
    monkeypatch.setattr(Path, "open", unexpected_read)
    result = catalogue.query(search=search)
    assert result["total"] == 7
    assert {item["satellite_norad_id"] for item in result["items"]} == {25544, "25544"}
    assert all(not key.startswith("_") for item in result["items"] for key in item)


@pytest.mark.parametrize(
    ("search", "expected"),
    [
        ("capture.sigmf-data", "recording:capture"),
        ("capture.sigmf-meta", "recording:capture"),
        ("ISS APRS ax25 n0call-7", "decoded:packet.bin"),
        ("APRS packet downlink", "decoded:packet.bin"),
        ("ISS NFM", "audio:voice.wav"),
        ("ISS whisper en", "transcription:words.txt"),
        ("voice downlink FM", "transcription:words.txt"),
        ("ISS meteor_lrpt", "decoded_folder:weather.satdump_meteor_lrpt"),
        ("25544 waterfall.png", "snapshot:waterfall.png"),
    ],
)
def test_search_matches_words_across_filename_and_metadata(catalogue, search, expected):
    assert _ids(catalogue.query(search=search)) == {expected}


@pytest.mark.parametrize(
    "search",
    ["secret-transcript", "secret-payload", "deadbeef", "private-storage-root", "nonexistent"],
)
def test_payloads_transcript_bodies_and_internal_paths_are_not_searchable(catalogue, search):
    assert catalogue.query(search=search)["total"] == 0


def test_search_combines_with_type_filters_and_counts_before_paging(catalogue):
    result = catalogue.query(search="ISS", sort_by="name", sort_order="asc", page=99, page_size=2)
    assert result["total"] == 7
    assert result["page"] == 4
    assert len(result["items"]) == 1
    assert result["has_more"] is False

    filters = {
        "showRecordings": False,
        "showSnapshots": False,
        "showDecoded": True,
        "showObservations": False,
        "showAudio": False,
        "showTranscriptions": False,
    }
    assert _ids(catalogue.query(search="ISS", filters=filters)) == {
        "decoded:packet.bin",
        "decoded_folder:weather.satdump_meteor_lrpt",
    }
    assert catalogue.query(search="unique-beacon", filters=filters)["total"] == 0
    filters["showDecoded"] = False
    assert catalogue.query(search="ISS", filters=filters)["total"] == 0


@pytest.mark.parametrize(
    ("search", "parent", "member"),
    [
        ("ISS unique-beacon.bin", "observation:pass.gsobs", "decoded/unique-beacon.bin"),
        (
            "25544 unique-image.png",
            "decoded_folder:weather.satdump_meteor_lrpt",
            "products/unique-image.png",
        ),
    ],
)
def test_contained_filenames_return_the_parent_and_a_hint(catalogue, search, parent, member):
    result = catalogue.query(search=search)
    assert _ids(result) == {parent}
    assert result["items"][0]["matched_files"] == [member]
    assert "matched_files" not in catalogue.get(parent)
    assert all("matched_files" not in item for item in catalogue.query()["items"])


def test_folder_matching_does_not_combine_unrelated_children_or_expose_previews(catalogue):
    for search in ("unique-beacon second.bin", "manifest.json", "hidden-preview"):
        assert catalogue.query(search=search)["total"] == 0
    for number in range(8):
        _write(catalogue.roots.observations / "pass.gsobs" / "decoded" / f"shared-{number}.bin")
    catalogue.rebuild()
    item = catalogue.query(search="shared-")["items"][0]
    assert item["matched_files"] == [f"decoded/shared-{number}.bin" for number in range(3)]


def test_missing_metadata_and_terrestrial_callsigns_keep_their_identity(catalogue):
    _write(catalogue.roots.decoded / "terrestrial.bin")
    _write(
        catalogue.roots.decoded / "terrestrial.json",
        json.dumps(
            {"decoder": {"type": "APRS"}, "ax25": {"from_callsign": "W1AW-3"}, "satellite": None}
        ),
    )
    _write(catalogue.roots.decoded / "legacy.bin")
    _write(catalogue.roots.decoded / "legacy.json", "invalid-json")
    _write(
        catalogue.roots.transcriptions / "untagged.txt", "# Satellite: Unknown (NORAD: N/A)\n\ntext"
    )
    catalogue.rebuild()
    station = catalogue.query(search="W1AW-3")["items"][0]
    assert station["satellite_name"] is None
    assert station["satellite_norad_id"] is None
    assert catalogue.query(search="legacy.bin")["total"] == 1
    assert catalogue.query(search="Unknown")["total"] == 0


@pytest.mark.asyncio
async def test_query_rpc_forwards_search_and_rejects_invalid_queries(catalogue, monkeypatch):
    monkeypatch.setattr(library, "get_inventory", lambda: catalogue)
    result = await library.query_library(None, {"search": "n0call-7"}, None, "client")
    assert result["success"] is True
    assert _ids(result["data"]) == {"decoded:packet.bin"}
    for search in ({"bad": "input"}, 25544, "x" * 513):
        result = await library.query_library(None, {"search": search}, None, "client")
        assert result["success"] is False
        assert "search" in result["error"]

    # Unicode case folding can expand the text; validate the original length
    # rather than rejecting a valid query on its second trip through validation.
    result = await library.query_library(None, {"search": "ß" * 512}, None, "client")
    assert result["success"] is True


@pytest.mark.parametrize("search", [None, "", " \t\n "])
def test_empty_search_preserves_the_existing_listing(catalogue, search):
    assert catalogue.query(search=search) == catalogue.query()


def test_saved_snapshot_context_is_searchable_and_deleted_with_the_image(catalogue):
    result = save_waterfall_snapshot(
        "data:image/png;base64," + base64.b64encode(b"snapshot").decode(),
        snapshot_name="newcapture",
        snapshots_root=catalogue.roots.snapshots,
        metadata={
            "target_satellite_name": "UMKA",
            "target_satellite_norad_id": 57172,
            "ignored": "secret",
        },
    )
    assert result["success"] is True
    path = Path(result["snapshot_path"])
    assert "ignored" not in json.loads(path.with_suffix(".json").read_text())
    catalogue.rebuild()
    item = catalogue.query(search="57172")["items"][0]
    assert item["file_count"] == 2
    assert item["purge_bytes"] == path.stat().st_size + path.with_suffix(".json").stat().st_size
    assert catalogue.delete([item["id"]])["results"][0]["success"] is True
    assert not path.exists()
    assert not path.with_suffix(".json").exists()


def test_legacy_snapshot_delete_removes_search_metadata(catalogue):
    assert delete_snapshot_file(
        catalogue.roots.snapshots, "waterfall.png", logging.getLogger(__name__)
    )
    assert not (catalogue.roots.snapshots / "waterfall.json").exists()


def test_snapshot_purge_counts_and_rechecks_its_metadata(catalogue):
    path = catalogue.roots.snapshots / "waterfall.png"
    metadata_path = path.with_suffix(".json")
    old = datetime.now(timezone.utc) - timedelta(days=400)
    cutoff = datetime.now(timezone.utc) - timedelta(days=100)
    for owned in (path, metadata_path):
        os.utime(owned, (old.timestamp(), old.timestamp()))
    catalogue.rebuild()
    preview = catalogue.purge_preview(cutoff.isoformat())
    assert preview["categories"]["snapshot"]["files"] == 2

    # A metadata file changed after the preview must protect its snapshot too.
    os.utime(metadata_path, None)
    item = catalogue._items["snapshot:waterfall.png"]
    assert catalogue._purge_item_is_eligible(item, cutoff) is False
    os.utime(metadata_path, (old.timestamp(), old.timestamp()))
    catalogue.purge(cutoff.isoformat())
    assert not path.exists()
    assert not metadata_path.exists()
