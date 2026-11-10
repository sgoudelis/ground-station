/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useEffect, useMemo, useRef, useState} from 'react';
import {Alert, Box, Button, FormControlLabel, LinearProgress, MenuItem, Paper, Select, Switch, Tooltip, Typography} from '@mui/material';
import {useTheme} from '@mui/material/styles';
import RouteIcon from '@mui/icons-material/Route';
import FitScreenIcon from '@mui/icons-material/FitScreen';
import Map, {Layer, Marker, NavigationControl, Popup, Source} from 'react-map-gl/maplibre';
import {maplibregl} from '../common/maplibre.js';
import {MapRendererErrorBoundary, useMapLoadFailure} from '../common/map-load-error.jsx';
import {MapStatusBar, SimpleTruncatedHtml} from '../common/common.jsx';
import {useTranslation} from 'react-i18next';
import 'maplibre-gl/dist/maplibre-gl.css';
import {getMapLibreTileURL, getTileLayerById} from '../common/tile-layers.jsx';
import {formatDateTime} from '../../utils/date-time.js';
import {formatCaptureRunLabel} from './capture-run-label.js';
import {fileDialogSectionHeaderSx, fileDialogSectionSx} from './file-dialog-styles.js';
import useFlightPaths from './use-flight-paths.js';

const COLORS = ['#1976d2', '#e65100', '#9c6ade', '#00897b', '#d32f2f', '#00acc1'];

function flightColor(run) {
    let hash = 0;
    for (const character of run) hash = ((hash * 31) + character.charCodeAt(0)) >>> 0;
    return COLORS[hash % COLORS.length];
}

