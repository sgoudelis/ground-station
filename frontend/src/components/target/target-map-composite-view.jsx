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
    useMap,
    useMapEvents,
} from 'react-leaflet';
import {
    Box,
    CircularProgress,
    Fab,
    Slider,
    Typography,
    Tooltip,
    IconButton,
    useTheme,
} from "@mui/material";
import { styled } from '@mui/material/styles';
import { Tooltip as LeafletTooltip } from 'react-leaflet';
import L from 'leaflet';
import {SatelliteAlt} from '@mui/icons-material';
import HomeIcon from '@mui/icons-material/Home';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FilterCenterFocusIcon from '@mui/icons-material/FilterCenterFocus';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import SettingsIcon from '@mui/icons-material/Settings';
import RefreshIcon from '@mui/icons-material/Refresh';
import {useDispatch, useSelector} from "react-redux";
import { useTranslation } from 'react-i18next';
import {
    setOpenMapSettingsDialog,
    setSatGroupId,
    setTerminatorLine,
    setDaySidePolygon,
    setPastOrbitLineColor,
    setFutureOrbitLineColor,
    setSatelliteCoverageColor,
    setOrbitProjectionDuration,
    setTileLayerID,
    setMapZoomLevel,
    setSunPos,
    setMoonPos,
    setGridEditable,
    setSliderTimeOffset,
    setLoading,
    fetchSatellite,
    getTrackingStateFromBackend,
    setSatelliteId,
    setTargetMapSetting,
    TARGET_VIEW_MODE_PLANETARIUM,
    TARGET_VIEW_MODE_SOLAR_SYSTEM,
} from './target-slice.jsx';
import {getMapCrsByTileLayerId, getTileLayerById, normalizeMapEngine} from "../common/tile-layers.jsx";
import {homeIcon, sunIcon, moonIcon, satelliteIcon2} from '../common/dataurl-icons.jsx';
import {
    TitleBar,
    MapStatusBar,
    InternationalDateLinePolyline,
    MapArrowControls,
    SimpleTruncatedHtml,
    getClassNamesBasedOnGridEditing,
    humanizeAltitude,
    humanizeVelocity,
    islandTitleBarSx,
} from "../common/common.jsx";
import TargetNumberIcon from '../common/target-number-icon.jsx';
import { useTooltipOrientation } from '../common/tooltip-orientation.js';
import TargetMapSettingsDialog from './target-map-settings-dialog.jsx';
import TargetSkyViewSettingsDialog from './target-sky-view-settings-dialog.jsx';
import TargetViewPicker from './target-view-picker.jsx';
import CoordinateGrid from "../common/mercator-grid.jsx";
import createTerminatorLine from "../common/terminator-line.jsx";
import {getSunMoonCoords} from "../common/sunmoon.jsx";
import SolarSystemCanvas from "../celestial/solarsystem-canvas.jsx";
import PlanetariumCanvas from "../celestial/planetarium-canvas.jsx";
import CelestialToolbar from '../celestial/celestial-toolbar.jsx';
import { fetchTargetCelestialScene } from "../celestial/celestial-slice.jsx";
import {
    satelliteCoverageSelector,
    satelliteDetailsSelector,
    satellitePathsSelector,
    satellitePositionSelector,
    targetIdentifierSelector,
    targetTypeSelector,
    trackingStateSelector,
    satelliteTrackingStateSelector,
    satelliteTransmittersSelector,
} from "./state-selectors.jsx";
import {useSocket} from "../common/socket.jsx";
import {
    buildTargetCelestialPayload,
    buildTargetKeyFromTrackingState,
    buildTargetSceneRequestKey,
    clampTargetPassHours,
    filterPassesForTargetWindow,
    normalizeTargetType,
    resolveTargetDisplayName,
} from './celestial-target-utils.js';
import {resolveDynamicOrbitPathSegments} from '../common/orbit-path-dynamic-split.js';
import {
    MapLoadErrorDialog,
    MapRendererErrorBoundary,
    useMapLoadFailure,
} from '../common/map-load-error.jsx';

const storageMapZoomValueKey = "target-map-zoom-level";
const TARGET_SLOT_ID_PATTERN = /^target-(\d+)$/;

const getFullscreenElement = () => (
    document.fullscreenElement
    || document.webkitFullscreenElement
    || document.mozFullScreenElement
    || document.msFullscreenElement
    || null
);

const requestFullscreen = (element) => {
    if (!element) return;
    if (element.requestFullscreen) {
        element.requestFullscreen();
        return;
    }
    if (element.webkitRequestFullscreen) {
        element.webkitRequestFullscreen();
        return;
    }
    if (element.mozRequestFullScreen) {
        element.mozRequestFullScreen();
        return;
    }
    if (element.msRequestFullscreen) {
        element.msRequestFullscreen();
    }
};

const exitFullscreen = () => {
    if (document.exitFullscreen) {
        document.exitFullscreen();
        return;
    }
    if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
        return;
    }
    if (document.mozCancelFullScreen) {
        document.mozCancelFullScreen();
        return;
    }
    if (document.msExitFullscreen) {
        document.msExitFullscreen();
    }
};

// Match overview tracked-satellite tooltip style.
const TrackedSatelliteTooltip = styled(LeafletTooltip)(({ theme }) => ({
    color: theme.palette.text.primary,
    backgroundColor: theme.palette.error.dark,
    borderRadius: theme.shape.borderRadius,
    borderColor: theme.palette.error.main,
    whiteSpace: 'nowrap',
    zIndex: 1000,
    // Keep the arrow color aligned with the active orientation class.
    '&.leaflet-tooltip-bottom::before': {
        borderBottomColor: `${theme.palette.error.main} !important`,
    },
    '&.leaflet-tooltip-top::before': {
        borderTopColor: `${theme.palette.error.main} !important`,
    },
    '&.leaflet-tooltip-left::before': {
        borderLeftColor: `${theme.palette.error.main} !important`,
    },
    '&.leaflet-tooltip-right::before': {
        borderRightColor: `${theme.palette.error.main} !important`,
    },
}));

