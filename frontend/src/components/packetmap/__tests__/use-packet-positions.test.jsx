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

    it('retains live data while loading and queues changes during slow responses', async () => {
        vi.useFakeTimers();
        const {socket, requests, handlers} = socketMock();
        const liveRange = {...first, end: null};
        const {result, unmount} = renderHook(() => usePacketPositions(socket, liveRange));
        const initial = {positions: [{id: 'first'}], transmitters: [{id: 'sonde:A'}]};
        await act(async () => requests[0].reply(null, {success: true, data: initial}));
        act(() => {handlers.get('library.changed')(); vi.advanceTimersByTime(750);});
        expect(result.current).toMatchObject({...initial, loading: true});
        expect(requests[1].request.data).toEqual(liveRange);
        for (let index = 0; index < 3; index += 1) {
            act(() => {handlers.get('library.changed')(); vi.advanceTimersByTime(750);});
        }
        expect(requests).toHaveLength(2);
        await act(async () => requests[1].reply(null, {success: true, data: {positions: [{id: 'second'}]}}));
        expect(result.current.positions).toEqual([{id: 'second'}]);
        expect(requests).toHaveLength(3);
        await act(async () => requests[2].reply(null, {success: true, data: {positions: [{id: 'new-sonde'}]}}));
        expect(result.current.positions).toEqual([{id: 'new-sonde'}]);
        expect(result.current.loading).toBe(false);
        unmount();
    });

    it('supports LIVE on older servers by advancing the end date on each update', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(first.end));
        const {socket, requests, handlers} = socketMock();
        const liveRange = {...first, end: null};
        const {result} = renderHook(() => usePacketPositions(socket, liveRange));
        await act(async () => requests[0].reply(null, {success: false,
            error: 'start and end must be timezone-aware ISO dates or epoch seconds'}));
        expect(requests).toHaveLength(2);
        expect(requests[1].request.data).toEqual({...liveRange, end: new Date().toISOString()});
        await act(async () => requests[1].reply(null, {success: true, data: {positions: [{id: 'first'}]}}));
        expect(result.current.error).toBe('');
        vi.advanceTimersByTime(3600000);
        act(() => {handlers.get('library.changed')(); vi.advanceTimersByTime(750);});
        expect(requests).toHaveLength(3);
        expect(Date.parse(requests[2].request.data.end)).toBeGreaterThan(Date.parse(requests[1].request.data.end));
        expect(requests[2].request.data.start).toBe(liveRange.start);
        await act(async () => requests[2].reply(null, {success: true, data: {positions: [{id: 'new-sonde'}]}}));
        expect(result.current.positions).toEqual([{id: 'new-sonde'}]);
        expect(result.current.error).toBe('');
    });

    it('does not expose legacy date parser errors or retry invalid historical ranges', async () => {
        const {socket, requests} = socketMock();
        const {result} = renderHook(() => usePacketPositions(socket, first));
        await act(async () => requests[0].reply(null, {success: false,
            error: 'start and end must be timezone-aware ISO dates or epoch seconds'}));
        expect(result.current.error).toBe('Choose a valid date range.');
        expect(requests).toHaveLength(1);
    });

    it('does not reload history for aircraft appends but refreshes after deletion', async () => {
        vi.useFakeTimers();
        const {socket, requests, handlers} = socketMock();
        const {unmount} = renderHook(() => usePacketPositions(socket, first));
        await act(async () => requests[0].reply(null, {success: true, data: {positions: []}}));
        act(() => {
            handlers.get('library.changed')({changes: [{operation: 'updated', id: 'decoded_folder:adsb_406b90', item: {folder_kind: 'adsb'}}]});
            vi.advanceTimersByTime(1000);
        });
        expect(requests).toHaveLength(1);
        act(() => {
            handlers.get('library.changed')({changes: [{operation: 'deleted', id: 'decoded_folder:adsb_406b90'}]});
            vi.advanceTimersByTime(1000);
        });
        expect(requests).toHaveLength(2);
        unmount();
    });
});
