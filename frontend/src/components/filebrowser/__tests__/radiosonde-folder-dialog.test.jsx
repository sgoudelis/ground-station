import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { expect, test, vi } from 'vitest';
import '../../../i18n/config.js';
import RadiosondeFolderDialog from '../radiosonde-folder-dialog.jsx';
import reducer from '../filebrowser-slice.jsx';

vi.mock('../../../hooks/useUserTimeSettings.jsx', () => ({
    useUserTimeSettings: () => ({ timezone: 'UTC', locale: 'en-GB' }),
}));

vi.mock('../flight-path-map.jsx', () => ({default: ({filter, run}) => <section data-testid="flight-path-map" data-run={run}>{filter}</section>}));

const runName = '20261101T103000.000000Z.gssonde';
const folder = {
    id: 'decoded_folder:radiosonde_RS41_TEST0042', name: 'RS41 TEST0042',
    model: 'RS41', serial: 'TEST0042', packet_count: 51, run_count: 2,
    captured_at: '2026-11-01T10:30:00Z', last_packet_at: '2026-11-01T10:45:00Z',
    download_url: '/api/decoded/radiosonde_RS41_TEST0042/download',
};
const packet = {
    filename: 'packet.bin', path: `radiosonde_RS41_TEST0042/${runName}/packet.bin`,
    url: `/decoded/radiosonde_RS41_TEST0042/${runName}/packet.bin`,
    type: 'decoded', frame: 42, captured_at: folder.captured_at,
};

function mount({ failure = false, fields = {}, packets } = {}) {
    const summary = {...folder, ...fields};
    const socket = {
        connected: true, on: vi.fn(), off: vi.fn(),
        emit: vi.fn((_event, { data }, callback) => callback(failure
            ? { success: false, error: 'Folder was removed' }
            : { success: true, data: {
                ...summary, page: data.page, total: fields.total ?? (data.run ? 3 : 51), page_size: 50,
                packets: packets || [{ ...packet, filename: data.page === 2 ? 'last.bin' : 'packet.bin' }],
                runs: fields.runs || [{ name: runName, packet_count: 3 }],
            } })),
    };
    const onOpenPacket = vi.fn();
    const onDelete = vi.fn();
    const store = configureStore({ reducer: { filebrowser: reducer } });
    render(<Provider store={store}><RadiosondeFolderDialog folder={summary} socket={socket}
        onClose={vi.fn()} onOpenPacket={onOpenPacket} onDelete={onDelete} /></Provider>);
    return { socket, onOpenPacket, onDelete };
}

test('opens packets using full nested URLs and downloads the complete sonde folder', async () => {
    const { onOpenPacket, onDelete } = mount();
    expect(await screen.findByText('packet.bin')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'View' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(onOpenPacket).toHaveBeenCalledWith(packet);
    expect(screen.getByRole('link', { name: 'Download packet.bin' })).toHaveAttribute('href', packet.url);
    expect(screen.getByRole('link', { name: 'Download all captures' })).toHaveAttribute('href', folder.download_url);
    fireEvent.click(screen.getByRole('button', { name: 'Delete sonde captures' }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: folder.id }));
});

