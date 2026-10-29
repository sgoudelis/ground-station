# Copyright (c) 2026 Efstratios Goudelis
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

"""Public API response contracts and examples for OpenAPI consumers."""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any, Literal, cast

from pydantic import BaseModel, ConfigDict, Field

PUBLIC_API_DESCRIPTION = """Read-only API for third-party ground-station applications.

### Get started

1. Create a personal API token in the signed-in browser app under **API Tokens**.
   Select the scopes your application needs when creating it.
2. Click **Authorize** on this page and enter the token as a Bearer credential.
3. Call `GET /api/v1/me` to check the token owner and granted scopes.

For direct HTTP requests, send the token with every call:

```http
Authorization: Bearer YOUR_TOKEN
```

Browser session cookies do not authenticate `/api/v1` routes. A missing, expired,
or revoked token returns `401`; a token without the required scope returns `403`.
Scopes are fixed when the token is created.

### Find data

- `GET /api/v1/station` identifies the station; `GET /api/v1/status` reports
  observation activity.
- `GET /api/v1/trackers/rotators` returns current assigned rotator states for
  reconnecting event clients.
- `GET /api/v1/trackers/rigs` returns current assigned rig states for reconnecting
  event clients.
- List satellites, observations, SDRs, rotators, rigs, and artifacts to discover IDs
  before calling their detail routes. Each route below documents its parameters,
  response schema, and example.

### Follow changes and download files

- `GET /api/v1/events` streams Server-Sent Events. Its response documents the
  frame syntax and each event payload. The stream does not replay missed events;
  refresh the relevant REST resources after reconnecting.
- Artifact metadata includes `api_download_url`. Download routes return files
  or ZIPs and accept HTTP byte ranges for direct files. Downloading requires
  `artifacts:download`.

### Choose scopes

- `station:read` — station identity, status, tracker hardware states, and target,
  tracker, SDR, rotator, and rig events.
- `observations:read` — schedules and observation events.
- `artifacts:read` — library metadata and artifact readiness events.
- `artifacts:download` — artifact file bytes.
- `satellites:read`, `sdrs:read`, `rotators:read`, `rigs:read` — the corresponding list and
  detail routes.

To resolve a device ID from an SDR, rotator, or rig event, combine `station:read`
with the device's read scope. Token management and control commands are in
the browser app.
"""


class TokenIdentity(BaseModel):
    token_id: str
    user_id: str
    username: str
    role: Literal["admin", "operator"]
    scopes: list[str]


class StationIdentity(BaseModel):
    name: str | None
    callsign: str | None


class StationResponse(BaseModel):
    station: StationIdentity | None
    version: str
    api_version: Literal["v1"]


class StationStatus(BaseModel):
    server_time: datetime
    observation_state: Literal["idle", "observing"]
    active_observation_count: int
    next_observation_at: datetime | None
    monitored_satellite_count: int


class Pagination(BaseModel):
    limit: int
    offset: int
    total: int


class SdrMetadata(BaseModel):
    id: str = Field(description="Configured UUID or the built-in `sigmf-playback` ID.")
    name: str
    type: str | None
    antenna_labels: dict[str, Any]
    frequency_min: float | None
    frequency_max: float | None


class SdrList(BaseModel):
    data: list[SdrMetadata]
    pagination: Pagination


class SdrDetail(BaseModel):
    data: SdrMetadata


class RotatorMetadata(BaseModel):
    id: str
    name: str
    azimuth_mode: str
    minaz: int
    maxaz: int
    minel: int
    maxel: int
    parkaz: float | None
    parkel: float | None


class RotatorList(BaseModel):
    data: list[RotatorMetadata]
    pagination: Pagination


class RotatorDetail(BaseModel):
    data: RotatorMetadata


class RigMetadata(BaseModel):
    id: str
    name: str
    radiotype: str
    radio_mode: str
    vfotype: int
    tx_control_mode: str
    retune_interval_ms: int
    follow_downlink_tuning: bool


class RigList(BaseModel):
    data: list[RigMetadata]
    pagination: Pagination


class RigDetail(BaseModel):
    data: RigMetadata


RotatorRuntimeState = Literal[
    "unavailable",
    "disconnected",
    "connected",
    "motion_unconfirmed",
    "error",
    "out_of_bounds",
    "slewing",
    "tracking",
    "park_requested",
    "parked",
    "stopped",
]


