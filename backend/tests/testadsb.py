"""ADS-B timing, stream continuity and append-only capture/library contracts."""

import asyncio
import json
import queue
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import AsyncMock, Mock, patch

import numpy as np
import pytest

from common.adsb import aircraft_record
from common.adsbstorage import WINDOW_SECONDS, AdsbStorage
from common.auth import AUTHENTICATED_SOCKET_ROOM
from demodulators.adsbdecoder import AdsbChannel, AdsbDecoder
from library.inventory import LibraryInventory
from pipeline.config.decoderconfigservice import DecoderConfigService
from pipeline.orchestration.processmanager import ProcessManager

pytestmark = pytest.mark.unit
STAMP = 1793534400.0


def report(stamp=STAMP, address="406b90"):
    return aircraft_record(
        {
            "hex": address,
            "flight": "EZY85MH ",
            "seen": 0,
            "seen_pos": 0,
            "lat": 40.5,
            "lon": 23.1,
            "alt_baro": 10000,
            "gs": 200,
        },
        stamp,
        {"receiver_id": "rx01"},
    )


def decoder(root, **overrides):
    return AdsbDecoder(
        queue.Queue(),
        queue.Queue(),
        "manual",
        DecoderConfigService().get_config("adsb", overrides=overrides),
        str(root),
        1,
    )


def test_normalization_retains_readsb_units_and_position_age():
    result = report()
    assert result["altitude_baro_m"] == 3048
    assert result["groundspeed_mps"] == pytest.approx(102.88888888)
    assert result["callsign"] == "EZY85MH"
    assert result["readsb"]["alt_baro"] == 10000
    stale = aircraft_record({"hex": "406b90", "seen_pos": 12, "lat": 40, "lon": 23}, STAMP, {})
    assert stale["latitude"] is None
    assert stale["position_timestamp"] is None
    with pytest.raises(ValueError):
        aircraft_record({"hex": "~406b90"}, STAMP, {})


def test_config_validation_and_restart_identity():
    service = DecoderConfigService()
    first = service.get_config("adsb")
    assert first.adsb_save_interval == 5
    assert not first.adsb_capture_messages
    second = service.get_config("adsb", overrides={"adsb_capture_messages": True})
    assert first != second
    assert hash(first) != hash(second)
    for invalid in (True, -1, 1.5, "5"):
        with pytest.raises(ValueError):
            service.get_config("adsb", overrides={"adsb_save_interval": invalid})


def test_runs_share_fixed_windows_across_receivers(tmp_path):
    first = AdsbStorage(tmp_path, "rx01").directory("406B90", STAMP)
    assert first.parent.name == "adsb_406b90"
    assert first.name.endswith(".gsadsb")
    with ThreadPoolExecutor(max_workers=4) as pool:
        paths = list(
            pool.map(
                lambda i: AdsbStorage(tmp_path, f"rx{i}").directory("406b90", STAMP + i), range(4)
            )
        )
    assert set(paths) == {first}
    storage = AdsbStorage(tmp_path, "rx02")
    assert storage.directory("406b90", STAMP - 1) == first
    assert storage.directory("406b90", STAMP + WINDOW_SECONDS - 1) == first
    assert storage.directory("406b90", STAMP + WINDOW_SECONDS) != first
    assert storage.directory("406b90", STAMP + WINDOW_SECONDS - 0.1) == first
    with pytest.raises(ValueError):
        storage.directory("../../outside", STAMP)


def test_incremental_index_reads_only_new_complete_records(tmp_path):
    root = tmp_path / "data/decoded"
    storage = AdsbStorage(root, "rx01")
    storage.append("track", report())
    storage.flush()
    inventory = LibraryInventory(tmp_path)
    inventory.rebuild()
    item_id = "decoded_folder:adsb_406b90"
    initial = inventory.adsb_history(item_id)
    assert len(initial["records"]) == 1
    path = next(root.rglob("track_*.jsonl"))
    cached = inventory._adsb.folders[str(path.parent.parent)]["logs"][str(path)]
    assert cached["offset"] == path.stat().st_size
    next_record = json.dumps(report(STAMP + 5)).encode() + b"\n"
    with path.open("ab") as stream:
        stream.write(next_record[:20])
    # Live indexing must not invoke the storage-wide catalogue rebuild.
    with patch.object(inventory, "rebuild", side_effect=AssertionError("full scan")):
        inventory.update_adsb(["adsb_406b90"])
        assert inventory.get(item_id)["packet_count"] == 1
        with path.open("ab") as stream:
            stream.write(next_record[20:])
        changes = inventory.update_adsb(["adsb_406b90"])
        assert changes["changes"][0]["operation"] == "updated"
        assert inventory.get(item_id)["packet_count"] == 2
        delta = inventory.adsb_history(item_id, initial["cursor"])
        assert len(delta["records"]) == 1
        assert delta["records"][0]["timestamp"] == STAMP + 5
    inventory.rebuild()
    assert inventory.get(item_id)["packet_count"] == 2


