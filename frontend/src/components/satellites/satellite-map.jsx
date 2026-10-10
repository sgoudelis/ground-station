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
 */

import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {
    MapContainer,
    Marker as LeafletMarker,
    Polygon,
    Polyline,
    TileLayer,
    WMSTileLayer,
} from 'react-leaflet';
import Map, {Layer, Marker, Popup, Source} from 'react-map-gl/maplibre';
import L from 'leaflet';
import {Box, useTheme} from '@mui/material';
import {shallowEqual, useSelector} from 'react-redux';
import {maplibregl} from '../common/maplibre.js';
import {
    getMapCrsByTileLayerId,
    getMapLibreTileURL,
    getTileLayerById,
    MAP_ENGINE_MAPLIBRE,
    MAP_ENGINE_MAPLIBRE_GLOBE,
    normalizeMapEngine,
} from '../common/tile-layers.jsx';
import {homeIcon, moonIcon, satelliteIcon2, sunIcon} from '../common/dataurl-icons.jsx';
import {
    InternationalDateLinePolyline,
    MapStatusBar,
    SimpleTruncatedHtml,
    ThemedLeafletTooltip,
    humanizeAltitude,
    humanizeVelocity,
} from '../common/common.jsx';
import CoordinateGrid from '../common/mercator-grid.jsx';
import createTerminatorLine from '../common/terminator-line.jsx';
import {getSunMoonCoords} from '../common/sunmoon.jsx';
import {getSatelliteCoverageCircle} from '../common/tracking-logic.jsx';
import {resolveDynamicOrbitPathSegments} from '../common/orbit-path-dynamic-split.js';
import {createSatelliteRecord, propagateSatelliteRecord} from '../../hooks/liveorbit.js';
import {
    fitDialogMapLibreCoverage,
    getDialogLeafletCoveragePadding,
} from './dialogcoveragefit.js';
import { useTranslation } from 'react-i18next';

const MAPLIBRE_MIN_ZOOM = -2;
const LEAFLET_MIN_ZOOM = -4;
const MAP_MAX_ZOOM = 10;

const DEFAULT_MAP_SETTINGS = Object.freeze({
    lockOnTarget: true,
    enableMapDragging: false,
    enableMapZooming: false,
    showPastOrbitPath: true,
    showFutureOrbitPath: true,
    showSatelliteCoverage: true,
    showSunIcon: true,
    showMoonIcon: true,
    showTerminatorLine: true,
    showTooltip: true,
    showGrid: true,
    pastOrbitLineColor: '#33c833',
    futureOrbitLineColor: '#e4971e',
    satelliteCoverageColor: '#FFFFFF',
    orbitProjectionDuration: 1440,
    tileLayerID: 'satellite',
    mapEngine: MAP_ENGINE_MAPLIBRE,
    mapZoomLevel: 2,
});

const DATE_LINE_GEOJSON = {
    type: 'FeatureCollection',
    features: [
        {type: 'Feature', geometry: {type: 'LineString', coordinates: [[180, 90], [180, -90]]}},
        {type: 'Feature', geometry: {type: 'LineString', coordinates: [[-180, 90], [-180, -90]]}},
    ],
};

const toLatLon = (point) => {
    if (!point) return null;
    const lat = Number(Array.isArray(point) ? point[0] : point.lat);
    const lon = Number(Array.isArray(point) ? point[1] : point.lon ?? point.lng);
    return Number.isFinite(lat) && Number.isFinite(lon) ? [lat, lon] : null;
};

const toLngLat = (point) => {
    const latLon = toLatLon(point);
    return latLon ? [latLon[1], latLon[0]] : null;
};

const buildLineGeoJSON = (segments) => ({
    type: 'FeatureCollection',
    features: (Array.isArray(segments) ? segments : [])
        .map((segment) => (Array.isArray(segment) ? segment.map(toLngLat).filter(Boolean) : []))
        .filter((coordinates) => coordinates.length > 1)
        .map((coordinates) => ({type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates}})),
});

