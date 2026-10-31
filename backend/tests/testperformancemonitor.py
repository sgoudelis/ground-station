import queue
import threading

import pytest

from monitoring.performancemonitor import PerformanceMonitor


class APRSDecoder:
    """Minimal process-decoder shape before its first child stats update."""

    def __init__(self):
        self.iq_queue = queue.Queue(maxsize=10)
        self.stats_lock = threading.Lock()
        self.stats = {}

    def is_alive(self):
        return True


def test_poll_decoders_keeps_starting_process_decoder_visible_without_stats():
    monitor = PerformanceMonitor.__new__(PerformanceMonitor)
    monitor.previous_snapshots = {}
    decoder = APRSDecoder()

    metrics = monitor._poll_decoders(
        "sdr-1",
        {"decoders": {"session-1": {1: {"instance": decoder}}}},
        time_delta=2.0,
    )

    entry = metrics["session-1_vfo1"]
    assert entry["type"] == "APRSDecoder"
    assert entry["is_alive"] is True
    assert entry["input_queue_size"] == 0
    assert entry["connections"] == [{"source_type": "iq_broadcaster", "source_id": "iq_sdr-1"}]


@pytest.mark.parametrize("decoder_type", ["RadiosondeDecoder", "LoRaDecoder", "NewDecoder"])
@pytest.mark.parametrize("has_stats", [False, True])
def test_decoder_input_capability_connects_iq_consumers_and_reports_iq_rates(
    decoder_type, has_stats
):
    monitor = PerformanceMonitor.__new__(PerformanceMonitor)
    monitor.previous_snapshots = {}
    decoder = type(decoder_type, (APRSDecoder,), {})()
    stats = {"iq_chunks_in": 12, "samples_in": 48000, "data_messages_out": 2} if has_stats else {}

    metrics = monitor._poll_decoders(
        "sdr-2",
        {
            "decoders": {
                "session-1": {2: {"instance": decoder, "needs_raw_iq": True, "stats": stats}}
            }
        },
        time_delta=2.0,
    )

    entry = metrics["session-1_vfo2"]
    assert entry["connections"] == [{"source_type": "iq_broadcaster", "source_id": "iq_sdr-2"}]
    assert entry["rates"]["iq_chunks_in_per_sec"] == (6 if has_stats else 0)
    assert entry["rates"]["iq_samples_in_per_sec"] == (24000 if has_stats else 0)
    assert "audio_samples_in_per_sec" not in entry["rates"]


def test_explicit_audio_input_capability_takes_precedence_over_legacy_type_fallback():
    monitor = PerformanceMonitor.__new__(PerformanceMonitor)
    monitor.previous_snapshots = {}

    metrics = monitor._poll_decoders(
        "sdr-1",
        {"decoders": {"session-1": {1: {"instance": APRSDecoder(), "needs_raw_iq": False}}}},
        time_delta=2.0,
    )

    entry = metrics["session-1_vfo1"]
    assert entry["connections"] == [
        {"source_type": "audio_broadcaster", "source_id": "audio_session-1_1"}
    ]
    assert "audio_samples_in_per_sec" in entry["rates"]
    assert "iq_samples_in_per_sec" not in entry["rates"]
