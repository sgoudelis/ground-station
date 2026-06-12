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



import {createAsyncThunk, createSlice} from '@reduxjs/toolkit';
import {getTargetMapSettings} from "../target/target-slice.jsx";
import {calculateElevationCurvesForPasses} from '../../utils/elevation-curve-calculator.js';

const MAP_ENGINE_LEAFLET = 'leaflet';
const MAP_ENGINE_MAPLIBRE = 'maplibre';
const LEAFLET_MIN_ZOOM = 0;
const MAPLIBRE_MIN_ZOOM = -6;
const MAP_MAX_ZOOM = 10;
const DEFAULT_LEAFLET_ZOOM = 1.5;
const DEFAULT_MAPLIBRE_ZOOM = 0.5;
const MAPLIBRE_UNSUPPORTED_TILE_LAYER_IDS = new Set([
    'nasa_blue_marble_4326',
    'nasa_osm_land_mask_4326',
    'nasa_osm_land_water_map_4326',
]);

const normalizeMapEngine = (mapEngine) => (
    mapEngine === MAP_ENGINE_MAPLIBRE ? MAP_ENGINE_MAPLIBRE : MAP_ENGINE_LEAFLET
);

const getMinZoomForEngine = (mapEngine) => (
    normalizeMapEngine(mapEngine) === MAP_ENGINE_MAPLIBRE ? MAPLIBRE_MIN_ZOOM : LEAFLET_MIN_ZOOM
);

const clampMapZoomForEngine = (zoomLevel, mapEngine) => {
    const parsedZoom = Number(zoomLevel);
    const minZoom = getMinZoomForEngine(mapEngine);
    if (!Number.isFinite(parsedZoom)) {
        return minZoom;
    }
    return Math.min(MAP_MAX_ZOOM, Math.max(minZoom, parsedZoom));
};

const defaultMapZoomByEngine = {
    [MAP_ENGINE_LEAFLET]: clampMapZoomForEngine(DEFAULT_LEAFLET_ZOOM, MAP_ENGINE_LEAFLET),
    [MAP_ENGINE_MAPLIBRE]: clampMapZoomForEngine(DEFAULT_MAPLIBRE_ZOOM, MAP_ENGINE_MAPLIBRE),
};

const parseFiniteZoom = (value) => {
    const parsedZoom = Number(value);
    return Number.isFinite(parsedZoom) ? parsedZoom : null;
};

const normalizeMapZoomByEngine = (mapZoomByEngine) => {
    const candidateMapZoomByEngine = (mapZoomByEngine && typeof mapZoomByEngine === 'object') ? mapZoomByEngine : {};
    const leafletZoom = parseFiniteZoom(candidateMapZoomByEngine[MAP_ENGINE_LEAFLET]);
    const mapLibreZoom = parseFiniteZoom(candidateMapZoomByEngine[MAP_ENGINE_MAPLIBRE]);
    return {
        [MAP_ENGINE_LEAFLET]: clampMapZoomForEngine(
            leafletZoom ?? defaultMapZoomByEngine[MAP_ENGINE_LEAFLET],
            MAP_ENGINE_LEAFLET
        ),
        [MAP_ENGINE_MAPLIBRE]: clampMapZoomForEngine(
            mapLibreZoom ?? defaultMapZoomByEngine[MAP_ENGINE_MAPLIBRE],
            MAP_ENGINE_MAPLIBRE
        ),
    };
};

const hasCustomZoomState = (mapZoomByEngine) => (
    parseFiniteZoom(mapZoomByEngine?.[MAP_ENGINE_LEAFLET]) !== defaultMapZoomByEngine[MAP_ENGINE_LEAFLET]
    || parseFiniteZoom(mapZoomByEngine?.[MAP_ENGINE_MAPLIBRE]) !== defaultMapZoomByEngine[MAP_ENGINE_MAPLIBRE]
);

const resolveCompatibleTileLayerId = (tileLayerID, mapEngine) => {
    const normalizedMapEngine = normalizeMapEngine(mapEngine);
    const normalizedTileLayerID = String(tileLayerID || 'satellite');
    if (normalizedMapEngine === MAP_ENGINE_MAPLIBRE && MAPLIBRE_UNSUPPORTED_TILE_LAYER_IDS.has(normalizedTileLayerID)) {
        return 'satellite';
    }
    return normalizedTileLayerID;
};


