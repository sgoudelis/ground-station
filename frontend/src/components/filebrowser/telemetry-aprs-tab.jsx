/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import React, {useEffect, useState} from 'react';
import {
    Alert,
    Box,
    Button,
    Chip,
    Divider,
    FormControlLabel,
    MenuItem,
    Select,
    Stack,
    Switch,
    Typography,
} from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PlaceIcon from '@mui/icons-material/Place';
import {
    CircleMarker,
    MapContainer,
    Marker,
    Polyline,
    TileLayer,
    Tooltip as LeafletTooltip,
    useMap,
} from 'react-leaflet';
import {useSelector} from 'react-redux';
import 'leaflet/dist/leaflet.css';
import {getTileLayerById} from '../common/tile-layers.jsx';
import {homeIcon} from '../common/dataurl-icons.jsx';
import {MapStatusBar, MapTitleBar, SimpleTruncatedHtml} from '../common/common.jsx';
import {getAprsData, getAprsDataTypeLabel} from './aprs-utils.js';
import { useTranslation } from 'react-i18next';

const TEST_MAP_LAYERS = [
    {id: 'satellite', label: 'Satellite'},
    {id: 'osm', label: 'Street'},
    {id: 'topo', label: 'Topographic'},
    {id: 'cartodark', label: 'Dark'},
];

function InfoRow({label, value, mono = false}) {
    if (value === undefined || value === null || value === '') return null;
    return (
        <Box sx={{display: 'grid', gridTemplateColumns: 'minmax(130px, 0.8fr) 1.2fr', gap: 2, py: 0.75}}>
            <Typography variant="body2" color="text.secondary">{label}</Typography>
            <Typography variant="body2" sx={{fontFamily: mono ? 'monospace' : 'inherit', overflowWrap: 'anywhere'}}>
                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
            </Typography>
        </Box>
    );
}

function Section({title, children}) {
    return (
        <Box>
            <Typography variant="subtitle2" sx={{fontWeight: 700, textTransform: 'uppercase', mb: 1}}>
                {title}
            </Typography>
            <Divider sx={{mb: 1}} />
            {children}
        </Box>
    );
}

function ResizeMap() {
    const map = useMap();
    useEffect(() => {
        const timer = window.setTimeout(() => map.invalidateSize(), 0);
        return () => window.clearTimeout(timer);
    }, [map]);
    return null;
}

