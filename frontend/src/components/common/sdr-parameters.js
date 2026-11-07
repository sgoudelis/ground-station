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

export const isUhdDevice = (device) => device?.type === 'uhd'
    || String(device?.driver).toLowerCase() === 'uhd';

export const hasSingleUhdGain = (device, capabilities) => {
    const names = capabilities?.gain_elements?.rx?.length
        ? capabilities.gain_elements.rx : Object.keys(capabilities?.gain_ranges?.rx || {});
    return isUhdDevice(device) && names.length === 1 && names[0] === 'PGA';
};

// Native UHD used to ignore these fields. A separate namespace prevents old
// saved selections from becoming active simply because the app was upgraded.
const nativeSetting = (device, name) => device?.type === 'uhd'
    && ['bandwidth', 'clockSource', 'timeSource'].includes(name);
export const getSdrSetting = (device, settings, name) => nativeSetting(device, name)
    ? settings?.uhd?.[name] : settings?.[name];
export const setSdrSetting = (device, settings, name, value) => nativeSetting(device, name)
    ? { ...settings, uhd: { ...settings?.uhd, [name]: value } }
    : { ...settings, [name]: value };

export const normalizeSdrGain = (device, capabilities, value, preserveLegacy = true) => {
    const settings = value.sdr_settings || {};
    if (!hasSingleUhdGain(device, capabilities) || !Object.hasOwn(settings.gains || {}, 'PGA')) return value;
    const { PGA, ...gains } = settings.gains;
    // SoapyUHD applied the stage after overall gain; native UHD ignored it.
    // Preserve the old effective value when loading, but explicit gain edits win.
    const gain = preserveLegacy && device?.type !== 'uhd' && Number.isFinite(PGA) ? PGA : value.gain;
    return { ...value, gain, sdr_settings: { ...settings, gains } };
};

export const getSdrBandwidthRanges = (device, capabilities) => isUhdDevice(device)
    ? (capabilities?.bandwidth_ranges?.rx || []).filter((range) =>
        Number.isFinite(range.min) && Number.isFinite(range.max) && range.min > 0 && range.max >= range.min)
    : [];

export const isSdrBandwidthSupported = (device, capabilities, sampleRate, width) => {
    const ranges = getSdrBandwidthRanges(device, capabilities);
    if (ranges.length) return ranges.some(({ min, max, step }) => width >= min && width <= max
        && (!step || Math.abs((width - min) / step - Math.round((width - min) / step)) < 1e-6));
    return getSdrBandwidthOptions(device, capabilities, sampleRate).includes(width);
};

export const getSdrGainOptions = ({ min, max, step }) => {
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return [];
    // Soapy drivers can omit the increment, including SDRplay's RFGR/IFGR.
    const increment = Number.isFinite(step) && step > 0 ? step : 1;
    const count = Math.min(200, Math.floor((max - min) / increment + 1e-9) + 1);
    return Array.from({ length: count }, (_, index) => Number((min + index * increment).toFixed(6)));
};

export const getSdrBandwidthOptions = (device, capabilities, sampleRate) => {
    if (!['uhd', 'soapysdrlocal', 'soapysdrremote'].includes(device?.type)) return [];
    const ranges = getSdrBandwidthRanges(device, capabilities);
    const candidates = [...(capabilities?.bandwidths?.rx || [])];
    // Offer useful widths inside continuous UHD ranges, including the exact
    // sampled span. Arbitrary saved widths remain valid when inside a range.
    if (ranges.length) {
        for (const range of ranges) {
            for (const rate of [...DEFAULT_SDR_SAMPLE_RATES, Number(sampleRate), range.min, range.max]) {
                const width = range.step > 0
                    ? range.min + Math.ceil((rate - range.min) / range.step - 1e-9) * range.step : rate;
                if (width >= range.min && width <= range.max) candidates.push(width);
            }
        }
    }
    return [...new Set(candidates)]
        .filter((width) => Number.isFinite(width) && width > 0
            // Low-rate SDRplay modes cannot use the wide zero-IF filters.
            && !(String(device?.driver).toLowerCase() === 'sdrplay'
                && sampleRate <= 2000000 && width > 1536000))
        .sort((left, right) => left - right);
};

export const getSdrCaptureBandwidth = (sdr, device, parameters) => {
    const rate = Number(sdr?.sample_rate);
    const selection = getSdrSetting(device, sdr?.sdr_settings, 'bandwidth');
    if (typeof selection === 'number' && selection > 0) return Math.min(rate, selection);
    if (selection === 'auto') {
        const widths = getSdrBandwidthOptions(device, parameters?.capabilities, rate);
        if (widths.length) return Math.min(rate, widths.find((width) => width >= rate) ?? widths.at(-1));
    }
    return rate;
};

export const isSdrBandwidthUnavailable = (sdr, device, parameters) => {
    const selection = getSdrSetting(device, sdr?.sdr_settings, 'bandwidth');
    return typeof selection === 'number' && parameters != null
        && !isSdrBandwidthSupported(device, parameters.capabilities, sdr.sample_rate, selection);
};
