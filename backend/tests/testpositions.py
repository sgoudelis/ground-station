"""Geographic queries use saved interpretations and portable capture dates."""

import json
import logging
from datetime import datetime

import pytest

from handlers.entities import library
from library.inventory import LibraryInventory
from telemetry.result import normalize_result

pytestmark = pytest.mark.unit


def aprs(lat=49.058333, lon=-72.029167, name=None):
    data = {"format": "aprs", "position": {"latitude": lat, "longitude": lon}}
    if name:
        data["object"] = {"name": name, "alive": True}
    return {
        "decoder": {"type": "aprs"},
        "telemetry": normalize_result(
            {
                "success": True,
                "frame": {"source": "TEST-1"},
                "telemetry": data,
            },
            "aprs",
        ),
    }


def sonde(**extra):
    return {
        "decoder": {"type": "radiosonde"},
        "telemetry": normalize_result(
            {
                "success": True,
                "telemetry": {
                    "format": "radiosonde",
                    "field_info": {"temp": {"label": "Temperature", "unit": "°C"}},
                    "values": {
                        "type": "RS41",
                        "id": "SONDE42",
                        "lat": 40.5,
                        "lon": 23.1,
                        "alt": 12000,
                        **extra,
                    },
                },
            },
            "radiosonde_rs",
        ),
    }


def save(root, name, metadata, timestamp="2026-11-01T10:00:00Z"):
    folder = root / "data" / "decoded"
    folder.mkdir(parents=True, exist_ok=True)
    (folder / f"{name}.bin").write_bytes(b"packet")
    metadata["packet"] = {"timestamp_iso": timestamp}
    (folder / f"{name}.json").write_text(json.dumps(metadata))


def test_positions_filter_reception_dates_and_preserve_transmitters(tmp_path):
    save(tmp_path, "first", aprs(), "2026-10-31T22:00:00-02:00")
    save(tmp_path, "second", aprs(lat=49.1), "2026-11-01T01:00:00Z")
    save(tmp_path, "sonde", sonde(), "2026-11-01T02:00:00Z")
    inventory = LibraryInventory(tmp_path)
    result = inventory.query_positions("2026-11-01T00:00:00Z", "2026-11-01T01:00:00Z")
    assert [point["file_id"] for point in result["positions"]] == [
        "decoded:first.bin",
        "decoded:second.bin",
    ]
    assert len({point["transmitter_id"] for point in result["positions"]}) == 1
    assert result["available_range"] == {
        "start": "2026-11-01T00:00:00.000000+00:00",
        "end": "2026-11-01T02:00:00.000000+00:00",
    }
    # Exact endpoints and epoch dates have the same semantics.
    timestamp = datetime.fromisoformat("2026-11-01T02:00:00+00:00").timestamp()
    point = inventory.query_positions(timestamp, timestamp)["positions"][0]
    assert point["name"] == "SONDE42"
    assert point["altitude"] == 12000
    assert all(not key.startswith("_") for key in point)
    assert all(not key.startswith("_") for key in inventory.get("decoded:first.bin"))
    assert "positions" not in inventory.get("decoded:first.bin")


