"""Meshtastic capture grouping, browsing and recoverable migration."""

import hashlib
import json
import tarfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from common.meshstorage import WINDOW_SECONDS, MeshStorage
from library.inventory import LibraryInventory
from telemetry import reparse
from telemetry.context import ParseContext
from tests.testmeshtastic import NODEINFO, POSITION, PRIVATE, parse
from tests.testtelemetryflow import decoder
from tools.migratemesh import migrate_mesh

pytestmark = pytest.mark.unit
STAMP = 1793655209.0


def saved(root, name, packet=POSITION, timestamp=STAMP, legacy=False):
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"{name}.bin"
    path.write_bytes(packet)
    result = parse(packet)
    if legacy:
        result = {"protocol": "lora", "telemetry": {"format": "raw"}}
    metadata = {
        "packet": {"timestamp": timestamp},
        "decoder": {"type": "lora"},
        "decoder_config": {"framing": "lora", "sync_word": [0x2B]},
        "file": {"binary": path.name, "binary_path": str(path)},
        "telemetry": result,
    }
    path.with_suffix(".json").write_text(json.dumps(metadata))
    return path, metadata


def test_shared_fixed_windows_and_path_validation(tmp_path):
    first = MeshStorage(tmp_path).directory("!2008e299", STAMP)
    assert first.parent.name == "meshtastic_2008e299"
    assert first.name.endswith(".gsmesh")
    with ThreadPoolExecutor(max_workers=4) as pool:
        paths = list(
            pool.map(lambda i: MeshStorage(tmp_path).directory("!2008e299", STAMP + i), range(4))
        )
    assert set(paths) == {first}
    assert MeshStorage(tmp_path).directory("!2008e299", STAMP - 1) == first
    assert MeshStorage(tmp_path).directory("!2008e299", STAMP + WINDOW_SECONDS - 1) == first
    assert MeshStorage(tmp_path).directory("!2008e299", STAMP + WINDOW_SECONDS) != first
    with pytest.raises(ValueError):
        MeshStorage(tmp_path).directory("../../outside", STAMP)
    outside = tmp_path.parent / f"{tmp_path.name}-outside"
    outside.mkdir()
    (tmp_path / "meshtastic_deadbeef").symlink_to(outside, target_is_directory=True)
    with pytest.raises(ValueError):
        MeshStorage(tmp_path).directory("!deadbeef", STAMP)


def test_capture_publishes_grouped_paths_and_preserves_binary_before_parsing(tmp_path):
    root = tmp_path / "data" / "decoded"
    root.mkdir(parents=True)
    instance = decoder(root, ParseContext("lora", framing="lora"))
    instance._get_decoder_type = lambda: "lora"
    instance._finalize_packet_storage = lambda path, metadata: str(
        MeshStorage(root).group(Path(path), metadata)
    )
    instance._on_packet_decoded(POSITION)
    output = instance.data_queue.get_nowait()["output"]
    path = Path(output["filepath"])
    assert path.parent.name.endswith(".gsmesh")
    assert path.parent.parent.name == "meshtastic_2008e299"
    assert path.read_bytes() == POSITION
    assert Path(output["metadata_filepath"]) == path.with_suffix(".json")
    metadata = json.loads(path.with_suffix(".json").read_text())
    assert metadata["file"]["binary_path"] == str(path)
    relative = path.relative_to(root).as_posix()
    assert reparse.preview_packet(tmp_path, f"/decoded/{relative}")["telemetry"] == parse(POSITION)


def test_collision_and_encrypted_packets_retain_every_reception(tmp_path):
    storage = MeshStorage(tmp_path)
    first, metadata = saved(tmp_path, "same", PRIVATE)
    target = storage.group(first, metadata)
    first, metadata = saved(tmp_path, "same", PRIVATE)
    other = storage.group(first, metadata)
    assert other != target
    assert target.read_bytes() == other.read_bytes() == PRIVATE
    assert other.parent.parent.name == "meshtastic_8b19c28c"
    assert metadata["file"]["binary"] == other.name


def test_node_info_keeps_names_when_later_packets_have_no_name(tmp_path):
    storage = MeshStorage(tmp_path)
    path = storage.directory("!bd5029dc", STAMP)
    storage.update_node(path, parse(NODEINFO), STAMP)
    # A later encrypted/text/position packet must not erase the learned name.
    result = parse(NODEINFO)
    result["payload"]["records"][0]["groups"] = []
    storage.update_node(path, result, STAMP + 10)
    node = json.loads((path.parent / "node.json").read_text())
    assert node["long_name"] == "Sv2tca-1"
    assert node["last_received"] == STAMP + 10
    assert node["first_received"] == STAMP


