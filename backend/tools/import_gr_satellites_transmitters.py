#!/usr/bin/env python3
import argparse
import datetime as dt
import importlib.util
import sqlite3
import sys
import uuid
from pathlib import Path
from typing import Iterable, Optional, Protocol, cast

import yaml

try:
    from satellites.satyaml.satyaml import SatYAML
except Exception:
    SatYAML = None

DEFAULT_DB = Path("backend/data/db/gs.db")
DEFAULT_SERVICE = "Unknown"
DEFAULT_CITATION = "https://github.com/daniestevez/gr-satellites"
DEFAULT_SOURCE = "gr-satellites"
TRANSMITTER_ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
TRANSMITTER_ID_BASE = len(TRANSMITTER_ID_ALPHABET)
TRANSMITTER_ID_LENGTH = 22


def uuid_to_short_transmitter_id(value: uuid.UUID | str) -> str:
    """Encode a UUID as a SatNOGS-style 22-char transmitter id."""
    uid = value if isinstance(value, uuid.UUID) else uuid.UUID(str(value).strip())
    number = uid.int
    encoded = []

    while number:
        number, remainder = divmod(number, TRANSMITTER_ID_BASE)
        encoded.append(TRANSMITTER_ID_ALPHABET[remainder])

    if not encoded:
        encoded.append(TRANSMITTER_ID_ALPHABET[0])

    return "".join(reversed(encoded)).rjust(
        TRANSMITTER_ID_LENGTH,
        TRANSMITTER_ID_ALPHABET[0],
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=("Import gr-satellites SatYAML transmitters into the transmitters table."),
        formatter_class=argparse.RawTextHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python backend/tools/import_gr_satellites_transmitters.py --dry-run\n"
            "  python backend/tools/import_gr_satellites_transmitters.py --purge-source\n"
            "  python backend/tools/import_gr_satellites_transmitters.py --only-norad 25544\n"
        ),
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB,
        help="Path to gs.db (default: backend/data/db/gs.db)",
    )
    parser.add_argument(
        "--yaml-dir",
        type=Path,
        default=None,
        help=(
            "Directory with gr-satellites SatYAML files "
            "(optional when SatYAML module is available)"
        ),
    )
    parser.add_argument(
        "--service",
        default=DEFAULT_SERVICE,
        help="Service label for inserted rows (default: gr-satellites)",
    )
    parser.add_argument(
        "--citation",
        default=DEFAULT_CITATION,
        help="Citation/source URL stored in transmitters.citation",
    )
    parser.add_argument(
        "--source",
        default=DEFAULT_SOURCE,
        help="Source identifier stored in transmitters.source (default: gr-satellites)",
    )
    parser.add_argument(
        "--only-norad",
        action="append",
        type=int,
        help="Only import entries for this NORAD id (repeatable)",
    )
    parser.add_argument(
        "--purge",
        action="store_true",
        help=(
            "Delete existing transmitters for the service that are not present in the "
            "current YAML set"
        ),
    )
    parser.add_argument(
        "--purge-source",
        action="store_true",
        help="Delete all existing transmitters with the selected source before insert",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would happen without writing to the database",
    )
    return parser.parse_args()


def to_int(value):
    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(round(value))
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def compact_dict(payload: dict) -> dict:
    return {k: v for k, v in payload.items() if v is not None}


def build_decoder_payload(tx: dict, sat_name: str, yaml_path: Path) -> dict:
    payload = {
        "satellite": sat_name,
        "framing": tx.get("framing"),
        "modulation": tx.get("modulation"),
        "baudrate": tx.get("baudrate"),
        "af_carrier": tx.get("af_carrier"),
        "deviation": tx.get("deviation"),
        "fm_deviation": tx.get("fm_deviation"),
        "frame_size": tx.get("frame size"),
        "callsign": tx.get("callsign"),
        "precoding": tx.get("precoding"),
        "scrambler": tx.get("scrambler"),
        "convolutional": tx.get("convolutional"),
        "rs_basis": tx.get("RS basis"),
        "rs_interleaving": tx.get("RS interleaving"),
        "data": tx.get("data"),
        "additional_data": tx.get("additional_data"),
        "transports": tx.get("transports"),
        "source_yaml": str(yaml_path),
    }
    return compact_dict(payload)


