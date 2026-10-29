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

import React from 'react';
import { Alert, Box, Divider, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { formatDateTime } from '../../utils/date-time.js';
import { normalizeTelemetryValue, RawFields, Row, Values } from './telemetry-fields.jsx';

// These fallbacks also describe old captures without field_info. Current
// parser-provided labels/units take precedence; no enum meanings are inferred.
const FIELDS = {
  v_pack_v: ['Battery pack voltage', 'V', 'power'],
  v_cell_v: ['Battery cell voltage', 'V', 'power'],
  vbus_v: ['Bus voltage', 'V', 'power'],
  eps_current_platform_a: ['Platform current', 'A', 'power'],
  eps_current_solar_a: ['Solar current', 'A', 'power'],
  battery_current_a: ['Battery current', 'A', 'power'],
  panel_current_a: ['Solar panel current', 'A', 'power'],
  temp_bat1_c: ['Battery 1 temperature', '°C', 'power'],
  temp_bat2_c: ['Battery 2 temperature', '°C', 'power'],
  eps_mode_enum: ['Operating mode', '', 'power'],
  cpu_load_pct: ['CPU load', '%', 'obc'],
  obc_counter: ['Onboard computer counter', '', 'obc'],
  obc_activity: ['Onboard computer activity', '', 'obc'],
  obc_activity_raw: ['Onboard computer activity', '', 'obc'],
  gnss_sat_count: ['GNSS satellite count', '', 'obc'],
  camera_media_files_count: ['Camera media file count', '', 'obc'],
  ...Object.fromEntries(['x', 'y', 'z'].flatMap((axis) => ['p', 'n'].map((side) => [
    `temp_${axis}_${side}_c`, [`${side === 'p' ? '+' : '−'}${axis.toUpperCase()} panel temperature`, '°C', 'obc'],
  ]))),
  comm_counter: ['Communications counter', '', 'communications'],
  rssi_dbm: ['Received signal strength', 'dBm', 'communications'],
  rssi_last_dbm: ['Last received signal strength', 'dBm', 'communications'],
  rssi_min_dbm: ['Minimum received signal strength', 'dBm', 'communications'],
  tx_packets_count: ['Transmitted packet count', '', 'communications'],
  qso_received_count: ['Received QSO count', '', 'communications'],
  ...Object.fromEntries(['a', 'b'].flatMap((battery) => [
    ['voltage_v', 'voltage', 'V'],
    ['current_ma', 'current', 'mA'],
    ['soc_pct', 'state of charge', '%'],
    ['temp_c', 'temperature', '°C'],
  ].map(([key, label, unit]) => [
    `batt_${battery}_${key}`, [`Battery ${battery.toUpperCase()} ${label}`, unit, `battery_${battery}`],
  ]))),
  uptime_s: ['Uptime', 's', 'status'],
  power_consumption_mw: ['Power consumption', 'mW', 'status'],
  obc_temp_c: ['Onboard computer temperature', '°C', 'status'],
  ...Object.fromEntries(['x', 'y', 'z'].flatMap((axis) => ['pos', 'neg'].map((side) => [
    `panel_${side}_${axis}_temp_c`, [`${side === 'pos' ? '+' : '−'}${axis.toUpperCase()} panel temperature`, '°C', 'panels'],
  ]))),
  beacon_rate_s: ['Beacon interval', 's', 'communications'],
  freq_khz: ['Downlink frequency', 'kHz', 'communications'],
  message: ['Radio message', '', 'communications'],
};

const ACTIVITY_LABELS = {
  wheels: 'Reaction wheels', coils: 'Magnetic coils', ins: 'Inertial navigation', camera: 'Camera',
  panel_x_p: '+X panel', panel_x_n: '−X panel', panel_y_p: '+Y panel', panel_y_n: '−Y panel',
};
const CLOCK_FIELDS = ['eps_time_unix_s', 'time_unix_s'];
const TITLES = {
  battery_a: 'Battery A', battery_b: 'Battery B', status: 'Satellite status', panels: 'Panel temperatures',
  power: 'Power system', obc: 'Onboard computer', temperatures: 'Temperatures', channels: 'Output channels',
  communications: 'Communications', diodes: 'Diode readings', magnetometer: 'Magnetometer', gyroscope: 'Gyroscope',
  payload: 'Payload', navigation: 'Navigation status', position: 'Position', velocity: 'Velocity', other: 'Other telemetry',
};
const HEADER_FIELDS = ['api', 'packet_id', 'payload_size'];
const FIELD_ORDER = Object.keys(FIELDS);

function fieldOrder(key, info) {
  if (Number.isFinite(info?.order)) return info.order;
  const index = FIELD_ORDER.indexOf(key.startsWith('obc_activity_') && key !== 'obc_activity_raw' ? 'obc_activity' : key);
  return index < 0 ? FIELD_ORDER.length : index;
}

function readableLabel(key) {
  const words = key.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function telemetryDate(value) {
  if (value == null || value === '' || !['number', 'string'].includes(typeof value)) return null;
  let input = value;
  if (typeof input === 'number') {
    input *= 1000;
  } else if (typeof input === 'string' && /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(?:\.\d+)?$/.test(input)) {
    // Legacy time_utc strings omit an offset; they still represent UTC.
    input = input.replace(' ', 'T') + 'Z';
  }
  const date = new Date(input);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isHousekeepingTelemetry(telemetry) {
  const payload = telemetry?.telemetry || {};
  // A parser name can survive a failed decode. Keep its raw fallback in the
  // generic empty state rather than showing an empty housekeeping dashboard.
  if (!payload.values && !payload.error && !payload.warning) return false;
  return payload.format === 'geoscan' || payload.spec?.startsWith('geoscan_type1_')
    || ['rs52s', 'uwe4'].includes(payload.spec) || ['COLIBRI-S', 'RS52S', 'UWE-4'].includes(payload.satellite)
    || /Geoscan|Uwe4/.test(telemetry?.parser || '')
    || Object.values(payload.field_info || {}).some((info) => typeof info?.group === 'string' && info.group.length > 0)
    // Older UWE-4 metadata may lack the spec identifier and field descriptions.
    || Object.keys(payload.values || {}).some((key) => key.startsWith('eps_')
      || /^batt_[ab]_(voltage_v|current_ma|soc_pct|temp_c)$/.test(key));
}

export default function HousekeepingTelemetry({ payload, satellite, captureTime }) {
  const { t } = useTranslation('filebrowser');
  const { timezone, locale } = useUserTimeSettings();
  const values = payload.values || {};
  const raw = { ...(payload.rawFields || {}), ...(payload.raw_fields || {}) };
  // Metadata can introduce groups without adding satellite field lists here.
  const groups = new Map(Object.keys(TITLES).map((group) => [group, {}]));
  const fieldInfo = {};
  const clockKey = CLOCK_FIELDS.find((key) => Object.hasOwn(values, key));
  const clock = clockKey ? normalizeTelemetryValue(values[clockKey]).value : payload.time_unix_s ?? payload.time_utc;
  const hasClock = clockKey || payload.time_unix_s != null || payload.time_utc != null;

  const formatClock = (input) => {
    const date = telemetryDate(input);
    return date ? formatDateTime(date, {timezone, locale, options: {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }}) : t('telemetry_values_tab.unavailable', { defaultValue: 'Unavailable' });
  };

  for (const [key, entry] of Object.entries(values)) {
    const reading = normalizeTelemetryValue(entry);
    const info = payload.field_info?.[key] || {};
    const metadataGroup = typeof info.group === 'string' && info.group.length > 0 ? info.group : null;
    if (key === 'mayak_id' || CLOCK_FIELDS.includes(key) || HEADER_FIELDS.includes(key) || key.startsWith('ax25_')
      || /(?:^|_)reserve(?:d)?(?:_|$)/.test(key) || (key.endsWith('_raw') && !FIELDS[key] && !metadataGroup)) {
      // Packet headers and reserved bytes belong in details, not sensor cards.
      // Preserve legacy fields even when no raw_fields map exists.
      if (!Object.hasOwn(raw, key)) raw[key] = reading.error ? entry : reading.value;
      continue;
    }
    const [label, unit, fallbackGroup] = FIELDS[key] || [readableLabel(key), '', 'other'];
    const group = metadataGroup || fallbackGroup;
    if (!groups.has(group)) groups.set(group, {});
    const fields = groups.get(group);
    // Colibri-S already expands documented activity flags. Keep those named
    // flags readable, but leave integer bitfields from other parsers numeric.
    if (key === 'obc_activity' && reading.value && typeof reading.value === 'object' && !Array.isArray(reading.value)) {
      for (const [flag, active] of Object.entries(reading.value)) {
        const flagKey = `${key}_${flag}`;
        fields[flagKey] = active;
        fieldInfo[flagKey] = {label: ACTIVITY_LABELS[flag] || readableLabel(flag), order: info.order};
      }
      continue;
    }
    fields[key] = entry;
    fieldInfo[key] = {...info, label: info.label || label, unit: info.unit ?? (reading.unit || unit)};
  }

  const satelliteName = satellite || payload.satellite;
  const hasUncalibratedReadings = Object.values(fieldInfo).some((info) => info.calibrated === false);
  return (
    <Box>
      {payload.warning && <Alert severity="info" sx={{ mb: 2 }}>{payload.warning}</Alert>}
      {payload.error && <Alert severity="warning" sx={{ mb: 2 }}>{payload.error}</Alert>}
      {hasUncalibratedReadings && <Alert severity="info" sx={{ mb: 2 }}>
        {t('telemetry_values_tab.raw_readings_hint', { defaultValue: 'Readings marked “raw” have no verified conversion to physical units.' })}
      </Alert>}
      <Box sx={{ mb: 3 }}>
        {satelliteName && <Typography variant="h6" sx={{ mb: 1 }}>{satelliteName}</Typography>}
        {payload.satellite === 'LASARSAT' && payload.type && <Row
          label={t('telemetry_values_tab.beacon_type', { defaultValue: 'Beacon type' })} value={payload.type} />}
        {Object.hasOwn(values, 'mayak_id') && (
          <Values values={{mayak_id: values.mayak_id}} locale={locale}
            fieldInfo={{mayak_id: {label: t('telemetry_values_tab.beacon_id', { defaultValue: 'Beacon ID' })}}} />
        )}
        {hasClock && <Row label={t(clockKey === 'eps_time_unix_s' ? 'telemetry_values_tab.power_system_time' : 'telemetry_values_tab.spacecraft_time', {
          defaultValue: clockKey === 'eps_time_unix_s' ? 'Power system time ({{timezone}})' : 'Spacecraft time ({{timezone}})', timezone,
        })} value={formatClock(clock)} />}
        {captureTime != null && <Row label={t('telemetry_values_tab.received_time', { defaultValue: 'Received ({{timezone}})', timezone })}
          value={formatClock(captureTime)} />}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: {xs: '1fr', md: 'repeat(2, minmax(0, 1fr))'}, gap: 2 }}>
        {Array.from(groups).filter(([, fields]) => Object.keys(fields).length > 0).map(([group, fields]) => {
          const title = t(`telemetry_values_tab.groups.${group}`, { defaultValue: TITLES[group] || readableLabel(group) });
          const orderedFields = Object.fromEntries(Object.entries(fields).sort(([left], [right]) =>
            fieldOrder(left, fieldInfo[left]) - fieldOrder(right, fieldInfo[right])));
          return <Box component="section" aria-label={title} key={group}
            sx={{ border: 1, borderColor: 'divider', borderRadius: 1, p: 2, minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{title}</Typography>
            <Divider sx={{ my: 1 }} />
            <Values values={orderedFields} fieldInfo={fieldInfo} locale={locale} scaleCurrents />
          </Box>;
        })}
      </Box>
      <RawFields fields={raw} label={t('telemetry_values_tab.raw_reserved_fields', { defaultValue: 'Raw fields and reserved bytes' })} />
    </Box>
  );
}
