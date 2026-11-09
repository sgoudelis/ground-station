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


import React, {useImperativeHandle, forwardRef, useCallback, useEffect, useLayoutEffect, useState, useRef, useMemo} from 'react';
import {Box, Typography, IconButton} from '@mui/material';
import {UnfoldMore, UnfoldLess} from '@mui/icons-material';
import {
    getClassNamesBasedOnGridEditing,
    TitleBar
} from "../common/common.jsx";
import { shallowEqual, useSelector, useDispatch, useStore } from 'react-redux';

import {
    getSDRConfigParameters,
    setErrorDialogOpen,
    setGridEditable,
    setSdrRtlAgc,
    setSdrTunerAgc,
    setColorMap,
    setColorMaps,
    setDbRange,
    setFFTSize,
    setFFTSizeOptions,
    setFFTAveraging,
    setFFTOverlapPercent,
    setFFTOverlapDepth,
    setBandscopeSmoothing,
    setGain,
    setSampleRate,
    setCenterFrequency,
    setErrorMessage,
    setIsStreaming,
    setReceivingSession,
    updateSDRConfig,
    setTargetFPS,
    setSettingsDialogOpen,
    setAutoDBRange,
    setSdrBiasT,
    setSdrBitpack,
    setSdrGainElement,
    setSdrSettings,
    setSdrSettingsApplied,
    setFFTWindow,
    setExpandedPanels,
    setSelectedSDRId,
    restoreSdrSelection,
    setSelectedAntenna,
    setSdrSoapyAgc,
    setSelectedOffsetMode,
    setSelectedOffsetValue,
    startRecording,
    stopRecording,
    setRecordingName,
    setRecordingDecimationFactor,
    setRecordingStorageFormat,
    setRecordingBandSelectionEnabled,
    setRecordingBandCenterOffsetHz,
    setRecordingBandDragStepHz,
    incrementRecordingDuration,
    setSelectedPlaybackRecording,
    setPlaybackRecordingPath,
    clearPlaybackRecording,
    setPlaybackStartTime,
    resetPlaybackStartTime,
    clearStartStreamValidationErrors,
    clearStartStreamValidationError,
} from './waterfall-slice.jsx';

import {
    setVFOProperty,
    setSelectedVFO,
    setSelectedVFOTab,
    setVfoInactive,
    setVfoActive,
} from './vfo-marker/vfo-slice.jsx';

import { setTranscriptionActive } from './transcription-slice';

import {useSocket} from "../common/socket.jsx";
import { resolveTranslationBackend } from '../common/translation-options.jsx';
import { toast } from "../../utils/toast-with-timestamp.jsx";
import getValue from "lodash/_getValue.js";
import FrequencyControlAccordion from "./settings-frequency.jsx";
import SdrAccordion from "./settings-sdr.jsx";
import ContinuousObservationSessionDialog from './continuous-observation-session-dialog.jsx';
import { createContinuousObservationFromSession } from '../scheduler/continuous-observation-utils.js';
import FftAccordion from "./settings-fft.jsx";
import VfoAccordion from "./vfo-settings/settings-vfo.jsx";
import RecordingAccordion from "./settings-recording.jsx";
import PlaybackAccordion from "./settings-playback.jsx";
import { useTranslation } from 'react-i18next';
import { selectRunningRigTransmitterOptions } from "../target/transmitter-selectors.js";
import { fetchPlaybackRecordings } from "../filebrowser/filebrowser-slice.jsx";
import { useSdrTakeoverDialog } from './use-sdr-takeover-dialog.jsx';
import { callSdrApi, detachSdr, liveConfigToUpdates, joinSdr } from './sdr-join.js';
import { setCurrentSessionId } from '../decoders/decoders-slice.jsx';
import { DevRenderProfiler } from './render-profiler.jsx';
import { formatGnssRate, getGnssTuningAdvice } from './gnss-tuning.js';
import useStableEvent from '../../hooks/useStableEvent.js';
import { configureSdr } from './sdr-config.js';
import { hasSingleUhdGain, normalizeSdrGain, setSdrSetting } from '../common/sdr-parameters.js';

const PLAYBACK_DEFAULT_FFT_OVERLAP_PERCENT = 50;

const SDR_SELECTION_FIELDS = [
    'selectedSDRId', 'centerFrequency', 'sampleRate', 'gain', 'fftSize',
    'fftWindow', 'fftAveraging', 'fftOverlapPercent', 'fftOverlapDepth',
    'selectedAntenna', 'selectedOffsetMode', 'selectedOffsetValue',
    'gainValues', 'sampleRateValues', 'fftSizeValues', 'fftWindowValues',
    'antennasList', 'sdrCapabilities', 'sdrSettingsById',
    'hasBiasT', 'hasTunerAgc', 'hasRtlAgc', 'hasSoapyAgc', 'playbackRecordingPath',
    'selectedPlaybackRecording', 'expandedPanels',
];

const haveSameNumericEntries = (previous, next) => {
    const previousKeys = Object.keys(previous);
    const nextKeys = Object.keys(next);
    return previousKeys.length === nextKeys.length
        && previousKeys.every((key) => previous[key] === next[key]);
};

