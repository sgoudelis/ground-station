import { describe, expect, it, vi } from 'vitest';

import { formatDate, formatDateTime, formatRelativeTime, formatTime, normalizeDateInput } from './date-time.js';

describe('date-time utilities', () => {
    it('normalizes dates and rejects empty or invalid inputs', () => {
        const date = new Date('2026-01-02T03:04:05Z');

        expect(normalizeDateInput(date)).toBe(date);
        expect(normalizeDateInput('2026-01-02T03:04:05Z')).toEqual(date);
        expect(normalizeDateInput('not-a-date')).toBeNull();
        expect(normalizeDateInput(null)).toBeNull();
    });

    it('forwards locale, options, and timezone to each formatter', () => {
        const date = new Date('2026-01-02T03:04:05Z');
        const dateTimeSpy = vi.spyOn(date, 'toLocaleString').mockReturnValue('date-time');
        const dateSpy = vi.spyOn(date, 'toLocaleDateString').mockReturnValue('date');
        const timeSpy = vi.spyOn(date, 'toLocaleTimeString').mockReturnValue('time');
        const format = { locale: 'en-GB', timezone: 'UTC', options: { hour12: false } };

        expect(formatDateTime(date, format)).toBe('date-time');
        expect(formatDate(date, format)).toBe('date');
        expect(formatTime(date, format)).toBe('time');
        expect(dateTimeSpy).toHaveBeenCalledWith('en-GB', { hour12: false, timeZone: 'UTC' });
        expect(dateSpy).toHaveBeenCalledWith('en-GB', { hour12: false, timeZone: 'UTC' });
        expect(timeSpy).toHaveBeenCalledWith('en-GB', { hour12: false, timeZone: 'UTC' });
    });

    it('returns an empty display value for invalid formatter input', () => {
        expect(formatDateTime('invalid')).toBe('');
        expect(formatDate(null)).toBe('');
        expect(formatTime(undefined)).toBe('');
        expect(formatRelativeTime('invalid')).toBe('');
    });

    it.each([
        [0.1, 'in 1 second'],
        [30, 'in 30 seconds'],
        [60, 'in 1 minute'],
        [120, 'in 2 minutes'],
        [3600, 'in 1 hour'],
        [86400 * 2, 'in 2 days'],
        [86400 * 30, 'in 1 month'],
        [86400 * 365, 'in 1 year'],
        [-120, '2 minutes ago'],
    ])('humanizes a time %s seconds from now', (seconds, expected) => {
        const now = new Date('2026-11-05T10:00:00Z').getTime();
        expect(formatRelativeTime(new Date(now + seconds * 1000), { now, locale: 'en-GB' })).toBe(expected);
    });

    it('uses the selected locale for relative times', () => {
        const now = new Date('2026-11-05T10:00:00Z').getTime();
        expect(formatRelativeTime('2026-11-05T10:02:00Z', { now, locale: 'de-DE' })).toBe('in 2 Minuten');
    });
});
