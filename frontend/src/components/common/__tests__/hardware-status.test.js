import { describe, expect, it } from 'vitest';
import {
    hasAssignedHardwareId,
    resolveAssignedHardwareId,
    resolveRigLedStatus,
    resolveRotatorLedStatus,
    resolveHardwareStatus,
    resolveHardwareConnectionStatus,
    isHardwareTelemetryFresh,
    selectTrackingNavigationStatus,
} from '../hardware-status.js';

describe('resolveAssignedHardwareId', () => {
    it('falls back when preferred source is empty string', () => {
        expect(resolveAssignedHardwareId('', 'rig-2', 'rig-3')).toBe('rig-2');
    });

    it('keeps explicit "none" assignment', () => {
        expect(resolveAssignedHardwareId('none', 'rig-2')).toBe('none');
    });

    it('returns "none" when every source is unset', () => {
        expect(resolveAssignedHardwareId('', null, undefined)).toBe('none');
    });
});

describe('tracking navigation hardware summary', () => {
    const now = 100000;
    const makeState = (instances, trackerViews, connected = true, connectedAt = 0) => ({
        trackerInstances: { instances },
        targetSatTrack: { trackerViews },
        dashboard: { connected, connectedAt },
    });
    const liveView = (overrides = {}) => ({
        hardwareObservedAt: now,
        hardwareReceivedAt: now - 1000,
        ...overrides,
    });

    it('shows rotator and rig states independently for the whole fleet', () => {
        const instances = [
            { tracker_id: 'target-1', rotator_id: 'rot-1', rig_id: 'rig-1' },
            { tracker_id: 'target-2', rotator_id: 'rot-2', rig_id: 'none' },
        ];
        const trackerViews = {
            'target-1': liveView({ rotatorData: { connected: true, tracking: true }, rigData: { connected: true, tracking: true } }),
            'target-2': liveView({ rotatorData: { connected: true, motion_unconfirmed: true } }),
        };

        const summary = selectTrackingNavigationStatus(makeState(instances, trackerViews), now);
        expect(summary.rotator).toEqual({
            status: 'motion_unconfirmed', assignedCount: 2,
            counts: { tracking: 1, motion_unconfirmed: 1 },
        });
        expect(summary.rig).toEqual({ status: 'tracking', assignedCount: 1, counts: { tracking: 1 } });
    });

    it('counts shared hardware once and uses its newest live report', () => {
        const instances = [
            { tracker_id: 'target-1', rotator_id: 'rot-1' },
            { tracker_id: 'target-2', rotator_id: 'rot-1' },
        ];
        const trackerViews = {
            'target-1': liveView({ hardwareReceivedAt: now - 2000, rotatorData: { connected: true, tracking: true } }),
            'target-2': liveView({ hardwareReceivedAt: now - 1000, rotatorData: { connected: true, parked: true } }),
        };

        expect(selectTrackingNavigationStatus(makeState(instances, trackerViews), now).rotator)
            .toEqual({ status: 'parked', assignedCount: 1, counts: { parked: 1 } });
    });

    it('does not present cached activity as live after a disconnect or stale report', () => {
        const instances = [{ tracker_id: 'target-1', rotator_id: 'rot-1', rig_id: 'rig-1' }];
        const trackerViews = {
            'target-1': liveView({ rotatorData: { connected: true, tracking: true }, rigData: { connected: true } }),
        };

        expect(selectTrackingNavigationStatus(makeState(instances, trackerViews, false), now).rotator.status).toBe('unknown');
        expect(selectTrackingNavigationStatus(makeState(instances, trackerViews), now + 16000).rig.status).toBe('unknown');
        expect(selectTrackingNavigationStatus(makeState(instances, trackerViews, true, now - 500), now).rig.status).toBe('unknown');
        expect(selectTrackingNavigationStatus(makeState([], trackerViews), now).rotator.assignedCount).toBe(0);
    });
});