const TargetSatelliteMarker = React.memo(function TargetSatelliteMarker({
    position,
    satelliteName,
    altitudeLabel,
    velocityLabel,
    targetNumber,
}) {
    const map = useMap();
    const markerRef = useRef(null);
    const {
        direction: tooltipDirection,
        offset: tooltipOffset,
    } = useTooltipOrientation({
        map,
        markerRef,
        position,
        anchorDistance: 15,
        edgePadding: 10,
    });

    return (
        <Marker position={position} icon={satelliteIcon2} ref={markerRef}>
            <TrackedSatelliteTooltip
                key={`tooltip-${tooltipDirection}-${tooltipOffset[0]}-${tooltipOffset[1]}`}
                direction={tooltipDirection}
                offset={tooltipOffset}
                opacity={1}
                permanent
                className={"tooltip-satellite"}
                interactive={true}
            >
                <strong>
                    {targetNumber != null && (
                        <TargetNumberIcon
                            targetNumber={targetNumber}
                            prefix="T"
                            size={15}
                            sx={{ mr: 0.7, verticalAlign: 'middle', position: 'relative', top: -1 }}
                        />
                    )}
                    {satelliteName} - {`${altitudeLabel}, ${velocityLabel}`}
                </strong>
            </TrackedSatelliteTooltip>
        </Marker>
    );
});

// global leaflet map object
let MapObject = null;
const isFiniteNumber = (value) => Number.isFinite(Number(value));
const isValidLatLon = (lat, lon) => isFiniteNumber(lat) && isFiniteNumber(lon);
const isValidLatLonPoint = (point) =>
    Array.isArray(point)
    && point.length === 2
    && isValidLatLon(point[0], point[1]);
const isValidLatLonObjectPoint = (point) =>
    point
    && typeof point === 'object'
    && !Array.isArray(point)
    && isValidLatLon(point.lat, point.lon);
const isValidCoveragePoint = (point) =>
    isValidLatLonPoint(point) || isValidLatLonObjectPoint(point);
const hasSatelliteIdentity = (details) => {
    const nameValue = details?.name;
    if (typeof nameValue === 'string') {
        return nameValue.trim().length > 0;
    }
    if (nameValue && typeof nameValue === 'object') {
        return Object.keys(nameValue).length > 0;
    }
    return false;
};
const normalizeCoveragePoint = (point) => {
    if (isValidLatLonPoint(point)) {
        return [Number(point[0]), Number(point[1])];
    }
    if (isValidLatLonObjectPoint(point)) {
        return [Number(point.lat), Number(point.lon)];
    }
    return null;
};

const MapSlider = function ({handleSliderChange}) {
    const marks = [
        {
            value: 0,
            label: '0m',
        },
        {
            value: 15,
            label: '+15',
        },
        {
            value: -15,
            label: '-15',
        },
        {
            value: 30,
            label: '+30m',
        },
        {
            value: -30,
            label: '-30m',
        },
        {
            value: 45,
            label: '+45',
        },
        {
            value: -45,
            label: '-45',
        },
        {
            value: 60,
            label: '+60m',
        },
        {
            value: -60,
            label: '-60m',
        }
    ];

    return (
        <Box sx={{
            width: '100%;',
            bottom: 10,
            position: 'absolute',
            left: '0%',
            zIndex: 400,
            textAlign: 'center',
            opacity: 0.8,
        }}>
            <Slider
                valueLabelDisplay="on"
                marks={marks}
                size="medium"
                track={false}
                aria-label=""
                defaultValue={""}
                onChange={(e, value) => {
                    handleSliderChange(value);
                }}
                min={-60}
                max={60}
                sx={{
                    height: 20,
                    width: '70%',
                }}
            />
        </Box>
    );
};

const CenterHomeButton = React.memo(function CenterHomeButton() {
    const { t } = useTranslation('target');
    const {location} = useSelector(state => state.location);

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
    const { t } = useTranslation('target');
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
    const { t } = useTranslation('target');

    const handleMapFullscreen = () => {
        const mapContainer = MapObject.getContainer();
        if (!document.fullscreenElement) {
            if (mapContainer.requestFullscreen) {
                mapContainer.requestFullscreen();
            } else if (mapContainer.mozRequestFullScreen) {
                mapContainer.mozRequestFullScreen();
            } else if (mapContainer.webkitRequestFullscreen) {
                mapContainer.webkitRequestFullscreen();
            } else if (mapContainer.msRequestFullscreen) {
                mapContainer.msRequestFullscreen();
            }
        } else {
            // Exit fullscreen if we're already in it
            if (document.exitFullscreen) {
                document.exitFullscreen();
            } else if (document.mozCancelFullScreen) {
                document.mozCancelFullScreen();
            } else if (document.webkitExitFullscreen) {
                document.webkitExitFullscreen();
            } else if (document.msExitFullscreen) {
                document.msExitFullscreen();
            }
        }
    };

    return (
        <Fab size="small" color="primary" aria-label={t('map_controls.go_fullscreen')} onClick={handleMapFullscreen}>
            <FullscreenIcon/>
        </Fab>
    );
});

