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
import {calculateElevationCurvesForPasses} from '../../utils/elevation-curve-calculator.js';
import {
    DEFAULT_TRACKER_ID,
    RIG_STATES,
    ROTATOR_STATES,
    resolveTrackerId,
    TRACKER_COMMAND_SCOPES,
    TRACKER_COMMAND_STATUS,
} from './tracking-constants.js';
import {
    deleteTrackerInstance,
    fetchTrackerInstances,
    setTrackerInstances,
} from './tracker-instances-slice.jsx';

const MAP_ENGINE_LEAFLET = 'leaflet';
const MAP_ENGINE_MAPLIBRE = 'maplibre';
const MAP_ENGINE_MAPLIBRE_GLOBE = 'maplibre-globe';
const MAP_ENGINE_PLANETARIUM = 'planetarium';
export const TARGET_VIEW_MODE_SOLAR_SYSTEM = 'solar-system';
export const TARGET_VIEW_MODE_PLANETARIUM = 'planetarium';
export const TARGET_VIEW_MODE_OPTIONS = [
    {id: TARGET_VIEW_MODE_SOLAR_SYSTEM, name: 'Solar System'},
    {id: TARGET_VIEW_MODE_PLANETARIUM, name: 'Planetarium'},
];
const LEAFLET_MIN_ZOOM = 0;
const MAPLIBRE_MIN_ZOOM = -6;
const MAP_MAX_ZOOM = 10;
const MAPLIBRE_TO_LEAFLET_ZOOM_OFFSET = 1;
const MAPLIBRE_UNSUPPORTED_TILE_LAYER_IDS = new Set([
    'nasa_blue_marble_4326',
    'nasa_osm_land_mask_4326',
    'nasa_osm_land_water_map_4326',
]);

const normalizeMapEngine = (mapEngine) => {
    const normalizedMapEngine = String(mapEngine || '').trim().toLowerCase();
    if (
        normalizedMapEngine === MAP_ENGINE_MAPLIBRE
        || normalizedMapEngine === MAP_ENGINE_MAPLIBRE_GLOBE
        || normalizedMapEngine === MAP_ENGINE_PLANETARIUM
    ) {
        return normalizedMapEngine;
    }
    return MAP_ENGINE_LEAFLET;
};

const isMapLibreEngine = (mapEngine) => {
    const normalizedMapEngine = normalizeMapEngine(mapEngine);
    return normalizedMapEngine === MAP_ENGINE_MAPLIBRE || normalizedMapEngine === MAP_ENGINE_MAPLIBRE_GLOBE;
};

const toZoomFamilyMapEngine = (mapEngine) => (
    // MapLibre 2D and globe share the same zoom domain, so only Leaflet needs conversion offset.
    isMapLibreEngine(mapEngine) ? MAP_ENGINE_MAPLIBRE : MAP_ENGINE_LEAFLET
);

const getMinZoomForEngine = (mapEngine) => (
    isMapLibreEngine(mapEngine) ? MAPLIBRE_MIN_ZOOM : LEAFLET_MIN_ZOOM
);

const clampMapZoomForEngine = (zoomLevel, mapEngine) => {
    const parsedZoom = Number(zoomLevel);
    const minZoom = getMinZoomForEngine(mapEngine);
    if (!Number.isFinite(parsedZoom)) {
        return minZoom;
    }
    return Math.min(MAP_MAX_ZOOM, Math.max(minZoom, parsedZoom));
};

const convertMapZoomForEngine = (zoomLevel, fromEngine, toEngine) => {
    const normalizedFrom = normalizeMapEngine(fromEngine);
    const normalizedTo = normalizeMapEngine(toEngine);
    const zoomFamilyFrom = toZoomFamilyMapEngine(normalizedFrom);
    const zoomFamilyTo = toZoomFamilyMapEngine(normalizedTo);
    if (zoomFamilyFrom === zoomFamilyTo) {
        return clampMapZoomForEngine(zoomLevel, normalizedTo);
    }

    const normalizedZoom = clampMapZoomForEngine(zoomLevel, normalizedFrom);
    if (zoomFamilyFrom === MAP_ENGINE_MAPLIBRE && zoomFamilyTo === MAP_ENGINE_LEAFLET) {
        return clampMapZoomForEngine(normalizedZoom + MAPLIBRE_TO_LEAFLET_ZOOM_OFFSET, normalizedTo);
    }
    if (zoomFamilyFrom === MAP_ENGINE_LEAFLET && zoomFamilyTo === MAP_ENGINE_MAPLIBRE) {
        return clampMapZoomForEngine(normalizedZoom - MAPLIBRE_TO_LEAFLET_ZOOM_OFFSET, normalizedTo);
    }
    return normalizedZoom;
};

const resolveCompatibleTileLayerId = (tileLayerID, mapEngine) => {
    const normalizedMapEngine = normalizeMapEngine(mapEngine);
    const normalizedTileLayerID = String(tileLayerID || 'satellite');
    if (isMapLibreEngine(normalizedMapEngine) && MAPLIBRE_UNSUPPORTED_TILE_LAYER_IDS.has(normalizedTileLayerID)) {
        return 'satellite';
    }
    return normalizedTileLayerID;
};

const normalizeTargetViewMode = (viewMode) => (
    viewMode === TARGET_VIEW_MODE_PLANETARIUM ? TARGET_VIEW_MODE_PLANETARIUM : TARGET_VIEW_MODE_SOLAR_SYSTEM
);

const normalizeSource = (source) => {
    if (typeof source !== 'string') {
        return 'manual';
    }
    const lowered = source.toLowerCase();
    if (lowered === 'manual' || lowered === 'satdump' || lowered === 'satnogs' || lowered === 'gr-satellites') {
        return lowered;
    }
    return 'manual';
};

const normalizeTransmitters = (transmitters = []) =>
    transmitters.map((tx) => ({
        ...tx,
        source: normalizeSource(tx.source),
    }));

const normalizeGroupOfSats = (sats = []) =>
    sats.map((sat) => {
        if (!Array.isArray(sat.transmitters)) {
            return sat;
        }
        return {
            ...sat,
            transmitters: normalizeTransmitters(sat.transmitters),
        };
    });

const normalizeCoveragePoints = (coverage = []) =>
    Array.isArray(coverage)
        ? coverage
            .map((point) => {
                if (Array.isArray(point) && point.length >= 2) {
                    return [point[0], point[1]];
                }
                if (point && typeof point === 'object') {
                    const lat = point.lat;
                    const lon = point.lon ?? point.lng;
                    if (lat != null && lon != null) {
                        return [lat, lon];
                    }
                }
                return null;
            })
            .filter(Boolean)
        : [];

const normalizeSatelliteData = (satelliteData = {}) => ({
    ...satelliteData,
    coverage: normalizeCoveragePoints(satelliteData.coverage),
    transmitters: normalizeTransmitters(satelliteData.transmitters || []),
});

const transmitterIdentity = (tx = {}) =>
    String(
        tx.id
        ?? `${tx.description ?? ''}:${tx.downlink_low ?? ''}:${tx.uplink_low ?? ''}:${tx.mode ?? ''}`
    );

const sameTransmitterSet = (left = [], right = []) => {
    if (left.length !== right.length) {
        return false;
    }
    const leftIds = left.map(transmitterIdentity).sort();
    const rightIds = right.map(transmitterIdentity).sort();
    for (let i = 0; i < leftIds.length; i += 1) {
        if (leftIds[i] !== rightIds[i]) {
            return false;
        }
    }
    return true;
};

const cloneDefaultSatelliteData = () => ({
    position: {
        lat: 0,
        lng: 0,
        alt: 0,
        vel: 0,
        az: 0,
        el: 0,
    },
    paths: {
        past: [],
        future: [],
    },
    coverage: [],
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
});

const cloneDefaultTrackingState = () => ({
    target_type: 'satellite',
    target_name: '',
    command: null,
    body_id: null,
    norad_id: '',
    rotator_state: ROTATOR_STATES.DISCONNECTED,
    rig_state: RIG_STATES.DISCONNECTED,
    group_id: '',
    rig_id: 'none',
    rotator_id: 'none',
    transmitter_id: 'none',
});

