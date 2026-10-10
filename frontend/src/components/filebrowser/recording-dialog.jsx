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

import React, { useMemo } from 'react';
import {
    Box,
    Typography,
    Chip,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    IconButton,
    Stack,
    Tooltip,
} from '@mui/material';
import GraphicEqIcon from '@mui/icons-material/GraphicEq';
import DownloadIcon from '@mui/icons-material/Download';
import DescriptionIcon from '@mui/icons-material/Description';
import ImageIcon from '@mui/icons-material/Image';
import { useSelector } from 'react-redux';
import WaterfallViewer from './waterfall-viewer.jsx';
import { useTranslation } from 'react-i18next';

function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes < 0) return 'Unknown size';
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function formatDimensions(width, height) {
    return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
        ? `${width}×${height}`
        : null;
}

function buildAssociatedFiles(recording) {
    if (!recording) return [];

    const files = [];

    if (recording.data_file) {
        files.push({
            key: 'data',
            type: 'IQ Data',
            filename: recording.data_file,
            size: recording.data_size,
            url: recording.download_urls?.data,
        });
    }

    if (recording.meta_file) {
        files.push({
            key: 'metadata',
            type: 'Metadata',
            filename: recording.meta_file,
            size: recording.meta_size,
            url: recording.download_urls?.meta,
        });
    }

    if (recording.snapshot) {
        files.push({
            key: 'snapshot',
            type: 'Waterfall Snapshot',
            filename: recording.snapshot.filename,
            size: recording.snapshot.size,
            url: recording.snapshot.url,
            previewUrl: recording.snapshot.thumbnail_url || recording.snapshot.url,
            dimensions: formatDimensions(recording.snapshot.width, recording.snapshot.height),
        });

        const thumbnail = recording.snapshot.thumbnail;
        if (thumbnail || recording.snapshot.thumbnail_url) {
            files.push({
                key: 'thumbnail',
                type: 'Thumbnail',
                filename: thumbnail?.filename || 'Generated thumbnail',
                size: thumbnail?.size,
                url: thumbnail?.url || recording.snapshot.thumbnail_url,
                previewUrl: thumbnail?.url || recording.snapshot.thumbnail_url,
                dimensions: formatDimensions(thumbnail?.width, thumbnail?.height),
            });
        }
    }

    return files;
}

