import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {Provider} from 'react-redux';
import {configureStore} from '@reduxjs/toolkit';
import {createTheme, ThemeProvider} from '@mui/material/styles';
import {beforeEach, expect, it, vi} from 'vitest';
import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import PacketMapLayout from '../main-layout.jsx';
import {gridLayoutStoreName, hiddenTypesStoreName} from '../storage.js';
import {defaultLayouts, LAYOUT_SCHEMA_VERSION} from '../layouts.js';
import usePacketPositions from '../use-packet-positions.js';
import packetMapReducer from '../packet-map-slice.jsx';
import useAircraft from '../../decoders/use-aircraft.js';

await i18n.use(initReactI18next).init({lng: 'en', resources: {}});
const {gridRender, mapRender, tableRender, fixture} = vi.hoisted(() => ({
    gridRender: vi.fn(), mapRender: vi.fn(), tableRender: vi.fn(), fixture: {positions: [], transmitters: []},
}));
vi.mock('react-grid-layout', () => ({
    Responsive: (props) => {gridRender(props); return <div>{props.children}</div>;},
    useContainerWidth: () => ({width: 1400, mounted: true, containerRef: {current: null}}),
}));
vi.mock('../../common/socket.jsx', () => ({useSocket: () => ({socket: fixture.socket})}));
vi.mock('../../decoders/use-aircraft.js', () => {
    const empty = {aircraft: [], positions: []};
    return {default: vi.fn(() => empty)};
});
vi.mock('../../common/common.jsx', () => ({
    StyledIslandParentNoScrollbar: ({children}) => <div>{children}</div>,
    TitleBar: ({children}) => <div>{children}</div>, islandTitleBarCompactSx: {},
    getClassNamesBasedOnGridEditing: () => '',
}));
vi.mock('../use-packet-positions.js', async (importOriginal) => ({...await importOriginal(), default: vi.fn()}));
vi.mock('../packet-map.jsx', () => ({default: (props) => {mapRender(props); return null;}}));
vi.mock('../transmitter-table.jsx', () => ({default: (props) => {tableRender(props); return null;}}));

const historyRange = {start: '2026-10-31T12:00:00Z', end: '2026-11-01T12:00:00Z'};
function createStore(range) {
    return configureStore({
        reducer: {
            dashboard: () => ({isEditing: false}),
            preferences: () => ({preferences: []}),
            packetMap: packetMapReducer,
        },
        preloadedState: range ? {packetMap: {range}} : undefined,
    });
}

beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    useAircraft.mockReturnValue({aircraft: [], positions: []});
    fixture.socket = null;
    usePacketPositions.mockImplementation(() => ({...fixture, loading: false}));
    fixture.positions = [
        {id: '1', transmitter_id: 'aprs:A', kind: 'aprs', name: 'A', captured_at: '2026-11-01T00:00:00Z'},
        {id: '2', transmitter_id: 'radiosonde:S', kind: 'radiosonde', name: 'S', captured_at: '2026-11-01T01:00:00Z'},
    ];
    fixture.transmitters = fixture.positions.map((point) => ({...point, id: point.transmitter_id, packet_count: 1}));
});

