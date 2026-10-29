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
import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {describe, expect, it, vi} from 'vitest';
import TelemetryValuesTab from '../telemetry-values-tab.jsx';
import TelemetryViewerDialog from '../telemetry-viewer-dialog.jsx';

vi.mock('../telemetry-overview-tab', () => ({default: () => <div>Packet overview</div>}));

// The legacy metadata shape from the user's GEOSCAN capture.
const legacyValues = {
    mayak_id: {value: 1, unit: null},
    eps_time_unix_s: {value: 1768248238, unit: null},
    eps_mode_enum: {value: 3, unit: null},
    eps_reserve_22: {value: 255, unit: null},
    eps_current_platform_a: {value: 0.222, unit: 'A'},
    eps_current_solar_a: {value: 0, unit: 'A'},
    v_cell_v: {value: 4.142, unit: 'V'},
    v_pack_v: {value: 8.203, unit: 'V'},
    eps_reserve_bitfield_31: {value: 262, unit: null},
    temp_bat1_c: {value: 13, unit: '°C'},
    temp_bat2_c: {value: 12, unit: '°C'},
};

function renderWithPreferences(ui, timezone = 'UTC', locale = 'en-US') {
    const initial = {preferences: [{name: 'timezone', value: timezone}, {name: 'locale', value: locale}]};
    const store = configureStore({reducer: {preferences: (state = initial, action) =>
        action.type === 'setTimezone' ? {...state, preferences: state.preferences.map((pref) =>
            pref.name === 'timezone' ? {...pref, value: action.payload} : pref)} : state}});
    return {...render(<Provider store={store}>{ui}</Provider>), store};
}

function packet(values = legacyValues, extra = {}) {
    return {parser: 'proprietary+GeoscanParser', telemetry: {format: 'geoscan', values, ...extra}};
}

