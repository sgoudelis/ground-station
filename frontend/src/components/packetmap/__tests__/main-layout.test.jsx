import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {Provider} from 'react-redux';
import {configureStore} from '@reduxjs/toolkit';
import {createTheme, ThemeProvider} from '@mui/material/styles';
import {beforeEach, expect, it, vi} from 'vitest';
import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import {toast} from 'react-toastify';
import PacketMapLayout from '../main-layout.jsx';
import {gridLayoutStoreName, hiddenTypesStoreName} from '../storage.js';
import {defaultLayouts, LAYOUT_SCHEMA_VERSION} from '../layouts.js';
import usePacketPositions from '../use-packet-positions.js';
import packetMapReducer from '../packet-map-slice.jsx';
import useAircraft from '../../decoders/use-aircraft.js';
import {liveRangeAt, LIVE_WINDOW_MS} from '../live.js';

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
vi.mock('../transmitter-list.jsx', () => ({default: (props) => {tableRender(props); return null;}}));
vi.mock('react-toastify', () => ({toast: {info: vi.fn()}}));

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

function recentFixtures() {
    fixture.positions = fixture.positions.map((point, index) => ({...point,
        captured_at: new Date(Date.now() - (index + 1) * 300000).toISOString(),
    }));
    fixture.transmitters = fixture.positions.map((point) => ({...point, id: point.transmitter_id, packet_count: 1}));
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
    recentFixtures();
});

it('loads Meshtastic positions into the map page and refreshes new captures in LIVE', async () => {
    const {default: realUsePacketPositions} = await vi.importActual('../use-packet-positions.js');
    usePacketPositions.mockImplementation(realUsePacketPositions);
    vi.useFakeTimers();
    try {
        vi.setSystemTime(new Date('2026-11-02T21:35:00Z'));
        const point = {id: 'mesh-fix', transmitter_id: 'meshtastic:!2008e299', kind: 'meshtastic',
            name: '!2008e299', source: '!2008e299', latitude: 40.6585344, longitude: 22.9376,
            altitude: 32, captured_at: '2026-11-02T21:33:32Z'};
        fixture.positions = [point];
        fixture.transmitters = [{...point, id: point.transmitter_id, packet_count: 1,
            details: {telemetry: {sats_in_view: 12}},
            field_info: {sats_in_view: {label: 'Satellites in view'}},
        }];
        const handlers = new Map();
        fixture.socket = {connected: true,
            on: vi.fn((event, handler) => handlers.set(event, handler)),
            off: vi.fn(), timeout: () => fixture.socket,
            emit: vi.fn((_event, request, reply) => {
                if (request.cmd === 'filebrowser.positions') reply(null, {success: true,
                    data: {positions: fixture.positions, transmitters: fixture.transmitters},
                });
            }),
        };
        const {unmount} = render(<Provider store={createStore()}><ThemeProvider theme={createTheme()}>
            <PacketMapLayout />
        </ThemeProvider></Provider>);
        await act(async () => {});
        expect(mapRender.mock.lastCall[0].positions).toEqual([point]);
        expect(tableRender.mock.lastCall[0].rows[0]).toMatchObject({id: point.transmitter_id, kind: 'meshtastic'});
        act(() => mapRender.mock.lastCall[0].onSelectTransmitter(point.transmitter_id));
        const details = screen.getByRole('region', {name: 'Transmitter info'});
        expect(details).toHaveTextContent('!2008e299');
        expect(within(details).getByRole('region', {name: 'GPS satellites'})).toHaveTextContent('12');

        const next = {...point, id: 'new-fix', latitude: 40.66, captured_at: '2026-11-02T21:35:01Z'};
        fixture.positions = [point, next];
        fixture.transmitters = [{...fixture.transmitters[0], latitude: next.latitude, packet_count: 2}];
        await act(async () => {
            handlers.get('library.changed')({changes: [{operation: 'added', id: 'decoded:new.bin', item: {type: 'decoded'}}]});
            vi.advanceTimersByTime(750);
        });
        expect(mapRender.mock.lastCall[0].positions).toEqual([point, next]);
        expect(tableRender.mock.lastCall[0].rows[0].packet_count).toBe(2);
        expect(within(details).getByRole('region', {name: 'Position'})).toHaveTextContent('40.66 °');
        act(() => mapRender.mock.lastCall[0].onHiddenTypesChange(['meshtastic']));
        expect(mapRender.mock.lastCall[0].positions).toEqual([]);
        act(() => mapRender.mock.lastCall[0].onHiddenTypesChange([]));
        expect(mapRender.mock.lastCall[0].positions).toEqual([point, next]);
        unmount();
    } finally {
        vi.useRealTimers();
    }
});

