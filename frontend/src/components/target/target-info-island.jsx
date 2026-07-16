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

import {useDispatch, useSelector} from "react-redux";
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import {
    getClassNamesBasedOnGridEditing,
    humanizeAltitude,
    humanizeDate,
    humanizeLatitude,
    humanizeLongitude,
    humanizeVelocity,
    getFrequencyBand,
    getBandColor,
    islandTitleBarSx,
    TitleBar
} from "../common/common.jsx";
import {
    Box,
    Typography,
    Divider,
    Chip,
    Button,
    Tooltip,
    IconButton
} from '@mui/material';
import TrackChangesIcon from '@mui/icons-material/TrackChanges';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import ExploreIcon from '@mui/icons-material/Explore';
import HeightIcon from '@mui/icons-material/Height';
import SpeedIcon from '@mui/icons-material/Speed';
import MyLocationIcon from '@mui/icons-material/MyLocation';
import PublicIcon from '@mui/icons-material/Public';
import RocketLaunchIcon from '@mui/icons-material/RocketLaunch';
import BusinessIcon from '@mui/icons-material/Business';
import RadioIcon from '@mui/icons-material/Radio';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import EditIcon from '@mui/icons-material/Edit';
import RadioButtonCheckedIcon from '@mui/icons-material/RadioButtonChecked';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import Grid from "@mui/material/Grid";
import React from "react";
import TransmittersDialog from "../satellites/transmitters-dialog.jsx";
import SatelliteEditDialog from "../satellites/satellite-edit-dialog.jsx";
import {fetchSatellite} from "./target-slice.jsx";
import {useSocket} from "../common/socket.jsx";
import TargetIcon from "../celestial/target-icon.jsx";
import SatelliteIcon from "../celestial/satellite-icon.jsx";
import { targetIdentifierSelector, targetTypeSelector, trackingStateSelector } from "./state-selectors.jsx";
import {
    buildTargetKeyFromTrackingState,
    normalizeTargetType as normalizeTrackingTargetType,
    resolveTargetDisplayName,
} from './celestial-target-utils.js';
// ElevationDisplay not used in target page; using satelliteData for elevation per request

const AU_IN_KM = 149597870.7;
const SECONDS_PER_DAY = 86400;
const AU_PER_DAY_TO_KM_PER_S = AU_IN_KM / SECONDS_PER_DAY;
const LIGHT_TIME_MIN_PER_AU = 8.316746397;
const KM_TO_MI = 0.621371192;

const magnitude3 = (vector) => {
    if (!Array.isArray(vector) || vector.length < 3) return NaN;
    const [x, y, z] = vector;
    if (![x, y, z].every((value) => Number.isFinite(value))) return NaN;
    return Math.sqrt(x * x + y * y + z * z);
};

const formatCountdownDiff = (diffMs) => {
    if (!Number.isFinite(diffMs) || diffMs <= 0) return '0s';
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);
    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
};

