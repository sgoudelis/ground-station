import React from 'react';
import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {Provider} from 'react-redux';
import {configureStore} from '@reduxjs/toolkit';
import {createTheme, ThemeProvider} from '@mui/material/styles';
import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import PacketMap, {MapViewport} from '../packet-map.jsx';
import TransmitterList from '../transmitter-list.jsx';
import packetMapReducer, {setTransmitterListColumnVisibility} from '../packet-map-slice.jsx';
import {mapSettingsStoreName, mapViewStoreName} from '../storage.js';

await i18n.use(initReactI18next).init({lng: 'en', resources: {
    en: {earthview: {map_settings: {title: 'Map Settings'}}},
}, interpolation: {escapeValue: false}});

const {map, listeners, markerRenders} = vi.hoisted(() => {
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
    return {map, listeners, markerRenders: vi.fn()};
});

vi.mock('react-leaflet', () => ({
    useMap: () => map,
    MapContainer: ({children, ref, zoomSnap, zoomDelta, zoomControl, keyboard}) => {
        React.useImperativeHandle(ref, () => map);
        return <div data-testid="map" data-snap={zoomSnap} data-delta={zoomDelta}
            data-zoom-control={String(zoomControl)} data-keyboard={String(keyboard)}>{children}</div>;
    },
    CircleMarker: ({center, children, eventHandlers, pathOptions}) => <div data-testid="position" onClick={eventHandlers?.click}
        data-center={JSON.stringify(center)} data-color={pathOptions?.color}>{children}</div>,
    Circle: ({center, radius, interactive, pathOptions, ref}) => {
        const pathRef = React.useRef(null);
        React.useImperativeHandle(ref, () => ({getElement: () => pathRef.current}));
        return <div data-testid="visibility-circle"
            data-center={JSON.stringify(center)} data-radius={radius} data-interactive={String(interactive)}
            data-color={pathOptions.color} data-dash={pathOptions.dashArray} data-fill={String(pathOptions.fill)}>
            <svg><path ref={pathRef} /></svg>
        </div>;
    },
    Pane: ({children, style}) => <div data-testid="visibility-pane" style={style}>{children}</div>,
    Marker: ({position, children, icon, eventHandlers, title, interactive, keyboard}) => {
        markerRenders({position, icon, title, interactive, keyboard});
        return <div title={title} onClick={eventHandlers?.click}
        data-testid={icon?.options?.className?.includes('packet-radiosonde-marker') ? 'sonde-marker'
            : icon?.options?.className?.includes('packet-aprs-marker') ? 'aprs-marker'
                : icon?.options?.className?.includes('packet-aircraft-marker') ? 'aircraft-marker'
                    : icon?.options?.className === 'packet-node-selection-marker' ? 'node-selection' : 'home'}
        data-center={JSON.stringify(position)} data-icon-class={icon?.options?.className}
        data-icon-html={icon?.options?.html}>{children}</div>;
    },
    Polyline: ({positions, pathOptions}) => <div data-testid="track" data-positions={JSON.stringify(positions)} data-opacity={pathOptions?.opacity} />,
    Popup: ({children}) => <div data-testid="map-popup">{children}</div>,
    Tooltip: ({children, position, permanent, className}) => <span data-testid="map-tooltip" className={className}
        data-position={JSON.stringify(position)} data-permanent={String(Boolean(permanent))}>{children}</span>,
    TileLayer: ({url, zIndex}) => <div data-testid="tile-layer" data-url={url} data-z-index={zIndex} />,
}));
vi.mock('../../common/tile-layers.jsx', () => ({getTileLayerById: () => ({url: 'tiles', attribution: 'OSM'})}));
vi.mock('../meshtastic-map-marker.jsx', () => ({
    default: ({id, latitude, longitude, name, selected, onSelectTransmitter}) => <div data-testid="position"
        data-center={JSON.stringify([latitude, longitude])} data-selected={String(selected)}
        onClick={() => onSelectTransmitter?.(id)}>{name}</div>,
}));
vi.mock('../../common/dataurl-icons.jsx', () => ({homeIcon: {}}));
vi.mock('../../common/common.jsx', () => ({
    TitleBar: ({children}) => <div data-testid="map-title">{children}</div>,
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
        listeners.get('movestart')?.();
        listeners.get('zoomend')?.();
        listeners.get('moveend')?.();
    });
    map.setView.mockImplementation(() => {
        listeners.get('movestart')?.();
        listeners.get('moveend')?.();
    });
});

afterEach(() => vi.restoreAllMocks());

it('plots Meshtastic location packets with a permanent name and no tooltip and selects their transmitter', () => {
    const store = configureStore({reducer: () => ({location: {location: null}})});
    const point = {id: 'mesh-fix', transmitter_id: 'meshtastic:!2008e299', kind: 'meshtastic',
        name: '!2008e299', source: '!2008e299', latitude: 40.6585344, longitude: 22.9376,
        altitude: 32, captured_at: '2026-11-02T21:33:32Z'};
    const onSelectTransmitter = vi.fn();
    render(<Provider store={store}><ThemeProvider theme={createTheme()}>
        <PacketMap positions={[point]} playbackTime={Date.parse(point.captured_at) + 1000}
            loading={false} onSelectTransmitter={onSelectTransmitter} />
    </ThemeProvider></Provider>);
    const marker = screen.getByTestId('position');
    expect(marker).toHaveAttribute('data-center', '[40.6585344,22.9376]');
    expect(marker).toHaveTextContent('!2008e299');
    expect(within(marker).queryByTestId('map-tooltip')).not.toBeInTheDocument();
    fireEvent.click(marker);
    expect(onSelectTransmitter).toHaveBeenCalledWith('meshtastic:!2008e299');
});

