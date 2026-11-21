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

const mergeLivePointingIntoTracks = (tracks, livePointing) => {
    if (!tracks || !livePointing?.targetKey) return tracks;
    const rows = Array.isArray(tracks.celestial) ? tracks.celestial : [];
    const targetIndex = rows.findIndex(
        (row) => String(row?.target_key || '').trim() === livePointing.targetKey,
    );
    if (targetIndex < 0) return tracks;

    const target = rows[targetIndex] || {};
    const nextRows = [...rows];
    nextRows[targetIndex] = {
        ...target,
        sky_position: {
            ...(target.sky_position || {}),
            az_deg: livePointing.azDeg,
            el_deg: livePointing.elDeg,
        },
        visibility: {
            ...(target.visibility || {}),
            above_horizon: livePointing.elDeg > 0,
            visible: livePointing.elDeg > 0,
        },
    };

    return {
        ...tracks,
        celestial: nextRows,
        // Keep the planetarium's star field and pass-current indicator aligned
        // with the tracker emission that supplied the live target coordinates.
        timestamp_utc: livePointing.timestampUtc || tracks.timestamp_utc,
    };
};

// The backend may stream many individual rows while it builds a scene. Merge a
// batch in one Redux update so consumers do not render once per incoming row.
const applyCelestialTrackRowUpdates = (state, payloads) => {
    const updates = Array.isArray(payloads) ? payloads : [];
    const validUpdates = updates.filter((payload) => (
        payload?.row && String(payload.row.target_key || '').trim()
    ));
    if (!validUpdates.length) return;

    const firstPayload = validUpdates[0];
    const nextTracks = state.celestialTracks ? { ...state.celestialTracks } : {
        timestamp_utc: firstPayload.timestamp_utc || new Date().toISOString(),
        frame: firstPayload.frame || 'heliocentric-ecliptic',
        center: firstPayload.center || 'sun',
        units: firstPayload.units || { position: 'au', velocity: 'au/day' },
        celestial: [],
        meta: firstPayload.meta || {},
    };
    const rows = Array.isArray(nextTracks.celestial) ? [...nextTracks.celestial] : [];
    const rowIndexByTargetKey = new Map(rows.map((row, index) => [
        String(row?.target_key || '').trim(),
        index,
    ]));
    let latestProgress = state.tracksProgress;

    validUpdates.forEach((payload) => {
        const targetKey = String(payload.row.target_key || '').trim();
        const existingIndex = rowIndexByTargetKey.get(targetKey);
        if (existingIndex === undefined) {
            rowIndexByTargetKey.set(targetKey, rows.length);
            rows.push(payload.row);
        } else {
            rows[existingIndex] = { ...rows[existingIndex], ...payload.row };
        }

        nextTracks.timestamp_utc = payload.timestamp_utc || nextTracks.timestamp_utc;
        nextTracks.frame = payload.frame || nextTracks.frame;
        nextTracks.center = payload.center || nextTracks.center;
        nextTracks.units = payload.units || nextTracks.units;
        nextTracks.meta = { ...(nextTracks.meta || {}), ...(payload.meta || {}) };
        latestProgress = payload.progress || latestProgress;
    });

    nextTracks.celestial = rows;
    state.celestialTracks = nextTracks;
    state.tracksProgress = latestProgress;
    state.error = null;
    state.lastUpdated = new Date().toISOString();
};

