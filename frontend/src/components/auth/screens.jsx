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
import CloudOffIcon from '@mui/icons-material/CloudOff';
import SyncProblemIcon from '@mui/icons-material/SyncProblem';
import { keyframes } from '@emotion/react';
import {
    Alert,
    Box,
    Button,
    Card,
    CardContent,
    Checkbox,
    CircularProgress,
    Dialog,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    Stack,
    TextField,
    Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useDispatch, useSelector } from 'react-redux';

import { GroundStationLogoGreenBlue } from '../common/dataurl-icons.jsx';
import { useSocket } from '../common/socket.jsx';
import { fetchLocationForUserId } from '../settings/location-slice.jsx';
import LocationPage from '../settings/location-form.jsx';
import { loadAuthStatus, loginUser, setupAdmin } from './auth-slice.jsx';

const shellSx = {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    p: 2.5,
    bgcolor: 'background.default',
};

const cardSx = {
    width: '100%',
    maxWidth: 500,
    border: (theme) => `1px solid ${theme.palette.border?.main || theme.palette.divider}`,
    boxShadow: (theme) =>
        theme.palette.mode === 'dark'
            ? '0 20px 46px rgba(0, 0, 0, 0.42)'
            : '0 20px 46px rgba(15, 23, 42, 0.16)',
};

const loginCardSx = {
    ...cardSx,
    maxWidth: 350,
};

const stationPanelSx = {
    p: 1.25,
    borderRadius: 1,
    border: (theme) => `1px solid ${theme.palette.divider}`,
    backgroundColor: (theme) =>
        alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.14 : 0.08),
};

const fadeIn = keyframes`
    from {
        opacity: 0;
        transform: translateY(10px);
    }
    to {
        opacity: 1;
        transform: translateY(0);
    }
`;

const progressSweep = keyframes`
    0% { transform: translateX(-100%); }
    100% { transform: translateX(333%); }
`;

function normalizeStationIdentity(station) {
    if (!station || typeof station !== 'object') {
        return { name: null, callsign: null };
    }
    const name = String(station.name || '').trim() || null;
    const callsign = String(station.callsign || '').trim().toUpperCase() || null;
    return { name, callsign };
}

function StationIdentityPanel({ station, showCallsign = true }) {
    const { name, callsign } = normalizeStationIdentity(station);
    if (!name && (!showCallsign || !callsign)) {
        return null;
    }

    return (
        <Box sx={stationPanelSx}>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.25 }}>
                Ground Station
            </Typography>
            {name && (
                <Typography variant="body2" fontWeight={600}>
                    {name}
                </Typography>
            )}
            {showCallsign && callsign && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    Callsign: {callsign}
                </Typography>
            )}
        </Box>
    );
}

function AuthCardHeader({ title, description }) {
    return (
        <Stack direction="row" spacing={1.5} alignItems="center">
            <Box
                component="img"
                src={GroundStationLogoGreenBlue}
                alt="Ground Station"
                sx={{ width: 44, height: 44, objectFit: 'contain' }}
            />
            <Box>
                <Typography variant="h5" fontWeight={650}>
                    {title}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.35 }}>
                    {description}
                </Typography>
            </Box>
        </Stack>
    );
}