class TrackerRotatorStatus(BaseModel):
    tracker_id: str
    device_id: str
    state: RotatorRuntimeState
    tracking_enabled: bool = Field(
        description="True while tracking mode is active, including a slew."
    )
    observed_at: float | None = Field(
        description="Unix seconds of the worker observation, or null when unavailable."
    )


class TrackerRotatorList(BaseModel):
    data: list[TrackerRotatorStatus]


RigRuntimeState = Literal[
    "unavailable", "disconnected", "connected", "error", "tuning", "tracking", "stopped"
]


class TrackerRigStatus(BaseModel):
    tracker_id: str
    device_id: str
    state: RigRuntimeState
    tracking_enabled: bool = Field(
        description="True while tracking mode is active, including tuning."
    )
    observed_at: float | None = Field(
        description="Unix seconds of the worker observation, or null when unavailable."
    )


class TrackerRigList(BaseModel):
    data: list[TrackerRigStatus]


class SatelliteSummary(BaseModel):
    norad_id: int
    name: str
    status: str | None


class SatelliteList(BaseModel):
    data: list[SatelliteSummary]
    pagination: Pagination


class MonitoredSatellite(BaseModel):
    id: str
    norad_id: int
    name: str | None
    enabled: bool
    min_elevation: float | None


class MonitoredSatelliteList(BaseModel):
    data: list[MonitoredSatellite]
    pagination: Pagination


class SatelliteMetadata(SatelliteSummary):
    operator: str | None
    countries: str | None = Field(description="Catalog country code or comma-separated codes.")
    launched: datetime | None


class SatelliteDetail(BaseModel):
    data: SatelliteMetadata


class UpcomingObservation(BaseModel):
    id: str
    name: str
    status: str
    norad_id: int
    satellite_name: str | None
    event_start: datetime
    event_end: datetime
    peak_altitude: float | None


class UpcomingObservationList(BaseModel):
    data: list[UpcomingObservation]


class ObservationRecord(BaseModel):
    """Full schedule record; nested hardware and session settings vary by job."""

    model_config = ConfigDict(extra="allow")

    id: str
    name: str | None = None
    enabled: bool | None = None
    status: str | None = None
    satellite: dict[str, Any] = Field(default_factory=dict)
    pass_data: dict[str, Any] = Field(default_factory=dict, alias="pass")
    task_start: datetime | None = None
    task_end: datetime | None = None
    rotator: dict[str, Any] = Field(default_factory=dict)
    rig: dict[str, Any] = Field(default_factory=dict)
    transmitter: dict[str, Any] = Field(default_factory=dict)
    sessions: list[Any] = Field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None
    error_message: str | None = None
    error_count: int | None = None
    actual_start_time: datetime | None = None
    actual_end_time: datetime | None = None
    execution_log: list[Any] = Field(default_factory=list)


class ObservationList(BaseModel):
    data: list[ObservationRecord]


class ObservationDetail(BaseModel):
    data: ObservationRecord


class ArtifactMetadata(BaseModel):
    """Common library fields; recording, folder, and bundle details add fields."""

    model_config = ConfigDict(extra="allow")

    id: str
    type: str
    name: str | None = None
    display_name: str | None = None
    size: int | None = None
    created: datetime | None = None
    modified: datetime | None = None
    api_download_url: str = Field(
        description="API-token download URL. Following it requires `artifacts:download`."
    )
    api_download_urls: dict[str, str] | None = None


class DiskUsage(BaseModel):
    total: int
    used: int
    available: int


class ArtifactList(BaseModel):
    items: list[ArtifactMetadata]
    total: int
    page: int
    page_size: int
    revision: int
    has_more: bool
    disk_usage: DiskUsage = Field(alias="diskUsage")


class ArtifactDetail(BaseModel):
    data: ArtifactMetadata


class ConnectedEvent(BaseModel):
    replay: Literal[False] = Field(
        description="Events missed before this connection are not replayed."
    )


class ObservationChangedEvent(BaseModel):
    id: str | None = Field(default=None, description="Absent for a bulk schedule change.")
    status: str | None = Field(default=None, description="Absent when no single status applies.")


class TargetIdentity(BaseModel):
    type: Literal["satellite", "mission", "body"]
    id: str
    name: str


class TargetChangedEvent(BaseModel):
    tracker_id: str
    previous: TargetIdentity | None
    current: TargetIdentity | None


