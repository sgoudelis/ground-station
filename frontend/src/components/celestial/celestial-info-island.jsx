import React, { useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Box, Button, CircularProgress, Divider, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { getClassNamesBasedOnGridEditing, islandTitleBarSx, TitleBar } from '../common/common.jsx';
import { useSocket } from '../common/socket.jsx';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { setRotator, setTrackerId, setTrackingStateInBackend } from '../target/target-slice.jsx';
import { useTargetRotatorSelectionDialog } from '../target/use-target-rotator-selection-dialog.jsx';
import { toast } from '../../utils/toast-with-timestamp.jsx';
import {
    replaceCelestialTargetKey,
    resolveTargetDisplayName,
} from '../target/celestial-target-utils.js';
import EntityInfoHeader from '../common/entity-info-header.jsx';
import EntityVisibility from '../common/entity-visibility.jsx';
import TransmittersDialog from '../satellites/transmitters-dialog.jsx';
import { useCelestialPropertiesDialog } from './use-celestial-properties-dialog.jsx';

const AU_IN_KM = 149597870.7;
const SECONDS_PER_DAY = 86400;
const AU_PER_DAY_TO_KM_PER_S = AU_IN_KM / SECONDS_PER_DAY;
const LIGHT_TIME_MIN_PER_AU = 8.316746397;

const buildTargetKey = (entry) => {
    return String(entry?.targetKey || entry?.target_key || '').trim();
};

const magnitude3 = (vector) => {
    if (!Array.isArray(vector) || vector.length < 3) return NaN;
    const [x, y, z] = vector;
    if (![x, y, z].every((value) => Number.isFinite(value))) return NaN;
    return Math.sqrt(x * x + y * y + z * z);
};

const formatNumber = (value, digits = 2, suffix = '') => {
    if (!Number.isFinite(value)) return '-';
    return `${Number(value).toFixed(digits)}${suffix}`;
};

const toMetricNumber = (value) => (value == null ? NaN : Number(value));

const formatDateTime = (isoValue, timezone, locale) => {
    if (!isoValue) return '-';
    const parsed = new Date(isoValue);
    if (Number.isNaN(parsed.getTime())) return '-';
    const options = timezone ? { timeZone: timezone } : undefined;
    return parsed.toLocaleString(locale, options);
};

const formatRelative = (isoValue, nowMs, t) => {
    if (!isoValue) return '-';
    const parsed = new Date(isoValue).getTime();
    if (!Number.isFinite(parsed)) return '-';
    const deltaSec = Math.round((parsed - nowMs) / 1000);
    const absSec = Math.abs(deltaSec);
    if (absSec < 60) return deltaSec >= 0 ? t('time.relative.in_less_than_minute') : t('time.relative.less_than_minute_ago');
    if (absSec < 3600) {
        const minutes = Math.floor(absSec / 60);
        return deltaSec >= 0
            ? t('time.relative.in_minutes', { count: minutes })
            : t('time.relative.minutes_ago', { count: minutes });
    }
    if (absSec < 86400) {
        const hours = Math.floor(absSec / 3600);
        return deltaSec >= 0
            ? t('time.relative.in_hours', { count: hours })
            : t('time.relative.hours_ago', { count: hours });
    }
    const days = Math.floor(absSec / 86400);
    return deltaSec >= 0
        ? t('time.relative.in_days', { count: days })
        : t('time.relative.days_ago', { count: days });
};

const MetricPair = ({ label, value, sx, wrap = false }) => (
    <Box sx={{ minWidth: 0, ...sx }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
            {label}
        </Typography>
        <Typography
            variant="body2"
            title={String(value)}
            sx={{
                fontWeight: 700,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: wrap ? 'normal' : 'nowrap',
                overflowWrap: wrap ? 'anywhere' : 'normal',
            }}
        >
            {value}
        </Typography>
    </Box>
);

const formatDistanceFromEarth = (distanceKm, distanceAu, locale, compact = false) => {
    if (!Number.isFinite(distanceKm)) return '-';
    if (compact && Number.isFinite(distanceAu) && distanceAu >= 0.01) {
        return `${distanceAu.toFixed(4)} AU`;
    }
    if (distanceKm >= 1_000_000) {
        const millionKm = `${(distanceKm / 1_000_000).toFixed(2)}M km`;
        return Number.isFinite(distanceAu) && distanceAu >= 0.01
            ? `${distanceAu.toFixed(4)} AU · ${millionKm}`
            : millionKm;
    }
    return `${Math.round(distanceKm).toLocaleString(locale)} km`;
};

const formatDuration = (seconds) => {
    if (!Number.isFinite(seconds)) return '-';
    if (seconds >= 3600) return `${(seconds / 3600).toFixed(2)} h`;
    if (seconds >= 60) return `${(seconds / 60).toFixed(2)} min`;
    return `${seconds.toFixed(seconds < 10 ? 2 : 1)} s`;
};

const formatSignedSpeed = (value) => {
    if (!Number.isFinite(value)) return '-';
    const prefix = value > 0 ? '+' : '';
    return `${prefix}${value.toFixed(3)} km/s`;
};

const formatDopplerPerGhz = (value) => {
    if (!Number.isFinite(value)) return '-';
    const prefix = value > 0 ? '+' : '';
    return Math.abs(value) >= 1000
        ? `${prefix}${(value / 1000).toFixed(2)} kHz/GHz`
        : `${prefix}${value.toFixed(1)} Hz/GHz`;
};

const normalizeHexColor = (value) => {
    const text = String(value || '').trim();
    return /^#[0-9A-Fa-f]{6}$/.test(text) ? text.toUpperCase() : '';
};

const buildTrackingTargetKey = (trackingState = {}) => {
    const targetType = String(
        trackingState?.target_type
        || (trackingState?.command ? 'mission' : (trackingState?.body_id ? 'body' : 'satellite')),
    ).toLowerCase();
    return targetType === 'mission' || targetType === 'body'
        ? String(trackingState?.target_key || '').trim()
        : '';
};

const CelestialInfoIsland = ({
    selectedTargetKey = '',
    tracks = [],
    passes = [],
    monitoredRows = [],
    gridEditable = false,
    loading = false,
    onTargetUpdated,
}) => {
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const { t } = useTranslation('earthview');
    const { t: tCelestial } = useTranslation('celestial');
    const { t: tSat } = useTranslation('satellites');
    const { timezone, locale } = useUserTimeSettings();
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
    const { trackingState, trackerViews } = useSelector((state) => state.targetSatTrack || {});
    const { requestRotatorForTarget, dialog: rotatorSelectionDialog } = useTargetRotatorSelectionDialog();
    const normalizedTargetKey = String(selectedTargetKey || '').trim();
    const nowMs = Date.now();
    const [transmittersDialogOpen, setTransmittersDialogOpen] = useState(false);

    const trackByTargetKey = useMemo(() => {
        const map = {};
        (tracks || []).forEach((track) => {
            const key = buildTargetKey(track);
            if (key) map[key] = track;
        });
        return map;
    }, [tracks]);

    const monitoredByTargetKey = useMemo(() => {
        const map = {};
        (monitoredRows || []).forEach((row) => {
            const key = buildTargetKey(row);
            if (key) map[key] = row;
        });
        return map;
    }, [monitoredRows]);

    const selectedTrack = normalizedTargetKey ? trackByTargetKey[normalizedTargetKey] || null : null;
    const selectedMonitored = normalizedTargetKey ? monitoredByTargetKey[normalizedTargetKey] || null : null;
    const {
        openDialog: openPropertiesDialog,
        canEdit: canEditProperties,
        label: propertiesEditLabel,
        dialog: propertiesDialog,
    } = useCelestialPropertiesDialog({ target: selectedMonitored, onTargetUpdated });

    const selectedPasses = useMemo(
        () =>
            (passes || [])
                .filter((pass) => String(pass?.target_key || '').trim() === normalizedTargetKey)
                .sort((left, right) => new Date(left.event_start).getTime() - new Date(right.event_start).getTime()),
        [passes, normalizedTargetKey],
    );

    const activePass = selectedPasses.find((pass) => {
        const startMs = new Date(pass?.event_start || '').getTime();
        const endMs = new Date(pass?.event_end || '').getTime();
        return Number.isFinite(startMs) && Number.isFinite(endMs) && startMs <= nowMs && endMs >= nowMs;
    }) || null;

    const nextPass = selectedPasses.find((pass) => new Date(pass?.event_start || '').getTime() > nowMs) || null;

    const targetType = String(
        selectedTrack?.target_type
        || selectedMonitored?.targetType
        || selectedMonitored?.target_type
        || '',
    ).toLowerCase();
    const missionCommand = String(
        selectedTrack?.command
        || selectedMonitored?.command
        || '',
    ).trim();
    const bodyTargetId = String(
        selectedTrack?.body_id
        || selectedMonitored?.bodyId
        || selectedMonitored?.body_id
        || '',
    ).trim().toLowerCase();
    const targetName = resolveTargetDisplayName({
        trackingState: {
            target_type: targetType,
            target_key: normalizedTargetKey,
            target_name: selectedTrack?.name || selectedMonitored?.displayName || selectedMonitored?.name || '',
            command: missionCommand || null,
            body_id: bodyTargetId || null,
        },
        monitoredRows,
        celestialRows: tracks,
    });
    const targetIdentifier = targetType === 'body' ? (bodyTargetId || '-') : (missionCommand || '-');
    const targetTransmitters = Array.isArray(selectedTrack?.transmitters)
        ? selectedTrack.transmitters
        : (Array.isArray(selectedMonitored?.transmitters) ? selectedMonitored.transmitters : []);
    const transmittersDialogData = {
        name: targetName || targetIdentifier || '',
        target_key: normalizedTargetKey,
        transmitters: targetTransmitters,
    };
    const selectedColor = normalizeHexColor(selectedTrack?.color || selectedMonitored?.color || '');
    const isTargetable = Boolean(
        normalizedTargetKey
        && (targetType === 'body' ? bodyTargetId : missionCommand)
    );
    // Keep target actions disabled while the selected card data is still being resolved.
    const isCardLoading = Boolean(normalizedTargetKey) && loading && !selectedTrack;
    const currentlyTrackedTargetKey = buildTrackingTargetKey(trackingState || {});
    const isCurrentlyTargeted = Boolean(normalizedTargetKey) && currentlyTrackedTargetKey === normalizedTargetKey;

    const elevationDeg = toMetricNumber(selectedTrack?.sky_position?.el_deg);
    const azimuthDeg = Number(selectedTrack?.sky_position?.az_deg);
    const explicitVisible = selectedTrack?.visibility?.visible;
    const visible = typeof explicitVisible === 'boolean' ? explicitVisible : (Number.isFinite(elevationDeg) ? elevationDeg > 0 : null);
    const distanceFromSunAu = magnitude3(selectedTrack?.position_xyz_au);
    const speedAuPerDay = magnitude3(selectedTrack?.velocity_xyz_au_per_day);
    const speedKmS = Number.isFinite(speedAuPerDay) ? speedAuPerDay * AU_PER_DAY_TO_KM_PER_S : NaN;
    const lightTimeMinutes = Number.isFinite(distanceFromSunAu) ? distanceFromSunAu * LIGHT_TIME_MIN_PER_AU : NaN;
    const distanceKm = Number.isFinite(distanceFromSunAu) ? distanceFromSunAu * AU_IN_KM : NaN;
    const earthRelative = selectedTrack?.earth_relative || {};
    const earthDistanceAu = toMetricNumber(earthRelative.distance_au);
    const earthDistanceKm = toMetricNumber(earthRelative.distance_km);
    const relativeSpeedKmS = toMetricNumber(earthRelative.relative_speed_km_s);
    const rangeRateKmS = toMetricNumber(earthRelative.range_rate_km_s);
    const oneWayLightTimeSeconds = toMetricNumber(earthRelative.one_way_light_time_seconds);
    const roundTripLightTimeSeconds = toMetricNumber(earthRelative.round_trip_light_time_seconds);
    const dopplerShiftHzPerGhz = toMetricNumber(earthRelative.doppler_shift_hz_per_ghz);
    const closestApproachDistanceAu = toMetricNumber(earthRelative.closest_approach_distance_au);
    const closestApproachDistanceKm = toMetricNumber(earthRelative.closest_approach_distance_km);
    const relativeMotion = ['approaching', 'receding', 'steady'].includes(earthRelative.motion)
        ? tCelestial(`info.motion.${earthRelative.motion}`)
        : '-';

    const handleSetTrackingOnBackend = async () => {
        if (!socket || !isTargetable) {
            return;
        }
        const selectedAssignment = await requestRotatorForTarget(targetName || targetIdentifier);
        if (!selectedAssignment) {
            return;
        }
        const assignmentAction = String(selectedAssignment?.action || 'retarget_current_slot');
        const isCreateNewSlot = assignmentAction === 'create_new_slot';
        const trackerId = String(selectedAssignment?.trackerId || '');
        const rotatorId = String(selectedAssignment?.rotatorId || 'none');
        const assignmentRigId = String(selectedAssignment?.rigId || 'none');
        if (!trackerId) {
            return;
        }

        const selectedTrackerInstance = trackerInstances.find(
            (instance) => String(instance?.tracker_id || '') === trackerId
        );
        const selectedTrackerView = trackerViews?.[trackerId] || {};
        const selectedTrackerState = selectedTrackerView?.trackingState || selectedTrackerInstance?.tracking_state || {};
        const nextRigId = isCreateNewSlot
            ? assignmentRigId
            : String(
                selectedTrackerView?.selectedRadioRig
                ?? selectedTrackerState?.rig_id
                ?? assignmentRigId
                ?? 'none'
            );
        const nextRotatorId = isCreateNewSlot ? 'none' : rotatorId;
        const nextTransmitterId = isCreateNewSlot
            ? 'none'
            : String(selectedTrackerState?.transmitter_id || 'none');

        dispatch(setTrackerId(trackerId));
        dispatch(setRotator({ value: nextRotatorId, trackerId }));

        const targetPatch = replaceCelestialTargetKey(targetType === 'body'
            ? {
                target_type: 'body',
                target_name: targetName || bodyTargetId,
                body_id: bodyTargetId,
                command: null,
            }
            : {
                target_type: 'mission',
                target_name: targetName || missionCommand,
                command: missionCommand,
                body_id: null,
            }, normalizedTargetKey);

        const newTrackingState = isCreateNewSlot
            ? {
                tracker_id: trackerId,
                ...targetPatch,
                norad_id: null,
                group_id: null,
                rig_id: nextRigId,
                rotator_id: nextRotatorId,
                transmitter_id: 'none',
                rig_state: 'disconnected',
                rotator_state: 'disconnected',
                rig_vfo: 'none',
                vfo1: 'uplink',
                vfo2: 'downlink',
            }
            : {
                ...selectedTrackerState,
                tracker_id: trackerId,
                ...targetPatch,
                norad_id: null,
                group_id: null,
                rig_id: nextRigId,
                rotator_id: nextRotatorId,
                transmitter_id: nextTransmitterId,
            };

        dispatch(setTrackingStateInBackend({ socket, data: newTrackingState }))
            .unwrap()
            .catch((error) => {
                toast.error(`${t('satellite_info.failed_tracking')}: ${error?.message || error?.error || tCelestial('errors.unknown_error')}`);
            });
    };

    return (
        <>
            {rotatorSelectionDialog}
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <TitleBar
                    className={getClassNamesBasedOnGridEditing(gridEditable, ['window-title-bar'])}
                    sx={{ ...islandTitleBarSx, flexShrink: 0 }}
                >
                    <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                            {tCelestial('info.title')}
                        </Typography>
                    </Box>
                </TitleBar>

                <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                    {normalizedTargetKey && (
                        <EntityInfoHeader
                            name={targetName}
                            targetType={targetType || 'body'}
                            identifier={targetIdentifier}
                            color={selectedColor}
                            error={selectedTrack?.error}
                            onEdit={openPropertiesDialog}
                            editLabel={propertiesEditLabel}
                            editDisabled={!canEditProperties}
                            onEditTransmitters={() => setTransmittersDialogOpen(true)}
                            disabled={!normalizedTargetKey}
                            loading={isCardLoading}
                        />
                    )}
                    {!normalizedTargetKey ? (
                        <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', px: 2, py: 1.5 }}>
                            <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic', textAlign: 'center' }}>
                                {tCelestial('info.empty_hint')}
                            </Typography>
                        </Box>
                    ) : loading && !selectedTrack ? (
                        <Box sx={{
                            flex: 1,
                            minHeight: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'center',
                            alignItems: 'center',
                        }}>
                            <CircularProgress color="secondary" />
                            <Typography variant="body2" sx={{ mt: 2, color: 'text.secondary' }}>
                                {tCelestial('common.loading')}
                            </Typography>
                        </Box>
                    ) : (
                        <>
                            <Box sx={{ p: 1.5, flex: 1, minHeight: 0, overflow: 'auto' }}>
                                <EntityVisibility visible={visible} />
                                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.25 }}>
                                    <MetricPair
                                        label={tCelestial('info.metrics.target_type')}
                                        value={targetType === 'body' ? tCelestial('common.body') : tCelestial('common.mission')}
                                    />
                                    <MetricPair
                                        label={targetType === 'body' ? tCelestial('info.metrics.body_id') : tCelestial('info.metrics.mission_command')}
                                        value={targetIdentifier || '-'}
                                    />
                                    <MetricPair label={tCelestial('info.metrics.elevation')} value={formatNumber(elevationDeg, 1, ` ${tCelestial('units.deg')}`)} />
                                    <MetricPair label={tCelestial('info.metrics.azimuth')} value={formatNumber(azimuthDeg, 1, ` ${tCelestial('units.deg')}`)} />
                                    <MetricPair label={tCelestial('info.metrics.distance_from_sun_au')} value={formatNumber(distanceFromSunAu, 4, ` ${tCelestial('units.au')}`)} />
                                    <MetricPair label={tCelestial('info.metrics.distance_from_sun_km')} value={formatNumber(distanceKm, 0)} />
                                    <MetricPair label={tCelestial('info.metrics.speed')} value={formatNumber(speedKmS, 3, ` ${tCelestial('units.km_per_s')}`)} />
                                    <MetricPair label={tCelestial('info.metrics.light_time')} value={formatNumber(lightTimeMinutes, 2, ` ${tCelestial('units.min')}`)} />
                                </Box>

                                <Divider sx={{ my: 1.25 }} />

                                <Typography variant="overline" sx={{ color: 'secondary.main', fontWeight: 700 }}>
                                    {tCelestial('info.sections.earth_relative')}
                                </Typography>
                                <Box
                                    sx={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                                        gap: 1.25,
                                        mt: 0.5,
                                    }}
                                >
                                    <MetricPair
                                        label={tCelestial('info.metrics.distance_from_earth')}
                                        value={formatDistanceFromEarth(earthDistanceKm, earthDistanceAu, locale)}
                                        sx={{ gridColumn: '1 / -1' }}
                                        wrap
                                    />
                                    <MetricPair
                                        label={tCelestial('info.metrics.relative_speed')}
                                        value={formatNumber(relativeSpeedKmS, 3, ` ${tCelestial('units.km_per_s')}`)}
                                    />
                                    <MetricPair
                                        label={tCelestial('info.metrics.range_rate')}
                                        value={formatSignedSpeed(rangeRateKmS)}
                                    />
                                    <MetricPair label={tCelestial('info.metrics.motion')} value={relativeMotion} />
                                    <MetricPair
                                        label={tCelestial('info.metrics.doppler_per_ghz')}
                                        value={formatDopplerPerGhz(dopplerShiftHzPerGhz)}
                                    />
                                    <MetricPair
                                        label={tCelestial('info.metrics.one_way_light_time')}
                                        value={formatDuration(oneWayLightTimeSeconds)}
                                    />
                                    <MetricPair
                                        label={tCelestial('info.metrics.round_trip_light_time')}
                                        value={formatDuration(roundTripLightTimeSeconds)}
                                    />
                                    <MetricPair
                                        label={tCelestial('info.metrics.closest_approach')}
                                        value={formatDistanceFromEarth(
                                            closestApproachDistanceKm,
                                            closestApproachDistanceAu,
                                            locale,
                                            true,
                                        )}
                                    />
                                    <MetricPair
                                        label={tCelestial('info.metrics.closest_approach_time')}
                                        value={formatDateTime(earthRelative.closest_approach_at_utc, timezone, locale)}
                                    />
                                </Box>

                                <Divider sx={{ my: 1.25 }} />

                                <Typography variant="overline" sx={{ color: 'secondary.main', fontWeight: 700 }}>
                                    {tCelestial('info.sections.pass_window')}
                                </Typography>
                                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.25, mt: 0.5 }}>
                                    <MetricPair label={tCelestial('info.metrics.total_passes')} value={String(selectedPasses.length)} />
                                    <MetricPair label={tCelestial('info.metrics.active_pass')} value={activePass ? tCelestial('common.yes') : tCelestial('common.no')} />
                                    <MetricPair
                                        label={activePass ? tCelestial('info.metrics.active_since') : tCelestial('info.metrics.next_start')}
                                        value={
                                            activePass
                                                ? formatRelative(activePass.event_start, nowMs, tCelestial)
                                                : (nextPass ? formatRelative(nextPass.event_start, nowMs, tCelestial) : tCelestial('info.no_upcoming_pass'))
                                        }
                                    />
                                    <MetricPair
                                        label={activePass ? tCelestial('info.metrics.ends') : tCelestial('info.metrics.next_peak')}
                                        value={
                                            activePass
                                                ? formatRelative(activePass.event_end, nowMs, tCelestial)
                                                : (nextPass ? formatDateTime(nextPass.peak_time || nextPass.event_end, timezone, locale) : '-')
                                        }
                                    />
                                </Box>

                                <Divider sx={{ my: 1.25 }} />

                                <Typography variant="overline" sx={{ color: 'secondary.main', fontWeight: 700 }}>
                                    {tCelestial('info.sections.data_source')}
                                </Typography>
                                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.25, mt: 0.5 }}>
                                    <MetricPair label={tCelestial('info.metrics.source')} value={String(selectedTrack?.source || '-')} />
                                    <MetricPair label={tCelestial('info.metrics.cache')} value={String(selectedTrack?.cache || '-')} />
                                    <MetricPair label={tCelestial('info.metrics.stale')} value={selectedTrack?.stale ? tCelestial('common.yes') : tCelestial('common.no')} />
                                    <MetricPair
                                        label={tCelestial('info.metrics.last_refresh')}
                                        value={formatDateTime(selectedMonitored?.lastRefreshAt, timezone, locale)}
                                    />
                                </Box>

                                {selectedTrack?.error ? (
                                    <>
                                        <Divider sx={{ my: 1.25 }} />
                                        <Typography variant="caption" sx={{ color: 'error.main', fontWeight: 700 }}>
                                            {String(selectedTrack.error)}
                                        </Typography>
                                    </>
                                ) : null}
                            </Box>
                        </>
                    )}
                </Box>
                <Box
                    sx={{
                        p: 1.25,
                        borderTop: '1px solid',
                        borderColor: 'divider',
                        bgcolor: 'background.default',
                    }}
                >
                    <Button
                        fullWidth
                        variant="contained"
                        color="primary"
                        disabled={!socket || !isTargetable || isCurrentlyTargeted || isCardLoading}
                        onClick={handleSetTrackingOnBackend}
                        sx={{
                            py: 1.25,
                            fontWeight: 'bold',
                            borderRadius: 2,
                        }}
                    >
                        {isCurrentlyTargeted ? t('satellite_info.currently_targeted') : t('satellite_info.set_as_target')}
                    </Button>
                </Box>
            </Box>
            {propertiesDialog}
            <TransmittersDialog
                open={transmittersDialogOpen}
                onClose={() => setTransmittersDialogOpen(false)}
                title={tSat('satellite_database.edit_transmitters_title', {
                    name: targetName || normalizedTargetKey || '',
                })}
                satelliteData={transmittersDialogData}
                variant="paper"
                widthOffsetPx={20}
            />
        </>
    );
};

export default React.memo(CelestialInfoIsland);
