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
import {render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import OverviewTab from '../telemetry-overview-tab.jsx';

vi.mock('../../../hooks/useUserTimeSettings.jsx', () => ({
    useUserTimeSettings: () => ({timezone: 'UTC', locale: 'en-US'}),
}));

describe('Telemetry overview link information', () => {
    it.each([
        {protocol: 'lora', parser: 'lora+TianqiParser'},
        {parser: 'lora', decoderType: 'lora'},
    ])('shows LoRa information without AX.25 headings for %j', ({protocol, parser, decoderType}) => {
        render(<OverviewTab metadata={{decoder: {type: decoderType}, packet: {}}}
            file={{filename: 'tianqi.bin'}} packet={{}} ax25={{}}
            telemetry={{protocol, parser, raw: {payload_length: 100}}} />);
        expect(screen.getByText('LoRa Frame Information')).toBeInTheDocument();
        expect(screen.getByText(parser)).toBeInTheDocument();
        expect(screen.queryByText('AX.25 Frame Information')).not.toBeInTheDocument();
        expect(screen.queryByText(/CRC-16 validated by HDLC/)).not.toBeInTheDocument();
    });

    it('retains the AX.25 section for UWE-4', () => {
        render(<OverviewTab metadata={{decoder: {type: 'fsk'}}}
            file={{filename: 'uwe4.bin'}} packet={{}} ax25={{}}
            telemetry={{protocol: 'ax25', parser: 'ax25+Uwe4Parser', success: true,
                frame: {source: 'DP0UWH-0', destination: 'DD0UWE-0'}}} />);
        expect(screen.getByText('AX.25 Frame Information')).toBeInTheDocument();
        expect(screen.getByText('DP0UWH-0')).toBeInTheDocument();
        expect(screen.queryByText('LoRa Frame Information')).not.toBeInTheDocument();
    });
});