class TargetSlotEvent(BaseModel):
    tracker_id: str


class TargetVisibilityEvent(BaseModel):
    tracker_id: str
    norad_id: str
    name: str
    elevation_deg: float


class TrackerHardwareChangedEvent(BaseModel):
    tracker_id: str
    device: Literal["rig", "rotator"]
    device_id: str | None
    connected: bool
    previous_connected: bool | None


class TrackerRotatorStateChangedEvent(BaseModel):
    tracker_id: str
    device_id: str | None
    previous_device_id: str | None
    previous: RotatorRuntimeState | None
    current: RotatorRuntimeState
    previous_tracking_enabled: bool | None
    tracking_enabled: bool
    observed_at: float | None = Field(description="Unix seconds of the observation or worker loss.")


class TrackerRigStateChangedEvent(BaseModel):
    tracker_id: str
    device_id: str | None
    previous_device_id: str | None
    previous: RigRuntimeState | None
    current: RigRuntimeState
    previous_tracking_enabled: bool | None
    tracking_enabled: bool
    observed_at: float | None = Field(description="Unix seconds of the observation or worker loss.")


class ArtifactReadyEvent(BaseModel):
    id: str
    type: str
    name: str


class SdrStreamingEvent(BaseModel):
    sdr_id: str


TOKEN_EXAMPLE = {
    "token_id": "3a51452d-9ec3-40e4-a5dc-ecf20f1041b3",
    "user_id": "861724a9-cd70-4988-a34a-77f8b51004f8",
    "username": "operator",
    "role": "operator",
    "scopes": ["station:read", "sdrs:read"],
}
STATION_EXAMPLE = {
    "station": {"name": "Ground Station", "callsign": "N0CALL"},
    "version": "1.0.0",
    "api_version": "v1",
}
STATUS_EXAMPLE = {
    "server_time": "2026-10-15T10:00:00+00:00",
    "observation_state": "idle",
    "active_observation_count": 0,
    "next_observation_at": "2026-10-15T11:30:00+00:00",
    "monitored_satellite_count": 2,
}
SDR_EXAMPLE = {
    "id": "56e5471c-6d0e-4fc2-a2ad-5a26036c78d8",
    "name": "VHF SDR",
    "type": "rtlsdrusbv4",
    "antenna_labels": {"RX": {"A": "VHF antenna"}},
    "frequency_min": 24,
    "frequency_max": 1800,
}
ROTATOR_EXAMPLE = {
    "id": "fa67b8d6-9c51-4a99-ac97-d1ad4df65f89",
    "name": "Roof rotator",
    "azimuth_mode": "0_450",
    "minaz": 0,
    "maxaz": 450,
    "minel": 0,
    "maxel": 90,
    "parkaz": 180,
    "parkel": 0,
}
RIG_EXAMPLE = {
    "id": "3b620a17-5ee4-4667-bdd8-2a222e785785",
    "name": "VHF/UHF radio",
    "radiotype": "rx",
    "radio_mode": "duplex",
    "vfotype": 2,
    "tx_control_mode": "auto",
    "retune_interval_ms": 2000,
    "follow_downlink_tuning": False,
}
SATELLITE_EXAMPLE = {"norad_id": 25544, "name": "ISS", "status": "active"}
MONITORED_EXAMPLE = {
    "id": "iss-monitor",
    "norad_id": 25544,
    "name": "ISS",
    "enabled": True,
    "min_elevation": 15,
}
SATELLITE_DETAIL_EXAMPLE = {
    **SATELLITE_EXAMPLE,
    "operator": "NASA",
    "countries": "US",
    "launched": "1998-11-20T00:00:00+00:00",
}
UPCOMING_EXAMPLE = {
    "id": "iss-pass-1",
    "name": "ISS pass",
    "status": "scheduled",
    "norad_id": 25544,
    "satellite_name": "ISS",
    "event_start": "2026-10-15T11:30:00+00:00",
    "event_end": "2026-10-15T11:40:00+00:00",
    "peak_altitude": 64.2,
}
OBSERVATION_EXAMPLE = {
    "id": "iss-pass-1",
    "name": "ISS pass",
    "enabled": True,
    "status": "scheduled",
    "satellite": {"norad_id": 25544, "name": "ISS", "group_id": None},
    "pass": {
        "event_start": "2026-10-15T11:30:00+00:00",
        "event_end": "2026-10-15T11:40:00+00:00",
        "peak_altitude": 64.2,
    },
    "task_start": None,
    "task_end": None,
    "rotator": {},
    "rig": {},
    "transmitter": {},
    "sessions": [],
    "created_at": "2026-10-14T09:00:00+00:00",
    "updated_at": "2026-10-14T09:00:00+00:00",
    "error_message": None,
    "error_count": 0,
    "actual_start_time": None,
    "actual_end_time": None,
    "execution_log": [],
}
ARTIFACT_EXAMPLE = {
    "id": "snapshot:waterfall.png",
    "type": "snapshot",
    "name": "waterfall",
    "api_download_url": "/api/v1/artifacts/snapshot%3Awaterfall.png/download",
}
ARTIFACT_LIST_EXAMPLE = {
    "items": [ARTIFACT_EXAMPLE],
    "total": 1,
    "page": 1,
    "page_size": 25,
    "revision": 3,
    "has_more": False,
    "diskUsage": {"total": 1000000, "used": 250000, "available": 750000},
}

