import React from 'react';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {createTheme, ThemeProvider} from '@mui/material/styles';
import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {beforeEach, expect, it, vi} from 'vitest';
import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import AircraftPanel from '../aircraft-panel.jsx';

await i18n.use(initReactI18next).init({lng: 'en', resources: {}});
vi.mock('../../common/socket.jsx', () => ({useSocket: () => ({socket: null})}));
const live = vi.hoisted(() => ({aircraft: [], error: null}));
vi.mock('../use-aircraft.js', () => ({default: () => live}));

beforeEach(() => {
    live.aircraft = [
        {icao: '4d2406', callsign: 'EWG46A'},
        {icao: '46b825', callsign: 'GREEK'},
        {icao: 'ffffff', callsign: 'UNKNOWN'},
    ];
});

function renderPanel(receiver = {lat: '0', lon: '0'}) {
    const store = configureStore({reducer: {
        location: (state = {location: receiver}, action) => action.type === 'test/location'
            ? {location: action.payload} : state,
    }});
    const wrapper = ({children}) => <Provider store={store}>
        <ThemeProvider theme={createTheme()}>{children}</ThemeProvider>
    </Provider>;
    return {...render(<AircraftPanel />, {wrapper}), store};
}

const rowOrder = () => screen.getAllByRole('row')
    .filter((row) => row.hasAttribute('data-id')).map((row) => row.getAttribute('data-id'));

it('displays enriched aircraft and opens translated metadata', () => {
    live.aircraft = [{icao: '40621d', callsign: 'EZY123', aircraft: {
        registration: 'G-TEST', type_code: 'C172', model: 'CESSNA 172 Skyhawk', military_status: 'military',
        category: 'A1', aircraft_class: 'L', engine_count: 1, engine_type: 'P', wake_category: 'L',
        operator_name: 'Easyjet Uk', operator_country: 'United Kingdom', operator_callsign: 'EASY',
        database: {version: 529, date: '2026-11-01'},
    }}];
    renderPanel();
    const row = screen.getByRole('row', {name: /40621D/});
    expect(screen.getByRole('columnheader', {name: /^Classification/})).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', {name: /^Military status/})).not.toBeInTheDocument();
    expect(row).toHaveTextContent('G-TEST');
    expect(row.querySelector('[data-field="classification"]')).toHaveTextContent('Military · Light aircraft');
    fireEvent.click(within(row).getByRole('button', {name: 'Aircraft details'}));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByText('Piston')).toBeInTheDocument();
    expect(dialog.getByText('United Kingdom')).toBeInTheDocument();
    expect(dialog.getByText('EASY')).toBeInTheDocument();
    expect(screen.queryByRole('link', {name: 'Mictronics Aircraft Database'})).not.toBeInTheDocument();
    expect(dialog.queryByText(/Military markings come from/)).not.toBeInTheDocument();
    expect(dialog.queryByText(/Operator details are inferred/)).not.toBeInTheDocument();
});

it('shows non-military classifications and updates flags in the same column', () => {
    live.aircraft = [
        {icao: '4d2406', aircraft: {military_status: 'unclassified', category: 'B1'}},
        {icao: '46b825', aircraft: {aircraft_class: 'D', interesting: true}},
        {icao: 'ffffff'},
    ];
    const {rerender} = renderPanel();
    const classification = (icao) => screen.getByRole('row', {name: icao})
        .querySelector('[data-field="classification"]');
    expect(classification(/4D2406/)).toHaveTextContent('Glider / sailplane');
    expect(classification(/46B825/)).toHaveTextContent('Interesting · Drone');
    expect(classification(/FFFFFF/)).toHaveTextContent('Unclassified');

    live.aircraft = live.aircraft.map((record) => record.icao === '4d2406'
        ? {...record, aircraft: {...record.aircraft, military_status: 'military'}} : record);
    rerender(<AircraftPanel />);
    expect(classification(/4D2406/)).toHaveTextContent('Military · Glider / sailplane');
});

it('shows registration flags beside ICAO addresses with country tooltips and leaves unknown flags empty', async () => {
    renderPanel();
    const maltese = screen.getByRole('row', {name: /4D2406/});
    const flag = within(maltese).getByRole('img', {name: 'ICAO registration country: Malta'});
    expect(flag).toHaveTextContent('🇲🇹');
    expect(within(screen.getByRole('row', {name: /46B825/})).getByRole('img')).toHaveTextContent('🇬🇷');
    expect(within(screen.getByRole('row', {name: /FFFFFF/})).queryByRole('img')).not.toBeInTheDocument();
    fireEvent.mouseOver(flag);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('ICAO registration country: Malta');
});

