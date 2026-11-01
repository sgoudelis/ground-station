/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Alert, Box, Paper, Typography} from '@mui/material';
import {alpha} from '@mui/material/styles';
import {CircleMarker, MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap} from 'react-leaflet';
import {useSelector} from 'react-redux';
import {useTranslation} from 'react-i18next';
import 'leaflet/dist/leaflet.css';
import {homeIcon} from '../common/dataurl-icons.jsx';
import {getTileLayerById} from '../common/tile-layers.jsx';
import {getClassNamesBasedOnGridEditing, islandTitleBarCompactSx, MapStatusBar, TitleBar} from '../common/common.jsx';
import {isValidMapPosition, toLocationNumber} from '../filebrowser/position-utils.js';
import {useUserTimeSettings} from '../../hooks/useUserTimeSettings.jsx';
import {formatDateTime} from '../../utils/date-time.js';
import useMapIslandFullscreen from '../earthview/use-map-island-fullscreen.js';
import MapTitleControls from '../earthview/map-title-controls.jsx';
import {mapSettingsStoreName, mapViewStoreName, readMapSettings, readMapView, writeStored} from './storage.js';
import {TRANSMITTER_TYPES, typeColor, typeLabel} from './transmitters.js';
import MapInteractions from './map-interactions.jsx';
import PacketMapToolbar from './map-toolbar.jsx';
import PacketMapSettingsDialog from './map-settings-dialog.jsx';
import {createRadiosondeIcon} from './radiosonde-marker.js';
import {buildPlaybackTrack, trackPositionAt} from './playback.js';

export const POSITION_COLORS = Object.fromEntries(Object.entries(TRANSMITTER_TYPES).map(([kind, value]) => [kind, value.color]));

const hybridReferenceLayers = ['World_Transportation', 'World_Boundaries_and_Places'].map((service, index) => ({
    id: service,
    url: `https://services.arcgisonline.com/ArcGIS/rest/services/Reference/${service}/MapServer/tile/{z}/{y}/{x}`,
    attribution: 'Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, and the GIS user community',
    zIndex: index + 1,
}));

export function MapViewport({bounds, ready, fitRequest, paddingTop = 42}) {
    const map = useMap();
    const [savedView] = useState(readMapView);
    const hasUserView = useRef(Boolean(savedView));
    const programmatic = useRef(false);
    const lastFitRequest = useRef(fitRequest);
    const fitOptions = useMemo(() => ({paddingTopLeft: [42, paddingTop], paddingBottomRight: [42, 42],
        maxZoom: 13, animate: false}), [paddingTop]);

    useEffect(() => {
        // Guard map-generated events during restoration and automatic fitting.
        // Only a user's navigation should disable fitting for future results.
        if (savedView) {
            programmatic.current = true;
            map.setView(savedView.center, savedView.zoom, {animate: false});
            programmatic.current = false;
        }
        const interacted = () => {
            if (!programmatic.current) hasUserView.current = true;
        };
        const persist = () => {
            if (!programmatic.current && hasUserView.current) {
                const {lat, lng} = map.getCenter();
                writeStored(mapViewStoreName, {center: [lat, lng], zoom: map.getZoom()});
            }
        };
        // Movement from navigation buttons also counts as manual navigation.
        map.on('movestart zoomstart', interacted);
        map.on('moveend zoomend', persist);
        return () => {
            map.off('movestart zoomstart', interacted);
            map.off('moveend zoomend', persist);
        };
    }, [map, savedView]);

    useEffect(() => {
        const observer = new ResizeObserver(() => {
            const center = map.getCenter();
            programmatic.current = true;
            map.invalidateSize({pan: false});
            if (ready && !hasUserView.current && bounds.length) {
                map.fitBounds(bounds, fitOptions);
            } else {
                // Leaflet otherwise shifts the center when the grid window
                // shrinks. Preserve the user's view without saving resize events.
                map.setView(center, map.getZoom(), {animate: false});
            }
            programmatic.current = false;
        });
        observer.observe(map.getContainer());
        return () => observer.disconnect();
    }, [map, bounds, ready, fitOptions]);

    useEffect(() => {
        const explicitFit = lastFitRequest.current !== fitRequest;
        lastFitRequest.current = fitRequest;
        if (explicitFit) {
            hasUserView.current = false;
            writeStored(mapViewStoreName, null);
        }
        // Keep the fit request active while the new range is loading; fit its
        // results once ready instead of fitting the previous range's bounds.
        if (!ready || hasUserView.current || !bounds.length) return;
        programmatic.current = true;
        map.invalidateSize({pan: false});
        map.fitBounds(bounds, fitOptions);
        programmatic.current = false;
    }, [map, bounds, ready, fitRequest, fitOptions]);
    return null;
}

