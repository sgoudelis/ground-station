/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import React from 'react';
import {
    Alert,
    Box,
    Chip,
    Divider,
    Stack,
    Typography,
} from '@mui/material';
import TelemetryPositionMap from './telemetry-position-map.jsx';
import {isValidMapPosition} from './position-utils.js';
import {getAprsData, getAprsDataTypeLabel} from './aprs-utils.js';
import { useTranslation } from 'react-i18next';

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

export default function APRSTab({metadata}) {
    const { t } = useTranslation('filebrowser');
    const aprs = getAprsData(metadata);
    const frame = metadata?.telemetry?.frame || {};
    const ax25 = metadata?.ax25 || {};
    const position = aprs?.position;
    const source = frame.source || ax25.from_callsign;
    const destination = frame.destination || ax25.to_callsign;
    const repeaters = frame.repeaters || [];
    const latitude = position?.latitude;
    const longitude = position?.longitude;
    const hasPosition = isValidMapPosition(latitude, longitude);
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
                <TelemetryPositionMap
                    position={position}
                    source={source}
                    label="APRS"
                    title={t('telemetry_aprs_tab.aprs_position', {defaultValue: 'APRS Position'})}
                />
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
