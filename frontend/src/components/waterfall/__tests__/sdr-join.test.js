import { configureStore } from '@reduxjs/toolkit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import reducer, { updateSDRConfig, setSelectedSDRId } from '../waterfall-slice.jsx';
import { detachSdr, leaveSdr, joinSdr } from '../sdr-join.js';
import backendSyncMiddleware, { setSocketForMiddleware } from '../vfo-marker/vfo-middleware.jsx';
import vfoReducer, { restoreReceivingSession, setVFOProperty, setVfoActive } from '../vfo-marker/vfo-slice.jsx';
import decodersReducer from '../../decoders/decoders-slice.jsx';

afterEach(() => {
    setSocketForMiddleware(null);
    vi.useRealTimers();
});

describe('SDR detaching', () => {
    it.each(['sdr-a', 'sigmf-playback'])(
        'deactivates local VFOs only after %s detaches, without updating background workers',
        async (selectedSDRId) => {
            vi.useFakeTimers();
            let acknowledge;
            const observation = {
                session_id: 'receiving-background', enabled: true, audio_recordings: [1],
                vfos: {
                    1: { active: true, selected: true, center_freq: 145_810_000, decoder: 'fsk', bandwidth: 27000 },
                    3: { active: true, center_freq: 145_820_000, modulation: 'FM' },
                },
            };
            const socket = { id: 'dashboard-socket', connected: true, emit: vi.fn((_event, request, callback) => {
                if (request.cmd === 'sdr.detach-streaming') {
                    acknowledge = callback;
                } else {
                    callback({ success: true, data: { observation } });
                }
            }) };
            setSocketForMiddleware(socket);
            const store = configureStore({
                reducer: { waterfall: reducer, vfo: vfoReducer, decoders: decodersReducer },
                middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(backendSyncMiddleware),
                preloadedState: { waterfall: {
                    ...reducer(undefined, { type: '@@INIT' }),
                    selectedSDRId, isStreaming: true, backgroundStreaming: true,
                    receivingSessionId: observation.session_id,
                } },
            });
            store.dispatch(restoreReceivingSession(observation));
            // A queued edit must not reach the background session after detach.
            store.dispatch(setVFOProperty({ vfoNumber: 1, updates: {
                volume: 42, lockedTransmitterId: 'old-lock',
                lockedTransmitterTrackerId: 'tracker-a', frequencyOffset: 100,
            } }));
            const activeVfos = store.getState().vfo;

            const detaching = detachSdr(socket, store.dispatch, selectedSDRId);
            expect(store.getState().waterfall.isStreaming).toBe(true);
            expect(store.getState().vfo).toEqual(activeVfos);
            acknowledge({ success: true });
            await detaching;
            await vi.runAllTimersAsync();

            expect(socket.emit.mock.calls.map(([, request]) => request.cmd)).toEqual(['sdr.detach-streaming']);
            expect(socket.emit.mock.calls[0][1].data).toEqual({ selectedSDRId });
            expect(store.getState().waterfall.isStreaming).toBe(false);
            expect(store.getState().decoders.currentSessionId).toBe('dashboard-socket');
            expect(store.getState().vfo).toMatchObject({
                vfoActive: { 1: false, 2: false, 3: false, 4: false },
                selectedVFO: null, streamingVFOs: [],
                audioRecording: { 1: { isRecording: false, duration: 0 } },
                vfoMarkers: { 1: {
                    frequency: 145_810_000, decoder: 'fsk', bandwidth: 27000, volume: 42,
                    lockedTransmitterId: 'none', lockedTransmitterTrackerId: null, frequencyOffset: 0,
                } },
            });

            // Rejoining restores the background VFOs without restarting their workers.
            await joinSdr(socket, store.dispatch, selectedSDRId);
            await vi.runAllTimersAsync();
            expect(store.getState().vfo.vfoActive).toEqual({ 1: true, 2: false, 3: true, 4: false });
            expect(store.getState().vfo.selectedVFO).toBe(1);
            expect(store.getState().vfo.audioRecording[1].isRecording).toBe(true);
            expect(socket.emit.mock.calls.map(([, request]) => request.cmd)).toEqual([
                'sdr.detach-streaming', 'sdr.join-sdr',
            ]);
        }
    );
});

describe('SDR joining', () => {
    it('views continuous VFOs without adopting or synchronizing their configuration', async () => {
        vi.useFakeTimers();
        const owner = 'internal:continuous-definition';
        const socket = { id: 'browser', connected: true, emit: vi.fn((_event, request, callback) => {
            callback({ success: true, data: {
                session_id: 'receiving-viewer', continuous_observation: {
                    id: 'definition', session_id: owner, vfos: { 1: { active: true, center_freq: 145800000 } },
                }, config: { sdr_id: 'radio', center_freq: 145800000, sample_rate: 2000000 },
            } });
        }) };
        setSocketForMiddleware(socket);
        const store = configureStore({
            reducer: { waterfall: reducer, vfo: vfoReducer, decoders: decodersReducer },
            middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(backendSyncMiddleware),
        });
        store.dispatch(setVfoActive(1));
        await joinSdr(socket, store.dispatch, 'radio', 'watch-sdr', { continuousObservationId: 'definition' });
        store.dispatch(setVFOProperty({ vfoNumber: 1, updates: { frequency: 146000000 } }));
        await vi.runAllTimersAsync();
        expect(socket.emit.mock.calls.map(([, request]) => request.cmd)).toEqual(['sdr.watch-sdr']);
        expect(store.getState().waterfall.continuousObservation.session_id).toBe(owner);
        expect(store.getState().waterfall.joinedSdrId).toBe('radio');
        expect(store.getState().decoders.currentSessionId).toBe(owner);
        expect(store.getState().decoders.observedSessionIds).toContain(owner);
        expect(Object.values(store.getState().vfo.vfoActive).some(Boolean)).toBe(false);
        await leaveSdr(socket, store.dispatch, 'radio');
        expect(store.getState().waterfall.continuousObservation).toBeNull();
    });

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