JSON_EXAMPLES: dict[str, dict[str, Any]] = {
    "me": TOKEN_EXAMPLE,
    "station": STATION_EXAMPLE,
    "status": STATUS_EXAMPLE,
    "sdrs": {
        "data": [
            {
                "id": "sigmf-playback",
                "name": "SigMF Playback",
                "type": "sigmfplayback",
                "antenna_labels": {},
                "frequency_min": None,
                "frequency_max": None,
            },
            SDR_EXAMPLE,
        ],
        "pagination": {"limit": 50, "offset": 0, "total": 2},
    },
    "sdr": {"data": SDR_EXAMPLE},
    "rotators": {
        "data": [ROTATOR_EXAMPLE],
        "pagination": {"limit": 50, "offset": 0, "total": 1},
    },
    "rotator": {"data": ROTATOR_EXAMPLE},
    "rigs": {
        "data": [RIG_EXAMPLE],
        "pagination": {"limit": 50, "offset": 0, "total": 1},
    },
    "rig": {"data": RIG_EXAMPLE},
    "tracker_rotators": {
        "data": [
            {
                "tracker_id": "target-1",
                "device_id": ROTATOR_EXAMPLE["id"],
                "state": "slewing",
                "tracking_enabled": True,
                "observed_at": 1792068000.0,
            }
        ]
    },
    "tracker_rigs": {
        "data": [
            {
                "tracker_id": "target-1",
                "device_id": RIG_EXAMPLE["id"],
                "state": "tracking",
                "tracking_enabled": True,
                "observed_at": 1792068000.0,
            }
        ]
    },
    "satellites": {
        "data": [SATELLITE_EXAMPLE],
        "pagination": {"limit": 50, "offset": 0, "total": 1},
    },
    "monitored_satellites": {
        "data": [MONITORED_EXAMPLE],
        "pagination": {"limit": 100, "offset": 0, "total": 1},
    },
    "satellite": {"data": SATELLITE_DETAIL_EXAMPLE},
    "observations": {"data": [OBSERVATION_EXAMPLE]},
    "upcoming_observations": {"data": [UPCOMING_EXAMPLE]},
    "observation": {"data": OBSERVATION_EXAMPLE},
    "artifacts": ARTIFACT_LIST_EXAMPLE,
    "artifact": {"data": ARTIFACT_EXAMPLE},
}

JSON_MODELS: dict[str, type[BaseModel]] = {
    "me": TokenIdentity,
    "station": StationResponse,
    "status": StationStatus,
    "sdrs": SdrList,
    "sdr": SdrDetail,
    "rotators": RotatorList,
    "rotator": RotatorDetail,
    "rigs": RigList,
    "rig": RigDetail,
    "tracker_rotators": TrackerRotatorList,
    "tracker_rigs": TrackerRigList,
    "satellites": SatelliteList,
    "monitored_satellites": MonitoredSatelliteList,
    "satellite": SatelliteDetail,
    "observations": ObservationList,
    "upcoming_observations": UpcomingObservationList,
    "observation": ObservationDetail,
    "artifacts": ArtifactList,
    "artifact": ArtifactDetail,
}

