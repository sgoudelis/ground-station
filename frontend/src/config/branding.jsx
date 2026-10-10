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

import {GroundStationLogoGreenBlue} from "../components/common/dataurl-icons.jsx";
import { useTranslation } from 'react-i18next';

// The logo is wrapped in a component so its alt text reacts to language changes
// (a hook cannot be called in the module-level branding factory).
const BrandingLogo = () => {
    const { t } = useTranslation('common');
    return (
        <img
            src={GroundStationLogoGreenBlue}
            alt={t('branding.ground_station', { defaultValue: 'Ground Station' })}
            style={{height: 128}}
        />
    );
};

// Toolpad's Branding.title must stay a plain string (it is rendered inside a
// Typography and interpolated by SignInPage), so the branding object is built by
// a factory that receives `t` from the calling component instead of a hook here.
export const getBranding = (t) => ({
    logo: <BrandingLogo />,
    title: t('branding.ground_station', { defaultValue: 'Ground Station' }),
});
