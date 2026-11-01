/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useMemo} from 'react';
import {Box, Slider, Tooltip, Typography} from '@mui/material';
import {alpha} from '@mui/material/styles';
import {packetActivityRanges} from './timeline.js';

const VIEWBOX_WIDTH = 348;
const TRACK_START = 15;
const TRACK_END = 333;
const percent = (value) => `${value / VIEWBOX_WIDTH * 100}%`;
const EMPTY_POSITIONS = [];

function RangeValueLabel({children, open, value}) {
    // Portal date tooltips so the scrolling toolbar cannot clip them.
    return <Tooltip open={open} title={value} placement="bottom" enterTouchDelay={0}>
        {children}
    </Tooltip>;
}

export default function DateRangeSelector({value, min, max, positions = EMPTY_POSITIONS, onChange, formatValue, formatTick, label}) {
    const position = (date) => TRACK_START + (max > min ? (date - min) / (max - min) : 0) * (TRACK_END - TRACK_START);
    const ticks = max > min ? Array.from({length: 7}, (_, index) => min + (max - min) * index / 6) : [min];
    // Scrubbing moves only the pointer; packet availability stays fixed.
    const activity = useMemo(() => packetActivityRanges(positions, min, max), [positions, min, max]);

    // Copy the celestial selector's framed band, ticks, and handles, using
    // one playback cursor across the applied packet query window.
    return <Box role="group" aria-label={label} sx={{position: 'relative', width: '100%', height: 48,
        border: '1px solid', borderColor: 'divider', borderRadius: 1,
        bgcolor: (theme) => alpha(theme.palette.background.default, 0.42)}}>
        <Box sx={{position: 'absolute', inset: '5px 11px auto', height: 12, display: 'flex',
            alignItems: 'baseline', justifyContent: 'space-between', gap: 1}}>
            <Typography sx={{fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.08em', lineHeight: 1,
                textTransform: 'uppercase', color: 'text.secondary'}}>{label}</Typography>
            <Typography noWrap sx={{fontSize: '0.7rem', fontFamily: 'monospace', fontWeight: 700,
                lineHeight: 1, color: 'primary.main'}}>{formatValue(value)}</Typography>
        </Box>
        <Box component="svg" aria-hidden="true" sx={{position: 'absolute', left: 0, bottom: 1,
            width: '100%', height: 26, color: 'primary.main'}}>
            <line x1={percent(TRACK_START)} y1="13" x2={percent(TRACK_END)} y2="13"
                stroke="currentColor" strokeWidth="2" opacity="0.16" />
            <g className="packet-timeline-activity" stroke="currentColor" strokeWidth="4" strokeLinecap="round" opacity="0.85">
                {activity.map(({start, end}) => <line key={start} x1={percent(position(start))} y1="13"
                    x2={percent(position(end))} y2="13" />)}
            </g>
            {ticks.map((date) => <circle key={date} cx={percent(position(date))} cy="13" r="1.4"
                fill="currentColor" opacity="0.42" />)}
        </Box>
        <Box aria-hidden="true" sx={{position: 'absolute', inset: '19px 0 auto', height: 10, pointerEvents: 'none'}}>
            {ticks.map((date) => <Typography component="span" key={date} sx={{position: 'absolute',
                left: percent(position(date)), transform: 'translateX(-50%)', color: 'text.secondary',
                fontFamily: 'monospace', fontSize: '0.5rem', fontWeight: 500, lineHeight: 1, opacity: 0.62}}>
                {formatTick(date)}
            </Typography>)}
        </Box>
        <Slider value={value} min={min} max={max} step={Math.min(1000, max - min || 1)} track={false} disabled={max <= min}
            slots={{valueLabel: RangeValueLabel}} aria-label={label}
            getAriaValueText={formatValue} valueLabelDisplay="auto" valueLabelFormat={formatValue}
            onChange={onChange}
            sx={{position: 'absolute', top: 21, left: percent(TRACK_START), width: percent(TRACK_END - TRACK_START),
                height: 26, p: '0 !important', boxSizing: 'border-box', color: 'primary.main',
                '& .MuiSlider-rail, & .MuiSlider-track': {opacity: 0},
                '& .MuiSlider-thumb': {top: 11, transform: 'translate(-50%, -50%)', width: 12, height: 12,
                    bgcolor: 'background.paper', border: '2px solid', borderColor: 'primary.main',
                    boxShadow: (theme) => `0 1px 3px ${alpha(theme.palette.common.black, 0.28)}`,
                    transition: 'box-shadow 120ms ease, transform 120ms ease',
                    '&::before': {boxShadow: 'none'},
                    '&:hover, &.Mui-focusVisible': {boxShadow: (theme) => `0 0 0 5px ${alpha(theme.palette.primary.main, 0.18)}`},
                    '&.Mui-active': {transform: 'translate(-50%, -50%) scale(1.14)',
                        boxShadow: (theme) => `0 0 0 6px ${alpha(theme.palette.primary.main, 0.22)}`}}}} />
    </Box>;
}
