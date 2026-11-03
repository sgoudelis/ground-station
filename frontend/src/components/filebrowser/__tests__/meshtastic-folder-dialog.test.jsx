import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
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

function mount(failure = false) {
    const socket = {connected: true, on: vi.fn(), off: vi.fn(),
        emit: vi.fn((_event, {data}, callback) => callback(failure
            ? {success: false, error: 'Folder was removed'}
            : {success: true, data: {...folder, page: data.page, total: data.run ? 3 : 51,
                packets: [{...packet, filename: data.page === 2 ? 'older.bin' : 'packet.bin'}],
                runs: [{name: runName, packet_count: 3}],
            }})),
    };
    const onOpenPacket = vi.fn(), onDelete = vi.fn();
    render(<Provider store={configureStore({reducer: {filebrowser: reducer}})}>
        <MeshtasticFolderDialog folder={folder} socket={socket} onClose={vi.fn()}
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
