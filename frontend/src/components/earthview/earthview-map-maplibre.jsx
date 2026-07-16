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

import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import Map, {Marker, Popup, Source, Layer} from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import {Box, Fab, useTheme, Typography, Tooltip, IconButton, Button} from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FilterCenterFocusIcon from '@mui/icons-material/FilterCenterFocus';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import TrackChangesIcon from '@mui/icons-material/TrackChanges';
import InfoIcon from '@mui/icons-material/Info';
import SettingsIcon from '@mui/icons-material/Settings';
import {useDispatch, useSelector} from 'react-redux';
import {useTranslation} from 'react-i18next';
import {useNavigate} from 'react-router-dom';
import {
    setOpenMapSettingsDialog,
    setMapZoomLevel,
    setEarthViewMapSetting,
    setSelectedSatelliteId,
    setSelectedSatellitePositions,
    setSatelliteData,
} from './earthview-slice.jsx';
import {
    getMapLibreTileURL,
    getTileLayerById,
    normalizeMapEngine,
} from '../common/tile-layers.jsx';
import {homeIcon, moonIcon, sunIcon} from '../common/dataurl-icons.jsx';
import {
    TitleBar,
    MapStatusBar,
    MapArrowControls,
    SimpleTruncatedHtml,
    getClassNamesBasedOnGridEditing,
    islandTitleBarSx,
} from '../common/common.jsx';
import MapSettingsIslandDialog from './map-settings-dialog.jsx';
import {
    calculateSatelliteAzEl,
    calculateTimeToMaxElevation,
    getSatelliteCoverageCircle,
    getSatelliteLatLon,
    getSatellitePaths,
    isSatelliteVisible,
} from '../common/tracking-logic.jsx';
import TargetNumberIcon from '../common/target-number-icon.jsx';
import createTerminatorLine from '../common/terminator-line.jsx';
import {getSunMoonCoords} from '../common/sunmoon.jsx';
import {useSocket} from '../common/socket.jsx';
import {store} from '../common/store.jsx';
import {CircularProgress, Backdrop} from '@mui/material';
import {pickTooltipDirection} from '../common/tooltip-orientation.js';

const viewSatelliteLimit = 100;
const MAPLIBRE_MIN_ZOOM = -6;
const MAPLIBRE_TOOLTIP_DIRECTIONS = Object.freeze(['bottom', 'right', 'left', 'top']);
const MAPLIBRE_TOOLTIP_DEFAULT_SIZE = Object.freeze({width: 220, height: 48});
const MAPLIBRE_TOOLTIP_ANCHOR_DISTANCE = 15;
const MAPLIBRE_TOOLTIP_EDGE_PADDING = 10;
// MapLibre anchor names describe which popup edge is connected to the marker, so the
// value is the inverse of Leaflet tooltip direction names (which describe where it appears).
const MAPLIBRE_ANCHOR_BY_TOOLTIP_DIRECTION = Object.freeze({
    top: 'bottom',
    right: 'left',
    left: 'right',
    bottom: 'top',
});

const DATE_LINE_GEOJSON = {
    type: 'FeatureCollection',
    features: [
        {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: [[180, 90], [180, -90]],
            },
        },
        {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: [[-180, 90], [-180, -90]],
            },
        },
    ],
};

const emptyFeatureCollection = () => ({
    type: 'FeatureCollection',
    features: [],
});

function latLonToLngLat(point) {
    let lat;
    let lon;

    if (Array.isArray(point) && point.length >= 2) {
        lat = Number(point[0]);
        lon = Number(point[1]);
    } else if (point && typeof point === 'object') {
        lat = Number(point.lat);
        lon = Number(point.lon ?? point.lng);
    } else {
        return null;
    }

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return [lon, lat];
}

function normalizePathSegments(pathData) {
    if (!Array.isArray(pathData) || pathData.length === 0) {
        return [];
    }
    const firstEntry = pathData[0];
    const looksSegmented = Array.isArray(firstEntry)
        && firstEntry.length > 0
        && (Array.isArray(firstEntry[0]) || (firstEntry[0] && typeof firstEntry[0] === 'object'));
    return looksSegmented ? pathData : [pathData];
}

function projectTerminatorForMapLibre(points) {
    const normalizedPoints = Array.isArray(points)
        ? points
            .map((point) => (Array.isArray(point) && point.length >= 2 ? [Number(point[0]), Number(point[1])] : null))
            .filter((point) => point && Number.isFinite(point[0]) && Number.isFinite(point[1]))
        : [];

    const line = normalizedPoints.filter(([, lon]) => lon >= -180 && lon <= 180);
    if (line.length < 2) {
        return { line: [], polygon: [] };
    }

    const polePoint = normalizedPoints.find(([lat]) => Math.abs(Math.abs(lat) - 90) < 0.5) || null;
    if (!polePoint) {
        const firstPoint = line[0];
        const lastPoint = line[line.length - 1];
        const polygon = (firstPoint && lastPoint && (firstPoint[0] !== lastPoint[0] || firstPoint[1] !== lastPoint[1]))
            ? [...line, firstPoint]
            : line;
        return { line, polygon };
    }

    const poleLat = polePoint[0] >= 0 ? 90 : -90;
    const firstLinePoint = line[0];
    const lastLinePoint = line[line.length - 1];
    const polygon = [
        [poleLat, firstLinePoint[1]],
        ...line,
        [poleLat, lastLinePoint[1]],
        [poleLat, firstLinePoint[1]],
    ];

    return { line, polygon };
}

