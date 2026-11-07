import React from 'react';
import { Box, FormHelperText, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { formatSdrRate, getSdrSetting } from '../common/sdr-parameters.js';

export default function ReceiverStatus({ status, device, gain, sampleRate, antenna, settings }) {
    const { t } = useTranslation('waterfall');
    if (!status) return null;
    const unknown = t('sdr.readback_unavailable');
    const rows = [
        [t('sdr.gain_db'), status.gain_db == null ? unknown : `${status.gain_db} dB`, status.gain_db, gain],
        [t('sdr.antenna'), status.antenna || unknown, status.antenna, antenna],
        [t('sdr.if_bandwidth'), status.bandwidth_hz > 0 ? formatSdrRate(status.bandwidth_hz) : unknown],
        [t('sdr.sample_rate'), status.sample_rate > 0 ? formatSdrRate(status.sample_rate) : unknown,
            status.sample_rate, sampleRate],
        [t('sdr.gain_control'), status.agc == null ? unknown
            : t(status.agc ? 'sdr.gain_automatic' : 'sdr.gain_manual')],
        [t('settings_sdr.clock_source'), status.clock_source || unknown, status.clock_source,
            getSdrSetting(device, settings, 'clockSource')],
        [t('settings_sdr.time_source'), status.time_source || unknown, status.time_source,
            getSdrSetting(device, settings, 'timeSource')],
    ];
    return <Box sx={{ mt: 1 }} aria-label={t('sdr.hardware_readback')}>
        <Typography variant="caption" fontWeight="bold">{t('sdr.hardware_readback')}</Typography>
        <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
            {rows.map(([label, text, actual, requested]) => {
                const mismatch = actual != null && requested != null && requested !== 'none'
                    && (typeof actual === 'number' ? Math.abs(actual - Number(requested)) > 1e-6 : actual !== requested);
                return <React.Fragment key={label}>
                    <Typography component="dt" variant="caption" color="text.secondary">{label}</Typography>
                    <Typography component="dd" variant="caption" sx={{ m: 0 }} color={mismatch ? 'warning.main' : 'text.primary'}>
                        {text}{mismatch && ` (${t('sdr.requested_value', { value: requested })})`}
                    </Typography>
                </React.Fragment>;
            })}
        </Box>
        {Object.entries(status.configuration_errors || {}).map(([name, error]) =>
            <FormHelperText key={name} error>
                {t(name === 'clockSource' ? 'settings_sdr.clock_source' : 'settings_sdr.time_source')}: {error}
            </FormHelperText>)}
    </Box>;
}
