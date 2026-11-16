# Translation Guide

How the locale files are structured, what a change to the source strings means for the
languages that are already shipped, and how to bring a language up to full coverage.

See also [`README.md`](./README.md) for the Greek accent rule.

## 1. Where strings live

Every translatable string has exactly one authoritative entry: `locales/en/<namespace>.json`.

```jsx
const { t } = useTranslation('waterfall');
t('vfo.decoder_options', { defaultValue: 'Decoder options' });
```

- `defaultValue` stays in the component as a **safety net** for keys that were never added to
  `en/`. It is not a second source of truth and it must never disagree with the `en/` entry.
- Without a locale entry *and* without a fallback, i18next paints the raw key on screen
  (`notifications.recording.started` instead of a sentence). `npm test` fails on that today.
- Keys are addressed as `<namespace>:<dotted.key>`; inside a component the namespace comes from
  `useTranslation()`, so `t('vfo.decoder_options')` in a `waterfall` component resolves
  `locales/en/waterfall.json`.

Historically a third of the UI existed **only** as inline `defaultValue` strings, invisible to
every diff and to every translator. `node scripts/i18n.mjs enrich --write` folds those into `en/`
(§2): it copies the exact English literal from the source and refuses to guess whenever two call
sites disagree.

### Namespace note

A few shared modules have no React component of their own and therefore cannot call
`useTranslation()`. Two patterns are used for them, both already present in the codebase:

* the module binds its own translator — `const t = i18n.getFixedT(null, '<namespace>')`
  (`vfo-marker/vfo-config.js`, `target/rotator-utils.js`, `target/tracker-command-state.js`);
* a data module takes `t` as an argument and callers pass theirs
  (`common/tile-layers.jsx`, `waterfall/decoder-parameters.js`).

For the second pattern the key must exist in the namespace of **each caller that renders it**.
Today `tile_layers.*` is only rendered by `common/map-settings.jsx` (namespace `common`), and
`decoder_parameters.*` is consumed by callers in `waterfall`, `common` and `filebrowser` — those
call sites use `useTranslation(['<own>', 'waterfall'])` so a single set of entries in
`locales/<lang>/waterfall.json` serves all of them. When adding new consumers, keep this in mind
or configure `fallbackNS`.

## 2. Tooling

Everything below is `frontend/scripts/i18n.mjs`, exposed as npm scripts:

| Command | What it does |
| --- | --- |
| `npm run i18n` | coverage table per language and namespace, biggest gap groups |
| `npm run i18n:check` | machine-readable violations; same rules the unit test enforces |
| `npm run i18n:pending de` | every untranslated key for one language, with its English text |
| `npm run i18n:pending de -- --group navigation.` | filtered to one key prefix |
| `node scripts/i18n.mjs reuse --write` | fill gaps from that language's own translations of the same text |
| `npm run i18n:worklist de ./out` | nested JSON skeletons ready for a translator or MT run |
| `npm run i18n:baseline` | rewrite `coverage-baseline.json` after translating |
| `node scripts/i18n.mjs enrich --write` | copy inline `defaultValue` strings into `locales/en/` |

`npm test` runs `src/i18n/__tests__/coverage.test.js`, so both GitHub Actions and Drone already
gate translations through the existing frontend unit-test job — no workflow changes needed.

## 3. Current coverage

`en` is the reference: **6111** shared keys across 12 namespaces. `en` itself is complete by
definition; nothing renders a key name (`rawKeyFallbacks: 0`).

| Language | Untranslated | Coverage | Dead locale entries |
| --- | --- | --- | --- |
| de | 0 | 100% | 15 |
| el | 0 | 100% | 11 |
| es | 0 | 100% | 15 |
| fr | 0 | 100% | 15 |
| it | 0 | 100% | 7 |
| nl | 0 | 100% | 15 |
| **zh** | **0** | **100%** | 226 |

Two moves got the numbers from 44% to here without inventing a single translation:
`enrich` put the inline `defaultValue` strings into `en` (so the real surface became visible),
and `reuse` filled 3772 gaps with each language's own approved wording for the identical English
text (`map_settings.apply` translated in `common`, then missing in `earthview`). The rest of the
progress is hand translation, namespace by namespace.

Fully translated in `de`, `el`, `es`, `fr` and `nl`: `dashboard`, `earthview`, `hardware`,
`navigation`, `satellites`, `target`, `tracking` and `waterfall`.

**All seven non-English languages are now at 100% of counted coverage.** Two consequences worth
knowing: the squawk-code prose (15 keys) is excluded from the counted surface, so "complete" does
not mean every string in those files is in the target language; and because every ratchet now sits
at zero, any new English key added to `en` will fail the Vitest gate in all seven languages until
someone translates them. That is intentional - it is what a ratchet that reached the bottom does - but
it is a real promise to contributors.

Dead locale entries are deliberately **not** auto-pruned. `i18n check` reports them as warnings, and
some of them are false positives: `it/settings.json` `preferences.theme_ocean-blue` is reached through
a template literal (`t(\`preferences.theme_${name}\`)`), which the static reference scan cannot see.
Deleting the reported keys in bulk would break live strings; review them family by family instead.

