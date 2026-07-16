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
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Typography,
    Box,
    List,
    ListItem,
    ListItemText,
    ListItemIcon,
    Divider,
    CircularProgress,
    Chip,
    ListItemButton,
    Tabs,
    Tab,
    Alert,
    AlertTitle,
    Grid,
    Paper,
    Stack,
} from '@mui/material';
import Timeline from '@mui/lab/Timeline';
import TimelineItem from '@mui/lab/TimelineItem';
import TimelineSeparator from '@mui/lab/TimelineSeparator';
import TimelineConnector from '@mui/lab/TimelineConnector';
import TimelineContent from '@mui/lab/TimelineContent';
import TimelineDot from '@mui/lab/TimelineDot';
import TimelineOppositeContent from '@mui/lab/TimelineOppositeContent';
import {
    InsertDriveFile as FileIcon,
    AudioFile as AudioIcon,
    Image as ImageIcon,
    VideoLibrary as VideoIcon,
    Description as TextIcon,
    Info as InfoIcon,
    Error as ErrorIcon,
    Warning as WarningIcon,
    CheckCircle as SuccessIcon,
    Schedule as ScheduleIcon,
    Timer as TimerIcon,
} from '@mui/icons-material';
import { useSocket } from '../common/socket.jsx';
import { useSelector, useDispatch } from 'react-redux';
import { fetchSingleObservation } from './scheduler-slice.jsx';
import RecordingDialog from '../filebrowser/recording-dialog.jsx';
import AudioDialog from '../filebrowser/audio-dialog.jsx';
import TranscriptionDialog from '../filebrowser/transcription-dialog.jsx';
import TelemetryViewerDialog from '../filebrowser/telemetry-viewer-dialog.jsx';

