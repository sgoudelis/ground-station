import Stack from "@mui/material/Stack";
import SatelliteInfoPopover from "./target-popover.jsx";
import HardwareSettingsPopover from "./hardware-popover.jsx";
import WakeLockStatus from "./wake-lock-icon.jsx";
import {ThemeSwitcher} from "@toolpad/core/DashboardLayout";
import Typography from "@mui/material/Typography";
import PropTypes from "prop-types";
import Grid from "@mui/material/Grid";
import RadioIcon from '@mui/icons-material/Radio';
import LanIcon from '@mui/icons-material/Lan';
import SettingsInputAntennaIcon from '@mui/icons-material/SettingsInputAntenna';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import {Avatar, Box, Button, Divider, IconButton, LinearProgress, ListItemIcon, ListItemText, MenuItem, MenuList, Popover} from "@mui/material";
import {GroundStationLogoGreenBlue} from "../common/logo-dataurl.js";
import {Account, AccountPopoverFooter, AccountPreview, SignOutButton} from "@toolpad/core";
import * as React from "react";
import {stringAvatar} from "../common/common.jsx";
import {useDispatch, useStore} from "react-redux";
import {useSocket} from "../common/socket.jsx";
import {useAudio} from "./audio-provider.jsx";
import {useCallback, useEffect, useState} from "react";
import {setConnected, setConnecting, setConnectionError, setReConnectAttempt} from "./dashboard-slice.jsx";
import Tooltip from "@mui/material/Tooltip";
import { useTranslation } from 'react-i18next';
import { setDialogOpen } from '../performance/performance-slice.jsx';

