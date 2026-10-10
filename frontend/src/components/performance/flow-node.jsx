/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

import React from 'react';
import { Handle, Position } from 'reactflow';
import { Paper, Box, Typography, Chip, Divider, Stack, Tooltip } from '@mui/material';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { formatDateTime } from '../../utils/date-time.js';
import { useTranslation } from 'react-i18next';

const formatRate = (rate) => {
    if (rate === null || rate === undefined) return 'N/A';
    if (rate >= 1000000) return (rate / 1000000).toFixed(2) + 'M';
    if (rate >= 1000) return (rate / 1000).toFixed(2) + 'K';
    return rate.toFixed(2);
};

const formatNumber = (num) => {
    if (num === null || num === undefined) return 'N/A';
    if (num >= 1000000000) return (num / 1000000000).toFixed(2) + 'B';
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(2) + 'K';
    return num.toLocaleString();
};

const formatQueueSize = (current, max) => {
    // If no max, just show current
    if (max === null || max === undefined) {
        return current || 0;
    }
    // If max is unreasonably large (> 1 million), treat as unlimited
    if (max > 1000000) {
        return `${current || 0}/∞`;
    }
    // Normal case: show current/max
    return `${current || 0}/${max}`;
};

const humanizeTimestamp = (unixTimestamp) => {
    if (!unixTimestamp) return 'Never';

    const now = Date.now() / 1000; // Convert to seconds
    const diffInSeconds = Math.floor(now - unixTimestamp);

    if (diffInSeconds < 0) return 'Just now';
    if (diffInSeconds < 1) return 'Just now';
    if (diffInSeconds < 60) return `${diffInSeconds}s ago`;

    const minutes = Math.floor(diffInSeconds / 60);
    if (minutes < 60) return `${minutes}m ago`;

    const hours = Math.floor(diffInSeconds / 3600);
    if (hours < 24) return `${hours}h ago`;

    const days = Math.floor(diffInSeconds / 86400);
    return `${days}d ago`;
};

const truncateId = (id, length = 8) => {
    if (!id || typeof id !== 'string') return 'N/A';
    if (id.length <= length) return id;
    return id.substring(0, length) + '...';
};

const MetricRow = ({ label, value, unit, valueColor = 'text.primary' }) => (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', my: 0.2, alignItems: 'baseline' }}>
        <Typography 
            variant="caption" 
            sx={{ 
                color: 'text.secondary',
                fontSize: '0.7rem',
                opacity: 0.8,
            }}
        >
            {label}
        </Typography>
        <Typography 
            variant="caption" 
            sx={{ 
                fontWeight: 500,
                fontSize: '0.72rem',
                fontFamily: 'monospace',
                letterSpacing: '0.02em',
                minWidth: '60px',
                textAlign: 'right',
                color: valueColor,
            }}
        >
            {value} {unit && <span style={{ fontSize: '0.85em', opacity: 0.6, fontFamily: 'inherit' }}>{unit}</span>}
        </Typography>
    </Box>
);

const formatMilliseconds = (milliseconds) => {
    if (milliseconds === null || milliseconds === undefined) return 'N/A';
    if (milliseconds >= 1000) return `${(milliseconds / 1000).toFixed(2)}s`;
    if (milliseconds >= 100) return `${milliseconds.toFixed(0)}ms`;
    return `${milliseconds.toFixed(1)}ms`;
};

const getTimingStages = (component) => (
    component?.timing?.stages || component?.stats?.timing?.stages || {}
);

const getProcessingColor = (rtf) => {
    if (rtf === undefined) return 'text.primary';
    if (rtf >= 1) return 'error.main';
    if (rtf >= 0.5) return 'warning.main';
    return 'success.main';
};

const getLatencyColor = (milliseconds) => {
    if (milliseconds === undefined) return 'text.primary';
    if (milliseconds >= 500) return 'error.main';
    if (milliseconds >= 100) return 'warning.main';
    return 'success.main';
};

const getInputQueueAge = (component) => {
    const stages = getTimingStages(component);
    return stages.queue_age || stages.source_queue_age;
};

const ProcessingMetrics = ({ component }) => {
    const { t } = useTranslation('common');
    const stages = getTimingStages(component);
    // Broadcasters have fan-out work rather than a DSP processing stage.
    const processing = stages.processing || stages.fanout;
    const pipelineAge = stages.pipeline_age;

    if (!processing && !pipelineAge) return null;

    const rtf = processing?.p95_rtf;
    const processingColor = getProcessingColor(rtf);
    const details = Object.entries(stages)
        .map(([name, summary]) => {
            const rtfSuffix = summary.p95_rtf === undefined ? '' : `, RTF ${summary.p95_rtf.toFixed(2)}`;
            return `${name}: p95 ${formatMilliseconds(summary.p95_ms)}${rtfSuffix}`;
        })
        .join('\n');

    return (
        <Box>
            <Tooltip title={<span style={{ whiteSpace: 'pre-line' }}>{details}</span>} arrow>
                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', display: 'block', mb: 0.5, fontSize: '0.7rem', opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.05em', cursor: 'help' }}>
                    {t('flow_node.processing', { defaultValue: 'Processing' })}
                </Typography>
            </Tooltip>
            <Stack spacing={0.25}>
                {processing && (
                    <MetricRow
                        label={t('flow_node.p95', { defaultValue: 'P95' })}
                        value={formatMilliseconds(processing.p95_ms)}
                        valueColor={processingColor}
                    />
                )}
                {rtf !== undefined && (
                    <MetricRow
                        label={t('flow_node.p95_rtf', { defaultValue: 'P95 RTF' })}
                        value={rtf.toFixed(2)}
                        valueColor={processingColor}
                    />
                )}
                {pipelineAge && (
                    <MetricRow
                        label={t('flow_node.e2e', { defaultValue: 'E2E' })}
                        value={formatMilliseconds(pipelineAge.p95_ms)}
                        valueColor={getLatencyColor(pipelineAge.p95_ms)}
                    />
                )}
            </Stack>
        </Box>
    );
};

