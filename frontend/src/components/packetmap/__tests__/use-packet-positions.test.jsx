import {act, renderHook, waitFor} from '@testing-library/react';
import {afterEach, describe, expect, it, vi} from 'vitest';
import usePacketPositions from '../use-packet-positions.js';

function socketMock() {
    const handlers = new Map();
    const requests = [];
    const socket = {
        connected: true, timeout: vi.fn(() => socket),
        emit: vi.fn((event, request, reply) => requests.push({event, request, reply})),
        on: vi.fn((event, handler) => handlers.set(event, handler)),
        off: vi.fn(),
    };
    return {socket, requests, handlers};
}
const first = {start: '2026-11-01T00:00:00Z', end: '2026-11-01T12:00:00Z'};
const second = {start: '2026-10-01T00:00:00Z', end: '2026-10-01T12:00:00Z'};

describe('Packet position loading', () => {
    afterEach(() => vi.useRealTimers());

    it('queries exact dates and discards late replies from an older range', async () => {
        const {socket, requests} = socketMock();
        const {result, rerender} = renderHook(({range}) => usePacketPositions(socket, range), {initialProps: {range: first}});
        expect(requests[0].request).toEqual({cmd: 'filebrowser.positions', data: first});
        rerender({range: second});
        await act(async () => requests[1].reply(null, {success: true, data: {positions: [{id: 'new'}]}}));
        await act(async () => requests[0].reply(null, {success: true, data: {positions: [{id: 'old'}]}}));
        expect(result.current.positions).toEqual([{id: 'new'}]);
        expect(result.current.loading).toBe(false);
    });

    it('clears old results for a new range and surfaces failures', async () => {
        const {socket, requests} = socketMock();
        const {result, rerender} = renderHook(({range}) => usePacketPositions(socket, range), {initialProps: {range: first}});
        await act(async () => requests[0].reply(null, {success: true, data: {positions: [{id: 'old'}]}}));
        rerender({range: second});
        expect(result.current.positions).toEqual([]);
        await act(async () => requests[1].reply(null, {success: false, error: 'Invalid interval'}));
        expect(result.current.error).toBe('Invalid interval');
        expect(result.current.loading).toBe(false);
    });

    it('recovers on reconnect and handles request timeouts', async () => {
        const {socket, requests, handlers} = socketMock();
        socket.connected = false;
        const {result} = renderHook(() => usePacketPositions(socket, first));
        await waitFor(() => expect(result.current.error).toBe('Not connected to server'));
        socket.connected = true;
        act(() => handlers.get('connect')());
        await act(async () => requests[0].reply(new Error('timeout')));
        expect(result.current.error).toBe('The library request timed out');
    });

    it('refreshes during continuous decoder traffic and cancels pending updates on unmount', async () => {
        vi.useFakeTimers();
        const {socket, requests, handlers} = socketMock();
        const {unmount} = renderHook(() => usePacketPositions(socket, first));
        await act(async () => requests[0].reply(null, {success: true, data: {positions: []}}));
        for (let index = 0; index < 4; index += 1) {
            act(() => {
                handlers.get('library.changed')();
                vi.advanceTimersByTime(250);
            });
        }
        expect(requests).toHaveLength(2);
        unmount();
        act(() => vi.advanceTimersByTime(1000));
        expect(requests).toHaveLength(2);
        expect(socket.off).toHaveBeenCalledWith('library.changed', expect.any(Function));
    });
});
