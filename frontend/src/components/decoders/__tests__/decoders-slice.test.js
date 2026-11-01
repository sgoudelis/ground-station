import { describe, expect, it } from 'vitest';
import reducer, { clearGnssOutputsForDecoder, decoderOutputReceived, decoderProgressUpdated, decoderStatusChanged, deleteOutputByFilename, isStaleDecoderStatus } from '../decoders-slice.jsx';

it('deletes only the specified nested packet when basenames match', () => {
    const initial = reducer(undefined, { type: '@@INIT' });
    const entry = (serial) => ({
        id: serial, output: { filename: 'packet.bin', filepath: `data/decoded/radiosonde_RS41_${serial}/run/packet.bin` },
    });
    const state = { ...initial, outputs: [entry('FIRST'), entry('SECOND')], ui: { ...initial.ui, selectedOutput: 'FIRST' } };
    const result = reducer(state, deleteOutputByFilename({
        filename: 'packet.bin', url: '/decoded/radiosonde_RS41_FIRST/run/packet.bin',
    }));
    expect(result.outputs.map(output => output.id)).toEqual(['SECOND']);
    expect(result.ui.selectedOutput).toBeNull();
});

describe('decoders slice status lifecycle', () => {
    it('keeps starting status as active decoder state', () => {
        let state = reducer(undefined, { type: '@@INIT' });

        state = reducer(state, decoderStatusChanged({
            session_id: 'session-1',
            decoder_id: 'decoder-1',
            decoder_type: 'gnss',
            vfo: 2,
            status: 'starting',
            timestamp: 1234,
            info: {
                phase: 'initializing',
            },
        }));

        expect(state.active['session-1_vfo2']).toBeDefined();
        expect(state.active['session-1_vfo2'].status).toBe('starting');
        expect(state.active['session-1_vfo2'].info?.phase).toBe('initializing');
    });

    it('keeps the new transcription status when the old worker reports late events', () => {
        const status = (decoderId, workerStartedAt, phase, provider, timestamp = workerStartedAt + 1) => decoderStatusChanged({
            session_id: 'session-1',
            decoder_id: decoderId,
            decoder_type: 'transcription',
            worker_started_at: workerStartedAt,
            vfo: 2,
            status: phase,
            timestamp,
            info: { provider },
        });

        let state = reducer(undefined, status('old-worker', 10, 'transcribing', 'deepgram'));
        state = reducer(state, status('new-worker', 20, 'starting', 'parakeet'));
        state = reducer(state, status('old-worker', 10, 'closed', 'deepgram', 30));
        state = reducer(state, status('old-worker', 10, 'connecting', 'deepgram', 31));

        expect(state.active['session-1_vfo2']).toMatchObject({
            decoder_id: 'new-worker',
            worker_started_at: 20,
            status: 'starting',
            info: { provider: 'parakeet' },
        });

        state = reducer(state, status('new-worker', 20, 'connecting', 'parakeet'));
        expect(state.active['session-1_vfo2'].status).toBe('connecting');
    });

    it('ignores late active statuses from replaced decoders', () => {
        const status = (decoderId, decoderType, phase, timestamp, info = {}) => decoderStatusChanged({
            session_id: 'session-1',
            decoder_id: decoderId,
            decoder_type: decoderType,
            vfo: 2,
            status: phase,
            timestamp,
            info,
        });

        let state = reducer(undefined, status('old-afsk', 'afsk', 'listening', 10, { baudrate: 9600 }));
        state = reducer(state, status('new-gnss', 'gnss', 'starting', 20, { phase: 'initializing' }));
        expect(isStaleDecoderStatus(state.active['session-1_vfo2'], {
            decoder_id: 'old-afsk', decoder_type: 'afsk', status: 'listening', timestamp: 30,
        })).toBe(true);
        state = reducer(state, status('old-afsk', 'afsk', 'decoding', 30, { baudrate: 9600 }));
        state = reducer(state, status('old-afsk', 'afsk', 'closed', 31));

        expect(state.active['session-1_vfo2']).toMatchObject({
            decoder_id: 'new-gnss',
            decoder_type: 'gnss',
            status: 'starting',
            started_at: 20,
            info: { phase: 'initializing' },
        });
        expect(state.active['session-1_vfo2'].info.baudrate).toBeUndefined();

        // A third restart keeps both earlier instances retired.
        state = reducer(state, status('third-gnss', 'gnss', 'starting', 40));
        state = reducer(state, status('old-afsk', 'afsk', 'listening', 50));
        state = reducer(state, status('new-gnss', 'gnss', 'tracking', 51));
        expect(state.active['session-1_vfo2'].decoder_id).toBe('third-gnss');
    });

    it('rejects progress from a retired SSTV decoder', () => {
        let state = reducer(undefined, decoderStatusChanged({
            session_id: 'session-1', vfo: 2, decoder_id: 'old-sstv',
            decoder_type: 'sstv', status: 'processing', timestamp: 10,
        }));
        state = reducer(state, decoderStatusChanged({
            session_id: 'session-1', vfo: 2, decoder_id: 'new-sstv',
            decoder_type: 'sstv', status: 'listening', timestamp: 20,
        }));
        state = reducer(state, decoderProgressUpdated({
            session_id: 'session-1', vfo: 2, decoder_id: 'old-sstv',
            progress: 75, timestamp: 30, info: { current_line: 90 },
        }));
        expect(state.active['session-1_vfo2'].progress).toBeNull();
        expect(state.active['session-1_vfo2'].info?.current_line).toBeUndefined();

        state = reducer(state, decoderProgressUpdated({
            session_id: 'session-1', vfo: 2, decoder_id: 'new-sstv',
            progress: 25, timestamp: 31,
        }));
        expect(state.active['session-1_vfo2'].progress).toBe(25);
    });

    it('ignores an unseen decoder status generated before the active instance', () => {
        let state = reducer(undefined, decoderStatusChanged({
            session_id: 'session-1', vfo: 2, decoder_id: 'new-gnss',
            decoder_type: 'gnss', status: 'starting', timestamp: 20,
        }));
        state = reducer(state, decoderStatusChanged({
            session_id: 'session-1', vfo: 2, decoder_id: 'old-afsk',
            decoder_type: 'afsk', status: 'listening', timestamp: 10,
        }));

        expect(state.active['session-1_vfo2'].decoder_id).toBe('new-gnss');
    });

    it('clears only matching GNSS outputs on decoder restart', () => {
        let state = reducer(undefined, { type: '@@INIT' });

        state = reducer(state, decoderOutputReceived({
            timestamp: 1,
            session_id: 'session-1',
            vfo: 2,
            decoder_type: 'gnss',
            output: { event: 'nmea_gga' },
        }));
        state = reducer(state, decoderOutputReceived({
            timestamp: 2,
            session_id: 'session-1',
            vfo: 3,
            decoder_type: 'gnss',
            output: { event: 'nmea_gga' },
        }));
        state = reducer(state, decoderOutputReceived({
            timestamp: 3,
            session_id: 'session-1',
            vfo: 2,
            decoder_type: 'morse',
            output: { text: 'CQ' },
        }));

        state = reducer(state, clearGnssOutputsForDecoder({
            session_id: 'session-1',
            vfo: 2,
        }));

        expect(state.outputs).toHaveLength(2);
        expect(state.outputs.some((out) => out.decoder_type === 'gnss' && out.vfo === 2)).toBe(false);
        expect(state.outputs.some((out) => out.decoder_type === 'gnss' && out.vfo === 3)).toBe(true);
        expect(state.outputs.some((out) => out.decoder_type === 'morse')).toBe(true);
    });
});
