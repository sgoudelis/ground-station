# i18n Notes

This project uses `react-i18next` with namespace JSON files under `frontend/src/i18n/locales/<lang>/`.

`en` is the reference locale: every translatable string has an entry in `locales/en/`, and the
other seven languages translate that file set. See
[`TRANSLATION_GUIDE.md`](./TRANSLATION_GUIDE.md) for the workflow, and
`npm run i18n` for the current per-language gap.

`coverage-baseline.json` records how much is still untranslated per language. `npm test`
(`src/i18n/__tests__/coverage.test.js`) fails if a language gets worse, so translating is always
safe and regressing coverage is not. Run `npm run i18n:baseline` after a translation pass.

## Translation Rule (Greek)

Two accent rules exist in Greek, and both are about the letters you store - not about how the UI
renders them:

- A word written **entirely in capitals** carries no accent marks at all: `ΑΠΟΘΗΚΕΥΣΗ`, `ΕΝΤΑΞΕΙ`,
  `ΡΥΘΜΙΣΕΙΣ`.
- A **mixed-case word keeps every accent it has, including one on its capital initial**: `Κλίμακα`,
  `Όλα`, `Ώρα`, `Άγνωστο`, `Ρυθμίσεις`, `Διακοπή`, `Σελήνη`. Writing `Κλιμακα`, `Ωρα`, `Αγνωστο` or
  `Ρυθμισεις` is a misspelling, not a style choice.
- `Ϊ`/`Ϋ` are dialytika without a tonos, so they survive into all caps: `ΰπνος` -> `ΫΠΝΟΣ`.

`text-transform: uppercase` is a rendering artefact. Never remove a tonos from a stored string just
because a button paints it in caps - the same string shows up in tooltips, notifications and
sentences, where the accent has to be there. Equally, never *strip* the accent from a capital initial
to satisfy a checker: an earlier revision of `scripts/i18n.mjs` and `scripts/repairgreek.py` did that
and left most of the `el` locale without a tonos on capital-initial words.

Because browser uppercasing keeps the tonos on capitals (`Ά`) instead of producing valid all-caps
Greek, Greek deliberately opts out of uppercase transforms: `src/i18n/config.js` mirrors the active
language onto `<html lang>` and `src/theme.js` neutralises `text-transform` while `lang="el"`. Labels
therefore render in the mixed case they were authored in. `src/i18n/__tests__/document-lang.test.js`
guards the language mirror.

Chrome that must stay in capitals (MUI tab bars and buttons) cannot use CSS at all, so it builds the
string in JS: `src/utils/greekcaps.js` exports `greekCaps()` (upper-case + drop every tonos, keeping
the dialytika of `ΰ`/`ΐ`) and `capsLabel(label, i18n)`, which applies it only when the language is
Greek (`tabCapsLabel` is the same function, named for tabs). Pass the instance from
`useTranslation()` - `greekcaps.js` deliberately does not import `src/i18n/config.js`, because pulling
the app singleton into a component graph breaks tests that mock `react-i18next` (the singleton calls
`i18next.use(initReactI18next)` on the mocked module), and an unknown instance leaves the label alone.
`AntTab` in `src/components/common/common.jsx` runs every tab label through it, as do the card/dialog
tabs that use a raw `<Tab>`. Button chrome goes through `<CapsButton>`
(`src/components/common/capsbutton.jsx`) for the same reason: MUI uppercases buttons in CSS, Greek has
that transform disabled, and a plain `<Button>` would paint the stored case, so `ΑΚΥΡΩΣΗ` would sit
next to `Απενεργοποίηση`. MUI v7 offers no theme-level hook for this
(`components.MuiButton.slots.root`, `defaultProps.component` and theme `slots` are all ignored for
`Button`), so the transform belongs at the React boundary. Roughly 400 label buttons now use it; a
plain `<Button>` is kept for buttons whose child is data (a satellite name, a frequency) and for
link-shaped `component=` buttons. `i18n check` warns `caps-chrome:` for a plain `<Button>` carrying a
translated label and `npm test` requires that list to be empty; `python3 scripts/capscodemod.py`
migrates new pages (idempotent). The scanner cannot see labels that arrive through a variable
(`{option.label}`, `{children}`), so mapped button arrays and local button wrappers need a human.
`<ToggleButton>`, `<StepLabel>`, `<AccordionSummary>` and hand-written `textTransform: 'uppercase'`
`sx` blocks are still mixed case in Greek. Store mixed-case accented Greek in the locale files; never
pre-capitalise a value to work around the transform
(`src/utils/greekcaps.test.js`, `src/components/common/__tests__/capsbutton.test.jsx` cover the rule).

Examples:

- `ΑΠΟΘΗΚΕΥΣΗ` (correct - all caps, no accents)
- `Κλίμακα`, `Όλα τα αρχεία`, `Άγνωστο σφάλμα` (correct - the capital initial keeps its tonos)
- `Κλιμακα`, `Ωρα`, `Αγνωστο` (wrong - accents deleted from capitals)
- `ΡΥΘΜΙΣΕΊΣ` / `ΆΘΗΝΑ` (not allowed - accented letters inside an all-caps word)
- `Ρυθμίσεις` (correct), `Ρυθμισεις` (wrong)

Notes:

- `node scripts/i18n.mjs reuse --write` normalises Greek through `greekCaps()`, which implements
  exactly the rules above and leaves lowercase letters alone.
- `python3 scripts/repairgreek.py --all [--write]` repairs values that were written under the wrong
  rule. It only restores a tonos whose pattern is attested for that word - either elsewhere in the
  locale corpus (HEAD wording counts, and weighs more) or in `scripts/greekwords.json`, a curated
  word list - and it refuses to touch a word whose accent pattern is ambiguous. Run it with
  `--dump-unresolved <file>` to see which words still need a human decision.
- `npm run i18n:check` (and the Vitest coverage test) fails on any `el` value that breaks them.
- Until this was corrected, the repo read the rule as "any word that starts with a capital loses its
  accents", which stripped legitimate tonos. Every Greek value shipped by the repo - old and new -
  has now been repaired, so a plain `Σφαλμα` or `Ρυθμισεις` should no longer appear anywhere in
  `el/`. Six words were left alone because the accent decides their meaning and only a native
  reading of the surrounding sentence can pick: `Ποτε` (Πότε / ποτέ), `Αλλα` (Άλλα / Αλλά),
  `Επιλεγει`, `Επιγειου`, `Αζιμουθιου`, `Διαγραφει`.

## Filler scripts must not touch Greek orthography

Any script that writes `el` values must store the tonos exactly as written. A helper that
"de-accents capitalised words" (the old, wrong reading of the capitalisation rule) silently
destroys correct spellings such as `Κανόνες`, `Ηνωμένο Βασίλειο` and `Γενική`, and
`scripts/repairgreek.py` then spends a whole pass undoing that self-inflicted damage. Only
`greekCaps()` in `scripts/i18n.mjs` may alter accents, and only for entirely-uppercase words and
accents on capital letters. If a value looks wrong after filling, run
`python3 scripts/repairgreek.py --all --write` and inspect what it changes.