const buildGridGeoJSON = () => {
    const features = [];
    for (let lat = -75; lat <= 75; lat += 15) {
        features.push({type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates: [[-180, lat], [180, lat]]}});
    }
    for (let lon = -180; lon <= 180; lon += 15) {
        features.push({type: 'Feature', properties: {}, geometry: {type: 'LineString', coordinates: [[lon, -85], [lon, 85]]}});
    }
    return {type: 'FeatureCollection', features};
};

const GRID_GEOJSON = buildGridGeoJSON();

const projectTerminatorForMapLibre = (points) => {
    const normalized = (Array.isArray(points) ? points : []).map(toLatLon).filter(Boolean);
    const line = normalized.filter(([, lon]) => lon >= -180 && lon <= 180);
    if (line.length < 2) return {line: [], polygon: []};
    const polePoint = normalized.find(([lat]) => Math.abs(Math.abs(lat) - 90) < 0.5);
    if (!polePoint) return {line, polygon: [...line, line[0]]};
    const poleLat = polePoint[0] >= 0 ? 90 : -90;
    return {
        line,
        polygon: [[poleLat, line[0][1]], ...line, [poleLat, line[line.length - 1][1]], [poleLat, line[0][1]]],
    };
};

const selectMapSettings = (state) => ({...DEFAULT_MAP_SETTINGS, ...(state?.targetSatTrack || {})});

const useDialogMapResize = (map) => {
    const containerRef = useRef(null);
    const [revision, setRevision] = useState(0);

    useEffect(() => {
        const container = containerRef.current;
        if (!map || !container) return undefined;
        let animationFrame = null;
        const updateMapSize = () => {
            if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
            animationFrame = window.requestAnimationFrame(() => {
                if (typeof map.resize === 'function') map.resize();
                else map.invalidateSize?.({pan: false});
                setRevision((current) => current + 1);
            });
        };
        const handleNativeResize = () => setRevision((current) => current + 1);
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateMapSize);
        observer?.observe(container);
        // MUI's dialog transition can finish without changing the layout box,
        // so ResizeObserver alone is not enough to trigger the final camera fit.
        const dialogPaper = container.closest('.MuiDialog-paper');
        dialogPaper?.addEventListener('transitionend', updateMapSize);
        map.on?.('resize', handleNativeResize);
        updateMapSize();

        return () => {
            if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
            observer?.disconnect();
            dialogPaper?.removeEventListener('transitionend', updateMapSize);
            map.off?.('resize', handleNativeResize);
        };
    }, [map]);

    return {containerRef, revision};
};

const buildOrbitPaths = (record, now, durationMinutes) => {
    if (!record || !(now instanceof Date) || Number.isNaN(now.getTime())) return {past: [], future: []};
    const duration = Math.max(1, Number(durationMinutes) || DEFAULT_MAP_SETTINGS.orbitProjectionDuration);
    // Cap the sample count so a long configured projection remains responsive in the dialog.
    const stepMinutes = Math.max(1, Math.ceil(duration / 360));
    const past = [];
    const future = [];
    for (let offset = duration; offset >= 0; offset -= stepMinutes) {
        const position = propagateSatelliteRecord(record, new Date(now.getTime() - offset * 60_000));
        if (position) past.push(position);
    }
    for (let offset = 0; offset <= duration; offset += stepMinutes) {
        const position = propagateSatelliteRecord(record, new Date(now.getTime() + offset * 60_000));
        if (position) future.push(position);
    }
    return {past, future};
};

