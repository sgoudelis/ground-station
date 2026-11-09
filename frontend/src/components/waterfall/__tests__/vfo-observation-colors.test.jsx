import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import VFOMarkersContainer from '../vfo-marker/vfo-container.jsx';
import vfoReducer from '../vfo-marker/vfo-slice.jsx';
import { DEFAULT_VFO_COLORS } from '../vfo-marker/vfo-config.js';
import { canvasDrawingUtils } from '../vfo-marker/vfo-utils.js';
import decodersReducer, { decoderStatusChanged } from '../../decoders/decoders-slice.jsx';

vi.mock('../vfo-squelch-state.js', () => ({ useVfoSquelchState: () => ({ vfoSquelchOpen: {} }) }));

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback) => setTimeout(callback, 0));
    vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect: vi.fn() });
    for (const name of ['drawVFOArea', 'drawVFOLine', 'drawVFOEdges', 'drawVFOLabel']) {
        vi.spyOn(canvasDrawingUtils, name).mockImplementation(() => {});
    }
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

function renderObservation(colors, continuous = true, vfos) {
    const numbers = [1, 2, 3, 4, 5, 10];
    const session = {
        is_internal: true, sdr_id: 'radio',
        metadata: continuous ? { continuous_observation_id: 'observation', name: 'Meshtastic' } : {},
        vfos: vfos || Object.fromEntries(numbers.map((number) => [number, {
            active: true, center_freq: 869525000, bandwidth: 250000, modulation: 'none', decoder: 'lora',
        }])),
    };
    const store = configureStore({
        reducer: {
            vfo: vfoReducer,
            decoders: decodersReducer,
            gnss: () => ({}),
            waterfall: () => ({ selectedSDRId: 'radio' }),
            sessions: () => ({ runtimeSnapshot: { data: { sessions: { 'internal:observation': session } } } }),
        },
        preloadedState: { vfo: { ...vfoReducer(undefined, { type: '@@init' }), vfoColors: colors } },
    });
    render(<Provider store={store}><VFOMarkersContainer
        centerFrequency={869525000} sampleRate={2000000} bandscopeHeight={200}
        waterfallHeight={400} containerWidth={800} zoomScale={1} currentPositionX={0}
    /></Provider>);
    act(() => vi.runOnlyPendingTimers());
    return store;
}

it.each([
    ['default', DEFAULT_VFO_COLORS, ['#FF0000', '#207820', '#144bff', '#9e129e', '#FF0000', '#207820']],
    ['custom', ['#112233', '#445566', '#778899', '#AABBCC'], ['#112233', '#445566', '#778899', '#AABBCC', '#112233', '#445566']],
    ['empty', [], ['#FF0000', '#207820', '#144bff', '#9e129e', '#FF0000', '#207820']],
])('uses the same VFO identities as the observation form with the %s palette', (_name, colors, expected) => {
    renderObservation(colors);
    expect(canvasDrawingUtils.drawVFOArea.mock.calls.map((call) => call[4])).toEqual(expected);
    expect(canvasDrawingUtils.drawVFOLabel.mock.calls.map((call) => call[3])).toEqual(expected);
});

it('keeps scheduled observation markers gray', () => {
    renderObservation(DEFAULT_VFO_COLORS, false);
    expect(canvasDrawingUtils.drawVFOArea.mock.calls.map((call) => call[4])).toEqual(Array(6).fill('#A0A0A0'));
});

it.each([{ bw: 250000 }, { bandwidth_khz: 250 }])('draws the joined LoRa marker using reported bandwidth %j', (info) => {
    const store = renderObservation(DEFAULT_VFO_COLORS, true, {
        1: { active: true, center_freq: 869525000, bandwidth: 500000, modulation: 'none', decoder: 'lora' },
    });
    expect(canvasDrawingUtils.drawVFOLabel.mock.lastCall[2]).toContain('BW500kHz');

    // The matching owner's status can arrive after the initial runtime snapshot.
    act(() => {
        store.dispatch(decoderStatusChanged({ session_id: 'another-session', vfo: 1,
            decoder_type: 'lora', status: 'listening', info: { bw: 125000 } }));
        store.dispatch(decoderStatusChanged({ session_id: 'internal:observation', vfo: 2,
            decoder_type: 'lora', status: 'listening', info: { bw: 62500 } }));
        store.dispatch(decoderStatusChanged({ session_id: 'internal:observation', vfo: 1,
            decoder_type: 'lora', status: 'listening', info }));
    });
    act(() => vi.runOnlyPendingTimers());

    expect(canvasDrawingUtils.drawVFOArea).toHaveBeenLastCalledWith(expect.anything(), 350, 450, 200, '#FF0000', '10');
    expect(canvasDrawingUtils.drawVFOLabel.mock.lastCall[2]).toContain('BW250kHz');
});
