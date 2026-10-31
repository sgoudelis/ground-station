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

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// English is the default and fallback language, so it ships with the app shell
// and is available synchronously. Every other language is fetched on demand the
// first time it is selected; bundling all of them statically added ~1 MB to the
// initial download for strings most installs never display.
import commonEN from './locales/en/common.json';
import navigationEN from './locales/en/navigation.json';
import hardwareEN from './locales/en/hardware.json';
import settingsEN from './locales/en/settings.json';
import satellitesEN from './locales/en/satellites.json';
import trackingEN from './locales/en/tracking.json';
import earthviewEN from './locales/en/earthview.json';
import targetEN from './locales/en/target.json';
import dashboardEN from './locales/en/dashboard.json';
import waterfallEN from './locales/en/waterfall.json';
import filebrowserEN from './locales/en/filebrowser.json';
import celestialEN from './locales/en/celestial.json';

const bundledResources = {
    en: {
        common: commonEN,
        navigation: navigationEN,
        hardware: hardwareEN,
        settings: settingsEN,
        satellites: satellitesEN,
        tracking: trackingEN,
        earthview: earthviewEN,
        target: targetEN,
        dashboard: dashboardEN,
        waterfall: waterfallEN,
        filebrowser: filebrowserEN,
        celestial: celestialEN,
    },
};

export const NAMESPACES = Object.keys(bundledResources.en);

// Lazy loaders keyed by './locales/<lng>/<ns>.json'; Vite emits one chunk per file.
const localeLoaders = import.meta.glob(['./locales/*/*.json', '!./locales/en/*.json']);

export const SUPPORTED_LANGUAGES = [
    'en',
    ...new Set(Object.keys(localeLoaders).map((path) => path.split('/')[2])),
];

// Minimal i18next backend that resolves a namespace from the glob map.
// `changeLanguage()` awaits these reads before switching, so the UI never
// renders a half-loaded language; missing files fall back to English per key.
const lazyLocaleBackend = {
    type: 'backend',
    init() {},
    read(language, namespace, callback) {
        const load = localeLoaders[`./locales/${language}/${namespace}.json`];
        if (!load) {
            callback(null, {});
            return;
        }
        load()
            .then((module) => callback(null, module.default ?? module))
            .catch((error) => callback(error, false));
    },
};

i18n
    .use(lazyLocaleBackend)
    .use(initReactI18next)
    .init({
        resources: bundledResources,
        // Bundled English is complete; only request other languages from the backend.
        partialBundledLanguages: true,
        ns: NAMESPACES,
        lng: 'en', // default language
        fallbackLng: 'en',
        defaultNS: 'common',
        interpolation: {
            escapeValue: false, // React already escapes values
        },
        react: {
            useSuspense: true,
        },
    });

export default i18n;
