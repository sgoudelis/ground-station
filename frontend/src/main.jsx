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
import {
    AdminSatellitesCatalogPage,
    AdminSatellitesGroupsPage,
    AdminSatellitesSourcesPage,
    AdminSystemAboutPage,
    AdminSystemGeneralPage,
    AdminSystemHardwarePage,
    AdminSystemLocationPage,
    AdminSystemMaintenancePage,
    AdminSystemUsersPage,
    UserPreferencesPage,
} from "./components/settings/settings.jsx";
import EarthViewLayout from "./components/earthview/main-layout.jsx";
import App from "./App.jsx";
import Layout from "./components/dashboard/dashboard-layout.jsx";
import TrackingLayout from "./components/target/main-layout.jsx";
import {SocketProvider} from './components/common/socket.jsx';
import { Provider as ReduxProvider} from 'react-redux';
import { PersistGate } from 'redux-persist/integration/react';
import { store, persistor } from './components/common/store.jsx';
import ErrorPage from './components/common/error-page.jsx';
import NotFoundPage from './components/common/not-found-page.jsx';
import MainLayout from "./components/waterfall/main-layout.jsx";
import {WakeLockProvider} from "./components/dashboard/wake-lock-provider.jsx";
import SatelliteInfoPage from "./components/satellites/satellite-info-page.jsx";
import FileBrowserMain from "./components/filebrowser/filebrowser-main.jsx";
import ScheduledObservationsLayout from "./components/scheduler/main-layout.jsx";
import CelestialMainLayout from "./components/celestial/main-layout.jsx";

const enableStrictMode = import.meta.env.VITE_REACT_STRICT_MODE !== 'false';

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
                        Component: EarthViewLayout,
                    },
                    {
                        path: "tracking",
                        Component: TrackingLayout,
                    },
                    {
                        // Backward-compatible alias for older links/bookmarks.
                        path: "track",
                        element: <Navigate to="/tracking" replace />,
                    },
                    {
                        path: "waterfall",
                        Component: MainLayout,
                    },
                    {
                        path: "files",
                        Component: FileBrowserMain,
                    },
                    {
                        // Backward-compatible alias for older links/bookmarks.
                        path: "filebrowser",
                        element: <Navigate to="/files" replace />,
                    },
                    {
                        path: "scheduler",
                        Component: ScheduledObservationsLayout,
                    },
                    {
                        path: "preferences",
                        Component: UserPreferencesPage,
                    },
                    {
                        path: "solarsystem",
                        Component: CelestialMainLayout,
                    },
                    {
                        // Backward-compatible alias for older links/bookmarks.
                        path: "celestial",
                        element: <Navigate to="/solarsystem" replace />,
                    },
                    {
                        path: "satellites/:noradId",
                        Component: SatelliteInfoPage,
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
                                        element: <Navigate to="/admin/satellites/catalog" replace />,
                                    },
                                    {
                                        path: "sources",
                                        Component: AdminSatellitesSourcesPage,
                                    },
                                    {
                                        path: "catalog",
                                        Component: AdminSatellitesCatalogPage,
                                    },
                                    {
                                        path: "groups",
                                        Component: AdminSatellitesGroupsPage,
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
                                        Component: AdminSystemGeneralPage,
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
                                        Component: AdminSystemLocationPage,
                                    },
                                    {
                                        path: "users",
                                        Component: AdminSystemUsersPage,
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
                                                Component: AdminSystemHardwarePage,
                                            },
                                            {
                                                path: "rotators",
                                                Component: AdminSystemHardwarePage,
                                            },
                                            {
                                                path: "sdrs",
                                                Component: AdminSystemHardwarePage,
                                            },
                                        ],
                                    },
                                    {
                                        path: "maintenance",
                                        Component: AdminSystemMaintenancePage,
                                    },
                                    {
                                        path: "about",
                                        Component: AdminSystemAboutPage,
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
