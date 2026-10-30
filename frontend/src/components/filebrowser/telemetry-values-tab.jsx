/**
 * @license
 * Copyright (c) 2026 Efstratios Goudelis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import React from 'react';
import {Alert, Box, Typography} from '@mui/material';
import {useTranslation} from 'react-i18next';
import {RawFields, Row, Values} from './telemetry-fields.jsx';
import TelemetryRecord, {TelemetryClock} from './telemetry-housekeeping.jsx';

export default function TelemetryValuesTab({telemetry, satellite, captureTime}) {
    const {t} = useTranslation('filebrowser');
    const payload = telemetry?.schema_version === 1 ? telemetry.payload : null;
    const diagnostics = telemetry?.diagnostics || [];
    const recordErrors = new Set((payload?.records || []).map((record) => record.error).filter(Boolean));
    const title = satellite || payload?.satellite;
    return <Box>
        {title && <Typography variant="h6" sx={{mb: 1}}>{title}</Typography>}
        {payload?.beacon_type && <Row label={t('telemetry_values_tab.beacon_type', {defaultValue: 'Beacon type'})}
            value={payload.beacon_type} />}
        {captureTime != null && payload && <TelemetryClock clock={{kind: 'received', value: captureTime}} />}
        {diagnostics.filter((item) => !recordErrors.has(item.message)).map((item, index) =>
            <Alert key={index} severity="warning" sx={{my: 2}}>{item.message}</Alert>)}
        {payload?.kind === 'text' && <Typography variant="body2" sx={{fontFamily: 'monospace'}}>{payload.text}</Typography>}
        {(payload?.records || []).map((record) => <TelemetryRecord key={record.id} record={record} />)}
        {(!payload || (payload.kind === 'raw' && !diagnostics.length)) && <Typography variant="body2" color="text.secondary">
            {t('telemetry_values_tab.no_decoded_telemetry_available_for_this_packet', {
                defaultValue: 'No decoded telemetry available for this packet.',
            })}
        </Typography>}
        {!payload && <>
            <Alert severity="info" sx={{mt: 2}}>{t('telemetry_values_tab.legacy_metadata', {
                defaultValue: 'Connect to the backend to prepare this saved telemetry. The original bytes remain available in Hex + ASCII.',
            })}</Alert>
            {/* Offline legacy values remain readable without guessing units or satellite layouts. */}
            <Values values={telemetry?.telemetry?.values || {}} fieldInfo={telemetry?.telemetry?.field_info} />
            <RawFields fields={telemetry?.telemetry?.raw_fields || telemetry?.telemetry?.rawFields} />
        </>}
    </Box>;
}
