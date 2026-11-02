/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useId, useState} from 'react';
import {Box, Button, Tooltip} from '@mui/material';
import {lighten} from '@mui/material/styles';
import {useTranslation} from 'react-i18next';
import {aircraftUnitsStoreName, readStored, writeStored} from './storage.js';
import './flight-instruments.css';

const polar = (angle, radius, cy = 74) => ({
    x: 75 + Math.cos(angle * Math.PI / 180) * radius,
    y: cy + Math.sin(angle * Math.PI / 180) * radius,
});

function Tick({angle, inner, outer, major = false, cy = 74}) {
    const start = polar(angle, inner, cy);
    const end = polar(angle, outer, cy);
    return <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} className={major ? 'flight-axis' : 'flight-tick'} />;
}

function ArcGauge({fraction, labels}) {
    return <svg viewBox="0 0 150 120" aria-hidden="true" focusable="false">
        <path d="M 22.38 93.15 A 56 56 0 1 1 127.62 93.15" className="flight-arc" />
        {Array.from({length: 25}, (_, index) => <Tick key={index} angle={160 + index * 220 / 24}
            inner={index % 4 === 0 ? 46 : 51} outer={56} major={index % 4 === 0} />)}
        {labels.map((label, index) => {
            const point = polar(160 + index * 220 / (labels.length - 1), 66);
            return <text key={index} x={point.x} y={point.y + 3} textAnchor="middle" className="flight-mark">{label}</text>;
        })}
        {/* The scale is a reference, not an aircraft-specific operating limit. */}
        {fraction !== null && <g className="flight-pointer">
            <Tick angle={160 + Math.max(0, Math.min(1, fraction)) * 220} inner={43} outer={56} />
        </g>}
    </svg>;
}

function AltitudeTape({altitude, metric, format}) {
    const step = metric ? 500 : 1000;
    const center = altitude === null ? null : Math.round(altitude / step) * step;
    return <svg viewBox="0 0 150 120" aria-hidden="true" focusable="false">
        <rect x="105" y="12" width="38" height="100" rx="3" className="flight-tape" />
        {center !== null && Array.from({length: 5}, (_, index) => {
            const value = center + (2 - index) * step;
            // Shift the ticks continuously so the pointer denotes the actual altitude.
            const y = 62 + (altitude - value) / step * 22;
            return <g key={index}>
                <line x1="106" x2="112" y1={y} y2={y} className="flight-axis" />
                <text x="139" y={y + 3} textAnchor="end" className="flight-mark">{format(value / 1000, metric ? 1 : 0)}k</text>
            </g>;
        })}
        {center !== null && <path d="M 101 62 L 107 58 L 107 66 Z" className="flight-accent-fill" />}
    </svg>;
}

function TrackCompass({track}) {
    const pointer = track === null ? null : polar(track - 90, 39, 63);
    return <svg viewBox="0 0 150 120" aria-hidden="true" focusable="false">
        {Array.from({length: 36}, (_, index) => <Tick key={index} angle={index * 10 - 90}
            inner={index % 9 === 0 ? 39 : 43} outer={47} major={index % 9 === 0} cy={63} />)}
        {['N', 'E', 'S', 'W'].map((direction, index) => {
            // Keep cardinal labels inside the rose, clear of the digital track below.
            const point = polar(index * 90 - 90, 32, 63);
            return <text key={direction} x={point.x} y={point.y + 3} textAnchor="middle" className="flight-mark">{direction}</text>;
        })}
        {pointer && <g className="flight-compass-pointer">
            <line x1="75" y1="63" x2={pointer.x} y2={pointer.y} />
            <circle cx="75" cy="63" r="3" />
        </g>}
    </svg>;
}

function Instrument({label, value, unit, note, variant = '', children}) {
    const titleId = useId();
    return <Box component="section" aria-labelledby={titleId} className={`flight-instrument ${variant}`}>
        <h3 id={titleId} className="flight-instrument-label">{label}</h3>
        <div className="flight-face">
            {children}
            <div className="flight-digital"><span className="flight-value">{value}</span>
                {unit && <span className="flight-unit">{unit}</span>}
            </div>
        </div>
        <div className="flight-annotation">{note}</div>
    </Box>;
}

