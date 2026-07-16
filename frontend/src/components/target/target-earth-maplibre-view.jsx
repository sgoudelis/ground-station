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
import {Box, Fab, Tooltip, IconButton, Typography, useTheme} from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FilterCenterFocusIcon from '@mui/icons-material/FilterCenterFocus';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import SettingsIcon from '@mui/icons-material/Settings';
import {useDispatch, useSelector} from 'react-redux';
import {useTranslation} from 'react-i18next';
import {
    setOpenMapSettingsDialog,
    setMapZoomLevel,
    setTargetMapSetting,
} from './target-slice.jsx';
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
    humanizeAltitude,
    humanizeVelocity,
    islandTitleBarSx,
} from '../common/common.jsx';
import TargetNumberIcon from '../common/target-number-icon.jsx';
import TargetMapSettingsDialog from './target-map-settings-dialog.jsx';
import createTerminatorLine from '../common/terminator-line.jsx';
import {getSunMoonCoords} from '../common/sunmoon.jsx';
import {useSocket} from '../common/socket.jsx';
import {resolveDynamicOrbitPathSegments} from '../common/orbit-path-dynamic-split.js';
import {
    satelliteCoverageSelector,
    satelliteDetailsSelector,
    satellitePathsSelector,
    satellitePositionSelector,
} from './state-selectors.jsx';
import {pickTooltipDirection} from '../common/tooltip-orientation.js';

const storageMapZoomValueKey = 'target-map-zoom-level';
const TARGET_SLOT_ID_PATTERN = /^target-(\d+)$/;
const MAPLIBRE_MIN_ZOOM = -6;
const MAPLIBRE_PROJECTION_MERCATOR = 'mercator';
const MAPLIBRE_PROJECTION_GLOBE = 'globe';
const MAPLIBRE_TOOLTIP_DIRECTIONS = Object.freeze(['bottom', 'right', 'left', 'top']);
const MAPLIBRE_TOOLTIP_DEFAULT_SIZE = Object.freeze({width: 220, height: 48});
const MAPLIBRE_TOOLTIP_ANCHOR_DISTANCE = 15;
const MAPLIBRE_TOOLTIP_EDGE_PADDING = 10;
const MAPLIBRE_LOCK_ON_COVERAGE_PADDING = Object.freeze({
    top: 40,
    right: 40,
    bottom: 72,
    left: 40,
});
const MAPLIBRE_GLOBE_LOCK_ON_COVERAGE_PADDING = Object.freeze({
    top: 48,
    right: 48,
    bottom: 88,
    left: 48,
});
const MAPLIBRE_MAX_FIT_BOUNDS_LAT = 85.051129;
const MAPLIBRE_GLOBE_TRACK_DURATION_MS = 280;
// MapLibre anchor names describe the popup side attached to the point, so they are inverse
// of Leaflet's tooltip direction names (which describe where the tooltip appears).
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

function normalizeCoveragePoint(point) {
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

    // Reject malformed coverage coordinates before they reach maplibre's LngLat/LngLatBounds constructors.
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (lat < -90 || lat > 90) return null;

    return [lat, lon];
}

