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

import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

export const CELESTIAL_PASSES_DEFAULT_COLUMN_VISIBILITY = {
    status: true,
    name: true,
    targetType: true,
    peakElevationDeg: true,
    currentElevationDeg: true,
    progress: true,
    duration: true,
    eventStart: true,
    eventEnd: true,
    startAzimuthDeg: true,
    endAzimuthDeg: true,
    peakAzimuthDeg: true,
    cacheStatus: true,
    stale: true,
    source: true,
};
export const CELESTIAL_PASSES_DEFAULT_PAGE_SIZE = 10;
export const CELESTIAL_PASSES_DEFAULT_SORT_MODEL = [
    { field: 'status', sort: 'asc' },
    { field: 'eventStart', sort: 'asc' },
];
export const CELESTIAL_PASSES_DEFAULTS_VERSION = 3;

export const fetchCelestialScene = createAsyncThunk(
    'celestial/fetchScene',
    async ({ socket, payload = {} }, { rejectWithValue }) => {
        return await new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: 'get-celestial-scene',
  data: payload
}, response => {
  if (response?.success) {
    resolve(response.data);
  } else {
    reject(rejectWithValue(response?.error || 'Failed to fetch celestial scene'));
  }
});
        });
    }
);

export const fetchSolarSystemScene = createAsyncThunk(
    'celestial/fetchSolarSystemScene',
    async ({ socket, payload = {} }, { rejectWithValue }) => {
        return await new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: 'get-solar-system-scene',
  data: payload
}, response => {
  if (response?.success) {
    resolve(response.data);
  } else {
    reject(rejectWithValue(response?.error || 'Failed to fetch solar system scene'));
  }
});
        });
    }
);

export const fetchCelestialTracks = createAsyncThunk(
    'celestial/fetchCelestialTracks',
    async ({ socket, payload = {} }, { rejectWithValue }) => {
        return await new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: 'get-celestial-tracks',
  data: payload
}, response => {
  if (response?.success) {
    resolve(response.data);
  } else {
    reject(rejectWithValue(response?.error || 'Failed to fetch celestial tracks'));
  }
});
        });
    }
);

export const refreshCelestialScene = createAsyncThunk(
    'celestial/refreshScene',
    async ({ socket, payload = {} }, { rejectWithValue }) => {
        return await new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: 'refresh-celestial-now',
  data: payload
}, response => {
  if (response?.success) {
    resolve(response.data);
  } else {
    reject(rejectWithValue(response?.error || 'Failed to refresh celestial scene'));
  }
});
        });
    }
);

export const refreshMonitoredCelestialNow = createAsyncThunk(
    'celestial/refreshMonitoredNow',
    async ({ socket, ids = [], payload = {} }, { rejectWithValue }) => {
        return await new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: 'refresh-monitored-celestial-now',
  data: {
    ids,
    ...payload
  }
}, response => {
  if (response?.success) {
    resolve(response.data);
  } else {
    reject(rejectWithValue(response?.error || 'Failed to refresh monitored celestial targets'));
  }
});
        });
    }
);

export const getCelestialMapSettings = createAsyncThunk(
    'celestial/getMapSettings',
    async ({ socket }, { rejectWithValue }) => {
        return await new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: 'get-map-settings',
  data: 'celestial-map-settings'
}, response => {
  if (response?.success) {
    resolve(response?.data?.value || null);
  } else {
    reject(rejectWithValue('Failed to get celestial map settings'));
  }
});
        });
    }
);

export const setCelestialMapSettings = createAsyncThunk(
    'celestial/setMapSettings',
    async ({ socket, value }, { rejectWithValue }) => {
        return await new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: 'set-map-settings',
  data: {
    name: 'celestial-map-settings',
    value
  }
}, response => {
  if (response?.success) {
    resolve(response?.data?.value || value);
  } else {
    reject(rejectWithValue('Failed to set celestial map settings'));
  }
});
        });
    }
);

const normalizeScenePayload = (payload) => {
    if (!payload || typeof payload !== 'object') return payload;
    const nested = payload.data;
    if (
        nested
        && typeof nested === 'object'
        && (
            Array.isArray(nested.planets)
            || Array.isArray(nested.celestial)
            || Array.isArray(nested.celestial_passes)
        )
    ) {
        return nested;
    }
    return payload;
};

