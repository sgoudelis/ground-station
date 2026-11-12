# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later

"""Durable consent and a single, bounded census sender per backend process."""

import asyncio
import json
import logging
import math
import os
import random
import re
import secrets
import tempfile
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import httpx

from common.arguments import arguments
from feedback.payload import (
    COLLECTOR_URL,
    ENVIRONMENTS,
    NOTICE_VERSION,
    SUPPORTED_NOTICE_VERSIONS,
    build_sample,
    reporting_environment,
)

logger = logging.getLogger("feedback")


def validate_choice(data):
    if not isinstance(data, dict) or set(data) - {
        "enabled",
        "consent_notice_version",
        "environment",
    }:
        raise ValueError("Invalid feedback settings.")
    if type(data.get("enabled")) is not bool:
        raise ValueError("Census choice must be a boolean.")
    if data["enabled"] and data.get("consent_notice_version") != NOTICE_VERSION:
        raise ValueError("Please review the current census disclosure before opting in.")
    # Accept legacy clients' valid environment labels, but deployment configuration
    # remains authoritative; configure() never persists a client-supplied label.
    if "environment" in data and data["environment"] not in ENVIRONMENTS:
        raise ValueError("Invalid reporting environment.")
    return data


def _default_state() -> dict[str, Any]:
    return {
        "enabled": False,
        "consent_notice_version": None,
        "installation_id": None,
        "credential": None,
        "registered": False,
        "remote_possible": False,
        "grant_pending": False,
        "deletion_pending": False,
        "blocked": False,
        "last_success_at": None,
        "next_attempt_at": 0,
        "error": None,
    }