export const getEarthViewMapSettings = createAsyncThunk(
    'earthViewGroups/getEarthViewMapSettings',
    async ({socket}, {rejectWithValue}) => {
        return new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: 'get-map-settings',
  data: 'earth-view-map-settings'
}, response => {
  if (response.success) {
    resolve(response.data['value']);
  } else {
    reject(rejectWithValue("Failed getting the earth view map settings from backend"));
  }
});
        });
    }
);


export const setEarthViewMapSetting = createAsyncThunk(
    'earthViewGroups/setEarthViewMapSetting',
    async ({socket, key}, {getState, rejectWithValue}) => {
        const state = getState();
        const mapEngine = normalizeMapEngine(state['earthViewTrack']['mapEngine']);
        const mapZoomByEngine = normalizeMapZoomByEngine(state['earthViewTrack']['mapZoomByEngine']);
        const mapSettings = {
            enableMapDragging: state['earthViewTrack']['enableMapDragging'],
            enableMapZooming: state['earthViewTrack']['enableMapZooming'],
            showPastOrbitPath: state['earthViewTrack']['showPastOrbitPath'],
            showFutureOrbitPath: state['earthViewTrack']['showFutureOrbitPath'],
            showSatelliteCoverage: state['earthViewTrack']['showSatelliteCoverage'],
            showSunIcon: state['earthViewTrack']['showSunIcon'],
            showMoonIcon: state['earthViewTrack']['showMoonIcon'],
            showTerminatorLine: state['earthViewTrack']['showTerminatorLine'],
            showTooltip: state['earthViewTrack']['showTooltip'],
            showGrid: state['earthViewTrack']['showGrid'],
            pastOrbitLineColor: state['earthViewTrack']['pastOrbitLineColor'],
            futureOrbitLineColor: state['earthViewTrack']['futureOrbitLineColor'],
            satelliteCoverageColor: state['earthViewTrack']['satelliteCoverageColor'],
            orbitProjectionDuration: state['earthViewTrack']['orbitProjectionDuration'],
            tileLayerID: state['earthViewTrack']['tileLayerID'],
            mapEngine,
            mapZoomByEngine,
        };

        return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'set-map-settings',
  data: {
    name: key,
    value: mapSettings
  }
}, response => {
  if (response.success) {
    resolve(response.data);
  } else {
    reject(rejectWithValue('Failed to set the mapping settings in the backend'));
  }
});
        });
    }
);


export const fetchSatelliteData = createAsyncThunk(
    'earthViewGroups/fetchSatelliteData',
    async ({ socket, noradId }, { rejectWithValue }) => {
        return await new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: 'get-satellite',
  data: noradId
}, response => {
  if (response.success) {
    resolve(response.data);
  } else {
    reject(new Error('Failed to fetch satellites'));
  }
});
        });
    }
);


export const fetchSatelliteGroups = createAsyncThunk(
    'earthViewGroups/fetchSatelliteGroupsEarthView',
    async ({ socket }, { rejectWithValue }) => {
        return new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: 'get-satellite-groups',
  data: null
}, response => {
  if (response.success) {
    resolve(response.data);
  } else {
    reject(rejectWithValue('Failed to get satellite groups'));
  }
});
        });
    }
);


export const fetchSatellitesByGroupId = createAsyncThunk(
    'earthViewGroups/fetchSatellitesByGroupIdEarthView',
    async ({ socket, satGroupId }, { rejectWithValue }) => {
        if (typeof satGroupId !== 'string' || satGroupId.trim() === '' || satGroupId === 'none') {
            return rejectWithValue(`Invalid group id for earth view satellites fetch: ${String(satGroupId)}`);
        }
        return new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: 'get-satellites-for-group-id',
  data: satGroupId
}, response => {
  if (response.success) {
    resolve(response.data);
  } else {
    reject(rejectWithValue(`Failed to set satellites for group id: ${satGroupId}`));
  }
});
        });
    }
);


