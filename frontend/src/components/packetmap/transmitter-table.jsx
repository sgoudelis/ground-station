/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useMemo, useState} from 'react';
import {Box, Button, Chip, Tooltip, Typography} from '@mui/material';
import {alpha} from '@mui/material/styles';
import {DataGrid} from '@mui/x-data-grid';
import GridTableToolbar from '../common/grid-table-toolbar.jsx';
import TransmitterColumnsManagement from './transmitter-columns-management.jsx';
import {useTranslation} from 'react-i18next';
import {useDispatch, useSelector} from 'react-redux';
import {getClassNamesBasedOnGridEditing, islandTitleBarCompactSx, TitleBar} from '../common/common.jsx';
import GridPaginationActions from '../common/grid-pagination-actions.jsx';
import {useUserTimeSettings} from '../../hooks/useUserTimeSettings.jsx';
import {formatDateTime} from '../../utils/date-time.js';
import {detailLabel, flattenDetails, typeColor, typeLabel} from './transmitters.js';
import {setTransmitterTableColumnVisibility} from './packet-map-slice.jsx';
import AircraftFlag from '../common/aircraft-flag.jsx';
import {aircraftLabel, aircraftValue} from '../../utils/aircraft-metadata.js';
import {aircraftEmergency, aircraftEmergencyLabel} from '../../utils/aircraft-emergency.js';
import {getReceiverDistances} from '../filebrowser/position-utils.js';

const visibleDetails = new Set([
    'signal.frequency_hz', 'telemetry.vel_h', 'telemetry.vel_v', 'telemetry.heading',
    'telemetry.pressure',
    'telemetry.position.speed_knots', 'telemetry.position.course_degrees',
]);
const excludedDetails = new Set([
    'telemetry.id', 'telemetry.lat', 'telemetry.lon', 'telemetry.alt',
    'telemetry.position.latitude', 'telemetry.position.longitude', 'telemetry.position.altitude_meters',
    'telemetry.temp', 'telemetry.humidity', 'telemetry.batt', 'telemetry.comment',
    'telemetry.aircraft.registration', 'telemetry.aircraft.type_code', 'telemetry.aircraft.classification',
    'telemetry.squawk',
]);
const compactDetails = {
    'telemetry.callsign': {label: 'Callsign', key: 'callsign', width: 75},
    'telemetry.heading': {label: 'Heading', key: 'heading', width: 85, unit: '°', digits: 1},
    'telemetry.vel_h': {label: 'H. speed', key: 'horizontal_speed', width: 90, unit: 'm/s', digits: 2},
    'telemetry.vel_v': {label: 'V. speed', key: 'vertical_speed', width: 90, unit: 'm/s', digits: 2},
};