def test_transmitter_rows_include_latest_measurements_without_repeating_details_on_tracks(tmp_path):
    first = sonde(temp=-12, humidity=65)
    first["signal"] = {"frequency_hz": 403200000, "signal_power_dbfs": -75}
    save(tmp_path, "first", first, "2026-11-01T01:00:00Z")
    latest = sonde(temp=-20, humidity=45, vel_h=12, vel_v=5, heading=80)
    latest["signal"] = {"frequency_hz": 403200000, "signal_power_dbfs": -70}
    save(tmp_path, "last", latest, "2026-11-01T02:00:00Z")
    save(tmp_path, "station", aprs(), "2026-11-01T03:00:00Z")
    inventory = LibraryInventory(tmp_path)
    result = inventory.query_positions("2026-11-01T00:00:00Z", "2026-11-01T04:00:00Z")
    assert len(result["transmitters"]) == 2
    row = next(row for row in result["transmitters"] if row["kind"] == "radiosonde")
    assert row["id"] == "radiosonde:RS41:SONDE42"
    assert row["packet_count"] == 2
    assert row["first_seen"] == "2026-11-01T01:00:00.000000+00:00"
    assert row["last_seen"] == "2026-11-01T02:00:00.000000+00:00"
    assert row["file_id"] == "decoded:last.bin"
    assert row["details"]["telemetry"]["temp"] == -20
    assert row["details"]["telemetry"]["vel_h"] == 12
    assert row["details"]["signal"]["signal_power_dbfs"] == -70
    assert row["field_info"]["temp"]["unit"] == "°C"
    assert all("details" not in point and "_details" not in point for point in result["positions"])
    # Preserve the readings on each fix so playback gauges cannot borrow
    # the latest packet's speed or heading for an earlier position.
    fixes = [point for point in result["positions"] if point["kind"] == "radiosonde"]
    assert fixes[0]["groundspeed_mps"] is None
    assert fixes[0]["vertical_rate_mps"] is None
    assert fixes[0]["track_deg"] is None
    assert fixes[1]["groundspeed_mps"] == 12
    assert fixes[1]["vertical_rate_mps"] == 5
    assert fixes[1]["track_deg"] == 80
    restricted = inventory.query_positions("2026-11-01T00:00:00Z", "2026-11-01T01:00:00Z")
    assert restricted["transmitters"][0]["packet_count"] == 1
    assert restricted["transmitters"][0]["details"]["telemetry"]["temp"] == -12


def test_aprs_positions_preserve_each_packets_symbol_for_playback(tmp_path):
    first = aprs()
    first["telemetry"]["payload"]["aprs"]["position"].update(symbol_table="/", symbol_code=">")
    last = aprs(lat=49.1)
    last["telemetry"]["payload"]["aprs"]["position"].update(symbol_table="/", symbol_code="-")
    save(tmp_path, "first", first, "2026-11-01T01:00:00Z")
    save(tmp_path, "last", last, "2026-11-01T02:00:00Z")
    save(tmp_path, "generic", aprs(name="Unknown"), "2026-11-01T03:00:00Z")

    result = LibraryInventory(tmp_path).query_positions("2026-11-01T00:00:00Z")
    assert [(point["symbol_table"], point["symbol_code"]) for point in result["positions"]] == [
        ("/", ">"),
        ("/", "-"),
        (None, None),
    ]
    assert result["transmitters"][0]["details"]["telemetry"]["position"]["symbol_code"] == "-"


def test_invalid_and_encrypted_positions_are_omitted_and_legacy_aprs_is_adapted(tmp_path):
    save(tmp_path, "encrypted", sonde(encrypted=True))
    save(tmp_path, "badlatitude", aprs(lat=91))
    save(tmp_path, "badlongitude", aprs(lon=-181))
    save(tmp_path, "bool", aprs(lat=True))
    save(tmp_path, "nan", aprs(lat=float("nan")))
    save(tmp_path, "broken", {"telemetry": {"payload": 123}})
    save(
        tmp_path,
        "legacy",
        {
            "decoder": {"type": "aprs"},
            "ax25": {"from_callsign": "OLD-1"},
            "telemetry": {
                "success": True,
                "parser": "aprs",
                "telemetry": {
                    "format": "text",
                    "ascii": "!4903.50N/07201.75W-Test",
                },
            },
        },
        "2026-11-01T09:00:00Z",
    )
    save(tmp_path, "object", aprs(name="Balloon"))
    result = LibraryInventory(tmp_path).query_positions(
        "2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z"
    )
    assert [point["name"] for point in result["positions"]] == ["OLD-1", "Balloon"]
    assert result["positions"][0]["latitude"] == pytest.approx(49.058333, abs=1e-5)
    assert result["positions"][1]["transmitter_id"] == "aprs:TEST-1:Balloon"


def test_positions_follow_inventory_reconciliation_and_deletion(tmp_path):
    inventory = LibraryInventory(tmp_path)
    bounds = ("2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z")
    assert inventory.query_positions(*bounds)["available_range"] is None
    save(tmp_path, "packet", sonde())
    inventory.rebuild()
    assert inventory.query_positions(*bounds)["total"] == 1
    inventory.delete(["decoded:packet.bin"])
    assert inventory.query_positions(*bounds)["total"] == 0


