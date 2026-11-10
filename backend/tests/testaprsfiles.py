"""APRS capture identity, history, browsing and recoverable migration contracts."""

import hashlib
import json
import os
import tarfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from common.aprsstorage import WINDOW_SECONDS, AprsStorage, aprs_source
from library.inventory import LibraryInventory
from telemetry import reparse
from telemetry.context import ParseContext
from telemetry.service import parse_packet
from tests.testaprsparser import _ax25_address
from tests.testtelemetryflow import decoder
from tools.migrateaprs import migrate_aprs

pytestmark = pytest.mark.unit
STAMP = 1793692800.0
CONTEXT = ParseContext("ax25", framing="aprs", hdlc_flags=True)


def frame(payload=b"!4903.50N/07201.75W>Station", source="N0CALL", ssid=7):
    return (
        b"\x7e"
        + _ax25_address("APRS")
        + _ax25_address(source, ssid, final=True)
        + b"\x03\xf0"
        + payload
        + b"\x7e"
    )


def saved(root, name, packet=None, timestamp=STAMP, legacy=False):
    root.mkdir(parents=True, exist_ok=True)
    packet = frame() if packet is None else packet
    path = root / f"{name}.bin"
    path.write_bytes(packet)
    metadata = {
        "packet": {"timestamp": timestamp},
        "decoder": {"type": "aprs"},
        "decoder_config": {"framing": "aprs", "payload_protocol": "ax25"},
        "file": {"binary": path.name, "binary_path": str(path)},
        "telemetry": (
            {"protocol": "ax25", "telemetry": {"format": "raw"}}
            if legacy
            else parse_packet(packet, CONTEXT)
        ),
    }
    path.with_suffix(".json").write_text(json.dumps(metadata))
    return path, metadata


def test_fixed_windows_shared_across_receivers_and_ssids(tmp_path):
    first = AprsStorage(tmp_path).directory("N0CALL-7", STAMP)
    assert first.parent.name == "aprs_N0CALL-7"
    assert first.suffix == ".gsaprs"
    with ThreadPoolExecutor(max_workers=4) as pool:
        paths = list(
            pool.map(lambda i: AprsStorage(tmp_path).directory("N0CALL-7", STAMP + i), range(4))
        )
    assert set(paths) == {first}
    assert AprsStorage(tmp_path).directory("N0CALL-7", STAMP - 1) == first
    assert AprsStorage(tmp_path).directory("N0CALL-7", STAMP + WINDOW_SECONDS - 1) == first
    second = AprsStorage(tmp_path).directory("N0CALL-7", STAMP + WINDOW_SECONDS)
    assert second != first
    # A late packet across the boundary belongs to its original window.
    assert AprsStorage(tmp_path).directory("N0CALL-7", STAMP + WINDOW_SECONDS - 2) == first
    assert AprsStorage(tmp_path).directory("N0CALL-0", STAMP).parent != first.parent
    marker = json.loads((first / "run.json").read_text())
    assert marker["window_seconds"] == WINDOW_SECONDS
    for source in ("../../outside", "N0CALL-16", "n0call-7", "CALL", "N0CALL-00"):
        with pytest.raises(ValueError):
            AprsStorage(tmp_path).directory(source, STAMP)
    for stamp in (float("nan"), float("inf"), True):
        with pytest.raises(ValueError):
            AprsStorage(tmp_path).directory("N0CALL-7", stamp)
    outside = tmp_path.parent / f"{tmp_path.name}-outside"
    outside.mkdir()
    (tmp_path / "aprs_OTHER-0").symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError):
        AprsStorage(tmp_path).directory("OTHER-0", STAMP)