it('shows live aircraft beside saved radiosondes and updates positions without reloading history', async () => {
    const {default: realUseAircraft} = await vi.importActual('../../decoders/use-aircraft.js');
    const {default: realUsePacketPositions} = await vi.importActual('../use-packet-positions.js');
    useAircraft.mockImplementation(realUseAircraft);
    usePacketPositions.mockImplementation(realUsePacketPositions);
    vi.useFakeTimers();
    try {
        vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
        recentFixtures();
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
        act(() => vi.advanceTimersByTime(70000));
        expect(mapRender.mock.lastCall[0].positions.some((point) => point.kind === 'adsb')).toBe(true);
        act(() => vi.advanceTimersByTime(LIVE_WINDOW_MS));
        expect(mapRender.mock.lastCall[0].positions.some((point) => point.kind === 'adsb')).toBe(false);
        expect(tableRender.mock.lastCall[0].rows.some((row) => row.kind === 'adsb')).toBe(false);
        const info = screen.getByRole('region', {name: 'Transmitter info'});
        expect(info).toHaveTextContent('EWG46A');
        expect(within(info).getByRole('status')).toHaveTextContent(/No position received for \d+ minutes/);
        expect(within(info).queryByRole('button', {name: 'Jump to last position'})).not.toBeInTheDocument();
        fireEvent.click(within(info).getByRole('button', {name: 'Clear transmitter selection'}));
        expect(info).toHaveTextContent('Select a transmitter');
        expect(info).not.toHaveTextContent('EWG46A');
        expect(socket.emit.mock.calls.filter(([, request]) => request.cmd === 'filebrowser.positions')).toHaveLength(1);
        unmount();
    } finally {
        vi.useRealTimers();
    }
});

it('starts in LIVE with the last 30 minutes of packets when no selection has been saved', () => {
    const store = createStore();
    render(<Provider store={store}><ThemeProvider theme={createTheme()}><PacketMapLayout /></ThemeProvider></Provider>);
    const range = usePacketPositions.mock.lastCall[1];
    expect(range.end).toBeNull();
    expect(Date.parse(range.start)).toBeGreaterThanOrEqual(Date.now() - LIVE_WINDOW_MS - 1000);
    expect(Date.parse(range.start)).toBeLessThanOrEqual(Date.now() - LIVE_WINDOW_MS);
    expect(screen.getByRole('button', {name: 'LIVE', exact: true})).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('To')).toBeDisabled();
    expect(Number.isFinite(mapRender.mock.lastCall[0].playbackTime)).toBe(true);
});

it('does not resurrect selected aircraft details after the source data was removed before expiry', () => {
    vi.useFakeTimers();
    try {
        vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
        const point = {id: 'fix', transmitter_id: 'adsb:4d2406', kind: 'adsb', name: 'EWG46A', source: '4D2406',
            latitude: 40, longitude: 23, captured_at: new Date().toISOString()};
        fixture.positions = [point];
        fixture.transmitters = [{...point, id: point.transmitter_id}];
        const store = createStore();
        const element = () => <Provider store={store}><ThemeProvider theme={createTheme()}><PacketMapLayout /></ThemeProvider></Provider>;
        const {rerender, unmount} = render(element());
        act(() => tableRender.mock.lastCall[0].onSelectTransmitter(point.transmitter_id));
        expect(screen.getByRole('region', {name: 'Transmitter info'})).toHaveTextContent(point.name);
        fixture.positions = [];
        fixture.transmitters = [];
        rerender(element());
        expect(screen.getByRole('region', {name: 'Transmitter info'})).not.toHaveTextContent(point.name);
        act(() => vi.advanceTimersByTime(LIVE_WINDOW_MS + 30000));
        expect(screen.getByRole('region', {name: 'Transmitter info'})).not.toHaveTextContent(point.name);
        expect(screen.queryByText(/No position received for/)).not.toBeInTheDocument();
        unmount();
    } finally {
        vi.useRealTimers();
    }
});