const CpuMemoryBars = ({ cpuPercent, memoryMb, memoryPercent }) => {
    const { t } = useTranslation('common');
    const hasCpu = cpuPercent !== null && cpuPercent !== undefined;
    const hasMemory = memoryMb !== undefined && memoryPercent !== undefined;
    const cappedCpuPercent = Math.min(cpuPercent || 0, 100);
    const cappedMemPercent = Math.min(memoryPercent || 0, 100);

    const getCpuColor = (percent) => {
        if (percent < 50) return '#66bb6a'; // Softer green
        if (percent < 80) return '#ffa726'; // Softer orange
        return '#ef5350'; // Softer red
    };

    const getMemColor = (percent) => {
        if (percent < 50) return '#42a5f5'; // Softer blue
        if (percent < 80) return '#ab47bc'; // Softer purple
        return '#ef5350'; // Softer red
    };

    // If no metrics available, show placeholder
    if (!hasCpu && !hasMemory) {
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '80px' }}>
                <Typography variant="caption" sx={{ color: 'text.secondary', opacity: 0.5, fontSize: '0.65rem' }}>
                    {t('flow_node.no_metrics', { defaultValue: 'No metrics' })}
                </Typography>
            </Box>
        );
    }

    return (
        <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'stretch', justifyContent: 'center', height: '100%', gap: 0.25 }}>
            {/* CPU Bar - only show if available */}
            {hasCpu && (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', mb: 0.5, fontSize: '0.65rem', opacity: 0.7 }}>
                        {t('flow_node.cpu', { defaultValue: 'CPU' })}
                    </Typography>
                    <Box sx={{
                        flex: 1,
                        width: '24px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'flex-end',
                        backgroundColor: (theme) => theme.palette.mode === 'dark'
                            ? 'rgba(255, 255, 255, 0.05)'
                            : 'rgba(0, 0, 0, 0.04)',
                        borderRadius: 1,
                        position: 'relative',
                        minHeight: '50px',
                        overflow: 'hidden',
                    }}>
                        <Box sx={{
                            width: '100%',
                            height: `${cappedCpuPercent}%`,
                            backgroundColor: getCpuColor(cappedCpuPercent),
                            borderRadius: '0 0 4px 4px',
                            transition: 'height 0.3s ease, background-color 0.3s ease',
                        }} />
                    </Box>
                    <Typography variant="caption" sx={{ mt: 0.4, fontWeight: 500, fontSize: '0.68rem', fontFamily: 'monospace', minWidth: '45px', textAlign: 'center' }}>
                        {cappedCpuPercent.toFixed(1)}%
                    </Typography>
                </Box>
            )}

            {/* Memory Bar - only show if available */}
            {hasMemory && (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', mb: 0.5, fontSize: '0.65rem', opacity: 0.7 }}>
                        {t('flow_node.mem', { defaultValue: 'MEM' })}
                    </Typography>
                    <Box sx={{
                        flex: 1,
                        width: '24px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'flex-end',
                        backgroundColor: (theme) => theme.palette.mode === 'dark'
                            ? 'rgba(255, 255, 255, 0.05)'
                            : 'rgba(0, 0, 0, 0.04)',
                        borderRadius: 1,
                        position: 'relative',
                        minHeight: '50px',
                        overflow: 'hidden',
                    }}>
                        <Box sx={{
                            width: '100%',
                            height: `${cappedMemPercent}%`,
                            backgroundColor: getMemColor(cappedMemPercent),
                            borderRadius: '0 0 4px 4px',
                            transition: 'height 0.3s ease, background-color 0.3s ease',
                        }} />
                    </Box>
                    <Typography variant="caption" sx={{ mt: 0.4, fontWeight: 500, fontSize: '0.68rem', fontFamily: 'monospace', minWidth: '45px', textAlign: 'center' }}>
                        {memoryMb.toFixed(0)}MB
                    </Typography>
                </Box>
            )}
        </Box>
    );
};