function ConnectionStatus() {
    const { t } = useTranslation('dashboard');
    const dispatch = useDispatch();
    // Read Redux only when taking a snapshot; live system-info events should
    // not rerender the closed icon or add a second refresh while open.
    const reduxStore = useStore();
    const { trafficStatsRef, sampleTrafficStats, setCollectStats, transportName } = useSocket();
    const [anchorEl, setAnchorEl] = useState(null);
    const [snapshot, setSnapshot] = useState(() => ({
        traffic: trafficStatsRef.current,
        systemInfo: reduxStore.getState().systemInfo,
    }));
    const trafficStats = snapshot.traffic;
    const systemInfo = snapshot.systemInfo;

    const open = Boolean(anchorEl);

    const takeSnapshot = useCallback(() => {
        // Sample both sources together so one timer tick produces one render.
        setSnapshot({
            traffic: sampleTrafficStats(),
            systemInfo: reduxStore.getState().systemInfo,
        });
    }, [reduxStore, sampleTrafficStats]);

    useEffect(() => {
        if (!open) return;
        const interval = setInterval(takeSnapshot, 1000);
        return () => clearInterval(interval);
    }, [open, takeSnapshot]);

    useEffect(() => {
        // Closing and unmounting both end this popover's traffic window.
        return () => setCollectStats(false);
    }, [setCollectStats]);

    const handleClick = (event) => {
        setCollectStats(true);
        takeSnapshot();
        setAnchorEl(event.currentTarget);
    };

    const handleClose = () => {
        setCollectStats(false);
        setAnchorEl(null);
    };

    // Memoize connection color based on transport name
    const connectionColor = React.useMemo(() => {
        const transport = transportName;
        if (transport === "websocket") return 'status.connected';
        if (transport === "polling") return 'status.polling';
        if (transport === "connecting..." || transport === "unknown") return 'status.connecting';
        if (transport === "disconnected") return 'status.disconnected';
        return 'status.disconnected';
    }, [transportName]);

    // Memoize connection tooltip
    const connectionTooltip = React.useMemo(() => {
        if (transportName === "websocket") return t('connection_popover.network_connected_ws');
        if (transportName === "polling") return t('connection_popover.network_connected_polling');
        if (transportName === 'connecting...' || transportName === "unknown") return t('connection_popover.network_connecting');
        if (transportName === "disconnected") return t('connection_popover.network_disconnected');
        return t('connection_popover.network_unknown');
    }, [transportName, t]);

    const formatBytes = useCallback((bytes) => {
        if (bytes === 0) return '0 B/s';
        const k = 1024;
        const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }, []);

    const formatTotalBytes = useCallback((bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }, []);

    const formatDuration = useCallback((milliseconds) => {
        const seconds = Math.floor(milliseconds / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }, []);

    const handleOpenTopology = useCallback(() => {
        handleClose();
        dispatch(setDialogOpen(true));
    }, [dispatch]);

    return (
        <>
            <Tooltip title={connectionTooltip}>
                <IconButton
                    size="small"
                    onClick={handleClick}
                    sx={{
                        width: 40,
                        color: connectionColor,
                        '&:hover': {
                            backgroundColor: 'overlay.light'
                        }
                    }}
                >
                    <LanIcon />
                </IconButton>
            </Tooltip>
            <Popover
                open={open}
                anchorEl={anchorEl}
                onClose={handleClose}
                anchorOrigin={{
                    vertical: 'bottom',
                    horizontal: 'right',
                }}
                transformOrigin={{
                    vertical: 'top',
                    horizontal: 'right',
                }}
                slotProps={{
                    paper: {
                        sx: {
                            mt: 0.5,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1.25,
                            overflow: 'hidden',
                        },
                    },
                }}
            >
                <Box sx={{
                    p: 1,
                    minWidth: 250,
                    width: 250,
                    backgroundColor: 'background.paper',
                }}>
                    <Box sx={{ mb: 1.5 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">
                                {t('connection_popover.transport')}
                            </Typography>
                            <Typography variant="caption" sx={{ fontFamily: 'monospace', color: connectionColor }}>
                                {trafficStats.transport.name.toUpperCase()}
                            </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="caption" color="text.secondary">
                                {t('connection_popover.duration')}
                            </Typography>
                            <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.primary' }}>
                                {formatDuration(trafficStats.session.duration)}
                            </Typography>
                        </Box>
                        {trafficStats.manager.reconnecting && (
                            <Typography variant="caption" sx={{ color: 'status.connecting', fontFamily: 'monospace', mt: 0.5, display: 'block' }}>
                                {t('connection_popover.reconnecting', { count: trafficStats.manager.reconnectAttempts })}
                            </Typography>
                        )}
                    </Box>

                    <Divider sx={{ my: 2 }} />

                    <Box sx={{ mb: 1.5 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">
                                {t('connection_popover.upload')}
                            </Typography>
                            <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'success.main' }}>
                                {formatBytes(trafficStats.rates.bytesPerSecond.sent)}
                                <span style={{ color: 'var(--mui-palette-text-secondary)', marginLeft: 8 }}>
                                    {trafficStats.rates.packetsPerSecond.sent} msg/s
                                </span>
                            </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="caption" color="text.secondary">
                                {t('connection_popover.download')}
                            </Typography>
                            <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'info.main' }}>
                                {formatBytes(trafficStats.rates.bytesPerSecond.received)}
                                <span style={{ color: 'var(--mui-palette-text-secondary)', marginLeft: 8 }}>
                                    {trafficStats.rates.packetsPerSecond.received} msg/s
                                </span>
                            </Typography>
                        </Box>
                    </Box>

                    <Divider sx={{ my: 2 }} />

                    <Box sx={{ mb: 1.5 }}>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                            <Typography variant="caption" color="text.secondary">
                                {t('connection_popover.sent')}
                            </Typography>
                            <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'success.main' }}>
                                {formatTotalBytes(trafficStats.engine.bytesSent)}
                                <span style={{ color: 'var(--mui-palette-text-secondary)', marginLeft: 8 }}>
                                    {trafficStats.engine.packetsSent} msgs
                                </span>
                            </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="caption" color="text.secondary">
                                {t('connection_popover.received')}
                            </Typography>
                            <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'info.main' }}>
                                {formatTotalBytes(trafficStats.engine.bytesReceived)}
                                <span style={{ color: 'var(--mui-palette-text-secondary)', marginLeft: 8 }}>
                                    {trafficStats.engine.packetsReceived} msgs
                                </span>
                            </Typography>
                        </Box>
                        {trafficStats.engine.upgradeAttempts > 0 && (
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.5 }}>
                                <Typography variant="caption" color="text.secondary">
                                    {t('connection_popover.transport_upgrades')}
                                </Typography>
                                <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.primary' }}>
                                    {trafficStats.engine.upgradeAttempts}
                                </Typography>
                            </Box>
                        )}
                    </Box>

                    <Divider sx={{ my: 2 }} />

                    <Box sx={{ mb: 2 }}>
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                            {/* CPU */}
                            <Box>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                    <Typography variant="caption" color="text.secondary">
                                        {t('connection_popover.cpu', { defaultValue: 'CPU' })}
                                    </Typography>
                                    <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.primary' }}>
                                        {systemInfo.cpu.usage_percent !== null
                                            ? `${systemInfo.cpu.usage_percent.toFixed(1)}%`
                                            : 'N/A'}
                                        {systemInfo.cpu.cores.physical && (
                                            <span style={{ color: 'var(--mui-palette-text-secondary)', marginLeft: 8 }}>
                                                {`${systemInfo.cpu.cores.physical}c/${systemInfo.cpu.cores.logical}t`}
                                            </span>
                                        )}
                                    </Typography>
                                </Box>
                                <LinearProgress
                                    variant="determinate"
                                    value={systemInfo.cpu.usage_percent || 0}
                                    sx={{
                                        height: 6,
                                        borderRadius: 1,
                                        backgroundColor: (theme) => theme.palette.state.disabledBg,
                                        '& .MuiLinearProgress-bar': {
                                            backgroundColor: (theme) => (
                                                systemInfo.cpu.usage_percent > 80
                                                    ? theme.palette.error.main
                                                    : theme.palette.success.main
                                            ),
                                            borderRadius: 1,
                                        }
                                    }}
                                />
                            </Box>

                            {/* Memory */}
                            <Box>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                    <Typography variant="caption" color="text.secondary">
                                        {t('connection_popover.memory', { defaultValue: 'Memory' })}
                                    </Typography>
                                    <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.primary' }}>
                                        {systemInfo.memory.usage_percent !== null
                                            ? `${systemInfo.memory.usage_percent.toFixed(1)}%`
                                            : 'N/A'}
                                        {systemInfo.memory.used_gb && systemInfo.memory.total_gb && (
                                            <span style={{ color: 'var(--mui-palette-text-secondary)', marginLeft: 8 }}>
                                                {`${systemInfo.memory.used_gb.toFixed(1)}/${systemInfo.memory.total_gb.toFixed(1)} GB`}
                                            </span>
                                        )}
                                    </Typography>
                                </Box>
                                <LinearProgress
                                    variant="determinate"
                                    value={systemInfo.memory.usage_percent || 0}
                                    sx={{
                                        height: 6,
                                        borderRadius: 1,
                                        backgroundColor: (theme) => theme.palette.state.disabledBg,
                                        '& .MuiLinearProgress-bar': {
                                            backgroundColor: (theme) => (
                                                systemInfo.memory.usage_percent > 80
                                                    ? theme.palette.error.main
                                                    : theme.palette.info.main
                                            ),
                                            borderRadius: 1,
                                        }
                                    }}
                                />
                            </Box>

                            {/* Disk */}
                            <Box>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                    <Typography variant="caption" color="text.secondary">
                                        {t('connection_popover.disk', { defaultValue: 'Disk' })}
                                    </Typography>
                                    <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.primary' }}>
                                        {systemInfo.disk.usage_percent !== null
                                            ? `${systemInfo.disk.usage_percent.toFixed(1)}%`
                                            : 'N/A'}
                                        {systemInfo.disk.available_gb && systemInfo.disk.total_gb && (
                                            <span style={{ color: 'var(--mui-palette-text-secondary)', marginLeft: 8 }}>
                                                {`${systemInfo.disk.available_gb.toFixed(0)}/${systemInfo.disk.total_gb.toFixed(0)} GB`}
                                            </span>
                                        )}
                                    </Typography>
                                </Box>
                                <LinearProgress
                                    variant="determinate"
                                    value={systemInfo.disk.usage_percent || 0}
                                    sx={{
                                        height: 6,
                                        borderRadius: 1,
                                        backgroundColor: (theme) => theme.palette.state.disabledBg,
                                        '& .MuiLinearProgress-bar': {
                                            backgroundColor: (theme) => (
                                                systemInfo.disk.usage_percent > 90
                                                    ? theme.palette.error.main
                                                    : theme.palette.warning.main
                                            ),
                                            borderRadius: 1,
                                        }
                                    }}
                                />
                            </Box>

                            {/* Load Average */}
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.5 }}>
                                <Typography variant="caption" color="text.secondary">
                                    {t('connection_popover.load_avg', { defaultValue: 'Load Avg' })}
                                </Typography>
                                <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.primary' }}>
                                    {systemInfo.load_avg
                                        ? `${systemInfo.load_avg['1m']} ${systemInfo.load_avg['5m']} ${systemInfo.load_avg['15m']}`
                                        : 'N/A'}
                                </Typography>
                            </Box>

                            {/* Temperature */}
                            {systemInfo.temperatures?.cpu_c !== null && (
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <Typography variant="caption" color="text.secondary">
                                        {t('connection_popover.cpu_temp', { defaultValue: 'CPU Temp' })}
                                    </Typography>
                                    <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'text.primary' }}>
                                        {`${systemInfo.temperatures.cpu_c.toFixed(0)}°C`}
                                    </Typography>
                                </Box>
                            )}
                        </Box>
                    </Box>

                    <Divider sx={{ my: 2 }} />

                    <Box>
                        <Button
                            variant="outlined"
                            size="small"
                            fullWidth
                            startIcon={<AccountTreeIcon />}
                            onClick={handleOpenTopology}
                            sx={{
                                textTransform: 'none',
                                borderColor: 'border.main',
                                '&:hover': {
                                    borderColor: 'primary.main',
                                }
                            }}
                        >
                            {t('connection_popover.open_system_topology', { defaultValue: 'Open System Topology' })}
                        </Button>
                    </Box>
                </Box>
            </Popover>
        </>
    );
}

export default ConnectionStatus;
