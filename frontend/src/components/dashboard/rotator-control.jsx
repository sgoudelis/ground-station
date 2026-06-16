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
import {useSocket} from "../common/socket.jsx";
import {useDispatch, useSelector} from "react-redux";
import {
    setRotator,
    setTrackingStateInBackend,
    swapTargetRotatorsInBackend,
    setRotatorConnecting,
    setRotatorDisconnecting,
    sendNudgeCommand,
} from "../target/target-slice.jsx";
import { toast } from "../../utils/toast-with-timestamp.jsx";
import {getClassNamesBasedOnGridEditing, TitleBar} from "../common/common.jsx";
import { useTranslation } from 'react-i18next';
import Grid from "@mui/material/Grid";
import {Box, Button, Chip, FormControl, IconButton, InputLabel, MenuItem, Select, Tooltip} from "@mui/material";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import SettingsIcon from '@mui/icons-material/Settings';
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import AutorenewIcon from '@mui/icons-material/Autorenew';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import { GaugeAz, GaugeEl } from '../target/rotator-gauges.jsx';
import {
    getCurrentStatusofRotator,
    createTrackingState,
    canControlRotator,
    canStartTracking,
    canStopTracking,
    canConnectRotator,
    isRotatorSelectionDisabled
} from '../target/rotator-utils.js';
import { ROTATOR_STATES, TRACKER_COMMAND_SCOPES, TRACKER_COMMAND_STATUS } from '../target/tracking-constants.js';
import RotatorQuickEditDialog from "./rotator-quick-edit-dialog.jsx";
import {
    buildTargetKeyFromTrackingState,
} from '../target/celestial-target-utils.js';

const finiteOrNull = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const passTimeMs = (value) => {
    const parsed = new Date(value || '').getTime();
    return Number.isFinite(parsed) ? parsed : null;
};

const buildSatellitePassKey = (noradId) => {
    const normalized = String(noradId ?? '').trim();
    return normalized ? `satellite:${normalized}` : '';
};

const resolvePassTargetKey = (pass = {}) => {
    const explicitKey = String(pass?.target_key || '').trim();
    if (explicitKey) return explicitKey;
    return buildSatellitePassKey(pass?.norad_id);
};

const selectCurrentOrNextPass = ({ passes = [], nowMs = Date.now(), targetKey = '', windowHours = null }) => {
    const normalizedTargetKey = String(targetKey || '').trim();
    const windowHoursNumber = Number(windowHours);
    const windowEndMs = Number.isFinite(windowHoursNumber) && windowHoursNumber > 0
        ? nowMs + (windowHoursNumber * 3600 * 1000)
        : null;
    const scopedPasses = (Array.isArray(passes) ? passes : [])
        .filter((pass) => {
            if (!normalizedTargetKey) return false;
            return resolvePassTargetKey(pass) === normalizedTargetKey;
        })
        .filter((pass) => {
            const startMs = passTimeMs(pass?.event_start);
            const endMs = passTimeMs(pass?.event_end);
            if (startMs == null || endMs == null || endMs < nowMs) return false;
            return windowEndMs == null || startMs <= windowEndMs;
        })
        .sort((left, right) => (passTimeMs(left?.event_start) ?? 0) - (passTimeMs(right?.event_start) ?? 0));

    return scopedPasses.find((pass) => {
        const startMs = passTimeMs(pass?.event_start);
        const endMs = passTimeMs(pass?.event_end);
        return startMs != null && endMs != null && startMs <= nowMs && nowMs <= endMs;
    }) || scopedPasses[0] || null;
};


