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
import { resolveDecodedAssetUrl } from '../../utils/decoded-assets.js';

// Async thunk to fetch satellite info from backend
export const fetchDetectedSatellite = createAsyncThunk(
    'decoders/fetchDetectedSatellite',
    async ({ socket, noradId }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'get-satellite',
  data: noradId
}, response => {
  if (response.success) {
    resolve({
      noradId,
      data: response.data
    });
  } else {
    reject(new Error('Failed to fetch satellite'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

const initialState = {
    // Active decoder sessions (keyed by session_id)
    active: {},

    // Current socket session ID (used to clean up stale decoders on reconnect)
    currentSessionId: null,

    // Decoded output history (limited to last 100 items)
    outputs: [],

    // Recent errors (limited to last 20)
    errors: [],

    // Detected satellites (keyed by NORAD ID)
    detectedSatellites: {},

    // UI state
    ui: {
        selectedOutput: null,      // Currently viewing output ID
        galleryFilter: 'all',      // all, sstv, aprs, morse, gmsk, etc.
        showGallery: false,
        showDecoderPanel: false,
    }
};

export const isStaleDecoderStatus = (existing, incoming) => {
    if (!existing) return false;

    const { decoder_id, decoder_type, worker_started_at, status, timestamp } = incoming;
    if (decoder_id && existing.retiredDecoderIds?.includes(decoder_id)) return true;

    // Transcription workers include their creation time, which also orders
    // statuses emitted after a replacement has begun.
    if (decoder_type === 'transcription' && existing.decoder_type === 'transcription' &&
        worker_started_at !== undefined && existing.worker_started_at !== undefined &&
        worker_started_at < existing.worker_started_at) return true;

    if (decoder_id && existing.decoder_id && decoder_id !== existing.decoder_id) {
        // Terminal events only close the instance that currently owns the VFO.
        if (status === 'idle' || status === 'error' || status === 'closed') return true;
        // Queued events from an unseen older process can arrive after the new start.
        if (Number.isFinite(timestamp) && Number.isFinite(existing.started_at) &&
            timestamp < existing.started_at) return true;
    }

    return false;
};

export const decodersSlice = createSlice({
    name: 'decoders',
    initialState,
    reducers: {
        // Decoder status changed
        decoderStatusChanged: (state, action) => {
            const { session_id, status, mode, decoder_type, decoder_id, worker_started_at, vfo, timestamp, progress, info } = action.payload;

            // Create unique key combining session_id and VFO number
            const decoderKey = vfo ? `${session_id}_vfo${vfo}` : session_id;
            const existing = state.active[decoderKey];

            if (isStaleDecoderStatus(existing, action.payload)) {
                return;
            }

            if (status === 'idle' || status === 'error' || status === 'closed') {
                // Only remove from active decoders if the decoder_id matches
                // This prevents stale "closed" messages from old decoder instances
                // from clearing the status of newly restarted decoders
                if (existing) {
                    // If decoder_id is provided, only delete if it matches
                    // If no decoder_id (legacy), delete anyway for backward compatibility
                    if (!decoder_id || existing.decoder_id === decoder_id) {
                        delete state.active[decoderKey];
                    } else {
                        console.log(`Ignoring stale ${status} status from old decoder instance (${decoder_id} vs ${existing.decoder_id})`);
                    }
                }
            } else {
                // Update or create active decoder entry
                const instanceChanged = existing?.decoder_id && decoder_id && existing.decoder_id !== decoder_id;
                if (!existing || instanceChanged) {
                    state.active[decoderKey] = {
                        decoder_type,
                        decoder_id,  // Track decoder instance ID
                        session_id,
                        vfo,
                        started_at: timestamp,
                        worker_started_at,
                        progress: null,
                        info: null,  // Initialize info field
                        retiredDecoderIds: instanceChanged
                            ? [...(existing.retiredDecoderIds || []), existing.decoder_id].slice(-16)
                            : [],
                    };
                } else {
                    // Update decoder_id and decoder_type if provided (handles decoder restarts and type changes)
                    if (decoder_id) {
                        state.active[decoderKey].decoder_id = decoder_id;
                    }
                    if (decoder_type) {
                        state.active[decoderKey].decoder_type = decoder_type;
                    }
                    if (worker_started_at !== undefined) {
                        state.active[decoderKey].worker_started_at = worker_started_at;
                    }
                }

                state.active[decoderKey].status = status;
                state.active[decoderKey].mode = mode;
                state.active[decoderKey].vfo = vfo;
                state.active[decoderKey].last_update = timestamp;

                // Update progress if provided in the payload (including null to reset)
                if (progress !== undefined) {
                    state.active[decoderKey].progress = progress;
                }

                // Merge info if provided (decoder configuration: baudrate, framing, etc.)
                // Use merge instead of replace to preserve fields from decoder-progress messages
                if (info !== undefined) {
                    state.active[decoderKey].info = {
                        ...state.active[decoderKey].info,
                        ...info
                    };
                }
            }
        },

        // Progress update
        decoderProgressUpdated: (state, action) => {
            const { session_id, decoder_id, vfo, progress, timestamp, info } = action.payload;

            // Create unique key combining session_id and VFO number
            const decoderKey = vfo ? `${session_id}_vfo${vfo}` : session_id;

            // Progress belongs to the decoder instance that produced it.
            if (state.active[decoderKey] &&
                (!decoder_id || !state.active[decoderKey].decoder_id ||
                    decoder_id === state.active[decoderKey].decoder_id)) {
                state.active[decoderKey].progress = progress;
                state.active[decoderKey].last_update = timestamp;

                // Merge info if provided (e.g., SatDump status: sync_status, snr_db, frames)
                if (info !== undefined) {
                    state.active[decoderKey].info = {
                        ...state.active[decoderKey].info,
                        ...info
                    };
                }
            }
        },

        // Output received (completed decode)
        decoderOutputReceived: (state, action) => {
            const output = action.payload;

            // Special handling for Morse decoder - keep only latest output per session+VFO
            if (output.decoder_type === 'morse') {
                // Find and remove any existing Morse output for this session+VFO combination
                state.outputs = state.outputs.filter(
                    o => !(o.decoder_type === 'morse' && o.session_id === output.session_id && o.vfo === output.vfo)
                );

                // Add the new output with VFO in the ID
                const outputId = output.vfo
                    ? `output_${output.session_id}_vfo${output.vfo}_morse`
                    : `output_${output.session_id}_morse`;

                state.outputs.unshift({
                    id: outputId,
                    ...output
                });
            } else {
                // Normal handling for other decoders (SSTV, etc.)
                state.outputs.unshift({
                    id: `output_${output.timestamp}`,
                    ...output
                });
            }

            // Limit to last 100 outputs
            if (state.outputs.length > 100) {
                state.outputs = state.outputs.slice(0, 100);
            }

            // Auto-select new output if gallery is open (but not for Morse)
            if (state.ui.showGallery && output.decoder_type !== 'morse') {
                state.ui.selectedOutput = `output_${output.timestamp}`;
            }
        },

        // Clear decoder session (user stopped decoder)
        clearDecoderSession: (state, action) => {
            const { session_id, vfo } = action.payload;

            // Create unique key combining session_id and VFO number
            const decoderKey = vfo ? `${session_id}_vfo${vfo}` : session_id;

            if (state.active[decoderKey]) {
                delete state.active[decoderKey];
            }
        },

        // Clear all history
        clearDecoderHistory: (state) => {
            state.outputs = [];
            state.errors = [];
        },

        // Clear outputs only
        clearDecoderOutputs: (state) => {
            state.outputs = [];
        },

        // Clear GNSS outputs for a specific decoder stream restart.
        clearGnssOutputsForDecoder: (state, action) => {
            const { session_id, vfo } = action.payload || {};
            state.outputs = state.outputs.filter((output) => {
                if (output.decoder_type !== 'gnss') {
                    return true;
                }
                if (session_id && output.session_id !== session_id) {
                    return true;
                }
                if (vfo !== undefined && vfo !== null && output.vfo !== vfo) {
                    return true;
                }
                return false;
            });
        },

        // Clear errors only
        clearDecoderErrors: (state) => {
            state.errors = [];
        },

        // Delete specific output
        deleteOutput: (state, action) => {
            const { output_id } = action.payload;
            state.outputs = state.outputs.filter(output => output.id !== output_id);

            // Deselect if currently selected
            if (state.ui.selectedOutput === output_id) {
                state.ui.selectedOutput = null;
            }
        },

        // Delete output by filename (for file deletion sync)
        deleteOutputByFilename: (state, action) => {
            const { filename, url } = action.payload;
            const matches = (entry) => url
                ? resolveDecodedAssetUrl(entry.output?.filepath, entry.output?.filename) === url
                : entry.output?.filename === filename;

            // Find the output with matching filename before deletion
            const outputToDelete = state.outputs.find(
                matches
            );

            // Remove from outputs array
            state.outputs = state.outputs.filter(
                output => !matches(output)
            );

            // Deselect if currently selected output was deleted
            if (outputToDelete && state.ui.selectedOutput === outputToDelete.id) {
                state.ui.selectedOutput = null;
            }
        },

        // Clear outputs for a specific satellite (by NORAD ID)
        clearSatelliteOutputs: (state, action) => {
            const { noradId, outputIds } = action.payload;
            // Remove all output IDs that belong to this satellite
            if (outputIds && outputIds.length > 0) {
                state.outputs = state.outputs.filter(output => !outputIds.includes(output.id));
            }
        },

        // UI actions
        selectOutput: (state, action) => {
            state.ui.selectedOutput = action.payload;
        },

        setGalleryFilter: (state, action) => {
            state.ui.galleryFilter = action.payload;
        },

        toggleGallery: (state) => {
            state.ui.showGallery = !state.ui.showGallery;
        },

        setShowGallery: (state, action) => {
            state.ui.showGallery = action.payload;
        },

        toggleDecoderPanel: (state) => {
            state.ui.showDecoderPanel = !state.ui.showDecoderPanel;
        },

        setShowDecoderPanel: (state, action) => {
            state.ui.showDecoderPanel = action.payload;
        },

        // Set current session ID and clean up stale decoders
        // Keep internal sessions (automated observations) when session changes
        setCurrentSessionId: (state, action) => {
            const newSessionId = action.payload;

            // If session ID changed, clear all active decoders from old session
            // but preserve internal sessions (automated observations)
            if (state.currentSessionId && state.currentSessionId !== newSessionId) {
                console.log(`Session ID changed from ${state.currentSessionId} to ${newSessionId}, clearing stale decoders`);
                const internalDecoders = Object.entries(state.active)
                    .filter(([_, decoder]) => decoder.session_id && decoder.session_id.startsWith('internal:'))
                    .reduce((acc, [key, decoder]) => {
                        acc[key] = decoder;
                        return acc;
                    }, {});
                state.active = internalDecoders;
            }

            state.currentSessionId = newSessionId;
        },

        // Clean up stale decoders from old sessions (periodic cleanup)
        // Keep internal sessions (automated observations) - only remove old user sessions
        cleanupStaleDecoders: (state) => {
            if (!state.currentSessionId) {
                return;
            }

            const staleDecoderKeys = Object.keys(state.active).filter(
                key => {
                    const decoder = state.active[key];
                    // Keep decoders from current session
                    if (decoder.session_id === state.currentSessionId) {
                        return false;
                    }
                    // Keep internal sessions (automated observations)
                    if (decoder.session_id && decoder.session_id.startsWith('internal:')) {
                        return false;
                    }
                    // Remove all other old sessions
                    return true;
                }
            );

            if (staleDecoderKeys.length > 0) {
                console.log(`Cleaning up ${staleDecoderKeys.length} stale decoder(s) from old sessions`);
                staleDecoderKeys.forEach(key => {
                    delete state.active[key];
                });
            }
        },
    },
    extraReducers: (builder) => {
        builder
            // fetchDetectedSatellite cases
            .addCase(fetchDetectedSatellite.pending, (state, action) => {
                const { noradId } = action.meta.arg;
                if (!state.detectedSatellites[noradId]) {
                    state.detectedSatellites[noradId] = {
                        noradId,
                        loading: true,
                        error: null,
                        data: null,
                        lastSeen: Date.now(),
                        fetchedAt: null,
                    };
                }
                state.detectedSatellites[noradId].loading = true;
            })
            .addCase(fetchDetectedSatellite.fulfilled, (state, action) => {
                const { noradId, data } = action.payload;
                state.detectedSatellites[noradId] = {
                    noradId,
                    loading: false,
                    error: null,
                    data,
                    lastSeen: Date.now(),
                    fetchedAt: Date.now(),
                };
            })
            .addCase(fetchDetectedSatellite.rejected, (state, action) => {
                const { noradId } = action.meta.arg;
                if (state.detectedSatellites[noradId]) {
                    state.detectedSatellites[noradId].loading = false;
                    state.detectedSatellites[noradId].error = action.payload || 'Failed to fetch satellite';
                }
            });
    }
});

export const {
    decoderStatusChanged,
    decoderProgressUpdated,
    decoderOutputReceived,
    clearDecoderSession,
    clearDecoderHistory,
    clearDecoderOutputs,
    clearGnssOutputsForDecoder,
    clearDecoderErrors,
    deleteOutput,
    deleteOutputByFilename,
    clearSatelliteOutputs,
    selectOutput,
    setGalleryFilter,
    toggleGallery,
    setShowGallery,
    toggleDecoderPanel,
    setShowDecoderPanel,
    setCurrentSessionId,
    cleanupStaleDecoders,
} = decodersSlice.actions;

// Selectors
export const selectActiveDecoders = (state) => state.decoders.active;
export const selectDecoderBySession = (session_id, vfo = null) => (state) => {
    const decoderKey = vfo ? `${session_id}_vfo${vfo}` : session_id;
    return state.decoders.active[decoderKey];
};
export const selectAllOutputs = (state) => state.decoders.outputs;
export const selectFilteredOutputs = (state) => {
    const { outputs, ui } = state.decoders;
    if (ui.galleryFilter === 'all') {
        return outputs;
    }
    return outputs.filter(output => output.decoder_type === ui.galleryFilter);
};
export const selectOutputById = (output_id) => (state) => {
    return state.decoders.outputs.find(output => output.id === output_id);
};
export const selectRecentErrors = (state) => state.decoders.errors;
export const selectDecoderUI = (state) => state.decoders.ui;
export const selectSelectedOutput = (state) => {
    const { outputs, ui } = state.decoders;
    if (!ui.selectedOutput) return null;
    return outputs.find(output => output.id === ui.selectedOutput);
};
export const selectDetectedSatellites = (state) => state.decoders.detectedSatellites;
export const selectDetectedSatelliteByNorad = (noradId) => (state) => {
    return state.decoders.detectedSatellites[noradId] || null;
};

export default decodersSlice.reducer;
