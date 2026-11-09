/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useId, useMemo, useState} from 'react';
import {Box, Chip} from '@mui/material';
import RadioIcon from '@mui/icons-material/Radio';
import SpeedIcon from '@mui/icons-material/Speed';
import NavigationOutlinedIcon from '@mui/icons-material/NavigationOutlined';
import HeightIcon from '@mui/icons-material/Height';
import ExploreOutlinedIcon from '@mui/icons-material/ExploreOutlined';
import SensorsIcon from '@mui/icons-material/Sensors';
import ThermostatIcon from '@mui/icons-material/Thermostat';
import WaterDropOutlinedIcon from '@mui/icons-material/WaterDropOutlined';
import CompressIcon from '@mui/icons-material/Compress';
import AirIcon from '@mui/icons-material/Air';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import SettingsInputAntennaIcon from '@mui/icons-material/SettingsInputAntenna';
import {useSelector} from 'react-redux';
import {useTranslation} from 'react-i18next';
import {useUserTimeSettings} from '../../hooks/useUserTimeSettings.jsx';
import {formatDateTime, formatRelativeTime} from '../../utils/date-time.js';
import {getReceiverDistances} from '../filebrowser/position-utils.js';
import {getAprsDataTypeLabel} from '../filebrowser/aprs-utils.js';
import {resolveAprsSymbol} from './aprs-marker.js';
import {detailLabel, flattenDetails, typeColor} from './transmitters.js';
import balloon from './icons/balloon.png';
import './aprs-info.css';

const finite = (value) => Number.isFinite(value) ? value : null;
const present = (value) => value !== null && value !== undefined && value !== '';
const directionOf = (value) => Number.isFinite(value) && value >= 0 && value <= 360 ? value % 360 : null;

function Section({title, icon: Icon, fields = [], children}) {
    const id = useId();
    const visible = fields.filter(({value}) => present(value));
    if (!visible.length && !children) return null;
    return <section className="aprs-section" aria-labelledby={id}>
        <div className="aprs-section-heading"><Icon aria-hidden="true" /><h3 id={id}>{title}</h3></div>
        {children}
        {visible.length > 0 && <dl className="aprs-fields">
            {visible.map(({label, value, wide}) => <div key={label} className={wide ? 'aprs-field-wide' : undefined}>
                <dt>{label}</dt><dd>{String(value)}</dd>
            </div>)}
        </dl>}
    </section>;
}

function Metric({label, value, unit, note, icon: Icon}) {
    const id = useId();
    return <section className="aprs-metric" aria-labelledby={id}>
        <div className="aprs-metric-label"><Icon aria-hidden="true" /><h3 id={id}>{label}</h3></div>
        <div className="aprs-metric-reading">{value}{unit && <span>{unit}</span>}</div>
        {note && <div className="aprs-metric-note">{note}</div>}
    </section>;
}

// Mount the full decoder view only on demand. Raw payloads and unknown nested
// fields should not be flattened again on every live clock tick.
function PacketDetails({transmitter, number, date, label, common}) {
    const groups = useMemo(() => {
        const grouped = new Map();
        for (const [path, value] of Object.entries(flattenDetails(transmitter.details))) {
            const [group, ...parts] = path.split('.');
            if (!grouped.has(group)) grouped.set(group, []);
            grouped.get(group).push({label: group === 'telemetry' ? detailLabel(path, transmitter.field_info)
                : detailLabel(parts.join('.') || group), value, wide: true});
        }
        return [...grouped];
    }, [transmitter.details, transmitter.field_info]);
    const names = {telemetry: 'Telemetry', signal: 'Signal', decoder: 'Decoder', vfo: 'VFO',
        satellite: 'Satellite', transmitter: 'Transmitter metadata', frame: 'Packet frame', additional: 'Additional data'};
    return <>
        <Section title={common('info.reception', 'Reception')} icon={SensorsIcon} fields={[
            {label: common('info.identifier', 'ID'), value: transmitter.id, wide: true},
            {label: common('source', 'Source'), value: transmitter.source},
            {label: label('position_reports', 'Position reports'), value: number(transmitter.packet_count)},
            {label: common('first_seen', 'First seen'), value: date(transmitter.first_seen), wide: true},
            {label: common('last_seen', 'Last seen'), value: date(transmitter.last_seen), wide: true},
            {label: label('report_received', 'Position report received'), value: date(transmitter.captured_at), wide: true},
            {label: common('latest_file', 'Latest file'), value: transmitter.file_id, wide: true},
        ]} />
        {groups.map(([group, fields]) => <Section key={group} icon={SettingsInputAntennaIcon}
            title={common(`info.${group}`, names[group] || detailLabel(group))} fields={fields} />)}
    </>;
}

