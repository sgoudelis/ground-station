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

"""Validation functions for observations and monitored satellites."""

from datetime import datetime
from typing import Any, Dict


def validate_observation_pass(data: Dict[str, Any]) -> Dict[str, Any]:
    """Reject missing or invalid pass timing before database writes and scheduling."""
    pass_data = data.get("pass")
    if not isinstance(pass_data, dict) or not all(
        pass_data.get(field) for field in ("event_start", "event_end")
    ):
        return {"success": False, "error": "Select a pass before saving the observation."}

    try:
        start, end = (
            datetime.fromisoformat(pass_data[field].replace("Z", "+00:00"))
            for field in ("event_start", "event_end")
        )
        if end <= start:
            return {"success": False, "error": "Pass end time must be after its start time."}
    except (AttributeError, TypeError, ValueError):
        return {"success": False, "error": "Pass start and end times must be valid ISO dates."}

    return {"success": True, "error": None}


def validate_transmitter_frequencies(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Validate that all transmitter frequencies in session tasks are within the SDR's
    sample rate and center frequency range.

    Args:
        data: Observation or monitored satellite data containing:
            - sessions: List of session objects with sdr config and tasks

    Returns:
        Dictionary with:
            - success: True if all frequencies are valid, False otherwise
            - error: Error message if validation fails, None otherwise
            - invalid_frequencies: List of invalid frequency details if validation fails
    """
    sessions = data.get("sessions", []) or []
    if not sessions:
        return {"success": False, "error": "At least one SDR session is required."}
    invalid_frequencies = []

    for session_index, session in enumerate(sessions):
        if not isinstance(session, dict):
            continue
        sdr_config = session.get("sdr", {}) or {}
        center_frequency = sdr_config.get("center_frequency")
        sample_rate = sdr_config.get("sample_rate")

        # If no SDR config, skip validation (will be caught by other validations)
        if not center_frequency or not sample_rate:
            continue

        # Calculate the frequency range the SDR can receive
        nyquist_bandwidth = sample_rate / 2
        min_freq = center_frequency - nyquist_bandwidth
        max_freq = center_frequency + nyquist_bandwidth

        tasks = session.get("tasks", []) or []
        for task_index, task in enumerate(tasks):
            task_type = task.get("type")
            if task_type != "decoder":
                continue

            task_config = task.get("config", {})
            frequency = task_config.get("frequency")

            # Skip if no frequency is specified (might use center_frequency as default)
            if not frequency:
                continue

            # Check if frequency is within range
            if frequency < min_freq or frequency > max_freq:
                transmitter_id = task_config.get("transmitter_id", "unknown")
                invalid_frequencies.append(
                    {
                        "session_index": session_index,
                        "task_index": task_index,
                        "transmitter_id": transmitter_id,
                        "frequency": frequency,
                        "min_allowed": min_freq,
                        "max_allowed": max_freq,
                    }
                )

    # If there are invalid frequencies, return error
    if invalid_frequencies:
        freq_details = []
        for inv in invalid_frequencies:
            freq_mhz = inv["frequency"] / 1_000_000
            min_mhz = inv["min_allowed"] / 1_000_000
            max_mhz = inv["max_allowed"] / 1_000_000
            freq_details.append(
                f"{freq_mhz:.3f} MHz (must be between {min_mhz:.3f} - {max_mhz:.3f} MHz)"
            )

        error_msg = (
            f"Transmitter frequency validation failed: "
            f"{len(invalid_frequencies)} frequency(ies) outside SDR range. "
            f"Invalid frequencies: {', '.join(freq_details)}."
        )

        return {
            "success": False,
            "error": error_msg,
            "invalid_frequencies": invalid_frequencies,
        }

    return {"success": True, "error": None}
