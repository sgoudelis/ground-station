"""Group historical Meshtastic packets. Run from backend: python -m tools.migratemesh.

Dry run by default. --apply backs up every original pair and a recovery manifest
before relocating any packets. Pause legacy LoRa reception during migration.
"""

import argparse
import hashlib
import io
import json
import os
import stat
import tarfile
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from common.artifactdates import artifact_dates, parse_artifact_time
from common.meshstorage import RUN_SUFFIX, MeshStorage, mesh_source, select_run
from common.pathguard import ensure_path_in_allowed_roots
from telemetry.context import ParseContext
from telemetry.service import parse_packet


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def migration_plan(backend):
    roots = [backend / "data" / "decoded"]
    for bundle in sorted((backend / "data" / "observations").glob("*.gsobs")):
        if bundle.is_symlink():
            continue
        try:
            marker = json.loads((bundle / "manifest.json").read_text())
            if marker.get("in_progress"):
                continue
        except (OSError, ValueError, AttributeError):
            continue
        roots.append(bundle / "decoded")
    plans, skipped = [], 0
    for root in roots:
        captures = []
        for packet in sorted(root.glob("*.bin")):
            sidecar = packet.with_suffix(".json")
            if any(path.is_symlink() for path in (packet, sidecar, *packet.parents)):
                continue
            try:
                metadata = json.loads(sidecar.read_text())
                if not isinstance(metadata, dict) or not isinstance(metadata.get("file", {}), dict):
                    continue
                result = metadata.get("telemetry") or {}
                if not mesh_source(result):
                    context = ParseContext.from_metadata(metadata)
                    if context.protocol != "lora":
                        continue
                    result = parse_packet(packet.read_bytes(), context)
                source = mesh_source(result)
                if source is None:
                    continue
                captured = parse_artifact_time(
                    artifact_dates("decoded", packet, metadata)["captured_at"]
                )
                if captured is None:
                    continue
                metadata["telemetry"] = result
                captures.append((captured.timestamp(), packet, metadata, source))
            except (OSError, ValueError, TypeError, AttributeError):
                skipped += 1
        planned_runs: dict[str, list[Path]] = {}
        destinations = set()
        for timestamp, packet, metadata, source in sorted(
            captures, key=lambda row: (row[0], str(row[1]))
        ):
            folder = root / f"meshtastic_{source[1:]}"
            candidates = planned_runs.setdefault(source, list(folder.glob(f"*{RUN_SUFFIX}")))
            run = select_run(candidates, timestamp)
            if run is None:
                started = datetime.fromtimestamp(timestamp, timezone.utc)
                run = folder / (started.strftime("%Y%m%dT%H%M%S.%fZ") + RUN_SUFFIX)
                candidates.append(run)
            target = ensure_path_in_allowed_roots(run / packet.name, [root])
            sidecar = packet.with_suffix(".json")
            if target in destinations or target.exists() or target.with_suffix(".json").exists():
                raise ValueError(f"Migration destination already exists: {target}")
            destinations.add(target)
            plans.append(
                {
                    "source": str(packet),
                    "target": str(target),
                    "node_id": source,
                    "timestamp": timestamp,
                    "sha256": digest(packet),
                    "metadata_sha256": digest(sidecar),
                    "_metadata": metadata,
                    "_root": root,
                }
            )
    return plans, skipped


def migrate_mesh(backend, *, apply=False, backup_dir=None):
    backend = Path(backend).resolve()
    plans, skipped = migration_plan(backend)
    result = {
        "packets": len(plans),
        "nodes": len({p["node_id"] for p in plans}),
        "runs": len({str(Path(p["target"]).parent) for p in plans}),
        "moved": 0,
        "skipped_invalid": skipped,
        "backup": None,
    }
    if not apply or not plans:
        return result
    # Verify the complete snapshot before creating a backup or moving a pair.
    for entry in plans:
        packet = Path(entry["source"])
        if (
            digest(packet) != entry["sha256"]
            or digest(packet.with_suffix(".json")) != entry["metadata_sha256"]
        ):
            raise ValueError(f"Capture changed during migration planning: {packet}")
    backups = Path(backup_dir) if backup_dir else backend / "data" / "backups"
    backups.mkdir(parents=True, exist_ok=True)
    archive = backups / (
        datetime.now(timezone.utc).strftime("meshtastic_%Y%m%dT%H%M%SZ_")
        + uuid4().hex[:8]
        + ".tar.gz"
    )
    manifest = [
        {key: value for key, value in entry.items() if not key.startswith("_")} for entry in plans
    ]
    # Exclusive creation prevents replacing a previous recovery archive.
    with tarfile.open(archive, "x:gz") as stream:
        for entry in plans:
            path = Path(entry["source"])
            for member in (path, path.with_suffix(".json")):
                stream.add(member, arcname=member.relative_to(backend).as_posix(), recursive=False)
        content = json.dumps(manifest, indent=2).encode()
        info = tarfile.TarInfo("migration.json")
        info.size = len(content)
        stream.addfile(info, io.BytesIO(content))
    result["backup"] = str(archive)
    # Validate that the archive can actually restore the exact original bytes.
    with tarfile.open(archive, "r:gz") as stream:
        for entry in plans:
            path = Path(entry["source"])
            for member, checksum in (
                (path, entry["sha256"]),
                (path.with_suffix(".json"), entry["metadata_sha256"]),
            ):
                saved = stream.extractfile(member.relative_to(backend).as_posix())
                if saved is None or hashlib.sha256(saved.read()).hexdigest() != checksum:
                    raise ValueError("Migration backup validation failed")
    for entry in plans:
        packet, target = Path(entry["source"]), Path(entry["target"])
        sidecar = packet.with_suffix(".json")
        if digest(packet) != entry["sha256"] or digest(sidecar) != entry["metadata_sha256"]:
            raise ValueError(f"Capture changed after backup: {packet}")
        storage = MeshStorage(entry["_root"])
        directory = storage.directory(entry["node_id"], entry["timestamp"])
        if directory != target.parent:
            raise ValueError("Capture run changed after planning; retry migration")
        metadata = entry["_metadata"]
        metadata.setdefault("file", {}).update(binary=target.name, binary_path=str(target))
        original_stat = sidecar.stat()
        # Hard links claim paths without overwriting existing files. Originals
        # remain available until the complete destination pair is verified.
        os.link(packet, target)
        created_sidecar = False
        try:
            with target.with_suffix(".json").open("x") as output:
                created_sidecar = True
                json.dump(metadata, output, indent=2, allow_nan=False)
            target.with_suffix(".json").chmod(stat.S_IMODE(original_stat.st_mode))
            os.utime(
                target.with_suffix(".json"),
                ns=(original_stat.st_atime_ns, original_stat.st_mtime_ns),
            )
            if digest(target) != entry["sha256"]:
                raise ValueError("Migrated packet checksum differs")
            storage.update_node(directory, metadata["telemetry"], entry["timestamp"])
        except Exception:
            target.unlink(missing_ok=True)
            if created_sidecar:
                target.with_suffix(".json").unlink(missing_ok=True)
            raise
        sidecar.unlink()
        packet.unlink()
        result["moved"] += 1
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-dir", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--backup-dir", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    print(
        json.dumps(
            migrate_mesh(args.backend_dir, apply=args.apply, backup_dir=args.backup_dir), indent=2
        )
    )


if __name__ == "__main__":
    main()
