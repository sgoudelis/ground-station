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

import React, { useMemo } from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

const FIX_QUALITY_TIMELINE_WINDOW_MS = 30 * 60 * 1000;
const FIX_QUALITY_TIMELINE_HEIGHT = 22;
const FIX_QUALITY_GUIDE_INTERVAL_MS = 5 * 60 * 1000;

function toFiniteNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

const GnssFixQualityTimeline = React.memo(function GnssFixQualityTimeline({
    timeline,
    nowMs,
}) {
    const { t } = useTranslation('waterfall');
    const theme = useTheme();

    const sparkline = useMemo(() => {
        const samples = Array.isArray(timeline) ? timeline : [];
        const startMs = nowMs - FIX_QUALITY_TIMELINE_WINDOW_MS;
        const windowed = samples.filter((point) => (
            Number.isFinite(point?.timestampMs)
            && Number.isFinite(point?.quality)
            && point.timestampMs >= startMs
        ));

        if (windowed.length === 0) {
            return {
                hasData: false,
                linePath: '',
                areaPath: '',
                latestQuality: null,
            };
        }

        const sorted = [...windowed].sort((a, b) => a.timestampMs - b.timestampMs);
        const qualityScaleMax = Math.max(5, Math.ceil(Math.max(...sorted.map((point) => point.quality))));
        const toX = (timestampMs) => ((timestampMs - startMs) / FIX_QUALITY_TIMELINE_WINDOW_MS) * 100;
        const toY = (quality) => {
            const normalized = Math.max(0, Math.min(1, quality / qualityScaleMax));
            return FIX_QUALITY_TIMELINE_HEIGHT - (normalized * FIX_QUALITY_TIMELINE_HEIGHT);
        };

        const linePath = sorted
            .map((point, index) => `${index === 0 ? 'M' : 'L'}${toX(point.timestampMs).toFixed(2)},${toY(point.quality).toFixed(2)}`)
            .join(' ');
        const first = sorted[0];
        const last = sorted[sorted.length - 1];
        const areaPath = `${linePath} L ${toX(last.timestampMs).toFixed(2)},${FIX_QUALITY_TIMELINE_HEIGHT} L ${toX(first.timestampMs).toFixed(2)},${FIX_QUALITY_TIMELINE_HEIGHT} Z`;

        return {
            hasData: true,
            linePath,
            areaPath,
            latestQuality: sorted[sorted.length - 1].quality,
        };
    }, [timeline, nowMs]);

    const guideLinePositions = useMemo(() => {
        const markerCount = Math.floor(FIX_QUALITY_TIMELINE_WINDOW_MS / FIX_QUALITY_GUIDE_INTERVAL_MS);
        // Skip left/right edges (0 and 100) and draw only inner 5-minute markers.
        return Array.from({ length: Math.max(0, markerCount - 1) }, (_, index) => (
            (((index + 1) * FIX_QUALITY_GUIDE_INTERVAL_MS) / FIX_QUALITY_TIMELINE_WINDOW_MS) * 100
        ));
    }, []);

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.22, mt: 0.1 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minWidth: 0 }}>
                <Typography
                    variant="caption"
                    sx={{ color: 'text.secondary', opacity: 0.7, fontSize: '0.58rem', lineHeight: 1 }}
                >
                    {t('gnss_fix_quality_timeline.fix_quality_30m', { defaultValue: 'Fix quality (30m)' })}
                </Typography>
                <Typography
                    variant="caption"
                    sx={{ color: 'text.secondary', opacity: 0.9, fontSize: '0.58rem', lineHeight: 1, fontFamily: 'monospace' }}
                >
                    {sparkline.latestQuality !== null ? `Q${toFiniteNumber(sparkline.latestQuality)}` : '-'}
                </Typography>
            </Box>
            <Box
                sx={{
                    height: FIX_QUALITY_TIMELINE_HEIGHT,
                    borderRadius: 0.45,
                    border: `1px solid ${alpha(theme.palette.border.main, 0.7)}`,
                    backgroundColor: alpha(theme.palette.background.default, 0.45),
                    overflow: 'hidden',
                }}
            >
                <svg width="100%" height="100%" viewBox={`0 0 100 ${FIX_QUALITY_TIMELINE_HEIGHT}`} preserveAspectRatio="none">
                    {guideLinePositions.map((x) => (
                        <line
                            key={`fix-quality-guide-${x.toFixed(2)}`}
                            x1={x}
                            y1="0"
                            x2={x}
                            y2={FIX_QUALITY_TIMELINE_HEIGHT}
                            stroke={alpha(theme.palette.text.secondary, 0.14)}
                            strokeWidth="0.5"
                            strokeDasharray="1.4 1.1"
                        />
                    ))}
                    <line
                        x1="0"
                        y1={FIX_QUALITY_TIMELINE_HEIGHT}
                        x2="100"
                        y2={FIX_QUALITY_TIMELINE_HEIGHT}
                        stroke={alpha(theme.palette.text.secondary, 0.22)}
                        strokeWidth="0.6"
                    />
                    <line
                        x1="0"
                        y1={(FIX_QUALITY_TIMELINE_HEIGHT / 2)}
                        x2="100"
                        y2={(FIX_QUALITY_TIMELINE_HEIGHT / 2)}
                        stroke={alpha(theme.palette.text.secondary, 0.14)}
                        strokeWidth="0.5"
                    />
                    {sparkline.hasData && (
                        <>
                            <path
                                d={sparkline.areaPath}
                                fill={alpha(theme.palette.info.main, 0.12)}
                            />
                            <path
                                d={sparkline.linePath}
                                fill="none"
                                stroke={alpha(theme.palette.info.main, 0.82)}
                                strokeWidth="1"
                                strokeLinejoin="round"
                                strokeLinecap="round"
                            />
                        </>
                    )}
                </svg>
            </Box>
        </Box>
    );
});

export default GnssFixQualityTimeline;
