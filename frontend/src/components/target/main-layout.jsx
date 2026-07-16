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


import React, {useState, useEffect, useCallback, useRef} from 'react';
import {Responsive, useContainerWidth} from 'react-grid-layout';
import L from 'leaflet';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import 'leaflet/dist/leaflet.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import {Box, Fab, Slider} from "@mui/material";
import {
    StyledIslandParent,
    StyledIslandParentNoScrollbar,
    StyledIslandParentScrollbar,
} from "../common/common.jsx";
import {toast} from "../../utils/toast-with-timestamp.jsx";
import {useSocket} from "../common/socket.jsx";
import {useDispatch, useSelector} from "react-redux";
import {useTranslation} from 'react-i18next';
import {
    setSatGroupId,
    setMapZoomLevel,
    setGridEditable,
    getTrackingStateFromBackend,
    setSatelliteId,
    fetchNextPasses,
} from './target-slice.jsx'
import TargetInfoIsland from "./target-info-island.jsx";
import NextPassesIsland from "./next-passes.jsx";
import {
    satellitePositionSelector,
    satelliteCoverageSelector,
    satelliteDetailsSelector,
    satelliteTrackingStateSelector,
    satellitePathsSelector,
    satelliteTransmittersSelector
} from './state-selectors.jsx';
import TargetViewRouter from './target-view-router.jsx';
import SatellitePassTimeline from "./timeline-main.jsx";
import TargetSelectorBar from "./target-selector-bar.jsx";
import RotatorControl from "../dashboard/rotator-control.jsx";
import RigControl from "../dashboard/rig-control.jsx";



// global leaflet map object
let MapObject = null;
const storageMapZoomValueKey = "target-map-zoom-level";

// global callback for dashboard editing here
const setGridEditableTargetEvent = 'target-set-grid-editable';
export const handleSetGridEditableTarget = function (value) {
    window.dispatchEvent(new CustomEvent(setGridEditableTargetEvent, {detail: value}));
};

export const gridLayoutStoreName = 'target-sat-track-layouts';
const LAYOUT_SCHEMA_VERSION = 5;
const SHARED_RESIZE_HANDLES = ['s', 'sw', 'w', 'se', 'nw', 'ne', 'e'];
const FIXED_ISLAND_HEIGHTS = {
    lg: {'rotator-control': 29, 'rig-control': 29},
    md: {'rotator-control': 29, 'rig-control': 29},
    sm: {'rotator-control': 29, 'rig-control': 29},
    xs: {'rotator-control': 29, 'rig-control': 29},
    xxs: {'rotator-control': 29, 'rig-control': 29},
};

// -------------------------------------------------
// Leaflet icon path fix for React
// -------------------------------------------------
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.9.3/dist/images/marker-shadow.png'
});

// load / save layouts from localStorage
function loadLayoutsFromLocalStorage() {
    try {
        const raw = localStorage.getItem(gridLayoutStoreName);
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
            return null;
        }

        // Enforce new default layout by rejecting legacy/unversioned payloads.
        if (!('version' in parsed) || !('layouts' in parsed)) {
            return null;
        }

        return parsed.version === LAYOUT_SCHEMA_VERSION ? parsed.layouts : null;
    } catch {
        return null;
    }
}

function saveLayoutsToLocalStorage(layouts) {
    localStorage.setItem(
        gridLayoutStoreName,
        JSON.stringify({
            version: LAYOUT_SCHEMA_VERSION,
            layouts,
        }),
    );
}

function normalizeLayoutsResizeHandles(layouts) {
    if (!layouts || typeof layouts !== 'object') {
        return layouts;
    }

    return Object.fromEntries(
        Object.entries(layouts).map(([breakpoint, items]) => [
            breakpoint,
            Array.isArray(items)
                ? items.map((item) => ({
                    ...item,
                    resizeHandles: [...SHARED_RESIZE_HANDLES],
                }))
                : items,
        ]),
    );
}