function PositionMap({position, source, receiver, preferredLayer}) {
    const { t } = useTranslation('filebrowser');
    const latitude = Number(position?.latitude);
    const longitude = Number(position?.longitude);
    const preferredLayerIsAvailable = TEST_MAP_LAYERS.some(({id}) => id === preferredLayer);
    const [tileLayerId, setTileLayerId] = useState(
        preferredLayerIsAvailable ? preferredLayer : 'satellite',
    );
    const [enableMapZooming, setEnableMapZooming] = useState(false);
    const [showReceiver, setShowReceiver] = useState(true);
    const [showRadioPath, setShowRadioPath] = useState(true);
    const tileLayer = getTileLayerById(tileLayerId, { t });
    const receiverLatitude = Number(receiver?.lat);
    const receiverLongitude = Number(receiver?.lon);
    const hasReceiver = Number.isFinite(receiverLatitude) && Number.isFinite(receiverLongitude);

    useEffect(() => {
        if (TEST_MAP_LAYERS.some(({id}) => id === preferredLayer)) {
            setTileLayerId(preferredLayer);
        }
    }, [preferredLayer]);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

    return (
        <Box sx={{borderRadius: 1, overflow: 'hidden', border: 1, borderColor: 'divider'}}>
            <MapTitleBar sx={{height: 'auto', minHeight: 38, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap'}}>
                <Typography variant="body2" sx={{fontWeight: 700, flexGrow: 1}}>
                    {t('telemetry_aprs_tab.aprs_position', { defaultValue: 'APRS Position' })}
                </Typography>
                {hasReceiver && (
                    <>
                        <FormControlLabel
                            sx={{m: 0}}
                            label={<Typography variant="caption">{t('telemetry_aprs_tab.receiver', { defaultValue: 'Receiver' })}</Typography>}
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
                            label={<Typography variant="caption">{t('telemetry_aprs_tab.path', { defaultValue: 'Path' })}</Typography>}
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
                    label={<Typography variant="caption">{t('telemetry_aprs_tab.zoom_gestures', { defaultValue: 'Zoom gestures' })}</Typography>}
                    control={(
                        <Switch
                            size="small"
                            checked={enableMapZooming}
                            onChange={(event) => setEnableMapZooming(event.target.checked)}
                            inputProps={{'aria-label': 'Enable APRS map zoom gestures'}}
                        />
                    )}
                />
                <Select
                    size="small"
                    value={tileLayerId}
                    onChange={(event) => setTileLayerId(event.target.value)}
                    aria-label={t('telemetry_aprs_tab.aprs_map_layer', { defaultValue: 'APRS map layer' })}
                    sx={{minWidth: 126, height: 28, fontSize: '0.75rem'}}
                >
                    {TEST_MAP_LAYERS.map((layer) => (
                        <MenuItem key={layer.id} value={layer.id}>{layer.label}</MenuItem>
                    ))}
                </Select>
            </MapTitleBar>
            <Box sx={{height: 360, position: 'relative'}}>
                <MapContainer
                    key={`aprs-map-${tileLayer.id}-${enableMapZooming}`}
                    className="aprs-telemetry-map target-map"
                    center={[latitude, longitude]}
                    zoom={13}
                    style={{width: '100%', height: '100%'}}
                    scrollWheelZoom={enableMapZooming}
                    doubleClickZoom={enableMapZooming}
                    touchZoom={enableMapZooming}
                    boxZoom={enableMapZooming}
                    keyboard={false}
                    attributionControl={false}
                    zoomSnap={0.25}
                    zoomDelta={0.25}
                >
                    <ResizeMap />
                    <TileLayer url={tileLayer.url} />
                    {hasReceiver && showReceiver && (
                        <Marker position={[receiverLatitude, receiverLongitude]} icon={homeIcon} opacity={0.85}>
                            <LeafletTooltip direction="top">{t('telemetry_aprs_tab.receiver', { defaultValue: 'Receiver' })}</LeafletTooltip>
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
                            {source || 'APRS station'}
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

export default function APRSTab({metadata}) {
    const { t } = useTranslation('filebrowser');
    const receiver = useSelector((state) => state.location?.location);
    const preferredLayer = useSelector((state) => state.earthViewTrack?.tileLayerID);
    const aprs = getAprsData(metadata);
    const frame = metadata?.telemetry?.frame || {};
    const ax25 = metadata?.ax25 || {};
    const position = aprs?.position;
    const source = frame.source || ax25.from_callsign;
    const destination = frame.destination || ax25.to_callsign;
    const repeaters = frame.repeaters || [];
    const latitude = Number(position?.latitude);
    const longitude = Number(position?.longitude);
    const hasPosition = Number.isFinite(latitude) && Number.isFinite(longitude);
    const telemetry = aprs?.telemetry;
    const weather = aprs?.weather;

    if (!aprs) {
        return <Alert severity="info">{t('telemetry_aprs_tab.no_aprs_information_field_is_available_in_this_file', { defaultValue: 'No APRS information field is available in this file.' })}</Alert>;
    }

    return (
        <Stack spacing={3}>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                <Chip label={getAprsDataTypeLabel(aprs)} color="primary" variant="outlined" />
                {aprs.position?.format && <Chip label={`${aprs.position.format} position`} variant="outlined" />}
                {telemetry?.encoding && <Chip label={`${telemetry.encoding} telemetry`} variant="outlined" />}
            </Stack>

            {hasPosition && (
                <>
                    <PositionMap
                        position={position}
                        source={source}
                        receiver={receiver}
                        preferredLayer={preferredLayer}
                    />
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
                            {t('telemetry_aprs_tab.open_map', { defaultValue: 'Open map' })}
                        </Button>
                    </Stack>
                </>
            )}

            <Box sx={{display: 'grid', gridTemplateColumns: {xs: '1fr', md: '1fr 1fr'}, gap: 3}}>
                <Section title={t('telemetry_aprs_tab.aprs_packet', { defaultValue: 'APRS Packet' })}>
                    <InfoRow label={t('telemetry_aprs_tab.type', { defaultValue: 'Type' })} value={getAprsDataTypeLabel(aprs)} />
                    <InfoRow label={t('telemetry_aprs_tab.identifier', { defaultValue: 'Identifier' })} value={aprs.data_type_identifier} mono />
                    <InfoRow label={t('telemetry_aprs_tab.source', { defaultValue: 'Source' })} value={source} mono />
                    <InfoRow label={t('telemetry_aprs_tab.destination', { defaultValue: 'Destination' })} value={destination} mono />
                    <InfoRow label={t('telemetry_aprs_tab.digipeater_path', { defaultValue: 'Digipeater path' })} value={repeaters.join(' → ')} mono />
                    <InfoRow label={t('telemetry_aprs_tab.comment', { defaultValue: 'Comment' })} value={aprs.comment} />
                    <InfoRow label={t('telemetry_aprs_tab.status', { defaultValue: 'Status' })} value={aprs.status} />
                    <InfoRow label={t('telemetry_aprs_tab.message', { defaultValue: 'Message' })} value={aprs.message?.text} />
                    <InfoRow label={t('telemetry_aprs_tab.addressee', { defaultValue: 'Addressee' })} value={aprs.message?.addressee} mono />
                </Section>

                <Section title={t('telemetry_aprs_tab.position_and_symbol', { defaultValue: 'Position and Symbol' })}>
                    <InfoRow label={t('telemetry_aprs_tab.latitude', { defaultValue: 'Latitude' })} value={hasPosition ? latitude.toFixed(6) : null} mono />
                    <InfoRow label={t('telemetry_aprs_tab.longitude', { defaultValue: 'Longitude' })} value={hasPosition ? longitude.toFixed(6) : null} mono />
                    <InfoRow label={t('telemetry_aprs_tab.position_format', { defaultValue: 'Position format' })} value={position?.format} />
                    <InfoRow label={t('telemetry_aprs_tab.symbol', { defaultValue: 'Symbol' })} value={position ? `${position.symbol_table}/${position.symbol_code}` : null} mono />
                    <InfoRow label={t('telemetry_aprs_tab.altitude', { defaultValue: 'Altitude' })} value={position?.altitude_meters !== undefined ? `${position.altitude_meters} m` : null} />
                    <InfoRow label={t('telemetry_aprs_tab.course', { defaultValue: 'Course' })} value={position?.course_degrees !== undefined ? `${position.course_degrees}°` : null} />
                    <InfoRow label={t('telemetry_aprs_tab.speed', { defaultValue: 'Speed' })} value={position?.speed_knots !== undefined ? `${position.speed_knots} kn` : null} />
                    <InfoRow label={t('telemetry_aprs_tab.phg', { defaultValue: 'PHG' })} value={aprs.phg} mono />
                </Section>
            </Box>

            {telemetry && (
                <Section title={t('telemetry_aprs_tab.aprs_telemetry', { defaultValue: 'APRS Telemetry' })}>
                    <InfoRow label={t('telemetry_aprs_tab.encoding', { defaultValue: 'Encoding' })} value={telemetry.encoding} />
                    <InfoRow label={t('telemetry_aprs_tab.sequence', { defaultValue: 'Sequence' })} value={telemetry.sequence} mono />
                    {(telemetry.channels || []).map((value, index) => (
                        <InfoRow key={`channel-${index + 1}`} label={`Channel ${index + 1} (raw)`} value={value} mono />
                    ))}
                    <InfoRow label={t('telemetry_aprs_tab.digital_bits', { defaultValue: 'Digital bits' })} value={telemetry.digital_bits} mono />
                </Section>
            )}

            {weather && Object.keys(weather).length > 0 && (
                <Section title={t('telemetry_aprs_tab.weather', { defaultValue: 'Weather' })}>
                    {Object.entries(weather).map(([key, value]) => (
                        <InfoRow key={key} label={key.replaceAll('_', ' ')} value={value} mono />
                    ))}
                </Section>
            )}

            <Section title={t('telemetry_aprs_tab.raw_information_field', { defaultValue: 'Raw Information Field' })}>
                <Typography variant="body2" sx={{fontFamily: 'monospace', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>
                    {aprs.raw}
                </Typography>
            </Section>
        </Stack>
    );
}
