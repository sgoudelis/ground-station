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

import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';

/**
 * Observation data structure:
 * {
 *   id: string (uuid),
 *   name: string (user-friendly name),
 *   enabled: boolean,
 *   satellite: {
 *     norad_id: string,
 *     name: string
 *   },
 *   pass: {
 *     event_start: ISO timestamp,
 *     event_end: ISO timestamp,
 *     peak_altitude: number,
 *     azimuth_at_start: number,
 *     azimuth_at_peak: number,
 *     azimuth_at_end: number
 *   } | null (null for geostationary),
 *   sessions: [
 *     {
 *       sdr: {
 *         id: string,
 *         name: string
 *       },
 *       tasks: [
 *         {
 *           type: 'decoder',
 *           config: {
 *             decoder_type: string (e.g., 'aprs', 'gmsk', 'sstv'),
 *             vfo: number | null
 *           }
 *         },
 *         {
 *           type: 'audio_recording',
 *           config: {
 *             format: string ('wav', 'mp3'),
 *             vfo: number | null
 *           }
 *         },
 *         {
 *           type: 'iq_recording',
 *           config: {
 *             sample_rate: number,
 *             format: string ('complex_int16', 'complex_float32')
 *           }
 *         }
 *       ]
 *     }
 *   ],
 *   rotator: {
 *     id: string | null,
 *     tracking_enabled: boolean,
 *     unpark_before_tracking: boolean,
 *     park_after_observation: boolean
 *   },
 *   rig: {
 *     id: string | null,
 *     transmitter_id: string,
 *     doppler_correction: boolean,
 *     vfo: string ('VFO_A', 'VFO_B')
 *   },
 *   created_at: ISO timestamp,
 *   updated_at: ISO timestamp,
 *   status: 'scheduled' | 'running' | 'completed' | 'failed' | 'cancelled'
 * }
 */