const cloneDefaultRotatorData = () => ({
    az: 0,
    el: 0,
    slewing: false,
    connected: false,
    tracking: false,
    minelevation: false,
    maxelevation: false,
    minazimuth: false,
    maxazimuth: false,
    outofbounds: false,
});

const cloneDefaultRigData = () => ({
    connected: false,
    doppler_shift: 0,
    frequency: 0,
    downlink_observed_freq: 0,
    tracking: false,
    transmitters: [],
});

const resolveFallbackTrackerSlotId = (state) => {
    const activeTrackerId = resolveTrackerId(state?.targetSatTrack?.trackerId, DEFAULT_TRACKER_ID);
    if (activeTrackerId) {
        return activeTrackerId;
    }

    const instances = Array.isArray(state?.trackerInstances?.instances)
        ? state.trackerInstances.instances
        : [];
    const trackerIds = instances
        .map((instance) => resolveTrackerId(instance?.tracker_id, DEFAULT_TRACKER_ID))
        .filter(Boolean);
    if (trackerIds.length > 0) {
        return trackerIds[0];
    }

    return 'target-1';
};

const createDefaultTrackerView = () => ({
    trackingState: cloneDefaultTrackingState(),
    satelliteData: cloneDefaultSatelliteData(),
    rotatorData: cloneDefaultRotatorData(),
    rigData: cloneDefaultRigData(),
    lastRotatorEvent: '',
    satGroups: [],
    groupOfSats: [],
    availableTransmitters: [],
    groupId: "",
    satelliteId: "",
    selectedRadioRig: "",
    selectedRotator: "",
    selectedTransmitter: "none",
    selectedRigVFO: "none",
    selectedVFO1: "uplink",
    selectedVFO2: "downlink",
});

const resetActiveTrackerState = (state) => {
    state.trackerId = DEFAULT_TRACKER_ID;
    state.trackerViews = {};
    state.groupId = "";
    state.satelliteId = "";
    state.groupOfSats = [];
    state.trackingState = cloneDefaultTrackingState();
    state.satelliteData = cloneDefaultSatelliteData();
    state.availableTransmitters = [];
    state.selectedRadioRig = "";
    state.selectedRotator = "";
    state.selectedTransmitter = "none";
    state.selectedRigVFO = "none";
    state.selectedVFO1 = "uplink";
    state.selectedVFO2 = "downlink";
    state.satellitePasses = [];
    state.activePass = {};
    state.passesLoading = false;
    state.passesError = null;
    state.cachedPasses = {};
    state.fleetPassSummaryByTrackerId = {};
    state.fleetPassSummaryComputedAtMs = 0;
    state.fleetPassSummaryLoading = false;
    state.fleetPassSummaryError = null;
    state.rotatorData = cloneDefaultRotatorData();
    state.lastRotatorEvent = "";
    state.rigData = cloneDefaultRigData();
};

const parseScopedSelectionPayload = (payload, fallbackTrackerId) => {
    if (payload && typeof payload === 'object' && !Array.isArray(payload) && Object.prototype.hasOwnProperty.call(payload, 'value')) {
        return {
            value: payload.value,
            trackerId: resolveTrackerId(payload.trackerId, fallbackTrackerId),
        };
    }
    return {
        value: payload,
        trackerId: resolveTrackerId(fallbackTrackerId, DEFAULT_TRACKER_ID),
    };
};

const deriveLastRotatorEvent = (rotatorData = {}, previousEvent = '') => {
    if (rotatorData['minelevation']) return 'EL-MIN';
    if (rotatorData['maxelevation']) return 'EL-MAX';
    if (rotatorData['minazimuth']) return 'AZ-MIN';
    if (rotatorData['maxazimuth']) return 'AZ-MAX';
    if (rotatorData['outofbounds']) return 'OOB';
    if (rotatorData['slewing']) return 'SLEW';
    if (rotatorData['tracking']) return 'TRK';
    if (rotatorData['stopped']) return 'STOP';
    return previousEvent || '';
};

const normalizeTargetType = (trackingState = {}) => {
    const explicitTargetType = String(trackingState?.target_type || '').trim().toLowerCase();
    if (explicitTargetType === 'satellite' || explicitTargetType === 'mission' || explicitTargetType === 'body') {
        return explicitTargetType;
    }
    if (String(trackingState?.command || '').trim()) {
        return 'mission';
    }
    if (String(trackingState?.body_id || '').trim()) {
        return 'body';
    }
    return 'satellite';
};

const resolveSatelliteIdFromTrackingState = (trackingState = {}) => (
    normalizeTargetType(trackingState) === 'satellite'
        ? (trackingState?.norad_id ?? '')
        : ''
);

const resolveGroupIdFromTrackingState = (trackingState = {}) => (
    normalizeTargetType(trackingState) === 'satellite'
        ? (trackingState?.group_id ?? '')
        : ''
);


export const sendNudgeCommand = createAsyncThunk(
    'targetSatTrack/sendNudgeCommand',
    async ({socket, cmd}, {getState, rejectWithValue}) => {
        const requestedTrackerId = resolveTrackerId(cmd?.tracker_id, DEFAULT_TRACKER_ID);
        const trackerId = requestedTrackerId || resolveTrackerId(getState()?.targetSatTrack?.trackerId, DEFAULT_TRACKER_ID);
        if (!trackerId) {
            return rejectWithValue('No active tracker selected');
        }
        const payload = {
            ...(cmd || {}),
            tracker_id: trackerId,
        };
        return new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: 'nudge-rotator',
  data: payload
}, response => {
  if (response.success) {
    resolve(response.data);
  } else {
    reject(rejectWithValue("Failed to send nudge command"));
  }
});
        });
    }
);


export const setTargetMapSetting = createAsyncThunk(
    'targetSatTrack/setTargetMapSetting',
    async ({socket, key, overrides = {}}, {getState, rejectWithValue}) => {
        const state = getState();
        const mapSettings = {
            lockOnTarget: state['targetSatTrack']['lockOnTarget'],
            enableMapDragging: state['targetSatTrack']['enableMapDragging'],
            enableMapZooming: state['targetSatTrack']['enableMapZooming'],
            autoSwitchPlanetariumByVisibility: state['targetSatTrack']['autoSwitchPlanetariumByVisibility'] ?? false,
            showPastOrbitPath: state['targetSatTrack']['showPastOrbitPath'],
            showFutureOrbitPath: state['targetSatTrack']['showFutureOrbitPath'],
            showSatelliteCoverage: state['targetSatTrack']['showSatelliteCoverage'],
            showSunIcon: state['targetSatTrack']['showSunIcon'],
            showMoonIcon: state['targetSatTrack']['showMoonIcon'],
            showTerminatorLine: state['targetSatTrack']['showTerminatorLine'],
            showTooltip: state['targetSatTrack']['showTooltip'],
            showGrid: state['targetSatTrack']['showGrid'],
            pastOrbitLineColor: state['targetSatTrack']['pastOrbitLineColor'],
            futureOrbitLineColor: state['targetSatTrack']['futureOrbitLineColor'],
            satelliteCoverageColor: state['targetSatTrack']['satelliteCoverageColor'],
            orbitProjectionDuration: state['targetSatTrack']['orbitProjectionDuration'],
            tileLayerID: state['targetSatTrack']['tileLayerID'],
            mapEngine: state['targetSatTrack']['mapEngine'],
            targetViewMode: normalizeTargetViewMode(state['targetSatTrack']['targetViewMode']),
            targetViewEnableDragging: state['targetSatTrack']['targetViewEnableDragging'] ?? true,
            targetViewEnableZooming: state['targetSatTrack']['targetViewEnableZooming'] ?? true,
            ...overrides,
        };
        mapSettings.targetViewMode = normalizeTargetViewMode(mapSettings.targetViewMode);
        mapSettings.targetViewEnableDragging = Boolean(mapSettings.targetViewEnableDragging);
        mapSettings.targetViewEnableZooming = Boolean(mapSettings.targetViewEnableZooming);

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


export const getTargetMapSettings = createAsyncThunk(
    'targetSatTrack/getTargetMapSettings',
    async ({socket}, {rejectWithValue}) => {
        return new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: 'get-map-settings',
  data: 'target-map-settings'
}, response => {
  if (response.success) {
    resolve(response.data['value']);
  } else {
    reject(rejectWithValue("Failed getting the target map settings from backend"));
  }
});
        });
    }
);


