# Copyright (c) 2026 Efstratios Goudelis

"""Capture chronology must survive transfers that reset filesystem timestamps."""

import base64
import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path

import pytest

from common.artifactdates import artifact_dates, parse_artifact_time
from handlers.entities.filebrowser import (
    build_observation_bundle_item,
    parse_transcription_metadata,
)
from library.inventory import LibraryInventory
from server.snapshots import save_waterfall_snapshot

pytestmark = pytest.mark.unit


def write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(content) if isinstance(content, dict) else content)


@pytest.mark.parametrize(
    "kind,metadata,start,end",
    [
        (
            "observation",
            {"created_at": "2026-01-01T03:00:00+03:00", "finalized_at": "2026-01-01T00:10:00Z"},
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:10:00Z",
        ),
        (
            "recording",
            {"start_time": "invalid", "capture_time": "2026-01-01T00:00:00Z"},
            "2026-01-01T00:00:00Z",
            None,
        ),
        (
            "audio",
            {"start_time": "2026-01-01T00:00:00Z", "end_time": "2026-01-01T00:02:00Z"},
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:02:00Z",
        ),
        ("decoded", {"packet": {"timestamp": 0}}, "1970-01-01T00:00:00Z", None),
        (
            "decoded",
            {"image": {"timestamp": "bad", "timestamp_iso": "2026-01-01T02:00:00+0200"}},
            "2026-01-01T00:00:00Z",
            None,
        ),
        ("decoded_folder", {"timestamp": 0}, "1970-01-01T00:00:00Z", None),
        (
            "transcription",
            {"started": "2026-01-01T00:00:00Z", "ended": "2026-01-01T00:01:00Z"},
            "2026-01-01T00:00:00Z",
            "2026-01-01T00:01:00Z",
        ),
        ("snapshot", {"captured_at": "2026-01-01T00:00:00Z"}, "2026-01-01T00:00:00Z", None),
    ],
)
def test_dates_use_valid_portable_metadata(kind, metadata, start, end):
    dates = artifact_dates(kind, Path("unused"), metadata, mtime=123)

    assert parse_artifact_time(dates["captured_at"]) == parse_artifact_time(start)
    assert parse_artifact_time(dates["completed_at"]) == parse_artifact_time(end)
    assert dates["captured_at_source"] == "metadata"


@pytest.mark.parametrize(
    "value", [None, True, {}, [], "bad", "2026-01-01T03:00:00", float("nan"), float("inf"), 10**100]
)
def test_unusable_dates_fall_back_to_mtime_without_guessing_a_timezone(value):
    dates = artifact_dates(
        "audio", Path("voice_20260101_030000.wav"), {"start_time": value}, mtime=123
    )

    assert parse_artifact_time(dates["captured_at"]).timestamp() == 123
    assert dates["captured_at_source"] == "filesystem"
    assert dates["completed_at"] is None


@pytest.mark.parametrize("suffix", ["", "_abc12345", "_abc12345_2"])
def test_missing_bundle_metadata_uses_its_known_utc_filename(suffix):
    dates = artifact_dates("observation", Path(f"ISS_20260907_013625{suffix}.gsobs"), {}, mtime=123)

    assert dates["captured_at"] == "2026-09-07T01:36:25.000000+00:00"
    assert dates["captured_at_source"] == "filename"
    assert dates["completed_at"] is None


def test_scheduled_job_creation_is_not_observation_capture_time():
    dates = artifact_dates(
        "observation",
        Path("unknown.gsobs"),
        {"scheduled_observation": {"created_at": "2020-01-01T00:00:00Z"}},
        mtime=123,
    )
    assert dates["captured_at_source"] == "filesystem"


@pytest.mark.parametrize(
    "kind,metadata",
    [
        ("observation", {"in_progress": True, "finalized_at": "2026-01-01T00:00:00Z"}),
        ("recording", {"recording_in_progress": True, "finalized_time": "2026-01-01T00:00:00Z"}),
        ("audio", {"status": "recording", "end_time": "2026-01-01T00:00:00Z"}),
    ],
)
def test_active_artifacts_do_not_expose_stale_completion_dates(kind, metadata):
    assert artifact_dates(kind, Path("unused"), metadata, mtime=123)["completed_at"] is None


