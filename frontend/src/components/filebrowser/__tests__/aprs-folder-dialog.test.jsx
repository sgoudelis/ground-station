import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {expect, test, vi} from 'vitest';
import './telemetry-i18n.js';
import AprsFolderDialog from '../aprs-folder-dialog.jsx';
import reducer from '../filebrowser-slice.jsx';

vi.mock('../flight-path-map.jsx', () => ({default: ({filter, run, kind, folderId}) =>
    <section data-testid="path-map" data-run={run} data-kind={kind} data-folder={folderId}>{filter}</section>}));

const runName = '20261103T080000.000000Z.gsaprs';
const folder = {id: 'decoded_folder:aprs_SV2TEST-7', name: 'SV2TEST-7',
    source_callsign: 'SV2TEST-7', packet_count: 51, run_count: 2,
    captured_at: '2026-11-03T08:00:00Z', last_packet_at: '2026-11-03T08:15:00Z',
    download_url: '/api/decoded/aprs_SV2TEST-7/download',
    latest_position: {latitude: 40.65, longitude: 22.93, altitude: 32, captured_at: '2026-11-03T08:05:00Z'},
};
const packet = {filename: 'packet.bin', path: `aprs_SV2TEST-7/${runName}/packet.bin`,
    url: `/decoded/aprs_SV2TEST-7/${runName}/packet.bin`, type: 'decoded',
    data_type: 'position_without_timestamp', data_type_identifier: '!', payload_status: 'decoded', captured_at: folder.captured_at};

function mount({failure = false, empty = false, timezone = 'UTC'} = {}) {
    const socket = {connected: true, on: vi.fn(), off: vi.fn(),
        emit: vi.fn((_event, {data}, callback) => callback(failure
            ? {success: false, error: 'Folder was removed'}
            : {success: true, data: {...folder, page: data.page, total: empty ? 0 : data.run ? 3 : 51,
                packets: empty ? [] : Array.from({length: data.run ? 3 : data.page === 2 ? 1 : 50}, (_, index) => {
                    const filename = data.page === 2 ? 'older.bin' : index ? `packet-${index}.bin` : 'packet.bin';
                    return {...packet, filename, path: `aprs_SV2TEST-7/${runName}/${filename}`};
                }),
                runs: [{name: runName, packet_count: 3}],
                latest: {status: {value: 'Available', captured_at: folder.last_packet_at}},
            }})),
    };
    const onOpenPacket = vi.fn(), onDelete = vi.fn();
    const store = configureStore({reducer: {filebrowser: reducer,
        preferences: () => ({preferences: [{name: 'timezone', value: timezone}, {name: 'locale', value: 'en-GB'}]})}});
    const view = render(<Provider store={store}>
        <AprsFolderDialog folder={folder} socket={socket} onClose={vi.fn()}
            onOpenPacket={onOpenPacket} onDelete={onDelete} />
    </Provider>);
    return {...view, socket, onOpenPacket, onDelete};
}

test('opens grouped packets and retains their complete nested download paths', async () => {
    const {onOpenPacket, onDelete} = mount();
    const row = within((await screen.findByText('packet.bin')).closest('tr'));
    await waitFor(() => expect(row.getByRole('button', {name: 'View'})).toBeEnabled());
    expect(screen.getByTestId('path-map')).toHaveAttribute('data-kind', 'aprs');
    expect(screen.getByTestId('path-map')).toHaveAttribute('data-folder', folder.id);
    fireEvent.click(row.getByRole('button', {name: 'View'}));
    expect(onOpenPacket).toHaveBeenCalledWith(packet);
    expect(screen.getByRole('link', {name: 'Download packet.bin'})).toHaveAttribute('href', packet.url);
    expect(screen.getByRole('link', {name: 'Download all captures'})).toHaveAttribute('href', folder.download_url);
    fireEvent.click(screen.getByRole('button', {name: 'Delete station captures'}));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({id: folder.id}));
});

test('paginates and filters capture runs, then refreshes when packets are saved', async () => {
    const {socket} = mount();
    await screen.findByText('packet.bin');
    expect(screen.getByText('50 packets shown')).toBeInTheDocument();
    expect(screen.getByText('1–50 of 51 packets')).toBeInTheDocument();
    expect(screen.getByTestId('path-map')).toHaveAttribute('data-run', '');
    await waitFor(() => expect(screen.getByRole('button', {name: 'Go to page 2'})).toBeEnabled());
    fireEvent.click(screen.getByRole('button', {name: 'Go to page 2'}));
    await screen.findByText('older.bin');
    expect(screen.getByText('51–51 of 51 packets')).toBeInTheDocument();
    expect(socket.emit.mock.lastCall[1].data.page).toBe(2);
    fireEvent.mouseDown(screen.getByRole('combobox', {name: 'Capture run'}));
    fireEvent.click(await screen.findByRole('option', {name: `3 Nov 2026, 08:00:00 (${runName}) (3)`}));
    await waitFor(() => expect(socket.emit.mock.lastCall[1].data).toEqual({id: folder.id, page: 1, pageSize: 50, run: runName}));
    await screen.findByText('packet.bin');
    expect(screen.getByText('1–3 of 3 packets')).toBeInTheDocument();
    expect(screen.getByTestId('path-map')).toHaveAttribute('data-run', runName);
    const before = socket.emit.mock.calls.length;
    act(() => socket.on.mock.calls.find(([event]) => event === 'library.changed')[1]());
    await waitFor(() => expect(socket.emit.mock.calls.length).toBeGreaterThan(before));
    expect(socket.emit.mock.lastCall[1].data.run).toBe(runName);
    fireEvent.mouseDown(screen.getByRole('combobox', {name: 'Capture run'}));
    fireEvent.click(await screen.findByRole('option', {name: 'All runs'}));
    await waitFor(() => expect(socket.emit.mock.lastCall[1].data).toEqual({id: folder.id, page: 1, pageSize: 50}));
    expect(screen.getByTestId('path-map')).toHaveAttribute('data-run', '');
});

test('reports deleted or unavailable station captures', async () => {
    mount({failure: true});
    expect(await screen.findByRole('alert')).toHaveTextContent('Folder was removed');
    expect(screen.getByText('Packets are unavailable.')).toBeInTheDocument();
});

test('identifies the timezone and formats capture runs and packet times in user time', async () => {
    mount({timezone: 'Europe/Athens'});
    await screen.findByText('packet.bin');
    expect(screen.getByText('First received (Europe/Athens)')).toBeInTheDocument();
    expect(screen.getByText('Last received (Europe/Athens)')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', {name: 'Received (Europe/Athens)'})).toBeInTheDocument();
    expect(screen.getByRole('region', {name: 'Packet history'})).toHaveTextContent('Recorded APRS packets · Newest first');
    const row = within(screen.getByText('packet.bin').closest('tr'));
    expect(row.getByText('03/11/2026, 10:00:00')).toBeInTheDocument();
    expect(screen.getByText('03/11/2026, 10:15:00 (Europe/Athens)')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('combobox', {name: 'Capture run'}));
    expect(await screen.findByRole('option', {name: `3 Nov 2026, 10:00:00 (${runName}) (3)`})).toBeInTheDocument();
});

test('shows an empty history with a zero packet range', async () => {
    mount({empty: true});
    expect(await screen.findByText('No packets in this run.')).toBeInTheDocument();
    expect(screen.getByText('0 packets shown')).toBeInTheDocument();
    expect(screen.getByText('0–0 of 0 packets')).toBeInTheDocument();
});
