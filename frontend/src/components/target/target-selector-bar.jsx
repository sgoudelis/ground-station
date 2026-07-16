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

import React, { useCallback, useState, useEffect, useMemo, useRef } from "react";
import {
    Box,
    Typography,
    Chip,
    Tooltip,
    Button,
    Tabs,
    Tab,
    IconButton,
    Autocomplete,
    TextField,
    CircularProgress,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
    useMediaQuery,
    useTheme,
} from "@mui/material";
import { useDispatch, useSelector } from "react-redux";
import { useSocket } from "../common/socket.jsx";
import CloseIcon from '@mui/icons-material/Close';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import LocationSearchingIcon from '@mui/icons-material/LocationSearching';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import LocalParkingIcon from '@mui/icons-material/LocalParking';
import WarningIcon from '@mui/icons-material/Warning';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import {
    setAvailableTransmitters,
    setRadioRig,
    setRotator,
    setSatelliteId,
    setTrackerId,
    setTrackingStateInBackend,
} from './target-slice.jsx';
import { toast } from "../../utils/toast-with-timestamp.jsx";
import SatelliteSearchAutocomplete from "./satellite-search.jsx";
import { useTargetRotatorSelectionDialog } from "./use-target-rotator-selection-dialog.jsx";
import { deleteTrackerInstance } from "./tracker-instances-slice.jsx";
import { cancelRunningObservation } from "../scheduler/scheduler-slice.jsx";
import { resolveTabHardwareLedStatus } from "../common/hardware-status.js";
import { fetchMonitoredCelestial } from "../celestial/monitored-slice.jsx";
import { resolveTargetDisplayName } from './celestial-target-utils.js';

const TARGET_SLOT_ID_PATTERN = /^target-(\d+)$/;
const ADD_TARGET_TAB_VALUE = '__add-target__';
const TARGET_TYPES = Object.freeze({
    SATELLITE: 'satellite',
    MISSION: 'mission',
    BODY: 'body',
});

const normalizeTargetType = (trackingState = {}) => {
    const explicitType = String(trackingState?.target_type || '').trim().toLowerCase();
    if (explicitType === TARGET_TYPES.SATELLITE || explicitType === TARGET_TYPES.MISSION || explicitType === TARGET_TYPES.BODY) {
        return explicitType;
    }
    if (String(trackingState?.command || '').trim()) {
        return TARGET_TYPES.MISSION;
    }
    if (String(trackingState?.body_id || '').trim()) {
        return TARGET_TYPES.BODY;
    }
    return TARGET_TYPES.SATELLITE;
};

const getTrackingTargetIdentifier = (trackingState = {}) => {
    const targetType = normalizeTargetType(trackingState);
    if (targetType === TARGET_TYPES.MISSION) {
        return String(trackingState?.command || '').trim();
    }
    if (targetType === TARGET_TYPES.BODY) {
        return String(trackingState?.body_id || '').trim().toLowerCase();
    }
    return String(trackingState?.norad_id || '').trim();
};

const normalizeAssignedResourceId = (value) => {
    const normalized = String(value ?? '').trim();
    if (!normalized || normalized.toLowerCase() === 'none') {
        return '';
    }
    return normalized;
};

const resolveObservationTrackerId = (observation) => {
    const resolved = String(
        observation?.tracker_id
        || observation?.runtime_tracker_id
        || observation?.active_tracker_id
        || observation?.id
        || ''
    ).trim();
    return resolved;
};

const parseTargetSlotNumber = (trackerId = '') => {
    const match = String(trackerId || '').match(TARGET_SLOT_ID_PATTERN);
    if (!match) {
        return null;
    }
    const targetNumber = Number(match[1]);
    return Number.isFinite(targetNumber) && targetNumber > 0 ? targetNumber : null;
};

