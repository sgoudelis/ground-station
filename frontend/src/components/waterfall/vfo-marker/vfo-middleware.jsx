import { backendUpdateVFOParameters, setVFOProperty } from './vfo-slice.jsx';
import { flushAudioBuffers } from '../../dashboard/audio-service.js';
import { mapParametersToBackend } from './vfo-config.js';
import { selectRunningRigTransmitters } from '../../target/transmitter-selectors.js';

// You might want to pass the socket as a parameter or get it differently
let socketInstance = null;

// Function to set socket (call this when socket is initialized)
export const setSocketForMiddleware = (socket) => {
    socketInstance = socket;
};

// Debounce delay for backend VFO parameter updates (milliseconds)
const BACKEND_UPDATE_DEBOUNCE_MS = 150;

// Debounce timers for each VFO (keyed by vfoNumber)
const debounceTimers = {};

const normalizeTrackerId = (value) => {
    if (typeof value !== 'string') {
        return '';
    }
    const normalized = value.trim();
    return normalized && normalized.toLowerCase() !== 'none' ? normalized : '';
};

const sameIdentifier = (left, right) => {
    if (left == null || right == null) {
        return false;
    }
    return String(left) === String(right);
};

const hasLockedTransmitter = (vfoState) => (
    Boolean(vfoState?.lockedTransmitterId) && vfoState.lockedTransmitterId !== 'none'
);

const doesVfoTrackIncomingTracker = (vfoState, incomingTrackerId, activeTrackerId) => {
    const normalizedIncomingTrackerId = normalizeTrackerId(incomingTrackerId);
    if (!normalizedIncomingTrackerId || !hasLockedTransmitter(vfoState)) {
        return false;
    }

    const lockedTrackerId = normalizeTrackerId(vfoState?.lockedTransmitterTrackerId);
    if (lockedTrackerId) {
        return sameIdentifier(lockedTrackerId, normalizedIncomingTrackerId);
    }

    // Legacy fallback: locks created before tracker-scoped lock IDs existed.
    return Boolean(activeTrackerId) && sameIdentifier(activeTrackerId, normalizedIncomingTrackerId);
};

const findLockedTransmitter = (transmitters, lockedTransmitterId, lockedTrackerId) => {
    if (!Array.isArray(transmitters) || !lockedTransmitterId || lockedTransmitterId === 'none') {
        return null;
    }

    const normalizedLockedTrackerId = normalizeTrackerId(lockedTrackerId);
    return transmitters.find((tx) => {
        if (!sameIdentifier(tx.id, lockedTransmitterId)) {
            return false;
        }
        if (!normalizedLockedTrackerId) {
            return true;
        }
        return sameIdentifier(tx.trackerId, normalizedLockedTrackerId);
    }) || null;
};

// Debounced dispatcher for backend updates
const debouncedBackendUpdate = (store, vfoNumber, updateFn) => {
    // Clear existing timer for this VFO
    if (debounceTimers[vfoNumber]) {
        clearTimeout(debounceTimers[vfoNumber]);
    }

    // Set new timer
    debounceTimers[vfoNumber] = setTimeout(() => {
        updateFn();
        delete debounceTimers[vfoNumber];
    }, BACKEND_UPDATE_DEBOUNCE_MS);
};

