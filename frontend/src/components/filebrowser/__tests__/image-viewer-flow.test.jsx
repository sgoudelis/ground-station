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
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../../../i18n/config.js';
import FileBrowserMain from '../filebrowser-main.jsx';
import filebrowserReducer from '../filebrowser-slice.jsx';
import DecodedPacketsDrawer from '../../waterfall/decoded-packets-drawer.jsx';

vi.mock('../../common/socket.jsx', () => ({ useSocket: () => ({ socket: null }) }));
// Keep the real observation folder and shared image viewer in this flow.
vi.mock('../recording-dialog.jsx', () => ({ default: () => null }));
vi.mock('../telemetry-viewer-dialog.jsx', () => ({ default: () => null }));
vi.mock('../audio-dialog.jsx', () => ({ default: () => null }));
vi.mock('../transcription-dialog.jsx', () => ({ default: () => null }));
vi.mock('../meteor-m2x-lrpt-folder-dialog.jsx', () => ({ default: () => null }));
vi.mock('../meteor-hrpt-folder-dialog.jsx', () => ({ default: () => null }));
vi.mock('../processing-dialog.jsx', () => ({ default: () => null }));
vi.mock('../purge-dialog.jsx', () => ({ default: () => null }));
vi.mock('../../satellites/satellite-info-page.jsx', () => ({ SatelliteInfoDialog: () => null }));
// Exercise the real action cells without DataGrid virtualization in JSDOM.
vi.mock('@mui/x-data-grid', () => ({
    gridClasses: { cell: 'MuiDataGrid-cell', columnHeader: 'MuiDataGrid-columnHeader' },
    DataGrid: ({ rows, columns }) => <div>{rows.map((row) => (
        <div key={row.id}>{columns.find((column) => column.field === 'actions').renderCell({ row })}</div>
    ))}</div>,
}));

const artifact = {
    name: 'sstv_Robot_36.png',
    path: 'decoded/sstv_Robot_36.png',
    url: '/observations/UMKA.gsobs/decoded/sstv_Robot_36.png?v=123',
    file_type: '.png',
    kind: 'decoded',
    size: 172685,
    captured_at: '2026-10-29T08:22:00Z',
    captured_at_source: 'metadata',
};
const folder = {
    id: 'observation:UMKA.gsobs',
    name: 'UMKA observation',
    foldername: 'UMKA.gsobs',
    type: 'decoded_folder',
    folder_kind: 'observation',
    satellite_name: 'UMKA-1',
    created: '2026-10-29T08:21:49Z',
    modified: '2026-10-29T08:30:59Z',
    size: artifact.size,
    artifact_count: 1,
    images: [artifact],
    artifacts: [artifact],
};
const metadata = {
    decoder: { type: 'sstv', mode: 'Robot 36' },
    image: { width: 320, height: 240, timestamp_iso: '2026-10-29T08:22:45+0000' },
    signal: { frequency_mhz: 437.635198, sample_rate_hz: 44100 },
    vfo: { id: 1, bandwidth_khz: 12.5 },
    satellite: { name: 'UMKA 1 (RS40S)', norad_id: 57172 },
    transmitter: { description: 'Mode U - SSTV', center_frequency: 437625000 },
};

function renderLibrary(item = folder, preferences = []) {
    const store = configureStore({
        reducer: {
            filebrowser: filebrowserReducer,
            preferences: () => ({ preferences }),
        },
        preloadedState: {
            filebrowser: {
                ...filebrowserReducer(undefined, { type: 'init' }),
                files: [item],
                total: 1,
                viewMode: 'card',
            },
        },
    });
    render(<Provider store={store}><ThemeProvider theme={createTheme()}><FileBrowserMain /></ThemeProvider></Provider>);
}

