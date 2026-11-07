import React from 'react';
import {fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {afterAll, beforeAll, beforeEach, expect, it, vi} from 'vitest';
import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import TransmitterList from '../transmitter-list.jsx';
import packetMapReducer from '../packet-map-slice.jsx';

await i18n.use(initReactI18next).init({lng: 'en', resources: {}});
vi.mock('../../common/common.jsx', () => ({
    TitleBar: ({children}) => <div>{children}</div>, islandTitleBarCompactSx: {},
    getClassNamesBasedOnGridEditing: () => '',
}));
vi.mock('../../../hooks/useUserTimeSettings.jsx', () => ({useUserTimeSettings: () => ({timezone: 'UTC', locale: 'en'})}));

const received = Date.parse('2026-11-02T12:00:00Z');
const fixtures = [
    {id: 'adsb:4d2406', kind: 'adsb', name: 'AEE608', source: '4D2406',
        aircraft: {type_code: 'A320', registration: 'SX-DVA', operator_name: 'Aegean', model: 'A320-214', category: 'A3',
            engine_count: 2, engine_type: 'J', wake_category: 'M', year: '2012', operator_callsign: 'AEGEAN', operator_country: 'Greece'},
        details: {telemetry: {groundspeed_mps: 200, vertical_rate_mps: 2, track_deg: 145, squawk: '0042', altitude_baro_m: 9500},
            readsb: {tas: 455, ias: 280, mach: 0.78, rssi: -24, nav_altitude_mcp: 35000, nav_heading: 0,
                nav_qnh: 1013.2, mag_heading: 141, true_heading: 145, roll: 0, track_rate: -0.5,
                ws: 42, wd: 270, oat: -48.5, tat: -12.5, geom_rate: -500, nav_modes: ['autopilot', 'lnav']}}},
    {id: 'meshtastic:!2008e299', kind: 'meshtastic', name: '!2008e299', source: '!2008e299',
        details: {telemetry: {channel_hash: '0x08', destination: 'Broadcast', hop_limit: 0, sats_in_view: 9,
            hop_start: 3, relay_node: '0x52', packet_id: '0x1234', encryption: 'Public default key', HDOP: 1.23}}},
    {id: 'aprs:SV1ABC', kind: 'aprs', name: 'SV1ABC', source: 'SV1ABC',
        details: {telemetry: {comment: 'Mobile station', position: {speed_knots: 12, course_degrees: 90, symbol_table: '/', symbol_code: '>'}}}},
    {id: 'radiosonde:V1234567', kind: 'radiosonde', name: 'V1234567', source: 'V1234567',
        details: {telemetry: {type: 'RS41', subtype: 'RS41-SGP', vel_h: 10, vel_v: -5.2, temp: -48,
            humidity: 0, pressure: 26.4, batt: 2.9, sats: 10, bt: 0, frame: 1234, heading: 123,
            tx_frequency: 403500, datetime: '2026-11-02T12:04:05Z', ref_position: 'MSL',
            aprsid: 'S1234567', rawid: 'RS41_1234567', diff_GPS_MSL: 0},
        decoder: {type: 'radiosonde'}, vfo: {id: 2, bandwidth_hz: 20000, center_freq_hz: 403600000}}},
].map((row, index) => ({...row, latitude: 40 + index * 0.1, longitude: 23, altitude: 10000,
    captured_at: new Date(received).toISOString(), first_seen: new Date(received - index * 1000).toISOString(),
    last_seen: new Date(received + index * 1000).toISOString(), packet_count: index + 1}));

function setup(props = {}, initialSettings) {
    const store = configureStore({reducer: {
        packetMap: packetMapReducer, location: () => ({location: {lat: 40, lon: 23}}),
    }, preloadedState: initialSettings ? {packetMap: {transmitterList: initialSettings}} : undefined});
    const element = (next = {}) => <Provider store={store}>
        <TransmitterList rows={fixtures} playbackTime={received} {...props} {...next} />
    </Provider>;
    const view = render(element());
    return {...view, store, update: (next) => view.rerender(element(next)), element};
}

beforeEach(() => vi.clearAllMocks());

const scrollToDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
beforeAll(() => {
    // jsdom has no element scrolling; the virtualizer listens for the browser's scroll event.
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {configurable: true, value({top = 0}) {
        this.scrollTop = top;
        this.dispatchEvent(new Event('scroll'));
    }});
});
afterAll(() => {
    if (scrollToDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollTo', scrollToDescriptor);
    else delete HTMLElement.prototype.scrollTo;
});

it('shows protocol-specific two-line summaries with reception details, real symbols and zero values', () => {
    setup();
    const plane = screen.getByRole('button', {name: 'AEE608'});
    expect(plane).toHaveTextContent('ICAO 4D2406 · SX-DVA · A320 · Aegean');
    expect(plane).toHaveTextContent('Alt 10,000 m');
    expect(plane).toHaveTextContent('Speed 389 kt');
    expect(plane).toHaveTextContent('Squawk 0042');
    expect(plane).toHaveTextContent('Large aircraft');
    expect(plane).toHaveTextContent('Baro 9,500 m');
    expect(plane).toHaveTextContent('TAS 455 kt');
    expect(plane).toHaveTextContent('IAS 280 kt');
    expect(plane).toHaveTextContent('Mach 0.78');
    expect(plane).toHaveTextContent('Climbing');
    expect(plane).toHaveTextContent('Engines 2 Jet');
    expect(plane).toHaveTextContent('Wake Medium');
    expect(plane).toHaveTextContent('Built 2012');
    expect(plane).toHaveTextContent('Target alt 35,000 ft');
    expect(plane).toHaveTextContent('Selected hdg 0 °');
    expect(plane).toHaveTextContent('QNH 1,013.2 hPa');
    expect(plane).toHaveTextContent('Mag hdg 141 °');
    expect(plane).toHaveTextContent('True hdg 145 °');
    expect(plane).toHaveTextContent('Roll 0 °');
    expect(plane).toHaveTextContent('Turn rate -0.5 °/s');
    expect(plane).toHaveTextContent('Wind 42 kt');
    expect(plane).toHaveTextContent('Wind direction 270 °');
    expect(plane).toHaveTextContent('OAT -48.5 °C');
    expect(plane).toHaveTextContent('TAT -12.5 °C');
    expect(plane).toHaveTextContent('Geom V/S -2.5 m/s');
    expect(plane).toHaveTextContent('Modes AUTOPILOT · LNAV');
    expect(plane).toHaveTextContent('Radio AEGEAN');
    expect(plane).toHaveTextContent('Greece');
    expect(plane).toHaveTextContent('Power -24 dBFS');
    expect(plane).toHaveTextContent('0 km');
    expect(plane).toHaveTextContent('11/2/26, 12:00:00 PM');
    expect(plane.querySelector('[data-aircraft-shape]')).not.toBeNull();
    const mesh = screen.getByRole('button', {name: '!2008e299'});
    expect(mesh.querySelector('img')).toHaveAttribute('src', expect.stringContaining('/icons/meshtastic.png'));
    expect(mesh).toHaveTextContent('Channel 0x08');
    expect(mesh).toHaveTextContent('Hop limit 0');
    expect(mesh).toHaveTextContent('GPS 9 sats');
    expect(mesh).toHaveTextContent('Initial hops 3');
    expect(mesh).toHaveTextContent('Relay 0x52');
    expect(mesh).toHaveTextContent('HDOP 1.23');
    const aprs = screen.getByRole('button', {name: 'SV1ABC'});
    expect(aprs).toHaveTextContent('Car');
    expect(aprs).toHaveTextContent('Mobile station');
    expect(aprs.querySelector('img')).toHaveAttribute('src', expect.stringContaining('mobile.png'));
    const sonde = screen.getByRole('button', {name: 'V1234567'});
    expect(sonde).toHaveTextContent('RS41');
    expect(sonde).toHaveTextContent('RS41-SGP');
    expect(sonde).toHaveTextContent('Descending');
    expect(sonde).toHaveTextContent('Sonde time 12:04:05 PM');
    expect(sonde).toHaveTextContent('Alt ref MSL');
    expect(sonde).toHaveTextContent('APRS S1234567');
    expect(sonde).toHaveTextContent('Serial RS41_1234567');
    expect(sonde).toHaveTextContent('V/S -5.2 m/s');
    expect(sonde).toHaveTextContent('Temp -48 °C');
    expect(sonde).toHaveTextContent('RH 0 %');
    expect(sonde).toHaveTextContent('Battery 2.9 V');
    expect(sonde).toHaveTextContent('Pressure 26.4 hPa');
    expect(sonde).toHaveTextContent('Heading 123 °');
    expect(sonde).toHaveTextContent('TX 403.5 MHz');
    expect(sonde).toHaveTextContent('RF 403.6 MHz');
    expect(sonde).toHaveTextContent('GPS − MSL 0 m');
    expect(sonde).toHaveTextContent('Burst timer 0 s');
    expect(sonde).toHaveTextContent('Frame 1,234');
    expect(sonde).toHaveTextContent('VFO 2');
    expect(sonde).toHaveTextContent('BW 20 kHz');
    expect(sonde.querySelector('img')).toHaveAttribute('src', expect.stringContaining('parachute.png'));
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
});

it('omits unavailable aircraft and sonde details and never invents a level-flight phase', () => {
    const rows = [fixtures[0], fixtures[3]].map((row) => ({...row, aircraft: undefined, details: {}}));
    const {update} = setup({rows});
    for (const name of ['AEE608', 'V1234567']) {
        const row = screen.getByRole('button', {name});
        expect(row).not.toHaveTextContent(/Target alt|QNH|Modes|Geom V\/S|TAT|Radio |Engines|Built|TX|Sonde time|Level flight|Climbing|Descending|NaN|Invalid Date/);
    }
    update({rows: rows.map((row) => ({...row, details: {telemetry: {vel_v: 0, vertical_rate_mps: 0}, readsb: {nav_altitude_fms: 0}}}))});
    expect(screen.getByRole('button', {name: 'AEE608'})).toHaveTextContent('Level flight');
    expect(screen.getByRole('button', {name: 'AEE608'})).toHaveTextContent('Target alt 0 ft');
    expect(screen.getByRole('button', {name: 'V1234567'})).toHaveTextContent('Level flight');
});

it('shows weather reports in APRS summaries and converts Fahrenheit without losing zero readings', () => {
    setup({rows: [{...fixtures[2], details: {telemetry: {weather: {temperature_fahrenheit: 32,
        humidity_percent: 100, pressure_mbar: 1008.4, wind_speed_mph: 0, wind_gust_mph: 4}},
    frame: {path: ['WIDE1-1', 'WIDE2-1']}}}]});
    const row = screen.getByRole('button', {name: 'SV1ABC'});
    expect(row).toHaveTextContent('Temp 0 °C');
    expect(row).toHaveTextContent('RH 100 %');
    expect(row).toHaveTextContent('Pressure 1,008.4 hPa');
    expect(row).toHaveTextContent('Wind 0 mph');
    expect(row).toHaveTextContent('Path WIDE1-1 → WIDE2-1');
});

it('searches identities and metadata, filters types independently of map visibility and saves sorting', () => {
    const {store, update} = setup({hiddenTypes: ['meshtastic']});
    expect(screen.getByRole('button', {name: '!2008e299'})).toHaveClass('transmitter-hidden');
    fireEvent.change(screen.getByRole('textbox', {name: 'Search transmitters'}), {target: {value: 'sx-dva A320'}});
    expect(within(screen.getByRole('list', {name: 'Transmitters'})).getAllByRole('listitem')).toHaveLength(1);
    expect(screen.getByRole('button', {name: 'AEE608'})).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', {name: 'Search transmitters'}), {target: {value: ''}});
    fireEvent.click(screen.getByRole('button', {name: 'Transmitter types'}));
    fireEvent.click(screen.getByRole('menuitem', {name: /ADS-B/}));
    expect(store.getState().packetMap.transmitterList.excludedTypes).toEqual(['adsb']);
    expect(screen.queryByRole('button', {name: 'AEE608'})).not.toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('menu'), {key: 'Escape'});
    fireEvent.mouseDown(screen.getByRole('combobox', {name: 'Sort transmitters'}));
    fireEvent.click(screen.getByRole('option', {name: 'Name', exact: true}));
    expect(store.getState().packetMap.transmitterList.sort).toBe('name');
    expect(within(screen.getByRole('list', {name: 'Transmitters'})).getAllByRole('listitem').map((item) => item.querySelector('button[data-id]').getAttribute('aria-label')))
        .toEqual(['!2008e299', 'SV1ABC', 'V1234567']);
    update({rows: fixtures.map((row) => ({...row, packet_count: 10}))});
    expect(screen.queryByRole('button', {name: 'AEE608'})).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: '!2008e299'})).toBeInTheDocument();
});

