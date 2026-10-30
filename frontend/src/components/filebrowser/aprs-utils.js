const APRS_DATA_TYPES = {
    '!': 'Position without timestamp',
    '=': 'Position with messaging',
    '/': 'Position with timestamp',
    '@': 'Position with timestamp and messaging',
    ';': 'Object',
    ')': 'Item',
    ':': 'Message',
    '>': 'Status',
    T: 'Telemetry',
    _: 'Weather',
    '`': 'Mic-E',
    "'": 'Mic-E (old)',
};

export function getAprsData(metadata) {
    // Older text is interpreted by the backend compatibility adapter.
    return metadata?.telemetry?.payload?.aprs || null;
}

export function getAprsDataTypeLabel(aprs) {
    const identifier = aprs?.data_type_identifier;
    return APRS_DATA_TYPES[identifier]
        || String(aprs?.data_type || 'Unknown').replaceAll('_', ' ');
}
