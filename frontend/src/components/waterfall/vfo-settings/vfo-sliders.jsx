/**
 * VFO Sliders Components
 *
 * Squelch and Volume slider controls for VFO
 */

import React from 'react';
import { Box, IconButton, Slider, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import VolumeDown from '@mui/icons-material/VolumeDown';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { SquelchIconCentered } from '../../common/dataurl-icons.jsx';
import { useAudio } from '../../dashboard/audio-provider.jsx';
import { useTranslation } from 'react-i18next';

const VAD_CLOSE_DELAY_MARKS = Array.from({ length: 5 }, (_, index) => {
    const value = (index + 1) * 200;
    return {
        value,
        label: `${value}`,
    };
});

/**
 * Squelch Slider Component
 */
export const SquelchSlider = ({
    vfoIndex,
    vfoActive,
    mode,
    squelch,
    squelchMode,
    vadSensitivity,
    vadCloseDelayMs,
    onVFOPropertyChange
}) => {
    const { t } = useTranslation('waterfall');
    const { getVfoRfPower } = useAudio();
    const isFmMode = (mode || '').toUpperCase() === 'FM';
    const isVoiceSquelchEnabled = squelchMode === 'voice' || squelchMode === 'hybrid';
    const controlsEnabled = vfoActive && isFmMode;
    const compactToggleGroupSx = {
        mb: 1,
        width: '100%',
        '& .MuiToggleButton-root': {
            flex: 1,
            py: 0.3,
            px: 0.75,
            minHeight: 24,
            fontSize: '0.68rem',
            fontWeight: 500,
            textTransform: 'none',
            lineHeight: 1.1,
            borderColor: 'rgba(255, 255, 255, 0.12)',
            color: 'text.secondary',
            '&.Mui-selected': {
                color: 'text.primary',
                backgroundColor: 'rgba(255, 255, 255, 0.08)',
            },
            '&.Mui-selected:hover': {
                backgroundColor: 'rgba(255, 255, 255, 0.12)',
            },
        },
    };

    const handleAutoSquelch = () => {
        const rfPower = getVfoRfPower(vfoIndex);
        if (rfPower !== null) {
            // Set squelch to current noise floor + 5 dB
            const autoSquelch = Math.round(rfPower + 5);
            onVFOPropertyChange(vfoIndex, { squelch: Math.max(-150, Math.min(0, autoSquelch)) });
        }
    };

    return (
        <Box sx={{ mt: 2, opacity: controlsEnabled ? 1 : 0.6 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.75 }}>
                {t('vfo_sliders.squelch_type', { defaultValue: 'Squelch Type' })}
            </Typography>
            <ToggleButtonGroup
                value={squelchMode}
                exclusive
                disabled={!controlsEnabled}
                onChange={(event, newValue) => {
                    if (newValue !== null) {
                        onVFOPropertyChange(vfoIndex, { squelchMode: newValue });
                    }
                }}
                size="small"
                sx={compactToggleGroupSx}
            >
                <ToggleButton
                    value="carrier"
                    title={t('vfo_sliders.open_by_received_rf_power_threshold_only', { defaultValue: 'Open by received RF power threshold only' })}
                >
                    {t('vfo_sliders.rf_power', { defaultValue: 'RF power' })}
                </ToggleButton>
                <ToggleButton
                    value="voice"
                    title={t('vfo_sliders.open_only_when_voice_like_audio_is_detected', { defaultValue: 'Open only when voice-like audio is detected' })}
                >
                    {t('vfo_sliders.voice', { defaultValue: 'Voice' })}
                </ToggleButton>
                <ToggleButton
                    value="hybrid"
                    title={t('vfo_sliders.open_only_when_both_rf_power_and_voice_detection_pass', { defaultValue: 'Open only when both RF power and voice detection pass' })}
                >
                    {t('vfo_sliders.hybrid', { defaultValue: 'Hybrid' })}
                </ToggleButton>
            </ToggleButtonGroup>

            <Stack
                spacing={0}
                direction="row"
                alignItems="center"
                data-slider={squelchMode === 'voice' ? undefined : 'squelch'}
                data-vfo-index={vfoIndex}
            >
                <Tooltip title={t('vfo_sliders.auto_squelch_noise_floor_5db', { defaultValue: 'Auto Squelch (Noise Floor + 5dB)' })} arrow>
                    <span>
                        <IconButton
                            onClick={handleAutoSquelch}
                            disabled={!controlsEnabled || squelchMode === 'voice'}
                            sx={{
                                color: 'text.secondary',
                                backgroundColor: 'rgba(33, 150, 243, 0.08)',
                                '&:hover': {
                                    backgroundColor: 'rgba(33, 150, 243, 0.15)',
                                },
                                '&:disabled': {
                                    backgroundColor: 'transparent',
                                },
                            }}
                        >
                            <SquelchIconCentered size={24} />
                        </IconButton>
                    </span>
                </Tooltip>
                <Slider
                    value={squelch}
                    min={-150}
                    max={0}
                    onChange={(e, val) => onVFOPropertyChange(vfoIndex, { squelch: val })}
                    disabled={!controlsEnabled || squelchMode === 'voice'}
                    sx={{ ml: '5px' }}
                />
                <Box sx={{ minWidth: 50, fontSize: '0.875rem', textAlign: 'right' }}>
                    {squelch} dB
                </Box>
            </Stack>

            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 1.25, mb: 0.75 }}>
                {t('vfo_sliders.voice_sensitivity', { defaultValue: 'Voice Sensitivity' })}
            </Typography>
            <ToggleButtonGroup
                value={vadSensitivity}
                exclusive
                disabled={!controlsEnabled || !isVoiceSquelchEnabled}
                onChange={(event, newValue) => {
                    if (newValue !== null) {
                        onVFOPropertyChange(vfoIndex, { vadSensitivity: newValue });
                    }
                }}
                size="small"
                sx={compactToggleGroupSx}
            >
                <ToggleButton
                    value="low"
                    title={t('vfo_sliders.least_sensitive_voice_detection_fewer_false_opens', { defaultValue: 'Least sensitive voice detection (fewer false opens)' })}
                >
                    {t('vfo_sliders.low', { defaultValue: 'Low' })}
                </ToggleButton>
                <ToggleButton
                    value="medium"
                    title={t('vfo_sliders.balanced_voice_detection_for_typical_repeater_use', { defaultValue: 'Balanced voice detection for typical repeater use' })}
                >
                    {t('vfo_sliders.medium', { defaultValue: 'Medium' })}
                </ToggleButton>
                <ToggleButton
                    value="high"
                    title={t('vfo_sliders.most_sensitive_voice_detection_opens_fastest', { defaultValue: 'Most sensitive voice detection (opens fastest)' })}
                >
                    {t('vfo_sliders.high', { defaultValue: 'High' })}
                </ToggleButton>
            </ToggleButtonGroup>

            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}>
                {t('vfo_sliders.close_delay', { defaultValue: 'Close Delay' })}
            </Typography>
            <Stack spacing={0} direction="row" alignItems="center">
                <Tooltip title={t('vfo_sliders.voice_close_delay', { defaultValue: 'Voice close delay' })} arrow>
                    <span>
                        <IconButton
                            disabled
                            sx={{
                                color: 'text.secondary',
                                backgroundColor: 'transparent',
                                '&:disabled': {
                                    color: 'text.disabled',
                                    backgroundColor: 'transparent',
                                },
                            }}
                        >
                            <AccessTimeIcon />
                        </IconButton>
                    </span>
                </Tooltip>
                <Slider
                    value={vadCloseDelayMs}
                    min={50}
                    max={1000}
                    step={50}
                    marks={VAD_CLOSE_DELAY_MARKS}
                    valueLabelDisplay="auto"
                    onChange={(e, val) => onVFOPropertyChange(vfoIndex, { vadCloseDelayMs: val })}
                    disabled={!controlsEnabled || !isVoiceSquelchEnabled}
                    sx={{ ml: '5px' }}
                />
                <Box sx={{ minWidth: 55, fontSize: '0.875rem', textAlign: 'right' }}>
                    {vadCloseDelayMs} ms
                </Box>
            </Stack>
        </Box>
    );
};

