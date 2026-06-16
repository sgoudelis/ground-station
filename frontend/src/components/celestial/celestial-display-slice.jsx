import { createSlice } from '@reduxjs/toolkit';

export const DEFAULT_SOLAR_SYSTEM_DISPLAY_OPTIONS = {
    showGrid: true,
    showPlanets: true,
    showPlanetLabels: true,
    showPlanetOrbits: true,
    showTrackedObjects: true,
    showTrackedOrbits: true,
    showTrackedLabels: true,
    showStarfieldBackground: true,
    showAsteroidZones: true,
    showZoneLabels: true,
    showResonanceMarkers: true,
    showTimestamp: true,
    showScaleIndicator: true,
    showGestureHint: true,
};

export const DEFAULT_PLANETARIUM_DISPLAY_OPTIONS = {
    showGrid: true,
    showHorizonCompass: true,
    showStarField: true,
    showStarNames: true,
    showConstellationLabels: true,
    showPassCurves: true,
    showPlanetLabels: true,
    showTargetLabels: true,
    showRotatorCrosshair: true,
    showHud: true,
};

const celestialDisplaySlice = createSlice({
    name: 'celestialDisplay',
    initialState: {
        solarSystem: { ...DEFAULT_SOLAR_SYSTEM_DISPLAY_OPTIONS },
        planetarium: { ...DEFAULT_PLANETARIUM_DISPLAY_OPTIONS },
    },
    reducers: {
        setSolarSystemDisplayOption: (state, action) => {
            const { key, value } = action.payload || {};
            if (!key || typeof value !== 'boolean') return;
            if (!(key in DEFAULT_SOLAR_SYSTEM_DISPLAY_OPTIONS)) return;
            state.solarSystem[key] = value;
        },
        resetSolarSystemDisplayOptions: (state) => {
            state.solarSystem = { ...DEFAULT_SOLAR_SYSTEM_DISPLAY_OPTIONS };
        },
        setPlanetariumDisplayOption: (state, action) => {
            const { key, value } = action.payload || {};
            if (!key || typeof value !== 'boolean') return;
            if (!(key in DEFAULT_PLANETARIUM_DISPLAY_OPTIONS)) return;
            state.planetarium[key] = value;
        },
        resetPlanetariumDisplayOptions: (state) => {
            state.planetarium = { ...DEFAULT_PLANETARIUM_DISPLAY_OPTIONS };
        },
    },
});

export const {
    setSolarSystemDisplayOption,
    resetSolarSystemDisplayOptions,
    setPlanetariumDisplayOption,
    resetPlanetariumDisplayOptions,
} = celestialDisplaySlice.actions;

export default celestialDisplaySlice.reducer;