export function AdminRegistrationForm({ title, description, station }) {
    const dispatch = useDispatch();
    const { loadingAction, error } = useSelector((state) => state.auth);

    const [username, setUsername] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [confirmPassword, setConfirmPassword] = React.useState('');
    const [localError, setLocalError] = React.useState('');

    const handleSubmit = async (event) => {
        event.preventDefault();
        setLocalError('');

        if (!username.trim()) {
            setLocalError('Username is required.');
            return;
        }
        if (password.length < 8) {
            setLocalError('Password must be at least 8 characters long.');
            return;
        }
        if (password !== confirmPassword) {
            setLocalError('Passwords do not match.');
            return;
        }

        await dispatch(
            setupAdmin({
                username: username.trim(),
                password,
            })
        );
    };

    return (
        <Card sx={cardSx}>
            <CardContent sx={{ p: 3 }}>
                <Stack spacing={2}>
                    <AuthCardHeader title={title} description={description} />
                    <StationIdentityPanel station={station} />

                    {(localError || error) && (
                        <Alert severity="error">{localError || error}</Alert>
                    )}

                    <Box component="form" onSubmit={handleSubmit}>
                        <Stack spacing={2}>
                            <TextField
                                label="Username"
                                value={username}
                                onChange={(event) => setUsername(event.target.value)}
                                required
                                autoComplete="username"
                            />
                            <TextField
                                label="Password"
                                type="password"
                                value={password}
                                onChange={(event) => setPassword(event.target.value)}
                                required
                                autoComplete="new-password"
                            />
                            <TextField
                                label="Confirm password"
                                type="password"
                                value={confirmPassword}
                                onChange={(event) => setConfirmPassword(event.target.value)}
                                required
                                autoComplete="new-password"
                            />
                            <Button type="submit" variant="contained" disabled={loadingAction}>
                                {loadingAction ? 'Creating account...' : 'Create Admin Account'}
                            </Button>
                        </Stack>
                    </Box>
                </Stack>
            </CardContent>
        </Card>
    );
}

export function LoginScreen() {
    const dispatch = useDispatch();
    const { loadingAction, error, station } = useSelector((state) => state.auth);
    const stationName = normalizeStationIdentity(station).name || 'Ground Station';

    const [username, setUsername] = React.useState('');
    const [password, setPassword] = React.useState('');
    const [keepSessionActive, setKeepSessionActive] = React.useState(false);
    const [localError, setLocalError] = React.useState('');

    const handleSubmit = async (event) => {
        event.preventDefault();
        setLocalError('');

        if (!username.trim() || !password) {
            setLocalError('Username and password are required.');
            return;
        }

        await dispatch(
            loginUser({
                username: username.trim(),
                password,
                keepSessionActive,
            })
        );
    };

    return (
        <Box sx={shellSx}>
            <Card sx={loginCardSx}>
                <CardContent sx={{ p: 3 }}>
                    <Stack spacing={2}>
                        <AuthCardHeader
                            title="Sign In"
                            description="Authentication is required to use this Ground Station instance."
                        />
                        <Box sx={stationPanelSx}>
                            <Typography variant="body2" align="center" fontWeight={700}>
                                {stationName}
                            </Typography>
                        </Box>
                        {(localError || error) && (
                            <Alert severity="error">{localError || error}</Alert>
                        )}
                        <Box component="form" onSubmit={handleSubmit}>
                            <Stack spacing={2}>
                                <TextField
                                    label="Username"
                                    value={username}
                                    onChange={(event) => setUsername(event.target.value)}
                                    autoComplete="username"
                                    required
                                />
                                <TextField
                                    label="Password"
                                    type="password"
                                    value={password}
                                    onChange={(event) => setPassword(event.target.value)}
                                    autoComplete="current-password"
                                    required
                                />
                                <FormControlLabel
                                    control={(
                                        <Checkbox
                                            size="small"
                                            checked={keepSessionActive}
                                            onChange={(event) => setKeepSessionActive(event.target.checked)}
                                        />
                                    )}
                                    label="Keep session alive"
                                />
                                <Typography variant="caption" color="text.secondary" sx={{ mt: -1 }}>
                                    Unchecked sessions expire after 15 days.
                                </Typography>
                                <Button type="submit" variant="contained" disabled={loadingAction}>
                                    {loadingAction ? 'Signing in...' : 'Sign In'}
                                </Button>
                            </Stack>
                        </Box>
                    </Stack>
                </CardContent>
            </Card>
        </Box>
    );
}

