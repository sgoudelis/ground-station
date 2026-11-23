# Copyright (c) 2026 Efstratios Goudelis. SPDX-License-Identifier: GPL-3.0-or-later
"""Optional activity requests containing the UUID and deployment environment."""

import asyncio
import json
import logging
import math
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import TypedDict

import httpx

from common.arguments import arguments
from common.environment import usage_environment
from installationid import InstallationIdentity, installation_identity

ACTIVITY_URL = "https://reports.gscontrol.net/v1/usage"
INTERVAL = 12 * 60 * 60
logger = logging.getLogger("usage")


class UsageState(TypedDict):
    enabled: bool
    next_attempt_at: float
    last_success_at: str | None


def validate_choice(data):
    if not isinstance(data, dict) or set(data) != {"enabled"} or type(data["enabled"]) is not bool:
        raise ValueError("Activity sharing requires a boolean enabled choice.")
    return data


class UsageService:
    def __init__(self, path, identity=None):
        self.path = Path(path)
        self.identity = identity or InstallationIdentity(
            self.path.parent.parent / "installationid.json"
        )
        self.lock = asyncio.Lock()
        self.wake = asyncio.Event()
        # A checked setup checkbox takes effect only after setup completes.
        # Upgrades and old clients never inherit consent from the removed census.
        self.state: UsageState = {"enabled": False, "next_attempt_at": 0, "last_success_at": None}
        self.storage_error = False
        try:
            stored = json.loads(self.path.read_text())
            validate_choice({"enabled": stored["enabled"]})
            timestamp = stored["next_attempt_at"]
            if type(timestamp) not in (int, float) or not math.isfinite(timestamp) or timestamp < 0:
                raise ValueError("Invalid activity schedule")
            if stored["last_success_at"] is not None and not isinstance(
                stored["last_success_at"], str
            ):
                raise ValueError("Invalid activity timestamp")
            self.state = {
                "enabled": stored["enabled"],
                "next_attempt_at": float(timestamp),
                "last_success_at": stored["last_success_at"],
            }
        except FileNotFoundError:
            pass
        except (OSError, ValueError, KeyError, TypeError):
            self.storage_error = True
            logger.error("Activity settings unreadable; sharing is stopped")

    def _save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd, name = tempfile.mkstemp(prefix=".usage-", dir=self.path.parent)
        try:
            with os.fdopen(fd, "w") as stream:
                json.dump(self.state, stream)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, self.path)
            directory = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            Path(name).unlink(missing_ok=True)

    def _status(self):
        return {**self.state, "storage_error": self.storage_error}

    async def status(self):
        async with self.lock:
            return self._status()

    async def configure(self, data):
        validate_choice(data)
        async with self.lock:
            if self.storage_error:
                raise ValueError("Activity settings are unreadable. Repair local storage first.")
            previous = self.state.copy()
            self.state["enabled"] = data["enabled"]
            # Preserve the schedule across toggles and restarts: at most one
            # request per 12 hours, including failed attempts.
            try:
                self._save()
            except OSError:
                self.state = previous
                self.storage_error = True
                raise ValueError("Could not save activity settings. Sharing is stopped.")
            self.wake.set()
            return self._status()

    async def tick(self, client):
        async with self.lock:
            if (
                self.storage_error
                or not self.state["enabled"]
                or time.time() < self.state["next_attempt_at"]
            ):
                return
            # Persist BEFORE sending, so a crash cannot produce repeated requests.
            self.state["next_attempt_at"] = time.time() + INTERVAL
            self._save()
            try:
                # The shared credential is deliberately excluded. Activity needs
                # no account, registration or census/events consent grant.
                identity = self.identity.credentials()["installation_id"]
                # Bound the complete request so saving an opt-out cannot wait
                # behind multiple independent HTTP phase timeouts.
                async with asyncio.timeout(10):
                    response = await client.post(
                        ACTIVITY_URL,
                        json={"installation_id": identity, "environment": usage_environment()},
                    )
                response.raise_for_status()
                if response.status_code != 204:
                    return
                self.state["last_success_at"] = datetime.now(timezone.utc).isoformat()
                self._save()
            except (httpx.HTTPError, TimeoutError):
                # This optional feature never interrupts station operation or
                # sends extra retries between the scheduled 12-hour requests.
                logger.info("Activity request unsuccessful; next attempt in 12 hours")

    async def run(self):
        async with httpx.AsyncClient(timeout=10, follow_redirects=False, trust_env=False) as client:
            while True:
                self.wake.clear()
                try:
                    await self.tick(client)
                except OSError:
                    self.storage_error = True
                    logger.error("Activity settings could not be saved; sharing stopped")
                except Exception:
                    # Keep failures isolated from the backend lifecycle.
                    logger.error("Activity sharing failed; waiting for the next scheduled attempt")
                try:
                    await asyncio.wait_for(self.wake.wait(), timeout=30)
                except asyncio.TimeoutError:
                    pass


def _state_path():
    if os.getenv("GS_USAGE_STATE"):
        return Path(os.environ["GS_USAGE_STATE"])
    if getattr(arguments, "temp_db", False):
        return Path(arguments.db).with_suffix(".usage") / "state.json"
    return Path(__file__).parents[1] / "data" / "usage" / "state.json"


usage_service = UsageService(_state_path(), installation_identity)
