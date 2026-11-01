"""Aircraft database conversion, enrichment, provenance and history behavior."""

import gzip
import io
import json
import zipfile

import pytest

from common import aircraft
from common.adsb import aircraft_record
from common.adsbstorage import AdsbStorage
from library.inventory import LibraryInventory
from tools.aircraftdb import install

pytestmark = pytest.mark.unit


def archive(files):
    data = io.BytesIO()
    with zipfile.ZipFile(data, "w") as output:
        for name, value in files.items():
            output.writestr(name, value if isinstance(value, str) else json.dumps(value))
    return zipfile.ZipFile(io.BytesIO(data.getvalue()))


@pytest.fixture
def database(tmp_path, monkeypatch):
    metadata = {
        "LICENSE": "ODC Attribution License\n",
        "dbversion.json": {"version": 529},
        "types.json": {
            "C172": ["CESSNA 172 Skyhawk", "L1P", "L"],
            "A320": ["AIRBUS A-320", "L2J", "M"],
        },
        "operators.json": {"EZY": ["Easyjet Uk", "United Kingdom", "EASY"]},
    }
    detailed = {
        **metadata,
        "aircrafts.json": {
            "40621D": {"r": "G-TEST", "t": "C172", "f": "10", "d": 'Cessna; "Skyhawk"'},
            "000001": {"r": "N1", "t": "A320", "f": "00", "d": ""},
        },
    }
    compact = {**metadata, "aircrafts.json": {}}
    directory = tmp_path / "database"
    with archive(compact) as first, archive(detailed) as second:
        assert install(directory, first, second) == 2
    monkeypatch.setenv("GS_ADSB_DB_DIR", str(directory))
    monkeypatch.setattr(aircraft, "LOCAL_DATABASE", tmp_path / "absent-local")
    monkeypatch.setattr(aircraft, "BUNDLED_DATABASE", tmp_path / "absent-bundled")
    aircraft.aircraft_database.cache_clear()
    yield aircraft.aircraft_database()
    aircraft.aircraft_database.cache_clear()


def test_installer_converts_flags_without_reversing_bits_and_preserves_license(database):
    with gzip.open(database.path, "rt") as stream:
        rows = stream.read().splitlines()
    assert rows == [
        "000001;N1;A320;00;AIRBUS A-320;;;",
        "40621D;G-TEST;C172;10;Cessna, 'Skyhawk';;;",
    ]
    assert (database.path.parent / "LICENSE").read_text() == "ODC Attribution License\n"
    assert "Mictronics" in (database.path.parent / "NOTICE").read_text()
    assert database.info["version"] == 529


def test_enrichment_joins_type_and_operator_but_does_not_invent_ownership(database):
    metadata = aircraft.aircraft_metadata(
        {"r": "G-TEST", "t": "C172", "flight": "EZY123 ", "dbFlags": 3, "category": "A1"}, database
    )
    assert metadata["model"] == "CESSNA 172 Skyhawk"
    assert metadata["aircraft_class"] == "L"
    assert metadata["engine_count"] == 1
    assert metadata["engine_type"] == "P"
    assert metadata["wake_category"] == "L"
    assert metadata["military_status"] == "military"
    assert metadata["interesting"] is True
    assert metadata["category"] == "A1"
    assert metadata["operator_name"] == "Easyjet Uk"
    assert metadata["operator_country"] == "United Kingdom"
    assert metadata["operator_callsign"] == "EASY"
    assert metadata["operator_source"] == "callsign_prefix"
    assert metadata["owner"] is None
    assert metadata["year"] is None
    assert metadata["database"]["version"] == 529
    assert (
        aircraft.aircraft_metadata({"r": "G-TEST", "t": "C172"}, database)["interesting"] is False
    )


@pytest.mark.parametrize("flags", [None, 0, 2, True, "1", -1])
def test_missing_or_clear_military_flag_is_unclassified(database, flags):
    metadata = aircraft.aircraft_metadata(
        {"dbFlags": flags, "t": "UNKNOWN", "flight": "EZYABC"}, database
    )
    assert metadata["military_status"] == "unclassified"
    assert metadata["operator_name"] is None
    assert metadata["engine_count"] is None


def test_missing_or_corrupt_database_falls_back_to_bundled_snapshot(
    database, monkeypatch, tmp_path
):
    bad = tmp_path / "bad"
    bad.mkdir()
    (bad / "aircraft.csv.gz").write_bytes(b"invalid gzip")
    monkeypatch.setenv("GS_ADSB_DB_DIR", str(bad))
    monkeypatch.setattr(aircraft, "BUNDLED_DATABASE", database.path.parent)
    assert aircraft.AircraftDatabase().path == database.path
    monkeypatch.setattr(aircraft, "BUNDLED_DATABASE", tmp_path / "missing")
    assert aircraft.AircraftDatabase().path is None


def test_history_keeps_captured_metadata_and_enriches_legacy_readsb_reports(database, tmp_path):
    raw = {
        "hex": "40621d",
        "r": "G-TEST",
        "t": "C172",
        "flight": "EZY123",
        "seen_pos": 0,
        "lat": 40,
        "lon": 23,
    }
    record = aircraft_record(raw, 1793534400, {}, database)
    record["aircraft"]["database"] = {"version": "captured-version"}
    storage = AdsbStorage(tmp_path / "data/decoded", "test")
    storage.append("track", record)
    legacy = {**record, "timestamp": record["timestamp"] + 1}
    del legacy["aircraft"]
    storage.append("track", legacy)
    storage.flush()
    inventory = LibraryInventory(tmp_path)
    history = inventory.adsb_history("decoded_folder:adsb_40621d")
    assert history["records"][0]["aircraft"]["database"]["version"] == "captured-version"
    assert history["records"][1]["aircraft"]["operator_name"] == "Easyjet Uk"
    item = inventory._items["decoded_folder:adsb_40621d"]
    assert item["_positions"][0]["_details"]["telemetry"]["aircraft"]["registration"] == "G-TEST"
