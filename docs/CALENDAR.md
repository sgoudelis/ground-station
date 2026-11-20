# Satellite calendar

The `/calendar` page reads existing scheduled observations through the authenticated
Socket.IO `api.call` command `get-calendar-events`. Opening or navigating the
calendar never creates observations, predicts additional passes, or changes jobs.

Request:

```json
{
  "cmd": "get-calendar-events",
  "data": {"start": "2026-11-01", "end": "2026-12-01", "timezone": "Europe/Athens"}
}
```

`start` and `end` are Gregorian calendar dates in the selected IANA timezone;
`end` is exclusive. Ranges must span 1–62 days. Month view requests all 42 visible
dates, including adjacent-month cells. Each boundary is converted independently
to UTC so daylight saving transitions retain their correct 23/25-hour days.

The standard success envelope contains `data.range`, `data.events`, and
`data.sources`. Events overlap the requested window when `start < window.end`
and `end > window.start`. An observation's appointment uses `task_start` and
`task_end`, falling back individually to its pass boundaries. Original pass
times and peak elevation remain available in `event.observation`.

The feed includes manual and automatically generated observations, their actual
status, and whether they are enabled. Empty ranges contain no events. Disabled
and cancelled jobs remain visible with reduced opacity. There is no sample-data
fallback. Receiver frequencies come from stored task/session configurations in
Hz, with duplicates removed; missing frequencies are omitted from the UI.

The frontend refreshes on `scheduled-observations-changed`,
`observation-status-update`, and reconnect. Bursts are coalesced, requests time
out after 15 seconds, and late responses cannot replace a newer snapshot.
Navigating dates/timezones clears the previous range immediately. Open details
follow refreshed records and close when a record disappears.

Each activity type has its own accent color, shared by its cards, icons, activity
badges, details and filter swatches. Source labels and execution-status badges
remain visible; status changes do not change the activity color. Launch cards
use their existing source label without a repeated activity pill.

The Activity menu supports checking multiple types independently and selecting
all or none. These display choices survive calendar navigation
and refreshes without changing the station-wide feed selections.

Local details emphasize the scheduled task window and duration, followed by
reception details, the satellite pass, and manual/monitored origin. **Open
observation** reads the complete current record before opening the existing
observation editor. Closing the calendar dialog discards a pending open request.
External details emphasize the announced activity window, description, radio
details, and original source. Date-only or unspecified timing stays explicit,
without a fabricated clock time or duration. External events offer a source
link and never open or create an observation.

## Additional sources

`calendars.schemas.CalendarEvent` is the shared feed contract. `source` and
`source_id` retain upstream identity; `id` is prefixed by source, such as
`observations:obs-123`. Common fields include title, kind, timestamps, satellites,
and frequencies. Observation-only metadata lives under `observation` and is
optional. Announcements must remain separate from local observation jobs, even
when they concern the same satellite and time window.

## External events and global consent

The calendar's gear dialog contains station-wide switches for observations,
satellite announcements, space weather and launches. Only administrators can
change them through `calendar.external.update`. Observations need no consent.
All three external feeds share one acceptance of the in-app `events-1` disclosure:

```json
{"feed_id": "announcements", "enabled": true, "terms_version": "events-1"}
```

The backend records feed selections in `calendar_feeds` and the shared receipt,
installation binding and polling metadata in `calendar_services`. It imports
the legacy `backend/data/events/state.json` once and removes that file after
committing. `GS_EVENTS_STATE` overrides only this legacy input path. SQL settings
are authoritative. Database restores invalidate consent; an installation binding
prevents copied receipts from authorizing a different station. Missing, unreadable,
invalid or outdated consent prevents downloads and hides external events.
Later feed switches reuse the same acceptance. See [CALENDAR_FEEDS.md](CALENDAR_FEEDS.md)
for migration and restore details.

No requests to the external service are made before acceptance, including health
probes or registrations. After acceptance, event downloads use backend HTTPS GETs
with a fixed rolling date range, shared installation ID and credential, deployment
environment and ordinary HTTP connection metadata including the public IP.
Registration at `reports.gscontrol.net` and a separate `events` consent grant
precede the first pull. The identity comes from `backend/data/installationid.json`,
also used by the independently optional hardware census. No station coordinates,
usernames or observation jobs are sent. The shared ID permits the provider to
recognise overlap between the separately enabled features.

The pre-release `events-1` disclosure covers seven-day request/IP retention,
60-day latest-contact/country retention, local country inference and one-year
aggregates without IDs or IPs. The provider considers an installation active
for 168 hours after a valid authenticated census or event contact. Each source
keeps its own timestamp; event pulls never refresh old hardware snapshots.
A valid event request counts as contact even if publication fails.

