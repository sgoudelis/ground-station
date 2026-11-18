# AGENTS.md

## Project Truths
- This is a public open-source project on GitHub: `https://github.com/sgoudelis/ground-station` (default branch `main`, license GPL-3.0).
- GitHub issues and pull requests should be handled with `gh`, and commands should target `sgoudelis/ground-station` explicitly (example: `gh issue list --repo sgoudelis/ground-station`).
- Stack split is backend Python/FastAPI + Socket.IO and frontend React/Vite.
- Backend package metadata is in `backend/pyproject.toml`; frontend scripts are in `frontend/package.json`.
- Backend runtime requirement in `backend/pyproject.toml` is Python `>=3.12,<3.13`.
- Backend Python tooling (pytest/python/alembic/etc.) is available in `backend/venv/bin`.
- Frontend uses Node tooling (Vite/Vitest/Playwright) with scripts like `dev`, `build`, `test`, `test:e2e`.
- Default backend app config is host `0.0.0.0`, port `5000`, DB `data/db/gs.db`.
- CI exists in both GitHub Actions (`.github/workflows/tests.yml`, release workflow) and Drone (`.drone.yml`).

## Test Commands
- Backend unit tests:
  - `cd backend && ./venv/bin/pytest -m unit`
- Frontend unit tests:
  - `cd frontend && npm test`
- Frontend E2E tests:
  - `cd frontend && npm run test:e2e`

## Notes
- Python dev/test tools for backend are in `backend/venv/bin` (for example `./venv/bin/pytest`, `./venv/bin/python`, `./venv/bin/alembic` from inside `backend/`).
- For pytest runs, set `ALEMBIC_CONTEXT=1` to avoid app CLI argument parsing conflicts (example: `cd backend && ALEMBIC_CONTEXT=1 ./venv/bin/pytest -q`).
- Frontend E2E tests require the app/backend to be running and reachable by Playwright test config.
- Never run the frontend npm dev server (`npm run dev`, `npm run dev:*`, `vite`) unless the user has *C L E A R L Y   S T A T E D* to do so in the current turn.
- Python file naming convention in this repository: use one-word lowercase names only (no underscores, no dashes, no capitals).

## Backend Command Context (Important)
- Run backend checks from `backend/` (or use absolute paths).
- Use backend venv binaries, not global tools:
  - `cd backend && ./venv/bin/pre-commit run ...`
  - `cd backend && ./venv/bin/mypy ...`
  - `cd backend && ./venv/bin/isort ...`
  - `cd backend && ./venv/bin/pytest ...`
- Default backend DB path is relative to backend cwd (`data/db/gs.db` -> `<repo>/backend/data/db/gs.db`).
- If running backend DB checks from repo root, set:
  - `GS_DB=backend/data/db/gs.db`

## GitHub Safety
- Never create a git commit or push changes without the user's explicit permission for that exact action.
- Never post/comment/create/update/delete on GitHub (issues/PRs/comments/labels/assignees/milestones/releases) unless the user explicitly asks for that exact write action in the current turn.
- Default to read-only `gh` usage (list/view/status/check) unless explicit write permission is given in the current turn.
- If there is any ambiguity, stop and ask before running any `gh` command that mutates remote state.

## i18n Decisions
- Frontend translations live in `frontend/src/i18n/locales/<lang>/<ns>.json`; read
  `frontend/src/i18n/TRANSLATION_GUIDE.md` before translating (tooling, rules, glossary).
- Batch translation payloads for `frontend/scripts/fillbytext.py` are index-aligned in the order
  `[en, de, el, es, fr, nl, it, zh]`. `nl` precedes `it`: writing payload columns alphabetically
  swaps Italian and Dutch wholesale, and both cells still count as translated. `i18n check` reports
  this as `lang-mismatch:` and the coverage test fails on it; grep for it before banking a batch.
- Hardcoded English JSX literals, DataGrid `headerName`/`localeText` values and JS template literals
  are invisible to key-based coverage. Route them through `t()` when touched
  (`i18n check` cannot see them at all).
- Squawk-code prose (`navigation.packet_map.squawk.codes.*.description`, `regional_note`) stays
  English in every locale. Do not translate it; dialog chrome may be translated.
