/**
 * @license
 * Copyright (c) 2026 Efstratios Goudelis
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

import React, { useMemo } from 'react';
import { Box, Slider, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import moment from 'moment-timezone';

// Same visual language as the celestial projection selector: a bordered
// tinted panel, an SVG tick track, monospace labels, and an invisible MUI
// slider overlaid purely for thumb dragging and keyboard accessibility.
// The thumb stays within the panel; edge tick labels anchor inward below it.
const TRACK_LEFT = 30;
const TRACK_RIGHT = 970;
const TRACK_SPAN = TRACK_RIGHT - TRACK_LEFT;
const TRACK_Y = 13;
const TRACK_TOP = 39;
const TICK_COUNT = 5;

const asPercent = (value) => `${value / 10}%`;
const trackPercent = (fraction) => `${(TRACK_LEFT + fraction * TRACK_SPAN) / 10}%`;

const sliderSx = {
    position: 'absolute',
    top: TRACK_TOP,
    width: asPercent(TRACK_SPAN),
    height: 26,
    p: '0 !important',
    boxSizing: 'border-box',
    color: 'error.main',
    '& .MuiSlider-rail, & .MuiSlider-track': {
        opacity: 0,
    },
    '& .MuiSlider-thumb': {
        // The SVG and slider share the same top and height, so their centers align.
        top: '50%',
        transform: 'translate(-50%, -50%)',
        width: 18,
        height: 18,
        bgcolor: 'background.paper',
        border: '2px solid',
        borderColor: 'error.main',
        boxShadow: (theme) => `0 1px 3px ${alpha(theme.palette.common.black, 0.28)}`,
        transition: 'box-shadow 120ms ease, transform 120ms ease',
        '&::before': {
            boxShadow: 'none',
        },
        '&:hover, &.Mui-focusVisible': {
            boxShadow: (theme) => `0 0 0 5px ${alpha(theme.palette.error.main, 0.18)}`,
        },
        '&.Mui-active': {
            transform: 'translate(-50%, -50%) scale(1.14)',
            boxShadow: (theme) => `0 0 0 6px ${alpha(theme.palette.error.main, 0.22)}`,
        },
    },
    '&.Mui-disabled': {
        color: 'text.disabled',
        '& .MuiSlider-thumb': {
            borderColor: 'text.disabled',
        },
    },
};

// Short tick labels keep the track readable across multi-year libraries.
const tickFormat = (spanMs) => {
    if (spanMs <= 3 * 86400000) return 'HH:mm';
    if (spanMs <= 75 * 86400000) return 'D MMM';
    return 'MMM YY';
};

const PurgeSlider = ({
    value,
    min,
    max,
    olderLabel,
    nowLabel,
    cutoffText,
    showDates = true,
    disabled = false,
    onChange,
    onChangeCommitted,
}) => {
    const span = Math.max(1, max - min);
    const step = useMemo(() => Math.max(60000, Math.round(span / 720)), [span]);
    // The newest time is on the left; moving right selects older content.
    const fraction = Math.min(1, Math.max(0, (max - value) / span));
    const sliderValue = min + max - value;
    const handleX = trackPercent(fraction);
    const format = tickFormat(span);
    const ticks = Array.from({ length: TICK_COUNT }, (_unused, index) => {
        const tickFraction = index / (TICK_COUNT - 1);
        return {
            fraction: tickFraction,
            label: showDates ? moment(max - tickFraction * span).format(format) : '—',
        };
    });
    const labelSx = {
        fontSize: '0.6rem',
        fontWeight: 700,
        letterSpacing: '0.08em',
        lineHeight: 1,
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        color: 'text.secondary',
    };
    const valueSx = {
        fontSize: '0.72rem',
        fontFamily: 'monospace',
        fontWeight: 700,
        lineHeight: 1,
        color: disabled ? 'text.disabled' : 'error.main',
    };

    return (
        <Box
            role="group"
            aria-label={olderLabel}
            sx={{
                position: 'relative',
                width: '100%',
                minWidth: 0,
                height: 80,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 1,
                bgcolor: (theme) => alpha(theme.palette.background.default, 0.42),
                backgroundImage: (theme) => (
                    `radial-gradient(circle at 50% 72%, ${alpha(theme.palette.error.main, 0.1)}, transparent 26%)`
                ),
                opacity: disabled ? 0.65 : 1,
                transition: 'border-color 120ms ease, opacity 120ms ease',
            }}
        >
            <Box sx={{
                position: 'absolute',
                top: 8,
                left: 12,
                right: 12,
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) auto minmax(0, 1fr)',
                alignItems: 'center',
                columnGap: 1,
            }}>
                <Typography sx={labelSx}>{nowLabel}</Typography>
                <Typography
                    sx={{
                        ...valueSx,
                        textAlign: 'center',
                    }}
                >
                    {cutoffText}
                </Typography>
                <Typography
                    sx={{
                        ...labelSx,
                        textAlign: 'right',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        color: disabled ? 'text.disabled' : 'text.primary',
                    }}
                >
                    {olderLabel}
                </Typography>
            </Box>

            <Box
                component="svg"
                aria-hidden="true"
                sx={{
                    position: 'absolute',
                    top: TRACK_TOP,
                    left: 0,
                    width: '100%',
                    height: 26,
                    color: disabled ? 'text.disabled' : 'error.main',
                }}
            >
                <line
                    x1={trackPercent(0)}
                    y1={TRACK_Y}
                    x2={trackPercent(1)}
                    y2={TRACK_Y}
                    stroke="currentColor"
                    strokeWidth="4"
                    opacity="0.2"
                    vectorEffect="non-scaling-stroke"
                />
                {/* The red portion to the right marks everything older than the cutoff. */}
                <line
                    x1={handleX}
                    y1={TRACK_Y}
                    x2={trackPercent(1)}
                    y2={TRACK_Y}
                    stroke="currentColor"
                    strokeWidth="6"
                    opacity="0.9"
                    vectorEffect="non-scaling-stroke"
                />
                {ticks.map((tick) => (
                    <circle
                        key={`tick-${tick.fraction}`}
                        cx={trackPercent(tick.fraction)}
                        cy={TRACK_Y}
                        r="1.4"
                        fill="currentColor"
                        opacity="0.42"
                    />
                ))}
                <circle cx={trackPercent(1)} cy={TRACK_Y} r="4" fill="currentColor" opacity="0.9" />
                <circle cx={trackPercent(1)} cy={TRACK_Y} r="8" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.14" />
            </Box>

            <Box
                aria-hidden="true"
                sx={{
                    position: 'absolute',
                    top: TRACK_TOP + 23,
                    left: 0,
                    right: 0,
                    height: 10,
                    pointerEvents: 'none',
                }}
            >
                {ticks.map((tick) => (
                    <Typography
                        component="span"
                        key={`tick-label-${tick.fraction}`}
                        sx={{
                            position: 'absolute',
                            left: trackPercent(tick.fraction),
                            transform: tick.fraction === 0
                                ? 'none'
                                : tick.fraction === 1 ? 'translateX(-100%)' : 'translateX(-50%)',
                            fontFamily: 'monospace',
                            fontSize: '0.5rem',
                            fontWeight: 500,
                            lineHeight: 1,
                            opacity: 0.62,
                            whiteSpace: 'nowrap',
                            color: 'text.secondary',
                        }}
                    >
                        {tick.label}
                    </Typography>
                ))}
            </Box>

            <Slider
                value={sliderValue}
                min={min}
                max={max}
                step={step}
                track={false}
                disabled={disabled}
                aria-label={olderLabel}
                getAriaValueText={() => cutoffText}
                onChange={(_event, next) => onChange?.(min + max - Number(next))}
                onChangeCommitted={(_event, next) => onChangeCommitted?.(min + max - Number(next))}
                sx={{ ...sliderSx, left: asPercent(TRACK_LEFT) }}
            />
        </Box>
    );
};

export default PurgeSlider;