// Helper function to filter out UI-only fields before sending to backend
const filterUIOnlyFields = (vfoState) => {
    // frequencyOffset is UI-only (used for doppler offset calculations)
    // lockedTransmitterTrackerId is frontend-only tracker scoping metadata
    // lockedTransmitterId is now sent to backend as locked_transmitter_id
    // parameters is frontend-only (mapped to decoder-specific fields below)
    const {
        frequencyOffset,
        lockedTransmitterId,
        lockedTransmitterTrackerId,
        parameters,
        parametersEnabled,
        ...backendFields
    } = vfoState;

    // Convert camelCase to snake_case for backend
    // Only include locked_transmitter_id if it was present in the input (not undefined)
    // This prevents partial updates (like frequency-only) from overwriting the lock state
    // Send 'none' string as-is to backend
    if (lockedTransmitterId !== undefined) {
        backendFields.locked_transmitter_id = lockedTransmitterId;
    }

    // Send parametersEnabled to backend (defaults to true if not set)
    // Backend needs this to detect when user enables/disables custom parameters
    if (parametersEnabled !== undefined) {
        backendFields.parametersEnabled = parametersEnabled;
    }

    // Map decoder parameters from frontend format to backend format
    // Frontend: { parameters: { lora_sf: 7, lora_bw: 125000, ... } }
    // Backend: { sf: 7, bw: 125000, ... }
    // Only send parameters if parametersEnabled is true (defaults to true if not set)
    const paramsEnabled = parametersEnabled ?? true;
    if (paramsEnabled && parameters && vfoState.decoder && vfoState.decoder !== 'none') {
        const decoderParams = mapParametersToBackend(vfoState.decoder, parameters);
        Object.assign(backendFields, decoderParams);
    }

    return backendFields;
};

