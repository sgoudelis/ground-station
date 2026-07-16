import * as React from 'react';
import {
    Box,
    Button,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    Divider,
    Stack,
    Typography,
} from '@mui/material';
import { useSelector } from 'react-redux';
import { Trans, useTranslation } from 'react-i18next';
import { DEFAULT_TRACKER_ID, resolveTrackerId } from './tracking-constants.js';

const RETARGET_ACTIONS = Object.freeze({
    CURRENT_SLOT: 'retarget_current_slot',
    NEW_SLOT: 'create_new_slot',
});
const HARDWARE_STATUS_DEFAULT_LABELS = Object.freeze({
    unassigned: 'Unassigned',
    disconnected: 'Disconnected',
    tracking: 'Tracking',
    slewing: 'Slewing',
    parked: 'Parked',
    stopped: 'Stopped',
    connected: 'Connected',
    unknown: 'Unknown',
});
const resolveStatusLedColor = (theme, statusColor = 'default') => {
    switch (statusColor) {
    case 'success':
        return theme.palette.success.main;
    case 'warning':
        return theme.palette.warning.main;
    case 'error':
        return theme.palette.error.main;
    case 'info':
        return theme.palette.info.main;
    default:
        return theme.palette.grey[500];
    }
};

const normalizeHardwareId = (candidate) => {
    if (typeof candidate === 'string') {
        const normalized = candidate.trim();
        return normalized && normalized !== 'none' ? normalized : 'none';
    }
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return String(candidate);
    }
    return 'none';
};
const normalizeRotatorId = normalizeHardwareId;
const normalizeRigId = normalizeHardwareId;
const TARGET_SLOT_ID_PATTERN = /^target-(\d+)$/;

const parseTargetSlotNumber = (trackerId = '') => {
    const matched = String(trackerId || '').match(TARGET_SLOT_ID_PATTERN);
    if (!matched) {
        return null;
    }
    const parsedNumber = Number(matched[1]);
    return Number.isFinite(parsedNumber) && parsedNumber > 0 ? parsedNumber : null;
};

const deriveNextTrackerSlotId = (rows = []) => {
    const usedTargetNumbers = new Set();
    rows.forEach((row) => {
        const targetNumber = parseTargetSlotNumber(row?.trackerId);
        if (targetNumber !== null) {
            usedTargetNumbers.add(targetNumber);
        }
    });
    let nextTargetNumber = 1;
    while (usedTargetNumbers.has(nextTargetNumber)) {
        nextTargetNumber += 1;
    }
    return `target-${nextTargetNumber}`;
};