const RotatorControl = React.memo(function RotatorControl({ trackerId: trackerIdOverride = "" }) {
    const { socket } = useSocket();
    const dispatch = useDispatch();
    const { t } = useTranslation('target');
    const {
        satGroups,
        groupId,
        loading,
        error,
        satelliteSelectOpen,
        satelliteGroupSelectOpen,
        groupOfSats,
        trackingState,
        satelliteId,
        uiTrackerDisabled,
        starting,
        selectedRadioRig,
        selectedRotator,
        selectedTransmitter,
        availableTransmitters,
        rotatorData,
        gridEditable,
        satelliteData,
        lastRotatorEvent,
        satellitePasses,
        nextPassesHours,
        rotatorConnecting,
        rotatorDisconnecting,
        trackerCommandsById,
        trackerViews,
        trackerId: activeTrackerId,
    } = useSelector((state) => state.targetSatTrack);
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
    const hasTargets = trackerInstances.length > 0;
    const celestialState = useSelector((state) => state.celestial || {});

    const { rigs } = useSelector((state) => state.rigs);
    const { rotators } = useSelector((state) => state.rotators);
    const scopedTrackerId = trackerIdOverride || activeTrackerId || "";
    const scopedTrackerView = React.useMemo(
        () => (scopedTrackerId ? trackerViews?.[scopedTrackerId] || null : null),
        [trackerViews, scopedTrackerId]
    );
    const effectiveTrackingState = scopedTrackerView?.trackingState || trackingState;
    const effectiveGroupId = scopedTrackerView?.groupId ?? groupId;
    const effectiveSatelliteId = scopedTrackerView?.satelliteId ?? satelliteId;
    const effectiveSelectedRadioRig = scopedTrackerView?.selectedRadioRig ?? selectedRadioRig;
    const effectiveSelectedRotator = scopedTrackerView?.selectedRotator ?? selectedRotator;
    const effectiveSelectedTransmitter = scopedTrackerView?.selectedTransmitter ?? selectedTransmitter;
    const effectiveRotatorData = scopedTrackerView?.rotatorData || rotatorData;
    const effectiveSatelliteData = scopedTrackerView?.satelliteData || satelliteData;
    const effectiveLastRotatorEvent = scopedTrackerView?.lastRotatorEvent ?? lastRotatorEvent;
    const scopedTrackerCommand = (scopedTrackerId && trackerCommandsById?.[scopedTrackerId]) || null;
    const isRotatorCommandBusy = Boolean(
        scopedTrackerCommand &&
        [TRACKER_COMMAND_SCOPES.ROTATOR, TRACKER_COMMAND_SCOPES.TRACKING].includes(scopedTrackerCommand.scope) &&
        scopedTrackerCommand?.requestedState?.rotatorState &&
        [TRACKER_COMMAND_STATUS.SUBMITTED, TRACKER_COMMAND_STATUS.STARTED].includes(scopedTrackerCommand.status)
    );
    const inFlightRotatorState = scopedTrackerCommand?.requestedState?.rotatorState;
    const isConnectActionPending = isRotatorCommandBusy && inFlightRotatorState === ROTATOR_STATES.CONNECTED;
    const isDisconnectActionPending = isRotatorCommandBusy && inFlightRotatorState === ROTATOR_STATES.DISCONNECTED;
    const isTrackActionPending = isRotatorCommandBusy && inFlightRotatorState === ROTATOR_STATES.TRACKING;
    const isStopActionPending = isRotatorCommandBusy && inFlightRotatorState === ROTATOR_STATES.STOPPED;
    const isParkActionPending = isRotatorCommandBusy && inFlightRotatorState === ROTATOR_STATES.PARKED;
    const [isSocketConnected, setIsSocketConnected] = React.useState(Boolean(socket?.connected));
    const [lastRotatorUpdateAt, setLastRotatorUpdateAt] = React.useState(Date.now());
    const [now, setNow] = React.useState(Date.now());
    const [openQuickEditDialog, setOpenQuickEditDialog] = React.useState(false);

    const activeRotatorCommand = React.useMemo(() => {
        if (!scopedTrackerCommand) return null;
        const supportsScope = [TRACKER_COMMAND_SCOPES.ROTATOR, TRACKER_COMMAND_SCOPES.TRACKING].includes(scopedTrackerCommand.scope);
        return supportsScope && scopedTrackerCommand?.requestedState?.rotatorState ? scopedTrackerCommand : null;
    }, [scopedTrackerCommand]);

    React.useEffect(() => {
        if (!socket) return;
        setIsSocketConnected(Boolean(socket.connected));
        const handleConnect = () => setIsSocketConnected(true);
        const handleDisconnect = () => setIsSocketConnected(false);
        socket.on('connect', handleConnect);
        socket.on('disconnect', handleDisconnect);
        return () => {
            socket.off('connect', handleConnect);
            socket.off('disconnect', handleDisconnect);
        };
    }, [socket]);

    React.useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    React.useEffect(() => {
        setLastRotatorUpdateAt(Date.now());
    }, [
        effectiveRotatorData?.connected,
        effectiveRotatorData?.tracking,
        effectiveRotatorData?.slewing,
        effectiveRotatorData?.parked,
        effectiveRotatorData?.stopped,
        effectiveRotatorData?.az,
        effectiveRotatorData?.el,
    ]);

    const effectiveSelectedRotatorValue = hasTargets ? effectiveSelectedRotator : "none";
    const selectedRotatorDevice = React.useMemo(
        () => rotators.find((rotator) => rotator.id === effectiveSelectedRotatorValue),
        [rotators, effectiveSelectedRotatorValue]
    );

    const rotatorUsageById = React.useMemo(() => {
        const usage = {};
        trackerInstances.forEach((instance, index) => {
            const trackerId = String(instance?.tracker_id || '');
            if (!trackerId) return;
            const targetNumber = Number(instance?.target_number || (index + 1));
            const rotatorId = String(instance?.rotator_id || instance?.tracking_state?.rotator_id || 'none');
            if (!rotatorId || rotatorId === 'none') return;
            if (!usage[rotatorId]) usage[rotatorId] = [];
            usage[rotatorId].push({
                trackerId,
                targetNumber,
                noradId: instance?.tracking_state?.norad_id ?? null,
            });
        });
        return usage;
    }, [trackerInstances]);

    const rotatorStatusChip = React.useMemo(() => {
        if (!isSocketConnected) return { label: 'Offline', color: 'default' };
        if (!effectiveRotatorData?.connected) {
            return {
                label: t('common.disconnected', { ns: 'common', defaultValue: 'Disconnected' }),
                color: 'default'
            };
        }
        if (effectiveRotatorData?.tracking) return { label: 'Tracking', color: 'success' };
        if (effectiveRotatorData?.slewing) return { label: 'Slewing', color: 'warning' };
        if (effectiveRotatorData?.parked) return { label: 'Parked', color: 'warning' };
        if (effectiveRotatorData?.stopped) return { label: 'Stopped', color: 'warning' };
        return { label: 'Connected', color: 'success' };
    }, [isSocketConnected, effectiveRotatorData?.connected, effectiveRotatorData?.tracking, effectiveRotatorData?.slewing, effectiveRotatorData?.parked, effectiveRotatorData?.stopped, t]);
    const rotatorStatusLedColor = React.useMemo(() => {
        if (!isSocketConnected) return 'action.disabled';
        if (!effectiveRotatorData?.connected) return 'action.disabled';
        if (effectiveRotatorData?.tracking) return 'success.main';
        if (effectiveRotatorData?.slewing) return 'warning.main';
        if (effectiveRotatorData?.parked) return 'warning.main';
        if (effectiveRotatorData?.stopped) return 'info.main';
        return 'success.main';
    }, [isSocketConnected, effectiveRotatorData?.connected, effectiveRotatorData?.tracking, effectiveRotatorData?.slewing, effectiveRotatorData?.parked, effectiveRotatorData?.stopped]);

    const commandStateLabel = React.useMemo(() => {
        if (!activeRotatorCommand) return t('common.not_available', { ns: 'common', defaultValue: 'N/A' });
        if (activeRotatorCommand.status === TRACKER_COMMAND_STATUS.SUBMITTED) return t('common.pending', { ns: 'common', defaultValue: 'Pending' });
        if (activeRotatorCommand.status === TRACKER_COMMAND_STATUS.STARTED) return t('common.in_progress', { ns: 'common', defaultValue: 'In progress' });
        if (activeRotatorCommand.status === TRACKER_COMMAND_STATUS.SUCCEEDED) return t('common.success', { ns: 'common', defaultValue: 'Success' });
        if (activeRotatorCommand.status === TRACKER_COMMAND_STATUS.FAILED) return t('common.failed', { ns: 'common', defaultValue: 'Failed' });
        return t('common.unknown', { ns: 'common', defaultValue: 'Unknown' });
    }, [activeRotatorCommand, t]);

    const commandStatusIcon = React.useMemo(() => {
        if (!activeRotatorCommand) return { Icon: MoreHorizIcon, color: 'text.disabled' };
        if (activeRotatorCommand.status === TRACKER_COMMAND_STATUS.SUCCEEDED) {
            return { Icon: CheckCircleOutlineIcon, color: 'success.main' };
        }
        if (activeRotatorCommand.status === TRACKER_COMMAND_STATUS.FAILED) {
            return { Icon: ErrorOutlineIcon, color: 'error.main' };
        }
        if ([TRACKER_COMMAND_STATUS.SUBMITTED, TRACKER_COMMAND_STATUS.STARTED].includes(activeRotatorCommand.status)) {
            return { Icon: AutorenewIcon, color: 'info.main' };
        }
        return { Icon: MoreHorizIcon, color: 'text.disabled' };
    }, [activeRotatorCommand]);

    const lastUpdateAge = Math.max(0, Math.floor((now - lastRotatorUpdateAt) / 1000));
    const effectiveTargetPassKey = React.useMemo(
        () => buildTargetKeyFromTrackingState(effectiveTrackingState) || buildSatellitePassKey(effectiveSatelliteId),
        [effectiveSatelliteId, effectiveTrackingState]
    );
    const targetCurrentPosition = React.useMemo(() => ({
        az: finiteOrNull(effectiveSatelliteData?.position?.az),
        el: finiteOrNull(effectiveSatelliteData?.position?.el),
    }), [effectiveSatelliteData?.position?.az, effectiveSatelliteData?.position?.el]);
    const gaugePass = React.useMemo(() => {
        const combinedPasses = [
            ...(Array.isArray(satellitePasses) ? satellitePasses : []),
            ...(Array.isArray(celestialState?.celestialTracks?.celestial_passes)
                ? celestialState.celestialTracks.celestial_passes
                : []),
        ];
        return selectCurrentOrNextPass({
            passes: combinedPasses,
            nowMs: now,
            targetKey: effectiveTargetPassKey,
            windowHours: nextPassesHours,
        });
    }, [
        celestialState?.celestialTracks?.celestial_passes,
        effectiveTargetPassKey,
        nextPassesHours,
        now,
        satellitePasses,
    ]);

    const connectDisabled = !hasTargets || isRotatorCommandBusy || !canConnectRotator(effectiveRotatorData, effectiveSelectedRotatorValue);
    const connectDisabledReason = !hasTargets
        ? 'No targets configured'
        : isRotatorCommandBusy
        ? 'Command in progress'
        : !canConnectRotator(effectiveRotatorData, effectiveSelectedRotatorValue)
            ? 'Select a rotator first'
            : null;

    const disconnectDisabled = !hasTargets || isRotatorCommandBusy || [ROTATOR_STATES.DISCONNECTED].includes(effectiveTrackingState['rotator_state']);
    const disconnectDisabledReason = !hasTargets
        ? 'No targets configured'
        : isRotatorCommandBusy
        ? 'Command in progress'
        : [ROTATOR_STATES.DISCONNECTED].includes(effectiveTrackingState['rotator_state'])
            ? 'Rotator is already disconnected'
            : null;

    const parkDisabled = !hasTargets || isRotatorCommandBusy || [ROTATOR_STATES.DISCONNECTED].includes(effectiveTrackingState['rotator_state']);
    const parkDisabledReason = !hasTargets
        ? 'No targets configured'
        : isRotatorCommandBusy
        ? 'Command in progress'
        : [ROTATOR_STATES.DISCONNECTED].includes(effectiveTrackingState['rotator_state'])
            ? 'Connect the rotator first'
            : null;

    const trackDisabled = !hasTargets || isRotatorCommandBusy || !canStartTracking(effectiveTrackingState, effectiveSatelliteId, effectiveSelectedRotatorValue);
    const trackDisabledReason = !hasTargets
        ? 'No targets configured'
        : isRotatorCommandBusy
        ? 'Command in progress'
        : !canStartTracking(effectiveTrackingState, effectiveSatelliteId, effectiveSelectedRotatorValue)
            ? 'Select a target and rotator, then connect first'
            : null;

    const stopDisabled = !hasTargets || isRotatorCommandBusy || !canStopTracking(effectiveTrackingState, effectiveSatelliteId, effectiveSelectedRotatorValue);
    const stopDisabledReason = !hasTargets
        ? 'No targets configured'
        : isRotatorCommandBusy
        ? 'Command in progress'
        : !canStopTracking(effectiveTrackingState, effectiveSatelliteId, effectiveSelectedRotatorValue)
            ? 'Rotator is not currently tracking'
            : null;

    const handleTrackingStop = () => {
        const newTrackingState = {
            ...effectiveTrackingState,
            tracker_id: scopedTrackerId,
            'rotator_state': ROTATOR_STATES.STOPPED,
        };
        dispatch(setTrackingStateInBackend({socket, data: newTrackingState}));
    };

    const handleTrackingStart = () => {
        const newTrackingState = createTrackingState({
            satelliteId: effectiveSatelliteId,
            groupId: effectiveGroupId,
            rotatorState: ROTATOR_STATES.TRACKING,
            rigState: effectiveTrackingState['rig_state'],
            selectedRadioRig: effectiveSelectedRadioRig,
            selectedRotator: effectiveSelectedRotator,
            selectedTransmitter: effectiveSelectedTransmitter
        });
        newTrackingState.tracker_id = scopedTrackerId;

        dispatch(setTrackingStateInBackend({socket, data: newTrackingState}))
            .unwrap()
            .then((response) => {

            })
            .catch((error) => {
                toast.error(`${t('rotator_control.failed_start_tracking')}: ${error.message}`);
            });
    };

    function parkRotator() {
        const newTrackingState = createTrackingState({
            satelliteId: effectiveSatelliteId,
            groupId: effectiveGroupId,
            rotatorState: ROTATOR_STATES.PARKED,
            rigState: effectiveTrackingState['rig_state'],
            selectedRadioRig: effectiveSelectedRadioRig,
            selectedRotator: effectiveSelectedRotator,
            selectedTransmitter: effectiveSelectedTransmitter
        });
        newTrackingState.tracker_id = scopedTrackerId;
        dispatch(setTrackingStateInBackend({socket, data: newTrackingState}))
            .unwrap()
            .then((response) => {

            });
    }

    function connectRotator() {
        const newTrackingState = createTrackingState({
            satelliteId: effectiveSatelliteId,
            groupId: effectiveGroupId,
            rotatorState: ROTATOR_STATES.CONNECTED,
            rigState: effectiveTrackingState['rig_state'],
            selectedRadioRig: effectiveSelectedRadioRig,
            selectedRotator: effectiveSelectedRotator,
            selectedTransmitter: effectiveSelectedTransmitter
        });
        newTrackingState.tracker_id = scopedTrackerId;
        dispatch(setTrackingStateInBackend({socket, data: newTrackingState}))
            .unwrap()
            .then((response) => {
                //console.info("Response on setTrackingStateInBackend (connect): ", response);
            })
        .catch((error) => {
            dispatch(setRotatorConnecting(false));
        });
    }

    function disconnectRotator() {
        const newTrackingState = createTrackingState({
            satelliteId: effectiveSatelliteId,
            groupId: effectiveGroupId,
            rotatorState: ROTATOR_STATES.DISCONNECTED,
            rigState: effectiveTrackingState['rig_state'],
            selectedRadioRig: effectiveSelectedRadioRig,
            selectedRotator: effectiveSelectedRotator,
            selectedTransmitter: effectiveSelectedTransmitter
        });
        newTrackingState.tracker_id = scopedTrackerId;
        dispatch(setTrackingStateInBackend({socket, data: newTrackingState}))
            .unwrap()
            .then((response) => {
                console.info("Response on setTrackingStateInBackend (disconnect): ", response);
            })
        .catch((error) => {
            dispatch(setRotatorDisconnecting(false));
        });
    }

    function handleRotatorChange(event) {
        const newRotatorId = event.target.value;
        const rotatorUsageRows = rotatorUsageById[String(newRotatorId)] || [];
        const ownerUsage = rotatorUsageRows.find((row) => row.trackerId !== scopedTrackerId);
        if (ownerUsage) {
            const ownerTrackerId = String(ownerUsage.trackerId || '');
            const ownerTrackerInstance = trackerInstances.find(
                (instance) => String(instance?.tracker_id || '') === ownerTrackerId
            );
            const ownerRotatorState = ownerTrackerInstance?.tracking_state?.rotator_state;
            const requesterRotatorState = effectiveTrackingState?.rotator_state;
            const ownerDisconnected = ownerRotatorState === ROTATOR_STATES.DISCONNECTED;
            const requesterDisconnected = requesterRotatorState === ROTATOR_STATES.DISCONNECTED;
            if (!ownerDisconnected || !requesterDisconnected) {
                toast.error('Swap requires both targets to have rotators disconnected');
                return;
            }

            dispatch(
                swapTargetRotatorsInBackend({
                    socket,
                    trackerAId: scopedTrackerId,
                    trackerBId: ownerTrackerId,
                })
            )
                .unwrap()
                .then(() => {
                    dispatch(setRotator({ value: newRotatorId, trackerId: scopedTrackerId }));
                })
                .catch((error) => {
                    toast.error(error?.message || 'Failed swapping rotators');
                });
            return;
        }

        // Optimistic UI update so selection reflects immediately while backend confirms.
        dispatch(setRotator({ value: newRotatorId, trackerId: scopedTrackerId }));
        const newTrackingState = {
            ...effectiveTrackingState,
            tracker_id: scopedTrackerId,
            norad_id: effectiveSatelliteId,
            group_id: effectiveGroupId,
            rig_id: effectiveSelectedRadioRig,
            rotator_id: newRotatorId,
            transmitter_id: effectiveSelectedTransmitter,
        };
        dispatch(setTrackingStateInBackend({socket, data: newTrackingState}));
    }

    function handleNudgeCommand(cmd) {
        dispatch(sendNudgeCommand({socket: socket, cmd: {'cmd': cmd, tracker_id: scopedTrackerId}}));
    }

    return (
        <>
            <TitleBar className={getClassNamesBasedOnGridEditing(gridEditable, ["window-title-bar"])}>
                {t('rotator_control.title', { defaultValue: 'Rotator Control' })}
            </TitleBar>
            <Grid container spacing={{ xs: 0, md: 0 }} columns={{ xs: 12, sm: 12, md: 12 }}>
                <Grid
                    size={{ xs: 12, sm: 12, md: 12 }}
                    sx={{
                        px: 1.5,
                        py: 1.05,
                        background: (() => {
                            if (!isSocketConnected) {
                                return (theme) => `linear-gradient(135deg, ${theme.palette.overlay.light} 0%, ${theme.palette.overlay.main} 100%)`;
                            }
                            if (effectiveRotatorData?.tracking) {
                                return (theme) => `linear-gradient(135deg, ${theme.palette.success.main}26 0%, ${theme.palette.success.main}0D 100%)`;
                            }
                            if (effectiveRotatorData?.slewing || effectiveRotatorData?.parked) {
                                return (theme) => `linear-gradient(135deg, ${theme.palette.warning.main}26 0%, ${theme.palette.warning.main}0D 100%)`;
                            }
                            if (effectiveRotatorData?.connected) {
                                return (theme) => `linear-gradient(135deg, ${theme.palette.info.main}26 0%, ${theme.palette.info.main}0D 100%)`;
                            }
                            return (theme) => `linear-gradient(135deg, ${theme.palette.action.disabledBackground} 0%, ${theme.palette.action.hover} 100%)`;
                        })(),
                        borderBottom: '1px solid',
                        borderColor: 'divider'
                    }}
                >
                    <Box
                        title={
                            `${selectedRotatorDevice ? `${selectedRotatorDevice.name} (${selectedRotatorDevice.host}:${selectedRotatorDevice.port})` : 'No rotator selected'} | ` +
                            `Socket ${isSocketConnected ? 'Online' : 'Offline'} | ` +
                            `Updated ${lastUpdateAge}s | ` +
                            `Cmd ${commandStateLabel}` +
                            (activeRotatorCommand?.status === TRACKER_COMMAND_STATUS.FAILED && activeRotatorCommand?.reason ? ` | ${activeRotatorCommand.reason}` : '')
                        }
                        sx={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 0.45,
                            minWidth: 0,
                        }}
                    >
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minWidth: 0, gap: 0.7 }}>
                            <Box sx={{ display: 'inline-flex', alignItems: 'center', minWidth: 0 }}>
                                <Box
                                    sx={{
                                        width: 9,
                                        height: 9,
                                        borderRadius: '50%',
                                        mr: 0.8,
                                        flexShrink: 0,
                                        bgcolor: rotatorStatusLedColor,
                                    }}
                                />
                                <Box sx={{ minWidth: 0 }}>
                                    <Typography variant="caption" noWrap sx={{ display: 'block', fontWeight: 800, fontSize: '0.72rem', lineHeight: 1.1 }}>
                                        {selectedRotatorDevice ? selectedRotatorDevice.name : 'No rotator selected'}
                                    </Typography>
                                    <Typography variant="caption" noWrap sx={{ display: 'block', color: 'text.secondary', fontSize: '0.62rem', lineHeight: 1.1 }}>
                                        {rotatorStatusChip.label}
                                    </Typography>
                                </Box>
                            </Box>
                            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, flexShrink: 0 }}>
                                <commandStatusIcon.Icon sx={{ fontSize: '0.8rem', color: commandStatusIcon.color }} />
                                <Typography variant="caption" sx={{ fontSize: '0.62rem', color: 'text.secondary' }}>
                                    {`${lastUpdateAge}s`}
                                </Typography>
                            </Box>
                        </Box>
                    </Box>
                </Grid>

                <Grid size={{ xs: 12, sm: 12, md: 12 }} style={{padding: '0.5rem 0.5rem 0rem 0.5rem'}}>
                    <Grid container direction="row" spacing={1} sx={{ alignItems: 'flex-end' }}>
                        <Grid size="grow">
                            <FormControl disabled={!hasTargets || isRotatorSelectionDisabled(effectiveTrackingState)}
                                         sx={{minWidth: 200, marginTop: 0, marginBottom: 1}} fullWidth variant="outlined" size="small">
                                <InputLabel htmlFor="rotator-select">{t('rotator_control_labels.rotator_label')}</InputLabel>
                                <Select
                                    id="rotator-select"
                                    value={hasTargets && rotators.some((rotator) => String(rotator.id) === String(effectiveSelectedRotatorValue)) ? effectiveSelectedRotatorValue : "none"}
                                    onChange={(event) => {
                                        handleRotatorChange(event);
                                    }}
                                    renderValue={(selected) => {
                                        if (String(selected) === 'none') {
                                            return t('rotator_control_labels.no_rotator_control');
                                        }
                                        const selectedRotator = rotators.find((rotator) => String(rotator.id) === String(selected));
                                        if (!selectedRotator) {
                                            return t('rotator_control_labels.no_rotator_control');
                                        }
                                        return (
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                                                <Typography variant="body2" noWrap sx={{ fontWeight: 600, minWidth: 0 }}>
                                                    {selectedRotator.name}
                                                </Typography>
                                                {(() => {
                                                    const usageRows = rotatorUsageById[String(selectedRotator.id)] || [];
                                                    const inUseByOthers = usageRows.filter((row) => row.trackerId !== scopedTrackerId);
                                                    if (inUseByOthers.length === 0) return null;
                                                    const targetSummary = inUseByOthers
                                                        .slice(0, 2)
                                                        .map((row) => `T${row.targetNumber}`)
                                                        .join(',');
                                                    return (
                                                        <Chip
                                                            size="small"
                                                            color="warning"
                                                            label={`In use ${targetSummary}`}
                                                            sx={{ height: 18, fontSize: '0.62rem', flexShrink: 0 }}
                                                        />
                                                    );
                                                })()}
                                                <Chip
                                                    size="small"
                                                    label={`${selectedRotator.host}:${selectedRotator.port}`}
                                                    variant="outlined"
                                                    sx={{ height: 18, fontSize: '0.62rem', fontFamily: 'monospace', flexShrink: 0 }}
                                                />
                                            </Box>
                                        );
                                    }}
                                    size="small"
                                    label={t('rotator_control_labels.rotator_label')}>
                                    <MenuItem value="none">
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                                                {t('rotator_control_labels.no_rotator_control')}
                                            </Typography>
                                            <Chip
                                                label="None"
                                                size="small"
                                                variant="outlined"
                                                sx={{ ml: 'auto', height: 18, fontSize: '0.62rem' }}
                                            />
                                        </Box>
                                    </MenuItem>
                                    {rotators.map((rotator, index) => {
                                        const usageRows = rotatorUsageById[String(rotator.id)] || [];
                                        const inUseByOthers = usageRows.filter((row) => row.trackerId !== scopedTrackerId);
                                        const inUseLabel = inUseByOthers.length > 0
                                            ? `In use ${inUseByOthers.slice(0, 2).map((row) => `T${row.targetNumber}`).join(',')}`
                                            : null;
                                        return (
                                            <MenuItem value={rotator.id} key={index} sx={{ py: 0.75 }}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                                    <Typography variant="body2" noWrap sx={{ fontWeight: 600, minWidth: 0, flex: 1 }}>
                                                        {rotator.name}
                                                    </Typography>
                                                    {inUseLabel && (
                                                        <Chip
                                                            size="small"
                                                            color="warning"
                                                            label={inUseLabel}
                                                            sx={{ height: 18, fontSize: '0.62rem', flexShrink: 0 }}
                                                        />
                                                    )}
                                                    <Chip
                                                        size="small"
                                                        label={`${rotator.host}:${rotator.port}`}
                                                        variant="outlined"
                                                        sx={{ height: 18, fontSize: '0.62rem', flexShrink: 0, fontFamily: 'monospace' }}
                                                    />
                                                </Box>
                                            </MenuItem>
                                        );
                                    })}
                                </Select>
                            </FormControl>
                        </Grid>
                        <Grid>
                            <IconButton
                                onClick={() => setOpenQuickEditDialog(true)}
                                disabled={!hasTargets || !effectiveSelectedRotatorValue || effectiveSelectedRotatorValue === 'none'}
                                sx={{
                                    height: '100%',
                                    marginBottom: 1,
                                    borderRadius: 1,
                                    backgroundColor: 'primary.main',
                                    color: 'white',
                                    border: '1px solid',
                                    borderColor: 'primary.dark',
                                    '&:hover': {
                                        backgroundColor: 'primary.dark',
                                    }
                                    ,
                                    '&.Mui-disabled': {
                                        backgroundColor: 'action.disabledBackground',
                                        color: 'action.disabled',
                                        borderColor: 'divider',
                                    },
                                }}
                            >
                                <SettingsIcon />
                            </IconButton>
                        </Grid>
                    </Grid>
                </Grid>

                <Grid size={{ xs: 12, sm: 12, md: 12 }} style={{padding: '0rem 0.5rem 0rem 0.5rem'}}>

                    <Grid container direction="row" sx={{
                        justifyContent: "space-between",
                        alignItems: "center",
                    }}>

                    </Grid>

                    <Grid container direction="row" sx={{
                        justifyContent: "space-between",
                        alignItems: "center",
                    }}>
                        <Grid size="grow" style={{textAlign: 'center'}}>
                            <GaugeAz
                                az={effectiveRotatorData['az']}
                                limits={[gaugePass?.start_azimuth, gaugePass?.end_azimuth]}
                                peakAz={gaugePass?.peak_azimuth}
                                targetCurrentAz={targetCurrentPosition.az}
                                isGeoStationary={gaugePass?.is_geostationary}
                                isGeoSynchronous={gaugePass?.is_geosynchronous}
                                hardwareLimits={[effectiveRotatorData['minaz'], effectiveRotatorData['maxaz']]}
                            />
                        </Grid>
                        <Grid size="grow" style={{textAlign: 'center'}}>
                            <GaugeEl
                                el={effectiveRotatorData['el']}
                                maxElevation={gaugePass?.peak_altitude}
                                targetCurrentEl={targetCurrentPosition.el}
                                hardwareLimits={[effectiveRotatorData['minel'], effectiveRotatorData['maxel']]}
                            />
                        </Grid>

                    </Grid>

                    <Grid container direction="row" sx={{
                        justifyContent: "space-between",
                        alignItems: "stretch",
                    }}>
                        <Grid size="grow" style={{textAlign: 'center'}}>
                            {t('rotator_control.az')} <Typography
                            variant="h5"
                            sx={{
                                fontFamily: "Monospace, monospace",
                                fontWeight: "bold",
                                display: "inline-flex",
                                alignItems: "center",
                                minWidth: "80px",
                                justifyContent: "center"
                            }}
                        >
                            {effectiveRotatorData['az'].toFixed(1)}°
                        </Typography>
                        </Grid>
                        <Grid size="grow" style={{textAlign: 'center'}}>
                             {t('rotator_control.el')} <Typography
                            variant="h5"
                            sx={{
                                fontFamily: "Monospace, monospace",
                                fontWeight: "bold",
                                display: "inline-flex",
                                alignItems: "center",
                                minWidth: "80px",
                                justifyContent: "center"
                            }}
                        >
                            {effectiveRotatorData['el'].toFixed(1)}°
                        </Typography>
                        </Grid>
                    </Grid>

                    <Grid container direction="row" sx={{
                        justifyContent: "space-between",
                        alignItems: "stretch",
                    }}>
                        <Grid size="grow"
                              style={{paddingRight: '0.5rem', flex: 1, paddingBottom: '0.5rem', paddingTop: '0.2rem'}}
                              container spacing={1} justifyContent="center">
                            <Grid>
                                <Button
                                    size="small"
                                    disabled={!hasTargets || !canControlRotator(effectiveRotatorData, effectiveTrackingState)}
                                    fullWidth={true}
                                    variant="contained"
                                    color="primary"
                                    style={{height: '30px', fontSize: '0.9rem', padding: 0}}
                                    onClick={() => {
                                        handleNudgeCommand("nudge_counter_clockwise");
                                    }}>
                                    {t('rotator_control.ccw')}
                                </Button>
                            </Grid>
                            <Grid>
                                <Button
                                    size="small"
                                    disabled={!hasTargets || !canControlRotator(effectiveRotatorData, effectiveTrackingState)}
                                    fullWidth={true}
                                    variant="contained"
                                    color="primary"
                                    sx={{}}
                                    style={{height: '30px', fontSize: '0.9rem', padding: 0}}
                                    onClick={() => {
                                        handleNudgeCommand("nudge_clockwise");
                                    }}>
                                    {t('rotator_control.cw')}
                                </Button>
                            </Grid>
                        </Grid>
                        <Grid size="grow"
                              style={{paddingRight: '0rem', flex: 1, paddingBottom: '0.5rem', paddingTop: '0.2rem'}}
                              container
                              spacing={1} justifyContent="center">
                            <Grid>
                                <Button
                                    size="small"
                                    disabled={!hasTargets || !canControlRotator(effectiveRotatorData, effectiveTrackingState)}
                                    fullWidth={true}
                                    variant="contained"
                                    color="primary"
                                    style={{height: '30px', fontSize: '0.9rem', padding: 0}}
                                    onClick={() => {
                                        handleNudgeCommand("nudge_up");
                                    }}>
                                    {t('rotator_control.up')}
                                </Button>
                            </Grid>
                            <Grid>
                                <Button
                                    size="small"
                                    disabled={!hasTargets || !canControlRotator(effectiveRotatorData, effectiveTrackingState)}
                                    fullWidth={true}
                                    variant="contained"
                                    color="primary"
                                    style={{height: '30px', fontSize: '0.9rem', padding: 0}}
                                    onClick={() => {
                                        handleNudgeCommand("nudge_down");
                                    }}>
                                    {t('rotator_control.down')}
                                </Button>
                            </Grid>
                        </Grid>
                    </Grid>

                    <Grid container direction="row" sx={{
                        justifyContent: "space-between",
                        alignItems: "stretch",
                    }}>
                        <Grid size="grow" style={{textAlign: 'center'}}>
                            <Paper
                                elevation={1}
                                sx={{
                                    height: '30px',
                                    padding: '2px 0px',
                                    backgroundColor: theme => {
                                        const rotatorStatus = getCurrentStatusofRotator(effectiveRotatorData, effectiveLastRotatorEvent);
                                        return rotatorStatus.bgColor
                                    },
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: '4px',
                                    minWidth: '180px',
                                    width: '100%',
                                }}
                            >
                                <Typography
                                    variant="body2"
                                    sx={{
                                        fontFamily: "Monospace, monospace",
                                        fontWeight: "bold",
                                        color: theme => {
                                            const rotatorStatus = getCurrentStatusofRotator(effectiveRotatorData, effectiveLastRotatorEvent);
                                            return rotatorStatus.fgColor;
                                        }
                                    }}
                                >
                                    {getCurrentStatusofRotator(effectiveRotatorData, effectiveLastRotatorEvent).value}
                                </Typography>
                            </Paper>
                        </Grid>

                    </Grid>
                </Grid>

                <Grid size={{ xs: 12, sm: 12, md: 12 }} style={{padding: '0.5rem 0.5rem 0rem 0.5rem'}}>
                    <Grid container direction="row" sx={{
                        justifyContent: "space-between",
                        alignItems: "stretch",
                    }}>
                        <Grid size="grow" style={{paddingRight: '0.5rem', flex: 1}}>
                            <Tooltip title={connectDisabled ? connectDisabledReason : ''}>
                                <span style={{ display: 'block' }}>
                                    <Button
                                        loading={isConnectActionPending || rotatorConnecting}
                                        disabled={connectDisabled}
                                        fullWidth={true}
                                        variant="contained"
                                        color="success"
                                        style={{height: '52px'}}
                                        onClick={() => {
                                            connectRotator()
                                        }}
                                    >
                                        {t('rotator_control.connect')}
                                    </Button>
                                </span>
                            </Tooltip>
                        </Grid>
                        <Grid size="grow" style={{paddingRight: '0.5rem', flex: 1.5}}>
                            <Tooltip title={disconnectDisabled ? disconnectDisabledReason : ''}>
                                <span style={{ display: 'block' }}>
                                    <Button
                                        loading={isDisconnectActionPending || rotatorDisconnecting}
                                        disabled={disconnectDisabled}
                                        fullWidth={true}
                                        variant="contained"
                                        color="error"
                                        style={{height: '52px'}}
                                        onClick={() => {
                                             disconnectRotator()
                                        }}
                                    >
                                        {t('rotator_control.disconnect')}
                                    </Button>
                                </span>
                            </Tooltip>
                        </Grid>
                        <Grid size="grow" style={{paddingRight: '0rem', flex: 1}}>
                            <Tooltip title={parkDisabled ? parkDisabledReason : ''}>
                                <span style={{ display: 'block' }}>
                                    <Button
                                        loading={isParkActionPending}
                                        disabled={parkDisabled}
                                        fullWidth={true}
                                        variant="contained"
                                        color="warning"
                                        style={{height: '52px'}}
                                        onClick={() => {
                                            parkRotator()
                                        }}
                                    >
                                        {t('rotator_control.park')}
                                    </Button>
                                </span>
                            </Tooltip>
                        </Grid>
                    </Grid>
                </Grid>

                <Grid size={{xs: 12, sm: 12, md: 12}} style={{padding: '0.5rem 0.5rem 0.5rem'}}>
                    <Grid container direction="row" sx={{
                        justifyContent: "space-between",
                        alignItems: "stretch",
                    }}>
                        <Grid size="grow" style={{paddingRight: '0.5rem'}}>
                            <Tooltip title={trackDisabled ? trackDisabledReason : ''}>
                                <span style={{ display: 'block' }}>
                                    <Button
                                        fullWidth={true}
                                        loading={isTrackActionPending}
                                        disabled={trackDisabled}
                                        variant="contained"
                                        color="success"
                                        style={{height: '60px'}}
                                        onClick={()=>{handleTrackingStart()}}
                                    >
                                        {t('rotator_control.track')}
                                    </Button>
                                </span>
                            </Tooltip>
                        </Grid>
                        <Grid size="grow">
                            <Tooltip title={stopDisabled ? stopDisabledReason : ''}>
                                <span style={{ display: 'block' }}>
                                    <Button
                                        fullWidth={true}
                                        loading={isStopActionPending}
                                        disabled={stopDisabled}
                                        variant="contained"
                                        color="error"
                                        style={{height: '60px'}}
                                        onClick={() => {handleTrackingStop()}}
                                    >
                                        {t('rotator_control.stop')}
                                    </Button>
                                </span>
                            </Tooltip>
                        </Grid>
                    </Grid>
                </Grid>
            </Grid>
            <RotatorQuickEditDialog
                open={openQuickEditDialog}
                onClose={() => setOpenQuickEditDialog(false)}
                rotator={selectedRotatorDevice || null}
            />
        </>
    );
});

export default RotatorControl;
