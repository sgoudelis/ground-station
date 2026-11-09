export const normalizeDateInput = (dateInput) => {
    if (!dateInput) return null;
    const dateObj = dateInput instanceof Date ? dateInput : new Date(dateInput);
    if (Number.isNaN(dateObj.getTime())) return null;
    return dateObj;
};

export const formatDateTime = (dateInput, { timezone, locale, options } = {}) => {
    const dateObj = normalizeDateInput(dateInput);
    if (!dateObj) return '';

    const formatOptions = { ...options };
    if (timezone) {
        formatOptions.timeZone = timezone;
    }

    return dateObj.toLocaleString(locale, formatOptions);
};

export const formatDate = (dateInput, { timezone, locale, options } = {}) => {
    const dateObj = normalizeDateInput(dateInput);
    if (!dateObj) return '';

    const formatOptions = { ...options };
    if (timezone) {
        formatOptions.timeZone = timezone;
    }

    return dateObj.toLocaleDateString(locale, formatOptions);
};

export const formatTime = (dateInput, { timezone, locale, options } = {}) => {
    const dateObj = normalizeDateInput(dateInput);
    if (!dateObj) return '';

    const formatOptions = { ...options };
    if (timezone) {
        formatOptions.timeZone = timezone;
    }

    return dateObj.toLocaleTimeString(locale, formatOptions);
};

export const formatRelativeTime = (dateInput, { now = Date.now(), locale } = {}) => {
    const dateObj = normalizeDateInput(dateInput);
    if (!dateObj) return '';

    const seconds = (dateObj.getTime() - now) / 1000;
    const units = [
        ['year', 365 * 86400],
        ['month', 30 * 86400],
        ['day', 86400],
        ['hour', 3600],
        ['minute', 60],
        ['second', 1],
    ];
    const [unit, duration] = units.find(([, size]) => Math.abs(seconds) >= size) || units.at(-1);

    // Keep subsecond future starts from reading "in 0 seconds".
    const amount = Math.sign(seconds) * Math.max(1, Math.round(Math.abs(seconds) / duration));
    return new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(amount, unit);
};
