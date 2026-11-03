import React from 'react';
import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {expect, it, vi} from 'vitest';
import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import AircraftFolderDialog from '../aircraft-folder-dialog.jsx';
import filebrowser from '../../../i18n/locales/en/filebrowser.json';
import common from '../../../i18n/locales/en/common.json';

await i18n.use(initReactI18next).init({lng: 'en', resources: {en: {filebrowser, common}}});
vi.mock('../../../hooks/useUserTimeSettings.jsx', () => ({useUserTimeSettings: () => ({timezone: 'UTC'})}));
vi.mock('../../../utils/date-time.js', () => ({formatDateTime: (date) => date}));

const state = (callsign, fields = {}) => ({icao: '406b90', callsign, timestamp: 1, captured_at: '2026-11-01', receiver_id: 'rx',
    aircraft: {registration: `G-${callsign}`, engine_type: 'P', military_status: 'unclassified', database: {version: 529}}, ...fields});

function renderDialog(fields = {}) {
    const handlers = new Map();
    const requests = [];
    const folder = {id: 'decoded_folder:adsb_406b90', icao: '406b90', packet_count: 1, run_count: 1, ...fields};
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
    const respond = async (index, data) => act(async () => requests[index].reply(null, {success: true, data}));
    return {...render(<AircraftFolderDialog folder={folder} socket={socket} onClose={vi.fn()} onDelete={vi.fn()} />),
        respond, requests, handlers, folder};
}

it('tails history with its cursor, updates counts and clears the selection when a log resets', async () => {
    const {respond, requests, handlers, folder, unmount} = renderDialog({aircraft: {registration: 'G-LATEST'}});
    await respond(0, {records: [state('FIRST')], cursor: {offset: 1, generation: 'a'}, start: 0, summary: folder});
    const history = within(screen.getByRole('table', {name: 'Aircraft history'}));
    expect(screen.getByRole('columnheader', {name: 'Classification'})).toBeInTheDocument();
    expect(history.getByText('FIRST')).toBeInTheDocument();
    expect(screen.getByText('1 update')).toBeInTheDocument();
    act(() => handlers.get('library.changed')({changes: [{id: folder.id}]}));
    expect(requests[1].request.data.cursor).toEqual({offset: 1, generation: 'a'});
    await respond(1, {records: [state('SECOND')], cursor: {offset: 2, generation: 'a'}, start: 1,
        summary: {...folder, packet_count: 2}});
    expect(history.getByText('FIRST')).toBeInTheDocument();
    expect(history.getByText('SECOND')).toBeInTheDocument();
    expect(screen.getByText('2 updates')).toBeInTheDocument();
    fireEvent.click(history.getByText('FIRST'));
    expect(screen.getByRole('dialog', {name: 'G-LATEST'})).toBeInTheDocument();
    act(() => handlers.get('library.changed')({changes: [{id: folder.id}]}));
    await respond(2, {records: [state('REPLACED')], cursor: {offset: 1, generation: 'b'}, start: 0, reset: true});
    expect(screen.queryByText('FIRST')).not.toBeInTheDocument();
    expect(history.getByText('REPLACED')).toBeInTheDocument();
    expect(screen.queryByRole('region', {name: /^Update received at/})).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', {name: 'G-LATEST'})).toBeInTheDocument();
    unmount();
    expect(handlers.size).toBe(0);
});

it('uses aircraft identity as the dialog title and keeps secondary details visible', async () => {
    const aircraft = {
        registration: 'G-TEST', model: 'CESSNA 172 Skyhawk', type_code: 'C172', engine_type: 'P',
        engine_count: 0, interesting: false, owner: '', year: null, operator_name: 'Example operator', operator_country: 'Greece',
    };
    const {respond, folder} = renderDialog({aircraft, callsign: 'LATEST', captured_at: '2026-10-30', last_packet_at: '2026-11-01'});
    await respond(0, {records: [state('HISTORICAL')], cursor: {offset: 1}, start: 0, summary: folder});
    const dialog = within(screen.getByRole('dialog', {name: 'G-TEST'}));
    const overview = within(screen.getByRole('region', {name: 'Aircraft overview'}));
    expect(dialog.getByRole('img', {name: 'ICAO registration country: United Kingdom'})).toHaveTextContent('🇬🇧');
    expect(dialog.getByText('Registration country: United Kingdom')).toBeInTheDocument();
    expect(overview.getByText('Operator (inferred)')).toBeInTheDocument();
    expect(overview.getByText('Greece')).toBeInTheDocument();
    expect(overview.getByText('First received (UTC)')).toBeInTheDocument();
    expect(overview.getByText('2026-10-30')).toBeInTheDocument();
    expect(overview.queryByRole('button', {name: 'Additional details'})).not.toBeInTheDocument();
    expect(overview.getByText('Piston')).toBeVisible();
    expect(overview.getByText('0')).toBeVisible();
    expect(overview.getByText('No')).toBeVisible();
    expect(overview.queryByText('Manufacture year')).not.toBeInTheDocument();
    expect(overview.queryByText('Owner / operator')).not.toBeInTheDocument();
});

