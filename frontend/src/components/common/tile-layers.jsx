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

import {store} from './store.jsx';
import L from 'leaflet';

export const MAP_ENGINE_LEAFLET = 'leaflet';
export const MAP_ENGINE_MAPLIBRE = 'maplibre';
export const MAP_ENGINE_MAPLIBRE_GLOBE = 'maplibre-globe';
export const mapEngines = [MAP_ENGINE_LEAFLET, MAP_ENGINE_MAPLIBRE, MAP_ENGINE_MAPLIBRE_GLOBE];

export const mapEngineOptions = [
    { id: MAP_ENGINE_LEAFLET, name: 'Leaflet' },
    { id: MAP_ENGINE_MAPLIBRE, name: 'MapLibre' },
];

export function normalizeMapEngine(mapEngine) {
    const normalizedMapEngine = String(mapEngine || '').trim().toLowerCase();
    if (normalizedMapEngine === MAP_ENGINE_MAPLIBRE || normalizedMapEngine === MAP_ENGINE_MAPLIBRE_GLOBE) {
        return normalizedMapEngine;
    }
    return MAP_ENGINE_LEAFLET;
}

export function normalizeMapEngineForTileLayers(mapEngine) {
    const normalizedMapEngine = normalizeMapEngine(mapEngine);
    // Globe mode reuses the same raster tile compatibility matrix as MapLibre 2D.
    return normalizedMapEngine === MAP_ENGINE_MAPLIBRE_GLOBE
        ? MAP_ENGINE_MAPLIBRE
        : normalizedMapEngine;
}

export function isTileLayerCompatibleWithEngine(layer, mapEngine) {
    const normalizedMapEngine = normalizeMapEngineForTileLayers(mapEngine);
    if (!layer || typeof layer !== 'object') {
        return false;
    }
    if (!Array.isArray(layer.engines) || layer.engines.length === 0) {
        // Legacy fallback: layers without metadata are assumed Leaflet-only.
        return normalizedMapEngine === MAP_ENGINE_LEAFLET;
    }
    return layer.engines.includes(normalizedMapEngine);
}

export function getTileLayersForEngine(mapEngine, t) {
    const normalizedMapEngine = normalizeMapEngineForTileLayers(mapEngine);
    return getTileLayers(t).filter((layer) => isTileLayerCompatibleWithEngine(layer, normalizedMapEngine));
}

export function resolveCompatibleTileLayerId(id, mapEngine, t) {
    const compatibleLayers = getTileLayersForEngine(mapEngine, t);
    if (compatibleLayers.length === 0) {
        return 'satellite';
    }
    const requestedLayer = compatibleLayers.find((layer) => layer.id === id);
    if (requestedLayer) {
        return requestedLayer.id;
    }
    const defaultLayer = compatibleLayers.find((layer) => layer.id === 'satellite');
    return (defaultLayer || compatibleLayers[0]).id;
}

const nasaGibsEpsg4326Url = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';

const createNasaGibsEpsg4326Layer = ({ id, name, description, layers, format = 'image/jpeg' }) => ({
    id,
    name: `${name} (EPSG:4326)`,
    description,
    engines: [MAP_ENGINE_LEAFLET],
    type: 'wms',
    projection: 'EPSG4326',
    url: nasaGibsEpsg4326Url,
    wmsOptions: {
        layers,
        format,
        transparent: false,
        version: '1.1.1',
    },
    attribution: 'Imagery courtesy NASA GIBS',
});


