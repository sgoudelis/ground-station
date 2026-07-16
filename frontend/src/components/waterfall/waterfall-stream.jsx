import { useEffect, useRef, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useSocket } from '../common/socket.jsx';
import { useWaterfallEngine } from './waterfall-engine-provider.jsx';
import {
    setIsStreaming,
    setErrorMessage,
    setStartStreamingLoading,
    setFFTdataOverflow,
    setExpandedPanels,
    setStartStreamValidationErrors,
    clearStartStreamValidationErrors,
    stopRecording
} from './waterfall-slice.jsx';
import { toast } from '../../utils/toast-with-timestamp.jsx';
import { useSdrTakeoverDialog } from './use-sdr-takeover-dialog.jsx';

const useWaterfallStream = ({
    workerRef,
    waterfallRendererMode = 'worker',
    onDomTileFftData,
    targetFPSRef,
    playbackElapsedSecondsRef,
    playbackRemainingSecondsRef,
    playbackTotalSecondsRef,
    getAudioState,
    initializeAudio
}) => {
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const { subscribeToFftData } = useWaterfallEngine();
    const {
        selectedSDRId,
        centerFrequency,
        sampleRate,
        gain,
        fftSize,
        sdrSettingsById,
        fftWindow,
        fftOverlapPercent,
        fftOverlapDepth,
        selectedAntenna,
        selectedOffsetValue,
        fftAveraging,
        isStreaming,
        gettingSDRParameters,
        autoDBRange,
        playbackRecordingPath,
        isRecording,
        expandedPanels,
    } = useSelector((state) => state.waterfall);

    const biasT = sdrSettingsById?.[selectedSDRId]?.draft?.biasT ?? false;
    const tunerAgc = sdrSettingsById?.[selectedSDRId]?.draft?.tunerAgc ?? false;
    const rtlAgc = sdrSettingsById?.[selectedSDRId]?.draft?.rtlAgc ?? false;
    const soapyAgc = sdrSettingsById?.[selectedSDRId]?.draft?.soapyAgc ?? false;
    const { requestTakeoverConfirmation, takeoverDialog } = useSdrTakeoverDialog({
        defaultSdrId: selectedSDRId,
    });

    const {
        vfoActive,
    } = useSelector((state) => state.vfo);

    const animationFrameRef = useRef(null);
    const bandscopeAnimationFrameRef = useRef(null);
    const timestampWindowRef = useRef([]);
    const overflowRef = useRef(false);
    const allowedIntervalRef = useRef(0);
    const lastAllowedUpdateRef = useRef(0);
    const windowSizeMs = 1000;
    const fftDataOverflowLimit = 60;

    const cancelAnimations = useCallback(() => {
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
        }
        if (bandscopeAnimationFrameRef.current) {
            cancelAnimationFrame(bandscopeAnimationFrameRef.current);
            bandscopeAnimationFrameRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (!socket) {
            return;
        }

        // Note: sdr-config-error, sdr-error, sdr-config, and sdr-status are now handled
        // in the parent-level socket event handler (hooks/useSocketEventHandlers.jsx)
        // to ensure messages are always received even when this component unmounts

        const handleDisconnect = () => {
            cancelAnimations();
            dispatch(setIsStreaming(false));
        };

        socket.on('disconnect', handleDisconnect);

        return () => {
            socket.off('disconnect', handleDisconnect);
        };
    }, [socket, cancelAnimations, dispatch]);

    useEffect(() => {
        const unsubscribe = subscribeToFftData((frame) => {
            const now = performance.now();
            timestampWindowRef.current.push(now);
            const cutoffTime = now - windowSizeMs;
            while (timestampWindowRef.current.length > 0 && timestampWindowRef.current[0] < cutoffTime) {
                timestampWindowRef.current.shift();
            }
            const currentRate = timestampWindowRef.current.length;
            const shouldOverflow = currentRate > fftDataOverflowLimit;
            if (shouldOverflow !== overflowRef.current) {
                overflowRef.current = shouldOverflow;
                dispatch(setFFTdataOverflow(shouldOverflow));
                allowedIntervalRef.current = 1000 / fftDataOverflowLimit;
            }
            if (overflowRef.current) {
                const timeSinceLastAllowed = now - lastAllowedUpdateRef.current;
                if (timeSinceLastAllowed < allowedIntervalRef.current) {
                    timestampWindowRef.current.pop();
                    return;
                }
                lastAllowedUpdateRef.current = now;
            }
            const {
                fft,
                playbackElapsedSeconds,
                playbackRemainingSeconds,
                playbackTotalSeconds,
            } = frame;

            // Update playback timing refs without causing re-renders
            if (playbackElapsedSecondsRef) {
                playbackElapsedSecondsRef.current = playbackElapsedSeconds;
            }
            if (playbackRemainingSecondsRef) {
                playbackRemainingSecondsRef.current = playbackRemainingSeconds;
            }
            if (playbackTotalSecondsRef) {
                playbackTotalSecondsRef.current = playbackTotalSeconds;
            }

            if (waterfallRendererMode === 'dom-tiles') {
                if (onDomTileFftData) {
                    onDomTileFftData(fft);
                }
            }
        });

        return () => {
            cancelAnimations();
            unsubscribe();
        };
    }, [subscribeToFftData, cancelAnimations, dispatch, waterfallRendererMode, onDomTileFftData]);

    // Effect to handle cleanup when streaming stops (from parent handler or local stop)
    useEffect(() => {
        if (!isStreaming) {
            cancelAnimations();
        }
    }, [isStreaming, cancelAnimations]);

    const isUnsetSelection = useCallback((value) => {
        if (value === null || value === undefined) {
            return true;
        }
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            return normalized === '' || normalized === 'none';
        }
        return false;
    }, []);

    const emitApiCall = useCallback((cmd, data) => {
        return new Promise((resolve) => {
            if (!socket) {
                resolve({ success: false, error: 'Socket is not connected' });
                return;
            }
            socket.emit(
                'api.call',
                { cmd, data },
                (response) => {
                    resolve(response || { success: false, error: 'No response from server' });
                }
            );
        });
    }, [socket]);

    const getSdrInUseConflict = useCallback((response) => {
        if (!response || typeof response !== 'object') {
            return null;
        }
        const responseCode = response.error_code || response?.data?.error_code;
        if (responseCode !== 'sdr_in_use_conflict') {
            return null;
        }
        return response?.data && typeof response.data === 'object' ? response.data : {};
    }, []);

    const callWithTakeoverConfirmation = useCallback(async (cmd, payload, actionLabel) => {
        const initialResponse = await emitApiCall(cmd, payload);
        if (initialResponse?.success) {
            return { success: true, response: initialResponse, takeoverConfirmed: false };
        }

        const conflict = getSdrInUseConflict(initialResponse);
        if (!conflict) {
            return { success: false, response: initialResponse, canceled: false };
        }

        const confirmed = await requestTakeoverConfirmation(conflict, actionLabel);
        if (!confirmed) {
            return {
                success: false,
                response: initialResponse,
                canceled: true,
                takeoverConfirmed: false,
            };
        }

        const forcedPayload = {
            ...payload,
            forceTakeover: true,
        };
        const forcedResponse = await emitApiCall(cmd, forcedPayload);
        return {
            success: Boolean(forcedResponse?.success),
            response: forcedResponse,
            canceled: false,
            takeoverConfirmed: true,
        };
    }, [emitApiCall, getSdrInUseConflict, requestTakeoverConfirmation]);

    const startStreaming = useCallback(async () => {
        if (!isStreaming) {
            const isSigmfPlayback = selectedSDRId === "sigmf-playback";
            if (isSigmfPlayback && !playbackRecordingPath) {
                toast.error('Please select a recording first');
                return;
            }

            if (!isSigmfPlayback) {
                const validationErrors = {
                    gain: isUnsetSelection(gain),
                    sampleRate: isUnsetSelection(sampleRate),
                    antenna: isUnsetSelection(selectedAntenna),
                };
                if (validationErrors.gain || validationErrors.sampleRate || validationErrors.antenna) {
                    dispatch(setStartStreamValidationErrors(validationErrors));
                    if (!expandedPanels.includes('sdr')) {
                        dispatch(setExpandedPanels([...expandedPanels, 'sdr']));
                    }
                    toast.error('Select gain, sample rate, and antenna before starting stream');
                    return;
                }
            }

            dispatch(clearStartStreamValidationErrors());
            dispatch(setStartStreamingLoading(true));
            dispatch(setErrorMessage(''));

            // Proactively ensure AudioContext is resumed before streaming starts
            // This prevents the race condition where audio arrives before context is ready
            if (getAudioState && initializeAudio) {
                const audioState = getAudioState();
                if (audioState.contextState === 'suspended') {
                    console.log('AudioContext suspended - resuming before stream start');
                    initializeAudio().catch(err => {
                        console.warn('Failed to resume AudioContext proactively:', err);
                        // Continue anyway - audio will try to resume when first packet arrives
                    });
                } else if (!audioState.enabled) {
                    console.log('Audio not enabled - initializing before stream start');
                    initializeAudio().catch(err => {
                        console.warn('Failed to initialize audio proactively:', err);
                    });
                }
            }

            const configurePayload = {
                selectedSDRId,
                centerFrequency,
                sampleRate,
                gain,
                fftSize,
                biasT,
                tunerAgc,
                rtlAgc,
                fftWindow,
                fftOverlapPercent,
                fftOverlapDepth,
                antenna: selectedAntenna,
                offsetFrequency: selectedOffsetValue,
                recordingPath: playbackRecordingPath,
                soapyAgc,
                fftAveraging,
                sdrSettings: sdrSettingsById?.[selectedSDRId]?.draft || {},
            };

            const configureResult = await callWithTakeoverConfirmation(
                'sdr.configure-sdr',
                configurePayload,
                'reconfigure the SDR'
            );
            if (!configureResult.success) {
                dispatch(setStartStreamingLoading(false));
                return;
            }

            const startResult = await callWithTakeoverConfirmation(
                'sdr.start-streaming',
                {
                    selectedSDRId,
                    forceTakeover: Boolean(configureResult.takeoverConfirmed),
                },
                'start streaming'
            );
            if (!startResult.success) {
                dispatch(setStartStreamingLoading(false));
            }
        }
    }, [isStreaming, dispatch, selectedSDRId, centerFrequency, sampleRate, gain, fftSize, biasT, tunerAgc, rtlAgc, fftWindow, fftOverlapPercent, fftOverlapDepth, selectedAntenna, selectedOffsetValue, playbackRecordingPath, soapyAgc, fftAveraging, getAudioState, initializeAudio, isUnsetSelection, expandedPanels, sdrSettingsById, callWithTakeoverConfirmation]);

    const stopStreaming = useCallback(async () => {
        if (isStreaming) {
            // If recording is active, stop it first
            if (isRecording) {
                try {
                    // Capture waterfall snapshot
                    let waterfallImage = null;
                    try {
                        if (window.captureWaterfallSnapshot) {
                            waterfallImage = await window.captureWaterfallSnapshot(1620);
                        }
                    } catch (captureError) {
                        console.error('Error capturing waterfall:', captureError);
                    }

                    // Stop recording and wait for it to complete
                    await dispatch(stopRecording({ socket, selectedSDRId, waterfallImage })).unwrap();
                    console.log('Recording stopped successfully before stopping stream');
                } catch (error) {
                    console.error('Error stopping recording:', error);
                    toast.error(`Failed to stop recording: ${error}`);
                }
            }

            // Now stop streaming
            socket.emit("api.call", {
  cmd: "sdr.stop-streaming",
  data: {
    selectedSDRId
  }
});
            dispatch(setIsStreaming(false));
            cancelAnimations();
        }
    }, [isStreaming, isRecording, socket, selectedSDRId, dispatch, cancelAnimations]);

    const playButtonEnabledOrNot = useCallback(() => {
        const isStreamingActive = isStreaming;
        const noSDRSelected = selectedSDRId === 'none';
        const isSigmfPlayback = selectedSDRId === 'sigmf-playback';
        const isLoadingParameters = gettingSDRParameters;
        const missingPlaybackRecording = isSigmfPlayback && !playbackRecordingPath;
        return isStreamingActive || noSDRSelected || isLoadingParameters || missingPlaybackRecording;
    }, [isStreaming, selectedSDRId, gettingSDRParameters, playbackRecordingPath]);

    return { startStreaming, stopStreaming, playButtonEnabledOrNot, takeoverDialog };
};

export default useWaterfallStream;
