/**
 * @license
 * Copyright (c) 2026 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import React, { useId } from 'react';
import { Box, FormControl, InputLabel, ListSubheader, MenuItem, Select, Stack, Typography } from '@mui/material';
import RadioIcon from '@mui/icons-material/Radio';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import { getTransmitterBand } from './transmitter-bands.js';

const BAND_ORDER = ['hf', 'vhf', 'uhf', 'l_band', 's_band', 'c_band', 'x_band', 'other'];

const groupTransmittersByBand = (transmitters) => {
    const grouped = {};
    transmitters.forEach((transmitter) => {
        const band = getTransmitterBand(Number(transmitter.downlink_low));
        if (!grouped[band]) grouped[band] = [];
        grouped[band].push(transmitter);
    });
    return BAND_ORDER
        .filter((band) => grouped[band])
        .map((band) => ({
            band,
            transmitters: grouped[band].sort((a, b) => Number(a.downlink_low) - Number(b.downlink_low)),
        }));
};

export function ObservationRigFields({ rig, rigs, transmitters, disabled, transmitterError = false, onChange, t }) {
    const rigLabelId = useId();
    const transmitterLabelId = useId();
    const available = transmitters.filter((transmitter) => Number(transmitter.downlink_low) > 0);
    const selectedTransmitter = available.some((transmitter) => String(transmitter.id) === String(rig?.transmitter_id))
        ? String(rig.transmitter_id)
        : '';

    return (
        <Box>
            <Typography variant="subtitle2" gutterBottom sx={{ color: 'primary.main', fontWeight: 'bold' }}>
                {t('scheduler_dialogs.shared.observation_rig')}
            </Typography>
            <Stack spacing={2}>
                <FormControl fullWidth size="small" disabled={disabled}>
                    <InputLabel id={rigLabelId}>{t('scheduler_dialogs.shared.observation_rig')}</InputLabel>
                    <Select
                        labelId={rigLabelId}
                        value={rig?.id || '__none__'}
                        label={t('scheduler_dialogs.shared.observation_rig')}
                        onChange={(event) => onChange({
                            ...rig,
                            id: event.target.value === '__none__' ? null : event.target.value,
                            transmitter_id: event.target.value === '__none__' ? '' : rig?.transmitter_id || '',
                            doppler_correction: event.target.value !== '__none__',
                        })}
                    >
                        <MenuItem value="__none__">
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <RadioButtonUncheckedIcon sx={{ fontSize: '1rem', opacity: 0.8 }} />
                                {t('scheduler_dialogs.shared.none')}
                            </Box>
                        </MenuItem>
                        {rigs.map((item) => (
                            <MenuItem key={item.id} value={item.id}>
                                <Box sx={{ width: '100%', minWidth: 0 }}>
                                    <Stack direction="row" spacing={1} alignItems="center">
                                        <RadioIcon sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />
                                        <Typography variant="body2">{item.name || item.id}</Typography>
                                    </Stack>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                        {[
                                            item.host ? `${item.host}${item.port ? `:${item.port}` : ''}` : null,
                                            item.radio_mode ? t('scheduler_dialogs.shared.mode_value', { value: item.radio_mode }) : null,
                                        ].filter(Boolean).join(' • ') || t('scheduler_dialogs.shared.no_additional_details')}
                                    </Typography>
                                </Box>
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
                <FormControl fullWidth size="small" required error={transmitterError} disabled={disabled || !rig?.id || !available.length}>
                    <InputLabel id={transmitterLabelId}>{t('scheduler_dialogs.shared.observation_rig_transmitter')}</InputLabel>
                    <Select
                        labelId={transmitterLabelId}
                        value={selectedTransmitter}
                        label={t('scheduler_dialogs.shared.observation_rig_transmitter')}
                        onChange={(event) => onChange({ ...rig, transmitter_id: event.target.value })}
                    >
                        {groupTransmittersByBand(available).map(({ band, transmitters: bandTransmitters }) => [
                            <ListSubheader key={`header-${band}`}>
                                {t(`scheduler_dialogs.shared.band_${band}`)}
                            </ListSubheader>,
                            ...bandTransmitters.map((transmitter) => (
                                <MenuItem key={transmitter.id} value={String(transmitter.id)}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                        <Box sx={{
                                            width: 8,
                                            height: 8,
                                            borderRadius: '50%',
                                            backgroundColor: transmitter.alive ? '#4caf50' : '#f44336',
                                            boxShadow: transmitter.alive
                                                ? '0 0 6px rgba(76, 175, 80, 0.6)'
                                                : '0 0 6px rgba(244, 67, 54, 0.6)',
                                            flexShrink: 0,
                                        }} />
                                        <Box sx={{ flexGrow: 1 }}>
                                            <Typography variant="body2">
                                                {transmitter.description || t('unknown')} - {(Number(transmitter.downlink_low) / 1000000).toFixed(3)} MHz
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                                {[
                                                    t('scheduler_dialogs.shared.source_value', { value: transmitter.source || t('unknown') }),
                                                    transmitter.mode ? t('scheduler_dialogs.shared.mode_value', { value: transmitter.mode }) : null,
                                                    transmitter.baud ? t('scheduler_dialogs.shared.baud_value', { value: transmitter.baud }) : null,
                                                    transmitter.baudrate ? t('scheduler_dialogs.shared.baudrate_value', { value: transmitter.baudrate }) : null,
                                                    transmitter.drift != null ? t('scheduler_dialogs.shared.drift_hz_value', { value: transmitter.drift }) : null,
                                                ].filter(Boolean).join(' • ') || t('scheduler_dialogs.shared.no_additional_details')}
                                            </Typography>
                                        </Box>
                                    </Box>
                                </MenuItem>
                            )),
                        ])}
                    </Select>
                </FormControl>
            </Stack>
        </Box>
    );
}
