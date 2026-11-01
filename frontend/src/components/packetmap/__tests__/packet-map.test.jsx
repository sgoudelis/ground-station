import React from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Provider} from 'react-redux';
import {configureStore} from '@reduxjs/toolkit';
import {createTheme, ThemeProvider} from '@mui/material/styles';
import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import PacketMap, {MapViewport} from '../packet-map.jsx';
import {mapSettingsStoreName, mapViewStoreName} from '../storage.js';

await i18n.use(initReactI18next).init({lng: 'en', resources: {}, interpolation: {escapeValue: false}});

const {map, listeners} = vi.hoisted(() => {
    const listeners = new Map();
    const map = {
        on: vi.fn((events, fn) => events.split(' ').forEach((event) => listeners.set(event, fn))),
        off: vi.fn((events) => events.split(' ').forEach((event) => listeners.delete(event))),
        invalidateSize: vi.fn(), fitBounds: vi.fn(), setView: vi.fn(),
        zoomIn: vi.fn(), zoomOut: vi.fn(), panBy: vi.fn(),
        dragging: {enable: vi.fn(), disable: vi.fn()}, scrollWheelZoom: {enable: vi.fn(), disable: vi.fn()},
        doubleClickZoom: {enable: vi.fn(), disable: vi.fn()}, touchZoom: {enable: vi.fn(), disable: vi.fn()},
        boxZoom: {enable: vi.fn(), disable: vi.fn()},
        getContainer: vi.fn(() => document.createElement('div')),
        getCenter: vi.fn(() => ({lat: 40.2, lng: 24.3})), getZoom: vi.fn(() => 8),
    };
    return {map, listeners};
});

vi.mock('react-leaflet', () => ({
    useMap: () => map,
    MapContainer: ({children, ref, zoomSnap, zoomDelta, zoomControl, keyboard}) => {
        React.useImperativeHandle(ref, () => map);
        return <div data-testid="map" data-snap={zoomSnap} data-delta={zoomDelta}
            data-zoom-control={String(zoomControl)} data-keyboard={String(keyboard)}>{children}</div>;
    },
    CircleMarker: ({center, children}) => <div data-testid="position" data-center={JSON.stringify(center)}>{children}</div>,
    Marker: ({position, children}) => <div data-testid="home" data-center={JSON.stringify(position)}>{children}</div>,
    Polyline: ({positions}) => <div data-testid="track" data-positions={JSON.stringify(positions)} />,
    Popup: ({children}) => <div>{children}</div>, Tooltip: ({children}) => <span>{children}</span>, TileLayer: () => null,
}));
vi.mock('../../common/tile-layers.jsx', () => ({getTileLayerById: () => ({url: 'tiles', attribution: 'OSM'})}));
vi.mock('../../common/dataurl-icons.jsx', () => ({homeIcon: {}}));
vi.mock('../../common/common.jsx', () => ({
    TitleBar: ({children}) => <div>{children}</div>,
    MapStatusBar: ({children}) => <div>{children}</div>,
    islandTitleBarCompactSx: {},
    getClassNamesBasedOnGridEditing: () => '',
    MapArrowControls: ({mapObject}) => <button onClick={() => mapObject.panBy([100, 0])}>Pan right</button>,
}));
vi.mock('../../../hooks/useUserTimeSettings.jsx', () => ({useUserTimeSettings: () => ({timezone: 'UTC', locale: 'en'})}));

beforeEach(() => {
    localStorage.clear();
    listeners.clear();
    vi.clearAllMocks();
    // Leaflet emits these events for programmatic fits too.
    map.fitBounds.mockImplementation(() => {
        listeners.get('zoomstart')?.();
        listeners.get('moveend')?.();
    });
});

afterEach(() => vi.restoreAllMocks());

