/**
 * Compact VFO status and controls for the application toolbar.
 *
 * These controls deliberately use the VFO slice and AudioProvider that power
 * the waterfall accordion, keeping both surfaces synchronized.
 */

import * as React from 'react';
import { Badge, Box, Divider, IconButton, Popover, Slider, Stack, Tooltip, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import TuneIcon from '@mui/icons-material/Tune';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeMuteIcon from '@mui/icons-material/VolumeMute';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { useAudio } from './audio-provider.jsx';
import { setVFOProperty } from '../waterfall/vfo-marker/vfo-slice.jsx';
import { DecoderStatusDisplay } from '../waterfall/vfo-settings/vfo-decoder-status.jsx';
import {
    resolveVfoAudioStatus,
    VFO_AUDIO_STATUS,
    VFO_AUDIO_STATUS_COLORS,
} from '../waterfall/vfo-audio-status.js';
import VFOAudioRecorderButton from '../waterfall/vfo-settings/vfo-audio-recorder-button.jsx';
import { useVfoSquelchState } from '../waterfall/vfo-settings/vfo-hooks.js';
import { humanizeFrequency } from '../common/common.jsx';

const MAX_VFO_NUMBER = 4;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const getAudioLevelDetails = (level) => {
    const decibels = 20 * Math.log10((Number(level) || 0) + 0.00001);
    const percentage = clamp(((decibels + 60) / 60) * 100, 0, 100);

    if (decibels > -6) return { decibels, percentage, color: 'error.main' };
    if (decibels > -20) return { decibels, percentage, color: 'warning.main' };
    if (decibels > -60) return { decibels, percentage, color: 'success.main' };
    return { decibels, percentage, color: 'text.disabled' };
};

const getBufferColor = (bufferMilliseconds) => {
    if (bufferMilliseconds < 100) return 'warning.main';
    if (bufferMilliseconds <= 1000) return 'success.main';
    return 'error.main';
};

const getAudioStatusIcon = (audioStatus, fontSize = undefined) => {
    const iconProps = fontSize ? { fontSize } : undefined;

    if (audioStatus === VFO_AUDIO_STATUS.PLAYING) {
        return <VolumeUpIcon {...iconProps} />;
    }
    if (audioStatus === VFO_AUDIO_STATUS.SQUELCHED) {
        return <VolumeOffIcon {...iconProps} />;
    }
    return <VolumeMuteIcon {...iconProps} />;
};

function useVfoAudioMetrics(vfoNumber, enabled) {
    const { getAudioBufferLength, getVfoAudioLevel } = useAudio();
    const [metrics, setMetrics] = React.useState({ audioLevel: 0, bufferLength: 0 });

    React.useEffect(() => {
        if (!enabled) {
            return undefined;
        }

        const updateMetrics = () => {
            const nextMetrics = {
                audioLevel: getVfoAudioLevel(vfoNumber),
                bufferLength: getAudioBufferLength(vfoNumber),
            };

            setMetrics((previousMetrics) => (
                previousMetrics.audioLevel === nextMetrics.audioLevel
                && previousMetrics.bufferLength === nextMetrics.bufferLength
            ) ? previousMetrics : nextMetrics);
        };

        updateMetrics();
        const interval = setInterval(updateMetrics, 250);
        return () => clearInterval(interval);
    }, [enabled, getAudioBufferLength, getVfoAudioLevel, vfoNumber]);

    return metrics;
}

function VfoStatusRow({ decoderInfo, isPopoverOpen, muted, streaming, squelchOpen, vfo, vfoColor, vfoNumber }) {
    const dispatch = useDispatch();
    const { t } = useTranslation('dashboard');
    const { setVfoMute } = useAudio();
    const { audioLevel, bufferLength } = useVfoAudioMetrics(vfoNumber, isPopoverOpen);
    const { decibels, percentage: levelPercentage, color: levelColor } = getAudioLevelDetails(audioLevel);
    const bufferMilliseconds = bufferLength * 1000;
    const volume = clamp(Number(vfo?.volume ?? 50), 0, 100);
    const audioStatus = resolveVfoAudioStatus({ isStreaming: streaming, isMuted: muted, isSquelchOpen: squelchOpen });
    const audioStatusLabel = {
        [VFO_AUDIO_STATUS.NO_AUDIO]: t('vfo_status.status_no_audio'),
        [VFO_AUDIO_STATUS.MUTED]: t('vfo_status.status_muted'),
        [VFO_AUDIO_STATUS.SQUELCHED]: t('vfo_status.status_squelched'),
        [VFO_AUDIO_STATUS.PLAYING]: t('vfo_status.status_unmuted'),
    }[audioStatus];
    const formattedFrequency = Number.isFinite(vfo?.frequency)
        ? humanizeFrequency(vfo.frequency, 3)
        : '—';

    const handleVolumeChange = (event, nextVolume) => {
        dispatch(setVFOProperty({
            vfoNumber,
            updates: { volume: nextVolume },
        }));
    };

    const handleMuteToggle = () => {
        setVfoMute(vfoNumber, !muted);
    };

    return (
        <Box
            sx={{
                borderLeft: '3px solid',
                borderColor: vfoColor,
                px: 1.25,
                py: 0.6,
                backgroundColor: (theme) => alpha(vfoColor, theme.palette.mode === 'dark' ? 0.08 : 0.05),
            }}
        >
            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                <Stack direction="row" alignItems="center" spacing={0.5} sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, lineHeight: 1.2, flexShrink: 0 }}>
                        {t('vfo_status.vfo', { number: vfoNumber })}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" aria-hidden="true" sx={{ flexShrink: 0 }}>•</Typography>
                    <Typography
                        component="span"
                        variant="caption"
                        sx={{
                            flexShrink: 0,
                            px: 0.6,
                            py: 0.1,
                            border: '1px solid',
                            borderColor: alpha(VFO_AUDIO_STATUS_COLORS[audioStatus], 0.5),
                            borderRadius: 0.5,
                            backgroundColor: alpha(VFO_AUDIO_STATUS_COLORS[audioStatus], 0.12),
                            color: 'text.primary',
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            lineHeight: 1.2,
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {audioStatusLabel}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" aria-hidden="true" sx={{ flexShrink: 0 }}>•</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {formattedFrequency}
                    </Typography>
                </Stack>
                <Stack direction="row" spacing={0.25} sx={{ flexShrink: 0 }}>
                    <VFOAudioRecorderButton vfoNumber={vfoNumber} compact />
                    <Tooltip title={muted ? t('vfo_status.unmute') : t('vfo_status.mute')}>
                        <IconButton
                            aria-label={muted ? t('vfo_status.unmute') : t('vfo_status.mute')}
                            onClick={handleMuteToggle}
                            size="small"
                            sx={{ color: VFO_AUDIO_STATUS_COLORS[audioStatus] }}
                        >
                            {getAudioStatusIcon(audioStatus, 'small')}
                        </IconButton>
                    </Tooltip>
                </Stack>
            </Stack>

            <DecoderStatusDisplay
                vfo={vfo}
                decoderInfo={decoderInfo}
                audioStatus={audioStatus}
                compact
                hideWhenIdle
            />

            <Box sx={{ mt: 0.5 }}>
                <Stack direction="row" alignItems="baseline" justifyContent="space-between">
                    <Typography variant="caption" color="text.secondary">
                        {t('vfo_status.volume')}
                    </Typography>
                    <Stack direction="row" spacing={0.75}>
                        <Typography variant="caption" sx={{ fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums' }}>
                            {volume}%
                        </Typography>
                        <Typography
                            variant="caption"
                            sx={{ color: levelColor, fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums' }}
                        >
                            {decibels.toFixed(1)} dB
                        </Typography>
                        <Typography
                            variant="caption"
                            sx={{
                                color: getBufferColor(bufferMilliseconds),
                                fontFamily: 'monospace',
                                fontVariantNumeric: 'tabular-nums',
                            }}
                        >
                            {bufferMilliseconds.toFixed(0)} ms
                        </Typography>
                    </Stack>
                </Stack>
                <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', height: 22 }}>
                    {/* The live meter sits behind the volume track so gain and signal level remain visible together. */}
                    <Box
                        aria-hidden="true"
                        sx={{
                            position: 'absolute',
                            left: 0,
                            width: `${levelPercentage}%`,
                            height: 4,
                            borderRadius: 2,
                            backgroundColor: levelColor,
                            opacity: 0.55,
                            transition: 'width 0.1s ease-out',
                        }}
                    />
                    <Slider
                        aria-label={t('vfo_status.volume_for', { number: vfoNumber })}
                        value={volume}
                        min={0}
                        max={100}
                        onChange={handleVolumeChange}
                        sx={{
                            py: 0,
                            '& .MuiSlider-rail': { opacity: 0.22 },
                            '& .MuiSlider-track': {
                                border: 0,
                                backgroundColor: (theme) => alpha(theme.palette.primary.main, 0.5),
                            },
                        }}
                    />
                </Box>
            </Box>
        </Box>
    );
}

function VfoStatusPopover() {
    const { t } = useTranslation('dashboard');
    const { setVfoMute } = useAudio();
    const { vfoSquelchOpen } = useVfoSquelchState();
    const vfoActive = useSelector((state) => state.vfo.vfoActive || {});
    const vfoMarkers = useSelector((state) => state.vfo.vfoMarkers || {});
    const vfoMuted = useSelector((state) => state.vfo.vfoMuted || {});
    const vfoColors = useSelector((state) => state.vfo.vfoColors || []);
    const streamingVFOs = useSelector((state) => state.vfo.streamingVFOs || []);
    const activeDecoders = useSelector((state) => state.decoders.active || {});
    const currentSessionId = useSelector((state) => state.decoders.currentSessionId);
    const [anchorEl, setAnchorEl] = React.useState(null);

    const activeVfoNumbers = React.useMemo(() => (
        Array.from({ length: MAX_VFO_NUMBER }, (_, index) => index + 1)
            .filter((vfoNumber) => Boolean(vfoActive[vfoNumber]))
    ), [vfoActive]);
    const areAllActiveVfosMuted = activeVfoNumbers.length > 0
        && activeVfoNumbers.every((vfoNumber) => Boolean(vfoMuted[vfoNumber]));
    const open = Boolean(anchorEl);

    const handleOpen = (event) => setAnchorEl(event.currentTarget);
    const handleClose = () => setAnchorEl(null);
    const handleMuteAllToggle = () => {
        activeVfoNumbers.forEach((vfoNumber) => {
            setVfoMute(vfoNumber, !areAllActiveVfosMuted);
        });
    };

    return (
        <>
            <Tooltip title={t('vfo_status.tooltip')}>
                <IconButton
                    aria-label={t('vfo_status.tooltip')}
                    aria-controls={open ? 'vfo-status-popover' : undefined}
                    aria-haspopup="true"
                    onClick={handleOpen}
                    size="small"
                    sx={{
                        width: 40,
                        // Any active VFO counts, including those used only for decoding.
                        color: activeVfoNumbers.length > 0 ? 'primary.main' : 'text.secondary',
                        '&:hover': { backgroundColor: 'overlay.light' },
                    }}
                >
                    <Badge
                        badgeContent={activeVfoNumbers.length}
                        invisible={activeVfoNumbers.length === 0}
                        max={MAX_VFO_NUMBER}
                        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                        sx={{
                            '& .MuiBadge-badge': {
                                minWidth: 14,
                                height: 14,
                                px: 0.4,
                                bgcolor: 'background.paper',
                                color: 'text.secondary',
                                border: '1px solid',
                                borderColor: 'divider',
                                fontSize: '0.55rem',
                                fontWeight: 700,
                            },
                        }}
                    >
                        <TuneIcon />
                    </Badge>
                </IconButton>
            </Tooltip>
            <Popover
                id="vfo-status-popover"
                open={open}
                anchorEl={anchorEl}
                onClose={handleClose}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                slotProps={{
                    paper: {
                        sx: {
                            width: 320,
                            maxWidth: 'calc(100vw - 24px)',
                            mt: 0.5,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderRadius: 1.25,
                            overflow: 'hidden',
                        },
                    },
                }}
            >
                <Box sx={{ px: 1.5, py: 0.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                        {t('vfo_status.title')}
                    </Typography>
                    {activeVfoNumbers.length > 0 && (
                        <Tooltip title={areAllActiveVfosMuted ? t('vfo_status.unmute_all') : t('vfo_status.mute_all')}>
                            <IconButton
                                aria-label={areAllActiveVfosMuted ? t('vfo_status.unmute_all') : t('vfo_status.mute_all')}
                                onClick={handleMuteAllToggle}
                                size="small"
                                sx={{ color: areAllActiveVfosMuted ? 'warning.main' : 'text.secondary' }}
                            >
                                {areAllActiveVfosMuted ? <VolumeUpIcon fontSize="small" /> : <VolumeOffIcon fontSize="small" />}
                            </IconButton>
                        </Tooltip>
                    )}
                </Box>
                <Divider />
                {activeVfoNumbers.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ px: 1.5, py: 2 }}>
                        {t('vfo_status.no_active_vfos')}
                    </Typography>
                ) : (
                    <Stack divider={<Divider flexItem />}>
                        {activeVfoNumbers.map((vfoNumber) => (
                            <VfoStatusRow
                                key={vfoNumber}
                                decoderInfo={currentSessionId
                                    ? activeDecoders[`${currentSessionId}_vfo${vfoNumber}`] || null
                                    : null}
                                isPopoverOpen={open}
                                muted={Boolean(vfoMuted[vfoNumber])}
                                streaming={streamingVFOs.includes(vfoNumber)}
                                squelchOpen={vfoSquelchOpen[vfoNumber]}
                                vfo={vfoMarkers[vfoNumber]}
                                vfoColor={vfoColors[vfoNumber - 1] || 'primary.main'}
                                vfoNumber={vfoNumber}
                            />
                        ))}
                    </Stack>
                )}
            </Popover>
        </>
    );
}

export default React.memo(VfoStatusPopover);
