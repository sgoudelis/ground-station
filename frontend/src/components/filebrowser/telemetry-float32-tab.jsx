/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import React, { useState, useMemo } from 'react';
import {
    Box,
    Typography,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Chip,
    Switch,
    FormControlLabel,
    Stack,
    useTheme,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

function Float32Row({ offset, value, hex, type }) {
    const theme = useTheme();

    return (
        <TableRow sx={{ '&:hover': { backgroundColor: theme.palette.action.hover } }}>
            <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                0x{offset.toString(16).padStart(4, '0').toUpperCase()}
            </TableCell>
            <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                {hex}
            </TableCell>
            <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.875rem', fontWeight: 500 }}>
                {value.toFixed(4)}
            </TableCell>
            <TableCell>
                {type && (
                    <Chip
                        label={type}
                        size="small"
                        color={
                            type.includes('voltage') ? 'primary' :
                            type.includes('temperature') ? 'warning' :
                            type.includes('current') ? 'secondary' :
                            'default'
                        }
                        sx={{ fontSize: '0.7rem' }}
                    />
                )}
            </TableCell>
        </TableRow>
    );
}

export default function Float32Tab({ packet, telemetry }) {
    const { t } = useTranslation('filebrowser');
    const theme = useTheme();
    const [showAll, setShowAll] = useState(false);

    // Get hex data
    const hexString = packet?.hex || telemetry?.raw?.packet_hex || '';

    // Parse and interpret as float32
    const floatValues = useMemo(() => {
        if (!hexString) return [];

        const bytes = [];
        for (let i = 0; i < hexString.length; i += 2) {
            bytes.push(parseInt(hexString.substr(i, 2), 16));
        }

        const result = [];
        for (let i = 0; i <= bytes.length - 4; i += 4) {
            // Create DataView for proper float32 conversion
            const buffer = new ArrayBuffer(4);
            const view = new DataView(buffer);
            view.setUint8(0, bytes[i]);
            view.setUint8(1, bytes[i + 1]);
            view.setUint8(2, bytes[i + 2]);
            view.setUint8(3, bytes[i + 3]);

            const floatValue = view.getFloat32(0, true); // true = little-endian

            // Check if it's a valid number (not NaN, not Infinity)
            if (isFinite(floatValue)) {
                const hexBytes = bytes.slice(i, i + 4)
                    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
                    .join(' ');

                // Determine possible type based on value range
                let possibleType = null;
                const absValue = Math.abs(floatValue);

                if (absValue > 0.01 && absValue < 10) {
                    possibleType = 'voltage/current?';
                } else if (floatValue > -50 && floatValue < 100) {
                    possibleType = 'temperature?';
                } else if (absValue > 0 && absValue < 50) {
                    possibleType = 'measurement?';
                }

                result.push({
                    offset: i,
                    value: floatValue,
                    hex: hexBytes,
                    type: possibleType,
                    isRealistic: absValue >= 0.01 && absValue <= 100
                });
            }
        }

        return result;
    }, [hexString]);

    // Filter based on showAll toggle
    const displayedValues = useMemo(() => {
        if (showAll) return floatValues;
        return floatValues.filter(v => v.isRealistic);
    }, [floatValues, showAll]);

    if (!hexString) {
        return (
            <Box sx={{ p: 3, textAlign: 'center' }}>
                <Typography color="text.secondary">
                    {t('telemetry_float32_tab.no_data_available', { defaultValue: 'No data available' })}
                </Typography>
            </Box>
        );
    }

    return (
        <Box>
            {/* Controls */}
            <Stack direction="row" spacing={2} sx={{ mb: 2, alignItems: 'center' }}>
                <FormControlLabel
                    control={
                        <Switch
                            checked={showAll}
                            onChange={(e) => setShowAll(e.target.checked)}
                            size="small"
                        />
                    }
                    label={
                        <Typography variant="body2">
                            {t('telemetry_float32_tab.show_all_values_including_unrealistic', { defaultValue: 'Show all values (including unrealistic)' })}
                        </Typography>
                    }
                />
                <Box sx={{ flexGrow: 1 }} />
                <Typography variant="caption" color="text.secondary">
                    {t('telemetry_float32_tab.showing', { defaultValue: 'Showing' })} {displayedValues.length} of {floatValues.length} values
                </Typography>
            </Stack>

            {/* Table */}
            <TableContainer component={Paper} variant="outlined">
                <Table size="small">
                    <TableHead>
                        <TableRow sx={{ backgroundColor: theme.palette.mode === 'dark' ? theme.palette.grey[900] : theme.palette.grey[100] }}>
                            <TableCell sx={{ fontWeight: 700 }}>{t('telemetry_float32_tab.offset', { defaultValue: 'Offset' })}</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>{t('telemetry_float32_tab.hex_4_bytes', { defaultValue: 'Hex (4 bytes)' })}</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>{t('telemetry_float32_tab.float32_value', { defaultValue: 'Float32 Value' })}</TableCell>
                            <TableCell sx={{ fontWeight: 700 }}>{t('telemetry_float32_tab.possible_type', { defaultValue: 'Possible Type' })}</TableCell>
                        </TableRow>
                    </TableHead>
                    <TableBody>
                        {displayedValues.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={4} align="center" sx={{ py: 3 }}>
                                    <Typography color="text.secondary">
                                        {showAll
                                            ? 'No valid float32 values found'
                                            : 'No realistic float32 values found. Toggle "Show all" to see everything.'}
                                    </Typography>
                                </TableCell>
                            </TableRow>
                        ) : (
                            displayedValues.map((item) => (
                                <Float32Row
                                    key={item.offset}
                                    offset={item.offset}
                                    value={item.value}
                                    hex={item.hex}
                                    type={item.type}
                                />
                            ))
                        )}
                    </TableBody>
                </Table>
            </TableContainer>

            {/* Info box */}
            <Box sx={{ mt: 2, p: 2, bgcolor: theme.palette.info.main + '30', borderRadius: 1, border: `1px solid ${theme.palette.info.main}60` }}>
                <Typography variant="caption" sx={{ color: theme.palette.info.light, fontWeight: 500 }}>
                    {t('telemetry_float32_tab.interpreting_payload_as_little_endian_float32_ieee_754_v', { defaultValue: '💡 Interpreting payload as little-endian Float32 (IEEE 754) values.\n                    Realistic ranges: voltages (0-10V), temperatures (-50 to +100°C), currents (0-5A).\n                    Hover over types to understand the heuristics used for classification.' })}
                </Typography>
            </Box>
        </Box>
    );
}
