// Copyright (c) 2026 Efstratios Goudelis
// SPDX-License-Identifier: GPL-3.0-only

import React from 'react';
import { Box, FormControl, FormHelperText, InputLabel, ListSubheader, MenuItem, Select, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { mapParametersToBackend } from './decoder-parameters.js';
import { findLoraProfile, LORA_PROFILE_GROUPS, LORA_PROFILES } from './lora-profiles.js';
import { formatLoraConfig } from '../../utils/lora-config.js';

const LoraProfileSelect = ({ parameters, disabled, onSelect, vfoIndex, helperText }) => {
    const { t } = useTranslation('waterfall');
    // Keep an explicit region choice when multiple profiles share the same
    // PHY, and display Custom when edits no longer match the selected profile.
    const [profileId, setProfileId] = React.useState(null);
    const selected = findLoraProfile(parameters, profileId);
    const labelId = `vfo-${vfoIndex}-lora-profile-label`;
    const helpId = `vfo-${vfoIndex}-lora-profile-help`;
    const label = t('lora_profiles.label', { defaultValue: 'LoRa profile' });
    const config = selected ? mapParametersToBackend('lora', selected.parameters) : null;

    return (
        <Box sx={{ mb: 3 }}>
            <FormControl fullWidth size="small" disabled={disabled}>
                <InputLabel id={labelId}>{label}</InputLabel>
                <Select
                    labelId={labelId}
                    label={label}
                    value={selected?.id ?? 'custom'}
                    inputProps={{ 'aria-describedby': helpId }}
                    MenuProps={{ PaperProps: { sx: { maxHeight: 360 } } }}
                    onChange={(event) => {
                        const next = LORA_PROFILES.find(candidate => candidate.id === event.target.value);
                        if (next) {
                            setProfileId(next.id);
                            onSelect(structuredClone(next.parameters));
                        }
                    }}
                >
                    <MenuItem value="custom" disabled>
                        {t('lora_profiles.custom', { defaultValue: 'Custom' })}
                    </MenuItem>
                    {LORA_PROFILE_GROUPS.flatMap(group => [
                        <ListSubheader key={group.label}>{group.label}</ListSubheader>,
                        ...group.profiles.map(candidate => (
                            <MenuItem key={candidate.id} value={candidate.id}>{candidate.label}</MenuItem>
                        )),
                    ])}
                </Select>
                <FormHelperText id={helpId}>
                    {helperText ?? t('lora_profiles.help', {
                        defaultValue: 'Load modem settings, adjust them below, then Apply. Tune the VFO to the network frequency separately.',
                    })}
                </FormHelperText>
            </FormControl>
            {config && (
                <Typography variant="caption" sx={{ display: 'block', mt: 1, color: 'text.secondary' }}>
                    {formatLoraConfig({ ...config, payload_length: undefined, has_crc: undefined })}
                </Typography>
            )}
            {selected?.frequencyMHz && (
                <Typography variant="caption" sx={{ display: 'block', color: 'text.secondary' }}>
                    {t('lora_profiles.suggested_frequency', {
                        defaultValue: 'Suggested frequency: {{frequency}} MHz', frequency: selected.frequencyMHz,
                    })}
                </Typography>
            )}
            {selected?.family === 'reticulum' && (
                <FormHelperText>
                    {t('lora_profiles.reticulum_help', {
                        defaultValue: 'Example SF8/BW125 settings for an SX126x RNode. Match the spreading factor, bandwidth, coding rate and preamble to your network.',
                    })}
                </FormHelperText>
            )}
            {selected?.family === 'lorawan' && (
                <FormHelperText>
                    {t('lora_profiles.lorawan_help', {
                        defaultValue: 'Receives one channel and data rate at a time. Downlink profiles invert IQ. Explicit headers announce coding rate and CRC presence.',
                    })}
                </FormHelperText>
            )}
        </Box>
    );
};

export default LoraProfileSelect;
