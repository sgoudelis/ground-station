/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Box,
    Button,
    Checkbox,
    Divider,
    FormControl,
    FormControlLabel,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    TextField,
    Typography
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import StopIcon from '@mui/icons-material/Stop';
import ClearAllIcon from '@mui/icons-material/ClearAll';
import { useSocket } from '../../common/socket.jsx';
import { JsonView, defaultStyles, darkStyles } from 'react-json-view-lite';
import 'react-json-view-lite/dist/index.css';
import { useUserTimeSettings } from '../../../hooks/useUserTimeSettings.jsx';
import { formatTime } from '../../../utils/date-time.js';
import { useTranslation } from 'react-i18next';

const LIMIT_OPTIONS = [200, 500, 1000];
const HARD_CAP = 5000;

function isBinary(val) {
    if (!val) return false;
    if (val instanceof ArrayBuffer) return true;
    // Guarded Buffer check for environments where Buffer is available (e.g., Electron)
    const GBuffer = typeof globalThis !== 'undefined' ? globalThis.Buffer : undefined;
    if (GBuffer && typeof GBuffer.isBuffer === 'function' && GBuffer.isBuffer(val)) return true;
    if (ArrayBuffer.isView(val)) return true; // TypedArrays
    return false;
}

function summarizeValue(value) {
    try {
        if (isBinary(value)) {
            const size = value.byteLength ?? value.length ?? 0;
            const ctor = value.constructor?.name || 'binary';
            return `<${ctor} ${size} bytes>`;
        }
        if (typeof value === 'string') {
            return value.length > 200 ? value.slice(0, 200) + '…' : value;
        }
        if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
            return String(value);
        }
        // Try stringify objects/arrays safely
        return JSON.stringify(value, (k, v) => (isBinary(v) ? '<binary>' : v), 2);
    } catch (e) {
        return '[unserializable]';
    }
}

function matchesFilter(entry, filter) {
    if (!filter) return true;
    const f = filter.toLowerCase();
    if (entry.event?.toLowerCase().includes(f)) return true;
    // Search payload stringified
    try {
        const payloadStr = JSON.stringify(entry.args, (k, v) => (isBinary(v) ? '<binary>' : v));
        return payloadStr?.toLowerCase().includes(f);
    } catch (e) {
        return false;
    }
}

// Memoized row to preserve JsonView expansion state across parent re-renders
const LogEntryRow = React.memo(function LogEntryRow({ entry, jsonStyles }) {
    const { t } = useTranslation('settings');
    const collapseNone = useCallback(() => false, []); // stable ref
    const { timezone, locale } = useUserTimeSettings();

    if (entry.direction === 'marker') {
        return (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Divider sx={{ flex: 1 }} />
                <Typography variant="caption" color="text.secondary">{entry.event}</Typography>
                <Divider sx={{ flex: 1 }} />
            </Box>
        );
    }

    const ts = formatTime(entry.ts, { timezone, locale });
    const dirColor = entry.direction === 'in' ? 'success.main' : 'info.main';

    const renderPayload = (args) => {
        if (!args || args.length === 0) return <Typography variant="body2" color="text.secondary">{t('event_log_console_card.no_payload', { defaultValue: 'No payload' })}</Typography>;

        return (
            <Stack spacing={1} sx={{ mt: 1 }}>
                {args.map((arg, idx) => {
                    const isObj = arg && typeof arg === 'object' && !isBinary(arg);
                    const summary = summarizeValue(arg);
                    if (isObj) {
                        return (
                            <Box key={idx} sx={{ p: 1, border: '1px solid', borderColor: 'divider', bgcolor: 'background.default', overflow: 'auto' }}>
                                <JsonView
                                    data={arg}
                                    style={{ ...jsonStyles, fontSize: 12 }}
                                    shouldExpandNode={collapseNone}
                                />
                            </Box>
                        );
                    }
                    return (
                        <Box key={idx} component="pre" sx={{ m: 0, p: 1, bgcolor: 'background.default', overflow: 'auto', fontFamily: 'monospace', fontSize: 12, border: '1px solid', borderColor: 'divider' }}>
                            {summary}
                        </Box>
                    );
                })}
            </Stack>
        );
    };

    return (
        <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1 }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ md: 'center' }}>
                <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>{ts}</Typography>
                    <Typography variant="caption" sx={{ color: dirColor, fontWeight: 700 }}>{entry.direction.toUpperCase()}</Typography>
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{entry.event}</Typography>
                </Stack>
            </Stack>
            {renderPayload(entry.args)}
        </Box>
    );
});

