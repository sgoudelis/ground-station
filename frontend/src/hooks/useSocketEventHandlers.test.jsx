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

import { act, renderHook, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { afterEach, expect, test, vi } from 'vitest';
import { store } from '../components/common/store.jsx';
import { clearVersionChangeFlag, fetchVersionInfo } from '../components/dashboard/version-slice.jsx';
import { setInitialDataLoading } from '../components/dashboard/dashboard-slice.jsx';
import { initializeAppData } from '../services/data-sync.js';
import { toast } from '../utils/toast-with-timestamp.jsx';
import { setErrorDialogOpen, setErrorMessage } from '../components/waterfall/waterfall-slice.jsx';
import { setFileBrowserVisible, setHasNewFiles, setSearch } from '../components/filebrowser/filebrowser-slice.jsx';
import { useSocketEventHandlers } from './useSocketEventHandlers.jsx';

vi.mock('../services/data-sync.js', () => ({
    initializeAppData: vi.fn(),
}));

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    store.dispatch(setFileBrowserVisible(false));
    store.dispatch(setHasNewFiles(false));
    store.dispatch(setSearch(''));
});

test('library changes coalesce and preserve the visible browser query', async () => {
    vi.useFakeTimers();
    const listeners = new Map();
    const requests = [];
    const socket = {
        connected: false,
        on: vi.fn((event, handler) => listeners.set(event, handler)),
        off: vi.fn((event) => listeners.delete(event)),
        emit: vi.fn((_event, request, callback) => {
            requests.push(request);
            callback({ success: true, data: { items: [], total: 0 } });
        }),
    };
    store.dispatch(setFileBrowserVisible(true));
    store.dispatch(setSearch('ISS APRS'));
    const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
    const { unmount } = renderHook(() => useSocketEventHandlers(socket), { wrapper });
    socket.connected = true;
    act(() => {
        for (let revision = 1; revision <= 20; revision++) {
            listeners.get('library.changed')({ revision });
        }
    });
    expect(requests).toHaveLength(0);
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ cmd: 'filebrowser.query', data: { search: 'ISS APRS' } });
    unmount();
});

test('hidden file browser only checks its badge and stops querying once it is lit', async () => {
    vi.useFakeTimers();
    const listeners = new Map();
    const socket = {
        connected: false,
        on: vi.fn((event, handler) => listeners.set(event, handler)),
        off: vi.fn((event) => listeners.delete(event)),
        emit: vi.fn((_event, _request, callback) => callback({
            success: true, data: { items: [{ created: '2099-01-01T00:00:00Z' }] },
        })),
    };
    store.dispatch(setFileBrowserVisible(false));
    store.dispatch(setHasNewFiles(false));
    store.dispatch(setSearch('hidden search'));
    const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
    const { unmount } = renderHook(() => useSocketEventHandlers(socket), { wrapper });
    socket.connected = true;
    act(() => listeners.get('library.changed')());
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(socket.emit).toHaveBeenCalledTimes(1);
    expect(socket.emit.mock.calls[0][1]).toEqual({
        cmd: 'filebrowser.query', data: { sortBy: 'created', sortOrder: 'desc', page: 1, pageSize: 1 },
    });
    expect(store.getState().filebrowser.hasNewFiles).toBe(true);
    act(() => listeners.get('library.changed')());
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(socket.emit).toHaveBeenCalledTimes(1);
    unmount();
});

test('library refresh waits for in-flight queries and disposes queued work on unmount', async () => {
    vi.useFakeTimers();
    const listeners = new Map();
    const replies = [];
    const socket = {
        connected: false,
        on: vi.fn((event, handler) => listeners.set(event, handler)),
        off: vi.fn((event) => listeners.delete(event)),
        emit: vi.fn((_event, _request, callback) => replies.push(callback)),
    };
    store.dispatch(setFileBrowserVisible(true));
    const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
    const { unmount } = renderHook(() => useSocketEventHandlers(socket), { wrapper });
    socket.connected = true;
    act(() => listeners.get('library.changed')());
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(socket.emit).toHaveBeenCalledTimes(1);
    act(() => {
        for (let i = 0; i < 20; i++) listeners.get('library.changed')();
    });
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(socket.emit).toHaveBeenCalledTimes(1);
    await act(async () => replies[0]({ success: true, data: { items: [], total: 0 } }));
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(socket.emit).toHaveBeenCalledTimes(2);
    act(() => listeners.get('library.changed')());
    unmount();
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(socket.emit).toHaveBeenCalledTimes(2);
});

test('disconnect aborts a lost library query so later updates can refresh again', async () => {
    vi.useFakeTimers();
    const listeners = new Map();
    const socket = {
        connected: false,
        on: vi.fn((event, handler) => listeners.set(event, handler)),
        off: vi.fn((event) => listeners.delete(event)),
        emit: vi.fn(),
    };
    store.dispatch(setFileBrowserVisible(true));
    const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
    const { unmount } = renderHook(() => useSocketEventHandlers(socket), { wrapper });
    socket.connected = true;
    act(() => listeners.get('library.changed')());
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(socket.emit).toHaveBeenCalledTimes(1);
    await act(async () => {
        socket.connected = false;
        listeners.get('disconnect')();
    });
    socket.connected = true;
    act(() => listeners.get('library.changed')());
    await act(async () => vi.advanceTimersByTimeAsync(500));
    expect(socket.emit).toHaveBeenCalledTimes(2);
    unmount();
});

