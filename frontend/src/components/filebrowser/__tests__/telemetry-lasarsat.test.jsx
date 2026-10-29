/**
 * @license
 * Copyright (c) 2026 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

import React from 'react';
import {fireEvent, render, screen, within} from '@testing-library/react';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {describe, expect, it, vi} from 'vitest';
import TelemetryValuesTab from '../telemetry-values-tab.jsx';
import TelemetryViewerDialog from '../telemetry-viewer-dialog.jsx';

vi.mock('../telemetry-overview-tab', () => ({default: () => <div>Packet overview</div>}));

function renderWithPreferences(ui) {
    const store = configureStore({reducer: {preferences: () => ({preferences: [
        {name: 'timezone', value: 'UTC'}, {name: 'locale', value: 'en-US'},
    ]})}});
    return render(<Provider store={store}>{ui}</Provider>);
}

// Representative readings/metadata from the captured PSU beacon. Deliberately
// shuffle the values so that ordering must come from the backend metadata.
const psu = {
    satellite: 'LASARSAT', format: 'beacon', type: 'PSU',
    values: {
        psu_cur_out: 88, psu_temp_sys: 2302, psu_ch2_state: true,
        psu_reset_cnt: 4, psu_battery: 8148, psu_ch0_state: false, psu_cur_in: 1,
    },
    field_info: {
        psu_battery: {label: 'Battery reading', unit: '', group: 'power', order: 3, calibrated: false},
        psu_cur_in: {label: 'Input current', unit: '', group: 'power', order: 6, calibrated: false},
        psu_cur_out: {label: 'Output current', unit: '', group: 'power', order: 7, calibrated: false},
        psu_temp_sys: {label: 'System temperature', unit: '', group: 'temperatures', order: 4, calibrated: false},
        psu_reset_cnt: {label: 'Reset count', unit: '', group: 'status', order: 0},
        psu_ch0_state: {label: 'Channel 0 enabled', unit: '', group: 'channels', order: 11},
        psu_ch2_state: {label: 'Channel 2 enabled', unit: '', group: 'channels', order: 13},
    },
    raw_fields: {psu_battery: '8148', psu_ch_state_num: '7c'},
};

describe('LASARSAT backend-driven presentation', () => {
    it('uses the real dialog path for subsystem cards, raw readings and channel flags', () => {
        renderWithPreferences(<TelemetryViewerDialog open onClose={() => {}}
            file={{filename: 'lasarsat.bin', url: '/decoded/lasarsat.bin'}}
            metadata={{satellite: {name: 'LASARSAT'}, packet: {timestamp: 1768248298}, telemetry: {
                parser: 'ax25+LasarsatAx25Parser', telemetry: psu,
            }}} />);
        fireEvent.click(screen.getByRole('tab', {name: 'Telemetry'}));
        expect(screen.getByRole('heading', {name: 'LASARSAT'})).toBeInTheDocument();
        expect(screen.getByText('Beacon type')).toBeInTheDocument();
        expect(screen.getByText('PSU')).toBeInTheDocument();
        expect(screen.getByText('Received (UTC)')).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('no verified conversion to physical units');
        const power = screen.getByRole('region', {name: 'Power system'});
        expect(within(power).getByText('8,148 (raw)')).toBeInTheDocument();
        expect(within(power).getByText('1 (raw)')).toBeInTheDocument();
        expect(within(power).getByText('88 (raw)')).toBeInTheDocument();
        expect(power.textContent.indexOf('Battery reading')).toBeLessThan(power.textContent.indexOf('Input current'));
        expect(power.textContent.indexOf('Input current')).toBeLessThan(power.textContent.indexOf('Output current'));
        expect(screen.getByRole('region', {name: 'Temperatures'})).toHaveTextContent('System temperature2,302 (raw)');
        expect(screen.getByRole('region', {name: 'Satellite status'})).toHaveTextContent('Reset count4');
        const channels = screen.getByRole('region', {name: 'Output channels'});
        expect(within(channels).getByText('Channel 0 enabled')).toBeInTheDocument();
        expect(within(channels).getByText('No')).toBeInTheDocument();
        expect(within(channels).getByText('Yes')).toBeInTheDocument();
        expect(screen.queryByText(/(8\.148 V|23\.02 °C)/)).not.toBeInTheDocument();
        expect(screen.getByText('psu_ch_state_num')).not.toBeVisible();
        fireEvent.click(screen.getByText('Raw fields and reserved bytes'));
        expect(screen.getByText('7c')).toBeVisible();
        expect(screen.getByText('8148')).toBeVisible();
    });

    it('preserves solar zero, signed and missing readings without adding physical units', () => {
        renderWithPreferences(<TelemetryValuesTab telemetry={{telemetry: {
            satellite: 'LASARSAT', format: 'beacon', type: 'SOL',
            values: {
                sol_temp_zp: null, sol_temp_xp: {value: 0, unit: '°C'}, sol_temp_yp: -12,
                sol_diode_zp: {error: 'Sensor unavailable'}, sol_diode_xp: 0,
            },
            field_info: {
                sol_temp_zp: {label: '+Z panel temperature', unit: '', group: 'panels', order: 0, calibrated: false},
                sol_temp_xp: {label: '+X panel temperature', unit: '', group: 'panels', order: 1, calibrated: false},
                sol_temp_yp: {label: '+Y panel temperature', unit: '', group: 'panels', order: 2, calibrated: false},
                sol_diode_zp: {label: '+Z diode reading', unit: '', group: 'diodes', order: 6, calibrated: false},
                sol_diode_xp: {label: '+X diode reading', unit: '', group: 'diodes', order: 7, calibrated: false},
            },
        }}} />);
        const panels = screen.getByRole('region', {name: 'Panel temperatures'});
        expect(within(panels).getByText('0 (raw)')).toBeInTheDocument();
        expect(within(panels).getByText('-12 (raw)')).toBeInTheDocument();
        expect(within(panels).getByText('Unavailable')).toBeInTheDocument();
        expect(screen.getByTitle('Sensor unavailable')).toHaveTextContent('Unavailable');
        expect(screen.queryByText(/Unavailable \(raw\)|°C/)).not.toBeInTheDocument();
        expect(screen.getByRole('region', {name: 'Diode readings'})).toHaveTextContent('0 (raw)');
    });

    it.each([['U', 'uhf'], ['V', 'vhf']])('shows %s radio RSSI readings and callsigns', (type, band) => {
        renderWithPreferences(<TelemetryValuesTab telemetry={{telemetry: {
            satellite: 'LASARSAT', format: 'beacon', type,
            values: {[`${band}_act_rssi_raw`]: 0, [`${band}_last_digipeater`]: 'DL7NDR', [`${band}_rx_cnt`]: 51856},
            field_info: {
                [`${band}_act_rssi_raw`]: {label: 'Current RSSI', group: 'communications', order: 11, calibrated: false},
                [`${band}_last_digipeater`]: {label: 'Last digipeater', group: 'communications', order: 8},
                [`${band}_rx_cnt`]: {label: 'Received packet count', group: 'communications', order: 9},
            },
        }}} />);
        const radio = screen.getByRole('region', {name: 'Communications'});
        expect(within(radio).getByText('Current RSSI')).toBeInTheDocument();
        expect(within(radio).getByText('0 (raw)')).toBeInTheDocument();
        expect(within(radio).getByText('DL7NDR')).toBeInTheDocument();
        expect(within(radio).getByText('51,856')).toBeInTheDocument();
        expect(screen.queryByText(/dBm/)).not.toBeInTheDocument();
    });

    it('honors backend groups and ordering over satellite fallbacks, including new groups', () => {
        renderWithPreferences(<TelemetryValuesTab telemetry={{telemetry: {
            spec: 'uwe4', values: {batt_a_voltage_v: 4.2, batt_a_current_ma: 138, new_sensor_raw: 0},
            field_info: {
                batt_a_voltage_v: {label: 'Pack voltage', unit: 'V', group: 'custom_sensors', order: 20},
                batt_a_current_ma: {label: 'Pack current', unit: 'mA', group: 'custom_sensors', order: 10},
                new_sensor_raw: {label: 'New sensor', group: 'custom_sensors', order: 0, calibrated: false},
            },
        }}} />);
        const sensors = screen.getByRole('region', {name: 'Custom sensors'});
        expect(sensors.textContent.indexOf('New sensor')).toBeLessThan(sensors.textContent.indexOf('Pack current'));
        expect(sensors.textContent.indexOf('Pack current')).toBeLessThan(sensors.textContent.indexOf('Pack voltage'));
        expect(within(sensors).getByText('4.2 V')).toBeInTheDocument();
        expect(within(sensors).getByText('138 mA')).toBeInTheDocument();
        expect(screen.queryByRole('region', {name: 'Battery A'})).not.toBeInTheDocument();
        expect(screen.getAllByRole('region')).toHaveLength(1);
    });

    it('routes new metadata into cards without requiring a known parser or satellite', () => {
        renderWithPreferences(<TelemetryValuesTab telemetry={{telemetry: {
            values: {sensor: 12}, field_info: {sensor: {label: 'Temperature', unit: '°C', group: 'temperatures', order: 0}},
        }}} />);
        expect(screen.getByRole('region', {name: 'Temperatures'})).toHaveTextContent('Temperature12 °C');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('retains unrecognized text beacons as text', () => {
        renderWithPreferences(<TelemetryValuesTab telemetry={{telemetry: {
            satellite: 'LASARSAT', format: 'text', text: 'Greetings from LASARSAT',
        }}} />);
        expect(screen.getByText('Greetings from LASARSAT')).toBeInTheDocument();
        expect(screen.queryByRole('region')).not.toBeInTheDocument();
    });
});
