/**
 * @license
 * Copyright (c) 2026 Efstratios Goudelis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import React, {useEffect, useState} from 'react';
import {Box, Button, FormControlLabel, MenuItem, Select, Stack, Switch, Typography} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PlaceIcon from '@mui/icons-material/Place';
import {CircleMarker, MapContainer, Marker, Polyline, TileLayer, Tooltip as LeafletTooltip, useMap} from 'react-leaflet';
import {useSelector} from 'react-redux';
import {useTranslation} from 'react-i18next';
import 'leaflet/dist/leaflet.css';
import {getTileLayerById} from '../common/tile-layers.jsx';
import {homeIcon} from '../common/dataurl-icons.jsx';
import {MapStatusBar, MapTitleBar, SimpleTruncatedHtml} from '../common/common.jsx';
import {isValidMapPosition, toLocationNumber} from './position-utils.js';

const MAP_LAYERS = [
    {id: 'satellite', label: 'Satellite'},
    {id: 'osm', label: 'Street'},
    {id: 'topo', label: 'Topographic'},
    {id: 'cartodark', label: 'Dark'},
];

function FitPositionMap({latitude, longitude, receiverLatitude, receiverLongitude, showReceiver}) {
    const map = useMap();
    useEffect(() => {
        // Wait for the tab layout before fitting both markers with room for labels.
        const timer = window.setTimeout(() => {
            map.invalidateSize();
            const bounds = [[latitude, longitude]];
            if (showReceiver && isValidMapPosition(receiverLatitude, receiverLongitude)) {
                bounds.push([receiverLatitude, receiverLongitude]);
            }
            map.fitBounds(bounds, {padding: [48, 48], maxZoom: 13, animate: false});
        }, 0);
        return () => window.clearTimeout(timer);
    }, [map, latitude, longitude, receiverLatitude, receiverLongitude, showReceiver]);
    return null;
}

function PositionMap({position, source, label, title}) {
    const receiver = useSelector((state) => state.location?.location);
    const preferredLayer = useSelector((state) => state.earthViewTrack?.tileLayerID);
    const { t } = useTranslation('filebrowser');
    const latitude = position?.latitude;
    const longitude = position?.longitude;
    const preferredLayerIsAvailable = MAP_LAYERS.some(({id}) => id === preferredLayer);
    const [tileLayerId, setTileLayerId] = useState(
        preferredLayerIsAvailable ? preferredLayer : 'satellite',
    );
    const [enableMapZooming, setEnableMapZooming] = useState(false);
    const [showReceiver, setShowReceiver] = useState(true);
    const [showRadioPath, setShowRadioPath] = useState(true);
    const tileLayer = getTileLayerById(tileLayerId, { t });
    const receiverLatitude = toLocationNumber(receiver?.lat);
    const receiverLongitude = toLocationNumber(receiver?.lon);
    const hasReceiver = isValidMapPosition(receiverLatitude, receiverLongitude);

    useEffect(() => {
        if (MAP_LAYERS.some(({id}) => id === preferredLayer)) {
            setTileLayerId(preferredLayer);
        }
    }, [preferredLayer]);

    if (!isValidMapPosition(latitude, longitude)) return null;

    return (
        <Box sx={{borderRadius: 1, overflow: 'hidden', border: 1, borderColor: 'divider'}}>
            <MapTitleBar sx={{height: 'auto', minHeight: 38, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap'}}>
                <Typography variant="body2" sx={{fontWeight: 700, flexGrow: 1}}>
                    {title}
                </Typography>
                {hasReceiver && (
                    <>
                        <FormControlLabel
                            sx={{m: 0}}
                            label={<Typography variant="caption">{t('telemetry_position_map.receiver', { defaultValue: 'Receiver' })}</Typography>}
                            control={(
                                <Switch
                                    size="small"
                                    checked={showReceiver}
                                    onChange={(event) => setShowReceiver(event.target.checked)}
                                />
                            )}
                        />
                        <FormControlLabel
                            sx={{m: 0}}
                            label={<Typography variant="caption">{t('telemetry_position_map.path', { defaultValue: 'Path' })}</Typography>}
                            control={(
                                <Switch
                                    size="small"
                                    checked={showRadioPath}
                                    onChange={(event) => setShowRadioPath(event.target.checked)}
                                />
                            )}
                        />
                    </>
                )}
                <FormControlLabel
                    sx={{m: 0}}
                    label={<Typography variant="caption">{t('telemetry_position_map.zoom_gestures', { defaultValue: 'Zoom gestures' })}</Typography>}
                    control={(
                        <Switch
                            size="small"
                            checked={enableMapZooming}
                            onChange={(event) => setEnableMapZooming(event.target.checked)}
                            slotProps={{input: {role: 'switch', 'aria-label': t('telemetry_position_map.enable_zoom', {defaultValue: 'Enable {{label}} map zoom gestures', label})}}}
                        />
                    )}
                />
                <Select
                    size="small"
                    value={tileLayerId}
                    onChange={(event) => setTileLayerId(event.target.value)}
                    inputProps={{'aria-label': t('telemetry_position_map.map_layer', {defaultValue: '{{label}} map layer', label})}}
                    sx={{minWidth: 126, height: 28, fontSize: '0.75rem'}}
                >
                    {MAP_LAYERS.map((layer) => (
                        <MenuItem key={layer.id} value={layer.id}>{layer.label}</MenuItem>
                    ))}
                </Select>
            </MapTitleBar>
            <Box sx={{height: 360, position: 'relative'}}>
                <MapContainer
                    key={`${label}-${latitude}-${longitude}-${tileLayer.id}-${enableMapZooming}`}
                    className="telemetry-position-map target-map"
                    center={[latitude, longitude]}
                    zoom={13}
                    style={{width: '100%', height: '100%'}}
                    scrollWheelZoom={enableMapZooming}
                    doubleClickZoom={enableMapZooming}
                    touchZoom={enableMapZooming}
                    boxZoom={enableMapZooming}
                    keyboard={false}
                    attributionControl={false}
                    zoomSnap={1}
                    zoomDelta={1}
                >
                    <FitPositionMap
                        latitude={latitude}
                        longitude={longitude}
                        receiverLatitude={receiverLatitude}
                        receiverLongitude={receiverLongitude}
                        showReceiver={showReceiver}
                    />
                    <TileLayer url={tileLayer.url} />
                    {hasReceiver && showReceiver && (
                        <Marker position={[receiverLatitude, receiverLongitude]} icon={homeIcon} opacity={0.85}>
                            <LeafletTooltip direction="top">{t('telemetry_position_map.receiver', { defaultValue: 'Receiver' })}</LeafletTooltip>
                        </Marker>
                    )}
                    {hasReceiver && showReceiver && showRadioPath && (
                        <Polyline
                            positions={[[receiverLatitude, receiverLongitude], [latitude, longitude]]}
                            pathOptions={{color: '#29b6f6', weight: 2, opacity: 0.85, dashArray: '6 6'}}
                        />
                    )}
                    <CircleMarker
                        center={[latitude, longitude]}
                        radius={9}
                        pathOptions={{color: '#fff', fillColor: '#d32f2f', fillOpacity: 1, weight: 2}}
                    >
                        <LeafletTooltip permanent direction="top" offset={[0, -8]}>
                            {source || label}
                        </LeafletTooltip>
                    </CircleMarker>
                </MapContainer>
                <MapStatusBar sx={{display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'background.elevated'}}>
                    <Typography variant="caption" sx={{fontFamily: 'monospace', flexGrow: 1}}>
                        {latitude.toFixed(6)}, {longitude.toFixed(6)}
                    </Typography>
                    <SimpleTruncatedHtml className="attribution" htmlString={tileLayer.attribution} />
                </MapStatusBar>
            </Box>
        </Box>
    );
}

// Both packet views share map controls and the external map link.
export default function TelemetryPositionMap(props) {
    const {t} = useTranslation('filebrowser');
    const latitude = props.position?.latitude;
    const longitude = props.position?.longitude;
    if (!isValidMapPosition(latitude, longitude)) return null;
    return <Stack spacing={1}>
        <PositionMap {...props} />
        <Stack direction={{xs: 'column', sm: 'row'}} spacing={1} alignItems={{sm: 'center'}}>
            <Typography variant="body2" sx={{fontFamily: 'monospace', flexGrow: 1}}>
                {latitude.toFixed(6)}, {longitude.toFixed(6)}
            </Typography>
            <Button
                component="a"
                href={`https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=15/${latitude}/${longitude}`}
                target="_blank"
                rel="noopener noreferrer"
                size="small"
                startIcon={<PlaceIcon />}
                endIcon={<OpenInNewIcon />}
            >
                {t('telemetry_position_map.open_map', { defaultValue: 'Open map' })}
            </Button>
        </Stack>
    </Stack>;
}