export const getTrackingStateFromBackend = createAsyncThunk(
    'targetSatTrack/getTrackingStateBackend',
    async ({socket, trackerId: requestedTrackerId}, {getState, rejectWithValue}) => {
        const trackerId = resolveTrackerId(
            requestedTrackerId,
            resolveTrackerId(getState()?.targetSatTrack?.trackerId, DEFAULT_TRACKER_ID)
        );
        if (!trackerId) {
            return null;
        }
        return new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: 'get-tracking-state',
  data: {
    tracker_id: trackerId
  }
}, response => {
  if (response.success) {
    resolve(response.data);
  } else {
    reject(rejectWithValue("Failed getting tracking state from backend"));
  }
});
        });
    }
);


export const setTrackingStateInBackend = createAsyncThunk(
    'targetSatTrack/setTrackingStateBackend',
    async ({socket, data}, {getState, dispatch, rejectWithValue}) => {
        const state = getState();
        const currentTrackingState = state?.targetSatTrack?.trackingState || {};
        const trackerId = resolveTrackerId(
            data?.tracker_id,
            resolveFallbackTrackerSlotId(state)
        );
        if (!trackerId) {
            return rejectWithValue({ message: 'tracker_id is required' });
        }
        const {
            norad_id,
            target_type,
            target_name,
            command,
            body_id,
            rotator_state,
            rig_state,
            group_id,
            rig_id,
            rotator_id,
            transmitter_id,
            rig_vfo,
            vfo1,
            vfo2,
        } = data;
        const resolvedTargetName = Object.prototype.hasOwnProperty.call(data || {}, 'target_name')
            ? target_name
            : currentTrackingState?.target_name;
        const trackState = {
            'name': 'satellite-tracking',
            'tracker_id': trackerId,
            'value': {
                'norad_id': norad_id,
                'target_type': target_type,
                'target_name': resolvedTargetName,
                'command': command,
                'body_id': body_id,
                'rotator_state': rotator_state,
                'rig_state': rig_state,
                'group_id': group_id,
                'rotator_id': rotator_id,
                'rig_id': rig_id,
                'transmitter_id': transmitter_id,
                'rig_vfo': rig_vfo,
                'vfo1': vfo1,
                'vfo2': vfo2,
            }
        };
        const changedKeys = Object.keys(trackState.value).filter(
            (key) => trackState.value[key] !== currentTrackingState[key]
        );
        const rotatorKeys = ['rotator_state', 'rotator_id'];
        const rigKeys = ['rig_state', 'rig_id', 'transmitter_id', 'rig_vfo', 'vfo1', 'vfo2'];
        const targetKeys = ['norad_id', 'group_id', 'target_type', 'target_name', 'command', 'body_id'];
        const hasRotatorChanges = changedKeys.some((key) => rotatorKeys.includes(key));
        const hasRigChanges = changedKeys.some((key) => rigKeys.includes(key));
        const hasTargetChanges = changedKeys.some((key) => targetKeys.includes(key));
        let commandScope = TRACKER_COMMAND_SCOPES.TRACKING;
        if (hasRotatorChanges && !hasRigChanges && !hasTargetChanges) {
            commandScope = TRACKER_COMMAND_SCOPES.ROTATOR;
        } else if (!hasRotatorChanges && hasRigChanges && !hasTargetChanges) {
            commandScope = TRACKER_COMMAND_SCOPES.RIG;
        } else if (!hasRotatorChanges && !hasRigChanges && hasTargetChanges) {
            commandScope = TRACKER_COMMAND_SCOPES.TARGET;
        }
        return new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: 'set-tracking-state',
  data: trackState
}, response => {
  if (response.success) {
    const trackingState = response?.data?.value || response?.data || data;
    const commandId = response?.data?.command_id || null;
    const resolvedScope = response?.data?.command_scope || commandScope;
    const resolvedTrackerId = resolveTrackerId(response?.data?.tracker_id, trackerId);
    const requestedState = {
      rotatorState: response?.data?.requested_state?.rotator_state ?? trackState.value.rotator_state,
      rigState: response?.data?.requested_state?.rig_state ?? trackState.value.rig_state
    };
    resolve({
      trackingState,
      commandId,
      commandScope: resolvedScope,
      requestedState,
      trackerId: resolvedTrackerId
    });
  } else {
    reject(rejectWithValue({
      ...(response || {}),
      message: response?.message || response?.error || 'Failed updating tracking state'
    }));
  }
});
        });
    }
);

export const swapTargetRotatorsInBackend = createAsyncThunk(
    'targetSatTrack/swapTargetRotatorsInBackend',
    async ({ socket, trackerAId, trackerBId }, { rejectWithValue }) => {
        const tracker_a_id = resolveTrackerId(trackerAId, '');
        const tracker_b_id = resolveTrackerId(trackerBId, '');
        if (!tracker_a_id || !tracker_b_id) {
            return rejectWithValue({ message: 'trackerAId and trackerBId are required' });
        }
        return new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: 'swap-target-rotators',
  data: {
    tracker_a_id,
    tracker_b_id
  }
}, response => {
  if (response?.success) {
    resolve(response?.data || {});
  } else {
    reject(rejectWithValue({
      ...(response || {}),
      message: response?.message || response?.error || 'Failed swapping rotators'
    }));
  }
});
        });
    }
);


export const fetchNextPasses = createAsyncThunk(
    'targetSatTrack/fetchNextPasses',
    async ({socket, noradId, hours, forceRecalculate = false}, {getState, rejectWithValue}) => {
        return new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: 'fetch-next-passes',
  data: {
    'norad_id': noradId,
    'hours': hours,
    'force_recalculate': forceRecalculate
  }
}, response => {
  if (response.success) {
    resolve(response.data);
  } else {
    reject(rejectWithValue("Failed getting next passes"));
  }
});
        });
    }
);

export const fetchFleetPassSummaries = createAsyncThunk(
    'targetSatTrack/fetchFleetPassSummaries',
    async ({ socket, trackers = [], hours = 24.0 }, { rejectWithValue }) => {
        const normalizedTrackers = Array.isArray(trackers)
            ? trackers
                .filter((tracker) => tracker && typeof tracker === 'object')
                .map((tracker) => ({
                    tracker_id: tracker.tracker_id,
                    target_type: tracker.target_type,
                    norad_id: tracker.norad_id,
                    command: tracker.command,
                    body_id: tracker.body_id,
                    min_elevation: tracker.min_elevation ?? 0,
                }))
            : [];

        return new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: 'fetch-next-pass-summary-for-trackers',
  data: {
    trackers: normalizedTrackers,
    hours
  }
}, response => {
  if (response?.success) {
    resolve(response?.data || {
      summaries: {},
      computed_at_ms: Date.now()
    });
  } else {
    reject(rejectWithValue(response?.message || "Failed getting fleet pass summaries"));
  }
});
        });
    }
);


export const fetchSatelliteGroups = createAsyncThunk(
    'targetSatTrack/fetchSatelliteGroups',
    async ({ socket }, { rejectWithValue }) => {
        return new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: 'get-satellite-groups',
  data: null
}, response => {
  if (response.success) {
    resolve(response.data);
  } else {
    reject(rejectWithValue(response.message));
  }
});
        });
    }
);


export const fetchSatellitesByGroupId = createAsyncThunk(
    'targetSatTrack/fetchSatellitesByGroupId',
    async ({ socket, groupId }, { rejectWithValue }) => {
        if (typeof groupId !== 'string' || groupId.trim() === '') {
            return rejectWithValue('Missing group id for target satellites fetch');
        }
        return new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'get-satellites-for-group-id',
  data: groupId
}, response => {
  if (response.success) {
    const satellites = response.data;
    resolve({
      satellites
    });
  } else {
    reject(rejectWithValue(response.message));
  }
});
        });
    }
);


