import React from 'react';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {createTheme, ThemeProvider} from '@mui/material/styles';
import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import navigation from '../../../i18n/locales/en/navigation.json';
import TransmitterInfo from '../transmitter-info.jsx';

await i18n.use(initReactI18next).init({lng: 'en', resources: {en: {navigation}}});
vi.mock('../../common/common.jsx', () => ({
    TitleBar: ({children}) => <div>{children}</div>, islandTitleBarCompactSx: {},
    getClassNamesBasedOnGridEditing: () => '',
}));

const station = {
    id: 'aprs:SV2ABC-9', name: 'SV2ABC-9', kind: 'aprs', source: 'SV2ABC-9',
    latitude: 40, longitude: 23, altitude: 0, packet_count: 12, file_id: 'decoded:aprs.bin',
    captured_at: '2026-11-03T10:00:00Z', last_seen: '2026-11-03T10:00:00Z', first_seen: '2026-11-03T09:00:00Z',
    details: {
        telemetry: {data_type: 'position_without_timestamp', data_type_identifier: '!',
            position: {symbol_table: '/', symbol_code: '>', speed_knots: 10, course_degrees: 0},
            comment: '<b>Mobile near Thessaloniki</b>', raw: 'Unabridged APRS packet'},
        frame: {source: 'SV2ABC-9', destination: 'APTEST', repeaters: ['WIDE1-1', 'WIDE2-1']},
        signal: {signal_power_dbfs: 0, snr_db: 7.5, frequency_hz: 144800000},
        vfo: {bandwidth_hz: 15000},
        additional: {enabled: false, custom: 'Unknown parser field'},
    },
};

function setup(transmitter = station, props = {}, receiver = {lat: 40, lon: 23}) {
    const store = configureStore({reducer: () => ({location: {location: receiver},
        preferences: {preferences: [{name: 'timezone', value: 'UTC'}, {name: 'locale', value: 'en-GB'}]},
    })});
    const onClearSelection = vi.fn();
    const element = (next, nextProps = props) => <Provider store={store}><ThemeProvider theme={createTheme()}>
        <TransmitterInfo transmitter={next} selectedTransmitterId={next.id} onClearSelection={onClearSelection} {...nextProps} />
    </ThemeProvider></Provider>;
    const view = render(element(transmitter));
    return {...view, onClearSelection, update: (next, nextProps) => view.rerender(element(next, nextProps))};
}

it('gives mobile stations their map artwork, metric readings and an advertised AX.25 path', () => {
    const {container, onClearSelection} = setup();
    expect(screen.getByRole('heading', {name: 'SV2ABC-9'})).toBeInTheDocument();
    expect(screen.getByText('Car')).toBeInTheDocument();
    expect(container.querySelector('.aprs-station-icon img').src).toContain('mobile.png');
    expect(screen.getByText('Received · 03/11/2026, 10:00:00')).toBeInTheDocument();
    expect(screen.getByText('Latest position report')).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Speed'})).toHaveTextContent('18.5km/h');
    expect(screen.getByRole('region', {name: 'Course'})).toHaveTextContent('0°N');
    expect(screen.getByRole('region', {name: 'Altitude'})).toHaveTextContent('0m');
    expect(screen.getByRole('region', {name: 'Distance'})).toHaveTextContent('0km');
    const radio = screen.getByRole('region', {name: 'Radio & path'});
    expect(radio).toHaveTextContent('144.8 MHz');
    expect(radio).toHaveTextContent('0 dBFS');
    expect(radio).toHaveTextContent('7.5 dB');
    expect(radio).toHaveTextContent('15 kHz');
    expect(radio).toHaveTextContent('APTEST');
    expect(radio).toHaveTextContent('Advertised pathWIDE1-1 → WIDE2-1');
    expect(screen.queryByText('Unabridged APRS packet')).not.toBeInTheDocument();
    const comment = screen.getByRole('region', {name: 'Comment'});
    expect(comment).toHaveTextContent('<b>Mobile near Thessaloniki</b>');
    expect(comment.querySelector('b')).toBeNull();
    fireEvent.click(screen.getByRole('button', {name: 'Clear transmitter selection'}));
    expect(onClearSelection).toHaveBeenCalledOnce();
});

