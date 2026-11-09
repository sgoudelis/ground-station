# Station hardware control

Rotator and physical radio connections belong to station hardware workers, not
target tracker processes. A device stays connected when its control owner changes.
`hardware/service.py` supervises one process per instantiated physical device;
`hardware/runtime.py` owns its controller, polling, limits, and physical motion
guard. Tracker workers reach these processes through `hardware/client.py`.

## Ownership and execution

Each device has one command owner: a tracker producer incarnation, a scheduled
observation, or station manual control. Telemetry can have many subscribers.
Ownership generations are transient and change whenever control is revoked.
Every producer request contains that generation, the backend epoch, and a deadline.
Device workers check these immediately before I/O, including after queued waits.

Release fences the previous owner, pauses automatic updates, and stops an active
rotator. When Stop is needed, stationary samples must be confirmed before a new
owner can acquire control. The TCP stream remains open. Late Disconnect from the
old owner acknowledges detachment without closing the new owner's stream.
Explicit Disconnect closes the physical connection.

Late requests from an intentionally released owner detach that tracker quietly,
without a hardware-error event or toast. Its pending device commands are cancelled
without sending Stop or closing the new owner's connection. Failed handoffs,
watchdog expiry, and transport failures retain normal error reporting.

Hamlib Stop acknowledgement waits at most 5 seconds (or a shorter configured
controller timeout). Handoff still requires fresh stationary-position samples.

Pause revokes control and fences queued automatic updates while preserving the
connection. It sends no physical Stop command. An active rotator retains motion
uncertainty until fresh stationary samples confirm that its last movement has
finished. The rotator popover keeps separate Pause and Stop buttons in the action
row; physical Stop is disabled when the controller does not support it. Rig Pause
suspends automatic frequency updates.

Disconnect revokes control, pauses automatic updates, and closes the socket
without sending Hamlib `S` or opening a recovery connection. An active rotator
retains `motion_unconfirmed` and a `stop_warning`: the antenna may continue its
last movement after disconnecting. Explicit Stop and handoff still use the
configured Stop capability and motion checks. A failed position/frequency read
closes the broken transport, marks the device disconnected, and stops polling
until an explicit reconnect.
No automatic reconnect is scheduled after a deliberate Disconnect.

Rotator settings include **Controller supports Stop** (`stop_supported`, default
true). Disable this for firmware such as S.A.T. versions that ignore Hamlib `S`.
The worker then pauses automatic commands without sending `S`, preserving motion
uncertainty. A handoff can proceed only after fresh stationary readings confirm
that the mount has settled. Settings edits retain this motion guard.

Scheduled observations allow up to 120 seconds (bounded by task end or LOS) for an
unsupported-Stop rotator to finish its existing slew. The previous producer is
paused immediately and the observation retains its device reservation while
waiting for fresh stationary readings. This wait runs outside the device lock,
so telemetry and operator
Pause/Stop/Disconnect remain responsive. A disconnect, worker failure, or another
control change aborts the handoff; continuing motion still fails at the deadline.

At observation end, optional parking is followed by a direct Disconnect. Closing
the connection does not send Stop or require stationary readings. A Disconnect
deadline must not trigger a physical Stop. Temporary tracker removal follows
disconnection; cleanup failures retain the tracker context for retry without
claiming that the hardware failed to disconnect.

Manual takeover can release an interactive tracker. Observations reserve their
whole device bundle during handoff and cannot be displaced by manual takeover.
An explicit tracker Connect can take a connected rotator from manual control,
superseding pending manual commands while retaining the physical connection.
The handoff still confirms stationary motion before granting the tracker control.
This permission applies only to the manual ownership generation seen at acceptance;
saved tracking intent and automatic reconnects cannot displace manual control.
Pause, Stop, and explicit operator Disconnect are available independently of
ownership, including during observations, and revoke queued producer writes.
Stop retains an existing manual owner with a new ownership generation, allowing
another manual move after fresh stationary readings confirm the stop. Automatic
producers lose ownership, and commands queued before Stop remain fenced.
Pause and Disconnect do not acquire manual control. They interrupt pending device
operations and update the former target's connection state before reporting
completion. Their generation checks prevent delayed requests from disrupting a
new owner.

