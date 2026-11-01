/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useId, useMemo} from 'react';
import {Box, Chip, CircularProgress, IconButton, Tooltip, Typography} from '@mui/material';
import {alpha} from '@mui/material/styles';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ExploreIcon from '@mui/icons-material/Explore';
import HistoryIcon from '@mui/icons-material/History';
import SensorsIcon from '@mui/icons-material/Sensors';
import SettingsInputAntennaIcon from '@mui/icons-material/SettingsInputAntenna';
import CloseIcon from '@mui/icons-material/Close';
import {useTranslation} from 'react-i18next';
import {getClassNamesBasedOnGridEditing, islandTitleBarCompactSx, TitleBar} from '../common/common.jsx';
import {useUserTimeSettings} from '../../hooks/useUserTimeSettings.jsx';
import {formatDateTime} from '../../utils/date-time.js';
import {detailLabel, flattenDetails, typeColor, typeLabel} from './transmitters.js';
import AircraftFlag from '../common/aircraft-flag.jsx';
import {aircraftCountry} from '../../utils/aircraft-country.js';

function InfoSection({title, icon: Icon, fields}) {
    const titleId = useId();
    return <Box component="section" aria-labelledby={titleId} sx={{mb: 2}}>
        <Box sx={{display: 'flex', alignItems: 'center', gap: 0.75, mb: 1, color: 'secondary.main'}}>
            <Icon sx={{fontSize: 16}} />
            <Typography id={titleId} variant="overline" sx={{fontSize: '0.65rem', fontWeight: 700, lineHeight: 1.5}}>
                {title}
            </Typography>
        </Box>
        <Box component="dl" sx={{m: 0, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 1.25}}>
            {fields.map(({label, value, wide}, index) => <Box key={index} sx={{minWidth: 0, gridColumn: wide ? '1 / -1' : undefined}}>
                <Typography component="dt" variant="caption" sx={{fontSize: '0.65rem', color: 'text.secondary'}}>{label}</Typography>
                <Typography component="dd" sx={{m: 0, mt: 0.25, fontSize: '0.75rem', fontWeight: 500,
                    fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap'}}>
                    {value === null || value === undefined || value === '' ? '—' : String(value)}
                </Typography>
            </Box>)}
        </Box>
    </Box>;
}

export default function TransmitterInfo({transmitter, selectedTransmitterId = null, loading, gridEditable, onClearSelection}) {
    const {t} = useTranslation('navigation');
    const timeSettings = useUserTimeSettings();
    const titleId = useId();
    const label = (key, fallback) => t(`packet_map.${key}`, {defaultValue: fallback});
    // Source is the ICAO address for both saved and live aircraft records.
    const country = transmitter?.kind === 'adsb' ? aircraftCountry(transmitter.source) : null;
    const formatTime = (value) => formatDateTime(value, timeSettings);
    const formatNumber = (value, digits) => Number.isFinite(value)
        ? value.toLocaleString(timeSettings.locale, {maximumFractionDigits: digits}) : value;
    const groups = useMemo(() => {
        const grouped = new Map();
        for (const [path, value] of Object.entries(flattenDetails(transmitter?.details))) {
            const [group, ...parts] = path.split('.');
            if (!grouped.has(group)) grouped.set(group, []);
            grouped.get(group).push({
                label: group === 'telemetry' ? detailLabel(path, transmitter.field_info) : detailLabel(parts.join('.') || group),
                value,
                wide: typeof value === 'string' && value.length > 28,
            });
        }
        return [...grouped];
    }, [transmitter]);
    const groupNames = {
        telemetry: label('info.telemetry', 'Telemetry'),
        signal: label('info.signal', 'Signal'),
        decoder: label('info.decoder', 'Decoder'),
        vfo: 'VFO',
        satellite: label('info.satellite', 'Satellite'),
        transmitter: label('info.transmitter', 'Transmitter metadata'),
        frame: label('info.frame', 'Packet frame'),
        additional: label('info.additional', 'Additional data'),
    };

    return <Box role="region" aria-labelledby={titleId}
        sx={{height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, bgcolor: 'background.paper'}}>
        <TitleBar className={getClassNamesBasedOnGridEditing(gridEditable, ['window-title-bar'])}
            sx={{...islandTitleBarCompactSx, flexShrink: 0, justifyContent: 'space-between'}}>
            <Typography id={titleId} variant="subtitle2" noWrap sx={{fontWeight: 'bold'}}>
                {label('info.title', 'Transmitter info')}
            </Typography>
            {selectedTransmitterId !== null && <Tooltip title={label('info.clear_selection', 'Clear transmitter selection')}>
                <IconButton size="small" onClick={onClearSelection} sx={{p: '2px'}}
                    aria-label={label('info.clear_selection', 'Clear transmitter selection')}><CloseIcon sx={{fontSize: 16}} /></IconButton>
            </Tooltip>}
        </TitleBar>
        {transmitter ? <>
            <Box sx={{p: 1.25, borderBottom: 1, borderColor: 'divider',
                bgcolor: (theme) => alpha(typeColor(transmitter.kind), theme.palette.mode === 'dark' ? 0.1 : 0.06)}}>
                <Box sx={{display: 'flex', alignItems: 'center', gap: 1, mb: 0.5}}>
                    <Box sx={{width: 8, height: 8, borderRadius: '50%', bgcolor: typeColor(transmitter.kind), flexShrink: 0}} />
                    {country && <AircraftFlag icao={transmitter.source} />}
                    <Typography variant="subtitle2" sx={{fontWeight: 700, overflowWrap: 'anywhere', minWidth: 0, flex: 1}}>
                        {transmitter.name}
                    </Typography>
                    <Chip size="small" variant="outlined" label={typeLabel(transmitter.kind)}
                        sx={{height: 20, fontSize: '0.65rem', color: typeColor(transmitter.kind), borderColor: typeColor(transmitter.kind)}} />
                </Box>
                <Typography variant="caption" sx={{display: 'block', color: 'text.secondary', overflowWrap: 'anywhere'}}>
                    {label('info.identifier', 'ID')}: {transmitter.id}
                </Typography>
            </Box>
            <Box sx={{flex: 1, minHeight: 0, overflowY: 'auto', p: 1.5}}>
                <InfoSection title={label('info.position', 'Latest position')} icon={ExploreIcon} fields={[
                    {label: label('latitude', 'Latitude'), value: formatNumber(transmitter.latitude, 6)},
                    {label: label('longitude', 'Longitude'), value: formatNumber(transmitter.longitude, 6)},
                    {label: label('altitude', 'Altitude (m)'), value: formatNumber(transmitter.altitude, 2)},
                ]} />
                <InfoSection title={label('info.reception', 'Reception')} icon={HistoryIcon} fields={[
                    {label: label('source', 'Source'), value: transmitter.source},
                    ...(country ? [{label: label('info.registration_country', 'ICAO registration country'), value: country.name}] : []),
                    {label: label('packets', 'Packets'), value: formatNumber(transmitter.packet_count, 0)},
                    {label: label('first_seen', 'First seen'), value: formatTime(transmitter.first_seen), wide: true},
                    {label: label('last_seen', 'Last seen'), value: formatTime(transmitter.last_seen), wide: true},
                    {label: label('info.captured_at', 'Latest packet received'), value: formatTime(transmitter.captured_at), wide: true},
                    {label: label('latest_file', 'Latest file'), value: transmitter.file_id, wide: true},
                ]} />
                {/* Include every decoded field and capture context, including unknown parser fields. */}
                {groups.map(([group, fields]) => <InfoSection key={group}
                    title={groupNames[group] || detailLabel(group)} icon={group === 'telemetry' ? SensorsIcon : SettingsInputAntennaIcon}
                    fields={fields} />)}
            </Box>
        </> : <Box sx={{flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 1, p: 2, color: 'text.secondary', textAlign: 'center'}}>
            {loading && selectedTransmitterId !== null ? <CircularProgress size={22} /> : <InfoOutlinedIcon sx={{fontSize: 28, opacity: 0.6}} />}
            <Typography variant="body2" sx={{fontSize: '0.75rem'}}>
                {selectedTransmitterId === null ? label('info.select', 'Select a transmitter on the map or in the table to view its information.')
                    : loading ? label('info.loading', 'Loading transmitter information…')
                        : label('info.unavailable', 'No packets for the selected transmitter in this date range.')}
            </Typography>
        </Box>}
    </Box>;
}
