/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

import React, { useId, useState } from 'react';
import {
    Box, Typography, IconButton, Tooltip, Chip, Checkbox, Table, TableBody,
    TableCell, TableContainer, TableHead, TableRow, Paper, Menu, MenuItem,
    ListItemIcon, ListItemText,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import InfoIcon from '@mui/icons-material/Info';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import AudiotrackIcon from '@mui/icons-material/Audiotrack';
import SubjectIcon from '@mui/icons-material/Subject';
import ImageIcon from '@mui/icons-material/Image';
import BuildIcon from '@mui/icons-material/Build';
import { useTranslation } from 'react-i18next';
import FileSearchMatch from './file-search-match.jsx';
import { CaptureBundleIcon, getCaptureBundleType } from './capture-bundle-type.jsx';
import {FILE_TABLE_COLUMNS, getFileTableColumnLabel, useFileTableColumns} from './file-table-columns.js';
import {
    getFileBrowserDate, isFileBrowserDateApproximate,
    getFileBrowserSource, getFileBrowserSummary,
} from './filebrowser-display-item.js';

function formatBytes(bytes) {
    if (bytes == null || !Number.isFinite(Number(bytes)) || Number(bytes) < 0) return '—';
    if (Number(bytes) === 0) return '0 Bytes';
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const index = Math.min(Math.floor(Math.log(Number(bytes)) / Math.log(1024)), sizes.length - 1);
    return Math.round(Number(bytes) / Math.pow(1024, index) * 100) / 100 + ' ' + sizes[index];
}

function formatSignalValue(value, units) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return '—';
    const [scale, unit] = units.find(([scale]) => number >= scale) || units[units.length - 1];
    return `${Number((number / scale).toFixed(6))} ${unit}`;
}

function getFileType(item, t) {
    const bundleType = getCaptureBundleType(item);
    if (bundleType) return t('bundle_types.' + item.folder_kind, {defaultValue: bundleType.label});
    const types = {
        recording: 'IQ Recording',
        audio: 'Audio',
        transcription: 'Transcription',
        snapshot: 'Waterfall',
    };
    if (types[item.type]) return types[item.type];
    if (item.type === 'decoded_folder') {
        return item.folder_kind === 'observation' ? 'Observation Folder' : 'SatDump Folder';
    }
    if (item.type !== 'decoded') return item.type;
    if (item.decoder_type === 'SSTV') return 'SSTV Image';
    if (['BPSK', 'FSK', 'GFSK', 'GMSK'].includes(item.decoder_type)) return 'Packet';
    return item.decoder_type || 'Decoded';
}

function FileTypeIcon({ item }) {
    const sx = {fontSize: 24};
    if (item.type === 'decoded_folder') return <CaptureBundleIcon item={item} sx={sx} />;
    if (item.type === 'recording') return <FiberManualRecordIcon sx={{...sx, color: 'error.main'}} />;
    if (item.type === 'audio') return <AudiotrackIcon sx={{...sx, color: 'info.main'}} />;
    if (item.type === 'transcription') return <SubjectIcon sx={{...sx, color: 'secondary.main'}} />;
    if (item.type === 'snapshot') return <CameraAltIcon sx={{...sx, color: 'primary.main'}} />;
    return item.decoder_type === 'SSTV'
        ? <ImageIcon sx={{...sx, color: 'success.main'}} />
        : <InsertDriveFileIcon sx={{...sx, color: 'success.main'}} />;
}

function FileTime({ item, sortBy, timezone, t }) {
    const date = getFileBrowserDate(item, sortBy);
    const approximate = isFileBrowserDateApproximate(item, sortBy);
    return (
        <Tooltip title={approximate ? t('dates.approximate', 'Capture date estimated from file modification time') : ''}>
            <Typography variant="body2" noWrap sx={{fontVariantNumeric: 'tabular-nums'}}>
                {approximate && '≈ '}
                {date ? new Date(date).toLocaleTimeString('en-US', {timeZone: timezone}) : '—'}
            </Typography>
        </Tooltip>
    );
}

