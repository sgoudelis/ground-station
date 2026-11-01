/**
 * @license
 * Copyright (c) 2026 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import { Provider } from 'react-redux';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../i18n/config.js';
import DecodedInsightsIsland from '../decoded-insights-island.jsx';
import gnssReducer, {
    setDecodedInsightsActiveTab,
    updateGnssFixLifecycleFromOutput,
} from '../gnss-slice.jsx';

const socket = vi.hoisted(() => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() }));

vi.mock('../../common/socket.jsx', () => ({ useSocket: () => ({ socket }) }));
vi.mock('../../satellites/satellite-info-page.jsx', () => ({
    SatelliteInfoDialog: ({ open, onClose, satelliteData }) => open && (
        <div role="dialog">
            <span>{satelliteData.name}</span>
            <span>{satelliteData.transmitters[0]?.description}</span>
            <span>{satelliteData.position?.lat}</span>
            <button type="button" onClick={onClose}>Close details</button>
        </div>
    ),
}));
// Render the real satellite cell without DataGrid's viewport virtualization in JSDOM.
vi.mock('@mui/x-data-grid', () => ({
    gridClasses: { cell: 'MuiDataGrid-cell', columnHeader: 'MuiDataGrid-columnHeader' },
    DataGrid: ({ rows, columns, onRowClick }) => {
        const satelliteColumn = columns.find((column) => column.field === 'satelliteId');
        return (
            <div>
                {rows.map((row) => (
                    <div key={row.id} onClick={() => onRowClick({ id: row.id })}>
                        {satelliteColumn.renderCell({ row, value: row.satelliteId })}
                    </div>
                ))}
            </div>
        );
    },
}));

const theme = createTheme({ palette: { border: { main: '#888', light: '#aaa', dark: '#555' } } });

function renderIsland() {
    const store = configureStore({
        reducer: {
            gnss: gnssReducer,
            decoders: () => ({ outputs: [] }),
            waterfall: () => ({ gridEditable: false }),
        },
    });
    store.dispatch(setDecodedInsightsActiveTab('gnss'));
    for (const [prn, noradId, verified] of [
        [12, 12345, true],
        [13, null, true],
        [14, 67890, true],
        [15, 55555, false],
    ]) {
        store.dispatch(updateGnssFixLifecycleFromOutput({
            decoder_type: 'gnss',
            timestamp: 100 + prn,
            output: {
                satellite_system: 'G',
                satellite_prn: prn,
                ...(noradId !== null ? { satellite_norad_id: noradId } : {}),
                event: 'tracking',
                navigation_verified: verified,
                verification_source: verified ? 'navigation_word' : null,
            },
        }));
    }
    render(
        <Provider store={store}>
            <ThemeProvider theme={theme}>
                <DecodedInsightsIsland />
            </ThemeProvider>
        </Provider>,
    );
}

describe('decoded GNSS satellite details links', () => {
    beforeEach(() => {
        socket.emit.mockReset();
        socket.emit.mockImplementation((_event, request, acknowledge) => {
            acknowledge({
                success: true,
                data: {
                    details: { norad_id: request.data, name: `Catalog ${request.data}` },
                    transmitters: [{ description: `Transmitter ${request.data}` }],
                    position: { lat: 12.5 },
                },
            });
        });
    });

    it('opens shared details for a verified row with NORAD and leaves unmatched rows as text', async () => {
        renderIsland();

        expect(screen.getByText('GPS 13')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'GPS 13' })).not.toBeInTheDocument();
        expect(screen.queryByText('GPS 15 (55555)')).not.toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'GPS 12 (12345)' }));

        await waitFor(() => expect(socket.emit).toHaveBeenCalledWith(
            'api.call',
            { cmd: 'get-satellite', data: 12345 },
            expect.any(Function),
        ));
        expect(await screen.findByRole('dialog')).toHaveTextContent('Catalog 12345');
        expect(screen.getByRole('dialog')).toHaveTextContent('Transmitter 12345');
        expect(screen.getByRole('dialog')).toHaveTextContent('12.5');
    });

    it('keeps the latest satellite when detail requests complete out of order', async () => {
        const acknowledgements = new Map();
        socket.emit.mockImplementation((_event, request, acknowledge) => {
            acknowledgements.set(request.data, acknowledge);
        });
        renderIsland();

        fireEvent.click(screen.getByRole('button', { name: 'GPS 12 (12345)' }));
        fireEvent.click(screen.getByRole('button', { name: 'GPS 14 (67890)' }));

        await act(async () => {
            acknowledgements.get(67890)({
                success: true,
                data: { details: { norad_id: 67890, name: 'New selection' } },
            });
        });
        expect(screen.getByRole('dialog')).toHaveTextContent('New selection');

        await act(async () => {
            acknowledgements.get(12345)({
                success: true,
                data: { details: { norad_id: 12345, name: 'Old selection' } },
            });
        });
        expect(screen.getByRole('dialog')).toHaveTextContent('New selection');
    });
});
