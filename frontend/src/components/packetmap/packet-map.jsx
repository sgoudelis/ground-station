/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Alert, Box, Paper, Typography} from '@mui/material';
import {alpha} from '@mui/material/styles';
import {Icon, svg} from 'leaflet';
import {CircleMarker, MapContainer, Marker, Pane, Polyline, TileLayer, useMap} from 'react-leaflet';
import {useSelector} from 'react-redux';
import {useTranslation} from 'react-i18next';
import 'leaflet/dist/leaflet.css';
import {homeIcon} from '../common/dataurl-icons.jsx';
import {getTileLayerById} from '../common/tile-layers.jsx';
import {getClassNamesBasedOnGridEditing, islandTitleBarCompactSx, MapStatusBar, TitleBar} from '../common/common.jsx';
import {isValidMapPosition, toLocationNumber} from '../filebrowser/position-utils.js';
import useMapIslandFullscreen from '../earthview/use-map-island-fullscreen.js';
import MapTitleControls from '../earthview/map-title-controls.jsx';
import {mapSettingsStoreName, mapViewStoreName, readMapSettings, readMapView, writeStored} from './storage.js';
import {TRANSMITTER_TYPES, typeColor} from './transmitters.js';
import MapInteractions from './map-interactions.jsx';
import PacketMapToolbar from './map-toolbar.jsx';
import PacketMapSettingsDialog from './map-settings-dialog.jsx';
import {createRadiosondeIcon} from './radiosonde-marker.js';
import {createAircraftIcon} from './aircraft-marker.js';
import {createAprsIcon, getAprsSymbol} from './aprs-marker.js';
import {buildPlaybackTrack, trackPositionAt} from './playback.js';
import {getHorizonRadii} from './horizon.js';
import VisibilityCircle from './visibility-circle.jsx';

export const POSITION_COLORS = Object.fromEntries(Object.entries(TRANSMITTER_TYPES).map(([kind, value]) => [kind, value.color]));

// Keep the smaller receiver icon local to this page; other maps share homeIcon.
const receiverIcon = new Icon({
    ...homeIcon.options,
    iconSize: [17.1, 17.1],
    iconAnchor: [8.55, 8.55],
    popupAnchor: [8.55, 8.55],
});

const hybridReferenceLayers = ['World_Transportation', 'World_Boundaries_and_Places'].map((service, index) => ({
    id: service,
    url: `https://services.arcgisonline.com/ArcGIS/rest/services/Reference/${service}/MapServer/tile/{z}/{y}/{x}`,
    attribution: 'Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, and the GIS user community',
    zIndex: index + 1,
}));

function aprsPosition(point, details) {
    // Current servers include each fix's symbol for playback. Older servers
    // expose only the latest symbol in the transmitter's details.
    return point.symbol_table !== undefined || point.symbol_code !== undefined
        ? point : details?.telemetry?.position;
}

export function MapViewport({bounds, ready, fitRequest, preserveViewRequest = 0, padding = 42, paddingTop = padding,
    selectedTransmitterId = null, selectedPoint}) {
    const map = useMap();
    const [savedView] = useState(readMapView);
    const hasUserView = useRef(Boolean(savedView));
    const programmatic = useRef(false);
    const lastFitRequest = useRef(fitRequest);
    const lastPreserveViewRequest = useRef(preserveViewRequest);
    const following = selectedTransmitterId !== null;
    const targetLatitude = selectedPoint?.latitude;
    const targetLongitude = selectedPoint?.longitude;
    const fitOptions = useMemo(() => ({paddingTopLeft: [padding, paddingTop], paddingBottomRight: [padding, padding],
        maxZoom: 13, animate: false}), [padding, paddingTop]);

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
            const center = ready && following && isValidMapPosition(targetLatitude, targetLongitude)
                ? [targetLatitude, targetLongitude] : map.getCenter();
            programmatic.current = true;
            map.invalidateSize({pan: false});
            if (!following && ready && !hasUserView.current && bounds.length) {
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
    }, [map, bounds, ready, fitOptions, following, targetLatitude, targetLongitude]);

    useEffect(() => {
        // Presets preserve even an automatically fitted view through loading and
        // subsequent results. Only an explicit Fit all request releases it.
        if (lastPreserveViewRequest.current !== preserveViewRequest) hasUserView.current = true;
        lastPreserveViewRequest.current = preserveViewRequest;
        const explicitFit = lastFitRequest.current !== fitRequest;
        lastFitRequest.current = fitRequest;
        if (explicitFit) {
            hasUserView.current = false;
            writeStored(mapViewStoreName, null);
        }
        if (following) {
            // Following owns the center, while the user's current zoom stays intact.
            // Retain that view after deselection until an explicit Fit all request.
            hasUserView.current = true;
            if (ready && isValidMapPosition(targetLatitude, targetLongitude)) {
                programmatic.current = true;
                map.setView([targetLatitude, targetLongitude], map.getZoom(), {animate: false});
                programmatic.current = false;
            }
            return;
        }
        // Keep the fit request active while the new range is loading; fit its
        // results once ready instead of fitting the previous range's bounds.
        if (!ready || hasUserView.current || !bounds.length) return;
        programmatic.current = true;
        map.invalidateSize({pan: false});
        map.fitBounds(bounds, fitOptions);
        programmatic.current = false;
    }, [map, bounds, ready, fitRequest, preserveViewRequest, fitOptions, following, selectedTransmitterId, targetLatitude, targetLongitude]);
    return null;
}