const AprsInfo = React.memo(function AprsInfo({transmitter, isLive = false, now = null}) {
    const {t} = useTranslation('navigation');
    const settings = useUserTimeSettings();
    const receiver = useSelector((state) => state.location?.location);
    const [expanded, setExpanded] = useState(false);
    const report = transmitter.details?.telemetry ?? {};
    const position = report.position ?? {};
    const weather = report.weather ?? {};
    const telemetry = report.telemetry ?? {};
    const frame = transmitter.details?.frame ?? {};
    const signal = transmitter.details?.signal ?? {};
    const vfo = transmitter.details?.vfo ?? {};
    const label = (key, fallback, values) => t(`packet_map.aprs.${key}`, {defaultValue: fallback, ...values});
    const common = (key, fallback) => t(`packet_map.${key}`, {defaultValue: fallback});
    const formatters = useMemo(() => Array.from({length: 7}, (_, digits) => new Intl.NumberFormat(settings.locale, {
        maximumFractionDigits: digits,
    })), [settings.locale]);
    const number = (value, digits = 0) => Number.isFinite(value) ? formatters[digits].format(value) : null;
    const measure = (value, unit, digits = 0) => Number.isFinite(value) ? `${number(value, digits)} ${unit}` : null;
    const date = (value) => formatDateTime(value, settings);
    const distance = useMemo(() => getReceiverDistances(transmitter, receiver)?.groundKm ?? null,
        [transmitter.latitude, transmitter.longitude, receiver?.lat, receiver?.lon]);
    const entity = report.object || report.item;
    const source = frame.source || transmitter.source;
    const title = entity?.name || transmitter.name || source || transmitter.id;
    const symbol = resolveAprsSymbol({symbol_table: transmitter.symbol_table ?? position.symbol_table,
        symbol_code: transmitter.symbol_code ?? position.symbol_code}, report);
    const category = symbol ? label(`symbols.${symbol.label.toLowerCase().replaceAll(' ', '_')}`, symbol.label)
        : entity ? label('object_item', 'Object / item') : label('station', 'Station');
    const image = symbol?.balloon ? balloon : symbol?.image;
    const received = date(transmitter.captured_at);
    // Recorded panels always identify the latest report explicitly; they do not
    // borrow its readings to imply measurements at the playback cursor.
    const relative = isLive ? formatRelativeTime(transmitter.captured_at,
        {now: Number.isFinite(now) ? now : Date.now(), locale: settings.locale}) : null;
    const speed = finite(position.speed_knots);
    const course = directionOf(position.course_degrees);
    const altitude = finite(transmitter.altitude) ?? finite(position.altitude_meters);
    const cardinal = (angle) => angle === null ? ''
        : label(`directions.${['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'][Math.round(angle / 45) % 8]}`,
            ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(angle / 45) % 8]);
    const temperature = finite(weather.temperature_fahrenheit);
    const wind = finite(weather.wind_speed_mph);
    const windDirection = directionOf(weather.wind_direction_degrees);
    const power = finite(signal.signal_power_dbfs);
    const rssi = finite(signal.rssi_dbm);
    const frequency = finite(signal.frequency_hz ?? vfo.center_freq_hz ?? vfo.center_freq);
    const hasWeather = Object.values(weather).some(Number.isFinite);
    const hasMovement = (speed !== null && speed >= 0) || course !== null;
    const reported = label('reported', 'Reported');
    const weatherMetrics = [
        {label: label('temperature', 'Temperature'), value: temperature === null ? null : (temperature - 32) * 5 / 9,
            unit: '°C', digits: 1, icon: ThermostatIcon},
        {label: label('humidity', 'Humidity'), value: finite(weather.humidity_percent), unit: '%', icon: WaterDropOutlinedIcon},
        {label: label('pressure', 'Pressure'), value: finite(weather.pressure_mbar), unit: 'hPa', digits: 1, icon: CompressIcon},
        {label: label('wind', 'Wind'), value: wind === null ? null : wind * 1.609344, unit: 'km/h', digits: 1, icon: AirIcon,
            note: windDirection === null ? reported : `${number(windDirection)}° ${cardinal(windDirection)}`},
    ];
    const metrics = hasWeather ? weatherMetrics : [
        {label: label('speed', 'Speed'), value: speed !== null && speed >= 0 ? speed * 1.852 : null,
            unit: 'km/h', digits: 1, icon: SpeedIcon},
        {label: label('course', 'Course'), value: course, unit: '°', icon: NavigationOutlinedIcon, note: cardinal(course)},
        {label: label('altitude', 'Altitude'), value: altitude, unit: 'm', icon: HeightIcon},
        {label: label('distance', 'Distance'), value: distance, unit: 'km', digits: 1, icon: ExploreOutlinedIcon,
            note: label('from_home', 'From home station')},
        ...(!hasMovement ? [
            {label: label('received_signal', 'Received signal'), value: power ?? rssi, unit: power !== null ? 'dBFS' : 'dBm',
                digits: 1, icon: SensorsIcon, note: label('receiver', 'Receiver')},
            {label: label('position_reports', 'Position reports'), value: finite(transmitter.packet_count), icon: RadioIcon,
                note: label('selected_range', 'Selected date range')},
        ] : []),
    ];
    const visibleMetrics = metrics.filter(({value}) => value !== null);
    // AX.25 aliases are an advertised path, not proof of which relays heard us.
    const path = (Array.isArray(frame.repeaters) ? frame.repeaters : Array.isArray(frame.path) ? frame.path : [])
        .filter((hop) => typeof hop === 'string' && hop !== '');
    const channels = Array.isArray(telemetry.channels) ? telemetry.channels : [];
    const digital = typeof telemetry.digital_bits === 'string' && /^[01]{8}$/.test(telemetry.digital_bits)
        ? telemetry.digital_bits : null;
    const message = typeof report.message === 'object' && report.message !== null ? report.message : null;

    return <Box className="aprs-panel" sx={(theme) => ({
        '--aprs-accent': theme.palette.mode === 'dark' ? typeColor('aprs') : '#006d94',
        '--aprs-tint': theme.palette.mode === 'dark' ? 'rgba(41,182,246,0.06)' : 'rgba(0,109,148,0.04)',
        '--aprs-text': theme.palette.text.primary, '--aprs-muted': theme.palette.text.secondary,
        '--aprs-line': theme.palette.divider,
    })}>
        <header className="aprs-identity">
            <div className="aprs-station-icon" aria-hidden="true">
                {image ? <img src={image} alt="" /> : <RadioIcon />}
                {symbol?.overlay && <span className="aprs-symbol-overlay">{symbol.overlay}</span>}
            </div>
            <div className="aprs-station-name">
                <div className="aprs-identity-title"><h2>{title}</h2><Chip size="small" variant="outlined" label="APRS"
                    sx={{height: 20, fontSize: '0.65rem', color: 'var(--aprs-accent)', borderColor: 'var(--aprs-accent)'}} /></div>
                <div className="aprs-category">{category}{entity && source
                    ? ` · ${label('reported_by', 'Reported by {{source}}', {source})}` : ''}</div>
                {entity && typeof entity.alive === 'boolean' && <div className="aprs-entity-state">
                    {entity.alive ? label('object_active', 'Object active') : label('object_removed', 'Object removed')}
                </div>}
                <div className="aprs-received" title={received || undefined}>
                    {label('received', 'Received')} · {relative || received || '—'}
                </div>
            </div>
        </header>
        <div className="aprs-dashboard-scroll">
            <div className="aprs-report-kind"><span>{label('latest_position_report', 'Latest position report')}</span>
                {report.data_type && <strong>{label(`report_types.${report.data_type}`, getAprsDataTypeLabel(report))}</strong>}
            </div>
            {visibleMetrics.length > 0 && <div className="aprs-metrics" role="group" aria-label={label('overview', 'Station overview')}>
                {visibleMetrics.map(({value, digits, ...metric}) => <Metric key={metric.label} {...metric}
                    value={number(value, digits)} note={metric.note || reported} />)}
            </div>}
            {present(report.comment) && <Section title={label('comment', 'Comment')} icon={ChatBubbleOutlineIcon}>
                <div className="aprs-message">{String(report.comment)}</div>
            </Section>}
            {present(report.status) && <Section title={label('status', 'Status')} icon={ChatBubbleOutlineIcon}>
                <div className="aprs-message">{String(report.status)}</div>
            </Section>}
            {message && <Section title={label('message', 'Message')} icon={ChatBubbleOutlineIcon} fields={[
                {label: label('addressee', 'Addressee'), value: message.addressee},
                {label: label('message_id', 'Message ID'), value: message.id},
                {label: label('response', 'Response'), value: message.response},
                {label: label('response_id', 'Response ID'), value: message.response_id},
            ]}>{present(message.text) && <div className="aprs-message">{String(message.text)}</div>}</Section>}
            <Section title={common('info.position', 'Latest position')} icon={ExploreOutlinedIcon} fields={[
                {label: common('latitude', 'Latitude'), value: measure(transmitter.latitude, '°', 6)},
                {label: common('longitude', 'Longitude'), value: measure(transmitter.longitude, '°', 6)},
                ...(hasWeather ? [
                    // Weather cards own the overview; keep its position readings here.
                    {label: common('altitude', 'Altitude (m)'), value: measure(altitude, 'm')},
                    {label: label('distance', 'Distance'), value: measure(distance, 'km', 1)},
                    {label: label('speed', 'Speed'), value: measure(speed !== null && speed >= 0 ? speed * 1.852 : null, 'km/h', 1)},
                    {label: label('course', 'Course'), value: measure(course, '°')},
                ] : []),
                {label: label('position_ambiguity', 'Position ambiguity'),
                    value: position.ambiguity ? label('ambiguous_position', 'Approximate position') : null, wide: true},
            ]} />
            {hasWeather && <Section title={label('weather', 'Weather')} icon={AirIcon} fields={[
                {label: label('wind_direction', 'Wind direction'), value: windDirection === null ? null
                    : `${number(windDirection)}° ${cardinal(windDirection)}`},
                {label: label('wind_gust', 'Wind gust'), value: measure(Number.isFinite(weather.wind_gust_mph)
                    ? weather.wind_gust_mph * 1.609344 : null, 'km/h', 1)},
                ...['rain_last_hour_inches', 'rain_last_24_hours_inches', 'rain_since_midnight_inches'].map((key, index) => ({
                    label: [label('rain_hour', 'Rain · last hour'), label('rain_day', 'Rain · last 24 hours'),
                        label('rain_midnight', 'Rain · since midnight')][index],
                    value: measure(Number.isFinite(weather[key]) ? weather[key] * 25.4 : null, 'mm', 1),
                })),
            ]} />}
            <Section title={label('radio_path', 'Radio & path')} icon={SettingsInputAntennaIcon} fields={[
                {label: label('frequency', 'Receiver frequency'), value: measure(frequency === null ? null : frequency / 1e6, 'MHz', 3)},
                {label: label('received_signal', 'Received signal'), value: measure(power ?? rssi, power !== null ? 'dBFS' : 'dBm', 1)},
                {label: 'SNR', value: measure(signal.snr_db, 'dB', 1)},
                {label: common('list.bandwidth', 'BW'), value: measure(Number.isFinite(vfo.bandwidth_hz) ? vfo.bandwidth_hz / 1000 : null, 'kHz', 1)},
                {label: common('source', 'Source'), value: source},
                {label: label('destination', 'AX.25 destination'), value: frame.destination},
                {label: label('advertised_path', 'Advertised path'), value: path.length ? path.join(' → ') : null, wide: true},
            ]} />
            <Section title={label('telemetry', 'Telemetry channels')} icon={SensorsIcon} fields={[
                {label: label('sequence', 'Sequence'), value: telemetry.sequence},
                ...channels.map((value, index) => ({label: label('channel_raw', 'Channel {{channel}} (raw)', {channel: index + 1}),
                    value: Number.isFinite(value) ? number(value, 2) : value})),
                {label: label('digital_bits', 'Digital bits'), value: digital ? null : telemetry.digital_bits, wide: true},
                {label: label('comment', 'Comment'), value: telemetry.comment, wide: true},
            ]}>
                {digital && <div className="aprs-digital" role="group" aria-label={label('digital_bits', 'Digital bits')}>
                    {Array.from(digital, (bit, index) => <div key={index} className="aprs-digital-bit">
                        <span className={bit === '1' ? 'aprs-bit-set' : ''} aria-hidden="true" />
                        <span>{label('bit_state', 'Bit {{bit}}: {{state}}', {bit: index + 1, state: bit})}</span>
                    </div>)}
                </div>}
            </Section>
            <details className="aprs-packet-details" onToggle={(event) => setExpanded(event.currentTarget.open)}>
                <summary>{label('packet_details', 'Full packet & reception details')}</summary>
                {expanded && <PacketDetails transmitter={transmitter} number={number} date={date} label={label} common={common} />}
            </details>
        </div>
    </Box>;
});

export default AprsInfo;