def test_capture_groups_by_parsed_payload_and_preserves_every_reception(tmp_path):
    root = tmp_path / "data" / "decoded"
    root.mkdir(parents=True)
    instance = decoder(root, CONTEXT)
    packet = frame()
    # The shared hook also handles APRS received by other AX.25 decoders.
    instance._on_packet_decoded(packet, timestamp=STAMP)
    instance._on_packet_decoded(packet, timestamp=STAMP)
    outputs = [instance.data_queue.get_nowait()["output"] for _ in range(2)]
    paths = [Path(output["filepath"]) for output in outputs]
    assert paths[0] != paths[1]
    for path, output in zip(paths, outputs):
        assert path.parent.parent.name == "aprs_N0CALL-7"
        assert path.read_bytes() == packet
        assert Path(output["metadata_filepath"]) == path.with_suffix(".json")
        metadata = json.loads(path.with_suffix(".json").read_text())
        assert metadata["file"]["binary_path"] == str(path)
        relative = path.relative_to(root).as_posix()
        assert reparse.preview_packet(tmp_path, f"/decoded/{relative}")[
            "telemetry"
        ] == parse_packet(packet, CONTEXT)


@pytest.mark.parametrize(
    "payload", [b"`Mic-E bytes", b">Available", b":OTHER    :ack42", b"T#001,1,2,3,4,5,10101010"]
)
def test_non_position_and_unsupported_payloads_are_grouped(tmp_path, payload):
    path, metadata = saved(tmp_path, "packet", frame(payload))
    assert aprs_source(metadata["telemetry"]) == "N0CALL-7"
    target = AprsStorage(tmp_path).group(path, metadata)
    assert target.parent.parent.name == "aprs_N0CALL-7"
    assert target.read_bytes() == frame(payload)


def test_invalid_envelope_and_unrelated_telemetry_remain_flat(tmp_path):
    packet, metadata = saved(tmp_path, "invalid", b"\x7einvalid packet\x7e")
    assert AprsStorage(tmp_path).group(packet, metadata) == packet
    metadata["telemetry"] = parse_packet(
        frame(), ParseContext("ax25", framing="ax25", hdlc_flags=True)
    )
    assert AprsStorage(tmp_path).group(packet, metadata) == packet


def test_migration_backup_metadata_dates_browser_and_idempotency(tmp_path):
    root = tmp_path / "data" / "decoded"
    originals = {}
    for name, packet, stamp in (
        ("position", frame(), STAMP),
        ("status", frame(b">Available"), STAMP + 1),
        ("mic", frame(b"`Mic-E bytes"), STAMP + 2),
        ("next", frame(), STAMP + WINDOW_SECONDS),
        ("ssid", frame(ssid=0), STAMP),
    ):
        path, _ = saved(root, name, packet, stamp, legacy=True)
        os.chmod(path, 0o640)
        os.chmod(path.with_suffix(".json"), 0o600)
        originals[path] = (
            path.read_bytes(),
            path.with_suffix(".json").read_bytes(),
            path.stat().st_mtime_ns,
            path.with_suffix(".json").stat().st_mtime_ns,
        )
    invalid, _ = saved(root, "invalid", b"\x7ebad\x7e")
    assert migrate_aprs(tmp_path)["packets"] == 5
    assert not list(root.glob("aprs_*"))
    result = migrate_aprs(tmp_path, apply=True)
    assert result["moved"] == 5
    assert result["stations"] == 2
    assert result["skipped_invalid"] == 1
    with tarfile.open(result["backup"]) as archive:
        for entry in json.load(archive.extractfile("migration.json")):
            source, target = Path(entry["source"]), Path(entry["target"])
            binary, metadata, mtime, meta_mtime = originals[source]
            assert archive.extractfile(source.relative_to(tmp_path).as_posix()).read() == binary
            assert (
                archive.extractfile(
                    source.with_suffix(".json").relative_to(tmp_path).as_posix()
                ).read()
                == metadata
            )
            assert not source.exists()
            assert target.read_bytes() == binary
            assert hashlib.sha256(binary).hexdigest() == entry["sha256"]
            assert target.stat().st_mtime_ns == mtime
            assert target.stat().st_mode & 0o777 == 0o640
            assert target.with_suffix(".json").stat().st_mtime_ns == meta_mtime
            assert target.with_suffix(".json").stat().st_mode & 0o777 == 0o600
            updated = json.loads(target.with_suffix(".json").read_text())
            assert updated["file"]["binary_path"] == str(target)
            assert updated["parse_context"] == CONTEXT.to_dict()
    assert invalid.exists()
    assert migrate_aprs(tmp_path, apply=True)["moved"] == 0
    inventory = LibraryInventory(tmp_path)
    summary = inventory.get("decoded_folder:aprs_N0CALL-7")
    assert summary["packet_count"] == 4
    assert summary["run_count"] == 2
    assert summary["latest_position"]["latitude"] == 49.058333
    assert summary["latest"]["status"]["value"] == "Available"
    assert inventory.query(search="APRS N0CALL-7")["total"] == 1
    assert inventory.query(filters={"showDecoded": False})["total"] == 0
    detail = inventory.detail(summary["id"], page=1, page_size=1)
    assert len(detail["packets"]) == 1
    assert detail["total"] == 4
    assert inventory.detail(summary["id"], run=summary["runs"][0]["name"])["total"] == 1
    assert inventory.resolve_download(
        summary["id"],
        member=Path(detail["packets"][0]["path"]).relative_to(summary["foldername"]).as_posix(),
    ).is_file()
    positions = inventory.query_positions("2026-11-03T00:00:00Z")["positions"]
    assert len(positions) == 3
    assert all(".gsaprs/" in p["file_id"] for p in positions)
    inventory.delete([summary["id"]])
    assert inventory.query_positions("2026-11-03T00:00:00Z")["total"] == 1