// Fetch all scheduled observations
export const fetchScheduledObservations = createAsyncThunk(
    'scheduler/fetchAll',
    async ({ socket }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'get-scheduled-observations',
  data: null
}, res => {
  if (res.success) {
    resolve(res.data);
  } else {
    reject(new Error('Failed to fetch scheduled observations'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

// Fetch a single scheduled observation by ID
export const fetchSingleObservation = createAsyncThunk(
    'scheduler/fetchSingle',
    async ({ socket, observationId }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'get-scheduled-observations',
  data: {
    observation_id: observationId
  }
}, res => {
  if (res.success) {
    resolve(res.data);
  } else {
    reject(new Error('Failed to fetch observation'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

// Create a new scheduled observation
export const createScheduledObservation = createAsyncThunk(
    'scheduler/create',
    async ({ socket, observation }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'create-scheduled-observation',
  data: observation
}, res => {
  if (res.success) {
    resolve(res.data);
  } else {
    reject(new Error('Failed to create scheduled observation'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

// Update an existing scheduled observation
export const updateScheduledObservation = createAsyncThunk(
    'scheduler/update',
    async ({ socket, id, observation }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'update-scheduled-observation',
  data: {
    id,
    ...observation
  }
}, res => {
  if (res.success) {
    resolve(res.data);
  } else {
    reject(new Error('Failed to update scheduled observation'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

// Delete scheduled observation(s)
export const deleteScheduledObservations = createAsyncThunk(
    'scheduler/delete',
    async ({ socket, ids }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'delete-scheduled-observations',
  data: ids
}, res => {
  if (res.success) {
    resolve({
      ids
    });
  } else {
    reject(new Error('Failed to delete scheduled observations'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

// Enable/disable observation
export const toggleObservationEnabled = createAsyncThunk(
    'scheduler/toggleEnabled',
    async ({ socket, id, enabled }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'toggle-observation-enabled',
  data: {
    id,
    enabled
  }
}, res => {
  if (res.success) {
    resolve({
      id,
      enabled
    });
  } else {
    reject(new Error('Failed to toggle observation'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

// Cancel a running observation
export const cancelRunningObservation = createAsyncThunk(
    'scheduler/cancel',
    async ({ socket, id }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'cancel-observation',
  data: id
}, res => {
  if (res.success) {
    resolve({
      id
    });
  } else {
    reject(new Error('Failed to cancel observation'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

// Fetch all monitored satellites
export const fetchMonitoredSatellites = createAsyncThunk(
    'scheduler/fetchMonitoredSatellites',
    async ({ socket }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'get-monitored-satellites',
  data: null
}, res => {
  if (res.success) {
    resolve(res.data);
  } else {
    reject(new Error('Failed to fetch monitored satellites'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

// Create a new monitored satellite
export const createMonitoredSatellite = createAsyncThunk(
    'scheduler/createMonitoredSatellite',
    async ({ socket, satellite }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'create-monitored-satellite',
  data: satellite
}, res => {
  if (res.success) {
    resolve(res.data);
  } else {
    reject(new Error(res.error || 'Failed to create monitored satellite'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

// Update an existing monitored satellite
export const updateMonitoredSatelliteAsync = createAsyncThunk(
    'scheduler/updateMonitoredSatelliteAsync',
    async ({ socket, id, satellite }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'update-monitored-satellite',
  data: {
    id,
    ...satellite
  }
}, res => {
  if (res.success) {
    resolve(res.data);
  } else {
    reject(new Error(res.error || 'Failed to update monitored satellite'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

// Fetch SDR parameters (gain values, antenna ports, etc.)
export const fetchSDRParameters = createAsyncThunk(
    'scheduler/fetchSDRParameters',
    async ({ socket, sdrId }, { rejectWithValue }) => {
        return await new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: 'get-sdr-parameters',
  data: sdrId
}, res => {
  if (res.success) {
    resolve({
      sdrId,
      parameters: res.data,
      error: null
    });
  } else {
    reject(rejectWithValue({
      sdrId,
      error: res.error || 'Failed to fetch SDR parameters'
    }));
  }
});
        });
    }
);

// Delete monitored satellite(s)
export const deleteMonitoredSatellitesAsync = createAsyncThunk(
    'scheduler/deleteMonitoredSatellitesAsync',
    async ({ socket, ids, deleteObservations = false }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'delete-monitored-satellites',
  data: {
    ids,
    deleteObservations
  }
}, res => {
  if (res.success) {
    resolve({
      ids
    });
  } else {
    reject(new Error('Failed to delete monitored satellites'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

// Toggle monitored satellite enabled
export const toggleMonitoredSatelliteEnabledAsync = createAsyncThunk(
    'scheduler/toggleMonitoredSatelliteEnabledAsync',
    async ({ socket, id, enabled }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'toggle-monitored-satellite-enabled',
  data: {
    id,
    enabled
  }
}, res => {
  if (res.success) {
    resolve({
      id,
      enabled
    });
  } else {
    reject(new Error('Failed to toggle monitored satellite'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

// Fetch next passes for a satellite
export const fetchNextPassesForScheduler = createAsyncThunk(
    'scheduler/fetchNextPasses',
    async ({ socket, noradId, hours = 72, minElevation = 0, forceRecalculate = false }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'fetch-next-passes',
  data: {
    norad_id: noradId,
    hours: hours,
    min_elevation: minElevation,
    force_recalculate: forceRecalculate
  }
}, response => {
  if (response.success) {
    resolve(response.data);
  } else {
    reject(new Error('Failed to fetch passes'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

// Load a saved satellite by identity; autocomplete can omit it after the result limit.
export const fetchSatelliteWithTransmitters = createAsyncThunk(
    'scheduler/fetchSatelliteWithTransmitters',
    async ({ socket, noradId }, { rejectWithValue }) => {
        try {
            // Both endpoints use the NORAD ID and avoid orbit-path calculation.
            const [satellites, transmitters] = await Promise.all([
                new Promise((resolve, reject) => {
                    socket.emit('api.call', { cmd: 'get-satellites', data: noradId }, response => {
                        if (response.success) resolve(response.data);
                        else reject(new Error(response.error || 'Failed to fetch satellite'));
                    });
                }),
                new Promise((resolve, reject) => {
                    socket.emit('api.call', {
                        cmd: 'get-transmitters', data: { norad_cat_id: noradId },
                    }, response => {
                        if (response.success) resolve(response.data);
                        else reject(new Error(response.error || 'Failed to fetch transmitters'));
                    });
                }),
            ]);
            const satellite = satellites.find(sat => String(sat.norad_id) === String(noradId));
            if (!satellite) throw new Error('Satellite not found');
            return { ...satellite, transmitters };
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

// Load status filters from localStorage or use defaults
const loadStatusFilters = () => {
    try {
        const saved = localStorage.getItem('scheduler_statusFilters');
        if (saved) {
            return JSON.parse(saved);
        }
    } catch (e) {
        console.error('Failed to load status filters from localStorage:', e);
    }
    return {
        scheduled: true,
        running: true,
        completed: true,
        failed: true,
        cancelled: true,
    };
};

const initialState = {
    observations: [],
    loading: false,
    error: null,
    selectedObservation: null,
    dialogOpen: false,
    // Monitored satellites for automatic observation generation
    monitoredSatellites: [],
    monitoredSatellitesLoading: false,
    selectedMonitoredSatellite: null,
    monitoredSatelliteDialogOpen: false,
    monitoredSatelliteError: null,
    isSavingObservation: false,
    isSavingMonitoredSatellite: false,
    // SDR parameters (gain values, antenna ports) fetched when SDR is selected
    sdrParameters: {},
    sdrParametersLoading: false,
    sdrParametersError: {},
    columnVisibility: {
        enabled: true,
        satellite: true,
        peak_elevation: true,
        pass_start: true,
        task_start: false,
        task_end: false,
        pass_end: true,
        sdr: true,
        tasks: true,
        status: true,
        actions: true,
    },
    openObservationsTableSettingsDialog: false,
    openObservationDataDialog: false,
    selectedObservationForData: null,
    // Satellite selection state for the dialog
    satelliteSelection: {
        satGroups: [],
        groupId: '',
        groupOfSats: [],
        satelliteId: '',
        searchOptions: [],
        searchLoading: false,
        selectedFromSearch: false,  // Track if satellite was selected from search
        passes: [],  // List of future passes for selected satellite
        passesLoading: false,
        selectedPassId: null,  // Selected pass ID
    },
    // Timeline view configuration
    timeline: {
        durationHours: 24,
        selectedSatelliteFilter: null,  // null = show all, or norad_id to filter
        isExpanded: true,  // Whether timeline is visible
    },
    // Status filters for observations table
    statusFilters: loadStatusFilters(),
    // Selected observation IDs in the table
    selectedObservationIds: [],
};

const schedulerSlice = createSlice({
    name: 'scheduler',
    initialState,
    reducers: {
        setSelectedObservation: (state, action) => {
            state.selectedObservation = action.payload;
        },
        setDialogOpen: (state, action) => {
            state.dialogOpen = action.payload;
        },
        setColumnVisibility: (state, action) => {
            state.columnVisibility = { ...state.columnVisibility, ...action.payload };
        },
        // Monitored satellites actions
        setSelectedMonitoredSatellite: (state, action) => {
            state.selectedMonitoredSatellite = action.payload;
        },
        setMonitoredSatelliteDialogOpen: (state, action) => {
            state.monitoredSatelliteDialogOpen = action.payload;
            // Clear error when dialog opens
            if (action.payload) {
                state.monitoredSatelliteError = null;
            }
        },
        addMonitoredSatellite: (state, action) => {
            state.monitoredSatellites.push(action.payload);
        },
        updateMonitoredSatellite: (state, action) => {
            const index = state.monitoredSatellites.findIndex(sat => sat.id === action.payload.id);
            if (index !== -1) {
                state.monitoredSatellites[index] = action.payload;
            }
        },
        deleteMonitoredSatellites: (state, action) => {
            state.monitoredSatellites = state.monitoredSatellites.filter(
                sat => !action.payload.includes(sat.id)
            );
        },
        toggleMonitoredSatelliteEnabled: (state, action) => {
            const satellite = state.monitoredSatellites.find(sat => sat.id === action.payload.id);
            if (satellite) {
                satellite.enabled = action.payload.enabled;
            }
        },
        addObservation: (state, action) => {
            state.observations.push(action.payload);
        },
        updateObservation: (state, action) => {
            const index = state.observations.findIndex(obs => obs.id === action.payload.id);
            if (index !== -1) {
                state.observations[index] = action.payload;
            }
        },
        deleteObservations: (state, action) => {
            state.observations = state.observations.filter(
                obs => !action.payload.includes(obs.id)
            );
        },
        toggleObservationEnabledLocal: (state, action) => {
            const observation = state.observations.find(obs => obs.id === action.payload.id);
            if (observation) {
                observation.enabled = action.payload.enabled;
            }
        },
        // Handle real-time observation status updates from socket
        observationStatusUpdated: (state, action) => {
            const { id, status } = action.payload;
            const observation = state.observations.find(obs => obs.id === id);
            if (observation) {
                observation.status = status;
            }
        },
        // Satellite selection actions
        setSatGroups: (state, action) => {
            state.satelliteSelection.satGroups = action.payload;
        },
        setGroupId: (state, action) => {
            state.satelliteSelection.groupId = action.payload;
        },
        setGroupOfSats: (state, action) => {
            state.satelliteSelection.groupOfSats = action.payload;
        },
        setSatelliteId: (state, action) => {
            state.satelliteSelection.satelliteId = action.payload;
        },
        setSearchOptions: (state, action) => {
            state.satelliteSelection.searchOptions = action.payload;
        },
        setSearchLoading: (state, action) => {
            state.satelliteSelection.searchLoading = action.payload;
        },
        setSelectedFromSearch: (state, action) => {
            state.satelliteSelection.selectedFromSearch = action.payload;
        },
        setSelectedPassId: (state, action) => {
            state.satelliteSelection.selectedPassId = action.payload;
        },
        // Timeline actions
        setTimelineDuration: (state, action) => {
            state.timeline.durationHours = action.payload;
        },
        setTimelineSatelliteFilter: (state, action) => {
            state.timeline.selectedSatelliteFilter = action.payload;
        },
        setTimelineExpanded: (state, action) => {
            state.timeline.isExpanded = action.payload;
        },
        toggleStatusFilter: (state, action) => {
            const status = action.payload;
            state.statusFilters[status] = !state.statusFilters[status];
            // Persist to localStorage
            try {
                localStorage.setItem('scheduler_statusFilters', JSON.stringify(state.statusFilters));
            } catch (e) {
                console.error('Failed to save status filters to localStorage:', e);
            }
        },
        setSelectedObservationIds: (state, action) => {
            state.selectedObservationIds = action.payload;
        },
        setOpenObservationsTableSettingsDialog: (state, action) => {
            state.openObservationsTableSettingsDialog = action.payload;
        },
        setObservationsTableColumnVisibility: (state, action) => {
            state.columnVisibility = action.payload;
        },
        setOpenObservationDataDialog: (state, action) => {
            state.openObservationDataDialog = action.payload;
        },
        setSelectedObservationForData: (state, action) => {
            state.selectedObservationForData = action.payload;
        },
    },
    extraReducers: (builder) => {
        builder
            // Fetch observations
            .addCase(fetchScheduledObservations.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchScheduledObservations.fulfilled, (state, action) => {
                state.loading = false;
                state.observations = action.payload;
            })
            .addCase(fetchScheduledObservations.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })
            // Fetch single observation
            .addCase(fetchSingleObservation.fulfilled, (state, action) => {
                // Update the observation in the array
                const index = state.observations.findIndex(obs => obs.id === action.payload.id);
                if (index !== -1) {
                    state.observations[index] = action.payload;
                }
                // Update selectedObservationForData if it's the same observation
                if (state.selectedObservationForData?.id === action.payload.id) {
                    state.selectedObservationForData = action.payload;
                }
            })
            // Create observation
            .addCase(createScheduledObservation.pending, (state) => {
                state.isSavingObservation = true;
            })
            .addCase(createScheduledObservation.fulfilled, (state, action) => {
                state.observations.push(action.payload);
                state.dialogOpen = false;
                state.isSavingObservation = false;
            })
            .addCase(createScheduledObservation.rejected, (state) => {
                state.isSavingObservation = false;
            })
            // Update observation
            .addCase(updateScheduledObservation.pending, (state) => {
                state.isSavingObservation = true;
            })
            .addCase(updateScheduledObservation.fulfilled, (state, action) => {
                const index = state.observations.findIndex(obs => obs.id === action.payload.id);
                if (index !== -1) {
                    state.observations[index] = action.payload;
                }
                state.dialogOpen = false;
                state.isSavingObservation = false;
            })
            .addCase(updateScheduledObservation.rejected, (state) => {
                state.isSavingObservation = false;
            })
            // Delete observations
            .addCase(deleteScheduledObservations.fulfilled, (state, action) => {
                state.observations = state.observations.filter(
                    obs => !action.payload.ids.includes(obs.id)
                );
            })
            // Toggle enabled
            .addCase(toggleObservationEnabled.fulfilled, (state, action) => {
                const observation = state.observations.find(obs => obs.id === action.payload.id);
                if (observation) {
                    observation.enabled = action.payload.enabled;
                }
            })
            // Cancel observation
            .addCase(cancelRunningObservation.fulfilled, (state, action) => {
                const observation = state.observations.find(obs => obs.id === action.payload.id);
                if (observation) {
                    observation.status = 'cancelled';
                }
            })
            // Fetch passes
            .addCase(fetchNextPassesForScheduler.pending, (state) => {
                state.satelliteSelection.passesLoading = true;
            })
            .addCase(fetchNextPassesForScheduler.fulfilled, (state, action) => {
                state.satelliteSelection.passesLoading = false;
                state.satelliteSelection.passes = action.payload;
            })
            .addCase(fetchNextPassesForScheduler.rejected, (state) => {
                state.satelliteSelection.passesLoading = false;
                state.satelliteSelection.passes = [];
            })
            // Fetch monitored satellites
            .addCase(fetchMonitoredSatellites.pending, (state) => {
                state.monitoredSatellitesLoading = true;
            })
            .addCase(fetchMonitoredSatellites.fulfilled, (state, action) => {
                state.monitoredSatellitesLoading = false;
                state.monitoredSatellites = action.payload;
            })
            .addCase(fetchMonitoredSatellites.rejected, (state) => {
                state.monitoredSatellitesLoading = false;
            })
            // Fetch SDR parameters
            .addCase(fetchSDRParameters.pending, (state, action) => {
                state.sdrParametersLoading = true;
                // Clear previous error for this SDR
                const sdrId = action.meta.arg.sdrId;
                if (sdrId && state.sdrParametersError[sdrId]) {
                    delete state.sdrParametersError[sdrId];
                }
            })
            .addCase(fetchSDRParameters.fulfilled, (state, action) => {
                state.sdrParametersLoading = false;
                const { sdrId, parameters } = action.payload;
                state.sdrParameters[sdrId] = parameters;
                // Clear any error for this SDR
                if (state.sdrParametersError[sdrId]) {
                    delete state.sdrParametersError[sdrId];
                }
            })
            .addCase(fetchSDRParameters.rejected, (state, action) => {
                state.sdrParametersLoading = false;
                const { sdrId, error } = action.payload || {};
                if (sdrId) {
                    state.sdrParametersError[sdrId] = error || 'Failed to fetch SDR parameters';
                }
            })
            // Create monitored satellite
            .addCase(createMonitoredSatellite.pending, (state) => {
                state.isSavingMonitoredSatellite = true;
                state.monitoredSatelliteError = null;
            })
            .addCase(createMonitoredSatellite.fulfilled, (state, action) => {
                state.monitoredSatellites.push(action.payload);
                // Save and Generate keeps the form open until generation also finishes.
                if (!action.meta.arg?.keepDialogOpen) state.monitoredSatelliteDialogOpen = false;
                state.isSavingMonitoredSatellite = false;
                state.monitoredSatelliteError = null;
            })
            .addCase(createMonitoredSatellite.rejected, (state, action) => {
                state.isSavingMonitoredSatellite = false;
                state.monitoredSatelliteError = action.payload;
            })
            // Update monitored satellite
            .addCase(updateMonitoredSatelliteAsync.pending, (state) => {
                state.isSavingMonitoredSatellite = true;
                state.monitoredSatelliteError = null;
            })
            .addCase(updateMonitoredSatelliteAsync.fulfilled, (state, action) => {
                const index = state.monitoredSatellites.findIndex(sat => sat.id === action.payload.id);
                if (index !== -1) {
                    state.monitoredSatellites[index] = action.payload;
                }
                if (!action.meta.arg?.keepDialogOpen) state.monitoredSatelliteDialogOpen = false;
                state.isSavingMonitoredSatellite = false;
                state.monitoredSatelliteError = null;
            })
            .addCase(updateMonitoredSatelliteAsync.rejected, (state, action) => {
                state.isSavingMonitoredSatellite = false;
                state.monitoredSatelliteError = action.payload;
            })
            // Delete monitored satellites
            .addCase(deleteMonitoredSatellitesAsync.fulfilled, (state, action) => {
                state.monitoredSatellites = state.monitoredSatellites.filter(
                    sat => !action.payload.ids.includes(sat.id)
                );
            })
            // Toggle monitored satellite enabled
            .addCase(toggleMonitoredSatelliteEnabledAsync.fulfilled, (state, action) => {
                const satellite = state.monitoredSatellites.find(sat => sat.id === action.payload.id);
                if (satellite) {
                    satellite.enabled = action.payload.enabled;
                }
            });
    },
});

export const {
    setSelectedObservation,
    setDialogOpen,
    setColumnVisibility,
    observationStatusUpdated,
    setSelectedMonitoredSatellite,
    setMonitoredSatelliteDialogOpen,
    addMonitoredSatellite,
    updateMonitoredSatellite,
    deleteMonitoredSatellites,
    toggleMonitoredSatelliteEnabled,
    addObservation,
    updateObservation,
    deleteObservations,
    toggleObservationEnabledLocal,
    setSatGroups,
    setGroupId,
    setGroupOfSats,
    setSatelliteId,
    setSearchOptions,
    setSearchLoading,
    setSelectedFromSearch,
    setSelectedPassId,
    setTimelineDuration,
    setTimelineSatelliteFilter,
    setTimelineExpanded,
    toggleStatusFilter,
    setSelectedObservationIds,
    setOpenObservationsTableSettingsDialog,
    setObservationsTableColumnVisibility,
    setOpenObservationDataDialog,
    setSelectedObservationForData,
} = schedulerSlice.actions;

export default schedulerSlice.reducer;
