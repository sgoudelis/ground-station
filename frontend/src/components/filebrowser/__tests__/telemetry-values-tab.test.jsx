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
import {describe, expect, it, vi} from 'vitest';
import TelemetryViewerDialog from '../telemetry-viewer-dialog.jsx';
import TelemetryValuesTab from '../telemetry-values-tab.jsx';

vi.mock('../telemetry-overview-tab', () => ({
    default: () => <div>Packet overview</div>,
}));

const radio = {
    message_id: '0x4246', name: 'UHF radio beacon', source: 2, destination: 1, length: 25,
    status: 'decoded', values: {temperature: -5, current: 0},
    field_info: {
        temperature: {label: 'Amplifier temperature', unit: '°C'},
        current: {label: 'Radio current', unit: 'mA'},
    },
    raw_fields: {temperature: -5},
};
const power = {
    message_id: '0xDE21', name: 'Power system telemetry', source: 4, destination: 1, length: 46,
    status: 'decoded', values: {battery_voltage: 7.976, battery_temperature: 4.75, heater: false},
    field_info: {
        battery_voltage: {label: 'Battery voltage', unit: 'V'},
        battery_temperature: {label: 'Battery temperature 1', unit: '°C'},
        heater: {label: 'Battery heater 1 on'},
    },
    raw_fields: {battery_voltage: 7976},
};
const telemetry = (messages) => ({parser: 'ax25+USPParser', telemetry: {format: 'usp', messages}});

describe('USP telemetry in the packet viewer', () => {
    it('opens the Telemetry tab and shows subsystem groups, labels, units and raw fields', () => {
        render(<TelemetryViewerDialog open onClose={() => {}}
            file={{filename: 'umka.bin', url: '/observations/umka.gsobs/decoded/umka.bin'}}
            metadata={{decoder: {type: 'gmsk'}, telemetry: telemetry([radio, power])}} />);
        fireEvent.click(screen.getByRole('tab', {name: 'Telemetry'}));
        const panel = screen.getByRole('tabpanel');
        expect(within(panel).getByText('UHF radio beacon')).toBeInTheDocument();
        expect(within(panel).getByText('Power system telemetry')).toBeInTheDocument();
        expect(within(panel).getByText('Battery voltage')).toBeInTheDocument();
        expect(within(panel).getByText('7.976 V')).toBeInTheDocument();
        expect(within(panel).getByText('4.75 °C')).toBeInTheDocument();
        expect(within(panel).getByText('-5 °C')).toBeInTheDocument();
        expect(within(panel).getByText('0 mA')).toBeInTheDocument();
        expect(within(panel).getByText('No')).toBeInTheDocument();
        expect(within(panel).getByText(/0xDE21.*Device 4 → 1/)).toBeInTheDocument();
        const raw = within(panel).getAllByText('Raw Fields')[1];
        fireEvent.click(raw);
        expect(within(panel).getByText('7976')).toBeVisible();
    });

    it('explains file transfers, unknown types and truncated messages', () => {
        render(<TelemetryValuesTab telemetry={telemetry([
            {...radio, status: 'non_telemetry', name: 'File transfer data', values: {}, raw_fields: {}},
            {...power, status: 'unsupported', name: 'Unknown USP message', values: {}, raw_fields: {}},
            {...radio, status: 'malformed', values: {}, raw_fields: {}, error: 'Truncated USP message'},
        ])} />);
        expect(screen.getByText(/carries no satellite telemetry/)).toBeInTheDocument();
        expect(screen.getByText(/not decoded yet/)).toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('Truncated USP message');
        expect(screen.queryByText('7.976 V')).not.toBeInTheDocument();
    });

    it('shows unavailable readings without a misleading value or unit', () => {
        render(<TelemetryValuesTab telemetry={telemetry([
            {...radio, values: {temperature: null}, raw_fields: {}},
        ])} />);
        expect(screen.getByText('Unavailable')).toBeInTheDocument();
        expect(screen.queryByText(/Unavailable °C/)).not.toBeInTheDocument();
    });

    it('retains the legacy engineering values and raw fields', () => {
        render(<TelemetryValuesTab telemetry={{telemetry: {
            values: {battery_current_a: 0.125}, raw_fields: {battery_current_raw: 1632},
        }}} />);
        expect(screen.getByText('Engineering Values')).toBeInTheDocument();
        expect(screen.getByText('battery_current_a')).toBeInTheDocument();
        expect(screen.getByText('0.125')).toBeInTheDocument();
        expect(screen.getByText('1632')).toBeInTheDocument();
    });
});

describe('LASARSAT telemetry in the packet viewer', () => {
    it('shows the beacon type and marks transmitted values as unscaled', () => {
        render(<TelemetryViewerDialog open onClose={() => {}}
            file={{filename: 'lasarsat.bin', url: '/decoded/lasarsat.bin'}}
            metadata={{decoder: {type: 'gfsk'}, telemetry: {
                parser: 'ax25+LasarsatAx25Parser', protocol: 'ax25', success: true,
                telemetry: {
                    satellite: 'LASARSAT', format: 'beacon', type: 'PSU',
                    values: {psu_battery: 8148, psu_ch2_state: true},
                },
            }}} />);

        fireEvent.click(screen.getByRole('tab', {name: 'Telemetry'}));
        const panel = screen.getByRole('tabpanel');
        expect(within(panel).getByText('LASARSAT PSU beacon values')).toBeInTheDocument();
        expect(within(panel).getByText(/does not apply unit scaling/)).toBeInTheDocument();
        expect(within(panel).getByText('psu_battery')).toBeInTheDocument();
        expect(within(panel).getByText(new Intl.NumberFormat().format(8148))).toBeInTheDocument();
        expect(within(panel).getByText('Yes')).toBeInTheDocument();
    });

    it('shows why a malformed beacon has no measurements', () => {
        render(<TelemetryValuesTab telemetry={{telemetry: {
            satellite: 'LASARSAT', format: 'malformed', type: 'PSU',
            error: 'Expected 11 PSU fields, received 3',
        }}} />);

        expect(screen.getByRole('alert')).toHaveTextContent('Expected 11 PSU fields, received 3');
        expect(screen.queryByText('Engineering Values')).not.toBeInTheDocument();
    });
});

describe('Kaitai telemetry presentation', () => {
    it.each([
        ['tianqi', 'Fleet satellite identifier', 'sat_id', 39, ''],
    ])('renders %s labels, units, spacecraft UTC and raw fields', (spec, label, key, value, unit) => {
        render(<TelemetryValuesTab telemetry={{telemetry: {
            format: 'kaitai', spec,
            values: {[key]: value, time_unix_s: 1700000000},
            field_info: {[key]: {label, unit}},
            time_utc: '2023-11-14 22:13:20',
            raw_fields: {sensor_raw: 1234},
        }}} />);
        expect(screen.getByText(label)).toBeInTheDocument();
        expect(screen.getByText(`${value}${unit ? ` ${unit}` : ''}`)).toBeInTheDocument();
        expect(screen.getByText('Spacecraft time (UTC)')).toBeInTheDocument();
        expect(screen.getByText('2023-11-14 22:13:20')).toBeInTheDocument();
        expect(screen.queryByText('time_unix_s')).not.toBeInTheDocument();
        expect(screen.getByText('sensor_raw')).toBeInTheDocument();
    });
});
