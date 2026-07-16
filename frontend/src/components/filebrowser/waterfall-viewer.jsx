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

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, CircularProgress, IconButton, Tooltip, Typography } from '@mui/material';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import DownloadIcon from '@mui/icons-material/Download';
import FrequencyScale from '../waterfall/frequency-scale.jsx';

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const WHEEL_ZOOM_STEP = 0.35;
const SCALE_STRIP_HEIGHT = 20;
const TAP_MOVE_TOLERANCE_PX = 6;
const TRANSFORM_INTERACTION_IDLE_MS = 120;

export default function WaterfallViewer({
    src,
    alt,
    centerFrequency,
    sampleRate,
    startTime,
    endTime,
    formatDate,
    formatFrequency,
    minZoom = 1,
    maxZoom = 15,
    containerSx,
    hintDurationMs = 2800,
}) {
    const containerRef = useRef(null);
    const canvasRef = useRef(null);
    const sourceImageRef = useRef(null);
    const yScaledSourceCanvasRef = useRef(null);
    const activePointerIdRef = useRef(null);
    const isDraggingRef = useRef(false);
    const lastPointerXRef = useRef(0);
    const pointerStartRef = useRef(null);
    const interactionMovedRef = useRef(false);
    const pinchActiveRef = useRef(false);
    const touchPointersRef = useRef(new Map());
    const pinchStartRef = useRef({ distance: 0, pointRatio: 0, scale: 1 });
    const scaleRef = useRef(1);
    const positionXRef = useRef(0);
    const animationFrameRef = useRef(null);
    const pendingTransformTickRef = useRef(false);
    const transformInteractionActiveRef = useRef(false);
    const transformInteractionIdleTimerRef = useRef(null);

    const [scaleX, setScaleX] = useState(1);
    const [positionX, setPositionX] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const [isTransformInteracting, setIsTransformInteracting] = useState(false);
    const [showHint, setShowHint] = useState(true);
    const [cursorInfo, setCursorInfo] = useState(null);
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
    const [sourceImageSize, setSourceImageSize] = useState({ width: 0, height: 0 });
    const [loadedSrc, setLoadedSrc] = useState(null);
    const [failedSrc, setFailedSrc] = useState(null);
    const [transformTick, setTransformTick] = useState(0);
    const [yScaledSourceTick, setYScaledSourceTick] = useState(0);

    const formatFrequencyValue = useCallback(
        (frequencyHz) => {
            if (!Number.isFinite(frequencyHz)) return '';
            if (typeof formatFrequency === 'function') {
                return formatFrequency(frequencyHz);
            }
            if (frequencyHz >= 1e9) {
                return `${(frequencyHz / 1e9).toFixed(6)} GHz`;
            }
            if (frequencyHz >= 1e6) {
                return `${(frequencyHz / 1e6).toFixed(6)} MHz`;
            }
            if (frequencyHz >= 1e3) {
                return `${(frequencyHz / 1e3).toFixed(3)} kHz`;
            }
            return `${frequencyHz.toFixed(0)} Hz`;
        },
        [formatFrequency]
    );

    const formatDateValue = useCallback(
        (isoDate) => {
            if (!isoDate) return '';
            if (typeof formatDate === 'function') {
                return formatDate(isoDate);
            }
            return new Date(isoDate).toLocaleString();
        },
        [formatDate]
    );

    const clearTransformInteractionTimer = useCallback(() => {
        if (transformInteractionIdleTimerRef.current !== null) {
            clearTimeout(transformInteractionIdleTimerRef.current);
            transformInteractionIdleTimerRef.current = null;
        }
    }, []);

    const cancelTransformAnimationFrame = useCallback(() => {
        if (animationFrameRef.current !== null) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
        pendingTransformTickRef.current = false;
    }, []);

    const commitTransformState = useCallback((options = {}) => {
        const { bumpTick = false } = options;
        const nextScale = scaleRef.current;
        const nextPositionX = positionXRef.current;
        setScaleX((previous) => (previous === nextScale ? previous : nextScale));
        setPositionX((previous) => (previous === nextPositionX ? previous : nextPositionX));
        if (bumpTick) {
            setTransformTick((tick) => tick + 1);
        }
    }, []);

    const scheduleTransformStateCommit = useCallback((options = {}) => {
        const { bumpTick = false } = options;
        if (bumpTick) {
            pendingTransformTickRef.current = true;
        }
        if (animationFrameRef.current !== null) {
            return;
        }
        animationFrameRef.current = requestAnimationFrame(() => {
            animationFrameRef.current = null;
            const shouldBumpTick = pendingTransformTickRef.current;
            pendingTransformTickRef.current = false;
            commitTransformState({ bumpTick: shouldBumpTick });
        });
    }, [commitTransformState]);

    const endTransformInteraction = useCallback(() => {
        clearTransformInteractionTimer();
        if (transformInteractionActiveRef.current) {
            transformInteractionActiveRef.current = false;
            setIsTransformInteracting(false);
            // Finalize labels/scale once interaction settles.
            scheduleTransformStateCommit({ bumpTick: true });
        }
    }, [clearTransformInteractionTimer, scheduleTransformStateCommit]);

    const markTransformInteraction = useCallback(() => {
        if (!transformInteractionActiveRef.current) {
            transformInteractionActiveRef.current = true;
            setIsTransformInteracting(true);
        }

        clearTransformInteractionTimer();
        transformInteractionIdleTimerRef.current = setTimeout(() => {
            transformInteractionIdleTimerRef.current = null;
            transformInteractionActiveRef.current = false;
            setIsTransformInteracting(false);
            // Finalize labels/scale once interaction settles.
            scheduleTransformStateCommit({ bumpTick: true });
        }, TRANSFORM_INTERACTION_IDLE_MS);
    }, [clearTransformInteractionTimer, scheduleTransformStateCommit]);

    const applyTransform = useCallback((nextScale, nextPositionX, options = {}) => {
        scaleRef.current = nextScale;
        positionXRef.current = nextPositionX;
        if (options.trackInteraction) {
            // Defer frequency-scale measurement while zoom/pan interaction is still active.
            markTransformInteraction();
            if (options.flushNow) {
                commitTransformState();
            } else {
                // Keep wheel interaction updates cheap: coalesce React state updates to one per frame.
                scheduleTransformStateCommit();
            }
            return;
        }
        // Non-interactive updates can commit immediately.
        commitTransformState({ bumpTick: true });
    }, [commitTransformState, markTransformInteraction, scheduleTransformStateCommit]);

    const getVisibleXNormRange = useCallback((currentPositionX, currentScale, width) => {
        if (!Number.isFinite(width) || width <= 0) {
            return { start: 0, end: 1 };
        }
        const transformedWidth = width * currentScale;
        if (!Number.isFinite(transformedWidth) || transformedWidth <= 0) {
            return { start: 0, end: 1 };
        }
        const start = clamp((0 - currentPositionX) / transformedWidth, 0, 1);
        const end = clamp((width - currentPositionX) / transformedWidth, 0, 1);
        if (end <= start) {
            return { start, end: Math.min(1, start + Number.EPSILON) };
        }
        return { start, end };
    }, []);

    const effectiveMaxZoom = useMemo(() => {
        return Math.max(minZoom, maxZoom);
    }, [maxZoom, minZoom]);

    const clampPositionForScale = useCallback(
        (candidate, nextScale) => {
            if (!Number.isFinite(containerSize.width) || containerSize.width <= 0 || nextScale <= 1) {
                return 0;
            }
            const maxPanLeft = containerSize.width - containerSize.width * nextScale;
            return clamp(candidate, maxPanLeft, 0);
        },
        [containerSize.width]
    );

    const buildCursorInfo = useCallback(
        (clientX, clientY) => {
            const container = containerRef.current;
            if (!container || !containerSize.width || !containerSize.height) {
                return null;
            }

            const rect = container.getBoundingClientRect();
            const localX = clientX - rect.left;
            const localY = clientY - rect.top;

            const imageViewportHeight = Math.max(1, containerSize.height - SCALE_STRIP_HEIGHT);
            if (localY < SCALE_STRIP_HEIGHT || localY > containerSize.height) {
                return null;
            }

            // Keep cursor math in source-space so crosshair stays stable across zoom/pan.
            const transformedWidth = containerSize.width * scaleRef.current;
            const normalizedX = (localX - positionXRef.current) / transformedWidth;
            const normalizedY = (localY - SCALE_STRIP_HEIGHT) / imageViewportHeight;

            if (normalizedX < 0 || normalizedX > 1 || normalizedY < 0 || normalizedY > 1) {
                return null;
            }

            let frequency = null;
            if (Number.isFinite(centerFrequency) && Number.isFinite(sampleRate)) {
                const startFreq = centerFrequency - sampleRate / 2;
                frequency = startFreq + normalizedX * sampleRate;
            }

            let timeLabel = '';
            if (startTime && endTime) {
                const startMs = new Date(startTime).getTime();
                const endMs = new Date(endTime).getTime();
                if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs >= startMs) {
                    const timeMs = startMs + normalizedY * (endMs - startMs);
                    timeLabel = formatDateValue(new Date(timeMs).toISOString());
                }
            }

            return {
                x: localX,
                y: localY,
                normalizedX,
                normalizedY,
                frequency,
                timeLabel,
            };
        },
        [centerFrequency, containerSize.height, containerSize.width, endTime, formatDateValue, sampleRate, startTime]
    );

    const zoomOnXAxisOnly = useCallback(
        (deltaScale, centerX, options = {}) => {
            if (!Number.isFinite(containerSize.width) || containerSize.width <= 0) {
                return;
            }

            const previousScale = scaleRef.current;
            const nextScale = clamp(previousScale + deltaScale, minZoom, effectiveMaxZoom);

            if (nextScale === previousScale) {
                return;
            }

            const safeCenterX = clamp(centerX, 0, containerSize.width);
            const pointRatio =
                (safeCenterX - positionXRef.current) / (containerSize.width * previousScale);

            let nextPositionX = safeCenterX - pointRatio * containerSize.width * nextScale;
            if (nextScale === 1) {
                nextPositionX = 0;
            } else {
                nextPositionX = clampPositionForScale(nextPositionX, nextScale);
            }

            applyTransform(nextScale, nextPositionX, {
                trackInteraction: true,
                flushNow: Boolean(options.flushNow),
            });
        },
        [applyTransform, clampPositionForScale, containerSize.width, effectiveMaxZoom, minZoom]
    );

    const panOnXAxisOnly = useCallback(
        (deltaX) => {
            if (scaleRef.current <= 1) {
                return;
            }
            const nextPositionX = clampPositionForScale(positionXRef.current + deltaX, scaleRef.current);
            applyTransform(scaleRef.current, nextPositionX, { trackInteraction: true });
        },
        [applyTransform, clampPositionForScale]
    );

    const markPointerMoved = useCallback((event) => {
        const start = pointerStartRef.current;
        if (!start || start.pointerId !== event.pointerId) {
            return;
        }

        const movedDistance = Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY);
        if (movedDistance > TAP_MOVE_TOLERANCE_PX) {
            interactionMovedRef.current = true;
        }
    }, []);

    const beginPinchZoom = useCallback(() => {
        if (!containerSize.width || touchPointersRef.current.size < 2) {
            return;
        }
        const points = Array.from(touchPointersRef.current.values());
        const [firstPoint, secondPoint] = points;
        const distance = Math.hypot(
            secondPoint.clientX - firstPoint.clientX,
            secondPoint.clientY - firstPoint.clientY
        );
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect || distance <= 0) {
            return;
        }

        const centerX = ((firstPoint.clientX + secondPoint.clientX) / 2) - rect.left;
        pinchStartRef.current = {
            distance,
            pointRatio: (centerX - positionXRef.current) / (containerSize.width * scaleRef.current),
            scale: scaleRef.current,
        };
        activePointerIdRef.current = null;
        isDraggingRef.current = false;
        interactionMovedRef.current = true;
        pinchActiveRef.current = true;
        setIsDragging(false);
    }, [containerSize.width]);

    const pinchZoomOnXAxisOnly = useCallback(() => {
        if (!containerSize.width || touchPointersRef.current.size < 2) {
            return;
        }
        const start = pinchStartRef.current;
        if (!start.distance) {
            beginPinchZoom();
            return;
        }

        const points = Array.from(touchPointersRef.current.values());
        const [firstPoint, secondPoint] = points;
        const distance = Math.hypot(
            secondPoint.clientX - firstPoint.clientX,
            secondPoint.clientY - firstPoint.clientY
        );
        if (distance <= 0) {
            return;
        }

        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) {
            return;
        }

        const centerX = ((firstPoint.clientX + secondPoint.clientX) / 2) - rect.left;
        const nextScale = clamp(start.scale * (distance / start.distance), minZoom, effectiveMaxZoom);
        let nextPositionX = centerX - start.pointRatio * containerSize.width * nextScale;
        if (nextScale === 1) {
            nextPositionX = 0;
        } else {
            nextPositionX = clampPositionForScale(nextPositionX, nextScale);
        }

        applyTransform(nextScale, nextPositionX, { trackInteraction: true, flushNow: true });
    }, [
        applyTransform,
        beginPinchZoom,
        clampPositionForScale,
        containerSize.width,
        effectiveMaxZoom,
        minZoom,
    ]);

    const resetTransform = useCallback(() => {
        applyTransform(1, 0);
    }, [applyTransform]);

    const handleDownloadSnapshot = useCallback(() => {
        if (!src) return;
        window.open(src, '_blank');
    }, [src]);

    const handleWheel = useCallback(
        (event) => {
            if (!src) return;
            event.preventDefault();
            event.stopPropagation();
            const rect = containerRef.current?.getBoundingClientRect();
            if (!rect) return;
            const localX = event.clientX - rect.left;

            // Normalize wheel units across browsers/devices:
            // deltaMode 0=pixel, 1=line, 2=page.
            let normalizedDeltaY = event.deltaY;
            if (event.deltaMode === 1) {
                normalizedDeltaY *= 16;
            } else if (event.deltaMode === 2) {
                normalizedDeltaY *= 120;
            }

            // Use a fixed step so zoom is clearly visible on all devices.
            // Scroll-down zooms out; scroll-up zooms in.
            const direction = normalizedDeltaY >= 0 ? -1 : 1;
            const deltaScale = direction * WHEEL_ZOOM_STEP;

            zoomOnXAxisOnly(deltaScale, localX);
            setShowHint(false);
        },
        [src, zoomOnXAxisOnly]
    );

    const handlePointerDown = useCallback(
        (event) => {
            if (!src) return;
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            if (event.cancelable) {
                event.preventDefault();
            }
            event.currentTarget.setPointerCapture(event.pointerId);
            setShowHint(false);
            pointerStartRef.current = {
                pointerId: event.pointerId,
                pointerType: event.pointerType,
                clientX: event.clientX,
                clientY: event.clientY,
            };
            interactionMovedRef.current = false;
            if (event.pointerType !== 'touch') {
                pinchActiveRef.current = false;
            }

            if (event.pointerType === 'touch') {
                touchPointersRef.current.set(event.pointerId, {
                    clientX: event.clientX,
                    clientY: event.clientY,
                });

                if (touchPointersRef.current.size >= 2) {
                    beginPinchZoom();
                    return;
                }
            }

            activePointerIdRef.current = event.pointerId;
            lastPointerXRef.current = event.clientX;
            if (scaleRef.current > 1) {
                isDraggingRef.current = true;
                setIsDragging(true);
            }
        },
        [beginPinchZoom, src]
    );

    const handlePointerMove = useCallback(
        (event) => {
            if (!src) return;
            markPointerMoved(event);

            if (event.pointerType === 'touch') {
                if (!touchPointersRef.current.has(event.pointerId)) {
                    return;
                }
                if (event.cancelable) {
                    event.preventDefault();
                }
                touchPointersRef.current.set(event.pointerId, {
                    clientX: event.clientX,
                    clientY: event.clientY,
                });

                if (touchPointersRef.current.size >= 2) {
                    pinchZoomOnXAxisOnly();
                    return;
                }
            }

            if (activePointerIdRef.current === event.pointerId && isDraggingRef.current) {
                // Browser image/selection drags can steal the gesture if a frame stalls mid-pan.
                if (event.cancelable) {
                    event.preventDefault();
                }
                const deltaX = event.clientX - lastPointerXRef.current;
                lastPointerXRef.current = event.clientX;
                panOnXAxisOnly(deltaX);
            }
        },
        [markPointerMoved, panOnXAxisOnly, pinchZoomOnXAxisOnly, src]
    );

    const handlePointerUp = useCallback((event) => {
        const shouldPlaceCrosshair =
            activePointerIdRef.current === event.pointerId &&
            !interactionMovedRef.current &&
            !pinchActiveRef.current;

        if (shouldPlaceCrosshair) {
            const nextCursorInfo = buildCursorInfo(event.clientX, event.clientY);
            if (nextCursorInfo) {
                setCursorInfo(nextCursorInfo);
            }
        }

        if (event.pointerType === 'touch' && touchPointersRef.current.has(event.pointerId)) {
            touchPointersRef.current.delete(event.pointerId);
            pinchStartRef.current = { distance: 0, pointRatio: 0, scale: 1 };

            if (touchPointersRef.current.size === 1) {
                const [remainingPoint] = Array.from(touchPointersRef.current.entries());
                const [remainingPointerId, point] = remainingPoint;
                activePointerIdRef.current = remainingPointerId;
                lastPointerXRef.current = point.clientX;
                pointerStartRef.current = {
                    pointerId: remainingPointerId,
                    pointerType: 'touch',
                    clientX: point.clientX,
                    clientY: point.clientY,
                };
                interactionMovedRef.current = true;
                if (scaleRef.current > 1) {
                    isDraggingRef.current = true;
                    setIsDragging(true);
                }
            } else {
                pinchActiveRef.current = false;
            }
        }

        if (activePointerIdRef.current === event.pointerId) {
            activePointerIdRef.current = null;
            isDraggingRef.current = false;
            pointerStartRef.current = null;
            setIsDragging(false);
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    }, [buildCursorInfo]);

    const handlePointerCancel = useCallback((event) => {
        if (event.pointerType === 'touch') {
            touchPointersRef.current.delete(event.pointerId);
            if (touchPointersRef.current.size === 0) {
                pinchActiveRef.current = false;
            }
        }
        if (activePointerIdRef.current === event.pointerId) {
            activePointerIdRef.current = null;
            isDraggingRef.current = false;
            pointerStartRef.current = null;
            setIsDragging(false);
        }
        pinchStartRef.current = { distance: 0, pointRatio: 0, scale: 1 };
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    }, []);

    const handleDragStart = useCallback((event) => {
        event.preventDefault();
        event.stopPropagation();
    }, []);

    const visibleFrequencyRange = useMemo(() => {
        if (!Number.isFinite(centerFrequency) || !Number.isFinite(sampleRate)) return null;
        if (!containerSize.width) return null;

        const { start: visibleStartNorm, end: visibleEndNorm } = getVisibleXNormRange(
            positionX,
            scaleX,
            containerSize.width
        );

        const fullStartFrequency = centerFrequency - sampleRate / 2;
        return {
            start: fullStartFrequency + visibleStartNorm * sampleRate,
            end: fullStartFrequency + visibleEndNorm * sampleRate,
        };
    }, [centerFrequency, containerSize.width, getVisibleXNormRange, positionX, sampleRate, scaleX]);

    const visibleScaleCenterFrequency = useMemo(() => {
        if (!visibleFrequencyRange) {
            return centerFrequency;
        }
        return (visibleFrequencyRange.start + visibleFrequencyRange.end) / 2;
    }, [centerFrequency, visibleFrequencyRange]);

    const visibleScaleSampleRate = useMemo(() => {
        if (!visibleFrequencyRange) {
            return sampleRate;
        }
        return Math.max(1, visibleFrequencyRange.end - visibleFrequencyRange.start);
    }, [sampleRate, visibleFrequencyRange]);

    const centerFrequencyMarkerX = useMemo(() => {
        if (
            !Number.isFinite(centerFrequency) ||
            !Number.isFinite(sampleRate) ||
            !Number.isFinite(containerSize.width) ||
            containerSize.width <= 0
        ) {
            return null;
        }

        const fullStartFrequency = centerFrequency - sampleRate / 2;
        const normalizedCenterX = (centerFrequency - fullStartFrequency) / sampleRate;
        const x = positionX + normalizedCenterX * containerSize.width * scaleX;

        if (!Number.isFinite(x) || x < 0 || x > containerSize.width) {
            return null;
        }
        return x;
    }, [centerFrequency, containerSize.width, positionX, sampleRate, scaleX]);

    const displayedCursorInfo = useMemo(() => {
        if (!cursorInfo || !containerSize.width || !containerSize.height) {
            return null;
        }

        const imageViewportHeight = Math.max(1, containerSize.height - SCALE_STRIP_HEIGHT);
        const x = positionX + cursorInfo.normalizedX * containerSize.width * scaleX;
        const y = SCALE_STRIP_HEIGHT + cursorInfo.normalizedY * imageViewportHeight;

        if (x < 0 || x > containerSize.width || y < SCALE_STRIP_HEIGHT || y > containerSize.height) {
            return null;
        }

        return {
            ...cursorInfo,
            x,
            y,
        };
    }, [containerSize.height, containerSize.width, cursorInfo, positionX, scaleX]);

    useEffect(() => {
        if (!containerRef.current) return undefined;

        const updateContainerSize = () => {
            const rect = containerRef.current.getBoundingClientRect();
            setContainerSize({
                width: rect.width,
                height: rect.height,
            });
        };

        updateContainerSize();
        const observer = new ResizeObserver(updateContainerSize);
        observer.observe(containerRef.current);

        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!src) {
            setSourceImageSize({ width: 0, height: 0 });
            yScaledSourceCanvasRef.current = null;
            setYScaledSourceTick((tick) => tick + 1);
            return;
        }
        setSourceImageSize({ width: 0, height: 0 });
        yScaledSourceCanvasRef.current = null;
        setYScaledSourceTick((tick) => tick + 1);
    }, [src]);

    useEffect(() => {
        const sourceImage = sourceImageRef.current;
        const imageWidth = sourceImageSize.width;
        const imageHeight = sourceImageSize.height;
        const viewportHeight = Math.max(1, containerSize.height - SCALE_STRIP_HEIGHT);

        if (!sourceImage || !imageWidth || !imageHeight || viewportHeight <= 0) {
            yScaledSourceCanvasRef.current = null;
            setYScaledSourceTick((tick) => tick + 1);
            return;
        }

        let yScaledCanvas = yScaledSourceCanvasRef.current;
        if (!yScaledCanvas) {
            yScaledCanvas = document.createElement('canvas');
            yScaledSourceCanvasRef.current = yScaledCanvas;
        }

        if (yScaledCanvas.width !== imageWidth) {
            yScaledCanvas.width = imageWidth;
        }
        if (yScaledCanvas.height !== viewportHeight) {
            yScaledCanvas.height = viewportHeight;
        }

        const yScaledCtx = yScaledCanvas.getContext('2d');
        if (!yScaledCtx) {
            yScaledSourceCanvasRef.current = null;
            setYScaledSourceTick((tick) => tick + 1);
            return;
        }

        // Pre-scale Y once per image/viewport-height to avoid repeating this cost on every zoom step.
        // Keep nearest-neighbor sampling so X bins remain crisp.
        yScaledCtx.setTransform(1, 0, 0, 1, 0, 0);
        yScaledCtx.clearRect(0, 0, imageWidth, viewportHeight);
        yScaledCtx.imageSmoothingEnabled = false;
        yScaledCtx.drawImage(sourceImage, 0, 0, imageWidth, imageHeight, 0, 0, imageWidth, viewportHeight);
        setYScaledSourceTick((tick) => tick + 1);
    }, [containerSize.height, sourceImageSize.height, sourceImageSize.width]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        const sourceImage = sourceImageRef.current;
        const imageWidth = sourceImageSize.width;
        const imageHeight = sourceImageSize.height;
        const viewportWidth = containerSize.width;
        const viewportHeight = Math.max(1, containerSize.height - SCALE_STRIP_HEIGHT);

        if (!sourceImage || !imageWidth || !imageHeight || !viewportWidth || viewportHeight <= 0) {
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }

        const dpr = window.devicePixelRatio || 1;
        const targetWidth = Math.max(1, Math.round(viewportWidth * dpr));
        const targetHeight = Math.max(1, Math.round(viewportHeight * dpr));
        if (canvas.width !== targetWidth) {
            canvas.width = targetWidth;
        }
        if (canvas.height !== targetHeight) {
            canvas.height = targetHeight;
        }

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, viewportWidth, viewportHeight);

        // Draw the source slice directly from the full-resolution image.
        const { start, end } = getVisibleXNormRange(positionX, scaleX, viewportWidth);
        const sourceStartPx = clamp(Math.floor(start * imageWidth), 0, Math.max(0, imageWidth - 1));
        const sourceEndPx = clamp(Math.ceil(end * imageWidth), sourceStartPx + 1, imageWidth);
        const sourceWidth = Math.max(1, sourceEndPx - sourceStartPx);
        const yScaledSourceCanvas = yScaledSourceCanvasRef.current;
        const sourceSurface = yScaledSourceCanvas || sourceImage;
        const sourceSurfaceHeight = yScaledSourceCanvas ? viewportHeight : imageHeight;

        // Keep X-bin data crisp while zooming/panning: do not interpolate canvas samples.
        ctx.imageSmoothingEnabled = false;

        ctx.drawImage(
            sourceSurface,
            sourceStartPx,
            0,
            sourceWidth,
            sourceSurfaceHeight,
            0,
            0,
            viewportWidth,
            viewportHeight
        );
    }, [
        containerSize.height,
        containerSize.width,
        getVisibleXNormRange,
        positionX,
        scaleX,
        yScaledSourceTick,
        sourceImageSize.height,
        sourceImageSize.width,
    ]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return undefined;

        // Use a non-passive listener so preventDefault reliably blocks dialog/page scrolling.
        const onWheel = (event) => {
            handleWheel(event);
        };

        container.addEventListener('wheel', onWheel, { passive: false });
        return () => {
            container.removeEventListener('wheel', onWheel);
        };
    }, [handleWheel]);

    useEffect(() => () => {
        clearTransformInteractionTimer();
        cancelTransformAnimationFrame();
    }, [cancelTransformAnimationFrame, clearTransformInteractionTimer]);

    useEffect(() => {
        const clamped = clampPositionForScale(positionXRef.current, scaleRef.current);
        if (clamped !== positionXRef.current) {
            applyTransform(scaleRef.current, clamped);
        }
    }, [applyTransform, clampPositionForScale, containerSize.width]);

    useEffect(() => {
        if (scaleRef.current <= effectiveMaxZoom) {
            return;
        }
        const clampedPosition = clampPositionForScale(positionXRef.current, effectiveMaxZoom);
        applyTransform(effectiveMaxZoom, clampedPosition);
    }, [applyTransform, clampPositionForScale, effectiveMaxZoom]);

    useEffect(() => {
        applyTransform(1, 0);
        isDraggingRef.current = false;
        pointerStartRef.current = null;
        interactionMovedRef.current = false;
        pinchActiveRef.current = false;
        touchPointersRef.current.clear();
        pinchStartRef.current = { distance: 0, pointRatio: 0, scale: 1 };
        endTransformInteraction();
        setIsDragging(false);
        setCursorInfo(null);
        setShowHint(true);
    }, [applyTransform, endTransformInteraction, src]);

    useEffect(() => {
        if (!showHint) return undefined;
        const timer = setTimeout(() => setShowHint(false), hintDurationMs);
        return () => clearTimeout(timer);
    }, [hintDurationMs, showHint]);

    const containerCursor = scaleX > 1 ? (isDragging ? 'grabbing' : 'grab') : 'crosshair';
    // Show loading while the current src is still fetching/decoding.
    const showLoadingOverlay = Boolean(src) && loadedSrc !== src && failedSrc !== src;

    return (
        <Box
            data-testid="waterfall-viewer"
            ref={containerRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onDragStart={handleDragStart}
            draggable={false}
            sx={{
                position: 'relative',
                overflow: 'hidden',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1.5,
                bgcolor: '#05070b',
                touchAction: 'none',
                cursor: containerCursor,
                userSelect: 'none',
                WebkitUserSelect: 'none',
                WebkitUserDrag: 'none',
                ...containerSx,
            }}
        >
            <img
                ref={sourceImageRef}
                src={src}
                alt={alt}
                draggable={false}
                onLoad={(event) => {
                    const image = event.currentTarget;
                    setSourceImageSize({
                        width: image.naturalWidth || image.width || 0,
                        height: image.naturalHeight || image.height || 0,
                    });
                    setLoadedSrc(src);
                    setFailedSrc(null);
                }}
                onError={() => {
                    setSourceImageSize({ width: 0, height: 0 });
                    setFailedSrc(src);
                }}
                onDragStart={handleDragStart}
                style={{
                    position: 'absolute',
                    width: 0,
                    height: 0,
                    opacity: 0,
                    pointerEvents: 'none',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    WebkitUserDrag: 'none',
                }}
            />
            <Box sx={{ height: `${SCALE_STRIP_HEIGHT}px`, width: '100%' }}>
                <FrequencyScale
                    centerFrequency={visibleScaleCenterFrequency}
                    sampleRate={visibleScaleSampleRate}
                    containerWidth={containerSize.width || 1}
                    transformTick={transformTick}
                    interactionActive={isTransformInteracting}
                    allowInteractionMeasure={false}
                    canvasHeight={SCALE_STRIP_HEIGHT}
                />
            </Box>
            <Box
                sx={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: `${SCALE_STRIP_HEIGHT}px`,
                    bottom: 0,
                }}
            >
                <canvas
                    ref={canvasRef}
                    style={{
                        width: '100%',
                        height: '100%',
                        display: 'block',
                        imageRendering: 'auto',
                        pointerEvents: 'none',
                    }}
                />
            </Box>

            {centerFrequencyMarkerX !== null && (
                <Box
                    data-testid="waterfall-center-frequency-line"
                    style={{ left: centerFrequencyMarkerX }}
                    sx={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        width: '1px',
                        bgcolor: 'rgba(255, 56, 56, 0.38)',
                        pointerEvents: 'none',
                    }}
                />
            )}

            {displayedCursorInfo && (
                <>
                    <Box
                        data-testid="waterfall-crosshair-vertical"
                        style={{ left: displayedCursorInfo.x }}
                        sx={{
                            position: 'absolute',
                            top: 0,
                            bottom: 0,
                            width: '1px',
                            bgcolor: 'rgba(255, 255, 255, 0.5)',
                            pointerEvents: 'none',
                        }}
                    />
                    <Box
                        data-testid="waterfall-crosshair-horizontal"
                        style={{ top: displayedCursorInfo.y }}
                        sx={{
                            position: 'absolute',
                            left: 0,
                            right: 0,
                            height: '1px',
                            bgcolor: 'rgba(255, 255, 255, 0.5)',
                            pointerEvents: 'none',
                        }}
                    />
                    {displayedCursorInfo.frequency !== null && (
                        <Box
                            data-testid="waterfall-crosshair-frequency"
                            style={{ left: displayedCursorInfo.x }}
                            sx={{
                                position: 'absolute',
                                top: 8,
                                transform: 'translateX(-50%)',
                                px: 1,
                                py: 0.4,
                                borderRadius: 1,
                                bgcolor: 'rgba(0, 0, 0, 0.7)',
                                color: 'common.white',
                                fontSize: '0.7rem',
                                letterSpacing: '0.02em',
                                pointerEvents: 'none',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {formatFrequencyValue(displayedCursorInfo.frequency)}
                        </Box>
                    )}
                    {displayedCursorInfo.timeLabel && (
                        <Box
                            data-testid="waterfall-crosshair-time"
                            style={{ top: displayedCursorInfo.y }}
                            sx={{
                                position: 'absolute',
                                left: 8,
                                transform: 'translateY(-50%)',
                                px: 1,
                                py: 0.4,
                                borderRadius: 1,
                                bgcolor: 'rgba(0, 0, 0, 0.7)',
                                color: 'common.white',
                                fontSize: '0.7rem',
                                letterSpacing: '0.02em',
                                pointerEvents: 'none',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {displayedCursorInfo.timeLabel}
                        </Box>
                    )}
                </>
            )}

            <Box
                onPointerDown={(event) => event.stopPropagation()}
                onPointerMove={(event) => event.stopPropagation()}
                onPointerUp={(event) => event.stopPropagation()}
                onPointerCancel={(event) => event.stopPropagation()}
                onWheel={(event) => event.stopPropagation()}
                sx={{
                    position: 'absolute',
                    bottom: 8,
                    right: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    zIndex: 2,
                }}
            >
                <Tooltip title="Zoom Out X">
                    <IconButton
                        size="small"
                        onClick={() => zoomOnXAxisOnly(-0.5, containerSize.width / 2, { flushNow: true })}
                        sx={{
                            bgcolor: 'rgba(0, 0, 0, 0.55)',
                            color: 'common.white',
                            '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.72)' },
                        }}
                    >
                        <ZoomOutIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
                <Tooltip title="Zoom In X">
                    <IconButton
                        size="small"
                        onClick={() => zoomOnXAxisOnly(0.5, containerSize.width / 2, { flushNow: true })}
                        sx={{
                            bgcolor: 'rgba(0, 0, 0, 0.55)',
                            color: 'common.white',
                            '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.72)' },
                        }}
                    >
                        <ZoomInIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
                <Tooltip title="Reset View">
                    <IconButton
                        size="small"
                        onClick={resetTransform}
                        sx={{
                            bgcolor: 'rgba(0, 0, 0, 0.55)',
                            color: 'common.white',
                            '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.72)' },
                        }}
                    >
                        <RestartAltIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
                <Tooltip title="Download Snapshot">
                    <IconButton
                        size="small"
                        onClick={handleDownloadSnapshot}
                        sx={{
                            bgcolor: 'rgba(0, 0, 0, 0.55)',
                            color: 'common.white',
                            '&:hover': { bgcolor: 'rgba(0, 0, 0, 0.72)' },
                        }}
                    >
                        <DownloadIcon fontSize="small" />
                    </IconButton>
                </Tooltip>
            </Box>

            <Box
                sx={{
                    position: 'absolute',
                    bottom: 8,
                    left: 8,
                    px: 1,
                    py: 0.5,
                    borderRadius: 1,
                    bgcolor: 'rgba(0, 0, 0, 0.55)',
                    color: 'common.white',
                    fontSize: '0.72rem',
                    letterSpacing: '0.02em',
                    pointerEvents: 'none',
                }}
            >
                <Typography component="span" sx={{ fontSize: 'inherit' }}>
                    {`Zoom ${scaleX.toFixed(1)}x`}
                </Typography>
                {visibleFrequencyRange && (
                    <Typography component="span" sx={{ fontSize: 'inherit', ml: 1 }}>
                        {`${formatFrequencyValue(visibleFrequencyRange.start)} - ${formatFrequencyValue(visibleFrequencyRange.end)}`}
                    </Typography>
                )}
            </Box>

            {showHint && (
                <Box
                    sx={{
                        position: 'absolute',
                        top: 8,
                        right: 8,
                        px: 1,
                        py: 0.5,
                        borderRadius: 1,
                        bgcolor: 'rgba(0, 0, 0, 0.6)',
                        color: 'common.white',
                        fontSize: '0.7rem',
                        letterSpacing: '0.02em',
                        pointerEvents: 'none',
                    }}
                >
                    Scroll or pinch to zoom X axis, drag to pan
                </Box>
            )}

            {showLoadingOverlay && (
                <Box
                    sx={{
                        position: 'absolute',
                        inset: 0,
                        zIndex: 3,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        bgcolor: 'rgba(0, 0, 0, 0.28)',
                        pointerEvents: 'none',
                    }}
                >
                    <CircularProgress size={28} />
                </Box>
            )}
        </Box>
    );
}