function buildGridGeoJSON(latInterval = 15, lngInterval = 15) {
    const features = [];

    for (let lat = -90; lat <= 90; lat += latInterval) {
        if (lat === -90 || lat === 90) continue;
        const line = [];
        for (let lng = -180; lng <= 180; lng += 1) {
            line.push([lng, lat]);
        }
        features.push({
            type: 'Feature',
            properties: {kind: 'lat', major: lat === 0},
            geometry: {type: 'LineString', coordinates: line},
        });
    }

    for (let lng = -180; lng <= 180; lng += lngInterval) {
        if (lng === 180) continue;
        const line = [];
        for (let lat = -90; lat <= 90; lat += 1) {
            line.push([lng, lat]);
        }
        features.push({
            type: 'Feature',
            properties: {kind: 'lng', major: lng === 0},
            geometry: {type: 'LineString', coordinates: line},
        });
    }

    return {
        type: 'FeatureCollection',
        features,
    };
}

function areSatellitesEquivalent(prev = [], next = []) {
    if (prev === next) return true;
    if (!Array.isArray(prev) || !Array.isArray(next)) return false;
    if (prev.length !== next.length) return false;
    for (let i = 0; i < prev.length; i += 1) {
        if (prev[i]?.norad_id !== next[i]?.norad_id) return false;
        if (prev[i]?.tle1 !== next[i]?.tle1) return false;
        if (prev[i]?.tle2 !== next[i]?.tle2) return false;
    }
    return true;
}

function isMapLibreOverlayTarget(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest('.maplibregl-marker, .maplibregl-popup'));
}

const EarthViewAttributionBar = React.memo(function EarthViewAttributionBar({htmlString}) {
    return (
        <MapStatusBar>
            <SimpleTruncatedHtml className={'attribution'} htmlString={htmlString}/>
        </MapStatusBar>
    );
});

const MapLibreSatellitePopup = React.memo(function MapLibreSatellitePopup({
    map,
    popupId,
    longitude,
    latitude,
    className,
    children,
}) {
    const popupRef = useRef(null);
    const [tooltipDirection, setTooltipDirection] = useState(MAPLIBRE_TOOLTIP_DIRECTIONS[0]);

    const updateTooltipOrientation = useCallback(() => {
        if (!map) return;
        const projectedPoint = map.project([longitude, latitude]);
        const mapCanvas = map.getCanvas();
        const mapWidth = Number(mapCanvas?.clientWidth);
        const mapHeight = Number(mapCanvas?.clientHeight);
        if (!Number.isFinite(projectedPoint?.x) || !Number.isFinite(projectedPoint?.y)) return;
        if (!Number.isFinite(mapWidth) || !Number.isFinite(mapHeight) || mapWidth <= 0 || mapHeight <= 0) return;

        const popupContentElement = popupRef.current?.getElement?.()?.querySelector?.('.maplibregl-popup-content');
        const tooltipSize = popupContentElement
            ? {width: popupContentElement.offsetWidth, height: popupContentElement.offsetHeight}
            : MAPLIBRE_TOOLTIP_DEFAULT_SIZE;

        const nextDirection = pickTooltipDirection({
            anchorPoint: {x: projectedPoint.x, y: projectedPoint.y},
            mapSize: {x: mapWidth, y: mapHeight},
            tooltipSize,
            preferredDirections: MAPLIBRE_TOOLTIP_DIRECTIONS,
            anchorDistance: MAPLIBRE_TOOLTIP_ANCHOR_DISTANCE,
            edgePadding: MAPLIBRE_TOOLTIP_EDGE_PADDING,
        });
        setTooltipDirection((currentDirection) => (
            currentDirection === nextDirection ? currentDirection : nextDirection
        ));
    }, [latitude, longitude, map]);

    useEffect(() => {
        if (!map) return undefined;
        let animationFrameId = requestAnimationFrame(updateTooltipOrientation);
        const scheduleUpdate = () => {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = requestAnimationFrame(updateTooltipOrientation);
        };

        map.on('moveend', scheduleUpdate);
        map.on('zoomend', scheduleUpdate);
        map.on('resize', scheduleUpdate);
        return () => {
            cancelAnimationFrame(animationFrameId);
            map.off('moveend', scheduleUpdate);
            map.off('zoomend', scheduleUpdate);
            map.off('resize', scheduleUpdate);
        };
    }, [map, updateTooltipOrientation]);

    useEffect(() => {
        const animationFrameId = requestAnimationFrame(updateTooltipOrientation);
        return () => cancelAnimationFrame(animationFrameId);
    }, [children, updateTooltipOrientation]);

    useEffect(() => {
        const popupContentElement = popupRef.current?.getElement?.()?.querySelector?.('.maplibregl-popup-content');
        if (!popupContentElement || typeof ResizeObserver === 'undefined') {
            return undefined;
        }

        const resizeObserver = new ResizeObserver(() => {
            updateTooltipOrientation();
        });
        resizeObserver.observe(popupContentElement);
        return () => resizeObserver.disconnect();
    }, [tooltipDirection, updateTooltipOrientation]);

    const tooltipAnchor = MAPLIBRE_ANCHOR_BY_TOOLTIP_DIRECTION[tooltipDirection] || 'top';

    return (
        <Popup
            ref={popupRef}
            key={`earth-view-maplibre-popup-${popupId}-${tooltipDirection}`}
            longitude={longitude}
            latitude={latitude}
            maxWidth="none"
            closeButton={false}
            closeOnClick={false}
            anchor={tooltipAnchor}
            offset={MAPLIBRE_TOOLTIP_ANCHOR_DISTANCE}
            className={className}
        >
            {children}
        </Popup>
    );
});

