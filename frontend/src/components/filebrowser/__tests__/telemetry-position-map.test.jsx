import './telemetry-i18n.js';
import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import {Provider} from 'react-redux';
import {configureStore} from '@reduxjs/toolkit';
import {createTheme, ThemeProvider} from '@mui/material/styles';
import RadiosondeTab from '../telemetry-radiosonde-tab.jsx';
import APRSTab from '../telemetry-aprs-tab.jsx';
import TelemetryValuesTab from '../telemetry-values-tab.jsx';

const {map} = vi.hoisted(() => ({map: {invalidateSize: vi.fn(), fitBounds: vi.fn()}}));
beforeEach(() => vi.clearAllMocks());

// Exercise the packet views and controls without fetching tiles or laying out Leaflet in jsdom.
vi.mock('react-leaflet', () => ({
    MapContainer: ({children, center, scrollWheelZoom, zoomSnap, zoomDelta}) => <div data-testid="map"
        data-center={JSON.stringify(center)} data-zoom={String(scrollWheelZoom)}
        data-zoom-snap={zoomSnap} data-zoom-delta={zoomDelta}>{children}</div>,
    CircleMarker: ({children, center}) => <div data-testid="sonde" data-position={JSON.stringify(center)}>{children}</div>,
    Marker: ({children, position}) => <div data-testid="receiver" data-position={JSON.stringify(position)}>{children}</div>,
    Polyline: ({positions}) => <div data-testid="path" data-positions={JSON.stringify(positions)} />,
    TileLayer: ({url}) => <div data-testid="tiles">{url}</div>,
    Tooltip: ({children}) => <span>{children}</span>,
    useMap: () => map,
}));
vi.mock('../../common/tile-layers.jsx', () => ({
    getTileLayerById: (id) => ({id, url: `tiles/${id}`, attribution: 'Map attribution'}),
}));
vi.mock('../../../hooks/useUserTimeSettings.jsx', () => ({
    useUserTimeSettings: () => ({timezone: 'UTC', locale: 'en-US'}),
}));

