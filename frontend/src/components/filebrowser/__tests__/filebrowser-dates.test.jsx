import React from 'react';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';
import '../../../i18n/config.js';
import FileTableView from '../file-table-view.jsx';
import { getFileBrowserDate, isFileBrowserDateApproximate } from '../filebrowser-display-item.js';

const item = {
    id: 'audio:voice.wav', type: 'audio', name: 'voice', size: 10,
    captured_at: '2026-09-07T01:36:25Z', captured_at_source: 'metadata',
    completed_at: '2026-09-07T01:43:13Z',
    modified: '2026-10-29T17:07:02Z', created: '2026-10-30T12:00:00Z',
};

test.each([
    ['captured_at', item.captured_at],
    ['completed_at', item.completed_at],
    ['modified', item.modified],
    ['name', item.captured_at],
])('table rows display the date used for %s grouping', (sortBy, expected) => {
    render(<FileTableView
        filesByDay={[{ dateKey: 'Observation day', files: [item] }]}
        sortBy={sortBy} timezone="UTC" selectedItems={[]}
    />);
    expect(screen.getByText(new Date(expected).toLocaleTimeString('en-US', { timeZone: 'UTC' }))).toBeInTheDocument();
});

test('missing completion remains unknown instead of showing a capture or copy time', () => {
    const active = { ...item, completed_at: null };
    expect(getFileBrowserDate(active, 'completed_at')).toBeNull();
    render(<FileTableView
        filesByDay={[{ dateKey: 'Date unavailable', files: [active] }]}
        sortBy="completed_at" timezone="UTC" selectedItems={[]}
    />);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(screen.queryByText('5:07:02 PM')).not.toBeInTheDocument();
});

test('legacy and missing metadata use modification time and report an approximate capture date', () => {
    const legacy = { modified: item.modified, created: item.created };
    expect(getFileBrowserDate(legacy, 'captured_at')).toBe(item.modified);
    expect(isFileBrowserDateApproximate(legacy, 'captured_at')).toBe(true);
    expect(isFileBrowserDateApproximate(item, 'captured_at')).toBe(false);
    expect(isFileBrowserDateApproximate({ ...item, captured_at_source: 'filesystem' }, 'captured_at')).toBe(true);
    expect(isFileBrowserDateApproximate(legacy, 'modified')).toBe(false);
    render(<FileTableView
        filesByDay={[{ dateKey: 'Estimated date', files: [{ ...item, captured_at_source: 'filesystem' }] }]}
        timezone="UTC" selectedItems={[]}
    />);
    expect(screen.getByText('≈ 1:36:25 AM')).toBeInTheDocument();
});
