/** Copyright (c) 2026 Efstratios Goudelis, GPL-3.0-or-later */
import {createAsyncThunk, createSlice} from '@reduxjs/toolkit';

const active = (row) => row && ['sending', 'submitted', 'started', 'unknown'].includes(row.status) && !row.reconciled;
export const deviceKey = (kind, id) => `${kind}:${id}`;

function api(socket, cmd, data) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Command acknowledgement timed out')), 8000);
        socket.emit('api.call', {cmd, data}, (reply) => {
            clearTimeout(timer);
            if (reply?.success) resolve(reply.data);
            else reject(new Error(reply?.error || reply?.message || 'Hardware request failed'));
        });
    });
}

export const fetchHardwareState = createAsyncThunk('hardwareControl/fetch', async ({socket}) => (
    api(socket, 'get-hardware-state', {})
));

export const sendDeviceCommand = createAsyncThunk('hardwareControl/command', async (
    {socket, kind, deviceId, action, position}, {getState, dispatch, rejectWithValue, requestId},
) => {
    const state = getState().hardwareControl;
    const commandId = requestId;
    const generation = state.devices[deviceKey(kind, deviceId)]?.generation;
    const request = {
        kind, device_id: String(deviceId), action, position, generation,
        command_id: commandId, epoch: state.epoch,
        accept_before: Date.now() / 1000 + state.serverOffset + 10,
    };
    dispatch(receiveDeviceCommand({
        ...request, tracker_id: `manual:${kind}:${deviceId}`, device_ids: {[kind]: String(deviceId)},
        status: 'sending', submitted_at: Date.now() / 1000, revision: 0,
        clientSubmittedAt: Date.now(),
    }));
    try {
        const result = await api(socket, 'control-hardware', request);
        dispatch(receiveDeviceCommand(result.command));
        return result.command;
    } catch (error) {
        dispatch(receiveDeviceCommand({
            command_id: commandId, status: 'unknown', reason: error.message, reconciled: true,
        }));
        // A lost ACK does not prove that the backend rejected the operation.
        dispatch(fetchHardwareState({socket}));
        return rejectWithValue(error.message);
    }
});

function receiveCommand(state, command) {
    if (!command?.tracker_id?.startsWith('manual:') && !state.commands[command?.command_id]) return;
    const previous = state.commands[command.command_id];
    if (previous && ['succeeded', 'failed', 'cancelled'].includes(previous.status)) return;
    if (previous && (previous.revision || 0) > (command.revision ?? previous.revision ?? 0)) return;
    state.commands[command.command_id] = {...previous, ...command,
        clientSubmittedAt: previous?.clientSubmittedAt ?? (command.submitted_at * 1000 - state.serverOffset * 1000),
    };
}

function receiveSnapshot(state, snapshot) {
    if (!snapshot?.device_id || (state.epoch && snapshot.epoch !== state.epoch)) return;
    const key = deviceKey(snapshot.kind, snapshot.device_id);
    const previous = state.devices[key];
    if (previous?.worker_started_at > snapshot.worker_started_at) return;
    if (previous?.worker_generation === snapshot.worker_generation && previous.sequence >= snapshot.sequence) return;
    state.devices[key] = {...snapshot, receivedAt: Date.now()};
}

const slice = createSlice({
    name: 'hardwareControl',
    initialState: {epoch: null, serverOffset: 0, devices: {}, commands: {}, loaded: false},
    reducers: {
        receiveDeviceSnapshot: (state, {payload}) => receiveSnapshot(state, payload),
        receiveDeviceCommand: (state, {payload}) => receiveCommand(state, payload),
    },
    extraReducers: (builder) => builder.addCase(fetchHardwareState.fulfilled, (state, {payload}) => {
        if (state.epoch !== payload.epoch) {
            state.devices = {};
            for (const command of Object.values(state.commands)) {
                if (active(command)) Object.assign(command, {
                    status: 'unknown', reconciled: true, reason: 'Backend restarted; previous outcome is unknown',
                });
            }
        }
        state.epoch = payload.epoch;
        state.loaded = true;
        state.serverOffset = payload.server_time - Date.now() / 1000;
        payload.devices.forEach((snapshot) => receiveSnapshot(state, snapshot));
        payload.commands.forEach((command) => receiveCommand(state, command));
    }),
});

export const {receiveDeviceSnapshot, receiveDeviceCommand} = slice.actions;
export const isDeviceCommandActive = active;
export default slice.reducer;