export const ComponentNode = ({ data }) => {
    const { t } = useTranslation('common');
    const { component, type, inputCount = 1, outputCount = 1 } = data;
    const { timezone, locale } = useUserTimeSettings();

    // Workers and Trackers don't have input handles (they're sources)
    const isWorker = type === 'worker';
    const isTracker = type === 'tracker';
    const isIQBroadcaster = type === 'broadcaster' && component.broadcaster_type === 'iq';
    const isAudioBroadcaster = type === 'broadcaster' && component.broadcaster_type === 'audio';
    const timingStages = getTimingStages(component);
    const hasProcessingMetrics = (
        ['broadcaster', 'fft', 'demodulator', 'streamer'].includes(type)
        && Boolean(timingStages.processing || timingStages.fanout || timingStages.pipeline_age)
    );
    const hasInputQueueAge = Boolean(getInputQueueAge(component));
    const isIQDecoder = (
        type === 'decoder' && (
            component.type === 'BPSKDecoder' ||
            component.type === 'FSKDecoder' ||
            component.type === 'GMSKDecoder' ||
            component.type === 'GFSKDecoder' ||
            component.type === 'LoRaDecoder' ||
            component.type === 'SSTVDecoder' ||
            component.stats?.iq_chunks_in !== undefined ||
            component.stats?.iq_samples_in !== undefined ||
            component.rates?.iq_chunks_in_per_sec !== undefined ||
            component.rates?.samples_in_per_sec !== undefined
        )
    );

    // Calculate handle positions for multiple connections
    const calculateHandlePositions = (count) => {
        if (count === 1) return [50]; // Single handle at center (50%)
        const positions = [];
        const spacing = 80 / (count + 1); // Distribute across 80% of height
        for (let i = 0; i < count; i++) {
            positions.push(10 + spacing * (i + 1)); // Start at 10%, space evenly
        }
        return positions;
    };

    const inputPositions = calculateHandlePositions(inputCount);
    const outputPositions = calculateHandlePositions(outputCount);

    return (
        <>
            {/* Input handles - all except Worker and Tracker */}
            {!isWorker && !isTracker && inputPositions.map((pos, idx) => (
                <Handle
                    key={`input-${idx}`}
                    id={`input-${idx}`}
                    type="target"
                    position={Position.Left}
                    style={{
                        background: '#757575',
                        width: '10px',
                        height: '10px',
                        border: '2px solid rgba(255, 255, 255, 0.1)',
                        top: `${pos}%`,
                    }}
                />
            ))}

            <Paper
                elevation={1}
                sx={{
                    p: 0,
                    minWidth: hasProcessingMetrics
                        ? (type === 'fft' ? 500 : 390)
                        : (type === 'fft' || type === 'worker' || type === 'tracker' || type === 'decoder') ? 380 : 280,
                    backgroundColor: (theme) => theme.palette.background?.paper || theme.palette.background.paper,
                    // Remove outside border entirely
                    border: 0,
                    borderRadius: 1.5,
                    overflow: 'hidden',
                    transition: 'box-shadow 0.2s ease',
                    '&:hover': {
                        boxShadow: (theme) => theme.palette.mode === 'dark'
                            ? '0 2px 8px rgba(0, 0, 0, 0.4)'
                            : '0 2px 8px rgba(0, 0, 0, 0.08)',
                    },
                }}
            >
                {/* Title with status */}
                <Box sx={{ 
                    display: 'flex', 
                    justifyContent: 'space-between', 
                    alignItems: 'center', 
                    px: 1,
                    py: 0.5,
                    backgroundColor: (theme) => theme.palette.mode === 'dark'
                        ? 'rgba(255, 255, 255, 0.03)'
                        : 'rgba(0, 0, 0, 0.02)',
                }}>
                    <Typography 
                        variant="subtitle2" 
                        sx={{ 
                            fontWeight: 600,
                            fontSize: '0.8rem',
                            letterSpacing: '0.01em',
                            color: 'text.primary',
                            mr: (type === 'decoder' || type === 'demodulator') ? 2 : 0,
                        }}
                    >
                        {data.label}
                    </Typography>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {(type === 'decoder' || type === 'demodulator') && component?.stats?.is_sleeping && (
                            <Chip
                                size="small"
                                label={t('flow_node.sleeping', { defaultValue: 'Sleeping' })}
                                color="warning"
                                variant="filled"
                                sx={{
                                    height: 18,
                                    fontSize: '0.6rem',
                                    px: 0.5,
                                    '& .MuiChip-label': {
                                        p: 0.25,
                                        px: 0.5,
                                    },
                                }}
                            />
                        )}
                        {component.stats?.last_activity && (
                            <Tooltip title={`Last activity: ${formatDateTime(component.stats.last_activity * 1000, { timezone, locale })}`} arrow>
                                <Typography 
                                    variant="caption" 
                                    sx={{ 
                                        fontSize: '0.7rem',
                                        color: 'text.secondary',
                                        opacity: 0.7,
                                    }}
                                >
                                    {humanizeTimestamp(component.stats.last_activity)}
                                </Typography>
                            </Tooltip>
                        )}
                        {component.is_alive !== undefined && (
                            <Box
                                sx={{
                                    width: 8,
                                    height: 8,
                                    borderRadius: '50%',
                                    backgroundColor: component.is_alive
                                        ? ((type === 'recorder' || type === 'audio_recorder') ? '#ef5350' : '#66bb6a')
                                        : 'rgba(158, 158, 158, 0.5)',
                                    boxShadow: component.is_alive
                                        ? `0 0 6px ${(type === 'recorder' || type === 'audio_recorder') ? 'rgba(239, 83, 80, 0.4)' : 'rgba(102, 187, 106, 0.4)'}`
                                        : 'none',
                                    transition: 'all 0.3s ease',
                                }}
                            />
                        )}
                    </Box>
                </Box>

                <Divider sx={{ opacity: 0.6 }} />

                {/* Processing timing gets its own column between pipeline input and output. */}
                <Box sx={{
                    display: 'grid',
                    gridTemplateColumns: hasProcessingMetrics
                        ? (type === 'fft'
                            ? 'minmax(85px, 1fr) auto minmax(95px, 1fr) auto 90px auto minmax(85px, 1fr)'
                            : 'minmax(85px, 1fr) auto minmax(95px, 1fr) auto minmax(85px, 1fr)')
                        : (type === 'fft' || type === 'worker' || type === 'tracker' || type === 'decoder')
                            ? 'minmax(85px, 1fr) auto 90px auto minmax(85px, 1fr)'
                            : '1fr auto 1fr',
                    gap: 0.75,
                    p: 1,
                    backgroundColor: (theme) => theme.palette.background?.paper || theme.palette.background.paper,
                }}>
                    {/* Tracker metrics */}
                    {type === 'tracker' && (
                        <>
                            {/* Left column - Processing */}
                            <Box>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', display: 'block', mb: 0.5, fontSize: '0.7rem', opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    {t('flow_node.processing', { defaultValue: 'Processing' })}
                                </Typography>
                                <Stack spacing={0.25}>
                                    <MetricRow
                                        label={t('flow_node.cycles', { defaultValue: 'Cycles' })}
                                        value={formatNumber(component.stats?.tracking_cycles)}
                                    />
                                    <MetricRow
                                        label={t('flow_node.rate', { defaultValue: 'Rate' })}
                                        value={formatRate(component.rates?.tracking_cycles_per_sec)}
                                        unit="/s"
                                    />
                                    <MetricRow
                                        label={t('flow_node.db_queries', { defaultValue: 'DB Queries' })}
                                        value={formatNumber(component.stats?.db_queries)}
                                    />
                                </Stack>
                            </Box>
                            {/* Vertical divider */}
                            <Divider orientation="vertical" flexItem sx={{ opacity: 0.4 }} />
                            {/* Middle column - CPU & Memory Bars */}
                            <Box>
                                <CpuMemoryBars
                                    cpuPercent={component.stats?.cpu_percent}
                                    memoryMb={component.stats?.memory_mb}
                                    memoryPercent={component.stats?.memory_percent}
                                />
                            </Box>
                            {/* Vertical divider */}
                            <Divider orientation="vertical" flexItem sx={{ opacity: 0.4 }} />
                            {/* Right column - Output */}
                            <Box>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', display: 'block', mb: 0.5, fontSize: '0.7rem', opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    {t('flow_node.output', { defaultValue: 'Output' })}
                                </Typography>
                                <Stack spacing={0.25}>
                                    <MetricRow
                                        label={t('flow_node.updates', { defaultValue: 'Updates' })}
                                        value={formatNumber(component.stats?.updates_sent)}
                                    />
                                    <MetricRow
                                        label={t('flow_node.rate', { defaultValue: 'Rate' })}
                                        value={formatRate(component.rates?.updates_per_sec)}
                                        unit="/s"
                                    />
                                    <MetricRow
                                        label={t('flow_node.commands', { defaultValue: 'Commands' })}
                                        value={formatNumber(component.stats?.commands_processed)}
                                    />
                                </Stack>
                            </Box>
                        </>
                    )}

                    {/* Worker metrics */}
                    {type === 'worker' && (
                        <>
                            {/* Left column - Empty (no input) */}
                            <Box>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', display: 'block', mb: 0.5, fontSize: '0.7rem', opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    {t('flow_node.sdr', { defaultValue: 'SDR' })}
                                </Typography>
                                <Stack spacing={0.25}>
                                    <MetricRow
                                        label={t('flow_node.samples', { defaultValue: 'Samples' })}
                                        value={formatNumber(component.stats?.samples_read)}
                                    />
                                    <MetricRow
                                        label={t('flow_node.rate', { defaultValue: 'Rate' })}
                                        value={formatRate(component.rates?.samples_per_sec)}
                                        unit="/s"
                                    />
                                    <MetricRow
                                        label={t('flow_node.errors', { defaultValue: 'Errors' })}
                                        value={formatNumber(component.stats?.read_errors)}
                                    />
                                </Stack>
                            </Box>
                            {/* Vertical divider */}
                            <Divider orientation="vertical" flexItem sx={{ opacity: 0.4 }} />
                            {/* Middle column - CPU & Memory Bars */}
                            <Box>
                                <CpuMemoryBars
                                    cpuPercent={component.stats?.cpu_percent}
                                    memoryMb={component.stats?.memory_mb}
                                    memoryPercent={component.stats?.memory_percent}
                                />
                            </Box>
                            {/* Vertical divider */}
                            <Divider orientation="vertical" flexItem sx={{ opacity: 0.4 }} />
                            {/* Right column - Output */}
                            <Box>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', display: 'block', mb: 0.5, fontSize: '0.7rem', opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    {t('flow_node.output', { defaultValue: 'Output' })}
                                </Typography>
                                <Stack spacing={0.25}>
                                    <MetricRow
                                        label={t('flow_node.iq_chunks', { defaultValue: 'IQ Chunks' })}
                                        value={formatNumber(component.stats?.iq_chunks_out)}
                                    />
                                    <MetricRow
                                        label={t('flow_node.rate', { defaultValue: 'Rate' })}
                                        value={formatRate(component.rates?.iq_chunks_per_sec)}
                                        unit="/s"
                                    />
                                    <MetricRow
                                        label={t('flow_node.drops', { defaultValue: 'Drops' })}
                                        value={formatNumber(component.stats?.queue_drops)}
                                    />
                                </Stack>
                            </Box>
                        </>
                    )}

                    {/* Broadcaster metrics */}
                    {type === 'broadcaster' && (
                        <>
                            {/* Left column - Input */}
                            <Box>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', display: 'block', mb: 0.5, fontSize: '0.7rem', opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    {t('flow_node.input', { defaultValue: 'Input' })}
                                </Typography>
                                <Stack spacing={0.25}>
                                    <MetricRow
                                        label={t('flow_node.queue', { defaultValue: 'Queue' })}
                                        value={formatQueueSize(component.source_queue_size, component.source_queue_maxsize)}
                                    />
                                    {hasInputQueueAge && (
                                        <MetricRow
                                            label={t('flow_node.queue_age', { defaultValue: 'Queue age' })}
                                            value={formatMilliseconds(getInputQueueAge(component).p95_ms)}
                                            valueColor={getLatencyColor(getInputQueueAge(component).p95_ms)}
                                        />
                                    )}
                                    <MetricRow
                                        label={t('flow_node.msgs', { defaultValue: 'Msgs' })}
                                        value={formatNumber(component.stats?.messages_in || component.stats?.messages_received)}
                                    />
                                    <MetricRow
                                        label={t('flow_node.rate', { defaultValue: 'Rate' })}
                                        value={formatRate(component.rates?.messages_in_per_sec || component.rates?.messages_received_per_sec)}
                                        unit="/s"
                                    />
                                </Stack>
                            </Box>
                            {/* Vertical divider */}
                            <Divider orientation="vertical" flexItem sx={{ opacity: 0.4 }} />
                            {hasProcessingMetrics && (
                                <>
                                    <ProcessingMetrics component={component} />
                                    <Divider orientation="vertical" flexItem sx={{ opacity: 0.4 }} />
                                </>
                            )}
                            {/* Right column - Output */}
                            <Box>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', display: 'block', mb: 0.5, fontSize: '0.7rem', opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    {t('flow_node.output', { defaultValue: 'Output' })}
                                </Typography>
                                <Stack spacing={0.25}>
                                    <MetricRow
                                        label={t('flow_node.subscribers', { defaultValue: 'Subscribers' })}
                                        value={component.subscriber_count || 0}
                                    />
                                    <MetricRow
                                        label={t('flow_node.msgs', { defaultValue: 'Msgs' })}
                                        value={formatNumber(component.stats?.messages_broadcast)}
                                    />
                                    <MetricRow
                                        label={t('flow_node.rate', { defaultValue: 'Rate' })}
                                        value={formatRate(component.rates?.messages_broadcast_per_sec)}
                                        unit="/s"
                                    />
                                    {component.stats?.messages_dropped !== undefined && (
                                        <MetricRow
                                            label={t('flow_node.drops', { defaultValue: 'Drops' })}
                                            value={formatNumber(component.stats.messages_dropped)}
                                        />
                                    )}
                                </Stack>
                            </Box>
                        </>
                    )}

                    {/* FFT Processor metrics */}
                    {type === 'fft' && (
                        <>
                            {/* Left column - Input */}
                            <Box>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', display: 'block', mb: 0.5, fontSize: '0.7rem', opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    {t('flow_node.input', { defaultValue: 'Input' })}
                                </Typography>
                                <Stack spacing={0.25}>
                                    <MetricRow
                                        label={t('flow_node.queue', { defaultValue: 'Queue' })}
                                        value={formatQueueSize(component.input_queue_size, component.input_queue_maxsize)}
                                    />
                                    {hasInputQueueAge && (
                                        <MetricRow
                                            label={t('flow_node.queue_age', { defaultValue: 'Queue age' })}
                                            value={formatMilliseconds(getInputQueueAge(component).p95_ms)}
                                            valueColor={getLatencyColor(getInputQueueAge(component).p95_ms)}
                                        />
                                    )}
                                    <MetricRow
                                        label="IQ"
                                        value={formatNumber(component.stats?.iq_chunks_in)}
                                    />
                                    <MetricRow
                                        label={t('flow_node.rate', { defaultValue: 'Rate' })}
                                        value={formatRate(component.rates?.iq_chunks_per_sec)}
                                        unit="/s"
                                    />
                                </Stack>
                            </Box>
                            {/* Vertical divider */}
                            <Divider orientation="vertical" flexItem sx={{ opacity: 0.4 }} />
                            {hasProcessingMetrics && (
                                <>
                                    <ProcessingMetrics component={component} />
                                    <Divider orientation="vertical" flexItem sx={{ opacity: 0.4 }} />
                                </>
                            )}
                            {/* Middle column - CPU & Memory Bars */}
                            <Box>
                                <CpuMemoryBars
                                    cpuPercent={component.stats?.cpu_percent}
                                    memoryMb={component.stats?.memory_mb}
                                    memoryPercent={component.stats?.memory_percent}
                                />
                            </Box>
                            {/* Vertical divider */}
                            <Divider orientation="vertical" flexItem sx={{ opacity: 0.4 }} />
                            {/* Right column - Output */}
                            <Box>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', display: 'block', mb: 0.5, fontSize: '0.7rem', opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    {t('flow_node.output', { defaultValue: 'Output' })}
                                </Typography>
                                <Stack spacing={0.25}>
                                    <MetricRow
                                        label={t('flow_node.queue', { defaultValue: 'Queue' })}
                                        value={formatQueueSize(component.output_queue_size, component.output_queue_maxsize)}
                                    />
                                    <MetricRow
                                        label={t('flow_node.fft', { defaultValue: 'FFT' })}
                                        value={formatNumber(component.stats?.fft_results_out)}
                                    />
                                    <MetricRow
                                        label={t('flow_node.rate', { defaultValue: 'Rate' })}
                                        value={formatRate(component.rates?.fft_results_per_sec)}
                                        unit="/s"
                                    />
                                </Stack>
                            </Box>
                        </>
                    )}

                    {/* Demodulator metrics */}
                    {type === 'demodulator' && (
                        <>
                            {/* Left column - Input */}
                            <Box>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', display: 'block', mb: 0.5, fontSize: '0.7rem', opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    {t('flow_node.input', { defaultValue: 'Input' })}
                                </Typography>
                                <Stack spacing={0.25}>
                                    <MetricRow
                                        label={t('flow_node.queue', { defaultValue: 'Queue' })}
                                        value={formatQueueSize(component.input_queue_size, component.input_queue_maxsize)}
                                    />
                                    {hasInputQueueAge && (
                                        <MetricRow
                                            label={t('flow_node.queue_age', { defaultValue: 'Queue age' })}
                                            value={formatMilliseconds(getInputQueueAge(component).p95_ms)}
                                            valueColor={getLatencyColor(getInputQueueAge(component).p95_ms)}
                                        />
                                    )}
                                    <MetricRow
                                        label="IQ"
                                        value={formatNumber(component.stats?.iq_chunks_in)}
                                    />
                                    <MetricRow
                                        label={t('flow_node.rate', { defaultValue: 'Rate' })}
                                        value={formatRate(component.rates?.iq_chunks_in_per_sec)}
                                        unit="/s"
                                    />
                                    {/* Ingest-side rate from demodulator stats (available even when skipping processing) */}
                                    {component.stats?.ingest_samples_per_sec !== undefined && (
                                        <MetricRow
                                            label={t('flow_node.ingest', { defaultValue: 'Ingest' })}
                                            value={`${(component.stats.ingest_samples_per_sec/1000).toFixed(1)}`}
                                            unit="kS/s"
                                        />
                                    )}
                                    {component.stats?.ingest_chunks_per_sec !== undefined && (
                                        <MetricRow
                                            label={t('flow_node.chunks', { defaultValue: 'Chunks' })}
                                            value={component.stats.ingest_chunks_per_sec.toFixed(2)}
                                            unit="/s"
                                        />
                                    )}
                                </Stack>
                            </Box>
                            {/* Vertical divider */}
                            <Divider orientation="vertical" flexItem sx={{ opacity: 0.4 }} />
                            {hasProcessingMetrics && (
                                <>
                                    <ProcessingMetrics component={component} />
                                    <Divider orientation="vertical" flexItem sx={{ opacity: 0.4 }} />
                                </>
                            )}
                            {/* Right column - Output */}
                            <Box>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', display: 'block', mb: 0.5, fontSize: '0.7rem', opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    {t('flow_node.output', { defaultValue: 'Output' })}
                                </Typography>
                                <Stack spacing={0.25}>
                                    <MetricRow
                                        label={t('flow_node.queue', { defaultValue: 'Queue' })}
                                        value={formatQueueSize(component.output_queue_size, component.output_queue_maxsize)}
                                    />
                                    <MetricRow
                                        label={t('flow_node.audio', { defaultValue: 'Audio' })}
                                        value={formatNumber(component.stats?.audio_chunks_out)}
                                    />
                                    <MetricRow
                                        label={t('flow_node.rate', { defaultValue: 'Rate' })}
                                        value={formatRate(component.rates?.audio_chunks_out_per_sec)}
                                        unit="/s"
                                    />
                                    {component.stats?.pending_emits !== undefined && (
                                        <MetricRow
                                            label={t('flow_node.pending', { defaultValue: 'Pending' })}
                                            value={formatNumber(component.stats.pending_emits)}
                                        />
                                    )}
                                </Stack>
                            </Box>
                        </>
                    )}

                    {/* Recorder metrics (IQ Recorder) */}
                    {type === 'recorder' && (
                        <>
                            {/* Left column - Input */}
                            <Box>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', display: 'block', mb: 0.5, fontSize: '0.7rem', opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    {t('flow_node.input', { defaultValue: 'Input' })}
                                </Typography>
                                <Stack spacing={0.25}>
                                    <MetricRow
                                        label={t('flow_node.queue', { defaultValue: 'Queue' })}
                                        value={formatQueueSize(component.input_queue_size, component.input_queue_maxsize)}
                                    />
                                    <MetricRow
                                        label="IQ"
                                        value={formatNumber(component.stats?.iq_chunks_in)}
                                    />
                                    <MetricRow
                                        label={t('flow_node.rate', { defaultValue: 'Rate' })}
                                        value={formatRate(component.rates?.iq_chunks_in_per_sec)}
                                        unit="/s"
                                    />
                                </Stack>
                            </Box>
                            {/* Vertical divider */}
                            <Divider orientation="vertical" flexItem sx={{ opacity: 0.4 }} />
                            {/* Right column - Output */}
                            <Box>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', display: 'block', mb: 0.5, fontSize: '0.7rem', opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    {t('flow_node.output', { defaultValue: 'Output' })}
                                </Typography>
                                <Stack spacing={0.25}>
                                    <MetricRow
                                        label={t('flow_node.written', { defaultValue: 'Written' })}
                                        value={formatNumber(component.stats?.samples_written)}
                                    />
                                    <MetricRow
                                        label={t('flow_node.rate', { defaultValue: 'Rate' })}
                                        value={formatRate(component.rates?.samples_written_per_sec)}
                                        unit="/s"
                                    />
                                </Stack>
                            </Box>
                        </>
                    )}

                    {/* Audio Recorder metrics */}
                    {type === 'audio_recorder' && (
                        <>
                            {/* Left column - Input */}
                            <Box>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', display: 'block', mb: 0.5, fontSize: '0.7rem', opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    {t('flow_node.input', { defaultValue: 'Input' })}
                                </Typography>
                                <Stack spacing={0.25}>
                                    <MetricRow
                                        label={t('flow_node.queue', { defaultValue: 'Queue' })}
                                        value={formatQueueSize(component.input_queue_size, component.input_queue_maxsize)}
                                    />
                                    <MetricRow
                                        label={t('flow_node.audio', { defaultValue: 'Audio' })}
                                        value={formatNumber(component.stats?.audio_chunks_in)}
                                    />
                                    <MetricRow
                                        label={t('flow_node.rate', { defaultValue: 'Rate' })}
                                        value={formatRate(component.rates?.audio_chunks_in_per_sec)}
                                        unit="/s"
                                    />
                                </Stack>
                            </Box>
                            {/* Vertical divider */}
                            <Divider orientation="vertical" flexItem sx={{ opacity: 0.4 }} />
                            {/* Right column - Output */}
                            <Box>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', display: 'block', mb: 0.5, fontSize: '0.7rem', opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    {t('flow_node.output', { defaultValue: 'Output' })}
                                </Typography>
                                <Stack spacing={0.25}>
                                    <MetricRow
                                        label={t('flow_node.written', { defaultValue: 'Written' })}
                                        value={formatNumber(component.stats?.samples_written)}
                                    />
                                    <MetricRow
                                        label={t('flow_node.rate', { defaultValue: 'Rate' })}
                                        value={formatRate(component.rates?.samples_written_per_sec)}
                                        unit="/s"
                                    />
                                    <MetricRow
                                        label={t('flow_node.bytes', { defaultValue: 'Bytes' })}
                                        value={formatNumber(component.stats?.bytes_written)}
                                    />
                                </Stack>
                            </Box>
                        </>
                    )}

                    {/* Decoder metrics */}
                    {type === 'decoder' && (
                        <>
                            {/* Left column - Input */}
                            <Box>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', display: 'block', mb: 0.5, fontSize: '0.7rem', opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    {t('flow_node.input', { defaultValue: 'Input' })}
                                </Typography>
                                <Stack spacing={0.25}>
                                    <MetricRow
                                        label={t('flow_node.queue', { defaultValue: 'Queue' })}
                                        value={formatQueueSize(component.input_queue_size, component.input_queue_maxsize)}
                                    />
                                    {/* IQ-based decoders (BPSK, FSK-family, LoRa, SSTVDecoder) receive IQ samples, others receive audio */}
                                    {isIQDecoder ? (
                                        <>
                                            <MetricRow
                                                label="IQ"
                                                value={formatNumber(component.stats?.iq_chunks_in || component.stats?.samples_in)}
                                            />
                                            <MetricRow
                                                label={t('flow_node.rate', { defaultValue: 'Rate' })}
                                                value={formatRate(component.rates?.iq_chunks_in_per_sec || component.rates?.samples_in_per_sec)}
                                                unit="/s"
                                            />
                                            {/* Ingest-side rate from decoder stats (available even when skipping processing) */}
                                            {component.stats?.ingest_samples_per_sec !== undefined && (
                                                <MetricRow
                                                    label={t('flow_node.ingest', { defaultValue: 'Ingest' })}
                                                    value={`${(component.stats.ingest_samples_per_sec/1000).toFixed(1)}`}
                                                    unit="kS/s"
                                                />
                                            )}
                                            {component.stats?.ingest_chunks_per_sec !== undefined && (
                                                <MetricRow
                                                    label={t('flow_node.chunks', { defaultValue: 'Chunks' })}
                                                    value={component.stats.ingest_chunks_per_sec.toFixed(2)}
                                                    unit="/s"
                                                />
                                            )}
                                        </>
                                    ) : (
                                        <>
                                            <MetricRow
                                                label={t('flow_node.audio', { defaultValue: 'Audio' })}
                                                value={formatNumber(component.stats?.audio_chunks_in)}
                                            />
                                            <MetricRow
                                                label={t('flow_node.rate', { defaultValue: 'Rate' })}
                                                value={formatRate(component.rates?.audio_chunks_in_per_sec)}
                                                unit="/s"
                                            />
                                        </>
                                    )}
                                </Stack>
                            </Box>
                            {/* Vertical divider */}
                            <Divider orientation="vertical" flexItem sx={{ opacity: 0.4 }} />
                            {/* Middle column - CPU & Memory Bars */}
                            <Box>
                                <CpuMemoryBars
                                    cpuPercent={component.stats?.cpu_percent}
                                    memoryMb={component.stats?.memory_mb}
                                    memoryPercent={component.stats?.memory_percent}
                                />
                            </Box>
                            {/* Vertical divider */}
                            <Divider orientation="vertical" flexItem sx={{ opacity: 0.4 }} />
                            {/* Right column - Output */}
                            <Box>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', display: 'block', mb: 0.5, fontSize: '0.7rem', opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    {t('flow_node.output', { defaultValue: 'Output' })}
                                </Typography>
                                <Stack spacing={0.25}>
                                    <MetricRow
                                        label={t('flow_node.data', { defaultValue: 'Data' })}
                                        value={formatNumber(component.stats?.data_messages_out)}
                                    />
                                    <MetricRow
                                        label={t('flow_node.rate', { defaultValue: 'Rate' })}
                                        value={formatRate(component.rates?.data_messages_out_per_sec)}
                                        unit="/s"
                                    />
                                    {component.stats?.images_decoded !== undefined && (
                                        <MetricRow
                                            label={t('flow_node.images', { defaultValue: 'Images' })}
                                            value={formatNumber(component.stats.images_decoded)}
                                        />
                                    )}
                                    {component.stats?.packets_decoded !== undefined && (
                                        <MetricRow
                                            label={t('flow_node.packets', { defaultValue: 'Packets' })}
                                            value={formatNumber(component.stats.packets_decoded)}
                                        />
                                    )}
                                </Stack>
                            </Box>
                        </>
                    )}

                    {/* Audio Streamer metrics */}
                    {type === 'streamer' && (
                        <>
                            {/* Left column - Input */}
                            <Box>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', display: 'block', mb: 0.5, fontSize: '0.7rem', opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    {t('flow_node.input', { defaultValue: 'Input' })}
                                </Typography>
                                <Stack spacing={0.25}>
                                    <MetricRow
                                        label={t('flow_node.queue', { defaultValue: 'Queue' })}
                                        value={component.input_queue_size || 0}
                                    />
                                    {hasInputQueueAge && (
                                        <MetricRow
                                            label={t('flow_node.queue_age', { defaultValue: 'Queue age' })}
                                            value={formatMilliseconds(getInputQueueAge(component).p95_ms)}
                                            valueColor={getLatencyColor(getInputQueueAge(component).p95_ms)}
                                        />
                                    )}
                                    <MetricRow
                                        label={t('flow_node.audio', { defaultValue: 'Audio' })}
                                        value={formatNumber(component.stats?.audio_chunks_in)}
                                    />
                                    <MetricRow
                                        label={t('flow_node.rate', { defaultValue: 'Rate' })}
                                        value={formatRate(component.rates?.audio_chunks_in_per_sec)}
                                        unit="/s"
                                    />
                                </Stack>
                            </Box>
                            {/* Vertical divider */}
                            <Divider orientation="vertical" flexItem sx={{ opacity: 0.4 }} />
                            {hasProcessingMetrics && (
                                <>
                                    <ProcessingMetrics component={component} />
                                    <Divider orientation="vertical" flexItem sx={{ opacity: 0.4 }} />
                                </>
                            )}
                            {/* Right column - Output */}
                            <Box>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', display: 'block', mb: 0.5, fontSize: '0.7rem', opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    {t('flow_node.output', { defaultValue: 'Output' })}
                                </Typography>
                                <Stack spacing={0.25}>
                                    <MetricRow
                                        label={t('flow_node.msgs', { defaultValue: 'Msgs' })}
                                        value={formatNumber(component.stats?.messages_emitted)}
                                    />
                                    <MetricRow
                                        label={t('flow_node.rate', { defaultValue: 'Rate' })}
                                        value={formatRate(component.rates?.messages_emitted_per_sec)}
                                        unit="/s"
                                    />
                                    {component.stats?.pending_emits !== undefined && (
                                        <MetricRow
                                            label={t('flow_node.pending', { defaultValue: 'Pending' })}
                                            value={formatNumber(component.stats.pending_emits)}
                                        />
                                    )}
                                    {component.stats?.emit_errors !== undefined && (
                                        <MetricRow
                                            label={t('flow_node.emit_errors', { defaultValue: 'Emit errors' })}
                                            value={formatNumber(component.stats.emit_errors)}
                                        />
                                    )}
                                </Stack>
                            </Box>
                            {/* Active sessions - full width */}
                            {component.active_sessions && Object.keys(component.active_sessions).length > 0 && (
                                <Box sx={{ gridColumn: '1 / -1', mt: 1 }}>
                                    <Divider sx={{ mb: 0.5 }} />
                                    <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'text.secondary', display: 'block', mb: 0.5 }}>
                                        {t('flow_node.active_sessions', { defaultValue: 'Active Sessions' })}
                                    </Typography>
                                    <Stack spacing={0.25}>
                                        {Object.entries(component.active_sessions).map(([sessionId, session]) => (
                                            <Box key={sessionId} sx={{ display: 'flex', justifyContent: 'space-between' }}>
                                                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                                                    {session.ip}
                                                </Typography>
                                                <Typography variant="caption" fontWeight="medium" sx={{ fontSize: '0.7rem' }}>
                                                    {formatRate(session.rates?.messages_emitted_per_sec || 0)}/s
                                                </Typography>
                                            </Box>
                                        ))}
                                    </Stack>
                                </Box>
                            )}
                        </>
                    )}

                    {/* Transcription Consumer metrics */}
                    {type === 'transcription' && (
                        <>
                            {/* Left column - Input */}
                            <Box>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', display: 'block', mb: 0.5, fontSize: '0.7rem', opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    {t('flow_node.input', { defaultValue: 'Input' })}
                                </Typography>
                                <Stack spacing={0.25}>
                                    <MetricRow
                                        label={t('flow_node.queue', { defaultValue: 'Queue' })}
                                        value={formatQueueSize(component.input_queue_size, component.input_queue_maxsize)}
                                    />
                                    <MetricRow
                                        label={t('flow_node.audio', { defaultValue: 'Audio' })}
                                        value={formatNumber(component.stats?.audio_chunks_in)}
                                    />
                                    <MetricRow
                                        label={t('flow_node.rate', { defaultValue: 'Rate' })}
                                        value={formatRate(component.rates?.audio_chunks_in_per_sec)}
                                        unit="/s"
                                    />
                                </Stack>
                            </Box>
                            {/* Vertical divider */}
                            <Divider orientation="vertical" flexItem sx={{ opacity: 0.4 }} />
                            {/* Right column - Output */}
                            <Box>
                                <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', display: 'block', mb: 0.5, fontSize: '0.7rem', opacity: 0.75, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    {t('flow_node.gemini_api', { defaultValue: 'Gemini API' })}
                                </Typography>
                                <Stack spacing={0.25}>
                                    <MetricRow
                                        label={t('flow_node.status', { defaultValue: 'Status' })}
                                        value={component.stats?.is_connected ? 'Connected' : 'Disconnected'}
                                    />
                                    <MetricRow
                                        label={t('flow_node.sent', { defaultValue: 'Sent' })}
                                        value={formatNumber(component.stats?.transcriptions_sent)}
                                    />
                                    <MetricRow
                                        label={t('flow_node.received', { defaultValue: 'Received' })}
                                        value={formatNumber(component.stats?.transcriptions_received)}
                                    />
                                    <MetricRow
                                        label={t('flow_node.attempts', { defaultValue: 'Attempts' })}
                                        value={formatNumber(component.stats?.connection_attempts)}
                                    />
                                    {component.stats?.connection_failures > 0 && (
                                        <MetricRow
                                            label={t('flow_node.failures', { defaultValue: 'Failures' })}
                                            value={formatNumber(component.stats?.connection_failures)}
                                        />
                                    )}
                                </Stack>
                            </Box>
                        </>
                    )}

                    {/* Browser metrics */}
                    {type === 'browser' && (
                        <>
                            <Box sx={{ gridColumn: '1 / -1' }}>
                                <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'text.secondary', display: 'block', mb: 0.5 }}>
                                    {t('flow_node.connection_info', { defaultValue: 'Connection Info' })}
                                </Typography>
                                <Stack spacing={0.25}>
                                    <Tooltip title={component.session_id || 'N/A'} arrow>
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', my: 0.25 }}>
                                            <Typography variant="caption" color="text.secondary">
                                                {t('flow_node.session', { defaultValue: 'Session:' })}
                                            </Typography>
                                            <Typography variant="caption" fontWeight="medium">
                                                {truncateId(component.session_id)}
                                            </Typography>
                                        </Box>
                                    </Tooltip>
                                    <MetricRow
                                        label={t('flow_node.ip', { defaultValue: 'IP' })}
                                        value={component.client_ip || 'unknown'}
                                    />
                                    {component.user_agent && component.user_agent !== 'unknown' && (
                                        <Box sx={{ display: 'flex', justifyContent: 'space-between', my: 0.25 }}>
                                            <Typography variant="caption" color="text.secondary">
                                                {t('flow_node.user_agent', { defaultValue: 'User Agent:' })}
                                            </Typography>
                                            <Typography
                                                variant="caption"
                                                fontWeight="medium"
                                                sx={{
                                                    maxWidth: '160px',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                    textAlign: 'right'
                                                }}
                                                title={component.user_agent}
                                            >
                                                {component.user_agent}
                                            </Typography>
                                        </Box>
                                    )}
                                </Stack>
                            </Box>
                            <Box sx={{ gridColumn: '1 / -1', mt: 1 }}>
                                <Divider sx={{ mb: 0.5 }} />
                                <Typography variant="caption" sx={{ fontWeight: 'bold', color: 'text.secondary', display: 'block', mb: 0.5 }}>
                                    {t('flow_node.received', { defaultValue: 'Received' })}
                                </Typography>
                                <Stack spacing={0.25}>
                                    <MetricRow
                                        label={t('flow_node.audio', { defaultValue: 'Audio' })}
                                        value={formatNumber(component.stats?.audio_chunks_in)}
                                    />
                                    <MetricRow
                                        label={t('flow_node.samples', { defaultValue: 'Samples' })}
                                        value={formatNumber(component.stats?.audio_samples_in)}
                                    />
                                    <MetricRow
                                        label={t('flow_node.messages', { defaultValue: 'Messages' })}
                                        value={formatNumber(component.stats?.messages_emitted)}
                                    />
                                    <MetricRow
                                        label={t('flow_node.rate', { defaultValue: 'Rate' })}
                                        value={formatRate(component.rates?.messages_emitted_per_sec)}
                                        unit="/s"
                                    />
                                </Stack>
                            </Box>
                        </>
                    )}

                    {/* Show errors if any - full width */}
                    {component.stats?.errors > 0 && (
                        <Box sx={{ gridColumn: '1 / -1' }}>
                            <Divider sx={{ my: 0.5 }} />
                            <MetricRow
                                label={t('flow_node.errors', { defaultValue: 'Errors' })}
                                value={formatNumber(component.stats.errors)}
                            />
                        </Box>
                    )}
                </Box>
            </Paper>

            {/* Output handles */}
            {type !== 'recorder' && type !== 'audio_recorder' && type !== 'browser' && outputPositions.map((pos, idx) => (
                <Handle
                    key={`output-${idx}`}
                    id={`output-${idx}`}
                    type="source"
                    position={Position.Right}
                    style={{
                        background: '#757575',
                        width: '10px',
                        height: '10px',
                        border: '2px solid rgba(255, 255, 255, 0.1)',
                        top: `${pos}%`,
                    }}
                />
            ))}
        </>
    );
};