def build_decoder_summary(tx: dict) -> str:
    parts = []
    modulation = tx.get("modulation")
    baudrate = tx.get("baudrate")
    framing = tx.get("framing")
    if modulation:
        parts.append(str(modulation))
    if baudrate:
        parts.append(f"{baudrate} baud")
    if framing:
        parts.append(str(framing))
    return ", ".join(parts)


def build_rows(yaml_files: Iterable[Path], satellites_in_db: set[int], args: argparse.Namespace):
    rows = []
    skipped_missing_sat = []
    skipped_no_frequency = []

    only_norad = set(args.only_norad or [])
    for yml in sorted(yaml_files):
        data = yaml.safe_load(yml.read_text(encoding="utf-8"))
        norad = data.get("norad")
        sat_name = data.get("name")

        if only_norad and norad not in only_norad:
            continue
        if norad not in satellites_in_db:
            skipped_missing_sat.append((norad, sat_name))
            continue

        transmitters = data.get("transmitters", {})
        for tx_name, tx in transmitters.items():
            frequency = tx.get("frequency")
            if frequency is None:
                skipped_no_frequency.append((norad, sat_name, tx_name))
                continue

            source_transmitter_id = str(
                uuid.uuid5(uuid.NAMESPACE_URL, f"{args.service}:{norad}:{tx_name}")
            )
            tx_id = uuid_to_short_transmitter_id(source_transmitter_id)
            mode = tx.get("modulation")
            decoder_summary = build_decoder_summary(tx)
            description = tx_name
            if decoder_summary:
                description = f"{tx_name} ({decoder_summary})"

            row = {
                "id": tx_id,
                "description": description,
                "alive": True,
                "type": "Transmitter",
                "uplink_low": None,
                "uplink_high": None,
                "uplink_drift": None,
                "downlink_low": to_int(frequency),
                "downlink_high": None,
                "downlink_drift": None,
                "mode": mode,
                "mode_id": None,
                "uplink_mode": None,
                "invert": 0,
                "baud": to_int(tx.get("baudrate")),
                "sat_id": None,
                "norad_cat_id": norad,
                "norad_follow_id": None,
                "status": "active",
                "citation": args.citation,
                "service": args.service,
                "source": args.source,
                "source_transmitter_id": source_transmitter_id,
                "iaru_coordination": "N/A",
                "iaru_coordination_url": "",
                "itu_notification": '{"urls": []}',
                "frequency_violation": 0,
                "unconfirmed": 0,
                "added": dt.datetime.now(dt.timezone.utc).isoformat(),
                "updated": dt.datetime.now(dt.timezone.utc).isoformat(),
            }
            rows.append(row)

    return rows, skipped_missing_sat, skipped_no_frequency


def resolve_yaml_dir(yaml_dir: Optional[Path]) -> Optional[Path]:
    if yaml_dir and yaml_dir.exists():
        return yaml_dir

    try:
        satyaml_spec = importlib.util.find_spec("satyaml")
        if satyaml_spec and satyaml_spec.submodule_search_locations:
            for location in satyaml_spec.submodule_search_locations:
                candidate = Path(location)
                if candidate.exists():
                    return candidate

        satyaml_pkg_spec = importlib.util.find_spec("satellites.satyaml")
        if satyaml_pkg_spec and satyaml_pkg_spec.submodule_search_locations:
            for location in satyaml_pkg_spec.submodule_search_locations:
                candidate = Path(location)
                if candidate.exists():
                    return candidate

        spec = importlib.util.find_spec("gr_satellites")
        if spec and spec.submodule_search_locations:
            for location in spec.submodule_search_locations:
                base = Path(location)
                candidate = base / "satyaml"
                if candidate.exists():
                    return candidate
                for nested in base.rglob("satyaml"):
                    return nested
    except Exception:
        return None

    return None


class SatYamlProtocol(Protocol):
    def yaml_files(self) -> Iterable[str]: ...


def load_satyaml() -> Optional[SatYamlProtocol]:
    try:
        if SatYAML is None:
            return None
        satyaml = SatYAML()
        return cast(SatYamlProtocol, satyaml)
    except Exception:
        return None