describe('hasAssignedHardwareId', () => {
    it('treats normal IDs as assigned', () => {
        expect(hasAssignedHardwareId('rig-2')).toBe(true);
    });

    it('treats "none" as unassigned', () => {
        expect(hasAssignedHardwareId('none')).toBe(false);
    });
});

describe('hardware LED status', () => {
    it('uses the documented priority for rotator state', () => {
        expect(resolveRotatorLedStatus({ rotatorId: 'none' })).toBe('none');
        expect(resolveRotatorLedStatus({ rotatorId: 'rot-1', rotatorData: { connected: false, tracking: true } })).toBe('disconnected');
        expect(resolveRotatorLedStatus({ rotatorId: 'rot-1', rotatorData: { parked: true } })).toBe('parked');
        expect(resolveRotatorLedStatus({ rotatorId: 'rot-1', rotatorData: { outofbounds: true } })).toBe('outofbounds');
        expect(resolveRotatorLedStatus({ rotatorId: 'rot-1', trackingState: { rotator_state: 'tracking' } })).toBe('tracking');
        expect(resolveRotatorLedStatus({ rotatorId: 'rot-1' })).toBe('unknown');
    });

    it('keeps transport loss separate from unconfirmed physical movement', () => {
        expect(resolveRotatorLedStatus({rotatorId: 'rot-1',
            rotatorData: {connected: false, motion_unconfirmed: true}})).toBe('motion_unconfirmed');
        expect(resolveHardwareConnectionStatus({deviceId: 'rot-1',
            data: {connected: false, motion_unconfirmed: true}})).toBe('disconnected');
    });

    it('uses observed flags instead of requested tracking or parking state', () => {
        expect(resolveRotatorLedStatus({rotatorId: 'rot-1',
            rotatorData: {connected: true, tracking: false, parked: false, stopped: true},
            trackingState: {rotator_state: 'tracking'}})).toBe('stopped');
        expect(resolveRigLedStatus({rigId: 'rig-1', rigData: {connected: true, tracking: false},
            trackingState: {rig_state: 'tracking'}})).toBe('connected');
        expect(resolveRigLedStatus({rigId: 'rig-1', rigData: {connected: true},
            trackingState: {rig_state: 'disconnected'}})).toBe('connected');
    });

    it('shows the specific elevation condition and movement during automatic tracking', () => {
        expect(resolveRotatorLedStatus({rotatorId: 'rot-1',
            rotatorData: {connected: true, tracking: true, slewing: true}})).toBe('slewing');
        expect(resolveRotatorLedStatus({rotatorId: 'rot-1',
            rotatorData: {connected: true, outofbounds: true, minelevation: true}})).toBe('minelevation');
    });

    it('never promotes stale hardware or requested selections to a healthy state', () => {
        expect(resolveHardwareStatus({kind: 'rotator', deviceId: 'rot-1',
            data: {connected: true, tracking: true}, available: false})).toBe('unknown');
        expect(resolveHardwareConnectionStatus({deviceId: 'rot-1',
            data: {connected: true}, available: false})).toBe('unknown');
        expect(resolveHardwareStatus({kind: 'rig', deviceId: 'none', available: false})).toBe('none');
        expect(resolveHardwareStatus({kind: 'rig', deviceId: 'rig-1',
            trackingState: {rig_state: 'tracking'}})).toBe('unknown');
    });

    it('requires a current-session report with a valid receive time', () => {
        const view = {hardwareObservedAt: 100, hardwareReceivedAt: 100};
        expect(isHardwareTelemetryFresh(view, true, 100, 100)).toBe(true);
        expect(isHardwareTelemetryFresh(view, true, 100, 101)).toBe(false);
        expect(isHardwareTelemetryFresh(view, true, 99)).toBe(false);
        expect(isHardwareTelemetryFresh(view, true, 15100)).toBe(false);
        expect(isHardwareTelemetryFresh(view, false, 100)).toBe(false);
    });
});