def test_copied_library_keeps_capture_order_and_pagination(tmp_path):
    source = tmp_path / "source"
    data = source / "data"
    write(
        data / "observations/old.gsobs/manifest.json",
        {"created_at": "2020-01-01T00:00:00Z", "finalized_at": "2020-01-01T00:10:00Z"},
    )
    write(data / "observations/old.gsobs/decoded/product.png", "image")
    write(data / "recordings/iq.sigmf-data", "iq")
    write(
        data / "recordings/iq.sigmf-meta",
        {"global": {}, "captures": [{"core:datetime": "2021-01-01T00:00:00Z"}]},
    )
    write(data / "audio/voice.wav", "audio")
    write(data / "audio/voice.json", {"start_time": "2022-01-01T00:00:00Z"})
    write(data / "decoded/beacon.bin", "packet")
    write(data / "decoded/beacon.json", {"packet": {"timestamp_iso": "2023-01-01T00:00:00Z"}})
    write(data / "decoded/sstv.png", "image")
    write(data / "decoded/sstv.json", {"image": {"timestamp_iso": "2024-01-01T00:00:00Z"}})
    write(
        data / "decoded/weather.satdump_lrpt/dataset.json",
        {"timestamp": datetime(2025, 1, 1, tzinfo=timezone.utc).timestamp()},
    )
    write(data / "decoded/weather.satdump_lrpt/product.png", "image")
    write(
        data / "transcriptions/speech.txt",
        "# Started: 2026-01-01T00:00:00Z\n\n"
        + "speech\n" * 5000
        + "\n# Ended: 2026-01-01T00:10:00Z\n",
    )
    write(data / "snapshots/waterfall.png", "image")
    write(data / "snapshots/waterfall.json", {"captured_at": "2027-01-01T00:00:00Z"})
    for path in data.rglob("*"):
        if path.is_file():
            os.utime(path, (123, 123))

    destination = tmp_path / "destination"
    # copyfile deliberately drops file mtimes, as many ordinary transfers do.
    shutil.copytree(source, destination, copy_function=shutil.copyfile)
    original = LibraryInventory(source)
    copied = LibraryInventory(destination)
    expected = [
        "snapshot:waterfall.png",
        "transcription:speech.txt",
        "decoded_folder:weather.satdump_lrpt",
        "decoded:sstv.png",
        "decoded:beacon.bin",
        "audio:voice.wav",
        "recording:iq",
        "observation:old.gsobs",
    ]
    assert [item["id"] for item in original.query()["items"]] == expected
    assert [item["id"] for item in copied.query()["items"]] == expected
    pages = [copied.query(page=page, page_size=2) for page in range(1, 5)]
    assert [item["id"] for page in pages for item in page["items"]] == expected
    for item_id in expected:
        before = original.get(item_id)
        after = copied.get(item_id)
        assert before["captured_at"] == after["captured_at"]
        assert before["completed_at"] == after["completed_at"]
        assert after["captured_at_source"] == "metadata"
    assert original.get("recording:iq")["modified"] != copied.get("recording:iq")["modified"]


@pytest.mark.parametrize("order", ["asc", "desc"])
def test_completion_sort_keeps_unknown_dates_last_and_equal_dates_stable(tmp_path, order):
    for name in ("b", "a", "unknown"):
        write(tmp_path / f"data/audio/{name}.wav", "audio")
        write(
            tmp_path / f"data/audio/{name}.json",
            {
                "start_time": "2026-01-01T00:00:00Z",
                "end_time": None if name == "unknown" else "2026-01-01T01:00:00Z",
            },
        )
    inventory = LibraryInventory(tmp_path)
    ids = [
        item["id"] for item in inventory.query(sort_by="completed_at", sort_order=order)["items"]
    ]
    assert ids == ["audio:a.wav", "audio:b.wav", "audio:unknown.wav"]


def test_bundle_detail_and_legacy_payloads_use_the_same_recording_dates(tmp_path):
    folder = tmp_path / "data/observations/ISS_20260101_000000.gsobs"
    write(folder / "manifest.json", {"created_at": "2026-01-01T00:00:00Z"})
    write(folder / "recordings/iq.sigmf-data", "iq")
    write(
        folder / "recordings/iq.sigmf-meta",
        {
            "global": {
                "gs:start_time": "2026-01-01T00:01:00Z",
                "gs:finalized_time": "2026-01-01T00:02:00Z",
            }
        },
    )
    detail = LibraryInventory(tmp_path).detail(f"observation:{folder.name}")
    legacy = build_observation_bundle_item(folder)
    for key in ("captured_at", "completed_at", "captured_at_source"):
        assert detail[key] == legacy[key]
        assert detail["recordings"][0][key] == legacy["recordings"][0][key]
    assert detail["recordings"][0]["captured_at"] == "2026-01-01T00:01:00.000000+00:00"


def test_transcription_completion_comes_from_footer(tmp_path):
    path = tmp_path / "speech.txt"
    write(
        path,
        "# Started: 2026-01-01T00:00:00Z\n\n"
        + "speech\n" * 5000
        + "# Ended: 2026-01-01T00:02:00Z\n",
    )
    metadata = parse_transcription_metadata(str(path))
    assert metadata["ended"] == "2026-01-01T00:02:00Z"


@pytest.mark.parametrize(
    "directory,folder_name,metadata_file,metadata",
    [
        ("observations", "old.gsobs", "manifest.json", {"created_at": "2020-01-01T00:00:00Z"}),
        ("decoded", "old.satdump_lrpt", "dataset.json", {"timestamp": 1577836800}),
    ],
)
def test_folder_modification_tracks_nested_content_instead_of_directory_churn(
    tmp_path, directory, folder_name, metadata_file, metadata
):
    folder = tmp_path / "data" / directory / folder_name
    write(folder / metadata_file, metadata)
    write(folder / "products/image.png", "image")
    os.utime(folder / metadata_file, (100, 100))
    os.utime(folder / "products/image.png", (200, 200))
    os.utime(folder, (300, 300))
    inventory = LibraryInventory(tmp_path)
    item = inventory.query()["items"][0]
    assert parse_artifact_time(item["modified"]).timestamp() == 200
    assert item["captured_at"] == "2020-01-01T00:00:00.000000+00:00"
    os.utime(folder, (400, 400))
    inventory.rebuild()
    assert inventory.query()["items"][0]["modified"] == item["modified"]


def test_snapshot_capture_time_survives_copy_without_satellite_context(tmp_path):
    result = save_waterfall_snapshot(
        "data:image/png;base64," + base64.b64encode(b"image").decode(),
        snapshots_root=tmp_path / "source",
    )
    assert result["success"]
    source = Path(result["snapshot_path"])
    destination = tmp_path / "copy" / source.name
    destination.parent.mkdir()
    shutil.copyfile(source, destination)
    shutil.copyfile(source.with_suffix(".json"), destination.with_suffix(".json"))
    dates = artifact_dates("snapshot", destination)
    assert dates["captured_at_source"] == "metadata"
    assert parse_artifact_time(dates["captured_at"]) == parse_artifact_time(
        json.loads(source.with_suffix(".json").read_text())["captured_at"]
    )
