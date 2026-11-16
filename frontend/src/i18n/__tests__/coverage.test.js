/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

/**
 * Locale integrity gate. It runs in `npm test`, so every CI path that already executes unit
 * tests also guards translations; nothing new has to be wired into the workflows.
 *
 * The rules are deliberately asymmetric: hard failures are only things that render wrong for a
 * user, while the sheer volume of untranslated strings is ratcheted against
 * `coverage-baseline.json` so an existing gap can never silently grow.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { analyze, check, collectDynamicLabels, greekCaps, greekOrthographyIssues } from '../../../scripts/i18n.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.resolve(HERE, '..', 'coverage-baseline.json');

const baseline = JSON.parse(readFileSync(BASELINE, 'utf8'));
const report = analyze();
const { violations, warnings } = check();

describe('i18n locale integrity', () => {
    it('resolves every translated string used by the source', () => {
        // A key with neither a locale entry nor an inline fallback paints its own key name on screen.
        expect(violations.filter((line) => line.startsWith('raw-key:'))).toEqual([]);
    });

    it('keeps every interpolation variable in every translation', () => {
        expect(violations.filter((line) => line.startsWith('placeholder-drift:'))).toEqual([]);
    });

    it('gives every indirect tab label an en entry to translate', () => {
        // { labelKey, defaultLabel } config arrays are invisible to literal t() scanning; without an
        // en/ entry they paint their English default in every language (the USERS/SOURCES tabs).
        const dynamic = violations.filter((line) => line.startsWith('dynamic-label-missing:'));
        expect(dynamic, dynamic.join('\n')).toEqual([]);
        // Guard that the sweep actually finds the pairs, so the rule above cannot pass vacuously.
        expect(collectDynamicLabels().length).toBeGreaterThan(0);
    });

    it('ships every plural pair whole and with non-empty values', () => {
        expect(violations.filter((line) => line.startsWith('partial-plurals:'))).toEqual([]);
        expect(violations.filter((line) => line.startsWith('empty-value:'))).toEqual([]);
    });

    it('does not let untranslated coverage slip backwards', () => {
        const regressions = violations.filter((line) => line.startsWith('coverage-regression:'));
        expect(regressions, regressions.join('\n')).toEqual([]);
    });

    it('reports the current per-language gap without exceeding the recorded baseline', () => {
        const summary = Object.entries(report.missing).map(([lang, perNamespace]) => {
            const missing = Object.values(perNamespace).reduce((sum, list) => sum + list.length, 0);
            const recorded = baseline.languages[lang];
            expect(missing, `${lang}: ${missing} untranslated > baseline ${recorded?.missing}`)
                .toBeLessThanOrEqual(recorded.missing);
            return `${lang}=${missing}`;
        });
        // Smoke check that the audit really looked at every locale.
        expect(summary.length).toBe(Object.keys(baseline.languages).length);
    });

    it('is known about its dead locale entries instead of growing them', () => {
        const growth = warnings.filter((line) => line.startsWith('unknown-key-growth:'));
        expect(growth, growth.join('\n')).toEqual([]);
    });

    it('keeps English as the reference namespace set for every locale', () => {
        for (const lang of report.languages) {
            for (const ns of report.namespaces) {
                expect(report.table[lang][ns], `${lang}/${ns} must be readable`).toBeTypeOf('object');
            }
        }
    });
});

describe('Greek orthography', () => {
    it('drops the accent that sits on a capital letter', () => {
        expect(greekCaps('Άγνωστο σφάλμα')).toBe('Αγνωστο σφάλμα');
        expect(greekCaps('Ώρα εκτόξευσης')).toBe('Ωρα εκτόξευσης');
    });

    it('strips every accent inside a word written entirely in capitals', () => {
        expect(greekCaps('ΠΡΟΣΟΧΉ')).toBe('ΠΡΟΣΟΧΗ');
    });

    it('keeps the tonos on a lowercase letter even inside a capitalized word', () => {
        // The rule this replaced dropped these too, producing accent-free misspellings.
        for (const word of ['Ρυθμίσεις', 'Διακοπή', 'Αυτόματη', 'Υποστήριξη', 'Λεπτομέρειες', 'Σελήνη']) {
            expect(greekCaps(word)).toBe(word);
            expect(greekOrthographyIssues(word)).toEqual([]);
        }
    });

    it('reports an accent on a capital letter as a violation', () => {
        expect(greekOrthographyIssues('Όλα τα αρχεία').length).toBeGreaterThan(0);
    });

    it('ships no Greek value that breaks either rule', () => {
        const issues = violations.filter((line) => line.startsWith('greek-orthography:'));
        expect(issues, issues.join('\n')).toEqual([]);
    });
});
