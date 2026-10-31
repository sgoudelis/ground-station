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


import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n/config.js'
import {createBrowserRouter, Navigate, RouterProvider, useParams} from "react-router";
import App from "./App.jsx";
import Layout from "./components/dashboard/dashboard-layout.jsx";
import {SocketProvider} from './components/common/socket.jsx';
import { Provider as ReduxProvider} from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { store, persistor } from './components/common/store.jsx';
import ErrorPage from './components/common/error-page.jsx';
import NotFoundPage from './components/common/not-found-page.jsx';
import {WakeLockProvider} from "./components/dashboard/wake-lock-provider.jsx";

const enableStrictMode = import.meta.env.VITE_REACT_STRICT_MODE !== 'false';

// Route-level code splitting. Each page's module graph is fetched the first
// time its route is visited, so the shell ships a much smaller bundle and a
// navigation only evaluates the code it needs. React Router awaits the import
// before committing the route, so no Suspense fallback is required.
const lazyPage = (load) => async () => ({ Component: (await load()).default });
const lazySettingsPage = (exportName) => async () => ({
    Component: (await import("./components/settings/settings.jsx"))[exportName],
});
const pages = {
    earthView: lazyPage(() => import("./components/earthview/main-layout.jsx")),
    tracking: lazyPage(() => import("./components/target/main-layout.jsx")),
    waterfall: lazyPage(() => import("./components/waterfall/main-layout.jsx")),
    files: lazyPage(() => import("./components/filebrowser/filebrowser-main.jsx")),
    scheduler: lazyPage(() => import("./components/scheduler/main-layout.jsx")),
    solarSystem: lazyPage(() => import("./components/celestial/main-layout.jsx")),
    satelliteInfo: lazyPage(() => import("./components/satellites/satellite-info-page.jsx")),
    accountTokens: async () => {
        const [{ UserAccountPageLayout }, { default: ApiTokensPage }] = await Promise.all([
            import("./components/settings/settings.jsx"),
            import("./components/auth/tokens.jsx"),
        ]);
        return { element: <UserAccountPageLayout activeTab="tokens"><ApiTokensPage /></UserAccountPageLayout> };
    },
};

function LegacySatellitePathRedirect() {
    const { noradId } = useParams();
    return <Navigate to={`/satellites/${noradId}`} replace />;
}

