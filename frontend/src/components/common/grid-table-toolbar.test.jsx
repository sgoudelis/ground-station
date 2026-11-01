import React, {useState} from 'react';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {DataGrid} from '@mui/x-data-grid';
import {describe, expect, it, vi} from 'vitest';
import '../../i18n/config.js';
import GridTableToolbar from './grid-table-toolbar.jsx';

const rows = [{id: 1, name: 'Mars', elevation: 45}, {id: 2, name: 'Venus', elevation: 10}];
const columns = [
    {field: 'name', headerName: 'Name', width: 150},
    {field: 'elevation', headerName: 'Elevation', type: 'number', width: 150},
];

function Table({id, savedVisibility = {}, onVisibilityChange = () => {}, onDragStart = () => {}}) {
    const [container, setContainer] = useState(null);
    const [visibility, setVisibility] = useState(savedVisibility);
    return <section aria-label={id}>
        <div data-testid={`${id}-title`} onMouseDown={onDragStart} onTouchStart={onDragStart}>
            <div ref={setContainer} />
        </div>
        <div style={{height: 400, width: 600}}>
            <DataGrid rows={rows} columns={columns} disableVirtualization showToolbar
                slots={{toolbar: GridTableToolbar}} slotProps={{toolbar: {container}}}
                columnVisibilityModel={visibility}
                onColumnVisibilityModelChange={(model) => {
                    setVisibility(model);
                    onVisibilityChange(model);
                }} />
        </div>
    </section>;
}

describe('Grid table title controls', () => {
    it('changes only its own grid columns and restores a saved choice', async () => {
        const onVisibilityChange = vi.fn();
        const view = render(<><Table id="passes" onVisibilityChange={onVisibilityChange} /><Table id="targets" /></>);
        const title = within(screen.getByTestId('passes-title'));
        fireEvent.click(title.getByRole('button', {name: 'Columns'}));
        fireEvent.click(await screen.findByRole('checkbox', {name: 'Elevation', exact: true}));

        await waitFor(() => expect(onVisibilityChange).toHaveBeenLastCalledWith({elevation: false}));
        expect(within(screen.getByRole('region', {name: 'passes'})).queryByRole('columnheader', {name: 'Elevation'})).toBeNull();
        expect(within(screen.getByRole('region', {name: 'targets'})).getByRole('columnheader', {name: 'Elevation'})).toBeInTheDocument();

        const savedVisibility = onVisibilityChange.mock.lastCall[0];
        view.unmount();
        render(<Table id="restored" savedVisibility={savedVisibility} />);
        expect(screen.queryByRole('columnheader', {name: 'Elevation'})).toBeNull();
        fireEvent.click(screen.getByRole('button', {name: 'Columns'}));
        fireEvent.click(await screen.findByRole('checkbox', {name: 'Elevation', exact: true}));
        await waitFor(() => expect(screen.getByRole('columnheader', {name: 'Elevation'})).toBeInTheDocument());

        fireEvent.click(screen.getByRole('checkbox', {name: 'Show/Hide All'}));
        await waitFor(() => expect(screen.queryAllByRole('columnheader')).toHaveLength(0));
        fireEvent.click(screen.getByRole('checkbox', {name: 'Show/Hide All'}));
        await waitFor(() => expect(screen.getByRole('columnheader', {name: 'Elevation'})).toBeInTheDocument());
    });

    it('filters its own rows through the native filter panel', async () => {
        render(<><Table id="passes" /><Table id="targets" /></>);
        fireEvent.click(within(screen.getByTestId('passes-title')).getByRole('button', {name: 'Filters'}));
        fireEvent.change(await screen.findByRole('textbox', {name: 'Value'}), {target: {value: 'Mars'}});

        const passes = within(screen.getByRole('region', {name: 'passes'}));
        await waitFor(() => expect(passes.queryByRole('gridcell', {name: 'Venus'})).toBeNull());
        expect(passes.getByRole('gridcell', {name: 'Mars'})).toBeInTheDocument();
        expect(within(screen.getByRole('region', {name: 'targets'})).getByRole('gridcell', {name: 'Venus'})).toBeInTheDocument();

        fireEvent.change(screen.getByRole('textbox', {name: 'Value'}), {target: {value: ''}});
        await waitFor(() => expect(passes.getByRole('gridcell', {name: 'Venus'})).toBeInTheDocument());
    });

    it('offers numeric comparisons for measurement columns', async () => {
        render(<Table id="passes" />);
        fireEvent.click(screen.getByRole('button', {name: 'Filters'}));
        fireEvent.mouseDown(await screen.findByRole('combobox', {name: 'Columns'}));
        fireEvent.click(await screen.findByRole('option', {name: 'Elevation', exact: true}));
        fireEvent.mouseDown(screen.getByRole('combobox', {name: 'Operator'}));
        fireEvent.click(await screen.findByRole('option', {name: '>', exact: true}));
        fireEvent.change(screen.getByRole('spinbutton', {name: 'Value'}), {target: {value: '20'}});

        await waitFor(() => expect(screen.queryByRole('gridcell', {name: 'Venus'})).toBeNull());
        expect(screen.getByRole('gridcell', {name: 'Mars'})).toBeInTheDocument();
    });

    it('keeps column and filter controls from starting island dragging', () => {
        const onDragStart = vi.fn();
        render(<Table id="passes" onDragStart={onDragStart} />);
        for (const name of ['Columns', 'Filters']) {
            const button = screen.getByRole('button', {name});
            fireEvent.mouseDown(button);
            fireEvent.touchStart(button);
        }
        expect(onDragStart).not.toHaveBeenCalled();
    });
});