it('defaults to nearest first with ICAO ties and keeps missing positions last in both directions', () => {
    live.aircraft = [
        {icao: 'ffffff', callsign: 'UNKNOWN'},
        {icao: '4d2406', callsign: 'FAR', latitude: 0, longitude: 2},
        {icao: '46b825', callsign: 'NEAR', latitude: 0, longitude: 1},
        {icao: '406b90', callsign: 'TIE', latitude: 0, longitude: 1},
        {icao: '400000', callsign: 'OVERHEAD', latitude: 0, longitude: 0},
        {icao: '000001', callsign: 'NULL', latitude: null, longitude: null},
    ];
    renderPanel();
    const distanceHeader = screen.getByRole('columnheader', {name: /^Distance \(km\)/});
    expect(distanceHeader).toHaveAttribute('aria-sort', 'ascending');
    expect(rowOrder()).toEqual(['400000', '406b90', '46b825', '4d2406', '000001', 'ffffff']);
    expect(within(screen.getByRole('row', {name: /400000/})).getByText('0.0 km')).toBeInTheDocument();
    expect(within(screen.getByRole('row', {name: /4D2406/})).getByText('222.4 km')).toBeInTheDocument();
    expect(screen.getByRole('row', {name: /FFFFFF/}).querySelector('[data-field="distance_km"]'))
        .toHaveTextContent('—');

    fireEvent.click(distanceHeader);
    expect(distanceHeader).toHaveAttribute('aria-sort', 'descending');
    expect(rowOrder()).toEqual(['4d2406', '406b90', '46b825', '400000', '000001', 'ffffff']);
});

it('recalculates distances when aircraft or station coordinates change and preserves a chosen sort', () => {
    live.aircraft = [
        {icao: '4d2406', callsign: 'ALPHA', latitude: 0, longitude: 2},
        {icao: '46b825', callsign: 'BRAVO', latitude: 0, longitude: 1},
    ];
    const {rerender, store} = renderPanel();
    expect(rowOrder()).toEqual(['46b825', '4d2406']);

    live.aircraft = live.aircraft.map((record) => record.icao === '4d2406'
        ? {...record, longitude: 0} : record);
    rerender(<AircraftPanel />);
    expect(rowOrder()).toEqual(['4d2406', '46b825']);

    act(() => store.dispatch({type: 'test/location', payload: {lat: 0, lon: 1}}));
    expect(rowOrder()).toEqual(['46b825', '4d2406']);

    fireEvent.click(screen.getByRole('columnheader', {name: /^Callsign/}));
    expect(rowOrder()).toEqual(['4d2406', '46b825']);
    act(() => store.dispatch({type: 'test/location', payload: {lat: 0, lon: 0}}));
    expect(screen.getByRole('columnheader', {name: /^Callsign/})).toHaveAttribute('aria-sort', 'ascending');
    expect(rowOrder()).toEqual(['4d2406', '46b825']);
});

it('shows unknown distances and falls back to ICAO order without a station location', () => {
    live.aircraft = [
        {icao: '4d2406', latitude: 0, longitude: 0},
        {icao: '46b825', latitude: 0, longitude: 1},
    ];
    renderPanel(null);
    expect(rowOrder()).toEqual(['46b825', '4d2406']);
    for (const icao of [/4D2406/, /46B825/]) {
        expect(screen.getByRole('row', {name: icao}).querySelector('[data-field="distance_km"]'))
            .toHaveTextContent('—');
    }
    expect(screen.getByTitle('Aircraft with a decoded position')).toHaveTextContent('pos: 2');
    expect(screen.getByTitle('Farthest aircraft from your station')).toHaveTextContent('max: —');
});

it('summarizes decoded aircraft without inventing missing positions or ground status', () => {
    live.aircraft = [
        {icao: '400000', callsign: 'OVERHEAD', latitude: 0, longitude: 0, on_ground: true},
        {icao: '406b90', callsign: 'FAR', latitude: 0, longitude: 2, on_ground: false},
        {icao: '46b825', callsign: ' ', latitude: 91, longitude: 0},
        {icao: '4d2406', callsign: null},
    ];
    const {rerender} = renderPanel();
    expect(screen.getByTitle('Tracked aircraft')).toHaveTextContent('ac: 4');
    expect(screen.getByTitle('Aircraft with a decoded position')).toHaveTextContent('pos: 2');
    expect(screen.getByTitle('Aircraft with a callsign')).toHaveTextContent('calls: 2');
    expect(screen.getByTitle('Aircraft reporting they are on the ground')).toHaveTextContent('gnd: 1');
    expect(screen.getByTitle('Farthest aircraft from your station')).toHaveTextContent('max: 222.4 km');

    live.aircraft = live.aircraft.slice(0, 1);
    rerender(<AircraftPanel />);
    expect(screen.getByTitle('Tracked aircraft')).toHaveTextContent('ac: 1');
    expect(screen.getByTitle('Farthest aircraft from your station')).toHaveTextContent('max: 0.0 km');
});
