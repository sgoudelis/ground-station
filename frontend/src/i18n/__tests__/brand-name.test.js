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
 * The project name in the dashboard top bar is a brand string: it must render as
 * "Ground Station" in every language. Translated `*.ground_station` locale values are
 * intentionally kept in the locale files (they belong to sentences about a ground
 * station), so the guard checks the component wiring instead of the locale data.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { APP_NAME } from '../../config/branding.jsx';

const ROOT = path.resolve(__dirname, '../../..');
const read = (relative) => readFileSync(path.join(ROOT, relative), 'utf8');

describe('project brand name', () => {
    it('is the untranslated product name', () => {
        expect(APP_NAME).toBe('Ground Station');
    });

    it('renders from APP_NAME in the dashboard top bar, not from a locale key', () => {
        const source = read('src/components/dashboard/dashboard-layout.jsx');
        expect(source).toContain('alt={APP_NAME}');
        expect(source).toContain('<Typography variant="h6">{APP_NAME}</Typography>');
        expect(source).not.toMatch(/t\(\s*['"]dashboard_layout\.ground_station/);
    });

    it('renders from APP_NAME in the About card, not from a locale key', () => {
        const source = read('src/components/settings/about.jsx');
        expect(source).toMatch(/\{APP_NAME\}/);
        expect(source).not.toMatch(/t\(\s*['"]about\.ground_station/);
    });

    it('keeps the translated locale values that the brand change leaves unused', () => {
        // Deleting these would silently break the surrounding sentences that use them.
        for (const lang of ['de', 'el', 'es', 'fr', 'it', 'nl', 'zh']) {
            const dashboard = JSON.parse(read(`src/i18n/locales/${lang}/dashboard.json`));
            expect(dashboard.dashboard_layout?.ground_station).toBeTruthy();
            const settings = JSON.parse(read(`src/i18n/locales/${lang}/settings.json`));
            expect(settings.about?.ground_station).toBeTruthy();
        }
    });
});
