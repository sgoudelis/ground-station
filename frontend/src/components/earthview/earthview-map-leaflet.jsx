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
import {
    MapContainer,
    TileLayer,
    WMSTileLayer,
    Marker,
    Polyline,
    Polygon,
    CircleMarker,
    Rectangle,
    useMapEvents,
} from 'react-leaflet';
import L from 'leaflet';
import {Box, Fab, useTheme, Typography, Tooltip, IconButton} from '@mui/material';
import HomeIcon from '@mui/icons-material/Home';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FilterCenterFocusIcon from '@mui/icons-material/FilterCenterFocus';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import SettingsIcon from '@mui/icons-material/Settings';
import {useDispatch, useSelector} from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
    setOpenMapSettingsDialog,
    setMapZoomLevel,
    setSelectedSatelliteId,
    setSelectedSatellitePositions,
    setEarthViewMapSetting,
} from './earthview-slice.jsx';
import {getMapCrsByTileLayerId, getTileLayerById, normalizeMapEngine} from '../common/tile-layers.jsx';
import {homeIcon, satelliteIcon2, moonIcon, sunIcon} from '../common/dataurl-icons.jsx';
import {
    TitleBar,
    MapStatusBar,
    InternationalDateLinePolyline,
    MapArrowControls,
    SimpleTruncatedHtml,
    getClassNamesBasedOnGridEditing,
    islandTitleBarSx,
} from '../common/common.jsx';
import MapSettingsIslandDialog from './map-settings-dialog.jsx';
import CoordinateGrid from '../common/mercator-grid.jsx';
import SatelliteTrackSuggestion from './map-target-button.jsx';
import {
    calculateSatelliteAzEl,
    calculateTimeToMaxElevation,
    getSatelliteCoverageCircle,
    getSatelliteLatLon,
    getSatellitePaths,
    isSatelliteVisible,
} from '../common/tracking-logic.jsx';

import {setSatelliteData} from './earthview-slice.jsx';

import SatelliteMarker from './map-tooltip.jsx';
import createTerminatorLine from '../common/terminator-line.jsx';
import {getSunMoonCoords} from '../common/sunmoon.jsx';
import {useSocket} from '../common/socket.jsx';
import {store} from '../common/store.jsx';
import {CircularProgress, Backdrop} from '@mui/material';

const viewSatelliteLimit = 100;

let MapObject = null;

// -------------------------------------------------
// Leaflet icon path fix for React
// -------------------------------------------------
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.3/dist/images/marker-shadow.png',
});

const satelliteIconDimCircle = L.divIcon({
    className: 'earth-view-satellite-dim-icon',
    html: '<div style="width:20px;height:20px;display:flex;align-items:center;justify-content:center;"><div style="width:10px;height:10px;border-radius:50%;background:#38bdf8;border:1px solid #e0f2fe;box-shadow:0 0 0 1px rgba(0,0,0,0.45),0 0 5px rgba(56,189,248,0.45);"></div></div>',
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -10],
});

const earthViewVisibleSatelliteIcon = L.divIcon({
    className: satelliteIcon2.options.className,
    html: satelliteIcon2.options.html,
    iconSize: satelliteIcon2.options.iconSize,
    iconAnchor: [10, 10],
    popupAnchor: satelliteIcon2.options.popupAnchor,
});

const CenterHomeButton = React.memo(function CenterHomeButton() {
    const { t } = useTranslation('earthview');
    const {location} = useSelector((state) => state.location);

    const handleClick = () => {
        if (location && location.lat != null && location.lon != null) {
            MapObject.setView([location.lat, location.lon], MapObject.getZoom());
        }
    };

    return (
        <Fab size="small" color="primary" aria-label={t('map_controls.go_home')} onClick={handleClick} disabled={!location}>
            <HomeIcon/>
        </Fab>
    );
});

const CenterMapButton = React.memo(function CenterMapButton() {
    const { t } = useTranslation('earthview');
    const targetCoordinates = [0, 0];

    const handleClick = () => {
        MapObject.setView(targetCoordinates, MapObject.getZoom());
    };

    return (
        <Fab size="small" color="primary" aria-label={t('map_controls.go_to_center')} onClick={handleClick}>
            <FilterCenterFocusIcon/>
        </Fab>
    );
});

