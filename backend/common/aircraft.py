"""Aircraft metadata from readsb plus the licensed Mictronics lookup tables."""

import gzip
import json
import logging
import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

logger = logging.getLogger("aircraft")
LOCAL_DATABASE = Path(__file__).resolve().parents[1] / "data" / "adsb"
BUNDLED_DATABASE = Path("/usr/local/share/ground-station/adsb")


def text(value):
    return value.strip() or None if isinstance(value, str) else None


class AircraftDatabase:
    def __init__(self):
        self.path: Path | None = None
        self.types: dict[str, Any] = {}
        self.operators: dict[str, Any] = {}
        self.info: dict[str, Any] = {}
        override = os.environ.get("GS_ADSB_DB_DIR")
        directories = ([Path(override).expanduser().resolve()] if override else []) + [
            LOCAL_DATABASE,
            BUNDLED_DATABASE,
        ]
        for directory in dict.fromkeys(directories):
            path = directory / "aircraft.csv.gz"
            if not path.is_file():
                if override and directory == directories[0]:
                    logger.warning("No aircraft database in GS_ADSB_DB_DIR=%s", directory)
                continue
            try:
                with gzip.open(path, "rt", encoding="utf-8") as stream:
                    first = stream.readline().rstrip("\n").split(";")
                if len(first) != 8 or not re.fullmatch(r"[0-9a-fA-F]{6}", first[0]):
                    raise ValueError("Invalid readsb CSV format")
                metadata = json.loads((directory / "metadata.json").read_text(encoding="utf-8"))
                if not isinstance(metadata, dict) or any(
                    not isinstance(metadata.get(key), dict)
                    for key in ("types", "operators", "database")
                ):
                    raise ValueError("Invalid aircraft lookup tables")
                for table in (metadata["types"], metadata["operators"]):
                    if any(
                        not isinstance(row, list)
                        or len(row) != 3
                        or any(value is not None and not isinstance(value, str) for value in row)
                        for row in table.values()
                    ):
                        raise ValueError("Invalid aircraft lookup entry")
                self.types = metadata["types"]
                self.operators = metadata["operators"]
                self.info = metadata["database"]
                self.path = path
                break
            except (OSError, ValueError, EOFError) as error:
                logger.warning("Cannot load aircraft database %s: %s", path, error)


@lru_cache(maxsize=1)
def aircraft_database():
    # Share the small type/operator tables within each process; readsb owns the
    # large address index. Decoder startup explicitly reloads this snapshot.
    return AircraftDatabase()


def aircraft_metadata(report, database=None):
    database = database if database is not None else aircraft_database()
    type_code = text(report.get("t"))
    specification = database.types.get(type_code, [])
    model, description, wake = (specification + [None, None, None])[:3]
    description = text(description)
    flight = text(report.get("flight")) or ""
    # Registration callsigns and arbitrary three-letter prefixes are not enough
    # to identify an operator. ICAO operator callsigns conventionally add digits.
    operator_code = flight[:3] if re.match(r"^[A-Z]{3}[0-9]", flight) else None
    operator = database.operators.get(operator_code, [])
    operator_name, operator_country, operator_callsign = (operator + [None, None, None])[:3]
    flags = report.get("dbFlags")
    flags = flags if type(flags) is int and flags >= 0 else None
    if "dbFlags" not in report and (text(report.get("r")) or type_code):
        flags = 0  # readsb omits the flags field when a matched entry has no flags.
    # readsb supplements database flags with military address-range rules.
    # A missing/clear flag never establishes civilian ownership or hobby use.
    return {
        "registration": text(report.get("r")),
        "type_code": type_code,
        "model": text(report.get("desc")) or text(model),
        "type_description": description,
        "aircraft_class": description[0] if description else None,
        "engine_count": (
            int(description[1])
            if description and len(description) > 1 and description[1].isdigit()
            else None
        ),
        "engine_type": (
            description[2]
            if description and len(description) > 2 and description[2] != "-"
            else None
        ),
        "wake_category": text(wake) if wake != "-" else None,
        "military_status": "military" if flags is not None and flags & 1 else "unclassified",
        "interesting": bool(flags & 2) if flags is not None else None,
        "category": text(report.get("category")),
        "operator_code": operator_code if operator else None,
        "operator_name": text(operator_name),
        "operator_country": text(operator_country),
        "operator_callsign": text(operator_callsign),
        "operator_source": "callsign_prefix" if operator else None,
        "owner": text(report.get("ownOp")),
        "year": text(report.get("year")),
        "database": database.info or None,
    }


def enrich_aircraft_record(record):
    # Older captures retain the readsb report even when normalized metadata was
    # not saved. Do not replace metadata/provenance captured by newer versions.
    if "aircraft" not in record:
        record = {**record, "aircraft": aircraft_metadata(record.get("readsb") or {})}
    return record
