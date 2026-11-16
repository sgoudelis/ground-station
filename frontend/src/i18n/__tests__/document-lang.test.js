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
 * Guards the `<html lang>` mirror used by theme.js to disable uppercase text transforms
 * for Greek, where browser uppercasing would keep the tonos on capitals (Ά).
 */

import { afterEach, describe, expect, it } from 'vitest';

import i18n from '../config.js';

describe('document language mirror', () => {
    afterEach(async () => {
        await i18n.changeLanguage('en');
    });

    it('reflects the active language on <html lang>', async () => {
        await i18n.changeLanguage('el');
        expect(document.documentElement.lang).toBe('el');

        await i18n.changeLanguage('de');
        expect(document.documentElement.lang).toBe('de');
    });
});