// Tile layers. The descriptions are translated, and this catalogue is plain data
// built outside any React component, so the active `t` function is supplied by the
// caller (React components pass the `useTranslation` result down).
export const getTileLayers = (t) => [
    {
        id: 'osm',
        name: 'OpenStreetMap',
        description: t('tile_layers.street_map_with_roads_labels_and_place_details', { defaultValue: 'Street map with roads, labels, and place details.' }),
        engines: [MAP_ENGINE_LEAFLET, MAP_ENGINE_MAPLIBRE],
        projection: 'EPSG3857',
        url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    },
    {
        id: 'satellite',
        name: 'Esri WorldImagery',
        description: t('tile_layers.global_satellite_and_aerial_imagery_basemap', { defaultValue: 'Global satellite and aerial imagery basemap.' }),
        engines: [MAP_ENGINE_LEAFLET, MAP_ENGINE_MAPLIBRE],
        projection: 'EPSG3857',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
    },
    {
        id: 'topo',
        name: 'Opentopomap topographic',
        description: t('tile_layers.topographic_style_with_terrain_and_contour_empha', { defaultValue: 'Topographic style with terrain and contour emphasis.' }),
        engines: [MAP_ENGINE_LEAFLET, MAP_ENGINE_MAPLIBRE],
        projection: 'EPSG3857',
        url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
        attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)'
    },
    {
        id: 'stadiadark',
        name: 'Stadia dark',
        description: t('tile_layers.dark_themed_map_for_high_contrast_overlays', { defaultValue: 'Dark themed map for high-contrast overlays.' }),
        engines: [MAP_ENGINE_LEAFLET, MAP_ENGINE_MAPLIBRE],
        projection: 'EPSG3857',
        url: 'https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png?api_key={APIKEY}',
        attribution: '&copy; <a href="https://www.stadiamaps.com/" target="_blank">Stadia Maps</a> &copy; <a href="https://openmaptiles.org/" target="_blank">OpenMapTiles</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
    {
        id: 'cartodark',
        name: 'CARTO dark',
        description: t('tile_layers.dark_map_tiles_from_carto_basemaps', { defaultValue: 'Dark map tiles from CARTO basemaps.' }),
        engines: [MAP_ENGINE_LEAFLET, MAP_ENGINE_MAPLIBRE],
        projection: 'EPSG3857',
        url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
    {
        id: 'esrigreycanvas',
        name: 'Esri grey',
        description: t('tile_layers.muted_light_gray_reference_basemap', { defaultValue: 'Muted light-gray reference basemap.' }),
        engines: [MAP_ENGINE_LEAFLET, MAP_ENGINE_MAPLIBRE],
        projection: 'EPSG3857',
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}',
        attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
    },
    {
        id: 'cartodbvoyager',
        name: 'CartoDB Voyager',
        description: t('tile_layers.balanced_light_basemap_with_roads_and_labels', { defaultValue: 'Balanced light basemap with roads and labels.' }),
        engines: [MAP_ENGINE_LEAFLET, MAP_ENGINE_MAPLIBRE],
        projection: 'EPSG3857',
        url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    },
    createNasaGibsEpsg4326Layer({
        id: 'nasa_blue_marble_4326',
        name: 'NASA Blue Marble',
        description: t('tile_layers.global_shaded_relief_and_bathymetry', { defaultValue: 'Global shaded relief and bathymetry.' }),
        layers: 'BlueMarble_ShadedRelief_Bathymetry',
    }),
    createNasaGibsEpsg4326Layer({
        id: 'nasa_blue_marble_next_generation_4326',
        name: 'NASA Blue Marble Next Generation',
        description: t('tile_layers.cloud_free_global_imagery_assembled_from_modis_o', { defaultValue: 'Cloud-free global imagery assembled from MODIS observations.' }),
        layers: 'BlueMarble_NextGeneration',
    }),
    createNasaGibsEpsg4326Layer({
        id: 'nasa_blue_marble_shaded_relief_4326',
        name: 'NASA Blue Marble Shaded Relief',
        description: t('tile_layers.global_shaded_relief_without_bathymetry', { defaultValue: 'Global shaded relief without bathymetry.' }),
        layers: 'BlueMarble_ShadedRelief',
    }),
    createNasaGibsEpsg4326Layer({
        id: 'nasa_blue_marble_reference_4326',
        name: 'NASA Blue Marble Reference',
        description: t('tile_layers.blue_marble_with_coastlines_boundaries_roads_and', { defaultValue: 'Blue Marble with coastlines, boundaries, roads, and labels.' }),
        layers: 'BlueMarble_ShadedRelief_Bathymetry,Reference_Features,Reference_Labels',
        format: 'image/png',
    }),
    createNasaGibsEpsg4326Layer({
        id: 'nasa_osm_land_mask_4326',
        name: 'NASA OSM Land Mask',
        description: t('tile_layers.land_mask_layer_derived_from_osm_features', { defaultValue: 'Land mask layer derived from OSM features.' }),
        layers: 'OSM_Land_Mask',
        format: 'image/png',
    }),
    createNasaGibsEpsg4326Layer({
        id: 'nasa_osm_land_water_map_4326',
        name: 'NASA OSM Land/Water Map',
        description: t('tile_layers.land_and_water_reference_map_in_geographic_crs', { defaultValue: 'Land and water reference map in geographic CRS.' }),
        layers: 'OSM_Land_Water_Map',
        format: 'image/png',
    }),
    createNasaGibsEpsg4326Layer({
        id: 'nasa_viirs_city_lights_2012_4326',
        name: 'NASA VIIRS City Lights 2012',
        description: t('tile_layers.global_night_time_city_lights_composite', { defaultValue: 'Global night-time city lights composite.' }),
        layers: 'VIIRS_CityLights_2012',
        format: 'image/png',
    }),
    createNasaGibsEpsg4326Layer({
        id: 'nasa_aster_color_relief_4326',
        name: 'NASA ASTER Color Shaded Relief',
        description: t('tile_layers.global_color_terrain_relief_derived_from_aster_e', { defaultValue: 'Global color terrain relief derived from ASTER elevation data.' }),
        layers: 'ASTER_GDEM_Color_Shaded_Relief',
        format: 'image/png',
    }),
    createNasaGibsEpsg4326Layer({
        id: 'nasa_aster_greyscale_relief_4326',
        name: 'NASA ASTER Greyscale Shaded Relief',
        description: t('tile_layers.global_grayscale_terrain_relief_derived_from_ast', { defaultValue: 'Global grayscale terrain relief derived from ASTER elevation data.' }),
        layers: 'ASTER_GDEM_Greyscale_Shaded_Relief',
        format: 'image/png',
    }),
    // GIBS supplies its advertised default date when the WMS request omits TIME.
    createNasaGibsEpsg4326Layer({
        id: 'nasa_modis_aqua_true_color_4326',
        name: 'NASA MODIS Aqua True Color',
        description: t('tile_layers.daily_global_true_color_imagery_from_modis_aqua', { defaultValue: 'Daily global true-color imagery from MODIS Aqua.' }),
        layers: 'MODIS_Aqua_CorrectedReflectance_TrueColor',
        format: 'image/png',
    }),
    createNasaGibsEpsg4326Layer({
        id: 'nasa_modis_terra_true_color_4326',
        name: 'NASA MODIS Terra True Color',
        description: t('tile_layers.daily_global_true_color_imagery_from_modis_terra', { defaultValue: 'Daily global true-color imagery from MODIS Terra.' }),
        layers: 'MODIS_Terra_CorrectedReflectance_TrueColor',
        format: 'image/png',
    }),
    createNasaGibsEpsg4326Layer({
        id: 'nasa_viirs_noaa20_true_color_4326',
        name: 'NASA VIIRS NOAA-20 True Color',
        description: t('tile_layers.daily_global_true_color_imagery_from_viirs_noaa_', { defaultValue: 'Daily global true-color imagery from VIIRS NOAA-20.' }),
        layers: 'VIIRS_NOAA20_CorrectedReflectance_TrueColor',
        format: 'image/png',
    }),
    createNasaGibsEpsg4326Layer({
        id: 'nasa_viirs_noaa21_true_color_4326',
        name: 'NASA VIIRS NOAA-21 True Color',
        description: t('tile_layers.daily_global_true_color_imagery_from_viirs_noaa__2', { defaultValue: 'Daily global true-color imagery from VIIRS NOAA-21.' }),
        layers: 'VIIRS_NOAA21_CorrectedReflectance_TrueColor',
        format: 'image/png',
    }),
    createNasaGibsEpsg4326Layer({
        id: 'nasa_viirs_snpp_true_color_4326',
        name: 'NASA VIIRS Suomi NPP True Color',
        description: t('tile_layers.daily_global_true_color_imagery_from_viirs_suomi', { defaultValue: 'Daily global true-color imagery from VIIRS Suomi NPP.' }),
        layers: 'VIIRS_SNPP_CorrectedReflectance_TrueColor',
        format: 'image/png',
    }),
];

