
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


import React, {useState, useEffect, useCallback, useRef, useMemo} from "react";
import { useDispatch, useSelector } from "react-redux";
import { Box, IconButton } from '@mui/material';
import { useAudio } from '../../dashboard/audio-provider.jsx';
import {
    setVFOProperty,
    setSelectedVFO,
} from './vfo-slice.jsx';
import {
    canvasDrawingUtils,
    getVFOLabelIconWidth,
    calculateBandwidthChange,
    calculateVFOFrequencyBounds,
    generateVFOLabelText,
    getVisibleFrequencyRange,
    formatFrequency,
    formatBaudrate
} from './vfo-utils.js';
import { resolveVfoAudioStatus, VFO_AUDIO_STATUS } from '../vfo-audio-status.js';
import {
    useVFODragHandlers,
    useVFOMouseHandlers,
    useVFOTouchHandlers,
    useVFOWheelHandler,
    useVFODragState
} from './vfo-events.jsx';
import {

    getBandwidthConfig,
    canDragLeftEdge,
    canDragRightEdge,
    isCenterLineOnly,
    isLockedBandwidth
} from './vfo-config.js';

const GNSS_CONSTELLATION_BY_CODE = {
    G: 'GPS',
    E: 'GALILEO',
    R: 'GLONASS',
    C: 'BEIDOU',
    B: 'BEIDOU',
    J: 'QZSS',
};

const normalizeGnssConstellation = (value) => {
    if (!value) return '';
    const raw = String(value).trim();
    const upper = raw.toUpperCase();
    if (GNSS_CONSTELLATION_BY_CODE[upper]) {
        return GNSS_CONSTELLATION_BY_CODE[upper];
    }
    if (upper === 'GALILEO' || upper === 'GLONASS' || upper === 'BEIDOU' || upper === 'GPS' || upper === 'QZSS') {
        return upper;
    }
    return raw.toUpperCase();
};

const parseGnssPrnValue = (value) => {
    if (value === null || value === undefined) return null;
    const match = String(value).toUpperCase().match(/(\d{1,3})/);
    if (!match) return null;
    const parsed = Number(match[1]);
    return Number.isFinite(parsed) ? parsed : null;
};

const extractGnssSatelliteIdentity = (output) => {
    if (!output) return null;

    const code = String(output.satellite_system || '').trim().toUpperCase();
    const prnFromFields = parseGnssPrnValue(output.satellite_prn);
    if (code && Number.isFinite(prnFromFields)) {
        return {
            constellation: normalizeGnssConstellation(code),
            prn: prnFromFields,
        };
    }

    const satelliteText = String(output.satellite || '');
    const prnNameMatch = satelliteText.match(/([A-Za-z]+)\s+PRN\s+([A-Za-z]?\d+)/i);
    if (prnNameMatch) {
        const parsedPrn = parseGnssPrnValue(prnNameMatch[2]);
        if (!Number.isFinite(parsedPrn)) {
            return null;
        }
        return {
            constellation: normalizeGnssConstellation(prnNameMatch[1]),
            prn: parsedPrn,
        };
    }

    const message = String(output.message || '');
    const acqMatch = message.match(/for satellite\s+([A-Z])\s+(\d+)/i);
    if (acqMatch) {
        return {
            constellation: normalizeGnssConstellation(acqMatch[1]),
            prn: parseGnssPrnValue(acqMatch[2]),
        };
    }

    const trackingMatch = message.match(/for satellite\s+([A-Za-z]+)\s+PRN\s+([A-Za-z]?\d+)/i);
    if (trackingMatch) {
        const parsedPrn = parseGnssPrnValue(trackingMatch[2]);
        if (!Number.isFinite(parsedPrn)) {
            return null;
        }
        return {
            constellation: normalizeGnssConstellation(trackingMatch[1]),
            prn: parsedPrn,
        };
    }

    return null;
};