it('preserves stopped movement, north headings and zero reception measurements', () => {
    setup({...station, details: {...station.details, telemetry: {
        position: {speed_knots: 0, course_degrees: 360},
    }}});
    expect(screen.getByRole('region', {name: 'Speed'})).toHaveTextContent('0km/h');
    expect(screen.getByRole('region', {name: 'Course'})).toHaveTextContent('0°N');
    expect(screen.queryByRole('region', {name: 'Position reports'})).not.toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Radio & path'})).toHaveTextContent('0 dBFS');
});

it('adapts weather reports and converts Fahrenheit, mph and inches without losing zero readings', () => {
    setup({...station, details: {...station.details, telemetry: {weather: {
        temperature_fahrenheit: 32, humidity_percent: 0, pressure_mbar: 1013.2,
        wind_speed_mph: 10, wind_direction_degrees: 270, wind_gust_mph: 20,
        rain_last_hour_inches: 0, rain_last_24_hours_inches: 1, rain_since_midnight_inches: 0.1,
    }}}});
    expect(screen.getByText('Weather station')).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Temperature'})).toHaveTextContent('0°C');
    expect(screen.getByRole('region', {name: 'Humidity'})).toHaveTextContent('0%');
    expect(screen.getByRole('region', {name: 'Pressure'})).toHaveTextContent('1,013.2hPa');
    expect(screen.getByRole('region', {name: 'Wind'})).toHaveTextContent('16.1km/h270° W');
    const weather = screen.getByRole('region', {name: 'Weather'});
    expect(weather).toHaveTextContent('32.2 km/h');
    expect(weather).toHaveTextContent('Rain · last hour0 mm');
    expect(weather).toHaveTextContent('Rain · last 24 hours25.4 mm');
    expect(weather).toHaveTextContent('Rain · since midnight2.5 mm');
    expect(screen.queryByRole('region', {name: 'Speed'})).not.toBeInTheDocument();
});