export default function RecordingDialog({ open, onClose, recording }) {
    const { t } = useTranslation('filebrowser');
    // Get timezone preference
    const timezone = useSelector((state) => {
        const tzPref = state.preferences?.preferences?.find(p => p.name === 'timezone');
        return tzPref?.value || 'UTC';
    });

    // Timezone-aware date formatting function
    const formatDate = (isoDate) => {
        const date = new Date(isoDate);
        return date.toLocaleString('en-US', { timeZone: timezone });
    };

    const sectionSx = {
        p: 2,
        mb: 2,
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1.5,
        bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50'),
    };

    const rowSx = {
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: '160px 1fr' },
        gap: { xs: 0.5, sm: 2 },
        py: 0.5,
    };

    const associatedFiles = useMemo(() => buildAssociatedFiles(recording), [recording]);

    const formatFrequency = (frequencyHz) => {
        if (frequencyHz === null || frequencyHz === undefined) return '';
        if (frequencyHz >= 1e9) {
            return `${(frequencyHz / 1e9).toFixed(6)} GHz`;
        }
        if (frequencyHz >= 1e6) {
            return `${(frequencyHz / 1e6).toFixed(6)} MHz`;
        }
        if (frequencyHz >= 1e3) {
            return `${(frequencyHz / 1e3).toFixed(3)} kHz`;
        }
        return `${frequencyHz.toFixed(0)} Hz`;
    };
    if (!recording) return null;

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="lg"
            fullWidth
            PaperProps={{
                sx: {
                    bgcolor: 'background.paper',
                    border: (theme) => `1px solid ${theme.palette.divider}`,
                    borderRadius: 2,
                },
            }}
        >
            <DialogTitle
                sx={{
                    bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100'),
                    borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                    py: 2.5,
                    px: 3,
                }}
            >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="h6">{t('recording_dialog.recording_details', { defaultValue: 'Recording Details' })}</Typography>
                    <Box>
                        {recording?.snapshot?.width && recording?.snapshot?.height && (
                            <Chip
                                label={`${recording.snapshot.width}×${recording.snapshot.height}`}
                                size="small"
                                sx={{ mr: 1, height: '20px', fontSize: '0.65rem', '& .MuiChip-label': { px: 0.75 } }}
                            />
                        )}
                        <Chip label={formatBytes(recording?.data_size || 0)} size="small" sx={{ height: '20px', fontSize: '0.65rem', '& .MuiChip-label': { px: 0.75 } }} />
                    </Box>
                </Box>
            </DialogTitle>
            <DialogContent
                sx={{
                    bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.36)' : 'grey.100'),
                    px: 3,
                    py: 3,
                }}
            >
                {recording && (
                    <Box sx={{ mt: 3 }}>
                        {recording.snapshot && (
                            <WaterfallViewer
                                src={recording.snapshot.url}
                                alt={recording.name}
                                centerFrequency={recording?.metadata?.center_frequency}
                                sampleRate={recording?.metadata?.sample_rate}
                                startTime={recording?.metadata?.start_time}
                                endTime={
                                    recording?.metadata?.finalized_time ||
                                    recording?.modified ||
                                    recording?.created
                                }
                                formatDate={formatDate}
                                formatFrequency={formatFrequency}
                                containerSx={{
                                    mb: 2,
                                    height: { xs: 280, sm: 360, md: 440 },
                                    '&:hover': {
                                        boxShadow: '0 0 0 2px rgba(66, 135, 245, 0.25)',
                                        borderStyle: 'dashed',
                                    },
                                }}
                            />
                        )}

                        <Typography variant="subtitle2" gutterBottom>
                            {t('recording_dialog.recording', { defaultValue: 'Recording' })}
                        </Typography>
                        <Box sx={{ ...sectionSx, mb: 1.5 }}>
                            <Box sx={rowSx}>
                                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                    {t('recording_dialog.name', { defaultValue: 'Name' })}
                                </Typography>
                                <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-word' }}>
                                    {recording.name}
                                </Typography>
                            </Box>
                        </Box>

                        <Box
                            sx={{
                                mb: 2,
                                border: '1px solid',
                                borderColor: 'divider',
                                borderRadius: 2,
                                overflow: 'hidden',
                                bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'common.white'),
                            }}
                        >
                            <Box
                                sx={{
                                    px: 2,
                                    py: 1.5,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 2,
                                    borderBottom: '1px solid',
                                    borderColor: 'divider',
                                    bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.800' : 'grey.50'),
                                }}
                            >
                                <Box>
                                    <Typography variant="subtitle2" fontWeight={700}>{t('recording_dialog.recording_files', { defaultValue: 'Recording files' })}</Typography>
                                    <Typography variant="caption" color="text.secondary">{t('recording_dialog.source_data_and_generated_visual_products', { defaultValue: 'Source data and generated visual products' })}</Typography>
                                </Box>
                                <Chip label={`${associatedFiles.length} files`} size="small" variant="outlined" />
                            </Box>
                            <Box sx={{ p: 1 }}>
                                {associatedFiles.map((file) => {
                                    const isImage = file.key === 'snapshot' || file.key === 'thumbnail';
                                    const fileIcon = file.key === 'data'
                                        ? <GraphicEqIcon />
                                        : file.key === 'metadata'
                                            ? <DescriptionIcon />
                                            : <ImageIcon />;
                                    const accentColor = file.key === 'data'
                                        ? 'primary.main'
                                        : file.key === 'metadata'
                                            ? 'info.main'
                                            : 'success.main';

                                    return (
                                        <Box
                                            key={file.key}
                                            sx={{
                                                display: 'grid',
                                                gridTemplateColumns: { xs: '52px minmax(0, 1fr) auto', sm: '64px minmax(0, 1fr) auto' },
                                                alignItems: 'center',
                                                gap: { xs: 1.25, sm: 1.5 },
                                                p: 1.25,
                                                borderRadius: 1.5,
                                                '&:hover': { bgcolor: 'action.hover' },
                                            }}
                                        >
                                            <Box
                                                sx={{
                                                    width: { xs: 52, sm: 64 },
                                                    height: { xs: 42, sm: 48 },
                                                    borderRadius: 1.25,
                                                    bgcolor: isImage ? 'grey.900' : 'action.selected',
                                                    color: accentColor,
                                                    border: '1px solid',
                                                    borderColor: isImage ? 'divider' : 'transparent',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    overflow: 'hidden',
                                                }}
                                            >
                                                {file.previewUrl ? (
                                                    <Box component="img" src={file.previewUrl} alt={`${file.type} preview`} sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                                                ) : fileIcon}
                                            </Box>
                                            <Box sx={{ minWidth: 0 }}>
                                                <Typography variant="caption" sx={{ color: accentColor, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                                                    {file.type}
                                                </Typography>
                                                <Tooltip title={file.filename} placement="top-start">
                                                    <Typography variant="body2" noWrap sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                                                        {file.filename}
                                                    </Typography>
                                                </Tooltip>
                                                <Typography variant="caption" color="text.secondary" component="div">
                                                    {formatBytes(file.size)}{file.dimensions ? ` · ${file.dimensions}` : ''}
                                                </Typography>
                                            </Box>
                                            <Tooltip title={`Download ${file.type}`}>
                                                <span>
                                                    <IconButton
                                                        aria-label={`Download ${file.type}`}
                                                        size="small"
                                                        color="primary"
                                                        disabled={!file.url}
                                                        onClick={() => window.open(file.url, '_blank', 'noopener,noreferrer')}
                                                    >
                                                        <DownloadIcon fontSize="small" />
                                                    </IconButton>
                                                </span>
                                            </Tooltip>
                                        </Box>
                                    );
                                })}
                            </Box>
                        </Box>

                        {recording.metadata && (
                            <>
                                {(recording.metadata.target_satellite_name || recording.metadata.target_satellite_norad_id) && (
                                    <>
                                        <Typography variant="subtitle2" gutterBottom>
                                            {t('recording_dialog.target_satellite', { defaultValue: 'Target Satellite' })}
                                        </Typography>
                                        <Box sx={sectionSx}>
                                            {recording.metadata.target_satellite_name && (
                                                <Box sx={rowSx}>
                                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                        {t('recording_dialog.name', { defaultValue: 'Name' })}
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                        {recording.metadata.target_satellite_name}
                                                    </Typography>
                                                </Box>
                                            )}
                                            {recording.metadata.target_satellite_norad_id && (
                                                <Box sx={rowSx}>
                                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                        {t('recording_dialog.norad_id', { defaultValue: 'NORAD ID' })}
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                        {recording.metadata.target_satellite_norad_id}
                                                    </Typography>
                                                </Box>
                                            )}
                                        </Box>
                                    </>
                                )}

                                <Typography variant="subtitle2" gutterBottom>
                                    {t('recording_dialog.metadata', { defaultValue: 'Metadata' })}
                                </Typography>
                                <Box sx={sectionSx}>
                                    {recording.metadata.datatype && (
                                        <Box sx={rowSx}>
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                {t('recording_dialog.data_type', { defaultValue: 'Data Type' })}
                                            </Typography>
                                            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                {recording.metadata.datatype}
                                            </Typography>
                                        </Box>
                                    )}
                                    {recording.metadata.sample_rate && (
                                        <Box sx={rowSx}>
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                {t('recording_dialog.sample_rate', { defaultValue: 'Sample Rate' })}
                                            </Typography>
                                            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                {recording.metadata.sample_rate} Hz
                                            </Typography>
                                        </Box>
                                    )}
                                    {recording.metadata.start_time && (
                                        <Box sx={rowSx}>
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                {t('recording_dialog.start_time', { defaultValue: 'Start Time' })}
                                            </Typography>
                                            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                {formatDate(recording.metadata.start_time)}
                                            </Typography>
                                        </Box>
                                    )}
                                    {recording.metadata.finalized_time && (
                                        <Box sx={rowSx}>
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                {t('recording_dialog.end_time', { defaultValue: 'End Time' })}
                                            </Typography>
                                            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                {formatDate(recording.metadata.finalized_time)}
                                            </Typography>
                                        </Box>
                                    )}
                                    {recording.metadata.version && (
                                        <Box sx={rowSx}>
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                {t('recording_dialog.sigmf_version', { defaultValue: 'SigMF Version' })}
                                            </Typography>
                                            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                {recording.metadata.version}
                                            </Typography>
                                        </Box>
                                    )}
                                    {recording.metadata.recorder && (
                                        <Box sx={rowSx}>
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                {t('recording_dialog.recorder', { defaultValue: 'Recorder' })}
                                            </Typography>
                                            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                {recording.metadata.recorder}
                                            </Typography>
                                        </Box>
                                    )}
                                    {recording.metadata.description && (
                                        <Box sx={rowSx}>
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                {t('recording_dialog.description', { defaultValue: 'Description' })}
                                            </Typography>
                                            <Typography variant="body2" sx={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
                                                {recording.metadata.description}
                                            </Typography>
                                        </Box>
                                    )}
                                </Box>

                                {recording.metadata.captures?.length > 0 && (
                                    <>
                                        <Typography variant="subtitle2" gutterBottom>
                                            {t('recording_dialog.capture_segments', { defaultValue: 'Capture Segments (' })}{recording.metadata.captures.length})
                                        </Typography>
                                        <Stack spacing={1} sx={{ mb: 2 }}>
                                            {recording.metadata.captures.map((capture, index) => (
                                                <Box
                                                    key={index}
                                                    sx={{
                                                        p: 2,
                                                        border: '1px solid',
                                                        borderColor: 'divider',
                                                        borderRadius: 1.5,
                                                        bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'common.white'),
                                                        boxShadow: '0 1px 2px rgba(0, 0, 0, 0.08)',
                                                    }}
                                                >
                                                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                                                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                                                            {t('recording_dialog.segment', { defaultValue: 'Segment' })} {index + 1}
                                                        </Typography>
                                                        <Chip
                                                            label={`${Object.keys(capture).length} fields`}
                                                            size="small"
                                                            sx={{ height: '20px', fontSize: '0.65rem', '& .MuiChip-label': { px: 0.75 } }}
                                                        />
                                                    </Box>
                                                    <Box sx={{ fontFamily: 'monospace', fontSize: '0.8125rem' }}>
                                                        {Object.entries(capture).map(([key, value]) => (
                                                            <Box key={key} sx={rowSx}>
                                                                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                                    {key}
                                                                </Typography>
                                                                <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-word' }}>
                                                                    {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                                                                </Typography>
                                                            </Box>
                                                        ))}
                                                    </Box>
                                                </Box>
                                            ))}
                                        </Stack>
                                    </>
                                )}
                            </>
                        )}
                    </Box>
                )}
            </DialogContent>
            <DialogActions
                disableSpacing
                sx={{
                    bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100'),
                    borderTop: (theme) => `1px solid ${theme.palette.divider}`,
                    px: 3,
                    py: 2.5,
                    gap: 1,
                    flexDirection: { xs: 'column', sm: 'row' },
                    alignItems: { xs: 'stretch', sm: 'center' },
                    justifyContent: { xs: 'stretch', sm: 'flex-end' },
                    '& .MuiButton-root': {
                        width: { xs: '100%', sm: 'auto' },
                    },
                }}
            >
                <Button
                    onClick={() => window.open(recording?.download_urls.data, '_blank')}
                    startIcon={<DownloadIcon />}
                    variant="outlined"
                >
                    {t('recording_dialog.download_data', { defaultValue: 'Download Data' })}
                </Button>
                <Button
                    onClick={() => window.open(recording?.download_urls.meta, '_blank')}
                    startIcon={<DownloadIcon />}
                    variant="outlined"
                >
                    {t('recording_dialog.download_metadata', { defaultValue: 'Download Metadata' })}
                </Button>
                {recording?.snapshot && (
                    <Button
                        onClick={() => window.open(recording.snapshot.url, '_blank')}
                        startIcon={<DownloadIcon />}
                        variant="outlined"
                    >
                        {t('recording_dialog.download_snapshot', { defaultValue: 'Download Snapshot' })}
                    </Button>
                )}
                <Button
                    onClick={onClose}
                    variant="outlined"
                    sx={{
                        borderColor: (theme) => (theme.palette.mode === 'dark' ? 'grey.700' : 'grey.400'),
                        '&:hover': {
                            borderColor: (theme) => (theme.palette.mode === 'dark' ? 'grey.600' : 'grey.500'),
                            bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.800' : 'grey.200'),
                        },
                    }}
                >
                    {t('recording_dialog.close', { defaultValue: 'Close' })}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