const VFOMarkersContainer = ({
                                 centerFrequency,
                                 sampleRate,
                                 waterfallHeight,
                                 bandscopeHeight,
                                 containerWidth,
                                 transformTick = 0,
                                 interactionActive = false,
                                 allowInteractionMeasure = false,
                                 interactionMeasureTick = 0,
                                 zoomScale,
                                 currentPositionX,
                             }) => {
    const dispatch = useDispatch();
    const { getVfoSquelchDebug } = useAudio();
    const {
        vfoMarkers,
        maxVFOMarkers,
        selectedVFO,
        streamingVFOs,
        vfoColors,
        vfoActive,
        vfoMuted,
    } = useSelector(state => state.vfo);

    const {
        active: activeDecoders,
        outputs: decoderOutputs,
        currentSessionId
    } = useSelector(state => state.decoders);

    // Get runtime snapshot for internal VFO data
    const runtimeSnapshot = useSelector(state => state.sessions?.runtimeSnapshot?.data);

    const containerRef = useRef(null);
    const canvasRef = useRef(null);
    // Canvas context caching for performance
    const canvasContextRef = useRef(null);
    const [actualWidth, setActualWidth] = useState(containerWidth);
    const lastMeasuredWidthRef = useRef(0);
    const [activeMarker, setActiveMarker] = useState(null);
    const [isDragging, setIsDragging] = useState(false);
    const isDraggingRef = useRef(false);
    const [dragMode, setDragMode] = useState(null); // 'body', 'leftEdge', or 'rightEdge'
    const lastClientXRef = useRef(0);
    const lastTouchXRef = useRef(0);
    //const height = bandscopeHeight + waterfallHeight;
    const height = bandscopeHeight;
    const [cursor, setCursor] = useState('default');
    const [vfoSquelchOpen, setVfoSquelchOpen] = useState({
        1: null,
        2: null,
        3: null,
        4: null,
    });

    // Track the previous VFO active state to detect changes
    const prevVfoActiveRef = useRef({});

    // Bandwidth limits are now determined dynamically based on mode via vfo-config.js

    // Configurable vertical length of resize handles
    const [edgeHandleHeight] = useState(20);

    // Configurable Y position offset for resize handles
    const [edgeHandleYOffset] = useState(60);

    // Configurable mousewheel frequency step (in Hz)
    const [mousewheelFreqStep] = useState(1000); // 100 Hz step

    // Additional refs needed by event handlers
    const lastTapRef = useRef(0);
    const tapTimeoutRef = useRef(null);
    const touchStartTimeoutRef = useRef(null);

    // Calculate frequency range
    const startFreq = centerFrequency - sampleRate / 2;
    const endFreq = centerFrequency + sampleRate / 2;
    const freqRange = endFreq - startFreq;

    // Helper function to find decoder info for a VFO
    const getDecoderInfoForVFO = useCallback((vfoNumber) => {
        // Only consider decoders from the current session to avoid showing stale decoders
        // from previous sessions (backend restarts, reconnects, etc.)
        if (!currentSessionId) {
            return null;
        }

        // Find decoder sessions matching this VFO number AND current session, excluding closed decoders
        const decoderEntries = Object.values(activeDecoders).filter(
            decoder => decoder.vfo === vfoNumber &&
                      decoder.session_id === currentSessionId &&
                      decoder.status !== 'closed'
        );

        // Return the most recent decoder (if multiple exist)
        if (decoderEntries.length > 0) {
            return decoderEntries.sort((a, b) => b.last_update - a.last_update)[0];
        }
        return null;
    }, [activeDecoders, currentSessionId]);

    // Helper function to get all internal VFO sessions with their live VFO data
    const getInternalVFOSessions = useCallback(() => {
        if (!runtimeSnapshot?.sessions) {
            return [];
        }

        const internalSessions = [];

        // Iterate through all sessions in runtime snapshot
        Object.entries(runtimeSnapshot.sessions).forEach(([sessionId, sessionData]) => {
            // Only process internal sessions
            if (!sessionData.is_internal || !sessionId.startsWith('internal:')) {
                return;
            }

            // Get active VFOs for this internal session
            if (sessionData.vfos) {
                Object.entries(sessionData.vfos).forEach(([vfoNumber, vfoData]) => {
                    // Only process active VFOs with valid frequency
                    if (vfoData.active && vfoData.center_freq > 0) {
                        // Find decoder info for this internal session and VFO
                        const decoderInfo = Object.values(activeDecoders).find(
                            decoder => decoder.session_id === sessionId &&
                                      decoder.vfo === parseInt(vfoNumber) &&
                                      decoder.status !== 'closed'
                        );

                        internalSessions.push({
                            sessionId,
                            vfoNumber: parseInt(vfoNumber),
                            vfoData,
                            sessionMetadata: sessionData.metadata,
                            decoderInfo // Include decoder status info
                        });
                    }
                });
            }
        });

        return internalSessions;
    }, [runtimeSnapshot, activeDecoders]);

    // Helper function to get morse decoder output text for a VFO
    const getMorseOutputForVFO = useCallback((vfoNumber) => {
        // Find decoder info first (already filtered by current session)
        const decoderInfo = getDecoderInfoForVFO(vfoNumber);
        if (!decoderInfo || decoderInfo.decoder_type !== 'morse') {
            return null;
        }

        // Find the output for this decoder session AND VFO
        // Note: getDecoderInfoForVFO already ensures session_id matches currentSessionId
        const output = decoderOutputs?.find(
            out => out.session_id === decoderInfo.session_id &&
                   out.decoder_type === 'morse' &&
                   out.vfo === vfoNumber
        );

        if (output && output.output && output.output.text) {
            // Trim to last 300 chars as requested, then take last 30 for display
            const fullText = output.output.text.slice(-300);
            const displayText = fullText.slice(-30);
            return displayText;
        }
        return null;
    }, [decoderOutputs, getDecoderInfoForVFO]);

    // Helper function to get AX.25 packet decoder outputs for a VFO (BPSK/FSK/GMSK/GFSK/AFSK)
    const getPacketDecoderOutputsForVFO = useCallback((vfoNumber) => {
        // Find decoder info first (already filtered by current session)
        const decoderInfo = getDecoderInfoForVFO(vfoNumber);
        if (!decoderInfo || !['bpsk', 'fsk', 'gmsk', 'gfsk', 'afsk'].includes(decoderInfo.decoder_type)) {
            return null;
        }

        // Filter all outputs for this VFO and session
        // Note: Match any of bpsk/fsk/gmsk/gfsk/afsk since they're related protocols (all use AX.25)
        // getDecoderInfoForVFO already ensures session_id matches currentSessionId
        const outputs = decoderOutputs?.filter(
            out => out.session_id === decoderInfo.session_id &&
                   ['bpsk', 'fsk', 'gmsk', 'gfsk', 'afsk'].includes(out.decoder_type) &&
                   out.vfo === vfoNumber
        );

        if (!outputs || outputs.length === 0) {
            // Return object with NO CALL indicator even when no outputs yet
            return {
                count: 0,
                fromCallsign: 'NO CALL'
            };
        }

        // Get the most recent output to extract the "from" callsign
        const latestOutput = outputs.sort((a, b) => b.timestamp - a.timestamp)[0];
        const fromCallsign = latestOutput?.output?.callsigns?.from || 'NO CALL';

        return {
            count: outputs.length,
            fromCallsign: fromCallsign
        };
    }, [decoderOutputs, getDecoderInfoForVFO]);

    // Count unique satellites currently detected by GNSS outputs for this VFO/session.
    const getGnssDetectedSatCountForVFO = useCallback((vfoNumber, sessionId = null) => {
        const decoderInfo = getDecoderInfoForVFO(vfoNumber);
        const effectiveSessionId = sessionId || decoderInfo?.session_id;
        if (!effectiveSessionId) {
            return 0;
        }

        const identities = new Set();
        const outputs = decoderOutputs?.filter(
            (out) => out.session_id === effectiveSessionId
                && out.decoder_type === 'gnss'
                && out.vfo === vfoNumber
        ) || [];

        for (const out of outputs) {
            const identity = extractGnssSatelliteIdentity(out.output || {});
            if (!identity || !identity.constellation || !Number.isFinite(identity.prn)) {
                continue;
            }
            identities.add(`${identity.constellation}-${identity.prn}`);
        }

        return identities.size;
    }, [decoderOutputs, getDecoderInfoForVFO]);

    // Get or create canvas context with caching
    const getCanvasContext = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return null;

        // Return cached context if available and canvas hasn't changed
        if (canvasContextRef.current && canvasContextRef.current.canvas === canvas) {
            return canvasContextRef.current;
        }

        // Create and cache new context
        try {
            const ctx = canvas.getContext('2d', { willReadFrequently: true });
            if (ctx) {
                canvasContextRef.current = ctx;
                return ctx;
            }
        } catch (error) {
            console.error('Failed to get canvas 2d context:', error);
        }

        return null;
    }, []);

    // Clear canvas context cache when canvas changes
    useEffect(() => {
        // Reset cached context when canvas ref changes
        canvasContextRef.current = null;
    }, [canvasRef.current]);

    // Consolidated function to set redux state
    const updateVFOProperty = useCallback((vfoNumber, updates) => {
        dispatch(setVFOProperty({
            vfoNumber,
            updates,
        }));
    }, [dispatch]);


    // When the VFO status changes, detect which VFO was just made active
    useEffect(() => {
        // Compare current vfoActive with previous state
        Object.keys(vfoActive).forEach(vfoNumber => {
            const isCurrentlyActive = vfoActive[vfoNumber];
            const wasPreviouslyActive = prevVfoActiveRef.current[vfoNumber] || false;

            // Only process VFOs that just became active (transition from false/undefined to true)
            if (isCurrentlyActive && !wasPreviouslyActive) {
                const marker = vfoMarkers[vfoNumber];

                if (marker) {
                    const updates = {};

                    // Check if color needs to be set
                    if (marker.color === null) {
                        // Use the color from vfoColors array based on VFO number
                        const colorIndex = parseInt(vfoNumber) - 1;
                        updates.color = vfoColors[colorIndex] || '#FF0000';
                    }

                    // Check if frequency needs to be updated
                    // Only set frequency if it's null (uninitialized)
                    // Do NOT reset frequency if VFO is outside visible range - user may have intentionally placed it there
                    if (marker.frequency === null) {
                        const visibleRange = getVisibleFrequencyRange(centerFrequency, sampleRate, actualWidth, containerWidth, currentPositionX);
                        updates.frequency = visibleRange.centerFrequency;
                    }

                    // Only dispatch if there are updates to make
                    if (Object.keys(updates).length > 0) {
                        dispatch(setVFOProperty({
                            vfoNumber: parseInt(vfoNumber),
                            updates,
                        }));
                    }
                }
            }
        });

        // Update the previous state reference for next comparison
        prevVfoActiveRef.current = { ...vfoActive };

        return () => {
            // Cleanup if needed
        };
    }, [vfoActive, vfoMarkers, vfoColors, dispatch, centerFrequency, sampleRate, actualWidth, containerWidth, currentPositionX]);

    // Use VFO drag handlers
    const {
        handleDragMovement,
        initializeDragState,
        flushDragMovement,
        resetDragMovementState,
    } = useVFODragHandlers({
        activeMarker,
        vfoMarkers,
        actualWidth,
        freqRange,
        dragMode,
        startFreq,
        endFreq,
        updateVFOProperty,
        canvasRef
    });

    // End drag operation
    const endDragOperation = useCallback(() => {
        resetDragMovementState();
        setIsDragging(false);
        isDraggingRef.current = false;
        setActiveMarker(null);
        setDragMode(null);
    }, [resetDragMovementState]);

    // Use VFO wheel handler
    useVFOWheelHandler({
        canvasRef,
        selectedVFO,
        vfoMarkers,
        vfoActive,
        startFreq,
        endFreq,
        updateVFOProperty
    });

    // Update actual width measurement
    const updateActualWidth = useCallback(() => {
        // Get the actual client dimensions of the element
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const roundedWidth = Math.round(rect.width);

        // Quantize width updates to avoid subpixel jitter churn.
        if (roundedWidth > 0 && roundedWidth !== lastMeasuredWidthRef.current) {
            lastMeasuredWidthRef.current = roundedWidth;
            setActualWidth(roundedWidth);
        }
    }, []);

    // Update width when layout or transform-driven width changes.
    useEffect(() => {
        if (interactionActive) {
            return;
        }
        updateActualWidth();
    }, [containerWidth, transformTick, interactionActive, updateActualWidth]);

    useEffect(() => {
        if (!interactionActive || !allowInteractionMeasure) {
            return;
        }
        updateActualWidth();
    }, [interactionActive, allowInteractionMeasure, interactionMeasureTick, updateActualWidth]);

    // Poll squelch gate state from audio diagnostics with change-only updates.
    useEffect(() => {
        const readSquelchState = () => {
            const nextState = { 1: null, 2: null, 3: null, 4: null };
            for (let vfoNumber = 1; vfoNumber <= 4; vfoNumber += 1) {
                const debug = getVfoSquelchDebug?.(vfoNumber);
                if (debug && typeof debug.gate_open === 'boolean') {
                    nextState[vfoNumber] = Boolean(debug.gate_open);
                }
            }

            setVfoSquelchOpen((prevState) => {
                if (
                    prevState[1] === nextState[1] &&
                    prevState[2] === nextState[2] &&
                    prevState[3] === nextState[3] &&
                    prevState[4] === nextState[4]
                ) {
                    return prevState;
                }
                return nextState;
            });
        };

        readSquelchState();
        const interval = setInterval(readSquelchState, 250);
        return () => clearInterval(interval);
    }, [getVfoSquelchDebug]);

    // Resize backing store only when dimensions actually change.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }

        const targetWidth = Math.max(1, actualWidth);
        const targetHeight = Math.max(1, height);
        if (canvas.width !== targetWidth) {
            canvas.width = targetWidth;
        }
        if (canvas.height !== targetHeight) {
            canvas.height = targetHeight;
        }
    }, [actualWidth, height]);

    // Send render commands to the worker or fallback to direct rendering
    useEffect(() => {
        renderVFOMarkersDirect();
    }, [vfoActive, vfoMarkers, actualWidth, height,
        centerFrequency, sampleRate, selectedVFO, streamingVFOs, vfoMuted, vfoSquelchOpen, containerWidth, currentPositionX, activeDecoders, decoderOutputs, runtimeSnapshot]);

    // Rendering function with cached context
    const renderVFOMarkersDirect = () => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }

        // Use cached context
        const ctx = getCanvasContext();
        if (!ctx) {
            console.warn('Could not get canvas 2d context');
            return;
        }

        // Clear the canvas
        ctx.clearRect(0, 0, canvas.width, height);

        // Draw internal VFO markers FIRST (read-only, greyed-out) using live session data
        // This ensures user VFOs always paint over internal observation VFOs
        const internalVFOSessions = getInternalVFOSessions();
        internalVFOSessions.forEach(({ sessionId, vfoNumber, vfoData, sessionMetadata, decoderInfo }) => {
            // Use actual VFO frequency from session data
            const frequency = vfoData.center_freq;

            // Skip if outside visible range
            if (frequency < startFreq || frequency > endFreq) {
                return;
            }

            // Calculate center position
            const centerX = ((frequency - startFreq) / freqRange) * actualWidth;

            // Use actual bandwidth from VFO data
            const bandwidth = vfoData.bandwidth;

            // Calculate edge positions
            const leftFreq = frequency - bandwidth / 2;
            const rightFreq = frequency + bandwidth / 2;
            const leftEdgeX = ((leftFreq - startFreq) / freqRange) * actualWidth;
            const rightEdgeX = ((rightFreq - startFreq) / freqRange) * actualWidth;

            // Use grey color for internal VFOs
            const internalColor = '#A0A0A0';
            const internalAreaOpacity = '20'; // More visible
            const internalLineOpacity = 'CC'; // Much brighter

            // Draw area, center line, and edges using same style as regular VFOs
            canvasDrawingUtils.drawVFOArea(ctx, leftEdgeX, rightEdgeX, height, internalColor, internalAreaOpacity);
            canvasDrawingUtils.drawVFOLine(ctx, centerX, height, internalColor, internalLineOpacity, 1.5);

            // Use the actual modulation mode from VFO data
            const modulationMode = vfoData.modulation?.toLowerCase() || 'usb';
            canvasDrawingUtils.drawVFOEdges(ctx, modulationMode, leftEdgeX, rightEdgeX, height, internalColor, internalLineOpacity, 1, vfoData.decoder);

            // Generate label text using session metadata and VFO data
            // For internal VFOs, use "OBS" prefix to distinguish from regular VFOs
            const satelliteName = sessionMetadata?.satellite_name || 'Internal';

            // Create a marker-like object to use with generateVFOLabelText
            // Use a name like "OBS 1" to match the VFO naming pattern
            const internalMarker = {
                name: `OBS ${vfoNumber}`,
                frequency: frequency,
                decoder: vfoData.decoder
            };

            const labelText = generateVFOLabelText(internalMarker, modulationMode, bandwidth, formatFrequency);

            // Use decoder info from activeDecoders for status
            const decoderInfoForLabel = decoderInfo ? {
                decoder_type: decoderInfo.decoder_type,
                status: decoderInfo.status || 'processing',
                info: decoderInfo.info
            } : null;

            // Check if this internal VFO is locked to a transmitter
            const isLocked = vfoData.locked_transmitter_id && vfoData.locked_transmitter_id !== 'none';

            // Use the same drawing utility as regular VFOs but with grey color
            canvasDrawingUtils.drawVFOLabel(
                ctx,
                centerX,
                labelText,
                internalColor,
                internalLineOpacity,
                false, // not selected
                isLocked, // use actual lock state
                decoderInfoForLabel,
                null, // no morse text
                false, // not streaming
                null, // no packet outputs
                null, // no GNSS count
                false, // not muted
                VFO_AUDIO_STATUS.NO_AUDIO
            );
        });

        // Draw user VFO markers AFTER internal VFOs (so they paint on top)
        // Get active VFO keys and sort them so selected VFO is last (drawn on top)
        const vfoKeys = Object.keys(vfoActive).filter(key => vfoActive[key]);

        // Sort keys to put selected VFO at the end (drawn last)
        const sortedVfoKeys = vfoKeys.sort((a, b) => {
            // If a is selected, it should come after b (drawn on top)
            if (parseInt(a) === selectedVFO) return 1;
            // If b is selected, it should come after a
            if (parseInt(b) === selectedVFO) return -1;
            // Otherwise maintain original order
            return parseInt(a) - parseInt(b);
        });

        // Draw each marker in sorted order (selected one drawn last)
        sortedVfoKeys.forEach(markerIdx => {
            const marker = vfoMarkers[markerIdx];
            const isSelected = parseInt(markerIdx) === selectedVFO;

            // Get decoder info for this VFO
            const decoderInfo = getDecoderInfoForVFO(parseInt(markerIdx));

            // Use the VFO's configured mode directly
            const bounds = calculateVFOFrequencyBounds(marker, startFreq, freqRange, actualWidth);

            // Skip if the marker is outside the visible range
            if (bounds.markerHighFreq < startFreq || bounds.markerLowFreq > endFreq) {
                return;
            }

            const { leftEdgeX, rightEdgeX, centerX, mode, bandwidth } = bounds;
            const areaOpacity = isSelected ? '33' : '15';
            const lineOpacity = isSelected ? 'FF' : '99';

            // Check if this is a center-only mode (no sidebands) using config
            const centerOnly = isCenterLineOnly(mode, marker.decoder);

            // Use drawing utilities
            if (!centerOnly) {
                canvasDrawingUtils.drawVFOArea(ctx, leftEdgeX, rightEdgeX, height, marker.color, areaOpacity);
            }
            canvasDrawingUtils.drawVFOLine(ctx, centerX, height, marker.color, lineOpacity, isSelected ? 2 : 1.5);
            if (!centerOnly) {
                canvasDrawingUtils.drawVFOEdges(ctx, mode, leftEdgeX, rightEdgeX, height, marker.color, lineOpacity, isSelected ? 1.5 : 1, marker.decoder);
            }

            // Draw edge handles based on mode configuration and bandwidth lock state (skip for center-only mode)
            const bandwidthLocked = isLockedBandwidth(mode, marker.decoder);
            if (!centerOnly && !bandwidthLocked) {
                const edgeHandleYPosition = edgeHandleYOffset;
                const edgeHandleWidth = isSelected ? 14 : 6;

                if (canDragRightEdge(mode, marker.decoder)) {
                    canvasDrawingUtils.drawVFOHandle(ctx, rightEdgeX, edgeHandleYPosition, edgeHandleWidth, edgeHandleHeight, marker.color, lineOpacity);
                }

                if (canDragLeftEdge(mode, marker.decoder)) {
                    canvasDrawingUtils.drawVFOHandle(ctx, leftEdgeX, edgeHandleYPosition, edgeHandleWidth, edgeHandleHeight, marker.color, lineOpacity);
                }
            }

            // Draw frequency label
            const labelText = generateVFOLabelText(marker, mode, bandwidth, formatFrequency);
            const isLocked = marker.lockedTransmitterId && marker.lockedTransmitterId !== 'none';

            // Get morse output text if this VFO has a morse decoder
            const morseText = getMorseOutputForVFO(parseInt(markerIdx));

            // Get packet decoder outputs info if this VFO has a packet decoder (BPSK/FSK/GMSK/GFSK/AFSK)
            const packetOutputs = getPacketDecoderOutputsForVFO(parseInt(markerIdx));
            const gnssDetectedSatCount = decoderInfo?.decoder_type === 'gnss'
                ? getGnssDetectedSatCountForVFO(parseInt(markerIdx))
                : null;

            // Check if this VFO is currently streaming audio
            const isStreaming = streamingVFOs.includes(parseInt(markerIdx));

            // Check if this VFO is muted
            const isMuted = vfoMuted[parseInt(markerIdx)] || false;
            const isSquelchOpen = vfoSquelchOpen[parseInt(markerIdx)] ?? null;
            const audioStatus = resolveVfoAudioStatus({
                isStreaming,
                isMuted,
                isSquelchOpen,
            });

            canvasDrawingUtils.drawVFOLabel(
                ctx,
                centerX,
                labelText,
                marker.color,
                lineOpacity,
                isSelected,
                isLocked,
                decoderInfo,
                morseText,
                isStreaming,
                packetOutputs,
                gnssDetectedSatCount,
                isMuted,
                audioStatus
            );
        });
    };

    // Check if mouse/touch is over a handle or edge
    const getHoverElement = useCallback((x, y) => {
        // Calculate scaling factor between canvas coordinate space and DOM space
        const rect = canvasRef.current.getBoundingClientRect();
        const scaleX = actualWidth / rect.width;
        const canvasX = x * scaleX;

        // Determine if this is a touch event (use larger hit areas for touch)
        const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

        // Use larger hit areas for touch devices
        const edgeHandleWidth = isTouchDevice ? 12 : 6;
        const labelYRange = isTouchDevice ? 25 : 20;
        const edgeHandleYPosition = edgeHandleYOffset;

        // Function to check if a single VFO has a hit
        const checkVFOHit = (key) => {
            if (!vfoMarkers[key] || !vfoActive[key]) return null;

            const marker = vfoMarkers[key];

            // Get effective mode using centralized config (handles decoder overrides)
            const decoderInfo = getDecoderInfoForVFO(parseInt(key));
            // Use the VFO's configured mode directly
            const bounds = calculateVFOFrequencyBounds(marker, startFreq, freqRange, actualWidth);
            const { leftEdgeX, rightEdgeX, centerX, mode, bandwidth } = bounds;

            // Check label (y between 0-20px with enlarged touch area) - treat as body drag
            if (y >= 0 && y <= labelYRange) {
                // Calculate label width (approximated based on drawing code)
                const labelText = generateVFOLabelText(marker, mode, bandwidth, formatFrequency);

                // Use cached context for text measurement
                const ctx = getCanvasContext();
                if (ctx) {
                    ctx.font = 'bold 12px Monospace';
                    const textMetrics = ctx.measureText(labelText);
                    // Always add extra width for speaker icon (shown as muted or active) and lock icon if locked
                    const isLocked = marker.lockedTransmitterId && marker.lockedTransmitterId !== 'none';
                    const iconWidth = getVFOLabelIconWidth(isLocked);
                    const labelWidth = textMetrics.width + 10 + iconWidth;

                    // Check if mouse is over label area
                    if (Math.abs(canvasX - centerX) <= labelWidth / 2) {
                        return { key, element: 'body' };
                    }
                }
            }

            // Check secondary decoder label if it exists (positioned at y: 25-41px)
            const secondaryLabelYRange = isTouchDevice ? 45 : 41;
            if (decoderInfo && y >= 25 && y <= secondaryLabelYRange) {
                const ctx = getCanvasContext();
                if (ctx) {
                    ctx.font = '10px Monospace';

                    // Calculate secondary label text based on decoder type
                    let secondaryLabelText = '';
                    const decoderType = decoderInfo.decoder_type;

                    if (['bpsk', 'fsk', 'gmsk', 'gfsk', 'afsk'].includes(decoderType)) {
                        const status = decoderInfo.status || 'processing';
                        const baudrate = decoderInfo.info?.baudrate || 0;
                        const framing = decoderInfo.info?.framing || 'unknown';
                        const formattedBaudrate = formatBaudrate(baudrate);
                        secondaryLabelText = `${status.toUpperCase()} | ${decoderType.toUpperCase()} ${formattedBaudrate} | ${framing.toUpperCase()}`;
                    } else if (decoderType === 'gnss') {
                        const status = decoderInfo.status || 'listening';
                        const satCount = getGnssDetectedSatCountForVFO(parseInt(key));
                        secondaryLabelText = `${status.toUpperCase()} | SAT ${satCount}`;
                    } else if (decoderType === 'lora') {
                        const status = decoderInfo.status || 'listening';
                        const sf = decoderInfo.info?.spreading_factor;
                        const bw = decoderInfo.info?.bandwidth_khz;
                        const cr = decoderInfo.info?.coding_rate;
                        const loraParams = (sf !== null && bw !== null && cr !== null)
                            ? `SF${sf} BW${bw} CR${cr}`
                            : 'DETECTING';
                        secondaryLabelText = `${status.toUpperCase()} | ${loraParams}`;
                    } else if (decoderType === 'transcription') {
                        const status = decoderInfo.status || 'idle';
                        const language = decoderInfo.info?.language || 'auto';
                        const translateTo = decoderInfo.info?.translate_to || 'none';
                        const provider = (decoderInfo.info?.provider || '').toLowerCase();

                        // Show translation indicator if enabled and not using Deepgram (which doesn't support translation)
                        const translationIndicator = (translateTo !== 'none' && provider !== 'deepgram') ? ` → ${translateTo.toUpperCase()}` : '';
                        secondaryLabelText = `${status.toUpperCase()} | ${language.toUpperCase()}${translationIndicator}`;
                    } else {
                        // For other decoder types, construct the label
                        const parts = [decoderType.toUpperCase()];
                        if (decoderInfo.status) parts.push(decoderInfo.status);
                        if (decoderInfo.mode) parts.push(decoderInfo.mode);
                        if (decoderInfo.progress !== null && decoderInfo.progress !== undefined) {
                            parts.push(`${Math.round(decoderInfo.progress)}%`);
                        }
                        secondaryLabelText = parts.join(' | ');
                    }

                    if (secondaryLabelText) {
                        const secondaryTextMetrics = ctx.measureText(secondaryLabelText);
                        const secondaryLabelWidth = secondaryTextMetrics.width + 8;

                        // Check if mouse is over secondary label area
                        if (Math.abs(canvasX - centerX) <= secondaryLabelWidth / 2) {
                            return { key, element: 'body' };
                        }
                    }
                }
            }

            // Check edge handles based on mode configuration and bandwidth lock state
            // Use the new position (edgeHandleYPosition) with an appropriate range
            const edgeYMin = edgeHandleYPosition - edgeHandleHeight / 2;
            const edgeYMax = edgeHandleYPosition + edgeHandleHeight / 2;

            // Only allow edge dragging if bandwidth is not locked
            const bandwidthLocked = isLockedBandwidth(mode, marker.decoder);

            if (!bandwidthLocked && canDragRightEdge(mode, marker.decoder)) {
                // Check right edge with updated Y position
                if (y >= edgeYMin && y <= edgeYMax && Math.abs(canvasX - rightEdgeX) <= edgeHandleWidth) {
                    return { key, element: 'rightEdge' };
                }
            }

            if (!bandwidthLocked && canDragLeftEdge(mode, marker.decoder)) {
                // Check left edge with updated Y position
                if (y >= edgeYMin && y <= edgeYMax && Math.abs(canvasX - leftEdgeX) <= edgeHandleWidth) {
                    return { key, element: 'leftEdge' };
                }
            }

            // Check if this is a center-only mode (no sidebands)
            const centerOnly = isCenterLineOnly(mode, marker.decoder);

            // For center-only modes, only allow dragging near the center line
            if (centerOnly) {
                const centerLineHitWidth = isTouchDevice ? 12 : 6;
                if (Math.abs(canvasX - centerX) <= centerLineHitWidth) {
                    return { key, element: 'body' };
                }
            } else {
                // Check if click is within the VFO body area (but not on edge handles)
                if (canvasX >= leftEdgeX && canvasX <= rightEdgeX &&
                    !(y >= edgeYMin && y <= edgeYMax)) {
                    return { key, element: 'body' }; // Treat clicks within VFO body as body drag
                }
            }

            return null;
        };

        // First check if the selected VFO has a hit
        if (selectedVFO !== null) {
            const selectedKey = selectedVFO.toString();
            const hitResult = checkVFOHit(selectedKey);
            if (hitResult) {
                return { key: selectedKey, element: hitResult.element };
            }
        }

        // Get all active VFO keys and sort them (non-selected VFOs)
        const vfoKeys = Object.keys(vfoActive).filter(key =>
            vfoActive[key] && parseInt(key) !== selectedVFO
        );

        // Check each VFO in order
        for (const key of vfoKeys) {
            const hitResult = checkVFOHit(key);
            if (hitResult) {
                return { key, element: hitResult.element };
            }
        }

        return { key: null, element: null };
    }, [vfoActive, actualWidth, startFreq, freqRange, selectedVFO,
        edgeHandleHeight, edgeHandleYOffset, vfoMarkers, getCanvasContext, getDecoderInfoForVFO, getGnssDetectedSatCountForVFO]);

    // Use VFO mouse handlers
    const {
        handleMouseMove,
        handleMouseLeave,
        handleMouseDown,
        handleClick,
        handleDoubleClick
    } = useVFOMouseHandlers({
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
    });

    // Use VFO touch handlers
    const {
        handleTouchStart,
        handleTouchMove: handleTouchMoveBase,
        handleTouchEnd: handleTouchEndBase,
        handleTouchCancel: handleTouchCancelBase,
        handleTap
    } = useVFOTouchHandlers({
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
    });

    // Wrap touch handlers to pass additional dependencies
    const handleTouchMove = useCallback((e) => {
        handleTouchMoveBase(e, touchStartTimeoutRef, handleDragMovement);
    }, [handleTouchMoveBase, handleDragMovement]);

    const handleTouchEnd = useCallback((e) => {
        handleTouchEndBase(e, touchStartTimeoutRef, endDragOperation);
    }, [handleTouchEndBase, endDragOperation]);

    const handleTouchCancel = useCallback((e) => {
        handleTouchCancelBase(e, touchStartTimeoutRef, endDragOperation);
    }, [handleTouchCancelBase, endDragOperation]);

    // Use VFO drag state management
    useVFODragState({
        isDragging,
        activeMarker,
        handleDragMovement,
        endDragOperation,
        flushDragMovement,
        lastClientXRef,
        lastTouchXRef
    });

    return (
        <Box
            ref={containerRef}
            className={"vfo-markers-container"}
            sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                //width: `${containerWidth}px`,
                width: '100%',
                height: height,
                zIndex: 400,
            }}
        >
            {/* Canvas for VFO markers */}
            <canvas
                className={"vfo-markers-canvas"}
                ref={canvasRef}
                onClick={handleClick}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseLeave={handleMouseLeave}
                onDoubleClick={handleDoubleClick}
                onTouchStart={(e) => {
                    // Store the timestamp for distinguishing between tap and double-tap
                    const currentTime = new Date().getTime();
                    const tapLength = currentTime - lastTapRef.current;

                    // Handle potential double-tap
                    if (tapLength < 500 && tapLength > 0) {
                        //handleDoubleTap(e);
                    } else {
                        // First, check if this is a drag operation
                        handleTouchStart(e);

                        // If not a drag, then it might be a tap for selection
                        // Use a small timeout to ensure we don't interfere with drag operations
                        // Check the ref (synchronous) not the state (asynchronous)
                        if (!isDraggingRef.current) {
                            // Capture touch coordinates before they become invalid
                            const touch = e.touches[0];
                            const capturedX = touch.clientX;
                            const capturedY = touch.clientY;

                            touchStartTimeoutRef.current = setTimeout(() => {
                                if (!isDraggingRef.current) {
                                    // Create a synthetic event-like object with captured coordinates
                                    const syntheticEvent = {
                                        touches: [{
                                            clientX: capturedX,
                                            clientY: capturedY
                                        }]
                                    };
                                    handleTap(syntheticEvent);
                                }
                                touchStartTimeoutRef.current = null;
                            }, 50);
                        }
                    }
                    lastTapRef.current = currentTime;
                }}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchCancel}
                onContextMenu={(e) => {
                    // Prevent context menu on long press
                    e.preventDefault();
                    e.stopPropagation();
                }}
                style={{
                    display: 'block',
                    width: '100%',
                    height: '100%',
                    cursor: cursor,
                    // touchAction: 'none', // Prevent browser handling of all touch actions
                    // WebkitUserSelect: 'none',
                    // MozUserSelect: 'none',
                    // msUserSelect: 'none',
                    // userSelect: 'none',
                    //transform: 'translateZ(0)', // this it breaks box-shadow CSS and also makes the canvas blurry in Chrome
                    //backfaceVisibility: 'hidden',
                    perspective: '1000px',
                }}
            />
        </Box>
    );
};

export default VFOMarkersContainer;
