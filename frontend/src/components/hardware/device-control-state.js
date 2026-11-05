/** Copyright (c) 2026 Efstratios Goudelis, GPL-3.0-or-later */
import {deviceKey} from './control-slice.js';

export const EMPTY_LIST = Object.freeze([]);
export const EMPTY_OBJECT = Object.freeze({});

export function deviceStatus(snapshot, loaded, connected, now, loadError = false) {
    if (!connected) return {key: 'unavailable', color: 'default', known: false};
    if (!loaded && loadError) return {key: 'unavailable', color: 'warning', known: false};
    if (!loaded) return {key: 'loading', color: 'default', known: false};
    if (snapshot && (!Number.isFinite(snapshot.receivedAt) || now - snapshot.receivedAt >= 15000)) {
        return {key: 'unavailable', color: 'warning', known: false};
    }
    if (snapshot?.data?.error) return {key: 'error', color: 'error', known: true};
    return snapshot?.data?.connected
        ? {key: 'connected', color: 'success', known: true}
        : {key: 'disconnected', color: 'default', known: true};
}

export function summarizeDevices(config, control, connected, now) {
    return config.reduce((result, device) => {
        const snapshot = control.devices?.[deviceKey(device.kind, device.id)];
        const status = deviceStatus(snapshot, control.loaded, connected, now, control.error);
        if (status.key === 'connected') result.connected += 1;
        if (status.color === 'error' || status.color === 'warning'
            || status.known && snapshot?.data?.motion_unconfirmed) result.attention += 1;
        if (status.key === 'connected' && snapshot.data.slewing) result.slewing += 1;
        return result;
    }, {connected: 0, attention: 0, slewing: 0});
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