- No native reviewer gates Italian (or other locales): values ship unreviewed and get fixed from
  user feedback. Reuse the guide's EN->IT glossary so wording stays internally consistent.
- Coverage is a ratchet: `npm run i18n:baseline` may only go down. Keys are a contract; never rename
  a key just to translate it, and never drop a `{{placeholder}}`.
- Every non-English locale is at 0 counted missing, so the ratchet floor is zero: a new `en` key
  fails `npm test` for all seven languages until each one is translated.
- Tab strips built from `{ labelKey, defaultLabel }` arrays must have their key in `en/<ns>.json`
  (and in every locale); otherwise the English default renders in all languages. `i18n check` fails on
  `dynamic-label-missing`.
- MUI buttons/tabs are `text-transform: uppercase`, but Greek opts out of CSS uppercasing globally
  (`src/theme.js`), so in Greek a plain `<Button>` paints whatever case the locale file stores.
  Label-bearing buttons must use `<CapsButton>` (`frontend/src/components/common/capsbutton.jsx`),
  which caps the label through `capsLabel()` - the same JS mechanism `AntTab` uses. Keep the plain
  MUI `<Button>` for buttons whose child is *data* (satellite names, frequencies, counts) and for
  link-shaped `component=` buttons; those may keep `textTransform: 'none'`. Never store uppercase in a
  locale value to fake it. `capsLabel(label, i18n)` takes the `useTranslation()` instance -
  `greekcaps.js` must not import the i18n singleton (it breaks tests that mock `react-i18next`).
  Guards: `i18n check` warns `caps-chrome:` for a plain `<Button>` with a translated label and
  `npm test` requires that list to be empty; `python3 scripts/capscodemod.py` migrates new pages
  (idempotent). The scanner cannot see labels arriving through a variable (`{option.label}`,
  `{children}`) - review mapped button arrays and local button wrappers by hand.
- MUI has no theme-level hook for this: `components.MuiButton.slots.root`, `defaultProps.component`
  and theme `slots` are all ignored for `Button` in MUI v7, so the transform has to happen at the
  React boundary.
- Never bulk-delete locale keys reported by `i18n check` as `unknown-keys`. The static reference scan
  misses template-literal keys (for example `preferences.theme_${name}`), so some are live.
- Greek must not be uppercased by CSS (browser uppercasing keeps the tonos, `Ά`). `src/i18n/config.js`
  mirrors the language to `<html lang>` and `src/theme.js` disables `text-transform` for `el`.
  Never "fix" Greek accents by editing stored strings to match what an uppercasing button paints.
  Chrome that must be capitalised (MUI tab bars) builds the label in JS via
  `capsLabel()`/`greekCaps()` in `frontend/src/utils/greekcaps.js` (`tabCapsLabel` is an alias); the
  label-bearing button wrapper is `<CapsButton>`. Locale values stay mixed-case and accented.
- Greek title case keeps its tonos: `Κλίμακα`, `Όλα`, `Ώρα` are correct and `Κλιμακα`, `Ωρα`,
  `Αγνωστο` are misspellings. Only words written entirely in capitals lose accents. Never strip the
  accent from a capital initial again - a previous revision of `scripts/i18n.mjs` and
  `scripts/repairgreek.py` did, and most `el` values are still missing that tonos because of it
  (`scripts/repairgreek.py` rule B restores them from the curated word list).

## Code Comments

- Add code comments more proactively when touching logic that is not immediately obvious.
- Prefer more comments over fewer comments when in doubt, especially around control flow, state transitions, and worker/lifecycle behavior.
- Keep comments brief and clear (avoid verbose explanations).
- Focus comments on intent and non-obvious behavior, not line-by-line narration.

## Import Design
- Do not use lazy loading or deferred imports to resolve dependency cycles.
- Resolve cycles through clear dependency direction, extraction of shared code, or package initialization changes instead.

## Linting / Quality Check Timing
- Do **not** run linters/formatters/type-checkers on every small iterative change during feature development.
- Run linting/quality checks once at the end of feature development, or immediately before committing.
- If linting is intentionally skipped during intermediate steps, rely on the automated CI flow to run full checks.