## Local cache and polling

`cached_external_events` stores a disposable, shared snapshot. It contains no
consent. A single backend lifecycle task fetches while any external feed is
enabled, normally every **600 seconds (ten minutes)**, independently of open
browsers. Each attempt reserves its next poll in SQL before networking. Calendar
navigation reads the cache; the refresh button explicitly requests an update and
joins an ongoing download. HTTP 429 `Retry-After` also applies to manual refresh.
Requests have a 15-second I/O timeout, a
45-second total deadline, an 8 MiB decoded body limit, and never follow redirects.

The requested interval is `[UTC today - 30 days, UTC today + 180 days)`. Calendar
navigation reads SQL only. Source metadata reports coverage and whether a view
extends beyond it. Date bounds prune expired cache rows daily even while the
provider is unavailable; reads also enforce the rolling bounds immediately.

Complete, valid feed snapshots replace that feed's cache in one transaction. Missing IDs
disappear, including withdrawals or events whose approval was revoked upstream.
Failures retain the affected feed's previous cache while healthy feeds update.
Explicit event expiry is enforced even offline. The calendar footer shows the
last synchronization or error. Withdrawal reaches a station at its next successful
sync. Local observations remain available when the external service/cache fails.

Turning every external feed off pauses downloads and retains the shared consent.
Explicit withdrawal (`{"revoke": true}`) persists the global choice before
deleting the external cache, cancels an active download and rejects late results.
A durable pending withdrawal removes only event consent and event details at the
registry, retrying after outages. Census consent and the shared identity remain.
This withdrawal request is the only permitted traffic after withdrawing consent.
All browsers refresh on `external-events-changed`. No local observation is
created, modified or deleted by this integration.

## Required public service contract

The Ground Station client expects `GET https://events.gscontrol.net/v1/events`
with exclusive `start` and `end` ISO dates. It requires HTTP 200 and a complete
snapshot for exactly the requested interval:

```json
{
  "schema_version": 1,
  "range": {"start": "2026-10-19", "end": "2027-05-17"},
  "refresh_after_seconds": 600,
  "feeds": [
    {"id": "announcements", "complete": true, "stale": false},
    {"id": "space_weather", "complete": true, "stale": false},
    {"id": "launches", "complete": true, "stale": false}
  ],
  "events": [{
    "id": "stable-occurrence-id",
    "revision": 1,
    "review_status": "approved",
    "title": "Satellite activity announcement",
    "feed_id": "announcements",
    "kind": "sstv",
    "start": "2026-11-18T10:00:00Z",
    "end": "2026-11-18T11:00:00Z",
    "time_precision": "instant",
    "satellites": [{"name": "ISS", "norad_id": 25544}],
    "frequencies": [{"hz": 145800000, "mode": "FM"}],
    "change": "announcement",
    "source_url": "https://example.org/announcement"
  }]
}
```

The service must select **approved, current, canonical** events, omit superseded
and duplicate records, and expand recurrence into stable occurrence IDs. Requests
use the shared installation credential and event consent; a console cookie or
census opt-in is not required. Responses are
limited to 10,000 unique event IDs and must not silently truncate or paginate.
The publication contract is independent of the private console's internal schema.

The client also rejects unapproved, superseded, duplicate or noncanonical entries
if included accidentally. Frequencies are Hz. End boundaries are always exclusive.
`time_precision: "date"` uses date-only boundaries; `"unspecified"` also uses
civil dates, with optional `timing_note` preserving source times whose timezone is
unknown. If the start instant is known but the end is not, optional `start_at`
retains that timezone-aware timestamp. The calendar shows a single start marker
on the viewer's local start day, with no assumed end or duration and no missing-start
warning. Date boundaries remain source coverage metadata in that case. Without
`start_at`, the station also recognizes an older publisher's exact generated
`Start: YYYY-MM-DD HH:MM UTC` timing-note prefix (also accepting GMT/Z and seconds),
provided its date matches the occurrence. This works with existing cached rows
without waiting for a publisher upgrade. Other non-instant dates stay fixed when
the viewer changes timezone and show the missing-time/timezone notice.
`change: "cancellation"` remains visible
as a cancelled announcement when explicitly approved for publication.

The public API address is `https://events.gscontrol.net` (health check:
`GET /health`). The bundled version-1 contract requires updating server and station
together. Stations contact it only after an administrator accepts the shared
calendar terms and selects at least one external feed.
