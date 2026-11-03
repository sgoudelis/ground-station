/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from 'react';
import {Box, Button, Checkbox, InputAdornment, LinearProgress, Menu, MenuItem, Pagination, TextField, Typography} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import FilterListIcon from '@mui/icons-material/FilterList';
import {List} from 'react-window';
import {useTranslation} from 'react-i18next';
import {useDispatch, useSelector} from 'react-redux';
import {getClassNamesBasedOnGridEditing, islandTitleBarCompactSx, TitleBar} from '../common/common.jsx';
import {useUserTimeSettings} from '../../hooks/useUserTimeSettings.jsx';
import useStableEvent from '../../hooks/useStableEvent.js';
import {TRANSMITTER_TYPES, typeColor, typeLabel} from './transmitters.js';
import {setTransmitterListSettings} from './packet-map-slice.jsx';
import {createTransmitterListRows, transmitterSorts} from './transmitter-list-data.js';
import useTransmitterPages, {transmitterPageSizes} from './use-transmitter-pages.js';
import TransmitterListRow, {PlaybackTimeContext} from './transmitter-list-row.jsx';

const rowHeight = 62;
const emptyTypes = [];
const defaultSettings = {excludedTypes: emptyTypes, sort: 'first_seen', pageSize: 100};
const listStyle = {height: '100%', width: '100%', overflowX: 'hidden'};
const sortLabels = {first_seen: 'Newest discovered', last_seen: 'Recently heard', name: 'Name', distance: 'Nearest first'};

function VirtualRow({index, style, ariaAttributes, rows, offset, total, selectedId, focusId, hiddenTypes, onSelect, onFocusRow,
    numberFormatters, timeFormatter, clockFormatter}) {
    const row = rows[index];
    return <div {...ariaAttributes} aria-posinset={offset + index + 1} aria-setsize={total} style={style}>
        {/* Index positions are recycled by the virtualizer; identity owns row state. */}
        <TransmitterListRow key={row.id} row={row} index={offset + index} selected={row.id === selectedId}
            focused={row.id === focusId} hidden={hiddenTypes.includes(row.kind)}
            onSelect={onSelect} onFocusRow={onFocusRow} numberFormatters={numberFormatters}
            timeFormatter={timeFormatter} clockFormatter={clockFormatter} />
    </div>;
}

