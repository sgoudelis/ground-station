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

import React, {startTransition, useCallback, useEffect, useMemo, useRef, useState} from 'react';
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
import {Box, useTheme, Typography} from '@mui/material';
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
import MapTitleControls from './map-title-controls.jsx';
import MapToolbar from './map-toolbar.jsx';
import useMapIslandFullscreen from './use-map-island-fullscreen.js';
import CoordinateGrid from '../common/mercator-grid.jsx';
import SatelliteTrackSuggestion from './map-target-button.jsx';
import {
    getSatelliteCoverageCircle,
} from '../common/tracking-logic.jsx';
import {
    getEarthViewPaths,
    getEarthViewTimeToPeak,
    orbitIdentity,
    propagateEarthViewSatellite,
} from './earthview-orbit.js';

import {setSatelliteData} from './earthview-slice.jsx';

import SatelliteMarker from './map-tooltip.jsx';
import createTerminatorLine from '../common/terminator-line.jsx';
import {getSunMoonCoords} from '../common/sunmoon.jsx';
import {useSocket} from '../common/socket.jsx';
import {store} from '../common/store.jsx';
import {CircularProgress, Backdrop} from '@mui/material';

const viewSatelliteLimit = 100;
// A 5° step remains visually smooth at Earth View's supported zoom levels,
// while avoiding thousands of polygon vertices on every live refresh.
const coverageCircleSegments = 72;
const timeToMaxElevationRefreshMs = 30 * 1000;

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
        if (orbitIdentity(prev[i]) !== orbitIdentity(next[i])) return false;
    }
    return true;
}