def test_objects_stay_under_reporting_station_without_changing_station_location(tmp_path):
    root = tmp_path / "data" / "decoded"
    saved(root, "station", frame())
    saved(root, "object", frame(b";TESTOBJ  *031200z4000.00N/02300.00E>Object"), STAMP + 1)
    migrate_aprs(tmp_path, apply=True)
    inventory = LibraryInventory(tmp_path)
    summary = inventory.get("decoded_folder:aprs_N0CALL-7")
    assert summary["packet_count"] == 2
    assert summary["latest_position"]["latitude"] == 49.058333
    transmitters = inventory.query_positions("2026-11-03T00:00:00Z")["transmitters"]
    assert summary["latest"]["comment"]["value"] == "Station"
    assert {item["id"] for item in transmitters} == {"aprs:N0CALL-7", "aprs:N0CALL-7:TESTOBJ"}


def test_station_paths_filter_runs_without_joining_reported_objects_or_items(tmp_path):
    root = tmp_path / "data" / "decoded"
    storage = AprsStorage(root)
    first = storage.directory("N0CALL-7", STAMP)
    second = storage.directory("N0CALL-7", STAMP + WINDOW_SECONDS)
    no_position = storage.directory("N0CALL-7", STAMP + 2 * WINDOW_SECONDS)
    saved(first.parent, "legacy", timestamp=STAMP - 1)
    for index in range(70):
        saved(first, f"station{index}", frame(b"!0000.00N/00000.00E>Station"), STAMP + index)
    saved(first, "status", frame(b">Available"), STAMP + 70)
    saved(first, "object", frame(b";TESTOBJ  *031200z4000.00N/02300.00E>Object"), STAMP + 71)
    saved(first, "item", frame(b")TESTITEM!4000.00N/02300.00E>Item"), STAMP + 72)
    saved(second, "station", timestamp=STAMP + WINDOW_SECONDS)
    saved(no_position, "status", frame(b">Available"), STAMP + 2 * WINDOW_SECONDS)
    inventory = LibraryInventory(tmp_path)
    item_id = "decoded_folder:aprs_N0CALL-7"

    # A full track includes fixes outside the visible history page, while
    # status packets and separately reported entities never become station fixes.
    result = inventory.flight_paths(item_id)
    assert result["point_count"] == result["displayed_points"] == 72
    assert {flight["run"] for flight in result["flights"]} == {"legacy", first.name, second.name}
    detail = inventory.detail(item_id, run=first.name)
    assert len(detail["packets"]) == 50
    assert detail["total"] == 73
    filtered = inventory.flight_paths(item_id, first.name)
    assert filtered["point_count"] == 70
    assert len(filtered["flights"]) == 1
    points = filtered["flights"][0]["segments"][0]
    assert len(points) == 70
    assert all(point["latitude"] == point["longitude"] == 0 for point in points)
    assert inventory.flight_paths(item_id, "legacy")["point_count"] == 1
    assert inventory.flight_paths(item_id, no_position.name)["flights"] == []
    assert inventory.flight_paths(item_id, "missing")["point_count"] == 0

    # Object/item history remains available to the global packet map, and
    # private run grouping must not alter that map's public response format.
    global_map = inventory.query_positions("2026-01-01T00:00:00Z")
    assert global_map["total"] == 74
    assert {entry["id"] for entry in global_map["transmitters"]} == {
        "aprs:N0CALL-7",
        "aprs:N0CALL-7:TESTOBJ",
        "aprs:N0CALL-7:TESTITEM",
    }
    assert all("_run" not in point for point in global_map["positions"])

    saved(second, "new", timestamp=STAMP + WINDOW_SECONDS + 1)
    inventory.rebuild()
    assert inventory.flight_paths(item_id, second.name)["point_count"] == 2
    assert inventory.flight_paths(item_id)["revision"] > result["revision"]
    (first.parent / "legacy.bin").unlink()
    inventory.rebuild()
    assert inventory.flight_paths(item_id, "legacy")["point_count"] == 0


