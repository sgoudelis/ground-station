import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { expect, test, vi } from 'vitest';
import '../../../i18n/config.js';
import RadiosondeFolderDialog from '../radiosonde-folder-dialog.jsx';
import reducer from '../filebrowser-slice.jsx';

vi.mock('../../../hooks/useUserTimeSettings.jsx', () => ({
    useUserTimeSettings: () => ({ timezone: 'UTC', locale: 'en-GB' }),
}));

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

function mount({ failure = false } = {}) {
    const socket = {
        connected: true, on: vi.fn(), off: vi.fn(),
        emit: vi.fn((_event, { data }, callback) => callback(failure
            ? { success: false, error: 'Folder was removed' }
            : { success: true, data: {
                ...folder, page: data.page, total: data.run ? 3 : 51, page_size: 50,
                packets: [{ ...packet, filename: data.page === 2 ? 'last.bin' : 'packet.bin' }],
                runs: [{ name: runName, packet_count: 3 }],
            } })),
    };
    const onOpenPacket = vi.fn();
    const onDelete = vi.fn();
    const store = configureStore({ reducer: { filebrowser: reducer } });
    render(<Provider store={store}><RadiosondeFolderDialog folder={folder} socket={socket}
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
});

test('shows a useful error when a folder disappears', async () => {
    mount({ failure: true });
    expect(await screen.findByRole('alert')).toHaveTextContent('Folder was removed');
});