JSON_ROUTE_EXAMPLES = {
    "/api/v1/me": "me",
    "/api/v1/station": "station",
    "/api/v1/status": "status",
    "/api/v1/sdrs": "sdrs",
    "/api/v1/sdrs/{sdr_id}": "sdr",
    "/api/v1/rotators": "rotators",
    "/api/v1/rotators/{rotator_id}": "rotator",
    "/api/v1/rigs": "rigs",
    "/api/v1/rigs/{rig_id}": "rig",
    "/api/v1/trackers/rotators": "tracker_rotators",
    "/api/v1/trackers/rigs": "tracker_rigs",
    "/api/v1/observations": "observations",
    "/api/v1/observations/upcoming": "upcoming_observations",
    "/api/v1/observations/{observation_id}": "observation",
    "/api/v1/satellites": "satellites",
    "/api/v1/satellites/monitored": "monitored_satellites",
    "/api/v1/satellites/{norad_id}": "satellite",
    "/api/v1/artifacts": "artifacts",
    "/api/v1/artifacts/{artifact_id}": "artifact",
}

JSON_SCOPES = {
    "station": "station:read",
    "status": "station:read",
    "sdrs": "sdrs:read",
    "sdr": "sdrs:read",
    "rotators": "rotators:read",
    "rotator": "rotators:read",
    "rigs": "rigs:read",
    "rig": "rigs:read",
    "tracker_rotators": "station:read",
    "tracker_rigs": "station:read",
    "satellites": "satellites:read",
    "monitored_satellites": "satellites:read",
    "satellite": "satellites:read",
    "observations": "observations:read",
    "upcoming_observations": "observations:read",
    "observation": "observations:read",
    "artifacts": "artifacts:read",
    "artifact": "artifacts:read",
}

NOT_FOUND_DETAILS = {
    "sdr": "SDR not found.",
    "rotator": "Rotator not found.",
    "rig": "Rig not found.",
    "satellite": "Satellite not found.",
    "observation": "Observation not found.",
    "artifact": "Artifact not found.",
}


def _inline_schema(model: type[BaseModel]) -> dict[str, Any]:
    """Inline Pydantic definitions so OpenAPI references remain valid in a response."""
    schema = model.model_json_schema()
    definitions = schema.pop("$defs", {})

    def expand(value: Any) -> Any:
        if isinstance(value, list):
            return [expand(item) for item in value]
        if isinstance(value, dict):
            reference = value.get("$ref")
            if isinstance(reference, str) and reference.startswith("#/$defs/"):
                definition = definitions[reference.rsplit("/", 1)[-1]]
                return expand(
                    {**definition, **{key: item for key, item in value.items() if key != "$ref"}}
                )
            return {key: expand(item) for key, item in value.items()}
        return value

    return cast(dict[str, Any], expand(schema))


def json_example(name: str, *, not_found: bool = False) -> dict[int | str, dict[str, Any]]:
    """Attach a real response shape beside the generated JSON schema."""
    responses: dict[int | str, dict[str, Any]] = {
        200: {
            "content": {
                "application/json": {
                    "schema": _inline_schema(JSON_MODELS[name]),
                    "example": JSON_EXAMPLES[name],
                }
            }
        },
        401: {
            "description": "Missing, invalid, expired, or revoked API token.",
            "content": {"application/json": {"example": {"detail": "Valid API token required."}}},
        },
    }
    scope = JSON_SCOPES.get(name)
    if scope:
        responses[403] = {
            "description": f"Token lacks `{scope}`.",
            "content": {"application/json": {"example": {"detail": f"Scope {scope} required."}}},
        }
    if not_found:
        responses[404] = {
            "description": "The requested resource does not exist.",
            "content": {
                "application/json": {
                    "example": {"detail": NOT_FOUND_DETAILS[name]},
                }
            },
        }
    return responses


