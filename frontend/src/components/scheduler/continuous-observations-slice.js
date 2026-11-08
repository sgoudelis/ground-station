// Copyright (c) 2026 Efstratios Goudelis
// SPDX-License-Identifier: GPL-3.0-or-later

import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { normalizeContinuousVfo } from './continuous-observation-utils.js';

export const CONTINUOUS_REQUEST_TIMEOUT = 15000;

function request(socket, command, data, timeout = CONTINUOUS_REQUEST_TIMEOUT) {
    return new Promise((resolve, reject) => {
        if (!socket || socket.connected === false) {
            reject({ message: 'Connect to the backend before continuing.', code: 'offline' });
            return;
        }
        let settled = false;
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.off?.('disconnect', disconnected);
            if (error) reject(error);
            else resolve(value);
        };
        const disconnected = () => finish({ message: 'Connection lost. Reconnect and retry.', code: 'offline' });
        const timer = setTimeout(() => finish({
            message: 'The backend did not respond. Refresh before retrying; the change may have been saved.', code: 'timeout',
        }), timeout);
        socket.on?.('disconnect', disconnected);
        try {
            socket.emit('api.call', { cmd: command, data }, (reply) => {
                if (reply?.success) finish(null, reply.data);
                else finish({ message: reply?.error || 'Unable to save continuous observations.', code: reply?.code });
            });
        } catch {
            finish({ message: 'Unable to contact the backend.', code: 'offline' });
        }
    });
}

// Only the definition is editable; timestamps and receiver names come from the server.
export function definitionPayload(observation) {
    const { id, name, auto_start, sdr, vfos, config_version = 1 } = observation;
    return { id, name, auto_start, sdr, vfos: vfos.map(normalizeContinuousVfo), config_version };
}

// Python timestamps retain microseconds; Date.parse alone loses that precision.
const timestampOrder = (value) => {
    const [seconds, fraction = ''] = value.replace(/(?:Z|\+00:00)$/, '').split('.');
    return `${seconds}.${fraction.padEnd(6, '0')}`;
};

const scope = (getState) => {
    const { epoch, revision } = getState().continuousObservations;
    return { epoch, revision };
};

export const fetchContinuousObservations = createAsyncThunk('continuousObservations/fetch', async ({ socket }, api) => {
    const version = scope(api.getState);
    try {
        const data = await request(socket, 'continuous-observations.list', {});
        return { data, ...version };
    } catch (error) {
        return api.rejectWithValue(error);
    }
});

export const saveContinuousObservation = createAsyncThunk('continuousObservations/save', async ({ socket, observation, create = !observation.updated_at }, api) => {
    const { epoch } = scope(api.getState);
    const payload = definitionPayload(observation);
    if (!create) payload.expected_updated_at = observation.updated_at;
    try {
        const data = await request(socket, `continuous-observations.${create ? 'create' : 'update'}`, payload);
        return { data, epoch, create };
    } catch (error) {
        return api.rejectWithValue(error);
    }
});

export const deleteContinuousObservation = createAsyncThunk('continuousObservations/delete', async ({ socket, observation }, api) => {
    const { epoch } = scope(api.getState);
    try {
        const data = await request(socket, 'continuous-observations.delete', {
            id: observation.id, expected_updated_at: observation.updated_at,
        });
        return { data, epoch };
    } catch (error) {
        return api.rejectWithValue(error);
    }
});

// Runtime transitions refetch the list; no definition timestamps are fabricated.
export const controlContinuousObservation = createAsyncThunk('continuousObservations/control', async ({ socket, observation, command }, api) => {
    const { epoch } = scope(api.getState);
    try {
        const data = await request(socket, `continuous-observations.${command}`, {
            id: observation.id,
            ...(command === 'start' ? { expected_updated_at: observation.updated_at } : {}),
        }, 60000);
        return { data, epoch };
    } catch (error) {
        return api.rejectWithValue(error);
    }
});

export const continuousObservationsInitialState = {
    definitions: [], drafts: [], loaded: false, loading: false, error: null,
    epoch: 0, revision: 0, fetchRequest: null,
};

const continuousObservationsSlice = createSlice({
    name: 'continuousObservations',
    initialState: continuousObservationsInitialState,
    reducers: {
        clearContinuousObservationSession(state) {
            // Legacy browser drafts survive logout; backend data and late replies do not.
            return { ...continuousObservationsInitialState, drafts: state.drafts, epoch: state.epoch + 1 };
        },
    },
    extraReducers: (builder) => builder
        .addCase(fetchContinuousObservations.pending, (state, action) => {
            state.fetchRequest = action.meta.requestId;
            state.loading = true;
            state.error = null;
        })
        .addCase(fetchContinuousObservations.fulfilled, (state, action) => {
            if (state.fetchRequest !== action.meta.requestId) return;
            state.loading = false;
            state.fetchRequest = null;
            // A list started before a write must never resurrect deleted/older rows.
            if (action.payload.epoch !== state.epoch || action.payload.revision !== state.revision) return;
            state.definitions = action.payload.data;
            state.loaded = true;
        })
        .addCase(fetchContinuousObservations.rejected, (state, action) => {
            if (state.fetchRequest !== action.meta.requestId) return;
            state.loading = false;
            state.fetchRequest = null;
            state.error = action.payload?.message || action.error.message;
        })
        .addCase(saveContinuousObservation.fulfilled, (state, { payload }) => {
            if (payload.epoch !== state.epoch) return;
            const index = state.definitions.findIndex((entry) => entry.id === payload.data.id);
            // Concurrent acknowledgement order must not roll a newer definition back.
            if (index === -1) state.definitions.push(payload.data);
            else if (timestampOrder(state.definitions[index].updated_at) <= timestampOrder(payload.data.updated_at)) {
                state.definitions[index] = payload.data;
            }
            if (payload.create) state.drafts = state.drafts.filter((entry) => entry.id !== payload.data.id);
            state.revision += 1;
        })
        .addCase(controlContinuousObservation.fulfilled, (state, { payload }) => {
            if (payload.epoch !== state.epoch) return;
            const entry = state.definitions.find((row) => row.id === payload.data.id);
            if (entry) entry.runtime = payload.data.runtime;
            state.revision += 1;
        })
        .addCase(deleteContinuousObservation.fulfilled, (state, { payload }) => {
            if (payload.epoch !== state.epoch) return;
            state.definitions = state.definitions.filter((entry) => entry.id !== payload.data.id);
            state.revision += 1;
        }),
});

export const { clearContinuousObservationSession } = continuousObservationsSlice.actions;
export default continuousObservationsSlice.reducer;
