import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {expect, test, vi} from 'vitest';
import '../../../i18n/config.js';
import MeshtasticFolderDialog from '../meshtastic-folder-dialog.jsx';
import reducer from '../filebrowser-slice.jsx';

vi.mock('../telemetry-position-map.jsx', () => ({default: ({source, position}) =>
    <div>Position of {source}: {position.latitude}, {position.longitude}</div>}));
vi.mock('../../../hooks/useUserTimeSettings.jsx', () => ({
    useUserTimeSettings: () => ({timezone: 'UTC', locale: 'en-GB'}),
}));

const runName = '20261103T080000.000000Z.gsmesh';
const folder = {id: 'decoded_folder:meshtastic_2008e299', name: 'SV2TEST (!2008e299)',
    node_id: '!2008e299', packet_count: 51, run_count: 2,
    captured_at: '2026-11-03T08:00:00Z', last_packet_at: '2026-11-03T08:15:00Z',
    download_url: '/api/decoded/meshtastic_2008e299/download',
    latest_position: {latitude: 40.65, longitude: 22.93, altitude: 32, captured_at: '2026-11-03T08:05:00Z'},
};
const packet = {filename: 'packet.bin', path: `meshtastic_2008e299/${runName}/packet.bin`,
    url: `/decoded/meshtastic_2008e299/${runName}/packet.bin`, type: 'decoded',
    application: 'Position', payload_status: 'decoded', captured_at: folder.captured_at};

function mount(failure = false, overrides = {}) {
    const node = {...folder, ...overrides};
    const socket = {connected: true, on: vi.fn(), off: vi.fn(),
        emit: vi.fn((_event, {data}, callback) => callback(failure
            ? {success: false, error: 'Folder was removed'}
            : {success: true, data: {...node, page: data.page, total: overrides.total ?? (data.run ? 3 : 51),
                packets: overrides.packets || [{...packet, filename: data.page === 2 ? 'older.bin' : 'packet.bin'}],
                runs: [{name: runName, packet_count: 3}],
            }})),
    };
    const onOpenPacket = vi.fn(), onDelete = vi.fn();
    render(<Provider store={configureStore({reducer: {filebrowser: reducer}})}>
        <MeshtasticFolderDialog folder={node} socket={socket} onClose={vi.fn()}
            onOpenPacket={onOpenPacket} onDelete={onDelete} />
    </Provider>);
    return {socket, onOpenPacket, onDelete};
}

test('opens grouped packets and retains their complete nested download paths', async () => {
    const {onOpenPacket, onDelete} = mount();
    await screen.findByText('packet.bin');
    await waitFor(() => expect(screen.getByRole('button', {name: 'View'})).toBeEnabled());
    expect(screen.getByText('Position of !2008e299: 40.65, 22.93')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', {name: 'View'}));
    expect(onOpenPacket).toHaveBeenCalledWith(packet);
    expect(screen.getByRole('link', {name: 'Download packet.bin'})).toHaveAttribute('href', packet.url);
    expect(screen.getByRole('link', {name: 'Download all captures'})).toHaveAttribute('href', folder.download_url);
    fireEvent.click(screen.getByRole('button', {name: 'Delete node captures'}));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({id: folder.id}));
});