describe('Packet map viewport', () => {
    it('waits for results, fits all, and preserves manual navigation through new results and remounts', () => {
        const {rerender, unmount} = render(<MapViewport ready={false} bounds={[[40, 23]]} fitRequest={0} />);
        expect(map.fitBounds).not.toHaveBeenCalled();
        rerender(<MapViewport ready bounds={[[40, 23], [41, 24]]} fitRequest={0} />);
        expect(map.fitBounds).toHaveBeenLastCalledWith([[40, 23], [41, 24]], expect.any(Object));
        expect(localStorage.getItem(mapViewStoreName)).toBeNull();
        // Loading another interval may auto-fit until the user navigates.
        rerender(<MapViewport ready bounds={[[42, 25]]} fitRequest={0} />);
        expect(map.fitBounds).toHaveBeenCalledTimes(2);
        act(() => { listeners.get('movestart')(); listeners.get('moveend')(); });
        const view = {center: [40.2, 24.3], zoom: 8};
        expect(JSON.parse(localStorage.getItem(mapViewStoreName))).toEqual(view);
        rerender(<MapViewport ready bounds={[[50, 30]]} fitRequest={0} />);
        expect(map.fitBounds).toHaveBeenCalledTimes(2);
        unmount();
        render(<MapViewport ready bounds={[[50, 30]]} fitRequest={0} />);
        expect(map.setView).toHaveBeenLastCalledWith(view.center, view.zoom, {animate: false});
        expect(map.fitBounds).toHaveBeenCalledTimes(2);
    });

    it('persists zoom changes and lets Fit all explicitly clear a saved viewport', () => {
        const {rerender} = render(<MapViewport ready bounds={[[40, 23]]} fitRequest={0} />);
        act(() => { listeners.get('zoomstart')(); listeners.get('zoomend')(); });
        expect(JSON.parse(localStorage.getItem(mapViewStoreName)).zoom).toBe(8);
        rerender(<MapViewport ready bounds={[[42, 25]]} fitRequest={1} />);
        expect(map.fitBounds).toHaveBeenLastCalledWith([[42, 25]], expect.any(Object));
        expect(JSON.parse(localStorage.getItem(mapViewStoreName))).toBeNull();
    });

    it('persists button-driven panning and removes map listeners on unmount', () => {
        const {rerender, unmount} = render(<MapViewport ready bounds={[[40, 23]]} fitRequest={0} />);
        // Arrow controls emit move events without Leaflet drag events.
        act(() => { listeners.get('movestart')(); listeners.get('moveend')(); });
        expect(JSON.parse(localStorage.getItem(mapViewStoreName))).toEqual({center: [40.2, 24.3], zoom: 8});
        rerender(<MapViewport ready bounds={[[42, 25]]} fitRequest={0} />);
        expect(map.fitBounds).toHaveBeenCalledOnce();
        unmount();
        expect(listeners.size).toBe(0);
    });

    it('refits on resize until manual navigation, then preserves the selected center', () => {
        let resize;
        vi.spyOn(globalThis, 'ResizeObserver').mockImplementation(function (callback) {
            resize = callback;
            this.observe = vi.fn();
            this.disconnect = vi.fn();
        });
        const bounds = [[40, 23], [41, 24]];
        const {unmount} = render(<MapViewport ready bounds={bounds} fitRequest={0} />);
        act(() => resize());
        expect(map.fitBounds).toHaveBeenCalledTimes(2);
        expect(map.fitBounds).toHaveBeenLastCalledWith(bounds, expect.any(Object));
        act(() => { listeners.get('movestart')(); listeners.get('moveend')(); });
        const saved = localStorage.getItem(mapViewStoreName);
        act(() => resize());
        expect(map.fitBounds).toHaveBeenCalledTimes(2);
        expect(map.setView).toHaveBeenLastCalledWith({lat: 40.2, lng: 24.3}, 8, {animate: false});
        expect(localStorage.getItem(mapViewStoreName)).toBe(saved);
        unmount();
    });

    it('ignores corrupt saved map views', () => {
        localStorage.setItem(mapViewStoreName, '{broken');
        render(<MapViewport ready bounds={[[40, 23]]} fitRequest={0} />);
        expect(map.fitBounds).toHaveBeenCalledOnce();
    });
});

