import React, { useEffect } from 'react';
import {
    Box, Chip, FormControl, IconButton, InputLabel, MenuItem, Select, Stack, Tooltip, Typography,
} from '@mui/material';
import MemoryIcon from '@mui/icons-material/Memory';
import RefreshIcon from '@mui/icons-material/Refresh';
import { useTranslation } from 'react-i18next';
import SdrParameterFields from '../common/sdr-parameter-fields.jsx';
import {
    DEFAULT_SDR_SAMPLE_RATES, getSdrSampleRates, isSdrBandwidthUnavailable, normalizeSdrGain, setSdrSetting,
} from '../common/sdr-parameters.js';

export default function SdrSessionFields({
    sdr, sdrs, parameters, loading, error, disabled = false,
    isSdrUsedByAnotherSession, onChange, onRefresh, validationErrors = {}, bandwidthValidation,
}) {
    const { t } = useTranslation(['common', 'waterfall']);
    const id = React.useId();
    const device = sdrs.find((entry) => String(entry.id) === String(sdr.id));

    useEffect(() => {
        if (disabled || loading || !parameters) return;
        const normalized = normalizeSdrGain(device, parameters.capabilities, sdr);
        if (normalized !== sdr) onChange({ gain: normalized.gain, sdr_settings: normalized.sdr_settings });
    }, [device, parameters, sdr, disabled, loading, onChange]);

    useEffect(() => {
        const rates = getSdrSampleRates(parameters);
        if (disabled || !rates.length || !sdr.id || loading || rates.includes(Number(sdr.sample_rate))) return;
        // A device's actual rates replace the generic new-session default.
        // Preserve invalid/missing inputs so validation can still explain them.
        if (Number(sdr.sample_rate) > 0) {
            const nearest = rates.reduce((best, rate) =>
                Math.abs(rate - sdr.sample_rate) < Math.abs(best - sdr.sample_rate) ? rate : best);
            onChange({ sample_rate: nearest });
        }
    }, [sdr.id, sdr.sample_rate, parameters, loading, disabled, onChange]);

    return <>
        <Stack direction="row" spacing={1} alignItems="center">
            <FormControl fullWidth size="small" required disabled={disabled}
                error={!disabled && Boolean(validationErrors.sdr || error || isSdrUsedByAnotherSession(sdr.id))}
            >
                <InputLabel id={`${id}-sdr-label`}>{t('scheduler_dialogs.shared.sdr_label')}</InputLabel>
                <Select labelId={`${id}-sdr-label`} label={t('scheduler_dialogs.shared.sdr_label')}
                    value={sdr.id}
                    onChange={(event) => {
                        const nextId = event.target.value;
                        if (isSdrUsedByAnotherSession(nextId)) return;
                        const nextDevice = sdrs.find((entry) => String(entry.id) === String(nextId));
                        // Advanced settings and gain stage names belong to one physical device.
                        onChange({
                            id: nextId, name: nextDevice?.name || '', gain: '', antenna_port: '',
                            bias_t: false, tuner_agc: false, soapy_agc: false, rtl_agc: false,
                            sdr_settings: {},
                        });
                    }}
                >
                    {sdrs.filter((entry) => entry.id !== 'sigmf-playback' && entry.type !== 'sigmfplayback').map((entry) => {
                        const used = isSdrUsedByAnotherSession(entry.id);
                        return <MenuItem key={entry.id} value={entry.id} disabled={used}>
                            <Box sx={{ width: '100%', minWidth: 0 }}>
                                <Stack direction="row" spacing={1} alignItems="center">
                                    <MemoryIcon sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />
                                    <Typography variant="body2">{entry.name} ({entry.type})</Typography>
                                    {used && <Chip size="small" variant="outlined"
                                        label={t('scheduler_dialogs.shared.sdr_in_use_by_another_session')}
                                        sx={{ ml: 'auto', flexShrink: 0 }}
                                    />}
                                </Stack>
                                <Typography variant="caption" color="text.secondary">
                                    {[
                                        entry.driver ? `Driver: ${entry.driver}` : null,
                                        entry.serial ? `Serial: ${entry.serial}` : null,
                                    ].filter(Boolean).join(' • ') || t('scheduler_dialogs.shared.no_additional_details')}
                                </Typography>
                            </Box>
                        </MenuItem>;
                    })}
                </Select>
            </FormControl>
            <Tooltip title={t('waterfall:sdr.refresh_params')}>
                <span><IconButton aria-label={t('waterfall:sdr.refresh_params')}
                    disabled={disabled || loading || !sdr.id} onClick={onRefresh}
                ><RefreshIcon /></IconButton></span>
            </Tooltip>
        </Stack>
        <SdrParameterFields
            device={device}
            parameters={{ ...parameters, sample_rate_values: getSdrSampleRates(parameters, DEFAULT_SDR_SAMPLE_RATES) }}
            value={sdr}
            onChange={(name, value) => onChange({ [name]: value === 'none' ? '' : value })}
            onSettingChange={(name, value) => onChange({ sdr_settings: setSdrSetting(device, sdr.sdr_settings, name, value) })}
            disabled={disabled || loading || !sdr.id}
            required
            labels={{
                gain: t('scheduler_dialogs.shared.gain_label'),
                sampleRate: t('scheduler_dialogs.shared.sample_rate_label'),
                antenna: t('scheduler_dialogs.shared.antenna_port_label'),
            }}
            validationErrors={disabled ? {} : {
                ...validationErrors,
                bandwidth: isSdrBandwidthUnavailable(sdr, device, parameters),
            }}
            showRequiredHelp={false}
            sampleRateHelp={bandwidthValidation?.details?.length > 0 && <>
                <Typography variant="caption" color={bandwidthValidation.valid ? 'success.main' : 'error'}>
                    {bandwidthValidation.valid
                        ? t('scheduler_dialogs.shared.all_tasks_fit_within_bandwidth')
                        : bandwidthValidation.message}
                </Typography>
                {!bandwidthValidation.valid && <Typography variant="caption" display="block" sx={{ fontFamily: 'monospace' }}>
                    {((bandwidthValidation.maxFreq - bandwidthValidation.minFreq) / 1000000).toFixed(3)} MHz
                </Typography>}
            </>}
        />
    </>;
}