export const fetchSatellite = createAsyncThunk(
    'satellites/fetchSatellite',
    async ({ socket, noradId }, { rejectWithValue }) => {
        try {
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
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);


const targetSatTrackSlice = createSlice({
    name: 'targetSatTrack',
    initialState: {
        rotatorConnecting: false,
        rotatorDisconnecting: false,
        trackerCommandsById: {},
        trackerId: DEFAULT_TRACKER_ID,
        trackerViews: {},
        groupId: "",
        satelliteId: "",
        satGroups: [],
        groupOfSats: [],
        trackingState: cloneDefaultTrackingState(),
        satelliteData: cloneDefaultSatelliteData(),
        satellitePasses: [],
        fleetPassSummaryByTrackerId: {},
        fleetPassSummaryComputedAtMs: 0,
        fleetPassSummaryLoading: false,
        fleetPassSummaryError: null,
        activePass: {},
        passesLoading: false,
        passesError: null,
        loading: false,
        error: null,
        lockOnTarget: true,
        enableMapDragging: false,
        enableMapZooming: false,
        showPastOrbitPath: true,
        showFutureOrbitPath: true,
        showSatelliteCoverage: true,
        showSunIcon: true,
        showMoonIcon: true,
        showTerminatorLine: true,
        showTooltip: true,
        showGrid: true,
        currentSatellitesPosition: [],
        currentSatellitesCoverage: [],
        terminatorLine: [],
        daySidePolygon: [],
        pastOrbitLineColor: '#33c833',
        futureOrbitLineColor: '#e4971e',
        satelliteCoverageColor: '#112eed',
        orbitProjectionDuration: 60*24,
        tileLayerID: 'satellite',
        mapEngine: MAP_ENGINE_MAPLIBRE,
        autoSwitchPlanetariumByVisibility: false,
        targetViewMode: TARGET_VIEW_MODE_SOLAR_SYSTEM,
        targetViewEnableDragging: true,
        targetViewEnableZooming: true,
        mapZoomLevel: 2,
        sunPos: null,
        moonPos: null,
        gridEditable: false,
        sliderTimeOffset: 0,
        satelliteSelectOpen: false,
        satelliteGroupSelectOpen: false,
        uiTrackerDisabled: false,
        starting: true,
        selectedRadioRig: "",
        selectedRotator: "",
        selectedRigVFO: "none",
        selectedVFO1: "uplink",
        selectedVFO2: "downlink",
        openMapSettingsDialog: false,
        openPassesTableSettingsDialog: false,
        passesTableColumnVisibility: {
            status: true,
            event_start: true,
            event_end: true,
            duration: true,
            progress: true,
            distance_at_start: false,
            distance_at_end: false,
            distance_at_peak: false,
            peak_altitude: true,
            is_geostationary: false,
            is_geosynchronous: false,
        },
        passesTablePageSize: 15,
        passesTableSortModel: [{ field: 'status', sort: 'asc' }, { field: 'event_start', sort: 'asc' }],
        nextPassesHours: 24.0,
        cachedPasses: {},
        selectedTransmitter: "none",
        availableTransmitters: [],
        transmitterSyncLock: {
            noradId: null,
            expiresAtMs: 0,
        },
        rotatorData: cloneDefaultRotatorData(),
        lastRotatorEvent: "",
        rigData: cloneDefaultRigData(),
        colorMaps: [
            'viridis',
            'plasma',
            'inferno',
            'magma',
            'jet',
            'websdr',
            'cosmic',
        ],
        colorMap: 'cosmic',
        dbRange: [-19, 0],
        fftSizeOptions: [256, 512, 1024, 2048, 4096],
        fftSize: 1024,
        gain: 20,
        sampleRate: 2048000,
        centerFrequency: 100000000,
        errorMessage: null,
        isStreaming: false,
        isPlaying: false,
        targetFPS: 30,
        settingsDialogOpen: false,
        autoDBRange: false,
    },
    reducers: {
        setLoading(state, action) {
            state.loading = action.payload;
        },
        setSatelliteData(state, action) {
            const incomingTrackerId = resolveTrackerId(action.payload?.tracker_id, DEFAULT_TRACKER_ID);
            const activeTrackerId = resolveTrackerId(state.trackerId, DEFAULT_TRACKER_ID);
            const isActiveTracker = incomingTrackerId === activeTrackerId;
            if (!incomingTrackerId) {
                return;
            }

            const trackerView = state.trackerViews[incomingTrackerId] || createDefaultTrackerView();

                if (action.payload['tracking_state']) {
                    trackerView.trackingState = action.payload['tracking_state'];
                    trackerView.satelliteId = resolveSatelliteIdFromTrackingState(action.payload['tracking_state']);
                    trackerView.groupId = resolveGroupIdFromTrackingState(action.payload['tracking_state']);
                    if (action.payload['tracking_state']?.rig_vfo != null) {
                        trackerView.selectedRigVFO = action.payload['tracking_state'].rig_vfo;
                    }
                    if (action.payload['tracking_state']?.vfo1 != null) {
                        trackerView.selectedVFO1 = action.payload['tracking_state'].vfo1;
                    }
                    if (action.payload['tracking_state']?.vfo2 != null) {
                        trackerView.selectedVFO2 = action.payload['tracking_state'].vfo2;
                    }
                }

            if (action.payload['satellite_data']) {
                const rawSatelliteData = action.payload['satellite_data'] || {};
                const normalizedSatelliteData = normalizeSatelliteData(rawSatelliteData);
                const hasDetails = Object.prototype.hasOwnProperty.call(rawSatelliteData, 'details') && rawSatelliteData.details != null;
                const hasPosition = Object.prototype.hasOwnProperty.call(rawSatelliteData, 'position');
                const hasPaths = Object.prototype.hasOwnProperty.call(rawSatelliteData, 'paths');
                const hasCoverage = Object.prototype.hasOwnProperty.call(rawSatelliteData, 'coverage');
                const hasTransmitters = Object.prototype.hasOwnProperty.call(rawSatelliteData, 'transmitters');
                const hasNextPass = Object.prototype.hasOwnProperty.call(rawSatelliteData, 'nextPass');

                if (hasDetails) {
                    trackerView.satelliteData.details = {
                        ...(trackerView.satelliteData.details || {}),
                        ...(normalizedSatelliteData.details || {}),
                    };
                }
                if (hasPosition) {
                    trackerView.satelliteData.position = normalizedSatelliteData.position;
                }
                if (hasPaths) {
                    trackerView.satelliteData.paths = normalizedSatelliteData.paths;
                }
                if (hasCoverage) {
                    trackerView.satelliteData.coverage = normalizedSatelliteData.coverage;
                }
                if (hasTransmitters) {
                    trackerView.satelliteData.transmitters = normalizedSatelliteData.transmitters;
                }
                if (hasNextPass) {
                    trackerView.satelliteData.nextPass = rawSatelliteData.nextPass;
                }
                if (!action.payload['tracking_state'] && hasDetails) {
                    const detailTargetType = normalizeTargetType({
                        target_type: normalizedSatelliteData?.details?.target_type,
                        command: normalizedSatelliteData?.details?.command,
                        body_id: normalizedSatelliteData?.details?.body_id,
                        norad_id: normalizedSatelliteData?.details?.norad_id,
                    });
                    trackerView.satelliteId = detailTargetType === 'satellite'
                        ? (normalizedSatelliteData?.details?.norad_id ?? '')
                        : '';
                }
            }

            if (action.payload['rotator_data']) {
                trackerView.rotatorData = action.payload['rotator_data'];
                trackerView.lastRotatorEvent = deriveLastRotatorEvent(
                    action.payload['rotator_data'],
                    trackerView.lastRotatorEvent
                );
            }

            if (action.payload['rig_data']) {
                trackerView.rigData = action.payload['rig_data'];
                if (Array.isArray(trackerView.rigData?.transmitters)) {
                    trackerView.rigData.transmitters = normalizeTransmitters(trackerView.rigData.transmitters);
                }
            }

            state.trackerViews[incomingTrackerId] = trackerView;

            if (!isActiveTracker) {
                return;
            }
            if (action.payload['tracking_state']) {
                state.trackingState = action.payload['tracking_state'];
                // Keep selected target in sync with backend tracking updates so
                // consumers (e.g. earth view map crosshair) follow target changes immediately.
                state.satelliteId = resolveSatelliteIdFromTrackingState(action.payload['tracking_state']);
                state.groupId = resolveGroupIdFromTrackingState(action.payload['tracking_state']);
                if (normalizeTargetType(action.payload['tracking_state']) !== 'satellite') {
                    state.availableTransmitters = [];
                    state.selectedTransmitter = 'none';
                }
            }

            if (action.payload['satellite_data']) {
                const rawSatelliteData = action.payload['satellite_data'] || {};
                const normalizedSatelliteData = normalizeSatelliteData(rawSatelliteData);
                const hasDetails = Object.prototype.hasOwnProperty.call(rawSatelliteData, 'details') && rawSatelliteData.details != null;
                const hasPosition = Object.prototype.hasOwnProperty.call(rawSatelliteData, 'position');
                const hasPaths = Object.prototype.hasOwnProperty.call(rawSatelliteData, 'paths');
                const hasCoverage = Object.prototype.hasOwnProperty.call(rawSatelliteData, 'coverage');
                const hasTransmitters = Object.prototype.hasOwnProperty.call(rawSatelliteData, 'transmitters');
                const hasNextPass = Object.prototype.hasOwnProperty.call(rawSatelliteData, 'nextPass');

                if (hasDetails) {
                    state.satelliteData.details = {
                        ...(state.satelliteData.details || {}),
                        ...(normalizedSatelliteData.details || {}),
                    };
                }
                if (hasPosition) {
                    state.satelliteData.position = normalizedSatelliteData.position;
                }
                if (hasPaths) {
                    state.satelliteData.paths = normalizedSatelliteData.paths;
                }
                if (hasCoverage) {
                    state.satelliteData.coverage = normalizedSatelliteData.coverage;
                }

                if (hasTransmitters) {
                    const incomingTransmitters = normalizedSatelliteData.transmitters;
                    const incomingNoradId = hasDetails
                        ? normalizedSatelliteData?.details?.norad_id
                        : state.satelliteData?.details?.norad_id;
                    const lockMatchesSatellite = (
                        state.transmitterSyncLock?.noradId != null
                        && String(state.transmitterSyncLock.noradId) === String(incomingNoradId)
                    );
                    const lockActive = lockMatchesSatellite
                        && Number(state.transmitterSyncLock.expiresAtMs || 0) > Date.now();

                    if (!lockActive) {
                        state.satelliteData.transmitters = incomingTransmitters;
                        if (lockMatchesSatellite) {
                            state.transmitterSyncLock = { noradId: null, expiresAtMs: 0 };
                        }
                    } else if (
                        sameTransmitterSet(incomingTransmitters, state.satelliteData.transmitters || [])
                    ) {
                        // Backend caught up with the latest manual edits; unlock and accept updates.
                        state.satelliteData.transmitters = incomingTransmitters;
                        state.transmitterSyncLock = { noradId: null, expiresAtMs: 0 };
                    }
                }

                if (hasNextPass) {
                    state.satelliteData.nextPass = rawSatelliteData.nextPass;
                }

                // Fallback sync in case backend message omits tracking_state.
                if (!action.payload['tracking_state'] && hasDetails) {
                    const detailTargetType = normalizeTargetType({
                        target_type: normalizedSatelliteData?.details?.target_type,
                        command: normalizedSatelliteData?.details?.command,
                        body_id: normalizedSatelliteData?.details?.body_id,
                        norad_id: normalizedSatelliteData?.details?.norad_id,
                    });
                    state.satelliteId = detailTargetType === 'satellite'
                        ? (normalizedSatelliteData?.details?.norad_id ?? '')
                        : '';
                    if (detailTargetType !== 'satellite') {
                        state.availableTransmitters = [];
                        state.selectedTransmitter = 'none';
                    }
                }
            }

            // Detect state change for the rotator and do stuff there
            if (action.payload['rotator_data']) {
                // Update the whole rotatorData object
                state.rotatorData = action.payload['rotator_data'];

                if (state.rotatorData['connected'] === true) {
                    if (action.payload['rotator_data']['connected'] === false) {
                        state.rotatorDisconnecting = false;
                    }

                } else if (state.rotatorData['connected'] === false) {
                    if (action.payload['rotator_data']['connected'] === true) {
                        state.rotatorConnecting = false;
                    }
                }

                // In case of error connecting or disconnecting, reset ui flags
                if (state.rotatorData['error']) {
                    state.rotatorConnecting = false;
                    state.rotatorDisconnecting = false;
                }

                state.lastRotatorEvent = trackerView.lastRotatorEvent;
            }

            // Update the whole rig_data object
            if (action.payload['rig_data']) {
                state.rigData = action.payload['rig_data'];
                if (Array.isArray(state.rigData?.transmitters)) {
                    state.rigData.transmitters = normalizeTransmitters(state.rigData.transmitters);
                }
            }
        },
        setUITrackerValues(state, action) {
            const incomingTrackerId = resolveTrackerId(action.payload?.tracker_id, DEFAULT_TRACKER_ID);
            const activeTrackerId = resolveTrackerId(state.trackerId, DEFAULT_TRACKER_ID);
            const isActiveTracker = incomingTrackerId === activeTrackerId;
            if (!incomingTrackerId) {
                return;
            }

            const trackerView = state.trackerViews[incomingTrackerId] || createDefaultTrackerView();
            trackerView.satGroups = action.payload['groups'];
            trackerView.groupOfSats = normalizeGroupOfSats(action.payload['satellites']);
            trackerView.availableTransmitters = normalizeTransmitters(action.payload['transmitters']);
            trackerView.satelliteId = action.payload['norad_id'] ?? '';
            trackerView.groupId = action.payload['group_id'] ?? '';
            trackerView.selectedRadioRig = action.payload['rig_id'];
            trackerView.selectedRotator = action.payload['rotator_id'];
            trackerView.selectedTransmitter = action.payload['transmitter_id'];
            trackerView.selectedRigVFO = action.payload['rig_vfo'] ?? trackerView.selectedRigVFO ?? 'none';
            trackerView.selectedVFO1 = action.payload['vfo1'] ?? trackerView.selectedVFO1 ?? 'uplink';
            trackerView.selectedVFO2 = action.payload['vfo2'] ?? trackerView.selectedVFO2 ?? 'downlink';
            state.trackerViews[incomingTrackerId] = trackerView;

            if (!isActiveTracker) {
                return;
            }
            state.satGroups = action.payload['groups'];
            state.groupOfSats = normalizeGroupOfSats(action.payload['satellites']);
            state.availableTransmitters = normalizeTransmitters(action.payload['transmitters']);
            state.satelliteId = action.payload['norad_id'] ?? '';
            state.groupId = action.payload['group_id'] ?? '';
            state.selectedRadioRig = action.payload['rig_id'];
            state.selectedRotator = action.payload['rotator_id'];
            state.selectedTransmitter = action.payload['transmitter_id'];
            state.selectedRigVFO = action.payload['rig_vfo'] ?? state.selectedRigVFO;
            state.selectedVFO1 = action.payload['vfo1'] ?? state.selectedVFO1;
            state.selectedVFO2 = action.payload['vfo2'] ?? state.selectedVFO2;
            // Don't sync selectedRigVFO from backend - it's session-specific
        },
        setSatellitePasses(state, action) {
            state.satellitePasses = action.payload;
        },
        updateSatellitePassesWithElevationCurves(state, action) {
            // Update satellite passes with calculated elevation curves
            state.satellitePasses = action.payload;
        },
        setSatGroupId(state, action) {
            state.groupId = action.payload;
        },
        setSatelliteId(state, action) {
            state.satelliteId = action.payload;
        },
        setLockOnTarget(state, action) {
            state.lockOnTarget = action.payload;
        },
        setEnableMapDragging(state, action) {
            state.enableMapDragging = action.payload;
        },
        setEnableMapZooming(state, action) {
            state.enableMapZooming = action.payload;
        },
        setAutoSwitchPlanetariumByVisibility(state, action) {
            state.autoSwitchPlanetariumByVisibility = Boolean(action.payload);
        },
        setShowPastOrbitPath(state, action) {
            state.showPastOrbitPath = action.payload;
        },
        setShowFutureOrbitPath(state, action) {
            state.showFutureOrbitPath = action.payload;
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
            state.mapZoomLevel = convertMapZoomForEngine(state.mapZoomLevel, state.mapEngine, nextMapEngine);
            state.mapEngine = nextMapEngine;
            state.tileLayerID = resolveCompatibleTileLayerId(state.tileLayerID, state.mapEngine);
        },
        setTileLayerID(state, action) {
            state.tileLayerID = resolveCompatibleTileLayerId(action.payload, state.mapEngine);
        },
        setTargetViewMode(state, action) {
            state.targetViewMode = normalizeTargetViewMode(action.payload);
        },
        setTargetViewEnableDragging(state, action) {
            state.targetViewEnableDragging = Boolean(action.payload);
        },
        setTargetViewEnableZooming(state, action) {
            state.targetViewEnableZooming = Boolean(action.payload);
        },
        setMapZoomLevel(state, action) {
            state.mapZoomLevel = clampMapZoomForEngine(action.payload, state.mapEngine);
        },
        setSunPos(state, action) {
            state.sunPos = action.payload;
        },
        setMoonPos(state, action) {
            state.moonPos = action.payload;
        },
        setGridEditable(state, action) {
            state.gridEditable = action.payload;
        },
        setSliderTimeOffset(state, action) {
            state.sliderTimeOffset = action.payload;
        },
        setLocation(state, action) {
            state.location = action.payload;
        },
        setSatelliteSelectOpen(state, action) {
            state.satelliteSelectOpen = action.payload;
        },
        setSatelliteGroupSelectOpen(state, action) {
            state.satelliteGroupSelectOpen = action.payload;
        },
        setGroupOfSats(state, action) {
            state.groupOfSats = normalizeGroupOfSats(action.payload);
        },
        setUITrackerDisabled(state, action) {
            state.uiTrackerDisabled = action.payload;
        },
        setStarting(state, action) {
            state.c = action.payload;
        },
        setRadioRig(state, action) {
            const parsed = parseScopedSelectionPayload(action.payload, state.trackerId);
            state.selectedRadioRig = parsed.value;
            if (!parsed.trackerId) {
                return;
            }
            const trackerView = state.trackerViews[parsed.trackerId] || createDefaultTrackerView();
            trackerView.selectedRadioRig = parsed.value;
            state.trackerViews[parsed.trackerId] = trackerView;
        },
        setRotator(state, action) {
            const parsed = parseScopedSelectionPayload(action.payload, state.trackerId);
            state.selectedRotator = parsed.value;
            if (!parsed.trackerId) {
                return;
            }
            const trackerView = state.trackerViews[parsed.trackerId] || createDefaultTrackerView();
            trackerView.selectedRotator = parsed.value;
            state.trackerViews[parsed.trackerId] = trackerView;
        },
        setTrackerId(state, action) {
            const nextTrackerId = resolveTrackerId(action.payload, DEFAULT_TRACKER_ID);
            state.trackerId = nextTrackerId;
            const trackerView = state.trackerViews?.[nextTrackerId];
            if (!trackerView) {
                return;
            }
            if (trackerView.trackingState) state.trackingState = trackerView.trackingState;
            if (trackerView.satelliteData) state.satelliteData = trackerView.satelliteData;
            if (trackerView.rotatorData) state.rotatorData = trackerView.rotatorData;
            if (trackerView.rigData) state.rigData = trackerView.rigData;
            if (trackerView.lastRotatorEvent != null) state.lastRotatorEvent = trackerView.lastRotatorEvent;
            if (trackerView.satGroups) state.satGroups = trackerView.satGroups;
            if (trackerView.groupOfSats) state.groupOfSats = trackerView.groupOfSats;
            if (trackerView.availableTransmitters) {
                state.availableTransmitters = trackerView.availableTransmitters;
            }
            if (trackerView.satelliteId != null) state.satelliteId = trackerView.satelliteId;
            if (trackerView.groupId != null) state.groupId = trackerView.groupId;
            if (trackerView.selectedRadioRig != null) {
                state.selectedRadioRig = trackerView.selectedRadioRig;
            }
            if (trackerView.selectedRotator != null) {
                state.selectedRotator = trackerView.selectedRotator;
            }
            if (trackerView.selectedTransmitter != null) {
                state.selectedTransmitter = trackerView.selectedTransmitter;
            }
            if (trackerView.selectedRigVFO != null) {
                state.selectedRigVFO = trackerView.selectedRigVFO;
            }
            if (trackerView.selectedVFO1 != null) {
                state.selectedVFO1 = trackerView.selectedVFO1;
            }
            if (trackerView.selectedVFO2 != null) {
                state.selectedVFO2 = trackerView.selectedVFO2;
            }
        },
        setRigVFO(state, action) {
            const parsed = parseScopedSelectionPayload(action.payload, state.trackerId);
            state.selectedRigVFO = parsed.value;
            if (!parsed.trackerId) {
                return;
            }
            const trackerView = state.trackerViews[parsed.trackerId] || createDefaultTrackerView();
            trackerView.selectedRigVFO = parsed.value;
            state.trackerViews[parsed.trackerId] = trackerView;
        },
        setVFO1(state, action) {
            const parsed = parseScopedSelectionPayload(action.payload, state.trackerId);
            state.selectedVFO1 = parsed.value;
            if (!parsed.trackerId) {
                return;
            }
            const trackerView = state.trackerViews[parsed.trackerId] || createDefaultTrackerView();
            trackerView.selectedVFO1 = parsed.value;
            state.trackerViews[parsed.trackerId] = trackerView;
        },
        setVFO2(state, action) {
            const parsed = parseScopedSelectionPayload(action.payload, state.trackerId);
            state.selectedVFO2 = parsed.value;
            if (!parsed.trackerId) {
                return;
            }
            const trackerView = state.trackerViews[parsed.trackerId] || createDefaultTrackerView();
            trackerView.selectedVFO2 = parsed.value;
            state.trackerViews[parsed.trackerId] = trackerView;
        },
        setOpenMapSettingsDialog(state, action) {
            state.openMapSettingsDialog = action.payload;
        },
        setOpenPassesTableSettingsDialog(state, action) {
            state.openPassesTableSettingsDialog = action.payload;
        },
        setPassesTableColumnVisibility(state, action) {
            state.passesTableColumnVisibility = action.payload;
        },
        setPassesTablePageSize(state, action) {
            state.passesTablePageSize = action.payload;
        },
        setPassesTableSortModel(state, action) {
            state.passesTableSortModel = action.payload;
        },
        setNextPassesHours(state, action) {
            state.nextPassesHours = action.payload;
        },
        setSelectedTransmitter(state, action) {
            const parsed = parseScopedSelectionPayload(action.payload, state.trackerId);
            state.selectedTransmitter = parsed.value;
            if (!parsed.trackerId) {
                return;
            }
            const trackerView = state.trackerViews[parsed.trackerId] || createDefaultTrackerView();
            trackerView.selectedTransmitter = parsed.value;
            state.trackerViews[parsed.trackerId] = trackerView;
        },
        setAvailableTransmitters(state, action) {
            state.availableTransmitters = normalizeTransmitters(action.payload);
        },
        setTargetTransmitters(state, action) {
            const noradId = action.payload?.noradId;
            const transmitters = normalizeTransmitters(action.payload?.transmitters || []);
            const lockDurationMs = Number(action.payload?.lockDurationMs ?? 5000);
            const updatedAtMs = Number(action.payload?.updatedAtMs ?? Date.now());
            if (
                state.satelliteData?.details?.norad_id != null
                && String(state.satelliteData.details.norad_id) === String(noradId)
            ) {
                state.satelliteData.transmitters = transmitters;
            }
            if (state.satelliteId != null && String(state.satelliteId) === String(noradId)) {
                state.availableTransmitters = transmitters;
            }
            state.transmitterSyncLock = {
                noradId: noradId ?? null,
                expiresAtMs: updatedAtMs + Math.max(lockDurationMs, 0),
            };
        },
        setShowGrid(state, action) {
            state.showGrid = action.payload;
        },
        setRotatorData(state, action) {
            state.rotatorData = action.payload;
        },
        setColorMap: (state, action) => {
            state.colorMap = action.payload;
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
        setErrorMessage: (state, action) => {
            state.errorMessage = action.payload;
        },
        setIsStreaming: (state, action) => {
            state.isStreaming = action.payload;
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
        setLastRotatorEvent: (state, action) => {
            state.lastRotatorEvent = action.payload;
        },
        setActivePass: (state, action) => {
            state.activePass = action.payload;
        },
        setRotatorConnecting: (state, action) => {
            state.rotatorConnecting = action.payload;
        },
        setRotatorDisconnecting: (state, action) => {
            state.rotatorDisconnecting = action.payload;
        },
        setTrackerCommandStatus: (state, action) => {
            const status = action.payload || {};
            const incomingTrackerId = resolveTrackerId(status.tracker_id, DEFAULT_TRACKER_ID);
            const statusValue = status.status;
            if (!status.command_id || !statusValue) {
                return;
            }
            const currentTrackerCommand = state.trackerCommandsById?.[incomingTrackerId] || null;

            if (statusValue === TRACKER_COMMAND_STATUS.SUBMITTED) {
                const submittedAt = Date.now();
                const submittedCommand = {
                    commandId: status.command_id,
                    scope: status.scope || TRACKER_COMMAND_SCOPES.TRACKING,
                    status: statusValue,
                    reason: null,
                    requestedState: {
                        rotatorState: status.requested_state?.rotator_state ?? currentTrackerCommand?.requestedState?.rotatorState ?? null,
                        rigState: status.requested_state?.rig_state ?? currentTrackerCommand?.requestedState?.rigState ?? null,
                    },
                    submittedAt,
                    startedAt: null,
                    finishedAt: null,
                    updatedAt: submittedAt,
                };
                state.trackerCommandsById[incomingTrackerId] = submittedCommand;
                return;
            }

            if (!currentTrackerCommand || currentTrackerCommand.commandId !== status.command_id) {
                return;
            }

            if (statusValue === TRACKER_COMMAND_STATUS.STARTED) {
                const startedAt = Date.now();
                const startedCommand = {
                    ...currentTrackerCommand,
                    status: TRACKER_COMMAND_STATUS.STARTED,
                    startedAt,
                    updatedAt: startedAt,
                };
                state.trackerCommandsById[incomingTrackerId] = startedCommand;
                return;
            }

            if (
                statusValue === TRACKER_COMMAND_STATUS.SUCCEEDED
                || statusValue === TRACKER_COMMAND_STATUS.FAILED
            ) {
                const finishedAt = Date.now();
                const finishedCommand = {
                    ...currentTrackerCommand,
                    status: statusValue,
                    reason: status.reason || null,
                    finishedAt,
                    updatedAt: finishedAt,
                };
                state.trackerCommandsById[incomingTrackerId] = finishedCommand;
                state.rotatorConnecting = false;
                state.rotatorDisconnecting = false;
                return;
            }
        }
    },
    extraReducers: (builder) => {
        builder
            .addCase(setTrackingStateInBackend.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(setTrackingStateInBackend.fulfilled, (state, action) => {
                state.loading = false;
                state.trackingState = action.payload?.trackingState || state.trackingState;
                state.satelliteId = resolveSatelliteIdFromTrackingState(state.trackingState);
                state.groupId = resolveGroupIdFromTrackingState(state.trackingState);
                if (normalizeTargetType(state.trackingState) !== 'satellite') {
                    state.availableTransmitters = [];
                    state.selectedTransmitter = 'none';
                }
                state.trackerId = resolveTrackerId(action.payload?.trackerId, state.trackerId);
                if (action.payload?.commandId) {
                    const submittedAt = Date.now();
                    const commandTrackerId = resolveTrackerId(action.payload?.trackerId, state.trackerId);
                    const submittedCommand = {
                        commandId: action.payload.commandId,
                        scope: action.payload.commandScope || TRACKER_COMMAND_SCOPES.TRACKING,
                        status: TRACKER_COMMAND_STATUS.SUBMITTED,
                        reason: null,
                        requestedState: action.payload.requestedState || null,
                        submittedAt,
                        startedAt: null,
                        finishedAt: null,
                        updatedAt: submittedAt,
                    };
                    state.trackerCommandsById[commandTrackerId] = submittedCommand;
                }
                state.error = null;
            })
            .addCase(setTrackingStateInBackend.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })
            .addCase(fetchNextPasses.pending, (state) => {
                state.passesLoading = true;
                state.passesError = null;
            })
            .addCase(fetchNextPasses.fulfilled, (state, action) => {
                state.passesLoading = false;
                // Store passes with empty elevation curves initially (they'll be calculated in the background)
                state.satellitePasses = action.payload.map(pass => ({
                    ...pass,
                    elevation_curve: pass.elevation_curve || [] // Ensure elevation_curve exists but may be empty
                }));

                // Find the current pass and mark it
                const now = new Date().getTime();
                const activePass = action.payload.find(pass => {
                    const startTime = new Date(pass['event_start']).getTime();
                    const endTime = new Date(pass['event_end']).getTime();
                    return now >= startTime && now <= endTime;
                });

                state.activePass = activePass;
                state.passesError = null;
            })
            .addCase(fetchNextPasses.rejected, (state, action) => {
                state.passesLoading = false;
                state.passesError = action.payload;
            })
            .addCase(fetchFleetPassSummaries.pending, (state) => {
                state.fleetPassSummaryLoading = true;
                state.fleetPassSummaryError = null;
            })
            .addCase(fetchFleetPassSummaries.fulfilled, (state, action) => {
                state.fleetPassSummaryLoading = false;
                state.fleetPassSummaryByTrackerId = action.payload?.summaries || {};
                const computedAtMs = Number(action.payload?.computed_at_ms);
                if (Number.isFinite(computedAtMs) && computedAtMs > 0) {
                    state.fleetPassSummaryComputedAtMs = computedAtMs;
                }
                state.fleetPassSummaryError = null;
            })
            .addCase(fetchFleetPassSummaries.rejected, (state, action) => {
                state.fleetPassSummaryLoading = false;
                state.fleetPassSummaryError = action.payload;
            })
            .addCase(fetchSatelliteGroups.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchSatelliteGroups.fulfilled, (state, action) => {
                state.loading = false;
                state.satGroups = action.payload;
            })
            .addCase(fetchSatelliteGroups.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })
            .addCase(fetchSatellitesByGroupId.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchSatellitesByGroupId.fulfilled, (state, action) => {
                state.loading = false;
                const { satellites } = action.payload;
                state.groupOfSats = normalizeGroupOfSats(satellites);
            })
            .addCase(fetchSatellitesByGroupId.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })
            .addCase(fetchSatellite.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchSatellite.fulfilled, (state, action) => {
                state.loading = false;
                state.satelliteData = normalizeSatelliteData(action.payload);
                state.error = null;
            })
            .addCase(fetchSatellite.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })
            .addCase(getTrackingStateFromBackend.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(getTrackingStateFromBackend.fulfilled, (state, action) => {
                state.loading = false;
                const incomingTrackerId = resolveTrackerId(action.payload?.tracker_id, DEFAULT_TRACKER_ID);
                if (!incomingTrackerId) {
                    state.error = null;
                    return;
                }

                const incomingTrackingState = action.payload?.value || null;
                const trackerView = state.trackerViews[incomingTrackerId] || createDefaultTrackerView();
                if (incomingTrackingState) {
                    trackerView.trackingState = incomingTrackingState;
                    trackerView.satelliteId = resolveSatelliteIdFromTrackingState(incomingTrackingState);
                    trackerView.groupId = resolveGroupIdFromTrackingState(incomingTrackingState);
                    if (incomingTrackingState.rig_id != null) trackerView.selectedRadioRig = incomingTrackingState.rig_id;
                    if (incomingTrackingState.rotator_id != null) trackerView.selectedRotator = incomingTrackingState.rotator_id;
                    if (incomingTrackingState.transmitter_id != null) {
                        trackerView.selectedTransmitter = incomingTrackingState.transmitter_id;
                    }
                    if (incomingTrackingState.rig_vfo != null) trackerView.selectedRigVFO = incomingTrackingState.rig_vfo;
                    if (incomingTrackingState.vfo1 != null) trackerView.selectedVFO1 = incomingTrackingState.vfo1;
                    if (incomingTrackingState.vfo2 != null) trackerView.selectedVFO2 = incomingTrackingState.vfo2;
                }
                state.trackerViews[incomingTrackerId] = trackerView;

                const activeTrackerId = resolveTrackerId(state.trackerId, DEFAULT_TRACKER_ID);
                const shouldSelectIncoming = !activeTrackerId;
                if (shouldSelectIncoming) {
                    state.trackerId = incomingTrackerId;
                }
                const selectedTrackerId = shouldSelectIncoming ? incomingTrackerId : activeTrackerId;
                if (incomingTrackerId !== selectedTrackerId) {
                    state.error = null;
                    return;
                }

                if (incomingTrackingState) {
                    state.trackingState = incomingTrackingState;
                    state.selectedRadioRig = incomingTrackingState.rig_id;
                    state.selectedRotator = incomingTrackingState.rotator_id;
                    state.selectedTransmitter = incomingTrackingState.transmitter_id;
                    state.selectedRigVFO = incomingTrackingState.rig_vfo ?? state.selectedRigVFO;
                    state.selectedVFO1 = incomingTrackingState.vfo1 ?? state.selectedVFO1;
                    state.selectedVFO2 = incomingTrackingState.vfo2 ?? state.selectedVFO2;
                    state.groupId = resolveGroupIdFromTrackingState(incomingTrackingState);
                    state.satelliteId = resolveSatelliteIdFromTrackingState(incomingTrackingState);
                    if (normalizeTargetType(incomingTrackingState) !== 'satellite') {
                        state.availableTransmitters = [];
                        state.selectedTransmitter = 'none';
                    }
                }

                state.error = null;
            })
            .addCase(getTrackingStateFromBackend.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })
            .addCase(fetchTrackerInstances.fulfilled, (state, action) => {
                const instances = Array.isArray(action.payload?.instances) ? action.payload.instances : [];
                const trackerIds = instances
                    .map((instance) => resolveTrackerId(instance?.tracker_id, DEFAULT_TRACKER_ID))
                    .filter((trackerId) => Boolean(trackerId));

                if (trackerIds.length === 0) {
                    resetActiveTrackerState(state);
                    return;
                }

                const currentTrackerId = resolveTrackerId(state.trackerId, DEFAULT_TRACKER_ID);
                if (!currentTrackerId || !trackerIds.includes(currentTrackerId)) {
                    state.trackerId = trackerIds[0];
                }
            })
            .addCase(setTrackerInstances, (state, action) => {
                const payload = action.payload || {};
                const instances = Array.isArray(payload.instances) ? payload.instances : [];
                const trackerIds = instances
                    .map((instance) => resolveTrackerId(instance?.tracker_id, DEFAULT_TRACKER_ID))
                    .filter((trackerId) => Boolean(trackerId));

                if (trackerIds.length === 0) {
                    resetActiveTrackerState(state);
                    return;
                }

                const currentTrackerId = resolveTrackerId(state.trackerId, DEFAULT_TRACKER_ID);
                if (!currentTrackerId || !trackerIds.includes(currentTrackerId)) {
                    state.trackerId = trackerIds[0];
                }
            })
            .addCase(deleteTrackerInstance.fulfilled, (state, action) => {
                const deletedTrackerId = resolveTrackerId(
                    action.payload?.tracker_id,
                    DEFAULT_TRACKER_ID
                );
                if (deletedTrackerId) {
                    delete state.trackerViews[deletedTrackerId];
                }
            })
            .addCase(setTargetMapSetting.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(setTargetMapSetting.fulfilled, (state, action) => {
                state.loading = false;
                state.error = null;
            })
            .addCase(setTargetMapSetting.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })
            .addCase(getTargetMapSettings.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(getTargetMapSettings.fulfilled, (state, action) => {
                state.loading = false;
                // Handle null/undefined payload for first-time users
                if (action.payload) {
                    const mapEngine = normalizeMapEngine(action.payload['mapEngine']);
                    state.mapZoomLevel = convertMapZoomForEngine(state.mapZoomLevel, state.mapEngine, mapEngine);
                    state.mapEngine = mapEngine;
                    state.lockOnTarget = action.payload['lockOnTarget'] ?? true;
                    state.enableMapDragging = action.payload['enableMapDragging'] ?? false;
                    state.enableMapZooming = action.payload['enableMapZooming'] ?? false;
                    state.autoSwitchPlanetariumByVisibility = action.payload['autoSwitchPlanetariumByVisibility'] ?? false;
                    state.tileLayerID = resolveCompatibleTileLayerId(action.payload['tileLayerID'], mapEngine);
                    state.showPastOrbitPath = action.payload['showPastOrbitPath'];
                    state.showFutureOrbitPath = action.payload['showFutureOrbitPath'];
                    state.showSatelliteCoverage = action.payload['showSatelliteCoverage'];
                    state.showSunIcon = action.payload['showSunIcon'];
                    state.showMoonIcon = action.payload['showMoonIcon'];
                    state.showTerminatorLine = action.payload['showTerminatorLine'];
                    state.showTooltip = action.payload['showTooltip'];
                    state.showGrid = action.payload['showGrid'];
                    state.pastOrbitLineColor = action.payload['pastOrbitLineColor'];
                    state.futureOrbitLineColor = action.payload['futureOrbitLineColor'];
                    state.satelliteCoverageColor = action.payload['satelliteCoverageColor'];
                    state.orbitProjectionDuration = action.payload['orbitProjectionDuration'];
                    state.targetViewMode = normalizeTargetViewMode(action.payload['targetViewMode']);
                    state.targetViewEnableDragging = action.payload['targetViewEnableDragging'] ?? true;
                    state.targetViewEnableZooming = action.payload['targetViewEnableZooming'] ?? true;
                }
            })
            .addCase(getTargetMapSettings.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            })
            .addCase(sendNudgeCommand.pending, (state) => {
                state.loading = true;
                state.error = null;
            })
            .addCase(sendNudgeCommand.fulfilled, (state, action) => {
                state.loading = false;
                state.error = null;
            })
            .addCase(sendNudgeCommand.rejected, (state, action) => {
                state.loading = false;
                state.error = action.payload;
            });
    }
});

export const {
    setSatelliteData,
    setSatellitePasses,
    updateSatellitePassesWithElevationCurves,
    setSatelliteId,
    setSatGroupId,
    setLockOnTarget,
    setEnableMapDragging,
    setEnableMapZooming,
    setAutoSwitchPlanetariumByVisibility,
    setShowPastOrbitPath,
    setShowFutureOrbitPath,
    setShowSatelliteCoverage,
    setShowSunIcon,
    setShowMoonIcon,
    setShowTerminatorLine,
    setShowTooltip,
    setTerminatorLine,
    setDaySidePolygon,
    setPastOrbitLineColor,
    setFutureOrbitLineColor,
    setSatelliteCoverageColor,
    setOrbitProjectionDuration,
    setMapEngine,
    setTileLayerID,
    setMapZoomLevel,
    setSunPos,
    setMoonPos,
    setGridEditable,
    setSliderTimeOffset,
    setLocation,
    setLoading,
    setSatelliteSelectOpen,
    setSatelliteGroupSelectOpen,
    setGroupOfSats,
    setUITrackerDisabled,
    setStarting,
    setRadioRig,
    setRotator,
    setTrackerId,
    setRigVFO,
    setVFO1,
    setVFO2,
    setOpenMapSettingsDialog,
    setOpenPassesTableSettingsDialog,
    setPassesTableColumnVisibility,
    setPassesTablePageSize,
    setPassesTableSortModel,
    setNextPassesHours,
    setSelectedTransmitter,
    setAvailableTransmitters,
    setTargetTransmitters,
    setShowGrid,
    setColorMap,
    setColorMaps,
    setDbRange,
    setFFTSize,
    setFFTSizeOptions,
    setGain,
    setSampleRate,
    setCenterFrequency,
    setErrorMessage,
    setIsStreaming,
    setTargetFPS,
    setIsPlaying,
    setSettingsDialogOpen,
    setAutoDBRange,
    setActivePass,
    setRotatorConnecting,
    setRotatorDisconnecting,
    setTrackerCommandStatus,
    setUITrackerValues,
    setTargetViewMode,
    setTargetViewEnableDragging,
    setTargetViewEnableZooming,
} = targetSatTrackSlice.actions;

export default targetSatTrackSlice.reducer;
