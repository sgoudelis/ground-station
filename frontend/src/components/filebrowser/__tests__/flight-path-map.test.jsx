import './telemetry-i18n.js';
import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {beforeEach, expect, it, vi} from 'vitest';
import {createTheme, ThemeProvider} from '@mui/material/styles';
import FlightPathMap from '../flight-path-map.jsx';

const {map, latestProps} = vi.hoisted(() => ({
    map: {resize: vi.fn(), fitBounds: vi.fn(), getContainer: () => document.body, autoLoad: true,
        touchZoomRotate: {disableRotation: vi.fn()}},
    latestProps: {current: null},
}));
vi.mock('react-map-gl/maplibre', async () => {
    const React = await import('react');
    return {
        default: React.forwardRef((props, ref) => {
            latestProps.current = props;
            React.useImperativeHandle(ref, () => ({...map, getMap: () => map}), []);
            React.useEffect(() => {if (map.autoLoad) props.onLoad();}, []);
            return <div data-testid="map" data-scroll-zoom={String(props.scrollZoom)}
                data-touch-zoom={String(props.touchZoomRotate)} data-double-click-zoom={String(props.doubleClickZoom)}
                data-initial-view={JSON.stringify(props.initialViewState)}>
                <span data-testid="tiles">{props.mapStyle.sources.basemap.tiles[0]}</span>{props.children}
            </div>;
        }),
        Source: ({data, children}) => <div data-testid="source">
            {data.features.map((feature, index) => <div key={index} data-testid="path" data-color={feature.properties.color}
                data-positions={JSON.stringify(feature.geometry.coordinates)}>{feature.properties.label}</div>)}{children}
        </div>,
        Layer: ({paint}) => <span data-testid="path-layer" data-paint={JSON.stringify(paint)} />,
        Marker: ({longitude, latitude, children}) => <div data-testid="marker" data-position={JSON.stringify([longitude, latitude])}>{children}</div>,
        Popup: ({children}) => <div data-testid="path-tooltip">{children}</div>,
        NavigationControl: () => <span data-testid="navigation" />,
    };
});
vi.mock('../../common/maplibre.js', () => ({maplibregl: {}}));
vi.mock('../../common/tile-layers.jsx', () => ({
    getTileLayerById: id => ({id, attribution: 'Map attribution'}),
    getMapLibreTileURL: id => `tiles/${id}`,
}));
beforeEach(() => {vi.clearAllMocks(); map.autoLoad = true;});

const point = (latitude, longitude, second = 0) => ({latitude, longitude, altitude: 1000, captured_at: new Date(Date.UTC(2026, 10, 1, 10, 0, second)).toISOString()});
const result = (run = '20261101T100000Z.gsadsb') => ({flights: [{run, point_count: 4,
    segments: [[point(0, 0), point(1, 21, 1)], [point(2, 22, 2000), point(3, 23, 2001)]]}],
    point_count: 4, displayed_points: 4, sampled: false});

function mount(initial = {}) {
    const handlers = new Map();
    const requests = [];
    const socket = {connected: true, timeout: () => socket,
        on(event, handler) {if (!handlers.has(event)) handlers.set(event, new Set()); handlers.get(event).add(handler);},
        off(event, handler) {handlers.get(event)?.delete(handler);},
        emit: vi.fn((_event, request, reply) => requests.push({request, reply})),
    };
    let props = {socket, folderId: 'folder', run: '', settings: {timezone: 'UTC', locale: 'en-GB'}, ...initial};
    const theme = createTheme({palette: {border: {light: '#ddd'}}});
    const renderMap = () => <ThemeProvider theme={theme}><FlightPathMap {...props} /></ThemeProvider>;
    const view = render(renderMap());
    return {...view, requests, socket, handlers,
        respond: async (index, data) => act(async () => requests[index].reply(null, {success: true, data})),
        fail: async index => act(async () => requests[index].reply(null, {success: false, error: 'Folder removed'})),
        event: (name, data) => act(() => handlers.get(name)?.forEach(callback => callback(data))),
        update: fields => {props = {...props, ...fields}; view.rerender(renderMap());},
    };
}