const EventLogConsoleCard = () => {
    const { t } = useTranslation('settings');
    const { addDebugListener } = useSocket();
    const theme = useTheme();
    const [isPlaying, setIsPlaying] = useState(false);
    const [includeOutgoing, setIncludeOutgoing] = useState(false);
    const [limit, setLimit] = useState(500);
    const [filter, setFilter] = useState('');
    const [entries, setEntries] = useState([]);
    // Monotonic id counter to assign stable keys to entries
    const nextIdRef = useRef(1);
    const unsubscribeRef = useRef(null);
    const listEndRef = useRef(null);
    // Removed burst/throttle logic: handle messages immediately

    // Theme-aware styles for react-json-view-lite
    const jsonStyles = useMemo(() => {
        const base = theme.palette.mode === 'dark' ? darkStyles : defaultStyles;
        return {
            ...base,
            // Ensure we don't force a white/black background; inherit from parent container
            container: {
                ...(base.container || {}),
                backgroundColor: 'transparent'
            }
        };
    }, [theme.palette.mode]);

    // Auto-scroll if at bottom
    const scrollToBottom = useCallback(() => {
        if (listEndRef.current) {
            listEndRef.current.scrollIntoView({ behavior: 'smooth', block: 'end' });
        }
    }, []);

    // Append a single entry immediately and trim to current limit
    const appendEntry = useCallback((entry) => {
        setEntries(prev => {
            const next = prev.concat(entry);
            const maxLen = Math.min(limit, HARD_CAP);
            return next.length > maxLen ? next.slice(next.length - maxLen) : next;
        });
    }, [limit]);

    useEffect(() => {
        if (!isPlaying) return;
        scrollToBottom();
    }, [entries, isPlaying, scrollToBottom]);

    const onTogglePlay = useCallback(() => {
        if (isPlaying) {
            // Stop: full unsubscribe and do not buffer during stop
            if (unsubscribeRef.current) {
                unsubscribeRef.current();
                unsubscribeRef.current = null;
            }
            setIsPlaying(false);
        } else {
            // Start: insert a marker entry then subscribe
            const marker = { id: nextIdRef.current++, ts: Date.now(), direction: 'marker', event: '— resumed —', args: [] };
            setEntries(prev => {
                const next = prev.concat(marker);
                const maxLen = Math.min(limit, HARD_CAP);
                return next.length > maxLen ? next.slice(next.length - maxLen) : next;
            });
            const unsubscribe = addDebugListener((msg) => {
                // Default only incoming; outgoing only if checkbox is enabled
                if (msg.direction === 'out' && !includeOutgoing) return;
                // Assign stable id once when receiving the message and append immediately
                appendEntry({ ...msg, id: nextIdRef.current++ });
            }, { includeOutgoing });
            unsubscribeRef.current = () => {
                try { unsubscribe(); } catch (e) { /* ignore errors during unsubscribe */ void e; }
            };
            setIsPlaying(true);
        }
    }, [isPlaying, addDebugListener, includeOutgoing, limit, appendEntry]);

    // On unmount, cleanup
    useEffect(() => () => {
        if (unsubscribeRef.current) unsubscribeRef.current();
    }, []);

    // Changing includeOutgoing while playing should resubscribe to apply option
    useEffect(() => {
        if (!isPlaying) return;
        if (unsubscribeRef.current) unsubscribeRef.current();
        const unsubscribe = addDebugListener((msg) => {
            if (msg.direction === 'out' && !includeOutgoing) return;
            // Ensure each message gets a stable id and append immediately
            appendEntry({ ...msg, id: nextIdRef.current++ });
        }, { includeOutgoing });
        unsubscribeRef.current = () => { try { unsubscribe(); } catch (e) { /* ignore errors during unsubscribe */ void e; } };
    }, [includeOutgoing, appendEntry]);

    const onClear = useCallback(() => {
        setEntries([]);
    }, []);

    const visibleEntries = useMemo(() => {
        return entries.filter(e => e.direction === 'marker' || matchesFilter(e, filter));
    }, [entries, filter]);

    return (
        <>
            <Typography variant="h6" gutterBottom>
                {t('event_log_console_card.message_log', { defaultValue: 'Message log' })}
            </Typography>
            <Divider sx={{ mb: 2 }} />

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} sx={{ mb: 2 }}>
                <Stack direction="row" spacing={1}>
                    <Button variant="contained" color={isPlaying ? 'secondary' : 'primary'} startIcon={isPlaying ? <StopIcon/> : <PlayArrowIcon/>} onClick={onTogglePlay}>
                        {isPlaying ? 'Stop' : 'listen'}
                    </Button>
                    <Button variant="outlined" startIcon={<ClearAllIcon/>} onClick={onClear}>
                        {t('event_log_console_card.clear', { defaultValue: 'Clear' })}
                    </Button>
                </Stack>

                <FormControlLabel control={<Checkbox checked={includeOutgoing} onChange={(e) => setIncludeOutgoing(e.target.checked)} />} label={t('event_log_console_card.include_outgoing', { defaultValue: 'Include outgoing' })} />

                <FormControl size="small" sx={{ minWidth: 120 }}>
                    <InputLabel id="msg-limit-label">{t('event_log_console_card.last_n', { defaultValue: 'Last N' })}</InputLabel>
                    <Select labelId="msg-limit-label" label={t('event_log_console_card.last_n', { defaultValue: 'Last N' })} value={limit} onChange={(e) => setLimit(Math.min(Number(e.target.value), HARD_CAP))}>
                        {LIMIT_OPTIONS.map(opt => (
                            <MenuItem key={opt} value={opt}>{opt}</MenuItem>
                        ))}
                    </Select>
                </FormControl>

                <TextField size="small" label={t('event_log_console_card.filter_event_or_payload', { defaultValue: 'Filter (event or payload)' })} value={filter} onChange={(e) => setFilter(e.target.value)} fullWidth />
            </Stack>

            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 1, p: 1, minHeight: '30vh', maxHeight: '60vh', overflow: 'auto' }}>
                <Stack spacing={1}>
                    {visibleEntries.map((e) => (
                        <LogEntryRow key={e.direction === 'marker' ? `m-${e.id ?? e.ts}` : (e.id ?? e.ts)} entry={e} jsonStyles={jsonStyles} />
                    ))}
                    <div ref={listEndRef} />
                </Stack>
            </Box>
        </>
    );
};

export default EventLogConsoleCard;
