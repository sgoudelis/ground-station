/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {createContext, useContext, useId, useMemo} from 'react';
import {Box, Chip, Typography} from '@mui/material';
import {alpha} from '@mui/material/styles';
import SensorsIcon from '@mui/icons-material/Sensors';
import {useTranslation} from 'react-i18next';
import {typeColor, typeLabel} from './transmitters.js';
import {aircraftColor, aircraftEmergency, aircraftEmergencyLabel} from '../../utils/aircraft-emergency.js';
import {renderAircraftSymbol, selectAircraftShape} from './aircraft-symbol.js';
import {getAprsSymbol} from './aprs-marker.js';
import AircraftFlag from '../common/aircraft-flag.jsx';
import {aircraftValue} from '../../utils/aircraft-metadata.js';
import balloon from './icons/balloon.png';
import parachute from './icons/parachute.png';
import meshtasticPin from './icons/meshtastic.png';

export const PlaybackTimeContext = createContext(0);
const metricPriorities = {primary: 0, secondary: 1, wide: 2, comment: 3};

const iconSx = {width: 32, height: 32, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
    '& > svg, & > img': {width: 30, height: 30, display: 'block', objectFit: 'contain'},
    '& > .transmitter-meshtastic-pin': {filter: 'drop-shadow(0 0 2px rgb(0 0 0 / 56%)) drop-shadow(0 2px 4px rgb(0 0 0 / 45.5%))'},
    '@container (max-width: 650px)': {width: 24, height: 24, '& > svg, & > img': {width: 24, height: 24}}};

const AircraftSymbol = React.memo(function AircraftSymbol({name, scale, squawk, emergency, capturedAt}) {
    // Only mounted aircraft icons subscribe to playback ageing. The list models,
    // sorting and telemetry text remain stable when the cursor moves.
    const cursor = useContext(PlaybackTimeContext);
    const status = useMemo(() => aircraftEmergency({squawk, emergency}), [squawk, emergency]);
    const color = aircraftColor(status, cursor - Date.parse(capturedAt) > 60000);
    const symbol = useMemo(() => renderAircraftSymbol({name, scale}, {angle: 315, color}), [name, scale, color]);
    return <Box component="span" aria-hidden="true" sx={iconSx} dangerouslySetInnerHTML={{__html: symbol}} />;
});

function ProtocolIcon({row}) {
    const shape = useMemo(() => row.kind === 'adsb' ? selectAircraftShape({
        type_code: row.model, type_description: row.type_description, aircraft_class: row.aircraft_class,
        engine_count: row.engine_count, engine_type: row.engine_type, category: row.category, wake_category: row.wake_category,
    }) : null, [row.kind, row.model, row.type_description, row.aircraft_class, row.engine_count,
        row.engine_type, row.category, row.wake_category]);
    if (shape) return <AircraftSymbol name={shape.name} scale={shape.scale}
        squawk={row.squawk} emergency={row.emergency} capturedAt={row.captured_at} />;
    const symbol = row.kind === 'aprs' ? getAprsSymbol(row) : null;
    const image = row.kind === 'meshtastic' ? meshtasticPin
        : row.kind === 'radiosonde' || symbol?.balloon ? row.vertical < -0.3 ? parachute : balloon : symbol?.image;
    return <Box component="span" aria-hidden="true" sx={{...iconSx, color: typeColor(row.kind)}}>
        {image ? <img src={image} alt="" draggable={false} className={row.kind === 'meshtastic' ? 'transmitter-meshtastic-pin' : undefined} />
            : <SensorsIcon />}
    </Box>;
}

