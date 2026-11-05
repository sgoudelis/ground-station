import React from 'react';
import {fireEvent, render, screen, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {beforeEach, expect, test, vi} from 'vitest';
import '../../../i18n/config.js';
import {mockViewport} from '../../../test/viewport.js';
import FileTableView from '../file-table-view.jsx';
import {getFileBrowserSource} from '../filebrowser-display-item.js';

beforeEach(() => mockViewport(1280));

const recording = {
    id: 'recording:pass', type: 'recording', displayName: 'pass.sigmf-data', data_size: 4096,
    duration: '02:35', metadata: {target_satellite_name: 'ISS'},
    latest_activity: '2026-11-05T08:15:00Z', captured_at_source: 'metadata',
};

function renderTable(items = [recording], props = {}) {
    const callbacks = {
        onShowDetails: vi.fn(), onToggleSelection: vi.fn(), onDownload: vi.fn(),
        onDelete: vi.fn(), onProcessingMenu: vi.fn(),
    };
    const view = render(<FileTableView
        filesByDay={[{dateKey: 'November 5, 2026', files: items}]}
        selectedItems={[]} timezone="UTC" {...callbacks} {...props}
    />);
    return {...callbacks, ...view};
}

test.each([
    [1280, ['Name', 'Type', 'Source', 'Summary', 'Size', 'Last Activity', 'Actions']],
    [1000, ['Name', 'Type', 'Source', 'Last Activity', 'Actions']],
    [700, ['Name', 'Source', 'Last Activity', 'Actions']],
    [390, ['Name', 'Actions']],
])('uses the intended columns at %ipx and retains context in compact rows', (width, headers) => {
    mockViewport(width);
    renderTable();
    expect(screen.getAllByRole('columnheader').map(cell => cell.getAttribute('aria-label') || cell.textContent)).toEqual(headers);
    expect(screen.queryByRole('columnheader', {name: 'Satellite'})).not.toBeInTheDocument();
    const row = screen.getByText('pass.sigmf-data').closest('tr');
    expect(within(row).getAllByRole('cell')).toHaveLength(headers.length);
    expect(within(row).getByText('ISS')).toBeInTheDocument();
    expect(within(row).getByText('IQ Recording')).toBeInTheDocument();
    expect(within(row).getByText('8:15:00 AM')).toBeInTheDocument();
    if (width >= 1200) expect(within(row).getByText('02:35')).toBeInTheDocument();
    else expect(within(row).queryByText('02:35')).not.toBeInTheDocument();
});

test('shows source identities and summaries across capture types', () => {
    const capture = (id, folder_kind, extra) => ({
        id, type: 'decoded_folder', folder_kind, displayName: id, size: 10,
        packet_count: 21, run_count: 2, ...extra,
    });
    const items = [
        recording,
        capture('aircraft', 'adsb', {icao: 'abc123', callsign: 'AEE001', aircraft: {registration: 'SX-TEST'}}),
        capture('mesh', 'meshtastic', {long_name: 'Hilltop', node_id: '!abcd1234'}),
        capture('station', 'aprs', {source_callsign: 'SV1ABC-9'}),
        capture('balloon', 'radiosonde', {model: 'RS41', serial: 'TEST0042'}),
        capture('observation', 'observation', {satellite_name: 'METEOR-M', artifact_count: 6}),
        capture('weather-images', 'satdump', {image_count: 1}),
        {id: 'audio', type: 'audio', displayName: 'voice.wav', duration_seconds: 3661},
        {id: 'snapshot', type: 'snapshot', displayName: 'waterfall.png', width: 800, height: 600},
    ];
    renderTable(items);
    const check = (name, source, summary) => {
        const row = within(screen.getByText(name).closest('tr'));
        if (source) expect(row.getByText(source)).toBeInTheDocument();
        expect(row.getByText(summary)).toBeInTheDocument();
    };
    check('aircraft', 'SX-TEST · AEE001 · ABC123', '21 updates · 2 runs');
    check('mesh', 'Hilltop · !abcd1234', '21 packets · 2 runs');
    check('station', 'SV1ABC-9', '21 packets · 2 runs');
    check('balloon', 'TEST0042', '21 packets · 2 flights');
    check('observation', 'METEOR-M', '6 files');
    check('weather-images', null, '1 image');
    check('voice.wav', null, '1:01:01');
    check('waterfall.png', null, '800 × 600');
});

test('keeps APRS stations separate from legacy satellite labels', () => {
    expect(getFileBrowserSource({type: 'decoded', decoder_type: 'APRS', source_callsign: 'SV1ABC', satellite_name: 'ISS'})).toBe('SV1ABC');
    expect(getFileBrowserSource({type: 'decoded', decoder_type: 'APRS', satellite_name: 'SV1ABC'})).toBe('');
    expect(getFileBrowserSource({type: 'decoded', decoder_type: 'APRS', satellite_name: 'ISS', satellite_norad_id: 25544})).toBe('ISS');
    expect(getFileBrowserSource({satellite_norad_id: 25544})).toBe('NORAD 25544');
});

test.each([1280, 390])('does not repeat a source already used as the name at %ipx', width => {
    mockViewport(width);
    renderTable([{id: 'station', type: 'decoded_folder', folder_kind: 'aprs', displayName: 'SV1ABC', source_callsign: 'SV1ABC'}]);
    expect(screen.getAllByText('SV1ABC')).toHaveLength(1);
});

test.each([
    {type: 'recording', recording_in_progress: true, label: 'Recording'},
    {type: 'audio', status: 'recording', label: 'Recording'},
    {type: 'decoded_folder', folder_kind: 'observation', observation_in_progress: true, label: 'In progress'},
])('retains the active $type indicator on mobile', ({label, ...item}) => {
    mockViewport(390);
    renderTable([{...recording, ...item}]);
    expect(screen.getByText(label)).toBeInTheDocument();
});

test('row and keyboard activation open details, while action clicks stay on the chosen item', async () => {
    const user = userEvent.setup();
    const other = {...recording, id: 'other', displayName: 'other.sigmf-data'};
    const callbacks = renderTable([recording, other]);
    const row = screen.getByText(recording.displayName).closest('tr');
    await user.click(screen.getByText(recording.displayName));
    expect(callbacks.onShowDetails).toHaveBeenLastCalledWith(recording);
    fireEvent.keyDown(row, {key: 'Enter'});
    expect(callbacks.onShowDetails).toHaveBeenCalledTimes(2);

    await user.click(screen.getByRole('button', {name: 'Actions for other.sigmf-data'}));
    expect(callbacks.onShowDetails).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole('menuitem', {name: 'Download'}));
    expect(callbacks.onDownload).toHaveBeenCalledExactlyOnceWith(other);
    expect(callbacks.onDelete).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', {name: 'Actions for pass.sigmf-data'}));
    await user.click(screen.getByRole('menuitem', {name: 'Delete'}));
    expect(callbacks.onDelete).toHaveBeenCalledExactlyOnceWith(recording);
});