const TargetInfoIsland = () => {
    const { t } = useTranslation('target');
    const { t: tSat } = useTranslation('satellites');
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const { satelliteData, gridEditable, satelliteId, satellitePasses } = useSelector((state) => state.targetSatTrack);
    const targetType = useSelector(targetTypeSelector);
    const targetIdentifier = useSelector(targetIdentifierSelector);
    const trackingState = useSelector(trackingStateSelector);
    const celestialState = useSelector((state) => state.celestial || {});
    const monitoredRows = useSelector((state) => state.celestialMonitored?.monitored || []);
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
    const navigate = useNavigate();
    const transmitters = satelliteData?.transmitters || [];
    const [satelliteEditDialogOpen, setSatelliteEditDialogOpen] = React.useState(false);
    const [transmittersDialogOpen, setTransmittersDialogOpen] = React.useState(false);
    const [satelliteCountdown, setSatelliteCountdown] = React.useState('');
    const [nonSatelliteCountdown, setNonSatelliteCountdown] = React.useState('');
    const selectedNoradId = satelliteData?.details?.norad_id || satelliteId || null;
    const selectedSatelliteName = satelliteData?.details?.name || '';
    const hasTargets = trackerInstances.length > 0;
    const isSatelliteTarget = targetType === 'satellite';
    const hasSatelliteSelection = Boolean(selectedNoradId);
    const hasOperator = Boolean(
        satelliteData
        && satelliteData['details']
        && satelliteData['details']['operator']
        && satelliteData['details']['operator'] !== 'None'
    );
    const satelliteDialogData = {
        ...(satelliteData?.details || {}),
        norad_id: selectedNoradId,
        name: selectedSatelliteName,
        transmitters,
    };
    const detailsTargetType = normalizeTrackingTargetType(satelliteData?.details || {});
    // Mission/body retargets can temporarily show old satellite telemetry until worker updates arrive.
    const hasCurrentNonSatelliteTelemetry = !isSatelliteTarget && detailsTargetType === targetType;
    const nonSatelliteTargetKey = React.useMemo(
        () => buildTargetKeyFromTrackingState(trackingState),
        [trackingState],
    );
    const hasNonSatelliteTargetKey = Boolean(nonSatelliteTargetKey);
    const celestialRows = React.useMemo(
        () => (Array.isArray(celestialState?.celestialTracks?.celestial) ? celestialState.celestialTracks.celestial : []),
        [celestialState?.celestialTracks?.celestial],
    );
    const celestialPassRows = React.useMemo(
        () => (Array.isArray(celestialState?.celestialTracks?.celestial_passes) ? celestialState.celestialTracks.celestial_passes : []),
        [celestialState?.celestialTracks?.celestial_passes],
    );
    // Keep the info card resilient: prefer exact target_key, then fall back to command/body lookups.
    const nonSatelliteTrack = React.useMemo(() => {
        if (isSatelliteTarget) return null;
        if (nonSatelliteTargetKey) {
            const keyMatch = celestialRows.find((row) => String(row?.target_key || '').trim() === nonSatelliteTargetKey);
            if (keyMatch) return keyMatch;
        }
        if (targetType === 'mission') {
            const missionId = String(trackingState?.mission_id || '').trim();
            if (missionId) {
                return celestialRows.find((row) => String(row?.mission_id || row?.missionId || '').trim() === missionId) || null;
            }
            const command = String(trackingState?.command || '').trim();
            if (command) {
                return celestialRows.find((row) => String(row?.command || '').trim() === command) || null;
            }
            return null;
        }
        const bodyId = String(trackingState?.body_id || '').trim().toLowerCase();
        if (!bodyId) return null;
        return celestialRows.find((row) => {
            const rowBody = String(row?.body_id || row?.bodyId || row?.command || '').trim().toLowerCase();
            return rowBody === bodyId;
        }) || null;
    }, [celestialRows, isSatelliteTarget, nonSatelliteTargetKey, targetType, trackingState?.body_id, trackingState?.command]);
    // Monitored rows provide user-managed metadata (refresh timestamp, source mode, errors).
    const monitoredTarget = React.useMemo(() => {
        if (isSatelliteTarget) return null;
        if (nonSatelliteTargetKey) {
            const keyMatch = monitoredRows.find((row) => String(row?.targetKey || row?.target_key || '').trim() === nonSatelliteTargetKey);
            if (keyMatch) return keyMatch;
        }
        if (targetType === 'mission') {
            const missionId = String(trackingState?.mission_id || '').trim();
            if (missionId) {
                return monitoredRows.find((row) => String(row?.mission_id || row?.missionId || '').trim() === missionId) || null;
            }
            const command = String(trackingState?.command || '').trim();
            if (command) {
                return monitoredRows.find((row) => String(row?.command || '').trim() === command) || null;
            }
            return null;
        }
        const bodyId = String(trackingState?.body_id || '').trim().toLowerCase();
        if (!bodyId) return null;
        return monitoredRows.find((row) => {
            const rowBody = String(row?.bodyId || row?.body_id || row?.command || '').trim().toLowerCase();
            return rowBody === bodyId;
        }) || null;
    }, [isSatelliteTarget, monitoredRows, nonSatelliteTargetKey, targetType, trackingState?.body_id, trackingState?.command]);
    const nonSatelliteTargetName = String(
        resolveTargetDisplayName({
            trackingState,
            satelliteDetails: hasCurrentNonSatelliteTelemetry ? (satelliteData?.details || {}) : {},
            monitoredRows,
            celestialRows,
        })
        || targetIdentifier
        || ''
    ).trim();
    const nonSatelliteIdentifier = String(
        (targetType === 'mission'
            ? (trackingState?.mission_id || trackingState?.command)
            : trackingState?.body_id)
        || targetIdentifier
        || '-'
    ).trim();
    const nonSatelliteDialogData = React.useMemo(
        () => ({
            ...(satelliteData?.details || {}),
            name: nonSatelliteTargetName,
            target_key: nonSatelliteTargetKey,
            transmitters,
        }),
        [nonSatelliteTargetKey, nonSatelliteTargetName, satelliteData?.details, transmitters],
    );
    // Mission/body realtime pointing should come directly from tracker telemetry.
    const nonSatelliteAzimuth = hasCurrentNonSatelliteTelemetry
        ? Number(satelliteData?.position?.az)
        : NaN;
    const nonSatelliteElevation = hasCurrentNonSatelliteTelemetry
        ? Number(satelliteData?.position?.el)
        : NaN;
    const nonSatelliteVisible = Number.isFinite(nonSatelliteElevation)
        ? nonSatelliteElevation > 0
        : null;
    const nonSatelliteError = String(nonSatelliteTrack?.error || monitoredTarget?.lastError || '').trim();
    const nonSatelliteSource = String(
        nonSatelliteTrack?.source
        || (targetType === 'body' ? 'offline-solar-system' : 'horizons')
    ).trim() || '-';
    const nonSatelliteSourceMode = String(
        monitoredTarget?.sourceMode
        || monitoredTarget?.source_mode
        || (targetType === 'body' ? 'static-body' : 'catalog')
    ).trim() || '-';
    const nonSatelliteCache = String(nonSatelliteTrack?.cache || '-').trim() || '-';
    const nonSatelliteStale = Boolean(nonSatelliteTrack?.stale);
    const nonSatelliteSampleCount = Array.isArray(nonSatelliteTrack?.orbit_samples_xyz_au)
        ? nonSatelliteTrack.orbit_samples_xyz_au.length
        : 0;
    const nonSatelliteDistanceAu = magnitude3(nonSatelliteTrack?.position_xyz_au);
    const nonSatelliteDistanceKm = Number.isFinite(nonSatelliteDistanceAu) ? nonSatelliteDistanceAu * AU_IN_KM : NaN;
    const nonSatelliteSpeedAuPerDay = magnitude3(nonSatelliteTrack?.velocity_xyz_au_per_day);
    const nonSatelliteSpeedKmS = Number.isFinite(nonSatelliteSpeedAuPerDay) ? nonSatelliteSpeedAuPerDay * AU_PER_DAY_TO_KM_PER_S : NaN;
    const nonSatelliteSpeedMiS = Number.isFinite(nonSatelliteSpeedKmS) ? nonSatelliteSpeedKmS * KM_TO_MI : NaN;
    const nonSatelliteLightTimeMinutes = Number.isFinite(nonSatelliteDistanceAu) ? nonSatelliteDistanceAu * LIGHT_TIME_MIN_PER_AU : NaN;
    const nonSatelliteProjection = nonSatelliteTrack?.orbit_sampling || {};
    const nonSatelliteLastRefresh = monitoredTarget?.lastRefreshAt || monitoredTarget?.last_refresh_at || null;
    const nonSatelliteHasRealtime = Number.isFinite(nonSatelliteAzimuth) && Number.isFinite(nonSatelliteElevation);
    const satelliteAltitudeMeters = Number(satelliteData?.position?.alt);
    const satelliteVelocityKmS = Number(satelliteData?.position?.vel);
    const satelliteAltitudeMi = Number.isFinite(satelliteAltitudeMeters) ? satelliteAltitudeMeters / 1609.34 : NaN;
    const satelliteVelocityMiS = Number.isFinite(satelliteVelocityKmS) ? satelliteVelocityKmS * KM_TO_MI : NaN;
    const satelliteElevation = Number(satelliteData?.position?.el);
    const satelliteAzimuth = Number(satelliteData?.position?.az);
    const satelliteVisible = Number.isFinite(satelliteElevation) ? satelliteElevation > 0 : null;
    const satelliteVisibilityLabel = satelliteVisible === true
        ? 'Visible'
        : (satelliteVisible === false ? 'Below Horizon' : 'Unknown');
    const nonSatelliteStatusMeta = React.useMemo(() => {
        if (nonSatelliteError) {
            return {
                chipColor: 'error',
                chipLabel: 'Error',
                dotColor: 'error.main',
                gradient: (theme) => `linear-gradient(135deg, ${theme.palette.error.main}26 0%, ${theme.palette.error.main}0D 100%)`,
            };
        }
        if (nonSatelliteVisible === true) {
            return {
                chipColor: 'success',
                chipLabel: 'Visible',
                dotColor: 'success.main',
                gradient: (theme) => `linear-gradient(135deg, ${theme.palette.success.main}26 0%, ${theme.palette.success.main}0D 100%)`,
            };
        }
        if (nonSatelliteVisible === false) {
            return {
                chipColor: 'default',
                chipLabel: 'Below Horizon',
                dotColor: 'warning.main',
                gradient: (theme) => `linear-gradient(135deg, ${theme.palette.warning.main}26 0%, ${theme.palette.warning.main}0D 100%)`,
            };
        }
        return {
            chipColor: 'default',
            chipLabel: 'Unknown',
            dotColor: 'text.secondary',
            gradient: (theme) => `linear-gradient(135deg, ${theme.palette.overlay.light} 0%, ${theme.palette.overlay.main} 100%)`,
        };
    }, [nonSatelliteError, nonSatelliteVisible]);
    // Celestial passes are keyed by mission/body target_key instead of NORAD id.
    const nonSatellitePassInfo = React.useMemo(() => {
        if (isSatelliteTarget || !nonSatelliteTargetKey || celestialPassRows.length === 0) {
            return null;
        }
        const now = new Date();
        const targetPasses = celestialPassRows.filter((pass) => String(pass?.target_key || '').trim() === nonSatelliteTargetKey);
        const activePass = targetPasses.find((pass) => {
            const start = new Date(pass?.event_start);
            const end = new Date(pass?.event_end);
            return now >= start && now <= end;
        });
        if (activePass) {
            return { type: 'active', pass: activePass };
        }
        let nextPass = null;
        let earliestStart = null;
        for (const pass of targetPasses) {
            const start = new Date(pass?.event_start);
            if (start > now && (!earliestStart || start < earliestStart)) {
                earliestStart = start;
                nextPass = pass;
            }
        }
        if (nextPass) {
            return { type: 'upcoming', pass: nextPass };
        }
        return null;
    }, [celestialPassRows, isSatelliteTarget, nonSatelliteTargetKey]);
    const formatAngle = (value) => (Number.isFinite(value) ? `${value.toFixed(2)}°` : '--');

    const satellitePassInfo = React.useMemo(() => {
        if (!selectedNoradId || !Array.isArray(satellitePasses) || satellitePasses.length === 0) {
            return null;
        }
        const now = new Date();
        const selectedNorad = String(selectedNoradId);

        const activePass = satellitePasses.find((pass) => {
            if (String(pass?.norad_id ?? '') !== selectedNorad) return false;
            const start = new Date(pass?.event_start);
            const end = new Date(pass?.event_end);
            return now >= start && now <= end;
        });
        if (activePass) {
            return { type: 'active', pass: activePass };
        }

        let nextPass = null;
        let earliestStart = null;
        for (const pass of satellitePasses) {
            if (String(pass?.norad_id ?? '') !== selectedNorad) continue;
            const start = new Date(pass?.event_start);
            if (start > now && (!earliestStart || start < earliestStart)) {
                earliestStart = start;
                nextPass = pass;
            }
        }
        if (nextPass) {
            return { type: 'upcoming', pass: nextPass };
        }
        return null;
    }, [selectedNoradId, satellitePasses]);

    React.useEffect(() => {
        if (!satellitePassInfo) {
            setSatelliteCountdown('');
            return;
        }
        const updateCountdown = () => {
            const now = new Date();
            const targetTime = satellitePassInfo.type === 'active'
                ? new Date(satellitePassInfo.pass.event_end)
                : new Date(satellitePassInfo.pass.event_start);
            const diff = targetTime - now;
            setSatelliteCountdown(formatCountdownDiff(diff));
        };
        updateCountdown();
        const interval = window.setInterval(updateCountdown, 1000);
        return () => window.clearInterval(interval);
    }, [satellitePassInfo]);

    React.useEffect(() => {
        if (!nonSatellitePassInfo) {
            setNonSatelliteCountdown('');
            return;
        }
        const updateCountdown = () => {
            const now = new Date();
            const targetTime = nonSatellitePassInfo.type === 'active'
                ? new Date(nonSatellitePassInfo.pass.event_end)
                : new Date(nonSatellitePassInfo.pass.event_start);
            const diff = targetTime - now;
            setNonSatelliteCountdown(formatCountdownDiff(diff));
        };
        updateCountdown();
        const interval = window.setInterval(updateCountdown, 1000);
        return () => window.clearInterval(interval);
    }, [nonSatellitePassInfo]);

    const handleSatelliteSaved = () => {
        if (!selectedNoradId) {
            return;
        }
        dispatch(fetchSatellite({ socket, noradId: selectedNoradId }));
    };

    // Mini circular gauge for angular measurements
    const CircularGauge = ({ value, max, size = 36 }) => {
        const percentage = (value / max) * 100;
        const circumference = 2 * Math.PI * 13;
        const strokeDashoffset = circumference - (percentage / 100) * circumference;

        return (
            <Box sx={{ position: 'relative', width: size, height: size, display: 'inline-flex' }}>
                <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r="13"
                        stroke="rgba(255,255,255,0.08)"
                        strokeWidth="2.5"
                        fill="none"
                    />
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r="13"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        fill="none"
                        strokeDasharray={circumference}
                        strokeDashoffset={strokeDashoffset}
                        strokeLinecap="round"
                    />
                </svg>
            </Box>
        );
    };

    const DataPoint = ({ icon: Icon, label, value, unit = '', showGauge = false, gaugeValue, gaugeMax, emphasis = false }) => (
        <Box sx={{
            p: 1,
            bgcolor: 'overlay.light',
            borderRadius: 1,
            display: 'flex',
            flexDirection: 'column',
            height: '100%'
        }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                    <Icon sx={{ fontSize: 12, mr: 0.5, color: 'text.secondary' }} />
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        {label}
                    </Typography>
                </Box>
                {showGauge && gaugeValue !== undefined && (
                    <Box sx={{ color: emphasis ? 'primary.main' : 'secondary.main' }}>
                        <CircularGauge value={gaugeValue} max={gaugeMax} size={30} />
                    </Box>
                )}
            </Box>
            <Typography variant="h6" sx={{
                fontWeight: 600,
                color: emphasis ? 'primary.main' : 'text.primary',
                lineHeight: 1.2,
                fontFamily: 'monospace',
                fontSize: '1rem'
            }}>
                {value}
                {unit && <Typography component="span" variant="caption" sx={{ ml: 0.5, color: 'text.secondary', fontFamily: 'inherit' }}>{unit}</Typography>}
            </Typography>
        </Box>
    );

    const Section = ({ title, icon: Icon, children }) => (
        <Box sx={{ mb: 1.5 }}>
            <Box sx={{
                display: 'flex',
                alignItems: 'center',
                mb: 1
            }}>
                <Icon sx={{ fontSize: 14, mr: 0.75, color: 'secondary.main' }} />
                <Typography variant="overline" sx={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    color: 'secondary.main',
                    letterSpacing: '0.5px'
                }}>
                    {title}
                </Typography>
            </Box>
            {children}
        </Box>
    );

    const formatFrequencyRange = (lowHz, highHz) => {
        if (!lowHz && !highHz) return t('satellite_info.values.na');
        if (lowHz && highHz) return `${(lowHz / 1e6).toFixed(3)}-${(highHz / 1e6).toFixed(3)} MHz`;
        const hz = lowHz || highHz;
        return `${(hz / 1e6).toFixed(3)} MHz`;
    };

    return (
        <Box sx={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: 'background.paper',
            backdropFilter: 'blur(10px)',
            backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.05))'
        }}>
            {/* Header */}
            <TitleBar
                className={getClassNamesBasedOnGridEditing(gridEditable, ["window-title-bar"])}
                sx={islandTitleBarSx}
            >
                <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%'}}>
                    <Box sx={{display: 'flex', alignItems: 'center'}}>
                        <Typography variant="subtitle2" sx={{fontWeight: 'bold'}}>
                            Target Info
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Typography variant="caption" sx={{color: 'text.secondary'}}>
                            {isSatelliteTarget
                                ? `ID: ${satelliteData && satelliteData['details'] ? satelliteData['details']['norad_id'] : ''}`
                                : `Type: ${targetType}`}
                        </Typography>
                    </Box>
                </Box>
            </TitleBar>

            {isSatelliteTarget ? (
                <>
            {!hasSatelliteSelection && (
                <Box
                    sx={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        px: 2,
                    }}
                >
                    <Box
                        sx={{
                            width: '100%',
                            maxWidth: 380,
                            textAlign: 'center',
                            p: 2.5,
                            borderRadius: 1.25,
                            border: '1px dashed',
                            borderColor: 'border.main',
                            backgroundColor: 'overlay.light',
                        }}
                    >
                        <TrackChangesIcon sx={{ color: 'text.secondary', mb: 1 }} />
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                            {hasTargets ? 'No satellite selected' : 'No targets configured'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            {hasTargets
                                ? 'Choose a satellite from the target selector to view live orbital details.'
                                : 'Create a target first, then select a satellite to see telemetry and metadata.'}
                        </Typography>
                    </Box>
                </Box>
            )}

            {hasSatelliteSelection && (
            <>
            {/* Satellite Status Header - Sticky */}
            <Box sx={{
                p: 1,
                background: satelliteData && satelliteData['details'] ?
                    (() => {
                        const status = satelliteData['details']['status'];
                        switch(status) {
                            case 'alive': return (theme) => `linear-gradient(135deg, ${theme.palette.success.main}26 0%, ${theme.palette.success.main}0D 100%)`;
                            case 'dead': return (theme) => `linear-gradient(135deg, ${theme.palette.error.main}26 0%, ${theme.palette.error.main}0D 100%)`;
                            case 're-entered': return (theme) => `linear-gradient(135deg, ${theme.palette.warning.main}26 0%, ${theme.palette.warning.main}0D 100%)`;
                            default: return (theme) => `linear-gradient(135deg, ${theme.palette.overlay.light} 0%, ${theme.palette.overlay.main} 100%)`;
                        }
                    })() : (theme) => `linear-gradient(135deg, ${theme.palette.overlay.light} 0%, ${theme.palette.overlay.main} 100%)`,
                borderBottom: '1px solid',
                borderColor: 'border.main'
            }}>
                <Box
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: 'minmax(0, 1fr) 72px',
                        gridTemplateRows: 'auto auto',
                        columnGap: 1,
                        rowGap: 0.75,
                        alignItems: 'center',
                    }}
                >
                    <Box sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                        <Box sx={{
                            width: 10,
                            height: 10,
                            borderRadius: '50%',
                            mr: 1,
                            flexShrink: 0,
                            bgcolor: satelliteData && satelliteData['details'] && satelliteData['details']['status'] === 'alive' ? 'success.main' : 'error.main',
                            boxShadow: (theme) => `0 0 8px ${satelliteData && satelliteData['details'] && satelliteData['details']['status'] === 'alive' ? theme.palette.success.main : theme.palette.error.main}`
                        }} />
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                                <Typography
                                    variant="subtitle1"
                                    noWrap
                                    sx={{ fontWeight: 700, letterSpacing: '0.3px', minWidth: 0 }}
                                >
                                    {satelliteData && satelliteData['details']
                                        ? `${satelliteData['details']['name']}${satelliteData['details']['name_other'] ? ` • ${satelliteData['details']['name_other']}` : ''}`
                                        : "NO DATA"}
                                </Typography>
                                <Tooltip title="Edit Details">
                                    <span>
                                        <IconButton
                                            size="small"
                                            onClick={() => setSatelliteEditDialogOpen(true)}
                                            disabled={!selectedNoradId}
                                        >
                                            <EditIcon fontSize="small" />
                                        </IconButton>
                                    </span>
                                </Tooltip>
                                <Tooltip title="Edit Transmitters">
                                    <span>
                                        <IconButton
                                            size="small"
                                            onClick={() => setTransmittersDialogOpen(true)}
                                            disabled={!selectedNoradId}
                                        >
                                            <RadioButtonCheckedIcon fontSize="small" />
                                        </IconButton>
                                    </span>
                                </Tooltip>
                            </Box>
                        </Box>
                    </Box>

                    <Box
                        sx={{
                            gridRow: '1 / span 2',
                            gridColumn: 2,
                            alignSelf: 'stretch',
                            justifySelf: 'stretch',
                            width: '100%',
                            height: '100%',
                            minHeight: 52,
                            position: 'relative',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                        }}
                    >
                        <SatelliteIcon
                            satelliteId={selectedNoradId}
                            size="100%"
                            alt={selectedSatelliteName || 'Satellite'}
                            sx={{ position: 'absolute', inset: 0, margin: 'auto', width: '100%', height: '100%', objectFit: 'contain' }}
                        />
                    </Box>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0, overflow: 'hidden' }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', px: 0.5, py: 0.3, bgcolor: 'overlay.main', borderRadius: 0.5, minWidth: 0 }}>
                            {satelliteVisible === true ? (
                                <CheckCircleIcon sx={{ fontSize: 11, mr: 0.4, color: 'success.main' }} />
                            ) : satelliteVisible === false ? (
                                <CancelIcon sx={{ fontSize: 11, mr: 0.4, color: 'warning.main' }} />
                            ) : (
                                <InfoOutlinedIcon sx={{ fontSize: 11, mr: 0.4, color: 'text.secondary' }} />
                            )}
                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.68rem' }} noWrap>
                                {satelliteVisibilityLabel}
                            </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', px: 0.5, py: 0.3, bgcolor: 'overlay.main', borderRadius: 0.5, minWidth: 0, flex: 1 }}>
                            <AccessTimeIcon sx={{ fontSize: 11, mr: 0.4, color: 'text.secondary' }} />
                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.68rem' }} noWrap>
                                {satellitePassInfo && satelliteCountdown
                                    ? (satellitePassInfo.type === 'active' ? `Pass ends in ${satelliteCountdown}` : `Next pass in ${satelliteCountdown}`)
                                    : 'No upcoming pass'}
                            </Typography>
                        </Box>
                        {hasOperator && (
                            <Box sx={{ display: 'flex', alignItems: 'center', px: 0.5, py: 0.3, bgcolor: 'overlay.main', borderRadius: 0.5, minWidth: 0 }}>
                                <BusinessIcon sx={{ fontSize: 11, mr: 0.4, color: 'text.secondary' }} />
                                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.68rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {satelliteData['details']['operator']}
                                </Typography>
                            </Box>
                        )}
                    </Box>
                </Box>
            </Box>

            {/* Main Content */}
            <Box sx={{ pr: 1.5, pl: 1.5, pt: 1.5, pb: 1, flex: 1, overflow: 'auto' }}>
                {/* Real-time Position Data - Priority Section */}
                <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                    <ExploreIcon sx={{ fontSize: 14, mr: 0.75, color: 'primary.main' }} />
                    <Typography variant="overline" sx={{
                        fontSize: '0.7rem',
                        fontWeight: 700,
                        color: 'primary.main',
                        letterSpacing: '0.5px'
                    }}>
                        Real-Time Position
                    </Typography>
                </Box>
                <Box sx={{
                    mb: 1.5,
                    p: 1.25,
                    bgcolor: 'overlay.light',
                    borderRadius: 1
                }}>
                    <Grid container spacing={1}>
                        <Grid size={6}>
                            <Box sx={{
                                textAlign: 'center',
                                p: 1,
                                bgcolor: 'background.paper',
                                borderRadius: 1,
                                border: '1px solid',
                                borderColor: 'divider'
                            }}>
                                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', mb: 0.5 }}>
                                    Elevation
                                </Typography>
                                <Typography variant="h4" sx={{ fontWeight: 700, color: 'primary.main', fontFamily: 'monospace', lineHeight: 1, fontSize: '1.5rem' }}>
                                    {Number.isFinite(satelliteElevation)
                                        ? `${satelliteElevation.toFixed(2)}°`
                                        : '--'}
                                </Typography>
                            </Box>
                        </Grid>
                        <Grid size={6}>
                            <Box sx={{
                                textAlign: 'center',
                                p: 1,
                                bgcolor: 'background.paper',
                                borderRadius: 1,
                                border: '1px solid',
                                borderColor: 'divider'
                            }}>
                                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', mb: 0.5 }}>
                                    Azimuth
                                </Typography>
                                <Typography variant="h4" sx={{ fontWeight: 700, color: 'secondary.main', fontFamily: 'monospace', lineHeight: 1, fontSize: '1.5rem' }}>
                                    {Number.isFinite(satelliteAzimuth) ? `${satelliteAzimuth.toFixed(2)}°` : '--'}
                                </Typography>
                            </Box>
                        </Grid>
                        <Grid size={6}>
                            <Box sx={{
                                textAlign: 'center',
                                p: 1,
                                bgcolor: 'background.paper',
                                borderRadius: 1,
                                border: '1px solid',
                                borderColor: 'divider'
                            }}>
                                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', mb: 0.5 }}>
                                    Altitude
                                </Typography>
                                <Typography variant="h5" sx={{ fontWeight: 700, color: 'text.primary', fontFamily: 'monospace', lineHeight: 1 }}>
                                    {satelliteData && satelliteData['position'] ? humanizeAltitude(satelliteData['position']['alt'], 0) : '--'}
                                    <Typography component="span" sx={{ ml: 0.5, fontSize: '0.7rem', color: 'text.secondary' }}>km</Typography>
                                </Typography>
                                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.62rem' }}>
                                    {Number.isFinite(satelliteAltitudeMi) ? `${satelliteAltitudeMi.toFixed(1)} mi` : ''}
                                </Typography>
                            </Box>
                        </Grid>
                        <Grid size={6}>
                            <Box sx={{
                                textAlign: 'center',
                                p: 1,
                                bgcolor: 'background.paper',
                                borderRadius: 1,
                                border: '1px solid',
                                borderColor: 'divider'
                            }}>
                                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', mb: 0.5 }}>
                                    Velocity
                                </Typography>
                                <Typography variant="h5" sx={{ fontWeight: 700, color: 'text.primary', fontFamily: 'monospace', lineHeight: 1 }}>
                                    {satelliteData && satelliteData['position'] ? humanizeVelocity(satelliteData['position']['vel']) : '--'}
                                    <Typography component="span" sx={{ ml: 0.5, fontSize: '0.7rem', color: 'text.secondary' }}>km/s</Typography>
                                </Typography>
                                <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.62rem' }}>
                                    {Number.isFinite(satelliteVelocityMiS) ? `${satelliteVelocityMiS.toFixed(3)} mi/s` : ''}
                                </Typography>
                            </Box>
                        </Grid>
                    </Grid>
                </Box>

                {/* Geographic Position */}
                <Section title={t('satellite_info.sections.position_data')} icon={PublicIcon}>
                    <Grid container spacing={0.75}>
                        <Grid size={6}>
                            <DataPoint
                                icon={PublicIcon}
                                label={t('satellite_info.labels.latitude')}
                                value={satelliteData && satelliteData['position'] ? humanizeLatitude(satelliteData['position']['lat']) : t('satellite_info.values.na')}
                                emphasis
                            />
                        </Grid>
                        <Grid size={6}>
                            <DataPoint
                                icon={PublicIcon}
                                label={t('satellite_info.labels.longitude')}
                                value={satelliteData && satelliteData['position'] ? humanizeLongitude(satelliteData['position']['lon']) : t('satellite_info.values.na')}
                                emphasis
                            />
                        </Grid>
                    </Grid>
                </Section>

                <Divider sx={{ my: 1, borderColor: 'border.main' }} />

                {/* Orbital Data */}
                <Section title={t('satellite_info.sections.orbital_data')} icon={SpeedIcon}>
                    <Grid container spacing={0.75}>
                        <Grid size={6}>
                            <DataPoint
                                icon={HeightIcon}
                                label={t('satellite_info.labels.altitude')}
                                value={satelliteData && satelliteData['position'] ? humanizeAltitude(satelliteData['position']['alt'], 0) : t('satellite_info.values.na')}
                                unit="km"
                            />
                        </Grid>
                        <Grid size={6}>
                            <DataPoint
                                icon={SpeedIcon}
                                label={t('satellite_info.labels.velocity')}
                                value={satelliteData && satelliteData['position'] ? humanizeVelocity(satelliteData['position']['vel']) : t('satellite_info.values.na')}
                                unit="km/s"
                            />
                        </Grid>
                        <Grid size={12}>
                            <Box sx={{
                                p: 1,
                                bgcolor: 'overlay.light',
                                borderRadius: 1,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between'
                            }}>
                                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                    {satelliteData && satelliteData['details'] && satelliteData['details']['is_geostationary'] ?
                                        <CheckCircleIcon sx={{ fontSize: 14, mr: 0.75, color: 'success.main' }} /> :
                                        <CancelIcon sx={{ fontSize: 14, mr: 0.75, color: 'text.secondary' }} />
                                    }
                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                        {t('satellite_info.labels.geostationary')}
                                    </Typography>
                                </Box>
                                <Chip
                                    label={satelliteData && satelliteData['details'] && satelliteData['details']['is_geostationary'] ? t('satellite_info.values.yes') : t('satellite_info.values.no')}
                                    size="small"
                                    color={satelliteData && satelliteData['details'] && satelliteData['details']['is_geostationary'] ? 'success' : 'default'}
                                    sx={{ height: 18, fontSize: '0.65rem', fontWeight: 600 }}
                                />
                            </Box>
                        </Grid>
                    </Grid>
                </Section>

                <Divider sx={{ my: 1, borderColor: 'border.main' }} />

                {/* Compact Transmitters */}
                <Section title={t('satellite_transmitters.title')} icon={RadioIcon}>
                    <Box sx={{ p: 1, bgcolor: 'overlay.light', borderRadius: 1 }}>
                        <Grid container spacing={1} sx={{ mb: 1 }}>
                            <Grid size={6}>
                                <Box sx={{ textAlign: 'center' }}>
                                    <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary', fontFamily: 'monospace', lineHeight: 1 }}>
                                        {transmitters.length}
                                    </Typography>
                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem', textTransform: 'uppercase' }}>
                                        {t('satellite_transmitters.labels.total')}
                                    </Typography>
                                </Box>
                            </Grid>
                            <Grid size={6}>
                                <Box sx={{ textAlign: 'center' }}>
                                    <Typography variant="h6" sx={{ fontWeight: 700, color: 'success.main', fontFamily: 'monospace', lineHeight: 1 }}>
                                        {transmitters.filter(tx => tx?.alive && tx?.status === 'active').length}
                                    </Typography>
                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6rem', textTransform: 'uppercase' }}>
                                        {t('satellite_transmitters.labels.active')}
                                    </Typography>
                                </Box>
                            </Grid>
                        </Grid>

                        {transmitters.length > 0 ? (
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.65 }}>
                                {[...transmitters]
                                    .sort((a, b) => {
                                        const aActive = Number(Boolean(a?.alive && a?.status === 'active'));
                                        const bActive = Number(Boolean(b?.alive && b?.status === 'active'));
                                        return bActive - aActive;
                                    })
                                    .slice(0, 4)
                                    .map((tx, idx) => {
                                        const band = tx?.downlink_low ? getFrequencyBand(tx.downlink_low) : null;
                                        const isActive = tx?.alive && tx?.status === 'active';
                                        return (
                                            <Box
                                                key={tx?.id || idx}
                                                sx={{
                                                    px: 0.75,
                                                    py: 0.55,
                                                    borderRadius: 0.8,
                                                    bgcolor: 'background.paper',
                                                    border: '1px solid',
                                                    borderColor: isActive ? 'success.dark' : 'border.main',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    gap: 0.6
                                                }}
                                            >
                                                <Box sx={{ minWidth: 0, flex: 1 }}>
                                                    <Typography
                                                        variant="caption"
                                                        noWrap
                                                        sx={{ fontSize: '0.66rem', fontWeight: 700, color: 'text.primary', display: 'block' }}
                                                    >
                                                        {tx?.description || t('satellite_info.values.na')}
                                                    </Typography>
                                                    <Typography
                                                        variant="caption"
                                                        noWrap
                                                        sx={{ fontSize: '0.62rem', color: 'text.secondary', fontFamily: 'monospace', display: 'block' }}
                                                    >
                                                        {formatFrequencyRange(tx?.downlink_low, tx?.downlink_high)}
                                                        {tx?.mode ? ` • ${tx.mode}` : ''}
                                                    </Typography>
                                                </Box>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                                                    {band && (
                                                        <Box
                                                            sx={{
                                                                px: 0.7,
                                                                py: 0.2,
                                                                borderRadius: 99,
                                                                bgcolor: getBandColor(band) || 'primary.main'
                                                            }}
                                                        >
                                                            <Typography variant="caption" sx={{ color: '#fff', fontSize: '0.58rem', fontWeight: 700 }}>
                                                                {band}
                                                            </Typography>
                                                        </Box>
                                                    )}
                                                    <Chip
                                                        label={isActive ? 'ACTIVE' : 'INACTIVE'}
                                                        size="small"
                                                        color={isActive ? 'success' : 'default'}
                                                        sx={{ height: 18, fontSize: '0.56rem', fontWeight: 700 }}
                                                    />
                                                </Box>
                                            </Box>
                                        );
                                    })}
                                {transmitters.length > 4 && (
                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.62rem', textAlign: 'center', pt: 0.25 }}>
                                        +{transmitters.length - 4} more
                                    </Typography>
                                )}
                            </Box>
                        ) : (
                            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', textAlign: 'center', py: 0.5 }}>
                                {t('satellite_transmitters.messages.no_transmitters')}
                            </Typography>
                        )}
                    </Box>
                </Section>

                <Divider sx={{ my: 1, borderColor: 'border.main' }} />

                {/* TLE Data */}
                {satelliteData && satelliteData['details'] && satelliteData['details']['tle1'] && (
                    <>
                        <Section title="TLE Data" icon={SatelliteAltIcon}>
                            <Box sx={{
                                p: 1,
                                bgcolor: 'overlay.light',
                                borderRadius: 1
                            }}>
                                <Typography variant="caption" sx={{
                                    color: 'text.secondary',
                                    fontSize: '0.55rem',
                                    display: 'block',
                                    mb: 0.5,
                                    textTransform: 'uppercase'
                                }}>
                                    Line 1
                                </Typography>
                                <Typography variant="caption" sx={{
                                    color: 'text.primary',
                                    fontFamily: 'monospace',
                                    fontSize: '0.6rem',
                                    display: 'block',
                                    mb: 1,
                                    wordBreak: 'break-all'
                                }}>
                                    {satelliteData['details']['tle1']}
                                </Typography>

                                <Typography variant="caption" sx={{
                                    color: 'text.secondary',
                                    fontSize: '0.55rem',
                                    display: 'block',
                                    mb: 0.5,
                                    textTransform: 'uppercase'
                                }}>
                                    Line 2
                                </Typography>
                                <Typography variant="caption" sx={{
                                    color: 'text.primary',
                                    fontFamily: 'monospace',
                                    fontSize: '0.6rem',
                                    display: 'block',
                                    wordBreak: 'break-all'
                                }}>
                                    {satelliteData['details']['tle2']}
                                </Typography>
                            </Box>
                        </Section>

                        <Divider sx={{ my: 1, borderColor: 'border.main' }} />
                    </>
                )}

                {/* Additional Metadata */}
                <Section title={t('satellite_info.sections.metadata')} icon={RocketLaunchIcon}>
                    <Box sx={{
                        p: 1,
                        bgcolor: 'overlay.light',
                        borderRadius: 1
                    }}>
                        <Grid container spacing={1}>
                            <Grid size={12}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', textTransform: 'uppercase' }}>
                                        {t('satellite_info.labels.satellite_id')}
                                    </Typography>
                                    <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 600, fontSize: '0.65rem', fontFamily: 'monospace' }}>
                                        {satelliteData && satelliteData['details'] ? satelliteData['details']['sat_id'] : t('satellite_info.values.na')}
                                    </Typography>
                                </Box>
                            </Grid>
                            <Grid size={12}>
                                <Divider sx={{ my: 0.5 }} />
                            </Grid>
                            <Grid size={12}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', textTransform: 'uppercase' }}>
                                        Added to DB
                                    </Typography>
                                    <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 600, fontSize: '0.65rem' }}>
                                        {satelliteData && satelliteData['details'] ? humanizeDate(satelliteData['details']['added']) : t('satellite_info.values.na')}
                                    </Typography>
                                </Box>
                            </Grid>
                            <Grid size={12}>
                                <Divider sx={{ my: 0.5 }} />
                            </Grid>
                            <Grid size={12}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', textTransform: 'uppercase' }}>
                                        Launched
                                    </Typography>
                                    <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 600, fontSize: '0.65rem' }}>
                                        {satelliteData && satelliteData['details'] ? humanizeDate(satelliteData['details']['launched']) : t('satellite_info.values.na')}
                                    </Typography>
                                </Box>
                            </Grid>
                            <Grid size={12}>
                                <Divider sx={{ my: 0.5 }} />
                            </Grid>
                            <Grid size={12}>
                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', textTransform: 'uppercase' }}>
                                        Updated
                                    </Typography>
                                    <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 600, fontSize: '0.65rem' }}>
                                        {satelliteData && satelliteData['details'] ? humanizeDate(satelliteData['details']['updated']) : t('satellite_info.values.na')}
                                    </Typography>
                                </Box>
                            </Grid>
                            {satelliteData && satelliteData['details'] && satelliteData['details']['website'] && (
                                <>
                                    <Grid size={12}>
                                        <Divider sx={{ my: 0.5 }} />
                                    </Grid>
                                    <Grid size={12}>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', textTransform: 'uppercase' }}>
                                                Website
                                            </Typography>
                                            <Typography
                                                component="a"
                                                href={satelliteData['details']['website']}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                variant="caption"
                                                sx={{
                                                    color: 'primary.main',
                                                    fontWeight: 600,
                                                    fontSize: '0.65rem',
                                                    textDecoration: 'none',
                                                    '&:hover': {
                                                        textDecoration: 'underline'
                                                    }
                                                }}
                                            >
                                                Link ↗
                                            </Typography>
                                        </Box>
                                    </Grid>
                                </>
                            )}
                            {satelliteData && satelliteData['details'] && satelliteData['details']['citation'] && (
                                <>
                                    <Grid size={12}>
                                        <Divider sx={{ my: 0.5 }} />
                                    </Grid>
                                    <Grid size={12}>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', textTransform: 'uppercase' }}>
                                                Citation
                                            </Typography>
                                            <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 600, fontSize: '0.65rem', fontStyle: 'italic' }}>
                                                {satelliteData['details']['citation']}
                                            </Typography>
                                        </Box>
                                    </Grid>
                                </>
                            )}
                        </Grid>
                    </Box>
                </Section>

                {/* View Details Button */}
                {satelliteData && satelliteData['details'] && satelliteData['details']['norad_id'] && (
                    <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 0.5, width: '100%' }}>
                        <Button
                            variant="text"
                            size="small"
                            startIcon={<EditIcon sx={{ fontSize: 14 }} />}
                            onClick={() => setSatelliteEditDialogOpen(true)}
                            disabled={!selectedNoradId}
                            sx={{
                                flex: 1,
                                minWidth: 0,
                                fontSize: '0.65rem',
                                textTransform: 'none',
                                color: 'text.secondary',
                                '&:hover': {
                                    color: 'primary.main',
                                    bgcolor: 'transparent'
                                }
                            }}
                        >
                            Edit Details
                        </Button>
                        <Button
                            variant="text"
                            size="small"
                            startIcon={<RadioButtonCheckedIcon sx={{ fontSize: 14 }} />}
                            onClick={() => setTransmittersDialogOpen(true)}
                            disabled={!selectedNoradId}
                            sx={{
                                flex: 1,
                                minWidth: 0,
                                fontSize: '0.65rem',
                                textTransform: 'none',
                                color: 'text.secondary',
                                '&:hover': {
                                    color: 'primary.main',
                                    bgcolor: 'transparent'
                                }
                            }}
                        >
                            Edit Transmitters
                        </Button>
                        <Button
                            variant="text"
                            size="small"
                            startIcon={<InfoOutlinedIcon sx={{ fontSize: 14 }} />}
                            onClick={() => navigate(`/satellites/${satelliteData['details']['norad_id']}`)}
                            sx={{
                                flex: 1,
                                minWidth: 0,
                                fontSize: '0.65rem',
                                textTransform: 'none',
                                color: 'text.secondary',
                                '&:hover': {
                                    color: 'primary.main',
                                    bgcolor: 'transparent'
                                }
                            }}
                        >
                            View Full Details
                        </Button>
                    </Box>
                )}
            </Box>
            <SatelliteEditDialog
                open={satelliteEditDialogOpen}
                onClose={() => setSatelliteEditDialogOpen(false)}
                satelliteData={satelliteDialogData}
                onSaved={handleSatelliteSaved}
            />
            </>
            )}
                </>
            ) : (
                <>
                    <Box sx={{
                        p: 1,
                        background: nonSatelliteStatusMeta.gradient,
                        borderBottom: '1px solid',
                        borderColor: 'border.main',
                    }}>
                        <Box sx={{ display: 'flex', alignItems: 'stretch', gap: 0.5 }}>
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
                                        <Box sx={{
                                            width: 10,
                                            height: 10,
                                            borderRadius: '50%',
                                            mr: 1,
                                            flexShrink: 0,
                                            bgcolor: nonSatelliteStatusMeta.dotColor,
                                            boxShadow: (theme) => `0 0 8px ${theme.palette[nonSatelliteStatusMeta.chipColor]?.main || theme.palette.text.secondary}`,
                                        }} />
                                        <Box sx={{ minWidth: 0, flex: 1 }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                                                <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700, letterSpacing: '0.3px' }}>
                                                    {nonSatelliteTargetName || '-'}
                                                    <Typography
                                                        component="span"
                                                        variant="caption"
                                                        sx={{ ml: 0.75, color: 'text.secondary', fontWeight: 500, fontSize: '0.7rem' }}
                                                    >
                                                        {targetType === 'mission'
                                                            ? (nonSatelliteIdentifier || '-')
                                                            : `Body ID · ${nonSatelliteIdentifier || '-'}`}
                                                    </Typography>
                                                </Typography>
                                                <Tooltip title="Edit Transmitters">
                                                    <span>
                                                        <IconButton
                                                            size="small"
                                                            onClick={() => setTransmittersDialogOpen(true)}
                                                            disabled={!hasNonSatelliteTargetKey}
                                                        >
                                                            <RadioButtonCheckedIcon fontSize="small" />
                                                        </IconButton>
                                                    </span>
                                                </Tooltip>
                                            </Box>
                                        </Box>
                                    </Box>
                                </Box>

                                <Grid container spacing={0.5}>
                                    <Grid size={4}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', px: 0.5, py: 0.3, bgcolor: 'overlay.main', borderRadius: 0.5 }}>
                                            {nonSatelliteVisible === true ? (
                                                <CheckCircleIcon sx={{ fontSize: 11, mr: 0.4, color: 'success.main' }} />
                                            ) : nonSatelliteError ? (
                                                <CancelIcon sx={{ fontSize: 11, mr: 0.4, color: 'error.main' }} />
                                            ) : nonSatelliteVisible === false ? (
                                                <CancelIcon sx={{ fontSize: 11, mr: 0.4, color: 'warning.main' }} />
                                            ) : (
                                                <InfoOutlinedIcon sx={{ fontSize: 11, mr: 0.4, color: 'text.secondary' }} />
                                            )}
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.68rem' }} noWrap>
                                                {nonSatelliteStatusMeta.chipLabel}
                                            </Typography>
                                        </Box>
                                    </Grid>
                                    <Grid size={8}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', px: 0.5, py: 0.3, bgcolor: 'overlay.main', borderRadius: 0.5 }}>
                                            <AccessTimeIcon sx={{ fontSize: 11, mr: 0.4, color: 'text.secondary' }} />
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.68rem' }} noWrap>
                                                {nonSatellitePassInfo && nonSatelliteCountdown
                                                    ? (nonSatellitePassInfo.type === 'active' ? `Pass ends in ${nonSatelliteCountdown}` : `Next pass in ${nonSatelliteCountdown}`)
                                                    : 'No upcoming pass'}
                                            </Typography>
                                        </Box>
                                    </Grid>
                                </Grid>
                            </Box>
                            <Box
                                sx={{
                                    width: 64,
                                    minWidth: 64,
                                    borderRadius: 0.5,
                                    bgcolor: 'overlay.main',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    position: 'relative',
                                }}
                            >
                                <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <TargetIcon
                                        targetType={targetType}
                                        bodyId={nonSatelliteIdentifier}
                                        size={44}
                                        alt={nonSatelliteTargetName || 'Target'}
                                        showMoonPhase={targetType === 'body'}
                                    />
                                </Box>
                            </Box>
                        </Box>
                    </Box>

                    <Box sx={{ pr: 1.5, pl: 1.5, pt: 1.5, pb: 1, flex: 1, overflow: 'auto' }}>
                        {!nonSatelliteHasRealtime ? (
                            <Typography variant="caption" sx={{ color: 'warning.main', display: 'block', mb: 1.25 }}>
                                Waiting for updated mission/body telemetry.
                            </Typography>
                        ) : null}

                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
                            <ExploreIcon sx={{ fontSize: 14, mr: 0.75, color: 'primary.main' }} />
                            <Typography variant="overline" sx={{
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                color: 'primary.main',
                                letterSpacing: '0.5px',
                            }}>
                                Real-Time Position
                            </Typography>
                        </Box>
                        <Box sx={{ mb: 1.5, p: 1.25, bgcolor: 'overlay.light', borderRadius: 1 }}>
                            <Grid container spacing={1}>
                                <Grid size={6}>
                                    <Box sx={{
                                        textAlign: 'center',
                                        p: 1,
                                        bgcolor: 'background.paper',
                                        borderRadius: 1,
                                        border: '1px solid',
                                        borderColor: 'divider',
                                    }}>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', mb: 0.5 }}>
                                            Elevation
                                        </Typography>
                                        <Typography variant="h4" sx={{ fontWeight: 700, color: 'primary.main', fontFamily: 'monospace', lineHeight: 1, fontSize: '1.5rem' }}>
                                            {formatAngle(nonSatelliteElevation)}
                                        </Typography>
                                    </Box>
                                </Grid>
                                <Grid size={6}>
                                    <Box sx={{
                                        textAlign: 'center',
                                        p: 1,
                                        bgcolor: 'background.paper',
                                        borderRadius: 1,
                                        border: '1px solid',
                                        borderColor: 'divider',
                                    }}>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', mb: 0.5 }}>
                                            Azimuth
                                        </Typography>
                                        <Typography variant="h4" sx={{ fontWeight: 700, color: 'secondary.main', fontFamily: 'monospace', lineHeight: 1, fontSize: '1.5rem' }}>
                                            {formatAngle(nonSatelliteAzimuth)}
                                        </Typography>
                                    </Box>
                                </Grid>
                                <Grid size={6}>
                                    <Box sx={{
                                        textAlign: 'center',
                                        p: 1,
                                        bgcolor: 'background.paper',
                                        borderRadius: 1,
                                        border: '1px solid',
                                        borderColor: 'divider',
                                    }}>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', mb: 0.5 }}>
                                            Distance from Sun
                                        </Typography>
                                        <Typography variant="h5" sx={{ fontWeight: 700, color: 'text.primary', fontFamily: 'monospace', lineHeight: 1 }}>
                                            {Number.isFinite(nonSatelliteDistanceAu) ? `${nonSatelliteDistanceAu.toFixed(2)} AU` : '--'}
                                        </Typography>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.62rem' }}>
                                            {Number.isFinite(nonSatelliteDistanceKm) ? `${(nonSatelliteDistanceKm / 1e6).toFixed(2)}M km` : ''}
                                        </Typography>
                                    </Box>
                                </Grid>
                                <Grid size={6}>
                                    <Box sx={{
                                        textAlign: 'center',
                                        p: 1,
                                        bgcolor: 'background.paper',
                                        borderRadius: 1,
                                        border: '1px solid',
                                        borderColor: 'divider',
                                    }}>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.55rem', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'block', mb: 0.5 }}>
                                            Speed
                                        </Typography>
                                        <Typography variant="h5" sx={{ fontWeight: 700, color: 'text.primary', fontFamily: 'monospace', lineHeight: 1 }}>
                                            {Number.isFinite(nonSatelliteSpeedKmS) ? nonSatelliteSpeedKmS.toFixed(3) : '--'}
                                            <Typography component="span" sx={{ ml: 0.5, fontSize: '0.7rem', color: 'text.secondary' }}>km/s</Typography>
                                        </Typography>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.62rem' }}>
                                            {Number.isFinite(nonSatelliteSpeedMiS) ? `${nonSatelliteSpeedMiS.toFixed(3)} mi/s` : ''}
                                        </Typography>
                                    </Box>
                                </Grid>
                            </Grid>
                        </Box>

                        <Section title="Target Geometry" icon={TrackChangesIcon}>
                            <Grid container spacing={0.75}>
                                <Grid size={6}>
                                    <DataPoint icon={ExploreIcon} label="Azimuth" value={formatAngle(nonSatelliteAzimuth)} emphasis />
                                </Grid>
                                <Grid size={6}>
                                    <DataPoint icon={TrackChangesIcon} label="Elevation" value={formatAngle(nonSatelliteElevation)} emphasis />
                                </Grid>
                                <Grid size={6}>
                                    <DataPoint
                                        icon={CheckCircleIcon}
                                        label="Visibility"
                                        value={nonSatelliteVisible == null ? 'Unknown' : (nonSatelliteVisible ? 'Above Horizon' : 'Below Horizon')}
                                    />
                                </Grid>
                                <Grid size={6}>
                                    <DataPoint
                                        icon={AccessTimeIcon}
                                        label="Light Time"
                                        value={Number.isFinite(nonSatelliteLightTimeMinutes) ? nonSatelliteLightTimeMinutes.toFixed(2) : '--'}
                                        unit="min"
                                    />
                                </Grid>
                            </Grid>
                        </Section>

                        <Divider sx={{ my: 1, borderColor: 'border.main' }} />

                        <Section title="Target Metadata" icon={InfoOutlinedIcon}>
                            <Grid container spacing={0.75}>
                                <Grid size={6}>
                                    <DataPoint icon={InfoOutlinedIcon} label="Target Type" value={targetType === 'mission' ? 'Mission' : 'Body'} />
                                </Grid>
                                <Grid size={6}>
                                    <DataPoint
                                        icon={InfoOutlinedIcon}
                                        label={targetType === 'mission' ? 'Mission ID' : 'Body ID'}
                                        value={nonSatelliteIdentifier || '-'}
                                    />
                                </Grid>
                                <Grid size={6}>
                                    <DataPoint icon={PublicIcon} label="Target Key" value={nonSatelliteTargetKey || '-'} />
                                </Grid>
                                <Grid size={6}>
                                    <DataPoint icon={RocketLaunchIcon} label="Source Mode" value={nonSatelliteSourceMode || '-'} />
                                </Grid>
                            </Grid>
                        </Section>

                        <Divider sx={{ my: 1, borderColor: 'border.main' }} />

                        <Section title="Tracking Link" icon={MyLocationIcon}>
                            <Grid container spacing={0.75}>
                                <Grid size={6}>
                                    <DataPoint icon={MyLocationIcon} label="Rotator" value={String(trackingState?.rotator_id || '-')} />
                                </Grid>
                                <Grid size={6}>
                                    <DataPoint icon={RadioIcon} label="Rig" value={String(trackingState?.rig_id || '-')} />
                                </Grid>
                                <Grid size={6}>
                                    <DataPoint icon={MyLocationIcon} label="Rotator State" value={String(trackingState?.rotator_state || '-')} />
                                </Grid>
                                <Grid size={6}>
                                    <DataPoint icon={RadioIcon} label="Rig State" value={String(trackingState?.rig_state || '-')} />
                                </Grid>
                            </Grid>
                        </Section>

                        <Divider sx={{ my: 1, borderColor: 'border.main' }} />

                        <Section title="Data Source" icon={BusinessIcon}>
                            <Box sx={{ p: 1, bgcolor: 'overlay.light', borderRadius: 1 }}>
                                <Grid container spacing={1}>
                                    <Grid size={12}>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', textTransform: 'uppercase' }}>
                                                Source
                                            </Typography>
                                            <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 600, fontSize: '0.65rem', fontFamily: 'monospace' }}>
                                                {nonSatelliteSource}
                                            </Typography>
                                        </Box>
                                    </Grid>
                                    <Grid size={12}>
                                        <Divider sx={{ my: 0.5 }} />
                                    </Grid>
                                    <Grid size={12}>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', textTransform: 'uppercase' }}>
                                                Cache
                                            </Typography>
                                            <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 600, fontSize: '0.65rem', fontFamily: 'monospace' }}>
                                                {nonSatelliteCache}
                                            </Typography>
                                        </Box>
                                    </Grid>
                                    <Grid size={12}>
                                        <Divider sx={{ my: 0.5 }} />
                                    </Grid>
                                    <Grid size={12}>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', textTransform: 'uppercase' }}>
                                                Stale
                                            </Typography>
                                            <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 600, fontSize: '0.65rem' }}>
                                                {nonSatelliteStale ? 'Yes' : 'No'}
                                            </Typography>
                                        </Box>
                                    </Grid>
                                    <Grid size={12}>
                                        <Divider sx={{ my: 0.5 }} />
                                    </Grid>
                                    <Grid size={12}>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', textTransform: 'uppercase' }}>
                                                Samples
                                            </Typography>
                                            <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 600, fontSize: '0.65rem' }}>
                                                {nonSatelliteSampleCount}
                                            </Typography>
                                        </Box>
                                    </Grid>
                                    {(Number.isFinite(nonSatelliteProjection?.past_hours) || Number.isFinite(nonSatelliteProjection?.future_hours)) && (
                                        <>
                                            <Grid size={12}>
                                                <Divider sx={{ my: 0.5 }} />
                                            </Grid>
                                            <Grid size={12}>
                                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', textTransform: 'uppercase' }}>
                                                        Projection
                                                    </Typography>
                                                    <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 600, fontSize: '0.65rem' }}>
                                                        {`${Number(nonSatelliteProjection?.past_hours || 0)}h / ${Number(nonSatelliteProjection?.future_hours || 0)}h @ ${Number(nonSatelliteProjection?.step_minutes || 0)}m`}
                                                    </Typography>
                                                </Box>
                                            </Grid>
                                        </>
                                    )}
                                    {nonSatelliteLastRefresh && (
                                        <>
                                            <Grid size={12}>
                                                <Divider sx={{ my: 0.5 }} />
                                            </Grid>
                                            <Grid size={12}>
                                                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.65rem', textTransform: 'uppercase' }}>
                                                        Last Refresh
                                                    </Typography>
                                                    <Typography variant="caption" sx={{ color: 'text.primary', fontWeight: 600, fontSize: '0.65rem' }}>
                                                        {humanizeDate(nonSatelliteLastRefresh)}
                                                    </Typography>
                                                </Box>
                                            </Grid>
                                        </>
                                    )}
                                    {nonSatelliteError && (
                                        <>
                                            <Grid size={12}>
                                                <Divider sx={{ my: 0.5 }} />
                                            </Grid>
                                            <Grid size={12}>
                                                <Typography variant="caption" sx={{ color: 'error.main', fontSize: '0.64rem', display: 'block' }}>
                                                    {nonSatelliteError}
                                                </Typography>
                                            </Grid>
                                        </>
                                    )}
                                </Grid>
                            </Box>
                        </Section>
                    </Box>
                </>
            )}
            <TransmittersDialog
                open={transmittersDialogOpen}
                onClose={() => setTransmittersDialogOpen(false)}
                title={tSat('satellite_database.edit_transmitters_title', {
                    name: isSatelliteTarget
                        ? (selectedSatelliteName || selectedNoradId || '')
                        : (nonSatelliteTargetName || nonSatelliteTargetKey || ''),
                })}
                satelliteData={isSatelliteTarget ? satelliteDialogData : nonSatelliteDialogData}
                variant="paper"
                widthOffsetPx={20}
            />
        </Box>
    );
}

export default TargetInfoIsland;
