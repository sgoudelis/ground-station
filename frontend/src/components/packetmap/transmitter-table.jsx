/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useMemo, useState} from 'react';
import {Box, Button, Dialog, DialogContent, DialogTitle, IconButton, Table, TableBody, TableCell, TableRow, Tooltip, Typography, useMediaQuery} from '@mui/material';
import {useTheme} from '@mui/material/styles';
import CloseIcon from '@mui/icons-material/Close';
import {DataGrid} from '@mui/x-data-grid';
import {useTranslation} from 'react-i18next';
import {getClassNamesBasedOnGridEditing, islandTitleBarCompactSx, TitleBar} from '../common/common.jsx';
import GridPaginationActions from '../common/grid-pagination-actions.jsx';
import {useUserTimeSettings} from '../../hooks/useUserTimeSettings.jsx';
import {formatDateTime} from '../../utils/date-time.js';
import {detailLabel, flattenDetails, typeColor, typeLabel} from './transmitters.js';

const visibleDetails = new Set([
    'signal.frequency_hz', 'telemetry.vel_h', 'telemetry.vel_v', 'telemetry.heading',
    'telemetry.temp', 'telemetry.humidity', 'telemetry.pressure', 'telemetry.batt',
    'telemetry.position.speed_knots', 'telemetry.position.course_degrees', 'telemetry.comment',
]);
const repeatedDetails = new Set([
    'telemetry.id', 'telemetry.lat', 'telemetry.lon', 'telemetry.alt',
    'telemetry.position.latitude', 'telemetry.position.longitude', 'telemetry.position.altitude_meters',
]);

