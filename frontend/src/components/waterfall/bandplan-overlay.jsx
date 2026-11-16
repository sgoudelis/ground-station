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
import React, {useRef, useEffect, useLayoutEffect, useCallback} from 'react';
import {Box} from '@mui/material';

const FrequencyBandOverlay = ({
                                  centerFrequency,
                                  sampleRate,
                                  containerWidth,
                                  viewport,
                                  height,
                                  topPadding = 0,
                                  bands = [],
                                  bandHeight = 20,
                                  onBandClick = null,
                              }) => {
    const canvasRef = useRef(null);
    const bandContainerRef = useRef(null);
    const actualWidth = viewport?.width || containerWidth || 1;

    // The stationary canvas covers the visible frequency window.
    const { startFreq, endFreq } = getOverlayFrequencyRange(centerFrequency, sampleRate, viewport);

    // Convert frequencies directly to screen positions.
    const frequencyToPixel = useCallback((frequency) => {
        const freqRange = endFreq - startFreq;
        return ((frequency - startFreq) / freqRange) * actualWidth;
    }, [startFreq, endFreq, actualWidth]);

    // Abbreviate label based on available width
    const abbreviateLabel = useCallback((ctx, name, availableWidth) => {
        ctx.font = '12px Arial, sans-serif';
        const fullWidth = ctx.measureText(name).width;

        // If full name fits, use it
        if (fullWidth <= availableWidth - 16) {
            return name;
        }

        // Common abbreviations for band names
        const abbreviations = {
            'Ham': '',
            'Amateur': 'Ham',
            'Satellite': 'Sat',
            'downlink': 'DL',
            'uplink': 'UL',
            'Broadcast': 'BC',
            'Emergency': 'Emrg',
            'Aircraft': 'AC',
            'Weather': 'WX',
            ' MHz': '',
            ' GHz': '',
        };

        let abbreviated = name;
        for (const [full, short] of Object.entries(abbreviations)) {
            abbreviated = abbreviated.replace(new RegExp(full, 'g'), short);
        }
        abbreviated = abbreviated.replace(/\s+/g, ' ').trim();

        // If still too long, extract key parts
        if (ctx.measureText(abbreviated).width > availableWidth - 16) {
            // Extract numbers and first significant word
            const match = name.match(/(\d+[mkgMKG]?\w*)|([A-Z]+)/g);
            if (match) {
                abbreviated = match.slice(0, 2).join(' ');
            }
        }

        // Last resort: truncate with ellipsis
        if (ctx.measureText(abbreviated).width > availableWidth - 16) {
            while (abbreviated.length > 3 && ctx.measureText(abbreviated + '…').width > availableWidth - 16) {
                abbreviated = abbreviated.slice(0, -1);
            }
            abbreviated += '…';
        }

        return abbreviated;
    }, []);

    // Draw before paint so labels follow the same viewport as the spectrum.
    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = prepareOverlayCanvas(canvas, actualWidth, height, { willReadFrequently: true });

        // Calculate the band drawing area (bottom of the canvas)
        const bandY = height - bandHeight - 1;

        // Filter visible bands
        const visibleBands = bands.filter(band =>
            !(band.endFrequency < startFreq || band.startFrequency > endFreq)
        );

        // Enable alpha blending for overlapping bands
        ctx.globalCompositeOperation = 'source-over';

        // Draw each band with alpha blending (bands already have rgba colors with alpha)
        visibleBands.forEach((band) => {
            const {startFrequency, endFrequency, color = 'rgba(255, 255, 0, 0.3)'} = band;

            // Convert frequencies to pixel positions
            const startX = frequencyToPixel(startFrequency);
            const endX = frequencyToPixel(endFrequency);
            const bandWidth = endX - startX;

            if (bandWidth <= 0) return;

            ctx.fillStyle = color;
            ctx.fillRect(startX, bandY, bandWidth, bandHeight);
        });

        // Prepare label data with abbreviation and smart spacing
        const labelData = [];
        ctx.font = '12px Arial, sans-serif';

        visibleBands.forEach((band) => {
            const {startFrequency, endFrequency, color = 'rgba(255, 255, 0, 0.3)', textColor = '#000000', name} = band;

            if (!name) return;

            // Convert frequencies to pixel positions
            const startX = frequencyToPixel(startFrequency);
            const endX = frequencyToPixel(endFrequency);
            const visibleStartX = Math.max(0, startX);
            const visibleEndX = Math.min(actualWidth, endX);
            const visibleWidth = visibleEndX - visibleStartX;

            // Skip very narrow bands (less than 25px)
            if (visibleWidth < 25) return;

            // Abbreviate label based on available width
            const displayName = abbreviateLabel(ctx, name, visibleWidth);
            const textWidth = ctx.measureText(displayName).width;
            const padding = 8;

            // Calculate initial label position (centered)
            const centerX = (startX + endX) / 2;
            let labelX = centerX;

            // Adjust if center is not visible
            if (centerX < 0) {
                labelX = visibleStartX + (visibleWidth / 2);
            } else if (centerX > actualWidth) {
                labelX = visibleEndX - (visibleWidth / 2);
            }

            // Ensure label stays within canvas
            labelX = Math.max(textWidth / 2 + padding, Math.min(actualWidth - textWidth / 2 - padding, labelX));

            labelData.push({
                x: labelX,
                y: bandY + (bandHeight / 2),
                width: textWidth + padding * 2,
                name: displayName,
                textColor,
                color,
                bandWidth: visibleWidth,
                bandCenterX: centerX,
                visibleStartX,
                visibleEndX,
            });
        });

        // Sort labels by band width (wider bands get priority)
        labelData.sort((a, b) => b.bandWidth - a.bandWidth);

        // Apply smart horizontal spacing to avoid collisions
        const placedLabels = [];
        const minSpacing = 5; // Minimum pixels between labels

        labelData.forEach((label) => {
            let finalX = label.x;
            let hasCollision = true;
            let attempts = 0;
            const maxAttempts = 10;

            while (hasCollision && attempts < maxAttempts) {
                hasCollision = false;

                // Check for horizontal collision with already placed labels
                for (const placed of placedLabels) {
                    const distance = Math.abs(finalX - placed.finalX);
                    const minDistance = (label.width + placed.width) / 2 + minSpacing;

                    if (distance < minDistance) {
                        hasCollision = true;

                        // Try to shift label left or right
                        if (finalX < placed.finalX) {
                            finalX = placed.finalX - minDistance;
                        } else {
                            finalX = placed.finalX + minDistance;
                        }
                        break;
                    }
                }

                // Keep label within canvas bounds
                const minX = label.width / 2;
                const maxX = actualWidth - label.width / 2;

                if (finalX < minX || finalX > maxX) {
                    // Can't fit, skip this label
                    finalX = null;
                    break;
                }

                attempts++;
            }

            // Draw label if we found a valid position
            if (finalX !== null) {
                placedLabels.push({...label, finalX});

                // Set text properties
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                // Draw text with shadow for readability
                ctx.shadowColor = 'rgba(0, 0, 0, 0.7)';
                ctx.shadowBlur = 2;
                ctx.shadowOffsetX = 1;
                ctx.shadowOffsetY = 1;

                ctx.fillStyle = label.textColor;
                ctx.fillText(label.name, finalX, label.y);

                // Reset shadow
                ctx.shadowColor = 'transparent';
                ctx.shadowBlur = 0;
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;

                // Draw connecting line if label was moved significantly
                const needsConnector = Math.abs(finalX - label.x) > 10;
                if (needsConnector) {
                    const connectToX = Math.max(label.visibleStartX, Math.min(label.visibleEndX, label.bandCenterX));

                    ctx.strokeStyle = label.color;
                    ctx.lineWidth = 1;
                    ctx.setLineDash([2, 2]);
                    ctx.beginPath();
                    ctx.moveTo(connectToX, label.y);
                    ctx.lineTo(finalX, label.y);
                    ctx.stroke();
                    ctx.setLineDash([]);
                }
            }
        });
    }, [bands, centerFrequency, sampleRate, actualWidth, height, bandHeight, startFreq, endFreq, frequencyToPixel, abbreviateLabel, viewport]);

    // Handle click events on the canvas
    const handleCanvasClick = useCallback((e) => {
        if (!onBandClick) return;

        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const widthRatio = actualWidth / rect.width;
        const canvasX = clickX * widthRatio;
        const clickY = e.clientY - rect.top;

        // Check if click was in the band area
        const bandY = height - bandHeight;
        if (clickY >= bandY && clickY <= height) {
            // Calculate which frequency was clicked (full spectrum coordinates)
            const freqRange = endFreq - startFreq;
            const clickedFreq = startFreq + (canvasX / actualWidth) * freqRange;

            // Find which band was clicked
            const clickedBand = bands.find((band) => {
                return clickedFreq >= band.startFrequency && clickedFreq <= band.endFrequency;
            });

            if (clickedBand) {
                onBandClick(clickedBand);
            }
        }
    }, [bands, onBandClick, startFreq, endFreq, height, bandHeight, actualWidth]);

    // Set up click event listener
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !onBandClick) return;

        canvas.addEventListener('click', handleCanvasClick);
        return () => canvas.removeEventListener('click', handleCanvasClick);
    }, [handleCanvasClick, onBandClick]);

    return (
        <Box
            ref={bandContainerRef}
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: `${height}px`,
                pointerEvents: onBandClick ? 'auto' : 'none',
                zIndex: 10,
            }}
        >
            <canvas
                className={'frequency-band-overlay'}
                ref={canvasRef}
                width={actualWidth}
                height={height}
                style={{
                    display: 'block',
                    width: '100%',
                    height: '100%',
                    touchAction: 'pan-y',
                    cursor: onBandClick ? 'pointer' : 'default',
                }}
            />
        </Box>
    );
};

export default FrequencyBandOverlay;