def test_live_positions_keep_start_and_include_new_transmitters_without_an_end(tmp_path):
    save(tmp_path, "earlier", aprs(), "2026-10-31T23:59:59Z")
    save(tmp_path, "first", sonde(), "2026-11-01T00:00:00Z")
    inventory = LibraryInventory(tmp_path)
    start = "2026-11-01T00:00:00Z"
    assert inventory.query_positions(start, None)["total"] == 1

    save(tmp_path, "new", sonde(id="NEWSONDE", lat=42), "2026-11-02T03:00:00Z")
    inventory.rebuild()
    live = inventory.query_positions(start)
    assert [point["name"] for point in live["positions"]] == ["SONDE42", "NEWSONDE"]
    assert len(live["transmitters"]) == 2
    assert inventory.query_positions(start, "2026-11-01T12:00:00Z")["total"] == 1


def test_observation_positions_use_packet_dates_and_follow_bundle_deletion(tmp_path):
    folder = tmp_path / "data" / "observations" / "station.gsobs"
    decoded = folder / "decoded"
    decoded.mkdir(parents=True)
    (folder / "manifest.json").write_text(
        json.dumps({"created_at": "2026-10-31T23:00:00Z", "status": "complete"})
    )
    for name, metadata in (("aprs", aprs()), ("sonde", sonde())):
        (decoded / f"{name}.bin").write_bytes(b"packet")
        metadata["packet"] = {"timestamp_iso": "2026-11-01T01:00:00Z"}
        (decoded / f"{name}.json").write_text(json.dumps(metadata))
    # A sidecar without a saved packet must not create a phantom map position.
    (decoded / "orphan.json").write_text(json.dumps(sonde()))
    inventory = LibraryInventory(tmp_path)
    bounds = ("2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z")
    result = inventory.query_positions(*bounds)
    assert {point["kind"] for point in result["positions"]} == {"aprs", "radiosonde"}
    assert {point["file_id"] for point in result["positions"]} == {
        "observation:station.gsobs/decoded/aprs.bin",
        "observation:station.gsobs/decoded/sonde.bin",
    }
    assert result["available_range"] == {
        "start": "2026-11-01T01:00:00.000000+00:00",
        "end": "2026-11-01T01:00:00.000000+00:00",
    }
    assert "_positions" not in inventory.get("observation:station.gsobs")
    inventory.delete(["observation:station.gsobs"])
    assert inventory.query_positions(*bounds)["total"] == 0


@pytest.mark.parametrize(
    "start,end",
    [
        (None, None),
        ("2026-11-01", "2026-11-02"),
        ("bad", "2026-11-02T00:00:00Z"),
        ("2026-11-01T00:00:00Z", "bad"),
        ("2026-11-01T00:00:00Z", ""),
        ("bad", None),
        ("2026-11-02T00:00:00Z", "2026-11-01T00:00:00Z"),
    ],
)
async def test_position_rpc_rejects_invalid_intervals(tmp_path, monkeypatch, start, end):
    monkeypatch.setattr(library, "get_inventory", lambda: LibraryInventory(tmp_path))
    reply = await library.query_positions(
        None, {"start": start, "end": end}, logging.getLogger(), "client"
    )
    assert reply["success"] is False


async def test_position_rpc_returns_dated_packets(tmp_path, monkeypatch):
    save(tmp_path, "packet", sonde())
    monkeypatch.setattr(library, "get_inventory", lambda: LibraryInventory(tmp_path))
    reply = await library.query_positions(
        None,
        {"start": "2026-11-01T00:00:00Z", "end": "2026-11-02T00:00:00Z"},
        logging.getLogger(),
        "client",
    )
    assert reply["success"] is True
    assert reply["data"]["positions"][0]["kind"] == "radiosonde"


@pytest.mark.parametrize("include_end", [True, False])
async def test_position_rpc_accepts_null_or_omitted_end_for_live(
    tmp_path, monkeypatch, include_end
):
    save(tmp_path, "packet", sonde())
    monkeypatch.setattr(library, "get_inventory", lambda: LibraryInventory(tmp_path))
    request = {"start": "2026-11-01T00:00:00Z"}
    if include_end:
        request["end"] = None
    reply = await library.query_positions(None, request, logging.getLogger(), "client")
    assert reply["success"] is True
    assert reply["data"]["positions"][0]["kind"] == "radiosonde"
