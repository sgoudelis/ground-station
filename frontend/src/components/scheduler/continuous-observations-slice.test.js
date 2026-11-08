import { configureStore } from '@reduxjs/toolkit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import reducer, {
    controlContinuousObservation, clearContinuousObservationSession, CONTINUOUS_REQUEST_TIMEOUT,
    continuousObservationsInitialState, definitionPayload, deleteContinuousObservation,
    fetchContinuousObservations, saveContinuousObservation,
} from './continuous-observations-slice.js';

const definition = { id: 'one', name: 'Monitoring', auto_start: true, config_version: 1,
    sdr: { id: 'radio' }, vfos: [], created_at: '2026-11-08T10:00:00.000001+00:00',
    updated_at: '2026-11-08T10:00:00.000001+00:00' };
const createStore = (state = {}) => configureStore({ reducer: { continuousObservations: reducer },
    preloadedState: { continuousObservations: { ...continuousObservationsInitialState, ...state } } });
const socketWithQueue = () => {
    const replies = [];
    return { connected: true, replies, emit: vi.fn((_event, _payload, reply) => replies.push(reply)) };
};

afterEach(() => vi.useRealTimers());

describe('durable continuous definitions', () => {
    it('ignores runtime replies after logout and preserves authoritative definition versions', async () => {
        const store = createStore({ definitions: [definition] });
        const socket = socketWithQueue();
        const pending = store.dispatch(controlContinuousObservation({ socket, observation: definition, command: 'start' }));
        expect(socket.emit.mock.calls[0][1].data).toEqual({ id: definition.id, expected_updated_at: definition.updated_at });
        store.dispatch(clearContinuousObservationSession());
        socket.replies[0]({ success: true, data: { id: definition.id, runtime: { status: 'running' } } });
        await pending.unwrap();
        expect(store.getState().continuousObservations.definitions).toEqual([]);
    });

    it('normalizes decoder modes for browser imports without mutating their drafts', () => {
        const draft = { ...definition, vfos: [{ modulation: 'fm', decoder: 'aprs' }] };
        expect(definitionPayload(draft).vfos).toEqual([{ modulation: 'none', decoder: 'aprs' }]);
        expect(draft.vfos[0].modulation).toBe('fm');
    });

    it('sends only editable fields and the original update version, then uses authoritative server data', async () => {
        const store = createStore({ definitions: [definition] });
        const socket = socketWithQueue();
        const pending = store.dispatch(saveContinuousObservation({ socket, observation: { ...definition, name: 'Edited' } }));
        const request = socket.emit.mock.calls[0][1];
        expect(request.cmd).toBe('continuous-observations.update');
        expect(request.data).toMatchObject({ name: 'Edited', expected_updated_at: definition.updated_at });
        expect(request.data).not.toHaveProperty('created_at');
        expect(request.data).not.toHaveProperty('updated_at');
        const saved = { ...definition, name: 'Edited', updated_at: '2026-11-08T10:00:00.000002+00:00' };
        socket.replies[0]({ success: true, data: saved });
        await pending.unwrap();
        expect(store.getState().continuousObservations.definitions).toEqual([saved]);
    });

    it('keeps state on failed writes and retains failed legacy imports', async () => {
        const store = createStore({ definitions: [definition], drafts: [definition] });
        const socket = socketWithQueue();
        const pending = store.dispatch(saveContinuousObservation({ socket, observation: definition, create: true }));
        expect(socket.emit.mock.calls[0][1].cmd).toBe('continuous-observations.create');
        socket.replies[0]({ success: false, error: 'Receiver missing', code: 'validation' });
        await expect(pending.unwrap()).rejects.toMatchObject({ message: 'Receiver missing' });
        expect(store.getState().continuousObservations.drafts).toEqual([definition]);
        const retry = store.dispatch(saveContinuousObservation({ socket, observation: definition, create: true }));
        socket.replies[1]({ success: true, data: definition });
        await retry.unwrap();
        expect(store.getState().continuousObservations.drafts).toEqual([]);
    });

    it('rejects offline requests immediately without buffering a write', async () => {
        const store = createStore();
        const socket = { connected: false, emit: vi.fn() };
        await expect(store.dispatch(saveContinuousObservation({ socket, observation: definition })).unwrap()).rejects.toMatchObject({ code: 'offline' });
        expect(socket.emit).not.toHaveBeenCalled();
    });

    it('times out, cleans up disconnect listeners, and ignores late replies', async () => {
        vi.useFakeTimers();
        const store = createStore();
        const socket = { ...socketWithQueue(), on: vi.fn(), off: vi.fn() };
        const pending = store.dispatch(fetchContinuousObservations({ socket }));
        const rejection = expect(pending.unwrap()).rejects.toMatchObject({ code: 'timeout' });
        await vi.advanceTimersByTimeAsync(CONTINUOUS_REQUEST_TIMEOUT);
        await rejection;
        socket.replies[0]({ success: true, data: [definition] });
        expect(store.getState().continuousObservations.definitions).toEqual([]);
        expect(socket.off).toHaveBeenCalledWith('disconnect', expect.any(Function));
    });

    it('rejects on disconnect and never accepts a subsequent acknowledgement', async () => {
        const store = createStore();
        const socket = { ...socketWithQueue(), on: vi.fn(), off: vi.fn() };
        const pending = store.dispatch(fetchContinuousObservations({ socket }));
        socket.on.mock.calls[0][1]();
        await expect(pending.unwrap()).rejects.toMatchObject({ code: 'offline' });
        socket.replies[0]({ success: true, data: [definition] });
        expect(store.getState().continuousObservations.definitions).toEqual([]);
    });

    it('ignores out-of-order lists and lists started before a committed delete', async () => {
        const store = createStore({ definitions: [definition] });
        const socket = socketWithQueue();
        const first = store.dispatch(fetchContinuousObservations({ socket }));
        const second = store.dispatch(fetchContinuousObservations({ socket }));
        socket.replies[1]({ success: true, data: [definition] });
        await second;
        socket.replies[0]({ success: true, data: [] });
        await first;
        expect(store.getState().continuousObservations.definitions).toEqual([definition]);
        const stale = store.dispatch(fetchContinuousObservations({ socket }));
        const removed = store.dispatch(deleteContinuousObservation({ socket, observation: definition }));
        expect(socket.emit.mock.calls[3][1].data).toEqual({ id: definition.id, expected_updated_at: definition.updated_at });
        socket.replies[3]({ success: true, data: { id: definition.id } });
        await removed;
        socket.replies[2]({ success: true, data: [definition] });
        await stale;
        expect(store.getState().continuousObservations.definitions).toEqual([]);
    });

    it('ignores pending backend replies after an authentication reset and preserves browser drafts', async () => {
        const store = createStore({ definitions: [definition], drafts: [definition] });
        const socket = socketWithQueue();
        const list = store.dispatch(fetchContinuousObservations({ socket }));
        const save = store.dispatch(saveContinuousObservation({ socket, observation: definition }));
        const remove = store.dispatch(deleteContinuousObservation({ socket, observation: definition }));
        store.dispatch(clearContinuousObservationSession());
        socket.replies[0]({ success: true, data: [definition] });
        socket.replies[1]({ success: true, data: definition });
        socket.replies[2]({ success: true, data: { id: definition.id } });
        await Promise.all([list, save, remove]);
        expect(store.getState().continuousObservations).toMatchObject({ definitions: [], drafts: [definition], loaded: false, loading: false });
    });

    it('does not overwrite a newer broadcast result with an older save acknowledgement in the same millisecond', async () => {
        const newer = { ...definition, name: 'Newer', updated_at: '2026-11-08T10:00:00.000003+00:00' };
        const store = createStore({ definitions: [newer] });
        const socket = socketWithQueue();
        const pending = store.dispatch(saveContinuousObservation({ socket, observation: definition }));
        socket.replies[0]({ success: true, data: { ...definition, updated_at: '2026-11-08T10:00:00.000002+00:00' } });
        await pending;
        expect(store.getState().continuousObservations.definitions).toEqual([newer]);
    });
});