export function SetupScreen() {
    const dispatch = useDispatch();
    const { socket } = useSocket();

    const [locationChecked, setLocationChecked] = React.useState(false);
    const [setupConnectionState, setSetupConnectionState] = React.useState(
        socket?.connected ? 'connected' : 'connecting'
    );
    const [reconnectAttempt, setReconnectAttempt] = React.useState(0);

    React.useEffect(() => {
        if (!socket) return undefined;

        let mounted = true;
        const refreshSetupStateAndLocation = async () => {
            if (mounted) {
                setSetupConnectionState('connected');
                setReconnectAttempt(0);
            }

            try {
                const authStatus = await dispatch(loadAuthStatus()).unwrap();
                // If setup no longer required, App will switch away from setup flow.
                if (authStatus && !authStatus.setup_required) {
                    if (mounted) {
                        setLocationChecked(true);
                    }
                    return;
                }
            } catch {
                // If auth status refresh fails, continue with setup location fetch.
            }

            try {
                await dispatch(
                    fetchLocationForUserId({ socket, suppressNotFoundWarning: true })
                ).unwrap();
            } catch {
                // Location fetch failures are surfaced in the location slice/toasts.
            } finally {
                if (mounted) {
                    setLocationChecked(true);
                }
            }
        };

        const handleDisconnect = () => {
            if (!mounted) return;
            setSetupConnectionState('disconnected');
        };

        const handleReconnectAttempt = (attempt) => {
            if (!mounted) return;
            setSetupConnectionState('reconnecting');
            setReconnectAttempt(Number(attempt) || 0);
        };

        const handleConnectError = () => {
            if (!mounted) return;
            setSetupConnectionState('disconnected');
        };

        if (socket.connected) {
            void refreshSetupStateAndLocation();
        } else if (mounted) {
            setSetupConnectionState('connecting');
        }

        socket.on('connect', refreshSetupStateAndLocation);
        socket.on('disconnect', handleDisconnect);
        socket.on('reconnect_attempt', handleReconnectAttempt);
        socket.on('connect_error', handleConnectError);
        socket.on('reconnect_error', handleConnectError);
        return () => {
            mounted = false;
            socket.off('connect', refreshSetupStateAndLocation);
            socket.off('disconnect', handleDisconnect);
            socket.off('reconnect_attempt', handleReconnectAttempt);
            socket.off('connect_error', handleConnectError);
            socket.off('reconnect_error', handleConnectError);
        };
    }, [dispatch, socket]);

    const wizardBackendReady = setupConnectionState === 'connected';
    const showConnectionOverlay = !wizardBackendReady;
    const connectionOverlayState = (() => {
        if (setupConnectionState === 'reconnecting' && reconnectAttempt > 0) {
            return {
                icon: SyncProblemIcon,
                title: 'Backend disconnected',
                message: `Reconnecting (attempt ${reconnectAttempt})...`,
                tone: 'warning',
            };
        }
        if (setupConnectionState === 'disconnected') {
            return {
                icon: CloudOffIcon,
                title: 'Backend disconnected',
                message: 'Reconnecting...',
                tone: 'info',
            };
        }
        return {
            icon: CloudOffIcon,
            title: 'Connecting to backend',
            message: 'Establishing backend connection...',
            tone: 'info',
        };
    })();
    const ConnectionStatusIcon = connectionOverlayState.icon;

    if (!locationChecked) {
        return (
            <Box sx={shellSx}>
                <Stack direction="row" spacing={1.5} alignItems="center">
                    <CircularProgress size={22} />
                    <Typography variant="body1">Loading setup state...</Typography>
                </Stack>
            </Box>
        );
    }

    return (
        <Dialog
            open
            onClose={() => {}}
            disableEscapeKeyDown
            aria-labelledby="setup-flow-dialog-title"
            maxWidth="lg"
            fullWidth
            PaperProps={{
                sx: {
                    borderRadius: 2,
                    boxShadow: 24,
                    display: 'flex',
                    flexDirection: 'column',
                    height: 'min(800px, calc(100vh - 24px))',
                    maxHeight: 'calc(100vh - 24px)',
                },
            }}
        >
            <DialogTitle
                id="setup-flow-dialog-title"
                sx={{
                    py: 1.5,
                    px: 2.5,
                    display: 'flex',
                    alignItems: 'center',
                    lineHeight: 1.2,
                    fontSize: '1.35rem',
                    fontWeight: 600,
                    color: 'primary.main',
                }}
            >
                Ground Station Setup
            </DialogTitle>
            <DialogContent
                dividers
                sx={{
                    px: 2.5,
                    pt: '10px !important',
                    pb: 2.5,
                    display: 'flex',
                    flexDirection: 'column',
                    flex: 1,
                    minHeight: 0,
                    overflow: 'hidden',
                    position: 'relative',
                }}
            >
                <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
                    <LocationPage
                        wizardMode
                        wizardRequireAdminSetup
                        wizardBackendReady={wizardBackendReady}
                    />
                </Box>
                {showConnectionOverlay && (
                    <Box
                        sx={{
                            position: 'absolute',
                            inset: 0,
                            zIndex: 8,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            px: 2,
                            py: 3,
                            backgroundColor: (theme) => theme.palette.surface.scrim,
                            backdropFilter: 'blur(4px)',
                        }}
                    >
                        <Box
                            sx={{
                                animation: `${fadeIn} 0.2s ease-out`,
                                backgroundColor: (theme) =>
                                    theme.palette.statusSurface?.[connectionOverlayState.tone]
                                    || theme.palette.surface.raised,
                                border: '1px solid',
                                borderColor: (theme) =>
                                    alpha(
                                        theme.palette[connectionOverlayState.tone]?.main
                                            || theme.palette.text.secondary,
                                        theme.palette.mode === 'dark' ? 0.6 : 0.45
                                    ),
                                borderRadius: 1,
                                p: 3,
                                minWidth: 280,
                                maxWidth: 320,
                                boxShadow: (theme) =>
                                    theme.palette.mode === 'dark'
                                        ? '0 8px 24px rgba(0, 0, 0, 0.45)'
                                        : '0 8px 24px rgba(15, 23, 42, 0.16)',
                            }}
                        >
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 2,
                                    mb: 2,
                                }}
                            >
                                <ConnectionStatusIcon
                                    sx={{
                                        fontSize: 24,
                                        color: (theme) =>
                                            theme.palette[connectionOverlayState.tone]?.main
                                            || theme.palette.text.secondary,
                                    }}
                                />
                                <Box sx={{ minWidth: 0 }}>
                                    <Typography
                                        variant="subtitle1"
                                        sx={{
                                            color: 'text.primary',
                                            fontWeight: 500,
                                            mb: 0.5,
                                            fontSize: '1rem',
                                        }}
                                    >
                                        {connectionOverlayState.title}
                                    </Typography>
                                    <Typography
                                        variant="body2"
                                        sx={{
                                            color: 'text.secondary',
                                            fontSize: '0.875rem',
                                        }}
                                    >
                                        {connectionOverlayState.message}
                                    </Typography>
                                </Box>
                            </Box>

                            <Box
                                sx={{
                                    width: '100%',
                                    height: 2,
                                    backgroundColor: (theme) => theme.palette.state.disabledBg,
                                    borderRadius: 1,
                                    overflow: 'hidden',
                                    position: 'relative',
                                }}
                            >
                                <Box
                                    sx={{
                                        height: '100%',
                                        width: '30%',
                                        backgroundColor: (theme) =>
                                            theme.palette[connectionOverlayState.tone]?.main
                                            || theme.palette.text.secondary,
                                        borderRadius: 1,
                                        animation: `${progressSweep} 2s infinite ease-in-out`,
                                    }}
                                />
                            </Box>
                        </Box>
                    </Box>
                )}
            </DialogContent>
        </Dialog>
    );
}
