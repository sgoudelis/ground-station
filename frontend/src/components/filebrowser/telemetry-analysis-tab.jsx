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
    Divider,
    Chip,
    Stack,
    useTheme,
    LinearProgress,
} from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import DataObjectIcon from '@mui/icons-material/DataObject';
import AssessmentIcon from '@mui/icons-material/Assessment';
import { useTranslation } from 'react-i18next';

function AnalysisSection({ title, icon, children }) {
    const theme = useTheme();
    return (
        <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                {icon}
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    {title}
                </Typography>
            </Stack>
            <Divider sx={{ mb: 2 }} />
            {children}
        </Paper>
    );
}

function StatRow({ label, value, unit }) {
    return (
        <Box sx={{
            display: 'flex',
            justifyContent: 'space-between',
            py: 0.5,
            alignItems: 'center',
        }}>
            <Typography variant="body2" color="text.secondary">
                {label}
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 500, fontFamily: 'monospace' }}>
                {value} {unit}
            </Typography>
        </Box>
    );
}

export default function AnalysisTab({ packet, telemetry }) {
    const { t } = useTranslation('filebrowser');
    const theme = useTheme();

    // Get hex data
    const hexString = packet?.hex || telemetry?.raw?.packet_hex || '';
    const payloadHex = telemetry?.data?.hex || hexString;

    // Analyze payload
    const analysis = useMemo(() => {
        if (!payloadHex) return null;

        const bytes = [];
        for (let i = 0; i < payloadHex.length; i += 2) {
            bytes.push(parseInt(payloadHex.substr(i, 2), 16));
        }

        // Count byte values
        let zeroBytes = 0;
        let ffBytes = 0;
        let printableAscii = 0;
        const byteCounts = new Array(256).fill(0);

        bytes.forEach(b => {
            byteCounts[b]++;
            if (b === 0) zeroBytes++;
            if (b === 0xFF) ffBytes++;
            if (b >= 32 && b < 127) printableAscii++;
        });

        // Calculate entropy (Shannon entropy)
        let entropy = 0;
        byteCounts.forEach(count => {
            if (count > 0) {
                const p = count / bytes.length;
                entropy -= p * Math.log2(p);
            }
        });

        // Detect probable float32 values
        const probableFloats = [];
        for (let i = 0; i <= bytes.length - 4; i += 4) {
            const buffer = new ArrayBuffer(4);
            const view = new DataView(buffer);
            view.setUint8(0, bytes[i]);
            view.setUint8(1, bytes[i + 1]);
            view.setUint8(2, bytes[i + 2]);
            view.setUint8(3, bytes[i + 3]);

            const floatValue = view.getFloat32(0, true);
            const absValue = Math.abs(floatValue);

            if (isFinite(floatValue) && absValue >= 0.01 && absValue <= 100) {
                let type = null;
                if (absValue < 10) type = 'voltage/current';
                else if (floatValue > -50 && floatValue < 100) type = 'temperature';

                if (type) {
                    probableFloats.push({ offset: i, value: floatValue, type });
                }
            }
        }

        // Detect probable timestamps
        const probableTimestamps = [];
        for (let i = 0; i <= bytes.length - 4; i += 4) {
            const buffer = new ArrayBuffer(4);
            const view = new DataView(buffer);
            view.setUint8(0, bytes[i]);
            view.setUint8(1, bytes[i + 1]);
            view.setUint8(2, bytes[i + 2]);
            view.setUint8(3, bytes[i + 3]);

            const value = view.getUint32(0, true);
            if (value > 946684800 && value < 4102444800) {
                probableTimestamps.push({ offset: i, value });
            }
        }

        // Detect patterns
        const patterns = [];

        // Check for incrementing sequences
        for (let i = 0; i < bytes.length - 3; i++) {
            if (bytes[i] + 1 === bytes[i + 1] &&
                bytes[i + 1] + 1 === bytes[i + 2] &&
                bytes[i + 2] + 1 === bytes[i + 3]) {
                patterns.push(`Incrementing sequence at 0x${i.toString(16)} (possible counter)`);
                break;
            }
        }

        // Check for repeated values
        if (zeroBytes > bytes.length * 0.2) {
            patterns.push(`High number of zero bytes (${(zeroBytes / bytes.length * 100).toFixed(1)}%) - unused fields?`);
        }

        if (ffBytes > bytes.length * 0.1) {
            patterns.push(`Many 0xFF bytes (${(ffBytes / bytes.length * 100).toFixed(1)}%) - initialization values?`);
        }

        // Entropy analysis
        if (entropy > 7) {
            patterns.push('High entropy - data may be compressed or encrypted');
        } else if (entropy < 4) {
            patterns.push('Low entropy - data has repetitive patterns');
        }

        return {
            totalBytes: bytes.length,
            zeroBytes,
            ffBytes,
            printableAscii,
            entropy,
            probableFloats,
            probableTimestamps,
            patterns,
        };
    }, [payloadHex]);

    if (!analysis) {
        return (
            <Box sx={{ p: 3, textAlign: 'center' }}>
                <Typography color="text.secondary">
                    {t('telemetry_analysis_tab.no_data_available_for_analysis', { defaultValue: 'No data available for analysis' })}
                </Typography>
            </Box>
        );
    }

    return (
        <Box>
            {/* Probable Fields */}
            <AnalysisSection
                title={t('telemetry_analysis_tab.probable_fields', { defaultValue: 'Probable Fields' })}
                icon={<TrendingUpIcon color="primary" />}
            >
                {analysis.probableFloats.length === 0 && analysis.probableTimestamps.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                        {t('telemetry_analysis_tab.no_high_confidence_field_detections_try_comparing_multip', { defaultValue: 'No high-confidence field detections. Try comparing multiple packets to identify patterns.' })}
                    </Typography>
                ) : (
                    <Stack spacing={1}>
                        {analysis.probableFloats.slice(0, 10).map((field, idx) => (
                            <Box
                                key={idx}
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 2,
                                    p: 1,
                                    backgroundColor: theme.palette.action.hover,
                                    borderRadius: 1,
                                }}
                            >
                                <Typography
                                    variant="caption"
                                    sx={{ fontFamily: 'monospace', minWidth: 60 }}
                                >
                                    0x{field.offset.toString(16).padStart(4, '0').toUpperCase()}
                                </Typography>
                                <Chip
                                    label={field.type}
                                    size="small"
                                    color={
                                        field.type.includes('voltage') ? 'primary' :
                                        field.type.includes('temperature') ? 'warning' :
                                        'secondary'
                                    }
                                    sx={{ fontSize: '0.7rem' }}
                                />
                                <Typography
                                    variant="body2"
                                    sx={{ fontFamily: 'monospace', fontWeight: 500 }}
                                >
                                    {field.value.toFixed(4)}
                                </Typography>
                            </Box>
                        ))}
                        {analysis.probableTimestamps.slice(0, 3).map((field, idx) => (
                            <Box
                                key={`ts-${idx}`}
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 2,
                                    p: 1,
                                    backgroundColor: theme.palette.action.hover,
                                    borderRadius: 1,
                                }}
                            >
                                <Typography
                                    variant="caption"
                                    sx={{ fontFamily: 'monospace', minWidth: 60 }}
                                >
                                    0x{field.offset.toString(16).padStart(4, '0').toUpperCase()}
                                </Typography>
                                <Chip
                                    label="timestamp"
                                    size="small"
                                    color="warning"
                                    sx={{ fontSize: '0.7rem' }}
                                />
                                <Typography
                                    variant="body2"
                                    sx={{ fontFamily: 'monospace', fontWeight: 500 }}
                                >
                                    {new Date(field.value * 1000).toISOString()}
                                </Typography>
                            </Box>
                        ))}
                    </Stack>
                )}
            </AnalysisSection>

            {/* Statistics */}
            <AnalysisSection
                title={t('telemetry_analysis_tab.payload_statistics', { defaultValue: 'Payload Statistics' })}
                icon={<AssessmentIcon color="primary" />}
            >
                <StatRow label={t('telemetry_analysis_tab.total_bytes', { defaultValue: 'Total Bytes' })} value={analysis.totalBytes} unit="bytes" />
                <StatRow
                    label={t('telemetry_analysis_tab.zero_bytes', { defaultValue: 'Zero Bytes' })}
                    value={`${analysis.zeroBytes} (${(analysis.zeroBytes / analysis.totalBytes * 100).toFixed(1)}%)`}
                    unit=""
                />
                <StatRow
                    label={t('telemetry_analysis_tab.0xff_bytes', { defaultValue: '0xFF Bytes' })}
                    value={`${analysis.ffBytes} (${(analysis.ffBytes / analysis.totalBytes * 100).toFixed(1)}%)`}
                    unit=""
                />
                <StatRow
                    label={t('telemetry_analysis_tab.printable_ascii', { defaultValue: 'Printable ASCII' })}
                    value={`${analysis.printableAscii} (${(analysis.printableAscii / analysis.totalBytes * 100).toFixed(1)}%)`}
                    unit=""
                />
                <Box sx={{ mt: 2 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        {t('telemetry_analysis_tab.entropy', { defaultValue: 'Entropy:' })} {analysis.entropy.toFixed(2)} bits/byte
                    </Typography>
                    <LinearProgress
                        variant="determinate"
                        value={(analysis.entropy / 8) * 100}
                        sx={{ height: 8, borderRadius: 1 }}
                    />
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                        {analysis.entropy > 7 ? 'High randomness' :
                         analysis.entropy > 5 ? 'Medium randomness' :
                         'Low randomness (repetitive)'}
                    </Typography>
                </Box>
            </AnalysisSection>

            {/* Patterns */}
            <AnalysisSection
                title={t('telemetry_analysis_tab.detected_patterns', { defaultValue: 'Detected Patterns' })}
                icon={<DataObjectIcon color="primary" />}
            >
                {analysis.patterns.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                        {t('telemetry_analysis_tab.no_obvious_patterns_detected', { defaultValue: 'No obvious patterns detected.' })}
                    </Typography>
                ) : (
                    <Stack spacing={1}>
                        {analysis.patterns.map((pattern, idx) => (
                            <Box
                                key={idx}
                                sx={{
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: 1,
                                    p: 1,
                                    backgroundColor: theme.palette.action.hover,
                                    borderRadius: 1,
                                }}
                            >
                                <Typography variant="body2" sx={{ fontSize: '1.2em' }}>
                                    •
                                </Typography>
                                <Typography variant="body2">
                                    {pattern}
                                </Typography>
                            </Box>
                        ))}
                    </Stack>
                )}
            </AnalysisSection>
        </Box>
    );
}