export default function TransmitterList({rows, loading, hiddenTypes = emptyTypes, gridEditable, selectedTransmitterId = null,
    onSelectTransmitter, playbackTime}) {
    const {t} = useTranslation('navigation');
    const timeSettings = useUserTimeSettings();
    const dispatch = useDispatch();
    const receiver = useSelector((state) => state.location?.location);
    const savedSettings = useSelector((state) => state.packetMap?.transmitterList ?? defaultSettings);
    const excludedTypes = Array.isArray(savedSettings.excludedTypes) ? savedSettings.excludedTypes : emptyTypes;
    const sort = transmitterSorts.includes(savedSettings.sort) ? savedSettings.sort : 'first_seen';
    const pageSize = transmitterPageSizes.includes(savedSettings.pageSize) ? savedSettings.pageSize : 100;
    const [search, setSearch] = useState('');
    const [typeAnchor, setTypeAnchor] = useState(null);
    const [focusedId, setFocusedId] = useState(null);
    const [renderedRange, setRenderedRange] = useState({startIndex: 0, stopIndex: 7});
    const listRef = useRef(null);
    const pendingFocus = useRef(null);
    const pendingScroll = useRef(null);
    const lastSelection = useRef(null);
    const select = useStableEvent((id) => onSelectTransmitter?.(id));
    const focusRow = useCallback((id) => setFocusedId(id), []);
    const prepareRows = useMemo(() => createTransmitterListRows(), []);
    const data = useMemo(() => prepareRows(rows, receiver), [prepareRows, rows, receiver]);
    const pages = useTransmitterPages(data, search, excludedTypes, sort, pageSize, selectedTransmitterId);
    const {pageRows: visible, page, pageCount, offset, total, newCount} = pages;
    const kinds = useMemo(() => [...new Set([...Object.keys(TRANSMITTER_TYPES), ...data.map((row) => row.kind)])], [data]);
    const counts = useMemo(() => {
        const result = new Map();
        for (const row of data) result.set(row.kind, (result.get(row.kind) ?? 0) + 1);
        return result;
    }, [data]);
    const timeFormatter = useMemo(() => new Intl.DateTimeFormat(timeSettings.locale, {
        timeZone: timeSettings.timezone, dateStyle: 'short', timeStyle: 'medium',
    }), [timeSettings.locale, timeSettings.timezone]);
    const numberFormatters = useMemo(() => Array.from({length: 5}, (_, digits) => new Intl.NumberFormat(timeSettings.locale, {
        maximumFractionDigits: digits,
    })), [timeSettings.locale]);
    const clockFormatter = useMemo(() => new Intl.DateTimeFormat(timeSettings.locale, {
        timeZone: timeSettings.timezone, timeStyle: 'medium',
    }), [timeSettings.locale, timeSettings.timezone]);
    // Keep a tab stop mounted after manual scrolling recycles the focused row.
    const focusedIndex = visible.findIndex((row) => row.id === focusedId);
    const selectedIndex = visible.findIndex((row) => row.id === selectedTransmitterId);
    const inViewport = (index) => index >= renderedRange.startIndex && index <= renderedRange.stopIndex;
    const focusId = inViewport(focusedIndex) ? focusedId : inViewport(selectedIndex) ? selectedTransmitterId
        : visible[Math.min(renderedRange.startIndex, visible.length - 1)]?.id;
    const rowProps = useMemo(() => ({rows: visible, offset, total, selectedId: selectedTransmitterId, focusId, hiddenTypes,
        onSelect: select, onFocusRow: focusRow, numberFormatters, timeFormatter, clockFormatter,
    }), [visible, offset, total, selectedTransmitterId, focusId, hiddenTypes, select, focusRow, numberFormatters, timeFormatter, clockFormatter]);
    const changeSettings = (settings) => dispatch(setTransmitterListSettings({...savedSettings, ...settings}));
    const toggleType = (kind) => changeSettings({excludedTypes: excludedTypes.includes(kind)
        ? excludedTypes.filter((value) => value !== kind) : [...excludedTypes, kind]});

    const restoreFocus = useCallback(() => {
        if (pendingFocus.current === null) return;
        const button = [...(listRef.current?.element?.querySelectorAll('button[data-id]') ?? [])]
            .find((element) => element.dataset.id === pendingFocus.current);
        if (button) {
            button.focus({preventScroll: true});
            pendingFocus.current = null;
        }
    }, []);
    const revealPending = useCallback(() => {
        // A newly mounted virtual list exposes its element on a second commit.
        // Keep navigation queued until its scrolling container is available.
        if (!listRef.current?.element) return;
        if (pendingScroll.current !== null) {
            listRef.current.scrollToRow({index: pendingScroll.current, align: 'auto'});
            pendingScroll.current = null;
        }
        restoreFocus();
    }, [restoreFocus]);
    const captureList = useCallback((list) => {
        listRef.current = list;
        revealPending();
    }, [revealPending]);
    useLayoutEffect(revealPending, [focusedId, visible, revealPending]);
    const rowsRendered = useCallback((visibleRows) => {
        setRenderedRange((previous) => previous.startIndex === visibleRows.startIndex && previous.stopIndex === visibleRows.stopIndex
            ? previous : visibleRows);
        restoreFocus();
    }, [restoreFocus]);
    const navigate = useStableEvent((event) => {
        const current = Number(event.target.closest('button[data-index]')?.dataset.index);
        if (!Number.isInteger(current)) return;
        const next = {ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: total - 1}[event.key];
        if (next === undefined) return;
        event.preventDefault();
        const index = Math.max(0, Math.min(total - 1, next));
        if (index === current) return;
        pendingFocus.current = pages.ids[index];
        pendingScroll.current = index % pageSize;
        setFocusedId(pages.ids[index]);
        pages.changePage(Math.floor(index / pageSize));
    });
    useEffect(() => {
        // Explicit map selection reveals its list entry once. Live telemetry
        // must never pull the scrollbar away from what the user is reading.
        if (selectedTransmitterId === lastSelection.current) return;
        if (pages.selectedIndex >= 0) {
            pendingScroll.current = pages.selectedIndex % pageSize;
            revealPending();
            lastSelection.current = selectedTransmitterId;
        } else if (selectedTransmitterId === null) lastSelection.current = null;
        else {
            const selected = data.find((row) => row.id === selectedTransmitterId);
            if (selected) {
                // Map selection also reveals a node excluded by the current search/type filters.
                setSearch('');
                if (excludedTypes.includes(selected.kind)) changeSettings({excludedTypes: excludedTypes.filter((kind) => kind !== selected.kind)});
            }
        }
    }, [selectedTransmitterId, pages.selectedIndex, pageSize, data, excludedTypes, revealPending]);

    return <Box sx={{height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', containerType: 'inline-size'}}>
        <TitleBar className={getClassNamesBasedOnGridEditing(gridEditable, ['window-title-bar'])}
            sx={{...islandTitleBarCompactSx, height: 'auto', minHeight: 36, py: 0.5,
                flexShrink: 0, flexWrap: 'wrap', gap: 0.75}}>
            <Typography variant="subtitle2" noWrap sx={{fontWeight: 'bold', mr: 0.5}}>
                {t('packet_map.transmitters', 'Transmitters')}
            </Typography>
            <Typography variant="caption" sx={{color: 'text.secondary', fontVariantNumeric: 'tabular-nums'}}>
                {total + newCount === rows.length ? rows.length : `${total + newCount} / ${rows.length}`}
            </Typography>
            <Box onMouseDown={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()}
                sx={{ml: 'auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.75, minWidth: 0}}>
                <TextField size="small" placeholder={t('packet_map.list.search', 'Search transmitters')}
                    value={search} onChange={(event) => setSearch(event.target.value)}
                    slotProps={{htmlInput: {'aria-label': t('packet_map.list.search', 'Search transmitters')},
                        input: {startAdornment: <InputAdornment position="start"><SearchIcon sx={{fontSize: 16}} /></InputAdornment>}}}
                    sx={{width: 235, '@container (max-width: 650px)': {width: 135},
                        '& .MuiInputBase-root': {height: 28, fontSize: '0.75rem'}}} />
                <Button size="small" startIcon={<FilterListIcon sx={{fontSize: '16px !important'}} />}
                    aria-label={t('packet_map.types', 'Transmitter types')} aria-haspopup="menu"
                    aria-expanded={Boolean(typeAnchor)} onClick={(event) => setTypeAnchor(event.currentTarget)}
                    sx={{minWidth: 0, fontSize: '0.72rem', px: 0.75, color: excludedTypes.length ? 'primary.main' : 'text.secondary'}}>
                    {t('packet_map.list.types', 'Types')}{excludedTypes.length > 0 ? ` (${kinds.filter((kind) => !excludedTypes.includes(kind)).length})` : ''}
                </Button>
                <TextField select size="small" value={sort} onChange={(event) => changeSettings({sort: event.target.value})}
                    slotProps={{select: {SelectDisplayProps: {'aria-label': t('packet_map.list.sort', 'Sort transmitters')}}}}
                    sx={{width: 158, '@container (max-width: 650px)': {width: 130},
                        '& .MuiInputBase-root': {height: 28, fontSize: '0.72rem'}}}>
                    {transmitterSorts.map((key) => <MenuItem key={key} value={key}>
                        {t(`packet_map.list.sort_${key}`, sortLabels[key])}
                    </MenuItem>)}
                </TextField>
            </Box>
        </TitleBar>
        <Menu anchorEl={typeAnchor} open={Boolean(typeAnchor)} onClose={() => setTypeAnchor(null)}>
            <MenuItem onClick={() => changeSettings({excludedTypes: kinds.every((kind) => !excludedTypes.includes(kind)) ? kinds : []})}>
                <Checkbox size="small" checked={kinds.every((kind) => !excludedTypes.includes(kind))}
                    indeterminate={kinds.some((kind) => excludedTypes.includes(kind)) && kinds.some((kind) => !excludedTypes.includes(kind))} />
                {t('packet_map.list.all_types', 'All types')}
            </MenuItem>
            {kinds.map((kind) => <MenuItem key={kind} onClick={() => toggleType(kind)}>
                <Checkbox size="small" checked={!excludedTypes.includes(kind)} />
                <Typography variant="body2" sx={{color: typeColor(kind), flex: 1}}>{typeLabel(kind)}</Typography>
                <Typography variant="caption" sx={{ml: 2, color: 'text.secondary'}}>{counts.get(kind) ?? 0}</Typography>
            </MenuItem>)}
        </Menu>
        <Box sx={{position: 'relative', flex: 1, minHeight: 0}} aria-busy={Boolean(loading)}>
            {loading && <LinearProgress sx={{position: 'absolute', top: 0, left: 0, right: 0, height: 2, zIndex: 1}} />}
            <PlaybackTimeContext.Provider value={Number.isFinite(playbackTime) ? playbackTime : Date.now()}>
                {visible.length > 0 ? <List key={`${pages.query}:${page}:${pageSize}:${pages.revision}`} listRef={captureList} rowComponent={VirtualRow} rowProps={rowProps}
                    rowCount={visible.length} rowHeight={rowHeight} overscanCount={4} defaultHeight={248}
                    style={listStyle} aria-label={t('packet_map.transmitters', 'Transmitters')}
                    onKeyDown={navigate} onRowsRendered={rowsRendered} />
                    : <Box sx={{height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', p: 2}}>
                        <Typography variant="body2" sx={{color: 'text.secondary', textAlign: 'center'}}>
                            {loading ? t('packet_map.list.loading', 'Loading transmitters…')
                                : data.length ? t('packet_map.list.no_matches', 'No transmitters match your search or type filters.')
                                    : t('packet_map.empty', 'No packets containing location coordinates were decoded in the selected timeframe.')}
                        </Typography>
                    </Box>}
            </PlaybackTimeContext.Provider>
        </Box>
        <Box
            onMouseDown={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()}
            sx={{display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1, px: 1.25, py: 0.5,
                flexShrink: 0, minHeight: 36, borderTop: 1, borderColor: 'divider',
                '@container (max-width: 650px)': {gap: 0.5, px: 0.75}}}>
            {newCount > 0 && <Button size="small" onClick={pages.refresh}
                sx={{fontSize: '0.7rem', py: 0.25, minWidth: 0}}
                title={t('packet_map.list.show_new', 'Refresh the listing and return to the first page')}>
                {t('packet_map.list.new_transmitters', {defaultValue: '{{count}} new transmitters', count: newCount})}
            </Button>}
            <Typography variant="caption" aria-live="polite" sx={{fontSize: '0.7rem', color: 'text.secondary', fontVariantNumeric: 'tabular-nums'}}>
                {t('packet_map.list.page_range', {defaultValue: '{{from}}–{{to}} of {{count}}',
                    from: total ? numberFormatters[0].format(offset + 1) : '0',
                    to: numberFormatters[0].format(Math.min(offset + pageSize, total)),
                    count: total, formattedCount: numberFormatters[0].format(total)})}
            </Typography>
            <Box sx={{ml: 'auto', display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 0.75}}>
                <TextField select size="small" value={pageSize} onChange={(event) => changeSettings({pageSize: Number(event.target.value)})}
                    slotProps={{select: {SelectDisplayProps: {'aria-label': t('packet_map.list.per_page', 'Transmitters per page')}}}}
                    sx={{width: 104, '& .MuiInputBase-root': {height: 26, fontSize: '0.7rem'},
                        flexShrink: 0}}>
                    {transmitterPageSizes.map((size) => <MenuItem key={size} value={size}>
                        {t('packet_map.list.page_size', {defaultValue: '{{count}} / page', count: size})}
                    </MenuItem>)}
                </TextField>
                <Pagination count={pageCount} page={page + 1} size="small" shape="rounded" color="primary"
                    siblingCount={0} boundaryCount={1} onChange={(_event, value) => pages.changePage(value - 1)}
                    aria-label={t('packet_map.list.pagination', 'Transmitter pages')}
                    getItemAriaLabel={(type, value) => type === 'page'
                        ? t('packet_map.list.page_label', {defaultValue: 'Page {{page}}', page: numberFormatters[0].format(value)})
                        : type === 'previous' ? t('packet_map.list.previous_page', 'Previous page')
                            : type === 'next' ? t('packet_map.list.next_page', 'Next page') : undefined}
                    sx={{'& .MuiPagination-ul': {flexWrap: 'nowrap'},
                        '@container (max-width: 650px)': {'& .MuiPaginationItem-root': {mx: 0.125}}}} />
            </Box>
        </Box>
    </Box>;
}
