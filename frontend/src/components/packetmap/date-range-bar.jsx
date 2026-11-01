/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useEffect, useMemo, useState} from 'react';
import {Box, Button, IconButton, Stack, Tooltip} from '@mui/material';
import {DateTimePicker} from '@mui/x-date-pickers/DateTimePicker';
import {LocalizationProvider} from '@mui/x-date-pickers/LocalizationProvider';
import {AdapterMoment} from '@mui/x-date-pickers/AdapterMoment';
import RefreshIcon from '@mui/icons-material/Refresh';
import CheckIcon from '@mui/icons-material/Check';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import moment from 'moment-timezone';
import {useTranslation} from 'react-i18next';
import {useUserTimeSettings} from '../../hooks/useUserTimeSettings.jsx';
import {formatDateTime} from '../../utils/date-time.js';
import DateRangeSelector from './date-range-selector.jsx';
import {datePickerLocalization} from './date-picker-localization.js';

const datePickerSx = {
    width: 220,
};

export default function DateRangeBar({range, availableRange, positions, onChange, onPresetChange = onChange,
    playbackTime, onPlaybackTimeChange, onRefresh, loading}) {
    const {t} = useTranslation('navigation');
    const applyLabel = t('packet_map.apply', {defaultValue: 'Apply'});
    const isLive = range.end === null;
    const {timezone, locale} = useUserTimeSettings();
    // The fields edit minutes. Hidden capture seconds must not carry into a
    // changed date; unchanged fields retain the exact original server bounds.
    const toInput = (date) => moment.tz(date, timezone).startOf('minute');
    const pickerLocalization = useMemo(() => datePickerLocalization(locale), [locale]);
    const [draft, setDraft] = useState(() => ({start: toInput(range.start), end: isLive ? null : toInput(range.end)}));
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
    const recent = (hours) => {
        const now = Date.now();
        onPresetChange({start: new Date(now - hours * 3600000).toISOString(), end: new Date(now).toISOString()});
    };
    // Preserve exact server bounds, including microseconds, for unchanged inputs.
    return <LocalizationProvider dateAdapter={AdapterMoment} dateLibInstance={moment} adapterLocale={pickerLocalization.adapterLocale}>
        <Box component="form" noValidate onSubmit={(event) => {
        event.preventDefault();
        if (valid) onChange({
            start: start.valueOf() === toInput(range.start).valueOf() ? range.start : start.toISOString(),
            end: isLive ? null : end.valueOf() === toInput(range.end).valueOf() ? range.end : end.toISOString(),
        });
    }} sx={{px: 1.5, py: 1, minWidth: 0, overflowX: 'auto',
        bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'border.main',
        // The active thumb's enlarged hit area must not create a vertical scrollbar.
        overflowY: 'hidden'}}>
        {/* Keep the date controls on one row; narrow screens can scroll the bar. */}
        <Stack direction="row" spacing={1} alignItems="center" useFlexGap
            sx={{width: '100%', minWidth: 'max-content', whiteSpace: 'nowrap', '& > *': {flexShrink: 0},
                '& .MuiButton-root': {minWidth: 0, px: 1, height: 32}}}>
            <DateTimePicker label={t('packet_map.from', {defaultValue: 'From'})} timezone={timezone}
                format={pickerLocalization.format} ampm={pickerLocalization.ampm} enableAccessibleFieldDOMStructure={false}
                value={start} onChange={(value) => setDraft({...draft, start: value})}
                slotProps={{textField: {size: 'small', error: !start?.isValid(), slotProps: {inputLabel: {shrink: true}}}}}
                sx={datePickerSx} />
            <DateTimePicker label={t('packet_map.to', {defaultValue: 'To'})} timezone={timezone} disabled={isLive}
                format={pickerLocalization.format} ampm={pickerLocalization.ampm} enableAccessibleFieldDOMStructure={false}
                value={isLive ? toInput(maximum) : end} onChange={(value) => setDraft({...draft, end: value})}
                slotProps={{textField: {size: 'small', error: !valid, slotProps: {inputLabel: {shrink: true}}}}}
                sx={datePickerSx} />
            <Tooltip title={applyLabel}>
                <Box component="span" sx={{display: 'inline-flex'}}>
                    <IconButton type="submit" size="small" color="primary" disabled={!valid}
                        aria-label={applyLabel} sx={{width: 32, height: 32}}>
                        <CheckIcon fontSize="small" />
                    </IconButton>
                </Box>
            </Tooltip>
            <Box sx={{flex: '1 0 400px', minWidth: 400}}>
                <DateRangeSelector value={selectedTime} min={minimum} max={maximum} positions={positions} disabled={isLive}
                    label={isLive ? t('packet_map.live_time', {defaultValue: 'Live time'})
                        : t('packet_map.playback_time', {defaultValue: 'Playback time'})}
                    formatValue={format}
                    formatTick={(date) => formatDateTime(date, {timezone, locale, options:
                        maximum - minimum <= 86400000 ? {hour: '2-digit', minute: '2-digit',
                            ...(maximum - minimum < 3600000 ? {second: '2-digit'} : {})} : {day: 'numeric', month: 'short'},
                    })}
                    onChange={(_event, value) => {if (!isLive) onPlaybackTimeChange?.(value);}} />
            </Box>
            <Tooltip describeChild title={t('packet_map.live_description', {defaultValue: 'Follow new packets from the selected start date'})}>
                <Button size="small" variant={isLive ? 'contained' : 'outlined'} color={isLive ? 'success' : 'primary'}
                    aria-pressed={isLive} onClick={() => onPresetChange({start: range.start, end: null})}
                    startIcon={<FiberManualRecordIcon sx={{fontSize: '10px !important'}} />}>
                    {t('packet_map.live', {defaultValue: 'LIVE'})}
                </Button>
            </Tooltip>
            <Button size="small" onClick={() => recent(24)}>24h</Button>
            <Button size="small" onClick={() => recent(168)}>7d</Button>
            <Button size="small" disabled={!availableRange} onClick={() => onPresetChange({...availableRange})}>
                {t('packet_map.all_dates', {defaultValue: 'All dates'})}
            </Button>
            <Button size="small" startIcon={<RefreshIcon />} disabled={loading} onClick={onRefresh}>
                {t('packet_map.refresh', {defaultValue: 'Refresh'})}
            </Button>
        </Stack>
        </Box>
    </LocalizationProvider>;
}
