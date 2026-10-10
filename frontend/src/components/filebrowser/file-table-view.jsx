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

import React from 'react';
import {
    Box,
    Typography,
    IconButton,
    Tooltip,
    Chip,
    Checkbox,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import InfoIcon from '@mui/icons-material/Info';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import CameraAltIcon from '@mui/icons-material/CameraAlt';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import AudiotrackIcon from '@mui/icons-material/Audiotrack';
import SubjectIcon from '@mui/icons-material/Subject';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import CellTowerIcon from '@mui/icons-material/CellTower';
import ImageIcon from '@mui/icons-material/Image';
import FolderIcon from '@mui/icons-material/Folder';
import BuildIcon from '@mui/icons-material/Build';
import { useTranslation } from 'react-i18next';

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function getLanguageFlag(langCode) {
    const flagMap = {
        'en': '🇬🇧', 'en-US': '🇺🇸', 'en-GB': '🇬🇧',
        'es': '🇪🇸', 'fr': '🇫🇷', 'de': '🇩🇪', 'it': '🇮🇹',
        'pt': '🇵🇹', 'pt-BR': '🇧🇷', 'pt-PT': '🇵🇹',
        'ru': '🇷🇺', 'zh': '🇨🇳', 'ja': '🇯🇵', 'ko': '🇰🇷',
        'el': '🇬🇷', 'uk': '🇺🇦', 'ar': '🇸🇦', 'tl': '🇵🇭',
        'tr': '🇹🇷', 'sk': '🇸🇰', 'hr': '🇭🇷',
    };
    return flagMap[langCode] || '🌐';
}

function FileTableRow({ item, selectionMode, isSelected, onToggleSelection, onShowDetails, onDownload, onDelete, onProcessingMenu, timezone, t }) {
    const isRecording = item.type === 'recording';
    const isAprsDecodedFile = item.type === 'decoded'
        && String(item.decoder_type || '').toLowerCase() === 'aprs';

    const formatTime = (isoDate) => {
        const date = new Date(isoDate);
        return date.toLocaleTimeString('en-US', { timeZone: timezone });
    };

    const getFileType = () => {
        if (item.type === 'recording') {
            return 'IQ Recording';
        } else if (item.type === 'decoded_folder') {
            return item.folder_kind === 'observation' ? 'Observation Folder' : 'SatDump Folder';
        } else if (item.type === 'decoded') {
            if (item.decoder_type === 'SSTV') {
                return 'SSTV Image';
            } else if (item.decoder_type === 'BPSK' || item.decoder_type === 'FSK' || item.decoder_type === 'GFSK' || item.decoder_type === 'GMSK') {
                return 'Packet';
            } else if (item.decoder_type) {
                return item.decoder_type;
            }
            return 'Decoded';
        } else if (item.type === 'audio') {
            return 'Audio';
        } else if (item.type === 'transcription') {
            return 'Transcription';
        } else if (item.type === 'snapshot') {
            return 'Waterfall';
        }
        return item.type;
    };

    const getTypeIcon = () => {
        if (item.type === 'recording') {
            return <FiberManualRecordIcon sx={{
                color: 'error.main',
                fontSize: 32,
                ...(item.recording_in_progress && {
                    animation: 'pulse 1.5s ease-in-out infinite',
                    '@keyframes pulse': {
                        '0%, 100%': { opacity: 1 },
                        '50%': { opacity: 0.4 }
                    }
                })
            }} />;
        } else if (item.type === 'decoded_folder') {
            return <FolderIcon sx={{ color: 'warning.main', fontSize: 32 }} />;
        } else if (item.type === 'decoded') {
            // Use image icon for SSTV files
            if (item.decoder_type === 'SSTV') {
                return <ImageIcon sx={{ color: 'success.main', fontSize: 32 }} />;
            }
            return <InsertDriveFileIcon sx={{ color: 'success.main', fontSize: 32 }} />;
        } else if (item.type === 'audio') {
            return <AudiotrackIcon sx={{
                color: 'info.main',
                fontSize: 32,
                ...(item.status === 'recording' && {
                    animation: 'pulse 1.5s ease-in-out infinite',
                    '@keyframes pulse': {
                        '0%, 100%': { opacity: 1 },
                        '50%': { opacity: 0.4 }
                    }
                })
            }} />;
        } else if (item.type === 'transcription') {
            return <SubjectIcon sx={{ color: 'secondary.main', fontSize: 32 }} />;
        } else {
            return <CameraAltIcon sx={{ color: 'primary.main', fontSize: 32 }} />;
        }
    };

    const getSatelliteName = () => {
        if (isRecording && item.metadata?.target_satellite_name) {
            return item.metadata.target_satellite_name;
        }
        if (item.type === 'decoded_folder' && item.satellite_name) {
            return item.satellite_name;
        }
        if (item.type === 'decoded' && item.satellite_name) {
            // Old APRS responses used satellite_name for any AX.25 source.
            // Only NORAD-backed APRS metadata belongs in this column.
            if (isAprsDecodedFile && !item.satellite_norad_id) return null;
            return item.satellite_name;
        }
        if (item.type === 'audio' && item.satellite_name) {
            return item.satellite_name;
        }
        if (item.type === 'transcription' && item.satellite_name) {
            return item.satellite_name;
        }
        return null;
    };

    const renderDetailChips = () => {
        const chips = [];

        // Recording chips
        if (isRecording) {
            if (item.metadata?.sample_rate) {
                chips.push(
                    <Chip
                        key="sample-rate"
                        label={`🎚️ ${(item.metadata.sample_rate / 1e6).toFixed(2)} MHz`}
                        size="small"
                        variant="outlined"
                        color="primary"
                        sx={{ height: '20px', fontSize: '0.65rem' }}
                    />
                );
            }
            if (item.duration) {
                chips.push(
                    <Chip
                        key="duration"
                        label={`⏱️ ${item.duration}`}
                        size="small"
                        variant="outlined"
                        color="error"
                        sx={{ height: '20px', fontSize: '0.65rem', fontFamily: 'monospace' }}
                    />
                );
            }
            if (item.metadata?.center_frequency) {
                chips.push(
                    <Chip
                        key="frequency"
                        label={`📡 ${(item.metadata.center_frequency / 1e6).toFixed(2)} MHz`}
                        size="small"
                        variant="outlined"
                        sx={{ height: '20px', fontSize: '0.65rem' }}
                    />
                );
            }
            if (item.metadata?.description) {
                chips.push(
                    <Chip
                        key="description"
                        label={`📝 ${item.metadata.description}`}
                        size="small"
                        variant="outlined"
                        sx={{ height: '20px', fontSize: '0.65rem' }}
                    />
                );
            }
            if (item.recording_in_progress) {
                chips.push(
                    <Chip
                        key="recording"
                        label={t('file_table_view.recording', { defaultValue: '🔴 Recording' })}
                        size="small"
                        color="error"
                        sx={{ height: '20px', fontSize: '0.65rem' }}
                    />
                );
            }
        }

        // Decoded folder chips
        if (item.type === 'decoded_folder') {
            if (Number(item.image_count) > 0) {
                chips.push(
                    <Chip
                        key="image-count"
                        label={`${item.image_count} images`}
                        size="small"
                        variant="outlined"
                        color="success"
                        icon={<ImageIcon />}
                        sx={{ height: '20px', fontSize: '0.65rem', '& .MuiChip-icon': { fontSize: '0.85rem' } }}
                    />
                );
            }
            if (item.pipeline && item.folder_kind !== 'observation') {
                chips.push(
                    <Chip
                        key="pipeline"
                        label={item.pipeline.toUpperCase()}
                        size="small"
                        variant="outlined"
                        color="info"
                        sx={{ height: '20px', fontSize: '0.65rem' }}
                    />
                );
            }
            if (item.folder_kind === 'observation') {
                if (item.observation_in_progress) {
                    chips.push(
                        <Chip
                            key="observation-in-progress"
                            label={t('file_table_view.in_progress', { defaultValue: 'In progress' })}
                            size="small"
                            color="warning"
                            sx={{ height: '20px', fontSize: '0.65rem' }}
                        />
                    );
                }
                chips.push(
                    <Chip
                        key="artifact-count"
                        label={`${item.artifact_count || 0} files`}
                        size="small"
                        variant="outlined"
                        color="info"
                        sx={{ height: '20px', fontSize: '0.65rem' }}
                    />
                );
            }
        }

        // Decoded chips
        if (item.type === 'decoded') {
            if (isAprsDecodedFile && item.source_callsign) {
                chips.push(
                    <Chip
                        key="source-callsign"
                        label={item.source_callsign}
                        size="small"
                        variant="outlined"
                        color="secondary"
                        icon={<CellTowerIcon />}
                        sx={{ height: '20px', fontSize: '0.65rem', '& .MuiChip-icon': { fontSize: '0.85rem' } }}
                    />
                );
            }
            if (item.decoder_type) {
                chips.push(
                    <Chip
                        key="decoder"
                        label={`🔧 ${item.decoder_type}`}
                        size="small"
                        variant="outlined"
                        color="success"
                        sx={{ height: '20px', fontSize: '0.65rem' }}
                    />
                );
            }
            if (item.decoder_mode) {
                chips.push(
                    <Chip
                        key="mode"
                        label={`📡 ${item.decoder_mode}`}
                        size="small"
                        variant="outlined"
                        sx={{ height: '20px', fontSize: '0.65rem' }}
                    />
                );
            }
            if (item.baudrate) {
                chips.push(
                    <Chip
                        key="baudrate"
                        label={`⚡ ${item.baudrate} bd`}
                        size="small"
                        variant="outlined"
                        sx={{ height: '20px', fontSize: '0.65rem' }}
                    />
                );
            }
            if (item.width && item.height) {
                chips.push(
                    <Chip
                        key="dimensions"
                        label={`📐 ${item.width}×${item.height}`}
                        size="small"
                        variant="outlined"
                        color="primary"
                        sx={{ height: '20px', fontSize: '0.65rem' }}
                    />
                );
            }
            if (item.frequency_mhz) {
                chips.push(
                    <Chip
                        key="frequency"
                        label={`📻 ${item.frequency_mhz.toFixed(2)} MHz`}
                        size="small"
                        variant="outlined"
                        sx={{ height: '20px', fontSize: '0.65rem' }}
                    />
                );
            }
            if (item.transmitter_description) {
                chips.push(
                    <Chip
                        key="transmitter"
                        label={`🛰️ ${item.transmitter_description}`}
                        size="small"
                        variant="outlined"
                        color="secondary"
                        sx={{ height: '20px', fontSize: '0.65rem' }}
                    />
                );
            }
        }

        // Audio chips
        if (item.type === 'audio') {
            if (item.vfo_number) {
                chips.push(
                    <Chip
                        key="vfo"
                        label={`📻 VFO ${item.vfo_number}`}
                        size="small"
                        variant="outlined"
                        sx={{ height: '20px', fontSize: '0.65rem' }}
                    />
                );
            }
            if (item.demodulator_type) {
                chips.push(
                    <Chip
                        key="demod"
                        label={`🎚️ ${item.demodulator_type.toUpperCase()}`}
                        size="small"
                        variant="outlined"
                        color="info"
                        sx={{ height: '20px', fontSize: '0.65rem' }}
                    />
                );
            }
            if (item.center_frequency) {
                chips.push(
                    <Chip
                        key="frequency"
                        label={`📡 ${(item.center_frequency / 1e6).toFixed(2)} MHz`}
                        size="small"
                        variant="outlined"
                        sx={{ height: '20px', fontSize: '0.65rem' }}
                    />
                );
            }
            if (item.duration_seconds) {
                const mins = Math.floor(item.duration_seconds / 60);
                const secs = Math.floor(item.duration_seconds % 60);
                chips.push(
                    <Chip
                        key="duration"
                        label={`⏱️ ${mins}:${String(secs).padStart(2, '0')}`}
                        size="small"
                        variant="outlined"
                        color="error"
                        sx={{ height: '20px', fontSize: '0.65rem', fontFamily: 'monospace' }}
                    />
                );
            }
            if (item.status === 'recording') {
                chips.push(
                    <Chip
                        key="recording"
                        label={t('file_table_view.recording', { defaultValue: '🔴 Recording' })}
                        size="small"
                        color="error"
                        sx={{ height: '20px', fontSize: '0.65rem' }}
                    />
                );
            }
        }

        // Snapshot chips
        if (item.type === 'snapshot') {
            if (item.width && item.height) {
                chips.push(
                    <Chip
                        key="dimensions"
                        label={`📐 ${item.width}×${item.height}`}
                        size="small"
                        variant="outlined"
                        color="primary"
                        sx={{ height: '20px', fontSize: '0.65rem' }}
                    />
                );
            }
        }

        // Transcription chips
        if (item.type === 'transcription') {
            if (item.vfo_number) {
                chips.push(
                    <Chip
                        key="vfo"
                        label={`📻 VFO ${item.vfo_number}`}
                        size="small"
                        variant="outlined"
                        sx={{ height: '20px', fontSize: '0.65rem' }}
                    />
                );
            }
            if (item.provider) {
                chips.push(
                    <Chip
                        key="provider"
                        label={`🤖 ${item.provider}`}
                        size="small"
                        variant="outlined"
                        color="secondary"
                        sx={{ height: '20px', fontSize: '0.65rem' }}
                    />
                );
            }
            if (item.language) {
                chips.push(
                    <Chip
                        key="language"
                        label={`${getLanguageFlag(item.language)} ${item.language.toUpperCase()}`}
                        size="small"
                        variant="outlined"
                        sx={{ height: '20px', fontSize: '0.65rem' }}
                    />
                );
            }
            if (item.translate_to) {
                chips.push(
                    <Chip
                        key="translate"
                        label={`→ ${getLanguageFlag(item.translate_to)} ${item.translate_to.toUpperCase()}`}
                        size="small"
                        variant="outlined"
                        color="info"
                        sx={{ height: '20px', fontSize: '0.65rem' }}
                    />
                );
            }
        }

        return chips;
    };

    const satelliteName = getSatelliteName();
    const detailChips = renderDetailChips();

    return (
        <TableRow
            hover
            selected={isSelected}
            // In normal mode, a row is the same entry point as its Details action.
            // Selection mode deliberately retains row-click selection instead.
            onClick={() => selectionMode ? onToggleSelection(item) : onShowDetails(item)}
            sx={{
                cursor: 'pointer',
                ...(item.recording_in_progress && {
                    backgroundColor: 'rgba(211, 47, 47, 0.08)',
                }),
                '&:hover': selectionMode ? {} : {
                    backgroundColor: item.recording_in_progress ? 'rgba(211, 47, 47, 0.12)' : 'action.hover',
                },
                '& > td': {
                    borderBottom: '1px solid',
                    borderBottomColor: 'divider',
                },
                '&:last-child > td': {
                    borderBottom: 'none',
                }
            }}
        >
            {selectionMode && (
                <TableCell padding="checkbox" sx={{ verticalAlign: 'middle' }} onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                        checked={isSelected}
                        onChange={() => onToggleSelection(item)}
                    />
                </TableCell>
            )}
            <TableCell sx={{ width: 50 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Tooltip title={item.type}>
                        {getTypeIcon()}
                    </Tooltip>
                </Box>
            </TableCell>
            <TableCell sx={{ verticalAlign: 'middle' }}>
                <Box>
                    <Tooltip title={item.displayName}>
                        <Typography
                            variant="body2"
                            sx={{
                                fontFamily: 'monospace',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {item.displayName}
                        </Typography>
                    </Tooltip>
                    {detailChips.length > 0 && (
                        <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5, flexWrap: 'wrap' }}>
                            {detailChips}
                        </Box>
                    )}
                </Box>
            </TableCell>
            <TableCell align="right" sx={{ verticalAlign: 'middle' }}>
                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    {formatBytes(item.data_size || item.size)}
                </Typography>
            </TableCell>
            <TableCell sx={{ verticalAlign: 'middle' }}>
                <Typography variant="body2">
                    {getFileType()}
                </Typography>
            </TableCell>
            <TableCell sx={{ verticalAlign: 'middle' }}>
                {satelliteName ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                        <SatelliteAltIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                        <Typography variant="body2">{satelliteName}</Typography>
                    </Box>
                ) : (
                    <Typography variant="body2" color="text.disabled">—</Typography>
                )}
            </TableCell>
            <TableCell sx={{ verticalAlign: 'middle' }}>
                <Typography variant="body2">
                    {formatTime(item.modified || item.created)}
                </Typography>
            </TableCell>
            <TableCell align="right" onClick={(e) => e.stopPropagation()} sx={{ verticalAlign: 'middle' }}>
                <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end', alignItems: 'center' }}>
                    <Tooltip title={t('actions.view_details', 'View Details')}>
                        <IconButton
                            size="small"
                            onClick={() => onShowDetails(item)}
                        >
                            <InfoIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={t('actions.download', 'Download')}>
                        <IconButton
                            size="small"
                            onClick={() => onDownload(item)}
                        >
                            <DownloadIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    {item.type === 'recording' && onProcessingMenu && (
                        <Tooltip title={t('file_table_view.recording_actions', { defaultValue: 'Recording Actions' })}>
                            <IconButton
                                size="small"
                                color="primary"
                                onClick={(event) => onProcessingMenu(event, item)}
                            >
                                <BuildIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    )}
                    <Tooltip title={t('actions.delete', 'Delete')}>
                        <IconButton
                            size="small"
                            color="error"
                            onClick={() => onDelete(item)}
                        >
                            <DeleteIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Box>
            </TableCell>
        </TableRow>
    );
}

export default function FileTableView({
    filesByDay,
    selectionMode,
    selectedItems,
    onToggleSelection,
    onShowDetails,
    onDownload,
    onDelete,
    onProcessingMenu,
    timezone,
}) {
    const { t } = useTranslation('filebrowser');

    return (
        <Box>
            {filesByDay.map((dayGroup) => {
                return (
                    <Box key={dayGroup.dateKey} sx={{ mb: 3 }}>
                        <Box sx={{
                            p: 2,
                            backgroundColor: 'action.hover',
                            borderRadius: '4px 4px 0 0',
                            display: 'flex',
                            alignItems: 'center'
                        }}>
                            <Typography variant="h6" sx={{ fontWeight: 600 }}>
                                {dayGroup.dateKey}
                            </Typography>
                            <Chip
                                label={`${dayGroup.files.length} file${dayGroup.files.length !== 1 ? 's' : ''}`}
                                size="small"
                                sx={{ ml: 2 }}
                            />
                        </Box>
                        <TableContainer component={Paper} elevation={0}>
                            <Table size="small">
                                <TableHead>
                                    <TableRow>
                                        {selectionMode && <TableCell padding="checkbox" sx={{ width: 50 }}></TableCell>}
                                        <TableCell sx={{ width: 50 }}></TableCell>
                                        <TableCell>{t('file_table_view.name', { defaultValue: 'Name' })}</TableCell>
                                        <TableCell align="right">{t('file_table_view.size', { defaultValue: 'Size' })}</TableCell>
                                        <TableCell>{t('file_table_view.type', { defaultValue: 'Type' })}</TableCell>
                                        <TableCell>{t('file_table_view.satellite', { defaultValue: '🛰️ Satellite' })}</TableCell>
                                        <TableCell>{t('file_table_view.time', { defaultValue: 'Time' })}</TableCell>
                                        <TableCell align="right">{t('file_table_view.actions', { defaultValue: 'Actions' })}</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {dayGroup.files.map((item) => {
                                        const key = item.id;
                                        const isSelected = selectedItems.includes(item.id);

                                        return (
                                            <FileTableRow
                                                key={key}
                                                item={item}
                                                selectionMode={selectionMode}
                                                isSelected={isSelected}
                                                onToggleSelection={onToggleSelection}
                                                onShowDetails={onShowDetails}
                                                onDownload={onDownload}
                                                onDelete={onDelete}
                                                onProcessingMenu={onProcessingMenu}
                                                timezone={timezone}
                                                t={t}
                                            />
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    </Box>
                );
            })}
        </Box>
    );
}
