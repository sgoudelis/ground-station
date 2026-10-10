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
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Box,
    Button,
    Chip,
    Divider,
    FormControl,
    FormControlLabel,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    Switch,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Typography
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import ClearAllIcon from '@mui/icons-material/ClearAll';
import DownloadIcon from '@mui/icons-material/Download';
import { useSocket } from '../../common/socket.jsx';
import { useUserTimeSettings } from '../../../hooks/useUserTimeSettings.jsx';
import { formatTime } from '../../../utils/date-time.js';
import { useTranslation } from 'react-i18next';

const LIMIT_OPTIONS = [200, 500, 1000, 2000];
const HARD_CAP = 5000;

// Log level colors
const LOG_LEVEL_COLORS = {
    DEBUG: 'default',
    INFO: 'info',
    WARNING: 'warning',
    ERROR: 'error',
    CRITICAL: 'error'
};

// Format timestamp
function formatTimestamp(timestamp, timezone, locale) {
    return formatTime(timestamp * 1000, {
        timezone,
        locale,
        options: {
            hour12: false,
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            fractionalSecondDigits: 3
        },
    });
}

// Filter logs based on search text and level
function matchesFilter(log, searchText, levelFilter) {
    if (levelFilter !== 'ALL' && log.level !== levelFilter) return false;
    if (!searchText) return true;

    const text = searchText.toLowerCase();
    return (
        log.message?.toLowerCase().includes(text) ||
        log.logger_name?.toLowerCase().includes(text) ||
        log.process_name?.toLowerCase().includes(text) ||
        log.thread_name?.toLowerCase().includes(text)
    );
}

// Extract clean message (remove logging formatter prefix if present)
function extractCleanMessage(message) {
    // The message might contain the formatter prefix like "2025-12-15 21:00:43,276 - ground-station - INFO - "
    // We want to extract just the actual message part
    const match = message.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{3} - .+ - \w+ - (.+)$/);
    if (match) {
        return match[1]; // Return just the message part
    }
    return message; // Return as-is if no match
}

// Memoized log entry row
const LogEntryRow = React.memo(function LogEntryRow({ log, showMetadata }) {
    const levelColor = LOG_LEVEL_COLORS[log.level] || 'default';
    const cleanMessage = extractCleanMessage(log.message);
    const { timezone, locale } = useUserTimeSettings();

    return (
        <Box
            sx={{
                fontFamily: 'monospace',
                fontSize: '0.875rem',
                p: 0.5,
                borderLeft: '3px solid',
                borderLeftColor: `${levelColor}.main`,
                pl: 1,
                '&:hover': {
                    bgcolor: 'action.hover'
                }
            }}
        >
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Typography
                    variant="caption"
                    sx={{ fontFamily: 'monospace', color: 'text.secondary', minWidth: '90px' }}
                >
                    {formatTimestamp(log.timestamp, timezone, locale)}
                </Typography>

                <Chip
                    label={log.level}
                    size="small"
                    color={levelColor}
                    sx={{ fontFamily: 'monospace', fontSize: '0.7rem', height: '20px' }}
                />

                {showMetadata && (
                    <>
                        <Typography
                            variant="caption"
                            sx={{ fontFamily: 'monospace', color: 'info.main' }}
                        >
                            {log.process_name}
                        </Typography>

                        <Typography
                            variant="caption"
                            sx={{ fontFamily: 'monospace', color: 'text.secondary' }}
                        >
                            {log.logger_name}
                        </Typography>
                    </>
                )}

                <Typography
                    variant="body2"
                    sx={{
                        fontFamily: 'monospace',
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word'
                    }}
                >
                    {cleanMessage}
                </Typography>
            </Stack>
        </Box>
    );
});