it('shows live aircraft beside saved radiosondes and updates positions without reloading history', async () => {
    const {default: realUseAircraft} = await vi.importActual('../../decoders/use-aircraft.js');
    const {default: realUsePacketPositions} = await vi.importActual('../use-packet-positions.js');
    useAircraft.mockImplementation(realUseAircraft);
    usePacketPositions.mockImplementation(realUsePacketPositions);
    vi.useFakeTimers();
    try {
        vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
        const received = Date.now() / 1000;
        const record = {icao: '4d2406', callsign: 'EWG46A', timestamp: received,
            position_timestamp: received, latitude: 40.84, longitude: 23.12,
            altitude_baro_m: 11064, track_deg: 326.06};
        const handlers = new Map();
        const socket = {connected: true,
            on: vi.fn((event, handler) => {
                if (!handlers.has(event)) handlers.set(event, new Set());
                handlers.get(event).add(handler);
            }),
            off: vi.fn((event, handler) => handlers.get(event)?.delete(handler)),
            timeout: () => socket,
            emit: vi.fn((_event, request, reply) => {
                if (request.cmd === 'adsb.subscribe') {
                    reply?.({success: true, data: {aircraft: [record]}});
                } else if (request.cmd === 'filebrowser.positions') {
                    reply(null, {success: true, data: {positions: fixture.positions, transmitters: fixture.transmitters}});
                }
            }),
        };
        fixture.socket = socket;
        const store = createStore();
        const {unmount} = render(<Provider store={store}><ThemeProvider theme={createTheme()}><PacketMapLayout /></ThemeProvider></Provider>);
        await act(async () => {});
        act(() => vi.advanceTimersByTime(1000));
        expect(mapRender.mock.lastCall[0].positions).toEqual(expect.arrayContaining([
            expect.objectContaining({transmitter_id: 'radiosonde:S'}),
            expect.objectContaining({transmitter_id: 'adsb:4d2406', name: 'EWG46A', latitude: 40.84}),
        ]));
        act(() => mapRender.mock.lastCall[0].onSelectTransmitter('adsb:4d2406'));
        expect(screen.getByRole('region', {name: 'Transmitter info'})).toHaveTextContent('EWG46A');

        const next = {...record, timestamp: received + 1, position_timestamp: received + 1, latitude: 40.85};
        act(() => {
            handlers.get('adsb.aircraft').forEach((receive) => receive({aircraft: [next]}));
            vi.advanceTimersByTime(1000);
        });
        expect(tableRender.mock.lastCall[0].rows).toEqual(expect.arrayContaining([
            expect.objectContaining({id: 'adsb:4d2406', latitude: 40.85}),
            expect.objectContaining({id: 'radiosonde:S'}),
        ]));
        expect(socket.emit.mock.calls.filter(([, request]) => request.cmd === 'filebrowser.positions')).toHaveLength(1);
        unmount();
    } finally {
        vi.useRealTimers();
    }
});

it('starts in LIVE with the last day of packets when no selection has been saved', () => {
    const store = createStore();
    render(<Provider store={store}><ThemeProvider theme={createTheme()}><PacketMapLayout /></ThemeProvider></Provider>);
    const range = usePacketPositions.mock.lastCall[1];
    expect(range.end).toBeNull();
    expect(Date.parse(range.start)).toBeGreaterThanOrEqual(Date.now() - 86401000);
    expect(Date.parse(range.start)).toBeLessThanOrEqual(Date.now() - 86400000);
    expect(screen.getByRole('button', {name: 'LIVE', exact: true})).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('To')).toBeDisabled();
    expect(Number.isFinite(mapRender.mock.lastCall[0].playbackTime)).toBe(true);
});

it('scrubs the aircraft instruments, position and reported emergency together with the map', () => {
    const first = {id: 'first', transmitter_id: 'adsb:4d2406', kind: 'adsb', name: 'EWG46A',
        source: '4D2406', latitude: 40, longitude: 23, altitude: 10000, altitude_baro_m: 10000,
        groundspeed_mps: 100, vertical_rate_mps: 5, track_deg: 326, squawk: '7000', emergency: 'none',
        captured_at: '2026-11-01T11:58:00Z'};
    const last = {...first, id: 'last', captured_at: '2026-11-01T12:00:00Z', latitude: 41,
        groundspeed_mps: 200, vertical_rate_mps: -5, squawk: '7700', emergency: 'general'};
    fixture.positions = [first, last];
    fixture.transmitters = [{...last, id: last.transmitter_id, details: {telemetry: {...last}}}];
    render(<Provider store={createStore(historyRange)}><ThemeProvider theme={createTheme()}><PacketMapLayout /></ThemeProvider></Provider>);
    act(() => tableRender.mock.lastCall[0].onSelectTransmitter(first.transmitter_id));
    expect(screen.getByRole('alert')).toHaveTextContent('General emergency');
    expect(screen.getByRole('region', {name: 'Ground speed'})).toHaveTextContent('389kt');
    const cursor = Date.parse('2026-11-01T11:58:30Z');
    fireEvent.change(screen.getByRole('slider', {name: 'Playback time'}), {target: {value: cursor}});
    expect(mapRender.mock.lastCall[0].playbackTime).toBe(cursor);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Ground speed'})).toHaveTextContent('194kt');
    expect(screen.getByRole('region', {name: 'Vertical speed'})).toHaveTextContent('+984ft/min');
    expect(within(screen.getByRole('region', {name: 'Flight instruments'})).getByText('7000')).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Playback position'})).toHaveTextContent(/40\.\d+/);
    // Wall-clock age does not make a fresh historical sample look stale.
    expect(screen.getByRole('region', {name: 'Flight instruments'})).not.toHaveTextContent('Stale');
});

