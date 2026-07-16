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

import { useCallback, useEffect, useRef } from 'react';
import { calculateBandwidthChange } from './vfo-utils.js';
import { getBandwidthConfig } from './vfo-config.js';

const DRAG_UPDATE_INTERVAL_MS = 33;

/**
 * Custom hook for VFO drag operations
 */
export const useVFODragHandlers = ({
    activeMarker,
    vfoMarkers,
    actualWidth,
    freqRange,
    dragMode,
    startFreq,
    endFreq,
    updateVFOProperty,
    canvasRef
}) => {
    const queuedDeltaXRef = useRef(0);
    const rafIdRef = useRef(null);
    const lastDispatchTsRef = useRef(0);
    const scaleFactorRef = useRef(1);
    const draggedValuesRef = useRef({
        markerKey: null,
        frequency: null,
        bandwidth: null,
    });

    const refs = useRef({
        activeMarker: null,
        vfoMarkers: {},
        actualWidth: 1,
        freqRange: 1,
        dragMode: null,
        startFreq: 0,
        endFreq: 0,
        updateVFOProperty: () => {},
        canvasRef: null,
    });

    refs.current.activeMarker = activeMarker;
    refs.current.vfoMarkers = vfoMarkers;
    refs.current.actualWidth = actualWidth;
    refs.current.freqRange = freqRange;
    refs.current.dragMode = dragMode;
    refs.current.startFreq = startFreq;
    refs.current.endFreq = endFreq;
    refs.current.updateVFOProperty = updateVFOProperty;
    refs.current.canvasRef = canvasRef;

    const cancelQueuedFrame = useCallback(() => {
        if (rafIdRef.current !== null) {
            cancelAnimationFrame(rafIdRef.current);
            rafIdRef.current = null;
        }
    }, []);

    const initializeDragState = useCallback((markerKey) => {
        const state = refs.current;
        const marker = state.vfoMarkers?.[markerKey];
        draggedValuesRef.current = {
            markerKey,
            frequency: marker?.frequency ?? null,
            bandwidth: marker?.bandwidth ?? null,
        };

        const canvas = state.canvasRef?.current;
        const rect = canvas?.getBoundingClientRect?.();
        if (rect && rect.width > 0 && state.actualWidth > 0) {
            scaleFactorRef.current = state.actualWidth / rect.width;
        } else {
            scaleFactorRef.current = 1;
        }

        queuedDeltaXRef.current = 0;
        lastDispatchTsRef.current = 0;
        cancelQueuedFrame();
    }, [cancelQueuedFrame]);

    const applyQueuedDelta = useCallback((deltaX) => {
        if (!deltaX) {
            return;
        }

        const state = refs.current;
        const markerKey = state.activeMarker;
        if (!markerKey) {
            return;
        }

        const marker = state.vfoMarkers?.[markerKey];
        if (!marker || !state.actualWidth || !state.freqRange) {
            return;
        }

        if (draggedValuesRef.current.markerKey !== markerKey) {
            draggedValuesRef.current = {
                markerKey,
                frequency: marker.frequency ?? null,
                bandwidth: marker.bandwidth ?? null,
            };
        }

        const scaledDelta = deltaX * scaleFactorRef.current;
        const freqDelta = (scaledDelta / state.actualWidth) * state.freqRange;

        if (state.dragMode === 'body') {
            const currentFrequency = draggedValuesRef.current.frequency ?? marker.frequency;
            if (currentFrequency === null || currentFrequency === undefined) {
                return;
            }

            const newFrequency = currentFrequency + freqDelta;
            const limitedFrequency = Math.round(
                Math.max(state.startFreq, Math.min(newFrequency, state.endFreq))
            );

            if (limitedFrequency !== currentFrequency) {
                draggedValuesRef.current.frequency = limitedFrequency;
                state.updateVFOProperty(parseInt(markerKey, 10), { frequency: limitedFrequency });
            }
            return;
        }

        // For edge drags, maintain a local bandwidth cache to avoid stale read/write loops.
        const bandwidthConfig = getBandwidthConfig(marker.mode);
        const currentBandwidth = draggedValuesRef.current.bandwidth
            ?? marker.bandwidth
            ?? bandwidthConfig.default;

        const limitedBandwidth = calculateBandwidthChange(
            currentBandwidth,
            freqDelta,
            state.dragMode,
            bandwidthConfig.min,
            bandwidthConfig.max
        );

        if (limitedBandwidth !== currentBandwidth) {
            draggedValuesRef.current.bandwidth = limitedBandwidth;
            state.updateVFOProperty(parseInt(markerKey, 10), { bandwidth: limitedBandwidth });
        }
    }, []);

    const runQueuedFrame = useCallback((timestamp) => {
        rafIdRef.current = null;

        if (!queuedDeltaXRef.current) {
            return;
        }

        if (lastDispatchTsRef.current !== 0 && (timestamp - lastDispatchTsRef.current) < DRAG_UPDATE_INTERVAL_MS) {
            rafIdRef.current = requestAnimationFrame(runQueuedFrame);
            return;
        }

        const deltaX = queuedDeltaXRef.current;
        queuedDeltaXRef.current = 0;
        lastDispatchTsRef.current = timestamp;
        applyQueuedDelta(deltaX);

        if (queuedDeltaXRef.current) {
            rafIdRef.current = requestAnimationFrame(runQueuedFrame);
        }
    }, [applyQueuedDelta]);

    const handleDragMovement = useCallback((deltaX) => {
        if (!deltaX) {
            return;
        }

        queuedDeltaXRef.current += deltaX;
        if (rafIdRef.current === null) {
            rafIdRef.current = requestAnimationFrame(runQueuedFrame);
        }
    }, [runQueuedFrame]);

    const flushDragMovement = useCallback(() => {
        cancelQueuedFrame();
        if (queuedDeltaXRef.current) {
            applyQueuedDelta(queuedDeltaXRef.current);
            queuedDeltaXRef.current = 0;
        }
        lastDispatchTsRef.current = 0;
    }, [applyQueuedDelta, cancelQueuedFrame]);

    const resetDragMovementState = useCallback(() => {
        cancelQueuedFrame();
        queuedDeltaXRef.current = 0;
        lastDispatchTsRef.current = 0;
        draggedValuesRef.current = {
            markerKey: null,
            frequency: null,
            bandwidth: null,
        };
    }, [cancelQueuedFrame]);

    useEffect(() => () => {
        cancelQueuedFrame();
    }, [cancelQueuedFrame]);

    return {
        handleDragMovement,
        initializeDragState,
        flushDragMovement,
        resetDragMovementState,
    };
};

