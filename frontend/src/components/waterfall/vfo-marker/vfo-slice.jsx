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
 * Developed with the assistance of Claude (Anthropic AI Assistant)
 */

import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { getDefaultVFOConfig, DEMODULATORS, getDemodulatorConfig, getDecoderConfig, DEFAULT_VFO_COLORS } from './vfo-config.js';
import { setIsStreaming } from '../waterfall-slice.jsx';
import { mapParametersFromBackend } from '../decoder-parameters.js';

export const backendUpdateVFOParameters = createAsyncThunk(
    'vfo/updateVFOParameters',
    async ({socket, vfoNumber, updates}, {rejectWithValue}) => {
        return new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: 'update-vfo-parameters',
  data: {
    vfoNumber,
    ...updates
  }
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

// Drag state is drawn locally in the marker canvas. This action lets the
// middleware synchronize the transient value to the backend without first
// changing Redux and forcing the waterfall page to reconcile.
export const syncDraggedVFOToBackend = (payload) => ({
    type: 'vfo/syncDraggedVFOToBackend',
    payload,
});

export const startAudioRecording = createAsyncThunk(
    'vfo/startAudioRecording',
    async ({socket, vfoNumber, recordingName, selectedSDRId, centerFrequency, vfoFrequency, demodulatorType}, {getState, rejectWithValue}) => {
        return new Promise((resolve, reject) => {
            const state = getState();
            const targetNoradId = state.targetSatTrack?.trackingState?.norad_id || '';
            const targetSatelliteName = state.targetSatTrack?.satelliteData?.details?.name || '';

            socket.emit("api.call", {
  cmd: "sdr.start-audio-recording",
  data: {
    selectedSDRId,
    vfoNumber,
    recordingName,
    centerFrequency,
    vfoFrequency,
    demodulatorType,
    targetSatelliteNoradId: targetNoradId,
    targetSatelliteName: targetSatelliteName
  }
}, response => {
  if (response?.success) {
    resolve({
      vfoNumber,
      ...response.data
    });
  } else {
    reject(rejectWithValue(response?.error || 'Failed to start audio recording'));
  }
});
        });
    }
);

export const stopAudioRecording = createAsyncThunk(
    'vfo/stopAudioRecording',
    async ({socket, vfoNumber, selectedSDRId}, {rejectWithValue}) => {
        return new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: "sdr.stop-audio-recording",
  data: {
    selectedSDRId,
    vfoNumber
  }
}, response => {
  if (response?.success) {
    resolve({
      vfoNumber,
      ...response.data
    });
  } else {
    reject(rejectWithValue(response?.error || 'Failed to stop audio recording'));
  }
});
        });
    }
);

// Create default VFO state using centralized config
const createDefaultVFO = (name) => {
    const defaults = getDefaultVFOConfig();
    return {
        name,
        frequency: null,
        color: null,
        lockedTransmitterId: 'none',
        lockedTransmitterTrackerId: null,
        frequencyOffset: 0,
        ...defaults
    };
};

const initialState = {
    vfoActive: {
        1: false,
        2: false,
        3: false,
        4: false,
    },
    vfoMarkers: {
        1: createDefaultVFO("VFO1"),
        2: createDefaultVFO("VFO2"),
        3: createDefaultVFO("VFO3"),
        4: createDefaultVFO("VFO4"),
    },
    maxVFOMarkers: 4,
    selectedVFO: null,
    streamingVFOs: [], // Changed from single to array to support multiple simultaneous streams
    vfoMuted: {
        1: false,
        2: false,
        3: false,
        4: false,
    },
    audioRecording: {
        1: { isRecording: false, duration: 0 },
        2: { isRecording: false, duration: 0 },
        3: { isRecording: false, duration: 0 },
        4: { isRecording: false, duration: 0 },
    },
    vfoColors: DEFAULT_VFO_COLORS,
    selectedVFOTab: 0,
    errorMessage: null,
};