function FileTableRow({
    item, sortBy, selectionMode, isSelected, onToggleSelection, onShowDetails,
    onOpenActions, actionsOpen, menuId, timezone, columns, columnVisibility, t,
}) {
    const name = item.displayName || item.name || item.filename || item.foldername;
    const type = getFileType(item, t);
    const source = getFileBrowserSource(item);
    // Grouped captures can already use the full source identity as their name.
    const distinctSource = source && source !== name ? source : '';
    const isRecording = item.recording_in_progress || (item.type === 'audio' && item.status === 'recording');
    const activityLabel = isRecording || item.observation_in_progress
        ? t('file_table_view.' + (isRecording ? 'recording' : 'in_progress'))
        : '';
    const iconLabel = activityLabel ? `${type} · ${activityLabel}` : type;
    const activate = () => selectionMode ? onToggleSelection(item) : onShowDetails(item);
    const textCellSx = {verticalAlign: 'middle', overflow: 'hidden'};
    // Audio has a tuned VFO frequency; IQ recordings use their capture center frequency.
    const frequency = item.frequency_hz ?? item.vfo_frequency ?? item.metadata?.vfo_frequency
        ?? item.center_frequency ?? item.metadata?.center_frequency
        ?? (item.frequency_mhz == null ? null : Number(item.frequency_mhz) * 1e6);
    const values = {
        type,
        source: distinctSource || '—',
        frequency: formatSignalValue(frequency, [[1e9, 'GHz'], [1e6, 'MHz'], [1e3, 'kHz'], [1, 'Hz']]),
        sampleRate: formatSignalValue(item.sample_rate ?? item.metadata?.sample_rate, [[1e6, 'Msps'], [1e3, 'ksps'], [1, 'sps']]),
        summary: getFileBrowserSummary(item, t) || '—',
        size: formatBytes(item.data_size ?? item.size),
    };

    return (
        <TableRow
            hover
            selected={isSelected}
            tabIndex={0}
            onClick={activate}
            onKeyDown={(event) => {
                // Nested controls keep their own keyboard behavior.
                if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) {
                    event.preventDefault();
                    activate();
                }
            }}
            sx={{
                cursor: 'pointer',
                ...(isRecording && {backgroundColor: 'rgba(211, 47, 47, 0.08)'}),
                '&:focus-visible': {outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2},
                '& > td': {borderBottom: '1px solid', borderBottomColor: 'divider'},
                '&:last-child > td': {borderBottom: 'none'},
            }}
        >
            {selectionMode && (
                <TableCell padding="checkbox" onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                        checked={isSelected}
                        onChange={() => onToggleSelection(item)}
                        slotProps={{input: {'aria-label': t('file_table_view.select_item', {name})}}}
                        sx={{width: 44, height: 44}}
                    />
                </TableCell>
            )}
            <TableCell sx={textCellSx}>
                <Box sx={{display: 'flex', alignItems: 'center', gap: 1, minWidth: 0}}>
                    <Tooltip title={iconLabel}>
                        <Box role="img" aria-label={iconLabel} sx={{display: 'flex', flexShrink: 0, position: 'relative'}}>
                            <FileTypeIcon item={item} />
                            {/* Overlay activity on the icon so active rows keep the same text layout. */}
                            {activityLabel && (
                                <Box component="span" aria-hidden="true" sx={{
                                    position: 'absolute', bottom: -1, right: -1,
                                    width: 12, height: 12, boxSizing: 'border-box',
                                    borderRadius: '50%', border: '2px solid', borderColor: 'background.paper',
                                    backgroundColor: isRecording ? 'error.main' : 'warning.main',
                                    animation: 'file-activity-pulse 1.5s ease-in-out infinite',
                                    '@keyframes file-activity-pulse': {
                                        '0%, 100%': {opacity: 1},
                                        '50%': {opacity: 0.4},
                                    },
                                    '@media (prefers-reduced-motion: reduce)': {animation: 'none'},
                                }} />
                            )}
                        </Box>
                    </Tooltip>
                    <Box sx={{minWidth: 0, flex: 1}}>
                        <Tooltip title={name}>
                            <Typography variant="body2" noWrap sx={{fontFamily: 'monospace'}}>{name}</Typography>
                        </Tooltip>
                        {!columns.type && columnVisibility.type !== false && (
                            <Typography variant="caption" color="text.secondary" noWrap display="block">{type}</Typography>
                        )}
                        {!columns.source && columnVisibility.source !== false && distinctSource && (
                            <Typography variant="caption" color="text.secondary" noWrap display="block" title={source}>
                                {distinctSource}
                            </Typography>
                        )}
                        {!columns.time && columnVisibility.time !== false && <FileTime item={item} sortBy={sortBy} timezone={timezone} t={t} />}
                        <FileSearchMatch item={item} />
                    </Box>
                </Box>
            </TableCell>
            {FILE_TABLE_COLUMNS.filter(({key}) => columns[key]).map(({key, align}) => (
                <TableCell key={key} align={align} sx={textCellSx}>
                    {key === 'time' ? <FileTime item={item} sortBy={sortBy} timezone={timezone} t={t} /> : (
                        <Typography variant="body2" noWrap={key !== 'summary'} title={values[key]} sx={{
                            ...(key === 'summary' && {overflowWrap: 'anywhere'}),
                            ...(['size', 'frequency', 'sampleRate'].includes(key) && {fontFamily: 'monospace'}),
                        }}>{values[key]}</Typography>
                    )}
                </TableCell>
            ))}
            <TableCell align="right" onClick={(event) => event.stopPropagation()} sx={{p: 0.5}}>
                <IconButton
                    aria-label={t('file_table_view.actions_for', {name})}
                    aria-haspopup="menu"
                    aria-expanded={actionsOpen ? true : undefined}
                    aria-controls={actionsOpen ? menuId : undefined}
                    onClick={(event) => onOpenActions(event, item)}
                    sx={{width: 44, height: 44}}
                >
                    <MoreVertIcon />
                </IconButton>
            </TableCell>
        </TableRow>
    );
}

