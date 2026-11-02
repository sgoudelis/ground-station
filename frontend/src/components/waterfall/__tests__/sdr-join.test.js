import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it, vi } from 'vitest';
import reducer, { updateSDRConfig, setSelectedSDRId } from '../waterfall-slice.jsx';
import { leaveSdr, joinSdr } from '../sdr-join.js';
import backendSyncMiddleware, { setSocketForMiddleware } from '../vfo-marker/vfo-middleware.jsx';
import vfoReducer, { setVFOProperty, setVfoActive } from '../vfo-marker/vfo-slice.jsx';

describe('SDR joining', () => {
    it('uses only the join subscription and applies the worker settings', async () => {
        const commands = [];
        const socket = {
            emit: (_event, request, callback) => {
                commands.push(request.cmd);
                callback(request.cmd === 'sdr.join-sdr'
                    ? { success: true, data: { config: {
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
});
