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
    ListItemIcon, ListItemText, useMediaQuery, useTheme,
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
import {
    getFileBrowserDate, getFileBrowserDateField, isFileBrowserDateApproximate,
    getFileBrowserSource, getFileBrowserSummary,
} from './filebrowser-display-item.js';

function formatBytes(bytes) {
    if (bytes == null || !Number.isFinite(Number(bytes)) || Number(bytes) < 0) return '—';
    if (Number(bytes) === 0) return '0 Bytes';
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const index = Math.min(Math.floor(Math.log(Number(bytes)) / Math.log(1024)), sizes.length - 1);
    return Math.round(Number(bytes) / Math.pow(1024, index) * 100) / 100 + ' ' + sizes[index];
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
    onOpenActions, actionsOpen, menuId, timezone, columns, t,
}) {
    const name = item.displayName || item.name || item.filename || item.foldername;
    const type = getFileType(item, t);
    const source = getFileBrowserSource(item);
    // Grouped captures can already use the full source identity as their name.
    const distinctSource = source && source !== name ? source : '';
    const isRecording = item.recording_in_progress || (item.type === 'audio' && item.status === 'recording');
    const activate = () => selectionMode ? onToggleSelection(item) : onShowDetails(item);
    const textCellSx = {verticalAlign: 'middle', overflow: 'hidden'};

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
                <Box sx={{display: 'flex', alignItems: 'flex-start', gap: 1, minWidth: 0}}>
                    <Tooltip title={type}>
                        <Box sx={{display: 'flex', flexShrink: 0, mt: 0.25}}><FileTypeIcon item={item} /></Box>
                    </Tooltip>
                    <Box sx={{minWidth: 0, flex: 1}}>
                        <Tooltip title={name}>
                            <Typography variant="body2" noWrap sx={{fontFamily: 'monospace'}}>{name}</Typography>
                        </Tooltip>
                        {!columns.type && (
                            <Typography variant="caption" color="text.secondary" noWrap display="block">{type}</Typography>
                        )}
                        {!columns.source && distinctSource && (
                            <Typography variant="caption" color="text.secondary" noWrap display="block" title={source}>
                                {distinctSource}
                            </Typography>
                        )}
                        {!columns.time && <FileTime item={item} sortBy={sortBy} timezone={timezone} t={t} />}
                        {(isRecording || item.observation_in_progress) && (
                            <Chip
                                label={t('file_table_view.' + (isRecording ? 'recording' : 'in_progress'))}
                                color={isRecording ? 'error' : 'warning'}
                                size="small"
                                sx={{mt: 0.5, maxWidth: '100%', height: 20, fontSize: '0.65rem'}}
                            />
                        )}
                        <FileSearchMatch item={item} />
                    </Box>
                </Box>
            </TableCell>
            {columns.type && (
                <TableCell sx={textCellSx}>
                    <Typography variant="body2" noWrap title={type}>{type}</Typography>
                </TableCell>
            )}
            {columns.source && (
                <TableCell sx={textCellSx}>
                    <Typography variant="body2" noWrap title={distinctSource}>{distinctSource || '—'}</Typography>
                </TableCell>
            )}
            {columns.summary && (
                <TableCell sx={textCellSx}>
                    <Typography variant="body2" sx={{overflowWrap: 'anywhere'}}>
                        {getFileBrowserSummary(item, t) || '—'}
                    </Typography>
                </TableCell>
            )}
            {columns.size && (
                <TableCell align="right" sx={textCellSx}>
                    <Typography variant="body2" noWrap sx={{fontFamily: 'monospace'}}>
                        {formatBytes(item.data_size ?? item.size)}
                    </Typography>
                </TableCell>
            )}
            {columns.time && (
                <TableCell sx={textCellSx}>
                    <FileTime item={item} sortBy={sortBy} timezone={timezone} t={t} />
                </TableCell>
            )}
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
}) {
    const { t } = useTranslation('filebrowser');
    const theme = useTheme();
    const wide = useMediaQuery(theme.breakpoints.up('lg'));
    const medium = useMediaQuery(theme.breakpoints.up('md'));
    const small = useMediaQuery(theme.breakpoints.up('sm'));
    const columns = {type: medium, source: small, summary: wide, size: wide, time: small};
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
            {filesByDay.map((dayGroup) => (
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
                    </Box>
                    <TableContainer component={Paper} elevation={0}>
                        {/* Fixed layout lets long names shrink instead of widening the mobile page. */}
                        <Table size="small" aria-label={dayGroup.dateKey} sx={{
                            tableLayout: 'fixed', width: '100%',
                            '& th, & td': {px: {xs: 1, sm: 1.5}},
                            '& th:last-child, & td:last-child, & .MuiTableCell-paddingCheckbox': {px: 0.5},
                            '& th': {overflowWrap: 'anywhere'},
                        }}>
                            <colgroup>
                                {selectionMode && <col style={{width: 52}} />}
                                <col />
                                {columns.type && <col style={{width: wide ? '13%' : '17%'}} />}
                                {columns.source && <col style={{width: wide ? '18%' : '25%'}} />}
                                {columns.summary && <col style={{width: '16%'}} />}
                                {columns.size && <col style={{width: '10%'}} />}
                                {columns.time && <col style={{width: wide ? '13%' : '23%'}} />}
                                <col style={{width: 60}} />
                            </colgroup>
                            <TableHead>
                                <TableRow>
                                    {selectionMode && <TableCell padding="checkbox" />}
                                    <TableCell>{t('file_table_view.name', 'Name')}</TableCell>
                                    {columns.type && <TableCell>{t('file_table_view.type', 'Type')}</TableCell>}
                                    {columns.source && <TableCell>{t('file_table_view.source', 'Source')}</TableCell>}
                                    {columns.summary && <TableCell>{t('file_table_view.summary', 'Summary')}</TableCell>}
                                    {columns.size && <TableCell align="right">{t('file_table_view.size', 'Size')}</TableCell>}
                                    {columns.time && <TableCell>{t('sort.' + getFileBrowserDateField(sortBy))}</TableCell>}
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
