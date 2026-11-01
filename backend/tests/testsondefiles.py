"""Sonde/run storage and the browser/map lifecycle use the same nested paths."""

import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier
from unittest.mock import AsyncMock

import pytest

from common.sondestorage import RUN_SUFFIX, RUN_WINDOW_SECONDS, SondeStorage
from handlers.entities import filebrowser, library
from library.inventory import LibraryInventory
from tools.migratesondes import migrate_sondes, upgrade_run_suffixes

pytestmark = pytest.mark.unit


def save(
    root, relative, *, serial="TEST0042", timestamp=1793530800, frame=42, session="receiver", vfo=1
):
    packet = root / "data" / "decoded" / relative
    packet.parent.mkdir(parents=True, exist_ok=True)
    packet.write_bytes(b"sonde packet")
    report = {"type": "RS41", "id": serial, "frame": frame, "lat": 40.5, "lon": 23.1, "alt": 1000}
    metadata = {
        "decoder": {"type": "radiosonde", "session_id": session},
        "vfo": {"id": vfo},
        "packet": {"timestamp": timestamp},
        "parse_context": {"protocol": "radiosonde", "decoder_report": report},
        "telemetry": {
            "parser_id": "radiosonde_rs",
            "schema_version": 1,
            "success": True,
            "payload": {"records": [{"groups": [{"values": report}]}]},
        },
        "file": {"binary": packet.name, "binary_path": str(packet)},
    }
    packet.with_suffix(".json").write_text(json.dumps(metadata))
    return packet


def test_runs_survive_midnight_reacquisition_and_worker_restart(tmp_path):
    storage = SondeStorage(str(tmp_path), "receiver", 1)
    # 2026-11-01 23:59 UTC: the date boundary must not split a run.
    stamp = 1793577540.0
    first = storage.packet_directory("RS41", "TEST0042", stamp)
    assert first.parent.name == "radiosonde_RS41_TEST0042"
    assert first.name == "20261101T235900.000000Z.gssonde"
    assert storage.packet_directory("RS41", "TEST0042", stamp + 120) == first
    # Folder churn is unrelated to the immutable window start.
    os.utime(first, (1, 1))
    restarted = SondeStorage(str(tmp_path), "another-browser", 2)
    assert restarted.packet_directory("RS41", "TEST0042", stamp + 180) == first
    assert restarted.packet_directory("RS41", "TEST0042", stamp + 11 * 3600) == first
    assert storage.packet_directory("RS41", "TEST0042", stamp + RUN_WINDOW_SECONDS - 1) == first
    second = restarted.packet_directory("RS41", "TEST0042", stamp + RUN_WINDOW_SECONDS)
    assert second != first
    # An old worker must discover a flight already opened by another receiver.
    assert storage.packet_directory("RS41", "TEST0042", stamp + RUN_WINDOW_SECONDS + 1) == second
    assert (
        SondeStorage(str(tmp_path), "reconnected", 3).packet_directory(
            "RS41", "TEST0042", stamp + RUN_WINDOW_SECONDS + 2
        )
        == second
    )
    assert storage.packet_directory("DFM", "TEST0042", stamp).parent != first.parent
    assert storage.packet_directory("RS41", "OTHER", stamp).parent != first.parent


def test_serial_is_sanitized_and_storage_refuses_symlink_escape(tmp_path):
    storage = SondeStorage(str(tmp_path), "receiver", 1)
    path = storage.packet_directory("RS41", "../../unsafe\\serial", 1793530800)
    assert path.is_relative_to(tmp_path)
    outside = tmp_path.parent / "outside"
    outside.mkdir(exist_ok=True)
    (tmp_path / "radiosonde_RS41_ESCAPE").symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError, match="outside"):
        storage.packet_directory("RS41", "ESCAPE", 1793530800)


def test_simultaneous_receivers_share_one_window(tmp_path):
    barrier = Barrier(8)

    def receive(index):
        storage = SondeStorage(str(tmp_path), f"browser{index}", index)
        barrier.wait()
        return storage.packet_directory("RS41", "TEST0042", 1793530800)

    with ThreadPoolExecutor(max_workers=8) as workers:
        directories = list(workers.map(receive, range(8)))
    assert len(set(directories)) == 1
    assert len(list((tmp_path / "radiosonde_RS41_TEST0042").iterdir())) == 1


