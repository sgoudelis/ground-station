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
    moveRotatorToPosition,
    stopRotator,
} from "../target/target-slice.jsx";
import {getClassNamesBasedOnGridEditing, TitleBar} from "../common/common.jsx";
import { useTranslation } from 'react-i18next';
import Grid from "@mui/material/Grid";
import {Box, Button, Chip, FormControl, IconButton, InputLabel, MenuItem, Select, Tooltip} from "@mui/material";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import SettingsIcon from '@mui/icons-material/Settings';
import { GaugeAz, GaugeEl } from '../target/rotator-gauges.jsx';
import {
    canControlRotator,
    canStartTracking,
    canStopTracking,
    canConnectRotator,
    isRotatorSelectionDisabled
} from '../target/rotator-utils.js';
import { ROTATOR_STATES } from '../target/tracking-constants.js';
import RotatorQuickEditDialog from "./rotator-quick-edit-dialog.jsx";
import ManualRotatorDialog from "./manual-rotator-dialog.jsx";
import {
    buildTargetKeyFromTrackingState,
} from '../target/celestial-target-utils.js';

import {useHardwareCommand} from '../target/use-hardware-command.js';
import HardwareControlHeader from './hardware-control-header.jsx';
import ErrorDialog from '../common/error-dialog.jsx';

const finiteOrNull = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const signedAzimuthDifference = (targetAzimuth, rotatorAzimuth) => {
    // Use the shortest turn across north so the error stays within ±180°.
    const difference = targetAzimuth - rotatorAzimuth;
    return ((difference % 360) + 540) % 360 - 180;
};