/**
 * Volume Slider Component
 */
export const VolumeSlider = ({ vfoIndex, vfoActive, volume, muted, onVFOPropertyChange, onMuteToggle }) => {
    return (
        <Stack
            spacing={0}
            direction="row"
            alignItems="center"
            sx={{ mt: 2 }}
            data-slider="volume"
            data-vfo-index={vfoIndex}
        >
            <Tooltip title={muted ? "Unmute VFO" : "Mute VFO"} arrow>
                <span>
                    <IconButton
                        onClick={() => onMuteToggle(vfoIndex)}
                        disabled={!vfoActive}
                        sx={{
                            color: muted ? 'error.main' : 'text.secondary',
                            backgroundColor: muted ? 'rgba(244, 67, 54, 0.08)' : 'rgba(33, 150, 243, 0.08)',
                            '&:hover': {
                                backgroundColor: muted ? 'rgba(244, 67, 54, 0.15)' : 'rgba(33, 150, 243, 0.15)',
                            },
                            '&:disabled': {
                                backgroundColor: 'transparent',
                            },
                        }}
                    >
                        {muted ? <VolumeOffIcon /> : <VolumeDown />}
                    </IconButton>
                </span>
            </Tooltip>
            <Slider
                value={volume}
                onChange={(e, val) => onVFOPropertyChange(vfoIndex, { volume: val })}
                disabled={!vfoActive}
                sx={{ ml: '5px' }}
            />
            <Box sx={{ minWidth: 50, fontSize: '0.875rem', textAlign: 'right' }}>
                {volume}%
            </Box>
        </Stack>
    );
};
