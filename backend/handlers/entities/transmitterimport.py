# Copyright (c) 2025 Efstratios Goudelis
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
# along with this program.  If not, see <https://www.gnu.org/licenses/>.

import asyncio
import datetime as dt
import importlib.util
import json
import re
import unicodedata
import uuid
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable, Optional, Protocol, TypedDict, cast

import requests
import yaml
from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

try:
    from satellites.satyaml.satyaml import SatYAML
except Exception:
    SatYAML = None

from db import AsyncSessionLocal
from db.models import Satellites, Transmitters

DEFAULT_SATDUMP_URL = "https://www.satdump.org/Satellite-List/"
DEFAULT_SATDUMP_SOURCE = "satdump"
DEFAULT_SATDUMP_CITATION = DEFAULT_SATDUMP_URL
DEFAULT_SATDUMP_SERVICE = "Unknown"

DEFAULT_GR_SERVICE = "Unknown"
DEFAULT_GR_CITATION = "https://github.com/daniestevez/gr-satellites"
DEFAULT_GR_SOURCE = "gr-satellites"
BASE_DIR = Path(__file__).resolve().parents[3]
DEFAULT_GR_SATYAML_DIR = BASE_DIR / "external/gr-satellites/python/satyaml"
TRANSMITTER_ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
TRANSMITTER_ID_BASE = len(TRANSMITTER_ID_ALPHABET)
TRANSMITTER_ID_LENGTH = 22


class SatInfo(TypedDict):
    name: str
    norad: int


class SatEntry(TypedDict):
    sat: SatInfo
    rows: list[list[str]]


class SatDumpHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.satellites: list[SatEntry] = []
        self._in_h1 = False
        self._h1_text: list[str] = []
        self._current_sat: Optional[SatInfo] = None
        self._in_table = False
        self._in_tr = False
        self._in_td = False
        self._cell_text: list[str] = []
        self._current_row: list[str] = []
        self._rows: list[list[str]] = []

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
            text_value = "".join(self._h1_text).strip()
            match = re.search(r"^(.*?)\s*\[NORAD\s*(\d+)\s*\]", text_value)
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


class SatYamlProtocol(Protocol):
    def yaml_files(self) -> Iterable[str]: ...


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


def parse_satellite_tables(html_text: str) -> list[SatEntry]:
    parser = SatDumpHTMLParser()
    parser.feed(html_text)
    return parser.satellites


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


def _normalize_optional_json(value):
    if value is None:
        return None
    if isinstance(value, str) and value.strip() in {"", "-"}:
        return None

    parsed = value
    for _ in range(4):
        if isinstance(parsed, (dict, list, bool, int, float)) or parsed is None:
            return parsed
        if not isinstance(parsed, str):
            return None

        candidate = parsed.strip()
        if candidate.lower() in {"", "-", "null", "none"}:
            return None

        try:
            parsed = json.loads(candidate)
            continue
        except json.JSONDecodeError:
            if candidate.startswith('"') and candidate.endswith('"'):
                parsed = candidate[1:-1].replace('\\"', '"')
                continue
            if '\\"' in candidate:
                parsed = candidate.replace('\\"', '"')
                continue
            return None

    return None


def build_satdump_rows(
    satellites: list[SatEntry],
    satellites_in_db: set[int],
    source: str,
    citation: str,
) -> tuple[list[dict], list[tuple[int, str]], list[tuple[int, str, str]]]:
    rows: list[dict] = []
    skipped_missing_sat: list[tuple[int, str]] = []
    skipped_no_frequency: list[tuple[int, str, str]] = []

    for entry in satellites:
        sat = entry["sat"]
        norad = int(sat["norad"])
        sat_name = str(sat["name"])

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

            now = dt.datetime.now(dt.timezone.utc)
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
                    "invert": False,
                    "baud": None,
                    "sat_id": None,
                    "norad_cat_id": norad,
                    "norad_follow_id": None,
                    "status": "active",
                    "citation": citation,
                    "service": DEFAULT_SATDUMP_SERVICE,
                    "source": source,
                    "source_transmitter_id": source_transmitter_id,
                    "iaru_coordination": "N/A",
                    "iaru_coordination_url": "",
                    "itu_notification": {"urls": []},
                    "frequency_violation": False,
                    "unconfirmed": False,
                    "added": now,
                    "updated": now,
                }
            )

    return rows, skipped_missing_sat, skipped_no_frequency


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