it('loads the complete flight scope, draws separate segments and preserves zero coordinates', async () => {
    const view = mount({filter: <span>Flight filter</span>});
    expect(view.requests[0].request).toEqual({cmd: 'filebrowser.flightpaths', data: {id: 'folder'}});
    await view.respond(0, result());
    expect(screen.getByText('Flight filter')).toBeInTheDocument();
    expect(screen.getAllByTestId('path')).toHaveLength(2);
    expect(screen.getAllByTestId('marker')[0]).toHaveAttribute('data-position', '[0,0]');
    expect(screen.getAllByTestId('marker')[1]).toHaveAttribute('data-position', '[23,3]');
    expect(screen.getByText(/^4 recorded positions/)).toBeInTheDocument();
    await waitFor(() => expect(map.fitBounds).toHaveBeenCalledWith([[0, 0], [23, 3]], expect.objectContaining({maxZoom: 12, duration: 0})));
    expect(screen.getAllByTestId('path')[0]).toHaveAttribute('data-positions', '[[0,0],[21,1]]');
    expect(screen.getByTestId('map')).toHaveAttribute('data-scroll-zoom', 'false');
    expect(screen.getByTestId('map')).toHaveAttribute('data-touch-zoom', 'false');
    fireEvent.click(screen.getByRole('switch', {name: 'Zoom gestures'}));
    expect(screen.getByTestId('map')).toHaveAttribute('data-scroll-zoom', 'true');
    expect(screen.getByTestId('map')).toHaveAttribute('data-touch-zoom', 'true');
    expect(screen.getByTestId('map')).toHaveAttribute('data-double-click-zoom', 'true');
    expect(map.touchZoomRotate.disableRotation).toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole('combobox', {name: 'Map layer'}));
    fireEvent.click(screen.getByRole('option', {name: 'Satellite'}));
    expect(screen.getByTestId('tiles')).toHaveTextContent('tiles/satellite');
    const mapElement = screen.getByTestId('map');
    view.update({settings: {timezone: 'UTC', locale: 'en-GB'}});
    expect(screen.getByTestId('map')).toBe(mapElement);
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
});

it('masks the old path immediately on flight switches and ignores late replies', async () => {
    const view = mount();
    await view.respond(0, result());
    view.update({run: 'second'});
    expect(screen.queryByTestId('map')).not.toBeInTheDocument();
    expect(view.requests[1].request.data).toEqual({id: 'folder', run: 'second'});
    view.update({run: 'third'});
    await view.respond(1, result('second'));
    expect(screen.queryByTestId('map')).not.toBeInTheDocument();
    await view.respond(2, result('third'));
    expect(screen.getByTestId('map')).toBeInTheDocument();
    expect(screen.getAllByText('third').length).toBeGreaterThan(0);
    expect(screen.queryByText('second')).not.toBeInTheDocument();
});

it('coalesces relevant changes, queues slow refreshes and preserves the map view until Fit paths is requested', async () => {
    const view = mount();
    await view.respond(0, result());
    await waitFor(() => expect(map.fitBounds).toHaveBeenCalledTimes(1));
    view.event('library.changed', {changes: [{id: 'unrelated'}]});
    expect(view.requests).toHaveLength(1);
    view.event('library.changed', {changes: [{id: 'folder'}]});
    view.event('library.changed', {changes: [{id: '*'}]});
    await waitFor(() => expect(view.requests).toHaveLength(2));
    view.event('connect');
    expect(view.requests).toHaveLength(2);
    await view.respond(1, {...result(), point_count: 6000, sampled: true});
    expect(view.requests).toHaveLength(3);
    await view.respond(2, {...result(), point_count: 6000, sampled: true});
    expect(screen.getByText(/4 shown for performance/)).toBeInTheDocument();
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', {name: 'Fit paths'}));
    await waitFor(() => expect(map.fitBounds).toHaveBeenCalledTimes(2));
    view.unmount();
    expect([...view.handlers.values()].every(callbacks => callbacks.size === 0)).toBe(true);
});

