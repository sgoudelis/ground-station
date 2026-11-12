/** Copyright (c) 2026 Efstratios Goudelis. SPDX-License-Identifier: GPL-3.0-or-later */

import SettingsApplicationsIcon from '@mui/icons-material/SettingsApplications';
import MemoryIcon from '@mui/icons-material/Memory';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import GroupIcon from '@mui/icons-material/Group';
import FeedbackIcon from '@mui/icons-material/Feedback';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import DashboardCustomizeIcon from '@mui/icons-material/DashboardCustomize';
import HistoryIcon from '@mui/icons-material/History';
import ArticleIcon from '@mui/icons-material/Article';
import BugReportIcon from '@mui/icons-material/BugReport';
import Inventory2Icon from '@mui/icons-material/Inventory2';
import DnsIcon from '@mui/icons-material/Dns';
import StorageIcon from '@mui/icons-material/Storage';

// Sidebar children and page tabs share their order, labels and destinations.
// Existing Settings URLs remain stable, including Hardware's SDR landing page.
export const SYSTEM_SETTINGS_PAGES = [
    { key: 'general', labelKey: 'tabs.general', defaultLabel: 'General', icon: <SettingsApplicationsIcon />, path: '/admin/system/general' },
    { key: 'hardware', labelKey: 'tabs.hardware', defaultLabel: 'Hardware', icon: <MemoryIcon />, path: '/admin/system/hardware/sdrs' },
    { key: 'location', labelKey: 'tabs.location', defaultLabel: 'Location', icon: <LocationOnIcon />, path: '/admin/system/location' },
    { key: 'users', labelKey: 'tabs.users', defaultLabel: 'Users', icon: <GroupIcon />, path: '/admin/system/users' },
    { key: 'feedback', labelKey: 'tabs.feedback', defaultLabel: 'Feedback', icon: <FeedbackIcon />, path: '/admin/system/feedback' },
];

export const MAINTENANCE_PATH = '/admin/system/maintenance';

// Retired standalone pages keep their bookmarks after consolidation.
export const MAINTENANCE_ALIASES = {
    'redux-inspector': 'frontend-state',
    'system-info': 'system',
    'system-control': 'system',
};

export const MAINTENANCE_PAGES = [
    { key: 'updates', labelKey: 'maintenance.tabs.updates', defaultLabel: 'Updates', icon: <SystemUpdateAltIcon /> },
    { key: 'frontend-state', labelKey: 'maintenance.tabs.frontend_state', defaultLabel: 'Frontend State', icon: <DashboardCustomizeIcon /> },
    { key: 'sessions', labelKey: 'maintenance.tabs.sessions', defaultLabel: 'Sessions', icon: <HistoryIcon /> },
    { key: 'message-log', labelKey: 'maintenance.tabs.message_log', defaultLabel: 'Message Log', icon: <ArticleIcon /> },
    { key: 'diagnostics', labelKey: 'maintenance.tabs.diagnostics', defaultLabel: 'Diagnostics', icon: <BugReportIcon /> },
    { key: 'dependencies', labelKey: 'maintenance.tabs.dependencies', defaultLabel: 'Dependencies', icon: <Inventory2Icon /> },
    { key: 'system', labelKey: 'maintenance.tabs.system', defaultLabel: 'System', icon: <DnsIcon /> },
    { key: 'database', labelKey: 'maintenance.tabs.database', defaultLabel: 'Database', icon: <StorageIcon /> },
].map((page) => ({ ...page, path: `${MAINTENANCE_PATH}/${page.key}` }));
