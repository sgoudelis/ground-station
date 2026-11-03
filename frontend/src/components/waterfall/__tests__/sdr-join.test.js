import { configureStore } from '@reduxjs/toolkit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import reducer, { updateSDRConfig, setSelectedSDRId } from '../waterfall-slice.jsx';
import { leaveSdr, joinSdr } from '../sdr-join.js';
import backendSyncMiddleware, { setSocketForMiddleware } from '../vfo-marker/vfo-middleware.jsx';
import vfoReducer, { setVFOProperty, setVfoActive } from '../vfo-marker/vfo-slice.jsx';
import decodersReducer from '../../decoders/decoders-slice.jsx';

afterEach(() => {
    setSocketForMiddleware(null);
    vi.useRealTimers();
});

describe('SDR joining', () => {
    it('uses only the join subscription and applies the worker settings', async () => {
        const commands = [];
        const socket = {
            emit: (_event, request, callback) => {
                commands.push(request.cmd);
                callback(request.cmd === 'sdr.join-sdr'
                    ? { success: true, data: { session_id: 'receiving:viewer', config: {
                        sdr_id: 'sdr-a', center_freq: 145_800_000,
                        sample_rate: 2_048_000, gain: 20, antenna: 'RX', bias_t: true,
                        sdr_settings: {bandwidth: 'auto'},
                        bandwidth_status: {mode: 'auto', sample_rate: 2_048_000, actual_hz: 5_000_000},
                    }, parameters: {
                        gain_values: [0, 10, 20, 30],
                        sample_rate_values: [1_024_000, 2_048_000, 2_400_000],
                        fft_size_values: [1024, 2048],
                        fft_window_values: ['hanning', 'blackman'],
                        antennas: { tx: [], rx: ['RX', 'AUX'] },
                        capabilities: { clock_sources: ['internal', 'external'] },
                        has_bias_t: true,
                    } } }
                    : { success: true });
            },
        };
        let state = reducer(undefined, { type: '@@INIT' });
        const dispatch = (action) => { state = reducer(state, action); };
        dispatch(setSelectedSDRId('previous-sdr'));
        dispatch(updateSDRConfig({ sdr_id: 'previous-sdr', gain: 49.6, sample_rate: 1_024_000 }));

        await joinSdr(socket, dispatch, 'sdr-a');

        expect(commands).toEqual(['sdr.join-sdr']);
        expect(state.selectedSDRId).toBe('sdr-a');
        expect(state.joinedSdrId).toBe('sdr-a');
        expect(state.isStreaming).toBe(true);
        expect(state.receivingSessionId).toBe('receiving:viewer');
        expect(state.centerFrequency).toBe(145_800_000);
        expect(state.sampleRate).toBe(2_048_000);
        expect(state.gainValues).toEqual([0, 10, 20, 30]);
        expect(state.sampleRateValues).toEqual([1_024_000, 2_048_000, 2_400_000]);
        expect(state.antennasList.rx).toEqual(['RX', 'AUX']);
        expect(state.sdrCapabilities['sdr-a'].clock_sources).toEqual(['internal', 'external']);
        expect(state.sdrSettingsById['sdr-a'].draft.biasT).toBe(true);
        expect(state.sdrSettingsById['sdr-a'].draft.bandwidth).toBe('auto');
        expect(state.sdrBandwidthById['sdr-a'].actual_hz).toBe(5_000_000);

        dispatch(updateSDRConfig({ sdr_id: 'sdr-a', bias_t: false, center_freq: 145_810_000 }));
        expect(state.sdrSettingsById['sdr-a'].draft.biasT).toBe(false);
        expect(state.centerFrequency).toBe(145_810_000);

        await leaveSdr(socket, dispatch, 'sdr-a');
        expect(commands).toEqual(['sdr.join-sdr', 'sdr.leave-sdr']);
        expect(state.joinedSdrId).toBe(null);
        expect(state.isStreaming).toBe(false);
    });

    it('starts the viewer’s own VFO without configuring the shared SDR', async () => {
        const requests = [];
        const socket = { emit: vi.fn((_event, request, callback) => {
            requests.push(request);
            if (request.cmd === 'sdr.join-sdr') {
                callback({ success: true, data: { config: {
                    sdr_id: 'sdr-a', center_freq: 145_800_000, sample_rate: 2_048_000,
                } } });
            } else {
                callback({ success: true, data: {} });
            }
        }) };
        setSocketForMiddleware(socket);
        const store = configureStore({
            reducer: { waterfall: reducer, vfo: vfoReducer },
            middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(backendSyncMiddleware),
        });
        store.dispatch(updateSDRConfig({ sdr_id: 'sdr-a', center_freq: 145_800_000, sample_rate: 2_048_000 }));
        store.dispatch(setVFOProperty({ vfoNumber: 1, updates: { frequency: 145_810_000 } }));
        store.dispatch(setVfoActive(1));

        await joinSdr(socket, store.dispatch, 'sdr-a');

        expect(requests.map((request) => request.cmd)).toEqual([
            'sdr.join-sdr', 'update-vfo-parameters',
        ]);
        expect(requests[1].data).toMatchObject({ vfoNumber: 1, frequency: 145_810_000, active: true });
        setSocketForMiddleware(null);
    });

    it.each(['join-sdr', 'claim-sdr'])('adopts workers through %s without sending stale or restored VFO settings', async (command) => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-11-03T10:02:00Z'));
        const requests = [];
        const socket = { id: 'new-socket', emit: vi.fn((_event, request, callback) => {
            requests.push(request);
            callback({ success: true, data: {
                config: { sdr_id: 'sdr-a', center_freq: 145_800_000, sample_rate: 2_048_000 },
                observation: {
                    session_id: 'original-session', enabled: true, is_recording: true, audio_recordings: [1],
                    recording_start_time: '2026-11-03T10:00:00Z', audio_recording_durations: { 1: 10.5 },
                    vfos: {
                        1: { active: true, center_freq: 145_810_000, modulation: 'FM', bandwidth: 14500 },
                        2: { active: true, selected: true, center_freq: 145_820_000, decoder: 'fsk', bandwidth: 27000,
                            locked_transmitter_id: 'old-transmitter', parameters_enabled: false,
                            decoder_parameters: { baudrate: 4800, framing: 'ax25', deviation: 2400 } },
                    },
                    decoder_statuses: [{ session_id: 'original-session', vfo: 2, decoder_type: 'fsk',
                        status: 'decoding', decoder_id: 'decoder-original' }],
                },
            } });
        }) };
        setSocketForMiddleware(socket);
        const store = configureStore({
            reducer: { waterfall: reducer, vfo: vfoReducer, decoders: decodersReducer },
            middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(backendSyncMiddleware),
        });
        if (command === 'claim-sdr') {
            // A viewer may have queued edits on its own VFOs at adoption time.
            store.dispatch({ type: 'waterfallState/setIsStreaming', payload: true });
        }
        store.dispatch(setVFOProperty({ vfoNumber: 1, updates: { frequency: 99_000_000, lockedTransmitterId: 'stale-lock' } }));

        await joinSdr(socket, store.dispatch, 'sdr-a', command);
        await vi.runAllTimersAsync();

        expect(requests.map((request) => request.cmd)).toEqual([`sdr.${command}`]);
        const state = store.getState();
        expect(state.waterfall).toMatchObject({ isStreaming: true, joinedSdrId: null,
            receivingSessionId: 'original-session', backgroundStreaming: true, isRecording: true,
            recordingStartTime: '2026-11-03T10:00:00Z', recordingDuration: 120 });
        expect(state.vfo.vfoMarkers[1]).toMatchObject({ frequency: 145_810_000, bandwidth: 14500, lockedTransmitterId: 'none' });
        expect(state.vfo.vfoMarkers[2]).toMatchObject({ frequency: 145_820_000, bandwidth: 27000, mode: 'none',
            decoder: 'fsk', parametersEnabled: false, lockedTransmitterId: 'none', lockedTransmitterTrackerId: null,
            parameters: { fsk_baudrate: 4800, fsk_deviation: 2400, fsk_framing: 'ax25' } });
        expect(state.vfo.vfoActive).toEqual({ 1: true, 2: true, 3: false, 4: false });
        expect(state.vfo.selectedVFO).toBe(2);
        expect(state.vfo.audioRecording[1]).toEqual({ isRecording: true, duration: 10 });
        expect(state.decoders.currentSessionId).toBe('original-session');
        expect(state.decoders.active['original-session_vfo2'].decoder_id).toBe('decoder-original');

        // A duplicate stream-status notification must not restart restored VFOs.
        store.dispatch({ type: 'waterfallState/setIsStreaming', payload: true });
        expect(requests).toHaveLength(1);
    });

    it('hydrates background decoder status for a viewer joining a controlled observation', async () => {
        const socket = { id: 'viewer', emit: (_event, _request, callback) => callback({
            success: true, data: {
                config: { sdr_id: 'sdr-a', center_freq: 145_800_000, sample_rate: 2_048_000 },
                background_observations: [{ session_id: 'original', decoder_statuses: [{
                    session_id: 'original', vfo: 2, decoder_type: 'fsk', status: 'decoding', decoder_id: 'running-worker',
                }] }],
            },
        }) };
        const store = configureStore({ reducer: { waterfall: reducer, vfo: vfoReducer, decoders: decodersReducer } });
        await joinSdr(socket, store.dispatch, 'sdr-a');
        expect(store.getState().waterfall.joinedSdrId).toBe('sdr-a');
        expect(store.getState().decoders.currentSessionId).toBe('viewer');
        expect(store.getState().decoders.observedSessionIds).toEqual(['original']);
        expect(store.getState().decoders.active.original_vfo2.decoder_id).toBe('running-worker');
    });
});