it('expands historical data beneath its row while the overview stays tied to the latest capture', async () => {
    const {respond, handlers, folder} = renderDialog({aircraft: {registration: 'G-NEW'}, callsign: 'NEW',
        captured_at: '2026-10-30', last_packet_at: '2026-11-01'});
    const older = state('OLDER', {aircraft: undefined, on_ground: true, groundspeed_mps: 0, squawk: '0042', latitude: 0, longitude: 0,
        captured_at: '2026-10-31'});
    await respond(0, {records: [older, state('NEW')], cursor: {offset: 2}, start: 0, summary: folder});
    const historyElement = screen.getByRole('table', {name: 'Aircraft history'});
    const history = within(historyElement);
    const olderRow = history.getByText('OLDER').closest('tr');
    fireEvent.keyDown(olderRow, {key: 'Enter'});
    const overviewElement = screen.getByRole('region', {name: 'Aircraft overview'});
    const overview = within(overviewElement);
    const overviewBefore = overviewElement.textContent;
    expect(overview.getByText('Latest captured details · 2026-11-01 (UTC)')).toBeInTheDocument();
    expect(screen.getByRole('dialog', {name: 'G-NEW'})).toBeInTheDocument();
    const selectedElement = screen.getByRole('region', {name: 'Update received at 2026-10-31 (UTC)'});
    const selected = within(selectedElement);
    expect(olderRow.nextElementSibling).toContainElement(selectedElement);
    expect(historyElement).toContainElement(selectedElement);
    expect(selected.getByText('On ground')).toBeInTheDocument();
    expect(selected.getByText('0.0')).toBeInTheDocument();
    expect(selected.getByText('0042')).toBeInTheDocument();
    expect(selected.getByText('0.000000, 0.000000')).toBeInTheDocument();
    expect(selected.getByText('Aircraft metadata was not recorded for this update.')).toBeInTheDocument();
    expect(selected.queryByText('G-NEW')).not.toBeInTheDocument();
    const raw = selected.getByText('Raw data (JSON)').closest('details');
    expect(raw).not.toHaveAttribute('open');
    fireEvent.click(selected.getByText('Raw data (JSON)'));
    expect(raw).toHaveAttribute('open');
    expect(selected.getByText(/"callsign": "OLDER"/)).toBeVisible();
    act(() => handlers.get('library.changed')({changes: [{id: folder.id}]}));
    await respond(1, {records: [state('NEWEST')], cursor: {offset: 3}, start: 2});
    expect(overviewElement.textContent).toBe(overviewBefore);
    expect(screen.getByRole('region', {name: 'Update received at 2026-10-31 (UTC)'})).toBe(selectedElement);
    expect(raw).toHaveAttribute('open');
    // Advancing the actual capture summary updates the overview without replacing the snapshot.
    act(() => handlers.get('library.changed')({changes: [{id: folder.id}]}));
    await respond(2, {records: [state('LIVE')], cursor: {offset: 4}, start: 3,
        summary: {...folder, aircraft: {registration: 'G-LIVE'}, callsign: 'LIVE', last_packet_at: '2026-11-02'}});
    expect(screen.getByRole('dialog', {name: 'G-LIVE'})).toBeInTheDocument();
    expect(overview.getByText('Latest captured details · 2026-11-02 (UTC)')).toBeInTheDocument();
    expect(overview.getByText('2026-10-30')).toBeInTheDocument();
    expect(selected.getByText('Aircraft metadata was not recorded for this update.')).toBeInTheDocument();
    expect(raw).toHaveAttribute('open');
    fireEvent.click(selected.getByRole('button', {name: 'Collapse update details'}));
    expect(screen.queryByRole('region', {name: /^Update received at/})).not.toBeInTheDocument();
    expect(within(olderRow).getByRole('button')).toHaveFocus();
    expect(overview.queryByRole('button', {name: 'Return to latest update'})).not.toBeInTheDocument();
});

