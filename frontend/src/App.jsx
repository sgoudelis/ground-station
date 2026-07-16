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

import * as React from 'react';
import { Outlet } from "react-router";
import { ReactRouterAppProvider } from "@toolpad/core/react-router";
import { CssBaseline } from '@mui/material';
import { ThemeProvider } from '@mui/material/styles';
import { setupTheme } from './theme.js';
import { useSocket } from "./components/common/socket.jsx";
import { AudioProvider } from "./components/dashboard/audio-provider.jsx";
import { WaterfallEngineProvider } from './components/waterfall/waterfall-engine-provider.jsx';
import { ToastContainerWithStyles } from "./utils/toast-container.jsx";
import { getNavigation } from "./config/navigation.jsx";
import { BRANDING } from "./config/branding.jsx";
import { useSocketEventHandlers } from "./hooks/useSocketEventHandlers.jsx";
import { usePassFetching } from "./hooks/usePassFetching.jsx";
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { loadAuthStatus } from './components/auth/auth-slice.jsx';
import { resetRuntimeSessionState } from './components/dashboard/dashboard-slice.jsx';
import ConnectionOverlay from './components/dashboard/reconnecting-overlay.jsx';
import { LoginScreen, SetupScreen } from './components/auth/screens.jsx';

export default function App() {
    const dispatch = useDispatch();
    const { socket, handleAuthEpochChange } = useSocket();
    const { i18n } = useTranslation();
    const preferences = useSelector((state) => state.preferences.preferences);
    const authState = useSelector((state) => state.auth);
    const dashboardRuntimeState = useSelector((state) => state.dashboard);
    const authUserRole = String(authState?.user?.role || '').toLowerCase();
    const isAdmin = authUserRole === 'admin';
    const [systemTheme, setSystemTheme] = React.useState('dark');
    const navigation = React.useMemo(
        () => getNavigation({ isAdmin }),
        [isAdmin, i18n.language],
    );

    // Get theme preference and create theme
    const themePreference = preferences.find(pref => pref.name === 'theme');
    const themeMode = themePreference ? themePreference.value : 'dark';
    const [sessionBootstrapped, setSessionBootstrapped] = React.useState(false);
    const [awaitingRuntimeReset, setAwaitingRuntimeReset] = React.useState(false);
    const socketAuthEpoch = React.useMemo(() => {
        if (authState.setupRequired) {
            return 'setup';
        }
        if (authState.authenticated) {
            return `session:${authState.user?.user_id || authState.user?.id || 'active'}`;
        }
        return 'anonymous';
    }, [authState.setupRequired, authState.authenticated, authState.user?.user_id, authState.user?.id]);

    // Listen for system theme changes when 'auto' is selected
    React.useEffect(() => {
        if (themeMode !== 'auto') return;

        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const handleChange = (e) => {
            setSystemTheme(e.matches ? 'dark' : 'light');
        };

        // Set initial value
        setSystemTheme(mediaQuery.matches ? 'dark' : 'light');

        // Listen for changes
        mediaQuery.addEventListener('change', handleChange);

        return () => {
            mediaQuery.removeEventListener('change', handleChange);
        };
    }, [themeMode]);

    const dashboardTheme = React.useMemo(() => setupTheme(themeMode), [themeMode, systemTheme]);

    React.useEffect(() => {
        if (authState.statusInitialized) {
            return;
        }
        dispatch(loadAuthStatus());
    }, [dispatch, authState.statusInitialized]);

    React.useEffect(() => {
        // Reset dashboard runtime connection/data flags whenever auth context changes.
        // This avoids a stale dashboard frame from a previous session during logout/login.
        dispatch(resetRuntimeSessionState());
        setSessionBootstrapped(false);
        setAwaitingRuntimeReset(true);
    }, [dispatch, socketAuthEpoch]);

    React.useEffect(() => {
        handleAuthEpochChange(socketAuthEpoch);
    }, [socketAuthEpoch, handleAuthEpochChange]);

    // Sync language from Redux to i18n on mount and when it changes
    React.useEffect(() => {
        const languagePref = preferences.find(pref => pref.name === 'language');
        if (languagePref && languagePref.value) {
            const languageCode = languagePref.value.split('_')[0]; // 'en_US' -> 'en', 'el_GR' -> 'el'
            if (i18n.language !== languageCode) {
                i18n.changeLanguage(languageCode);
            }
        }
    }, [preferences, i18n]);

    const appRuntimeEnabled = !authState.setupRequired && authState.authenticated;
    const dashboardRuntimeReady =
        (dashboardRuntimeState?.connected ?? false) &&
        !(dashboardRuntimeState?.initialDataLoading ?? false);

    useSocketEventHandlers(socket, appRuntimeEnabled);
    usePassFetching(socket, appRuntimeEnabled);

    React.useEffect(() => {
        if (!authState.authenticated || authState.setupRequired) {
            setSessionBootstrapped(false);
            setAwaitingRuntimeReset(false);
            return;
        }

        // Require one fresh "not ready" runtime state after auth-context change before
        // allowing the dashboard to become bootstrapped. This blocks stale
        // connected/data-ready flags from the previous session.
        if (awaitingRuntimeReset) {
            if (!dashboardRuntimeReady) {
                setAwaitingRuntimeReset(false);
            }
            return;
        }

        if (dashboardRuntimeReady) {
            setSessionBootstrapped(true);
        }
    }, [authState.authenticated, authState.setupRequired, dashboardRuntimeReady, awaitingRuntimeReset]);

    const renderPreAuth = (content) => (
        <ThemeProvider theme={dashboardTheme}>
            <CssBaseline />
            {content}
        </ThemeProvider>
    );

    const showBootstrapLoader = !authState.statusInitialized && authState.loadingStatus;

    if (showBootstrapLoader) {
        return renderPreAuth(<ConnectionOverlay />);
    }

    if (authState.setupRequired) {
        return renderPreAuth(
            <>
                <SetupScreen />
                <ToastContainerWithStyles />
            </>
        );
    }

    if (!authState.authenticated) {
        return renderPreAuth(
            <>
                <LoginScreen />
                <ToastContainerWithStyles />
            </>
        );
    }

    if (!sessionBootstrapped) {
        return renderPreAuth(<ConnectionOverlay />);
    }

    return (
        <AudioProvider>
            <WaterfallEngineProvider>
                <ReactRouterAppProvider
                    key={`app-provider-${i18n.language}`}
                    navigation={navigation}
                    theme={dashboardTheme}
                    branding={BRANDING}
                >
                    <Outlet/>
                </ReactRouterAppProvider>
            </WaterfallEngineProvider>
            <ToastContainerWithStyles />
        </AudioProvider>
    );
}