export const fetchNextPassesForGroup = createAsyncThunk(
    'earthViewPasses/fetchNextPassesForGroup',
    async ({ socket, selectedSatGroupId, hours, forceRecalculate = false }, { getState, rejectWithValue }) => {
        return new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: 'fetch-next-passes-for-group',
  data: {
    group_id: selectedSatGroupId,
    hours: hours,
    force_recalculate: forceRecalculate
  }
}, response => {
  if (response.success) {
    resolve({
      passes: response.data,
      cached: response.cached,
      forecast_hours: response.forecast_hours,
      pass_range_start: response.pass_range_start,
      pass_range_end: response.pass_range_end,
      groupId: selectedSatGroupId
    });
  } else {
    reject(rejectWithValue('Failed getting next passes'));
  }
});
        });
    }
);


const earthViewSlice = createSlice({
    name: 'earthViewTrack',
    initialState: {
        selectedSatelliteId: "",
        satelliteData: {
            position: {
                lat: 0,
                lon: 0,
                alt: 0,
                vel: 0,
                az: 0,
                el: 0,
            },
            details: {
                name: '',
                norad_id: '',
                name_other: '',
                alternative_name: '',
                operator: '',
                countries: '',
                tle1: "",
                tle2: "",
                launched: null,
                deployed: null,
                decayed: null,
                updated: null,
                status: '',
                website: '',
                is_geostationary: false,
            },
            transmitters: [],
        },
        showPastOrbitPath: true,
        showFutureOrbitPath: true,
        enableMapDragging: false,
        enableMapZooming: false,
        showSatelliteCoverage: true,
        showSunIcon: true,
        showMoonIcon: true,
        showTerminatorLine: true,
        showTooltip: false,
        showGrid: true,
        gridEditable: false,
        loadingSatellites: true,
        selectedSatellites: [],
        selectedSatellitePositions: {},
        currentPastSatellitesPaths: [],
        currentFutureSatellitesPaths: [],
        currentSatellitesPosition: [],
        currentSatellitesCoverage: [],
        terminatorLine: [],
        daySidePolygon: [],
        pastOrbitLineColor: '#33c833',
        futureOrbitLineColor: '#e4971e',
        satelliteCoverageColor: '#FFFFFF',
        orbitProjectionDuration: 240,
        tileLayerID: 'satellite',
        mapEngine: MAP_ENGINE_MAPLIBRE,
        mapZoomByEngine: {...defaultMapZoomByEngine},
        satelliteGroupId: null,
        satGroups: [],
        formGroupSelectError: false,
        selectedSatGroupId: "",
        passes: [],
        passesAreCached: false,
        passesLoading: false,
        passesRangeStart: null,
        passesRangeEnd: null,
        passesCachedGroupId: null, // Track which group the cached passes belong to
        openMapSettingsDialog: false,
        openPassesTableSettingsDialog: false,
        openSatellitesTableSettingsDialog: false,
        nextPassesHours: 4.0,
        satellitesTableColumnVisibility: {
            name: true,
            alternative_name: false,
            norad_id: true,
            elevation: true,
            visibility: true,
            status: true,
            transmitters: true,
            countries: false,
            decayed: false,
            updated: true,
            launched: false,
            active_tx_count: false,
        },
        passesTableColumnVisibility: {
            status: true,
            name: true,
            alternative_name: false,
            name_other: false,
            peak_altitude: true,
            elevation: true,
            progress: true,
            duration: true,
            transmitter_links: true,
            event_start: true,
            event_end: true,
            distance_at_start: false,
            distance_at_end: false,
            distance_at_peak: false,
            is_geostationary: false,
            is_geosynchronous: false,
        },
        recentSatelliteGroups: [],
        showGeostationarySatellites: true, // Default on - show geostationary satellites
        passesTablePageSize: 5, // Default page size for passes table
        satellitesTablePageSize: 50, // Default page size for satellites table
        passesTableSortModel: [{field: 'status', sort: 'asc'}, {field: 'event_start', sort: 'asc'}], // Default sort for passes table
        satellitesTableSortModel: [{field: 'visibility', sort: 'desc'}, {field: 'elevation', sort: 'desc'}, {field: 'status', sort: 'asc'}, {field: 'name', sort: 'asc'}], // Default sort for satellites table
    },
    reducers: {
        setShowGeostationarySatellites(state, action) {
            state.showGeostationarySatellites = action.payload;
        },
        updatePassesWithElevationCurves(state, action) {
            // Update passes with calculated elevation curves
            state.passes = action.payload;
        },
        setPassesTablePageSize(state, action) {
            state.passesTablePageSize = action.payload;
        },
        setSatellitesTablePageSize(state, action) {
            state.satellitesTablePageSize = action.payload;
        },
        setPassesTableSortModel(state, action) {
            state.passesTableSortModel = action.payload;
        },
        setSatellitesTableSortModel(state, action) {
            state.satellitesTableSortModel = action.payload;
        },
        setShowPastOrbitPath(state, action) {
            state.showPastOrbitPath = action.payload;
        },
        setShowFutureOrbitPath(state, action) {
            state.showFutureOrbitPath = action.payload;
        },
        setEnableMapDragging(state, action) {
            state.enableMapDragging = action.payload;
        },
        setEnableMapZooming(state, action) {
            state.enableMapZooming = action.payload;
        },
        setShowSatelliteCoverage(state, action) {
            state.showSatelliteCoverage = action.payload;
        },
        setShowSunIcon(state, action) {
            state.showSunIcon = action.payload;
        },
        setShowMoonIcon(state, action) {
            state.showMoonIcon = action.payload;
        },
        setShowTerminatorLine(state, action) {
            state.showTerminatorLine = action.payload;
        },
        setShowTooltip(state, action) {
            state.showTooltip = action.payload;
        },
        setGridEditable(state, action) {
            state.gridEditable = action.payload;
        },
        setSelectedSatellites(state, action) {
            state.selectedSatellites = action.payload;
        },
        setTerminatorLine(state, action) {
            state.terminatorLine = action.payload;
        },
        setDaySidePolygon(state, action) {
            state.daySidePolygon = action.payload;
        },
        setPastOrbitLineColor(state, action) {
            state.pastOrbitLineColor = action.payload;
        },
        setFutureOrbitLineColor(state, action) {
            state.futureOrbitLineColor = action.payload;
        },
        setSatelliteCoverageColor(state, action) {
            state.satelliteCoverageColor = action.payload;
        },
        setOrbitProjectionDuration(state, action) {
            state.orbitProjectionDuration = action.payload;
        },
        setMapEngine(state, action) {
            const nextMapEngine = normalizeMapEngine(action.payload);
            state.mapEngine = nextMapEngine;
            state.mapZoomByEngine = normalizeMapZoomByEngine(state.mapZoomByEngine);
            state.tileLayerID = resolveCompatibleTileLayerId(state.tileLayerID, state.mapEngine);
        },
        setTileLayerID(state, action) {
            state.tileLayerID = resolveCompatibleTileLayerId(action.payload, state.mapEngine);
        },
        setMapZoomLevel(state, action) {
            const mapEngine = normalizeMapEngine(state.mapEngine);
            const mapZoomByEngine = normalizeMapZoomByEngine(state.mapZoomByEngine);
            const clampedZoom = clampMapZoomForEngine(action.payload, mapEngine);
            mapZoomByEngine[mapEngine] = clampedZoom;
            state.mapZoomByEngine = mapZoomByEngine;
        },
        setSatelliteGroupId(state, action) {
            state.satelliteGroupId = action.payload;
        },
        setSatGroups(state, action) {
            state.satGroups = action.payload;
        },
        setFormGroupSelectError(state, action) {
            state.formGroupSelectError = action.payload;
        },
        setSelectedSatGroupId(state, action) {
            if (state.selectedSatGroupId !== action.payload) {
                // Clear group-scoped transient data immediately to avoid showing stale satellites/passes
                state.selectedSatellites = [];
                state.selectedSatellitePositions = {};
                state.selectedSatelliteId = "";
                state.passes = [];
                state.passesAreCached = false;
                state.passesRangeStart = null;
                state.passesRangeEnd = null;
                state.passesCachedGroupId = null;
            }
            state.selectedSatGroupId = action.payload;
        },
        setPasses(state, action) {
            state.passes = action.payload;
            if (!action.payload || action.payload.length === 0) {
                state.passesAreCached = false;
                state.passesRangeStart = null;
                state.passesRangeEnd = null;
                state.passesCachedGroupId = null;
            }
        },
        setPassesLoading(state, action) {
            state.loading = action.payload;
        },
        setOpenMapSettingsDialog(state, action) {
            state.openMapSettingsDialog = action.payload;
        },
        setOpenPassesTableSettingsDialog(state, action) {
            state.openPassesTableSettingsDialog = action.payload;
        },
        setOpenSatellitesTableSettingsDialog(state, action) {
            state.openSatellitesTableSettingsDialog = action.payload;
        },
        setNextPassesHours(state, action) {
            state.nextPassesHours = action.payload;
        },
        setShowGrid(state, action) {
            state.showGrid = action.payload;
        },
        setSelectedSatelliteId(state, action) {
            state.selectedSatelliteId = action.payload;
        },
        setSatelliteData(state, action) {
            state.satelliteData = action.payload;
        },
        setSelectedSatellitePositions(state, action) {
            state.selectedSatellitePositions = action.payload;
        },
        setLoadingSatellites(state, action) {
            state.loadingSatellites = action.payload;
        },
        setSatellitesTableColumnVisibility(state, action) {
            state.satellitesTableColumnVisibility = action.payload;
        },
        setPassesTableColumnVisibility(state, action) {
            state.passesTableColumnVisibility = action.payload;
        },
        setRecentSatelliteGroups(state, action) {
            state.recentSatelliteGroups = action.payload;
        },
        addRecentSatelliteGroup(state, action) {
            const group = action.payload;
            // Remove if already exists (by name, not ID - groups can be recreated with new IDs)
            const filtered = state.recentSatelliteGroups.filter(g => g.name !== group.name);
            // Add to front
            const updated = [group, ...filtered];
            // Keep only first 20
            state.recentSatelliteGroups = updated.slice(0, 20);
        }
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchSatelliteGroups.pending, (state) => {
                state.formGroupSelectError = false;
            })
            .addCase(fetchSatelliteGroups.fulfilled, (state, action) => {
                state.satGroups = action.payload;
            })
            .addCase(fetchSatelliteGroups.rejected, (state, action) => {
                state.formGroupSelectError = true;
            })
            .addCase(fetchSatellitesByGroupId.pending, (state) => {
                state.formGroupSelectError = false;
                state.loadingSatellites = true;
            })
            .addCase(fetchSatellitesByGroupId.fulfilled, (state, action) => {
                state.selectedSatellites = action.payload;
                state.loadingSatellites = false;
            })
            .addCase(fetchSatellitesByGroupId.rejected, (state, action) => {
                state.formGroupSelectError = true;
                state.loadingSatellites = false;
            })
            .addCase(fetchNextPassesForGroup.pending, (state) => {
                state.passesLoading = true;
            })
            .addCase(fetchNextPassesForGroup.fulfilled, (state, action) => {
                const {passes, cached, forecast_hours, pass_range_start, pass_range_end, groupId} = action.payload;

                // Create a lookup of existing passes with their elevation curves
                const existingPassesMap = new Map();
                if (state.passes) {
                    state.passes.forEach(pass => {
                        // Use a combination of norad_id and event_start as unique key
                        const key = `${pass.norad_id}-${pass.event_start}`;
                        if (pass.elevation_curve && pass.elevation_curve.length > 0) {
                            existingPassesMap.set(key, pass.elevation_curve);
                        }
                    });
                }

                // Store passes, preserving existing elevation curves if available
                state.passes = passes.map(pass => {
                    const key = `${pass.norad_id}-${pass.event_start}`;
                    const existingCurve = existingPassesMap.get(key);

                    return {
                        ...pass,
                        // Use existing curve if available, otherwise empty array
                        elevation_curve: existingCurve || pass.elevation_curve || []
                    };
                });
                state.passesAreCached = cached;
                state.passesRangeStart = pass_range_start;
                state.passesRangeEnd = pass_range_end;
                state.passesCachedGroupId = groupId;
                state.passesLoading = false;
            })
            .addCase(fetchNextPassesForGroup.rejected, (state, action) => {
                state.passesLoading = false;
                state.formGroupSelectError = true;
            })
            .addCase(fetchSatelliteData.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchSatelliteData.fulfilled, (state, action) => {
                state.loading = false;
                state.satelliteData = action.payload;
                state.error = null;
            })
            .addCase(fetchSatelliteData.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })
            .addCase(setEarthViewMapSetting.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(setEarthViewMapSetting.fulfilled, (state, action) => {
                state.loading = false;
            })
            .addCase(setEarthViewMapSetting.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })
            .addCase(getEarthViewMapSettings.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(getEarthViewMapSettings.fulfilled, (state, action) => {
                state.loading = false;
                // Handle null/undefined payload for first-time users
                if (action.payload) {
                    const mapEngine = normalizeMapEngine(action.payload['mapEngine'] ?? state.mapEngine);
                    const currentMapZoomByEngine = normalizeMapZoomByEngine(state.mapZoomByEngine);
                    const payloadMapZoomByEngine = action.payload['mapZoomByEngine'];
                    let nextMapZoomByEngine = currentMapZoomByEngine;
                    const keepPersistedReduxZoom = hasCustomZoomState(currentMapZoomByEngine);

                    // Keep persisted Redux zoom whenever the user has already customized it.
                    // Backend zoom values can lag behind because map zoom is not auto-saved on every zoom event.
                    // For fresh/default local state, still accept explicit per-engine zoom values from backend.
                    if (!keepPersistedReduxZoom && payloadMapZoomByEngine && typeof payloadMapZoomByEngine === 'object') {
                        nextMapZoomByEngine = normalizeMapZoomByEngine(payloadMapZoomByEngine);
                    }

                    state.mapEngine = mapEngine;
                    state.mapZoomByEngine = nextMapZoomByEngine;
                    state.tileLayerID = resolveCompatibleTileLayerId(action.payload['tileLayerID'], mapEngine);
                    state.showPastOrbitPath = action.payload['showPastOrbitPath'];
                    state.showFutureOrbitPath = action.payload['showFutureOrbitPath'];
                    state.showSatelliteCoverage = action.payload['showSatelliteCoverage'];
                    state.showSunIcon = action.payload['showSunIcon'];
                    state.showMoonIcon = action.payload['showMoonIcon'];
                    state.showTerminatorLine = action.payload['showTerminatorLine'];
                    state.showTooltip = action.payload['showTooltip'];
                    state.showGrid = action.payload['showGrid'];
                    state.enableMapDragging = action.payload['enableMapDragging'] ?? false;
                    state.enableMapZooming = action.payload['enableMapZooming'] ?? false;
                    state.pastOrbitLineColor = action.payload['pastOrbitLineColor'];
                    state.futureOrbitLineColor = action.payload['futureOrbitLineColor'];
                    state.satelliteCoverageColor = action.payload['satelliteCoverageColor'];
                    state.orbitProjectionDuration = action.payload['orbitProjectionDuration'];
                }
            })
            .addCase(getEarthViewMapSettings.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            });
    }
});

