import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {MemoryRouter} from 'react-router-dom';
import {expect, it, vi} from 'vitest';
import '../../../i18n/config.js';
import satelliteReducer from '../satellite-slice.jsx';
import SatelliteTable from '../satellite-table.jsx';

const {socket, catalogReplies} = vi.hoisted(() => ({
    socket: {emit: vi.fn()},
    catalogReplies: [],
}));

vi.mock('../../common/socket.jsx', () => ({useSocket: () => ({socket})}));
it('waits for the initial catalog response before allowing Add, even when groups load first', async () => {
    socket.emit.mockImplementation((_event, request, reply) => {
        if (request.cmd === 'get-satellite-search') {
            // Hold the catalog response while the faster startup requests finish.
            catalogReplies.push(reply);
        } else {
            reply({success: true, data: []});
        }
    });
    const store = configureStore({reducer: {satellites: satelliteReducer}});
    render(<Provider store={store}><MemoryRouter><SatelliteTable /></MemoryRouter></Provider>);

    const addButton = screen.getByRole('button', {name: 'Add', exact: true});
    expect(addButton).toBeDisabled();
    expect(screen.getByRole('grid')).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(addButton);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await waitFor(() => expect(catalogReplies).toHaveLength(1));
    expect(addButton).toBeDisabled();
    await act(async () => {
        catalogReplies.shift()({success: true, data: {items: [], total: 0}});
    });

    expect(screen.getByRole('grid')).toHaveAttribute('aria-busy', 'false');
    expect(addButton).toBeEnabled();
    fireEvent.click(addButton);
    expect(screen.getByRole('dialog', {name: /add satellite/i})).toBeVisible();
});