export function useTargetRotatorSelectionDialog() {
    const { t } = useTranslation('target');
    const rotators = useSelector((state) => state.rotators?.rotators || []);
    const rigs = useSelector((state) => state.rigs?.rigs || []);
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
    const activeTrackerId = useSelector((state) => state.targetSatTrack?.trackerId || DEFAULT_TRACKER_ID);
    const selectedRotator = useSelector((state) => state.targetSatTrack?.selectedRotator || 'none');
    const selectedRadioRig = useSelector((state) => state.targetSatTrack?.selectedRadioRig || 'none');
    const trackerViews = useSelector((state) => state.targetSatTrack?.trackerViews || {});

    const [open, setOpen] = React.useState(false);
    const [pendingSatelliteName, setPendingSatelliteName] = React.useState('');
    const [pendingErrorMessage, setPendingErrorMessage] = React.useState('');
    const [submitting, setSubmitting] = React.useState(false);
    const [pendingAction, setPendingAction] = React.useState(RETARGET_ACTIONS.CURRENT_SLOT);
    const [pendingAssignment, setPendingAssignment] = React.useState({
        trackerId: DEFAULT_TRACKER_ID,
        rotatorId: 'none',
        rigId: 'none',
    });
    const resolverRef = React.useRef(null);
    const submitHandlerRef = React.useRef(null);

    const closeWithResult = React.useCallback((result) => {
        const resolve = resolverRef.current;
        resolverRef.current = null;
        submitHandlerRef.current = null;
        setOpen(false);
        setPendingSatelliteName('');
        setPendingErrorMessage('');
        setSubmitting(false);
        setPendingAction(RETARGET_ACTIONS.CURRENT_SLOT);
        setPendingAssignment({ trackerId: DEFAULT_TRACKER_ID, rotatorId: 'none', rigId: 'none' });
        if (typeof resolve === 'function') {
            resolve(result);
        }
    }, []);

    const usageRows = React.useMemo(() => {
        const rotatorNameById = rotators.reduce((mapping, rotator) => {
            mapping[String(rotator.id)] = rotator.name;
            return mapping;
        }, {});
        const rigNameById = rigs.reduce((mapping, rig) => {
            mapping[String(rig.id)] = rig.name;
            return mapping;
        }, {});
        return trackerInstances
            .map((instance) => {
                const trackerId = resolveTrackerId(instance?.tracker_id, DEFAULT_TRACKER_ID);
                if (!trackerId) {
                    return null;
                }
                const targetNumber = parseTargetSlotNumber(trackerId);
                if (targetNumber === null) {
                    return null;
                }
                const trackingState = instance?.tracking_state || {};
                const trackerView = trackerViews?.[trackerId] || {};
                const viewRotatorData = trackerView?.rotatorData || {};
                const viewRigData = trackerView?.rigData || {};
                const viewTrackingState = trackerView?.trackingState || trackingState || {};
                const satName = String(trackerView?.satelliteData?.details?.name || '').trim() || null;
                const rotatorId = normalizeRotatorId(
                    trackerView?.selectedRotator
                    ?? instance?.rotator_id
                    ?? trackingState?.rotator_id
                    ?? 'none'
                );
                const rigId = normalizeRigId(
                    trackerView?.selectedRadioRig
                    ?? instance?.rig_id
                    ?? trackingState?.rig_id
                    ?? 'none'
                );

                let rotatorStatusLabel = 'unknown';
                let rotatorStatusColor = 'default';
                if (rotatorId === 'none') {
                    rotatorStatusLabel = 'unassigned';
                    rotatorStatusColor = 'default';
                } else if (
                    viewRotatorData?.connected === false
                    || viewTrackingState?.rotator_state === 'disconnected'
                ) {
                    rotatorStatusLabel = 'disconnected';
                    rotatorStatusColor = 'error';
                } else if (
                    viewRotatorData?.tracking === true
                    || viewTrackingState?.rotator_state === 'tracking'
                ) {
                    rotatorStatusLabel = 'tracking';
                    rotatorStatusColor = 'success';
                } else if (viewRotatorData?.slewing === true) {
                    rotatorStatusLabel = 'slewing';
                    rotatorStatusColor = 'warning';
                } else if (
                    viewRotatorData?.parked === true
                    || viewTrackingState?.rotator_state === 'parked'
                ) {
                    rotatorStatusLabel = 'parked';
                    rotatorStatusColor = 'warning';
                } else if (
                    viewRotatorData?.stopped === true
                    || viewTrackingState?.rotator_state === 'stopped'
                ) {
                    rotatorStatusLabel = 'stopped';
                    rotatorStatusColor = 'info';
                } else if (
                    viewRotatorData?.connected === true
                    || viewTrackingState?.rotator_state === 'connected'
                ) {
                    rotatorStatusLabel = 'connected';
                    rotatorStatusColor = 'success';
                }

                let rigStatusLabel = 'unknown';
                let rigStatusColor = 'default';
                if (rigId === 'none') {
                    rigStatusLabel = 'unassigned';
                    rigStatusColor = 'default';
                } else if (
                    viewRigData?.connected === false
                    || viewTrackingState?.rig_state === 'disconnected'
                ) {
                    rigStatusLabel = 'disconnected';
                    rigStatusColor = 'error';
                } else if (
                    viewRigData?.tracking === true
                    || viewTrackingState?.rig_state === 'tracking'
                ) {
                    rigStatusLabel = 'tracking';
                    rigStatusColor = 'success';
                } else if (viewTrackingState?.rig_state === 'stopped') {
                    rigStatusLabel = 'stopped';
                    rigStatusColor = 'info';
                } else if (
                    viewRigData?.connected === true
                    || viewTrackingState?.rig_state === 'connected'
                ) {
                    rigStatusLabel = 'connected';
                    rigStatusColor = 'success';
                }

                return {
                    trackerId,
                    targetNumber,
                    rotatorId,
                    rotatorName: rotatorNameById[rotatorId] || null,
                    rigId,
                    rigName: rigNameById[rigId] || null,
                    noradId: trackingState?.norad_id ?? null,
                    satName,
                    rotatorStatusLabel,
                    rotatorStatusColor,
                    rigStatusLabel,
                    rigStatusColor,
                };
            })
            .filter(Boolean)
            .sort((a, b) => a.targetNumber - b.targetNumber);
    }, [rigs, rotators, trackerInstances, trackerViews]);

    const resolveAssignmentForRetarget = React.useCallback(() => {
        const normalizedActiveTrackerId = resolveTrackerId(activeTrackerId, DEFAULT_TRACKER_ID);
        const preferredRow = usageRows.find((row) => row.trackerId === normalizedActiveTrackerId) || usageRows[0] || null;
        if (preferredRow) {
            return {
                trackerId: preferredRow.trackerId,
                rotatorId: preferredRow.rotatorId,
                rigId: preferredRow.rigId,
            };
        }
        return {
            trackerId: normalizedActiveTrackerId || DEFAULT_TRACKER_ID,
            rotatorId: normalizeRotatorId(selectedRotator),
            rigId: normalizeRigId(selectedRadioRig),
        };
    }, [activeTrackerId, selectedRadioRig, selectedRotator, usageRows]);

    const requestRotatorForTarget = React.useCallback((targetName = '', options = {}) => {
        return new Promise((resolve) => {
            resolverRef.current = resolve;
            submitHandlerRef.current = typeof options?.onSubmit === 'function' ? options.onSubmit : null;
            setPendingSatelliteName(targetName || '');
            setPendingErrorMessage(String(options?.errorMessage || '').trim());
            setSubmitting(false);
            setPendingAction(RETARGET_ACTIONS.CURRENT_SLOT);
            setPendingAssignment(resolveAssignmentForRetarget());
            setOpen(true);
        });
    }, [resolveAssignmentForRetarget]);

    const nextTargetSlotId = React.useMemo(() => deriveNextTrackerSlotId(usageRows), [usageRows]);
    const canConfirm = pendingAction === RETARGET_ACTIONS.NEW_SLOT
        ? Boolean(nextTargetSlotId)
        : Boolean(resolveTrackerId(pendingAssignment?.trackerId, DEFAULT_TRACKER_ID));
    const targetLabel = pendingSatelliteName || t('target_retarget_dialog.this_target', { defaultValue: 'this target' });
    const newTargetLabel = t(
        'target_retarget_dialog.new_target_slot',
        { defaultValue: `New target (${nextTargetSlotId})`, slot: nextTargetSlotId },
    );
    const selectedTrackerId = resolveTrackerId(pendingAssignment?.trackerId, DEFAULT_TRACKER_ID);
    const getStatusLabel = React.useCallback((status) => {
        const key = String(status || 'unknown').toLowerCase();
        const defaultLabel = HARDWARE_STATUS_DEFAULT_LABELS[key] || HARDWARE_STATUS_DEFAULT_LABELS.unknown;
        return t(`target_retarget_dialog.status_${key}`, { defaultValue: defaultLabel });
    }, [t]);

    const dialog = (
        <Dialog
            open={open}
            onClose={() => {
                if (submitting) return;
                closeWithResult(null);
            }}
            fullWidth
            maxWidth="sm"
            PaperProps={{
                sx: {
                    bgcolor: 'background.paper',
                    border: (theme) => `1px solid ${theme.palette.divider}`,
                    borderRadius: 2,
                },
            }}
        >
            <DialogTitle
                sx={{
                    bgcolor: 'background.paper',
                    borderBottom: '1px solid',
                    borderColor: 'divider',
                    fontSize: '1.2rem',
                    fontWeight: 'bold',
                    py: 2.2,
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                    <Box sx={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 800, lineHeight: 1.2 }}>
                            {t('target_retarget_dialog.title', { defaultValue: 'Retarget slot or create a new target' })}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.2 }}>
                            {t('target_retarget_dialog.subtitle', { defaultValue: 'Choose to retarget the active slot or create a new one' })}
                        </Typography>
                    </Box>
                </Box>
            </DialogTitle>
            <DialogContent sx={{ px: 3, pb: 2.5, pt: 5 }}>
                <Box sx={{ display: 'grid', gap: 1.25, pt: 2 }}>
                    <Box
                        sx={{
                            p: 1.25,
                            borderRadius: 1.5,
                            background: (theme) => `linear-gradient(135deg, ${theme.palette.primary.main}1A 0%, ${theme.palette.primary.main}08 100%)`,
                        }}
                    >
                        <DialogContentText sx={{ mt: 0.4, mb: 1, color: 'text.secondary' }}>
                            <Trans
                                ns="target"
                                i18nKey="target_retarget_dialog.description"
                                defaults="Choose which slot should track <target>{{target}}</target>."
                                values={{ target: targetLabel }}
                                components={{ target: <strong /> }}
                            />
                        </DialogContentText>
                        <Stack spacing={1}>
                            {usageRows.length > 0 ? usageRows.map((row) => {
                                const isSelected = pendingAction === RETARGET_ACTIONS.CURRENT_SLOT
                                    && row.trackerId === selectedTrackerId;
                                const slotTitle = t(
                                    'target_retarget_dialog.option_slot_title',
                                    { defaultValue: `Retarget Target ${row.targetNumber}`, number: row.targetNumber },
                                );
                                const slotLabel = row.trackerId ? `Slot ${row.trackerId}` : 'Slot';
                                const rotatorLabel = row.rotatorId !== 'none'
                                    ? (row.rotatorName || row.rotatorId)
                                    : t('target_retarget_dialog.no_rotator', { defaultValue: 'No rotator control' });
                                return (
                                    <Button
                                        key={row.trackerId}
                                        variant="outlined"
                                        color="inherit"
                                        onClick={() => {
                                            if (submitting) return;
                                            setPendingAction(RETARGET_ACTIONS.CURRENT_SLOT);
                                            setPendingAssignment({
                                                trackerId: row.trackerId,
                                                rotatorId: row.rotatorId,
                                                rigId: row.rigId,
                                            });
                                            if (pendingErrorMessage) {
                                                setPendingErrorMessage('');
                                            }
                                        }}
                                        fullWidth
                                        disabled={submitting}
                                        sx={{
                                            justifyContent: 'flex-start',
                                            textTransform: 'none',
                                            alignItems: 'stretch',
                                            px: 1.15,
                                            py: 0.9,
                                            minHeight: 88,
                                            borderRadius: 1.6,
                                            borderWidth: 1.5,
                                            color: 'text.primary',
                                            borderColor: (theme) => isSelected
                                                ? theme.palette.primary.main
                                                : (theme.palette.mode === 'dark' ? 'grey.700' : 'grey.400'),
                                            bgcolor: (theme) => isSelected
                                                ? (theme.palette.mode === 'dark' ? 'rgba(25, 118, 210, 0.18)' : 'rgba(25, 118, 210, 0.08)')
                                                : 'transparent',
                                            boxShadow: (theme) => isSelected
                                                ? (theme.palette.mode === 'dark'
                                                    ? '0 6px 18px rgba(0, 0, 0, 0.45)'
                                                    : '0 6px 16px rgba(15, 23, 42, 0.16)')
                                                : (theme.palette.mode === 'dark'
                                                    ? '0 1px 4px rgba(0, 0, 0, 0.35)'
                                                    : '0 1px 3px rgba(15, 23, 42, 0.10)'),
                                            transition: 'border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease, transform 120ms ease',
                                            '&:hover': {
                                                borderColor: (theme) => isSelected
                                                    ? theme.palette.primary.main
                                                    : (theme.palette.mode === 'dark' ? 'grey.600' : 'grey.500'),
                                                bgcolor: (theme) => isSelected
                                                    ? (theme.palette.mode === 'dark' ? 'rgba(25, 118, 210, 0.24)' : 'rgba(25, 118, 210, 0.12)')
                                                    : 'transparent',
                                            },
                                            '&:active': { transform: 'translateY(1px)' },
                                        }}
                                    >
                                        <Box sx={{ display: 'grid', gap: 0.45, width: '100%', minWidth: 0 }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                                                <Typography variant="body2" sx={{ fontWeight: 800 }}>
                                                    {slotTitle}
                                                </Typography>
                                                <Chip
                                                    size="small"
                                                    variant="outlined"
                                                    label={slotLabel}
                                                    sx={{ height: 20, '& .MuiChip-label': { px: 0.8, fontSize: '0.68rem', fontFamily: 'monospace' } }}
                                                />
                                            </Box>
                                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, minWidth: 0 }}>
                                                <Stack direction="row" spacing={0.6} sx={{ alignItems: 'center', minWidth: 0, flexWrap: 'wrap' }}>
                                                    {row.satName ? (
                                                        <Typography
                                                            variant="caption"
                                                            sx={{
                                                                minWidth: 0,
                                                                maxWidth: 220,
                                                                whiteSpace: 'nowrap',
                                                                overflow: 'hidden',
                                                                textOverflow: 'ellipsis',
                                                                color: 'text.secondary',
                                                            }}
                                                            title={row.satName}
                                                        >
                                                            {row.satName}
                                                        </Typography>
                                                    ) : (
                                                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                                            {t('target_retarget_dialog.no_target', { defaultValue: 'No target selected' })}
                                                        </Typography>
                                                    )}
                                                    <Chip
                                                        size="small"
                                                        variant="outlined"
                                                        color={row.noradId ? 'success' : 'default'}
                                                        label={row.noradId ? `SAT ${row.noradId}` : 'No target'}
                                                        sx={{ height: 20, '& .MuiChip-label': { px: 0.8, fontSize: '0.68rem' } }}
                                                    />
                                                </Stack>
                                                <Stack
                                                    direction="row"
                                                    spacing={0.6}
                                                    sx={{ flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', ml: 'auto', flexShrink: 0 }}
                                                >
                                                    {row.rotatorId !== 'none' ? (
                                                        <Chip
                                                            size="small"
                                                            variant="outlined"
                                                            title={`${row.rotatorName || row.rotatorId} (${getStatusLabel(row.rotatorStatusLabel)})`}
                                                            label={(
                                                                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.65, minWidth: 0 }}>
                                                                    <Box
                                                                        component="span"
                                                                        sx={{
                                                                            width: 7.5,
                                                                            height: 7.5,
                                                                            borderRadius: '50%',
                                                                            flexShrink: 0,
                                                                            bgcolor: (theme) => resolveStatusLedColor(theme, row.rotatorStatusColor),
                                                                            boxShadow: (theme) => `0 0 0 1px ${theme.palette.background.paper}, 0 0 6px ${resolveStatusLedColor(theme, row.rotatorStatusColor)}`,
                                                                        }}
                                                                    />
                                                                    <Box component="span">{row.rotatorName || row.rotatorId}</Box>
                                                                </Box>
                                                            )}
                                                            sx={{
                                                                height: 20,
                                                                borderColor: 'divider',
                                                                '& .MuiChip-label': {
                                                                    px: 0.8,
                                                                    fontSize: '0.68rem',
                                                                },
                                                            }}
                                                        />
                                                    ) : (
                                                        <Chip
                                                            size="small"
                                                            variant="outlined"
                                                            label={rotatorLabel}
                                                            sx={{ height: 20, '& .MuiChip-label': { px: 0.8, fontSize: '0.68rem' } }}
                                                        />
                                                    )}
                                                    {row.rigId !== 'none' ? (
                                                        <Chip
                                                            size="small"
                                                            variant="outlined"
                                                            title={`${row.rigName || row.rigId} (${getStatusLabel(row.rigStatusLabel)})`}
                                                            label={(
                                                                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.65, minWidth: 0 }}>
                                                                    <Box
                                                                        component="span"
                                                                        sx={{
                                                                            width: 7.5,
                                                                            height: 7.5,
                                                                            borderRadius: '50%',
                                                                            flexShrink: 0,
                                                                            bgcolor: (theme) => resolveStatusLedColor(theme, row.rigStatusColor),
                                                                            boxShadow: (theme) => `0 0 0 1px ${theme.palette.background.paper}, 0 0 6px ${resolveStatusLedColor(theme, row.rigStatusColor)}`,
                                                                        }}
                                                                    />
                                                                    <Box component="span">{row.rigName || row.rigId}</Box>
                                                                </Box>
                                                            )}
                                                            sx={{
                                                                height: 20,
                                                                borderColor: 'divider',
                                                                '& .MuiChip-label': {
                                                                    px: 0.8,
                                                                    fontSize: '0.68rem',
                                                                },
                                                            }}
                                                        />
                                                    ) : null}
                                                </Stack>
                                            </Box>
                                        </Box>
                                    </Button>
                                );
                            }) : (
                                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                    {t('target_retarget_dialog.no_slots', { defaultValue: 'No active target slots available to retarget.' })}
                                </Typography>
                            )}
                        </Stack>
                    </Box>

                    <Divider
                        sx={{
                            mx: 0.25,
                            color: 'text.secondary',
                            fontWeight: 700,
                            letterSpacing: 0.6,
                            textTransform: 'uppercase',
                            '&::before, &::after': {
                                borderColor: 'divider',
                            },
                        }}
                    >
                        {t('target_retarget_dialog.or', { defaultValue: 'or' })}
                    </Divider>

                    <Box
                        sx={{
                            p: 1.25,
                            borderRadius: 1.5,
                            background: (theme) => `linear-gradient(135deg, ${theme.palette.secondary.main}1A 0%, ${theme.palette.secondary.main}08 100%)`,
                        }}
                    >
                        <Stack spacing={1}>
                            <Button
                                variant="outlined"
                                color="inherit"
                                onClick={() => {
                                    if (submitting) return;
                                    setPendingAction(RETARGET_ACTIONS.NEW_SLOT);
                                    if (pendingErrorMessage) {
                                        setPendingErrorMessage('');
                                    }
                                }}
                                fullWidth
                                disabled={submitting}
                                sx={{
                                    justifyContent: 'flex-start',
                                    textTransform: 'none',
                                    alignItems: 'stretch',
                                    px: 1.15,
                                    py: 0.9,
                                    minHeight: 88,
                                    borderRadius: 1.6,
                                    borderWidth: 2,
                                    borderStyle: 'dashed',
                                    color: 'text.primary',
                                    borderColor: (theme) => pendingAction === RETARGET_ACTIONS.NEW_SLOT
                                        ? theme.palette.success.main
                                        : (theme.palette.mode === 'dark' ? 'grey.700' : 'grey.400'),
                                    bgcolor: (theme) => pendingAction === RETARGET_ACTIONS.NEW_SLOT
                                        ? (theme.palette.mode === 'dark' ? 'rgba(76, 175, 80, 0.16)' : 'rgba(76, 175, 80, 0.10)')
                                        : 'transparent',
                                    boxShadow: (theme) => pendingAction === RETARGET_ACTIONS.NEW_SLOT
                                        ? (theme.palette.mode === 'dark'
                                            ? '0 6px 18px rgba(0, 0, 0, 0.45)'
                                            : '0 6px 16px rgba(16, 185, 129, 0.18)')
                                        : (theme.palette.mode === 'dark'
                                            ? '0 1px 4px rgba(0, 0, 0, 0.35)'
                                            : '0 1px 3px rgba(15, 23, 42, 0.10)'),
                                    transition: 'border-color 160ms ease, box-shadow 160ms ease, background-color 160ms ease, transform 120ms ease',
                                    '&:hover': {
                                        borderColor: (theme) => pendingAction === RETARGET_ACTIONS.NEW_SLOT
                                            ? theme.palette.success.main
                                            : (theme.palette.mode === 'dark' ? 'grey.600' : 'grey.500'),
                                        bgcolor: (theme) => pendingAction === RETARGET_ACTIONS.NEW_SLOT
                                            ? (theme.palette.mode === 'dark' ? 'rgba(76, 175, 80, 0.22)' : 'rgba(76, 175, 80, 0.14)')
                                            : 'transparent',
                                        boxShadow: (theme) => pendingAction === RETARGET_ACTIONS.NEW_SLOT
                                            ? (theme.palette.mode === 'dark'
                                                ? '0 8px 22px rgba(0, 0, 0, 0.5)'
                                                : '0 8px 20px rgba(16, 185, 129, 0.2)')
                                            : (theme.palette.mode === 'dark'
                                                ? '0 4px 12px rgba(0, 0, 0, 0.42)'
                                                : '0 4px 10px rgba(15, 23, 42, 0.12)'),
                                    },
                                    '&:active': { transform: 'translateY(1px)' },
                                }}
                            >
                                <Box sx={{ display: 'grid', gap: 0.45, width: '100%', minWidth: 0 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                                        <Typography
                                            variant="body2"
                                            sx={{
                                                fontWeight: 800,
                                                color: pendingAction === RETARGET_ACTIONS.NEW_SLOT ? 'success.main' : 'text.primary',
                                            }}
                                        >
                                            {t('target_retarget_dialog.option_new_title', { defaultValue: 'Create new target slot' })}
                                        </Typography>
                                        <Chip
                                            size="small"
                                            variant={pendingAction === RETARGET_ACTIONS.NEW_SLOT ? 'filled' : 'outlined'}
                                            color={pendingAction === RETARGET_ACTIONS.NEW_SLOT ? 'success' : 'default'}
                                            label={`Slot ${nextTargetSlotId}`}
                                            sx={{ height: 20, '& .MuiChip-label': { px: 0.8, fontSize: '0.68rem', fontFamily: 'monospace' } }}
                                        />
                                    </Box>
                                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, minWidth: 0 }}>
                                        <Typography
                                            variant="caption"
                                            sx={{ color: 'text.secondary', textAlign: 'left', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                        >
                                            {newTargetLabel}
                                        </Typography>
                                        <Stack
                                            direction="row"
                                            spacing={0.6}
                                            sx={{ flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', ml: 'auto', flexShrink: 0 }}
                                        >
                                            <Chip
                                                size="small"
                                                variant="outlined"
                                                label={t('target_retarget_dialog.no_rotator', { defaultValue: 'No rotator control' })}
                                                sx={{ height: 20, '& .MuiChip-label': { px: 0.8, fontSize: '0.68rem' } }}
                                            />
                                            <Chip
                                                size="small"
                                                variant="outlined"
                                                label={t('target_retarget_dialog.no_rig', { defaultValue: 'No rig control' })}
                                                sx={{ height: 20, '& .MuiChip-label': { px: 0.8, fontSize: '0.68rem' } }}
                                            />
                                        </Stack>
                                    </Box>
                                </Box>
                            </Button>
                        </Stack>
                    </Box>
                </Box>
                {pendingErrorMessage && (
                    <Box
                        sx={{
                            mt: 0.75,
                            px: 1.2,
                            py: 0.9,
                            borderRadius: 1.2,
                            border: '1px solid',
                            borderColor: 'error.main',
                            bgcolor: 'error.light',
                        }}
                    >
                        <Typography
                            variant="caption"
                            sx={{ color: 'error.contrastText', fontWeight: 700, lineHeight: 1.3 }}
                        >
                            {pendingErrorMessage}
                        </Typography>
                    </Box>
                )}
            </DialogContent>
            <DialogActions
                sx={{
                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
                    borderTop: (theme) => `1px solid ${theme.palette.divider}`,
                    px: 3,
                    py: 2,
                    gap: 1.5,
                }}
            >
                <Button
                    variant="outlined"
                    disabled={submitting}
                    onClick={() => closeWithResult(null)}
                >
                    {t('target_retarget_dialog.cancel', { defaultValue: 'Cancel' })}
                </Button>
                <Button
                    color="success"
                    variant="contained"
                    disabled={!canConfirm || submitting}
                    startIcon={submitting ? <CircularProgress color="inherit" size={16} /> : null}
                    onClick={async () => {
                        if (submitting) return;
                        const assignment = pendingAction === RETARGET_ACTIONS.NEW_SLOT
                            ? {
                                action: RETARGET_ACTIONS.NEW_SLOT,
                                trackerId: nextTargetSlotId,
                                rotatorId: 'none',
                                rigId: 'none',
                            }
                            : {
                                action: RETARGET_ACTIONS.CURRENT_SLOT,
                                trackerId: resolveTrackerId(pendingAssignment?.trackerId, DEFAULT_TRACKER_ID),
                                rotatorId: normalizeRotatorId(pendingAssignment?.rotatorId),
                                rigId: normalizeRigId(pendingAssignment?.rigId),
                            };
                        const submitHandler = submitHandlerRef.current;
                        if (typeof submitHandler !== 'function') {
                            closeWithResult(assignment);
                            return;
                        }
                        try {
                            setSubmitting(true);
                            setPendingErrorMessage('');
                            const submitResult = await submitHandler(assignment);
                            if (submitResult?.success === false) {
                                setPendingErrorMessage(
                                    String(
                                        submitResult?.errorMessage
                                        || t('target_retarget_dialog.submit_failed', { defaultValue: 'Failed to apply target selection.' })
                                    ),
                                );
                                setSubmitting(false);
                                return;
                            }
                            setSubmitting(false);
                            closeWithResult(assignment);
                        } catch (error) {
                            setPendingErrorMessage(
                                String(
                                    error?.message
                                    || t('target_retarget_dialog.submit_failed', { defaultValue: 'Failed to apply target selection.' })
                                ),
                            );
                            setSubmitting(false);
                        }
                    }}
                >
                    {submitting
                        ? t('target_retarget_dialog.submitting', { defaultValue: 'Applying...' })
                        : pendingAction === RETARGET_ACTIONS.NEW_SLOT
                        ? t('target_retarget_dialog.confirm_create', { defaultValue: 'Create New Target' })
                        : t('target_retarget_dialog.confirm_retarget', { defaultValue: 'Retarget Selected Slot' })}
                </Button>
            </DialogActions>
        </Dialog>
    );

    return { requestRotatorForTarget, dialog };
}
