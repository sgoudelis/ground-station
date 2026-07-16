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

import React, { useCallback, useEffect, useState, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    Accordion,
    AccordionSummary,
    AccordionDetails,
} from './settings-elements.jsx';
import Typography from '@mui/material/Typography';
import {
    Box,
    List,
    ListItem,
    ListItemButton,
    ListItemText,
    Chip,
    CircularProgress,
    Alert,
    Pagination,
    Stack,
    IconButton,
    Tooltip,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Paper,
} from "@mui/material";
import RefreshIcon from '@mui/icons-material/Refresh';
import SortIcon from '@mui/icons-material/Sort';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import InfoIcon from '@mui/icons-material/Info';
import { useTranslation } from 'react-i18next';
import { useSocket } from '../common/socket.jsx';
import { fetchFiles, setPage } from '../filebrowser/filebrowser-slice.jsx';
import { fetchSDRs } from '../hardware/sdr-slice.jsx';
import RecordingDialog from '../filebrowser/recording-dialog.jsx';
import { store } from '../common/store.jsx';

const PLAYBACK_COUNTDOWN_UPDATE_MS = 250;

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function formatDuration(seconds) {
    if (!seconds) return 'N/A';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);

    if (hours > 0) {
        return `${hours}h ${minutes}m ${secs}s`;
    }
    return `${minutes}m ${secs}s`;
}

