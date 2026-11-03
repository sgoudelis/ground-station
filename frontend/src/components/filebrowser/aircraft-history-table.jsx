/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {Fragment, useId, useState} from 'react';
import {Box, IconButton, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography} from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import {alpha} from '@mui/material/styles';
import {useTranslation} from 'react-i18next';
import {aircraftLabel, aircraftValue} from '../../utils/aircraft-metadata.js';
import {formatDateTime} from '../../utils/date-time.js';
import AircraftUpdateDetails from './aircraft-update-details.jsx';

const columns = [206, 96, 140, 106, 80, 178, 106, 80, 130];
const columnTotal = columns.reduce((total, width) => total + width, 0);
const identifierSx = {fontFamily: 'monospace', letterSpacing: '0.015em'};

function ColumnHeading({label, detail}) {
    return <>
        <Box component="span" sx={{display: 'block', fontWeight: 600, lineHeight: 1.4}}>{label}</Box>
        {detail && <Typography component="span" variant="caption" sx={{display: 'block', mt: 0.25, fontSize: '0.68rem', color: 'text.secondary'}}>
            {detail}
        </Typography>}
    </>;
}

export default function AircraftHistoryTable({records, selected, onSelect, timeSettings}) {
    const {t} = useTranslation('filebrowser');
    const {t: aircraftT} = useTranslation('common');
    const timezone = timeSettings.timezone || 'UTC';
    const tableId = useId();
    // Records have no server ID. Object keys preserve the open disclosure as live rows arrive.
    const [recordKey] = useState(() => {
        const keys = new WeakMap();
        let next = 0;
        return (record) => {
            if (!keys.has(record)) keys.set(record, next++);
            return keys.get(record);
        };
    });
    // Keep an inspected snapshot visible even after it leaves the rolling history window.
    const displayedRecords = selected && !records.includes(selected) ? [selected, ...records] : records;
    const altitudeFormat = new Intl.NumberFormat(timeSettings.locale, {maximumFractionDigits: 0});
    const speedFormat = new Intl.NumberFormat(timeSettings.locale, {minimumFractionDigits: 1, maximumFractionDigits: 1});
    // Reserve the vertical scrollbar gutter so container units use the available width.
    return <TableContainer sx={{maxHeight: 480, scrollbarWidth: 'thin', scrollbarGutter: 'stable', containerType: 'inline-size'}}>
        <Table stickyHeader size="small" aria-label={t('adsb.history', 'Aircraft history')} sx={(theme) => ({
            minWidth: 1080, tableLayout: 'fixed',
            '& th, & td': {px: 1.5, borderColor: 'divider'},
            '& th:first-of-type, & td:first-of-type': {pl: 2.5},
            '& th:last-of-type, & td:last-of-type': {pr: 2.5},
            '& th': {
                py: 1.25, fontSize: '0.75rem', color: 'text.secondary', verticalAlign: 'top',
                bgcolor: theme.palette.background.elevated || theme.palette.background.default,
            },
            '& td': {py: 1.25, fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums', lineHeight: 1.5},
            '& tbody td:first-of-type': {fontSize: '0.76rem'},
            '& .history-empty td': {py: 5, textAlign: 'center', color: 'text.secondary'},
            '& .history-details > td': {p: 0, whiteSpace: 'normal'},
            '& tbody tr': {transition: theme.transitions.create('background-color', {duration: 120})},
            '& tbody tr.MuiTableRow-hover': {cursor: 'pointer'},
            '& .history-striped': {bgcolor: alpha(theme.palette.text.primary, 0.018)},
            '& tbody tr.MuiTableRow-hover:hover': {bgcolor: 'action.hover'},
            '& tbody tr.Mui-selected': {
                bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.14 : 0.08),
                '& td:first-of-type': {boxShadow: `inset 3px 0 0 ${theme.palette.primary.main}`},
                '&:hover': {bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.2 : 0.12)},
            },
            '& tbody tr:focus-visible': {outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2},
            '& tbody tr:last-of-type td': {borderBottom: 0},
        })}>
            <colgroup>{columns.map((width, index) => <col key={index} style={{width: `${width / columnTotal * 100}%`}} />)}</colgroup>
            <TableHead><TableRow>
                <TableCell aria-label={t('adsb.received_at', 'Received at ({{timezone}})', {timezone})}>
                    <ColumnHeading label={t('adsb.received_heading', 'Received at')} detail={timezone} />
                </TableCell>
                <TableCell><ColumnHeading label={t('adsb.callsign', 'Callsign')} /></TableCell>
                <TableCell align="right" aria-label={t('adsb.barometric_altitude', 'Barometric altitude (m)')}>
                    <ColumnHeading label={t('adsb.altitude_heading', 'Barometric altitude')} detail="m" />
                </TableCell>
                <TableCell align="right" aria-label={t('adsb.ground_speed', 'Ground speed (m/s)')}>
                    <ColumnHeading label={t('adsb.speed_heading', 'Ground speed')} detail="m/s" />
                </TableCell>
                <TableCell><ColumnHeading label={t('adsb.squawk', 'Squawk')} /></TableCell>
                <TableCell aria-label={t('adsb.coordinates', 'Coordinates (lat, lon)')}>
                    <ColumnHeading label={t('adsb.coordinates_heading', 'Coordinates')} detail={t('adsb.coordinate_order', 'Latitude, longitude')} />
                </TableCell>
                <TableCell><ColumnHeading label={aircraftLabel('registration', aircraftT)} /></TableCell>
                <TableCell><ColumnHeading label={t('adsb.type_code', 'Type code')} /></TableCell>
                <TableCell><ColumnHeading label={aircraftLabel('classification', aircraftT)} /></TableCell>
            </TableRow></TableHead>
            <TableBody>{[...displayedRecords].reverse().map((record, index) => {
                const key = recordKey(record);
                const detailsId = `${tableId}-update-${key}`;
                const buttonId = `${detailsId}-toggle`;
                const expanded = selected === record;
                const classification = aircraftValue(record.aircraft, 'classification', aircraftT);
                // Keep coordinates consistent in the table; the raw update retains full precision.
                const position = Number.isFinite(record.latitude) && Number.isFinite(record.longitude)
                    ? `${record.latitude.toFixed(6)}, ${record.longitude.toFixed(6)}` : '—';
                const received = record.captured_at ? formatDateTime(record.captured_at, timeSettings) || '—' : '—';
                return <Fragment key={key}><TableRow hover className={index % 2 ? 'history-striped' : undefined}
                    selected={expanded} aria-selected={expanded} aria-expanded={expanded} aria-controls={expanded ? detailsId : undefined} tabIndex={0}
                    onClick={() => onSelect(record)} onKeyDown={(event) => {
                        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {event.preventDefault(); onSelect(record);}
                    }}>
                    <TableCell title={received} sx={{whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                        <Box sx={{display: 'flex', alignItems: 'center', gap: 0.5}}>
                            <IconButton id={buttonId} size="small" aria-expanded={expanded} aria-controls={expanded ? detailsId : undefined}
                                aria-label={t('adsb.toggle_update', 'Toggle update details for {{date}} ({{timezone}})', {date: received, timezone})}
                                onClick={(event) => {event.stopPropagation(); onSelect(record);}} sx={{ml: -0.75, flexShrink: 0}}>
                                <KeyboardArrowDownIcon fontSize="small" sx={{transform: expanded ? 'rotate(180deg)' : 'none'}} />
                            </IconButton>
                            <Box component="span" sx={{overflow: 'hidden', textOverflow: 'ellipsis'}}>{received}</Box>
                        </Box>
                    </TableCell>
                    <TableCell sx={{...identifierSx, fontWeight: 600, color: record.callsign ? 'primary.main' : 'text.secondary'}}>
                        <Box component="span" title={record.callsign || undefined} sx={{display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>
                            {record.callsign || '—'}
                        </Box>
                    </TableCell>
                    <TableCell align="right">{record.on_ground ? <Typography component="span" variant="caption" color="text.secondary">
                        {t('adsb.on_ground', 'On ground')}
                    </Typography> : record.altitude_baro_m == null ? '—' : altitudeFormat.format(Math.round(record.altitude_baro_m))}</TableCell>
                    <TableCell align="right">{record.groundspeed_mps == null ? '—' : speedFormat.format(record.groundspeed_mps)}</TableCell>
                    <TableCell sx={identifierSx}>{record.squawk ? <Box component="span" sx={{
                        display: 'inline-block', px: 0.75, py: 0.125, border: '1px solid', borderColor: 'divider', borderRadius: 0.75,
                    }}>{record.squawk}</Box> : '—'}</TableCell>
                    <TableCell sx={{...identifierSx, color: 'text.secondary'}}>
                        <Box component="span" title={position} sx={{display: 'block', fontSize: '0.75rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                            {position}
                        </Box>
                    </TableCell>
                    <TableCell sx={{...identifierSx, whiteSpace: 'nowrap'}}>{aircraftValue(record.aircraft, 'registration', aircraftT)}</TableCell>
                    <TableCell sx={identifierSx}>{aircraftValue(record.aircraft, 'type_code', aircraftT)}</TableCell>
                    <TableCell>
                        <Typography variant="body2" noWrap title={classification} sx={{fontSize: '0.78rem', color: 'text.secondary'}}>
                            {classification}
                        </Typography>
                    </TableCell>
                </TableRow>
                {expanded && <TableRow className="history-details">
                    <TableCell colSpan={columns.length}>
                        {/* Match the scrollport width so details remain readable while columns scroll. */}
                        <Box sx={(theme) => ({position: 'sticky', left: 0, width: '100cqi', maxWidth: '100%', boxSizing: 'border-box',
                            bgcolor: alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.06 : 0.025),
                            borderLeft: '3px solid', borderLeftColor: 'primary.main'})}>
                            <AircraftUpdateDetails record={record} timeSettings={timeSettings} id={detailsId} onClose={() => {
                                onSelect(record);
                                document.getElementById(buttonId)?.focus({preventScroll: true});
                            }} />
                        </Box>
                    </TableCell>
                </TableRow>}
                </Fragment>;
            })}
            {!displayedRecords.length && <TableRow className="history-empty">
                <TableCell colSpan={columns.length}>
                    {t('adsb.no_updates', 'No recorded updates to display.')}
                </TableCell>
            </TableRow>}
            </TableBody>
        </Table>
    </TableContainer>;
}
