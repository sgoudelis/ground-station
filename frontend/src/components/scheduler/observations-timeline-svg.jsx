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
 *
 */

import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    Box,
    Typography,
    Stack,
    Chip,
    Divider,
    Select,
    MenuItem,
    FormControl,
    InputLabel,
    useTheme,
} from '@mui/material';
import SunCalc from 'suncalc';
import { setTimelineDuration, setSelectedObservation, setDialogOpen } from './scheduler-slice.jsx';
import { getFlattenedTasks } from './session-utils.js';
import { humanizeFutureDateInMinutes } from '../common/common.jsx';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { formatDateTime, formatTime } from '../../utils/date-time.js';
import { useTranslation } from 'react-i18next';

const ObservationsTimeline = () => {
    const { t } = useTranslation('common');
    const dispatch = useDispatch();
    const theme = useTheme();
    const observations = useSelector((state) => state.scheduler?.observations || []);
    const timeline = useSelector((state) => state.scheduler?.timeline);
    const { durationHours } = timeline;
    const groundStationLocation = useSelector((state) => state.location.location);

    const [hoveredObservation, setHoveredObservation] = useState(null);
    const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
    const [width, setWidth] = useState(1200);
    const containerRef = useRef(null);
    const { timezone, locale } = useUserTimeSettings();

    // Capture "now" and update it every minute
    const [staticNow, setStaticNow] = useState(new Date());

    useEffect(() => {
        const updateWidth = () => {
            if (containerRef.current) {
                setWidth(containerRef.current.offsetWidth);
            }
        };

        updateWidth();
        window.addEventListener('resize', updateWidth);
        return () => window.removeEventListener('resize', updateWidth);
    }, []);

    // Update timeline every minute
    useEffect(() => {
        const intervalId = setInterval(() => {
            setStaticNow(new Date());
        }, 60000); // Update every minute

        return () => clearInterval(intervalId);
    }, []);
    const marginTop = 25;
    const marginBottom = 30;
    const marginLeft = 30;
    const marginRight = 30;
    const barSpacing = 5;
    const rowHeight = 35;

    // Filter observations within the time window
    const filteredObservations = useMemo(() => {
        const now = staticNow;
        const halfDuration = durationHours / 2;
        const startTime = new Date(now.getTime() - halfDuration * 60 * 60 * 1000);
        const endTime = new Date(now.getTime() + halfDuration * 60 * 60 * 1000);

        return observations.filter(obs => {
            if (!obs.pass) return false;
            // Use task_start and task_end (elevation-constrained times) instead of event times
            if (!obs.task_start || !obs.task_end) return false;
            const obsStart = new Date(obs.task_start);
            const obsEnd = new Date(obs.task_end);
            const inTimeWindow = obsEnd >= startTime && obsStart <= endTime;
            return inTimeWindow;
        }).sort((a, b) => new Date(a.task_start) - new Date(b.task_start));
    }, [observations, durationHours, staticNow]);

    // Layout observations in a single row; visual overlaps are allowed.
    const { layoutData, requiredRows, sunData } = useMemo(() => {
        const now = staticNow;
        const halfDuration = durationHours / 2;
        const startTime = new Date(now.getTime() - halfDuration * 60 * 60 * 1000);
        const endTime = new Date(now.getTime() + halfDuration * 60 * 60 * 1000);
        const totalMs = endTime - startTime;
        const drawableWidth = width - marginLeft - marginRight;

        // Calculate sun times for the timeline window
        let sunData = { nightPeriods: [], sunEvents: [] };
        if (groundStationLocation) {
            const { lat, lon } = groundStationLocation;

            const nightPeriods = [];
            const sunEvents = [];

            // Calculate for each day in the timeline window
            // Start from 1 day before to catch night periods that started before the window
            const startDate = new Date(startTime);
            startDate.setDate(startDate.getDate() - 1);
            startDate.setHours(0, 0, 0, 0);

            const endDate = new Date(endTime);
            endDate.setDate(endDate.getDate() + 1);
            endDate.setHours(23, 59, 59, 999);

            let currentDate = new Date(startDate);
            while (currentDate <= endDate) {
                const sunTimes = SunCalc.getTimes(currentDate, lat, lon);
                const sunrise = sunTimes.sunrise;
                const sunset = sunTimes.sunset;

                // Check if sunrise is valid and within window
                if (sunrise && !isNaN(sunrise.getTime()) && sunrise >= startTime && sunrise <= endTime) {
                    sunEvents.push({ time: sunrise.getTime(), type: 'sunrise' });
                }

                // Check if sunset is valid and within window
                if (sunset && !isNaN(sunset.getTime()) && sunset >= startTime && sunset <= endTime) {
                    sunEvents.push({ time: sunset.getTime(), type: 'sunset' });
                }

                // Move to next day
                currentDate.setDate(currentDate.getDate() + 1);
            }

            // Sort events by time
            sunEvents.sort((a, b) => a.time - b.time);

            // Build night periods from events
            // Start by checking if we're in night at the start of the timeline
            const firstDayTimes = SunCalc.getTimes(new Date(startTime), lat, lon);
            const isNightAtStart = startTime < firstDayTimes.sunrise || startTime > firstDayTimes.sunset;

            if (isNightAtStart) {
                // Find first sunrise
                const firstSunrise = sunEvents.find(e => e.type === 'sunrise');
                if (firstSunrise) {
                    nightPeriods.push({
                        start: startTime.getTime(),
                        end: firstSunrise.time
                    });
                } else {
                    // Entire window is night
                    nightPeriods.push({
                        start: startTime.getTime(),
                        end: endTime.getTime()
                    });
                }
            }

            // Create night periods between sunset and sunrise events
            for (let i = 0; i < sunEvents.length; i++) {
                if (sunEvents[i].type === 'sunset') {
                    // Find next sunrise
                    const nextSunrise = sunEvents.slice(i + 1).find(e => e.type === 'sunrise');
                    if (nextSunrise) {
                        nightPeriods.push({
                            start: sunEvents[i].time,
                            end: nextSunrise.time
                        });
                    } else {
                        // No more sunrises, night until end of timeline
                        nightPeriods.push({
                            start: sunEvents[i].time,
                            end: endTime.getTime()
                        });
                    }
                }
            }

            sunData = { nightPeriods, sunEvents };
        }

        const layoutData = filteredObservations.map((obs) => {
            // Use task_start and task_end for positioning
            const obsStartTime = new Date(obs.task_start);
            const obsEndTime = new Date(obs.task_end);

            const startX = marginLeft + Math.max(0, ((obsStartTime - startTime) / totalMs) * drawableWidth);
            const endX = marginLeft + Math.min(drawableWidth, ((obsEndTime - startTime) / totalMs) * drawableWidth);
            const barWidth = endX - startX;
            return { obs, startX, endX, barWidth, rowIndex: 0 };
        });

        return { layoutData, requiredRows: 1, sunData };
    }, [filteredObservations, durationHours, width, marginLeft, marginRight, groundStationLocation, staticNow]);

    const height = Math.max(200, requiredRows * rowHeight + marginTop + marginBottom);
    const drawableHeight = height - marginTop - marginBottom;
    const renderRowHeight = drawableHeight / requiredRows;
    const renderBarHeight = Math.max(24, renderRowHeight - barSpacing);

    const now = staticNow;
    const halfDuration = durationHours / 2;
    const startTime = new Date(now.getTime() - halfDuration * 60 * 60 * 1000);
    const endTime = new Date(now.getTime() + halfDuration * 60 * 60 * 1000);
    const hoursToShow = Math.min(durationHours, 48);
    const hourStep = hoursToShow <= 12 ? 2 : hoursToShow <= 24 ? 4 : 6;

    const handleObservationClick = (obs) => {
        dispatch(setSelectedObservation(obs));
        dispatch(setDialogOpen(true));
    };

    const handleObservationMouseEnter = (event, obs) => {
        setTooltipPosition({ x: event.clientX, y: event.clientY });
        setHoveredObservation(obs);
    };

    const getBarColor = (obs) => {
        if (obs.status === 'running') return '#4caf50';
        if (obs.status === 'completed') return '#42a5f5';
        if (obs.status === 'cancelled' || obs.status === 'failed') return '#ef5350';
        if (!obs.enabled) return '#999';
        return '#ab47bc';
    };

    const formatDuration = (startIso, endIso) => {
        if (!startIso || !endIso) return '-';
        const start = new Date(startIso);
        const end = new Date(endIso);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '-';
        const totalMinutes = Math.max(0, Math.round((end - start) / 60000));
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        if (hours > 0) return `${hours}h ${minutes}m`;
        return `${minutes}m`;
    };

    const formatStatus = (status) => {
        if (!status) return 'Unknown';
        const label = status.replaceAll('_', ' ');
        return label.charAt(0).toUpperCase() + label.slice(1);
    };

    const rawPeakElevation = hoveredObservation?.pass?.peak_altitude;
    const peakElevation = rawPeakElevation == null || rawPeakElevation === '' ? null : Number(rawPeakElevation);
    const hasPeakElevation = Number.isFinite(peakElevation);
    const hoveredBarColor = hoveredObservation ? getBarColor(hoveredObservation) : theme.palette.primary.main;
    const hoveredTasks = hoveredObservation ? getFlattenedTasks(hoveredObservation) : [];
    const passStartLabel = formatDateTime(hoveredObservation?.pass?.event_start, { timezone, locale });
    const passEndLabel = formatDateTime(hoveredObservation?.pass?.event_end, { timezone, locale });
    const tooltipOnRightEdge = tooltipPosition.x > window.innerWidth - 370;
    const tooltipOnBottomEdge = tooltipPosition.y > window.innerHeight - 410;

    return (
        <Box>
            <Box display="flex" justifyContent="space-between" alignItems="center">
                <Stack direction="row" spacing={2} alignItems="center">
                    <Typography variant="subtitle1" sx={{ fontWeight: 600, color: 'text.primary' }}>{t('observations_timeline_svg.timeline', { defaultValue: 'Timeline' })}</Typography>
                </Stack>
                <Stack direction="row" spacing={2} alignItems="center">
                    <FormControl size="small" sx={{ minWidth: 85, '& .MuiInputBase-root': { fontSize: '0.875rem' } }}>
                        <InputLabel sx={{ fontSize: '0.875rem' }}>{t('observations_timeline_svg.duration', { defaultValue: 'Duration' })}</InputLabel>
                        <Select
                            value={durationHours}
                            onChange={(e) => dispatch(setTimelineDuration(e.target.value))}
                            label={t('observations_timeline_svg.duration', { defaultValue: 'Duration' })}
                        >
                            <MenuItem value={12} sx={{ fontSize: '0.875rem' }}>12h</MenuItem>
                            <MenuItem value={24} sx={{ fontSize: '0.875rem' }}>24h</MenuItem>
                            <MenuItem value={48} sx={{ fontSize: '0.875rem' }}>48h</MenuItem>
                            <MenuItem value={72} sx={{ fontSize: '0.875rem' }}>72h</MenuItem>
                        </Select>
                    </FormControl>
                </Stack>
            </Box>

            <Box ref={containerRef} sx={{ position: 'relative', width: '100%', overflow: 'hidden' }}>
                    <svg
                        width="100%"
                        height={height}
                        viewBox={`0 0 ${width} ${height}`}
                        style={{ display: 'block' }}
                        onMouseMove={(e) => {
                            setTooltipPosition({ x: e.clientX, y: e.clientY });
                        }}
                    >
                        <defs>
                            <pattern id="alternatingBg" width={width / (hoursToShow / hourStep)} height={height - marginTop - marginBottom} patternUnits="userSpaceOnUse">
                                <rect width={width / (hoursToShow / hourStep)} height={height - marginTop - marginBottom} fill="currentColor" opacity="0.02" />
                                <rect x={width / (hoursToShow / hourStep)} width={width / (hoursToShow / hourStep)} height={height - marginTop - marginBottom} fill="transparent" />
                            </pattern>
                            <filter id="shadow">
                                <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.3"/>
                            </filter>
                        </defs>

                        {/* Alternating background */}
                        <rect x={marginLeft} y={marginTop} width={width - marginLeft - marginRight} height={height - marginTop - marginBottom} fill="url(#alternatingBg)" />

                        {/* Timeline border */}
                        <rect
                            x={marginLeft}
                            y={marginTop}
                            width={width - marginLeft - marginRight}
                            height={height - marginTop - marginBottom}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="0.5"
                            opacity="0.3"
                        />

                        {/* Night period shading */}
                        {sunData && sunData.nightPeriods.map((period, index) => {
                            const totalDuration = endTime.getTime() - startTime.getTime();
                            const leftPercent = ((period.start - startTime.getTime()) / totalDuration);
                            const widthPercent = ((period.end - period.start) / totalDuration);
                            const xPos = marginLeft + leftPercent * (width - marginLeft - marginRight);
                            const rectWidth = widthPercent * (width - marginLeft - marginRight);

                            return (
                                <rect
                                    key={`night-${index}`}
                                    x={xPos}
                                    y={marginTop}
                                    width={rectWidth}
                                    height={height - marginTop - marginBottom}
                                    fill={theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.15)'}
                                    style={{ pointerEvents: 'none' }}
                                />
                            );
                        })}

                        {/* Sun event markers - sunrise/sunset lines */}
                        {sunData && sunData.sunEvents.map((event, index) => {
                            const totalDuration = endTime.getTime() - startTime.getTime();
                            const position = ((event.time - startTime.getTime()) / totalDuration);
                            const xPos = marginLeft + position * (width - marginLeft - marginRight);
                            const isSunrise = event.type === 'sunrise';
                            const color = isSunrise ? '#6b5110' : '#2a5070';
                            const eventTime = new Date(event.time);
                            const timeStr = formatTime(eventTime, {
                                timezone,
                                locale,
                                options: { hour: '2-digit', minute: '2-digit', hour12: false },
                            });

                            return (
                                <g key={`sun-${index}`}>
                                    {/* Vertical line */}
                                    <line
                                        x1={xPos}
                                        y1={marginTop}
                                        x2={xPos}
                                        y2={height - marginBottom}
                                        stroke={color}
                                        strokeWidth="2"
                                        opacity="0.8"
                                        style={{ pointerEvents: 'none' }}
                                    />
                                    {/* Label at top */}
                                    <text
                                        x={xPos}
                                        y={marginTop - 8}
                                        textAnchor="middle"
                                        fontSize="10"
                                        fontWeight="bold"
                                        fill={color}
                                        opacity="0.8"
                                        style={{ pointerEvents: 'none' }}
                                    >
                                        {isSunrise ? '☀ Sunrise' : '☾ Sunset'}
                                    </text>
                                </g>
                            );
                        })}

                        {/* Vertical grid lines */}
                        {Array.from({ length: Math.floor(hoursToShow / hourStep) + 1 }).map((_, i) => {
                            const hour = i * hourStep - halfDuration; // Offset to start from negative
                            const x = marginLeft + ((i * hourStep) / durationHours) * (width - marginLeft - marginRight);
                            const time = new Date(now.getTime() + hour * 60 * 60 * 1000);
                            const timeStr = formatTime(time, {
                                timezone,
                                locale,
                                options: { hour: '2-digit', minute: '2-digit', hour12: false },
                            });
                            const absHour = Math.abs(hour);
                            const sign = hour >= 0 ? '+' : '-';
                            const tPlusStr = `T${sign}${Math.floor(absHour)}:${String(Math.floor((absHour % 1) * 60)).padStart(2, '0')}`;

                            return (
                                <g key={`v-grid-${i}`}>
                                    {hour !== 0 && (
                                        <line
                                            x1={x}
                                            y1={marginTop}
                                            x2={x}
                                            y2={height - marginBottom}
                                            stroke="currentColor"
                                            strokeWidth="0.5"
                                            opacity="0.2"
                                        />
                                    )}
                                    {/* T+ time axis at top */}
                                    <text
                                        x={x}
                                        y={marginTop - 5}
                                        textAnchor="middle"
                                        fontSize="11"
                                        fill="currentColor"
                                        opacity="0.7"
                                    >
                                        {tPlusStr}
                                    </text>
                                    {/* Absolute time axis at bottom */}
                                    <text
                                        x={x}
                                        y={height - 10}
                                        textAnchor="middle"
                                        fontSize="12"
                                        fill={hour === 0 ? "#f50057" : "currentColor"}
                                        fontWeight={hour === 0 ? "bold" : "normal"}
                                    >
                                        {hour === 0 ? "NOW" : timeStr}
                                    </text>
                                </g>
                            );
                        })}

                        {/* Current time marker */}
                        <g>
                            <line
                                x1={marginLeft + (width - marginLeft - marginRight) / 2}
                                y1={marginTop}
                                x2={marginLeft + (width - marginLeft - marginRight) / 2}
                                y2={height - marginBottom}
                                stroke="#f50057"
                                strokeWidth="0.5"
                            />
                        </g>

                        {/* Observation events */}
                        {layoutData.map(({ obs, startX, barWidth, rowIndex }) => {
                            const y = marginTop + (rowIndex * renderRowHeight) + ((renderRowHeight - renderBarHeight) / 2);
                            const barColor = getBarColor(obs);
                            const label = obs.satellite?.name || 'Unknown';

                            return (
                                <g
                                    key={obs.id}
                                    style={{ cursor: 'pointer' }}
                                    onMouseEnter={(event) => handleObservationMouseEnter(event, obs)}
                                    onMouseLeave={() => setHoveredObservation(null)}
                                    onClick={() => handleObservationClick(obs)}
                                >
                                    {/* Filled area */}
                                    <rect
                                        x={startX}
                                        y={y}
                                        width={barWidth}
                                        height={renderBarHeight}
                                        fill={barColor}
                                        opacity={hoveredObservation?.id === obs.id ? 0.4 : 0.3}
                                    />
                                    {/* Satellite name */}
                                    {barWidth > 5 && (
                                        <text
                                            x={startX + barWidth / 2}
                                            y={y + (renderBarHeight / 2)}
                                            fontSize="9"
                                            fontWeight="600"
                                            fill={!obs.enabled ? '#666' : (theme.palette.mode === 'dark' ? '#fff' : '#000')}
                                            textAnchor="middle"
                                            dominantBaseline="middle"
                                            transform={`rotate(-90, ${startX + barWidth / 2}, ${y + (renderBarHeight / 2)})`}
                                            style={{ pointerEvents: 'none' }}
                                        >
                                            {label}
                                        </text>
                                    )}
                                </g>
                            );
                        })}
                    </svg>

                    {/* Tooltip */}
                    {hoveredObservation && (
                        <Box
                            role="tooltip"
                            sx={{
                                position: 'fixed',
                                left: tooltipPosition.x + (tooltipOnRightEdge ? -14 : 14),
                                top: tooltipPosition.y + (tooltipOnBottomEdge ? -14 : 14),
                                transform: `${tooltipOnRightEdge ? 'translateX(-100%)' : ''} ${tooltipOnBottomEdge ? 'translateY(-100%)' : ''}`.trim() || 'none',
                                bgcolor: 'background.paper',
                                border: '1px solid',
                                borderColor: 'divider',
                                borderTop: '3px solid',
                                borderTopColor: hoveredBarColor,
                                borderRadius: 2,
                                boxShadow: theme.shadows[8],
                                zIndex: 9999,
                                pointerEvents: 'none',
                                width: 340,
                                maxWidth: 'calc(100vw - 32px)',
                                overflow: 'hidden',
                            }}
                        >
                            <Box sx={{ px: 2, py: 1.5 }}>
                                <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.5}>
                                    <Box sx={{ minWidth: 0 }}>
                                        <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.25 }} noWrap>
                                            {hoveredObservation.satellite?.name || hoveredObservation.satellite_name || 'Unknown satellite'}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {t('observations_timeline_svg.scheduled_observation', { defaultValue: 'Scheduled observation' })}
                                        </Typography>
                                    </Box>
                                    <Chip
                                        label={`${formatStatus(hoveredObservation.status)}${hoveredObservation.enabled === false ? ' · Disabled' : ''}`}
                                        size="small"
                                        sx={{
                                            height: 24,
                                            flexShrink: 0,
                                            bgcolor: `${hoveredBarColor}1f`,
                                            color: hoveredBarColor,
                                            fontWeight: 700,
                                            '& .MuiChip-label': { px: 1 },
                                        }}
                                    />
                                </Stack>
                            </Box>

                            <Divider />

                            <Box sx={{ px: 2, py: 1.5 }}>
                                <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 700, lineHeight: 1.5 }}>
                                    {t('observations_timeline_svg.schedule', { defaultValue: 'Schedule' })}
                                </Typography>
                                <Box sx={{ display: 'grid', gridTemplateColumns: '72px minmax(0, 1fr)', columnGap: 1.5, rowGap: 0.75, mt: 0.75 }}>
                                    <Typography variant="caption" color="text.secondary">{t('observations_timeline_svg.starts', { defaultValue: 'Starts' })}</Typography>
                                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                        {formatDateTime(hoveredObservation.task_start, { timezone, locale })}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">{t('observations_timeline_svg.ends', { defaultValue: 'Ends' })}</Typography>
                                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                        {formatDateTime(hoveredObservation.task_end, { timezone, locale })}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">{t('observations_timeline_svg.duration', { defaultValue: 'Duration' })}</Typography>
                                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                        {formatDuration(hoveredObservation.task_start, hoveredObservation.task_end)}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">{t('observations_timeline_svg.begins', { defaultValue: 'Begins' })}</Typography>
                                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                                        {humanizeFutureDateInMinutes(hoveredObservation.task_start)}
                                    </Typography>
                                </Box>
                            </Box>

                            <Divider />

                            <Box sx={{ px: 2, py: 1.5 }}>
                                <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={2}>
                                    <Box sx={{ minWidth: 0, flex: 1 }}>
                                        <Typography variant="overline" sx={{ color: 'text.secondary', fontWeight: 700, lineHeight: 1.5 }}>
                                            {t('observations_timeline_svg.satellite_pass', { defaultValue: 'Satellite pass' })}
                                        </Typography>
                                        <Typography variant="caption" display="block" sx={{ mt: 0.75, fontWeight: 600 }}>
                                            {passStartLabel || 'Timing unavailable'}
                                        </Typography>
                                        {passEndLabel && (
                                            <Typography variant="caption" display="block" color="text.secondary" sx={{ mt: 0.25 }}>
                                                to {passEndLabel}
                                                {' · '}{formatDuration(hoveredObservation.pass?.event_start, hoveredObservation.pass?.event_end)}
                                            </Typography>
                                        )}
                                    </Box>
                                    {hasPeakElevation && (
                                        <Box
                                            sx={{
                                                minWidth: 88,
                                                px: 1.25,
                                                py: 1,
                                                borderRadius: 1.5,
                                                bgcolor: 'action.hover',
                                                textAlign: 'right',
                                            }}
                                        >
                                            <Typography variant="caption" color="text.secondary" display="block">
                                                {t('observations_timeline_svg.peak_elevation', { defaultValue: 'Peak elevation' })}
                                            </Typography>
                                            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2, color: 'text.primary' }}>
                                                {peakElevation.toFixed(1)}°
                                            </Typography>
                                        </Box>
                                    )}
                                </Stack>
                            </Box>

                            {hoveredTasks.length > 0 && (
                                <>
                                    <Divider />
                                    <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ px: 2, py: 1.25 }}>
                                        {hoveredTasks.map((task, idx) => (
                                            <Chip
                                                key={idx}
                                                label={
                                                    task.type === 'decoder' ? (
                                                        task.config?.decoder_type === 'lora' ? 'LoRa' :
                                                        task.config?.decoder_type === 'none' ? 'No Decoder' :
                                                        task.config?.decoder_type?.toUpperCase() || 'Decoder'
                                                    ) :
                                                    task.type === 'audio_recording' ? 'Audio' :
                                                    task.type === 'transcription' ? 'Transcription' :
                                                    'IQ'
                                                }
                                                size="small"
                                                variant="outlined"
                                                sx={{ height: 24, fontSize: '0.7rem' }}
                                            />
                                        ))}
                                    </Stack>
                                </>
                            )}
                        </Box>
                    )}
                </Box>
        </Box>
    );
};

export default ObservationsTimeline;
