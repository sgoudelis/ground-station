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
import {useEffect} from "react";
import {
    fetchSatelliteGroups,
    fetchSatellitesByGroupId,
    setGroupOfSats,
    setRadioRig,
    setRotator,
    setRigVFO,
    setVFO1,
    setVFO2,
    setSatelliteGroupSelectOpen,
    setSatelliteId,
    setSatGroupId,
    setSelectedTransmitter,
    setStarting,
    setTrackingStateInBackend
} from "../target/target-slice.jsx";
import { toast } from "../../utils/toast-with-timestamp.jsx";
import { useTranslation } from 'react-i18next';
import {
    getClassNamesBasedOnGridEditing,
    getFrequencyBand,
    humanizeFrequency,
    preciseHumanizeFrequency,
    TitleBar
} from "../common/common.jsx";
import Grid from "@mui/material/Grid";
import {Box, Button, Chip, FormControl, IconButton, InputLabel, ListSubheader, MenuItem, Select, Tooltip} from "@mui/material";
import SwapVertIcon from '@mui/icons-material/SwapVert';
import Typography from "@mui/material/Typography";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutline";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutline";
import AutorenewIcon from '@mui/icons-material/Autorenew';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import {setCenterFrequency} from "../waterfall/waterfall-slice.jsx";
import LCDFrequencyDisplay from "../common/lcd-frequency-display.jsx";
import SettingsIcon from '@mui/icons-material/Settings';
import { RIG_STATES, TRACKER_COMMAND_SCOPES, TRACKER_COMMAND_STATUS } from '../target/tracking-constants.js';
import RigQuickEditDialog from "./rig-quick-edit-dialog.jsx";
import { resolveRigLedStatus, RIG_LED_STATUS } from "../common/hardware-status.js";


