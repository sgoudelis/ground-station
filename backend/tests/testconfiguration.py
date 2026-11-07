# Copyright (c) 2026 Efstratios Goudelis

import queue
import threading
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from workers.configuration import ConfigurationInbox, report_configuration_failure


def test_pending_tunes_merge_partial_settings_and_keep_latest_revision():
    updates = queue.Queue()
    updates.put({"center_freq": 146e6, "config_revision": 1})
    updates.put({"gain": 10, "sdr_settings": {"gains": {"RFGR": 4}}})
    updates.put({"center_freq": 147e6, "config_revision": 2})
    updates.put({"sdr_settings": {"gains": {}}})
    inbox = ConfigurationInbox(updates)
    assert inbox.get() == {
        "center_freq": 147e6,
        "gain": 10,
        "config_revision": 2,
        "sdr_settings": {"gains": {}},
    }
    assert inbox.get() is None


def test_control_queries_and_seeks_are_ordering_boundaries():
    updates = queue.Queue()
    query = {"type": "get_center_freq", "response_queue": queue.Queue()}
    for update in ({"center_freq": 146e6}, query, {"center_freq": 147e6}, {"seek_seconds": 10}):
        updates.put(update)
    inbox = ConfigurationInbox(updates)
    assert inbox.get() == {"center_freq": 146e6}
    assert inbox.get() == query
    assert inbox.get() == {"center_freq": 147e6}
    assert inbox.get() == {"seek_seconds": 10}
    assert inbox.get() is None


def test_failed_tuning_reports_measured_logical_frequency_and_request_revision():
    messages = queue.Queue()
    report_configuration_failure(
        messages,
        {"config_revision": 4},
        {"frequency_hz": 150e6, "sample_rate": 2e6},
        "Setter failed",
        offset=5e6,
    )
    failure = messages.get_nowait()
    assert failure["type"] == "config-failed"
    assert failure["config_revision"] == 4
    assert failure["measured_config"] == {"center_freq": 145e6, "sample_rate": 2e6}


@pytest.mark.parametrize("fails", [False, True])
def test_uhd_worker_applies_only_final_queued_tune_and_reports_completion(monkeypatch, fails):
    from workers import uhdworker as worker

    stopped = threading.Event()
    receiver = Mock()
    actual_frequency = 145e6
    frequencies = []

    def set_frequency(frequency, _channel):
        nonlocal actual_frequency
        frequencies.append(frequency)
        if fails and frequency == 148e6:
            raise RuntimeError("Device rejected tune")
        actual_frequency = frequency

    def receive(buffer, *_args):
        stopped.set()
        return buffer.shape[1]

    receiver.set_rx_freq.side_effect = set_frequency
    receiver.get_rx_freq.side_effect = lambda *_args: actual_frequency
    receiver.get_rx_rate.return_value = 2e6
    receiver.get_rx_gain.return_value = 10
    streamer = SimpleNamespace(issue_stream_cmd=Mock(), recv=receive)
    receiver.get_rx_stream.return_value = streamer
    bindings = SimpleNamespace(
        usrp=SimpleNamespace(
            MultiUSRP=lambda _args: receiver, StreamArgs=lambda *_args: SimpleNamespace()
        ),
        types=SimpleNamespace(
            TuneRequest=lambda frequency: frequency,
            StreamCMD=lambda mode: SimpleNamespace(mode=mode),
            StreamMode=SimpleNamespace(start_cont=1, stop_cont=0),
            DeviceAddr=lambda args: args,
            RXMetadata=lambda: SimpleNamespace(error_code=0),
            RXMetadataErrorCode=SimpleNamespace(none=0, overflow=1),
        ),
    )
    monkeypatch.setattr(worker, "uhd", bindings)
    monkeypatch.setattr(worker.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(worker, "apply_uhd_sources", lambda *_args: {})
    monkeypatch.setattr(worker, "UhdBandwidth", lambda device: device)
    monkeypatch.setattr(worker, "read_bandwidth", lambda *_args: 2e6)
    monkeypatch.setattr(worker, "apply_bandwidth", lambda *_args: {"actual_hz": 2e6})
    monkeypatch.setattr(
        worker,
        "read_uhd_receiver",
        lambda *_args: {
            "frequency_hz": actual_frequency,
            "sample_rate": 2e6,
        },
    )
    updates, messages = queue.Queue(), queue.Queue()
    updates.put({"sdr_id": "radio", "center_freq": 145e6, "sample_rate": 2e6})
    for revision, frequency in enumerate((146e6, 147e6, 148e6), 1):
        updates.put({"center_freq": frequency, "config_revision": revision})
    worker.uhd_worker_process(updates, messages, stopped)

    assert frequencies == [145e6, 148e6]
    events = list(messages.queue)
    completions = [
        event for event in events if event["type"] in ("config-applied", "config-failed")
    ]
    assert len(completions) == 1
    assert completions[0]["config_revision"] == 3
    assert completions[0]["type"] == ("config-failed" if fails else "config-applied")
    if fails:
        assert completions[0]["measured_config"]["center_freq"] == 145e6