test('configuration errors open one detailed dialog without a duplicate toast', () => {
    const listeners = new Map();
    const socket = {
        connected: false,
        on: vi.fn((event, handler) => listeners.set(event, handler)),
        off: vi.fn((event) => listeners.delete(event)),
    };
    const toastError = vi.spyOn(toast, 'error').mockImplementation(() => {});
    store.dispatch(setErrorMessage(''));
    store.dispatch(setErrorDialogOpen(false));
    const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
    const { unmount } = renderHook(() => useSocketEventHandlers(socket), { wrapper });
    const detail = 'Failed to configure SDR: SoapySDR opening device failed (serial=1234): Device busy';

    act(() => listeners.get('sdr-config-error')({ message: detail }));

    expect(store.getState().waterfall.errorDialogOpen).toBe(true);
    expect(store.getState().waterfall.errorMessage).toBe(detail);
    expect(toastError).not.toHaveBeenCalled();
    unmount();
});

test('checks the version before reconnect sync and resumes only after dismissal', async () => {
    const requests = [];
    let serverVersion = '2.0.0';
    let versionCheckFails = false;
    const listeners = new Map();
    const socket = {
        id: 'session-1',
        connected: true,
        on: vi.fn((event, handler) => listeners.set(event, handler)),
        off: vi.fn((event) => listeners.delete(event)),
        emitWithAck: vi.fn(async (_event, request) => {
            requests.push(request.cmd);
            if (request.cmd === 'system.version') {
                return versionCheckFails
                    ? { success: false, error: 'Version check failed' }
                    : { success: true, data: { version: serverVersion } };
            }
            if (request.cmd === 'background-task.list') {
                return { success: true, tasks: [] };
            }
            return { success: true, data: [] };
        }),
    };
    socket.timeout = vi.fn(() => socket);

    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ authenticated: true, setup_required: false }),
    });
    vi.mocked(initializeAppData).mockImplementation(async () => {
        requests.push('initializeAppData');
        store.dispatch(setInitialDataLoading(false));
    });

    // An already-running page knows version 1 before its socket reconnects.
    await store.dispatch(fetchVersionInfo({ socket: {
        connected: true,
        timeout: () => ({ emitWithAck: async () => ({ success: true, data: { version: '1.0.0' } }) }),
    } }));
    requests.length = 0;

    const wrapper = ({ children }) => <Provider store={store}>{children}</Provider>;
    const { unmount } = renderHook(() => useSocketEventHandlers(socket), { wrapper });

    await waitFor(() => expect(store.getState().version.hasVersionChanged).toBe(true));
    expect(requests).toEqual(['system.version']);
    expect(initializeAppData).not.toHaveBeenCalled();
    expect(store.getState().dashboard.initialDataLoading).toBe(false);

    act(() => {
        store.dispatch(clearVersionChangeFlag());
    });
    await waitFor(() => expect(initializeAppData).toHaveBeenCalledTimes(1));
    expect(requests.slice(0, 3)).toEqual(['system.version', 'background-task.list', 'initializeAppData']);

    requests.length = 0;
    socket.id = 'session-2';
    act(() => listeners.get('connect')());
    await waitFor(() => expect(initializeAppData).toHaveBeenCalledTimes(2));
    expect(requests.slice(0, 3)).toEqual(['system.version', 'background-task.list', 'initializeAppData']);

    requests.length = 0;
    versionCheckFails = true;
    socket.id = 'session-3';
    act(() => listeners.get('connect')());
    await waitFor(() => expect(initializeAppData).toHaveBeenCalledTimes(3));
    expect(requests.slice(0, 3)).toEqual(['system.version', 'background-task.list', 'initializeAppData']);

    // A pending decision from an old socket session must not resume its sync.
    requests.length = 0;
    versionCheckFails = false;
    serverVersion = '3.0.0';
    socket.id = 'session-4';
    act(() => listeners.get('connect')());
    await waitFor(() => expect(store.getState().version.hasVersionChanged).toBe(true));
    expect(requests).toEqual(['system.version']);

    act(() => {
        socket.connected = false;
        listeners.get('disconnect')();
        store.dispatch(clearVersionChangeFlag());
    });
    expect(initializeAppData).toHaveBeenCalledTimes(3);

    requests.length = 0;
    socket.connected = true;
    socket.id = 'session-5';
    act(() => listeners.get('connect')());
    await waitFor(() => expect(initializeAppData).toHaveBeenCalledTimes(4));
    expect(requests.slice(0, 3)).toEqual(['system.version', 'background-task.list', 'initializeAppData']);

    unmount();
});
