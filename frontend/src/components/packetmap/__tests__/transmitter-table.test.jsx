import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {beforeEach, expect, it, vi} from 'vitest';
import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import TransmitterTable from '../transmitter-table.jsx';
import packetMapReducer from '../packet-map-slice.jsx';

await i18n.use(initReactI18next).init({lng: 'en', resources: {}});
const {gridRender} = vi.hoisted(() => ({gridRender: vi.fn()}));
vi.mock('@mui/x-data-grid', () => ({DataGrid: (props) => {
    gridRender(props);
    return <div>{props.rows.map((row) => <div key={row.id}>
        {props.columns.find(({field}) => field === 'name').renderCell({row})}
    </div>)}</div>;
}}));
vi.mock('../../common/common.jsx', () => ({
    TitleBar: ({children}) => <div>{children}</div>, islandTitleBarCompactSx: {},
    getClassNamesBasedOnGridEditing: () => '',
}));
vi.mock('../../common/grid-table-toolbar.jsx', () => ({default: () => null}));
vi.mock('../transmitter-columns-management.jsx', () => ({default: () => null}));
vi.mock('../../../hooks/useUserTimeSettings.jsx', () => ({useUserTimeSettings: () => ({timezone: 'UTC', locale: 'en'})}));

beforeEach(() => vi.clearAllMocks());

it('keeps columns and grid props stable across playback ticks while aircraft cells age and clicks use the latest callback', () => {
    const store = configureStore({reducer: {packetMap: packetMapReducer}});
    const received = Date.parse('2026-11-02T12:00:00Z');
    const rows = [{id: 'plane', name: 'TEST', kind: 'adsb', captured_at: new Date(received).toISOString(),
        aircraft: {type_code: 'A320'}, details: {telemetry: {heading: 90}}}];
    const hiddenTypes = [];
    const element = (time, callback, data = rows) => <Provider store={store}>
        <TransmitterTable rows={data} playbackTime={time} onSelectTransmitter={callback} hiddenTypes={hiddenTypes} />
    </Provider>;
    const firstCallback = vi.fn();
    const {container, rerender} = render(element(received, firstCallback));
    const props = gridRender.mock.lastCall[0];
    expect(container.querySelector('path[fill]')).toHaveAttribute('fill', '#66bb6a');

    const latestCallback = vi.fn();
    rerender(element(received + 61000, latestCallback));
    const updated = gridRender.mock.lastCall[0];
    for (const key of ['columns', 'rows', 'rowSelectionModel', 'columnVisibilityModel', 'onRowSelectionModelChange',
        'getRowClassName', 'slots', 'slotProps', 'sx']) expect(updated[key], key).toBe(props[key]);
    expect(container.querySelector('path[fill]')).toHaveAttribute('fill', '#9e9e9e');
    fireEvent.click(screen.getByRole('button', {name: 'TEST'}));
    expect(latestCallback).toHaveBeenCalledWith('plane');
    expect(firstCallback).not.toHaveBeenCalled();

    // Fresh values and metadata objects keep the same schema; new fields rebuild it.
    const liveRows = rows.map((row) => ({...row, details: {telemetry: {heading: 180}}}));
    rerender(element(received + 62000, latestCallback, liveRows));
    expect(gridRender.mock.lastCall[0].columns).toBe(props.columns);
    expect(gridRender.mock.lastCall[0].columns.find(({field}) => field === 'info:telemetry.heading')
        .valueGetter(null, gridRender.mock.lastCall[0].rows[0])).toBe(180);
    rerender(element(received + 63000, latestCallback, [{...rows[0], details: {telemetry: {heading: 180, vel_v: 5}}}]));
    expect(gridRender.mock.lastCall[0].columns).not.toBe(props.columns);
    expect(gridRender.mock.lastCall[0].columns.some(({field}) => field === 'info:telemetry.vel_v')).toBe(true);
});
