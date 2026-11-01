/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useMemo, useState} from 'react';
import {createPortal} from 'react-dom';
import {Box, Button, IconButton, Tooltip, Typography} from '@mui/material';
import ViewColumnIcon from '@mui/icons-material/ViewColumn';
import FilterListIcon from '@mui/icons-material/FilterList';
import {ColumnsPanelTrigger, DataGrid, FilterPanelTrigger} from '@mui/x-data-grid';
import {useTranslation} from 'react-i18next';
import {getClassNamesBasedOnGridEditing, islandTitleBarCompactSx, TitleBar} from '../common/common.jsx';
import GridPaginationActions from '../common/grid-pagination-actions.jsx';
import {useUserTimeSettings} from '../../hooks/useUserTimeSettings.jsx';
import {formatDateTime} from '../../utils/date-time.js';
import {detailLabel, flattenDetails, typeColor, typeLabel} from './transmitters.js';

const visibleDetails = new Set([
    'signal.frequency_hz', 'telemetry.vel_h', 'telemetry.vel_v', 'telemetry.heading',
    'telemetry.pressure',
    'telemetry.position.speed_knots', 'telemetry.position.course_degrees',
]);
const excludedDetails = new Set([
    'telemetry.id', 'telemetry.lat', 'telemetry.lon', 'telemetry.alt',
    'telemetry.position.latitude', 'telemetry.position.longitude', 'telemetry.position.altitude_meters',
    'telemetry.temp', 'telemetry.humidity', 'telemetry.batt', 'telemetry.comment',
]);

function TransmitterTableToolbar({container}) {
    const {t} = useTranslation('navigation');
    if (!container) return null;
    // Keep the native panel context and anchors while placing controls in the title bar.
    return createPortal(<Box sx={{display: 'flex', alignItems: 'center', gap: 0.5}}
        onMouseDown={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()}>
        <Tooltip title={t('packet_map.columns', {defaultValue: 'Columns'})}>
            <ColumnsPanelTrigger render={<IconButton size="small" sx={{p: '2px'}}
                aria-label={t('packet_map.columns', {defaultValue: 'Columns'})} />}>
                <ViewColumnIcon fontSize="small" />
            </ColumnsPanelTrigger>
        </Tooltip>
        <Tooltip title={t('packet_map.filters', {defaultValue: 'Filters'})}>
            <FilterPanelTrigger render={<IconButton size="small" sx={{p: '2px'}}
                aria-label={t('packet_map.filters', {defaultValue: 'Filters'})} />}>
                <FilterListIcon fontSize="small" />
            </FilterPanelTrigger>
        </Tooltip>
    </Box>, container);
}

