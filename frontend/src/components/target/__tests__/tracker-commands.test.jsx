import React from 'react';
import {describe, expect, it, vi} from 'vitest';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {fireEvent, render, screen} from '@testing-library/react';
import reducer, {setTrackingStateInBackend, moveRotatorToPosition, stopRotator,
    setTrackerCommandStatus, setHardwareSnapshot, setSatelliteData, setTrackerId, setRadioRig,
    reconcileTrackerCommands, markTrackerCommandsUnknown} from '../target-slice.jsx';
import {isCommandOutstanding, isCommandSpinning, selectTrackerCommand} from '../tracker-command-state.js';
import ManualRotatorDialog from '../../dashboard/manual-rotator-dialog.jsx';
import dashboard from '../../dashboard/dashboard-slice.jsx';

// The module under test pulls in the shared i18n instance, so keep the rest of the
// react-i18next module (notably initReactI18next) and only stub the hook.
vi.mock('react-i18next', async importOriginal => ({
    ...await importOriginal(), useTranslation: () => ({t: (key, options) => options?.defaultValue ?? key}),
}));

function setup(serverEpoch = 'test-epoch') {
    const initial = reducer(undefined, {type: '@@init'});
    const trackingState = {rotator_id: 'mount', rotator_state: 'connected', rig_id: 'radio', rig_state: 'disconnected'};
    const store = configureStore({reducer: {targetSatTrack: reducer, trackerInstances: () => ({instances: [{tracker_id: 'target-1'}]})},
        preloadedState: {targetSatTrack: {...initial, trackerId: 'target-1', trackerServerEpoch: serverEpoch, trackingState,
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
    it('clears a previous target orbit when the tracker changes satellites', () => {
        let state = {...reducer(undefined, {type: '@@init'}), trackerId: 'target-1'};
        state = reducer(state, setSatelliteData({
            tracker_id: 'target-1',
            satellite_data: {details: {norad_id: 100000, orbit_format: 'omm', orbit_payload: {EPOCH: '2026-10-01'}}},
        }));
        state = reducer(state, setSatelliteData({
            tracker_id: 'target-1',
            satellite_data: {details: {norad_id: 25544, name: 'New target', tle1: '1 new'}},
        }));
        expect(state.satelliteData.details.norad_id).toBe(25544);
        expect(state.satelliteData.details.orbit_payload).toBeNull();
        expect(state.satelliteData.details.orbit_format).toBe('');
    });

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

    it('expires old outcomes while retaining unfinished work and recent results', () => {
        const {store} = setup();
        const now = Date.now() / 1000;
        store.dispatch(reconcileTrackerCommands({commands: [
            {...command('old', 'rotator', 'succeeded', 3), updated_at: now - 61},
            {...command('restored', 'rotator', 'unknown'), reconciled: true, updated_at: now - 61},
            {...command('pending'), updated_at: now - 61},
            {...command('unknown', 'rig', 'unknown'), updated_at: now - 61},
            {...command('recent', 'rotator', 'succeeded', 3), updated_at: now - 1},
        ]}));
        let commands = store.getState().targetSatTrack.trackerCommandsById;
        expect(commands.old).toBeUndefined();
        expect(commands.restored).toBeUndefined();
        expect(commands.pending.status).toBe('submitted');
        expect(commands.unknown.status).toBe('unknown');
        expect(commands.recent.status).toBe('succeeded');

        const clock = vi.spyOn(Date, 'now').mockReturnValue((now + 61) * 1000);
        try {
            store.dispatch(reconcileTrackerCommands({commands: []}));
            commands = store.getState().targetSatTrack.trackerCommandsById;
            expect(commands.recent).toBeUndefined();
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
                targetSatTrack: {...initial, trackerId: 'target-1', trackerServerEpoch: 'test-epoch'},
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

    it('fences requests to one backend epoch and preserves uncertainty after restart', async () => {
        const {store, socket, requests} = setup();
        store.dispatch(reconcileTrackerCommands({epoch: 'old-worker', commands: []}));
        const result = store.dispatch(moveRotatorToPosition({socket, trackerId: 'target-1', rotatorId: 'mount', az: 120, el: 45}));
        const id = requests[0].request.data.command_id;
        expect(requests[0].request.data.epoch).toBe('old-worker');
        requests[0].ack(new Error('timeout'));
        await result;
        store.dispatch(setTrackerCommandStatus(command('previous', 'rig', 'succeeded')));

        store.dispatch(reconcileTrackerCommands({epoch: 'new-worker', server_time: Date.now() / 1000 + 30, commands: []}));
        const oldCommand = store.getState().targetSatTrack.trackerCommandsById[id];
        expect(oldCommand.status).toBe('unknown');
        expect(oldCommand.reconciled).toBe(true);
        expect(oldCommand.reason).toContain('Backend restarted');
        expect(store.getState().targetSatTrack.trackerCommandsById.previous).toBeUndefined();
    });

    it('fetches the backend epoch before the first hardware command', async () => {
        const {store, socket, requests} = setup(null);
        const result = store.dispatch(moveRotatorToPosition({socket, trackerId: 'target-1', rotatorId: 'mount', az: 120, el: 45}));
        expect(requests[0].request.cmd).toBe('get-tracker-commands');
        requests[0].ack(null, {success: true, data: {epoch: 'new-worker', server_time: Date.now() / 1000, commands: [], trackers: {}}});
        await vi.waitFor(() => expect(requests).toHaveLength(2));
        expect(requests[1].request.data.epoch).toBe('new-worker');
        requests[1].ack(null, {success: true, data: {}});
        await result;
    });

    it('does not claim an expired command was rejected after its result was pruned', () => {
        const {store} = setup();
        store.dispatch(setTrackerCommandStatus({...command('lost'), accept_before: 10}));
        store.dispatch(reconcileTrackerCommands({epoch: 'test-epoch', server_time: 100, commands: []}));
        const lost = store.getState().targetSatTrack.trackerCommandsById.lost;
        expect(lost.status).toBe('unknown');
        expect(lost.reconciled).toBe(true);
        expect(lost.reason).toContain('unavailable');
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

    it('fills OBS hardware menus from the scoped tracker state and transmitter telemetry', () => {
        const {store} = setup();
        const desired = {norad_id: 43880, rig_id: 'radio', rotator_id: 'mount',
            transmitter_id: 'tx-1', rig_vfo: 'none', vfo1: 'uplink', vfo2: 'downlink'};
        store.dispatch(setHardwareSnapshot({
            tracker_id: 'obs-pass', worker_generation: 'worker', sequence: 1, observed_at: 200,
            tracking_state: desired, desired_state: desired,
            rotator_data: {connected: true},
            rig_data: {connected: true, transmitters: [{id: 'tx-1', downlink_low: 145800000}]},
        }));
        store.dispatch(setTrackerId('obs-pass'));

        let selected = store.getState().targetSatTrack;
        expect(selected.selectedRotator).toBe('mount');
        expect(selected.selectedRadioRig).toBe('radio');
        expect(selected.selectedTransmitter).toBe('tx-1');
        expect(selected.selectedVFO1).toBe('uplink');
        expect(selected.selectedVFO2).toBe('downlink');
        expect(selected.availableTransmitters.map((tx) => tx.id)).toEqual(['tx-1']);

        store.dispatch(setSatelliteData({
            tracker_id: 'obs-pass',
            tracking_state: {...desired, rig_id: 'none', transmitter_id: 'none', vfo1: 'downlink'},
            satellite_data: {transmitters: [
                {id: 'tx-1', downlink_low: 145800000},
                {id: 'tx-2', downlink_low: 436800000},
            ]},
        }));
        selected = store.getState().targetSatTrack;
        expect(selected.selectedRadioRig).toBe('radio');
        expect(selected.selectedTransmitter).toBe('tx-1');
        expect(selected.selectedVFO1).toBe('uplink');
        expect(selected.availableTransmitters.map((tx) => tx.id)).toEqual(['tx-1', 'tx-2']);
    });

    it('keeps a regular target slot\'s staged rig selection during hardware snapshots', () => {
        const {store} = setup();
        store.dispatch(setRadioRig({value: 'staged-radio', trackerId: 'target-1'}));
        store.dispatch(setHardwareSnapshot({
            tracker_id: 'target-1', worker_generation: 'worker', sequence: 1, observed_at: 200,
            desired_state: {rig_id: 'radio'},
        }));
        expect(store.getState().targetSatTrack.trackerViews['target-1'].selectedRadioRig).toBe('staged-radio');
    });
});

describe('manual dialog', () => {
    const renderManualDialog = (ui) => {
        const store = configureStore({reducer: {dashboard}});
        return render(ui, {wrapper: ({children}) => <Provider store={store}>{children}</Provider>});
    };
    const props = {open: true, onClose: vi.fn(), onMove: vi.fn(), onStop: vi.fn(),
        rotator: {name: 'Mount'}, currentAz: 10, currentEl: 20, minAz: 0, maxAz: 360, minEl: 0, maxEl: 90,
        disabled: false, canStop: true};

    it('uses one status row for movement and returns to the current hardware state', () => {
        const {rerender} = renderManualDialog(<ManualRotatorDialog {...props} rotatorStatus={{key: 'slewing'}}
            command={{action: 'move', status: 'started'}} />);

        expect(screen.getAllByRole('status')).toHaveLength(1);
        expect(screen.getByRole('status')).toHaveTextContent(/^Moving…$/);
        expect(screen.queryByText('Slewing')).not.toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveAttribute('title', expect.stringContaining('Hardware: Slewing'));

        rerender(<ManualRotatorDialog {...props} rotatorStatus={{key: 'stopped'}}
            command={{action: 'move', status: 'succeeded', updatedAt: Date.now() - 4000}} />);

        expect(screen.getAllByRole('status')).toHaveLength(1);
        expect(screen.getByRole('status')).toHaveTextContent(/^Stopped$/);
        expect(screen.getByTestId('StopIcon')).toBeInTheDocument();
        expect(screen.queryByText('Moving…')).not.toBeInTheDocument();
    });

    it('allows retrying an unconfirmed Stop while movement remains locked', () => {
        const onStop = vi.fn();
        renderManualDialog(<ManualRotatorDialog {...props} disabled onStop={onStop}
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
        renderManualDialog(<ManualRotatorDialog {...props} onStop={onStop} command={{action: 'move', status: 'submitted'}} />);
        expect(screen.getByRole('button', {name: 'rotator_control.move'})).toBeDisabled();
        fireEvent.click(screen.getByRole('button', {name: 'rotator_control.stop'}));
        expect(onStop).toHaveBeenCalledOnce();
        expect(screen.getByRole('status')).toHaveTextContent('Queued…');
    });

    it('can close while waiting for Stop and restores progress on reopening', () => {
        const onClose = vi.fn();
        const command = {action: 'stop', status: 'started'};
        const {rerender} = renderManualDialog(<ManualRotatorDialog {...props} onClose={onClose} command={command} />);
        fireEvent.click(screen.getByRole('button', {name: 'rotator_control.close'}));
        expect(onClose).toHaveBeenCalledOnce();
        rerender(<ManualRotatorDialog {...props} open={false} command={command} />);
        rerender(<ManualRotatorDialog {...props} command={command} />);
        expect(screen.getByRole('status')).toHaveTextContent('Stopping…');
        expect(screen.getByRole('button', {name: 'rotator_control.move'})).toBeDisabled();
    });

    it('shows worker failure and re-enables a valid Move', () => {
        renderManualDialog(<ManualRotatorDialog {...props} command={{action: 'move', status: 'failed', reason: 'Controller rejected movement'}} />);
        expect(screen.getByRole('status')).toHaveTextContent('Move failed');
        expect(screen.getByRole('status')).toHaveAttribute('title', expect.stringContaining('Controller rejected movement'));
        expect(screen.getByRole('button', {name: 'rotator_control.move'})).toBeEnabled();
    });
});
