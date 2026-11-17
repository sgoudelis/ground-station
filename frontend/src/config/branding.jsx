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

import {GroundStationLogoMeridian} from "../components/common/logo-dataurl.js";

/**
 * Project/product name. This is a brand string rather than UI copy, so it is never
 * translated: every surface renders `APP_NAME` directly, and the locale keys that hold
 * translated variants (`*.ground_station`) stay in the locale files for the sentences that
 * legitimately talk about a ground station.
 */
export const APP_NAME = 'Ground Station';

// Toolpad's Branding.title must stay a plain string (it is rendered inside a Typography and
// interpolated by SignInPage). Nothing here depends on the language any more, because the brand
// name is the same in all of them - an earlier version translated the title and the logo alt, so
// the sign-in page painted e.g. "Σταθμός Εδάφους".
export const getBranding = () => ({
    logo: <img src={GroundStationLogoMeridian} alt={APP_NAME} style={{ height: 128 }} />,
    title: APP_NAME,
});
