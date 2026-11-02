/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useEffect, useMemo, useState} from 'react';
import {Box, IconButton, Stack, ToggleButton, Tooltip} from '@mui/material';
import {DateTimePicker} from '@mui/x-date-pickers/DateTimePicker';
import {LocalizationProvider} from '@mui/x-date-pickers/LocalizationProvider';
import {AdapterMoment} from '@mui/x-date-pickers/AdapterMoment';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckIcon from '@mui/icons-material/Check';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import HistoryIcon from '@mui/icons-material/History';
import TodayIcon from '@mui/icons-material/Today';
import DateRangeIcon from '@mui/icons-material/DateRange';
import moment from 'moment-timezone';
import {useTranslation} from 'react-i18next';
import {useUserTimeSettings} from '../../hooks/useUserTimeSettings.jsx';
import {formatDateTime} from '../../utils/date-time.js';
import ResponsiveActionButton from '../common/responsive-action-button.jsx';
import DateRangeSelector from './date-range-selector.jsx';
import {datePickerLocalization} from './date-picker-localization.js';
import {liveRangeAt} from './live.js';

const compactActionsQuery = '@container packet-map-toolbar (max-width: 600px)';
const actionButtonSx = {
    minWidth: 0, px: 1, height: 40,
    [compactActionsQuery]: {width: 40, height: 40},
};
const periodButtonSx = {
    ...actionButtonSx,
    // Period icons replace their labels only in the compact toolbar.
    '& .MuiButton-startIcon': {display: 'none'},
    [compactActionsQuery]: {...actionButtonSx[compactActionsQuery], '& .MuiButton-startIcon': {display: 'inline-flex'}},
};
const outlinedIconButtonSx = {
    // Match the date inputs with a full-height square button in every layout.
    width: 40, height: 40, border: '1px solid currentColor', borderRadius: 1, bgcolor: 'background.paper',
};

const datePickerSx = {
    width: 230,
    // Respond to toolbar space, including the width taken by the navigation drawer.
    '@container packet-map-toolbar (max-width: 900px)': {
        width: 40,
        '& .MuiInputLabel-root, & .MuiInputBase-input, & legend': {display: 'none'},
        '& .MuiInputBase-root': {height: 40, p: 0, justifyContent: 'center'},
        // The label notch normally lifts the border 5px above the input. With
        // its legend hidden, keep that border inside the 40px square instead.
        '& .MuiOutlinedInput-notchedOutline': {top: 0},
        '& .MuiInputAdornment-root': {m: 0},
        '& .MuiIconButton-root': {m: 0, width: 38, height: 38},
    },
};

