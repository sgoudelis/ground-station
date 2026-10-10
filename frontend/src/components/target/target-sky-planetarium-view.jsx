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

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Box, CircularProgress, IconButton, Tooltip, Typography} from '@mui/material';
import SettingsIcon from '@mui/icons-material/Settings';
import RefreshIcon from '@mui/icons-material/Refresh';
import {useDispatch, useSelector} from 'react-redux';
import {useTranslation} from 'react-i18next';
import {
    getClassNamesBasedOnGridEditing,
    islandTitleBarSx,
    TitleBar,
} from '../common/common.jsx';
import {useSocket} from '../common/socket.jsx';
import PlanetariumCanvas from '../celestial/planetarium-canvas.jsx';
import CelestialToolbar from '../celestial/celestial-toolbar.jsx';
import {
    fetchTargetCelestialScene,
} from '../celestial/celestial-slice.jsx';
import {
    buildTargetCelestialPayload,
    buildTargetKeyFromTrackingState,
    buildTargetSceneRequestKey,
    clampTargetPassHours,
    filterPassesForTargetWindow,
    normalizeTargetType,
    resolveTargetDisplayName,
} from './celestial-target-utils.js';
import {
    setOpenMapSettingsDialog,
    setTargetMapSetting,
} from './target-slice.jsx';
import TargetMapSettingsDialog from './target-map-settings-dialog.jsx';
import TargetSkyViewSettingsDialog from './target-sky-view-settings-dialog.jsx';
import TargetViewPicker from './target-view-picker.jsx';
import {
    satelliteDetailsSelector,
    satellitePositionSelector,
} from './state-selectors.jsx';

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