const fixesFor = (row) => [0, 60000].map((offset, index) => ({...row, transmitter_id: row.id,
    latitude: row.latitude + index, captured_at: new Date(received + offset).toISOString()}));

it('opens row actions by right click without selecting or moving playback, then acts on that identity', async () => {
    const onSelectTransmitter = vi.fn();
    const onTransmitterAction = vi.fn();
    setup({positions: fixesFor(fixtures[0]), onSelectTransmitter, onTransmitterAction});
    const row = screen.getByRole('button', {name: 'AEE608'});
    row.focus();
    fireEvent.contextMenu(row, {clientX: 120, clientY: 180});
    expect(screen.getByRole('menu', {name: 'Transmitter actions'})).toBeInTheDocument();
    expect(onSelectTransmitter).not.toHaveBeenCalled();
    expect(onTransmitterAction).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('menuitem', {name: 'Center on map'}));
    expect(onTransmitterAction).toHaveBeenCalledExactlyOnceWith('center', fixtures[0].id);
    await waitFor(() => expect(row).toHaveFocus());
});

it('provides a visible menu button and Shift+F10, and reflects follow and LIVE state', () => {
    const onSelectTransmitter = vi.fn();
    const {update} = setup({positions: fixesFor(fixtures[0]), isLive: true,
        followedTransmitterId: fixtures[0].id, onSelectTransmitter});
    fireEvent.click(screen.getByRole('button', {name: 'Actions for AEE608'}));
    expect(screen.getByRole('menuitem', {name: 'Stop following'})).toBeEnabled();
    expect(screen.getByRole('menuitem', {name: 'Jump to first position'})).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', {name: 'Jump to last position'})).toHaveAttribute('aria-disabled', 'true');
    fireEvent.keyDown(screen.getByRole('menu'), {key: 'Escape'});
    update({followedTransmitterId: null, isLive: false});
    fireEvent.keyDown(screen.getByRole('button', {name: 'AEE608'}), {key: 'F10', shiftKey: true});
    expect(screen.getByRole('menuitem', {name: 'Follow transmitter'})).toBeEnabled();
    expect(screen.getByRole('menuitem', {name: 'Jump to first position'})).toBeEnabled();
    expect(onSelectTransmitter).not.toHaveBeenCalled();
});

