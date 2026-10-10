/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import React, { useMemo } from 'react';
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
    Grid,
    Chip,
    useTheme,
} from '@mui/material';
import { useTranslation } from 'react-i18next';

function isProbableTimestamp(value) {
    // Unix timestamp range: Jan 1, 2000 to Dec 31, 2100
    return value > 946684800 && value < 4102444800;
}

function isProbableCounter(value) {
    // Small incrementing values
    return value > 0 && value < 100000;
}

export default function IntegersTab({ packet, telemetry }) {
    const { t } = useTranslation('filebrowser');
    const theme = useTheme();

    // Get hex data
    const hexString = packet?.hex || telemetry?.raw?.packet_hex || '';

    // Parse as uint16
    const uint16Values = useMemo(() => {
        if (!hexString) return [];

        const bytes = [];
        for (let i = 0; i < hexString.length; i += 2) {
            bytes.push(parseInt(hexString.substr(i, 2), 16));
        }

        const result = [];
        for (let i = 0; i <= bytes.length - 2; i += 2) {
            const buffer = new ArrayBuffer(2);
            const view = new DataView(buffer);
            view.setUint8(0, bytes[i]);
            view.setUint8(1, bytes[i + 1]);

            const value = view.getUint16(0, true); // little-endian

            const hexBytes = bytes.slice(i, i + 2)
                .map(b => b.toString(16).padStart(2, '0').toUpperCase())
                .join(' ');

            // Determine type
            let type = null;
            if (value >= 100 && value <= 4095) {
                type = 'ADC value?';
            } else if (value > 0 && value < 256) {
                type = 'small counter?';
            }

            result.push({
                offset: i,
                value,
                hex: hexBytes,
                type
            });
        }

        return result;
    }, [hexString]);

    // Parse as uint32
    const uint32Values = useMemo(() => {
        if (!hexString) return [];

        const bytes = [];
        for (let i = 0; i < hexString.length; i += 2) {
            bytes.push(parseInt(hexString.substr(i, 2), 16));
        }

        const result = [];
        for (let i = 0; i <= bytes.length - 4; i += 4) {
            const buffer = new ArrayBuffer(4);
            const view = new DataView(buffer);
            view.setUint8(0, bytes[i]);
            view.setUint8(1, bytes[i + 1]);
            view.setUint8(2, bytes[i + 2]);
            view.setUint8(3, bytes[i + 3]);

            const value = view.getUint32(0, true); // little-endian

            const hexBytes = bytes.slice(i, i + 4)
                .map(b => b.toString(16).padStart(2, '0').toUpperCase())
                .join(' ');

            // Determine type
            let type = null;
            if (isProbableTimestamp(value)) {
                type = 'timestamp?';
            } else if (isProbableCounter(value)) {
                type = 'counter?';
            }

            result.push({
                offset: i,
                value,
                hex: hexBytes,
                type
            });
        }

        return result;
    }, [hexString]);

    if (!hexString) {
        return (
            <Box sx={{ p: 3, textAlign: 'center' }}>
                <Typography color="text.secondary">
                    {t('telemetry_integers_tab.no_data_available', { defaultValue: 'No data available' })}
                </Typography>
            </Box>
        );
    }

    return (
        <Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 3 }}>
                {/* Uint16 Table */}
                <Box>
                    <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
                        {t('telemetry_integers_tab.as_uint16_little_endian', { defaultValue: 'As Uint16 (Little-Endian)' })}
                    </Typography>
                    <TableContainer
                        component={Paper}
                        variant="outlined"
                        sx={{ maxHeight: 'calc(60vh - 60px)', overflow: 'auto' }}
                    >
                        <Table size="small" stickyHeader>
                            <TableHead>
                                <TableRow>
                                    <TableCell sx={{ fontWeight: 700, backgroundColor: theme.palette.background.paper }}>
                                        {t('telemetry_integers_tab.offset', { defaultValue: 'Offset' })}
                                    </TableCell>
                                    <TableCell sx={{ fontWeight: 700, backgroundColor: theme.palette.background.paper }}>
                                        {t('telemetry_integers_tab.value', { defaultValue: 'Value' })}
                                    </TableCell>
                                    <TableCell sx={{ fontWeight: 700, backgroundColor: theme.palette.background.paper }}>
                                        {t('telemetry_integers_tab.type', { defaultValue: 'Type' })}
                                    </TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {uint16Values.map((item) => (
                                    <TableRow
                                        key={item.offset}
                                        sx={{ '&:hover': { backgroundColor: theme.palette.action.hover } }}
                                    >
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                                            0x{item.offset.toString(16).padStart(4, '0').toUpperCase()}
                                        </TableCell>
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                                            {item.value}
                                        </TableCell>
                                        <TableCell>
                                            {item.type && (
                                                <Chip
                                                    label={item.type}
                                                    size="small"
                                                    sx={{ fontSize: '0.65rem', height: '20px' }}
                                                />
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Box>

                {/* Uint32 Table */}
                <Box>
                    <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
                        {t('telemetry_integers_tab.as_uint32_little_endian', { defaultValue: 'As Uint32 (Little-Endian)' })}
                    </Typography>
                    <TableContainer
                        component={Paper}
                        variant="outlined"
                        sx={{ maxHeight: 'calc(60vh - 60px)', overflow: 'auto' }}
                    >
                        <Table size="small" stickyHeader>
                            <TableHead>
                                <TableRow>
                                    <TableCell sx={{ fontWeight: 700, backgroundColor: theme.palette.background.paper }}>
                                        {t('telemetry_integers_tab.offset', { defaultValue: 'Offset' })}
                                    </TableCell>
                                    <TableCell sx={{ fontWeight: 700, backgroundColor: theme.palette.background.paper }}>
                                        {t('telemetry_integers_tab.value', { defaultValue: 'Value' })}
                                    </TableCell>
                                    <TableCell sx={{ fontWeight: 700, backgroundColor: theme.palette.background.paper }}>
                                        {t('telemetry_integers_tab.type', { defaultValue: 'Type' })}
                                    </TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {uint32Values.map((item) => (
                                    <TableRow
                                        key={item.offset}
                                        sx={{ '&:hover': { backgroundColor: theme.palette.action.hover } }}
                                    >
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                                            0x{item.offset.toString(16).padStart(4, '0').toUpperCase()}
                                        </TableCell>
                                        <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                                            {item.value}
                                        </TableCell>
                                        <TableCell>
                                            {item.type && (
                                                <Chip
                                                    label={item.type}
                                                    size="small"
                                                    color={item.type.includes('timestamp') ? 'warning' : 'default'}
                                                    sx={{ fontSize: '0.65rem', height: '20px' }}
                                                />
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </Box>
            </Box>

            {/* Info box */}
            <Box sx={{ mt: 2, p: 2, bgcolor: theme.palette.info.main + '30', borderRadius: 1, border: `1px solid ${theme.palette.info.main}60` }}>
                <Typography variant="caption" sx={{ color: theme.palette.info.light, fontWeight: 500 }}>
                    {t('telemetry_integers_tab.interpreting_payload_as_little_endian_unsigned_integers_', { defaultValue: '💡 Interpreting payload as little-endian unsigned integers.\n                    Uint16 range: 0-65,535 (ADC values typically 0-4095).\n                    Uint32 range: 0-4,294,967,295 (timestamps, large counters).\n                    Values between 946684800-4102444800 likely Unix timestamps (2000-2100).' })}
                </Typography>
            </Box>
        </Box>
    );
}
