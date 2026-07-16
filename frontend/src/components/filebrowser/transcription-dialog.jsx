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

import React, { useEffect, useState } from 'react';
import {
    Box,
    Typography,
    Chip,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    CircularProgress,
    Alert,
    Divider,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

export default function TranscriptionDialog({ open, onClose, transcription }) {
    const { t } = useTranslation('filebrowser');
    const [transcriptionText, setTranscriptionText] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Get timezone preference
    const timezone = useSelector((state) => {
        const tzPref = state.preferences?.preferences?.find(p => p.name === 'timezone');
        return tzPref?.value || 'UTC';
    });

    // Timezone-aware date formatting function
    const formatDate = (isoDate) => {
        if (!isoDate) return 'N/A';
        const date = new Date(isoDate);
        return date.toLocaleString('en-US', { timeZone: timezone });
    };

    // Load transcription text when dialog opens
    useEffect(() => {
        if (!open || !transcription?.url) {
            setTranscriptionText('');
            setError(null);
            return;
        }

        const loadTranscription = async () => {
            setLoading(true);
            setError(null);
            try {
                const response = await fetch(transcription.url);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                const text = await response.text();
                setTranscriptionText(text);
            } catch (err) {
                console.error('Error loading transcription:', err);
                setError(err.message);
            } finally {
                setLoading(false);
            }
        };

        loadTranscription();
    }, [open, transcription?.url]);

    const handleDownload = () => {
        if (transcription?.url) {
            window.open(transcription.url, '_blank');
        }
    };

    if (!transcription) return null;

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

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="md"
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
                    <Typography variant="h6">Transcription Details</Typography>
                    <Box>
                        {transcription.provider && (
                            <Chip
                                label={transcription.provider}
                                size="small"
                                color="secondary"
                                sx={{ mr: 1, height: '20px', fontSize: '0.65rem', '& .MuiChip-label': { px: 0.75 } }}
                            />
                        )}
                        {transcription.size && (
                            <Chip
                                label={formatBytes(transcription.size)}
                                size="small"
                                sx={{ height: '20px', fontSize: '0.65rem', '& .MuiChip-label': { px: 0.75 } }}
                            />
                        )}
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
                <Box sx={{ mt: 3 }}>
                    <Typography variant="subtitle2" gutterBottom>
                        File
                    </Typography>
                    <Box sx={sectionSx}>
                        <Box sx={rowSx}>
                            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                Filename
                            </Typography>
                            <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-word' }}>
                                {transcription.filename}
                            </Typography>
                        </Box>
                    </Box>

                    {transcription.metadata && (
                        <>
                            <Typography variant="subtitle2" gutterBottom>
                                Transcription Properties
                            </Typography>
                            <Box sx={sectionSx}>
                                {transcription.provider && (
                                    <Box sx={rowSx}>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                            Provider
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                            {transcription.provider}
                                        </Typography>
                                    </Box>
                                )}
                                {transcription.session_id && (
                                    <Box sx={rowSx}>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                            Session ID
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-word' }}>
                                            {transcription.session_id}
                                        </Typography>
                                    </Box>
                                )}
                                {transcription.vfo_number && (
                                    <Box sx={rowSx}>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                            VFO
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                            {transcription.vfo_number}
                                        </Typography>
                                    </Box>
                                )}
                                {transcription.language && (
                                    <Box sx={rowSx}>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                            Language
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                            {transcription.language}
                                        </Typography>
                                    </Box>
                                )}
                                {transcription.translate_to && (
                                    <Box sx={rowSx}>
                                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                            Translated To
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                            {transcription.translate_to}
                                        </Typography>
                                    </Box>
                                )}
                            </Box>

                            {(transcription.started || transcription.ended) && (
                                <>
                                    <Typography variant="subtitle2" gutterBottom>
                                        Transcription Times
                                    </Typography>
                                    <Box sx={sectionSx}>
                                        {transcription.started && (
                                            <Box sx={rowSx}>
                                                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                    Started
                                                </Typography>
                                                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                    {formatDate(transcription.started)}
                                                </Typography>
                                            </Box>
                                        )}
                                        {transcription.ended && (
                                            <Box sx={rowSx}>
                                                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                    Ended
                                                </Typography>
                                                <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                    {formatDate(transcription.ended)}
                                                </Typography>
                                            </Box>
                                        )}
                                    </Box>
                                </>
                            )}
                        </>
                    )}

                    <Divider sx={{ my: 2 }} />

                    <Typography variant="subtitle2" gutterBottom>
                        Transcription Text
                    </Typography>

                    {loading ? (
                        <Box
                            sx={{
                                minHeight: 220,
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                border: '1px solid',
                                borderColor: 'divider',
                                borderRadius: 1.5,
                                bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50'),
                            }}
                        >
                            <CircularProgress />
                        </Box>
                    ) : error ? (
                        <Alert severity="error" sx={{ mb: 2 }}>
                            Failed to load transcription: {error}
                        </Alert>
                    ) : (
                        <Box
                            sx={{
                                p: 2,
                                borderRadius: 1.5,
                                border: '1px solid',
                                borderColor: 'divider',
                                maxHeight: 400,
                                overflowY: 'auto',
                                bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'common.white'),
                                fontFamily: 'monospace',
                                fontSize: '0.875rem',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                lineHeight: 1.65,
                                boxShadow: '0 1px 2px rgba(0, 0, 0, 0.08)',
                            }}
                        >
                            {transcriptionText || 'No transcription text available'}
                        </Box>
                    )}
                </Box>
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
                    onClick={handleDownload}
                    startIcon={<DownloadIcon />}
                    variant="outlined"
                >
                    Download
                </Button>
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
                    Close
                </Button>
            </DialogActions>
        </Dialog>
    );
}