function formatRelativeTime(isoDate) {
    const date = new Date(isoDate);
    const now = new Date();
    const diffMs = now - date;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSecs < 60) return 'just now';
    if (diffMins < 60) return `${diffMins} min${diffMins > 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? 's' : ''} ago`;
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) > 1 ? 's' : ''} ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} month${Math.floor(diffDays / 30) > 1 ? 's' : ''} ago`;
    return `${Math.floor(diffDays / 365)} year${Math.floor(diffDays / 365) > 1 ? 's' : ''} ago`;
}

const PlaybackAccordion = ({
    expanded,
    onAccordionChange,
    isStreaming,
    selectedPlaybackRecording,
    onRecordingSelect,
    onPlaybackPlay,
    onPlaybackStop,
    playbackStartTime,
    playbackRemainingSecondsRef,
}) => {
    const { t } = useTranslation('waterfall');
    const dispatch = useDispatch();
    const { socket } = useSocket();

    const {
        files,
        filesLoading,
        filesError,
        page,
        pageSize,
        total,
    } = useSelector((state) => state.filebrowser);

    // Local state for sort options
    const [sortBy, setSortBy] = useState('modified');
    const [sortOrder, setSortOrder] = useState('desc');

    // State for details dialog
    const [detailsOpen, setDetailsOpen] = useState(false);

    // Track playback countdown from ref
    const [playbackCountdown, setPlaybackCountdown] = useState(0);

    const getPlaybackFilesRequest = useCallback(() => {
        const currentFilters = store.getState().filebrowser.filters || {};
        return {
            socket,
            // Always include recordings for SigMF playback dropdown/options.
            showRecordings: true,
            showSnapshots: currentFilters.showSnapshots ?? true,
            showDecoded: currentFilters.showDecoded ?? true,
            showAudio: currentFilters.showAudio ?? true,
            showTranscriptions: currentFilters.showTranscriptions ?? true,
        };
    }, [socket]);

    useEffect(() => {
        if (!expanded || !isStreaming || !playbackRemainingSecondsRef) {
            setPlaybackCountdown(0);
            return;
        }

        const updateCountdown = () => {
            const remaining = playbackRemainingSecondsRef.current;
            const nextSeconds = (remaining !== null && remaining >= 0) ? Math.ceil(remaining) : 0;
            setPlaybackCountdown(prev => (prev === nextSeconds ? prev : nextSeconds));
        };

        updateCountdown();

        let rafId = 0;
        let lastTs = 0;
        const tick = (ts) => {
            if (document.hidden) {
                rafId = requestAnimationFrame(tick);
                return;
            }
            if (ts - lastTs >= PLAYBACK_COUNTDOWN_UPDATE_MS) {
                lastTs = ts;
                updateCountdown();
            }
            rafId = requestAnimationFrame(tick);
        };
        rafId = requestAnimationFrame(tick);

        return () => cancelAnimationFrame(rafId);
    }, [expanded, isStreaming, playbackRemainingSecondsRef]);

    // Filter, sort, and paginate recordings in the frontend
    const recordings = useMemo(() => {
        // Filter only recordings
        let recordingsList = files.filter(f => f.type === 'recording');

        // Apply sorting
        const reverse = sortOrder === 'desc';
        recordingsList.sort((a, b) => {
            let aVal, bVal;

            if (sortBy === 'name') {
                aVal = a.name;
                bVal = b.name;
                return reverse
                    ? bVal.localeCompare(aVal)
                    : aVal.localeCompare(bVal);
            } else if (sortBy === 'size') {
                aVal = a.data_size || 0;
                bVal = b.data_size || 0;
            } else if (sortBy === 'created') {
                aVal = new Date(a.created).getTime();
                bVal = new Date(b.created).getTime();
            } else if (sortBy === 'modified') {
                aVal = new Date(a.modified).getTime();
                bVal = new Date(b.modified).getTime();
            } else if (sortBy === 'sample_rate') {
                aVal = a.metadata?.sample_rate || 0;
                bVal = b.metadata?.sample_rate || 0;
            } else {
                return 0;
            }

            return reverse ? bVal - aVal : aVal - bVal;
        });

        // Apply pagination (5 items per page)
        const startIdx = (page - 1) * 5;
        const endIdx = startIdx + 5;
        return recordingsList.slice(startIdx, endIdx);
    }, [files, sortBy, sortOrder, page]);

    // Fetch recordings and SDRs when component mounts or when expanded
    useEffect(() => {
        if (socket && expanded) {
            // Refresh SDRs to ensure SigMF Playback SDR is available
            dispatch(fetchSDRs({ socket }));

            dispatch(fetchFiles(getPlaybackFilesRequest()));
        }
    }, [socket, dispatch, expanded, getPlaybackFilesRequest]);

    // Listen for file browser updates and refresh the recordings list
    useEffect(() => {
        if (!socket) return;

        const handleFileBrowserState = (state) => {
            // Only refresh on specific actions to avoid infinite loops
            // Don't refresh on 'list-files' action as that's the response to our fetch
            const action = state?.action;
            if (action && action !== 'list-files') {
                // Refresh files when recording starts/stops/deleted to show changes immediately.
                dispatch(fetchFiles(getPlaybackFilesRequest()));
            }
        };

        socket.on('file_browser_state', handleFileBrowserState);

        return () => {
            socket.off('file_browser_state', handleFileBrowserState);
        };
    }, [socket, dispatch, getPlaybackFilesRequest]);

    const handleRefresh = () => {
        if (socket) {
            dispatch(fetchFiles(getPlaybackFilesRequest()));
        }
    };

    const handlePageChange = (event, value) => {
        dispatch(setPage(value));
    };

    const handleSortChange = (event) => {
        setSortBy(event.target.value);
    };

    // Calculate total pages based on all recordings (filtered from files)
    const totalRecordings = files.filter(f => f.type === 'recording').length;
    const totalPages = Math.ceil(totalRecordings / 5);

    const formatDuration = (seconds) => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    };

    return (
        <Accordion expanded={expanded} onChange={onAccordionChange}>
            <AccordionSummary
                sx={{
                    boxShadow: '-1px 4px 7px #00000059',
                }}
                aria-controls="panel-playback-content"
                id="panel-playback-header"
            >
                <Stack direction="row" spacing={1} alignItems="center" width="100%" justifyContent="space-between">
                    <Typography component="span">
                        {t('playback.title', 'IQ Playback')}
                    </Typography>
                    {isStreaming && playbackCountdown > 0 && (
                        <Chip
                            label={formatDuration(playbackCountdown)}
                            color="error"
                            size="small"
                            sx={{
                                fontWeight: 'bold',
                            }}
                        />
                    )}
                </Stack>
            </AccordionSummary>
            <AccordionDetails
                sx={{
                    backgroundColor: 'background.elevated',
                    maxHeight: '600px',
                    overflowY: 'auto',
                }}
            >
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    <Paper
                        elevation={2}
                        sx={{
                            p: 1,
                            backgroundColor: 'background.paper',
                            display: 'flex',
                            gap: 1,
                            justifyContent: 'center',
                        }}
                    >
                        <Tooltip title={t('playback.play', 'Play')}>
                            <span>
                                <IconButton
                                    size="small"
                                    onClick={onPlaybackPlay}
                                    disabled={!selectedPlaybackRecording || isStreaming}
                                    color="primary"
                                >
                                    <PlayArrowIcon />
                                </IconButton>
                            </span>
                        </Tooltip>
                        <Tooltip title={t('playback.stop', 'Stop')}>
                            <span>
                                <IconButton
                                    size="small"
                                    onClick={onPlaybackStop}
                                    disabled={!isStreaming}
                                    color="error"
                                >
                                    <StopIcon />
                                </IconButton>
                            </span>
                        </Tooltip>
                        <Tooltip title={t('playback.details', 'View Details')}>
                            <span>
                                <IconButton
                                    size="small"
                                    onClick={() => setDetailsOpen(true)}
                                    disabled={!selectedPlaybackRecording}
                                    color="primary"
                                >
                                    <InfoIcon fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>
                        <Tooltip title={t('playback.refresh', 'Refresh recordings')}>
                            <span>
                                <IconButton size="small" onClick={handleRefresh} disabled={filesLoading}>
                                    <RefreshIcon fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>
                    </Paper>

                    <FormControl size="small" fullWidth>
                        <InputLabel>{t('playback.sort_by', 'Sort By')}</InputLabel>
                        <Select
                            value={sortBy}
                            label={t('playback.sort_by', 'Sort By')}
                            onChange={handleSortChange}
                            startAdornment={<SortIcon sx={{ mr: 1, ml: 1, color: 'action.active' }} />}
                        >
                            <MenuItem value="modified">{t('playback.sort_modified', 'Date Modified')}</MenuItem>
                            <MenuItem value="created">{t('playback.sort_created', 'Date Created')}</MenuItem>
                            <MenuItem value="name">{t('playback.sort_name', 'Name')}</MenuItem>
                            <MenuItem value="size">{t('playback.sort_size', 'Size')}</MenuItem>
                            <MenuItem value="sample_rate">{t('playback.sort_sample_rate', 'Sample Rate')}</MenuItem>
                        </Select>
                    </FormControl>

                    {filesError && (
                        <Alert severity="error" sx={{ mb: 1 }}>
                            {filesError}
                        </Alert>
                    )}

                    {!filesError && recordings.length === 0 && !filesLoading && (
                        <Alert severity="info">
                            {t('playback.no_recordings', 'No recordings available. Record some IQ data first!')}
                        </Alert>
                    )}

                    {!filesError && (recordings.length > 0 || filesLoading) && (
                        <>
                            <List sx={{ width: '100%', p: 0 }}>
                                {recordings.map((recording) => {
                                    const isSelected = selectedPlaybackRecording?.name === recording.name;

                                    // Calculate duration from data size and sample rate
                                    let duration = null;
                                    const sampleRate = recording.metadata?.sample_rate;
                                    const dataSize = recording.data_size;
                                    if (sampleRate && dataSize) {
                                        // Each complex sample is 8 bytes (4 bytes I + 4 bytes Q for cf32_le)
                                        const numSamples = dataSize / 8;
                                        duration = numSamples / sampleRate;
                                    }

                                    return (
                                        <ListItem
                                            key={recording.name}
                                            disablePadding
                                            sx={{
                                                mb: 0.5,
                                                border: '1px solid',
                                                borderColor: isSelected ? 'primary.main' : 'border.main',
                                                borderRadius: 1,
                                                backgroundColor: isSelected ? 'primary.dark' : 'background.paper',
                                            }}
                                        >
                                            <ListItemButton
                                                onClick={() => onRecordingSelect(recording)}
                                                disabled={isStreaming && !isSelected}
                                                selected={isSelected}
                                                sx={{ py: 0.25, px: 1 }}
                                            >
                                                <ListItemText
                                                    primary={recording.name}
                                                    secondary={
                                                        <Stack
                                                            direction="row"
                                                            spacing={0.25}
                                                            sx={{
                                                                mt: 0.25,
                                                                flexWrap: 'wrap',
                                                                gap: 0.25,
                                                            }}
                                                        >
                                                            {sampleRate && (
                                                                <Chip
                                                                    label={`${(sampleRate / 1e6).toFixed(2)} MS/s`}
                                                                    size="small"
                                                                    variant="outlined"
                                                                    color="primary"
                                                                    sx={{ height: '18px', fontSize: '0.65rem', px: 0 }}
                                                                />
                                                            )}
                                                            {duration && (
                                                                <Chip
                                                                    label={formatDuration(duration)}
                                                                    size="small"
                                                                    variant="outlined"
                                                                    color="error"
                                                                    sx={{ height: '18px', fontSize: '0.65rem', fontFamily: 'monospace', px: 0 }}
                                                                />
                                                            )}
                                                            {recording.created && (
                                                                <Chip
                                                                    label={formatRelativeTime(recording.created)}
                                                                    size="small"
                                                                    variant="outlined"
                                                                    color="success"
                                                                    sx={{ height: '18px', fontSize: '0.65rem', px: 0 }}
                                                                />
                                                            )}
                                                        </Stack>
                                                    }
                                                    primaryTypographyProps={{
                                                        fontSize: '0.9rem',
                                                        fontWeight: isSelected ? 'bold' : 'normal',
                                                        noWrap: true,
                                                        sx: {
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                        }
                                                    }}
                                                    secondaryTypographyProps={{
                                                        component: 'div'
                                                    }}
                                                />
                                            </ListItemButton>
                                        </ListItem>
                                    );
                                })}
                            </List>

                            {filesLoading && (
                                <Box sx={{ display: 'flex', justifyContent: 'center', py: 1 }}>
                                    <CircularProgress size={20} />
                                </Box>
                            )}

                            {totalPages > 1 && (
                                <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}>
                                    <Pagination
                                        count={totalPages}
                                        page={page}
                                        onChange={handlePageChange}
                                        size="small"
                                        color="primary"
                                        disabled={filesLoading}
                                    />
                                </Box>
                            )}
                        </>
                    )}
                </Box>
            </AccordionDetails>

            {/* Recording Details Dialog */}
            <RecordingDialog
                open={detailsOpen}
                onClose={() => setDetailsOpen(false)}
                recording={selectedPlaybackRecording}
            />
        </Accordion>
    );
};

function arePlaybackAccordionPropsEqual(prevProps, nextProps) {
    return (
        prevProps.expanded === nextProps.expanded &&
        prevProps.onAccordionChange === nextProps.onAccordionChange &&
        prevProps.isStreaming === nextProps.isStreaming &&
        prevProps.selectedPlaybackRecording === nextProps.selectedPlaybackRecording &&
        prevProps.onRecordingSelect === nextProps.onRecordingSelect &&
        prevProps.onPlaybackPlay === nextProps.onPlaybackPlay &&
        prevProps.onPlaybackStop === nextProps.onPlaybackStop &&
        prevProps.playbackStartTime === nextProps.playbackStartTime &&
        prevProps.playbackRemainingSecondsRef === nextProps.playbackRemainingSecondsRef
    );
}

export default React.memo(PlaybackAccordion, arePlaybackAccordionPropsEqual);