_SSE_EVENTS: list[tuple[str, str | None, type[BaseModel], dict[str, Any], str]] = [
    ("connected", None, ConnectedEvent, {"replay": False}, "Sent on every connection."),
    ("station.status", "station:read", StationStatus, STATUS_EXAMPLE, "Initial/current status."),
    (
        "observations.changed",
        "observations:read",
        ObservationChangedEvent,
        {"id": "iss-pass-1", "status": "running"},
        "A schedule edit or observation status transition.",
    ),
    (
        "target.changed",
        "station:read",
        TargetChangedEvent,
        {
            "tracker_id": "target-1",
            "previous": None,
            "current": {"type": "satellite", "id": "25544", "name": "ISS"},
        },
        "Assigned target identity changes; previous/current may be null.",
    ),
    (
        "target.slot.created",
        "station:read",
        TargetSlotEvent,
        {"tracker_id": "target-2"},
        "A persistent target slot is created.",
    ),
    (
        "target.slot.deleted",
        "station:read",
        TargetSlotEvent,
        {"tracker_id": "target-2"},
        "A persistent target slot is deleted.",
    ),
    (
        "target.visible",
        "station:read",
        TargetVisibilityEvent,
        {"tracker_id": "target-1", "norad_id": "25544", "name": "ISS", "elevation_deg": 0.5},
        "A running satellite target slot rises above 0° or starts above it.",
    ),
    (
        "target.below_horizon",
        "station:read",
        TargetVisibilityEvent,
        {"tracker_id": "target-1", "norad_id": "25544", "name": "ISS", "elevation_deg": 0.0},
        "A running satellite target slot crosses to 0° or below.",
    ),
    (
        "tracker.hardware.changed",
        "station:read",
        TrackerHardwareChangedEvent,
        {
            "tracker_id": "target-1",
            "device": "rotator",
            "device_id": ROTATOR_EXAMPLE["id"],
            "connected": True,
            "previous_connected": False,
        },
        "An observed rig or rotator connection changes.",
    ),
    (
        "tracker.rotator.state.changed",
        "station:read",
        TrackerRotatorStateChangedEvent,
        {
            "tracker_id": "target-1",
            "device_id": ROTATOR_EXAMPLE["id"],
            "previous_device_id": ROTATOR_EXAMPLE["id"],
            "previous": "slewing",
            "current": "tracking",
            "previous_tracking_enabled": True,
            "tracking_enabled": True,
            "observed_at": 1792068000.0,
        },
        "An observed rotator status or tracking-mode flag changes, or worker telemetry is lost.",
    ),
    (
        "tracker.rig.state.changed",
        "station:read",
        TrackerRigStateChangedEvent,
        {
            "tracker_id": "target-1",
            "device_id": RIG_EXAMPLE["id"],
            "previous_device_id": RIG_EXAMPLE["id"],
            "previous": "connected",
            "current": "tracking",
            "previous_tracking_enabled": False,
            "tracking_enabled": True,
            "observed_at": 1792068000.0,
        },
        "An observed rig status or tracking-mode flag changes, or worker telemetry is lost.",
    ),
    (
        "artifact.ready",
        "artifacts:read",
        ArtifactReadyEvent,
        {"id": "snapshot:waterfall.png", "type": "snapshot", "name": "waterfall"},
        "A library item first appears complete or finishes processing.",
    ),
    (
        "sdr.streaming.started",
        "station:read",
        SdrStreamingEvent,
        {"sdr_id": SDR_EXAMPLE["id"]},
        "An SDR worker delivers its first IQ samples.",
    ),
    (
        "sdr.streaming.stopped",
        "station:read",
        SdrStreamingEvent,
        {"sdr_id": SDR_EXAMPLE["id"]},
        "An active SDR worker stops, including after failure.",
    ),
]


def _sse_frame(name: str, payload: dict[str, Any]) -> str:
    return f"event: {name}\ndata: {json.dumps(payload, separators=(',', ':'))}\n\n"


SSE_DESCRIPTION = """A long-lived Server-Sent Events stream. Use a Bearer API token with
`station:read`, `observations:read`, or `artifacts:read`; each scope receives only its
events. The HTTP response is **text/event-stream**, not a JSON array. Each frame has
an `event:` name and one `data:` line containing JSON, followed by a blank line.
The stream first sends `retry: 3000` and `connected` with `{"replay":false}`;
`station:read` also receives an initial `station.status`. `: keepalive` is a
heartbeat comment. No event IDs or missed-event replay are available. On
reconnect, fetch relevant REST resources again. Keep this request open; Swagger
UI's Try it out is not a practical long-running SSE client. For example:

```sh
curl -N -H 'Authorization: Bearer YOUR_TOKEN' http://localhost:5000/api/v1/events
```

The OpenAPI response examples show literal SSE frames. The machine-readable
`x-sse-events` response extension contains each JSON payload schema, scope, and
trigger.

| Event | Scope | When |
| --- | --- | --- |
""" + "\n".join(
    f"| `{name}` | {f'`{scope}`' if scope else 'Any accepted event scope'} | {description} |"
    for name, scope, _model, _sample, description in _SSE_EVENTS
)