it('advances the live clock without incoming packets and stops the timer in history', () => {
    vi.useFakeTimers();
    try {
        vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
        const store = createStore();
        const {unmount} = render(<Provider store={store}><ThemeProvider theme={createTheme()}><PacketMapLayout /></ThemeProvider></Provider>);
        const initialTime = mapRender.mock.lastCall[0].playbackTime;
        act(() => vi.advanceTimersByTime(30000));
        expect(mapRender.mock.lastCall[0].playbackTime).toBe(initialTime + 30000);
        expect(mapRender.mock.lastCall[0].positions).toEqual(fixture.positions);
        // A paused historical cursor must not age along with the wall clock.
        fireEvent.click(screen.getByRole('button', {name: '24h', exact: true}));
        const historicalTime = mapRender.mock.lastCall[0].playbackTime;
        expect(Number.isFinite(historicalTime)).toBe(true);
        const renderCount = mapRender.mock.calls.length;
        act(() => vi.advanceTimersByTime(60000));
        expect(mapRender.mock.lastCall[0].playbackTime).toBe(historicalTime);
        expect(mapRender).toHaveBeenCalledTimes(renderCount);
        unmount();
    } finally {
        vi.useRealTimers();
    }
});

it.each(['LIVE', '12h', '24h', '7d', 'All'])('stores %s in Redux and restores it when revisiting the map', (preset) => {
    usePacketPositions.mockImplementation(() => ({...fixture, available_range: historyRange, loading: false}));
    const store = createStore(historyRange);
    const element = <Provider store={store}><ThemeProvider theme={createTheme()}><PacketMapLayout /></ThemeProvider></Provider>;
    const {unmount} = render(element);
    fireEvent.click(screen.getByRole('button', {name: preset, exact: true}));
    const selectedRange = usePacketPositions.mock.lastCall[1];
    expect(store.getState().packetMap.range).toEqual(selectedRange);
    const from = screen.getByLabelText('From').value;
    const to = screen.getByLabelText('To').value;
    unmount();
    render(element);
    expect(usePacketPositions.mock.lastCall[1]).toEqual(selectedRange);
    expect(screen.getByLabelText('From')).toHaveValue(from);
    expect(screen.getByLabelText('To')).toHaveValue(to);
    expect(screen.getByRole('button', {name: 'LIVE', exact: true})).toHaveAttribute('aria-pressed', String(preset === 'LIVE'));
    expect(screen.getByLabelText('To').disabled).toBe(preset === 'LIVE');
});

it('loads new defaults for the previous schema and saves grid edits with the current version', () => {
    const oldLayouts = defaultLayouts();
    oldLayouts.lg[1] = {...oldLayouts.lg[1], i: 'transmitter-types', h: 12};
    localStorage.setItem(gridLayoutStoreName, JSON.stringify({version: 2, layouts: oldLayouts}));
    const store = createStore();
    render(<Provider store={store}><ThemeProvider theme={createTheme()}><PacketMapLayout /></ThemeProvider></Provider>);
    expect(gridRender.mock.lastCall[0].layouts).toEqual(defaultLayouts());
    const updated = defaultLayouts();
    updated.lg[1].h = 42;
    act(() => gridRender.mock.lastCall[0].onLayoutChange(updated.lg, updated));
    expect(JSON.parse(localStorage.getItem(gridLayoutStoreName))).toEqual({version: LAYOUT_SCHEMA_VERSION, layouts: updated});
    expect(gridRender.mock.lastCall[0].layouts).toEqual(updated);
});