@pytest.mark.parametrize("marker", [None, "{}", '{"started_at":"20261101T110000Z.gssonde"}'])
def test_restart_recovers_legacy_start_without_directory_mtime(tmp_path, marker):
    run = tmp_path / "radiosonde_RS41_TEST0042/20261101T110000Z.gssonde"
    run.mkdir(parents=True)
    if marker is not None:
        (run / "run.json").write_text(marker)
    os.utime(run, (1, 1))
    storage = SondeStorage(str(tmp_path), "new-browser", 2)
    assert storage.packet_directory("RS41", "TEST0042", 1793530800 + 11 * 3600) == run
    assert storage.packet_directory("RS41", "TEST0042", 1793530800 + RUN_WINDOW_SECONDS) != run


def test_inventory_groups_runs_pages_packets_and_keeps_all_map_positions(tmp_path):
    folder = "radiosonde_RS41_TEST0042"
    for number in range(55):
        run = "20261101T110000Z.gssonde" if number < 52 else "20261102T110000Z"
        save(
            tmp_path,
            f"{folder}/{run}/packet{number:03}.bin",
            timestamp=1793530800 + number,
            frame=number,
        )
    # Malformed optional metadata must not take the entire inventory down.
    corrupt = save(tmp_path, f"{folder}/legacy.bin", timestamp=1793530000)
    corrupt.with_suffix(".json").write_text('{"telemetry": "broken"}')
    save(tmp_path, "oldflat.bin", serial="OLD")
    inventory = LibraryInventory(tmp_path)
    result = inventory.query()
    assert result["total"] == 2
    item_id = f"decoded_folder:{folder}"
    summary = inventory.get(item_id)
    assert summary["name"] == "RS41 TEST0042"
    assert summary["packet_count"] == 56
    assert summary["run_count"] == 3
    assert summary["file_count"] == 112
    assert "packets" not in summary
    assert summary["download_url"] == f"/api/decoded/{folder}/download"
    detail = inventory.detail(item_id, page_size=10)
    assert len(detail["packets"]) == 10
    assert detail["total"] == 56
    filtered = inventory.detail(item_id, page=999, page_size=10, run="20261101T110000Z.gssonde")
    assert filtered["page"] == 6
    assert len(filtered["packets"]) == 2
    assert filtered["total"] == 52
    assert inventory.resolve_download(
        item_id, member="20261101T110000Z.gssonde/packet000.bin"
    ).is_file()
    assert inventory.resolve_download(item_id, member="../oldflat.bin") is None
    assert inventory.query(search="TEST0042")["total"] == 1
    assert inventory.query(search="packet001")["items"][0]["matched_files"] == [
        "20261101T110000Z.gssonde/packet001.bin"
    ]
    assert inventory.query(filters={"showDecoded": False})["total"] == 0
    points = inventory.query_positions("2026-11-01T00:00:00Z")
    assert len(points["positions"]) == 56  # 55 grouped packets plus the flat capture.
    assert any(
        f"{folder}/20261101T110000Z.gssonde/" in point["file_id"] for point in points["positions"]
    )
    assert inventory.delete([item_id])["results"][0]["success"]
    assert not (tmp_path / "data/decoded" / folder).exists()
    assert inventory.query_positions("2026-11-01T00:00:00Z")["total"] == 1


def test_purge_uses_newest_owned_content_across_runs(tmp_path):
    folder = "radiosonde_RS41_TEST0042"
    packet = save(tmp_path, f"{folder}/old/old.bin")
    for path in (packet, packet.with_suffix(".json")):
        os.utime(path, (1000, 1000))
    inventory = LibraryInventory(tmp_path)
    preview = inventory.purge_preview("2026-01-01T00:00:00Z")
    assert preview["categories"]["decoded_folder"]["items"] == 1
    save(tmp_path, f"{folder}/new/new.bin")
    for path in (tmp_path / f"data/decoded/{folder}/new").iterdir():
        os.utime(path, (1893456000, 1893456000))
    # Rechecking owned files protects newly arrived packets even before rebuild.
    assert not inventory._purge_item_is_eligible(
        inventory._items[f"decoded_folder:{folder}"], library._parse_cutoff("2026-01-01T00:00:00Z")
    )


