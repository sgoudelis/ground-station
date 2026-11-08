# Continuous observations

Continuous observations are configured at `/scheduler/continuous`. Definitions are
stored in the backend database and shared across browsers. Saving, editing,
duplicating, or deleting a definition does not open an SDR or start a decoder.
Enabled definitions start automatically during backend startup. Start and Stop control
the current run. Join opens the waterfall as a viewer without taking ownership.

## Execution

Each run is an unbounded internal observation owned by the backend. Its SDR worker,
fixed VFOs, audio demodulators, and decoders continue when browsers leave or disconnect.
It is not a detached receiving session and cannot be claimed. A run ends on manual
Stop, receiver failure, or backend shutdown. Automatic startup is a saved preference
for the next backend startup; changing it does not affect a current run. A manual
Stop does not disable that preference.

Start reads the saved definition, waits for real IQ samples, checks every VFO against
the applied sample rate and hardware IF bandwidth, then starts the consumers. Up to
ten channels may run with independent audio modulation or data decoding. Startup
failure rolls back internal state and any receiver acquired by that attempt. Existing
receiver owners are never preempted; a busy receiver produces a failure for that
definition while other startup definitions continue. Definitions start in creation
order. Failed runs are shown with their error and require an explicit retry.

While a run is starting, running, or stopping, its receiver and VFO configuration
cannot change and its definition cannot be deleted. Name and startup preference
remain editable metadata. Stop before editing reception settings, then Start to apply
the saved changes. Runtime state is in memory; definition storage contains no workers
or session ownership.

JOIN subscribes to the existing waterfall, fixed VFO markers, audio, and decoder
output. Receiver settings and VFOs are read-only, including through direct Socket.IO
requests and forced takeover attempts. Audio muting is local to each browser. Leaving
removes only the viewer. Stopping the observation ends reception for all viewers;
viewers cannot retain its worker after Stop.

## Storage

The `continuous_observations` table stores a definition UUID, name, `auto_start`
preference, receiver reference (`sdr_id`), receiver configuration (`sdr_config` JSON),
VFO definitions (`vfos` JSON), `config_version`, and server-owned creation/update
timestamps. It contains no runtime session IDs or status. Version 1 accepts one to
ten independently tunable VFOs. Transmitter search copies presets into these fields;
it does not store a transmitter association. Audio modulation and data decoding
are mutually exclusive: choosing an audio mode clears the decoder and its parameters;
choosing a decoder sets modulation to `none`. Both may be `none` when no processing
is selected. Older definitions with both values keep their decoder and treat the
audio fallback as inactive when viewed, imported, or saved.

Definitions are separate from satellite pass observations, which require bounded
start/end times and have their own scheduler lifecycle. Multiple definitions may
reference an SDR; saving does not reserve it. Runtime resource conflicts are checked when starting. Referenced SDRs cannot be deleted until the
definitions are changed or removed.

Normal backend startup applies Alembic revision `a7c9e1b3d5f8` after `f6a8b1c3d5e7`.
The migration creates the table and indexes without changing existing observations.

## Socket.IO API

Use the existing authenticated `api.call` dispatcher with `{cmd, data}`. Replies use
`{success, data, error}`; errors also include `code` (`validation`, `not_found`,
`conflict`, `runtime`, `unavailable`, or `storage`). Existing authenticated operators and administrators can
manage definitions.

| Command | Data | Successful result |
| --- | --- | --- |
| `continuous-observations.list` | `{}` or `null` | Definition array |
| `continuous-observations.get` | `{id}` | Definition |
| `continuous-observations.create` | Editable definition | Saved definition |
| `continuous-observations.update` | Editable definition + `expected_updated_at` | Saved definition |
| `continuous-observations.delete` | `{id, expected_updated_at}` | `{id}` |
| `continuous-observations.start` | `{id, expected_updated_at}` | `{id, runtime}` |
| `continuous-observations.stop` | `{id}` | `{id, runtime}` |

An editable definition has `id`, `name`, `auto_start`, `config_version` (currently 1),
`sdr`, and `vfos`. Read responses include `created_at` and `updated_at`; omit these
from create/update requests. Send the original `updated_at` as `expected_updated_at`
when updating, deleting, or starting. Concurrent edits are checked atomically; a stale writer
gets a conflict instead of overwriting newer changes. The receiver name in responses
comes from the hardware table.

Saving validates the configuration structure, supported decoder parameters, receiver
existence/tuning range, and full VFO channel containment within the configured capture
bandwidth. It does not probe hardware. Driver-selected or automatic IF filter widths
are resolved and checked again against hardware readback at runtime.

Creating the same UUID with identical contents is idempotent. A UUID collision with
different contents returns a conflict. Writes broadcast
`continuous-observations-changed` with `{id}` after commit. Clients refetch on this
event and reconnect, reject obsolete list responses, and clear backend state when
the authenticated session changes.

List/get responses include `runtime` with `status` (`not_started`, `starting`,
`running`, `stopping`, `stopped`, or `failed`), `active`, `started_at`, and `error`.
A failed run whose cleanup could not release its receiver remains active and offers
Stop again; it cannot be edited or restarted over retained resources. Active and
previous runs also expose the internal `session_id`, `sdr_id`, and the definition
version used for that run. Runtime transitions emit the same change notification as
saved definition changes. Start is idempotent while active; Stop is idempotent.

`sdr.watch-sdr` accepts `selectedSDRId` and optional
`continuousObservationId`. The latter prevents joining a replacement run on the
same receiver. The response includes a distinct `continuous_observation` descriptor
with owner session ID, fixed VFO state, and decoder statuses; it never returns that
owner as a claimable receiving observation.

Lifecycle tests use simulated receiver workers. Actual driver startup, IF bandwidth
readback, and decoding reception still require testing with the chosen SDR hardware.

## Existing browser drafts

Legacy drafts remain under the existing browser persistence key until successfully
saved on the backend. The page offers bulk import and individual review/editing.
Each successful import removes only that local draft; failures retain their contents
and report an error. Repeating an unchanged import is safe after a lost response.