const formatPointingError = (value) => `${value >= 0 ? '+' : ''}${value.toFixed(1)}°`;

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
        groupId,
        trackingState,
        satelliteId,
        selectedRadioRig,
        selectedRotator,
        selectedTransmitter,
        rotatorData,
        gridEditable,
        satelliteData,
        satellitePasses,
        nextPassesHours,
        trackerCommandsById,
        trackerViews,
        trackerId: activeTrackerId,
    } = useSelector((state) => state.targetSatTrack);
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
    const hasTargets = trackerInstances.length > 0;
    const celestialState = useSelector((state) => state.celestial || {});

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
    const {command: activeRotatorCommand, busy: isRotatorCommandBusy, isPending,
        connected: isSocketConnected, ready: hardwareReady, now, lastUpdateAge} = useHardwareCommand({
        socket, view: scopedTrackerView, commands: trackerCommandsById, trackerId: scopedTrackerId,
        scope: 'rotator', deviceId: effectiveSelectedRotator,
    });
    const isConnectActionPending = isPending(ROTATOR_STATES.CONNECTED);
    const isDisconnectActionPending = isPending(ROTATOR_STATES.DISCONNECTED);
    const isTrackActionPending = isPending(ROTATOR_STATES.TRACKING);
    const isStopActionPending = isPending(ROTATOR_STATES.STOPPED);
    const isParkActionPending = isPending(ROTATOR_STATES.PARKED);
    const motionUnconfirmed = Boolean(effectiveRotatorData?.motion_unconfirmed);
    const retryStop = activeRotatorCommand?.action === 'stop' && ['failed', 'unknown'].includes(activeRotatorCommand.status);
    const [openQuickEditDialog, setOpenQuickEditDialog] = React.useState(false);
    const [openManualControlDialog, setOpenManualControlDialog] = React.useState(false);
    const [rotatorErrorMessage, setRotatorErrorMessage] = React.useState('');
    const confirmedTrackingState = scopedTrackerView?.confirmedTrackingState || {};

    const showRotatorError = React.useCallback((error, fallbackMessage) => {
        const errorText = typeof error === 'string' ? error : error?.message || error?.error;
        const message = String(errorText || fallbackMessage).trim();
        setRotatorErrorMessage(message || fallbackMessage);
    }, []);

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
        if (motionUnconfirmed) return { label: t('rotator_control.motion_unconfirmed', { defaultValue: 'Motion unconfirmed' }), color: 'warning' };
        // Tracking stays active during a slew; show the current motion first.
        if (effectiveRotatorData?.slewing) return { label: 'Slewing', color: 'warning' };
        if (effectiveRotatorData?.tracking) return { label: 'Tracking', color: 'success' };
        if (effectiveRotatorData?.park_requested) return { label: t('rotator_control.park_command_sent', { defaultValue: 'Park command sent' }), color: 'warning' };
        if (effectiveRotatorData?.parked) return { label: 'Parked', color: 'warning' };
        if (effectiveRotatorData?.stopped) return { label: 'Stopped', color: 'warning' };
        return { label: 'Connected', color: 'success' };
    }, [isSocketConnected, motionUnconfirmed, effectiveRotatorData?.connected, effectiveRotatorData?.tracking, effectiveRotatorData?.slewing, effectiveRotatorData?.park_requested, effectiveRotatorData?.parked, effectiveRotatorData?.stopped, t]);
    const rotatorStatusLedColor = React.useMemo(() => {
        if (!isSocketConnected) return 'action.disabled';
        if (!effectiveRotatorData?.connected) return 'action.disabled';
        if (motionUnconfirmed) return 'warning.main';
        if (effectiveRotatorData?.slewing) return 'warning.main';
        if (effectiveRotatorData?.tracking) return 'success.main';
        if (effectiveRotatorData?.parked) return 'warning.main';
        if (effectiveRotatorData?.stopped) return 'info.main';
        return 'success.main';
    }, [isSocketConnected, motionUnconfirmed, effectiveRotatorData?.connected, effectiveRotatorData?.tracking, effectiveRotatorData?.slewing, effectiveRotatorData?.parked, effectiveRotatorData?.stopped]);

    const effectiveTargetPassKey = React.useMemo(
        () => buildTargetKeyFromTrackingState(effectiveTrackingState) || buildSatellitePassKey(effectiveSatelliteId),
        [effectiveSatelliteId, effectiveTrackingState]
    );
    const targetCurrentPosition = React.useMemo(() => ({
        az: finiteOrNull(effectiveSatelliteData?.position?.az),
        el: finiteOrNull(effectiveSatelliteData?.position?.el),
    }), [effectiveSatelliteData?.position?.az, effectiveSatelliteData?.position?.el]);
    const pointingError = React.useMemo(() => {
        const rotatorAz = finiteOrNull(effectiveRotatorData?.az);
        const rotatorEl = finiteOrNull(effectiveRotatorData?.el);
        if (targetCurrentPosition.az === null || targetCurrentPosition.el === null || rotatorAz === null || rotatorEl === null) {
            return null;
        }
        return {
            az: signedAzimuthDifference(targetCurrentPosition.az, rotatorAz),
            el: targetCurrentPosition.el - rotatorEl,
        };
    }, [effectiveRotatorData?.az, effectiveRotatorData?.el, targetCurrentPosition]);
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

    const connectDisabled = !hasTargets || !hardwareReady || isRotatorCommandBusy || !canConnectRotator(effectiveRotatorData, effectiveSelectedRotatorValue);
    const connectDisabledReason = !hasTargets
        ? 'No targets configured'
        : isRotatorCommandBusy
        ? 'Command in progress'
        : !canConnectRotator(effectiveRotatorData, effectiveSelectedRotatorValue)
            ? 'Select a rotator first'
            : null;

    const disconnectDisabled = !hasTargets || !hardwareReady || isRotatorCommandBusy || !effectiveRotatorData.connected;
    const disconnectDisabledReason = !hasTargets
        ? 'No targets configured'
        : isRotatorCommandBusy
        ? 'Command in progress'
        : [ROTATOR_STATES.DISCONNECTED].includes(effectiveTrackingState['rotator_state'])
            ? 'Rotator is already disconnected'
            : null;

    const parkDisabled = !hasTargets || !hardwareReady || isRotatorCommandBusy || motionUnconfirmed || !effectiveRotatorData.connected || effectiveRotatorData.parked;
    const parkDisabledReason = motionUnconfirmed ? 'Waiting for stationary position readings' : !hasTargets
        ? 'No targets configured'
        : isRotatorCommandBusy
        ? 'Command in progress'
        : [ROTATOR_STATES.DISCONNECTED].includes(effectiveTrackingState['rotator_state'])
            ? 'Connect the rotator first'
            : null;

    const trackDisabled = !hasTargets || !hardwareReady || motionUnconfirmed || !effectiveRotatorData.connected || isRotatorCommandBusy || !canStartTracking(confirmedTrackingState, effectiveSatelliteId, effectiveSelectedRotatorValue);
    const trackDisabledReason = motionUnconfirmed ? 'Waiting for stationary position readings' : !hasTargets
        ? 'No targets configured'
        : isRotatorCommandBusy
        ? 'Command in progress'
        : !canStartTracking(effectiveTrackingState, effectiveSatelliteId, effectiveSelectedRotatorValue)
            ? 'Select a target and rotator, then connect first'
            : null;

    const stopDisabled = !hasTargets || !isSocketConnected || isStopActionPending || (!isRotatorCommandBusy && (!effectiveRotatorData.connected || (!motionUnconfirmed && !retryStop && !effectiveRotatorData.tracking && !effectiveRotatorData.slewing && !effectiveRotatorData.park_requested)));
    const stopDisabledReason = !hasTargets
        ? 'No targets configured'
        : isRotatorCommandBusy
        ? 'Command in progress'
        : !canStopTracking(effectiveTrackingState, effectiveSatelliteId, effectiveSelectedRotatorValue)
            ? 'Rotator is not currently tracking'
            : null;

    const manualLimits = React.useMemo(() => {
        const minAz = finiteOrNull(effectiveRotatorData?.minaz) ?? finiteOrNull(selectedRotatorDevice?.minaz) ?? 0;
        const configuredMaxAz = finiteOrNull(effectiveRotatorData?.maxaz) ?? finiteOrNull(selectedRotatorDevice?.maxaz) ?? 360;
        return {
            minAz,
            // The extra 360–450° overlap lane is for automatic tracking only.
            maxAz: selectedRotatorDevice?.azimuth_mode === '0_450' ? Math.min(configuredMaxAz, 360) : configuredMaxAz,
            minEl: finiteOrNull(effectiveRotatorData?.minel) ?? finiteOrNull(selectedRotatorDevice?.minel) ?? 0,
            maxEl: finiteOrNull(effectiveRotatorData?.maxel) ?? finiteOrNull(selectedRotatorDevice?.maxel) ?? 90,
        };
    }, [effectiveRotatorData?.maxaz, effectiveRotatorData?.maxel, effectiveRotatorData?.minaz, effectiveRotatorData?.minel, selectedRotatorDevice]);
    const rotatorIsParked = effectiveTrackingState?.rotator_state === ROTATOR_STATES.PARKED
        || Boolean(effectiveRotatorData?.parked);
    const manualCurrentAz = React.useMemo(() => {
        const currentAz = finiteOrNull(effectiveRotatorData?.az);
        if (currentAz === null || selectedRotatorDevice?.azimuth_mode !== '0_450') return currentAz;
        // Show the physical bearing on the conventional manual 0–360° dial.
        return ((currentAz % 360) + 360) % 360;
    }, [effectiveRotatorData?.az, selectedRotatorDevice?.azimuth_mode]);
    const rotatorLiveStatus = React.useMemo(() => {
        if (!effectiveRotatorData?.connected) {
            return { value: 'Disconnected', bgColor: 'grey.600', fgColor: 'grey.800' };
        }
        if (effectiveRotatorData.error) {
            return { value: 'Error', bgColor: 'error.light', fgColor: 'error.dark' };
        }
        if (motionUnconfirmed) return {value: 'Motion unconfirmed', bgColor: 'warning.light', fgColor: 'warning.dark'};
        if (effectiveRotatorData.slewing) {
            return { value: 'Slewing', bgColor: 'warning.light', fgColor: 'warning.dark' };
        }
        if (effectiveTrackingState?.rotator_state === ROTATOR_STATES.TRACKING || effectiveRotatorData.tracking) {
            return { value: 'Tracking', bgColor: 'success.light', fgColor: 'success.dark' };
        }
        if (effectiveRotatorData.park_requested) return {value: 'Park command sent', bgColor: 'warning.light', fgColor: 'warning.dark'};
        if (effectiveRotatorData.parked) {
            return { value: 'Parked', bgColor: 'warning.light', fgColor: 'warning.dark' };
        }
        if (effectiveRotatorData.stopped) {
            return { value: 'Stopped', bgColor: 'info.light', fgColor: 'info.dark' };
        }
        return { value: 'Connected', bgColor: 'success.light', fgColor: 'success.dark' };
    }, [motionUnconfirmed, effectiveRotatorData?.connected, effectiveRotatorData?.error, effectiveRotatorData?.slewing, effectiveRotatorData?.stopped, effectiveRotatorData?.tracking, effectiveTrackingState?.rotator_state]);
    const manualControlDisabled = !hardwareReady || !canControlRotator(effectiveRotatorData, confirmedTrackingState) || rotatorIsParked;
    const manualControlDisabledReason = motionUnconfirmed ? 'Waiting for stationary position readings' : rotatorIsParked
        ? 'Unpark the rotator before using manual control'
        : 'Connect the rotator and stop automatic tracking first';

    const submitRotatorState = (rotatorState) => {
        const changes = {rotator_state: rotatorState};
        if (effectiveSelectedRotator !== effectiveTrackingState.rotator_id) changes.rotator_id = effectiveSelectedRotator;
        return dispatch(setTrackingStateInBackend({socket, data: {...effectiveTrackingState, tracker_id: scopedTrackerId}, changes}));
    };
    const handleTrackingStop = () => { void handleManualStop().catch(() => {}); };
    const handleTrackingStart = () => submitRotatorState(ROTATOR_STATES.TRACKING);
    const parkRotator = () => submitRotatorState(ROTATOR_STATES.PARKED);
    const connectRotator = () => submitRotatorState(ROTATOR_STATES.CONNECTED);
    const disconnectRotator = () => submitRotatorState(ROTATOR_STATES.DISCONNECTED);

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
                showRotatorError(
                    'Swap requires both targets to have rotators disconnected',
                    'Failed selecting rotator'
                );
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
                    showRotatorError(error, 'Failed swapping rotators');
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
        dispatch(setTrackingStateInBackend({socket, data: newTrackingState, changes: {rotator_id: newRotatorId}}))
            .unwrap()
            .catch((error) => {
                dispatch(setRotator({value: effectiveSelectedRotator, trackerId: scopedTrackerId}));
                showRotatorError(error, 'Failed selecting rotator');
            });
    }

    function handleManualMove(az, el) {
        return dispatch(moveRotatorToPosition({socket, trackerId: scopedTrackerId,
            rotatorId: effectiveSelectedRotator, az, el})).unwrap();
    }

    function handleManualStop() {
        return dispatch(stopRotator({socket, trackerId: scopedTrackerId,
            rotatorId: effectiveSelectedRotator})).unwrap();
    }

    return (
        <>
            <TitleBar className={getClassNamesBasedOnGridEditing(gridEditable, ["window-title-bar"])}>
                {t('rotator_control.title', { defaultValue: 'Rotator Control' })}
            </TitleBar>
            <Grid container spacing={{ xs: 0, md: 0 }} columns={{ xs: 12, sm: 12, md: 12 }}>
                <HardwareControlHeader device={selectedRotatorDevice} emptyLabel="No rotator selected"
                    connected={isSocketConnected} status={rotatorStatusChip.label} ledColor={rotatorStatusLedColor}
                    tone={motionUnconfirmed || effectiveRotatorData?.slewing ? 'warning' : effectiveRotatorData?.tracking ? 'success' : effectiveRotatorData?.parked ? 'warning' : effectiveRotatorData?.connected ? 'info' : null} command={activeRotatorCommand}
                    stale={!hardwareReady && hasTargets} lastUpdateAge={lastUpdateAge} />

                <Grid size={{ xs: 12, sm: 12, md: 12 }} style={{padding: '0.5rem 0.5rem 0rem 0.5rem'}}>
                    <Grid container direction="row" spacing={1} sx={{ alignItems: 'flex-end' }}>
                        <Grid size="grow">
                            <FormControl disabled={!hasTargets || isRotatorCommandBusy || isRotatorSelectionDisabled(confirmedTrackingState)}
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
                                                label={t('rotator_control.none', { defaultValue: 'None' })}
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
                                disabled={!hasTargets || isRotatorCommandBusy || !effectiveSelectedRotatorValue || effectiveSelectedRotatorValue === 'none'}
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
                        <Grid size="grow" style={{textAlign: 'center'}}>
                            <GaugeAz
                                size={150}
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
                                size={150}
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
                        mb: 1,
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
                        <Grid size="grow" style={{textAlign: 'center'}}>
                            <Paper
                                elevation={1}
                                sx={{
                                    height: '24px',
                                    padding: '2px 0px',
                                    marginBottom: '4px',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    borderRadius: '4px',
                                    minWidth: '180px',
                                    width: '100%',
                                    gap: 2,
                                }}
                            >
                                <Typography
                                    variant="caption"
                                    sx={{
                                        fontWeight: "bold",
                                    }}
                                >
                                    {t('rotator_control.target_offset', {defaultValue: 'Target offset'})}
                                </Typography>
                                {pointingError ? <>
                                    <Typography variant="body2" sx={{fontFamily: "Monospace, monospace"}}>
                                        {t('rotator_control.az', { defaultValue: 'ΔAZ' })} {formatPointingError(pointingError.az)}
                                    </Typography>
                                    <Typography variant="body2" sx={{fontFamily: "Monospace, monospace"}}>
                                        {t('rotator_control.el', { defaultValue: 'ΔEL' })} {formatPointingError(pointingError.el)}
                                    </Typography>
                                </> : <Typography variant="body2" sx={{fontFamily: "Monospace, monospace"}}>—</Typography>}
                            </Paper>
                            <Paper
                                elevation={1}
                                sx={{
                                    height: '30px',
                                    padding: '2px 0px',
                                    backgroundColor: rotatorLiveStatus.bgColor,
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
                                        color: rotatorLiveStatus.fgColor,
                                    }}
                                >
                                    {rotatorLiveStatus.value}
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
                                        loading={isConnectActionPending}
                                        disabled={connectDisabled}
                                        fullWidth={true}
                                        variant="contained"
                                        color="success"
                                        style={{height: '47px'}}
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
                                        loading={isDisconnectActionPending}
                                        disabled={disconnectDisabled}
                                        fullWidth={true}
                                        variant="contained"
                                        color="error"
                                        style={{height: '47px'}}
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
                                        style={{height: '47px'}}
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
                        <Grid size="grow" style={{paddingLeft: '0.5rem'}}>
                            <Tooltip title={manualControlDisabled ? manualControlDisabledReason : ''}>
                                <span style={{ display: 'block' }}>
                                    <Button
                                        disabled={manualControlDisabled}
                                        fullWidth={true}
                                        variant="outlined"
                                        style={{height: '60px'}}
                                        sx={{fontWeight: 700}}
                                        onClick={() => setOpenManualControlDialog(true)}
                                    >
                                        {t('rotator_control.manual_control')}
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
            <ManualRotatorDialog
                open={openManualControlDialog}
                onClose={() => setOpenManualControlDialog(false)}
                onMove={handleManualMove}
                onStop={handleManualStop}
                rotator={selectedRotatorDevice || null}
                rotatorStatus={rotatorLiveStatus}
                currentAz={manualCurrentAz}
                currentEl={effectiveRotatorData?.el}
                minAz={manualLimits.minAz}
                maxAz={manualLimits.maxAz}
                minEl={manualLimits.minEl}
                maxEl={manualLimits.maxEl}
                disabled={manualControlDisabled}
                command={activeRotatorCommand}
                canStop={!stopDisabled}
            />
            <ErrorDialog
                open={Boolean(rotatorErrorMessage)}
                message={rotatorErrorMessage}
                onClose={() => setRotatorErrorMessage('')}
            />
        </>
    );
});

export default RotatorControl;