describe('GEOSCAN housekeeping presentation', () => {
    it('renders the legacy capture with readable readings and collapses reserved bytes', () => {
        renderWithPreferences(<TelemetryValuesTab telemetry={packet()} satellite="GEOSCAN-6" />);
        expect(screen.getByRole('heading', {name: 'GEOSCAN-6'})).toBeInTheDocument();
        expect(screen.getByText('Beacon ID')).toBeInTheDocument();
        expect(screen.getByText('Power system time (UTC)')).toBeInTheDocument();
        expect(screen.getByText('Jan 12, 2026, 20:03:58')).toBeInTheDocument();
        const power = screen.getByRole('region', {name: 'Power system'});
        for (const label of ['Battery pack voltage', 'Battery cell voltage', 'Platform current', 'Solar current',
            'Battery 1 temperature', 'Battery 2 temperature', 'Operating mode']) {
            expect(within(power).getByText(label)).toBeInTheDocument();
        }
        for (const value of ['8.203 V', '4.142 V', '222 mA', '0 mA', '13 °C', '12 °C', '3']) {
            expect(within(power).getByText(value)).toBeInTheDocument();
        }
        expect(power.textContent.indexOf('Battery pack voltage')).toBeLessThan(power.textContent.indexOf('Operating mode'));
        expect(within(power).queryByText(/eps_reserve/)).not.toBeInTheDocument();
        expect(screen.queryByText(/\{"value":/)).not.toBeInTheDocument();
        const reserved = screen.getByText('eps_reserve_22');
        expect(reserved).not.toBeVisible();
        fireEvent.click(screen.getByText('Raw fields and reserved bytes'));
        expect(reserved).toBeVisible();
        expect(screen.getByText('255')).toBeVisible();
        expect(screen.getByText('eps_reserve_bitfield_31')).toBeVisible();
    });

    it('groups Kaitai values, honors field metadata and preserves raw counts', () => {
        renderWithPreferences(<TelemetryValuesTab telemetry={{telemetry: {
            format: 'kaitai', spec: 'geoscan_type1_info56', satellite: 'GEOSCAN',
            values: {v_pack_v: 8.203, eps_current_platform_a: 0.222, temp_x_p_c: -12,
                rssi_last_dbm: -100, tx_packets_count: 0},
            field_info: {v_pack_v: {label: 'Measured pack voltage', unit: 'V'}},
            raw_fields: {v_pack_v_raw: 8203, eps_current_platform_a_raw: 222},
        }}} />);
        const power = screen.getByRole('region', {name: 'Power system'});
        expect(within(power).getByText('Measured pack voltage')).toBeInTheDocument();
        expect(within(power).getByText('222 mA')).toBeInTheDocument();
        const obc = screen.getByRole('region', {name: 'Onboard computer'});
        expect(within(obc).getByText('+X panel temperature')).toBeInTheDocument();
        expect(within(obc).getByText('-12 °C')).toBeInTheDocument();
        const radio = screen.getByRole('region', {name: 'Communications'});
        expect(within(radio).getByText('-100 dBm')).toBeInTheDocument();
        expect(within(radio).getByText('0')).toBeInTheDocument();
        expect(screen.getByText('8203')).not.toBeVisible();
        fireEvent.click(screen.getByText('Raw fields and reserved bytes'));
        expect(screen.getByText('8203')).toBeVisible();
    });

    it('formats spacecraft and reception clocks in the selected timezone and locale', () => {
        const {store} = renderWithPreferences(<TelemetryValuesTab telemetry={packet()}
            captureTime={1768248298} />, 'Europe/Athens', 'en-GB');
        expect(screen.getByText('Power system time (Europe/Athens)')).toBeInTheDocument();
        expect(screen.getByText('12 Jan 2026, 22:03:58')).toBeInTheDocument();
        expect(screen.getByText('Received (Europe/Athens)')).toBeInTheDocument();
        expect(screen.getByText('12 Jan 2026, 22:04:58')).toBeInTheDocument();
        act(() => store.dispatch({type: 'setTimezone', payload: 'UTC'}));
        expect(screen.getByText('Power system time (UTC)')).toBeInTheDocument();
        expect(screen.getByText('12 Jan 2026, 20:03:58')).toBeInTheDocument();
    });

    it('treats offset-free legacy time_utc as UTC and accepts epoch zero', () => {
        const {unmount} = renderWithPreferences(<TelemetryValuesTab telemetry={packet({}, {
            time_utc: '2023-11-14 22:13:20',
        })} />, 'Europe/Athens', 'en-GB');
        expect(screen.queryByText('14 Nov 2023, 00:13:20')).not.toBeInTheDocument();
        expect(screen.getByText('15 Nov 2023, 00:13:20')).toBeInTheDocument();
        unmount();
        renderWithPreferences(<TelemetryValuesTab telemetry={packet({eps_time_unix_s: {value: 0}})} />);
        expect(screen.getByText('Jan 1, 1970, 00:00:00')).toBeInTheDocument();
    });

    it('shows failed/nonfinite readings as unavailable, keeps zero and retains unknown fields', () => {
        renderWithPreferences(<TelemetryValuesTab telemetry={packet({
            v_pack_v: {error: 'Sensor unavailable'}, v_cell_v: null, temp_bat1_c: NaN,
            temp_bat2_c: Infinity, eps_current_solar_a: {value: 0, unit: 'A'},
            eps_time_unix_s: {value: Number.MAX_VALUE}, custom_reading: {value: 17, unit: 'widgets'},
        })} />);
        expect(screen.getAllByText('Unavailable')).toHaveLength(5);
        expect(screen.getByTitle('Sensor unavailable')).toHaveTextContent('Unavailable');
        expect(screen.queryByText(/Unavailable (V|°C)/)).not.toBeInTheDocument();
        expect(screen.getByText('0 mA')).toBeInTheDocument();
        const other = screen.getByRole('region', {name: 'Other telemetry'});
        expect(within(other).getByText('Custom reading')).toBeInTheDocument();
        expect(within(other).getByText('17 widgets')).toBeInTheDocument();
    });

    it('supports Colibri-S flags without inventing enum labels or bit meanings', () => {
        renderWithPreferences(<TelemetryValuesTab telemetry={{parser: 'ax25+ColibriSGeoscanAx25Parser', telemetry: {
            satellite: 'COLIBRI-S', values: {v_pack_v: 8, eps_mode_enum: 3,
                obc_activity: {wheels: false, camera: true}, gnss_sat_count: 5},
        }}} />);
        const obc = screen.getByRole('region', {name: 'Onboard computer'});
        expect(within(obc).getByText('Reaction wheels')).toBeInTheDocument();
        expect(within(obc).getByText('No')).toBeInTheDocument();
        expect(within(obc).getByText('Camera')).toBeInTheDocument();
        expect(within(obc).getByText('Yes')).toBeInTheDocument();
        expect(within(screen.getByRole('region', {name: 'Power system'})).getByText('3')).toBeInTheDocument();
    });

    it('handles RS52S values and leaves large currents in amperes', () => {
        renderWithPreferences(<TelemetryValuesTab telemetry={{telemetry: {
            spec: 'rs52s', values: {battery_current_a: -0.125, panel_current_a: 1.5, v_pack_v: 4.1,
                cpu_load_pct: 25, comm_counter: 12, reserved_16: 255},
        }}} />);
        const power = screen.getByRole('region', {name: 'Power system'});
        expect(within(power).getByText('-125 mA')).toBeInTheDocument();
        expect(within(power).getByText('1.5 A')).toBeInTheDocument();
        expect(within(power).getByText('4.1 V')).toBeInTheDocument();
        expect(screen.getByRole('region', {name: 'Onboard computer'})).toHaveTextContent('25 %');
        expect(screen.getByRole('region', {name: 'Communications'})).toHaveTextContent('Communications counter');
        expect(screen.getByText('reserved_16')).not.toBeVisible();
    });

    it('uses the capture satellite name and reception clock in the real packet dialog', () => {
        renderWithPreferences(<TelemetryViewerDialog open onClose={() => {}}
            file={{filename: 'packet.bin', url: '/decoded/packet.bin'}} metadata={{
                satellite: {name: 'GEOSCAN 6 (RS92S6)'}, packet: {timestamp: 1768248298}, telemetry: packet(),
            }} />);
        fireEvent.click(screen.getByRole('tab', {name: 'Telemetry'}));
        expect(screen.getByRole('heading', {name: 'GEOSCAN 6 (RS92S6)'})).toBeInTheDocument();
        expect(screen.getByText('Received (UTC)')).toBeInTheDocument();
        expect(screen.getByText('222 mA')).toBeInTheDocument();
    });

    it('keeps raw fallbacks informative when no housekeeping values were decoded', () => {
        renderWithPreferences(<TelemetryValuesTab telemetry={{parser: 'proprietary+GeoscanParser',
            telemetry: {format: 'raw', hex: 'abcd'}}} />);
        expect(screen.getByText(/No decoded telemetry available/)).toBeInTheDocument();
        expect(screen.queryByRole('region', {name: 'Power system'})).not.toBeInTheDocument();
    });

    it('explains non-housekeeping packets instead of silently rendering an empty tab', () => {
        renderWithPreferences(<TelemetryValuesTab telemetry={packet(undefined, {
            values: undefined, warning: 'GEOSCAN image packet detected.',
        })} />);
        expect(screen.getByRole('alert')).toHaveTextContent('GEOSCAN image packet detected.');
        expect(screen.queryByRole('region', {name: 'Power system'})).not.toBeInTheDocument();
    });
});

// Engineering readings from the UWE-4 housekeeping capture, without field_info.
const uweValues = {
    api: 14, packet_id: 3871, payload_size: 46,
    batt_a_current_ma: 138, batt_a_soc_pct: 94, batt_a_temp_c: 11, batt_a_voltage_v: 4.2,
    batt_b_current_ma: 171, batt_b_soc_pct: 84, batt_b_temp_c: 11, batt_b_voltage_v: 4.124,
    beacon_rate_s: 60, freq_khz: 435600, obc_temp_c: 17,
    panel_neg_x_temp_c: 18, panel_neg_y_temp_c: 0, panel_neg_z_temp_c: 27,
    panel_pos_x_temp_c: 0, panel_pos_y_temp_c: 18, panel_pos_z_temp_c: 20,
    power_consumption_mw: 1322, uptime_s: 30217,
};

describe('UWE-4 housekeeping presentation', () => {
    it('groups the capture into batteries, status, panels and communications with units', () => {
        renderWithPreferences(<TelemetryValuesTab satellite="UWE-4" captureTime={1768248298}
            telemetry={{telemetry: {format: 'kaitai', spec: 'uwe4', values: uweValues,
                raw_fields: {timestamp_raw: [1, 2, 3, 4, 5, 6], subsystem_status_raw: 7}}}} />);
        expect(screen.getByRole('heading', {name: 'UWE-4'})).toBeInTheDocument();
        expect(screen.getAllByRole('region')).toHaveLength(5);
        const batteryA = screen.getByRole('region', {name: 'Battery A'});
        for (const label of ['Battery A voltage', 'Battery A current', 'Battery A state of charge', 'Battery A temperature']) {
            expect(within(batteryA).getByText(label)).toBeInTheDocument();
        }
        for (const value of ['4.2 V', '138 mA', '94 %', '11 °C']) {
            expect(within(batteryA).getByText(value)).toBeInTheDocument();
        }
        expect(batteryA.textContent.indexOf('Battery A voltage')).toBeLessThan(batteryA.textContent.indexOf('Battery A current'));
        const batteryB = screen.getByRole('region', {name: 'Battery B'});
        for (const value of ['4.124 V', '171 mA', '84 %', '11 °C']) {
            expect(within(batteryB).getByText(value)).toBeInTheDocument();
        }
        const status = screen.getByRole('region', {name: 'Satellite status'});
        for (const value of ['30,217 s', '1,322 mW', '17 °C']) {
            expect(within(status).getByText(value)).toBeInTheDocument();
        }
        const panels = screen.getByRole('region', {name: 'Panel temperatures'});
        expect(within(panels).getAllByText('0 °C')).toHaveLength(2);
        for (const label of ['+X', '−X', '+Y', '−Y', '+Z', '−Z']) {
            expect(within(panels).getByText(`${label} panel temperature`)).toBeInTheDocument();
        }
        const radio = screen.getByRole('region', {name: 'Communications'});
        expect(within(radio).getByText('Beacon interval')).toBeInTheDocument();
        expect(within(radio).getByText('60 s')).toBeInTheDocument();
        expect(within(radio).getByText('Downlink frequency')).toBeInTheDocument();
        expect(within(radio).getByText('435,600 kHz')).toBeInTheDocument();
        expect(screen.getByText('Received (UTC)')).toBeInTheDocument();
        // The six timestamp bytes have no established epoch; never invent a clock.
        expect(screen.queryByText('Spacecraft time (UTC)')).not.toBeInTheDocument();
        for (const key of ['api', 'packet_id', 'payload_size', 'timestamp_raw', 'subsystem_status_raw']) {
            expect(screen.getByText(key)).not.toBeVisible();
        }
        expect(screen.queryByText('batt_a_current_ma')).not.toBeInTheDocument();
        fireEvent.click(screen.getByText('Raw fields and reserved bytes'));
        expect(screen.getByText('packet_id')).toBeVisible();
        expect(screen.getByText('3871')).toBeVisible();
        expect(screen.getByText('[1,2,3,4,5,6]')).toBeVisible();
    });

    it.each([
        {telemetry: {spec: 'uwe4'}},
        {telemetry: {satellite: 'UWE-4'}},
        {parser: 'ax25+Uwe4Parser', telemetry: {}},
        {telemetry: {}},
    ])('recognizes old captures with identity %j and missing display metadata', (identity) => {
        renderWithPreferences(<TelemetryValuesTab telemetry={{...identity, telemetry: {...identity.telemetry,
            values: {batt_a_temp_c: {value: -5, unit: null}, batt_a_soc_pct: {value: 0}},
        }}} />);
        const battery = screen.getByRole('region', {name: 'Battery A'});
        expect(within(battery).getByText('Battery A temperature')).toBeInTheDocument();
        expect(within(battery).getByText('-5 °C')).toBeInTheDocument();
        expect(within(battery).getByText('0 %')).toBeInTheDocument();
        expect(screen.queryByText(/\{"value":/)).not.toBeInTheDocument();
        expect(screen.queryByRole('region', {name: 'Battery B'})).not.toBeInTheDocument();
    });

    it('honors metadata and keeps unavailable, zero and unknown readings distinct', () => {
        renderWithPreferences(<TelemetryValuesTab telemetry={{telemetry: {spec: 'uwe4', values: {
            batt_a_voltage_v: {value: 4.2, unit: 'legacy unit'}, batt_a_current_ma: {error: 'Sensor failed'},
            batt_b_current_ma: -171, batt_b_soc_pct: 0, batt_b_voltage_v: null,
            panel_pos_x_temp_c: 0, panel_neg_x_temp_c: NaN, custom_count: 12,
        }, field_info: {batt_a_voltage_v: {label: 'Measured battery voltage', unit: 'V'}}}}} />);
        expect(screen.getByText('Measured battery voltage')).toBeInTheDocument();
        expect(screen.getByText('4.2 V')).toBeInTheDocument();
        expect(screen.queryByText(/legacy unit/)).not.toBeInTheDocument();
        expect(screen.getByTitle('Sensor failed')).toHaveTextContent('Unavailable');
        expect(screen.getAllByText('Unavailable')).toHaveLength(3);
        expect(screen.queryByText(/Unavailable (V|mA|°C)/)).not.toBeInTheDocument();
        expect(screen.getByText('-171 mA')).toBeInTheDocument();
        expect(screen.getByText('0 %')).toBeInTheDocument();
        expect(screen.getByText('0 °C')).toBeInTheDocument();
        expect(screen.getByRole('region', {name: 'Other telemetry'})).toHaveTextContent('Custom count12');
    });

    it('keeps RF text packets readable without showing empty sensor cards', () => {
        renderWithPreferences(<TelemetryValuesTab telemetry={{telemetry: {
            spec: 'uwe4', values: {api: 103, packet_id: 0, payload_size: 24, message: 'Greetings from UWE-4'},
        }}} />);
        const radio = screen.getByRole('region', {name: 'Communications'});
        expect(within(radio).getByText('Radio message')).toBeInTheDocument();
        expect(within(radio).getByText('Greetings from UWE-4')).toBeInTheDocument();
        expect(screen.getAllByRole('region')).toHaveLength(1);
        expect(screen.getByText('api')).not.toBeVisible();
        fireEvent.click(screen.getByText('Raw fields and reserved bytes'));
        expect(screen.getByText('103')).toBeVisible();
        expect(screen.getByText('0')).toBeVisible();
    });
});
