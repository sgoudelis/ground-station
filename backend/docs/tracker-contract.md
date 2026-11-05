# Tracker Contract

Status: current

## Scope

Tracking is instance-scoped. Each tracker instance has its own identity and may
own one rotator at a time.

Physical connections are station-owned and survive tracker handoffs. Device
ownership, standalone manual control, and telemetry are defined in
[hardware-control.md](hardware-control.md). Tracker assignments select devices;
the hardware service grants and fences actual control.

## Core Decisions

1. Tracker identity is mandatory in contracts.
   - `tracker_id` is required on all tracker-related requests/events.

2. Tracking becomes instance-scoped.
   - No contract assumes a single global tracking context.
   - All tracking updates, command statuses, and UI tracker values are tied to a tracker instance.

3. One tracker instance owns one rotator at a time.
   - Ownership conflicts are resolved server-side.
   - A rotator cannot be actively controlled by multiple tracker instances.

4. Frontend target flow is rotator-first.
   - "Set as Target" opens a rotator-selection dialog.
   - Target selection only completes after a rotator is chosen.

## Event Contract

- `satellite-tracking`
  - Required: `tracker_id`
  - Live payload: `tracking_state`, `satellite_data.position`, small target identity in
    `satellite_data.details`, `rotator_data`, `rig_data`, `events`, `context_key`, and
    `context_revision`. Orbit paths, full details, transmitters, and coverage
    polygons are not sent on each tick.

- `satellite-tracking-context`
  - Required: `tracker_id`, `context_key`, `context_revision`, `satellite_data`
  - Carries changed `details`, `paths`, or `transmitters` fields. A target change
    sends all fields; a transmitter edit can send only the transmitter list.
    It does not carry tracking controls. Visible maps calculate coverage from
    each live position; the backend does not construct a coverage polygon.

- `observer-sky-update`
  - Carries shared observer sky bodies occasionally and on a target context read.

- `ui-tracker-state`
  - Required: `tracker_id`
  - Contains UI selection payload for the corresponding tracker instance

- `tracker-command-status`
  - Required: `tracker_id`, `command_id`, `status`

## API / Handler Contract

- Tracking read/write handlers accept `tracker_id` in request payload.
- `get-tracker-context` returns the latest complete context to a viewing client;
  it compiles fresh data from the database when no worker is running, so edits
  to a stopped target are visible on the next request.
- Tracking responses include `tracker_id`.
- Event names are unversioned. `tracker_id` distinguishes tracker instances
  inside their payloads; there is no parallel versioned event stream.

## Naming Contract for Persistence

- Canonical tracking-state name format:
  - `satellite-tracking:<tracker_id>`
