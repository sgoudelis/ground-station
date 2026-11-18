# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later

"""Public event snapshot contract; independent of the private console's models."""

from datetime import date, datetime
from typing import Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    HttpUrl,
    TypeAdapter,
    field_validator,
    model_validator,
)

from calendars.schemas import CalendarEvent

EVENTS_URL = "https://events.gscontrol.net"
TERMS_VERSION = "events-1"
POLL_SECONDS = 6 * 60 * 60
PAST_DAYS = 30
FUTURE_DAYS = 180
SOURCE: Literal["gscontrol"] = "gscontrol"


class PublishedEvent(CalendarEvent):
    """Only explicit approval may enter the cache, even if upstream misbehaves."""

    id: str = Field(min_length=1, max_length=128)
    source: Literal["gscontrol"] = SOURCE
    source_id: str = Field(default="", max_length=128)
    title: str = Field(min_length=1, max_length=500)
    kind: Literal[
        "sstv",
        "ssdv",
        "voice_contact",
        "digipeater",
        "transponder",
        "audio",
        "broadcast",
        "other_radio",
    ]
    review_status: Literal["approved"]
    revision: int = Field(ge=1)
    superseded: Literal[False] = False
    duplicate_of: None = None
    canonical_id: str | None = None
    source_url: str | None = Field(default=None, max_length=2048)
    observation: None = None
    description: str | None = Field(default=None, max_length=10000)
    timing_note: str | None = Field(default=None, max_length=1000)
    change: Literal["announcement", "correction", "cancellation", "outage"] = "announcement"

    @field_validator("source_url")
    @classmethod
    def http_source(cls, value):
        return str(TypeAdapter(HttpUrl).validate_python(value)) if value else value

    @model_validator(mode="after")
    def published_boundaries(self):
        if self.canonical_id is not None and self.canonical_id != self.id:
            raise ValueError("An attached source is not a canonical event")
        precise = self.time_precision == "instant"
        if isinstance(self.start, datetime) != precise or isinstance(self.end, datetime) != precise:
            raise ValueError("Timing precision must match both boundaries")
        if self.end <= self.start:
            raise ValueError("Event end must follow start; end is exclusive")
        return self

    def calendar_payload(self):
        payload = self.model_dump(mode="json")
        payload.update(
            id=f"{SOURCE}:{self.id}",
            source_id=self.id,
            enabled=True,
            status="cancelled" if self.change == "cancellation" else None,
        )
        # Publication metadata is validated above, but is not an observation job.
        return payload


class SnapshotRange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    start: date
    end: date


class EventSnapshot(BaseModel):
    """One bounded, complete snapshot; incomplete pages must never replace a cache."""

    model_config = ConfigDict(extra="forbid")
    schema_version: Literal[1]
    range: SnapshotRange
    events: list[PublishedEvent] = Field(max_length=10000)

    @model_validator(mode="after")
    def unique_events(self):
        if len({event.id for event in self.events}) != len(self.events):
            raise ValueError("Snapshot contains duplicate IDs")
        return self