const celestialSlice = createSlice({
    name: 'celestial',
    initialState: {
        solarScene: null,
        celestialTracks: null,
        tracksProgress: null,
        mapSettings: null,
        passesTableColumnVisibility: { ...CELESTIAL_PASSES_DEFAULT_COLUMN_VISIBILITY },
        passesTablePageSize: CELESTIAL_PASSES_DEFAULT_PAGE_SIZE,
        passesTableSortModel: [...CELESTIAL_PASSES_DEFAULT_SORT_MODEL],
        passesTableDefaultsVersion: CELESTIAL_PASSES_DEFAULTS_VERSION,
        solarLoading: false,
        tracksLoading: false,
        error: null,
        lastUpdated: null,
    },
    reducers: {
        setCelestialSceneLive: (state, action) => {
            const payload = normalizeScenePayload(action.payload) || {};
            state.solarScene = payload;
            state.celestialTracks = payload;
            state.error = null;
            state.lastUpdated = new Date().toISOString();
        },
        setSolarSceneLive: (state, action) => {
            state.solarScene = normalizeScenePayload(action.payload);
            state.error = null;
            state.lastUpdated = new Date().toISOString();
        },
        setCelestialTracksLive: (state, action) => {
            state.celestialTracks = normalizeScenePayload(action.payload);
            state.error = null;
            state.lastUpdated = new Date().toISOString();
        },
        upsertCelestialTrackRowLive: (state, action) => {
            const payload = action.payload || {};
            const row = payload.row || null;
            if (!row) return;

            const nextTracks = state.celestialTracks ? { ...state.celestialTracks } : {
                timestamp_utc: payload.timestamp_utc || new Date().toISOString(),
                frame: payload.frame || 'heliocentric-ecliptic',
                center: payload.center || 'sun',
                units: payload.units || { position: 'au', velocity: 'au/day' },
                celestial: [],
                meta: payload.meta || {},
            };

            const existingRows = Array.isArray(nextTracks.celestial) ? [...nextTracks.celestial] : [];
            const targetKey = String(row.target_key || '').trim()
                || (() => {
                    const type = String(row.target_type || 'mission').toLowerCase();
                    if (type === 'body') {
                        const bodyId = String(row.body_id || row.command || '').toLowerCase();
                        return bodyId ? `body:${bodyId}` : '';
                    }
                    const command = String(row.command || '').trim();
                    return command ? `mission:${command}` : '';
                })();
            if (!targetKey) return;
            const existingIndex = existingRows.findIndex(
                (item) => {
                    const existingKey = String(item?.target_key || '').trim()
                        || (() => {
                            const type = String(item?.target_type || 'mission').toLowerCase();
                            if (type === 'body') {
                                const bodyId = String(item?.body_id || item?.command || '').toLowerCase();
                                return bodyId ? `body:${bodyId}` : '';
                            }
                            const command = String(item?.command || '').trim();
                            return command ? `mission:${command}` : '';
                        })();
                    return existingKey === targetKey;
                },
            );

            if (existingIndex >= 0) {
                existingRows[existingIndex] = { ...existingRows[existingIndex], ...row };
            } else {
                existingRows.push(row);
            }

            nextTracks.celestial = existingRows;
            nextTracks.timestamp_utc = payload.timestamp_utc || nextTracks.timestamp_utc;
            nextTracks.frame = payload.frame || nextTracks.frame;
            nextTracks.center = payload.center || nextTracks.center;
            nextTracks.units = payload.units || nextTracks.units;
            nextTracks.meta = { ...(nextTracks.meta || {}), ...(payload.meta || {}) };

            state.celestialTracks = nextTracks;
            state.tracksProgress = payload.progress || state.tracksProgress;
            state.error = null;
            state.lastUpdated = new Date().toISOString();
        },
        setCelestialPassesTableColumnVisibility: (state, action) => {
            state.passesTableColumnVisibility = action.payload || {};
        },
        setCelestialPassesTablePageSize: (state, action) => {
            const next = Number(action.payload);
            state.passesTablePageSize = Number.isFinite(next) && next > 0 ? next : 10;
        },
        setCelestialPassesTableSortModel: (state, action) => {
            state.passesTableSortModel = action.payload || [];
        },
        // Keep reset atomic so persisted state doesn't observe intermediate table values.
        resetCelestialPassesTableSettings: (state) => {
            state.passesTableColumnVisibility = { ...CELESTIAL_PASSES_DEFAULT_COLUMN_VISIBILITY };
            state.passesTablePageSize = CELESTIAL_PASSES_DEFAULT_PAGE_SIZE;
            state.passesTableSortModel = [...CELESTIAL_PASSES_DEFAULT_SORT_MODEL];
            state.passesTableDefaultsVersion = CELESTIAL_PASSES_DEFAULTS_VERSION;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchCelestialScene.pending, (state) => {
                state.solarLoading = true;
                state.tracksLoading = true;
                state.error = null;
            })
            .addCase(fetchCelestialScene.fulfilled, (state, action) => {
                state.solarLoading = false;
                state.tracksLoading = false;
                const payload = normalizeScenePayload(action.payload);
                state.solarScene = payload;
                state.celestialTracks = payload;
                state.lastUpdated = new Date().toISOString();
            })
            .addCase(fetchCelestialScene.rejected, (state, action) => {
                state.solarLoading = false;
                state.tracksLoading = false;
                state.error = action.payload || action.error?.message || 'Unknown error';
            })
            .addCase(fetchSolarSystemScene.pending, (state) => {
                state.solarLoading = true;
                state.error = null;
            })
            .addCase(fetchSolarSystemScene.fulfilled, (state, action) => {
                state.solarLoading = false;
                state.solarScene = normalizeScenePayload(action.payload);
                state.lastUpdated = new Date().toISOString();
            })
            .addCase(fetchSolarSystemScene.rejected, (state, action) => {
                state.solarLoading = false;
                state.error = action.payload || action.error?.message || 'Unknown error';
            })
            .addCase(fetchCelestialTracks.pending, (state) => {
                state.tracksLoading = true;
                state.error = null;
            })
            .addCase(fetchCelestialTracks.fulfilled, (state, action) => {
                state.tracksLoading = false;
                state.celestialTracks = normalizeScenePayload(action.payload);
                state.tracksProgress = null;
                state.lastUpdated = new Date().toISOString();
            })
            .addCase(fetchCelestialTracks.rejected, (state, action) => {
                state.tracksLoading = false;
                state.error = action.payload || action.error?.message || 'Unknown error';
            })
            .addCase(refreshCelestialScene.pending, (state) => {
                state.solarLoading = true;
                state.tracksLoading = true;
                state.error = null;
            })
            .addCase(refreshCelestialScene.fulfilled, (state, action) => {
                state.solarLoading = false;
                state.tracksLoading = false;
                const payload = normalizeScenePayload(action.payload);
                state.solarScene = payload;
                state.celestialTracks = payload;
                state.lastUpdated = new Date().toISOString();
            })
            .addCase(refreshCelestialScene.rejected, (state, action) => {
                state.solarLoading = false;
                state.tracksLoading = false;
                state.error = action.payload || action.error?.message || 'Unknown error';
            })
            .addCase(refreshMonitoredCelestialNow.pending, (state) => {
                state.tracksLoading = true;
                state.error = null;
            })
            .addCase(refreshMonitoredCelestialNow.fulfilled, (state, action) => {
                state.tracksLoading = false;
                const requestedIds = action?.meta?.arg?.ids;
                const isPartialRefresh = Array.isArray(requestedIds) && requestedIds.length > 0;
                if (isPartialRefresh) {
                    const payload = normalizeScenePayload(action.payload) || {};
                    const incomingRows = Array.isArray(payload?.celestial) ? payload.celestial : [];
                    const currentTracks = state.celestialTracks ? { ...state.celestialTracks } : {};
                    const existingRows = Array.isArray(currentTracks?.celestial)
                        ? [...currentTracks.celestial]
                        : [];
                    const rowIndexByTargetKey = new Map();

                    existingRows.forEach((item, index) => {
                        const existingKey = String(item?.target_key || '').trim()
                            || (() => {
                                const type = String(item?.target_type || 'mission').toLowerCase();
                                if (type === 'body') {
                                    const bodyId = String(item?.body_id || item?.command || '').toLowerCase();
                                    return bodyId ? `body:${bodyId}` : '';
                                }
                                const command = String(item?.command || '').trim();
                                return command ? `mission:${command}` : '';
                            })();
                        if (existingKey) rowIndexByTargetKey.set(existingKey, index);
                    });

                    incomingRows.forEach((row) => {
                        const targetKey = String(row?.target_key || '').trim()
                            || (() => {
                                const type = String(row?.target_type || 'mission').toLowerCase();
                                if (type === 'body') {
                                    const bodyId = String(row?.body_id || row?.command || '').toLowerCase();
                                    return bodyId ? `body:${bodyId}` : '';
                                }
                                const command = String(row?.command || '').trim();
                                return command ? `mission:${command}` : '';
                            })();
                        if (!targetKey) return;

                        const existingIndex = rowIndexByTargetKey.get(targetKey);
                        if (existingIndex !== undefined) {
                            existingRows[existingIndex] = { ...existingRows[existingIndex], ...row };
                        } else {
                            rowIndexByTargetKey.set(targetKey, existingRows.length);
                            existingRows.push(row);
                        }
                    });

                    state.celestialTracks = {
                        ...currentTracks,
                        ...payload,
                        celestial: existingRows,
                    };
                } else {
                    state.celestialTracks = normalizeScenePayload(action.payload);
                }
                state.tracksProgress = null;
                state.lastUpdated = new Date().toISOString();
            })
            .addCase(refreshMonitoredCelestialNow.rejected, (state, action) => {
                state.tracksLoading = false;
                state.error = action.payload || action.error?.message || 'Unknown error';
            })
            .addCase(getCelestialMapSettings.fulfilled, (state, action) => {
                if (action.payload !== null && action.payload !== undefined) {
                    state.mapSettings = action.payload;
                }
            })
            .addCase(setCelestialMapSettings.fulfilled, (state, action) => {
                state.mapSettings = action.payload;
            });
    },
});

export const {
    setCelestialSceneLive,
    setSolarSceneLive,
    setCelestialTracksLive,
    upsertCelestialTrackRowLive,
    setCelestialPassesTableColumnVisibility,
    setCelestialPassesTablePageSize,
    setCelestialPassesTableSortModel,
    resetCelestialPassesTableSettings,
} = celestialSlice.actions;
export default celestialSlice.reducer;