export const vfoSlice = createSlice({
    name: 'vfo',
    initialState: initialState,
    reducers: {
        deactivateDetachedVfos: (state) => {
            // Clear only the dashboard's VFOs; detached backend workers stay active.
            state.selectedVFO = null;
            state.streamingVFOs = [];
            for (let number = 1; number <= state.maxVFOMarkers; number++) {
                state.vfoActive[number] = false;
                // Keep tuning and decoder drafts, but drop the detached stream's locks.
                state.vfoMarkers[number].lockedTransmitterId = 'none';
                state.vfoMarkers[number].lockedTransmitterTrackerId = null;
                state.vfoMarkers[number].frequencyOffset = 0;
            }
        },
        restoreReceivingSession: (state, action) => {
            const observation = action.payload;
            state.selectedVFO = null;
            state.streamingVFOs = [];
            for (let number = 1; number <= state.maxVFOMarkers; number++) {
                const vfo = observation.vfos?.[number] || {};
                const decoder = vfo.decoder || 'none';
                // Replace local drafts in one action. No activation/property
                // actions may reach the backend while adopting running workers.
                state.vfoMarkers[number] = {
                    ...createDefaultVFO(`VFO${number}`),
                    frequency: vfo.center_freq ?? null,
                    bandwidth: vfo.bandwidth ?? 10000,
                    mode: decoder !== 'none' ? 'none' : (vfo.modulation || 'none'),
                    decoder,
                    volume: vfo.volume ?? 50,
                    squelch: vfo.squelch ?? -150,
                    squelchMode: vfo.squelch_mode || 'carrier',
                    vadSensitivity: vfo.vad_sensitivity || 'medium',
                    vadCloseDelayMs: vfo.vad_close_delay_ms ?? 300,
                    parametersEnabled: vfo.parameters_enabled ?? true,
                    parameters: mapParametersFromBackend(decoder, {
                        ...vfo.decoder_parameters, ...vfo.decoder_overrides,
                    }),
                    transcriptionEnabled: Boolean(vfo.transcription_enabled),
                    transcriptionProvider: vfo.transcription_provider || 'gemini',
                    transcriptionLanguage: vfo.transcription_language || 'auto',
                    transcriptionTranslateTo: vfo.transcription_translate_to || 'none',
                    transcriptionTranslationBackend: vfo.transcription_translation_backend || 'none',
                };
                state.vfoActive[number] = Boolean(vfo.active);
                state.vfoMuted[number] = false;
                state.audioRecording[number] = {
                    isRecording: (observation.audio_recordings || []).includes(number),
                    duration: Math.floor(observation.audio_recording_durations?.[number] || 0),
                };
                if (vfo.selected) state.selectedVFO = number;
                if (vfo.active) state.streamingVFOs.push(number);
            }
            state.selectedVFOTab = Math.max(0, (state.selectedVFO || 1) - 1);
        },
        enableVFO1: (state, action) => {
            state.vfoMarkers[0].active = true;
        },
        enableVFO2: (state, action) => {
            state.vfoMarkers[1].active = true;
        },
        enableVFO3: (state, action) => {
            state.vfoMarkers[2].active = true;
        },
        enableVFO4: (state, action) => {
            state.vfoMarkers[3].active = true;
        },
        disableVFO1: (state, action) => {
            state.vfoMarkers[0].active = false;
        },
        disableVFO2: (state, action) => {
            state.vfoMarkers[1].active = false;
        },
        disableVFO3: (state, action) => {
            state.vfoMarkers[2].active = false;
        },
        disableVFO4: (state, action) => {
            state.vfoMarkers[3].active = false;
        },
        setVFOProperty: (state, action) => {
            const {vfoNumber, updates} = action.payload;
            if (state.vfoMarkers[vfoNumber]) {
                const vfo = state.vfoMarkers[vfoNumber];

                // Apply all updates
                Object.entries(updates).forEach(([property, value]) => {
                    vfo[property] = value;
                });

                // If mode or decoder was changed, update bandwidth to default
                const modeChanged = updates.hasOwnProperty('mode');
                const decoderChanged = updates.hasOwnProperty('decoder');

                if (modeChanged || decoderChanged) {
                    // Use the VFO's configured mode directly
                    const demodConfig = getDemodulatorConfig(vfo.mode);

                    if (demodConfig && demodConfig.defaultBandwidth) {
                        vfo.bandwidth = demodConfig.defaultBandwidth;
                    }

                    // Check if decoder has its own default bandwidth (e.g., GMSK)
                    if (decoderChanged && vfo.decoder) {
                        const decoderConfig = getDecoderConfig(vfo.decoder);
                        if (decoderConfig && decoderConfig.defaultBandwidth) {
                            vfo.bandwidth = decoderConfig.defaultBandwidth;
                        }
                    }
                }
            }
        },
        setSelectedVFO(state, action) {
            state.selectedVFO = Number.isInteger(action.payload) ? parseInt(action.payload) : null;
        },
        addStreamingVFO(state, action) {
            const vfoNumber = parseInt(action.payload);
            if (!state.streamingVFOs.includes(vfoNumber)) {
                state.streamingVFOs.push(vfoNumber);
            }
        },
        removeStreamingVFO(state, action) {
            const vfoNumber = parseInt(action.payload);
            state.streamingVFOs = state.streamingVFOs.filter(vfo => vfo !== vfoNumber);
        },
        clearStreamingVFOs(state) {
            state.streamingVFOs = [];
        },
        setVfoMuted(state, action) {
            const { vfoNumber, muted } = action.payload;
            if (Number.isInteger(vfoNumber) && vfoNumber >= 1 && vfoNumber <= 10) {
                state.vfoMuted[vfoNumber] = muted;
            }
        },
        setVfoActive: (state, action) => {
            const vfoNumber = action.payload;
            state.vfoActive[vfoNumber] = true;

            // Set bandwidth to defaultBandwidth for the current mode when activating VFO
            // Consider decoder config first (e.g., BPSK, GMSK), then demodulator config
            const vfo = state.vfoMarkers[vfoNumber];
            if (vfo) {
                // Check if decoder has its own default bandwidth (e.g., GMSK, BPSK)
                if (vfo.decoder && vfo.decoder !== 'none') {
                    const decoderConfig = getDecoderConfig(vfo.decoder);
                    if (decoderConfig && decoderConfig.defaultBandwidth) {
                        vfo.bandwidth = decoderConfig.defaultBandwidth;
                        return; // Use decoder bandwidth, skip demodulator check
                    }
                }

                // Otherwise, use demodulator default bandwidth
                if (vfo.mode) {
                    const demodConfig = getDemodulatorConfig(vfo.mode);
                    if (demodConfig && demodConfig.defaultBandwidth) {
                        vfo.bandwidth = demodConfig.defaultBandwidth;
                    }
                }
            }
        },
        setVfoInactive: (state, action) => {
            const vfoNumber = action.payload;
            state.vfoActive[vfoNumber] = false;
            // Keep frequency intact - middleware will check bandwidth on reactivation
        },
        setSelectedVFOTab: (state, action) => {
            state.selectedVFOTab = action.payload;
        },
        updateAllVFOStates: (state, action) => {
            // action.payload is an object with vfo_number as keys and VFO state objects as values
            const vfoStates = action.payload;

            Object.entries(vfoStates).forEach(([vfoNumber, vfoState]) => {
                const vfoNum = parseInt(vfoNumber);

                if (state.vfoMarkers[vfoNum]) {
                    // Map backend field names to frontend field names
                    state.vfoMarkers[vfoNum].frequency = vfoState.center_freq;
                    state.vfoMarkers[vfoNum].bandwidth = vfoState.bandwidth;
                    state.vfoMarkers[vfoNum].mode = vfoState.modulation;
                    state.vfoMarkers[vfoNum].volume = vfoState.volume;
                    state.vfoMarkers[vfoNum].squelch = vfoState.squelch;
                    state.vfoMarkers[vfoNum].squelchMode = vfoState.squelch_mode || 'carrier';
                    state.vfoMarkers[vfoNum].vadSensitivity = vfoState.vad_sensitivity || 'medium';
                    state.vfoMarkers[vfoNum].vadCloseDelayMs = vfoState.vad_close_delay_ms ?? 300;
                    // Note: lockedTransmitterId is UI-only, not synced from backend

                    // Update transcription fields if present
                    if (vfoState.transcription_enabled !== undefined) {
                        state.vfoMarkers[vfoNum].transcriptionEnabled = vfoState.transcription_enabled;
                    }
                    if (vfoState.transcription_language !== undefined) {
                        state.vfoMarkers[vfoNum].transcriptionLanguage = vfoState.transcription_language;
                    }
                    if (vfoState.transcription_provider !== undefined) {
                        state.vfoMarkers[vfoNum].transcriptionProvider = vfoState.transcription_provider;
                    }
                    if (vfoState.transcription_translate_to !== undefined) {
                        state.vfoMarkers[vfoNum].transcriptionTranslateTo = vfoState.transcription_translate_to;
                    }
                    if (vfoState.transcription_translation_backend !== undefined) {
                        state.vfoMarkers[vfoNum].transcriptionTranslationBackend = vfoState.transcription_translation_backend;
                    }

                    // FIX: Enforce mutual exclusivity between audio demodulators and data decoders
                    // When loading state from backend/storage, ensure that audio demod (mode) and
                    // data decoder are not both active simultaneously. This prevents the UI bug where
                    // both toggle groups appear selected on page load, requiring manual "none" click to unstick.
                    // If a decoder is active (not 'none'), force audio demod to 'none'
                    const currentDecoder = state.vfoMarkers[vfoNum].decoder;
                    if (currentDecoder && currentDecoder !== 'none') {
                        state.vfoMarkers[vfoNum].mode = 'none';
                    }

                    // Update active state
                    state.vfoActive[vfoNum] = vfoState.active;

                    // Update selected VFO if this VFO is selected
                    if (vfoState.selected) {
                        state.selectedVFO = vfoNum;
                    }
                }
            });
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(backendUpdateVFOParameters.pending, (state) => {
                state.errorMessage = null;
            })
            .addCase(backendUpdateVFOParameters.fulfilled, (state, action) => {
                // Successfully updated VFO parameters
            })
            .addCase(backendUpdateVFOParameters.rejected, (state, action) => {
                state.errorMessage = action.payload;
            })
            .addCase(startAudioRecording.pending, (state) => {
                state.errorMessage = null;
            })
            .addCase(startAudioRecording.fulfilled, (state, action) => {
                const {vfoNumber} = action.payload;
                state.audioRecording[vfoNumber].isRecording = true;
                state.audioRecording[vfoNumber].duration = 0;
            })
            .addCase(startAudioRecording.rejected, (state, action) => {
                state.errorMessage = action.payload;
            })
            .addCase(stopAudioRecording.pending, (state) => {
                state.errorMessage = null;
            })
            .addCase(stopAudioRecording.fulfilled, (state, action) => {
                const {vfoNumber} = action.payload;
                state.audioRecording[vfoNumber].isRecording = false;
                state.audioRecording[vfoNumber].duration = 0;
            })
            .addCase(stopAudioRecording.rejected, (state, action) => {
                state.errorMessage = action.payload;
            })
            .addCase(setIsStreaming, (state, action) => {
                // When streaming stops, reset all audio recording states
                if (action.payload === false) {
                    state.audioRecording = {
                        1: { isRecording: false, duration: 0 },
                        2: { isRecording: false, duration: 0 },
                        3: { isRecording: false, duration: 0 },
                        4: { isRecording: false, duration: 0 },
                    };
                }
            });
    }
});

export const {
    setVFOProperty,
    enableVFO1,
    enableVFO2,
    enableVFO3,
    enableVFO4,
    disableVFO1,
    disableVFO2,
    disableVFO3,
    disableVFO4,
    setSelectedVFO,
    addStreamingVFO,
    removeStreamingVFO,
    clearStreamingVFOs,
    setVfoMuted,
    setVfoActive,
    setVfoInactive,
    setSelectedVFOTab,
    updateAllVFOStates,
    restoreReceivingSession,
    deactivateDetachedVfos,
} = vfoSlice.actions;

export default vfoSlice.reducer;