const useSatelliteMapData = (satelliteData, liveOrbit, orbitProjectionDuration) => {
    const orbitRecord = useMemo(() => createSatelliteRecord(satelliteData), [
        satelliteData?.norad_id,
        satelliteData?.orbit_central_body,
        satelliteData?.orbit_model_kind,
        satelliteData?.orbit_format,
        satelliteData?.orbit_payload,
        satelliteData?.tle1,
        satelliteData?.tle2,
    ]);
    const position = liveOrbit?.position || null;
    const pathEpoch = liveOrbit?.generatedAt ? Math.floor(new Date(liveOrbit.generatedAt).getTime() / 60_000) : null;
    const paths = useMemo(() => {
        if (!orbitRecord.record || pathEpoch === null) return {past: [], future: []};
        return buildOrbitPaths(orbitRecord.record, new Date(pathEpoch * 60_000), orbitProjectionDuration);
    }, [orbitProjectionDuration, orbitRecord.record, pathEpoch]);
    const dynamicPaths = useMemo(() => resolveDynamicOrbitPathSegments({
        pastPath: paths.past,
        futurePath: paths.future,
        satellitePosition: position,
    }), [paths, position]);
    const coverage = useMemo(() => {
        if (!position) return [];
        const lat = Number(position.lat);
        const lon = Number(position.lon);
        const altitudeKm = Number(position.alt) / 1000;
        if (![lat, lon, altitudeKm].every(Number.isFinite)) return [];
        return getSatelliteCoverageCircle(lat, lon, altitudeKm, 360);
    }, [position]);
    const sky = useMemo(() => {
        const terminatorLine = createTerminatorLine().reverse();
        const daySidePolygon = terminatorLine.length > 0 ? [...terminatorLine, terminatorLine[terminatorLine.length - 1]] : [];
        const [sunPosition, moonPosition] = getSunMoonCoords();
        return {terminatorLine, daySidePolygon, sunPosition, moonPosition};
    }, [pathEpoch]);
    return {position, coverage, paths: dynamicPaths, sky};
};

const SatelliteTooltip = ({satelliteData, position}) => (
    <>{satelliteData?.name || satelliteData?.norad_id} - {humanizeAltitude(position.alt, 0, 'km', true)}, {humanizeVelocity(position.vel, 2, 'km/s', true)}</>
);

