/**
 * @license
 * Copyright (c) 2026 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { mockViewport } from '../../../test/viewport.js';
import '../../../i18n/config.js';
import FileBrowserMain from '../filebrowser-main.jsx';
import filebrowserReducer, { setSortBy, setViewMode } from '../filebrowser-slice.jsx';
import { saveWaterfallSnapshot } from '../../waterfall/waterfall-slice.jsx';

const { socket } = vi.hoisted(() => ({
    socket: { connected: true, emit: vi.fn(), on: vi.fn(), off: vi.fn() },
}));
vi.mock('../../common/socket.jsx', () => ({ useSocket: () => ({ socket }) }));
vi.mock('../recording-dialog.jsx', () => ({ default: () => null }));
vi.mock('../telemetry-viewer-dialog.jsx', () => ({ default: () => null }));
vi.mock('../audio-dialog.jsx', () => ({ default: () => null }));
vi.mock('../transcription-dialog.jsx', () => ({ default: () => null }));
vi.mock('../meteor-m2x-lrpt-folder-dialog.jsx', () => ({ default: () => null }));
vi.mock('../meteor-hrpt-folder-dialog.jsx', () => ({ default: () => null }));
vi.mock('../observation-folder-dialog.jsx', () => ({ default: () => null }));
vi.mock('../processing-dialog.jsx', () => ({ default: () => null }));
vi.mock('../purge-dialog.jsx', () => ({ default: () => null }));

afterEach(() => vi.useRealTimers());
beforeEach(() => mockViewport(1280));

const parent = {
    id: 'observation:pass.gsobs', type: 'decoded_folder', folder_kind: 'observation',
    name: 'pass', foldername: 'pass.gsobs', satellite_name: 'ISS', size: 10,
    created: '2026-10-29T08:00:00Z', modified: '2026-10-29T08:00:00Z',
    captured_at: '2026-09-07T01:36:25Z', completed_at: '2026-09-07T01:43:13Z',
    captured_at_source: 'metadata',
    latest_activity: '2026-11-03T08:15:00Z',
    matched_files: ['decoded/beacon.bin'],
};

function renderBrowser(item = parent) {
    socket.emit.mockReset().mockImplementation((_event, { cmd, data }, callback) => {
        if (cmd === 'filebrowser.reconcile') callback({ success: true, data: {} });
        if (cmd === 'filebrowser.query') {
            callback({
                success: true,
                data: { items: data.search === 'beacon' ? [item] : [], total: data.search === 'beacon' ? 1 : 0 },
            });
        }
        if (cmd === 'filebrowser.item') callback({ success: true, data: { ...item, page: 1, total: 0, packets: [], runs: [] } });
    });
    const store = configureStore({ reducer: { filebrowser: filebrowserReducer } });
    render(<Provider store={store}><ThemeProvider theme={createTheme()}><FileBrowserMain /></ThemeProvider></Provider>);
    return store;
}

test('searches the backend, shows matches in both views, and keeps the query on refresh', async () => {
    const store = renderBrowser();
    const input = screen.getByRole('searchbox', { name: 'Search files' });
    fireEvent.change(input, { target: { value: 'beacon' } });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('1 result'));
    expect(screen.getByText('Matched inside: decoded/beacon.bin')).toBeInTheDocument();
    expect(store.getState().filebrowser.search).toBe('beacon');

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Refresh' })));
    await waitFor(() => expect(socket.emit.mock.lastCall[1]).toMatchObject({ cmd: 'filebrowser.query', data: { search: 'beacon', page: 1 } }));
    act(() => store.dispatch(setViewMode('card')));
    expect(screen.getByText('Matched inside: decoded/beacon.bin')).toBeInTheDocument();
});

test('only registers the file browser as visible while its page is mounted', () => {
    const store = renderBrowser();
    expect(store.getState().filebrowser.isVisible).toBe(true);
    cleanup();
    expect(store.getState().filebrowser.isVisible).toBe(false);
});

test('shows a search-specific empty state and clears the applied query', async () => {
    const store = renderBrowser();
    const input = screen.getByRole('searchbox');
    fireEvent.change(input, { target: { value: 'missing-file' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByText('No files match “missing-file”.')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('0 results');
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear search' })[0]);
    await waitFor(() => expect(store.getState().filebrowser.search).toBe(''));
    expect(input).toHaveValue('');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
});

test('routes a sonde folder to its packet browser and describes it in both views', async () => {
    const store = renderBrowser({
        ...parent, id: 'decoded_folder:radiosonde_RS41_TEST0042', folder_kind: 'radiosonde',
        name: 'RS41 TEST0042', model: 'RS41', serial: 'TEST0042', packet_count: 51, run_count: 2,
    });
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'beacon' } });
    expect(await screen.findByText('Radiosonde')).toBeInTheDocument();
    act(() => store.dispatch(setViewMode('card')));
    expect(screen.getAllByText('51 packets · 2 flights').length).toBeGreaterThan(0);
    act(() => store.dispatch(setViewMode('table')));
    fireEvent.click(screen.getByText('RS41 TEST0042'));
    expect(await screen.findByRole('table', { name: 'Radiosonde packets' })).toBeInTheDocument();
});

test('defaults to activity dates and uses the selected date for grouping in both views', async () => {
    vi.useFakeTimers({toFake: ['Date']});
    vi.setSystemTime(new Date('2026-11-03T08:20:00Z'));
    const store = renderBrowser();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'beacon' } });
    expect(await screen.findByText('November 3, 2026')).toBeInTheDocument();
    expect(screen.getByText('8:15:00 AM')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Last Activity' })).toBeInTheDocument();
    expect(socket.emit.mock.lastCall[1]).toMatchObject({ cmd: 'filebrowser.query', data: { sortBy: 'latest_activity', sortOrder: 'desc' } });

    await act(async () => store.dispatch(setViewMode('card')));
    expect(screen.getByText(/11\/3\/2026, 8:15:00 AM/)).toBeInTheDocument();
    expect(screen.getByText('5 minutes ago')).toBeInTheDocument();
    await act(async () => store.dispatch(setViewMode('table')));
    await act(async () => store.dispatch(setSortBy('captured_at')));
    expect(await screen.findByText('September 7, 2026')).toBeInTheDocument();
    expect(screen.getByText('1:36:25 AM')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Date Captured' })).toBeInTheDocument();

    await act(async () => store.dispatch(setSortBy('modified')));
    expect(screen.getByText('October 29, 2026')).toBeInTheDocument();
    expect(screen.getByText('8:00:00 AM')).toBeInTheDocument();
    expect(screen.queryByText('September 7, 2026')).not.toBeInTheDocument();

    await act(async () => store.dispatch(setSortBy('completed_at')));
    expect(screen.getByText('September 7, 2026')).toBeInTheDocument();
    expect(screen.getByText('1:43:13 AM')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Date Completed' })).toBeInTheDocument();
});

test('snapshot saving sends the satellite context needed for later NORAD searches', async () => {
    const emit = vi.fn((_event, _request, callback) => callback({ success: true, data: {} }));
    const store = configureStore({
        reducer: {
            targetSatTrack: () => ({
                trackingState: { norad_id: 25544 },
                satelliteData: { details: { name: 'ISS' } },
            }),
        },
    });
    await store.dispatch(saveWaterfallSnapshot({ socket: { emit }, waterfallImage: 'image', snapshotName: 'capture' })).unwrap();
    expect(emit.mock.calls[0][1]).toMatchObject({
        cmd: 'sdr.save-waterfall-snapshot',
        data: { metadata: { target_satellite_name: 'ISS', target_satellite_norad_id: 25544 } },
    });
});