def test_map_history_exposes_airframe_metadata_at_each_fix(tmp_path):
    storage = AdsbStorage(tmp_path / "data/decoded", "rx01")
    first = report()
    first.update(
        squawk="7700",
        emergency="general",
        altitude_geom_m=3100,
        vertical_rate_mps=6.35,
        on_ground=False,
    )
    first["aircraft"] = {
        "type_code": "A320",
        "type_description": "L2J",
        "engine_count": 2,
        "engine_type": "J",
        "wake_category": "M",
        "category": "A3",
        "database": {"version": 529},
        "operator_name": "Example operator",
    }
    storage.append("track", first)
    # A subsequent lookup correction must not rewrite the earlier map fix.
    storage.append("track", {**report(STAMP + 5), "aircraft": {"type_code": "B738"}})
    storage.flush()
    inventory = LibraryInventory(tmp_path)
    history = inventory.query_positions(first["captured_at"])
    assert [point["aircraft"]["type_code"] for point in history["positions"]] == [
        "A320",
        "B738",
    ]
    metadata = history["positions"][0]["aircraft"]
    assert metadata["type_description"] == "L2J"
    assert metadata["engine_count"] == 2
    assert metadata["category"] == "A3"
    assert "database" not in metadata
    assert "operator_name" not in metadata
    assert "_details" not in history["positions"][0]
    assert history["transmitters"][0]["details"]["telemetry"]["aircraft"]["type_code"] == "B738"
    # Public playback fixes preserve emergency reports and subsequent clears.
    assert history["positions"][0]["squawk"] == "7700"
    assert history["positions"][0]["emergency"] == "general"
    assert history["positions"][1]["squawk"] is None
    assert history["positions"][1]["emergency"] is None
    # Instrument values survive the public response without borrowing the last fix.
    assert history["positions"][0]["groundspeed_mps"] == first["groundspeed_mps"]
    assert history["positions"][0]["altitude_baro_m"] == 3048
    assert history["positions"][0]["altitude_geom_m"] == 3100
    assert history["positions"][0]["vertical_rate_mps"] == 6.35
    assert history["positions"][0]["on_ground"] is False
    assert history["positions"][1]["altitude_geom_m"] is None
    assert history["positions"][1]["vertical_rate_mps"] is None


@pytest.mark.asyncio
async def test_late_socket_binding_publishes_aircraft_and_library_changes(tmp_path, monkeypatch):
    inventory = LibraryInventory(tmp_path)
    inventory.rebuild()
    storage = AdsbStorage(tmp_path / "data/decoded", "rx01")
    record = report()
    storage.append("track", record)
    storage.flush()
    monkeypatch.setattr("pipeline.orchestration.adsb.get_inventory", lambda: inventory)
    monkeypatch.setattr("common.adsblive.aircraft", {})

    # Startup creates the manager before Socket.IO exists. Disable unrelated
    # monitoring and signal handlers while exercising that initialization order.
    with (
        patch("pipeline.orchestration.processmanager.PerformanceMonitor"),
        patch("pipeline.orchestration.processmanager.signal.signal"),
        patch.object(ProcessManager, "_start_metrics_emission"),
    ):
        manager = ProcessManager()
        socket = Mock(emit=AsyncMock())
        manager.set_sio(socket)

    publisher = manager.lifecycle_manager.adsb_publisher
    await publisher.publish([record])
    publisher.schedule(["adsb_406b90"])
    await asyncio.wait_for(publisher.task, timeout=2)

    socket.emit.assert_any_await("adsb.aircraft", {"aircraft": [record]}, room="adsb-live")
    library_events = [
        call for call in socket.emit.await_args_list if call.args[0] == "library.changed"
    ]
    assert len(library_events) == 1
    assert library_events[0].kwargs["room"] == AUTHENTICATED_SOCKET_ROOM
    assert library_events[0].args[1]["changes"][0]["item"]["packet_count"] == 1
    assert inventory.get("decoded_folder:adsb_406b90")["packet_count"] == 1


def test_saved_snapshots_do_not_repeat_an_old_position(tmp_path):
    worker = decoder(tmp_path)
    first = report()
    worker._save(first, 1)
    second = {**first, "timestamp": STAMP + 1}
    worker._save(second, 2)
    worker.storage.flush()
    records = [
        json.loads(line) for line in next(tmp_path.rglob("track_*.jsonl")).read_text().splitlines()
    ]
    assert records[0]["latitude"] == 40.5
    assert records[1]["latitude"] is None
    assert records[1]["readsb"]["lat"] == 40.5


