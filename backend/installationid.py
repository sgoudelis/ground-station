# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later

"""Durable identity shared by independently opted-in remote services."""

import fcntl
import json
import os
import re
import secrets
import tempfile
from pathlib import Path
from uuid import UUID, uuid4

from common.arguments import arguments

REGISTRY_URL = "https://reports.gscontrol.net"


class InstallationIdentity:
    def __init__(self, path):
        self.path = Path(path)

    def credentials(self):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        # Serialise creation across backend processes, then publish atomically.
        # An unreadable identity must never silently become another installation.
        with (self.path.parent / ".installationid.lock").open("a") as lock:
            os.chmod(lock.name, 0o600)
            fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                data = json.loads(self.path.read_text())
            except FileNotFoundError:
                data = {"installation_id": str(uuid4()), "credential": secrets.token_urlsafe(32)}
                fd, temporary = tempfile.mkstemp(prefix=".installationid-", dir=self.path.parent)
                try:
                    with os.fdopen(fd, "w") as stream:
                        json.dump(data, stream)
                        stream.flush()
                        os.fsync(stream.fileno())
                    os.replace(temporary, self.path)
                    directory = os.open(self.path.parent, os.O_RDONLY | os.O_DIRECTORY)
                    try:
                        os.fsync(directory)
                    finally:
                        os.close(directory)
                finally:
                    Path(temporary).unlink(missing_ok=True)
            if not isinstance(data, dict) or not isinstance(data.get("installation_id"), str):
                raise ValueError("Invalid installation identity")
            UUID(data["installation_id"])
            if not re.fullmatch(r"[A-Za-z0-9_-]{43,128}", data.get("credential", "")):
                raise ValueError("Invalid installation credential")
            # Callers merge credentials into feature state. Extra local metadata
            # must never override consent or delivery settings.
            return {key: data[key] for key in ("installation_id", "credential")}

    async def enroll(self, client, purpose, notice):
        data = self.credentials()
        response = await client.post(REGISTRY_URL + "/v1/installations", json=data)
        response.raise_for_status()
        response = await client.put(
            REGISTRY_URL + f"/v1/installations/{data['installation_id']}/consents/{purpose}",
            headers={"Authorization": f"Bearer {data['credential']}"},
            json={"consent_notice_version": notice},
        )
        response.raise_for_status()


def identity_path():
    if os.getenv("GS_INSTALLATION_STATE"):
        return Path(os.environ["GS_INSTALLATION_STATE"])
    if getattr(arguments, "temp_db", False):
        return Path(arguments.db).with_suffix(".installationid.json")
    return Path(__file__).parent / "data" / "installationid.json"


installation_identity = InstallationIdentity(identity_path())
