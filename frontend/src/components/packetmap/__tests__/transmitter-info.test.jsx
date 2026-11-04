import React from 'react';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {createTheme, ThemeProvider} from '@mui/material/styles';
import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import TransmitterInfo from '../transmitter-info.jsx';
import {aircraftUnitsStoreName} from '../storage.js';
import AircraftFolderDialog from '../../filebrowser/aircraft-folder-dialog.jsx';
import {toast} from 'react-toastify';

await i18n.use(initReactI18next).init({lng: 'en', resources: {}});
vi.mock('../../common/common.jsx', () => ({
    TitleBar: ({children}) => <div>{children}</div>, islandTitleBarCompactSx: {},
    getClassNamesBasedOnGridEditing: () => '',
}));
vi.mock('../../filebrowser/aircraft-folder-dialog.jsx', () => ({
    default: vi.fn(({folder, onClose}) => <div role="dialog" aria-label={folder.icao}>
        <button onClick={onClose}>Close aircraft folder</button>
    </div>),
}));
vi.mock('react-toastify', () => ({toast: {error: vi.fn()}}));

const transmitter = {
    id: 'radiosonde:RS41:TEST', name: 'TEST', kind: 'radiosonde', source: 'Receiver A', packet_count: 42,
    latitude: 40.123456, longitude: 22.654321, altitude: 0,
    first_seen: '2026-11-01T01:00:00Z', last_seen: '2026-11-01T02:00:00Z', captured_at: '2026-11-01T02:00:00Z',
    file_id: 'decoded:latest.bin',
    details: {
        telemetry: {temp: 0, encrypted: false, sats: 12},
        signal: {frequency_hz: 403500000}, decoder: {type: 'radiosonde'},
        additional: {custom: {calibration: 'complete'}, channels: ['A', 'B']},
    },
    field_info: {temp: {label: 'Temperature', unit: '°C'}, encrypted: {label: 'Encrypted payload'}, sats: {label: 'GPS satellites'}},
};

function wrapper({children}) {
    const store = configureStore({reducer: () => ({preferences: {preferences: [
        {name: 'timezone', value: 'Europe/Athens'}, {name: 'locale', value: 'en-GB'},
    ]}})});
    return <Provider store={store}><ThemeProvider theme={createTheme()}>{children}</ThemeProvider></Provider>;
}

