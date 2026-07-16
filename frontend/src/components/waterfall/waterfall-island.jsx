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


import React, {useEffect, useRef, useState, useCallback} from 'react';
import {
    Box,
    Typography,
    Slider,
    useTheme,
    Fade,
} from '@mui/material';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import { shallowEqual, useDispatch, useSelector } from "react-redux";
import { AutoScaleOnceIcon, AutoDBIcon } from '../common/custom-icons.jsx';
import {
    getClassNamesBasedOnGridEditing,
    TitleBar,
} from "../common/common.jsx";
import WaterfallAndBandscope from './waterfall-bandscope.jsx'
import {
    setColorMap,
    setColorMaps,
    setDbRange,
    setFFTSize,
    setFFTSizeOptions,
    setGain,
    setSampleRate,
    setCenterFrequency,
    setErrorMessage,
    setErrorDialogOpen,
    setIsStreaming,
    setStartStreamingLoading,
    setAutoDBRange,
    setShowRightSideWaterFallAccessories,
    setShowLeftSideWaterFallAccessories,
    setFFTWindow,
    setSelectedSDRId,
    setSelectedOffsetValue,
    setFFTAveraging,
    setShowRotatorDottedLines,
    setAutoScalePreset,
    saveWaterfallSnapshot,
    setFFTdataOverflow,
} from './waterfall-slice.jsx';
import {
    enableVFO1,
    enableVFO2,
    enableVFO3,
    enableVFO4,
    disableVFO1,
    disableVFO2,
    disableVFO3,
    disableVFO4,
    setVFOProperty,
    setVfoInactive,
    setVfoActive,
} from './vfo-marker/vfo-slice.jsx';
import { useSocket } from "../common/socket.jsx";
import {frequencyBands} from "./bandplans.jsx";
import WaterfallStatusBar from "./waterfall-statusbar.jsx";
import WaterfallToolbar from "./waterfall-toolbar.jsx";
import WaterfallErrorDialog from "./waterfall-error-dialog.jsx";
import useWaterfallStream from "./waterfall-stream.jsx";
import { useTranslation } from 'react-i18next';
import { useWaterfallSnapshot } from "./waterfall-snapshot.js";
import WaterfallRightSidebar from "./waterfall-right-sidebar.jsx";
import { useAudio } from "../dashboard/audio-provider.jsx";
import {
    generateSnapshotName,
    toggleFullscreen as toggleFullscreenUtil,
    setupFullscreenListeners,
    setupCanvasCaptureListener,
    paintLeftMarginFiller
} from './waterfall-utils.jsx';
import { useWaterfallEventHandlers, useSnapshotHandlers } from './waterfall-events.jsx';
import { getRotatorEventDisplay } from '../target/rotator-constants.js';
import { createDomTileWaterfallRenderer } from './dom-tile-waterfall-renderer.js';
import { drawBandscope as drawBandscopeModule } from './worker-modules/rendering.js';
import { updateSmoothedFftData } from './worker-modules/smoothing.js';
import { useWaterfallEngine } from './waterfall-engine-provider.jsx';
import { getSmoothingConfig } from './smoothing-presets.js';
import { toast } from '../../utils/toast-with-timestamp.jsx';

const PLAYBACK_TIMELINE_UPDATE_MS = 250;
const WATERFALL_STATUS_BAR_HEIGHT = 30;
const WATERFALL_RIGHT_SIDEBAR_WIDTH = 64;
const PLAYBACK_OVERLAY_SIDE_GAP = 10;

function formatPlaybackTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return '00:00';
    }
    const safeSeconds = Math.floor(seconds);
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const secs = safeSeconds % 60;
    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

