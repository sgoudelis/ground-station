import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import VFOMarkersContainer from '../vfo-marker/vfo-container.jsx';
import vfoReducer, { setVFOProperty } from '../vfo-marker/vfo-slice.jsx';
import { canvasDrawingUtils } from '../vfo-marker/vfo-utils.js';
import decodersReducer, { decoderStatusChanged, setCurrentSessionId } from '../../decoders/decoders-slice.jsx';

vi.mock('../vfo-squelch-state.js', () => ({ useVfoSquelchState: () => ({ vfoSquelchOpen: {} }) }));

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback) => setTimeout(callback, 0));
    vi.stubGlobal('cancelAnimationFrame', (id) => clearTimeout(id));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ clearRect: vi.fn() });
    for (const name of ['drawVFOArea', 'drawVFOLine', 'drawVFOEdges', 'drawVFOHandle', 'drawVFOLabel']) {
        vi.spyOn(canvasDrawingUtils, name).mockImplementation(() => {});
    }
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

function renderVfo(config = { decoder: 'radiosonde', mode: 'none' }) {
    const initialVfo = vfoReducer(undefined, { type: '@@INIT' });
    const store = configureStore({
        reducer: {
            vfo: vfoReducer,
            decoders: decodersReducer,
            gnss: () => ({}),
            waterfall: () => ({ selectedSDRId: 'radio' }),
            sessions: () => ({}),
        },
        preloadedState: {
            vfo: {
                ...initialVfo,
                vfoActive: { 1: true },
                vfoMarkers: {
                    ...initialVfo.vfoMarkers,
                    1: { ...initialVfo.vfoMarkers[1], frequency: 400000000, color: '#FF0000', ...config },
                },
            },
        },
    });
    store.dispatch(setCurrentSessionId('browser-1'));
    render(<Provider store={store}><VFOMarkersContainer
        centerFrequency={400000000} sampleRate={2000000} bandscopeHeight={200}
        waterfallHeight={400} containerWidth={800} zoomScale={1} currentPositionX={0}
    /></Provider>);
    act(() => vi.runOnlyPendingTimers());
    return store;
}

function dispatchAndDraw(store, action) {
    act(() => { store.dispatch(action); });
    act(() => vi.runOnlyPendingTimers());
}

const decoderStatus = (decoder_type, status = 'listening') => decoderStatusChanged({
    session_id: 'browser-1', vfo: 1, decoder_id: `${decoder_type}-worker`,
    decoder_type, status, timestamp: Date.now() / 1000,
});

const labelDecoder = () => canvasDrawingUtils.drawVFOLabel.mock.lastCall[7];

it('clears the radiosonde label immediately on FM selection and ignores late status updates', () => {
    const store = renderVfo();
    dispatchAndDraw(store, decoderStatus('radiosonde'));
    expect(labelDecoder()).toMatchObject({ decoder_type: 'radiosonde' });

    dispatchAndDraw(store, setVFOProperty({ vfoNumber: 1, updates: { mode: 'FM', decoder: 'none' } }));
    expect(canvasDrawingUtils.drawVFOLabel.mock.lastCall[2]).toContain('FM');
    expect(labelDecoder()).toBeNull();

    dispatchAndDraw(store, decoderStatus('radiosonde', 'decoding'));
    expect(labelDecoder()).toBeNull();
    dispatchAndDraw(store, decoderStatus('radiosonde', 'stopped'));
    expect(store.getState().decoders.active).toEqual({});
    expect(labelDecoder()).toBeNull();
});

it('waits for the selected decoder status when switching between decoder types', () => {
    const store = renderVfo();
    dispatchAndDraw(store, decoderStatus('radiosonde'));
    dispatchAndDraw(store, setVFOProperty({ vfoNumber: 1, updates: { decoder: 'lora' } }));
    expect(labelDecoder()).toBeNull();

    dispatchAndDraw(store, decoderStatus('lora'));
    expect(labelDecoder()).toMatchObject({ decoder_type: 'lora' });
});

it('shows transcription status on FM only while transcription is enabled', () => {
    const store = renderVfo({ mode: 'FM', decoder: 'none', transcriptionEnabled: true });
    dispatchAndDraw(store, decoderStatus('transcription', 'transcribing'));
    expect(labelDecoder()).toMatchObject({ decoder_type: 'transcription' });

    dispatchAndDraw(store, setVFOProperty({ vfoNumber: 1, updates: { transcriptionEnabled: false } }));
    expect(labelDecoder()).toBeNull();
});