it('disables camera actions without a playback position and closes on live row expiry', async () => {
    const {update} = setup({positions: fixesFor(fixtures[0]), playbackTime: received - 1});
    fireEvent.contextMenu(screen.getByRole('button', {name: 'AEE608'}));
    expect(screen.getByRole('menuitem', {name: 'Center on map'})).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', {name: 'Follow transmitter'})).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('menuitem', {name: 'Fit entire track'})).toBeEnabled();
    update({rows: fixtures.slice(1)});
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
});

it('copies the real identifier, latest coordinates and full details without selecting the transmitter', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: {writeText}});
    try {
        const row = {...fixtures[0], file_id: 'decoded:adsb_4d2406/run/packet.jsonl'};
        const onSelectTransmitter = vi.fn();
        setup({rows: [row], onSelectTransmitter});
        for (const [label, expected] of [
            ['Copy identifier', '4D2406'],
            ['Copy latest coordinates', '40.000000, 23.000000'],
            ['Copy details JSON', JSON.stringify(row, null, 2)],
        ]) {
            fireEvent.contextMenu(screen.getByRole('button', {name: 'AEE608'}));
            fireEvent.click(screen.getByRole('menuitem', {name: 'Copy', exact: true}));
            fireEvent.click(screen.getByRole('menuitem', {name: label}));
            await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(expected));
        }
        expect(onSelectTransmitter).not.toHaveBeenCalled();
    } finally {
        if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
        else delete navigator.clipboard;
    }
});

