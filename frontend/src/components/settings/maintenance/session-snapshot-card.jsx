/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 */

import React, { useState } from 'react';
import { useSelector } from 'react-redux';
import { Typography, Divider, Chip, TextField, Stack, Paper, Box, Avatar } from '@mui/material';
import Grid from '@mui/material/Grid';
import { useSocket } from '../../common/socket.jsx';
import { UAParser } from 'ua-parser-js';
import ComputerIcon from '@mui/icons-material/Computer';
import PhoneAndroidIcon from '@mui/icons-material/PhoneAndroid';
import TabletIcon from '@mui/icons-material/Tablet';
import DevicesIcon from '@mui/icons-material/Devices';
import SignalWifi4BarIcon from '@mui/icons-material/SignalWifi4Bar';
import SignalWifiOffIcon from '@mui/icons-material/SignalWifiOff';
import { useUserTimeSettings } from '../../../hooks/useUserTimeSettings.jsx';
import { formatDateTime, formatTime } from '../../../utils/date-time.js';

const KeyValue = ({ label, value, wrap = false }) => (
    <Stack direction="row" spacing={1} alignItems={wrap ? "flex-start" : "center"} sx={{ mb: 1 }}>
        <Typography variant="body2" color="text.secondary" sx={{ minWidth: 140, flexShrink: 0 }}>{label}</Typography>
        <Typography
            variant="body2"
            sx={{
                fontFamily: 'monospace',
                wordBreak: 'break-word',
                flex: 1,
                ...(wrap && { whiteSpace: 'normal' })
            }}
        >
            {value ?? '—'}
        </Typography>
    </Stack>
);

const SectionTitle = ({ children }) => (
    <Typography variant="subtitle2" color="text.secondary" gutterBottom sx={{ mt: 1 }}>{children}</Typography>
);

// Helper function to determine device type and icon from user agent
const getDeviceInfo = (userAgent) => {
    if (!userAgent) return { type: 'unknown', icon: DevicesIcon, color: '#9e9e9e', label: 'Unknown' };

    const parser = new UAParser(userAgent);
    const device = parser.getDevice();
    const browser = parser.getBrowser();
    const os = parser.getOS();

    let type = 'desktop';
    let icon = ComputerIcon;
    let color = '#1976d2'; // blue
    let label = 'Desktop';

    if (device.type === 'mobile') {
        type = 'mobile';
        icon = PhoneAndroidIcon;
        color = '#4caf50'; // green
        label = 'Mobile';
    } else if (device.type === 'tablet') {
        type = 'tablet';
        icon = TabletIcon;
        color = '#ff9800'; // orange
        label = 'Tablet';
    }

    return {
        type,
        icon,
        color,
        label,
        browser: browser.name || 'Unknown',
        browserVersion: browser.version || '',
        os: os.name || 'Unknown',
        osVersion: os.version || ''
    };
};

const ConsumerBadges = ({ map, sessionId }) => {
    if (!map || typeof map !== 'object') return null;

    // If sessionId provided, filter to only show that session's consumers
    let entries = Object.entries(map);
    if (sessionId) {
        entries = entries.filter(([k]) => k === sessionId || k.startsWith(`${sessionId}:`));
    }

    if (!entries.length) return <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>None</Typography>;

    return (
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
            {entries.map(([k, v]) => {
                // For VFO-based consumers (demodulators, decoders), show VFO badges
                if (typeof v === 'object' && v !== null) {
                    return Object.entries(v).map(([vfo, type]) => (
                        <Chip
                            key={`${k}-${vfo}`}
                            size="small"
                            label={`VFO ${vfo}: ${type}`}
                            sx={{ fontSize: '0.7rem', height: 22 }}
                        />
                    ));
                }
                // For simple consumers (recorders)
                const suffix = sessionId && k.startsWith(`${sessionId}:`) ? k.slice(sessionId.length + 1) : null;
                const label = suffix ? `${v || 'Active'} (${suffix})` : (v || 'Active');
                return (
                    <Chip
                        key={k}
                        size="small"
                        label={label}
                        sx={{ fontSize: '0.7rem', height: 22 }}
                    />
                );
            })}
        </Stack>
    );
};

