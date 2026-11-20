# Copyright (c) 2026 Efstratios Goudelis
# SPDX-License-Identifier: GPL-3.0-or-later

"""Source-independent calendar entries, with observation details kept separate."""

from datetime import date, datetime, time, timedelta, timezone
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator


class CalendarRange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    start: date
    end: date
    timezone: str = Field(default="UTC", min_length=1, max_length=100)

    @model_validator(mode="after")
    def validate_range(self):
        if not timedelta(0) < self.end - self.start <= timedelta(days=62):
            raise ValueError("Calendar range must be between 1 and 62 days; end is exclusive.")
        try:
            ZoneInfo(self.timezone)
        except (ValueError, ZoneInfoNotFoundError) as exc:
            raise ValueError("Unknown calendar timezone.") from exc
        return self

    def utc_bounds(self) -> tuple[datetime, datetime]:
        # Convert each midnight independently: DST days need not last 24 hours.
        zone = ZoneInfo(self.timezone)
        return (
            datetime.combine(self.start, time.min, zone).astimezone(timezone.utc),
            datetime.combine(self.end, time.min, zone).astimezone(timezone.utc),
        )


class CalendarSatellite(BaseModel):
    name: str
    norad_id: int | None = None


class CalendarFrequency(BaseModel):
    hz: float = Field(gt=0, allow_inf_nan=False)
    mode: str | None = None


class ObservationDetails(BaseModel):
    monitored_satellite_id: str | None = None
    pass_start: AwareDatetime
    pass_end: AwareDatetime
    peak_altitude: float | None = None


class CalendarEvent(BaseModel):
    # Prefix IDs with their source so remote announcements can coexist with
    # local jobs even when their upstream identifiers happen to be identical.
    id: str
    source: str
    feed_id: str | None = None
    source_id: str
    title: str
    kind: str
    start: AwareDatetime | date
    end: AwareDatetime | date
    time_precision: Literal["instant", "date", "unspecified"] = "instant"
    # Optional known start when the source cannot supply a complete interval.
    # Date boundaries still describe source coverage, not an assumed duration.
    start_at: AwareDatetime | None = None
    satellites: list[CalendarSatellite] = Field(default_factory=list)
    frequencies: list[CalendarFrequency] = Field(default_factory=list)
    description: str | None = None
    status: str | None = None
    enabled: bool | None = None
    observation: ObservationDetails | None = None
    source_url: str | None = None
    timing_note: str | None = None
    change: str | None = None
    expires_at: AwareDatetime | None = None
    source_updated_at: AwareDatetime | None = None
    publication_method: str | None = None

    @property
    def has_known_date(self):
        """Coarse launch estimates from older snapshots must not become appointments."""
        if self.kind != "launch":
            return True
        if isinstance(self.start, datetime) and isinstance(self.end, datetime):
            return True  # A real timed launch window can cross midnight.
        return (
            type(self.start) is date
            and type(self.end) is date
            and self.end - self.start == timedelta(days=1)
        )