function PositionPopup({point}) {
    const {t} = useTranslation('navigation');
    const timeSettings = useUserTimeSettings();
    return <Popup>
        <strong>{point.name}</strong><br />
        {typeLabel(point.kind)}{point.source && point.source !== point.name ? ` · ${point.source}` : ''}<br />
        {point.latitude.toFixed(6)}, {point.longitude.toFixed(6)}<br />
        {point.altitude !== null && <>{point.altitude.toLocaleString()} m<br /></>}
        {formatDateTime(point.captured_at, timeSettings)}<br />
        {point.interpolated && <>{t('packet_map.interpolated_position', {defaultValue: 'Interpolated position'})}<br /></>}
        <span>{t('packet_map.file', {defaultValue: 'File'})}: {point.file_id.replace(/^decoded:/, '')}</span>
    </Popup>;
}

export default function PacketMap({positions, transmitters, hasPositions = positions.length > 0, loading, gridEditable, fitRequest,
    selectedTransmitterId = null, onSelectTransmitter, hiddenTypes = [], onHiddenTypesChange, onFitAll, playbackTime}) {
    const {t} = useTranslation('navigation');
    const receiver = useSelector((state) => state.location?.location);
    const preferences = useSelector((state) => state.preferences?.preferences);
    const [localFit, setLocalFit] = useState(0);
    const [initialView] = useState(readMapView);
    const [settings, setSettings] = useState(readMapSettings);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const {tileLayerId} = settings;
    const mapRef = useRef(null);
    const {islandRef, isFullscreen, toggleFullscreen} = useMapIslandFullscreen(() => mapRef.current?.invalidateSize({pan: false}));
    const applySettings = (next) => {
        setSettings(next);
        writeStored(mapSettingsStoreName, next);
    };
    const toggleSetting = (key) => applySettings({...settings, [key]: !settings[key]});
    const receiverLatitude = toLocationNumber(receiver?.lat);
    const receiverLongitude = toLocationNumber(receiver?.lon);
    const hasReceiver = isValidMapPosition(receiverLatitude, receiverLongitude);
    const baseLayerId = tileLayerId === 'hybrid' ? 'satellite' : tileLayerId;
    const layer = getTileLayerById(baseLayerId, {t, preferences});
    const transmitterDetails = useMemo(() => new Map((transmitters || []).map((row) => [row.id, row.details])), [transmitters]);
    const tracks = useMemo(() => {
        const groups = new Map();
        positions.forEach((point) => {
            if (!groups.has(point.transmitter_id)) groups.set(point.transmitter_id, []);
            groups.get(point.transmitter_id).push(point);
        });
        return [...groups.entries()].map(([id, points]) => ({id, ...buildPlaybackTrack(points)}))
            .filter((track) => track.points.length);
    }, [positions]);
    // Geometry and fitting stay fixed while the cursor moves. Only the symbols
    // and their historical altitude/flight phase are updated during scrubbing.
    const playback = useMemo(() => new Map(tracks.map((track) => {
        const current = trackPositionAt(track, playbackTime, transmitterDetails.get(track.id)?.telemetry?.vel_v);
        const point = current?.point;
        return [track.id, current ? {...current, icon: point.kind === 'radiosonde' ? createRadiosondeIcon({
            phase: current.phase, altitude: point.altitude, color: typeColor(point.kind),
        }) : null} : null];
    })), [tracks, playbackTime, transmitterDetails]);
    const bounds = useMemo(() => {
        // Include the interpolated curve so fitting never clips a rounded bend.
        const fittedTracks = selectedTransmitterId === null ? tracks
            : tracks.filter((track) => track.id === selectedTransmitterId);
        const coordinates = fittedTracks.flatMap((track) => track.path);
        if (selectedTransmitterId === null && hasReceiver) coordinates.push([receiverLatitude, receiverLongitude]);
        return coordinates;
    }, [tracks, selectedTransmitterId, hasReceiver, receiverLatitude, receiverLongitude]);
    // Keep the 40px symbol and its maximum 44px lift inside fitted views.
    const paddingTop = tracks.some((track) => track.points[0].kind === 'radiosonde') ? 104 : 42;
    const homeLabel = t('packet_map.home', {defaultValue: 'Home station'});

    return <Box ref={islandRef} sx={(theme) => ({height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column',
        '&:fullscreen': {width: '100vw', height: '100vh', bgcolor: 'background.paper'},
        '&:-webkit-full-screen': {width: '100vw', height: '100vh', bgcolor: 'background.paper'},
        // Leaflet renders overlays in map panes; theme their surfaces and arrows together.
        '& .leaflet-tooltip, & .leaflet-popup-content-wrapper': {
            ...theme.typography.body2,
            fontSize: theme.typography.pxToRem(12),
            backgroundColor: theme.palette.background.paper,
            color: theme.palette.text.primary,
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: `${theme.shape.borderRadius}px`,
            boxShadow: theme.shadows[3],
        },
        '& .leaflet-tooltip': {
            fontSize: theme.typography.pxToRem(11),
            fontWeight: theme.typography.fontWeightMedium,
            padding: theme.spacing(0.5, 1),
            opacity: '1 !important',
        },
        '& .leaflet-tooltip-top::before': {
            borderTopColor: `${theme.palette.background.paper} !important`,
        },
        '& .leaflet-tooltip-bottom::before': {
            borderBottomColor: `${theme.palette.background.paper} !important`,
        },
        '& .leaflet-tooltip-left::before': {
            borderLeftColor: `${theme.palette.background.paper} !important`,
        },
        '& .leaflet-tooltip-right::before': {
            borderRightColor: `${theme.palette.background.paper} !important`,
        },
        '& .leaflet-popup-tip': {backgroundColor: theme.palette.background.paper},
        '& .leaflet-popup-close-button': {
            color: theme.palette.text.secondary,
            '&:hover, &:focus-visible': {color: theme.palette.text.primary},
        },
    })}>
        <TitleBar className={getClassNamesBasedOnGridEditing(gridEditable, ['window-title-bar'])}
            sx={{...islandTitleBarCompactSx, flexShrink: 0, gap: 1}}>
            <Typography variant="subtitle2" noWrap sx={{fontWeight: 'bold', flex: 1, minWidth: 0}}>
                {t('packet_map.positions', {defaultValue: 'Map'})}
            </Typography>
            <MapTitleControls onSettings={() => setSettingsOpen(true)}
                tooltipContainer={isFullscreen ? islandRef.current : undefined} />
        </TitleBar>
        <PacketMapToolbar mapRef={mapRef} home={hasReceiver ? [receiverLatitude, receiverLongitude] : null}
            onFitAll={() => { onFitAll?.(); setLocalFit((value) => value + 1); }} settings={settings} onToggleSetting={toggleSetting}
            isFullscreen={isFullscreen} onFullscreen={toggleFullscreen}
            tooltipContainer={isFullscreen ? islandRef.current : undefined} />
        <Box sx={{position: 'relative', flex: 1, minHeight: 0}}>
            <MapContainer ref={mapRef} center={initialView?.center || (hasReceiver ? [receiverLatitude, receiverLongitude] : [20, 0])}
                zoom={initialView?.zoom ?? (hasReceiver ? 9 : 2)} preferCanvas zoomControl={false} keyboard={false}
                dragging={settings.enableMapDragging} scrollWheelZoom={settings.enableMapZooming}
                doubleClickZoom={settings.enableMapZooming} touchZoom={settings.enableMapZooming} boxZoom={settings.enableMapZooming}
                zoomSnap={0.25} zoomDelta={0.25} bounceAtZoomLimits={false} closePopupOnClick={false}
                style={{height: '100%', width: '100%'}}>
                <MapInteractions enableMapDragging={settings.enableMapDragging} enableMapZooming={settings.enableMapZooming} />
                <MapViewport bounds={bounds} ready={!loading} fitRequest={`${fitRequest}:${selectedTransmitterId}:${localFit}`}
                    paddingTop={paddingTop} />
                <TileLayer key={baseLayerId} url={layer.url} attribution={layer.attribution} zIndex={0} />
                {/* Transparent references share the tile pane, below transmitter paths and markers. */}
                {tileLayerId === 'hybrid' && hybridReferenceLayers.map(({id, ...reference}) =>
                    <TileLayer key={id} {...reference} />)}
                {hasReceiver && <Marker position={[receiverLatitude, receiverLongitude]} icon={homeIcon}>
                    <Tooltip>{homeLabel}</Tooltip><Popup>{homeLabel}</Popup>
                </Marker>}
                {tracks.map(({id, points, path}) => {
                    const latest = points[points.length - 1];
                    const endpoints = points.length > 1 ? [points[0], latest] : [latest];
                    const color = typeColor(latest.kind);
                    const current = playback.get(id);
                    return <React.Fragment key={id}>
                        {settings.showTracks && path.length > 1 && <Polyline positions={path} smoothFactor={0.5}
                            pathOptions={{color, weight: 2, opacity: 0.65, lineCap: 'round', lineJoin: 'round'}} />}
                        {endpoints.filter((point) => point !== current?.point).map((point) => <CircleMarker key={point.id}
                            center={[point.latitude, point.longitude]} radius={4}
                            eventHandlers={{click: () => onSelectTransmitter?.(id)}}
                            pathOptions={{color, fillColor: color, fillOpacity: 0.25, weight: 2}}>
                            <PositionPopup point={point} />
                        </CircleMarker>)}
                        {current && (current.icon ? <Marker key="cursor" position={[current.point.latitude, current.point.longitude]}
                            icon={current.icon} title={current.point.name} eventHandlers={{click: () => onSelectTransmitter?.(id)}}>
                            <PositionPopup point={current.point} /><Tooltip direction="top">{current.point.name}</Tooltip>
                        </Marker> : <CircleMarker key="cursor" center={[current.point.latitude, current.point.longitude]} radius={7}
                            eventHandlers={{click: () => onSelectTransmitter?.(id)}}
                            pathOptions={{color, fillColor: color, fillOpacity: 0.85, weight: 2}}>
                            <PositionPopup point={current.point} /><Tooltip direction="top">{current.point.name}</Tooltip>
                        </CircleMarker>)}
                    </React.Fragment>;
                })}
            </MapContainer>
            {/* Keep overlays clear of the pan buttons and let map gestures pass through. */}
            <Box sx={{position: 'absolute', top: 12, left: 12, right: 12, zIndex: 500, display: 'flex',
                flexDirection: 'column', alignItems: 'flex-end', gap: 1, pointerEvents: 'none'}}>
                {settings.showLegend && <Paper component="ul" aria-label={t('packet_map.types', {defaultValue: 'Transmitter types'})}
                    elevation={2} sx={{m: 0, px: 1.25, py: 0.75, display: 'flex', flexWrap: 'wrap', gap: 1.5,
                        maxWidth: '100%', listStyle: 'none', bgcolor: (theme) => alpha(theme.palette.background.paper, 0.9)}}>
                    {Object.entries(TRANSMITTER_TYPES).map(([kind, {label, color}]) => <Box component="li" key={kind}
                        sx={{display: 'flex', alignItems: 'center', gap: 0.75}}>
                        <Box component="span" sx={{width: 8, height: 8, borderRadius: '50%', bgcolor: color}} />
                        <Typography variant="caption">{label}</Typography>
                    </Box>)}
                </Paper>}
                {!loading && !positions.length && <Alert severity="info" sx={{alignSelf: 'stretch'}}>
                    {hasPositions ? t('packet_map.all_hidden', {defaultValue: 'All transmitter types are hidden.'})
                        : t('packet_map.empty', {defaultValue: 'No APRS or radiosonde positions in this date range.'})}
                </Alert>}
            </Box>
        </Box>
        <MapStatusBar sx={{position: 'relative', bottom: 'auto', zIndex: 'auto', flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 2, overflowX: 'auto', whiteSpace: 'nowrap'}}>
            <Typography variant="caption">{t('packet_map.packet_count', {defaultValue: '{{count}} positions', count: positions.length})}</Typography>
            <Typography variant="caption">{t('packet_map.transmitter_count', {defaultValue: '{{count}} transmitters', count: tracks.length})}</Typography>
            {!hasReceiver && <Typography variant="caption" color="warning.main">
                {t('packet_map.no_home', {defaultValue: 'Set your home location in station settings.'})}
            </Typography>}
        </MapStatusBar>
        {settingsOpen && <PacketMapSettingsDialog settings={settings} hiddenTypes={hiddenTypes}
            transmitterTypes={[...new Set([...Object.keys(TRANSMITTER_TYPES), ...(transmitters || []).map((row) => row.kind), ...hiddenTypes])]}
            onApply={(nextSettings, nextHiddenTypes) => {
                applySettings(nextSettings);
                onHiddenTypesChange?.(nextHiddenTypes);
            }}
            onClose={() => setSettingsOpen(false)} container={isFullscreen ? islandRef.current : undefined} />}
    </Box>;
}