const router = createBrowserRouter([
    {
        Component: App, // root layout route
        errorElement: <ErrorPage />,
        children: [
            {
                path: "/",
                Component: Layout,
                errorElement: <ErrorPage />,
                children: [
                    {
                        index: true,
                        // Canonical landing page is /earthview; keep / as a stable entry point.
                        element: <Navigate to="/earthview" replace />,
                    },
                    {
                        path: "earthview",
                        lazy: pages.earthView,
                    },
                    {
                        path: "tracking",
                        lazy: pages.tracking,
                    },
                    {
                        // Backward-compatible alias for older links/bookmarks.
                        path: "track",
                        element: <Navigate to="/tracking" replace />,
                    },
                    {
                        path: "waterfall",
                        lazy: pages.waterfall,
                    },
                    {
                        path: "files",
                        lazy: pages.files,
                    },
                    {
                        // Backward-compatible alias for older links/bookmarks.
                        path: "filebrowser",
                        element: <Navigate to="/files" replace />,
                    },
                    {
                        path: "scheduler",
                        lazy: pages.scheduler,
                    },
                    {
                        path: "preferences",
                        lazy: lazySettingsPage("UserPreferencesPage"),
                    },
                    {
                        path: "account/tokens",
                        lazy: pages.accountTokens,
                    },
                    {
                        path: "solarsystem",
                        lazy: pages.solarSystem,
                    },
                    {
                        // Backward-compatible alias for older links/bookmarks.
                        path: "celestial",
                        element: <Navigate to="/solarsystem" replace />,
                    },
                    {
                        path: "satellites/:noradId",
                        lazy: pages.satelliteInfo,
                    },
                    {
                        // Backward-compatible alias for older links/bookmarks.
                        path: "satellite/:noradId",
                        Component: LegacySatellitePathRedirect,
                    },
                    {
                        path: "admin",
                        children: [
                            {
                                index: true,
                                element: <Navigate to="/admin/system/general" replace />,
                            },
                            {
                                path: "hardware",
                                children: [
                                    {
                                        index: true,
                                        element: <Navigate to="/admin/system/hardware/sdrs" replace />,
                                    },
                                    {
                                        path: "rigs",
                                        element: <Navigate to="/admin/system/hardware/rigs" replace />,
                                    },
                                    {
                                        path: "rotators",
                                        element: <Navigate to="/admin/system/hardware/rotators" replace />,
                                    },
                                    {
                                        path: "sdrs",
                                        element: <Navigate to="/admin/system/hardware/sdrs" replace />,
                                    },
                                ],
                            },
                            {
                                path: "satellites",
                                children: [
                                    {
                                        index: true,
                                        element: <Navigate to="/admin/satellites/orbital-data" replace />,
                                    },
                                    {
                                        path: "orbital-data",
                                        lazy: lazySettingsPage("AdminSatellitesOrbitalDataPage"),
                                    },
                                    {
                                        path: "sources",
                                        lazy: lazySettingsPage("AdminSatellitesSourcesPage"),
                                    },
                                    {
                                        path: "catalog",
                                        lazy: lazySettingsPage("AdminSatellitesCatalogPage"),
                                    },
                                    {
                                        path: "groups",
                                        lazy: lazySettingsPage("AdminSatellitesGroupsPage"),
                                    },
                                ],
                            },
                            {
                                path: "celestial",
                                children: [
                                    {
                                        index: true,
                                        element: <Navigate to="/admin/celestial/catalog" replace />,
                                    },
                                    {
                                        path: "ephemeris",
                                        lazy: lazySettingsPage("AdminCelestialEphemerisPage"),
                                    },
                                    {
                                        path: "catalog",
                                        lazy: lazySettingsPage("AdminCelestialCatalogPage"),
                                    },
                                    {
                                        path: "targets",
                                        element: <Navigate to="/admin/celestial/catalog" replace />,
                                    },
                                ],
                            },
                            {
                                path: "system",
                                children: [
                                    {
                                        index: true,
                                        element: <Navigate to="/admin/system/general" replace />,
                                    },
                                    {
                                        path: "general",
                                        lazy: lazySettingsPage("AdminSystemGeneralPage"),
                                    },
                                    {
                                        path: "preferences",
                                        element: <Navigate to="/preferences" replace />,
                                    },
                                    {
                                        path: "integrations",
                                        element: <Navigate to="/preferences" replace />,
                                    },
                                    {
                                        path: "location",
                                        lazy: lazySettingsPage("AdminSystemLocationPage"),
                                    },
                                    {
                                        path: "users",
                                        lazy: lazySettingsPage("AdminSystemUsersPage"),
                                    },
                                    {
                                        path: "hardware",
                                        children: [
                                            {
                                                index: true,
                                                element: <Navigate to="/admin/system/hardware/sdrs" replace />,
                                            },
                                            {
                                                path: "rigs",
                                                lazy: lazySettingsPage("AdminSystemHardwarePage"),
                                            },
                                            {
                                                path: "rotators",
                                                lazy: lazySettingsPage("AdminSystemHardwarePage"),
                                            },
                                            {
                                                path: "sdrs",
                                                lazy: lazySettingsPage("AdminSystemHardwarePage"),
                                            },
                                        ],
                                    },
                                    {
                                        path: "maintenance",
                                        lazy: lazySettingsPage("AdminSystemMaintenancePage"),
                                    },
                                    {
                                        path: "about",
                                        lazy: lazySettingsPage("AdminSystemAboutPage"),
                                    },
                                ],
                            },
                        ],
                    },
                    {
                        path: "satellites",
                        children: [
                            {
                                index: true,
                                element: <Navigate to="/admin/satellites/catalog" replace />,
                            },
                            {
                                path: "sources",
                                element: <Navigate to="/admin/satellites/sources" replace />,
                            },
                            {
                                // Backward-compatible aliases for older links/bookmarks.
                                path: "orbital-sources",
                                element: <Navigate to="/admin/satellites/sources" replace />,
                            },
                            {
                                // Backward-compatible aliases for older links/bookmarks.
                                path: "tlesources",
                                element: <Navigate to="/admin/satellites/sources" replace />,
                            },
                            {
                                path: "catalog",
                                element: <Navigate to="/admin/satellites/catalog" replace />,
                            },
                            {
                                // Backward-compatible alias for older links/bookmarks.
                                path: "satellites",
                                element: <Navigate to="/admin/satellites/catalog" replace />,
                            },
                            {
                                path: "groups",
                                element: <Navigate to="/admin/satellites/groups" replace />,
                            },
                        ],
                    },
                    {
                        path: "settings",
                        children: [
                            {
                                index: true,
                                element: <Navigate to="/admin/system/general" replace />,
                            },
                            {
                                path: "general",
                                element: <Navigate to="/admin/system/general" replace />,
                            },
                            {
                                // Backward-compatible alias for older links/bookmarks.
                                path: "backend",
                                element: <Navigate to="/admin/system/general" replace />,
                            },
                            {
                                // Backward-compatible alias for older links/bookmarks.
                                path: "settings",
                                element: <Navigate to="/admin/system/general" replace />,
                            },
                            {
                                path: "preferences",
                                element: <Navigate to="/preferences" replace />,
                            },
                            {
                                path: "integrations",
                                element: <Navigate to="/preferences" replace />,
                            },
                            {
                                path: "location",
                                element: <Navigate to="/admin/system/location" replace />,
                            },
                            {
                                path: "users",
                                element: <Navigate to="/admin/system/users" replace />,
                            },
                            {
                                path: "maintenance",
                                element: <Navigate to="/admin/system/maintenance" replace />,
                            },
                            {
                                path: "about",
                                element: <Navigate to="/admin/system/about" replace />,
                            },
                        ],
                    },
                    {
                        path: "hardware",
                        children: [
                            {
                                index: true,
                                element: <Navigate to="/admin/system/hardware/sdrs" replace />,
                            },
                            {
                                path: "rigs",
                                element: <Navigate to="/admin/system/hardware/rigs" replace />,
                            },
                            {
                                // Backward-compatible alias for older links/bookmarks.
                                path: "rig",
                                element: <Navigate to="/admin/system/hardware/rigs" replace />,
                            },
                            {
                                path: "rotators",
                                element: <Navigate to="/admin/system/hardware/rotators" replace />,
                            },
                            {
                                // Backward-compatible alias for older links/bookmarks.
                                path: "rotator",
                                element: <Navigate to="/admin/system/hardware/rotators" replace />,
                            },
                            {
                                path: "sdrs",
                                element: <Navigate to="/admin/system/hardware/sdrs" replace />,
                            },
                        ],
                    },
                    {
                        path: "*",
                        Component: NotFoundPage,
                    },
                ],
            },
        ],
    },
]);

const app = (
    <ReduxProvider store={store}>
        <PersistGate loading={null} persistor={persistor}>
            <SocketProvider>
                <WakeLockProvider>
                    <RouterProvider router={router} />
                </WakeLockProvider>
            </SocketProvider>
        </PersistGate>
    </ReduxProvider>
);

createRoot(document.getElementById('root')).render(
    enableStrictMode ? <StrictMode>{app}</StrictMode> : app
);
