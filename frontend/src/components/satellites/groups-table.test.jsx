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
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import '../../i18n/config.js';
import GroupsTable from './groups-table.jsx';
import groupsReducer from './groups-slice.jsx';

const socket = vi.hoisted(() => ({emit: vi.fn()}));

vi.mock('../common/socket.jsx', () => ({
    useSocket: () => ({socket}),
}));

vi.mock('@mui/x-data-grid', async () => {
    return {
        gridClasses: {cell: 'MuiDataGrid-cell', columnHeader: 'MuiDataGrid-columnHeader'},
        DataGrid: ({rows = [], onRowSelectionModelChange, disableRowSelectionExcludeModel}) => (
            <>
                <button
                    type="button"
                    aria-label="Select first group"
                    onClick={() => onRowSelectionModelChange({
                        type: 'include',
                        ids: new Set(rows.slice(0, 1).map((row) => row.id)),
                    })}
                >
                    Select first group
                </button>
                <button
                    type="button"
                    aria-label="Select all groups"
                    onClick={() => onRowSelectionModelChange({
                        // MUI sends this compact model unless the prop is enabled.
                        type: disableRowSelectionExcludeModel ? 'include' : 'exclude',
                        ids: disableRowSelectionExcludeModel
                            ? new Set(rows.map((row) => row.id))
                            : new Set(),
                    })}
                >
                    Select all groups
                </button>
            </>
        ),
    };
});

const groups = [
    {id: 'group-1', name: 'First group', satellite_ids: ['12345'], added: '2026-01-01T00:00:00Z'},
    {id: 'group-2', name: 'Second group', satellite_ids: ['67890'], added: '2026-01-01T00:00:00Z'},
];

const renderTable = () => {
    const store = configureStore({
        reducer: {satelliteGroups: groupsReducer},
        preloadedState: {satelliteGroups: {...groupsReducer(undefined, {type: 'init'}), groups}},
    });

    render(
        <Provider store={store}>
            <MemoryRouter>
                <GroupsTable />
            </MemoryRouter>
        </Provider>
    );
};

describe('GroupsTable bulk actions', () => {
    beforeEach(() => {
        socket.emit.mockReset();
        socket.emit.mockImplementation((_event, request, acknowledge) => {
            if (request.cmd === 'get-satellites') {
                acknowledge({success: true, data: []});
            }
            if (request.cmd === 'delete-satellite-group') {
                acknowledge({success: true, data: []});
            }
        });
    });

    it('keeps all selected group IDs so the bulk delete action can run', async () => {
        renderTable();

        fireEvent.click(screen.getByRole('button', {name: 'Select all groups'}));
        fireEvent.click(screen.getByRole('button', {name: 'Delete selected'}));
        fireEvent.click(screen.getByRole('button', {name: 'Delete'}));

        await waitFor(() => expect(socket.emit).toHaveBeenCalledWith(
            'api.call',
            expect.objectContaining({
                cmd: 'delete-satellite-group',
                data: ['group-1', 'group-2'],
            }),
            expect.any(Function),
        ));
    });

    it('opens the edit dialog for one selected group', async () => {
        renderTable();

        fireEvent.click(screen.getByRole('button', {name: 'Select first group'}));
        fireEvent.click(screen.getByRole('button', {name: 'Edit selected'}));

        expect(await screen.findByText('Edit Group')).toBeInTheDocument();
    });

    it('saves an edit that only changes recent-group visibility', async () => {
        socket.emit.mockImplementation((_event, request, acknowledge) => {
            acknowledge({success: true, data: request.cmd === 'get-satellites' ? [] : groups});
        });
        renderTable();

        fireEvent.click(screen.getByRole('button', {name: 'Select first group'}));
        fireEvent.click(screen.getByRole('button', {name: 'Edit selected'}));
        const visibility = await screen.findByRole('switch', {name: "Show in Earth view's recent groups"});
        expect(visibility).toBeChecked();
        expect(screen.getByRole('button', {name: 'Save'})).toBeDisabled();

        fireEvent.click(visibility);
        fireEvent.click(screen.getByRole('button', {name: 'Save'}));

        await waitFor(() => expect(socket.emit).toHaveBeenCalledWith('api.call', {
            cmd: 'edit-satellite-group',
            data: {
                id: 'group-1',
                name: 'First group',
                satellite_ids: ['12345'],
                show_on_earth_view: false,
            },
        }, expect.any(Function)));
    });
});
