/**
 * Ground Station - Custom Icons
 * Developed with assistance from Claude (Anthropic AI)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { SvgIcon } from '@mui/material';
import { useTranslation } from 'react-i18next';

/**
 * Orbit-style icon for orbital data sources.
 * Works like a Material-UI icon - inherits color, fontSize, and other props.
 */
export const TleIcon = (props) => {
    return (
        <SvgIcon {...props} viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="2.3" fill="currentColor" />
            <ellipse
                cx="12"
                cy="12"
                rx="10.7"
                ry="6.4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                transform="rotate(-20 12 12)"
            />
            <ellipse
                cx="12"
                cy="12"
                rx="8.0"
                ry="4.4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                opacity="0.78"
                transform="rotate(26 12 12)"
            />
            <circle cx="20.8" cy="6.6" r="1.35" fill="currentColor" />
        </SvgIcon>
    );
};

/**
 * Custom icon for celestial navigation - simple solar system motif.
 */
export const CelestialSolarIcon = (props) => {
    return (
        <SvgIcon {...props} viewBox="0 0 24 24">
            <g transform="translate(12 12) scale(1.36) translate(-12 -12)">
                <circle cx="12" cy="12" r="2.1" fill="currentColor"/>
                <ellipse cx="12" cy="12" rx="7.2" ry="5.1" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.95"/>
                <ellipse cx="12" cy="12" rx="4.7" ry="3.2" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.8"/>
                <circle cx="18.5" cy="12.4" r="1.2" fill="currentColor"/>
                <circle cx="9.1" cy="9.1" r="0.9" fill="currentColor" opacity="0.9"/>
            </g>
        </SvgIcon>
    );
};

/**
 * Custom icon displaying "VFO" with "1" underneath
 */
export const VFO1Icon = (props) => {
    const { t } = useTranslation('common');
    return (
        <SvgIcon {...props}>
            <text
                x="50%"
                y="40%"
                dominantBaseline="middle"
                textAnchor="middle"
                fontSize="10"
                fontWeight="bold"
                fontFamily="Roboto, Arial, sans-serif"
            >
                {t('custom_icons.vfo', { defaultValue: 'VFO' })}
            </text>
            <text
                x="50%"
                y="85%"
                dominantBaseline="middle"
                textAnchor="middle"
                fontSize="10"
                fontWeight="bold"
                fontFamily="Roboto, Arial, sans-serif"
            >
                1
            </text>
        </SvgIcon>
    );
};

/**
 * Custom icon displaying "VFO" with "2" underneath
 */
export const VFO2Icon = (props) => {
    const { t } = useTranslation('common');
    return (
        <SvgIcon {...props}>
            <text
                x="50%"
                y="40%"
                dominantBaseline="middle"
                textAnchor="middle"
                fontSize="10"
                fontWeight="bold"
                fontFamily="Roboto, Arial, sans-serif"
            >
                {t('custom_icons.vfo', { defaultValue: 'VFO' })}
            </text>
            <text
                x="50%"
                y="85%"
                dominantBaseline="middle"
                textAnchor="middle"
                fontSize="10"
                fontWeight="bold"
                fontFamily="Roboto, Arial, sans-serif"
            >
                2
            </text>
        </SvgIcon>
    );
};

/**
 * Custom icon displaying "VFO" with "3" underneath
 */
export const VFO3Icon = (props) => {
    const { t } = useTranslation('common');
    return (
        <SvgIcon {...props}>
            <text
                x="50%"
                y="40%"
                dominantBaseline="middle"
                textAnchor="middle"
                fontSize="10"
                fontWeight="bold"
                fontFamily="Roboto, Arial, sans-serif"
            >
                {t('custom_icons.vfo', { defaultValue: 'VFO' })}
            </text>
            <text
                x="50%"
                y="85%"
                dominantBaseline="middle"
                textAnchor="middle"
                fontSize="10"
                fontWeight="bold"
                fontFamily="Roboto, Arial, sans-serif"
            >
                3
            </text>
        </SvgIcon>
    );
};

/**
 * Custom icon displaying "VFO" with "4" underneath
 */
