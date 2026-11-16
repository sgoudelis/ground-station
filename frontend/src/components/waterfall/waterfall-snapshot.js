/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

import { useCallback } from 'react';
import { useTheme } from '@mui/material';

/**
 * Custom hook for capturing waterfall display snapshots
 *
 * This hook provides functionality to capture a complete waterfall display including:
 * - Bandscope spectrum analyzer
 * - Bookmark overlays
 * - Bandplan overlays
 * - Frequency scale labels
 * - dB axis scales (left margin)
 * - Main waterfall canvas
 *
 * The captured image is scaled to a target width while preserving the left margin at original size.
 */
export const useWaterfallSnapshot = ({
    bandscopeCanvasRef,
    dBAxisScopeCanvasRef,
    waterFallLeftMarginCanvasRef,
    waterFallLeftMarginFillerRef,
    bandScopeHeight,
    frequencyScaleHeight,
    waterFallCanvasHeight,
    waterFallCanvasWidth,
    waterFallVisualWidth,
    bandscopeTopPadding = 0,
    waterFallScaleX = 1,
    waterFallPositionX = 0,
    waterfallRendererMode = 'worker',
    waterFallTileCanvasARef,
    waterFallTileCanvasBRef,
}) => {
    const theme = useTheme();

    /**
     * Captures the waterfall canvas from the active renderer
     * @returns {Promise<string|null>} Data URL of the waterfall canvas or null if timeout
     */
    const captureDomTileWaterfallCanvas = useCallback(() => {
        const tileCanvases = [
            waterFallTileCanvasARef?.current,
            waterFallTileCanvasBRef?.current,
        ].filter(Boolean);

        if (tileCanvases.length === 0) {
            console.error('Waterfall tile canvases are not available');
            return null;
        }

        // The DOM renderer keeps the waterfall in two vertically translated
        // tiles. Rebuild the visible waterfall strip before using the same
        // horizontal crop path as the worker renderer.
        const canvas = document.createElement('canvas');
        canvas.width = waterFallCanvasWidth;
        canvas.height = waterFallCanvasHeight;
        const ctx = canvas.getContext('2d');

        tileCanvases.forEach((tileCanvas) => {
            const transform = window.getComputedStyle(tileCanvas).transform;
            const matrix = transform === 'none' ? null : new DOMMatrixReadOnly(transform);
            const offsetY = matrix ? matrix.m42 : 0;
            ctx.drawImage(tileCanvas, 0, offsetY);
        });

        return canvas.toDataURL('image/png');
    }, [waterFallCanvasHeight, waterFallCanvasWidth, waterFallTileCanvasARef, waterFallTileCanvasBRef]);

    const captureWaterfallCanvas = useCallback(async () => {
        if (waterfallRendererMode === 'dom-tiles') {
            return captureDomTileWaterfallCanvas();
        }

        // Request waterfall canvas capture from worker
        const captureEvent = new CustomEvent('capture-waterfall-canvas');
        window.dispatchEvent(captureEvent);

        // Wait for the waterfall canvas to be captured
        const maxWaitTime = 2000;
        const pollInterval = 50;
        let elapsed = 0;
        let waterfallDataURL = null;

        while (elapsed < maxWaitTime) {
            await new Promise(resolve => setTimeout(resolve, pollInterval));
            elapsed += pollInterval;

            if (window.waterfallCanvasDataURL) {
                waterfallDataURL = window.waterfallCanvasDataURL;
                delete window.waterfallCanvasDataURL;
                break;
            }
        }

        if (!waterfallDataURL) {
            console.error('Waterfall canvas capture timeout');
            return null;
        }

        return waterfallDataURL;
    }, [captureDomTileWaterfallCanvas, waterfallRendererMode]);

    /**
     * Finds overlay canvases in the DOM
     * @returns {Object} Waterfall overlay canvas elements
     */
    const findOverlayCanvases = useCallback(() => {
        let bookmarkCanvas = null;
        let bandplanCanvas = null;
        let frequencyScaleCanvas = null;
        const frequencyScaleLeftCanvas = waterFallLeftMarginFillerRef.current;
        let vfoContainerCanvas = null;
        let recordingBandCanvas = null;

        const bandscopeCanvas = bandscopeCanvasRef.current;
        // Limit discovery to this waterfall. The old document-wide search could
        // select an unrelated small canvas when another page feature was open.
        const waterfallContainer = bandscopeCanvas?.closest('[data-waterfall-viewport]');
        const allCanvases = waterfallContainer?.querySelectorAll('canvas') || [];

        allCanvases.forEach(canvas => {
            // Look for bookmark canvas by its class name
            if (canvas.classList.contains('bookmark-canvas')) {
                bookmarkCanvas = canvas;
            } else if (canvas.classList.contains('frequency-band-overlay')) {
                // Look for bandplan overlay canvas by its class name
                bandplanCanvas = canvas;
            } else if (canvas.classList.contains('recording-band-overlay')) {
                recordingBandCanvas = canvas;
            } else if (canvas.classList.contains('frequency-scale-canvas')) {
                frequencyScaleCanvas = canvas;
            } else if (canvas.classList.contains('vfo-markers-canvas')) {
                // VFO container overlay
                vfoContainerCanvas = canvas;
            }
        });

        return {
            bookmarkCanvas,
            bandplanCanvas,
            frequencyScaleCanvas,
            frequencyScaleLeftCanvas,
            vfoContainerCanvas,
            recordingBandCanvas,
        };
    }, [bandscopeCanvasRef, waterFallLeftMarginFillerRef]);

    /**
     * Creates a composite canvas with all waterfall elements, cropped to visible area
     * @param {string} waterfallDataURL - Data URL of the waterfall canvas
     * @param {Object} overlayCanvases - Object containing overlay canvas elements
     * @returns {Promise<HTMLCanvasElement>} Composite canvas with visible elements
     */
    const createCompositeCanvas = useCallback(async (waterfallDataURL, overlayCanvases) => {
        const bandscopeCanvas = bandscopeCanvasRef.current;
        const dBAxisScopeCanvas = dBAxisScopeCanvasRef.current;
        const waterfallLeftMarginCanvas = waterFallLeftMarginCanvasRef.current;
        const {
            bookmarkCanvas,
            bandplanCanvas,
            frequencyScaleCanvas,
            frequencyScaleLeftCanvas,
            vfoContainerCanvas,
            recordingBandCanvas,
        } = overlayCanvases;

        // Get the actual visual container width from the DOM
        const container = bandscopeCanvas.parentElement;
        const actualVisualWidth = container ? container.clientWidth : waterFallVisualWidth;

        const leftMarginWidth = dBAxisScopeCanvas ? dBAxisScopeCanvas.width : 0;
        const bandscopeDisplayHeight = bandScopeHeight + bandscopeTopPadding;
        const totalHeight = bandscopeDisplayHeight + frequencyScaleHeight + waterFallCanvasHeight;

        // Read the displayed transform rather than the debounced Redux values.
        // Text overlays already contain only this visible frequency window.
        const transform = window.getComputedStyle(bandscopeCanvas.parentElement).transform;
        const matrix = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform) : null;
        const scaleX = matrix?.m11 || waterFallScaleX;
        const positionX = matrix?.m41 ?? waterFallPositionX;

        // Convert visual container width to canvas coordinates
        const visualToCanvasRatio = waterFallCanvasWidth / actualVisualWidth;

        // Calculate visible width in canvas pixels
        const visibleCanvasWidth = waterFallCanvasWidth / scaleX;

        // Convert the pan offset from visual pixels to canvas pixels
        const canvasSourceX = Math.max(0, (-positionX * visualToCanvasRatio) / scaleX);
        const canvasSourceWidth = Math.min(visibleCanvasWidth, waterFallCanvasWidth - canvasSourceX);

        const drawOverlay = (canvas, destinationY, destinationHeight) => {
            if (!canvas || canvas.width <= 0 || canvas.height <= 0) {
                return;
            }

            ctx.drawImage(
                canvas,
                0, 0, canvas.width, canvas.height,
                leftMarginWidth, destinationY, actualVisualWidth, destinationHeight
            );
        };

        // Compose in screen coordinates so text keeps the same proportions as
        // the display, independently of zoom and each canvas backing-store DPR.
        const totalWidth = leftMarginWidth + actualVisualWidth;

        // Create composite canvas for visible area
        const compositeCanvas = document.createElement('canvas');
        compositeCanvas.width = totalWidth;
        compositeCanvas.height = totalHeight;
        const ctx = compositeCanvas.getContext('2d');

        // Fill background
        ctx.fillStyle = theme.palette.background.default;
        ctx.fillRect(0, 0, totalWidth, totalHeight);

        let yOffset = 0;

        // Draw dB axis for bandscope on the left (full height, not cropped)
        if (dBAxisScopeCanvas) {
            ctx.drawImage(dBAxisScopeCanvas, 0, yOffset, leftMarginWidth, bandscopeDisplayHeight);
        }

        // Draw bandscope (cropped to visible area)
        ctx.drawImage(
            bandscopeCanvas,
            canvasSourceX, 0, canvasSourceWidth, bandScopeHeight, // source crop
            leftMarginWidth, yOffset + bandscopeTopPadding, actualVisualWidth, bandScopeHeight // destination
        );

        // The bandscope overlays are painted in their DOM stacking order.
        drawOverlay(bookmarkCanvas, yOffset, bandscopeDisplayHeight);
        drawOverlay(bandplanCanvas, yOffset, bandscopeDisplayHeight);
        drawOverlay(vfoContainerCanvas, yOffset, bandscopeDisplayHeight);
        drawOverlay(recordingBandCanvas, yOffset, bandscopeDisplayHeight);

        yOffset += bandscopeDisplayHeight;

        // Draw small canvas between dB axes (21px height)
        if (frequencyScaleLeftCanvas) {
            ctx.drawImage(frequencyScaleLeftCanvas, 0, yOffset, leftMarginWidth, frequencyScaleHeight);
        }

        if (frequencyScaleCanvas && frequencyScaleCanvas.width > 0 && frequencyScaleCanvas.height > 0) {
            drawOverlay(frequencyScaleCanvas, yOffset, frequencyScaleHeight);
        } else {
            // Fill with background if not available
            ctx.fillStyle = theme.palette.background.paper;
            ctx.fillRect(leftMarginWidth, yOffset, actualVisualWidth, frequencyScaleHeight);
        }
        yOffset += frequencyScaleHeight;

        // Draw waterfall left margin (dB axis)
        if (waterfallLeftMarginCanvas) {
            ctx.drawImage(waterfallLeftMarginCanvas, 0, yOffset, leftMarginWidth, waterFallCanvasHeight);
        }

        // Draw waterfall from data URL
        const waterfallImg = new Image();
        await new Promise((resolve, reject) => {
            waterfallImg.onload = resolve;
            waterfallImg.onerror = reject;
            waterfallImg.src = waterfallDataURL;
        });

        // Waterfall should now be at full resolution (same as bandscope)
        const waterfallScale = waterfallImg.width / waterFallCanvasWidth;
        const waterfallSourceX = canvasSourceX * waterfallScale;
        const waterfallSourceWidth = canvasSourceWidth * waterfallScale;

        ctx.drawImage(
            waterfallImg,
            waterfallSourceX, 0, waterfallSourceWidth, waterFallCanvasHeight,
            leftMarginWidth, yOffset, actualVisualWidth, waterFallCanvasHeight
        );

        return compositeCanvas;
    }, [
        bandscopeCanvasRef,
        dBAxisScopeCanvasRef,
        waterFallLeftMarginCanvasRef,
        bandScopeHeight,
        bandscopeTopPadding,
        frequencyScaleHeight,
        waterFallCanvasHeight,
        waterFallCanvasWidth,
        waterFallVisualWidth,
        waterFallScaleX,
        waterFallPositionX,
        theme
    ]);

    /**
     * Scales the composite canvas to target width while keeping left margin at original size
     * Also crops the image to keep only the top 900px
     * @param {HTMLCanvasElement} compositeCanvas - The composite canvas to scale (already cropped to visible area)
     * @param {number} targetTotalWidth - Target width for the final image (default: null = no scaling)
     * @returns {HTMLCanvasElement} Scaled and cropped final canvas
     */
    const scaleCompositeCanvas = useCallback((compositeCanvas, targetTotalWidth = null) => {
        const dBAxisScopeCanvas = dBAxisScopeCanvasRef.current;
        const leftMarginWidth = dBAxisScopeCanvas ? dBAxisScopeCanvas.width : 0;
        const totalHeight = bandScopeHeight + bandscopeTopPadding + frequencyScaleHeight + waterFallCanvasHeight;
        const croppedHeight = Math.min(900, totalHeight); // Crop to top 900px

        // The composite canvas already contains only the visible area
        const visibleMainWidth = compositeCanvas.width - leftMarginWidth;

        // If no target width specified, use the composite width (no scaling)
        if (!targetTotalWidth) {
            targetTotalWidth = compositeCanvas.width;
        }

        // Step 1: Extract the main area (without left margin) to scale it
        const targetMainWidth = targetTotalWidth - leftMarginWidth; // Reserve space for left margin
        const scaledMainCanvas = document.createElement('canvas');
        scaledMainCanvas.width = targetMainWidth;
        scaledMainCanvas.height = croppedHeight;
        const scaledMainCtx = scaledMainCanvas.getContext('2d');

        // Draw only the main waterfall area (without left margin) scaled and cropped
        scaledMainCtx.drawImage(
            compositeCanvas,
            leftMarginWidth, 0, visibleMainWidth, croppedHeight, // source (cropped)
            0, 0, targetMainWidth, croppedHeight // destination (scaled)
        );

        // Step 2: Create final canvas with left margin at original size + scaled main area
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = targetTotalWidth;
        finalCanvas.height = croppedHeight;
        const finalCtx = finalCanvas.getContext('2d');

        // Fill background
        finalCtx.fillStyle = theme.palette.background.default;
        finalCtx.fillRect(0, 0, targetTotalWidth, croppedHeight);

        // Draw left margin at original size (cropped)
        finalCtx.drawImage(
            compositeCanvas,
            0, 0, leftMarginWidth, croppedHeight, // source (left margin only, cropped)
            0, 0, leftMarginWidth, croppedHeight // destination (same size)
        );

        // Draw scaled main area to the right
        finalCtx.drawImage(scaledMainCanvas, leftMarginWidth, 0, targetMainWidth, croppedHeight);

        return finalCanvas;
    }, [
        dBAxisScopeCanvasRef,
        bandScopeHeight,
        bandscopeTopPadding,
        frequencyScaleHeight,
        waterFallCanvasHeight,
        theme
    ]);

    /**
     * Captures a complete waterfall snapshot
     * @param {number} targetWidth - Target width for the final image (default: 1620)
     * @returns {Promise<string|null>} Data URL of the captured snapshot or null if failed
     */
    const captureSnapshot = useCallback(async (targetWidth = 1620) => {
        try {
            const bandscopeCanvas = bandscopeCanvasRef.current;
            if (!bandscopeCanvas) {
                console.error('Bandscope canvas not available');
                return null;
            }

            // Step 1: Capture waterfall canvas from worker
            const waterfallDataURL = await captureWaterfallCanvas();
            if (!waterfallDataURL) {
                return null;
            }

            // Step 2: Find overlay canvases
            const overlayCanvases = findOverlayCanvases();

            // Step 3: Create composite canvas at original size
            const compositeCanvas = await createCompositeCanvas(waterfallDataURL, overlayCanvases);

            // Step 4: Scale to target width (keeping left margin at original size)
            const finalCanvas = scaleCompositeCanvas(compositeCanvas, targetWidth);

            // Step 5: Convert to data URL
            return finalCanvas.toDataURL('image/png');

        } catch (error) {
            console.error('Error capturing waterfall snapshot:', error);
            return null;
        }
    }, [
        bandscopeCanvasRef,
        captureWaterfallCanvas,
        findOverlayCanvases,
        createCompositeCanvas,
        scaleCompositeCanvas
    ]);

    return {
        captureSnapshot
    };
};
