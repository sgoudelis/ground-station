import React from 'react';
import {describe, expect, it, vi} from 'vitest';
import {configureStore} from '@reduxjs/toolkit';
import {fireEvent, render, screen} from '@testing-library/react';
import reducer, {setTrackingStateInBackend, moveRotatorToPosition, stopRotator,
    setTrackerCommandStatus, setHardwareSnapshot, setSatelliteData, reconcileTrackerCommands, markTrackerCommandsUnknown} from '../target-slice.jsx';
import {isCommandOutstanding, isCommandSpinning, selectTrackerCommand} from '../tracker-command-state.js';
import ManualRotatorDialog from '../../dashboard/manual-rotator-dialog.jsx';

// The module under test pulls in the shared i18n instance, so keep the rest of the
// react-i18next module (notably initReactI18next) and only stub the hook.
vi.mock('react-i18next', async importOriginal => ({
    ...await importOriginal(), useTranslation: () => ({t: (key, options) => options?.defaultValue ?? key}),
}));

function setup() {
    const initial = reducer(undefined, {type: '@@init'});
    const trackingState = {rotator_id: 'mount', rotator_state: 'connected', rig_id: 'radio', rig_state: 'disconnected'};
    const store = configureStore({reducer: {targetSatTrack: reducer, trackerInstances: () => ({instances: [{tracker_id: 'target-1'}]})},
        preloadedState: {targetSatTrack: {...initial, trackerId: 'target-1', trackingState,
            trackerViews: {'target-1': {trackingState}}}},
        middleware: getDefault => getDefault({serializableCheck: false})});
    const requests = [];
    const socket = {connected: true, timeout: () => ({emit: (event, request, ack) => requests.push({request, ack})})};
    return {store, socket, requests};
}

const command = (id, scope = 'rotator', status = 'submitted', revision = 1) => ({
    command_id: id, tracker_id: 'target-1', scope, scopes: [scope], status, revision,
    requested_state: {[`${scope}_state`]: 'connected'}, action: 'connect', submitted_at: 100,
});

