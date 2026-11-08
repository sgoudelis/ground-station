import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@mui/material/styles';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import '../../i18n/config.js';
import { setupTheme } from '../../theme.js';
import ScheduledObservationsLayout from './main-layout.jsx';
import schedulerReducer from './scheduler-slice.jsx';

const socket = vi.hoisted(() => ({ emit: vi.fn() }));
vi.mock('../common/socket.jsx', () => ({ useSocket: () => ({ socket }) }));
vi.mock('./monitored-satellites-table.jsx', () => ({ default: () => <div>Monitored card</div> }));
vi.mock('./observations-table.jsx', () => ({ default: () => <div>Observation timeline and table</div> }));
vi.mock('./observation-status-banner.jsx', () => ({ default: () => <div>Upcoming observation row</div> }));
vi.mock('./continuous-observations.jsx', () => ({ default: () => <div>Continuous observation definitions</div> }));

beforeEach(() => {
    socket.emit.mockReset();
    socket.emit.mockImplementation((_event, _request, acknowledge) => {
        acknowledge({ success: true, data: [] });
    });
});

function renderScheduler(initialEntries = ['/scheduler']) {
    const store = configureStore({ reducer: { scheduler: schedulerReducer } });
    const router = createMemoryRouter([
        { path: '/scheduler/:tab?', element: <ScheduledObservationsLayout /> },
        { path: '/earthview', element: <div>Earth view</div> },
    ], { initialEntries, initialIndex: initialEntries.length - 1 });
    render(
        <ThemeProvider theme={setupTheme('light')}>
            <Provider store={store}><RouterProvider router={router} /></Provider>
        </ThemeProvider>,
    );
    return { store, router };
}

it('shows the upcoming row in both tabs and loads its data before opening observations', async () => {
    const user = userEvent.setup();
    const observation = { id: 'upcoming', name: 'Next pass', status: 'scheduled' };
    socket.emit.mockImplementation((_event, _request, acknowledge) => {
        acknowledge({ success: true, data: [observation] });
    });
    const { store, router } = renderScheduler();

    const monitoredTab = screen.getByRole('tab', { name: 'Monitored Satellites' });
    const observationsTab = screen.getByRole('tab', { name: 'Scheduled Observations' });
    expect(monitoredTab).toHaveAttribute('aria-selected', 'true');
    expect(router.state.location.pathname).toBe('/scheduler/monitored');
    expect(monitoredTab).toHaveAttribute('href', '/scheduler/monitored');
    expect(observationsTab).toHaveAttribute('href', '/scheduler/observations');
    const firstPanel = screen.getByRole('tabpanel', { name: 'Monitored Satellites' });
    expect(firstPanel).toHaveAttribute('id', monitoredTab.getAttribute('aria-controls'));
    expect(within(firstPanel).getByText('Upcoming observation row')).toBeVisible();
    expect(within(firstPanel).getByText('Monitored card')).toBeVisible();
    expect(screen.queryByText('Observation timeline and table')).not.toBeInTheDocument();
    await waitFor(() => expect(store.getState().scheduler.observations).toEqual([observation]));
    expect(socket.emit).toHaveBeenCalledWith('api.call', {
        cmd: 'get-scheduled-observations', data: null,
    }, expect.any(Function));

    await user.click(observationsTab);
    expect(router.state.location.pathname).toBe('/scheduler/observations');
    expect(screen.getByRole('tabpanel', { name: 'Scheduled Observations' }))
        .toHaveAttribute('id', observationsTab.getAttribute('aria-controls'));
    expect(screen.getByText('Observation timeline and table')).toBeVisible();
    expect(screen.getByText('Upcoming observation row')).toBeVisible();
    expect(screen.queryByText('Monitored card')).not.toBeInTheDocument();

    await user.click(screen.getByRole('tab', { name: 'Continuous Observations' }));
    expect(router.state.location.pathname).toBe('/scheduler/continuous');
    const continuousPanel = screen.getByRole('tabpanel', { name: 'Continuous Observations' });
    expect(continuousPanel).toHaveAttribute('id', 'scheduler-panel-continuous');
    expect(within(continuousPanel).getByText('Continuous observation definitions')).toBeVisible();
    expect(screen.queryByText('Upcoming observation row')).not.toBeInTheDocument();

    await user.click(monitoredTab);
    expect(router.state.location.pathname).toBe('/scheduler/monitored');
    expect(screen.getByText('Upcoming observation row')).toBeVisible();
    expect(screen.getByText('Monitored card')).toBeVisible();
    expect(socket.emit).toHaveBeenCalledTimes(1);
});

it.each([
    ['monitored', 'Monitored Satellites', 'Monitored card'],
    ['observations', 'Scheduled Observations', 'Observation timeline and table'],
    ['continuous', 'Continuous Observations', 'Continuous observation definitions'],
])('opens the %s page directly from its URL', (tab, title, content) => {
    const { router } = renderScheduler([`/scheduler/${tab}`]);
    expect(router.state.location.pathname).toBe(`/scheduler/${tab}`);
    expect(screen.getByRole('tab', { name: title })).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByRole('tabpanel', { name: title })).getByText(content)).toBeVisible();
    expect(screen.getAllByRole('tabpanel')).toHaveLength(1);
});

it('restores the selected tab and panel when navigating back and forward', async () => {
    const user = userEvent.setup();
    const { router } = renderScheduler(['/scheduler/monitored']);
    await user.click(screen.getByRole('tab', { name: 'Scheduled Observations' }));
    await user.click(screen.getByRole('tab', { name: 'Continuous Observations' }));

    await act(async () => { await router.navigate(-1); });
    expect(router.state.location.pathname).toBe('/scheduler/observations');
    expect(screen.getByRole('tab', { name: 'Scheduled Observations' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Observation timeline and table')).toBeVisible();
    expect(screen.queryByText('Continuous observation definitions')).not.toBeInTheDocument();

    await act(async () => { await router.navigate(-1); });
    expect(router.state.location.pathname).toBe('/scheduler/monitored');
    expect(screen.getByRole('tab', { name: 'Monitored Satellites' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Monitored card')).toBeVisible();

    await act(async () => { await router.navigate(1); });
    expect(router.state.location.pathname).toBe('/scheduler/observations');
    expect(screen.getByRole('tab', { name: 'Scheduled Observations' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('Observation timeline and table')).toBeVisible();
    expect(socket.emit).toHaveBeenCalledTimes(1);
});

it('redirects the scheduler entry point without leaving an extra history entry', async () => {
    const { router } = renderScheduler(['/earthview', '/scheduler']);
    await waitFor(() => expect(router.state.location.pathname).toBe('/scheduler/monitored'));
    await act(async () => { await router.navigate(-1); });
    expect(router.state.location.pathname).toBe('/earthview');
    expect(screen.getByText('Earth view')).toBeVisible();

    await act(async () => { await router.navigate(1); });
    expect(router.state.location.pathname).toBe('/scheduler/monitored');
    expect(screen.getByText('Monitored card')).toBeVisible();
});

it('shows the not-found page for an unknown scheduler subpage', () => {
    const { router } = renderScheduler(['/scheduler/unknown']);
    expect(router.state.location.pathname).toBe('/scheduler/unknown');
    expect(screen.getByText('Page Not Found')).toBeVisible();
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(socket.emit).not.toHaveBeenCalled();
});
