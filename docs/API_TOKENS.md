# API tokens

Signed-in users can create and revoke personal API tokens from **API Tokens** in the
sidebar user menu. A token belongs to its creator and is shown only when created.
Create a separate token for each application so access can be revoked independently.

Select only the scopes an application needs. The currently available scopes are:

| Scope | Endpoints |
| --- | --- |
| `station:read` | `GET /api/v1/station`, `GET /api/v1/status`, `GET /api/v1/trackers/rotators`, `GET /api/v1/trackers/rigs`, `GET /api/v1/events` (station, target, tracker hardware, and SDR events) |
| `sdrs:read` | `GET /api/v1/sdrs`, `GET /api/v1/sdrs/{sdr_id}` |
| `rotators:read` | `GET /api/v1/rotators`, `GET /api/v1/rotators/{rotator_id}` |
| `rigs:read` | `GET /api/v1/rigs`, `GET /api/v1/rigs/{rig_id}` |
| `satellites:read` | `GET /api/v1/satellites`, `GET /api/v1/satellites/monitored`, `GET /api/v1/satellites/{norad_id}` |
| `observations:read` | `GET /api/v1/observations`, `GET /api/v1/observations/upcoming`, `GET /api/v1/observations/{id}`, `GET /api/v1/events` (observation events) |
| `artifacts:read` | `GET /api/v1/artifacts`, `GET /api/v1/artifacts/{id}`, `GET /api/v1/events` (`artifact.ready`) |
| `artifacts:download` | `GET /api/v1/artifacts/{id}/download`, `GET /api/v1/artifacts/{id}/files/{path}` |

`GET /api/v1/me` checks a token and returns its owner and granted scopes. For
example:

```sh
curl -H 'Authorization: Bearer YOUR_TOKEN' http://localhost:5000/api/v1/me
```

Interactive OpenAPI documentation is available at `/api/docs`; use its Bearer
authorization control to try `/api/v1` requests with a personal API token.
Each JSON route shows a response schema and example. The event route shows
literal SSE frames and a table of event scopes and triggers; its OpenAPI
`x-sse-events` extension contains machine-readable payload schemas. File
download routes show binary responses, range syntax, and `curl` examples.

For a Home Assistant REST sensor, `GET /api/v1/status` returns server time,
`observation_state` (`idle` or `observing`), the active observation count, next
scheduled observation time, and enabled monitored-satellite count. This state
describes scheduled observations; manual radio activity may not change it.
Poll it with a token that has `station:read`; it does not require a browser session.

`GET /api/v1/sdrs`, `GET /api/v1/rotators`, and `GET /api/v1/rigs` return paginated device metadata.
All support `limit` (1–100, default 50) and `offset` (default 0), and return
`data` plus `pagination`. Their detail endpoints resolve the `sdr_id` in SDR
streaming events and a rotator `device_id` in `tracker.hardware.changed` events.
SDR metadata includes name, type, antenna labels, and configured frequency
range. Rotator metadata includes name, azimuth/elevation limits, azimuth mode,
and park position. Rig metadata includes radio type and mode, VFO type, transmit
control mode, retune interval, and whether downlink tuning is followed.
Connection hosts and ports, SDR serials, and driver settings
are omitted. The built-in `sigmf-playback` SDR is included in the SDR list and
has a detail endpoint, even though it has no database record. For both event
delivery and device lookup, grant `station:read` alongside `sdrs:read` or
`rotators:read` or `rigs:read`. Existing tokens need replacing to gain a new scope.

`GET /api/v1/trackers/rotators` returns one current-state row per assigned
rotator tracker with `tracker_id`, `device_id`, `state`, `tracking_enabled`, and
`observed_at` (Unix seconds). It requires `station:read`. A row is `unavailable`
with a null observation time until its current worker supplies telemetry, or
when that worker is gone. This does not assert that the rotator itself has
disconnected. The response omits trackers without an assigned rotator.

```sh
curl -H 'Authorization: Bearer YOUR_TOKEN' http://localhost:5000/api/v1/trackers/rotators
```

`GET /api/v1/trackers/rigs` returns the same snapshot shape for assigned rigs.
States are `disconnected`, `connected`, `error`, `tuning`, `tracking`, `stopped`,
and `unavailable`. `tracking_enabled` remains true while a rig is tuning in
tracking mode. A missing current-worker observation yields `unavailable` and a
null `observed_at`; it does not claim the radio disconnected. Both rig snapshot
and rig events require `station:read`.

```sh
curl -H 'Authorization: Bearer YOUR_TOKEN' http://localhost:5000/api/v1/trackers/rigs
```

`GET /api/v1/observations/upcoming` returns compact scheduled pass summaries
without hardware configuration or execution logs. The optional `hours` window
is 1–168 (default 24), `limit` is 1–100 (default 25), and `norad_id` filters
to one satellite. `GET /api/v1/satellites/monitored` lists enabled entries by
default and supports `enabled_only=false`, `limit` (1–200), and `offset` for
pagination. `GET /api/v1/satellites` browses the catalog with optional `query`
name search, `limit` (1–100), and `offset`. The full observation endpoints are
intended for custom applications that need the complete schedule data.

Upcoming observations are scheduled jobs, not every predicted satellite pass.
A separate predicted-pass endpoint would need a bounded forecast and protection
against expensive repeated propagation.

`GET /api/v1/events` is a read-only Server-Sent Events (SSE) stream for custom
applications and Home Assistant custom integrations. Use an API token with
`station:read` for station, target, tracker hardware, and SDR events,
`observations:read` for `observations.changed`, and `artifacts:read` for
`artifact.ready`. Combine scopes to receive their respective events:

```sh
curl -N -H 'Authorization: Bearer YOUR_TOKEN' http://localhost:5000/api/v1/events
```

The stream starts with `connected` (`{"replay":false}`) and, for tokens with
`station:read`, a `station.status` snapshot shaped like `GET /api/v1/status`.
It then sends `station.status` when meaningful status fields change and
`observations.changed` after schedule edits or observation status transitions.
An observation event may include `id` and `status`; fetch the REST observation
endpoints for current details. Changing a tracker's assigned target sends
`target.changed` with `tracker_id`, `previous`, and `current`; each target has
`type`, `id`, and `name`, and `previous` is null on first assignment. Selecting
a different target tab in one browser does not change a tracker assignment.
Creating or deleting a persistent target process sends `target.slot.created` or
`target.slot.deleted` with its `tracker_id`. A running satellite target slot
sends `target.visible` on its first above-horizon reading or an upward crossing,
and `target.below_horizon` on a downward crossing. Both include `tracker_id`,
`norad_id`, `name`, and `elevation_deg`. An initially hidden target sends no
horizon event until it rises. `tracker.hardware.changed` reports observed rig
and rotator connection changes with `tracker_id`, `device`, `device_id`,
`connected`, and `previous_connected` (null when first observed).
`tracker.rotator.state.changed` reports an assigned rotator's observed status
transition with `tracker_id`, `device_id`, `previous_device_id`, `previous`,
`current`, `previous_tracking_enabled`, `tracking_enabled`, and `observed_at`
(Unix seconds). The first observation has null `previous`; a worker that exits
or is replaced sends `unavailable` rather than assuming a hardware disconnect.
Statuses are `disconnected`, `connected`, `motion_unconfirmed`, `error`,
`out_of_bounds`, `slewing`, `tracking`, `park_requested`, `parked`, `stopped`, and
`unavailable`. A rotator can be in tracking mode while slewing, so
`tracking_enabled` remains true during
that status. Connection and status events are independent; clients can consume
this status event alone for rotator state. On every SSE connection or
reconnection, fetch `/api/v1/trackers/rotators` to establish the current state.
When a tracker switches rotators, `previous_device_id` identifies the former
device even if `device_id` is null during release.
`tracker.rig.state.changed` uses the same fields for rig transitions. Its
states are `disconnected`, `connected`, `error`, `tuning`, `tracking`, `stopped`,
and `unavailable`. Frequency and Doppler adjustments do not emit state-change
events. Fetch `/api/v1/trackers/rigs` on each SSE connection or reconnection,
and resolve a rig `device_id` with `/api/v1/rigs/{rig_id}` using `rigs:read`.
`artifact.ready` provides `id`, `type`, and `name` when a library item first
appears complete or finishes recording/processing. Fetch its current metadata
with `GET /api/v1/artifacts/{id}`; startup indexing does not replay old items.
When an SDR worker delivers its first IQ samples, the stream sends
`sdr.streaming.started` with `sdr_id`. It sends `sdr.streaming.stopped` when that
worker stops, including after a failure. Joining or leaving a shared SDR stream
does not generate these events while the worker remains active. Heartbeat
comments keep idle connections open.
The stream has no durable replay or event IDs: on every connection or
reconnection, refresh any observation lists your client needs from REST.
Target, hardware, and SDR events describe live transitions; the current target and SDR
state are not included in `/api/v1/status`. Current rotator state is available
from `/api/v1/trackers/rotators`.
Clients that fall behind are disconnected so they can reconnect and refresh.
Revoked tokens and disabled accounts are rechecked at least every 15 seconds.

Standard Home Assistant REST sensors should continue polling `/api/v1/status`;
consuming SSE requires a custom integration. Browser `EventSource` cannot set
an Authorization header, so browser applications should use a fetch-based SSE
client. Do not put API tokens in URLs. The stream is process-local and requires
a shared event broker before deploying multiple backend workers.

Artifact metadata includes `api_download_url` alongside browser-facing `url`
fields. A token with `artifacts:download` can follow the API link to fetch a
single file, or a ZIP containing a decoded folder or observation bundle. A token
can have `artifacts:read` without download access, or download access without
metadata access when the artifact ID is already known. Recording metadata also
includes `api_download_urls` for its SigMF data, SigMF metadata, and available
waterfall images. Snapshot thumbnails and decoded/audio metadata have part links
when present; JSON metadata downloads use `api_download_urls.metadata` and
`part=metadata`. Folder detail responses include API links for individual listed
files. Other folder members can be fetched at
`/api/v1/artifacts/{id}/files/{relative_path}`; the path must stay inside the
indexed folder. Large direct files support HTTP `Range` requests. For example:

```sh
curl -H 'Authorization: Bearer YOUR_TOKEN' \
  'http://localhost:5000/api/v1/artifacts/recording:capture/download' \
  --output capture.sigmf-data
curl -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Range: bytes=0-1048575' \
  'http://localhost:5000/api/v1/artifacts/recording:capture/download' \
  --output first-megabyte.bin
```

The existing browser-facing file URLs still use browser-session authentication,
including `/snapshots`. Control endpoints remain outside this API slice.

Token management uses the owner's browser login over Socket.IO `api.call`.
The commands are `tokens.scopes`, `tokens.list`, `tokens.create`,
`tokens.rename`, and `tokens.revoke`. Creating a token also requires the
current password. Revocation takes effect immediately while
retaining its metadata in the list. Scopes are fixed at creation; replace a token
to change its access. Password resets revoke the user's API tokens, and disabled
accounts cannot use them.

API tokens authenticate only the public `/api/v1` routes. They do not open a
browser session or authorize the existing Socket.IO `api.call` interface.