const SystemLogsCard = () => {
    const { t } = useTranslation('settings');
    const { socket } = useSocket();
    const [isStreaming, setIsStreaming] = useState(false);
    const [logs, setLogs] = useState([]);
    const [limit, setLimit] = useState(500);
    const [searchText, setSearchText] = useState('');
    const [levelFilter, setLevelFilter] = useState('ALL');
    const [showMetadata, setShowMetadata] = useState(true);
    const [autoScroll, setAutoScroll] = useState(true);
    const listEndRef = useRef(null);
    const boxRef = useRef(null);

    // Auto-scroll if enabled and user is near bottom
    const scrollToBottom = useCallback(() => {
        if (autoScroll && listEndRef.current) {
            listEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }, [autoScroll]);

    useEffect(() => {
        if (!socket) return;

        const handleLogHistory = (data) => {
            if (data.logs && Array.isArray(data.logs)) {
                setLogs(prev => {
                    const combined = [...prev, ...data.logs];
                    const maxLen = Math.min(limit, HARD_CAP);
                    return combined.length > maxLen
                        ? combined.slice(combined.length - maxLen)
                        : combined;
                });
            }
        };

        const handleLogStream = (data) => {
            if (data.logs && Array.isArray(data.logs)) {
                setLogs(prev => {
                    const combined = [...prev, ...data.logs];
                    const maxLen = Math.min(limit, HARD_CAP);
                    return combined.length > maxLen
                        ? combined.slice(combined.length - maxLen)
                        : combined;
                });
            }
        };

        socket.on('log-history', handleLogHistory);
        socket.on('log-stream', handleLogStream);

        return () => {
            socket.off('log-history', handleLogHistory);
            socket.off('log-stream', handleLogStream);
        };
    }, [socket, limit]);

    useEffect(() => {
        scrollToBottom();
    }, [logs, scrollToBottom]);

    const onToggleStreaming = useCallback(async () => {
        if (!socket) return;

        if (isStreaming) {
            // Stop streaming
            socket.emit('unsubscribe-logs', {}, (response) => {
                console.log('Unsubscribed from logs:', response);
            });
            setIsStreaming(false);
        } else {
            // Start streaming with history
            socket.emit('subscribe-logs', { send_history: true }, (response) => {
                console.log('Subscribed to logs:', response);
            });
            setIsStreaming(true);
        }
    }, [socket, isStreaming]);

    const onClear = useCallback(() => {
        setLogs([]);
    }, []);

    const visibleLogs = useMemo(() => {
        return logs.filter(log => matchesFilter(log, searchText, levelFilter));
    }, [logs, searchText, levelFilter]);

    const onDownload = useCallback(() => {
        const text = visibleLogs.map(log =>
            `[${formatTimestamp(log.timestamp)}] [${log.level}] [${log.process_name}] [${log.logger_name}] ${log.message}`
        ).join('\n');

        const blob = new Blob([text], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `system-logs-${new Date().toISOString()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, [visibleLogs]);

    return (
        <>
            <Typography variant="h6" gutterBottom>
                {t('system_logs_card.system_logs', { defaultValue: 'System Logs' })}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                {t('system_logs_card.real_time_streaming_of_backend_logs_from_all_processes_a', { defaultValue: 'Real-time streaming of backend logs from all processes and threads' })}
            </Typography>
            <Divider sx={{ mb: 2 }} />

            {/* Controls */}
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
                <Stack direction="row" spacing={1}>
                    <Button
                        variant="contained"
                        color={isStreaming ? 'secondary' : 'primary'}
                        startIcon={isStreaming ? <StopIcon /> : <PlayArrowIcon />}
                        onClick={onToggleStreaming}
                    >
                        {isStreaming ? 'Stop' : 'Stream'}
                    </Button>

                    <Button
                        variant="outlined"
                        startIcon={<ClearAllIcon />}
                        onClick={onClear}
                    >
                        {t('system_logs_card.clear', { defaultValue: 'Clear' })}
                    </Button>

                    <Button
                        variant="outlined"
                        startIcon={<DownloadIcon />}
                        onClick={onDownload}
                        disabled={visibleLogs.length === 0}
                    >
                        {t('system_logs_card.export', { defaultValue: 'Export' })}
                    </Button>
                </Stack>

                <FormControl size="small" sx={{ minWidth: 120 }}>
                    <InputLabel id="log-limit-label">{t('system_logs_card.buffer_size', { defaultValue: 'Buffer Size' })}</InputLabel>
                    <Select
                        labelId="log-limit-label"
                        label={t('system_logs_card.buffer_size', { defaultValue: 'Buffer Size' })}
                        value={limit}
                        onChange={(e) => setLimit(Math.min(Number(e.target.value), HARD_CAP))}
                    >
                        {LIMIT_OPTIONS.map(opt => (
                            <MenuItem key={opt} value={opt}>{opt}</MenuItem>
                        ))}
                    </Select>
                </FormControl>
            </Stack>

            {/* Filter controls */}
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} sx={{ mb: 2 }}>
                <TextField
                    size="small"
                    label={t('system_logs_card.search_logs', { defaultValue: 'Search logs' })}
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    fullWidth
                    placeholder={t('system_logs_card.filter_by_message_logger_process', { defaultValue: 'Filter by message, logger, process...' })}
                />

                <ToggleButtonGroup
                    value={levelFilter}
                    exclusive
                    onChange={(e, value) => value && setLevelFilter(value)}
                    size="small"
                    sx={{ flexShrink: 0 }}
                >
                    <ToggleButton value="ALL">{t('system_logs_card.all', { defaultValue: 'All' })}</ToggleButton>
                    <ToggleButton value="DEBUG">{t('system_logs_card.debug', { defaultValue: 'Debug' })}</ToggleButton>
                    <ToggleButton value="INFO">{t('system_logs_card.info', { defaultValue: 'Info' })}</ToggleButton>
                    <ToggleButton value="WARNING">{t('system_logs_card.warn', { defaultValue: 'Warn' })}</ToggleButton>
                    <ToggleButton value="ERROR">{t('system_logs_card.error', { defaultValue: 'Error' })}</ToggleButton>
                </ToggleButtonGroup>
            </Stack>

            <Stack direction="row" spacing={2} sx={{ mb: 2 }}>
                <FormControlLabel
                    control={
                        <Switch
                            checked={showMetadata}
                            onChange={(e) => setShowMetadata(e.target.checked)}
                            size="small"
                        />
                    }
                    label={t('system_logs_card.show_metadata', { defaultValue: 'Show metadata' })}
                />

                <FormControlLabel
                    control={
                        <Switch
                            checked={autoScroll}
                            onChange={(e) => setAutoScroll(e.target.checked)}
                            size="small"
                        />
                    }
                    label={t('system_logs_card.auto_scroll', { defaultValue: 'Auto-scroll' })}
                />
            </Stack>

            {/* Log display */}
            <Box
                ref={boxRef}
                sx={{
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    p: 1,
                    bgcolor: 'background.default',
                    minHeight: '30vh',
                    maxHeight: '45vh',
                    overflow: 'auto',
                    fontFamily: 'monospace'
                }}
            >
                {visibleLogs.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', mt: 2 }}>
                        {isStreaming ? 'Waiting for logs...' : 'Click "Stream" to start receiving logs'}
                    </Typography>
                ) : (
                    <Stack spacing={0.5}>
                        {visibleLogs.map((log, idx) => (
                            <LogEntryRow
                                key={`${log.timestamp}-${idx}`}
                                log={log}
                                showMetadata={showMetadata}
                            />
                        ))}
                        <div ref={listEndRef} />
                    </Stack>
                )}
            </Box>

            {/* Stats */}
            <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
                <Typography variant="caption" color="text.secondary">
                    {t('system_logs_card.showing', { defaultValue: 'Showing' })} {visibleLogs.length} of {logs.length} logs
                </Typography>
                {searchText && (
                    <Typography variant="caption" color="primary">
                        {t('system_logs_card.filtered_by', { defaultValue: 'Filtered by: "' })}{searchText}"
                    </Typography>
                )}
            </Stack>
        </>
    );
};

export default SystemLogsCard;