export default function TransmitterTable({rows, loading, hiddenTypes, gridEditable}) {
    const {t} = useTranslation('navigation');
    const timeSettings = useUserTimeSettings();
    const theme = useTheme();
    const mobile = useMediaQuery(theme.breakpoints.down('sm'));
    const [selectedId, setSelectedId] = useState(null);
    const [columnVisibility, setColumnVisibility] = useState({});
    const data = useMemo(() => rows.map((row) => ({...row, fields: flattenDetails(row.details)})), [rows]);
    const selected = data.find((row) => row.id === selectedId);
    const fields = useMemo(() => [...new Set(data.flatMap((row) => Object.keys(row.fields)))].sort(), [data]);
    const format = (value) => formatDateTime(value, timeSettings);
    const columns = useMemo(() => [
        {field: 'name', headerName: t('packet_map.name', {defaultValue: 'Transmitter'}), width: 180,
            renderCell: ({row}) => <Button size="small" onClick={() => setSelectedId(row.id)} sx={{textTransform: 'none', minWidth: 0, px: 0, maxWidth: '100%'}}>
                <Typography variant="body2" noWrap>{row.name}</Typography>
            </Button>},
        {field: 'kind', headerName: t('packet_map.type', {defaultValue: 'Type'}), width: 125,
            valueFormatter: typeLabel,
            renderCell: ({value}) => <Typography variant="caption" sx={{color: typeColor(value)}}>{typeLabel(value)}</Typography>},
        {field: 'source', headerName: t('packet_map.source', {defaultValue: 'Source'}), width: 140},
        {field: 'packet_count', headerName: t('packet_map.packets', {defaultValue: 'Packets'}), type: 'number', width: 90},
        ...['first_seen', 'last_seen'].map((field) => ({field,
            headerName: t(`packet_map.${field}`, {defaultValue: field === 'first_seen' ? 'First seen' : 'Last seen'}),
            type: 'dateTime', width: 190, valueGetter: (value) => value ? new Date(value) : null, valueFormatter: format})),
        ...['latitude', 'longitude', 'altitude'].map((field) => ({field, type: 'number', width: 125,
            headerName: t(`packet_map.${field}`, {defaultValue: {latitude: 'Latitude', longitude: 'Longitude', altitude: 'Altitude (m)'}[field]}),
            valueFormatter: (value) => value == null ? '' : value.toLocaleString(timeSettings.locale, {
                minimumFractionDigits: field === 'altitude' ? 0 : 6, maximumFractionDigits: field === 'altitude' ? 2 : 6,
            })})),
        {field: 'file_id', headerName: t('packet_map.latest_file', {defaultValue: 'Latest file'}), width: 300},
        ...fields.filter((path) => !repeatedDetails.has(path)).map((path) => {
            const example = data.find((row) => row.fields[path] != null);
            const value = example.fields[path];
            return {field: `info:${path}`, headerName: detailLabel(path, example.field_info), width: 180,
                type: typeof value === 'number' ? 'number' : typeof value === 'boolean' ? 'boolean' : 'string',
                valueGetter: (_value, row) => row.fields[path] ?? null};
        }),
    ], [data, fields, t, timeSettings.timezone, timeSettings.locale]);
    const visibility = Object.fromEntries(fields.map((path) => [`info:${path}`, visibleDetails.has(path)]));
    const detailRows = selected ? [
        [t('packet_map.type', {defaultValue: 'Type'}), typeLabel(selected.kind)],
        [t('packet_map.source', {defaultValue: 'Source'}), selected.source],
        [t('packet_map.packets', {defaultValue: 'Packets'}), selected.packet_count],
        [t('packet_map.first_seen', {defaultValue: 'First seen'}), format(selected.first_seen)],
        [t('packet_map.last_seen', {defaultValue: 'Last seen'}), format(selected.last_seen)],
        [t('packet_map.latitude', {defaultValue: 'Latitude'}), selected.latitude],
        [t('packet_map.longitude', {defaultValue: 'Longitude'}), selected.longitude],
        [t('packet_map.altitude', {defaultValue: 'Altitude (m)'}), selected.altitude],
        [t('packet_map.latest_file', {defaultValue: 'Latest file'}), selected.file_id],
        ...Object.entries(selected.fields).map(([path, value]) => [detailLabel(path, selected.field_info), value]),
    ] : [];

    return <Box sx={{height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column'}}>
        <TitleBar className={getClassNamesBasedOnGridEditing(gridEditable, ['window-title-bar'])}
            sx={{...islandTitleBarCompactSx, flexShrink: 0, justifyContent: 'space-between'}}>
            <Typography variant="subtitle2" noWrap sx={{fontWeight: 'bold'}}>{t('packet_map.transmitters', {defaultValue: 'Transmitters'})}</Typography>
            <Typography variant="caption">{rows.length}</Typography>
        </TitleBar>
        <Box sx={{flex: 1, minHeight: 0, minWidth: 0}}>
            <DataGrid rows={data} columns={columns} loading={loading} density="compact" showToolbar
                disableRowSelectionOnClick pageSizeOptions={[10, 25, 50, 100]}
                initialState={{pagination: {paginationModel: {pageSize: 25}}, sorting: {sortModel: [{field: 'last_seen', sort: 'desc'}]}}}
                columnVisibilityModel={{...visibility, ...columnVisibility}} onColumnVisibilityModelChange={setColumnVisibility}
                getRowClassName={({row}) => hiddenTypes.includes(row.kind) ? 'transmitter-hidden' : ''}
                slotProps={{basePagination: {ActionsComponent: GridPaginationActions}, loadingOverlay: {variant: 'linear-progress', noRowsVariant: 'linear-progress'}}}
                sx={{border: 0, borderRadius: 0, '& .transmitter-hidden': {opacity: 0.55}}} />
        </Box>
        <Dialog open={Boolean(selected)} onClose={() => setSelectedId(null)} fullWidth maxWidth="md" fullScreen={mobile}>
            <DialogTitle sx={{display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1, bgcolor: 'background.titleBar', borderBottom: 1, borderColor: 'divider'}}>
                <Typography variant="subtitle1" noWrap sx={{flex: 1, minWidth: 0}}>{selected?.name} · {selected && typeLabel(selected.kind)}</Typography>
                <Tooltip title={t('packet_map.close', {defaultValue: 'Close'})}>
                    <IconButton size="small" aria-label={t('packet_map.close', {defaultValue: 'Close'})} onClick={() => setSelectedId(null)}><CloseIcon /></IconButton>
                </Tooltip>
            </DialogTitle>
            <DialogContent sx={{p: 0}}>
                <Table size="small" aria-label={t('packet_map.details', {defaultValue: 'Transmitter details'})}>
                    <TableBody>{detailRows.map(([label, value], index) => <TableRow key={index}>
                        <TableCell component="th" scope="row" sx={{width: '40%', color: 'text.secondary'}}>{label}</TableCell>
                        <TableCell sx={{overflowWrap: 'anywhere'}}>{value == null ? '—' : String(value)}</TableCell>
                    </TableRow>)}</TableBody>
                </Table>
            </DialogContent>
        </Dialog>
    </Box>;
}