it.each([
    ['before its first fix', '2026-11-01T09:00:00Z'],
    ['after its last fix expires', historyRange.end],
    ['in a gap between flights', '2026-11-01T10:40:00Z'],
])('reveals a selected historical aircraft at its last recorded position %s', (_description, cursor) => {
    const first = {id: 'first', transmitter_id: 'adsb:4d2406', kind: 'adsb', name: 'EWG46A', source: '4D2406',
        latitude: 40, longitude: 23, captured_at: '2026-11-01T10:00:00Z'};
    const last = {...first, id: 'last', latitude: 41, captured_at: '2026-11-01T11:00:00Z'};
    // History need not arrive in time order, and row telemetry may be newer
    // than the last recorded map fix. Neither should choose the jump target.
    fixture.positions = [last, first];
    fixture.transmitters = [{...last, id: last.transmitter_id, captured_at: historyRange.end}];
    const store = createStore(historyRange);
    render(<Provider store={store}><ThemeProvider theme={createTheme()}><PacketMapLayout /></ThemeProvider></Provider>);
    fireEvent.change(screen.getByRole('slider', {name: 'Playback time'}), {target: {value: Date.parse(cursor)}});
    act(() => tableRender.mock.lastCall[0].onSelectTransmitter(first.transmitter_id));
    expect(mapRender.mock.lastCall[0].selectedTransmitterId).toBe(first.transmitter_id);
    expect(mapRender.mock.lastCall[0].playbackTime).toBe(Date.parse(last.captured_at));
    expect(tableRender.mock.lastCall[0].playbackTime).toBe(Date.parse(last.captured_at));
    expect(screen.getByRole('slider', {name: 'Playback time'})).toHaveValue(String(Date.parse(last.captured_at)));
    expect(screen.getByRole('region', {name: 'Playback position'})).toHaveTextContent('41');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {name: /Jump to/})).not.toBeInTheDocument();
    expect(store.getState().packetMap.range).toEqual(historyRange);
    expect(usePacketPositions.mock.lastCall[1]).toEqual(historyRange);
    expect(toast.info).toHaveBeenCalledWith(expect.stringContaining('to show EWG46A.'), {autoClose: 4000});

    // Automatic jumps are selection events, not a lock on the playback slider.
    const beforeFirst = Date.parse(first.captured_at) - 1000;
    fireEvent.change(screen.getByRole('slider', {name: 'Playback time'}), {target: {value: beforeFirst}});
    expect(mapRender.mock.lastCall[0].playbackTime).toBe(beforeFirst);
    expect(screen.getByRole('status')).toHaveTextContent('Not yet seen');
    fireEvent.click(screen.getByRole('button', {name: 'Jump to first position'}));
    expect(mapRender.mock.lastCall[0].playbackTime).toBe(Date.parse(first.captured_at));
    expect(toast.info).toHaveBeenCalledTimes(1);
});

it.each([0, 30000, 61000, LIVE_WINDOW_MS])('keeps the cursor when selecting a historical aircraft visible at age %sms', (age) => {
    const cursor = Date.parse(historyRange.end);
    const point = {id: 'fix', transmitter_id: 'adsb:4d2406', kind: 'adsb', name: 'EWG46A', source: '4D2406',
        latitude: 40, longitude: 23, captured_at: new Date(cursor - age).toISOString()};
    fixture.positions = [point];
    fixture.transmitters = [{...point, id: point.transmitter_id}];
    render(<Provider store={createStore(historyRange)}><ThemeProvider theme={createTheme()}><PacketMapLayout /></ThemeProvider></Provider>);
    act(() => tableRender.mock.lastCall[0].onSelectTransmitter(point.transmitter_id));
    expect(mapRender.mock.lastCall[0].selectedTransmitterId).toBe(point.transmitter_id);
    expect(mapRender.mock.lastCall[0].playbackTime).toBe(cursor);
    expect(toast.info).not.toHaveBeenCalled();
});

