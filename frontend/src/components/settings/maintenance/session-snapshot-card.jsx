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
import { useTranslation } from 'react-i18next';

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
    const { t } = useTranslation('settings');
    if (!map || typeof map !== 'object') return null;

    // If sessionId provided, filter to only show that session's consumers
    let entries = Object.entries(map);
    if (sessionId) {
        entries = entries.filter(([k]) => k === sessionId || k.startsWith(`${sessionId}:`));
    }

    if (!entries.length) return <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.75rem' }}>{t('session_snapshot_card.none', { defaultValue: 'None' })}</Typography>;

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
    const { t } = useTranslation('settings');
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
                <Typography variant="h6">{t('session_snapshot_card.active_sessions_runtime_snapshot', { defaultValue: 'Active Sessions & Runtime Snapshot' })}</Typography>
                <Stack direction="row" spacing={1}>
                    <TextField size="small" label={t('session_snapshot_card.filter_by_sdr_id', { defaultValue: 'Filter by SDR ID' })} value={sdrFilter} onChange={(e) => setSdrFilter(e.target.value)} />
                    <TextField size="small" label={t('session_snapshot_card.filter_by_session_id', { defaultValue: 'Filter by Session ID' })} value={sessionFilter} onChange={(e) => setSessionFilter(e.target.value)} />
                </Stack>
            </Stack>
            <Divider sx={{ mb: 2 }} />

            {runtime.error && (
                <Typography variant="body2" color="error" sx={{ mb: 2 }}>
                    {String(runtime.error)}
                </Typography>
            )}

            <SectionTitle>{t('session_snapshot_card.active_sessions', { defaultValue: 'Active Sessions' })}</SectionTitle>
            <Divider sx={{ mb: 2 }} />

            {enrichedSessions.length === 0 ? (
                <Typography variant="body2" color="text.secondary">{t('session_snapshot_card.no_active_sessions', { defaultValue: 'No active sessions' })}</Typography>
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
                                                        label={t('session_snapshot_card.no_sdr', { defaultValue: 'No SDR' })}
                                                        sx={{ height: 20, fontSize: '0.7rem' }}
                                                    />
                                                )}
                                            </Stack>
                                        </Box>
                                    </Stack>

                                    {/* Browser & OS Info */}
                                    <Box sx={{ mb: 2, p: 1.5, bgcolor: 'rgba(0,0,0,0.1)', borderRadius: 1 }}>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                            {t('session_snapshot_card.browser_os', { defaultValue: 'Browser & OS' })}
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
                                            {t('session_snapshot_card.connection_details', { defaultValue: 'Connection Details' })}
                                        </Typography>
                                        <KeyValue label={t('session_snapshot_card.owner', { defaultValue: 'Owner' })} value={ownerName} />
                                        <KeyValue label={t('session_snapshot_card.account_type', { defaultValue: 'Account Type' })} value={accountType} />
                                        <KeyValue label={t('session_snapshot_card.ip_address', { defaultValue: 'IP Address' })} value={metadata.ip} />
                                        <KeyValue label={t('session_snapshot_card.origin', { defaultValue: 'Origin' })} value={metadata.origin} />
                                        <KeyValue label={t('session_snapshot_card.connected', { defaultValue: 'Connected' })} value={connectedAt} />
                                        <KeyValue label={t('session_snapshot_card.duration', { defaultValue: 'Duration' })} value={durationStr} />
                                    </Box>

                                    {/* SDR Device Info - Always shown */}
                                    <Divider sx={{ my: 1.5 }} />
                                    <Box sx={{ p: 1.5, bgcolor: 'rgba(0,0,0,0.1)', borderRadius: 1, mb: 1 }}>
                                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, fontWeight: 600, textTransform: 'uppercase' }}>
                                            {t('session_snapshot_card.sdr_device', { defaultValue: 'SDR Device' })}
                                        </Typography>
                                        <KeyValue label="SDR ID" value={info?.sdr_id || '—'} wrap />
                                        <KeyValue label={t('session_snapshot_card.device_name', { defaultValue: 'Device Name' })} value={sdrData?.device?.name || '—'} />
                                        <KeyValue label={t('session_snapshot_card.device_type', { defaultValue: 'Device Type' })} value={sdrData?.device?.type || '—'} />
                                        <KeyValue label={t('session_snapshot_card.serial', { defaultValue: 'Serial' })} value={sdrData?.device?.serial || '—'} />
                                        <KeyValue label={t('session_snapshot_card.host', { defaultValue: 'Host' })} value={sdrData?.device?.host ? `${sdrData.device.host}:${sdrData.device.port || ''}` : '—'} />
                                    </Box>

                                    {/* VFO State Information */}
                                    {info?.vfos && Object.keys(info.vfos).length > 0 && (
                                        <>
                                            <Divider sx={{ my: 1.5 }} />
                                            <Box sx={{ p: 1.5, bgcolor: 'rgba(0,0,0,0.1)', borderRadius: 1, mb: 1 }}>
                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1, fontWeight: 600, textTransform: 'uppercase' }}>
                                                    {t('session_snapshot_card.vfo_configuration', { defaultValue: 'VFO Configuration' })}
                                                </Typography>
                                                {Object.entries(info.vfos).map(([vfoNum, vfo]) => (
                                                    <Box key={vfoNum} sx={{ mb: 1.5, pb: 1.5, borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                                                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                                                            <Typography variant="body2" sx={{ fontWeight: 600 }}>VFO {vfoNum}</Typography>
                                                            {vfo.active && <Chip size="small" label={t('session_snapshot_card.active', { defaultValue: 'Active' })} color="success" sx={{ height: 18, fontSize: '0.65rem' }} />}
                                                            {vfo.selected && <Chip size="small" label={t('session_snapshot_card.selected', { defaultValue: 'Selected' })} color="primary" sx={{ height: 18, fontSize: '0.65rem' }} />}
                                                        </Stack>
                                                        <KeyValue label={t('session_snapshot_card.frequency', { defaultValue: 'Frequency' })} value={`${(vfo.center_freq / 1e6).toFixed(6)} MHz`} />
                                                        <KeyValue label={t('session_snapshot_card.bandwidth', { defaultValue: 'Bandwidth' })} value={`${(vfo.bandwidth / 1e3).toFixed(1)} kHz`} />
                                                        <KeyValue label={t('session_snapshot_card.modulation', { defaultValue: 'Modulation' })} value={vfo.modulation || 'none'} />
                                                        {vfo.decoder && vfo.decoder !== 'none' && (
                                                            <KeyValue label={t('session_snapshot_card.decoder', { defaultValue: 'Decoder' })} value={vfo.decoder} />
                                                        )}
                                                        {vfo.locked_transmitter_id && vfo.locked_transmitter_id !== 'none' && (
                                                            <KeyValue label={t('session_snapshot_card.locked_tx', { defaultValue: 'Locked TX' })} value={vfo.locked_transmitter_id} wrap />
                                                        )}
                                                        {vfo.volume !== undefined && vfo.volume !== null && (
                                                            <KeyValue label={t('session_snapshot_card.volume', { defaultValue: 'Volume' })} value={`${vfo.volume}%`} />
                                                        )}
                                                        {vfo.squelch !== undefined && vfo.squelch !== null && (
                                                            <KeyValue label={t('session_snapshot_card.squelch', { defaultValue: 'Squelch' })} value={`${vfo.squelch}%`} />
                                                        )}
                                                        {vfo.transcription_enabled && (
                                                            <>
                                                                <KeyValue label={t('session_snapshot_card.transcription', { defaultValue: 'Transcription' })} value={vfo.transcription_provider || 'Enabled'} />
                                                                {vfo.transcription_language && (
                                                                    <KeyValue label={t('session_snapshot_card.language', { defaultValue: 'Language' })} value={vfo.transcription_language} />
                                                                )}
                                                                {vfo.transcription_translate_to && (
                                                                    <KeyValue label={t('session_snapshot_card.translate_to', { defaultValue: 'Translate To' })} value={vfo.transcription_translate_to} />
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
                                                    {t('session_snapshot_card.active_consumers', { defaultValue: 'Active Consumers' })}
                                                </Typography>

                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontWeight: 600 }}>
                                                    {t('session_snapshot_card.demodulators', { defaultValue: 'Demodulators' })}
                                                </Typography>
                                                <Box sx={{ mb: 1.5 }}>
                                                    <ConsumerBadges map={sdrData?.demodulators} sessionId={sid} />
                                                </Box>

                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontWeight: 600 }}>
                                                    {t('session_snapshot_card.decoders', { defaultValue: 'Decoders' })}
                                                </Typography>
                                                <Box sx={{ mb: 1.5 }}>
                                                    <ConsumerBadges map={sdrData?.decoders} sessionId={sid} />
                                                </Box>

                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5, fontWeight: 600 }}>
                                                    {t('session_snapshot_card.recorders', { defaultValue: 'Recorders' })}
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
                <KeyValue label={t('session_snapshot_card.last_updated', { defaultValue: 'Last Updated' })} value={runtime.lastUpdated ? formatTime(runtime.lastUpdated, { timezone, locale }) : '—'} />
                <KeyValue label={t('session_snapshot_card.socket_connected', { defaultValue: 'Socket Connected' })} value={socket?.connected ? 'yes' : 'no'} />
                <KeyValue label={t('session_snapshot_card.update_mode', { defaultValue: 'Update Mode' })} value="auto (1s)" />
            </Stack>
        </>
    );
};

export default SessionSnapshotCard;