function clampFitBoundsLatitude(latitude) {
    return Math.max(-MAPLIBRE_MAX_FIT_BOUNDS_LAT, Math.min(MAPLIBRE_MAX_FIT_BOUNDS_LAT, latitude));
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

const TargetAttributionBar = React.memo(function TargetAttributionBar({htmlString}) {
    return (
        <MapStatusBar>
            <SimpleTruncatedHtml className={'attribution'} htmlString={htmlString}/>
        </MapStatusBar>
    );
});

const TargetEarthMapLibreView = ({projection = MAPLIBRE_PROJECTION_MERCATOR, effectiveMapEngine = null}) => {
    const {socket} = useSocket();
    const dispatch = useDispatch();
    const {t} = useTranslation('target');
    const theme = useTheme();
    const isGlobeProjection = projection === MAPLIBRE_PROJECTION_GLOBE;
    const {
        trackerId,
        lockOnTarget,
        showPastOrbitPath,
        showFutureOrbitPath,
        showSatelliteCoverage,
        showSunIcon,
        showMoonIcon,
        showTerminatorLine,
        showTooltip,
        pastOrbitLineColor,
        futureOrbitLineColor,
        satelliteCoverageColor,
        tileLayerID,
        mapEngine,
        mapZoomLevel,
        gridEditable,
        showGrid,
        enableMapDragging,
        enableMapZooming,
    } = useSelector((state) => state.targetSatTrack);

    const satellitePosition = useSelector(satellitePositionSelector);
    const satelliteCoverage = useSelector(satelliteCoverageSelector);
    const satelliteDetails = useSelector(satelliteDetailsSelector);
    const satellitePaths = useSelector(satellitePathsSelector);
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
    const {location} = useSelector((state) => state.location);

    const mapRef = useRef(null);
    const mapViewportRef = useRef(null);
    const popupRef = useRef(null);
    const normalizedMapEngine = useMemo(
        () => normalizeMapEngine(effectiveMapEngine || mapEngine),
        [effectiveMapEngine, mapEngine]
    );

    const targetNumber = useMemo(() => {
        const activeTrackerInstance = trackerInstances.find((instance) => instance?.tracker_id === trackerId) || null;
        const instanceTargetNumber = Number(activeTrackerInstance?.target_number);
        if (Number.isFinite(instanceTargetNumber) && instanceTargetNumber > 0) {
            return instanceTargetNumber;
        }
        const trackerSlotMatch = String(trackerId || '').match(TARGET_SLOT_ID_PATTERN);
        if (trackerSlotMatch) {
            const parsedTargetNumber = Number(trackerSlotMatch[1]);
            if (Number.isFinite(parsedTargetNumber) && parsedTargetNumber > 0) {
                return parsedTargetNumber;
            }
        }
        return null;
    }, [trackerId, trackerInstances]);

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

    const [skyState, setSkyState] = useState({
        terminatorLine: [],
        daySidePolygon: [],
        sunPos: null,
        moonPos: null,
    });

    useEffect(() => {
        const update = () => {
            const rawTerminator = createTerminatorLine().reverse();
            const {
                line: terminatorLine,
                polygon: daySidePolygon,
            } = projectTerminatorForMapLibre(rawTerminator);
            const [sunPos, moonPos] = getSunMoonCoords();
            setSkyState({
                terminatorLine,
                daySidePolygon,
                sunPos,
                moonPos,
            });
        };
        update();
        const intervalId = setInterval(update, 3000);
        return () => clearInterval(intervalId);
    }, []);

    const gridGeoJSON = useMemo(() => buildGridGeoJSON(15, 15), []);

    const dynamicOrbitPaths = useMemo(
        () => resolveDynamicOrbitPathSegments({
            pastPath: satellitePaths?.past,
            futurePath: satellitePaths?.future,
            satellitePosition,
        }),
        [satellitePaths?.future, satellitePaths?.past, satellitePosition]
    );

    const pastPathGeoJSON = useMemo(() => {
        const features = normalizePathSegments(dynamicOrbitPaths.past)
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
    }, [dynamicOrbitPaths.past]);

    const futurePathGeoJSON = useMemo(() => {
        const features = normalizePathSegments(dynamicOrbitPaths.future)
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
    }, [dynamicOrbitPaths.future]);

    const coverageGeoJSON = useMemo(() => {
        const coveragePoints = Array.isArray(satelliteCoverage)
            ? satelliteCoverage.map(normalizeCoveragePoint).filter(Boolean)
            : [];
        if (coveragePoints.length < 3) return emptyFeatureCollection();
        const coordinates = coveragePoints.map(latLonToLngLat).filter(Boolean);
        const first = coordinates[0];
        const last = coordinates[coordinates.length - 1];
        if (!last || first[0] !== last[0] || first[1] !== last[1]) {
            coordinates.push(first);
        }
        return {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: {
                    type: 'Polygon',
                    coordinates: [coordinates],
                },
            }],
        };
    }, [satelliteCoverage]);

    const crosshairGeoJSON = useMemo(() => {
        const lat = Number(satellitePosition?.lat);
        const lon = Number(satellitePosition?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return emptyFeatureCollection();
        return {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    geometry: {type: 'LineString', coordinates: [[-180, lat], [180, lat]]},
                },
                {
                    type: 'Feature',
                    geometry: {type: 'LineString', coordinates: [[lon, -90], [lon, 90]]},
                },
            ],
        };
    }, [satellitePosition?.lat, satellitePosition?.lon]);

    const terminatorGeoJSON = useMemo(() => {
        const coordinates = skyState.terminatorLine.map(latLonToLngLat).filter(Boolean);
        if (coordinates.length < 2) return emptyFeatureCollection();
        return {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: {type: 'LineString', coordinates},
            }],
        };
    }, [skyState.terminatorLine]);

    const daySideGeoJSON = useMemo(() => {
        const coordinates = skyState.daySidePolygon.map(latLonToLngLat).filter(Boolean);
        if (coordinates.length < 3) return emptyFeatureCollection();
        return {
            type: 'FeatureCollection',
            features: [{
                type: 'Feature',
                geometry: {type: 'Polygon', coordinates: [coordinates]},
            }],
        };
    }, [skyState.daySidePolygon]);

    const satelliteLat = Number(satellitePosition?.lat);
    const satelliteLon = Number(satellitePosition?.lon);
    const hasSatellitePosition = Number.isFinite(satelliteLat) && Number.isFinite(satelliteLon);
    const liveMap = mapRef.current?.getMap();
    const [tooltipDirection, setTooltipDirection] = useState(MAPLIBRE_TOOLTIP_DIRECTIONS[0]);

    useEffect(() => {
        if (!liveMap || typeof liveMap.setProjection !== 'function') {
            return;
        }
        liveMap.setProjection({type: isGlobeProjection ? MAPLIBRE_PROJECTION_GLOBE : MAPLIBRE_PROJECTION_MERCATOR});
        if (isGlobeProjection) {
            liveMap.setPitch?.(0);
            liveMap.setBearing?.(0);
        }
    }, [isGlobeProjection, liveMap]);

    useEffect(() => {
        if (!liveMap || !lockOnTarget) return;
        const lat = Number(satellitePosition?.lat);
        const lon = Number(satellitePosition?.lon);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

        const coveragePoints = Array.isArray(satelliteCoverage)
            ? satelliteCoverage.map(normalizeCoveragePoint).filter(Boolean)
            : [];

        if (showSatelliteCoverage && coveragePoints.length > 1) {
            // Keep fitBounds away from the mercator poles to avoid invalid camera math.
            const fitBoundsPoints = coveragePoints
                .map(([coverageLat, coverageLon]) => [Number(coverageLon), clampFitBoundsLatitude(Number(coverageLat))])
                .filter(([coverageLon, coverageLat]) => Number.isFinite(coverageLon) && Number.isFinite(coverageLat));

            if (fitBoundsPoints.length > 1) {
                try {
                    const bounds = fitBoundsPoints.reduce(
                        (acc, point) => acc.extend(point),
                        new maplibregl.LngLatBounds(fitBoundsPoints[0], fitBoundsPoints[0])
                    );
                    // Keep a visible margin around the footprint and bias it slightly upward.
                    liveMap.fitBounds(bounds, {
                        padding: isGlobeProjection ? MAPLIBRE_GLOBE_LOCK_ON_COVERAGE_PADDING : MAPLIBRE_LOCK_ON_COVERAGE_PADDING,
                        animate: isGlobeProjection,
                        duration: isGlobeProjection ? MAPLIBRE_GLOBE_TRACK_DURATION_MS : 0,
                    });
                    return;
                } catch (error) {
                    console.warn('Target map coverage fitBounds skipped due to invalid bounds:', error);
                }
            }
        }

        if (isGlobeProjection) {
            liveMap.easeTo({
                center: [lon, lat],
                zoom: liveMap.getZoom(),
                duration: MAPLIBRE_GLOBE_TRACK_DURATION_MS,
                easing: (timeFraction) => timeFraction,
            });
            return;
        }

        liveMap.flyTo({center: [lon, lat], zoom: liveMap.getZoom(), animate: false});
    }, [isGlobeProjection, liveMap, lockOnTarget, satelliteCoverage, satellitePosition?.lat, satellitePosition?.lon, showSatelliteCoverage]);

    useEffect(() => {
        if (!liveMap) return undefined;
        const handleFullscreenChange = () => {
            requestAnimationFrame(() => {
                liveMap.resize?.();
            });
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        };
    }, [liveMap]);

    const updateTooltipOrientation = useCallback(() => {
        if (!liveMap || !showTooltip || !hasSatellitePosition) return;
        const projectedPoint = liveMap.project([satelliteLon, satelliteLat]);
        const mapCanvas = liveMap.getCanvas();
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
    }, [hasSatellitePosition, liveMap, satelliteLat, satelliteLon, showTooltip]);

    useEffect(() => {
        if (!liveMap || !showTooltip || !hasSatellitePosition) return undefined;
        let animationFrameId = requestAnimationFrame(updateTooltipOrientation);
        const scheduleUpdate = () => {
            cancelAnimationFrame(animationFrameId);
            animationFrameId = requestAnimationFrame(updateTooltipOrientation);
        };

        liveMap.on('moveend', scheduleUpdate);
        liveMap.on('zoomend', scheduleUpdate);
        liveMap.on('resize', scheduleUpdate);
        return () => {
            cancelAnimationFrame(animationFrameId);
            liveMap.off('moveend', scheduleUpdate);
            liveMap.off('zoomend', scheduleUpdate);
            liveMap.off('resize', scheduleUpdate);
        };
    }, [hasSatellitePosition, liveMap, showTooltip, updateTooltipOrientation]);

    useEffect(() => {
        if (!showTooltip || !hasSatellitePosition) {
            setTooltipDirection(MAPLIBRE_TOOLTIP_DIRECTIONS[0]);
            return;
        }
        const animationFrameId = requestAnimationFrame(updateTooltipOrientation);
        return () => cancelAnimationFrame(animationFrameId);
    }, [hasSatellitePosition, showTooltip, updateTooltipOrientation]);

    const tooltipAnchor = MAPLIBRE_ANCHOR_BY_TOOLTIP_DIRECTION[tooltipDirection] || 'top';

    const handleCenterHome = () => {
        if (!liveMap || !location) return;
        liveMap.flyTo({center: [location.lon, location.lat], zoom: liveMap.getZoom()});
    };

    const handleCenterMap = () => {
        if (!liveMap) return;
        liveMap.flyTo({center: [0, 0], zoom: liveMap.getZoom()});
    };

    const handleFullscreen = () => {
        const fullscreenTarget = mapViewportRef.current || liveMap?.getContainer();
        if (!fullscreenTarget) return;
        if (!document.fullscreenElement) {
            fullscreenTarget.requestFullscreen?.();
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

    const handleOpenSettings = useCallback(() => {
        dispatch(setOpenMapSettingsDialog(true));
    }, [dispatch]);

    const humanizedAltitude = humanizeAltitude(satellitePosition?.alt, 0);
    const altitudeLabel = humanizedAltitude === 'Invalid altitude'
        ? '-- km'
        : `${humanizedAltitude} km`;
    const humanizedVelocity = humanizeVelocity(satellitePosition?.vel, 2);
    const velocityLabel = humanizedVelocity === 'Invalid velocity'
        ? '-- km/s'
        : `${humanizedVelocity} km/s`;

    return (
        <Box sx={{height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0}}>
            <TitleBar
                className={getClassNamesBasedOnGridEditing(gridEditable, ['window-title-bar'])}
                sx={islandTitleBarSx}
            >
                <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%'}}>
                    <Typography variant="subtitle2" sx={{fontWeight: 'bold'}}>
                        {t('satellite_map.title')}
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
                ref={mapViewportRef}
                sx={{
                    width: '100%',
                    flex: 1,
                    minHeight: 0,
                    position: 'relative',
                    '& .maplibregl-ctrl-attrib, & .maplibregl-ctrl-bottom-right': {
                        display: 'none !important',
                    },
                    '& .target-maplibre-popup .maplibregl-popup-content': {
                        backgroundColor: theme.palette.error.dark,
                        color: theme.palette.text.primary,
                        border: `1px solid ${theme.palette.error.main}`,
                        boxShadow: theme.shadows[3],
                        borderRadius: `${theme.shape.borderRadius}px`,
                        whiteSpace: 'nowrap',
                        padding: '6px 8px',
                    },
                    '& .target-maplibre-popup.maplibregl-popup-anchor-top .maplibregl-popup-tip, & .target-maplibre-popup.maplibregl-popup-anchor-top-left .maplibregl-popup-tip, & .target-maplibre-popup.maplibregl-popup-anchor-top-right .maplibregl-popup-tip': {
                        borderBottomColor: `${theme.palette.error.main} !important`,
                    },
                    '& .target-maplibre-popup.maplibregl-popup-anchor-bottom .maplibregl-popup-tip, & .target-maplibre-popup.maplibregl-popup-anchor-bottom-left .maplibregl-popup-tip, & .target-maplibre-popup.maplibregl-popup-anchor-bottom-right .maplibregl-popup-tip': {
                        borderTopColor: `${theme.palette.error.main} !important`,
                    },
                    '& .target-maplibre-popup.maplibregl-popup-anchor-left .maplibregl-popup-tip': {
                        borderRightColor: `${theme.palette.error.main} !important`,
                    },
                    '& .target-maplibre-popup.maplibregl-popup-anchor-right .maplibregl-popup-tip': {
                        borderLeftColor: `${theme.palette.error.main} !important`,
                    },
                }}
            >
                <Map
                    ref={mapRef}
                    mapLib={maplibregl}
                    mapStyle={mapStyle}
                    attributionControl={false}
                    projection={projection}
                    initialViewState={{
                        longitude: hasSatellitePosition ? satelliteLon : 0,
                        latitude: hasSatellitePosition ? satelliteLat : 0,
                        zoom: mapZoomLevel,
                    }}
                    dragPan={enableMapDragging}
                    scrollZoom={enableMapZooming}
                    touchZoomRotate={enableMapZooming}
                    doubleClickZoom={enableMapZooming}
                    keyboard={false}
                    renderWorldCopies={false}
                    minZoom={MAPLIBRE_MIN_ZOOM}
                    maxZoom={10}
                    onZoomEnd={(event) => {
                        const zoom = event?.viewState?.zoom ?? mapZoomLevel;
                        dispatch(setMapZoomLevel(zoom));
                        localStorage.setItem(storageMapZoomValueKey, zoom);
                    }}
                    style={{width: '100%', height: '100%'}}
                >
                    {showTerminatorLine && daySideGeoJSON.features.length > 0 ? (
                        <Source id="target-maplibre-day-side" type="geojson" data={daySideGeoJSON}>
                            <Layer
                                id="target-maplibre-day-side-fill"
                                type="fill"
                                paint={{
                                    'fill-color': '#000000',
                                    'fill-opacity': 0.4,
                                }}
                            />
                        </Source>
                    ) : null}

                    {showTerminatorLine && terminatorGeoJSON.features.length > 0 ? (
                        <Source id="target-maplibre-terminator" type="geojson" data={terminatorGeoJSON}>
                            <Layer
                                id="target-maplibre-terminator-line"
                                type="line"
                                paint={{
                                    'line-color': '#FFFFFF',
                                    'line-width': 1,
                                    'line-opacity': 0.1,
                                }}
                            />
                        </Source>
                    ) : null}

                    <Source id="target-maplibre-date-line" type="geojson" data={DATE_LINE_GEOJSON}>
                        <Layer
                            id="target-maplibre-date-line-layer"
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
                        <Source id="target-maplibre-past-path" type="geojson" data={pastPathGeoJSON}>
                            <Layer
                                id="target-maplibre-past-path-layer"
                                type="line"
                                paint={{
                                    'line-color': pastOrbitLineColor,
                                    'line-width': 2,
                                    'line-opacity': 1,
                                }}
                            />
                        </Source>
                    ) : null}

                    {showFutureOrbitPath && futurePathGeoJSON.features.length > 0 ? (
                        <Source id="target-maplibre-future-path" type="geojson" data={futurePathGeoJSON}>
                            <Layer
                                id="target-maplibre-future-path-layer"
                                type="line"
                                layout={{
                                    'line-cap': 'round',
                                    'line-join': 'round',
                                }}
                                paint={{
                                    'line-color': futureOrbitLineColor,
                                    'line-width': 2,
                                    'line-opacity': 0.8,
                                    'line-dasharray': [0.1, 2.4],
                                }}
                            />
                        </Source>
                    ) : null}

                    {showSatelliteCoverage && coverageGeoJSON.features.length > 0 ? (
                        <Source id="target-maplibre-coverage" type="geojson" data={coverageGeoJSON}>
                            <Layer
                                id="target-maplibre-coverage-fill"
                                type="fill"
                                paint={{
                                    'fill-color': satelliteCoverageColor,
                                    'fill-opacity': 0.2,
                                }}
                            />
                            <Layer
                                id="target-maplibre-coverage-line"
                                type="line"
                                paint={{
                                    'line-color': satelliteCoverageColor,
                                    'line-width': 1,
                                    'line-opacity': 1,
                                }}
                            />
                        </Source>
                    ) : null}

                    {crosshairGeoJSON.features.length > 0 ? (
                        <Source id="target-maplibre-crosshairs" type="geojson" data={crosshairGeoJSON}>
                            <Layer
                                id="target-maplibre-crosshairs-layer"
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
                        <Source id="target-maplibre-grid" type="geojson" data={gridGeoJSON}>
                            <Layer
                                id="target-maplibre-grid-layer"
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

                    {showSunIcon && Array.isArray(skyState.sunPos) ? (
                        <Marker longitude={skyState.sunPos[1]} latitude={skyState.sunPos[0]} anchor="center">
                            <img src={sunIcon.options.iconUrl} alt="Sun" style={{width: 28, height: 28, opacity: 0.6}}/>
                        </Marker>
                    ) : null}

                    {showMoonIcon && Array.isArray(skyState.moonPos) ? (
                        <Marker longitude={skyState.moonPos[1]} latitude={skyState.moonPos[0]} anchor="center">
                            <img src={moonIcon.options.iconUrl} alt="Moon" style={{width: 28, height: 28, opacity: 0.6}}/>
                        </Marker>
                    ) : null}

                    {hasSatellitePosition ? (
                        <Marker longitude={satelliteLon} latitude={satelliteLat} anchor="center">
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

                    {hasSatellitePosition ? (
                        <Marker longitude={satelliteLon} latitude={satelliteLat} anchor="center">
                            <div
                            style={{
                                width: 12,
                                height: 12,
                                background: '#38bdf8',
                                border: `1px solid ${theme.palette.error.main}`,
                                transform: 'rotate(45deg)',
                                boxShadow: `0 0 0 1px ${theme.palette.error.main}`,
                            }}
                        />
                    </Marker>
                ) : null}

                    {showTooltip && hasSatellitePosition ? (
                        <Popup
                            ref={popupRef}
                            key={`target-maplibre-popup-${tooltipDirection}`}
                            longitude={satelliteLon}
                            latitude={satelliteLat}
                            maxWidth="none"
                            closeButton={false}
                            closeOnClick={false}
                            anchor={tooltipAnchor}
                            offset={MAPLIBRE_TOOLTIP_ANCHOR_DISTANCE}
                            className="target-maplibre-popup"
                        >
                            <strong>
                                {targetNumber != null ? (
                                    <TargetNumberIcon
                                        targetNumber={targetNumber}
                                        prefix="T"
                                        size={15}
                                        sx={{mr: 0.7, verticalAlign: 'middle', position: 'relative', top: -1}}
                                    />
                                ) : null}
                                {satelliteDetails?.name || '-'} - {altitudeLabel}, {velocityLabel}
                            </strong>
                        </Popup>
                    ) : null}
                </Map>

                <Box sx={{'& > :not(style)': {m: 1}}} style={{right: 5, top: 5, position: 'absolute'}}>
                    <Tooltip title={t('map_controls.go_home', {defaultValue: 'Go home'})}>
                        <span>
                            <Fab size="small" color="primary" aria-label={t('map_controls.go_home')} onClick={handleCenterHome} disabled={!location}>
                                <HomeIcon/>
                            </Fab>
                        </span>
                    </Tooltip>
                    <Tooltip title={t('map_controls.go_to_center', {defaultValue: 'Go to center'})}>
                        <span>
                            <Fab size="small" color="primary" aria-label={t('map_controls.go_to_center')} onClick={handleCenterMap}>
                                <FilterCenterFocusIcon/>
                            </Fab>
                        </span>
                    </Tooltip>
                    <Tooltip title={t('map_controls.go_fullscreen', {defaultValue: 'Go fullscreen'})}>
                        <span>
                            <Fab size="small" color="primary" aria-label={t('map_controls.go_fullscreen')} onClick={handleFullscreen}>
                                <FullscreenIcon/>
                            </Fab>
                        </span>
                    </Tooltip>
                </Box>

                {!enableMapZooming ? (
                    <Box
                        sx={{'& > :not(style)': {m: 1}, display: 'flex', flexDirection: 'column'}}
                        style={{left: 5, top: 5, position: 'absolute'}}
                    >
                        <Tooltip title={t('map_controls.zoom_in', {defaultValue: 'Zoom in'})}>
                            <span>
                                <Fab size="small" color="primary" aria-label={t('map_controls.zoom_in', {defaultValue: 'Zoom in'})} onClick={handleZoomIn}>
                                    <ZoomInIcon/>
                                </Fab>
                            </span>
                        </Tooltip>
                        <Tooltip title={t('map_controls.zoom_out', {defaultValue: 'Zoom out'})}>
                            <span>
                                <Fab size="small" color="primary" aria-label={t('map_controls.zoom_out', {defaultValue: 'Zoom out'})} onClick={handleZoomOut}>
                                    <ZoomOutIcon/>
                                </Fab>
                            </span>
                        </Tooltip>
                    </Box>
                ) : null}

                <TargetMapSettingsDialog updateBackend={() => {
                    const key = 'target-map-settings';
                    dispatch(setTargetMapSetting({socket, key}));
                }}/>

                {!enableMapDragging && liveMap ? <MapArrowControls mapObject={liveMap} verticalOffset={25}/> : null}
            </Box>
            <TargetAttributionBar htmlString={attributionHtml}/>
        </Box>
    );
};

export default TargetEarthMapLibreView;