describe('tracker command lifecycle', () => {
    it('starts feedback synchronously and cannot regress after a late acknowledgement', async () => {
        const {store, socket, requests} = setup();
        const result = store.dispatch(setTrackingStateInBackend({socket, data: {tracker_id: 'target-1'}, changes: {rotator_state: 'connected'}}));
        const id = requests[0].request.data.operation.command_id;
        expect(store.getState().targetSatTrack.trackerCommandsById[id].status).toBe('sending');
        store.dispatch(setTrackerCommandStatus(command(id, 'rotator', 'succeeded', 3)));
        requests[0].ack(null, {success: true, data: {command: command(id)}});
        await result;
        expect(store.getState().targetSatTrack.trackerCommandsById[id].status).toBe('succeeded');
    });

    it('retains concurrent rig and rotator operations and independent outcomes', () => {
        const {store} = setup();
        store.dispatch(setTrackerCommandStatus(command('mount')));
        store.dispatch(setTrackerCommandStatus(command('radio', 'rig')));
        store.dispatch(setTrackerCommandStatus(command('mount', 'rotator', 'succeeded', 3)));
        const commands = store.getState().targetSatTrack.trackerCommandsById;
        expect(selectTrackerCommand(commands, 'target-1', 'rotator').status).toBe('succeeded');
        expect(selectTrackerCommand(commands, 'target-1', 'rig').status).toBe('submitted');
    });

    it('prioritizes outstanding work on the same physical device across trackers', () => {
        const {store} = setup();
        store.dispatch(setTrackerCommandStatus({...command('other-mount'), tracker_id: 'target-2',
            device_ids: {rotator: 'mount'}, submitted_at: 101}));
        store.dispatch(setTrackerCommandStatus({...command('finished', 'rotator', 'succeeded'), submitted_at: 102}));
        store.dispatch(setTrackerCommandStatus({...command('other-device'), tracker_id: 'target-3',
            device_ids: {rotator: 'another-mount'}, submitted_at: 103}));
        const commands = store.getState().targetSatTrack.trackerCommandsById;
        expect(selectTrackerCommand(commands, 'target-1', 'rotator', 'mount').commandId).toBe('other-mount');
        expect(selectTrackerCommand(commands, 'target-1', 'rotator').commandId).toBe('finished');
        expect(selectTrackerCommand(commands, 'target-1', 'rig', 'radio')).toBeNull();
    });

    it('stops treating reconciled uncertainty as outstanding after disconnect', () => {
        const {store} = setup();
        store.dispatch(setTrackerCommandStatus({...command('restored', 'rotator', 'unknown'), reconciled: true}));
        store.dispatch(setTrackerCommandStatus(command('unresolved', 'rig', 'unknown')));
        store.dispatch(markTrackerCommandsUnknown());
        const commands = store.getState().targetSatTrack.trackerCommandsById;
        expect(isCommandOutstanding(commands.restored)).toBe(false);
        expect(isCommandOutstanding(commands.unresolved)).toBe(true);
        expect(isCommandSpinning(commands.unresolved)).toBe(false);
    });

    it('bounds old outcomes while retaining unresolved work and recent terminal results through late ACKs', () => {
        const {store} = setup();
        const now = Date.now() / 1000;
        // More than 500 recent completions must stay until their ACK window expires.
        const completed = Array.from({length: 510}, (_, index) => ({
            ...command(`finished-${index}`, 'rotator', 'succeeded', 3), updated_at: now - index / 1000,
        }));
        store.dispatch(reconcileTrackerCommands({commands: [
            {...command('old', 'rotator', 'succeeded', 3), updated_at: now - 60},
            {...command('restored', 'rotator', 'unknown'), reconciled: true, updated_at: now - 60},
            {...command('pending'), updated_at: now - 60},
            {...command('unknown', 'rig', 'unknown'), updated_at: now - 60},
            ...completed,
        ]}));
        store.dispatch(setTrackerCommandStatus(command('finished-509')));
        let commands = store.getState().targetSatTrack.trackerCommandsById;
        expect(commands.old).toBeUndefined();
        expect(commands.restored).toBeUndefined();
        expect(commands.pending.status).toBe('submitted');
        expect(commands.unknown.status).toBe('unknown');
        expect(commands['finished-509'].status).toBe('succeeded');
        expect(Object.keys(commands)).toHaveLength(512);

        const clock = vi.spyOn(Date, 'now').mockReturnValue((now + 31) * 1000);
        try {
            store.dispatch(reconcileTrackerCommands({commands: []}));
            commands = store.getState().targetSatTrack.trackerCommandsById;
            expect(Object.keys(commands)).toHaveLength(502);
            expect(commands['finished-499']).toBeDefined();
            expect(commands['finished-500']).toBeUndefined();
            expect(commands.pending.status).toBe('submitted');
            expect(commands.unknown.status).toBe('unknown');
        } finally {
            clock.mockRestore();
        }
    });

    it('sends only explicitly changed state without reverting the other device', async () => {
        const {store, socket, requests} = setup();
        const result = store.dispatch(setTrackingStateInBackend({socket, data: {tracker_id: 'target-1'}, changes: {rig_state: 'connected'}}));
        expect(requests[0].request.data.value).toEqual({rig_state: 'connected'});
        requests[0].ack(null, {success: true, data: {}});
        await result;
    });

    it('preserves the backend-owned target key when retargeting', async () => {
        const {store, socket, requests} = setup();
        const result = store.dispatch(setTrackingStateInBackend({
            socket,
            data: {
                tracker_id: 'target-1',
                target_type: 'mission',
                target_key: 'mission:catalog:42',
                target_name: 'Juno',
                command: 'Juno',
            },
        }));

        expect(requests[0].request.data.value).toEqual(expect.objectContaining({
            target_type: 'mission',
            target_key: 'mission:catalog:42',
            target_name: 'Juno',
            command: 'Juno',
        }));
        requests[0].ack(null, {success: true, data: {}});
        await result;
    });

    it('creates a new tracker without applying local defaults as state preconditions', async () => {
        const initial = reducer(undefined, {type: '@@init'});
        const store = configureStore({
            reducer: {
                targetSatTrack: reducer,
                trackerInstances: () => ({instances: []}),
            },
            preloadedState: {
                targetSatTrack: {...initial, trackerId: 'target-1'},
            },
            middleware: getDefault => getDefault({serializableCheck: false}),
        });
        const requests = [];
        const socket = {
            connected: true,
            timeout: () => ({emit: (event, request, ack) => requests.push({request, ack})}),
        };
        const data = {
            tracker_id: 'target-1',
            target_type: 'satellite',
            target_name: 'ISS (ZARYA)',
            norad_id: 25544,
            group_id: 'group-1',
            rig_id: 'none',
            rotator_id: 'none',
            transmitter_id: 'none',
            rig_state: 'disconnected',
            rotator_state: 'disconnected',
            rig_vfo: 'none',
            vfo1: 'uplink',
            vfo2: 'downlink',
        };

        const result = store.dispatch(setTrackingStateInBackend({socket, data}));

        expect(requests[0].request.data.operation.expected_state).toEqual({});
        expect(requests[0].request.data.value).toEqual(expect.objectContaining({
            target_name: 'ISS (ZARYA)',
            norad_id: 25544,
            rotator_state: 'disconnected',
            rig_state: 'disconnected',
        }));
        requests[0].ack(null, {success: true, data: {}});
        await result;
    });

    it('Stop identifies a Move before its acknowledgement arrives', async () => {
        const {store, socket, requests} = setup();
        const moving = store.dispatch(moveRotatorToPosition({socket, trackerId: 'target-1', rotatorId: 'mount', az: 120, el: 45}));
        const stopping = store.dispatch(stopRotator({socket, trackerId: 'target-1', rotatorId: 'mount'}));
        expect(requests[1].request.data.supersedes).toContain(requests[0].request.data.command_id);
        requests.forEach(row => row.ack(null, {success: true, data: {}}));
        await Promise.all([moving, stopping]);
    });

    it('shows a newly sent Stop immediately when the server clock is ahead', async () => {
        const {store, socket, requests} = setup();
        store.dispatch(reconcileTrackerCommands({serverOffset: 3600000, commands: [
            {...command('move', 'rotator', 'started'), submitted_at: (Date.now() + 3599000) / 1000, action: 'move'},
        ]}));
        const stopping = store.dispatch(stopRotator({socket, trackerId: 'target-1', rotatorId: 'mount'}));
        expect(selectTrackerCommand(store.getState().targetSatTrack.trackerCommandsById, 'target-1', 'rotator').action).toBe('stop');
        requests[0].ack(null, {success: true, data: {}});
        await stopping;
    });

    it('lost acknowledgement is unknown and reconciles to the server result', async () => {
        const {store, socket, requests} = setup();
        const result = store.dispatch(moveRotatorToPosition({socket, trackerId: 'target-1', rotatorId: 'mount', az: 120, el: 45}));
        const id = requests[0].request.data.command_id;
        requests[0].ack(new Error('timeout'));
        await result;
        expect(store.getState().targetSatTrack.trackerCommandsById[id].status).toBe('unknown');
        store.dispatch(reconcileTrackerCommands({commands: [command(id, 'rotator', 'succeeded', 4)]}));
        expect(store.getState().targetSatTrack.trackerCommandsById[id].status).toBe('succeeded');
    });

    it('does not emit when disconnected', async () => {
        const {store, socket, requests} = setup();
        socket.connected = false;
        await store.dispatch(moveRotatorToPosition({socket, trackerId: 'target-1', rotatorId: 'mount', az: 120, el: 45}));
        expect(requests).toHaveLength(0);
        expect(Object.values(store.getState().targetSatTrack.trackerCommandsById)[0].status).toBe('failed');
    });

    it('reconciles local disconnect uncertainty even with an unchanged server revision', () => {
        const {store} = setup();
        store.dispatch(setTrackerCommandStatus(command('move', 'rotator', 'started', 2)));
        store.dispatch(markTrackerCommandsUnknown());
        store.dispatch(reconcileTrackerCommands({commands: [command('move', 'rotator', 'started', 2)]}));
        expect(store.getState().targetSatTrack.trackerCommandsById.move.status).toBe('started');
    });

    it('normalizes completion time when restoring results from a server with a different clock', () => {
        const {store} = setup();
        const completedAt = Date.now() - 5000;
        store.dispatch(reconcileTrackerCommands({serverOffset: 3600000, commands: [
            {...command('move', 'rotator', 'succeeded'), updated_at: (completedAt + 3600000) / 1000},
        ]}));
        expect(store.getState().targetSatTrack.trackerCommandsById.move.updatedAt).toBe(completedAt);
    });

    it('rejects old snapshots and records receipt of stationary hardware', () => {
        const {store} = setup();
        const snapshot = {tracker_id: 'target-1', worker_generation: 'worker', sequence: 2, observed_at: 200,
            rotator_data: {connected: true, az: 10, el: 20}};
        store.dispatch(setHardwareSnapshot(snapshot));
        store.dispatch(setHardwareSnapshot({...snapshot, sequence: 1, observed_at: 100, rotator_data: {connected: false}}));
        expect(store.getState().targetSatTrack.trackerViews['target-1'].rotatorData.connected).toBe(true);
        store.dispatch(setHardwareSnapshot({...snapshot, sequence: 3, observed_at: 300}));
        expect(store.getState().targetSatTrack.trackerViews['target-1'].hardwareObservedAt).toBe(300000);
    });

    it('restores desired state after failure or Stop without waiting for sky telemetry', () => {
        const {store} = setup();
        const desired = {...store.getState().targetSatTrack.trackingState, rotator_state: 'stopped'};
        store.dispatch(setHardwareSnapshot({tracker_id: 'target-1', worker_generation: 'worker', sequence: 1,
            observed_at: 200, tracking_state: desired, desired_state: desired}));
        expect(store.getState().targetSatTrack.trackingState.rotator_state).toBe('stopped');
        store.dispatch(setSatelliteData({tracker_id: 'target-1', tracking_state: {...desired, rotator_state: 'tracking'}}));
        expect(store.getState().targetSatTrack.trackingState.rotator_state).toBe('stopped');
        expect(store.getState().targetSatTrack.trackerViews['target-1'].trackingState.rotator_state).toBe('stopped');
    });
});

