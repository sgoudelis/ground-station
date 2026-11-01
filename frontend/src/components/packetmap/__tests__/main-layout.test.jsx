import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {Provider} from 'react-redux';
import {configureStore} from '@reduxjs/toolkit';
import {createTheme, ThemeProvider} from '@mui/material/styles';
import {beforeEach, expect, it, vi} from 'vitest';
import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import PacketMapLayout from '../main-layout.jsx';
import {hiddenTypesStoreName} from '../storage.js';

await i18n.use(initReactI18next).init({lng: 'en', resources: {}});
const {mapRender, tableRender, fixture} = vi.hoisted(() => ({
    mapRender: vi.fn(), tableRender: vi.fn(), fixture: {positions: [], transmitters: []},
}));
vi.mock('react-grid-layout', () => ({
    Responsive: ({children}) => <div>{children}</div>,
    useContainerWidth: () => ({width: 1400, mounted: true, containerRef: {current: null}}),
}));
vi.mock('../../common/socket.jsx', () => ({useSocket: () => ({socket: null})}));
vi.mock('../../common/common.jsx', () => ({
    StyledIslandParentNoScrollbar: ({children}) => <div>{children}</div>,
    TitleBar: ({children}) => <div>{children}</div>, islandTitleBarCompactSx: {},
    getClassNamesBasedOnGridEditing: () => '',
}));
vi.mock('../date-range-bar.jsx', () => ({default: () => null}));
vi.mock('../use-packet-positions.js', () => ({default: () => ({...fixture, loading: false}), callLibrary: vi.fn()}));
vi.mock('../packet-map.jsx', () => ({default: (props) => {mapRender(props); return null;}}));
vi.mock('../transmitter-table.jsx', () => ({default: (props) => {tableRender(props); return null;}}));

beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    fixture.positions = [
        {id: '1', transmitter_id: 'aprs:A', kind: 'aprs', name: 'A'},
        {id: '2', transmitter_id: 'radiosonde:S', kind: 'radiosonde', name: 'S'},
    ];
    fixture.transmitters = fixture.positions.map((point) => ({...point, id: point.transmitter_id, packet_count: 1}));
});

it('hides entire types on the map, retains every table row and remembers visibility', () => {
    const store = configureStore({reducer: () => ({dashboard: {isEditing: false}})});
    const element = <Provider store={store}><ThemeProvider theme={createTheme()}><PacketMapLayout /></ThemeProvider></Provider>;
    const {unmount} = render(element);
    fireEvent.click(screen.getByRole('button', {name: 'Hide APRS'}));
    expect(mapRender.mock.lastCall[0].positions.map((point) => point.kind)).toEqual(['radiosonde']);
    expect(tableRender.mock.lastCall[0].rows).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem(hiddenTypesStoreName))).toEqual(['aprs']);
    fireEvent.click(screen.getByRole('button', {name: 'Hide Radiosonde'}));
    expect(mapRender.mock.lastCall[0].positions).toHaveLength(0);
    expect(mapRender.mock.lastCall[0].hasPositions).toBe(true);
    expect(tableRender.mock.lastCall[0].rows).toHaveLength(2);
    unmount();
    render(element);
    expect(screen.getByRole('button', {name: 'Show APRS'})).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', {name: 'Show APRS'}));
    expect(mapRender.mock.lastCall[0].positions.map((point) => point.kind)).toEqual(['aprs']);
});
