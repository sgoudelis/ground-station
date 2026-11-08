"""Shared runtime references populated at startup.

This module exists to avoid circular imports while keeping imports eager.
"""

from __future__ import annotations

from typing import Any

audio_queue: Any = None
background_task_manager: Any = None
process_manager: Any = None
audio_consumer: Any = None
continuous_observations: Any = None