it.each([
    ['missing', []],
    ['invalid', [{id: 'invalid', transmitter_id: 'adsb:4d2406', kind: 'adsb', captured_at: 'invalid'}]],
])('keeps the cursor when a historical aircraft has %s recorded fixes', (_description, positions) => {
    fixture.positions = positions;
    fixture.transmitters = [{id: 'adsb:4d2406', kind: 'adsb', name: 'EWG46A', source: '4D2406',
        captured_at: '2026-11-01T10:00:00Z'}];
    render(<Provider store={createStore(historyRange)}><ThemeProvider theme={createTheme()}><PacketMapLayout /></ThemeProvider></Provider>);
    act(() => tableRender.mock.lastCall[0].onSelectTransmitter('adsb:4d2406'));
    expect(mapRender.mock.lastCall[0].playbackTime).toBe(Date.parse(historyRange.end));
    expect(toast.info).not.toHaveBeenCalled();
});

it('keeps live playback running when selecting an aircraft with an older fix', () => {
    const point = {id: 'fix', transmitter_id: 'adsb:4d2406', kind: 'adsb', name: 'EWG46A', source: '4D2406',
        latitude: 40, longitude: 23, captured_at: new Date(Date.now() - 300000).toISOString()};
    fixture.positions = [point];
    fixture.transmitters = [{...point, id: point.transmitter_id}];
    render(<Provider store={createStore()}><ThemeProvider theme={createTheme()}><PacketMapLayout /></ThemeProvider></Provider>);
    act(() => tableRender.mock.lastCall[0].onSelectTransmitter(point.transmitter_id));
    expect(mapRender.mock.lastCall[0].playbackTime).toBeGreaterThan(Date.parse(point.captured_at));
    expect(screen.getByRole('button', {name: 'LIVE', exact: true})).toHaveAttribute('aria-pressed', 'true');
    expect(toast.info).not.toHaveBeenCalled();
});

it.each(['radiosonde', 'meshtastic', 'aprs'].flatMap((kind) => [
    [kind, 'before its first fix', '2026-11-01T09:00:00Z'],
    [kind, 'after its last fix', '2026-11-01T11:00:01Z'],
]))('reveals a selected historical %s at its last recorded position %s', (kind, _description, cursor) => {
    const first = {id: 'first', transmitter_id: `${kind}:A`, kind, name: 'A', source: 'A',
        latitude: 40, longitude: 23, captured_at: '2026-11-01T10:00:00Z'};
    const last = {...first, id: 'last', latitude: 41, captured_at: '2026-11-01T11:00:00Z'};
    fixture.positions = [last, first];
    // Latest row telemetry must not replace the endpoint in the loaded track.
    fixture.transmitters = [{...last, id: last.transmitter_id, captured_at: historyRange.end}];
    const store = createStore(historyRange);
    render(<Provider store={store}><ThemeProvider theme={createTheme()}><PacketMapLayout /></ThemeProvider></Provider>);
    fireEvent.change(screen.getByRole('slider', {name: 'Playback time'}), {target: {value: Date.parse(cursor)}});
    act(() => tableRender.mock.lastCall[0].onSelectTransmitter(first.transmitter_id));
    expect(mapRender.mock.lastCall[0].selectedTransmitterId).toBe(first.transmitter_id);
    expect(mapRender.mock.lastCall[0].playbackTime).toBe(Date.parse(last.captured_at));
    expect(toast.info).toHaveBeenCalledOnce();
    expect(store.getState().packetMap.range).toEqual(historyRange);
    expect(usePacketPositions.mock.lastCall[1]).toEqual(historyRange);
    // Scrubbing remains free after the selection-triggered jump.
    fireEvent.change(screen.getByRole('slider', {name: 'Playback time'}), {target: {value: Date.parse(cursor)}});
    expect(mapRender.mock.lastCall[0].playbackTime).toBe(Date.parse(cursor));
    expect(toast.info).toHaveBeenCalledOnce();
});