def test_completed_observations_keep_ownership_and_active_bundles_are_skipped(tmp_path):
    for name, active in (("active", True), ("complete", False)):
        bundle = tmp_path / "data" / "observations" / f"{name}.gsobs"
        saved(bundle / "decoded", "packet")
        (bundle / "manifest.json").write_text(json.dumps({"in_progress": active}))
    assert migrate_aprs(tmp_path, apply=True)["moved"] == 1
    assert (tmp_path / "data/observations/active.gsobs/decoded/packet.bin").exists()
    target = next((tmp_path / "data/observations/complete.gsobs/decoded").glob("aprs_*/*/*.bin"))
    url = f"/observations/complete.gsobs/{target.relative_to(tmp_path / 'data/observations/complete.gsobs').as_posix()}"
    assert reparse.preview_packet(tmp_path, url)["telemetry"]["frame"]["source"] == "N0CALL-7"
    inventory = LibraryInventory(tmp_path)
    assert inventory.detail("observation:complete.gsobs")["artifacts"][0]["url"] == url
    assert inventory.query_positions("2026-11-03T00:00:00Z")["total"] == 2


def test_collision_preflight_and_symlinks_preserve_originals(tmp_path):
    root = tmp_path / "data" / "decoded"
    packet, _ = saved(root, "packet")
    directory = AprsStorage(root).directory("N0CALL-7", STAMP)
    (directory / "packet.bin").write_bytes(b"existing capture")
    with pytest.raises(ValueError, match="already exists"):
        migrate_aprs(tmp_path, apply=True)
    assert packet.read_bytes() == frame()
    assert (directory / "packet.bin").read_bytes() == b"existing capture"
    packet.with_suffix(".json").unlink()
    packet.with_suffix(".json").symlink_to(directory / "run.json")
    assert migrate_aprs(tmp_path)["packets"] == 0


def test_failed_destination_write_keeps_original_pair_and_backup(tmp_path, monkeypatch):
    root = tmp_path / "data" / "decoded"
    packet, _ = saved(root, "packet")
    original_metadata = packet.with_suffix(".json").read_bytes()
    original_open = Path.open

    def fail(path, *args, **kwargs):
        if path.suffix == ".json" and path.stem == "packet" and path.parent.suffix == ".gsaprs":
            raise OSError("Simulated disk failure")
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", fail)
    with pytest.raises(OSError, match="disk failure"):
        migrate_aprs(tmp_path, apply=True)
    assert packet.read_bytes() == frame()
    assert packet.with_suffix(".json").read_bytes() == original_metadata
    assert not list(root.glob("aprs_*/*/*.bin"))
    archive_path = next((tmp_path / "data/backups").glob("aprs_*.tar.gz"))
    with tarfile.open(archive_path) as archive:
        assert archive.extractfile("data/decoded/packet.bin").read() == frame()