const WaterfallSettings = forwardRef(function WaterfallSettings({ playbackRemainingSecondsRef }, ref) {
    const { t } = useTranslation('waterfall');
    const dispatch = useDispatch();
    const store = useStore();
    const [continuousObservationDraft, setContinuousObservationDraft] = useState(null);
    const openContinuousObservation = useCallback(() => {
        // Read at click time so VFO edits are copied without subscribing this whole column to them.
        const current = store.getState();
        const device = current.sdrs.sdrs.find((entry) => String(entry.id) === String(current.waterfall.selectedSDRId));
        if (!current.waterfall.isStreaming || current.waterfall.continuousObservation
            || !device || device.id === 'sigmf-playback' || device.type === 'sigmfplayback') return;
        const name = t('sdr.continuous_observation_name', {
            name: device.name, frequency: (current.waterfall.centerFrequency / 1e6).toFixed(3),
        });
        try {
            setContinuousObservationDraft(createContinuousObservationFromSession(current, name));
        } catch (failure) {
            toast.error(t(failure.message));
        }
    }, [store, t]);
    const closeContinuousObservation = useCallback(() => setContinuousObservationDraft(null), []);

    const {
        colorMap,
        colorMaps,
        dbRange,
        fftSizeOptions,
        fftSize,
        gain,
        sampleRate,
        centerFrequency,
        selectedOffsetMode,
        selectedOffsetValue,
        errorMessage,
        isStreaming,
        joinedSdrId,
        continuousObservation,
        targetFPS,
        settingsDialogOpen,
        autoDBRange,
        gridEditable,
        rtlGains,
        fftWindow,
        fftWindows,
        fftOverlapPercent,
        fftOverlapDepth,
        expandedPanels,
        selectedSDRId,
        gettingSDRParameters,
        gainValues,
        sampleRateValues,
        sdrCapabilities,
        sdrSettingsById,
        sdrBandwidthById,
        sdrReceiverById,
        hasBiasT,
        hasTunerAgc,
        hasRtlAgc,
        fftSizeValues,
        fftWindowValues,
        antennasList,
        selectedAntenna,
        hasSoapyAgc,
        fftAveraging,
        bandscopeSmoothing,
        isRecording,
        recordingDuration,
        recordingName,
        recordingDecimationFactor,
        recordingStorageFormat,
        recordingBandSelectionEnabled,
        recordingBandCenterOffsetHz,
        recordingBandDragStepHz,
        selectedPlaybackRecording,
        playbackRecordingPath,
        playbackStartTime,
        startStreamValidationErrors,
    } = useSelector(
        (state) => ({
            colorMap: state.waterfall.colorMap,
            colorMaps: state.waterfall.colorMaps,
            dbRange: state.waterfall.dbRange,
            fftSizeOptions: state.waterfall.fftSizeOptions,
            fftSize: state.waterfall.fftSize,
            gain: state.waterfall.gain,
            sampleRate: state.waterfall.sampleRate,
            centerFrequency: state.waterfall.centerFrequency,
            selectedOffsetMode: state.waterfall.selectedOffsetMode,
            selectedOffsetValue: state.waterfall.selectedOffsetValue,
            errorMessage: state.waterfall.errorMessage,
            isStreaming: state.waterfall.isStreaming,
            joinedSdrId: state.waterfall.joinedSdrId,
            continuousObservation: state.waterfall.continuousObservation,
            targetFPS: state.waterfall.targetFPS,
            settingsDialogOpen: state.waterfall.settingsDialogOpen,
            autoDBRange: state.waterfall.autoDBRange,
            gridEditable: state.waterfall.gridEditable,
            rtlGains: state.waterfall.rtlGains,
            fftWindow: state.waterfall.fftWindow,
            fftWindows: state.waterfall.fftWindows,
            fftOverlapPercent: state.waterfall.fftOverlapPercent,
            fftOverlapDepth: state.waterfall.fftOverlapDepth ?? 16,
            expandedPanels: state.waterfall.expandedPanels,
            selectedSDRId: state.waterfall.selectedSDRId,
            gettingSDRParameters: state.waterfall.gettingSDRParameters,
            gainValues: state.waterfall.gainValues,
            sampleRateValues: state.waterfall.sampleRateValues,
            sdrCapabilities: state.waterfall.sdrCapabilities,
            sdrSettingsById: state.waterfall.sdrSettingsById,
            sdrBandwidthById: state.waterfall.sdrBandwidthById,
            sdrReceiverById: state.waterfall.sdrReceiverById,
            hasBiasT: state.waterfall.hasBiasT,
            hasTunerAgc: state.waterfall.hasTunerAgc,
            hasRtlAgc: state.waterfall.hasRtlAgc,
            fftSizeValues: state.waterfall.fftSizeValues,
            fftWindowValues: state.waterfall.fftWindowValues,
            antennasList: state.waterfall.antennasList,
            selectedAntenna: state.waterfall.selectedAntenna,
            hasSoapyAgc: state.waterfall.hasSoapyAgc,
            fftAveraging: state.waterfall.fftAveraging,
            bandscopeSmoothing: state.waterfall.bandscopeSmoothing,
            isRecording: state.waterfall.isRecording,
            recordingDuration: state.waterfall.recordingDuration,
            recordingName: state.waterfall.recordingName,
            recordingDecimationFactor: state.waterfall.recordingDecimationFactor,
            recordingStorageFormat: state.waterfall.recordingStorageFormat,
            recordingBandSelectionEnabled: state.waterfall.recordingBandSelectionEnabled,
            recordingBandCenterOffsetHz: state.waterfall.recordingBandCenterOffsetHz,
            recordingBandDragStepHz: state.waterfall.recordingBandDragStepHz,
            selectedPlaybackRecording: state.waterfall.selectedPlaybackRecording,
            playbackRecordingPath: state.waterfall.playbackRecordingPath,
            playbackStartTime: state.waterfall.playbackStartTime,
            startStreamValidationErrors: state.waterfall.startStreamValidationErrors,
        }),
        shallowEqual
    );

    const sdrSettings = sdrSettingsById?.[selectedSDRId]?.draft || {};
    const biasT = sdrSettings?.biasT ?? false;
    const tunerAgc = sdrSettings?.tunerAgc ?? false;
    const rtlAgc = sdrSettings?.rtlAgc ?? false;
    const soapyAgc = sdrSettings?.soapyAgc ?? false;
    const { requestTakeoverConfirmation, takeoverDialog } = useSdrTakeoverDialog({
        defaultSdrId: selectedSDRId,
    });

    // Selecting the entire VFO slice made this settings column rerender for
    // every VFO update, including updates that none of these controls use.
    const {
        maxVFOMarkers,
        selectedVFO,
        selectedVFOTab,
    } = useSelector((state) => ({
        selectedVFO: state.vfo.selectedVFO,
        selectedVFOTab: state.vfo.selectedVFOTab,
        maxVFOMarkers: state.vfo.maxVFOMarkers,
    }), shallowEqual);

    const settingsScrollRef = useRef(null);
    const pendingVfoScrollTopRef = useRef(null);

    useLayoutEffect(() => {
        if (pendingVfoScrollTopRef.current === null || !settingsScrollRef.current) return;

        // Switching tabs replaces the VFO panel, which can change its height.
        // Keep the settings column at the position it had when the tab was clicked.
        settingsScrollRef.current.scrollTop = pendingVfoScrollTopRef.current;
        pendingVfoScrollTopRef.current = null;
    }, [selectedVFOTab]);


    const runningTransmitters = useSelector(selectRunningRigTransmitterOptions);

    const {
        sdrs
    } = useSelector((state) => state.sdrs);
    const runtimeSnapshotSessions = useSelector(
        (state) => state.sessions?.runtimeSnapshot?.data?.sessions || {},
        shallowEqual
    );
    const runtimeSnapshotSdrs = useSelector(
        (state) => state.sessions?.runtimeSnapshot?.data?.sdrs || {},
        shallowEqual
    );
    const currentSessionId = useSelector((state) => state.decoders?.currentSessionId);
    const {
        playbackRecordings: availablePlaybackRecordings,
        playbackRecordingsLoading,
    } = useSelector((state) => state.filebrowser, shallowEqual);

    const {
        preferences
    } = useSelector((state) => state.preferences);

    // Build a map of SDR IDs actively streaming for sessions other than this browser session.
    // We require live consumer/runtime evidence and do not treat "selected SDR only" as in-use.
    const calculatedSdrUsageByOtherSessions = useMemo(() => {
        const usage = {};
        const normalizedCurrentSessionId = currentSessionId ? String(currentSessionId) : null;
        const hasSessionConsumer = (sdrRuntime, sessionId) => {
            if (!sdrRuntime || !sessionId) {
                return false;
            }

            const sid = String(sessionId);
            const clients = Array.isArray(sdrRuntime.clients) ? sdrRuntime.clients : [];
            if (clients.some((clientId) => String(clientId) === sid)) {
                return true;
            }

            const mapHasSession = (value) => {
                if (!value || typeof value !== 'object') {
                    return false;
                }
                return Object.keys(value).some((key) => key === sid || key.startsWith(`${sid}:`));
            };

            return (
                mapHasSession(sdrRuntime.demodulators) ||
                mapHasSession(sdrRuntime.recorders) ||
                mapHasSession(sdrRuntime.decoders)
            );
        };

        Object.entries(runtimeSnapshotSessions || {}).forEach(([sessionId, sessionInfo]) => {
            if (!sessionId) {
                return;
            }
            if (normalizedCurrentSessionId && String(sessionId) === normalizedCurrentSessionId) {
                return;
            }

            const sdrId = String(sessionInfo?.sdr_id ?? '').trim();
            if (!sdrId || sdrId === 'none' || sdrId === 'sigmf-playback') {
                return;
            }

            const sdrRuntime = runtimeSnapshotSdrs?.[sdrId];
            if (!sdrRuntime?.alive || !hasSessionConsumer(sdrRuntime, sessionId)) {
                return;
            }

            usage[sdrId] = (usage[sdrId] || 0) + 1;
        });

        return usage;
    }, [runtimeSnapshotSessions, runtimeSnapshotSdrs, currentSessionId]);
    const sdrUsageByOtherSessionsRef = useRef({});
    if (!haveSameNumericEntries(sdrUsageByOtherSessionsRef.current, calculatedSdrUsageByOtherSessions)) {
        sdrUsageByOtherSessionsRef.current = calculatedSdrUsageByOtherSessions;
    }
    const sdrUsageByOtherSessions = sdrUsageByOtherSessionsRef.current;

    // Helper function to get preference value
    const getPreferenceValue = useCallback((name) => {
        const preference = preferences.find((pref) => pref.name === name);
        return preference ? preference.value : '';
    }, [preferences]);

    // Check if transcription APIs are configured
    const geminiConfigured = !!getPreferenceValue('gemini_api_key');
    const deepgramConfigured = !!getPreferenceValue('deepgram_api_key');

    const [localCenterFrequency, setLocalCenterFrequency] = useState(centerFrequency);
    const [localDbRange, setLocalDbRange] = useState(dbRange);
    const [localFFTSize, setLocalFFTSize] = useState(fftSize);
    const [localSampleRate, setLocalSampleRate] = useState(sampleRate);
    const [localGain, setLocalGain] = useState(gain);
    const [localColorMap, setLocalColorMap] = useState(colorMap);
    const [localAutoDBRange, setLocalAutoDBRange] = useState(autoDBRange);
    const hasInitializedRef = useRef(false);
    const {socket} = useSocket();

    const playbackRecordings = useMemo(() => {
        const recordings = availablePlaybackRecordings || [];
        const toTimestamp = (recording) => {
            const raw = recording?.modified || recording?.created || null;
            if (!raw) {
                return 0;
            }
            const ts = new Date(raw).getTime();
            return Number.isFinite(ts) ? ts : 0;
        };

        return [...recordings].sort((a, b) => {
            const diff = toTimestamp(b) - toTimestamp(a);
            if (diff !== 0) {
                return diff;
            }
            return String(a?.name || '').localeCompare(String(b?.name || ''));
        });
    }, [availablePlaybackRecordings]);

    useEffect(() => {
        setLocalCenterFrequency(centerFrequency);
        setLocalDbRange(dbRange);
        setLocalFFTSize(fftSize);
        setLocalSampleRate(sampleRate);
        setLocalGain(gain);
        setLocalColorMap(colorMap);
        setLocalAutoDBRange(autoDBRange);
    }, [centerFrequency, dbRange, fftSize, sampleRate, gain, colorMap, autoDBRange]);

    useEffect(() => {
        // Normalize stale persisted colormap values that are no longer available.
        if (!colorMaps.some((map) => map.id === colorMap)) {
            const fallbackColorMap = colorMaps[0]?.id || 'cosmic';
            setLocalColorMap(fallbackColorMap);
            if (colorMap !== fallbackColorMap) {
                dispatch(setColorMap(fallbackColorMap));
            }
        }
    }, [colorMap, colorMaps, dispatch]);

    useEffect(() => {
        // Only run once on mount if selectedSDRId exists and we haven't initialized yet
        if (selectedSDRId && !isStreaming && !hasInitializedRef.current) {
            hasInitializedRef.current = true;
            handleSDRChange({target: {value: selectedSDRId}});
        }
        // No cleanup function - let the ref stay true to prevent any subsequent calls for StrictMode
    }, []);

    useEffect(() => {
        if (!socket || selectedSDRId !== 'sigmf-playback') {
            return;
        }
        dispatch(fetchPlaybackRecordings({ socket }));
    }, [
        dispatch,
        socket,
        selectedSDRId,
    ]);

    const getDefaultFFTOverlapPercentForSDR = useCallback(() => 50, []);

    const getValidGainElements = useCallback((sdrId) => {
        const caps = sdrCapabilities?.[sdrId];
        return Array.isArray(caps?.gain_elements?.rx) ? caps.gain_elements.rx : [];
    }, [sdrCapabilities]);

    const filterGains = useCallback((gains, sdrId) => {
        if (!gains || typeof gains !== 'object') {
            return {};
        }
        const valid = getValidGainElements(sdrId);
        if (valid.length === 0) {
            return gains;
        }
        const filtered = {};
        valid.forEach((name) => {
            if (Object.prototype.hasOwnProperty.call(gains, name)) {
                filtered[name] = gains[name];
            }
        });
        return filtered;
    }, [getValidGainElements]);

    const emitApiCall = useCallback((cmd, payload) => {
        return new Promise((resolve) => {
            if (!socket || socket.connected === false) {
                resolve({ success: false, error: 'Socket is not connected' });
                return;
            }
            // Time out only the transport call; takeover confirmation may wait
            // for the user for as long as needed.
            const timeout = setTimeout(() => resolve({ success: false, error: 'SDR configuration timed out' }), 10000);
            socket.emit(
                "api.call",
                {
                    cmd,
                    data: payload,
                },
                (response) => {
                    clearTimeout(timeout);
                    resolve(response || { success: false, error: 'No response from server' });
                }
            );
        });
    }, [socket]);

    const getSdrInUseConflict = useCallback((response) => {
        if (!response || typeof response !== 'object') {
            return null;
        }
        const code = response.error_code || response?.data?.error_code;
        if (code !== 'sdr_in_use_conflict') {
            return null;
        }
        return response?.data && typeof response.data === 'object' ? response.data : {};
    }, []);

    const callWithTakeoverConfirmation = useCallback(async (cmd, payload, actionLabel) => {
        const initialResponse = await emitApiCall(cmd, payload);
        if (initialResponse?.success) {
            return { ...initialResponse, takeoverConfirmed: false };
        }

        const conflict = getSdrInUseConflict(initialResponse);
        if (!conflict) {
            return { ...(initialResponse || {}), takeoverConfirmed: false };
        }

        const choice = await requestTakeoverConfirmation(conflict, actionLabel);
        if (choice === 'join') {
            // Apply the authoritative worker settings before joining its FFT room.
            if (conflict.config) dispatch(updateSDRConfig({ ...conflict.config, force_live: true }));
            const joinResponse = await joinSdr(socket, dispatch, conflict.sdr_id || payload.selectedSDRId);
            if (!joinResponse?.success) toast.error(joinResponse?.error || 'Could not join SDR');
            return {
                ...(joinResponse || {}),
                success: false,
                canceled: true,
                joined: Boolean(joinResponse?.success),
                takeoverConfirmed: false,
            };
        }
        if (choice !== 'takeover') {
            if (conflict.config?.sdr_id === selectedSDRId) {
                // The attempted control change was optimistic; restore the
                // worker's actual settings when the user cancels it.
                dispatch(updateSDRConfig({ ...conflict.config, force_live: true }));
            }
            return {
                ...(initialResponse || {}),
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
            ...(forcedResponse || { success: false, error: 'No response from server' }),
            takeoverConfirmed: true,
        };
    }, [emitApiCall, getSdrInUseConflict, requestTakeoverConfirmation, dispatch, socket, selectedSDRId]);

    // A retune changes the defaults below, but it should not replace every
    // accordion callback that calls this function.
    const sendSDRConfigToBackend = useStableEvent((updates = {}) => {
            const targetSDRId = updates.selectedSDRId ?? selectedSDRId;
            const effectivePlaybackRecordingPath = updates.recordingPath ?? playbackRecordingPath;
            if (targetSDRId !== "none" && targetSDRId !== "") {
                // For sigmfplayback, NEVER send configure without a recording path
                // This prevents overwriting the session with empty recording_path
                if (targetSDRId === "sigmf-playback" && !effectivePlaybackRecordingPath) {
                    return Promise.resolve({ success: false, skipped: true });
                }

                let SDRSettings = {
                    selectedSDRId: targetSDRId,
                    // A second control event can arrive before React renders the
                    // previous tune. Read the current intent directly from Redux.
                    centerFrequency: store.getState().waterfall.centerFrequency,
                    sampleRate: sampleRate,
                    gain: gain,
                    fftSize: fftSize,
                    biasT: biasT,
                    tunerAgc: tunerAgc,
                    rtlAgc: rtlAgc,
                    fftWindow: fftWindow,
                    fftOverlapPercent: fftOverlapPercent,
                    fftOverlapDepth: fftOverlapDepth,
                    antenna: selectedAntenna,
                    soapyAgc: soapyAgc,
                    offsetFrequency: selectedOffsetValue,
                    fftAveraging: fftAveraging,
                    recordingPath: effectivePlaybackRecordingPath,
                    sdrSettings: sdrSettingsById?.[targetSDRId]?.draft || {},
                }
                SDRSettings = {...SDRSettings, ...updates};
                if (SDRSettings.sdrSettings) {
                    SDRSettings = {
                        ...SDRSettings,
                        sdrSettings: {
                            ...(SDRSettings.sdrSettings || {}),
                            gains: filterGains(SDRSettings.sdrSettings?.gains, targetSDRId),
                        },
                    };
                }

                const operationLabel = Object.prototype.hasOwnProperty.call(updates, 'centerFrequency')
                    ? 'retune the SDR center frequency'
                    : 'reconfigure the SDR';

                const applySdrSettingsLocally = (payload) => {
                    if (!payload?.sdrSettings) {
                        return;
                    }
                    dispatch(
                        setSdrSettingsApplied({
                            sdrId: targetSDRId,
                            settings: payload.sdrSettings,
                        })
                    );
                };

                return configureSdr({
                    socket,
                    store,
                    settings: SDRSettings,
                    call: (payload) => callWithTakeoverConfirmation("sdr.configure-sdr", payload, operationLabel),
                }).then((response) => {
                    if (response?.success && !response.superseded
                        && store.getState().waterfall.selectedSDRId === targetSDRId) {
                        if (response.data?.session_id) {
                            dispatch(setReceivingSession({
                                session_id: response.data.session_id,
                                enabled: Boolean(store.getState().waterfall.backgroundStreaming),
                            }));
                            dispatch(setCurrentSessionId(response.data.session_id));
                        }
                        applySdrSettingsLocally(SDRSettings);
                    }
                    return response;
                });
            }
            return Promise.resolve({ success: false, skipped: true });
        });

    const applyLoadedSDRParameters = useCallback((selectedValue, response, liveConfig = null) => {
        const current = store.getState().waterfall;
        // Do not configure or restore an SDR whose probe finished after a switch.
        if (current.selectedSDRId !== selectedValue) {
            return Promise.resolve({ success: false, superseded: true });
        }
        const caps = response?.capabilities || {};
        const device = sdrs.find((entry) => String(entry.id) === String(selectedValue));
        const rxGainElements = hasSingleUhdGain(device, caps) ? [] : (
            Array.isArray(caps?.gain_elements?.rx) ? caps.gain_elements.rx : []
        );
        const hasBitpackSetting = Array.isArray(caps?.settings)
            ? caps.settings.some((setting) => {
                const key = (setting?.key || '').toLowerCase();
                const name = (setting?.name || '').toLowerCase();
                return key === 'bitpack' || name.includes('bit pack');
            })
            : false;

        const existingSettings = sdrSettingsById?.[selectedValue]?.draft || {};
        let nextSdrSettings = {
            ...(liveConfig?.sdr_settings || existingSettings || {}),
            gains: {
                ...(liveConfig?.sdr_settings?.gains || existingSettings?.gains || {}),
            },
        };

        if (rxGainElements.length > 0) {
            const filteredGains = {};
            rxGainElements.forEach((name) => {
                if (Object.prototype.hasOwnProperty.call(nextSdrSettings.gains, name)) {
                    filteredGains[name] = nextSdrSettings.gains[name];
                } else {
                    filteredGains[name] = null;
                }
            });
            nextSdrSettings.gains = filteredGains;
        }

        if (hasBitpackSetting && nextSdrSettings.bitpack == null) {
            const bitpackSetting = (caps.settings || []).find((setting) => {
                const key = (setting?.key || '').toLowerCase();
                const name = (setting?.name || '').toLowerCase();
                return key === 'bitpack' || name.includes('bit pack');
            });
            nextSdrSettings.bitpack = Boolean(bitpackSetting?.value);
        }

        if (nextSdrSettings.biasT == null && caps?.bias_t?.supported) {
            nextSdrSettings.biasT = Boolean(caps?.bias_t?.value);
        }

        if (nextSdrSettings.tunerAgc == null) {
            nextSdrSettings.tunerAgc = false;
        }
        if (nextSdrSettings.rtlAgc == null) {
            nextSdrSettings.rtlAgc = false;
        }
        if (nextSdrSettings.soapyAgc == null) {
            nextSdrSettings.soapyAgc = false;
        }

        if (Array.isArray(caps?.clock_sources) && caps.clock_sources.length > 0) {
            if (!nextSdrSettings.clockSource) {
                nextSdrSettings.clockSource = caps.clock_source ?? caps.clock_sources[0] ?? null;
            }
        }

        if (Array.isArray(caps?.time_sources) && caps.time_sources.length > 0) {
            if (!nextSdrSettings.timeSource) {
                nextSdrSettings.timeSource = caps.time_source ?? caps.time_sources[0] ?? null;
            }
        }

        const normalized = normalizeSdrGain(device, caps, {
            gain: liveConfig?.receiver_status?.gain_db ?? liveConfig?.gain ?? store.getState().waterfall.gain,
            sdr_settings: nextSdrSettings,
        }, !liveConfig?.receiver_status);
        nextSdrSettings = normalized.sdr_settings;
        const requestedAntenna = liveConfig?.antenna ?? current.selectedAntenna;
        const antenna = response?.antennas?.rx?.includes(requestedAntenna) ? requestedAntenna : 'none';
        dispatch(setSelectedAntenna(antenna));
        dispatch(setGain(normalized.gain));
        dispatch(setSdrSettings({ sdrId: selectedValue, settings: nextSdrSettings }));
        dispatch(setSdrSettingsApplied({ sdrId: selectedValue, settings: nextSdrSettings }));
        return sendSDRConfigToBackend({
            ...liveConfigToUpdates(liveConfig),
            selectedSDRId: selectedValue,
            gain: normalized.gain,
            // Pass the validated port explicitly: the render captured by the
            // configure callback may still contain the previous SDR's antenna.
            antenna,
            sdrSettings: nextSdrSettings,
            forceTakeover: Boolean(liveConfig),
        });
    }, [dispatch, sdrs, store, sdrSettingsById, sendSDRConfigToBackend]);

    const loadSDRParameters = useCallback((selectedValue) => {
        return dispatch(getSDRConfigParameters({
            socket,
            selectedSDRId: selectedValue,
        })).unwrap();
    }, [dispatch, socket]);

    // Convert to useCallback to ensure stability of the function reference
    const handleSDRChange = useCallback(async (event) => {
        // Check what was selected
        const selectedValue = typeof event === 'object' ? event.target.value : event;

        const current = store.getState().waterfall;
        const previous = Object.fromEntries(
            SDR_SELECTION_FIELDS.map((field) => [field, current[field]])
        );
        let takeoverConfig = null;
        if (selectedValue && selectedValue !== 'none') {
            const inspection = await callSdrApi(socket, 'inspect-sdr', selectedValue);
            if (!inspection?.success) {
                toast.error(inspection?.error || 'Could not inspect SDR');
                return;
            }
            if (inspection.data?.conflict) {
                const choice = await requestTakeoverConfirmation(
                    inspection.data.conflict, 'select this SDR'
                );
                if (choice === 'cancel') return;
                if (choice === 'join') {
                    // Inspect first, apply its live scale, then subscribe to FFT.
                    if (inspection.data.config) dispatch(updateSDRConfig({ ...inspection.data.config, force_live: true }));
                    const joinResponse = await joinSdr(socket, dispatch, selectedValue);
                    if (!joinResponse?.success) {
                        dispatch(restoreSdrSelection(previous));
                        toast.error(joinResponse?.error || 'Could not join SDR');
                    }
                    return;
                }
                takeoverConfig = inspection.data.config;
                if (takeoverConfig) dispatch(updateSDRConfig({ ...takeoverConfig, force_live: true }));
            }
        }

        dispatch(clearStartStreamValidationErrors());
        dispatch(setSelectedSDRId(selectedValue));
        if (selectedValue && selectedValue !== "none") {
            const defaultPercent = getDefaultFFTOverlapPercentForSDR();
            dispatch(setFFTOverlapPercent(defaultPercent));
        }

        if (selectedValue === "none") {
            // Reset UI values since once we get new values from the backend, they might not be valid anymore
            dispatch(setSampleRate("none"));
            dispatch(setGain("none"));

        } else {
            try {
                const response = await loadSDRParameters(selectedValue);
                const configureResponse = await applyLoadedSDRParameters(selectedValue, response, takeoverConfig);
                if (configureResponse?.superseded || store.getState().waterfall.selectedSDRId !== selectedValue) return;
                if (!configureResponse?.success && !configureResponse?.joined) {
                    dispatch(restoreSdrSelection(previous));
                    if (!configureResponse?.canceled && configureResponse?.error) {
                        // Backend configuration failures already open the SDR error dialog.
                        toast.error(configureResponse.error);
                    }
                }
            } catch (error) {
                if (store.getState().waterfall.selectedSDRId !== selectedValue) return;
                dispatch(restoreSdrSelection(previous));
                dispatch(setErrorMessage(error?.message || String(error)));
                dispatch(setErrorDialogOpen(true));
            }
        }
    }, [dispatch, store, socket, requestTakeoverConfirmation, loadSDRParameters,
        applyLoadedSDRParameters, getDefaultFFTOverlapPercentForSDR]);

    const handleRefreshSDRParameters = useCallback(() => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }

        loadSDRParameters(selectedSDRId)
            .then((response) => {
                applyLoadedSDRParameters(selectedSDRId, response);
            })
            .catch((error) => {
                if (store.getState().waterfall.selectedSDRId !== selectedSDRId) return;
                dispatch(setErrorMessage(error?.message || String(error)));
                dispatch(setErrorDialogOpen(true));
            });
    }, [selectedSDRId, loadSDRParameters, applyLoadedSDRParameters, dispatch, store]);

    // Expose the function to parent components
    useImperativeHandle(ref, () => ({
        sendSDRConfigToBackend, handleSDRChange
    }));

    const updateCenterFrequency = (newFrequency) => (dispatch) => {
        let centerFrequency = newFrequency * 1000.0;
        dispatch(setCenterFrequency(centerFrequency));
        return sendSDRConfigToBackend({centerFrequency: centerFrequency});
    };

    const updateSDRGain = (gain) => (dispatch) => {
        dispatch(setGain(gain));
        const normalized = normalizeSdrGain(sdrs.find((entry) => entry.id === selectedSDRId),
            sdrCapabilities?.[selectedSDRId], { gain, sdr_settings: sdrSettings }, false);
        dispatch(setSdrSettings({ sdrId: selectedSDRId, settings: normalized.sdr_settings }));
        return sendSDRConfigToBackend({ gain, sdrSettings: normalized.sdr_settings });
    };

    const updateSampleRate = (sampleRate) => (dispatch) => {
        dispatch(setSampleRate(sampleRate));
        return sendSDRConfigToBackend({sampleRate: sampleRate});
    };

    const updateBiasT = (enabled) => (dispatch) => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }
        dispatch(setSdrBiasT({ sdrId: selectedSDRId, value: enabled }));
        return sendSDRConfigToBackend({biasT: enabled});
    };

    const updateBitpack = (enabled) => (dispatch) => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }
        dispatch(setSdrBitpack({ sdrId: selectedSDRId, value: enabled }));
        return sendSDRConfigToBackend({
            sdrSettings: {
                ...(sdrSettings || {}),
                bitpack: enabled,
                gains: sdrSettings?.gains || {},
            },
        });
    };

    const updateGainElement = (name, value) => (dispatch) => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }
        const validGainElements = getValidGainElements(selectedSDRId);
        if (validGainElements.length > 0 && !validGainElements.includes(name)) {
            return;
        }
        const nextGains = {
            ...(sdrSettings?.gains || {}),
            [name]: value,
        };
        dispatch(setSdrGainElement({ sdrId: selectedSDRId, name, value }));
        return sendSDRConfigToBackend({
            sdrSettings: {
                ...(sdrSettings || {}),
                bitpack: sdrSettings?.bitpack ?? null,
                gains: filterGains(nextGains, selectedSDRId),
            },
        });
    };

    const updateClockSource = (value) => (dispatch) => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }
        const settings = setSdrSetting(sdrs.find((entry) => entry.id === selectedSDRId),
            sdrSettings, 'clockSource', value);
        dispatch(setSdrSettings({ sdrId: selectedSDRId, settings }));
        return sendSDRConfigToBackend({
            sdrSettings: settings,
        });
    };

    const updateTimeSource = (value) => (dispatch) => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }
        const settings = setSdrSetting(sdrs.find((entry) => entry.id === selectedSDRId),
            sdrSettings, 'timeSource', value);
        dispatch(setSdrSettings({ sdrId: selectedSDRId, settings }));
        return sendSDRConfigToBackend({
            sdrSettings: settings,
        });
    };
    const updateTunerAgc = (enabled) => (dispatch) => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }
        dispatch(setSdrTunerAgc({ sdrId: selectedSDRId, value: enabled }));
        return sendSDRConfigToBackend({tunerAgc: enabled});
    };

    const updateRtlAgc = (enabled) => (dispatch) => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }
        dispatch(setSdrRtlAgc({ sdrId: selectedSDRId, value: enabled }));
        return sendSDRConfigToBackend({rtlAgc: enabled});
    };

    const updateSelectedAntenna = (antenna) => (dispatch) => {
        dispatch(setSelectedAntenna(antenna));
        return sendSDRConfigToBackend({antenna: antenna});
    };

    const updateSoapyAgc = (enabled) => (dispatch) => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }
        dispatch(setSdrSoapyAgc({ sdrId: selectedSDRId, value: enabled }));
        return sendSDRConfigToBackend({soapyAgc: enabled});
    };

    const handleGoToTransmitter = useCallback((transmitter) => {
        const targetFrequency = Number(transmitter?.downlink_low);
        if (!Number.isFinite(targetFrequency) || targetFrequency <= 0) {
            return;
        }

        // Calculate offset to avoid DC spike at center.
        // If sample rate is unset (e.g., "none"), fall back to no offset.
        const parsedSampleRate = typeof sampleRate === 'number' ? sampleRate : Number(sampleRate);
        const offsetHz = Number.isFinite(parsedSampleRate) ? parsedSampleRate * 0.25 : 0;
        const newCenterFrequency = targetFrequency + offsetHz;

        dispatch(setCenterFrequency(newCenterFrequency));
        return sendSDRConfigToBackend({centerFrequency: newCenterFrequency});
    }, [dispatch, sampleRate, sendSDRConfigToBackend]);

    const handleOffsetModeChange = useCallback((event) => {
        const offsetValue = event.target.value;

        if (offsetValue === "none") {
            dispatch(setSelectedOffsetMode(offsetValue));
            dispatch(setSelectedOffsetValue(0));
            return sendSDRConfigToBackend({offsetFrequency: 0});
        } else if (offsetValue === "manual") {
            dispatch(setSelectedOffsetMode(offsetValue));
            return sendSDRConfigToBackend({offsetFrequency: parseInt(selectedOffsetValue)});
        } else {
            dispatch(setSelectedOffsetValue(offsetValue));
            dispatch(setSelectedOffsetMode(offsetValue));
            return sendSDRConfigToBackend({offsetFrequency: parseInt(offsetValue)});
        }
    }, [dispatch, selectedOffsetValue, sendSDRConfigToBackend]);

    const handleOffsetValueChange = useCallback((param) => {
        const offsetValue = param.target.value;
        dispatch(setSelectedOffsetValue(offsetValue));
        return sendSDRConfigToBackend({offsetFrequency: parseInt(offsetValue)});
    }, [dispatch, sendSDRConfigToBackend]);

    const handleSdrAccordionChange = useCallback((event, isExpanded) => {
        const panel = 'sdr';
        const updateExpandedPanels = (currentExpandedPanels) => {
            if (isExpanded) {
                return currentExpandedPanels.includes(panel)
                    ? currentExpandedPanels
                    : [...currentExpandedPanels, panel];
            }
            return currentExpandedPanels.filter(p => p !== panel);
        };
        dispatch(setExpandedPanels(updateExpandedPanels(expandedPanels)));
    }, [dispatch, expandedPanels]);

    const handleFreqAccordionChange = useCallback((event, isExpanded) => {
        const panel = 'freqControl';
        const updateExpandedPanels = (currentExpandedPanels) => {
            if (isExpanded) {
                return currentExpandedPanels.includes(panel)
                    ? currentExpandedPanels
                    : [...currentExpandedPanels, panel];
            }
            return currentExpandedPanels.filter(p => p !== panel);
        };
        dispatch(setExpandedPanels(updateExpandedPanels(expandedPanels)));
    }, [dispatch, expandedPanels]);

    const handleGainChange = useCallback((value) => {
        dispatch(setGain(value));
        if (value !== 'none' && value !== null && value !== undefined) {
            dispatch(clearStartStreamValidationError('gain'));
        }
        const normalized = normalizeSdrGain(sdrs.find((entry) => entry.id === selectedSDRId),
            sdrCapabilities?.[selectedSDRId], { gain: value, sdr_settings: sdrSettings }, false);
        dispatch(setSdrSettings({ sdrId: selectedSDRId, settings: normalized.sdr_settings }));
        sendSDRConfigToBackend({ gain: value, sdrSettings: normalized.sdr_settings });
    }, [dispatch, sdrs, selectedSDRId, sdrCapabilities, sdrSettings, sendSDRConfigToBackend]);

    const handleSampleRateChange = useCallback((value) => {
        dispatch(setSampleRate(value));
        if (value !== 'none' && value !== null && value !== undefined) {
            dispatch(clearStartStreamValidationError('sampleRate'));
        }
        sendSDRConfigToBackend({sampleRate: value});
    }, [dispatch, sendSDRConfigToBackend]);

    const handleGnssSampleRateChange = useCallback((rate) => (
        sendSDRConfigToBackend({ sampleRate: rate }).then((response) => {
            if (response?.success) dispatch(setSampleRate(rate));
            return response;
        })
    ), [dispatch, sendSDRConfigToBackend]);

    const handleAntennaChange = useCallback((value) => {
        dispatch(setSelectedAntenna(value));
        if (value !== 'none' && value !== null && value !== undefined) {
            dispatch(clearStartStreamValidationError('antenna'));
        }
        sendSDRConfigToBackend({antenna: value});
    }, [dispatch, sendSDRConfigToBackend]);

    const handleBiasTChange = useCallback((checked) => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }
        dispatch(setSdrBiasT({ sdrId: selectedSDRId, value: checked }));
        sendSDRConfigToBackend({biasT: checked});
    }, [dispatch, selectedSDRId, sendSDRConfigToBackend]);

    const handleBitpackChange = useCallback((checked) => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }
        dispatch(setSdrBitpack({ sdrId: selectedSDRId, value: checked }));
        sendSDRConfigToBackend({
            sdrSettings: {
                ...(sdrSettings || {}),
                bitpack: checked,
                gains: sdrSettings?.gains || {},
            },
        });
    }, [dispatch, selectedSDRId, sdrSettings, sendSDRConfigToBackend]);

    const handleGainElementChange = useCallback((name, value) => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }
        const validGainElements = getValidGainElements(selectedSDRId);
        if (validGainElements.length > 0 && !validGainElements.includes(name)) {
            return;
        }
        const nextGains = {
            ...(sdrSettings?.gains || {}),
            [name]: value,
        };
        dispatch(setSdrGainElement({ sdrId: selectedSDRId, name, value }));
        sendSDRConfigToBackend({
            sdrSettings: {
                ...(sdrSettings || {}),
                bitpack: sdrSettings?.bitpack ?? null,
                gains: filterGains(nextGains, selectedSDRId),
            },
        });
    }, [dispatch, selectedSDRId, sdrSettings, getValidGainElements, filterGains, sendSDRConfigToBackend]);

    const handleBandwidthChange = useCallback((bandwidth) => {
        if (!selectedSDRId || selectedSDRId === "none") return;
        const settings = setSdrSetting(sdrs.find((entry) => entry.id === selectedSDRId),
            sdrSettings, 'bandwidth', bandwidth);
        dispatch(setSdrSettings({ sdrId: selectedSDRId, settings }));
        sendSDRConfigToBackend({ sdrSettings: settings });
    }, [dispatch, sdrs, selectedSDRId, sdrSettings, sendSDRConfigToBackend]);

    const handleClockSourceChange = useCallback((value) => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }
        const settings = setSdrSetting(sdrs.find((entry) => entry.id === selectedSDRId),
            sdrSettings, 'clockSource', value);
        dispatch(setSdrSettings({ sdrId: selectedSDRId, settings }));
        sendSDRConfigToBackend({
            sdrSettings: settings,
        });
    }, [dispatch, sdrs, selectedSDRId, sdrSettings, sendSDRConfigToBackend]);

    const handleTimeSourceChange = useCallback((value) => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }
        const settings = setSdrSetting(sdrs.find((entry) => entry.id === selectedSDRId),
            sdrSettings, 'timeSource', value);
        dispatch(setSdrSettings({ sdrId: selectedSDRId, settings }));
        sendSDRConfigToBackend({
            sdrSettings: settings,
        });
    }, [dispatch, sdrs, selectedSDRId, sdrSettings, sendSDRConfigToBackend]);

    const handleTunerAgcChange = useCallback((checked) => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }
        dispatch(setSdrTunerAgc({ sdrId: selectedSDRId, value: checked }));
        sendSDRConfigToBackend({tunerAgc: checked});
    }, [dispatch, selectedSDRId, sendSDRConfigToBackend]);

    const handleSoapyAgcChange = useCallback((checked) => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }
        dispatch(setSdrSoapyAgc({ sdrId: selectedSDRId, value: checked }));
        sendSDRConfigToBackend({soapyAgc: checked});
    }, [dispatch, selectedSDRId, sendSDRConfigToBackend]);

    const handleRtlAgcChange = useCallback((checked) => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }
        dispatch(setSdrRtlAgc({ sdrId: selectedSDRId, value: checked }));
        sendSDRConfigToBackend({rtlAgc: checked});
    }, [dispatch, selectedSDRId, sendSDRConfigToBackend]);

    const handleFrequencyDialChange = useCallback((newFrequency) => {
        let nextCenterFrequency = newFrequency * 1000.0;
        dispatch(setCenterFrequency(nextCenterFrequency));
        sendSDRConfigToBackend({centerFrequency: nextCenterFrequency});
    }, [dispatch, sendSDRConfigToBackend]);

    const warnGnssSetup = useCallback((vfoNumber) => {
        const current = store.getState();
        const vfo = current.vfo.vfoMarkers?.[vfoNumber];
        if (vfo?.decoder !== 'gnss') return;

        const advice = getGnssTuningAdvice({
            parameters: vfo.parameters,
            parametersEnabled: vfo.parametersEnabled,
            vfoFrequency: vfo.frequency,
            sdrCenterFrequency: current.waterfall.centerFrequency,
            sdrSampleRate: current.waterfall.sampleRate,
        });
        if (advice.bandCount === 0) {
            toast.warning(`VFO ${vfoNumber}: Select at least one GNSS constellation in decoder parameters.`);
        } else if (advice.bandCount > 1) {
            toast.warning(`VFO ${vfoNumber}: The selected GNSS signals use different RF bands. Review decoder parameters.`);
        } else if (!advice.hasReceiver) {
            toast.warning(`VFO ${vfoNumber}: Select an SDR capture rate and center frequency for GNSS. Review decoder parameters.`);
        } else if (advice.needsTune) {
            toast.warning(`VFO ${vfoNumber}: Tune the receiver and VFO to ${advice.band.label} for the selected GNSS signals.`);
        } else if (advice.rateBelowRecommendation) {
            toast.warning(`VFO ${vfoNumber}: ${formatGnssRate(current.waterfall.sampleRate)} capture is narrow for the selected GNSS signals. Review decoder parameters.`);
        }
    }, [store]);

    const handleVFOPropertyChange = useCallback((vfoNumber, updates) => {
        dispatch(setVFOProperty({ vfoNumber, updates }));
        if (updates.decoder === 'gnss' && store.getState().vfo.vfoActive?.[vfoNumber]) {
            warnGnssSetup(vfoNumber);
        }
    }, [dispatch, store, warnGnssSetup]);

    const handleVFOActiveChange = useCallback((vfoNumber, isActive) => {
        if (isActive) {
            dispatch(setVfoActive(vfoNumber));
            warnGnssSetup(vfoNumber);
        } else {
            dispatch(setVfoInactive(vfoNumber));
        }
    }, [dispatch, warnGnssSetup]);

    const wasStreamingForGnssRef = useRef(isStreaming);
    useEffect(() => {
        if (isStreaming && !wasStreamingForGnssRef.current) {
            const active = store.getState().vfo.vfoActive || {};
            Object.keys(active).filter((vfoNumber) => active[vfoNumber]).forEach(warnGnssSetup);
        }
        wasStreamingForGnssRef.current = isStreaming;
    }, [isStreaming, store, warnGnssSetup]);

    const handleVFOListenChange = useCallback((vfoNumber, isListening) => {
        if (isListening) {
            dispatch(setSelectedVFO(vfoNumber));
        } else {
            dispatch(setSelectedVFO(null));
        }
    }, [dispatch]);

    const handleTranscriptionToggle = useCallback((vfoNumber, enabled, provider = 'gemini') => {
        // Use VFO's existing values, fallback to default
        // Read the current configuration only when the user toggles
        // transcription. Subscribing the whole settings column to VFO markers
        // would otherwise make it rerender at doppler tracking cadence.
        const currentVfo = store.getState().vfo.vfoMarkers[vfoNumber];
        const language = currentVfo?.transcriptionLanguage || 'auto';
        const selectedTarget = currentVfo?.transcriptionTranslateTo || 'none';
        const translationBackend = resolveTranslationBackend(currentVfo?.transcriptionTranslationBackend, selectedTarget);
        const translateTo = provider !== 'gemini' && translationBackend === 'none' ? 'none' : selectedTarget;

        socket.emit("api.call", {
  cmd: 'toggle-transcription',
  data: {
    vfoNumber,
    enabled,
    language,
    translateTo,
    translationBackend,
    provider
  }
}, response => {
  if (response.success) {
    // Update VFO state in Redux - update enabled flag and provider
    dispatch(setVFOProperty({
      vfoNumber,
      updates: {
        transcriptionEnabled: enabled,
        transcriptionProvider: provider,
        transcriptionTranslateTo: translateTo,
      }
    }));

    // Update transcription active state in Redux
    dispatch(setTranscriptionActive(enabled));
  } else {
    toast.error(t('vfo.transcription_error', `Failed to toggle transcription: ${response.error}`));
  }
});
    }, [dispatch, socket, store, t]);

    const handleVFOTabChange = useCallback((newValue) => {
        pendingVfoScrollTopRef.current = settingsScrollRef.current?.scrollTop ?? null;
        dispatch(setSelectedVFOTab(newValue));
        // Convert tab index (0-3) to VFO number (1-4) and select the VFO marker
        const vfoNumber = newValue + 1;
        dispatch(setSelectedVFO(vfoNumber));
    }, [dispatch]);

    const handleVfoAccordionChange = useCallback((event, isExpanded) => {
        const panel = 'vfo';
        const updateExpandedPanels = (currentExpandedPanels) => {
            if (isExpanded) {
                return currentExpandedPanels.includes(panel)
                    ? currentExpandedPanels
                    : [...currentExpandedPanels, panel];
            }
            return currentExpandedPanels.filter(p => p !== panel);
        };
        dispatch(setExpandedPanels(updateExpandedPanels(expandedPanels)));
    }, [dispatch, expandedPanels]);

    const handleFftAccordionChange = useCallback((event, isExpanded) => {
        const panel = 'fft';
        const updateExpandedPanels = (currentExpandedPanels) => {
            if (isExpanded) {
                return currentExpandedPanels.includes(panel)
                    ? currentExpandedPanels
                    : [...currentExpandedPanels, panel];
            }
            return currentExpandedPanels.filter(p => p !== panel);
        };
        dispatch(setExpandedPanels(updateExpandedPanels(expandedPanels)));
    }, [dispatch, expandedPanels]);

    const handleRecordingAccordionChange = useCallback((event, isExpanded) => {
        const panel = 'recording';
        const updateExpandedPanels = (currentExpandedPanels) => {
            if (isExpanded) {
                return currentExpandedPanels.includes(panel)
                    ? currentExpandedPanels
                    : [...currentExpandedPanels, panel];
            }
            return currentExpandedPanels.filter(p => p !== panel);
        };
        dispatch(setExpandedPanels(updateExpandedPanels(expandedPanels)));
    }, [dispatch, expandedPanels]);

    const handlePlaybackAccordionChange = useCallback((event, isExpanded) => {
        const panel = 'playback';
        const updateExpandedPanels = (currentExpandedPanels) => {
            if (isExpanded) {
                return currentExpandedPanels.includes(panel)
                    ? currentExpandedPanels
                    : [...currentExpandedPanels, panel];
            }
            return currentExpandedPanels.filter(p => p !== panel);
        };
        dispatch(setExpandedPanels(updateExpandedPanels(expandedPanels)));
    }, [dispatch, expandedPanels]);

    const handleFFTSizeChange = useCallback((value) => {
        setLocalFFTSize(value);
        dispatch(setFFTSize(value));
        sendSDRConfigToBackend({ fftSize: value });
    }, [dispatch, sendSDRConfigToBackend]);

    const handleFFTWindowChange = useCallback((value) => {
        dispatch(setFFTWindow(value));
        sendSDRConfigToBackend({ fftWindow: value });
    }, [dispatch, sendSDRConfigToBackend]);

    const handleFFTAveragingChange = useCallback((value) => {
        dispatch(setFFTAveraging(value));
        sendSDRConfigToBackend({ fftAveraging: value });
    }, [dispatch, sendSDRConfigToBackend]);

    const handleFFTOverlapChange = useCallback((value) => {
        const overlapPercent = Number(value) || 0;
        dispatch(setFFTOverlapPercent(overlapPercent));
        sendSDRConfigToBackend({ fftOverlapPercent: overlapPercent });
    }, [dispatch, sendSDRConfigToBackend]);

    const handleFFTOverlapDepthChange = useCallback((value) => {
        const overlapDepth = Number(value) || 16;
        dispatch(setFFTOverlapDepth(overlapDepth));
        sendSDRConfigToBackend({ fftOverlapDepth: overlapDepth });
    }, [dispatch, sendSDRConfigToBackend]);

    const handleBandscopeSmoothingChange = useCallback((value) => {
        dispatch(setBandscopeSmoothing(value));
    }, [dispatch]);

    const handleColorMapChange = useCallback((value) => {
        setLocalColorMap(value);
        dispatch(setColorMap(value));
    }, [dispatch]);

    const handleRecordingNameChange = useCallback((name) => {
        dispatch(setRecordingName(name));
    }, [dispatch]);

    const handleRecordingBandSelectionToggle = useCallback(() => {
        dispatch(setRecordingBandSelectionEnabled(!recordingBandSelectionEnabled));
    }, [dispatch, recordingBandSelectionEnabled]);

    const handleRecordingBandCenterFrequencyChange = useCallback((frequencyHz) => {
        const inputRate = Number(sampleRate);
        const maxOffset = Number.isFinite(inputRate) && inputRate > 0
            ? Math.max(0, (inputRate - inputRate / recordingDecimationFactor) / 2)
            : 0;
        const requestedOffset = Number(frequencyHz) - Number(centerFrequency);
        if (!Number.isFinite(requestedOffset)) return;
        dispatch(setRecordingBandCenterOffsetHz(
            Math.max(-maxOffset, Math.min(maxOffset, requestedOffset))
        ));
    }, [centerFrequency, dispatch, recordingDecimationFactor, sampleRate]);

    const handleRecordingBandDragStepChange = useCallback((stepHz) => {
        dispatch(setRecordingBandDragStepHz(stepHz));
    }, [dispatch]);

    const handleRecordingDecimationFactorChange = useCallback((factor) => {
        // Keep an existing selection inside the newly selected retained band.
        const inputRate = Number(sampleRate);
        const maxOffset = Number.isFinite(inputRate) && inputRate > 0
            ? Math.max(0, (inputRate - inputRate / factor) / 2)
            : 0;
        dispatch(setRecordingBandCenterOffsetHz(
            Math.max(-maxOffset, Math.min(maxOffset, recordingBandCenterOffsetHz))
        ));
        dispatch(setRecordingDecimationFactor(factor));
    }, [dispatch, recordingBandCenterOffsetHz, sampleRate]);

    const handleRecordingStorageFormatChange = useCallback((format) => {
        dispatch(setRecordingStorageFormat(format));
    }, [dispatch]);

    const handleVfoCenterFrequencyChange = useCallback((newFreq) => {
        return sendSDRConfigToBackend({centerFrequency: newFreq}).then((response) => {
            if (response?.success) dispatch(setCenterFrequency(newFreq));
            return response;
        });
    }, [dispatch, sendSDRConfigToBackend]);

    // Sync VFO tab selection when a VFO is selected on the canvas
    // Only sync when selectedVFO changes (not when tab changes manually)
    useEffect(() => {
        if (selectedVFO !== null && selectedVFO >= 1 && selectedVFO <= maxVFOMarkers) {
            const tabIndex = selectedVFO - 1; // Convert VFO number (1-4) to tab index (0-3)
            dispatch(setSelectedVFOTab(tabIndex));
        }
    }, [selectedVFO, maxVFOMarkers, dispatch]);

    // Recording timer
    useEffect(() => {
        let intervalId;
        if (isRecording) {
            intervalId = setInterval(() => {
                dispatch(incrementRecordingDuration());
            }, 1000);
        }
        return () => {
            if (intervalId) {
                clearInterval(intervalId);
            }
        };
    }, [isRecording, dispatch]);

    // Set playback start time when playback streaming starts
    useEffect(() => {
        const isPlayingback = selectedSDRId === 'sigmf-playback' && isStreaming;

        if (isPlayingback && !playbackStartTime) {
            // Playback just started, set the start time
            dispatch(setPlaybackStartTime(new Date().toISOString()));
        } else if (!isStreaming && playbackStartTime) {
            // Streaming stopped, reset start time
            dispatch(resetPlaybackStartTime());
        }
    }, [isStreaming, selectedSDRId, playbackStartTime, dispatch]);

    const handleStartRecording = (customRecordingName) => {
        // Use custom name if provided, otherwise use state
        const nameToUse = customRecordingName !== undefined ? customRecordingName : recordingName;

        const inputRate = Number(sampleRate);
        const maxOffset = Number.isFinite(inputRate) && inputRate > 0
            ? Math.max(0, (inputRate - inputRate / recordingDecimationFactor) / 2)
            : 0;
        const selectedOffset = Math.max(
            -maxOffset,
            Math.min(maxOffset, Number(recordingBandCenterOffsetHz) || 0)
        );

        dispatch(startRecording({
            socket,
            recordingName: nameToUse,
            selectedSDRId,
            decimationFactor: recordingDecimationFactor,
            storageFormat: recordingStorageFormat,
            recordingCenterFrequency: recordingBandSelectionEnabled
                ? Number(centerFrequency) + selectedOffset
                : null,
        }))
            .unwrap()
            .catch((error) => {
                toast.error(`Failed to start recording: ${error}`);
            });
    };

    const handleStopRecording = async () => {
        try {
            // Don't capture snapshot when stopping from UI - let background task generate waterfall
            // Note: The snapshot hook remains intact for other use cases
            const waterfallImage = null;

            // Enable auto-waterfall generation so background task creates the waterfall image
            dispatch(stopRecording({ socket, selectedSDRId, waterfallImage, skipAutoWaterfall: false }))
                .unwrap()
                .then(() => {
                    console.log('Recording stopped successfully');
                })
                .catch((error) => {
                    console.error('Failed to stop recording:', error);
                    toast.error(`Failed to stop recording: ${error}`);
                });
        } catch (error) {
            console.error('Error in handleStopRecording:', error);
            toast.error(`Failed to stop recording: ${error.message}`);
        }
    };

    const handleRecordingSelect = async (recording) => {
        // When a recording is selected, auto-select the sigmfplayback SDR
        const sigmfSdr = sdrs.find(sdr => sdr.type === 'sigmfplayback');

        if (sigmfSdr) {
            const current = store.getState().waterfall;
            const previous = Object.fromEntries(
                SDR_SELECTION_FIELDS.map((field) => [field, current[field]])
            );
            // Playback cards bypass the SDR selector. Inspect before changing any
            // local selection so Cancel also cancels this path in full.
            const inspection = await callSdrApi(socket, 'inspect-sdr', sigmfSdr.id);
            if (!inspection?.success) {
                toast.error(inspection?.error || 'Could not inspect SDR');
                return;
            }
            let forceTakeover = false;
            if (inspection.data?.conflict) {
                const choice = await requestTakeoverConfirmation(
                    inspection.data.conflict, 'select this playback recording'
                );
                if (choice === 'cancel') return;
                if (choice === 'join') {
                    if (inspection.data.config) {
                        dispatch(updateSDRConfig({ ...inspection.data.config, force_live: true }));
                    }
                    const response = await joinSdr(socket, dispatch, sigmfSdr.id);
                    if (!response?.success) {
                        dispatch(restoreSdrSelection(previous));
                        toast.error(response?.error || 'Could not join SDR');
                    }
                    return;
                }
                forceTakeover = true;
            }

            // Set the selected playback recording
            dispatch(setSelectedPlaybackRecording(recording));

            // Bundle recordings live below data/observations, while manual
            // recordings remain below data/recordings. The backend validates
            // the supplied playback path against both trusted roots.
            const recordingPath = recording.playback_path || recording.name;
            dispatch(setPlaybackRecordingPath(recordingPath));

            // Get sample rate from recording metadata and set it in the UI
            const recordingSampleRate = recording.metadata?.sample_rate;
            if (recordingSampleRate) {
                dispatch(setSampleRate(recordingSampleRate));
            }

            // Get center frequency from recording metadata (from captures)
            const recordingCenterFreq = recording.metadata?.captures?.[0]?.["core:frequency"];
            if (recordingCenterFreq) {
                dispatch(setCenterFrequency(recordingCenterFreq));
            }

            // Select the playback SDR before assigning its device-specific port.
            dispatch(setSelectedSDRId(sigmfSdr.id));

            // Set antenna to "RX" for sigmfplayback
            dispatch(setSelectedAntenna("RX"));
            dispatch(setFFTOverlapPercent(PLAYBACK_DEFAULT_FFT_OVERLAP_PERCENT));

            // Set gain to 0 for playback
            dispatch(setGain(0));

            // Expand the SDR accordion
            if (!expandedPanels.includes('sdr')) {
                dispatch(setExpandedPanels([...expandedPanels, 'sdr']));
            }

            const SDRSettings = {
                selectedSDRId: sigmfSdr.id,
                centerFrequency: recordingCenterFreq || centerFrequency,
                sampleRate: recordingSampleRate || sampleRate,
                gain: 0,
                fftSize: fftSize,
                biasT: biasT,
                tunerAgc: tunerAgc,
                rtlAgc: rtlAgc,
                fftWindow: fftWindow,
                fftOverlapPercent: PLAYBACK_DEFAULT_FFT_OVERLAP_PERCENT,
                fftOverlapDepth: fftOverlapDepth,
                antenna: "RX",
                soapyAgc: soapyAgc,
                offsetFrequency: selectedOffsetValue,
                fftAveraging: fftAveraging,
                recordingPath: recordingPath,
                forceTakeover,
            };

            sendSDRConfigToBackend(SDRSettings).then((response) => {
                if (response?.success) {
                    // Fetch parameters after configure-sdr has stored playback-specific config.
                    dispatch(getSDRConfigParameters({
                        socket,
                        selectedSDRId: sigmfSdr.id,
                    }));
                } else if (!response?.joined) {
                    dispatch(restoreSdrSelection(previous));
                    if (!response?.canceled && response?.error) {
                        toast.error(`Failed to configure playback: ${response.error}`);
                    }
                }
            });
        } else {
            toast.error('SigMF Playback SDR not found. Please refresh the page.');
        }
    };

    const handlePlaybackRecordingDropdownChange = (recordingName) => {
        if (!recordingName || recordingName === 'none') {
            dispatch(clearPlaybackRecording());
            return;
        }

        const recording = playbackRecordings.find(
            (item) => (item.playback_path || item.name) === recordingName
        );
        if (!recording) {
            toast.error('Recording not found. Refresh and try again.');
            return;
        }
        handleRecordingSelect(recording);
    };

    const handlePlaybackPlay = async () => {
        // Playback accordion play button handles full configuration and start
        if (!isStreaming && selectedSDRId === 'sigmf-playback' && playbackRecordingPath) {
            // First configure the SDR with playback recording
            const configureResponse = await sendSDRConfigToBackend({
                selectedSDRId: 'sigmf-playback',
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
                soapyAgc,
                fftAveraging,
                recordingPath: playbackRecordingPath,
            });
            if (!configureResponse?.success) {
                if (!configureResponse?.canceled && configureResponse?.error) {
                    toast.error(`Failed to configure playback: ${configureResponse.error}`);
                }
                return;
            }

            const startResponse = await callWithTakeoverConfirmation(
                "sdr.start-streaming",
                {
                    selectedSDRId: 'sigmf-playback',
                    forceTakeover: Boolean(configureResponse?.takeoverConfirmed),
                },
                'start playback streaming'
            );
            if (startResponse?.success) {
                dispatch(setPlaybackStartTime(new Date().toISOString()));
            } else if (!startResponse?.canceled) {
                dispatch(setErrorMessage(startResponse?.error || 'Failed to start playback stream'));
                dispatch(setErrorDialogOpen(true));
            }
        } else if (!playbackRecordingPath) {
            toast.error('Please select a recording first');
        } else if (selectedSDRId !== 'sigmf-playback') {
            toast.error('Please select SigMF Playback SDR first');
        }
    };

    const handlePlaybackStop = async () => {
        if (isStreaming && selectedSDRId === 'sigmf-playback') {
            const backgroundStreaming = store.getState().waterfall.backgroundStreaming;
            const response = backgroundStreaming
                ? await detachSdr(socket, dispatch, 'sigmf-playback')
                : await callSdrApi(socket, 'stop-streaming', 'sigmf-playback');
            if (!response?.success) {
                toast.error(response?.error || 'Could not stop playback');
                return;
            }
            if (!backgroundStreaming) {
                dispatch(setIsStreaming(false));
                dispatch(setCurrentSessionId(socket.id));
            }
            dispatch(resetPlaybackStartTime());
        }
    };

    const handleToggleAllAccordions = () => {
        const allPanels = ['vfo', 'freqControl', 'sdr', 'fft', 'recording', 'playback'];
        const allExpanded = allPanels.every(panel => expandedPanels.includes(panel));

        if (allExpanded) {
            // Collapse all
            dispatch(setExpandedPanels([]));
        } else {
            // Expand all
            dispatch(setExpandedPanels(allPanels));
        }
    };

    // The trace showed these new callback props invalidating memoized accordions
    // even when their displayed SDR/VFO settings had not changed.
    const onStartRecording = useStableEvent(handleStartRecording);
    const onStopRecording = useStableEvent(handleStopRecording);
    const onRecordingSelect = useStableEvent(handleRecordingSelect);
    const onPlaybackRecordingChange = useStableEvent(handlePlaybackRecordingDropdownChange);
    const onPlaybackPlay = useStableEvent(handlePlaybackPlay);
    const onPlaybackStop = useStableEvent(handlePlaybackStop);

    return (
        <>
            <TitleBar
                className={getClassNamesBasedOnGridEditing(gridEditable, ["window-title-bar"])}
            >
                <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%'}}>
                    <Box sx={{display: 'flex', alignItems: 'center'}}>
                        <Typography variant="subtitle2" sx={{fontWeight: 'bold'}}>
                            {t('title')}
                        </Typography>
                    </Box>
                    <IconButton
                        size="small"
                        onClick={handleToggleAllAccordions}
                        sx={{ p: 0, minWidth: 0, width: 20, height: 20 }}
                        title={expandedPanels.length === 6 ? "Collapse All" : "Expand All"}
                    >
                        {expandedPanels.length === 6 ? <UnfoldLess sx={{ fontSize: 16 }} /> : <UnfoldMore sx={{ fontSize: 16 }} />}
                    </IconButton>
                </Box>
            </TitleBar>
            <div ref={settingsScrollRef} style={{overflowY: 'auto', overflowAnchor: 'none', height: '100%', paddingBottom: '29px'}}>

                <DevRenderProfiler id="SdrAccordion">
                    <SdrAccordion
                    expanded={expandedPanels.includes('sdr')}
                    onAccordionChange={handleSdrAccordionChange}
                    readOnly={Boolean(continuousObservation)}
                    onCreateContinuousObservation={openContinuousObservation}
                    gettingSDRParameters={gettingSDRParameters}
                    isStreaming={isStreaming}
                    joinedSdrId={joinedSdrId}
                    sdrs={sdrs}
                    selectedSDRId={selectedSDRId}
                    onSDRChange={handleSDRChange}
                    onRefreshParameters={handleRefreshSDRParameters}
                    gainValues={gainValues}
                    localGain={localGain}
                    onGainChange={handleGainChange}
                    sampleRateValues={sampleRateValues}
                    localSampleRate={localSampleRate}
                    onSampleRateChange={handleSampleRateChange}
                    antennasList={antennasList}
                    selectedAntenna={selectedAntenna}
                    onAntennaChange={handleAntennaChange}
                    sdrCapabilities={sdrCapabilities}
                    sdrSettings={sdrSettings}
                    bandwidthStatus={sdrBandwidthById?.[selectedSDRId]}
                    receiverStatus={sdrReceiverById?.[selectedSDRId]}
                    onBandwidthChange={handleBandwidthChange}
                    hasBiasT={hasBiasT}
                    biasT={biasT}
                    onBiasTChange={handleBiasTChange}
                    onBitpackChange={handleBitpackChange}
                    onGainElementChange={handleGainElementChange}
                    onClockSourceChange={handleClockSourceChange}
                    onTimeSourceChange={handleTimeSourceChange}
                    hasTunerAgc={hasTunerAgc}
                    tunerAgc={tunerAgc}
                    onTunerAgcChange={handleTunerAgcChange}
                    hasSoapyAgc={hasSoapyAgc}
                    soapyAgc={soapyAgc}
                    onSoapyAgcChange={handleSoapyAgcChange}
                    hasRtlAgc={hasRtlAgc}
                    rtlAgc={rtlAgc}
                    onRtlAgcChange={handleRtlAgcChange}
                    sdrUsageByOtherSessions={sdrUsageByOtherSessions}
                    isRecording={isRecording}
                    startStreamValidationErrors={startStreamValidationErrors}
                    playbackRecordings={playbackRecordings}
                    playbackRecordingsLoading={playbackRecordingsLoading}
                    selectedPlaybackRecordingName={selectedPlaybackRecording?.playback_path || selectedPlaybackRecording?.name || playbackRecordingPath || 'none'}
                    onPlaybackRecordingChange={onPlaybackRecordingChange}
                    />
                </DevRenderProfiler>

                <DevRenderProfiler id="FrequencyControlAccordion">
                    <FrequencyControlAccordion
                    expanded={expandedPanels.includes('freqControl')}
                    onAccordionChange={handleFreqAccordionChange}
                    readOnly={Boolean(continuousObservation)}
                    centerFrequency={centerFrequency}
                    onCenterFrequencyChange={handleFrequencyDialChange}
                    availableTransmitters={runningTransmitters || []}
                    onGoToTransmitter={handleGoToTransmitter}
                    selectedOffsetMode={selectedOffsetMode}
                    onOffsetModeChange={handleOffsetModeChange}
                    selectedOffsetValue={selectedOffsetValue}
                    onOffsetValueChange={handleOffsetValueChange}
                    isRecording={isRecording}
                    selectedSDRId={selectedSDRId}
                    isStreaming={isStreaming}
                    />
                </DevRenderProfiler>

                {!continuousObservation && <DevRenderProfiler id="VfoAccordion">
                    <VfoAccordion
                    expanded={expandedPanels.includes('vfo')}
                    onAccordionChange={handleVfoAccordionChange}
                    onVFOTabChange={handleVFOTabChange}
                    onVFOActiveChange={handleVFOActiveChange}
                    onVFOPropertyChange={handleVFOPropertyChange}
                    onVFOListenChange={handleVFOListenChange}
                    onTranscriptionToggle={handleTranscriptionToggle}
                    geminiConfigured={geminiConfigured}
                    deepgramConfigured={deepgramConfigured}
                    centerFrequency={centerFrequency}
                    sampleRate={sampleRate}
                    sampleRateValues={sampleRateValues}
                    onCenterFrequencyChange={handleVfoCenterFrequencyChange}
                    onSampleRateChange={handleGnssSampleRateChange}
                    />
                </DevRenderProfiler>}

                <Box component="fieldset" disabled={Boolean(continuousObservation)} sx={{ border: 0, m: 0, p: 0, minWidth: 0 }}>
                <DevRenderProfiler id="FftAccordion">
                    <FftAccordion
                    expanded={expandedPanels.includes('fft')}
                    onAccordionChange={handleFftAccordionChange}
                    gettingSDRParameters={gettingSDRParameters}
                    fftSizeValues={fftSizeValues}
                    localFFTSize={localFFTSize}
                    onFFTSizeChange={handleFFTSizeChange}
                    fftWindowValues={fftWindowValues}
                    fftWindow={fftWindow}
                    onFFTWindowChange={handleFFTWindowChange}
                    fftAveraging={fftAveraging}
                    onFFTAveragingChange={handleFFTAveragingChange}
                    fftOverlapPercent={fftOverlapPercent}
                    onFFTOverlapChange={handleFFTOverlapChange}
                    fftOverlapDepth={fftOverlapDepth}
                    onFFTOverlapDepthChange={handleFFTOverlapDepthChange}
                    bandscopeSmoothing={bandscopeSmoothing}
                    onBandscopeSmoothingChange={handleBandscopeSmoothingChange}
                    colorMaps={colorMaps}
                    localColorMap={localColorMap}
                    onColorMapChange={handleColorMapChange}
                    />
                </DevRenderProfiler>
                </Box>

                <Box sx={{pointerEvents: joinedSdrId ? 'none' : 'auto', opacity: joinedSdrId ? 0.6 : 1}}>
                <DevRenderProfiler id="RecordingAccordion">
                    <RecordingAccordion
                    expanded={expandedPanels.includes('recording')}
                    onAccordionChange={handleRecordingAccordionChange}
                    isRecording={isRecording}
                    recordingDuration={recordingDuration}
                    recordingName={recordingName}
                    onRecordingNameChange={handleRecordingNameChange}
                    sampleRate={sampleRate}
                    decimationFactor={recordingDecimationFactor}
                    onDecimationFactorChange={handleRecordingDecimationFactorChange}
                    recordingBandSelectionEnabled={recordingBandSelectionEnabled}
                    onRecordingBandSelectionToggle={handleRecordingBandSelectionToggle}
                    recordingBandCenterOffsetHz={recordingBandCenterOffsetHz}
                    onRecordingBandCenterFrequencyChange={handleRecordingBandCenterFrequencyChange}
                    recordingBandDragStepHz={recordingBandDragStepHz}
                    onRecordingBandDragStepChange={handleRecordingBandDragStepChange}
                    storageFormat={recordingStorageFormat}
                    onStorageFormatChange={handleRecordingStorageFormatChange}
                    onStartRecording={onStartRecording}
                    onStopRecording={onStopRecording}
                    isStreaming={isStreaming}
                    selectedSDRId={selectedSDRId}
                    centerFrequency={centerFrequency}
                    />
                </DevRenderProfiler>
                </Box>

                <Box sx={{pointerEvents: joinedSdrId ? 'none' : 'auto', opacity: joinedSdrId ? 0.6 : 1}}>
                <DevRenderProfiler id="PlaybackAccordion">
                    <PlaybackAccordion
                    expanded={expandedPanels.includes('playback')}
                    onAccordionChange={handlePlaybackAccordionChange}
                    isStreaming={isStreaming}
                    selectedPlaybackRecording={selectedPlaybackRecording}
                    onRecordingSelect={onRecordingSelect}
                    onPlaybackPlay={onPlaybackPlay}
                    onPlaybackStop={onPlaybackStop}
                    playbackStartTime={playbackStartTime}
                    playbackRemainingSecondsRef={playbackRemainingSecondsRef}
                    />
                </DevRenderProfiler>
                </Box>
                {takeoverDialog}
            </div>
            {continuousObservationDraft && <ContinuousObservationSessionDialog
                key={continuousObservationDraft.id} observation={continuousObservationDraft} onClose={closeContinuousObservation} />}
        </>
    );
});

export default React.memo(WaterfallSettings);
