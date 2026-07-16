const MAX_ELEVATION_HISTORY_SAMPLES = 5;
// Celestial tracks change much more slowly than LEO satellites, so use
// smaller per-update thresholds to surface meaningful up/down movement.
const LOW_RATE_THRESHOLD = 0.005;
const HIGH_RATE_THRESHOLD = 0.02;

export const updateElevationHistory = (historyByKey, key, elevation) => {
    if (!historyByKey || typeof historyByKey !== 'object') return [];
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey || !Number.isFinite(elevation)) return [];

    const history = Array.isArray(historyByKey[normalizedKey]) ? [...historyByKey[normalizedKey]] : [];
    const lastSample = history.length > 0 ? history[history.length - 1] : null;

    // Ignore exact duplicate samples that can appear on rerenders without new track data.
    if (!Number.isFinite(lastSample) || Math.abs(lastSample - elevation) > 1e-9) {
        history.push(elevation);
    }

    if (history.length > MAX_ELEVATION_HISTORY_SAMPLES) {
        history.splice(0, history.length - MAX_ELEVATION_HISTORY_SAMPLES);
    }

    historyByKey[normalizedKey] = history;
    return history;
};

export const pruneElevationHistory = (historyByKey, activeKeys) => {
    if (!historyByKey || typeof historyByKey !== 'object') return;
    const keep = activeKeys instanceof Set ? activeKeys : new Set();
    Object.keys(historyByKey).forEach((key) => {
        if (!keep.has(key)) {
            delete historyByKey[key];
        }
    });
};

export const calculateElevationTrend = (history, elevation) => {
    if (!Array.isArray(history) || history.length < 2 || !Number.isFinite(elevation)) {
        return { trend: 'stable', elRate: 0 };
    }

    const changes = [];
    for (let i = 1; i < history.length; i += 1) {
        const previous = history[i - 1];
        const current = history[i];
        if (!Number.isFinite(previous) || !Number.isFinite(current)) continue;
        changes.push(current - previous);
    }

    if (changes.length === 0) {
        return { trend: 'stable', elRate: 0 };
    }

    const elRate = changes.reduce((acc, value) => acc + value, 0) / changes.length;
    let trend = 'stable';

    if (elRate >= HIGH_RATE_THRESHOLD) {
        trend = 'rising_fast';
    } else if (elRate >= LOW_RATE_THRESHOLD) {
        trend = 'rising_slow';
    } else if (elRate <= -HIGH_RATE_THRESHOLD) {
        trend = 'falling_fast';
    } else if (elRate <= -LOW_RATE_THRESHOLD) {
        trend = 'falling_slow';
    } else if (Math.abs(elRate) < LOW_RATE_THRESHOLD && elevation > 0 && history.length >= 3) {
        const recent = history.slice(-3);
        const maxRecent = Math.max(...recent);
        if (Math.abs(elevation - maxRecent) < 0.2) {
            trend = 'peak';
        }
    }

    return { trend, elRate };
};