const ObservationDataDialog = ({ open, onClose, observation }) => {
    const { socket } = useSocket();
    const dispatch = useDispatch();
    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState(false);
    const [observationLoading, setObservationLoading] = useState(false);
    const [selectedFile, setSelectedFile] = useState(null);
    const [fileDetailsOpen, setFileDetailsOpen] = useState(false);
    const [telemetryMetadata, setTelemetryMetadata] = useState(null);
    const [telemetryViewerOpen, setTelemetryViewerOpen] = useState(false);
    const [activeTab, setActiveTab] = useState(0);
    
    // Get the latest observation data from Redux store
    const latestObservation = useSelector((state) => 
        state.scheduler?.observations?.find(obs => obs.id === observation?.id)
    ) || observation;

    // Get timezone and locale preferences
    const timezone = useSelector((state) => {
        const tzPref = state.preferences?.preferences?.find(p => p.name === 'timezone');
        return tzPref?.value || 'UTC';
    });

    const locale = useSelector((state) => {
        const localePref = state.preferences?.preferences?.find(p => p.name === 'locale');
        const value = localePref?.value;
        // Return undefined for 'browser' to use browser default, otherwise return the specific locale
        return (value === 'browser' || !value) ? undefined : value;
    });

    // Fetch fresh observation data when dialog opens
    useEffect(() => {
        if (open && observation?.id && socket) {
            setObservationLoading(true);
            dispatch(fetchSingleObservation({ socket, observationId: observation.id }))
                .finally(() => setObservationLoading(false));
        }
    }, [open, observation?.id, socket, dispatch]);

    // Fetch files when dialog opens
    useEffect(() => {
        if (!open || !observation?.id || !socket) {
            setFiles([]);
            return;
        }

        setLoading(true);

        // Listen for file browser response
        const handleFileBrowserState = (state) => {
            if (state.action === 'list-files') {
                console.log('Observation ID:', observation.id);
                console.log('Total files received:', state.items?.length || 0);

                // Try to match files by observation ID
                const sessionId = `internal:${observation.id}`;

                const matchingFiles = state.items.filter(file => {
                    // Check if session_id matches (backend should set this for scheduled observations)
                    if (file.session_id === sessionId) return true;

                    // Check if observation_id field exists and matches
                    if (file.observation_id === observation.id) return true;

                    // Check if metadata has observation_id
                    if (file.metadata?.observation_id === observation.id) return true;

                    // Check if filename contains observation ID
                    const filename = file.name || file.filename || '';
                    if (filename.includes(observation.id)) return true;

                    return false;
                });

                setFiles(matchingFiles);
                setLoading(false);
            }
        };

        socket.on('file_browser_state', handleFileBrowserState);

        // Request all files
        socket.emit("api.call", {
  cmd: "filebrowser.list-files",
  data: {
    showRecordings: true,
    showSnapshots: true,
    showDecoded: true,
    showAudio: true,
    showTranscriptions: true
  }
});

        return () => {
            socket.off('file_browser_state', handleFileBrowserState);
        };
    }, [open, observation?.id, socket]);

    const getFileIcon = (type) => {
        switch (type) {
            case 'audio':
                return <AudioIcon />;
            case 'snapshot':
                return <ImageIcon />;
            case 'recording':
                return <VideoIcon />;
            case 'transcription':
                return <TextIcon />;
            case 'decoded':
                return <TextIcon />;
            default:
                return <FileIcon />;
        }
    };

    const getFileTypeLabel = (type) => {
        const labels = {
            'audio': 'Audio Recording',
            'snapshot': 'Snapshot',
            'recording': 'IQ Recording',
            'transcription': 'Transcription',
            'decoded': 'Decoded Data',
        };
        return labels[type] || 'File';
    };

    const formatFileSize = (bytes) => {
        if (!bytes) return 'N/A';
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    };

    const formatDateTime = (dateString) => {
        if (!dateString) return 'N/A';
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return 'N/A';
            return date.toLocaleString(locale, { timeZone: timezone });
        } catch (e) {
            return 'N/A';
        }
    };

    const calculateDuration = (start, end) => {
        if (!start || !end) return 'N/A';
        try {
            const startDate = new Date(start);
            const endDate = new Date(end);
            if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return 'N/A';
            
            const durationMs = endDate - startDate;
            const seconds = Math.floor(durationMs / 1000);
            const minutes = Math.floor(seconds / 60);
            const hours = Math.floor(minutes / 60);
            
            if (hours > 0) {
                return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
            } else if (minutes > 0) {
                return `${minutes}m ${seconds % 60}s`;
            } else {
                return `${seconds}s`;
            }
        } catch (e) {
            return 'N/A';
        }
    };

    const getEventIcon = (level) => {
        switch (level) {
            case 'error':
                return <ErrorIcon color="error" />;
            case 'warning':
                return <WarningIcon color="warning" />;
            case 'info':
                return <InfoIcon color="info" />;
            default:
                return <SuccessIcon color="success" />;
        }
    };

    const getEventColor = (level) => {
        switch (level) {
            case 'error':
                return 'error';
            case 'warning':
                return 'warning';
            case 'info':
                return 'info';
            default:
                return 'success';
        }
    };

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
                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
                    borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                    py: 2.5,
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Box>
                        <Typography variant="h6">
                            {latestObservation?.name || `${latestObservation?.satellite?.name || 'Unknown'} Observation`}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {latestObservation?.satellite?.name || 'Unknown Satellite'} • ID: {latestObservation?.id || 'N/A'}
                        </Typography>
                    </Box>
                    <Chip 
                        label={latestObservation?.status || 'N/A'} 
                        color={
                            latestObservation?.status === 'completed' ? 'success' :
                            latestObservation?.status === 'running' ? 'info' :
                            latestObservation?.status === 'failed' ? 'error' :
                            latestObservation?.status === 'cancelled' ? 'warning' :
                            'default'
                        }
                        size="small"
                    />
                </Box>
            </DialogTitle>
            
            <Tabs 
                value={activeTab} 
                onChange={(e, newValue) => setActiveTab(newValue)}
                sx={{
                    borderBottom: 1,
                    borderColor: 'divider',
                    px: 3,
                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
                }}
            >
                <Tab label="Execution Timeline" />
                <Tab label="Downloaded Data" />
                {latestObservation?.error_message && <Tab label="Error Details" />}
            </Tabs>

            <DialogContent
                dividers
                sx={{
                    bgcolor: (theme) => (
                        theme.palette.mode === 'dark'
                            ? theme.palette.background.elevated
                            : theme.palette.background.paper
                    ),
                    px: 3,
                    py: 3,
                    minHeight: 400,
                }}
            >
                {observationLoading ? (
                    <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
                        <CircularProgress />
                    </Box>
                ) : (
                    <>
                {/* Execution Timeline Tab */}
                {activeTab === 0 && (
                    <Box>
                        {latestObservation?.execution_log && latestObservation.execution_log.length > 0 ? (
                            <Timeline position="right">
                                {latestObservation.execution_log.map((event, index) => (
                                    <TimelineItem key={index}>
                                        <TimelineOppositeContent 
                                            color="text.secondary" 
                                            sx={{ 
                                                flex: 0.2, 
                                                display: 'flex', 
                                                alignItems: 'center',
                                                py: '12px'
                                            }}
                                        >
                                            <Typography variant="body2">
                                                {formatDateTime(event.timestamp)}
                                            </Typography>
                                        </TimelineOppositeContent>
                                        <TimelineSeparator>
                                            <TimelineDot color={getEventColor(event.level)}>
                                                {getEventIcon(event.level)}
                                            </TimelineDot>
                                            {index < latestObservation.execution_log.length - 1 && <TimelineConnector />}
                                        </TimelineSeparator>
                                        <TimelineContent sx={{ py: '12px' }}>
                                            <Paper elevation={3} sx={{ p: 1.5, display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                                                <Typography variant="body2">
                                                    {event.event}
                                                </Typography>
                                                <Chip 
                                                    label={event.level} 
                                                    size="small" 
                                                    color={getEventColor(event.level)}
                                                    sx={{ height: 20 }}
                                                />
                                            </Paper>
                                        </TimelineContent>
                                    </TimelineItem>
                                ))}
                            </Timeline>
                        ) : (
                            <Box sx={{ textAlign: 'center', py: 4 }}>
                                <ScheduleIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
                                <Typography variant="body2" color="text.secondary">
                                    No execution events recorded yet.
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    Events will appear here once the observation starts executing.
                                </Typography>
                            </Box>
                        )}
                    </Box>
                )}

                {/* Downloaded Data Tab */}
                {activeTab === 1 && (
                    <Box>
                        <Typography variant="subtitle2" sx={{ mb: 2 }}>
                            Data Files ({files.length})
                        </Typography>

                        {loading ? (
                            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                                <CircularProgress />
                            </Box>
                        ) : files.length === 0 ? (
                            <Box sx={{ textAlign: 'center', py: 4 }}>
                                <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic', mb: 2 }}>
                                    No data files found for this observation.
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                    Files will appear here when:
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                    • The observation has completed successfully
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                    • Tasks (IQ recording, audio, decoding) generated output files
                                </Typography>
                            </Box>
                        ) : (
                            <List>
                                {files.map((file, index) => {
                                    // Handle different file structures
                                    const fileSize = file.size || file.data_size;
                                    const fileName = file.name || file.filename;

                                    // Parse creation date - handle both timestamp and ISO string
                                    let createdDate = 'N/A';
                                    try {
                                        if (file.created) {
                                            const date = typeof file.created === 'number'
                                                ? new Date(file.created * 1000)  // Unix timestamp in seconds
                                                : new Date(file.created);  // ISO string

                                            // Check if date is valid
                                            if (!isNaN(date.getTime())) {
                                                // Format with timezone and locale preferences
                                                // locale is undefined if 'browser' is selected, which uses browser's locale
                                                createdDate = date.toLocaleString(locale, { timeZone: timezone });
                                            } else {
                                                console.warn('Invalid date:', file.created);
                                            }
                                        }
                                    } catch (e) {
                                        console.error('Error parsing date:', e, file.created);
                                    }

                                    const handleFileClick = async () => {
                                        // For decoded telemetry files (.bin), fetch metadata and open telemetry viewer
                                        if (file.type === 'decoded' && file.url && file.url.endsWith('.bin')) {
                                            try {
                                                const metadataUrl = file.url.replace('.bin', '.json');
                                                const response = await fetch(metadataUrl);
                                                const metadata = await response.json();
                                                setSelectedFile(file);
                                                setTelemetryMetadata(metadata);
                                                setTelemetryViewerOpen(true);
                                            } catch (error) {
                                                console.error('Failed to fetch telemetry metadata:', error);
                                                // Fallback to simple dialog
                                                setSelectedFile(file);
                                                setFileDetailsOpen(true);
                                            }
                                        } else {
                                            // For other file types, use standard dialogs
                                            setSelectedFile(file);
                                            setFileDetailsOpen(true);
                                        }
                                    };

                                    return (
                                        <ListItemButton
                                            key={index}
                                            sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
                                            onClick={handleFileClick}
                                        >
                                            <ListItemIcon>
                                                {getFileIcon(file.type)}
                                            </ListItemIcon>
                                            <ListItemText
                                                primary={
                                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                        <Typography variant="body1">{fileName}</Typography>
                                                        <Chip label={getFileTypeLabel(file.type)} size="small" />
                                                    </Box>
                                                }
                                                secondary={`${formatFileSize(fileSize)} • Created: ${createdDate}`}
                                            />
                                        </ListItemButton>
                                    );
                                })}
                            </List>
                        )}
                    </Box>
                )}

                {/* Error Details Tab */}
                {activeTab === 2 && latestObservation?.error_message && (
                    <Box>
                        <Alert severity="error" sx={{ mb: 3 }}>
                            <AlertTitle>Error Information</AlertTitle>
                            <Grid container spacing={2} sx={{ mt: 1 }}>
                                <Grid item xs={12} md={4}>
                                    <Typography variant="caption" color="text.secondary">Total Errors</Typography>
                                    <Typography variant="h6">{latestObservation?.error_count || 0}</Typography>
                                </Grid>
                                <Grid item xs={12} md={8}>
                                    <Typography variant="caption" color="text.secondary">Last Error Time</Typography>
                                    <Typography variant="body2">{formatDateTime(latestObservation?.last_error_time)}</Typography>
                                </Grid>
                            </Grid>
                        </Alert>

                        <Paper elevation={2} sx={{ p: 2 }}>
                            <Typography variant="subtitle2" gutterBottom>
                                Last Error Message
                            </Typography>
                            <Divider sx={{ my: 1 }} />
                            <Typography 
                                variant="body2" 
                                sx={{ 
                                    fontFamily: 'monospace', 
                                    whiteSpace: 'pre-wrap', 
                                    wordBreak: 'break-word',
                                    bgcolor: 'action.hover',
                                    p: 2,
                                    borderRadius: 1
                                }}
                            >
                                {latestObservation.error_message}
                            </Typography>
                        </Paper>
                    </Box>
                )}
                    </>
                )}
            </DialogContent>
            
            <DialogActions
                sx={{
                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
                    borderTop: (theme) => `1px solid ${theme.palette.divider}`,
                    px: 3,
                    py: 2.5,
                    gap: 2,
                }}
            >
                <Button
                    onClick={onClose}
                    variant="outlined"
                    sx={{
                        borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.700' : 'grey.400',
                        '&:hover': {
                            borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.600' : 'grey.500',
                            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.200',
                        },
                    }}
                >
                    Close
                </Button>
            </DialogActions>

            {/* File Detail Dialogs */}
            {selectedFile?.type === 'recording' && (
                <RecordingDialog
                    open={fileDetailsOpen}
                    onClose={() => setFileDetailsOpen(false)}
                    recording={selectedFile}
                />
            )}

            {selectedFile?.type === 'audio' && (
                <AudioDialog
                    open={fileDetailsOpen}
                    onClose={() => setFileDetailsOpen(false)}
                    audio={selectedFile}
                />
            )}

            {selectedFile?.type === 'transcription' && (
                <TranscriptionDialog
                    open={fileDetailsOpen}
                    onClose={() => setFileDetailsOpen(false)}
                    transcription={selectedFile}
                />
            )}

            {/* Telemetry Viewer for decoded .bin files */}
            <TelemetryViewerDialog
                open={telemetryViewerOpen}
                onClose={() => {
                    setTelemetryViewerOpen(false);
                    setTelemetryMetadata(null);
                    setFileDetailsOpen(false);
                    setSelectedFile(null);
                }}
                file={selectedFile}
                metadata={telemetryMetadata}
            />

            {/* Simple preview for decoded image files and snapshots */}
            {(selectedFile?.type === 'decoded' || selectedFile?.type === 'snapshot') && !telemetryViewerOpen && (
                <Dialog
                    open={fileDetailsOpen}
                    onClose={() => setFileDetailsOpen(false)}
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
                            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
                            borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                            py: 2.5,
                        }}
                    >
                        {selectedFile?.name || selectedFile?.filename}
                    </DialogTitle>
                    <DialogContent
                        dividers
                        sx={{
                            bgcolor: (theme) => (
                                theme.palette.mode === 'dark'
                                    ? theme.palette.background.elevated
                                    : theme.palette.background.paper
                            ),
                            px: 3,
                            py: 3,
                        }}
                    >
                        {selectedFile?.url && (selectedFile.url.endsWith('.png') || selectedFile.url.endsWith('.jpg') || selectedFile.url.endsWith('.jpeg')) ? (
                            <Box sx={{ textAlign: 'center' }}>
                                <img
                                    src={selectedFile.url}
                                    alt={selectedFile.name || selectedFile.filename}
                                    style={{ maxWidth: '100%', height: 'auto' }}
                                />
                            </Box>
                        ) : (
                            <Typography variant="body2" color="text.secondary">
                                Preview not available for this file type.
                            </Typography>
                        )}
                    </DialogContent>
                    <DialogActions
                        sx={{
                            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
                            borderTop: (theme) => `1px solid ${theme.palette.divider}`,
                            px: 3,
                            py: 2.5,
                            gap: 2,
                        }}
                    >
                        <Button
                            onClick={() => window.open(selectedFile.url, '_blank')}
                            variant="contained"
                        >
                            Download
                        </Button>
                        <Button
                            onClick={() => setFileDetailsOpen(false)}
                            variant="outlined"
                            sx={{
                                borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.700' : 'grey.400',
                                '&:hover': {
                                    borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.600' : 'grey.500',
                                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.200',
                                },
                            }}
                        >
                            Close
                        </Button>
                    </DialogActions>
                </Dialog>
            )}
        </Dialog>
    );
};

export default ObservationDataDialog;