it('queries applied dates once, scrubs locally, and resets playback for a new query window', async () => {
    const {default: realUsePacketPositions} = await vi.importActual('../use-packet-positions.js');
    usePacketPositions.mockImplementation(realUsePacketPositions);
    const requests = [];
    const socket = {connected: true, on: vi.fn(), off: vi.fn(), timeout: () => socket,
        emit: vi.fn((_event, request, reply) => requests.push({request, reply}))};
    fixture.socket = socket;
    const store = createStore(historyRange);
    render(<Provider store={store}><ThemeProvider theme={createTheme()}><PacketMapLayout /></ThemeProvider></Provider>);
    expect(requests).toHaveLength(1);
    const initialRange = requests[0].request.data;
    const positions = fixture.positions;
    await act(async () => requests[0].reply(null, {success: true, data: {positions, available_range: initialRange}}));
    await waitFor(() => expect(mapRender.mock.lastCall[0].positions).toHaveLength(2));
    const slider = screen.getByRole('slider', {name: 'Playback time'});
    expect(slider).toHaveAttribute('min', String(Date.parse(initialRange.start)));
    expect(slider).toHaveAttribute('max', String(Date.parse(initialRange.end)));
    const cursor = Date.parse(initialRange.start) + 3600000;
    fireEvent.change(slider, {target: {value: cursor}});
    expect(mapRender.mock.lastCall[0].playbackTime).toBe(cursor);
    expect(mapRender.mock.lastCall[0].positions).toHaveLength(2);
    expect(requests).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('From'), {target: {value: '10/01/2026, 12:00 AM'}});
    fireEvent.change(screen.getByLabelText('To'), {target: {value: '10/02/2026, 12:00 AM'}});
    expect(requests).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', {name: 'Apply'}));
    expect(requests).toHaveLength(2);
    expect(requests[1].request).toEqual({cmd: 'filebrowser.positions', data: {
        start: '2026-10-01T00:00:00.000Z', end: '2026-10-02T00:00:00.000Z',
    }});
    expect(mapRender.mock.lastCall[0].playbackTime).toBe(Date.parse('2026-10-02T00:00:00Z'));
    expect(mapRender.mock.lastCall[0].positions).toHaveLength(0);
    expect(slider).toHaveAttribute('min', String(Date.parse('2026-10-01T00:00:00Z')));
    expect(slider).toHaveAttribute('max', String(Date.parse('2026-10-02T00:00:00Z')));
});

it.each([['LIVE', 'live'], ['12h', 12], ['24h', 24], ['7d', 168], ['All', null]])('%s clears transmitter selection and preserves the map view through new results', async (button, hours) => {
    const {default: realUsePacketPositions} = await vi.importActual('../use-packet-positions.js');
    usePacketPositions.mockImplementation(realUsePacketPositions);
    const requests = [];
    const socket = {connected: true, on: vi.fn(), off: vi.fn(), timeout: () => socket,
        emit: vi.fn((_event, request, reply) => requests.push({request, reply}))};
    fixture.socket = socket;
    const availableRange = {start: '2026-10-01T00:00:00Z', end: '2026-11-01T12:00:00Z'};
    const store = createStore(historyRange);
    render(<Provider store={store}><ThemeProvider theme={createTheme()}><PacketMapLayout /></ThemeProvider></Provider>);
    const reply = {success: true, data: {positions: fixture.positions, transmitters: fixture.transmitters, available_range: availableRange}};
    await act(async () => requests[0].reply(null, reply));
    act(() => tableRender.mock.lastCall[0].onSelectTransmitter('aprs:A'));
    const previousPreserve = mapRender.mock.lastCall[0].preserveViewRequest;
    fireEvent.click(screen.getByRole('button', {name: button}));
    expect(requests).toHaveLength(2);
    const range = requests[1].request.data;
    if (hours === 'live') expect(range).toEqual({start: historyRange.start, end: null});
    else if (hours === null) expect(range).toEqual(availableRange);
    else expect(Date.parse(range.end) - Date.parse(range.start)).toBe(hours * 3600000);
    expect(mapRender.mock.lastCall[0]).toMatchObject({
        selectedTransmitterId: null, preserveViewRequest: previousPreserve + 1, loading: true, positions: [],
        playbackTime: hours === 'live' ? expect.any(Number) : Date.parse(range.end),
    });
    const positions = [{...fixture.positions[1], id: 'new-range-position'}];
    await act(async () => requests[1].reply(null, {...reply, data: {...reply.data, positions}}));
    expect(mapRender.mock.lastCall[0]).toMatchObject({positions, loading: false, preserveViewRequest: previousPreserve + 1});
    // Repeated presets preserve the camera even with no selection and unchanged dates.
    fireEvent.click(screen.getByRole('button', {name: button}));
    expect(requests).toHaveLength(3);
    expect(mapRender.mock.lastCall[0].preserveViewRequest).toBe(previousPreserve + 2);
    await act(async () => requests[2].reply(null, reply));
});

