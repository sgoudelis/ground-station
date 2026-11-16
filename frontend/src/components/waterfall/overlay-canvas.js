/**
 * Copyright (c) 2026 Efstratios Goudelis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

// Text overlays draw directly into the visible viewport. Only the spectrum
// pixels inherit CSS zoom; overlay backing stores never grow with that zoom.
export const getOverlayFrequencyRange = (centerFrequency, sampleRate, viewport) => {
    const scale = viewport?.width ? viewport.scale : 1;
    const width = viewport?.width || 1;
    const positionX = viewport?.width ? viewport.positionX : 0;
    const bandwidth = sampleRate / scale;
    const startFreq = centerFrequency - sampleRate / 2 - (positionX / width) * bandwidth;
    return { startFreq, endFreq: startFreq + bandwidth, bandwidth };
};

export const prepareOverlayCanvas = (canvas, width, height, options) => {
    const pixelRatio = window.devicePixelRatio || 1;
    const targetWidth = Math.max(1, Math.round(width * pixelRatio));
    const targetHeight = Math.max(1, Math.round(height * pixelRatio));
    if (canvas.width !== targetWidth) canvas.width = targetWidth;
    if (canvas.height !== targetHeight) canvas.height = targetHeight;

    const ctx = canvas.getContext('2d', options);
    // Keep every draw and hit test in CSS pixels, including fractional DPRs.
    ctx.setTransform(targetWidth / width, 0, 0, targetHeight / height, 0, 0);
    ctx.clearRect(0, 0, width, height);
    return ctx;
};