@pytest.mark.parametrize("observation", [False, True])
async def test_nested_delete_removes_only_the_selected_packet_pair(
    tmp_path, monkeypatch, observation
):
    relative = "radiosonde_RS41_TEST0042/run/packet.bin"
    packet = save(tmp_path, relative)
    url = f"/decoded/{relative}"
    if observation:
        destination = tmp_path / f"data/observations/sonde.gsobs/decoded/{relative}"
        destination.parent.mkdir(parents=True)
        packet.with_suffix(".json").rename(destination.with_suffix(".json"))
        packet.rename(destination)
        packet = destination
        url = f"/observations/sonde.gsobs/decoded/{relative}"
    other = save(tmp_path, "radiosonde_RS41_OTHER/run/packet.bin", serial="OTHER")
    monkeypatch.setattr(filebrowser, "__file__", str(tmp_path / "handlers/entities/filebrowser.py"))
    monkeypatch.setattr(filebrowser, "get_inventory", lambda: LibraryInventory(tmp_path))
    sio = AsyncMock()
    await filebrowser.filebrowser_request_routing(
        sio, "delete-decoded", {"url": url}, logging.getLogger(__name__), "sid"
    )
    assert not packet.exists()
    assert not packet.with_suffix(".json").exists()
    assert other.is_file()
    assert other.with_suffix(".json").is_file()
    events = [call.args for call in sio.emit.call_args_list]
    assert any(args[0] == "file_browser_state" and args[1].get("url") == url for args in events)


async def test_packet_paging_rpc_validates_parameters(tmp_path, monkeypatch):
    save(tmp_path, "radiosonde_RS41_TEST0042/run/packet.bin")
    monkeypatch.setattr(library, "get_inventory", lambda: LibraryInventory(tmp_path))
    logger = logging.getLogger(__name__)
    result = await library.get_library_item(
        None,
        {
            "id": "decoded_folder:radiosonde_RS41_TEST0042",
            "page": 1,
            "pageSize": 1,
            "run": "run",
        },
        logger,
        "sid",
    )
    assert result["success"]
    assert len(result["data"]["packets"]) == 1
    for invalid in ({"pageSize": "bad"}, {"run": ["run"]}):
        result = await library.get_library_item(None, {"id": "folder", **invalid}, logger, "sid")
        assert not result["success"]


def test_migration_is_dry_by_default_preserves_captures_and_splits_runs(tmp_path):
    first = save(tmp_path, "first.bin")
    second = save(
        tmp_path, "second.bin", timestamp=1793530800 + 11 * 3600, session="reconnected", vfo=2
    )
    third = save(tmp_path, "third.bin", timestamp=1793530800 + RUN_WINDOW_SECONDS)
    os.utime(first, ns=(1000000000000, 1000000000000))
    metadata_mtime = first.with_suffix(".json").stat().st_mtime_ns
    plan = migrate_sondes(tmp_path)
    assert len(plan) == 3
    assert all(not row["applied"] for row in plan)
    assert first.exists() and second.exists() and third.exists()
    assert not list((tmp_path / "data/decoded").glob("radiosonde_*"))
    assert Path(plan[0]["target"]).parent == Path(plan[1]["target"]).parent
    assert Path(plan[2]["target"]).parent != Path(plan[0]["target"]).parent
    assert all(Path(row["target"]).parent.name.endswith(RUN_SUFFIX) for row in plan)
    applied = migrate_sondes(tmp_path, apply=True)
    target = Path(applied[0]["target"])
    assert all(row["applied"] for row in applied)
    assert target.read_bytes() == b"sonde packet"
    assert target.stat().st_mtime_ns == 1000000000000
    assert target.with_suffix(".json").stat().st_mtime_ns == metadata_mtime
    assert json.loads(target.with_suffix(".json").read_text())["file"]["binary_path"] == str(target)
    assert not first.exists() and not first.with_suffix(".json").exists()
    assert migrate_sondes(tmp_path, apply=True) == []


def test_run_suffix_upgrade_preserves_boundaries_metadata_and_dates(tmp_path):
    run = "20261101T110000.000000Z"
    packet = save(tmp_path, f"radiosonde_RS41_TEST0042/{run}/packet.bin")
    marker = packet.parent / "run.json"
    marker.write_text(json.dumps({"session_id": "receiver", "vfo": 1}))
    for path in (packet, packet.with_suffix(".json"), marker, packet.parent):
        os.utime(path, ns=(1000000000000, 1000000000000))
    original_metadata = json.loads(packet.with_suffix(".json").read_text())
    plan = upgrade_run_suffixes(tmp_path)
    assert len(plan) == 1 and not plan[0]["applied"]
    target = Path(plan[0]["target"])
    assert target.name == run + RUN_SUFFIX
    assert packet.exists() and not target.exists()
    rows = migrate_sondes(tmp_path, apply=True)
    assert len(rows) == 1 and rows[0]["applied"]
    migrated = target / packet.name
    assert migrated.read_bytes() == b"sonde packet"
    assert not packet.parent.exists()
    for path in (migrated, migrated.with_suffix(".json"), target / "run.json", target):
        assert path.stat().st_mtime_ns == 1000000000000
    original_metadata["file"]["binary_path"] = str(migrated)
    assert json.loads(migrated.with_suffix(".json").read_text()) == original_metadata
    assert migrate_sondes(tmp_path, apply=True) == []
    inventory = LibraryInventory(tmp_path)
    detail = inventory.detail("decoded_folder:radiosonde_RS41_TEST0042")
    assert detail["runs"][0]["name"] == target.name
    assert detail["packets"][0]["url"].endswith(f"{target.name}/packet.bin")
    assert inventory.query_positions("2026-11-01T00:00:00Z")["total"] == 1


