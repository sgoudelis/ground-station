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

// Import translation files
import commonEN from './locales/en/common.json';
import navigationEN from './locales/en/navigation.json';
import hardwareEN from './locales/en/hardware.json';
import settingsEN from './locales/en/settings.json';
import satellitesEN from './locales/en/satellites.json';
import trackingEN from './locales/en/tracking.json';
import overviewEN from './locales/en/overview.json';
import targetEN from './locales/en/target.json';
import dashboardEN from './locales/en/dashboard.json';
import waterfallEN from './locales/en/waterfall.json';
import filebrowserEN from './locales/en/filebrowser.json';

import commonEL from './locales/el/common.json';
import navigationEL from './locales/el/navigation.json';
import hardwareEL from './locales/el/hardware.json';
import settingsEL from './locales/el/settings.json';
import satellitesEL from './locales/el/satellites.json';
import trackingEL from './locales/el/tracking.json';
import overviewEL from './locales/el/overview.json';
import targetEL from './locales/el/target.json';
import dashboardEL from './locales/el/dashboard.json';
import waterfallEL from './locales/el/waterfall.json';
import filebrowserEL from './locales/el/filebrowser.json';

import commonFR from './locales/fr/common.json';
import navigationFR from './locales/fr/navigation.json';
import hardwareFR from './locales/fr/hardware.json';
import settingsFR from './locales/fr/settings.json';
import satellitesFR from './locales/fr/satellites.json';
import trackingFR from './locales/fr/tracking.json';
import overviewFR from './locales/fr/overview.json';
import targetFR from './locales/fr/target.json';
import dashboardFR from './locales/fr/dashboard.json';
import waterfallFR from './locales/fr/waterfall.json';
import filebrowserFR from './locales/fr/filebrowser.json';

import commonES from './locales/es/common.json';
import navigationES from './locales/es/navigation.json';
import hardwareES from './locales/es/hardware.json';
import settingsES from './locales/es/settings.json';
import satellitesES from './locales/es/satellites.json';
import trackingES from './locales/es/tracking.json';
import overviewES from './locales/es/overview.json';
import targetES from './locales/es/target.json';
import dashboardES from './locales/es/dashboard.json';
import waterfallES from './locales/es/waterfall.json';
import filebrowserES from './locales/es/filebrowser.json';

import commonDE from './locales/de/common.json';
import navigationDE from './locales/de/navigation.json';
import hardwareDE from './locales/de/hardware.json';
import settingsDE from './locales/de/settings.json';
import satellitesDE from './locales/de/satellites.json';
import trackingDE from './locales/de/tracking.json';
import overviewDE from './locales/de/overview.json';
import targetDE from './locales/de/target.json';
import dashboardDE from './locales/de/dashboard.json';
import waterfallDE from './locales/de/waterfall.json';
import filebrowserDE from './locales/de/filebrowser.json';

import commonNL from './locales/nl/common.json';
import navigationNL from './locales/nl/navigation.json';
import hardwareNL from './locales/nl/hardware.json';
import settingsNL from './locales/nl/settings.json';
import satellitesNL from './locales/nl/satellites.json';
import trackingNL from './locales/nl/tracking.json';
import overviewNL from './locales/nl/overview.json';
import targetNL from './locales/nl/target.json';
import dashboardNL from './locales/nl/dashboard.json';
import waterfallNL from './locales/nl/waterfall.json';
import filebrowserNL from './locales/nl/filebrowser.json';

import commonIT from './locales/it/common.json';
import navigationIT from './locales/it/navigation.json';
import hardwareIT from './locales/it/hardware.json';
import settingsIT from './locales/it/settings.json';
import satellitesIT from './locales/it/satellites.json';
import trackingIT from './locales/it/tracking.json';
import overviewIT from './locales/it/overview.json';
import targetIT from './locales/it/target.json';
import dashboardIT from './locales/it/dashboard.json';
import waterfallIT from './locales/it/waterfall.json';
import filebrowserIT from './locales/it/filebrowser.json';

import commonZH from './locales/zh/common.json';
import navigationZH from './locales/zh/navigation.json';
import hardwareZH from './locales/zh/hardware.json';
import settingsZH from './locales/zh/settings.json';
import satellitesZH from './locales/zh/satellites.json';
import trackingZH from './locales/zh/tracking.json';
import overviewZH from './locales/zh/overview.json';
import targetZH from './locales/zh/target.json';
import dashboardZH from './locales/zh/dashboard.json';
import waterfallZH from './locales/zh/waterfall.json';
import filebrowserZH from './locales/zh/filebrowser.json';

const resources = {
    en: {
        common: commonEN,
        navigation: navigationEN,
        hardware: hardwareEN,
        settings: settingsEN,
        satellites: satellitesEN,
        tracking: trackingEN,
        overview: overviewEN,
        target: targetEN,
        dashboard: dashboardEN,
        waterfall: waterfallEN,
        filebrowser: filebrowserEN,
    },
    el: {
        common: commonEL,
        navigation: navigationEL,
        hardware: hardwareEL,
        settings: settingsEL,
        satellites: satellitesEL,
        tracking: trackingEL,
        overview: overviewEL,
        target: targetEL,
        dashboard: dashboardEL,
        waterfall: waterfallEL,
        filebrowser: filebrowserEL,
    },
    fr: {
        common: commonFR,
        navigation: navigationFR,
        hardware: hardwareFR,
        settings: settingsFR,
        satellites: satellitesFR,
        tracking: trackingFR,
        overview: overviewFR,
        target: targetFR,
        dashboard: dashboardFR,
        waterfall: waterfallFR,
        filebrowser: filebrowserFR,
    },
    es: {
        common: commonES,
        navigation: navigationES,
        hardware: hardwareES,
        settings: settingsES,
        satellites: satellitesES,
        tracking: trackingES,
        overview: overviewES,
        target: targetES,
        dashboard: dashboardES,
        waterfall: waterfallES,
        filebrowser: filebrowserES,
    },
    de: {
        common: commonDE,
        navigation: navigationDE,
        hardware: hardwareDE,
        settings: settingsDE,
        satellites: satellitesDE,
        tracking: trackingDE,
        overview: overviewDE,
        target: targetDE,
        dashboard: dashboardDE,
        waterfall: waterfallDE,
        filebrowser: filebrowserDE,
    },
    nl: {
        common: commonNL,
        navigation: navigationNL,
        hardware: hardwareNL,
        settings: settingsNL,
        satellites: satellitesNL,
        tracking: trackingNL,
        overview: overviewNL,
        target: targetNL,
        dashboard: dashboardNL,
        waterfall: waterfallNL,
        filebrowser: filebrowserNL,
    },
    it: {
        common: commonIT,
        navigation: navigationIT,
        hardware: hardwareIT,
        settings: settingsIT,
        satellites: satellitesIT,
        tracking: trackingIT,
        overview: overviewIT,
        target: targetIT,
        dashboard: dashboardIT,
        waterfall: waterfallIT,
        filebrowser: filebrowserIT,
    },
    zh: {
        common: commonZH,
        navigation: navigationZH,
        hardware: hardwareZH,
        settings: settingsZH,
        satellites: satellitesZH,
        tracking: trackingZH,
        overview: overviewZH,
        target: targetZH,
        dashboard: dashboardZH,
        waterfall: waterfallZH,
        filebrowser: filebrowserZH,
    },
};

i18n
    .use(initReactI18next)
    .init({
        resources,
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
