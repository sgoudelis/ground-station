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

import React, { useMemo, useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { Box, Paper, Typography, Chip, Stack, Button, Tooltip, Dialog, DialogTitle, DialogContent, DialogContentText, DialogActions } from '@mui/material';
import { AccessTime, RadioButtonChecked, Satellite, Router, Visibility, Cancel, Stop } from '@mui/icons-material';
import { useSocket } from '../common/socket.jsx';
import {
    cancelRunningObservation,
    setDialogOpen,
    setMonitoredSatelliteDialogOpen,
    setSelectedMonitoredSatellite,
    setSelectedObservation
} from './scheduler-slice.jsx';
import { getFlattenedTasks, getSessionSdrs } from './session-utils.js';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { formatTime as formatTimeHelper } from '../../utils/date-time.js';

/**
 * Compact banner showing either:
 * - Currently running observation with details
 * - Next upcoming observation with countdown
 */
export default function ObservationStatusBanner() {
    const dispatch = useDispatch();
    const { t } = useTranslation('common');
    const { socket } = useSocket();
    const observations = useSelector((state) => state.scheduler.observations);
    const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
    const [selectedObservationForAction, setSelectedObservationForAction] = useState(null);
    const [now, setNow] = useState(() => new Date());
    const { timezone, locale } = useUserTimeSettings();

    const { runningObservations, nextObservation } = useMemo(() => {
        const currentTime = new Date();
        const running = observations.filter((obs) => obs.status === 'running' && obs.enabled);

        // Find next enabled scheduled observation
        const upcoming = observations
            .filter((obs) => {
                if (!obs.enabled || obs.status !== 'scheduled' || !obs.pass) return false;
                // Use task_start (root level) if available, fallback to event_start (in pass)
                return obs.task_start || obs.pass.event_start;
            })
            .map((obs) => ({
                ...obs,
                // Use task_start (root level) if available, fallback to event_start (in pass)
                startTime: new Date(obs.task_start || obs.pass.event_start),
            }))
            .filter((obs) => obs.startTime > currentTime)
            .sort((a, b) => a.startTime - b.startTime)[0];

        return { runningObservations: running, nextObservation: upcoming };
    }, [observations]);

    const hasRunning = runningObservations.length > 0;
    const selectedIsRunning = selectedObservationForAction?.status === 'running';

    useEffect(() => {
        const interval = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(interval);
    }, []);

    // Handler to open confirmation dialog
    const handleCancelClick = (observation) => {
        setSelectedObservationForAction(observation);
        setConfirmDialogOpen(true);
    };

    // Handler for confirming cancellation
    const handleConfirmCancel = () => {
        if (!selectedObservationForAction?.id) {
            setConfirmDialogOpen(false);
            setSelectedObservationForAction(null);
            return;
        }
        if (socket) {
            dispatch(cancelRunningObservation({ socket, id: selectedObservationForAction.id }));
        }
        setConfirmDialogOpen(false);
        setSelectedObservationForAction(null);
    };

    // Handler for closing dialog
    const handleCloseDialog = () => {
        setConfirmDialogOpen(false);
        setSelectedObservationForAction(null);
    };

    const handleCreateObservation = () => {
        dispatch(setSelectedObservation(null));
        dispatch(setDialogOpen(true));
    };

    const handleCreateMonitoredSatellite = () => {
        dispatch(setSelectedMonitoredSatellite(null));
        dispatch(setMonitoredSatelliteDialogOpen(true));
    };


    // Show banner even if nothing to display
    if (!hasRunning && !nextObservation) {
        return (
            <Paper
                elevation={2}
                sx={{
                    p: 2,
                    background: 'linear-gradient(135deg, rgba(158, 158, 158, 0.15) 0%, rgba(158, 158, 158, 0.10) 100%)',
                    borderLeft: '4px solid #9e9e9e',
                }}
            >
                <Box
                    sx={{
                        display: 'flex',
                        flexDirection: { xs: 'column', sm: 'row' },
                        alignItems: { xs: 'stretch', sm: 'center' },
                        justifyContent: 'space-between',
                        gap: 2,
                    }}
                >
                    <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        alignItems={{ xs: 'flex-start', sm: 'center' }}
                        spacing={2}
                        sx={{ minWidth: 0 }}
                    >
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Satellite sx={{ color: 'text.secondary', fontSize: 20 }} />
                            <Typography variant="body2" fontWeight={600} color="text.secondary">
                                {t('scheduler_banner.no_scheduled_observations')}
                            </Typography>
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                            {t('scheduler_banner.no_active_or_upcoming')}
                        </Typography>
                    </Stack>
                    <Box
                        sx={{
                            marginLeft: { xs: 0, sm: 'auto' },
                            width: { xs: '100%', sm: 'auto' },
                            display: 'flex',
                            gap: 1,
                            justifyContent: { xs: 'flex-start', sm: 'flex-end' },
                            flexWrap: 'wrap',
                        }}
                    >
                        <Button
                            size="small"
                            variant="outlined"
                            onClick={handleCreateMonitoredSatellite}
                        >
                            {t('scheduler_banner.add_monitored_satellite')}
                        </Button>
                        <Button
                            size="small"
                            variant="outlined"
                            onClick={handleCreateObservation}
                        >
                            {t('scheduler_banner.create_observation')}
                        </Button>
                    </Box>
                </Box>
            </Paper>
        );
    }

    // Format start/end times
    const formatTime = (isoString) => {
        if (!isoString) return '';
        return formatTimeHelper(isoString, {
            timezone,
            locale,
            options: { hour: '2-digit', minute: '2-digit' },
        });
    };

    const getCountdown = (observation) => {
        if (!observation?.pass) return '';
        if (observation.status === 'running') {
            const endTime = new Date(observation.task_end || observation.pass.event_end);
            const remainingMs = endTime.getTime() - now.getTime();
            if (remainingMs <= 0) return t('scheduler_banner.ending_soon');
            const hours = Math.floor(remainingMs / 3600000);
            const minutes = Math.floor((remainingMs % 3600000) / 60000);
            const seconds = Math.floor((remainingMs % 60000) / 1000);
            if (hours > 0) return t('scheduler_banner.remaining_hms', { hours, minutes, seconds });
            if (minutes > 0) return t('scheduler_banner.remaining_ms', { minutes, seconds });
            return t('scheduler_banner.remaining_s', { seconds });
        }
        const startTime = new Date(observation.task_start || observation.pass.event_start);
        const untilMs = startTime.getTime() - now.getTime();
        if (untilMs <= 0) return t('scheduler_banner.starting_soon');
        const hours = Math.floor(untilMs / 3600000);
        const minutes = Math.floor((untilMs % 3600000) / 60000);
        const seconds = Math.floor((untilMs % 60000) / 1000);
        if (hours > 24) {
            const days = Math.floor(hours / 24);
            return t('scheduler_banner.in_days_hours', { days, hours: hours % 24 });
        }
        if (hours > 0) return t('scheduler_banner.in_hours_minutes', { hours, minutes });
        return t('scheduler_banner.in_minutes_seconds', { minutes, seconds });
    };

    const getTaskSummary = (observation) => {
        const tasks = getFlattenedTasks(observation);
        if (!tasks.length) return '';
        const decoderTasks = tasks.filter((t) => t.type === 'decoder').length;
        const recordingTasks = tasks.filter((t) => t.type === 'iq_recording' || t.type === 'audio_recording').length;
        const transcriptionTasks = tasks.filter((t) => t.type === 'transcription').length;
        const parts = [];
        if (decoderTasks > 0) parts.push(t('scheduler_banner.task_summary.decoder', { count: decoderTasks }));
        if (recordingTasks > 0) parts.push(t('scheduler_banner.task_summary.recording', { count: recordingTasks }));
        if (transcriptionTasks > 0) parts.push(t('scheduler_banner.task_summary.transcription', { count: transcriptionTasks }));
        return parts.join(', ');
    };

    const isSatelliteVisible = (observation) => {
        if (!observation?.pass || observation.status === 'running') return false;
        const eventStart = new Date(observation.pass.event_start);
        const taskStart = new Date(observation.task_start || observation.pass.event_start);
        return now >= eventStart && now < taskStart;
    };

    return (
        <Paper
            elevation={2}
            sx={{
                p: 2,
                background: hasRunning
                    ? 'linear-gradient(135deg, rgba(76, 175, 80, 0.25) 0%, rgba(76, 175, 80, 0.15) 100%)'
                    : 'linear-gradient(135deg, rgba(33, 150, 243, 0.25) 0%, rgba(33, 150, 243, 0.15) 100%)',
                borderLeft: hasRunning ? '4px solid #4caf50' : '4px solid #2196f3',
            }}
        >
            <Stack
                direction="row"
                alignItems="center"
                spacing={2}
                flexWrap="wrap"
                sx={{ position: 'relative' }}
            >
                {/* Status indicator */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {hasRunning ? (
                        <RadioButtonChecked sx={{ color: '#4caf50', fontSize: 20 }} />
                    ) : (
                        <AccessTime sx={{ color: '#2196f3', fontSize: 20 }} />
                    )}
                    <Typography variant="body2" fontWeight={600} color="text.secondary">
                        {hasRunning
                            ? t('scheduler_banner.running_now_count', { count: runningObservations.length })
                            : t('scheduler_banner.next_observation')}
                    </Typography>
                </Box>

                {hasRunning ? (
                    (() => {
                        const observation = runningObservations[0];
                        const additionalRunning = Math.max(runningObservations.length - 1, 0);
                        const startTime = formatTime(observation.task_start || observation.pass?.event_start);
                        const endTime = formatTime(observation.task_end || observation.pass?.event_end);
                        const sdrs = getSessionSdrs(observation);
                        const taskSummary = getTaskSummary(observation);
                        return (
                            <>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                                    <Typography variant="body1" fontWeight={600}>
                                        {observation.satellite?.name || t('unknown')}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        ({observation.satellite?.norad_id || t('not_available')})
                                    </Typography>
                                    {additionalRunning > 0 && (
                                        <Chip
                                            label={`+${additionalRunning}`}
                                            size="small"
                                            variant="outlined"
                                            sx={{ fontWeight: 700 }}
                                        />
                                    )}
                                </Box>
                                <Chip
                                    label={getCountdown(observation)}
                                    size="small"
                                    sx={{ bgcolor: 'rgba(76, 175, 80, 0.2)', fontWeight: 600 }}
                                />
                                {startTime && endTime && (
                                    <Typography variant="body2" color="text.secondary">
                                        {startTime} - {endTime}
                                    </Typography>
                                )}
                                {observation.pass?.peak_altitude && (
                                    <Chip
                                        label={t('scheduler_banner.peak_label', { value: observation.pass.peak_altitude.toFixed(0) })}
                                        size="small"
                                        variant="outlined"
                                    />
                                )}
                                {sdrs.length > 0 && (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <Router sx={{ fontSize: 16, color: 'text.secondary' }} />
                                        <Typography variant="body2" color="text.secondary">
                                            {sdrs.length === 1 ? sdrs[0]?.name : t('scheduler_banner.sdr_count', { count: sdrs.length })}
                                        </Typography>
                                    </Box>
                                )}
                                {taskSummary && (
                                    <Typography variant="body2" color="text.secondary">
                                        {taskSummary}
                                    </Typography>
                                )}
                                <Box
                                    sx={{
                                        marginLeft: { xs: 0, sm: 'auto' },
                                        width: { xs: '100%', sm: 'auto' },
                                        display: 'flex',
                                        justifyContent: { xs: 'flex-end', sm: 'flex-start' },
                                    }}
                                >
                                    <Tooltip title={t('scheduler_banner.stop_observation_tooltip')}>
                                        <Button
                                            variant="outlined"
                                            size="small"
                                            color="error"
                                            startIcon={<Stop />}
                                            onClick={() => handleCancelClick(observation)}
                                        >
                                            {t('scheduler_banner.stop')}
                                        </Button>
                                    </Tooltip>
                                </Box>
                                {nextObservation && (
                                    <Typography variant="body2" color="text.secondary">
                                        {t('scheduler_banner.next_up_label')}: <strong>{nextObservation.satellite?.name || t('unknown')}</strong> ({nextObservation.satellite?.norad_id || t('not_available')}) {getCountdown(nextObservation)}
                                    </Typography>
                                )}
                            </>
                        );
                    })()
                ) : (
                    (() => {
                        const observation = nextObservation;
                        const startTime = formatTime(observation.task_start || observation.pass?.event_start);
                        const endTime = formatTime(observation.task_end || observation.pass?.event_end);
                        const countdown = getCountdown(observation);
                        const visible = isSatelliteVisible(observation);
                        const sdrs = getSessionSdrs(observation);
                        const taskSummary = getTaskSummary(observation);
                        return (
                            <>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
                                    <Typography variant="body1" fontWeight={600}>
                                        {observation.satellite?.name || t('unknown')}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        ({observation.satellite?.norad_id || t('not_available')})
                                    </Typography>
                                </Box>
                                {countdown && (
                                    <Chip
                                        label={countdown}
                                        size="small"
                                        sx={{
                                            bgcolor: 'rgba(33, 150, 243, 0.2)',
                                            fontWeight: 600,
                                        }}
                                    />
                                )}
                                {visible && (
                                    <Chip
                                        icon={<Visibility sx={{ fontSize: 16 }} />}
                                        label={t('scheduler_banner.satellite_visible')}
                                        size="small"
                                        color="success"
                                        variant="outlined"
                                        sx={{ fontWeight: 600, borderWidth: 2 }}
                                    />
                                )}
                                {startTime && endTime && (
                                    <Typography variant="body2" color="text.secondary">
                                        {startTime} - {endTime}
                                    </Typography>
                                )}
                                {observation.pass?.peak_altitude && (
                                    <Chip
                                        label={t('scheduler_banner.peak_label', { value: observation.pass.peak_altitude.toFixed(0) })}
                                        size="small"
                                        variant="outlined"
                                    />
                                )}
                                {sdrs.length > 0 && (
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                        <Router sx={{ fontSize: 16, color: 'text.secondary' }} />
                                        <Typography variant="body2" color="text.secondary">
                                            {sdrs.length === 1 ? sdrs[0]?.name : t('scheduler_banner.sdr_count', { count: sdrs.length })}
                                        </Typography>
                                    </Box>
                                )}
                                {taskSummary && (
                                    <Typography variant="body2" color="text.secondary">
                                        {taskSummary}
                                    </Typography>
                                )}
                                {observation.name && observation.name !== observation.satellite?.name && (
                                    <Typography variant="body2" color="text.secondary" fontStyle="italic">
                                        "{observation.name}"
                                    </Typography>
                                )}
                                <Box
                                    sx={{
                                        marginLeft: { xs: 0, sm: 'auto' },
                                        width: { xs: '100%', sm: 'auto' },
                                        display: 'flex',
                                        justifyContent: { xs: 'flex-end', sm: 'flex-start' },
                                    }}
                                >
                                    <Tooltip title={t('scheduler_banner.abort_scheduled_tooltip')}>
                                        <Button
                                            variant="outlined"
                                            size="small"
                                            color="error"
                                            startIcon={<Cancel />}
                                            onClick={() => handleCancelClick(observation)}
                                        >
                                            {t('scheduler_banner.abort')}
                                        </Button>
                                    </Tooltip>
                                </Box>
                            </>
                        );
                    })()
                )}
            </Stack>

            {/* Confirmation Dialog */}
            <Dialog open={confirmDialogOpen} onClose={handleCloseDialog}>
                <DialogTitle>
                    {selectedIsRunning ? t('scheduler_banner.stop_observation_title') : t('scheduler_banner.abort_observation_title')}
                </DialogTitle>
                <DialogContent
                    sx={{
                        pt: '24px !important',
                        bgcolor: (theme) => (
                            theme.palette.mode === 'dark'
                                ? theme.palette.background.elevated
                                : theme.palette.background.paper
                        ),
                    }}
                >
                    <DialogContentText>
                        {selectedIsRunning ? (
                            <>
                                {t('scheduler_banner.stop_confirm_question', { name: selectedObservationForAction?.satellite?.name || t('unknown') })}
                                <br />
                                {t('scheduler_banner.stop_confirm_warning')}
                            </>
                        ) : (
                            <>
                                {t('scheduler_banner.abort_confirm_question', { name: selectedObservationForAction?.satellite?.name || t('unknown') })}
                                <br />
                                {t('scheduler_banner.abort_confirm_warning')}
                            </>
                        )}
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleCloseDialog}>
                        {t('cancel')}
                    </Button>
                    <Button
                        onClick={handleConfirmCancel}
                        color="error"
                        variant="contained"
                    >
                        {selectedIsRunning ? t('scheduler_banner.stop') : t('scheduler_banner.abort')}
                    </Button>
                </DialogActions>
            </Dialog>
        </Paper>
    );
}
