import {afterEach, expect, it, vi} from 'vitest';
import {createAircraftStore} from '../aircraft-store.js';

function connection() {
    const handlers = new Map();
    const socket = {
        connected: true,
        on: vi.fn((event, callback) => handlers.set(event, callback)),
        off: vi.fn((event) => handlers.delete(event)),
        emit: vi.fn((_event, request, reply) => reply?.({success: true, data: {aircraft: []}})),
    };
    return {socket, handlers};
}
const aircraft = (address, timestamp = Date.now() / 1000) => ({icao: address, timestamp,
    position_timestamp: timestamp, latitude: 40, longitude: 23});
afterEach(() => vi.useRealTimers());

it('batches a busy fleet into one publication and shares its socket subscription', () => {
    vi.useFakeTimers();
    const {socket, handlers} = connection();
    const store = createAircraftStore(socket);
    const changed = vi.fn();
    const stop = store.subscribe(changed);
    const stopSecond = store.subscribe(vi.fn());
    for (let message = 0; message < 1000; message += 1) {
        handlers.get('adsb.aircraft')({aircraft: [aircraft((message % 100).toString(16).padStart(6, '0'))]});
    }
    expect(changed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot().aircraft).toHaveLength(100);
    expect(socket.emit.mock.calls.filter((call) => call[1].data.enabled)).toHaveLength(1);
    stop();
    expect(handlers.has('adsb.aircraft')).toBe(true);
    stopSecond();
    expect(handlers.has('adsb.aircraft')).toBe(false);
    expect(socket.emit.mock.lastCall[1].data.enabled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
});

it('bounds trail memory, ignores older states and removes silent aircraft', () => {
    vi.useFakeTimers();
    const {socket, handlers} = connection();
    const store = createAircraftStore(socket);
    const stop = store.subscribe(vi.fn());
    const now = Date.now() / 1000;
    for (let i = 0; i < 200; i += 1) handlers.get('adsb.aircraft')({aircraft: [aircraft('406b90', now - 40 + i / 5)]});
    handlers.get('adsb.aircraft')({aircraft: [aircraft('406b90', now - 100)]});
    vi.advanceTimersByTime(1000);
    expect(store.getSnapshot().positions).toHaveLength(120);
    expect(store.getSnapshot().aircraft[0].timestamp).toBeCloseTo(now - .2);
    vi.advanceTimersByTime(61000);
    expect(store.getSnapshot().aircraft).toHaveLength(0);
    stop();
});

it('does not resurrect a subscription from a late acknowledgement after unmount', () => {
    vi.useFakeTimers();
    const {socket} = connection();
    let reply;
    socket.emit.mockImplementation((_event, _request, callback) => {if (callback) reply = callback;});
    const store = createAircraftStore(socket);
    const stop = store.subscribe(vi.fn());
    stop();
    reply({success: true, data: {aircraft: [aircraft('406b90')]}});
    vi.advanceTimersByTime(1000);
    expect(store.getSnapshot().aircraft).toEqual([]);
});