def test_channel_preserves_chunk_boundaries_and_signed_iq():
    rng = np.random.default_rng(42)
    samples = (rng.normal(0, 0.1, 10000) + 1j * rng.normal(0, 0.1, 10000)).astype(np.complex64)
    whole = AdsbChannel(3_200_000, 100000).process(samples)
    channel = AdsbChannel(3_200_000, 100000)
    chunks = b"".join(channel.process(part) for part in np.array_split(samples, 17))
    np.testing.assert_allclose(np.frombuffer(chunks, "<i2"), np.frombuffer(whole, "<i2"), atol=1)
    assert len(whole) == 7500 * 4


def test_fleet_updates_are_batched_and_hidden_from_packet_history(tmp_path, monkeypatch):
    worker = decoder(tmp_path)
    worker.latest = {f"{i:06x}": report(STAMP, f"{i:06x}") for i in range(100)}
    worker.pending = dict(worker.latest)
    monkeypatch.setattr("demodulators.adsbdecoder.time.time", lambda: STAMP)
    monkeypatch.setattr("demodulators.adsbdecoder.time.monotonic", lambda: 100)
    for _ in range(100):
        worker._service()
    messages = []
    while not worker.data_queue.empty():
        messages.append(worker.data_queue.get_nowait())
    updates = [message for message in messages if message["type"] == "adsb-update"]
    assert len(updates) == 1
    assert len(updates[0]["aircraft"]) == 100
    assert not any(message["type"] == "decoder-output" for message in messages)


def test_raw_capture_requires_crc_and_does_not_guess_non_icao_addresses(tmp_path):
    worker = decoder(tmp_path, adsb_capture_messages=True)
    valid = b"*8D40621D58C382D690C8AC2863A7;"
    worker._raw_message(valid)
    worker._raw_message(b"*8D40621D58C382D690C8AC2863A6;")
    worker._raw_message(b"*00000000000000;")
    worker.storage.flush()
    records = [
        json.loads(line)
        for line in next(tmp_path.rglob("messages_*.jsonl")).read_text().splitlines()
    ]
    assert len(records) == 1
    assert records[0]["icao"] == "40621d"
    assert records[0]["validation"] == "crc24_valid_readsb_output"


def test_quiet_aircraft_saves_its_final_state_before_expiring(tmp_path, monkeypatch):
    worker = decoder(tmp_path)
    worker._save(report(), 1)
    worker.latest = {"406b90": report(STAMP + 1)}
    monkeypatch.setattr("demodulators.adsbdecoder.time.time", lambda: STAMP + 62)
    worker._service()
    records = [
        json.loads(line) for line in next(tmp_path.rglob("track_*.jsonl")).read_text().splitlines()
    ]
    assert [record["timestamp"] for record in records] == [STAMP, STAMP + 1]
    assert not worker.latest
    assert not worker.saved_timestamps


def test_history_cursor_resets_after_same_length_log_replacement(tmp_path):
    root = tmp_path / "data/decoded"
    storage = AdsbStorage(root, "rx01")
    storage.append("track", report())
    storage.flush()
    inventory = LibraryInventory(tmp_path)
    initial = inventory.adsb_history("decoded_folder:adsb_406b90")
    path = next(root.rglob("track_*.jsonl"))
    replacement = path.with_suffix(".tmp")
    replacement.write_text(json.dumps(report(STAMP + 5)) + "\n")
    replacement.replace(path)
    inventory.update_adsb(["adsb_406b90"])
    result = inventory.adsb_history("decoded_folder:adsb_406b90", initial["cursor"])
    assert result["reset"]
    assert len(result["records"]) == 1
    assert result["records"][0]["timestamp"] == STAMP + 5


def test_missing_readsb_reports_a_decoder_error(tmp_path, monkeypatch):
    worker = decoder(tmp_path)
    monkeypatch.setattr(worker, "_binary", lambda: None)
    worker.run()
    assert worker.status == "error"
    assert not worker.running.value
    assert worker.child is None


def test_retune_and_iq_gaps_restart_the_child(tmp_path, monkeypatch, caplog):
    worker = decoder(tmp_path)
    starts = []
    stops = []
    monkeypatch.setattr(worker, "_start", lambda: starts.append(worker.channel_key))
    monkeypatch.setattr(worker, "_stop_child", lambda: stops.append(True))
    monkeypatch.setattr(worker, "_write", lambda _: None)
    message = {
        "samples": np.zeros(1000, dtype=np.complex64),
        "sample_rate": 2_400_000,
        "center_freq": 1_090_000_000,
        "iq_sequence": 1,
        "vfo_states": {1: {"active": True, "center_freq": 1_090_000_000}},
    }
    worker._process_iq(message)
    worker._process_iq({**message, "iq_sequence": 2})
    assert len(starts) == 1
    worker._process_iq({**message, "iq_sequence": 4})
    assert len(starts) == 2
    assert "sequence 2 -> 4" in caplog.text
    worker._process_iq({**message, "iq_sequence": 5, "center_freq": 1_080_000_000})
    assert worker.status == "sleeping"
    assert worker.channel is None
    assert len(stops) == 3
