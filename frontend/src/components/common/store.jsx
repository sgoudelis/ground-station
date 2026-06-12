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

/* global process */

import {combineReducers, configureStore} from '@reduxjs/toolkit';
import { persistStore, persistReducer } from "redux-persist";
import storageEngine from "redux-persist/lib/storage";
import rigsReducer from '../hardware/rig-slice.jsx';
import rotatorsReducer from '../hardware/rotator-slice.jsx';
import orbitalSourcesReducer from '../satellites/sources-slice.jsx';
import satellitesReducer from '../satellites/satellite-slice.jsx';
import satelliteGroupReducer from '../satellites/groups-slice.jsx';
import locationReducer from '../settings/location-slice.jsx';
import synchronizeReducer from '../satellites/synchronize-slice.jsx';
import preferencesReducer from '../settings/preferences-slice.jsx';
import targetSatTrackReducer from '../target/target-slice.jsx'
import trackerInstancesReducer from '../target/tracker-instances-slice.jsx';
import earthViewTrackReducer from '../earthview/earthview-slice.jsx';
import dashboardReducer from '../dashboard/dashboard-slice.jsx';
import waterfallReducer from '../waterfall/waterfall-slice.jsx';
import gnssReducer from '../waterfall/gnss-slice.jsx';
import vfoReducer from '../waterfall/vfo-marker/vfo-slice.jsx';
import sdrsReducer from '../hardware/sdr-slice.jsx';
import versionReducer from "../dashboard/version-slice.jsx";
import updateCheckReducer from "../dashboard/update-slice.jsx";
import fileBrowserReducer from '../filebrowser/filebrowser-slice.jsx';
import decodersReducer from '../decoders/decoders-slice.jsx';
import libraryVersionsReducer from '../settings/library-versions-slice.jsx';
import performanceReducer from '../performance/performance-slice.jsx';
import systemInfoReducer from '../settings/system-info-slice.jsx';
import sessionsReducer from '../settings/sessions-slice.jsx';
import transcriptionReducer from '../waterfall/transcription-slice.jsx';
import schedulerReducer from '../scheduler/scheduler-slice.jsx';
import tasksReducer from '../tasks/tasks-slice.jsx';
import celestialReducer from '../celestial/celestial-slice.jsx';
import celestialMonitoredReducer from '../celestial/monitored-slice.jsx';
import celestialDisplayReducer from '../celestial/celestial-display-slice.jsx';
import backendSyncMiddleware from '../waterfall/vfo-marker/vfo-middleware.jsx';

const storage = storageEngine?.default ?? storageEngine;


// Persist configuration for waterfall slice
const waterfallPersistConfig = {
    key: 'waterfall',
    storage,
    whitelist: ['centerFrequency', 'colorMap', 'dbRange', 'gain', 'sampleRate', 'showRightSideWaterFallAccessories',
        'showLeftSideWaterFallAccessories', 'selectedAntenna', 'selectedSDRId', 'selectedOffsetMode',
        'selectedOffsetValue', 'fftAveraging', 'showRotatorDottedLines', 'autoScalePreset', 'expandedPanels',
        'packetsDrawerHeight', 'packetsDrawerOpen', 'showNeighboringTransmitters', 'showBookmarkSources',
        'sdrSettingsById']
};

// Persist GNSS UI preferences only (not live lifecycle summary).
const gnssPersistConfig = {
    key: 'gnss',
    storage,
    whitelist: ['decodedInsightsActiveTab', 'gnssSatellitesSortModel']
};

// Persist configuration for VFO slice
const vfoPersistConfig = {
    key: 'vfo',
    storage,
    whitelist: ['vfoMarkers', 'vfoMuted']
};

// Persist configuration for the 'rigs' slice
const rigsPersistConfig = {
    key: 'rigs',
    storage,
    whitelist: []
};

// Persist configuration for the 'rotators' slice
const rotatorsPersistConfig = {
    key: 'rotators',
    storage,
    whitelist: []
};

// Persist configuration for the orbital-sources slice.
// Keep legacy persistence key for backward compatibility with existing browser storage.
const orbitalSourcesPersistConfig = {
    key: 'tleSources',
    storage,
    whitelist: []
};

// Persist configuration for satellites slice
const satellitesPersistConfig = {
    key: 'satellites',
    storage,
    whitelist: []
};

// Persist configuration for satellite groups slice
const satelliteGroupsPersistConfig = {
    key: 'satelliteGroups',
    storage,
    whitelist: []
};


// Persist configuration for location slice
const locationPersistConfig = {
    key: 'location',
    storage,
    whitelist: []
};