// Priorities control CSS visibility without resize handlers or variable row heights.
function telemetryFields(row, number, t) {
    const label = (key, fallback) => t(`packet_map.list.${key}`, fallback);
    const fields = [];
    const add = (value, name, unit = '', digits = 0, priority = 'primary', placement = 'detail') => {
        if (Number.isFinite(value)) fields.push({label: name, value: `${number(value, digits)}${unit ? ` ${unit}` : ''}`, priority, placement});
    };
    const addText = (value, name, priority = 'secondary', placement = 'detail') => {
        if (value) fields.push({label: name, value, priority, placement});
    };
    add(row.altitude, label('altitude', 'Alt'), 'm');
    if (row.kind === 'adsb') {
        add(row.speed === null ? null : row.speed / 0.5144444444, label('speed', 'Speed'), 'kt');
        add(row.vertical, label('vertical_rate', 'V/S'), 'm/s', 1);
        add(row.heading, label('heading', 'Heading'), '°', 0, 'secondary');
        if (row.on_ground) addText(t('packet_map.flight.ground', 'On ground'), '', 'primary');
        if (row.squawk !== null && row.squawk !== '') addText(String(row.squawk).padStart(4, '0'), t('packet_map.flight.squawk', 'Squawk'));
        if (row.barometric !== row.altitude) add(row.barometric, label('barometric', 'Baro'), 'm', 0, 'wide');
        if (row.geometric !== row.altitude) add(row.geometric, label('geometric', 'Geom'), 'm', 0, 'wide');
        if (row.geometricVertical !== row.vertical) add(row.geometricVertical, label('geom_vertical_rate', 'Geom V/S'), 'm/s', 1, 'wide');
        add(row.airspeed, 'TAS', 'kt', 0, 'secondary');
        add(row.indicatedSpeed, 'IAS', 'kt', 0, 'secondary');
        add(row.mach, 'Mach', '', 2, 'secondary');
        // Navigation/environment details use spare header space on wide lists.
        add(row.targetAltitude, label('target_altitude', 'Target alt'), 'ft', 0, 'wide', 'header');
        add(row.qnh, 'QNH', 'hPa', 1, 'wide', 'header');
        addText(row.navigationModes, label('navigation_modes', 'Modes'), 'wide', 'header');
        add(row.windSpeed, label('wind', 'Wind'), 'kt', 0, 'wide', 'header');
        add(row.outsideTemperature, 'OAT', '°C', 1, 'wide', 'header');
        add(row.selectedHeading, label('selected_heading', 'Selected hdg'), '°', 0, 'wide', 'header');
        add(row.magneticHeading, label('magnetic_heading', 'Mag hdg'), '°', 0, 'wide');
        add(row.trueHeading, label('true_heading', 'True hdg'), '°', 0, 'wide');
        add(row.roll, label('roll', 'Roll'), '°', 1, 'wide');
        add(row.trackRate, label('track_rate', 'Turn rate'), '°/s', 1, 'wide');
        add(row.windHeading, label('wind_direction', 'Wind direction'), '°', 0, 'wide', 'header');
        add(row.totalTemperature, 'TAT', '°C', 1, 'wide', 'header');
    } else if (row.kind === 'radiosonde') {
        add(row.vertical, label('vertical_rate', 'V/S'), 'm/s', 1);
        add(row.temperature, label('temperature', 'Temp'), '°C', 1);
        add(row.speed, label('speed', 'Speed'), 'm/s', 1, 'secondary');
        add(row.humidity, label('humidity', 'RH'), '%', 1, 'secondary');
        add(row.pressure, label('pressure', 'Pressure'), 'hPa', 1, 'secondary');
        add(row.battery, label('battery', 'Battery'), 'V', 2, 'secondary');
        add(row.satellites, label('satellites', 'GPS'), label('satellite_unit', 'sats'), 0, 'secondary');
        add(row.heading, label('heading', 'Heading'), '°', 0, 'secondary');
        add(row.transmitFrequency === null ? null : row.transmitFrequency / 1000,
            label('transmit_frequency', 'TX'), 'MHz', 3, 'secondary');
        add(row.burstTimer, label('burst_timer', 'Burst timer'), 's', 0, 'wide');
        add(row.frameNumber, label('frame', 'Frame'), '', 0, 'wide');
        add(row.gpsMslDifference, label('gps_msl_difference', 'GPS − MSL'), 'm', 1, 'wide');
    } else if (row.kind === 'meshtastic') {
        add(row.satellites, label('satellites', 'GPS'), label('satellite_unit', 'sats'));
        add(row.hop_limit, label('hop_limit', 'Hop limit'));
        addText(row.channel, label('channel', 'Channel'));
        addText(row.destination, label('destination', 'To'));
        add(row.hop_start, label('hop_start', 'Initial hops'), '', 0, 'wide');
        addText(row.relay, label('relay', 'Relay'), 'wide');
        addText(row.nextHop, label('next_hop', 'Next hop'), 'wide');
        add(row.hdop, 'HDOP', '', 2, 'secondary');
        add(row.precision, label('precision', 'Precision'), 'bits', 0, 'wide');
        add(row.speed, label('speed', 'Speed'), 'km/h', 1, 'secondary');
        add(row.heading, label('heading', 'Heading'), '°', 0, 'secondary');
        add(row.batteryLevel, label('battery', 'Battery'), '%', 0, 'secondary');
        add(row.battery, label('voltage', 'Voltage'), 'V', 2, 'wide');
        addText(row.encryption, label('encryption', 'Encryption'), 'wide');
        if (row.viaMqtt) addText('MQTT', label('via', 'Via'));
        addText(row.packetId, label('packet_id', 'Packet ID'), 'wide');
    } else if (row.kind === 'aprs') {
        add(row.speed, label('speed', 'Speed'), 'kt', 1);
        add(row.heading, label('heading', 'Heading'), '°');
        add(row.temperature, label('temperature', 'Temp'), '°C', 1);
        add(row.humidity, label('humidity', 'RH'), '%', 1, 'secondary');
        add(row.pressure, label('pressure', 'Pressure'), 'hPa', 1, 'wide');
        add(row.wind, label('wind', 'Wind'), 'mph', 0, 'secondary');
        add(row.windGust, label('gust', 'Gust'), 'mph', 0, 'wide');
        add(row.windDirection, label('wind_direction', 'Wind direction'), '°', 0, 'wide');
        addText(row.path, label('path', 'Path'), 'wide');
    }
    add(row.frequency === null ? null : row.frequency / 1e6, label('frequency', 'RF'), 'MHz', 3, 'secondary');
    add(row.bandwidth === null ? null : row.bandwidth / 1e3, label('bandwidth', 'BW'), 'kHz', 1, 'wide');
    add(row.power, label('power', 'Power'), 'dBFS', 1, 'secondary');
    add(row.rssi, 'RSSI', 'dBm', 1, 'secondary');
    add(row.snr, 'SNR', 'dB', 1, 'secondary');
    if (Number.isFinite(row.latitude) && Number.isFinite(row.longitude)) {
        addText(`${number(row.latitude, 4)}°, ${number(row.longitude, 4)}°`, '', 'wide');
    }
    if (row.kind === 'aprs') addText(row.comment, '', 'comment');
    // Keep reception and core telemetry ahead of optional details when space runs out.
    return fields.sort((left, right) => metricPriorities[left.priority] - metricPriorities[right.priority]);
}