it('reuses the aircraft crosshair for the selected Meshtastic node and follows playback without replacing its canvas marker', () => {
    const store = configureStore({reducer: () => ({location: {location: null}})});
    const points = [40, 41].map((latitude, index) => ({id: String(index), transmitter_id: 'meshtastic:A',
        kind: 'meshtastic', name: 'A', latitude, longitude: 23, captured_at: `2026-11-02T12:0${index}:00Z`}));
    const start = Date.parse(points[0].captured_at);
    const element = (selected, time = start) => <Provider store={store}><ThemeProvider theme={createTheme()}>
        <PacketMap positions={points} playbackTime={time} selectedTransmitterId={selected} />
    </ThemeProvider></Provider>;
    const {rerender} = render(element(null));
    const node = screen.getByTestId('position');
    expect(screen.queryByTestId('node-selection')).not.toBeInTheDocument();
    rerender(element('meshtastic:A'));
    const crosshair = screen.getByTestId('node-selection');
    expect(screen.getByTestId('position')).toHaveAttribute('data-selected', 'true');
    expect(crosshair).toHaveAttribute('data-center', '[40,23]');
    expect(crosshair.dataset.iconHtml).toContain('viewBox="0 0 52 52"');
    expect(crosshair.dataset.iconHtml).toContain('<rect x="6" y="6" width="40" height="40"');
    const icon = markerRenders.mock.lastCall[0].icon;
    expect(icon.options.iconAnchor).toEqual([26, 44.25]);
    expect(markerRenders.mock.lastCall[0]).toMatchObject({interactive: false, keyboard: false});
    rerender(element('meshtastic:A', start + 60000));
    expect(screen.getByTestId('node-selection')).toHaveAttribute('data-center', '[41,23]');
    expect(markerRenders.mock.lastCall[0].icon).toBe(icon);
    expect(screen.getByTestId('position')).toBe(node);
    rerender(element(null, start + 60000));
    expect(screen.queryByTestId('node-selection')).not.toBeInTheDocument();
});

it('shows a named aircraft pointing along its track, selects it and marks an old fix stale', () => {
    const store = configureStore({reducer: () => ({location: {location: null}})});
    const received = Date.parse('2026-11-01T18:15:00Z');
    const point = {id: 'plane-fix', transmitter_id: 'adsb:4d2406', kind: 'adsb', name: 'EWG46A', source: '4D2406',
        latitude: 40.84, longitude: 23.12, altitude: 11064, track_deg: 326.06,
        aircraft: {type_code: 'A320'},
        captured_at: new Date(received).toISOString()};
    const positions = [point];
    const onSelectTransmitter = vi.fn();
    const element = (time) => <Provider store={store}><ThemeProvider theme={createTheme()}>
        <PacketMap positions={positions} playbackTime={time} loading={false} fitRequest={0}
            onSelectTransmitter={onSelectTransmitter} />
    </ThemeProvider></Provider>;
    const {rerender} = render(element(received + 1000));
    const plane = screen.getByTestId('aircraft-marker');
    expect(plane.dataset.center).toBe('[40.84,23.12]');
    expect(plane.dataset.iconHtml).toContain('EWG46A');
    expect(plane.dataset.iconHtml).toContain('🇲🇹');
    expect(plane.dataset.iconHtml).toContain('rotate(326.06deg)');
    expect(plane.dataset.iconHtml).toContain('data-aircraft-shape="a320"');
    fireEvent.click(plane);
    expect(onSelectTransmitter).toHaveBeenCalledWith('adsb:4d2406');
    map.fitBounds.mockClear();
    rerender(element(received + 61000));
    expect(screen.getByTestId('aircraft-marker').dataset.iconClass).toContain('packet-marker-stale');
    expect(map.fitBounds).not.toHaveBeenCalled();
});

it('updates only the selected aircraft and reuses icons for position-only telemetry updates', () => {
    const store = configureStore({reducer: () => ({location: {location: null}})});
    const theme = createTheme();
    const received = Date.parse('2026-11-02T12:00:00Z');
    const points = ['A', 'B', 'C'].map((name, index) => ({id: name, transmitter_id: name, name,
        kind: 'adsb', latitude: 40 + index, longitude: 23, track_deg: 90, aircraft: {type_code: 'A320'},
        captured_at: new Date(received).toISOString(),
    }));
    const element = (selected, positions = points, onSelectTransmitter = vi.fn()) => <Provider store={store}>
        <ThemeProvider theme={theme}><PacketMap positions={positions} playbackTime={received + 1000}
            selectedTransmitterId={selected} onSelectTransmitter={onSelectTransmitter} /></ThemeProvider>
    </Provider>;
    const {rerender} = render(element('A'));
    markerRenders.mockClear();
    rerender(element('B'));
    expect(markerRenders.mock.calls.map(([props]) => props.title)).toEqual(['A', 'B']);
    const icon = markerRenders.mock.lastCall[0].icon;

    const moved = points.map((point) => point.name === 'B' ? {...point, latitude: 44, altitude: 5000,
        aircraft: {...point.aircraft},
    } : point);
    markerRenders.mockClear();
    const select = vi.fn();
    rerender(element('B', moved, select));
    expect(markerRenders).toHaveBeenCalledOnce();
    expect(markerRenders.mock.lastCall[0]).toMatchObject({title: 'B', position: [44, 23]});
    expect(markerRenders.mock.lastCall[0].icon).toBe(icon);

    // A cached click handler must still use the latest parent callback.
    const latestSelect = vi.fn();
    markerRenders.mockClear();
    rerender(element('B', moved, latestSelect));
    expect(markerRenders).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTitle('B'));
    expect(latestSelect).toHaveBeenCalledWith('B');
    expect(select).not.toHaveBeenCalled();
});

it('uses each saved or live fix silhouette during playback and falls back for older map results', () => {
    const store = configureStore({reducer: () => ({location: {location: null}})});
    const received = Date.parse('2026-11-01T18:15:00Z');
    const base = {transmitter_id: 'adsb:4d2406', kind: 'adsb', name: 'TEST', source: '4D2406',
        latitude: 40.84, longitude: 23.12, altitude: 11064};
    const positions = [
        {...base, id: 'old', captured_at: new Date(received).toISOString(), aircraft: {type_code: 'A320'}},
        {...base, id: 'live', captured_at: new Date(received + 10000).toISOString(), aircraft: {type_code: 'H60'}},
    ];
    const transmitters = [{id: base.transmitter_id, details: {telemetry: {aircraft: {type_code: 'F35'}}}}];
    const element = (time, fixes = positions) => <Provider store={store}><ThemeProvider theme={createTheme()}>
        <PacketMap positions={fixes} transmitters={transmitters} playbackTime={time} loading={false} />
    </ThemeProvider></Provider>;
    const {rerender} = render(element(received + 5000));
    expect(screen.getByTestId('aircraft-marker').dataset.iconHtml).toContain('data-aircraft-shape="a320"');
    rerender(element(received + 11000));
    expect(screen.getByTestId('aircraft-marker').dataset.iconHtml).toContain('data-aircraft-shape="blackhawk"');
    rerender(element(received + 5000, [{...positions[0], aircraft: undefined}]));
    expect(screen.getByTestId('aircraft-marker').dataset.iconHtml).toContain('data-aircraft-shape="f35"');
});

