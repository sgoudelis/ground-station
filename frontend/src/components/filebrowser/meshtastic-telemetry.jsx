/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React from 'react';
import {Box, Paper, Typography} from '@mui/material';
import SensorsOutlinedIcon from '@mui/icons-material/SensorsOutlined';
import {useTranslation} from 'react-i18next';
import {formatDateTime} from '../../utils/date-time.js';
import {normalizeTelemetryValue} from './telemetry-fields.jsx';
import MetadataField from './file-dialog-metadata-field.jsx';
import {fileDialogSectionSx} from './file-dialog-styles.js';

const packetFields = new Set(['source', 'destination', 'packet_id', 'channel_hash', 'hop_limit', 'hop_start',
    'want_ack', 'via_mqtt', 'next_hop', 'relay_node', 'encryption', 'application', 'want_response', 'telemetry_type', 'reported_time']);

export default function MeshtasticTelemetry({telemetry, settings}) {
    const {t} = useTranslation('filebrowser');
    const info = telemetry.field_info || {};
    const groups = new Map();
    const titles = {
        device_metrics: t('meshtastic_folder.device_metrics', 'Device metrics'),
        environment_metrics: t('meshtastic_folder.environment_metrics', 'Environment'),
        air_quality_metrics: t('meshtastic_folder.air_quality_metrics', 'Air quality'),
        power_metrics: t('meshtastic_folder.power_metrics', 'Power'),
        measurements: t('meshtastic_folder.measurements', 'Measurements'),
        context: t('meshtastic_folder.packet_context', 'Packet context'),
    };
    Object.entries(telemetry.values || {}).forEach(([key, entry]) => {
        // Keep radio headers separate from measurements, including older captures without groups.
        const group = packetFields.has(key) || ['mesh', 'device'].includes(info[key]?.group) ? 'context'
            : Object.hasOwn(titles, info[key]?.group) ? info[key].group : 'measurements';
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group).push([key, entry]);
    });
    const formatReading = (key, entry) => {
        const fieldInfo = info[key] || {};
        const {value, unit, error} = normalizeTelemetryValue(entry, fieldInfo);
        let display = value == null ? t('telemetry_values_tab.unavailable', 'Unavailable')
            : typeof value === 'boolean' ? t(value ? 'telemetry_values_tab.yes' : 'telemetry_values_tab.no', value ? 'Yes' : 'No')
                : typeof value === 'number' ? new Intl.NumberFormat(settings.locale, {maximumFractionDigits: 6}).format(value)
                    : typeof value === 'object' ? JSON.stringify(value) : String(value);
        // Calibration metadata remains authoritative, even for legacy wrapped readings.
        if (value != null) display += fieldInfo.calibrated === false ? ` (${t('telemetry_values_tab.raw_reading', 'raw')})` : unit ? ` ${unit}` : '';
        return {value: display, title: error || undefined};
    };
    // Measurements lead; packet context is always visible beneath them.
    const ordered = [...groups].sort(([a], [b]) => Number(a === 'context') - Number(b === 'context'));
    return <Paper component="section" aria-label={t('meshtastic_folder.telemetry', 'Latest telemetry packet')} variant="outlined" sx={fileDialogSectionSx}>
        <Box sx={{px: {xs: 2, sm: 2.5}, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            columnGap: 2, rowGap: 0.5, flexWrap: 'wrap', borderBottom: '1px solid', borderColor: 'divider'}}>
            <Box sx={{display: 'flex', alignItems: 'center', gap: 1}}>
                <SensorsOutlinedIcon sx={{fontSize: 20, color: 'text.secondary'}} />
                <Typography component="h3" variant="subtitle2" fontWeight={600}>{t('meshtastic_folder.telemetry', 'Latest telemetry packet')}</Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">
                {t('meshtastic_folder.received_date', 'Received {{date}} ({{timezone}})', {
                    date: telemetry.captured_at ? formatDateTime(telemetry.captured_at, settings) || '—' : '—', timezone: settings.timezone || 'UTC',
                })}
            </Typography>
        </Box>
        {ordered.map(([group, entries], index) => <Box key={group} sx={{px: {xs: 2, sm: 2.5}, py: 2,
            ...(index > 0 && {borderTop: '1px solid', borderColor: 'divider'})}}>
            <Typography component="h4" variant="body2" fontWeight={600} sx={{mb: 1.75, color: group === 'context' ? 'text.secondary' : 'text.primary'}}>
                {titles[group]}
            </Typography>
            <Box component="dl" sx={{m: 0, display: 'grid', gridTemplateColumns: {xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))'},
                columnGap: 3, rowGap: 2}}>
                {entries.map(([key, entry]) => <MetadataField key={key} label={info[key]?.label || key}
                    {...formatReading(key, entry)} mono={['source', 'destination', 'packet_id', 'channel_hash', 'next_hop', 'relay_node'].includes(key)} />)}
            </Box>
        </Box>)}
        {!ordered.length && <Typography variant="body2" color="text.secondary" sx={{p: 2.5}}>
            {t('meshtastic_folder.no_measurements', 'No telemetry values were recorded in this packet.')}
        </Typography>}
    </Paper>;
}
