/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useId} from 'react';
import {Box, Chip, DialogTitle, IconButton, Paper, Typography} from '@mui/material';
import {alpha} from '@mui/material/styles';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import BusinessOutlinedIcon from '@mui/icons-material/BusinessOutlined';
import CategoryOutlinedIcon from '@mui/icons-material/CategoryOutlined';
import CloseIcon from '@mui/icons-material/Close';
import FlightIcon from '@mui/icons-material/Flight';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import {useTranslation} from 'react-i18next';
import MetadataField from './file-dialog-metadata-field.jsx';
import AircraftFlag from '../common/aircraft-flag.jsx';
import {aircraftCountry} from '../../utils/aircraft-country.js';
import {aircraftLabel, aircraftValue} from '../../utils/aircraft-metadata.js';
import {formatDateTime} from '../../utils/date-time.js';
import {fileDialogSectionSx, fileDialogTitleSx} from './file-dialog-styles.js';

export function AircraftOverviewHeader({detail, titleId, onClose}) {
    const {t} = useTranslation('filebrowser');
    const {t: aircraftT} = useTranslation('common');
    const aircraft = detail.aircraft;
    const country = aircraftCountry(detail.icao);
    // Keep MUI's wrapper ID separate so only the aircraft heading names the dialog.
    return <DialogTitle id={`${titleId}-header`} component="div" sx={(theme) => ({
        ...fileDialogTitleSx, px: {xs: 2, sm: 3}, py: 1.5, flexShrink: 0, bgcolor: 'background.paper',
        background: `linear-gradient(120deg, ${alpha(theme.palette.info.main, 0.12)}, ${alpha(theme.palette.info.main, 0.02)})`,
        display: 'grid', alignItems: 'center', columnGap: 1.25, rowGap: 0.75,
        gridTemplateColumns: {xs: '36px minmax(0, 1fr) 28px', sm: '40px minmax(0, 1fr) auto 28px'},
        gridTemplateAreas: {xs: '"icon identity close" ". counts counts"', sm: '"icon identity counts close"'},
    })}>
        <Box sx={(theme) => ({
            gridArea: 'icon', display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: {xs: 36, sm: 40}, height: {xs: 36, sm: 40}, borderRadius: 2,
            color: 'info.main', bgcolor: alpha(theme.palette.info.main, 0.12),
        })}>
            <FlightIcon sx={{fontSize: 26}} />
        </Box>
        <Box sx={{gridArea: 'identity', minWidth: 0}}>
            <Box sx={{display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1, rowGap: 0.5}}>
                <Typography id={titleId} component="h2" variant="h6" sx={{fontWeight: 700, lineHeight: 1.25, overflowWrap: 'anywhere'}}>
                    {aircraft?.registration || detail.icao?.toUpperCase() || detail.name}
                </Typography>
                {country && <AircraftFlag icao={detail.icao} />}
                {aircraft?.type_code && <Chip size="small" variant="outlined" label={aircraft.type_code} />}
                {aircraft && <Chip size="small" label={aircraftValue(aircraft, 'classification', aircraftT)}
                    color={aircraft.military_status === 'military' ? 'warning' : 'default'} variant="outlined" />}
            </Box>
            {(aircraft?.model || country) && <Box sx={{display: 'flex', flexWrap: 'wrap', columnGap: 1.5, mt: 0.5}}>
                {aircraft?.model && <Typography variant="caption" color="text.secondary" sx={{overflowWrap: 'anywhere'}}>
                    {aircraft.model}
                </Typography>}
                {country && <Typography variant="caption" color="text.secondary">
                    {t('adsb.registration_country', 'Registration country: {{country}}', {country: country.name})}
                </Typography>}
            </Box>}
        </Box>
        <Box sx={{gridArea: 'counts', display: 'flex', flexWrap: 'wrap', gap: 0.5}}>
            <Chip size="small" color="info" label={t('adsb.updates', '{{count}} updates', {count: detail.packet_count})} />
            <Chip size="small" variant="outlined" label={t('adsb.runs', '{{count}} runs', {count: detail.run_count})} />
        </Box>
        <IconButton size="small" onClick={onClose} aria-label={t('adsb.close_folder', 'Close aircraft folder')}
            sx={{gridArea: 'close', alignSelf: 'start'}}>
            <CloseIcon fontSize="small" />
        </IconButton>
    </DialogTitle>;
}

