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



import { createSlice } from '@reduxjs/toolkit';
import {createAsyncThunk} from '@reduxjs/toolkit';
import {useRef, useState} from "react";
import {setSelectedTransmitter} from "../target/target-slice.jsx";
import {getAvailableColorMaps} from "./worker-modules/color-maps.js";

// Mobile detection
const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

const getDefaultWaterfallRendererMode = () => {
    return 'worker';
};

export const getSDRConfigParameters = createAsyncThunk(
    'waterfall/getSDRConfigParameters',
    async ({socket, selectedSDRId}, {rejectWithValue}) => {
        // The backend cache owns freshness and serializes probes with worker startup.
        return new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: 'get-sdr-parameters',
  data: selectedSDRId
}, response => {
  if (response.success) {
    resolve(response.data);
  } else {
    reject(rejectWithValue(response.error));
  }
});
        });
    }
);

function applySDRConfigParametersToState(state, payload, sdrId) {
    state.gainValues = payload['gain_values'];
    state.sampleRateValues = payload['sample_rate_values'];
    if (sdrId) {
        state.sdrCapabilities[sdrId] = payload['capabilities'] || {};
    }
    state.hasBiasT = payload['has_bias_t'];
    state.hasTunerAgc = payload['has_tuner_agc'];
    state.hasRtlAgc = payload['has_rtl_agc'];
    state.fftSizeValues = payload['fft_size_values'];
    state.fftWindowValues = payload['fft_window_values'];
    state.antennasList = payload['antennas'];
    state.hasSoapyAgc = payload['has_soapy_agc'];
}

export const startRecording = createAsyncThunk(
    'waterfall/startRecording',
    async ({socket, recordingName, selectedSDRId, decimationFactor = 1, storageFormat = 'cf32_le', recordingCenterFrequency = null}, {getState, rejectWithValue}) => {
        return new Promise((resolve, reject) => {
            const state = getState();
            const targetNoradId = state.targetSatTrack?.trackingState?.norad_id || '';
            const targetSatelliteName = state.targetSatTrack?.satelliteData?.details?.name || '';

            socket.emit("api.call", {
  cmd: "sdr.start-recording",
  data: {
    recordingName,
    selectedSDRId,
    decimationFactor,
    storageFormat,
    recordingCenterFrequency,
    targetSatelliteNoradId: targetNoradId,
    targetSatelliteName: targetSatelliteName
  }
}, response => {
  if (response && response.success) {
    resolve(response.data);
  } else {
    reject(rejectWithValue(response?.error || 'Failed to start recording'));
  }
});
        });
    }
);

export const stopRecording = createAsyncThunk(
    'waterfall/stopRecording',
    async ({socket, selectedSDRId, waterfallImage, skipAutoWaterfall}, {rejectWithValue}) => {
        return new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: "sdr.stop-recording",
  data: {
    selectedSDRId,
    waterfallImage,
    skipAutoWaterfall
  }
}, response => {
  if (response && response.success) {
    resolve(response.data);
  } else {
    reject(rejectWithValue(response?.error || 'Failed to stop recording'));
  }
});
        });
    }
);

export const saveWaterfallSnapshot = createAsyncThunk(
    'waterfall/saveWaterfallSnapshot',
    async ({socket, waterfallImage, snapshotName}, {getState, rejectWithValue}) => {
        const target = getState().targetSatTrack;
        // Snapshot pixels do not retain structured satellite identity. Save
        // the current target alongside them so NORAD search remains possible.
        const metadata = {
            target_satellite_name: target?.satelliteData?.details?.name || '',
            target_satellite_norad_id: target?.trackingState?.norad_id || '',
        };
        return new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: "sdr.save-waterfall-snapshot",
  data: {
    waterfallImage,
    snapshotName: snapshotName || '',
    metadata,
  }
}, response => {
  if (response && response.success) {
    resolve(response.data);
  } else {
    reject(rejectWithValue(response?.error || 'Failed to save waterfall snapshot'));
  }
});
        });
    }
);