export default function FileTableView({
    filesByDay,
    sortBy = 'latest_activity',
    selectionMode,
    selectedItems = [],
    onToggleSelection,
    onShowDetails,
    onDownload,
    onDelete,
    onProcessingMenu,
    timezone,
    columnVisibility = {},
    headerActions,
}) {
    const { t } = useTranslation('filebrowser');
    const columns = useFileTableColumns(columnVisibility);
    const visibleColumns = FILE_TABLE_COLUMNS.filter(({key}) => columns[key]);
    const minWidth = 220 + 60 + (selectionMode ? 52 : 0)
        + visibleColumns.reduce((width, column) => width + column.width, 0);
    const [menu, setMenu] = useState(null);
    const menuId = useId();
    const openActions = (event, item) => setMenu({anchorEl: event.currentTarget, item});
    const runAction = (callback) => {
        const item = menu.item;
        setMenu(null);
        callback(item);
    };

    return (
        <Box sx={{minWidth: 0, width: '100%'}}>
            {filesByDay.map((dayGroup, groupIndex) => (
                <Box key={dayGroup.dateKey} sx={{mb: 3, minWidth: 0}}>
                    <Box sx={{
                        p: {xs: 1.5, sm: 2},
                        backgroundColor: 'action.hover',
                        borderRadius: '4px 4px 0 0',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        minWidth: 0,
                    }}>
                        <Typography variant="h6" noWrap sx={{fontWeight: 600, minWidth: 0}}>
                            {dayGroup.dateKey}
                        </Typography>
                        <Chip label={t('file_table_view.files', {count: dayGroup.files.length})} size="small" sx={{flexShrink: 0}} />
                        {/* One shared control configures every date group in the listing. */}
                        {groupIndex === 0 && headerActions && (
                            <Box sx={{ml: 'auto', display: 'flex', flexShrink: 0}}>{headerActions}</Box>
                        )}
                    </Box>
                    <TableContainer component={Paper} elevation={0}>
                        {/* Explicitly enabled columns scroll inside the table instead of widening the page. */}
                        <Table size="small" aria-label={dayGroup.dateKey} sx={{
                            tableLayout: 'fixed', width: '100%', minWidth,
                            '& th, & td': {px: {xs: 1, sm: 1.5}},
                            '& th:last-child, & td:last-child, & .MuiTableCell-paddingCheckbox': {px: 0.5},
                            '& th': {overflowWrap: 'anywhere'},
                        }}>
                            <colgroup>
                                {selectionMode && <col style={{width: 52}} />}
                                <col />
                                {visibleColumns.map(({key, width}) => <col key={key} style={{width}} />)}
                                <col style={{width: 60}} />
                            </colgroup>
                            <TableHead>
                                <TableRow>
                                    {selectionMode && <TableCell padding="checkbox" />}
                                    <TableCell>{t('file_table_view.name', 'Name')}</TableCell>
                                    {visibleColumns.map(column => <TableCell key={column.key} align={column.align}>
                                        {getFileTableColumnLabel(column, sortBy, t)}
                                    </TableCell>)}
                                    <TableCell align="right" aria-label={t('file_table_view.actions', 'Actions')} />
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {dayGroup.files.map((item) => (
                                    <FileTableRow
                                        key={item.id}
                                        item={item}
                                        sortBy={sortBy}
                                        selectionMode={selectionMode}
                                        isSelected={selectedItems.includes(item.id)}
                                        onToggleSelection={onToggleSelection}
                                        onShowDetails={onShowDetails}
                                        onOpenActions={openActions}
                                        actionsOpen={menu?.item.id === item.id}
                                        menuId={menuId}
                                        timezone={timezone}
                                        columns={columns}
                                        columnVisibility={columnVisibility}
                                        t={t}
                                    />
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Box>
            ))}
            <Menu
                id={menuId}
                anchorEl={menu?.anchorEl}
                open={Boolean(menu)}
                onClose={() => setMenu(null)}
                slotProps={{list: {'aria-label': menu ? t('file_table_view.actions_for', {name: menu.item.displayName || menu.item.name || menu.item.filename || menu.item.foldername}) : undefined}}}
            >
                <MenuItem onClick={() => runAction(onShowDetails)}>
                    <ListItemIcon><InfoIcon fontSize="small" /></ListItemIcon>
                    <ListItemText>{t('actions.view_details', 'View Details')}</ListItemText>
                </MenuItem>
                <MenuItem onClick={() => runAction(onDownload)}>
                    <ListItemIcon><DownloadIcon fontSize="small" /></ListItemIcon>
                    <ListItemText>{t('actions.download', 'Download')}</ListItemText>
                </MenuItem>
                {menu?.item.type === 'recording' && onProcessingMenu && (
                    <MenuItem onClick={() => {
                        // The row button stays mounted when this menu closes, so the
                        // existing processing menu receives a stable anchor element.
                        const {anchorEl, item} = menu;
                        setMenu(null);
                        onProcessingMenu({currentTarget: anchorEl}, item);
                    }}>
                        <ListItemIcon><BuildIcon fontSize="small" /></ListItemIcon>
                        <ListItemText>{t('file_table_view.recording_actions', 'Recording Actions')}</ListItemText>
                    </MenuItem>
                )}
                <MenuItem onClick={() => runAction(onDelete)} sx={{color: 'error.main'}}>
                    <ListItemIcon><DeleteIcon fontSize="small" color="error" /></ListItemIcon>
                    <ListItemText>{t('actions.delete', 'Delete')}</ListItemText>
                </MenuItem>
            </Menu>
        </Box>
    );
}