it.each(['24h', '7d', 'All'])('follows new radiosondes in LIVE and returns to history with %s', async (preset) => {
    const {default: realUsePacketPositions} = await vi.importActual('../use-packet-positions.js');
    usePacketPositions.mockImplementation(realUsePacketPositions);
    vi.useFakeTimers();
    try {
        vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
        const requests = [];
        const handlers = new Map();
        const socket = {connected: true, on: vi.fn((event, handler) => handlers.set(event, handler)), off: vi.fn(), timeout: () => socket,
            emit: vi.fn((_event, request, reply) => requests.push({request, reply}))};
        fixture.socket = socket;
        const store = createStore(historyRange);
        render(<Provider store={store}><ThemeProvider theme={createTheme()}><PacketMapLayout /></ThemeProvider></Provider>);
        const initialRange = requests[0].request.data;
        const snapshot = {positions: fixture.positions, transmitters: fixture.transmitters, available_range: initialRange};
        await act(async () => requests[0].reply(null, {success: true, data: snapshot}));
        fireEvent.click(screen.getByRole('button', {name: 'LIVE', exact: true}));
        expect(requests[1].request.data).toEqual({start: initialRange.start, end: null});
        expect(screen.getByLabelText('To')).toBeDisabled();
        await act(async () => requests[1].reply(null, {success: true, data: snapshot}));
        act(() => tableRender.mock.lastCall[0].onSelectTransmitter('radiosonde:S'));
        const preservedView = mapRender.mock.lastCall[0].preserveViewRequest;

        vi.setSystemTime(new Date('2026-11-01T12:05:00Z'));
        act(() => {handlers.get('library.changed')(); vi.advanceTimersByTime(750);});
        expect(requests[2].request.data).toEqual({start: initialRange.start, end: null});
        expect(mapRender.mock.lastCall[0].positions).toEqual(snapshot.positions);
        expect(screen.getByRole('region', {name: 'Transmitter info'})).toHaveTextContent('radiosonde:S');
        const positions = [...fixture.positions,
            {...fixture.positions[1], id: 'updated', captured_at: '2026-11-01T12:04:00Z'},
            {...fixture.positions[1], id: 'new', transmitter_id: 'radiosonde:NEW', name: 'NEW', captured_at: '2026-11-01T12:05:00Z'},
        ];
        const transmitters = [...fixture.transmitters.slice(0, 1),
            {...fixture.transmitters[1], last_seen: positions[2].captured_at, packet_count: 2},
            {...fixture.transmitters[1], id: 'radiosonde:NEW', name: 'NEW'},
        ];
        await act(async () => requests[2].reply(null, {success: true, data: {...snapshot, positions, transmitters}}));
        expect(mapRender.mock.lastCall[0]).toMatchObject({positions, selectedTransmitterId: 'radiosonde:S', preserveViewRequest: preservedView});
        expect(tableRender.mock.lastCall[0].rows).toHaveLength(3);
        expect(mapRender.mock.lastCall[0].playbackTime).toBeGreaterThanOrEqual(Date.parse(positions[3].captured_at));
        expect(screen.getByRole('slider', {name: 'Live time'})).toHaveValue(String(mapRender.mock.lastCall[0].playbackTime));

        fireEvent.click(screen.getByRole('button', {name: preset}));
        expect(requests[3].request.data.end).not.toBeNull();
        expect(screen.getByLabelText('To')).not.toBeDisabled();
        expect(screen.getByRole('button', {name: 'LIVE', exact: true})).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('slider', {name: 'Playback time'})).not.toBeDisabled();
        await act(async () => requests[3].reply(null, {success: true, data: snapshot}));
    } finally {
        vi.useRealTimers();
    }
});