export default function AircraftOverview({detail, timeSettings}) {
    const {t} = useTranslation('filebrowser');
    const {t: aircraftT} = useTranslation('common');
    const groupsId = useId();
    // The capture-wide summary stays independent of history selection and filters.
    const aircraft = detail.aircraft;
    const icao = detail.icao?.toUpperCase();
    const date = (value) => value ? formatDateTime(value, timeSettings) || '—' : '—';
    const timezone = timeSettings.timezone || 'UTC';
    // Keep known zero and false values when omitting unavailable metadata.
    const hasValue = (key) => aircraft?.[key] !== null && aircraft?.[key] !== undefined && aircraft?.[key] !== '';
    const groups = [
        {key: 'airframe', title: t('adsb.airframe', 'Airframe'), icon: CategoryOutlinedIcon,
            fields: ['category', 'aircraft_class', 'wake_category', 'type_description', 'year']},
        {key: 'propulsion', title: t('adsb.propulsion', 'Propulsion'), icon: SettingsOutlinedIcon,
            fields: ['engine_count', 'engine_type']},
        {key: 'registry', title: t('adsb.registry_operator', 'Registry & operator'), icon: BusinessOutlinedIcon,
            fields: ['operator_code', 'operator_callsign', 'owner', 'interesting']},
    ].map((group) => ({...group, fields: group.fields.filter(hasValue)})).filter((group) => group.fields.length > 0);
    const details = [
        {label: t('adsb.icao', 'ICAO address'), value: icao || '—', mono: true},
        ...(detail.callsign ? [{label: t('adsb.callsign', 'Callsign'), value: detail.callsign, mono: true}] : []),
        ...['operator_name', 'operator_country'].filter((key) => aircraft?.[key]).map((key) => ({
            label: aircraftLabel(key, aircraftT), value: aircraftValue(aircraft, key, aircraftT),
        })),
    ];
    return <Paper component="section" aria-label={t('adsb.overview', 'Aircraft overview')} variant="outlined" sx={fileDialogSectionSx}>
        <Box sx={{px: {xs: 2, sm: 2.5}, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            columnGap: 2, rowGap: 1, flexWrap: 'wrap', borderBottom: '1px solid', borderColor: 'divider'}}>
            <Box sx={{display: 'flex', alignItems: 'center', gap: 1}}>
                <InfoOutlinedIcon sx={{fontSize: 18, color: 'text.secondary'}} />
                <Typography component="h3" variant="subtitle2" fontWeight={600}>
                    {aircraftT('aircraft.details', 'Aircraft details')}
                </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">
                {t('adsb.latest_captured_details', 'Latest captured details · {{date}} ({{timezone}})', {
                    date: date(detail.last_packet_at), timezone,
                })}
            </Typography>
        </Box>
        <Box sx={{px: {xs: 2, sm: 2.5}, py: 2}}>
            <Box component="dl" sx={{display: 'grid', gridTemplateColumns: {xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))'},
                columnGap: 3, rowGap: 2, m: 0}}>
                {details.map((item) => <MetadataField key={item.label} {...item} />)}
            </Box>
            <Box sx={{display: 'flex', alignItems: 'flex-start', gap: 1.25, mt: 2, pt: 1.5, borderTop: '1px solid', borderColor: 'divider'}}>
                <AccessTimeIcon sx={{fontSize: 18, color: 'text.secondary', mt: 0.125, flexShrink: 0}} />
                <Box component="dl" sx={{display: 'grid', gridTemplateColumns: {xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))'},
                    columnGap: 3, rowGap: 1.5, flex: 1, minWidth: 0, m: 0}}>
                    {[
                        {label: t('adsb.first_received', 'First received'), value: detail.captured_at},
                        {label: t('adsb.last_received', 'Last received'), value: detail.last_packet_at},
                    ].map((item) => <MetadataField key={item.label} label={`${item.label} (${timezone})`} value={date(item.value)} />)}
                </Box>
            </Box>
        </Box>
        {groups.length > 0 && <Box component="section" aria-label={t('adsb.additional_details', 'Additional details')}
            sx={{px: {xs: 2, sm: 2.5}, py: 2, borderTop: '1px solid', borderColor: 'divider'}}>
            <Box sx={{display: 'grid', gridTemplateColumns: {xs: 'minmax(0, 1fr)', md: `repeat(${groups.length}, minmax(0, 1fr))`}, gap: {xs: 2.5, md: 0}}}>
                {groups.map((group, index) => {
                    const Icon = group.icon;
                    const headingId = `${groupsId}-${group.key}`;
                    return <Box key={group.key} component="section" aria-labelledby={headingId} sx={{
                        minWidth: 0, px: {md: 2.5}, '&:first-of-type': {pl: 0}, '&:last-of-type': {pr: 0},
                        borderLeft: {md: index > 0 ? '1px solid' : 0}, borderLeftColor: {md: 'divider'},
                    }}>
                        <Box sx={{display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75}}>
                            <Icon sx={{fontSize: 18, color: 'text.secondary'}} />
                            <Typography id={headingId} component="h4" variant="body2" fontWeight={600}>{group.title}</Typography>
                        </Box>
                        <Box component="dl" sx={{m: 0}}>
                            {group.fields.map((key) => <MetadataField key={key} inline
                                label={aircraftLabel(key, aircraftT)} value={aircraftValue(aircraft, key, aircraftT)}
                                mono={['type_description', 'operator_code', 'operator_callsign'].includes(key)} />)}
                        </Box>
                    </Box>;
                })}
            </Box>
        </Box>}
    </Paper>;
}
