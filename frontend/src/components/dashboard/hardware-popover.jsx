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

import Stack from "@mui/material/Stack";
import * as React from "react";
import {
    Badge, Box, Button, Chip, IconButton, Typography,
} from "@mui/material";
import {useCallback, useEffect, useRef, useState} from "react";
import {useSocket} from "../common/socket.jsx";
import {useDispatch, useSelector} from "react-redux";
import Tooltip from "@mui/material/Tooltip";
import { useTranslation } from 'react-i18next';
import RadioIcon from '@mui/icons-material/Radio';
import {
    Popover,
} from '@mui/material';
import {SatelliteIcon} from "hugeicons-react";
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import TrackChangesIcon from '@mui/icons-material/TrackChanges';
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined';
import { setTrackerId, setTrackingStateInBackend } from "../target/target-slice.jsx";
import FleetTargetRow from "../common/fleet-target-row.jsx";
import {
    hasAssignedHardwareId,
    resolveAssignedHardwareId,
    resolveRotatorLedStatus,
    resolveRigLedStatus,
    isRotatorWarningStatus,
    isRigWarningStatus,
} from "../common/hardware-status.js";

import {selectTrackerCommand, isCommandOutstanding} from '../target/tracker-command-state.js';

const HardwareSettingsPopover = () => {
    const dispatch = useDispatch();
    const { t } = useTranslation('dashboard');
    const {socket} = useSocket();
    const buttonRef = useRef(null);
    const [anchorEl, setAnchorEl] = useState(buttonRef.current);
    const open = Boolean(anchorEl);
    const [activeIcon, setActiveIcon] = useState(null);
    const [connected, setConnected] = useState(false);
    const [rowErrors, setRowErrors] = useState({});
    const trackerId = useSelector((state) => state.targetSatTrack?.trackerId || "");
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
    const trackerViews = useSelector((state) => state.targetSatTrack?.trackerViews || {});
    const trackerCommandsById = useSelector((state) => state.targetSatTrack?.trackerCommandsById || {});
    const rotators = useSelector((state) => state.rotators?.rotators || []);
    const rigs = useSelector((state) => state.rigs?.rigs || []);
    const latestActiveTrackerIdRef = useRef(trackerId);

    useEffect(() => {
        latestActiveTrackerIdRef.current = trackerId;
    }, [trackerId]);
    const hasConfiguredTargets = React.useMemo(() => {
        const instances = Array.isArray(trackerInstances) ? trackerInstances : [];
        if (instances.length === 0) return false;
        return instances.some((instance) => {
            const instanceTrackerId = instance?.tracker_id || '';
            const view = trackerViews?.[instanceTrackerId] || {};
            const details = view?.satelliteData?.details || {};
            const tracking = view?.trackingState || {};
            const noradId = details?.norad_id ?? tracking?.norad_id ?? null;
            return !['', 'none', null, undefined].includes(noradId);
        });
    }, [trackerInstances, trackerViews]);

    // Socket connection event handlers
    useEffect(() => {
        if (!socket) return;

        // Component can mount after the socket is already connected
        // (e.g. after app-provider remount when navigation changes).
        setConnected(Boolean(socket.connected));

        const handleConnect = () => {
            setConnected(true);
        };

        const handleDisconnect = () => {
            setConnected(false);
        };

        // Add event listeners
        socket.on('connect', handleConnect);
        socket.on('disconnect', handleDisconnect);

        // Cleanup function to remove listeners
        return () => {
            socket.off('connect', handleConnect);
            socket.off('disconnect', handleDisconnect);
        };
    }, [socket]);

    const handleClick = (event, iconType) => {
        if (!connected) return; // Don't open popover when socket is disconnected
        setAnchorEl(event.currentTarget);
        setActiveIcon(iconType);
    };

    const handleClose = () => {
        setAnchorEl(null);
        // Keep the selected panel until the popover fully closes to avoid
        // a brief fallback render of the other panel during exit animation.
    };

    const fleetHardwareSummary = React.useMemo(() => {
        const summary = {
            rotator: {
                activeCount: 0,
                connectedCount: 0,
                slewingCount: 0,
                warningCount: 0,
                disconnectedCount: 0,
                assignedCount: 0,
            },
            rig: {
                activeCount: 0,
                connectedCount: 0,
                warningCount: 0,
                disconnectedCount: 0,
                assignedCount: 0,
            },
        };

        const configuredRotatorIds = new Set(
            (Array.isArray(rotators) ? rotators : [])
                .map((rotator) => rotator?.id)
                .filter((id) => hasAssignedHardwareId(id))
                .map((id) => String(id))
        );
        const configuredRigIds = new Set(
            (Array.isArray(rigs) ? rigs : [])
                .map((rig) => rig?.id)
                .filter((id) => hasAssignedHardwareId(id))
                .map((id) => String(id))
        );
        const assignedRotatorIds = new Set();
        const activeRotatorIds = new Set();
        const connectedRotatorIds = new Set();
        const slewingRotatorIds = new Set();
        const warningRotatorIds = new Set();
        const disconnectedRotatorIds = new Set();
        const assignedRigIds = new Set();
        const activeRigIds = new Set();
        const connectedRigIds = new Set();
        const warningRigIds = new Set();
        const disconnectedRigIds = new Set();

        trackerInstances.forEach((instance) => {
            const instanceTrackerId = instance?.tracker_id || '';
            const view = trackerViews?.[instanceTrackerId] || {};
            const trackingState = view?.trackingState || instance?.tracking_state || {};
            const rotatorData = view?.rotatorData || {};
            const rigData = view?.rigData || {};

            const rotatorId = resolveAssignedHardwareId(
                view?.selectedRotator,
                trackingState?.rotator_id,
                instance?.rotator_id
            );
            const hasRotatorAssigned = hasAssignedHardwareId(rotatorId);
            if (hasRotatorAssigned) {
                const normalizedRotatorId = String(rotatorId);
                assignedRotatorIds.add(normalizedRotatorId);
                const rotatorStatus = resolveRotatorLedStatus({ rotatorId, rotatorData, trackingState });
                const rotatorDisconnected = rotatorStatus === 'disconnected';
                const rotatorWarning = isRotatorWarningStatus(rotatorStatus);
                const rotatorSlewing = rotatorStatus === 'slewing';
                const rotatorActive = rotatorStatus === 'tracking' || rotatorStatus === 'slewing';
                const rotatorConnected = Boolean(rotatorData?.connected) || (
                    !['disconnected', 'none', 'unknown'].includes(rotatorStatus)
                );
                if (rotatorActive) activeRotatorIds.add(normalizedRotatorId);
                if (rotatorConnected) connectedRotatorIds.add(normalizedRotatorId);
                if (rotatorSlewing) slewingRotatorIds.add(normalizedRotatorId);
                if (rotatorDisconnected) disconnectedRotatorIds.add(normalizedRotatorId);
                else if (rotatorWarning) warningRotatorIds.add(normalizedRotatorId);
            }

            const rigId = resolveAssignedHardwareId(
                view?.selectedRadioRig,
                trackingState?.rig_id,
                instance?.rig_id
            );
            const hasRigAssigned = hasAssignedHardwareId(rigId);
            if (hasRigAssigned) {
                const normalizedRigId = String(rigId);
                assignedRigIds.add(normalizedRigId);
                const rigStatus = resolveRigLedStatus({ rigId, rigData, trackingState });
                const rigDisconnected = rigStatus === 'disconnected';
                const rigWarning = isRigWarningStatus(rigStatus);
                const rigActive = rigStatus === 'tracking';
                const rigConnected = Boolean(rigData?.connected) || (
                    !['disconnected', 'none', 'unknown'].includes(rigStatus)
                );
                if (rigActive) activeRigIds.add(normalizedRigId);
                if (rigConnected) connectedRigIds.add(normalizedRigId);
                if (rigDisconnected) disconnectedRigIds.add(normalizedRigId);
                else if (rigWarning) warningRigIds.add(normalizedRigId);
            }
        });

        summary.rotator.assignedCount = assignedRotatorIds.size;
        summary.rotator.activeCount = activeRotatorIds.size;
        summary.rotator.connectedCount = connectedRotatorIds.size;
        summary.rotator.slewingCount = slewingRotatorIds.size;
        summary.rotator.warningCount = warningRotatorIds.size;
        const disconnectedAssignedRotatorCount = [...disconnectedRotatorIds]
            .filter((id) => !connectedRotatorIds.has(id))
            .length;
        const unassignedConfiguredRotatorCount = [...configuredRotatorIds]
            .filter((id) => !assignedRotatorIds.has(id))
            .length;
        summary.rotator.disconnectedCount = disconnectedAssignedRotatorCount + unassignedConfiguredRotatorCount;

        summary.rig.assignedCount = assignedRigIds.size;
        summary.rig.activeCount = activeRigIds.size;
        summary.rig.connectedCount = connectedRigIds.size;
        summary.rig.warningCount = warningRigIds.size;
        const disconnectedAssignedRigCount = [...disconnectedRigIds]
            .filter((id) => !connectedRigIds.has(id))
            .length;
        const unassignedConfiguredRigCount = [...configuredRigIds]
            .filter((id) => !assignedRigIds.has(id))
            .length;
        summary.rig.disconnectedCount = disconnectedAssignedRigCount + unassignedConfiguredRigCount;

        return summary;
    }, [trackerInstances, trackerViews, rigs, rotators]);

    const getRigColor = () => {
        if (!hasConfiguredTargets) return 'text.disabled';
        if (!connected) return 'text.disabled';
        if (fleetHardwareSummary.rig.connectedCount > 0) return 'success.main';
        return 'text.secondary';
    };
    const getRotatorColor = () => {
        if (!hasConfiguredTargets) return 'text.disabled';
        if (!connected) return 'text.disabled';
        if (fleetHardwareSummary.rotator.slewingCount > 0) return 'warning.main';
        if (fleetHardwareSummary.rotator.connectedCount > 0) return 'success.main';
        return 'text.secondary';
    };

    const getRigTooltip = () => {
        if (!hasConfiguredTargets) return t('hardware_popover.no_targets_configured', { defaultValue: 'No targets configured' });
        if (!connected) return t('hardware_popover.socket_disconnected');
        return t('hardware_popover.rig_fleet_summary', {
            defaultValue: 'Rig fleet: {{active}} active, {{attention}} attention, {{disconnected}} disconnected',
            active: fleetHardwareSummary.rig.activeCount,
            attention: fleetHardwareSummary.rig.warningCount,
            disconnected: fleetHardwareSummary.rig.disconnectedCount,
        });
    };

    const getRotatorTooltip = () => {
        if (!hasConfiguredTargets) return t('hardware_popover.no_targets_configured', { defaultValue: 'No targets configured' });
        if (!connected) return t('hardware_popover.socket_disconnected');
        return t('hardware_popover.rotator_fleet_summary', {
            defaultValue: 'Rotator fleet: {{active}} active, {{attention}} attention, {{disconnected}} disconnected',
            active: fleetHardwareSummary.rotator.activeCount,
            attention: fleetHardwareSummary.rotator.warningCount,
            disconnected: fleetHardwareSummary.rotator.disconnectedCount,
        });
    };
    const rotatorNameById = React.useMemo(() => {
        const entries = Array.isArray(rotators) ? rotators : [];
        return entries.reduce((acc, rotator) => {
            const id = rotator?.id;
            if (id == null) return acc;
            acc[String(id)] = rotator?.name || String(id);
            return acc;
        }, {});
    }, [rotators]);
    const rigNameById = React.useMemo(() => {
        const entries = Array.isArray(rigs) ? rigs : [];
        return entries.reduce((acc, rig) => {
            const id = rig?.id;
            if (id == null) return acc;
            acc[String(id)] = rig?.name || String(id);
            return acc;
        }, {});
    }, [rigs]);

    const fleetRows = React.useMemo(() => {
        return trackerInstances.map((instance, index) => {
            const instanceTrackerId = instance?.tracker_id || '';
            const view = trackerViews?.[instanceTrackerId] || {};
            const trackingState = view?.trackingState || instance?.tracking_state || {};
            const rotatorData = view?.rotatorData || {};
            const rigData = view?.rigData || {};
            const targetNumber = Number(instance?.target_number || (index + 1));
            const command = selectTrackerCommand(trackerCommandsById, instanceTrackerId);
            const commandBusy = isCommandOutstanding(command);
            return {
                trackerId: instanceTrackerId,
                targetNumber,
                satName: view?.satelliteData?.details?.name || 'No satellite',
                satNorad: trackingState?.norad_id || 'none',
                rotatorId: trackingState?.rotator_id || instance?.rotator_id || 'none',
                rotatorName: rotatorNameById[String(trackingState?.rotator_id || instance?.rotator_id || '')] || 'No rotator',
                rigId: trackingState?.rig_id || instance?.rig_id || 'none',
                rigName: rigNameById[String(trackingState?.rig_id || instance?.rig_id || '')] || 'No rig',
                trackingState,
                rotatorData,
                rigData,
                commandBusy,
                isActive: instanceTrackerId === trackerId,
            };
        });
    }, [trackerInstances, trackerViews, trackerCommandsById, trackerId, rotatorNameById, rigNameById]);

    const submitQuickAction = useCallback(async (row, nextState) => {
        if (!row?.trackerId) return;
        const previouslyActiveTrackerId = latestActiveTrackerIdRef.current;
        setRowErrors((prev) => ({ ...prev, [row.trackerId]: null }));
        try {
            await dispatch(setTrackingStateInBackend({
                socket,
                data: {
                    ...row.trackingState,
                    tracker_id: row.trackerId,
                    ...nextState,
                },
            })).unwrap();
        } catch (error) {
            const message = error?.message || error?.error || 'Action failed';
            setRowErrors((prev) => ({ ...prev, [row.trackerId]: String(message) }));
            window.setTimeout(() => {
                setRowErrors((prev) => {
                    if (!prev?.[row.trackerId]) return prev;
                    const next = { ...prev };
                    delete next[row.trackerId];
                    return next;
                });
            }, 4000);
        } finally {
            // Preserve the user's active target when issuing per-row quick actions.
            // The tracking-state thunk sets trackerId to the command's target tracker; restore
            // only if selection is still on that row to avoid overriding explicit user changes.
            if (
                previouslyActiveTrackerId
                && previouslyActiveTrackerId !== row.trackerId
                && latestActiveTrackerIdRef.current === row.trackerId
            ) {
                dispatch(setTrackerId(previouslyActiveTrackerId));
            }
        }
    }, [dispatch, socket]);

    const renderCompactFleetPanel = () => {
        const isRotatorPanel = activeIcon === 'rotator';
        const panelTitle = isRotatorPanel ? 'Rotator Quick Actions' : 'Rig Quick Actions';
        const actionButtonSx = {
            minWidth: 30,
            px: 0.6,
            borderColor: 'divider',
            '&.Mui-disabled': {
                borderColor: 'action.disabledBackground',
                color: 'action.disabled',
            },
        };
        if (fleetRows.length === 0) {
            return (
                <Box sx={{ p: 1.25 }}>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', fontSize: '12px' }}>
                        {panelTitle}
                    </Typography>
                    <Box
                        sx={{
                            mt: 0.9,
                            minHeight: 126,
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: 0.9,
                            textAlign: 'center',
                            border: '1px dashed',
                            borderColor: 'border.main',
                            borderRadius: 1,
                            px: 1.5,
                            py: 2,
                            backgroundColor: 'overlay.light',
                        }}
                    >
                        <Typography variant="body2" sx={{ fontWeight: 700 }}>
                            {t('hardware_popover.no_targets_configured', { defaultValue: 'No targets configured' })}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            {t('hardware_popover.add_a_target_to_enable_per_target_rig_and_rotator_quick_', { defaultValue: 'Add a target to enable per-target rig and rotator quick actions.' })}
                        </Typography>
                    </Box>
                </Box>
            );
        }
        return (
            <Box sx={{ p: 0.9 }}>
                <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', fontSize: '12px' }}>
                    {panelTitle}
                </Typography>
                <Stack spacing={0.65} sx={{ mt: 0.7 }}>
                    {fleetRows.map((row) => {
                        const statusLabel = isRotatorPanel
                            ? (
                                row.rotatorData?.connected && row.rotatorData?.motion_unconfirmed ? 'Motion unconfirmed' : row.rotatorData?.slewing
                                    ? 'Slewing'
                                    : (row.rotatorData?.tracking
                                        ? 'Tracking'
                                        : (row.rotatorData?.parked
                                            ? 'Parked'
                                            : (row.rotatorData?.connected ? 'Connected' : 'Disconnected')))
                            )
                            : (row.rigData?.tracking ? 'Tracking' : (row.rigData?.connected ? 'Connected' : 'Disconnected'));
                        const warningPillLabel = (() => {
                            if (statusLabel === 'Disconnected') {
                                return null;
                            }
                            if (isRotatorPanel) {
                                const elevation = Number(row.rotatorData?.el);
                                const isBelowHorizon = Number.isFinite(elevation) && elevation < 0;
                                if (isBelowHorizon) {
                                    return t('hardware_popover.warning_below_horizon', { defaultValue: 'Below Horizon' });
                                }
                                if (row.rotatorData?.minelevation) {
                                    return t('hardware_popover.warning_below_min_elevation', { defaultValue: 'Below Min Elevation' });
                                }
                                if (row.rotatorData?.outofbounds) {
                                    return t('hardware_popover.warning_out_of_bounds', { defaultValue: 'Out of Bounds' });
                                }
                                if (statusLabel !== 'Parked' && row.rotatorData?.parked) {
                                    return t('hardware_popover.warning_parked', { defaultValue: 'Parked' });
                                }
                                return null;
                            }
                            return null;
                        })();
                        const formatHz = (value) => (
                            Number.isFinite(Number(value))
                                ? Number(value).toFixed(0)
                                : 'N/A'
                        );
                        const actionState = (() => {
                            const hasTarget = !['', 'none', null, undefined].includes(row.satNorad);
                            if (isRotatorPanel) {
                                const connectedNow = Boolean(row.rotatorData?.connected);
                                const trackingNow = Boolean(row.rotatorData?.tracking);
                                const canConnect = !row.commandBusy && !connectedNow && !['', 'none'].includes(row.rotatorId);
                                const canTrack = !row.commandBusy && connectedNow && !row.rotatorData?.motion_unconfirmed && !trackingNow && hasTarget;
                                const canStop = !row.commandBusy && connectedNow && (trackingNow || row.rotatorData?.motion_unconfirmed || row.rotatorData?.slewing);
                                const canDisconnect = !row.commandBusy && connectedNow && !trackingNow;
                                return {
                                    connect: { enabled: canConnect, reason: canConnect ? 'Connect' : (['', 'none'].includes(row.rotatorId) ? 'No rotator assigned' : (connectedNow ? 'Already connected' : (row.commandBusy ? 'Command in progress' : 'Unavailable'))) },
                                    track: { enabled: canTrack, reason: canTrack ? 'Track' : (!connectedNow ? 'Connect first' : (!hasTarget ? 'No target selected' : (trackingNow ? 'Already tracking' : (row.commandBusy ? 'Command in progress' : 'Unavailable')))) },
                                    stop: { enabled: canStop, reason: canStop ? 'Stop' : (trackingNow ? 'Stop' : (row.commandBusy ? 'Command in progress' : 'Not tracking')) },
                                    disconnect: { enabled: canDisconnect, reason: canDisconnect ? 'Disconnect' : (trackingNow ? 'Stop tracking first' : (!connectedNow ? 'Already disconnected' : (row.commandBusy ? 'Command in progress' : 'Unavailable'))) },
                                };
                            }
                            const connectedNow = Boolean(row.rigData?.connected);
                            const trackingNow = Boolean(row.rigData?.tracking);
                            const hasTransmitter = !['', 'none', null, undefined].includes(row.trackingState?.transmitter_id);
                            const canConnect = !row.commandBusy && !connectedNow && !['', 'none'].includes(row.rigId);
                            const canTrack = !row.commandBusy && connectedNow && !trackingNow && hasTarget && hasTransmitter;
                            const canStop = !row.commandBusy && trackingNow;
                            const canDisconnect = !row.commandBusy && connectedNow && !trackingNow;
                            return {
                                connect: { enabled: canConnect, reason: canConnect ? 'Connect' : (['', 'none'].includes(row.rigId) ? 'No rig assigned' : (connectedNow ? 'Already connected' : (row.commandBusy ? 'Command in progress' : 'Unavailable'))) },
                                track: { enabled: canTrack, reason: canTrack ? 'Track' : (!connectedNow ? 'Connect first' : (!hasTarget ? 'No target selected' : (!hasTransmitter ? 'No transmitter selected' : (trackingNow ? 'Already tracking' : (row.commandBusy ? 'Command in progress' : 'Unavailable'))))) },
                                stop: { enabled: canStop, reason: canStop ? 'Stop' : (trackingNow ? 'Stop' : (row.commandBusy ? 'Command in progress' : 'Not tracking')) },
                                disconnect: { enabled: canDisconnect, reason: canDisconnect ? 'Disconnect' : (trackingNow ? 'Stop tracking first' : (!connectedNow ? 'Already disconnected' : (row.commandBusy ? 'Command in progress' : 'Unavailable'))) },
                            };
                        })();
                        const az = Number.isFinite(Number(row.rotatorData?.az)) ? Number(row.rotatorData.az).toFixed(1) : 'N/A';
                        const el = Number.isFinite(Number(row.rotatorData?.el)) ? Number(row.rotatorData.el).toFixed(1) : 'N/A';
                        const rigFrequency = formatHz(row.rigData?.frequency);
                        const rigVfo1 = formatHz(row.rigData?.vfo1?.frequency);
                        const rigVfo2 = formatHz(row.rigData?.vfo2?.frequency);
                        const rigDopplerShift = formatHz(row.rigData?.doppler_shift);
                        const rigDownlinkObserved = formatHz(row.rigData?.downlink_observed_freq);
                        return (
                            <Box key={row.trackerId}>
                                <FleetTargetRow
                                    targetNumber={row.targetNumber}
                                    trackingActive={Boolean(isRotatorPanel ? row.rotatorData?.tracking : row.rigData?.tracking)}
                                    satName={row.satName}
                                    satNorad={row.satNorad}
                                    elevation={null}
                                    isActive={false}
                                    onFocus={() => dispatch(setTrackerId(row.trackerId))}
                                    extraMeta={(
                                        <Box sx={{ width: '100%' }}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', width: '100%', gap: 1 }}>
                                                <Typography
                                                    variant="caption"
                                                    color="text.secondary"
                                                    sx={{
                                                        minWidth: 0,
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                        fontSize: '13px',
                                                        lineHeight: 1.35,
                                                    }}
                                                >
                                                    {isRotatorPanel ? row.rotatorName : row.rigName}
                                                </Typography>
                                                <Typography
                                                    variant="caption"
                                                    sx={{
                                                        marginLeft: 'auto',
                                                        color: 'text.secondary',
                                                        fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                                                        fontFeatureSettings: '"tnum" 1',
                                                        whiteSpace: 'nowrap',
                                                        textAlign: 'right',
                                                        fontSize: '14px',
                                                        lineHeight: 1.35,
                                                    }}
                                                >
                                                    {isRotatorPanel ? `Az ${az}° El ${el}°` : `Freq ${rigFrequency} Hz`}
                                                </Typography>
                                            </Box>
                                            {!isRotatorPanel && (
                                                <>
                                                    <Box
                                                        sx={{
                                                            mt: 0.25,
                                                            display: 'grid',
                                                            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                                                            columnGap: 1.1,
                                                            rowGap: 0.1,
                                                            fontFamily: 'Monaco, Consolas, "Courier New", monospace',
                                                            fontFeatureSettings: '"tnum" 1',
                                                        }}
                                                    >
                                                    <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', alignItems: 'baseline', columnGap: 0.6, minWidth: 0 }}>
                                                        <Typography component="span" variant="caption" color="text.secondary" sx={{ fontSize: '12px', lineHeight: 1.3, whiteSpace: 'nowrap' }}>
                                                            {t('hardware_popover.vfo_1_frequency', { defaultValue: 'VFO 1 Frequency' })}
                                                        </Typography>
                                                        <Typography
                                                            component="span"
                                                            variant="caption"
                                                            color="text.secondary"
                                                            sx={{ fontSize: '12px', lineHeight: 1.3, textAlign: 'right', justifySelf: 'end', minWidth: 0, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
                                                        >
                                                            {rigVfo1}
                                                        </Typography>
                                                    </Box>
                                                    <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', alignItems: 'baseline', columnGap: 0.6, minWidth: 0 }}>
                                                        <Typography component="span" variant="caption" color="text.secondary" sx={{ fontSize: '12px', lineHeight: 1.3, whiteSpace: 'nowrap' }}>
                                                            {t('hardware_popover.vfo_2_frequency', { defaultValue: 'VFO 2 Frequency' })}
                                                        </Typography>
                                                        <Typography
                                                            component="span"
                                                            variant="caption"
                                                            color="text.secondary"
                                                            sx={{ fontSize: '12px', lineHeight: 1.3, textAlign: 'right', justifySelf: 'end', minWidth: 0, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
                                                        >
                                                            {rigVfo2}
                                                        </Typography>
                                                    </Box>
                                                    <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', alignItems: 'baseline', columnGap: 0.6, minWidth: 0 }}>
                                                        <Typography component="span" variant="caption" color="text.secondary" sx={{ fontSize: '12px', lineHeight: 1.3, whiteSpace: 'nowrap' }}>
                                                            {t('hardware_popover.doppler_shift', { defaultValue: 'Doppler Shift' })}
                                                        </Typography>
                                                        <Typography
                                                            component="span"
                                                            variant="caption"
                                                            color="text.secondary"
                                                            sx={{ fontSize: '12px', lineHeight: 1.3, textAlign: 'right', justifySelf: 'end', minWidth: 0, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
                                                        >
                                                            {rigDopplerShift}
                                                        </Typography>
                                                    </Box>
                                                    <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', alignItems: 'baseline', columnGap: 0.6, minWidth: 0 }}>
                                                        <Typography component="span" variant="caption" color="text.secondary" sx={{ fontSize: '12px', lineHeight: 1.3, whiteSpace: 'nowrap' }}>
                                                            {t('hardware_popover.downlink_observed', { defaultValue: 'Downlink Observed' })}
                                                        </Typography>
                                                        <Typography
                                                            component="span"
                                                            variant="caption"
                                                            color="text.secondary"
                                                            sx={{ fontSize: '12px', lineHeight: 1.3, textAlign: 'right', justifySelf: 'end', minWidth: 0, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
                                                        >
                                                            {rigDownlinkObserved}
                                                        </Typography>
                                                    </Box>
                                                    </Box>
                                                    {row.rigData?.orbit_compatibility_notice && (
                                                        <Typography
                                                            variant="caption"
                                                            color="warning.main"
                                                            sx={{ display: 'block', mt: 0.5, lineHeight: 1.35 }}
                                                        >
                                                            {row.rigData.orbit_compatibility_notice}
                                                        </Typography>
                                                    )}
                                                </>
                                            )}
                                        </Box>
                                    )}
                                    statusChip={(
                                        <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: 'nowrap', minWidth: 0 }}>
                                            <Tooltip title={statusLabel}>
                                                <Chip
                                                    size="small"
                                                    label={statusLabel}
                                                    color={
                                                        statusLabel === 'Slewing' || statusLabel === 'Parked'
                                                            ? 'warning'
                                                            : (statusLabel === 'Tracking' ? 'success' : (statusLabel === 'Connected' ? 'success' : 'default'))
                                                    }
                                                    variant={statusLabel === 'Disconnected' ? 'outlined' : 'filled'}
                                                    sx={{
                                                        maxWidth: 110,
                                                        minWidth: 0,
                                                        '& .MuiChip-label': {
                                                            fontSize: '11px',
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                            whiteSpace: 'nowrap',
                                                        }
                                                    }}
                                                />
                                            </Tooltip>
                                            {warningPillLabel && (
                                                <Tooltip title={warningPillLabel}>
                                                    <Chip
                                                        size="small"
                                                        label={warningPillLabel}
                                                        color="warning"
                                                        variant="outlined"
                                                        sx={{
                                                            maxWidth: 130,
                                                            minWidth: 0,
                                                            '& .MuiChip-label': {
                                                                fontSize: '11px',
                                                                overflow: 'hidden',
                                                                textOverflow: 'ellipsis',
                                                                whiteSpace: 'nowrap',
                                                            }
                                                        }}
                                                    />
                                                </Tooltip>
                                            )}
                                        </Stack>
                                    )}
                                    actions={(
                                        <Stack direction="row" spacing={0.5}>
                                        <Tooltip title={actionState.connect.reason}>
                                            <span>
                                                <Button
                                                    size="small"
                                                    variant="outlined"
                                                    color="success"
                                                    disabled={!actionState.connect.enabled}
                                                    onClick={() => submitQuickAction(row, isRotatorPanel ? { rotator_state: 'connected' } : { rig_state: 'connected' })}
                                                    sx={actionButtonSx}
                                                >
                                                    <LinkIcon fontSize="small" />
                                                </Button>
                                            </span>
                                        </Tooltip>
                                        <Tooltip title={actionState.track.reason}>
                                            <span>
                                                <Button
                                                    size="small"
                                                    variant="outlined"
                                                    color="info"
                                                    disabled={!actionState.track.enabled}
                                                    onClick={() => submitQuickAction(row, isRotatorPanel ? { rotator_state: 'tracking' } : { rig_state: 'tracking' })}
                                                    sx={actionButtonSx}
                                                >
                                                    <TrackChangesIcon fontSize="small" />
                                                </Button>
                                            </span>
                                        </Tooltip>
                                        <Tooltip title={actionState.stop.reason}>
                                            <span>
                                                <Button
                                                    size="small"
                                                    variant="outlined"
                                                    color="warning"
                                                    disabled={!actionState.stop.enabled}
                                                    onClick={() => submitQuickAction(row, isRotatorPanel ? { rotator_state: 'stopped' } : { rig_state: 'stopped' })}
                                                    sx={actionButtonSx}
                                                >
                                                    <StopCircleOutlinedIcon fontSize="small" />
                                                </Button>
                                            </span>
                                        </Tooltip>
                                        <Tooltip title={actionState.disconnect.reason}>
                                            <span>
                                                <Button
                                                    size="small"
                                                    variant="outlined"
                                                    color="error"
                                                    disabled={!actionState.disconnect.enabled}
                                                    onClick={() => submitQuickAction(row, isRotatorPanel ? { rotator_state: 'disconnected' } : { rig_state: 'disconnected' })}
                                                    sx={actionButtonSx}
                                                >
                                                    <LinkOffIcon fontSize="small" />
                                                </Button>
                                            </span>
                                        </Tooltip>
                                        </Stack>
                                    )}
                                />
                                {rowErrors?.[row.trackerId] && (
                                    <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.35 }}>
                                        {rowErrors[row.trackerId]}
                                    </Typography>
                                )}
                            </Box>
                        );
                    })}
                </Stack>
            </Box>
        );
    };

    return (<>
        <Stack direction="row" spacing={0}>
            <Tooltip title={getRotatorTooltip()}>
                <IconButton
                    onClick={(event) => handleClick(event, 'rotator')}
                    size="small"
                    sx={{
                        width: 40, color: getRotatorColor(), '&:hover': {
                            backgroundColor: 'overlay.light'
                        }
                    }}
                >
                    <Badge
                        badgeContent={fleetHardwareSummary.rotator.connectedCount}
                        invisible={!connected || !hasConfiguredTargets || fleetHardwareSummary.rotator.connectedCount === 0}
                        max={99}
                        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                        sx={{
                            '& .MuiBadge-badge': {
                                minWidth: 14,
                                height: 14,
                                px: 0.4,
                                bgcolor: 'background.paper',
                                color: 'text.secondary',
                                border: '1px solid',
                                borderColor: 'divider',
                                fontSize: '0.55rem',
                                fontWeight: 700,
                            },
                        }}
                    >
                        <SatelliteIcon style={{ width: 22, height: 22 }} />
                    </Badge>
                </IconButton>
            </Tooltip>
            <Tooltip title={getRigTooltip()}>
                <IconButton
                    ref={buttonRef}
                    onClick={(event) => handleClick(event, 'rig')}
                    size="small"
                    sx={{
                        width: 40, color: getRigColor(), '&:hover': {
                            backgroundColor: 'overlay.light'
                        }
                    }}
                >
                    <Badge
                        badgeContent={fleetHardwareSummary.rig.connectedCount}
                        invisible={!connected || !hasConfiguredTargets || fleetHardwareSummary.rig.connectedCount === 0}
                        max={99}
                        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                        sx={{
                            '& .MuiBadge-badge': {
                                minWidth: 14,
                                height: 14,
                                px: 0.4,
                                bgcolor: 'background.paper',
                                color: 'text.secondary',
                                border: '1px solid',
                                borderColor: 'divider',
                                fontSize: '0.55rem',
                                fontWeight: 700,
                            },
                        }}
                    >
                        <RadioIcon sx={{ fontSize: 22 }} />
                    </Badge>
                </IconButton>
            </Tooltip>
        </Stack>
        <Popover
            open={open}
            anchorEl={anchorEl}
            onClose={handleClose}
            anchorOrigin={{
                vertical: 'bottom', horizontal: 'right',
            }}
            transformOrigin={{
                vertical: 'top', horizontal: 'right',
            }}
            slotProps={{
                paper: {
                    sx: {
                        mt: 0.5,
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1.25,
                        overflow: 'hidden',
                    },
                },
            }}
        >
            <Box sx={{
                p: 0,
                minWidth: 380,
                width: 380,
                backgroundColor: 'background.paper',
            }}>
                {renderCompactFleetPanel()}
            </Box>
        </Popover>
    </>);
};

export default React.memo(HardwareSettingsPopover);
