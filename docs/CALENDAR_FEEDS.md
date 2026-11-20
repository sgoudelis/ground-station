# Calendar feed settings and shared external-service consent

Calendar settings are station-wide and managed by administrators through the
gear dialog. Local observations require no consent. Satellite announcements,
space weather and launches share one external-service consent and one bundled
`GET https://events.gscontrol.net/v1/events` request. Enabling one feed does not
enable the others. The disclosure explains that every download contains all three
external feeds; switches control which categories appear in the calendar.

## Persistence and migration

`calendar_services` holds the gscontrol service receipt, installation binding,
remote grant/withdrawal state, polling timestamps and per-feed upstream health.
`calendar_feeds` holds `observations`, `announcements`, `space_weather` and
`launches` selections. Local observations default on; the two new external feeds
default off. Configuration and its acceptance are saved in one SQL transaction.
Browser localStorage is no longer used for feed selection.

Alembic revision `d4a8f2c6e0b1` creates the settings tables and adds `feed_id` and
`expires_at` to `cached_external_events`. The first service load imports a valid
legacy `backend/data/events/state.json` once, preserving its original terms,
administrator and acceptance timestamp. It binds that receipt to the existing
installation identity, then removes the obsolete JSON input after the database
commit. An invalid receipt cannot grant network access. Database settings are
authoritative even if a leftover legacy file exists.

An external feed needs current shared consent before it can be enabled. Later
external switches reuse that acceptance. Pausing all external feeds stops polling
and retains consent and cache. The separate withdrawal action disables all
external feeds, clears their cache and schedules the existing remote withdrawal;
only withdrawal retries can contact the service after consent is revoked.

Full database restores and calendar-settings table imports invalidate external
consent and selections. They retain receipt details for inspection, require fresh
acceptance and prevent a restored withdrawal from silently becoming permission.
An installation binding also prevents a copied database from authorizing another
installation. The existing installation identity/credential store is independent
of this consent migration.

## Version-1 publication contract

The endpoint remains `/v1/events` with `schema_version: 1`. Responses contain the
exact requested exclusive-end range, events, `refresh_after_seconds` and metadata
for all three feeds. Events have a `feed_id`, stable source ID, revision, timing
precision, optional source update/expiry timestamps and publication method.
Announcements use the established reviewed radio activity types; weather uses
`space_weather` and launches use `launch`. Launches need a known calendar day;
month/year/TBD estimates are omitted, including estimates in older local caches.
A known day without a clock time and real overnight launch windows remain valid.

Each feed declares `complete`, `stale`, `error`, last source synchronization and
coverage. A complete snapshot replaces only its corresponding cache, including
removing absent event IDs. An incomplete feed preserves its previous cache while
healthy feeds continue updating. Expiry is enforced on reads even while offline.
The normal station polling interval is ten minutes, honoring longer provider
retry delays and the bounded interval recommended by gscontrol. Manual refresh
joins an ongoing poll and returns the completed calendar, including observations.

The footer shows the station's shared synchronization/error state. Settings also
expose the shared service status. Local observations remain available when the
external source or cache cannot be read.