describe('manual dialog', () => {
    const props = {open: true, onClose: vi.fn(), onMove: vi.fn(), onStop: vi.fn(),
        rotator: {name: 'Mount'}, currentAz: 10, currentEl: 20, minAz: 0, maxAz: 360, minEl: 0, maxEl: 90,
        disabled: false, canStop: true};

    it('allows retrying an unconfirmed Stop while movement remains locked', () => {
        const onStop = vi.fn();
        render(<ManualRotatorDialog {...props} disabled onStop={onStop}
            rotatorStatus={{value: 'Motion unconfirmed'}}
            command={{action: 'stop', status: 'unknown', reconciled: true}} />);
        expect(screen.getByRole('status')).toHaveTextContent('Stop unconfirmed');
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'rotator_control.move'})).toBeDisabled();
        fireEvent.click(screen.getByRole('button', {name: 'rotator_control.stop'}));
        expect(onStop).toHaveBeenCalledOnce();
    });

    it('keeps Move busy after acceptance and allows Stop before slewing telemetry', () => {
        const onStop = vi.fn();
        render(<ManualRotatorDialog {...props} onStop={onStop} command={{action: 'move', status: 'submitted'}} />);
        expect(screen.getByRole('button', {name: 'rotator_control.move'})).toBeDisabled();
        fireEvent.click(screen.getByRole('button', {name: 'rotator_control.stop'}));
        expect(onStop).toHaveBeenCalledOnce();
        expect(screen.getByRole('status')).toHaveTextContent('Queued…');
    });

    it('can close while waiting for Stop and restores progress on reopening', () => {
        const onClose = vi.fn();
        const command = {action: 'stop', status: 'started'};
        const {rerender} = render(<ManualRotatorDialog {...props} onClose={onClose} command={command} />);
        fireEvent.click(screen.getByRole('button', {name: 'rotator_control.close'}));
        expect(onClose).toHaveBeenCalledOnce();
        rerender(<ManualRotatorDialog {...props} open={false} command={command} />);
        rerender(<ManualRotatorDialog {...props} command={command} />);
        expect(screen.getByRole('status')).toHaveTextContent('Stopping…');
        expect(screen.getByRole('button', {name: 'rotator_control.move'})).toBeDisabled();
    });

    it('shows worker failure and re-enables a valid Move', () => {
        render(<ManualRotatorDialog {...props} command={{action: 'move', status: 'failed', reason: 'Controller rejected movement'}} />);
        expect(screen.getByRole('status')).toHaveTextContent('Move failed');
        expect(screen.getByRole('status')).toHaveAttribute('title', expect.stringContaining('Controller rejected movement'));
        expect(screen.getByRole('button', {name: 'rotator_control.move'})).toBeEnabled();
    });
});