/**
 * Function to get a tile layer by its id.
 * @param {string} id - The id of the tile layer to retrieve.
 * @param {Object} [options] - Lookup options.
 * @param {string} [options.mapEngine] - Map engine the layer must be compatible with.
 * @param {Function} [options.t] - Active translation function, forwarded to the layer catalogue.
 * @returns {Object|null} - The tile layer object if found, otherwise null.
 */
export function getTileLayerById(id, options = {}) {
    const { t } = options;
    const mapEngine = normalizeMapEngineForTileLayers(options.mapEngine);
    const layers = getTileLayers(t);
    const compatibleLayerId = resolveCompatibleTileLayerId(id, mapEngine, t);
    const baseLayer = layers.find(layer => layer.id === compatibleLayerId);
    const fallbackLayerId = resolveCompatibleTileLayerId('satellite', mapEngine, t);
    const fallbackLayer = layers.find(layer => layer.id === fallbackLayerId) || layers[0] || {};
    const tileLayer = {
        ...((baseLayer && baseLayer.id) ? baseLayer : fallbackLayer),
        wmsOptions: { ...(baseLayer?.wmsOptions || fallbackLayer?.wmsOptions || {}) },
    };

    if (tileLayer.id === 'stadiadark') {
        const state = store.getState();
        const preferences = state.preferences.preferences;
        const apiKey = preferences.find(pref => pref.name === "stadia_maps_api_key");
        if (apiKey) {
            tileLayer.url = tileLayer.url.replace("{APIKEY}", apiKey.value);
        }
    }

    return tileLayer;
}

export function getMapCrsByTileLayerId(id, options = {}) {
    const tileLayer = getTileLayerById(id, options);
    if (tileLayer.projection === 'EPSG4326') {
        return L.CRS.EPSG4326;
    }

    return L.CRS.EPSG3857;
}

export function getMapLibreTileURL(id, options = {}) {
    const tileLayer = getTileLayerById(id, options);
    // MapLibre style templates do not support Leaflet placeholders like {s}/{r}.
    return String(tileLayer?.url || '')
        .replaceAll('{s}', 'a')
        .replaceAll('{r}', '');
}