const SessionSnapshotCard = () => {
    const { socket } = useSocket();
    const [sdrFilter, setSdrFilter] = useState('');
    const [sessionFilter, setSessionFilter] = useState('');
    const { timezone, locale } = useUserTimeSettings();

    const runtime = useSelector((state) => state.sessions.runtimeSnapshot);

    // Session runtime snapshots are now handled globally in useSocketEventHandlers.jsx
    // No need for component-specific listener

    const rawSnapshot = runtime.data || { sessions: {}, sdrs: {} };

    // Apply client-side filters and enrich sessions with SDR consumer data
    const filteredSessions = Object.entries(rawSnapshot.sessions || {}).filter(([sid, info]) => {
        const sdrMatch = sdrFilter?.trim() ? info?.sdr_id === sdrFilter.trim() : true;
        const sidMatch = sessionFilter?.trim() ? sid === sessionFilter.trim() : true;
        return sdrMatch && sidMatch;
    });

    // Enrich each session with its SDR consumer data
    const enrichedSessions = filteredSessions.map(([sid, info]) => {
        const sdrId = info?.sdr_id;
        const sdrData = sdrId ? rawSnapshot.sdrs?.[sdrId] : null;

        return {
            sid,
            info,
            sdrData: sdrData || { alive: false, clients: [], demodulators: {}, recorders: {}, decoders: {} },
        };
    });

    return (
        <>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                <Typography variant="h6">Active Sessions & Runtime Snapshot</Typography>
                <Stack direction="row" spacing={1}>
                    <TextField size="small" label="Filter by SDR ID" value={sdrFilter} onChange={(e) => setSdrFilter(e.target.value)} />
                    <TextField size="small" label="Filter by Session ID" value={sessionFilter} onChange={(e) => setSessionFilter(e.target.value)} />
                </Stack>
            </Stack>
            <Divider sx={{ mb: 2 }} />

            {runtime.error && (
                <Typography variant="body2" color="error" sx={{ mb: 2 }}>
                    {String(runtime.error)}
                </Typography>
            )}

            <SectionTitle>Active Sessions</SectionTitle>
            <Divider sx={{ mb: 2 }} />

            {enrichedSessions.length === 0 ? (
                <Typography variant="body2" color="text.secondary">No active sessions</Typography>
            ) : (
                <Grid container spacing={2} columns={{ xs: 1, sm: 1, md: 2, lg: 2 }}>
                    {enrichedSessions.map(({ sid, info, sdrData }) => {
                        const metadata = info?.metadata || {};
                        const connectedAt = metadata.connected_at
                            ? formatDateTime(metadata.connected_at * 1000, { timezone, locale })
                            : '—';
                        const ownerName = metadata.username
                            || (info?.is_internal ? 'Internal observation' : 'Unauthenticated');
                        const accountType = metadata.role
                            ? `${metadata.role}`.charAt(0).toUpperCase() + `${metadata.role}`.slice(1)
                            : (info?.is_internal ? 'System' : '—');
                        const duration = metadata.connected_at
                            ? Math.floor((Date.now() - metadata.connected_at * 1000) / 1000)
                            : null;
                        const durationStr = duration !== null
                            ? `${Math.floor(duration / 3600)}h ${Math.floor((duration % 3600) / 60)}m ${duration % 60}s`
                            : '—';

                        const deviceInfo = getDeviceInfo(metadata.user_agent);
                        const DeviceIcon = deviceInfo.icon;

                        return (
                            <Grid key={sid} size={1}>
                                <Paper
                                    variant="outlined"
                                    sx={{
                                        p: 2,
                                        height: '100%',
                                        background: 'linear-gradient(135deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
                                        borderRadius: 2
                                    }}
                                >
                                    {/* Session Header with Device Avatar */}
                                    <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
                                        <Avatar
                                            sx={{
                                                bgcolor: deviceInfo.color,
                                                width: 48,
                                                height: 48
                                            }}
                                        >
                                            <DeviceIcon />
                                        </Avatar>
                                        <Box sx={{ flex: 1, minWidth: 0 }}>
                                            <Typography
                                                variant="subtitle1"
                                                sx={{
                                                    fontFamily: 'monospace',
                                                    fontWeight: 600,
                                                    fontSize: '0.85rem',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap'
                                                }}
                                            >
                                                {sid}
                                            </Typography>
                                            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
                                                <Chip
                                                    size="small"
                                                    label={deviceInfo.label}
                                                    sx={{
                                                        height: 20,
                                                        fontSize: '0.7rem',
                                                        bgcolor: `${deviceInfo.color}20`,
                                                        color: deviceInfo.color,
                                                        fontWeight: 600
                                                    }}
                                                />
                                                {info?.sdr_id ? (
                                                    <Chip
                                                        icon={sdrData?.alive ? <SignalWifi4BarIcon sx={{ fontSize: 14 }} /> : <SignalWifiOffIcon sx={{ fontSize: 14 }} />}
                                                        size="small"
                                                        label={sdrData?.alive ? 'Streaming' : 'Idle'}
                                                        color={sdrData?.alive ? 'success' : 'default'}
                                                        sx={{ height: 20, fontSize: '0.7rem' }}
                                                    />
                                                ) : (
                                                    <Chip
                                                        size="small"
                                                        label="No SDR"
                                                        sx={{ height: 20, fontSize: '0.7rem' }}
                                                    />
                                                )}
                                            </Stack>
                                        </Box>
                                    </Stack>

                                    {/* Browser & OS Info */}
                                    <Box sx={{ mb: 2, p: 1.5, bgcolor: 'rgba(0,0,0,0.1)', borderRadius: 1 }}>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                            Browser & OS
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                            {deviceInfo.browser} {deviceInfo.browserVersion && `v${deviceInfo.browserVersion.split('.')[0]}`}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {deviceInfo.os} {deviceInfo.osVersion}
                                        </Typography>
                                    </Box>

                                    {/* Connection Details */}
                                    <Divider sx={{ my: 1.5 }} />
                                    <Box sx={{ p: 1.5, bgcolor: 'rgba(0,0,0,0.1)', borderRadius: 1, mb: 1 }}>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, fontWeight: 600, textTransform: 'uppercase' }}>
                                            Connection Details
                                        </Typography>
                                        <KeyValue label="Owner" value={ownerName} />
                                        <KeyValue label="Account Type" value={accountType} />
                                        <KeyValue label="IP Address" value={metadata.ip} />
                                        <KeyValue label="Origin" value={metadata.origin} />
                                        <KeyValue label="Connected" value={connectedAt} />
                                        <KeyValue label="Duration" value={durationStr} />
                                    </Box>

                                    {/* SDR Device Info - Always shown */}
                                    <Divider sx={{ my: 1.5 }} />
                                    <Box sx={{ p: 1.5, bgcolor: 'rgba(0,0,0,0.1)', borderRadius: 1, mb: 1 }}>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, fontWeight: 600, textTransform: 'uppercase' }}>
                                            SDR Device
                                        </Typography>
                                        <KeyValue label="SDR ID" value={info?.sdr_id || '—'} wrap />
                                        <KeyValue label="Device Name" value={sdrData?.device?.name || '—'} />
                                        <KeyValue label="Device Type" value={sdrData?.device?.type || '—'} />
                                        <KeyValue label="Serial" value={sdrData?.device?.serial || '—'} />
                                        <KeyValue label="Host" value={sdrData?.device?.host ? `${sdrData.device.host}:${sdrData.device.port || ''}` : '—'} />
                                    </Box>

                                    {/* VFO State Information */}
                                    {info?.vfos && Object.keys(info.vfos).length > 0 && (
                                        <>
                                            <Divider sx={{ my: 1.5 }} />
                                            <Box sx={{ p: 1.5, bgcolor: 'rgba(0,0,0,0.1)', borderRadius: 1, mb: 1 }}>
                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, fontWeight: 600, textTransform: 'uppercase' }}>
                                                    VFO Configuration
                                                </Typography>
                                                {Object.entries(info.vfos).map(([vfoNum, vfo]) => (
                                                    <Box key={vfoNum} sx={{ mb: 1.5, pb: 1.5, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                                                            <Typography variant="body2" sx={{ fontWeight: 600 }}>VFO {vfoNum}</Typography>
                                                            {vfo.active && <Chip size="small" label="Active" color="success" sx={{ height: 18, fontSize: '0.65rem' }} />}
                                                            {vfo.selected && <Chip size="small" label="Selected" color="primary" sx={{ height: 18, fontSize: '0.65rem' }} />}
                                                        </Stack>
                                                        <KeyValue label="Frequency" value={`${(vfo.center_freq / 1e6).toFixed(6)} MHz`} />
                                                        <KeyValue label="Bandwidth" value={`${(vfo.bandwidth / 1e3).toFixed(1)} kHz`} />
                                                        <KeyValue label="Modulation" value={vfo.modulation || 'none'} />
                                                        {vfo.decoder && vfo.decoder !== 'none' && (
                                                            <KeyValue label="Decoder" value={vfo.decoder} />
                                                        )}
                                                        {vfo.locked_transmitter_id && vfo.locked_transmitter_id !== 'none' && (
                                                            <KeyValue label="Locked TX" value={vfo.locked_transmitter_id} wrap />
                                                        )}
                                                        {vfo.volume !== undefined && vfo.volume !== null && (
                                                            <KeyValue label="Volume" value={`${vfo.volume}%`} />
                                                        )}
                                                        {vfo.squelch !== undefined && vfo.squelch !== null && (
                                                            <KeyValue label="Squelch" value={`${vfo.squelch}%`} />
                                                        )}
                                                        {vfo.transcription_enabled && (
                                                            <>
                                                                <KeyValue label="Transcription" value={vfo.transcription_provider || 'Enabled'} />
                                                                {vfo.transcription_language && (
                                                                    <KeyValue label="Language" value={vfo.transcription_language} />
                                                                )}
                                                                {vfo.transcription_translate_to && (
                                                                    <KeyValue label="Translate To" value={vfo.transcription_translate_to} />
                                                                )}
                                                            </>
                                                        )}
                                                    </Box>
                                                ))}
                                            </Box>
                                        </>
                                    )}

                                    {/* SDR Consumers - only show if session has an SDR */}
                                    {info?.sdr_id && (
                                        <>
                                            <Divider sx={{ my: 1.5 }} />
                                            <Box sx={{ p: 1.5, bgcolor: 'rgba(0,0,0,0.1)', borderRadius: 1 }}>
                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, fontWeight: 600, textTransform: 'uppercase' }}>
                                                    Active Consumers
                                                </Typography>

                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontWeight: 600 }}>
                                                    Demodulators
                                                </Typography>
                                                <Box sx={{ mb: 1.5 }}>
                                                    <ConsumerBadges map={sdrData?.demodulators} sessionId={sid} />
                                                </Box>

                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontWeight: 600 }}>
                                                    Decoders
                                                </Typography>
                                                <Box sx={{ mb: 1.5 }}>
                                                    <ConsumerBadges map={sdrData?.decoders} sessionId={sid} />
                                                </Box>

                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontWeight: 600 }}>
                                                    Recorders
                                                </Typography>
                                                <ConsumerBadges map={sdrData?.recorders} sessionId={sid} />
                                            </Box>
                                        </>
                                    )}
                                </Paper>
                            </Grid>
                        );
                    })}
                </Grid>
            )}

            <Divider sx={{ my: 2 }} />
            <Stack direction="row" spacing={2}>
                <KeyValue label="Last Updated" value={runtime.lastUpdated ? formatTime(runtime.lastUpdated, { timezone, locale }) : '—'} />
                <KeyValue label="Socket Connected" value={socket?.connected ? 'yes' : 'no'} />
                <KeyValue label="Update Mode" value="auto (1s)" />
            </Stack>
        </>
    );
};

export default SessionSnapshotCard;
