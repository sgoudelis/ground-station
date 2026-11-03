import React from 'react';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {createTheme, ThemeProvider} from '@mui/material/styles';
import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import TransmitterInfo from '../transmitter-info.jsx';

await i18n.use(initReactI18next).init({lng: 'en', resources: {}});
vi.mock('../../common/common.jsx', () => ({
    TitleBar: ({children}) => <div>{children}</div>, islandTitleBarCompactSx: {},
    getClassNamesBasedOnGridEditing: () => '',
}));

const node = {
    id: 'meshtastic:!2008e299', name: '!2008e299', kind: 'meshtastic', source: '!2008e299',
    latitude: 40, longitude: 23, altitude: 0, packet_count: 12, file_id: 'decoded:mesh.bin',
    captured_at: '2026-11-03T10:00:00Z', last_seen: '2026-11-03T10:00:00Z', first_seen: '2026-11-03T09:00:00Z',
    details: {
        telemetry: {long_name: 'Hilltop relay', short_name: 'HILL', application: 'Position',
            sats_in_view: 0, HDOP: 1.23, ground_speed: 0, ground_track: 0, gps_accuracy: 1500, precision_bits: 32,
            hop_limit: 1, hop_start: 3, channel_hash: '0x08', destination: 'Broadcast', relay_node: '0x52',
            next_hop: '0x17', encryption: 'Public default key', via_mqtt: true,
            battery_level: 0, voltage: 3.2, uptime_seconds: 90061, channel_utilization: 0, air_util_tx: 1.5,
            temperature: 0, relative_humidity: 45, barometric_pressure: 1013.2},
        signal: {signal_power_dbfs: -32.5, snr_db: 7.5, frequency_hz: 869525000},
        vfo: {bandwidth_hz: 250000},
        additional: {custom: 'Unknown decoder field'},
    },
};

function setup(transmitter = node) {
    const store = configureStore({reducer: () => ({location: {location: {lat: 40, lon: 23}},
        preferences: {preferences: [{name: 'timezone', value: 'UTC'}, {name: 'locale', value: 'en-GB'}]},
    })});
    const onClearSelection = vi.fn();
    const element = (next, props) => <Provider store={store}><ThemeProvider theme={createTheme()}>
        <TransmitterInfo transmitter={next} selectedTransmitterId={next.id} onClearSelection={onClearSelection} {...props} />
    </ThemeProvider></Provider>;
    const view = render(element(transmitter));
    return {...view, onClearSelection, update: (next, props) => view.rerender(element(next, props))};
}

it('shows Meshtastic identity, receiver measurements, position and a bounded packet hop budget', () => {
    const {container, onClearSelection} = setup();
    expect(screen.getByRole('heading', {name: 'Hilltop relay'})).toBeInTheDocument();
    expect(screen.getByText('HILL · !2008e299')).toBeInTheDocument();
    expect(screen.getByText('Last heard · 03/11/2026, 10:00:00')).toBeInTheDocument();
    expect(screen.queryByRole('region', {name: 'Flight instruments'})).not.toBeInTheDocument();
    const signal = screen.getByRole('region', {name: 'Received signal'});
    expect(signal).toHaveTextContent('-32.5dBFS');
    expect(signal).toHaveTextContent('Receiver · SNR 7.5 dB');
    expect(screen.getByRole('region', {name: 'GPS satellites'})).toHaveTextContent('0');
    expect(screen.getByRole('region', {name: 'Distance'})).toHaveTextContent('0km');
    expect(screen.getByRole('region', {name: 'Remaining hops'})).toHaveTextContent('1');
    const position = screen.getByRole('region', {name: 'Position'});
    expect(position).toHaveTextContent('0 m');
    expect(position).toHaveTextContent('0 km/h');
    expect(position).toHaveTextContent('1.5 m');
    const radio = screen.getByRole('region', {name: 'Radio & routing'});
    expect(radio).toHaveTextContent('869.525 MHz');
    expect(radio).toHaveTextContent('250 kHz');
    expect(radio).toHaveTextContent('Public default key');
    expect(radio).toHaveTextContent('MQTT');
    const budget = screen.getByRole('img', {name: '3 initial · 1 remaining'});
    expect(budget.children).toHaveLength(3);
    expect(container.querySelectorAll('.mesh-hop-remaining')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', {name: 'Clear transmitter selection'}));
    expect(onClearSelection).toHaveBeenCalledOnce();
});

it('preserves zero health readings and replaces old metrics when another report is selected', () => {
    const {update} = setup();
    expect(screen.getByRole('meter', {name: 'Battery'})).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByRole('meter', {name: 'Channel utilization'})).toHaveAttribute('aria-valuenow', '0');
    expect(screen.getByRole('meter', {name: 'Transmit airtime'})).toHaveAttribute('aria-valuenow', '1.5');
    const health = screen.getByRole('region', {name: 'Device health'});
    expect(health).toHaveTextContent('3.2 V');
    expect(health).toHaveTextContent('1 d 1 h 1 min');
    expect(health).toHaveTextContent('0 °C');
    update({...node, details: {telemetry: {battery_level: 101, voltage: 4.1, uptime_seconds: 0}}});
    expect(screen.queryByRole('meter', {name: 'Battery'})).not.toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Device health'})).toHaveTextContent('External power');
    expect(screen.getByRole('region', {name: 'Device health'})).toHaveTextContent('0 s');
    expect(screen.queryByText('3.2 V')).not.toBeInTheDocument();
    expect(screen.queryByText('0 °C')).not.toBeInTheDocument();
    update({...node, details: {}});
    expect(screen.queryByRole('region', {name: 'Device health'})).not.toBeInTheDocument();
});