it('copies from the menu on HTTP installations while releasing the menu focus trap', async () => {
    const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const command = Object.getOwnPropertyDescriptor(document, 'execCommand');
    const copiedValues = [];
    const copy = vi.fn(() => {
        copiedValues.push(document.activeElement.value);
        return true;
    });
    Object.defineProperty(navigator, 'clipboard', {configurable: true, value: undefined});
    Object.defineProperty(document, 'execCommand', {configurable: true, value: copy});
    try {
        setup();
        fireEvent.contextMenu(screen.getByRole('button', {name: 'AEE608'}));
        fireEvent.click(screen.getByRole('menuitem', {name: 'Copy', exact: true}));
        fireEvent.click(screen.getByRole('menuitem', {name: 'Copy identifier'}));
        await waitFor(() => expect(copy).toHaveBeenCalledExactlyOnceWith('copy'));
        expect(copiedValues).toEqual(['4D2406']);
        expect(document.querySelector('textarea')).toBeNull();
    } finally {
        if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard);
        else delete navigator.clipboard;
        if (command) Object.defineProperty(document, 'execCommand', command);
        else delete document.execCommand;
    }
});

it('restores saved list controls after a remount', () => {
    const view = setup({}, {excludedTypes: ['aprs', 'radiosonde'], sort: 'name'});
    expect(within(screen.getByRole('list', {name: 'Transmitters'})).getAllByRole('listitem')).toHaveLength(2);
    view.unmount();
    render(view.element());
    expect(within(screen.getByRole('list', {name: 'Transmitters'})).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('combobox', {name: 'Sort transmitters'})).toHaveTextContent('Name');
});

