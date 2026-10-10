/**
 * VFO Meters Components
 *
 * RF Power, Audio Level, and Audio Buffer meter displays for VFO
 */

import React from 'react';
import { Box, Typography } from '@mui/material';
import { useAudio } from '../../dashboard/audio-provider.jsx';
import { useTranslation } from 'react-i18next';

/**
 * RF Power Meter (S-Meter) Component
 */
export const RfPowerMeter = ({ vfoActive, rfPower }) => {
    const { t } = useTranslation('waterfall');
    const getPowerColor = (powerDb) => {
        if (powerDb > -40) return '#4caf50'; // Green (excellent signal, -40dB to 0dB)
        if (powerDb > -60) return '#8bc34a'; // Light green (good signal, -60dB to -40dB)
        if (powerDb > -80) return '#4caf50'; // Green (weak signal, -80dB to -60dB)
        return '#f44336'; // Red (noise floor, below -80dB)
    };

    return (
        <Box sx={{ mt: 1, mb: 1, opacity: vfoActive ? 1 : 0.4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                    {t('vfo_meters.rf_power', { defaultValue: 'RF Power' })}
                </Typography>
                <Typography variant="caption" sx={{
                    fontFamily: 'monospace',
                    color: vfoActive && rfPower !== null ? getPowerColor(rfPower) : 'text.disabled'
                }}>
                    {vfoActive && rfPower !== null ? rfPower.toFixed(1) : '—'} dBFS
                </Typography>
            </Box>
            <Box sx={{ position: 'relative', height: 8 }}>
                {/* Background track */}
                <Box sx={{
                    position: 'absolute',
                    width: '100%',
                    height: '100%',
                    backgroundColor: 'rgba(128, 128, 128, 0.2)',
                    borderRadius: 1,
                }} />
                {/* Power bar (filled portion) - scale from -100dB to 0dB */}
                {vfoActive && rfPower !== null && (
                    <Box sx={{
                        position: 'absolute',
                        left: 0,
                        width: `${Math.min(100, Math.max(0, ((100 + rfPower) / 100) * 100))}%`,
                        height: '100%',
                        background: getPowerColor(rfPower),
                        borderRadius: 1,
                        transition: 'width 0.2s ease-out',
                    }} />
                )}
            </Box>
        </Box>
    );
};

/**
 * Audio Level Meter (VU Meter) Component
 */
export const AudioLevelMeter = ({ vfoActive, audioLevel }) => {
    const { t } = useTranslation('waterfall');
    const levelDb = 20 * Math.log10(audioLevel + 0.00001);

    const getLevelColor = (levelDb) => {
        if (levelDb > -6) return '#f44336'; // Red (too loud/clipping, -6dB to 0dB)
        if (levelDb > -20) return '#ff9800'; // Orange (getting loud, -20dB to -6dB)
        if (levelDb > -60) return '#4caf50'; // Green (good level, -60dB to -20dB)
        return '#9e9e9e'; // Gray (too quiet, below -60dB)
    };

    const getLevelBackground = (levelDb) => {
        if (levelDb > -6) return 'linear-gradient(to right, #4caf50, #ff9800, #f44336)'; // Above -6dB: red zone
        if (levelDb > -20) return 'linear-gradient(to right, #4caf50 80%, #ff9800)'; // -20dB to -6dB: orange zone
        if (levelDb > -60) return '#4caf50'; // -60dB to -20dB: green zone
        return '#9e9e9e'; // Below -60dB: gray (too quiet)
    };

    return (
        <Box sx={{ mt: 1, mb: 1, opacity: vfoActive ? 1 : 0.4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                    {t('vfo_meters.audio_level', { defaultValue: 'Audio Level' })}
                </Typography>
                <Typography variant="caption" sx={{
                    fontFamily: 'monospace',
                    color: vfoActive ? getLevelColor(levelDb) : 'text.disabled'
                }}>
                    {vfoActive ? levelDb.toFixed(1) : '—'} dB
                </Typography>
            </Box>
            <Box sx={{ position: 'relative', height: 8 }}>
                {/* Background track */}
                <Box sx={{
                    position: 'absolute',
                    width: '100%',
                    height: '100%',
                    backgroundColor: 'rgba(128, 128, 128, 0.2)',
                    borderRadius: 1,
                }} />
                {/* Green zone (-60dB to -20dB) - good level */}
                {vfoActive && (
                    <Box sx={{
                        position: 'absolute',
                        left: `${((60 - 60) / 60) * 100}%`,  /* 0% from left (-60dB) */
                        width: `${((60 - 20) / 60) * 100}%`,  /* 66.7% wide (to -20dB) */
                        height: '100%',
                        backgroundColor: 'rgba(76, 175, 80, 0.3)',
                        borderRadius: 1,
                    }} />
                )}
                {/* Orange zone (-20dB to -6dB) - getting loud */}
                {vfoActive && (
                    <Box sx={{
                        position: 'absolute',
                        left: `${((60 - 20) / 60) * 100}%`,  /* 66.7% from left (-20dB) */
                        width: `${((20 - 6) / 60) * 100}%`,  /* 23.3% wide (to -6dB) */
                        height: '100%',
                        backgroundColor: 'rgba(255, 152, 0, 0.3)',
                        borderRadius: 1,
                    }} />
                )}
                {/* Red zone (-6dB to 0dB) - too loud/clipping */}
                {vfoActive && (
                    <Box sx={{
                        position: 'absolute',
                        left: `${((60 - 6) / 60) * 100}%`,   /* 90% from left (-6dB) */
                        width: `${((6 - 0) / 60) * 100}%`,   /* 10% wide (to 0dB) */
                        height: '100%',
                        backgroundColor: 'rgba(244, 67, 54, 0.3)',
                        borderRadius: 1,
                    }} />
                )}
                {/* Level bar (filled portion) */}
                {vfoActive && (
                    <Box sx={{
                        position: 'absolute',
                        left: 0,
                        width: `${Math.min(100, Math.max(0, ((60 + levelDb) / 60) * 100))}%`,
                        height: '100%',
                        background: getLevelBackground(levelDb),
                        borderRadius: 1,
                        transition: 'width 0.1s ease-out',
                    }} />
                )}
            </Box>
        </Box>
    );
};

/**
 * Audio Buffer Meter Component
 */
export const AudioBufferMeter = ({ vfoActive, bufferLength }) => {
    const { t } = useTranslation('waterfall');
    const bufferMs = bufferLength * 1000;

    const getBufferColor = (bufferMs) => {
        if (bufferMs >= 100 && bufferMs <= 1000) return '#4caf50'; // Green
        if (bufferMs < 100 || bufferMs > 1000) return '#ff9800'; // Orange
        return '#f44336'; // Red
    };

    return (
        <Box sx={{ mt: 1, mb: 1, opacity: vfoActive ? 1 : 0.4 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                    {t('vfo_meters.audio_buffer', { defaultValue: 'Audio Buffer' })}
                </Typography>
                <Typography variant="caption" sx={{
                    fontFamily: 'monospace',
                    color: vfoActive ? getBufferColor(bufferMs) : 'text.disabled'
                }}>
                    {vfoActive ? bufferMs.toFixed(0) : '—'} ms
                </Typography>
            </Box>
            <Box sx={{ position: 'relative', height: 6 }}>
                {/* Background track */}
                <Box sx={{
                    position: 'absolute',
                    width: '100%',
                    height: '100%',
                    backgroundColor: 'rgba(128, 128, 128, 0.2)',
                    borderRadius: 1,
                }} />
                {/* Green zone (100-1000ms) */}
                {vfoActive && (
                    <Box sx={{
                        position: 'absolute',
                        left: `${(100 / 3000) * 100}%`,
                        width: `${((1000 - 100) / 3000) * 100}%`,
                        height: '100%',
                        backgroundColor: 'rgba(76, 175, 80, 0.3)',
                        borderRadius: 1,
                    }} />
                )}
                {/* Indicator dot */}
                {vfoActive && (
                    <Box sx={{
                        position: 'absolute',
                        left: `${Math.min((bufferMs / 3000) * 100, 100)}%`,
                        top: '50%',
                        width: 8,
                        height: 8,
                        backgroundColor: getBufferColor(bufferMs),
                        borderRadius: '50%',
                        transform: 'translate(-50%, -50%)',
                        border: '1px solid',
                        borderColor: 'background.paper',
                        boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
                    }} />
                )}
            </Box>
        </Box>
    );
};

export const VfoLiveMeters = React.memo(function VfoLiveMeters({ vfoIndex, vfoActive }) {
    const { t } = useTranslation('waterfall');
    const { getAudioBufferLength, getVfoAudioLevel, getVfoRfPower } = useAudio();
    const [metrics, setMetrics] = React.useState({
        bufferLength: 0,
        audioLevel: 0,
        rfPower: null,
    });

    React.useEffect(() => {
        if (!vfoActive) {
            setMetrics({
                bufferLength: 0,
                audioLevel: 0,
                rfPower: null,
            });
            return;
        }

        const updateMetrics = () => {
            const nextMetrics = {
                bufferLength: getAudioBufferLength(vfoIndex),
                audioLevel: getVfoAudioLevel(vfoIndex),
                rfPower: getVfoRfPower(vfoIndex),
            };

            setMetrics(prev => (
                prev.bufferLength === nextMetrics.bufferLength &&
                prev.audioLevel === nextMetrics.audioLevel &&
                prev.rfPower === nextMetrics.rfPower
            ) ? prev : nextMetrics);
        };

        updateMetrics();
        const interval = setInterval(updateMetrics, 250);
        return () => clearInterval(interval);
    }, [vfoActive, vfoIndex, getAudioBufferLength, getVfoAudioLevel, getVfoRfPower]);

    return (
        <>
            <RfPowerMeter vfoActive={vfoActive} rfPower={metrics.rfPower} />
            <AudioLevelMeter vfoActive={vfoActive} audioLevel={metrics.audioLevel} />
            <AudioBufferMeter vfoActive={vfoActive} bufferLength={metrics.bufferLength} />
        </>
    );
});
