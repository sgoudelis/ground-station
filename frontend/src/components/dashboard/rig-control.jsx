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
    setRadioRig,
    setRigVFO,
    setVFO1,
    setVFO2,
    setSelectedTransmitter,
    setTrackingStateInBackend
} from "../target/target-slice.jsx";
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
import LCDFrequencyDisplay from "../common/lcd-frequency-display.jsx";
import SettingsIcon from '@mui/icons-material/Settings';
import { RIG_STATES } from '../target/tracking-constants.js';
import RigQuickEditDialog from "./rig-quick-edit-dialog.jsx";
import { resolveRigLedStatus, RIG_LED_STATUS } from "../common/hardware-status.js";


import {useHardwareCommand} from '../target/use-hardware-command.js';
import HardwareControlHeader from './hardware-control-header.jsx';

const RigControl = React.memo(function RigControl({ trackerId: trackerIdOverride = "" }) {
    const { socket } = useSocket();
    const dispatch = useDispatch();
    const { t } = useTranslation('target');
    const {
        trackingState,
        satelliteId,
        selectedRadioRig,
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
    const effectiveSatelliteId = scopedTrackerView?.satelliteId ?? satelliteId;
    const effectiveSelectedRadioRig = scopedTrackerView?.selectedRadioRig ?? selectedRadioRig;
    const effectiveSelectedRigVFO = scopedTrackerView?.selectedRigVFO ?? selectedRigVFO;
    const effectiveSelectedVFO1 = scopedTrackerView?.selectedVFO1 ?? selectedVFO1;
    const effectiveSelectedVFO2 = scopedTrackerView?.selectedVFO2 ?? selectedVFO2;
    const effectiveSelectedTransmitter = scopedTrackerView?.selectedTransmitter ?? selectedTransmitter;
    const effectiveAvailableTransmitters = scopedTrackerView?.availableTransmitters ?? availableTransmitters;
    const effectiveRigData = scopedTrackerView?.rigData || rigData;
    const {command: activeRigCommand, busy: isRigCommandBusy, isPending,
        connected: isSocketConnected, ready: hardwareReady, lastUpdateAge} = useHardwareCommand({
        socket, view: scopedTrackerView, commands: trackerCommandsById, trackerId: scopedTrackerId,
        scope: 'rig', deviceId: effectiveSelectedRadioRig,
    });
    const isConnectRigActionPending = isPending(RIG_STATES.CONNECTED);
    const isDisconnectRigActionPending = isPending(RIG_STATES.DISCONNECTED);
    const isTrackRigActionPending = isPending(RIG_STATES.TRACKING);
    const isStopRigActionPending = isPending(RIG_STATES.STOPPED);

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
    const [openQuickEditDialog, setOpenQuickEditDialog] = React.useState(false);

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

    const connectRigDisabled = !hasTargets || !hardwareReady || isRigCommandBusy || effectiveRigData.connected || ["none", ""].includes(effectiveSelectedRadioRigValue);
    const disconnectRigDisabled = !hasTargets || !hardwareReady || isRigCommandBusy || !effectiveRigData.connected;
    const trackRigDisabled = !hasTargets || !hardwareReady || isRigCommandBusy || !effectiveRigData.connected || effectiveRigData.tracking || !hasSelectedTarget || ["none", ""].includes(effectiveSelectedTransmitterValue);
    const stopRigDisabled = !hasTargets || !isSocketConnected || isStopRigActionPending || (!isRigCommandBusy && !effectiveRigData.tracking);
    const busyReason = !hardwareReady ? 'Waiting for hardware status' : isRigCommandBusy ? 'Command in progress' : '';
    const connectRigDisabledReason = busyReason || 'Select a disconnected rig';
    const disconnectRigDisabledReason = busyReason || 'Rig is disconnected';
    const trackRigDisabledReason = busyReason || 'Connect the rig and select a target and transmitter';
    const stopRigDisabledReason = busyReason || 'Rig is not tracking';

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

    const submitRigChanges = (overrides) => {
        // Include staged rig selections, while leaving other hardware untouched.
        const values = {rig_id: effectiveSelectedRadioRig, transmitter_id: effectiveSelectedTransmitter,
            rig_vfo: effectiveSelectedRigVFO, vfo1: effectiveSelectedVFO1, vfo2: effectiveSelectedVFO2, ...overrides};
        const changes = Object.fromEntries(Object.entries(values)
            .filter(([key, value]) => key === 'rig_state' || value !== effectiveTrackingState[key]));
        return dispatch(setTrackingStateInBackend({socket, data: {tracker_id: scopedTrackerId}, changes}));
    };
    const handleTrackingStop = () => dispatch(setTrackingStateInBackend({socket, data: {tracker_id: scopedTrackerId}, changes: {rig_state: RIG_STATES.STOPPED}}));

    const handleTrackingStart = () => submitRigChanges({rig_state: RIG_STATES.TRACKING});

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
        const selectedValue = event.target.value;

        // Set the selected radio rig
        dispatch(setRadioRig({ value: selectedValue, trackerId: scopedTrackerId }));

        // Reset VFO selection when changing rigs
        dispatch(setRigVFO({ value: "none", trackerId: scopedTrackerId }));
    }

    function handleTransmitterChange(event) {
        const value = event.target.value;
        dispatch(setSelectedTransmitter({value, trackerId: scopedTrackerId}));
        return submitRigChanges({transmitter_id: value});
    }

    function handleVFO1Change(event) {
        const value = event.target.value;
        dispatch(setVFO1({value, trackerId: scopedTrackerId}));
        return submitRigChanges({vfo1: value});
    }

    function handleVFO2Change(event) {
        const value = event.target.value;
        dispatch(setVFO2({value, trackerId: scopedTrackerId}));
        return submitRigChanges({vfo2: value});
    }

    function handleVFOSwap() {
        dispatch(setVFO1({value: effectiveSelectedVFO2, trackerId: scopedTrackerId}));
        dispatch(setVFO2({value: effectiveSelectedVFO1, trackerId: scopedTrackerId}));
        return submitRigChanges({vfo1: effectiveSelectedVFO2, vfo2: effectiveSelectedVFO1});
    }

    const connectRig = () => submitRigChanges({rig_state: RIG_STATES.CONNECTED});
    const disconnectRig = () => submitRigChanges({rig_state: RIG_STATES.DISCONNECTED});

    return (
        <>
            <TitleBar className={getClassNamesBasedOnGridEditing(gridEditable, ["window-title-bar"])}>
                {t('rig_control.title', { defaultValue: 'Radio Rig Control' })}
            </TitleBar>

            <Grid container spacing={{ xs: 0, md: 0 }} columns={{ xs: 12, sm: 12, md: 12 }}>
                <HardwareControlHeader device={selectedRigDevice} emptyLabel="No rig selected"
                    connected={isSocketConnected} status={rigStatusChip.label} ledColor={rigStatusLedColor}
                    tone={resolvedRigLedStatus === RIG_LED_STATUS.TRACKING ? 'success' : [RIG_LED_STATUS.STOPPED, RIG_LED_STATUS.CONNECTED].includes(resolvedRigLedStatus) ? 'info' : null} command={activeRigCommand}
                    stale={!hardwareReady && hasTargets} lastUpdateAge={lastUpdateAge} />

                {/* 1. Rig Selection */}
                <Grid size={{ xs: 12, sm: 12, md: 12 }} style={{padding: '0.5rem 0.5rem 0rem 0.5rem'}}>
                    <Grid container direction="row" spacing={1} sx={{ alignItems: 'flex-end' }}>
                        <Grid size="grow">
                            <FormControl disabled={!hasTargets || isRigCommandBusy || effectiveRigData['connected'] === true}
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
                                                label={t('rig_control.none', { defaultValue: 'None' })}
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
                                disabled={!hasTargets || isRigCommandBusy || !effectiveSelectedRadioRigValue || effectiveSelectedRadioRigValue === 'none'}
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
                    <FormControl disabled={!hasTargets || isRigCommandBusy || effectiveRigData['tracking'] === true}
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
                            <FormControl disabled={!hasTargets || isRigCommandBusy || effectiveRigData['tracking'] === true}
                                         sx={{marginTop: 0, marginBottom: 0}} fullWidth variant="outlined" size="small">
                                <InputLabel htmlFor="vfo1-select">VFO 1</InputLabel>
                                <Select
                                    id="vfo1-select"
                                    value={effectiveSelectedTransmitterValue === "none" ? "none" : effectiveSelectedVFO1Value}
                                    onChange={(event) => {
                                        handleVFO1Change(event);
                                    }}
                                    size="small"
                                    label={t('rig_control.vfo_1', { defaultValue: 'VFO 1' })}>
                                    <MenuItem value="none">{t('rig_control.none', { defaultValue: '[none]' })}</MenuItem>
                                    <MenuItem value="uplink">
                                        {effectiveSelectedTransmitter && effectiveSelectedTransmitter !== "none" && effectiveRigData?.transmitters?.length > 0 ? (
                                            (() => {
                                                const transmitter = effectiveRigData.transmitters.find(t => t.id === effectiveSelectedTransmitter);
                                                return transmitter ? (
                                                    <>{t('rig_control.uplink', { defaultValue: 'Uplink:' })} {preciseHumanizeFrequency(transmitter.uplink_observed_freq || 0)}</>
                                                ) : "Uplink";
                                            })()
                                        ) : "Uplink"}
                                    </MenuItem>
                                    <MenuItem value="downlink">
                                        {effectiveSelectedTransmitter && effectiveSelectedTransmitter !== "none" && effectiveRigData?.transmitters?.length > 0 ? (
                                            (() => {
                                                const transmitter = effectiveRigData.transmitters.find(t => t.id === effectiveSelectedTransmitter);
                                                return transmitter ? (
                                                    <>{t('rig_control.downlink', { defaultValue: 'Downlink:' })} {preciseHumanizeFrequency(transmitter.downlink_observed_freq || 0)}</>
                                                ) : "Downlink";
                                            })()
                                        ) : "Downlink"}
                                    </MenuItem>
                                </Select>
                            </FormControl>

                            {/* VFO 2 */}
                            <FormControl disabled={!hasTargets || isRigCommandBusy || effectiveRigData['tracking'] === true}
                                         sx={{marginTop: 0, marginBottom: 1}} fullWidth variant="outlined" size="small">
                                <InputLabel htmlFor="vfo2-select">VFO 2</InputLabel>
                                <Select
                                    id="vfo2-select"
                                    value={effectiveSelectedTransmitterValue === "none" ? "none" : effectiveSelectedVFO2Value}
                                    onChange={(event) => {
                                        handleVFO2Change(event);
                                    }}
                                    size="small"
                                    label={t('rig_control.vfo_2', { defaultValue: 'VFO 2' })}>
                                    <MenuItem value="none">{t('rig_control.none', { defaultValue: '[none]' })}</MenuItem>
                                    <MenuItem value="downlink">
                                        {effectiveSelectedTransmitter && effectiveSelectedTransmitter !== "none" && effectiveRigData?.transmitters?.length > 0 ? (
                                            (() => {
                                                const transmitter = effectiveRigData.transmitters.find(t => t.id === effectiveSelectedTransmitter);
                                                return transmitter ? (
                                                    <>{t('rig_control.downlink', { defaultValue: 'Downlink:' })} {preciseHumanizeFrequency(transmitter.downlink_observed_freq || 0)}</>
                                                ) : "Downlink";
                                            })()
                                        ) : "Downlink"}
                                    </MenuItem>
                                    <MenuItem value="uplink">
                                        {effectiveSelectedTransmitter && effectiveSelectedTransmitter !== "none" && effectiveRigData?.transmitters?.length > 0 ? (
                                            (() => {
                                                const transmitter = effectiveRigData.transmitters.find(t => t.id === effectiveSelectedTransmitter);
                                                return transmitter ? (
                                                    <>{t('rig_control.uplink', { defaultValue: 'Uplink:' })} {preciseHumanizeFrequency(transmitter.uplink_observed_freq || 0)}</>
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
                                disabled={!hasTargets || isRigCommandBusy || effectiveRigData['tracking'] === true}
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
                                title={t('rig_control.swap_vfo_1_and_vfo_2', { defaultValue: 'Swap VFO 1 and VFO 2' })}>
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
                                            {t('rig_control.vfo_1', { defaultValue: 'VFO 1' })}
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
                                            {t('rig_control.vfo_2', { defaultValue: 'VFO 2' })}
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
