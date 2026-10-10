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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Chip, IconButton, Tooltip, Typography, useTheme } from '@mui/material';
import { DataGrid, gridClasses } from '@mui/x-data-grid';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep';
import { alpha } from '@mui/material/styles';
import { shallowEqual, useDispatch, useSelector } from 'react-redux';
import {
    AntTab,
    AntTabs,
    getClassNamesBasedOnGridEditing,
    humanizeFutureDateInMinutes,
    islandTitleBarCompactSx,
    TitleBar,
    WaterfallStatusBarPaper,
} from '../common/common.jsx';
import DecodedPacketsDrawer from './decoded-packets-drawer.jsx';
import GnssFixQualityTimeline from './gnss-fix-quality-timeline.jsx';
import { DevRenderProfiler } from './render-profiler.jsx';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { formatDateTime, formatTime } from '../../utils/date-time.js';
import { clearDecoderOutputs } from '../decoders/decoders-slice.jsx';
import {
    clearGnssInsightsHistory,
    setDecodedInsightsActiveTab,
    setGnssSatellitesSortModel,
} from './gnss-slice.jsx';
import { useTranslation } from 'react-i18next';

// Factory (rather than a module-level constant) so the labels are translated with the
// translator of the rendering component and follow runtime language changes.
const getConstellationOperatorMeta = (t) => ({
    GPS: { flag: '🇺🇸', label: t('decoded_insights_island.united_states', { defaultValue: 'United States' }) },
    GLONASS: { flag: '🇷🇺', label: 'Russia' },
    BEIDOU: { flag: '🇨🇳', label: 'China' },
    QZSS: { flag: '🇯🇵', label: 'Japan' },
    GALILEO: { flag: '🇪🇺', label: t('decoded_insights_island.european_union', { defaultValue: 'European Union' }) },
});

function toFiniteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function formatElapsedDuration(durationMs) {
    if (!Number.isFinite(durationMs) || durationMs < 0) return '-';
    const totalSeconds = Math.floor(durationMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
        return `${hours}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
    }
    if (minutes > 0) {
        return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
    }
    return `${seconds}s`;
}

function getOperatorMetadata(constellation, operatorMeta) {
    return operatorMeta[String(constellation || '').toUpperCase()] || null;
}

const LastSeenFormatter = React.memo(function LastSeenFormatter({ value, nowMs, timezone, locale }) {
    const relativeTime = useMemo(() => humanizeFutureDateInMinutes(value), [value, nowMs]);
    const absoluteTime = useMemo(() => formatTime(value, {
        timezone,
        locale,
        options: { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' },
    }), [value, timezone, locale]);

    return (
        <Box sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            <Typography component="span" variant="caption" sx={{ fontWeight: 700, color: 'text.primary' }}>
                {relativeTime}
            </Typography>
            <Typography component="span" variant="caption" sx={{ color: 'text.secondary', ml: 0.5 }}>
                {`· ${absoluteTime}`}
            </Typography>
        </Box>
    );
});

const DecodedInsightsIsland = React.memo(function DecodedInsightsIsland() {
    const { t } = useTranslation('waterfall');
    const dispatch = useDispatch();
    const theme = useTheme();
    const { timezone, locale } = useUserTimeSettings();
    const [selectedSatelliteId, setSelectedSatelliteId] = useState(null);
    const [relativeNowMs, setRelativeNowMs] = useState(() => Date.now());
    // Translated constellation metadata, rebuilt when the language/translator changes.
    const constellationOperatorMeta = useMemo(() => getConstellationOperatorMeta(t), [t]);

    const {
        outputs,
        gridEditable,
        decodedInsightsActiveTab,
        gnssSatellitesSortModel,
        gnssSatellitesById,
        gnssReceiverSnapshot,
        gnssActivitySnapshot,
        gnssFixQualityTimeline,
        gnssFixLifecycle,
    } = useSelector(
        (state) => ({
            outputs: state.decoders.outputs,
            gridEditable: state.waterfall.gridEditable,
            decodedInsightsActiveTab: state.gnss.decodedInsightsActiveTab,
            gnssSatellitesSortModel: state.gnss.gnssSatellitesSortModel,
            gnssSatellitesById: state.gnss.gnssSatellitesById,
            gnssReceiverSnapshot: state.gnss.receiverSnapshot,
            gnssActivitySnapshot: state.gnss.activitySnapshot,
            gnssFixQualityTimeline: state.gnss.gnssFixQualityTimeline,
            gnssFixLifecycle: state.gnss.gnssFixLifecycle,
        }),
        shallowEqual
    );
    const activeTab = decodedInsightsActiveTab === 'gnss' ? 'gnss' : 'packets';
    const gnssSortModel = gnssSatellitesSortModel;

    const handleClearAll = useCallback(() => {
        dispatch(clearDecoderOutputs());
        dispatch(clearGnssInsightsHistory());
        setSelectedSatelliteId(null);
    }, [dispatch]);

    const formatTimestamp = useCallback((value) => {
        if (!value) return '-';
        return formatDateTime(value, {
            timezone,
            locale,
            options: {
                hour12: false,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            },
        });
    }, [timezone, locale]);

    const satelliteRows = useMemo(() => {
        return Object.values(gnssSatellitesById || {}).sort((a, b) => {
            const aSeen = Number(a?.lastSeen) || 0;
            const bSeen = Number(b?.lastSeen) || 0;
            return bSeen - aSeen;
        });
    }, [gnssSatellitesById]);

    const packetOutputCount = useMemo(() => {
        return outputs.filter(
            (item) => item?.type === 'decoder-output'
                && String(item?.decoder_type || '').toLowerCase() !== 'gnss'
        ).length;
    }, [outputs]);

    const packetStatusStats = useMemo(() => {
        const packetOutputs = outputs.filter(
            (item) => item?.type === 'decoder-output'
                && String(item?.decoder_type || '').toLowerCase() !== 'gnss'
        );

        const decoderTypes = new Set();
        let latestPacketMs = null;
        let telemetryCount = 0;
        let fileOutputCount = 0;
        let recentPacketCount = 0;
        const recentWindowStartMs = relativeNowMs - 60_000;

        for (const item of packetOutputs) {
            const decoderType = String(item?.decoder_type || '').trim().toUpperCase();
            if (decoderType) {
                decoderTypes.add(decoderType);
            }

            if (item?.output?.telemetry) {
                telemetryCount += 1;
            }
            if (item?.output?.filename) {
                fileOutputCount += 1;
            }

            const tsMs = Number(item?.timestamp) * 1000;
            if (Number.isFinite(tsMs)) {
                latestPacketMs = latestPacketMs === null ? tsMs : Math.max(latestPacketMs, tsMs);
                if (tsMs >= recentWindowStartMs) {
                    recentPacketCount += 1;
                }
            }
        }

        return {
            decoderTypeCount: decoderTypes.size,
            telemetryCount,
            fileOutputCount,
            recentPacketCount,
            latestPacketMs,
        };
    }, [outputs, relativeNowMs]);

    const receiverFix = useMemo(() => {
        const fix = gnssReceiverSnapshot || {};
        const hasCoords = fix.latitude !== null && fix.longitude !== null;
        const hasFixQuality = fix.fixQuality !== null && fix.fixQuality !== '' && fix.fixQuality !== '0';
        return {
            lastUpdateMs: fix.lastUpdateMs ?? null,
            latitude: fix.latitude ?? null,
            longitude: fix.longitude ?? null,
            altitudeM: fix.altitudeM ?? null,
            fixQuality: fix.fixQuality ?? null,
            satellites: fix.satellites ?? null,
            utcTime: fix.utcTime ?? null,
            status: hasCoords || hasFixQuality ? 'FIX' : (fix.lastUpdateMs ? 'NO FIX' : 'NO DATA'),
        };
    }, [gnssReceiverSnapshot]);

    const gnssActivity = useMemo(() => {
        const activity = gnssActivitySnapshot || {};
        const lastSeenMs = activity.lastHeartbeatMs ?? null;
        const packetsPerSec = toFiniteNumber(activity.packetsPerSec) || 0;
        const monitorObsPerSec = toFiniteNumber(activity.monitorObsPerSec) || 0;
        const lossOfLockTotal = toFiniteNumber(activity.lossOfLockTotal) || 0;
        const lossOfLockDelta = toFiniteNumber(activity.lossOfLockDelta) || 0;
        const fresh = lastSeenMs !== null && (relativeNowMs - lastSeenMs) <= 3500;
        const active = fresh && (Boolean(activity.hasActivity) || packetsPerSec > 0 || monitorObsPerSec > 0);

        return {
            active,
            heartbeatAlive: fresh,
            lastSeenMs,
            hasPvt: Boolean(activity.hasPvt),
            packetsPerSec,
            monitorObsPerSec,
            lossOfLockTotal,
            lossOfLockDelta,
        };
    }, [gnssActivitySnapshot, relativeNowMs]);

    const gnssStatusStats = useMemo(() => {
        let trackingSatCount = 0;
        let acquiredSatCount = 0;
        let lostSatCount = 0;
        let latestGnssEventMs = null;
        for (const row of satelliteRows) {
            if (row.state === 'tracking') trackingSatCount += 1;
            if (row.state === 'acquired') acquiredSatCount += 1;
            if (row.state === 'lost') lostSatCount += 1;
            if (Number.isFinite(row.lastSeen)) {
                latestGnssEventMs = latestGnssEventMs === null ? row.lastSeen : Math.max(latestGnssEventMs, row.lastSeen);
            }
        }

        return {
            trackingSatCount,
            acquiredSatCount,
            lostSatCount,
            latestGnssEventMs,
        };
    }, [satelliteRows]);

    useEffect(() => {
        if (!selectedSatelliteId || !satelliteRows.find((row) => row.id === selectedSatelliteId)) {
            setSelectedSatelliteId(satelliteRows[0]?.id || null);
        }
    }, [satelliteRows, selectedSatelliteId]);

    useEffect(() => {
        const interval = window.setInterval(() => {
            setRelativeNowMs(Date.now());
        }, 1000);

        return () => window.clearInterval(interval);
    }, []);

    const selectedSatellite = useMemo(() => {
        return satelliteRows.find((row) => row.id === selectedSatelliteId) || null;
    }, [satelliteRows, selectedSatelliteId]);

    const gnssGridRows = satelliteRows;
    const fixLifecycle = useMemo(() => ({
        currentStatus: gnssFixLifecycle?.currentStatus || 'NO DATA',
        currentFixStartedAtMs: gnssFixLifecycle?.currentFixStartedAtMs ?? null,
        lastFixAcquiredAtMs: gnssFixLifecycle?.lastFixAcquiredAtMs ?? null,
        lastClosedFixAcquiredAtMs: gnssFixLifecycle?.lastClosedFixAcquiredAtMs ?? null,
        lastFixLostAtMs: gnssFixLifecycle?.lastFixLostAtMs ?? null,
        lastFixDurationMs: gnssFixLifecycle?.lastFixDurationMs ?? null,
        lastSignalAtMs: gnssFixLifecycle?.lastSignalAtMs ?? null,
        noFixSinceAtMs: gnssFixLifecycle?.noFixSinceAtMs ?? null,
    }), [gnssFixLifecycle]);
    const displayFixStatus = fixLifecycle.currentStatus !== 'NO DATA'
        ? fixLifecycle.currentStatus
        : receiverFix.status;
    const currentFixElapsedMs = (displayFixStatus === 'FIX' && fixLifecycle.currentFixStartedAtMs !== null)
        ? Math.max(0, relativeNowMs - fixLifecycle.currentFixStartedAtMs)
        : null;
    const noFixElapsedMs = (displayFixStatus !== 'FIX' && fixLifecycle.noFixSinceAtMs !== null)
        ? Math.max(0, relativeNowMs - fixLifecycle.noFixSinceAtMs)
        : null;
    const acquiredAgoMs = fixLifecycle.lastFixAcquiredAtMs !== null
        ? Math.max(0, relativeNowMs - fixLifecycle.lastFixAcquiredAtMs)
        : null;
    const lostAgoMs = fixLifecycle.lastFixLostAtMs !== null
        ? Math.max(0, relativeNowMs - fixLifecycle.lastFixLostAtMs)
        : null;
    const lastFixAcquiredAgoMs = fixLifecycle.lastClosedFixAcquiredAtMs !== null
        ? Math.max(0, relativeNowMs - fixLifecycle.lastClosedFixAcquiredAtMs)
        : null;
    const gnssHeaderStatusColor = displayFixStatus === 'FIX'
        ? theme.palette.success.main
        : displayFixStatus === 'NO FIX'
            ? theme.palette.warning.main
            : theme.palette.info.main;
    const gnssRxStatusLabel = gnssActivity.active
        ? `${gnssActivity.packetsPerSec.toFixed(1)} pkt/s`
        : (gnssActivity.heartbeatAlive ? 'alive' : 'waiting');
    const gnssRxStatusColor = gnssActivity.active
        ? theme.palette.success.main
        : gnssActivity.heartbeatAlive
            ? theme.palette.info.main
            : theme.palette.text.secondary;
    const gnssFixStatusColor = displayFixStatus === 'FIX'
        ? theme.palette.success.main
        : displayFixStatus === 'NO FIX'
            ? theme.palette.warning.main
            : theme.palette.text.secondary;
    const gnssFixStatusYesNo = displayFixStatus === 'FIX' ? 'YES' : 'NO';

    const gnssColumns = useMemo(() => ([
        {
            field: 'satelliteId',
            headerName: 'Satellite',
            minWidth: 170,
            flex: 1.1,
            renderCell: (params) => {
                const operatorMeta = getOperatorMetadata(params.row?.constellation, constellationOperatorMeta);
                const satelliteLabel = params.row?.matchedNorad
                    ? `${params.value} (${params.row.matchedNorad})`
                    : params.value;

                return (
                    <Box
                        sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.6,
                            minWidth: 0,
                            width: '100%',
                            height: '100%',
                        }}
                    >
                        {operatorMeta && (
                            <Tooltip title={operatorMeta.label}>
                                <Typography
                                    component="span"
                                    variant="caption"
                                    sx={{ display: 'inline-flex', alignItems: 'center', lineHeight: 1, flexShrink: 0 }}
                                >
                                    {operatorMeta.flag}
                                </Typography>
                            </Tooltip>
                        )}
                        <Typography
                            variant="caption"
                            sx={{
                                fontWeight: 700,
                                color: 'text.primary',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                            }}
                        >
                            {satelliteLabel}
                        </Typography>
                    </Box>
                );
            },
        },
        {
            field: 'prn',
            headerName: 'PRN',
            minWidth: 72,
            flex: 0.45,
            align: 'center',
            headerAlign: 'center',
            renderCell: (params) => {
                const prn = toFiniteNumber(params.value);
                return (
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
                        {prn !== null ? String(Math.trunc(prn)).padStart(2, '0') : '-'}
                    </Typography>
                );
            },
        },
        {
            field: 'state',
            headerName: 'State',
            minWidth: 95,
            flex: 0.7,
            renderCell: (params) => (
                <Chip
                    size="small"
                    label={String(params.value || '-').toUpperCase()}
                    sx={{
                        height: 20,
                        fontSize: '0.65rem',
                        fontWeight: 700,
                    }}
                    color={
                        params.value === 'tracking' ? 'success'
                            : params.value === 'acquired' ? 'info'
                                : params.value === 'lost' ? 'warning'
                                    : 'default'
                    }
                    variant={params.value === 'tracking' ? 'filled' : 'outlined'}
                />
            ),
        },
        {
            field: 'lastChannel',
            headerName: 'Chan',
            minWidth: 70,
            flex: 0.45,
            align: 'center',
            headerAlign: 'center',
            valueFormatter: (value) => (value === undefined || value === null ? '-' : value),
        },
        {
            field: 'acquisitionCount',
            headerName: 'Acqs',
            minWidth: 65,
            flex: 0.4,
            align: 'center',
            headerAlign: 'center',
        },
        {
            field: 'trackingCount',
            headerName: 'Track',
            minWidth: 70,
            flex: 0.45,
            align: 'center',
            headerAlign: 'center',
        },
        {
            field: 'lastCn0DbHz',
            headerName: 'C/N0',
            minWidth: 95,
            flex: 0.6,
            align: 'center',
            headerAlign: 'center',
            renderCell: (params) => {
                const value = toFiniteNumber(params.value);
                let cn0Color = 'text.disabled';
                if (value !== null) {
                    if (value < 25) cn0Color = 'error.main';
                    else if (value < 35) cn0Color = 'warning.main';
                    else if (value < 45) cn0Color = 'info.main';
                    else cn0Color = 'success.main';
                }
                return (
                    <Typography
                        variant="caption"
                        sx={{
                            color: cn0Color,
                            fontFamily: 'monospace',
                            fontWeight: value !== null ? 700 : 500,
                        }}
                    >
                        {value !== null ? value.toFixed(1) : '-'}
                    </Typography>
                );
            },
        },
        {
            field: 'lastCarrierDopplerHz',
            headerName: 'Doppler Hz',
            minWidth: 115,
            flex: 0.72,
            align: 'center',
            headerAlign: 'center',
            renderCell: (params) => {
                const value = toFiniteNumber(params.value);
                return (
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontFamily: 'monospace' }}>
                        {value !== null ? value.toFixed(1) : '-'}
                    </Typography>
                );
            },
        },
        {
            field: 'lastSeen',
            headerName: 'Last Seen',
            minWidth: 170,
            flex: 1.2,
            renderCell: (params) => (
                <LastSeenFormatter
                    value={params.value}
                    nowMs={relativeNowMs}
                    timezone={timezone}
                    locale={locale}
                />
            ),
        },
    ]), [locale, relativeNowMs, timezone, constellationOperatorMeta]);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <TitleBar
                className={getClassNamesBasedOnGridEditing(gridEditable, ['window-title-bar'])}
                sx={islandTitleBarCompactSx}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', height: '100%' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 'bold' }}>
                        {t('decoded_insights_island.decoded', { defaultValue: 'Decoded' })}
                    </Typography>
                    <Tooltip title={t('decoded_insights_island.clear_decoded_packets_and_gnss_history', { defaultValue: 'Clear decoded packets and GNSS history' })}>
                        <span>
                            <IconButton
                                size="small"
                                onClick={handleClearAll}
                                disabled={outputs.length === 0 && satelliteRows.length === 0 && gnssFixQualityTimeline.length === 0}
                                aria-label={t('decoded_insights_island.clear_all_decoded_history', { defaultValue: 'Clear all decoded history' })}
                                sx={{ p: '2px' }}
                            >
                                <DeleteSweepIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>
                </Box>
            </TitleBar>

            <AntTabs
                value={activeTab}
                onChange={(_, value) => dispatch(setDecodedInsightsActiveTab(value))}
                variant="standard"
                sx={{
                    px: 1,
                    minHeight: 30,
                    '& .MuiTabs-flexContainer': {
                        justifyContent: 'flex-start',
                        alignItems: 'center',
                        gap: 0.5,
                    },
                    '& .MuiTabs-indicator': {
                        height: 2,
                    },
                }}
            >
                <AntTab
                    value="packets"
                    label={`PACKETS (${packetOutputCount})`}
                    sx={{
                        '&.MuiTab-root': {
                            fontSize: '0.68rem !important',
                        },
                        minHeight: 30,
                        height: 30,
                        minWidth: 0,
                        px: 1.25,
                        py: 0.25,
                    }}
                />
                <AntTab
                    value="gnss"
                    label={`GNSS (${satelliteRows.length})`}
                    sx={{
                        '&.MuiTab-root': {
                            fontSize: '0.68rem !important',
                        },
                        minHeight: 30,
                        height: 30,
                        minWidth: 0,
                        px: 1.25,
                        py: 0.25,
                    }}
                />
            </AntTabs>

            <Box sx={{ flex: 1, minHeight: 0, backgroundColor: theme.palette.background.paper }}>
                {activeTab === 'packets' && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                        <Box sx={{ flex: 1, minHeight: 0 }}>
                            <DevRenderProfiler id="DecodedPacketsDrawer">
                                <DecodedPacketsDrawer embedded />
                            </DevRenderProfiler>
                        </Box>
                        <WaterfallStatusBarPaper
                            elevation={0}
                            sx={{
                                height: 30,
                                minHeight: 30,
                                borderTop: `1px solid ${theme.palette.border.main}`,
                                borderBottom: 'none',
                                px: 1,
                                overflow: 'hidden',
                            }}
                        >
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 0.5,
                                    fontSize: '0.72rem',
                                    fontFamily: 'monospace',
                                    color: 'text.secondary',
                                    width: '100%',
                                    minWidth: 0,
                                    overflowX: 'hidden',
                                    overflowY: 'hidden',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.primary', fontSize: '0.68rem' }}>
                                    {t('decoded_insights_island.pkts', { defaultValue: 'PKTS' })}
                                </Typography>
                                <Box sx={{ opacity: 0.55 }}>•</Box>
                                <Box sx={{ display: 'flex', gap: 0.45, flex: '1 1 auto', minWidth: 0, overflow: 'hidden' }}>
                                    <Box component="span">dec: <Box component="span" sx={{ fontWeight: 700 }}>{packetOutputCount}</Box></Box>
                                    <Box component="span" sx={{ opacity: 0.55 }}>•</Box>
                                    <Box component="span">types: <Box component="span" sx={{ fontWeight: 700 }}>{packetStatusStats.decoderTypeCount}</Box></Box>
                                    <Box component="span" sx={{ opacity: 0.55 }}>•</Box>
                                    <Box component="span">tlm: <Box component="span" sx={{ fontWeight: 700 }}>{packetStatusStats.telemetryCount}</Box></Box>
                                    <Box component="span" sx={{ opacity: 0.55 }}>•</Box>
                                    <Box component="span">files: <Box component="span" sx={{ fontWeight: 700 }}>{packetStatusStats.fileOutputCount}</Box></Box>
                                    <Box component="span" sx={{ opacity: 0.55 }}>•</Box>
                                    <Box component="span">1m: <Box component="span" sx={{ fontWeight: 700 }}>{packetStatusStats.recentPacketCount}</Box></Box>
                                </Box>
                                <Typography
                                    variant="caption"
                                    sx={{
                                        color: 'text.secondary',
                                        whiteSpace: 'nowrap',
                                        marginLeft: 'auto',
                                        flex: '0 0 auto',
                                        fontSize: '0.65rem',
                                    }}
                                >
                                    {`last: ${packetStatusStats.latestPacketMs ? formatTimestamp(packetStatusStats.latestPacketMs) : '-'}`}
                                </Typography>
                            </Box>
                        </WaterfallStatusBarPaper>
                    </Box>
                )}

                {activeTab === 'gnss' && (
                    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                        {/* Keep GNSS content in three explicit columns: table, details/events, summary. */}
                        <Box
                            sx={{
                                flex: 1,
                                minHeight: 0,
                                display: 'grid',
                                gridTemplateColumns: {
                                    xs: 'minmax(0, 1fr)',
                                    md: 'minmax(0, 2.35fr) minmax(0, 1fr) minmax(0, 0.65fr)',
                                },
                                gridTemplateRows: 'minmax(0, 1fr)',
                                overflow: 'hidden',
                            }}
                        >
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <DataGrid
                                    rows={gnssGridRows}
                                    columns={gnssColumns}
                                    sortModel={gnssSortModel}
                                    onSortModelChange={(newSortModel) => dispatch(setGnssSatellitesSortModel(newSortModel))}
                                    density="compact"
                                    disableRowSelectionOnClick
                                    hideFooter
                                    onRowClick={(params) => setSelectedSatelliteId(params.id)}
                                    getRowClassName={(params) => (
                                        selectedSatelliteId === params.id ? 'gnss-row-selected' : ''
                                    )}
                                    localeText={{ noRowsLabel: 'No GNSS satellite events yet' }}
                                    sx={{
                                        border: 0,
                                        '& .MuiDataGrid-row': {
                                            borderLeft: '3px solid transparent',
                                        },
                                        '& .gnss-row-selected': {
                                            backgroundColor: alpha(theme.palette.primary.main, 0.2),
                                            borderLeftColor: theme.palette.primary.main,
                                            '& .MuiDataGrid-cell': {
                                                fontWeight: 700,
                                            },
                                            '&:hover': {
                                                backgroundColor: alpha(theme.palette.primary.main, 0.26),
                                            },
                                        },
                                        [`& .${gridClasses.cell}:focus, & .${gridClasses.cell}:focus-within`]: {
                                            outline: 'none',
                                        },
                                        [`& .${gridClasses.columnHeader}`]: {
                                            backgroundColor: theme.palette.background.default,
                                            '&:focus, &:focus-within': {
                                                outline: 'none',
                                            },
                                        },
                                    }}
                                />
                            </Box>

                            <Box
                                sx={{
                                    minWidth: 0,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    minHeight: 0,
                                    borderLeft: { xs: 0, md: `1px solid ${theme.palette.border.main}` },
                                    borderTop: { xs: `1px solid ${theme.palette.border.main}`, md: 0 },
                                }}
                            >
                                <Box
                                    sx={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: 0.75,
                                        px: 1.25,
                                        py: 0.7,
                                        borderBottom: `1px solid ${theme.palette.border.main}`,
                                        backgroundColor: alpha(theme.palette.background.default, 0.45),
                                    }}
                                >
                                    <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 700, fontSize: '0.7rem', lineHeight: 1.1 }}>
                                        {t('decoded_insights_island.satellite_details', { defaultValue: 'Satellite Details' })}
                                    </Typography>
                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.66rem', lineHeight: 1.1, maxWidth: '70%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                        {selectedSatellite ? selectedSatellite.satelliteId : 'No selection'}
                                    </Typography>
                                </Box>

                                <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 1.25, py: 1 }}>
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.7 }}>
                                        {!selectedSatellite && (
                                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                                {t('decoded_insights_island.select_a_satellite_row_to_inspect_its_latest_events', { defaultValue: 'Select a satellite row to inspect its latest events.' })}
                                            </Typography>
                                        )}

                                        {selectedSatellite && (
                                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.8 }}>
                                                <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.primary' }}>
                                                    {`${selectedSatellite.satelliteId} details`}
                                                </Typography>
                                                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                                    {`First seen: ${formatTimestamp(selectedSatellite.firstSeen)}`}
                                                </Typography>
                                                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                                    {`Last seen: ${formatTimestamp(selectedSatellite.lastSeen)}`}
                                                </Typography>
                                                {(selectedSatellite.matchedNorad !== null || selectedSatellite.matchedName !== '-') && (
                                                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                                        {`Resolved: ${selectedSatellite.matchedName !== '-' ? selectedSatellite.matchedName : 'Unknown'}${selectedSatellite.matchedNorad !== null ? ` (${selectedSatellite.matchedNorad})` : ''}`}
                                                    </Typography>
                                                )}
                                                {(selectedSatellite.latitude !== null && selectedSatellite.longitude !== null) && (
                                                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                                        {`Position: ${selectedSatellite.latitude.toFixed(6)}, ${selectedSatellite.longitude.toFixed(6)}${selectedSatellite.altitudeM !== null ? ` alt ${selectedSatellite.altitudeM.toFixed(1)}m` : ''}`}
                                                    </Typography>
                                                )}
                                                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                                    {`Signal: C/N0 ${toFiniteNumber(selectedSatellite.lastCn0DbHz) !== null ? toFiniteNumber(selectedSatellite.lastCn0DbHz).toFixed(1) : '-'} | Doppler ${toFiniteNumber(selectedSatellite.lastCarrierDopplerHz) !== null ? toFiniteNumber(selectedSatellite.lastCarrierDopplerHz).toFixed(1) : '-'} Hz | UTC ${selectedSatellite.lastUtcTime || '-'}`}
                                                </Typography>
                                                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                                    {t('decoded_insights_island.recent_events', { defaultValue: 'Recent events:' })}
                                                </Typography>
                                                {(selectedSatellite.events || []).slice(0, 10).map((event, idx) => (
                                                    <Typography
                                                        key={`${selectedSatellite.id}-${event.timestampMs}-${idx}`}
                                                        variant="caption"
                                                        sx={{
                                                            color: 'text.secondary',
                                                            fontFamily: 'monospace',
                                                            whiteSpace: 'nowrap',
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                        }}
                                                    >
                                                        {`${formatTimestamp(event.timestampMs)} | ${String(event.eventType).toUpperCase()} | ${event.message}${toFiniteNumber(event.cn0DbHz) !== null ? ` | C/N0 ${toFiniteNumber(event.cn0DbHz).toFixed(1)}` : ''}${toFiniteNumber(event.carrierDopplerHz) !== null ? ` | DOP ${toFiniteNumber(event.carrierDopplerHz).toFixed(1)}Hz` : ''}${event.utcTime ? ` | UTC ${event.utcTime}` : ''}`}
                                                    </Typography>
                                                ))}
                                                {(selectedSatellite.events || []).length === 0 && (
                                                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                                        {t('decoded_insights_island.no_events_for_this_satellite_yet', { defaultValue: 'No events for this satellite yet.' })}
                                                    </Typography>
                                                )}
                                            </Box>
                                        )}
                                    </Box>
                                </Box>
                            </Box>

                            <Box
                                sx={{
                                    minWidth: 0,
                                    minHeight: 0,
                                    borderLeft: { xs: 0, md: `1px solid ${theme.palette.border.main}` },
                                    borderTop: { xs: `1px solid ${theme.palette.border.main}`, md: 0 },
                                    display: 'flex',
                                    flexDirection: 'column',
                                }}
                            >
                                <Box
                                    sx={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 0.35,
                                        px: 1.25,
                                        py: 0.7,
                                        backgroundColor: alpha(theme.palette.background.paper, 0.94),
                                        backgroundImage: `linear-gradient(${alpha(gnssHeaderStatusColor, 0.08)}, ${alpha(gnssHeaderStatusColor, 0.08)})`,
                                        backdropFilter: 'blur(6px)',
                                        borderBottom: `1px solid ${theme.palette.border.main}`,
                                        boxShadow: `0 8px 12px -12px ${alpha(theme.palette.common.black, 0.65)}`,
                                        flex: 1,
                                        minHeight: 0,
                                        overflowY: 'auto',
                                    }}
                                >
                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 0.75 }}>
                                        <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 700, fontSize: '0.7rem', lineHeight: 1.1 }}>
                                            {t('decoded_insights_island.gnss_summary', { defaultValue: 'GNSS Summary' })}
                                        </Typography>
                                        <Typography
                                            variant="caption"
                                            sx={{
                                                fontSize: '0.68rem',
                                                fontWeight: 700,
                                                color: displayFixStatus === 'FIX'
                                                    ? 'success.main'
                                                    : displayFixStatus === 'NO FIX'
                                                        ? 'warning.main'
                                                        : 'text.secondary',
                                                lineHeight: 1.1,
                                            }}
                                        >
                                            {displayFixStatus}
                                        </Typography>
                                    </Box>
                                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', opacity: 0.72, fontSize: '0.66rem', lineHeight: 1.2 }}>
                                            {t('decoded_insights_island.detected_satellites', { defaultValue: 'Detected satellites:' })}
                                        </Typography>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.66rem', lineHeight: 1.2, fontWeight: 700, marginLeft: 'auto', textAlign: 'right' }}>
                                            {satelliteRows.length}
                                        </Typography>
                                    </Box>
                                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', opacity: 0.72, fontSize: '0.66rem', lineHeight: 1.2 }}>
                                            {t('decoded_insights_island.fix_quality', { defaultValue: 'Fix quality:' })}
                                        </Typography>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.66rem', lineHeight: 1.2, fontWeight: 700, marginLeft: 'auto', textAlign: 'right' }}>
                                            {receiverFix.fixQuality !== null ? receiverFix.fixQuality : '-'}
                                        </Typography>
                                    </Box>
                                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', opacity: 0.72, fontSize: '0.66rem', lineHeight: 1.2 }}>
                                            {t('decoded_insights_island.position', { defaultValue: 'Position:' })}
                                        </Typography>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.66rem', lineHeight: 1.2, fontFamily: 'monospace', marginLeft: 'auto', textAlign: 'right' }}>
                                            {receiverFix.latitude !== null && receiverFix.longitude !== null ? `${receiverFix.latitude.toFixed(6)}, ${receiverFix.longitude.toFixed(6)}` : '-'}
                                        </Typography>
                                    </Box>
                                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', opacity: 0.72, fontSize: '0.66rem', lineHeight: 1.2 }}>
                                            {t('decoded_insights_island.altitude', { defaultValue: 'Altitude:' })}
                                        </Typography>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.66rem', lineHeight: 1.2, fontFamily: 'monospace', marginLeft: 'auto', textAlign: 'right' }}>
                                            {receiverFix.altitudeM !== null ? `${receiverFix.altitudeM.toFixed(1)} m` : '-'}
                                        </Typography>
                                    </Box>
                                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', opacity: 0.72, fontSize: '0.66rem', lineHeight: 1.2 }}>
                                            {t('decoded_insights_island.utc_time', { defaultValue: 'UTC time:' })}
                                        </Typography>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.66rem', lineHeight: 1.2, fontFamily: 'monospace', marginLeft: 'auto', textAlign: 'right' }}>
                                            {receiverFix.utcTime || '-'}
                                        </Typography>
                                    </Box>
                                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', opacity: 0.72, fontSize: '0.66rem', lineHeight: 1.2 }}>
                                            {t('decoded_insights_island.current_fix_duration', { defaultValue: 'Current fix duration:' })}
                                        </Typography>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.66rem', lineHeight: 1.2, fontFamily: 'monospace', marginLeft: 'auto', textAlign: 'right' }}>
                                            {currentFixElapsedMs !== null ? formatElapsedDuration(currentFixElapsedMs) : '-'}
                                        </Typography>
                                    </Box>
                                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', opacity: 0.72, fontSize: '0.66rem', lineHeight: 1.2 }}>
                                            {t('decoded_insights_island.time_without_fix', { defaultValue: 'Time without fix:' })}
                                        </Typography>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.66rem', lineHeight: 1.2, fontFamily: 'monospace', marginLeft: 'auto', textAlign: 'right' }}>
                                            {displayFixStatus === 'FIX' || noFixElapsedMs === null ? '-' : formatElapsedDuration(noFixElapsedMs)}
                                        </Typography>
                                    </Box>
                                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', opacity: 0.72, fontSize: '0.66rem', lineHeight: 1.2 }}>
                                            {t('decoded_insights_island.fix_acquired', { defaultValue: 'Fix acquired:' })}
                                        </Typography>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.66rem', lineHeight: 1.2, fontFamily: 'monospace', marginLeft: 'auto', textAlign: 'right' }}>
                                            {acquiredAgoMs !== null ? `${formatElapsedDuration(acquiredAgoMs)} ago` : '-'}
                                        </Typography>
                                    </Box>
                                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', opacity: 0.72, fontSize: '0.66rem', lineHeight: 1.2 }}>
                                            {t('decoded_insights_island.fix_lost', { defaultValue: 'Fix lost:' })}
                                        </Typography>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.66rem', lineHeight: 1.2, fontFamily: 'monospace', marginLeft: 'auto', textAlign: 'right' }}>
                                            {lostAgoMs !== null ? `${formatElapsedDuration(lostAgoMs)} ago` : '-'}
                                        </Typography>
                                    </Box>
                                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', opacity: 0.72, fontSize: '0.66rem', lineHeight: 1.2 }}>
                                            {t('decoded_insights_island.last_fix_acquired', { defaultValue: 'Last fix acquired:' })}
                                        </Typography>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.66rem', lineHeight: 1.2, fontFamily: 'monospace', marginLeft: 'auto', textAlign: 'right' }}>
                                            {lastFixAcquiredAgoMs !== null ? `${formatElapsedDuration(lastFixAcquiredAgoMs)} ago` : '-'}
                                        </Typography>
                                    </Box>
                                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', opacity: 0.72, fontSize: '0.66rem', lineHeight: 1.2 }}>
                                            {t('decoded_insights_island.last_update', { defaultValue: 'Last update:' })}
                                        </Typography>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.66rem', lineHeight: 1.2, marginLeft: 'auto', textAlign: 'right' }}>
                                            {receiverFix.lastUpdateMs ? formatTimestamp(receiverFix.lastUpdateMs) : '-'}
                                        </Typography>
                                    </Box>
                                    <Box sx={{ mt: 0.6 }}>
                                        <GnssFixQualityTimeline
                                            timeline={gnssFixQualityTimeline}
                                            nowMs={relativeNowMs}
                                        />
                                    </Box>
                                </Box>
                            </Box>
                        </Box>
                        <WaterfallStatusBarPaper
                            elevation={0}
                            sx={{
                                height: 30,
                                minHeight: 30,
                                borderTop: `1px solid ${theme.palette.border.main}`,
                                borderBottom: 'none',
                                px: 1,
                                overflow: 'hidden',
                            }}
                        >
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 0.5,
                                    fontSize: '0.72rem',
                                    fontFamily: 'monospace',
                                    color: 'text.secondary',
                                    width: '100%',
                                    minWidth: 0,
                                    overflowX: 'hidden',
                                    overflowY: 'hidden',
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.primary', fontSize: '0.68rem' }}>
                                    {t('decoded_insights_island.gnss', { defaultValue: 'GNSS' })}
                                </Typography>
                                <Box sx={{ opacity: 0.55 }}>•</Box>
                                <Box sx={{ display: 'flex', gap: 0.45, flex: '1 1 auto', minWidth: 0, overflow: 'hidden' }}>
                                    <Box component="span">sat: <Box component="span" sx={{ fontWeight: 700 }}>{satelliteRows.length}</Box></Box>
                                    <Box component="span" sx={{ opacity: 0.55 }}>•</Box>
                                    <Box component="span">trk: <Box component="span" sx={{ fontWeight: 700 }}>{gnssStatusStats.trackingSatCount}</Box></Box>
                                    <Box component="span" sx={{ opacity: 0.55 }}>•</Box>
                                    <Box component="span">acq: <Box component="span" sx={{ fontWeight: 700 }}>{gnssStatusStats.acquiredSatCount}</Box></Box>
                                    <Box component="span" sx={{ opacity: 0.55 }}>•</Box>
                                    <Box component="span">lost: <Box component="span" sx={{ fontWeight: 700 }}>{gnssStatusStats.lostSatCount}</Box></Box>
                                    <Box component="span" sx={{ opacity: 0.55 }}>•</Box>
                                    <Box component="span">loss ev: <Box component="span" sx={{ fontWeight: 700 }}>{gnssActivity.lossOfLockTotal}</Box></Box>
                                </Box>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.55, marginLeft: 'auto', flex: '0 0 auto' }}>
                                    <Box
                                        component="span"
                                        sx={{
                                            px: 0.7,
                                            py: 0.15,
                                            borderRadius: 0.75,
                                            border: `1px solid ${alpha(gnssRxStatusColor, 0.35)}`,
                                            backgroundColor: alpha(gnssRxStatusColor, 0.08),
                                            color: gnssRxStatusColor,
                                            fontWeight: 700,
                                            fontSize: '0.66rem',
                                        }}
                                    >
                                        {`rx: ${gnssRxStatusLabel}`}
                                    </Box>
                                    <Box
                                        component="span"
                                        sx={{
                                            px: 0.7,
                                            py: 0.15,
                                            borderRadius: 0.75,
                                            border: `1px solid ${alpha(gnssFixStatusColor, 0.35)}`,
                                            backgroundColor: alpha(gnssFixStatusColor, 0.08),
                                            color: gnssFixStatusColor,
                                            fontWeight: 700,
                                            fontSize: '0.66rem',
                                        }}
                                    >
                                        {`fix: ${gnssFixStatusYesNo}`}
                                    </Box>
                                    <Typography
                                        variant="caption"
                                        sx={{
                                            color: 'text.secondary',
                                            whiteSpace: 'nowrap',
                                            display: { xs: 'none', lg: 'inline' },
                                            fontSize: '0.65rem',
                                        }}
                                    >
                                        {`last: ${gnssStatusStats.latestGnssEventMs ? formatTimestamp(gnssStatusStats.latestGnssEventMs) : '-'}`}
                                    </Typography>
                                </Box>
                            </Box>
                        </WaterfallStatusBarPaper>
                    </Box>
                )}
            </Box>
        </Box>
    );
});

export default DecodedInsightsIsland;
