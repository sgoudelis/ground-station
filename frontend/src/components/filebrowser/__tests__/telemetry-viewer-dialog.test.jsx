import './telemetry-i18n.js';
import React from 'react';
import {act, fireEvent, render, screen} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import TelemetryViewerDialog from '../telemetry-viewer-dialog.jsx';
import fixtures from '../../../../../backend/tests/fixtures/viewer.json';

vi.mock('../telemetry-aprs-tab.jsx', () => ({default: () => <div>Dedicated APRS packet view</div>}));
vi.mock('../telemetry-overview-tab', () => ({default: () => <div>Packet overview</div>}));
vi.mock('../telemetry-hex-ascii-tab', () => ({default: ({packet}) => <div data-testid="hex-bytes">{packet.hex}</div>}));
vi.mock('../telemetry-float32-tab', () => ({default: ({packet}) => <div data-testid="float-bytes">{packet.hex}</div>}));
vi.mock('../telemetry-integers-tab', () => ({default: ({packet}) => <div data-testid="integer-bytes">{packet.hex}</div>}));
vi.mock('../telemetry-strings-tab', () => ({default: ({packet}) => <div data-testid="string-bytes">{packet.hex}</div>}));
vi.mock('../telemetry-analysis-tab', () => ({default: ({packet}) => <div data-testid="analysis-bytes">{packet.hex}</div>}));
vi.mock('../../../hooks/useUserTimeSettings.jsx', () => ({
    useUserTimeSettings: () => ({timezone: 'UTC', locale: 'en-US'}),
}));

const file = {filename: 'packet.bin', url: '/decoded/packet.bin'};
const current = {telemetry: {schema_version: 1, payload: {kind: 'raw', records: []}}};
const saved = fixtures.real.uwe4;
const old = {telemetry: {telemetry: {values: {battery_current_a: .125}}}};
const connection = () => {
    const socket = {connected: true, emit: vi.fn()};
    socket.timeout = vi.fn(() => socket);
    return socket;
};
const respond = (socket, index, data) => act(() => socket.emit.mock.calls[index][2](null, {success: true, data}));

describe('Packet dialog routing and byte selection', () => {
    it('routes APRS by the parsed content, regardless of decoder type', () => {
        render(<TelemetryViewerDialog open onClose={() => {}} file={file}
            metadata={{...fixtures.legacy.aprs, decoder: {type: 'fsk'}}} />);
        fireEvent.click(screen.getByRole('tab', {name: 'APRS'}));
        expect(screen.getByText('Dedicated APRS packet view')).toBeInTheDocument();
    });

    it('does not guess APRS content from decoder type', () => {
        render(<TelemetryViewerDialog open onClose={() => {}} file={file}
            metadata={{...current, decoder: {type: 'aprs'}}} />);
        expect(screen.getByRole('tab', {name: 'Telemetry'})).toBeInTheDocument();
    });

    it('shares the selected complete packet or payload across every inspection tab', () => {
        render(<TelemetryViewerDialog open onClose={() => {}} file={file} metadata={saved} />);
        fireEvent.click(screen.getByRole('tab', {name: 'Hex + ASCII'}));
        expect(screen.getByTestId('hex-bytes')).toHaveTextContent(saved.packet.hex);
        fireEvent.click(screen.getByRole('button', {name: 'Payload only'}));
        expect(screen.getByTestId('hex-bytes')).toHaveTextContent(saved.telemetry.raw.payload_hex);
        for (const [tab, testId] of [['As Float32', 'float'], ['As Integers', 'integer'], ['As Strings', 'string'], ['Analysis', 'analysis']]) {
            fireEvent.click(screen.getByRole('tab', {name: tab}));
            expect(screen.getByTestId(`${testId}-bytes`)).toHaveTextContent(saved.telemetry.raw.payload_hex);
        }
        fireEvent.click(screen.getByRole('button', {name: 'Complete packet'}));
        expect(screen.getByTestId('analysis-bytes')).toHaveTextContent(saved.packet.hex);
        const tab = screen.getByRole('tab', {name: 'Analysis'});
        expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', tab.id);
    });
});

describe('Explicit saved packet reparsing', () => {
    it('refreshes values only after the save acknowledgement', () => {
        const socket = connection();
        function Viewer() {
            const [metadata, setMetadata] = React.useState(current);
            return <TelemetryViewerDialog open file={file} metadata={metadata} socket={socket}
                onClose={() => {}} onMetadataChange={setMetadata} />;
        }
        render(<Viewer />);
        fireEvent.click(screen.getByRole('tab', {name: 'Telemetry'}));
        fireEvent.click(screen.getByRole('button', {name: 'Reparse telemetry'}));
        expect(screen.getByRole('button', {name: 'Reparsing…'})).toBeDisabled();
        expect(socket.emit.mock.calls[0][1].cmd).toBe('filebrowser.reparse-telemetry');
        respond(socket, 0, saved);
        expect(screen.getByText('Battery A voltage')).toBeInTheDocument();
        expect(screen.getByText('4.2 V')).toBeInTheDocument();
    });

    it('reports failures and allows retry without replacing metadata', () => {
        const socket = connection();
        const changed = vi.fn();
        render(<TelemetryViewerDialog open file={file} metadata={current} socket={socket}
            onClose={() => {}} onMetadataChange={changed} />);
        fireEvent.click(screen.getByRole('button', {name: 'Reparse telemetry'}));
        act(() => socket.emit.mock.calls[0][2](null, {success: false, error: 'Missing binary'}));
        expect(screen.getByRole('alert')).toHaveTextContent('Missing binary');
        expect(screen.getByRole('button', {name: 'Reparse telemetry'})).toBeEnabled();
        expect(changed).not.toHaveBeenCalled();
    });

    it.each(['switch', 'close'])('ignores late saves after %s', (action) => {
        const socket = connection();
        const changed = vi.fn();
        const props = {open: true, file, metadata: current, socket, onClose: () => {}, onMetadataChange: changed};
        const {rerender} = render(<TelemetryViewerDialog {...props} />);
        fireEvent.click(screen.getByRole('button', {name: 'Reparse telemetry'}));
        rerender(<TelemetryViewerDialog {...props} open={action !== 'close'}
            file={action === 'switch' ? {...file, url: '/decoded/other.bin'} : file} />);
        respond(socket, 0, saved);
        expect(changed).not.toHaveBeenCalled();
    });
});

