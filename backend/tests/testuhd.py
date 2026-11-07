import queue
import threading
from types import SimpleNamespace
from unittest.mock import Mock

from hardware import uhdprobe
from workers import uhdworker


def test_worker_reports_discovered_serials_when_requested_one_is_missing(monkeypatch):
    found = [SimpleNamespace(to_string=lambda: "type=b200,serial=ABCD,addr=192.0.2.1")]
    monkeypatch.setattr(uhdworker, "uhd", SimpleNamespace(find=lambda _args: found))
    monkeypatch.setattr(uhdworker.time, "sleep", lambda _seconds: None)
    config_queue = queue.Queue()
    config_queue.put({"sdr_id": "usrp", "client_id": "viewer", "serial_number": "ABC"})
    data_queue = queue.Queue()

    uhdworker.uhd_worker_process(config_queue, data_queue, threading.Event())

    error = data_queue.get_nowait()
    assert error["type"] == "error"
    assert "UHD selecting device failed (serial=ABC)" in error["message"]
    assert "1 discovered device(s); available serials: ABCD" in error["message"]


def test_probe_reports_discovered_serials_when_requested_one_is_missing(monkeypatch):
    found = [SimpleNamespace(to_string=lambda: "type=b200,serial=ABCD,addr=192.0.2.1")]
    monkeypatch.setattr(uhdprobe, "uhd", SimpleNamespace(find=lambda _args: found))

    reply = uhdprobe.probe_local_uhd_usrp({"serial": "ABC"})

    assert reply["success"] is False
    assert "UHD selecting device failed (serial=ABC)" in reply["error"]
    assert "1 discovered device(s); available serials: ABCD" in reply["error"]


def test_worker_open_failure_keeps_native_exception(monkeypatch):
    def fail_open(_args):
        raise RuntimeError("No devices found for ----->\nDevice Address:")

    monkeypatch.setattr(
        uhdworker, "uhd", SimpleNamespace(usrp=SimpleNamespace(MultiUSRP=fail_open))
    )
    monkeypatch.setattr(uhdworker.time, "sleep", lambda _seconds: None)
    config_queue = queue.Queue()
    config_queue.put({"sdr_id": "usrp", "client_id": "viewer"})
    data_queue = queue.Queue()

    uhdworker.uhd_worker_process(config_queue, data_queue, threading.Event())

    error = data_queue.get_nowait()
    assert "UHD opening device failed" in error["message"]
    assert "RuntimeError: No devices found for ----->\nDevice Address:" in error["message"]


def test_native_worker_applies_explicit_controls_and_publishes_actual_settings(monkeypatch):
    stopped = threading.Event()
    configs, messages = queue.Queue(), queue.Queue()
    state = {
        "rate": 4e6,
        "frequency": 404e6,
        "gain": 15,
        "bandwidth": 56e6,
        "antenna": "TX/RX",
        "clock": "internal",
        "time": "internal",
    }
    bandwidth_requests, clock_requests = [], []

    def set_value(name):
        return lambda value, _channel=0: state.update({name: value})

    def set_bandwidth(value, _channel):
        bandwidth_requests.append(value)
        state["bandwidth"] = max(200_000, min(56e6, value))

    def set_clock(value, _board):
        clock_requests.append(value)
        state["clock"] = value

    def receive(buffer, _metadata, _timeout):
        buffer[:] = 0
        if configs.empty():
            # Deliver each change after the previous one reached the hardware;
            # preloading them would coalesce away the intermediate bandwidths.
            update = next(pending_configs, None)
            if update is None:
                stopped.set()
            else:
                configs.put(update)
        return buffer.shape[-1]

    streamer = SimpleNamespace(recv=receive, issue_stream_cmd=Mock())
    receiver = SimpleNamespace(
        get_pp_string=lambda: "B210",
        get_rx_stream=lambda _args: streamer,
        set_rx_antenna=set_value("antenna"),
        set_rx_gain=set_value("gain"),
        set_rx_freq=set_value("frequency"),
        set_rx_rate=set_value("rate"),
        set_rx_dc_offset=Mock(),
        set_rx_bandwidth=set_bandwidth,
        get_rx_rate=lambda _channel: state["rate"],
        get_rx_freq=lambda _channel: state["frequency"],
        get_rx_gain=lambda _channel: state["gain"],
        get_rx_antenna=lambda _channel: state["antenna"],
        get_rx_bandwidth=lambda _channel: state["bandwidth"],
        get_rx_bandwidth_range=lambda _channel: SimpleNamespace(
            start=lambda: 200_000, stop=lambda: 56e6, step=lambda: 0
        ),
        get_clock_sources=lambda _board: ["internal", "external"],
        get_time_sources=lambda _board: ["internal", "external"],
        get_clock_source=lambda _board: state["clock"],
        get_time_source=lambda _board: state["time"],
        set_clock_source=set_clock,
        set_time_source=set_value("time"),
    )
    fake_uhd = SimpleNamespace(
        usrp=SimpleNamespace(
            MultiUSRP=lambda _args: receiver, StreamArgs=lambda *_args: SimpleNamespace()
        ),
        types=SimpleNamespace(
            TuneRequest=lambda value: value,
            DeviceAddr=lambda value: value,
            StreamCMD=lambda mode: SimpleNamespace(mode=mode),
            StreamMode=SimpleNamespace(start_cont="start", stop_cont="stop"),
            RXMetadata=lambda: SimpleNamespace(error_code=0),
            RXMetadataErrorCode=SimpleNamespace(none=0, overflow=1),
        ),
    )
    monkeypatch.setattr(uhdworker, "uhd", fake_uhd)
    monkeypatch.setattr(uhdworker.time, "sleep", lambda _seconds: None)
    legacy = {
        "gains": {"PGA": 0},
        "clockSource": "external",
        "timeSource": "external",
        "bandwidth": 200_000,
    }
    configs.put(
        {
            "sdr_id": "radio",
            "sample_rate": 4e6,
            "gain": 15,
            "antenna": "TX/RX",
            "center_freq": 404e6,
            "sdr_settings": legacy,
        }
    )
    pending_configs = iter(
        [
            {
                "gain": 42,
                "sdr_settings": {
                    **legacy,
                    "uhd": {"clockSource": "external", "bandwidth": "auto"},
                },
            },
            {"sample_rate": 6e6},
            {
                "sdr_settings": {
                    **legacy,
                    "uhd": {"clockSource": "external", "bandwidth": "driver"},
                }
            },
        ]
    )
    uhdworker.uhd_worker_process(configs, messages, stopped)

    events = list(messages.queue)
    assert not [item for item in events if item["type"] in ("error", "config-failed")]
    assert bandwidth_requests == [4e6, 6e6, 56e6]
    assert clock_requests == ["external"]
    readbacks = [item["status"] for item in events if item["type"] == "receiver"]
    assert [item["bandwidth_hz"] for item in readbacks] == [56e6, 4e6, 6e6, 56e6]
    assert [item["sample_rate"] for item in readbacks] == [4e6, 4e6, 6e6, 6e6]
    assert readbacks[0]["gain_db"] == 15
    assert readbacks[0]["clock_source"] == "internal"
    assert readbacks[0]["bandwidth_hz"] == 56e6
    assert readbacks[-1]["gain_db"] == 42
    assert readbacks[-1]["antenna"] == "TX/RX"
    assert readbacks[-1]["clock_source"] == "external"
    assert readbacks[-1]["time_source"] == "internal"
