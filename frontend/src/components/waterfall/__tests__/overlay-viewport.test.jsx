import React, { createRef } from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { useSelector } from 'react-redux';
import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../../test/test-utils.jsx';
import WaterfallAndBandscope from '../waterfall-bandscope.jsx';
import waterfallReducer, { setSelectedSDRId, setCenterFrequency, setSampleRate } from '../waterfall-slice.jsx';
import vfoReducer from '../vfo-marker/vfo-slice.jsx';
import decodersReducer from '../../decoders/decoders-slice.jsx';
import { canvasDrawingUtils } from '../vfo-marker/vfo-utils.js';
import { getOverlayFrequencyRange } from '../overlay-canvas.js';
import '../../../i18n/config.js';

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
    vi.stubGlobal('PointerEvent', class extends MouseEvent {
        constructor(type, options = {}) {
            super(type, options);
            this.pointerId = options.pointerId ?? 1;
            this.pointerType = options.pointerType ?? 'mouse';
            this.isPrimary = options.isPrimary ?? true;
        }
    });
    vi.stubGlobal('requestAnimationFrame', (callback) => setTimeout(() => callback(performance.now()), 16));
    vi.stubGlobal('cancelAnimationFrame', clearTimeout);
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback) { resizeCallback = callback; }
        observe() {}
        disconnect() {}
    });
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => viewportWidth);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(620);
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

function renderWaterfall(renderer = 'worker', { waitForFrame = true, rulerEnabled = false, statusBarTop } = {}) {
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
                centerFrequency, sampleRate: 2_000_000,
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
    const statusBarRef = createRef();
    if (statusBarTop !== undefined) {
        statusBarRef.current = document.createElement('div');
        statusBarRef.current.getBoundingClientRect = () => ({ top: statusBarTop() });
    }
    function Display() {
        const [enabled, setEnabled] = React.useState(rulerEnabled);
        const frequency = useSelector((state) => state.waterfall.centerFrequency);
        const sampleRate = useSelector((state) => state.waterfall.sampleRate);
        return <WaterfallAndBandscope
        ref={ref} bandscopeCanvasRef={createRef()} waterFallCanvasRef={createRef()}
        waterFallTileCanvasARef={createRef()} waterFallTileCanvasBRef={createRef()}
        waterfallRendererMode={renderer} centerFrequency={frequency} sampleRate={sampleRate}
        bandwidthRulerEnabled={enabled} onBandwidthRulerEnabledChange={setEnabled}
        statusBarRef={statusBarRef}
        frequencyBands={[{ startFrequency: centerFrequency - 100_000, endFrequency: centerFrequency + 100_000,
            name: 'Test band', color: '#ff0' }]}
        />;
    }
    const result = renderWithProviders(<Display />, { store });
    if (waitForFrame) frame();
    return { ...result, ref };
}

