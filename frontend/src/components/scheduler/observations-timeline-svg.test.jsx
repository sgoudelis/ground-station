import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/config.js';
import { formatDateTime } from '../../utils/date-time.js';
import schedulerReducer from './scheduler-slice.jsx';
import ObservationsTimeline from './observations-timeline-svg.jsx';

const now = '2026-11-22T20:52:00Z';
const singleObservation = {
    id: 'single-beesat',
    enabled: true,
    status: 'scheduled',
    satellite: { name: 'BEESAT-1' },
    pass: { event_start: '2026-11-22T22:20:03Z', event_end: '2026-11-22T22:33:50Z' },
    task_start: null,
    task_end: null,
};

function renderTimeline(observations = [singleObservation]) {
    const state = {
        scheduler: { ...schedulerReducer(undefined, { type: '@@INIT' }), observations },
        location: { location: null },
        preferences: { preferences: [
            { name: 'timezone', value: 'UTC' },
            { name: 'locale', value: 'en-GB' },
        ] },
    };
    const store = configureStore({ reducer: {
        scheduler: schedulerReducer,
        location: () => state.location,
        preferences: () => state.preferences,
    }, preloadedState: state });
    const view = render(<Provider store={store}><ObservationsTimeline /></Provider>);
    return { ...view, store };
}

function expectSchedule(start, end, duration) {
    const tooltip = within(screen.getByRole('tooltip'));
    expect(tooltip.getAllByText(formatDateTime(start, { timezone: 'UTC', locale: 'en-GB' })).length).toBeGreaterThan(0);
    expect(tooltip.getAllByText(formatDateTime(end, { timezone: 'UTC', locale: 'en-GB' })).length).toBeGreaterThan(0);
    expect(tooltip.getByText(duration, { exact: true })).toBeInTheDocument();
    expect(tooltip.queryByText(/NaN/)).not.toBeInTheDocument();
}

describe('observation timeline timing', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(now));
        vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(1200);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('renders a single observation without task times and opens its original data', () => {
        const { store } = renderTimeline();
        const bar = screen.getByText('BEESAT-1').closest('g');
        const rect = bar.querySelector('rect');
        expect(Number(rect.getAttribute('x'))).toBeGreaterThan(600);
        expect(Number(rect.getAttribute('width'))).toBeGreaterThan(0);

        fireEvent.mouseEnter(bar);
        expectSchedule(singleObservation.pass.event_start, singleObservation.pass.event_end, '14m');
        expect(within(screen.getByRole('tooltip')).getByText('in 1h 28m')).toBeInTheDocument();

        fireEvent.click(bar);
        expect(store.getState().scheduler.selectedObservation).toEqual(singleObservation);
        expect(store.getState().scheduler.dialogOpen).toBe(true);
    });

    it('prefers elevation-constrained task times for geometry and the tooltip', () => {
        const taskStart = '2026-11-22T22:22:00Z';
        const taskEnd = '2026-11-22T22:32:00Z';
        renderTimeline([{ ...singleObservation, task_start: taskStart, task_end: taskEnd }]);
        const bar = screen.getByText('BEESAT-1').closest('g');
        expect(Number(bar.querySelector('rect').getAttribute('width'))).toBeCloseTo(1140 * 10 / (24 * 60));
        fireEvent.mouseEnter(bar);
        expectSchedule(taskStart, taskEnd, '10m');
    });

    it.each([
        { task_start: '2026-11-22T22:23:50Z', task_end: null },
        { task_start: null, task_end: '2026-11-22T22:30:03Z' },
    ])('falls back independently when one task time is missing: %j', (timing) => {
        renderTimeline([{ ...singleObservation, ...timing }]);
        fireEvent.mouseEnter(screen.getByText('BEESAT-1').closest('g'));
        expectSchedule(timing.task_start || singleObservation.pass.event_start,
            timing.task_end || singleObservation.pass.event_end, '10m');
    });

    it('sorts mixed manual and generated observations by their effective start', () => {
        const meteor = { ...singleObservation, id: 'meteor', satellite: { name: 'METEOR-M2 3' },
            task_start: '2026-11-22T23:00:00Z', task_end: '2026-11-22T23:15:00Z' };
        renderTimeline([meteor, singleObservation]);
        const beesat = screen.getByText('BEESAT-1');
        const meteorLabel = screen.getByText('METEOR-M2 3');
        expect(beesat.compareDocumentPosition(meteorLabel) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it.each([
        { pass: null },
        { pass: { event_start: 'invalid', event_end: 'invalid' } },
        { pass: { event_start: singleObservation.pass.event_start } },
        { pass: { event_end: singleObservation.pass.event_end } },
        { pass: { event_start: singleObservation.pass.event_end, event_end: singleObservation.pass.event_start } },
        { pass: { event_start: '2026-11-24T22:20:03Z', event_end: '2026-11-24T22:33:50Z' } },
    ])('omits observations without a valid interval in the time window: %j', (overrides) => {
        renderTimeline([{ ...singleObservation, ...overrides }]);
        expect(screen.queryByText('BEESAT-1')).not.toBeInTheDocument();
    });
});
