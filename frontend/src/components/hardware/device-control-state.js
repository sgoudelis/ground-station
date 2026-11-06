/** Copyright (c) 2026 Efstratios Goudelis, GPL-3.0-or-later */
import {orderNavigationStatuses, resolveHardwareStatus} from '../common/hardware-status.js';
import {deviceKey} from './control-slice.js';

export const EMPTY_LIST = Object.freeze([]);
export const EMPTY_OBJECT = Object.freeze({});

export function deviceStatus(snapshot, loaded, connected, now, loadError = false) {
    if (!connected) return {key: 'unavailable', known: false};
    if (!loaded && loadError) return {key: 'unavailable', known: false};
    if (!loaded) return {key: 'loading', known: false};
    if (snapshot && (!Number.isFinite(snapshot.receivedAt) || now < snapshot.receivedAt || now - snapshot.receivedAt >= 15000)) {
        return {key: 'unavailable', known: false};
    }
    if (snapshot?.data?.error) return {key: 'error', known: true};
    return snapshot?.data?.connected
        ? {key: 'connected', known: true}
        : {key: 'disconnected', known: true};
}

export function summarizeDevices(config, control, connected, now) {
    return config.reduce((result, device) => {
        const snapshot = control.devices?.[deviceKey(device.kind, device.id)];
        const status = deviceStatus(snapshot, control.loaded, connected, now, control.error);
        if (status.known && snapshot?.data?.connected) result.connected += 1;
        const hardwareStatus = status.key === 'loading' ? 'loading' : resolveHardwareStatus({
            kind: device.kind, deviceId: device.id, data: {connected: false, ...snapshot?.data}, available: status.known,
        });
        result.counts[hardwareStatus] = (result.counts[hardwareStatus] || 0) + 1;
        result.status = orderNavigationStatuses(Object.keys(result.counts))[0];
        return result;
    }, {connected: 0, counts: {}, status: 'none'});
}

export function latestDeviceCommand(commands, kind, id) {
    return Object.values(commands || EMPTY_OBJECT)
        .filter((command) => command.device_ids?.[kind] === String(id))
        .sort((a, b) => (b.clientSubmittedAt || b.submitted_at * 1000 || 0)
            - (a.clientSubmittedAt || a.submitted_at * 1000 || 0))[0];
}

export function resolveDeviceOwner(owner, instances, views, observations) {
    if (!owner || owner.type === 'manual') return {...owner, name: ''};
    const instance = instances.find((row) => row.tracker_id === owner.id);
    const view = views[owner.id];
    const observation = owner.type === 'observation'
        ? observations.find((row) => row.id === owner.id) : null;
    return {
        ...owner,
        name: observation?.satellite?.name || view?.satelliteData?.details?.name
            || view?.trackingState?.target_name || instance?.tracking_state?.target_name
            || observation?.name || '',
        number: instance?.target_number,
    };
}