it('shows empty positions and allows failed requests to be retried', async () => {
    const view = mount();
    await view.fail(0);
    expect(screen.getByRole('alert')).toHaveTextContent('Folder removed');
    fireEvent.click(screen.getByRole('button', {name: 'Retry'}));
    await view.respond(1, {flights: [], point_count: 0, displayed_points: 0, sampled: false});
    expect(screen.queryByTestId('map')).not.toBeInTheDocument();
    expect(screen.getByText('No recorded positions for this selection.')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Fit paths'})).toBeDisabled();
});

it('draws each recorded run separately and keeps its color when filtering', async () => {
    const view = mount();
    const data = result('first');
    data.flights.push(result('second').flights[0]);
    await view.respond(0, {...data, point_count: 8, displayed_points: 8});
    expect(screen.getAllByTestId('path')).toHaveLength(4);
    const color = screen.getAllByTestId('path')[2].getAttribute('data-color');
    view.update({run: 'second'});
    await view.respond(1, result('second'));
    expect(screen.getAllByTestId('path')).toHaveLength(2);
    expect(screen.getAllByTestId('path')[0]).toHaveAttribute('data-color', color);
});

it('shows APRS station paths with dated run legends and endpoint timestamps', async () => {
    const run = '20261103T080000.000000Z.gsaprs';
    const view = mount({kind: 'aprs', folderId: 'decoded_folder:aprs_N0CALL-7',
        runs: [{name: run, started_at: '2026-11-03T08:00:00Z'}],
        settings: {timezone: 'Europe/Athens', locale: 'en-GB'}});
    expect(view.requests[0].request.data).toEqual({id: 'decoded_folder:aprs_N0CALL-7'});
    expect(screen.getByRole('region', {name: 'Station activity'})).toHaveTextContent('Loading station paths');
    await view.respond(0, result(run));
    expect(screen.getByRole('region', {name: 'Station path map'})).toBeInTheDocument();
    expect(screen.getAllByText(`3 Nov 2026, 10:00:00 (${run})`).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', {name: /First recorded position.*Europe\/Athens/})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: /Latest recorded position.*Europe\/Athens/})).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Fit paths'})).toBeEnabled();
    view.update({run});
    expect(view.requests[1].request.data).toEqual({id: 'decoded_folder:aprs_N0CALL-7', run});
    await view.fail(1);
    expect(screen.getByText('Station paths are unavailable.')).toBeInTheDocument();
});


it('waits for MapLibre to load before fitting and exposes path labels for map interactions', async () => {
    map.autoLoad = false;
    const view = mount();
    await view.respond(0, result());
    expect(map.fitBounds).not.toHaveBeenCalled();
    act(() => latestProps.current.onLoad());
    await waitFor(() => expect(map.fitBounds).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('navigation')).toBeInTheDocument();
    act(() => latestProps.current.onMouseMove({lngLat: {lng: 21, lat: 1}, features: [{properties: {label: 'Example flight'}}]}));
    expect(screen.getByTestId('path-tooltip')).toHaveTextContent('Example flight');
    act(() => latestProps.current.onMouseLeave());
    expect(screen.queryByTestId('path-tooltip')).not.toBeInTheDocument();
});

it('allows MapLibre renderer failures to be retried without re-fetching saved paths', async () => {
    const view = mount();
    await view.respond(0, result());
    const previousMap = screen.getByTestId('map');
    act(() => latestProps.current.onError({error: new Error('Tile request failed?api_key=secret')}));
    expect(screen.getByRole('alert')).toHaveTextContent('Tile request failed?api_key=[redacted]');
    fireEvent.click(screen.getByRole('button', {name: 'Retry'}));
    expect(screen.getByTestId('map')).not.toBe(previousMap);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(view.requests).toHaveLength(1);
    expect(map.fitBounds).toHaveBeenCalledTimes(2);
});