export default function TransmitterTable({rows, loading, hiddenTypes, gridEditable, selectedTransmitterId = null, onSelectTransmitter}) {
    const {t} = useTranslation('navigation');
    const {t: aircraftT} = useTranslation('common');
    const timeSettings = useUserTimeSettings();
    const dispatch = useDispatch();
    const receiver = useSelector((state) => state.location?.location);
    // Retain saved choices even when their decoded fields are absent from the results.
    const columnVisibility = useSelector((state) => state.packetMap.transmitterTableColumnVisibility);
    const [toolbarContainer, setToolbarContainer] = useState(null);
    const rowSelectionModel = useMemo(() => ({type: 'include',
        ids: new Set(selectedTransmitterId === null ? [] : [selectedTransmitterId]),
    }), [selectedTransmitterId]);
    const data = useMemo(() => rows.map((row) => ({...row, fields: flattenDetails(row.details),
        // Use ground distance for every protocol, including reports without altitude.
        distance: getReceiverDistances(row, receiver)?.groundKm ?? null,
        // Saved fixes carry compact icon metadata; full transmitter details add
        // registration and database flags. Aircraft-only columns stay blank for other protocols.
        aircraft: row.kind === 'adsb' ? {...row.aircraft, ...row.details?.telemetry?.aircraft} : null,
        emergencyStatus: aircraftEmergency(row),
    })), [rows, receiver]);
    const fields = useMemo(() => [...new Set(data.flatMap((row) => Object.keys(row.fields)))].sort(), [data]);
    const format = (value) => formatDateTime(value, timeSettings);
    const columns = useMemo(() => [
        {field: 'name', headerName: t('packet_map.column_headers.name', {defaultValue: 'Name'}), width: 120,
            description: t('packet_map.name', {defaultValue: 'Transmitter'}),
            renderCell: ({row}) => <Button size="small" onClick={(event) => {
                // Use the shared selection instead of opening a second detail surface.
                event.stopPropagation();
                onSelectTransmitter?.(row.id);
            }} sx={{textTransform: 'none', minWidth: 0, px: 0, maxWidth: '100%', gap: 0.75}}>
                {row.kind === 'adsb' && <AircraftFlag icao={row.source} />}
                <Typography variant="body2" noWrap>{row.name}</Typography>
            </Button>},
        {field: 'kind', headerName: t('packet_map.type', {defaultValue: 'Type'}), width: 82,
            valueFormatter: typeLabel,
            renderCell: ({value}) => <Typography variant="caption" sx={{color: typeColor(value)}}>{typeLabel(value)}</Typography>},
        {field: 'source', headerName: t('packet_map.source', {defaultValue: 'Source'}), width: 90},
        {field: 'distance', headerName: t('packet_map.column_headers.distance', {defaultValue: 'Distance (km)'}),
            description: t('packet_map.distance', {defaultValue: 'Ground distance from the home station to the latest position'}),
            type: 'number', width: 90,
            valueFormatter: (value) => value == null ? '' : `${value.toLocaleString(timeSettings.locale, {
                minimumFractionDigits: 1, maximumFractionDigits: 1,
            })} km`},
        ...['registration', 'type_code', 'classification'].map((key) => ({
            // Stable columns remain available without depending on which aircraft
            // happen to appear in the current range. Reuse the info panel's labels.
            field: `aircraft:${key}`, headerName: aircraftLabel(key, aircraftT),
            width: key === 'classification' ? 145 : 100,
            valueGetter: (_value, row) => !row.aircraft ? ''
                : key === 'classification' ? aircraftValue(row.aircraft, key, aircraftT) : row.aircraft[key] ?? '',
        })),
        {field: 'squawk', headerName: t('packet_map.column_headers.squawk', {defaultValue: 'Squawk'}), width: 75,
            // Treat transponder codes as text so leading zeroes are retained.
            type: 'string', valueGetter: (value, row) => row.kind === 'adsb'
                ? (Object.hasOwn(row.details?.telemetry ?? {}, 'squawk') ? row.details.telemetry.squawk : value) ?? '' : '',
            renderCell: ({value, row}) => row.emergencyStatus ? <Tooltip title={aircraftT('aircraft.emergency.tooltip', {
                defaultValue: 'Reported status: {{status}}', status: aircraftEmergencyLabel(row.emergencyStatus, aircraftT),
            })}>
                <Chip size="small" color={row.emergencyStatus.severity}
                    label={value || aircraftT('aircraft.emergency.alert', 'Alert')}
                    sx={{height: 20, fontSize: '0.7rem', fontWeight: 700, borderRadius: 1, '& .MuiChip-label': {px: 0.75}}} />
            </Tooltip> : value},
        {field: 'packet_count', headerName: t('packet_map.column_headers.packets', {defaultValue: 'Pkts'}), type: 'number', width: 60,
            description: t('packet_map.packets', {defaultValue: 'Packets'})},
        ...['first_seen', 'last_seen'].map((field) => ({field,
            headerName: t(`packet_map.column_headers.${field}`, {defaultValue: field === 'first_seen' ? 'First' : 'Last'}),
            description: t(`packet_map.${field}`, {defaultValue: field === 'first_seen' ? 'First seen' : 'Last seen'}),
            type: 'dateTime', width: 170, valueGetter: (value) => value ? new Date(value) : null, valueFormatter: format})),
        ...['latitude', 'longitude', 'altitude'].map((field) => ({field, type: 'number', width: 90,
            headerName: t(`packet_map.column_headers.${field}`, {defaultValue: {latitude: 'Lat', longitude: 'Lon', altitude: 'Alt (m)'}[field]}),
            description: t(`packet_map.${field}`, {defaultValue: {latitude: 'Latitude', longitude: 'Longitude', altitude: 'Altitude (m)'}[field]}),
            valueFormatter: (value) => value == null ? '' : `${value.toLocaleString(timeSettings.locale, {
                minimumFractionDigits: field === 'altitude' ? 0 : 6, maximumFractionDigits: field === 'altitude' ? 2 : 6,
            })}${field === 'altitude' ? ' m' : '°'}`})),
        ...fields.filter((path) => !excludedDetails.has(path)).map((path) => {
            const example = data.find((row) => row.fields[path] != null);
            const value = example.fields[path];
            const label = detailLabel(path, example.field_info);
            const compact = compactDetails[path];
            return {field: `info:${path}`,
                headerName: compact ? t(`packet_map.column_headers.${compact.key}`, {defaultValue: compact.label}) : label,
                description: label,
                width: compact?.width ?? (typeof value === 'number' ? 120 : typeof value === 'boolean' ? 80 : 150),
                type: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string',
                valueGetter: (_value, row) => row.fields[path] ?? null,
                // Format only the display so sorting and filtering still use
                // numeric telemetry, including zero and negative climb rates.
                ...(compact?.unit && {valueFormatter: (value) => Number.isFinite(value)
                    ? `${value.toLocaleString(timeSettings.locale, {maximumFractionDigits: compact.digits})}${compact.unit === '°' ? '' : ' '}${compact.unit}`
                    : value ?? ''}),
            };
        }),
    ], [data, fields, t, aircraftT, timeSettings.timezone, timeSettings.locale, onSelectTransmitter]);
    const visibility = Object.fromEntries(fields.map((path) => [`info:${path}`, visibleDetails.has(path)]));
    // Compare saved overrides with application defaults, including decoded
    // fields absent from this range, so Reset also clears those saved choices.
    const visibilityChanged = Object.entries(columnVisibility).some(([field, visible]) =>
        (visible !== false) !== (!field.startsWith('info:') || visibleDetails.has(field.slice(5))));

    return <Box sx={{height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column'}}>
        <TitleBar className={getClassNamesBasedOnGridEditing(gridEditable, ['window-title-bar'])}
            sx={{...islandTitleBarCompactSx, flexShrink: 0, justifyContent: 'space-between'}}>
            <Typography variant="subtitle2" noWrap sx={{fontWeight: 'bold', flex: 1, minWidth: 0}}>{t('packet_map.transmitters', {defaultValue: 'Transmitters'})}</Typography>
            <Box sx={{display: 'flex', alignItems: 'center', gap: 1, flexShrink: 0}}>
                <Box ref={setToolbarContainer} />
            </Box>
        </TitleBar>
        <Box sx={{flex: 1, minHeight: 0, minWidth: 0}}>
            {/* Compact density scales the base header height to 32px. */}
            <DataGrid rows={data} columns={columns} loading={loading} density="compact" columnHeaderHeight={46} showToolbar
                disableMultipleRowSelection keepNonExistentRowsSelected pageSizeOptions={[10, 25, 50, 100]}
                rowSelectionModel={rowSelectionModel}
                onRowSelectionModelChange={(selection) => onSelectTransmitter?.(selection.ids.values().next().value ?? null)}
                initialState={{pagination: {paginationModel: {pageSize: 25}}, sorting: {sortModel: [{field: 'first_seen', sort: 'desc'}]}}}
                columnVisibilityModel={{...visibility, ...columnVisibility}}
                onColumnVisibilityModelChange={(model) => dispatch(setTransmitterTableColumnVisibility(model))}
                getRowClassName={({row}) => [hiddenTypes.includes(row.kind) ? 'transmitter-hidden' : '',
                    row.emergencyStatus ? `transmitter-emergency-${row.emergencyStatus.severity}` : ''].filter(Boolean).join(' ')}
                slots={{toolbar: GridTableToolbar, columnsManagement: TransmitterColumnsManagement}}
                slotProps={{toolbar: {container: toolbarContainer},
                    columnsManagement: {resetDisabled: !visibilityChanged,
                        onReset: () => dispatch(setTransmitterTableColumnVisibility({}))},
                    basePagination: {ActionsComponent: GridPaginationActions},
                    loadingOverlay: {variant: 'linear-progress', noRowsVariant: 'linear-progress'}}}
                sx={(theme) => ({border: 0, borderRadius: 0, '& .MuiDataGrid-row': {cursor: 'pointer'}, '& .transmitter-hidden': {opacity: 0.55},
                    // Keep selection and hover visible within the emergency tint.
                    ...Object.fromEntries(['error', 'warning'].map((severity) => [`& .transmitter-emergency-${severity}`, {
                        bgcolor: alpha(theme.palette[severity].main, 0.1),
                        '&:hover': {bgcolor: alpha(theme.palette[severity].main, 0.16)},
                        '&.Mui-selected': {bgcolor: alpha(theme.palette[severity].main, 0.2)},
                        '&.Mui-selected:hover': {bgcolor: alpha(theme.palette[severity].main, 0.26)},
                    }])),
                    '& .MuiDataGrid-columnHeader, & .MuiDataGrid-cell': {px: 0.75},
                    '& .MuiDataGrid-columnHeaderTitle': {fontSize: '0.75rem', fontWeight: 600, lineHeight: 1.2, letterSpacing: 0},
                    '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within': {outline: 'none'}})} />
        </Box>
    </Box>;
}
