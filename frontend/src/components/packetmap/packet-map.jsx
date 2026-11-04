/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Alert, Box, Typography} from '@mui/material';
import {alpha} from '@mui/material/styles';
import MapLibreMap, {Marker, Source, Layer, useMap} from 'react-map-gl/maplibre';
import {maplibregl} from '../common/maplibre.js';
import {MarkerArtwork} from './marker-artwork.js';
import ArtworkMapMarker from './artwork-map-marker.jsx';
import {useSelector} from 'react-redux';
import {useTranslation} from 'react-i18next';
import 'maplibre-gl/dist/maplibre-gl.css';
import {homeIcon} from '../common/dataurl-icons.jsx';
import {getTileLayerById, getMapLibreTileURL, MAP_ENGINE_MAPLIBRE} from '../common/tile-layers.jsx';
import {getClassNamesBasedOnGridEditing, islandTitleBarCompactSx, MapStatusBar, SimpleTruncatedHtml, TitleBar} from '../common/common.jsx';
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

const hybridReferenceLayers = ['World_Transportation', 'World_Boundaries_and_Places'].map((service) => ({
    id: service,
    url: `https://services.arcgisonline.com/ArcGIS/rest/services/Reference/${service}/MapServer/tile/{z}/{y}/{x}`,
    attribution: 'Esri, HERE, Garmin, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, and the GIS user community',
}));

function aprsPosition(point, details) {
    // Current servers include each fix's symbol for playback. Older servers
    // expose only the latest symbol in the transmitter's details.
    return point.symbol_table !== undefined || point.symbol_code !== undefined
        ? point : details?.telemetry?.position;
}