const TransmitterListRow = React.memo(function TransmitterListRow({row, selected, focused, hidden, index,
    onSelect, onFocusRow, numberFormatters, timeFormatter, clockFormatter}) {
    const {t} = useTranslation('navigation');
    const {t: aircraftT} = useTranslation('common');
    const descriptionId = useId();
    const flightId = `${descriptionId}-flight`;
    const status = useMemo(() => row.kind === 'adsb' ? aircraftEmergency(row) : null, [row.kind, row.squawk, row.emergency]);
    const number = (value, digits = 0) => numberFormatters[digits].format(value);
    // Formatting happens only for the viewport and its small overscan buffer.
    const {fields, headerFields, details} = useMemo(() => {
        const all = telemetryFields(row, number, t);
        return {fields: all.filter((field) => field.placement !== 'header'),
            headerFields: all.filter((field) => field.placement === 'header'),
            details: all.map(({label, value}) => [label, value].filter(Boolean).join(' ')).join('  ·  ')};
    }, [row, numberFormatters, t]);
    const classification = row.kind === 'adsb' && (row.category || row.aircraft_class || row.military_status === 'military' || row.interesting)
        ? aircraftValue(row, 'classification', aircraftT) : '';
    // Phase is derived from the latest reported rate, so it needs no clock subscription.
    const phase = row.kind === 'adsb' || row.kind === 'radiosonde'
        ? row.on_ground ? t('packet_map.flight.ground', 'On ground')
            : Number.isFinite(row.vertical) ? row.vertical > 0.5 ? t('packet_map.flight.climbing', 'Climbing')
                : row.vertical < -0.5 ? t('packet_map.flight.descending', 'Descending')
                    : t('packet_map.flight.level', 'Level flight') : '' : '';
    const sondeStamp = row.sondeTime ? new Date(row.sondeTime) : null;
    const sondeTime = sondeStamp && Number.isFinite(sondeStamp.getTime()) ? clockFormatter.format(sondeStamp) : '';
    const aircraftDetails = row.kind === 'adsb' ? [
        Number.isFinite(row.engine_count) ? `${t('packet_map.list.engines', 'Engines')} ${number(row.engine_count)}${row.engine_type ? ` ${aircraftValue(row, 'engine_type', aircraftT)}` : ''}` : '',
        row.wake_category ? `${t('packet_map.list.wake', 'Wake')} ${aircraftValue(row, 'wake_category', aircraftT)}` : '',
        row.year ? `${t('packet_map.list.built', 'Built')} ${row.year}` : '',
    ] : [];
    const sondeDetails = row.kind === 'radiosonde' ? [
        row.sondeType !== row.sondeModel ? row.sondeType : '',
        sondeTime ? `${t('packet_map.list.sonde_time', 'Sonde time')} ${sondeTime}` : '',
        row.altitudeReference ? `${t('packet_map.list.altitude_reference', 'Alt ref')} ${row.altitudeReference}` : '',
        row.sondeAprsId && row.sondeAprsId !== row.name ? `APRS ${row.sondeAprsId}` : '',
        row.rawSerial && row.rawSerial !== row.name ? `${t('packet_map.list.serial', 'Serial')} ${row.rawSerial}` : '',
    ] : [];
    const metadata = [
        row.source && row.source !== row.name ? `${row.kind === 'adsb' ? 'ICAO ' : ''}${row.source}` : '',
        row.registration, row.model || row.sondeModel, row.operator, row.nodeName, phase,
        row.fullModel, classification, row.owner && row.owner !== row.operator ? row.owner : '',
        row.operatorCallsign ? `${t('packet_map.list.operator_callsign', 'Radio')} ${row.operatorCallsign}` : '', row.operatorCountry,
        ...aircraftDetails, ...sondeDetails,
        row.kind === 'aprs' ? getAprsSymbol(row)?.label : '',
    ].filter(Boolean).join(' · ');
    const reception = [row.decoder, row.vfo !== null ? `VFO ${number(row.vfo)}` : '', row.satellite].filter(Boolean).join(' · ');
    const firstStamp = row.first_seen ? new Date(row.first_seen) : null;
    const firstSeen = firstStamp && Number.isFinite(firstStamp.getTime()) ? timeFormatter.format(firstStamp) : '';
    const stamp = row.last_seen ? new Date(row.last_seen) : null;
    const lastSeen = stamp && Number.isFinite(stamp.getTime()) ? timeFormatter.format(stamp) : '—';
    return <Box component="button" type="button" data-id={row.id} data-index={index}
        className={[hidden ? 'transmitter-hidden' : '', status ? `transmitter-emergency-${status.severity}` : ''].filter(Boolean).join(' ')}
        aria-label={row.name} aria-describedby={headerFields.length ? `${descriptionId} ${flightId}` : descriptionId}
        aria-pressed={selected} tabIndex={focused ? 0 : -1}
        onFocus={() => onFocusRow(row.id)} onClick={() => onSelect(row.id)}
        sx={(theme) => ({width: '100%', height: '100%', boxSizing: 'border-box', border: 0,
            borderBottom: `1px solid ${theme.palette.divider}`, borderLeft: '3px solid',
            borderLeftColor: row.kind === 'meshtastic' ? alpha(typeColor(row.kind), selected ? 1 : 0.45)
                : selected ? 'primary.main' : 'transparent', borderRadius: 0,
            display: 'flex', alignItems: 'center', gap: 1.25, px: 1.25, py: 0.75,
            color: 'text.primary', font: 'inherit', textAlign: 'left', cursor: 'pointer',
            opacity: hidden ? 0.55 : 1,
            '@container (max-width: 650px)': {px: 0.75, gap: 0.75},
            bgcolor: status ? alpha(theme.palette[status.severity].main, selected ? 0.18 : 0.08)
                : row.kind === 'meshtastic' ? alpha(typeColor(row.kind), selected ? 0.14 : 0.025)
                    : selected ? 'action.selected' : 'transparent',
            '&:hover': {bgcolor: status ? alpha(theme.palette[status.severity].main, 0.14)
                : row.kind === 'meshtastic' ? alpha(typeColor(row.kind), 0.1) : 'action.hover'},
            '&:focus-visible': {outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2},
        })}>
        <ProtocolIcon row={row} />
        <Box sx={{flex: 1, minWidth: 0, overflow: 'hidden'}}>
            <Box sx={{display: 'flex', alignItems: 'center', gap: 1, height: 24, minWidth: 0}}>
                <Typography component="span" variant="body2" noWrap title={row.name}
                    sx={{fontWeight: 700, minWidth: 0, flexShrink: 0, maxWidth: '40%'}}>{row.name}</Typography>
                {row.kind === 'adsb' && <AircraftFlag icao={row.source} />}
                <Typography component="span" variant="caption" sx={(theme) => ({color: row.kind === 'meshtastic' && theme.palette.mode === 'light' ? '#17803d' : typeColor(row.kind),
                        flexShrink: 0, fontWeight: 600, '@container (max-width: 650px)': {fontSize: '0.65rem'}})}>
                    {typeLabel(row.kind)}
                </Typography>
                {status && <Chip size="small" color={status.severity}
                    label={<><span className="emergency-label">{aircraftEmergencyLabel(status, aircraftT)}</span>
                        <span className="emergency-code">{status.emergencySquawk ? status.squawk : aircraftT('aircraft.emergency.alert', 'Alert')}</span></>}
                    title={aircraftEmergencyLabel(status, aircraftT)}
                    sx={{height: 19, minWidth: 0, flexShrink: 0, maxWidth: 230, fontSize: '0.65rem', borderRadius: 0.75,
                        '& .emergency-code': {display: 'none'},
                        '@container (max-width: 650px)': {'& .emergency-label': {display: 'none'}, '& .emergency-code': {display: 'inline'}},
                        '& .MuiChip-label': {px: 0.75, overflow: 'hidden', textOverflow: 'ellipsis'}}} />}
                <Typography component="span" variant="caption" noWrap title={metadata}
                    sx={{minWidth: 0, color: 'text.secondary', ...(headerFields.length ? {
                        '@container (min-width: 1101px)': {maxWidth: '35%'},
                    } : {})}}>{metadata}</Typography>
                {headerFields.length > 0 && <Box id={flightId} className="transmitter-flight-details" sx={{
                    display: 'flex', flex: 1, minWidth: 0, height: 24, lineHeight: '24px', overflow: 'hidden',
                    flexWrap: 'wrap', alignContent: 'flex-start', columnGap: 1.5, fontSize: '0.75rem', whiteSpace: 'nowrap',
                    fontVariantNumeric: 'tabular-nums', '& .transmitter-metric': {flexShrink: 0},
                    '& .metric-label': {color: 'text.secondary', mr: 0.5},
                    '& .metric-value': {color: 'text.primary', fontWeight: 500},
                    '@container (max-width: 1100px)': {display: 'none'},
                }}>
                    {headerFields.map(({label, value}, index) => <Box component="span" key={index} className="transmitter-metric"
                        title={`${label} ${value}`}>
                        <span className="metric-label">{label}{' '}</span><span className="metric-value">{value}</span>
                    </Box>)}
                </Box>}
                <Box sx={{ml: 'auto', display: 'flex', alignItems: 'center', gap: 1.5, flexShrink: 0, color: 'text.secondary',
                    '@container (max-width: 1100px)': {display: 'none'}}}>
                    {reception && <Typography component="span" variant="caption" title={reception}>{reception}</Typography>}
                    {firstSeen && <Typography component="span" variant="caption" title={`${t('packet_map.first_seen', 'First seen')}: ${firstSeen}`}>
                        {t('packet_map.list.first', 'First')} {firstSeen}
                    </Typography>}
                </Box>
                {row.packet_count !== null && <Typography component="span" variant="caption"
                    sx={{pl: 1, flexShrink: 0, color: 'text.secondary', '@container (max-width: 650px)': {display: 'none'}}}>
                    {t('packet_map.list.packets', {defaultValue: '{{count}} packets', count: row.packet_count})}
                </Typography>}
            </Box>
            {/* Wrap whole metrics into the clipped line below instead of cutting a value in half. */}
            <Box id={descriptionId} title={details} sx={{display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start',
                alignItems: 'center', columnGap: 1.5, rowGap: 0, height: 20, lineHeight: '20px',
                overflow: 'hidden', whiteSpace: 'nowrap', fontSize: '0.75rem', fontVariantNumeric: 'tabular-nums',
                '& .transmitter-metric': {flexShrink: 0}, '& .metric-label': {color: 'text.secondary', mr: 0.5},
                '& .metric-value': {color: 'text.primary', fontWeight: 500},
                '& .metric-comment': {minWidth: 70, flexShrink: 1, overflow: 'hidden', textOverflow: 'ellipsis'},
                '@container (max-width: 1100px)': {columnGap: 1, '& .metric-wide': {display: 'none'}},
                '@container (max-width: 650px)': {columnGap: 0.75, fontSize: '0.68rem', '& .metric-secondary, & .metric-comment': {display: 'none'}},
            }}>
                {status && <Box component="span" sx={{position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)'}}>
                    {aircraftEmergencyLabel(status, aircraftT)}.{' '}
                </Box>}
                {fields.length ? fields.map(({label, value, priority}, index) => <Box component="span" key={index}
                    className={`transmitter-metric metric-${priority}`}>
                    {label && <span className="metric-label">{label}{' '}</span>}
                    <span className="metric-value">{value}</span>{' '}
                </Box>) : <Typography variant="caption" color="text.secondary">{t('packet_map.list.no_telemetry', 'No additional telemetry')}</Typography>}
            </Box>
        </Box>
        <Box sx={{flexShrink: 0, textAlign: 'right', width: 172, fontVariantNumeric: 'tabular-nums',
            '@container (max-width: 650px)': {width: 95}}}>
            <Typography component="div" variant="body2" sx={{fontSize: '0.78rem', fontWeight: 600, lineHeight: '24px'}}
                title={t('packet_map.distance', 'Ground distance from the home station to the latest position')}>
                {row.distance === null ? '—' : `${number(row.distance, 1)} km`}
            </Typography>
            <Typography component="div" variant="caption" noWrap title={`${t('packet_map.last_seen', 'Last seen')}: ${lastSeen}`}
                sx={{fontSize: '0.68rem', color: 'text.secondary', lineHeight: '20px',
                    '& .reception-time': {display: 'none'}, '@container (max-width: 650px)': {
                        '& .reception-date': {display: 'none'}, '& .reception-time': {display: 'inline'},
                    }}}>
                <span className="reception-date">{lastSeen}</span>
                <span className="reception-time">{stamp && Number.isFinite(stamp.getTime()) ? clockFormatter.format(stamp) : '—'}</span>
            </Typography>
        </Box>
    </Box>;
});

export default TransmitterListRow;
