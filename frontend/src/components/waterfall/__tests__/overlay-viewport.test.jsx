import React, { createRef } from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { act, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils.jsx';
import WaterfallAndBandscope from '../waterfall-bandscope.jsx';
import waterfallReducer from '../waterfall-slice.jsx';
import vfoReducer from '../vfo-marker/vfo-slice.jsx';
import decodersReducer from '../../decoders/decoders-slice.jsx';
import { canvasDrawingUtils } from '../vfo-marker/vfo-utils.js';
import { getOverlayFrequencyRange } from '../overlay-canvas.js';

vi.mock('../../../hooks/useDopplerNeighbors.jsx', () => ({ useDopplerNeighbors: () => {} }));
vi.mock('../vfo-squelch-state.js', () => ({ useVfoSquelchState: () => ({ vfoSquelchOpen: {} }) }));

let viewportWidth;
let contexts;
let resizeCallback;
const centerFrequency = 437_500_000;
const frame = () => act(() => vi.advanceTimersByTime(20));

beforeEach(() => {
    vi.useFakeTimers();
    viewportWidth = 1000;
    contexts = new WeakMap();
    vi.stubGlobal('devicePixelRatio', 2);
    vi.stubGlobal('requestAnimationFrame', (callback) => setTimeout(() => callback(performance.now()), 16));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback) { resizeCallback = callback; }
        observe() {}
        disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => viewportWidth);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
        width: viewportWidth, height: 200, left: 100, right: 100 + viewportWidth, top: 0, bottom: 200,
    }));
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function () {
        if (!contexts.has(this)) {
            contexts.set(this, new Proxy({
                measureText: vi.fn((text) => ({ width: String(text).length * 7 })),
                createLinearGradient: () => ({ addColorStop: () => {} }),
            }, {
                get(target, key) {
                    if (!(key in target)) target[key] = vi.fn();
                    return target[key];
                },
            }));
        }
        return contexts.get(this);
    });
    vi.spyOn(canvasDrawingUtils, 'drawVFOLine');
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

function renderWaterfall(renderer = 'worker') {
    const initialVfo = vfoReducer(undefined, { type: '@@INIT' });
    const store = configureStore({
        reducer: {
            waterfall: waterfallReducer, vfo: vfoReducer, decoders: decodersReducer,
            gnss: () => ({}), sessions: () => ({}),
            targetSatTrack: () => ({
                availableTransmitters: [{ id: 'beacon', downlink_low: centerFrequency, description: 'Beacon', status: 'active' }],
            }),
        },
        preloadedState: {
            waterfall: { ...waterfallReducer(undefined, { type: '@@INIT' }),
                bandScopeHeight: 200, bandscopeTopPadding: 0, waterFallCanvasHeight: 400,
                waterFallScaleX: 1, waterFallPositionX: 0, isStreaming: true,
            },
            vfo: { ...initialVfo, vfoActive: { 1: true }, selectedVFO: 1,
                vfoMarkers: { ...initialVfo.vfoMarkers,
                    1: { ...initialVfo.vfoMarkers[1], frequency: centerFrequency, color: '#FF0000', mode: 'FM', decoder: 'none' },
                },
            },
        },
    });
    const ref = createRef();
    const result = renderWithProviders(<WaterfallAndBandscope
        ref={ref} bandscopeCanvasRef={createRef()} waterFallCanvasRef={createRef()}
        waterFallTileCanvasARef={createRef()} waterFallTileCanvasBRef={createRef()}
        waterfallRendererMode={renderer} centerFrequency={centerFrequency} sampleRate={2_000_000}
        frequencyBands={[{ startFrequency: centerFrequency - 100_000, endFrequency: centerFrequency + 100_000,
            name: 'Test band', color: '#ff0' }]}
    />, { store });
    frame();
    return { ...result, ref };
}