def collect_yaml_files(yaml_dir: Optional[Path], satyaml: Optional[SatYamlProtocol]) -> list[Path]:
    if satyaml is not None:
        try:
            return [Path(path) for path in satyaml.yaml_files()]
        except Exception:
            return []

    if yaml_dir is None:
        return []

    return list(yaml_dir.glob("*.yml"))


def upsert_transmitters(conn: sqlite3.Connection, rows: list[dict], dry_run: bool):
    if not rows:
        return 0

    columns = list(rows[0].keys())
    placeholders = ", ".join(f":{col}" for col in columns)
    update_cols = [c for c in columns if c not in {"id", "added"}]
    update_assignments = ", ".join(f"{col}=excluded.{col}" for col in update_cols)
    update_assignments = f"{update_assignments}, added=transmitters.added"

    insert_sql = (
        "INSERT INTO transmitters ("
        + ", ".join(columns)
        + ") VALUES ("
        + placeholders
        + ") ON CONFLICT(id) DO UPDATE SET "
        + update_assignments
    )

    if dry_run:
        return len(rows)

    conn.executemany(insert_sql, rows)
    return len(rows)


def purge_transmitters(conn: sqlite3.Connection, service: str, keep_ids: set[str], dry_run: bool):
    if dry_run:
        if not keep_ids:
            cur = conn.execute(
                "SELECT COUNT(*) FROM transmitters WHERE service = ?",
                (service,),
            )
            return cur.fetchone()[0]
        cur = conn.execute(
            "SELECT COUNT(*) FROM transmitters WHERE service = ? AND id NOT IN ("
            + ",".join("?" for _ in keep_ids)
            + ")",
            [service, *sorted(keep_ids)],
        )
        return cur.fetchone()[0]

    if not keep_ids:
        cur = conn.execute("DELETE FROM transmitters WHERE service = ?", (service,))
        return cur.rowcount

    sql = (
        "DELETE FROM transmitters WHERE service = ? AND id NOT IN ("
        + ",".join("?" for _ in keep_ids)
        + ")"
    )
    cur = conn.execute(sql, [service, *sorted(keep_ids)])
    return cur.rowcount


def purge_transmitters_by_source(conn: sqlite3.Connection, source: str, dry_run: bool) -> int:
    if dry_run:
        cur = conn.execute(
            "SELECT COUNT(*) FROM transmitters WHERE source = ?",
            (source,),
        )
        row = cur.fetchone()
        return int(row[0] if row else 0)

    cur = conn.execute("DELETE FROM transmitters WHERE source = ?", (source,))
    return int(cur.rowcount)


def main() -> int:
    args = parse_args()

    if not args.db.exists():
        print(f"Database not found: {args.db}", file=sys.stderr)
        return 1

    yaml_dir = resolve_yaml_dir(args.yaml_dir)
    satyaml = load_satyaml()
    yaml_files = collect_yaml_files(yaml_dir, satyaml)
    if not yaml_files:
        print(
            f"YAML directory not found: {args.yaml_dir}. "
            "Install the gr-satellites/satyaml package or provide --yaml-dir.",
            file=sys.stderr,
        )
        return 1

    conn = sqlite3.connect(args.db)
    conn.execute("PRAGMA foreign_keys = ON")

    try:
        satellites_in_db = {row[0] for row in conn.execute("SELECT norad_id FROM satellites")}
        rows, skipped_missing_sat, skipped_no_frequency = build_rows(
            yaml_files, satellites_in_db, args
        )

        purged_source = 0
        if args.purge_source:
            purged_source = purge_transmitters_by_source(conn, args.source, args.dry_run)

        upserted = upsert_transmitters(conn, rows, args.dry_run)

        purged = 0
        if args.purge:
            keep_ids = {row["id"] for row in rows}
            purged = purge_transmitters(conn, args.service, keep_ids, args.dry_run)

        if not args.dry_run:
            conn.commit()

        print(f"Upserted: {upserted}")
        if args.purge_source:
            print(f"Purged (source={args.source}): {purged_source}")
        if args.purge:
            print(f"Purged: {purged}")
        print(f"Skipped (missing satellite): {len(skipped_missing_sat)}")
        print(f"Skipped (no frequency): {len(skipped_no_frequency)}")

        if skipped_missing_sat:
            print("Missing satellites (first 20):")
            for norad, name in skipped_missing_sat[:20]:
                print(f"  {norad} {name}")

        return 0
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