const SatelliteLeafletMap = ({satelliteData, data, settings, location}) => {
    const { t } = useTranslation('satellites');
    const [map, setMap] = useState(null);
    const {containerRef, revision: viewportRevision} = useDialogMapResize(map);
    const selectedTileLayer = useMemo(() => getTileLayerById(settings.tileLayerID, {mapEngine: 'leaflet', t}), [settings.tileLayerID, t]);
    const mapCrs = useMemo(() => getMapCrsByTileLayerId(settings.tileLayerID, {mapEngine: 'leaflet', t}), [settings.tileLayerID, t]);
    const position = data.position;
    const positionLatLon = position ? [Number(position.lat), Number(position.lon)] : null;
    const attribution = `<a href="https://leafletjs.com" target="_blank" rel="noopener noreferrer">Leaflet</a> | ${selectedTileLayer.attribution}`;

    useLayoutEffect(() => {
        if (!map || !positionLatLon?.every(Number.isFinite)) return;
        const coveragePoints = data.coverage.map(toLatLon).filter(Boolean);
        if (settings.showSatelliteCoverage && coveragePoints.length > 1) {
            const coverageBounds = L.latLngBounds(coveragePoints);
            if (coverageBounds.isValid()) {
                map.fitBounds(coverageBounds, {
                    padding: getDialogLeafletCoveragePadding(map),
                    animate: false,
                });
                return;
            }
        }
        map.setView(positionLatLon, map.getZoom(), {animate: false});
    }, [data.coverage, map, positionLatLon, settings.showSatelliteCoverage, viewportRevision]);

    return (
        <Box sx={{width: '100%', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0}}>
        <Box ref={containerRef} sx={{width: '100%', flex: 1, minHeight: 0, position: 'relative'}}>
        <MapContainer
            key={`${selectedTileLayer.id}:${selectedTileLayer.projection || 'EPSG3857'}`}
            center={positionLatLon?.every(Number.isFinite) ? positionLatLon : [0, 0]}
            zoom={settings.showSatelliteCoverage ? 0 : settings.mapZoomLevel}
            minZoom={LEAFLET_MIN_ZOOM}
            maxZoom={MAP_MAX_ZOOM}
            zoomSnap={0.25}
            zoomDelta={0.25}
            crs={mapCrs}
            whenReady={(event) => setMap(event.target)}
            dragging={settings.enableMapDragging}
            scrollWheelZoom={settings.enableMapZooming}
            doubleClickZoom={settings.enableMapZooming}
            touchZoom={settings.enableMapZooming}
            keyboard={false}
            zoomControl={false}
            attributionControl={false}
            style={{width: '100%', height: '100%'}}
        >
            {selectedTileLayer.type === 'wms'
                ? <WMSTileLayer url={selectedTileLayer.url} {...selectedTileLayer.wmsOptions} />
                : <TileLayer url={selectedTileLayer.url} />}
            {settings.showSunIcon && <LeafletMarker position={data.sky.sunPosition} icon={sunIcon} opacity={0.5} />}
            {settings.showMoonIcon && <LeafletMarker position={data.sky.moonPosition} icon={moonIcon} opacity={0.5} />}
            {settings.showTerminatorLine && <>
                <Polygon positions={data.sky.daySidePolygon} pathOptions={{fillColor: 'black', fillOpacity: 0.4, color: 'white', opacity: 0.5, weight: 0}} />
                <Polyline positions={data.sky.terminatorLine} pathOptions={{color: 'white', weight: 1, opacity: 0.1}} />
            </>}
            {InternationalDateLinePolyline()}
            {location && Number.isFinite(Number(location.lat)) && Number.isFinite(Number(location.lon)) && (
                <LeafletMarker position={[Number(location.lat), Number(location.lon)]} icon={homeIcon} opacity={0.8} />
            )}
            {settings.showPastOrbitPath && data.paths.past.map((segment, index) => (
                <Polyline key={`past-${index}`} positions={segment.map(toLatLon).filter(Boolean)} pathOptions={{color: settings.pastOrbitLineColor, weight: 2, opacity: 1}} />
            ))}
            {settings.showFutureOrbitPath && data.paths.future.map((segment, index) => (
                <Polyline key={`future-${index}`} positions={segment.map(toLatLon).filter(Boolean)} pathOptions={{color: settings.futureOrbitLineColor, weight: 2, opacity: 0.8, dashArray: '3 3'}} />
            ))}
            {settings.showSatelliteCoverage && data.coverage.length > 1 && (
                <Polyline positions={data.coverage.map(toLatLon).filter(Boolean)} noClip pathOptions={{color: settings.satelliteCoverageColor, fillColor: settings.satelliteCoverageColor, weight: 1, fill: true, fillOpacity: 0.2}} />
            )}
            {positionLatLon?.every(Number.isFinite) && (
                <LeafletMarker position={positionLatLon} icon={satelliteIcon2}>
                    {settings.showTooltip && <ThemedLeafletTooltip direction="bottom" offset={[0, 10]} opacity={1} permanent><SatelliteTooltip satelliteData={satelliteData} position={position} /></ThemedLeafletTooltip>}
                </LeafletMarker>
            )}
            {settings.showGrid && <CoordinateGrid latInterval={15} lngInterval={15} latColor="#FFFFFF" lngColor="#FFFFFF" weight={1} opacity={0.5} showLabels={false} />}
        </MapContainer>
        </Box>
        <MapStatusBar sx={{height: 28, px: 1, py: 0, position: 'static', bottom: 'auto', display: 'flex', alignItems: 'center', boxSizing: 'border-box', flexShrink: 0}}>
            <SimpleTruncatedHtml className="attribution" htmlString={attribution} />
        </MapStatusBar>
        </Box>
    );
};

