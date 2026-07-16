# Copyright (c) 2025 Efstratios Goudelis

import time

import pytest

from tracker.rotatorhandler import RotatorHandler


class _Queue:
    def __init__(self):
        self.items = []

    def put(self, item):
        self.items.append(item)


class _DummyTracker:
    def __init__(self, azimuth_mode: str):
        self.rotator_controller = object()
        self.current_rotator_state = "tracking"
        self.rotator_details = {"azimuth_mode": azimuth_mode}
        self.rotator_data = {
            "outofbounds": False,
            "minelevation": False,
            "az": 0.0,
            "el": 0.0,
            "slewing": False,
            "error": False,
        }
        if azimuth_mode == "-180_180":
            self.azimuth_limits = (-180, 180)
        elif azimuth_mode == "0_450":
            self.azimuth_limits = (0, 450)
        else:
            self.azimuth_limits = (0, 360)
        self.elevation_limits = (0, 90)
        self.rotator_command_state = {
            "in_flight": False,
            "target_az": None,
            "target_el": None,
            "last_command_ts": 0.0,
            "settle_hits": 0,
        }
        self.nudge_offset = {"az": 0, "el": 0}
        self.az_tolerance = 2.0
        self.el_tolerance = 2.0
        self.rotator_retarget_threshold_deg = 2.0
        self.rotator_command_refresh_sec = 6.0
        self.rotator_settle_hits_required = 2
        self.queue_out = _Queue()


@pytest.mark.asyncio
async def test_tracking_command_uses_negative_azimuth_when_mode_is_negative_range():
    tracker = _DummyTracker("-180_180")
    handler = RotatorHandler(tracker)
    sent = []

    async def _capture_issue(target_az, target_el):
        sent.append((target_az, target_el))

    handler._issue_rotator_command = _capture_issue

    await handler.control_rotator_position((270.0, 45.0))

    assert sent == [(-90.0, 45.0)]


@pytest.mark.asyncio
async def test_tracking_command_stays_0_to_360_in_default_mode():
    tracker = _DummyTracker("0_360")
    handler = RotatorHandler(tracker)
    sent = []

    async def _capture_issue(target_az, target_el):
        sent.append((target_az, target_el))

    handler._issue_rotator_command = _capture_issue

    await handler.control_rotator_position((270.0, 45.0))

    assert sent == [(270.0, 45.0)]


@pytest.mark.asyncio
async def test_tracking_command_uses_overlap_candidate_when_mode_is_0_450():
    tracker = _DummyTracker("0_450")
    tracker.rotator_data["az"] = 430.0
    handler = RotatorHandler(tracker)
    sent = []

    async def _capture_issue(target_az, target_el):
        sent.append((target_az, target_el))

    handler._issue_rotator_command = _capture_issue

    await handler.control_rotator_position((20.0, 45.0))

    assert sent == [(380.0, 45.0)]


def test_target_within_tolerance_handles_wraparound():
    tracker = _DummyTracker("0_360")
    handler = RotatorHandler(tracker)

    tracker.az_tolerance = 3.0
    tracker.el_tolerance = 2.0

    assert handler._target_within_tolerance(359.0, 45.0, 1.0, 45.0)


def test_target_within_tolerance_handles_mixed_azimuth_representations():
    tracker = _DummyTracker("-180_180")
    handler = RotatorHandler(tracker)

    tracker.az_tolerance = 2.0
    tracker.el_tolerance = 2.0

    assert handler._target_within_tolerance(270.0, 20.0, -90.0, 20.0)


def test_target_within_tolerance_in_overlap_mode_uses_absolute_distance():
    tracker = _DummyTracker("0_450")
    handler = RotatorHandler(tracker)

    tracker.az_tolerance = 2.0
    tracker.el_tolerance = 2.0

    assert not handler._target_within_tolerance(85.0, 20.0, 445.0, 20.0)
    assert handler._target_within_tolerance(444.5, 20.0, 445.0, 20.0)


@pytest.mark.asyncio
async def test_in_flight_command_settles_across_0_360_boundary():
    tracker = _DummyTracker("0_360")
    handler = RotatorHandler(tracker)

    tracker.rotator_data["az"] = 359.0
    tracker.rotator_data["el"] = 45.0
    tracker.rotator_command_state.update(
        {
            "in_flight": True,
            "target_az": 1.0,
            "target_el": 45.0,
            "last_command_ts": time.time(),
            "settle_hits": 0,
        }
    )
    tracker.rotator_settle_hits_required = 2
    tracker.rotator_retarget_threshold_deg = 999.0
    tracker.rotator_command_refresh_sec = 999.0

    async def _noop_issue(target_az, target_el):
        return None

    handler._issue_rotator_command = _noop_issue

    await handler.control_rotator_position((1.0, 45.0))
    await handler.control_rotator_position((1.0, 45.0))

    assert tracker.rotator_command_state["in_flight"] is False
    assert tracker.rotator_data["slewing"] is False


