// Copyright (c) 2026 Efstratios Goudelis
// SPDX-License-Identifier: GPL-3.0-or-later

import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useSelector } from 'react-redux';
import { DEFAULT_VFO_COLORS } from '../waterfall/vfo-marker/vfo-config.js';

export default function ContinuousBandPreview({ capture, vfos, center }) {
    const { t } = useTranslation('common');
    const colors = useSelector((state) => state.vfo?.vfoColors?.length ? state.vfo.vfoColors : DEFAULT_VFO_COLORS);
    if (!(capture.bandwidth > 0) || !(center > 0)) return null;
    const position = (frequency) => Math.max(0, Math.min(100, (frequency - capture.min) / capture.bandwidth * 100));
    const format = (frequency) => `${(frequency / 1e6).toFixed(4)} MHz`;

    return <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
        <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('continuous_observations.capture_preview')}</Typography>
        <Box role="img" aria-label={t('continuous_observations.capture_description', {
            min: format(capture.min), max: format(capture.max), count: vfos.length,
        })} sx={{ position: 'relative', height: 64, overflow: 'hidden', bgcolor: 'action.hover', borderRadius: 1 }}>
            <Box sx={{ position: 'absolute', left: '50%', top: 0, bottom: 0, borderLeft: '1px dashed', borderColor: 'text.disabled' }} />
            {vfos.map((vfo, index) => {
                if (!(vfo.frequency > 0) || !(vfo.bandwidth > 0)) return null;
                const outside = vfo.frequency - vfo.bandwidth / 2 < capture.min
                    || vfo.frequency + vfo.bandwidth / 2 > capture.max;
                const left = position(vfo.frequency - vfo.bandwidth / 2);
                const right = position(vfo.frequency + vfo.bandwidth / 2);
                // Continuous observations can have more VFOs than the waterfall palette.
                const color = colors[index % colors.length];
                return <Box key={vfo.id} sx={{
                    position: 'absolute', left: `${left}%`, width: `${right - left}%`, minWidth: 3,
                    top: 28, height: 30, bgcolor: color, opacity: 0.8,
                    // Keep the VFO's identity color when its channel exceeds reception.
                    outline: outside ? '2px solid' : 'none', outlineColor: 'error.main',
                }}>
                    <Typography variant="caption" sx={{
                        position: 'absolute', bottom: 30, left: '50%', transform: 'translateX(-50%)',
                        whiteSpace: 'nowrap', color,
                    }}>
                        {t('continuous_observations.vfo_number', { number: index + 1 })}
                    </Typography>
                </Box>;
            })}
        </Box>
        <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.5 }}>
            <Typography variant="caption" color="text.secondary">{format(capture.min)}</Typography>
            <Typography variant="caption" color="text.secondary">{format(capture.max)}</Typography>
        </Stack>
    </Box>;
}