const SatelliteMapLibreMap = ({satelliteData, data, settings, location}) => {
    const { t } = useTranslation('satellites');
    const theme = useTheme();
    const [map, setMap] = useState(null);
    const [cameraRevision, setCameraRevision] = useState(0);
    const {containerRef, revision: viewportRevision} = useDialogMapResize(map);
    const selectedTileLayer = useMemo(() => getTileLayerById(settings.tileLayerID, {mapEngine: MAP_ENGINE_MAPLIBRE, t}), [settings.tileLayerID, t]);
    const tileURL = useMemo(() => getMapLibreTileURL(settings.tileLayerID, {mapEngine: MAP_ENGINE_MAPLIBRE, t}), [settings.tileLayerID, t]);
    const mapStyle = useMemo(() => ({version: 8, sources: {basemap: {type: 'raster', tiles: [tileURL], tileSize: 256}}, layers: [{id: 'basemap', type: 'raster', source: 'basemap'}]}), [tileURL]);
    const position = data.position;
    const lat = Number(position?.lat);
    const lon = Number(position?.lon);
    const hasPosition = Number.isFinite(lat) && Number.isFinite(lon);
    const coverageCoordinates = useMemo(() => data.coverage.map(toLngLat).filter(Boolean), [data.coverage]);
    const coverageGeoJSON = useMemo(() => ({
        type: 'FeatureCollection',
        features: coverageCoordinates.length > 2 ? [{type: 'Feature', properties: {}, geometry: {type: 'Polygon', coordinates: [[...coverageCoordinates, coverageCoordinates[0]]]}}] : [],
    }), [coverageCoordinates]);
    const pastPathGeoJSON = useMemo(() => buildLineGeoJSON(data.paths.past), [data.paths.past]);
    const futurePathGeoJSON = useMemo(() => buildLineGeoJSON(data.paths.future), [data.paths.future]);
    const projectedTerminator = useMemo(() => projectTerminatorForMapLibre(data.sky.terminatorLine), [data.sky.terminatorLine]);
    const terminatorGeoJSON = useMemo(() => buildLineGeoJSON([projectedTerminator.line]), [projectedTerminator.line]);
    const daySideGeoJSON = useMemo(() => ({
        type: 'FeatureCollection',
        features: projectedTerminator.polygon.length > 2 ? [{type: 'Feature', properties: {}, geometry: {type: 'Polygon', coordinates: [projectedTerminator.polygon.map(toLngLat).filter(Boolean)]}}] : [],
    }), [projectedTerminator.polygon]);

    useEffect(() => {
        if (!map) return undefined;
        // react-map-gl applies the projection after loading the style. Re-run the
        // camera fit when that handoff completes, as the tracking map does.
        const handleProjectionChange = () => setCameraRevision((revision) => revision + 1);
        map.on('style.load', handleProjectionChange);
        map.on('projectiontransition', handleProjectionChange);
        handleProjectionChange();
        return () => {
            map.off('style.load', handleProjectionChange);
            map.off('projectiontransition', handleProjectionChange);
        };
    }, [map]);

    useLayoutEffect(() => {
        if (!map || !hasPosition || !map.isStyleLoaded?.()) return;
        if (map.getProjection?.()?.type !== 'mercator') return;
        if (coverageCoordinates.length > 1 && settings.showSatelliteCoverage && fitDialogMapLibreCoverage({
            map,
            coverage: data.coverage,
        })) {
            return;
        }
        map.flyTo({center: [lon, lat], zoom: map.getZoom(), animate: false});
    }, [cameraRevision, coverageCoordinates, data.coverage, hasPosition, lat, lon, map, settings.showSatelliteCoverage, viewportRevision]);

    const handleMapRef = useCallback((mapRef) => setMap(mapRef?.getMap?.() || null), []);
    const attribution = `<a href="https://maplibre.org/" target="_blank" rel="noopener noreferrer">MapLibre</a> | ${selectedTileLayer.attribution}`;
    return (
        <Box sx={{width: '100%', height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0}}>
        <Box ref={containerRef} sx={{
            width: '100%',
            flex: 1,
            minHeight: 0,
            position: 'relative',
            '& .satellite-dialog-popup .maplibregl-popup-content': {
                backgroundColor: theme.palette.background.paper,
                color: theme.palette.text.primary,
                border: `1px solid ${theme.palette.background.paper}`,
                boxShadow: theme.shadows[3],
                borderRadius: `${theme.shape.borderRadius}px`,
                whiteSpace: 'nowrap',
                padding: '4px 6px',
            },
            '& .satellite-dialog-popup.maplibregl-popup-anchor-top .maplibregl-popup-tip': {
                borderBottomColor: `${theme.palette.background.paper} !important`,
            },
            '& .satellite-dialog-popup.maplibregl-popup-anchor-bottom .maplibregl-popup-tip': {
                borderTopColor: `${theme.palette.background.paper} !important`,
            },
            '& .satellite-dialog-popup.maplibregl-popup-anchor-left .maplibregl-popup-tip': {
                borderRightColor: `${theme.palette.background.paper} !important`,
            },
            '& .satellite-dialog-popup.maplibregl-popup-anchor-right .maplibregl-popup-tip': {
                borderLeftColor: `${theme.palette.background.paper} !important`,
            },
        }}>
            <Map
                ref={handleMapRef}
                mapLib={maplibregl}
                mapStyle={mapStyle}
                attributionControl={false}
                projection={{type: 'mercator'}}
                initialViewState={{
                    longitude: hasPosition ? lon : 0,
                    latitude: hasPosition ? lat : 0,
                    // Start wide while the modal settles; the coverage fit then owns the final zoom.
                    zoom: settings.showSatelliteCoverage ? 0 : settings.mapZoomLevel,
                }}
                dragPan={settings.enableMapDragging}
                scrollZoom={settings.enableMapZooming}
                touchZoomRotate={settings.enableMapZooming}
                doubleClickZoom={settings.enableMapZooming}
                keyboard={false}
                renderWorldCopies
                minZoom={MAPLIBRE_MIN_ZOOM}
                maxZoom={MAP_MAX_ZOOM}
                style={{width: '100%', height: '100%'}}
            >
                {settings.showTerminatorLine && daySideGeoJSON.features.length > 0 && <Source id="satellite-dialog-day" type="geojson" data={daySideGeoJSON}><Layer id="satellite-dialog-day-fill" type="fill" paint={{'fill-color': '#000000', 'fill-opacity': 0.4}} /></Source>}
                {settings.showTerminatorLine && terminatorGeoJSON.features.length > 0 && <Source id="satellite-dialog-terminator" type="geojson" data={terminatorGeoJSON}><Layer id="satellite-dialog-terminator-line" type="line" paint={{'line-color': '#FFFFFF', 'line-width': 1, 'line-opacity': 0.1}} /></Source>}
                <Source id="satellite-dialog-date-line" type="geojson" data={DATE_LINE_GEOJSON}><Layer id="satellite-dialog-date-line-layer" type="line" paint={{'line-color': '#FFFFFF', 'line-width': 1, 'line-opacity': 0.9, 'line-dasharray': [1, 5]}} /></Source>
                {settings.showPastOrbitPath && pastPathGeoJSON.features.length > 0 && <Source id="satellite-dialog-past" type="geojson" data={pastPathGeoJSON}><Layer id="satellite-dialog-past-line" type="line" paint={{'line-color': settings.pastOrbitLineColor, 'line-width': 2, 'line-opacity': 1}} /></Source>}
                {settings.showFutureOrbitPath && futurePathGeoJSON.features.length > 0 && <Source id="satellite-dialog-future" type="geojson" data={futurePathGeoJSON}><Layer id="satellite-dialog-future-line" type="line" paint={{'line-color': settings.futureOrbitLineColor, 'line-width': 2, 'line-opacity': 0.8, 'line-dasharray': [0.1, 2.4]}} /></Source>}
                {settings.showSatelliteCoverage && coverageGeoJSON.features.length > 0 && <Source id="satellite-dialog-coverage" type="geojson" data={coverageGeoJSON}><Layer id="satellite-dialog-coverage-fill" type="fill" paint={{'fill-color': settings.satelliteCoverageColor, 'fill-opacity': 0.2}} /><Layer id="satellite-dialog-coverage-line" type="line" paint={{'line-color': settings.satelliteCoverageColor, 'line-width': 1, 'line-opacity': 1}} /></Source>}
                {settings.showGrid && <Source id="satellite-dialog-grid" type="geojson" data={GRID_GEOJSON}><Layer id="satellite-dialog-grid-line" type="line" paint={{'line-color': '#FFFFFF', 'line-width': 1, 'line-opacity': 0.5, 'line-dasharray': [1, 5]}} /></Source>}
                {location && Number.isFinite(Number(location.lat)) && Number.isFinite(Number(location.lon)) && <Marker longitude={Number(location.lon)} latitude={Number(location.lat)} anchor="center"><img src={homeIcon.options.iconUrl} alt={t('satellite_map.home', { defaultValue: 'Home' })} style={{width: 20, height: 20, opacity: 0.8}} /></Marker>}
                {settings.showSunIcon && <Marker longitude={data.sky.sunPosition[1]} latitude={data.sky.sunPosition[0]} anchor="center"><img src={sunIcon.options.iconUrl} alt={t('satellite_map.sun', { defaultValue: 'Sun' })} style={{width: 28, height: 28, opacity: 0.6}} /></Marker>}
                {settings.showMoonIcon && <Marker longitude={data.sky.moonPosition[1]} latitude={data.sky.moonPosition[0]} anchor="center"><img src={moonIcon.options.iconUrl} alt={t('satellite_map.moon', { defaultValue: 'Moon' })} style={{width: 28, height: 28, opacity: 0.6}} /></Marker>}
                {hasPosition && (
                    <Marker longitude={lon} latitude={lat} anchor="center">
                        <div
                            role="img"
                            aria-label={satelliteData?.name || 'Satellite'}
                            data-testid="satellite-dialog-marker"
                            style={{
                                width: 12,
                                height: 12,
                                background: '#38bdf8',
                                border: '1px solid #e0f2fe',
                                transform: 'rotate(45deg)',
                                boxShadow: '0 0 0 1px rgba(0,0,0,0.45)',
                                userSelect: 'none',
                                WebkitUserSelect: 'none',
                            }}
                        />
                    </Marker>
                )}
                {settings.showTooltip && hasPosition && <Popup className="satellite-dialog-popup" longitude={lon} latitude={lat} anchor="top" offset={12} closeButton={false} closeOnClick={false} maxWidth="none"><Box sx={{color: 'text.primary', fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap'}}><SatelliteTooltip satelliteData={satelliteData} position={position} /></Box></Popup>}
            </Map>
        </Box>
        <MapStatusBar sx={{height: 28, px: 1, py: 0, position: 'static', bottom: 'auto', display: 'flex', alignItems: 'center', boxSizing: 'border-box', flexShrink: 0}}>
            <SimpleTruncatedHtml className="attribution" htmlString={attribution} />
        </MapStatusBar>
        </Box>
    );
};

const SatelliteMapContainer = ({satelliteData, liveOrbit}) => {
    const settings = useSelector(selectMapSettings, shallowEqual);
    const location = useSelector((state) => state?.location?.location || null);
    const data = useSatelliteMapData(satelliteData, liveOrbit, settings.orbitProjectionDuration);
    const mapEngine = normalizeMapEngine(settings.mapEngine);
    if (!data.position) return null;

    if (mapEngine === MAP_ENGINE_MAPLIBRE || mapEngine === MAP_ENGINE_MAPLIBRE_GLOBE) {
        // The compact information map stays in 2D even when the tracking view uses a globe.
        return <SatelliteMapLibreMap satelliteData={satelliteData} data={data} settings={settings} location={location} />;
    }
    return <SatelliteLeafletMap satelliteData={satelliteData} data={data} settings={settings} location={location} />;
};

export default SatelliteMapContainer;