describe('Transmitter information', () => {
    beforeEach(() => {localStorage.clear(); vi.clearAllMocks();});

    it('opens aircraft captures only on demand and keeps the dialog independent of live fixes', async () => {
        const aircraft = {...transmitter, id: 'adsb:4d2406', kind: 'adsb', source: '4D2406'};
        const folder = {id: 'decoded_folder:adsb_4d2406', icao: '4d2406'};
        const socket = {connected: true, timeout: vi.fn(() => socket), emit: vi.fn()};
        const element = (next) => <TransmitterInfo transmitter={next} socket={socket} />;
        const {rerender} = render(element(aircraft), {wrapper});
        expect(socket.emit).not.toHaveBeenCalled();
        expect(AircraftFolderDialog).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', {name: 'Open aircraft captures'}));
        expect(socket.emit).toHaveBeenCalledExactlyOnceWith('api.call', {
            cmd: 'filebrowser.item', data: {id: folder.id},
        }, expect.any(Function));
        expect(screen.getByRole('button', {name: 'Open aircraft captures'})).toBeDisabled();
        await act(async () => socket.emit.mock.calls[0][2](null, {success: true, data: folder}));
        const dialog = screen.getByRole('dialog', {name: '4d2406'});
        const renders = AircraftFolderDialog.mock.calls.length;
        rerender(element({...aircraft, latitude: 42, packet_count: 43}));
        expect(screen.getByRole('dialog', {name: '4d2406'})).toBe(dialog);
        expect(AircraftFolderDialog).toHaveBeenCalledTimes(renders);
        expect(socket.emit).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByRole('button', {name: 'Close aircraft folder'}));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        rerender(element(transmitter));
        expect(screen.queryByRole('button', {name: 'Open aircraft captures'})).not.toBeInTheDocument();
    });

    it('ignores a pending aircraft folder after switching selection and reports missing captures', async () => {
        const aircraft = {...transmitter, kind: 'adsb', source: '4D2406'};
        const socket = {connected: true, timeout: vi.fn(() => socket), emit: vi.fn()};
        const {rerender} = render(<TransmitterInfo transmitter={aircraft} socket={socket} />, {wrapper});
        fireEvent.click(screen.getByRole('button', {name: 'Open aircraft captures'}));
        rerender(<TransmitterInfo transmitter={{...aircraft, source: '40621D'}} socket={socket} />);
        await act(async () => socket.emit.mock.calls[0][2](null, {success: true,
            data: {id: 'decoded_folder:adsb_4d2406', icao: '4d2406'}}));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: 'Open aircraft captures'}));
        await act(async () => socket.emit.mock.calls[1][2](null, {success: false, error: 'Library item not found'}));
        expect(toast.error).toHaveBeenCalledWith('Library item not found');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Open aircraft captures'})).toBeEnabled();
    });

    it('shows four cockpit instruments with aviation conversions and remembers the metric choice', () => {
        const aircraft = {...transmitter, kind: 'adsb', source: '4D2406', details: {telemetry: {
            altitude_baro_m: 10972.8, altitude_geom_m: 11064, groundspeed_mps: 102.88888888,
            vertical_rate_mps: 6.35, track_deg: 326, squawk: '0042', on_ground: false,
        }}};
        const {unmount} = render(<TransmitterInfo transmitter={aircraft} />, {wrapper});
        const instruments = () => within(screen.getByRole('region', {name: 'Flight instruments'}));
        expect(instruments().getByRole('region', {name: 'Ground speed'})).toHaveTextContent('200kt');
        expect(instruments().getByRole('region', {name: 'Baro altitude'})).toHaveTextContent('36,000ft');
        expect(instruments().getByRole('region', {name: 'Ground track'})).toHaveTextContent('326°');
        expect(instruments().getByRole('region', {name: 'Vertical speed'})).toHaveTextContent('+1,250ft/min');
        expect(instruments().getByText('0042')).toBeInTheDocument();
        expect(screen.getByRole('region', {name: 'Latest position'})).not.toHaveTextContent('Altitude (m)');
        fireEvent.click(screen.getByRole('button', {name: 'Use metric units'}));
        expect(instruments().getByRole('region', {name: 'Ground speed'})).toHaveTextContent('102.9m/s');
        expect(instruments().getByRole('region', {name: 'Baro altitude'})).toHaveTextContent('10,973m');
        expect(instruments().getByRole('region', {name: 'Vertical speed'})).toHaveTextContent('+6.4m/s');
        expect(JSON.parse(localStorage.getItem(aircraftUnitsStoreName))).toBe('metric');
        unmount();
        render(<TransmitterInfo transmitter={aircraft} />, {wrapper});
        expect(instruments().getByRole('region', {name: 'Ground speed'})).toHaveTextContent('102.9m/s');
    });

    it('preserves zero readings, shows reported ground status and leaves missing instruments empty', () => {
        const aircraft = {...transmitter, kind: 'adsb', details: {telemetry: {groundspeed_mps: 0,
            vertical_rate_mps: 0, altitude_geom_m: 0, track_deg: 0, on_ground: true}}};
        const {rerender, container} = render(<TransmitterInfo transmitter={aircraft} />, {wrapper});
        expect(screen.getByRole('region', {name: 'Ground speed'})).toHaveTextContent('0kt');
        expect(screen.getByRole('region', {name: 'Altitude'})).toHaveTextContent('GND');
        expect(screen.getByRole('region', {name: 'Ground track'})).toHaveTextContent('000°');
        expect(within(screen.getByRole('region', {name: 'Flight instruments'})).getByText('Geometric altitude')).toBeInTheDocument();
        rerender(<TransmitterInfo transmitter={{...aircraft, altitude: null, details: {}}} />);
        expect(screen.getByRole('region', {name: 'Ground speed'})).toHaveTextContent('—');
        expect(screen.getByRole('region', {name: 'Vertical speed'})).toHaveTextContent('—');
        expect(screen.getByRole('region', {name: 'Ground track'})).toHaveTextContent('—');
        expect(container.querySelector('.flight-compass-pointer')).toBeNull();
        expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    });

    it('explains reported emergencies, colors the header icon and removes cleared alerts', () => {
        const aircraft = {...transmitter, kind: 'adsb', details: {telemetry: {squawk: '7700', emergency: 'general'}}};
        const {container, rerender} = render(<TransmitterInfo transmitter={aircraft} />, {wrapper});
        expect(screen.getByRole('alert')).toHaveTextContent('Reported emergency / priority · 7700');
        expect(screen.getByRole('alert')).toHaveTextContent('General emergency');
        expect(container.querySelector('[data-aircraft-shape] path[fill]')).toHaveAttribute('fill', '#ef5350');
        rerender(<TransmitterInfo transmitter={{...aircraft, details: {telemetry: {emergency: 'minfuel'}}}} />);
        expect(screen.getByRole('alert')).toHaveTextContent('Minimum fuel');
        expect(screen.getByRole('alert')).toHaveClass('MuiAlert-colorWarning');
        expect(container.querySelector('[data-aircraft-shape] path[fill]')).toHaveAttribute('fill', '#ffb300');
        rerender(<TransmitterInfo transmitter={{...aircraft, details: {telemetry: {squawk: '7000', emergency: 'none'}}}} />);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        rerender(<TransmitterInfo transmitter={{...transmitter, details: aircraft.details}} />);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('shows aircraft specifications and inferred operator details for saved map records', () => {
        const aircraft = {...transmitter, kind: 'adsb', source: '40621D', details: {telemetry: {aircraft: {
            registration: 'G-TEST', type_code: 'C172', aircraft_class: 'L', engine_type: 'P', engine_count: 1,
            military_status: 'unclassified', operator_name: 'Easyjet Uk', operator_source: 'callsign_prefix',
            database: {version: 529},
        }}}};
        render(<TransmitterInfo transmitter={aircraft} />, {wrapper});
        const details = within(screen.getByRole('region', {name: 'Aircraft details'}));
        expect(details.getByText('G-TEST')).toBeInTheDocument();
        expect(details.getByText('Aircraft class').parentElement).toHaveTextContent('Landplane');
        expect(details.getByText('Piston')).toBeInTheDocument();
        expect(details.getByText('Classification').parentElement).toHaveTextContent('Landplane');
        expect(details.getByText('Easyjet Uk')).toBeInTheDocument();
        expect(details.queryByRole('link', {name: 'ODC Attribution License'})).not.toBeInTheDocument();
        expect(screen.queryByText('Aircraft · Operator Name')).not.toBeInTheDocument();
    });

    it('derives aircraft registration country from saved ICAO addresses without stored enrichment', () => {
        const aircraft = {...transmitter, id: 'adsb:4d2406', kind: 'adsb', source: '4D2406', name: 'EWG46A', details: {}};
        const {rerender} = render(<TransmitterInfo transmitter={aircraft} />, {wrapper});
        expect(screen.getByRole('img', {name: 'ICAO registration country: Malta'})).toHaveTextContent('🇲🇹');
        const reception = within(screen.getByRole('region', {name: 'Reception'}));
        expect(reception.getByText('ICAO registration country')).toBeInTheDocument();
        expect(reception.getByText('Malta')).toBeInTheDocument();
        rerender(<TransmitterInfo transmitter={{...aircraft, source: 'FFFFFF'}} />);
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
        expect(screen.queryByText('ICAO registration country')).not.toBeInTheDocument();
        // A hex-like source from another protocol must never acquire an aircraft flag.
        rerender(<TransmitterInfo transmitter={{...transmitter, source: '4D2406'}} />);
        expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('shows every decoded field, metadata, labels and units without losing zero or false values', () => {
        render(<TransmitterInfo transmitter={transmitter} selectedTransmitterId={transmitter.id} />, {wrapper});
        const info = screen.getByRole('region', {name: 'Transmitter info'});
        expect(screen.getByRole('region', {name: 'Flight instruments'})).toBeInTheDocument();
        expect(info).toHaveTextContent('TEST');
        expect(info).toHaveTextContent('radiosonde:RS41:TEST');
        expect(info).toHaveTextContent('Radiosonde');
        const position = within(screen.getByRole('region', {name: 'Latest position'}));
        expect(position.getByText('40.123456')).toBeInTheDocument();
        expect(screen.getByRole('region', {name: 'Altitude'})).toHaveTextContent('0m');
        const reception = screen.getByRole('region', {name: 'Reception'});
        expect(reception).toHaveTextContent('Receiver A');
        expect(reception).toHaveTextContent('42');
        expect(reception).toHaveTextContent('01/11/2026, 03:00:00');
        expect(reception).toHaveTextContent('decoded:latest.bin');
        const telemetry = within(screen.getByRole('region', {name: 'Telemetry'}));
        expect(telemetry.getByText('Temperature (°C)')).toBeInTheDocument();
        expect(telemetry.getByText('0')).toBeInTheDocument();
        expect(telemetry.getByText('false')).toBeInTheDocument();
        expect(telemetry.getByText('GPS satellites')).toBeInTheDocument();
        expect(screen.getByRole('region', {name: 'Signal'})).toHaveTextContent('403500000');
        expect(screen.getByRole('region', {name: 'Decoder'})).toHaveTextContent('radiosonde');
        const additional = screen.getByRole('region', {name: 'Additional data'});
        expect(additional).toHaveTextContent('Custom · Calibration');
        expect(additional).toHaveTextContent('complete');
        expect(additional).toHaveTextContent('["A","B"]');
    });

    it('gives radiosondes metric flight gauges and visible environmental telemetry without duplicate flight fields', () => {
        const sonde = {...transmitter, altitude: 24560, details: {telemetry: {
            alt: 24560, vel_h: 12.5, vel_v: 5.2, heading: 80, temp: -48, humidity: 22,
        }}};
        const playbackTime = Date.parse(sonde.captured_at);
        const {container, rerender} = render(<TransmitterInfo transmitter={sonde} isLive playbackTime={playbackTime} />, {wrapper});
        const gauges = within(screen.getByRole('region', {name: 'Flight instruments'}));
        expect(gauges.getByRole('region', {name: 'Horizontal speed'})).toHaveTextContent('12.5m/s');
        expect(gauges.getByRole('region', {name: 'Altitude'})).toHaveTextContent('24,560m');
        expect(gauges.getByRole('region', {name: 'Altitude'})).toHaveTextContent('Reported altitude');
        expect(gauges.getByRole('region', {name: 'Heading'})).toHaveTextContent('080°');
        expect(gauges.getByRole('region', {name: 'Vertical speed'})).toHaveTextContent('+5.2m/s');
        expect(gauges.getByText('Climbing')).toBeInTheDocument();
        expect(gauges.queryByText('Squawk')).not.toBeInTheDocument();
        expect(screen.queryByRole('region', {name: 'Aircraft details'})).not.toBeInTheDocument();
        expect(container.querySelector('img[alt=""]')).toHaveAttribute('src', expect.stringContaining('balloon.png'));
        const telemetry = screen.getByRole('region', {name: 'Telemetry'});
        expect(telemetry).toHaveTextContent('-48');
        expect(telemetry).toHaveTextContent('22');
        expect(telemetry).not.toHaveTextContent('Vel H');
        expect(telemetry).not.toHaveTextContent('24560');
        expect(telemetry.closest('details')).toBeNull();
        expect(screen.getByRole('region', {name: 'Latest position'})).not.toHaveTextContent('Altitude');
        fireEvent.click(gauges.getByRole('button', {name: 'Use aviation units'}));
        expect(gauges.getByRole('region', {name: 'Horizontal speed'})).toHaveTextContent('24kt');
        expect(gauges.getByRole('region', {name: 'Vertical speed'})).toHaveTextContent('+1,024ft/min');
        expect(within(gauges.getByRole('region', {name: 'Vertical speed'})).getByText('+0.5k')).toBeInTheDocument();
        rerender(<TransmitterInfo transmitter={{...sonde, details: {telemetry: {vel_v: -8}}}} isLive playbackTime={playbackTime} />);
        expect(screen.getByRole('region', {name: 'Flight instruments'})).toHaveTextContent('Descending');
        expect(container.querySelector('img[alt=""]')).toHaveAttribute('src', expect.stringContaining('parachute.png'));
    });

    it('preserves radiosonde zero readings, shows missing gauges honestly and honors a saved unit preference', () => {
        localStorage.setItem(aircraftUnitsStoreName, JSON.stringify('aviation'));
        const sonde = {...transmitter, details: {telemetry: {vel_h: 0, vel_v: 0, heading: 0}}};
        const {rerender, container} = render(<TransmitterInfo transmitter={sonde} />, {wrapper});
        expect(screen.getByRole('region', {name: 'Horizontal speed'})).toHaveTextContent('0kt');
        expect(screen.getByRole('region', {name: 'Vertical speed'})).toHaveTextContent('0ft/min');
        expect(screen.getByRole('region', {name: 'Heading'})).toHaveTextContent('000°');
        expect(screen.getByRole('region', {name: 'Altitude'})).toHaveTextContent('0ft');
        expect(screen.getByRole('region', {name: 'Flight instruments'})).toHaveTextContent('Level flight');
        rerender(<TransmitterInfo transmitter={{...sonde, altitude: null, details: {}}} />);
        for (const name of ['Horizontal speed', 'Altitude', 'Heading', 'Vertical speed']) {
            expect(screen.getByRole('region', {name})).toHaveTextContent('—');
        }
        expect(container.querySelector('.flight-compass-pointer')).toBeNull();
        expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    });

    it('initializes the appropriate units when switching between aircraft and radiosondes, and leaves APRS unchanged', () => {
        const {rerender} = render(<TransmitterInfo transmitter={{...transmitter, kind: 'adsb'}} />, {wrapper});
        expect(screen.getByRole('button', {name: 'Use metric units'})).toBeInTheDocument();
        rerender(<TransmitterInfo transmitter={transmitter} />);
        expect(screen.getByRole('button', {name: 'Use aviation units'})).toBeInTheDocument();
        rerender(<TransmitterInfo transmitter={{...transmitter, kind: 'aprs'}} />);
        expect(screen.queryByRole('region', {name: 'Flight instruments'})).not.toBeInTheDocument();
        expect(screen.getByRole('region', {name: 'Latest position'})).toHaveTextContent('Altitude (m)');
    });

    it('updates the selected data and clears it while another window is loading or empty', () => {
        const onClearSelection = vi.fn();
        const {rerender} = render(<TransmitterInfo transmitter={transmitter} selectedTransmitterId={transmitter.id}
            onClearSelection={onClearSelection} />, {wrapper});
        const updated = {...transmitter, name: 'UPDATED', details: {telemetry: {temp: -12}}, field_info: transmitter.field_info};
        rerender(<TransmitterInfo transmitter={updated} selectedTransmitterId={updated.id} onClearSelection={onClearSelection} />);
        expect(screen.getByText('UPDATED')).toBeInTheDocument();
        expect(screen.getByText('-12')).toBeInTheDocument();
        expect(screen.queryByText('GPS satellites')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: 'Clear transmitter selection'}));
        expect(onClearSelection).toHaveBeenCalledOnce();
        rerender(<TransmitterInfo selectedTransmitterId={transmitter.id} loading />);
        expect(screen.getByRole('progressbar')).toBeInTheDocument();
        expect(screen.queryByText('UPDATED')).not.toBeInTheDocument();
        rerender(<TransmitterInfo selectedTransmitterId={transmitter.id} loading={false} />);
        expect(screen.getByText('No packets for the selected transmitter in this date range.')).toBeInTheDocument();
        rerender(<TransmitterInfo selectedTransmitterId={null} />);
        expect(screen.getByText('Select a transmitter on the map or in the list to view its information.')).toBeInTheDocument();
    });
});
