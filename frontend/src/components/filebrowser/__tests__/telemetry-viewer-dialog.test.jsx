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
import {act, fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import TelemetryViewerDialog from '../telemetry-viewer-dialog.jsx';
import legacyLasarsat from '../../../../../backend/tests/fixtures/lasarsat.json';

vi.mock('../telemetry-aprs-tab.jsx', () => ({
    default: () => <div>Dedicated APRS packet view</div>,
}));
vi.mock('../telemetry-overview-tab', () => ({
    default: () => <div>Packet overview</div>,
}));
vi.mock('../../../hooks/useUserTimeSettings.jsx', () => ({
    useUserTimeSettings: () => ({timezone: 'UTC', locale: 'en-US'}),
}));

const file = {filename: 'packet.bin', url: '/decoded/packet.bin'};

describe('TelemetryViewerDialog packet-specific tab', () => {
    it('replaces Telemetry with APRS for APRS decoder files', () => {
        render(
            <TelemetryViewerDialog
                open
                onClose={() => {}}
                file={file}
                metadata={{decoder: {type: 'aprs'}, telemetry: {}, packet: {}}}
            />,
        );

        const aprsTab = screen.getByRole('tab', {name: 'APRS'});
        expect(screen.queryByRole('tab', {name: 'Telemetry'})).not.toBeInTheDocument();
        fireEvent.click(aprsTab);
        expect(screen.getByText('Dedicated APRS packet view')).toBeInTheDocument();
    });

    it('keeps the generic Telemetry tab for other decoder files', () => {
        render(
            <TelemetryViewerDialog
                open
                onClose={() => {}}
                file={file}
                metadata={{decoder: {type: 'fsk'}, telemetry: {}, packet: {}}}
            />,
        );

        expect(screen.getByRole('tab', {name: 'Telemetry'})).toBeInTheDocument();
        expect(screen.queryByRole('tab', {name: 'APRS'})).not.toBeInTheDocument();
    });
});

describe('Saved packet reparsing', () => {
    const original = {telemetry: {telemetry: {format: 'raw'}}};

    function connection() {
        const socket = {connected: true, emit: vi.fn()};
        socket.timeout = vi.fn(() => socket);
        return socket;
    }

    it('refreshes the visible values from the acknowledged metadata', () => {
        const socket = connection();
        function Viewer() {
            const [metadata, setMetadata] = React.useState(original);
            return <TelemetryViewerDialog open file={file} metadata={metadata} socket={socket}
                onClose={() => {}} onMetadataChange={setMetadata} />;
        }
        render(<Viewer />);
        fireEvent.click(screen.getByRole('tab', {name: 'Telemetry'}));
        expect(screen.getByText(/No decoded telemetry/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', {name: 'Reparse telemetry'}));
        expect(screen.getByRole('button', {name: 'Reparsing…'})).toBeDisabled();
        expect(socket.emit.mock.calls[0].slice(0, 2)).toEqual([
            'api.call', {cmd: 'filebrowser.reparse-telemetry', data: {url: file.url}},
        ]);
        act(() => socket.emit.mock.calls[0][2](null, {success: true, data: {
            telemetry: {telemetry: {format: 'kaitai', spec: 'uwe4',
                values: {batt_a_voltage_v: 4.2},
                field_info: {batt_a_voltage_v: {label: 'Battery A voltage', unit: 'V'}},
            }},
        }}));
        expect(screen.getByText('Battery A voltage')).toBeInTheDocument();
        expect(screen.getByText('4.2 V')).toBeInTheDocument();
    });

    it('reports failures and allows a retry without replacing existing metadata', () => {
        const socket = connection();
        const onMetadataChange = vi.fn();
        render(<TelemetryViewerDialog open file={file} metadata={original} socket={socket}
            onClose={() => {}} onMetadataChange={onMetadataChange} />);
        fireEvent.click(screen.getByRole('button', {name: 'Reparse telemetry'}));
        act(() => socket.emit.mock.calls[0][2](null, {success: false, error: 'Missing binary'}));
        expect(screen.getByRole('alert')).toHaveTextContent('Missing binary');
        expect(screen.getByRole('button', {name: 'Reparse telemetry'})).toBeEnabled();
        expect(onMetadataChange).not.toHaveBeenCalled();
    });

    it('ignores replies after switching to another packet', () => {
        const socket = connection();
        const onMetadataChange = vi.fn();
        const props = {open: true, metadata: original, socket, onClose: () => {}, onMetadataChange};
        const {rerender} = render(<TelemetryViewerDialog {...props} file={file} />);
        fireEvent.click(screen.getByRole('button', {name: 'Reparse telemetry'}));
        rerender(<TelemetryViewerDialog {...props} file={{filename: 'other.bin', url: '/decoded/other.bin'}} />);
        act(() => socket.emit.mock.calls[0][2](null, {success: true, data: {}}));
        expect(onMetadataChange).not.toHaveBeenCalled();
    });
});

describe('Legacy LASARSAT viewing', () => {
    const capture = legacyLasarsat[0];
    const legacyFile = {filename: capture.filename, url: `/decoded/${capture.filename}`};
    const decoded = {...capture.metadata, telemetry: {
        ...capture.metadata.telemetry, parser: 'ax25+LasarsatAx25Parser', telemetry: {
            satellite: 'LASARSAT', format: 'beacon', type: 'DOS',
            values: {dos_mag_y: 1602},
            field_info: {dos_mag_y: {label: 'Y reading', group: 'magnetometer', order: 5, calibrated: false}},
        },
    }};

    function connection() {
        const socket = {connected: true, emit: vi.fn()};
        socket.timeout = vi.fn(() => socket);
        return socket;
    }

    it('decodes an actual legacy metadata for viewing without saving or requiring a parent callback', () => {
        const socket = connection();
        render(<TelemetryViewerDialog open file={legacyFile} metadata={capture.metadata}
            socket={socket} onClose={() => {}} />);
        expect(socket.emit).toHaveBeenCalledTimes(1);
        expect(socket.emit.mock.calls[0].slice(0, 2)).toEqual([
            'api.call', {cmd: 'filebrowser.preview-telemetry', data: {url: legacyFile.url}},
        ]);
        fireEvent.click(screen.getByRole('tab', {name: 'Telemetry'}));
        expect(screen.getByRole('status')).toHaveTextContent('Decoding saved packet…');
        act(() => socket.emit.mock.calls[0][2](null, {success: true, data: decoded}));
        expect(screen.getByRole('region', {name: 'Magnetometer'})).toHaveTextContent('1,602 (raw)');
        expect(screen.queryByText(/No decoded telemetry/)).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('tab', {name: 'Overview'}));
        fireEvent.click(screen.getByRole('tab', {name: 'Telemetry'}));
        expect(socket.emit).toHaveBeenCalledTimes(1);
    });

    it('retains capture metadata and lets the explicit reparse action save decoded values', () => {
        const socket = connection();
        const onMetadataChange = vi.fn();
        render(<TelemetryViewerDialog open file={legacyFile} metadata={capture.metadata}
            socket={socket} onMetadataChange={onMetadataChange} onClose={() => {}} />);
        expect(screen.getByRole('button', {name: 'Reparse telemetry'})).toBeDisabled();
        act(() => socket.emit.mock.calls[0][2](null, {success: true, data: decoded}));
        expect(onMetadataChange).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', {name: 'Reparse telemetry'}));
        expect(socket.emit.mock.calls[1][1].cmd).toBe('filebrowser.reparse-telemetry');
        act(() => socket.emit.mock.calls[1][2](null, {success: true, data: decoded}));
        expect(onMetadataChange).toHaveBeenCalledWith(decoded);
    });

    it('does not request a preview for captures already carrying grouped metadata', () => {
        const socket = connection();
        render(<TelemetryViewerDialog open file={legacyFile} metadata={decoded} socket={socket} onClose={() => {}} />);
        expect(socket.emit).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('tab', {name: 'Telemetry'}));
        expect(screen.getByRole('region', {name: 'Magnetometer'})).toBeInTheDocument();
    });

    it('shows the actual frame decoding error instead of the empty state', () => {
        const invalid = legacyLasarsat[3];
        const socket = connection();
        render(<TelemetryViewerDialog open file={legacyFile} metadata={invalid.metadata}
            socket={socket} onClose={() => {}} />);
        act(() => socket.emit.mock.calls[0][2](null, {success: true, data: invalid.metadata}));
        fireEvent.click(screen.getByRole('tab', {name: 'Telemetry'}));
        expect(screen.getByRole('alert')).toHaveTextContent('Invalid destination callsign');
        expect(screen.queryByText(/No decoded telemetry/)).not.toBeInTheDocument();
    });

    it.each(['switch', 'close'])('ignores late previews after %s', (action) => {
        const socket = connection();
        const props = {open: true, file: legacyFile, metadata: capture.metadata, socket, onClose: () => {}};
        const {rerender} = render(<TelemetryViewerDialog {...props} />);
        if (action === 'switch') {
            rerender(<TelemetryViewerDialog {...props} file={file} metadata={{telemetry: {}}} />);
        } else {
            rerender(<TelemetryViewerDialog {...props} open={false} />);
        }
        act(() => socket.emit.mock.calls[0][2](null, {success: true, data: decoded}));
        if (action === 'switch') fireEvent.click(screen.getByRole('tab', {name: 'Telemetry'}));
        expect(screen.queryByRole('region', {name: 'Magnetometer'})).not.toBeInTheDocument();
    });

    it('explains preview failures and keeps the explicit reparse action available', () => {
        const socket = connection();
        render(<TelemetryViewerDialog open file={legacyFile} metadata={capture.metadata}
            socket={socket} onMetadataChange={() => {}} onClose={() => {}} />);
        act(() => socket.emit.mock.calls[0][2](new Error('timeout')));
        fireEvent.click(screen.getByRole('tab', {name: 'Telemetry'}));
        expect(screen.getByText(/Could not decode this saved packet/)).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Reparse telemetry'})).toBeEnabled();
    });

    it('waits for a connection and provides guidance when viewing offline', () => {
        const socket = connection();
        socket.connected = false;
        const props = {open: true, file: legacyFile, metadata: capture.metadata, socket, onClose: () => {}};
        const {rerender} = render(<TelemetryViewerDialog {...props} />);
        fireEvent.click(screen.getByRole('tab', {name: 'Telemetry'}));
        expect(socket.emit).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('This packet has no saved telemetry values');
        socket.connected = true;
        rerender(<TelemetryViewerDialog {...props} />);
        expect(socket.emit).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('status')).toBeInTheDocument();
    });
});