export default function TransmitterTable({rows, loading, hiddenTypes, gridEditable, selectedTransmitterId = null, onSelectTransmitter}) {
    const {t} = useTranslation('navigation');
    const timeSettings = useUserTimeSettings();
    const [columnVisibility, setColumnVisibility] = useState({});
    const [toolbarContainer, setToolbarContainer] = useState(null);
    const rowSelectionModel = useMemo(() => ({type: 'include',
        ids: new Set(selectedTransmitterId === null ? [] : [selectedTransmitterId]),
    }), [selectedTransmitterId]);
    const data = useMemo(() => rows.map((row) => ({...row, fields: flattenDetails(row.details)})), [rows]);
    const fields = useMemo(() => [...new Set(data.flatMap((row) => Object.keys(row.fields)))].sort(), [data]);
    const format = (value) => formatDateTime(value, timeSettings);
    const columns = useMemo(() => [
        {field: 'name', headerName: t('packet_map.column_headers.name', {defaultValue: 'Name'}), width: 150,
            description: t('packet_map.name', {defaultValue: 'Transmitter'}),
            renderCell: ({row}) => <Button size="small" onClick={(event) => {
                // Use the shared selection instead of opening a second detail surface.
                event.stopPropagation();
                onSelectTransmitter?.(row.id);
            }} sx={{textTransform: 'none', minWidth: 0, px: 0, maxWidth: '100%'}}>
                <Typography variant="body2" noWrap>{row.name}</Typography>
            </Button>},
        {field: 'kind', headerName: t('packet_map.type', {defaultValue: 'Type'}), width: 95,
            valueFormatter: typeLabel,
            renderCell: ({value}) => <Typography variant="caption" sx={{color: typeColor(value)}}>{typeLabel(value)}</Typography>},
        {field: 'source', headerName: t('packet_map.source', {defaultValue: 'Source'}), width: 110},
        {field: 'packet_count', headerName: t('packet_map.column_headers.packets', {defaultValue: 'Pkts'}), type: 'number', width: 72,
            description: t('packet_map.packets', {defaultValue: 'Packets'})},
        ...['first_seen', 'last_seen'].map((field) => ({field,
            headerName: t(`packet_map.column_headers.${field}`, {defaultValue: field === 'first_seen' ? 'First' : 'Last'}),
            description: t(`packet_map.${field}`, {defaultValue: field === 'first_seen' ? 'First seen' : 'Last seen'}),
            type: 'dateTime', width: 170, valueGetter: (value) => value ? new Date(value) : null, valueFormatter: format})),
        ...['latitude', 'longitude', 'altitude'].map((field) => ({field, type: 'number', width: field === 'altitude' ? 90 : 105,
            headerName: t(`packet_map.column_headers.${field}`, {defaultValue: {latitude: 'Lat', longitude: 'Lon', altitude: 'Alt (m)'}[field]}),
            description: t(`packet_map.${field}`, {defaultValue: {latitude: 'Latitude', longitude: 'Longitude', altitude: 'Altitude (m)'}[field]}),
            valueFormatter: (value) => value == null ? '' : value.toLocaleString(timeSettings.locale, {
                minimumFractionDigits: field === 'altitude' ? 0 : 6, maximumFractionDigits: field === 'altitude' ? 2 : 6,
            })})),
        ...fields.filter((path) => !excludedDetails.has(path)).map((path) => {
            const example = data.find((row) => row.fields[path] != null);
            const value = example.fields[path];
            const label = detailLabel(path, example.field_info);
            return {field: `info:${path}`, headerName: label, description: label,
                width: typeof value === 'number' ? 120 : typeof value === 'boolean' ? 80 : 150,
                type: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string',
                valueGetter: (_value, row) => row.fields[path] ?? null};
        }),
    ], [data, fields, t, timeSettings.timezone, timeSettings.locale, onSelectTransmitter]);
    const visibility = Object.fromEntries(fields.map((path) => [`info:${path}`, visibleDetails.has(path)]));

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
                initialState={{pagination: {paginationModel: {pageSize: 25}}, sorting: {sortModel: [{field: 'last_seen', sort: 'desc'}]}}}
                columnVisibilityModel={{...visibility, ...columnVisibility}} onColumnVisibilityModelChange={setColumnVisibility}
                getRowClassName={({row}) => hiddenTypes.includes(row.kind) ? 'transmitter-hidden' : ''}
                slots={{toolbar: TransmitterTableToolbar}}
                slotProps={{toolbar: {container: toolbarContainer}, basePagination: {ActionsComponent: GridPaginationActions},
                    loadingOverlay: {variant: 'linear-progress', noRowsVariant: 'linear-progress'}}}
                sx={{border: 0, borderRadius: 0, '& .MuiDataGrid-row': {cursor: 'pointer'}, '& .transmitter-hidden': {opacity: 0.55},
                    '& .MuiDataGrid-columnHeader, & .MuiDataGrid-cell': {px: 0.75},
                    '& .MuiDataGrid-columnHeaderTitle': {fontSize: '0.75rem', fontWeight: 600, lineHeight: 1.2, letterSpacing: 0},
                    '& .MuiDataGrid-cell:focus, & .MuiDataGrid-cell:focus-within': {outline: 'none'}}} />
        </Box>
    </Box>;
}
