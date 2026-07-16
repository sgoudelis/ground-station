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

import React from 'react';
import {
    Box,
    Tab,
    Button,
    Alert,
    AlertTitle, Typography
} from '@mui/material';
import { Link, useLocation, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import Paper from "@mui/material/Paper";
import Tabs, { tabsClasses } from '@mui/material/Tabs';
import {gridLayoutStoreName as earthViewGridLayoutName} from '../earthview/main-layout.jsx';
import {gridLayoutStoreName as targetGridLayoutName} from '../target/main-layout.jsx';
import Grid from "@mui/material/Grid";
import AntennaRotatorTable from "../hardware/rotator-table.jsx";
import RigTable from "../hardware/rig-table.jsx";
import {styled} from "@mui/material/styles";
import SourcesTable from "../satellites/sources-table.jsx";
import SatelliteTable from "../satellites/satellite-table.jsx";
import AboutPage from "./about.jsx";
import SatelliteGroupsTable from "../satellites/groups-table.jsx";
import LocationPage from "./location-form.jsx";
import PreferencesForm from "./preferences-form.jsx";
import MaintenanceForm from "./maintenance-form.jsx";
import UsersForm from "./users-form.jsx";
import {AntTab, AntTabs} from "../common/common.jsx";
import SDRsPage from "../hardware/sdr-table.jsx";
import AppSettingsForm from "./app-settings-form.jsx";


export function SettingsTabSatellites() {
    return (<SettingsTabs initialMainTab={"satellites"} initialTab={"satellites"}/>);
}

export function SettingsTabOrbitalSources() {
    return (<SettingsTabs initialMainTab={"satellites"} initialTab={"orbitalsources"}/>);
}

export const SettingsTabTLESources = SettingsTabOrbitalSources;

export function SettingsTabSatelliteGroups() {
    return (<SettingsTabs initialMainTab={"satellites"} initialTab={"groups"}/>);
}

export function SettingsTabPreferences() {
    return (
        <SettingsTabs
            initialMainTab={"settings"}
            initialTab={"settings"}
            initialSettingsSubTab={"preferences"}
        />
    );
}

export function SettingsTabIntegrations() {
    return (
        <SettingsTabs
            initialMainTab={"settings"}
            initialTab={"settings"}
            initialSettingsSubTab={"preferences"}
        />
    );
}

export function SettingsTabGeneral() {
    return (
        <SettingsTabs
            initialMainTab={"settings"}
            initialTab={"settings"}
            initialSettingsSubTab={"settings"}
        />
    );
}

export function SettingsTabLocation() {
    return (
        <SettingsTabs
            initialMainTab={"settings"}
            initialTab={"settings"}
            initialSettingsSubTab={"location"}
        />
    );
}

export function SettingsTabRig() {
    return (<SettingsTabs initialMainTab={"hardware"} initialTab={"rigcontrol"}/>);
}

export function SettingsTabRotator() {
    return (<SettingsTabs initialMainTab={"hardware"} initialTab={"rotatorcontrol"}/>);
}

export function SettingsTabSDR() {
    return (<SettingsTabs initialMainTab={"hardware"} initialTab={"sdrs"}/>);
}

export function SettingsTabMaintenance () {
    return (<SettingsTabs initialMainTab={"settings"} initialTab={"maintenance"}/>);
}


export function SettingsTabAbout () {
    return (<SettingsTabs initialMainTab={"settings"} initialTab={"about"}/>);
}

export function AdminSatellitesSourcesPage() {
    return (
        <AdminSatellitesPageLayout activeTab="sources">
            <OrbitalSourcesForm />
        </AdminSatellitesPageLayout>
    );
}

export function AdminSatellitesCatalogPage() {
    return (
        <AdminSatellitesPageLayout activeTab="catalog">
            <SatellitesForm />
        </AdminSatellitesPageLayout>
    );
}

export function AdminSatellitesGroupsPage() {
    return (
        <AdminSatellitesPageLayout activeTab="groups">
            <SatelliteGroupsForm />
        </AdminSatellitesPageLayout>
    );
}

export function UserPreferencesPage() {
    return (
        <Box sx={{ flexGrow: 1, bgcolor: 'background.paper' }}>
            <PreferencesForm />
        </Box>
    );
}

export function AdminSystemGeneralPage() {
    return (
        <AdminSystemPageLayout activeTab="general">
            <AppSettingsForm />
        </AdminSystemPageLayout>
    );
}

export function AdminSystemPreferencesPage() {
    return (
        <AdminSystemPageLayout activeTab="preferences">
            <PreferencesForm mode="preferences" />
        </AdminSystemPageLayout>
    );
}

export function AdminSystemLocationPage() {
    return (
        <AdminSystemPageLayout activeTab="location">
            <LocationPage />
        </AdminSystemPageLayout>
    );
}

export function AdminSystemHardwarePage() {
    return (
        <AdminSystemPageLayout activeTab="hardware">
            <AdminSystemHardwareTabs />
        </AdminSystemPageLayout>
    );
}

export function AdminSystemUsersPage() {
    return (
        <AdminSystemPageLayout activeTab="users">
            <UsersForm />
        </AdminSystemPageLayout>
    );
}

export function AdminSystemMaintenancePage() {
    return (
        <AdminSystemPageLayout activeTab="maintenance">
            <MaintenanceForm />
        </AdminSystemPageLayout>
    );
}

export function AdminSystemAboutPage() {
    return (
        <AdminSystemPageLayout activeTab="about">
            <AboutPage />
        </AdminSystemPageLayout>
    );
}

const ADMIN_SYSTEM_TABS = [
    { key: "general", labelKey: "tabs.general", defaultLabel: "General", path: "/admin/system/general" },
    { key: "location", labelKey: "tabs.location", defaultLabel: "Location", path: "/admin/system/location" },
    { key: "users", labelKey: "tabs.users", defaultLabel: "Users", path: "/admin/system/users" },
    { key: "hardware", labelKey: "tabs.hardware", defaultLabel: "Hardware", path: "/admin/system/hardware/sdrs" },
    { key: "maintenance", labelKey: "tabs.maintenance", defaultLabel: "Maintenance", path: "/admin/system/maintenance" },
    { key: "about", labelKey: "tabs.about", defaultLabel: "About", path: "/admin/system/about" },
];

const ADMIN_SATELLITES_TABS = [
    { key: "sources", labelKey: "tabs.orbital_sources", defaultLabel: "Orbital Data", path: "/admin/satellites/sources" },
    { key: "catalog", labelKey: "tabs.catalog", defaultLabel: "Catalog", path: "/admin/satellites/catalog" },
    { key: "groups", labelKey: "tabs.groups", defaultLabel: "Groups", path: "/admin/satellites/groups" },
];

const AdminSatellitesPageLayout = React.memo(function AdminSatellitesPageLayout({ activeTab, children }) {
    const { t } = useTranslation('settings');
    const navigate = useNavigate();

    const handleTabChange = (_event, nextTab) => {
        if (nextTab === activeTab) {
            return;
        }

        const tabDefinition = ADMIN_SATELLITES_TABS.find((tab) => tab.key === nextTab);
        if (tabDefinition) {
            navigate(tabDefinition.path);
        }
    };

    return (
        <Box sx={{ flexGrow: 1, bgcolor: 'background.paper' }}>
            <AntTabs
                value={activeTab}
                onChange={handleTabChange}
                aria-label={t('tabs.satellites')}
                scrollButtons={true}
                variant="scrollable"
                allowScrollButtonsMobile
                sx={getSettingsTabRowSx('detailRow')}
            >
                {ADMIN_SATELLITES_TABS.map((tab) => (
                    <AntTab
                        key={tab.key}
                        value={tab.key}
                        label={t(tab.labelKey, { defaultValue: tab.defaultLabel })}
                    />
                ))}
            </AntTabs>
            {children}
        </Box>
    );
});

const AdminSystemPageLayout = React.memo(function AdminSystemPageLayout({ activeTab, children }) {
    const { t } = useTranslation('settings');
    const navigate = useNavigate();

    const handleTabChange = (_event, nextTab) => {
        if (nextTab === activeTab) {
            return;
        }

        const tabDefinition = ADMIN_SYSTEM_TABS.find((tab) => tab.key === nextTab);
        if (tabDefinition) {
            navigate(tabDefinition.path);
        }
    };

    return (
        <Box sx={{ flexGrow: 1, bgcolor: 'background.paper' }}>
            <AntTabs
                value={activeTab}
                onChange={handleTabChange}
                aria-label={t('tabs.settings')}
                scrollButtons={true}
                variant="scrollable"
                allowScrollButtonsMobile
                sx={getSettingsTabRowSx('detailRow')}
            >
                {ADMIN_SYSTEM_TABS.map((tab) => (
                    <AntTab
                        key={tab.key}
                        value={tab.key}
                        label={t(tab.labelKey, { defaultValue: tab.defaultLabel })}
                    />
                ))}
            </AntTabs>
            {children}
        </Box>
    );
});

const tabsTree = {
    "hardware": ["rigcontrol", "rotatorcontrol", "sdrs"],
    "satellites": ["satellites", "orbitalsources", "groups"],
    "settings": ["settings", "maintenance", "users", "about"],
};

function getTabCategory(value) {
    for (const [key, values] of Object.entries(tabsTree)) {
        if (values.includes(value)) {
            return key;
        }
    }
    return null;
}

function getSettingsTabRowSx(rowKey) {
    return (theme) => {
        const isDark = theme.palette.mode === 'dark';
        const fallbackRows = isDark
            ? {
                mainRow: { background: '#2b3036', selected: '#394049' },
                subRow: { background: '#272c32', selected: '#353c45' },
                detailRow: { background: '#24292f', selected: '#323942' },
            }
            : {
                mainRow: { background: '#e6ebf3', selected: '#f4f7fb' },
                subRow: { background: '#eaf0f7', selected: '#f7f9fc' },
                detailRow: { background: '#edf2f8', selected: '#ffffff' },
            };

        const rowTheme = theme.palette.settingsTabs?.[rowKey] || {};
        const rowFallback = fallbackRows[rowKey] || fallbackRows.subRow;
        const borderColor = theme.palette.settingsTabs?.border
            || (isDark ? '#50565f' : '#c5cfdd');

        return {
            backgroundColor: rowTheme.background || rowFallback.background,
            borderBottom: `1px solid ${borderColor}`,
            '& .MuiTabs-indicator': {
                display: 'none',
            },
            '& .MuiTab-root': {
                color: theme.palette.text.secondary,
                transition: 'background-color 140ms ease, color 140ms ease',
            },
            '& .MuiTab-root.Mui-selected': {
                backgroundColor: rowTheme.selected || rowFallback.selected,
                color: theme.palette.text.primary,
            },
            [`& .${tabsClasses.scrollButtons}`]: {
                '&.Mui-disabled': { opacity: 0.3 },
            },
        };
    };
}

export const SettingsTabs = React.memo(function SettingsTabs({
    initialMainTab,
    initialTab,
    initialSettingsSubTab = "settings",
}) {
    const { t } = useTranslation('settings');
    const location = useLocation();

    const getTabFromPath = (pathname) => {
        switch (pathname) {
            case "/hardware/rig":
            case "/hardware/rigs":
                return "rigcontrol";
            case "/hardware/rotator":
            case "/hardware/rotators":
                return "rotatorcontrol";
            case "/hardware/sdrs":
                return "sdrs";
            case "/satellites/orbital-sources":
            case "/satellites/sources":
            case "/satellites/tlesources":
                return "orbitalsources";
            case "/satellites/satellites":
            case "/satellites/catalog":
                return "satellites";
            case "/satellites/groups":
                return "groups";
            case "/settings/backend":
            case "/settings/general":
            case "/settings/settings":
                return "settings";
            case "/settings/preferences":
                return "settings";
            case "/settings/location":
                // Keep /settings/location as a deep link, but render it inside the Settings tab group.
                return "settings";
            case "/settings/maintenance":
                return "maintenance";
            case "/settings/about":
                return "about";
            default:
                return initialTab;
        }
    };

    const activeTab = getTabFromPath(location.pathname);
    const activeMainTab = getTabCategory(activeTab) ?? initialMainTab;

    let tabsList = [];
    // Define arrays of tabs for each main category
    switch (activeMainTab) {
        case "hardware":
            tabsList = [
                <AntTab key="sdrs" value="sdrs" label={t('tabs.sdrs')} to="/hardware/sdrs" component={Link}/>,
                <AntTab key="rigcontrol" value="rigcontrol" label={t('tabs.rigs')} to="/hardware/rigs" component={Link} />,
                <AntTab key="rotatorcontrol" value="rotatorcontrol" label={t('tabs.rotators')} to="/hardware/rotators" component={Link} />,
            ];
            break;
        case "satellites":
            tabsList = [
                <AntTab key="orbitalsources" value="orbitalsources" label={t('tabs.orbital_sources')} to="/satellites/sources" component={Link} />,
                <AntTab key="satellites" value="satellites" label={t('tabs.catalog', { defaultValue: 'Catalog' })} to="/satellites/catalog" component={Link} />,
                <AntTab key="groups" value="groups" label={t('tabs.groups')} to="/satellites/groups" component={Link} />,
            ];
            break;
        case "settings":
            tabsList = [
                <AntTab key="settings" value="settings" label={t('tabs.general', { defaultValue: 'General' })} to="/settings/general" component={Link} />,
                // <AntTab key="users" value="users" label="Users" to="/settings/users" component={Link} />,
                <AntTab key="maintenance" value="maintenance" label={t('tabs.maintenance')} to="/settings/maintenance" component={Link} />,
                <AntTab key="about" value="about" label={t('tabs.about')} to="/settings/about" component={Link} />,
            ];
            break;
        default:
            console.log("Unknown main tab: " + activeMainTab);
    }

    const tabObject = <AntTabs
        sx={getSettingsTabRowSx('subRow')}
        value={activeTab}
        aria-label={t('tabs.configuration_tabs')}
        scrollButtons={true}
        variant="scrollable"
        allowScrollButtonsMobile
    >
        {tabsList}
    </AntTabs>;

    let activeTabContent = null;

    switch (activeTab) {
        case "settings":
            activeTabContent = (
                <SettingsAndPreferencesForm
                    initialSubTab={
                        location.pathname === "/settings/preferences"
                            ? "preferences"
                            : location.pathname === "/settings/location"
                                    ? "location"
                                : initialSettingsSubTab
                    }
                />
            );
            break;
        case "rigcontrol":
            activeTabContent = <RigControlForm/>;
            break;
        case "rotatorcontrol":
            activeTabContent = <RotatorControlForm/>;
            break;
        case "sdrs":
            activeTabContent = <SDRsPage/>;
            break;
        case "orbitalsources":
            activeTabContent = <OrbitalSourcesForm/>;
            break;
        case "satellites":
            activeTabContent = <SatellitesForm/>;
            break;
        case "groups":
            activeTabContent = <SatelliteGroupsForm/>;
            break;
        case "maintenance":
            activeTabContent = <MaintenanceForm/>;
            break;
        case "about":
            activeTabContent = <AboutPage/>;
            break;
        default:
            break;
    }

    return (
         <Box sx={{ flexGrow: 1, bgcolor: 'background.paper' }}>
             <AntTabs
                 sx={getSettingsTabRowSx('mainRow')}
                 value={activeMainTab}
                 aria-label={t('tabs.main_settings_tabs')}
                 scrollButtons={true}
                 variant="fullWidth"
                 allowScrollButtonsMobile
             >
                 <AntTab value={"hardware"} label={t('tabs.hardware')} to="/hardware/sdrs" component={Link}/>
                 <AntTab value={"satellites"} label={t('tabs.satellites')} to="/satellites/catalog" component={Link}/>
                 <AntTab value={"settings"} label={t('tabs.settings')} to="/settings/general" component={Link}/>
             </AntTabs>
             {tabObject}
             {activeTabContent}
         </Box>
    );
});

const RotatorControlForm = () => {

    return (
        <AntennaRotatorTable/>
    );
};


const RigControlForm = () => {

    return (
        <RigTable/>
    );
};

const SatellitesForm = () => {

    return (
        <Paper elevation={3} sx={{ padding: 2, marginTop: 0, borderRadius: 0}} variant="elevation">
            <SatelliteTable/>
        </Paper>);
};

const SatelliteGroupsForm = () => {

    return (
        <Paper elevation={3} sx={{ padding: 2, marginTop: 0, borderRadius: 0}} variant="elevation">
            <SatelliteGroupsTable/>
        </Paper>);
};

const OrbitalSourcesForm = () => {

    return (
        <Paper elevation={3} sx={{ pb: 2, pt: 0, marginTop: 0, borderRadius: 0}} variant="elevation">
            <SourcesTable/>
        </Paper>);
};

const AdminSystemHardwareTabs = React.memo(function AdminSystemHardwareTabs() {
    const { t } = useTranslation('settings');
    const location = useLocation();
    const navigate = useNavigate();

    const resolveHardwareTabFromPath = React.useCallback((pathname) => {
        if (pathname === "/admin/system/hardware/rotators") return "rotators";
        if (pathname === "/admin/system/hardware/sdrs") return "sdrs";
        return "rigs";
    }, []);

    const [activeTab, setActiveTab] = React.useState(() => resolveHardwareTabFromPath(location.pathname));

    React.useEffect(() => {
        setActiveTab(resolveHardwareTabFromPath(location.pathname));
    }, [location.pathname, resolveHardwareTabFromPath]);

    const handleTabChange = (_event, nextTab) => {
        if (nextTab === activeTab) {
            return;
        }
        navigate(`/admin/system/hardware/${nextTab}`);
    };

    let content = null;
    switch (activeTab) {
        case "rotators":
            content = <RotatorControlForm />;
            break;
        case "sdrs":
            content = <SDRsPage />;
            break;
        case "rigs":
        default:
            content = <RigControlForm />;
            break;
    }

    return (
        <Box sx={{ flexGrow: 1, bgcolor: 'background.paper' }}>
            <AntTabs
                value={activeTab}
                onChange={handleTabChange}
                aria-label={t('tabs.hardware')}
                scrollButtons={true}
                variant="scrollable"
                allowScrollButtonsMobile
                sx={getSettingsTabRowSx('detailRow')}
            >
                <AntTab key="sdrs" value="sdrs" label={t('tabs.sdrs')} />
                <AntTab key="rigs" value="rigs" label={t('tabs.rigs')} />
                <AntTab key="rotators" value="rotators" label={t('tabs.rotators')} />
            </AntTabs>
            {content}
        </Box>
    );
});

const SettingsAndPreferencesForm = React.memo(function SettingsAndPreferencesForm({ initialSubTab }) {
    const { t } = useTranslation('settings');
    const location = useLocation();
    const navigate = useNavigate();

    const resolveSubTabFromPath = React.useCallback((pathname) => {
        if (pathname === "/settings/backend") return "settings";
        if (pathname === "/settings/general") return "settings";
        // Backward-compatible alias for older deep links.
        if (pathname === "/settings/settings") return "settings";
        if (pathname === "/settings/preferences") return "preferences";
        if (pathname === "/settings/location") return "location";
        return "settings";
    }, []);

    const [activeSubTab, setActiveSubTab] = React.useState(() => initialSubTab || "settings");

    React.useEffect(() => {
        setActiveSubTab(resolveSubTabFromPath(location.pathname));
    }, [location.pathname, resolveSubTabFromPath]);

    React.useEffect(() => {
        if (!initialSubTab) {
            return;
        }
        setActiveSubTab(initialSubTab);
    }, [initialSubTab]);

    const handleTabChange = (_event, nextTab) => {
        if (nextTab === activeSubTab) {
            return;
        }

        let nextPath = "/settings/general";
        if (nextTab === "preferences") {
            nextPath = "/settings/preferences";
        } else if (nextTab === "location") {
            nextPath = "/settings/location";
        }
        navigate(nextPath);
    };

    return (
        <Box sx={{ flexGrow: 1, bgcolor: 'background.paper' }}>
            <AntTabs
                value={activeSubTab}
                onChange={handleTabChange}
                aria-label={t('tabs.configuration_tabs')}
                scrollButtons={true}
                variant="scrollable"
                allowScrollButtonsMobile
                sx={getSettingsTabRowSx('detailRow')}
            >
                <AntTab key="preferences" value="preferences" label={t('tabs.preferences')} />
                <AntTab key="location" value="location" label={t('tabs.location')} />
                <AntTab key="settings" value="settings" label={t('tabs.general', { defaultValue: 'General' })} />
            </AntTabs>
            {activeSubTab === "preferences" ? <PreferencesForm /> : null}
            {activeSubTab === "location" ? <LocationPage/> : null}
            {activeSubTab === "settings" ? <AppSettingsForm/> : null}
        </Box>
    );
});