describe('waterfall overlay viewport', () => {
    it.each(['worker', 'dom-tiles'])('keeps %s overlays outside CSS zoom and sized to the screen at 20×', (renderer) => {
        const { container, ref } = renderWaterfall(renderer);
        act(() => ref.current.setZoomScale(20, 500));
        frame();

        const overlays = container.querySelectorAll('.bookmark-canvas, .frequency-band-overlay, .vfo-markers-canvas, .recording-band-overlay, .frequency-scale-canvas');
        expect(overlays).toHaveLength(5);
        for (const canvas of overlays) {
            expect(canvas.width).toBe(2000); // 1000 CSS pixels at DPR 2, at every zoom.
            for (let element = canvas; element; element = element.parentElement) {
                expect(element.style.transform).not.toContain('scaleX');
            }
        }
        expect(container.querySelector('.bandscope-canvas').parentElement.style.transform).toContain('scaleX(20)');
        const waterfall = container.querySelector(renderer === 'worker' ? '.waterfall-canvas' : '.waterfall-canvas-tile-a');
        expect(waterfall.closest('[style*="scaleX(20)"]')).not.toBeNull();
        expect(canvasDrawingUtils.drawVFOLine.mock.lastCall[1]).toBe(500);

        act(() => ref.current.panOnXAxisOnly(-100));
        frame();
        expect(canvasDrawingUtils.drawVFOLine.mock.lastCall[1]).toBeCloseTo(400);
        expect([...overlays].every((canvas) => canvas.width === 2000)).toBe(true);

        const bookmark = container.querySelector('.bookmark-canvas');
        expect(contexts.get(bookmark).fillText.mock.calls.some(([label]) => label.includes('Beacon'))).toBe(true);
    });

    it('anchors Shift-wheel zoom to the pointer position over an overlay', () => {
        const { container, ref } = renderWaterfall();
        fireEvent.wheel(container.querySelector('.vfo-markers-canvas'), {
            shiftKey: true, deltaY: -100, clientX: 600,
        });
        frame();
        expect(ref.current.getCurrentScale()).toBe(2);
        expect(canvasDrawingUtils.drawVFOLine.mock.lastCall[1]).toBe(500);
    });

    it.each(['mouse', 'touch'])('maps a %s VFO drag to the visible bandwidth while keeping full SDR tuning bounds', (pointer) => {
        const { container, ref, store } = renderWaterfall();
        act(() => ref.current.setZoomScale(20, 500));
        frame();
        const canvas = container.querySelector('.vfo-markers-canvas');
        if (pointer === 'mouse') {
            fireEvent.mouseDown(canvas, { clientX: 600, clientY: 10, button: 0 });
            fireEvent.mouseMove(document, { clientX: 1400, clientY: 10 });
        } else {
            fireEvent.touchStart(canvas, { touches: [{ clientX: 600, clientY: 10 }] });
            fireEvent.touchMove(document, { touches: [{ clientX: 1400, clientY: 10 }] });
        }
        frame();
        if (pointer === 'mouse') fireEvent.mouseUp(document);
        else fireEvent.touchEnd(document, { touches: [] });

        // 800 pixels is 80 kHz at this zoom. Tuning may pass the viewport edge.
        expect(store.getState().vfo.vfoMarkers[1].frequency).toBe(centerFrequency + 80_000);
        expect(ref.current.getCurrentPosition()).toBe(-9500);
    });

    it('preserves the visible center frequency and resizes backing stores on layout changes', () => {
        const { container, ref } = renderWaterfall();
        act(() => ref.current.setZoomScale(20, 500));
        frame();
        viewportWidth = 600;
        act(() => resizeCallback());
        frame();
        expect(canvasDrawingUtils.drawVFOLine.mock.lastCall[1]).toBe(300);
        expect(container.querySelector('.bookmark-canvas').width).toBe(1200);
        expect(ref.current.getCurrentPosition()).toBe(-5700);
    });
});

it('maps the visible frequency window consistently at either pan limit', () => {
    expect(getOverlayFrequencyRange(100, 40, { width: 1000, scale: 20, positionX: 0 }))
        .toEqual({ startFreq: 80, endFreq: 82, bandwidth: 2 });
    expect(getOverlayFrequencyRange(100, 40, { width: 1000, scale: 20, positionX: -19000 }))
        .toEqual({ startFreq: 118, endFreq: 120, bandwidth: 2 });
});