it('omits unavailable metrics and weather sections without inventing motion, signal or a direct route', () => {
    const {container, update} = setup({...station, altitude: null, latitude: null, longitude: null,
        captured_at: null, packet_count: null, details: {}}, {isLive: true}, null);
    expect(screen.queryByRole('group', {name: 'Station overview'})).not.toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Radio & path'})).toHaveTextContent('SourceSV2ABC-9');
    expect(screen.queryByText('Advertised path')).not.toBeInTheDocument();
    expect(screen.queryByText('Receiver frequency')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', {name: 'Latest position'})).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN|Infinity|Online|Direct|undefined/);
    update({...station, altitude: null, details: {telemetry: {
        position: {speed_knots: -1, course_degrees: 400}, weather: {humidity_percent: 0},
    }}});
    expect(screen.getByRole('region', {name: 'Humidity'})).toHaveTextContent('0%');
    expect(screen.queryByRole('region', {name: 'Wind'})).not.toBeInTheDocument();
    expect(screen.queryByRole('region', {name: 'Weather'})).not.toBeInTheDocument();
    expect(screen.queryByRole('region', {name: 'Distance'})).not.toBeInTheDocument();
});

it('distinguishes objects from their reporting station and retains APRS symbol overlays', () => {
    const {container, update} = setup({...station, name: 'TESTOBJ', id: 'aprs:SV2ABC-9:TESTOBJ', details: {
        telemetry: {object: {name: 'TESTOBJ', alive: false}, position: {symbol_table: 'B', symbol_code: 'O'}},
        frame: {source: 'SV2ABC-9'},
    }});
    expect(screen.getByRole('heading', {name: 'TESTOBJ'})).toBeInTheDocument();
    expect(screen.getByText('Balloon · Reported by SV2ABC-9')).toBeInTheDocument();
    expect(screen.getByText('Object removed')).toBeInTheDocument();
    expect(container.querySelector('.aprs-station-icon img').src).toContain('balloon.png');
    expect(container.querySelector('.aprs-symbol-overlay')).toHaveTextContent('B');
    update({...station, details: {telemetry: {item: {name: 'AID', alive: true}}}});
    expect(screen.getByRole('heading', {name: 'AID'})).toBeInTheDocument();
    expect(screen.getByText('Object active')).toBeInTheDocument();
    expect(container.querySelector('.aprs-symbol-overlay')).toBeNull();
});

it('presents raw telemetry channels and digital states without guessing calibration or engineering units', () => {
    setup({...station, details: {telemetry: {telemetry: {sequence: 0, channels: [0, 255, 1.25], digital_bits: '10100000'}}}});
    const section = screen.getByRole('region', {name: 'Telemetry channels'});
    expect(section).toHaveTextContent('Sequence0');
    expect(section).toHaveTextContent('Channel 1 (raw)0');
    expect(section).toHaveTextContent('Channel 2 (raw)255');
    expect(section).toHaveTextContent('Channel 3 (raw)1.25');
    const digital = within(section).getByRole('group', {name: 'Digital bits'});
    expect(digital.children).toHaveLength(8);
    expect(digital).toHaveTextContent('Bit 1: 1');
    expect(digital).toHaveTextContent('Bit 2: 0');
    expect(digital.querySelectorAll('.aprs-bit-set')).toHaveLength(2);
    expect(section).not.toHaveTextContent(/voltage|temperature|%/i);
});

it('preserves message text, recipients and acknowledgements when provided by a report', () => {
    setup({...station, details: {telemetry: {status: 'Operational', message: {
        text: '<img src=x onerror=alert(1)>', addressee: 'SV2XYZ', id: '123', response: 'ack', response_id: '122',
    }}}});
    expect(screen.getByRole('region', {name: 'Status'})).toHaveTextContent('Operational');
    const message = screen.getByRole('region', {name: 'Message'});
    expect(message).toHaveTextContent('<img src=x onerror=alert(1)>');
    expect(message.querySelector('img')).toBeNull();
    expect(message).toHaveTextContent('AddresseeSV2XYZ');
    expect(message).toHaveTextContent('Responseack');
    expect(message).toHaveTextContent('Response ID122');
});

it('defers unknown packet details, preserves false values and resets disclosure on station selection', async () => {
    const read = vi.fn(() => 'Retained custom value');
    const additional = {enabled: false};
    Object.defineProperty(additional, 'nested', {enumerable: true, get: read});
    const transmitter = {...station, details: {...station.details, additional}};
    const {container, update} = setup(transmitter);
    expect(read).not.toHaveBeenCalled();
    update(transmitter, {isLive: true, playbackTime: Date.parse(station.captured_at) + 1000});
    expect(read).not.toHaveBeenCalled();
    const disclosure = container.querySelector('details');
    await act(async () => {disclosure.open = true; fireEvent(disclosure, new Event('toggle'));});
    expect(read).toHaveBeenCalledOnce();
    expect(screen.getByRole('region', {name: 'Additional data'})).toHaveTextContent('false');
    expect(screen.getByText('Retained custom value')).toBeInTheDocument();
    expect(screen.getByText('Unabridged APRS packet')).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Reception'})).toHaveTextContent('decoded:aprs.bin');
    update(transmitter, {isLive: true, playbackTime: Date.parse(station.captured_at) + 2000});
    expect(read).toHaveBeenCalledOnce();
    update({...station, id: 'aprs:NEW', name: 'NEW', details: {}});
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    expect(screen.queryByText('Retained custom value')).not.toBeInTheDocument();
});

it('labels latest report data consistently in playback and only shows relative reception ages in live mode', () => {
    const {update} = setup(station, {playbackTime: Date.parse('2026-11-02T10:00:00Z')});
    expect(screen.getByText('Latest position report')).toBeInTheDocument();
    expect(screen.getByText('Received · 03/11/2026, 10:00:00')).toBeInTheDocument();
    expect(screen.queryByText(/ago/)).not.toBeInTheDocument();
    update(station, {isLive: true, playbackTime: Date.parse(station.captured_at) + 24000});
    const received = screen.getByText('Received · 24 seconds ago');
    expect(received).toHaveAttribute('title', '03/11/2026, 10:00:00');
    update({...station, details: {telemetry: {position: {symbol_table: '/', symbol_code: '-'}}}}, {isLive: false});
    expect(screen.queryByRole('region', {name: 'Speed'})).not.toBeInTheDocument();
    expect(screen.getByText('House')).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Position reports'})).toHaveTextContent('12');
});