@pytest.mark.asyncio
async def test_in_flight_marks_not_slewing_immediately_when_target_is_reached():
    tracker = _DummyTracker("0_360")
    handler = RotatorHandler(tracker)

    tracker.rotator_data["az"] = 100.0
    tracker.rotator_data["el"] = 30.0
    tracker.rotator_data["slewing"] = True
    tracker.rotator_command_state.update(
        {
            "in_flight": True,
            "target_az": 100.0,
            "target_el": 30.0,
            "last_command_ts": time.time(),
            "settle_hits": 0,
        }
    )
    tracker.rotator_settle_hits_required = 2
    tracker.rotator_retarget_threshold_deg = 999.0
    tracker.rotator_command_refresh_sec = 999.0

    async def _noop_issue(target_az, target_el):
        return None

    handler._issue_rotator_command = _noop_issue

    await handler.control_rotator_position((100.0, 30.0))

    assert tracker.rotator_command_state["in_flight"] is True
    assert tracker.rotator_command_state["settle_hits"] == 1
    assert tracker.rotator_data["slewing"] is False


@pytest.mark.asyncio
async def test_in_flight_settle_completion_does_not_reissue_due_to_refresh():
    tracker = _DummyTracker("0_360")
    handler = RotatorHandler(tracker)

    tracker.rotator_data["az"] = 120.0
    tracker.rotator_data["el"] = 35.0
    tracker.rotator_data["slewing"] = True
    tracker.rotator_command_state.update(
        {
            "in_flight": True,
            "target_az": 120.0,
            "target_el": 35.0,
            "last_command_ts": time.time(),
            "settle_hits": 1,
        }
    )
    tracker.rotator_settle_hits_required = 2
    tracker.rotator_command_refresh_sec = 6.0

    issued = []

    async def _capture_issue(target_az, target_el):
        issued.append((target_az, target_el))

    handler._issue_rotator_command = _capture_issue

    await handler.control_rotator_position((120.0, 35.0))

    assert issued == []
    assert tracker.rotator_command_state["in_flight"] is False
    assert tracker.rotator_data["slewing"] is False


@pytest.mark.asyncio
async def test_state_change_to_tracking_does_not_force_connected_flags_on_connect_failure():
    tracker = _DummyTracker("0_360")
    tracker.rotator_controller = None
    tracker.rotator_data.update(
        {
            "connected": False,
            "tracking": False,
            "stopped": True,
            "parked": False,
            "error": True,
        }
    )
    handler = RotatorHandler(tracker)

    async def _failed_connect():
        tracker.rotator_controller = None
        tracker.rotator_data["connected"] = False
        tracker.rotator_data["error"] = True

    handler.connect_to_rotator = _failed_connect

    await handler.handle_rotator_state_change("disconnected", "tracking")

    assert tracker.rotator_data["connected"] is False
    assert tracker.rotator_data["tracking"] is False


@pytest.mark.asyncio
async def test_update_hardware_position_unwraps_overlap_reading_to_absolute_turn():
    tracker = _DummyTracker("0_450")
    tracker.rotator_data["az"] = 430.0

    class _Controller:
        async def get_position(self):
            return 10.0, 35.0

    tracker.rotator_controller = _Controller()
    handler = RotatorHandler(tracker)

    await handler.update_hardware_position()

    assert tracker.rotator_data["az"] == 370.0
    assert tracker.rotator_data["el"] == 35.0


@pytest.mark.asyncio
async def test_update_hardware_position_preserves_absolute_overlap_reading():
    tracker = _DummyTracker("0_450")
    tracker.rotator_data["az"] = 10.0

    class _Controller:
        async def get_position(self):
            return 370.0, 35.0

    tracker.rotator_controller = _Controller()
    handler = RotatorHandler(tracker)

    await handler.update_hardware_position()

    assert tracker.rotator_data["az"] == 370.0
    assert tracker.rotator_data["el"] == 35.0


@pytest.mark.asyncio
async def test_update_hardware_position_keeps_wrapped_overlap_reading_on_cold_start():
    tracker = _DummyTracker("0_450")
    tracker.rotator_data["az"] = None

    class _Controller:
        async def get_position(self):
            return 20.0, 35.0

    tracker.rotator_controller = _Controller()
    handler = RotatorHandler(tracker)

    await handler.update_hardware_position()

    assert tracker.rotator_data["az"] == 20.0
    assert tracker.rotator_data["el"] == 35.0


@pytest.mark.asyncio
async def test_overlap_mode_reports_error_when_extended_command_is_rejected():
    tracker = _DummyTracker("0_450")
    tracker.rotator_data["az"] = 430.0
    sent = []

    class _Controller:
        async def set_position(self, target_az, target_el):
            sent.append((target_az, target_el))
            raise RuntimeError("Failed to set position: RPRT -17")
            yield

    tracker.rotator_controller = _Controller()
    handler = RotatorHandler(tracker)

    await handler.control_rotator_position((20.0, 45.0))

    assert sent == [(380.0, 45.0)]
    assert tracker.rotator_data["error"] is True
    assert tracker.rotator_data["stopped"] is True
    assert tracker.rotator_data["outofbounds"] is True
    assert tracker.rotator_command_state["in_flight"] is False
    assert len(tracker.queue_out.items) == 1