Historical notes on how the groups were filled, kept for context. Partly translated in those five at
the time - done groups first:

* `filebrowser`: everything except a tail of one- to three-key strays; the file/list/table chrome,
  search, view modes, delete/download/purge dialogs, the observation-folder, recording, processing,
  audio and transcription dialogs, all nine `telemetry_*_tab` viewers, `adsb`, `flight_paths`,
  `meshtastic_folder`, `aprs_folder` and both METEOR folder dialogs are complete.
* `common`: everything except `adsb` capture options and a tail of short labels; the
  `observation_data_dialog` (execution timeline, data files, error summary) and
  `regeneration_preview_dialog` (conflict resolution, pass scheduling) are complete.
* `settings`: only 1-4 strays remain in `es`/`fr`/`nl`; every card is complete, including the six
  debug/inspector cards (`redux_persistent_settings_card`, `canvas_debug_card`,
  `redux_state_inspector_card`, `system_logs_card`, `socket_info_card`,
  `event_log_console_card`).
* `celestial`: complete except a handful of strays - the whole `celestial.admin.*` console, the
  Horizons availability banner and its per-reason labels, and the projection-window editor are done.
* `navigation`: the squawk-code reference dialog is translated (labels, `Code listing`, the
  per-code titles and scopes such as `General emergency` / `United States`), but each code's
  multi-sentence `description` prose stays English on purpose - see `ENGLISH_ONLY` below.
* `waterfall`: complete. The background-observation / SDR-takeover flow, the `sdr.*` receiver
  controls (gain, attenuation, LNA, IF filter, antenna port, clock and time source, Bias-T
  warning), the `vfo_config` device sources, the modulation/decoder menu descriptions, the
  `vfo_sliders` squelch group, the VFO/recording toolbar, `adsb` stat chips and the transcription
  sub-titles are all done.

`it` still lags everywhere (`it/common.json` alone holds 776 untranslated strings).
`de`, `es`, `fr` and `nl` remain in lockstep: they miss the same keys. "Dead locale entries" are
keys a locale carries that nothing references any more — harmless, but they shrink the reported
gap when deleted.

Missing entries are not an error: i18next falls back to English, so a partially translated
language degrades gracefully. It only means those particular strings stay English.

## 4. Rules the automated gate enforces

Hard failures (rendered output is wrong for a user):

* **raw-key** — a `t('key')` with no `en/` entry and no `defaultValue`.
* **dynamic-label-missing** — a `{ labelKey: 'tabs.users', defaultLabel: 'Users' }` config entry whose
  key has no `en/` entry. Tab strips built from such arrays call `t(tab.labelKey, ...)`, which literal
  `t()` scanning cannot see, so the key silently paints its English default in *every* language (this
  is how the USERS and SOURCES tabs stayed English in Greek).
* **placeholder-drift** — a translation that drops, renames or invents a `{{variable}}`.
* **empty-value** — an entry whose text is blank (i18next renders nothing, it does not fall back).
* **partial-plurals** — `_one` without `_other` or vice versa.
* **coverage-regression** — a language whose untranslated count exceeds
  `coverage-baseline.json`.

Warnings (reported, never red):

* **unknown-keys** — locale entries no component references (dynamic keys land here too).
* **lang-mismatch** — an Italian value written in Dutch, or the reverse. Both cells look translated,
  so only this rule catches a language column that was swapped in a batch payload (warning today,
  and `coverage.test.js` fails the build on it).

Deliberately English-only, encoded in `ENGLISH_ONLY` inside the script:

* `navigation.packet_map.squawk.codes.*` — squawk-code meanings are regulator-published English
  reference prose; translating them would invent aviation-safety wording.
* bare units and short all-caps acronyms (`SDR`, `TLE`, `NORAD`, `AOS`, `VFO`, `dB`, `MHz`).

When you add a `{{count}}` string, remember i18next looks up `key_one`/`key_other` first and only
then falls back to the plain key, which it does use — so a single plain entry with `{{count}}`
interpolation is correct as long as the value is plural-neutral.

## 5. Bringing a language to full coverage

1. `npm run i18n:pending <lang> > pending.txt` for the flat list, or
   `npm run i18n:worklist <lang> ./worklist` for per-namespace JSON skeletons that already
   contain the English text.
2. Translate the values, keeping every key, every `{{placeholder}}` (only its position may move)
   and both sides of every plural pair.
3. Drop the results into `locales/<lang>/<namespace>.json` — nested, 2-space indent, one trailing
   newline; `npm run build` fails on malformed JSON.
4. `npm test` — the coverage test tells you which of the hard rules you broke.
5. `npm run i18n:baseline` to bank the improvement, so the next contributor cannot walk it back.

Rules that apply to every language:

* **Never rename a key** — the key is the contract with the source.
* **Batch payloads are index-aligned** — `scripts/fillbytext.py` expects
  `[en, de, el, es, fr, nl, it, zh]`. `nl` sits *before* `it`; alphabetising the columns swaps
  Italian and Dutch and every coverage number still says "done".
