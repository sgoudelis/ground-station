# Optional installation census

Census reporting is off by default for new and existing installations. The
first-run wizard offers a Feedback step before Review. Administrators can change
the installation-wide choice under **Settings → Feedback**
(`/admin/system/feedback`; `/settings/feedback` redirects there).
Opening either page or changing an unsaved switch does not enable reporting.
Performance reporting is reserved for a later phase and has no controls yet.

Both pages share the `census-2` disclosure: why the project collects a census,
every reported field, the destination, frequency, storage/retention, withdrawal,
and the distinction between pseudonymous reporting and anonymity. The Settings
page additionally generates a local payload preview and shows delivery/deletion
status. Previewing makes no collector requests. English strings are the fallback
for languages that do not yet have translations of the new notice.

## Data sent

The backend sends only the allowlist constructed in `backend/feedback/payload.py`:

- Schema/disclosure versions and a random installation UUID.
- Normalized Ground Station version and build channel.
- Native/Docker deployment and the backend-configured environment
  (`production`, `development`, `test`, `unknown`). Environment is independent
  of build channel and is included in the local payload preview.
  Unknown is valid and does not imply production.
- OS family, distribution ID/version and CPU architecture.
- CPU vendor/model/logical cores.
- GPU detection status and vendor/model for at most four GPUs. PCI device model
  codes are used if model names cannot be obtained. Serial numbers and bus
  addresses are excluded.
- Total RAM rounded up to a GiB bucket, capped at 1024 GiB.

The collector observes the backend connection's public source IP and records it
separately from JSON, along with receipt/consent times and recent activity. This
may be a NAT/router/VPN egress address. No public-IP lookup service is contacted.
With `census-2` consent, the collector also infers an approximate country during
ingestion using a local country-only GeoIP database. Reporter IPs never go to an
external lookup API. It stores a nullable country code beside the latest snapshot;
VPNs/hosting networks affect estimates. No city or station coordinates are inferred.
Station identities, callsigns, coordinates, hostname, user/account data, radio
configuration, recordings, logs, serial numbers and performance data are excluded.

The current collector stores one latest census snapshot, first/latest report
times and a seven-day activity bitmap. The latest IP expires seven days after
the last report; census data, derived country and consent expire after 60 days without a report.
Hourly server cleanup implements these expiry windows. Raw IP visibility is
restricted to administrators of the private statistics console.

## Consent and delivery

The existing Socket.IO `api.call` transport exposes `feedback.get` and
`feedback.update`. Both are admin-only and unavailable to unauthenticated setup
sockets. First-run consent instead travels inside the validated `setup.finalize`
payload and is saved only after the administrator account is created. Older
clients that omit feedback do not change consent. Optional feedback storage
failure does not invalidate completed station setup; the wizard shows a warning.

An opt-in must carry boolean `enabled: true` and
`consent_notice_version: "census-2"`. The backend generates and persists a random
UUID and a 32-byte random URL-safe credential before any request. Only the
collector sees the credential; it never appears in frontend responses or logs.
Registration is retry-safe, and an explicit consent update grants census only.
Existing valid `census-1` grants continue reporting without country inference.
Settings permits saving the updated disclosure without changing a switch.
Only that explicit action renews the grant as `census-2`.
Unsupported saved notice versions stop reporting and queue census withdrawal.
The preview and all outgoing requests use the notice actually accepted, so a
restart or software upgrade never silently expands consent.

The sender runs once in the normal single-process backend lifecycle. It sends
shortly after opt-in, then every 24–25 hours. Its next attempt survives restarts.
Requests use the fixed HTTPS origin `https://reports.gscontrol.net`, TLS
verification, no redirects and no environment-proxy inheritance. HTTP requests
have ten-second timeouts and the complete registration/grant/upload sequence
has a 20-second deadline. Retries back off to six hours with jitter and respect
numeric/date `Retry-After` headers on HTTP 429. Authentication, consent,
unsupported-contract and redirect failures stop automatic submissions; only an
administrator's explicit saved action restarts them.

Turning census off and saving persists the choice before requesting purpose-
specific withdrawal. A bounded in-flight report may finish before the save is
acknowledged; once the save succeeds, no new report begins. Census withdrawal
deletes the remote census snapshot, derived country and IP, retaining the shared identity for
future independently consented purposes. No registration/grant requests are made
while opted out. If unavailable, withdrawal stays pending across restarts and
retries automatically. An explicit new opt-in supersedes a pending withdrawal.

The collector intentionally returns HTTP 401 for both a missing identity and an
invalid credential. If an identity has already expired during a long offline
period, a withdrawal may therefore stop with an authentication error even though
the census data is already absent. The UI keeps that status visible instead of
claiming a confirmed deletion. Renewing census consent retries registration with
the same durable identity. No whole-installation deletion is used as a fallback,
so future reporting purposes cannot be erased by a census-only withdrawal.

## Local persistence

Consent, the installation credential, pending withdrawal and delivery state live
in `backend/data/feedback/state.json`. It is written atomically with mode `0600`
in a private directory. Unreadable/invalid storage stops reporting and preserves
the original file for administrator repair. Census failures never stop station
operation. The state is outside the SQL database and SQL backup exports; the
existing Git/Docker exclusions omit `backend/data`.

Persist this directory across upgrades. Do not copy it into application images,
station templates or other installations. Losing it also loses the credential
needed to withdraw that installation's stored census. Ordinary Docker data
volumes retain it alongside other backend data.

`GS_FEEDBACK_STATE` can select a separate state-file path for an isolated backend
instance. Temporary-database mode automatically uses a separate temporary state
directory instead of the real station's consent. The reporting environment comes
from `GS_FEEDBACK_ENVIRONMENT`, falling back to `GS_ENVIRONMENT`, then
`production`. Invalid values are reported as `unknown`. The development launcher
(`backend/startdev.sh`) defaults to `development`; pytest and the CI browser-test
backend use `test`. Operators can override the launcher default with
`GS_FEEDBACK_ENVIRONMENT` when needed. Restart the backend after changing its
deployment environment.

Previously saved administrator selections and labels sent by older clients no
longer override deployment configuration. Existing consent and installation
identities are preserved; changing environment never opts an installation into
reporting. Direct consent-file edits require a restart.

## Verification

From `backend/`:

```bash
ALEMBIC_CONTEXT=1 ./venv/bin/pytest --no-cov tests/testfeedback.py tests/testsetup.py tests/testsocketauth.py tests/test_auth.py
```

From `frontend/`:

```bash
npm test -- --run src/components/settings/__tests__/feedback-form.test.jsx src/components/settings/__tests__/location-timezone.test.jsx
npm run build
```

Unit tests use temporary state and mock HTTPS transports; they do not submit
census data to the public collector. Setup E2E expectations include the new
optional step. Performance and diagnostic reporting require separate future
contracts, implementation and user consent.

Deploy the collector/console supporting `census-2` and schema revision 3 before
shipping this client notice. Old clients remain supported; no historical IP
backfill is performed. Missing country data never prevents census ingestion.
