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

    it('renders from APP_NAME in the application footer, not from a locale key', () => {
        // The footer paints "<name> <version>", so a translated brand made the version line read
        // e.g. "Σταθμός Εδάφους 0.8.27-main-…" in Greek.
        const source = read('src/components/dashboard/application-footer.jsx');
        expect(source).toContain('{APP_NAME}{renderedVersion');
        expect(source).not.toMatch(/t\(\s*['"]application_footer\.ground_station/);
    });

    it('renders from APP_NAME on the sign-in surface, not from a locale key', () => {
        const branding = read('src/config/branding.jsx');
        expect(branding).toContain('title: APP_NAME');
        expect(branding).toContain('alt={APP_NAME}');
        expect(branding).not.toMatch(/t\(\s*['"]branding\.ground_station/);
        const screens = read('src/components/auth/screens.jsx');
        expect(screens).toContain('alt={APP_NAME}');
        // `screens.ground_station_setup` is a phrase, not the brand label, and its translations
        // already keep the name (el «Ρύθμιση Ground Station»), so only the bare key is guarded.
        expect(screens).not.toMatch(/t\(\s*['"]screens\.ground_station['"]/);
    });

    it('keeps the translated locale values that the brand change leaves unused', () => {
        // Deleting these would silently break the surrounding sentences that use them.
        for (const lang of ['de', 'el', 'es', 'fr', 'it', 'nl', 'zh']) {
            const dashboard = JSON.parse(read(`src/i18n/locales/${lang}/dashboard.json`));
            expect(dashboard.dashboard_layout?.ground_station).toBeTruthy();
            // Kept as vocabulary: the footer no longer reads it, but "ground station" appears in
            // ordinary sentences, so the value stays available for those.
            expect(dashboard.application_footer?.ground_station).toBeTruthy();
            // Same reason on the sign-in side: vocabulary, not brand chrome.
            const common = JSON.parse(read(`src/i18n/locales/${lang}/common.json`));
            expect(common.branding?.ground_station).toBeTruthy();
            const settings = JSON.parse(read(`src/i18n/locales/${lang}/settings.json`));
            expect(settings.about?.ground_station).toBeTruthy();
        }
    });
});