const TargetSkyPlanetariumView = () => {
    const {socket} = useSocket();
    const dispatch = useDispatch();
    const {t} = useTranslation('target');
    const {
        trackerId,
        trackerViews,
        trackingState,
        rotatorData,
        satellitePasses,
        gridEditable,
        enableMapDragging,
        enableMapZooming,
        nextPassesHours,
    } = useSelector((state) => state.targetSatTrack);
    const satellitePosition = useSelector(satellitePositionSelector);
    const satelliteDetails = useSelector(satelliteDetailsSelector);
    const monitoredRows = useSelector((state) => state.celestialMonitored?.monitored || []);
    const {location} = useSelector((state) => state.location);
    const [fitAllSignal, setFitAllSignal] = useState(0);
    const [zoomInSignal, setZoomInSignal] = useState(0);
    const [zoomOutSignal, setZoomOutSignal] = useState(0);
    const [resetZoomSignal, setResetZoomSignal] = useState(0);
    const [centerSunSignal, setCenterSunSignal] = useState(0);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const viewportRef = useRef(null);
    const scopedTrackerView = useMemo(
        () => (trackerId ? trackerViews?.[trackerId] || null : null),
        [trackerId, trackerViews],
    );
    const effectiveRotatorData = scopedTrackerView?.rotatorData || rotatorData || {};
    const targetType = useMemo(() => normalizeTargetType(trackingState), [trackingState]);
    const isSatelliteTarget = targetType === 'satellite';
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
    const observerSkyBodies = useSelector((state) => state.celestial?.observerSkyBodies || []);
    const targetName = useMemo(() => resolveTargetDisplayName({
        trackingState,
        satelliteDetails,
        monitoredRows,
        celestialRows: targetScene?.celestialTracks?.celestial || [],
    }), [monitoredRows, satelliteDetails, targetScene?.celestialTracks?.celestial, trackingState]);
    const nonSatellitePayload = useMemo(
        () => buildTargetCelestialPayload({
            trackingState: {
                target_type: normalizeTargetType({target_type: targetType, command: missionCommand, body_id: bodyId}),
                target_key: nonSatelliteTargetKey,
                command: missionCommand,
                body_id: bodyId,
            },
            targetName,
            nextPassesHours,
        }),
        [bodyId, missionCommand, nextPassesHours, nonSatelliteTargetKey, targetName, targetType],
    );
    const nonSatelliteFetchSignature = useMemo(() => {
        if (isSatelliteTarget || !nonSatellitePayload) return '';
        const futureHours = clampTargetPassHours(nextPassesHours);
        return `${targetType}:${nonSatelliteTargetKey}:${futureHours}`;
    }, [isSatelliteTarget, nextPassesHours, nonSatellitePayload, nonSatelliteTargetKey, targetType]);
    const lastAutoFetchedSignatureRef = useRef('');

    const handleRefreshNonSatelliteScene = useCallback(async () => {
        if (!socket || !nonSatellitePayload) return;
        return dispatch(fetchTargetCelestialScene({
            socket,
            payload: nonSatellitePayload,
            requestKey: nonSatelliteSceneRequestKey,
        }));
    }, [dispatch, nonSatellitePayload, nonSatelliteSceneRequestKey, socket]);

    useEffect(() => {
        if (!socket || !nonSatelliteFetchSignature || isSatelliteTarget || !nonSatellitePayload) {
            return;
        }
        // Tracker-state updates are frequent; fetch only when target identity/window changes.
        if (lastAutoFetchedSignatureRef.current === nonSatelliteFetchSignature) {
            return;
        }
        void handleRefreshNonSatelliteScene().then((result) => {
            if (fetchTargetCelestialScene.fulfilled.match(result)) {
                lastAutoFetchedSignatureRef.current = nonSatelliteFetchSignature;
            }
        });
    }, [handleRefreshNonSatelliteScene, isSatelliteTarget, nonSatelliteFetchSignature, nonSatellitePayload, socket]);

    useEffect(() => {
        const handleFullscreenChange = () => {
            const viewportElement = viewportRef.current;
            const fullscreenElement = getFullscreenElement();
            setIsFullscreen(Boolean(viewportElement && fullscreenElement === viewportElement));
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

    const handleToggleFullscreen = useCallback(() => {
        const viewportElement = viewportRef.current;
        if (!viewportElement) return;
        const fullscreenElement = getFullscreenElement();
        if (fullscreenElement === viewportElement) {
            exitFullscreen();
            return;
        }
        requestFullscreen(viewportElement);
    }, []);

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
            observer_bodies: observerSkyBodies.length > 0
                ? observerSkyBodies
                : (Array.isArray(tracksScene?.observer_bodies) ? tracksScene.observer_bodies : []),
            celestial: scopedRows,
            celestial_passes: scopedPasses,
        };
    }, [nextPassesHours, nonSatelliteTargetKey, observerSkyBodies, targetScene?.celestialTracks, targetScene?.solarScene]);

    const satelliteTargetKey = useMemo(
        () => {
            const noradId = String(trackingState?.norad_id || satelliteDetails?.norad_id || '').trim();
            return noradId ? `satellite:${noradId}` : '';
        },
        [satelliteDetails?.norad_id, trackingState?.norad_id],
    );

    const satelliteScene = useMemo(() => {
        const az = Number(satellitePosition?.az);
        const el = Number(satellitePosition?.el);
        const hasAzEl = Number.isFinite(az) && Number.isFinite(el);
        const celestialRows = hasAzEl
            ? [{
                target_key: satelliteTargetKey,
                target_type: 'satellite',
                norad_id: String(trackingState?.norad_id || satelliteDetails?.norad_id || '').trim(),
                name: targetName || String(satelliteDetails?.name || '').trim() || 'Satellite',
                sky_position: {
                    az_deg: az,
                    el_deg: el,
                },
                visibility: {
                    visible: el > 0,
                },
                color: '#38BDF8',
            }]
            : [];

        const nowMs = Date.now();
        const windowEndMs = nowMs + clampTargetPassHours(nextPassesHours) * 3600 * 1000;
        const scopedPasses = (Array.isArray(satellitePasses) ? satellitePasses : [])
            .filter((pass) => {
                const startMs = new Date(pass?.event_start || '').getTime();
                const endMs = new Date(pass?.event_end || '').getTime();
                if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
                if (endMs < nowMs) return false;
                return startMs <= windowEndMs;
            })
            .map((pass) => ({
                ...pass,
                target_key: satelliteTargetKey,
            }));

        return {
            timestamp_utc: new Date().toISOString(),
            meta: {
                observer_location: location
                    ? {
                        lat: Number(location.lat),
                        lon: Number(location.lon),
                        name: String(location.name || '').trim() || 'Observer',
                    }
                    : null,
            },
            planets: [],
            observer_bodies: observerSkyBodies,
            celestial: celestialRows,
            celestial_passes: scopedPasses,
        };
    }, [
        location,
        nextPassesHours,
        observerSkyBodies,
        satelliteDetails?.name,
        satelliteDetails?.norad_id,
        satellitePasses,
        satellitePosition?.az,
        satellitePosition?.el,
        satelliteTargetKey,
        targetName,
        trackingState?.norad_id,
    ]);

    const scene = isSatelliteTarget ? satelliteScene : nonSatelliteScene;
    const focusTargetKey = isSatelliteTarget ? satelliteTargetKey : nonSatelliteTargetKey;
    const selectedTargetKeys = focusTargetKey ? [focusTargetKey] : [];
    const rotatorCrosshair = useMemo(() => {
        const az = Number(effectiveRotatorData?.az);
        const el = Number(effectiveRotatorData?.el);
        const connected = effectiveRotatorData?.connected === true;
        // The crosshair shows measured pointing in every connected mode,
        // including stopped, parked, and manual movement.
        if (!connected) return null;
        if (!Number.isFinite(az) || !Number.isFinite(el)) return null;
        return { visible: true, az, el };
    }, [
        effectiveRotatorData?.az,
        effectiveRotatorData?.el,
        effectiveRotatorData?.connected,
    ]);
    const rotatorMinElevation = useMemo(() => {
        const connected = effectiveRotatorData?.connected === true;
        const minElevation = Number(effectiveRotatorData?.minel);
        if (!connected || !Number.isFinite(minElevation)) return null;
        return minElevation;
    }, [
        effectiveRotatorData?.connected,
        effectiveRotatorData?.minel,
    ]);
    const loading = !isSatelliteTarget && Boolean(targetScene?.loading);
    const hasRenderableTarget = Array.isArray(scene?.celestial) && scene.celestial.length > 0;

    const handleOpenSettings = useCallback(() => {
        dispatch(setOpenMapSettingsDialog(true));
    }, [dispatch]);

    return (
        <Box
            ref={viewportRef}
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
                className={getClassNamesBasedOnGridEditing(gridEditable, ['window-title-bar'])}
                sx={{...islandTitleBarSx, containerType: 'inline-size', containerName: 'target-view-header'}}
            >
                <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', minWidth: 0}}>
                    <Box sx={{display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, gap: 0.75}}>
                        <Typography variant="subtitle2" sx={{fontWeight: 'bold', minWidth: 0}} noWrap>
                            {`${t('satellite_map.title')} · Planetarium`}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', minWidth: 0 }} noWrap>
                            {targetName || '-'}
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexShrink: 0 }}>
                        <TargetViewPicker targetType={targetType}/>
                        <Tooltip title={t('view_settings.customize_title', {defaultValue: 'Customize current view'})}>
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
                        {!isSatelliteTarget ? (
                            <Tooltip title={t('target_sky_planetarium_view.refresh_target_scene', { defaultValue: 'Refresh target scene' })}>
                                <span>
                                    <IconButton
                                        size="small"
                                        onClick={handleRefreshNonSatelliteScene}
                                        disabled={!socket || !nonSatellitePayload || loading}
                                        sx={{padding: '2px'}}
                                    >
                                        <RefreshIcon fontSize="small"/>
                                    </IconButton>
                                </span>
                            </Tooltip>
                        ) : null}
                    </Box>
                </Box>
            </TitleBar>
            <CelestialToolbar
                onFitAll={() => setFitAllSignal((value) => value + 1)}
                onZoomIn={() => setZoomInSignal((value) => value + 1)}
                onZoomOut={() => setZoomOutSignal((value) => value + 1)}
                onZoomReset={() => setResetZoomSignal((value) => value + 1)}
                onCenterSun={() => setCenterSunSignal((value) => value + 1)}
                onRefresh={!isSatelliteTarget ? handleRefreshNonSatelliteScene : undefined}
                loading={loading}
                loadingText={loading ? 'Loading...' : ''}
                disabled={!isSatelliteTarget && (!socket || !nonSatellitePayload)}
                onToggleFullscreen={handleToggleFullscreen}
                fullscreen={isFullscreen}
                fullscreenLabel={t('map_controls.go_fullscreen', { defaultValue: 'Go fullscreen' })}
                exitFullscreenLabel={t('map_controls.exit_fullscreen', { defaultValue: 'Exit fullscreen' })}
                showZoomButtons={!enableMapZooming}
            />
            <Box sx={{width: '100%', flex: 1, minHeight: 0, position: 'relative'}}>
                {!hasRenderableTarget ? (
                    <Box sx={{height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2}}>
                        <Typography variant="body2" sx={{color: 'text.secondary', textAlign: 'center'}}>
                            {isSatelliteTarget
                                ? 'No satellite sky position available yet.'
                                : 'Select a mission/body target to render the planetarium view.'}
                        </Typography>
                    </Box>
                ) : (
                    <PlanetariumCanvas
                        scene={scene}
                        selectedTargetKeys={selectedTargetKeys}
                        focusTargetKey={focusTargetKey}
                        rotatorCrosshair={rotatorCrosshair}
                        rotatorMinElevation={rotatorMinElevation}
                        enableMapDragging={enableMapDragging}
                        enableMapZooming={enableMapZooming}
                        fitAllSignal={fitAllSignal}
                        zoomInSignal={zoomInSignal}
                        zoomOutSignal={zoomOutSignal}
                        resetZoomSignal={resetZoomSignal}
                        centerSunSignal={centerSunSignal}
                    />
                )}
                {loading ? (
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
                        <CircularProgress size={34}/>
                        <Typography variant="caption" color="text.secondary" sx={{fontFamily: 'monospace'}}>
                            {t('target_sky_planetarium_view.loading_planetarium_vectors', { defaultValue: 'Loading planetarium vectors...' })}
                        </Typography>
                    </Box>
                ) : null}
            </Box>
            {isSatelliteTarget ? (
                <TargetMapSettingsDialog updateBackend={() => {
                    const key = 'target-map-settings';
                    dispatch(setTargetMapSetting({socket, key}));
                }}/>
            ) : (
                <TargetSkyViewSettingsDialog updateBackend={() => {
                    const key = 'target-map-settings';
                    dispatch(setTargetMapSetting({socket, key}));
                }}/>
            )}
        </Box>
    );
};

export default TargetSkyPlanetariumView;