it('keeps selection and telemetry stable while aircraft icons and reception status age on playback ticks', () => {
    const oldCallback = vi.fn();
    const {container, update} = setup({onSelectTransmitter: oldCallback});
    const plane = screen.getByRole('button', {name: 'AEE608'});
    const telemetry = plane.querySelector('.metric-primary');
    const observer = new MutationObserver(() => {});
    observer.observe(telemetry, {childList: true, subtree: true, characterData: true});
    const callback = vi.fn();
    update({playbackTime: received + 61000, onSelectTransmitter: callback, selectedTransmitterId: fixtures[0].id});
    expect(plane).toHaveAttribute('aria-pressed', 'true');
    expect(plane.querySelector('path[fill]')).toHaveAttribute('fill', '#9e9e9e');
    expect(plane).toHaveTextContent('Signal lost · 1m ago');
    expect(observer.takeRecords()).toHaveLength(0);
    observer.disconnect();
    fireEvent.click(plane);
    expect(callback).toHaveBeenCalledWith(fixtures[0].id);
    expect(oldCallback).not.toHaveBeenCalled();
    expect(container.querySelectorAll('button[data-id]')).toHaveLength(4);
});

it('keeps historical aircraft listed and follows fixes at the cursor instead of the latest row timestamp', () => {
    const aircraft = fixtures[0];
    const positions = [0, 7200000].map((offset) => ({kind: 'adsb', transmitter_id: aircraft.id,
        captured_at: new Date(received + offset).toISOString()}));
    const rows = [{...aircraft, captured_at: positions[1].captured_at}];
    const {update} = setup({rows, positions, playbackTime: received - 1});
    const row = () => screen.getByRole('button', {name: aircraft.name});
    expect(row()).toHaveTextContent('Not yet seen');
    expect(row().querySelector('path[fill]')).toHaveAttribute('fill', '#9e9e9e');
    update({rows, positions, playbackTime: received});
    expect(row()).toHaveTextContent('Receiving');
    expect(row().querySelector('path[fill]')).toHaveAttribute('fill', '#0288d1');
    update({rows, positions, playbackTime: received + 180000});
    expect(row()).toHaveTextContent('Signal lost · 3m ago');
    update({rows, positions, playbackTime: received + 3600000});
    expect(row()).toHaveTextContent('Last seen · 60m ago');
    update({rows, positions, playbackTime: received + 7200000});
    expect(row()).toHaveTextContent('Receiving');
});