def build_gr_rows(
    yaml_files: Iterable[Path],
    satellites_in_db: set[int],
    service: str,
    source: str,
    citation: str,
) -> tuple[list[dict], list[tuple[Optional[int], str]], list[tuple[int, str, str]], int]:
    rows: list[dict] = []
    skipped_missing_sat: list[tuple[Optional[int], str]] = []
    skipped_no_frequency: list[tuple[int, str, str]] = []
    skipped_invalid_yaml = 0

    for yml in sorted(yaml_files):
        try:
            data = yaml.safe_load(yml.read_text(encoding="utf-8"))
        except Exception:
            skipped_invalid_yaml += 1
            continue
        if not isinstance(data, dict):
            skipped_invalid_yaml += 1
            continue
        norad = data.get("norad")
        sat_name = data.get("name")
        sat_name_str = str(sat_name) if sat_name is not None else ""

        if not isinstance(norad, int):
            skipped_missing_sat.append((None, sat_name_str))
            continue

        if norad not in satellites_in_db:
            skipped_missing_sat.append((norad, sat_name_str))
            continue

        transmitters = data.get("transmitters", {})
        for tx_name, tx in transmitters.items():
            tx_name_str = str(tx_name)
            frequency = tx.get("frequency")
            if frequency is None:
                skipped_no_frequency.append((norad, sat_name_str, tx_name_str))
                continue

            source_transmitter_id = str(
                uuid.uuid5(uuid.NAMESPACE_URL, f"{service}:{norad}:{tx_name_str}")
            )
            tx_id = uuid_to_short_transmitter_id(source_transmitter_id)
            mode = tx.get("modulation")
            decoder_summary = build_decoder_summary(tx)
            description = tx_name_str
            if decoder_summary:
                description = f"{tx_name_str} ({decoder_summary})"

            now = dt.datetime.now(dt.timezone.utc)
            rows.append(
                {
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
                    "invert": False,
                    "baud": to_int(tx.get("baudrate")),
                    "sat_id": None,
                    "norad_cat_id": norad,
                    "norad_follow_id": None,
                    "status": "active",
                    "citation": citation,
                    "service": service,
                    "source": source,
                    "source_transmitter_id": source_transmitter_id,
                    "iaru_coordination": "N/A",
                    "iaru_coordination_url": "",
                    "itu_notification": {"urls": []},
                    "frequency_violation": False,
                    "unconfirmed": False,
                    "added": now,
                    "updated": now,
                }
            )

    return rows, skipped_missing_sat, skipped_no_frequency, skipped_invalid_yaml


def resolve_yaml_dir(yaml_dir: Optional[Path]) -> Optional[Path]:
    candidates = []
    if yaml_dir:
        candidates.append(yaml_dir)
    candidates.append(DEFAULT_GR_SATYAML_DIR)

    for candidate in candidates:
        if candidate and candidate.exists():
            return candidate

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


def collect_yaml_files(yaml_dir: Optional[Path], satyaml: Optional[SatYamlProtocol]) -> list[Path]:
    if satyaml is not None:
        try:
            return [Path(path) for path in satyaml.yaml_files()]
        except Exception:
            return []

    if yaml_dir is None:
        return []

    return list(yaml_dir.glob("*.yml"))


def load_satyaml() -> Optional[SatYamlProtocol]:
    try:
        if SatYAML is None:
            return None
        satyaml = SatYAML()
        return cast(SatYamlProtocol, satyaml)
    except Exception:
        return None