function FlightMapCanvas({flights, positions, mapStyle, fitVersion, zoomGestures, settings, onLoaded, onError}) {
    const {t} = useTranslation('filebrowser');
    const mapRef = useRef(null);
    const fittedVersion = useRef(null);
    const [ready, setReady] = useState(false);
    const [hover, setHover] = useState(null);
    const tracks = useMemo(() => ({type: 'FeatureCollection', features: flights.flatMap(flight =>
        flight.coordinates.filter(segment => segment.length > 1).map(coordinates => ({
            type: 'Feature', properties: {color: flight.color, label: flight.label},
            geometry: {type: 'LineString', coordinates},
        }))),
    }), [flights]);

    useEffect(() => {
        // Fit after MapLibre loads. Live appends and basemap changes retain the camera.
        if (!ready || fittedVersion.current === fitVersion || !positions.length) return;
        const map = mapRef.current;
        const bounds = positions.reduce((result, [longitude, latitude]) => [
            [Math.min(result[0][0], longitude), Math.min(result[0][1], latitude)],
            [Math.max(result[1][0], longitude), Math.max(result[1][1], latitude)],
        ], [positions[0], positions[0]]);
        map.resize();
        map.fitBounds(bounds, {padding: 28, maxZoom: 12, duration: 0});
        fittedVersion.current = fitVersion;
    }, [ready, positions, fitVersion]);
    useEffect(() => {
        if (!ready) return;
        // Allow pinch zoom while keeping recorded paths facing north.
        mapRef.current.getMap().touchZoomRotate.disableRotation();
        const observer = new ResizeObserver(() => mapRef.current?.resize());
        observer.observe(mapRef.current.getContainer());
        return () => observer.disconnect();
    }, [ready]);

    const showPathLabel = event => {
        const feature = event.features?.[0];
        setHover(feature ? {...event.lngLat, label: feature.properties.label} : null);
    };
    return <Map ref={mapRef} mapLib={maplibregl} mapStyle={mapStyle}
        initialViewState={{longitude: positions[0][0], latitude: positions[0][1], zoom: 8}}
        onLoad={() => {setReady(true); onLoaded();}} onIdle={onLoaded} onError={onError}
        style={{height: '100%', width: '100%'}} attributionControl={false}
        scrollZoom={zoomGestures} doubleClickZoom={zoomGestures} touchZoomRotate={zoomGestures} boxZoom={zoomGestures}
        dragRotate={false} touchPitch={false} pitchWithRotate={false} keyboard={false}
        interactiveLayerIds={['flight-path-lines']} onMouseMove={showPathLabel} onClick={showPathLabel}
        onMouseLeave={() => setHover(null)} onMoveStart={() => setHover(null)}>
        <NavigationControl position="top-left" showCompass={false} />
        <Source id="flight-paths" type="geojson" data={tracks}>
            <Layer id="flight-path-lines" type="line" layout={{'line-cap': 'round', 'line-join': 'round'}}
                paint={{'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.9}} />
        </Source>
        {flights.flatMap(flight => {
            const first = flight.segments[0][0];
            const last = flight.segments.at(-1).at(-1);
            return [{point: first, first: true}, {point: last, first: false}].map(endpoint => {
                const label = `${flight.label} · ${endpoint.first ? t('flight_paths.first', 'First recorded position')
                    : t('flight_paths.latest', 'Latest recorded position')} · ${formatDateTime(endpoint.point.captured_at, settings)} (${settings.timezone})`;
                return <Marker key={`${flight.run}-${endpoint.first}`} longitude={endpoint.point.longitude} latitude={endpoint.point.latitude} anchor="center">
                    <Tooltip title={label} arrow>
                        <Box component="button" type="button" aria-label={label}
                            sx={{display: 'block', width: endpoint.first ? 12 : 14, height: endpoint.first ? 12 : 14, p: 0,
                                borderRadius: '50%', border: '2px solid', borderColor: endpoint.first ? flight.color : '#fff',
                                bgcolor: endpoint.first ? '#fff' : flight.color, cursor: 'pointer',
                                '&:focus-visible': {outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 3}}} />
                    </Tooltip>
                </Marker>;
            });
        })}
        {hover && <Popup longitude={hover.lng} latitude={hover.lat} anchor="bottom" offset={8}
            closeButton={false} closeOnClick={false} maxWidth="260px">
            <Typography variant="caption" sx={{overflowWrap: 'anywhere'}}>{hover.label}</Typography>
        </Popup>}
    </Map>;
}

export default function FlightPathMap({socket, folderId, run, runs = [], settings, filter, kind = 'flight'}) {
    const {t} = useTranslation('filebrowser');
    const labels = kind === 'aprs' ? {
        activity: t('aprs_folder.activity', 'Station activity'),
        map: t('aprs_folder.path_map', 'Station path map'),
        loading: t('aprs_folder.loading_paths', 'Loading station paths'),
        unavailable: t('aprs_folder.paths_unavailable', 'Station paths are unavailable.'),
        legacy: t('aprs_folder.legacy', 'Legacy packets'),
    } : {
        activity: t('flight_paths.activity', 'Flight activity'),
        map: t('flight_paths.map', 'Flight path map'),
        loading: t('flight_paths.loading', 'Loading flight paths'),
        unavailable: t('flight_paths.unavailable', 'Flight paths are unavailable.'),
        legacy: t('radiosonde_folder.legacy', 'Legacy packets'),
    };
    const theme = useTheme();
    const {data, loading, error, refresh} = useFlightPaths(socket, folderId, run);
    const [layerId, setLayerId] = useState(theme.palette.mode === 'dark' ? 'esridarkcanvas' : 'osm');
    const [zoomGestures, setZoomGestures] = useState(false);
    const [fitVersion, setFitVersion] = useState(0);
    const tileLayer = getTileLayerById(layerId, {t, mapEngine: 'maplibre'});
    const tileURL = getMapLibreTileURL(layerId, {t, mapEngine: 'maplibre'});
    const attributionHtml = useMemo(
        () => `<a href="https://maplibre.org/" title="Open source map rendering" target="_blank" rel="noopener noreferrer">MapLibre</a> | ${tileLayer.attribution}`,
        [tileLayer.attribution],
    );
    const mapStyle = useMemo(() => ({version: 8,
        sources: {basemap: {type: 'raster', tiles: [tileURL], tileSize: 256, attribution: tileLayer.attribution}},
        layers: [{id: 'basemap', type: 'raster', source: 'basemap'}],
    }), [tileURL, tileLayer.attribution]);
    const {timezone, locale} = settings;
    const flights = useMemo(() => (data?.flights || []).map(flight => ({
        ...flight,
        color: flightColor(flight.run),
        label: formatCaptureRunLabel(runs.find(item => item.name === flight.run) || {name: flight.run}, {timezone, locale},
            flight.run === 'legacy' ? labels.legacy : flight.run),
        coordinates: flight.segments.map(segment => segment.map(point => [point.longitude, point.latitude])),
    })), [data, runs, timezone, locale, labels.legacy]);
    const positions = useMemo(() => flights.flatMap(flight => flight.coordinates.flat()), [flights]);
    const {attempt, failure, retry, reportError, reportLoaded} = useMapLoadFailure({
        engine: 'MapLibre', loadKey: JSON.stringify([folderId, run, tileURL]), enabled: positions.length > 0,
    });

    return <Paper component="section" aria-label={labels.activity} variant="outlined" sx={fileDialogSectionSx}>
        <Box sx={{...fileDialogSectionHeaderSx, px: {xs: 2, sm: 2.5}, bgcolor: 'background.paper',
            flexDirection: {xs: 'column', sm: 'row'}, alignItems: {xs: 'stretch', sm: 'center'}}}>
            <Box sx={{display: 'flex', alignItems: 'center', gap: 1.25}}>
                <RouteIcon sx={{fontSize: 20, color: 'text.secondary'}} />
                <Box>
                    <Typography component="h3" variant="subtitle2" fontWeight={600}>{labels.activity}</Typography>
                    <Typography variant="caption" color="text.secondary">{t('flight_paths.filter_hint', 'Filter applies to the map and history below.')}</Typography>
                </Box>
            </Box>
            {filter}
        </Box>
        <Box sx={{px: {xs: 2, sm: 2.5}, py: 1, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1.5}}>
            <Typography variant="caption" fontWeight={600} sx={{flexGrow: 1}}>{t('flight_paths.title', 'Recorded path')}</Typography>
            <Button size="small" startIcon={<FitScreenIcon />} disabled={!positions.length} onClick={() => setFitVersion(value => value + 1)}>
                {t('flight_paths.fit', 'Fit paths')}
            </Button>
            <FormControlLabel sx={{m: 0}} label={<Typography variant="caption">{t('flight_paths.zoom', 'Zoom gestures')}</Typography>}
                control={<Switch size="small" checked={zoomGestures} onChange={event => setZoomGestures(event.target.checked)}
                    slotProps={{input: {role: 'switch', 'aria-label': t('flight_paths.zoom', 'Zoom gestures')}}} />} />
            <Select size="small" value={layerId} onChange={event => setLayerId(event.target.value)}
                inputProps={{'aria-label': t('flight_paths.layer', 'Map layer')}} sx={{fontSize: '0.75rem', height: 30, minWidth: 112}}>
                <MenuItem value="osm">{t('flight_paths.street', 'Street')}</MenuItem>
                <MenuItem value="satellite">{t('flight_paths.satellite', 'Satellite')}</MenuItem>
                <MenuItem value="topo">{t('flight_paths.topographic', 'Topographic')}</MenuItem>
                <MenuItem value="esridarkcanvas">{t('flight_paths.dark', 'Dark')}</MenuItem>
            </Select>
        </Box>
        <Box sx={{height: 2}}>{loading && <LinearProgress aria-label={labels.loading} sx={{height: 2}} />}</Box>
        {error && <Alert severity="error" sx={{m: 2}} action={<Button size="small" color="inherit" onClick={refresh}>{t('flight_paths.retry', 'Retry')}</Button>}>{error}</Alert>}
        {failure && <Alert severity="error" sx={{m: 2}}
            action={<Button size="small" color="inherit" onClick={retry}>{t('flight_paths.retry', 'Retry')}</Button>}>{failure.message}</Alert>}
        {positions.length > 0 ? <>
            <Box role="region" aria-label={labels.map}
                sx={{height: {xs: 260, sm: 320}, position: 'relative', isolation: 'isolate',
                    '& .maplibregl-popup-content': {bgcolor: 'background.paper', color: 'text.primary', borderRadius: 1},
                    '& .maplibregl-popup-tip': {borderTopColor: 'background.paper'}}}>
                <MapRendererErrorBoundary resetKey={JSON.stringify([folderId, run, layerId, attempt])} onError={reportError}>
                    <FlightMapCanvas key={JSON.stringify([folderId, run, attempt])} flights={flights} positions={positions}
                        mapStyle={mapStyle} fitVersion={fitVersion} zoomGestures={zoomGestures} settings={settings}
                        onLoaded={reportLoaded} onError={reportError} />
                </MapRendererErrorBoundary>
            </Box>
            <MapStatusBar sx={{position: 'static', zIndex: 'auto', minWidth: 0}}>
                <SimpleTruncatedHtml className="attribution" htmlString={attributionHtml} />
            </MapStatusBar>
        </> : <Box sx={{px: 2.5, py: 5, textAlign: 'center', bgcolor: 'action.hover'}}>
            <RouteIcon sx={{fontSize: 32, color: 'text.disabled', mb: 1}} />
            <Typography variant="body2" color="text.secondary">{loading ? labels.loading
                : error ? labels.unavailable : t('flight_paths.empty', 'No recorded positions for this selection.')}</Typography>
        </Box>}
        <Box sx={{px: {xs: 2, sm: 2.5}, py: 1.5, borderTop: '1px solid', borderColor: 'divider'}}>
            <Box sx={{display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 0.5}}>
                {flights.map(flight => <Box key={flight.run} sx={{display: 'flex', gap: 0.75, alignItems: 'center', minWidth: 0}}>
                    <Box aria-hidden sx={{width: 18, height: 3, bgcolor: flight.color, flexShrink: 0}} />
                    <Typography variant="caption" sx={{overflowWrap: 'anywhere'}}>{flight.label}</Typography>
                </Box>)}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{display: 'block', mt: flights.length ? 0.75 : 0}}>
                {data && t('flight_paths.count', '{{count, number}} recorded positions', {count: data.point_count})}
                {data?.sampled && ` · ${t('flight_paths.sampled', '{{count, number}} shown for performance', {count: data.displayed_points})}`}
                {data && ' · '}{t('flight_paths.gaps', 'Lines break across reception gaps over 15 minutes. Markers show first and latest recorded positions.')}
            </Typography>
        </Box>
    </Paper>;
}