it.each(['radiosonde', 'meshtastic', 'aprs'])('keeps playback within a historical %s interval, including its endpoints and gaps', (kind) => {
    const first = {id: 'first', transmitter_id: `${kind}:A`, kind, name: 'A', source: 'A',
        latitude: 40, longitude: 23, captured_at: '2026-11-01T10:00:00Z'};
    const last = {...first, id: 'last', latitude: 41, captured_at: '2026-11-01T11:30:00Z'};
    fixture.positions = [last, first];
    fixture.transmitters = [{...last, id: last.transmitter_id}];
    render(<Provider store={createStore(historyRange)}><ThemeProvider theme={createTheme()}><PacketMapLayout /></ThemeProvider></Provider>);
    for (const cursor of [first.captured_at, '2026-11-01T11:00:00Z', last.captured_at]) {
        fireEvent.change(screen.getByRole('slider', {name: 'Playback time'}), {target: {value: Date.parse(cursor)}});
        act(() => tableRender.mock.lastCall[0].onSelectTransmitter(first.transmitter_id));
        expect(mapRender.mock.lastCall[0].playbackTime).toBe(Date.parse(cursor));
    }
    expect(toast.info).not.toHaveBeenCalled();
});

it.each(['radiosonde', 'meshtastic', 'aprs'])('keeps LIVE enabled when selecting a %s', (kind) => {
    const point = {id: 'fix', transmitter_id: `${kind}:A`, kind, name: 'A', source: 'A',
        latitude: 40, longitude: 23, captured_at: new Date(Date.now() - 300000).toISOString()};
    fixture.positions = [point];
    fixture.transmitters = [{...point, id: point.transmitter_id}];
    const store = createStore();
    render(<Provider store={store}><ThemeProvider theme={createTheme()}><PacketMapLayout /></ThemeProvider></Provider>);
    act(() => tableRender.mock.lastCall[0].onSelectTransmitter(point.transmitter_id));
    expect(mapRender.mock.lastCall[0].playbackTime).toBeGreaterThan(Date.parse(point.captured_at));
    expect(store.getState().packetMap.range.end).toBeNull();
    expect(toast.info).not.toHaveBeenCalled();
});

