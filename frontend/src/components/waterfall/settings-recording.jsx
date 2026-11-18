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
import { useSelector } from 'react-redux';
import {
    Accordion,
    AccordionSummary,
    AccordionDetails,
} from './settings-elements.jsx';
import Typography from '@mui/material/Typography';
import {
    Box,
    Button,
    TextField,
    Chip,
    Stack,
    LinearProgress,
    FormControl,
    InputLabel,
    MenuItem,
    Select,
} from "@mui/material";
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import StopIcon from '@mui/icons-material/Stop';
import { useTranslation } from 'react-i18next';
import CapsButton from '../common/capsbutton.jsx';

const RECORDING_BAND_DRAG_STEPS = [100, 1000, 5000, 10000];

const RecordingAccordion = ({
    expanded,
    onAccordionChange,
    isRecording,
    recordingDuration,
    recordingName,
    actualRecordingName,
    onRecordingNameChange,
    onStartRecording,
    onStopRecording,
    isStreaming,
    selectedSDRId,
    centerFrequency,
    sampleRate,
    decimationFactor,
    onDecimationFactorChange,
    recordingBandSelectionEnabled,
    onRecordingBandSelectionToggle,
    recordingBandCenterOffsetHz,
    onRecordingBandCenterFrequencyChange,
    recordingBandDragStepHz,
    onRecordingBandDragStepChange,
    storageFormat,
    onStorageFormatChange,
}) => {
    const { t } = useTranslation('waterfall');
    const [localRecordingName, setLocalRecordingName] = useState(recordingName);
    const [recordingStartFilename, setRecordingStartFilename] = useState('');
    const [localRecordingCenterMHz, setLocalRecordingCenterMHz] = useState('');
    const isRecordingCenterFieldFocused = useRef(false);

    // Get target satellite name from Redux
    const targetSatelliteName = useSelector((state) => state.targetSatTrack?.satelliteData?.details?.name || '');

    // Get disk usage from Redux
    const diskUsage = useSelector((state) => state.filebrowser?.diskUsage || { total: 0, used: 0, available: 0 });

    useEffect(() => {
        setLocalRecordingName(recordingName);
    }, [recordingName]);

    const recordingCenterFrequencyHz = Number(centerFrequency) + (Number(recordingBandCenterOffsetHz) || 0);

    useEffect(() => {
        if (!isRecordingCenterFieldFocused.current && Number.isFinite(recordingCenterFrequencyHz)) {
            setLocalRecordingCenterMHz((recordingCenterFrequencyHz / 1e6).toFixed(6));
        }
    }, [recordingCenterFrequencyHz]);

    // Clear textbox when recording stops
    useEffect(() => {
        if (!isRecording && localRecordingName) {
            setLocalRecordingName('');
            onRecordingNameChange('');
        }
    }, [isRecording]);

    const decimationOptions = useMemo(() => {
        const inputRate = Number(sampleRate);
        if (!Number.isFinite(inputRate) || inputRate <= 0) return [1];

        const maxFactor = Math.min(40, Math.floor(inputRate / 1000));
        const options = Array.from({ length: maxFactor }, (_, index) => index + 1)
            .filter((factor) => inputRate % factor === 0);
        return options.length > 0 ? options : [1];
    }, [sampleRate]);

    useEffect(() => {
        if (!decimationOptions.includes(decimationFactor)) {
            onDecimationFactorChange(1);
        }
    }, [decimationFactor, decimationOptions, onDecimationFactorChange]);

    const formatDuration = (seconds) => {
        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        if (hours > 0) {
            return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${minutes}:${secs.toString().padStart(2, '0')}`;
    };

    const generateTimestamp = () => {
        const now = new Date();
        const date = now.toISOString().split('T')[0].replace(/-/g, '');
        const time = now.toTimeString().split(' ')[0].replace(/:/g, '');
        return `${date}_${time}`;
    };

    const formatFrequencyShort = (freqHz) => {
        const freqMHz = freqHz / 1e6;
        // Replace decimal point with underscore for filename compatibility
        return `${freqMHz.toFixed(3).replace('.', '_')}MHz`;
    };

    const sanitizeFilename = (name) => {
        // Replace spaces and special characters with underscores, keep only alphanumeric, dash, underscore
        return name.replace(/[^a-zA-Z0-9\-_]/g, '_').replace(/_+/g, '_');
    };

    const handleStartRecording = () => {
        let baseName = localRecordingName.trim();

        // If empty, generate name: <satellite-name>-<center-freq>-<timestamp>
        if (!baseName) {
            const satName = sanitizeFilename(targetSatelliteName || 'unknown');
            const freqShort = formatFrequencyShort(centerFrequency);
            const timestamp = generateTimestamp();
            baseName = `${satName}-${freqShort}-${timestamp}`;
        } else {
            // Sanitize user-provided name
            baseName = sanitizeFilename(baseName);
        }

        // Generate the actual filename with timestamp (matching backend logic)
        const timestamp = generateTimestamp();
        const actualFilename = `${baseName}_${timestamp}`;

        // Store the actual filename for display during recording
        setRecordingStartFilename(actualFilename);

        // Update Redux state with the name
        onRecordingNameChange(baseName);

        // Pass the base name directly to avoid race condition with Redux state update
        onStartRecording(baseName);
    };

    const handleNameChange = (e) => {
        const value = e.target.value;
        setLocalRecordingName(value);
        onRecordingNameChange(value);
    };

    const canStartRecording = isStreaming && !isRecording && selectedSDRId !== "none" && selectedSDRId !== "sigmf-playback";

    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
    };

    const formatSampleRate = (rate) => {
        if (rate >= 1000000) return `${(rate / 1000000).toFixed(rate % 1000000 === 0 ? 0 : 1)} MHz`;
        return `${Math.round(rate / 1000)} kS/s`;
    };

    const inputRate = Number(sampleRate);
    const outputRate = Number.isFinite(inputRate) && inputRate > 0
        ? inputRate / decimationFactor
        : null;

    const usagePercent = diskUsage.total > 0 ? ((diskUsage.used / diskUsage.total) * 100) : 0;

    const handleRecordingCenterFrequencyChange = (event) => {
        const value = event.target.value;
        setLocalRecordingCenterMHz(value);
        const frequencyHz = Number(value) * 1e6;
        if (Number.isFinite(frequencyHz)) {
            onRecordingBandCenterFrequencyChange(frequencyHz);
        }
    };

    const normalizeRecordingCenterFrequency = () => {
        isRecordingCenterFieldFocused.current = false;
        if (Number.isFinite(recordingCenterFrequencyHz)) {
            setLocalRecordingCenterMHz((recordingCenterFrequencyHz / 1e6).toFixed(6));
        }
    };

    return (
        <Accordion expanded={expanded} onChange={onAccordionChange}>
            <AccordionSummary
                sx={{
                    boxShadow: '-1px 4px 7px #00000059',
                    ...(isRecording && { backgroundColor: 'rgba(255, 0, 0, 0.1)' }),
                }}
                aria-controls="panel-recording-content"
                id="panel-recording-header"
            >
                <Stack direction="row" spacing={1} alignItems="center" width="100%" justifyContent="space-between">
                    <Typography component="span">
                        {t('recording.title', 'IQ Recording')}
                    </Typography>
                    {isRecording && (
                        <Chip
                            icon={<FiberManualRecordIcon />}
                            label={formatDuration(recordingDuration)}
                            color="error"
                            size="small"
                            sx={{
                                animation: 'pulse 2s ease-in-out infinite',
                                '@keyframes pulse': {
                                    '0%, 100%': { opacity: 1 },
                                    '50%': { opacity: 0.6 },
                                },
                                fontWeight: 'bold',
                            }}
                        />
                    )}
                </Stack>
            </AccordionSummary>
            <AccordionDetails
                sx={{
                    backgroundColor: 'background.elevated',
                }}
            >
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <TextField
                        label={t('recording.filename', 'Recording Name')}
                        value={localRecordingName}
                        onChange={handleNameChange}
                        disabled={isRecording}
                        size="small"
                        fullWidth
                        variant="outlined"
                        placeholder="unknown_recording"
                    />

                    <FormControl fullWidth size="small" disabled={isRecording || !outputRate}>
                        <InputLabel id="recording-sample-rate-label">
                            {t('recording.sampleRate', 'Recorded Sample Rate')}
                        </InputLabel>
                        <Select
                            labelId="recording-sample-rate-label"
                            value={decimationOptions.includes(decimationFactor) ? decimationFactor : 1}
                            label={t('recording.sampleRate', 'Recorded Sample Rate')}
                            onChange={(event) => onDecimationFactorChange(Number(event.target.value))}
                        >
                            {decimationOptions.map((factor) => (
                                <MenuItem key={factor} value={factor}>
                                    {factor === 1
                                        ? t('recording.fullBandwidth', {
                                            rate: formatSampleRate(inputRate),
                                            defaultValue: `Full bandwidth (${formatSampleRate(inputRate)})`,
                                        })
                                        : `${formatSampleRate(inputRate / factor)} (÷${factor})`}
                                </MenuItem>
                            ))}
                        </Select>
                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                            {recordingBandSelectionEnabled
                                ? t(
                                    'recording.selectedBandwidthHelp',
                                    'Recording-band selection is enabled. Drag the highlighted band in the bandscope before recording.'
                                )
                                : decimationFactor > 1
                                ? t(
                                    'recording.centeredBandwidthHelp',
                                    'Records the centered portion of the SDR spectrum. Center the signal before recording.'
                                )
                                : t('recording.fullBandwidthHelp', 'Records the full SDR spectrum.')}
                        </Typography>
                    </FormControl>

                    <Stack direction="row" spacing={1}>
                        <TextField
                            label={t('recording.centerFrequency', 'Recording Centre (MHz)')}
                            value={localRecordingCenterMHz}
                            onFocus={() => { isRecordingCenterFieldFocused.current = true; }}
                            onChange={handleRecordingCenterFrequencyChange}
                            onBlur={normalizeRecordingCenterFrequency}
                            type="number"
                            disabled={!recordingBandSelectionEnabled || isRecording}
                            inputProps={{ step: 0.000001 }}
                            size="small"
                            fullWidth
                        />
                        <FormControl size="small" sx={{ minWidth: 130 }} disabled={!recordingBandSelectionEnabled || isRecording}>
                            <InputLabel id="recording-band-step-label">
                                {t('recording.dragStep', 'Drag Step')}
                            </InputLabel>
                            <Select
                                labelId="recording-band-step-label"
                                value={recordingBandDragStepHz}
                                label={t('recording.dragStep', 'Drag Step')}
                                onChange={(event) => onRecordingBandDragStepChange(Number(event.target.value))}
                            >
                                {RECORDING_BAND_DRAG_STEPS.map((stepHz) => (
                                    <MenuItem key={stepHz} value={stepHz}>
                                        {stepHz >= 1000 ? `${stepHz / 1000} kHz` : `${stepHz} Hz`}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Stack>

                    <FormControl fullWidth size="small" disabled={isRecording}>
                        <InputLabel id="recording-storage-format-label">
                            {t('recording.storageFormat', 'IQ Storage Format')}
                        </InputLabel>
                        <Select
                            labelId="recording-storage-format-label"
                            value={storageFormat}
                            label={t('recording.storageFormat', 'IQ Storage Format')}
                            onChange={(event) => onStorageFormatChange(event.target.value)}
                        >
                            <MenuItem value="cf32_le">
                                {t('recording.storageFormatFloat', '32-bit float IQ (cf32_le)')}
                            </MenuItem>
                            <MenuItem value="ci16_le">
                                {t('recording.storageFormatInt16', '16-bit signed IQ (ci16_le)')}
                            </MenuItem>
                        </Select>
                        {storageFormat === 'cf32_le' ? (
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                                {t('recording.storageFormatFloatHelp', 'Lossless, full-precision IQ. Uses twice the disk space of ci16_le.')}
                            </Typography>
                        ) : (
                            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                                {t('recording.storageFormatInt16Help', '50% smaller. Lossy only if exceptionally strong samples clip.')}
                            </Typography>
                        )}
                    </FormControl>

                    {/* Disk Space Progress Bar */}
                    {diskUsage.total > 0 && (
                        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                                <Typography variant="caption" color="text.secondary">
                                    {t('recording.diskSpace', 'Disk Space')}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                    {formatBytes(diskUsage.available)} {t('recording.available', 'available')} / {formatBytes(diskUsage.total)}
                                </Typography>
                            </Stack>
                            <LinearProgress
                                variant="determinate"
                                value={usagePercent}
                                sx={{
                                    height: 8,
                                    borderRadius: 1,
                                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                    '& .MuiLinearProgress-bar': {
                                        borderRadius: 1,
                                        backgroundColor: usagePercent > 90 ? 'error.main' : usagePercent > 75 ? 'warning.main' : 'success.main',
                                    },
                                }}
                            />
                        </Box>
                    )}

                    <Stack direction="row" spacing={1}>
                        <CapsButton
                            variant={recordingBandSelectionEnabled ? 'contained' : 'outlined'}
                            color={recordingBandSelectionEnabled ? 'warning' : 'primary'}
                            onClick={onRecordingBandSelectionToggle}
                            disabled={isRecording}
                            fullWidth
                        >
                            {recordingBandSelectionEnabled
                                ? t('recording.disableBandSelection', 'DISABLE')
                                : t('recording.enableBandSelection', 'ENABLE')}
                        </CapsButton>
                        <CapsButton
                            variant="contained"
                            color="error"
                            startIcon={<FiberManualRecordIcon />}
                            onClick={handleStartRecording}
                            disabled={!canStartRecording}
                            fullWidth
                        >
                            {t('recording.start', 'REC')}
                        </CapsButton>
                        <CapsButton
                            variant="outlined"
                            color="inherit"
                            startIcon={<StopIcon />}
                            onClick={onStopRecording}
                            disabled={!isRecording}
                            fullWidth
                        >
                            {t('recording.stop', 'Stop')}
                        </CapsButton>
                    </Stack>
                </Box>
            </AccordionDetails>
        </Accordion>
    );
};

function areRecordingAccordionPropsEqual(prevProps, nextProps) {
    return (
        prevProps.expanded === nextProps.expanded &&
        prevProps.onAccordionChange === nextProps.onAccordionChange &&
        prevProps.isRecording === nextProps.isRecording &&
        prevProps.recordingDuration === nextProps.recordingDuration &&
        prevProps.recordingName === nextProps.recordingName &&
        prevProps.actualRecordingName === nextProps.actualRecordingName &&
        prevProps.onRecordingNameChange === nextProps.onRecordingNameChange &&
        prevProps.onStartRecording === nextProps.onStartRecording &&
        prevProps.onStopRecording === nextProps.onStopRecording &&
        prevProps.isStreaming === nextProps.isStreaming &&
        prevProps.selectedSDRId === nextProps.selectedSDRId &&
        prevProps.centerFrequency === nextProps.centerFrequency &&
        prevProps.sampleRate === nextProps.sampleRate &&
        prevProps.decimationFactor === nextProps.decimationFactor &&
        prevProps.onDecimationFactorChange === nextProps.onDecimationFactorChange &&
        prevProps.recordingBandSelectionEnabled === nextProps.recordingBandSelectionEnabled &&
        prevProps.onRecordingBandSelectionToggle === nextProps.onRecordingBandSelectionToggle &&
        prevProps.recordingBandCenterOffsetHz === nextProps.recordingBandCenterOffsetHz &&
        prevProps.onRecordingBandCenterFrequencyChange === nextProps.onRecordingBandCenterFrequencyChange &&
        prevProps.recordingBandDragStepHz === nextProps.recordingBandDragStepHz &&
        prevProps.onRecordingBandDragStepChange === nextProps.onRecordingBandDragStepChange &&
        prevProps.storageFormat === nextProps.storageFormat &&
        prevProps.onStorageFormatChange === nextProps.onStorageFormatChange
    );
}

export default React.memo(RecordingAccordion, areRecordingAccordionPropsEqual);
