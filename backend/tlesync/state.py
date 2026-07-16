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


from datetime import datetime, timezone
from typing import Any, Dict


# Create a state manager class for satellite synchronization
class SatelliteSyncState:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super(SatelliteSyncState, cls).__new__(cls)
            cls._instance.reset()
        return cls._instance

    def reset(self):
        self.state: Dict[str, Any]
        self.state = {
            "status": "idle",  # idle, inprogress, complete
            "progress": 0,  # 0-100 percentage
            "message": "",  # Current operation message
            "success": None,  # None, True, False
            "last_update": None,  # Timestamp of last update
            "active_sources": [],  # Currently processing sources
            "completed_sources": [],  # Successfully processed sources
            "errors": [],  # A list of all error messages if any
            "stats": {  # Statistics about the sync
                "satellites_processed": 0,
                "transmitters_processed": 0,
                "groups_processed": 0,
            },
            "newly_added": {  # Track newly added items
                "satellites": [],  # List of newly added satellites
                "transmitters": [],  # List of newly added transmitters
            },
            "removed": {  # Track removed items
                "satellites": [],  # List of removed satellites
                "transmitters": [],  # List of removed transmitters
            },
            "modified": {"satellites": [], "transmitters": []},
        }

    def get_state(self):
        return self.state

    def update(self, **kwargs):
        # Update the state with the provided key-value pairs
        for key, value in kwargs.items():
            if key in self.state:
                self.state[key] = value

        # Update the timestamp when state changes
        self.state["last_update"] = datetime.now(timezone.utc).isoformat()

        return self.state

    def update_stats(self, **kwargs):
        # Update the stats dictionary with the provided key-value pairs
        for key, value in kwargs.items():
            if key in self.state["stats"]:
                self.state["stats"][key] = value

        # Update the timestamp when state changes
        self.state["last_update"] = datetime.now(timezone.utc).isoformat()

        return self.state

    def set_state(self, new_state: Dict[str, Any], touch_timestamp: bool = True):
        """
        Replace the entire state with a new state object.

        Parameters:
            new_state (dict): The new state dictionary to use
            touch_timestamp (bool): When True, refresh last_update to now.
                When False, preserve the provided last_update value.

        Returns:
            dict: The updated state
        """
        # Only set valid keys that exist in self.state
        for key in new_state:
            if key in self.state:
                self.state[key] = new_state[key]

        # Runtime updates should stamp a fresh update time, while persisted-state
        # hydration keeps the recorded timestamp from the previous process.
        if touch_timestamp:
            self.state["last_update"] = datetime.now(timezone.utc).isoformat()

        return self.state


# Create a singleton instance
sync_state_manager = SatelliteSyncState()

# For backwards compatibility, expose the state directly
sync_state = sync_state_manager.state