it('replays reported emergencies and clears without borrowing the latest aircraft status', () => {
    const store = configureStore({reducer: () => ({location: {location: null}})});
    const received = Date.parse('2026-11-01T18:15:00Z');
    const base = {transmitter_id: 'adsb:4d2406', kind: 'adsb', name: 'TEST', source: '4D2406',
        latitude: 40.84, longitude: 23.12, altitude: 11064};
    const positions = [
        {squawk: null, emergency: null}, {squawk: '7700', emergency: 'general'},
        {squawk: '7600', emergency: 'nordo'}, {squawk: null, emergency: 'none'},
    ].map((status, index) => ({...base, ...status, id: String(index),
        captured_at: new Date(received + index * 10000).toISOString()}));
    const transmitters = [{id: base.transmitter_id, details: {telemetry: {squawk: '7700', emergency: 'general'}}}];
    const element = (time, fixes = positions) => <Provider store={store}><ThemeProvider theme={createTheme()}>
        <PacketMap positions={fixes} transmitters={transmitters} playbackTime={received + time} loading={false} />
    </ThemeProvider></Provider>;
    const html = () => screen.getByTestId('aircraft-marker').dataset.iconHtml;
    const {rerender} = render(element(5000));
    expect(html()).toContain('fill="#66bb6a"');
    rerender(element(15000));
    expect(html()).toContain('fill="#ef5350"');
    expect(html()).toContain('7700');
    rerender(element(25000));
    expect(html()).toContain('fill="#ffb300"');
    rerender(element(31000));
    expect(html()).toContain('fill="#66bb6a"');
    expect(html()).not.toContain('7700');
    const older = positions.slice(0, 2).map(({squawk, emergency, ...point}) => point);
    rerender(element(5000, older));
    expect(html()).toContain('fill="#66bb6a"');
    rerender(element(11000, older));
    expect(html()).toContain('fill="#ef5350"');
});