class FeedbackService:
    def __init__(self, path):
        self.path = Path(path)
        self.lock = asyncio.Lock()
        self.wake = asyncio.Event()
        self.state = _default_state()
        self.failures = 0
        self.storage_error = False
        try:
            stored = json.loads(self.path.read_text())
            if not isinstance(stored, dict):
                raise ValueError("Invalid state")
            for key in (
                "enabled",
                "registered",
                "remote_possible",
                "grant_pending",
                "deletion_pending",
                "blocked",
            ):
                if type(stored.get(key)) is not bool:
                    raise ValueError("Invalid state")
            next_attempt = stored.get("next_attempt_at", 0)
            if (
                not isinstance(next_attempt, (int, float))
                or not math.isfinite(next_attempt)
                or next_attempt < 0
            ):
                raise ValueError("Invalid delivery time")
            if stored["enabled"] and stored["deletion_pending"]:
                raise ValueError("Conflicting consent state")
            if stored.get("installation_id") is not None and not isinstance(
                stored["installation_id"], str
            ):
                raise ValueError("Invalid identity")
            if stored.get("installation_id"):
                UUID(stored["installation_id"])
                if not re.fullmatch(r"[A-Za-z0-9_-]{43,128}", stored.get("credential") or ""):
                    raise ValueError("Invalid identity")
            elif any(
                stored[key]
                for key in (
                    "enabled",
                    "registered",
                    "remote_possible",
                    "grant_pending",
                    "deletion_pending",
                )
            ):
                raise ValueError("Missing identity")
            for key in ("last_success_at", "error", "consent_notice_version"):
                if stored.get(key) is not None and not isinstance(stored[key], str):
                    raise ValueError("Invalid state metadata")
            # Old state files may contain an administrator-selected environment.
            # Ignore that label while retaining the installation's existing consent.
            self.state.update({key: stored[key] for key in self.state if key in stored})
            # A changed disclosure never silently renews an old grant.
            if (
                self.state["enabled"]
                and stored.get("consent_notice_version") not in SUPPORTED_NOTICE_VERSIONS
            ):
                self.state["enabled"] = False
                self.state["deletion_pending"] = self.state["remote_possible"]
                self.state["grant_pending"] = False
                self.state["blocked"] = False
                self.state["next_attempt_at"] = 0
        except FileNotFoundError:
            pass
        except (OSError, ValueError, TypeError):
            self.storage_error = True
            self.state = _default_state()
            logger.error("Feedback state cannot be read; census is disabled.")

    def _save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd, name = tempfile.mkstemp(prefix=".feedback-", dir=self.path.parent)
        try:
            # mkstemp uses 0600. Replace atomically so a crash cannot leave a
            # partially written credential or accidentally restore consent.
            with os.fdopen(fd, "w") as stream:
                json.dump(self.state, stream)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(name, self.path)
            # Persist the directory entry as well as file contents. A power loss
            # immediately after opt-out must not restore the previous grant.
            directory = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
        finally:
            Path(name).unlink(missing_ok=True)

    async def status(self, preview=False):
        async with self.lock:
            result = {
                key: self.state[key]
                for key in (
                    "enabled",
                    "installation_id",
                    "deletion_pending",
                    "blocked",
                    "last_success_at",
                    "error",
                )
            }
            result.update(
                {
                    "environment": reporting_environment(),
                    "consent_notice_version": NOTICE_VERSION,
                    "accepted_notice_version": self.state["consent_notice_version"],
                    "needs_consent_review": self.state["enabled"]
                    and self.state["consent_notice_version"] != NOTICE_VERSION,
                    "collector_url": COLLECTOR_URL,
                    "storage_error": self.storage_error,
                    "next_attempt_at": self.state["next_attempt_at"] or None,
                }
            )
            if preview:
                try:
                    result["sample"] = await asyncio.to_thread(
                        build_sample,
                        self.state["installation_id"] or "<random UUID generated on opt-in>",
                        reporting_environment(),
                        (
                            self.state["consent_notice_version"]
                            if self.state["enabled"]
                            else NOTICE_VERSION
                        ),
                    )
                except Exception:
                    # A failed hardware probe must never prevent an admin from
                    # reaching the controls needed to withdraw consent.
                    result["preview_error"] = (
                        "Census preview is unavailable. You can still change consent."
                    )
            return result

    async def configure(self, data):
        validate_choice(data)
        async with self.lock:
            if self.storage_error:
                raise ValueError(
                    "Feedback storage is unreadable. Repair it before changing consent."
                )
            previous = self.state.copy()
            if data["enabled"]:
                if not self.state["installation_id"]:
                    self.state["installation_id"] = str(uuid4())
                    self.state["credential"] = secrets.token_urlsafe(32)
                self.state["consent_notice_version"] = NOTICE_VERSION
                self.state["grant_pending"] = True
                # Retention may have expired this identity while offline.
                # Explicit user consent permits retry-safe registration again.
                self.state["registered"] = False
                # A new explicit opt-in supersedes an unfinished withdrawal.
                self.state["deletion_pending"] = False
            else:
                self.state["grant_pending"] = False
                self.state["deletion_pending"] = self.state["remote_possible"]
            self.state["enabled"] = data["enabled"]
            self.state["blocked"] = False
            self.state["error"] = None
            self.state["next_attempt_at"] = 0
            try:
                self._save()
            except OSError:
                self.state = previous
                self.storage_error = True
                raise ValueError(
                    "Could not safely save feedback consent. Reporting is stopped; check local storage."
                )
            self.failures = 0
            self.wake.set()
        return await self.status()

    async def _request(self, client, method, path, **kwargs):
        response = await client.request(method, COLLECTOR_URL + path, **kwargs)
        # HTTPX does not treat redirects as success. Never follow one with
        # registration secrets or a bearer credential.
        response.raise_for_status()
        return response

    async def tick(self, client):
        async with self.lock:
            if (
                self.storage_error
                or self.state["blocked"]
                or time.time() < self.state["next_attempt_at"]
            ):
                return
            if not self.state["enabled"] and not self.state["deletion_pending"]:
                return
            identity = self.state["installation_id"]
            headers = {"Authorization": f"Bearer {self.state['credential']}"}
            try:
                if self.state["deletion_pending"]:
                    # Delete only census consent/data; the shared identity is
                    # reserved for separately consented future reporting purposes.
                    response = await client.delete(
                        f"{COLLECTOR_URL}/v1/installations/{identity}/consents/census",
                        headers=headers,
                    )
                    if response.status_code not in (204, 404):
                        response.raise_for_status()
                        raise ValueError("Unexpected deletion response")
                    self.state["deletion_pending"] = False
                    self.state["remote_possible"] = False
                    self.state["next_attempt_at"] = 0
                    self.state["last_success_at"] = None
                elif self.state["enabled"]:
                    if not self.state["registered"]:
                        # Persist before sending: even a lost registration reply
                        # can leave remote data that needs withdrawal later.
                        self.state["remote_possible"] = True
                        self._save()
                        await self._request(
                            client,
                            "POST",
                            "/v1/installations",
                            json={
                                "installation_id": identity,
                                "credential": self.state["credential"],
                                "purpose": "census",
                                "consent_notice_version": self.state["consent_notice_version"],
                            },
                        )
                        self.state["registered"] = True
                    if self.state["grant_pending"]:
                        await self._request(
                            client,
                            "PUT",
                            f"/v1/installations/{identity}/consents/census",
                            headers=headers,
                            json={"consent_notice_version": self.state["consent_notice_version"]},
                        )
                        self.state["grant_pending"] = False
                    sample = await asyncio.to_thread(
                        build_sample,
                        identity,
                        reporting_environment(),
                        self.state["consent_notice_version"],
                    )
                    if len(json.dumps(sample).encode()) > 4096:
                        raise ValueError("Census sample exceeds protocol limit")
                    response = await self._request(
                        client, "POST", "/v1/census", headers=headers, json=sample
                    )
                    if response.status_code != 202:
                        raise ValueError("Unexpected census response")
                    self.state["last_success_at"] = datetime.now(timezone.utc).isoformat()
                    # A restart must not turn a daily census into rapid heartbeats.
                    self.state["next_attempt_at"] = time.time() + 86400 + random.uniform(0, 3600)
                self.failures = 0
                self.state["error"] = None
            except httpx.HTTPStatusError as exc:
                code = exc.response.status_code
                if code in (401, 403, 404, 409, 422) or 300 <= code < 400:
                    self.state["blocked"] = True
                    self.state["grant_pending"] = False
                self._retry(f"Collector returned HTTP {code}.", exc.response)
            except (httpx.RequestError, ValueError, OSError):
                # Do not log request objects, raw exceptions, credentials or
                # payloads. Admins receive only a bounded, generic status.
                self._retry("Could not deliver census update. Retrying automatically.")
            self._save()

    def _retry(self, message, response=None):
        self.failures = min(self.failures + 1, 12)
        delay = min(60 * 2 ** (self.failures - 1), 21600) + random.uniform(0, 30)
        if response is not None and response.status_code == 429:
            retry_after = response.headers.get("Retry-After", "")
            try:
                seconds = float(retry_after)
                if math.isfinite(seconds):
                    delay = max(delay, seconds)
            except ValueError:
                try:
                    delay = max(delay, parsedate_to_datetime(retry_after).timestamp() - time.time())
                except (ValueError, TypeError, OverflowError):
                    pass
        self.state["error"] = message
        self.state["next_attempt_at"] = time.time() + delay

    async def run(self):
        # Consent checks precede any request. An unused client opens no sockets.
        async with httpx.AsyncClient(timeout=10, follow_redirects=False, trust_env=False) as client:
            while True:
                self.wake.clear()
                try:
                    # Bound the entire registration/grant/upload sequence so an
                    # administrator's withdrawal cannot queue behind it forever.
                    async with asyncio.timeout(20):
                        await self.tick(client)
                except TimeoutError:
                    async with self.lock:
                        self._retry("Census delivery timed out. Retrying automatically.")
                        try:
                            self._save()
                        except OSError:
                            self.storage_error = True
                except OSError:
                    logger.error("Feedback state could not be saved; sender stopped.")
                    self.storage_error = True
                except Exception:
                    # Optional reporting must remain isolated from station
                    # operation, including unexpected platform/probe failures.
                    async with self.lock:
                        self.state["blocked"] = True
                        self.state["error"] = (
                            "Unexpected census sender error. Reporting is stopped."
                        )
                        logger.error("Unexpected census sender error; reporting stopped.")
                        try:
                            self._save()
                        except OSError:
                            self.storage_error = True
                try:
                    await asyncio.wait_for(self.wake.wait(), timeout=30)
                except asyncio.TimeoutError:
                    pass


# Keep the installation credential outside the station database and its SQL
# exports. Never ship this directory in images or copy it to another station.
def _state_path():
    if os.environ.get("GS_FEEDBACK_STATE"):
        return Path(os.environ["GS_FEEDBACK_STATE"])
    if getattr(arguments, "temp_db", False):
        # A temporary/demo backend must never inherit a real station's consent.
        return Path(arguments.db).with_suffix(".feedback") / "state.json"
    return Path(__file__).parents[1] / "data" / "feedback" / "state.json"


feedback_service = FeedbackService(_state_path())