const LeafletEarthViewMapRenderer = ({
    handleSetTrackingOnBackend,
    onOpenSatelliteInfo,
    onMapError,
    onMapLoaded,
    onSatelliteMarkerContextMenu,
}) => {
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
    const selectedPosition = useSelector((state) =>
        state.earthViewTrack.selectedSatellitePositions?.[state.earthViewTrack.selectedSatelliteId]);
    const [following, setFollowing] = useState(false);
    const selectedLatitude = selectedPosition?.lat;
    const selectedLongitude = selectedPosition?.lon;
    const hasSelectedPosition = Number.isFinite(selectedLatitude) && Number.isFinite(selectedLongitude);
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
    // Rebuild keyed tile URLs when preferences finish loading or change.
    const preferences = useSelector((state) => state.preferences?.preferences);
    const selectedTileLayer = useMemo(
        () => getTileLayerById(tileLayerID, { mapEngine: normalizedMapEngine, t, preferences }),
        [normalizedMapEngine, tileLayerID, t, preferences]
    );
    const attributionHtml = useMemo(
        () => `<a href="https://leafletjs.com" title="A JavaScript library for interactive maps" target="_blank" rel="noopener noreferrer">Leaflet</a> | ${selectedTileLayer.attribution}`,
        [selectedTileLayer.attribution]
    );
    const mapCrs = useMemo(
        () => getMapCrsByTileLayerId(tileLayerID, { mapEngine: normalizedMapEngine, t }),
        [normalizedMapEngine, tileLayerID]
    );
    const tileEventHandlers = useMemo(() => ({
        load: () => onMapLoaded?.(),
        tileerror: (event) => onMapError?.(
            event?.error || new Error('Leaflet could not load one or more basemap tiles.')
        ),
    }), [onMapError, onMapLoaded]);

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
    const arrowControlsRef = useRef(null);
    const elevationHistoryRef = useRef({}); // Store elevation history for each satellite
    const timeToMaxElevationRef = useRef(new Map());
    const selectedSatelliteIdRef = useRef(selectedSatelliteId);
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

    const handleCenterHome = useCallback(() => {
        setFollowing(false);
        if (!MapObject || location?.lat == null || location?.lon == null) return;
        MapObject.setView([location.lat, location.lon], MapObject.getZoom());
    }, [location]);

    const handleCenterMap = useCallback(() => {
        setFollowing(false);
        if (!MapObject) return;
        MapObject.setView([0, 0], MapObject.getZoom());
    }, []);

    const handleFitEarth = useCallback(() => {
        setFollowing(false);
        MapObject?.fitBounds([[-85, -180], [85, 180]], {padding: [12, 12]});
    }, []);

    useEffect(() => {
        if (!selectedSatelliteId) setFollowing(false);
    }, [selectedSatelliteId]);

    useEffect(() => {
        if (following && hasSelectedPosition && MapObject) {
            // Follow live propagation without restarting the map's zoom animation.
            MapObject.setView([selectedLatitude, selectedLongitude], MapObject.getZoom(), {animate: false});
        }
    }, [following, hasSelectedPosition, selectedLatitude, selectedLongitude]);

    const resizeMap = useCallback(() => {
        if (MapObject?._container && document.contains(MapObject._container)) {
            MapObject.invalidateSize({pan: false, debounceMoveend: true});
        }
    }, []);
    const {islandRef, isFullscreen, toggleFullscreen} = useMapIslandFullscreen(resizeMap);

    // Subscribe to map events
    function MapEventComponent({handleSetMapZoomLevel}) {
        const mapEvents = useMapEvents({
            dragstart: () => setFollowing(false),
            zoomend: () => {
                const mapZoom = mapEvents.getZoom();
                handleSetMapZoomLevel(mapZoom);
            },
            click: (e) => {
                const target = e.originalEvent?.target;
                if (
                    (arrowControlsRef.current && target && arrowControlsRef.current.contains(target))
                ) {
                    return;
                }
                dispatch(setSelectedSatelliteId(null));
            },
        });
        useEffect(() => {
            // Keep the current center and zoom when quick interaction toggles change.
            const setInteraction = (handler, enabled) => handler?.[enabled ? 'enable' : 'disable']();
            setInteraction(mapEvents.dragging, enableMapDragging);
            setInteraction(mapEvents.scrollWheelZoom, enableMapZooming);
            setInteraction(mapEvents.doubleClickZoom, enableMapZooming);
            setInteraction(mapEvents.touchZoom, enableMapZooming);
            setInteraction(mapEvents.boxZoom, enableMapZooming);
        }, [mapEvents, enableMapDragging, enableMapZooming]);
        return null;
    }

    function satelliteUpdate(now) {
        // Read the latest selection without making selection changes recreate the
        // entire Leaflet layer tree.
        const activeSelectedSatelliteId = selectedSatelliteIdRef.current;

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
                const observer = {lat: location.lat, lon: location.lon, alt: location.alt};
                const {record, position} = propagateEarthViewSatellite(satellite, now, observer);
                if (!position || !Number.isFinite(position.az) || !Number.isFinite(position.el)) return;
                const {lat, lon, vel: velocity, az, el, range} = position;
                const altitude = position.alt / 1000;

                // Validate satellite position - skip if invalid
                if (!isFinite(lat) || !isFinite(lon) || !isFinite(altitude) ||
                    lat === 0 && lon === 0 && altitude === 0 && velocity === 0) {
                    // Skip silently - likely a satellite with extreme BSTAR that can't be propagated
                    return;
                }

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

                // Finding a peak propagates an orbit many times. Reuse a recent
                // result between the 3-second map refreshes and count it down.
                let timeToMaxEl = null;
                if (el > 0 && (trend === 'rising_slow' || trend === 'rising_fast')) {
                    const cacheKey = [
                        noradId,
                        orbitIdentity(satellite),
                        location.lat,
                        location.lon,
                        location.alt,
                    ].join('|');
                    const cachedPeak = timeToMaxElevationRef.current.get(cacheKey);
                    const elapsedMs = cachedPeak ? now.getTime() - cachedPeak.calculatedAt : Infinity;

                    if (elapsedMs < timeToMaxElevationRefreshMs) {
                        timeToMaxEl = cachedPeak.timeToMaxEl == null
                            ? null
                            : Math.max(0, cachedPeak.timeToMaxEl - (elapsedMs / 1000));
                    } else {
                        timeToMaxEl = getEarthViewTimeToPeak(record, observer, now);
                        timeToMaxElevationRef.current.set(cacheKey, {
                            calculatedAt: now.getTime(),
                            timeToMaxEl,
                        });
                    }
                }

                // Accumulate the selected satellite position with enriched data
                selectedSatPos[noradId] = {
                    lat,
                    lon,
                    az,
                    el,
                    range,
                    elHistory: [...history],
                    trend,
                    elRate,
                    timeToMaxEl
                };

                if (activeSelectedSatelliteId === satellite['norad_id']) {
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

                if (
                    activeSelectedSatelliteId === noradId
                    && (showPastOrbitPath || showFutureOrbitPath)
                ) {
                    // calculate paths
                    let paths = getEarthViewPaths(record, orbitProjectionDuration, 1, now);

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

                const onMarkerContextMenu = (event, satelliteData) => {
                    if (typeof onSatelliteMarkerContextMenu !== 'function') {
                        return;
                    }
                    const nativeEvent = event?.originalEvent;
                    nativeEvent?.preventDefault?.();
                    nativeEvent?.stopPropagation?.();
                    onSatelliteMarkerContextMenu(satelliteData, nativeEvent || event);
                };

                const markerEventHandlers = {
                    //mouseover: (event) => (onMarkerMouseOver(event, satellite['norad_id'])),
                    //mouseout: (event) => (onMarkerMouseOver(event, satellite['norad_id'])),
                    click: (event) => onMarkerMouseClick(event, satellite['norad_id']),
                    contextmenu: (event) => onMarkerContextMenu(event, satellite),
                };

                // The current observer elevation is also the visibility test.
                const isVisible = el >= 0;

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
                    let coverage = getSatelliteCoverageCircle(
                        lat,
                        lon,
                        altitude,
                        coverageCircleSegments,
                    );
                    currentCoverage.push(
                        <Polyline
                            noClip={true}
                            key={'coverage-' + satellite['name']}
                            pathOptions={{
                                color: activeSelectedSatelliteId === noradId ? 'white' : satelliteCoverageColor,
                                fillColor: satelliteCoverageColor,
                                weight: activeSelectedSatelliteId === noradId ? 2 : 1,
                                fill: true,
                                opacity: 1,
                                fillOpacity: activeSelectedSatelliteId === noradId ? 0.5 : 0.1,
                                dashArray: '1 2',
                            }}
                            positions={coverage}
                        />
                    );
                } else {
                    // If the satellite is selected, draw the coverage circle
                    if (activeSelectedSatelliteId === noradId) {
                        let coverage = getSatelliteCoverageCircle(
                            lat,
                            lon,
                            altitude,
                            coverageCircleSegments,
                        );
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
                if (showTooltip || activeSelectedSatelliteId === noradId || isTracked) {
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
                            isSelected={activeSelectedSatelliteId === noradId}
                            markerEventHandlers={markerEventHandlers}
                            satelliteIcon={isVisible ? earthViewVisibleSatelliteIcon : satelliteIconDimCircle}
                            opacity={1}
                            handleSetTrackingOnBackend={handleSetTrackingOnBackend}
                            onOpenSatelliteInfo={onOpenSatelliteInfo}
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

        // Mounting or replacing up to 100 Leaflet children is non-urgent live
        // data. Let React paint the route shell and handle input first.
        startTransition(() => {
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
        });
    }

    // Selecting a marker used to restart the full satellite update and remount
    // every permanent tooltip. Only the old and new selections need to change
    // immediately; position, coverage, and orbit data keep their 3-second cadence.
    useEffect(() => {
        selectedSatelliteIdRef.current = selectedSatelliteId;

        if (!showTooltip) {
            // Without permanent tooltips, the regular update is inexpensive and
            // must create/remove the selected marker tooltip.
            satelliteUpdate(new Date());
            return;
        }

        setMapLayers((previousLayers) => {
            let hasSelectionChange = false;
            const currentSatellitesPosition = previousLayers.currentSatellitesPosition.map((marker) => {
                const markerSatellite = marker?.props?.satellite;
                if (!markerSatellite) {
                    return marker;
                }

                const isSelected = markerSatellite.norad_id === selectedSatelliteId;
                if (marker.props.isSelected === isSelected) {
                    return marker;
                }

                hasSelectionChange = true;
                return React.cloneElement(marker, {isSelected});
            });

            return hasSelectionChange
                ? {...previousLayers, currentSatellitesPosition}
                : previousLayers;
        });
    }, [selectedSatelliteId, showTooltip]);

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
        trackingSatelliteId,
        trackedSatelliteIds,
        trackedSatelliteIdsList,
        onOpenSatelliteInfo,
    ]);

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

        // Clear the initial layout timers when the map unmounts.
        return () => {
            window.removeEventListener('earth-view-map-layout-change', handleLayoutChange);
            initialInvalidateTimeoutsRef.current.forEach(clearTimeout);
            initialInvalidateTimeoutsRef.current = [];
        };
    }, []);

    const handleWhenReady = (map) => {
        // map is ready
        MapObject = map.target;
        if (following && hasSelectedPosition) {
            MapObject.setView([selectedLatitude, selectedLongitude], MapObject.getZoom(), {animate: false});
        }

        // Grid/layout can settle shortly after initial render; force non-panning size sync.
        initialInvalidateTimeoutsRef.current.forEach(clearTimeout);
        initialInvalidateTimeoutsRef.current = [0, 150, 500].map((delay) =>
            setTimeout(() => {
                if (MapObject && MapObject._container && document.contains(MapObject._container)) {
                    MapObject.invalidateSize({ pan: false, debounceMoveend: true });
                }
            }, delay)
        );

    };

    return (
        <Box
            ref={islandRef}
            sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                '&:fullscreen': {width: '100vw', height: '100vh', bgcolor: 'background.paper'},
                '&:-webkit-full-screen': {width: '100vw', height: '100vh', bgcolor: 'background.paper'},
            }}
        >
            <TitleBar
                className={getClassNamesBasedOnGridEditing(gridEditable, ['window-title-bar'])}
                sx={islandTitleBarSx}
            >
                <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', minWidth: 0}}>
                    <Box sx={{display: 'flex', alignItems: 'center', flex: 1, minWidth: 0}}>
                        <Typography variant="subtitle2" sx={{fontWeight: 'bold', minWidth: 0}} noWrap>
                            {t('title')}
                        </Typography>
                    </Box>
                    <MapTitleControls
                        onSettings={handleOpenSettings}
                        tooltipContainer={isFullscreen ? islandRef.current : undefined}
                    />
                </Box>
            </TitleBar>
            <MapToolbar
                homeDisabled={location?.lat == null || location?.lon == null}
                followDisabled={!hasSelectedPosition}
                following={following}
                onHome={handleCenterHome}
                onCenter={handleCenterMap}
                onFitEarth={handleFitEarth}
                onToggleFollow={() => setFollowing((value) => !value)}
                onZoomIn={() => MapObject?.zoomIn(0.25)}
                onZoomOut={() => MapObject?.zoomOut(0.25)}
                onFullscreen={toggleFullscreen}
                isFullscreen={isFullscreen}
                tooltipContainer={isFullscreen ? islandRef.current : undefined}
            />
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
                    key={`earth-view-map-${normalizedMapEngine}-${selectedTileLayer.id}-${selectedTileLayer.projection || 'EPSG3857'}`}
                    className="earth-view-map"
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
                        eventHandlers={tileEventHandlers}
                    />
                ) : (
                    <TileLayer url={selectedTileLayer.url} eventHandlers={tileEventHandlers}/>
                )}

                <MapSettingsIslandDialog
                    container={isFullscreen ? islandRef.current : undefined}
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
                    <div ref={arrowControlsRef} onClick={() => setFollowing(false)}>
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
                {/*    onOpenSatelliteInfo={onOpenSatelliteInfo}*/}
                {/*/>*/}
                </MapContainer>
                <EarthViewAttributionBar htmlString={attributionHtml}/>
            </Box>
        </Box>
    );
};

export default LeafletEarthViewMapRenderer;