const FullscreenMapButton = React.memo(function FullscreenMapButton() {
    const { t } = useTranslation('earthview');

    const handleMapFullscreen = () => {
        MapObject.toggleFullscreen();
    };

    return (
        <Fab size="small" color="primary" aria-label={t('map_controls.go_fullscreen')} onClick={handleMapFullscreen}>
            <FullscreenIcon/>
        </Fab>
    );
});

const ZoomInButton = React.memo(function ZoomInButton() {
    const { t } = useTranslation('earthview');

    const handleClick = () => {
        if (!MapObject) return;
        MapObject.zoomIn(0.25);
    };

    return (
        <Fab size="small" color="primary" aria-label={t('map_controls.zoom_in', {defaultValue: 'Zoom in'})} onClick={handleClick}>
            <ZoomInIcon/>
        </Fab>
    );
});

const ZoomOutButton = React.memo(function ZoomOutButton() {
    const { t } = useTranslation('earthview');

    const handleClick = () => {
        if (!MapObject) return;
        MapObject.zoomOut(0.25);
    };

    return (
        <Fab size="small" color="primary" aria-label={t('map_controls.zoom_out', {defaultValue: 'Zoom out'})} onClick={handleClick}>
            <ZoomOutIcon/>
        </Fab>
    );
});

const EarthViewAttributionBar = React.memo(function EarthViewAttributionBar({ htmlString }) {
    return (
        <MapStatusBar>
            <SimpleTruncatedHtml className={'attribution'} htmlString={htmlString}/>
        </MapStatusBar>
    );
});

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