const backendSyncMiddleware = (store) => (next) => (action) => {
    if (action.type === 'waterfallState/setContinuousObservation'
        || action.type === 'vfo/restoreReceivingSession'
        || (action.type === 'waterfallState/setIsStreaming' && !action.payload)) {
        // Old debounced edits must never land in a newly adopted observation.
        Object.values(debounceTimers).forEach(clearTimeout);
        Object.keys(debounceTimers).forEach((key) => delete debounceTimers[key]);
    }
    // Get state BEFORE action is processed for VFO activation checks
    const stateBefore = store.getState();

    // Continuous viewers never synchronize local VFO controls to the owner.
    if (stateBefore.waterfall.continuousObservation) {
        if (['vfo/setVFOProperty', 'vfo/setVfoActive', 'vfo/setVfoInactive',
            'vfo/syncDraggedVFOToBackend'].includes(action.type)) return action;
        return next(action);
    }

    // Use the socket from the module variable instead of state
    const socket = socketInstance;

    if (!socket) {
        return next(action);
    }

    // Handle VFO activation - check BEFORE processing action
    if (action.type === 'vfo/setVfoActive') {
        const vfoNumber = action.payload;
        const vfoState = stateBefore.vfo.vfoMarkers[vfoNumber];

        // Check if VFO frequency is within current SDR bandwidth
        const centerFrequency = stateBefore.waterfall.centerFrequency;
        const sampleRate = stateBefore.waterfall.sampleRate;
        const vfoFrequency = vfoState.frequency;

        // Calculate SDR bandwidth limits
        const bandwidthStart = centerFrequency - (sampleRate / 2);
        const bandwidthEnd = centerFrequency + (sampleRate / 2);

        // Check if frequency is outside bandwidth or null
        const isOutsideBandwidth = vfoFrequency === null ||
                                   vfoFrequency < bandwidthStart ||
                                   vfoFrequency > bandwidthEnd;

        if (isOutsideBandwidth) {
            // VFO is outside bandwidth or uninitialized - reset to visible center and unlock
            // Use the visible center frequency if zoom/pan is active
            let targetFrequency = centerFrequency;
            if (!stateBefore.waterfall.joinedSdrId && typeof window !== 'undefined' && window.getWaterfallTransform) {
                const transform = window.getWaterfallTransform();
                targetFrequency = (transform.startFreq + transform.endFreq) / 2;
            }

            store.dispatch(setVFOProperty({
                vfoNumber: vfoNumber,
                updates: {
                    frequency: targetFrequency,
                    lockedTransmitterId: 'none',
                    lockedTransmitterTrackerId: null,
                    frequencyOffset: 0
                }
            }));
        }
    }

    const result = next(action);
    const state = store.getState();

    if (!socket) {
        return result;
    }

    // Don't sync to backend if not streaming (except when starting streaming)
    const isStreaming = state.waterfall.isStreaming;
    if (!isStreaming && action.type !== 'waterfallState/setIsStreaming') {
        return result;
    }

    // Drag values are already rendered from a canvas-local ref. Merge the
    // transient update only for this backend call so Redux can stay untouched
    // until the drag ends.
    if (action.type === 'vfo/syncDraggedVFOToBackend') {
        const { vfoNumber, updates } = action.payload;
        const currentVfoState = state.vfo.vfoMarkers[vfoNumber];
        if (!currentVfoState) {
            return result;
        }

        const backendVfoState = filterUIOnlyFields({
            ...currentVfoState,
            ...updates,
        });
        const currentVfoActiveState = state.vfo.vfoActive[vfoNumber];
        const currentIsSelected = state.vfo.selectedVFO === vfoNumber;

        store.dispatch(backendUpdateVFOParameters({
            socket,
            vfoNumber,
            updates: {
                vfoNumber,
                ...backendVfoState,
                active: currentVfoActiveState,
                selected: currentIsSelected,
            },
        }));
        return result;
    }

    // Handle VFO property changes
    if (action.type === 'vfo/setVFOProperty') {
        const { vfoNumber, updates, skipBackendSync = false } = action.payload;
        if (skipBackendSync) {
            return result;
        }

        // Handle frequencyOffset changes for locked VFOs
        const updateKeys = Object.keys(updates);
        const isOnlyOffsetChange = updateKeys.length === 1 && updateKeys[0] === 'frequencyOffset';

        if (isOnlyOffsetChange) {
            // Check if this VFO is locked to a transmitter
            const vfoState = state.vfo.vfoMarkers[vfoNumber];

            if (vfoState && vfoState.lockedTransmitterId && vfoState.lockedTransmitterId !== 'none') {
                // VFO is locked - immediately calculate and send new frequency with offset
                const transmitters = selectRunningRigTransmitters(state);
                const transmitter = findLockedTransmitter(
                    transmitters,
                    vfoState.lockedTransmitterId,
                    vfoState.lockedTransmitterTrackerId
                );
                const observedFrequency = Number(transmitter?.downlink_observed_freq);

                if (Number.isFinite(observedFrequency)) {
                    const newOffset = updates.frequencyOffset;
                    const finalFrequency = observedFrequency + newOffset;

                    // Immediately dispatch frequency update to backend
                    store.dispatch(setVFOProperty({
                        vfoNumber: vfoNumber,
                        updates: { frequency: finalFrequency },
                    }));
                }
            }

            // Don't sync offset itself to backend - just update local state
            return result;
        }

        // Filter out UI-only fields before sending to backend
        const backendUpdates = filterUIOnlyFields(updates);

        // Dispatch async thunk to update backend with complete state (debounced)
        // Re-read state at fire time to avoid sending stale active/selected values.
        debouncedBackendUpdate(store, vfoNumber, () => {
            const currentState = store.getState();
            if (!currentState.waterfall.isStreaming) return;
            const currentVfoState = currentState.vfo.vfoMarkers[vfoNumber];
            if (!currentVfoState) {
                return;
            }
            const currentVfoActiveState = currentState.vfo.vfoActive[vfoNumber];
            const currentIsSelected = currentState.vfo.selectedVFO === vfoNumber;
            const backendVfoState = filterUIOnlyFields(currentVfoState);

            store.dispatch(backendUpdateVFOParameters({
                socket,
                vfoNumber,
                updates: {
                    vfoNumber: vfoNumber,
                    ...backendVfoState,
                    ...backendUpdates,
                    active: currentVfoActiveState,
                    selected: currentIsSelected,
                },
            }));
        });
    }

    // Handle selected VFO changes
    if (action.type === 'vfo/setSelectedVFO') {
        const selectedVFO = action.payload;

        if (selectedVFO === null) {
            // Deselect all VFOs - vfoNumber: 0 is special case for backend
            store.dispatch(backendUpdateVFOParameters({
                socket,
                vfoNumber: 0,
                updates: { 
                    vfoNumber: 0,
                    selected: false 
                }
            }));
        } else {
            // Selection updates should only carry selection intent.
            // Sending full VFO payload here can race with activation updates and
            // accidentally apply stale `active:false` / decoder fields on backend.
            store.dispatch(backendUpdateVFOParameters({
                socket,
                vfoNumber: selectedVFO,
                updates: {
                    vfoNumber: selectedVFO,
                    selected: true
                }
            }));
        }
    }

    // Handle VFO activation - send state to backend
    if (action.type === 'vfo/setVfoActive') {
        const vfoNumber = action.payload;
        const vfoState = state.vfo.vfoMarkers[vfoNumber];
        const isSelected = state.vfo.selectedVFO === vfoNumber;

        // Filter out UI-only fields before sending to backend
        const backendVfoState = filterUIOnlyFields(vfoState);

        // Send complete VFO state when activating to ensure backend has all parameters
        store.dispatch(backendUpdateVFOParameters({
            socket,
            vfoNumber,
            updates: {
                vfoNumber: vfoNumber,
                ...backendVfoState,
                active: true,
                selected: isSelected,
            }
        }));
    }

    // Handle VFO deactivation
    if (action.type === 'vfo/setVfoInactive') {
        const vfoNumber = action.payload;

        // Clear lock state when deactivating to prevent stale state issues
        // This ensures clean activation later without triggering unnecessary decoder restarts
        store.dispatch(setVFOProperty({
            vfoNumber: vfoNumber,
            updates: {
                lockedTransmitterId: 'none',
                lockedTransmitterTrackerId: null,
                frequencyOffset: 0
            }
        }));

        // Send complete VFO state when deactivating to ensure backend has all parameters
        store.dispatch(backendUpdateVFOParameters({
            socket,
            vfoNumber,
            updates: {
                active: false,
                locked_transmitter_id: 'none'
            }
        }));
    }

    // Handle streaming start - send all VFO data to backend
    if (action.type === 'waterfallState/setIsStreaming' && action.payload === true
        && !stateBefore.waterfall.isStreaming && !action.meta?.preserveVfos) {
        const vfoMarkers = state.vfo.vfoMarkers;
        const vfoActive = state.vfo.vfoActive;
        const selectedVFO = state.vfo.selectedVFO;

        // Send each VFO's complete state to the backend
        Object.keys(vfoMarkers).forEach(vfoNumber => {
            const vfoNum = parseInt(vfoNumber);
            const vfoState = vfoMarkers[vfoNum];
            const isActive = vfoActive[vfoNum];
            const isSelected = selectedVFO === vfoNum;

            // Only send VFO data if the VFO has been initialized (frequency is not null)
            // and the VFO is active
            if (vfoState.frequency !== null && isActive) {
                if (state.waterfall.joinedSdrId) {
                    const center = Number(state.waterfall.centerFrequency);
                    const sampleRate = Number(state.waterfall.sampleRate);
                    const frequency = Number(vfoState.frequency);
                    if (Number.isFinite(center) && Number.isFinite(sampleRate)
                        && (!Number.isFinite(frequency) || Math.abs(frequency - center) > sampleRate / 2)) {
                        // A previous session's VFO may be outside this live SDR.
                        // Recenter it locally before creating a passive consumer.
                        store.dispatch(setVFOProperty({
                            vfoNumber: vfoNum,
                            updates: {
                                frequency: center,
                                lockedTransmitterId: 'none',
                                lockedTransmitterTrackerId: null,
                                frequencyOffset: 0,
                            },
                        }));
                        return;
                    }
                }
                // Filter out UI-only fields before sending to backend
                const backendVfoState = filterUIOnlyFields(vfoState);

                store.dispatch(backendUpdateVFOParameters({
                    socket,
                    vfoNumber: vfoNum,
                    updates: {
                        vfoNumber: vfoNum,
                        ...backendVfoState,
                        active: isActive,
                        selected: isSelected,
                    },
                }));
            }
        });
    }

    // Handle satellite tracking data updates - track doppler-corrected frequencies for locked VFOs
    if (action.type === 'targetSatTrack/setSatelliteData') {
        const activeTrackerId = normalizeTrackerId(state.targetSatTrack?.trackerId)
            || normalizeTrackerId(stateBefore.targetSatTrack?.trackerId);
        const incomingTrackerId = normalizeTrackerId(action.payload?.tracker_id) || activeTrackerId;

        if (!incomingTrackerId) {
            return result;
        }

        const rigData = action.payload?.rig_data;
        const satelliteData = action.payload?.satellite_data;

        // Satellite changes should only unlock VFOs that are tied to the same tracker slot.
        if (satelliteData?.details) {
            const currentNoradId = satelliteData.details.norad_id;
            const previousNoradIdFromView = stateBefore.targetSatTrack?.trackerViews?.[incomingTrackerId]?.satelliteData?.details?.norad_id;
            const previousNoradIdFromActive = sameIdentifier(
                incomingTrackerId,
                normalizeTrackerId(stateBefore.targetSatTrack?.trackerId)
            )
                ? stateBefore.targetSatTrack?.satelliteData?.details?.norad_id
                : null;
            const previousNoradId = previousNoradIdFromView ?? previousNoradIdFromActive;

            if (
                currentNoradId != null &&
                previousNoradId != null &&
                String(currentNoradId) !== String(previousNoradId)
            ) {
                const vfoMarkers = state.vfo.vfoMarkers;

                Object.keys(vfoMarkers).forEach(vfoNumber => {
                    const vfoNum = parseInt(vfoNumber);
                    const vfo = vfoMarkers[vfoNum];

                    if (!doesVfoTrackIncomingTracker(vfo, incomingTrackerId, activeTrackerId)) {
                        return;
                    }

                    store.dispatch(setVFOProperty({
                        vfoNumber: vfoNum,
                        updates: {
                            lockedTransmitterId: 'none',
                            lockedTransmitterTrackerId: null,
                            frequencyOffset: 0
                        },
                    }));
                });

                return result;
            }
        }

        const rigTransmitters = Array.isArray(rigData?.transmitters) ? rigData.transmitters : null;
        if (!rigTransmitters) {
            return result;
        }

        const vfoMarkers = state.vfo.vfoMarkers;

        Object.keys(vfoMarkers).forEach(vfoNumber => {
            const vfoNum = parseInt(vfoNumber);
            const vfo = vfoMarkers[vfoNum];

            if (!doesVfoTrackIncomingTracker(vfo, incomingTrackerId, activeTrackerId)) {
                return;
            }

            const transmitter = rigTransmitters.find((tx) => sameIdentifier(tx.id, vfo.lockedTransmitterId));
            if (!transmitter) {
                store.dispatch(setVFOProperty({
                    vfoNumber: vfoNum,
                    updates: {
                        lockedTransmitterId: 'none',
                        lockedTransmitterTrackerId: null,
                        frequencyOffset: 0
                    },
                }));
                return;
            }

            const observedFrequency = Number(transmitter.downlink_observed_freq);
            if (!Number.isFinite(observedFrequency)) {
                return;
            }

            const offset = Number(vfo.frequencyOffset) || 0;
            const finalFrequency = observedFrequency + offset;
            if (vfo.frequency === finalFrequency) {
                return;
            }

            // Inactive VFOs don't need backend updates while not demodulating.
            if (state.vfo.vfoActive[vfoNum]) {
                store.dispatch(setVFOProperty({
                    vfoNumber: vfoNum,
                    updates: { frequency: finalFrequency },
                }));
            }
        });
    }

    return result;
};

export default backendSyncMiddleware;