const MainWaterfallDisplay = React.memo(function MainWaterfallDisplay({
    playbackElapsedSecondsRef,
    playbackRemainingSecondsRef,
    playbackTotalSecondsRef
}) {
    const { t } = useTranslation('waterfall');
    const theme = useTheme();
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const waterFallCanvasRef = useRef(null);
    const waterFallTileCanvasARef = useRef(null);
    const waterFallTileCanvasBRef = useRef(null);
    const bandscopeCanvasRef = useRef(null);
    const dBAxisScopeCanvasRef = useRef(null);
    const waterFallLeftMarginCanvasRef = useRef(null);
    const waterFallLeftMarginFillerRef = useRef(null);
    const domTileRendererRef = useRef(null);
    const latestDomFftRef = useRef(null);
    const bandscopeTimerRef = useRef(null);
    const drawDomBandscopeRef = useRef(null);
    const domFftHistoryRef = useRef([]);
    const domSmoothedFftRef = useRef([]);
    const dottedLineImageDataRef = useRef(null);
    const canvasTransferredRef = useRef(false);
    const visualSettingsRef = useRef({
        dbRange: [-120, 30],
        colorMap: 'magma',
        fftSize: 1024,
        sampleRate: 2000000,
        centerFrequency: 1000000000,
    });
    const colorCache = useRef(new Map());

    // Add state for tracking metrics
    const eventMetrics = useRef({
        fftUpdatesPerSecond: 0,
        binsPerSecond: 0,
        totalUpdates: 0,
        timeElapsed: 0,
        renderWaterfallPerSecond: 0,
    });

    // Add refs for tracking event count and bin count
    const eventCountRef = useRef(0);
    const binCountRef = useRef(0);
    const lastMetricUpdateRef = useRef(Date.now());
    const lastTimestampRef = useRef(null);
    const mainWaterFallContainer = useRef(null);
    const [showSnapshotOverlay, setShowSnapshotOverlay] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const { workerRef, attachCanvases, detachCanvases, subscribeToWorkerMessages } = useWaterfallEngine();
    const {
        colorMap,
        waterfallRendererMode,
        colorMaps,
        dbRange,
        fftSizeOptions,
        fftSize,
        gain,
        sampleRate,
        centerFrequency,
        errorMessage,
        errorDialogOpen,
        isStreaming,
        isConnected,
        targetFPS,
        isPlaying,
        autoDBRange,
        gridEditable,
        fftWindow,
        fftAveraging,
        dBRange,
        waterFallVisualWidth,
        waterFallCanvasWidth,
        waterFallCanvasHeight,
        bandScopeHeight,
        bandscopeTopPadding,
        frequencyScaleHeight,
        selectedSDRId,
        startStreamingLoading,
        gettingSDRParameters,
        showRightSideWaterFallAccessories,
        showLeftSideWaterFallAccessories,
        selectedAntenna,
        selectedOffsetValue,
        fftDataOverflow,
        fftDataOverflowLimit,
        showRotatorDottedLines,
        autoScalePreset,
        bandscopeSmoothing,
        bandscopeRateLimitEnabled,
        waterFallScaleX,
        waterFallPositionX,
        sdrSettingsById,
    } = useSelector(
        (state) => ({
            colorMap: state.waterfall.colorMap,
            waterfallRendererMode: state.waterfall.waterfallRendererMode,
            colorMaps: state.waterfall.colorMaps,
            dbRange: state.waterfall.dbRange,
            fftSizeOptions: state.waterfall.fftSizeOptions,
            fftSize: state.waterfall.fftSize,
            gain: state.waterfall.gain,
            sampleRate: state.waterfall.sampleRate,
            centerFrequency: state.waterfall.centerFrequency,
            errorMessage: state.waterfall.errorMessage,
            errorDialogOpen: state.waterfall.errorDialogOpen,
            isStreaming: state.waterfall.isStreaming,
            isConnected: state.waterfall.isConnected,
            targetFPS: state.waterfall.targetFPS,
            isPlaying: state.waterfall.isPlaying,
            autoDBRange: state.waterfall.autoDBRange,
            gridEditable: state.waterfall.gridEditable,
            fftWindow: state.waterfall.fftWindow,
            fftAveraging: state.waterfall.fftAveraging,
            dBRange: state.waterfall.dBRange,
            waterFallVisualWidth: state.waterfall.waterFallVisualWidth,
            waterFallCanvasWidth: state.waterfall.waterFallCanvasWidth,
            waterFallCanvasHeight: state.waterfall.waterFallCanvasHeight,
            bandScopeHeight: state.waterfall.bandScopeHeight,
            bandscopeTopPadding: state.waterfall.bandscopeTopPadding ?? 0,
            frequencyScaleHeight: state.waterfall.frequencyScaleHeight,
            selectedSDRId: state.waterfall.selectedSDRId,
            startStreamingLoading: state.waterfall.startStreamingLoading,
            gettingSDRParameters: state.waterfall.gettingSDRParameters,
            showRightSideWaterFallAccessories: state.waterfall.showRightSideWaterFallAccessories,
            showLeftSideWaterFallAccessories: state.waterfall.showLeftSideWaterFallAccessories,
            selectedAntenna: state.waterfall.selectedAntenna,
            selectedOffsetValue: state.waterfall.selectedOffsetValue,
            fftDataOverflow: state.waterfall.fftDataOverflow,
            fftDataOverflowLimit: state.waterfall.fftDataOverflowLimit,
            showRotatorDottedLines: state.waterfall.showRotatorDottedLines,
            autoScalePreset: state.waterfall.autoScalePreset,
            bandscopeSmoothing: state.waterfall.bandscopeSmoothing,
            bandscopeRateLimitEnabled: state.waterfall.bandscopeRateLimitEnabled,
            waterFallScaleX: state.waterfall.waterFallScaleX,
            waterFallPositionX: state.waterfall.waterFallPositionX,
            sdrSettingsById: state.waterfall.sdrSettingsById,
        }),
        shallowEqual
    );

    const tunerAgc = sdrSettingsById?.[selectedSDRId]?.draft?.tunerAgc ?? false;
    const rtlAgc = sdrSettingsById?.[selectedSDRId]?.draft?.rtlAgc ?? false;
    const soapyAgc = sdrSettingsById?.[selectedSDRId]?.draft?.soapyAgc ?? false;

    const {
        vfoColors,
        vfoActive,
    } = useSelector(
        (state) => ({
            vfoColors: state.vfo.vfoColors,
            vfoActive: state.vfo.vfoActive,
        }),
        shallowEqual
    );

    const timezone = useSelector((state) =>
        state.preferences?.preferences?.find((pref) => pref.name === 'timezone')?.value || 'UTC'
    );

    // Get target satellite name from Redux
    const targetSatelliteName = useSelector((state) => state.targetSatTrack?.satelliteData?.details?.name || '');

    // Initialize waterfall snapshot hook
    const { captureSnapshot } = useWaterfallSnapshot({
        bandscopeCanvasRef,
        dBAxisScopeCanvasRef,
        waterFallLeftMarginCanvasRef,
        bandScopeHeight,
        frequencyScaleHeight,
        waterFallCanvasHeight,
        waterFallCanvasWidth,
        waterFallVisualWidth,
        waterFallScaleX,
        waterFallPositionX,
    });

    // Expose captureSnapshot globally for recording
    useEffect(() => {
        window.captureWaterfallSnapshot = captureSnapshot;
        return () => {
            delete window.captureWaterfallSnapshot;
        };
    }, [captureSnapshot]);
    const centerFrequencyRef = useRef(centerFrequency);
    const sampleRateRef = useRef(sampleRate);

    const {
        lastRotatorEvent
    } = useSelector((state) => state.targetSatTrack);

    const targetFPSRef = useRef(targetFPS);
    const waterfallControlRef = useRef(null);
    // Keep track of the last event key we sent to the worker.
    // Initialize from Redux to avoid replaying the current event on remount.
    const lastRotatorEventRef = useRef(lastRotatorEvent || "");
    const [scrollFactor, setScrollFactor] = useState(1);
    const accumulatedRowsRef = useRef(0);
    const [bandscopeAxisYWidth, setBandscopeAxisYWidth] = useState(60);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

    // Rolling window rate limiting
    const overflowRef = useRef(false);
    const lastAllowedUpdateRef = useRef(0);
    const allowedIntervalRef = useRef(1000 / fftDataOverflowLimit);

    // Rolling window for rate tracking and track last 1 second of timestamps
    const timestampWindowRef = useRef([]);
    const windowSizeMs = 1000;

    // Note: Playback timing refs (playbackElapsedSecondsRef, playbackRemainingSecondsRef,
    // playbackTotalSecondsRef) are now passed as props from parent component

    // Use event handlers hook
    const {
        handleZoomIn,
        handleZoomOut,
        handleZoomReset,
        toggleRotatorDottedLines,
        handleSetAutoScalePreset
    } = useWaterfallEventHandlers({
        waterfallControlRef,
        workerRef,
        dispatch,
        setShowRotatorDottedLines,
        setAutoScalePreset
    });

    // Use snapshot handlers hook
    const snapshotNameGenerator = useCallback(() => {
        return generateSnapshotName(targetSatelliteName, centerFrequency);
    }, [targetSatelliteName, centerFrequency]);

    const {
        captureSnapshotWithOverlay,
        takeSnapshot
    } = useSnapshotHandlers({
        captureSnapshot,
        generateSnapshotName: snapshotNameGenerator,
        socket,
        dispatch,
        saveWaterfallSnapshot
    });

    // Wrap takeSnapshot to pass setShowSnapshotOverlay
    const handleTakeSnapshot = useCallback(async () => {
        await takeSnapshot(setShowSnapshotOverlay);
    }, [takeSnapshot]);

    // Wrap captureSnapshotWithOverlay to pass setShowSnapshotOverlay
    const handleCaptureSnapshotWithOverlay = useCallback(async (targetWidth = 1620) => {
        return await captureSnapshotWithOverlay(setShowSnapshotOverlay, targetWidth);
    }, [captureSnapshotWithOverlay]);

    // Expose the capture function with overlay globally for use by other components
    useEffect(() => {
        window.captureWaterfallSnapshotWithOverlay = handleCaptureSnapshotWithOverlay;
        return () => {
            delete window.captureWaterfallSnapshotWithOverlay;
        };
    }, [handleCaptureSnapshotWithOverlay]);

    // Expose waterfall zoom and pan transform values globally for real-time access
    useEffect(() => {
        window.getWaterfallTransform = () => {
            const scale = waterfallControlRef.current?.getCurrentScale() || 1;
            const positionX = waterfallControlRef.current?.getCurrentPosition() || 0;
            const containerWidth = waterfallControlRef.current?.getContainerWidth() || waterFallVisualWidth;
            const canvasWidth = waterFallCanvasWidth;

            // Calculate Hz per container pixel at current zoom
            const hzPerContainerPixel = sampleRate / (containerWidth * scale);

            // Calculate visible frequency range
            const startFreqOffset = -positionX * hzPerContainerPixel;
            const endFreqOffset = startFreqOffset + (containerWidth * hzPerContainerPixel);

            const startFreq = centerFrequency - (sampleRate / 2) + startFreqOffset;
            const endFreq = centerFrequency - (sampleRate / 2) + endFreqOffset;
            const visibleBandwidth = endFreq - startFreq;

            return {
                scale,
                positionX,
                containerWidth,
                canvasWidth,
                startFreq,
                endFreq,
                visibleBandwidth,
                centerFrequency,
                sampleRate
            };
        };
        return () => {
            delete window.getWaterfallTransform;
        };
    }, [centerFrequency, sampleRate, waterFallVisualWidth, waterFallCanvasWidth]);

    const toggleFullscreen = useCallback(() => {
        toggleFullscreenUtil(mainWaterFallContainer.current, setIsFullscreen);
    }, []);

    useEffect(() => {
        if (waterfallRendererMode !== 'worker' || !workerRef.current || !lastRotatorEvent) {
            return;
        }

        // Post only on event transitions, not on mount/remount with the same key.
        if (lastRotatorEventRef.current === lastRotatorEvent) {
            return;
        }

        // Format event with decorative dashes for waterfall display
        const formattedEvent = getRotatorEventDisplay(lastRotatorEvent);
        workerRef.current.postMessage({
            cmd: 'rotatorEvent',
            event: formattedEvent,
        });
        lastRotatorEventRef.current = lastRotatorEvent;
    }, [lastRotatorEvent, waterfallRendererMode, workerRef]);

    useEffect(() => {
        if (waterfallRendererMode !== 'dom-tiles') {
            if (domTileRendererRef.current) {
                domTileRendererRef.current.destroy();
                domTileRendererRef.current = null;
            }
            return;
        }

        if (!waterFallTileCanvasARef.current || !waterFallTileCanvasBRef.current) {
            return;
        }

        const renderer = createDomTileWaterfallRenderer({
            canvasA: waterFallTileCanvasARef.current,
            canvasB: waterFallTileCanvasBRef.current,
            width: waterFallCanvasWidth,
            height: waterFallCanvasHeight,
            colorMap,
            dbRange,
            backgroundColor: theme.palette.background.default,
            onMetrics: (metrics) => {
                eventMetrics.current = metrics;
            },
        });

        domTileRendererRef.current = renderer;

        return () => {
            if (domTileRendererRef.current) {
                domTileRendererRef.current.destroy();
                domTileRendererRef.current = null;
            }
        };
    }, [waterfallRendererMode, waterFallCanvasWidth, waterFallCanvasHeight]);

    useEffect(() => {
        if (waterfallRendererMode !== 'dom-tiles') {
            if (bandscopeTimerRef.current) {
                clearInterval(bandscopeTimerRef.current);
                bandscopeTimerRef.current = null;
            }
            drawDomBandscopeRef.current = null;
            return;
        }

        const bandscopeCanvas = bandscopeCanvasRef.current;
        const dBAxisCanvas = dBAxisScopeCanvasRef.current;
        if (!bandscopeCanvas || !dBAxisCanvas) {
            return;
        }

        const bandscopeCtx = bandscopeCanvas.getContext('2d', {
            alpha: true,
            desynchronized: true,
            willReadFrequently: false,
        });
        const dBAxisCtx = dBAxisCanvas.getContext('2d', {
            alpha: true,
            desynchronized: true,
            willReadFrequently: false,
        });

        if (!bandscopeCtx || !dBAxisCtx) {
            return;
        }

        bandscopeCtx.imageSmoothingEnabled = true;
        bandscopeCtx.imageSmoothingQuality = 'high';
        dBAxisCtx.imageSmoothingEnabled = true;
        dBAxisCtx.imageSmoothingQuality = 'high';

        domFftHistoryRef.current = [];
        domSmoothedFftRef.current = [];

        const smoothingConfig = getSmoothingConfig(bandscopeSmoothing);
        const smoothingType = smoothingConfig.smoothingType;
        const smoothingStrength = smoothingConfig.smoothingStrength;
        const maxFftHistoryLength = smoothingConfig.historyLength;

        const drawTick = () => {
            const fftData = latestDomFftRef.current;
            if (!fftData || fftData.length === 0) {
                return;
            }

            const smoothResult = updateSmoothedFftData(
                fftData,
                domFftHistoryRef.current,
                domSmoothedFftRef.current,
                smoothingType,
                smoothingStrength,
                maxFftHistoryLength
            );
            domFftHistoryRef.current = smoothResult.fftHistory;
            domSmoothedFftRef.current = smoothResult.smoothedFftData;

            drawBandscopeModule({
                bandscopeCtx,
                bandscopeCanvas,
                fftData,
                smoothedFftData: domSmoothedFftRef.current,
                dbRange,
                colorMap,
                zoomScale: waterFallScaleX,
                theme: {
                    palette: {
                        background: {
                            default: theme.palette.background.default,
                            paper: theme.palette.background.paper,
                            elevated: theme.palette.background.elevated,
                        },
                        border: {
                            main: theme.palette.border.main,
                            light: theme.palette.border.light,
                            dark: theme.palette.border.dark,
                        },
                        overlay: {
                            light: theme.palette.overlay.light,
                            medium: theme.palette.overlay.medium,
                            dark: theme.palette.overlay.dark,
                        },
                        text: {
                            primary: theme.palette.text.primary,
                            secondary: theme.palette.text.secondary,
                        }
                    }
                },
                dBAxisCtx,
                dBAxisCanvas
            });
        };

        drawDomBandscopeRef.current = drawTick;

        if (bandscopeRateLimitEnabled) {
            bandscopeTimerRef.current = setInterval(drawTick, 200);
        }

        return () => {
            if (bandscopeTimerRef.current) {
                clearInterval(bandscopeTimerRef.current);
                bandscopeTimerRef.current = null;
            }
            drawDomBandscopeRef.current = null;
        };
    }, [
        waterfallRendererMode,
        bandscopeRateLimitEnabled,
        dbRange,
        colorMap,
        waterFallScaleX,
        bandscopeSmoothing,
        theme.palette.background,
        theme.palette.border,
        theme.palette.overlay,
        theme.palette.text,
    ]);

    useEffect(() => {
        if (waterfallRendererMode !== 'dom-tiles' || !domTileRendererRef.current) {
            return;
        }

        domTileRendererRef.current.setConfig({
            colorMap,
            dbRange,
            backgroundColor: theme.palette.background.default,
        });
    }, [waterfallRendererMode, colorMap, dbRange, theme.palette.background.default]);

    const handleWorkerMessage = useCallback((event) => {
        const { type, data } = event.data;

        if (type === 'metrics') {
            eventMetrics.current = data;
        } else if (type === 'status') {
            // Optional: handle status updates from the worker
        } else if (type === 'autoScaleResult') {
            const { dbRange, stats } = data;
            console.log('New dB range:', dbRange);
            console.log('Analysis stats:', stats);
            dispatch(setDbRange(dbRange));
        } else if (type === 'waterfallCaptured') {
            // Convert blob to data URL in main thread
            const blob = data.blob;
            const reader = new FileReader();
            reader.onloadend = function() {
                window.waterfallCanvasDataURL = reader.result;
            };
            reader.onerror = function(error) {
                console.error('FileReader error:', error);
                window.waterfallCanvasDataURL = null;
            };
            reader.readAsDataURL(blob);
        } else if (type === 'waterfallCaptureFailed') {
            console.error('Waterfall capture failed:', data?.error);
            window.waterfallCanvasDataURL = null;
        }
    }, [dispatch]);

    useEffect(() => {
        if (waterfallRendererMode !== 'worker') {
            return;
        }
        return subscribeToWorkerMessages(handleWorkerMessage);
    }, [waterfallRendererMode, subscribeToWorkerMessages, handleWorkerMessage]);

    useEffect(() => {
        if (waterfallRendererMode !== 'worker' || !waterFallCanvasRef.current || canvasTransferredRef.current) {
            return;
        }

        const attached = attachCanvases({
            waterFallCanvasRef,
            bandscopeCanvasRef,
            dBAxisScopeCanvasRef,
            waterFallLeftMarginCanvasRef,
            config: {
                width: waterFallCanvasWidth,
                height: waterFallCanvasHeight,
                colorMap,
                dbRange,
                fftSize,
                showRotatorDottedLines,
                bandscopeRateLimitEnabled,
                timezone,
                theme: {
                    palette: {
                        background: {
                            default: theme.palette.background.default,
                            paper: theme.palette.background.paper,
                            elevated: theme.palette.background.elevated,
                        },
                        border: {
                            main: theme.palette.border.main,
                            light: theme.palette.border.light,
                            dark: theme.palette.border.dark,
                        },
                        overlay: {
                            light: theme.palette.overlay.light,
                            medium: theme.palette.overlay.medium,
                            dark: theme.palette.overlay.dark,
                        },
                        text: {
                            primary: theme.palette.text.primary,
                            secondary: theme.palette.text.secondary,
                        }
                    }
                }
            },
        });

        if (!attached) {
            return;
        }

        canvasTransferredRef.current = true;

        if (workerRef.current) {
            workerRef.current.postMessage({
                cmd: 'setAutoScalePreset',
                preset: autoScalePreset,
            });
        }
    }, [
        waterfallRendererMode,
        waterFallCanvasWidth,
        waterFallCanvasHeight,
        colorMap,
        dbRange,
        fftSize,
        showRotatorDottedLines,
        bandscopeRateLimitEnabled,
        timezone,
        theme.palette.background,
        theme.palette.border,
        theme.palette.overlay,
        theme.palette.text,
        autoScalePreset,
        attachCanvases,
        workerRef,
    ]);

    useEffect(() => {
        if (waterfallRendererMode === 'worker') {
            return;
        }
        if (!canvasTransferredRef.current) {
            return;
        }
        detachCanvases();
        canvasTransferredRef.current = false;
    }, [waterfallRendererMode, detachCanvases]);

    useEffect(() => {
        return () => {
            // Do not detach/reset worker canvas binding on unmount here.
            // OffscreenCanvas transfer is one-shot per HTMLCanvasElement and React dev
            // StrictMode can run passive effect cleanup+setup cycles on mount, which
            // would otherwise trigger a second transfer and freeze rendering.
        };
    }, []);

    // Add event listener for fullscreen change
    useEffect(() => {
        return setupFullscreenListeners(setIsFullscreen);
    }, []);

    // Add event listener for waterfall canvas capture
    useEffect(() => {
        if (waterfallRendererMode !== 'worker') return;
        return setupCanvasCaptureListener(workerRef);
    }, [waterfallRendererMode]);

    // Paint the waterfall left margin filler canvas with background color
    useEffect(() => {
        paintLeftMarginFiller(waterFallLeftMarginFillerRef.current, theme.palette.background.paper);
    }, [theme.palette.background.paper, bandscopeAxisYWidth]);

    // Update refs when Redux state changes
    useEffect(() => {
        centerFrequencyRef.current = centerFrequency;
    }, [centerFrequency]);

    useEffect(() => {
        sampleRateRef.current = sampleRate;
    }, [sampleRate]);

    // ResizeObserver for the main waterfall container
    useEffect(() => {
        if (!mainWaterFallContainer.current) {
            return;
        }
        const resizeObserver = new ResizeObserver(entries => {
            const {contentRect} = entries[0];
            // In fullscreen, use window dimensions; otherwise use observed dimensions
            if (document.fullscreenElement === mainWaterFallContainer.current) {
                setDimensions({width: window.innerWidth, height: window.innerHeight});
            } else {
                setDimensions({width: contentRect.width, height: contentRect.height});
            }
        });

        // Observe parent element for normal mode sizing
        const targetElement = mainWaterFallContainer.current.parentElement;
        if (targetElement) {
            resizeObserver.observe(targetElement);
        }

        // Also listen for fullscreen changes
        const handleFullscreenChange = () => {
            if (document.fullscreenElement === mainWaterFallContainer.current) {
                setDimensions({width: window.innerWidth, height: window.innerHeight});
            } else if (mainWaterFallContainer.current?.parentElement) {
                const rect = mainWaterFallContainer.current.parentElement.getBoundingClientRect();
                setDimensions({width: rect.width, height: rect.height});
            }
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);

        return () => {
            resizeObserver.disconnect();
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        };
    }, []);

    // Update the ref whenever the Redux state changes
    useEffect(() => {
        targetFPSRef.current = targetFPS;
    }, [targetFPS]);

    // Effect to sync state to the ref
    useEffect(() => {
        visualSettingsRef.current.dbRange = dbRange;
        visualSettingsRef.current.colorMap = colorMap;
        visualSettingsRef.current.sampleRate = sampleRate;
        visualSettingsRef.current.centerFrequency = centerFrequency;

    }, [dbRange, colorMap, centerFrequency, sampleRate]);

    // Get audio context for proactive resume on stream start
    const { getAudioState, initializeAudio } = useAudio();

    const handleDomTileFftData = useCallback((fftData) => {
        if (waterfallRendererMode !== 'dom-tiles' || !domTileRendererRef.current) {
            return;
        }
        latestDomFftRef.current = fftData;
        domTileRendererRef.current.pushFrame(fftData);
        if (!bandscopeRateLimitEnabled && drawDomBandscopeRef.current) {
            drawDomBandscopeRef.current();
        }
    }, [waterfallRendererMode, bandscopeRateLimitEnabled]);

    const { startStreaming, stopStreaming, playButtonEnabledOrNot, takeoverDialog } = useWaterfallStream({
        workerRef,
        waterfallRendererMode,
        onDomTileFftData: handleDomTileFftData,
        targetFPSRef,
        playbackElapsedSecondsRef,
        playbackRemainingSecondsRef,
        playbackTotalSecondsRef,
        getAudioState,
        initializeAudio
    });

    useEffect(() => {
        if (waterfallRendererMode !== 'worker') return;
        if (!workerRef.current) return;

        workerRef.current.postMessage({
            cmd: 'updateConfig',
            colorMap,
            dbRange,
            fftSize,
            zoomScale: waterFallScaleX,
            bandscopeRateLimitEnabled,
            timezone,
            theme: {
                palette: {
                    background: {
                        default: theme.palette.background.default,
                        paper: theme.palette.background.paper,
                        elevated: theme.palette.background.elevated,
                    },
                    border: {
                        main: theme.palette.border.main,
                        light: theme.palette.border.light,
                        dark: theme.palette.border.dark,
                    },
                    overlay: {
                        light: theme.palette.overlay.light,
                        medium: theme.palette.overlay.medium,
                        dark: theme.palette.overlay.dark,
                    },
                    text: {
                        primary: theme.palette.text.primary,
                        secondary: theme.palette.text.secondary,
                    }
                }
            }
        });
    }, [
        waterfallRendererMode,
        colorMap,
        dbRange,
        fftSize,
        waterFallScaleX,
        bandscopeRateLimitEnabled,
        timezone,
        theme.palette.background,
        theme.palette.border,
        theme.palette.overlay,
        theme.palette.text,
    ]);

    useEffect(() => {
        if (waterfallRendererMode !== 'worker') return;
        if (!workerRef.current) return;
        workerRef.current.postMessage({
            cmd: 'setAutoScalePreset',
            preset: autoScalePreset,
        });
    }, [waterfallRendererMode, autoScalePreset]);

    // Call this periodically, for example:
    useEffect(() => {
        let interval;

        if (waterfallRendererMode === 'worker' && isStreaming && autoDBRange) {
            interval = setInterval(() => {
                workerRef.current.postMessage({ cmd: 'autoScaleDbRange' });
            }, 2000); // Update 2 seconds
        }

        return () => {
            if (interval) {
                clearInterval(interval);
            }
        };
    }, [waterfallRendererMode, isStreaming, autoDBRange]);

    const toggleLeftSide = useCallback(() => {
        dispatch(setShowLeftSideWaterFallAccessories(!showLeftSideWaterFallAccessories));
    }, [dispatch, showLeftSideWaterFallAccessories]);

    const toggleRightSide = useCallback(() => {
        dispatch(setShowRightSideWaterFallAccessories(!showRightSideWaterFallAccessories));
    }, [dispatch, showRightSideWaterFallAccessories]);

    const toggleAutoRange = useCallback(() => {
        dispatch(setAutoDBRange(!autoDBRange));
    }, [dispatch, autoDBRange]);

    const autoScale = useCallback(() => {
        if (workerRef.current) {
            workerRef.current.postMessage({ cmd: 'autoScaleDbRange' });
        }
    }, []);

    const handleToggleVfo = useCallback((index) => {
        if (vfoActive[index]) {
            dispatch(setVfoInactive(index));
        } else {
            dispatch(setVfoActive(index));
        }
    }, [dispatch, vfoActive]);

    const isPlaybackStreaming = isStreaming && selectedSDRId === 'sigmf-playback';
    const [playbackTimeline, setPlaybackTimeline] = useState({
        elapsedSeconds: 0,
        remainingSeconds: 0,
        totalSeconds: 0,
    });
    const [isPlaybackSeeking, setIsPlaybackSeeking] = useState(false);
    const [isPlaybackPointerDown, setIsPlaybackPointerDown] = useState(false);
    const [pendingPlaybackSeekSeconds, setPendingPlaybackSeekSeconds] = useState(null);

    useEffect(() => {
        if (!isPlaybackStreaming) {
            setPlaybackTimeline({ elapsedSeconds: 0, remainingSeconds: 0, totalSeconds: 0 });
            setIsPlaybackSeeking(false);
            setIsPlaybackPointerDown(false);
            setPendingPlaybackSeekSeconds(null);
            return;
        }

        const updatePlaybackTimeline = () => {
            const elapsedRaw = Number(playbackElapsedSecondsRef?.current);
            const remainingRaw = Number(playbackRemainingSecondsRef?.current);
            const totalRaw = Number(playbackTotalSecondsRef?.current);

            const totalSeconds = Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : 0;
            const elapsedSeconds = Number.isFinite(elapsedRaw) && elapsedRaw >= 0
                ? Math.min(elapsedRaw, totalSeconds || elapsedRaw)
                : 0;
            const remainingSeconds = Number.isFinite(remainingRaw) && remainingRaw >= 0
                ? remainingRaw
                : Math.max(totalSeconds - elapsedSeconds, 0);

            setPlaybackTimeline((prev) => {
                if (
                    Math.abs(prev.elapsedSeconds - elapsedSeconds) < 0.01 &&
                    Math.abs(prev.remainingSeconds - remainingSeconds) < 0.01 &&
                    Math.abs(prev.totalSeconds - totalSeconds) < 0.01
                ) {
                    return prev;
                }
                return { elapsedSeconds, remainingSeconds, totalSeconds };
            });

            // Keep the slider pinned at the requested position while waiting for backend seek.
            if (
                !isPlaybackSeeking &&
                pendingPlaybackSeekSeconds !== null &&
                Math.abs(elapsedSeconds - pendingPlaybackSeekSeconds) <= 1
            ) {
                setPendingPlaybackSeekSeconds(null);
            }
        };

        updatePlaybackTimeline();

        let rafId = 0;
        let lastTs = 0;
        const tick = (ts) => {
            if (document.hidden) {
                rafId = requestAnimationFrame(tick);
                return;
            }
            if (ts - lastTs >= PLAYBACK_TIMELINE_UPDATE_MS) {
                lastTs = ts;
                updatePlaybackTimeline();
            }
            rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);

        return () => cancelAnimationFrame(rafId);
    }, [
        isPlaybackStreaming,
        isPlaybackSeeking,
        pendingPlaybackSeekSeconds,
        playbackElapsedSecondsRef,
        playbackRemainingSecondsRef,
        playbackTotalSecondsRef,
    ]);

    const playbackHasDuration = playbackTimeline.totalSeconds > 0;
    const playbackLiveElapsedSeconds = playbackHasDuration
        ? Math.min(playbackTimeline.elapsedSeconds, playbackTimeline.totalSeconds)
        : 0;
    const playbackSliderSeconds =
        pendingPlaybackSeekSeconds !== null ? pendingPlaybackSeekSeconds : playbackLiveElapsedSeconds;
    const playbackSliderProgressPercent = playbackHasDuration
        ? (playbackSliderSeconds / playbackTimeline.totalSeconds) * 100
        : 0;
    const playbackLabelPositionPercent = playbackSliderProgressPercent;
    const playbackOverlayLeftInset =
        (showLeftSideWaterFallAccessories ? bandscopeAxisYWidth : 0) + PLAYBACK_OVERLAY_SIDE_GAP;
    const playbackOverlayRightInset =
        (showRightSideWaterFallAccessories ? WATERFALL_RIGHT_SIDEBAR_WIDTH : 0) + PLAYBACK_OVERLAY_SIDE_GAP;

    useEffect(() => {
        if (!isPlaybackPointerDown) {
            return undefined;
        }

        const handlePointerUp = () => {
            setIsPlaybackPointerDown(false);
        };

        window.addEventListener('mouseup', handlePointerUp);
        window.addEventListener('touchend', handlePointerUp);
        window.addEventListener('touchcancel', handlePointerUp);

        return () => {
            window.removeEventListener('mouseup', handlePointerUp);
            window.removeEventListener('touchend', handlePointerUp);
            window.removeEventListener('touchcancel', handlePointerUp);
        };
    }, [isPlaybackPointerDown]);

    const handlePlaybackPointerDown = useCallback((event) => {
        event?.stopPropagation?.();
        if (!playbackHasDuration) {
            return;
        }
        setIsPlaybackPointerDown(true);
    }, [playbackHasDuration]);

    const handlePlaybackPointerUp = useCallback((event) => {
        event?.stopPropagation?.();
        setIsPlaybackPointerDown(false);
    }, []);

    const handlePlaybackSeekChange = useCallback((event, value) => {
        event?.stopPropagation?.();
        if (!playbackHasDuration) {
            return;
        }
        const nextValue = Array.isArray(value) ? value[0] : value;
        if (!Number.isFinite(nextValue)) {
            return;
        }
        const clampedSeconds = Math.max(0, Math.min(nextValue, playbackTimeline.totalSeconds));
        setIsPlaybackSeeking(true);
        setPendingPlaybackSeekSeconds(clampedSeconds);
    }, [playbackHasDuration, playbackTimeline.totalSeconds]);

    const handlePlaybackSeekCommit = useCallback((event, value) => {
        event?.stopPropagation?.();
        setIsPlaybackSeeking(false);

        if (!playbackHasDuration || !socket || !isPlaybackStreaming) {
            setPendingPlaybackSeekSeconds(null);
            return;
        }

        const nextValue = Array.isArray(value) ? value[0] : value;
        if (!Number.isFinite(nextValue)) {
            setPendingPlaybackSeekSeconds(null);
            return;
        }

        const clampedSeconds = Math.max(0, Math.min(nextValue, playbackTimeline.totalSeconds));
        if (Math.abs(clampedSeconds - playbackLiveElapsedSeconds) < 0.05) {
            setPendingPlaybackSeekSeconds(null);
            return;
        }

        setPendingPlaybackSeekSeconds(clampedSeconds);

        socket.emit(
            "api.call",
            {
                cmd: "sdr.seek-playback",
                data: {
                    selectedSDRId: 'sigmf-playback',
                    positionSeconds: clampedSeconds,
                },
            },
            (response) => {
                if (!response?.success) {
                    setPendingPlaybackSeekSeconds(null);
                    toast.error(
                        response?.error || response?.message || 'Failed to seek playback'
                    );
                }
            }
        );
    }, [
        isPlaybackStreaming,
        playbackHasDuration,
        playbackLiveElapsedSeconds,
        playbackTimeline.totalSeconds,
        socket,
    ]);

    return (
        <div ref={mainWaterFallContainer}>
        <TitleBar
            className={getClassNamesBasedOnGridEditing(gridEditable, ["window-title-bar"])}
        >
            <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%'}}>
                <Box sx={{display: 'flex', alignItems: 'center'}}>
                    <Typography variant="subtitle2" sx={{fontWeight: 'bold'}}>
                        {t('main_title')}
                    </Typography>
                </Box>
            </Box>
        </TitleBar>
            <Box
                sx={{
                    display: 'flex',
                    gap: 1,
                    justifyContent: 'left',
                    flexWrap: 'wrap',
                }}
            >
                <WaterfallToolbar
                    startStreamingLoading={startStreamingLoading}
                    playButtonDisabled={playButtonEnabledOrNot()}
                    startStreaming={startStreaming}
                    stopStreaming={stopStreaming}
                    isStreaming={isStreaming}
                    showLeftSideWaterFallAccessories={showLeftSideWaterFallAccessories}
                    toggleLeftSideWaterFallAccessories={toggleLeftSide}
                    showRightSideWaterFallAccessories={showRightSideWaterFallAccessories}
                    toggleRightSideWaterFallAccessories={toggleRightSide}
                    autoDBRange={autoDBRange}
                    toggleAutoDBRange={toggleAutoRange}
                    autoScale={autoScale}
                    toggleFullscreen={toggleFullscreen}
                    isFullscreen={isFullscreen}
                    handleZoomIn={handleZoomIn}
                    handleZoomOut={handleZoomOut}
                    handleZoomReset={handleZoomReset}
                    vfoColors={vfoColors}
                    vfoActive={vfoActive}
                    toggleVfo={handleToggleVfo}
                    takeSnapshot={handleTakeSnapshot}
                    fftDataOverflow={fftDataOverflow}
                    showRotatorDottedLines={showRotatorDottedLines}
                    toggleRotatorDottedLines={toggleRotatorDottedLines}
                    setAutoScalePreset={handleSetAutoScalePreset}
                />
            </Box>

            {/* Container for both bandscope and waterfall */}

            <Box
                sx={{
                    width: '100%',
                    height: '100%',
                    bgcolor: theme.palette.background.default,
                    position: 'relative',
                    borderRadius: 1,

                }}
            >
                <Box sx={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'row',
                    position: 'relative',
                }}>
                    {/* Snapshot overlay - covers entire waterfall content area */}
                    <Fade in={showSnapshotOverlay}>
                        <Box
                            sx={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                right: 0,
                                bottom: 0,
                                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                                zIndex: 1000,
                                pointerEvents: 'none',
                            }}
                        >
                        </Box>
                    </Fade>

                    {/* Left column - Y-axis canvases */}
                    <Box
                        className={"left-vertical-bar"}
                        sx={{
                            width: bandscopeAxisYWidth,
                            minWidth: bandscopeAxisYWidth,
                            maxWidth: bandscopeAxisYWidth,
                            height: '1000px',
                            position: 'relative',
                            //borderRight: '1px solid rgba(255, 255, 255, 0.2)',
                            display: showLeftSideWaterFallAccessories ? 'inherit' : 'none',
                            flexDirection: 'column',
                            flexShrink: 0,
                        }}
                    >
                        <canvas
                            ref={dBAxisScopeCanvasRef}
                            width={bandscopeAxisYWidth}
                            height={bandScopeHeight + bandscopeTopPadding}
                            style={{
                                width: '100%',
                                height: `${bandScopeHeight + bandscopeTopPadding}px`,
                                backgroundColor: theme.palette.background.elevated,
                                display: 'block',
                                transform: 'translateZ(0)',
                                backfaceVisibility: 'hidden',
                                perspective: '1000px',
                                borderRight: `1px solid ${theme.palette.border.light}`,
                            }}
                        />
                        <canvas
                            ref={waterFallLeftMarginFillerRef}
                            className={"waterfall-left-margin-filler"}
                            width={bandscopeAxisYWidth}
                            height={21}
                            style={{
                                width: '100%',
                                height: '21px',
                                backgroundColor: theme.palette.background.paper,
                                borderTop: `1px solid ${theme.palette.border.main}`,
                                borderRight: `1px solid ${theme.palette.border.light}`,
                                display: 'block',
                                transform: 'translateZ(0)',
                                backfaceVisibility: 'hidden',
                                perspective: '1000px',
                            }}
                        />
                        <canvas
                            className={"waterfall-left-margin-canvas"}
                            ref={waterFallLeftMarginCanvasRef}
                            width={bandscopeAxisYWidth}
                            height={waterFallCanvasHeight}
                            style={{
                                width: '100%',
                                //height: `${dimensions['height'] - 230}px`,
                                height: `${waterFallCanvasHeight}px`,
                                display: 'block',
                                backgroundColor: theme.palette.background.paper,
                                borderRight: `1px solid ${theme.palette.border.light}`,
                                transform: 'translateZ(0)',
                                backfaceVisibility: 'hidden',
                                perspective: '1000px',
                            }}

                        />
                    </Box>

                    {/* Main visualization canvases */}
                    <WaterfallAndBandscope
                        ref={waterfallControlRef}
                        bandscopeCanvasRef={bandscopeCanvasRef}
                        waterFallCanvasRef={waterFallCanvasRef}
                        waterFallTileCanvasARef={waterFallTileCanvasARef}
                        waterFallTileCanvasBRef={waterFallTileCanvasBRef}
                        waterfallRendererMode={waterfallRendererMode}
                        centerFrequency={centerFrequency}
                        sampleRate={sampleRate}
                        waterFallWindowHeight={dimensions['height']}
                        frequencyBands={frequencyBands}
                        playbackRemainingSecondsRef={playbackRemainingSecondsRef}
                    />

                    <WaterfallRightSidebar
                        workerRef={workerRef}
                        waterfallControlRef={waterfallControlRef}
                        dimensions={dimensions}
                    />

                    {/* Decoded packets overlay - DISABLED */}
                    {/* <DecodedPacketsOverlay
                        containerWidth={dimensions.width}
                        showLeftSide={showLeftSideWaterFallAccessories}
                        showRightSide={showRightSideWaterFallAccessories}
                        leftSideWidth={bandscopeAxisYWidth}
                        rightSideWidth={50}
                    /> */}
                </Box>
            </Box>

            <WaterfallErrorDialog
                open={errorMessage !== '' && errorDialogOpen}
                message={errorMessage}
                onClose={() => dispatch(setErrorDialogOpen(false))}
            />
            {takeoverDialog}

            {/* Bottom status bar */}
            <Box
                sx={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    right: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    zIndex: 450,
                }}
            >
                {isPlaybackStreaming && playbackHasDuration && (
                    <Box
                        sx={{
                            position: 'absolute',
                            left: `${playbackOverlayLeftInset}px`,
                            right: `${playbackOverlayRightInset}px`,
                            bottom: `${WATERFALL_STATUS_BAR_HEIGHT + 6}px`,
                            py: 0.2,
                            zIndex: 2,
                        }}
                    >
                        <Box sx={{ position: 'relative', px: 0.9, pb: 1.5 }}>
                            <Slider
                                min={0}
                                max={playbackTimeline.totalSeconds}
                                step={0.1}
                                value={playbackSliderSeconds}
                                onMouseDown={handlePlaybackPointerDown}
                                onMouseUp={handlePlaybackPointerUp}
                                onTouchStart={handlePlaybackPointerDown}
                                onTouchEnd={handlePlaybackPointerUp}
                                onChange={handlePlaybackSeekChange}
                                onChangeCommitted={handlePlaybackSeekCommit}
                                size="medium"
                                aria-label="Playback position"
                                sx={{
                                    position: 'relative',
                                    zIndex: 2,
                                    color: '#ff0033',
                                    py: 0.35,
                                    '& .MuiSlider-rail': {
                                        height: 5,
                                        opacity: 1,
                                        backgroundColor: 'rgba(255, 255, 255, 0.35)',
                                        borderRadius: 999,
                                    },
                                    '& .MuiSlider-track': {
                                        height: 5,
                                        border: 'none',
                                        borderRadius: 999,
                                    },
                                    '& .MuiSlider-thumb': {
                                        width: isPlaybackSeeking ? 16 : 14,
                                        height: isPlaybackSeeking ? 16 : 14,
                                        zIndex: 3,
                                        borderRadius: '50%',
                                        backgroundColor: '#ff0033',
                                        boxShadow: '0 0 0 2px rgba(255, 255, 255, 0.9)',
                                        transition: 'all 120ms ease',
                                        '&::before': { boxShadow: 'none' },
                                        '&:hover, &.Mui-focusVisible, &.Mui-active': {
                                            boxShadow: '0 0 0 5px rgba(255, 0, 51, 0.22)',
                                        },
                                    },
                                }}
                            />
                            <Box
                                sx={{
                                    position: 'absolute',
                                    left: `${playbackLabelPositionPercent}%`,
                                    top: '-6px',
                                    transform: 'translate(-50%, -100%)',
                                    pointerEvents: 'none',
                                    zIndex: 1,
                                    fontSize: '0.76rem',
                                    fontFamily: 'monospace',
                                    fontWeight: 600,
                                    color: '#fff',
                                    px: 0.95,
                                    py: 0.2,
                                    borderRadius: 1,
                                    border: '1px solid rgba(255, 255, 255, 0.12)',
                                    backgroundColor: 'rgba(15, 15, 15, 0.82)',
                                    backdropFilter: 'blur(4px)',
                                }}
                            >
                                {formatPlaybackTime(playbackSliderSeconds)} / {formatPlaybackTime(playbackTimeline.totalSeconds)}
                            </Box>
                        </Box>
                    </Box>
                )}
                <WaterfallStatusBar isStreaming={isStreaming} eventMetrics={eventMetrics} centerFrequency={centerFrequency} sampleRate={sampleRate} gain={gain} />
            </Box>
        </div>
    );
});

export default MainWaterfallDisplay;