// Persist configuration for the 'synchronize' slice
const synchronizePersistConfig = {
    key: 'synchronize',
    storage,
    whitelist: []
};

// Persist configuration for the 'preferences' slice
// Custom state reconciler to only persist/restore theme preference
const preferencesStateReconciler = (inboundState, originalState) => {
    if (!inboundState || !inboundState.preferences) {
        return originalState;
    }

    // Find the persisted theme preference
    const persistedTheme = inboundState.preferences.find(pref => pref.name === 'theme');

    if (!persistedTheme) {
        return originalState;
    }

    // Merge: use original state but update theme value from localStorage
    return {
        ...originalState,
        preferences: originalState.preferences.map(pref =>
            pref.name === 'theme' ? { ...pref, value: persistedTheme.value } : pref
        )
    };
};

const preferencesPersistConfig = {
    key: 'preferences',
    storage,
    stateReconciler: preferencesStateReconciler,
    whitelist: ['preferences']
};

// Persist configuration for the target satellite tracking slice
const targetSatTrackPersistConfig = {
    key: 'targetSatTrack',
    storage,
    whitelist: ['passesTableSortModel', 'trackerId', 'lockOnTarget']
};

// Persist configuration for earth view tracking slice
const earthViewTrackPersistConfig = {
    key: 'earthViewTrack',
    storage,
    whitelist: ['selectedSatGroupId', 'selectedSatelliteId', 'satellitesTableColumnVisibility', 'passesTablePageSize', 'satellitesTablePageSize', 'passesTableSortModel', 'satellitesTableSortModel', 'showGeostationarySatellites', 'mapEngine', 'mapZoomByEngine']
};

// Persist configuration for the dashboard slice
const dashboardPersistConfig = {
    key: 'dashboard',
    storage,
    whitelist: []
};


// Persist configuration for SDR slice
const sdrPersistConfig = {
    key: 'sdr',
    storage,
    whitelist: []
};

// Persist configuration for VersionInfo slice
const versionInfoConfig = {
    key: 'version',
    storage,
    whitelist: []
};

// Persist configuration for update check slice (runtime only)
const updateCheckConfig = {
    key: 'updateCheck',
    storage,
    whitelist: []
};

// Persist configuration for file browser slice
const fileBrowserPersistConfig = {
    key: 'filebrowser',
    storage,
    whitelist: ['sortBy', 'sortOrder', 'viewMode', 'pageSize', 'filters']
};

// Persist configuration for decoders slice
const decodersPersistConfig = {
    key: 'decoders',
    storage,
    whitelist: ['ui']  // Persist UI state, not active sessions
};

// Persist configuration for library versions slice
const libraryVersionsPersistConfig = {
    key: 'libraryVersions',
    storage,
    whitelist: []  // Don't persist library versions
};

// Persist configuration for performance slice
const performancePersistConfig = {
    key: 'performance',
    storage,
    whitelist: []  // Don't persist performance metrics (runtime only)
};

// Persist configuration for system info slice (do not persist runtime metrics)
const systemInfoPersistConfig = {
    key: 'systemInfo',
    storage,
    whitelist: []
};

// Persist configuration for transcription slice (do not persist transcriptions - runtime only)
const transcriptionPersistConfig = {
    key: 'transcription',
    storage,
    whitelist: []  // Don't persist transcriptions (they're ephemeral)
};

// Persist configuration for scheduler slice
const schedulerPersistConfig = {
    key: 'scheduler',
    storage,
    whitelist: ['columnVisibility', 'timeline']  // Persist UI preferences, not observations
};

// Persist configuration for background tasks slice (do not persist - runtime only)
const tasksPersistConfig = {
    key: 'backgroundTasks',
    storage,
    whitelist: []  // Don't persist tasks (they're ephemeral)
};

// Persist configuration for celestial slice
const celestialPersistConfig = {
    key: 'celestial',
    storage,
    whitelist: ['mapSettings', 'passesTableColumnVisibility', 'passesTablePageSize', 'passesTableSortModel']
};

const celestialMonitoredPersistConfig = {
    key: 'celestialMonitored',
    storage,
    whitelist: ['selectedIds', 'tableColumnVisibility', 'tablePageSize', 'tableSortModel']
};

const celestialDisplayPersistConfig = {
    key: 'celestialDisplay',
    storage,
    whitelist: ['solarSystem', 'planetarium'],
};