it('hides entire types on the map, retains every table row and remembers visibility', () => {
    // Keep both packet types inside the default 24-hour query window.
    fixture.positions = fixture.positions.map((point, index) => ({...point,
        captured_at: new Date(Date.now() - (index + 1) * 3600000).toISOString(),
    }));
    const store = createStore();
    const element = <Provider store={store}><ThemeProvider theme={createTheme()}><PacketMapLayout /></ThemeProvider></Provider>;
    const {container, unmount} = render(element);
    const activity = () => [...container.querySelectorAll('.packet-timeline-activity line')]
        .map((line) => [line.getAttribute('x1'), line.getAttribute('x2')]);
    const highlighted = activity();
    expect(highlighted).toHaveLength(2);
    act(() => mapRender.mock.lastCall[0].onHiddenTypesChange(['aprs']));
    expect(mapRender.mock.lastCall[0].positions.map((point) => point.kind)).toEqual(['radiosonde']);
    expect(tableRender.mock.lastCall[0].rows).toHaveLength(2);
    expect(JSON.parse(localStorage.getItem(hiddenTypesStoreName))).toEqual(['aprs']);
    expect(activity()).toEqual(highlighted);
    act(() => mapRender.mock.lastCall[0].onHiddenTypesChange(['aprs', 'radiosonde']));
    expect(mapRender.mock.lastCall[0].positions).toHaveLength(0);
    expect(mapRender.mock.lastCall[0].hasPositions).toBe(true);
    expect(tableRender.mock.lastCall[0].rows).toHaveLength(2);
    expect(activity()).toEqual(highlighted);
    unmount();
    render(element);
    expect(mapRender.mock.lastCall[0].hiddenTypes).toEqual(['aprs', 'radiosonde']);
    act(() => mapRender.mock.lastCall[0].onHiddenTypesChange(['radiosonde']));
    expect(mapRender.mock.lastCall[0].positions.map((point) => point.kind)).toEqual(['aprs']);
});

it('reveals a selected transmitter type and shares selection between the table and map', () => {
    localStorage.setItem(hiddenTypesStoreName, JSON.stringify(['aprs']));
    const store = createStore();
    render(<Provider store={store}><ThemeProvider theme={createTheme()}><PacketMapLayout /></ThemeProvider></Provider>);
    act(() => tableRender.mock.lastCall[0].onSelectTransmitter('aprs:A'));
    expect(mapRender.mock.lastCall[0].selectedTransmitterId).toBe('aprs:A');
    expect(tableRender.mock.lastCall[0].selectedTransmitterId).toBe('aprs:A');
    expect(mapRender.mock.lastCall[0].positions).toHaveLength(2);
    expect(screen.getByRole('region', {name: 'Transmitter info'})).toHaveTextContent('aprs:A');
    expect(JSON.parse(localStorage.getItem(hiddenTypesStoreName))).toEqual([]);
    act(() => mapRender.mock.lastCall[0].onFitAll());
    expect(tableRender.mock.lastCall[0].selectedTransmitterId).toBeNull();
    expect(screen.getByRole('region', {name: 'Transmitter info'})).toHaveTextContent('Select a transmitter');
    act(() => mapRender.mock.lastCall[0].onSelectTransmitter('radiosonde:S'));
    expect(tableRender.mock.lastCall[0].selectedTransmitterId).toBe('radiosonde:S');
    expect(screen.getByRole('region', {name: 'Transmitter info'})).toHaveTextContent('radiosonde:S');
    fireEvent.click(screen.getByRole('button', {name: 'Clear transmitter selection'}));
    expect(tableRender.mock.lastCall[0].selectedTransmitterId).toBeNull();
});