/**
 * Custom hook for VFO mouse event handlers
 */
export const useVFOMouseHandlers = ({
    canvasRef,
    getHoverElement,
    isDragging,
    setActiveMarker,
    setDragMode,
    setIsDragging,
    setCursor,
    lastClientXRef,
    dispatch,
    setSelectedVFO,
    initializeDragState
}) => {
    const handleMouseMove = useCallback((e) => {
        if (isDragging) return;

        const rect = canvasRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const { element } = getHoverElement(x, y);

        if (element === 'body') {
            setCursor('ew-resize');
        } else if (element === 'leftEdge' || element === 'rightEdge') {
            setCursor('col-resize');
        } else {
            setCursor('default');
        }
    }, [getHoverElement, isDragging, canvasRef, setCursor]);

    const handleMouseLeave = useCallback(() => {
        if (!isDragging) {
            setCursor('default');
        }
    }, [isDragging, setCursor]);

    const handleMouseDown = useCallback((e) => {
        if (e.button !== 0) return;

        const rect = canvasRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const { key, element } = getHoverElement(x, y);

        if (key && (element === 'body' || element === 'leftEdge' || element === 'rightEdge')) {
            setActiveMarker(key);
            setDragMode(element);
            setIsDragging(true);
            initializeDragState(key);
            setCursor(element === 'body' ? 'ew-resize' : 'col-resize');
            lastClientXRef.current = e.clientX;

            e.preventDefault();
            e.stopPropagation();
        }

        dispatch(setSelectedVFO(parseInt(key) || null));
    }, [canvasRef, getHoverElement, setActiveMarker, setDragMode, setIsDragging, initializeDragState, setCursor, lastClientXRef, dispatch, setSelectedVFO]);

    const handleClick = useCallback((e) => {
        // Click handling is done in mousedown
    }, []);

    const handleDoubleClick = useCallback((e) => {
        // Disabled for now
        return false;
    }, []);

    return {
        handleMouseMove,
        handleMouseLeave,
        handleMouseDown,
        handleClick,
        handleDoubleClick
    };
};

