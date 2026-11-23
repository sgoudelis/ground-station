import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStationTimezone } from './useStationTimezone.js';

const reply = (timezone) => ({ success: true, data: { timezone } });
const deferred = () => {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
};

describe('station timezone selection', () => {
    let socket;
    beforeEach(() => {
        vi.useFakeTimers();
        socket = { connected: true, timeout: vi.fn(), emitWithAck: vi.fn() };
        socket.timeout.mockReturnValue(socket);
    });
    afterEach(() => vi.useRealTimers());

    const renderTimezone = () => renderHook(
        (props) => useStationTimezone({ socket, ...props }),
        { initialProps: { latitude: 52.3676, longitude: 4.9041 } },
    );
    const startLookup = async () => act(async () => { await vi.advanceTimersByTimeAsync(200); });

    it('uses the backend coordinate lookup instead of the browser timezone', async () => {
        socket.emitWithAck.mockResolvedValue(reply('Europe/Amsterdam'));
        const { result } = renderTimezone();
        expect(result.current.timezone).toBeNull();
        await startLookup();
        expect(socket.emitWithAck).toHaveBeenCalledWith('api.call', {
            cmd: 'get-location-timezone', data: { lat: 52.3676, lon: 4.9041 },
        });
        expect(result.current.timezone).toBe('Europe/Amsterdam');
        expect(result.current.automatic).toBe(true);
        expect(result.current.loading).toBe(false);
    });

    it('ignores late replies after moving the station', async () => {
        const oldLookup = deferred();
        socket.emitWithAck.mockReturnValueOnce(oldLookup.promise).mockResolvedValueOnce(reply('Asia/Kathmandu'));
        const { result, rerender } = renderTimezone();
        await startLookup();
        rerender({ latitude: 27.7172, longitude: 85.3240 });
        expect(result.current.timezone).toBeNull();
        await startLookup();
        await act(async () => oldLookup.resolve(reply('Europe/Amsterdam')));
        expect(result.current.timezone).toBe('Asia/Kathmandu');
    });

    it('clears the previous automatic value immediately when coordinates change', async () => {
        socket.emitWithAck.mockResolvedValue(reply('Europe/Amsterdam'));
        const { result, rerender } = renderTimezone();
        await startLookup();
        rerender({ latitude: 27.7172, longitude: 85.3240 });
        expect(result.current.timezone).toBeNull();
        expect(result.current.loading).toBe(true);
    });

    it('preserves a manual choice and allows returning to coordinate detection', async () => {
        socket.emitWithAck.mockResolvedValueOnce(reply('Europe/Amsterdam')).mockResolvedValueOnce(reply('Asia/Kathmandu'));
        const { result, rerender } = renderTimezone();
        await startLookup();
        // Choosing the detected zone explicitly still counts as a manual choice.
        act(() => result.current.setTimezone('Europe/Amsterdam'));
        expect(result.current.automatic).toBe(false);
        act(() => result.current.setTimezone('UTC'));
        rerender({ latitude: 27.7172, longitude: 85.3240 });
        await startLookup();
        expect(result.current.timezone).toBe('UTC');
        act(() => result.current.setTimezone(null));
        expect(result.current.timezone).toBe('Asia/Kathmandu');
        expect(result.current.automatic).toBe(true);
    });

    it('allows manual selection when detection fails', async () => {
        socket.emitWithAck.mockRejectedValue(new Error('timeout'));
        const { result } = renderTimezone();
        await startLookup();
        expect(result.current.error).toBe(true);
        expect(result.current.timezone).toBeNull();
        act(() => result.current.setTimezone('Australia/Adelaide'));
        expect(result.current.timezone).toBe('Australia/Adelaide');
    });
});
