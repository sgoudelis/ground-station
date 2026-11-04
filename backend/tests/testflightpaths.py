"""Full-flight paths stay independent of packet pagination and capture summary."""

import json
from datetime import datetime, timedelta, timezone

import pytest

from common.adsb import aircraft_record
from common.adsbstorage import AdsbStorage
from handlers.entities import library
from library.flightpaths import POINT_BUDGET, build_flight_paths
from library.inventory import LibraryInventory

pytestmark = pytest.mark.unit
STAMP = 1793534400.0


def fix(index, run="first", *, seconds=None, longitude=23):
    return {
        "id": str(index),
        "_run": run,
        "captured_at": (
            datetime(2026, 11, 1, tzinfo=timezone.utc)
            + timedelta(seconds=index if seconds is None else seconds)
        ).isoformat(timespec="microseconds"),
        "latitude": 0,
        "longitude": longitude,
        "altitude": 1000,
    }


def test_runs_gaps_and_dateline_are_never_connected():
    points = [
        fix(0),
        fix(1),
        fix(2, seconds=1000),
        fix(3, seconds=1001, longitude=179),
        fix(4, seconds=1002, longitude=-179),
        fix(5, "second"),
    ]
    result = build_flight_paths(list(reversed(points)))
    assert result["point_count"] == result["displayed_points"] == 6
    assert [len(segment) for segment in result["flights"][0]["segments"]] == [2, 2, 1]
    assert result["flights"][1]["run"] == "second"
    assert result["flights"][0]["segments"][0][0]["latitude"] == 0
    assert "_run" not in result["flights"][0]["segments"][0][0]


def test_sampling_preserves_every_segment_endpoint_and_counts():
    points = [fix(index) for index in range(12000)] + [fix(14000), fix(14001), fix(0, "second")]
    result = build_flight_paths(points)
    assert result["sampled"]
    assert result["point_count"] == 12003
    assert result["displayed_points"] == POINT_BUDGET
    first, after_gap = result["flights"][0]["segments"]
    assert first[0]["captured_at"] == points[0]["captured_at"]
    assert first[-1]["captured_at"] == points[11999]["captured_at"]
    assert len(after_gap) == 2
    assert len(result["flights"][1]["segments"][0]) == 1
    assert build_flight_paths([])["flights"] == []


def test_aircraft_paths_use_all_saved_fixes_and_follow_live_append(tmp_path):
    storage = AdsbStorage(tmp_path / "data/decoded", "rx01")

    def append(stamp, address="406b90", **fields):
        storage.append(
            "track",
            aircraft_record(
                {"hex": address, "seen": 0, "seen_pos": 0, "lat": 0, "lon": 0, **fields},
                stamp,
                {"receiver_id": "rx01"},
            ),
        )

    for index in range(70):
        append(STAMP + index)
    append(STAMP + 80000)
    append(STAMP, "123456")
    storage.flush()
    inventory = LibraryInventory(tmp_path)
    inventory.rebuild()
    item_id = "decoded_folder:adsb_406b90"
    paths = inventory.flight_paths(item_id)
    assert paths["point_count"] == 71
    assert len(paths["flights"]) == 2
    assert len(inventory.adsb_history(item_id)["records"]) == 50
    run = paths["flights"][0]["run"]
    assert inventory.flight_paths(item_id, run)["point_count"] == 70
    assert inventory.flight_paths(item_id, "missing")["point_count"] == 0
    append(STAMP + 80001)
    storage.flush()
    inventory.update_adsb(["adsb_406b90"])
    assert inventory.flight_paths(item_id)["point_count"] == 72
    assert inventory.flight_paths(item_id)["revision"] > paths["revision"]
    # Private grouping data must not leak into the existing global map protocol.
    assert all(
        "_run" not in point
        for point in inventory.query_positions("2026-01-01T00:00:00Z")["positions"]
    )