const MapLibreEarthViewMapRenderer = ({handleSetTrackingOnBackend, onSatelliteMarkerContextMenu}) => {
    const {socket} = useSocket();
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const {t} = useTranslation('earthview');
    const theme = useTheme();
    const {
        showPastOrbitPath,
        showFutureOrbitPath,
        showSatelliteCoverage,
        showSunIcon,
        showMoonIcon,
        showTerminatorLine,
        showTooltip,
        gridEditable,
        pastOrbitLineColor,
        futureOrbitLineColor,
        satelliteCoverageColor,
        orbitProjectionDuration,
        tileLayerID,
        mapEngine,
        mapZoomByEngine,
        showGrid,
        enableMapDragging,
        enableMapZooming,
        selectedSatelliteId,
        selectedSatGroupId,
        loadingSatellites,
    } = useSelector((state) => state.earthViewTrack);

    const selectedSatellites = useSelector(
        (state) => state.earthViewTrack.selectedSatellites,
        areSatellitesEquivalent
    );

    const {location} = useSelector((state) => state.location);
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);

    const mapRef = useRef(null);
    const controlsBoxRef = useRef(null);
    const arrowControlsRef = useRef(null);
    const markerClickInProgressRef = useRef(false);
    const updateTimeRef = useRef(null);
    const elevationHistoryRef = useRef({});

    const normalizedMapEngine = useMemo(
        () => normalizeMapEngine(mapEngine),
        [mapEngine]
    );
    const mapZoomLevel = useMemo(() => {
        const engineZoom = Number(mapZoomByEngine?.[normalizedMapEngine]);
        if (Number.isFinite(engineZoom)) {
            return engineZoom;
        }
        return normalizedMapEngine === 'maplibre' ? 0.5 : 1.5;
    }, [mapZoomByEngine, normalizedMapEngine]);
    const selectedTileLayer = useMemo(
        () => getTileLayerById(tileLayerID, {mapEngine: normalizedMapEngine}),
        [normalizedMapEngine, tileLayerID]
    );
    const attributionHtml = useMemo(
        () => `<a href="https://maplibre.org/" title="Open source map rendering" target="_blank" rel="noopener noreferrer">MapLibre</a> | ${selectedTileLayer.attribution}`,
        [selectedTileLayer.attribution]
    );
    const selectedTileURL = useMemo(
        () => getMapLibreTileURL(tileLayerID, {mapEngine: normalizedMapEngine}),
        [normalizedMapEngine, tileLayerID]
    );

    const mapStyle = useMemo(
        () => ({
            version: 8,
            sources: {
                basemap: {
                    type: 'raster',
                    tiles: [selectedTileURL],
                    tileSize: 256,
                },
            },
            layers: [
                {
                    id: 'basemap',
                    type: 'raster',
                    source: 'basemap',
                },
            ],
        }),
        [selectedTileURL]
    );

    const trackedSatelliteIds = useMemo(() => {
        const ids = new Set();
        trackerInstances.forEach((instance) => {
            const state = instance?.tracking_state || {};
            const noradId = state?.norad_id;
            const groupId = state?.group_id;
            if (noradId == null) return;
            if (selectedSatGroupId && groupId && String(groupId) !== String(selectedSatGroupId)) return;
            ids.add(Number(noradId));
        });
        return ids;
    }, [trackerInstances, selectedSatGroupId]);

    const targetNumberByNorad = useMemo(() => {
        const mapping = {};
        trackerInstances.forEach((instance, index) => {
            const state = instance?.tracking_state || {};
            const noradId = state?.norad_id;
            const groupId = state?.group_id;
            if (noradId == null) return;
            if (selectedSatGroupId && groupId && String(groupId) !== String(selectedSatGroupId)) return;
            const key = String(noradId);
            const targetNumber = Number(instance?.target_number || (index + 1));
            if (mapping[key] == null || targetNumber < mapping[key]) {
                mapping[key] = targetNumber;
            }
        });
        return mapping;
    }, [trackerInstances, selectedSatGroupId]);

    const [overlayData, setOverlayData] = useState({
        markers: [],
        pastPath: [],
        futurePath: [],
        coverages: [],
        crosshairLines: [],
        terminatorLine: [],
        daySidePolygon: [],
        sunPos: null,
        moonPos: null,
    });

    const gridGeoJSON = useMemo(() => buildGridGeoJSON(15, 15), []);

    const handleOpenSettings = useCallback(() => {
        dispatch(setOpenMapSettingsDialog(true));
    }, [dispatch]);

    const handleSetMapZoomLevel = useCallback(
        (zoomLevel) => {
            dispatch(setMapZoomLevel(zoomLevel));
        },
        [dispatch]
    );

    // Keep map zoom levels (including negative zoom) as requested by user controls.
    // Default MapLibre constrain logic can force zoom-in when world copies are disabled.
    const preserveRequestedZoomConstrain = useCallback((center, zoom) => ({center, zoom}), []);

    const satelliteUpdate = useCallback((now) => {
        if (!location || location.lat == null || location.lon == null) {
            return;
        }

        const markers = [];
        const coverages = [];
        const crosshairLines = [];
        let pastPath = [];
        let futurePath = [];
        const selectedSatPos = {};
        let satIndex = 0;

        selectedSatellites.forEach((satellite) => {
            if (satIndex++ >= viewSatelliteLimit) return;
            try {
                const noradId = satellite.norad_id;
                const [lat, lon, altitude, velocity] = getSatelliteLatLon(
                    satellite.norad_id,
                    satellite.tle1,
                    satellite.tle2,
                    now,
                    satellite.name
                );

                if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(altitude)) {
                    return;
                }

                const [az, el, range] = calculateSatelliteAzEl(
                    satellite.tle1,
                    satellite.tle2,
                    {
                        lat: location.lat,
                        lon: location.lon,
                        alt: location.alt,
                    },
                    now
                ) || [0, 0, 0];

                if (!Number.isFinite(az) || !Number.isFinite(el) || !Number.isFinite(range)) {
                    return;
                }

                if (!elevationHistoryRef.current[noradId]) {
                    elevationHistoryRef.current[noradId] = [];
                }
                elevationHistoryRef.current[noradId].push(el);
                if (elevationHistoryRef.current[noradId].length > 5) {
                    elevationHistoryRef.current[noradId].shift();
                }

                const history = elevationHistoryRef.current[noradId];
                let trend = 'stable';
                let elRate = 0;
                const lowRateThreshold = 0.04;
                const highRateThreshold = 0.18;

                if (history.length >= 2) {
                    const changes = [];
                    for (let i = 1; i < history.length; i += 1) {
                        changes.push(history[i] - history[i - 1]);
                    }
                    elRate = changes.reduce((a, b) => a + b, 0) / changes.length;
                    if (elRate >= highRateThreshold) trend = 'rising_fast';
                    else if (elRate >= lowRateThreshold) trend = 'rising_slow';
                    else if (elRate <= -highRateThreshold) trend = 'falling_fast';
                    else if (elRate <= -lowRateThreshold) trend = 'falling_slow';
                    else if (Math.abs(elRate) < lowRateThreshold && el > 0 && history.length >= 3) {
                        const recent = history.slice(-3);
                        const maxRecent = Math.max(...recent);
                        if (Math.abs(el - maxRecent) < 0.2) trend = 'peak';
                    }
                }

                let timeToMaxEl = null;
                if (el > 0 && (trend === 'rising_slow' || trend === 'rising_fast')) {
                    timeToMaxEl = calculateTimeToMaxElevation(
                        satellite.tle1,
                        satellite.tle2,
                        {
                            lat: location.lat,
                            lon: location.lon,
                            alt: location.alt,
                        },
                        now
                    );
                }

                selectedSatPos[noradId] = {
                    az,
                    el,
                    range,
                    elHistory: [...history],
                    trend,
                    elRate,
                    timeToMaxEl,
                };

                if (selectedSatelliteId === noradId) {
                    const recentSatData = store.getState().earthViewTrack.satelliteData;
                    dispatch(
                        setSatelliteData({
                            ...recentSatData,
                            position: {
                                lat,
                                lon,
                                alt: altitude * 1000,
                                vel: velocity,
                                az,
                                el,
                            },
                        })
                    );
                }

                if (selectedSatelliteId === noradId) {
                    const paths = getSatellitePaths(
                        [satellite.tle1, satellite.tle2],
                        orbitProjectionDuration,
                        1,
                        noradId
                    );
                    pastPath = Array.isArray(paths.past) ? paths.past : [];
                    futurePath = Array.isArray(paths.future) ? paths.future : [];
                }

                const isVisible = isSatelliteVisible(satellite.tle1, satellite.tle2, now, location);
                const isTracked = trackedSatelliteIds.has(Number(noradId));
                const isSelected = selectedSatelliteId === noradId;

                markers.push({
                    noradId,
                    name: satellite.name,
                    satellite,
                    lat,
                    lon,
                    altitude,
                    velocity,
                    isVisible,
                    isTracked,
                    isSelected,
                    targetNumber: targetNumberByNorad?.[String(noradId)] ?? null,
                });

                if (isTracked) {
                    crosshairLines.push({
                        coordinates: [[-180, lat], [180, lat]],
                    });
                    crosshairLines.push({
                        coordinates: [[lon, -90], [lon, 90]],
                    });
                }

                if (isVisible && showSatelliteCoverage) {
                    const coverage = getSatelliteCoverageCircle(lat, lon, altitude, 360);
                    coverages.push({
                        noradId,
                        coordinates: coverage,
                        selected: isSelected,
                    });
                } else if (isSelected) {
                    const coverage = getSatelliteCoverageCircle(lat, lon, altitude, 360);
                    coverages.push({
                        noradId,
                        coordinates: coverage,
                        selected: true,
                    });
                }
            } catch (error) {
                console.error(`Error while updating earth view map satellite ${satellite?.norad_id}: ${error}`);
            }
        });

        const rawTerminator = createTerminatorLine().reverse();
        const {
            line: terminatorLine,
            polygon: daySidePolygon,
        } = projectTerminatorForMapLibre(rawTerminator);
        const [sunPos, moonPos] = getSunMoonCoords();

        setOverlayData({
            markers,
            pastPath,
            futurePath,
            coverages,
            crosshairLines,
            terminatorLine,
            daySidePolygon,
            sunPos,
            moonPos,
        });
        dispatch(setSelectedSatellitePositions(selectedSatPos));
    }, [
        dispatch,
        location,
        orbitProjectionDuration,
        selectedSatelliteId,
        selectedSatellites,
        showSatelliteCoverage,
        targetNumberByNorad,
        trackedSatelliteIds,
    ]);

    useEffect(() => {
        if (updateTimeRef.current) {
            clearInterval(updateTimeRef.current);
        }
        satelliteUpdate(new Date());
        updateTimeRef.current = setInterval(() => satelliteUpdate(new Date()), 3000);
        return () => {
            clearInterval(updateTimeRef.current);
        };
    }, [satelliteUpdate]);

    const pastPathGeoJSON = useMemo(() => {
        const features = normalizePathSegments(overlayData.pastPath)
            .map((segment) => {
                const coordinates = segment.map(latLonToLngLat).filter(Boolean);
                if (coordinates.length < 2) return null;
                return {
                    type: 'Feature',
                    geometry: {type: 'LineString', coordinates},
                };
            })
            .filter(Boolean);
        if (features.length === 0) return emptyFeatureCollection();
        return {
            type: 'FeatureCollection',
            features,
        };
    }, [overlayData.pastPath]);

    const futurePathGeoJSON = useMemo(() => {
        const features = normalizePathSegments(overlayData.futurePath)
            .map((segment) => {
                const coordinates = segment.map(latLonToLngLat).filter(Boolean);
                if (coordinates.length < 2) return null;
                return {
                    type: 'Feature',
                    geometry: {type: 'LineString', coordinates},
                };
            })
            .filter(Boolean);
        if (features.length === 0) return emptyFeatureCollection();
        return {
            type: 'FeatureCollection',
            features,
        };
    }, [overlayData.futurePath]);

    const coverageGeoJSON = useMemo(() => {
        const features = overlayData.coverages
            .map((coverage) => {
                const coordinates = coverage.coordinates.map(latLonToLngLat).filter(Boolean);
                if (coordinates.length < 3) return null;
                const first = coordinates[0];
                const last = coordinates[coordinates.length - 1];
                if (!last || first[0] !== last[0] || first[1] !== last[1]) {
                    coordinates.push(first);
                }
                return {
                    type: 'Feature',
                    properties: {selected: coverage.selected ? 1 : 0},
                    geometry: {
                        type: 'Polygon',
                        coordinates: [coordinates],
                    },
                };
            })
            .filter(Boolean);
        return {type: 'FeatureCollection', features};
    }, [overlayData.coverages]);

    const crosshairGeoJSON = useMemo(() => {
        const features = overlayData.crosshairLines.map((line) => ({
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: line.coordinates,
            },
        }));
        return {type: 'FeatureCollection', features};
    }, [overlayData.crosshairLines]);

    const terminatorGeoJSON = useMemo(() => {
        const coordinates = overlayData.terminatorLine.map(latLonToLngLat).filter(Boolean);
        if (coordinates.length < 2) return emptyFeatureCollection();
        return {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    geometry: {type: 'LineString', coordinates},
                },
            ],
        };
    }, [overlayData.terminatorLine]);

    const daySideGeoJSON = useMemo(() => {
        const coordinates = overlayData.daySidePolygon.map(latLonToLngLat).filter(Boolean);
        if (coordinates.length < 3) return emptyFeatureCollection();
        return {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    geometry: {type: 'Polygon', coordinates: [coordinates]},
                },
            ],
        };
    }, [overlayData.daySidePolygon]);

    const liveMap = mapRef.current?.getMap();

    const handleCenterHome = () => {
        if (!liveMap || !location) return;
        liveMap.flyTo({center: [location.lon, location.lat], zoom: liveMap.getZoom()});
    };

    const handleCenterMap = () => {
        if (!liveMap) return;
        liveMap.flyTo({center: [0, 0], zoom: liveMap.getZoom()});
    };

    const handleFullscreen = () => {
        const container = liveMap?.getContainer();
        if (!container) return;
        if (!document.fullscreenElement) {
            container.requestFullscreen?.();
        } else {
            document.exitFullscreen?.();
        }
    };

    const handleZoomIn = () => {
        if (!liveMap) return;
        liveMap.easeTo({
            zoom: Math.min(10, liveMap.getZoom() + 0.25),
            duration: 120,
        });
    };

    const handleZoomOut = () => {
        if (!liveMap) return;
        liveMap.easeTo({
            zoom: Math.max(MAPLIBRE_MIN_ZOOM, liveMap.getZoom() - 0.25),
            duration: 120,
        });
    };

    return (
        <Box sx={{height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0}}>
            <TitleBar
                className={getClassNamesBasedOnGridEditing(gridEditable, ['window-title-bar'])}
                sx={islandTitleBarSx}
            >
                <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%'}}>
                    <Typography variant="subtitle2" sx={{fontWeight: 'bold'}}>
                        {t('title')}
                    </Typography>
                    <Tooltip title={t('map_settings.title')}>
                        <span>
                            <IconButton
                                size="small"
                                onClick={handleOpenSettings}
                                sx={{padding: '2px'}}
                            >
                                <SettingsIcon fontSize="small"/>
                            </IconButton>
                        </span>
                    </Tooltip>
                </Box>
            </TitleBar>

            <Box
                sx={{
                    position: 'relative',
                    width: '100%',
                    flex: 1,
                    minHeight: 0,
                    '& .maplibregl-ctrl-attrib, & .maplibregl-ctrl-bottom-right': {
                        display: 'none !important',
                    },
                    // Match Leaflet selected-satellite tooltip style for non-tracked targets.
                    '& .earth-view-maplibre-popup .maplibregl-popup-content': {
                        backgroundColor: theme.palette.background.paper,
                        color: theme.palette.text.primary,
                        border: `1px solid ${theme.palette.background.paper}`,
                        boxShadow: theme.shadows[3],
                        borderRadius: `${theme.shape.borderRadius}px`,
                        whiteSpace: 'nowrap',
                        padding: '6px 8px',
                    },
                    // Match Leaflet tracked-satellite tooltip style.
                    '& .earth-view-maplibre-tracked-popup .maplibregl-popup-content': {
                        backgroundColor: theme.palette.error.dark,
                        color: theme.palette.text.primary,
                        border: `1px solid ${theme.palette.error.main}`,
                        boxShadow: theme.shadows[3],
                        borderRadius: `${theme.shape.borderRadius}px`,
                        whiteSpace: 'nowrap',
                        padding: '6px 8px',
                    },
                    '& .earth-view-maplibre-popup.maplibregl-popup-anchor-top .maplibregl-popup-tip, & .earth-view-maplibre-popup.maplibregl-popup-anchor-top-left .maplibregl-popup-tip, & .earth-view-maplibre-popup.maplibregl-popup-anchor-top-right .maplibregl-popup-tip': {
                        borderBottomColor: `${theme.palette.background.paper} !important`,
                    },
                    '& .earth-view-maplibre-popup.maplibregl-popup-anchor-bottom .maplibregl-popup-tip, & .earth-view-maplibre-popup.maplibregl-popup-anchor-bottom-left .maplibregl-popup-tip, & .earth-view-maplibre-popup.maplibregl-popup-anchor-bottom-right .maplibregl-popup-tip': {
                        borderTopColor: `${theme.palette.background.paper} !important`,
                    },
                    '& .earth-view-maplibre-popup.maplibregl-popup-anchor-left .maplibregl-popup-tip': {
                        borderRightColor: `${theme.palette.background.paper} !important`,
                    },
                    '& .earth-view-maplibre-popup.maplibregl-popup-anchor-right .maplibregl-popup-tip': {
                        borderLeftColor: `${theme.palette.background.paper} !important`,
                    },
                    '& .earth-view-maplibre-tracked-popup.maplibregl-popup-anchor-top .maplibregl-popup-tip, & .earth-view-maplibre-tracked-popup.maplibregl-popup-anchor-top-left .maplibregl-popup-tip, & .earth-view-maplibre-tracked-popup.maplibregl-popup-anchor-top-right .maplibregl-popup-tip': {
                        borderBottomColor: `${theme.palette.error.main} !important`,
                    },
                    '& .earth-view-maplibre-tracked-popup.maplibregl-popup-anchor-bottom .maplibregl-popup-tip, & .earth-view-maplibre-tracked-popup.maplibregl-popup-anchor-bottom-left .maplibregl-popup-tip, & .earth-view-maplibre-tracked-popup.maplibregl-popup-anchor-bottom-right .maplibregl-popup-tip': {
                        borderTopColor: `${theme.palette.error.main} !important`,
                    },
                    '& .earth-view-maplibre-tracked-popup.maplibregl-popup-anchor-left .maplibregl-popup-tip': {
                        borderRightColor: `${theme.palette.error.main} !important`,
                    },
                    '& .earth-view-maplibre-tracked-popup.maplibregl-popup-anchor-right .maplibregl-popup-tip': {
                        borderLeftColor: `${theme.palette.error.main} !important`,
                    },
                }}
            >
                <Backdrop
                    open={loadingSatellites && selectedSatGroupId}
                    sx={{
                        position: 'absolute',
                        zIndex: 1000,
                        backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    }}
                >
                    <CircularProgress size={60} thickness={4}/>
                </Backdrop>

                <Map
                    ref={mapRef}
                    mapLib={maplibregl}
                    mapStyle={mapStyle}
                    attributionControl={false}
                    initialViewState={{longitude: 0, latitude: 0, zoom: mapZoomLevel}}
                    dragPan={enableMapDragging}
                    scrollZoom={enableMapZooming}
                    touchZoomRotate={enableMapZooming}
                    doubleClickZoom={enableMapZooming}
                    keyboard={false}
                    renderWorldCopies={false}
                    transformConstrain={preserveRequestedZoomConstrain}
                    minZoom={MAPLIBRE_MIN_ZOOM}
                    maxZoom={10}
                    onZoomEnd={(event) => handleSetMapZoomLevel(event?.viewState?.zoom ?? mapZoomLevel)}
                    onClick={(event) => {
                        const target = event.originalEvent?.target;
                        if (markerClickInProgressRef.current || isMapLibreOverlayTarget(target)) {
                            markerClickInProgressRef.current = false;
                            return;
                        }
                        if (controlsBoxRef.current?.contains(target) || arrowControlsRef.current?.contains(target)) {
                            return;
                        }
                        dispatch(setSelectedSatelliteId(null));
                    }}
                    style={{width: '100%', height: '100%'}}
                >
                    {showTerminatorLine && daySideGeoJSON.features.length > 0 ? (
                        <Source id="earth-view-maplibre-day-side" type="geojson" data={daySideGeoJSON}>
                            <Layer
                                id="earth-view-maplibre-day-side-fill"
                                type="fill"
                                paint={{
                                    'fill-color': '#000000',
                                    'fill-opacity': 0.4,
                                }}
                            />
                        </Source>
                    ) : null}

                    {showTerminatorLine && terminatorGeoJSON.features.length > 0 ? (
                        <Source id="earth-view-maplibre-terminator" type="geojson" data={terminatorGeoJSON}>
                            <Layer
                                id="earth-view-maplibre-terminator-line"
                                type="line"
                                paint={{
                                    'line-color': '#FFFFFF',
                                    'line-width': 1,
                                    'line-opacity': 0.1,
                                }}
                            />
                        </Source>
                    ) : null}

                    <Source id="earth-view-maplibre-date-line" type="geojson" data={DATE_LINE_GEOJSON}>
                        <Layer
                            id="earth-view-maplibre-date-line-layer"
                            type="line"
                            paint={{
                                'line-color': '#FFFFFF',
                                'line-width': 1,
                                'line-opacity': 0.9,
                                'line-dasharray': [1, 5],
                            }}
                        />
                    </Source>

                    {showPastOrbitPath && pastPathGeoJSON.features.length > 0 ? (
                        <Source id="earth-view-maplibre-past-path" type="geojson" data={pastPathGeoJSON}>
                            <Layer
                                id="earth-view-maplibre-past-path-layer"
                                type="line"
                                paint={{
                                    'line-color': pastOrbitLineColor,
                                    'line-width': 2,
                                    'line-opacity': 0.5,
                                }}
                            />
                        </Source>
                    ) : null}

                    {showFutureOrbitPath && futurePathGeoJSON.features.length > 0 ? (
                        <Source id="earth-view-maplibre-future-path" type="geojson" data={futurePathGeoJSON}>
                            <Layer
                                id="earth-view-maplibre-future-path-layer"
                                type="line"
                                paint={{
                                    'line-color': futureOrbitLineColor,
                                    'line-width': 2,
                                    'line-opacity': 1,
                                    'line-dasharray': [2, 4],
                                }}
                            />
                        </Source>
                    ) : null}

                    {coverageGeoJSON.features.length > 0 ? (
                        <Source id="earth-view-maplibre-coverage" type="geojson" data={coverageGeoJSON}>
                            <Layer
                                id="earth-view-maplibre-coverage-fill"
                                type="fill"
                                paint={{
                                    'fill-color': satelliteCoverageColor,
                                    'fill-opacity': ['case', ['==', ['get', 'selected'], 1], 0.5, 0.1],
                                }}
                            />
                            <Layer
                                id="earth-view-maplibre-coverage-line"
                                type="line"
                                paint={{
                                    'line-color': ['case', ['==', ['get', 'selected'], 1], '#FFFFFF', satelliteCoverageColor],
                                    'line-width': ['case', ['==', ['get', 'selected'], 1], 2, 1],
                                    'line-opacity': 1,
                                    'line-dasharray': [1, 2],
                                }}
                            />
                        </Source>
                    ) : null}

                    {crosshairGeoJSON.features.length > 0 ? (
                        <Source id="earth-view-maplibre-crosshairs" type="geojson" data={crosshairGeoJSON}>
                            <Layer
                                id="earth-view-maplibre-crosshairs-layer"
                                type="line"
                                paint={{
                                    'line-color': theme.palette.error.main,
                                    'line-width': 1,
                                    'line-opacity': 1,
                                }}
                            />
                        </Source>
                    ) : null}

                    {showGrid ? (
                        <Source id="earth-view-maplibre-grid" type="geojson" data={gridGeoJSON}>
                            <Layer
                                id="earth-view-maplibre-grid-layer"
                                type="line"
                                paint={{
                                    'line-color': '#FFFFFF',
                                    'line-width': 1,
                                    'line-opacity': 0.5,
                                    'line-dasharray': [1, 5],
                                }}
                            />
                        </Source>
                    ) : null}

                    {location && location.lat != null && location.lon != null ? (
                        <Marker longitude={location.lon} latitude={location.lat} anchor="center">
                            <img src={homeIcon.options.iconUrl} alt="Home" style={{width: 20, height: 20, opacity: 0.8}}/>
                        </Marker>
                    ) : null}

                    {showSunIcon && Array.isArray(overlayData.sunPos) ? (
                        <Marker longitude={overlayData.sunPos[1]} latitude={overlayData.sunPos[0]} anchor="center">
                            <img src={sunIcon.options.iconUrl} alt="Sun" style={{width: 28, height: 28, opacity: 0.6}}/>
                        </Marker>
                    ) : null}

                    {showMoonIcon && Array.isArray(overlayData.moonPos) ? (
                        <Marker longitude={overlayData.moonPos[1]} latitude={overlayData.moonPos[0]} anchor="center">
                            <img src={moonIcon.options.iconUrl} alt="Moon" style={{width: 28, height: 28, opacity: 0.6}}/>
                        </Marker>
                    ) : null}

                    {overlayData.markers.map((marker) => {
                        const shouldShowPopup = showTooltip || marker.isSelected || marker.isTracked;
                        const visibleMarkerBorderColor = marker.isTracked ? theme.palette.error.main : '#e0f2fe';
                        const handleMarkerContextMenu = (event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            event.nativeEvent?.preventDefault?.();
                            event.nativeEvent?.stopPropagation?.();
                            if (typeof onSatelliteMarkerContextMenu !== 'function') {
                                return;
                            }
                            onSatelliteMarkerContextMenu(
                                marker.satellite || { norad_id: marker.noradId, name: marker.name },
                                event,
                            );
                        };

                        return (
                            <React.Fragment key={`earth-view-maplibre-marker-${marker.noradId}`}>
                                {marker.isTracked ? (
                                    <Marker
                                        longitude={marker.lon}
                                        latitude={marker.lat}
                                        anchor="center"
                                        style={{pointerEvents: 'none'}}
                                    >
                                        <div
                                            style={{
                                                width: 30,
                                                height: 30,
                                                border: `2px solid ${theme.palette.error.main}`,
                                                opacity: 0.8,
                                                boxSizing: 'border-box',
                                                pointerEvents: 'none',
                                            }}
                                        />
                                    </Marker>
                                ) : null}
                                <Marker
                                    longitude={marker.lon}
                                    latitude={marker.lat}
                                    anchor="center"
                                    style={{cursor: 'pointer'}}
                                    onClick={(event) => {
                                        markerClickInProgressRef.current = true;
                                        event.preventDefault?.();
                                        event.originalEvent?.stopPropagation();
                                        event.originalEvent?.preventDefault?.();
                                        dispatch(setSelectedSatelliteId(marker.noradId));
                                        setTimeout(() => {
                                            markerClickInProgressRef.current = false;
                                        }, 0);
                                    }}
                                >
                                    {marker.isVisible ? (
                                        <div
                                            style={{
                                                width: 12,
                                                height: 12,
                                                background: '#38bdf8',
                                                border: `1px solid ${visibleMarkerBorderColor}`,
                                                transform: 'rotate(45deg)',
                                                cursor: 'pointer',
                                                boxShadow: marker.isTracked
                                                    ? `0 0 0 1px ${theme.palette.error.main}`
                                                    : '0 0 0 1px rgba(0,0,0,0.45)',
                                                userSelect: 'none',
                                                WebkitUserSelect: 'none',
                                            }}
                                            onContextMenu={handleMarkerContextMenu}
                                            onTouchStart={(e) => e.preventDefault()}
                                        />
                                    ) : (
                                        <div
                                            style={{
                                                width: 20,
                                                height: 20,
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                cursor: 'pointer',
                                                userSelect: 'none',
                                                WebkitUserSelect: 'none',
                                            }}
                                            onContextMenu={handleMarkerContextMenu}
                                            onTouchStart={(e) => e.preventDefault()}
                                        >
                                            <div
                                                style={{
                                                    width: 10,
                                                    height: 10,
                                                    borderRadius: '50%',
                                                    background: '#38bdf8',
                                                    border: '1px solid #e0f2fe',
                                                    cursor: 'pointer',
                                                    boxShadow: '0 0 0 1px rgba(0,0,0,0.45), 0 0 5px rgba(56,189,248,0.45)',
                                                }}
                                            />
                                        </div>
                                    )}
                                </Marker>

                                {shouldShowPopup ? (
                                    <MapLibreSatellitePopup
                                        map={liveMap}
                                        popupId={marker.noradId}
                                        longitude={marker.lon}
                                        latitude={marker.lat}
                                        className={marker.isTracked ? 'earth-view-maplibre-tracked-popup' : 'earth-view-maplibre-popup'}
                                    >
                                        <Box sx={{display: 'flex', flexDirection: 'column', gap: 0.5}}>
                                            <strong>
                                                {marker.isTracked ? (
                                                    <TargetNumberIcon
                                                        targetNumber={marker.targetNumber}
                                                        prefix="T"
                                                        size={15}
                                                        sx={{mr: 0.7, verticalAlign: 'middle', position: 'relative', top: -1}}
                                                    />
                                                ) : null}
                                                {marker.name} - {parseInt(marker.altitude)} km, {marker.velocity.toFixed(2)} km/s
                                            </strong>
                                            {marker.isSelected && !marker.isTracked ? (
                                                <Box sx={{display: 'flex', gap: 0.5, alignItems: 'center'}}>
                                                    <Button
                                                        size="small"
                                                        variant="contained"
                                                        color="primary"
                                                        startIcon={<TrackChangesIcon/>}
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            handleSetTrackingOnBackend?.({
                                                                noradId: marker.noradId,
                                                                satelliteName: marker.name,
                                                            });
                                                        }}
                                                        sx={{
                                                            fontSize: '0.7rem',
                                                            py: 0.3,
                                                            px: 1,
                                                            flex: 1,
                                                        }}
                                                    >
                                                        {t('map_target.set_target')}
                                                    </Button>
                                                    <IconButton
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            navigate(`/satellites/${marker.noradId}`);
                                                        }}
                                                        sx={{
                                                            backgroundColor: 'action.hover',
                                                            '&:hover': {
                                                                backgroundColor: 'action.selected',
                                                            },
                                                            padding: '4px',
                                                        }}
                                                        size="small"
                                                        title={t('map_target.view_details')}
                                                    >
                                                        <InfoIcon fontSize="small"/>
                                                    </IconButton>
                                                </Box>
                                            ) : null}
                                        </Box>
                                    </MapLibreSatellitePopup>
                                ) : null}
                            </React.Fragment>
                        );
                    })}
                </Map>

                <Box
                    ref={controlsBoxRef}
                    sx={{'& > :not(style)': {m: 1}}}
                    style={{right: 5, top: 5, position: 'absolute'}}
                >
                    <Fab size="small" color="primary" aria-label={t('map_controls.go_home')} onClick={handleCenterHome} disabled={!location}>
                        <HomeIcon/>
                    </Fab>
                    <Fab size="small" color="primary" aria-label={t('map_controls.go_to_center')} onClick={handleCenterMap}>
                        <FilterCenterFocusIcon/>
                    </Fab>
                    <Fab size="small" color="primary" aria-label={t('map_controls.go_fullscreen')} onClick={handleFullscreen}>
                        <FullscreenIcon/>
                    </Fab>
                </Box>

                {!enableMapZooming ? (
                    <Box
                        sx={{'& > :not(style)': {m: 1}, display: 'flex', flexDirection: 'column'}}
                        style={{left: 5, top: 5, position: 'absolute'}}
                    >
                        <Fab size="small" color="primary" aria-label={t('map_controls.zoom_in', {defaultValue: 'Zoom in'})} onClick={handleZoomIn}>
                            <ZoomInIcon/>
                        </Fab>
                        <Fab size="small" color="primary" aria-label={t('map_controls.zoom_out', {defaultValue: 'Zoom out'})} onClick={handleZoomOut}>
                            <ZoomOutIcon/>
                        </Fab>
                    </Box>
                ) : null}

                <MapSettingsIslandDialog
                    updateBackend={() => {
                        const key = 'earth-view-map-settings';
                        dispatch(setEarthViewMapSetting({socket, key}));
                    }}
                />

                {!enableMapDragging ? (
                    <div ref={arrowControlsRef}>
                        {liveMap ? <MapArrowControls mapObject={liveMap} verticalOffset={25}/> : null}
                    </div>
                ) : null}
            </Box>
            <EarthViewAttributionBar htmlString={attributionHtml}/>
        </Box>
    );
};

export default MapLibreEarthViewMapRenderer;
