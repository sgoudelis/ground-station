import React from 'react';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {expect, it, vi} from 'vitest';
import '../../../i18n/config.js';
import SourcesTable, {toFormValues} from '../sources-table.jsx';
import sourcesReducer from '../sources-slice.jsx';

const socket = vi.hoisted(() => ({emit: vi.fn()}));
vi.mock('../../common/socket.jsx', () => ({useSocket: () => ({socket})}));
vi.mock('../synchronize-orbital-data-card.jsx', () => ({default: () => null}));
vi.mock('@mui/x-data-grid', () => ({
    gridClasses: {cell: 'MuiDataGrid-cell', columnHeader: 'MuiDataGrid-columnHeader'},
    DataGrid: () => null,
}));

it('puts Enabled first and saves the source group visibility switch', async () => {
    const source = {
        id: 'source-1',
        name: 'Orbital source',
        url: 'https://example.test/orbits.txt',
        enabled: false,
        show_on_earth_view: false,
    };
    socket.emit.mockImplementation((_event, _request, acknowledge) => acknowledge({success: true, data: [source]}));
    const store = configureStore({
        reducer: {tleSources: sourcesReducer},
        preloadedState: {
            tleSources: {
                ...sourcesReducer(undefined, {type: 'init'}),
                tleSources: [source],
                formValues: toFormValues(source),
                openAddDialog: true,
            },
        },
    });
    render(<Provider store={store}><SourcesTable showTabs={false} /></Provider>);

    const dialog = screen.getByRole('dialog');
    const enabled = within(dialog).getByLabelText('Enabled');
    expect(dialog.querySelector('input')).toBe(enabled);
    expect(enabled).not.toBeChecked();
    const visibility = within(dialog).getByRole('switch', {name: "Show in Earth view's recent groups"});
    expect(visibility).not.toBeChecked();

    fireEvent.click(visibility);
    fireEvent.click(within(dialog).getByRole('button', {name: 'Edit'}));
    await waitFor(() => expect(socket.emit).toHaveBeenCalledWith('api.call', expect.objectContaining({
        cmd: 'edit-orbital-source',
        data: expect.objectContaining({id: 'source-1', enabled: false, show_on_earth_view: true}),
    }), expect.any(Function)));
});
