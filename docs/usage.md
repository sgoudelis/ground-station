# Activity sharing

Activity sharing helps the project maintain a country map of Ground Station
installations. The first-time wizard offers an **Anonymous usage ping** checkbox on the
Station Identity page, checked by default. It takes effect only after setup
creates the administrator account. Administrators can change it later in
the **Activity sharing** card at the bottom of **Settings → General** (`/admin/system/general`). Opening settings or
changing an unsaved checkbox never changes the stored choice. Use the page's
**Save Settings** button to apply it; **Reset** discards the pending change.
Activity consent still uses its separate `usage.update` API and local
`backend/data/usage/state.json` store. It is never a runtime configuration key in
`app_config.json`; changing only this checkbox does not update that file.

Existing installations start with sharing off. Old census preferences do not
enable activity sharing. Ground Station no longer collects or submits hardware
census reports; the collector continues supporting older census clients.

## Request and stored data

The backend sends an HTTPS `POST` to `https://reports.gscontrol.net/v1/usage`
containing only its existing random installation UUID and deployment environment:

```json
{"installation_id": "4e9f3467-1b9c-46c0-a35d-b59aaef228c1", "environment": "production"}
```

It sends no installation credential, hardware or OS information, application
version, account data, station coordinates, callsign, radio settings or logs.
No registration or census consent request accompanies this feature.

The receiver uses the connection's public source IP to estimate country using a
local GeoIP database, then discards the IP. It makes no external GeoIP API calls.
It stores one record per installation: UUID, environment, nullable country code, and latest
contact time. Unknown countries still count. VPNs and hosting networks can affect
country estimates. Installations sharing a public IP remain separate because
counts use the UUID.

Records are retained indefinitely. The private Control Room map distinguishes
recent contact (within 48 hours), older contact, and all records using the latest
contact timestamp. The 48-hour threshold never deletes records. Turning sharing
off stops future requests; existing records remain.

This is pseudonymous activity sharing: the persistent random ID identifies an
installation. External satellite announcements use the same local identity and
their existing, independently controlled consent and request contract.

## Production and development

Activity and event requests both use the application's existing `GS_ENVIRONMENT`
setting. Production container images and the Drone pipeline already set it to
`production` or `development`; the native application and development launcher
default to `development`. Native production launches can set
`GS_ENVIRONMENT=production`. No separate reporting environment variable is needed.

Activity accepts `production`, `development`, or `unknown`. Invalid values become
Unknown. Automated tests set `GS_ENVIRONMENT=test`; the event service retains its
Test classification, while activity maps it to Unknown. Restart after changing
runtime configuration. Build version strings and frozen version metadata never
override the runtime environment.

Changing this label never changes the installation UUID, saved choice or 12-hour
schedule. The receiver stores the label from the latest request. Older clients
that omit it and previously stored records are Unknown; there is no retrospective
classification. Control Room defaults to Production and applies its environment
filter to every count and country, alongside the recent/older filter.

## Scheduling and local storage

After enabling sharing, the first request is sent shortly afterward. Subsequent
requests are scheduled 12 hours apart while the backend runs, independently of
browser sessions. Failed requests wait until the next 12-hour attempt. Scheduling
is persisted before sending and survives restarts and checkbox toggles.

Requests have a ten-second overall deadline, verify TLS, follow no redirects and
ignore environment proxy configuration. Saving an opt-out waits for a bounded
in-flight request; after the save succeeds, no new request starts. Failures never
interrupt station operation.

The choice and schedule live in `backend/data/usage/state.json` (override with
`GS_USAGE_STATE`). Temporary backends use an isolated sibling state directory.
The shared UUID remains in `backend/data/installationid.json`, outside SQLite and
SQL backup exports. `GS_INSTALLATION_STATE` overrides that path. Preserve the
identity across upgrades, and never distribute or copy it to another station.
Unreadable local settings stop sharing until storage is repaired.

The old `backend/data/feedback/state.json` is ignored. Removing the old sender
stops census submissions and withdrawal retries; existing remote census data
continues following the collector's existing retention rules.

Settings use administrator-only `usage.get` and `usage.update` Socket.IO RPCs.
First-time setup submits `usage: {"enabled": true|false}` inside `setup.finalize`;
older clients omitting it leave activity settings unchanged. Optional activity
storage failures show a warning after setup rather than invalidating the account.

Deploy the Control Room receiver supporting `/v1/usage` and reporting schema
revision 7 before releasing this client. This client makes no schema changes to
the Ground Station database.

## Verification

Backend tests use temporary state and mock HTTPS transports; they never submit
activity to the public collector. From `backend/`:

```bash
ALEMBIC_CONTEXT=1 ./venv/bin/pytest --no-cov tests/testusage.py tests/testsetup.py tests/testinstallationid.py tests/testcalendar.py
```

From `frontend/`:

```bash
npm test -- --run src/components/settings/__tests__/usage-form.test.jsx src/components/settings/__tests__/location-timezone.test.jsx src/components/setup/__tests__/setup.test.jsx src/i18n/__tests__/coverage.test.js
npm run build
```