const deriveNextTrackerSlotId = (instances = []) => {
    const usedTargetNumbers = new Set();
    instances.forEach((instance) => {
        const targetNumber = parseTargetSlotNumber(instance?.tracker_id);
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

const resolveTabLedPresentation = ({ source, status, usedRigFallback }) => {
    const bySource = {
        rotator: {
            none: {
                label: 'No rotator',
                bgColor: 'action.disabled',
                borderColor: 'action.disabledBackground',
                Icon: null,
                iconColor: 'text.disabled',
            },
            disconnected: {
                label: 'Rotator disconnected',
                // Neutral gray: disconnected is not an error state.
                bgColor: 'action.disabled',
                borderColor: 'action.disabledBackground',
                Icon: CloseIcon,
                iconColor: 'text.disabled',
            },
            parked: {
                label: 'Rotator parked',
                bgColor: 'warning.main',
                borderColor: 'warning.dark',
                Icon: LocalParkingIcon,
                iconColor: 'common.white',
            },
            outofbounds: {
                label: 'Rotator out of bounds',
                bgColor: 'secondary.main',
                borderColor: 'secondary.dark',
                Icon: WarningIcon,
                iconColor: 'common.white',
            },
            minelevation: {
                label: 'Below minimum elevation',
                bgColor: 'error.light',
                borderColor: 'error.main',
                Icon: ArrowDownwardIcon,
                iconColor: 'common.white',
            },
            slewing: {
                label: 'Rotator slewing',
                bgColor: 'warning.main',
                borderColor: 'warning.dark',
                Icon: PlayArrowIcon,
                iconColor: 'common.white',
            },
            tracking: {
                label: 'Rotator tracking',
                bgColor: 'success.light',
                borderColor: 'success.main',
                Icon: LocationSearchingIcon,
                iconColor: 'common.white',
            },
            stopped: {
                label: 'Rotator stopped',
                // Neutral informational state (not warning/error).
                bgColor: 'info.light',
                borderColor: 'info.main',
                Icon: PauseIcon,
                iconColor: 'common.white',
            },
            connected: {
                label: 'Rotator connected',
                bgColor: 'success.dark',
                borderColor: 'success.main',
                Icon: null,
                iconColor: 'common.white',
            },
            unknown: {
                label: 'Rotator status unknown',
                bgColor: 'action.disabled',
                borderColor: 'action.disabledBackground',
                Icon: null,
                iconColor: 'text.disabled',
            },
        },
        rig: {
            none: {
                label: 'No rig',
                bgColor: 'action.disabled',
                borderColor: 'action.disabledBackground',
                Icon: null,
                iconColor: 'text.disabled',
            },
            disconnected: {
                label: 'Rig disconnected',
                bgColor: 'action.disabled',
                borderColor: 'action.disabledBackground',
                Icon: CloseIcon,
                iconColor: 'text.disabled',
            },
            tracking: {
                label: 'Rig tracking',
                bgColor: 'success.light',
                borderColor: 'success.main',
                Icon: LocationSearchingIcon,
                iconColor: 'common.white',
            },
            stopped: {
                label: 'Rig stopped',
                bgColor: 'info.light',
                borderColor: 'info.main',
                Icon: PauseIcon,
                iconColor: 'common.white',
            },
            connected: {
                label: 'Rig connected',
                bgColor: 'success.dark',
                borderColor: 'success.main',
                Icon: null,
                iconColor: 'common.white',
            },
            unknown: {
                label: 'Rig status unknown',
                bgColor: 'action.disabled',
                borderColor: 'action.disabledBackground',
                Icon: null,
                iconColor: 'text.disabled',
            },
        },
    };

    const fallback = bySource[source]?.unknown || bySource.rig.unknown;
    const resolved = bySource[source]?.[status] || fallback;
    return {
        ...resolved,
        label: usedRigFallback ? `${resolved.label} (rig fallback)` : resolved.label,
        fallbackSource: source,
    };
};

const TargetSelectorBar = React.memo(function TargetSelectorBar() {
    const { socket } = useSocket();
    const dispatch = useDispatch();
    const theme = useTheme();
    const isCompactHeader = useMediaQuery(theme.breakpoints.down('lg'));
    const isTightHeader = useMediaQuery(theme.breakpoints.down('md'));

    const {
        trackingState,
        trackerId,
    } = useSelector((state) => state.targetSatTrack);
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
    const schedulerObservations = useSelector((state) => state.scheduler?.observations || []);
    const rigRows = useSelector((state) => state.rigs?.rigs || []);
    const rotatorRows = useSelector((state) => state.rotators?.rotators || []);
    const monitoredCelestialRows = useSelector((state) => state.celestialMonitored?.monitored || []);

    const trackerViews = useSelector((state) => state.targetSatTrack?.trackerViews || {});
    const { requestRotatorForTarget, dialog: rotatorSelectionDialog } = useTargetRotatorSelectionDialog();
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [pendingDeleteTarget, setPendingDeleteTarget] = useState(null);
    const [deleteTargetBusy, setDeleteTargetBusy] = useState(false);
    const [abortDialogOpen, setAbortDialogOpen] = useState(false);
    const [pendingAbortObservation, setPendingAbortObservation] = useState(null);
    const [abortObservationBusy, setAbortObservationBusy] = useState(false);
    const [createDialogOpen, setCreateDialogOpen] = useState(false);
    const [createTargetBusy, setCreateTargetBusy] = useState(false);
    const [createTargetType, setCreateTargetType] = useState(TARGET_TYPES.SATELLITE);
    const [createSearchOpen, setCreateSearchOpen] = useState(false);
    const [createSearchOptions, setCreateSearchOptions] = useState([]);
    const [createSearchLoading, setCreateSearchLoading] = useState(false);
    const [createSelectedSatellite, setCreateSelectedSatellite] = useState(null);
    const [createSelectedMission, setCreateSelectedMission] = useState(null);
    const [createSelectedBodyId, setCreateSelectedBodyId] = useState('');
    const [createSelectedRigId, setCreateSelectedRigId] = useState('none');
    const [createSelectedRotatorId, setCreateSelectedRotatorId] = useState('none');
    const [createDialogError, setCreateDialogError] = useState('');
    const [catalogLoading, setCatalogLoading] = useState(false);
    const [catalogError, setCatalogError] = useState('');
    const [catalogEntries, setCatalogEntries] = useState([]);
    const [bodyCatalogLoading, setBodyCatalogLoading] = useState(false);
    const [bodyCatalogError, setBodyCatalogError] = useState('');
    const [bodyCatalogEntries, setBodyCatalogEntries] = useState([]);
    const targetTrackerInstances = useMemo(
        () => trackerInstances.filter((instance) => parseTargetSlotNumber(instance?.tracker_id) !== null),
        [trackerInstances]
    );
    const missionCatalogEntries = useMemo(
        () => (Array.isArray(catalogEntries) ? catalogEntries : [])
            .map((entry) => ({
                command: String(entry?.command || '').trim(),
                display_name: String(entry?.display_name || entry?.command || '').trim(),
                mission_status: String(entry?.mission_status || 'unknown').trim().toLowerCase(),
                status_label: String(entry?.status_label || '').trim(),
            }))
            .filter((entry) => entry.command.length > 0),
        [catalogEntries]
    );
    const monitoredMissionCommands = useMemo(
        () => (Array.isArray(monitoredCelestialRows) ? monitoredCelestialRows : [])
            .filter((entry) => String(entry?.targetType || entry?.target_type || '').toLowerCase() === TARGET_TYPES.MISSION)
            .filter((entry) => String(entry?.command || '').trim().length > 0)
            .filter((entry) => entry?.enabled !== false)
            .map((entry) => String(entry?.command || '').trim().toLowerCase()),
        [monitoredCelestialRows],
    );
    const monitoredBodyIds = useMemo(
        () => (Array.isArray(monitoredCelestialRows) ? monitoredCelestialRows : [])
            .filter((entry) => String(entry?.targetType || entry?.target_type || '').toLowerCase() === TARGET_TYPES.BODY)
            .filter((entry) => String(entry?.bodyId || entry?.body_id || '').trim().length > 0)
            .filter((entry) => entry?.enabled !== false)
            .map((entry) => String(entry?.bodyId || entry?.body_id || '').trim().toLowerCase()),
        [monitoredCelestialRows],
    );
    const bodyCatalogOptions = useMemo(
        () => (Array.isArray(bodyCatalogEntries) ? bodyCatalogEntries : [])
            .map((entry) => ({
                body_id: String(entry?.body_id || '').trim().toLowerCase(),
                name: String(entry?.name || entry?.body_id || '').trim(),
                body_type: String(entry?.body_type || '').trim(),
                parent_body_id: String(entry?.parent_body_id || '').trim().toLowerCase(),
            }))
            .filter((entry) => entry.body_id.length > 0),
        [bodyCatalogEntries]
    );
    const trackingStateRef = useRef(trackingState);
    useEffect(() => {
        trackingStateRef.current = trackingState;
    }, [trackingState]);
    const runningObservationTrackerIds = useMemo(() => {
        const running = schedulerObservations.filter((obs) => obs?.status === 'running');
        return new Set(
            running
                .map((obs) => resolveObservationTrackerId(obs))
                .filter((value) => value.length > 0)
        );
    }, [schedulerObservations]);
    const tabTrackerInstances = useMemo(() => {
        return trackerInstances.filter((instance) => {
            const instanceTrackerId = String(instance?.tracker_id || '').trim();
            if (!instanceTrackerId) return false;
            if (parseTargetSlotNumber(instanceTrackerId) !== null) return true;
            return runningObservationTrackerIds.has(instanceTrackerId);
        });
    }, [trackerInstances, runningObservationTrackerIds]);

    const emitTrackingErrorToast = useCallback((error, fallbackMessage, options = {}) => {
        const suppressLimitToast = Boolean(options?.suppressLimitToast);
        const suppressToast = Boolean(options?.suppressToast);
        const errorCode = String(error?.error || error?.code || '').trim();
        let message = '';
        if (errorCode === 'tracker_slot_limit_reached') {
            const limit = Number(error?.data?.limit);
            if (Number.isFinite(limit) && limit > 0) {
                message = `Target limit reached (${limit}). Delete an existing target first.`;
            } else {
                message = 'Target limit reached. Delete an existing target first.';
            }
            if (!suppressLimitToast && !suppressToast) {
                toast.error(message);
            }
            return message;
        } else {
            message = error?.message || String(error) || fallbackMessage;
        }
        if (!suppressToast) {
            toast.error(message);
        }
        return message;
    }, []);

    useEffect(() => {
        if (!socket) {
            return;
        }
        let active = true;
        setCatalogLoading(true);
        setCatalogError('');
        socket.emit("api.call", {
  cmd: 'get-spacecraft-index',
  data: {
    limit: 1000
  }
}, response => {
  if (!active) return;
  if (response?.success) {
    setCatalogEntries(Array.isArray(response?.data) ? response.data : []);
    setCatalogError('');
  } else {
    setCatalogEntries([]);
    setCatalogError(response?.error || 'Failed to load mission catalog.');
  }
  setCatalogLoading(false);
});
        return () => {
            active = false;
        };
    }, [socket]);

    useEffect(() => {
        if (!socket) {
            return;
        }
        dispatch(fetchMonitoredCelestial({ socket }));
    }, [dispatch, socket]);

    useEffect(() => {
        if (!socket) {
            return;
        }
        let active = true;
        setBodyCatalogLoading(true);
        setBodyCatalogError('');
        socket.emit("api.call", {
  cmd: 'get-celestial-body-catalog',
  data: null
}, response => {
  if (!active) return;
  if (response?.success) {
    setBodyCatalogEntries(Array.isArray(response?.data) ? response.data : []);
    setBodyCatalogError('');
  } else {
    setBodyCatalogEntries([]);
    setBodyCatalogError(response?.error || 'Failed to load celestial body catalog.');
  }
  setBodyCatalogLoading(false);
});
        return () => {
            active = false;
        };
    }, [socket]);

    const handleTargetTabChange = useCallback((event, value) => {
        if (!value) return;
        if (value === ADD_TARGET_TAB_VALUE) {
            setCreateDialogOpen(true);
            return;
        }
        dispatch(setTrackerId(value));
    }, [dispatch]);

    const handleDeleteTarget = useCallback((event, targetOption) => {
        event.preventDefault();
        event.stopPropagation();
        const trackerIdToDelete = targetOption?.trackerId;
        if (!trackerIdToDelete) {
            return;
        }
        const targetNumber = Number(targetOption?.targetNumber || 0);
        const linkedRunning = (targetOption?.linkedObservations || [])
            .filter((obs) => obs?.status === 'running');
        if (targetOption?.hasActiveObservation && linkedRunning.length > 0) {
            setPendingAbortObservation(linkedRunning[0]);
            setAbortDialogOpen(true);
            return;
        }
        setPendingDeleteTarget({ trackerId: trackerIdToDelete, targetNumber });
        setDeleteDialogOpen(true);
    }, []);

    const handleConfirmAbortObservation = useCallback(async () => {
        if (!pendingAbortObservation?.id || !socket) {
            setAbortDialogOpen(false);
            setPendingAbortObservation(null);
            return;
        }
        try {
            setAbortObservationBusy(true);
            await dispatch(cancelRunningObservation({ socket, id: pendingAbortObservation.id })).unwrap();
            setAbortDialogOpen(false);
            setPendingAbortObservation(null);
            setAbortObservationBusy(false);
        } catch (error) {
            toast.error(error?.message || String(error) || 'Failed to abort observation');
            setAbortObservationBusy(false);
        }
    }, [dispatch, pendingAbortObservation, socket]);

    const handleConfirmDeleteTarget = useCallback(async () => {
        const trackerIdToDelete = pendingDeleteTarget?.trackerId;
        if (!trackerIdToDelete) {
            setDeleteDialogOpen(false);
            setPendingDeleteTarget(null);
            setDeleteTargetBusy(false);
            return;
        }
        try {
            setDeleteTargetBusy(true);
            await dispatch(deleteTrackerInstance({ socket, trackerId: trackerIdToDelete })).unwrap();
            setDeleteDialogOpen(false);
            setPendingDeleteTarget(null);
            setDeleteTargetBusy(false);
        } catch (error) {
            toast.error(error?.message || String(error) || 'Failed to delete target');
            setDeleteDialogOpen(false);
            setPendingDeleteTarget(null);
            setDeleteTargetBusy(false);
        }
    }, [dispatch, pendingDeleteTarget, socket]);

    const getTransmittersFromSatellite = useCallback((satellite) => {
        if (!satellite || typeof satellite !== 'object') {
            return [];
        }
        if (Array.isArray(satellite.transmitters)) {
            return satellite.transmitters;
        }
        return [];
    }, []);

    const resetCreateDialogState = useCallback(() => {
        setCreateTargetType(TARGET_TYPES.SATELLITE);
        setCreateSearchOpen(false);
        setCreateSearchOptions([]);
        setCreateSearchLoading(false);
        setCreateSelectedSatellite(null);
        setCreateSelectedMission(null);
        setCreateSelectedBodyId('');
        setCreateSelectedRigId('none');
        setCreateSelectedRotatorId('none');
        setCreateDialogError('');
        setCreateTargetBusy(false);
    }, []);

    const handleOpenCreateDialog = useCallback(() => {
        setCreateDialogOpen(true);
    }, []);

    const handleCloseCreateDialog = useCallback(() => {
        if (createTargetBusy) return;
        setCreateDialogOpen(false);
        resetCreateDialogState();
    }, [createTargetBusy, resetCreateDialogState]);

    const handleCreateSearchInputChange = useCallback((event, value) => {
        const keyword = String(value || '').trim();
        if (keyword.length < 3) {
            setCreateSearchOptions([]);
            setCreateSearchLoading(false);
            return;
        }
        setCreateSearchLoading(true);
        socket.emit("api.call", {
  cmd: 'get-satellite-search',
  data: keyword
}, response => {
  if (response?.success) {
    setCreateSearchOptions(Array.isArray(response?.data) ? response.data : []);
  } else {
    setCreateSearchOptions([]);
    toast.error(response?.error || 'Error searching for satellites');
  }
  setCreateSearchLoading(false);
});
    }, [socket]);

    const buildTargetTrackingPatch = useCallback((target) => {
        const targetType = target?.targetType || TARGET_TYPES.SATELLITE;
        const targetName = String(target?.targetName || '').trim();
        if (targetType === TARGET_TYPES.MISSION) {
            const mission_id_value = String(target?.mission_id || '').trim().toLowerCase();
            const normalizedMissionId = mission_id_value.startsWith('mission:')
                ? mission_id_value.slice('mission:'.length)
                : (mission_id_value.includes(':') ? '' : mission_id_value);
            return {
                target_type: TARGET_TYPES.MISSION,
                target_name: targetName || String(target?.command || '').trim(),
                mission_id: normalizedMissionId || null,
                command: String(target?.command || '').trim(),
                body_id: null,
                norad_id: null,
                group_id: null,
            };
        }
        if (targetType === TARGET_TYPES.BODY) {
            return {
                target_type: TARGET_TYPES.BODY,
                target_name: targetName || String(target?.bodyId || '').trim().toLowerCase(),
                mission_id: null,
                body_id: String(target?.bodyId || '').trim().toLowerCase(),
                command: null,
                norad_id: null,
                group_id: null,
            };
        }
        return {
            target_type: TARGET_TYPES.SATELLITE,
            target_name: targetName || String(target?.noradId || '').trim(),
            mission_id: null,
            norad_id: target?.noradId,
            group_id: target?.groupId || '',
            command: null,
            body_id: null,
        };
    }, []);

    const handleRetargetTarget = useCallback(async (target) => {
        const targetType = target?.targetType || TARGET_TYPES.SATELLITE;
        if (targetType === TARGET_TYPES.SATELLITE && !target?.noradId) {
            return;
        }
        if (targetType === TARGET_TYPES.MISSION && !String(target?.command || '').trim()) {
            return;
        }
        if (targetType === TARGET_TYPES.BODY && !String(target?.bodyId || '').trim()) {
            return;
        }

        await requestRotatorForTarget(target?.targetName || 'target', {
            onSubmit: async (selectedAssignment) => {
                if (!selectedAssignment) {
                    return { success: false };
                }
                const assignmentAction = String(selectedAssignment?.action || 'retarget_current_slot');
                const isCreateNewSlot = assignmentAction === 'create_new_slot';
                const selectedTrackerId = String(selectedAssignment?.trackerId || '');
                const rotatorId = String(selectedAssignment?.rotatorId || 'none');
                const assignmentRigId = String(selectedAssignment?.rigId || 'none');
                if (!selectedTrackerId) {
                    return { success: false, errorMessage: 'Missing target tracker slot.' };
                }

                const selectedTrackerInstance = trackerInstances.find(
                    (instance) => String(instance?.tracker_id || '') === selectedTrackerId
                );
                const selectedTrackerView = trackerViews?.[selectedTrackerId] || {};
                const selectedTrackerState = selectedTrackerView?.trackingState || selectedTrackerInstance?.tracking_state || {};
                const selectedGroupId = targetType === TARGET_TYPES.SATELLITE
                    ? (target?.groupId || selectedTrackerState?.group_id || trackingState?.group_id || '')
                    : null;
                const nextTransmitters = Array.isArray(target?.transmitters) ? target.transmitters : [];
                const nextRigId = isCreateNewSlot
                    ? assignmentRigId
                    : String(
                        selectedTrackerView?.selectedRadioRig
                        ?? selectedTrackerState?.rig_id
                        ?? assignmentRigId
                        ?? 'none'
                    );
                const nextRotatorId = isCreateNewSlot ? 'none' : rotatorId;
                const nextTransmitterId = isCreateNewSlot || targetType !== TARGET_TYPES.SATELLITE
                    ? 'none'
                    : String(selectedTrackerState?.transmitter_id || 'none');
                const targetPatch = buildTargetTrackingPatch({
                    ...target,
                    groupId: selectedGroupId,
                });

                const data = isCreateNewSlot
                    ? {
                        tracker_id: selectedTrackerId,
                        ...targetPatch,
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
                        tracker_id: selectedTrackerId,
                        ...targetPatch,
                        rig_id: nextRigId,
                        rotator_id: nextRotatorId,
                        transmitter_id: nextTransmitterId,
                    };

                try {
                    await dispatch(setTrackingStateInBackend({ socket, data })).unwrap();
                    dispatch(setTrackerId(selectedTrackerId));
                    dispatch(setSatelliteId(targetType === TARGET_TYPES.SATELLITE ? target?.noradId : ''));
                    dispatch(setRotator({ value: nextRotatorId, trackerId: selectedTrackerId }));
                    dispatch(setRadioRig({ value: nextRigId, trackerId: selectedTrackerId }));
                    dispatch(setAvailableTransmitters(nextTransmitters));
                    return { success: true };
                } catch (error) {
                    const errorCode = String(error?.error || error?.code || '').trim();
                    if (errorCode === 'tracker_slot_limit_reached') {
                        const limitMessage = emitTrackingErrorToast(
                            error,
                            'Failed to set target',
                            { suppressLimitToast: true, suppressToast: true },
                        );
                        return { success: false, errorMessage: limitMessage };
                    }
                    const message = emitTrackingErrorToast(error, 'Failed to set target');
                    return { success: false, errorMessage: message };
                }
            },
        });
    }, [
        buildTargetTrackingPatch,
        dispatch,
        emitTrackingErrorToast,
        requestRotatorForTarget,
        socket,
        trackerInstances,
        trackerViews,
        trackingState,
    ]);
    const handleRetargetTargetRef = useRef(handleRetargetTarget);
    useEffect(() => {
        handleRetargetTargetRef.current = handleRetargetTarget;
    }, [handleRetargetTarget]);

    const handleCreateTargetSubmit = useCallback(async () => {
        setCreateDialogError('');
        const trackerSlotId = deriveNextTrackerSlotId(targetTrackerInstances);
        const normalizedRigId = createSelectedRigId || 'none';
        const normalizedRotatorId = createSelectedRotatorId || 'none';

        let payloadTarget = {};
        let nextTransmitters = [];
        let nextSatelliteId = '';

        if (createTargetType === TARGET_TYPES.SATELLITE) {
            if (!createSelectedSatellite?.norad_id) {
                toast.error('Please select a satellite first');
                return;
            }
            const selectedGroupId = createSelectedSatellite?.groups?.[0]?.id || trackingState?.group_id || '';
            if (!selectedGroupId) {
                toast.error('Selected satellite has no group mapping');
                return;
            }
            payloadTarget = buildTargetTrackingPatch({
                targetType: TARGET_TYPES.SATELLITE,
                noradId: createSelectedSatellite.norad_id,
                groupId: selectedGroupId,
                targetName: String(createSelectedSatellite?.name || createSelectedSatellite?.norad_id || '').trim(),
            });
            nextTransmitters = getTransmittersFromSatellite(createSelectedSatellite);
            nextSatelliteId = createSelectedSatellite.norad_id;
        } else if (createTargetType === TARGET_TYPES.MISSION) {
            const missionCommand = String(createSelectedMission?.command || '').trim();
            if (!missionCommand) {
                toast.error('Please select a mission target first');
                return;
            }
            payloadTarget = buildTargetTrackingPatch({
                targetType: TARGET_TYPES.MISSION,
                command: missionCommand,
                mission_id: String(createSelectedMission?.mission_id || '')
                    .replace(/^mission:/i, '')
                    .trim()
                    .toLowerCase(),
                targetName: String(
                    createSelectedMission?.target_name
                    || createSelectedMission?.display_name
                    || missionCommand
                ).trim(),
            });
            nextTransmitters = Array.isArray(createSelectedMission?.transmitters)
                ? createSelectedMission.transmitters
                : [];
        } else {
            const bodyId = String(createSelectedBodyId || '').trim().toLowerCase();
            if (!bodyId) {
                toast.error('Please select a body target first');
                return;
            }
            payloadTarget = buildTargetTrackingPatch({
                targetType: TARGET_TYPES.BODY,
                bodyId,
                targetName: String(
                    bodyCatalogOptions.find((entry) => String(entry?.body_id || '').trim().toLowerCase() === bodyId)?.name
                    || bodyId
                ).trim(),
            });
        }

        const payload = {
            tracker_id: trackerSlotId,
            ...payloadTarget,
            rig_id: normalizedRigId,
            rotator_id: normalizedRotatorId,
            transmitter_id: 'none',
            rig_state: 'disconnected',
            rotator_state: 'disconnected',
            rig_vfo: 'none',
            vfo1: 'uplink',
            vfo2: 'downlink',
        };

        try {
            setCreateTargetBusy(true);
            dispatch(setTrackerId(trackerSlotId));
            dispatch(setSatelliteId(nextSatelliteId));
            dispatch(setRotator({ value: normalizedRotatorId, trackerId: trackerSlotId }));
            dispatch(setRadioRig({ value: normalizedRigId, trackerId: trackerSlotId }));
            dispatch(setAvailableTransmitters(nextTransmitters));
            await dispatch(setTrackingStateInBackend({ socket, data: payload })).unwrap();
            setCreateDialogOpen(false);
            resetCreateDialogState();
        } catch (error) {
            const errorMessage = emitTrackingErrorToast(
                error,
                'Failed to create target',
                { suppressLimitToast: true },
            );
            setCreateDialogError(String(errorMessage || 'Failed to create target'));
            setCreateTargetBusy(false);
        }
    }, [
        buildTargetTrackingPatch,
        createSelectedBodyId,
        createSelectedMission,
        createSelectedRigId,
        createSelectedRotatorId,
        createSelectedSatellite,
        createTargetType,
        dispatch,
        emitTrackingErrorToast,
        getTransmittersFromSatellite,
        resetCreateDialogState,
        socket,
        targetTrackerInstances,
        trackingState,
        bodyCatalogOptions,
    ]);

    const handleRetargetSearchSelect = useCallback(async (targetOption) => {
        const targetType = String(targetOption?.target_type || targetOption?.targetType || TARGET_TYPES.SATELLITE)
            .trim()
            .toLowerCase();

        if (targetType === TARGET_TYPES.MISSION) {
            const command = String(targetOption?.command || '').trim();
            if (!command) {
                return;
            }
            await handleRetargetTargetRef.current({
                targetType: TARGET_TYPES.MISSION,
                targetName: String(targetOption?.target_name || targetOption?.display_name || command).trim(),
                mission_id: String(targetOption?.mission_id || '')
                    .replace(/^mission:/i, '')
                    .trim()
                    .toLowerCase(),
                command,
                transmitters: Array.isArray(targetOption?.transmitters) ? targetOption.transmitters : [],
            });
            return;
        }

        if (targetType === TARGET_TYPES.BODY) {
            const normalizedBodyId = String(targetOption?.body_id || targetOption?.bodyId || '').trim().toLowerCase();
            if (!normalizedBodyId) {
                return;
            }
            await handleRetargetTargetRef.current({
                targetType: TARGET_TYPES.BODY,
                targetName: String(targetOption?.target_name || targetOption?.name || normalizedBodyId).trim(),
                bodyId: normalizedBodyId,
                transmitters: Array.isArray(targetOption?.transmitters) ? targetOption.transmitters : [],
            });
            return;
        }

        const noradId = targetOption?.norad_id;
        if (!noradId) {
            return;
        }
        const selectedGroupId = targetOption?.groups?.[0]?.id || trackingStateRef.current?.group_id || '';
        await handleRetargetTargetRef.current({
            targetType: TARGET_TYPES.SATELLITE,
            targetName: String(targetOption?.target_name || targetOption?.name || noradId).trim(),
            noradId,
            groupId: selectedGroupId,
            transmitters: getTransmittersFromSatellite(targetOption),
        });
    }, [getTransmittersFromSatellite]);

    const targetOptions = useMemo(() => tabTrackerInstances.map((instance, index) => {
        const instanceTrackerId = instance?.tracker_id || '';
        const parsedTargetNumber = parseTargetSlotNumber(instanceTrackerId);
        const instanceTargetNumber = Number(instance?.target_number);
        const targetNumber = parsedTargetNumber != null
            ? Number(parsedTargetNumber)
            : (Number.isFinite(instanceTargetNumber) && instanceTargetNumber > 0
                ? instanceTargetNumber
                : null);
        const isObservationTracker = parsedTargetNumber == null;
        const view = trackerViews?.[instanceTrackerId] || {};
        const effectiveTrackingState = view?.trackingState || instance?.tracking_state || {};
        const targetType = normalizeTargetType(effectiveTrackingState);
        const rotatorData = view?.rotatorData || {};
        const rigData = view?.rigData || {};
        const targetName = resolveTargetDisplayName({
            trackingState: effectiveTrackingState,
            satelliteDetails: view?.satelliteData?.details || {},
            monitoredRows: monitoredCelestialRows,
        }) || 'No target';
        const targetIdentifier = getTrackingTargetIdentifier(effectiveTrackingState) || 'none';
        const rotatorId = view?.selectedRotator || instance?.rotator_id || effectiveTrackingState?.rotator_id || 'none';
        const normalizedTabRotatorId = normalizeAssignedResourceId(rotatorId);
        const rigId = view?.selectedRadioRig || instance?.rig_id || effectiveTrackingState?.rig_id || 'none';
        const rotatorName = String(rotatorId) === 'none'
            ? 'No rotator'
            : (rotatorRows.find((row) => String(row.id) === String(rotatorId))?.name || String(rotatorId));
        const isTracking = Boolean(rigData?.tracking || rotatorData?.tracking);
        const satAz = Number.isFinite(view?.satelliteData?.position?.az) ? view.satelliteData.position.az : null;
        const satEl = Number.isFinite(view?.satelliteData?.position?.el) ? view.satelliteData.position.el : null;
        const tabHardwareLedStatus = resolveTabHardwareLedStatus({
            rotatorId,
            rigId,
            rotatorData,
            rigData,
            trackingState: effectiveTrackingState,
        });
        const tabHardwareLed = {
            source: tabHardwareLedStatus.source,
            status: tabHardwareLedStatus.status,
            ...resolveTabLedPresentation(tabHardwareLedStatus),
        };
        const linkedObservations = schedulerObservations
            .filter((obs) => obs?.enabled)
            .filter((obs) => {
                // Observation ownership should follow tracker/rotator assignment only.
                // Matching by NORAD can incorrectly mark multiple same-satellite target tabs.
                const obsRotatorId = normalizeAssignedResourceId(obs?.rotator?.id || obs?.rotator_id);
                if (obsRotatorId) {
                    return obsRotatorId === normalizedTabRotatorId;
                }
                const obsTrackerId = resolveObservationTrackerId(obs);
                if (obsTrackerId) {
                    return obsTrackerId === String(instanceTrackerId);
                }
                return false;
            });
        const runningObs = linkedObservations.filter((obs) => obs?.status === 'running');
        const upcomingObs = linkedObservations.filter((obs) => obs?.status === 'scheduled');
        return {
            trackerId: instanceTrackerId,
            targetNumber,
            isObservationTracker,
            targetType,
            targetName,
            targetIdentifier,
            rotatorId,
            rigId,
            rotatorName,
            isTracking,
            tabHardwareLed,
            satAz,
            satEl,
            runningObsCount: runningObs.length,
            upcomingObsCount: upcomingObs.length,
            hasActiveObservation: runningObs.length > 0,
            hasScheduledObservation: upcomingObs.length > 0,
            linkedObservations,
        };
    }), [tabTrackerInstances, trackerViews, schedulerObservations, rotatorRows, monitoredCelestialRows]);

    const tabValue = targetOptions.some((option) => option.trackerId === trackerId)
        ? trackerId
        : (targetOptions[0]?.trackerId || false);
    const activeTargetOption = useMemo(
        () => targetOptions.find((option) => option.trackerId === tabValue) || null,
        [targetOptions, tabValue]
    );
    const disableRetargetSearch = Boolean(activeTargetOption?.hasActiveObservation);
    const nextTargetSlotId = useMemo(
        () => deriveNextTrackerSlotId(targetTrackerInstances),
        [targetTrackerInstances]
    );
    const hardwareUsageRows = useMemo(() => {
        return trackerInstances.map((instance, index) => {
            const instanceTrackerId = String(instance?.tracker_id || '');
            const targetNumber = Number(instance?.target_number || (index + 1));
            const tracking = instance?.tracking_state || {};
            return {
                trackerId: instanceTrackerId,
                targetNumber,
                rigId: String(tracking?.rig_id || 'none'),
                rotatorId: String(instance?.rotator_id || tracking?.rotator_id || 'none'),
            };
        });
    }, [trackerInstances]);
    const rigUsageById = useMemo(() => {
        return hardwareUsageRows.reduce((acc, row) => {
            if (!row.rigId || row.rigId === 'none') return acc;
            if (!acc[row.rigId]) acc[row.rigId] = [];
            acc[row.rigId].push(row);
            return acc;
        }, {});
    }, [hardwareUsageRows]);
    const rotatorUsageById = useMemo(() => {
        return hardwareUsageRows.reduce((acc, row) => {
            if (!row.rotatorId || row.rotatorId === 'none') return acc;
            if (!acc[row.rotatorId]) acc[row.rotatorId] = [];
            acc[row.rotatorId].push(row);
            return acc;
        }, {});
    }, [hardwareUsageRows]);

    return (
        <>
        {rotatorSelectionDialog}
        <Dialog
            open={deleteDialogOpen}
            onClose={() => {
                if (deleteTargetBusy) return;
                setDeleteDialogOpen(false);
                setPendingDeleteTarget(null);
                setDeleteTargetBusy(false);
            }}
            fullWidth
            maxWidth="xs"
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
                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
                    borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                    fontSize: '1.1rem',
                    fontWeight: 'bold',
                    py: 2,
                }}
            >
                Delete Target
            </DialogTitle>
            <DialogContent sx={{ px: 3, pb: 2.5 }}>
                <Box sx={{ pt: 2 }}>
                    <DialogContentText sx={{ mb: 1 }}>
                        {`Delete ${pendingDeleteTarget ? `Target ${pendingDeleteTarget.targetNumber}` : 'this target'}?`}
                    </DialogContentText>
                    <DialogContentText color="text.secondary">
                        This will remove the target tracking state and stop its tracker process.
                    </DialogContentText>
                    {deleteTargetBusy && (
                        <Box sx={{ mt: 1.2, display: 'flex', alignItems: 'center', gap: 1 }}>
                            <CircularProgress size={16} />
                            <Typography variant="caption" color="text.secondary">
                                Deleting target...
                            </Typography>
                        </Box>
                    )}
                </Box>
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
                    disabled={deleteTargetBusy}
                    onClick={() => {
                        setDeleteDialogOpen(false);
                        setPendingDeleteTarget(null);
                        setDeleteTargetBusy(false);
                    }}
                >
                    Cancel
                </Button>
                <Button
                    color="error"
                    variant="contained"
                    disabled={deleteTargetBusy}
                    onClick={handleConfirmDeleteTarget}
                    startIcon={deleteTargetBusy ? <CircularProgress color="inherit" size={16} /> : null}
                >
                    {deleteTargetBusy ? 'Deleting...' : 'Delete'}
                </Button>
            </DialogActions>
        </Dialog>
        <Dialog
            open={abortDialogOpen}
            onClose={() => {
                if (abortObservationBusy) return;
                setAbortDialogOpen(false);
                setPendingAbortObservation(null);
            }}
            fullWidth
            maxWidth="xs"
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
                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
                    borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                    fontSize: '1.1rem',
                    fontWeight: 'bold',
                    py: 2,
                }}
            >
                {pendingAbortObservation?.status === 'running' ? 'Stop Observation' : 'Abort Observation'}
            </DialogTitle>
            <DialogContent sx={{ px: 3, pb: 2.5 }}>
                <Box sx={{ pt: 2 }}>
                    <DialogContentText sx={{ mb: 1 }}>
                        {pendingAbortObservation?.status === 'running'
                            ? <>Are you sure you want to stop the observation <strong>{pendingAbortObservation?.satellite?.name || 'Unknown'}</strong>?</>
                            : <>Are you sure you want to abort the observation <strong>{pendingAbortObservation?.satellite?.name || 'Unknown'}</strong>?</>
                        }
                    </DialogContentText>
                    <DialogContentText color="text.secondary">
                        {pendingAbortObservation?.status === 'running'
                            ? 'This will immediately stop the observation and remove all scheduled jobs.'
                            : 'This will cancel the scheduled observation and remove all scheduled jobs.'
                        }
                    </DialogContentText>
                    {abortObservationBusy && (
                        <Box sx={{ mt: 1.2, display: 'flex', alignItems: 'center', gap: 1 }}>
                            <CircularProgress size={16} />
                            <Typography variant="caption" color="text.secondary">
                                Processing observation...
                            </Typography>
                        </Box>
                    )}
                </Box>
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
                    disabled={abortObservationBusy}
                    onClick={() => {
                        setAbortDialogOpen(false);
                        setPendingAbortObservation(null);
                    }}
                >
                    Cancel
                </Button>
                <Button
                    color="error"
                    variant="contained"
                    disabled={abortObservationBusy}
                    onClick={handleConfirmAbortObservation}
                    startIcon={abortObservationBusy ? <CircularProgress color="inherit" size={16} /> : null}
                >
                    {abortObservationBusy
                        ? (pendingAbortObservation?.status === 'running' ? 'Stopping...' : 'Aborting...')
                        : (pendingAbortObservation?.status === 'running' ? 'Stop' : 'Abort')}
                </Button>
            </DialogActions>
        </Dialog>
        <Dialog
            open={createDialogOpen}
            onClose={handleCloseCreateDialog}
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
                            Add New Target
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.2 }}>
                            Configure target and hardware in two quick steps
                        </Typography>
                    </Box>
                    <Chip
                        size="small"
                        color="info"
                        variant="outlined"
                        label={`Slot ${nextTargetSlotId}`}
                        sx={{ fontFamily: 'monospace', fontSize: '0.68rem', fontWeight: 700 }}
                    />
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
                        <Typography variant="overline" sx={{ fontWeight: 800, color: 'primary.main', letterSpacing: 0.4 }}>
                            Step 1 · Target
                        </Typography>
                        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mb: 1 }}>
                            Select a target type and choose a satellite, mission, or body.
                        </Typography>
                        <FormControl size="small" fullWidth sx={{ mb: 1 }}>
                            <InputLabel id="create-target-type-label">Target Type</InputLabel>
                            <Select
                                labelId="create-target-type-label"
                                value={createTargetType}
                                label="Target Type"
                                onChange={(event) => {
                                    const nextType = String(event.target.value || TARGET_TYPES.SATELLITE);
                                    setCreateTargetType(nextType);
                                    setCreateDialogError('');
                                    setCreateSelectedSatellite(null);
                                    setCreateSelectedMission(null);
                                    setCreateSelectedBodyId('');
                                }}
                            >
                                <MenuItem value={TARGET_TYPES.SATELLITE}>Satellite</MenuItem>
                                <MenuItem value={TARGET_TYPES.MISSION}>Mission</MenuItem>
                                <MenuItem value={TARGET_TYPES.BODY}>Body</MenuItem>
                            </Select>
                        </FormControl>
                        {createTargetType === TARGET_TYPES.SATELLITE && (
                            <Autocomplete
                                size="small"
                                open={createSearchOpen}
                                onOpen={() => setCreateSearchOpen(true)}
                                onClose={() => setCreateSearchOpen(false)}
                                options={createSearchOptions}
                                loading={createSearchLoading}
                                value={createSelectedSatellite}
                                onInputChange={handleCreateSearchInputChange}
                                onChange={(event, value) => {
                                    setCreateSelectedSatellite(value || null);
                                    if (createDialogError) {
                                        setCreateDialogError('');
                                    }
                                }}
                                isOptionEqualToValue={(option, value) => option?.norad_id === value?.norad_id}
                                getOptionLabel={(option) => `${option?.norad_id || ''} - ${option?.name || ''}`}
                                renderInput={(params) => (
                                    <TextField
                                        {...params}
                                        label="Satellite Target"
                                        placeholder="Search satellite by name or NORAD ID"
                                        slotProps={{
                                            input: {
                                                ...params.InputProps,
                                                endAdornment: (
                                                    <>
                                                        {createSearchLoading ? <CircularProgress color="inherit" size={18} /> : null}
                                                        {params.InputProps.endAdornment}
                                                    </>
                                                ),
                                            },
                                        }}
                                    />
                                )}
                            />
                        )}
                        {createTargetType === TARGET_TYPES.MISSION && (
                            <Autocomplete
                                size="small"
                                options={missionCatalogEntries}
                                loading={catalogLoading}
                                value={createSelectedMission}
                                onChange={(event, value) => {
                                    setCreateSelectedMission(value || null);
                                    if (createDialogError) {
                                        setCreateDialogError('');
                                    }
                                }}
                                isOptionEqualToValue={(option, value) => option?.command === value?.command}
                                getOptionLabel={(option) => option?.display_name || option?.command || ''}
                                filterOptions={(options, state) => {
                                    const keyword = String(state?.inputValue || '').trim().toLowerCase();
                                    if (!keyword) {
                                        return options;
                                    }
                                    return options.filter((option) => {
                                        const name = String(option?.display_name || '').trim().toLowerCase();
                                        const command = String(option?.command || '').trim().toLowerCase();
                                        return name.includes(keyword) || command.includes(keyword);
                                    });
                                }}
                                renderOption={(props, option) => (
                                    <Box component="li" {...props} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                                        <Typography variant="body2" noWrap>{option?.display_name || option?.command}</Typography>
                                        <Chip
                                            size="small"
                                            label={option?.command || '-'}
                                            variant="outlined"
                                            sx={{ height: 18, fontSize: '0.62rem', fontFamily: 'monospace', flexShrink: 0 }}
                                        />
                                    </Box>
                                )}
                                renderInput={(params) => (
                                    <TextField
                                        {...params}
                                        label="Mission Target"
                                        placeholder="Search mission name or command"
                                        helperText={catalogError || ''}
                                        slotProps={{
                                            input: {
                                                ...params.InputProps,
                                                endAdornment: (
                                                    <>
                                                        {catalogLoading ? <CircularProgress color="inherit" size={18} /> : null}
                                                        {params.InputProps.endAdornment}
                                                    </>
                                                ),
                                            },
                                        }}
                                    />
                                )}
                            />
                        )}
                        {createTargetType === TARGET_TYPES.BODY && (
                            <Autocomplete
                                size="small"
                                options={bodyCatalogOptions}
                                loading={bodyCatalogLoading}
                                value={bodyCatalogOptions.find((entry) => entry.body_id === createSelectedBodyId) || null}
                                onChange={(event, value) => {
                                    setCreateSelectedBodyId(String(value?.body_id || '').toLowerCase());
                                    if (createDialogError) {
                                        setCreateDialogError('');
                                    }
                                }}
                                isOptionEqualToValue={(option, value) => option?.body_id === value?.body_id}
                                getOptionLabel={(option) => option?.name || option?.body_id || ''}
                                filterOptions={(options, state) => {
                                    const keyword = String(state?.inputValue || '').trim().toLowerCase();
                                    if (!keyword) {
                                        return options;
                                    }
                                    return options.filter((option) => {
                                        const name = String(option?.name || '').trim().toLowerCase();
                                        const bodyId = String(option?.body_id || '').trim().toLowerCase();
                                        const bodyType = String(option?.body_type || '').trim().toLowerCase();
                                        return (
                                            name.includes(keyword)
                                            || bodyId.includes(keyword)
                                            || bodyType.includes(keyword)
                                        );
                                    });
                                }}
                                renderOption={(props, option) => (
                                    <Box component="li" {...props} sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                                        <Typography variant="body2" noWrap sx={{ flex: 1 }}>
                                            {option?.name || option?.body_id}
                                        </Typography>
                                        <Chip
                                            size="small"
                                            label={option?.body_id || '-'}
                                            variant="outlined"
                                            sx={{ height: 18, fontSize: '0.62rem', fontFamily: 'monospace', flexShrink: 0 }}
                                        />
                                    </Box>
                                )}
                                renderInput={(params) => (
                                    <TextField
                                        {...params}
                                        label="Body Target"
                                        placeholder="Search body name or ID"
                                        helperText={bodyCatalogError || ''}
                                        slotProps={{
                                            input: {
                                                ...params.InputProps,
                                                endAdornment: (
                                                    <>
                                                        {bodyCatalogLoading ? <CircularProgress color="inherit" size={18} /> : null}
                                                        {params.InputProps.endAdornment}
                                                    </>
                                                ),
                                            },
                                        }}
                                    />
                                )}
                            />
                        )}
                        {createTargetType === TARGET_TYPES.BODY && bodyCatalogError && (
                            <Typography variant="caption" color="error" sx={{ mt: 0.5 }}>
                                {bodyCatalogError}
                            </Typography>
                        )}
                        {createTargetType === TARGET_TYPES.BODY && !bodyCatalogError && bodyCatalogLoading && (
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                                Loading body catalog...
                            </Typography>
                        )}
                    </Box>

                    <Box
                        sx={{
                            p: 1.25,
                            borderRadius: 1.5,
                            background: (theme) => `linear-gradient(135deg, ${theme.palette.secondary.main}1A 0%, ${theme.palette.secondary.main}08 100%)`,
                        }}
                    >
                        <Typography variant="overline" sx={{ fontWeight: 800, color: 'secondary.main', letterSpacing: 0.4 }}>
                            Step 2 · Hardware (Optional)
                        </Typography>
                        <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary', mb: 1 }}>
                            Assign hardware now, or leave as none.
                        </Typography>

                    <FormControl
                        size="small"
                        fullWidth
                        variant="outlined"
                        sx={{ minWidth: 200, mt: 0, mb: 1 }}
                    >
                        <InputLabel id="create-target-rotator-label">Rotator</InputLabel>
                        <Select
                            labelId="create-target-rotator-label"
                            value={createSelectedRotatorId}
                            label="Rotator"
                            onChange={(event) => setCreateSelectedRotatorId(String(event.target.value))}
                            renderValue={(selected) => {
                                if (String(selected) === 'none') return 'No rotator control';
                                const selectedRotator = rotatorRows.find((row) => String(row.id) === String(selected));
                                if (!selectedRotator) return 'No rotator control';
                                const usageRows = rotatorUsageById[String(selectedRotator.id)] || [];
                                const inUseLabel = usageRows.length > 0
                                    ? `In use ${usageRows.slice(0, 2).map((row) => `T${row.targetNumber}`).join(',')}`
                                    : null;
                                return (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                                        <Typography variant="body2" noWrap sx={{ fontWeight: 600, minWidth: 0 }}>
                                            {selectedRotator.name}
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
                                            label={`${selectedRotator.host}:${selectedRotator.port}`}
                                            variant="outlined"
                                            sx={{ height: 18, fontSize: '0.62rem', fontFamily: 'monospace', flexShrink: 0 }}
                                        />
                                    </Box>
                                );
                            }}
                        >
                            <MenuItem value="none">
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                                        No rotator control
                                    </Typography>
                                    <Chip
                                        label="None"
                                        size="small"
                                        variant="outlined"
                                        sx={{ ml: 'auto', height: 18, fontSize: '0.62rem' }}
                                    />
                                </Box>
                            </MenuItem>
                            {rotatorRows.map((rotator) => {
                                const usageRows = rotatorUsageById[String(rotator.id)] || [];
                                const inUseLabel = usageRows.length > 0
                                    ? `In use ${usageRows.slice(0, 2).map((row) => `T${row.targetNumber}`).join(',')}`
                                    : null;
                                return (
                                <MenuItem key={rotator.id} value={String(rotator.id)} sx={{ py: 0.75 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                        <Typography variant="body2" noWrap sx={{ fontWeight: 600, minWidth: 0, flex: 1 }}>
                                            {rotator.name || rotator.id}
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

                    <FormControl
                        size="small"
                        fullWidth
                        variant="outlined"
                        sx={{ minWidth: 200, mt: 0, mb: 0.5 }}
                    >
                        <InputLabel id="create-target-rig-label">Rig</InputLabel>
                        <Select
                            labelId="create-target-rig-label"
                            value={createSelectedRigId}
                            label="Rig"
                            onChange={(event) => setCreateSelectedRigId(String(event.target.value))}
                            renderValue={(selected) => {
                                if (String(selected) === 'none') return 'No rig control';
                                const selectedRig = rigRows.find((row) => String(row.id) === String(selected));
                                if (!selectedRig) return 'No rig control';
                                const usageRows = rigUsageById[String(selectedRig.id)] || [];
                                const inUseLabel = usageRows.length > 0
                                    ? `In use ${usageRows.slice(0, 2).map((row) => `T${row.targetNumber}`).join(',')}`
                                    : null;
                                return (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                                        <Typography variant="body2" noWrap sx={{ fontWeight: 600, minWidth: 0 }}>
                                            {selectedRig.name}
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
                                            label={`${selectedRig.host}:${selectedRig.port}`}
                                            variant="outlined"
                                            sx={{ height: 18, fontSize: '0.62rem', fontFamily: 'monospace', flexShrink: 0 }}
                                        />
                                    </Box>
                                );
                            }}
                        >
                            <MenuItem value="none">
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                                        No rig control
                                    </Typography>
                                    <Chip
                                        label="None"
                                        size="small"
                                        variant="outlined"
                                        sx={{ ml: 'auto', height: 18, fontSize: '0.62rem' }}
                                    />
                                </Box>
                            </MenuItem>
                            {rigRows.map((rig) => {
                                const usageRows = rigUsageById[String(rig.id)] || [];
                                const inUseLabel = usageRows.length > 0
                                    ? `In use ${usageRows.slice(0, 2).map((row) => `T${row.targetNumber}`).join(',')}`
                                    : null;
                                return (
                                <MenuItem key={rig.id} value={String(rig.id)} sx={{ py: 0.75 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                        <Typography variant="body2" noWrap sx={{ fontWeight: 600, minWidth: 0, flex: 1 }}>
                                            {rig.name || rig.id}
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
                    </Box>

                </Box>
                {createDialogError && (
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
                            {createDialogError}
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
                    disabled={createTargetBusy}
                    onClick={handleCloseCreateDialog}
                >
                    Cancel
                </Button>
                <Button
                    variant="contained"
                    color="success"
                    disabled={
                        createTargetBusy
                        || (
                            (createTargetType === TARGET_TYPES.SATELLITE && !createSelectedSatellite?.norad_id)
                            || (createTargetType === TARGET_TYPES.MISSION && !createSelectedMission?.command)
                            || (createTargetType === TARGET_TYPES.BODY && !createSelectedBodyId)
                        )
                    }
                    onClick={handleCreateTargetSubmit}
                    startIcon={createTargetBusy ? <CircularProgress color="inherit" size={16} /> : <AddCircleIcon />}
                >
                    Create Target
                </Button>
            </DialogActions>
        </Dialog>
        <Box
            sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                pl: 0,
                pr: 1.5,
                py: 0,
                bgcolor: 'background.paper',
                borderBottom: '1px solid',
                borderColor: 'border.main',
                minHeight: isTightHeader ? '56px' : '64px',
                height: isTightHeader ? '56px' : '64px',
                maxHeight: isTightHeader ? '56px' : '64px',
                minWidth: 0,
                overflow: 'hidden',
            }}
        >
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    flex: '1 1 auto',
                    minWidth: 0,
                    height: '100%',
                }}
            >
                <Box
                    sx={{
                        width: 'auto',
                        flex: '1 1 auto',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'stretch',
                        minWidth: 0,
                    }}
                >
                    {targetOptions.length === 0 ? (
                        <Box
                            sx={{
                                px: 0.5,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.5,
                            }}
                        >
                            <Tooltip title="Add target slot (satellite, mission, or body)" arrow>
                                <IconButton
                                    onClick={handleOpenCreateDialog}
                                    sx={{
                                        width: isTightHeader ? 34 : (isCompactHeader ? 38 : 42),
                                        height: isTightHeader ? 34 : (isCompactHeader ? 38 : 42),
                                        color: 'text.secondary',
                                        '&:hover': {
                                            backgroundColor: 'action.hover',
                                        },
                                    }}
                                >
                                    <Typography component="span" sx={{ fontSize: isTightHeader ? '1.55rem' : '1.9rem', lineHeight: 1, fontWeight: 700 }}>
                                        +
                                    </Typography>
                                </IconButton>
                            </Tooltip>
                            <Typography
                                variant="button"
                                sx={{
                                    color: 'text.secondary',
                                    fontWeight: 600,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    lineHeight: 1,
                                    ml: 0.2,
                                }}
                            >
                                add target slot
                            </Typography>
                        </Box>
                    ) : (
                        <Tabs
                            value={tabValue}
                            onChange={handleTargetTabChange}
                            variant="scrollable"
                            scrollButtons
                            allowScrollButtonsMobile
                            sx={{
                                width: 'auto',
                                minWidth: 0,
                                minHeight: '100%',
                                height: '100%',
                                flex: '0 1 auto',
                                '& .MuiTabs-scroller': {
                                    display: 'flex',
                                    alignItems: 'stretch',
                                },
                                '& .MuiTabs-scrollButtons': {
                                    flexShrink: 0,
                                },
                                '& .MuiTabs-scrollButtons.Mui-disabled': {
                                    opacity: 0.3,
                                },
                                '& .MuiTabs-flexContainer': {
                                    minHeight: '100%',
                                    height: '100%',
                                    alignItems: 'stretch',
                                },
                                '& .MuiTabs-indicator': { display: 'none' },
                                '& .MuiTab-root': {
                                    minHeight: '100%',
                                    height: '100%',
                                    textTransform: 'none',
                                    px: 1.5,
                                    py: 0,
                                    mr: 0.25,
                                    minWidth: 120,
                                    borderRadius: 0,
                                    border: '1px solid transparent',
                                    borderColor: 'transparent',
                                    color: 'text.secondary',
                                    fontWeight: 600,
                                    '&.Mui-selected': {
                                        color: 'primary.contrastText',
                                        backgroundColor: 'primary.main',
                                        borderColor: 'primary.dark',
                                    }
                                },
                            }}
                        >
                            {targetOptions.map((option) => {
                                const shortName = option.targetName.length > 20
                                    ? `${option.targetName.slice(0, 20)}...`
                                    : option.targetName;
                                const normalizedTargetNumber = Number(option.targetNumber);
                                const hasTargetNumber = option.targetNumber != null
                                    && Number.isFinite(normalizedTargetNumber)
                                    && normalizedTargetNumber > 0;
                                const trackerLabel = hasTargetNumber
                                    ? `T${option.targetNumber}`
                                    : (option.isObservationTracker ? 'OBS' : 'T?');
                                const targetIdTooltip = option.targetType === TARGET_TYPES.SATELLITE
                                    ? `NORAD ${option.targetIdentifier}`
                                    : (option.targetType === TARGET_TYPES.MISSION
                                        ? `Mission ${option.targetIdentifier}`
                                        : `Body ${option.targetIdentifier}`);
                                const tooltipLines = [
                                    option.isObservationTracker
                                        ? `Observation tracker (${option.trackerId})`
                                        : `Target ${option.targetNumber}`,
                                    `${option.targetName}`,
                                    targetIdTooltip,
                                    `Rotator ${option.rotatorName}`,
                                    `HW ${option.tabHardwareLed?.label || 'Unknown'}`,
                                ];
                                if (option.runningObsCount > 0) {
                                    tooltipLines.push(`Obs running: ${option.runningObsCount}`);
                                }
                                const TabHardwareLedIcon = option.tabHardwareLed?.Icon;
                                return (
                                    <Tab
                                        key={option.trackerId}
                                        value={option.trackerId}
                                        label={
                                            <Tooltip
                                                title={tooltipLines.join(' | ')}
                                                arrow
                                            >
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.7, maxWidth: 230 }}>
                                                    <Box
                                                        sx={{
                                                            width: 18,
                                                            height: 18,
                                                            borderRadius: '50%',
                                                            bgcolor: option.tabHardwareLed?.bgColor || 'action.disabled',
                                                            border: '1px solid',
                                                            borderColor: option.tabHardwareLed?.borderColor || 'action.disabledBackground',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            flexShrink: 0,
                                                        }}
                                                    >
                                                        {TabHardwareLedIcon ? (
                                                            <TabHardwareLedIcon
                                                                sx={{
                                                                    fontSize: '0.78rem',
                                                                    color: option.tabHardwareLed?.iconColor || 'common.white',
                                                                }}
                                                            />
                                                        ) : null}
                                                    </Box>
                                                    <Typography variant="caption" sx={{ fontWeight: 900, fontSize: '1.2rem', lineHeight: 1 }}>
                                                        {trackerLabel}
                                                    </Typography>
                                                    <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', maxWidth: 190 }}>
                                                        <Typography
                                                            variant="caption"
                                                            noWrap
                                                            sx={{ fontSize: '0.72rem', maxWidth: '100%', display: 'block', lineHeight: 1.1 }}
                                                        >
                                                            {shortName}
                                                        </Typography>
                                                        <Typography
                                                            variant="caption"
                                                            noWrap
                                                            sx={{
                                                                display: 'block',
                                                                fontSize: '0.61rem',
                                                                opacity: 0.9,
                                                                maxWidth: '100%',
                                                                fontFamily: 'monospace',
                                                                lineHeight: 1.05,
                                                            }}
                                                        >
                                                            {`Az ${option.satAz != null ? option.satAz.toFixed(2) : '--'}° • El ${option.satEl != null ? option.satEl.toFixed(2) : '--'}°`}
                                                        </Typography>
                                                    </Box>
                                                    <Tooltip title={`Delete target ${option.targetNumber}`} arrow>
                                                        <IconButton
                                                            component="span"
                                                            size="small"
                                                            aria-label={`Delete ${option.targetName} target`}
                                                            onMouseDown={(event) => {
                                                                event.preventDefault();
                                                                event.stopPropagation();
                                                            }}
                                                            onClick={(event) => handleDeleteTarget(event, option)}
                                                            sx={{
                                                                p: isTightHeader ? 0.2 : 0.3,
                                                                ml: 0.2,
                                                                color: 'inherit',
                                                                '&:hover': {
                                                                    bgcolor: 'rgba(255,255,255,0.16)',
                                                                },
                                                            }}
                                                        >
                                                            <CloseIcon sx={{ fontSize: isTightHeader ? '0.82rem' : '0.95rem' }} />
                                                        </IconButton>
                                                    </Tooltip>
                                                </Box>
                                            </Tooltip>
                                        }
                                        sx={{
                                            ...(option.hasActiveObservation ? {
                                                backgroundImage: 'repeating-linear-gradient(135deg, rgba(255, 193, 7, 0.22) 0px, rgba(255, 193, 7, 0.22) 7px, rgba(255, 87, 34, 0.2) 7px, rgba(255, 87, 34, 0.2) 14px)',
                                                '&.Mui-selected': {
                                                    backgroundImage: 'repeating-linear-gradient(135deg, rgba(255, 193, 7, 0.22) 0px, rgba(255, 193, 7, 0.22) 7px, rgba(255, 87, 34, 0.2) 7px, rgba(255, 87, 34, 0.2) 14px)',
                                                },
                                            } : {}),
                                        }}
                                    />
                                );
                            })}
                            <Tab
                                value={ADD_TARGET_TAB_VALUE}
                                label={
                                    <Tooltip title="Add target slot (satellite, mission, or body)" arrow>
                                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 20 }}>
                                            <Typography component="span" sx={{ fontSize: '2rem', lineHeight: 1, fontWeight: 700 }}>
                                                +
                                            </Typography>
                                        </Box>
                                    </Tooltip>
                                }
                                sx={{
                                    minWidth: '40px !important',
                                    maxWidth: '40px !important',
                                    width: '40px',
                                    px: '0 !important',
                                    mr: '0 !important',
                                    '&.Mui-selected': {
                                        color: 'text.secondary',
                                        backgroundColor: 'transparent',
                                        borderColor: 'transparent',
                                    },
                                }}
                            />
                        </Tabs>
                    )}
                </Box>
            </Box>
            <Box
                sx={{
                    alignItems: 'center',
                    flex: '0 0 380px',
                    minWidth: 320,
                    maxWidth: 440,
                    display: { xs: 'none', lg: 'flex' },
                    gap: 1,
                }}
            >
                <SatelliteSearchAutocomplete
                    onTargetSelect={handleRetargetSearchSelect}
                    disabled={disableRetargetSearch}
                    monitoredMissionCommands={monitoredMissionCommands}
                    monitoredBodyIds={monitoredBodyIds}
                />
            </Box>
        </Box>
        </>
    );
});

export default TargetSelectorBar;