async def upsert_transmitters(
    rows: list[dict],
    session: Optional[AsyncSession] = None,
) -> int:
    if not rows:
        return 0
    normalized_rows = []
    for row in rows:
        normalized_row = dict(row)
        if "itu_notification" in normalized_row:
            normalized_row["itu_notification"] = _normalize_optional_json(
                normalized_row["itu_notification"]
            )
        normalized_rows.append(normalized_row)

    table = Transmitters.__table__
    update_cols = [col for col in normalized_rows[0].keys() if col not in {"id", "added"}]
    stmt = sqlite_insert(table)
    update_values = {col: getattr(stmt.excluded, col) for col in update_cols}
    update_values["added"] = table.c.added
    stmt = stmt.on_conflict_do_update(index_elements=["id"], set_=update_values)

    if session is None:
        async with AsyncSessionLocal() as session:
            await session.execute(stmt, normalized_rows)
            await session.commit()
    else:
        await session.execute(stmt, normalized_rows)
        await session.commit()
    return len(normalized_rows)


async def import_satdump_transmitters(
    url: str = DEFAULT_SATDUMP_URL,
    source: str = DEFAULT_SATDUMP_SOURCE,
    citation: str = DEFAULT_SATDUMP_CITATION,
    session: Optional[AsyncSession] = None,
) -> dict:
    try:
        response = await asyncio.to_thread(requests.get, url, timeout=30)
        response.raise_for_status()
    except requests.RequestException as exc:
        return {"success": False, "error": f"Failed to fetch {url}: {exc}"}

    satellites = await asyncio.to_thread(parse_satellite_tables, response.text)
    if not satellites:
        return {"success": False, "error": "No satellites found on the SatDump page."}

    if session is None:
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(Satellites.norad_id))
            satellites_in_db = set(result.scalars().all())
            rows, skipped_missing_sat, skipped_no_frequency = build_satdump_rows(
                satellites, satellites_in_db, source, citation
            )
            upserted = await upsert_transmitters(rows, session=session)
    else:
        result = await session.execute(select(Satellites.norad_id))
        satellites_in_db = set(result.scalars().all())
        rows, skipped_missing_sat, skipped_no_frequency = build_satdump_rows(
            satellites, satellites_in_db, source, citation
        )
        upserted = await upsert_transmitters(rows, session=session)

    return {
        "success": True,
        "source": source,
        "upserted": upserted,
        "skipped_missing_sat": len(skipped_missing_sat),
        "skipped_no_frequency": len(skipped_no_frequency),
    }


async def import_gr_satellites_transmitters(
    yaml_dir: Optional[Path] = None,
    service: str = DEFAULT_GR_SERVICE,
    source: str = DEFAULT_GR_SOURCE,
    citation: str = DEFAULT_GR_CITATION,
    session: Optional[AsyncSession] = None,
) -> dict:
    resolved_dir = resolve_yaml_dir(yaml_dir)
    satyaml = load_satyaml()
    yaml_files = collect_yaml_files(resolved_dir, satyaml)
    if not yaml_files:
        return {
            "success": False,
            "error": "YAML directory not found. Install gr-satellites/satyaml or configure it.",
        }

    if session is None:
        async with AsyncSessionLocal() as session:
            result = await session.execute(select(Satellites.norad_id))
            satellites_in_db = set(result.scalars().all())
            rows, skipped_missing_sat, skipped_no_frequency, skipped_invalid_yaml = (
                await asyncio.to_thread(
                    build_gr_rows,
                    yaml_files,
                    satellites_in_db,
                    service,
                    source,
                    citation,
                )
            )
            upserted = await upsert_transmitters(rows, session=session)
    else:
        result = await session.execute(select(Satellites.norad_id))
        satellites_in_db = set(result.scalars().all())
        rows, skipped_missing_sat, skipped_no_frequency, skipped_invalid_yaml = (
            await asyncio.to_thread(
                build_gr_rows,
                yaml_files,
                satellites_in_db,
                service,
                source,
                citation,
            )
        )
        upserted = await upsert_transmitters(rows, session=session)

    return {
        "success": True,
        "source": source,
        "upserted": upserted,
        "skipped_missing_sat": len(skipped_missing_sat),
        "skipped_no_frequency": len(skipped_no_frequency),
        "skipped_invalid_yaml": skipped_invalid_yaml,
    }
