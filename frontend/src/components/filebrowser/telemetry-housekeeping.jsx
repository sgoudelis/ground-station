/**
 * @license
 * Copyright (c) 2026 Efstratios Goudelis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import React from 'react';
import {Alert, Box, Divider, Typography} from '@mui/material';
import {useTranslation} from 'react-i18next';
import {useUserTimeSettings} from '../../hooks/useUserTimeSettings.jsx';
import {formatDateTime} from '../../utils/date-time.js';
import {RawFields, Row, Values} from './telemetry-fields.jsx';

function telemetryDate(value) {
    if (value == null || value === '' || !['number', 'string'].includes(typeof value)) return null;
    let input = value;
    if (typeof input === 'number') {
        input *= 1000;
    } else if (/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?$/.test(input)) {
        // Historical clock strings without an offset still represent UTC.
        input = input.replace(' ', 'T') + 'Z';
    }
    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? null : date;
}

export function TelemetryClock({clock}) {
    const {t} = useTranslation('filebrowser');
    const {timezone, locale} = useUserTimeSettings();
    const date = telemetryDate(clock.value);
    const value = date ? formatDateTime(date, {timezone, locale, options: {
        year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
        second: '2-digit', hourCycle: 'h23',
    }}) : t('telemetry_values_tab.unavailable', {defaultValue: 'Unavailable'});
    const labels = {
        power_system: ['power_system_time', 'Power system time ({{timezone}})'],
        spacecraft: ['spacecraft_time', 'Spacecraft time ({{timezone}})'],
        received: ['received_time', 'Received ({{timezone}})'],
    };
    const [key, fallback] = labels[clock.kind] || labels.spacecraft;
    // The backend supplies subsystem clock labels; timezone formatting is a UI preference.
    const label = clock.label ? `${clock.label.replace(/ \(UTC\)$/, '')} (${timezone})`
        : t(`telemetry_values_tab.${key}`, {defaultValue: fallback, timezone});
    return <Row label={label} value={value} />;
}

export default function TelemetryRecord({record}) {
    const {t} = useTranslation('filebrowser');
    const {locale} = useUserTimeSettings();
    const groups = record.groups || [];
    const hasRawReadings = groups.some((group) => Object.values(group.field_info || {})
        .some((info) => info.calibrated === false));
    return (
        <Box sx={{mb: 3}}>
            {record.title && <Typography variant="subtitle2" sx={{fontWeight: 700}}>{record.title}</Typography>}
            {record.message_id && <Typography variant="caption" color="text.secondary">
                {t('telemetry_values_tab.message_header', {
                    defaultValue: 'Message {{id}} · Device {{source}} → {{destination}} · {{length}} bytes',
                    id: record.message_id, source: record.source, destination: record.destination, length: record.length,
                })}
            </Typography>}
            {record.warning && <Alert severity="info" sx={{my: 2}}>{record.warning}</Alert>}
            {record.error && <Alert severity="warning" sx={{my: 2}}>{record.error}</Alert>}
            {hasRawReadings && <Alert severity="info" sx={{my: 2}}>
                {t('telemetry_values_tab.raw_readings_hint', {
                    defaultValue: 'Readings marked “raw” have no verified conversion to physical units.',
                })}
            </Alert>}
            {record.status === 'non_telemetry' && !record.warning && <Typography variant="body2" color="text.secondary">
                {t('telemetry_values_tab.non_telemetry_message', {defaultValue: 'This message carries no satellite telemetry. Its bytes are available in Hex + ASCII.'})}
            </Typography>}
            {record.status === 'unsupported' && <Typography variant="body2" color="text.secondary">
                {t('telemetry_values_tab.unsupported_message', {defaultValue: 'This message type is not decoded yet. Its bytes are available in Hex + ASCII.'})}
            </Typography>}
            {record.beacon_id != null && <Row label={t('telemetry_values_tab.beacon_id', {defaultValue: 'Beacon ID'})}
                value={record.beacon_id} />}
            {(record.clocks || []).map((clock, index) => <TelemetryClock key={index} clock={clock} />)}
            <Box sx={{display: 'grid', gridTemplateColumns: {xs: '1fr', md: 'repeat(2, minmax(0, 1fr))'}, gap: 2, mt: 2}}>
                {groups.map((group) => {
                    const title = t(`telemetry_values_tab.groups.${group.id}`, {defaultValue: group.title});
                    return <Box component="section" aria-label={title} key={group.id}
                        sx={{border: 1, borderColor: 'divider', borderRadius: 1, p: 2, minWidth: 0}}>
                        <Typography variant="subtitle2" sx={{fontWeight: 700}}>{title}</Typography>
                        <Divider sx={{my: 1}} />
                        <Values values={group.values} fieldInfo={group.field_info} locale={locale} scaleCurrents />
                    </Box>;
                })}
            </Box>
            <RawFields fields={record.raw_fields}
                label={t('telemetry_values_tab.raw_reserved_fields', {defaultValue: 'Raw fields and reserved bytes'})} />
        </Box>
    );
}
