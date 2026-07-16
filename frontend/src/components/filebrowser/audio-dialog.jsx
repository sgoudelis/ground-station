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

import React, { useRef, useEffect, useState } from 'react';
import {
    Box,
    Typography,
    Chip,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    LinearProgress,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function formatDuration(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
}

export default function AudioDialog({ open, onClose, audio, metadata }) {
    const { t } = useTranslation('filebrowser');
    const audioRef = useRef(null);
    const canvasRef = useRef(null);
    const waveformDataRef = useRef(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(() => {
        // Load volume from localStorage, default to 1.0
        const savedVolume = localStorage.getItem('audioPlayerVolume');
        return savedVolume ? parseFloat(savedVolume) : 1.0;
    });
    const [waveformLoaded, setWaveformLoaded] = useState(false);

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

    // Load and decode waveform data from audio file
    useEffect(() => {
        if (!open || !audio?.url) return;

        // Reset waveform state when loading new audio
        setWaveformLoaded(false);
        waveformDataRef.current = null;

        const loadWaveform = async () => {
            try {
                const response = await fetch(audio.url);
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const arrayBuffer = await response.arrayBuffer();
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

                // Get the first channel data
                const channelData = audioBuffer.getChannelData(0);
                const samples = 800; // Number of bars to draw (canvas width)
                const blockSize = Math.floor(channelData.length / samples);
                const waveformData = [];

                // Downsample the audio data
                for (let i = 0; i < samples; i++) {
                    const start = blockSize * i;
                    let sum = 0;
                    for (let j = 0; j < blockSize; j++) {
                        sum += Math.abs(channelData[start + j]);
                    }
                    waveformData.push(sum / blockSize);
                }

                // Normalize the data
                const max = Math.max(...waveformData);
                if (max === 0) {
                    console.warn('Audio waveform has zero amplitude');
                    waveformDataRef.current = waveformData;
                } else {
                    waveformDataRef.current = waveformData.map(v => v / max);
                }

                setWaveformLoaded(true);
            } catch (error) {
                console.error('Error loading waveform:', error);
            }
        };

        loadWaveform();
    }, [open, audio?.url]);

    // Draw waveform visualization
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width;
        const height = canvas.height;

        // Clear canvas
        ctx.fillStyle = '#1a1a1a';
        ctx.fillRect(0, 0, width, height);

        // Draw background
        ctx.fillStyle = '#2a2a2a';
        ctx.fillRect(0, 0, width, height);

        // Draw waveform if loaded
        if (waveformLoaded && waveformDataRef.current) {
            const waveformData = waveformDataRef.current;
            const barWidth = width / waveformData.length;
            const halfHeight = height / 2;

            // Apply contrast enhancement for better visibility
            const enhancedData = waveformData.map(v => Math.pow(v, 0.6)); // Power curve for contrast

            for (let i = 0; i < enhancedData.length; i++) {
                const barHeight = enhancedData[i] * halfHeight * 0.95; // Use 95% of available height
                const x = i * barWidth;

                // Color based on progress
                const progress = duration > 0 ? currentTime / duration : 0;
                const isPlayed = (i / enhancedData.length) < progress;

                ctx.fillStyle = isPlayed
                    ? 'rgba(33, 150, 243, 1.0)'  // Solid blue for played portion
                    : 'rgba(180, 180, 180, 0.9)'; // Light gray for unplayed

                // Draw bar (centered vertically)
                ctx.fillRect(x, halfHeight - barHeight, Math.max(barWidth, 1), barHeight * 2);
            }
        } else {
            // Draw loading indicator or simple progress bar
            const progress = duration > 0 ? currentTime / duration : 0;
            const progressWidth = width * progress;

            ctx.fillStyle = 'rgba(33, 150, 243, 0.3)';
            ctx.fillRect(0, 0, progressWidth, height);

            // Draw center line
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, height / 2);
            ctx.lineTo(width, height / 2);
            ctx.stroke();

            // Draw "Loading waveform..." text if not loaded yet
            if (!waveformLoaded) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
                ctx.font = '14px sans-serif';
                ctx.textAlign = 'center';
                ctx.fillText('Loading waveform...', width / 2, height / 2);
            }
        }

        // Draw progress indicator
        const progress = duration > 0 ? currentTime / duration : 0;
        const progressWidth = width * progress;
        if (progressWidth > 0) {
            ctx.fillStyle = '#2196f3';
            ctx.fillRect(progressWidth - 2, 0, 4, height);
        }

        // Draw time markers - completely reset context state first
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset any transforms
        ctx.font = '13px monospace';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';

        const currentTimeText = formatDuration(currentTime);
        const durationText = formatDuration(duration);

        const edgePadding = 6;
        const textPadding = 3;
        const boxHeight = 16;
        const textY = height - 6;
        const boxY = textY - boxHeight + 2;

        // Left time label
        const leftWidth = ctx.measureText(currentTimeText).width;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.fillRect(edgePadding, boxY, leftWidth + (textPadding * 2), boxHeight);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(currentTimeText, edgePadding + textPadding, textY);

        // Right time label
        const rightWidth = ctx.measureText(durationText).width;
        const rightBoxX = width - rightWidth - (textPadding * 2) - edgePadding;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
        ctx.fillRect(rightBoxX, boxY, rightWidth + (textPadding * 2), boxHeight);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(durationText, rightBoxX + textPadding, textY);

        ctx.restore();
    }, [currentTime, duration, waveformLoaded]);

    // Audio event handlers - setup when dialog opens and audio URL is available
    useEffect(() => {
        if (!open || !audio?.url) {
            console.log('Dialog not open or no audio URL');
            return;
        }

        // Use setTimeout to ensure DOM is ready
        const timeoutId = setTimeout(() => {
            const audioElement = audioRef.current;
            if (!audioElement) {
                console.error('Audio element still not mounted after timeout');
                return;
            }

            console.log('Setting up audio element with URL:', audio.url);

            // Set initial volume from saved preference
            audioElement.volume = volume;
            console.log('Set initial volume to:', volume);

            const handleTimeUpdate = () => {
                setCurrentTime(audioElement.currentTime);
            };

            const handleLoadedMetadata = () => {
                console.log('Audio metadata loaded, duration:', audioElement.duration);
                setDuration(audioElement.duration);
            };

            const handlePlay = () => {
                console.log('Audio playing');
                setIsPlaying(true);
            };

            const handlePause = () => {
                console.log('Audio paused');
                setIsPlaying(false);
            };

            const handleEnded = () => {
                console.log('Audio ended');
                setIsPlaying(false);
                setCurrentTime(0);
            };

            const handleError = (e) => {
                console.error('Audio error:', e, audioElement.error);
            };

            // Load the audio
            audioElement.load();

            audioElement.addEventListener('timeupdate', handleTimeUpdate);
            audioElement.addEventListener('loadedmetadata', handleLoadedMetadata);
            audioElement.addEventListener('play', handlePlay);
            audioElement.addEventListener('pause', handlePause);
            audioElement.addEventListener('ended', handleEnded);
            audioElement.addEventListener('error', handleError);
        }, 100);

        return () => {
            clearTimeout(timeoutId);
        };
    }, [open, audio?.url]);

    // Handle canvas click for seeking
    const handleCanvasClick = (e) => {
        const canvas = canvasRef.current;
        const audioElement = audioRef.current;
        if (!canvas || !audioElement || duration === 0) return;

        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const clickProgress = x / rect.width; // Use rect.width (displayed width) instead of canvas.width
        const newTime = clickProgress * duration;

        audioElement.currentTime = newTime;
        setCurrentTime(newTime);
    };

    const togglePlayPause = async () => {
        const audioElement = audioRef.current;
        if (!audioElement) {
            console.error('Audio element not found');
            return;
        }

        try {
            if (isPlaying) {
                audioElement.pause();
            } else {
                await audioElement.play();
            }
        } catch (error) {
            console.error('Error playing/pausing audio:', error);
        }
    };

    const handleVolumeChange = (e) => {
        const newVolume = parseFloat(e.target.value);
        setVolume(newVolume);
        localStorage.setItem('audioPlayerVolume', newVolume.toString());
        if (audioRef.current) {
            audioRef.current.volume = newVolume;
        }
    };

    const handleDownloadAudio = () => {
        if (audio?.url) {
            window.open(audio.url, '_blank');
        }
    };

    const handleDownloadMetadata = () => {
        if (audio?.url) {
            const metadataUrl = audio.url.replace('.wav', '.json');
            window.open(metadataUrl, '_blank');
        }
    };

    // Reset state when dialog closes
    useEffect(() => {
        if (!open && audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
            setIsPlaying(false);
            setCurrentTime(0);
        }
    }, [open]);

    if (!audio) return null;

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
                    <Typography variant="h6">Audio Recording Details</Typography>
                    <Box>
                        {metadata?.sample_rate && (
                            <Chip
                                label={`${metadata.sample_rate / 1000} kHz`}
                                size="small"
                                color="info"
                                sx={{ mr: 1, height: '20px', fontSize: '0.65rem', '& .MuiChip-label': { px: 0.75 } }}
                            />
                        )}
                        {audio?.size && (
                            <Chip
                                label={formatBytes(audio.size)}
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
                {audio && (
                    <Box sx={{ mt: 3 }} key={audio.url}>
                        {/* Hidden audio element */}
                        <audio
                            ref={audioRef}
                            src={audio.url}
                            preload="metadata"
                            style={{ display: 'none' }}
                            key={`audio-${audio.url}`}
                        />

                        {/* Waveform Canvas */}
                        <Box sx={{ mb: 3, borderRadius: 1, overflow: 'hidden', border: '1px solid', borderColor: 'divider', backgroundColor: '#2a2a2a' }}>
                            <canvas
                                ref={canvasRef}
                                width={800}
                                height={120}
                                style={{
                                    width: '100%',
                                    height: '120px',
                                    cursor: 'pointer',
                                    display: 'block',
                                }}
                                onClick={handleCanvasClick}
                            />
                        </Box>

                        {/* Playback Controls */}
                        <Box sx={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 2,
                            mb: 3,
                            p: 2,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1.5,
                            bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50'),
                        }}>
                            <Button
                                variant="contained"
                                onClick={togglePlayPause}
                                startIcon={isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
                                size="small"
                            >
                                {isPlaying ? 'Pause' : 'Play'}
                            </Button>

                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: 1 }}>
                                <VolumeUpIcon sx={{ color: 'text.secondary', fontSize: 20 }} />
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={volume}
                                    onChange={handleVolumeChange}
                                    style={{ flex: 1 }}
                                />
                                <Typography variant="caption" sx={{ color: 'text.secondary', minWidth: 35 }}>
                                    {Math.round(volume * 100)}%
                                </Typography>
                            </Box>

                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                {formatDuration(currentTime)} / {formatDuration(duration)}
                            </Typography>
                        </Box>

                        <Typography variant="subtitle2" gutterBottom>
                            File
                        </Typography>
                        <Box sx={sectionSx}>
                            <Box sx={rowSx}>
                                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                    Filename
                                </Typography>
                                <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-word' }}>
                                    {audio.filename}
                                </Typography>
                            </Box>
                        </Box>

                        {metadata && (
                            <>
                                <Typography variant="subtitle2" gutterBottom>
                                    Audio Properties
                                </Typography>
                                <Box sx={sectionSx}>
                                    {metadata.format && (
                                        <Box sx={rowSx}>
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                Format
                                            </Typography>
                                            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                {metadata.format.toUpperCase()}
                                            </Typography>
                                        </Box>
                                    )}
                                    {metadata.sample_rate && (
                                        <Box sx={rowSx}>
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                Sample Rate
                                            </Typography>
                                            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                {metadata.sample_rate} Hz
                                            </Typography>
                                        </Box>
                                    )}
                                    {metadata.channels && (
                                        <Box sx={rowSx}>
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                Channels
                                            </Typography>
                                            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                {metadata.channels} ({metadata.channels === 1 ? 'Mono' : 'Stereo'})
                                            </Typography>
                                        </Box>
                                    )}
                                    {metadata.bit_depth && (
                                        <Box sx={rowSx}>
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                Bit Depth
                                            </Typography>
                                            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                {metadata.bit_depth} bits
                                            </Typography>
                                        </Box>
                                    )}
                                    {metadata.duration_seconds !== undefined && (
                                        <Box sx={rowSx}>
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                Duration
                                            </Typography>
                                            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                {formatDuration(metadata.duration_seconds)} ({metadata.duration_seconds.toFixed(2)}s)
                                            </Typography>
                                        </Box>
                                    )}
                                    {metadata.total_samples && (
                                        <Box sx={rowSx}>
                                            <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                Total Samples
                                            </Typography>
                                            <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                {metadata.total_samples.toLocaleString()}
                                            </Typography>
                                        </Box>
                                    )}
                                </Box>

                                {(metadata.vfo_number || metadata.demodulator_type || metadata.center_frequency || metadata.vfo_frequency) && (
                                    <>
                                        <Typography variant="subtitle2" gutterBottom>
                                            Radio Configuration
                                        </Typography>
                                        <Box sx={sectionSx}>
                                            {metadata.vfo_number && (
                                                <Box sx={rowSx}>
                                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                        VFO
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                        {metadata.vfo_number}
                                                    </Typography>
                                                </Box>
                                            )}
                                            {metadata.demodulator_type && (
                                                <Box sx={rowSx}>
                                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                        Demodulator
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                        {metadata.demodulator_type}
                                                    </Typography>
                                                </Box>
                                            )}
                                            {metadata.center_frequency && (
                                                <Box sx={rowSx}>
                                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                        Center Frequency
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                        {(metadata.center_frequency / 1e6).toFixed(6)} MHz
                                                    </Typography>
                                                </Box>
                                            )}
                                            {metadata.vfo_frequency && (
                                                <Box sx={rowSx}>
                                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                        VFO Frequency
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                        {(metadata.vfo_frequency / 1e6).toFixed(6)} MHz
                                                    </Typography>
                                                </Box>
                                            )}
                                        </Box>
                                    </>
                                )}

                                {(metadata.target_satellite_name || metadata.target_satellite_norad_id) && (
                                    <>
                                        <Typography variant="subtitle2" gutterBottom>
                                            Target Satellite
                                        </Typography>
                                        <Box sx={sectionSx}>
                                            {metadata.target_satellite_name && (
                                                <Box sx={rowSx}>
                                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                        Name
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                        {metadata.target_satellite_name}
                                                    </Typography>
                                                </Box>
                                            )}
                                            {metadata.target_satellite_norad_id && (
                                                <Box sx={rowSx}>
                                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                        NORAD ID
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                        {metadata.target_satellite_norad_id}
                                                    </Typography>
                                                </Box>
                                            )}
                                        </Box>
                                    </>
                                )}

                                {(metadata.start_time || metadata.end_time) && (
                                    <>
                                        <Typography variant="subtitle2" gutterBottom>
                                            Recording Times
                                        </Typography>
                                        <Box sx={sectionSx}>
                                            {metadata.start_time && (
                                                <Box sx={rowSx}>
                                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                        Start
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                        {formatDate(metadata.start_time)}
                                                    </Typography>
                                                </Box>
                                            )}
                                            {metadata.end_time && (
                                                <Box sx={rowSx}>
                                                    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                                        End
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                                                        {formatDate(metadata.end_time)}
                                                    </Typography>
                                                </Box>
                                            )}
                                        </Box>
                                    </>
                                )}

                                {metadata.status && (
                                    <>
                                        <Typography variant="subtitle2" gutterBottom>
                                            Status
                                        </Typography>
                                        <Box sx={{ mb: 2 }}>
                                            <Chip
                                                label={metadata.status.toUpperCase()}
                                                size="small"
                                                color={metadata.status === 'finished' ? 'success' : 'warning'}
                                                sx={{ fontSize: '0.7rem' }}
                                            />
                                        </Box>
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
                    onClick={handleDownloadAudio}
                    startIcon={<DownloadIcon />}
                    variant="outlined"
                >
                    Download Audio
                </Button>
                {metadata && (
                    <Button
                        onClick={handleDownloadMetadata}
                        startIcon={<DownloadIcon />}
                        variant="outlined"
                    >
                        Download Metadata
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
                    Close
                </Button>
            </DialogActions>
        </Dialog>
    );
}
