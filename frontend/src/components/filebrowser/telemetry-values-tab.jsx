/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 */

import React from 'react';
import { Box, Typography, Divider } from '@mui/material';
import { useTranslation } from 'react-i18next';

function Row({ label, value }) {
  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      alignItems: 'center',
      py: 0.75,
      columnGap: 2,
    }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{value}</Typography>
    </Box>
  );
}

export default function TelemetryValuesTab({ telemetry }) {
    const { t } = useTranslation('filebrowser');
  const values = telemetry?.telemetry?.values || null;
  const rawFields = telemetry?.telemetry?.raw_fields || telemetry?.telemetry?.rawFields || null;

  if (!values) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t('telemetry_values_tab.no_decoded_telemetry_available_for_this_packet', { defaultValue: 'No decoded telemetry available for this packet.' })}
      </Typography>
    );
  }

  return (
    <Box>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('telemetry_values_tab.engineering_values', { defaultValue: 'Engineering Values' })}</Typography>
      <Divider sx={{ mb: 2 }} />
      <Box>
        {Object.entries(values).map(([k, v]) => (
          <Row
            key={k}
            label={k}
            value={typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}
          />
        ))}
      </Box>

      {rawFields && (
        <Box sx={{ mt: 3 }}>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>{t('telemetry_values_tab.raw_fields', { defaultValue: 'Raw Fields' })}</Typography>
          <Divider sx={{ mb: 2 }} />
          {Object.entries(rawFields).map(([k, v]) => (
            <Row key={k} label={k} value={String(v)} />
          ))}
        </Box>
      )}
    </Box>
  );
}