describe('Historical saved telemetry', () => {
    it('prepares any old metadata on the backend without saving it', () => {
        const socket = connection();
        const changed = vi.fn();
        render(<TelemetryViewerDialog open file={file} metadata={old} socket={socket}
            onClose={() => {}} onMetadataChange={changed} />);
        expect(socket.emit.mock.calls[0][1]).toEqual({cmd: 'filebrowser.view-telemetry', data: {url: file.url}});
        fireEvent.click(screen.getByRole('tab', {name: 'Telemetry'}));
        expect(screen.getByRole('status')).toHaveTextContent('Preparing saved telemetry');
        expect(screen.getByRole('button', {name: 'Reparse telemetry'})).toBeDisabled();
        respond(socket, 0, saved);
        expect(screen.getByText('4.2 V')).toBeInTheDocument();
        expect(changed).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', {name: 'Reparse telemetry'}));
        expect(socket.emit.mock.calls[1][1].cmd).toBe('filebrowser.reparse-telemetry');
        respond(socket, 1, saved);
        expect(changed).toHaveBeenCalledWith(saved);
    });

    it('prepares unsupported current-schema packets with the current parser without saving', () => {
        const socket = connection();
        const changed = vi.fn();
        const unsupported = {...current, telemetry: {...current.telemetry, payload_status: 'unsupported'}};
        render(<TelemetryViewerDialog open file={file} metadata={unsupported} socket={socket}
            onMetadataChange={changed} onClose={() => {}} />);
        expect(socket.emit.mock.calls[0][1]).toEqual({cmd: 'filebrowser.view-telemetry', data: {url: file.url}});
        fireEvent.click(screen.getByRole('tab', {name: 'Telemetry'}));
        expect(screen.getByRole('status')).toHaveTextContent('Preparing saved telemetry');
        respond(socket, 0, saved);
        expect(screen.getByText('Battery A voltage')).toBeInTheDocument();
        expect(screen.getByText('4.2 V')).toBeInTheDocument();
        expect(changed).not.toHaveBeenCalled();
        expect(unsupported.telemetry.payload_status).toBe('unsupported');
        expect(socket.emit).toHaveBeenCalledTimes(1);
    });

    it('does not prepare already decoded current-schema metadata again', () => {
        const socket = connection();
        render(<TelemetryViewerDialog open file={file} metadata={saved} socket={socket} onClose={() => {}} />);
        expect(socket.emit).not.toHaveBeenCalled();
    });

    it.each(['switch', 'close'])('ignores late view replies after %s', (action) => {
        const socket = connection();
        const props = {open: true, file, metadata: old, socket, onClose: () => {}};
        const {rerender} = render(<TelemetryViewerDialog {...props} />);
        rerender(<TelemetryViewerDialog {...props} open={action !== 'close'}
            file={action === 'switch' ? {...file, url: '/decoded/other.bin'} : file} />);
        respond(socket, 0, saved);
        if (action === 'switch') fireEvent.click(screen.getByRole('tab', {name: 'Telemetry'}));
        expect(screen.queryByRole('region', {name: 'Battery A'})).not.toBeInTheDocument();
    });

    it('explains preparation failures and leaves reparse available', () => {
        const socket = connection();
        render(<TelemetryViewerDialog open file={file} metadata={old} socket={socket}
            onMetadataChange={() => {}} onClose={() => {}} />);
        act(() => socket.emit.mock.calls[0][2](new Error('timeout')));
        fireEvent.click(screen.getByRole('tab', {name: 'Telemetry'}));
        expect(screen.getByText(/Could not prepare this saved telemetry/)).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Reparse telemetry'})).toBeEnabled();
    });

    it('waits for connection while retaining literal offline readings', () => {
        const socket = connection();
        socket.connected = false;
        const props = {open: true, file, metadata: old, socket, onClose: () => {}};
        const {rerender} = render(<TelemetryViewerDialog {...props} />);
        fireEvent.click(screen.getByRole('tab', {name: 'Telemetry'}));
        expect(socket.emit).not.toHaveBeenCalled();
        expect(screen.getByRole('alert')).toHaveTextContent('Connect to the backend');
        expect(screen.getByText('0.125')).toBeInTheDocument();
        socket.connected = true;
        rerender(<TelemetryViewerDialog {...props} />);
        expect(socket.emit).toHaveBeenCalledTimes(1);
        expect(screen.getByRole('status')).toBeInTheDocument();
    });
});
