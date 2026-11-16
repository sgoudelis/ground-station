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
 * The sidebar account popover is Toolpad's `Account` component, and Toolpad ships four of its
 * strings in English (`Sign out`, `Sign in`, `Account`, `Current User`) unless `localeText` is
 * supplied. These guards keep the popover from sliding back to English.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(__dirname, '../../..');
const LANGS = ['de', 'el', 'es', 'fr', 'it', 'nl', 'zh'];
// Toolpad's AccountLocaleContext keys -> the dashboard keys that feed them.
const LOCALE_TEXT_KEYS = {
    accountPreviewIconButtonLabel: 'dashboard_layout.account_menu_label',
    accountPreviewTitle: 'dashboard_layout.account_title',
    accountSignInLabel: 'dashboard_layout.account_sign_in',
    accountSignOutLabel: 'dashboard_layout.account_sign_out',
};

describe('account menu localisation', () => {
    const source = readFileSync(path.join(ROOT, 'src/components/dashboard/dashboard-layout.jsx'), 'utf8');

    it('hands every Toolpad account string to i18n', () => {
        for (const [toolpadKey, ourKey] of Object.entries(LOCALE_TEXT_KEYS)) {
            expect(source, `${toolpadKey} must read ${ourKey}`).toContain(
                `${toolpadKey}: t('${ourKey}'`,
            );
        }
        expect(source).toMatch(/<Account\s+localeText=\{localeText\}/);
    });

    it('translates all four labels in every language', () => {
        for (const lang of LANGS) {
            const file = path.join(ROOT, 'src/i18n/locales', lang, 'dashboard.json');
            const dashboard = JSON.parse(readFileSync(file, 'utf8'));
            for (const ourKey of Object.values(LOCALE_TEXT_KEYS)) {
                const [group, key] = ourKey.split('.');
                const value = dashboard[group]?.[key];
                expect(value, `${lang}/${ourKey}`).toBeTruthy();
                expect(typeof value).toBe('string');
            }
        }
    });
});