export default function PacketMap({positions, transmitters, hasPositions = positions.length > 0, loading, gridEditable, fitRequest = 0,
    preserveViewRequest = 0,
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
    // Share an SVG renderer for curved ring labels; transmitter paths use canvas.
    const visibilityRenderer = useMemo(() => svg({pane: 'packet-visibility'}), []);
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
    // Keep track geometry fixed while playback moves the symbols and followed target.
    const playback = useMemo(() => new Map(tracks.map((track) => {
        const details = transmitterDetails.get(track.id);
        const current = trackPositionAt(track, Number.isFinite(playbackTime) ? playbackTime : Date.now(), details?.telemetry?.vel_v);
        const point = current?.point;
        const icon = point?.kind === 'radiosonde' ? createRadiosondeIcon({
            phase: current.phase, altitude: point.altitude, name: point.name, stale: current.stale,
        }) : point?.kind === 'aprs' ? createAprsIcon({
            position: aprsPosition(point, details), report: details?.telemetry,
            phase: current.phase, altitude: point.altitude, name: point.name, stale: current.stale,
        }) : point?.kind === 'adsb' ? createAircraftIcon({
            track: point.track_deg, name: point.name || point.source, icao: point.source, stale: current.stale,
        }) : null;
        return [track.id, current ? {...current, icon} : null];
    })), [tracks, playbackTime, transmitterDetails]);
    // Follow the selected sonde's displayed position, including historical
    // interpolation. Unknown altitude must not produce a misleading footprint.
    const selectedPoint = playback.get(selectedTransmitterId)?.point;
    const horizonRadii = selectedPoint?.kind === 'radiosonde' ? getHorizonRadii(selectedPoint.altitude) : null;
    const visibilityCircles = horizonRadii ? [
        {id: 'horizon', radius: horizonRadii.horizon, color: '#2196f3',
            label: t('packet_map.radio_horizon', {defaultValue: 'Radio horizon (0°)'})},
        {id: 'five-degrees', radius: horizonRadii.fiveDegrees, color: '#4caf50',
            label: t('packet_map.five_degree_horizon', {defaultValue: '5° elevation'})},
    ].map((circle) => {
        return {...circle,
            pathLabel: `${t('packet_map.visibility_radius', {
                defaultValue: '{{radius}} km', radius: Math.round(circle.radius / 1000).toLocaleString(),
            })} · ${circle.label}`,
        };
    }) : [];
    const bounds = useMemo(() => {
        // Include the interpolated curve so fitting never clips a rounded bend.
        const coordinates = tracks.flatMap((track) => track.path);
        if (hasReceiver) coordinates.push([receiverLatitude, receiverLongitude]);
        return coordinates;
    }, [tracks, hasReceiver, receiverLatitude, receiverLongitude]);
    const hasBalloons = tracks.some((track) => track.points[0].kind === 'radiosonde'
        || getAprsSymbol(aprsPosition(track.points.at(-1), transmitterDetails.get(track.id)))?.balloon);
    const hasAprsPins = tracks.some((track) => track.points[0].kind === 'aprs');
    // Pins extend upward from their coordinates; leave space for the callsign above them.
    const paddingTop = hasBalloons ? 124 : hasAprsPins ? 72 : 42;

    // MapContainer freezes its initial className; keep pane styling on a live
    // wrapper so layer-order changes also apply to maps that are already open.
    return <Box className="packet-map" ref={islandRef} sx={(theme) => ({height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column',
        '&:fullscreen': {width: '100vw', height: '100vh', bgcolor: 'background.paper'},
        '&:-webkit-full-screen': {width: '100vw', height: '100vh', bgcolor: 'background.paper'},
        // Desaturate the whole marker so labels and APRS overlays age with the icon.
        '& .packet-marker-stale': {filter: 'grayscale(1)', opacity: 0.65},
        '& .packet-visibility-label': {
            fill: theme.palette.text.secondary,
            stroke: alpha(theme.palette.background.paper, 0.85),
            strokeWidth: '3px',
            strokeLinejoin: 'round',
            paintOrder: 'stroke',
            fontSize: '11px',
            fontWeight: theme.typography.fontWeightMedium,
            pointerEvents: 'none',
            userSelect: 'none',
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
                zoomSnap={0.25} zoomDelta={0.25} bounceAtZoomLimits={false}
                style={{height: '100%', width: '100%'}}>
                <MapInteractions enableMapDragging={settings.enableMapDragging} enableMapZooming={settings.enableMapZooming} />
                <MapViewport bounds={bounds} ready={!loading} fitRequest={`${fitRequest}:${localFit}`}
                    preserveViewRequest={preserveViewRequest} selectedTransmitterId={selectedTransmitterId}
                    selectedPoint={selectedPoint} paddingTop={paddingTop} />
                <TileLayer key={baseLayerId} url={layer.url} attribution={layer.attribution} zIndex={0} />
                {/* Transparent references share the tile pane, below transmitter paths and markers. */}
                {tileLayerId === 'hybrid' && hybridReferenceLayers.map(({id, ...reference}) =>
                    <TileLayer key={id} {...reference} />)}
                {/* Keep visibility rings below ground shadows (350) and paths (400). */}
                <Pane name="packet-visibility" style={{zIndex: 300, pointerEvents: 'none'}}>
                    {visibilityCircles.map(({id, radius, color, pathLabel}) => <VisibilityCircle key={id}
                        center={[selectedPoint.latitude, selectedPoint.longitude]} radius={radius} interactive={false}
                        renderer={visibilityRenderer} label={pathLabel}
                        pathOptions={{color, fill: false, weight: 2, opacity: 0.85, dashArray: '8 6'}} />)}
                </Pane>
                {hasReceiver && <Marker position={[receiverLatitude, receiverLongitude]} icon={receiverIcon} />}
                {/* Point clicks select the transmitter; details stay in the info panel. */}
                {tracks.map(({id, points, path}) => {
                    const latest = points[points.length - 1];
                    const endpoints = points.length > 1 ? [points[0], latest] : [latest];
                    const color = typeColor(latest.kind);
                    const current = playback.get(id);
                    const cursorColor = current?.stale && (current.point.kind === 'radiosonde' || current.point.kind === 'aprs')
                        ? '#9e9e9e' : color;
                    return <React.Fragment key={id}>
                        {settings.showTracks && id === selectedTransmitterId && path.length > 1 && <Polyline positions={path} smoothFactor={0.5}
                            pathOptions={{color, weight: 2, opacity: latest.kind === 'adsb' ? 0.3 : 1, lineCap: 'round', lineJoin: 'round'}} />}
                        {endpoints.filter((point) => point !== current?.point).map((point) => <CircleMarker key={point.id}
                            center={[point.latitude, point.longitude]} radius={3.42}
                            eventHandlers={{click: () => onSelectTransmitter?.(id)}}
                            pathOptions={{color, fillColor: color, fillOpacity: 0.25, weight: 2}} />)}
                        {current && (current.icon ? <Marker key="cursor" position={[current.point.latitude, current.point.longitude]}
                            title={current.point.kind === 'adsb' ? current.point.name || current.point.source || id : undefined}
                            icon={current.icon} eventHandlers={{click: () => onSelectTransmitter?.(id)}}
                        /> : <CircleMarker key="cursor" center={[current.point.latitude, current.point.longitude]} radius={5.985}
                            eventHandlers={{click: () => onSelectTransmitter?.(id)}}
                            pathOptions={{color: cursorColor, fillColor: cursorColor, fillOpacity: 0.85, weight: 2}} />)}
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
                {settings.showLegend && visibilityCircles.length > 0 && <Paper component="ul"
                    aria-label={t('packet_map.radio_visibility', {defaultValue: 'Radio visibility'})}
                    elevation={2} sx={{m: 0, px: 1.25, py: 0.75, display: 'flex', flexWrap: 'wrap', gap: 1.5,
                        maxWidth: '100%', listStyle: 'none', bgcolor: (theme) => alpha(theme.palette.background.paper, 0.9)}}>
                    {visibilityCircles.map(({id, radius, color, label}) => <Box component="li" key={id}
                        sx={{display: 'flex', alignItems: 'center', gap: 0.75}}>
                        <Box component="span" sx={{width: 20, borderTop: `2px dashed ${color}`}} />
                        <Typography variant="caption">{label} · {t('packet_map.visibility_radius', {
                            defaultValue: '{{radius}} km', radius: Math.round(radius / 1000).toLocaleString(),
                        })}</Typography>
                    </Box>)}
                </Paper>}
                {!loading && !positions.length && <Alert severity="info" sx={{alignSelf: 'stretch'}}>
                    {hasPositions ? t('packet_map.all_hidden', {defaultValue: 'All transmitter types are hidden.'})
                        : t('packet_map.empty', {defaultValue: 'No decoded transmitter positions in this date range.'})}
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
