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
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { expect, test, vi } from 'vitest';
import '../../../i18n/config.js';
import FileBrowserMain from '../filebrowser-main.jsx';
import filebrowserReducer, { setViewMode } from '../filebrowser-slice.jsx';
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

const parent = {
    id: 'observation:pass.gsobs', type: 'decoded_folder', folder_kind: 'observation',
    name: 'pass', foldername: 'pass.gsobs', satellite_name: 'ISS', size: 10,
    created: '2026-10-29T08:00:00Z', modified: '2026-10-29T08:00:00Z',
    matched_files: ['decoded/beacon.bin'],
};

function renderBrowser() {
    socket.emit.mockReset().mockImplementation((_event, { cmd, data }, callback) => {
        if (cmd === 'filebrowser.query') {
            callback({
                success: true,
                data: { items: data.search === 'beacon' ? [parent] : [], total: data.search === 'beacon' ? 1 : 0 },
            });
        }
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

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(socket.emit.mock.lastCall[1]).toMatchObject({ cmd: 'filebrowser.query', data: { search: 'beacon', page: 1 } });
    act(() => store.dispatch(setViewMode('card')));
    expect(screen.getByText('Matched inside: decoded/beacon.bin')).toBeInTheDocument();
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
