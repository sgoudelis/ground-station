/**
 * @license
 * Copyright (c) 2026 Efstratios Goudelis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import React from 'react';
import {Alert, Stack} from '@mui/material';
import {useTranslation} from 'react-i18next';
import TelemetryPositionMap from './telemetry-position-map.jsx';
import TelemetryValuesTab from './telemetry-values-tab.jsx';
import {isValidMapPosition} from './position-utils.js';

export default function RadiosondeTab({metadata}) {
    const {t} = useTranslation('filebrowser');
    const telemetry = metadata.telemetry;
    const record = telemetry.payload?.records?.[0];
    // Use normalized readings, which omit encrypted navigation placeholders.
    const values = Object.assign({}, ...(record?.groups || []).map((group) => group.values));
    const hasPosition = !values.encrypted && isValidMapPosition(values.lat, values.lon);

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
        <TelemetryValuesTab telemetry={telemetry}
            captureTime={metadata.packet?.timestamp ?? metadata.timestamp} />
    </Stack>;
}
