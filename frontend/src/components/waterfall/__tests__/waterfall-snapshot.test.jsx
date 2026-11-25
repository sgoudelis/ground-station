import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useWaterfallSnapshot } from '../waterfall-snapshot.js';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
});

it('exports complete viewport overlays and crops spectrum pixels using the displayed zoom', async () => {
    document.body.innerHTML = `<div data-waterfall-viewport>
        <div><div style="transform: matrix(20, 0, 0, 1, -9500, 0)"><canvas class="bandscope-canvas" width="16000" height="200"></canvas></div>
            <canvas class="bookmark-canvas" width="2000" height="400"></canvas>
            <canvas class="vfo-markers-canvas" width="2000" height="400"></canvas></div>
        <canvas class="frequency-scale-canvas" width="2000" height="40"></canvas>
        <canvas class="bandwidth-ruler-canvas" width="2000" height="1240" data-overlay-height="620"></canvas>
    </div>`;
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    vi.stubGlobal('DOMMatrixReadOnly', class {
        constructor() { this.m11 = 20; this.m41 = -9500; }
    });
    vi.stubGlobal('Image', class {
        width = 16000;
        set src(_url) { queueMicrotask(() => this.onload()); }
    });
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,test');
    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
        drawImage, fillRect: vi.fn(),
    });
    const bandscope = document.querySelector('.bandscope-canvas');
    const bookmark = document.querySelector('.bookmark-canvas');
    const ruler = document.querySelector('.frequency-scale-canvas');
    const bandwidthRuler = document.querySelector('.bandwidth-ruler-canvas');
    const margin = document.createElement('canvas');
    margin.width = 60;
    const { result } = renderHook(() => useWaterfallSnapshot({
        bandscopeCanvasRef: { current: bandscope }, dBAxisScopeCanvasRef: { current: margin },
        waterFallLeftMarginCanvasRef: { current: null }, waterFallLeftMarginFillerRef: { current: null },
        bandScopeHeight: 200, frequencyScaleHeight: 20, waterFallCanvasHeight: 400,
        waterFallCanvasWidth: 16000, waterFallVisualWidth: 1000,
        // Redux persistence can still contain the previous zoom.
        waterFallScaleX: 1, waterFallPositionX: 0, waterfallRendererMode: 'dom-tiles',
        waterFallTileCanvasARef: { current: document.createElement('canvas') },
    }));

    await act(async () => {
        expect(await result.current.captureSnapshot(1060)).toBe('data:image/png;base64,test');
    });

    expect(drawImage).toHaveBeenCalledWith(bandscope, 7600, 0, 800, 200, 60, 0, 1000, 200);
    expect(drawImage).toHaveBeenCalledWith(bookmark, 0, 0, 2000, 400, 60, 0, 1000, 200);
    expect(drawImage).toHaveBeenCalledWith(ruler, 0, 0, 2000, 40, 60, 200, 1000, 20);
    expect(drawImage).toHaveBeenCalledWith(bandwidthRuler, 0, 0, 2000, 1240, 60, 0, 1000, 620);
    const measurementCall = drawImage.mock.calls.findIndex(([source]) => source === bandwidthRuler);
    const waterfallCall = drawImage.mock.calls.findIndex(([source]) => source instanceof Image);
    expect(measurementCall).toBeGreaterThan(waterfallCall);
});
