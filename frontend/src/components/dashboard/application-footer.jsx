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
 */

import { Box, Link, Typography } from '@mui/material';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

const PROJECT_URL = 'https://github.com/sgoudelis/ground-station';
const MAINTAINER_URL = 'https://github.com/sgoudelis';
const SPONSOR_URL = 'https://github.com/sponsors/sgoudelis';

export const formatUptime = (seconds) => {
    if (!Number.isFinite(seconds) || seconds < 0) return null;

    const totalMinutes = Math.floor(seconds / 60);
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes}m`;
};

const FooterItem = ({ children }) => (
    <Box
        component="span"
        sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.4,
            whiteSpace: 'nowrap',
            '&:not(:last-child)::after': {
                content: '"·"',
                color: 'text.disabled',
                mx: 0.75,
            },
        }}
    >
        {children}
    </Box>
);

export default function ApplicationFooter() {
    const { t } = useTranslation('dashboard');
    const version = useSelector((state) => state.version?.data?.version);
    const systemInfo = useSelector((state) => state.systemInfo);
    const hostname = systemInfo?.hostname || window.location.hostname;
    const osName = systemInfo?.os?.pretty_name
        || [systemInfo?.os?.system, systemInfo?.os?.release].filter(Boolean).join(' ');
    const uptime = formatUptime(systemInfo?.uptime_seconds);
    const renderedVersion = version ? String(version).replace(/^v/i, '') : null;

    return (
        <Box
            component="footer"
            aria-label={t('footer.label')}
            sx={{
                flexShrink: 0,
                borderTop: '1px solid',
                borderColor: 'divider',
                backgroundColor: 'background.paper',
                px: 1.5,
                py: 0.55,
            }}
        >
            <Typography
                component="div"
                variant="caption"
                color="text.secondary"
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexWrap: 'wrap',
                    rowGap: 0.25,
                    fontSize: '0.7rem',
                    lineHeight: 1.5,
                }}
            >
                <FooterItem>
                    <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
                        {t('application_footer.ground_station', { defaultValue: 'Ground Station' })}{renderedVersion ? ` ${renderedVersion}` : ''}
                    </Box>
                </FooterItem>
                {hostname && <FooterItem>{hostname}</FooterItem>}
                {osName && <FooterItem>{osName}</FooterItem>}
                {uptime && <FooterItem>{uptime}</FooterItem>}
                <FooterItem>
                    <Link href={PROJECT_URL} target="_blank" rel="noreferrer" color="inherit">
                        {t('footer.open_source')}
                    </Link>
                </FooterItem>
                <FooterItem>
                    {t('footer.made_by')}
                    <Link href={MAINTAINER_URL} target="_blank" rel="noreferrer" color="inherit">
                        {t('application_footer.efstratios_goudelis', { defaultValue: 'Efstratios Goudelis' })}
                    </Link>
                </FooterItem>
                <FooterItem>
                    <Link href={SPONSOR_URL} target="_blank" rel="noreferrer" color="primary.main" fontWeight={600}>
                        {t('footer.sponsor')}
                    </Link>
                </FooterItem>
            </Typography>
        </Box>
    );
}