it.each([
    ['radiosonde', null, 'sonde-marker'],
    ['aprs', '>', 'aprs-marker'],
    ['aprs', 'O', 'sonde-marker'],
    ['aprs', null, 'position'],
])('greys an inactive %s node (%s), restores fresh fixes, and stays selectable', (kind, symbol, testId) => {
    const store = configureStore({reducer: () => ({location: {location: null}})});
    const capturedAt = Date.parse('2020-01-01T00:00:00Z');
    const points = [{id: 'fix', transmitter_id: 'node', kind, name: 'NODE', latitude: 40, longitude: 23,
        altitude: 10000, captured_at: new Date(capturedAt).toISOString(), symbol_table: symbol ? '/' : null, symbol_code: symbol}];
    const onSelectTransmitter = vi.fn();
    const element = (time, positions = points) => <Provider store={store}><ThemeProvider theme={createTheme()}>
        <PacketMap positions={positions} playbackTime={time} loading={false} fitRequest={0}
            onSelectTransmitter={onSelectTransmitter} />
    </ThemeProvider></Provider>;
    const isGrey = () => testId === 'position'
        ? screen.getByTestId(testId).dataset.color === '#9e9e9e'
        : screen.getByTestId(testId).dataset.iconClass.includes('packet-marker-stale');
    const {rerender} = render(element(capturedAt + 3600000));
    expect(isGrey()).toBe(false);
    map.fitBounds.mockClear();
    rerender(element(capturedAt + 3600001));
    expect(isGrey()).toBe(true);
    expect(map.fitBounds).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId(testId));
    expect(onSelectTransmitter).toHaveBeenCalledWith('node');
    // Scrubbing back uses historical age rather than today's wall clock.
    rerender(element(capturedAt + 1800000));
    expect(isGrey()).toBe(false);
    rerender(element(capturedAt + 3600001, [{...points[0], captured_at: new Date(capturedAt + 3600001).toISOString()}]));
    expect(isGrey()).toBe(false);
});

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

    it('defers an explicit fit until new range results arrive after manual navigation', () => {
        const {rerender} = render(<MapViewport ready bounds={[[40, 23]]} fitRequest={0} />);
        act(() => { listeners.get('movestart')(); listeners.get('moveend')(); });
        map.fitBounds.mockClear();
        rerender(<MapViewport ready={false} bounds={[[40, 23]]} fitRequest={1} />);
        expect(map.fitBounds).not.toHaveBeenCalled();
        expect(JSON.parse(localStorage.getItem(mapViewStoreName))).toBeNull();
        rerender(<MapViewport ready={false} bounds={[]} fitRequest={1} />);
        expect(map.fitBounds).not.toHaveBeenCalled();
        const newBounds = [[48, 12], [52, 16]];
        rerender(<MapViewport ready bounds={newBounds} fitRequest={1} />);
        expect(map.fitBounds).toHaveBeenCalledExactlyOnceWith(newBounds, expect.any(Object));
    });

    it('preserves an unpanned view through preset loading, new results and resize until Fit all', () => {
        let resize;
        vi.spyOn(globalThis, 'ResizeObserver').mockImplementation(function (callback) {
            resize = callback;
            this.observe = vi.fn();
            this.disconnect = vi.fn();
        });
        const bounds = [[40, 23]];
        const {rerender} = render(<MapViewport ready bounds={bounds} fitRequest={0} preserveViewRequest={0} />);
        expect(map.fitBounds).toHaveBeenCalledOnce();
        map.fitBounds.mockClear();
        map.setView.mockClear();

        rerender(<MapViewport ready={false} bounds={bounds} fitRequest={0} preserveViewRequest={1} />);
        rerender(<MapViewport ready={false} bounds={[]} fitRequest={0} preserveViewRequest={1} />);
        const results = [[48, 12], [52, 16]];
        rerender(<MapViewport ready bounds={results} fitRequest={0} preserveViewRequest={1} />);
        expect(map.fitBounds).not.toHaveBeenCalled();
        expect(map.setView).not.toHaveBeenCalled();
        act(() => resize());
        expect(map.setView).toHaveBeenLastCalledWith({lat: 40.2, lng: 24.3}, 8, {animate: false});
        expect(map.fitBounds).not.toHaveBeenCalled();

        // The same preset and subsequent live updates also leave the camera alone.
        map.setView.mockClear();
        rerender(<MapViewport ready bounds={results} fitRequest={0} preserveViewRequest={2} />);
        rerender(<MapViewport ready bounds={[[50, 30]]} fitRequest={0} preserveViewRequest={2} />);
        expect(map.fitBounds).not.toHaveBeenCalled();
        expect(map.setView).not.toHaveBeenCalled();
        rerender(<MapViewport ready bounds={results} fitRequest={1} preserveViewRequest={2} />);
        expect(map.fitBounds).toHaveBeenCalledExactlyOnceWith(results, expect.any(Object));
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

    it('follows a selected target at the current zoom through updates and resize, then stops on deselection', () => {
        let resize;
        vi.spyOn(globalThis, 'ResizeObserver').mockImplementation(function (callback) {
            resize = callback;
            this.observe = vi.fn();
            this.disconnect = vi.fn();
        });
        const saved = JSON.stringify({center: [10, 10], zoom: 4});
        localStorage.setItem(mapViewStoreName, saved);
        const bounds = [[40, 23], [42, 25]];
        const point = {latitude: 40, longitude: 23};
        const {rerender} = render(<MapViewport ready bounds={bounds} fitRequest={0}
            selectedTransmitterId="A" selectedPoint={point} />);
        expect(map.fitBounds).not.toHaveBeenCalled();
        expect(map.setView).toHaveBeenLastCalledWith([40, 23], 8, {animate: false});
        expect(localStorage.getItem(mapViewStoreName)).toBe(saved);

        // Zooming emits move events too, but keeps the selected target locked.
        act(() => {
            listeners.get('zoomstart')();
            listeners.get('movestart')();
            listeners.get('zoomend')();
            listeners.get('moveend')();
        });
        const manualView = localStorage.getItem(mapViewStoreName);
        map.getZoom.mockReturnValueOnce(11);
        rerender(<MapViewport ready bounds={bounds} fitRequest={0}
            selectedTransmitterId="A" selectedPoint={{latitude: 41, longitude: 24}} />);
        expect(map.setView).toHaveBeenLastCalledWith([41, 24], 11, {animate: false});
        expect(localStorage.getItem(mapViewStoreName)).toBe(manualView);
        act(() => resize());
        expect(map.setView).toHaveBeenLastCalledWith([41, 24], 8, {animate: false});
        expect(map.fitBounds).not.toHaveBeenCalled();

        // Missing target positions must never fall back to fitting all tracks.
        map.setView.mockClear();
        rerender(<MapViewport ready bounds={bounds} fitRequest={0} selectedTransmitterId="B" />);
        expect(map.setView).not.toHaveBeenCalled();
        expect(map.fitBounds).not.toHaveBeenCalled();
        rerender(<MapViewport ready bounds={bounds} fitRequest={0}
            selectedTransmitterId="B" selectedPoint={{latitude: 42, longitude: 25}} />);
        expect(map.setView).toHaveBeenLastCalledWith([42, 25], 8, {animate: false});
        map.setView.mockClear();
        rerender(<MapViewport ready bounds={bounds} fitRequest={0} />);
        expect(map.setView).not.toHaveBeenCalled();
        expect(map.fitBounds).not.toHaveBeenCalled();
        rerender(<MapViewport ready bounds={bounds} fitRequest={1} />);
        expect(map.fitBounds).toHaveBeenCalledExactlyOnceWith(bounds, expect.any(Object));
    });

    it('releases the selected target on manual pan and preserves the new view through updates and resize', () => {
        let resize;
        vi.spyOn(globalThis, 'ResizeObserver').mockImplementation(function (callback) {
            resize = callback;
            this.observe = vi.fn();
            this.disconnect = vi.fn();
        });
        const bounds = [[40, 23], [42, 25]];
        const {rerender} = render(<MapViewport ready bounds={bounds} fitRequest={0}
            selectedTransmitterId="A" selectedPoint={{latitude: 40, longitude: 23}} />);
        expect(map.setView).toHaveBeenLastCalledWith([40, 23], 8, {animate: false});

        // Both dragging and the pan buttons emit movestart without zoomstart.
        act(() => { listeners.get('movestart')(); listeners.get('moveend')(); });
        const manualView = localStorage.getItem(mapViewStoreName);
        map.setView.mockClear();
        rerender(<MapViewport ready bounds={bounds} fitRequest={0}
            selectedTransmitterId="A" selectedPoint={{latitude: 41, longitude: 24}} />);
        expect(map.setView).not.toHaveBeenCalled();
        expect(map.fitBounds).not.toHaveBeenCalled();
        act(() => resize());
        expect(map.setView).toHaveBeenLastCalledWith({lat: 40.2, lng: 24.3}, 8, {animate: false});
        expect(localStorage.getItem(mapViewStoreName)).toBe(manualView);

        // A new selection acquires the lock again, including previously panned targets.
        rerender(<MapViewport ready bounds={bounds} fitRequest={0}
            selectedTransmitterId="B" selectedPoint={{latitude: 42, longitude: 25}} />);
        expect(map.setView).toHaveBeenLastCalledWith([42, 25], 8, {animate: false});
        rerender(<MapViewport ready bounds={bounds} fitRequest={0}
            selectedTransmitterId="A" selectedPoint={{latitude: 41, longitude: 24}} />);
        expect(map.setView).toHaveBeenLastCalledWith([41, 24], 8, {animate: false});
    });
});

