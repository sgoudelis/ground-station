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

export default function DateRangeSelector({value, min, max, positions = EMPTY_POSITIONS, onChange, formatValue, formatTick, formatTickTime, label, disabled = false}) {
    const position = (date) => TRACK_START + (max > min ? (date - min) / (max - min) : 0) * (TRACK_END - TRACK_START);
    const ticks = max > min ? Array.from({length: 7}, (_, index) => min + (max - min) * index / 6) : [min];
    // Scrubbing moves only the pointer; packet availability stays fixed.
    const activity = useMemo(() => packetActivityRanges(positions, min, max), [positions, min, max]);

    // Copy the celestial selector's framed band, ticks, and handles, using
    // one playback cursor across the applied packet query window.
    return <Box role="group" aria-label={label} sx={{position: 'relative', width: '100%', height: 48,
        border: '1px solid', borderColor: 'divider', borderRadius: 1,
        bgcolor: (theme) => alpha(theme.palette.background.default, 0.42)}}>
        {/* Keep the track and thumb aligned slightly below the panel's center. */}
        <Box component="svg" aria-hidden="true" sx={{position: 'absolute', left: 0, top: 'calc(50% + 4px)',
            transform: 'translateY(-50%)', width: '100%', height: 22, color: 'primary.main'}}>
            <line x1={percent(TRACK_START)} y1="11" x2={percent(TRACK_END)} y2="11"
                stroke="currentColor" strokeWidth="3" opacity="0.16" />
            <g className="packet-timeline-activity" stroke="currentColor" strokeWidth="5" strokeLinecap="round" opacity="0.85">
                {activity.map(({start, end}) => <line key={start} x1={percent(position(start))} y1="11"
                    x2={percent(position(end))} y2="11" />)}
            </g>
            {ticks.map((date) => <circle key={date} cx={percent(position(date))} cy="11" r="1.8"
                fill="currentColor" opacity="0.42" />)}
        </Box>
        <Box aria-hidden="true" sx={{position: 'absolute', inset: '8px 0 1px', pointerEvents: 'none'}}>
            {ticks.map((date) => <Box key={date} sx={{position: 'absolute', top: 0, bottom: 0,
                left: percent(position(date)), display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                alignItems: 'center', transform: 'translateX(-50%)', color: 'text.secondary'}}>
                <Typography component="span" sx={{fontFamily: 'monospace', fontSize: '0.625rem', fontWeight: 500,
                    lineHeight: 1, opacity: 0.8}}>{formatTick(date)}</Typography>
                {/* Date ranges show a quiet time row below the track; short ranges already label times. */}
                {formatTickTime && <Typography component="span" sx={{fontFamily: 'monospace', fontSize: '0.55rem',
                    lineHeight: 1, opacity: 0.65}}>{formatTickTime(date)}</Typography>}
            </Box>)}
        </Box>
        <Slider value={value} min={min} max={max} step={Math.min(1000, max - min || 1)} track={false} disabled={disabled || max <= min}
            slots={{valueLabel: RangeValueLabel}} aria-label={label}
            getAriaValueText={formatValue} valueLabelDisplay="auto" valueLabelFormat={formatValue}
            onChange={onChange}
            sx={{position: 'absolute', top: 'calc(50% + 4px)', transform: 'translateY(-50%)',
                left: percent(TRACK_START), width: percent(TRACK_END - TRACK_START),
                height: 22, p: '0 !important', boxSizing: 'border-box', color: 'primary.main',
                '& .MuiSlider-rail, & .MuiSlider-track': {opacity: 0},
                '& .MuiSlider-thumb': {top: '50%', transform: 'translate(-50%, -50%)', width: 16, height: 16,
                    bgcolor: 'background.paper', border: '2px solid', borderColor: 'primary.main',
                    boxShadow: (theme) => `0 1px 3px ${alpha(theme.palette.common.black, 0.28)}`,
                    transition: 'box-shadow 120ms ease, transform 120ms ease',
                    '&::before': {boxShadow: 'none'},
                    '&:hover, &.Mui-focusVisible': {boxShadow: (theme) => `0 0 0 5px ${alpha(theme.palette.primary.main, 0.18)}`},
                    '&.Mui-active': {transform: 'translate(-50%, -50%) scale(1.14)',
                        boxShadow: (theme) => `0 0 0 6px ${alpha(theme.palette.primary.main, 0.22)}`}}}} />
    </Box>;
}