export default function FlightInstruments({flight, locale, formatTime}) {
    const {t} = useTranslation('navigation');
    const label = (key, fallback, options = {}) => t(`packet_map.flight.${key}`, {defaultValue: fallback, ...options});
    const [units, setUnits] = useState(() => readStored(aircraftUnitsStoreName) === 'metric' ? 'metric' : 'aviation');
    const metric = units === 'metric';
    const format = (value, digits = 0) => Number.isFinite(value)
        ? value.toLocaleString(locale, {minimumFractionDigits: digits, maximumFractionDigits: digits}) : '—';
    const speed = flight.groundSpeed === null ? null : flight.groundSpeed * (metric ? 1 : 1 / 0.5144444444);
    const altitude = flight.altitude === null ? null : flight.altitude * (metric ? 1 : 1 / 0.3048);
    const vertical = flight.verticalSpeed === null ? null : flight.verticalSpeed * (metric ? 1 : 1 / 0.00508);
    // Expand reference scales for fast aircraft and large rates without clipping the readout.
    const speedStep = metric ? 50 : 100;
    const speedMax = Math.max(metric ? 300 : 600, Math.ceil((speed ?? 0) / (speedStep * 6)) * speedStep * 6);
    const verticalStep = metric ? 5 : 1000;
    const verticalMax = Math.max(metric ? 15 : 3000, Math.ceil(Math.abs(vertical ?? 0) / (verticalStep * 3)) * verticalStep * 3);
    const phase = flight.onGround ? label('ground', 'On ground') : flight.phase === 'climb' ? label('climbing', 'Climbing')
        : flight.phase === 'descent' ? label('descending', 'Descending') : flight.phase === 'level' ? label('level', 'Level flight')
            : label('unknown', 'Flight state unavailable');
    const direction = flight.track === null ? null : ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(flight.track / 45) % 8];
    const ageValue = flight.age === null ? null : flight.age < 60 ? `${format(flight.age)}s`
        : flight.age < 3600 ? `${format(Math.floor(flight.age / 60))}m` : `${format(Math.floor(flight.age / 3600))}h`;
    const ageLabel = ageValue === null ? label('time_unknown', 'Reception time unavailable')
        : flight.historical ? label('sample_age', 'Sample age: {{age}}', {age: ageValue})
            : label('received_age', 'Received {{age}} ago', {age: ageValue});
    const altitudeLabel = flight.onGround ? label('altitude', 'Altitude') : flight.altitudeSource === 'barometric'
        ? label('barometric_altitude', 'Baro altitude') : flight.altitudeSource === 'geometric'
            ? label('geometric_altitude', 'Geometric altitude') : label('altitude', 'Altitude');
    const altitudeNote = flight.onGround ? label('ground_reported', 'Ground status · reported') : flight.altitude === null
        ? label('no_altitude', 'No altitude reported') : flight.altitudeSource === 'barometric'
            ? label('pressure_reported', 'Pressure altitude · reported') : flight.altitudeSource === 'geometric'
                ? label('geometric_reported', 'Geometric altitude · reported') : label('source_unknown', 'Altitude source unspecified');
    const toggleUnits = () => {
        const next = metric ? 'aviation' : 'metric';
        setUnits(next);
        writeStored(aircraftUnitsStoreName, next);
    };

    return <Box component="section" aria-label={label('instruments', 'Flight instruments')}
        className={`aircraft-flight-panel${flight.stale ? ' flight-stale' : ''}`}
        sx={(theme) => ({
            '--flight-text': theme.palette.text.primary,
            '--flight-muted': theme.palette.text.secondary,
            '--flight-line': theme.palette.divider,
            '--flight-surface': theme.palette.mode === 'dark'
                ? lighten(theme.palette.background.paper, 0.05) : theme.palette.background.paper,
            '--flight-accent': flight.stale ? theme.palette.text.secondary
                : theme.palette.mode === 'dark' ? '#7dd3fc' : '#006d94',
            '--flight-status': flight.stale ? theme.palette.warning.main
                : flight.phase === 'unknown' ? theme.palette.text.secondary : theme.palette.success.main,
        })}>
        <div className="flight-status-row">
            <span className="flight-state"><span className="flight-state-dot" aria-hidden="true" />
                {flight.stale ? label('stale', 'Stale · last known') : phase}
            </span>
            <Tooltip title={label(metric ? 'use_aviation' : 'use_metric', metric ? 'Use aviation units' : 'Use metric units')}>
                <Button size="small" onClick={toggleUnits}
                    aria-label={label(metric ? 'use_aviation' : 'use_metric', metric ? 'Use aviation units' : 'Use metric units')}
                    sx={{fontSize: '0.6rem', minWidth: 0, p: '2px 6px', color: 'text.secondary', flexShrink: 0}}>
                    {metric ? 'M/S · M' : 'KT · FT'}
                </Button>
            </Tooltip>
        </div>
        <div className="flight-age" title={Number.isFinite(flight.receivedAt) ? formatTime(new Date(flight.receivedAt).toISOString()) : undefined}>
            {flight.historical && <span>{label('recorded', 'Recorded')} · </span>}{ageLabel}
        </div>
        <div className="flight-grid">
            <Instrument label={label('ground_speed', 'Ground speed')} value={format(speed, metric ? 1 : 0)} unit={metric ? 'm/s' : 'kt'}
                note={flight.groundSpeed === null ? label('no_speed', 'No ground speed reported') : label('ground_speed_note', 'GS · over the ground')}>
                <ArcGauge fraction={speed === null ? null : speed / speedMax}
                    labels={Array.from({length: 7}, (_, index) => format(index * speedMax / 6))} />
            </Instrument>
            <Instrument label={altitudeLabel} value={flight.onGround ? 'GND' : format(altitude)} unit={flight.onGround ? '' : metric ? 'm' : 'ft'}
                note={altitudeNote} variant="flight-altitude">
                <AltitudeTape altitude={flight.onGround ? null : altitude} metric={metric} format={format} />
            </Instrument>
            <Instrument label={label('ground_track', 'Ground track')}
                value={flight.track === null ? '—' : `${format(Math.round(flight.track) % 360).padStart(3, '0')}°`}
                note={direction ? `${label('true', 'TRUE')} · ${direction}` : label('no_track', 'No track reported')} variant="flight-track">
                <TrackCompass track={flight.track} />
            </Instrument>
            <Instrument label={label('vertical_speed', 'Vertical speed')}
                value={vertical === null ? '—' : `${vertical > 0 ? '+' : ''}${format(vertical, metric ? 1 : 0)}`}
                unit={metric ? 'm/s' : 'ft/min'} note={flight.verticalSpeed === null ? label('no_vertical_speed', 'No vertical rate reported')
                    : flight.phase === 'climb' ? `↑ ${label('climb', 'Climb')}` : flight.phase === 'descent' ? `↓ ${label('descent', 'Descent')}`
                        : flight.onGround ? label('ground', 'On ground') : label('level', 'Level flight')}>
                <ArcGauge fraction={vertical === null ? null : (vertical + verticalMax) / (2 * verticalMax)}
                    labels={Array.from({length: 7}, (_, index) => {
                        const value = (index - 3) * verticalMax / 3;
                        return `${value > 0 ? '+' : ''}${format(metric ? value : value / 1000)}${metric || value === 0 ? '' : 'k'}`;
                    })} />
            </Instrument>
        </div>
        <dl className="flight-secondary">
            <div><dt>{label('squawk', 'Squawk')}</dt><dd>{flight.squawk ?? '—'}</dd></div>
            {flight.geometric !== null && (flight.onGround || flight.altitudeSource === 'barometric') && <div>
                <dt>{label('geometric_altitude', 'Geometric altitude')}</dt>
                <dd>{format(flight.geometric * (metric ? 1 : 1 / 0.3048))} {metric ? 'm' : 'ft'}</dd>
            </div>}
        </dl>
    </Box>;
}
