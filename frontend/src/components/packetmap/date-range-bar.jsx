/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useEffect, useState} from 'react';
import {Box, Button, Slider, Stack, TextField, Tooltip, Typography} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import moment from 'moment-timezone';
import {useTranslation} from 'react-i18next';
import {useUserTimeSettings} from '../../hooks/useUserTimeSettings.jsx';
import {formatDateTime} from '../../utils/date-time.js';

function RangeValueLabel({children, open, value}) {
    // Portal the date tooltip so the scrolling toolbar cannot clip it.
    return <Tooltip open={open} title={value} placement="bottom" enterTouchDelay={0}>
        {children}
    </Tooltip>;
}

export default function DateRangeBar({range, availableRange, onChange, onRefresh, loading}) {
    const {t} = useTranslation('navigation');
    const {timezone, locale} = useUserTimeSettings();
    const toInput = (date) => moment.tz(date, timezone).format('YYYY-MM-DDTHH:mm');
    const [draft, setDraft] = useState(() => ({start: toInput(range.start), end: toInput(range.end)}));
    const [slider, setSlider] = useState([Date.parse(range.start), Date.parse(range.end)]);
    useEffect(() => {
        setDraft({start: toInput(range.start), end: toInput(range.end)});
        setSlider([Date.parse(range.start), Date.parse(range.end)]);
    }, [range, timezone]);

    const minimum = Math.min(Date.parse(availableRange?.start || range.start), Date.parse(range.start));
    const maximum = Math.max(Date.parse(availableRange?.end || range.end), Date.parse(range.end), minimum + 60000);
    const start = moment.tz(draft.start, 'YYYY-MM-DDTHH:mm', true, timezone);
    const end = moment.tz(draft.end, 'YYYY-MM-DDTHH:mm', true, timezone);
    const valid = start.isValid() && end.isValid() && start.valueOf() <= end.valueOf();
    const format = (value) => formatDateTime(value, {timezone, locale, options: {dateStyle: 'short', timeStyle: 'short'}});
    const recent = (hours) => {
        const now = Date.now();
        onChange({start: new Date(now - hours * 3600000).toISOString(), end: new Date(now).toISOString()});
    };
    const sliderDate = (value, edge) => {
        // JavaScript dates lose the capture's microseconds. Keep exact server
        // bounds when a handle stays put or reaches the available endpoint.
        if (value === Date.parse(range[edge])) return range[edge];
        if (availableRange && value === Date.parse(availableRange[edge])) return availableRange[edge];
        return new Date(value).toISOString();
    };

    // Validate dates here; the slider's second-sized steps must not make a
    // capture with fractional seconds block native form submission.
    return <Box component="form" noValidate onSubmit={(event) => {
        event.preventDefault();
        if (valid) onChange({
            start: draft.start === toInput(range.start) ? range.start : start.toISOString(),
            end: draft.end === toInput(range.end) ? range.end : end.toISOString(),
        });
    }} sx={{px: 1.5, py: 1, minWidth: 0, overflowX: 'auto'}}>
        {/* Keep the date controls on one row; narrow screens can scroll the bar. */}
        <Stack direction="row" spacing={1} alignItems="center" useFlexGap
            sx={{width: '100%', minWidth: 'max-content', whiteSpace: 'nowrap', '& > *': {flexShrink: 0},
                '& .MuiButton-root': {minWidth: 0, px: 1, height: 32}}}>
            <TextField size="small" type="datetime-local" label={t('packet_map.from', {defaultValue: 'From'})}
                value={draft.start} onChange={(event) => setDraft({...draft, start: event.target.value})}
                slotProps={{inputLabel: {shrink: true}}}
                sx={{width: 190, '& .MuiInputBase-root': {height: 32, fontSize: '0.75rem'}, '& input': {px: 1}}} />
            <TextField size="small" type="datetime-local" label={t('packet_map.to', {defaultValue: 'To'})}
                value={draft.end} onChange={(event) => setDraft({...draft, end: event.target.value})}
                error={!valid} slotProps={{inputLabel: {shrink: true}}}
                sx={{width: 190, '& .MuiInputBase-root': {height: 32, fontSize: '0.75rem'}, '& input': {px: 1}}} />
            <Button type="submit" size="small" disabled={!valid}>{t('packet_map.apply', {defaultValue: 'Apply'})}</Button>
            <Typography variant="caption" color="text.secondary">{timezone}</Typography>
            <Box sx={{flex: '1 0 180px', minWidth: 180, px: 1}}>
                <Slider value={slider} min={minimum} max={maximum} step={1000}
                    slots={{valueLabel: RangeValueLabel}}
                    getAriaLabel={(index) => index === 0 ? t('packet_map.range_start', {defaultValue: 'Range start'})
                    : t('packet_map.range_end', {defaultValue: 'Range end'})}
                    getAriaValueText={format} valueLabelDisplay="auto" valueLabelFormat={format}
                    onChange={(_event, value) => setSlider(value)}
                    onChangeCommitted={(_event, value) => onChange({start: sliderDate(value[0], 'start'), end: sliderDate(value[1], 'end')})}
                    sx={{verticalAlign: 'middle', '& .MuiSlider-thumb': {width: 12, height: 12}}} />
            </Box>
            <Button size="small" onClick={() => recent(24)}>24h</Button>
            <Button size="small" onClick={() => recent(168)}>7d</Button>
            <Button size="small" disabled={!availableRange} onClick={() => onChange({...availableRange})}>
                {t('packet_map.all_dates', {defaultValue: 'All dates'})}
            </Button>
            <Button size="small" startIcon={<RefreshIcon />} disabled={loading} onClick={onRefresh}>
                {t('packet_map.refresh', {defaultValue: 'Refresh'})}
            </Button>
        </Stack>
    </Box>;
}
