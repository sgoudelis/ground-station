"""Group historical sonde packets. Run from backend: python -m tools.migratesondes.

The default is a dry run. Stop reception before using --apply; existing flat
captures remain supported, so migration is optional and never runs at startup.
"""

import argparse
import json
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from common.artifactdates import artifact_dates, parse_artifact_time
from common.filenames import radiosonde_folder_name
from common.pathguard import ensure_path_in_allowed_roots
from common.sondestorage import RUN_SUFFIX, RUN_WINDOW_SECONDS, run_name
from library.sondefiles import sonde_identity


def sonde_roots(backend: Path) -> list[Path]:
    """Only migrate standalone captures and inactive observation bundles."""
    decoded = backend / "data" / "decoded"
    roots = [decoded]
    for bundle in sorted((backend / "data" / "observations").glob("*.gsobs")):
        if bundle.is_symlink():
            continue
        try:
            if json.loads((bundle / "manifest.json").read_text()).get("in_progress"):
                continue
        except (OSError, ValueError, AttributeError):
            pass
        roots.append(bundle / "decoded")
    return roots


def upgrade_run_suffixes(backend: Path, *, apply: bool = False) -> list[dict[str, Any]]:
    """Rename timestamp-only runs, retaining their boundaries and file dates."""
    results: list[dict[str, Any]] = []
    for root in sonde_roots(backend):
        for source in sorted(root.glob("radiosonde_*/*")):
            if source.is_symlink() or not source.is_dir() or source.name.endswith(RUN_SUFFIX):
                continue
            marker = source / "run.json"
            if not marker.is_file() or marker.is_symlink():
                continue
            # Only timestamps from the earlier layout qualify. Leave unrelated
            # subdirectories untouched, even if they happen to contain JSON.
            try:
                datetime.strptime(source.name, "%Y%m%dT%H%M%S.%fZ")
            except ValueError:
                try:
                    datetime.strptime(source.name, "%Y%m%dT%H%M%SZ")
                except ValueError:
                    continue
            target = source.with_name(source.name + RUN_SUFFIX)
            ensure_path_in_allowed_roots(source, [root])
            ensure_path_in_allowed_roots(target, [root])
            entry = {"kind": "run", "source": str(source), "target": str(target), "applied": False}
            results.append(entry)
            if target.exists():
                entry["error"] = "Destination already exists"
                continue
            originals = []
            try:
                for packet in sorted(source.rglob("*.bin")):
                    sidecar = packet.with_suffix(".json")
                    if packet.is_symlink() or sidecar.is_symlink():
                        raise ValueError("Run contains a symbolic link")
                    ensure_path_in_allowed_roots(packet, [source])
                    # An interrupted capture can have bytes without a sidecar.
                    if not sidecar.exists():
                        continue
                    stat = sidecar.stat()
                    original = sidecar.read_bytes()
                    metadata = json.loads(original)
                    if not isinstance(metadata, dict) or not isinstance(
                        metadata.get("file", {}), dict
                    ):
                        raise ValueError("Invalid packet file metadata")
                    metadata.setdefault("file", {}).update(
                        binary=packet.name,
                        binary_path=str(target / packet.relative_to(source)),
                    )
                    updated = json.dumps(metadata, indent=2, allow_nan=False)
                    originals.append((sidecar.relative_to(source), original, updated, stat))
            except (OSError, ValueError) as exc:
                entry["error"] = str(exc)
                continue
            if not apply:
                continue
            directory_stat = source.stat()
            source.rename(target)
            try:
                for relative, original, updated, stat in originals:
                    sidecar = target / relative
                    temporary = None
                    try:
                        with tempfile.NamedTemporaryFile(
                            mode="w", dir=sidecar.parent, delete=False
                        ) as output:
                            temporary = Path(output.name)
                            output.write(updated)
                        shutil.copystat(sidecar, temporary)
                        temporary.replace(sidecar)
                    finally:
                        if temporary is not None:
                            temporary.unlink(missing_ok=True)
                os.utime(target, ns=(directory_stat.st_atime_ns, directory_stat.st_mtime_ns))
            except OSError:
                # Restore saved paths if updating a sidecar failed after rename.
                for relative, original, updated, stat in originals:
                    sidecar = target / relative
                    sidecar.write_bytes(original)
                    os.utime(sidecar, ns=(stat.st_atime_ns, stat.st_mtime_ns))
                target.rename(source)
                os.utime(source, ns=(directory_stat.st_atime_ns, directory_stat.st_mtime_ns))
                raise
            entry["applied"] = True
    return results


