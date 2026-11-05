import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { act, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/config.js';
import schedulerReducer from './scheduler-slice.jsx';
import ObservationsTable from './observations-table.jsx';

vi.mock('../common/socket.jsx', () => ({ useSocket: () => ({ socket: null }) }));
vi.mock('./observations-timeline-svg.jsx', () => ({ default: () => null }));
vi.mock('./observations-table-settings-dialog.jsx', () => ({ default: () => null }));
vi.mock('./observation-data-dialog.jsx', () => ({ default: () => null }));
vi.mock('@mui/x-data-grid', () => ({
    gridClasses: { cell: 'MuiDataGrid-cell', columnHeader: 'MuiDataGrid-columnHeader' },
    DataGrid: ({ rows, columns }) => (
        <div data-testid="status-cells">
            {rows.map((row) => (
                <div key={row.id}>
                    {columns.find((column) => column.field === 'status').renderCell({ row, value: row.status })}
                </div>
            ))}
        </div>
    ),
}));

const now = Date.parse('2026-11-06T12:00:00Z');
const inSeconds = (seconds) => new Date(now + seconds * 1000).toISOString();

function renderObservation(overrides = {}) {
    const observation = {
        id: 'obs-1', enabled: true, status: 'scheduled',
        pass: { event_start: inSeconds(60) }, ...overrides,
    };
    const store = configureStore({
        reducer: { scheduler: schedulerReducer },
        preloadedState: { scheduler: {
            ...schedulerReducer(undefined, { type: '@@INIT' }), observations: [observation],
        } },
    });
    render(<Provider store={store}><ObservationsTable /></Provider>);
    return { store, cells: within(screen.getByTestId('status-cells')) };
}

describe('observation starting-soon status', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(now);
        localStorage.clear();
    });

    afterEach(() => vi.useRealTimers());

    it('updates automatically inside the two-minute window and preserves the scheduled status', () => {
        const { store, cells } = renderObservation({ pass: { event_start: inSeconds(120) } });
        expect(cells.getByText('Scheduled')).toBeInTheDocument();

        act(() => vi.advanceTimersByTime(1000));
        expect(cells.getByText('Starting soon')).toBeInTheDocument();
        expect(store.getState().scheduler.observations[0].status).toBe('scheduled');

        act(() => vi.advanceTimersByTime(119000));
        expect(cells.getByText('Scheduled')).toBeInTheDocument();
    });

    it.each([
        [{}, 'Starting soon'],
        [{ task_start: inSeconds(180) }, 'Scheduled'],
        [{ task_start: inSeconds(30), pass: { event_start: inSeconds(180) } }, 'Starting soon'],
        [{ enabled: false }, 'Scheduled'],
        [{ status: 'running' }, 'Running'],
        [{ status: 'completed' }, 'Completed'],
        [{ pass: { event_start: inSeconds(-60) } }, 'Scheduled'],
        [{ pass: null }, 'Scheduled'],
        [{ pass: { event_start: 'invalid' } }, 'Scheduled'],
    ])('shows the appropriate label for %j', (overrides, label) => {
        const { cells } = renderObservation(overrides);
        expect(cells.getByText(label)).toBeInTheDocument();
    });
});