def test_migration_dry_run_backup_bytes_dates_and_idempotency(tmp_path):
    root = tmp_path / "data" / "decoded"
    originals = {}
    for name, packet, stamp in (
        ("position", POSITION, STAMP),
        ("encrypted", PRIVATE, STAMP),
        ("next", POSITION, STAMP + WINDOW_SECONDS),
        ("node", NODEINFO, STAMP),
    ):
        path, _ = saved(root, name, packet, stamp, legacy=True)
        originals[path] = (
            path.read_bytes(),
            path.with_suffix(".json").read_bytes(),
            path.stat().st_mtime_ns,
        )
    unrelated = root / "unrelated.bin"
    unrelated.write_bytes(b"satellite bytes")
    dry = migrate_mesh(tmp_path)
    assert dry["packets"] == 4
    assert dry["nodes"] == 3
    assert not list(root.glob("meshtastic_*"))
    result = migrate_mesh(tmp_path, apply=True)
    assert result["moved"] == 4
    with tarfile.open(result["backup"]) as archive:
        manifest = json.load(archive.extractfile("migration.json"))
        for entry in manifest:
            source, target = Path(entry["source"]), Path(entry["target"])
            binary, metadata, mtime = originals[source]
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
            assert json.loads(target.with_suffix(".json").read_text())["file"][
                "binary_path"
            ] == str(target)
    assert unrelated.read_bytes() == b"satellite bytes"
    assert migrate_mesh(tmp_path, apply=True)["moved"] == 0
    inventory = LibraryInventory(tmp_path)
    summary = inventory.get("decoded_folder:meshtastic_2008e299")
    assert summary["packet_count"] == 2
    assert summary["run_count"] == 2
    assert summary["latest_position"]["latitude"] == 40.6585344
    detail = inventory.detail(summary["id"], page=1, page_size=1)
    assert len(detail["packets"]) == 1
    assert detail["total"] == 2
    assert inventory.detail(summary["id"], run=summary["runs"][0]["name"])["total"] == 1
    assert inventory.resolve_download(
        summary["id"],
        member=Path(detail["packets"][0]["path"]).relative_to(summary["foldername"]).as_posix(),
    ).is_file()
    positions = inventory.query_positions("2026-11-02T00:00:00Z")["positions"]
    assert len(positions) == 2
    assert all(".gsmesh/" in p["file_id"] for p in positions)
    inventory.delete([summary["id"]])
    assert inventory.query_positions("2026-11-02T00:00:00Z")["total"] == 0


def test_migration_excludes_active_bundles_and_groups_completed_observations(tmp_path):
    for name, active in (("active", True), ("complete", False)):
        bundle = tmp_path / "data" / "observations" / f"{name}.gsobs"
        saved(bundle / "decoded", "packet")
        (bundle / "manifest.json").write_text(json.dumps({"in_progress": active}))
    result = migrate_mesh(tmp_path, apply=True)
    assert result["moved"] == 1
    assert (tmp_path / "data/observations/active.gsobs/decoded/packet.bin").exists()
    assert (
        len(
            list(
                (tmp_path / "data/observations/complete.gsobs/decoded").glob("meshtastic_*/*/*.bin")
            )
        )
        == 1
    )


def test_migration_collision_preflight_and_symlinks_keep_originals(tmp_path):
    root = tmp_path / "data" / "decoded"
    packet, _ = saved(root, "packet")
    run = MeshStorage(root).directory("!2008e299", STAMP)
    (run / "packet.bin").write_bytes(b"existing capture")
    with pytest.raises(ValueError, match="already exists"):
        migrate_mesh(tmp_path, apply=True)
    assert packet.read_bytes() == POSITION
    assert (run / "packet.bin").read_bytes() == b"existing capture"
    packet.with_suffix(".json").unlink()
    packet.with_suffix(".json").symlink_to(run / "run.json")
    assert migrate_mesh(tmp_path)["packets"] == 0


def test_failed_node_update_restores_pair_and_leaves_a_verified_backup(tmp_path, monkeypatch):
    root = tmp_path / "data" / "decoded"
    packet, _ = saved(root, "packet")
    original_metadata = packet.with_suffix(".json").read_bytes()

    def fail(*_args):
        raise OSError("Simulated disk failure")

    monkeypatch.setattr(MeshStorage, "update_node", fail)
    with pytest.raises(OSError, match="disk failure"):
        migrate_mesh(tmp_path, apply=True)
    assert packet.read_bytes() == POSITION
    assert packet.with_suffix(".json").read_bytes() == original_metadata
    assert not list(root.glob("meshtastic_*/*/*.bin"))
    archive_path = next((tmp_path / "data/backups").glob("meshtastic_*.tar.gz"))
    with tarfile.open(archive_path) as archive:
        assert archive.extractfile("data/decoded/packet.bin").read() == POSITION
