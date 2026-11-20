import {describe, expect, it} from 'vitest';
import {addDays, dayKey, eventsOnDay, isCalendarDay, movePeriod, visibleDays} from './dates.js';

describe('satellite calendar dates', () => {
    it('hides cached launch estimates and retains known days, timed windows and real activity periods', () => {
        const estimate = {id: 'estimate', kind: 'launch', start: '2026-01-01', end: '2027-01-01', time_precision: 'date'};
        const dated = {...estimate, id: 'dated', start: '2026-11-20', end: '2026-11-21'};
        const overnight = {...estimate, id: 'overnight', start: '2026-11-20T23:30:00Z', end: '2026-11-21T00:30:00Z', time_precision: 'instant'};
        const activity = {...estimate, id: 'activity', kind: 'sstv'};
        expect(eventsOnDay([estimate, dated, overnight, activity], '2026-11-20', 'UTC')).toEqual([activity, dated, overnight]);
        expect(eventsOnDay([estimate, dated, overnight, activity], '2026-11-21', 'UTC')).toEqual([activity, overnight]);
    });
    it('keeps date-only and unspecified-time announcements on their source dates', () => {
        for (const time_precision of ['date', 'unspecified']) {
            const event = {id: 'dated', start: '2026-11-18', end: '2026-11-19', time_precision};
            for (const timezone of ['America/Los_Angeles', 'Asia/Tokyo']) {
                expect(eventsOnDay([event], '2026-11-18', timezone)).toEqual([event]);
                expect(eventsOnDay([event], '2026-11-17', timezone)).toEqual([]);
                expect(eventsOnDay([event], '2026-11-19', timezone)).toEqual([]);
            }
        }
    });
    it('places known starts with unknown ends on the start day in the selected timezone', () => {
        const event = {id: 'start-only', start: '2026-11-18', end: '2026-11-19',
            time_precision: 'unspecified', start_at: '2026-11-18T23:00:00Z'};
        expect(eventsOnDay([event], '2026-11-18', 'UTC')).toEqual([event]);
        expect(eventsOnDay([event], '2026-11-19', 'UTC')).toEqual([]);
        expect(eventsOnDay([event], '2026-11-18', 'Asia/Tokyo')).toEqual([]);
        expect(eventsOnDay([event], '2026-11-19', 'Asia/Tokyo')).toEqual([event]);
        const midnight = {...event, start_at: '2026-11-18T00:00:00Z'};
        expect(eventsOnDay([midnight], '2026-11-17', 'America/Los_Angeles')).toEqual([midnight]);
        expect(eventsOnDay([midnight], '2026-11-18', 'America/Los_Angeles')).toEqual([]);
    });

    it('sorts known starts alongside complete intervals using their actual times', () => {
        const partial = {id: 'partial', start: '2026-11-18', end: '2026-11-19',
            time_precision: 'unspecified', start_at: '2026-11-18T12:00:00Z'};
        const earlier = {id: 'earlier', start: '2026-11-18T11:00:00Z', end: '2026-11-18T11:30:00Z'};
        expect(eventsOnDay([partial, earlier], '2026-11-18', 'UTC')).toEqual([earlier, partial]);
    });
    it('keeps month navigation and six-week grids stable at month and year boundaries', () => {
        expect(movePeriod('2026-01-31', 1, 'month')).toBe('2026-02-01');
        expect(movePeriod('2026-01-31', -1, 'agenda')).toBe('2025-12-01');
        const month = visibleDays('2026-11-18', 'month');
        expect(month).toHaveLength(42);
        expect(month[0]).toBe('2026-10-26');
        expect(month.at(-1)).toBe('2026-12-06');
        expect(visibleDays('2028-02-20', 'agenda')).toHaveLength(29);
        expect(visibleDays('2026-11-18', 'week')).toEqual([
            '2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19',
            '2026-11-20', '2026-11-21', '2026-11-22',
        ]);
    });

    it('handles civil days across daylight saving changes without skipping a day', () => {
        expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
        expect(dayKey('2026-03-28T22:30:00Z', 'Europe/Athens')).toBe('2026-03-29');
        expect(dayKey('2026-03-29T21:30:00Z', 'Europe/Athens')).toBe('2026-03-30');
    });

    it('includes overnight windows on each occupied date and excludes midnight end dates', () => {
        const midnight = {id: 'midnight', start: '2026-11-18T22:00:00Z', end: '2026-11-19T00:00:00Z'};
        const overnight = {id: 'overnight', start: '2026-11-18T23:00:00Z', end: '2026-11-19T01:00:00Z'};
        expect(eventsOnDay([overnight, midnight], '2026-11-18', 'UTC')).toEqual([midnight, overnight]);
        expect(eventsOnDay([midnight, overnight], '2026-11-19', 'UTC')).toEqual([overnight]);
        expect(eventsOnDay([midnight, overnight], '2026-11-18', 'Asia/Tokyo')).toEqual([]);
        expect(eventsOnDay([overnight, midnight], '2026-11-19', 'Asia/Tokyo')).toEqual([midnight, overnight]);
    });

    it('rejects incomplete or impossible dates without rejecting leap days', () => {
        expect(isCalendarDay('2026-11-')).toBe(false);
        expect(isCalendarDay('2026-02-30')).toBe(false);
        expect(isCalendarDay('2026-02-29')).toBe(false);
        expect(isCalendarDay('2028-02-29')).toBe(true);
    });
});
