# Copyright (c) 2026 Efstratios Goudelis

import asyncio
import queue
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from monitoring import performancemonitor
from tracker import messages

pytestmark = pytest.mark.unit


@pytest.fixture
def tracker_metrics(monkeypatch):
    stats = {}
    alive = set()
    supervisor = SimpleNamespace(is_alive=alive.__contains__)
    for module in (performancemonitor, messages):
        monkeypatch.setattr(module, "tracker_stats", stats)
        monkeypatch.setattr(module, "get_tracker_supervisor", lambda: supervisor)
    return SimpleNamespace(stats=stats, alive=alive, supervisor=supervisor)


def test_finished_trackers_disappear_from_metrics_and_rate_history(monkeypatch, tracker_metrics):
    monitor = performancemonitor.PerformanceMonitor.__new__(performancemonitor.PerformanceMonitor)
    monitor.previous_snapshots = {
        "tracker_target-1": {"updates_sent": 10},
        "tracker_obs-running": {"updates_sent": 4},
        "tracker_obs-finished": {"updates_sent": 40},
        "tracker_obs-already-pruned": {"updates_sent": 20},
        "worker_sdr-1": {"samples_read": 100},
    }
    tracker_metrics.alive.update({"target-1", "obs-running"})
    tracker_metrics.stats.update(
        {
            "target-1": {"updates_sent": 14},
            "obs-running": {"updates_sent": 6},
            "obs-finished": {"updates_sent": 40, "memory_mb": 3000},
        }
    )
    monkeypatch.setattr(performancemonitor, "SESSIONS", {"browser-1": {}})

    metrics = monitor._poll_trackers(time_delta=2.0)

    assert set(metrics) == {"target-1", "obs-running"}
    assert metrics["target-1"]["rates"]["updates_per_sec"] == 2.0
    assert metrics["obs-running"]["rates"]["updates_per_sec"] == 1.0
    assert all(entry["is_alive"] for entry in metrics.values())
    assert metrics["target-1"]["connections"] == [
        {"target_type": "browser", "target_id": "browser-1"}
    ]
    assert set(monitor.previous_snapshots) == {
        "tracker_target-1",
        "tracker_obs-running",
        "worker_sdr-1",
    }

    # Cleanup can remove the stats before the next performance poll.
    tracker_metrics.alive.remove("obs-running")
    tracker_metrics.stats.pop("obs-running")
    assert set(monitor._poll_trackers(time_delta=2.0)) == {"target-1"}
    assert set(monitor.previous_snapshots) == {"tracker_target-1", "worker_sdr-1"}


def test_stats_arriving_during_poll_do_not_interrupt_tracker_metrics(tracker_metrics):
    monitor = performancemonitor.PerformanceMonitor.__new__(performancemonitor.PerformanceMonitor)
    monitor.previous_snapshots = {}
    tracker_metrics.stats.update({"target-1": {"updates_sent": 2}, "target-2": {"updates_sent": 4}})

    def is_alive(tracker_id):
        tracker_metrics.stats["obs-starting"] = {"updates_sent": 1}
        return True

    tracker_metrics.supervisor.is_alive = is_alive

    assert set(monitor._poll_trackers(time_delta=2.0)) == {"target-1", "target-2"}
    assert set(monitor._poll_trackers(time_delta=2.0)) == {
        "target-1",
        "target-2",
        "obs-starting",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("message_tracker_id", ["target-1", "obs-finished"])
async def test_message_handler_retires_stats_and_ignores_late_updates(
    monkeypatch, tracker_metrics, message_tracker_id
):
    tracker_metrics.alive.add("target-1")
    tracker_metrics.stats.update(
        {"target-1": {"updates_sent": 2}, "obs-finished": {"updates_sent": 40}}
    )
    incoming = queue.Queue()
    incoming.put({"type": "stats", "tracker_id": message_tracker_id, "stats": {"updates_sent": 50}})
    monkeypatch.setattr(messages, "queue_from_tracker", incoming)
    monkeypatch.setattr(messages, "public_events", Mock())
    # Run the periodic cleanup immediately, without starting a performance monitor.
    monkeypatch.setattr(
        messages, "time", SimpleNamespace(monotonic=Mock(side_effect=[0.0, 1.0, 1.0]))
    )

    async def stop_after_message(_delay):
        raise asyncio.CancelledError

    monkeypatch.setattr(messages.asyncio, "sleep", stop_after_message)
    with pytest.raises(asyncio.CancelledError):
        await messages.handle_tracker_messages(SimpleNamespace(emit=AsyncMock()))

    expected_updates = 50 if message_tracker_id == "target-1" else 2
    assert tracker_metrics.stats == {"target-1": {"updates_sent": expected_updates}}
