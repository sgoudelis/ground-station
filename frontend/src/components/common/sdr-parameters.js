export const DEFAULT_SDR_SAMPLE_RATES = [
    500000, 1000000, 2000000, 2400000, 3000000, 4000000,
    5000000, 6000000, 8000000, 10000000, 12000000, 16000000,
];

// Keep the full Hz precision after converting units, including decimated rates.
export const formatSdrRate = (value) => {
    const rate = Number(value);
    if (!Number.isFinite(rate) || rate <= 0) return '—';
    const divisor = rate >= 1000000 ? 1000000 : 1000;
    return `${Number((rate / divisor).toFixed(9))} ${divisor === 1000000 ? 'MHz' : 'kHz'}`;
};

export const getSdrSampleRates = (parameters, fallback = []) =>
    (parameters?.sample_rate_values ?? fallback)
        .map((rate) => Number(typeof rate === 'object' ? rate?.value : rate))
        .filter((rate) => Number.isFinite(rate) && rate > 0);

export const getSdrGainEntries = (capabilities) => {
    const names = capabilities?.gain_elements?.rx;
    return Object.entries(capabilities?.gain_ranges?.rx || {})
        .filter(([name]) => !names?.length || names.includes(name));
};

export const getSdrGainOptions = ({ min, max, step }) => {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return [];
    // Soapy drivers can omit the increment, including SDRplay's RFGR/IFGR.
    const increment = Number.isFinite(step) && step > 0 ? step : 1;
    const count = Math.min(200, Math.floor((max - min) / increment + 1e-9) + 1);
    return Array.from({ length: count }, (_, index) => Number((min + index * increment).toFixed(6)));
};

export const getSdrBandwidthOptions = (device, capabilities, sampleRate) => {
    if (!['soapysdrlocal', 'soapysdrremote'].includes(device?.type)) return [];
    return [...new Set(capabilities?.bandwidths?.rx || [])]
        .filter((width) => Number.isFinite(width) && width > 0
            // Low-rate SDRplay modes cannot use the wide zero-IF filters.
            && !(String(device?.driver).toLowerCase() === 'sdrplay'
                && sampleRate <= 2000000 && width > 1536000))
        .sort((left, right) => left - right);
};

export const getSdrCaptureBandwidth = (sdr, device, parameters) => {
    const rate = Number(sdr?.sample_rate);
    const selection = sdr?.sdr_settings?.bandwidth;
    if (typeof selection === 'number' && selection > 0) return Math.min(rate, selection);
    if (selection === 'auto') {
        const widths = getSdrBandwidthOptions(device, parameters?.capabilities, rate);
        if (widths.length) return Math.min(rate, widths.find((width) => width >= rate) ?? widths.at(-1));
    }
    return rate;
};

export const isSdrBandwidthUnavailable = (sdr, device, parameters) => {
    const selection = sdr?.sdr_settings?.bandwidth;
    return typeof selection === 'number' && parameters != null
        && !getSdrBandwidthOptions(device, parameters.capabilities, sdr.sample_rate).includes(selection);
};