const initialState = {
    waterfallRendererMode: getDefaultWaterfallRendererMode(), // internal: 'worker' | 'dom-tiles'
    fftDataOverflow: false,
    fftDataOverflowLimit: 20,
    colorMaps: getAvailableColorMaps(),
    colorMap: 'cosmic',
    dbRange: [-80, -20],
    //fftSizeOptions: [256, 512, 1024, 2048, 4096, 8192, 16384, 32768, 65536],
    fftSizeOptions: [1024, 2048, 4096, 8192, 16384, 32768, 65536],
    fftSize: 16384,
    fftWindow: 'hanning',
    fftWindows: ['hanning', 'hamming', 'blackman', 'kaiser', 'bartlett'],
    fftAveraging: 1,
    fftOverlapPercent: 50,
    fftOverlapDepth: 16,
    bandscopeSmoothing: 'medium',
    // Keep throttling logic available, but disable rate limiting by default.
    bandscopeRateLimitEnabled: false,
    gain: "none",
    rtlGains: [0, 0.9, 1.4, 2.7, 3.7, 7.7, 8.7, 12.5, 14.4, 15.7, 16.6, 19.7, 20.7, 22.9, 25.4,
        28.0, 29.7, 32.8, 33.8, 36.4, 37.2, 38.6, 40.2, 42.1, 43.4, 43.9, 44.5, 48.0, 49.6],
    sampleRate: "none",
    centerFrequency: 100000000,
    selectedOffsetMode: "",
    selectedOffsetValue: 0,
    errorMessage: null,
    errorDialogOpen: false,
    isStreaming: false,
    joinedSdrId: null,
    isPlaying: false,
    targetFPS: 10,
    settingsDialogOpen: false,
    autoDBRange: false,
    gridEditable: false,
    //waterFallCanvasWidth: isMobile? 4096: 32767,
    //waterFallVisualWidth: isMobile? 4096: 32767,
    waterFallCanvasWidth: isMobile? 4096: 16384,
    waterFallVisualWidth: isMobile? 4096: 16384,
    //waterFallCanvasWidth: isMobile? 4096: 8192,
    //waterFallVisualWidth: isMobile? 4096: 8192,
    //waterFallCanvasWidth: isMobile? 4096: 8191,
    //waterFallVisualWidth: isMobile? 4096: 8191,
    //waterFallCanvasWidth: 4096,
    //waterFallVisualWidth: 4096,
    waterFallCanvasHeight: 1200,
    //bandScopeHeight: 125,
    bandScopeHeight: 160,
    frequencyScaleHeight: 20,
    waterFallScaleX: 1,
    waterFallPositionX: 0,
    showRightSideWaterFallAccessories: true,
    showLeftSideWaterFallAccessories: true,
    expandedPanels: ['recording', 'playback', 'sdr', 'freqControl', 'fft', 'vfo'],
    selectedSDRId: "none",
    startStreamingLoading: false,
    gettingSDRParameters: false,
    gainValues: [],
    sampleRateValues: [],
    sdrCapabilities: {},
    sdrSettingsById: {},
    hasBiasT: false,
    hasTunerAgc: false,
    hasRtlAgc: false,
    fftSizeValues: [],
    fftWindowValues: [],
    antennasList: {
        'tx': [],
        'rx': [],
    },
    hasSoapyAgc: false,
    selectedAntenna: 'none',
    startStreamValidationErrors: {
        sdr: false,
        gain: false,
        sampleRate: false,
        antenna: false,
    },
    bookmarks: [],
    showRotatorDottedLines: true,
    autoScalePreset: 'weak',
    // Recording state
    isRecording: false,
    recordingDuration: 0,
    recordingStartTime: null, // ISO timestamp when recording started
    recordingName: '',
    recordingDecimationFactor: 1,
    recordingStorageFormat: 'cf32_le',
    // A selected recording band is optional. Keeping its offset (rather than
    // an absolute frequency) lets it follow normal SDR tuning changes.
    recordingBandSelectionEnabled: false,
    recordingBandCenterOffsetHz: 0,
    recordingBandDragStepHz: 1000,
    // Playback state
    selectedPlaybackRecording: null, // Selected recording for playback
    playbackRecordingPath: '', // Path to the selected recording file
    playbackStartTime: null, // ISO timestamp when playback started
    // Packets drawer state
    packetsDrawerOpen: false,
    packetsDrawerHeight: 250,
    // Neighboring transmitters (doppler-shifted transmitters within bandwidth)
    neighboringTransmitters: [],
    showNeighboringTransmitters: true,
    showBookmarkSources: {
        manual: true,
        satdump: true,
        satnogs: true,
        'gr-satellites': true,
        tinygs: true,
    },
};