async function openObservationImage() {
    fireEvent.click(screen.getByText(folder.name));
    const observation = await screen.findByRole('dialog');
    fireEvent.click(within(observation).getByRole('img', { name: artifact.name }));
    return screen.findByRole('dialog', { name: new RegExp(artifact.name) });
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('shared image viewer entry points', () => {
    it('opens an observation SSTV image with metadata and returns to the folder on close', async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => metadata });
        vi.stubGlobal('fetch', fetchMock);
        const download = vi.spyOn(window, 'open').mockImplementation(() => null);
        renderLibrary(folder, [
            { name: 'timezone', value: 'Europe/Athens' },
            { name: 'locale', value: 'el-GR' },
        ]);

        const viewer = await openObservationImage();
        expect(fetchMock).toHaveBeenCalledWith('/observations/UMKA.gsobs/decoded/sstv_Robot_36.json?v=123');
        expect(viewer).toHaveStyle({ height: '90dvh', maxHeight: 'calc(100dvh - 16px)' });
        expect(within(viewer).getByRole('img', { name: artifact.name })).toHaveAttribute('src', artifact.url);
        expect(within(viewer).getByText('320×240')).toBeInTheDocument();
        expect(within(viewer).getByText('437.635198 MHz')).toBeInTheDocument();
        expect(within(viewer).getByText('44100 Hz')).toBeInTheDocument();
        expect(within(viewer).getByText('UMKA 1 (RS40S)')).toBeInTheDocument();
        expect(within(viewer).getByText('57172')).toBeInTheDocument();
        expect(within(viewer).getByText('Mode U - SSTV')).toBeInTheDocument();
        expect(within(viewer).getByText('437.625000 MHz')).toBeInTheDocument();
        expect(within(viewer).getByText('VFO').parentElement).toHaveTextContent('1');
        expect(within(viewer).getByText('Decoded').parentElement).toHaveTextContent('29/10/2026, 10:22:45 π.μ.');
        expect(within(viewer).getByText('Date Captured').parentElement).toHaveTextContent('29/10/2026, 10:22:00 π.μ.');
        expect(within(viewer).getByText('Modified').parentElement).toHaveTextContent('29/10/2026, 10:30:59 π.μ.');
        fireEvent.click(within(viewer).getByRole('button', { name: 'Download' }));
        expect(download).toHaveBeenCalledWith(artifact.url, '_blank');

        fireEvent.click(within(viewer).getByRole('button', { name: 'Close' }));
        await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('Observation artifacts'));
        expect(within(screen.getByRole('dialog')).getByText(folder.foldername)).toBeInTheDocument();
    });

    it.each(['missing', 'unavailable'])('opens an observation image when metadata is %s', async (failure) => {
        vi.stubGlobal('fetch', failure === 'missing'
            ? vi.fn().mockResolvedValue({ ok: false })
            : vi.fn().mockRejectedValue(new Error('offline')));
        renderLibrary();

        const viewer = await openObservationImage();
        expect(within(viewer).getByRole('img', { name: artifact.name })).toHaveAttribute('src', artifact.url);
        expect(within(viewer).queryByText('Robot 36')).not.toBeInTheDocument();
        expect(within(viewer).getByRole('button', { name: 'Download' })).toBeEnabled();
    });

    it('uses the same viewer for a standalone decoded image', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => metadata }));
        const item = { ...artifact, id: 'decoded:sstv.png', type: 'decoded', url: '/decoded/sstv_Robot_36.png', created: folder.created, modified: folder.modified };
        renderLibrary(item);

        fireEvent.click(screen.getByText(item.name));
        const viewer = await screen.findByRole('dialog', { name: new RegExp(item.name) });
        expect(viewer).toHaveStyle({ height: '90dvh' });
        expect(within(viewer).getByRole('img', { name: item.name })).toHaveAttribute('src', item.url);
        expect(within(viewer).getByText('437.635198 MHz')).toBeInTheDocument();
    });

    it.each([false, true])('uses the shared viewer for inline SSTV decoder output (streaming: %s)', async (isStreaming) => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => metadata }));
        const store = configureStore({
            reducer: {
                decoders: () => ({ outputs: [{
                    id: 'sstv-output', type: 'decoder-output', decoder_type: 'sstv', timestamp: 1,
                    output: { filename: artifact.name, image_data: 'dGVzdA==', format: 'image/png' },
                }] }),
                waterfall: () => ({ packetsDrawerOpen: true, packetsDrawerHeight: 300, isStreaming }),
            },
        });
        const theme = createTheme({ palette: { border: { main: '#888' } } });
        render(<Provider store={store}><ThemeProvider theme={theme}><DecodedPacketsDrawer embedded /></ThemeProvider></Provider>);

        fireEvent.click(screen.getByTestId('FolderOpenIcon').closest('button'));
        const viewer = await screen.findByRole('dialog', { name: new RegExp(artifact.name) });
        expect(viewer).toHaveStyle({ height: '90dvh' });
        expect(within(viewer).getByRole('img', { name: artifact.name })).toHaveAttribute('src', 'data:image/png;base64,dGVzdA==');
        expect(within(viewer).getByText('437.635198 MHz')).toBeInTheDocument();
    });
});
