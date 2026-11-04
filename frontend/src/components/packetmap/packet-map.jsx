/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Alert, Box, Typography} from '@mui/material';
import {alpha} from '@mui/material/styles';
import {DivIcon, Icon, svg} from 'leaflet';
import {CircleMarker, MapContainer, Marker, Pane, Polyline, TileLayer, Tooltip, useMap} from 'react-leaflet';
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
import AircraftMapMarker from './aircraft-map-marker.jsx';
import {selectAircraftShape} from './aircraft-symbol.js';
import useStableEvent from '../../hooks/useStableEvent.js';
import {createAprsIcon, getAprsSymbol} from './aprs-marker.js';
import {aircraftPathsAt, buildPlaybackTrack, trackPositionAt} from './playback.js';
import {getHorizonRadii} from './horizon.js';
import VisibilityCircle from './visibility-circle.jsx';
import {selectionCrosshair} from './selection-crosshair.js';
import MeshtasticMapMarker from './meshtastic-map-marker.jsx';
import {createMeshtasticRenderer, meshtasticPinSize} from './meshtastic-marker.js';

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
    // Navigation can release the camera without clearing the selected transmitter.
    const following = useRef(selectedTransmitterId !== null);
    const targetLatitude = selectedPoint?.latitude;
    const targetLongitude = selectedPoint?.longitude;
    const fitOptions = useMemo(() => ({paddingTopLeft: [padding, paddingTop], paddingBottomRight: [padding, padding],
        maxZoom: 13, animate: false}), [padding, paddingTop]);

    useEffect(() => {
        following.current = selectedTransmitterId !== null;
    }, [selectedTransmitterId]);

    useEffect(() => {
        // Guard map-generated events during restoration and automatic fitting.
        // Only a user's navigation should disable fitting for future results.
        if (savedView) {
            programmatic.current = true;
            map.setView(savedView.center, savedView.zoom, {animate: false});
            programmatic.current = false;
        }
        let zooming = false;
        const panStarted = () => {
            if (programmatic.current) return;
            hasUserView.current = true;
            // Leaflet also emits movestart during zooms; changing zoom keeps the lock.
            if (!zooming) following.current = false;
        };
        const zoomStarted = () => {
            zooming = true;
            if (!programmatic.current) hasUserView.current = true;
        };
        const persist = () => {
            if (!programmatic.current && hasUserView.current) {
                const {lat, lng} = map.getCenter();
                writeStored(mapViewStoreName, {center: [lat, lng], zoom: map.getZoom()});
            }
        };
        const zoomEnded = () => {
            zooming = false;
            persist();
        };
        // Movement from navigation buttons also counts as manual navigation.
        map.on('movestart', panStarted);
        map.on('zoomstart', zoomStarted);
        map.on('moveend', persist);
        map.on('zoomend', zoomEnded);
        return () => {
            map.off('movestart', panStarted);
            map.off('zoomstart', zoomStarted);
            map.off('moveend', persist);
            map.off('zoomend', zoomEnded);
        };
    }, [map, savedView]);

    useEffect(() => {
        const observer = new ResizeObserver(() => {
            const center = ready && following.current && isValidMapPosition(targetLatitude, targetLongitude)
                ? [targetLatitude, targetLongitude] : map.getCenter();
            programmatic.current = true;
            map.invalidateSize({pan: false});
            if (!following.current && ready && !hasUserView.current && bounds.length) {
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
    }, [map, bounds, ready, fitOptions, targetLatitude, targetLongitude]);

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
        if (following.current) {
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
    }, [map, bounds, ready, fitRequest, preserveViewRequest, fitOptions, selectedTransmitterId, targetLatitude, targetLongitude]);
    return null;
}

export default function PacketMap({positions, transmitters, hasPositions = positions.length > 0, loading, gridEditable, fitRequest = 0,
    preserveViewRequest = 0,
    selectedTransmitterId = null, onSelectTransmitter, hiddenTypes = [], onHiddenTypesChange, onFitAll, playbackTime}) {
    const {t} = useTranslation('navigation');
    const selectTransmitter = useStableEvent((id) => onSelectTransmitter?.(id));
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
    const meshtasticRenderer = useMemo(createMeshtasticRenderer, []);
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
        return [...groups.entries()].map(([id, points]) => ({id, ...buildPlaybackTrack(points, {
            smooth: points[0]?.kind !== 'adsb',
        })}))
            .filter((track) => track.points.length);
    }, [positions]);
    // Only the selected aircraft needs the curve used by its visible trail.
    const selectedTrack = useMemo(() => {
        const track = tracks.find(({id}) => id === selectedTransmitterId);
        return track?.points[0]?.kind === 'adsb' ? {...track, ...buildPlaybackTrack(track.points)} : track;
    }, [tracks, selectedTransmitterId]);
    // Keep track geometry fixed while playback moves the symbols and followed target.
    const playback = useMemo(() => new Map(tracks.map((track) => {
        const details = transmitterDetails.get(track.id);
        const current = trackPositionAt(track.id === selectedTransmitterId ? selectedTrack : track,
            Number.isFinite(playbackTime) ? playbackTime : Date.now(), details?.telemetry?.vel_v);
        const point = current?.point;
        // New captures carry explicit status clears. For older map responses,
        // latest telemetry belongs only to the endpoint, never an earlier fix.
        const aircraftReport = point && (Object.hasOwn(point, 'squawk') || Object.hasOwn(point, 'emergency'))
            ? point : point?._details?.telemetry ?? (point === track.points.at(-1) ? details?.telemetry : null);
        const icon = point?.kind === 'radiosonde' ? createRadiosondeIcon({
            phase: current.phase, altitude: point.altitude, name: point.name, stale: current.stale,
            selected: track.id === selectedTransmitterId,
        }) : point?.kind === 'aprs' ? createAprsIcon({
            position: aprsPosition(point, details), report: details?.telemetry,
            phase: current.phase, altitude: point.altitude, name: point.name, stale: current.stale,
            selected: track.id === selectedTransmitterId,
        }) : null;
        // Per-fix metadata follows playback; older captures use the row's lookup.
        const aircraftShape = point?.kind === 'adsb' ? selectAircraftShape(
            point.aircraft ?? point._details?.telemetry?.aircraft ?? details?.telemetry?.aircraft
        ) : null;
        return [track.id, current ? {...current, icon, aircraftShape, aircraftReport} : null];
    })), [tracks, selectedTrack, playbackTime, transmitterDetails, selectedTransmitterId]);
    // Follow the selected sonde's displayed position, including historical
    // interpolation. Unknown altitude must not produce a misleading footprint.
    const selectedCursor = playback.get(selectedTransmitterId);
    const selectedPoint = selectedCursor?.point;
    // Only aircraft trails depend on the clock. Stable bounds prevent idle
    // reception ticks from refitting the camera for other map content.
    const aircraftCursor = selectedTrack?.points[0]?.kind === 'adsb' ? selectedCursor : null;
    const aircraftTime = aircraftCursor ? playbackTime : null;
    const selectedPaths = useMemo(() => selectedTrack?.points[0]?.kind === 'adsb'
        ? aircraftPathsAt(selectedTrack, aircraftTime, aircraftCursor)
        : selectedTrack ? [selectedTrack.path] : [], [selectedTrack, aircraftTime, aircraftCursor]);
    // APRS balloons already draw a reticle around their raised flight symbol.
    const showNodeSelection = selectedPoint?.kind === 'meshtastic'
        || (selectedPoint?.kind === 'aprs' && !selectedCursor.icon?.options.className?.includes('packet-radiosonde-marker'));
    const selectedPinHeight = selectedPoint?.kind === 'meshtastic' ? meshtasticPinSize[1]
        : showNodeSelection ? selectedCursor.icon?.options.iconSize?.[1] ?? 0 : 0;
    // Keep ground nodes/labels on canvas; only the selected node needs a DOM reticle.
    const nodeSelectionIcon = useMemo(() => new DivIcon({
        className: 'packet-node-selection-marker', iconSize: [52, 52],
        iconAnchor: [26, 26 + selectedPinHeight / 2], html: selectionCrosshair,
    }), [selectedPinHeight]);
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
    const visibleAircraftIds = tracks.filter((track) => track.points[0]?.kind === 'adsb' && playback.get(track.id))
        .map((track) => track.id).join(',');
    const bounds = useMemo(() => {
        const visible = new Set(visibleAircraftIds.split(','));
        // Include the interpolated curve so fitting never clips a rounded bend.
        const coordinates = tracks.flatMap((track) => {
            // Expired aircraft must not pull Fit all toward obsolete positions.
            if (track.points[0]?.kind === 'adsb') {
                return visible.has(track.id) ? (track.id === selectedTransmitterId ? selectedPaths.flat()
                    : track.path) : [];
            }
            return track.path;
        });
        if (hasReceiver) coordinates.push([receiverLatitude, receiverLongitude]);
        return coordinates;
    }, [tracks, visibleAircraftIds, selectedPaths, selectedTransmitterId, hasReceiver, receiverLatitude, receiverLongitude]);
    const hasBalloons = tracks.some((track) => track.points[0].kind === 'radiosonde'
        || getAprsSymbol(aprsPosition(track.points.at(-1), transmitterDetails.get(track.id)))?.balloon);
    const hasGroundPins = tracks.some((track) => ['aprs', 'meshtastic'].includes(track.points[0].kind));
    // Pins extend upward from their coordinates; leave space for the callsign above them.
    const paddingTop = hasBalloons ? 124 : hasGroundPins ? 72 : 42;

    // MapContainer freezes its initial className; keep pane styling on a live
    // wrapper so layer-order changes also apply to maps that are already open.
    return <Box className="packet-map" ref={islandRef} sx={(theme) => ({height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column',
        '&:fullscreen': {width: '100vw', height: '100vh', bgcolor: 'background.paper'},
        '&:-webkit-full-screen': {width: '100vw', height: '100vh', bgcolor: 'background.paper'},
        // Floating symbols fade their data separately so selection frames stay red.
        '& .packet-marker-stale:not(.packet-aircraft-marker):not(.packet-radiosonde-marker)': {filter: 'grayscale(1)', opacity: 0.65},
        // Match the tracked-satellite crosshair in Earth View for every theme.
        '& .packet-aircraft-crosshair, & .packet-radiosonde-crosshair, & .packet-selection-crosshair': {color: theme.palette.error.main},
        '& .packet-node-selection-marker': {background: 'transparent', border: 0, pointerEvents: 'none'},
        '& .packet-selection-crosshair': {display: 'block', width: 52, height: 52, filter: 'drop-shadow(0 0 1px #000)'},
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
                {/* Keep home above ground shadows (350), below canvas labels (400) and transmitter markers (600). */}
                {hasReceiver && <Pane name="packet-home" style={{zIndex: 375}}>
                    <Marker position={[receiverLatitude, receiverLongitude]} icon={receiverIcon} />
                </Pane>}
                {/* Point clicks select the transmitter; details stay in the info panel. */}
                {tracks.map(({id, points}) => {
                    const latest = points[points.length - 1];
                    const color = typeColor(latest.kind);
                    const current = playback.get(id);
                    const cursorColor = current?.stale && (current.point.kind === 'radiosonde' || current.point.kind === 'aprs')
                        ? '#9e9e9e' : color;
                    return <React.Fragment key={id}>
                        {settings.showTracks && id === selectedTransmitterId && selectedPaths.filter((path) => path.length > 1)
                            .map((path, index) => <Polyline key={`trail:${index}`} positions={path} smoothFactor={0.5}
                                pathOptions={{color: latest.kind === 'adsb' && current?.stale ? '#9e9e9e' : color,
                                    weight: 2, opacity: latest.kind === 'adsb' ? current?.stale ? 0.15 : 0.3 : 1,
                                    lineCap: 'round', lineJoin: 'round'}} />)}
                        {current && (current.point.kind === 'meshtastic' ? <MeshtasticMapMarker key="cursor" id={id}
                            latitude={current.point.latitude} longitude={current.point.longitude}
                            name={current.point.name || current.point.source} selected={id === selectedTransmitterId}
                            renderer={meshtasticRenderer} onSelectTransmitter={selectTransmitter}
                        /> : current.aircraftShape ? <AircraftMapMarker key="cursor" id={id}
                            latitude={current.point.latitude} longitude={current.point.longitude}
                            track={current.point.track_deg} name={current.point.name || current.point.source}
                            icao={current.point.source} shapeName={current.aircraftShape.name} shapeScale={current.aircraftShape.scale}
                            squawk={current.aircraftReport?.squawk} emergency={current.aircraftReport?.emergency}
                            stale={current.stale} selected={id === selectedTransmitterId} onSelectTransmitter={selectTransmitter}
                        /> : current.icon ? <Marker key="cursor" position={[current.point.latitude, current.point.longitude]}
                            icon={current.icon} eventHandlers={{click: () => onSelectTransmitter?.(id)}}
                        /> : <CircleMarker key="cursor" center={[current.point.latitude, current.point.longitude]} radius={5.985}
                            eventHandlers={{click: () => onSelectTransmitter?.(id)}}
                            pathOptions={{color: cursorColor, fillColor: cursorColor, fillOpacity: 0.85, weight: 2}}>
                            {current.point.kind !== 'meshtastic' && <Tooltip>{current.point.name || current.point.source}</Tooltip>}
                        </CircleMarker>)}
                    </React.Fragment>;
                })}
                {showNodeSelection && <Marker
                    position={[selectedPoint.latitude, selectedPoint.longitude]} icon={nodeSelectionIcon}
                    interactive={false} keyboard={false} zIndexOffset={1000} />}
            </MapContainer>
            {/* Keep overlays clear of the pan buttons and let map gestures pass through. */}
            <Box sx={{position: 'absolute', top: 12, left: 12, right: 12, zIndex: 500, display: 'flex',
                flexDirection: 'column', alignItems: 'flex-end', gap: 1, pointerEvents: 'none'}}>
                {!loading && !positions.length && <Alert severity="info" sx={{alignSelf: 'stretch'}}>
                    {hasPositions ? t('packet_map.all_hidden', {defaultValue: 'All transmitter types are hidden.'})
                        : t('packet_map.empty', {defaultValue: 'No packets containing location coordinates were decoded in the selected timeframe.'})}
                </Alert>}
            </Box>
        </Box>
        <MapStatusBar sx={{position: 'relative', bottom: 'auto', zIndex: 'auto', flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 2, overflowX: 'auto', whiteSpace: 'nowrap'}}>
            <Typography variant="caption">{t('packet_map.packet_count', {defaultValue: '{{count}} positions', count: positions.length})}</Typography>
            <Typography variant="caption">{t('packet_map.transmitter_count', {defaultValue: '{{count}} transmitters',
                count: [...playback.values()].filter(Boolean).length})}</Typography>
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
