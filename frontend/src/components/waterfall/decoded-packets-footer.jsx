/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {Box, Typography} from '@mui/material';
import {useSelector} from 'react-redux';
import {useTranslation} from 'react-i18next';
import DecodedTableFooter from '../common/decoded-table-footer.jsx';
import {useUserTimeSettings} from '../../hooks/useUserTimeSettings.jsx';
import {formatDateTime} from '../../utils/date-time.js';

// Subscribe inside the footer so packet statistics do not bypass the table's batched updates.
export default function DecodedPacketsFooter() {
    const {t} = useTranslation('waterfall');
    const outputs = useSelector((state) => state.decoders.outputs);
    const {timezone, locale} = useUserTimeSettings();
    const [relativeNowMs, setRelativeNowMs] = useState(Date.now);
    useEffect(() => {
        const timer = window.setInterval(() => setRelativeNowMs(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, []);

    const formatTimestamp = useCallback((value) => {
        if (!value) return '-';
        return formatDateTime(value, {
            timezone,
            locale,
            options: {
                hour12: false,
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
            },
        });
    }, [timezone, locale]);

    const packetStatusStats = useMemo(() => {
        const packetOutputs = outputs.filter(
            (item) => item?.type === 'decoder-output'
                && String(item?.decoder_type || '').toLowerCase() !== 'gnss'
        );

        const decoderTypes = new Set();
        let latestPacketMs = null;
        let telemetryCount = 0;
        let fileOutputCount = 0;
        let recentPacketCount = 0;
        const recentWindowStartMs = relativeNowMs - 60_000;

        for (const item of packetOutputs) {
            const decoderType = String(item?.decoder_type || '').trim().toUpperCase();
            if (decoderType) {
                decoderTypes.add(decoderType);
            }

            if (['decoded', 'partial'].includes(item?.output?.telemetry?.payload_status)) {
                telemetryCount += 1;
            }
            if (item?.output?.filename) {
                fileOutputCount += 1;
            }

            const tsMs = Number(item?.timestamp) * 1000;
            if (Number.isFinite(tsMs)) {
                latestPacketMs = latestPacketMs === null ? tsMs : Math.max(latestPacketMs, tsMs);
                if (tsMs >= recentWindowStartMs) {
                    recentPacketCount += 1;
                }
            }
        }

        return {
            packetCount: packetOutputs.length,
            decoderTypeCount: decoderTypes.size,
            telemetryCount,
            fileOutputCount,
            recentPacketCount,
            latestPacketMs,
        };
    }, [outputs, relativeNowMs]);

    return (
        <DecodedTableFooter>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    fontSize: '0.72rem',
                    fontFamily: 'monospace',
                    color: 'text.secondary',
                    width: '100%',
                    minWidth: 0,
                    overflowX: 'hidden',
                    overflowY: 'hidden',
                    whiteSpace: 'nowrap',
                }}
            >
                <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.primary', fontSize: '0.68rem' }}>
                    {t('decoded_insights_island.pkts', { defaultValue: 'PKTS' })}
                </Typography>
                <Box sx={{ opacity: 0.55 }}>•</Box>
                <Box sx={{ display: 'flex', gap: 0.45, flex: '1 1 auto', minWidth: 0, overflow: 'hidden' }}>
                    <Box component="span">dec: <Box component="span" sx={{ fontWeight: 700 }}>{packetStatusStats.packetCount}</Box></Box>
                    <Box component="span" sx={{ opacity: 0.55 }}>•</Box>
                    <Box component="span">types: <Box component="span" sx={{ fontWeight: 700 }}>{packetStatusStats.decoderTypeCount}</Box></Box>
                    <Box component="span" sx={{ opacity: 0.55 }}>•</Box>
                    <Box component="span">tlm: <Box component="span" sx={{ fontWeight: 700 }}>{packetStatusStats.telemetryCount}</Box></Box>
                    <Box component="span" sx={{ opacity: 0.55 }}>•</Box>
                    <Box component="span">files: <Box component="span" sx={{ fontWeight: 700 }}>{packetStatusStats.fileOutputCount}</Box></Box>
                    <Box component="span" sx={{ opacity: 0.55 }}>•</Box>
                    <Box component="span">1m: <Box component="span" sx={{ fontWeight: 700 }}>{packetStatusStats.recentPacketCount}</Box></Box>
                </Box>
                <Typography
                    variant="caption"
                    sx={{
                        color: 'text.secondary',
                        whiteSpace: 'nowrap',
                        marginLeft: 'auto',
                        flex: '0 0 auto',
                        fontSize: '0.65rem',
                    }}
                >
                    {`last: ${packetStatusStats.latestPacketMs ? formatTimestamp(packetStatusStats.latestPacketMs) : '-'}`}
                </Typography>
            </Box>
        </DecodedTableFooter>
    );
}
