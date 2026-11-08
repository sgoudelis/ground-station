// Copyright (c) 2026 Efstratios Goudelis
// SPDX-License-Identifier: GPL-3.0-or-later

import React from 'react';
import { useSelector } from 'react-redux';
import { Alert, Box, IconButton, Stack, Tooltip, Typography } from '@mui/material';
import { VolumeOff, VolumeUp } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useAudio } from '../dashboard/audio-provider.jsx';
import { DEFAULT_VFO_COLORS } from './vfo-marker/vfo-config.js';

export default function ContinuousObservationView({ observation }) {
    const { t } = useTranslation('waterfall');
    const muted = useSelector((state) => state.vfo.vfoMuted || {});
    const { setVfoMute } = useAudio();
    return <Stack spacing={1} sx={{ p: 1.5 }}>
        <Alert severity="info">{t('continuous_view.help', { defaultValue: 'Viewing a continuous observation. Stop it in the scheduler before editing its receiver or VFOs.' })}</Alert>
        <Typography variant="subtitle2">{observation.name}</Typography>
        {Object.entries(observation.vfos || {}).map(([number, vfo]) => <Stack key={number} direction="row" spacing={1} alignItems="center"
            sx={{ borderLeft: '3px solid', borderColor: DEFAULT_VFO_COLORS[(Number(number) - 1) % DEFAULT_VFO_COLORS.length], p: 1 }}>
            <Box sx={{ flex: 1 }}>
                <Typography variant="body2">VFO {number} · {(vfo.center_freq / 1e6).toFixed(6)} MHz</Typography>
                <Typography variant="caption" color="text.secondary">{(vfo.bandwidth / 1000).toFixed(2)} kHz · {(vfo.decoder !== 'none' ? vfo.decoder : vfo.modulation).toUpperCase()}</Typography>
            </Box>
            {vfo.modulation !== 'none' && <Tooltip title={t('continuous_view.local_audio', { defaultValue: 'Mute or unmute audio in this browser' })}>
                <IconButton size="small" aria-label={`${muted[number] ? 'Unmute' : 'Mute'} VFO ${number}`}
                    onClick={() => setVfoMute(Number(number), !muted[number])}>
                    {muted[number] ? <VolumeOff fontSize="small" /> : <VolumeUp fontSize="small" />}
                </IconButton>
            </Tooltip>}
        </Stack>)}
    </Stack>;
}