it('renders the selected transmitter path without a start marker, legends or popups', () => {
    const state = {location: {location: {lat: '40.6', lon: '22.9'}}};
    const store = configureStore({reducer: () => state});
    const points = [
        {id: '1', file_id: 'decoded:first.bin', transmitter_id: 'aprs:A', kind: 'aprs', name: 'A', latitude: 40, longitude: 23, altitude: null, captured_at: '2026-11-01T00:00:00Z'},
        {id: 'middle', file_id: 'decoded:middle.bin', transmitter_id: 'aprs:A', kind: 'aprs', name: 'A', latitude: 40.4, longitude: 23.6, altitude: null, captured_at: '2026-11-01T00:30:00Z'},
        {id: '2', file_id: 'decoded:second.bin', transmitter_id: 'aprs:A', kind: 'aprs', name: 'A', latitude: 41, longitude: 24, altitude: 100, captured_at: '2026-11-01T01:00:00Z'},
        {id: '3', file_id: 'decoded:sonde.bin', transmitter_id: 'radiosonde:S', kind: 'radiosonde', name: 'S', latitude: 42, longitude: 25, altitude: 10000, captured_at: '2026-11-01T02:00:00Z'},
    ];
    const element = <Provider store={store}><ThemeProvider theme={createTheme()}>
        <PacketMap positions={points} loading={false} fitRequest={0} selectedTransmitterId="aprs:A" />
    </ThemeProvider></Provider>;
    const {unmount} = render(element);
    expect(screen.getByTestId('map').closest('.packet-map')).not.toBeNull();
    expect(screen.getByTestId('track')).toHaveAttribute('data-opacity', '1');
    expect(screen.getByTestId('home')).toHaveAttribute('data-center', '[40.6,22.9]');
    expect(screen.getAllByTestId('position')).toHaveLength(1);
    expect(screen.getAllByTestId('position').map((marker) => JSON.parse(marker.dataset.center)))
        .toEqual([[41, 24]]);
    expect(screen.getByTestId('sonde-marker')).toHaveAttribute('data-center', '[42,25]');
    expect(screen.getByTestId('sonde-marker').dataset.iconHtml).not.toContain('packet-radiosonde-crosshair');
    const path = JSON.parse(screen.getByTestId('track').dataset.positions);
    expect(path.length).toBeGreaterThan(3);
    expect(path[0]).toEqual([40, 23]);
    expect(path.at(-1)).toEqual([41, 24]);
    expect(path).toContainEqual([40.4, 23.6]);
    expect(screen.queryByTestId('map-popup')).not.toBeInTheDocument();
    expect(screen.getByText('2 transmitters')).toBeInTheDocument();
    expect(screen.queryByRole('list', {name: 'Transmitter types'})).not.toBeInTheDocument();
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.setView).toHaveBeenLastCalledWith([41, 24], 8, {animate: false});
    fireEvent.click(screen.getByRole('button', {name: 'Show transmitter tracks'}));
    expect(screen.queryByTestId('track')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('position')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', {name: 'Map Settings'}));
    const dialog = within(screen.getByRole('dialog', {name: 'Map Settings'}));
    fireEvent.click(dialog.getByRole('switch', {name: 'Show transmitter tracks'}));
    expect(dialog.queryByRole('switch', {name: 'Show transmitter legend'})).not.toBeInTheDocument();
    fireEvent.mouseDown(dialog.getByRole('combobox', {name: 'Map layer'}));
    fireEvent.click(screen.getByRole('option', {name: 'Satellite + streets'}));
    // Options stay local to the dialog until Apply, preserving quick controls.
    expect(screen.queryByTestId('track')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('tile-layer')).toHaveLength(1);
    fireEvent.click(dialog.getByRole('button', {name: 'Apply'}));
    expect(screen.getByTestId('track')).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(mapSettingsStoreName))).toMatchObject({showTracks: true, tileLayerId: 'hybrid'});
    expect(screen.getAllByTestId('tile-layer').map((tile) => [tile.dataset.url, tile.dataset.zIndex])).toEqual([
        ['tiles', '0'],
        ['https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}', '1'],
        ['https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', '2'],
    ]);
    fireEvent.click(dialog.getByRole('switch', {name: 'Show transmitter tracks'}));
    fireEvent.click(dialog.getByRole('button', {name: 'Close'}));
    expect(screen.getByTestId('track')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'Map Settings'}));
    expect(within(screen.getByRole('dialog')).getByRole('switch', {name: 'Show transmitter tracks'})).toBeChecked();
    unmount();
    render(element);
    expect(screen.getAllByTestId('tile-layer')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', {name: 'Map Settings'}));
    const restoredDialog = within(screen.getByRole('dialog'));
    expect(restoredDialog.getByRole('combobox', {name: 'Map layer'})).toHaveTextContent('Satellite + streets');
    fireEvent.mouseDown(restoredDialog.getByRole('combobox', {name: 'Map layer'}));
    fireEvent.click(screen.getByRole('option', {name: 'Satellite', exact: true}));
    map.fitBounds.mockClear();
    map.setView.mockClear();
    fireEvent.click(restoredDialog.getByRole('button', {name: 'Apply'}));
    expect(screen.getAllByTestId('tile-layer')).toHaveLength(1);
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.setView).not.toHaveBeenCalled();
});

