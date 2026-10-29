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
import { Box, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

export function normalizeTelemetryValue(entry, fieldInfo = {}) {
  // Older metadata wraps measurements in {value, unit}; newer parsers keep
  // scalar values and put their presentation metadata in field_info.
  const wrapped = entry && typeof entry === 'object' && !Array.isArray(entry)
    && ('value' in entry || 'error' in entry);
  const error = wrapped ? entry.error : null;
  const value = error ? null : wrapped ? entry.value : entry;
  const unit = fieldInfo.unit ?? (wrapped ? entry.unit : '') ?? '';
  return {
    value: typeof value === 'number' && !Number.isFinite(value) ? null : value,
    unit: typeof unit === 'string' ? unit : '',
    error,
  };
}

export function Row({ label, value, error }) {
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
      alignItems: 'center', py: 0.75, columnGap: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{label}</Typography>
      <Typography variant="body2" title={error || undefined}
        sx={{ fontFamily: 'monospace', textAlign: 'right', overflowWrap: 'anywhere' }}>{value}</Typography>
    </Box>
  );
}

export function Values({ values, fieldInfo = {}, locale, scaleCurrents = false }) {
  const { t } = useTranslation('filebrowser');
  const formatValue = (value) => {
    if (value === null || value === undefined) {
      return t('telemetry_values_tab.unavailable', { defaultValue: 'Unavailable' });
    }
    if (typeof value === 'boolean') {
      return value
        ? t('telemetry_values_tab.yes', { defaultValue: 'Yes' })
        : t('telemetry_values_tab.no', { defaultValue: 'No' });
    }
    if (typeof value === 'number') {
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 6 }).format(value);
    }
    return typeof value === 'object' ? JSON.stringify(value) : String(value);
  };

  return Object.entries(values).map(([key, entry]) => {
    const info = fieldInfo[key] || {};
    const reading = normalizeTelemetryValue(entry, info);
    let { value, unit } = reading;
    // Calibration metadata is authoritative: an uncalibrated reading cannot
    // acquire physical units from a legacy wrapper or a display fallback.
    const uncalibrated = info.calibrated === false;
    if (uncalibrated) unit = '';
    // Keep the transmitted/scaled measurement intact; choose display units only.
    if (scaleCurrents && unit === 'A' && typeof value === 'number' && Math.abs(value) < 1) {
      value *= 1000;
      unit = 'mA';
    }
    const suffix = value == null ? '' : uncalibrated
      ? ` (${t('telemetry_values_tab.raw_reading', { defaultValue: 'raw' })})` : unit ? ` ${unit}` : '';
    return <Row key={key} label={info.label || key} value={`${formatValue(value)}${suffix}`} error={reading.error} />;
  });
}

export function RawFields({ fields, label }) {
  const { t } = useTranslation('filebrowser');
  if (!fields || Object.keys(fields).length === 0) return null;
  return (
    <Box component="details" sx={{ mt: 2 }}>
      <Typography component="summary" variant="body2" sx={{ cursor: 'pointer', fontWeight: 600 }}>
        {label || t('telemetry_values_tab.raw_fields', { defaultValue: 'Raw Fields' })}
      </Typography>
      {Object.entries(fields).map(([key, value]) => (
        <Row key={key} label={key}
          value={value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value)} />
      ))}
    </Box>
  );
}
