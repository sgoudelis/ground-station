/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useId, useMemo, useState} from 'react';
import {Box, Chip} from '@mui/material';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import SensorsIcon from '@mui/icons-material/Sensors';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import RouteIcon from '@mui/icons-material/Route';
import ExploreOutlinedIcon from '@mui/icons-material/ExploreOutlined';
import SettingsInputAntennaIcon from '@mui/icons-material/SettingsInputAntenna';
import BatteryChargingFullIcon from '@mui/icons-material/BatteryChargingFull';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline';
import {useSelector} from 'react-redux';
import {useTranslation} from 'react-i18next';
import {useUserTimeSettings} from '../../hooks/useUserTimeSettings.jsx';
import {formatDateTime} from '../../utils/date-time.js';
import {getReceiverDistances} from '../filebrowser/position-utils.js';
import {detailLabel, flattenDetails, typeColor} from './transmitters.js';
import './meshtastic-info.css';

const finite = (value) => Number.isFinite(value) ? value : null;
const percentage = (value) => Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
const present = (value) => value !== null && value !== undefined && value !== '';
const groupLabels = {telemetry: 'Telemetry', signal: 'Signal', decoder: 'Decoder', vfo: 'VFO',
    satellite: 'Satellite', transmitter: 'Transmitter metadata', frame: 'Packet frame', additional: 'Additional data'};

function NodeSection({title, icon: Icon, children, fields}) {
    const id = useId();
    const visibleFields = fields?.filter(({value}) => present(value));
    if (fields && !visibleFields.length && !children) return null;
    return <section className="mesh-section" aria-labelledby={id}>
        <div className="mesh-section-heading"><Icon aria-hidden="true" /><h3 id={id}>{title}</h3></div>
        {children}
        {visibleFields?.length > 0 && <dl className="mesh-fields">
            {visibleFields.map(({label, value, wide}) => <div key={label} className={wide ? 'mesh-field-wide' : undefined}>
                <dt>{label}</dt><dd>{value}</dd>
            </div>)}
        </dl>}
    </section>;
}

function MetricCard({label, value, unit, note, icon: Icon}) {
    const id = useId();
    return <section className="mesh-metric" aria-labelledby={id}>
        <div className="mesh-metric-label"><Icon aria-hidden="true" /><h3 id={id}>{label}</h3></div>
        <div className="mesh-metric-reading">{value ?? '—'}{present(value) && unit && <span>{unit}</span>}</div>
        <div className="mesh-metric-note">{note}</div>
    </section>;
}

function PercentReading({label, value, number}) {
    return <div className="mesh-percent-reading">
        <div><span>{label}</span><strong>{number(value, 1)} %</strong></div>
        <div className="mesh-meter" role="meter" aria-label={label} aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
            <span style={{width: `${value}%`}} />
        </div>
    </div>;
}

// This subtree is mounted only while expanded. Unrelated decoder objects and
// long raw payloads are never traversed on playback ticks or ordinary renders.
function PacketDetails({transmitter, number, formatTime}) {
    const {t} = useTranslation('navigation');
    const groups = useMemo(() => {
        const result = new Map();
        for (const [path, value] of Object.entries(flattenDetails(transmitter.details))) {
            const [group, ...parts] = path.split('.');
            if (!result.has(group)) result.set(group, []);
            result.get(group).push({label: group === 'telemetry' ? detailLabel(path, transmitter.field_info)
                : detailLabel(parts.join('.') || group), value: String(value), wide: true});
        }
        return [...result];
    }, [transmitter.details, transmitter.field_info]);
    const label = (key, fallback) => t(`packet_map.${key}`, fallback);
    return <>
        <NodeSection title={label('info.reception', 'Reception')} icon={SensorsIcon} fields={[
            {label: label('source', 'Source'), value: transmitter.source},
            {label: label('packets', 'Packets'), value: number(transmitter.packet_count)},
            {label: label('first_seen', 'First seen'), value: formatTime(transmitter.first_seen), wide: true},
            {label: label('last_seen', 'Last seen'), value: formatTime(transmitter.last_seen), wide: true},
            {label: label('info.captured_at', 'Latest packet received'), value: formatTime(transmitter.captured_at), wide: true},
            {label: label('latest_file', 'Latest file'), value: transmitter.file_id, wide: true},
        ]} />
        {groups.map(([group, fields]) => <NodeSection key={group} icon={SettingsInputAntennaIcon}
            title={label(`info.${group}`, groupLabels[group] || detailLabel(group))} fields={fields} />)}
    </>;
}

