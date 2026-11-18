import {act, renderHook} from '@testing-library/react';
import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import useCalendarEvents from './use-calendar-events.js';

const {socket, handlers} = vi.hoisted(() => {
    const handlers = new Map();
    const socket = {timeout: vi.fn(), emitWithAck: vi.fn(),
        on: vi.fn((name, callback) => handlers.set(name, callback)),
        off: vi.fn((name, callback) => {if (handlers.get(name) === callback) handlers.delete(name);}),
    };
    return {socket, handlers};
});
vi.mock('../common/socket.jsx', () => ({useSocket: () => ({socket})}));

const initialProps = {start: '2026-11-01', end: '2026-12-01', timezone: 'UTC'};
const reply = events => ({success: true, data: {events}});
const deferred = () => {
    let resolve;
    const promise = new Promise(done => {resolve = done;});
    return {promise, resolve};
};

beforeEach(() => {
    vi.useFakeTimers();
    handlers.clear();
    socket.timeout.mockReset().mockReturnValue(socket);
    socket.emitWithAck.mockReset().mockResolvedValue(reply([]));
});
afterEach(() => vi.useRealTimers());

it('hides old periods and ignores their late responses after navigating or changing timezone', async () => {
    const old = deferred();
    socket.emitWithAck.mockReturnValueOnce(old.promise);
    const {result, rerender} = renderHook(useCalendarEvents, {initialProps});
    expect(result.current.loading).toBe(true);
    const next = deferred();
    socket.emitWithAck.mockReturnValueOnce(next.promise);
    rerender({...initialProps, start: '2026-12-01', end: '2027-01-01', timezone: 'Asia/Tokyo'});
    expect(result.current.events).toEqual([]);
    await act(async () => next.resolve(reply([{id: 'new-period'}])));
    await act(async () => old.resolve(reply([{id: 'stale-period'}])));
    expect(result.current.events).toEqual([{id: 'new-period'}]);
    expect(socket.timeout).toHaveBeenCalledWith(15000);
    expect(socket.emitWithAck).toHaveBeenLastCalledWith('api.call', {
        cmd: 'get-calendar-events', data: {start: '2026-12-01', end: '2027-01-01', timezone: 'Asia/Tokyo'},
    });
});

it('coalesces generation/status notifications and refreshes after reconnecting', async () => {
    const {result} = renderHook(useCalendarEvents, {initialProps});
    await act(async () => {});
    socket.emitWithAck.mockResolvedValue(reply([{id: 'updated'}]));
    act(() => {
        handlers.get('scheduled-observations-changed')();
        handlers.get('scheduled-observations-changed')();
        handlers.get('observation-status-update')();
    });
    expect(socket.emitWithAck).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(150));
    expect(socket.emitWithAck).toHaveBeenCalledTimes(2);
    expect(result.current.events).toEqual([{id: 'updated'}]);
    act(() => handlers.get('connect')());
    await act(async () => vi.advanceTimersByTimeAsync(150));
    expect(socket.emitWithAck).toHaveBeenCalledTimes(3);
});

it('retains the latest snapshot when an older refresh finishes later', async () => {
    const old = deferred();
    socket.emitWithAck.mockReturnValueOnce(old.promise).mockResolvedValueOnce(reply([{id: 'fresh'}]));
    const {result} = renderHook(useCalendarEvents, {initialProps});
    act(() => handlers.get('observation-status-update')());
    await act(async () => vi.advanceTimersByTimeAsync(150));
    await act(async () => old.resolve(reply([{id: 'stale'}])));
    expect(result.current.events).toEqual([{id: 'fresh'}]);
});

it('refreshes shared external state and immediately removes announcements on opt-out', async () => {
    socket.emitWithAck.mockResolvedValue({success: true, data: {
        events: [{id: 'local', source: 'observations'}, {id: 'remote', source: 'gscontrol'}],
        sources: [{id: 'gscontrol', enabled: true}],
    }});
    const {result} = renderHook(useCalendarEvents, {initialProps});
    await act(async () => {});
    expect(result.current.external.enabled).toBe(true);
    socket.emitWithAck.mockReturnValue(new Promise(() => {}));
    act(() => result.current.updateExternal({id: 'gscontrol', enabled: false}));
    expect(result.current.external.enabled).toBe(false);
    expect(result.current.events).toEqual([{id: 'local', source: 'observations'}]);
    act(() => handlers.get('external-events-changed')());
    await act(async () => vi.advanceTimersByTimeAsync(150));
    expect(socket.emitWithAck).toHaveBeenCalledTimes(3);
});

it('cleans up listeners and queued refreshes on unmount', async () => {
    const {unmount} = renderHook(useCalendarEvents, {initialProps});
    await act(async () => {});
    act(() => handlers.get('scheduled-observations-changed')());
    unmount();
    expect(handlers.size).toBe(0);
    await act(async () => vi.advanceTimersByTimeAsync(200));
    expect(socket.emitWithAck).toHaveBeenCalledTimes(1);
});

it.each([{success: false}, {success: true, data: {}}, null])('rejects invalid/error envelopes and allows retry: %j', async response => {
    socket.emitWithAck.mockResolvedValueOnce(response);
    const {result} = renderHook(useCalendarEvents, {initialProps});
    await act(async () => {});
    expect(result.current.error).toBe(true);
    expect(result.current.events).toEqual([]);
    act(() => result.current.refresh());
    await act(async () => {});
    expect(result.current.error).toBe(false);
    expect(result.current.loading).toBe(false);
});