describe('waterfall overlay viewport', () => {
    it('sizes the first VFO drawing before waiting for an animation frame', () => {
        const { container } = renderWaterfall('worker', { waitForFrame: false });
        expect(container.querySelector('.vfo-markers-canvas').width).toBe(2000);
        expect(canvasDrawingUtils.drawVFOLine).toHaveBeenCalled();
        expect(canvasDrawingUtils.drawVFOLine.mock.calls.every((call) => call[1] === 500)).toBe(true);
    });

    it('defers overlays in a zero-width layout until their viewport becomes measurable', () => {
        viewportWidth = 0;
        const { container } = renderWaterfall();
        expect(container.querySelector('.vfo-markers-canvas')).toBeNull();
        expect(canvasDrawingUtils.drawVFOLine).not.toHaveBeenCalled();

        viewportWidth = 1000;
        act(() => resizeCallback());
        frame();
        expect(container.querySelector('.vfo-markers-canvas').width).toBe(2000);
        expect(canvasDrawingUtils.drawVFOLine.mock.calls.every((call) => call[1] === 500)).toBe(true);
    });

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

const dragRuler = (canvas, from, to, y = 300, options = {}) => {
    fireEvent.pointerDown(canvas, { clientX: 100 + from, clientY: y, button: 0, ...options });
    fireEvent.pointerMove(canvas, { clientX: 100 + to, clientY: y, ...options });
    fireEvent.pointerUp(canvas, { clientX: 100 + to, clientY: y, ...options });
};

describe('bandwidth ruler', () => {
    it('does not allocate an overlay canvas until the tool is used', () => {
        const { container } = renderWaterfall();
        expect(container.querySelector('.bandwidth-ruler-canvas')).toBeNull();
    });

    it.each(['worker', 'dom-tiles'])('measures a 25 kHz signal at 20× in %s without tuning or panning', (renderer) => {
        const { container, ref, store } = renderWaterfall(renderer, { rulerEnabled: true });
        act(() => ref.current.setZoomScale(20, 500));
        frame();
        const ruler = container.querySelector('.bandwidth-ruler-canvas');
        dragRuler(ruler, 375, 625);

        expect(screen.getByRole('status')).toHaveTextContent('Bandwidth: ≈ 25 kHz');
        expect(screen.getByRole('slider', { name: 'Start frequency' })).toHaveAttribute('aria-valuenow', String(centerFrequency - 12_500));
        expect(screen.getByRole('slider', { name: 'End frequency' })).toHaveAttribute('aria-valuenow', String(centerFrequency + 12_500));
        expect(store.getState().vfo.vfoMarkers[1].frequency).toBe(centerFrequency);
        expect(store.getState().waterfall.recordingBandCenterOffsetHz).toBe(0);

        // Even a compatibility mouse event reaching the native viewport must not pan.
        fireEvent.mouseDown(ruler, { clientX: 500, button: 0 });
        fireEvent.mouseMove(window, { clientX: 700 });
        fireEvent.mouseUp(window);
        expect(ref.current.getCurrentPosition()).toBe(-9500);
        expect(ruler.width).toBe(2000);
        expect(ruler.height).toBe(1224);
        for (let element = ruler; element; element = element.parentElement) {
            expect(element.style.transform).not.toContain('scaleX');
        }
    });

    it.each(['mouse', 'touch'])('moves the entire shaded body with %s while preserving bandwidth', (pointerType) => {
        const { container, ref, store } = renderWaterfall('worker', { rulerEnabled: true });
        act(() => ref.current.setZoomScale(20, 500));
        frame();
        const ruler = container.querySelector('.bandwidth-ruler-canvas');
        dragRuler(ruler, 375, 625);
        // Grab far above the horizontal ruler, within the shaded bandscope body.
        fireEvent.pointerMove(ruler, { clientX: 600, clientY: 100, pointerType });
        expect(ruler.style.cursor).toBe('grab');
        fireEvent.pointerDown(ruler, { clientX: 600, clientY: 100, pointerType, button: 0 });
        expect(ruler.style.cursor).toBe('grabbing');
        fireEvent.pointerMove(ruler, { clientX: 700, clientY: 180, pointerType });
        fireEvent.pointerUp(ruler, { clientX: 700, clientY: 180, pointerType });
        expect(screen.getByRole('status')).toHaveTextContent('25 kHz');
        expect(screen.getByRole('slider', { name: 'Start frequency' })).toHaveAttribute('aria-valuenow', String(centerFrequency - 2500));
        expect(screen.getByRole('slider', { name: 'End frequency' })).toHaveAttribute('aria-valuenow', String(centerFrequency + 22_500));
        expect(contexts.get(ruler).moveTo).toHaveBeenCalledWith(475, 380);
        expect(store.getState().vfo.vfoMarkers[1].frequency).toBe(centerFrequency);
        expect(ref.current.getCurrentPosition()).toBe(-9500);
    });

    it('moves a narrow marker by its label outside the shaded span', () => {
        const { container, ref } = renderWaterfall('worker', { rulerEnabled: true });
        act(() => ref.current.setZoomScale(20, 500));
        frame();
        const ruler = container.querySelector('.bandwidth-ruler-canvas');
        dragRuler(ruler, 490, 510);
        const [panelX, panelY] = contexts.get(ruler).fillRect.mock.lastCall;
        const labelX = panelX + 12;
        expect(labelX).toBeLessThan(490);
        fireEvent.pointerDown(ruler, { clientX: 100 + labelX, clientY: panelY + 20, button: 0 });
        fireEvent.pointerMove(ruler, { clientX: 140 + labelX, clientY: panelY + 80 });
        fireEvent.pointerUp(ruler, { clientX: 140 + labelX, clientY: panelY + 80 });
        expect(screen.getByRole('status')).toHaveTextContent('2 kHz');
        expect(screen.getByRole('slider', { name: 'Start frequency' })).toHaveAttribute('aria-valuenow', String(centerFrequency + 3000));
        expect(screen.getByRole('slider', { name: 'End frequency' })).toHaveAttribute('aria-valuenow', String(centerFrequency + 5000));
        expect(contexts.get(ruler).moveTo).toHaveBeenCalledWith(530, 360);
    });

    it('leaves the center of a narrow span draggable on touchscreens', () => {
        const { container, ref } = renderWaterfall('worker', { rulerEnabled: true });
        act(() => ref.current.setZoomScale(20, 500));
        frame();
        const ruler = container.querySelector('.bandwidth-ruler-canvas');
        dragRuler(ruler, 490, 510);
        dragRuler(ruler, 500, 530, 100, { pointerType: 'touch' });
        expect(screen.getByRole('status')).toHaveTextContent('2 kHz');
        expect(screen.getByRole('slider', { name: 'Start frequency' })).toHaveAttribute('aria-valuenow', String(centerFrequency + 2000));
        expect(screen.getByRole('slider', { name: 'End frequency' })).toHaveAttribute('aria-valuenow', String(centerFrequency + 4000));
    });

    it.each(['worker', 'dom-tiles'])('clips the %s ruler above the floating status bar after a resize', (renderer) => {
        let statusTop = 560;
        const { container } = renderWaterfall(renderer, { rulerEnabled: true, statusBarTop: () => statusTop });
        const ruler = container.querySelector('.bandwidth-ruler-canvas');
        expect(ruler).toHaveAttribute('data-overlay-height', '552');
        expect(ruler.height).toBe(1104);
        expect(container.querySelector('.bandwidth-ruler-overlay')).toHaveStyle({ height: '552px' });
        dragRuler(ruler, 250, 750);

        statusTop = 460;
        act(() => resizeCallback());
        frame();
        expect(ruler).toHaveAttribute('data-overlay-height', '452');
        expect(ruler.height).toBe(904);
        expect(container.querySelector('.bandwidth-ruler-overlay')).toHaveStyle({ height: '452px' });
        expect(contexts.get(ruler).lineTo).toHaveBeenCalledWith(250, 452);
        expect(screen.getByRole('status')).toHaveTextContent('1 MHz');
    });

    it('keeps frequencies fixed when a finished measurement is panned, zoomed and resized', () => {
        const { container, ref } = renderWaterfall('worker', { rulerEnabled: true });
        act(() => ref.current.setZoomScale(20, 500));
        frame();
        const ruler = container.querySelector('.bandwidth-ruler-canvas');
        dragRuler(ruler, 375, 625);
        fireEvent.click(screen.getByRole('button', { name: 'Finish measuring' }));
        expect(ruler.style.pointerEvents).toBe('none');

        fireEvent.mouseDown(container.querySelector('[data-waterfall-viewport]'), { clientX: 700, button: 0 });
        fireEvent.mouseMove(window, { clientX: 600 });
        fireEvent.mouseUp(window);
        frame();
        expect(ref.current.getCurrentPosition()).toBe(-9600);
        expect(contexts.get(ruler).moveTo).toHaveBeenCalledWith(275, 0);

        act(() => ref.current.setZoomScale(10, 500));
        frame();
        viewportWidth = 600;
        act(() => resizeCallback());
        frame();
        expect(ruler.width).toBe(1200);
        expect(screen.getByRole('status')).toHaveTextContent('Bandwidth: ≈ 25 kHz');
        fireEvent.click(screen.getByRole('button', { name: 'Edit measurement' }));
        expect(screen.getByRole('slider', { name: 'Start frequency' })).toHaveAttribute('aria-valuenow', String(centerFrequency - 12_500));
    });

    it('supports reverse drags, edge adjustment, keyboard adjustment and moving the whole span', () => {
        const { container, ref } = renderWaterfall('worker', { rulerEnabled: true });
        act(() => ref.current.setZoomScale(20, 500));
        frame();
        const ruler = container.querySelector('.bandwidth-ruler-canvas');
        dragRuler(ruler, 625, 375);
        expect(screen.getByRole('status')).toHaveTextContent('25 kHz');
        dragRuler(ruler, 375, 325);
        expect(screen.getByRole('status')).toHaveTextContent('30 kHz');
        dragRuler(ruler, 500, 600);
        const start = screen.getByRole('slider', { name: 'Start frequency' });
        const end = screen.getByRole('slider', { name: 'End frequency' });
        expect(start).toHaveAttribute('aria-valuenow', String(centerFrequency - 7500));
        expect(end).toHaveAttribute('aria-valuenow', String(centerFrequency + 22_500));
        fireEvent.keyDown(end, { key: 'ArrowRight' });
        expect(Number(end.getAttribute('aria-valuenow'))).toBeCloseTo(centerFrequency + 22_500 + 2_000_000 / 16384);
        fireEvent.keyDown(start, { key: 'Home' });
        // Home moves this edge outside the zoomed viewport, so its handle is clipped.
        expect(start).not.toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveAttribute('title', expect.stringContaining('Start frequency: 436.5 MHz'));
    });

    it('restores a measurement on Escape, pointer cancellation, a second touch or a click', () => {
        const { container, ref } = renderWaterfall('worker', { rulerEnabled: true });
        act(() => ref.current.setZoomScale(20, 500));
        frame();
        const ruler = container.querySelector('.bandwidth-ruler-canvas');
        dragRuler(ruler, 375, 625, 300, { pointerType: 'touch' });
        for (const cancel of ['escape', 'pointer', 'second-touch']) {
            fireEvent.pointerDown(ruler, { clientX: 200, clientY: 400, button: 0 });
            fireEvent.pointerMove(ruler, { clientX: 400, clientY: 400 });
            if (cancel === 'escape') fireEvent.keyDown(ruler, { key: 'Escape' });
            else if (cancel === 'pointer') fireEvent.pointerCancel(ruler);
            else fireEvent.pointerDown(ruler, { pointerId: 2, pointerType: 'touch', isPrimary: false, button: 0 });
            expect(screen.getByRole('status')).toHaveTextContent('25 kHz');
        }
        dragRuler(ruler, 100, 100);
        expect(screen.getByRole('status')).toHaveTextContent('25 kHz');
        fireEvent.keyDown(ruler, { key: 'Escape' });
        expect(ruler.style.pointerEvents).toBe('none');
        fireEvent.click(screen.getByRole('button', { name: 'Clear measurement' }));
        expect(screen.queryByRole('status')).toBeNull();
    });

    it('clamps a captured drag outside the canvas to the captured spectrum', () => {
        const { container } = renderWaterfall('worker', { rulerEnabled: true });
        dragRuler(container.querySelector('.bandwidth-ruler-canvas'), 250, 1500);
        expect(screen.getByRole('slider', { name: 'End frequency' })).toHaveAttribute('aria-valuenow', String(centerFrequency + 1_000_000));
        expect(screen.getByRole('status')).toHaveTextContent('1.5 MHz');
    });

    it('keeps pinch zoom available while measuring', () => {
        const { container, ref } = renderWaterfall('worker', { rulerEnabled: true });
        const ruler = container.querySelector('.bandwidth-ruler-canvas');
        dragRuler(ruler, 250, 750);
        fireEvent.touchStart(ruler, { touches: [{ clientX: 400, clientY: 300 }, { clientX: 600, clientY: 300 }] });
        fireEvent.touchMove(ruler, { touches: [{ clientX: 300, clientY: 300 }, { clientX: 700, clientY: 300 }] });
        fireEvent.touchEnd(window, { touches: [] });
        frame();
        expect(ref.current.getCurrentScale()).toBe(3);
        expect(screen.getByRole('status')).toHaveTextContent('1 MHz');
    });

    it.each([
        ['SDR', setSelectedSDRId('another-sdr')],
        ['center frequency', setCenterFrequency(438_000_000)],
        ['sample rate', setSampleRate(1_000_000)],
    ])('clears stale measurements when the %s changes', (_name, action) => {
        const { container, store } = renderWaterfall('worker', { rulerEnabled: true });
        dragRuler(container.querySelector('.bandwidth-ruler-canvas'), 250, 750);
        expect(screen.getByRole('status')).toHaveTextContent('1 MHz');
        act(() => store.dispatch(action));
        expect(screen.queryByRole('slider', { name: 'Start frequency' })).toBeNull();
        expect(screen.getByRole('status')).toHaveTextContent('Measure bandwidth');
    });
});

it('maps the visible frequency window consistently at either pan limit', () => {
    expect(getOverlayFrequencyRange(100, 40, { width: 1000, scale: 20, positionX: 0 }))
        .toEqual({ startFreq: 80, endFreq: 82, bandwidth: 2 });
    expect(getOverlayFrequencyRange(100, 40, { width: 1000, scale: 20, positionX: -19000 }))
        .toEqual({ startFreq: 118, endFreq: 120, bandwidth: 2 });
});
