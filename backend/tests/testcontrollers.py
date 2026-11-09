# Copyright (c) 2026 Efstratios Goudelis
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.

"""Unit tests for controller behaviour without real devices or processes."""

import pytest

from controllers.rotator import RotatorController, StopRejected
from controllers.sdr import SDRController


def _sdr_details():
    return {
        "id": "sdr-1",
        "name": "Test SDR",
        "type": "rtlsdrusbv3",
        "serial": "0001",
        "host": "localhost",
        "port": 1234,
        "driver": "rtlsdr",
        "frequency_min": 24_000_000,
        "frequency_max": 1_766_000_000,
    }


@pytest.mark.asyncio
async def test_sdr_controller_lifecycle_and_placeholder_controls():
    controller = SDRController(_sdr_details())

    with pytest.raises(RuntimeError, match="Not connected"):
        controller.check_connection()

    assert await controller.connect() is True
    assert await controller.connect() is True
    assert await controller.get_frequency() == 100_000_000.0
    assert [item async for item in controller.set_frequency(145_800_000)] == [(145_800_000, False)]
    assert await controller.get_mode() == ("AM", 6000)
    assert await controller.set_mode("FM", 12_500) is True
    assert await controller.disconnect() is True
    assert await controller.disconnect() is True


@pytest.mark.asyncio
async def test_sdr_controller_updates_selected_vfo_and_ignores_none():
    controller = SDRController(_sdr_details())

    class FakeVfoManager:
        def __init__(self):
            self.updates = []
            self.emitted_sessions = []

        def update_vfo_state(self, **kwargs):
            self.updates.append(kwargs)

        async def emit_vfo_states(self, _sio, session_id):
            self.emitted_sessions.append(session_id)

    fake_vfos = FakeVfoManager()
    controller.vfo_manager = fake_vfos

    await controller.update_vfo_with_doppler(
        object(), "session-a", "none", 145_800_123.9, -321.5, 145_800_000
    )
    await controller.update_vfo_with_doppler(
        object(), "session-a", "2", 145_800_123.9, -321.5, 145_800_000, 12_500, "FM"
    )

    assert fake_vfos.updates == [
        {
            "session_id": "session-a",
            "vfo_id": 2,
            "center_freq": 145_800_123,
            "bandwidth": 12_500,
            "modulation": "FM",
            "active": True,
        }
    ]
    assert fake_vfos.emitted_sessions == ["session-a"]


@pytest.mark.asyncio
async def test_rotator_parses_position_and_command_outcomes(monkeypatch):
    controller = RotatorController()
    commands = []

    async def send_command(command, waitforreply=True):
        commands.append((command, waitforreply))
        return {
            "p": "get_pos: 180 30",
            "P 180 30": "RPRT 0",
            "S": "RPRT -1",
            "K": "RPRT 0",
        }[command]

    monkeypatch.setattr(controller, "_send_command", send_command)

    assert await controller.get_position() == (180.0, 30.0)
    assert [item async for item in controller.set_position(180, 30)] == [(180.0, 30.0, False)]
    # A controller rejection is distinct from a missing Stop acknowledgement.
    with pytest.raises(StopRejected, match=r"RPRT -1"):
        await controller.stop()
    assert commands[-1] == ("S", True)
    assert await controller.park() is True
    assert commands[-1] == ("K", True)


@pytest.mark.asyncio
async def test_rotator_rejects_partial_park_target(monkeypatch):
    controller = RotatorController()

    async def should_not_send(*_args, **_kwargs):
        raise AssertionError("park command must not be sent")

    monkeypatch.setattr(controller, "_send_command", should_not_send)

    with pytest.raises(RuntimeError, match="both be set or both be null"):
        await controller.park(180, None)
