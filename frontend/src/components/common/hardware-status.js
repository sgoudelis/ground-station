/**
 * Shared hardware status helpers used by target tabs and hardware popovers.
 * Keep state derivation rules centralized so UI surfaces stay consistent.
 */

export const hasAssignedHardwareId = (value) => {
    const normalized = String(value ?? '').trim().toLowerCase();
    return !['', 'none', 'null', 'undefined'].includes(normalized);
};

export const resolveAssignedHardwareId = (...candidates) => {
    for (const candidate of candidates) {
        // Empty string means "unset in this source", so try the next fallback.
        // Explicit "none" must be preserved as a deliberate unassignment.
        if (candidate == null) continue;
        if (String(candidate).trim() === '') continue;
        return candidate;
    }
    return 'none';
};

// A command describes intent. Explicit telemetry flags always take precedence
// over the requested tracking state, including false flags after Pause/Stop.
const observedFlag = (data, flag, requested) => typeof data[flag] === 'boolean' ? data[flag] : requested;

export const resolveRotatorLedStatus = ({ rotatorId, rotatorData: data = {}, trackingState = {} }) => {
    if (!hasAssignedHardwareId(rotatorId)) return 'none';
    if (data.error) return 'error';
    // Losing the transport does not confirm that the antenna stopped moving.
    if (data.motion_unconfirmed) return 'motion_unconfirmed';
    if (!observedFlag(data, 'connected', trackingState.rotator_state !== 'disconnected')) return 'disconnected';
    if (observedFlag(data, 'parked', trackingState.rotator_state === 'parked')) return 'parked';
    if (data.minelevation) return 'minelevation';
    if (data.outofbounds) return 'outofbounds';
    if (data.park_requested) return 'parking';
    if (data.slewing) return 'slewing';
    if (observedFlag(data, 'tracking', trackingState.rotator_state === 'tracking')) return 'tracking';
    if (data.stopped) return 'stopped';
    if (trackingState.rotator_state === 'stopped') return 'paused';
    if (data.connected === true || trackingState.rotator_state === 'connected') return 'connected';
    return 'unknown';
};

export const resolveRigLedStatus = ({ rigId, rigData: data = {}, trackingState = {} }) => {
    if (!hasAssignedHardwareId(rigId)) return 'none';
    if (data.error) return 'error';
    if (!observedFlag(data, 'connected', trackingState.rig_state !== 'disconnected')) return 'disconnected';
    if (observedFlag(data, 'tracking', trackingState.rig_state === 'tracking')) return 'tracking';
    if (data.stopped || trackingState.rig_state === 'stopped') return 'stopped';
    if (data.connected === true || trackingState.rig_state === 'connected') return 'connected';
    return 'unknown';
};

export const isHardwareTelemetryFresh = (view, connected, now = Date.now(), connectedAt = 0) => (
    Boolean(connected && view?.hardwareObservedAt)
    && Number.isFinite(view.hardwareReceivedAt)
    && view.hardwareReceivedAt >= connectedAt
    && now >= view.hardwareReceivedAt
    && now - view.hardwareReceivedAt < 15000
);

export const resolveHardwareStatus = ({kind, deviceId, data = {}, trackingState = {}, available = true}) => {
    if (!hasAssignedHardwareId(deviceId)) return 'none';
    if (!available) return 'unknown';
    // A fresh tracker envelope can still omit one device's telemetry. Requested
    // state alone is insufficient to show that device as connected or tracking.
    if (typeof data.connected !== 'boolean' && !data.error
        && !(kind === 'rotator' && data.motion_unconfirmed)) return 'unknown';
    return kind === 'rotator'
        ? resolveRotatorLedStatus({rotatorId: deviceId, rotatorData: data, trackingState})
        : resolveRigLedStatus({rigId: deviceId, rigData: data, trackingState});
};

export const resolveHardwareConnectionStatus = ({deviceId, data = {}, available = true}) => {
    if (!hasAssignedHardwareId(deviceId)) return 'none';
    if (!available) return 'unknown';
    if (data.connected === true) return 'connected';
    if (data.error) return 'error';
    return data.connected === false ? 'disconnected' : 'unknown';
};

const NAVIGATION_STATUS_PRIORITY = {
    error: -2,
    motion_unconfirmed: -1,
    unknown: 0,
    outofbounds: 1,
    minelevation: 2,
    loading: 3,
    parking: 3,
    slewing: 3,
    tracking: 4,
    parked: 5,
    stopped: 6,
    paused: 6,
    connected: 7,
    disconnected: 8,
};

export const orderNavigationStatuses = (statuses) => [...statuses].sort(
    (left, right) => (NAVIGATION_STATUS_PRIORITY[left] ?? 10) - (NAVIGATION_STATUS_PRIORITY[right] ?? 10)
);

// The sidebar summarizes the whole fleet, while each target tab describes one tracker.
// Keep the two hardware types separate so a rotator never hides a rig's state.
export const selectTrackingNavigationStatus = (state, now = Date.now()) => {
    const instances = state.trackerInstances?.instances || [];
    const views = state.targetSatTrack?.trackerViews || {};
    const online = Boolean(state.dashboard?.connected);
    const connectedAt = state.dashboard?.connectedAt || 0;
    const byType = { rotator: new Map(), rig: new Map() };

    instances.forEach((instance) => {
        const view = views[instance?.tracker_id] || {};
        const trackingState = view.trackingState || instance?.tracking_state || {};
        const fresh = isHardwareTelemetryFresh(view, online, now, connectedAt);

        [
            {
                type: 'rotator',
                id: resolveAssignedHardwareId(view.selectedRotator, trackingState.rotator_id, instance?.rotator_id),
                data: view.rotatorData,
            },
            {
                type: 'rig',
                id: resolveAssignedHardwareId(view.selectedRadioRig, trackingState.rig_id, instance?.rig_id),
                data: view.rigData,
            },
        ].forEach(({ type, id, data }) => {
            if (!hasAssignedHardwareId(id)) return;
            const status = resolveHardwareStatus({kind: type, deviceId: id, data, available: fresh,
                trackingState: view.confirmedTrackingState || {}});
            const key = String(id);
            const previous = byType[type].get(key);
            // One device can appear in several tracker slots; use its newest live report.
            if (!previous || (fresh && !previous.fresh)
                || (fresh === previous.fresh && (view.hardwareReceivedAt || 0) > previous.receivedAt)) {
                byType[type].set(key, { status, fresh, receivedAt: view.hardwareReceivedAt || 0 });
            }
        });
    });

    return Object.fromEntries(Object.entries(byType).map(([type, devices]) => {
        const counts = {};
        devices.forEach(({ status }) => { counts[status] = (counts[status] || 0) + 1; });
        const statuses = orderNavigationStatuses(Object.keys(counts));
        return [type, {
            status: statuses[0] || 'none',
            counts,
            assignedCount: devices.size,
        }];
    }));
};
