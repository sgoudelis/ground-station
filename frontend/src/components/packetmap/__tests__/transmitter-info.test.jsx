import React from 'react';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {createTheme, ThemeProvider} from '@mui/material/styles';
import {fireEvent, render, screen, within} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import TransmitterInfo from '../transmitter-info.jsx';

await i18n.use(initReactI18next).init({lng: 'en', resources: {}});
vi.mock('../../common/common.jsx', () => ({
    TitleBar: ({children}) => <div>{children}</div>, islandTitleBarCompactSx: {},
    getClassNamesBasedOnGridEditing: () => '',
}));

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
    it('shows aircraft specifications and inferred operator details for saved map records', () => {
        const aircraft = {...transmitter, kind: 'adsb', source: '40621D', details: {telemetry: {aircraft: {
            registration: 'G-TEST', type_code: 'C172', aircraft_class: 'L', engine_type: 'P', engine_count: 1,
            military_status: 'unclassified', operator_name: 'Easyjet Uk', operator_source: 'callsign_prefix',
            database: {version: 529},
        }}}};
        render(<TransmitterInfo transmitter={aircraft} />, {wrapper});
        const details = within(screen.getByRole('region', {name: 'Aircraft details'}));
        expect(details.getByText('G-TEST')).toBeInTheDocument();
        expect(details.getByText('Landplane')).toBeInTheDocument();
        expect(details.getByText('Piston')).toBeInTheDocument();
        expect(details.getByText('Unclassified')).toBeInTheDocument();
        expect(details.getByText('Easyjet Uk')).toBeInTheDocument();
        expect(details.getByRole('link', {name: 'ODC Attribution License'})).toBeInTheDocument();
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
        expect(info).toHaveTextContent('TEST');
        expect(info).toHaveTextContent('radiosonde:RS41:TEST');
        expect(info).toHaveTextContent('Radiosonde');
        const position = within(screen.getByRole('region', {name: 'Latest position'}));
        expect(position.getByText('40.123456')).toBeInTheDocument();
        expect(position.getByText('0')).toBeInTheDocument();
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
        expect(screen.getByText('Select a transmitter on the map or in the table to view its information.')).toBeInTheDocument();
    });
});