function renderView(view, receiver = {lat: '40.6', lon: '22.9'}) {
    const initialState = {
        location: {location: receiver}, earthViewTrack: {tileLayerID: 'osm'},
    };
    const store = configureStore({reducer: (state = initialState, action) => action.type === 'test/location'
        ? {...state, location: {location: action.payload}} : state});
    const theme = createTheme({palette: {border: {light: '#ccc'}}});
    return {...render(<Provider store={store}><ThemeProvider theme={theme}>{view}</ThemeProvider></Provider>), store};
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
    it('shows a Meshtastic node position with its telemetry and receiver', () => {
        renderView(<TelemetryValuesTab telemetry={{schema_version: 1, parser_id: 'meshtastic',
            payload_status: 'decoded', telemetry: {source: '!2008e299', position: {
                latitude: 40.6585344, longitude: 22.9376, altitude_meters: 32,
            }}, payload: {kind: 'telemetry', records: [{id: '0', title: 'Meshtastic Position',
                groups: [{id: 'position', title: 'Position', values: {sats_in_view: 12},
                    field_info: {sats_in_view: {label: 'Satellites in view'}}}],
            }]}}} />);
        expect(screen.getByTestId('sonde')).toHaveTextContent('!2008e299');
        expect(screen.getByTestId('sonde')).toHaveAttribute('data-position', '[40.6585344,22.9376]');
        expect(screen.getByRole('switch', {name: 'Enable Meshtastic map zoom gestures'})).toBeInTheDocument();
        expect(screen.getByText('Satellites in view')).toBeInTheDocument();
        expect(screen.getByText('12')).toBeInTheDocument();
        expect(screen.getByRole('link', {name: 'Open map'})).toHaveAttribute('href',
            'https://www.openstreetmap.org/?mlat=40.6585344&mlon=22.9376#map=15/40.6585344/22.9376');
        expect(screen.getByTestId('receiver')).toHaveAttribute('data-position', '[40.6,22.9]');
        expect(screen.getByTestId('path')).toHaveAttribute('data-positions', '[[40.6,22.9],[40.6585344,22.9376]]');
    });

    it('fits the radiosonde and receiver, retaining measurements and an external map link', async () => {
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
        expect(screen.getByRole('region', {name: 'Distance to receiver'})).toHaveTextContent('Ground distance');
        expect(screen.queryByText('Approx. straight-line distance')).not.toBeInTheDocument();
        await waitFor(() => expect(map.fitBounds).toHaveBeenLastCalledWith(
            [[40.5, 23], [40.6, 22.9]], {padding: [48, 48], maxZoom: 13, animate: false},
        ));
        expect(map.invalidateSize).toHaveBeenCalled();
    });

    it('shows surface distance and altitude-aware range in kilometres', () => {
        renderView(<RadiosondeTab metadata={metadata({lat: 40.6, lon: 22.9, alt: 14158.75})} />,
            {lat: '40.6', lon: '22.9', alt: '158.75'});
        const distances = within(screen.getByRole('region', {name: 'Distance to receiver'}));
        expect(distances.getByText('Ground distance')).toBeInTheDocument();
        expect(distances.getByText('0.0 km')).toBeInTheDocument();
        expect(distances.getByText('Approx. straight-line distance')).toBeInTheDocument();
        expect(distances.getByText('14.0 km')).toBeInTheDocument();
        expect(distances.getByText(/your current receiver location/)).toBeInTheDocument();
    });

    it('updates distances and map bounds when the configured receiver location changes', async () => {
        const {store} = renderView(<RadiosondeTab metadata={metadata({lat: 0, lon: 0})} />, {lat: 0, lon: 0});
        expect(screen.getByText('0.0 km')).toBeInTheDocument();
        await waitFor(() => expect(map.fitBounds).toHaveBeenLastCalledWith(
            [[0, 0], [0, 0]], expect.objectContaining({maxZoom: 13}),
        ));
        act(() => store.dispatch({type: 'test/location', payload: {lat: 0, lon: 1}}));
        expect(screen.getByText('111.2 km')).toBeInTheDocument();
        await waitFor(() => expect(map.fitBounds).toHaveBeenLastCalledWith(
            [[0, 0], [0, 1]], expect.objectContaining({maxZoom: 13}),
        ));
    });

    it('supports the same receiver, path, zoom and layer controls', () => {
        renderView(<RadiosondeTab metadata={metadata()} />);
        expect(screen.getByTestId('map')).toHaveAttribute('data-zoom-snap', '1');
        expect(screen.getByTestId('map')).toHaveAttribute('data-zoom-delta', '1');
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

    it('fits only the sonde while the receiver marker is hidden', async () => {
        renderView(<RadiosondeTab metadata={metadata()} />);
        await waitFor(() => expect(map.fitBounds).toHaveBeenCalled());
        fireEvent.click(screen.getByRole('switch', {name: 'Receiver'}));
        await waitFor(() => expect(map.fitBounds).toHaveBeenLastCalledWith(
            [[40.5, 23]], expect.objectContaining({maxZoom: 13}),
        ));
        fireEvent.click(screen.getByRole('switch', {name: 'Receiver'}));
        await waitFor(() => expect(map.fitBounds).toHaveBeenLastCalledWith(
            [[40.5, 23], [40.6, 22.9]], expect.objectContaining({maxZoom: 13}),
        ));
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
        expect(screen.queryByRole('region', {name: 'Distance to receiver'})).not.toBeInTheDocument();
    });

    it('fits a genuine zero coordinate without inventing a missing receiver location', async () => {
        renderView(<RadiosondeTab metadata={metadata({lat: 0, lon: 0})} />, {lat: null, lon: null});
        expect(screen.getByTestId('map')).toHaveAttribute('data-center', '[0,0]');
        expect(screen.queryByTestId('receiver')).not.toBeInTheDocument();
        expect(screen.queryByTestId('path')).not.toBeInTheDocument();
        expect(screen.queryByRole('switch', {name: 'Receiver'})).not.toBeInTheDocument();
        expect(screen.queryByRole('region', {name: 'Distance to receiver'})).not.toBeInTheDocument();
        await waitFor(() => expect(map.fitBounds).toHaveBeenLastCalledWith(
            [[0, 0]], expect.objectContaining({maxZoom: 13}),
        ));
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
