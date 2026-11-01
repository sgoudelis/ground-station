import React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import AircraftFolderDialog from '../aircraft-folder-dialog.jsx';

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (_key, fallback) => fallback})}));
vi.mock('../../../hooks/useUserTimeSettings.jsx', () => ({useUserTimeSettings: () => ({})}));
vi.mock('../../../utils/date-time.js', () => ({formatDateTime: (date) => date}));

it('tails history with its cursor, updates counts and replaces rows when a log resets', async () => {
    const handlers = new Map();
    const requests = [];
    const folder = {id: 'decoded_folder:adsb_406b90', icao: '406b90', packet_count: 1, run_count: 1};
    const socket = {
        connected: true,
        on: vi.fn((event, callback) => handlers.set(event, callback)),
        off: vi.fn((event) => handlers.delete(event)),
        timeout: () => socket,
        emit: vi.fn((_event, request, reply) => {
            if (request.cmd === 'filebrowser.item') reply(null, {success: true, data: folder});
            else requests.push({request, reply});
        }),
    };
    const state = (callsign) => ({icao: '406b90', callsign, timestamp: 1, captured_at: '2026-11-01', receiver_id: 'rx'});
    const respond = async (index, data) => act(async () => requests[index].reply(null, {success: true, data}));
    const {unmount} = render(<AircraftFolderDialog folder={folder} socket={socket} onClose={vi.fn()} onDelete={vi.fn()} />);
    await respond(0, {records: [state('FIRST')], cursor: {offset: 1, generation: 'a'}, start: 0, summary: folder});
    expect(screen.getByText('FIRST')).toBeInTheDocument();
    act(() => handlers.get('library.changed')({changes: [{id: folder.id}]}));
    expect(requests[1].request.data.cursor).toEqual({offset: 1, generation: 'a'});
    await respond(1, {records: [state('SECOND')], cursor: {offset: 2, generation: 'a'}, start: 1,
        summary: {...folder, packet_count: 2}});
    expect(screen.getByText('FIRST')).toBeInTheDocument();
    expect(screen.getByText('SECOND')).toBeInTheDocument();
    act(() => handlers.get('library.changed')({changes: [{id: folder.id}]}));
    await respond(2, {records: [state('REPLACED')], cursor: {offset: 1, generation: 'b'}, start: 0, reset: true});
    expect(screen.queryByText('FIRST')).not.toBeInTheDocument();
    expect(screen.getByText('REPLACED')).toBeInTheDocument();
    fireEvent.click(screen.getByText('REPLACED'));
    await waitFor(() => expect(screen.getByText(/"callsign": "REPLACED"/)).toBeInTheDocument());
    unmount();
    expect(handlers.size).toBe(0);
});
