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


import React, {useImperativeHandle, forwardRef, useCallback, useEffect, useState, useRef, useMemo} from 'react';
import {Box, Typography, IconButton} from '@mui/material';
import {UnfoldMore, UnfoldLess} from '@mui/icons-material';
import {
    getClassNamesBasedOnGridEditing,
    TitleBar
} from "../common/common.jsx";
import { shallowEqual, useSelector, useDispatch } from 'react-redux';

import {
    applySDRConfigParameters,
    getCachedSDRConfigParameters,
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
    setTargetFPS,
    setSettingsDialogOpen,
    setAutoDBRange,
    setSdrBiasT,
    setSdrBitpack,
    setSdrGainElement,
    setSdrClockSource,
    setSdrTimeSource,
    setSdrSettings,
    setSdrSettingsApplied,
    setFFTWindow,
    setExpandedPanels,
    setSelectedSDRId,
    setSelectedAntenna,
    setSdrSoapyAgc,
    setSelectedTransmitterId,
    setSelectedOffsetMode,
    setSelectedOffsetValue,
    startRecording,
    stopRecording,
    setRecordingName,
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
import { toast } from "../../utils/toast-with-timestamp.jsx";
import getValue from "lodash/_getValue.js";
import FrequencyControlAccordion from "./settings-frequency.jsx";
import SdrAccordion from "./settings-sdr.jsx";
import FftAccordion from "./settings-fft.jsx";
import VfoAccordion from "./vfo-settings/settings-vfo.jsx";
import RecordingAccordion from "./settings-recording.jsx";
import PlaybackAccordion from "./settings-playback.jsx";
import { useTranslation } from 'react-i18next';
import { selectRunningRigTransmitters } from "../target/transmitter-selectors.js";
import { fetchFiles } from "../filebrowser/filebrowser-slice.jsx";
import { useSdrTakeoverDialog } from './use-sdr-takeover-dialog.jsx';

const PLAYBACK_DEFAULT_FFT_OVERLAP_PERCENT = 50;

const WaterfallSettings = forwardRef(function WaterfallSettings({ playbackRemainingSecondsRef }, ref) {
    const { t } = useTranslation('waterfall');
    const dispatch = useDispatch();

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
        hasBiasT,
        hasTunerAgc,
        hasRtlAgc,
        fftSizeValues,
        fftWindowValues,
        antennasList,
        selectedAntenna,
        hasSoapyAgc,
        selectedTransmitterId,
        fftAveraging,
        bandscopeSmoothing,
        isRecording,
        recordingDuration,
        recordingName,
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
            hasBiasT: state.waterfall.hasBiasT,
            hasTunerAgc: state.waterfall.hasTunerAgc,
            hasRtlAgc: state.waterfall.hasRtlAgc,
            fftSizeValues: state.waterfall.fftSizeValues,
            fftWindowValues: state.waterfall.fftWindowValues,
            antennasList: state.waterfall.antennasList,
            selectedAntenna: state.waterfall.selectedAntenna,
            hasSoapyAgc: state.waterfall.hasSoapyAgc,
            selectedTransmitterId: state.waterfall.selectedTransmitterId,
            fftAveraging: state.waterfall.fftAveraging,
            bandscopeSmoothing: state.waterfall.bandscopeSmoothing,
            isRecording: state.waterfall.isRecording,
            recordingDuration: state.waterfall.recordingDuration,
            recordingName: state.waterfall.recordingName,
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

    const {
        selectedVFO,
        vfoMarkers,
        maxVFOMarkers,
        selectedVFOTab,
        vfoActive,
        vfoColors,
    } = useSelector((state) => state.vfo);

    const runningTransmitters = useSelector(selectRunningRigTransmitters);

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
        files: filebrowserFiles,
        filesLoading: filebrowserLoading,
        filters: filebrowserFilters,
    } = useSelector((state) => state.filebrowser, shallowEqual);

    const {
        preferences
    } = useSelector((state) => state.preferences);

    // Build a map of SDR IDs actively streaming for sessions other than this browser session.
    // We require live consumer/runtime evidence and do not treat "selected SDR only" as in-use.
    const sdrUsageByOtherSessions = useMemo(() => {
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
    const showSnapshotsFilter = filebrowserFilters?.showSnapshots ?? true;
    const showDecodedFilter = filebrowserFilters?.showDecoded ?? true;
    const showAudioFilter = filebrowserFilters?.showAudio ?? true;
    const showTranscriptionsFilter = filebrowserFilters?.showTranscriptions ?? true;

    const {socket} = useSocket();

    const playbackRecordings = useMemo(() => {
        const recordings = (filebrowserFiles || []).filter((file) => file.type === 'recording');
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
    }, [filebrowserFiles]);

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
        if (selectedSDRId && !hasInitializedRef.current) {
            hasInitializedRef.current = true;
            handleSDRChange({target: {value: selectedSDRId}});
        }
        // No cleanup function - let the ref stay true to prevent any subsequent calls for StrictMode
    }, []);

    useEffect(() => {
        if (!socket || selectedSDRId !== 'sigmf-playback') {
            return;
        }
        dispatch(fetchFiles({
            socket,
            showRecordings: true,
            showSnapshots: showSnapshotsFilter,
            showDecoded: showDecodedFilter,
            showAudio: showAudioFilter,
            showTranscriptions: showTranscriptionsFilter,
        }));
    }, [
        dispatch,
        socket,
        selectedSDRId,
        showSnapshotsFilter,
        showDecodedFilter,
        showAudioFilter,
        showTranscriptionsFilter,
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
            if (!socket) {
                resolve({ success: false, error: 'Socket is not connected' });
                return;
            }
            socket.emit(
                "api.call",
                {
                    cmd,
                    data: payload,
                },
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

        const confirmed = await requestTakeoverConfirmation(conflict, actionLabel);
        if (!confirmed) {
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
    }, [emitApiCall, getSdrInUseConflict, requestTakeoverConfirmation]);

    // Convert to useCallback to ensure stability of the function reference
    const sendSDRConfigToBackend = useCallback((updates = {}) => {
            const targetSDRId = updates.selectedSDRId ?? selectedSDRId;
            const effectivePlaybackRecordingPath = updates.recordingPath ?? playbackRecordingPath;
            if (targetSDRId !== "none" && targetSDRId !== "") {
                // For sigmfplayback, NEVER send configure without a recording path
                // This prevents overwriting the session with empty recording_path
                if (targetSDRId === "sigmf-playback" && !effectivePlaybackRecordingPath) {
                    return;
                }

                let SDRSettings = {
                    selectedSDRId: targetSDRId,
                    centerFrequency: centerFrequency,
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

                return callWithTakeoverConfirmation(
                    "sdr.configure-sdr",
                    SDRSettings,
                    operationLabel
                ).then((response) => {
                    if (response?.success) {
                        applySdrSettingsLocally(SDRSettings);
                    }
                    return response;
                });
            }
            return Promise.resolve({ success: false, skipped: true });
        }, [
            selectedSDRId,
            centerFrequency,
            sampleRate,
            gain,
            fftSize,
            fftWindow,
            fftOverlapPercent,
            fftOverlapDepth,
            fftAveraging,
            biasT,
            tunerAgc,
            rtlAgc,
            selectedOffsetValue,
            playbackRecordingPath,
            selectedAntenna,
            soapyAgc,
            sdrSettingsById,
            callWithTakeoverConfirmation,
            dispatch,
        ]
    );

    const applyLoadedSDRParameters = useCallback((selectedValue, response) => {
        const caps = response?.capabilities || {};
        const rxGainElements = Array.isArray(caps?.gain_elements?.rx)
            ? caps.gain_elements.rx
            : [];
        const hasBitpackSetting = Array.isArray(caps?.settings)
            ? caps.settings.some((setting) => {
                const key = (setting?.key || '').toLowerCase();
                const name = (setting?.name || '').toLowerCase();
                return key === 'bitpack' || name.includes('bit pack');
            })
            : false;

        const existingSettings = sdrSettingsById?.[selectedValue]?.draft || {};
        const nextSdrSettings = {
            ...(existingSettings || {}),
            gains: {
                ...(existingSettings?.gains || {}),
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

        dispatch(setSdrSettings({ sdrId: selectedValue, settings: nextSdrSettings }));
        dispatch(setSdrSettingsApplied({ sdrId: selectedValue, settings: nextSdrSettings }));
        sendSDRConfigToBackend({
            selectedSDRId: selectedValue,
            sdrSettings: nextSdrSettings,
        });
    }, [dispatch, sdrSettingsById, sendSDRConfigToBackend]);

    const loadSDRParameters = useCallback((selectedValue, { forceRefresh = false } = {}) => {
        if (!forceRefresh) {
            const cached = getCachedSDRConfigParameters(selectedValue);
            if (cached) {
                dispatch(applySDRConfigParameters({ selectedSDRId: selectedValue, data: cached }));
                return Promise.resolve(cached);
            }
        }

        return dispatch(getSDRConfigParameters({
            socket,
            selectedSDRId: selectedValue,
            forceRefresh,
        })).unwrap();
    }, [dispatch, socket]);

    // Convert to useCallback to ensure stability of the function reference
    const handleSDRChange = useCallback((event) => {
        // Check what was selected
        const selectedValue = typeof event === 'object' ? event.target.value : event;

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
            loadSDRParameters(selectedValue)
                .then((response) => {
                    applyLoadedSDRParameters(selectedValue, response);
                })
                .catch(error => {
                    // Error occurred while getting SDR parameters
                    dispatch(setErrorMessage(error));
                    dispatch(setErrorDialogOpen(true));
                });
        }
    }, [dispatch, loadSDRParameters, applyLoadedSDRParameters, getDefaultFFTOverlapPercentForSDR]);

    const handleRefreshSDRParameters = useCallback(() => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }

        loadSDRParameters(selectedSDRId, { forceRefresh: true })
            .then((response) => {
                applyLoadedSDRParameters(selectedSDRId, response);
            })
            .catch((error) => {
                dispatch(setErrorMessage(error));
                dispatch(setErrorDialogOpen(true));
            });
    }, [selectedSDRId, loadSDRParameters, applyLoadedSDRParameters, dispatch]);

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
        return sendSDRConfigToBackend({gain: gain});
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
        dispatch(setSdrClockSource({ sdrId: selectedSDRId, value }));
        return sendSDRConfigToBackend({
            sdrSettings: {
                ...(sdrSettings || {}),
                clockSource: value,
            },
        });
    };

    const updateTimeSource = (value) => (dispatch) => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }
        dispatch(setSdrTimeSource({ sdrId: selectedSDRId, value }));
        return sendSDRConfigToBackend({
            sdrSettings: {
                ...(sdrSettings || {}),
                timeSource: value,
            },
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

    const handleTransmitterChange = useCallback((event) => {
        // If a transmitter was selected, then set the SDR center frequency
        dispatch(setSelectedTransmitterId(event.target.value));

        // Handle "none" selection - don't update frequency
        if (event.target.value === "none") {
            return;
        }

        const selectedTransmitterMetadata = (runningTransmitters || []).find((t) => t.id === event.target.value);
        if (!selectedTransmitterMetadata) {
            return;
        }

        const targetFrequency = selectedTransmitterMetadata['downlink_low'] || 0;

        // Calculate offset to avoid DC spike at center.
        // If sample rate is unset (e.g., "none"), fall back to no offset.
        const parsedSampleRate = typeof sampleRate === 'number' ? sampleRate : Number(sampleRate);
        const offsetHz = Number.isFinite(parsedSampleRate) ? parsedSampleRate * 0.25 : 0;
        const newCenterFrequency = targetFrequency + offsetHz;

        dispatch(setCenterFrequency(newCenterFrequency));
        sendSDRConfigToBackend({centerFrequency: newCenterFrequency});
    }, [dispatch, runningTransmitters, sampleRate, sendSDRConfigToBackend]);

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

    const getProperTransmitterId = useCallback(() => {
        const transmitters = runningTransmitters || [];
        if (transmitters.length > 0 && selectedTransmitterId) {
            if (transmitters.find(t => t.id === selectedTransmitterId)) {
                return selectedTransmitterId;
            } else {
                return "none";
            }
        } else {
            return "none";
        }
    }, [runningTransmitters, selectedTransmitterId]);

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
        sendSDRConfigToBackend({gain: value});
    }, [dispatch, sendSDRConfigToBackend]);

    const handleSampleRateChange = useCallback((value) => {
        dispatch(setSampleRate(value));
        if (value !== 'none' && value !== null && value !== undefined) {
            dispatch(clearStartStreamValidationError('sampleRate'));
        }
        sendSDRConfigToBackend({sampleRate: value});
    }, [dispatch, sendSDRConfigToBackend]);

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

    const handleClockSourceChange = useCallback((value) => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }
        dispatch(setSdrClockSource({ sdrId: selectedSDRId, value }));
        sendSDRConfigToBackend({
            sdrSettings: {
                ...(sdrSettings || {}),
                clockSource: value,
            },
        });
    }, [dispatch, selectedSDRId, sdrSettings, sendSDRConfigToBackend]);

    const handleTimeSourceChange = useCallback((value) => {
        if (!selectedSDRId || selectedSDRId === "none") {
            return;
        }
        dispatch(setSdrTimeSource({ sdrId: selectedSDRId, value }));
        sendSDRConfigToBackend({
            sdrSettings: {
                ...(sdrSettings || {}),
                timeSource: value,
            },
        });
    }, [dispatch, selectedSDRId, sdrSettings, sendSDRConfigToBackend]);

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

    const handleVFOPropertyChange = useCallback((vfoNumber, updates) => {
        dispatch(setVFOProperty({ vfoNumber, updates }));
    }, [dispatch]);

    const handleVFOActiveChange = useCallback((vfoNumber, isActive) => {
        if (isActive) {
            dispatch(setVfoActive(vfoNumber));
        } else {
            dispatch(setVfoInactive(vfoNumber));
        }
    }, [dispatch]);

    const handleVFOListenChange = useCallback((vfoNumber, isListening) => {
        if (isListening) {
            dispatch(setSelectedVFO(vfoNumber));
        } else {
            dispatch(setSelectedVFO(null));
        }
    }, [dispatch]);

    const handleTranscriptionToggle = useCallback((vfoNumber, enabled, provider = 'gemini') => {
        // Use VFO's existing values, fallback to default
        const currentVfo = vfoMarkers[vfoNumber];
        const language = currentVfo?.transcriptionLanguage || 'auto';
        const translateTo = currentVfo?.transcriptionTranslateTo || 'none';

        socket.emit("api.call", {
  cmd: 'toggle-transcription',
  data: {
    vfoNumber,
    enabled,
    language,
    translateTo,
    provider
  }
}, response => {
  if (response.success) {
    // Update VFO state in Redux - update enabled flag and provider
    dispatch(setVFOProperty({
      vfoNumber,
      updates: {
        transcriptionEnabled: enabled,
        transcriptionProvider: provider
      }
    }));

    // Update transcription active state in Redux
    dispatch(setTranscriptionActive(enabled));
  } else {
    toast.error(t('vfo.transcription_error', `Failed to toggle transcription: ${response.error}`));
  }
});
    }, [dispatch, socket, t, vfoMarkers]);

    const handleVFOTabChange = useCallback((newValue) => {
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

    const handleVfoCenterFrequencyChange = useCallback((newFreq) => {
        dispatch(setCenterFrequency(newFreq));
        sendSDRConfigToBackend({centerFrequency: newFreq});
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

        dispatch(startRecording({ socket, recordingName: nameToUse, selectedSDRId }))
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

    const handleRecordingSelect = (recording) => {
        // When a recording is selected, auto-select the sigmfplayback SDR
        const sigmfSdr = sdrs.find(sdr => sdr.type === 'sigmfplayback');

        if (sigmfSdr) {
            // Set the selected playback recording
            dispatch(setSelectedPlaybackRecording(recording));

            // Just send the recording name, backend will resolve the full path
            const recordingPath = recording.name;
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

            // Set antenna to "RX" for sigmfplayback
            dispatch(setSelectedAntenna("RX"));
            dispatch(setFFTOverlapPercent(PLAYBACK_DEFAULT_FFT_OVERLAP_PERCENT));

            // Set gain to 0 for playback
            dispatch(setGain(0));

            // Auto-select the SigMF Playback SDR
            dispatch(setSelectedSDRId(sigmfSdr.id));

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
            };

            sendSDRConfigToBackend(SDRSettings).then((response) => {
                if (response?.success) {
                    // Fetch parameters after configure-sdr has stored playback-specific config.
                    dispatch(getSDRConfigParameters({
                        socket,
                        selectedSDRId: sigmfSdr.id,
                    }));
                } else if (!response?.canceled) {
                    toast.error(`Failed to configure playback: ${response?.error || 'Unknown error'}`);
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

        const recording = playbackRecordings.find((item) => item.name === recordingName);
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
                if (!configureResponse?.canceled) {
                    toast.error(
                        `Failed to configure playback: ${configureResponse?.error || 'Unknown error'}`
                    );
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
                toast.error(`Failed to start playback stream: ${startResponse?.error || 'Unknown error'}`);
            }
        } else if (!playbackRecordingPath) {
            toast.error('Please select a recording first');
        } else if (selectedSDRId !== 'sigmf-playback') {
            toast.error('Please select SigMF Playback SDR first');
        }
    };

    const handlePlaybackStop = () => {
        // Playback accordion stop button only stops playback streaming
        if (isStreaming && selectedSDRId === 'sigmf-playback') {
            socket.emit("api.call", {
  cmd: "sdr.stop-streaming",
  data: {
    selectedSDRId: 'sigmf-playback'
  }
});
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
            <div style={{overflowY: 'auto', height: '100%', paddingBottom: '29px'}}>

                <SdrAccordion
                    expanded={expandedPanels.includes('sdr')}
                    onAccordionChange={handleSdrAccordionChange}
                    gettingSDRParameters={gettingSDRParameters}
                    isStreaming={isStreaming}
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
                    playbackRecordingsLoading={filebrowserLoading}
                    selectedPlaybackRecordingName={selectedPlaybackRecording?.name || playbackRecordingPath || 'none'}
                    onPlaybackRecordingChange={handlePlaybackRecordingDropdownChange}
                />

                <FrequencyControlAccordion
                    expanded={expandedPanels.includes('freqControl')}
                    onAccordionChange={handleFreqAccordionChange}
                    centerFrequency={centerFrequency}
                    onCenterFrequencyChange={handleFrequencyDialChange}
                    availableTransmitters={runningTransmitters || []}
                    getProperTransmitterId={getProperTransmitterId}
                    onTransmitterChange={handleTransmitterChange}
                    selectedOffsetMode={selectedOffsetMode}
                    onOffsetModeChange={handleOffsetModeChange}
                    selectedOffsetValue={selectedOffsetValue}
                    onOffsetValueChange={handleOffsetValueChange}
                    isRecording={isRecording}
                    selectedSDRId={selectedSDRId}
                    isStreaming={isStreaming}
                />

                <VfoAccordion
                    expanded={expandedPanels.includes('vfo')}
                    onAccordionChange={handleVfoAccordionChange}
                    selectedVFOTab={selectedVFOTab}
                    onVFOTabChange={handleVFOTabChange}
                    vfoColors={vfoColors}
                    vfoMarkers={vfoMarkers}
                    vfoActive={vfoActive}
                    onVFOActiveChange={handleVFOActiveChange}
                    onVFOPropertyChange={handleVFOPropertyChange}
                    selectedVFO={selectedVFO}
                    onVFOListenChange={handleVFOListenChange}
                    onTranscriptionToggle={handleTranscriptionToggle}
                    geminiConfigured={geminiConfigured}
                    deepgramConfigured={deepgramConfigured}
                    centerFrequency={centerFrequency}
                    sampleRate={sampleRate}
                    onCenterFrequencyChange={handleVfoCenterFrequencyChange}
                />

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

                <RecordingAccordion
                    expanded={expandedPanels.includes('recording')}
                    onAccordionChange={handleRecordingAccordionChange}
                    isRecording={isRecording}
                    recordingDuration={recordingDuration}
                    recordingName={recordingName}
                    onRecordingNameChange={handleRecordingNameChange}
                    onStartRecording={handleStartRecording}
                    onStopRecording={handleStopRecording}
                    isStreaming={isStreaming}
                    selectedSDRId={selectedSDRId}
                    centerFrequency={centerFrequency}
                />

                <PlaybackAccordion
                    expanded={expandedPanels.includes('playback')}
                    onAccordionChange={handlePlaybackAccordionChange}
                    isStreaming={isStreaming}
                    selectedPlaybackRecording={selectedPlaybackRecording}
                    onRecordingSelect={handleRecordingSelect}
                    onPlaybackPlay={handlePlaybackPlay}
                    onPlaybackStop={handlePlaybackStop}
                    playbackStartTime={playbackStartTime}
                    playbackRemainingSecondsRef={playbackRemainingSecondsRef}
                />
                {takeoverDialog}
            </div>
        </>
    );
});

export default React.memo(WaterfallSettings);
