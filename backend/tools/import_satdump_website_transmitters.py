#!/usr/bin/env python3
import argparse
import datetime as dt
import re
import sqlite3
import sys
import unicodedata
import uuid
from html.parser import HTMLParser
from pathlib import Path
from typing import List, Optional, TypedDict

import requests

DEFAULT_DB = Path("backend/data/db/gs.db")
DEFAULT_URL = "https://www.satdump.org/Satellite-List/"
DEFAULT_SERVICE = None
DEFAULT_SOURCE = "satdump"
DEFAULT_CITATION = DEFAULT_URL
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


class SatInfo(TypedDict):
    name: str
    norad: int


class SatEntry(TypedDict):
    sat: SatInfo
    rows: List[List[str]]


class SatDumpHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.satellites: List[SatEntry] = []
        self._in_h1 = False
        self._h1_text: List[str] = []
        self._current_sat: Optional[SatInfo] = None
        self._in_table = False
        self._in_tr = False
        self._in_td = False
        self._cell_text: List[str] = []
        self._current_row: List[str] = []
        self._rows: List[List[str]] = []

    def handle_starttag(self, tag, attrs):
        if tag == "h1":
            self._in_h1 = True
            self._h1_text = []
        elif tag == "table":
            if self._current_sat:
                self._in_table = True
                self._rows = []
        elif tag == "tr" and self._in_table:
            self._in_tr = True
            self._current_row = []
        elif tag in {"td", "th"} and self._in_tr:
            self._in_td = True
            self._cell_text = []

    def handle_endtag(self, tag):
        if tag == "h1" and self._in_h1:
            self._in_h1 = False
            text = "".join(self._h1_text).strip()
            match = re.search(r"^(.*?)\s*\[NORAD\s*(\d+)\s*\]", text)
            if match:
                name = match.group(1).strip()
                norad_id = int(match.group(2))
                self._current_sat = {"name": name, "norad": norad_id}
            else:
                self._current_sat = None
        elif tag in {"td", "th"} and self._in_td:
            self._in_td = False
            cell = "".join(self._cell_text).strip()
            self._current_row.append(cell)
        elif tag == "tr" and self._in_tr:
            self._in_tr = False
            if self._current_row:
                self._rows.append(self._current_row)
        elif tag == "table" and self._in_table:
            self._in_table = False
            if self._current_sat and self._rows:
                self.satellites.append({"sat": self._current_sat, "rows": self._rows})
            self._current_sat = None
            self._rows = []

    def handle_data(self, data):
        if self._in_h1:
            self._h1_text.append(data)
        elif self._in_td:
            self._cell_text.append(data)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Scrape satdump.org Satellite-List and import transmitters into the database."
        ),
        formatter_class=argparse.RawTextHelpFormatter,
        epilog=(
            "Examples:\n"
            "  python backend/tools/import_satdump_website_transmitters.py --dry-run\n"
            "  python backend/tools/import_satdump_website_transmitters.py --purge-source\n"
            "  python backend/tools/import_satdump_website_transmitters.py --only-norad 44876\n"
        ),
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB,
        help="Path to gs.db (default: backend/data/db/gs.db)",
    )
    parser.add_argument(
        "--url",
        default=DEFAULT_URL,
        help="Satellite list URL (default: https://www.satdump.org/Satellite-List/)",
    )
    parser.add_argument(
        "--service",
        default=DEFAULT_SERVICE,
        help="Service label for inserted rows (default: null)",
    )
    parser.add_argument(
        "--source",
        default=DEFAULT_SOURCE,
        help="Source identifier stored in transmitters.source (default: satdump)",
    )
    parser.add_argument(
        "--citation",
        default=DEFAULT_CITATION,
        help="Citation/source URL stored in transmitters.citation",
    )
    parser.add_argument(
        "--only-norad",
        action="append",
        type=int,
        help="Only import entries for this NORAD id (repeatable)",
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


def parse_frequency_hz(value: str) -> Optional[int]:
    if not value:
        return None
    match = re.search(r"([0-9]+(?:\.[0-9]+)?)\s*(ghz|mhz|khz|hz)", value, re.I)
    if not match:
        return None
    number = float(match.group(1))
    unit = match.group(2).lower()
    if unit == "ghz":
        number *= 1_000_000_000
    elif unit == "mhz":
        number *= 1_000_000
    elif unit == "khz":
        number *= 1_000
    return int(round(number))


def clean_text(value: str) -> str:
    if not value:
        return ""
    normalized = unicodedata.normalize("NFKD", value)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    return " ".join(ascii_only.split()).strip()


def clean_transmitter_name(value: str) -> str:
    cleaned = clean_text(value)
    cleaned = re.sub(r"^(DB|TODO)\\b", "", cleaned).strip()
    return cleaned


def compact_dict(payload: dict) -> dict:
    return {k: v for k, v in payload.items() if v is not None}


def parse_satellite_tables(html_text: str) -> List[SatEntry]:
    parser = SatDumpHTMLParser()
    parser.feed(html_text)
    return parser.satellites


def build_rows(
    satellites: List[SatEntry],
    satellites_in_db: set[int],
    args: argparse.Namespace,
) -> tuple[list[dict], list[tuple[int, str]], list[tuple[int, str, str]]]:
    rows: list[dict] = []
    skipped_missing_sat: list[tuple[int, str]] = []
    skipped_no_frequency: list[tuple[int, str, str]] = []

    only_norad = set(args.only_norad or [])
    for entry in satellites:
        sat = entry["sat"]
        norad = int(sat["norad"])
        sat_name = str(sat["name"])

        if only_norad and norad not in only_norad:
            continue
        if norad not in satellites_in_db:
            skipped_missing_sat.append((norad, sat_name))
            continue

        for row in entry["rows"]:
            if not row:
                continue
            if row[0].strip().lower() == "name":
                continue
            freq_text = row[2] if len(row) > 2 else ""
            frequency_hz = parse_frequency_hz(freq_text)
            if frequency_hz is None:
                skipped_no_frequency.append((norad, sat_name, row[0] if row else ""))
                continue

            raw_name = row[0] if row else ""
            tx_name = clean_transmitter_name(raw_name)
            if not tx_name:
                tx_name = clean_text(sat_name)
            source_transmitter_id = str(
                uuid.uuid5(uuid.NAMESPACE_URL, f"satdump-website:{norad}:{tx_name}:{frequency_hz}")
            )
            tx_id = uuid_to_short_transmitter_id(source_transmitter_id)

            now = dt.datetime.now(dt.timezone.utc).isoformat()
            rows.append(
                {
                    "id": tx_id,
                    "description": tx_name,
                    "alive": True,
                    "type": "Transmitter",
                    "uplink_low": None,
                    "uplink_high": None,
                    "uplink_drift": None,
                    "downlink_low": frequency_hz,
                    "downlink_high": None,
                    "downlink_drift": None,
                    "mode": None,
                    "mode_id": None,
                    "uplink_mode": None,
                    "invert": 0,
                    "baud": None,
                    "sat_id": None,
                    "norad_cat_id": norad,
                    "norad_follow_id": None,
                    "status": "active",
                    "citation": args.citation,
                    "service": "Unknown",
                    "source": args.source,
                    "source_transmitter_id": source_transmitter_id,
                    "iaru_coordination": "N/A",
                    "iaru_coordination_url": "",
                    "itu_notification": '{"urls": []}',
                    "frequency_violation": 0,
                    "unconfirmed": 0,
                    "added": now,
                    "updated": now,
                }
            )

    return rows, skipped_missing_sat, skipped_no_frequency


def upsert_transmitters(conn: sqlite3.Connection, rows: list[dict], dry_run: bool) -> int:
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

    try:
        response = requests.get(args.url, timeout=30)
        response.raise_for_status()
    except requests.RequestException as exc:
        print(f"Failed to fetch {args.url}: {exc}", file=sys.stderr)
        return 1

    satellites = parse_satellite_tables(response.text)
    if not satellites:
        print("No satellites found on the page.", file=sys.stderr)
        return 1

    conn = sqlite3.connect(args.db)
    conn.execute("PRAGMA foreign_keys = ON")

    try:
        satellites_in_db = {row[0] for row in conn.execute("SELECT norad_id FROM satellites")}
        rows, skipped_missing_sat, skipped_no_frequency = build_rows(
            satellites, satellites_in_db, args
        )

        purged_source = 0
        if args.purge_source:
            purged_source = purge_transmitters_by_source(conn, args.source, args.dry_run)

        upserted = upsert_transmitters(conn, rows, args.dry_run)

        if not args.dry_run:
            conn.commit()

        print(f"Upserted: {upserted}")
        if args.purge_source:
            print(f"Purged (source={args.source}): {purged_source}")
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
