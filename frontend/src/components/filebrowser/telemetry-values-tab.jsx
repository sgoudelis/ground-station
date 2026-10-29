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

import React from 'react';
import { Alert, Box, Typography, Divider } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { RawFields, Row, Values } from './telemetry-fields.jsx';
import HousekeepingTelemetry, { isHousekeepingTelemetry } from './telemetry-housekeeping.jsx';

export default function TelemetryValuesTab({ telemetry, satellite, captureTime }) {
  const { t } = useTranslation('filebrowser');
  const values = telemetry?.telemetry?.values || null;
  const rawFields = telemetry?.telemetry?.raw_fields || telemetry?.telemetry?.rawFields || null;
  const payload = telemetry?.telemetry;
  const isLasarsat = payload?.satellite === 'LASARSAT' || satellite?.toUpperCase() === 'LASARSAT'
    || /^OK0LSR(?:-|$)/.test(telemetry?.frame?.source || '');

  // A USP AX.25 frame can carry several independent subsystem messages. Keep
  // their values together so repeated fields (time, current, etc.) stay unambiguous.
  if (payload?.format === 'usp' && Array.isArray(payload.messages)) {
    return (
      <Box>
        {payload.error && <Alert severity="warning" sx={{ mb: 2 }}>{payload.error}</Alert>}
        {payload.messages.map((message, index) => (
          <Box key={`${index}-${message.message_id}`} component="section" sx={{ mb: 3 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{message.name}</Typography>
            <Typography variant="caption" color="text.secondary">
              {t('telemetry_values_tab.usp_message', {
                defaultValue: 'USP {{id}} · Device {{source}} → {{destination}} · {{length}} bytes',
                id: message.message_id,
                source: message.source,
                destination: message.destination,
                length: message.length,
              })}
            </Typography>
            <Divider sx={{ my: 1 }} />
            {message.error ? (
              <Alert severity="warning">{message.error}</Alert>
            ) : message.status === 'decoded' ? (
              <Values values={message.values} fieldInfo={message.field_info} />
            ) : (
              <Typography variant="body2" color="text.secondary">
                {message.status === 'non_telemetry'
                  ? t('telemetry_values_tab.non_telemetry_message', { defaultValue: 'This message carries no satellite telemetry. Its bytes are available in Hex + ASCII.' })
                  : t('telemetry_values_tab.unsupported_message', { defaultValue: 'This message type is not decoded yet. Its bytes are available in Hex + ASCII.' })}
              </Typography>
            )}
            <RawFields fields={message.raw_fields} />
          </Box>
        ))}
      </Box>
    );
  }

  if (isLasarsat && payload?.format === 'malformed') {
    return <Alert severity="warning">{payload.error}</Alert>;
  }

  if (isLasarsat && payload?.format === 'text') {
    return <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{payload.text}</Typography>;
  }

  if (isHousekeepingTelemetry(telemetry)) {
    return <HousekeepingTelemetry payload={payload} satellite={satellite} captureTime={captureTime} />;
  }

  if (!values) {
    const error = telemetry?.error || payload?.error;
    if (error) return <Alert severity="warning">{error}</Alert>;
    return (
      <Box>
        <Typography variant="body2" color="text.secondary">
          {t('telemetry_values_tab.no_decoded_telemetry_available_for_this_packet', { defaultValue: 'No decoded telemetry available for this packet.' })}
        </Typography>
        {isLasarsat && <Alert severity="info" sx={{mt: 2}}>
          {t('telemetry_values_tab.saved_packet_needs_decode', {defaultValue: 'This packet has no saved telemetry values. Connect to the backend and reopen it to decode, or use Reparse telemetry.'})}
        </Alert>}
      </Box>
    );
  }

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
        {isLasarsat
          ? t('telemetry_values_tab.lasarsat_beacon_values', { defaultValue: 'LASARSAT {{type}} beacon values', type: payload.type })
          : t('telemetry_values_tab.engineering_values', { defaultValue: 'Engineering Values' })}
      </Typography>
      <Divider sx={{ mb: 2 }} />
      {isLasarsat && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('telemetry_values_tab.lasarsat_raw_values', { defaultValue: 'Values are shown as transmitted; this decoder does not apply unit scaling.' })}
        </Alert>
      )}
      <Box>
        {payload.time_utc && (
          <Row label={t('telemetry_values_tab.spacecraft_time_utc', { defaultValue: 'Spacecraft time (UTC)' })}
            value={payload.time_utc} />
        )}
        <Values values={Object.fromEntries(Object.entries(values).filter(([key]) =>
          !payload.time_utc || !['time_unix_s', 'eps_time_unix_s'].includes(key)
        ))} fieldInfo={payload?.field_info} />
      </Box>

      <RawFields fields={rawFields} />
    </Box>
  );
}
