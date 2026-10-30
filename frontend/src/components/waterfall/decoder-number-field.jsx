// Copyright (c) 2026 Efstratios Goudelis
// SPDX-License-Identifier: GPL-3.0-or-later

import React from 'react';
import { TextField } from '@mui/material';
import { isDecoderParameterValid } from './decoder-parameters.js';

export const DecoderNumberField = ({ definition, value, onChange, disabled = false, optional = false }) => {
    // Transmitter profiles can leave values unspecified; decoder tasks require them.
    const valid = (optional && value === '') || isDecoderParameterValid(definition, value);

    return (
        <TextField
            fullWidth
            size="small"
            type="number"
            label={definition.label}
            value={value}
            placeholder={optional ? 'Unspecified' : undefined}
            disabled={disabled}
            error={!valid}
            helperText={valid
                ? definition.description
                : `Enter a whole number between ${definition.min} and ${definition.max}.`}
            slotProps={{ htmlInput: { min: definition.min, max: definition.max, step: definition.step } }}
            onChange={(event) => {
                // Keep a cleared field empty so validation cannot silently turn it into zero.
                onChange(event.target.value === '' ? '' : Number(event.target.value));
            }}
        />
    );
};