it('toggles a single inline update by row, chevron or keyboard and never fills metadata gaps from the summary', async () => {
    const {respond, folder} = renderDialog({aircraft: {registration: 'G-NEW', operator_name: 'Current operator'}});
    await respond(0, {records: [state('PARTIAL', {aircraft: {registration: 'G-OLD', engine_count: 0, interesting: false},
        captured_at: '2026-10-31'}), state('NEW')], cursor: {offset: 2}, start: 0, summary: folder});
    const history = within(screen.getByRole('table', {name: 'Aircraft history'}));
    const partialRow = history.getByText('PARTIAL').closest('tr');
    const partialToggle = within(partialRow).getByRole('button');
    fireEvent.click(partialToggle);
    expect(partialToggle).toHaveAttribute('aria-expanded', 'true');
    const historical = within(screen.getByRole('region', {name: 'Update received at 2026-10-31 (UTC)'}));
    expect(historical.getByText('G-OLD')).toBeInTheDocument();
    expect(historical.getByText('0')).toBeInTheDocument();
    expect(historical.getByText('No')).toBeInTheDocument();
    expect(historical.queryByText('Current operator')).not.toBeInTheDocument();
    expect(historical.getAllByText('Not recorded').length).toBeGreaterThan(0);
    fireEvent.click(partialToggle);
    expect(partialToggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('region', {name: /^Update received at/})).not.toBeInTheDocument();
    fireEvent.keyDown(partialRow, {key: ' '});
    fireEvent.click(history.getByText('NEW'));
    expect(screen.getAllByRole('region', {name: /^Update received at/})).toHaveLength(1);
    expect(screen.getByRole('region', {name: 'Update received at 2026-11-01 (UTC)'})).toBeInTheDocument();
    expect(partialToggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(history.getByText('NEW', {selector: 'span'}));
    expect(screen.queryByRole('region', {name: /^Update received at/})).not.toBeInTheDocument();
});

it('preserves an inspected update and its raw disclosure when it leaves the rolling live window', async () => {
    const {respond, handlers, folder} = renderDialog();
    await respond(0, {records: [state('PINNED')], cursor: {offset: 1}, start: 0});
    fireEvent.click(screen.getByText('PINNED'));
    const selected = screen.getByRole('region', {name: /^Update received at/});
    const raw = within(selected).getByText('Raw data (JSON)').closest('details');
    fireEvent.click(within(selected).getByText('Raw data (JSON)'));
    act(() => handlers.get('library.changed')({changes: [{id: folder.id}]}));
    await respond(1, {records: Array.from({length: 50}, (_, index) => state(`LIVE${index}`)), cursor: {offset: 51}, start: 1});
    expect(screen.getByRole('region', {name: /^Update received at/})).toBe(selected);
    expect(raw).toHaveAttribute('open');
    expect(screen.getByText('51 updates shown')).toBeInTheDocument();
    fireEvent.click(within(selected).getByRole('button', {name: 'Collapse update details'}));
    expect(screen.getByText('50 updates shown')).toBeInTheDocument();
    expect(screen.queryByText('PINNED')).not.toBeInTheDocument();
});

it('closes row details on paging or run filtering without changing the latest overview', async () => {
    const {respond, requests, folder} = renderDialog({aircraft: {registration: 'G-LATEST'}, callsign: 'LATEST',
        last_packet_at: '2026-11-03', runs: [{name: '20261101T000000Z.gsadsb'}]});
    await respond(0, {records: [state('OLDER')], cursor: {offset: 110}, start: 60, summary: folder});
    const overview = screen.getByRole('region', {name: 'Aircraft overview'});
    const overviewBefore = overview.textContent;
    fireEvent.click(screen.getByText('OLDER'));
    fireEvent.click(screen.getByRole('button', {name: 'Older updates'}));
    expect(screen.queryByRole('region', {name: /^Update received at/})).not.toBeInTheDocument();
    expect(requests[1].request.data.cursor).toBe(10);
    await respond(1, {records: [state('OLDEST')], cursor: {offset: 60}, start: 10, summary: folder});
    expect(overview.textContent).toBe(overviewBefore);
    fireEvent.click(screen.getByText('OLDEST'));
    fireEvent.click(screen.getByRole('button', {name: 'Latest updates'}));
    expect(screen.queryByRole('region', {name: /^Update received at/})).not.toBeInTheDocument();
    await respond(2, {records: [state('LATEST')], cursor: {offset: 110}, start: 60, summary: folder});
    fireEvent.click(within(screen.getByRole('table')).getByText('LATEST'));
    fireEvent.mouseDown(screen.getByRole('combobox', {name: 'Capture run'}));
    fireEvent.click(screen.getAllByRole('option')[1]);
    expect(screen.queryByRole('region', {name: /^Update received at/})).not.toBeInTheDocument();
    expect(requests[3].request.data.run).toBe('20261101T000000Z.gsadsb');
    await respond(3, {records: [state('FILTERED')], cursor: {offset: 1}, start: 0, summary: folder});
    expect(screen.getByRole('dialog', {name: 'G-LATEST'})).toBeInTheDocument();
    expect(overview.textContent).toBe(overviewBefore);
});

it('falls back to the ICAO address without inventing a country or empty optional fields', async () => {
    const {respond} = renderDialog({icao: 'ffffff'});
    await respond(0, {records: [], cursor: {offset: 0}, start: 0});
    const overview = within(screen.getByRole('region', {name: 'Aircraft overview'}));
    expect(screen.getByRole('dialog', {name: 'FFFFFF'})).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(overview.queryByRole('button', {name: 'Additional details'})).not.toBeInTheDocument();
    expect(screen.getByText('No recorded updates to display.')).toBeInTheDocument();
});
