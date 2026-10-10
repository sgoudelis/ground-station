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
    Chip,
    Stack,
    Button,
    Divider,
    useTheme,
    Tooltip,
    IconButton,
} from '@mui/material';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { toast } from 'react-toastify';
import { useTranslation } from 'react-i18next';

function getConfidenceColor(confidence) {
    switch (confidence) {
        case 'high':
            return 'success';
        case 'medium':
            return 'warning';
        case 'low':
            return 'default';
        default:
            return 'default';
    }
}

function getTypeColor(detectedType) {
    if (detectedType.includes('callsign')) return 'primary';
    if (detectedType.includes('version')) return 'secondary';
    if (detectedType.includes('status')) return 'success';
    if (detectedType.includes('datetime')) return 'info';
    return 'default';
}

export default function StringsTab({ packet, telemetry }) {
    const { t } = useTranslation('filebrowser');
    const theme = useTheme();

    // Get string analysis from backend
    const stringAnalysis = useMemo(() => {
        // First check if backend provided analysis
        if (telemetry?.analysis?.as_strings) {
            return telemetry.analysis.as_strings;
        }

        // Fallback: do client-side analysis if no backend data
        const hexString = packet?.hex || telemetry?.raw?.packet_hex || '';
        if (!hexString) return null;

        // Convert hex to bytes
        const bytes = [];
        for (let i = 0; i < hexString.length; i += 2) {
            bytes.push(parseInt(hexString.substr(i, 2), 16));
        }

        // Simple client-side string extraction
        const strings = [];
        let currentString = [];
        let startOffset = 0;

        bytes.forEach((byte, i) => {
            if (byte >= 32 && byte <= 126) {
                if (currentString.length === 0) {
                    startOffset = i;
                }
                currentString.push(byte);
            } else {
                if (currentString.length >= 3) {
                    const content = String.fromCharCode(...currentString);
                    strings.push({
                        offset: startOffset,
                        length: currentString.length,
                        content,
                        encoding: 'ascii',
                        detected_type: 'text',
                        confidence: 'medium',
                        hex: currentString.map(b => b.toString(16).padStart(2, '0')).join(''),
                    });
                }
                currentString = [];
            }
        });

        // Handle final string
        if (currentString.length >= 3) {
            const content = String.fromCharCode(...currentString);
            strings.push({
                offset: startOffset,
                length: currentString.length,
                content,
                encoding: 'ascii',
                detected_type: 'text',
                confidence: 'medium',
                hex: currentString.map(b => b.toString(16).padStart(2, '0')).join(''),
            });
        }

        const totalPrintable = bytes.filter(b => b >= 32 && b <= 126).length;

        return {
            strings,
            statistics: {
                total_bytes: bytes.length,
                printable_ascii_count: totalPrintable,
                printable_ascii_percent: ((totalPrintable / bytes.length) * 100).toFixed(1),
                null_bytes: bytes.filter(b => b === 0).length,
                strings_found: strings.length,
            },
        };
    }, [packet, telemetry]);

    const handleCopyString = (content) => {
        navigator.clipboard.writeText(content);
        toast.success('String copied to clipboard');
    };

    const handleCopyAll = () => {
        if (!stringAnalysis?.strings) return;

        const allStrings = stringAnalysis.strings
            .map(s => `[0x${s.offset.toString(16).padStart(4, '0').toUpperCase()}] ${s.content}`)
            .join('\n');

        navigator.clipboard.writeText(allStrings);
        toast.success(`Copied ${stringAnalysis.strings.length} strings to clipboard`);
    };

    const handleCopyReport = () => {
        if (!stringAnalysis) return;

        const report = [
            '=== String Analysis Report ===',
            '',
            'Statistics:',
            `  Total Bytes: ${stringAnalysis.statistics.total_bytes}`,
            `  Printable ASCII: ${stringAnalysis.statistics.printable_ascii_count} (${stringAnalysis.statistics.printable_ascii_percent}%)`,
            `  Null Bytes: ${stringAnalysis.statistics.null_bytes}`,
            `  Strings Found: ${stringAnalysis.statistics.strings_found}`,
            '',
            t('telemetry_strings_tab.detected_strings', { defaultValue: 'Detected Strings:' }),
            '',
            ...stringAnalysis.strings.map(s =>
                `Offset: 0x${s.offset.toString(16).padStart(4, '0').toUpperCase()} | ` +
                `Length: ${s.length} | ` +
                `Type: ${s.detected_type} | ` +
                `Confidence: ${s.confidence}\n` +
                `Content: "${s.content}"\n` +
                `Hex: ${s.hex}\n`
            ),
        ].join('\n');

        navigator.clipboard.writeText(report);
        toast.success('Full report copied to clipboard');
    };

    if (!stringAnalysis) {
        return (
            <Box sx={{ p: 3, textAlign: 'center' }}>
                <Typography color="text.secondary">
                    {t('telemetry_strings_tab.no_data_available_for_string_analysis', { defaultValue: 'No data available for string analysis' })}
                </Typography>
            </Box>
        );
    }

    const { strings, statistics } = stringAnalysis;

    return (
        <Box>
            {/* Statistics */}
            <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
                <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 700 }}>
                    {t('telemetry_strings_tab.string_content_statistics', { defaultValue: 'String Content Statistics' })}
                </Typography>
                <Box sx={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: 2,
                }}>
                    <Box>
                        <Typography variant="caption" color="text.secondary">
                            {t('telemetry_strings_tab.total_bytes', { defaultValue: 'Total Bytes' })}
                        </Typography>
                        <Typography variant="h6" sx={{ fontFamily: 'monospace' }}>
                            {statistics.total_bytes}
                        </Typography>
                    </Box>
                    <Box>
                        <Typography variant="caption" color="text.secondary">
                            {t('telemetry_strings_tab.printable_ascii', { defaultValue: 'Printable ASCII' })}
                        </Typography>
                        <Typography variant="h6" sx={{ fontFamily: 'monospace' }}>
                            {statistics.printable_ascii_count} ({statistics.printable_ascii_percent}%)
                        </Typography>
                    </Box>
                    <Box>
                        <Typography variant="caption" color="text.secondary">
                            {t('telemetry_strings_tab.null_bytes', { defaultValue: 'Null Bytes' })}
                        </Typography>
                        <Typography variant="h6" sx={{ fontFamily: 'monospace' }}>
                            {statistics.null_bytes}
                        </Typography>
                    </Box>
                    <Box>
                        <Typography variant="caption" color="text.secondary">
                            {t('telemetry_strings_tab.strings_found', { defaultValue: 'Strings Found' })}
                        </Typography>
                        <Typography variant="h6" sx={{ fontFamily: 'monospace' }}>
                            {statistics.strings_found}
                        </Typography>
                    </Box>
                </Box>
            </Paper>

            {/* Action buttons */}
            <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                <Button
                    size="small"
                    startIcon={<ContentCopyIcon />}
                    onClick={handleCopyAll}
                    variant="outlined"
                    disabled={strings.length === 0}
                >
                    {t('telemetry_strings_tab.copy_all_strings', { defaultValue: 'Copy All Strings' })}
                </Button>
                <Button
                    size="small"
                    startIcon={<ContentCopyIcon />}
                    onClick={handleCopyReport}
                    variant="outlined"
                    disabled={strings.length === 0}
                >
                    {t('telemetry_strings_tab.copy_full_report', { defaultValue: 'Copy Full Report' })}
                </Button>
            </Stack>

            {/* Strings table */}
            {strings.length === 0 ? (
                <Paper variant="outlined" sx={{ p: 3, textAlign: 'center' }}>
                    <Typography color="text.secondary">
                        {t('telemetry_strings_tab.no_strings_detected_in_this_packet_the_payload_may_be_pu', { defaultValue: 'No strings detected in this packet. The payload may be purely binary data.' })}
                    </Typography>
                </Paper>
            ) : (
                <TableContainer
                    component={Paper}
                    variant="outlined"
                    sx={{ maxHeight: 'calc(60vh - 200px)', overflow: 'auto' }}
                >
                    <Table size="small" stickyHeader>
                        <TableHead>
                            <TableRow>
                                <TableCell sx={{ fontWeight: 700, backgroundColor: theme.palette.background.paper }}>
                                    {t('telemetry_strings_tab.offset', { defaultValue: 'Offset' })}
                                </TableCell>
                                <TableCell sx={{ fontWeight: 700, backgroundColor: theme.palette.background.paper }}>
                                    {t('telemetry_strings_tab.content', { defaultValue: 'Content' })}
                                </TableCell>
                                <TableCell sx={{ fontWeight: 700, backgroundColor: theme.palette.background.paper }}>
                                    {t('telemetry_strings_tab.length', { defaultValue: 'Length' })}
                                </TableCell>
                                <TableCell sx={{ fontWeight: 700, backgroundColor: theme.palette.background.paper }}>
                                    {t('telemetry_strings_tab.type', { defaultValue: 'Type' })}
                                </TableCell>
                                <TableCell sx={{ fontWeight: 700, backgroundColor: theme.palette.background.paper }}>
                                    {t('telemetry_strings_tab.confidence', { defaultValue: 'Confidence' })}
                                </TableCell>
                                <TableCell sx={{ fontWeight: 700, backgroundColor: theme.palette.background.paper }}>
                                    {t('telemetry_strings_tab.format', { defaultValue: 'Format' })}
                                </TableCell>
                                <TableCell sx={{ fontWeight: 700, backgroundColor: theme.palette.background.paper, width: 60 }}>
                                    {t('telemetry_strings_tab.actions', { defaultValue: 'Actions' })}
                                </TableCell>
                            </TableRow>
                        </TableHead>
                        <TableBody>
                            {strings.map((str, idx) => (
                                <TableRow
                                    key={idx}
                                    sx={{ '&:hover': { backgroundColor: theme.palette.action.hover } }}
                                >
                                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                                        0x{str.offset.toString(16).padStart(4, '0').toUpperCase()}
                                    </TableCell>
                                    <TableCell>
                                        <Tooltip title={`Hex: ${str.hex}`} placement="top">
                                            <Typography
                                                variant="body2"
                                                sx={{
                                                    fontFamily: 'monospace',
                                                    maxWidth: 400,
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}
                                            >
                                                "{str.content}"
                                            </Typography>
                                        </Tooltip>
                                    </TableCell>
                                    <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>
                                        {str.length}
                                    </TableCell>
                                    <TableCell>
                                        <Chip
                                            label={str.detected_type}
                                            size="small"
                                            color={getTypeColor(str.detected_type)}
                                            sx={{ fontSize: '0.65rem', height: '20px' }}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <Chip
                                            label={str.confidence}
                                            size="small"
                                            color={getConfidenceColor(str.confidence)}
                                            sx={{ fontSize: '0.65rem', height: '20px' }}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <Typography variant="caption" color="text.secondary">
                                            {str.format || str.encoding}
                                        </Typography>
                                    </TableCell>
                                    <TableCell>
                                        <IconButton
                                            size="small"
                                            onClick={() => handleCopyString(str.content)}
                                            sx={{ p: 0.5 }}
                                        >
                                            <ContentCopyIcon fontSize="small" />
                                        </IconButton>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </TableContainer>
            )}

            {/* Info box */}
            <Box sx={{ mt: 2, p: 2, bgcolor: theme.palette.info.main + '30', borderRadius: 1, border: `1px solid ${theme.palette.info.main}60` }}>
                <Typography variant="caption" sx={{ color: theme.palette.info.light, fontWeight: 500 }}>
                    {t('telemetry_strings_tab.this_tab_extracts_text_strings_from_the_payload_using_mu', { defaultValue: '💡 This tab extracts text strings from the payload using multiple methods:\n                    contiguous printable ASCII sequences, null-terminated C-style strings, and length-prefixed strings.\n                    Confidence scores indicate likelihood of being meaningful text.' })}
                </Typography>
            </Box>
        </Box>
    );
}