def migrate_sondes(backend: Path, *, apply: bool = False) -> list[dict[str, Any]]:
    """Regroup all supported layouts using fixed 12-hour windows per sonde."""
    results: list[dict[str, Any]] = []
    for root in sonde_roots(backend):
        captures = []
        # Revisit old run folders too: browser sessions and reception gaps used
        # to split a single flight. Packet timestamps define the new boundaries.
        for packet in [*root.glob("*.bin"), *root.glob("radiosonde_*/**/*.bin")]:
            sidecar = packet.with_suffix(".json")
            if any(path.is_symlink() for path in (packet, sidecar, *packet.parents)):
                continue
            if not packet.resolve().is_relative_to(root.resolve()):
                continue
            try:
                metadata = json.loads(sidecar.read_text())
                if not isinstance(metadata, dict) or not (identity := sonde_identity(metadata)):
                    continue
                dates = artifact_dates("decoded", packet, metadata)
                captured = parse_artifact_time(dates["captured_at"])
                assert captured is not None
                if not isinstance(metadata.get("file", {}), dict):
                    continue
                captures.append((captured.timestamp(), packet, sidecar, metadata, identity))
            except (OSError, ValueError, TypeError, AttributeError):
                continue
        active: dict[tuple, tuple[float, Path]] = {}
        run_mtimes: dict[Path, int] = {}
        planned = []
        destinations: set[Path] = set()
        source_runs: set[Path] = set()
        for timestamp, packet, sidecar, metadata, key in sorted(
            captures, key=lambda item: (item[0], str(item[1]))
        ):
            previous = active.get(key)
            if previous and timestamp - previous[0] < RUN_WINDOW_SECONDS:
                run = previous[1]
            else:
                run = root / radiosonde_folder_name(key[0], key[1]) / run_name(timestamp)
                active[key] = (timestamp, run)
            target = run / packet.name
            ensure_path_in_allowed_roots(target, [root])
            packet_stat, metadata_stat = packet.stat(), sidecar.stat()
            run_mtimes[run] = max(
                run_mtimes.get(run, 0), packet_stat.st_mtime_ns, metadata_stat.st_mtime_ns
            )
            if packet == target:
                destinations.add(target)
                continue
            entry: dict[str, Any] = {"source": str(packet), "target": str(target), "applied": False}
            results.append(entry)
            if target in destinations or target.exists() or target.with_suffix(".json").exists():
                entry["error"] = "Destination already exists"
            destinations.add(target)
            planned.append((entry, packet, sidecar, metadata, key, active[key][0]))
            if packet.parent.parent != root and packet.parent != root:
                source_runs.add(packet.parent)
        # Preflight the entire root so conflicts never produce a partial regroup.
        if not apply or any(entry.get("error") for entry, *_ in planned):
            continue
        changed_runs: set[Path] = set()
        for entry, packet, sidecar, metadata, key, started_at in planned:
            target = Path(entry["target"])
            run = target.parent
            run.mkdir(parents=True, exist_ok=True)
            marker = run / "run.json"
            if marker.is_symlink():
                raise ValueError("Run marker is a symbolic link")
            if not marker.exists():
                marker.write_text(
                    json.dumps(
                        {
                            "model": key[0],
                            "serial": key[1],
                            "started_at": datetime.fromtimestamp(
                                started_at, timezone.utc
                            ).isoformat(),
                            "window_seconds": RUN_WINDOW_SECONDS,
                            "migrated": True,
                        },
                        indent=2,
                    )
                )
            metadata.setdefault("file", {}).update(binary=packet.name, binary_path=str(target))
            # Prepare the updated sidecar before moving either original. On
            # failure, retain/restore the source pair so rerunning is safe.
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(mode="w", dir=run, delete=False) as output:
                    temporary = Path(output.name)
                    json.dump(metadata, output, indent=2, allow_nan=False)
                shutil.copystat(sidecar, temporary)
                packet.rename(target)
                try:
                    temporary.rename(target.with_suffix(".json"))
                    sidecar.unlink()
                except OSError:
                    target.rename(packet)
                    target.with_suffix(".json").unlink(missing_ok=True)
                    raise
                entry["applied"] = True
                changed_runs.add(run)
            finally:
                if temporary is not None:
                    temporary.unlink(missing_ok=True)
        for source in source_runs:
            # Retain unknown files and interrupted captures. Only discard an
            # obsolete marker once every packet pair has safely moved away.
            remaining = list(source.iterdir())
            if remaining == [source / "run.json"] and not remaining[0].is_symlink():
                remaining[0].unlink()
            if not list(source.iterdir()):
                source.rmdir()
        for run in changed_runs:
            # A newly written marker must not make old captures look recent.
            mtime = run_mtimes[run]
            os.utime(run / "run.json", ns=(mtime, mtime))
            os.utime(run, ns=(mtime, mtime))
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backend-dir", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--apply", action="store_true", help="Move captures (default: dry run)")
    args = parser.parse_args()
    results = migrate_sondes(args.backend_dir.resolve(), apply=args.apply)
    for result in results:
        print(json.dumps(result))
    pairs = sum(not row.get("error") for row in results)
    flights = len({str(Path(row["target"]).parent) for row in results if not row.get("error")})
    print(
        f"{'Migrated' if args.apply else 'Would migrate'} {pairs} packet pairs into {flights} flight folders"
    )


if __name__ == "__main__":
    main()