SSE_RESPONSE = {
    200: {
        "description": "Live SSE frames; the connection remains open.",
        "content": {
            "text/event-stream": {
                "schema": {"type": "string", "description": "Literal SSE wire format."},
                "examples": {
                    "connection": {
                        "summary": "Connection prelude",
                        "value": "retry: 3000\n\n" + _sse_frame("connected", {"replay": False}),
                    },
                    **{
                        name: {"summary": description, "value": _sse_frame(name, sample)}
                        for name, _scope, _model, sample, description in _SSE_EVENTS
                        if name != "connected"
                    },
                    "heartbeat": {"summary": "Idle keepalive comment", "value": ": keepalive\n\n"},
                },
            }
        },
        "x-sse-events": [
            {
                "event": name,
                "scope": scope,
                "description": description,
                "payload_schema": _inline_schema(model),
            }
            for name, scope, model, _sample, description in _SSE_EVENTS
        ],
    },
    401: {
        "description": "Missing, invalid, expired, or revoked API token.",
        "content": {"application/json": {"example": {"detail": "Valid API token required."}}},
    },
    403: {
        "description": "Token has none of the event read scopes.",
        "content": {
            "application/json": {
                "example": {"detail": "Station, observations, or artifacts read scope required."}
            }
        },
    },
    429: {
        "description": "Too many open streams for this token or server.",
        "content": {
            "application/json": {"example": {"detail": "Too many open API event streams."}}
        },
    },
}


ARTIFACT_DOWNLOAD_DESCRIPTION = """Download an indexed artifact with a Bearer token
that has `artifacts:download`. A single file returns its bytes; a decoded folder
or observation bundle returns a ZIP. The optional `part` query selects a
recording's `meta`, `snapshot`, or `thumbnail`, a snapshot's `thumbnail`, or a
decoded/audio `metadata` when present. Fetch `GET /api/v1/artifacts/{artifact_id}`
with `artifacts:read` to discover `api_download_url` and available part links.
Direct files support `Range: bytes=start-end` and may return 206; ZIP generation
does not support partial responses. For example:

```sh
curl -H 'Authorization: Bearer YOUR_TOKEN' \\
  'http://localhost:5000/api/v1/artifacts/recording:capture/download' \\
  --output capture.sigmf-data
curl -H 'Authorization: Bearer YOUR_TOKEN' -H 'Range: bytes=0-1048575' \\
  'http://localhost:5000/api/v1/artifacts/recording:capture/download' \\
  --output first-megabyte.bin
```
"""

ARTIFACT_MEMBER_DESCRIPTION = """Download one file within an indexed decoded
folder or observation bundle. Use the `api_download_url` on an `images` or
`artifacts` entry in `GET /api/v1/artifacts/{artifact_id}`, or append a
relative member path. Paths must remain inside the indexed folder. Requires
`artifacts:download`; direct files support `Range: bytes=start-end`.

```sh
curl -H 'Authorization: Bearer YOUR_TOKEN' \\
  'http://localhost:5000/api/v1/artifacts/observation:ISS.gsobs/files/decoded/image.png' \\
  --output image.png
```
"""

RANGE_HEADER = {
    "parameters": [
        {
            "name": "Range",
            "in": "header",
            "required": False,
            "description": "Optional byte range for a direct file, e.g. `bytes=0-1048575`.",
            "schema": {"type": "string"},
            "example": "bytes=0-1048575",
        }
    ]
}


def binary_responses(*, allow_zip: bool) -> dict[int, dict[str, Any]]:
    binary = {"schema": {"type": "string", "format": "binary"}}
    content = {"application/octet-stream": binary}
    if allow_zip:
        content["application/zip"] = binary
    return {
        200: {"description": "Complete file or ZIP content.", "content": content},
        206: {
            "description": "Partial direct-file content for a valid Range request.",
            "content": {"application/octet-stream": binary},
        },
        401: {
            "description": "Missing, invalid, expired, or revoked API token.",
            "content": {"application/json": {"example": {"detail": "Valid API token required."}}},
        },
        403: {
            "description": "Token lacks `artifacts:download`.",
            "content": {
                "application/json": {"example": {"detail": "Scope artifacts:download required."}}
            },
        },
        404: {
            "description": "Artifact or requested part/member does not exist.",
            "content": {"application/json": {"example": {"detail": "Artifact file not found."}}},
        },
    }
