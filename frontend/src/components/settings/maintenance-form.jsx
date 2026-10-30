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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
    Box,
    Chip,
    Grid,
    Paper,
    Stack,
    Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { tabsClasses } from '@mui/material/Tabs';
import StorageIcon from '@mui/icons-material/Storage';
import DashboardCustomizeIcon from '@mui/icons-material/DashboardCustomize';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import PowerSettingsNewIcon from '@mui/icons-material/PowerSettingsNew';
import BugReportIcon from '@mui/icons-material/BugReport';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import MemoryIcon from '@mui/icons-material/Memory';
import DnsIcon from '@mui/icons-material/Dns';
import HistoryIcon from '@mui/icons-material/History';
import ArticleIcon from '@mui/icons-material/Article';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
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

const TAB_QUERY_PARAM = 'mtab';

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

    const tabMeta = useMemo(() => ([
        {
            key: 'updates',
            group: 'operations',
            label: t('maintenance.tabs.updates', { defaultValue: 'Updates' }),
            subtitle: t('maintenance.tabs.updates_subtitle', { defaultValue: 'GitHub release status and Docker update instructions' }),
            icon: <SystemUpdateAltIcon fontSize="small" />,
        },
        {
            key: 'frontend-state',
            group: 'state',
            label: t('maintenance.tabs.frontend_state', { defaultValue: 'Frontend State' }),
            subtitle: t('maintenance.tabs.frontend_state_subtitle', { defaultValue: 'Local storage and persisted client state' }),
            icon: <DashboardCustomizeIcon fontSize="small" />,
        },
        {
            key: 'redux-inspector',
            group: 'state',
            label: t('maintenance.tabs.redux_inspector', { defaultValue: 'Redux Inspector' }),
            subtitle: t('maintenance.tabs.redux_inspector_subtitle', { defaultValue: 'Inspect and debug Redux state' }),
            icon: <AccountTreeIcon fontSize="small" />,
        },
        {
            key: 'sessions',
            group: 'state',
            label: t('maintenance.tabs.sessions', { defaultValue: 'Sessions' }),
            subtitle: t('maintenance.tabs.sessions_subtitle', { defaultValue: 'Connected clients and runtime snapshots' }),
            icon: <HistoryIcon fontSize="small" />,
        },
        {
            key: 'message-log',
            group: 'state',
            label: t('maintenance.tabs.message_log', { defaultValue: 'Message Log' }),
            subtitle: t('maintenance.tabs.message_log_subtitle', { defaultValue: 'Realtime event stream and console output' }),
            icon: <ArticleIcon fontSize="small" />,
        },
        {
            key: 'diagnostics',
            group: 'diagnostics',
            label: t('maintenance.tabs.diagnostics', { defaultValue: 'Diagnostics' }),
            subtitle: t('maintenance.tabs.diagnostics_subtitle', { defaultValue: 'Browser and socket diagnostics' }),
            icon: <BugReportIcon fontSize="small" />,
        },
        {
            key: 'dependencies',
            group: 'diagnostics',
            label: t('maintenance.tabs.dependencies', { defaultValue: 'Dependencies' }),
            subtitle: t('maintenance.tabs.dependencies_subtitle', { defaultValue: 'Library and runtime version inventory' }),
            icon: <Inventory2Icon fontSize="small" />,
        },
        {
            key: 'system-info',
            group: 'diagnostics',
            label: t('maintenance.tabs.system_info', { defaultValue: 'System Info' }),
            subtitle: t('maintenance.tabs.system_info_subtitle', { defaultValue: 'Host metrics and machine details' }),
            icon: <DnsIcon fontSize="small" />,
        },
        {
            key: 'system-control',
            group: 'operations',
            label: t('maintenance.tabs.system_control', { defaultValue: 'System Control' }),
            subtitle: t('maintenance.tabs.system_control_subtitle', { defaultValue: 'Service-level restart and control actions' }),
            icon: <PowerSettingsNewIcon fontSize="small" />,
        },
        {
            key: 'database',
            group: 'operations',
            label: t('maintenance.tabs.database', { defaultValue: 'Database' }),
            subtitle: t('maintenance.tabs.database_subtitle', { defaultValue: 'Backup, restore, and transmitter import' }),
            icon: <StorageIcon fontSize="small" />,
        },
    ]), [t]);

    const tabByKey = useMemo(
        () => Object.fromEntries(tabMeta.map((tab) => [tab.key, tab])),
        [tabMeta]
    );

    const getInitialTabKey = () => {
        const params = new URLSearchParams(location.search);
        const queryTab = params.get(TAB_QUERY_PARAM);
        return queryTab && tabByKey[queryTab] ? queryTab : 'updates';
    };

    const [activeTabKey, setActiveTabKey] = useState(getInitialTabKey);

    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const queryTab = params.get(TAB_QUERY_PARAM);
        if (queryTab && tabByKey[queryTab]) {
            setActiveTabKey((current) => (current === queryTab ? current : queryTab));
        }
    }, [location.search, tabByKey]);

    useEffect(() => {
        const params = new URLSearchParams(location.search);
        if (params.get(TAB_QUERY_PARAM) !== activeTabKey) {
            params.set(TAB_QUERY_PARAM, activeTabKey);
            navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
        }
    }, [activeTabKey, location.pathname, location.search, navigate]);

    useEffect(() => {
        if (panelRef.current) {
            // Keep keyboard accessibility focus without forcing viewport scroll.
            panelRef.current.focus({ preventScroll: true });
        }
    }, [activeTabKey]);

    const activeTab = tabByKey[activeTabKey] || tabMeta[0];

    const renderTabLabel = (tab) => (
        <Stack direction="row" spacing={1} alignItems="center">
            <Box
                component="span"
                sx={{
                    lineHeight: 1,
                    color: tab.risk === 'danger' ? 'warning.main' : 'inherit',
                    textAlign: 'left',
                }}
            >
                {tab.label}
            </Box>
            {tab.risk === 'danger' && (
                <Chip
                    size="small"
                    color="warning"
                    variant="outlined"
                    label={tab.riskLabel}
                    sx={{ display: { xs: 'none', xl: 'inline-flex' } }}
                />
            )}
        </Stack>
    );

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
                    onChange={(_event, newValue) => setActiveTabKey(newValue)}
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
                            label={renderTabLabel(tab)}
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
                    </Stack>
                </TabPanel>

                <TabPanel tabKey="redux-inspector">
                    <Stack spacing={2}>
                        <Grid container spacing={2}>
                            <Grid size={{ xs: 12, md: 12 }}>
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

                <TabPanel tabKey="system-control">
                    <Stack spacing={2}>
                        <Grid container spacing={2}>
                            <Grid size={{ xs: 12, md: 6 }}>
                                <Paper
                                    variant="outlined"
                                    sx={maintenanceSectionCardSx}
                                >
                                    <ServiceControlCard />
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

                <TabPanel tabKey="system-info">
                    <Grid container spacing={2}>
                        <Grid size={{ xs: 12 }}>
                            <SystemInfoCard />
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