* Keep product names, acronyms and units untranslated.
* Greek: an accent on a capital letter is dropped and an all-caps word carries no accents, but a
  tonos on a lowercase letter stays even in a capitalised word (`Ρυθμίσεις`, not `Ρυθμισεις`).
  See `README.md` for the full rule and why CSS `uppercase` must not influence a stored string.

## 6. Adding a brand-new language

1. Copy `locales/en/` to `locales/<code>/` and translate the values (keep the keys).
2. Nothing else in `src/i18n/config.js` is needed: namespaces are discovered from
   `locales/*/*.json` and loaded lazily, so a new directory is picked up automatically.
3. Add the entry to `languageOptions` in `src/i18n/languages.js` (shared by setup and preferences).
   The value must be `<code>_<REGION>` — `App.jsx` and the preferences form reduce it to the
   bare `<code>` before calling `changeLanguage()`, and that bare code is the directory name.
4. The `language` preference is an unconstrained string in `backend/crud/preferences.py`, so no
   backend change is required.
5. Run `npm run i18n:baseline` once to record the new language, then ratchet it down.

## Decisions (maintainer rulings)

Recorded so the next session does not re-litigate them.

**Squawk-code prose stays English everywhere.** `navigation.packet_map.squawk.codes.*.description`
and `packet_map.squawk.regional_note` are not translated into any locale - regulator wording is not
something we paraphrase. The dialog's own chrome (group titles, scopes, `Code listing`, `Squawk`)
*is* translated, which is the intended split. Those keys therefore count as permanent, accepted gaps
in the coverage table; the ratchet tolerates them, it just refuses to grow.

**Italian wording is decided by the translator, not by a reviewer.** No contributor here reviews
Italian, so the glossary below is authoritative - reuse it verbatim in later batches so the
language stays internally consistent, and change a term everywhere or nowhere:

| EN | IT | EN | IT |
| --- | --- | --- | --- |
| target | bersaglio | rig | rig |
| transmitter | trasmettitore | receiver | ricevitore |
| observation | osservazione | pass (orbit) | passaggio |
| peak elevation | elevazione massima | horizon | orizzonte |
| azimuth / elevation | azimut / elevazione | heading | prua |
| ground speed | velocità rispetto al suolo | track | rotta |
| altitude | quota (`quota barometrica`, `quota geometrica`) |
| vertical speed | velocità verticale | callsign | nominativo |
| packet | pacchetto | capture | cattura |
| telemetry | telemetria | signal | segnale |
| rotator | rotore | repeater | ripetitore |
| ephemeris | effemeridi | scheduler | pianificatore |
| sources | sorgenti | clipboard | appunti |
| unpark | rimuovi dal park | parked | in park |

Kept in English on purpose: `VFO`, `rig`, `park`, `squawk`, `digipeater`, `gateway`, `squelch`,
`token`, `IQ`, `SDR`, `AX.25`, `ICAO`, `TTL`, `JSON`, units (`dB`, `km/h`, `MHz`), and proper nouns
(`Project X`, author names, `https://`).

**Review model is user feedback, not pre-merge approval.** The hand-written values in
`de/el/es/fr/nl/it` ship unreviewed. When users report a wrong or awkward string, fix the value in
that locale (never the key), run `npm run i18n:baseline` if the fix changes coverage, and let the
ratchet keep it from regressing. Report quality is monitored through GitHub issues; the tooling only
guarantees structure (keys, placeholders, plurals, Greek orthography), not idiom.

## Italian pass (in progress)

`it` sits at 92.4% (466 referenced keys missing). Only three namespaces still have work -
`settings` (~190: remaining admin/maintenance and preferences help text), `waterfall` (~189) and
`target` (~74) - plus a dozen strays elsewhere and the permanent-English squawk prose.
`satellites`, `celestial`, `hardware`, `earthview`, `navigation` chrome and the whole file browser are
complete.
`hardware`, `celestial`, `earthview`, `navigation` chrome and the whole file browser are complete. `hardware` is complete (including the two values
that were untranslated English sentences, now fixed), and the `navigation` shell is done: menu
groups, transmitter/APRS/Meshtastic labels, column headers, APRS symbol names, aviation status
phrases (`Climbing` → `In salita`, `Level flight` → `Volo livellato`) and the admin nav entries.
The `dashboard` shell is done too - VFO/audio cards, background-observation chips, rotator and rig
controls with every connect/park/pause status and guard message, API-token and sign-in screens.
What remains is mostly longer sentences and the data browsers (`common`, `filebrowser`, `settings`,
`satellites`, `waterfall`, `target`, `earthview`), plus the 43 squawk-code prose keys, which stay
English by ruling (see Decisions above).

Nothing excludes `it` from the tooling: `pending it`, `worklist it`, `reuse it` all work and the
coverage ratchet includes it, so regressions in Italian fail `i18n check` and the Vitest gate like
any other language. Two pre-existing values in `it/hardware.json` (`sdr.probing_rtl`,
`sdr.no_rtl_devices`) were untranslated English sentences and have been translated.