export const {
    setShowGeostationarySatellites,
    updatePassesWithElevationCurves,
    setPassesTablePageSize,
    setSatellitesTablePageSize,
    setPassesTableSortModel,
    setSatellitesTableSortModel,
    setShowPastOrbitPath,
    setShowFutureOrbitPath,
    setEnableMapDragging,
    setEnableMapZooming,
    setShowSatelliteCoverage,
    setShowSunIcon,
    setShowMoonIcon,
    setShowTerminatorLine,
    setShowTooltip,
    setGridEditable,
    setSelectedSatellites,
    setPastOrbitLineColor,
    setFutureOrbitLineColor,
    setSatelliteCoverageColor,
    setOrbitProjectionDuration,
    setMapEngine,
    setTileLayerID,
    setMapZoomLevel,
    setSatelliteGroupId,
    setSatGroups,
    setFormGroupSelectError,
    setSelectedSatGroupId,
    setPasses,
    setPassesLoading,
    setOpenMapSettingsDialog,
    setOpenPassesTableSettingsDialog,
    setOpenSatellitesTableSettingsDialog,
    setNextPassesHours,
    setShowGrid,
    setSelectedSatelliteId,
    setSatelliteData,
    setSelectedSatellitePositions,
    setLoadingSatellites,
    setSatellitesTableColumnVisibility,
    setPassesTableColumnVisibility,
    setRecentSatelliteGroups,
    addRecentSatelliteGroup,
} = earthViewSlice.actions;

export default earthViewSlice.reducer;
