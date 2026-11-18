# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later

"""Installation-local event consent, using the census file persistence pattern."""

import json
import math
import os
import tempfile
from datetime import date, datetime
from pathlib import Path
from typing import Any

from calendars.protocol import TERMS_VERSION
from common.arguments import arguments


def state_path():
    if os.environ.get("GS_EVENTS_STATE"):
        return Path(os.environ["GS_EVENTS_STATE"])
    if getattr(arguments, "temp_db", False):
        # A temporary/demo backend must never inherit the real station's grant.
        return Path(arguments.db).with_suffix(".events") / "state.json"
    return Path(__file__).parents[1] / "data" / "events" / "state.json"


def default_state() -> dict[str, Any]:
    return {
        "enabled": False,
        "grant_pending": False,
        "deletion_pending": False,
        "remote_possible": False,
        "accepted_terms_version": None,
        "accepted_at": None,
        "accepted_by": None,
        "last_attempt_at": None,
        "last_success_at": None,
        "next_poll_at": 0,
        "coverage_start": None,
        "coverage_end": None,
        "error": None,
    }


class EventsConsent:
    def __init__(self, path):
        self.path = Path(path)
        self.state = default_state()
        self.storage_error = False
        try:
            stored = json.loads(self.path.read_text())
            if not isinstance(stored, dict) or type(stored.get("enabled")) is not bool:
                raise ValueError("Invalid consent")
            next_poll = stored.get("next_poll_at", 0)
            if type(next_poll) not in (int, float) or not math.isfinite(next_poll) or next_poll < 0:
                raise ValueError("Invalid polling time")
            for key in ("grant_pending", "deletion_pending", "remote_possible"):
                if key in stored and type(stored[key]) is not bool:
                    raise ValueError("Invalid consent state")
            for key in self.state.keys() - {
                "enabled",
                "next_poll_at",
                "grant_pending",
                "deletion_pending",
                "remote_possible",
            }:
                if stored.get(key) is not None and not isinstance(stored[key], str):
                    raise ValueError("Invalid consent metadata")
            for key in ("accepted_at", "last_attempt_at", "last_success_at"):
                if stored.get(key) is not None:
                    value = datetime.fromisoformat(stored[key])
                    if value.tzinfo is None:
                        raise ValueError("Timestamp must include timezone")
            for key in ("coverage_start", "coverage_end"):
                if stored.get(key) is not None:
                    date.fromisoformat(stored[key])
            self.state.update({key: value for key, value in stored.items() if key in self.state})
            if self.state["enabled"] and not self.state["accepted_at"]:
                raise ValueError("Missing acceptance")
        except FileNotFoundError:
            pass
        except (OSError, ValueError, TypeError):
            # Unreadable state never grants permission to contact the service.
            self.state = default_state()
            self.storage_error = True

    @property
    def active(self):
        return (
            self.state["enabled"]
            and self.state["accepted_terms_version"] == TERMS_VERSION
            and not self.storage_error
        )

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd, name = tempfile.mkstemp(prefix=".events-", dir=self.path.parent)
        try:
            with os.fdopen(fd, "w") as stream:
                json.dump(self.state, stream)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, self.path)
            # Make opt-out durable across a power loss, just like census consent.
            directory = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            Path(name).unlink(missing_ok=True)