function ensureLayoutsContainRequiredItems(layouts, defaultLayouts) {
    if (!layouts || typeof layouts !== 'object') {
        return layouts;
    }

    return Object.fromEntries(
        Object.entries(layouts).map(([breakpoint, items]) => {
            const currentItems = Array.isArray(items) ? [...items] : [];
            const defaultItems = Array.isArray(defaultLayouts?.[breakpoint]) ? defaultLayouts[breakpoint] : [];
            const currentKeys = new Set(currentItems.map((item) => item?.i).filter(Boolean));
            const missingDefaults = defaultItems.filter((item) => item?.i && !currentKeys.has(item.i));
            return [breakpoint, [...currentItems, ...missingDefaults]];
        }),
    );
}

function removeDeprecatedLayoutItems(layouts) {
    if (!layouts || typeof layouts !== 'object') {
        return layouts;
    }

    return Object.fromEntries(
        Object.entries(layouts).map(([breakpoint, items]) => [
            breakpoint,
            Array.isArray(items)
                ? items.filter((item) => item?.i !== 'transmitters')
                : items,
        ]),
    );
}

function enforceFixedIslandHeights(layouts) {
    if (!layouts || typeof layouts !== 'object') {
        return layouts;
    }

    return Object.fromEntries(
        Object.entries(layouts).map(([breakpoint, items]) => {
            const fixedHeights = FIXED_ISLAND_HEIGHTS[breakpoint] || {};
            return [
                breakpoint,
                Array.isArray(items)
                    ? items.map((item) => {
                        const fixedHeight = fixedHeights[item?.i];
                        if (!fixedHeight) return item;
                        return {
                            ...item,
                            h: fixedHeight,
                            minH: fixedHeight,
                            maxH: fixedHeight,
                        };
                    })
                    : items,
            ];
        }),
    );
}

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
}