const applySolarSystemBodyUpdates = (state, payloads) => {
    const updates = (Array.isArray(payloads) ? payloads : []).filter((payload) => (
        payload?.request_id === state.activeSolarRequestId
        && String(payload?.body?.target_key || '').trim()
    ));
    if (!updates.length) return;

    const nextScene = state.solarScene ? { ...state.solarScene } : { planets: [] };
    const planets = Array.isArray(nextScene.planets) ? [...nextScene.planets] : [];
    const planetIndexByTargetKey = new Map(planets.map((body, index) => [
        String(body?.target_key || '').trim(),
        index,
    ]));
    let latestProgress = state.solarProgress;

    updates.forEach((payload) => {
        const targetKey = String(payload.body.target_key || '').trim();
        const existingIndex = planetIndexByTargetKey.get(targetKey);
        if (existingIndex === undefined) {
            planetIndexByTargetKey.set(targetKey, planets.length);
            planets.push(payload.body);
        } else {
            planets[existingIndex] = { ...planets[existingIndex], ...payload.body };
        }
        latestProgress = payload.progress || latestProgress;
    });

    nextScene.planets = planets;
    state.solarScene = nextScene;
    state.solarProgress = latestProgress;
    state.lastUpdated = new Date().toISOString();
};

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
    async ({ socket, payload = {} }, { rejectWithValue, requestId }) => {
        return await new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: 'get-solar-system-scene',
  data: { ...payload, request_id: requestId }
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

export const fetchTargetCelestialScene = createAsyncThunk(
    'celestial/fetchTargetScene',
    async ({ socket, payload = {}, requestKey }, { rejectWithValue }) => {
        const fetchScenePart = async (cmd, errorMessage) => {
            // Plain ACK callbacks are silently discarded on disconnect, leaving
            // every island stuck behind the shared loading guard. Timed ACKs
            // reject on disconnect as well as when the server stops replying.
            const request = () => socket.timeout(60_000).emitWithAck('api.call', { cmd, data: payload });
            let response;
            try {
                response = await request();
            } catch {
                // Retry this read once; Socket.IO buffers it until reconnect.
                // Keep a successful sibling response and bound offline waiting.
                response = await request();
            }
            if (!response?.success) {
                throw new Error(response?.error || errorMessage);
            }
            return response.data;
        };

        try {
            const [solarScene, celestialTracks] = await Promise.all([
                fetchScenePart('get-solar-system-scene', 'Failed to fetch solar system scene'),
                fetchScenePart('get-celestial-tracks', 'Failed to fetch celestial tracks'),
            ]);
            return { requestKey, solarScene, celestialTracks };
        } catch (error) {
            return rejectWithValue(error?.message || 'Failed to fetch target celestial scene');
        }
    },
    {
        // Several target islands render at once; let the first request populate their shared entry.
        condition: ({ requestKey }, { getState }) => Boolean(requestKey)
            && !getState()?.celestial?.targetScenesByKey?.[requestKey]?.loading,
    },
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
        observerSkyBodies: [],
        // Target-page requests are isolated from the live monitored-target broadcast.
        targetScenesByKey: {},
        tracksProgress: null,
        solarProgress: null,
        activeSolarRequestId: null,
        mapSettings: null,
        passesTableColumnVisibility: { ...CELESTIAL_PASSES_DEFAULT_COLUMN_VISIBILITY },
        passesTablePageSize: CELESTIAL_PASSES_DEFAULT_PAGE_SIZE,
        passesTableSortModel: [...CELESTIAL_PASSES_DEFAULT_SORT_MODEL],
        passesTableDefaultsVersion: CELESTIAL_PASSES_DEFAULTS_VERSION,
        solarLoading: false,
        tracksLoading: false,
        ephemerisSync: {
            status: 'idle',
            progress: 0,
            error: null,
            providerStatus: null,
        },
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
        applyCelestialTracksLiveDelta: (state, action) => {
            // A full snapshot owns rows and pass lists. Pointing ticks update
            // existing rows only, so a new target waits for its full snapshot.
            if (!state.celestialTracks) return;
            const payload = action.payload || {};
            const updates = new Map(
                (Array.isArray(payload.celestial) ? payload.celestial : [])
                    .filter((row) => row?.target_key)
                    .map((row) => [row.target_key, row]),
            );
            state.celestialTracks.celestial = (state.celestialTracks.celestial || [])
                .map((row) => ({ ...row, ...(updates.get(row.target_key) || {}) }));
            if (Array.isArray(payload.observer_bodies)) {
                state.celestialTracks.observer_bodies = payload.observer_bodies;
            }
            if (payload.timestamp_utc) {
                state.celestialTracks.timestamp_utc = payload.timestamp_utc;
            }
            state.lastUpdated = new Date().toISOString();
        },
        upsertCelestialTrackRowLive: (state, action) => {
            applyCelestialTrackRowUpdates(state, [action.payload || {}]);
        },
        upsertCelestialTrackRowsLive: (state, action) => {
            applyCelestialTrackRowUpdates(state, action.payload?.updates);
        },
        upsertSolarSystemBodyLive: (state, action) => {
            applySolarSystemBodyUpdates(state, [action.payload || {}]);
        },
        upsertSolarSystemBodiesLive: (state, action) => {
            applySolarSystemBodyUpdates(state, action.payload?.updates);
        },
        setTargetCelestialLivePointing: (state, action) => {
            const payload = action.payload || {};
            const targetKey = String(payload.targetKey || '').trim();
            const azDeg = Number(payload.azDeg);
            const elDeg = Number(payload.elDeg);
            if (!targetKey || !Number.isFinite(azDeg) || !Number.isFinite(elDeg)) return;

            const livePointing = {
                targetKey,
                azDeg,
                elDeg,
                timestampUtc: String(payload.timestampUtc || new Date().toISOString()),
            };

            Object.entries(state.targetScenesByKey).forEach(([requestKey, entry]) => {
                const isTargetRequest = requestKey === targetKey
                    || requestKey.startsWith(`${targetKey}:`);
                if (!entry?.celestialTracks) {
                    // Preserve a tracker update that arrives while the initial
                    // scene request is still in flight; the fulfilled handler
                    // applies it to the newly received target row.
                    if (isTargetRequest) {
                        state.targetScenesByKey[requestKey] = { ...entry, livePointing };
                    }
                    return;
                }
                const celestialTracks = mergeLivePointingIntoTracks(entry?.celestialTracks, livePointing);
                // A page can cache multiple windows for the same target. Only
                // touch entries that actually contain this target's scene row.
                if (celestialTracks === entry?.celestialTracks) return;
                state.targetScenesByKey[requestKey] = {
                    ...entry,
                    celestialTracks,
                    livePointing,
                };
            });
        },
        setObserverSkyBodies: (state, action) => {
            state.observerSkyBodies = Array.isArray(action.payload) ? action.payload : [];
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
        setCelestialEphemerisSyncStarted: (state) => {
            state.ephemerisSync = {
                ...state.ephemerisSync,
                status: 'inprogress',
                progress: 0,
                error: null,
            };
        },
        setCelestialEphemerisSyncProgress: (state, action) => {
            const progress = action.payload || {};
            state.ephemerisSync = {
                ...state.ephemerisSync,
                status: 'inprogress',
                progress: Number(progress.percent || 0),
                processed: Number(progress.processed || 0),
                total: Number(progress.total || 0),
                refreshed: Number(progress.refreshed || 0),
                providerFetched: Number(progress.provider_fetched || 0),
                cacheReused: Number(progress.cache_reused || 0),
                staleFallback: Number(progress.stale_fallback || 0),
                failed: Number(progress.failed || 0),
                currentTarget: progress.current_target || null,
            };
        },
        setCelestialEphemerisSyncCompleted: (state, action) => {
            const result = action.payload || {};
            state.ephemerisSync = {
                status: 'complete',
                progress: 100,
                processed: Number(result.count || 0),
                total: Number(result.count || 0),
                refreshed: Number(result.refreshed || 0),
                providerFetched: Number(result.provider_fetched || 0),
                cacheReused: Number(result.cache_reused || 0),
                staleFallback: Number(result.stale_fallback || 0),
                failed: Number(result.failed || 0),
                currentTarget: null,
                error: null,
                providerStatus: result.provider_status || state.ephemerisSync?.providerStatus || null,
            };
        },
        setCelestialEphemerisSyncFailed: (state, action) => {
            const payload = action.payload || {};
            const result = payload.result || {};
            state.ephemerisSync = {
                ...state.ephemerisSync,
                status: 'failed',
                progress: Number(state.ephemerisSync?.progress || 0),
                processed: Number(result.count || state.ephemerisSync?.processed || 0),
                total: Number(result.count || state.ephemerisSync?.total || 0),
                refreshed: Number(result.refreshed || 0),
                providerFetched: Number(result.provider_fetched || 0),
                cacheReused: Number(result.cache_reused || 0),
                staleFallback: Number(result.stale_fallback || 0),
                failed: Number(result.failed || 0),
                currentTarget: null,
                error: payload.error || result.error || 'Ephemeris synchronization failed',
                providerStatus: result.provider_status || state.ephemerisSync?.providerStatus || null,
            };
        },
        setCelestialEphemerisStatus: (state, action) => {
            const status = action.payload || {};
            const providerStatus = status.provider?.status || null;
            const sharedState = status.sync?.state;
            if (!sharedState || typeof sharedState !== 'object') {
                state.ephemerisSync.providerStatus = providerStatus;
                return;
            }

            const normalizedStatus = String(sharedState.status || 'idle').toLowerCase();
            const hasFailed = normalizedStatus === 'failed'
                || (normalizedStatus === 'complete' && sharedState.success === false);
            state.ephemerisSync = {
                ...state.ephemerisSync,
                status: hasFailed ? 'failed' : normalizedStatus,
                progress: Number(sharedState.progress || 0),
                processed: Number(sharedState.processed || 0),
                total: Number(sharedState.count || 0),
                refreshed: Number(sharedState.refreshed || 0),
                providerFetched: Number(sharedState.provider_fetched || 0),
                cacheReused: Number(sharedState.cache_reused || 0),
                staleFallback: Number(sharedState.stale_fallback || 0),
                failed: Number(sharedState.failed || 0),
                currentTarget: sharedState.current_target || null,
                error: hasFailed
                    ? sharedState.message || 'Ephemeris synchronization failed'
                    : null,
                providerStatus,
            };
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
            .addCase(fetchSolarSystemScene.pending, (state, action) => {
                state.solarLoading = true;
                state.activeSolarRequestId = action.meta.requestId;
                state.solarProgress = null;
                state.error = null;
            })
            .addCase(fetchSolarSystemScene.fulfilled, (state, action) => {
                if (state.activeSolarRequestId !== action.meta.requestId) return;
                state.solarLoading = false;
                state.solarScene = normalizeScenePayload(action.payload);
                state.activeSolarRequestId = null;
                state.solarProgress = null;
                state.lastUpdated = new Date().toISOString();
            })
            .addCase(fetchSolarSystemScene.rejected, (state, action) => {
                if (state.activeSolarRequestId !== action.meta.requestId) return;
                state.solarLoading = false;
                state.activeSolarRequestId = null;
                state.solarProgress = null;
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
            .addCase(fetchTargetCelestialScene.pending, (state, action) => {
                const requestKey = action.meta.arg?.requestKey;
                if (!requestKey) return;
                const currentEntry = state.targetScenesByKey[requestKey] || {};
                state.targetScenesByKey[requestKey] = {
                    ...currentEntry,
                    loading: true,
                    error: null,
                    requestId: action.meta.requestId,
                };
            })
            .addCase(fetchTargetCelestialScene.fulfilled, (state, action) => {
                const requestKey = action.payload?.requestKey;
                const currentEntry = state.targetScenesByKey[requestKey];
                // Ignore an older response that completed after a newer request for the same view.
                if (!requestKey || currentEntry?.requestId !== action.meta.requestId) return;
                const livePointing = currentEntry.livePointing;
                state.targetScenesByKey[requestKey] = {
                    solarScene: normalizeScenePayload(action.payload?.solarScene),
                    celestialTracks: mergeLivePointingIntoTracks(
                        normalizeScenePayload(action.payload?.celestialTracks),
                        livePointing,
                    ),
                    loading: false,
                    error: null,
                    requestId: action.meta.requestId,
                    updatedAt: new Date().toISOString(),
                    livePointing,
                };
            })
            .addCase(fetchTargetCelestialScene.rejected, (state, action) => {
                const requestKey = action.meta.arg?.requestKey;
                const currentEntry = state.targetScenesByKey[requestKey];
                if (!requestKey || currentEntry?.requestId !== action.meta.requestId) return;
                state.targetScenesByKey[requestKey] = {
                    ...currentEntry,
                    loading: false,
                    error: action.payload || action.error?.message || 'Unknown error',
                };
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
                    const incomingPasses = Array.isArray(payload?.celestial_passes)
                        ? payload.celestial_passes
                        : [];
                    const currentTracks = state.celestialTracks ? { ...state.celestialTracks } : {};
                    const existingRows = Array.isArray(currentTracks?.celestial)
                        ? [...currentTracks.celestial]
                        : [];
                    const existingPasses = Array.isArray(currentTracks?.celestial_passes)
                        ? currentTracks.celestial_passes
                        : [];
                    const rowIndexByTargetKey = new Map();
                    const refreshedTargetKeys = new Set();

                    existingRows.forEach((item, index) => {
                        const existingKey = String(item?.target_key || '').trim();
                        if (existingKey) rowIndexByTargetKey.set(existingKey, index);
                    });

                    incomingRows.forEach((row) => {
                        const targetKey = String(row?.target_key || '').trim();
                        if (!targetKey) return;
                        refreshedTargetKeys.add(targetKey);

                        const existingIndex = rowIndexByTargetKey.get(targetKey);
                        if (existingIndex !== undefined) {
                            existingRows[existingIndex] = { ...existingRows[existingIndex], ...row };
                        } else {
                            rowIndexByTargetKey.set(targetKey, existingRows.length);
                            existingRows.push(row);
                        }
                    });

                    incomingPasses.forEach((pass) => {
                        const targetKey = String(pass?.target_key || '').trim();
                        if (targetKey) refreshedTargetKeys.add(targetKey);
                    });

                    // A one-target refresh owns only that target's rows and passes.
                    // Keep every other target intact while replacing stale passes for
                    // the refreshed target, including the valid empty-pass result.
                    const mergedPasses = existingPasses
                        .filter((pass) => {
                            const targetKey = String(pass?.target_key || '').trim();
                            return !refreshedTargetKeys.has(targetKey);
                        })
                        .concat(incomingPasses)
                        .sort((left, right) => (
                            new Date(left?.event_start || 0).getTime()
                            - new Date(right?.event_start || 0).getTime()
                        ));

                    const currentMeta = currentTracks?.meta || {};
                    const incomingMeta = payload?.meta || {};
                    const projectionByTarget = {
                        ...(currentMeta?.projection_by_target || {}),
                        ...(incomingMeta?.projection_by_target || {}),
                    };
                    const mergedMeta = {
                        ...currentMeta,
                        ...incomingMeta,
                        // A target-specific response must not resize the shared
                        // timeline. Its viewport is controlled by the global setting.
                        projection: currentMeta?.projection || incomingMeta?.projection,
                        projection_by_target: projectionByTarget,
                        passes: {
                            ...(currentMeta?.passes || {}),
                            ...(incomingMeta?.passes || {}),
                            count: mergedPasses.length,
                        },
                        horizons: {
                            ...(currentMeta?.horizons || {}),
                            ...(incomingMeta?.horizons || {}),
                            stale_count: existingRows.filter((row) => row?.stale).length,
                            missing_count: existingRows.filter(
                                (row) => !Array.isArray(row?.position_xyz_au),
                            ).length,
                        },
                    };

                    state.celestialTracks = {
                        ...currentTracks,
                        ...payload,
                        celestial: existingRows,
                        celestial_passes: mergedPasses,
                        meta: mergedMeta,
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
    applyCelestialTracksLiveDelta,
    upsertCelestialTrackRowLive,
    upsertCelestialTrackRowsLive,
    upsertSolarSystemBodyLive,
    upsertSolarSystemBodiesLive,
    setTargetCelestialLivePointing,
    setObserverSkyBodies,
    setCelestialPassesTableColumnVisibility,
    setCelestialPassesTablePageSize,
    setCelestialPassesTableSortModel,
    resetCelestialPassesTableSettings,
    setCelestialEphemerisSyncStarted,
    setCelestialEphemerisSyncProgress,
    setCelestialEphemerisSyncCompleted,
    setCelestialEphemerisSyncFailed,
    setCelestialEphemerisStatus,
} = celestialSlice.actions;
export default celestialSlice.reducer;