// Wrap reducers with persistReducer
const persistedWaterfallReducer = persistReducer(waterfallPersistConfig, waterfallReducer);
const persistedGnssReducer = persistReducer(gnssPersistConfig, gnssReducer);
const persistedVfoReducer = persistReducer(vfoPersistConfig, vfoReducer);
const persistedRigsReducer = persistReducer(rigsPersistConfig, rigsReducer);
const persistedRotatorsReducer = persistReducer(rotatorsPersistConfig, rotatorsReducer);
const persistedOrbitalSourcesReducer = persistReducer(
    orbitalSourcesPersistConfig,
    orbitalSourcesReducer
);
const persistedSatellitesReducer = persistReducer(satellitesPersistConfig, satellitesReducer);
const persistedSatelliteGroupsReducer = persistReducer(satelliteGroupsPersistConfig, satelliteGroupReducer);
const persistedLocationReducer = persistReducer(locationPersistConfig, locationReducer);
const persistedSynchronizeReducer = persistReducer(synchronizePersistConfig, synchronizeReducer);
const persistedPreferencesReducer = persistReducer(preferencesPersistConfig, preferencesReducer);
const persistedTargetSatTrackReducer = persistReducer(targetSatTrackPersistConfig, targetSatTrackReducer);
const persistedEarthViewTrackReducer = persistReducer(earthViewTrackPersistConfig, earthViewTrackReducer);
const persistedDashboardReducer = persistReducer(dashboardPersistConfig, dashboardReducer);
const persistedSdrReducer = persistReducer(sdrPersistConfig, sdrsReducer);
const persistedVersionInfoReducer = persistReducer(versionInfoConfig, versionReducer);
const persistedUpdateCheckReducer = persistReducer(updateCheckConfig, updateCheckReducer);
const persistedFileBrowserReducer = persistReducer(fileBrowserPersistConfig, fileBrowserReducer);
const persistedDecodersReducer = persistReducer(decodersPersistConfig, decodersReducer);
const persistedLibraryVersionsReducer = persistReducer(libraryVersionsPersistConfig, libraryVersionsReducer);
const persistedPerformanceReducer = persistReducer(performancePersistConfig, performanceReducer);
const persistedSystemInfoReducer = persistReducer(systemInfoPersistConfig, systemInfoReducer);
const persistedTranscriptionReducer = persistReducer(transcriptionPersistConfig, transcriptionReducer);
const persistedSchedulerReducer = persistReducer(schedulerPersistConfig, schedulerReducer);
const persistedTasksReducer = persistReducer(tasksPersistConfig, tasksReducer);
const persistedCelestialReducer = persistReducer(celestialPersistConfig, celestialReducer);
const persistedCelestialMonitoredReducer = persistReducer(celestialMonitoredPersistConfig, celestialMonitoredReducer);
const persistedCelestialDisplayReducer = persistReducer(celestialDisplayPersistConfig, celestialDisplayReducer);


export const store = configureStore({
    reducer: {
        waterfall: persistedWaterfallReducer,
        gnss: persistedGnssReducer,
        vfo: persistedVfoReducer,
        rigs: persistedRigsReducer,
        rotators: persistedRotatorsReducer,
        tleSources: persistedOrbitalSourcesReducer,
        satellites: persistedSatellitesReducer,
        satelliteGroups: persistedSatelliteGroupsReducer,
        location: persistedLocationReducer,
        syncSatellite: persistedSynchronizeReducer,
        preferences: persistedPreferencesReducer,
        targetSatTrack: persistedTargetSatTrackReducer,
        trackerInstances: trackerInstancesReducer,
        earthViewTrack: persistedEarthViewTrackReducer,
        dashboard: persistedDashboardReducer,
        sdrs: persistedSdrReducer,
        version: persistedVersionInfoReducer,
        updateCheck: persistedUpdateCheckReducer,
        filebrowser: persistedFileBrowserReducer,
        decoders: persistedDecodersReducer,
        libraryVersions: persistedLibraryVersionsReducer,
        performance: persistedPerformanceReducer,
        systemInfo: persistedSystemInfoReducer,
        sessions: sessionsReducer,
        transcription: persistedTranscriptionReducer,
        scheduler: persistedSchedulerReducer,
        backgroundTasks: persistedTasksReducer,
        celestial: persistedCelestialReducer,
        celestialMonitored: persistedCelestialMonitoredReducer,
        celestialDisplay: persistedCelestialDisplayReducer,
    },
    devTools: process.env.NODE_ENV !== "production",
    middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({
            immutableCheck: { warnAfter: 256 },
            serializableCheck: {
                warnAfter: 256,
                ignoredActions: ["persist/PERSIST", "persist/REHYDRATE"],
            },
        }).concat(backendSyncMiddleware),
});

//export default store;
export const persistor = persistStore(store);
