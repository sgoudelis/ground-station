import React, { useEffect, useState } from 'react';
import {
    Alert,
    AlertTitle,
    Box,
    Button,
    CircularProgress,
    IconButton,
    Tooltip,
    Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { Responsive, useContainerWidth } from 'react-grid-layout';
import { absoluteStrategy } from 'react-grid-layout/core';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { useSocket } from '../common/socket.jsx';
import {
    getClassNamesBasedOnGridEditing,
    islandTitleBarSx,
    StyledIslandParentNoScrollbar,
    TitleBar,
} from '../common/common.jsx';
import DeferredIslandPlaceholder from '../common/deferredplaceholder.jsx';
import {
    fetchCelestialTracks,
    fetchSolarSystemScene,
    getCelestialMapSettings,
    refreshMonitoredCelestialNow,
    setCelestialMapSettings,
} from './celestial-slice.jsx';
import { fetchMonitoredCelestial } from './monitored-slice.jsx';
import { setOpenGridSettingsDialog } from './monitored-slice.jsx';
import CelestialToolbar from './celestial-toolbar.jsx';
import CelestialStatusBar from './celestial-statusbar.jsx';
import SolarSystemCanvas from './solarsystem-canvas.jsx';
import PlanetariumCanvas from './planetarium-canvas.jsx';
import CelestialTopBar from './celestial-topbar.jsx';
import PageTabsLayout from '../common/page-tabs.jsx';
import MonitoredCelestialGridIsland from './monitored-grid-island.jsx';
import CelestialPasses from './celestial-passes.jsx';
import CelestialPassTimeline from './celestial-pass-timeline.jsx';
import CelestialInfoIsland from './celestial-info-island.jsx';
import SolarSystemLayoutOptionsDialog from './solar-system-layout-options-dialog.jsx';
import SettingsIcon from '@mui/icons-material/Settings';
import GridOnIcon from '@mui/icons-material/GridOn';
import ExploreIcon from '@mui/icons-material/Explore';
import StarIcon from '@mui/icons-material/Star';
import HubIcon from '@mui/icons-material/Hub';
import RouteIcon from '@mui/icons-material/Route';
import PublicIcon from '@mui/icons-material/Public';
import LabelIcon from '@mui/icons-material/Label';
import BlurCircularIcon from '@mui/icons-material/BlurCircular';
import GrainIcon from '@mui/icons-material/Grain';
import {
    setPlanetariumDisplayOption,
    setSolarSystemDisplayOption,
} from './celestial-display-slice.jsx';
import {
    buildTargetKeyFromCelestialRow,
    buildTargetSlotNumberByTargetKey,
} from '../target/celestial-target-utils.js';

export const gridLayoutStoreName = 'celestial-layouts';
const LAYOUT_SCHEMA_VERSION = 7;
const SHARED_RESIZE_HANDLES = ['s', 'sw', 'w', 'se', 'nw', 'ne', 'e'];
const DEFAULT_PAST_HOURS = 6;
const DEFAULT_FUTURE_HOURS = 24;
const DEFAULT_STEP_MINUTES = 60;
const MAX_PAST_PROJECTION_HOURS = 168;
const MAX_FUTURE_PROJECTION_HOURS = 720;
const VIEW_MODE_SOLAR_SYSTEM = 'solar-system';
const VIEW_MODE_PLANETARIUM = 'planetarium';
const DEFERRED_ISLAND_COUNT = 4;
const normalizeViewMode = (value) => (
    value === VIEW_MODE_PLANETARIUM ? VIEW_MODE_PLANETARIUM : VIEW_MODE_SOLAR_SYSTEM
);
const parsePastProjectionHours = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(parsed, MAX_PAST_PROJECTION_HOURS);
};
const parseFutureProjectionHours = (value, fallback) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
    return Math.min(parsed, MAX_FUTURE_PROJECTION_HOURS);
};
const parsePositiveNumber = (value, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};
const hasFiniteXYZ = (position) => (
    Array.isArray(position)
    && position.length >= 3
    && position.slice(0, 3).every((value) => Number.isFinite(Number(value)))
);
const getFullscreenElement = () =>
    document.fullscreenElement
    || document.webkitFullscreenElement
    || document.mozFullScreenElement
    || document.msFullscreenElement
    || null;
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

function ensureRequiredLayoutItems(layouts) {
    if (!layouts || typeof layouts !== 'object') {
        return layouts;
    }

    const fallbackItems = {
        lg: [
            { i: 'monitored-celestial', x: 5, y: 0, w: 5, h: 13 },
            { i: 'celestial-info', x: 10, y: 0, w: 2, h: 13 },
            { i: 'celestial-timeline', x: 0, y: 13, w: 12, h: 6 },
            { i: 'celestial-passes', x: 0, y: 19, w: 12, h: 7 },
        ],
        md: [
            { i: 'monitored-celestial', x: 0, y: 15, w: 10, h: 8 },
            { i: 'celestial-info', x: 7, y: 0, w: 3, h: 15 },
            { i: 'celestial-timeline', x: 0, y: 30, w: 10, h: 6 },
            { i: 'celestial-passes', x: 0, y: 23, w: 10, h: 7 },
        ],
        sm: [
            { i: 'monitored-celestial', x: 1, y: 13, w: 5, h: 13 },
            { i: 'celestial-info', x: 4, y: 26, w: 2, h: 13 },
            { i: 'celestial-timeline', x: 0, y: 39, w: 6, h: 6 },
            { i: 'celestial-passes', x: 0, y: 45, w: 6, h: 7 },
        ],
        xs: [
            { i: 'monitored-celestial', x: 0, y: 18, w: 2, h: 9 },
            { i: 'celestial-info', x: 0, y: 41, w: 2, h: 8 },
            { i: 'celestial-timeline', x: 0, y: 35, w: 2, h: 6 },
            { i: 'celestial-passes', x: 0, y: 27, w: 2, h: 8 },
        ],
        xxs: [
            { i: 'monitored-celestial', x: 0, y: 18, w: 2, h: 9 },
            { i: 'celestial-info', x: 0, y: 41, w: 2, h: 8 },
            { i: 'celestial-timeline', x: 0, y: 35, w: 2, h: 6 },
            { i: 'celestial-passes', x: 0, y: 27, w: 2, h: 8 },
        ],
    };

    return Object.fromEntries(
        Object.entries(layouts).map(([breakpoint, items]) => {
            const typedItems = Array.isArray(items) ? items : [];
            const existingItemIds = new Set(
                typedItems.map((item) => String(item?.i || '').trim()).filter(Boolean),
            );
            const requiredItems = fallbackItems[breakpoint] || [];
            let nextBottomY = typedItems.reduce(
                (maxY, item) => Math.max(maxY, Number(item?.y || 0) + Number(item?.h || 0)),
                0,
            );
            const nextItems = [...typedItems];

            requiredItems.forEach((fallback) => {
                if (existingItemIds.has(fallback.i)) {
                    return;
                }
                const itemY = Math.max(Number(fallback.y || 0), nextBottomY);
                const nextItem = {
                    ...fallback,
                    y: itemY,
                    resizeHandles: [...SHARED_RESIZE_HANDLES],
                };
                nextItems.push(nextItem);
                existingItemIds.add(fallback.i);
                nextBottomY = itemY + Number(fallback.h || 0);
            });

            return [breakpoint, nextItems];
        }),
    );
}