it('renders home and separate transmitter tracks with packet details', () => {
    const state = {location: {location: {lat: '40.6', lon: '22.9'}}};
    const store = configureStore({reducer: () => state});
    const points = [
        {id: '1', file_id: 'decoded:first.bin', transmitter_id: 'aprs:A', kind: 'aprs', name: 'A', latitude: 40, longitude: 23, altitude: null, captured_at: '2026-11-01T00:00:00Z'},
        {id: '2', file_id: 'decoded:second.bin', transmitter_id: 'aprs:A', kind: 'aprs', name: 'A', latitude: 41, longitude: 24, altitude: 100, captured_at: '2026-11-01T01:00:00Z'},
        {id: '3', file_id: 'decoded:sonde.bin', transmitter_id: 'radiosonde:S', kind: 'radiosonde', name: 'S', latitude: 42, longitude: 25, altitude: 10000, captured_at: '2026-11-01T02:00:00Z'},
    ];
    render(<Provider store={store}><ThemeProvider theme={createTheme()}>
        <PacketMap positions={points} loading={false} fitRequest={0} />
    </ThemeProvider></Provider>);
    expect(screen.getByTestId('home')).toHaveAttribute('data-center', '[40.6,22.9]');
    expect(screen.getAllByTestId('position')).toHaveLength(3);
    expect(screen.getByTestId('track')).toHaveAttribute('data-positions', '[[40,23],[41,24]]');
    expect(screen.getByText('File: sonde.bin')).toBeInTheDocument();
    expect(screen.getByText('2 transmitters')).toBeInTheDocument();
    expect(map.fitBounds).toHaveBeenLastCalledWith([[40, 23], [41, 24], [42, 25], [40.6, 22.9]], expect.any(Object));
    fireEvent.click(screen.getByRole('button', {name: 'Show transmitter tracks'}));
    expect(screen.queryByTestId('track')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('position')).toHaveLength(3);
});

it('matches Earth view gestures, updates live handlers without resetting the view, and remembers toggles', () => {
    const store = configureStore({reducer: () => ({location: {location: {lat: 40.6, lon: 22.9}}})});
    const element = <Provider store={store}><ThemeProvider theme={createTheme()}>
        <PacketMap positions={[]} loading={false} fitRequest={0} />
    </ThemeProvider></Provider>;
    const {unmount} = render(element);
    expect(screen.getByTestId('map')).toHaveAttribute('data-snap', '0.25');
    expect(screen.getByTestId('map')).toHaveAttribute('data-delta', '0.25');
    expect(screen.getByTestId('map')).toHaveAttribute('data-zoom-control', 'false');
    expect(screen.getByTestId('map')).toHaveAttribute('data-keyboard', 'false');
    expect(map.dragging.disable).toHaveBeenCalled();
    expect(map.touchZoom.disable).toHaveBeenCalled();
    map.fitBounds.mockClear();
    expect(screen.getByRole('button', {name: 'Enable gesture zoom'})).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(screen.getByRole('button', {name: 'Pan right'}));
    expect(map.panBy).toHaveBeenCalledWith([100, 0]);
    fireEvent.click(screen.getByRole('button', {name: 'Enable map panning'}));
    fireEvent.click(screen.getByRole('button', {name: 'Enable gesture zoom'}));
    expect(map.dragging.enable).toHaveBeenCalled();
    for (const handler of [map.scrollWheelZoom, map.doubleClickZoom, map.touchZoom, map.boxZoom]) {
        expect(handler.enable).toHaveBeenCalled();
    }
    expect(screen.queryByRole('button', {name: 'Pan right'})).not.toBeInTheDocument();
    expect(map.setView).not.toHaveBeenCalled();
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(mapSettingsStoreName))).toMatchObject({enableMapDragging: true, enableMapZooming: true});
    fireEvent.click(screen.getByRole('button', {name: 'Zoom in', exact: true}));
    fireEvent.click(screen.getByRole('button', {name: 'Zoom out', exact: true}));
    expect(map.zoomIn).toHaveBeenCalledWith(0.25);
    expect(map.zoomOut).toHaveBeenCalledWith(0.25);
    fireEvent.click(screen.getByRole('button', {name: 'Go home'}));
    expect(map.setView).toHaveBeenLastCalledWith([40.6, 22.9], 8);
    fireEvent.click(screen.getByRole('button', {name: 'Go to center of map'}));
    expect(map.setView).toHaveBeenLastCalledWith([0, 0], 8);
    unmount();
    render(element);
    expect(screen.getByRole('button', {name: 'Enable map panning'})).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', {name: 'Enable gesture zoom'})).toHaveAttribute('aria-pressed', 'true');
    map.touchZoom.disable.mockClear();
    map.scrollWheelZoom.disable.mockClear();
    fireEvent.click(screen.getByRole('button', {name: 'Enable gesture zoom'}));
    expect(map.touchZoom.disable).toHaveBeenCalledOnce();
    expect(map.scrollWheelZoom.disable).toHaveBeenCalledOnce();
});