it('preserves emergency highlights and explicit telemetry clears at the same position timestamp', () => {
    const rows = ['7500', '7600', '7700', '0042'].map((squawk) => ({...fixtures[0], id: squawk, name: squawk, squawk,
        details: {telemetry: {squawk}}}));
    rows.push({...fixtures[0], id: 'priority', name: 'priority', details: {telemetry: {emergency: 'minfuel'}}});
    const {update} = setup({rows});
    expect(screen.getByRole('button', {name: '7500'})).toHaveClass('transmitter-emergency-error');
    expect(screen.getByRole('button', {name: '7600'})).toHaveClass('transmitter-emergency-warning');
    expect(screen.getByRole('button', {name: 'priority'})).toHaveTextContent('Minimum fuel');
    expect(screen.getByRole('button', {name: '0042'}).className).not.toContain('transmitter-emergency');
    update({rows: rows.map((row) => ({...row, details: {telemetry: {squawk: null, emergency: 'none'}}}))});
    const cleared = screen.getByRole('button', {name: '7700'});
    expect(cleared.className).not.toContain('transmitter-emergency');
    expect(cleared).not.toHaveTextContent('Squawk');
    expect(cleared.querySelector('path[fill]')).toHaveAttribute('fill', '#0288d1');
});

it('keeps a bounded number of rows mounted with thousands of nodes', () => {
    const rows = Array.from({length: 5000}, (_, index) => ({...fixtures[1], id: `mesh:${index}`, name: `NODE-${index}`}));
    const {container} = setup({rows});
    expect(container.querySelectorAll('button[data-id]').length).toBeGreaterThan(0);
    expect(container.querySelectorAll('button[data-id]').length).toBeLessThan(20);
    expect(within(screen.getByRole('list', {name: 'Transmitters'})).getAllByRole('listitem')[0]).toHaveAttribute('aria-setsize', '5000');
});