const RigControl = React.memo(function RigControl({ trackerId: trackerIdOverride = "" }) {
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
        selectedRigVFO,
        selectedVFO1,
        selectedVFO2,
        selectedTransmitter,
        availableTransmitters,
        rigData,
        gridEditable,
        trackerCommandsById,
        trackerViews,
        trackerId: activeTrackerId,
    } = useSelector((state) => state.targetSatTrack);
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
    const effectiveSelectedRigVFO = scopedTrackerView?.selectedRigVFO ?? selectedRigVFO;
    const effectiveSelectedVFO1 = scopedTrackerView?.selectedVFO1 ?? selectedVFO1;
    const effectiveSelectedVFO2 = scopedTrackerView?.selectedVFO2 ?? selectedVFO2;
    const effectiveSelectedTransmitter = scopedTrackerView?.selectedTransmitter ?? selectedTransmitter;
    const effectiveAvailableTransmitters = scopedTrackerView?.availableTransmitters ?? availableTransmitters;
    const effectiveRigData = scopedTrackerView?.rigData || rigData;
    const scopedRigCommand = (scopedTrackerId && trackerCommandsById?.[scopedTrackerId]) || null;
    const isRigCommandBusy = Boolean(
        scopedRigCommand &&
        [TRACKER_COMMAND_SCOPES.RIG, TRACKER_COMMAND_SCOPES.TRACKING].includes(scopedRigCommand.scope) &&
        scopedRigCommand?.requestedState?.rigState &&
        [TRACKER_COMMAND_STATUS.SUBMITTED, TRACKER_COMMAND_STATUS.STARTED].includes(scopedRigCommand.status)
    );
    const inFlightRigState = scopedRigCommand?.requestedState?.rigState;
    const isConnectRigActionPending = isRigCommandBusy && inFlightRigState === RIG_STATES.CONNECTED;
    const isDisconnectRigActionPending = isRigCommandBusy && inFlightRigState === RIG_STATES.DISCONNECTED;
    const isTrackRigActionPending = isRigCommandBusy && inFlightRigState === RIG_STATES.TRACKING;
    const isStopRigActionPending = isRigCommandBusy && inFlightRigState === RIG_STATES.STOPPED;

    // Safeguard: Reset VFO if hardware rig is selected with VFO 3 or 4
    React.useEffect(() => {
        const rigType = determineRadioType(effectiveSelectedRadioRig);
        if (rigType === "rig" && (effectiveSelectedRigVFO === "3" || effectiveSelectedRigVFO === "4")) {
            dispatch(setRigVFO({ value: "none", trackerId: scopedTrackerId }));
        }
    }, [effectiveSelectedRadioRig, effectiveSelectedRigVFO, dispatch, scopedTrackerId]);

    const {
        sdrs
    } = useSelector((state) => state.sdrs);

    const {
        rigs
    } = useSelector((state) => state.rigs);
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
    const hasTargets = trackerInstances.length > 0;
    const [isSocketConnected, setIsSocketConnected] = React.useState(Boolean(socket?.connected));
    const [lastRigUpdateAt, setLastRigUpdateAt] = React.useState(Date.now());
    const [now, setNow] = React.useState(Date.now());
    const [openQuickEditDialog, setOpenQuickEditDialog] = React.useState(false);

    const activeRigCommand = React.useMemo(() => {
        if (!scopedRigCommand) return null;
        const supportsScope = [TRACKER_COMMAND_SCOPES.RIG, TRACKER_COMMAND_SCOPES.TRACKING].includes(scopedRigCommand.scope);
        return supportsScope && scopedRigCommand?.requestedState?.rigState ? scopedRigCommand : null;
    }, [scopedRigCommand]);

    useEffect(() => {
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

    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    useEffect(() => {
        setLastRigUpdateAt(Date.now());
    }, [
        effectiveRigData?.connected,
        effectiveRigData?.tracking,
        effectiveRigData?.stopped,
        effectiveRigData?.vfo1?.frequency,
        effectiveRigData?.vfo2?.frequency,
        effectiveRigData?.doppler_shift,
    ]);

    const effectiveSelectedRadioRigValue = hasTargets ? effectiveSelectedRadioRig : "none";
    const effectiveSelectedTransmitterValue = hasTargets ? effectiveSelectedTransmitter : "none";
    const effectiveSelectedVFO1Value = hasTargets ? (effectiveSelectedVFO1 || "uplink") : "none";
    const effectiveSelectedVFO2Value = hasTargets ? (effectiveSelectedVFO2 || "downlink") : "none";
    const selectedRigDevice = React.useMemo(
        () => rigs.find((rig) => rig.id === effectiveSelectedRadioRigValue),
        [rigs, effectiveSelectedRadioRigValue]
    );

    const rigUsageById = React.useMemo(() => {
        const usage = {};
        trackerInstances.forEach((instance, index) => {
            const trackerId = String(instance?.tracker_id || '');
            if (!trackerId) return;
            const targetNumber = Number(instance?.target_number || (index + 1));
            const rigId = String(instance?.rig_id || instance?.tracking_state?.rig_id || 'none');
            if (!rigId || rigId === 'none') return;
            if (!usage[rigId]) usage[rigId] = [];
            usage[rigId].push({
                trackerId,
                targetNumber,
                noradId: instance?.tracking_state?.norad_id ?? null,
            });
        });
        return usage;
    }, [trackerInstances]);

    const resolvedRigLedStatus = React.useMemo(() => {
        return resolveRigLedStatus({
            rigId: effectiveSelectedRadioRigValue,
            rigData: effectiveRigData,
            trackingState: effectiveTrackingState,
        });
    }, [effectiveSelectedRadioRigValue, effectiveRigData, effectiveTrackingState]);

    const rigStatusChip = React.useMemo(() => {
        if (!isSocketConnected) {
            return { label: t('common.disconnected', { ns: 'common', defaultValue: 'Disconnected' }), color: 'default' };
        }
        switch (resolvedRigLedStatus) {
            case RIG_LED_STATUS.TRACKING:
                return { label: 'Tracking', color: 'success' };
            case RIG_LED_STATUS.STOPPED:
                return { label: 'Stopped', color: 'info' };
            case RIG_LED_STATUS.CONNECTED:
                return { label: t('rig_control.connected', { defaultValue: 'Connected' }), color: 'success' };
            case RIG_LED_STATUS.NONE:
            case RIG_LED_STATUS.DISCONNECTED:
            case RIG_LED_STATUS.UNKNOWN:
            default:
                return { label: t('common.disconnected', { ns: 'common', defaultValue: 'Disconnected' }), color: 'default' };
        }
    }, [isSocketConnected, resolvedRigLedStatus, t]);
    const rigStatusLedColor = React.useMemo(() => {
        if (!isSocketConnected) return 'action.disabled';
        switch (resolvedRigLedStatus) {
            case RIG_LED_STATUS.TRACKING:
                return 'success.main';
            case RIG_LED_STATUS.STOPPED:
                return 'info.main';
            case RIG_LED_STATUS.CONNECTED:
                return 'success.main';
            case RIG_LED_STATUS.NONE:
            case RIG_LED_STATUS.DISCONNECTED:
            case RIG_LED_STATUS.UNKNOWN:
            default:
                return 'action.disabled';
        }
    }, [isSocketConnected, resolvedRigLedStatus]);

    const commandStateLabel = React.useMemo(() => {
        if (!activeRigCommand) return t('common.not_available', { ns: 'common', defaultValue: 'N/A' });
        if (activeRigCommand.status === TRACKER_COMMAND_STATUS.SUBMITTED) return t('common.pending', { ns: 'common', defaultValue: 'Pending' });
        if (activeRigCommand.status === TRACKER_COMMAND_STATUS.STARTED) return t('common.in_progress', { ns: 'common', defaultValue: 'In progress' });
        if (activeRigCommand.status === TRACKER_COMMAND_STATUS.SUCCEEDED) return t('common.success', { ns: 'common', defaultValue: 'Success' });
        if (activeRigCommand.status === TRACKER_COMMAND_STATUS.FAILED) return t('common.failed', { ns: 'common', defaultValue: 'Failed' });
        return t('common.unknown', { ns: 'common', defaultValue: 'Unknown' });
    }, [activeRigCommand, t]);

    const commandStatusIcon = React.useMemo(() => {
        if (!activeRigCommand) return { Icon: MoreHorizIcon, color: 'text.disabled' };
        if (activeRigCommand.status === TRACKER_COMMAND_STATUS.SUCCEEDED) {
            return { Icon: CheckCircleOutlineIcon, color: 'success.main' };
        }
        if (activeRigCommand.status === TRACKER_COMMAND_STATUS.FAILED) {
            return { Icon: ErrorOutlineIcon, color: 'error.main' };
        }
        if ([TRACKER_COMMAND_STATUS.SUBMITTED, TRACKER_COMMAND_STATUS.STARTED].includes(activeRigCommand.status)) {
            return { Icon: AutorenewIcon, color: 'info.main' };
        }
        return { Icon: MoreHorizIcon, color: 'text.disabled' };
    }, [activeRigCommand]);

    const lastUpdateAge = Math.max(0, Math.floor((now - lastRigUpdateAt) / 1000));

    const resolvedTargetType = React.useMemo(() => {
        const explicitTargetType = String(effectiveTrackingState?.target_type || '').trim().toLowerCase();
        if (explicitTargetType === 'satellite' || explicitTargetType === 'mission' || explicitTargetType === 'body') {
            return explicitTargetType;
        }
        if (String(effectiveTrackingState?.mission_id || '').trim() || String(effectiveTrackingState?.command || '').trim()) {
            return 'mission';
        }
        if (String(effectiveTrackingState?.body_id || '').trim()) {
            return 'body';
        }
        return 'satellite';
    }, [effectiveTrackingState]);

    const hasSelectedTarget = React.useMemo(() => {
        if (resolvedTargetType === 'mission') {
            return Boolean(
                String(effectiveTrackingState?.mission_id || '').trim()
                || String(effectiveTrackingState?.command || '').trim()
            );
        }
        if (resolvedTargetType === 'body') {
            return Boolean(String(effectiveTrackingState?.body_id || '').trim());
        }
        const noradCandidate = effectiveTrackingState?.norad_id ?? effectiveSatelliteId;
        const parsedNorad = Number(noradCandidate);
        return Number.isFinite(parsedNorad) && parsedNorad > 0;
    }, [effectiveTrackingState, effectiveSatelliteId, resolvedTargetType]);

    const buildTrackingPayload = React.useCallback((overrides = {}) => {
        const base = {
            ...effectiveTrackingState,
            tracker_id: scopedTrackerId,
            target_type: resolvedTargetType,
            norad_id: resolvedTargetType === 'satellite' ? effectiveSatelliteId : null,
            group_id: resolvedTargetType === 'satellite' ? effectiveGroupId : null,
            mission_id: resolvedTargetType === 'mission'
                ? (effectiveTrackingState?.mission_id ?? null)
                : null,
            command: resolvedTargetType === 'mission'
                ? (effectiveTrackingState?.command ?? null)
                : null,
            body_id: resolvedTargetType === 'body'
                ? (effectiveTrackingState?.body_id ?? null)
                : null,
        };
        return {
            ...base,
            ...overrides,
        };
    }, [
        effectiveGroupId,
        effectiveSatelliteId,
        effectiveTrackingState,
        resolvedTargetType,
        scopedTrackerId,
    ]);

    const connectRigDisabled =
        !hasTargets ||
        isRigCommandBusy ||
        [RIG_STATES.TRACKING, RIG_STATES.CONNECTED, RIG_STATES.STOPPED].includes(effectiveTrackingState['rig_state']) ||
        ["none", ""].includes(effectiveSelectedRadioRigValue);
    const connectRigDisabledReason = !hasTargets
        ? 'No targets configured'
        : isRigCommandBusy
        ? 'Command in progress'
        : [RIG_STATES.TRACKING, RIG_STATES.CONNECTED, RIG_STATES.STOPPED].includes(effectiveTrackingState['rig_state'])
            ? 'Rig is already connected or tracking'
            : ["none", ""].includes(effectiveSelectedRadioRigValue)
                ? 'Select a rig first'
                : null;

    const disconnectRigDisabled = !hasTargets || isRigCommandBusy || [RIG_STATES.DISCONNECTED].includes(effectiveTrackingState['rig_state']);
    const disconnectRigDisabledReason = !hasTargets
        ? 'No targets configured'
        : isRigCommandBusy
        ? 'Command in progress'
        : [RIG_STATES.DISCONNECTED].includes(effectiveTrackingState['rig_state'])
            ? 'Rig is already disconnected'
            : null;

    const trackRigDisabled =
        !hasTargets ||
        isRigCommandBusy ||
        effectiveTrackingState['rig_state'] === RIG_STATES.TRACKING ||
        effectiveTrackingState['rig_state'] === RIG_STATES.DISCONNECTED ||
        !hasSelectedTarget ||
        ["none", ""].includes(effectiveSelectedRadioRigValue) ||
        ["none", ""].includes(effectiveSelectedTransmitterValue);
    const trackRigDisabledReason = !hasTargets
        ? 'No targets configured'
        : isRigCommandBusy
        ? 'Command in progress'
        : effectiveTrackingState['rig_state'] === RIG_STATES.TRACKING
            ? 'Rig is already tracking'
            : effectiveTrackingState['rig_state'] === RIG_STATES.DISCONNECTED
                ? 'Connect the rig first'
                : !hasSelectedTarget
                    ? 'Select a target first'
                    : ["none", ""].includes(effectiveSelectedRadioRigValue)
                        ? 'Select a rig first'
                        : ["none", ""].includes(effectiveSelectedTransmitterValue)
                            ? 'Select a transmitter first'
                            : null;

    const stopRigDisabled =
        !hasTargets ||
        isRigCommandBusy ||
        [RIG_STATES.STOPPED, RIG_STATES.DISCONNECTED, RIG_STATES.CONNECTED].includes(effectiveTrackingState['rig_state']) ||
        !hasSelectedTarget ||
        ["none", ""].includes(effectiveSelectedRadioRigValue);
    const stopRigDisabledReason = !hasTargets
        ? 'No targets configured'
        : isRigCommandBusy
        ? 'Command in progress'
        : [RIG_STATES.STOPPED, RIG_STATES.DISCONNECTED, RIG_STATES.CONNECTED].includes(effectiveTrackingState['rig_state'])
            ? 'Rig is not currently tracking'
            : !hasSelectedTarget
                ? 'Select a target first'
                : ["none", ""].includes(effectiveSelectedRadioRigValue)
                    ? 'Select a rig first'
                    : null;

    const groupedTransmitters = React.useMemo(() => {
        const groups = {};

        effectiveAvailableTransmitters.forEach((tx) => {
            const referenceFrequency = tx.downlink_observed_freq || tx.downlink_low;
            const band = getFrequencyBand(referenceFrequency);
            if (!groups[band]) {
                groups[band] = [];
            }
            groups[band].push(tx);
        });

        const bandOrder = ['VHF', 'UHF', 'L-band', 'S-band', 'C-band', 'X-band', 'Ku-band', 'K-band', 'Ka-band'];
        const sortedBands = Object.keys(groups).sort((a, b) => {
            const aIndex = bandOrder.indexOf(a);
            const bIndex = bandOrder.indexOf(b);
            if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
            if (aIndex !== -1) return -1;
            if (bIndex !== -1) return 1;
            return a.localeCompare(b);
        });

        return sortedBands.map((band) => ({ band, transmitters: groups[band] }));
    }, [effectiveAvailableTransmitters]);

    const handleTrackingStop = () => {
        dispatch(
            setTrackingStateInBackend({
                socket,
                data: buildTrackingPayload({
                    rig_state: RIG_STATES.STOPPED,
                    vfo1: effectiveSelectedVFO1,
                    vfo2: effectiveSelectedVFO2,
                }),
            })
        );
    };

    function getConnectionStatusofRig() {
        if (effectiveRigData['connected'] === true) {
            return t('rig_control.connected');
        } else  if (effectiveRigData['connected'] === false) {
            return t('common.disconnected', { ns: 'common', defaultValue: 'Disconnected' });
        } else {
            return t('rig_control.unknown');
        }
    }

    const handleTrackingStart = () => {
        const newTrackingState = buildTrackingPayload({
            rotator_state: effectiveTrackingState['rotator_state'],
            rig_state: RIG_STATES.TRACKING,
            rig_id: effectiveSelectedRadioRig,
            rotator_id: effectiveSelectedRotator,
            transmitter_id: effectiveSelectedTransmitter,
            rig_vfo: effectiveSelectedRigVFO,
            vfo1: effectiveSelectedVFO1,
            vfo2: effectiveSelectedVFO2,
        });

        dispatch(setTrackingStateInBackend({socket, data: newTrackingState}))
            .unwrap()
            .then((response) => {

            })
            .catch((error) => {
                toast.error(`${t('rig_control.failed_start_tracking')}: ${error.message}`);
            });
    };

    function determineRadioType(selectedRadioRigOrSDR) {
        let selectedType = "unknown";

        // Check if it's a rig
        const selectedRig = rigs.find(rig => rig.id === selectedRadioRigOrSDR);
        if (selectedRig) {
            selectedType = "rig";
        }

        // Check if it's an SDR
        const selectedSDR = sdrs.find(sdr => sdr.id === selectedRadioRigOrSDR);
        if (selectedSDR) {
            selectedType = "sdr";
        }

        return selectedType;
    }

    function handleRigChange(event) {
        // Find the selected MenuItem to get its type
        const selectedValue = event.target.value;
        const selectedType = determineRadioType(selectedValue);

        // Set the selected radio rig
        dispatch(setRadioRig({ value: selectedValue, trackerId: scopedTrackerId }));

        // Reset VFO selection when changing rigs
        dispatch(setRigVFO({ value: "none", trackerId: scopedTrackerId }));
    }

    function handleTransmitterChange(event) {
        const transmitterId = event.target.value;
        dispatch(setSelectedTransmitter({ value: transmitterId, trackerId: scopedTrackerId }));

        const data = buildTrackingPayload({
            rotator_state: effectiveTrackingState['rotator_state'],
            rig_state: effectiveTrackingState['rig_state'],
            rig_id: effectiveSelectedRadioRig,
            rotator_id: effectiveSelectedRotator,
            transmitter_id: event.target.value,
            rig_vfo: effectiveSelectedRigVFO,
            vfo1: effectiveSelectedVFO1,
            vfo2: effectiveSelectedVFO2,
        });

        dispatch(setTrackingStateInBackend({ socket: socket, data: data}))
            .unwrap()
            .then((response) => {

            })
            .catch((error) => {

            });
    }

    function handleRigVFOChange(event) {
        const vfoValue = event.target.value;
        dispatch(setRigVFO({ value: vfoValue, trackerId: scopedTrackerId }));

        const data = buildTrackingPayload({
            rotator_state: effectiveTrackingState['rotator_state'],
            rig_state: effectiveTrackingState['rig_state'],
            rig_id: effectiveSelectedRadioRig,
            rotator_id: effectiveSelectedRotator,
            transmitter_id: effectiveSelectedTransmitter,
            rig_vfo: event.target.value,
            vfo1: effectiveSelectedVFO1,
            vfo2: effectiveSelectedVFO2,
        });

        dispatch(setTrackingStateInBackend({ socket: socket, data: data}))
            .unwrap()
            .then((response) => {

            })
            .catch((error) => {

            });
    }

    function handleVFO1Change(event) {
        const vfo1Value = event.target.value;
        dispatch(setVFO1({ value: vfo1Value, trackerId: scopedTrackerId }));

        const data = buildTrackingPayload({
            rotator_state: effectiveTrackingState['rotator_state'],
            rig_state: effectiveTrackingState['rig_state'],
            rig_id: effectiveSelectedRadioRig,
            rotator_id: effectiveSelectedRotator,
            transmitter_id: effectiveSelectedTransmitter,
            rig_vfo: effectiveSelectedRigVFO,
            vfo1: vfo1Value,
            vfo2: effectiveSelectedVFO2,
        });

        dispatch(setTrackingStateInBackend({ socket: socket, data: data}))
            .unwrap()
            .then((response) => {

            })
            .catch((error) => {

            });
    }

    function handleVFO2Change(event) {
        const vfo2Value = event.target.value;
        dispatch(setVFO2({ value: vfo2Value, trackerId: scopedTrackerId }));

        const data = buildTrackingPayload({
            rotator_state: effectiveTrackingState['rotator_state'],
            rig_state: effectiveTrackingState['rig_state'],
            rig_id: effectiveSelectedRadioRig,
            rotator_id: effectiveSelectedRotator,
            transmitter_id: effectiveSelectedTransmitter,
            rig_vfo: effectiveSelectedRigVFO,
            vfo1: effectiveSelectedVFO1,
            vfo2: vfo2Value,
        });

        dispatch(setTrackingStateInBackend({ socket: socket, data: data}))
            .unwrap()
            .then((response) => {

            })
            .catch((error) => {

            });
    }

    function handleVFOSwap() {
        // Swap VFO1 and VFO2 values
        const tempVFO1 = effectiveSelectedVFO1;
        const tempVFO2 = effectiveSelectedVFO2;

        dispatch(setVFO1({ value: tempVFO2, trackerId: scopedTrackerId }));
        dispatch(setVFO2({ value: tempVFO1, trackerId: scopedTrackerId }));

        const data = buildTrackingPayload({
            rotator_state: effectiveTrackingState['rotator_state'],
            rig_state: effectiveTrackingState['rig_state'],
            rig_id: effectiveSelectedRadioRig,
            rotator_id: effectiveSelectedRotator,
            transmitter_id: effectiveSelectedTransmitter,
            rig_vfo: effectiveSelectedRigVFO,
            vfo1: tempVFO2,
            vfo2: tempVFO1,
        });

        dispatch(setTrackingStateInBackend({ socket: socket, data: data}))
            .unwrap()
            .then((response) => {

            })
            .catch((error) => {

            });
    }

    function connectRig() {
        const data = buildTrackingPayload({
            rig_state: RIG_STATES.CONNECTED,
            rig_id: effectiveSelectedRadioRig,
            rig_vfo: effectiveSelectedRigVFO,
            vfo1: effectiveSelectedVFO1,
            vfo2: effectiveSelectedVFO2,
        });
        dispatch(setTrackingStateInBackend({ socket, data: data}));
    }

    function disconnectRig() {
        const data = buildTrackingPayload({
            rig_state: RIG_STATES.DISCONNECTED,
            rig_id: effectiveSelectedRadioRig,
            rig_vfo: effectiveSelectedRigVFO,
            vfo1: effectiveSelectedVFO1,
            vfo2: effectiveSelectedVFO2,
        });
        dispatch(setTrackingStateInBackend({ socket, data: data}));
    }

    return (
        <>
            <TitleBar className={getClassNamesBasedOnGridEditing(gridEditable, ["window-title-bar"])}>
                {t('rig_control.title', { defaultValue: 'Radio Rig Control' })}
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
                            if (resolvedRigLedStatus === RIG_LED_STATUS.TRACKING) {
                                return (theme) => `linear-gradient(135deg, ${theme.palette.success.main}26 0%, ${theme.palette.success.main}0D 100%)`;
                            }
                            if (resolvedRigLedStatus === RIG_LED_STATUS.STOPPED) {
                                return (theme) => `linear-gradient(135deg, ${theme.palette.info.main}26 0%, ${theme.palette.info.main}0D 100%)`;
                            }
                            if (resolvedRigLedStatus === RIG_LED_STATUS.CONNECTED) {
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
                            `${selectedRigDevice ? `${selectedRigDevice.name} (${selectedRigDevice.host}:${selectedRigDevice.port})` : 'No rig selected'} | ` +
                            `Socket ${isSocketConnected ? 'Online' : 'Offline'} | ` +
                            `Updated ${lastUpdateAge}s | ` +
                            `Cmd ${commandStateLabel}` +
                            (activeRigCommand?.status === TRACKER_COMMAND_STATUS.FAILED && activeRigCommand?.reason ? ` | ${activeRigCommand.reason}` : '')
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
                                        bgcolor: rigStatusLedColor,
                                    }}
                                />
                                <Box sx={{ minWidth: 0 }}>
                                    <Typography variant="caption" noWrap sx={{ display: 'block', fontWeight: 800, fontSize: '0.72rem', lineHeight: 1.1 }}>
                                        {selectedRigDevice ? selectedRigDevice.name : 'No rig selected'}
                                    </Typography>
                                    <Typography variant="caption" noWrap sx={{ display: 'block', color: 'text.secondary', fontSize: '0.62rem', lineHeight: 1.1 }}>
                                        {rigStatusChip.label}
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

                {/* 1. Rig Selection */}
                <Grid size={{ xs: 12, sm: 12, md: 12 }} style={{padding: '0.5rem 0.5rem 0rem 0.5rem'}}>
                    <Grid container direction="row" spacing={1} sx={{ alignItems: 'flex-end' }}>
                        <Grid size="grow">
                            <FormControl disabled={!hasTargets || effectiveRigData['connected'] === true}
                                         sx={{minWidth: 200, marginTop: 0, marginBottom: 1}} fullWidth variant="outlined" size="small">
                                <InputLabel htmlFor="radiorig-select">{t('rig_control_labels.rig_label')}</InputLabel>
                                <Select
                                    id="radiorig-select"
                                    value={hasTargets && rigs.some((rig) => String(rig.id) === String(effectiveSelectedRadioRigValue)) ? effectiveSelectedRadioRigValue : "none"}
                                    onChange={(event) => {
                                        handleRigChange(event);
                                    }}
                                    renderValue={(selected) => {
                                        if (String(selected) === 'none') {
                                            return t('rig_control_labels.no_rig_control');
                                        }
                                        const selectedRig = rigs.find((rig) => String(rig.id) === String(selected));
                                        if (!selectedRig) {
                                            return t('rig_control_labels.no_rig_control');
                                        }
                                        return (
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                                                <Typography variant="body2" noWrap sx={{ fontWeight: 600, minWidth: 0 }}>
                                                    {selectedRig.name}
                                                </Typography>
                                                {(() => {
                                                    const usageRows = rigUsageById[String(selectedRig.id)] || [];
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
                                                    label={`${selectedRig.host}:${selectedRig.port}`}
                                                    variant="outlined"
                                                    sx={{ height: 18, fontSize: '0.62rem', fontFamily: 'monospace', flexShrink: 0 }}
                                                />
                                            </Box>
                                        );
                                    }}
                                    size="small"
                                    label={t('rig_control_labels.rig_label')}>
                                    <MenuItem value="none">
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                                                {t('rig_control_labels.no_rig_control')}
                                            </Typography>
                                            <Chip
                                                label="None"
                                                size="small"
                                                variant="outlined"
                                                sx={{ ml: 'auto', height: 18, fontSize: '0.62rem' }}
                                            />
                                        </Box>
                                    </MenuItem>
                                    {rigs.map((rig, index) => {
                                        const usageRows = rigUsageById[String(rig.id)] || [];
                                        const inUseByOthers = usageRows.filter((row) => row.trackerId !== scopedTrackerId);
                                        const inUseLabel = inUseByOthers.length > 0
                                            ? `In use ${inUseByOthers.slice(0, 2).map((row) => `T${row.targetNumber}`).join(',')}`
                                            : null;
                                        return (
                                            <MenuItem type={"rig"} value={rig.id} key={index} sx={{ py: 0.75 }}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                                    <Typography variant="body2" noWrap sx={{ fontWeight: 600, minWidth: 0, flex: 1 }}>
                                                        {rig.name}
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
                                                        label={`${rig.host}:${rig.port}`}
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
                                disabled={!hasTargets || !effectiveSelectedRadioRigValue || effectiveSelectedRadioRigValue === 'none'}
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

                {/* 2. Transmitter Selection */}
                <Grid size={{xs: 12, sm: 12, md: 12}} style={{padding: '0rem 0.5rem 0rem 0.5rem'}}>
                    <FormControl disabled={!hasTargets || effectiveRigData['tracking'] === true}
                                 sx={{minWidth: 200, marginTop: 0, marginBottom: 1}} fullWidth variant="outlined" size="small">
                        <InputLabel htmlFor="transmitter-select">{t('rig_control_labels.transmitter_label')}</InputLabel>
                        <Select
                            id="transmitter-select"
                            value={hasTargets && effectiveAvailableTransmitters.length > 0 && effectiveAvailableTransmitters.some(t => t.id === effectiveSelectedTransmitterValue) ? effectiveSelectedTransmitterValue : "none"}
                            onChange={(event) => {
                                handleTransmitterChange(event);
                            }}
                            size="small"
                            label={t('rig_control_labels.transmitter_label')}>
                            <MenuItem value="none">
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                    <Typography variant="body2" sx={{ minWidth: 0, flex: 1 }}>
                                        {t('rig_control_labels.no_frequency_control')}
                                    </Typography>
                                    <Chip
                                        size="small"
                                        label="manual"
                                        variant="outlined"
                                        sx={{ height: 18, fontSize: '0.62rem', flexShrink: 0 }}
                                    />
                                </Box>
                            </MenuItem>
                            {effectiveAvailableTransmitters.length === 0 && (
                                <MenuItem value="" disabled>
                                    <em>{t('rig_control_labels.no_transmitters')}</em>
                                </MenuItem>
                            )}
                            {groupedTransmitters.map(({ band, transmitters }) => [
                                <ListSubheader
                                    key={`header-${band}`}
                                    sx={{ fontSize: '0.75rem', fontWeight: 'bold', lineHeight: '32px' }}
                                >
                                    {band}
                                </ListSubheader>,
                                ...transmitters.map((transmitter) => (
                                    <MenuItem value={transmitter.id} key={transmitter.id} sx={{ pl: 3 }}>
                                        <Box sx={{display: 'flex', alignItems: 'center', gap: 1}}>
                                            <Box
                                                sx={{
                                                    width: 8,
                                                    height: 8,
                                                    borderRadius: '50%',
                                                    backgroundColor: transmitter.alive ? 'success.main' : 'error.main',
                                                    boxShadow: (theme) => transmitter.alive
                                                        ? `0 0 6px ${theme.palette.success.main}99`
                                                        : `0 0 6px ${theme.palette.error.main}99`,
                                                }}
                                            />
                                            <Typography variant="body2" noWrap sx={{ minWidth: 0, flex: 1 }}>
                                                {transmitter['description']} ({humanizeFrequency(transmitter['downlink_low'])})
                                            </Typography>
                                            <Chip
                                                size="small"
                                                label={transmitter.source || 'unknown'}
                                                variant="outlined"
                                                sx={{ height: 18, fontSize: '0.62rem', flexShrink: 0 }}
                                            />
                                        </Box>
                                    </MenuItem>
                                ))
                            ])}
                        </Select>
                    </FormControl>
                </Grid>

                {/* 3 & 4. VFO Selection with Swap Button */}
                <Grid size={{ xs: 12, sm: 12, md: 12 }} style={{padding: '0rem 0.5rem 0rem 0.5rem'}}>
                    <Box sx={{ display: 'flex', gap: 1, alignItems: 'stretch' }}>
                        {/* VFO dropdowns container */}
                        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
                            {/* VFO 1 */}
                            <FormControl disabled={!hasTargets || effectiveRigData['tracking'] === true}
                                         sx={{marginTop: 0, marginBottom: 0}} fullWidth variant="outlined" size="small">
                                <InputLabel htmlFor="vfo1-select">VFO 1</InputLabel>
                                <Select
                                    id="vfo1-select"
                                    value={effectiveSelectedTransmitterValue === "none" ? "none" : effectiveSelectedVFO1Value}
                                    onChange={(event) => {
                                        handleVFO1Change(event);
                                    }}
                                    size="small"
                                    label="VFO 1">
                                    <MenuItem value="none">[none]</MenuItem>
                                    <MenuItem value="uplink">
                                        {effectiveSelectedTransmitter && effectiveSelectedTransmitter !== "none" && effectiveRigData?.transmitters?.length > 0 ? (
                                            (() => {
                                                const transmitter = effectiveRigData.transmitters.find(t => t.id === effectiveSelectedTransmitter);
                                                return transmitter ? (
                                                    <>Uplink: {preciseHumanizeFrequency(transmitter.uplink_observed_freq || 0)}</>
                                                ) : "Uplink";
                                            })()
                                        ) : "Uplink"}
                                    </MenuItem>
                                    <MenuItem value="downlink">
                                        {effectiveSelectedTransmitter && effectiveSelectedTransmitter !== "none" && effectiveRigData?.transmitters?.length > 0 ? (
                                            (() => {
                                                const transmitter = effectiveRigData.transmitters.find(t => t.id === effectiveSelectedTransmitter);
                                                return transmitter ? (
                                                    <>Downlink: {preciseHumanizeFrequency(transmitter.downlink_observed_freq || 0)}</>
                                                ) : "Downlink";
                                            })()
                                        ) : "Downlink"}
                                    </MenuItem>
                                </Select>
                            </FormControl>

                            {/* VFO 2 */}
                            <FormControl disabled={!hasTargets || effectiveRigData['tracking'] === true}
                                         sx={{marginTop: 0, marginBottom: 1}} fullWidth variant="outlined" size="small">
                                <InputLabel htmlFor="vfo2-select">VFO 2</InputLabel>
                                <Select
                                    id="vfo2-select"
                                    value={effectiveSelectedTransmitterValue === "none" ? "none" : effectiveSelectedVFO2Value}
                                    onChange={(event) => {
                                        handleVFO2Change(event);
                                    }}
                                    size="small"
                                    label="VFO 2">
                                    <MenuItem value="none">[none]</MenuItem>
                                    <MenuItem value="downlink">
                                        {effectiveSelectedTransmitter && effectiveSelectedTransmitter !== "none" && effectiveRigData?.transmitters?.length > 0 ? (
                                            (() => {
                                                const transmitter = effectiveRigData.transmitters.find(t => t.id === effectiveSelectedTransmitter);
                                                return transmitter ? (
                                                    <>Downlink: {preciseHumanizeFrequency(transmitter.downlink_observed_freq || 0)}</>
                                                ) : "Downlink";
                                            })()
                                        ) : "Downlink"}
                                    </MenuItem>
                                    <MenuItem value="uplink">
                                        {effectiveSelectedTransmitter && effectiveSelectedTransmitter !== "none" && effectiveRigData?.transmitters?.length > 0 ? (
                                            (() => {
                                                const transmitter = effectiveRigData.transmitters.find(t => t.id === effectiveSelectedTransmitter);
                                                return transmitter ? (
                                                    <>Uplink: {preciseHumanizeFrequency(transmitter.uplink_observed_freq || 0)}</>
                                                ) : "Uplink";
                                            })()
                                        ) : "Uplink"}
                                    </MenuItem>
                                </Select>
                            </FormControl>
                        </Box>

                        {/* Swap button - takes remaining space vertically */}
                        <Box sx={{ display: 'flex', alignItems: 'stretch', flexShrink: 0 }}>
                            <IconButton
                                onClick={handleVFOSwap}
                                disabled={!hasTargets || effectiveRigData['tracking'] === true}
                                sx={{
                                    height: 'calc(100% - 5px)',
                                    borderRadius: 1,
                                    px: 1,
                                    bgcolor: 'primary.main',
                                    color: 'primary.contrastText',
                                    '&:hover': {
                                        bgcolor: 'primary.dark',
                                    },
                                    '&:disabled': {
                                        bgcolor: 'action.disabledBackground',
                                        color: 'action.disabled',
                                    }
                                }}
                                title="Swap VFO 1 and VFO 2">
                                <SwapVertIcon />
                            </IconButton>
                        </Box>
                    </Box>
                </Grid>


                <Grid size={{xs: 12, sm: 12, md: 12}} sx={{pt: 0.5}}>
                    <Grid size={{xs: 12, sm: 12, md: 12}} style={{padding: '0rem 0.5rem 0rem 0.5rem'}}>
                        <Grid container direction="column" spacing={1}>
                            {/* VFO 1 Frequency */}
                            <Grid>
                                <Grid container direction="row" sx={{alignItems: "center", gap: 0}}>
                                    <Grid size="auto" style={{minWidth: '100px'}}>
                                        <Typography variant="body2" sx={{color: 'text.secondary'}}>
                                            VFO 1
                                        </Typography>
                                    </Grid>
                                    <Grid size="grow" style={{textAlign: 'right'}}>
                                        <Typography variant="h7" style={{fontFamily: "Monospace, monospace", fontWeight: "bold"}}>
                                            <LCDFrequencyDisplay frequency={effectiveRigData?.vfo1?.frequency || 0} size="medium" />
                                        </Typography>
                                    </Grid>
                                </Grid>
                            </Grid>

                            {/* VFO 2 Frequency */}
                            <Grid>
                                <Grid container direction="row" sx={{alignItems: "center", gap: 0}}>
                                    <Grid size="auto" style={{minWidth: '100px'}}>
                                        <Typography variant="body2" sx={{color: 'text.secondary'}}>
                                            VFO 2
                                        </Typography>
                                    </Grid>
                                    <Grid size="grow" style={{textAlign: 'right'}}>
                                        <Typography variant="h7" style={{fontFamily: "Monospace, monospace", fontWeight: "bold"}}>
                                            <LCDFrequencyDisplay frequency={effectiveRigData?.vfo2?.frequency || 0} size="medium" />
                                        </Typography>
                                    </Grid>
                                </Grid>
                            </Grid>

                            {/* Doppler Shift */}
                            <Grid>
                                <Grid container direction="row" sx={{alignItems: "center", gap: 0}}>
                                    <Grid size="auto" style={{minWidth: '100px'}}>
                                        <Typography variant="body2" sx={{color: 'text.secondary'}}>
                                            {t('rig_control.doppler_shift')}
                                        </Typography>
                                    </Grid>
                                    <Grid size="grow" style={{textAlign: 'right'}}>
                                        <Typography variant="h7" style={{fontFamily: "Monospace, monospace", fontWeight: "bold"}}>
                                            <LCDFrequencyDisplay frequency={effectiveRigData['doppler_shift']} size="medium" frequencyIsOffset={true}/>
                                        </Typography>
                                    </Grid>
                                </Grid>
                            </Grid>
                        </Grid>
                    </Grid>
                </Grid>

                <Grid size={{ xs: 12, sm: 12, md: 12 }} style={{padding: '0.5rem 0.5rem 0rem 0.5rem'}}>
                    <Grid container direction="row" sx={{
                        justifyContent: "space-between",
                        alignItems: "stretch",
                    }}>
                        <Grid size="grow" style={{paddingRight: '0.5rem', flex: 1}}>
                            <Tooltip title={connectRigDisabled ? connectRigDisabledReason : ''}>
                                <span style={{ display: 'block' }}>
                                    <Button
                                        disabled={connectRigDisabled}
                                        fullWidth={true}
                                        variant="contained"
                                        color="success"
                                        style={{height: '44px'}}
                                        loading={isConnectRigActionPending}
                                        onClick={() => {
                                            connectRig()
                                        }}
                                    >
                                        {t('rig_control.connect')}
                                    </Button>
                                </span>
                            </Tooltip>
                        </Grid>
                        <Grid size="grow" style={{paddingRight: '0rem', flex: 1}}>
                            <Tooltip title={disconnectRigDisabled ? disconnectRigDisabledReason : ''}>
                                <span style={{ display: 'block' }}>
                                    <Button
                                        disabled={disconnectRigDisabled}
                                        fullWidth={true}
                                        variant="contained"
                                        color="error"
                                        style={{height: '44px'}}
                                        loading={isDisconnectRigActionPending}
                                        onClick={() => {
                                            disconnectRig()
                                        }}
                                    >
                                        {t('rig_control.disconnect')}
                                    </Button>
                                </span>
                            </Tooltip>
                        </Grid>
                    </Grid>
                </Grid>

                <Grid size={{ xs: 12, sm: 12, md: 12 }} style={{padding: '0.5rem 0.5rem 0.5rem'}}>
                    <Grid container direction="row" sx={{
                        justifyContent: "space-between",
                        alignItems: "stretch",
                    }}>
                        <Grid size="grow" style={{paddingRight: '0.5rem'}}>
                            <Tooltip title={trackRigDisabled ? trackRigDisabledReason : ''}>
                                <span style={{ display: 'block' }}>
                                    <Button
                                        fullWidth={true}
                                        disabled={trackRigDisabled}
                                        variant="contained"
                                        color="success"
                                        style={{height: '56px'}}
                                        loading={isTrackRigActionPending}
                                        onClick={()=>{handleTrackingStart()}}
                                    >
                                        {t('rig_control.track_radio')}
                                    </Button>
                                </span>
                            </Tooltip>
                        </Grid>
                        <Grid size="grow">
                            <Tooltip title={stopRigDisabled ? stopRigDisabledReason : ''}>
                                <span style={{ display: 'block' }}>
                                    <Button
                                        fullWidth={true}
                                        disabled={stopRigDisabled}
                                        variant="contained"
                                        color="error"
                                        style={{height: '56px'}}
                                        loading={isStopRigActionPending}
                                        onClick={() => {handleTrackingStop()}}
                                    >
                                        {t('rig_control.stop')}
                                    </Button>
                                </span>
                            </Tooltip>
                        </Grid>
                    </Grid>
                </Grid>
            </Grid>
            <RigQuickEditDialog
                open={openQuickEditDialog}
                onClose={() => setOpenQuickEditDialog(false)}
                rig={selectedRigDevice || null}
            />
        </>
    );
});

export default RigControl;
