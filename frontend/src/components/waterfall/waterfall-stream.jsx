import { useEffect, useRef, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { useSocket } from '../common/socket.jsx';
import { useWaterfallEngine } from './waterfall-engine-provider.jsx';
import {
    setIsStreaming,
    setJoinedSdrId,
    updateSDRConfig,
    setErrorMessage,
    setErrorDialogOpen,
    setStartStreamingLoading,
    setFFTdataOverflow,
    setExpandedPanels,
    setStartStreamValidationErrors,
    clearStartStreamValidationErrors,
    stopRecording
} from './waterfall-slice.jsx';
import { toast } from '../../utils/toast-with-timestamp.jsx';
import { useSdrTakeoverDialog } from './use-sdr-takeover-dialog.jsx';
import { joinSdr, leaveSdr } from './sdr-join.js';
import { setCurrentSessionId } from '../decoders/decoders-slice.jsx';

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
    const { t } = useTranslation('waterfall');
    const { socket } = useSocket();
    const { subscribeToFftData } = useWaterfallEngine();
    const {
        selectedSDRId,
        centerFrequency,
        sampleRate,
        sampleRateValues,
        gain,
        fftSize,
        sdrSettingsById,
        fftWindow,
        fftOverlapPercent,
        fftOverlapDepth,
        selectedAntenna,
        antennasList,
        selectedOffsetValue,
        fftAveraging,
        isStreaming,
        joinedSdrId,
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
            dispatch(setJoinedSdrId(null));
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

        const choice = await requestTakeoverConfirmation(conflict, actionLabel);
        if (choice === 'join') {
            if (conflict.config) dispatch(updateSDRConfig({ ...conflict.config, force_live: true }));
            const joinResponse = await joinSdr(socket, dispatch, conflict.sdr_id || selectedSDRId);
            if (!joinResponse?.success) toast.error(joinResponse?.error || 'Could not join SDR');
            return {
                success: false,
                response: joinResponse,
                canceled: true,
                joined: Boolean(joinResponse?.success),
                takeoverConfirmed: false,
            };
        }
        if (choice !== 'takeover') {
            if (conflict.config) dispatch(updateSDRConfig({ ...conflict.config, force_live: true }));
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
    }, [emitApiCall, getSdrInUseConflict, requestTakeoverConfirmation, dispatch, socket, selectedSDRId]);

    const startStreaming = useCallback(async () => {
        if (!isStreaming) {
            if (isUnsetSelection(selectedSDRId)) {
                // Mark only the SDR selector; its dependent controls are not usable yet.
                dispatch(setStartStreamValidationErrors({ sdr: true }));
                if (!expandedPanels.includes('sdr')) {
                    dispatch(setExpandedPanels([...expandedPanels, 'sdr']));
                }
                dispatch(setErrorMessage(t('sdr.sdr_required', { defaultValue: 'Select an SDR before starting stream' })));
                dispatch(setErrorDialogOpen(true));
                return;
            }

            const isSigmfPlayback = selectedSDRId === "sigmf-playback";
            if (isSigmfPlayback && !playbackRecordingPath) {
                toast.error('Please select a recording first');
                return;
            }

            if (!isSigmfPlayback) {
                const validationErrors = {
                    gain: isUnsetSelection(gain),
                    // The menu shows "no rate selected" when a stale rate is
                    // absent from this device's current options.
                    sampleRate: isUnsetSelection(sampleRate)
                        || !sampleRateValues.includes(sampleRate)
                        || !Number.isFinite(Number(sampleRate))
                        || Number(sampleRate) <= 0,
                    antenna: isUnsetSelection(selectedAntenna)
                        || !antennasList?.rx?.includes(selectedAntenna),
                };
                if (validationErrors.gain || validationErrors.sampleRate || validationErrors.antenna) {
                    dispatch(setStartStreamValidationErrors(validationErrors));
                    if (!expandedPanels.includes('sdr')) {
                        dispatch(setExpandedPanels([...expandedPanels, 'sdr']));
                    }
                    const messages = [
                        validationErrors.gain && t('sdr.gain_required', { defaultValue: 'Select gain before starting stream' }),
                        validationErrors.sampleRate && t('sdr.sample_rate_required', { defaultValue: 'Select sample rate before starting stream' }),
                        validationErrors.antenna && t('sdr.antenna_required', { defaultValue: 'Select antenna before starting stream' }),
                    ].filter(Boolean);
                    dispatch(setErrorMessage(messages.join('\n')));
                    dispatch(setErrorDialogOpen(true));
                    return;
                }
            }

            dispatch(clearStartStreamValidationErrors());
            dispatch(setCurrentSessionId(socket?.id));
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
                if (!startResult.canceled) {
                    dispatch(setErrorMessage(startResult.response?.error || 'Failed to start SDR stream'));
                    dispatch(setErrorDialogOpen(true));
                }
            }
        }
    }, [isStreaming, dispatch, t, selectedSDRId, centerFrequency, sampleRate, sampleRateValues, gain, fftSize, biasT, tunerAgc, rtlAgc, fftWindow, fftOverlapPercent, fftOverlapDepth, selectedAntenna, antennasList, selectedOffsetValue, playbackRecordingPath, soapyAgc, fftAveraging, getAudioState, initializeAudio, isUnsetSelection, expandedPanels, sdrSettingsById, callWithTakeoverConfirmation]);

    const stopStreaming = useCallback(async () => {
        if (isStreaming) {
            if (joinedSdrId) {
                const response = await leaveSdr(socket, dispatch, joinedSdrId);
                if (!response?.success) {
                    toast.error(response?.error || 'Could not leave SDR');
                } else {
                    cancelAnimations();
                }
                return;
            }
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
    }, [isStreaming, joinedSdrId, isRecording, socket, selectedSDRId, dispatch, cancelAnimations]);

    const seekPlayback = useCallback((positionSeconds) => callWithTakeoverConfirmation(
        'sdr.seek-playback',
        { selectedSDRId: 'sigmf-playback', positionSeconds },
        'seek playback'
    ), [callWithTakeoverConfirmation]);

    const playButtonEnabledOrNot = useCallback(() => {
        const isStreamingActive = isStreaming;
        const isSigmfPlayback = selectedSDRId === 'sigmf-playback';
        const isLoadingParameters = gettingSDRParameters;
        const missingPlaybackRecording = isSigmfPlayback && !playbackRecordingPath;
        return isStreamingActive || isLoadingParameters || missingPlaybackRecording;
    }, [isStreaming, selectedSDRId, gettingSDRParameters, playbackRecordingPath]);

    return { startStreaming, stopStreaming, seekPlayback, playButtonEnabledOrNot, takeoverDialog };
};

export default useWaterfallStream;
