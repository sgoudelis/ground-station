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

import React, { useEffect } from 'react';
import { Box, Stack } from '@mui/material';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';
import { AntTab, AntTabs } from '../common/common.jsx';
import PageTabsLayout from '../common/page-tabs.jsx';
import NotFoundPage from '../common/not-found-page.jsx';
import { useSocket } from '../common/socket.jsx';
import { fetchScheduledObservations } from './scheduler-slice.jsx';
import ObservationsTable from './observations-table.jsx';
import MonitoredSatellitesTable from './monitored-satellites-table.jsx';
import ObservationStatusBanner from './observation-status-banner.jsx';
import ContinuousObservations from './continuous-observations.jsx';

export default function ScheduledObservationsLayout() {
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const { t } = useTranslation('common');
    // The URL is the source of truth for direct links and browser history.
    const { tab: activeTab } = useParams();
    const validTab = ['monitored', 'observations', 'continuous'].includes(activeTab);

    useEffect(() => {
        // The upcoming banner needs observations before their table's tab is opened.
        if (socket && validTab) dispatch(fetchScheduledObservations({ socket }));
    }, [socket, dispatch, validTab]);

    if (!activeTab) return <Navigate to="/scheduler/monitored" replace />;
    if (!validTab) return <NotFoundPage />;

    return (
        <PageTabsLayout sx={{ width: '100%', minWidth: 0, bgcolor: 'transparent' }} tabs={
            <AntTabs
                value={activeTab}
                variant="scrollable"
                scrollButtons
                allowScrollButtonsMobile
                aria-label={t('scheduler', { ns: 'navigation' })}
                sx={(theme) => ({
                    backgroundColor: theme.palette.settingsTabs?.detailRow?.background || theme.palette.background.paper,
                    borderColor: theme.palette.settingsTabs?.border || theme.palette.divider,
                    '& .MuiTabs-indicator': { display: 'none' },
                    '& .MuiTabs-scrollButtons.Mui-disabled': { opacity: 0.3 },
                    '& .MuiTab-root.Mui-selected': {
                        backgroundColor: theme.palette.settingsTabs?.detailRow?.selected || theme.palette.action.selected,
                        color: theme.palette.text.primary,
                    },
                })}
            >
                <AntTab
                    value="monitored"
                    component={Link}
                    to="/scheduler/monitored"
                    id="scheduler-tab-monitored"
                    aria-controls="scheduler-panel-monitored"
                    label={t('scheduler_tables.monitored.title')}
                />
                <AntTab
                    value="observations"
                    component={Link}
                    to="/scheduler/observations"
                    id="scheduler-tab-observations"
                    aria-controls="scheduler-panel-observations"
                    label={t('scheduler_tables.observations.title')}
                />
                <AntTab
                    value="continuous"
                    component={Link}
                    to="/scheduler/continuous"
                    id="scheduler-tab-continuous"
                    aria-controls="scheduler-panel-continuous"
                    label={t('continuous_observations.title')}
                />
            </AntTabs>
        }>
            <Box
                role="tabpanel"
                id="scheduler-panel-monitored"
                aria-labelledby="scheduler-tab-monitored"
                hidden={activeTab !== 'monitored'}
                sx={{ p: 2, minWidth: 0 }}
            >
                {activeTab === 'monitored' && (
                    <Stack spacing={2}>
                        <ObservationStatusBanner />
                        <MonitoredSatellitesTable />
                    </Stack>
                )}
            </Box>
            <Box
                role="tabpanel"
                id="scheduler-panel-observations"
                aria-labelledby="scheduler-tab-observations"
                hidden={activeTab !== 'observations'}
                sx={{ p: 2, minWidth: 0 }}
            >
                {activeTab === 'observations' && (
                    <Stack spacing={2}>
                        <ObservationStatusBanner />
                        <ObservationsTable />
                    </Stack>
                )}
            </Box>
            <Box
                role="tabpanel"
                id="scheduler-panel-continuous"
                aria-labelledby="scheduler-tab-continuous"
                hidden={activeTab !== 'continuous'}
                sx={{ p: 2, minWidth: 0 }}
            >
                {activeTab === 'continuous' && <ContinuousObservations />}
            </Box>
        </PageTabsLayout>
    );
}
