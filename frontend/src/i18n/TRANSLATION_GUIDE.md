# Translation Guide

How the locale files are structured, what a change to the source strings means for the
languages that are already shipped, and how to bring a language up to full coverage.

See also [`README.md`](./README.md) for the Greek accent rule.

## 1. Where strings live

There are **two** layers, and a language needs both to be fully translated:

| Layer | Where the key lives | What happens without a translation |
| --- | --- | --- |
| **A. Shared keys** | `locales/en/*.json` (and the other seven languages) | `fallbackLng: 'en'` → English |
| **B. Inline fallback keys** | Nowhere. They exist only as `t('some.key', { defaultValue: 'English' })` in the source | `defaultValue` → English |

Layer A is the normal case. Layer B covers components that were written with an inline
`defaultValue` and no matching key in any locale file. Because the key is absent
everywhere, i18next never consults a locale file and every language sees the English
`defaultValue`.

**Consequence:** adding entries to a locale file for layer-B keys is safe and local — no
change to `en`, no change to any other language.

## 2. Impact of the current change on existing languages

The accompanying change converts hardcoded strings into
`t('key', { defaultValue: '<original English>' })` calls. For every language other than
Simplified Chinese it is **rendering-neutral**:

* None of the added keys existed in `de`, `el`, `es`, `fr`, `it` or `nl` before, so
  resolution falls through to `defaultValue` — the exact string that used to be hardcoded.
* All 2015 `defaultValue` strings in the touched files were verified byte-for-byte against
  the pre-change source (`git show <base>:<file>`), so the English output is unchanged too.

The only observable difference is that these strings have become **translatable**: adding
the corresponding entries to a locale file now takes effect, where previously it was
impossible.

### Namespace note

A few shared modules have no React component of their own and therefore cannot call
`useTranslation()`. Two patterns are used for them, both already present in the codebase:

* the module binds its own translator — `const t = i18n.getFixedT(null, '<namespace>')`
  (`vfo-marker/vfo-config.js`, `target/rotator-utils.js`, `target/tracker-command-state.js`);
* a data module takes `t` as an argument and callers pass theirs
  (`common/tile-layers.jsx`, `waterfall/decoder-parameters.js`).

For the second pattern the key must exist in the namespace of **each caller that renders
it**. Today `tile_layers.*` is only rendered by `common/map-settings.jsx` (namespace
`common`), and `decoder_parameters.*` is consumed by callers in `waterfall`, `common` and
`filebrowser` — those three call sites use
`useTranslation(['<own>', 'waterfall'])` so a single set of entries in
`locales/<lang>/waterfall.json` serves all of them. When adding new consumers, keep this
in mind or configure `fallbackNS`.

## 3. Current coverage

`en` is the reference: **2670** shared keys, plus **1679** inline fallback keys that exist
only in the source — **4349** strings in total.

| Language | Shared keys covered | Shared missing | Inline covered | Inline missing | **Total to add** |
| --- | --- | --- | --- | --- | --- |
| de | 2257 / 2670 | 413 | 230 / 1679 | 1449 | **1862** |
| el | 2257 / 2670 | 413 | 230 / 1679 | 1449 | **1862** |
| es | 2257 / 2670 | 413 | 230 / 1679 | 1449 | **1862** |
| fr | 2257 / 2670 | 413 | 230 / 1679 | 1449 | **1862** |
| it | 1565 / 2670 | 1105 | 0 / 1679 | 1679 | **2784** |
| nl | 2257 / 2670 | 413 | 230 / 1679 | 1449 | **1862** |
| **zh** | **2670 / 2670** | **0** | **1679 / 1679** | **0** | **0** |

Missing entries are not an error: i18next falls back to English, so a partially translated
language degrades gracefully. It only means those particular strings stay English.

## 4. Bringing a language to full coverage

### 4.1 Shared keys (layer A)

For each namespace, list the keys present in `en` but absent in the target language:

```bash
cd frontend/src/i18n/locales
for ns in *.json; do
  comm -23 <(jq -r 'paths(scalars) | join(".")' en/$ns  | sort) \
           <(jq -r 'paths(scalars) | join(".")' de/$ns 2>/dev/null | sort)
done
```

Then add the translated values to the target language file. Rules that apply to every
language:

* **Never rename a key** — the key is the contract with the source.
* **Preserve every `{{placeholder}}`** exactly; only its position may move.
* Plural keys (`_one` / `_other`) must both be present. Chinese and Japanese resolve
  `_other` for every count; Slavic languages use `_few` / `_many` as well.
* Keep product names, acronyms and units untranslated (`SDR`, `TLE`, `NORAD`, `AOS`,
  `VFO`, `dB`, `MHz`, …).

### 4.2 Inline fallback keys (layer B)

These keys are not in `en`, so a key-by-key diff cannot find them. Scan the source for
`defaultValue` and compare against the target locale:

```bash
cd frontend
# every key used with an inline defaultValue
grep -rhoE "t\(\s*'[A-Za-z0-9_.]+'\s*,\s*\{\s*defaultValue" src \
  | grep -oE "'[A-Za-z0-9_.]+'" | tr -d "'" | sort -u > /tmp/inline-keys.txt
wc -l /tmp/inline-keys.txt

# which of them the target language already has (any namespace)
jq -r 'paths(scalars) | join(".")' src/i18n/locales/de/*.json | sort -u > /tmp/de-keys.txt
comm -23 /tmp/inline-keys.txt /tmp/de-keys.txt
```

Add the missing ones to the namespace of the component that uses them (that is the
namespace passed to `useTranslation()` in the file where the key appears — **not**
necessarily the file's directory).

> A small number of `defaultValue` keys are intentionally not translatable: unit labels
> and interpolation fragments such as `km/s`, `+120 MHz`, `physical)`. Leave those in
> English.

### 4.3 Verifying

```bash
cd frontend
npm run build          # keys are imported at build time — a malformed JSON fails here
npm test               # unit tests render components with the real locale files

# spot-check resolution under the real i18next, including plural and interpolation
node -e "
const i18next=require('i18next');
i18next.init({lng:'de',fallbackLng:'en',resources:require('./src/i18n/config.js')});
"
```

A practical acceptance criterion: for every key you added, `t(key, { defaultValue: 'X' })`
must return the translated value rather than `X`, and no rendered string may contain a raw
`{{...}}` or a bare key name.

## 5. Adding a brand-new language

1. Copy `locales/en/` to `locales/<code>/` and translate the values (keep the keys).
2. Register it in `src/i18n/config.js` (import the 12 namespaces into `resources`).
3. Add the entry to `languageOptions` in
   `src/components/settings/preferences-form.jsx`.
4. The `language` preference is an unconstrained string in
   `backend/crud/preferences.py`, so no backend change is required.
5. Layer-B keys are optional per language: leaving them out keeps the English
   `defaultValue`, which is the current behaviour for all seven non-Chinese locales.
