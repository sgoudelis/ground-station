/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Alert, Box, Typography} from '@mui/material';
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
import {mapSettingsStoreName, mapViewStoreName, readMapSettings, readMapView, writeStored} from './storage.js';
import {TRANSMITTER_TYPES, typeColor, typeLabel} from './transmitters.js';
import MapInteractions from './map-interactions.jsx';
import PacketMapToolbar from './map-toolbar.jsx';

export const POSITION_COLORS = Object.fromEntries(Object.entries(TRANSMITTER_TYPES).map(([kind, value]) => [kind, value.color]));

export function MapViewport({bounds, ready, fitRequest}) {
    const map = useMap();
    const [savedView] = useState(readMapView);
    const hasUserView = useRef(Boolean(savedView));
    const programmatic = useRef(false);
    const lastFitRequest = useRef(fitRequest);

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
                map.fitBounds(bounds, {padding: [42, 42], maxZoom: 13, animate: false});
            } else {
                // Leaflet otherwise shifts the center when the grid window
                // shrinks. Preserve the user's view without saving resize events.
                map.setView(center, map.getZoom(), {animate: false});
            }
            programmatic.current = false;
        });
        observer.observe(map.getContainer());
        return () => observer.disconnect();
    }, [map, bounds, ready]);

    useEffect(() => {
        const explicitFit = lastFitRequest.current !== fitRequest;
        lastFitRequest.current = fitRequest;
        if (explicitFit) {
            hasUserView.current = false;
            writeStored(mapViewStoreName, null);
        }
        if ((!ready && !explicitFit) || hasUserView.current || !bounds.length) return;
        programmatic.current = true;
        map.invalidateSize({pan: false});
        map.fitBounds(bounds, {padding: [42, 42], maxZoom: 13, animate: false});
        programmatic.current = false;
    }, [map, bounds, ready, fitRequest]);
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
        <span>{t('packet_map.file', {defaultValue: 'File'})}: {point.file_id.replace(/^decoded:/, '')}</span>
    </Popup>;
}

