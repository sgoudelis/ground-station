import './telemetry-i18n.js';
import React from 'react';
import {fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import {Provider} from 'react-redux';
import {configureStore} from '@reduxjs/toolkit';
import {createTheme, ThemeProvider} from '@mui/material/styles';
import RadiosondeTab from '../telemetry-radiosonde-tab.jsx';
import APRSTab from '../telemetry-aprs-tab.jsx';

// Exercise the packet views and controls without fetching tiles or laying out Leaflet in jsdom.
vi.mock('react-leaflet', () => ({
    MapContainer: ({children, center, scrollWheelZoom}) => <div data-testid="map"
        data-center={JSON.stringify(center)} data-zoom={String(scrollWheelZoom)}>{children}</div>,
    CircleMarker: ({children, center}) => <div data-testid="sonde" data-position={JSON.stringify(center)}>{children}</div>,
    Marker: ({children, position}) => <div data-testid="receiver" data-position={JSON.stringify(position)}>{children}</div>,
    Polyline: ({positions}) => <div data-testid="path" data-positions={JSON.stringify(positions)} />,
    TileLayer: ({url}) => <div data-testid="tiles">{url}</div>,
    Tooltip: ({children}) => <span>{children}</span>,
    useMap: () => ({invalidateSize: () => {}}),
}));
vi.mock('../../common/tile-layers.jsx', () => ({
    getTileLayerById: (id) => ({id, url: `tiles/${id}`, attribution: 'Map attribution'}),
}));
vi.mock('../../../hooks/useUserTimeSettings.jsx', () => ({
    useUserTimeSettings: () => ({timezone: 'UTC', locale: 'en-US'}),
}));

function renderView(view, receiver = {lat: '40.6', lon: '22.9'}) {
    const store = configureStore({reducer: () => ({
        location: {location: receiver}, earthViewTrack: {tileLayerID: 'osm'},
    })});
    const theme = createTheme({palette: {border: {light: '#ccc'}}});
    return render(<Provider store={store}><ThemeProvider theme={theme}>{view}</ThemeProvider></Provider>);
}

function metadata(readings = {}) {
    return {telemetry: {schema_version: 1, parser_id: 'radiosonde_rs', payload: {
        kind: 'telemetry', records: [{id: '0', title: 'M10 TEST0042', groups: [{id: 'values', title: 'Values',
            values: {id: 'TEST0042', lat: 40.5, lon: 23, temp: -12.5, ...readings},
            field_info: {temp: {label: 'Temperature', unit: '°C'}},
        }]}],
    }}};
}

describe('Packet position maps', () => {
    it('maps the radiosonde and receiver, retaining measurements and an external map link', () => {
        renderView(<RadiosondeTab metadata={metadata()} />);
        expect(screen.getByText('Radiosonde Position')).toBeInTheDocument();
        expect(screen.getByTestId('map')).toHaveAttribute('data-center', '[40.5,23]');
        expect(screen.getByTestId('sonde')).toHaveTextContent('TEST0042');
        expect(screen.getByTestId('receiver')).toHaveAttribute('data-position', '[40.6,22.9]');
        expect(screen.getByTestId('path')).toHaveAttribute('data-positions', '[[40.6,22.9],[40.5,23]]');
        expect(screen.getByTestId('tiles')).toHaveTextContent('tiles/osm');
        expect(screen.getByText('-12.5 °C')).toBeInTheDocument();
        expect(screen.getByRole('link', {name: 'Open map'})).toHaveAttribute('href',
            'https://www.openstreetmap.org/?mlat=40.5&mlon=23#map=15/40.5/23');
    });

    it('supports the same receiver, path, zoom and layer controls', () => {
        renderView(<RadiosondeTab metadata={metadata()} />);
        fireEvent.click(screen.getByRole('switch', {name: 'Path'}));
        expect(screen.queryByTestId('path')).not.toBeInTheDocument();
        expect(screen.getByTestId('receiver')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('switch', {name: 'Path'}));
        fireEvent.click(screen.getByRole('switch', {name: 'Receiver'}));
        expect(screen.queryByTestId('receiver')).not.toBeInTheDocument();
        expect(screen.queryByTestId('path')).not.toBeInTheDocument();
        expect(screen.getByTestId('map')).toHaveAttribute('data-zoom', 'false');
        fireEvent.click(screen.getByRole('switch', {name: 'Enable Radiosonde map zoom gestures'}));
        expect(screen.getByTestId('map')).toHaveAttribute('data-zoom', 'true');
        fireEvent.mouseDown(screen.getByRole('combobox', {name: 'Radiosonde map layer'}));
        fireEvent.click(screen.getByRole('option', {name: 'Topographic'}));
        expect(screen.getByTestId('tiles')).toHaveTextContent('tiles/topo');
    });

    it.each([
        {lat: null}, {lon: undefined}, {lat: NaN}, {lon: Infinity}, {lat: 91}, {lon: -181},
        {lat: '', lon: ''}, {encrypted: true, lat: 0, lon: 0},
    ])('keeps telemetry without a map for unavailable coordinates: %j', (values) => {
        renderView(<RadiosondeTab metadata={metadata(values)} />);
        expect(screen.queryByTestId('map')).not.toBeInTheDocument();
        expect(screen.queryByRole('link', {name: 'Open map'})).not.toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('No position is available');
        expect(screen.getByText('-12.5 °C')).toBeInTheDocument();
    });

    it('accepts a genuine zero coordinate without inventing a missing receiver location', () => {
        renderView(<RadiosondeTab metadata={metadata({lat: 0, lon: 0})} />, {lat: null, lon: null});
        expect(screen.getByTestId('map')).toHaveAttribute('data-center', '[0,0]');
        expect(screen.queryByTestId('receiver')).not.toBeInTheDocument();
        expect(screen.queryByTestId('path')).not.toBeInTheDocument();
        expect(screen.queryByRole('switch', {name: 'Receiver'})).not.toBeInTheDocument();
    });

    it('preserves the APRS map and station label using the shared component', () => {
        renderView(<APRSTab metadata={{telemetry: {frame: {source: 'SV1TEST'}, payload: {aprs: {
            data_type_identifier: '!', position: {latitude: 40.5, longitude: 23},
        }}}}} />);
        expect(screen.getByText('APRS Position')).toBeInTheDocument();
        expect(screen.getByTestId('sonde')).toHaveTextContent('SV1TEST');
        expect(screen.getByTestId('path')).toBeInTheDocument();
        expect(screen.getByRole('switch', {name: 'Enable APRS map zoom gestures'})).toBeInTheDocument();
        expect(screen.getByRole('link', {name: 'Open map'})).toBeInTheDocument();
    });
});