/**
 * Custom hook for VFO touch event handlers
 */
export const useVFOTouchHandlers = ({
    canvasRef,
    getHoverElement,
    isDragging,
    setActiveMarker,
    setDragMode,
    setIsDragging,
    isDraggingRef,
    lastTouchXRef,
    touchStartTimeoutRef,
    dispatch,
    setSelectedVFO,
    initializeDragState
}) => {
    const handleTouchStart = useCallback((e) => {
        if (e.touches.length !== 1) return;

        const touch = e.touches[0];
        const rect = canvasRef.current.getBoundingClientRect();
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;

        const { key, element } = getHoverElement(x, y);

        if (key && element) {
            setActiveMarker(key);
            setDragMode(element);
            setIsDragging(true);
            initializeDragState(key);
            isDraggingRef.current = true;
            lastTouchXRef.current = touch.clientX;

            e.preventDefault();
            e.stopPropagation();
        }

        dispatch(setSelectedVFO(parseInt(key) || null));

        return { key, element };
    }, [canvasRef, getHoverElement, setActiveMarker, setDragMode, setIsDragging, initializeDragState, isDraggingRef, lastTouchXRef, dispatch, setSelectedVFO]);

    const handleTouchMove = useCallback((e, touchStartTimeoutRef, handleDragMovement) => {
        if (touchStartTimeoutRef.current) {
            clearTimeout(touchStartTimeoutRef.current);
            touchStartTimeoutRef.current = null;
        }

        if (!isDragging || e.touches.length !== 1) return;

        e.preventDefault();
        e.stopPropagation();

        const touch = e.touches[0];
        const deltaX = touch.clientX - lastTouchXRef.current;
        lastTouchXRef.current = touch.clientX;

        handleDragMovement(deltaX);
    }, [isDragging, lastTouchXRef]);

    const handleTouchEnd = useCallback((e, touchStartTimeoutRef, endDragOperation) => {
        if (touchStartTimeoutRef.current) {
            clearTimeout(touchStartTimeoutRef.current);
            touchStartTimeoutRef.current = null;
        }

        if (isDragging) {
            e.preventDefault();
            e.stopPropagation();
            endDragOperation();
        }
    }, [isDragging]);

    const handleTouchCancel = useCallback((e, touchStartTimeoutRef, endDragOperation) => {
        if (isDragging) {
            e.preventDefault();
            e.stopPropagation();
            endDragOperation();
        }
    }, [isDragging]);

    const handleTap = useCallback((e) => {
        if (isDragging) return;

        if (!e || !e.touches || e.touches.length !== 1) return;

        const touch = e.touches[0];
        if (!touch || touch.clientX === undefined || touch.clientY === undefined) return;

        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;

        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;

        const { key } = getHoverElement(x, y);

        if (key) {
            dispatch(setSelectedVFO(parseInt(key) || null));

            if (e.preventDefault) e.preventDefault();
            if (e.stopPropagation) e.stopPropagation();
        }
    }, [isDragging, canvasRef, getHoverElement, dispatch, setSelectedVFO]);

    return {
        handleTouchStart,
        handleTouchMove,
        handleTouchEnd,
        handleTouchCancel,
        handleTap
    };
};

/**
 * Custom hook for VFO mousewheel frequency adjustment
 */