it('edits type visibility in map settings, discards cancelled edits and restores defaults', () => {
    const store = configureStore({reducer: () => ({location: {location: null}})});
    const onHiddenTypesChange = vi.fn();
    render(<Provider store={store}><ThemeProvider theme={createTheme()}>
        <PacketMap positions={[]} transmitters={[{id: 'custom:A', kind: 'custom'}]} loading={false} fitRequest={0}
            hiddenTypes={['aprs']} onHiddenTypesChange={onHiddenTypesChange} />
    </ThemeProvider></Provider>);
    fireEvent.click(screen.getByRole('button', {name: 'Map Settings'}));
    const dialog = () => within(screen.getByRole('dialog', {name: 'Map Settings'}));
    expect(dialog().getByRole('switch', {name: 'APRS'})).not.toBeChecked();
    expect(dialog().getByRole('switch', {name: 'custom'})).toBeChecked();
    fireEvent.click(dialog().getByRole('switch', {name: 'APRS'}));
    fireEvent.click(dialog().getByRole('button', {name: 'Close'}));
    expect(onHiddenTypesChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', {name: 'Map Settings'}));
    expect(dialog().getByRole('switch', {name: 'APRS'})).not.toBeChecked();
    fireEvent.click(dialog().getByRole('switch', {name: 'Radiosonde'}));
    fireEvent.click(dialog().getByRole('button', {name: 'Apply'}));
    expect(onHiddenTypesChange).toHaveBeenLastCalledWith(['aprs', 'radiosonde']);
    fireEvent.click(dialog().getByRole('button', {name: 'Reset Defaults'}));
    expect(dialog().getByRole('switch', {name: 'APRS'})).toBeChecked();
    fireEvent.click(dialog().getByRole('button', {name: 'Apply'}));
    expect(onHiddenTypesChange).toHaveBeenLastCalledWith([]);
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

it('scrubs sonde symbols and historical flight phases while following the marker and keeping its full path', () => {
    const store = configureStore({reducer: () => ({location: {location: null}})});
    const points = [
        {id: 'first', file_id: 'decoded:first.bin', transmitter_id: 'radiosonde:S', kind: 'radiosonde', name: 'S',
            latitude: 40, longitude: 23, altitude: 0, captured_at: '2026-11-01T00:00:00Z'},
        {id: 'apex', file_id: 'decoded:apex.bin', transmitter_id: 'radiosonde:S', kind: 'radiosonde', name: 'S',
            latitude: 41, longitude: 24, altitude: 10000, captured_at: '2026-11-01T00:01:00Z'},
        {id: 'last', file_id: 'decoded:last.bin', transmitter_id: 'radiosonde:S', kind: 'radiosonde', name: 'S',
            latitude: 40, longitude: 25, altitude: 0, captured_at: '2026-11-01T00:02:00Z'},
    ];
    const transmitters = [{id: 'radiosonde:S', details: {telemetry: {vel_v: -10}}}];
    const element = (time) => <Provider store={store}><ThemeProvider theme={createTheme()}>
        <PacketMap positions={points} transmitters={transmitters} playbackTime={Date.parse(time)} loading={false} fitRequest={0}
            selectedTransmitterId="radiosonde:S" />
    </ThemeProvider></Provider>;
    const {rerender} = render(element('2026-11-01T00:00:30Z'));
    const track = screen.getByTestId('track').dataset.positions;
    const ascendingPosition = screen.getByTestId('sonde-marker').dataset.center;
    const initialRadius = Number(screen.getAllByTestId('visibility-circle')[0].dataset.radius);
    expect(screen.getAllByTestId('visibility-circle').map((circle) => circle.dataset.center)).toEqual([ascendingPosition, ascendingPosition]);
    expect(screen.getByTestId('sonde-marker').dataset.iconHtml).toContain('data-flight-phase="ascending"');
    expect(screen.getByTestId('sonde-marker').dataset.iconHtml).toContain('packet-radiosonde-crosshair');
    expect(screen.getByTestId('sonde-marker')).not.toHaveAttribute('title');
    expect(within(screen.getByTestId('sonde-marker')).queryByTestId('map-tooltip')).not.toBeInTheDocument();
    expect(screen.getByTestId('sonde-marker')).toBeEmptyDOMElement();
    expect(screen.getByTestId('sonde-marker').dataset.iconHtml).toContain('<span class="packet-radiosonde-label">S</span>');
    expect(screen.queryByTestId('position')).not.toBeInTheDocument();
    map.fitBounds.mockClear();
    map.setView.mockClear();
    rerender(element('2026-11-01T00:01:30Z'));
    expect(screen.getByTestId('sonde-marker').dataset.iconHtml).toContain('data-flight-phase="descending"');
    expect(screen.getByTestId('sonde-marker').dataset.iconHtml).toContain('packet-radiosonde-crosshair');
    expect(screen.getByTestId('sonde-marker').dataset.center).not.toBe(ascendingPosition);
    expect(screen.getByTestId('track')).toHaveAttribute('data-positions', track);
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.setView).toHaveBeenLastCalledWith(JSON.parse(screen.getByTestId('sonde-marker').dataset.center), 8, {animate: false});
    rerender(element('2026-11-01T00:01:45Z'));
    expect(Number(screen.getAllByTestId('visibility-circle')[0].dataset.radius)).toBeLessThan(initialRadius);
    expect(screen.getAllByTestId('visibility-circle').map((circle) => circle.dataset.center))
        .toEqual(Array(2).fill(screen.getByTestId('sonde-marker').dataset.center));
    expect(map.fitBounds).not.toHaveBeenCalled();
    rerender(element('2026-10-31T23:59:59Z'));
    expect(screen.queryByTestId('sonde-marker')).not.toBeInTheDocument();
    expect(screen.queryByTestId('position')).not.toBeInTheDocument();
    expect(screen.queryByTestId('visibility-circle')).not.toBeInTheDocument();
    expect(screen.getByTestId('track')).toHaveAttribute('data-positions', track);
    rerender(element('2026-11-01T00:03:00Z'));
    expect(screen.getByTestId('sonde-marker')).toHaveAttribute('data-center', '[40,25]');
    expect(screen.queryByTestId('visibility-circle')).not.toBeInTheDocument();
});

it('uses each APRS fix symbol during playback and selects transmitters without popups', () => {
    const store = configureStore({reducer: () => ({location: {location: null}})});
    const onSelectTransmitter = vi.fn();
    const points = ['>', '[', null].map((symbol_code, index) => ({
        id: String(index), file_id: `decoded:${index}.bin`, transmitter_id: 'aprs:A', kind: 'aprs', name: 'A',
        latitude: 40 + index, longitude: 23 + index, altitude: null,
        captured_at: `2026-11-01T00:0${index}:00Z`, symbol_table: symbol_code ? '/' : null, symbol_code,
    }));
    // Latest transmitter details must not override an older fix or a missing symbol.
    const transmitters = [{id: 'aprs:A', details: {telemetry: {position: {symbol_table: '/', symbol_code: '-'}}}}];
    const element = (time) => <Provider store={store}><ThemeProvider theme={createTheme()}>
        <PacketMap positions={points} transmitters={transmitters} playbackTime={Date.parse(time)}
            onSelectTransmitter={onSelectTransmitter} loading={false} fitRequest={0} selectedTransmitterId="aprs:A" />
    </ThemeProvider></Provider>;
    const {rerender} = render(element('2026-11-01T00:00:30Z'));
    const marker = screen.getByTestId('aprs-marker');
    expect(marker.dataset.iconHtml).toContain('aria-label="Car"');
    expect(marker.dataset.iconHtml).toContain('/aprs/mobile.png');
    expect(marker).toHaveAttribute('data-icon-class', 'packet-aprs-marker packet-aprs-selected');
    expect(screen.getByTestId('node-selection')).toHaveAttribute('data-center', marker.dataset.center);
    expect(markerRenders.mock.lastCall[0].icon.options.iconAnchor).toEqual([26, 45.2375]);
    expect(screen.getByTestId('node-selection').dataset.iconHtml).toContain('viewBox="0 0 52 52"');
    expect(marker).toBeEmptyDOMElement();
    fireEvent.click(marker);
    expect(onSelectTransmitter).toHaveBeenCalledWith('aprs:A');
    expect(screen.queryByTestId('map-popup')).not.toBeInTheDocument();
    const track = screen.getByTestId('track').dataset.positions;
    map.fitBounds.mockClear();
    rerender(element('2026-11-01T00:01:00Z'));
    expect(screen.getByTestId('aprs-marker').dataset.iconHtml).toContain('aria-label="Person"');
    expect(screen.getByTestId('aprs-marker').dataset.iconHtml).toContain('/aprs/portable.png');
    expect(screen.getByTestId('aprs-marker')).toHaveAttribute('data-center', '[41,24]');
    expect(screen.getByTestId('track').dataset.positions).toBe(track);
    expect(map.fitBounds).not.toHaveBeenCalled();
    rerender(element('2026-11-01T00:02:00Z'));
    expect(screen.queryByTestId('aprs-marker')).not.toBeInTheDocument();
    expect(screen.getAllByTestId('position').some((marker) => marker.dataset.center === '[42,25]')).toBe(true);
    expect(screen.getByTestId('node-selection')).toHaveAttribute('data-center', '[42,25]');
    expect(markerRenders.mock.lastCall[0].icon.options.iconAnchor).toEqual([26, 26]);
});

it('uses APRS symbols from transmitter details on older servers', () => {
    const store = configureStore({reducer: () => ({location: {location: null}})});
    const point = {id: '1', file_id: 'decoded:1.bin', transmitter_id: 'aprs:A', kind: 'aprs', name: 'A',
        latitude: 40, longitude: 23, altitude: null, captured_at: '2026-11-01T00:00:00Z'};
    const transmitters = [{id: 'aprs:A', details: {telemetry: {position: {symbol_table: '/', symbol_code: '-'}}}}];
    render(<Provider store={store}><ThemeProvider theme={createTheme()}>
        <PacketMap positions={[point]} transmitters={transmitters} loading={false} fitRequest={0} />
    </ThemeProvider></Provider>);
    expect(screen.getByTestId('aprs-marker').dataset.iconHtml).toContain('aria-label="House"');
});

it('uses the object pin for APRS objects without a recognized symbol and keeps selection popup-free', () => {
    const store = configureStore({reducer: () => ({location: {location: null}})});
    const onSelectTransmitter = vi.fn();
    const point = {id: '1', transmitter_id: 'aprs:EVENT', kind: 'aprs', name: 'EVENT',
        latitude: 40, longitude: 23, altitude: null, captured_at: '2026-11-01T00:00:00Z',
        symbol_table: '/', symbol_code: 'z'};
    const transmitters = [{id: point.transmitter_id, details: {telemetry: {object: {name: 'EVENT'}}}}];
    render(<Provider store={store}><ThemeProvider theme={createTheme()}>
        <PacketMap positions={[point]} transmitters={transmitters} loading={false} fitRequest={0}
            onSelectTransmitter={onSelectTransmitter} />
    </ThemeProvider></Provider>);
    const marker = screen.getByTestId('aprs-marker');
    expect(marker.dataset.iconHtml).toContain('/aprs/object.png');
    fireEvent.click(marker);
    expect(onSelectTransmitter).toHaveBeenCalledWith(point.transmitter_id);
    expect(screen.queryByTestId('map-popup')).not.toBeInTheDocument();
    expect(map.fitBounds).toHaveBeenLastCalledWith([[40, 23]], expect.objectContaining({paddingTopLeft: [42, 72]}));
});

it('reuses the weather balloon and parachute for APRS balloons and follows their displayed position', () => {
    const store = configureStore({reducer: () => ({location: {location: null}})});
    const points = [100, 10000, 100].map((altitude, index) => ({
        id: String(index), file_id: `decoded:${index}.bin`, transmitter_id: 'aprs:B', kind: 'aprs', name: 'B',
        latitude: 40 + index, longitude: 23, altitude,
        captured_at: `2026-11-01T00:0${index}:00Z`, symbol_table: '/', symbol_code: 'O',
    }));
    const element = (time) => <Provider store={store}><ThemeProvider theme={createTheme()}>
        <PacketMap positions={points} playbackTime={Date.parse(time)} loading={false} fitRequest={0}
            selectedTransmitterId="aprs:B" />
    </ThemeProvider></Provider>;
    const {rerender} = render(element('2026-11-01T00:00:30Z'));
    expect(screen.getByTestId('sonde-marker').dataset.iconHtml).toContain('data-flight-phase="ascending"');
    expect(screen.getByTestId('sonde-marker').dataset.iconHtml).toContain('balloon.png');
    expect(screen.getByTestId('sonde-marker').dataset.iconHtml).toContain('packet-radiosonde-crosshair');
    expect(screen.queryByTestId('node-selection')).not.toBeInTheDocument();
    expect(screen.getByTestId('sonde-marker')).toBeEmptyDOMElement();
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.setView).toHaveBeenLastCalledWith(JSON.parse(screen.getByTestId('sonde-marker').dataset.center), 8, {animate: false});
    expect(screen.queryByTestId('visibility-circle')).not.toBeInTheDocument();
    rerender(element('2026-11-01T00:01:30Z'));
    expect(screen.getByTestId('sonde-marker').dataset.iconHtml).toContain('data-flight-phase="descending"');
    expect(screen.getByTestId('sonde-marker').dataset.iconHtml).toContain('parachute.png');
    expect(screen.getByTestId('sonde-marker').dataset.iconHtml).toContain('packet-radiosonde-crosshair');
});

it('selects list rows and centers their markers, then restores all bounds with Fit all', () => {
    localStorage.setItem(mapViewStoreName, JSON.stringify({center: [10, 10], zoom: 4}));
    const store = configureStore({reducer: {
        location: () => ({location: {lat: 0, lon: 0}}), packetMap: packetMapReducer,
    }});
    const points = [
        {id: '1', file_id: 'decoded:first.bin', transmitter_id: 'aprs:A', kind: 'aprs', name: 'A', source: 'SV1A', latitude: 40, longitude: 23, altitude: null, captured_at: '2026-11-01T00:00:00Z'},
        {id: '2', file_id: 'decoded:second.bin', transmitter_id: 'aprs:A', kind: 'aprs', name: 'A', source: 'SV1A', latitude: 41, longitude: 24, altitude: 100, captured_at: '2026-11-01T01:00:00Z'},
        {id: '3', file_id: 'decoded:sonde.bin', transmitter_id: 'radiosonde:S', kind: 'radiosonde', name: 'S', source: 'SONDE', latitude: 42, longitude: 25, altitude: 10000, captured_at: '2026-11-01T02:00:00Z'},
    ];
    const rows = [points[1], points[2]].map((point) => ({...point, id: point.transmitter_id,
        packet_count: point.kind === 'aprs' ? 2 : 1, first_seen: points[0].captured_at, last_seen: point.captured_at}));
    function Harness() {
        const [selectedTransmitterId, setSelectedTransmitterId] = React.useState(null);
        return <>
            <PacketMap positions={points} loading={false} fitRequest={0} selectedTransmitterId={selectedTransmitterId}
                onSelectTransmitter={setSelectedTransmitterId}
                onFitAll={() => setSelectedTransmitterId(null)} />
            <TransmitterList rows={rows} loading={false} hiddenTypes={[]} selectedTransmitterId={selectedTransmitterId}
                onSelectTransmitter={setSelectedTransmitterId} />
        </>;
    }
    render(<Provider store={store}><ThemeProvider theme={createTheme()}><Harness /></ThemeProvider></Provider>);
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(screen.queryByTestId('track')).not.toBeInTheDocument();
    const aprsRow = screen.getByRole('button', {name: 'A', exact: true});
    expect(screen.queryByTestId('visibility-circle')).not.toBeInTheDocument();
    fireEvent.click(aprsRow);
    expect(screen.queryByTestId('visibility-circle')).not.toBeInTheDocument();
    expect(aprsRow).toHaveAttribute('aria-pressed', 'true');
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.setView).toHaveBeenLastCalledWith([41, 24], 8, {animate: false});
    expect(screen.getByTestId('track')).toHaveAttribute('data-positions', '[[40,23],[41,24]]');
    expect(screen.getAllByTestId('position')).toHaveLength(1);

    act(() => { listeners.get('movestart')(); listeners.get('moveend')(); });
    const sondeRow = screen.getByRole('button', {name: 'S', exact: true});
    fireEvent.click(within(sondeRow).getByText('SONDE'));
    expect(sondeRow).toHaveAttribute('aria-pressed', 'true');
    expect(aprsRow).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByTestId('track')).not.toBeInTheDocument();
    expect(map.fitBounds).not.toHaveBeenCalled();
    expect(map.setView).toHaveBeenLastCalledWith([42, 25], 8, {animate: false});
    const circles = screen.getAllByTestId('visibility-circle');
    expect(circles).toHaveLength(2);
    expect(circles.map((circle) => circle.dataset.color)).toEqual(['#2196f3', '#4caf50']);
    for (const circle of circles) {
        expect(circle).toHaveAttribute('data-center', '[42,25]');
        expect(circle).toHaveAttribute('data-dash', '8 6');
        expect(circle).toHaveAttribute('data-fill', 'false');
        expect(circle).toHaveAttribute('data-interactive', 'false');
    }
    expect(Number(circles[0].dataset.radius)).toBeGreaterThan(Number(circles[1].dataset.radius));
    const greenLabel = circles[1].querySelector('textPath');
    expect(greenLabel).toHaveTextContent('104 km · 5° elevation');
    expect(greenLabel).toHaveAttribute('startOffset', '25%');
    expect(greenLabel).toHaveAttribute('href', `#${circles[1].querySelector('path').id}`);
    expect(circles[0].querySelector('textPath')).toHaveTextContent('357 km · Radio horizon (0°)');
    expect(screen.queryByRole('list', {name: 'Radio visibility'})).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', {name: 'Fit all'}));
    expect(screen.queryByTestId('track')).not.toBeInTheDocument();
    expect(screen.queryByTestId('visibility-circle')).not.toBeInTheDocument();
    expect(sondeRow).toHaveAttribute('aria-pressed', 'false');
    expect(map.fitBounds).toHaveBeenLastCalledWith([[40, 23], [41, 24], [42, 25], [0, 0]], expect.any(Object));
    fireEvent.click(screen.getByTestId('sonde-marker'));
    expect(sondeRow).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByTestId('visibility-circle')).toHaveLength(2);
});

it('removes expired aircraft markers and restores them when the historical cursor returns', () => {
    const store = configureStore({reducer: () => ({location: {location: null}})});
    const received = Date.parse('2026-11-01T12:00:00Z');
    const positions = [{id: 'fix', transmitter_id: 'adsb:406b90', kind: 'adsb', source: '406B90',
        latitude: 40, longitude: 23, captured_at: new Date(received).toISOString()}];
    const element = (time) => <Provider store={store}><ThemeProvider theme={createTheme()}>
        <PacketMap positions={positions} playbackTime={time} loading={false} />
    </ThemeProvider></Provider>;
    const {rerender} = render(element(received + 1800000));
    expect(screen.getByTestId('aircraft-marker')).toBeInTheDocument();
    rerender(element(received + 1800001));
    expect(screen.queryByTestId('aircraft-marker')).not.toBeInTheDocument();
    expect(screen.getByText('0 transmitters')).toBeInTheDocument();
    rerender(element(received));
    expect(screen.getByTestId('aircraft-marker')).toBeInTheDocument();
});