test('paginates and filters capture runs, then refreshes when packets are saved', async () => {
    const {socket} = mount();
    await screen.findByText('packet.bin');
    await waitFor(() => expect(screen.getByRole('button', {name: 'Go to page 2'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button', {name: 'Go to page 2'}));
    await screen.findByText('older.bin');
    expect(socket.emit.mock.lastCall[1].data.page).toBe(2);
    fireEvent.mouseDown(screen.getByRole('combobox', {name: 'Capture run'}));
    fireEvent.click(await screen.findByRole('option', {name: `3 Nov 2026, 08:00:00 (${runName}) (3)`}));
    await waitFor(() => expect(socket.emit.mock.lastCall[1].data).toEqual({id: folder.id, page: 1, pageSize: 50, run: runName}));
    await screen.findByText('packet.bin');
    const before = socket.emit.mock.calls.length;
    act(() => socket.on.mock.calls.find(([event]) => event === 'library.changed')[1]());
    await waitFor(() => expect(socket.emit.mock.calls.length).toBeGreaterThan(before));
    expect(socket.emit.mock.lastCall[1].data.run).toBe(runName);
});

test('reports deleted or unavailable node captures', async () => {
    mount(true);
    expect(await screen.findByRole('alert')).toHaveTextContent('Folder was removed');
});

test('gives node identity a compact accessible header and preserves zero-valued device codes', async () => {
    mount(false, {long_name: 'Thessaloniki North', short_name: 'SKG', hw_model: 0, role: 0});
    await screen.findByText('packet.bin');
    const dialog = within(screen.getByRole('dialog', {name: 'Thessaloniki North'}));
    expect(dialog.getByRole('heading', {name: 'Thessaloniki North'})).toBeInTheDocument();
    expect(dialog.getByText('51 packets')).toBeInTheDocument();
    const overview = within(screen.getByRole('region', {name: 'Node details'}));
    expect(overview.getByText('!2008e299')).toBeInTheDocument();
    expect(overview.getByText('SKG')).toBeInTheDocument();
    expect(overview.getByText('Hardware model code')).toBeInTheDocument();
    expect(overview.getByText('Device role code')).toBeInTheDocument();
    expect(overview.getAllByText('0')).toHaveLength(2);
    expect(overview.getByText('First received (UTC)')).toBeInTheDocument();
    expect(overview.getByText('Last received (UTC)')).toBeInTheDocument();
});

test('keeps telemetry measurements and packet context visible with units, false flags and unavailable readings', async () => {
    mount(false, {latest_telemetry: {captured_at: '2026-11-03T08:10:00Z', values: {
        source: '!2008e299', via_mqtt: false, battery_level: 0, voltage: {value: 3.75, unit: 'V'},
        channel_utilization: {value: 12, unit: '%'}, temperature: null, broken: {value: 22, error: 'Bad reading'},
    }, field_info: {
        source: {label: 'Source', group: 'mesh'}, via_mqtt: {label: 'Via MQTT', group: 'mesh'},
        battery_level: {label: 'Battery level', unit: '%', group: 'device_metrics'},
        voltage: {label: 'Voltage', group: 'device_metrics'},
        channel_utilization: {label: 'Channel utilization', group: 'device_metrics', calibrated: false},
        temperature: {label: 'Temperature', group: 'environment_metrics'},
        broken: {label: 'Sensor', group: 'environment_metrics'},
    }}});
    await screen.findByText('packet.bin');
    const telemetry = within(screen.getByRole('region', {name: 'Latest telemetry packet'}));
    expect(telemetry.getByRole('heading', {name: 'Device metrics'})).toBeVisible();
    expect(telemetry.getByRole('heading', {name: 'Environment'})).toBeVisible();
    expect(telemetry.getByRole('heading', {name: 'Packet context'})).toBeVisible();
    expect(telemetry.getByText('0 %')).toBeVisible();
    expect(telemetry.getByText('3.75 V')).toBeVisible();
    expect(telemetry.getByText('12 (raw)')).toBeVisible();
    expect(telemetry.getByText('No')).toBeVisible();
    expect(telemetry.getAllByText('Unavailable')).toHaveLength(2);
    expect(telemetry.getByText('Sensor').parentElement.querySelector('dd')).toHaveAttribute('title', 'Bad reading');
});

test('labels packet statuses without treating unsupported or unknown payloads as decoded', async () => {
    mount(false, {packets: [
        {...packet, filename: 'decoded.bin', path: 'decoded.bin'},
        {...packet, filename: 'unsupported.bin', path: 'unsupported.bin', payload_status: 'unsupported'},
        {...packet, filename: 'malformed.bin', path: 'malformed.bin', payload_status: 'malformed'},
        {...packet, filename: 'unknown.bin', path: 'unknown.bin', payload_status: null},
    ]});
    await screen.findByText('decoded.bin');
    const table = within(screen.getByRole('table', {name: 'Meshtastic packets'}));
    expect(table.getByText('Decoded')).toBeInTheDocument();
    expect(table.getByText('Unsupported')).toBeInTheDocument();
    expect(table.getByText('Malformed')).toBeInTheDocument();
    expect(table.getByText('Unknown')).toBeInTheDocument();
    expect(table.getByRole('columnheader', {name: 'Received (UTC)'})).toBeInTheDocument();
});

test('uses the node ID when no name is recorded and handles an empty filtered run', async () => {
    mount(false, {name: '!2008e299', long_name: '', short_name: '', packets: [], total: 0, latest_position: null});
    expect(await screen.findByRole('dialog', {name: '!2008e299'})).toBeInTheDocument();
    await screen.findByText('No packets in this run.');
    const overview = within(screen.getByRole('region', {name: 'Node details'}));
    expect(overview.queryByText('Hardware model code')).not.toBeInTheDocument();
    expect(screen.queryByRole('region', {name: 'Latest position'})).not.toBeInTheDocument();
});
