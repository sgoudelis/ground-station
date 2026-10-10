import React, { useState, useEffect } from 'react';
import {humanizeFrequency, humanizeNumber, WaterfallStatusBarPaper} from "../common/common.jsx";
import { Box, useMediaQuery } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

const TRANSFORM_UPDATE_MS = 250;

const WaterfallStatusBar = ({isStreaming, eventMetrics, centerFrequency, sampleRate, gain}) => {
    const { t } = useTranslation('waterfall');
    const [transformData, setTransformData] = useState(null);
    const theme = useTheme();
    const isCompact = useMediaQuery(theme.breakpoints.down('lg'));

    // Update transform data periodically when streaming
    useEffect(() => {
        if (!isStreaming) {
            setTransformData(null);
            return;
        }

        const updateTransform = () => {
            if (!window.getWaterfallTransform) return;
            const nextTransform = window.getWaterfallTransform();
            setTransformData(prevTransform => {
                if (!nextTransform) return prevTransform;
                if (
                    prevTransform &&
                    prevTransform.scale === nextTransform.scale &&
                    prevTransform.startFreq === nextTransform.startFreq &&
                    prevTransform.endFreq === nextTransform.endFreq &&
                    prevTransform.visibleBandwidth === nextTransform.visibleBandwidth
                ) {
                    return prevTransform;
                }
                return nextTransform;
            });
        };

        updateTransform();

        // Transform data is displayed at this fixed cadence, so avoid a
        // requestAnimationFrame callback on every frame while streaming.
        const intervalId = setInterval(() => {
            if (!document.hidden) {
                updateTransform();
            }
        }, TRANSFORM_UPDATE_MS);

        return () => clearInterval(intervalId);
    }, [isStreaming]);

    return (
        <WaterfallStatusBarPaper>
            <Box
                sx={{
                    display: 'flex',
                    flexWrap: 'nowrap',
                    alignItems: 'center',
                    gap: 0.5,
                    fontSize: '0.75rem',
                    fontFamily: 'monospace',
                    color: 'text.secondary',
                    width: '100%',
                    minWidth: 0,
                    overflowX: 'hidden',
                    overflowY: 'hidden',
                    whiteSpace: 'nowrap',
                }}
            >
                <Box sx={{ display: 'flex', gap: 0.5, flex: '0 0 auto' }}>
                    {isCompact ? (
                        <>
                            <Box component="span" sx={{ fontWeight: 500, display: 'inline-block', minWidth: '4ch', textAlign: 'right' }}>{isStreaming ? eventMetrics.current.renderWaterfallPerSecond : '-'}</Box>
                            <Box component="span" sx={{ opacity: 0.6 }}>•</Box>
                            <Box component="span" sx={{ fontWeight: 500, display: 'inline-block', minWidth: '4ch', textAlign: 'right' }}>{isStreaming ? humanizeNumber(eventMetrics.current.fftUpdatesPerSecond) : '-'}</Box>
                            <Box component="span" sx={{ opacity: 0.6 }}>•</Box>
                            <Box component="span" sx={{ fontWeight: 500, display: 'inline-block', minWidth: '4ch', textAlign: 'right' }}>{isStreaming ? humanizeNumber(eventMetrics.current.binsPerSecond) : '-'}</Box>
                            <Box component="span" sx={{ opacity: 0.6 }}>•</Box>
                            <Box component="span" sx={{ fontWeight: 500 }}>{isStreaming ? humanizeFrequency(centerFrequency) : '-'}</Box>
                            <Box component="span" sx={{ opacity: 0.6 }}>•</Box>
                            <Box component="span" sx={{ fontWeight: 500 }}>{isStreaming ? humanizeFrequency(sampleRate) : '-'}</Box>
                            <Box component="span" sx={{ opacity: 0.6 }}>•</Box>
                            <Box component="span" sx={{ fontWeight: 500 }}>{isStreaming ? `${gain} dB` : '-'}</Box>
                        </>
                    ) : (
                        <>
                            <Box component="span">{t('waterfall_statusbar.fps', { defaultValue: 'FPS:' })} <Box component="span" sx={{ fontWeight: 500, display: 'inline-block', minWidth: '4ch', textAlign: 'right' }}>{isStreaming ? eventMetrics.current.renderWaterfallPerSecond : '-'}</Box></Box>
                            <Box component="span" sx={{ opacity: 0.6 }}>•</Box>
                            <Box component="span">{t('waterfall_statusbar.ffts_s', { defaultValue: 'FFTs/s:' })} <Box component="span" sx={{ fontWeight: 500, display: 'inline-block', minWidth: '4ch', textAlign: 'right' }}>{isStreaming ? humanizeNumber(eventMetrics.current.fftUpdatesPerSecond) : '-'}</Box></Box>
                            <Box component="span" sx={{ opacity: 0.6 }}>•</Box>
                            <Box component="span">bins/s: <Box component="span" sx={{ fontWeight: 500, display: 'inline-block', minWidth: '4ch', textAlign: 'right' }}>{isStreaming ? humanizeNumber(eventMetrics.current.binsPerSecond) : '-'}</Box></Box>
                            <Box component="span" sx={{ opacity: 0.6 }}>•</Box>
                            <Box component="span">f: <Box component="span" sx={{ fontWeight: 500 }}>{isStreaming ? humanizeFrequency(centerFrequency) : '-'}</Box></Box>
                            <Box component="span" sx={{ opacity: 0.6 }}>•</Box>
                            <Box component="span">sr: <Box component="span" sx={{ fontWeight: 500 }}>{isStreaming ? humanizeFrequency(sampleRate) : '-'}</Box></Box>
                            <Box component="span" sx={{ opacity: 0.6 }}>•</Box>
                            <Box component="span">g: <Box component="span" sx={{ fontWeight: 500 }}>{isStreaming ? `${gain} dB` : '-'}</Box></Box>
                        </>
                    )}
                </Box>
                <Box sx={{ display: { xs: 'none', xl: 'flex' }, gap: 0.5, marginLeft: 'auto', flex: '0 0 auto' }}>
                    <Box component="span">zoom: <Box component="span" sx={{ fontWeight: 500 }}>{isStreaming && transformData ? `${transformData.scale.toFixed(1)}x` : '-'}</Box></Box>
                    <Box component="span" sx={{ opacity: 0.6 }}>•</Box>
                    <Box component="span">view: <Box component="span" sx={{ fontWeight: 500 }}>{isStreaming && transformData ? `${humanizeFrequency(transformData.startFreq)} - ${humanizeFrequency(transformData.endFreq)}` : '-'}</Box></Box>
                    <Box component="span" sx={{ opacity: 0.6 }}>•</Box>
                    <Box component="span">bw: <Box component="span" sx={{ fontWeight: 500 }}>{isStreaming && transformData ? humanizeFrequency(transformData.visibleBandwidth) : '-'}</Box></Box>
                </Box>
            </Box>
        </WaterfallStatusBarPaper>
    );
};
export default WaterfallStatusBar;
