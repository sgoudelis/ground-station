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


import React, {useCallback, useEffect, useRef, useState, useImperativeHandle, forwardRef} from "react";
import { shallowEqual, useDispatch, useSelector } from "react-redux";
import {Box, IconButton, useTheme} from "@mui/material";
import FrequencyScale from "./frequency-scale.jsx";
import BookmarkCanvas from "./bookmarks-overlay.jsx";
import {
    setWaterFallScaleX,
    setWaterFallPositionX,
    setRecordingBandCenterOffsetHz,
} from "./waterfall-slice.jsx";
import VFOMarkersContainer from './vfo-marker/vfo-container.jsx';
import FrequencyBandOverlay from './bandplan-overlay.jsx';
import RecordingBandOverlay from './recording-band-overlay.jsx';
import {useDopplerNeighbors} from '../../hooks/useDopplerNeighbors.jsx';
import { useTranslation } from 'react-i18next';

const PLAYBACK_COUNTDOWN_UPDATE_MS = 250;
const INTERACTION_IDLE_MS = 120;
const FAST_ZOOM_INTERACTION_IDLE_MS = 80;
const TOUCH_INTERACTION_MEASURE_MS = 200;

const WaterfallAndBandscope = forwardRef(function WaterfallAndBandscope({
                                              bandscopeCanvasRef,
                                              waterFallCanvasRef,
                                              waterFallTileCanvasARef,
                                              waterFallTileCanvasBRef,
                                              waterfallRendererMode = 'worker',
                                              centerFrequency,
                                              sampleRate,
                                              waterFallWindowHeight,
                                              onVisibleWaterfallHeightChange,
                                              frequencyBands = [],
                                              minZoom = 1,
                                              maxZoom = 20,
                                              playbackRemainingSecondsRef,
                                          }, ref) {

    const { t } = useTranslation('waterfall');
    const theme = useTheme();
    const containerRef = useRef(null);
    const viewportRef = useRef(null);
    const lastVisibleWaterfallHeightRef = useRef(null);
    const containerWidthRef = useRef(0);
    const [isMobile, setIsMobile] = useState(false);
    const scaleRef = useRef(1);
    const positionXRef = useRef(0);
    const isDraggingRef = useRef(false);
    const lastXRef = useRef(0);
    const lastPinchDistanceRef = useRef(0);
    const pinchCenterXRef = useRef(0);
    const persistTimerRef = useRef(null);
    const bookmarkMeasureRafRef = useRef(null);
    const interactionIdleTimerRef = useRef(null);
    const interactionActiveRef = useRef(false);
    const touchMeasureIntervalRef = useRef(null);
    const dispatch = useDispatch();

    // Activate doppler neighbor calculation hook
    useDopplerNeighbors();
    const {
        waterFallCanvasWidth,
        waterFallCanvasHeight,
        bandScopeHeight,
        bandscopeTopPadding,
        waterFallScaleX,
        waterFallPositionX,
        isRecording,
        isStreaming,
        selectedSDRId,
        recordingDecimationFactor,
        recordingBandSelectionEnabled,
        recordingBandCenterOffsetHz,
        recordingBandDragStepHz,
    } = useSelector((state) => ({
        waterFallCanvasWidth: state.waterfall.waterFallCanvasWidth,
        waterFallCanvasHeight: state.waterfall.waterFallCanvasHeight,
        bandScopeHeight: state.waterfall.bandScopeHeight,
        bandscopeTopPadding: state.waterfall.bandscopeTopPadding ?? 0,
        waterFallScaleX: state.waterfall.waterFallScaleX,
        waterFallPositionX: state.waterfall.waterFallPositionX,
        isRecording: state.waterfall.isRecording,
        isStreaming: state.waterfall.isStreaming,
        selectedSDRId: state.waterfall.selectedSDRId,
        recordingDecimationFactor: state.waterfall.recordingDecimationFactor,
        recordingBandSelectionEnabled: state.waterfall.recordingBandSelectionEnabled,
        recordingBandCenterOffsetHz: state.waterfall.recordingBandCenterOffsetHz,
        recordingBandDragStepHz: state.waterfall.recordingBandDragStepHz,
    }), shallowEqual);

    // Track playback countdown for display
    const [playbackCountdown, setPlaybackCountdown] = useState(0);
    const [bookmarkTransformTick, setBookmarkTransformTick] = useState(0);
    const [isTransformInteracting, setIsTransformInteracting] = useState(false);
    const [touchInteractionMeasureTick, setTouchInteractionMeasureTick] = useState(0);
    const [isTouchMeasuring, setIsTouchMeasuring] = useState(false);

    // Update playback countdown from ref
    useEffect(() => {
        if (!isStreaming || !playbackRemainingSecondsRef) {
            setPlaybackCountdown(0);
            return;
        }

        const updateCountdown = () => {
            const remaining = playbackRemainingSecondsRef.current;
            const nextSeconds = (remaining !== null && remaining >= 0) ? Math.ceil(remaining) : 0;
            setPlaybackCountdown(prev => (prev === nextSeconds ? prev : nextSeconds));
        };

        updateCountdown();

        // The displayed value changes at most four times per second. A frame
        // loop would still wake on every refresh while the waterfall streams.
        const intervalId = setInterval(() => {
            if (!document.hidden) {
                updateCountdown();
            }
        }, PLAYBACK_COUNTDOWN_UPDATE_MS);

        return () => clearInterval(intervalId);
    }, [isStreaming, playbackRemainingSecondsRef]);

    // Batch layout notifications so a resize drag triggers at most one overlay
    // measurement per painted frame, even if ResizeObserver fires repeatedly.
    const notifyOverlayLayoutChange = useCallback(() => {
        if (bookmarkMeasureRafRef.current !== null) {
            return;
        }

        bookmarkMeasureRafRef.current = requestAnimationFrame(() => {
            bookmarkMeasureRafRef.current = null;
            setBookmarkTransformTick((value) => value + 1);
        });
    }, []);

    // Apply a transform directly to a DOM element.
    const applyTransform = useCallback(() => {
        if (containerRef.current) {
            containerRef.current.style.transform = `translateX(${positionXRef.current}px) scaleX(${scaleRef.current})`;
            notifyOverlayLayoutChange();
        }
    }, [notifyOverlayLayoutChange]);

    // Function to recalculate position when the container resizes
    const handleResize = useCallback(() => {
        if (!containerRef.current) return;

        const newWidth = containerRef.current.clientWidth;
        const oldWidth = containerWidthRef.current;

        if (newWidth <= 0 || oldWidth === 0 || newWidth === oldWidth) return;

        // CSS resizes the base canvases automatically, but each overlay keeps
        // its own backing store. Notify them even at 1x zoom so they redraw at
        // the new physical width instead of being stretched by the browser.
        if (scaleRef.current <= 1) {
            containerWidthRef.current = newWidth;
            notifyOverlayLayoutChange();
            return;
        }

        // Calculate a new position based on scale and size change ratio
        // This keeps the visible content centered as the container resizes
        const centerPointRatio = 0.5; // Center of the view
        const oldCenterPoint = oldWidth * centerPointRatio;
        const newCenterPoint = newWidth * centerPointRatio;

        // Scale the center point positions
        const oldScaledCenter = (oldCenterPoint - positionXRef.current) / scaleRef.current;

        // Calculate the position to maintain the same content at the center
        const newPositionX = newCenterPoint - (oldScaledCenter * scaleRef.current);

        // Apply constraints to keep within bounds
        const maxPanLeft = newWidth - (newWidth * scaleRef.current);
        positionXRef.current = Math.max(maxPanLeft, Math.min(0, newPositionX));

        // Update width reference
        containerWidthRef.current = newWidth;

        // Apply transform (this now also updates React state)
        applyTransform();
    }, [applyTransform, notifyOverlayLayoutChange]);

    // Handle clicks on bookmarks
    const handleBookmarkClick = useCallback((bookmark) => {
        // Example: You could show a dialog to edit or delete the bookmark
        console.log('Clicked on bookmark:', bookmark);

        // For now, just log it, but you could add more advanced features here
    }, []);

    // Set up ResizeObserver to detect container size changes
    useEffect(() => {
        if (!containerRef.current) return;

        // Store initial width
        containerWidthRef.current = containerRef.current.clientWidth;

        // Create ResizeObserver
        const resizeObserver = new ResizeObserver(() => {
            handleResize();
        });

        // Start observing the container
        resizeObserver.observe(containerRef.current);

        return () => {
            resizeObserver.disconnect();
        };

    }, [handleResize]);

    const markTransformInteraction = useCallback((idleMs = INTERACTION_IDLE_MS) => {
        if (!interactionActiveRef.current) {
            interactionActiveRef.current = true;
            setIsTransformInteracting(true);
        }

        if (interactionIdleTimerRef.current) {
            clearTimeout(interactionIdleTimerRef.current);
        }

        interactionIdleTimerRef.current = setTimeout(() => {
            interactionIdleTimerRef.current = null;
            interactionActiveRef.current = false;
            setIsTransformInteracting(false);
        }, idleMs);
    }, []);

    const startTouchMeasureLoop = useCallback(() => {
        if (!isTouchMeasuring) {
            setIsTouchMeasuring(true);
        }
        setTouchInteractionMeasureTick((value) => value + 1);
        if (touchMeasureIntervalRef.current !== null) {
            return;
        }
        touchMeasureIntervalRef.current = setInterval(() => {
            setTouchInteractionMeasureTick((value) => value + 1);
        }, TOUCH_INTERACTION_MEASURE_MS);
    }, [isTouchMeasuring]);

    const stopTouchMeasureLoop = useCallback(() => {
        if (touchMeasureIntervalRef.current !== null) {
            clearInterval(touchMeasureIntervalRef.current);
            touchMeasureIntervalRef.current = null;
        }
        if (isTouchMeasuring) {
            setIsTouchMeasuring(false);
        }
    }, [isTouchMeasuring]);

    // Debounced persist function
    const persistToRedux = useCallback(() => {
        if (persistTimerRef.current) {
            clearTimeout(persistTimerRef.current);
        }
        persistTimerRef.current = setTimeout(() => {
            dispatch(setWaterFallScaleX(scaleRef.current));
            dispatch(setWaterFallPositionX(positionXRef.current));
        }, 300); // 300ms debounce
    }, [dispatch]);

    const checkMobile = () => {
        setIsMobile(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || window.innerWidth < 768);
    };

    useEffect(() => {
        // Detect mobile devices
        checkMobile();
        window.addEventListener('resize', checkMobile);

        // Restore scale and position from Redux on mount
        scaleRef.current = waterFallScaleX;
        positionXRef.current = waterFallPositionX;
        applyTransform();

        return () => {
            window.removeEventListener('resize', checkMobile);
            // Clear any pending persist operations
            if (persistTimerRef.current) {
                clearTimeout(persistTimerRef.current);
            }
            if (bookmarkMeasureRafRef.current !== null) {
                cancelAnimationFrame(bookmarkMeasureRafRef.current);
                bookmarkMeasureRafRef.current = null;
            }
            if (interactionIdleTimerRef.current) {
                clearTimeout(interactionIdleTimerRef.current);
                interactionIdleTimerRef.current = null;
            }
            if (touchMeasureIntervalRef.current !== null) {
                clearInterval(touchMeasureIntervalRef.current);
                touchMeasureIntervalRef.current = null;
            }
        }
    }, []);

    // Zoom functionality
    const zoomOnXAxisOnly = useCallback((deltaScale, centerX, interactionIdleMs = INTERACTION_IDLE_MS) => {
        const prevScale = scaleRef.current;
        const safePrevPositionX = Number.isFinite(positionXRef.current) ? positionXRef.current : 0;
        const newScale = Math.max(minZoom, Math.min(maxZoom, prevScale + deltaScale));

        // Exit if the scale didn't change
        if (newScale === prevScale) return;

        const containerWidth = containerRef.current?.clientWidth || 0;
        if (containerWidth <= 0) {
            scaleRef.current = newScale;
            positionXRef.current = 0;
            applyTransform();
            persistToRedux();
            return;
        }

        containerWidthRef.current = containerWidth;
        const safeCenterX = Number.isFinite(centerX) ? centerX : (containerWidth / 2);

        // Calculate how far from the left edge the center point is (as a ratio of scaled width)
        const mousePointRatio = (safeCenterX - safePrevPositionX) / (containerWidth * prevScale);

        // Calculate a new position
        let newPositionX = 0;
        if (newScale === 1) {
            // Reset position at scale 1
            newPositionX = 0;
        } else {
            // Keep the point under mouse at the same relative position
            newPositionX = safeCenterX - mousePointRatio * containerWidth * newScale;

            // Constrain to boundaries
            const maxPanLeft = containerWidth - (containerWidth * newScale);
            newPositionX = Math.max(maxPanLeft, Math.min(0, newPositionX));
        }

        if (!Number.isFinite(newPositionX)) {
            newPositionX = 0;
        }

        // Update refs
        scaleRef.current = newScale;
        positionXRef.current = newPositionX;
        markTransformInteraction(interactionIdleMs);

        // Apply the transform immediately
        applyTransform();

        // Persist to Redux (debounced)
        persistToRedux();

    }, [applyTransform, persistToRedux, markTransformInteraction]);

    // Panning functionality
    const panOnXAxisOnly = useCallback((deltaX) => {
        // Only allow panning if zoomed in
        if (scaleRef.current <= 1) {
            return;
        }

        const containerWidth = containerRef.current?.clientWidth || 0;

        // Calculate boundaries
        const scaledWidth = containerWidth * scaleRef.current;
        const maxPanLeft = containerWidth - scaledWidth;

        // Update position with constraints
        positionXRef.current = Math.max(
            maxPanLeft,
            Math.min(0, positionXRef.current + deltaX)
        );
        markTransformInteraction();

        // Apply transform directly
        applyTransform();
    }, [applyTransform, markTransformInteraction]);

    // Reset to the default state
    const resetCustomTransform = useCallback(() => {
        scaleRef.current = 1;
        positionXRef.current = 0;

        applyTransform();
        persistToRedux();
    }, [applyTransform, persistToRedux]);

    const setZoomScale = useCallback((targetScale, centerX) => {
        const numericTarget = Number(targetScale);
        if (!Number.isFinite(numericTarget)) {
            return;
        }

        const clampedTarget = Math.max(minZoom, Math.min(maxZoom, numericTarget));
        const containerWidth = containerRef.current?.clientWidth || containerWidthRef.current || 0;
        const zoomCenterX = typeof centerX === 'number' ? centerX : (containerWidth / 2);
        const delta = clampedTarget - scaleRef.current;

        if (Math.abs(delta) < 0.001) {
            return;
        }

        zoomOnXAxisOnly(delta, zoomCenterX);
    }, [maxZoom, minZoom, zoomOnXAxisOnly]);

    // Set up all event handlers
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        // Wheel event for zooming
        const handleWheel = (e) => {
            //e.preventDefault();
            // Only zoom when shift key is pressed
            if (!e.shiftKey) {
                return;
            }
            const deltaScale = -e.deltaY * 0.01;
            zoomOnXAxisOnly(deltaScale, e.offsetX, FAST_ZOOM_INTERACTION_IDLE_MS);
        };

        // Mouse events for panning
        const handleMouseDown = (e) => {
            isDraggingRef.current = true;
            lastXRef.current = e.clientX;
            // Prevent text selection during drag
            e.preventDefault();
            // Set cursor to indicate dragging
            container.style.cursor = 'grabbing';
        };

        const handleMouseMove = (e) => {
            if (!isDraggingRef.current) return;

            const deltaX = e.clientX - lastXRef.current;
            lastXRef.current = e.clientX;

            // Call pan function with the delta
            panOnXAxisOnly(deltaX);
        };

        const handleMouseUp = () => {
            isDraggingRef.current = false;
            // Reset cursor
            if (container) {
                container.style.cursor = 'grab';
            }
            // Persist after dragging ends
            persistToRedux();
        };

        // Touch events
        const handleTouchStart = (e) => {
            if (e.touches.length > 0) {
                startTouchMeasureLoop();
            }
            if (e.touches.length === 1) {
                isDraggingRef.current = true;
                lastXRef.current = e.touches[0].clientX;
                //e.preventDefault();
            } else if (e.touches.length === 2) {
                // Pinch-to-zoom
                const touch1 = e.touches[0];
                const touch2 = e.touches[1];
                lastPinchDistanceRef.current = Math.hypot(
                    touch2.clientX - touch1.clientX,
                    touch2.clientY - touch1.clientY
                );
                pinchCenterXRef.current = (touch1.clientX + touch2.clientX) / 2;
                e.preventDefault();
            }
        };

        const handleTouchMove = (e) => {
            // Single touch = pan
            if (e.touches.length === 1 && isDraggingRef.current) {
                const deltaX = e.touches[0].clientX - lastXRef.current;
                lastXRef.current = e.touches[0].clientX;
                panOnXAxisOnly(deltaX);
                //e.preventDefault();
            }

            // Two touches = pinch zoom
            else if (e.touches.length === 2) {
                const touch1 = e.touches[0];
                const touch2 = e.touches[1];
                const currentDistance = Math.hypot(
                    touch2.clientX - touch1.clientX,
                    touch2.clientY - touch1.clientY
                );

                const deltaScale = (currentDistance - lastPinchDistanceRef.current) * 0.01;
                lastPinchDistanceRef.current = currentDistance;

                pinchCenterXRef.current = (touch1.clientX + touch2.clientX) / 2;

                zoomOnXAxisOnly(deltaScale, pinchCenterXRef.current, FAST_ZOOM_INTERACTION_IDLE_MS);
                e.preventDefault();
            }
        };

        const handleTouchEnd = (e) => {
            isDraggingRef.current = false;
            if (!e.touches || e.touches.length === 0) {
                stopTouchMeasureLoop();
            }
            // Persist after touch interaction ends
            persistToRedux();
        };

        const handleTouchCancel = () => {
            isDraggingRef.current = false;
            stopTouchMeasureLoop();
            persistToRedux();
        };

        // Set initial cursor
        container.style.cursor = 'grab';

        // Add all event listeners
        container.addEventListener('wheel', handleWheel, {passive: false});
        container.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        // For touch events, passive: false is critical for preventDefault to work
        container.addEventListener('touchstart', handleTouchStart, {passive: false});
        container.addEventListener('touchmove', handleTouchMove, {passive: false});
        window.addEventListener('touchend', handleTouchEnd);
        window.addEventListener('touchcancel', handleTouchCancel);

        // Cleanup
        return () => {
            container.removeEventListener('wheel', handleWheel);
            container.removeEventListener('mousedown', handleMouseDown);
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);

            container.removeEventListener('touchstart', handleTouchStart);
            container.removeEventListener('touchmove', handleTouchMove);
            window.removeEventListener('touchend', handleTouchEnd);
            window.removeEventListener('touchcancel', handleTouchCancel);
        };
    }, [persistToRedux, startTouchMeasureLoop, stopTouchMeasureLoop]);

    // Expose functions to parent component
    useImperativeHandle(ref, () => ({
        zoomOnXAxisOnly,
        panOnXAxisOnly,
        resetCustomTransform,
        setZoomScale,
        getCurrentScale: () => scaleRef.current,
        getCurrentPosition: () => positionXRef.current,
        getContainerWidth: () => containerWidthRef.current,
    }), [zoomOnXAxisOnly, panOnXAxisOnly, resetCustomTransform, setZoomScale]);

    // Set touch actions for mobile scrolling
    useEffect(() => {
        const canvases = [
            bandscopeCanvasRef.current,
            waterFallCanvasRef.current,
            waterFallTileCanvasARef?.current,
            waterFallTileCanvasBRef?.current,
        ];

        canvases.forEach(canvas => {
            if (canvas) {
                canvas.style.touchAction = 'pan-y';
            }
        });
    }, [bandscopeCanvasRef, waterFallCanvasRef, waterFallTileCanvasARef, waterFallTileCanvasBRef]);

    useEffect(() => {
        if (waterfallRendererMode !== 'worker' || !onVisibleWaterfallHeightChange) return;

        const viewport = viewportRef.current;
        const canvas = waterFallCanvasRef.current;
        if (!viewport || !canvas) return;

        const measureVisibleHeight = () => {
            const viewportRect = viewport.getBoundingClientRect();
            const canvasRect = canvas.getBoundingClientRect();
            if (!canvasRect.height) return;

            // The island clips below the bandscope and frequency scale. Convert
            // its bottom edge into canvas rows, with one extra row to cover
            // rounding at the boundary. Horizontal zoom does not affect Y.
            const visibleCssHeight = Math.max(0, viewportRect.bottom - canvasRect.top);
            const visibleRows = Math.min(
                canvas.height,
                Math.ceil(visibleCssHeight * canvas.height / canvasRect.height) + 1
            );
            if (visibleRows !== lastVisibleWaterfallHeightRef.current) {
                lastVisibleWaterfallHeightRef.current = visibleRows;
                onVisibleWaterfallHeightChange(visibleRows);
            }
        };

        const observer = new ResizeObserver(measureVisibleHeight);
        observer.observe(viewport);
        if (containerRef.current) observer.observe(containerRef.current);
        measureVisibleHeight();
        return () => observer.disconnect();
    }, [
        waterfallRendererMode,
        waterFallWindowHeight,
        waterFallCanvasHeight,
        bandScopeHeight,
        bandscopeTopPadding,
        onVisibleWaterfallHeightChange,
        waterFallCanvasRef,
    ]);

    return (
        <Box ref={viewportRef} sx={{
            height: 'calc(100% - 90px)',
            width: '100%',
            overflow: 'hidden',
            touchAction: 'pan-y',
            position: 'relative',
        }}>
            {/* Recording indicator overlay - outside transformed container */}
            {isRecording && (
                <Box
                    sx={{
                        position: 'absolute',
                        top: 8,
                        left: 8,
                        backgroundColor: 'rgba(255, 0, 0, 0.85)',
                        color: 'white',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                        zIndex: 1000,
                        pointerEvents: 'none',
                        animation: 'pulse 2s ease-in-out infinite',
                        '@keyframes pulse': {
                            '0%, 100%': { opacity: 1 },
                            '50%': { opacity: 0.7 },
                        },
                    }}
                >
                    <Box
                        sx={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            backgroundColor: 'white',
                        }}
                    />
                    {t('waterfall_bandscope.rec', { defaultValue: 'REC' })}
                </Box>
            )}
            {/* Playback indicator overlay - outside transformed container */}
            {isStreaming && selectedSDRId === 'sigmf-playback' && (
                <Box
                    sx={{
                        position: 'absolute',
                        top: 8,
                        left: 8,
                        backgroundColor: 'rgba(33, 150, 243, 0.85)',
                        color: 'white',
                        padding: '4px 8px',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                        fontSize: '0.75rem',
                        fontWeight: 'bold',
                        zIndex: 1000,
                        pointerEvents: 'none',
                        animation: 'pulse 2s ease-in-out infinite',
                        '@keyframes pulse': {
                            '0%, 100%': { opacity: 1 },
                            '50%': { opacity: 0.7 },
                        },
                    }}
                >
                    <Box
                        sx={{
                            width: 0,
                            height: 0,
                            borderLeft: '6px solid white',
                            borderTop: '4px solid transparent',
                            borderBottom: '4px solid transparent',
                        }}
                    />
                    PLAYBACK {playbackCountdown > 0 && `${Math.floor(playbackCountdown / 60)}:${String(Math.floor(playbackCountdown % 60)).padStart(2, '0')}`}
                </Box>
            )}

            {/* Canvases */}
            <Box
                ref={containerRef}
                sx={{
                    width: '100%',
                    height: 'auto',
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                    transformOrigin: 'left center',
                    touchAction: 'pan-y',
                }}
            >
                {/* Bandscope container with relative positioning */}
                <Box sx={{position: 'relative', height: `${bandScopeHeight + bandscopeTopPadding}px`}}>
                    <canvas
                        className={"bandscope-canvas"}
                        ref={bandscopeCanvasRef}
                        width={waterFallCanvasWidth}
                        height={bandScopeHeight}
                        style={{
                            imageRendering: 'auto',
                            width: '100%',
                            height: `${bandScopeHeight}px`,
                            borderBottom: `1px solid ${theme.palette.border.main}`,
                            display: 'block',
                            touchAction: 'pan-y',
                            transform: 'translateZ(0)',
                            backfaceVisibility: 'hidden',
                            perspective: '1000px',
                            marginTop: `${bandscopeTopPadding}px`,
                        }}
                    />
                    <RecordingBandOverlay
                        inputSampleRate={sampleRate}
                        decimationFactor={recordingDecimationFactor}
                        selectionEnabled={recordingBandSelectionEnabled}
                        centerOffsetHz={recordingBandCenterOffsetHz}
                        dragStepHz={recordingBandDragStepHz}
                        onCenterOffsetChange={(offset) => dispatch(setRecordingBandCenterOffsetHz(offset))}
                        isRecording={isRecording}
                        containerWidth={waterFallCanvasWidth}
                        transformTick={bookmarkTransformTick}
                        interactionActive={isTransformInteracting}
                        allowInteractionMeasure={isTouchMeasuring}
                        interactionMeasureTick={touchInteractionMeasureTick}
                        height={bandScopeHeight + bandscopeTopPadding}
                        topPadding={bandscopeTopPadding}
                    />
                    {/* Add the new FrequencyBandOverlay component */}
                    <FrequencyBandOverlay
                        centerFrequency={centerFrequency}
                        sampleRate={sampleRate}
                        containerWidth={waterFallCanvasWidth}
                        transformTick={bookmarkTransformTick}
                        interactionActive={isTransformInteracting}
                        allowInteractionMeasure={isTouchMeasuring}
                        interactionMeasureTick={touchInteractionMeasureTick}
                        height={bandScopeHeight + bandscopeTopPadding}
                        topPadding={bandscopeTopPadding}
                        bands={frequencyBands}
                        bandHeight={20}
                        zoomScale={scaleRef.current}
                        panOffset={positionXRef.current}
                    />
                    <BookmarkCanvas
                        centerFrequency={centerFrequency}
                        sampleRate={sampleRate}
                        containerWidth={waterFallCanvasWidth}
                        transformTick={bookmarkTransformTick}
                        interactionActive={isTransformInteracting}
                        allowInteractionMeasure={isTouchMeasuring}
                        interactionMeasureTick={touchInteractionMeasureTick}
                        height={bandScopeHeight + bandscopeTopPadding}
                        bandOverlayHeight={20}
                        topPadding={bandscopeTopPadding}
                        onBookmarkClick={handleBookmarkClick}
                    />
                    <VFOMarkersContainer
                        centerFrequency={centerFrequency}
                        sampleRate={sampleRate}
                        waterfallHeight={waterFallCanvasHeight}
                        bandscopeHeight={bandScopeHeight}
                        bandscopeTopPadding={bandscopeTopPadding}
                        containerWidth={containerWidthRef.current}
                        transformTick={bookmarkTransformTick}
                        interactionActive={isTransformInteracting}
                        allowInteractionMeasure={isTouchMeasuring}
                        interactionMeasureTick={touchInteractionMeasureTick}
                        zoomScale={scaleRef.current}
                        currentPositionX={positionXRef.current}
                    />
                </Box>

                <FrequencyScale
                    centerFrequency={centerFrequency}
                    containerWidth={waterFallCanvasWidth}
                    sampleRate={sampleRate}
                    transformTick={bookmarkTransformTick}
                    interactionActive={isTransformInteracting}
                    allowInteractionMeasure={isTouchMeasuring}
                    interactionMeasureTick={touchInteractionMeasureTick}
                />

                {waterfallRendererMode === 'dom-tiles' ? (
                    <Box
                        sx={{
                            position: 'relative',
                            width: '100%',
                            height: `${waterFallCanvasHeight}px`,
                            overflow: 'hidden',
                            backgroundColor: theme.palette.background.default,
                        }}
                    >
                        <canvas
                            className={"waterfall-canvas-tile-a"}
                            ref={waterFallTileCanvasARef}
                            width={waterFallCanvasWidth}
                            height={waterFallCanvasHeight}
                            style={{
                                imageRendering: 'pixelated',
                                width: '100%',
                                height: `${waterFallCanvasHeight}px`,
                                display: 'block',
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                touchAction: 'pan-y',
                                transform: 'translate3d(0,0,0)',
                                backfaceVisibility: 'hidden',
                                willChange: 'transform',
                            }}
                        />
                        <canvas
                            className={"waterfall-canvas-tile-b"}
                            ref={waterFallTileCanvasBRef}
                            width={waterFallCanvasWidth}
                            height={waterFallCanvasHeight}
                            style={{
                                imageRendering: 'pixelated',
                                width: '100%',
                                height: `${waterFallCanvasHeight}px`,
                                display: 'block',
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                touchAction: 'pan-y',
                                transform: 'translate3d(0,0,0)',
                                backfaceVisibility: 'hidden',
                                willChange: 'transform',
                            }}
                        />
                        <canvas
                            className={"waterfall-canvas"}
                            ref={waterFallCanvasRef}
                            width={waterFallCanvasWidth}
                            height={waterFallCanvasHeight}
                            style={{
                                width: 0,
                                height: 0,
                                display: 'none',
                            }}
                        />
                    </Box>
                ) : (
                    <canvas
                        className={"waterfall-canvas"}
                        ref={waterFallCanvasRef}
                        width={waterFallCanvasWidth}
                        height={waterFallCanvasHeight}
                        style={{
                            imageRendering: 'smooth',
                            WebkitFontSmoothing: 'antialiased',
                            width: '100%',
                            height: `${waterFallCanvasHeight}px`,
                            backgroundColor: theme.palette.background.default,
                            display: 'block',
                            touchAction: 'pan-y',
                            transform: 'translateZ(0)', // this it breaks box-shadow CSS
                            backfaceVisibility: 'hidden',
                            perspective: '1000px',
                        }}
                    />
                )}
            </Box>

        </Box>
    );
});

export default WaterfallAndBandscope;