it.each(['radiosonde', 'meshtastic', 'aprs'])('keeps the cursor when a historical %s has no valid recorded timestamp', (kind) => {
    fixture.positions = [{id: 'invalid', transmitter_id: `${kind}:A`, kind, captured_at: 'invalid'}];
    fixture.transmitters = [{id: `${kind}:A`, kind, name: 'A', source: 'A', captured_at: historyRange.end}];
    render(<Provider store={createStore(historyRange)}><ThemeProvider theme={createTheme()}><PacketMapLayout /></ThemeProvider></Provider>);
    act(() => tableRender.mock.lastCall[0].onSelectTransmitter(`${kind}:A`));
    expect(mapRender.mock.lastCall[0].playbackTime).toBe(Date.parse(historyRange.end));
    expect(toast.info).not.toHaveBeenCalled();
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

it('scrubs radiosonde gauges and altitude with the selected map position', () => {
    const first = {id: 'first', transmitter_id: 'radiosonde:RS41:TEST', kind: 'radiosonde', name: 'TEST',
        latitude: 40, longitude: 23, altitude: 20000, groundspeed_mps: 12, vertical_rate_mps: 5,
        track_deg: 80, captured_at: '2026-11-01T11:58:00Z'};
    const last = {...first, id: 'last', altitude: 20600, latitude: 41, groundspeed_mps: 25,
        vertical_rate_mps: -8, track_deg: 100, captured_at: '2026-11-01T12:00:00Z'};
    fixture.positions = [first, last];
    fixture.transmitters = [{...last, id: last.transmitter_id,
        details: {telemetry: {alt: 20600, vel_h: 25, vel_v: -8, heading: 100, temp: -48}}}];
    render(<Provider store={createStore(historyRange)}><ThemeProvider theme={createTheme()}><PacketMapLayout /></ThemeProvider></Provider>);
    act(() => tableRender.mock.lastCall[0].onSelectTransmitter(first.transmitter_id));
    expect(screen.getByRole('region', {name: 'Horizontal speed'})).toHaveTextContent('25.0m/s');
    const cursor = Date.parse('2026-11-01T11:58:30Z');
    fireEvent.change(screen.getByRole('slider', {name: 'Playback time'}), {target: {value: cursor}});
    expect(mapRender.mock.lastCall[0].playbackTime).toBe(cursor);
    expect(screen.getByRole('region', {name: 'Horizontal speed'})).toHaveTextContent('12.0m/s');
    expect(screen.getByRole('region', {name: 'Vertical speed'})).toHaveTextContent('+5.0m/s');
    expect(screen.getByRole('region', {name: 'Altitude'})).toHaveTextContent('20,150m');
    expect(screen.getByRole('region', {name: 'Heading'})).toHaveTextContent('080°');
    expect(screen.getByRole('region', {name: 'Playback position'})).toHaveTextContent(/40\.\d+/);
    expect(screen.getByRole('region', {name: 'Latest telemetry'})).toHaveTextContent('-48');
});

it('advances the live clock without incoming packets and stops the timer in history', () => {
    vi.useFakeTimers();
    try {
        vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
        recentFixtures();
        const store = createStore();
        const {unmount} = render(<Provider store={store}><ThemeProvider theme={createTheme()}><PacketMapLayout /></ThemeProvider></Provider>);
        const initialTime = mapRender.mock.lastCall[0].playbackTime;
        act(() => vi.advanceTimersByTime(30000));
        expect(mapRender.mock.lastCall[0].playbackTime).toBe(initialTime + 30000);
        expect(tableRender.mock.lastCall[0].playbackTime).toBe(initialTime + 30000);
        expect(mapRender.mock.lastCall[0].positions).toEqual(fixture.positions);
        // A paused historical cursor must not age along with the wall clock.
        fireEvent.click(screen.getByRole('button', {name: '24h', exact: true}));
        const historicalTime = mapRender.mock.lastCall[0].playbackTime;
        expect(Number.isFinite(historicalTime)).toBe(true);
        const renderCount = mapRender.mock.calls.length;
        act(() => vi.advanceTimersByTime(60000));
        expect(mapRender.mock.lastCall[0].playbackTime).toBe(historicalTime);
        expect(tableRender.mock.lastCall[0].playbackTime).toBe(historicalTime);
        expect(mapRender).toHaveBeenCalledTimes(renderCount);
        unmount();
    } finally {
        vi.useRealTimers();
    }
});

it.each(['LIVE', 'Custom'])('pauses live updates with %s and resumes them with LIVE', (button) => {
    vi.useFakeTimers();
    try {
        vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
        recentFixtures();
        const store = createStore();
        render(<Provider store={store}><ThemeProvider theme={createTheme()}><PacketMapLayout /></ThemeProvider></Provider>);
        act(() => vi.advanceTimersByTime(30000));
        const cursor = mapRender.mock.lastCall[0].playbackTime;
        const start = liveRangeAt(cursor).start;
        fireEvent.click(screen.getByRole('button', {name: button, exact: true}));
        if (button === 'Custom') {
            expect(screen.getByRole('dialog')).toBeInTheDocument();
            fireEvent.keyDown(screen.getByRole('dialog'), {key: 'Escape'});
            act(() => vi.advanceTimersByTime(300));
        }
        expect(store.getState().packetMap.range).toEqual({start, end: new Date(cursor).toISOString()});
        expect(useAircraft.mock.lastCall[1]).toBe(false);
        expect(screen.getByRole('button', {name: 'LIVE', exact: true})).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('slider', {name: 'Playback time'})).not.toBeDisabled();
        act(() => vi.advanceTimersByTime(60000));
        expect(mapRender.mock.lastCall[0].playbackTime).toBe(cursor);
        fireEvent.click(screen.getByRole('button', {name: 'LIVE', exact: true}));
        expect(store.getState().packetMap.range).toEqual(liveRangeAt());
        expect(useAircraft.mock.lastCall[1]).toBe(true);
        expect(screen.getByRole('button', {name: 'LIVE', exact: true})).toHaveAttribute('aria-pressed', 'true');
        expect(mapRender.mock.lastCall[0].playbackTime).toBeGreaterThan(cursor);
        expect(screen.getByRole('slider', {name: 'Live time'})).toBeDisabled();
    } finally {
        vi.useRealTimers();
    }
});

it.each(['LIVE', '1h', '6h', '24h'])('stores %s in Redux and restores it when revisiting the map', (preset) => {
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

it.each([['LIVE', 'live'], ['1h', 1], ['6h', 6], ['24h', 24]])('%s clears transmitter selection and preserves the map view through new results', async (button, hours) => {
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
    if (hours === 'live') {
        expect(range.end).toBeNull();
        expect(Math.abs(Date.parse(range.start) - Date.parse(liveRangeAt().start))).toBeLessThan(1000);
    }
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

it.each(['1h', '6h', '24h'])('follows new radiosondes in LIVE and returns to history with %s', async (preset) => {
    const {default: realUsePacketPositions} = await vi.importActual('../use-packet-positions.js');
    usePacketPositions.mockImplementation(realUsePacketPositions);
    vi.useFakeTimers();
    try {
        vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
        recentFixtures();
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
        expect(requests[1].request.data).toEqual(liveRangeAt());
        expect(screen.getByLabelText('To')).toBeDisabled();
        await act(async () => requests[1].reply(null, {success: true, data: snapshot}));
        act(() => tableRender.mock.lastCall[0].onSelectTransmitter('radiosonde:S'));
        const preservedView = mapRender.mock.lastCall[0].preserveViewRequest;

        vi.setSystemTime(new Date('2026-11-01T12:05:00Z'));
        act(() => {handlers.get('library.changed')(); vi.advanceTimersByTime(750);});
        expect(requests[2].request.data).toEqual(liveRangeAt());
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
    // Keep both packet types inside the rolling 30-minute query window.
    fixture.positions = fixture.positions.map((point, index) => ({...point,
        captured_at: new Date(Date.now() - (index + 1) * 300000).toISOString(),
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

it('routes context camera actions without moving playback and jumps to chronological track endpoints on request', () => {
    const id = 'radiosonde:S';
    const first = Date.parse('2026-11-01T01:00:00Z');
    const last = first + 3600000;
    fixture.positions = [last, first].map((time, index) => ({id: String(index), transmitter_id: id, kind: 'radiosonde',
        name: 'S', latitude: 40 + index, longitude: 23, captured_at: new Date(time).toISOString()}));
    fixture.transmitters = [{...fixture.positions[0], id}];
    localStorage.setItem(hiddenTypesStoreName, JSON.stringify(['radiosonde']));
    render(<Provider store={createStore(historyRange)}><ThemeProvider theme={createTheme()}><PacketMapLayout /></ThemeProvider></Provider>);
    const originalTime = mapRender.mock.lastCall[0].playbackTime;
    act(() => tableRender.mock.lastCall[0].onTransmitterAction('center', id));
    expect(mapRender.mock.lastCall[0]).toMatchObject({selectedTransmitterId: id, playbackTime: originalTime,
        navigationRequest: {type: 'center', transmitterId: id}, hiddenTypes: []});
    act(() => tableRender.mock.lastCall[0].onTransmitterAction('fit', id));
    expect(mapRender.mock.lastCall[0].playbackTime).toBe(originalTime);
    expect(mapRender.mock.lastCall[0].navigationRequest.type).toBe('fit');
    act(() => tableRender.mock.lastCall[0].onTransmitterAction('first', id));
    expect(mapRender.mock.lastCall[0].playbackTime).toBe(first);
    expect(mapRender.mock.lastCall[0].navigationRequest.type).toBe('follow');
    act(() => tableRender.mock.lastCall[0].onTransmitterAction('last', id));
    expect(mapRender.mock.lastCall[0].playbackTime).toBe(last);
    act(() => mapRender.mock.lastCall[0].onFollowingChange(id));
    expect(tableRender.mock.lastCall[0].followedTransmitterId).toBe(id);
    act(() => mapRender.mock.lastCall[0].onFollowingChange(null));
    expect(tableRender.mock.lastCall[0].followedTransmitterId).toBeNull();
});

it('keeps LIVE enabled when a stale jump action arrives and allows following to resume on reselection', () => {
    render(<Provider store={createStore()}><ThemeProvider theme={createTheme()}><PacketMapLayout /></ThemeProvider></Provider>);
    expect(tableRender.mock.lastCall[0].isLive).toBe(true);
    act(() => tableRender.mock.lastCall[0].onTransmitterAction('first', 'radiosonde:S'));
    expect(mapRender.mock.lastCall[0].selectedTransmitterId).toBeNull();
    act(() => tableRender.mock.lastCall[0].onSelectTransmitter('radiosonde:S'));
    const request = mapRender.mock.lastCall[0].navigationRequest;
    act(() => tableRender.mock.lastCall[0].onSelectTransmitter('radiosonde:S'));
    expect(mapRender.mock.lastCall[0].navigationRequest).not.toBe(request);
    expect(mapRender.mock.lastCall[0].navigationRequest).toEqual({type: 'follow', transmitterId: 'radiosonde:S'});
});
