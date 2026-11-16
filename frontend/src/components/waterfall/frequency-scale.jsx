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


import { getOverlayFrequencyRange, prepareOverlayCanvas } from './overlay-canvas.js';
import React, { useRef, useLayoutEffect } from 'react';
import { useTheme } from '@mui/material';
import {preciseHumanizeFrequency} from "../common/common.jsx";

const FrequencyScale = ({
    centerFrequency,
    sampleRate,
    containerWidth,
    viewport,
    canvasHeight = 20
}) => {
    const theme = useTheme();
    const canvasRef = useRef(null);
    const frequencyScaleContainerRef = useRef(null);
    const actualWidth = viewport?.width || containerWidth || 1;

    // Calculate start and end frequencies
    const { startFreq, endFreq } = getOverlayFrequencyRange(centerFrequency, sampleRate, viewport);

    // Draw the ruler in visible-frequency coordinates before the browser paints.
    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = prepareOverlayCanvas(canvas, actualWidth, canvasHeight, { alpha: false });
        const height = canvasHeight;

        // Clear the canvas
        ctx.fillStyle = theme.palette.background.paper;
        ctx.fillRect(0, 0, actualWidth, height);

        // Calculate frequency range and tick spacing
        const freqRange = endFreq - startFreq;

        // More adaptive tick spacing based on container width
        let minPixelsPerMajorTick;
        if (actualWidth > 1200) {
            // More ticks for very wide displays
            minPixelsPerMajorTick = 90;
        } else if (actualWidth > 800) {
            // Medium density for wider displays
            minPixelsPerMajorTick = 100;
        } else {
            // Original spacing for smaller displays
            minPixelsPerMajorTick = 110;
        }

        // Increase maximum number of ticks for larger displays
        const maxTicks = Math.max(16, Math.min(24, Math.floor(actualWidth / 200)));
        const targetMajorTickCount = Math.max(2, Math.min(Math.floor(actualWidth / minPixelsPerMajorTick), maxTicks));

        // Calculate the approximate step size for ticks based on frequency range and target tick count
        const approxStepSize = freqRange / targetMajorTickCount;
        // Calculate the magnitude (power of 10) for nice round numbers
        const magnitude = 10 ** Math.floor(Math.log10(approxStepSize));

        // Choose nice rounded tick step values based on magnitude:
        // - Use 1x magnitude if ratio < 1.5 (e.g. 1000, 1Hz etc)
        // - Use 2x magnitude if ratio < 3 (e.g. 2000, 2Hz etc)
        // - Use 5x magnitude if ratio < 7.5 (e.g. 5000, 5Hz etc)
        // - Use 10x magnitude otherwise (e.g. 10000, 10Hz etc)
        let tickStep;
        if (approxStepSize / magnitude < 1.5) {
            tickStep = magnitude;
        } else if (approxStepSize / magnitude < 3) {
            tickStep = 2 * magnitude;
        } else if (approxStepSize / magnitude < 7.5) {
            tickStep = 5 * magnitude;
        } else {
            tickStep = 10 * magnitude;
        }

        // Calculate where the first tick should be (round up to the next nice number)
        const firstTick = Math.ceil(startFreq / tickStep) * tickStep;

        // Adaptive minor ticks based on width
        let minorTicksPerMajor;
        if (actualWidth > 1000) {
            // More detail for very wide displays
            minorTicksPerMajor = 20;
        } else if (actualWidth > 700) {
            // Original setting for medium displays
            minorTicksPerMajor = 10;
        } else if (actualWidth > 300) {
            // Fewer ticks for smaller displays
            minorTicksPerMajor = 5;
        } else {
            // No minor ticks for very small displays
            minorTicksPerMajor = 2;
        }

        const minorStep = minorTicksPerMajor > 0 ? tickStep / minorTicksPerMajor : 0;

        // Determine actual major ticks (might be different from target due to rounding)
        const majorTicks = [];
        for (let freq = firstTick; freq <= endFreq + tickStep/10; freq += tickStep) {
            if (freq >= startFreq - tickStep/10) {
                majorTicks.push(freq);
            }
        }
        // Only draw labels if we have at least one major tick
        if (majorTicks.length > 0) {
            // This sets how much space each label needs to be displayed
            const actualPixelsPerTick = actualWidth / majorTicks.length;

            // Determine font size based on available space
            const fontSizeBase = Math.min(11, Math.max(8, Math.floor(actualWidth / 100 + 8)));
            ctx.font = `${fontSizeBase}px monospace`;

            // Draw minor and major ticks
            for (let freq = firstTick - (minorTicksPerMajor > 0 ? minorStep * minorTicksPerMajor : 0);
                 freq <= endFreq + tickStep/10; // Small buffer to ensure we include the last tick
                 freq += minorStep > 0 ? minorStep : tickStep) {

                if (freq < startFreq) {
                    continue;
                }

                const isBigTick = Math.abs(Math.round(freq / tickStep) * tickStep - freq) < tickStep / 100;
                const x = Math.round(((freq - startFreq) / freqRange) * actualWidth);

                if (isBigTick) {
                    // Draw a big tick
                    ctx.beginPath();
                    ctx.strokeStyle = theme.palette.text.primary;
                    ctx.lineWidth = 1;
                    ctx.moveTo(x, height - 8);
                    ctx.lineTo(x, height);
                    ctx.stroke();

                    // Draw frequency label
                    const freqText = preciseHumanizeFrequency(freq);
                    ctx.fillStyle = theme.palette.text.primary;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'top';
                    ctx.fillText(freqText, x, 2);

                } else if (minorStep > 0) {
                    // Allow some minor ticks to have labels when there's room
                    const isLabeledMinor = actualWidth > 1000 &&
                        (minorTicksPerMajor <= 5 || freq % (tickStep / 2) < minorStep / 2);

                    ctx.beginPath();
                    ctx.strokeStyle = isLabeledMinor
                        ? theme.palette.text.secondary
                        : theme.palette.text.disabled;
                    ctx.lineWidth = 1;
                    ctx.moveTo(x, isLabeledMinor ? height - 6 : height - 4);
                    ctx.lineTo(x, height);
                    ctx.stroke();

                    // Draw some labels on important minor ticks when there's a lot of space
                    if (isLabeledMinor && actualWidth > 1000) {
                        const minorFreqText = preciseHumanizeFrequency(freq);
                        const minorTextWidth = ctx.measureText(minorFreqText).width;

                        if (actualPixelsPerTick / (minorTicksPerMajor / 7) >= (minorTextWidth)) {
                            ctx.fillStyle = theme.palette.text.secondary;
                            ctx.textAlign = 'center';
                            ctx.textBaseline = 'top';
                            ctx.font = `${fontSizeBase}px Monospace`;
                            ctx.fillText(minorFreqText, x, 2);
                        }
                    }
                }
            }
        }

    }, [startFreq, endFreq, actualWidth, canvasHeight, theme.palette, viewport]);

    return (
        <div
            ref={frequencyScaleContainerRef}
            style={{
                width: '100%',
                height: `${canvasHeight}px`,
                position: 'relative',
                boxShadow: '0 4px 8px rgba(0, 0, 0, 0.5)',
            }}
        >
            <canvas
                className={'frequency-scale-canvas'}
                ref={canvasRef}
                width={actualWidth}
                height={canvasHeight}
                style={{
                    display: 'block',
                    width: '100%',
                    height: '100%',
                    backgroundColor: theme.palette.background.paper,
                    touchAction: 'pan-y',
                }}
            />
        </div>
    );
};

export default FrequencyScale;
