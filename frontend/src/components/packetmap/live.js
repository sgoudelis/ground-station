/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

export const LIVE_WINDOW_MS = 30 * 60 * 1000;
export const AIRCRAFT_EXPIRY_MS = LIVE_WINDOW_MS;

export function liveRangeAt(now = Date.now()) {
    return {start: new Date(now - LIVE_WINDOW_MS).toISOString(), end: null};
}