// Add these new reducers to your createSlice
export const waterfallSlice = createSlice({
    name: 'waterfallState',
    initialState: initialState,
    reducers: {
        setColorMap: (state, action) => {
            state.colorMap = action.payload;
        },
        setWaterfallRendererMode: (state, action) => {
            state.waterfallRendererMode = action.payload;
        },
        setColorMaps: (state, action) => {
            state.colorMaps = action.payload;
        },
        setDbRange: (state, action) => {
            state.dbRange = action.payload;
        },
        setFFTSize: (state, action) => {
            state.fftSize = action.payload;
        },
        setFFTSizeOptions: (state, action) => {
            state.fftSizeOptions = action.payload;
        },
        setGain: (state, action) => {
            state.gain = action.payload;
        },
        setSampleRate: (state, action) => {
            state.sampleRate = action.payload;
        },
        setCenterFrequency: (state, action) => {
            state.centerFrequency = action.payload;
        },
        setSelectedOffsetMode: (state, action) => {
            state.selectedOffsetMode = action.payload;
        },
        setSelectedOffsetValue: (state, action) => {
            state.selectedOffsetValue = action.payload;
        },
        setErrorMessage: (state, action) => {
            state.errorMessage = action.payload;
        },
        setIsStreaming: (state, action) => {
            state.isStreaming = action.payload;
        },
        setJoinedSdrId: (state, action) => {
            state.joinedSdrId = action.payload;
        },
        setTargetFPS: (state, action) => {
            state.targetFPS = action.payload;
        },
        setIsPlaying: (state, action) => {
            state.isPlaying = action.payload;
        },
        setSettingsDialogOpen: (state, action) => {
            state.settingsDialogOpen = action.payload;
        },
        setAutoDBRange: (state, action) => {
            state.autoDBRange = action.payload;
        },
        setGridEditable: (state, action) => {
            state.gridEditable = action.payload;
        },
        setSdrBiasT: (state, action) => {
            const { sdrId, value } = action.payload || {};
            if (!sdrId) {
                return;
            }
            if (!state.sdrSettingsById[sdrId]) {
                state.sdrSettingsById[sdrId] = { draft: {}, applied: {} };
            }
            state.sdrSettingsById[sdrId].draft.biasT = value;
        },
        setSdrBitpack: (state, action) => {
            const { sdrId, value } = action.payload || {};
            if (!sdrId) {
                return;
            }
            if (!state.sdrSettingsById[sdrId]) {
                state.sdrSettingsById[sdrId] = { draft: {}, applied: {} };
            }
            state.sdrSettingsById[sdrId].draft.bitpack = value;
        },
        setSdrGainElement: (state, action) => {
            const { sdrId, name, value } = action.payload || {};
            if (!sdrId || !name) {
                return;
            }
            if (!state.sdrSettingsById[sdrId]) {
                state.sdrSettingsById[sdrId] = { draft: {}, applied: {} };
            }
            const existing = state.sdrSettingsById[sdrId].draft.gains || {};
            state.sdrSettingsById[sdrId].draft.gains = {
                ...existing,
                [name]: value,
            };
        },
        setSdrClockSource: (state, action) => {
            const { sdrId, value } = action.payload || {};
            if (!sdrId) {
                return;
            }
            if (!state.sdrSettingsById[sdrId]) {
                state.sdrSettingsById[sdrId] = { draft: {}, applied: {} };
            }
            state.sdrSettingsById[sdrId].draft.clockSource = value ?? null;
        },
        setSdrTimeSource: (state, action) => {
            const { sdrId, value } = action.payload || {};
            if (!sdrId) {
                return;
            }
            if (!state.sdrSettingsById[sdrId]) {
                state.sdrSettingsById[sdrId] = { draft: {}, applied: {} };
            }
            state.sdrSettingsById[sdrId].draft.timeSource = value ?? null;
        },
        setSdrSettings: (state, action) => {
            const { sdrId, settings } = action.payload || {};
            if (!sdrId) {
                return;
            }
            if (!state.sdrSettingsById[sdrId]) {
                state.sdrSettingsById[sdrId] = { draft: {}, applied: {} };
            }
            state.sdrSettingsById[sdrId].draft = {
                ...(state.sdrSettingsById[sdrId].draft || {}),
                ...(settings || {}),
            };
        },
        setSdrSettingsApplied: (state, action) => {
            const { sdrId, settings } = action.payload || {};
            if (!sdrId) {
                return;
            }
            if (!state.sdrSettingsById[sdrId]) {
                state.sdrSettingsById[sdrId] = { draft: {}, applied: {} };
            }
            state.sdrSettingsById[sdrId].applied = {
                ...(state.sdrSettingsById[sdrId].applied || {}),
                ...(settings || {}),
            };
        },
        setSdrTunerAgc: (state, action) => {
            const { sdrId, value } = action.payload || {};
            if (!sdrId) {
                return;
            }
            if (!state.sdrSettingsById[sdrId]) {
                state.sdrSettingsById[sdrId] = { draft: {}, applied: {} };
            }
            state.sdrSettingsById[sdrId].draft.tunerAgc = value;
        },
        setSdrRtlAgc: (state, action) => {
            const { sdrId, value } = action.payload || {};
            if (!sdrId) {
                return;
            }
            if (!state.sdrSettingsById[sdrId]) {
                state.sdrSettingsById[sdrId] = { draft: {}, applied: {} };
            }
            state.sdrSettingsById[sdrId].draft.rtlAgc = value;
        },
        setSdrSoapyAgc: (state, action) => {
            const { sdrId, value } = action.payload || {};
            if (!sdrId) {
                return;
            }
            if (!state.sdrSettingsById[sdrId]) {
                state.sdrSettingsById[sdrId] = { draft: {}, applied: {} };
            }
            state.sdrSettingsById[sdrId].draft.soapyAgc = value;
        },
        setFFTWindow: (state, action) => {
            state.fftWindow = action.payload;
        },
        setWaterFallCanvasWidth: (state, action) => {
            state.waterFallCanvasWidth = action.payload;
        },
        setWaterFallVisualWidth: (state, action) => {
            state.waterFallVisualWidth = action.payload;
        },
        setWaterFallScaleX: (state, action) => {
            state.waterFallScaleX = action.payload;
        },
        setWaterFallPositionX: (state, action) => {
            state.waterFallPositionX = action.payload;
        },
        setExpandedPanels(state, action) {
            state.expandedPanels = action.payload;
        },
        setSelectedSDRId(state, action) {
            state.selectedSDRId = action.payload;
        },
        selectSdrForJoin(state, action) {
            if (state.selectedSDRId !== action.payload) {
                // Capability choices from a previously selected device must not
                // appear as available controls for a joined SDR.
                state.gainValues = [];
                state.sampleRateValues = [];
                state.fftSizeValues = [];
                state.fftWindowValues = [];
                state.antennasList = { tx: [], rx: [] };
                state.hasBiasT = false;
                state.hasTunerAgc = false;
                state.hasRtlAgc = false;
                state.hasSoapyAgc = false;
            }
            state.selectedSDRId = action.payload;
        },
        restoreSdrSelection(state, action) {
            // A canceled selection must restore both its controls and capability lists.
            Object.assign(state, action.payload);
        },
        setStartStreamingLoading(state, action) {
            state.startStreamingLoading = action.payload;
        },
        setErrorDialogOpen(state, action) {
            state.errorDialogOpen = action.payload;
        },
        setWaterFallCanvasHeight(state, action) {
            state.waterFallCanvasHeight = action.payload;
        },
        setBandScopeHeight(state, action) {
            state.bandScopeHeight = action.payload;
        },
        setFrequencyScaleHeight(state, action) {
            state.frequencyScaleHeight = action.payload;
        },
        setShowRightSideWaterFallAccessories(state, action) {
            state.showRightSideWaterFallAccessories = action.payload;
        },
        setShowLeftSideWaterFallAccessories(state, action) {
            state.showLeftSideWaterFallAccessories = action.payload;
        },
        setBookMarks(state, action) {
            state.bookmarks = action.payload;
        },
        setSelectedAntenna(state, action) {
            state.selectedAntenna = action.payload;
        },
        setStartStreamValidationErrors(state, action) {
            const payload = action.payload || {};
            state.startStreamValidationErrors = {
                sdr: Boolean(payload.sdr),
                gain: Boolean(payload.gain),
                sampleRate: Boolean(payload.sampleRate),
                antenna: Boolean(payload.antenna),
            };
        },
        clearStartStreamValidationErrors(state) {
            state.startStreamValidationErrors = {
                sdr: false,
                gain: false,
                sampleRate: false,
                antenna: false,
            };
        },
        clearStartStreamValidationError(state, action) {
            const field = action.payload;
            if (!['sdr', 'gain', 'sampleRate', 'antenna'].includes(field)) {
                return;
            }
            state.startStreamValidationErrors[field] = false;
        },
        setHasSoapyAgc(state, action) {
            state.hasSoapyAgc = action.payload;
        },
        setFFTdataOverflow: (state, action) => {
            state.fftDataOverflow = action.payload;
        },
        setFFTAveraging: (state, action) => {
            state.fftAveraging = action.payload;
        },
        setFFTOverlapPercent: (state, action) => {
            state.fftOverlapPercent = action.payload;
        },
        setFFTOverlapDepth: (state, action) => {
            state.fftOverlapDepth = action.payload;
        },
        setBandscopeSmoothing: (state, action) => {
            state.bandscopeSmoothing = action.payload;
        },
        setBandscopeRateLimitEnabled: (state, action) => {
            state.bandscopeRateLimitEnabled = action.payload;
        },
        updateSDRConfig: (state, action) => {
            // Update all SDR configuration parameters at once
            const config = action.payload;
            if (config.center_freq !== undefined) state.centerFrequency = config.center_freq;
            if (config.sample_rate !== undefined) {
                state.sampleRate = config.sample_rate;
                if (!Array.isArray(state.sampleRateValues)) state.sampleRateValues = [];
                if (!state.sampleRateValues.includes(config.sample_rate)) state.sampleRateValues.push(config.sample_rate);
            }
            if (config.gain !== undefined) {
                state.gain = config.gain;
                if (!Array.isArray(state.gainValues)) state.gainValues = [];
                if (!state.gainValues.includes(config.gain)) state.gainValues.push(config.gain);
            }
            if (config.fft_size !== undefined) {
                state.fftSize = config.fft_size;
                if (!Array.isArray(state.fftSizeValues)) state.fftSizeValues = [];
                if (!state.fftSizeValues.includes(config.fft_size)) state.fftSizeValues.push(config.fft_size);
            }
            if (config.fft_window !== undefined) {
                state.fftWindow = config.fft_window;
                if (!Array.isArray(state.fftWindowValues)) state.fftWindowValues = [];
                if (!state.fftWindowValues.includes(config.fft_window)) state.fftWindowValues.push(config.fft_window);
            }
            if (config.fft_overlap_percent !== undefined) {
                state.fftOverlapPercent = config.fft_overlap_percent;
            }
            if (config.fft_overlap_depth !== undefined) {
                state.fftOverlapDepth = config.fft_overlap_depth;
            }
            if (config.antenna !== undefined) {
                state.selectedAntenna = config.antenna;
                if (config.antenna && Array.isArray(state.antennasList?.rx)
                    && !state.antennasList.rx.includes(config.antenna)) {
                    state.antennasList.rx.push(config.antenna);
                }
            }
            if (config.recording_path !== undefined && config.sdr_id === 'sigmf-playback') {
                state.playbackRecordingPath = config.recording_path;
            }
            if (config.offset_freq !== undefined) {
                state.selectedOffsetValue = config.offset_freq;
                const presetOffsets = new Set([
                    -6800000000, 125000000, -10700000000, -9750000000, -1998000000, 120000000,
                ]);
                state.selectedOffsetMode = config.offset_freq === 0
                    ? 'none'
                    : (presetOffsets.has(Number(config.offset_freq)) ? String(config.offset_freq) : 'manual');
            }
            if (config.sdr_settings && config.sdr_id) {
                if (!state.sdrSettingsById[config.sdr_id]) {
                    state.sdrSettingsById[config.sdr_id] = { draft: {}, applied: {} };
                }
                if (state.joinedSdrId === config.sdr_id || config.force_live) {
                    state.sdrSettingsById[config.sdr_id].draft = { ...config.sdr_settings };
                }
                state.sdrSettingsById[config.sdr_id].applied = { ...config.sdr_settings };
            }
            if (config.bias_t !== undefined && config.sdr_id) {
                if (!state.sdrSettingsById[config.sdr_id]) {
                    state.sdrSettingsById[config.sdr_id] = { draft: {}, applied: {} };
                }
                state.sdrSettingsById[config.sdr_id].applied.biasT = config.bias_t;
                if (state.joinedSdrId === config.sdr_id || config.force_live
                    || state.sdrSettingsById[config.sdr_id].draft.biasT === undefined) {
                    state.sdrSettingsById[config.sdr_id].draft.biasT = config.bias_t;
                }
            }
            if (config.tuner_agc !== undefined && config.sdr_id) {
                if (!state.sdrSettingsById[config.sdr_id]) {
                    state.sdrSettingsById[config.sdr_id] = { draft: {}, applied: {} };
                }
                state.sdrSettingsById[config.sdr_id].applied.tunerAgc = config.tuner_agc;
                if (state.joinedSdrId === config.sdr_id || config.force_live
                    || state.sdrSettingsById[config.sdr_id].draft.tunerAgc === undefined) {
                    state.sdrSettingsById[config.sdr_id].draft.tunerAgc = config.tuner_agc;
                }
            }
            if (config.rtl_agc !== undefined && config.sdr_id) {
                if (!state.sdrSettingsById[config.sdr_id]) {
                    state.sdrSettingsById[config.sdr_id] = { draft: {}, applied: {} };
                }
                state.sdrSettingsById[config.sdr_id].applied.rtlAgc = config.rtl_agc;
                if (state.joinedSdrId === config.sdr_id || config.force_live
                    || state.sdrSettingsById[config.sdr_id].draft.rtlAgc === undefined) {
                    state.sdrSettingsById[config.sdr_id].draft.rtlAgc = config.rtl_agc;
                }
            }
            if (config.soapy_agc !== undefined && config.sdr_id) {
                if (!state.sdrSettingsById[config.sdr_id]) {
                    state.sdrSettingsById[config.sdr_id] = { draft: {}, applied: {} };
                }
                state.sdrSettingsById[config.sdr_id].applied.soapyAgc = config.soapy_agc;
                if (state.joinedSdrId === config.sdr_id || config.force_live
                    || state.sdrSettingsById[config.sdr_id].draft.soapyAgc === undefined) {
                    state.sdrSettingsById[config.sdr_id].draft.soapyAgc = config.soapy_agc;
                }
            }
            if (config.fft_averaging !== undefined) state.fftAveraging = config.fft_averaging;
        },
        setShowRotatorDottedLines: (state, action) => {
            state.showRotatorDottedLines = action.payload;
        },
        setAutoScalePreset: (state, action) => {
            state.autoScalePreset = action.payload;
        },
        setIsRecording: (state, action) => {
            state.isRecording = action.payload;
        },
        setRecordingDuration: (state, action) => {
            state.recordingDuration = action.payload;
        },
        setRecordingName: (state, action) => {
            state.recordingName = action.payload;
        },
        setRecordingDecimationFactor: (state, action) => {
            state.recordingDecimationFactor = action.payload;
        },
        setRecordingStorageFormat: (state, action) => {
            state.recordingStorageFormat = action.payload;
        },
        setRecordingBandSelectionEnabled: (state, action) => {
            state.recordingBandSelectionEnabled = action.payload;
        },
        setRecordingBandCenterOffsetHz: (state, action) => {
            state.recordingBandCenterOffsetHz = action.payload;
        },
        setRecordingBandDragStepHz: (state, action) => {
            state.recordingBandDragStepHz = action.payload;
        },
        setRecordingStartTime: (state, action) => {
            state.recordingStartTime = action.payload;
        },
        incrementRecordingDuration: (state) => {
            // Calculate duration from start time for accuracy
            if (state.recordingStartTime) {
                const now = new Date();
                const start = new Date(state.recordingStartTime);
                state.recordingDuration = Math.floor((now - start) / 1000);
            } else {
                // Fallback to simple increment if no start time
                state.recordingDuration += 1;
            }
        },
        setSelectedPlaybackRecording: (state, action) => {
            state.selectedPlaybackRecording = action.payload;
        },
        setPlaybackRecordingPath: (state, action) => {
            state.playbackRecordingPath = action.payload;
        },
        clearPlaybackRecording: (state) => {
            state.selectedPlaybackRecording = null;
            state.playbackRecordingPath = '';
            state.playbackStartTime = null;
        },
        setPlaybackStartTime: (state, action) => {
            state.playbackStartTime = action.payload;
        },
        resetPlaybackStartTime: (state) => {
            state.playbackStartTime = null;
        },
        setPacketsDrawerOpen: (state, action) => {
            state.packetsDrawerOpen = action.payload;
        },
        setPacketsDrawerHeight: (state, action) => {
            state.packetsDrawerHeight = action.payload;
        },
        setNeighboringTransmitters: (state, action) => {
            state.neighboringTransmitters = action.payload;
        },
        setShowNeighboringTransmitters: (state, action) => {
            state.showNeighboringTransmitters = action.payload;
        },
        setShowBookmarkSource: (state, action) => {
            const { source, value } = action.payload || {};
            if (!state.showBookmarkSources) {
                state.showBookmarkSources = {
                    manual: true,
                    satdump: true,
                    satnogs: true,
                    'gr-satellites': true,
                    tinygs: true,
                };
            }
            if (source && (source === 'tinygs' || Object.prototype.hasOwnProperty.call(state.showBookmarkSources, source))) {
                state.showBookmarkSources[source] = value;
            }
        },
        applySDRConfigParameters: (state, action) => {
            const selectedSDRId = action.payload?.selectedSDRId;
            const data = action.payload?.data;
            if (!data) {
                return;
            }
            applySDRConfigParametersToState(state, data, selectedSDRId);
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(getSDRConfigParameters.pending, (state) => {
                state.gettingSDRParameters = true;
                state.errorMessage = null;
            })
            .addCase(getSDRConfigParameters.fulfilled, (state, action) => {
                state.gettingSDRParameters = false;
                const sdrId = action.meta?.arg?.selectedSDRId;
                applySDRConfigParametersToState(state, action.payload, sdrId);
            })
            .addCase(getSDRConfigParameters.rejected, (state, action) => {
                state.gettingSDRParameters = false;
                state.errorMessage = action.payload;
            })
            .addCase(startRecording.pending, (state) => {
                state.errorMessage = null;
            })
            .addCase(startRecording.fulfilled, (state, action) => {
                state.isRecording = true;
                state.recordingDuration = 0;
                state.recordingStartTime = new Date().toISOString();
            })
            .addCase(startRecording.rejected, (state, action) => {
                state.isRecording = false;
                state.errorMessage = action.payload;
            })
            .addCase(stopRecording.pending, (state) => {
                state.errorMessage = null;
            })
            .addCase(stopRecording.fulfilled, (state, action) => {
                state.isRecording = false;
                state.recordingDuration = 0;
                state.recordingStartTime = null;
            })
            .addCase(stopRecording.rejected, (state, action) => {
                state.errorMessage = action.payload;
            });
    }
});

export const {
    setFFTdataOverflow,
    setColorMap,
    setWaterfallRendererMode,
    setColorMaps,
    setDbRange,
    setFFTSize,
    setFFTSizeOptions,
    setFFTAveraging,
    setFFTOverlapPercent,
    setFFTOverlapDepth,
    setBandscopeSmoothing,
    setBandscopeRateLimitEnabled,
    updateSDRConfig,
    setGain,
    setSampleRate,
    setCenterFrequency,
    setErrorMessage,
    setIsStreaming,
    setJoinedSdrId,
    setTargetFPS,
    setIsPlaying,
    setSettingsDialogOpen,
    setAutoDBRange,
    setGridEditable,
    setSdrBiasT,
    setSdrBitpack,
    setSdrGainElement,
    setSdrClockSource,
    setSdrTimeSource,
    setSdrSettings,
    setSdrSettingsApplied,
    setSdrTunerAgc,
    setSdrRtlAgc,
    setSdrSoapyAgc,
    setFFTWindow,
    setWaterFallCanvasWidth,
    setWaterFallVisualWidth,
    setWaterFallScaleX,
    setWaterFallPositionX,
    setExpandedPanels,
    setSelectedSDRId,
    selectSdrForJoin,
    restoreSdrSelection,
    setStartStreamingLoading,
    setErrorDialogOpen,
    setWaterFallCanvasHeight,
    setBandScopeHeight,
    setFrequencyScaleHeight,
    setShowRightSideWaterFallAccessories,
    setShowLeftSideWaterFallAccessories,
    setBookMarks,
    setSelectedAntenna,
    setStartStreamValidationErrors,
    clearStartStreamValidationErrors,
    clearStartStreamValidationError,
    setHasSoapyAgc,
    setSelectedOffsetMode,
    setSelectedOffsetValue,
    setShowRotatorDottedLines,
    setAutoScalePreset,
    setIsRecording,
    setRecordingDuration,
    setRecordingName,
    setRecordingDecimationFactor,
    setRecordingStorageFormat,
    setRecordingBandSelectionEnabled,
    setRecordingBandCenterOffsetHz,
    setRecordingBandDragStepHz,
    setRecordingStartTime,
    incrementRecordingDuration,
    setSelectedPlaybackRecording,
    setPlaybackRecordingPath,
    clearPlaybackRecording,
    setPlaybackStartTime,
    resetPlaybackStartTime,
    setPacketsDrawerOpen,
    setPacketsDrawerHeight,
    setNeighboringTransmitters,
    setShowNeighboringTransmitters,
    setShowBookmarkSource,
    applySDRConfigParameters,
} = waterfallSlice.actions;

export default waterfallSlice.reducer;