test('requests bounded packet pages and resets to the first page when filtering by run', async () => {
    const { socket } = mount();
    await screen.findByText('packet.bin');
    expect(screen.getByRole('combobox', { name: 'Flight' })).toHaveTextContent('All flights');
    expect(screen.getByTestId('flight-path-map')).toHaveAttribute('data-run', '');
    const overview = screen.getByRole('region', {name: 'Radiosonde details'});
    const overviewBefore = overview.textContent;
    await waitFor(() => expect(screen.getByRole('button', { name: 'Go to page 2' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Go to page 2' }));
    await screen.findByText('last.bin');
    expect(socket.emit.mock.lastCall[1]).toEqual({ cmd: 'filebrowser.item', data: {
        id: folder.id, page: 2, pageSize: 50,
    } });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Flight' }));
    fireEvent.click(await screen.findByRole('option', { name: `1 Nov 2026, 10:30:00 (${runName}) (3)` }));
    await waitFor(() => expect(socket.emit.mock.lastCall[1].data).toEqual({
        id: folder.id, page: 1, pageSize: 50, run: runName,
    }));
    expect(screen.getByTestId('flight-path-map')).toHaveAttribute('data-run', runName);
    expect(await screen.findByText('packet.bin')).toBeInTheDocument();
    const refresh = socket.on.mock.calls.find(([event]) => event === 'library.changed')[1];
    const before = socket.emit.mock.calls.length;
    act(() => refresh());
    await waitFor(() => expect(socket.emit.mock.calls.length).toBeGreaterThan(before));
    expect(socket.emit.mock.lastCall[1].data.run).toBe(runName);
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Flight' }));
    fireEvent.click(await screen.findByRole('option', { name: 'All flights' }));
    await waitFor(() => expect(socket.emit.mock.lastCall[1].data).toEqual({
        id: folder.id, page: 1, pageSize: 50,
    }));
    expect(screen.getByRole('combobox', { name: 'Flight' })).toHaveTextContent('All flights');
    expect(screen.getByRole('dialog', {name: 'TEST0042'})).toBeInTheDocument();
    expect(overview.textContent).toBe(overviewBefore);
});

test('shows a useful error when a folder disappears', async () => {
    mount({ failure: true });
    expect(await screen.findByRole('alert')).toHaveTextContent('Folder was removed');
});


test('uses serial identity, model and correctly pluralized capture counts in an accessible header', async () => {
    mount({fields: {model: 'M20', serial: 'SERIAL-0042', name: 'Archive label', packet_count: 1, run_count: 1, total: 1}});
    await screen.findByText('packet.bin');
    const dialog = within(screen.getByRole('dialog', {name: 'SERIAL-0042'}));
    expect(dialog.getByRole('heading', {name: 'SERIAL-0042'})).toBeInTheDocument();
    expect(dialog.getByText('1 packet')).toBeInTheDocument();
    expect(dialog.getByText('1 flight')).toBeInTheDocument();
    const overview = within(screen.getByRole('region', {name: 'Radiosonde details'}));
    expect(overview.getByText('M20')).toBeInTheDocument();
    expect(overview.getByText('SERIAL-0042')).toBeInTheDocument();
    expect(overview.getByText('First received (UTC)')).toBeInTheDocument();
    expect(overview.getByText('Last received (UTC)')).toBeInTheDocument();
    expect(overview.getByText('Capture summary · All flights')).toBeInTheDocument();
    expect(dialog.getByText('1 packet shown')).toBeInTheDocument();
    expect(dialog.getByText('1–1 of 1 packet')).toBeInTheDocument();
});

test('keeps frame zero distinct from missing frames and displays localized frame counts', async () => {
    mount({packets: [
        {...packet, filename: 'zero.bin', path: 'zero.bin', frame: 0},
        {...packet, filename: 'missing.bin', path: 'missing.bin', frame: null},
        {...packet, filename: 'numbered.bin', path: 'numbered.bin', frame: 58422},
    ]});
    await screen.findByText('zero.bin');
    const table = within(screen.getByRole('table', {name: 'Radiosonde packets'}));
    expect(table.getByRole('columnheader', {name: 'Received (UTC)'})).toBeInTheDocument();
    expect(within(table.getByText('zero.bin').closest('tr')).getByRole('cell', {name: '0'})).toBeInTheDocument();
    expect(within(table.getByText('missing.bin').closest('tr')).getByRole('cell', {name: '—'})).toBeInTheDocument();
    expect(within(table.getByText('numbered.bin').closest('tr')).getByRole('cell', {name: '58,422'})).toBeInTheDocument();
});

test('shows unavailable identity fields and retains the legacy-flight filter in an empty archive', async () => {
    const {socket} = mount({fields: {model: null, serial: null, name: 'Archived radiosonde', total: 0,
        packet_count: 0, run_count: 1, runs: [{name: 'legacy', packet_count: 0}]}, packets: []});
    await screen.findByText('No packets in this flight.');
    expect(screen.getByRole('dialog', {name: 'Archived radiosonde'})).toBeInTheDocument();
    const overview = within(screen.getByRole('region', {name: 'Radiosonde details'}));
    expect(overview.getAllByText('—')).toHaveLength(2);
    expect(screen.getByText('0 packets shown')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('combobox', {name: 'Flight'}));
    fireEvent.click(await screen.findByRole('option', {name: 'Legacy packets (0)'}));
    await waitFor(() => expect(socket.emit.mock.lastCall[1].data.run).toBe('legacy'));
});