const ZoomInButton = React.memo(function ZoomInButton() {
    const { t } = useTranslation('target');

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
    const { t } = useTranslation('target');

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

const TargetAttributionBar = React.memo(function TargetAttributionBar({ htmlString }) {
    return (
        <MapStatusBar>
            <SimpleTruncatedHtml className={"attribution"} htmlString={htmlString}/>
        </MapStatusBar>
    );
});

const TargetMapCompositeView = ({}) => {
    const {socket} = useSocket();
    const dispatch = useDispatch();
    const { t } = useTranslation('target');
    const theme = useTheme();
    const {
        groupId,
        trackerId,
        trackerViews,
        satelliteId: noradId,
        rotatorData,
        showPastOrbitPath,
        showFutureOrbitPath,
        showSatelliteCoverage,
        showSunIcon,
        showMoonIcon,
        showTerminatorLine,
        showTooltip,
        lockOnTarget,
        terminatorLine,
        daySidePolygon,
        pastOrbitLineColor,
        futureOrbitLineColor,
        satelliteCoverageColor,
        orbitProjectionDuration,
        tileLayerID,
        mapEngine,
        mapZoomLevel,
        nextPassesHours,
        sunPos,
        moonPos,
        gridEditable,
        sliderTimeOffset,
        showGrid,
        enableMapDragging,
        enableMapZooming,
        targetViewMode,
        targetViewEnableDragging,
        targetViewEnableZooming,
    } = useSelector(state => state.targetSatTrack);
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
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
    const normalizedMapEngine = useMemo(
        () => normalizeMapEngine(mapEngine),
        [mapEngine]
    );
    const selectedTileLayer = useMemo(
        () => getTileLayerById(tileLayerID, { mapEngine: normalizedMapEngine, t }),
        [normalizedMapEngine, tileLayerID, t]
    );
    const attributionHtml = useMemo(
        () => `<a href="https://leafletjs.com" title="A JavaScript library for interactive maps" target="_blank" rel="noopener noreferrer">Leaflet</a> | ${selectedTileLayer.attribution}`,
        [selectedTileLayer.attribution]
    );
    const mapCrs = useMemo(
        () => getMapCrsByTileLayerId(tileLayerID, { mapEngine: normalizedMapEngine, t }),
        [normalizedMapEngine, tileLayerID]
    );

    const satellitePosition = useSelector(satellitePositionSelector);
    const satelliteCoverage = useSelector(satelliteCoverageSelector);
    const satelliteDetails = useSelector(satelliteDetailsSelector);
    const trackingState = useSelector(trackingStateSelector);
    const targetType = useSelector(targetTypeSelector);
    const targetIdentifier = useSelector(targetIdentifierSelector);
    const satelliteTrackingState = useSelector(satelliteTrackingStateSelector);
    const satellitePaths = useSelector(satellitePathsSelector);
    const satelliteTransmitters = useSelector(satelliteTransmittersSelector);
    const celestialState = useSelector((state) => state.celestial || {});
    // Share the dashboard's display options with the reused Solar System canvas.
    const solarSystemDisplayOptions = useSelector((state) => state.celestialDisplay?.solarSystem);
    const monitoredRows = useSelector((state) => state.celestialMonitored?.monitored || []);
    const {location} = useSelector(state => state.location);
    const scopedTrackerView = useMemo(
        () => (trackerId ? trackerViews?.[trackerId] || null : null),
        [trackerId, trackerViews]
    );
    const effectiveTrackingState = scopedTrackerView?.trackingState || trackingState || {};
    const effectiveRotatorData = scopedTrackerView?.rotatorData || rotatorData || {};
    const isSatelliteTarget = targetType === 'satellite';
    const mapLoadFailure = useMapLoadFailure({
        engine: 'Leaflet',
        loadKey: `${selectedTileLayer.id}:${selectedTileLayer.projection || 'EPSG3857'}`,
        enabled: isSatelliteTarget,
    });
    const tileEventHandlers = useMemo(() => ({
        load: () => mapLoadFailure.reportLoaded(),
        tileerror: (event) => mapLoadFailure.reportError(
            event?.error || new Error('Leaflet could not load one or more basemap tiles.')
        ),
    }), [mapLoadFailure.reportError, mapLoadFailure.reportLoaded]);
    const missionCommand = String(trackingState?.command || '').trim();
    const bodyId = String(trackingState?.body_id || '').trim().toLowerCase();
    const nonSatelliteTargetKey = useMemo(
        () => buildTargetKeyFromTrackingState(trackingState),
        [trackingState],
    );
    const nonSatelliteSceneRequestKey = useMemo(
        () => buildTargetSceneRequestKey({ trackingState, nextPassesHours }),
        [nextPassesHours, trackingState],
    );
    const targetScene = useSelector((state) => (
        state.celestial?.targetScenesByKey?.[nonSatelliteSceneRequestKey] || null
    ));
    const nonSatelliteTargetName = useMemo(() => {
        return resolveTargetDisplayName({
            trackingState,
            satelliteDetails,
            monitoredRows,
            celestialRows: targetScene?.celestialTracks?.celestial || [],
        }) || String(targetIdentifier || '').trim();
    }, [monitoredRows, satelliteDetails, targetIdentifier, targetScene?.celestialTracks?.celestial, trackingState]);
    const nonSatellitePayload = useMemo(
        () => buildTargetCelestialPayload({
            // Keep payload dependencies scoped to stable target identity fields.
            trackingState: {
                target_type: normalizeTargetType({ target_type: targetType, command: missionCommand, body_id: bodyId }),
                target_key: nonSatelliteTargetKey,
                command: missionCommand,
                body_id: bodyId,
            },
            targetName: nonSatelliteTargetName,
            nextPassesHours,
        }),
        [bodyId, missionCommand, nextPassesHours, nonSatelliteTargetKey, nonSatelliteTargetName, targetType],
    );
    const [focusTargetSignal, setFocusTargetSignal] = useState(0);
    const [nonSatelliteFitAllSignal, setNonSatelliteFitAllSignal] = useState(0);
    const [nonSatelliteZoomInSignal, setNonSatelliteZoomInSignal] = useState(0);
    const [nonSatelliteZoomOutSignal, setNonSatelliteZoomOutSignal] = useState(0);
    const [nonSatelliteResetZoomSignal, setNonSatelliteResetZoomSignal] = useState(0);
    const [nonSatelliteCenterSignal, setNonSatelliteCenterSignal] = useState(0);
    const [nonSatelliteFullscreen, setNonSatelliteFullscreen] = useState(false);
    const nonSatelliteViewportRef = useRef(null);
    const lastAutoFetchedSignatureRef = useRef('');
    const pendingFocusTargetKeyRef = useRef('');
    const [currentPastSatellitesPaths, setCurrentPastSatellitesPaths] = useState([]);
    const [currentFutureSatellitesPaths, setCurrentFutureSatellitesPaths] = useState([]);
    const [currentSatellitesPosition, setCurrentSatellitesPosition] = useState([]);
    const [currentSatellitesCoverage, setCurrentSatellitesCoverage] = useState([]);
    const [currentCrosshairs, setCurrentCrosshairs] = useState([]);
    const planetariumRotatorCrosshair = useMemo(() => {
        const az = Number(effectiveRotatorData?.az);
        const el = Number(effectiveRotatorData?.el);
        const connected = effectiveRotatorData?.connected === true;
        const tracking = effectiveRotatorData?.tracking === true
            || String(effectiveTrackingState?.rotator_state || '').trim().toLowerCase() === 'tracking';
        if (!connected || !tracking) return null;
        if (!Number.isFinite(az) || !Number.isFinite(el)) return null;
        return { visible: true, az, el };
    }, [
        effectiveRotatorData?.az,
        effectiveRotatorData?.el,
        effectiveRotatorData?.connected,
        effectiveRotatorData?.tracking,
        effectiveTrackingState?.rotator_state,
    ]);
    const planetariumRotatorMinElevation = useMemo(() => {
        const connected = effectiveRotatorData?.connected === true;
        const minElevation = Number(effectiveRotatorData?.minel);
        if (!connected || !Number.isFinite(minElevation)) return null;
        return minElevation;
    }, [
        effectiveRotatorData?.connected,
        effectiveRotatorData?.minel,
    ]);
    const clearRenderedSatelliteLayers = useCallback(() => {
        setCurrentPastSatellitesPaths([]);
        setCurrentFutureSatellitesPaths([]);
        setCurrentSatellitesPosition([]);
        setCurrentSatellitesCoverage([]);
        setCurrentCrosshairs([]);
    }, []);
    const handleSetMapZoomLevel = useCallback((zoomLevel) => {
        dispatch(setMapZoomLevel(zoomLevel));
    }, [dispatch]);
    const handleRefreshNonSatelliteScene = useCallback(async () => {
        if (!socket || !nonSatellitePayload) return;
        return dispatch(fetchTargetCelestialScene({
            socket,
            payload: nonSatellitePayload,
            requestKey: nonSatelliteSceneRequestKey,
        }));
    }, [dispatch, nonSatellitePayload, nonSatelliteSceneRequestKey, socket]);
    const nonSatelliteFetchSignature = useMemo(() => {
        if (isSatelliteTarget || !nonSatellitePayload) return '';
        const futureHours = clampTargetPassHours(nextPassesHours);
        return `${nonSatelliteSceneRequestKey}:${futureHours}`;
    }, [isSatelliteTarget, nextPassesHours, nonSatellitePayload, nonSatelliteSceneRequestKey]);

    useEffect(() => {
        if (!socket || !nonSatelliteFetchSignature || isSatelliteTarget || !nonSatellitePayload) {
            return;
        }
        // Tracker state updates arrive frequently. Fetch celestial tracks only when target identity/window changes.
        if (lastAutoFetchedSignatureRef.current === nonSatelliteFetchSignature) {
            return;
        }
        void handleRefreshNonSatelliteScene().then((result) => {
            if (fetchTargetCelestialScene.fulfilled.match(result)) {
                lastAutoFetchedSignatureRef.current = nonSatelliteFetchSignature;
            }
        });
    }, [
        handleRefreshNonSatelliteScene,
        isSatelliteTarget,
        nonSatelliteFetchSignature,
        nonSatellitePayload,
        socket,
    ]);

    useEffect(() => {
        if (
            isSatelliteTarget
            || targetViewMode !== TARGET_VIEW_MODE_SOLAR_SYSTEM
            || !nonSatelliteTargetKey
        ) {
            return;
        }

        // SolarSystemCanvas is mounted only after the user switches away from
        // the planetarium. Issue a fresh signal so its focus effect observes a
        // transition instead of inheriting a signal consumed by the old canvas.
        pendingFocusTargetKeyRef.current = nonSatelliteTargetKey;
        setFocusTargetSignal((value) => value + 1);
    }, [isSatelliteTarget, nonSatelliteTargetKey, targetViewMode]);
    useEffect(() => {
        const handleFullscreenChange = () => {
            const viewportElement = nonSatelliteViewportRef.current;
            const fullscreenElement = getFullscreenElement();
            setNonSatelliteFullscreen(Boolean(viewportElement && fullscreenElement === viewportElement));
        };

        handleFullscreenChange();
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
        document.addEventListener('mozfullscreenchange', handleFullscreenChange);
        document.addEventListener('MSFullscreenChange', handleFullscreenChange);
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
            document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
            document.removeEventListener('mozfullscreenchange', handleFullscreenChange);
            document.removeEventListener('MSFullscreenChange', handleFullscreenChange);
        };
    }, []);

    // Subscribe to map events
    function MapEventComponent({handleSetMapZoomLevel}) {
        const { t } = useTranslation('target');
        const mapEvents = useMapEvents({
            zoomend: () => {
                const mapZoom = mapEvents.getZoom();
                handleSetMapZoomLevel(mapZoom);
                localStorage.setItem(storageMapZoomValueKey, mapZoom);
            },
        });
        return null;
    }

    useEffect(() => {
        if (!isSatelliteTarget) {
            clearRenderedSatelliteLayers();
            return;
        }
        satelliteUpdate(new Date());

        return () => {
        };

    }, [satelliteDetails, satellitePosition, satellitePaths, satelliteCoverage, sliderTimeOffset, showTooltip,
        orbitProjectionDuration, tileLayerID, showPastOrbitPath, showFutureOrbitPath, showSatelliteCoverage,
        showSunIcon, showMoonIcon, showTerminatorLine, pastOrbitLineColor, futureOrbitLineColor,
        satelliteCoverageColor, isSatelliteTarget, clearRenderedSatelliteLayers]);

    useEffect(() => {
        if (!isSatelliteTarget) {
            clearRenderedSatelliteLayers();
            return;
        }
        if (trackerInstances.length > 0 && noradId) {
            return;
        }
        clearRenderedSatelliteLayers();
    }, [trackerInstances.length, noradId, clearRenderedSatelliteLayers, isSatelliteTarget]);

    const satelliteUpdate = function (now) {
        if (!isSatelliteTarget) {
            clearRenderedSatelliteLayers();
            return;
        }
        if (trackerInstances.length === 0 || !noradId) {
            clearRenderedSatelliteLayers();
            return;
        }
        if (hasSatelliteIdentity(satelliteDetails)) {

            const satelliteId = satelliteDetails?.norad_id || noradId;
            const satelliteName = satelliteDetails?.name || `NORAD ${satelliteId}`;
            const latitude = satellitePosition?.lat;
            const longitude = satellitePosition?.lon;
            const altitude = satellitePosition?.alt;
            const velocity = satellitePosition?.vel;
            const paths = satellitePaths || {};
            const dynamicPaths = resolveDynamicOrbitPathSegments({
                pastPath: paths?.past,
                futurePath: paths?.future,
                satellitePosition,
            });
            const coverage = satelliteCoverage;
            const hasValidSatellitePoint = isValidLatLon(latitude, longitude);
            const humanizedAltitude = humanizeAltitude(altitude, 0);
            const altitudeLabel = humanizedAltitude === "Invalid altitude"
                ? "-- km"
                : `${humanizedAltitude} km`;
            const velocityLabel = Number.isFinite(Number(velocity))
                ? `${Number(velocity).toFixed(2)} km/s`
                : "-- km/s";

            // generate current positions for the group of satellites
            let currentPos = [];
            let currentCoverage = [];
            let currentFuturePaths = [];
            let currentPastPaths = [];
            let currentCrosshair = [];

            // focus map on satellite, center on latitude only
            //let mapCoords = MapObject.getCenter();
            //MapObject.setView([latitude, longitude], MapObject.getZoom());

            if (Array.isArray(dynamicPaths?.past) && Array.isArray(dynamicPaths?.future)) {
                // past path
                currentPastPaths.push(<Polyline
                    key={`past-path-${noradId}`}
                    positions={dynamicPaths.past}
                    pathOptions={{
                        color: pastOrbitLineColor,
                        weight: 2,
                        opacity: 1,
                        smoothFactor: 1,
                    }}
                />)

                // future path
                currentFuturePaths.push(<Polyline
                    key={`future-path-${noradId}`}
                    positions={dynamicPaths.future}
                    pathOptions={{
                        color: futureOrbitLineColor,
                        weight: 2,
                        opacity: 0.8,
                        dashArray: "1 6",
                        lineCap: "round",
                        smoothFactor: 1,
                    }}
                />)
            }

            if (hasValidSatellitePoint) {
                const crosshairColor = theme.palette.error.main;
                const squareIcon = L.divIcon({
                    className: 'custom-square-marker',
                    html: `<div style="width: 30px; height: 30px; border: 2px solid ${crosshairColor}; opacity: 0.8; box-sizing: border-box;"></div>`,
                    iconSize: [30, 30],
                    iconAnchor: [15, 15],
                });

                currentCrosshair.push(
                    <React.Fragment key={`crosshair-${satelliteId}`}>
                        <Marker
                            position={[latitude, longitude]}
                            icon={squareIcon}
                            interactive={false}
                        />
                        <Polyline
                            positions={[
                                [latitude, -180],
                                [latitude, 180],
                            ]}
                            pathOptions={{
                                color: crosshairColor,
                                weight: 1,
                                opacity: 1,
                                smoothFactor: 1,
                            }}
                        />
                        <Polyline
                            positions={[
                                [-90, longitude],
                                [90, longitude],
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

            if (hasValidSatellitePoint && showTooltip) {
                currentPos.push(
                    <TargetSatelliteMarker
                        key={"marker-" + satelliteId}
                        position={[latitude, longitude]}
                        satelliteName={satelliteName}
                        altitudeLabel={altitudeLabel}
                        velocityLabel={velocityLabel}
                        targetNumber={targetNumber}
                    />
                );
            } else if (hasValidSatellitePoint) {
                currentPos.push(<Marker key={"marker-" + satelliteId} position={[latitude, longitude]}
                                        icon={satelliteIcon2}>
                </Marker>);
            }

            if (Array.isArray(coverage) && coverage.length > 0 && coverage.every(isValidCoveragePoint)) {
                //let coverage = [];
                //coverage = getSatelliteCoverageCircle(latitude, longitude, altitude, 360);
                currentCoverage.push(<Polyline
                    noClip={true}
                    key={"coverage-" + satelliteDetails['name']}
                    pathOptions={{
                        color: satelliteCoverageColor,
                        weight: 1,
                        fill: true,
                        fillOpacity: 0.2,
                    }}
                    positions={coverage}
                />);
            }

            setCurrentPastSatellitesPaths(currentPastPaths);
            setCurrentFutureSatellitesPaths(currentFuturePaths);
            setCurrentSatellitesPosition(currentPos);
            setCurrentSatellitesCoverage(currentCoverage);
            setCurrentCrosshairs(currentCrosshair);

        } else {
            //console.warn("No satellite data found for norad id: ", noradId, satelliteDetails);
            clearRenderedSatelliteLayers();
        }

        // Day/night boundary
        const terminatorLine = createTerminatorLine().reverse();
        dispatch(setTerminatorLine(terminatorLine));

        // Day side polygon
        const dayPoly = [...terminatorLine];
        dayPoly.push(dayPoly[dayPoly.length - 1]);
        dispatch(setDaySidePolygon(dayPoly));

        // sun and moon position
        const [sunPos, moonPos] = getSunMoonCoords();
        dispatch(setSunPos(sunPos));
        dispatch(setMoonPos(moonPos));
    }

    const handleWhenReady = (map) => {
        // map is ready
        MapObject = map.target;
    };

    // Keep target map focused on the selected satellite.
    // If coverage is shown, auto-fit to coverage bounds (legacy behavior).
    useEffect(() => {
        if (!isSatelliteTarget) return;
        if (!MapObject) return;
        if (!lockOnTarget) return;

        const selectedNoradId = String(noradId ?? '');
        const loadedNoradId = String(satelliteDetails?.norad_id ?? '');
        const lat = satellitePosition?.lat;
        const lon = satellitePosition?.lon;
        if (!isValidLatLon(lat, lon)) return;
        if (loadedNoradId !== selectedNoradId) return;

        const coveragePoints = Array.isArray(satelliteCoverage)
            ? satelliteCoverage
                .map(normalizeCoveragePoint)
                .filter((point) => Array.isArray(point) && point.length === 2)
            : [];
        if (showSatelliteCoverage && coveragePoints.length > 1) {
            const coverageBounds = L.latLngBounds(coveragePoints);
            if (coverageBounds.isValid()) {
                MapObject.fitBounds(coverageBounds, {
                    padding: [1, 1],
                    animate: false,
                });
                return;
            }
        }

        MapObject.setView([lat, lon], MapObject.getZoom(), { animate: false });
    }, [
        isSatelliteTarget,
        noradId,
        satelliteDetails?.norad_id,
        satellitePosition?.lat,
        satellitePosition?.lon,
        satelliteCoverage,
        showSatelliteCoverage,
        lockOnTarget,
    ]);

    useEffect(() => {
        if (!isSatelliteTarget) return;
        const intervalId = setInterval(() => {
            if (MapObject) {
                MapObject.invalidateSize();
            }
        }, 1000);

        return () => {
            clearInterval(intervalId);
        };
    }, [isSatelliteTarget]);

    useEffect(() => {
        if (!isSatelliteTarget) return;
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
    }, [tileLayerID, isSatelliteTarget]);

    useEffect(() => {
        if (!isSatelliteTarget) return;
        if (noradId) {
            dispatch(fetchSatellite({socket, noradId: noradId}));
        }

        return () => {

        };
    }, [noradId, isSatelliteTarget]);

    const nonSatelliteScene = useMemo(() => {
        const solarScene = targetScene?.solarScene || {};
        const tracksScene = targetScene?.celestialTracks || {};
        const rawCelestialRows = Array.isArray(tracksScene?.celestial) ? tracksScene.celestial : [];
        const rawPasses = Array.isArray(tracksScene?.celestial_passes) ? tracksScene.celestial_passes : [];
        const scopedRows = nonSatelliteTargetKey
            ? rawCelestialRows.filter((row) => String(row?.target_key || '').trim() === nonSatelliteTargetKey)
            : [];
        const scopedPasses = filterPassesForTargetWindow({
            passes: rawPasses,
            targetKey: nonSatelliteTargetKey,
            nextPassesHours: clampTargetPassHours(nextPassesHours),
        });

        return {
            ...solarScene,
            ...tracksScene,
            planets: Array.isArray(solarScene?.planets) ? solarScene.planets : [],
            observer_bodies: Array.isArray(celestialState?.observerSkyBodies)
                && celestialState.observerSkyBodies.length > 0
                ? celestialState.observerSkyBodies
                : (Array.isArray(tracksScene?.observer_bodies) ? tracksScene.observer_bodies : []),
            celestial: scopedRows,
            celestial_passes: scopedPasses,
        };
    }, [celestialState?.observerSkyBodies, nextPassesHours, nonSatelliteTargetKey, targetScene?.celestialTracks, targetScene?.solarScene]);
    const nonSatelliteHasFocusedTargetRow = useMemo(() => {
        if (!nonSatelliteTargetKey) return false;
        const scopedRows = Array.isArray(nonSatelliteScene?.celestial) ? nonSatelliteScene.celestial : [];
        return scopedRows.some((row) => String(row?.target_key || '').trim() === nonSatelliteTargetKey);
    }, [nonSatelliteScene?.celestial, nonSatelliteTargetKey]);

    useEffect(() => {
        if (isSatelliteTarget) return;
        if (!nonSatelliteTargetKey) return;
        if (!nonSatelliteHasFocusedTargetRow) return;
        // If focus was requested before tracks loaded, retry focus once rows for that key are available.
        if (pendingFocusTargetKeyRef.current !== nonSatelliteTargetKey) return;
        pendingFocusTargetKeyRef.current = '';
        setFocusTargetSignal((value) => value + 1);
    }, [isSatelliteTarget, nonSatelliteHasFocusedTargetRow, nonSatelliteTargetKey]);

    const handleOpenSettings = useCallback(() => {
        dispatch(setOpenMapSettingsDialog(true));
    }, [dispatch]);
    const handleToggleNonSatelliteFullscreen = useCallback(() => {
        const viewportElement = nonSatelliteViewportRef.current;
        if (!viewportElement) return;
        const fullscreenElement = getFullscreenElement();
        if (fullscreenElement === viewportElement) {
            exitFullscreen();
            return;
        }
        requestFullscreen(viewportElement);
    }, []);
    const targetSceneLoading = Boolean(targetScene?.loading);
    if (!isSatelliteTarget) {
        const nonSatelliteTitle = targetType === 'mission' ? 'Target Map · Mission' : 'Target Map · Body';

        return (
            <Box
                ref={nonSatelliteViewportRef}
                sx={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0,
                    '&:fullscreen': {
                        width: '100vw',
                        height: '100vh',
                        bgcolor: 'background.paper',
                    },
                    '&:-webkit-full-screen': {
                        width: '100vw',
                        height: '100vh',
                        bgcolor: 'background.paper',
                    },
                }}
            >
                <TitleBar
                    className={getClassNamesBasedOnGridEditing(gridEditable, ["window-title-bar"])}
                    sx={{...islandTitleBarSx, containerType: 'inline-size', containerName: 'target-view-header'}}
                >
                    <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', minWidth: 0}}>
                        <Box sx={{display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, gap: 0.75}}>
                            <Typography variant="subtitle2" sx={{fontWeight: 'bold', minWidth: 0}} noWrap>
                                {nonSatelliteTitle}
                            </Typography>
                            <Typography variant="caption" sx={{ color: 'text.secondary', minWidth: 0 }} noWrap>
                                {nonSatelliteTargetName || '-'}
                            </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexShrink: 0 }}>
                            <TargetViewPicker targetType={targetType}/>
                            <Tooltip title={t('view_settings.customize_title', {defaultValue: 'Customize current view'})}>
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
                            <Tooltip title={t('target_map_composite_view.refresh_target_scene', { defaultValue: 'Refresh target scene' })}>
                                <span>
                                    <IconButton
                                        size="small"
                                        onClick={handleRefreshNonSatelliteScene}
                                        disabled={!socket || !nonSatellitePayload || targetSceneLoading}
                                        sx={{ padding: '2px' }}
                                    >
                                        <RefreshIcon fontSize="small" />
                                    </IconButton>
                                </span>
                            </Tooltip>
                        </Box>
                    </Box>
                </TitleBar>
                <TargetSkyViewSettingsDialog updateBackend={() => {
                    const key = 'target-map-settings';
                    dispatch(setTargetMapSetting({socket, key}));
                }}/>
                <CelestialToolbar
                    onFitAll={() => setNonSatelliteFitAllSignal((value) => value + 1)}
                    onZoomIn={() => setNonSatelliteZoomInSignal((value) => value + 1)}
                    onZoomOut={() => setNonSatelliteZoomOutSignal((value) => value + 1)}
                    onZoomReset={() => setNonSatelliteResetZoomSignal((value) => value + 1)}
                    onCenterSun={() => setNonSatelliteCenterSignal((value) => value + 1)}
                    onRefresh={handleRefreshNonSatelliteScene}
                    loading={targetSceneLoading}
                    loadingText={targetSceneLoading ? 'Loading...' : ''}
                    disabled={!socket || !nonSatellitePayload}
                    onToggleFullscreen={handleToggleNonSatelliteFullscreen}
                    fullscreen={nonSatelliteFullscreen}
                    fullscreenLabel={t('map_controls.go_fullscreen', { defaultValue: 'Go fullscreen' })}
                    exitFullscreenLabel={t('map_controls.exit_fullscreen', { defaultValue: 'Exit fullscreen' })}
                    showZoomButtons={!targetViewEnableZooming}
                />
                <Box sx={{ width: '100%', flex: 1, minHeight: 0 }}>
                    {!nonSatellitePayload ? (
                        <Box sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2 }}>
                            <Typography variant="body2" sx={{ color: 'text.secondary', textAlign: 'center' }}>
                                {t('target_map_composite_view.select_a_mission_body_target_to_render_the_solar_system_', { defaultValue: 'Select a mission/body target to render the solar-system viewport.' })}
                            </Typography>
                        </Box>
                    ) : (
                        <Box sx={{ height: '100%', minHeight: 220, position: 'relative' }}>
                            {targetViewMode === TARGET_VIEW_MODE_PLANETARIUM ? (
                                <PlanetariumCanvas
                                    scene={nonSatelliteScene}
                                    selectedTargetKeys={nonSatelliteTargetKey ? [nonSatelliteTargetKey] : []}
                                    focusTargetKey={nonSatelliteTargetKey}
                                    rotatorCrosshair={planetariumRotatorCrosshair}
                                    rotatorMinElevation={planetariumRotatorMinElevation}
                                    enableMapDragging={targetViewEnableDragging}
                                    enableMapZooming={targetViewEnableZooming}
                                    fitAllSignal={nonSatelliteFitAllSignal}
                                    zoomInSignal={nonSatelliteZoomInSignal}
                                    zoomOutSignal={nonSatelliteZoomOutSignal}
                                    resetZoomSignal={nonSatelliteResetZoomSignal}
                                    centerSunSignal={nonSatelliteCenterSignal}
                                />
                            ) : (
                                <SolarSystemCanvas
                                    scene={nonSatelliteScene}
                                    selectedTargetKeys={nonSatelliteTargetKey ? [nonSatelliteTargetKey] : []}
                                    fitAllSignal={nonSatelliteFitAllSignal}
                                    focusTargetSignal={focusTargetSignal}
                                    focusTargetKey={nonSatelliteTargetKey}
                                    zoomInSignal={nonSatelliteZoomInSignal}
                                    zoomOutSignal={nonSatelliteZoomOutSignal}
                                    resetZoomSignal={nonSatelliteResetZoomSignal}
                                    centerSunSignal={nonSatelliteCenterSignal}
                                    instantFocus={true}
                                    initialViewport={celestialState?.mapSettings?.solarSystemViewport || null}
                                    enableMapDragging={targetViewEnableDragging}
                                    enableMapZooming={targetViewEnableZooming}
                                    displayOptions={solarSystemDisplayOptions}
                                />
                            )}
                            {targetSceneLoading ? (
                                <Box
                                    sx={{
                                        position: 'absolute',
                                        inset: 0,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        flexDirection: 'column',
                                        gap: 1.25,
                                        bgcolor: (theme) => theme.palette.mode === 'dark'
                                            ? 'rgba(8, 10, 14, 0.72)'
                                            : 'rgba(248, 250, 255, 0.78)',
                                        pointerEvents: 'none',
                                    }}
                                >
                                    <CircularProgress size={34} />
                                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                                        {targetViewMode === TARGET_VIEW_MODE_PLANETARIUM
                                            ? 'Loading planetarium vectors...'
                                            : 'Loading target scene...'}
                                    </Typography>
                                </Box>
                            ) : null}
                        </Box>
                    )}
                </Box>
            </Box>
        );
    }

    return (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <TitleBar
                className={getClassNamesBasedOnGridEditing(gridEditable, ["window-title-bar"])}
                sx={{...islandTitleBarSx, containerType: 'inline-size', containerName: 'target-view-header'}}
            >
                <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', minWidth: 0}}>
                    <Box sx={{display: 'flex', alignItems: 'center', minWidth: 0}}>
                        <Typography variant="subtitle2" sx={{fontWeight: 'bold', minWidth: 0}} noWrap>
                            {t('satellite_map.title')}
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexShrink: 0 }}>
                        <TargetViewPicker targetType="satellite"/>
                        <Tooltip title={t('view_settings.customize_title', {defaultValue: 'Customize current view'})}>
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
            <Box sx={{ width: '100%', flex: 1, minHeight: 0, position: 'relative' }}>
                {/* Leaflet CRS is immutable after map init, so remount when projection changes. */}
                <MapRendererErrorBoundary
                    key={`target-map-boundary-${normalizedMapEngine}-${selectedTileLayer.id}-${mapLoadFailure.attempt}`}
                    onError={mapLoadFailure.reportError}
                >
                <MapContainer
                    key={`target-map-${normalizedMapEngine}-${selectedTileLayer.id}-${selectedTileLayer.projection || 'EPSG3857'}-${enableMapDragging}-${enableMapZooming}-${mapLoadFailure.attempt}`}
                    className="target-map"
                    center={satellitePosition?.lat && satellitePosition?.lon ? [satellitePosition.lat, satellitePosition.lon] : [0, 0]}
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

                <Box sx={{'& > :not(style)': {m: 1}}} style={{right: 5, top: 5, position: 'absolute'}}>
                    <CenterHomeButton/>
                    <CenterMapButton/>
                    <FullscreenMapButton/>
                </Box>

                {!enableMapZooming ? (
                    <Box
                        sx={{'& > :not(style)': {m: 1}, display: 'flex', flexDirection: 'column'}}
                        style={{left: 5, top: 5, position: 'absolute'}}
                    >
                        <ZoomInButton/>
                        <ZoomOutButton/>
                    </Box>
                ) : null}

                <TargetMapSettingsDialog updateBackend={() => {
                    const key = 'target-map-settings';
                    dispatch(setTargetMapSetting({socket, key: key}));
                }}/>

                {sunPos && showSunIcon ? (
                    isValidLatLonPoint(sunPos) ? <Marker position={sunPos} icon={sunIcon} opacity={0.5}/> : null
                ) : null}

                {moonPos && showMoonIcon ? (
                    isValidLatLonPoint(moonPos) ? <Marker position={moonPos} icon={moonIcon} opacity={0.5}/> : null
                ) : null}

                {daySidePolygon.length > 1 && showTerminatorLine && (
                    <Polygon
                        positions={daySidePolygon}
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

                {terminatorLine.length > 1 && showTerminatorLine && (
                    <Polyline
                        positions={terminatorLine}
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

                {showPastOrbitPath ? currentPastSatellitesPaths : null}
                {showFutureOrbitPath ? currentFutureSatellitesPaths : null}
                {currentCrosshairs}
                {currentSatellitesPosition}
                {showSatelliteCoverage ? currentSatellitesCoverage : null}


                {!enableMapDragging ? <MapArrowControls mapObject={MapObject} verticalOffset={25}/> : null}

                {showGrid && (
                    <CoordinateGrid
                        latInterval={15}
                        lngInterval={15}
                        latColor="#FFFFFF"
                        lngColor="#FFFFFF"
                        weight={1}
                        opacity={0.5}
                        showLabels={false}
                    />
                )}
                </MapContainer>
                </MapRendererErrorBoundary>
                <MapLoadErrorDialog
                    failure={mapLoadFailure.failure}
                    onClose={mapLoadFailure.dismiss}
                    onRetry={mapLoadFailure.retry}
                />
                <TargetAttributionBar htmlString={attributionHtml}/>
            </Box>
        </Box>
    );
};

export default TargetMapCompositeView;
