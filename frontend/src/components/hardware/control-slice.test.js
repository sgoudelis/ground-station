import {describe, expect, it} from 'vitest';
import reducer, {fetchHardwareState, receiveDeviceCommand, receiveDeviceSnapshot} from './control-slice.js';

const boot = (epoch = 'boot') => reducer(undefined, fetchHardwareState.fulfilled({
    epoch, server_time: Date.now() / 1000, devices: [], commands: [],
}));
const snapshot = (extra = {}) => ({
    kind: 'rotator', device_id: 'mount', epoch: 'boot', generation: 'lease',
    worker_generation: 'worker', worker_started_at: 10, sequence: 1,
    data: {connected: true}, ...extra,
});

describe('device control reconciliation', () => {
    it('rejects queued observations from a replaced device worker', () => {
        let state = reducer(boot(), receiveDeviceSnapshot(snapshot()));
        state = reducer(state, receiveDeviceSnapshot(snapshot({worker_generation: 'replacement', worker_started_at: 20})));
        state = reducer(state, receiveDeviceSnapshot(snapshot({sequence: 100, data: {connected: false}})));
        expect(state.devices['rotator:mount'].worker_generation).toBe('replacement');
        expect(state.devices['rotator:mount'].data.connected).toBe(true);
    });

    it('keeps a completed command when a delayed acceptance arrives', () => {
        const command = {tracker_id: 'manual:rotator:mount', command_id: 'move', revision: 3, status: 'succeeded'};
        let state = reducer(boot(), receiveDeviceCommand(command));
        state = reducer(state, receiveDeviceCommand({...command, status: 'submitted', revision: 1}));
        expect(state.commands.move.status).toBe('succeeded');
    });

    it('marks previous work unknown after backend restart and rejects old telemetry', () => {
        let state = reducer(boot(), receiveDeviceCommand({
            tracker_id: 'manual:rotator:mount', command_id: 'move', status: 'started',
        }));
        state = reducer(state, fetchHardwareState.fulfilled({
            epoch: 'replacement', server_time: Date.now() / 1000, devices: [], commands: [],
        }));
        state = reducer(state, receiveDeviceSnapshot(snapshot()));
        expect(state.commands.move).toMatchObject({status: 'unknown', reconciled: true});
        expect(state.devices).toEqual({});
    });
});