const MeshtasticInfo = React.memo(function MeshtasticInfo({transmitter}) {
    const {t} = useTranslation('navigation');
    const timeSettings = useUserTimeSettings();
    const receiver = useSelector((state) => state.location?.location);
    const [expanded, setExpanded] = useState(false);
    const telemetry = transmitter.details?.telemetry ?? {};
    const frame = transmitter.details?.frame ?? {};
    const signal = transmitter.details?.signal ?? {};
    const vfo = transmitter.details?.vfo ?? {};
    const position = telemetry.position ?? {};
    const label = (key, fallback, values) => t(`packet_map.mesh.${key}`, {defaultValue: fallback, ...values});
    const common = (key, fallback) => t(`packet_map.${key}`, fallback);
    const formatters = useMemo(() => Array.from({length: 7}, (_, digits) => new Intl.NumberFormat(timeSettings.locale, {
        maximumFractionDigits: digits,
    })), [timeSettings.locale]);
    const number = (value, digits = 0) => Number.isFinite(value) ? formatters[digits].format(value) : null;
    const measure = (value, unit, digits = 0) => Number.isFinite(value) ? `${number(value, digits)} ${unit}` : null;
    const formatTime = (value) => formatDateTime(value, timeSettings);
    const distance = useMemo(() => getReceiverDistances(transmitter, receiver)?.groundKm ?? null,
        [transmitter.latitude, transmitter.longitude, transmitter.altitude, receiver?.lat, receiver?.lon, receiver?.alt]);
    const title = telemetry.long_name || telemetry.short_name || transmitter.name || transmitter.source;
    const nodeId = telemetry.source || frame.source || transmitter.source || transmitter.id;
    const subtitle = [telemetry.short_name && telemetry.short_name !== title ? telemetry.short_name : '', nodeId].filter(Boolean).join(' · ');
    const power = finite(signal.signal_power_dbfs);
    const rssi = finite(signal.rssi_dbm);
    const snr = finite(signal.snr_db);
    const satellites = finite(telemetry.sats_in_view);
    const hops = finite(telemetry.hop_limit ?? frame.hop_limit);
    const initialHops = finite(telemetry.hop_start ?? frame.hop_start);
    // The header stores a remaining budget, not a discovered route or a count
    // of directly reachable neighbors. Only render its small, valid range.
    const validBudget = Number.isInteger(initialHops) && initialHops >= 0 && initialHops <= 7
        && Number.isInteger(hops) && hops >= 0 && hops <= initialHops;
    const battery = percentage(telemetry.battery_level);
    const externalPower = telemetry.power_source || (telemetry.battery_level > 100 ? label('external_power', 'External power') : '');
    const channelUtilization = percentage(telemetry.channel_utilization);
    const transmitAirtime = percentage(telemetry.air_util_tx);
    const hasHealth = [battery, finite(telemetry.voltage), channelUtilization, transmitAirtime,
        finite(telemetry.uptime_seconds), finite(telemetry.temperature), finite(telemetry.relative_humidity),
        finite(telemetry.barometric_pressure)].some(present) || Boolean(externalPower);
    const duration = (seconds) => {
        if (!Number.isFinite(seconds) || seconds < 0) return null;
        const days = Math.floor(seconds / 86400);
        const hours = Math.floor(seconds % 86400 / 3600);
        const minutes = Math.floor(seconds % 3600 / 60);
        return [days ? label('days', '{{count}} d', {count: number(days)}) : '',
            hours ? label('hours', '{{count}} h', {count: number(hours)}) : '',
            minutes ? label('minutes', '{{count}} min', {count: number(minutes)}) : '',
            seconds < 60 ? label('seconds', '{{count}} s', {count: number(Math.floor(seconds))}) : ''].filter(Boolean).join(' ');
    };
    const frequency = finite(signal.frequency_hz ?? telemetry.signal?.frequency_hz ?? vfo.center_freq_hz ?? vfo.center_freq);
    const lastHeard = formatTime(transmitter.last_seen || transmitter.captured_at);
    const radioFields = [
        {label: common('list.frequency', 'RF'), value: measure(frequency === null ? null : frequency / 1e6, 'MHz', 3)},
        {label: common('list.bandwidth', 'BW'), value: measure(Number.isFinite(vfo.bandwidth_hz) ? vfo.bandwidth_hz / 1000 : null, 'kHz', 1)},
        {label: common('list.channel', 'Channel'), value: telemetry.channel_hash ?? frame.channel_hash},
        {label: common('list.destination', 'To'), value: telemetry.destination ?? frame.destination},
        {label: common('list.relay', 'Relay'), value: telemetry.relay_node ?? frame.relay_node},
        {label: common('list.next_hop', 'Next hop'), value: telemetry.next_hop ?? frame.next_hop},
        {label: common('list.encryption', 'Encryption'), value: telemetry.encryption ?? frame.encryption},
        {label: label('transport', 'Transport'), value: (telemetry.via_mqtt ?? frame.via_mqtt) === true ? 'MQTT' : null},
    ];
    return <Box className="meshtastic-panel" sx={(theme) => ({
        '--mesh-accent': theme.palette.mode === 'dark' ? typeColor('meshtastic') : '#17803d',
        '--mesh-tint': theme.palette.mode === 'dark' ? 'rgba(103,234,148,0.06)' : 'rgba(23,128,61,0.04)',
        '--mesh-text': theme.palette.text.primary, '--mesh-muted': theme.palette.text.secondary,
        '--mesh-line': theme.palette.divider,
    })}>
        <header className="mesh-identity">
            <div className="mesh-node-icon"><HubOutlinedIcon aria-hidden="true" /></div>
            <div className="mesh-node-name"><div className="mesh-identity-title"><h2>{title}</h2>
                <Chip size="small" variant="outlined" label="Meshtastic" sx={{height: 20, fontSize: '0.65rem', color: 'var(--mesh-accent)', borderColor: 'var(--mesh-accent)'}} />
            </div><div className="mesh-node-id">{subtitle}</div>
                <div className="mesh-last-heard">{label('last_heard', 'Last heard')} · {lastHeard || '—'}</div>
            </div>
        </header>
        <div className="mesh-dashboard-scroll">
            {telemetry.application && <div className="mesh-report-kind">{label('latest_report', 'Latest report')}<strong>{telemetry.application}</strong></div>}
            <div className="mesh-metrics" role="group" aria-label={label('overview', 'Node overview')}>
                <MetricCard label={label('received_signal', 'Received signal')} icon={SensorsIcon}
                    value={number(power ?? rssi, 1)} unit={power !== null ? 'dBFS' : 'dBm'}
                    note={power === null && rssi === null ? label('not_reported', 'Not reported')
                        : [label('receiver', 'Receiver'), snr !== null ? `SNR ${measure(snr, 'dB', 1)}` : ''].filter(Boolean).join(' · ')} />
                <MetricCard label={label('gps_satellites', 'GPS satellites')} icon={SatelliteAltIcon}
                    value={number(satellites)} note={satellites === null ? label('not_reported', 'Not reported')
                        : Number.isFinite(telemetry.HDOP) ? `HDOP ${number(telemetry.HDOP, 2)}` : label('reported_by_node', 'Reported by node')} />
                <MetricCard label={label('remaining_hops', 'Remaining hops')} icon={RouteIcon}
                    value={number(hops)} note={label('packet_budget', 'Packet hop budget')} />
                <MetricCard label={label('distance', 'Distance')} icon={ExploreOutlinedIcon}
                    value={number(distance, 1)} unit="km" note={label('from_home', 'From home station')} />
            </div>
            {typeof telemetry.message === 'string' && telemetry.message !== '' && <NodeSection
                title={label('message', 'Message')} icon={ChatBubbleOutlineIcon}>
                <div className="mesh-message">{telemetry.message}</div>
            </NodeSection>}
            <NodeSection title={label('position', 'Position')} icon={ExploreOutlinedIcon} fields={[
                {label: common('latitude', 'Latitude'), value: measure(transmitter.latitude, '°', 6)},
                {label: common('longitude', 'Longitude'), value: measure(transmitter.longitude, '°', 6)},
                {label: common('list.altitude', 'Altitude'), value: measure(transmitter.altitude, 'm')},
                {label: common('list.speed', 'Speed'), value: measure(telemetry.ground_speed ?? position.speed_kmh, 'km/h', 1)},
                {label: common('list.heading', 'Heading'), value: measure(telemetry.ground_track ?? position.course_degrees, '°')},
                {label: label('gps_accuracy', 'GPS accuracy'), value: measure(Number.isFinite(telemetry.gps_accuracy) ? telemetry.gps_accuracy / 1000 : null, 'm', 2)},
                {label: label('precision', 'Position precision'), value: measure(telemetry.precision_bits, 'bits')},
            ]} />
            <NodeSection title={label('radio_routing', 'Radio & routing')} icon={SettingsInputAntennaIcon} fields={radioFields}>
                {validBudget && <div className="mesh-hop-budget">
                    <div className="mesh-hop-caption">{label('hop_budget', '{{initial}} initial · {{remaining}} remaining', {
                        initial: number(initialHops), remaining: number(hops),
                    })}</div>
                    {initialHops > 0 && <div className="mesh-hop-segments" role="img" aria-label={label('hop_budget', '{{initial}} initial · {{remaining}} remaining', {
                        initial: number(initialHops), remaining: number(hops),
                    })}>{Array.from({length: initialHops}, (_, index) => <span key={index} className={index < hops ? 'mesh-hop-remaining' : undefined} />)}</div>}
                </div>}
            </NodeSection>
            {hasHealth && <NodeSection title={label('device_health', 'Device health')} icon={BatteryChargingFullIcon} fields={[
                {label: label('power_source', 'Power source'), value: externalPower},
                {label: common('list.voltage', 'Voltage'), value: measure(telemetry.voltage, 'V', 2)},
                {label: label('uptime', 'Uptime'), value: duration(telemetry.uptime_seconds)},
                {label: common('list.temperature', 'Temperature'), value: measure(telemetry.temperature, '°C', 1)},
                {label: common('list.humidity', 'Relative humidity'), value: measure(telemetry.relative_humidity, '%', 1)},
                {label: common('list.pressure', 'Pressure'), value: measure(telemetry.barometric_pressure, 'hPa', 1)},
            ]}>
                <div className="mesh-health-bars">
                    {battery !== null && <PercentReading label={common('list.battery', 'Battery')} value={battery} number={number} />}
                    {channelUtilization !== null && <PercentReading label={label('channel_utilization', 'Channel utilization')} value={channelUtilization} number={number} />}
                    {transmitAirtime !== null && <PercentReading label={label('transmit_airtime', 'Transmit airtime')} value={transmitAirtime} number={number} />}
                </div>
            </NodeSection>}
            <details className="mesh-packet-details" onToggle={(event) => setExpanded(event.currentTarget.open)}>
                <summary>{label('packet_details', 'Full packet & reception details')}</summary>
                {expanded && <PacketDetails transmitter={transmitter} number={number} formatTime={formatTime} />}
            </details>
        </div>
    </Box>;
});

export default MeshtasticInfo;