const TrackingLayout = React.memo(function TrackingLayout() {
    const {socket} = useSocket();
    const dispatch = useDispatch();
    const {t} = useTranslation('target');
    const {
        groupId,
        satelliteId: noradId,
        showPastOrbitPath,
        showFutureOrbitPath,
        showSatelliteCoverage,
        showSunIcon,
        showMoonIcon,
        showTerminatorLine,
        showTooltip,
        terminatorLine,
        daySidePolygon,
        pastOrbitLineColor,
        futureOrbitLineColor,
        satelliteCoverageColor,
        orbitProjectionDuration,
        tileLayerID,
        mapZoomLevel,
        sunPos,
        moonPos,
        gridEditable,
        sliderTimeOffset,
        openMapSettingsDialog,
        showGrid,
        nextPassesHours,
    } = useSelector(state => state.targetSatTrack);

    const satellitePosition = useSelector(satellitePositionSelector);
    const satelliteCoverage = useSelector(satelliteCoverageSelector);
    const satelliteDetails = useSelector(satelliteDetailsSelector);
    const satelliteTrackingState = useSelector(satelliteTrackingStateSelector);
    const satellitePaths = useSelector(satellitePathsSelector);
    const satelliteTransmitters = useSelector(satelliteTransmittersSelector);

    const {location} = useSelector(state => state.location);
    const satelliteName = useSelector((state) => state.targetSatTrack.satelliteData?.details?.name || null);
    const [currentPastSatellitesPaths, setCurrentPastSatellitesPaths] = useState([]);
    const [currentFutureSatellitesPaths, setCurrentFutureSatellitesPaths] = useState([]);
    const [currentSatellitesPosition, setCurrentSatellitesPosition] = useState([]);
    const [currentSatellitesCoverage, setCurrentSatellitesCoverage] = useState([]);
    const coverageRef = useRef(null);

    const {width, containerRef, mounted} = useContainerWidth({measureBeforeMount: true});

    // Handler for refreshing timeline passes
    const handleRefreshTimelinePasses = () => {
        if (noradId) {
            dispatch(fetchNextPasses({
                socket,
                noradId: noradId,
                hours: nextPassesHours,
                forceRecalculate: true
            }));
        }
    };

    // default layout if none in localStorage
    const defaultLayouts = {
        "lg": [{
            "i": "map",
            "x": 0,
            "y": 0,
            "w": 20,
            "h": 29,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }, {
            "i": "info",
            "x": 40,
            "y": 0,
            "w": 8,
            "h": 29,
            "minH": 7,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }, {
            "i": "passes",
            "x": 0,
            "y": 43,
            "w": 48,
            "h": 14,
            "minH": 7,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }, {
            "i": "timeline",
            "x": 0,
            "y": 29,
            "w": 48,
            "h": 14,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }, {
            "i": "rotator-control",
            "x": 20,
            "y": 0,
            "w": 10,
            "h": 29,
            "minH": 29,
            "maxH": 29,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }, {
            "i": "rig-control",
            "x": 30,
            "y": 0,
            "w": 10,
            "h": 29,
            "minH": 29,
            "maxH": 29,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }],
        "md": [{
            "i": "map",
            "x": 0,
            "y": 0,
            "w": 28,
            "h": 24,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }, {
            "i": "info",
            "x": 28,
            "y": 0,
            "w": 12,
            "h": 24,
            "minH": 7,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }, {
            "i": "passes",
            "x": 0,
            "y": 68,
            "w": 40,
            "h": 18,
            "minH": 7,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }, {
            "i": "timeline",
            "x": 0,
            "y": 53,
            "w": 40,
            "h": 15,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }, {
            "i": "rotator-control",
            "x": 0,
            "y": 24,
            "w": 20,
            "h": 29,
            "minH": 29,
            "maxH": 29,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }, {
            "i": "rig-control",
            "x": 20,
            "y": 24,
            "w": 20,
            "h": 29,
            "minH": 29,
            "maxH": 29,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }],
        "sm": [{
            "i": "map",
            "x": 0,
            "y": 0,
            "w": 12,
            "h": 27,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }, {
            "i": "info",
            "x": 12,
            "y": 0,
            "w": 12,
            "h": 27,
            "minH": 7,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }, {
            "i": "passes",
            "x": 0,
            "y": 67,
            "w": 24,
            "h": 17,
            "minH": 7,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }, {
            "i": "timeline",
            "x": 0,
            "y": 56,
            "w": 24,
            "h": 11,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }, {
            "i": "rotator-control",
            "x": 0,
            "y": 27,
            "w": 12,
            "h": 29,
            "minH": 29,
            "maxH": 29,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }, {
            "i": "rig-control",
            "x": 12,
            "y": 27,
            "w": 12,
            "h": 29,
            "minH": 29,
            "maxH": 29,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }],
        "xs": [{
            "i": "map",
            "x": 0,
            "y": 0,
            "w": 8,
            "h": 17,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }, {
            "i": "info",
            "x": 0,
            "y": 17,
            "w": 8,
            "h": 27,
            "minH": 7,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }, {
            "i": "passes",
            "x": 0,
            "y": 86,
            "w": 8,
            "h": 19,
            "minH": 7,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }, {
            "i": "timeline",
            "x": 0,
            "y": 73,
            "w": 8,
            "h": 13,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }, {
            "i": "rotator-control",
            "x": 0,
            "y": 44,
            "w": 4,
            "h": 29,
            "minH": 29,
            "maxH": 29,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }, {
            "i": "rig-control",
            "x": 4,
            "y": 44,
            "w": 4,
            "h": 29,
            "minH": 29,
            "maxH": 29,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }],
        "xxs": [{
            "i": "map",
            "x": 0,
            "y": 0,
            "w": 8,
            "h": 17,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }, {
            "i": "info",
            "x": 0,
            "y": 17,
            "w": 8,
            "h": 29,
            "minH": 7,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }, {
            "i": "passes",
            "x": 0,
            "y": 58,
            "w": 8,
            "h": 24,
            "minH": 7,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }, {
            "i": "timeline",
            "x": 0,
            "y": 46,
            "w": 8,
            "h": 12,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }, {
            "i": "rotator-control",
            "x": 0,
            "y": 82,
            "w": 8,
            "h": 29,
            "minH": 29,
            "maxH": 29,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }, {
            "i": "rig-control",
            "x": 0,
            "y": 111,
            "w": 8,
            "h": 29,
            "minH": 29,
            "maxH": 29,
            "moved": false,
            "static": false,
            "resizeHandles": ["s", "sw", "w", "se", "nw", "ne", "e"]
        }]
    };

    useEffect(() => {
        const onSetGridEditable = (event) => {
            dispatch(setGridEditable(event.detail));
        };

        window.addEventListener(setGridEditableTargetEvent, onSetGridEditable);
        return () => {
            window.removeEventListener(setGridEditableTargetEvent, onSetGridEditable);
        };
    }, [dispatch]);

    const handleSetMapZoomLevel = useCallback((zoomLevel) => {
        dispatch(setMapZoomLevel(zoomLevel));
    }, [dispatch]);

    // we load any stored layouts from localStorage or fallback to default
    const [layouts, setLayouts] = useState(() => {
        const loaded = loadLayoutsFromLocalStorage();
        const mergedLayouts = ensureLayoutsContainRequiredItems((loaded ?? defaultLayouts), defaultLayouts);
        const withoutDeprecatedItems = removeDeprecatedLayoutItems(mergedLayouts);
        const constrainedLayouts = enforceFixedIslandHeights(withoutDeprecatedItems);
        return normalizeLayoutsResizeHandles(constrainedLayouts);
    });

    function handleLayoutsChange(currentLayout, allLayouts) {
        const mergedLayouts = ensureLayoutsContainRequiredItems(allLayouts, defaultLayouts);
        const withoutDeprecatedItems = removeDeprecatedLayoutItems(mergedLayouts);
        const constrainedLayouts = enforceFixedIslandHeights(withoutDeprecatedItems);
        const normalizedLayouts = normalizeLayoutsResizeHandles(constrainedLayouts);
        setLayouts(normalizedLayouts);
    }

    useEffect(() => {
        saveLayoutsToLocalStorage(layouts);
    }, [layouts]);

    useEffect(() => {
        // we do this here once onmount,
        // we set the norad id and group id, once only here
        dispatch(getTrackingStateFromBackend({socket}))
            .unwrap()
            .then((response) => {
                // Handle null/undefined response for first-time users
                if (response && response['value']) {
                    const noradId = response['value']['norad_id'];
                    const groupId = response['value']['group_id'];
                    dispatch(setSatelliteId(noradId));
                    dispatch(setSatGroupId(groupId))
                }
            })
            .catch((error) => {
                toast.error(`${t('errors.failed_get_tracking_state')}: ${error}`);
            });

        return () => {
        };
    }, []);

    // pre-make the components
    let gridContents = [
        <StyledIslandParent key="map">
            <TargetViewRouter/>
        </StyledIslandParent>,
        <StyledIslandParentScrollbar key="info">
            <TargetInfoIsland/>
        </StyledIslandParentScrollbar>,
        <StyledIslandParentNoScrollbar key="passes">
            <NextPassesIsland/>
        </StyledIslandParentNoScrollbar>,
        <StyledIslandParentNoScrollbar key="timeline">
            <SatellitePassTimeline
                timeWindowHours={nextPassesHours}
                satelliteName={satelliteName}
                labelType="peak"
                onRefresh={handleRefreshTimelinePasses}
                showGeostationarySatellites={true}
            />
        </StyledIslandParentNoScrollbar>,
        <StyledIslandParentScrollbar key="rotator-control">
            <RotatorControl/>
        </StyledIslandParentScrollbar>,
        <StyledIslandParentScrollbar key="rig-control">
            <RigControl/>
        </StyledIslandParentScrollbar>,
    ];

    const ResponsiveGridLayoutParent = mounted ? (
        <Responsive
            width={width}
            className="layout"
            layouts={layouts}
            onLayoutChange={handleLayoutsChange}
            breakpoints={{lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0}}
            cols={{lg: 48, md: 40, sm: 24, xs: 8, xxs: 8}}
            rowHeight={8}
            dragConfig={{enabled: gridEditable, handle: '.react-grid-draggable'}}
            resizeConfig={{enabled: gridEditable}}
        >
            {gridContents}
        </Responsive>
    ) : null;

    return (
        <>
            <TargetSelectorBar/>
            <div ref={containerRef}>
                {ResponsiveGridLayoutParent}
            </div>
        </>
    );
});

export default TrackingLayout;