it('shows missing readings honestly and does not invent routes or neighbor counts from invalid hop values', () => {
    const {container, update} = setup({...node, latitude: null, longitude: null, altitude: null, details: {
        telemetry: {hop_start: 1, hop_limit: 7, battery_level: -1, channel_utilization: 110},
    }});
    expect(screen.getByRole('region', {name: 'Received signal'})).toHaveTextContent('—Not reported');
    expect(screen.getByRole('region', {name: 'GPS satellites'})).toHaveTextContent('—');
    expect(screen.getByRole('region', {name: 'Distance'})).toHaveTextContent('—');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/NaN|Infinity|Online|neighbor/i);
    update({...node, details: {frame: {hop_start: 7, hop_limit: 0}, signal: {rssi_dbm: 0}}});
    expect(screen.getByRole('img', {name: '7 initial · 0 remaining'}).children).toHaveLength(7);
    expect(screen.getByRole('region', {name: 'Received signal'})).toHaveTextContent('0dBm');
});

it('keeps unknown decoded fields lazy, preserves false values and avoids work on playback-only updates', async () => {
    const read = vi.fn(() => 'Retained custom value');
    const additional = {enabled: false};
    Object.defineProperty(additional, 'nested', {enumerable: true, get: read});
    const transmitter = {...node, details: {...node.details, additional}};
    const {container, update} = setup(transmitter);
    expect(read).not.toHaveBeenCalled();
    update(transmitter, {playbackTime: Date.now()});
    expect(read).not.toHaveBeenCalled();
    const disclosure = container.querySelector('details');
    await act(async () => {disclosure.open = true; fireEvent(disclosure, new Event('toggle'));});
    expect(read).toHaveBeenCalledOnce();
    const additionalSection = within(screen.getByRole('region', {name: 'Additional data'}));
    expect(additionalSection.getByText('Retained custom value')).toBeInTheDocument();
    expect(additionalSection.getByText('false')).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Reception'})).toHaveTextContent('decoded:mesh.bin');
    update(transmitter, {playbackTime: Date.now() + 1000});
    expect(read).toHaveBeenCalledOnce();
    update({...node, id: 'meshtastic:new-node', details: {telemetry: {message: '<b>Plain message</b>'}}});
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    expect(screen.getByRole('region', {name: 'Message'})).toHaveTextContent('<b>Plain message</b>');
    expect(screen.getByRole('region', {name: 'Message'}).querySelector('b')).toBeNull();
    expect(screen.queryByText('Retained custom value')).not.toBeInTheDocument();
});