test('recording processing uses the stable row button as its anchor', async () => {
    const user = userEvent.setup();
    const {onProcessingMenu} = renderTable();
    const button = screen.getByRole('button', {name: 'Actions for pass.sigmf-data'});
    await user.click(button);
    await user.click(screen.getByRole('menuitem', {name: 'Recording Actions'}));
    expect(onProcessingMenu).toHaveBeenCalledExactlyOnceWith({currentTarget: button}, recording);
    expect(button).toBeInTheDocument();
});

test('non-recording actions omit processing and retain the details entry', async () => {
    const user = userEvent.setup();
    const item = {...recording, type: 'audio'};
    const {onShowDetails} = renderTable([item]);
    await user.click(screen.getByRole('button', {name: 'Actions for pass.sigmf-data'}));
    expect(screen.queryByRole('menuitem', {name: 'Recording Actions'})).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', {name: 'View Details'}));
    expect(onShowDetails).toHaveBeenCalledExactlyOnceWith(item);
});

test('mobile selection preserves checkbox and row selection without opening details', async () => {
    mockViewport(390);
    const user = userEvent.setup();
    const {onToggleSelection, onShowDetails} = renderTable([recording], {selectionMode: true, selectedItems: [recording.id]});
    const checkbox = screen.getByRole('checkbox', {name: 'Select pass.sigmf-data'});
    expect(checkbox).toBeChecked();
    await user.click(checkbox);
    expect(onToggleSelection).toHaveBeenCalledExactlyOnceWith(recording);
    await user.click(screen.getByText(recording.displayName));
    expect(onToggleSelection).toHaveBeenCalledTimes(2);
    expect(onShowDetails).not.toHaveBeenCalled();
    expect(screen.getAllByRole('columnheader')).toHaveLength(3);
});
