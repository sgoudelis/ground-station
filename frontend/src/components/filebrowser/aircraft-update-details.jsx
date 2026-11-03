/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React from 'react';
import {Box, IconButton, Typography} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import {useTranslation} from 'react-i18next';
import {AIRCRAFT_FIELDS, aircraftLabel, aircraftValue} from '../../utils/aircraft-metadata.js';
import {formatDateTime} from '../../utils/date-time.js';
import MetadataField from './aircraft-metadata-field.jsx';

const gridSx = {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))',
    columnGap: 3, rowGap: 2, m: 0,
};
const hasValue = (value) => value !== null && value !== undefined && value !== '';

export default function AircraftUpdateDetails({record, timeSettings, id, onClose}) {
    const {t} = useTranslation('filebrowser');
    const {t: aircraftT} = useTranslation('common');
    const timezone = timeSettings.timezone || 'UTC';
    const received = record.captured_at ? formatDateTime(record.captured_at, timeSettings) || '—' : '—';
    const missing = t('adsb.not_recorded', 'Not recorded');
    const number = (value, digits = 0) => Number.isFinite(value)
        ? new Intl.NumberFormat(timeSettings.locale, {minimumFractionDigits: digits, maximumFractionDigits: digits}).format(value) : missing;
    const position = Number.isFinite(record.latitude) && Number.isFinite(record.longitude)
        ? `${record.latitude.toFixed(6)}, ${record.longitude.toFixed(6)}` : missing;
    const fields = [
        {label: t('adsb.callsign', 'Callsign'), value: record.callsign || missing, mono: true},
        {label: t('adsb.barometric_altitude', 'Barometric altitude (m)'),
            value: record.on_ground ? t('adsb.on_ground', 'On ground') : number(record.altitude_baro_m)},
        {label: t('adsb.ground_speed', 'Ground speed (m/s)'), value: number(record.groundspeed_mps, 1)},
        {label: t('adsb.squawk', 'Squawk'), value: record.squawk ?? missing, mono: true},
        {label: t('adsb.coordinates', 'Coordinates (lat, lon)'), value: position, mono: true},
        ...(Number.isFinite(record.track_deg) ? [{label: t('adsb.track', 'Track (°)'), value: number(record.track_deg, 1)}] : []),
        ...(Number.isFinite(record.vertical_rate_mps) ? [{label: t('adsb.vertical_rate', 'Vertical rate (m/s)'), value: number(record.vertical_rate_mps, 1)}] : []),
        ...(Number.isFinite(record.altitude_geom_m) ? [{label: t('adsb.geometric_altitude', 'Geometric altitude (m)'), value: number(record.altitude_geom_m)}] : []),
    ];
    // Historical metadata comes only from this record, including explicit gaps.
    const aircraft = record.aircraft;
    const hasClassification = ['military_status', 'category', 'aircraft_class', 'interesting'].some((key) => hasValue(aircraft?.[key]));
    const hasMetadata = Object.keys(AIRCRAFT_FIELDS).some((key) => key === 'classification' ? hasClassification : hasValue(aircraft?.[key]));
    const primaryKeys = ['registration', 'type_code', 'model', 'classification', 'operator_name', 'operator_country'];
    const metadataKeys = [...primaryKeys, ...Object.keys(AIRCRAFT_FIELDS).filter((key) => !primaryKeys.includes(key) && hasValue(aircraft?.[key]))];
    return <Box id={id} component="section" aria-labelledby={`${id}-heading`} sx={{minWidth: 0, px: {xs: 2, sm: 2.5}, py: 2}}>
        <Box sx={{display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 1.5, mb: 2}}>
            <Typography id={`${id}-heading`} component="h4" variant="subtitle2" fontWeight={600} sx={{overflowWrap: 'anywhere'}}>
                {t('adsb.update_received', 'Update received at {{date}} ({{timezone}})', {date: received, timezone})}
            </Typography>
            <IconButton size="small" onClick={onClose} aria-label={t('adsb.collapse_update', 'Collapse update details')} sx={{mt: -0.5}}>
                <CloseIcon fontSize="small" />
            </IconButton>
        </Box>
        <Box component="dl" sx={gridSx}>
            {fields.map((field) => <MetadataField key={field.label} {...field} />)}
        </Box>
        <Box sx={{mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider'}}>
            <Typography component="h5" variant="body2" fontWeight={600} sx={{mb: 1.5}}>
                {t('adsb.aircraft_at_reception', 'Aircraft details at reception')}
            </Typography>
            {hasMetadata ? <Box component="dl" sx={gridSx}>
                {metadataKeys.map((key) => <MetadataField key={key} label={aircraftLabel(key, aircraftT)}
                    value={(key === 'classification' ? hasClassification : hasValue(aircraft?.[key])) ? aircraftValue(aircraft, key, aircraftT) : missing}
                    mono={['registration', 'type_code', 'operator_code', 'operator_callsign', 'type_description'].includes(key)} />)}
            </Box> : <Typography variant="body2" color="text.secondary">
                {t('adsb.metadata_not_recorded', 'Aircraft metadata was not recorded for this update.')}
            </Typography>}
        </Box>
        <Box component="details" sx={{mt: 2, pt: 1.5, borderTop: '1px solid', borderColor: 'divider'}}>
            <Typography component="summary" variant="body2" sx={{cursor: 'pointer', fontWeight: 600, width: 'fit-content'}}>
                {t('adsb.raw_data', 'Raw data (JSON)')}
            </Typography>
            <Box component="pre" sx={{m: 0, mt: 1.5, p: 1.5, maxHeight: 300, overflow: 'auto', fontSize: 12, bgcolor: 'action.hover', borderRadius: 1}}>
                {JSON.stringify(record, null, 2)}
            </Box>
        </Box>
    </Box>;
}