def test_run_suffix_upgrade_never_merges_existing_destination(tmp_path):
    packet = save(tmp_path, "radiosonde_RS41_TEST0042/20261101T110000Z/packet.bin")
    (packet.parent / "run.json").write_text("{}")
    destination = packet.parent.with_name(packet.parent.name + RUN_SUFFIX)
    destination.mkdir()
    unrelated = packet.parent.parent / "notes"
    unrelated.mkdir()
    (unrelated / "run.json").write_text("{}")
    rows = upgrade_run_suffixes(tmp_path, apply=True)
    assert len(rows) == 1
    assert rows[0]["error"] == "Destination already exists"
    assert not rows[0]["applied"]
    assert packet.exists()
    assert not list(destination.iterdir())


def test_migration_consolidates_old_runs_and_splits_fixed_windows(tmp_path):
    folder = "radiosonde_RS41_TEST0042"
    stamp = 1793530800
    paths = []
    before = []
    for index, offset in enumerate((0, 60, 5 * 3600, 11 * 3600, RUN_WINDOW_SECONDS)):
        run = f"old{index}.gssonde"
        packet = save(
            tmp_path,
            f"{folder}/{run}/packet{index}.bin",
            timestamp=stamp + offset,
            session=f"browser{index}",
            vfo=index,
            frame=index,
        )
        (packet.parent / "run.json").write_text(json.dumps({"session_id": f"browser{index}"}))
        for path in (packet, packet.with_suffix(".json")):
            path.chmod(0o640)
            os.utime(path, ns=(1000000000000 + index, 2000000000000 + index))
        paths.append(packet)
        before.append(
            (
                packet.read_bytes(),
                json.loads(packet.with_suffix(".json").read_text()),
                packet.stat(),
                packet.with_suffix(".json").stat(),
            )
        )
    plan = migrate_sondes(tmp_path)
    assert len(plan) == 5 and all(not row["applied"] for row in plan)
    assert all(path.exists() for path in paths)
    assert len({Path(row["target"]).parent for row in plan[:4]}) == 1
    assert Path(plan[4]["target"]).parent != Path(plan[0]["target"]).parent
    rows = migrate_sondes(tmp_path, apply=True)
    for row, (binary, metadata, packet_stat, sidecar_stat) in zip(rows, before):
        target = Path(row["target"])
        assert row["applied"] and target.read_bytes() == binary
        metadata["file"]["binary_path"] = str(target)
        assert json.loads(target.with_suffix(".json").read_text()) == metadata
        assert target.stat().st_mtime_ns == packet_stat.st_mtime_ns
        assert target.stat().st_mode == packet_stat.st_mode
        assert target.with_suffix(".json").stat().st_mtime_ns == sidecar_stat.st_mtime_ns
        assert target.with_suffix(".json").stat().st_mode == sidecar_stat.st_mode
    assert not any(path.parent.exists() for path in paths)
    assert migrate_sondes(tmp_path, apply=True) == []
    inventory = LibraryInventory(tmp_path)
    detail = inventory.detail(f"decoded_folder:{folder}")
    assert detail["packet_count"] == 5 and detail["run_count"] == 2
    assert inventory.query_positions("2026-11-01T00:00:00Z")["total"] == 5


def test_regroup_conflicts_leave_every_source_intact(tmp_path):
    folder = "radiosonde_RS41_TEST0042"
    first = save(tmp_path, f"{folder}/one.gssonde/same.bin")
    second = save(tmp_path, f"{folder}/two.gssonde/same.bin", timestamp=1793530860)
    rows = migrate_sondes(tmp_path, apply=True)
    assert any(row.get("error") for row in rows)
    assert all(not row["applied"] for row in rows)
    assert first.is_file() and second.is_file()
