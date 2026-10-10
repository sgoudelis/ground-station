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

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
    Typography,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    TextField,
    FormControlLabel,
    Switch,
    Divider,
    Chip,
    LinearProgress,
    Stack,
    Paper,
} from '@mui/material';
import BuildIcon from '@mui/icons-material/Build';
import PlaylistPlayIcon from '@mui/icons-material/PlaylistPlay';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import CancelIcon from '@mui/icons-material/Cancel';
import { useSocket } from '../common/socket.jsx';
import { startBackgroundTask } from './filebrowser-slice.jsx';
import { getSatdumpPipelines } from '../waterfall/decoder-parameters.js';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';

const getRecordingBaseName = (recordingName) => {
    if (!recordingName) return '';
    if (recordingName.endsWith('.sigmf-data')) {
        return recordingName.slice(0, -12);
    }
    if (recordingName.endsWith('.sigmf-meta')) {
        return recordingName.slice(0, -12);
    }
    return recordingName;
};

// Parse ANSI color codes into renderable text parts for terminal-style output.
const parseAnsiColors = (text = '') => {
    const normalized = String(text).replace(/\uFFFD/g, '').replaceAll('\u001b', '');
    const ansiRegex = /\[(\d*(?:;\d+)*)m/g;
    const parts = [];
    let lastIndex = 0;
    let currentColor = null;
    let currentBold = false;

    for (const match of normalized.matchAll(ansiRegex)) {
        if (match.index > lastIndex) {
            parts.push({
                text: normalized.substring(lastIndex, match.index),
                color: currentColor,
                bold: currentBold,
            });
        }

        const codes = match[1] ? match[1].split(';') : ['0'];
        for (const code of codes) {
            if (code === '0') {
                currentColor = null;
                currentBold = false;
            } else if (code === '1') {
                currentBold = true;
            } else if (code === '22') {
                currentBold = false;
            } else if (code === '30') currentColor = '#000000';
            else if (code === '31') currentColor = '#ff4444';
            else if (code === '32') currentColor = '#44ff44';
            else if (code === '33') currentColor = '#ffff44';
            else if (code === '34') currentColor = '#4444ff';
            else if (code === '35') currentColor = '#ff44ff';
            else if (code === '36') currentColor = '#44ffff';
            else if (code === '37') currentColor = '#ffffff';
            else if (code === '90') currentColor = '#666666';
            else if (code === '91') currentColor = '#ff6666';
            else if (code === '92') currentColor = '#66ff66';
            else if (code === '93') currentColor = '#ffff66';
            else if (code === '94') currentColor = '#6666ff';
            else if (code === '95') currentColor = '#ff66ff';
            else if (code === '96') currentColor = '#66ffff';
            else if (code === '97') currentColor = '#ffffff';
        }

        lastIndex = match.index + match[0].length;
    }

    if (lastIndex < normalized.length) {
        parts.push({
            text: normalized.substring(lastIndex),
            color: currentColor,
            bold: currentBold,
        });
    }

    return parts;
};

export default function ProcessingDialog({ open, onClose, recording }) {
    // 同上：本组件用 filebrowser，同时需要解析 decoder-parameters.js 的 waterfall 键
    const { t } = useTranslation(['filebrowser', 'waterfall']);

    // Defined inside the component so the labels can use this component's `t`.
    const BASEBAND_FORMATS = [
        { value: 'i16', label: t('processing_dialog.complex_int16_i16', { defaultValue: 'Complex Int16 (i16)' }) },
        { value: 'i8', label: t('processing_dialog.complex_int8_i8', { defaultValue: 'Complex Int8 (i8)' }) },
        { value: 'f32', label: t('processing_dialog.complex_float32_f32', { defaultValue: 'Complex Float32 (f32)' }) },
        { value: 'w16', label: t('processing_dialog.complex_int16_wav_w16', { defaultValue: 'Complex Int16 WAV (w16)' }) },
        { value: 'w8', label: t('processing_dialog.complex_int8_wav_w8', { defaultValue: 'Complex Int8 WAV (w8)' }) },
    ];

    const { socket } = useSocket();
    const dispatch = useDispatch();
    const { tasks } = useSelector(state => state.backgroundTasks);

    // Helper function to map SigMF data type to SatDump baseband format
    const getSatDumpFormat = (datatype) => {
        if (!datatype) return 'i16';

        // SigMF format: "c" or "r" + type + "_" + size
        // Examples: ci16_le, cf32_le, ci8, etc.
        const lower = datatype.toLowerCase();

        if (lower.includes('ci16') || lower.includes('c16')) return 'i16';
        if (lower.includes('ci8') || lower.includes('c8')) return 'i8';
        if (lower.includes('cf32') || lower.includes('c32')) return 'f32';
        if (lower.includes('cu8')) return 'i8';

        // Default to i16 if unknown
        return 'i16';
    };

    const [selectedPipeline, setSelectedPipeline] = useState('meteor_m2-x_lrpt');
    const [basebandFormat, setBasebandFormat] = useState('i16');
    const [samplerate, setSamplerate] = useState(0);
    const [finishProcessing, setFinishProcessing] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [submittedTaskId, setSubmittedTaskId] = useState(null);
    const [showFullOutput, setShowFullOutput] = useState(false);
    const outputRef = useRef(null);

    // Update format and sample rate when recording changes
    useEffect(() => {
        if (recording?.metadata) {
            const detectedFormat = getSatDumpFormat(recording.metadata.datatype);
            const detectedSamplerate = recording.metadata.sample_rate || 0;

            console.log('Recording metadata:', {
                name: recording.name,
                datatype: recording.metadata.datatype,
                sample_rate: recording.metadata.sample_rate,
                detectedFormat,
                detectedSamplerate
            });

            setBasebandFormat(detectedFormat);
            setSamplerate(detectedSamplerate);
        }
    }, [recording]);

    useEffect(() => {
        if (!open) {
            setSubmittedTaskId(null);
        }
    }, [open]);

    const recordingBaseName = getRecordingBaseName(recording?.name);
    const expectedRecordingPath = recordingBaseName
        ? `/recordings/${recordingBaseName}.sigmf-data`
        : '';

    const matchingTask = useMemo(() => {
        if (!expectedRecordingPath) return null;
        const candidates = Object.values(tasks).filter(task => task?.args?.[0] === expectedRecordingPath);
        if (candidates.length === 0) return null;
        return candidates.reduce((latest, current) => {
            if (!latest) return current;
            return (current.start_time || 0) > (latest.start_time || 0) ? current : latest;
        }, null);
    }, [tasks, expectedRecordingPath]);

    const selectedTask = (submittedTaskId && tasks[submittedTaskId]) || matchingTask;
    const isTaskRunning = selectedTask?.status === 'running';
    const hasTask = Boolean(selectedTask);
    const outputLines = selectedTask?.output_lines || [];
    const visibleOutputLines = showFullOutput ? outputLines.slice(-1000) : outputLines.slice(-1);

    useEffect(() => {
        setShowFullOutput(false);
    }, [selectedTask?.task_id]);

    useEffect(() => {
        if (!outputRef.current || !showFullOutput) return;
        outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }, [outputLines.length, showFullOutput]);

    if (!recording) return null;

    const handleSubmit = async () => {
        if (!socket) {
            toast.error('Not connected to server');
            return;
        }

        setSubmitting(true);

        try {
            // Extract base name without .sigmf-data or .sigmf-meta extensions
            const baseName = getRecordingBaseName(recording.name);

            // Build recording path - use .sigmf-data file (the actual IQ data)
            const recordingPath = `/recordings/${baseName}.sigmf-data`;

            // Generate output directory matching SatDump naming convention
            // Format: SATELLITE_TIMESTAMP.satdump_PIPELINE
            const outputDir = `/decoded/${baseName}.satdump_${selectedPipeline}`;

            // Prepare task arguments
            const taskArgs = [recordingPath, outputDir, selectedPipeline];
            const taskKwargs = {
                samplerate: Number(samplerate),
                baseband_format: basebandFormat,
                finish_processing: finishProcessing,
            };

            // Submit task via Socket.IO
            const response = await dispatch(startBackgroundTask({
                socket,
                task_name: 'satdump_process',
                args: taskArgs,
                kwargs: taskKwargs,
                name: `SatDump: ${recording.name} (${selectedPipeline})`,
            })).unwrap();

            toast.success(`Processing task started: ${response.task_id}`);
            setSubmittedTaskId(response.task_id);
        } catch (error) {
            console.error('Error starting SatDump task:', error);
            toast.error(`Failed to start task: ${error.message}`);
        } finally {
            setSubmitting(false);
        }
    };

    const getStatusChip = (status) => {
        switch (status) {
            case 'running':
                return <Chip label={t('processing_dialog.running', { defaultValue: 'Running' })} size="small" color="info" icon={<PlaylistPlayIcon />} />;
            case 'completed':
                return <Chip label={t('processing_dialog.completed', { defaultValue: 'Completed' })} size="small" color="success" icon={<CheckCircleIcon />} />;
            case 'failed':
                return <Chip label={t('processing_dialog.failed', { defaultValue: 'Failed' })} size="small" color="error" icon={<ErrorIcon />} />;
            case 'stopped':
                return <Chip label={t('processing_dialog.stopped', { defaultValue: 'Stopped' })} size="small" color="warning" icon={<CancelIcon />} />;
            default:
                return <Chip label={status || 'Pending'} size="small" />;
        }
    };

    const formatDuration = (ms) => {
        if (!ms) return '';
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        }
        if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        }
        return `${seconds}s`;
    };

    const getTaskDuration = (task) => {
        if (!task?.start_time) return '';
        const startTimeMs = task.start_time * 1000;
        const endTimeMs = task.end_time ? task.end_time * 1000 : null;
        const durationMs = endTimeMs
            ? (task.duration ? task.duration * 1000 : endTimeMs - startTimeMs)
            : Date.now() - startTimeMs;
        return formatDuration(durationMs);
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
                    fontSize: '1.25rem',
                    fontWeight: 'bold',
                    py: 2.5,
                    px: 3,
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <BuildIcon color="primary" />
                        <Typography variant="h6">
                            {t('processing_dialog.process_iq_recording', { defaultValue: 'Process IQ Recording' })}
                        </Typography>
                    </Box>
                </Box>
                <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                    {recording.name}
                </Typography>
            </DialogTitle>

            <DialogContent
                sx={{
                    px: 3,
                    py: 3,
                }}
            >
                <Box sx={{ mt: 3 }}>
                    <Typography variant="subtitle2" gutterBottom>
                        {t('processing_dialog.satdump_processing', { defaultValue: 'SatDump Processing' })}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                        {t('processing_dialog.process_this_iq_recording_using_satdump_satellite_decode', { defaultValue: 'Process this IQ recording using SatDump satellite decoder' })}
                    </Typography>

                    <FormControl fullWidth size="small" sx={{ mb: 2 }} disabled={isTaskRunning}>
                        <InputLabel>{t('processing_dialog.satellite_pipeline', { defaultValue: 'Satellite / Pipeline' })}</InputLabel>
                        <Select
                            value={selectedPipeline}
                            label={t('processing_dialog.satellite_pipeline', { defaultValue: 'Satellite / Pipeline' })}
                            onChange={(e) => setSelectedPipeline(e.target.value)}
                            size="small"
                        >
                            {Object.entries(getSatdumpPipelines(t)).map(([key, group]) => {
                                const pipelines = group?.pipelines || [];
                                if (pipelines.length === 0) return null;
                                const label = group.label || key;
                                return [
                                    <MenuItem key={`header-${key}`} disabled sx={{ fontWeight: 'bold', fontSize: '0.875rem' }}>
                                        {label}
                                    </MenuItem>,
                                    ...pipelines.map((pipeline) => (
                                        <MenuItem key={pipeline.value} value={pipeline.value} sx={{ pl: 4 }}>
                                            {pipeline.label} ({pipeline.value})
                                        </MenuItem>
                                    ))
                                ];
                            })}
                        </Select>
                    </FormControl>

                    <FormControl fullWidth size="small" sx={{ mb: 2 }} disabled>
                        <InputLabel>{t('processing_dialog.baseband_format', { defaultValue: 'Baseband Format' })}</InputLabel>
                        <Select
                            value={basebandFormat}
                            label={t('processing_dialog.baseband_format', { defaultValue: 'Baseband Format' })}
                            onChange={(e) => setBasebandFormat(e.target.value)}
                            size="small"
                        >
                            {BASEBAND_FORMATS.map((format) => (
                                <MenuItem key={format.value} value={format.value}>
                                    {format.label}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    <TextField
                        fullWidth
                        label={t('processing_dialog.sample_rate_hz', { defaultValue: 'Sample Rate (Hz)' })}
                        type="number"
                        value={samplerate}
                        onChange={(e) => setSamplerate(e.target.value)}
                        disabled
                        size="small"
                        sx={{ mb: 2 }}
                    />

                    <FormControlLabel
                        control={
                            <Switch
                                checked={finishProcessing}
                                onChange={(e) => setFinishProcessing(e.target.checked)}
                            />
                        }
                        label={t('processing_dialog.generate_products_after_decoding', { defaultValue: 'Generate products after decoding' })}
                    />

                    {(hasTask || submitting) && (
                        <>
                            <Divider sx={{ my: 2 }} />
                            <Stack spacing={1.5}>
                                <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={2}>
                                    <Box>
                                        <Typography variant="subtitle2">
                                            {t('processing_dialog.background_task', { defaultValue: 'Background Task' })}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {t('processing_dialog.this_dialog_stays_open_to_show_task_updates_you_can_clos', { defaultValue: 'This dialog stays open to show task updates. You can close it anytime.' })}
                                        </Typography>
                                    </Box>
                                    {hasTask ? getStatusChip(selectedTask.status) : <Chip label={t('processing_dialog.starting', { defaultValue: 'Starting' })} size="small" />}
                                </Stack>

                                {hasTask && (
                                    <>
                                        <Typography
                                            variant="body2"
                                            noWrap
                                            title={selectedTask.name}
                                            sx={{ overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}
                                        >
                                            {selectedTask.name}
                                        </Typography>
                                        {selectedTask.status === 'running' ? (
                                            selectedTask.progress !== undefined && selectedTask.progress !== null ? (
                                                <Box>
                                                    <LinearProgress variant="determinate" value={selectedTask.progress} />
                                                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                                                        {t('processing_dialog.progress', { defaultValue: 'Progress:' })} {Math.round(selectedTask.progress)}%
                                                    </Typography>
                                                </Box>
                                            ) : (
                                                <LinearProgress />
                                            )
                                        ) : null}
                                        {getTaskDuration(selectedTask) && (
                                            <Typography variant="caption" color="text.secondary">
                                                {t('processing_dialog.duration', { defaultValue: 'Duration:' })} {getTaskDuration(selectedTask)}
                                                {selectedTask.return_code !== null && ` | Exit code: ${selectedTask.return_code}`}
                                            </Typography>
                                        )}

                                        <Divider />

                                        <Stack spacing={0.75}>
                                            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                                                <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>
                                                    {t('processing_dialog.task_output', { defaultValue: 'Task Output' })}
                                                </Typography>
                                                {outputLines.length > 1 && (
                                                    <Button
                                                        size="small"
                                                        variant="text"
                                                        onClick={() => setShowFullOutput((current) => !current)}
                                                        sx={{ minWidth: 0, px: 0.5 }}
                                                    >
                                                        {showFullOutput ? 'Show last line' : 'Show full output'}
                                                    </Button>
                                                )}
                                            </Stack>

                                            <Paper
                                                ref={outputRef}
                                                variant="outlined"
                                                sx={{
                                                    p: 1,
                                                    maxHeight: showFullOutput ? 220 : 42,
                                                    overflow: showFullOutput ? 'auto' : 'hidden',
                                                    bgcolor: (theme) => (theme.palette.mode === 'dark'
                                                        ? 'rgba(0, 0, 0, 0.35)'
                                                        : 'rgba(0, 0, 0, 0.2)'),
                                                    borderColor: 'divider',
                                                    borderRadius: 1,
                                                }}
                                            >
                                                {visibleOutputLines.length > 0 ? visibleOutputLines.map((line, idx) => {
                                                    const parts = parseAnsiColors(line.output);
                                                    return (
                                                        <Typography
                                                            key={`${idx}-${line.timestamp || idx}`}
                                                            variant="caption"
                                                            component="div"
                                                            sx={{
                                                                fontFamily: 'monospace',
                                                                lineHeight: 1.35,
                                                                whiteSpace: showFullOutput ? 'pre-wrap' : 'nowrap',
                                                                overflow: 'hidden',
                                                                textOverflow: 'ellipsis',
                                                            }}
                                                        >
                                                            {parts.map((part, partIdx) => (
                                                                <span
                                                                    key={partIdx}
                                                                    style={{
                                                                        color: part.color || 'inherit',
                                                                        fontWeight: part.bold ? 'bold' : 'normal',
                                                                    }}
                                                                >
                                                                    {part.text}
                                                                </span>
                                                            ))}
                                                        </Typography>
                                                    );
                                                }) : (
                                                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                                                        {t('processing_dialog.waiting_for_task_output', { defaultValue: 'Waiting for task output...' })}
                                                    </Typography>
                                                )}
                                            </Paper>
                                        </Stack>
                                    </>
                                )}
                            </Stack>
                        </>
                    )}

                    <Divider sx={{ my: 2 }} />

                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                        <Typography variant="body2" color="text.secondary">
                            <strong>{t('processing_dialog.note', { defaultValue: 'Note:' })}</strong> {t('processing_dialog.processing_will_run_in_the_background_you_can_monitor_pr', { defaultValue: 'Processing will run in the background. You can monitor progress in the Tasks panel.' })}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                            {t('processing_dialog.ensure_the_signal_is_centered_at_the_recording_s_center_', { defaultValue: 'ⓘ Ensure the signal is centered at the recording\'s center frequency for a successful decoding.' })}
                        </Typography>
                    </Box>
                </Box>
            </DialogContent>

            <DialogActions
                sx={{
                    bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100'),
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
                        borderColor: (theme) => (theme.palette.mode === 'dark' ? 'grey.700' : 'grey.400'),
                        '&:hover': {
                            borderColor: (theme) => (theme.palette.mode === 'dark' ? 'grey.600' : 'grey.500'),
                            bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.800' : 'grey.200'),
                        },
                    }}
                >
                    {hasTask ? 'Close' : 'Cancel'}
                </Button>
                <Button
                    onClick={handleSubmit}
                    color="success"
                    variant="contained"
                    disabled={submitting || isTaskRunning}
                    startIcon={<BuildIcon />}
                >
                    {submitting ? 'Starting...' : 'Start Processing'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