export const useVFOWheelHandler = ({
    canvasRef,
    selectedVFO,
    vfoMarkers,
    vfoActive,
    startFreq,
    endFreq,
    updateVFOProperty
}) => {
    const handleWheel = useCallback((e) => {
        if (e.shiftKey) {
            return;
        }

        if (selectedVFO === null || !vfoMarkers[selectedVFO] || !vfoActive[selectedVFO]) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        const marker = vfoMarkers[selectedVFO];
        const freqChange = -Math.sign(e.deltaY) * marker.stepSize;

        // Check if VFO is locked to a transmitter
        const isLocked = marker.lockedTransmitterId && marker.lockedTransmitterId !== 'none';

        if (isLocked) {
            // When locked, adjust the frequency offset instead of absolute frequency
            const currentOffset = marker.frequencyOffset || 0;
            const newOffset = Math.round(currentOffset + freqChange);

            updateVFOProperty(selectedVFO, {
                frequencyOffset: newOffset,
            });
        } else {
            // When unlocked, adjust absolute frequency as before
            const newFrequency = marker.frequency + freqChange;
            const limitedFreq = Math.round(Math.max(startFreq, Math.min(newFrequency, endFreq)));

            updateVFOProperty(selectedVFO, {
                frequency: limitedFreq,
            });
        }

    }, [selectedVFO, vfoMarkers, vfoActive, startFreq, endFreq, updateVFOProperty]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        canvas.addEventListener('wheel', handleWheel, { passive: false });

        return () => {
            canvas.removeEventListener('wheel', handleWheel);
        };
    }, [handleWheel, canvasRef]);

    return { handleWheel };
};

/**
 * Custom hook for managing drag state across mouse and touch events
 */
export const useVFODragState = ({
    isDragging,
    activeMarker,
    handleDragMovement,
    endDragOperation,
    flushDragMovement,
    lastClientXRef,
    lastTouchXRef
}) => {
    // Mouse drag effect
    useEffect(() => {
        if (isDragging && activeMarker) {
            const handleMouseMoveEvent = (e) => {
                if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) {
                    return;
                }

                // Keep marker drag isolated from container-level pan handlers.
                e.preventDefault();
                e.stopPropagation();

                const deltaX = e.clientX - lastClientXRef.current;
                lastClientXRef.current = e.clientX;

                handleDragMovement(deltaX);
            };

            const handleMouseUp = () => {
                flushDragMovement();
                endDragOperation();
            };

            document.addEventListener('mousemove', handleMouseMoveEvent);
            document.addEventListener('mouseup', handleMouseUp);

            return () => {
                document.removeEventListener('mousemove', handleMouseMoveEvent);
                document.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isDragging, activeMarker, handleDragMovement, endDragOperation, flushDragMovement, lastClientXRef]);

    // Touch drag effect
    useEffect(() => {
        if (!isDragging) return;

        const handleDocumentTouchMove = (e) => {
            e.preventDefault();
            e.stopPropagation();

            if (e.touches.length !== 1) return;

            const touch = e.touches[0];
            const deltaX = touch.clientX - lastTouchXRef.current;
            lastTouchXRef.current = touch.clientX;

            handleDragMovement(deltaX);
        };

        const handleDocumentTouchEnd = (e) => {
            e.preventDefault();
            e.stopPropagation();
            flushDragMovement();
            endDragOperation();
        };

        document.addEventListener('touchmove', handleDocumentTouchMove, { capture: true, passive: false });
        document.addEventListener('touchend', handleDocumentTouchEnd, { capture: true, passive: false });
        document.addEventListener('touchcancel', handleDocumentTouchEnd, { capture: true, passive: false });

        return () => {
            document.removeEventListener('touchmove', handleDocumentTouchMove, { capture: true });
            document.removeEventListener('touchend', handleDocumentTouchEnd, { capture: true });
            document.removeEventListener('touchcancel', handleDocumentTouchEnd, { capture: true });
        };
    }, [isDragging, handleDragMovement, endDragOperation, flushDragMovement, lastTouchXRef]);
};
