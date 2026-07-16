
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

import * as React from "react";
import {
    Box,
    Button,
    IconButton,
    Popover,
    Stack,
    Typography,
} from "@mui/material";
import { useTheme } from "@mui/material/styles";
import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { shallowEqual, useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import Tooltip from "@mui/material/Tooltip";
import { useTranslation } from 'react-i18next';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import InfoIcon from '@mui/icons-material/Info';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import { formatLegibleDateTime } from "../common/common.jsx";
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { formatDate as formatDateHelper } from '../../utils/date-time.js';
import TargetNumberIcon from "../common/target-number-icon.jsx";
import { fetchFleetPassSummaries, setTrackerId } from "../target/target-slice.jsx";
import { useSocket } from "../common/socket.jsx";
import { normalizeTargetType } from "../target/celestial-target-utils.js";

const EMPTY_OPEN_TARGET_DATA = Object.freeze({
    satelliteData: {
        details: {},
        position: {},
        transmitters: [],
    },
    trackingState: {},
    rotatorData: {},
    satellitePasses: [],
    groundStationLocation: null,
});

const formatDurationCompact = (milliseconds) => {
    if (!Number.isFinite(milliseconds) || milliseconds <= 0) return '0s';
    const totalSeconds = Math.floor(milliseconds / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (days > 0) return `${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
};

const toTimestampMs = (value) => {
    if (!value) return null;
    const ts = new Date(value).getTime();
    return Number.isFinite(ts) ? ts : null;
};

const SHOW_ICON_ELEVATION_OVERLAY = false;

const normalizeTargetTypeLabel = (targetType) => {
    if (targetType === 'mission') return 'Mission';
    if (targetType === 'body') return 'Body';
    return 'Satellite';
};

const resolveRowTargetType = ({ trackingState = {}, details = {} }) => normalizeTargetType({
    target_type: trackingState?.target_type ?? details?.target_type,
    command: trackingState?.command ?? details?.command,
    body_id: trackingState?.body_id ?? details?.body_id,
    norad_id: trackingState?.norad_id ?? details?.norad_id,
});

const SatelliteInfoPopover = () => {
    const dispatch = useDispatch();
    const theme = useTheme();
    const buttonRef = useRef(null);
    const [anchorEl, setAnchorEl] = useState(null);
    const navigate = useNavigate();
    const { t } = useTranslation('dashboard');
    const { timezone, locale } = useUserTimeSettings();
    const { socket } = useSocket();
    const fleetSummaryFetchInFlightRef = useRef(false);
    const lastFleetSummaryFetchAtMsRef = useRef(0);
    const lastFleetSummarySignatureRef = useRef('');
    const currentFleetSummaryRequestTrackersRef = useRef([]);
    const currentFleetSummarySignatureRef = useRef('');
    const [nowMs, setNowMs] = useState(() => Date.now());

    const open = Boolean(anchorEl);
    const trackerId = useSelector((state) => state.targetSatTrack?.trackerId || "");
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
    const trackerViews = useSelector((state) => state.targetSatTrack?.trackerViews || {});
    const nextPassesHours = useSelector((state) => state.targetSatTrack?.nextPassesHours || 24.0);
    const fleetPassSummaryByTrackerId = useSelector((state) => state.targetSatTrack?.fleetPassSummaryByTrackerId || {});

    // Keep closed-state subscriptions intentionally lightweight.
    const selectedTrackerView = (trackerId && trackerViews?.[trackerId]) || null;
    const targetSummary = useSelector((state) => {
        const target = state.targetSatTrack || {};
        const details = selectedTrackerView?.satelliteData?.details || target.satelliteData?.details || {};
        const position = selectedTrackerView?.satelliteData?.position || target.satelliteData?.position || {};
        const trackingState = selectedTrackerView?.trackingState || target.trackingState || {};
        const rotatorData = selectedTrackerView?.rotatorData || target.rotatorData || {};

        return {
            noradId: details.norad_id ?? null,
            name: details.name ?? '',
            elevation: Number.isFinite(position.el) ? Math.round(position.el * 10) / 10 : position.el,
            trackingNoradId: trackingState?.norad_id ?? null,
            minElevation: rotatorData?.minel ?? 0,
        };
    }, shallowEqual);
    const hasAnyVisibleTarget = useMemo(() => {
        const instances = Array.isArray(trackerInstances) ? trackerInstances : [];
        const visibleInFleet = instances.some((instance) => {
            const instanceTrackerId = String(instance?.tracker_id || '').trim();
            if (!instanceTrackerId) return false;
            const view = trackerViews?.[instanceTrackerId] || {};
            const elevation = view?.satelliteData?.position?.el;
            return Number.isFinite(Number(elevation)) && Number(elevation) > 0;
        });
        if (visibleInFleet) return true;
        return Number.isFinite(Number(targetSummary.elevation)) && Number(targetSummary.elevation) > 0;
    }, [trackerInstances, trackerViews, targetSummary.elevation]);

    const openTargetData = useSelector((state) => {
        if (!open) {
            return EMPTY_OPEN_TARGET_DATA;
        }
        if (selectedTrackerView) {
            return {
                satelliteData: selectedTrackerView?.satelliteData || EMPTY_OPEN_TARGET_DATA.satelliteData,
                trackingState: selectedTrackerView?.trackingState || EMPTY_OPEN_TARGET_DATA.trackingState,
                rotatorData: selectedTrackerView?.rotatorData || EMPTY_OPEN_TARGET_DATA.rotatorData,
                satellitePasses: state.targetSatTrack?.satellitePasses || EMPTY_OPEN_TARGET_DATA.satellitePasses,
                groundStationLocation: state.location?.location || EMPTY_OPEN_TARGET_DATA.groundStationLocation,
            };
        }
        return {
            satelliteData: state.targetSatTrack?.satelliteData || EMPTY_OPEN_TARGET_DATA.satelliteData,
            trackingState: state.targetSatTrack?.trackingState || EMPTY_OPEN_TARGET_DATA.trackingState,
            rotatorData: state.targetSatTrack?.rotatorData || EMPTY_OPEN_TARGET_DATA.rotatorData,
            satellitePasses: state.targetSatTrack?.satellitePasses || EMPTY_OPEN_TARGET_DATA.satellitePasses,
            groundStationLocation: state.location?.location || EMPTY_OPEN_TARGET_DATA.groundStationLocation,
        };
    }, shallowEqual);

    const satelliteData = useMemo(() => (
        open
            ? openTargetData.satelliteData
            : {
                details: {
                    norad_id: targetSummary.noradId,
                    name: targetSummary.name,
                },
                position: {
                    el: targetSummary.elevation,
                },
                transmitters: [],
            }
    ), [open, openTargetData.satelliteData, targetSummary.noradId, targetSummary.name, targetSummary.elevation]);

    const trackingState = useMemo(() => (
        open ? openTargetData.trackingState : { norad_id: targetSummary.trackingNoradId }
    ), [open, openTargetData.trackingState, targetSummary.trackingNoradId]);

    const rotatorData = useMemo(() => (
        open ? openTargetData.rotatorData : { minel: targetSummary.minElevation }
    ), [open, openTargetData.rotatorData, targetSummary.minElevation]);
    const satellitePasses = open ? openTargetData.satellitePasses : EMPTY_OPEN_TARGET_DATA.satellitePasses;
    const fleetRows = useMemo(() => {
        return trackerInstances.map((instance, index) => {
            const instanceTrackerId = instance?.tracker_id || '';
            const targetNumber = Number(instance?.target_number || (index + 1));
            const view = trackerViews?.[instanceTrackerId] || {};
            const instanceTracking = instance?.tracking_state || {};
            const details = view?.satelliteData?.details || {};
            const position = view?.satelliteData?.position || {};
            const tracking = view?.trackingState || instanceTracking || {};
            const rotator = view?.rotatorData || {};
            const targetType = resolveRowTargetType({ trackingState: tracking, details });
            const noradId = details?.norad_id ?? tracking?.norad_id ?? null;
            const missionCommand = String(tracking?.command || details?.command || '').trim();
            const bodyId = String(tracking?.body_id || details?.body_id || '').trim().toLowerCase();
            const targetIdentifier = targetType === 'satellite'
                ? (noradId != null ? String(noradId) : '')
                : (targetType === 'mission' ? missionCommand : bodyId);
            const satName = String(
                details?.name
                || tracking?.target_name
                || targetIdentifier
                || (targetType === 'satellite' ? 'No satellite' : 'No target')
            ).trim();
            const satNorad = noradId ?? 'none';
            const elevation = position?.el;
            const latitude = position?.lat;
            const longitude = position?.lng ?? position?.lon;
            const altitude = position?.alt;
            const velocity = position?.vel;
            const azimuth = position?.az;
            const isActive = instanceTrackerId === trackerId;
            const minElevation = rotator?.minel ?? 0;
            const trackedNoradId = tracking?.norad_id ?? null;
            const trackedMissionCommand = String(tracking?.command || '').trim();
            const trackedBodyId = String(tracking?.body_id || '').trim().toLowerCase();
            // Keep "Actively Tracking" semantics consistent across target types:
            // compare each row target with the tracker state's current target identity.
            const isTracking = targetType === 'satellite'
                ? (noradId != null && trackedNoradId != null && String(trackedNoradId) === String(noradId))
                : (targetType === 'mission'
                    ? Boolean(missionCommand) && missionCommand === trackedMissionCommand
                    : Boolean(bodyId) && bodyId === trackedBodyId);
            const isTrackingActive = Boolean(view?.rigData?.tracking || view?.rotatorData?.tracking);
            return {
                trackerId: instanceTrackerId,
                targetNumber,
                satName,
                satNorad,
                targetType,
                targetTypeLabel: normalizeTargetTypeLabel(targetType),
                targetIdentifier,
                elevation,
                latitude,
                longitude,
                altitude,
                velocity,
                azimuth,
                isActive,
                minElevation,
                isTracking,
                isTrackingActive,
            };
        });
    }, [trackerInstances, trackerViews, trackerId]);

    const fleetSummaryRequestTrackers = useMemo(() => {
        return trackerInstances
            .map((instance) => {
                const instanceTrackerId = instance?.tracker_id || '';
                if (!instanceTrackerId) return null;
                const view = trackerViews?.[instanceTrackerId] || {};
                const instanceTracking = instance?.tracking_state || {};
                const tracking = view?.trackingState || instanceTracking || {};
                const details = view?.satelliteData?.details || {};
                const rotator = view?.rotatorData || {};
                const targetType = resolveRowTargetType({ trackingState: tracking, details });
                const rawNoradId = tracking?.norad_id;
                const parsedNoradId = Number(rawNoradId);
                const noradId = targetType === 'satellite' && Number.isFinite(parsedNoradId) && parsedNoradId > 0
                    ? parsedNoradId
                    : null;
                const missionCommand = targetType === 'mission'
                    ? String(tracking?.command || details?.command || '').trim()
                    : '';
                const bodyId = targetType === 'body'
                    ? String(tracking?.body_id || details?.body_id || '').trim().toLowerCase()
                    : '';
                return {
                    tracker_id: instanceTrackerId,
                    target_type: targetType,
                    norad_id: noradId,
                    command: missionCommand || null,
                    body_id: bodyId || null,
                    min_elevation: Number.isFinite(Number(rotator?.minel)) ? Number(rotator.minel) : 0,
                };
            })
            .filter(Boolean);
    }, [trackerInstances, trackerViews]);

    const fleetSummaryRequestSignature = useMemo(() => {
        const normalized = [...fleetSummaryRequestTrackers]
            .sort((a, b) => String(a.tracker_id).localeCompare(String(b.tracker_id)))
            .map((item) => ({
                tracker_id: item.tracker_id,
                norad_id: item.norad_id,
                min_elevation: item.min_elevation,
            }));
        return JSON.stringify({ hours: nextPassesHours, trackers: normalized });
    }, [fleetSummaryRequestTrackers, nextPassesHours]);

    useEffect(() => {
        currentFleetSummaryRequestTrackersRef.current = fleetSummaryRequestTrackers;
        currentFleetSummarySignatureRef.current = fleetSummaryRequestSignature;
    }, [fleetSummaryRequestSignature, fleetSummaryRequestTrackers]);

    const requestFleetPassSummaries = useCallback(async ({ force = false } = {}) => {
        const requestTrackers = currentFleetSummaryRequestTrackersRef.current;
        const requestSignature = currentFleetSummarySignatureRef.current;
        if (!open || requestTrackers.length === 0) return;
        if (!socket?.connected || fleetSummaryFetchInFlightRef.current) return;

        const minRequestIntervalMs = 30 * 1000;
        const now = Date.now();
        const signatureUnchanged = lastFleetSummarySignatureRef.current === requestSignature;
        const elapsedSinceLast = now - lastFleetSummaryFetchAtMsRef.current;
        if (!force && signatureUnchanged && elapsedSinceLast < minRequestIntervalMs) {
            return;
        }

        fleetSummaryFetchInFlightRef.current = true;
        try {
            await dispatch(fetchFleetPassSummaries({
                socket,
                trackers: requestTrackers,
                hours: nextPassesHours,
            }));
            lastFleetSummaryFetchAtMsRef.current = Date.now();
            lastFleetSummarySignatureRef.current = requestSignature;
        } finally {
            fleetSummaryFetchInFlightRef.current = false;
        }
    }, [dispatch, nextPassesHours, open, socket]);

    const fleetSummaryRefreshMs = useMemo(() => {
        if (!open || fleetSummaryRequestTrackers.length === 0) return 0;
        const urgentThresholdMs = 20 * 60 * 1000;
        const currentNowMs = Date.now();
        let urgent = false;
        for (const tracker of fleetSummaryRequestTrackers) {
            const summary = fleetPassSummaryByTrackerId?.[tracker.tracker_id];
            if (!summary) continue;
            if (summary.mode === 'live') {
                urgent = true;
                break;
            }
            if (summary.mode === 'upcoming') {
                const aosMs = toTimestampMs(summary.aos_ts);
                if (aosMs != null && aosMs - currentNowMs <= urgentThresholdMs) {
                    urgent = true;
                    break;
                }
            }
        }
        return urgent ? 60 * 1000 : 5 * 60 * 1000;
    }, [fleetPassSummaryByTrackerId, fleetSummaryRequestTrackers, open]);

    useEffect(() => {
        if (!open) return;
        requestFleetPassSummaries({ force: true });
    }, [open, requestFleetPassSummaries]);

    useEffect(() => {
        if (!open) return;
        requestFleetPassSummaries({ force: false });
    }, [open, fleetSummaryRequestSignature, requestFleetPassSummaries]);

    useEffect(() => {
        if (!open || fleetSummaryRefreshMs <= 0) return undefined;
        let cancelled = false;
        let timerId = null;

        const scheduleNext = () => {
            if (cancelled) return;
            timerId = setTimeout(async () => {
                if (document.visibilityState === 'visible') {
                    await requestFleetPassSummaries({ force: false });
                }
                scheduleNext();
            }, fleetSummaryRefreshMs + Math.floor(Math.random() * 4000));
        };
        scheduleNext();

        return () => {
            cancelled = true;
            if (timerId) clearTimeout(timerId);
        };
    }, [fleetSummaryRefreshMs, open, requestFleetPassSummaries]);

    useEffect(() => {
        if (!open) return undefined;
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                requestFleetPassSummaries({ force: true });
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [open, requestFleetPassSummaries]);

    useEffect(() => {
        if (!open) return undefined;
        const interval = setInterval(() => setNowMs(Date.now()), 1000);
        return () => clearInterval(interval);
    }, [open]);

    const formatFleetPassCountdown = useCallback((summary) => {
        if (!summary || !summary.mode) return 'AOS N/A';
        if (summary.mode === 'live') {
            const losMs = toTimestampMs(summary.los_ts);
            if (losMs == null) return 'LOS N/A';
            return `LOS ${formatDurationCompact(Math.max(0, losMs - nowMs))}`;
        }
        if (summary.mode === 'upcoming') {
            const aosMs = toTimestampMs(summary.aos_ts);
            if (aosMs == null) return 'AOS N/A';
            return `AOS ${formatDurationCompact(Math.max(0, aosMs - nowMs))}`;
        }
        return 'AOS N/A';
    }, [nowMs]);

    const handleClick = (event) => {
        setAnchorEl(event.currentTarget);
    };

    const handleClose = () => {
        setAnchorEl(null);
    };

    const handleOpenTargetPageForTracker = useCallback((nextTrackerId) => {
        const resolvedTrackerId = String(nextTrackerId || '').trim();
        if (!resolvedTrackerId) return;
        dispatch(setTrackerId(resolvedTrackerId));
        setAnchorEl(null);
        navigate('/tracking');
    }, [dispatch, navigate]);

    const handleNavigateToSatelliteInfo = () => {
        if (satelliteData.details.norad_id) {
            navigate(`/satellites/${satelliteData.details.norad_id}`);
            handleClose(); // Close the popover after navigation
        }
    };

    // Format date helper - use common function
    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        return formatDateHelper(dateString, { timezone, locale });
    };

    const getTooltipText = () => {
        const satName = satelliteData.details.name || 'No satellite selected';
        if (!satelliteData.details.norad_id) {
            return `Satellite Info: ${satName}`;
        }

        const elevation = satelliteData.position.el;
        const visibilityText = elevation > 0 ? 'Visible' : 'Below horizon';

        return `Satellite Info: ${satName} (${visibilityText}, El: ${elevation?.toFixed(1)}°)`;
    };

    const isTrackingActive = trackingState.norad_id === satelliteData.details.norad_id;

    // Fleet rule for top-bar icon: green if any target is visible, otherwise red.
    const getSatelliteIconColor = () => {
        return hasAnyVisibleTarget ? 'success.main' : 'error.main';
    };

    // Get satellite status information
    const getSatelliteStatus = (theme) => {
        if (!satelliteData.details.norad_id) {
            return {
                status: 'No Satellite',
                color: 'text.secondary',
                backgroundColor: 'action.hover',
                icon: <InfoIcon />,
                description: 'No satellite selected'
            };
        }

        const elevation = satelliteData.position.el;
        const minElevation = rotatorData.minel ?? 0;

        if (elevation < 0) {
            return {
                status: 'Below Horizon',
                color: 'error.main',
                backgroundColor: theme.palette.mode === 'dark'
                    ? `${theme.palette.error.main}25` // 15% opacity on dark
                    : 'error.light',
                icon: <VisibilityOffIcon />,
                description: 'Satellite is not visible from current location'
            };
        } else if (elevation < minElevation) {
            return {
                status: 'Low Elevation',
                color: 'warning.main',
                backgroundColor: theme.palette.mode === 'dark'
                    ? `${theme.palette.warning.main}25` // 15% opacity on dark
                    : 'warning.light',
                icon: <TrendingDownIcon />,
                description: `Satellite is below minimum elevation limit (${minElevation}°)`
            };
        } else if (isTrackingActive) {
            return {
                status: 'Actively Tracking',
                color: 'success.main',
                backgroundColor: theme.palette.mode === 'dark'
                    ? `${theme.palette.success.main}25` // 15% opacity on dark
                    : 'success.light',
                icon: <SatelliteAltIcon />,
                description: 'Currently tracking this satellite'
            };
        } else {
            return {
                status: 'Visible',
                color: 'info.main',
                backgroundColor: theme.palette.mode === 'dark'
                    ? `${theme.palette.info.main}25` // 15% opacity on dark
                    : 'info.light',
                icon: <VisibilityIcon />,
                description: 'Satellite is well positioned above horizon'
            };
        }
    };

    // Get elevation color based on value
    const getElevationColor = (elevation) => {
        const minElevation = rotatorData.minel ?? 0;

        if (elevation < 0) return 'error.main'; // Red - below horizon
        if (elevation < minElevation) return 'warning.main'; // Orange - below minimum elevation limit
        if (elevation < 45) return 'info.main'; // Light blue - above minimum but not optimal
        return 'success.main'; // Green - optimal elevation
    };

    const getFleetStatus = (row) => {
        if (row.targetType !== 'satellite') {
            const isActivelyTracking = row.isTracking || row.isTrackingActive;
            const elevation = Number(row.elevation);
            if (!Number.isFinite(elevation)) {
                if (isActivelyTracking) {
                    return {
                        status: 'Actively Tracking',
                        color: 'success.main',
                        backgroundColor: theme.palette.mode === 'dark'
                            ? `${theme.palette.success.main}25`
                            : 'success.light',
                    };
                }
                return {
                    status: 'Targeted',
                    color: 'text.secondary',
                    backgroundColor: 'action.hover',
                };
            }

            if (elevation < 0) {
                return {
                    status: 'Below Horizon',
                    color: 'error.main',
                    backgroundColor: theme.palette.mode === 'dark'
                        ? `${theme.palette.error.main}25`
                        : 'error.light',
                };
            }

            if (isActivelyTracking) {
                return {
                    status: 'Actively Tracking',
                    color: 'success.main',
                    backgroundColor: theme.palette.mode === 'dark'
                        ? `${theme.palette.success.main}25`
                        : 'success.light',
                };
            }

            return {
                status: 'Visible',
                color: 'info.main',
                backgroundColor: theme.palette.mode === 'dark'
                    ? `${theme.palette.info.main}25`
                    : 'info.light',
            };
        }

        if (row.satNorad === 'none') {
            return {
                status: 'No Satellite',
                color: 'text.secondary',
                backgroundColor: 'action.hover',
            };
        }

        const elevation = Number(row.elevation);
        if (!Number.isFinite(elevation)) {
            return {
                status: 'Unknown',
                color: 'text.secondary',
                backgroundColor: 'action.hover',
            };
        }

        if (elevation < 0) {
            return {
                status: 'Below Horizon',
                color: 'error.main',
                backgroundColor: theme.palette.mode === 'dark'
                    ? `${theme.palette.error.main}25`
                    : 'error.light',
            };
        }

        if (elevation < row.minElevation) {
            return {
                status: 'Low Elevation',
                color: 'warning.main',
                backgroundColor: theme.palette.mode === 'dark'
                    ? `${theme.palette.warning.main}25`
                    : 'warning.light',
            };
        }

        if (row.isTracking) {
            return {
                status: 'Actively Tracking',
                color: 'success.main',
                backgroundColor: theme.palette.mode === 'dark'
                    ? `${theme.palette.success.main}25`
                    : 'success.light',
            };
        }

        return {
            status: 'Visible',
            color: 'info.main',
            backgroundColor: theme.palette.mode === 'dark'
                ? `${theme.palette.info.main}25`
                : 'info.light',
        };
    };

    // Component for displaying numerical values with monospace font
    const NumericValue = ({ children, color }) => (
        <span style={{
            fontFamily: 'Monaco, Consolas, "Courier New", monospace',
            color: color || 'inherit',
            fontWeight: 'bold'
        }}>
            {children}
        </span>
    );

    const statusInfo = getSatelliteStatus(theme);

    // Memoize the next pass calculation to prevent unnecessary recalculations
    const nextPass = useMemo(() => {
        if (!open) return null;
        if (!satellitePasses || satellitePasses.length === 0 || !satelliteData.details.norad_id) return null;

        const now = new Date();

        // Find the earliest upcoming pass without creating a large intermediate array
        let earliestPass = null;
        let earliestTime = null;

        for (const pass of satellitePasses) {
            if (pass.norad_id === satelliteData.details.norad_id) {
                const startTime = new Date(pass.event_start);
                if (startTime > now) {
                    if (!earliestPass || startTime < earliestTime) {
                        earliestPass = pass;
                        earliestTime = startTime;
                    }
                }
            }
        }

        return earliestPass;
    }, [satellitePasses, satelliteData.details.norad_id]);

    // Countdown Component - extracted outside to use memoized nextPass
    const NextPassCountdown = React.memo(({ pass }) => {
        // We intentionally read from outer scope to react to store updates over time
        // without relying only on props that don't change as time advances.
        const selectedNoradId = satelliteData.details?.norad_id;

        // Utility: find earliest future pass for the selected satellite
        const findNextFuturePass = React.useCallback(() => {
            if (!selectedNoradId) return null;
            const now = new Date();
            let earliest = null;
            let earliestTime = null;
            for (const p of satellitePasses || []) {
                if (p.norad_id === selectedNoradId && p?.event_start) {
                    const st = new Date(p.event_start);
                    if (!isNaN(st) && st > now) {
                        if (!earliest || st < earliestTime) {
                            earliest = p;
                            earliestTime = st;
                        }
                    }
                }
            }
            return earliest;
        }, [selectedNoradId, satellitePasses]);

        // Local pass state that can advance to the next pass when current has started
        const [currentPass, setCurrentPass] = useState(pass || findNextFuturePass());
        const passId = currentPass?.id;
        const passStartTime = currentPass?.event_start;

        // Calculate initial countdown value to avoid empty state
        const calculateCountdown = (startTimeStr) => {
            if (!selectedNoradId) return 'No satellite selected';
            if (!startTimeStr) return 'No upcoming passes';

            const now = new Date();
            const startTime = new Date(startTimeStr);
            if (isNaN(startTime)) return 'Invalid pass start time';

            const diff = startTime - now;

            if (diff <= 0) {
                // Try to advance to the next future pass
                const nxt = findNextFuturePass();
                if (nxt && nxt.id !== currentPass?.id) {
                    setCurrentPass(nxt);
                    // Recalculate based on the new pass
                    return calculateCountdown(nxt.event_start);
                }
                // No future pass found — report a helpful message
                return 'No upcoming passes (schedule not updated)';
            }

            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);

            if (days > 0) {
                return `${days}d ${hours}h ${minutes}m`;
            } else if (hours > 0) {
                return `${hours}h ${minutes}m ${seconds}s`;
            } else if (minutes > 0) {
                return `${minutes}m ${seconds}s`;
            } else {
                return `${seconds}s`;
            }
        };

        const [countdown, setCountdown] = useState(() => calculateCountdown(passStartTime));

        // Keep local pass in sync if parent prop changes (e.g., selected satellite changes)
        useEffect(() => {
            setCurrentPass(pass || findNextFuturePass());
        }, [pass, findNextFuturePass]);

        // Recompute countdown every second; also attempt to advance to the next pass if needed
        useEffect(() => {
            const updateCountdown = () => {
                setCountdown(calculateCountdown(currentPass?.event_start));
            };

            updateCountdown();
            const interval = setInterval(updateCountdown, 1000);
            return () => clearInterval(interval);
        }, [passId, currentPass?.event_start, selectedNoradId, findNextFuturePass]);

        if (!selectedNoradId) {
            return (
                <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                    No satellite selected
                </Typography>
            );
        }

        if (!currentPass) {
            return (
                <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                    No upcoming passes
                </Typography>
            );
        }

        return (
            <Box sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1
            }}>
                <Typography variant="body2" color="text.secondary">
                    Next pass in
                </Typography>
                <Typography
                    variant="h4"
                    sx={{
                        fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                        fontWeight: 'bold',
                        color: 'info.light'
                    }}
                >
                    {countdown}
                </Typography>
                <Typography variant="caption" color="text.disabled">
                    {formatLegibleDateTime(currentPass.event_start, timezone, locale)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                    Peak elevation: {currentPass.peak_altitude?.toFixed(1)}°
                </Typography>
            </Box>
        );
    });

    return (
        <>
            <Box sx={{ position: 'relative', display: 'inline-block' }}>
                <Tooltip title={getTooltipText()}>
                    <IconButton
                        ref={buttonRef}
                        onClick={handleClick}
                        size="small"
                        sx={{
                            width: 40,
                            color: getSatelliteIconColor(),
                            '&:hover': {
                                backgroundColor: 'overlay.light'
                            },
                            '& svg': {
                                height: '75%',
                            }
                        }}
                    >
                        <SatelliteAltIcon />
                    </IconButton>
                </Tooltip>

                {/* Elevation Overlay (kept for potential future use, currently hidden) */}
                {SHOW_ICON_ELEVATION_OVERLAY && satelliteData.details.norad_id && (
                    <Box
                        sx={{
                            position: 'absolute',
                            bottom: 5,
                            right: 6,
                            backgroundColor: 'overlay.dark',
                            border: `1px solid ${getElevationColor(satelliteData.position.el)}`,
                            borderRadius: '3px',
                            paddingLeft: 0.6,
                            paddingTop: 0.2,
                            minWidth: 22,
                            width: 30,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            pointerEvents: 'none',
                            zIndex: 1
                        }}
                    >
                        <Typography
                            variant="caption"
                            sx={{
                                color: getElevationColor(satelliteData.position.el),
                                fontSize: '0.65rem',
                                fontWeight: 'bold',
                                fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                                lineHeight: 1
                            }}
                        >
                            {satelliteData.position.el >= 0 ? '+' : ''}{satelliteData.position.el?.toFixed(0)}°
                        </Typography>
                    </Box>
                )}

            </Box>

            <Popover
                sx={{
                    '& .MuiPaper-root': {
                        borderRadius: 0,
                    }
                }}
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
            >
                {open && (
                <Box sx={{
                    borderRadius: 0,
                    border: '1px solid',
                    borderColor: 'border.main',
                    p: 1,
                    minWidth: 320,
                    maxWidth: 350,
                    backgroundColor: 'background.paper',
                    color: 'text.primary',
                }}>
                    {fleetRows.length > 0 && (
                        <Stack spacing={0.8}>
                            {fleetRows.map((row) => {
                                const rowStatus = getFleetStatus(row);
                                const hasElevation = Number.isFinite(Number(row.elevation));
                                const summary = fleetPassSummaryByTrackerId?.[row.trackerId];
                                const aosLos = formatFleetPassCountdown(summary);
                                const isRowTracking = row.isTracking || row.isTrackingActive;

                                return (
                                    <Box
                                        key={row.trackerId}
                                        component="button"
                                        type="button"
                                        onClick={() => handleOpenTargetPageForTracker(row.trackerId)}
                                        sx={{
                                            p: 1,
                                            borderRadius: 1,
                                            border: 'none',
                                            backgroundColor: rowStatus.backgroundColor,
                                            width: '100%',
                                            textAlign: 'left',
                                            cursor: 'pointer',
                                            font: 'inherit',
                                            appearance: 'none',
                                            margin: 0,
                                            outline: 'none',
                                            WebkitTapHighlightColor: 'transparent',
                                            '&:hover, &:focus, &:focus-visible, &:active': {
                                                border: 'none',
                                                backgroundColor: rowStatus.backgroundColor,
                                                outline: 'none',
                                                boxShadow: 'none',
                                            },
                                        }}
                                    >
                                        <Stack direction="row" spacing={0.6} alignItems="center" sx={{ mb: 0.6 }}>
                                            <TargetNumberIcon
                                                targetNumber={row.targetNumber}
                                                prefix="T"
                                                size={15}
                                                // Keep tracking state visible while using the shared target-slot badge style.
                                                variant={isRowTracking ? 'filled' : 'muted'}
                                                // Match Earth View tooltip badge visual density (tooltip has ~0.9 opacity).
                                                sx={{ flexShrink: 0, opacity: isRowTracking ? 0.9 : undefined }}
                                            />
                                            <Typography
                                                variant="body2"
                                                sx={{
                                                    fontWeight: 'bold',
                                                    minWidth: 0,
                                                    whiteSpace: 'nowrap',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                }}
                                            >
                                                {(() => {
                                                    if (row.targetType === 'satellite') {
                                                        if (
                                                            row.satNorad !== null
                                                            && row.satNorad !== undefined
                                                            && String(row.satNorad).trim() !== ''
                                                            && String(row.satNorad).toLowerCase() !== 'none'
                                                        ) {
                                                            return `${row.satName} (${row.satNorad})`;
                                                        }
                                                        return row.satName;
                                                    }
                                                    if (row.targetIdentifier) {
                                                        return `${row.satName} (${row.targetIdentifier})`;
                                                    }
                                                    return row.satName;
                                                })()}
                                            </Typography>
                                        </Stack>

                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                                                <Typography
                                                    variant="caption"
                                                    sx={{ color: rowStatus.color, fontWeight: 'bold' }}
                                                >
                                                        {rowStatus.status}
                                                    </Typography>
                                                {row.targetType === 'satellite' ? (
                                                    <>
                                                        <Typography
                                                            variant="caption"
                                                            sx={{
                                                                color: 'text.secondary',
                                                                display: 'block',
                                                                mt: 0.2,
                                                                fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                                                            }}
                                                        >
                                                            {`Lat ${Number.isFinite(Number(row.latitude)) ? Number(row.latitude).toFixed(2) : 'N/A'}°, `}
                                                            {`Lon ${Number.isFinite(Number(row.longitude)) ? Number(row.longitude).toFixed(2) : 'N/A'}°`}
                                                            {'  •  '}
                                                            {`Alt ${Number.isFinite(Number(row.altitude)) ? Number(row.altitude).toFixed(1) : 'N/A'} km`}
                                                            {'  •  '}
                                                            {`Speed ${Number.isFinite(Number(row.velocity)) ? Number(row.velocity).toFixed(2) : 'N/A'} km/s`}
                                                            {'  •  '}
                                                            {`Az ${Number.isFinite(Number(row.azimuth)) ? Number(row.azimuth).toFixed(1) : 'N/A'}°`}
                                                        </Typography>
                                                        <Typography
                                                            variant="caption"
                                                            sx={{
                                                                color: 'text.secondary',
                                                                display: 'block',
                                                                mt: 0.2,
                                                                fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                                                            }}
                                                        >
                                                            {aosLos}
                                                        </Typography>
                                                    </>
                                                ) : (
                                                    <>
                                                        <Typography
                                                            variant="caption"
                                                            sx={{
                                                                color: 'text.secondary',
                                                                display: 'block',
                                                                mt: 0.2,
                                                                fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                                                            }}
                                                        >
                                                            {`Type ${row.targetTypeLabel}`}
                                                            {row.targetIdentifier ? `  •  ID ${row.targetIdentifier}` : ''}
                                                        </Typography>
                                                        <Typography
                                                            variant="caption"
                                                            sx={{
                                                                color: 'text.secondary',
                                                                display: 'block',
                                                                mt: 0.2,
                                                                fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                                                            }}
                                                        >
                                                            {`Az ${Number.isFinite(Number(row.azimuth)) ? Number(row.azimuth).toFixed(1) : 'N/A'}°`}
                                                            {'  •  '}
                                                            {`El ${Number.isFinite(Number(row.elevation)) ? Number(row.elevation).toFixed(1) : 'N/A'}°`}
                                                        </Typography>
                                                        <Typography
                                                            variant="caption"
                                                            sx={{
                                                                color: 'text.secondary',
                                                                display: 'block',
                                                                mt: 0.2,
                                                                fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                                                            }}
                                                        >
                                                            {aosLos}
                                                        </Typography>
                                                    </>
                                                )}
                                            </Box>
                                            {hasElevation && (
                                                <Box sx={{ textAlign: 'right' }}>
                                                    <Typography variant="body2" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
                                                        Elevation
                                                    </Typography>
                                                    <Typography variant="h6" sx={{
                                                        color: getElevationColor(Number(row.elevation)),
                                                        fontWeight: 'bold',
                                                        fontFamily: 'Monaco, Consolas, "Courier New", monospace'
                                                    }}>
                                                        {Number(row.elevation).toFixed(1)}°
                                                    </Typography>
                                                </Box>
                                            )}
                                        </Box>
                                    </Box>
                                );
                            })}
                        </Stack>
                    )}
                    {fleetRows.length === 0 && (
                        <Box
                            sx={{
                                minHeight: 140,
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 1,
                                textAlign: 'center',
                                border: '1px dashed',
                                borderColor: 'border.main',
                                borderRadius: 1,
                                px: 2,
                                py: 2.5,
                                backgroundColor: 'overlay.light',
                            }}
                        >
                            <SatelliteAltIcon sx={{ color: 'text.secondary' }} />
                            <Typography variant="body2" sx={{ fontWeight: 700 }}>
                                No targets configured
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                Create a target from the Track page to view live satellite status.
                            </Typography>
                        </Box>
                    )}
                </Box>
                )}
            </Popover>
        </>
    );
};

export default React.memo(SatelliteInfoPopover);
