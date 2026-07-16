import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { useSelector } from 'react-redux';
import { useSocket } from '../common/socket.jsx';
import { getSmoothingConfig } from './smoothing-presets.js';
import { getThemeConfig } from '../../themes/theme-configs.js';

const WaterfallEngineContext = createContext(null);

const FALLBACK_WORKER_THEME = {
    palette: {
        background: {
            default: '#121212',
            paper: '#1e1e1e',
            elevated: '#2a2a2a',
        },
        border: {
            main: '#424242',
            light: '#494949',
            dark: '#262626',
        },
        overlay: {
            light: 'rgba(255, 255, 255, 0.08)',
            medium: 'rgba(255, 255, 255, 0.12)',
            dark: 'rgba(0, 0, 0, 0.5)',
        },
        text: {
            primary: '#ffffff',
            secondary: 'rgba(255, 255, 255, 0.7)',
        },
    },
};

export const WaterfallEngineProvider = ({ children }) => {
    const { socket } = useSocket();
    const workerRef = useRef(null);
    const fftListenersRef = useRef(new Set());
    const workerMessageListenersRef = useRef(new Set());
    const headlessInitKeyRef = useRef('');

    const {
        waterfallRendererMode,
        isStreaming,
        waterFallCanvasWidth,
        waterFallCanvasHeight,
        colorMap,
        dbRange,
        fftSize,
        showRotatorDottedLines,
        autoScalePreset,
        bandscopeSmoothing,
        bandscopeRateLimitEnabled,
        targetFPS,
    } = useSelector((state) => ({
        waterfallRendererMode: state.waterfall.waterfallRendererMode,
        isStreaming: state.waterfall.isStreaming,
        waterFallCanvasWidth: state.waterfall.waterFallCanvasWidth,
        waterFallCanvasHeight: state.waterfall.waterFallCanvasHeight,
        colorMap: state.waterfall.colorMap,
        dbRange: state.waterfall.dbRange,
        fftSize: state.waterfall.fftSize,
        showRotatorDottedLines: state.waterfall.showRotatorDottedLines,
        autoScalePreset: state.waterfall.autoScalePreset,
        bandscopeSmoothing: state.waterfall.bandscopeSmoothing,
        bandscopeRateLimitEnabled: state.waterfall.bandscopeRateLimitEnabled,
        targetFPS: state.waterfall.targetFPS,
    }));

    const selectedThemeName = useSelector(
        (state) => state.preferences?.preferences?.find((pref) => pref.name === 'theme')?.value || 'dark'
    );

    const workerTheme = useMemo(() => {
        // The waterfall worker runs outside React/MUI context, so we pass an explicit
        // palette snapshot derived from current theme preferences.
        const config = getThemeConfig(selectedThemeName);
        const isDark = config.mode === 'dark';
        const background = config.background || FALLBACK_WORKER_THEME.palette.background;
        const border = config.border || FALLBACK_WORKER_THEME.palette.border;
        const overlay = config.overlay || FALLBACK_WORKER_THEME.palette.overlay;

        return {
            palette: {
                background: {
                    default: background.default || FALLBACK_WORKER_THEME.palette.background.default,
                    paper: background.paper || FALLBACK_WORKER_THEME.palette.background.paper,
                    elevated: background.elevated || FALLBACK_WORKER_THEME.palette.background.elevated,
                },
                border: {
                    main: border.main || FALLBACK_WORKER_THEME.palette.border.main,
                    light: border.light || FALLBACK_WORKER_THEME.palette.border.light,
                    dark: border.dark || FALLBACK_WORKER_THEME.palette.border.dark,
                },
                overlay: {
                    light: overlay.light || FALLBACK_WORKER_THEME.palette.overlay.light,
                    medium: overlay.medium || FALLBACK_WORKER_THEME.palette.overlay.medium,
                    dark: overlay.dark || FALLBACK_WORKER_THEME.palette.overlay.dark,
                },
                text: {
                    primary: isDark ? '#f8fafc' : '#0f172a',
                    secondary: isDark ? 'rgba(248, 250, 252, 0.72)' : 'rgba(15, 23, 42, 0.7)',
                },
            },
        };
    }, [selectedThemeName]);

    const timezone = useSelector((state) =>
        state.preferences?.preferences?.find((pref) => pref.name === 'timezone')?.value || 'UTC'
    );

    const notifyWorkerMessageListeners = useCallback((event) => {
        workerMessageListenersRef.current.forEach((listener) => {
            try {
                listener(event);
            } catch (error) {
                console.error('Worker message listener error:', error);
            }
        });
    }, []);

    const ensureWorker = useCallback(() => {
        if (workerRef.current) {
            return workerRef.current;
        }

        try {
            const worker = new Worker(
                new URL('./waterfall-worker.js', import.meta.url),
                { type: 'module' }
            );
            worker.onmessage = notifyWorkerMessageListeners;
            worker.onerror = (error) => {
                console.error('Waterfall worker error:', error);
            };
            workerRef.current = worker;
            headlessInitKeyRef.current = '';
            return worker;
        } catch (error) {
            console.error('Failed to create waterfall worker:', error);
            return null;
        }
    }, [notifyWorkerMessageListeners]);

    const postWorkerMessage = useCallback((message, transferables = undefined) => {
        const worker = ensureWorker();
        if (!worker) {
            return false;
        }

        if (transferables && transferables.length > 0) {
            worker.postMessage(message, transferables);
        } else {
            worker.postMessage(message);
        }

        return true;
    }, [ensureWorker]);

    const subscribeToFftData = useCallback((listener) => {
        if (typeof listener !== 'function') {
            return () => {};
        }

        fftListenersRef.current.add(listener);
        return () => {
            fftListenersRef.current.delete(listener);
        };
    }, []);

    const subscribeToWorkerMessages = useCallback((listener) => {
        if (typeof listener !== 'function') {
            return () => {};
        }

        workerMessageListenersRef.current.add(listener);
        return () => {
            workerMessageListenersRef.current.delete(listener);
        };
    }, []);

    const attachCanvases = useCallback(({
        waterFallCanvasRef,
        bandscopeCanvasRef,
        dBAxisScopeCanvasRef,
        waterFallLeftMarginCanvasRef,
        config,
    }) => {
        const worker = ensureWorker();
        if (!worker) {
            return false;
        }

        const waterfallCanvas = waterFallCanvasRef?.current;
        const bandscopeCanvas = bandscopeCanvasRef?.current;
        const dBAxisCanvas = dBAxisScopeCanvasRef?.current;
        const waterfallLeftMarginCanvas = waterFallLeftMarginCanvasRef?.current;

        if (!waterfallCanvas || !bandscopeCanvas || !dBAxisCanvas || !waterfallLeftMarginCanvas) {
            return false;
        }

        if (
            typeof waterfallCanvas.transferControlToOffscreen !== 'function' ||
            typeof bandscopeCanvas.transferControlToOffscreen !== 'function' ||
            typeof dBAxisCanvas.transferControlToOffscreen !== 'function' ||
            typeof waterfallLeftMarginCanvas.transferControlToOffscreen !== 'function'
        ) {
            console.warn('OffscreenCanvas transfer is not supported in this browser');
            return false;
        }

        try {
            const waterfallOffscreenCanvas = waterfallCanvas.transferControlToOffscreen();
            const bandscopeOffscreenCanvas = bandscopeCanvas.transferControlToOffscreen();
            const dBAxisOffscreenCanvas = dBAxisCanvas.transferControlToOffscreen();
            const waterfallLeftMarginOffscreenCanvas = waterfallLeftMarginCanvas.transferControlToOffscreen();

            worker.postMessage({
                cmd: 'initCanvas',
                waterfallCanvas: waterfallOffscreenCanvas,
                bandscopeCanvas: bandscopeOffscreenCanvas,
                dBAxisCanvas: dBAxisOffscreenCanvas,
                waterfallLeftMarginCanvas: waterfallLeftMarginOffscreenCanvas,
                config,
            }, [
                waterfallOffscreenCanvas,
                bandscopeOffscreenCanvas,
                dBAxisOffscreenCanvas,
                waterfallLeftMarginOffscreenCanvas,
            ]);

            return true;
        } catch (error) {
            // In React dev StrictMode, passive effects can be setup-cleanup-setup cycled
            // on the same mounted canvas node. Offscreen transfer is one-shot per canvas,
            // so a second transfer throws InvalidStateError. In that case the worker
            // should keep using the already-transferred canvases.
            if (
                error?.name === 'InvalidStateError' &&
                /more than one time/i.test(String(error?.message || ''))
            ) {
                console.warn('OffscreenCanvas already transferred for current canvas; reusing existing worker binding');
                return true;
            }
            console.error('Failed to attach OffscreenCanvas instances to waterfall worker:', error);
            return false;
        }
    }, [ensureWorker]);

    const detachCanvases = useCallback(() => {
        postWorkerMessage({ cmd: 'detachCanvases' });
    }, [postWorkerMessage]);

    useEffect(() => {
        const worker = ensureWorker();
        return () => {
            if (worker) {
                worker.terminate();
            }
            workerRef.current = null;
            headlessInitKeyRef.current = '';
        };
    }, [ensureWorker]);

    useEffect(() => {
        if (waterfallRendererMode !== 'worker') {
            return;
        }

        const initKey = `${waterFallCanvasWidth}:${waterFallCanvasHeight}:${fftSize}`;
        if (headlessInitKeyRef.current === initKey) {
            return;
        }

        const initialized = postWorkerMessage({
            cmd: 'initHeadless',
            config: {
                width: waterFallCanvasWidth,
                height: waterFallCanvasHeight,
                colorMap,
                dbRange,
                fftSize,
                showRotatorDottedLines,
                bandscopeRateLimitEnabled,
                timezone,
                theme: workerTheme,
            },
        });

        if (initialized) {
            headlessInitKeyRef.current = initKey;
            postWorkerMessage({ cmd: 'setAutoScalePreset', preset: autoScalePreset });
        }
    }, [
        autoScalePreset,
        colorMap,
        dbRange,
        fftSize,
        postWorkerMessage,
        showRotatorDottedLines,
        bandscopeRateLimitEnabled,
        timezone,
        workerTheme,
        waterfallRendererMode,
        waterFallCanvasHeight,
        waterFallCanvasWidth,
    ]);

    useEffect(() => {
        if (waterfallRendererMode !== 'worker') {
            return;
        }

        postWorkerMessage({
            cmd: 'updateConfig',
            colorMap,
            dbRange,
            fftSize,
            bandscopeRateLimitEnabled,
            timezone,
            theme: workerTheme,
        });
    }, [
        waterfallRendererMode,
        colorMap,
        dbRange,
        fftSize,
        bandscopeRateLimitEnabled,
        timezone,
        workerTheme,
        postWorkerMessage,
    ]);

    useEffect(() => {
        if (waterfallRendererMode !== 'worker') {
            return;
        }

        postWorkerMessage({ cmd: 'setAutoScalePreset', preset: autoScalePreset });
    }, [waterfallRendererMode, autoScalePreset, postWorkerMessage]);

    useEffect(() => {
        if (waterfallRendererMode !== 'worker') {
            return;
        }

        const smoothing = getSmoothingConfig(bandscopeSmoothing);
        postWorkerMessage({
            cmd: 'updateSmoothingConfig',
            historyLength: smoothing.historyLength,
            smoothingType: smoothing.smoothingType,
            smoothingStrength: smoothing.smoothingStrength,
        });
    }, [waterfallRendererMode, bandscopeSmoothing, postWorkerMessage]);

    useEffect(() => {
        if (waterfallRendererMode !== 'worker') {
            return;
        }

        if (isStreaming) {
            postWorkerMessage({ cmd: 'start', fps: targetFPS });
            return;
        }

        postWorkerMessage({ cmd: 'stop' });
    }, [waterfallRendererMode, isStreaming, targetFPS, postWorkerMessage]);

    useEffect(() => {
        if (waterfallRendererMode !== 'worker' || !isStreaming) {
            return;
        }

        postWorkerMessage({ cmd: 'updateFPS', fps: targetFPS });
    }, [waterfallRendererMode, isStreaming, targetFPS, postWorkerMessage]);

    useEffect(() => {
        if (!socket) {
            return;
        }

        const handleFftData = (payload) => {
            const binaryData = payload?.data || payload;
            if (!binaryData) {
                return;
            }

            const floatArray = binaryData instanceof Float32Array
                ? binaryData
                : new Float32Array(binaryData);

            const frame = {
                fft: floatArray,
                recordingDatetime: payload?.recording_datetime || null,
                playbackElapsedSeconds: payload?.playback_elapsed_seconds || null,
                playbackRemainingSeconds: payload?.playback_remaining_seconds || null,
                playbackTotalSeconds: payload?.playback_total_seconds || null,
            };

            fftListenersRef.current.forEach((listener) => {
                try {
                    listener(frame);
                } catch (error) {
                    console.error('FFT listener error:', error);
                }
            });

            if (waterfallRendererMode === 'worker') {
                const worker = ensureWorker();
                if (worker) {
                    worker.postMessage({
                        cmd: 'updateFFTData',
                        fft: floatArray,
                        recording_datetime: frame.recordingDatetime,
                        playback_elapsed_seconds: frame.playbackElapsedSeconds,
                        playback_remaining_seconds: frame.playbackRemainingSeconds,
                        playback_total_seconds: frame.playbackTotalSeconds,
                        immediate: true,
                    }, [floatArray.buffer]);
                }
            }
        };

        socket.on('sdr-fft-data', handleFftData);
        return () => {
            socket.off('sdr-fft-data', handleFftData);
        };
    }, [ensureWorker, socket, waterfallRendererMode]);

    const value = useMemo(() => ({
        workerRef,
        postWorkerMessage,
        attachCanvases,
        detachCanvases,
        subscribeToFftData,
        subscribeToWorkerMessages,
    }), [
        attachCanvases,
        detachCanvases,
        postWorkerMessage,
        subscribeToFftData,
        subscribeToWorkerMessages,
    ]);

    return (
        <WaterfallEngineContext.Provider value={value}>
            {children}
        </WaterfallEngineContext.Provider>
    );
};

export const useWaterfallEngine = () => {
    const context = useContext(WaterfallEngineContext);
    if (!context) {
        throw new Error('useWaterfallEngine must be used within WaterfallEngineProvider');
    }
    return context;
};
