// Copyright (c) 2026 Efstratios Goudelis
// SPDX-License-Identifier: GPL-3.0-or-later

import React, { useEffect, useRef, useState } from 'react';
import { Autocomplete, Box, CircularProgress, IconButton, TextField, Typography } from '@mui/material';
import { Refresh } from '@mui/icons-material';
import { useTranslation } from 'react-i18next';
import { useSocket } from '../common/socket.jsx';
import { getTransmitterDownlink } from './continuous-transmitter-preset.js';

const PAGE_SIZE = 20;
const SEARCH_TIMEOUT_MS = 8000;
const downlink = getTransmitterDownlink;
const mhz = (frequency) => `${(frequency / 1e6).toLocaleString(undefined, {
    minimumFractionDigits: 3, maximumFractionDigits: 6,
})} MHz`;

export default function TransmitterFrequencySearch({ onTransmitterSelect, disabled = false }) {
    const { t } = useTranslation('common');
    const { socket } = useSocket();
    const connected = !disabled && Boolean(socket && socket.connected !== false);
    const [input, setInput] = useState('');
    const [open, setOpen] = useState(false);
    const [page, setPage] = useState(0);
    const [results, setResults] = useState({ options: [], total: 0, hasMore: false });
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const [retry, setRetry] = useState(0);
    const request = useRef(0);
    const listbox = useRef(null);
    const scrollPosition = useRef(0);
    const label = (key, options) => t(`continuous_observations.transmitter_search.${key}`, options);

    const reset = (nextInput = '') => {
        // Invalidate immediately, before the next effect, so a late reply cannot
        // restore options after typing, clearing, selection, or dialog closure.
        request.current += 1;
        scrollPosition.current = 0;
        setInput(nextInput);
        setPage(0);
        setResults({ options: [], total: 0, hasMore: false });
        setFailed(false);
        setLoading(connected && nextInput.trim().length >= 2);
    };

    useEffect(() => {
        const requestId = ++request.current;
        const keyword = input.trim();
        if (!open || !connected || keyword.length < 2) {
            setLoading(false);
            return;
        }
        setLoading(true);
        setFailed(false);
        let deadline;
        let completed = false;
        const finish = (response) => {
            if (completed || requestId !== request.current) return;
            completed = true;
            clearTimeout(deadline);
            const success = response?.success && Array.isArray(response.data);
            setFailed(!success);
            setLoading(false);
            if (success) setResults((previous) => {
                // De-duplicate in case catalog edits move a row across pages.
                const options = new Map((page === 0 ? [] : previous.options).map((entry) => [entry.id, entry]));
                response.data.forEach((entry) => options.set(entry.id, entry));
                return { options: [...options.values()], total: response.total, hasMore: Boolean(response.has_more) };
            });
        };
        const debounce = setTimeout(() => {
            deadline = setTimeout(() => finish(null), SEARCH_TIMEOUT_MS);
            try {
                socket.emit('api.call', {
                    cmd: 'get-transmitter-search', data: { keyword, page, page_size: PAGE_SIZE },
                }, finish);
            } catch {
                finish(null);
            }
        }, page === 0 ? 300 : 0);
        return () => {
            clearTimeout(debounce);
            clearTimeout(deadline);
            request.current += 1;
        };
    }, [socket, connected, input, open, page, retry]);

    useEffect(() => {
        // Autocomplete resets its scroll when options grow or loading changes.
        // Restore the user's position after its own effects have run.
        if (listbox.current && page > 0) listbox.current.scrollTop = scrollPosition.current;
    });

    const title = (entry) => [entry.owner_name, entry.description || entry.id].filter(Boolean).join(' · ');
    const details = (entry) => {
        const frequency = downlink(entry);
        const band = frequency ? (entry.downlink_high > frequency
            ? `${mhz(frequency)} – ${mhz(entry.downlink_high)}` : mhz(frequency)) : label('no_downlink');
        return [band, entry.mode, entry.baud > 0 ? label('baud', { value: entry.baud }) : null].filter(Boolean).join(' · ');
    };
    let status;
    if (!connected) status = label('offline');
    else if (failed) status = label('error');
    else if (results.hasMore) status = label('more_results', { count: results.options.length, total: results.total });

    return <Autocomplete disabled={disabled} fullWidth size="small" open={open} value={null} inputValue={input}
        options={results.options} loading={loading} filterOptions={(options) => options}
        getOptionLabel={title} getOptionKey={(entry) => entry.id}
        getOptionDisabled={(entry) => !downlink(entry)}
        onOpen={() => setOpen(true)}
        onClose={() => { setOpen(false); reset(); }}
        onInputChange={(_event, value, reason) => {
            if (reason === 'input' || reason === 'clear') reset(value);
        }}
        onChange={(_event, entry) => {
            // The parent copies settings once; the selected record is never
            // retained as an ongoing transmitter association.
            if (entry && downlink(entry)) onTransmitterSelect(entry);
            reset();
        }}
        loadingText={label('loading')}
        noOptionsText={!connected ? label('offline') : failed ? label('error')
            : input.trim().length < 2 ? label('minimum_query') : label('no_results')}
        slotProps={{ listbox: {
            ref: listbox,
            onScroll: (event) => {
                const list = event.currentTarget;
                scrollPosition.current = list.scrollTop;
                if (!loading && !failed && results.hasMore && list.scrollTop + list.clientHeight >= list.scrollHeight - 40) {
                    setLoading(true);
                    setPage((previous) => previous + 1);
                }
            },
        } }}
        renderOption={(props, entry) => {
            const { key, ...optionProps } = props;
            return <Box component="li" key={key} {...optionProps}>
                <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
                    <Typography variant="body2">{title(entry)}</Typography>
                    <Typography variant="caption" color="text.secondary">{details(entry)}</Typography>
                </Box>
            </Box>;
        }}
        renderInput={(params) => <TextField {...params} label={label('label')} placeholder={label('placeholder')}
            error={failed} helperText={<>{label('help')}{status && <><br />{status}</>}</>}
            slotProps={{ htmlInput: { ...params.inputProps, maxLength: 100 }, input: {
                ...params.InputProps,
                endAdornment: <>
                    {loading && <CircularProgress size={18} aria-label={label('loading')} />}
                    {failed && connected && <IconButton size="small" aria-label={label('retry')}
                        onMouseDown={(event) => event.preventDefault()} onClick={() => setRetry((value) => value + 1)}>
                        <Refresh fontSize="small" />
                    </IconButton>}
                    {params.InputProps.endAdornment}
                </>,
            } }} />}
    />;
}
