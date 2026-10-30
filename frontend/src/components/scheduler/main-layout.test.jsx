import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@mui/material/styles';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import '../../i18n/config.js';
import { setupTheme } from '../../theme.js';
import ScheduledObservationsLayout from './main-layout.jsx';
import schedulerReducer from './scheduler-slice.jsx';

const socket = vi.hoisted(() => ({ emit: vi.fn() }));
vi.mock('../common/socket.jsx', () => ({ useSocket: () => ({ socket }) }));
vi.mock('./monitored-satellites-table.jsx', () => ({ default: () => <div>Monitored card</div> }));
vi.mock('./observations-table.jsx', () => ({ default: () => <div>Observation timeline and table</div> }));
vi.mock('./observation-status-banner.jsx', () => ({ default: () => <div>Upcoming observation row</div> }));

it('shows the upcoming row in both tabs and loads its data before opening observations', async () => {
    const user = userEvent.setup();
    const observation = { id: 'upcoming', name: 'Next pass', status: 'scheduled' };
    socket.emit.mockImplementation((_event, _request, acknowledge) => {
        acknowledge({ success: true, data: [observation] });
    });
    const store = configureStore({ reducer: { scheduler: schedulerReducer } });
    render(
        <ThemeProvider theme={setupTheme('light')}>
            <Provider store={store}><ScheduledObservationsLayout /></Provider>
        </ThemeProvider>,
    );

    const monitoredTab = screen.getByRole('tab', { name: 'Monitored Satellites' });
    const observationsTab = screen.getByRole('tab', { name: 'Scheduled Observations' });
    expect(monitoredTab).toHaveAttribute('aria-selected', 'true');
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
    expect(screen.getByRole('tabpanel', { name: 'Scheduled Observations' }))
        .toHaveAttribute('id', observationsTab.getAttribute('aria-controls'));
    expect(screen.getByText('Observation timeline and table')).toBeVisible();
    expect(screen.getByText('Upcoming observation row')).toBeVisible();
    expect(screen.queryByText('Monitored card')).not.toBeInTheDocument();

    await user.click(monitoredTab);
    expect(screen.getByText('Upcoming observation row')).toBeVisible();
    expect(screen.getByText('Monitored card')).toBeVisible();
    expect(socket.emit).toHaveBeenCalledTimes(1);
});
