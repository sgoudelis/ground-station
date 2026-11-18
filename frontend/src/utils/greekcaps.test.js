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
 * All-caps Greek label helper. Fixtures are the real Greek tab labels from
 * `locales/el/settings.json` so a regression here shows up as a broken tab bar.
 */

import { afterEach, describe, expect, it } from 'vitest';

import i18n from '../i18n/config.js';
import { capsLabel, greekCaps, isGreekLocale, tabCapsLabel } from './greekcaps.js';

describe('greekCaps', () => {
    it('upper-cases Greek and drops the tonos', () => {
        expect(greekCaps('Συγχρονισμός εφημεριδίων')).toBe('ΣΥΓΧΡΟΝΙΣΜΟΣ ΕΦΗΜΕΡΙΔΙΩΝ');
        expect(greekCaps('Συγχρονισμός τροχιών')).toBe('ΣΥΓΧΡΟΝΙΣΜΟΣ ΤΡΟΧΙΩΝ');
        expect(greekCaps('Διακριτικά API')).toBe('ΔΙΑΚΡΙΤΙΚΑ API');
    });

    it('maps a final sigma to Σ', () => {
        expect(greekCaps('Κατάλογος')).toBe('ΚΑΤΑΛΟΓΟΣ');
        expect(greekCaps('Γενικά')).toBe('ΓΕΝΙΚΑ');
    });

    it('is idempotent for labels already stored in capitals', () => {
        for (const label of ['ΡΥΘΜΙΣΕΙΣ', 'ΣΥΝΤΗΡΗΣΗ', 'ΠΗΓΕΣ ΤΡΟΧΙΑΚΩΝ ΔΕΔΟΜΕΝΩΝ', 'SDRS']) {
            expect(greekCaps(label)).toBe(label);
        }
    });

    it('keeps the dialytika that belongs to an all-caps word', () => {
        // ΰ is upsilon + tonos + dialytika: only the tonos may disappear.
        expect(greekCaps('ΰπνος')).toBe('ΫΠΝΟΣ');
        expect(greekCaps('άσπροΰ')).toBe('ΑΣΠΡΟΫ');
    });

    it('passes non-strings through untouched', () => {
        expect(greekCaps(undefined)).toBeUndefined();
        expect(greekCaps('')).toBe('');
        expect(greekCaps('VFO 1')).toBe('VFO 1');
    });
});

describe('isGreekLocale', () => {
    it('matches Greek with or without a region subtag', () => {
        expect(isGreekLocale({ language: 'el' })).toBe(true);
        expect(isGreekLocale({ resolvedLanguage: 'el-GR' })).toBe(true);
    });

    it('rejects everything else', () => {
        expect(isGreekLocale({ language: 'it' })).toBe(false);
        expect(isGreekLocale({})).toBe(false);
        expect(isGreekLocale(undefined)).toBe(false);
    });
});

describe('capsLabel', () => {
    afterEach(async () => {
        await i18n.changeLanguage('en');
    });

    it('capitalises Greek labels without accents', async () => {
        await i18n.changeLanguage('el');
        expect(capsLabel('Ρυθμίσεις', i18n)).toBe('ΡΥΘΜΙΣΕΙΣ');
        // tabCapsLabel is the same function under the name tab strips use.
        expect(tabCapsLabel('Ρυθμίσεις', i18n)).toBe('ΡΥΘΜΙΣΕΙΣ');
    });

    it('leaves other languages to the CSS transform', async () => {
        await i18n.changeLanguage('de');
        expect(capsLabel('Rückgabe an Park', i18n)).toBe('Rückgabe an Park');
    });

    it('leaves the label alone when the caller has no i18n instance', () => {
        // Components read the instance from useTranslation(); a mocked hook without one must not
        // guess a language (that is what keeps the wrapper inert in tests that stub react-i18next).
        expect(capsLabel('Ρυθμίσεις', undefined)).toBe('Ρυθμίσεις');
        expect(capsLabel('Ρυθμίσεις')).toBe('Ρυθμίσεις');
    });
});
