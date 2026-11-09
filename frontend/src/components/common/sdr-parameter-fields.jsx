import React from 'react';
import {
    Box, FormControl, FormControlLabel, FormHelperText, InputLabel,
    MenuItem, Select, Switch,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import {
    formatSdrRate, getSdrBandwidthOptions, getSdrGainEntries, getSdrGainOptions, getSdrSampleRates,
    getSdrBandwidthRanges, getSdrSetting, hasSingleUhdGain, isSdrBandwidthSupported,
} from './sdr-parameters.js';

function ParameterSelect({ id, label, value, options, disabled, error, required, onChange, help }) {
    return (
        <FormControl fullWidth size="small" disabled={disabled} error={Boolean(error)} required={required}>
            <InputLabel id={`${id}-label`}>{label}</InputLabel>
            <Select
                labelId={`${id}-label`} label={label} value={value}
                aria-describedby={help ? `${id}-help` : undefined}
                onChange={(event) => onChange(event.target.value)}
            >
                {options.map((option) => (
                    <MenuItem key={option.value} value={option.value} disabled={option.disabled}>
                        {option.label}
                    </MenuItem>
                ))}
            </Select>
            {help && <FormHelperText component="div" id={`${id}-help`}>{help}</FormHelperText>}
        </FormControl>
    );
}

// Both live reception and scheduled sessions use the same capability rules and values.
// Callers own state and decide whether a change is applied now or saved for later.
export default function SdrParameterFields({
    device, parameters = {}, value = {}, onChange, onSettingChange,
    disabled = false, fixedDisabled = false, gainDisabled = false,
    isStreaming = false, isRecording = false, bandwidthStatus,
    labels = {}, required = false, validationErrors = {}, sampleRateHelp, showRequiredHelp = true, columns = 1,
}) {
    const { t } = useTranslation('waterfall');
    const id = React.useId();
    const capabilities = parameters.capabilities || {};
    const settings = value.sdr_settings || {};
    const sampleRates = getSdrSampleRates(parameters);
    const gains = [...(parameters.gain_values || [])];
    // A live receiver can accept values between the advertised gain steps.
    // Preserve those selections when opening a form with a fresh capability list.
    if (Number.isFinite(value.gain) && !gains.includes(value.gain)) gains.push(value.gain);
    const antennas = parameters.antennas?.rx || [];
    // Native UHD supports overall gain only. A single SoapyUHD PGA is the
    // same physical gain as the overall control, so it must not compete with it.
    const gainEntries = device?.type === 'uhd' || hasSingleUhdGain(device, capabilities)
        ? [] : getSdrGainEntries(capabilities);
    const bandwidths = getSdrBandwidthOptions(device, capabilities, value.sample_rate);
    const hasBandwidth = ['uhd', 'soapysdrlocal', 'soapysdrremote'].includes(device?.type)
        && (getSdrBandwidthRanges(device, capabilities).length > 0
            || capabilities.bandwidths?.rx?.some((width) => Number.isFinite(width) && width > 0));
    const bandwidth = getSdrSetting(device, settings, 'bandwidth') ?? 'driver';
    const savedBandwidthSupported = isSdrBandwidthSupported(device, capabilities, value.sample_rate, bandwidth);
    const currentBandwidthStatus = isStreaming && bandwidthStatus
        && bandwidthStatus.mode === bandwidth
        && bandwidthStatus.sample_rate === Number(value.sample_rate);
    const bitpack = capabilities.settings?.find((setting) =>
        String(setting?.key || '').toLowerCase() === 'bitpack'
        || String(setting?.name || '').toLowerCase().includes('bit pack'));
    const notConfigured = { value: 'none', label: t('settings_sdr.not_configured'), disabled: isStreaming };
    const selectProps = { disabled, required };
    const changed = (name) => (nextValue) => onChange?.(name, nextValue);
    const settingChanged = (name) => (nextValue) => onSettingChange?.(name, nextValue === 'none' ? null : nextValue);
    const isSdrplay = String(device?.driver || '').toLowerCase() === 'sdrplay';
    const antennaLabel = (port) => {
        const label = String(device?.antenna_labels?.rx?.[port] || '').trim();
        return label && label !== port ? `${label} (${port})` : port;
    };

    return (
        <Box sx={{ display: 'grid', gap: 1, alignItems: 'start',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: `repeat(${columns}, minmax(0, 1fr))` },
        }}>
            <ParameterSelect {...selectProps}
                id={`${id}-gain`} label={labels.gain || t('sdr.gain_db')}
                disabled={disabled || gainDisabled} error={validationErrors.gain}
                value={gains.includes(value.gain) ? value.gain : 'none'}
                options={[
                    { ...notConfigured, label: t('sdr.no_gain_selected') },
                    ...gains.map((gain) => ({ value: gain, label: `${gain} dB` })),
                ]}
                onChange={changed('gain')}
                help={showRequiredHelp && validationErrors.gain && t('sdr.gain_required')}
            />
            {gainEntries.map(([name, range]) => {
                const options = getSdrGainOptions(range);
                if (!options.length) return null;
                const selectedGain = settings.gains?.[name];
                if (Number.isFinite(selectedGain) && !options.includes(selectedGain)) options.push(selectedGain);
                const lnaState = isSdrplay && name === 'RFGR';
                const label = lnaState
                    ? t('settings_sdr.lna_attenuation_state', { defaultValue: 'LNA attenuation state (RFGR)' })
                    : isSdrplay && name === 'IFGR'
                        ? t('settings_sdr.if_gain_reduction', { defaultValue: 'IF gain reduction (IFGR)' })
                        : `Gain ${name}`;
                return <ParameterSelect key={name}
                    id={`${id}-gain-${name}`} label={label} disabled={disabled}
                    value={selectedGain ?? 'none'}
                    options={[notConfigured, ...options.map((gain) => ({
                        value: gain, label: lnaState ? gain : `${gain} dB`,
                    }))]}
                    onChange={(gain) => onSettingChange?.('gains', {
                        ...settings.gains, [name]: gain === 'none' ? null : gain,
                    })}
                />;
            })}
            <ParameterSelect {...selectProps}
                id={`${id}-sample-rate`} label={labels.sampleRate || t('sdr.sample_rate')}
                disabled={disabled || fixedDisabled || isRecording} error={validationErrors.sampleRate}
                value={sampleRates.includes(Number(value.sample_rate)) ? Number(value.sample_rate) : 'none'}
                options={[
                    { ...notConfigured, label: t('sdr.no_rate_selected') },
                    ...sampleRates.map((rate) => ({ value: rate, label: formatSdrRate(rate) })),
                ]}
                onChange={changed('sample_rate')}
                help={sampleRateHelp || (showRequiredHelp && validationErrors.sampleRate && t('sdr.sample_rate_required'))}
            />
            {hasBandwidth && <ParameterSelect
                id={`${id}-bandwidth`} label={t('sdr.if_bandwidth')}
                disabled={disabled || fixedDisabled || isRecording}
                error={validationErrors.bandwidth || (currentBandwidthStatus && bandwidthStatus.error)}
                value={bandwidth}
                options={[
                    { value: 'auto', label: t('sdr.if_bandwidth_auto') },
                    { value: 'driver', label: t('sdr.if_bandwidth_driver') },
                    ...bandwidths.map((width) => ({ value: width, label: formatSdrRate(width) })),
                    ...(typeof bandwidth === 'number' && !bandwidths.includes(bandwidth)
                        ? [{ value: bandwidth, label: `${formatSdrRate(bandwidth)}${savedBandwidthSupported ? '' : ` (${t('sdr.if_bandwidth_unavailable')})`}`, disabled: !savedBandwidthSupported }]
                        : []),
                ]}
                onChange={settingChanged('bandwidth')}
                help={currentBandwidthStatus && <>
                    {bandwidthStatus.actual_hz > 0 && t('sdr.if_bandwidth_applied', { value: formatSdrRate(bandwidthStatus.actual_hz) })}
                    {bandwidthStatus.actual_hz > 0 && bandwidthStatus.actual_hz < value.sample_rate
                        && ` · ${t('sdr.if_bandwidth_limited')}`}
                    {bandwidthStatus.error && ` ${bandwidthStatus.error}`}
                </>}
            />}
            <ParameterSelect {...selectProps}
                id={`${id}-antenna`} label={labels.antenna || t('sdr.antenna')}
                disabled={disabled || fixedDisabled || isRecording} error={validationErrors.antenna}
                value={antennas.includes(value.antenna_port) ? value.antenna_port : 'none'}
                options={[
                    { ...notConfigured, label: t('sdr.no_antenna_selected') },
                    ...antennas.map((port) => ({ value: port, label: antennaLabel(port) })),
                ]}
                onChange={changed('antenna_port')}
                help={showRequiredHelp && validationErrors.antenna && t('sdr.antenna_required')}
            />
            {['clock', 'time'].map((source) => {
                const options = (capabilities[`${source}_sources`] || [])
                    .filter((option) => String(option).trim().toLowerCase() !== 'none');
                if (!options.length) return null;
                const selection = getSdrSetting(device, settings, `${source}Source`) ?? capabilities[`${source}_source`];
                return <ParameterSelect key={source}
                    id={`${id}-${source}`} label={t(`settings_sdr.${source}_source`)}
                    disabled={disabled || fixedDisabled || isRecording}
                    value={options.includes(selection) ? selection : 'none'}
                    options={[notConfigured, ...options.map((option) => ({ value: option, label: option }))]}
                    onChange={settingChanged(`${source}Source`)}
                />;
            })}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', ml: 1.5, gridColumn: '1 / -1' }}>
                {[
                    { name: 'bias_t', supported: parameters.has_bias_t || capabilities.bias_t?.supported, label: t('sdr.enable_bias_t') },
                    { name: 'bitpack', supported: bitpack, label: t('settings_sdr.bit_packing'), setting: true },
                    { name: 'tuner_agc', supported: parameters.has_tuner_agc, label: t('sdr.enable_tuner_agc') },
                    { name: 'soapy_agc', supported: parameters.has_soapy_agc, label: t('sdr.enable_agc') },
                    { name: 'rtl_agc', supported: parameters.has_rtl_agc, label: t('sdr.enable_rtl_agc') },
                ].filter((control) => control.supported).map((control) => (
                    <FormControlLabel key={control.name} label={control.label} control={
                        <Switch size="small" disabled={disabled}
                            checked={Boolean(control.setting ? settings.bitpack ?? bitpack?.value : value[control.name])}
                            onChange={(event) => (control.setting ? onSettingChange : onChange)?.(control.name, event.target.checked)}
                        />
                    } />
                ))}
            </Box>
        </Box>
    );
}