export function MapViewport({bounds, ready, fitRequest, preserveViewRequest = 0, padding = 42, paddingTop = padding,
    selectedTransmitterId = null, selectedPoint}) {
    const {current} = useMap();
    const map = current?.getMap();
    const [savedView] = useState(readMapView);
    const hasUserView = useRef(Boolean(savedView));
    const programmatic = useRef(false);
    const lastFitRequest = useRef(fitRequest);
    const lastPreserveViewRequest = useRef(preserveViewRequest);
    // Navigation can release the camera without clearing the selected transmitter.
    const following = useRef(selectedTransmitterId !== null);
    const targetLatitude = selectedPoint?.latitude;
    const targetLongitude = selectedPoint?.longitude;
    const fitOptions = useMemo(() => ({padding: {top: paddingTop, left: padding, right: padding, bottom: padding},
        maxZoom: 13, duration: 0}), [padding, paddingTop]);
    // Playback stores [latitude, longitude]; MapLibre bounds use [longitude, latitude].
    const fitBounds = useMemo(() => bounds.length ? bounds.reduce(([min, max], [lat, lon]) => [
        [Math.min(min[0], lon), Math.min(min[1], lat)], [Math.max(max[0], lon), Math.max(max[1], lat)],
    ], [[Infinity, Infinity], [-Infinity, -Infinity]]) : null, [bounds]);

    useEffect(() => {
        following.current = selectedTransmitterId !== null;
    }, [selectedTransmitterId]);

    useEffect(() => {
        if (!map) return;
        // Guard map-generated events during restoration and automatic fitting.
        // Only a user's navigation should disable fitting for future results.
        if (savedView) {
            programmatic.current = true;
            map.jumpTo({center: [savedView.center[1], savedView.center[0]], zoom: savedView.zoom});
            programmatic.current = false;
        }
        let zooming = false;
        const panStarted = (event) => {
            if (programmatic.current || event?.packetMapResize) return;
            hasUserView.current = true;
            // MapLibre emits movestart before zoomstart. Inspect the camera's
            // zoom state as well so wheel/button zooms keep the target lock.
            if (!zooming && !map.isZooming()) following.current = false;
        };
        const zoomStarted = () => {
            zooming = true;
            if (!programmatic.current) hasUserView.current = true;
        };
        const persist = (event) => {
            if (!programmatic.current && !event?.packetMapResize && hasUserView.current) {
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
        if (!map) return;
        const observer = new ResizeObserver(() => {
            const center = ready && following.current && isValidMapPosition(targetLatitude, targetLongitude)
                ? [targetLongitude, targetLatitude] : map.getCenter();
            programmatic.current = true;
            map.resize();
            if (!following.current && ready && !hasUserView.current && bounds.length) {
                map.fitBounds(fitBounds, fitOptions);
            } else {
                // Preserve the camera when a grid window shrinks, without
                // saving the resize as manual navigation.
                map.jumpTo({center, zoom: map.getZoom()});
            }
            programmatic.current = false;
        });
        observer.observe(map.getContainer());
        return () => observer.disconnect();
    }, [map, bounds, fitBounds, ready, fitOptions, targetLatitude, targetLongitude]);

    useEffect(() => {
        if (!map) return;
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
                map.jumpTo({center: [targetLongitude, targetLatitude], zoom: map.getZoom()});
                programmatic.current = false;
            }
            return;
        }
        // Keep the fit request active while the new range is loading; fit its
        // results once ready instead of fitting the previous range's bounds.
        if (!ready || hasUserView.current || !bounds.length) return;
        programmatic.current = true;
        map.resize();
        map.fitBounds(fitBounds, fitOptions);
        programmatic.current = false;
    }, [map, bounds, fitBounds, ready, fitRequest, preserveViewRequest, fitOptions, selectedTransmitterId, targetLatitude, targetLongitude]);
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
    const meshtasticRenderer = useMemo(createMeshtasticRenderer, []);
    // Fullscreen size adjustments emit movement events too; they must preserve
    // the target lock and must not overwrite the user's saved camera.
    const {islandRef, isFullscreen, toggleFullscreen} = useMapIslandFullscreen(
        () => mapRef.current?.resize({packetMapResize: true})
    );
    const applySettings = (next) => {
        setSettings(next);
        writeStored(mapSettingsStoreName, next);
    };
    const toggleSetting = (key) => applySettings({...settings, [key]: !settings[key]});
    const receiverLatitude = toLocationNumber(receiver?.lat);
    const receiverLongitude = toLocationNumber(receiver?.lon);
    const hasReceiver = isValidMapPosition(receiverLatitude, receiverLongitude);
    const baseLayerId = tileLayerId === 'hybrid' ? 'satellite' : tileLayerId;
    const layer = getTileLayerById(baseLayerId, {t, preferences, mapEngine: MAP_ENGINE_MAPLIBRE});
    const tileURL = getMapLibreTileURL(baseLayerId, {t, preferences, mapEngine: MAP_ENGINE_MAPLIBRE});
    const mapStyle = useMemo(() => {
        const sources = {basemap: {type: 'raster', tiles: [tileURL], tileSize: 256, attribution: layer.attribution}};
        const layers = [{id: 'basemap', type: 'raster', source: 'basemap'}];
        // Transparent street references belong below all telemetry overlays.
        if (tileLayerId === 'hybrid') hybridReferenceLayers.forEach(({id, url, attribution}) => {
            sources[id] = {type: 'raster', tiles: [url], tileSize: 256, attribution};
            layers.push({id, type: 'raster', source: id});
        });
        return {version: 8, sources, layers};
    }, [tileURL, tileLayerId, layer.attribution]);
    const attributionHtml = `<a href="https://maplibre.org/" title="Open source map rendering" target="_blank" rel="noopener noreferrer">MapLibre</a> | ${layer.attribution}`
        + (tileLayerId === 'hybrid' ? ` | ${hybridReferenceLayers[0].attribution}` : '');
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
    const nodeSelectionIcon = useMemo(() => new MarkerArtwork({
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
            {/* MapViewport owns resizing so its camera guards cover resize events. */}
            <MapLibreMap ref={mapRef} mapLib={maplibregl} mapStyle={mapStyle} attributionControl={false}
                trackResize={false}
                initialViewState={{latitude: initialView?.center[0] ?? (hasReceiver ? receiverLatitude : 20),
                    longitude: initialView?.center[1] ?? (hasReceiver ? receiverLongitude : 0),
                    zoom: initialView?.zoom ?? (hasReceiver ? 9 : 2)}}
                dragPan={settings.enableMapDragging} scrollZoom={settings.enableMapZooming}
                doubleClickZoom={settings.enableMapZooming} touchZoomRotate={settings.enableMapZooming}
                boxZoom={settings.enableMapZooming} dragRotate={false} touchPitch={false} keyboard={false}
                renderWorldCopies={false} maxPitch={0} style={{height: '100%', width: '100%'}}>
                <MapInteractions enableMapDragging={settings.enableMapDragging} />
                <MapViewport bounds={bounds} ready={!loading} fitRequest={`${fitRequest}:${localFit}`}
                    preserveViewRequest={preserveViewRequest} selectedTransmitterId={selectedTransmitterId}
                    selectedPoint={selectedPoint} paddingTop={paddingTop} />
                {visibilityCircles.map(({id, radius, color, pathLabel}) => <VisibilityCircle key={id}
                    center={[selectedPoint.latitude, selectedPoint.longitude]} radius={radius} label={pathLabel}
                    pathOptions={{color, fill: false, weight: 2, opacity: 0.85, dashArray: '8 6'}} />)}
                {hasReceiver && <Marker latitude={receiverLatitude} longitude={receiverLongitude} anchor="center"
                    style={{pointerEvents: 'none', zIndex: 2}}>
                    <img src={homeIcon.options.iconUrl} alt={t('packet_map.home', {defaultValue: 'Home'})}
                        style={{width: 17.1, height: 17.1}} />
                </Marker>}
                {/* Point clicks select the transmitter; details stay in the info panel. */}
                {tracks.map(({id, points}) => {
                    const latest = points[points.length - 1];
                    const color = typeColor(latest.kind);
                    const current = playback.get(id);
                    const cursorColor = current?.stale && (current.point.kind === 'radiosonde' || current.point.kind === 'aprs')
                        ? '#9e9e9e' : color;
                    return <React.Fragment key={id}>
                        {settings.showTracks && id === selectedTransmitterId && selectedPaths.filter((path) => path.length > 1)
                            .map((path, index) => <Source key={`trail:${index}`} id={`packet-trail-${index}`} type="geojson"
                                data={{type: 'Feature', properties: {}, geometry: {type: 'LineString',
                                    coordinates: path.map(([lat, lon]) => [lon, lat])}}}>
                                <Layer id={`packet-trail-line-${index}`} type="line"
                                    layout={{'line-cap': 'round', 'line-join': 'round'}}
                                    paint={{'line-color': latest.kind === 'adsb' && current?.stale ? '#9e9e9e' : color,
                                        'line-width': 2, 'line-opacity': latest.kind === 'adsb' ? current?.stale ? 0.15 : 0.3 : 1}} />
                            </Source>)}
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
                        /> : current.icon ? <ArtworkMapMarker key="cursor"
                            latitude={current.point.latitude} longitude={current.point.longitude} icon={current.icon}
                            onClick={() => selectTransmitter(id)}
                        /> : <Marker key="cursor" latitude={current.point.latitude} longitude={current.point.longitude}
                            anchor="center" style={{zIndex: 3}} onClick={(event) => {
                                event.originalEvent.stopPropagation(); selectTransmitter(id);
                            }}>
                            <Box title={current.point.name || current.point.source} sx={{width: 12, height: 12,
                                borderRadius: '50%', border: `2px solid ${cursorColor}`, bgcolor: alpha(cursorColor, 0.85),
                                cursor: 'pointer'}} />
                        </Marker>)}
                    </React.Fragment>;
                })}
                {showNodeSelection && <ArtworkMapMarker
                    latitude={selectedPoint.latitude} longitude={selectedPoint.longitude} icon={nodeSelectionIcon}
                    interactive={false} />}
            </MapLibreMap>
            {/* Keep overlays clear of the pan buttons and let map gestures pass through. */}
            <Box sx={{position: 'absolute', top: 12, left: 12, right: 12, zIndex: 500, display: 'flex',
                flexDirection: 'column', alignItems: 'flex-end', gap: 1, pointerEvents: 'none'}}>
                {!loading && !positions.length && <Alert severity="info" sx={{alignSelf: 'stretch'}}>
                    {hasPositions ? t('packet_map.all_hidden', {defaultValue: 'All transmitter types are hidden.'})
                        : t('packet_map.empty', {defaultValue: 'No packets containing location coordinates were decoded in the selected timeframe.'})}
                </Alert>}
            </Box>
        </Box>
        <MapStatusBar sx={{position: 'relative', bottom: 'auto', zIndex: 'auto', flexShrink: 0}}>
            <SimpleTruncatedHtml className="attribution" htmlString={attributionHtml} />
        </MapStatusBar>
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