it('moves keyboard focus between entries and reports loading and empty search results', () => {
    const {update} = setup();
    const first = screen.getByRole('button', {name: 'AEE608'});
    first.focus();
    fireEvent.keyDown(first, {key: 'ArrowDown'});
    expect(screen.getByRole('button', {name: '!2008e299'})).toHaveFocus();
    fireEvent.keyDown(document.activeElement, {key: 'End'});
    expect(screen.getByRole('button', {name: 'V1234567'})).toHaveFocus();
    fireEvent.change(screen.getByRole('textbox', {name: 'Search transmitters'}), {target: {value: 'does-not-exist'}});
    expect(screen.getByText('No transmitters match your search or type filters.')).toBeInTheDocument();
    update({loading: true});
    expect(screen.getByText('Loading transmitters…')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
});

const manyRows = (count = 125) => Array.from({length: count}, (_, index) => ({...fixtures[index % fixtures.length],
    id: `node:${index}`, name: `NODE-${String(index).padStart(3, '0')}`,
    first_seen: new Date(received - index * 1000).toISOString(),
}));
const goToPage = (page) => fireEvent.click(screen.getByRole('button', {name: `Page ${page}`, exact: true}));
const expectPage = (page) => expect(screen.getByRole('button', {name: `Page ${page}`, exact: true})).toHaveAttribute('aria-current', 'page');

it('pages the complete filtered listing and saves the page size across remounts', () => {
    const view = setup({rows: manyRows()});
    expect(screen.getByText('1–100 of 125')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Previous page'})).toBeDisabled();
    fireEvent.click(screen.getByRole('button', {name: 'Next page'}));
    expect(screen.getByText('101–125 of 125')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'NODE-100'})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'NODE-000'})).not.toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Next page'})).toBeDisabled();
    fireEvent.mouseDown(screen.getByRole('combobox', {name: 'Transmitters per page'}));
    fireEvent.click(screen.getByRole('option', {name: '50 / page'}));
    expect(view.store.getState().packetMap.transmitterList.pageSize).toBe(50);
    expect(screen.getByText('1–50 of 125')).toBeInTheDocument();
    goToPage(3);
    expect(screen.getByText('101–125 of 125')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', {name: 'Search transmitters'}), {target: {value: 'NODE-124'}});
    expect(screen.getByText('1–1 of 1')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'NODE-124'})).toBeInTheDocument();
    view.unmount();
    render(view.element({rows: manyRows()}));
    expect(screen.getByRole('combobox', {name: 'Transmitters per page'})).toHaveTextContent('50 / page');
    expectPage(1);
});

it.each(['first_seen', 'last_seen', 'name', 'distance'])('shows new transmitters immediately in %s order without a refresh link', (sort) => {
    const rows = fixtures.slice(1).map((row, index) => ({...row, name: `NODE-${index}`}));
    const {update} = setup({rows}, {excludedTypes: [], sort, pageSize: 100});
    const newRow = {...fixtures[1], id: 'new', name: 'NEW NODE', latitude: 40,
        first_seen: new Date(received + 1000).toISOString(), last_seen: new Date(received + 5000).toISOString()};
    update({rows: [...rows, newRow]});
    const items = within(screen.getByRole('list', {name: 'Transmitters'})).getAllByRole('listitem');
    expect(within(items[0]).getByRole('button', {name: 'NEW NODE'})).toBeInTheDocument();
    expect(screen.getByText('1–4 of 4')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: /new transmitters/i})).not.toBeInTheDocument();
});

it('adds matching arrivals to an empty search result while respecting type filters', () => {
    const {update} = setup({rows: [fixtures[0]]}, {excludedTypes: ['aprs'], sort: 'first_seen', pageSize: 100});
    fireEvent.change(screen.getByRole('textbox', {name: 'Search transmitters'}), {target: {value: 'MESH'}});
    expect(screen.getByText('No transmitters match your search or type filters.')).toBeInTheDocument();
    const newRow = {...fixtures[1], name: 'MESH NODE'};
    const rows = [fixtures[0], newRow, {...fixtures[2], name: 'MESH APRS'}];
    update({rows});
    expect(screen.getByRole('button', {name: 'MESH NODE'})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'MESH APRS'})).not.toBeInTheDocument();
    expect(screen.getByText('1–1 of 1')).toBeInTheDocument();
    // An arrival can replace an expired node without changing the result count.
    update({rows: rows.map((row) => row.id === newRow.id ? {...row, id: 'replacement', name: 'MESH REPLACEMENT'} : row)});
    expect(screen.getByRole('button', {name: 'MESH REPLACEMENT'})).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: 'MESH NODE'})).not.toBeInTheDocument();
});