const defaultLayouts = {
    lg: [
        { i: 'solar-system', x: 0, y: 0, w: 19, h: 29, moved: false, static: false, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        { i: 'monitored-celestial', x: 19, y: 0, w: 21, h: 29, moved: false, static: false, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        { i: 'celestial-info', x: 40, y: 0, w: 8, h: 29, moved: false, static: false, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        { i: 'celestial-timeline', x: 0, y: 29, w: 48, h: 11, moved: false, static: false, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        { i: 'celestial-passes', x: 0, y: 40, w: 48, h: 15, moved: false, static: false, resizeHandles: [...SHARED_RESIZE_HANDLES] },
    ],
    md: [
        { i: 'solar-system', x: 0, y: 0, w: 28, h: 27, moved: false, static: false, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        { i: 'monitored-celestial', x: 0, y: 27, w: 40, h: 20, moved: false, static: false, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        { i: 'celestial-info', x: 28, y: 0, w: 12, h: 27, moved: false, static: false, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        { i: 'celestial-timeline', x: 0, y: 47, w: 40, h: 12, moved: false, static: false, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        { i: 'celestial-passes', x: 0, y: 59, w: 40, h: 18, moved: false, static: false, resizeHandles: [...SHARED_RESIZE_HANDLES] },
    ],
    sm: [
        { i: 'solar-system', x: 0, y: 0, w: 15, h: 26, moved: false, static: false, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        { i: 'monitored-celestial', x: 0, y: 26, w: 24, h: 18, moved: false, static: false, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        { i: 'celestial-info', x: 15, y: 0, w: 9, h: 26, moved: false, static: false, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        { i: 'celestial-timeline', x: 0, y: 44, w: 24, h: 12, moved: false, static: false, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        { i: 'celestial-passes', x: 0, y: 56, w: 24, h: 17, moved: false, static: false, resizeHandles: [...SHARED_RESIZE_HANDLES] },
    ],
    xs: [
        { i: 'solar-system', x: 0, y: 0, w: 5, h: 28, moved: false, static: false, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        { i: 'monitored-celestial', x: 0, y: 28, w: 8, h: 23, moved: false, static: false, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        { i: 'celestial-info', x: 5, y: 0, w: 3, h: 28, moved: false, static: false, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        { i: 'celestial-timeline', x: 0, y: 51, w: 8, h: 11, moved: false, static: false, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        { i: 'celestial-passes', x: 0, y: 62, w: 8, h: 17, moved: false, static: false, resizeHandles: [...SHARED_RESIZE_HANDLES] },
    ],
    xxs: [
        { i: 'solar-system', x: 0, y: 0, w: 8, h: 23, moved: false, static: false, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        { i: 'monitored-celestial', x: 0, y: 51, w: 8, h: 18, moved: false, static: false, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        { i: 'celestial-info', x: 0, y: 23, w: 8, h: 28, moved: false, static: false, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        { i: 'celestial-timeline', x: 0, y: 69, w: 8, h: 12, moved: false, static: false, resizeHandles: [...SHARED_RESIZE_HANDLES] },
        { i: 'celestial-passes', x: 0, y: 81, w: 8, h: 16, moved: false, static: false, resizeHandles: [...SHARED_RESIZE_HANDLES] },
    ],
};

const CelestialMainLayout = () => {
    const { t: tCelestial } = useTranslation('celestial');
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const isEditing = useSelector((state) => state.dashboard?.isEditing);
    const celestialState = useSelector((state) => state.celestial);
    const solarSystemDisplayOptions = useSelector((state) => state.celestialDisplay?.solarSystem);
    const planetariumDisplayOptions = useSelector((state) => state.celestialDisplay?.planetarium);
    const monitoredState = useSelector((state) => state.celestialMonitored);
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
    const { width, containerRef, mounted } = useContainerWidth({ measureBeforeMount: true });

    const [layouts, setLayouts] = useState(() => {
        const loaded = loadLayoutsFromLocalStorage();
        return ensureRequiredLayoutItems(normalizeLayoutsResizeHandles(loaded ?? defaultLayouts));
    });
    const [fitAllSignal, setFitAllSignal] = useState(0);
    const [focusTargetSignal, setFocusTargetSignal] = useState(0);
    const [focusTargetKey, setFocusTargetKey] = useState('');
    const [zoomInSignal, setZoomInSignal] = useState(0);
    const [zoomOutSignal, setZoomOutSignal] = useState(0);
    const [resetZoomSignal, setResetZoomSignal] = useState(0);
    const [centerSunSignal, setCenterSunSignal] = useState(0);
    const [openSolarSystemLayoutOptionsDialog, setOpenSolarSystemLayoutOptionsDialog] = useState(false);
    const [solarSystemFullscreen, setSolarSystemFullscreen] = useState(false);
    const [showRefreshOverlay, setShowRefreshOverlay] = useState(false);
    const [deferredIslandCount, setDeferredIslandCount] = useState(0);
    const [solarCanvasStatusInfo, setSolarCanvasStatusInfo] = useState({
        gestureHintText: '',
        scaleLabel: '',
    });
    const solarSystemViewportRef = React.useRef(null);
    const previousRenderableSolarBodiesCountRef = React.useRef(0);
    const autoFocusedTargetKeyRef = React.useRef('');
    const mapSettingsRef = React.useRef(celestialState.mapSettings);
    mapSettingsRef.current = celestialState.mapSettings;

    const projectionSettings = React.useMemo(() => {
        const mapSettings = celestialState.mapSettings || {};
        return {
            past_hours: parsePastProjectionHours(mapSettings.pastHours, DEFAULT_PAST_HOURS),
            future_hours: parseFutureProjectionHours(mapSettings.futureHours, DEFAULT_FUTURE_HOURS),
            step_minutes: parsePositiveNumber(mapSettings.stepMinutes, DEFAULT_STEP_MINUTES),
        };
    }, [celestialState.mapSettings]);
    const interactionSettings = React.useMemo(() => {
        const mapSettings = celestialState.mapSettings || {};
        return {
            enableMapDragging: Boolean(mapSettings.enableMapDragging),
            enableMapZooming: Boolean(mapSettings.enableMapZooming),
        };
    }, [celestialState.mapSettings]);
    const viewMode = React.useMemo(
        () => normalizeViewMode(celestialState.mapSettings?.viewMode),
        [celestialState.mapSettings?.viewMode],
    );

    const sceneRequestPayload = React.useMemo(
        () => ({
            past_hours: projectionSettings.past_hours,
            future_hours: projectionSettings.future_hours,
            step_minutes: projectionSettings.step_minutes,
        }),
        [projectionSettings.future_hours, projectionSettings.past_hours, projectionSettings.step_minutes],
    );

    const handleLayoutsChange = (currentLayout, allLayouts) => {
        const normalizedLayouts = normalizeLayoutsResizeHandles(allLayouts);
        const mergedLayouts = ensureRequiredLayoutItems(normalizedLayouts);
        setLayouts(mergedLayouts);
    };

    useEffect(() => {
        saveLayoutsToLocalStorage(layouts);
    }, [layouts]);

    useEffect(() => {
        if (!mounted) return undefined;

        let cancelled = false;
        let frameId = null;
        let nextIslandCount = 1;
        const mountNextIsland = () => {
            if (cancelled) return;

            // The map is the first useful part of this route. Mount each data
            // grid/island in a separate frame so route navigation stays usable.
            React.startTransition(() => {
                setDeferredIslandCount(nextIslandCount);
            });
            nextIslandCount += 1;
            if (nextIslandCount <= DEFERRED_ISLAND_COUNT) {
                frameId = window.requestAnimationFrame(mountNextIsland);
            }
        };

        frameId = window.requestAnimationFrame(mountNextIsland);
        return () => {
            cancelled = true;
            if (frameId != null) window.cancelAnimationFrame(frameId);
        };
    }, [mounted]);

    useEffect(() => {
        if (!socket) return;
        let cancelled = false;
        let connectionGeneration = 0;

        const loadInitialScene = async () => {
            const generation = ++connectionGeneration;
            dispatch(fetchMonitoredCelestial({ socket }));
            // Wait for persisted projection settings before requesting the scene.
            // Otherwise a new browser first fills the defaults, then immediately
            // starts another Horizons batch for the user's saved window.
            const settingsResult = await dispatch(getCelestialMapSettings({ socket }));
            if (cancelled || generation !== connectionGeneration) return;

            const mapSettings = getCelestialMapSettings.fulfilled.match(settingsResult)
                ? settingsResult.payload || mapSettingsRef.current || {}
                : mapSettingsRef.current || {};
            const projection = {
                past_hours: parsePastProjectionHours(
                    mapSettings.pastHours,
                    DEFAULT_PAST_HOURS,
                ),
                future_hours: parseFutureProjectionHours(
                    mapSettings.futureHours,
                    DEFAULT_FUTURE_HOURS,
                ),
                step_minutes: parsePositiveNumber(
                    mapSettings.stepMinutes,
                    DEFAULT_STEP_MINUTES,
                ),
            };
            await dispatch(fetchSolarSystemScene({
                socket,
                payload: {
                    ...projection,
                    // Initial page load must fill missing Horizons-backed system bodies
                    // for the selected projection; cache-only loads can leave planets
                    // present only as non-renderable metadata rows.
                    allow_network_fetch: true,
                },
            }));
            if (cancelled || generation !== connectionGeneration) return;
            // Full tracks are fetched when the page connects; the scheduler's
            // frequent broadcasts now contain only live pointing deltas.
            await dispatch(fetchCelestialTracks({ socket, payload: projection }));
        };

        socket.on('connect', loadInitialScene);
        if (socket.connected) loadInitialScene();
        return () => {
            cancelled = true;
            socket.off('connect', loadInitialScene);
        };
    }, [socket, dispatch]);

    useEffect(() => {
        // Keep toggle icon state in sync when fullscreen changes via ESC/browser controls.
        const handleFullscreenChange = () => {
            const viewportElement = solarSystemViewportRef.current;
            const fullscreenElement = getFullscreenElement();
            setSolarSystemFullscreen(Boolean(viewportElement && fullscreenElement === viewportElement));
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

    const handleRefreshSolarSystem = React.useCallback(async () => {
        if (!socket) return;
        await dispatch(fetchSolarSystemScene({
            socket,
            payload: {
                ...sceneRequestPayload,
                allow_network_fetch: true,
                retry_horizons: true,
            },
        }));
    }, [socket, dispatch, sceneRequestPayload]);
    const handleRefreshMonitored = React.useCallback(async () => {
        if (!socket) return;
        await dispatch(refreshMonitoredCelestialNow({
            socket,
            payload: {
                retry_horizons: true,
            },
        }));
        await dispatch(fetchMonitoredCelestial({ socket }));
    }, [socket, dispatch]);
    const handleToggleSolarSystemFullscreen = React.useCallback(() => {
        const viewportElement = solarSystemViewportRef.current;
        if (!viewportElement) return;
        const fullscreenElement = getFullscreenElement();
        if (fullscreenElement === viewportElement) {
            exitFullscreen();
            return;
        }
        requestFullscreen(viewportElement);
    }, []);
    const handleSolarStatusBarInfoChange = React.useCallback((nextStatusInfo) => {
        const nextGestureHintText = String(nextStatusInfo?.gestureHintText || '');
        const nextScaleLabel = String(nextStatusInfo?.scaleLabel || '');
        setSolarCanvasStatusInfo((previous) => {
            if (
                previous.gestureHintText === nextGestureHintText
                && previous.scaleLabel === nextScaleLabel
            ) {
                return previous;
            }
            return {
                gestureHintText: nextGestureHintText,
                scaleLabel: nextScaleLabel,
            };
        });
    }, []);

    const handleViewportCommit = React.useCallback((nextViewport) => {
        if (!socket) return;

        const existing = celestialState.mapSettings || {};
        const prev = existing.solarSystemViewport || {};
        const unchanged =
            Number(prev.zoom) === Number(nextViewport.zoom)
            && Number(prev.panX) === Number(nextViewport.panX)
            && Number(prev.panY) === Number(nextViewport.panY);

        if (unchanged) return;

        dispatch(
            setCelestialMapSettings({
                socket,
                value: {
                    ...existing,
                    solarSystemViewport: nextViewport,
                },
            }),
        );
    }, [socket, celestialState.mapSettings, dispatch]);

    const combinedScene = React.useMemo(() => {
        const solar = celestialState.solarScene || {};
        const tracks = celestialState.celestialTracks || {};
        return {
            ...solar,
            ...tracks,
            planets: solar.planets || [],
            observer_bodies: tracks.observer_bodies || [],
            celestial: tracks.celestial || [],
            celestial_passes: tracks.celestial_passes || [],
            meta: {
                ...(solar.meta || {}),
                ...(tracks.meta || {}),
            },
        };
    }, [celestialState.solarScene, celestialState.celestialTracks]);
    const solarBodies = Array.isArray(combinedScene?.planets) ? combinedScene.planets : [];
    const bodyTypeCounts = combinedScene?.meta?.solar_system?.body_type_counts || {};
    const inferredCounts = solarBodies.reduce(
        (acc, body) => {
            if (body?.body_type === 'moon' || (body?.body_type == null && body?.parent_id)) {
                acc.moons += 1;
            } else {
                acc.planets += 1;
            }
            return acc;
        },
        { planets: 0, moons: 0 },
    );
    const planetsCount = (
        Number.isFinite(Number(bodyTypeCounts?.planet))
            ? Number(bodyTypeCounts.planet)
            : inferredCounts.planets
    ) + (
        Number.isFinite(Number(bodyTypeCounts?.dwarf))
            ? Number(bodyTypeCounts.dwarf)
            : 0
    );
    const moonsCount = Number.isFinite(Number(bodyTypeCounts?.moon))
        ? Number(bodyTypeCounts.moon)
        : inferredCounts.moons;
    const trackedCount = combinedScene?.celestial?.length || 0;
    const hasSolarScene = (planetsCount + moonsCount) > 0;
    const hasPersistedMonitoredSelection = Boolean((monitoredState?.selectedIds || []).length > 0);
    const solarCacheMissingCount = Number(combinedScene?.meta?.solar_system?.cache?.missing_count || 0);
    const horizonsStatus = celestialState?.solarScene?.meta?.horizons
        || combinedScene?.meta?.horizons
        || {};
    const horizonsStaleCount = Number(horizonsStatus?.stale_count || 0);
    const horizonsOfflineCount = Number(horizonsStatus?.offline_count || 0);
    const horizonsCachedCount = Number(horizonsStatus?.cached_count || 0);
    const horizonsUnavailable = horizonsStatus?.availability === 'unavailable';
    const horizonsReason = React.useMemo(() => {
        const reason = String(horizonsStatus?.reason || 'unavailable');
        return tCelestial(`horizons.reasons.${reason}`, {
            defaultValue: reason.replaceAll('_', ' '),
        });
    }, [horizonsStatus?.reason, tCelestial]);
    const formatHorizonsTime = React.useCallback((value) => {
        if (!value) return tCelestial('horizons.unknown_time', { defaultValue: 'unknown' });
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return String(value);
        return parsed.toLocaleString();
    }, [tCelestial]);
    const horizonsMessage = React.useMemo(() => {
        if (horizonsOfflineCount > 0) {
            return tCelestial('horizons.offline_message', {
                count: horizonsOfflineCount,
                defaultValue: `Showing approximate offline positions for ${horizonsOfflineCount} bodies. Passes and celestial tracking require Horizons data.`,
            });
        }
        if (horizonsCachedCount > 0 || horizonsStaleCount > 0) {
            return tCelestial('horizons.cached_message', {
                count: horizonsCachedCount || horizonsStaleCount,
                defaultValue: `Showing stale cached data for ${horizonsCachedCount || horizonsStaleCount} bodies.`,
            });
        }
        if (solarCacheMissingCount <= 0) {
            return tCelestial('horizons.service_message', {
                defaultValue: 'Automatic Horizons requests are paused until the next retry.',
            });
        }
        return tCelestial('horizons.missing_message', {
            count: solarCacheMissingCount,
            defaultValue: `No usable data is available for ${solarCacheMissingCount} bodies.`,
        });
    }, [
        horizonsCachedCount,
        horizonsOfflineCount,
        horizonsStaleCount,
        solarCacheMissingCount,
        tCelestial,
    ]);
    const renderableSolarBodiesCount = React.useMemo(
        () => solarBodies.filter((body) => hasFiniteXYZ(body?.position_xyz_au)).length,
        [solarBodies],
    );
    const solarSystemDataError = React.useMemo(() => {
        if (solarCacheMissingCount <= 0 || renderableSolarBodiesCount > 0) return '';
        return tCelestial('main_layout.solar_system_horizons_missing', {
            count: solarCacheMissingCount,
            defaultValue: `Horizons vectors unavailable for ${solarCacheMissingCount} solar-system bodies.`,
        });
    }, [solarCacheMissingCount, renderableSolarBodiesCount, tCelestial]);
    const solarLoading = Boolean(celestialState?.solarLoading);
    React.useEffect(() => {
        const previousCount = previousRenderableSolarBodiesCountRef.current;
        // Progressive rows redraw immediately, but framing a partial batch can
        // leave the final outer planets off-screen. Fit once the batch settles.
        if (solarLoading && previousCount === 0) return;
        previousRenderableSolarBodiesCountRef.current = renderableSolarBodiesCount;
        if (viewMode !== VIEW_MODE_SOLAR_SYSTEM) return;
        if (previousCount !== 0 || renderableSolarBodiesCount <= 0) return;
        if (hasPersistedMonitoredSelection) return;

        // A persisted viewport can point at an old target-only scene. When the
        // system layer first becomes renderable, fit once so planets/moons are
        // actually visible without requiring a manual toolbar action.
        setFitAllSignal((value) => value + 1);
    }, [renderableSolarBodiesCount, viewMode, hasPersistedMonitoredSelection, solarLoading]);
    const tracksLoading = Boolean(celestialState?.tracksLoading);
    const solarSystemLoading = solarLoading || tracksLoading;
    const isSolarRefreshing = solarSystemLoading && viewMode === VIEW_MODE_SOLAR_SYSTEM && hasSolarScene;
    const isPlanetariumRefreshing = tracksLoading && viewMode === VIEW_MODE_PLANETARIUM && trackedCount > 0;
    const refreshOverlayRequested = isSolarRefreshing || isPlanetariumRefreshing;
    React.useEffect(() => {
        if (!refreshOverlayRequested) {
            setShowRefreshOverlay(false);
            return undefined;
        }

        // Cached scene assembly often finishes within a single paint. Delay the
        // in-canvas indicator so those quick refreshes do not flash a spinner.
        const timer = window.setTimeout(() => setShowRefreshOverlay(true), 300);
        return () => window.clearTimeout(timer);
    }, [refreshOverlayRequested]);
    const selectedInfoTargetKey = React.useMemo(() => {
        const focusedKey = String(focusTargetKey || '').trim();
        if (focusedKey) {
            return focusedKey;
        }

        const rows = monitoredState?.monitored || [];
        const selectedId = (monitoredState?.selectedIds || [])[0];
        const selectedRow = rows.find((row) => row.id === selectedId);
        if (!selectedRow) return '';

        return buildTargetKeyFromCelestialRow(selectedRow);
    }, [focusTargetKey, monitoredState?.monitored, monitoredState?.selectedIds]);
    const selectedTargetKeys = React.useMemo(
        () => (selectedInfoTargetKey ? [selectedInfoTargetKey] : []),
        [selectedInfoTargetKey],
    );
    React.useEffect(() => {
        const selectedId = (monitoredState?.selectedIds || [])[0];
        const targetKey = String(selectedInfoTargetKey || '').trim();
        if (viewMode !== VIEW_MODE_SOLAR_SYSTEM || selectedId == null || !targetKey) {
            autoFocusedTargetKeyRef.current = '';
            return;
        }

        if (String(focusTargetKey || '').trim() === targetKey) {
            autoFocusedTargetKeyRef.current = targetKey;
            return;
        }

        const trackedRows = Array.isArray(combinedScene?.celestial) ? combinedScene.celestial : [];
        const selectedTrackAvailable = trackedRows.some(
            (row) => buildTargetKeyFromCelestialRow(row) === targetKey,
        );
        if (!selectedTrackAvailable) return;
        if (autoFocusedTargetKeyRef.current === targetKey) return;

        // During refresh/bootstrap, wait for the selected tracked row to arrive,
        // then focus once so persisted selection controls the viewport.
        autoFocusedTargetKeyRef.current = targetKey;
        setFocusTargetKey(targetKey);
        setFocusTargetSignal((value) => value + 1);
    }, [
        combinedScene?.celestial,
        focusTargetKey,
        monitoredState?.selectedIds,
        selectedInfoTargetKey,
        viewMode,
    ]);
    const targetNumberByTargetKey = React.useMemo(
        () => buildTargetSlotNumberByTargetKey(trackerInstances),
        [trackerInstances],
    );
    const tracksProgress = celestialState?.tracksProgress || null;
    const tracksProgressText = React.useMemo(() => {
        if (!tracksLoading) return '';
        const current = Number(tracksProgress?.current);
        const total = Number(tracksProgress?.total);
        if (Number.isFinite(current) && Number.isFinite(total) && total > 0) {
            return `${Math.max(0, Math.min(current, total))}/${total}`;
        }
        return tCelestial('main_layout.loading');
    }, [tracksLoading, tracksProgress?.current, tracksProgress?.total, tCelestial]);
    const solarToolbarLoadingText = React.useMemo(() => {
        if (!solarSystemLoading || viewMode !== VIEW_MODE_SOLAR_SYSTEM) return '';
        if (tracksLoading) return tracksProgressText;
        return tCelestial('main_layout.loading');
    }, [solarSystemLoading, tracksLoading, tracksProgressText, viewMode, tCelestial]);

    const updateProjectionSetting = React.useCallback(async (updates) => {
        if (!socket) return;
        const existing = celestialState.mapSettings || {};
        const nextSettings = { ...existing, ...updates };
        const unchanged = Object.keys(updates).every((key) => existing[key] === nextSettings[key]);
        if (unchanged) return;

        const result = await dispatch(
            setCelestialMapSettings({
                socket,
                value: nextSettings,
            }),
        );
        if (!setCelestialMapSettings.fulfilled.match(result)) return;

        const projectionChanged = ['pastHours', 'futureHours', 'stepMinutes'].some(
            (key) => Object.prototype.hasOwnProperty.call(updates, key),
        );
        if (!projectionChanged) return;

        // The scene-manager stream is cache-only. When the user changes the
        // projection window, explicitly fill that window so the table/timeline
        // do not stay on the previously cached span.
        await dispatch(
            fetchSolarSystemScene({
                socket,
                payload: {
                    past_hours: parsePastProjectionHours(nextSettings.pastHours, DEFAULT_PAST_HOURS),
                    future_hours: parseFutureProjectionHours(nextSettings.futureHours, DEFAULT_FUTURE_HOURS),
                    step_minutes: parsePositiveNumber(nextSettings.stepMinutes, DEFAULT_STEP_MINUTES),
                    allow_network_fetch: true,
                },
            }),
        );
    }, [socket, celestialState.mapSettings, dispatch]);
    const updateViewMode = React.useCallback((nextViewMode) => {
        if (!socket) return;
        const normalizedViewMode = normalizeViewMode(nextViewMode);
        const existing = celestialState.mapSettings || {};
        if (normalizeViewMode(existing.viewMode) === normalizedViewMode) return;

        dispatch(
            setCelestialMapSettings({
                socket,
                value: {
                    ...existing,
                    viewMode: normalizedViewMode,
                },
            }),
        );
    }, [socket, celestialState.mapSettings, dispatch]);
    const handleToggleMapDragging = React.useCallback(() => {
        updateProjectionSetting({
            enableMapDragging: !interactionSettings.enableMapDragging,
        });
    }, [interactionSettings.enableMapDragging, updateProjectionSetting]);
    const handleToggleMapZooming = React.useCallback(() => {
        updateProjectionSetting({
            enableMapZooming: !interactionSettings.enableMapZooming,
        });
    }, [interactionSettings.enableMapZooming, updateProjectionSetting]);
    const handleTogglePlanetariumDisplayOption = React.useCallback((key) => {
        dispatch(setPlanetariumDisplayOption({
            key,
            value: !planetariumDisplayOptions?.[key],
        }));
    }, [dispatch, planetariumDisplayOptions]);
    const handleToggleSolarSystemDisplayOption = React.useCallback((key) => {
        dispatch(setSolarSystemDisplayOption({
            key,
            value: !solarSystemDisplayOptions?.[key],
        }));
    }, [dispatch, solarSystemDisplayOptions]);
    const handleToggleSolarSystemLabels = React.useCallback(() => {
        // Treat a mixed label state as off so one click restores all labels.
        const nextValue = !(
            solarSystemDisplayOptions?.showPlanetLabels
            && solarSystemDisplayOptions?.showTrackedLabels
        );
        dispatch(setSolarSystemDisplayOption({ key: 'showPlanetLabels', value: nextValue }));
        dispatch(setSolarSystemDisplayOption({ key: 'showTrackedLabels', value: nextValue }));
    }, [dispatch, solarSystemDisplayOptions]);
    const solarSystemToolbarToggles = React.useMemo(() => {
        const buildToggle = (key, labelKey, icon) => ({
            key,
            label: tCelestial(labelKey),
            pressed: Boolean(solarSystemDisplayOptions?.[key]),
            onClick: () => handleToggleSolarSystemDisplayOption(key),
            icon,
        });

        return [
            buildToggle('showGrid', 'layout_options.options.show_grid.label', <GridOnIcon />),
            buildToggle('showPlanetOrbits', 'layout_options.options.show_planet_orbits.label', <BlurCircularIcon />),
            buildToggle('showTrackedOrbits', 'layout_options.options.show_tracked_orbits.label', <RouteIcon />),
            {
                key: 'showLabels',
                label: tCelestial('toolbar.show_labels'),
                pressed: Boolean(
                    solarSystemDisplayOptions?.showPlanetLabels
                    && solarSystemDisplayOptions?.showTrackedLabels
                ),
                onClick: handleToggleSolarSystemLabels,
                icon: <LabelIcon />,
            },
            buildToggle(
                'showStarfieldBackground',
                'layout_options.options.show_bright_star_field.label',
                <StarIcon />,
            ),
            buildToggle('showAsteroidZones', 'layout_options.options.show_asteroid_zones.label', <GrainIcon />),
        ];
    }, [
        handleToggleSolarSystemDisplayOption,
        handleToggleSolarSystemLabels,
        solarSystemDisplayOptions,
        tCelestial,
    ]);
    const planetariumToolbarToggles = React.useMemo(() => {
        const buildToggle = (key, labelKey, icon) => ({
            key,
            label: tCelestial(labelKey),
            pressed: Boolean(planetariumDisplayOptions?.[key]),
            onClick: () => handleTogglePlanetariumDisplayOption(key),
            icon,
        });

        return [
            buildToggle('showGrid', 'layout_options.options.show_sky_grid.label', <GridOnIcon />),
            buildToggle('showHorizonCompass', 'layout_options.options.show_horizon_compass.label', <ExploreIcon />),
            buildToggle('showStarField', 'layout_options.options.show_star_field.label', <StarIcon />),
            buildToggle(
                'showConstellationLabels',
                'layout_options.options.show_constellation_labels.label',
                <HubIcon />,
            ),
            buildToggle('showPassCurves', 'layout_options.options.show_pass_curves.label', <RouteIcon />),
            buildToggle('showPlanetLabels', 'layout_options.options.show_planet_labels.label', <PublicIcon />),
            buildToggle('showTargetLabels', 'layout_options.options.show_target_labels.label', <LabelIcon />),
        ];
    }, [handleTogglePlanetariumDisplayOption, planetariumDisplayOptions, tCelestial]);
    const handleTargetAdded = React.useCallback((targetKey) => {
        const normalizedTargetKey = String(targetKey || '').trim();
        if (!normalizedTargetKey) return;
        autoFocusedTargetKeyRef.current = normalizedTargetKey;
        setFocusTargetKey(normalizedTargetKey);
        setFocusTargetSignal((value) => value + 1);
    }, []);

    const gridContents = [
        <StyledIslandParentNoScrollbar key="solar-system">
            <Box
                ref={solarSystemViewportRef}
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
                    className={getClassNamesBasedOnGridEditing(isEditing, [])}
                    sx={{ ...islandTitleBarSx, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                    <Box component="span">
                        {viewMode === VIEW_MODE_PLANETARIUM
                            ? tCelestial('main_layout.planetarium_title')
                            : tCelestial('main_layout.solar_system_layout_title')}
                    </Box>
                    <Tooltip title={tCelestial('toolbar.layout_options')}>
                        <span>
                            <IconButton
                                size="small"
                                onClick={() => setOpenSolarSystemLayoutOptionsDialog(true)}
                                sx={{ p: 0.25 }}
                            >
                                <SettingsIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>
                </TitleBar>
                <CelestialToolbar
                    onFitAll={() => setFitAllSignal((value) => value + 1)}
                    onZoomIn={() => setZoomInSignal((value) => value + 1)}
                    onZoomOut={() => setZoomOutSignal((value) => value + 1)}
                    onZoomReset={() => setResetZoomSignal((value) => value + 1)}
                    onCenterSun={() => setCenterSunSignal((value) => value + 1)}
                    onRefresh={handleRefreshSolarSystem}
                    loading={viewMode === VIEW_MODE_PLANETARIUM ? tracksLoading : solarSystemLoading}
                    loadingText={viewMode === VIEW_MODE_PLANETARIUM ? tracksProgressText : solarToolbarLoadingText}
                    disabled={!socket}
                    onToggleFullscreen={handleToggleSolarSystemFullscreen}
                    fullscreen={solarSystemFullscreen}
                    fullscreenLabel={tCelestial('toolbar.go_fullscreen')}
                    exitFullscreenLabel={tCelestial('toolbar.exit_fullscreen')}
                    mapDraggingEnabled={interactionSettings.enableMapDragging}
                    mapZoomingEnabled={interactionSettings.enableMapZooming}
                    onToggleMapDragging={handleToggleMapDragging}
                    onToggleMapZooming={handleToggleMapZooming}
                    showZoomButtons={!interactionSettings.enableMapZooming}
                    viewToggles={viewMode === VIEW_MODE_PLANETARIUM
                        ? planetariumToolbarToggles
                        : solarSystemToolbarToggles}
                />
                {horizonsUnavailable ? (
                    <Alert
                        severity={renderableSolarBodiesCount > 0 ? 'warning' : 'error'}
                        variant="outlined"
                        action={(
                            <Button
                                color="inherit"
                                size="small"
                                onClick={handleRefreshSolarSystem}
                                disabled={!socket || solarSystemLoading}
                            >
                                {tCelestial('horizons.retry_now', { defaultValue: 'Retry now' })}
                            </Button>
                        )}
                        sx={{
                            borderLeft: 0,
                            borderRight: 0,
                            borderRadius: 0,
                            flexShrink: 0,
                            py: 0.25,
                            '& .MuiAlert-message': { minWidth: 0 },
                        }}
                    >
                        <AlertTitle sx={{ mb: 0.25, fontSize: '0.85rem' }}>
                            {tCelestial('horizons.unavailable_title', {
                                defaultValue: 'NASA JPL Horizons unavailable',
                            })}
                        </AlertTitle>
                        <Typography variant="caption" component="div">
                            {horizonsMessage}
                        </Typography>
                        <Box
                            component="details"
                            sx={{ mt: 0.25, '& summary': { cursor: 'pointer', fontSize: '0.72rem' } }}
                        >
                            <Box component="summary">
                                {tCelestial('horizons.details', { defaultValue: 'Details' })}
                            </Box>
                            {horizonsStatus?.reason ? (
                                <Typography variant="caption" component="div" sx={{ mt: 0.25 }}>
                                    {tCelestial('horizons.reason', { defaultValue: 'Reason' })}: {horizonsReason}
                                </Typography>
                            ) : null}
                            {horizonsStatus?.last_success_at_utc ? (
                                <Typography variant="caption" component="div">
                                    {tCelestial('horizons.last_success', { defaultValue: 'Last successful update' })}: {' '}
                                    {formatHorizonsTime(horizonsStatus.last_success_at_utc)}
                                </Typography>
                            ) : null}
                            {horizonsStatus?.retry_at_utc ? (
                                <Typography variant="caption" component="div">
                                    {tCelestial('horizons.next_retry', { defaultValue: 'Next automatic retry' })}: {' '}
                                    {formatHorizonsTime(horizonsStatus.retry_at_utc)}
                                </Typography>
                            ) : null}
                            <Typography variant="caption" component="div">
                                {tCelestial('horizons.affected', { defaultValue: 'Affected bodies' })}: {' '}
                                {horizonsStaleCount + solarCacheMissingCount}
                            </Typography>
                        </Box>
                    </Alert>
                ) : null}
                <Box sx={{ p: 0, flex: 1, minHeight: 0, overflow: 'hidden', position: 'relative' }}>
                    {(celestialState.error && !hasSolarScene) || solarSystemDataError ? (
                        <Typography variant="body2" color="error" sx={{ p: 1 }}>
                            {celestialState.error || solarSystemDataError}
                        </Typography>
                    ) : (
                        <Box sx={{ height: '100%', minHeight: 220, position: 'relative' }}>
                            {viewMode === VIEW_MODE_PLANETARIUM ? (
                                <PlanetariumCanvas
                                    scene={combinedScene}
                                    selectedTargetKeys={selectedTargetKeys}
                                    focusTargetKey={focusTargetKey}
                                    fitAllSignal={fitAllSignal}
                                    zoomInSignal={zoomInSignal}
                                    zoomOutSignal={zoomOutSignal}
                                    resetZoomSignal={resetZoomSignal}
                                    centerSunSignal={centerSunSignal}
                                    enableMapDragging={interactionSettings.enableMapDragging}
                                    enableMapZooming={interactionSettings.enableMapZooming}
                                    displayOptions={planetariumDisplayOptions}
                                />
                            ) : (
                                <SolarSystemCanvas
                                    scene={combinedScene}
                                    selectedTargetKeys={selectedTargetKeys}
                                    targetNumberByTargetKey={targetNumberByTargetKey}
                                    fitAllSignal={fitAllSignal}
                                    focusTargetSignal={focusTargetSignal}
                                    focusTargetKey={focusTargetKey}
                                    zoomInSignal={zoomInSignal}
                                    zoomOutSignal={zoomOutSignal}
                                    resetZoomSignal={resetZoomSignal}
                                    centerSunSignal={centerSunSignal}
                                    initialViewport={celestialState.mapSettings?.solarSystemViewport}
                                    enableMapDragging={interactionSettings.enableMapDragging}
                                    enableMapZooming={interactionSettings.enableMapZooming}
                                    onViewportCommit={handleViewportCommit}
                                    onStatusBarInfoChange={handleSolarStatusBarInfoChange}
                                    displayOptions={solarSystemDisplayOptions}
                                />
                            )}

                            {showRefreshOverlay ? (
                                <Box
                                    sx={{
                                        position: 'absolute',
                                        top: 8,
                                        right: 10,
                                        px: 0.9,
                                        py: 0.45,
                                        borderRadius: 1,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 0.75,
                                        bgcolor: (theme) => theme.palette.mode === 'dark'
                                            ? 'rgba(12, 16, 22, 0.64)'
                                            : 'rgba(255, 255, 255, 0.8)',
                                        border: (theme) => `1px solid ${theme.palette.divider}`,
                                        backdropFilter: 'blur(4px)',
                                    }}
                                >
                                    <CircularProgress size={12} thickness={6} />
                                    <Typography
                                        variant="caption"
                                        color="text.secondary"
                                        sx={{ fontFamily: 'monospace', lineHeight: 1 }}
                                    >
                                        {tCelestial('main_layout.updating')}
                                    </Typography>
                                </Box>
                            ) : null}
                        </Box>
                    )}
                </Box>
                <CelestialStatusBar
                    gestureHintText={viewMode === VIEW_MODE_SOLAR_SYSTEM ? solarCanvasStatusInfo.gestureHintText : ''}
                    scaleLabel={viewMode === VIEW_MODE_SOLAR_SYSTEM ? solarCanvasStatusInfo.scaleLabel : ''}
                />
            </Box>
        </StyledIslandParentNoScrollbar>,
        <StyledIslandParentNoScrollbar key="monitored-celestial">
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                <TitleBar
                    className={getClassNamesBasedOnGridEditing(isEditing, [])}
                    sx={{ ...islandTitleBarSx, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                >
                    <Box component="span">
                        {tCelestial('main_layout.monitored_title')}
                    </Box>
                    <Tooltip title={tCelestial('toolbar.table_settings')}>
                        <span>
                            <IconButton
                                size="small"
                                onClick={() => dispatch(setOpenGridSettingsDialog(true))}
                                sx={{ p: 0.25 }}
                            >
                                <SettingsIcon fontSize="small" />
                            </IconButton>
                        </span>
                    </Tooltip>
                </TitleBar>
                <Box sx={{ p: 0, flex: 1, minHeight: 0 }}>
                    {deferredIslandCount >= 1 ? (
                        <MonitoredCelestialGridIsland
                            rows={monitoredState.monitored || []}
                            loading={Boolean(monitoredState.loading)}
                            targetNumberByTargetKey={targetNumberByTargetKey}
                            onTargetSelected={(row) => {
                                const key = buildTargetKeyFromCelestialRow(row);
                                if (!key) return;
                                setFocusTargetKey(key);
                                setFocusTargetSignal((value) => value + 1);
                            }}
                        />
                    ) : <DeferredIslandPlaceholder />}
                </Box>
            </Box>
        </StyledIslandParentNoScrollbar>,
        <StyledIslandParentNoScrollbar key="celestial-info">
            {deferredIslandCount >= 2 ? (
                <CelestialInfoIsland
                    selectedTargetKey={selectedInfoTargetKey}
                    tracks={combinedScene?.celestial || []}
                    passes={combinedScene?.celestial_passes || []}
                    monitoredRows={monitoredState?.monitored || []}
                    gridEditable={isEditing}
                    loading={Boolean(celestialState.tracksLoading)}
                />
            ) : <DeferredIslandPlaceholder />}
        </StyledIslandParentNoScrollbar>,
        <StyledIslandParentNoScrollbar key="celestial-timeline">
            {deferredIslandCount >= 3 ? (
                <CelestialPassTimeline
                    passes={combinedScene?.celestial_passes || []}
                    loading={Boolean(celestialState.tracksLoading)}
                    gridEditable={isEditing}
                    projectionPastHours={projectionSettings.past_hours}
                    projectionFutureHours={projectionSettings.future_hours}
                    selectedTargetKey={selectedInfoTargetKey}
                    onRefresh={handleRefreshMonitored}
                />
            ) : <DeferredIslandPlaceholder />}
        </StyledIslandParentNoScrollbar>,
        <StyledIslandParentNoScrollbar key="celestial-passes">
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                {deferredIslandCount >= 4 ? (
                    <CelestialPasses
                        passes={combinedScene?.celestial_passes || []}
                        tracks={combinedScene?.celestial || []}
                        monitoredRows={monitoredState?.monitored || []}
                        sceneTimestampUtc={combinedScene?.timestamp_utc || ''}
                        loading={Boolean(celestialState.tracksLoading)}
                        gridEditable={isEditing}
                        targetNumberByTargetKey={targetNumberByTargetKey}
                        onTargetSelected={(targetKey) => {
                            if (!targetKey) return;
                            setFocusTargetKey(targetKey);
                            setFocusTargetSignal((value) => value + 1);
                        }}
                        onRefresh={handleRefreshMonitored}
                        refreshDisabled={!socket || Boolean(celestialState.tracksLoading)}
                    />
                ) : <DeferredIslandPlaceholder />}
            </Box>
        </StyledIslandParentNoScrollbar>,
    ];

    return (
        <PageTabsLayout sx={{ width: '100%', bgcolor: 'transparent' }} tabs={
            <CelestialTopBar
                projectionPastHours={projectionSettings.past_hours}
                projectionFutureHours={projectionSettings.future_hours}
                onProjectionPastHoursChange={(value) => updateProjectionSetting({ pastHours: value })}
                onProjectionFutureHoursChange={(value) => updateProjectionSetting({ futureHours: value })}
                onTargetAdded={handleTargetAdded}
            />
        }>
            <SolarSystemLayoutOptionsDialog
                open={openSolarSystemLayoutOptionsDialog}
                initialSolarSystemOptions={solarSystemDisplayOptions}
                initialPlanetariumOptions={planetariumDisplayOptions}
                initialInteractionSettings={interactionSettings}
                initialViewMode={viewMode}
                onApplyInteractionSettings={(nextInteraction) => {
                    updateProjectionSetting({
                        enableMapDragging: Boolean(nextInteraction?.enableMapDragging),
                        enableMapZooming: Boolean(nextInteraction?.enableMapZooming),
                    });
                }}
                onApplyViewMode={updateViewMode}
                onClose={() => setOpenSolarSystemLayoutOptionsDialog(false)}
            />
            <div ref={containerRef}>
                {mounted ? (
                    <Responsive
                        width={width}
                        positionStrategy={absoluteStrategy}
                        className="layout"
                        layouts={layouts}
                        onLayoutChange={handleLayoutsChange}
                        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                        cols={{ lg: 48, md: 40, sm: 24, xs: 8, xxs: 8 }}
                        rowHeight={8}
                        dragConfig={{ enabled: isEditing, handle: '.react-grid-draggable' }}
                        resizeConfig={{ enabled: isEditing }}
                    >
                        {gridContents}
                    </Responsive>
                ) : null}
            </div>
        </PageTabsLayout>
    );
};

export default CelestialMainLayout;
