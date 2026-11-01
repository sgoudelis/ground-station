/**
 * @license
 * Copyright (c) 2026 Efstratios Goudelis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import React from 'react';
import {Alert, Box, Stack, Typography} from '@mui/material';
import {useTranslation} from 'react-i18next';
import {useSelector} from 'react-redux';
import {useUserTimeSettings} from '../../hooks/useUserTimeSettings.jsx';
import {Row} from './telemetry-fields.jsx';
import TelemetryPositionMap from './telemetry-position-map.jsx';
import TelemetryValuesTab from './telemetry-values-tab.jsx';
import {getReceiverDistances, isValidMapPosition} from './position-utils.js';

export default function RadiosondeTab({metadata}) {
    const {t} = useTranslation('filebrowser');
    const receiver = useSelector((state) => state.location?.location);
    const {locale} = useUserTimeSettings();
    const telemetry = metadata.telemetry;
    const record = telemetry.payload?.records?.[0];
    // Use normalized readings, which omit encrypted navigation placeholders.
    const values = Object.assign({}, ...(record?.groups || []).map((group) => group.values));
    const hasPosition = !values.encrypted && isValidMapPosition(values.lat, values.lon);
    const distances = hasPosition ? getReceiverDistances({
        latitude: values.lat, longitude: values.lon, altitude: values.alt,
    }, receiver) : null;
    const formatDistance = (value) => `${new Intl.NumberFormat(locale, {
        minimumFractionDigits: 1, maximumFractionDigits: 1,
    }).format(value)} km`;
    const distanceTitle = t('telemetry_radiosonde_tab.receiver_distance', {defaultValue: 'Distance to receiver'});

    return <Stack spacing={3}>
        {hasPosition ? (
            <TelemetryPositionMap
                position={{latitude: values.lat, longitude: values.lon}}
                source={values.id}
                label="Radiosonde"
                title={t('telemetry_radiosonde_tab.position', {defaultValue: 'Radiosonde Position'})}
            />
        ) : (
            <Alert severity="info">
                {t('telemetry_radiosonde_tab.no_position', {defaultValue: 'No position is available in this packet.'})}
            </Alert>
        )}
        {distances && <Box component="section" aria-label={distanceTitle}
            sx={{border: 1, borderColor: 'divider', borderRadius: 1, p: 2}}>
            <Typography variant="subtitle2" sx={{fontWeight: 700}}>{distanceTitle}</Typography>
            <Row label={t('telemetry_radiosonde_tab.ground_distance', {defaultValue: 'Ground distance'})}
                value={formatDistance(distances.groundKm)} />
            {distances.slantKm !== null && <Row
                label={t('telemetry_radiosonde_tab.slant_distance', {defaultValue: 'Approx. straight-line distance'})}
                value={formatDistance(distances.slantKm)} />}
            <Typography variant="caption" color="text.secondary">
                {t('telemetry_radiosonde_tab.distance_reference', {
                    defaultValue: 'Calculated from the packet position and your current receiver location.',
                })}
            </Typography>
        </Box>}
        <TelemetryValuesTab telemetry={telemetry}
            captureTime={metadata.packet?.timestamp ?? metadata.timestamp} />
    </Stack>;
}