export const VFO4Icon = (props) => {
    const { t } = useTranslation('common');
    return (
        <SvgIcon {...props}>
            <text
                x="50%"
                y="40%"
                dominantBaseline="middle"
                textAnchor="middle"
                fontSize="10"
                fontWeight="bold"
                fontFamily="Roboto, Arial, sans-serif"
            >
                {t('custom_icons.vfo', { defaultValue: 'VFO' })}
            </text>
            <text
                x="50%"
                y="85%"
                dominantBaseline="middle"
                textAnchor="middle"
                fontSize="10"
                fontWeight="bold"
                fontFamily="Roboto, Arial, sans-serif"
            >
                4
            </text>
        </SvgIcon>
    );
};

/**
 * Custom icon for toggling left panel - shows rectangle with left section
 */
export const ToggleLeftPanelIcon = (props) => {
    return (
        <SvgIcon {...props} viewBox="0 0 24 24">
            <path d="M3 5v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2z" fill="none" stroke="currentColor" strokeWidth="2"/>
            <path d="M9 3v18" stroke="currentColor" strokeWidth="2"/>
            <rect x="3" y="5" width="6" height="14" fill="currentColor" opacity="0.3"/>
        </SvgIcon>
    );
};

/**
 * Custom icon for toggling right panel - shows rectangle with right section
 */
export const ToggleRightPanelIcon = (props) => {
    return (
        <SvgIcon {...props} viewBox="0 0 24 24">
            <path d="M3 5v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2z" fill="none" stroke="currentColor" strokeWidth="2"/>
            <path d="M15 3v18" stroke="currentColor" strokeWidth="2"/>
            <rect x="15" y="5" width="6" height="14" fill="currentColor" opacity="0.3"/>
        </SvgIcon>
    );
};

/**
 * Custom icon for auto DB range - shows waveform with auto-adjusting bounds
 */
export const AutoDBIcon = (props) => {
    return (
        <SvgIcon {...props} viewBox="0 0 24 24">
            <path d="M3 12h2l2-6 4 12 4-9 2 3h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M2 7h20M2 17h20" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2,2" opacity="0.6"/>
            <circle cx="20" cy="7" r="2" fill="currentColor"/>
            <circle cx="20" cy="17" r="2" fill="currentColor"/>
        </SvgIcon>
    );
};

/**
 * Custom icon for auto scale once - shows waveform with vertical arrows
 */
export const AutoScaleOnceIcon = (props) => {
    return (
        <SvgIcon {...props} viewBox="0 0 24 24">
            <path d="M4 12h2l2-5 3 10 3-7 2 2h4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M21 6v12M21 6l-2 2M21 6l2 2M21 18l-2-2M21 18l2-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </SvgIcon>
    );
};

/**
 * Custom icon for signal strength presets - shows three signal levels
 */
export const SignalPresetsIcon = (props) => {
    return (
        <SvgIcon {...props} viewBox="0 0 24 24">
            <rect x="4" y="14" width="3" height="6" fill="currentColor" rx="1"/>
            <rect x="10.5" y="10" width="3" height="10" fill="currentColor" rx="1"/>
            <rect x="17" y="6" width="3" height="14" fill="currentColor" rx="1"/>
            <path d="M4 5h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </SvgIcon>
    );
};

/**
 * Custom icon for reset zoom - shows magnifying glass with circular arrow
 */
export const ResetZoomIcon = (props) => {
    return (
        <SvgIcon {...props} viewBox="0 0 24 24">
            <circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" strokeWidth="2"/>
            <path d="M14.5 14.5L20 20" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            <path d="M13 7.5A4.5 4.5 0 008 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            <path d="M8 6l1 2.5L6.5 7" fill="currentColor"/>
        </SvgIcon>
    );
};

/**
 * Custom icon for rotator lines - shows dashed horizontal guidelines
 */
export const RotatorLinesIcon = (props) => {
    return (
        <SvgIcon {...props} viewBox="0 0 24 24">
            <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeDasharray="4,3" strokeLinecap="round"/>
            <circle cx="12" cy="12" r="2" fill="currentColor"/>
        </SvgIcon>
    );
};