export default function DateRangeBar({range, positions, onChange, onPresetChange = onChange,
    playbackTime, onPlaybackTimeChange, onRefresh, loading}) {
    const {t} = useTranslation('navigation');
    const applyLabel = t('packet_map.apply', {defaultValue: 'Apply'});
    const refreshLabel = t('packet_map.refresh', {defaultValue: 'Refresh'});
    const fromLabel = t('packet_map.from', {defaultValue: 'From'});
    const toLabel = t('packet_map.to', {defaultValue: 'To'});
    const isLive = range.end === null;
    const {timezone, locale} = useUserTimeSettings();
    // The fields edit minutes. Hidden capture seconds must not carry into a
    // changed date; unchanged fields retain the exact original server bounds.
    const toInput = (date) => moment.tz(date, timezone).startOf('minute');
    const pickerLocalization = useMemo(() => datePickerLocalization(locale), [locale]);
    const [draft, setDraft] = useState(() => ({start: toInput(range.start), end: isLive ? null : toInput(range.end)}));
    const [fromPickerOpen, setFromPickerOpen] = useState(false);
    useEffect(() => {
        setDraft({start: toInput(range.start), end: isLive ? null : toInput(range.end)});
    }, [range, timezone, isLive]);

    // Playback covers exactly the applied query window, independently of the
    // library's availability and any unapplied edits in the date inputs.
    const minimum = Date.parse(range.start);
    const maximum = isLive ? Math.max(minimum, playbackTime ?? Date.now()) : Date.parse(range.end);
    const selectedTime = isLive ? maximum : Math.max(minimum, Math.min(maximum, playbackTime ?? maximum));
    const {start, end} = draft;
    const valid = start?.isValid() && (isLive || (end?.isValid() && start.valueOf() <= end.valueOf()));
    const format = (value) => formatDateTime(value, {timezone, locale, options: {
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }});
    const fromDescription = `${fromLabel}: ${start?.isValid() ? format(start.valueOf()) : '—'}`;
    const toDescription = `${toLabel}: ${isLive ? format(maximum) : end?.isValid() ? format(end.valueOf()) : '—'}`;
    const recent = (hours) => {
        const now = Date.now();
        onPresetChange({start: new Date(now - hours * 3600000).toISOString(), end: new Date(now).toISOString()});
    };
    // Preserve exact server bounds, including microseconds, for unchanged inputs.
    return <LocalizationProvider dateAdapter={AdapterMoment} dateLibInstance={moment} adapterLocale={pickerLocalization.adapterLocale}>
        <Box component="form" noValidate onSubmit={(event) => {
        event.preventDefault();
        if (valid && !isLive) onChange({
            start: start.valueOf() === toInput(range.start).valueOf() ? range.start : start.toISOString(),
            end: isLive ? null : end.valueOf() === toInput(range.end).valueOf() ? range.end : end.toISOString(),
        });
    }} sx={{m: 0, px: 1.5, py: 1, height: 64, boxSizing: 'border-box', display: 'flex', alignItems: 'center',
        minWidth: 0, overflowX: 'auto', containerType: 'inline-size', containerName: 'packet-map-toolbar',
        bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'border.main',
        // Match Earth View's toolbar height even when the controls scroll horizontally.
        scrollbarWidth: 'none', '&::-webkit-scrollbar': {display: 'none'},
        // The active thumb's enlarged hit area must not create a vertical scrollbar.
        overflowY: 'hidden'}}>
        {/* Keep the date controls on one row; narrow screens can scroll the bar. */}
        <Stack direction="row" spacing={1} alignItems="center" useFlexGap
            sx={{width: '100%', minWidth: 'max-content', whiteSpace: 'nowrap', '& > *': {flexShrink: 0},
                [compactActionsQuery]: {gap: 0.25}}}>
            <DateTimePicker label={fromLabel} timezone={timezone} disabled={isLive}
                open={fromPickerOpen && !isLive} onOpen={() => setFromPickerOpen(true)} onClose={() => setFromPickerOpen(false)}
                format={pickerLocalization.format} ampm={pickerLocalization.ampm} enableAccessibleFieldDOMStructure={false}
                value={start} onChange={(value) => setDraft({...draft, start: value})}
                slotProps={{textField: {size: 'small', error: !start?.isValid(), slotProps: {inputLabel: {shrink: true}}},
                    openPickerButton: {'aria-label': fromDescription, title: fromDescription}}}
                sx={datePickerSx} />
            <DateTimePicker label={toLabel} timezone={timezone} disabled={isLive}
                format={pickerLocalization.format} ampm={pickerLocalization.ampm} enableAccessibleFieldDOMStructure={false}
                value={isLive ? toInput(maximum) : end} onChange={(value) => setDraft({...draft, end: value})}
                slotProps={{textField: {size: 'small', error: !valid, slotProps: {inputLabel: {shrink: true}}},
                    openPickerButton: {'aria-label': toDescription, title: toDescription}}}
                sx={datePickerSx} />
            <Tooltip title={applyLabel}>
                <Box component="span" sx={{display: 'inline-flex'}}>
                    <IconButton type="submit" size="small" color="primary" disabled={!valid || isLive}
                        aria-label={applyLabel} sx={outlinedIconButtonSx}>
                        <CheckIcon />
                    </IconButton>
                </Box>
            </Tooltip>
            <Box sx={{flex: '1 0 400px', minWidth: 400,
                // Drop the timeline before it pushes the date controls and presets out of view.
                '@container packet-map-toolbar (max-width: 1280px)': {display: 'none'}}}>
                <DateRangeSelector value={selectedTime} min={minimum} max={maximum} positions={positions} disabled={isLive}
                    label={isLive ? t('packet_map.live_time', {defaultValue: 'Live time'})
                        : t('packet_map.playback_time', {defaultValue: 'Playback time'})}
                    formatValue={format}
                    formatTick={(date) => formatDateTime(date, {timezone, locale, options:
                        maximum - minimum <= 86400000 ? {hour: '2-digit', minute: '2-digit',
                            ...(maximum - minimum < 3600000 ? {second: '2-digit'} : {})} : {day: 'numeric', month: 'short'},
                    })}
                    formatTickTime={maximum - minimum > 86400000
                        ? (date) => formatDateTime(date, {timezone, locale, options: {hour: '2-digit', minute: '2-digit'}})
                        : undefined}
                    onChange={(_event, value) => {if (!isLive) onPlaybackTimeChange?.(value);}} />
            </Box>
            {/* Keep presets at the right edge even while the timeline is hidden. */}
            <Stack direction="row" spacing={1} alignItems="center" useFlexGap
                sx={{ml: 'auto', [compactActionsQuery]: {gap: 0.25}}}>
            <Tooltip title={isLive ? t('packet_map.stop_live', {defaultValue: 'Stop live updates and enable playback'})
                : t('packet_map.live_recent_description', {defaultValue: 'Follow the last 30 minutes of packets'})}>
                <ToggleButton value="live" selected={isLive} color="primary"
                    aria-label={t('packet_map.live', {defaultValue: 'LIVE'})}
                    onChange={() => onPresetChange(isLive ? {
                        start: range.start,
                        // Freeze at the displayed live cursor so playback starts from the same time.
                        end: new Date(maximum).toISOString(),
                    } : liveRangeAt())}
                    sx={{...actionButtonSx, gap: 0.75, whiteSpace: 'nowrap', flexShrink: 0,
                        [compactActionsQuery]: {...actionButtonSx[compactActionsQuery],
                            '& .responsive-action-label': {display: 'none'}}}}>
                    <FiberManualRecordIcon color={isLive ? 'error' : 'disabled'} sx={{fontSize: 10,
                        [compactActionsQuery]: {fontSize: 20}}} />
                    <span className="responsive-action-label">{t('packet_map.live', {defaultValue: 'LIVE'})}</span>
                </ToggleButton>
            </Tooltip>
            <ResponsiveActionButton label="1h" compactQuery={compactActionsQuery} sx={periodButtonSx}
                size="medium" startIcon={<AccessTimeIcon />} onClick={() => recent(1)} />
            <ResponsiveActionButton label="6h" compactQuery={compactActionsQuery} sx={periodButtonSx}
                size="medium" startIcon={<HistoryIcon />} onClick={() => recent(6)} />
            <ResponsiveActionButton label="24h" compactQuery={compactActionsQuery} sx={periodButtonSx}
                size="medium" startIcon={<TodayIcon />} onClick={() => recent(24)} />
            <ResponsiveActionButton label={t('packet_map.custom', {defaultValue: 'Custom'})}
                tooltip={t('packet_map.custom_dates', {defaultValue: 'Choose a custom date range'})}
                compactQuery={compactActionsQuery} sx={periodButtonSx} size="medium" startIcon={<DateRangeIcon />}
                onClick={() => {
                    // Freeze the displayed LIVE window before opening its date
                    // editor. Historical edits stay local until Apply is used.
                    if (isLive) onPresetChange({start: range.start, end: new Date(maximum).toISOString()});
                    setFromPickerOpen(true);
                }} />
            <Tooltip title={refreshLabel}>
                <Box component="span" sx={{display: 'inline-flex'}}>
                    <IconButton type="button" size="small" color="primary" aria-label={refreshLabel}
                        disabled={loading} onClick={onRefresh}
                        sx={outlinedIconButtonSx}>
                        <RefreshIcon />
                    </IconButton>
                </Box>
            </Tooltip>
            </Stack>
        </Stack>
        </Box>
    </LocalizationProvider>;
}
