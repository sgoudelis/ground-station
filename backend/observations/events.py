# Copyright (c) 2025 Efstratios Goudelis
#
# This program is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# This program is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with this program. If not, see <https://www.gnu.org/licenses/>.

"""Event emission helpers for scheduled observations."""

from typing import Any, Dict, Optional, Protocol

from apscheduler.schedulers.asyncio import AsyncIOScheduler


class ObservationSync(Protocol):
    """Runtime scheduler interface, independent of executor implementation imports."""

    scheduler: AsyncIOScheduler
    executor: Any

    async def sync_observation(self, observation_id: str) -> Dict[str, Any]: ...

    async def sync_all_observations(self) -> Dict[str, Any]: ...

    async def remove_observation(self, observation_id: str) -> Dict[str, Any]: ...


# Global socketio instance (set by startup.py)
_sio = None

# Global observation sync instance (set by startup.py)
observation_sync: Optional[ObservationSync] = None


def set_socketio_instance(sio):
    """Set the global socketio instance for event emission."""
    global _sio
    _sio = sio


async def emit_scheduled_observations_changed():
    """Emit event to all clients that scheduled observations have changed."""
    if _sio:
        await _sio.emit("scheduled-observations-changed")
