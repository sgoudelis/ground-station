/**
 * @license
 * Copyright (c) 2026 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

import { configureStore } from '@reduxjs/toolkit';
import { expect, test, vi } from 'vitest';
import reducer, {
    deleteLibraryItems,
    checkForNewFiles,
    fetchFiles,
    fetchPurgePreview,
    startLibraryPurge,
    purgeProgressUpdated,
    purgeFinished,
    clearPurgeState,
    setPageSize,
    setPage,
    setSearch,
    toggleItemSelection,
    setAllFilters,
    toggleFilter,
    reconcileFileBrowserPersistedState,
    markFileBrowserVisited,
} from '../filebrowser-slice.jsx';

function createStore() {
    return configureStore({ reducer: { filebrowser: reducer } });
}

test('rehydrates the new observation filter from the former decoded choice', () => {
    const current = reducer(undefined, { type: '@@INIT' });
    const restored = reconcileFileBrowserPersistedState({
        filters: { showDecoded: false, showAudio: true },
    }, current);

    expect(restored.filters).toMatchObject({ showDecoded: false, showObservations: false });
    const changed = reducer(restored, toggleFilter('showObservations'));
    expect(changed.filters).toMatchObject({ showDecoded: false, showObservations: true });
    expect(changed.page).toBe(1);
});

test('uses capture chronology by default and migrates the former created sort', () => {
    const current = reducer(undefined, { type: '@@INIT' });
    expect(current.sortBy).toBe('captured_at');
    expect(reconcileFileBrowserPersistedState({ sortBy: 'created' }, current).sortBy).toBe('captured_at');
    expect(reconcileFileBrowserPersistedState({ sortBy: 'modified' }, current).sortBy).toBe('modified');
});

test('explicit refresh rescans copied files before requesting the current page', async () => {
    const socket = {
        connected: true,
        emit: vi.fn((_event, request, callback) => callback({ success: true, data: { items: [], page: 1 } })),
    };
    await createStore().dispatch(fetchFiles({ socket, reconcile: true })).unwrap();
    expect(socket.emit.mock.calls.map((call) => call[1].cmd)).toEqual(['filebrowser.reconcile', 'filebrowser.query']);
    expect(socket.emit.mock.calls[1][1].data.sortBy).toBe('captured_at');
});

test('selecting or clearing every type updates filters in one action', () => {
    const store = createStore();
    store.dispatch(setPage(3));
    store.dispatch(setAllFilters(false));

    expect(Object.values(store.getState().filebrowser.filters).every((enabled) => !enabled)).toBe(true);
    expect(store.getState().filebrowser.page).toBe(1);

    store.dispatch(setAllFilters(true));
    expect(Object.values(store.getState().filebrowser.filters).every(Boolean)).toBe(true);
});

test('queries one server-side page and stores its total', async () => {
    const socket = {
        connected: true,
        emit: vi.fn((event, payload, callback) => {
            expect(event).toBe('api.call');
            expect(payload).toEqual({
                cmd: 'filebrowser.query',
                data: {
                    filters: { showAudio: true },
                    search: '',
                    sortBy: 'modified',
                    sortOrder: 'desc',
                    page: 3,
                    pageSize: 25,
                },
            });
            callback({
                success: true,
                data: {
                    items: [{ id: 'audio:voice.wav', type: 'audio', filename: 'voice.wav' }],
                    total: 51,
                    diskUsage: { total: 100, used: 20, available: 80 },
                },
            });
        }),
    };
    const store = createStore();
    store.dispatch(setPage(3));

    await store.dispatch(fetchFiles({
        socket,
        filters: { showAudio: true },
        sortBy: 'modified',
        sortOrder: 'desc',
        page: 3,
        pageSize: 25,
    })).unwrap();

    expect(store.getState().filebrowser.files).toEqual([
        { id: 'audio:voice.wav', type: 'audio', filename: 'voice.wav' },
    ]);
    expect(store.getState().filebrowser.total).toBe(51);
});

test('checks the newest file independently of the visible page and keeps the notification until a visit', async () => {
    const store = createStore();
    store.dispatch(setPage(3));
    store.dispatch(setAllFilters(false));
    store.dispatch(setPage(3));
    const created = new Date(Date.now() + 1000).toISOString();
    const socket = {
        connected: true,
        emit: vi.fn((event, payload, callback) => {
            expect(event).toBe('api.call');
            expect(payload).toEqual({
                cmd: 'filebrowser.query',
                data: { sortBy: 'created', sortOrder: 'desc', page: 1, pageSize: 1 },
            });
            callback({ success: true, data: { items: [{ id: 'new-file', created }] } });
        }),
    };

    await store.dispatch(checkForNewFiles({ socket })).unwrap();
    expect(store.getState().filebrowser.hasNewFiles).toBe(true);
    expect(store.getState().filebrowser.page).toBe(3);
    expect(Object.values(store.getState().filebrowser.filters).every((enabled) => !enabled)).toBe(true);

    const visiblePageSocket = {
        connected: true,
        emit: (_event, _payload, callback) => callback({ success: true, data: { page: 3, items: [], total: 0 } }),
    };
    await store.dispatch(fetchFiles({ socket: visiblePageSocket, page: 3 }));
    expect(store.getState().filebrowser.hasNewFiles).toBe(true);

    store.dispatch(markFileBrowserVisited());
    expect(store.getState().filebrowser.hasNewFiles).toBe(false);
});

test('an older file or delayed check cannot create or clear a new-files notification', async () => {
    const store = createStore();
    const oldCreated = new Date(Date.now() - 60_000).toISOString();
    let reply;
    const socket = {
        connected: true,
        emit: vi.fn((_event, _payload, callback) => { reply = callback; }),
    };

    const pending = store.dispatch(checkForNewFiles({ socket }));
    store.dispatch(markFileBrowserVisited());
    reply({ success: true, data: { items: [{ created: oldCreated, modified: new Date(Date.now() + 1000).toISOString() }] } });
    await pending;
    expect(store.getState().filebrowser.hasNewFiles).toBe(false);
});

test('late page replies cannot change the selected page or visible files', async () => {
    const replies = new Map();
    const socket = {
        connected: true,
        emit: vi.fn((event, payload, callback) => {
            expect(event).toBe('api.call');
            expect(payload.cmd).toBe('filebrowser.query');
            replies.set(payload.data.page, callback);
        }),
    };
    const store = createStore();
    const requests = [store.dispatch(fetchFiles({ socket, page: 1, pageSize: 12 }))];
    store.dispatch(setPage(2));
    requests.push(store.dispatch(fetchFiles({ socket, page: 2, pageSize: 12 })));
    store.dispatch(setPage(3));
    requests.push(store.dispatch(fetchFiles({ socket, page: 3, pageSize: 12 })));

    const reply = (page) => replies.get(page)({
        success: true,
        data: { page, items: [{ id: `page-${page}` }], total: 36 },
    });
    reply(2);
    await requests[1];
    expect(store.getState().filebrowser.page).toBe(3);
    expect(store.getState().filebrowser.filesLoading).toBe(true);

    reply(3);
    await requests[2];
    reply(1);
    await requests[0];

    expect(store.getState().filebrowser.page).toBe(3);
    expect(store.getState().filebrowser.files).toEqual([{ id: 'page-3' }]);
    expect(store.getState().filebrowser.filesLoading).toBe(false);
});

test('a page click invalidates the previous reply before the next request starts', async () => {
    let reply;
    const socket = {
        connected: true,
        emit: vi.fn((event, payload, callback) => {
            expect(event).toBe('api.call');
            expect(payload.data.page).toBe(1);
            reply = callback;
        }),
    };
    const store = createStore();
    const request = store.dispatch(fetchFiles({ socket, page: 1 }));

    store.dispatch(setPage(3));
    reply({ success: true, data: { page: 1, items: [{ id: 'page-1' }], total: 36 } });
    await request;

    expect(store.getState().filebrowser.page).toBe(3);
    expect(store.getState().filebrowser.files).toEqual([]);
});

test('search changes clear selection, restart paging, and discard an older reply before fetching again', async () => {
    const store = createStore();
    let reply;
    const socket = { connected: true, emit: (_event, _payload, callback) => { reply = callback; } };
    const pending = store.dispatch(fetchFiles({ socket, page: 1, search: '' }));
    store.dispatch(toggleItemSelection('decoded:old.bin'));
    store.dispatch(setSearch('  ISS   APRS  '));
    expect(store.getState().filebrowser).toMatchObject({
        search: 'ISS APRS', page: 1, selectedItems: [], filesRequestId: null,
    });
    reply({ success: true, data: { items: [{ id: 'old' }], total: 1, page: 1 } });
    await pending;
    expect(store.getState().filebrowser.files).toEqual([]);

    store.dispatch(setPage(3));
    store.dispatch(setSearch('NOAA'));
    expect(store.getState().filebrowser.page).toBe(1);
});

test('search requests can finish out of order without changing results or reporting an obsolete error', async () => {
    const store = createStore();
    const replies = new Map();
    const socket = {
        connected: true,
        emit: (_event, { data }, callback) => replies.set(data.search, callback),
    };
    store.dispatch(setSearch('ISS'));
    const first = store.dispatch(fetchFiles({ socket, page: 1, search: 'ISS' }));
    store.dispatch(setSearch('NOAA'));
    const second = store.dispatch(fetchFiles({ socket, page: 1, search: 'NOAA' }));
    replies.get('NOAA')({ success: true, data: { items: [{ id: 'noaa' }], total: 1 } });
    await second;
    replies.get('ISS')({ success: false, error: 'Obsolete failure' });
    await first;
    expect(store.getState().filebrowser).toMatchObject({
        files: [{ id: 'noaa' }], total: 1, filesLoading: false, filesError: null,
    });
});

test('only removes acknowledged library deletions', async () => {
    const socket = {
        connected: true,
        emit: vi.fn((event, payload, callback) => {
            expect(event).toBe('api.call');
            expect(payload).toEqual({
                cmd: 'filebrowser.delete',
                data: { ids: ['audio:voice.wav'] },
            });
            callback({ success: false, error: 'Item not found' });
        }),
    };
    const store = createStore();

    await expect(store.dispatch(deleteLibraryItems({ socket, ids: ['audio:voice.wav'] })).unwrap())
        .rejects.toThrow('Item not found');
    expect(store.getState().filebrowser.files).toEqual([]);
});

test('changing responsive page size restarts paging', () => {
    const store = createStore();
    store.dispatch({ type: 'filebrowser/setPage', payload: 4 });
    store.dispatch(setPageSize(25));

    expect(store.getState().filebrowser.pageSize).toBe(25);
    expect(store.getState().filebrowser.page).toBe(1);
});

test('purge preview aggregates are stored per cutoff', async () => {
    const preview = {
        cutoff: '2026-01-01T00:00:00.000Z',
        items: 7,
        files: 40,
        bytes: 1234,
        skippedInProgress: 2,
        categories: { observation: { items: 1, files: 30, bytes: 900 } },
        oldest: '2024-01-01T00:00:00+00:00',
        newest: '2026-06-01T00:00:00+00:00',
    };
    const socket = {
        connected: true,
        emit: vi.fn((event, payload, callback) => {
            expect(payload.cmd).toBe('filebrowser.purge-preview');
            callback({ success: true, data: preview });
        }),
    };
    const store = createStore();

    await store.dispatch(fetchPurgePreview({ socket, cutoff: preview.cutoff })).unwrap();

    expect(store.getState().filebrowser.purge.preview).toEqual(preview);
    expect(store.getState().filebrowser.purge.previewLoading).toBe(false);
});

test('purge lifecycle mirrors socket progress', async () => {
    const socket = {
        connected: true,
        emit: vi.fn((event, payload, callback) => {
            expect(payload.cmd).toBe('filebrowser.purge');
            callback({ success: true, data: { started: true } });
        }),
    };
    const store = createStore();

    await store.dispatch(startLibraryPurge({ socket, cutoff: '2026-01-01T00:00:00.000Z' })).unwrap();
    expect(store.getState().filebrowser.purge.running).toBe(true);

    store.dispatch(purgeProgressUpdated({ done: 3, total: 10, deleted: 3, files: 9, bytesFreed: 300, current: 'bundle' }));
    expect(store.getState().filebrowser.purge.progress.done).toBe(3);

    store.dispatch(purgeFinished({ phase: 'done', success: true, deleted: 10, files: 200, bytesFreed: 4000, failed: [] }));
    expect(store.getState().filebrowser.purge.running).toBe(false);
    expect(store.getState().filebrowser.purge.done.success).toBe(true);
    expect(store.getState().filebrowser.purge.progress).toBeNull();

    store.dispatch(clearPurgeState());
    expect(store.getState().filebrowser.purge.done).toBeNull();
});

test('a start acknowledgement cannot resurrect an already completed purge', () => {
    const store = createStore();
    const done = { phase: 'done', success: true, deleted: 0, files: 0, bytesFreed: 0, failed: [] };

    store.dispatch(startLibraryPurge.pending('request-1', {}));
    store.dispatch(purgeFinished(done));
    store.dispatch(startLibraryPurge.fulfilled({ started: true }, 'request-1', {}));

    expect(store.getState().filebrowser.purge.running).toBe(false);
    expect(store.getState().filebrowser.purge.done).toEqual(done);
});

test('a completed purge invalidates preview replies from before deletion', () => {
    const store = createStore();
    const cutoff = '2026-01-01T00:00:00.000Z';

    store.dispatch(fetchPurgePreview.pending('old-preview', { cutoff }));
    store.dispatch(purgeFinished({ success: true, deleted: 1, files: 1, bytesFreed: 100, failed: [] }));
    store.dispatch(fetchPurgePreview.fulfilled({ cutoff, items: 1 }, 'old-preview', { cutoff }));
    expect(store.getState().filebrowser.purge.preview).toBeNull();

    store.dispatch(fetchPurgePreview.pending('new-preview', { cutoff }));
    store.dispatch(fetchPurgePreview.fulfilled({ cutoff, items: 0 }, 'new-preview', { cutoff }));
    expect(store.getState().filebrowser.purge.preview.items).toBe(0);
});

test('reopening the dialog preserves purge progress', () => {
    const store = createStore();
    store.dispatch(purgeProgressUpdated({ done: 1, total: 2, current: 'capture' }));
    store.dispatch(clearPurgeState());

    expect(store.getState().filebrowser.purge.running).toBe(true);
    expect(store.getState().filebrowser.purge.progress.current).toBe('capture');
});