def test_sonde_legacy_runs_missing_and_encrypted_fixes(tmp_path):
    folder = tmp_path / "data/decoded/radiosonde_RS41_TEST"
    for index, (member, readings) in enumerate(
        [
            ("legacy.bin", {"lat": 0, "lon": 0}),
            ("flight/a.bin", {"lat": 40, "lon": 23}),
            ("flight/b.bin", {"lat": 0, "lon": 0, "encrypted": True}),
            ("flight/c.bin", {"lat": 91, "lon": 23}),
            ("flight/d.bin", {"lat": None, "lon": 23}),
        ]
    ):
        path = folder / member
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"sonde")
        values = {"type": "RS41", "id": "TEST", **readings}
        path.with_suffix(".json").write_text(
            json.dumps(
                {
                    "decoder": {"type": "radiosonde"},
                    "packet": {"timestamp": STAMP + index},
                    "parse_context": {"decoder_report": values},
                    "telemetry": {
                        "parser_id": "radiosonde_rs",
                        "schema_version": 1,
                        "success": True,
                        "payload": {"records": [{"groups": [{"values": values}]}]},
                    },
                }
            )
        )
    inventory = LibraryInventory(tmp_path)
    result = inventory.flight_paths("decoded_folder:radiosonde_RS41_TEST")
    assert result["point_count"] == 2
    assert {flight["run"] for flight in result["flights"]} == {"legacy", "flight"}
    assert (
        inventory.flight_paths("decoded_folder:radiosonde_RS41_TEST", "legacy")["point_count"] == 1
    )
    (folder / "legacy.bin").unlink()
    inventory.rebuild()
    assert inventory.flight_paths("decoded_folder:radiosonde_RS41_TEST")["point_count"] == 1


@pytest.mark.parametrize(
    "item_id,run,error",
    [(None, None, "id is required"), ("gone", 2, "run must"), ("gone", None, "not found")],
)
async def test_rpc_returns_useful_validation_errors(tmp_path, monkeypatch, item_id, run, error):
    inventory = LibraryInventory(tmp_path)
    monkeypatch.setattr(library, "get_inventory", lambda: inventory)
    response = await library.flight_paths(None, {"id": item_id, "run": run}, None, "sid")
    assert not response["success"]
    assert error in response["error"]


async def test_rpc_registers_and_returns_paths_and_rejects_other_items(tmp_path, monkeypatch):
    inventory = LibraryInventory(tmp_path)
    inventory.rebuild()
    inventory._items["other"] = {"folder_kind": "meshtastic"}
    monkeypatch.setattr(library, "get_inventory", lambda: inventory)
    response = await library.flight_paths(None, {"id": "other"}, None, "sid")
    assert not response["success"]
    inventory._items["flight"] = {"folder_kind": "adsb", "_positions": [fix(0)]}
    response = await library.flight_paths(None, {"id": "flight"}, None, "sid")
    assert response["success"] and response["data"]["point_count"] == 1
    registered = {}

    class Registry:
        def register_batch(self, handlers):
            registered.update(handlers)

    library.register_handlers(Registry())
    assert registered["filebrowser.flightpaths"][0] is library.flight_paths


def test_overlapping_receivers_are_sorted_and_deleted_logs_disappear(tmp_path):
    root = tmp_path / "data/decoded"
    first = AdsbStorage(root, "rx01")
    second = AdsbStorage(root, "rx02")
    for storage, offsets in [(first, [0, 20]), (second, [10, 30])]:
        for offset in offsets:
            record = aircraft_record(
                {"hex": "406b90", "seen_pos": 0, "lat": offset, "lon": 23}, STAMP + offset, {}
            )
            storage.append("track", record)
        storage.flush()
    inventory = LibraryInventory(tmp_path)
    item_id = "decoded_folder:adsb_406b90"
    path = inventory.flight_paths(item_id)["flights"][0]["segments"][0]
    assert [point["latitude"] for point in path] == [0, 10, 20, 30]
    logs = sorted(root.rglob("track_*.jsonl"))
    assert len(logs) == 2
    logs[0].unlink()
    inventory.update_adsb(["adsb_406b90"])
    assert inventory.flight_paths(item_id)["point_count"] == 2


def test_very_fragmented_tracks_keep_every_segment_without_joining_gaps():
    points = [fix(index, seconds=index * 1000) for index in range(POINT_BUDGET + 1)]
    result = build_flight_paths(points)
    assert not result["sampled"]
    assert result["displayed_points"] == len(points)
    assert len(result["flights"][0]["segments"]) == len(points)