Observation handoff checks station hardware owners and saved tracker selections
alongside the rotator assignment map, including selections left after manual
takeover. It releases the active producer before clearing old slot references.
Delayed telemetry and command results from a released tracker cannot restore its
connection status or tracking intent, or block the observation's new owner.

Satellite geometry, Doppler calculation, tracking lead, and pass-specific overlap
planning remain with target tracking. Device workers enforce position bounds and
retain physical motion uncertainty across ownership changes. Whole radio tuning
transactions, including VFO selection and restoring RX, execute within one device
lock using `hardware/rigcontrol.py`.

Tracker target heartbeats renew automatic pointing only after a target has been
resolved. A 15-second lapse pauses rig automation or physically stops rotator
motion. Lost producer communication also releases idle tracker ownership. Closing
a browser dialog does not cancel a submitted movement.

SDR software VFO tracking continues through its existing session path. SDRs do
not acquire physical-radio workers or retune the shared SDR center frequency.

## Socket.IO contracts

`get-hardware-state` returns `epoch`, `server_time`, `devices`, and recent manual
`commands`. Configuration continues to come from `get-rotators` / `get-rigs`.
`hardware-state` broadcasts snapshots independently of tracker telemetry. Each
snapshot carries `kind`, `device_id`, backend `epoch`, ownership `generation`,
`worker_generation`, `worker_started_at`, `sequence`, `observed_at`, `owner`, and
device `data`. Owner is null or an object with `type` and `id`.

Position samples additionally have `position_sequence` and
`position_observed_at`. Movement completion requires two fresh position samples;
repeated publications of cached positions cannot complete it.

`control-hardware` accepts `kind`, `device_id`, `action`, `command_id`, `epoch`,
`accept_before`, and the last observed `generation`. Stop can use an older
generation. Move additionally accepts `position: {az, el}`. Actions are
`connect`, `disconnect`, `take-control`, `release`, `pause`, `stop`, and rotator-specific
`move`, `park`, `unpark`.

The acknowledgement contains `data.command`; completion uses the existing
`tracker-command-status` event and shared operation registry. Manual records have
a synthetic command scope `manual:<kind>:<device_id>`; this does not create a
tracker, target slot, or satellite tracking state.

`GET /api/v1/hardware` exposes independent device observations to API clients
with `station:read`. Existing tracker-specific REST and Socket.IO views remain
available for target consumers.

## Persistence and recovery

Connection intent is stored separately in `tracking_state` JSON rows named
`hardware:<kind>:<device_id>`. These rows have independent validation and need no
schema migration. Existing `satellite-tracking:<tracker_id>` rows continue to
restore target selections and supported tracking/parking intent.

Startup restores hardware connections before tracker ownership. Manual leases,
ownership generations, and manual movement targets are never restored. A worker
restart creates a new generation and preserves uncertainty about any previous
motion. Reconnecting does not prove that the mount stopped.

Before restoring target workers, startup clears conflicting saved physical-device
assignments from all affected targets and logs the conflict. Those targets remain
available for explicit reassignment; database iteration order never selects an
automatic control owner. Shared SDR assignments are excluded from this check.

The UI stores device observations and manual commands outside tracker view
state. It rejects older worker generations, sequences, and backend epochs, and
reconciles commands after reconnect. The hardware popover lists configured devices
even with zero targets; manual movement needs only a device and manual ownership.

## Verification

`tests/testhardware.py` exercises IPC and real TCP traffic against local fake
Hamlib servers, ownership fencing, preserved connections, automatic-update expiry,
manual operation completion, and connection persistence without a sky target.
Existing tracker Stop and operation lifecycle tests remain applicable.
