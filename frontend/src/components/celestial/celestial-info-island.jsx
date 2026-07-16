import React, { useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Box, Button, CircularProgress, Divider, IconButton, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import RadioButtonCheckedIcon from '@mui/icons-material/RadioButtonChecked';
import { useTranslation } from 'react-i18next';
import { getClassNamesBasedOnGridEditing, islandTitleBarSx, TitleBar } from '../common/common.jsx';
import { useSocket } from '../common/socket.jsx';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { setRotator, setTrackerId, setTrackingStateInBackend } from '../target/target-slice.jsx';
import { useTargetRotatorSelectionDialog } from '../target/use-target-rotator-selection-dialog.jsx';
import { toast } from '../../utils/toast-with-timestamp.jsx';
import TargetIcon from './target-icon.jsx';
import { resolveTargetDisplayName } from '../target/celestial-target-utils.js';
import TransmittersDialog from '../satellites/transmitters-dialog.jsx';

const AU_IN_KM = 149597870.7;
const SECONDS_PER_DAY = 86400;
const AU_PER_DAY_TO_KM_PER_S = AU_IN_KM / SECONDS_PER_DAY;
const LIGHT_TIME_MIN_PER_AU = 8.316746397;

const buildTargetKey = (entry) => {
    const explicit = String(entry?.targetKey || entry?.target_key || '').trim();
    if (explicit) return explicit;

    const type = String(entry?.targetType || entry?.target_type || 'mission').toLowerCase();
    if (type === 'body') {
        const bodyId = String(entry?.bodyId || entry?.body_id || entry?.command || '').trim().toLowerCase();
        return bodyId ? `body:${bodyId}` : '';
    }
    const command = String(entry?.command || '').trim();
    return command ? `mission:${command}` : '';
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

const MetricPair = ({ label, value }) => (
    <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
            {label}
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {value}
        </Typography>
    </Box>
);

const normalizeHexColor = (value) => {
    const text = String(value || '').trim();
    return /^#[0-9A-Fa-f]{6}$/.test(text) ? text.toUpperCase() : '';
};

const buildTrackingTargetKey = (trackingState = {}) => {
    const targetType = String(
        trackingState?.target_type
        || (trackingState?.command ? 'mission' : (trackingState?.body_id ? 'body' : 'satellite')),
    ).toLowerCase();
    if (targetType === 'body') {
        const bodyId = String(trackingState?.body_id || '').trim().toLowerCase();
        return bodyId ? `body:${bodyId}` : '';
    }
    if (targetType === 'mission') {
        const command = String(trackingState?.command || '').trim();
        return command ? `mission:${command}` : '';
    }
    return '';
};

const CelestialInfoIsland = ({
    selectedTargetKey = '',
    tracks = [],
    passes = [],
    monitoredRows = [],
    gridEditable = false,
    loading = false,
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
        || (normalizedTargetKey.startsWith('body:') ? 'body' : 'mission'),
    ).toLowerCase();
    const missionCommand = String(
        selectedTrack?.command
        || selectedMonitored?.command
        || (normalizedTargetKey.startsWith('mission:') ? normalizedTargetKey.slice('mission:'.length) : ''),
    ).trim();
    const bodyTargetId = String(
        selectedTrack?.body_id
        || selectedMonitored?.bodyId
        || selectedMonitored?.body_id
        || (normalizedTargetKey.startsWith('body:') ? normalizedTargetKey.slice('body:'.length) : ''),
    ).trim().toLowerCase();
    const targetName = resolveTargetDisplayName({
        trackingState: {
            target_type: targetType,
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

    const elevationDeg = Number(selectedTrack?.sky_position?.el_deg);
    const azimuthDeg = Number(selectedTrack?.sky_position?.az_deg);
    const explicitVisible = selectedTrack?.visibility?.visible;
    const visible = typeof explicitVisible === 'boolean' ? explicitVisible : (Number.isFinite(elevationDeg) ? elevationDeg > 0 : null);
    const distanceFromSunAu = magnitude3(selectedTrack?.position_xyz_au);
    const speedAuPerDay = magnitude3(selectedTrack?.velocity_xyz_au_per_day);
    const speedKmS = Number.isFinite(speedAuPerDay) ? speedAuPerDay * AU_PER_DAY_TO_KM_PER_S : NaN;
    const lightTimeMinutes = Number.isFinite(distanceFromSunAu) ? distanceFromSunAu * LIGHT_TIME_MIN_PER_AU : NaN;
    const distanceKm = Number.isFinite(distanceFromSunAu) ? distanceFromSunAu * AU_IN_KM : NaN;

    const statusIndicator = (() => {
        if (selectedTrack?.error) {
            return {
                icon: ErrorOutlineIcon,
                label: tCelestial('common.error'),
                color: 'error.main',
                paletteKey: 'error',
            };
        }
        if (visible === true) {
            return {
                icon: VisibilityIcon,
                label: tCelestial('info.status.visible'),
                color: 'success.main',
                paletteKey: 'success',
            };
        }
        if (visible === false) {
            return {
                icon: VisibilityOffIcon,
                label: tCelestial('info.status.below_horizon'),
                color: 'info.main',
                paletteKey: 'info',
            };
        }
        return {
            icon: HelpOutlineIcon,
            label: tCelestial('common.unknown'),
            color: 'text.secondary',
            paletteKey: 'text',
        };
    })();

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

        const targetPatch = targetType === 'body'
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
            };

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
                    sx={islandTitleBarSx}
                >
                    <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                            {tCelestial('info.title')}
                        </Typography>
                    </Box>
                </TitleBar>

                <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                    {!normalizedTargetKey ? (
                        <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', px: 2, py: 1.5 }}>
                            <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic', textAlign: 'center' }}>
                                {tCelestial('info.empty_hint')}
                            </Typography>
                        </Box>
                    ) : loading && !selectedTrack ? (
                        <Box sx={{
                            height: '100%',
                            minHeight: '100%',
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
                            <Box
                                sx={{
                                    position: 'sticky',
                                    top: 0,
                                    zIndex: 2,
                                    px: 1.5,
                                    py: 1.25,
                                    borderBottom: '1px solid',
                                    borderColor: 'divider',
                                    bgcolor: 'background.paper',
                                    backgroundImage: selectedColor
                                        ? (theme) => (
                                            `linear-gradient(135deg, ${
                                                alpha(selectedColor, theme.palette.mode === 'dark' ? 0.26 : 0.18)
                                            } 0%, ${
                                                alpha(selectedColor, theme.palette.mode === 'dark' ? 0.08 : 0.05)
                                            } 100%)`
                                        )
                                        : 'none',
                                }}
                            >
                                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                                    <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <TargetIcon
                                            targetType={targetType}
                                            bodyId={targetIdentifier}
                                            size={44}
                                            alt={targetName || tCelestial('common.body')}
                                            showMoonPhase={targetType === 'body'}
                                        />
                                        <Box sx={{ minWidth: 0 }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                                                <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.15 }}>
                                                    {targetName || '-'}
                                                </Typography>
                                                <Tooltip title={tCelestial('info.edit_transmitters')}>
                                                    <span>
                                                        <IconButton
                                                            size="small"
                                                            onClick={() => setTransmittersDialogOpen(true)}
                                                            disabled={!normalizedTargetKey || isCardLoading}
                                                        >
                                                            <RadioButtonCheckedIcon fontSize="small" />
                                                        </IconButton>
                                                    </span>
                                                </Tooltip>
                                            </Box>
                                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                                {targetType === 'body' ? tCelestial('common.body') : tCelestial('common.mission')} · {targetIdentifier}
                                            </Typography>
                                        </Box>
                                    </Box>
                                    <Tooltip title={statusIndicator.label}>
                                        <Box
                                            aria-label={statusIndicator.label}
                                            sx={{
                                                width: 30,
                                                height: 30,
                                                borderRadius: '50%',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                color: statusIndicator.color,
                                                bgcolor: (theme) => alpha(
                                                    statusIndicator.paletteKey === 'text'
                                                        ? theme.palette.text.primary
                                                        : theme.palette[statusIndicator.paletteKey].main,
                                                    0.1,
                                                ),
                                                border: '1px solid',
                                                borderColor: 'divider',
                                                flexShrink: 0,
                                            }}
                                        >
                                            <Box
                                                component={statusIndicator.icon}
                                                sx={{ fontSize: '1.05rem' }}
                                            />
                                        </Box>
                                    </Tooltip>
                                </Box>
                            </Box>

                            <Box sx={{ p: 1.5 }}>
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
