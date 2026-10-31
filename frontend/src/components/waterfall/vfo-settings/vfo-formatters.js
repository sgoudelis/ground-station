/**
 * VFO Formatters
 *
 * Pure formatting functions for VFO decoder parameters and display values
 */

/**
 * Get framing protocol shorthand notation
 * @param {string} framing - Framing protocol name
 * @returns {string} Shorthand notation
 */
export const getFramingShort = (framing) => {
    const framingMap = {
        'ax25': 'AX25',
        'aprs': 'APRS',
        'raw': 'RAW',
        'ccsds': 'CCSDS',
        'custom': 'CUST',
    };
    return framingMap[framing] || framing.toUpperCase();
};

/**
 * Format baudrate compactly (e.g., 1k2bd, 9k6bd)
 * @param {number} baudrate - Baudrate in baud
 * @returns {string} Formatted baudrate string
 */
export const formatBaudrate = (baudrate) => {
    if (baudrate >= 1000) {
        const k = Math.floor(baudrate / 1000);
        const remainder = (baudrate % 1000) / 100;
        if (remainder === 0) {
            return `${k}kbd`;
        }
        return `${k}k${remainder}bd`;
    }
    return `${baudrate}bd`;
};

/**
 * Format decoder parameters into short summary notation
 * @param {object} vfo - VFO configuration object
 * @returns {string} Formatted summary string
 */
export const formatDecoderParamsSummary = (vfo) => {
    if (!vfo || !vfo.decoder || vfo.decoder === 'none') return '';

    const decoder = vfo.decoder;
    const params = vfo.parameters || {};

    if (decoder === 'lora') {
        const sf = params.lora_sf ?? 7;
        const bw = params.lora_bw ?? 125000;
        const cr = params.lora_cr ?? 1;
        const bwKhz = bw / 1000;
        return `SF${sf} BW${bwKhz}kHz CR4/${cr + 4}`;
    }

    if (decoder === 'radiosonde') {
        const family = { auto: 'Auto', rs41: 'RS41', dfm: 'DFM', m10m20: 'M10/M20' }[params.radiosonde_type ?? 'auto'];
        return `${family} ${(params.radiosonde_sample_rate ?? 48000) / 1000}kS/s`;
    }

    if (decoder === 'gnss') {
        const sampleRate = params.gnss_sample_rate ?? 4000000;
        const channels = params.gnss_total_channels ?? 24;
        const enabled = [];
        if (params.gnss_enable_gps ?? true) enabled.push('GPS');
        if (params.gnss_enable_galileo ?? true) enabled.push('GAL');
        if (params.gnss_enable_glonass ?? true) enabled.push('GLO');
        if (params.gnss_enable_beidou ?? true) enabled.push('BDS');
        if (params.gnss_enable_qzss ?? true) enabled.push('QZS');
        const constellations = enabled.length > 0 ? enabled.join('/') : 'GPS';
        return `${constellations} ${(sampleRate / 1000000).toFixed(1)}MS/s CH${channels}`;
    }

    if (decoder === 'fsk') {
        const baudrate = params.fsk_baudrate ?? 9600;
        const deviation = params.fsk_deviation ?? 5000;
        const framing = params.fsk_framing ?? 'ax25';
        const devKhz = deviation >= 1000 ? `${(deviation / 1000).toFixed(1)}k` : `${deviation}`;
        return `${formatBaudrate(baudrate)} ±${devKhz} ${getFramingShort(framing)}`;
    }

    if (decoder === 'gmsk') {
        const baudrate = params.gmsk_baudrate ?? 9600;
        const deviation = params.gmsk_deviation ?? 5000;
        const framing = params.gmsk_framing ?? 'ax25';
        const devKhz = deviation >= 1000 ? `${(deviation / 1000).toFixed(1)}k` : `${deviation}`;
        return `${formatBaudrate(baudrate)} ±${devKhz} ${getFramingShort(framing)}`;
    }

    if (decoder === 'gfsk') {
        const baudrate = params.gfsk_baudrate ?? 9600;
        const deviation = params.gfsk_deviation ?? 5000;
        const framing = params.gfsk_framing ?? 'ax25';
        const devKhz = deviation >= 1000 ? `${(deviation / 1000).toFixed(1)}k` : `${deviation}`;
        return `${formatBaudrate(baudrate)} ±${devKhz} ${getFramingShort(framing)}`;
    }

    if (decoder === 'bpsk') {
        const baudrate = params.bpsk_baudrate ?? 9600;
        const framing = params.bpsk_framing ?? 'ax25';
        const differential = params.bpsk_differential ?? false;
        return `${formatBaudrate(baudrate)} ${getFramingShort(framing)}${differential ? ' DIFF' : ''}`;
    }

    if (decoder === 'aprs') {
        const baudrate = params.aprs_baudrate ?? 1200;
        const af_carrier = params.aprs_af_carrier ?? 1700;
        const deviation = params.aprs_deviation ?? 500;
        const carrierKhz = af_carrier >= 1000 ? `${(af_carrier / 1000).toFixed(1)}k` : `${af_carrier}`;
        return `${formatBaudrate(baudrate)} ${carrierKhz}Hz ±${deviation} APRS`;
    }

    // Default for decoders without parameters
    return 'Configure...';
};
