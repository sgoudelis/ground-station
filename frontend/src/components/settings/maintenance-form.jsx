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

import React, { useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
    Box,
    Grid,
    Paper,
    Stack,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { tabsClasses } from '@mui/material/Tabs';
import { useTranslation } from 'react-i18next';
import { AntTab, AntTabs } from '../common/common.jsx';
import PageTabsLayout from '../common/page-tabs.jsx';
import {
    BrowserFeaturesCard,
    CanvasDebugCard,
    DatabaseBackupCard,
    EventLogConsoleCard,
    GridLayoutStorageCard,
    LibraryVersionsCard,
    ReduxPersistentSettingsCard,
    ReduxStateInspectorCard,
    ServiceControlCard,
    SessionSnapshotCard,
    SocketInfoCard,
    SystemInfoCard,
    TimeDriftCard,
    TransmitterImportCard,
    UpdateCard,
} from './maintenance/index.jsx';

import { MAINTENANCE_PAGES } from '../../config/system-navigation.jsx';

const maintenanceSectionCardSx = {
    p: 2,
    borderColor: 'divider',
    borderRadius: 1.5,
    backgroundColor: (theme) => (
        theme.palette.mode === 'dark'
            ? alpha(theme.palette.grey[700], 0.18)
            : alpha(theme.palette.grey[100], 0.9)
    ),
};

const getMaintenanceTabsSx = (theme) => {
    const isDark = theme.palette.mode === 'dark';
    const fallbackDetailRow = isDark
        ? { background: '#24292f', selected: '#323942' }
        : { background: '#edf2f8', selected: '#ffffff' };

    const detailRow = theme.palette.settingsTabs?.detailRow || {};
    const borderColor = theme.palette.settingsTabs?.border
        || (isDark ? '#50565f' : '#c5cfdd');

    return {
        backgroundColor: detailRow.background || fallbackDetailRow.background,
        borderBottom: `1px solid ${borderColor}`,
        '& .MuiTabs-indicator': {
            display: 'none',
        },
        '& .MuiTab-root': {
            color: theme.palette.text.secondary,
            minHeight: 48,
            padding: '12px 16px',
            transition: 'background-color 140ms ease, color 140ms ease',
        },
        '& .MuiTab-root.Mui-selected': {
            backgroundColor: detailRow.selected || fallbackDetailRow.selected,
            color: theme.palette.text.primary,
        },
        [`& .${tabsClasses.scrollButtons}`]: {
            '&.Mui-disabled': { opacity: 0.3 },
        },
    };
};

const MaintenanceForm = () => {
    const { t } = useTranslation('settings');
    const location = useLocation();
    const navigate = useNavigate();
    const panelRef = useRef(null);

    const tabMeta = useMemo(() => MAINTENANCE_PAGES.map((page) => ({
        ...page,
        label: t(page.labelKey, { defaultValue: page.defaultLabel }),
    })), [t]);
    // Derive selection from the route so sidebar clicks, reloads and Back/Forward
    // always show the same panel without effects rewriting browser history.
    const pathname = location.pathname.replace(/\/$/, '');
    const activeTabKey = tabMeta.find((page) => page.path === pathname)?.key || tabMeta[0].key;

    useEffect(() => {
        if (panelRef.current) {
            // Keep keyboard accessibility focus without forcing viewport scroll.
            panelRef.current.focus({ preventScroll: true });
        }
    }, [activeTabKey]);

    const TabPanel = ({ tabKey, children }) => {
        const isActive = activeTabKey === tabKey;
        return (
            <Box
                role="tabpanel"
                id={`maintenance-tabpanel-${tabKey}`}
                aria-labelledby={`maintenance-tab-${tabKey}`}
                hidden={!isActive}
                tabIndex={isActive ? 0 : -1}
                ref={isActive ? panelRef : null}
                sx={{ outline: 'none' }}
            >
                {isActive && (
                    <Box sx={{ p: { xs: 1, sm: 1.5, md: 2 } }}>
                        {children}
                    </Box>
                )}
            </Box>
        );
    };

    return (
        <Paper elevation={3} sx={{ p: 0, mt: 0, borderRadius: 0 }}>
            <PageTabsLayout tabs={
                <AntTabs
                    value={activeTabKey}
                    onChange={(_event, newValue) => {
                        const page = tabMeta.find((item) => item.key === newValue);
                        if (page) navigate({ pathname: page.path, search: location.search, hash: location.hash });
                    }}
                    variant="scrollable"
                    scrollButtons
                    allowScrollButtonsMobile
                    aria-label={t('maintenance.tabs.aria', { defaultValue: 'maintenance tabs' })}
                    sx={getMaintenanceTabsSx}
                >
                    {tabMeta.map((tab) => (
                        <AntTab
                            key={tab.key}
                            value={tab.key}
                            id={`maintenance-tab-${tab.key}`}
                            aria-controls={`maintenance-tabpanel-${tab.key}`}
                            label={tab.label}
                        />
                    ))}
                </AntTabs>
            }>

                <TabPanel tabKey="updates">
                    <Grid container spacing={2}>
                        <Grid size={{ xs: 12 }}>
                            <Paper
                                variant="outlined"
                                sx={maintenanceSectionCardSx}
                            >
                                <UpdateCard />
                            </Paper>
                        </Grid>
                    </Grid>
                </TabPanel>

                <TabPanel tabKey="frontend-state">
                    <Stack spacing={2}>
                        <Grid container spacing={2}>
                            <Grid size={{ xs: 12, md: 6 }}>
                                <Paper
                                    variant="outlined"
                                    sx={{
                                        ...maintenanceSectionCardSx,
                                        height: '100%',
                                    }}
                                >
                                    <GridLayoutStorageCard />
                                </Paper>
                            </Grid>
                            <Grid size={{ xs: 12, md: 6 }}>
                                <Paper
                                    variant="outlined"
                                    sx={{
                                        ...maintenanceSectionCardSx,
                                        height: '100%',
                                    }}
                                >
                                    <ReduxPersistentSettingsCard />
                                </Paper>
                            </Grid>
                        </Grid>
                        <Grid container spacing={2}>
                            <Grid size={{ xs: 12 }}>
                                <Paper
                                    variant="outlined"
                                    sx={maintenanceSectionCardSx}
                                >
                                    <ReduxStateInspectorCard />
                                </Paper>
                            </Grid>
                        </Grid>
                    </Stack>
                </TabPanel>

                <TabPanel tabKey="diagnostics">
                    <Stack spacing={2}>
                        <Grid container spacing={2}>
                            <Grid size={{ xs: 12, md: 6 }}>
                                <Stack spacing={2}>
                                    <Paper
                                        variant="outlined"
                                        sx={maintenanceSectionCardSx}
                                    >
                                        <TimeDriftCard />
                                    </Paper>
                                    <Paper
                                        variant="outlined"
                                        sx={maintenanceSectionCardSx}
                                    >
                                        <SocketInfoCard />
                                    </Paper>
                                </Stack>
                            </Grid>
                            <Grid size={{ xs: 12, md: 6 }}>
                                <Stack spacing={2}>
                                    <Paper
                                        variant="outlined"
                                        sx={maintenanceSectionCardSx}
                                    >
                                        <BrowserFeaturesCard />
                                    </Paper>
                                    <Paper
                                        variant="outlined"
                                        sx={maintenanceSectionCardSx}
                                    >
                                        <CanvasDebugCard />
                                    </Paper>
                                </Stack>
                            </Grid>
                        </Grid>
                    </Stack>
                </TabPanel>

                <TabPanel tabKey="database">
                    <Stack spacing={2}>
                        <Grid container spacing={2}>
                            <Grid size={{ xs: 12 }}>
                                <Paper
                                    variant="outlined"
                                    sx={maintenanceSectionCardSx}
                                >
                                    <DatabaseBackupCard />
                                </Paper>
                            </Grid>
                            <Grid size={{ xs: 12 }}>
                                <Paper
                                    variant="outlined"
                                    sx={maintenanceSectionCardSx}
                                >
                                    <TransmitterImportCard />
                                </Paper>
                            </Grid>
                        </Grid>
                    </Stack>
                </TabPanel>

                <TabPanel tabKey="dependencies">
                    <Stack spacing={2}>
                        <Grid container spacing={2}>
                            <Grid size={{ xs: 12 }}>
                                <Paper
                                    variant="outlined"
                                    sx={maintenanceSectionCardSx}
                                >
                                    <LibraryVersionsCard />
                                </Paper>
                            </Grid>
                        </Grid>
                    </Stack>
                </TabPanel>

                <TabPanel tabKey="system">
                    <Grid container spacing={2}>
                        <Grid size={{ xs: 12 }}>
                            <SystemInfoCard />
                        </Grid>
                        <Grid size={{ xs: 12, md: 6 }}>
                            <Paper variant="outlined" sx={maintenanceSectionCardSx}>
                                <ServiceControlCard />
                            </Paper>
                        </Grid>
                    </Grid>
                </TabPanel>

                <TabPanel tabKey="sessions">
                    <Stack spacing={2}>
                        <Grid container spacing={2}>
                            <Grid size={{ xs: 12 }}>
                                <Paper
                                    variant="outlined"
                                    sx={maintenanceSectionCardSx}
                                >
                                    <SessionSnapshotCard />
                                </Paper>
                            </Grid>
                        </Grid>
                    </Stack>
                </TabPanel>

                <TabPanel tabKey="message-log">
                    <Stack spacing={2}>
                        <Grid container spacing={2}>
                            <Grid size={{ xs: 12 }}>
                                <Paper
                                    variant="outlined"
                                    sx={maintenanceSectionCardSx}
                                >
                                    <EventLogConsoleCard />
                                </Paper>
                            </Grid>
                        </Grid>
                    </Stack>
                </TabPanel>
            </PageTabsLayout>
        </Paper>
    );
};

export default MaintenanceForm;
