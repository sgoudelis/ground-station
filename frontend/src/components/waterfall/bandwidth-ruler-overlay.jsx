/**
 * Copyright (c) 2026 Efstratios Goudelis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, IconButton, Paper, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import StraightenIcon from '@mui/icons-material/Straighten';
import CloseIcon from '@mui/icons-material/Close';
import CheckIcon from '@mui/icons-material/Check';
import EditIcon from '@mui/icons-material/Edit';
import { useTranslation } from 'react-i18next';
import { getOverlayFrequencyRange, prepareOverlayCanvas } from './overlay-canvas.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const formatHz = (value, precision, language) => {
    const unit = Math.abs(value) >= 1e6 ? 1e6 : Math.abs(value) >= 1e3 ? 1e3 : 1;
    const digits = clamp(Math.ceil(Math.log10(unit / precision)), 0, 6);
    return `${new Intl.NumberFormat(language, { maximumFractionDigits: digits }).format(value / unit)} ${unit === 1e6 ? 'MHz' : unit === 1e3 ? 'kHz' : 'Hz'}`;
};

/**
 * A screen-sized overlay shared by both FFT renderers. Endpoints stay in Hz,
 * so navigating the spectrum never changes the measured bandwidth.
 */
export default function BandwidthRulerOverlay({
    enabled, onEnabledChange, centerFrequency, sampleRate, fftSize, viewport, height,
}) {
    const theme = useTheme();
    const { t, i18n } = useTranslation('waterfall');
    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    const dragRef = useRef(null);
    const panelBoundsRef = useRef(null);
    const [measurement, setMeasurement] = useState(null);
    const [cursor, setCursor] = useState('crosshair');
    const width = viewport.width;
    const { startFreq, bandwidth } = getOverlayFrequencyRange(centerFrequency, sampleRate, viewport);
    const minFrequency = centerFrequency - sampleRate / 2;
    const maxFrequency = centerFrequency + sampleRate / 2;
    const hzPerPixel = bandwidth / width;
    // Pixel placement and FFT bins both limit useful displayed precision.
    const precision = Math.max(hzPerPixel, sampleRate / (Number(fftSize) || 1));
    const language = i18n.resolvedLanguage || i18n.language || 'en';
    const format = (frequency) => formatHz(frequency, precision, language);
    const frequencyAt = (x) => clamp(startFreq + x * hzPerPixel, minFrequency, maxFrequency);
    const xAt = (frequency) => (frequency - startFreq) / hzPerPixel;
    const startX = measurement ? xAt(measurement.startHz) : 0;
    const endX = measurement ? xAt(measurement.endHz) : 0;
    const rulerY = measurement ? clamp(measurement.yRatio * height, 82, Math.max(82, height - 20)) : 0;
    const color = theme.palette.warning.main;
    const readout = measurement ? `${t('bandwidth_ruler.bandwidth')}: ≈ ${format(measurement.endHz - measurement.startHz)}` : '';
    const details = measurement ? [
        `${t('bandwidth_ruler.start')}: ${format(measurement.startHz)}`,
        `${t('bandwidth_ruler.end')}: ${format(measurement.endHz)}`,
        `${t('bandwidth_ruler.center')}: ${format((measurement.startHz + measurement.endHz) / 2)}`,
    ].join('\n') : '';

    const getDragKind = (x, y, pointerType) => {
        if (!measurement) return 'new';
        const panel = panelBoundsRef.current;
        // The label can extend beyond a narrow signal. Its whole surface still
        // belongs to the marker, and takes priority over an edge behind it.
        if (panel && x >= panel.x && x <= panel.x + panel.width
            && y >= panel.y && y <= panel.y + panel.height) return 'move';
        const hitWidth = pointerType === 'touch' ? 24 : 10;
        // Leave the middle third draggable even when a narrow signal's edge
        // hit areas would otherwise overlap, especially on touchscreens.
        const innerHitWidth = Math.min(hitWidth, (endX - startX) / 3);
        if (x >= startX - hitWidth && x <= startX + innerHitWidth) return 'start';
        if (x >= endX - innerHitWidth && x <= endX + hitWidth) return 'end';
        return x >= startX && x <= endX ? 'move' : 'new';
    };

    const cancelDrag = () => {
        const drag = dragRef.current;
        if (!drag) return;
        dragRef.current = null;
        setMeasurement(drag.original);
        setCursor('crosshair');
        if (canvasRef.current?.hasPointerCapture?.(drag.pointerId)) {
            canvasRef.current.releasePointerCapture(drag.pointerId);
        }
    };

    useEffect(() => {
        if (enabled) containerRef.current?.focus({ preventScroll: true });
        else cancelDrag();
    }, [enabled]);

    const startDrag = (event, edge) => {
        if (!enabled || event.button !== 0) return;
        // A second finger hands control back to the viewport's pinch handler.
        // Restore the selection from before that first finger touched down.
        if (event.pointerType === 'touch' && !event.isPrimary) {
            cancelDrag();
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        containerRef.current?.focus({ preventScroll: true });
        const rect = canvasRef.current.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const kind = edge || getDragKind(x, y, event.pointerType);
        const frequency = frequencyAt(x);
        const next = kind === 'new'
            ? { startHz: frequency, endHz: frequency, yRatio: y / height }
            : measurement;
        dragRef.current = {
            pointerId: event.pointerId, kind, anchorHz: frequency,
            original: measurement, initial: next, latest: next, startX: x, startY: y,
            initialRulerY: rulerY, moved: false,
        };
        setCursor(kind === 'move' ? 'grabbing' : kind === 'new' ? 'crosshair' : 'ew-resize');
        setMeasurement(next);
        // Capture on the canvas even when a keyboard-accessible edge is hit.
        canvasRef.current.setPointerCapture?.(event.pointerId);
    };

    const moveDrag = (event) => {
        const drag = dragRef.current;
        const rect = canvasRef.current.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        if (!drag) {
            const kind = getDragKind(x, y, event.pointerType);
            setCursor(kind === 'move' ? 'grab' : kind === 'new' ? 'crosshair' : 'ew-resize');
            return;
        }
        if (drag.pointerId !== event.pointerId) return;
        const frequency = frequencyAt(x);
        let next = { ...drag.initial };
        if (drag.kind === 'new') {
            next.startHz = Math.min(drag.anchorHz, frequency);
            next.endHz = Math.max(drag.anchorHz, frequency);
        } else if (drag.kind === 'start') {
            next.startHz = Math.min(frequency, next.endHz);
        } else if (drag.kind === 'end') {
            next.endHz = Math.max(frequency, next.startHz);
        } else {
            const delta = clamp(frequency - drag.anchorHz,
                minFrequency - next.startHz, maxFrequency - next.endHz);
            next.startHz += delta;
            next.endHz += delta;
            // Moving the body preserves bandwidth while repositioning the
            // ruler vertically, including when grabbed by its readout panel.
            next.yRatio = clamp(drag.initialRulerY + y - drag.startY, 82, Math.max(82, height - 20)) / height;
        }
        drag.moved ||= Math.abs(x - drag.startX) >= 3;
        drag.latest = next;
        setMeasurement(next);
    };

    const finishDrag = (event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        moveDrag(event);
        dragRef.current = null;
        setCursor(drag.kind === 'move' ? 'grab' : 'crosshair');
        // A click should not replace a useful measurement with a zero-width one.
        setMeasurement(drag.kind === 'new' && !drag.moved ? drag.original : drag.latest);
        if (canvasRef.current.hasPointerCapture?.(event.pointerId)) {
            canvasRef.current.releasePointerCapture(event.pointerId);
        }
    };

    const handleKeyDown = (event) => {
        if (event.key !== 'Escape' || !enabled) return;
        event.preventDefault();
        event.stopPropagation();
        if (dragRef.current) cancelDrag();
        else onEnabledChange(false);
    };

    const adjustEdge = (event, edge) => {
        const direction = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key];
        if (!direction && event.key !== 'Home' && event.key !== 'End') return;
        event.preventDefault();
        event.stopPropagation();
        const lower = edge === 'start' ? minFrequency : measurement.startHz;
        const upper = edge === 'end' ? maxFrequency : measurement.endHz;
        const value = event.key === 'Home' ? lower : event.key === 'End' ? upper
            : measurement[`${edge}Hz`] + direction * precision * (event.shiftKey ? 10 : 1);
        setMeasurement({ ...measurement, [`${edge}Hz`]: clamp(value, lower, upper) });
    };

    useLayoutEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = prepareOverlayCanvas(canvas, width, height);
        panelBoundsRef.current = null;
        if (!measurement || endX < 0 || startX > width) return;
        const left = Math.max(0, startX);
        const right = Math.min(width, endX);
        ctx.fillStyle = alpha(color, 0.08);
        ctx.fillRect(left, 0, right - left, height);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        for (const x of [startX, endX]) {
            if (x < 0 || x > width) continue;
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(left, rulerY);
        ctx.lineTo(right, rulerY);
        for (const [x, direction] of [[startX, 1], [endX, -1]]) {
            if (x < 0 || x > width) continue;
            ctx.moveTo(x, rulerY - 9);
            ctx.lineTo(x, rulerY + 9);
            ctx.moveTo(x + direction * 6, rulerY - 4);
            ctx.lineTo(x, rulerY);
            ctx.lineTo(x + direction * 6, rulerY + 4);
        }
        ctx.stroke();

        const rangeText = `${format(measurement.startHz)} — ${format(measurement.endHz)}`;
        ctx.font = 'bold 13px monospace';
        const labelWidth = ctx.measureText(readout).width;
        ctx.font = '11px monospace';
        const panelWidth = Math.min(width - 16, Math.max(labelWidth, ctx.measureText(rangeText).width) + 24);
        const panelX = clamp((left + right) / 2 - panelWidth / 2, 8, width - panelWidth - 8);
        const panelY = rulerY - 60;
        panelBoundsRef.current = { x: panelX, y: panelY, width: panelWidth, height: 48 };
        ctx.fillStyle = alpha(theme.palette.background.paper, 0.96);
        ctx.fillRect(panelX, panelY, panelWidth, 48);
        ctx.strokeStyle = alpha(color, 0.7);
        ctx.lineWidth = 1;
        ctx.strokeRect(panelX, panelY, panelWidth, 48);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = color;
        ctx.font = 'bold 13px monospace';
        ctx.fillText(readout, panelX + panelWidth / 2, panelY + 15, panelWidth - 12);
        ctx.fillStyle = theme.palette.text.primary;
        ctx.font = '11px monospace';
        ctx.fillText(rangeText, panelX + panelWidth / 2, panelY + 34, panelWidth - 12);
    }, [enabled, measurement, viewport, height, readout, language, precision, theme]);

    // Keep the normal streaming path free of an unused viewport-sized canvas.
    // The component retains its local state when editing is toggled off.
    if (!enabled && !measurement) return null;

    return (
        <Box ref={containerRef} className="bandwidth-ruler-overlay" role="group"
            aria-label={t('bandwidth_ruler.title')} tabIndex={-1} onKeyDown={handleKeyDown}
            sx={{ position: 'absolute', top: 0, left: 0, width: '100%', height, zIndex: 600, pointerEvents: 'none', outline: 'none' }}>
            <canvas ref={canvasRef} className="bandwidth-ruler-canvas" aria-hidden="true"
                data-overlay-height={height} title={details}
                onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={finishDrag}
                onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}
                onPointerLeave={() => { if (!dragRef.current) setCursor('crosshair'); }}
                style={{ display: 'block', width: '100%', height: '100%',
                    pointerEvents: enabled ? 'auto' : 'none', cursor,
                    touchAction: enabled ? 'none' : 'pan-y' }} />
            {(enabled || measurement) && (
                <Paper elevation={2}
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDownCapture={(event) => event.stopPropagation()}
                    onTouchStartCapture={(event) => event.stopPropagation()}
                    sx={{ position: 'absolute', top: 8, right: 8, display: 'flex', alignItems: 'center',
                        gap: 0.75, pl: 1, pr: 0.25, maxWidth: 'calc(100% - 16px)', pointerEvents: 'auto',
                        bgcolor: alpha(theme.palette.background.paper, 0.96), border: `1px solid ${alpha(color, 0.6)}` }}>
                    <StraightenIcon sx={{ color, fontSize: 18 }} />
                    <Typography component="output" aria-live="polite" title={details}
                        sx={{ fontSize: 12, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {measurement ? readout : t('bandwidth_ruler.title')}
                    </Typography>
                    <IconButton size="small" onClick={() => onEnabledChange(!enabled)}
                        title={enabled ? t('bandwidth_ruler.finish') : t('bandwidth_ruler.edit')}
                        aria-label={enabled ? t('bandwidth_ruler.finish') : t('bandwidth_ruler.edit')}>
                        {enabled ? <CheckIcon fontSize="small" /> : <EditIcon fontSize="small" />}
                    </IconButton>
                    <IconButton size="small" onClick={() => { cancelDrag(); setMeasurement(null); onEnabledChange(false); }}
                        title={t('bandwidth_ruler.clear')} aria-label={t('bandwidth_ruler.clear')}>
                        <CloseIcon fontSize="small" />
                    </IconButton>
                </Paper>
            )}
            {enabled && !measurement && (
                <Box sx={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)',
                    width: 'max-content', maxWidth: 'calc(100% - 32px)', px: 1.5, py: 0.75, borderRadius: 1,
                    bgcolor: alpha(theme.palette.background.paper, 0.96), color: 'text.primary', fontSize: 12 }}>
                    {t('bandwidth_ruler.hint')}
                </Box>
            )}
            {enabled && measurement && [['start', startX], ['end', endX]].map(([edge, x]) => (
                x >= 0 && x <= width && <Box key={edge} role="slider" tabIndex={0}
                    aria-label={edge === 'start' ? t('bandwidth_ruler.start') : t('bandwidth_ruler.end')}
                    aria-valuemin={edge === 'start' ? minFrequency : measurement.startHz}
                    aria-valuemax={edge === 'end' ? maxFrequency : measurement.endHz}
                    aria-valuenow={measurement[`${edge}Hz`]} aria-valuetext={format(measurement[`${edge}Hz`])}
                    onKeyDown={(event) => adjustEdge(event, edge)} onPointerDown={(event) => startDrag(event, edge)}
                    sx={{ position: 'absolute', left: x - 12, top: rulerY - 16, width: 24, height: 32,
                        pointerEvents: 'auto', touchAction: 'none', cursor: 'ew-resize', borderRadius: 1,
                        '&:hover, &:focus-visible': { bgcolor: alpha(color, 0.2), outline: `1px solid ${color}` } }} />
            ))}
        </Box>
    );
}