export default function PacketMap({positions, hasPositions = positions.length > 0, loading, gridEditable, fitRequest}) {
    const {t} = useTranslation('navigation');
    const receiver = useSelector((state) => state.location?.location);
    const [tileLayerId, setTileLayerId] = useState('satellite');
    const [localFit, setLocalFit] = useState(0);
    const [initialView] = useState(readMapView);
    const [settings, setSettings] = useState(readMapSettings);
    const mapRef = useRef(null);
    const {islandRef, isFullscreen, toggleFullscreen} = useMapIslandFullscreen(() => mapRef.current?.invalidateSize({pan: false}));
    const toggleSetting = (key) => {
        const next = {...settings, [key]: !settings[key]};
        setSettings(next);
        writeStored(mapSettingsStoreName, next);
    };
    const receiverLatitude = toLocationNumber(receiver?.lat);
    const receiverLongitude = toLocationNumber(receiver?.lon);
    const hasReceiver = isValidMapPosition(receiverLatitude, receiverLongitude);
    const layer = getTileLayerById(tileLayerId, {t});
    const tracks = useMemo(() => {
        const groups = new Map();
        positions.forEach((point) => {
            if (!groups.has(point.transmitter_id)) groups.set(point.transmitter_id, []);
            groups.get(point.transmitter_id).push(point);
        });
        return [...groups.entries()].map(([id, points]) => ({id, points}));
    }, [positions]);
    const bounds = useMemo(() => {
        const coordinates = positions.map((point) => [point.latitude, point.longitude]);
        if (hasReceiver) coordinates.push([receiverLatitude, receiverLongitude]);
        return coordinates;
    }, [positions, hasReceiver, receiverLatitude, receiverLongitude]);
    const homeLabel = t('packet_map.home', {defaultValue: 'Home station'});

    return <Box ref={islandRef} sx={{height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column',
        '&:fullscreen': {width: '100vw', height: '100vh', bgcolor: 'background.paper'},
        '&:-webkit-full-screen': {width: '100vw', height: '100vh', bgcolor: 'background.paper'}}}>
        <TitleBar className={getClassNamesBasedOnGridEditing(gridEditable, ['window-title-bar'])}
            sx={{...islandTitleBarCompactSx, flexShrink: 0, gap: 1}}>
            <Typography variant="subtitle2" noWrap sx={{fontWeight: 'bold', flex: 1, minWidth: 0}}>
                {t('packet_map.positions', {defaultValue: 'Transmitter positions'})}
            </Typography>
            <Typography variant="caption" noWrap sx={{color: POSITION_COLORS.aprs}}>● APRS</Typography>
            <Typography variant="caption" noWrap sx={{color: POSITION_COLORS.radiosonde}}>● Radiosonde</Typography>
        </TitleBar>
        <PacketMapToolbar mapRef={mapRef} home={hasReceiver ? [receiverLatitude, receiverLongitude] : null}
            onFitAll={() => setLocalFit((value) => value + 1)} settings={settings} onToggleSetting={toggleSetting}
            tileLayerId={tileLayerId} onLayerChange={setTileLayerId} isFullscreen={isFullscreen} onFullscreen={toggleFullscreen}
            tooltipContainer={isFullscreen ? islandRef.current : undefined} />
        <Box sx={{position: 'relative', flex: 1, minHeight: 0}}>
            <MapContainer ref={mapRef} center={initialView?.center || (hasReceiver ? [receiverLatitude, receiverLongitude] : [20, 0])}
                zoom={initialView?.zoom ?? (hasReceiver ? 9 : 2)} preferCanvas zoomControl={false} keyboard={false}
                dragging={settings.enableMapDragging} scrollWheelZoom={settings.enableMapZooming}
                doubleClickZoom={settings.enableMapZooming} touchZoom={settings.enableMapZooming} boxZoom={settings.enableMapZooming}
                zoomSnap={0.25} zoomDelta={0.25} bounceAtZoomLimits={false} closePopupOnClick={false}
                style={{height: '100%', width: '100%'}}>
                <MapInteractions enableMapDragging={settings.enableMapDragging} enableMapZooming={settings.enableMapZooming} />
                <MapViewport bounds={bounds} ready={!loading} fitRequest={`${fitRequest}:${localFit}`} />
                <TileLayer key={tileLayerId} url={layer.url} attribution={layer.attribution} />
                {hasReceiver && <Marker position={[receiverLatitude, receiverLongitude]} icon={homeIcon}>
                    <Tooltip>{homeLabel}</Tooltip><Popup>{homeLabel}</Popup>
                </Marker>}
                {tracks.map(({id, points}) => {
                    const latest = points[points.length - 1];
                    const color = typeColor(latest.kind);
                    return <React.Fragment key={id}>
                        {settings.showTracks && points.length > 1 && <Polyline positions={points.map((point) => [point.latitude, point.longitude])}
                            pathOptions={{color, weight: 2, opacity: 0.65}} />}
                        {points.map((point, index) => <CircleMarker key={point.id}
                            center={[point.latitude, point.longitude]} radius={index === points.length - 1 ? 7 : 3}
                            pathOptions={{color, fillColor: color, fillOpacity: 0.85, weight: 2}}>
                            <PositionPopup point={point} />
                            {index === points.length - 1 && <Tooltip direction="top">{point.name}</Tooltip>}
                        </CircleMarker>)}
                    </React.Fragment>;
                })}
            </MapContainer>
            {!loading && !positions.length && <Alert severity="info" sx={{position: 'absolute', top: 12, left: 56,
                right: 12, zIndex: 500, pointerEvents: 'none'}}>
                {hasPositions ? t('packet_map.all_hidden', {defaultValue: 'All transmitter types are hidden.'})
                    : t('packet_map.empty', {defaultValue: 'No APRS or radiosonde positions in this date range.'})}
            </Alert>}
        </Box>
        <MapStatusBar sx={{position: 'relative', bottom: 'auto', zIndex: 'auto', flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 2, overflowX: 'auto', whiteSpace: 'nowrap'}}>
            <Typography variant="caption">{t('packet_map.packet_count', {defaultValue: '{{count}} positions', count: positions.length})}</Typography>
            <Typography variant="caption">{t('packet_map.transmitter_count', {defaultValue: '{{count}} transmitters', count: tracks.length})}</Typography>
            {!hasReceiver && <Typography variant="caption" color="warning.main">
                {t('packet_map.no_home', {defaultValue: 'Set your home location in station settings.'})}
            </Typography>}
        </MapStatusBar>
    </Box>;
}
