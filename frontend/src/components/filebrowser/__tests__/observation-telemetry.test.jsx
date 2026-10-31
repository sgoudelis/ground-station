import { act, renderHook, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import fixtures from '../../../../../backend/tests/fixtures/viewer.json';
import { observationTelemetryStatus, useObservationTelemetry } from '../observation-telemetry.js';

const classify = (metadata) => observationTelemetryStatus(metadata.telemetry);
const metadata = (kind, status, extra = {}) => ({
    telemetry: { schema_version: 1, payload_status: status, payload: { kind, status, records: [], ...extra } },
});
const connection = () => {
    const socket = { connected: true, emit: vi.fn() };
    socket.timeout = vi.fn(() => socket);
    return socket;
};
const artifact = (name) => ({ kind: 'decoded', file_type: '.bin', url: `/observations/pass.gsobs/decoded/${name}.bin` });
const folder = { foldername: 'pass.gsobs', modified: '2026-10-31T10:00:00Z', artifacts: [artifact('first')] };
const reply = async (socket, index, data = fixtures.real.uwe4) => {
    await act(async () => socket.emit.mock.calls[index][2](null, { success: true, data }));
};

describe('Observation telemetry classification', () => {
    it.each(['geoscan', 'uwe4', 'umka', 'tianqi', 'lasarsat0', 'lasarsat1', 'lasarsat2', 'rs52s'])(
        'recognizes decoded values in the real %s fixture', (name) => {
            expect(classify(fixtures.real[name])).toBe('telemetry');
        }
    );

    it('distinguishes mixed message results from acknowledgements and parse failures', () => {
        expect(classify(fixtures.legacy.messages)).toBe('partial');
        expect(classify(fixtures.legacy.warning)).toBe('other');
        expect(classify(fixtures.legacy.malformed)).toBe('error');
        expect(classify(fixtures.real.lasarsat3)).toBe('error');
        expect(classify(fixtures.legacy.text)).toBe('other');
    });

    it('does not label raw packets or a telemetry object alone as telemetry', () => {
        expect(classify(metadata('raw', 'unsupported'))).toBe('unsupported');
        expect(classify(metadata('telemetry', 'decoded'))).toBe('unknown');
        expect(observationTelemetryStatus({ success: true, telemetry: { values: { voltage: 4.2 } } })).toBe('unknown');
        expect(observationTelemetryStatus(null)).toBe('unknown');
    });

    it('counts zero and false as values while excluding unavailable or erroneous values', () => {
        expect(classify(fixtures.legacy.unavailable)).toBe('telemetry');
        const record = { status: 'decoded', groups: [{ values: { voltage: 0, enabled: false } }] };
        expect(classify(metadata('telemetry', 'decoded', { records: [record] }))).toBe('telemetry');
        record.groups = [{ values: { voltage: null, enabled: false }, field_info: { enabled: { error: 'Unavailable' } } }];
        expect(classify(metadata('telemetry', 'decoded', { records: [record] }))).toBe('unknown');
    });

    it('recognizes APRS telemetry channels, including telemetry embedded in a position', () => {
        for (const data_type of ['telemetry', 'position_without_timestamp']) {
            expect(classify(metadata('aprs', 'decoded', {
                aprs: { data_type, telemetry: { sequence: 1, channels: [0, 42] } },
            }))).toBe('telemetry');
        }
        expect(classify(metadata('aprs', 'decoded', {
            aprs: { telemetry: { digital_bits: '00000000' } },
        }))).toBe('telemetry');
    });

    it('does not mistake APRS positions, messages or sequence numbers for telemetry readings', () => {
        for (const aprs of [
            { position: { latitude: 38, longitude: 23 }, values: { latitude_degrees: 38 } },
            { data_type: 'message', values: { text: 'hello' } },
            { telemetry: { sequence: 1, channels: [] } },
        ]) {
            expect(classify(metadata('aprs', 'decoded', { aprs }))).toBe('other');
        }
        expect(classify(metadata('aprs', 'malformed'))).toBe('error');
    });
});

describe('Observation telemetry requests', () => {
    it('shares in-flight reads across Strict Mode replay and reopening', async () => {
        const socket = connection();
        const { result, rerender } = renderHook(({ open }) => useObservationTelemetry({ open, folder, socket }), {
            initialProps: { open: true },
            wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
        });
        expect(socket.emit).toHaveBeenCalledTimes(1);
        rerender({ open: false });
        rerender({ open: true });
        expect(socket.emit).toHaveBeenCalledTimes(1);
        await reply(socket, 0);
        expect(result.current[folder.artifacts[0].url]).toBe('telemetry');
    });

    it('only queries decoded binary files using the read-only command', async () => {
        const socket = connection();
        const mixedFolder = { ...folder, artifacts: [
            ...folder.artifacts,
            { ...artifact('image'), file_type: '.png' },
            { ...artifact('audio'), kind: 'audio' },
            { ...artifact('owned'), recording_name: 'capture' },
        ] };
        const { result } = renderHook(() => useObservationTelemetry({ open: true, folder: mixedFolder, socket }));
        expect(socket.emit).toHaveBeenCalledExactlyOnceWith('api.call', {
            cmd: 'filebrowser.view-telemetry', data: { url: folder.artifacts[0].url },
        }, expect.any(Function));
        await reply(socket, 0);
        expect(result.current[folder.artifacts[0].url]).toBe('telemetry');
    });

    it('limits concurrent requests and stops queuing after close', async () => {
        const socket = connection();
        const largeFolder = { ...folder, artifacts: Array.from({ length: 8 }, (_, index) => artifact(index)) };
        const { result, rerender } = renderHook(({ open }) => useObservationTelemetry({ open, folder: largeFolder, socket }), {
            initialProps: { open: true },
        });
        expect(socket.emit).toHaveBeenCalledTimes(3);
        await reply(socket, 0);
        expect(socket.emit).toHaveBeenCalledTimes(4);
        rerender({ open: false });
        await reply(socket, 1);
        expect(socket.emit).toHaveBeenCalledTimes(4);
        expect(result.current[largeFolder.artifacts[1].url]).toBeUndefined();
    });

    it('reuses results on reopen, queries newly added files, and invalidates them after reparse', async () => {
        const socket = connection();
        const { result, rerender } = renderHook((props) => useObservationTelemetry({ socket, ...props }), {
            initialProps: { open: true, folder, revision: 0 },
        });
        await reply(socket, 0);
        rerender({ open: false, folder, revision: 0 });
        rerender({ open: true, folder, revision: 0 });
        expect(socket.emit).toHaveBeenCalledTimes(1);
        const updatedFolder = { ...folder, artifacts: [...folder.artifacts, artifact('new')] };
        rerender({ open: true, folder: updatedFolder, revision: 0 });
        expect(socket.emit).toHaveBeenCalledTimes(2);
        await reply(socket, 1);
        rerender({ open: true, folder: updatedFolder, revision: 1 });
        expect(socket.emit).toHaveBeenCalledTimes(4);
        expect(result.current[folder.artifacts[0].url]).toBeUndefined();
        await reply(socket, 2, metadata('raw', 'unsupported'));
        expect(result.current[folder.artifacts[0].url]).toBe('unsupported');
    });

    it('invalidates results when the folder modification date changes', async () => {
        const socket = connection();
        const { rerender } = renderHook(({ folder }) => useObservationTelemetry({ open: true, folder, socket }), {
            initialProps: { folder },
        });
        await reply(socket, 0);
        rerender({ folder: { ...folder, modified: '2026-10-31T11:00:00Z' } });
        expect(socket.emit).toHaveBeenCalledTimes(2);
    });

    it('ignores late replies when switching observations', async () => {
        const socket = connection();
        const other = { ...folder, foldername: 'other.gsobs', artifacts: [artifact('other')] };
        const { result, rerender } = renderHook(({ folder }) => useObservationTelemetry({ open: true, folder, socket }), {
            initialProps: { folder },
        });
        rerender({ folder: other });
        await reply(socket, 0);
        expect(result.current).toEqual({});
        await reply(socket, 1, fixtures.legacy.warning);
        expect(result.current).toEqual({ [other.artifacts[0].url]: 'other' });
    });

    it.each(['timeout', 'missing', 'invalid'])('marks %s metadata unknown and retries on reopen', async (failure) => {
        const socket = connection();
        const { result, rerender } = renderHook(({ open }) => useObservationTelemetry({ open, folder, socket }), {
            initialProps: { open: true },
        });
        await act(async () => socket.emit.mock.calls[0][2](
            failure === 'timeout' ? new Error('timeout') : null,
            failure === 'missing' ? { success: false } : { success: true, data: {} },
        ));
        expect(result.current[folder.artifacts[0].url]).toBe('unknown');
        rerender({ open: false });
        rerender({ open: true });
        expect(socket.emit).toHaveBeenCalledTimes(2);
        await reply(socket, 1);
        expect(result.current[folder.artifacts[0].url]).toBe('telemetry');
    });

    it('waits for a connection and handles historical metadata through the existing endpoint', async () => {
        const socket = connection();
        socket.connected = false;
        const { result, rerender } = renderHook(() => useObservationTelemetry({ open: true, folder, socket }));
        expect(socket.emit).not.toHaveBeenCalled();
        socket.connected = true;
        rerender();
        await waitFor(() => expect(socket.emit).toHaveBeenCalledTimes(1));
        // The server supplies the normalized historical result, as in the viewer.
        await reply(socket, 0, fixtures.legacy.housekeeping);
        expect(result.current[folder.artifacts[0].url]).toBe('telemetry');
    });
});
