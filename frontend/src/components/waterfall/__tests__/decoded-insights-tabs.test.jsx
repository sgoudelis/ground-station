import React, {StrictMode} from 'react';
import {act, cleanup, fireEvent, render, screen} from '@testing-library/react';
import {configureStore} from '@reduxjs/toolkit';
import {createTheme, ThemeProvider} from '@mui/material/styles';
import {Provider} from 'react-redux';
import {afterEach, expect, it, vi} from 'vitest';
import '../../../i18n/config.js';
import DecodedInsightsIsland from '../decoded-insights-island.jsx';
import gnssReducer, {setDecodedInsightsActiveTab} from '../gnss-slice.jsx';

const connection = vi.hoisted(() => ({socket: null}));
vi.mock('../../common/socket.jsx', () => ({useSocket: () => connection}));
vi.mock('../decoded-packets-drawer.jsx', () => ({default: () => <div>Decoded packets</div>}));
vi.mock('../../satellites/satellite-info-page.jsx', () => ({SatelliteInfoDialog: () => null}));
vi.mock('../gnss-fix-quality-timeline.jsx', () => ({default: () => null}));

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    connection.socket = null;
});

function renderIsland({connected = true} = {}) {
    const handlers = new Map();
    const socket = {
        connected,
        on: vi.fn((event, handler) => {
            if (!handlers.has(event)) handlers.set(event, new Set());
            handlers.get(event).add(handler);
        }),
        off: vi.fn((event, handler) => handlers.get(event)?.delete(handler)),
        emit: vi.fn((_event, _request, reply) => reply?.({success: true, data: {aircraft: []}})),
    };
    connection.socket = socket;
    const store = configureStore({reducer: {
        gnss: gnssReducer,
        decoders: () => ({outputs: []}),
        waterfall: () => ({gridEditable: false}),
    }});
    store.dispatch(setDecodedInsightsActiveTab('packets'));
    const theme = createTheme({palette: {border: {main: '#888', light: '#aaa', dark: '#555'}}});
    const view = render(<StrictMode><Provider store={store}><ThemeProvider theme={theme}>
        <DecodedInsightsIsland />
    </ThemeProvider></Provider></StrictMode>);
    const receive = (records) => act(() => {
        handlers.get('adsb.aircraft').forEach((handler) => handler({aircraft: records}));
        vi.advanceTimersByTime(1000);
    });
    const emit = (event) => act(() => handlers.get(event).forEach((handler) => handler()));
    return {...view, receive, socket, emit};
}

it('updates the ADS-B count while Packets remains selected and after switching back', () => {
    vi.useFakeTimers();
    const {receive} = renderIsland();
    const aircraft = (icao) => ({icao, timestamp: Date.now() / 1000});
    expect(screen.getByRole('tab', {name: 'PACKETS (0)'})).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', {name: 'ADSB (0)'})).toBeInTheDocument();

    receive([aircraft('406b90')]);
    expect(screen.getByRole('tab', {name: 'ADSB (1)'})).toBeInTheDocument();
    expect(screen.getByRole('tab', {name: 'PACKETS (0)'})).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(screen.getByRole('tab', {name: 'ADSB (1)'}));
    fireEvent.click(screen.getByRole('tab', {name: 'PACKETS (0)'}));
    receive([aircraft('4d2406')]);
    expect(screen.getByRole('tab', {name: 'ADSB (2)'})).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(61000));
    expect(screen.getByRole('tab', {name: 'ADSB (0)'})).toBeInTheDocument();
    expect(screen.getByRole('tab', {name: 'PACKETS (0)'})).toHaveAttribute('aria-selected', 'true');
});

it('keeps the count live when the socket connects after the Packets tab mounts or reconnects', () => {
    vi.useFakeTimers();
    const {receive, socket, emit} = renderIsland({connected: false});
    socket.connected = true;
    emit('connect');
    receive([{icao: '406b90', timestamp: Date.now() / 1000}]);
    expect(screen.getByRole('tab', {name: 'ADSB (1)'})).toBeInTheDocument();

    socket.connected = false;
    emit('disconnect');
    expect(screen.getByRole('tab', {name: 'ADSB (0)'})).toBeInTheDocument();
    socket.connected = true;
    emit('connect');
    receive([{icao: '4d2406', timestamp: Date.now() / 1000}]);
    expect(screen.getByRole('tab', {name: 'ADSB (1)'})).toBeInTheDocument();
    expect(screen.getByRole('tab', {name: 'PACKETS (0)'})).toHaveAttribute('aria-selected', 'true');
});