const LeafletEarthViewMapRenderer = ({handleSetTrackingOnBackend}) => {
    const {socket} = useSocket();
    const dispatch = useDispatch();
    const { t } = useTranslation('earthview');
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
        satelliteGroupId,
        openMapSettingsDialog,
        nextPassesHours,
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
    const normalizedMapEngine = useMemo(
        () => normalizeMapEngine(mapEngine),
        [mapEngine]
    );
    const mapZoomLevel = useMemo(() => {
        const engineZoom = Number(mapZoomByEngine?.[normalizedMapEngine]);
        if (Number.isFinite(engineZoom)) {
            return engineZoom;
        }
        return normalizedMapEngine === 'maplibre' ? -6 : 1.5;
    }, [mapZoomByEngine, normalizedMapEngine]);
    const selectedTileLayer = useMemo(
        () => getTileLayerById(tileLayerID, { mapEngine: normalizedMapEngine }),
        [normalizedMapEngine, tileLayerID]
    );
    const attributionHtml = useMemo(
        () => `<a href="https://leafletjs.com" title="A JavaScript library for interactive maps" target="_blank" rel="noopener noreferrer">Leaflet</a> | ${selectedTileLayer.attribution}`,
        [selectedTileLayer.attribution]
    );
    const mapCrs = useMemo(
        () => getMapCrsByTileLayerId(tileLayerID, { mapEngine: normalizedMapEngine }),
        [normalizedMapEngine, tileLayerID]
    );

    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
    const trackedSatelliteIds = useMemo(() => {
        const ids = new Set();
        trackerInstances.forEach((instance) => {
            const state = instance?.tracking_state || {};
            const noradId = state?.norad_id;
            const groupId = state?.group_id;
            if (noradId == null) {
                return;
            }
            if (selectedSatGroupId && groupId && String(groupId) !== String(selectedSatGroupId)) {
                return;
            }
            ids.add(Number(noradId));
        });
        return ids;
    }, [trackerInstances, selectedSatGroupId]);
    const trackedSatelliteIdsList = useMemo(
        () => Array.from(trackedSatelliteIds),
        [trackedSatelliteIds]
    );
    const targetNumberByNorad = useMemo(() => {
        const mapping = {};
        trackerInstances.forEach((instance, index) => {
            const state = instance?.tracking_state || {};
            const noradId = state?.norad_id;
            const groupId = state?.group_id;
            if (noradId == null) {
                return;
            }
            if (selectedSatGroupId && groupId && String(groupId) !== String(selectedSatGroupId)) {
                return;
            }
            const key = String(noradId);
            const targetNumber = Number(instance?.target_number || (index + 1));
            if (mapping[key] == null || targetNumber < mapping[key]) {
                mapping[key] = targetNumber;
            }
        });
        return mapping;
    }, [trackerInstances, selectedSatGroupId]);
    const trackingSatelliteId = trackedSatelliteIdsList[0] ?? null;
    const [mapLayers, setMapLayers] = useState({
        currentPastSatellitesPaths: [],
        currentFutureSatellitesPaths: [],
        currentSatellitesPosition: [],
        currentSatellitesCoverage: [],
        currentCrosshairs: [],
        terminatorLine: [],
        daySidePolygon: [],
        sunPos: null,
        moonPos: null,
    });
    const {location} = useSelector((state) => state.location);
    const updateTimeRef = useRef(null);
    const controlsBoxRef = useRef(null);
    const zoomControlsRef = useRef(null);
    const arrowControlsRef = useRef(null);
    const elevationHistoryRef = useRef({}); // Store elevation history for each satellite
    const mapInvalidateIntervalRef = useRef(null); // Store interval ID for cleanup
    const initialInvalidateTimeoutsRef = useRef([]); // Store initial invalidate timeouts for cleanup

    const handleSetMapZoomLevel = useCallback(
        (zoomLevel) => {
            dispatch(setMapZoomLevel(zoomLevel));
        },
        [dispatch]
    );

    const handleOpenSettings = useCallback(() => {
        dispatch(setOpenMapSettingsDialog(true));
    }, [dispatch]);

    // Subscribe to map events
    function MapEventComponent({handleSetMapZoomLevel}) {
        const mapEvents = useMapEvents({
            zoomend: () => {
                const mapZoom = mapEvents.getZoom();
                handleSetMapZoomLevel(mapZoom);
            },
            click: (e) => {
                const target = e.originalEvent?.target;
                if (
                    (controlsBoxRef.current && target && controlsBoxRef.current.contains(target)) ||
                    (zoomControlsRef.current && target && zoomControlsRef.current.contains(target)) ||
                    (arrowControlsRef.current && target && arrowControlsRef.current.contains(target))
                ) {
                    return;
                }
                dispatch(setSelectedSatelliteId(null));
            },
        });
        return null;
    }

    function satelliteUpdate(now) {
        // Skip update if location is not loaded yet
        if (!location || location.lat == null || location.lon == null) {
            return;
        }

        let currentPos = [];
        let currentCoverage = [];
        let currentCrosshair = [];
        let currentFuturePaths = [];
        let currentPastPaths = [];
        let satIndex = 0;
        let selectedSatPos = {};

        selectedSatellites.forEach((satellite) => {
            try {
                if (satIndex++ >= viewSatelliteLimit) {
                    return;
                }

                let noradId = satellite['norad_id'];
                let [lat, lon, altitude, velocity] = getSatelliteLatLon(
                    satellite['norad_id'],
                    satellite['tle1'],
                    satellite['tle2'],
                    now,
                    satellite['name']
                );

                // Validate satellite position - skip if invalid
                if (!isFinite(lat) || !isFinite(lon) || !isFinite(altitude) ||
                    lat === 0 && lon === 0 && altitude === 0 && velocity === 0) {
                    // Skip silently - likely a satellite with extreme BSTAR that can't be propagated
                    return;
                }

                // Let's also update the satellite info island with the new position data we have
                let [az, el, range] = calculateSatelliteAzEl(
                    satellite['tle1'],
                    satellite['tle2'],
                    {
                        lat: location['lat'],
                        lon: location['lon'],
                        alt: location['alt'],
                    },
                    now
                ) || [0, 0, 0];

                // Validate AzEl data
                if (!isFinite(az) || !isFinite(el) || !isFinite(range)) {
                    console.warn(
                        `Skipping satellite ${satellite['name']} (${noradId}): Invalid AzEl data [${az}, ${el}, ${range}]`
                    );
                    return;
                }

                // Initialize or update elevation history for this satellite
                if (!elevationHistoryRef.current[noradId]) {
                    elevationHistoryRef.current[noradId] = [];
                }

                // Add current elevation to history
                elevationHistoryRef.current[noradId].push(el);

                // Keep only last 5 samples
                if (elevationHistoryRef.current[noradId].length > 5) {
                    elevationHistoryRef.current[noradId].shift();
                }

                // Calculate elevation trend
                const history = elevationHistoryRef.current[noradId];
                let trend = 'stable';
                let elRate = 0;
                const lowRateThreshold = 0.04;
                const highRateThreshold = 0.18;

                if (history.length >= 2) {
                    // Calculate average rate of change
                    const changes = [];
                    for (let i = 1; i < history.length; i++) {
                        changes.push(history[i] - history[i - 1]);
                    }
                    elRate = changes.reduce((a, b) => a + b, 0) / changes.length;

                    // Determine trend bands based on elevation-rate thresholds.
                    if (elRate >= highRateThreshold) {
                        trend = 'rising_fast';
                    } else if (elRate >= lowRateThreshold) {
                        trend = 'rising_slow';
                    } else if (elRate <= -highRateThreshold) {
                        trend = 'falling_fast';
                    } else if (elRate <= -lowRateThreshold) {
                        trend = 'falling_slow';
                    } else if (Math.abs(elRate) < lowRateThreshold && el > 0) {
                        // Check if we're at a peak (elevation is positive and rate is near zero)
                        if (history.length >= 3) {
                            const recent = history.slice(-3);
                            const maxRecent = Math.max(...recent);
                            if (Math.abs(el - maxRecent) < 0.2) {
                                trend = 'peak';
                            }
                        }
                    }
                }

                // Calculate time to max elevation only for visible satellites
                let timeToMaxEl = null;
                if (el > 0 && (trend === 'rising_slow' || trend === 'rising_fast')) {
                    timeToMaxEl = calculateTimeToMaxElevation(
                        satellite['tle1'],
                        satellite['tle2'],
                        {
                            lat: location['lat'],
                            lon: location['lon'],
                            alt: location['alt'],
                        },
                        now
                    );
                }

                // Accumulate the selected satellite position with enriched data
                selectedSatPos[noradId] = {
                    az,
                    el,
                    range,
                    elHistory: [...history],
                    trend,
                    elRate,
                    timeToMaxEl
                };

                if (selectedSatelliteId === satellite['norad_id']) {
                    // Get the recent state
                    const recentSatData = store.getState().earthViewTrack.satelliteData;

                    // Update state
                    dispatch(
                        setSatelliteData({
                            ...recentSatData,
                            position: {
                                lat: lat,
                                lon: lon,
                                alt: altitude * 1000,
                                vel: velocity,
                                az: az,
                                el: el,
                            },
                        })
                    );
                }

                if (selectedSatelliteId === noradId) {
                    // calculate paths
                    let paths = getSatellitePaths(
                        [satellite['tle1'], satellite['tle2']],
                        orbitProjectionDuration,
                        1,
                        noradId
                    );

                    // past path
                    currentPastPaths.push(
                        <Polyline
                            key={`past-path-${noradId}`}
                            positions={paths.past}
                            pathOptions={{
                                color: pastOrbitLineColor,
                                weight: 2,
                                opacity: 0.5,
                                smoothFactor: 1,
                            }}
                        />
                    );

                    // future path
                    currentFuturePaths.push(
                        <Polyline
                            key={`future-path-${noradId}`}
                            positions={paths.future}
                            pathOptions={{
                                color: futureOrbitLineColor,
                                weight: 2,
                                opacity: 1,
                                dashArray: '2 4',
                                smoothFactor: 1,
                            }}
                        />
                    );
                }

                const onMarkerMouseClick = (event, noradId) => {
                    dispatch(setSelectedSatelliteId(noradId));
                };

                const markerEventHandlers = {
                    //mouseover: (event) => (onMarkerMouseOver(event, satellite['norad_id'])),
                    //mouseout: (event) => (onMarkerMouseOver(event, satellite['norad_id'])),
                    click: (event) => onMarkerMouseClick(event, satellite['norad_id']),
                };

                const isVisible = isSatelliteVisible(satellite['tle1'], satellite['tle2'], now, location);

                // Crosshairs for tracking satellite - always shown when the satellite is being tracked
                if (trackedSatelliteIds.has(Number(noradId))) {
                    const crosshairColor = theme.palette.error.main;

                    // Create a custom square icon using DivIcon for pixel-perfect square
                    const squareIcon = L.divIcon({
                        className: 'custom-square-marker',
                        html: `<div style="width: 30px; height: 30px; border: 2px solid ${crosshairColor}; opacity: 0.8; box-sizing: border-box;">` +
                            '</div>',
                        iconSize: [30, 30],
                        iconAnchor: [15, 15],
                    });

                    currentCrosshair.push(
                        <React.Fragment key={`crosshair-${noradId}`}>
                            <Marker
                                position={[lat, lon]}
                                icon={squareIcon}
                                interactive={false}
                            />
                            {/* Horizontal line crossing the entire map */}
                            <Polyline
                                positions={[
                                    [lat, -180],
                                    [lat, 180],
                                ]}
                                pathOptions={{
                                    color: crosshairColor,
                                    weight: 1,
                                    opacity: 1,
                                    smoothFactor: 1,
                                }}
                            />
                            {/* Vertical line crossing the entire map */}
                            <Polyline
                                positions={[
                                    [-90, lon],
                                    [90, lon],
                                ]}
                                pathOptions={{
                                    color: crosshairColor,
                                    weight: 1,
                                    opacity: 1,
                                    smoothFactor: 1,
                                }}
                            />
                        </React.Fragment>
                    );
                }

                // If the satellite is visible, draw the coverage circle
                if (isVisible && showSatelliteCoverage) {
                    let coverage = getSatelliteCoverageCircle(lat, lon, altitude, 360);
                    currentCoverage.push(
                        <Polyline
                            noClip={true}
                            key={'coverage-' + satellite['name']}
                            pathOptions={{
                                color: selectedSatelliteId === noradId ? 'white' : satelliteCoverageColor,
                                fillColor: satelliteCoverageColor,
                                weight: selectedSatelliteId === noradId ? 2 : 1,
                                fill: true,
                                opacity: 1,
                                fillOpacity: selectedSatelliteId === noradId ? 0.5 : 0.1,
                                dashArray: '1 2',
                            }}
                            positions={coverage}
                        />
                    );
                } else {
                    // If the satellite is selected, draw the coverage circle
                    if (selectedSatelliteId === noradId) {
                        let coverage = getSatelliteCoverageCircle(lat, lon, altitude, 360);
                        currentCoverage.push(
                            <Polyline
                                noClip={true}
                                key={'coverage-' + satellite['name']}
                                pathOptions={{
                                    color: 'white',
                                    fillColor: satelliteCoverageColor,
                                    weight: 2,
                                    fill: true,
                                    opacity: 1,
                                    fillOpacity: 0.5,
                                    dashArray: '',
                                }}
                                positions={coverage}
                            />
                        );
                    }
                }

                const isTracked = trackedSatelliteIds.has(Number(noradId));
                if (showTooltip || selectedSatelliteId === noradId || isTracked) {
                    currentPos.push(
                        <SatelliteMarker
                            key={`satellite-marker-${satellite.norad_id}`}
                            satellite={satellite}
                            position={[lat, lon]}
                            altitude={altitude}
                            velocity={velocity}
                            isVisible={isVisible}
                            trackingSatelliteId={trackingSatelliteId}
                            trackingSatelliteIds={trackedSatelliteIdsList}
                            targetNumberByNorad={targetNumberByNorad}
                            selectedSatelliteId={selectedSatelliteId}
                            markerEventHandlers={markerEventHandlers}
                            satelliteIcon={isVisible ? earthViewVisibleSatelliteIcon : satelliteIconDimCircle}
                            opacity={1}
                            handleSetTrackingOnBackend={handleSetTrackingOnBackend}
                        />
                    );
                } else if (isVisible) {
                    currentPos.push(
                        <Marker
                            key={'marker-' + satellite['norad_id']}
                            position={[lat, lon]}
                            icon={earthViewVisibleSatelliteIcon}
                            eventHandlers={markerEventHandlers}
                            opacity={1}
                        ></Marker>
                    );
                } else {
                    currentPos.push(
                        <Marker
                            key={'marker-' + satellite['norad_id']}
                            position={[lat, lon]}
                            icon={satelliteIconDimCircle}
                            eventHandlers={markerEventHandlers}
                            opacity={0.6}
                        ></Marker>
                    );
                }
            } catch (e) {
                console.error(
                    `Error while updating satellite ${satellite['name']} (${satellite['norad_id']}): ${e}`
                );
            }
        });

        // Day/night boundary
        const newTerminatorLine = createTerminatorLine().reverse();
        // Day side polygon
        const dayPoly = [...newTerminatorLine];
        dayPoly.push(dayPoly[dayPoly.length - 1]);

        // Sun and moon position
        const [newSunPos, newMoonPos] = getSunMoonCoords();

        setMapLayers({
            currentPastSatellitesPaths: currentPastPaths,
            currentFutureSatellitesPaths: currentFuturePaths,
            currentSatellitesPosition: currentPos,
            currentSatellitesCoverage: currentCoverage,
            currentCrosshairs: currentCrosshair,
            terminatorLine: newTerminatorLine,
            daySidePolygon: dayPoly,
            sunPos: newSunPos,
            moonPos: newMoonPos,
        });

        dispatch(setSelectedSatellitePositions(selectedSatPos));
    }

    // Update the satellites position, day/night terminator every 3 seconds
    useEffect(() => {
        // Clear the interval
        if (updateTimeRef.current) {
            clearTimeout(updateTimeRef.current);
        }

        // Call for an update
        satelliteUpdate(new Date());

        // Recreate the interval
        updateTimeRef.current = setInterval(() => {
            satelliteUpdate(new Date());
        }, 3000);

        return () => {
            clearInterval(updateTimeRef.current);
        };
    }, [
        selectedSatellites,
        showPastOrbitPath,
        showFutureOrbitPath,
        showSatelliteCoverage,
        showSunIcon,
        showMoonIcon,
        showTerminatorLine,
        pastOrbitLineColor,
        futureOrbitLineColor,
        satelliteCoverageColor,
        orbitProjectionDuration,
        mapZoomLevel,
        showTooltip,
        selectedSatelliteId,
        trackingSatelliteId,
        trackedSatelliteIds,
        trackedSatelliteIdsList,
    ]);

    useEffect(() => {
        // zoom in and out a bit to fix the zoom factor issue
        if (MapObject && MapObject._container && document.contains(MapObject._container)) {
            const zoomLevel = MapObject.getZoom();
            const loc = MapObject.getCenter();
            setTimeout(() => {
                MapObject.setView([loc.lat, loc.lng], zoomLevel - 0.25);
                setTimeout(() => {
                    MapObject.setView([loc.lat, loc.lng], zoomLevel);
                }, 500);
            }, 0);
        }

        return () => {
        };
    }, [tileLayerID]);

    // On component mount, keep map size in sync with layout changes.
    useEffect(() => {
        const handleLayoutChange = () => {
            if (!MapObject || !MapObject._container || !document.contains(MapObject._container)) {
                return;
            }

            // Recalculate after DOM/layout commits.
            requestAnimationFrame(() => {
                if (MapObject && MapObject._container && document.contains(MapObject._container)) {
                    MapObject.invalidateSize({ pan: false, debounceMoveend: true });
                }
            });
            setTimeout(() => {
                if (MapObject && MapObject._container && document.contains(MapObject._container)) {
                    MapObject.invalidateSize({ pan: false, debounceMoveend: true });
                }
            }, 120);
        };

        window.addEventListener('earth-view-map-layout-change', handleLayoutChange);

        // Cleanup: clear the map invalidate interval when component unmounts
        return () => {
            window.removeEventListener('earth-view-map-layout-change', handleLayoutChange);
            initialInvalidateTimeoutsRef.current.forEach(clearTimeout);
            initialInvalidateTimeoutsRef.current = [];
            if (mapInvalidateIntervalRef.current) {
                clearInterval(mapInvalidateIntervalRef.current);
                mapInvalidateIntervalRef.current = null;
            }
        };
    }, []);

    const handleWhenReady = (map) => {
        // map is ready
        MapObject = map.target;

        // Grid/layout can settle shortly after initial render; force non-panning size sync.
        initialInvalidateTimeoutsRef.current.forEach(clearTimeout);
        initialInvalidateTimeoutsRef.current = [0, 150, 500].map((delay) =>
            setTimeout(() => {
                if (MapObject && MapObject._container && document.contains(MapObject._container)) {
                    MapObject.invalidateSize({ pan: false, debounceMoveend: true });
                }
            }, delay)
        );

        // Clear any existing interval before creating a new one
        if (mapInvalidateIntervalRef.current) {
            clearInterval(mapInvalidateIntervalRef.current);
        }

        mapInvalidateIntervalRef.current = setInterval(() => {
            try {
                // Check if MapObject exists and has required properties
                if (!MapObject || !MapObject._container || !MapObject._loaded) {
                    return;
                }

                // Additional check: verify the container element exists in DOM
                if (!document.contains(MapObject._container)) {
                    return;
                }

                MapObject.invalidateSize({ pan: false, debounceMoveend: true });
            } catch (e) {
                // Silently ignore - this can happen during rapid component unmount/remount
                // Only log if it's not the _leaflet_pos error
                if (!e.message.includes('_leaflet_pos')) {
                    console.error(`Error while updating map: ${e}`);
                }
            }
        }, 1000);
    };

    return (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <TitleBar
                className={getClassNamesBasedOnGridEditing(gridEditable, ['window-title-bar'])}
                sx={islandTitleBarSx}
            >
                <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%'}}>
                    <Box sx={{display: 'flex', alignItems: 'center'}}>
                        <Typography variant="subtitle2" sx={{fontWeight: 'bold'}}>
                            {t('title')}
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                        <Tooltip title={t('map_settings.title')}>
                            <span>
                                <IconButton
                                    size="small"
                                    onClick={handleOpenSettings}
                                    sx={{ padding: '2px' }}
                                >
                                    <SettingsIcon fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>
                    </Box>
                </Box>
            </TitleBar>
            <Box sx={{ position: 'relative', width: '100%', flex: 1, minHeight: 0 }}>
                <Backdrop
                    open={loadingSatellites && selectedSatGroupId}
                    sx={{
                        position: 'absolute',
                        zIndex: 1000,
                        backgroundColor: 'rgba(0, 0, 0, 0.5)',
                    }}
                >
                    <CircularProgress size={60} thickness={4} />
                </Backdrop>
                {/* Leaflet CRS is immutable after map init, so remount when projection changes. */}
                <MapContainer
                    key={`earth-view-map-${normalizedMapEngine}-${selectedTileLayer.id}-${selectedTileLayer.projection || 'EPSG3857'}-${enableMapDragging}-${enableMapZooming}`}
                    className="earth-view-map"
                    fullscreenControl={true}
                    center={[0, 0]}
                    crs={mapCrs}
                    zoom={mapZoomLevel}
                    style={{width: '100%', height: '100%'}}
                    dragging={enableMapDragging}
                    scrollWheelZoom={enableMapZooming}
                    doubleClickZoom={enableMapZooming}
                    touchZoom={enableMapZooming}
                    boxZoom={enableMapZooming}
                    maxZoom={10}
                    minZoom={0}
                    whenReady={handleWhenReady}
                    zoomSnap={0.25}
                    zoomDelta={0.25}
                    zoomControl={false}
                    keyboard={false}
                    bounceAtZoomLimits={false}
                    closePopupOnClick={false}
                >
                <MapEventComponent handleSetMapZoomLevel={handleSetMapZoomLevel}/>
                {selectedTileLayer.type === 'wms' ? (
                    <WMSTileLayer
                        url={selectedTileLayer.url}
                        {...selectedTileLayer.wmsOptions}
                    />
                ) : (
                    <TileLayer url={selectedTileLayer.url}/>
                )}

                {!enableMapZooming ? (
                    <Box
                        ref={zoomControlsRef}
                        sx={{'& > :not(style)': {m: 1}, display: 'flex', flexDirection: 'column'}}
                        style={{left: 5, top: 5, position: 'absolute'}}
                    >
                        <ZoomInButton/>
                        <ZoomOutButton/>
                    </Box>
                ) : null}

                <Box
                    ref={controlsBoxRef}
                    sx={{'& > :not(style)': {m: 1}}}
                    style={{right: 5, top: 5, position: 'absolute'}}
                >
                    <CenterHomeButton/>
                    <CenterMapButton/>
                    <FullscreenMapButton/>
                </Box>

                <MapSettingsIslandDialog
                    updateBackend={() => {
                        const key = 'earth-view-map-settings';
                        dispatch(setEarthViewMapSetting({socket, key: key}));
                    }}
                />

                {mapLayers.sunPos && showSunIcon ? <Marker position={mapLayers.sunPos} icon={sunIcon} opacity={0.5}/> : null}

                {mapLayers.moonPos && showMoonIcon ? (
                    <Marker position={mapLayers.moonPos} icon={moonIcon} opacity={0.5}/>
                ) : null}

                {mapLayers.daySidePolygon.length > 1 && showTerminatorLine && (
                    <Polygon
                        positions={mapLayers.daySidePolygon}
                        pathOptions={{
                            fillColor: 'black',
                            fillOpacity: 0.4,
                            color: 'white',
                            opacity: 0.5,
                            weight: 0,
                            smoothFactor: 1,
                        }}
                    />
                )}

                {mapLayers.terminatorLine.length > 1 && showTerminatorLine && (
                    <Polyline
                        positions={mapLayers.terminatorLine}
                        pathOptions={{
                            color: 'white',
                            weight: 1,
                            opacity: 0.1,
                        }}
                    />
                )}

                {InternationalDateLinePolyline()}

                {location && location.lat != null && location.lon != null && (
                    <Marker position={[location.lat, location.lon]} icon={homeIcon} opacity={0.8}/>
                )}

                {showPastOrbitPath ? mapLayers.currentPastSatellitesPaths : null}
                {showFutureOrbitPath ? mapLayers.currentFutureSatellitesPaths : null}
                {mapLayers.currentSatellitesPosition}
                {mapLayers.currentSatellitesCoverage}
                {mapLayers.currentCrosshairs}

                {!enableMapDragging ? (
                    <div ref={arrowControlsRef}>
                        <MapArrowControls mapObject={MapObject} verticalOffset={25}/>
                    </div>
                ) : null}

                {showGrid && (
                    <CoordinateGrid
                        latInterval={15}
                        lngInterval={15}
                        latColor="white"
                        lngColor="white"
                        weight={1}
                        opacity={0.5}
                        showLabels={false}
                    />
                )}

                {/*<SatelliteTrackSuggestion*/}
                {/*    selectedSatelliteId={selectedSatelliteId}*/}
                {/*    trackingSatelliteId={trackingSatelliteId}*/}
                {/*    selectedSatellite={selectedSatellites.find((sat) => sat.norad_id === selectedSatelliteId)}*/}
                {/*    handleSetTrackingOnBackend={handleSetTrackingOnBackend}*/}
                {/*/>*/}
                </MapContainer>
                <EarthViewAttributionBar htmlString={attributionHtml}/>
            </Box>
        </Box>
    );
};

export default LeafletEarthViewMapRenderer;