it('refreshes telemetry in place and includes arrivals without resetting the current page', () => {
    const rows = manyRows();
    const {update} = setup({rows});
    goToPage(2);
    const first = screen.getByRole('button', {name: 'NODE-100'});
    update({rows: rows.map((row) => ({...row, packet_count: 77, first_seen: new Date(received + 5000).toISOString()}))});
    expect(screen.getByRole('button', {name: 'NODE-100'})).toBe(first);
    expect(first).toHaveTextContent('77 packets');
    expectPage(2);
    expect(screen.getByText('101–125 of 125')).toBeInTheDocument();
    const newRow = {...fixtures[1], id: 'new', name: 'NEW NODE', first_seen: new Date(received + 1000).toISOString()};
    update({rows: [newRow, ...rows]});
    expectPage(2);
    expect(screen.getByText('101–126 of 126')).toBeInTheDocument();
    expect(screen.queryByRole('button', {name: /new transmitters/i})).not.toBeInTheDocument();
    goToPage(1);
    expect(screen.getByRole('button', {name: 'NEW NODE'})).toBeInTheDocument();
    expect(screen.getByText('1–100 of 126')).toBeInTheDocument();
    // A sort change starts again at the first page, using the latest measurements.
    goToPage(2);
    fireEvent.mouseDown(screen.getByRole('combobox', {name: 'Sort transmitters'}));
    fireEvent.click(screen.getByRole('option', {name: 'Name', exact: true}));
    expectPage(1);
    expect(screen.getByRole('button', {name: 'NEW NODE'})).toBeInTheDocument();
});

it('reveals explicit map selections across pages and filters without pulling back a manually chosen page', () => {
    const rows = manyRows();
    const {update} = setup({rows});
    update({selectedTransmitterId: 'node:124'});
    expectPage(2);
    expect(screen.getByRole('button', {name: 'NODE-124'})).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', {name: 'Previous page'}));
    update({rows: rows.map((row) => ({...row, packet_count: 88})), selectedTransmitterId: 'node:124'});
    expectPage(1);
    fireEvent.change(screen.getByRole('textbox', {name: 'Search transmitters'}), {target: {value: 'NODE-000'}});
    update({selectedTransmitterId: 'node:123'});
    expect(screen.getByRole('textbox', {name: 'Search transmitters'})).toHaveValue('');
    expect(screen.getByRole('button', {name: 'NODE-123'})).toHaveAttribute('aria-pressed', 'true');
    const arrival = {...fixtures[1], id: 'arrival', name: 'ARRIVAL', first_seen: new Date(received + 2000).toISOString()};
    update({rows: [arrival, ...rows], selectedTransmitterId: 'node:123'});
    expectPage(2);
    expect(screen.getByText('101–126 of 126')).toBeInTheDocument();
    update({rows: [arrival, ...rows], selectedTransmitterId: 'arrival'});
    expectPage(1);
    expect(screen.getByRole('button', {name: 'ARRIVAL'})).toHaveAttribute('aria-pressed', 'true');
});

it('handles page-boundary keyboard navigation and clamps the page when transmitters expire', () => {
    const rows = manyRows();
    const {update} = setup({rows});
    const first = screen.getByRole('button', {name: 'NODE-000'});
    first.focus();
    fireEvent.keyDown(first, {key: 'End'});
    expectPage(2);
    expect(screen.getByRole('button', {name: 'NODE-124'})).toHaveFocus();
    fireEvent.keyDown(document.activeElement, {key: 'Home'});
    expectPage(1);
    expect(screen.getByRole('button', {name: 'NODE-000'})).toHaveFocus();
    goToPage(2);
    const boundary = screen.getByRole('button', {name: 'NODE-100'});
    boundary.focus();
    fireEvent.keyDown(boundary, {key: 'ArrowUp'});
    expectPage(1);
    expect(screen.getByRole('button', {name: 'NODE-099'})).toHaveFocus();
    fireEvent.keyDown(document.activeElement, {key: 'ArrowDown'});
    expect(screen.getByRole('button', {name: 'NODE-100'})).toHaveFocus();
    update({rows: rows.slice(0, 40)});
    expectPage(1);
    expect(screen.getByText('1–40 of 40')).toBeInTheDocument();
    update({rows: []});
    expect(screen.getByText('0–0 of 0')).toBeInTheDocument();
    expect(screen.getByRole('button', {name: 'Next page'})).toBeDisabled();
});
