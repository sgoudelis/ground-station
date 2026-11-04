import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../../i18n/config.js';
import { configureStore } from '@reduxjs/toolkit';
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'react-toastify';
import { renderWithProviders } from '../../../test/test-utils.jsx';
import filebrowserReducer, { purgeFinished, purgeProgressUpdated } from '../filebrowser-slice.jsx';
import PurgeDialog from '../purge-dialog.jsx';

vi.mock('react-toastify', () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

const AGGREGATE = {
    items: 7,
    files: 40,
    bytes: 5_000_000_000,
    skippedInProgress: 1,
    categories: {
        observation: { items: 1, files: 30, bytes: 4_000_000_000 },
        recording: { items: 2, files: 8, bytes: 800_000_000 },
        snapshot: { items: 4, files: 4, bytes: 200_000_000 },
    },
    oldest: '2024-01-01T00:00:00+00:00',
    newest: '2026-06-01T00:00:00+00:00',
};

// Match the backend's UTC offset format rather than echoing the request's Z.
function mockSocket() {
    return {
        connected: true,
        on: vi.fn(),
        off: vi.fn(),
        emit: vi.fn((event, payload, callback) => {
            callback({
                success: true,
                data: { ...AGGREGATE, cutoff: payload.data.cutoff.replace('Z', '+00:00'), itemType: payload.data.itemType },
            });
        }),
    };
}

function createStore() {
    return configureStore({
        reducer: { filebrowser: filebrowserReducer },
        middleware: (getDefaultMiddleware) => getDefaultMiddleware({ serializableCheck: false }),
    });
}

describe('PurgeDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it.each(['mouse', 'touch'])('waits for %s release before showing the spinner or fetching a preview', async (inputType) => {
        const socket = mockSocket();
        renderWithProviders(<PurgeDialog open onClose={vi.fn()} socket={socket} />, { store: createStore() });
        const purgeButton = screen.getByRole('button', { name: 'Purge', exact: true });
        await waitFor(() => expect(purgeButton).toBeEnabled());
        const slider = screen.getByRole('slider', { name: 'Delete before' });
        const originalValue = slider.getAttribute('aria-valuenow');
        const track = slider.closest('.MuiSlider-root');
        vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
            left: 0, right: 100, top: 0, bottom: 30, width: 100, height: 30,
        });
        const requests = [];
        socket.emit.mockImplementation((_event, { data }, callback) => requests.push({ data, callback }));
        const touch = (clientX) => ({ identifier: 1, clientX, clientY: 10 });
        if (inputType === 'mouse') {
            fireEvent.mouseDown(track, { button: 0, buttons: 1, clientX: 25 });
        } else {
            fireEvent.touchStart(track, { changedTouches: [touch(25)], touches: [touch(25)] });
        }
        expect(slider.getAttribute('aria-valuenow')).not.toBe(originalValue);
        expect(purgeButton).toBeDisabled();
        // A pause longer than the old debounce must still count as dragging.
        await act(async () => new Promise((resolve) => setTimeout(resolve, 350)));
        expect(requests).toHaveLength(0);
        expect(screen.queryByRole('progressbar', { name: 'Scanning the library...' })).not.toBeInTheDocument();
        if (inputType === 'mouse') {
            fireEvent.mouseMove(document, { buttons: 1, clientX: 50 });
            fireEvent.mouseUp(document, { button: 0, clientX: 50 });
        } else {
            fireEvent.touchMove(document, { changedTouches: [touch(50)], touches: [touch(50)] });
            fireEvent.touchEnd(document, { changedTouches: [touch(50)], touches: [] });
        }
        expect(screen.getByRole('progressbar', { name: 'Scanning the library...' })).toBeInTheDocument();
        await waitFor(() => expect(requests).toHaveLength(1));
        const { data, callback } = requests[0];
        // The visible slider runs from newest to oldest, opposite to the cutoff.
        const expectedCutoff = Number(slider.min) + Number(slider.max) - Number(slider.value);
        expect(new Date(data.cutoff).getTime()).toBe(expectedCutoff);
        await act(async () => callback({ success: true, data: { ...AGGREGATE, ...data } }));
        expect(screen.queryByRole('progressbar', { name: 'Scanning the library...' })).not.toBeInTheDocument();
        expect(purgeButton).toBeEnabled();
    });

    it('commits keyboard slider changes without waiting for a pointer release', async () => {
        const socket = mockSocket();
        renderWithProviders(<PurgeDialog open onClose={vi.fn()} socket={socket} />, { store: createStore() });
        await waitFor(() => expect(screen.getByRole('button', { name: 'Purge', exact: true })).toBeEnabled());
        const slider = screen.getByRole('slider', { name: 'Delete before' });
        const initialPreviewCount = socket.emit.mock.calls.length;
        fireEvent.keyDown(slider, { key: 'ArrowLeft' });
        await waitFor(() => expect(socket.emit.mock.calls.length).toBe(initialPreviewCount + 1));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Purge', exact: true })).toBeEnabled());
    });

    it('offers All and every file browser type, with All selected by default', async () => {
        renderWithProviders(<PurgeDialog open onClose={vi.fn()} socket={mockSocket()} />, { store: createStore() });
        const dropdown = screen.getByRole('combobox', { name: 'Item type' });
        expect(dropdown).toHaveTextContent('All');
        await userEvent.click(dropdown);
        expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
            'All', 'Recordings', 'Snapshots', 'Decoded', 'Observations', 'Weather balloons',
            'Aircraft', 'Meshtastic nodes', 'Audio', 'Transcriptions',
        ]);
    });

    it('previews and confirms only the selected type, and retains it after completion', async () => {
        const socket = mockSocket();
        socket.emit.mockImplementation((_event, { cmd, data }, callback) => {
            if (cmd === 'filebrowser.purge') {
                callback({ success: true, data: { started: true } });
                return;
            }
            callback({ success: true, data: {
                ...AGGREGATE, cutoff: data.cutoff, itemType: data.itemType,
                ...(data.itemType === 'audio' ? { items: 1, files: 2, bytes: 1024,
                    categories: { audio: { items: 1, files: 2, bytes: 1024 } } } : {}),
            } });
        });
        const store = createStore();
        renderWithProviders(<PurgeDialog open onClose={vi.fn()} socket={socket} />, { store });
        await userEvent.click(screen.getByRole('combobox', { name: 'Item type' }));
        await userEvent.click(screen.getByRole('option', { name: 'Audio', exact: true }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Purge', exact: true })).toBeEnabled());
        expect(screen.getByText('items will be deleted (2 files, including metadata files)')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Purge', exact: true }));
        expect(screen.getByText('Purge 1 items?')).toBeInTheDocument();
        expect(screen.getByText(/Item type: Audio\./)).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }));
        expect(socket.emit).toHaveBeenCalledWith('api.call', expect.objectContaining({
            cmd: 'filebrowser.purge', data: expect.objectContaining({ itemType: 'audio' }),
        }), expect.any(Function));
        await waitFor(() => expect(screen.getByRole('combobox', { name: 'Item type' })).toHaveAttribute('aria-disabled', 'true'));
        act(() => store.dispatch(purgeFinished({ success: true, deleted: 1, files: 2, bytesFreed: 1024, failed: [] })));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Purge', exact: true })).toBeEnabled());
        expect(screen.getByRole('combobox', { name: 'Item type' })).toHaveTextContent('Audio');
        expect(store.getState().filebrowser.purge.preview.itemType).toBe('audio');
    });

    it('discards late previews from a previous type and disables purging an empty type', async () => {
        const requests = [];
        const socket = { connected: true, on: vi.fn(), off: vi.fn(),
            emit: vi.fn((_event, { data }, callback) => requests.push({ data, callback })),
        };
        const store = createStore();
        renderWithProviders(<PurgeDialog open onClose={vi.fn()} socket={socket} />, { store });
        await waitFor(() => expect(requests).toHaveLength(1));
        await userEvent.click(screen.getByRole('combobox', { name: 'Item type' }));
        await userEvent.click(screen.getByRole('option', { name: 'Aircraft', exact: true }));
        await waitFor(() => expect(requests).toHaveLength(2));
        expect(requests[1].data.itemType).toBe('adsb');
        expect(screen.getByRole('button', { name: 'Purge', exact: true })).toBeDisabled();
        await act(async () => requests[1].callback({ success: true, data: {
            ...AGGREGATE, cutoff: requests[1].data.cutoff, itemType: 'adsb',
            items: 0, files: 0, bytes: 0, categories: {}, oldest: null, newest: null,
        } }));
        await act(async () => requests[0].callback({ success: true, data: {
            ...AGGREGATE, cutoff: requests[0].data.cutoff, itemType: 'all',
        } }));
        expect(store.getState().filebrowser.purge.preview.itemType).toBe('adsb');
        expect(screen.getByText('items will be deleted (0 files, including metadata files)')).toBeInTheDocument();
        expect(screen.getByRole('slider', { name: 'Delete before' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Purge', exact: true })).toBeDisabled();
        expect(screen.queryByRole('progressbar', { name: 'Scanning the library...' })).not.toBeInTheDocument();
    });

    it.each([
        {
            result: { success: true, deleted: 62, files: 62, bytesFreed: 4_710_000_000, failed: [] },
            method: 'success',
            message: 'Purged 62 items, freed 4.39 GB',
        },
        {
            result: { success: false, error: 'Could not purge files' },
            method: 'error',
            message: 'Could not purge files',
        },
    ])('does not replay a $method toast when returning to the file browser', async ({ result, method, message }) => {
        const socket = mockSocket();
        const store = createStore();
        const dialog = <PurgeDialog open={false} onClose={vi.fn()} socket={socket} />;
        const firstVisit = renderWithProviders(dialog, { store });

        // Completions still notify while the dialog is closed.
        act(() => store.dispatch(purgeFinished(result)));
        expect(toast[method]).toHaveBeenCalledExactlyOnceWith(message);
        firstVisit.unmount();

        const nextVisit = renderWithProviders(dialog, { store });
        expect(toast[method]).toHaveBeenCalledTimes(1);

        // A subsequent sweep must still notify, even with identical totals.
        act(() => store.dispatch(purgeProgressUpdated({ done: 0, total: 62 })));
        act(() => store.dispatch(purgeFinished({ ...result })));
        expect(toast[method]).toHaveBeenCalledTimes(2);
        expect(toast[method]).toHaveBeenLastCalledWith(message);

        nextVisit.rerender(<PurgeDialog open onClose={vi.fn()} socket={socket} />);
        await waitFor(() => expect(store.getState().filebrowser.purge.preview).not.toBeNull());
        expect(toast[method]).toHaveBeenCalledTimes(2);
    });

    it('keeps one spinner visible across the opening preview requests', async () => {
        const requests = [];
        const socket = {
            connected: true,
            on: vi.fn(),
            off: vi.fn(),
            emit: vi.fn((_event, payload, callback) => requests.push({ payload, callback })),
        };
        const store = createStore();
        renderWithProviders(<PurgeDialog open onClose={vi.fn()} socket={socket} />, { store });

        await waitFor(() => expect(requests).toHaveLength(1));
        expect(screen.getAllByRole('progressbar', { name: 'Scanning the library...' })).toHaveLength(1);

        act(() => {
            requests[0].callback({
                success: true,
                data: { ...AGGREGATE, cutoff: requests[0].payload.data.cutoff },
            });
        });
        await waitFor(() => expect(store.getState().filebrowser.purge.previewLoading).toBe(false));
        expect(screen.getAllByRole('progressbar', { name: 'Scanning the library...' })).toHaveLength(1);

        await waitFor(() => expect(requests).toHaveLength(2), { timeout: 3000 });
        act(() => {
            requests[1].callback({
                success: true,
                data: { ...AGGREGATE, cutoff: requests[1].payload.data.cutoff },
            });
        });
        await waitFor(() => {
            expect(screen.queryByRole('progressbar', { name: 'Scanning the library...' })).not.toBeInTheDocument();
        });
    });

    it('shows preview aggregates and starts the purge after confirmation', async () => {
        const socket = mockSocket();
        const store = createStore();
        renderWithProviders(
            <PurgeDialog open onClose={vi.fn()} socket={socket} />,
            { store }
        );

        expect(screen.getByText('Purge old files')).toBeInTheDocument();
        expect(screen.getByRole('progressbar', { name: 'Deletion progress' })).toHaveAttribute('aria-valuenow', '0');
        expect(screen.getByRole('button', { name: /Purge/i })).toBeDisabled();
        const initialSlider = screen.getByRole('slider', { name: 'Delete before' });
        expect(initialSlider).toHaveAttribute('aria-valuenow', initialSlider.getAttribute('aria-valuemax'));

        // The bootstrap preview provides the slider domain; the debounced
        // default-cutoff preview then fills the summary.
        await waitFor(() => {
            expect(screen.getByText('items will be deleted (40 files, including metadata files)')).toBeInTheDocument();
        }, { timeout: 3000 });
        expect(screen.getByText('7')).toBeInTheDocument();
        expect(screen.getByText(/in-progress items are protected/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Purge/i })).toBeEnabled();
        const readySlider = screen.getByRole('slider', { name: 'Delete before' });
        expect(readySlider).toHaveAttribute('aria-valuenow', readySlider.getAttribute('aria-valuemax'));

        await userEvent.click(screen.getByRole('button', { name: /Purge/i }));
        expect(await screen.findByText('Purge 7 items?')).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: /Delete/i }));
        await waitFor(() => {
            expect(socket.emit).toHaveBeenCalledWith(
                'api.call',
                expect.objectContaining({ cmd: 'filebrowser.purge' }),
                expect.any(Function)
            );
        });
        expect(screen.getByText('Composition')).toBeInTheDocument();
        expect(await screen.findByRole('progressbar', { name: 'Purge' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Purge/i })).toBeDisabled();
        act(() => {
            store.dispatch(purgeProgressUpdated({ done: 2, total: 7, bytesFreed: 1024, current: 'sample.wav' }));
        });
        expect(screen.getByRole('progressbar', { name: 'Deletion progress' })).toHaveAttribute('aria-valuenow', '29');
        expect(screen.getByText('2 / 7', { exact: false })).toBeInTheDocument();
        expect(screen.getByText(/Removing sample.wav.../)).toBeInTheDocument();

        act(() => {
            store.dispatch(purgeFinished({ success: true, deleted: 7, files: 40, bytesFreed: 5_000_000_000, failed: [] }));
        });
        expect(screen.getByText('Composition')).toBeInTheDocument();
        expect(screen.getByRole('progressbar', { name: 'Deletion progress' })).toHaveAttribute('aria-valuenow', '100');
        expect(screen.getByText('Deleted 7 items (40 files, including metadata files), freed 4.66 GB.')).toBeInTheDocument();
        expect(screen.queryByText('— / — · —')).not.toBeInTheDocument();
        expect(screen.queryByRole('progressbar', { name: 'Purge' })).not.toBeInTheDocument();
        await waitFor(() => {
            const slider = screen.getByRole('slider', { name: 'Delete before' });
            expect(slider).toBeEnabled();
            expect(slider).toHaveAttribute('aria-valuenow', slider.getAttribute('aria-valuemax'));
            expect(screen.getByRole('button', { name: /Purge/i })).toBeEnabled();
        }, { timeout: 3000 });
    });

    it('asks for a purge only after the domain is known', async () => {
        const socket = {
            connected: true,
            on: vi.fn(),
            off: vi.fn(),
            emit: vi.fn((event, payload, callback) => {
                callback({
                    success: true,
                    data: {
                        items: 0,
                        files: 0,
                        bytes: 0,
                        skippedInProgress: 0,
                        categories: {},
                        cutoff: payload.data.cutoff,
                        oldest: '2026-05-20T00:00:00+00:00',
                        newest: '2026-06-01T00:00:00+00:00',
                    },
                });
            }),
        };
        renderWithProviders(<PurgeDialog open onClose={vi.fn()} socket={socket} />, { store: createStore() });

        await waitFor(() => {
            expect(screen.getByText('items will be deleted (0 files, including metadata files)')).toBeInTheDocument();
        }, { timeout: 3000 });
        expect(screen.getByText('Composition')).toBeInTheDocument();
        expect(screen.getByText('0 B')).toBeInTheDocument();
        expect(screen.getByText('No in-progress items in the selected date range.')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Purge/i })).toBeDisabled();
    });

    it('keeps the full layout visible while preview values are unavailable', () => {
        const socket = {
            connected: true,
            on: vi.fn(),
            off: vi.fn(),
            emit: vi.fn(),
        };
        renderWithProviders(<PurgeDialog open onClose={vi.fn()} socket={socket} />, { store: createStore() });

        expect(screen.getByRole('slider', { name: 'Delete before' })).toBeDisabled();
        expect(screen.getByRole('progressbar', { name: 'Scanning the library...' })).toBeInTheDocument();
        expect(screen.getByText('items will be deleted (— files, including metadata files)')).toBeInTheDocument();
        expect(screen.getByText('Composition')).toBeInTheDocument();
        expect(screen.getByText(/Automated observations/)).toBeInTheDocument();
        expect(screen.queryByText('Scanning the library...')).not.toBeInTheDocument();
    });

    it('surfaces preview errors instead of hanging on the scanning state', async () => {
        // Reproduces a backend that predates the purge commands: the RPC
        // rejects and the dialog must explain itself, not spin forever.
        const socket = {
            connected: true,
            on: vi.fn(),
            off: vi.fn(),
            emit: vi.fn((event, payload, callback) => {
                callback({ success: false, error: 'Unknown command: filebrowser.purge-preview' });
            }),
        };
        renderWithProviders(<PurgeDialog open onClose={vi.fn()} socket={socket} />, { store: createStore() });

        expect(await screen.findByText(/Unknown command: filebrowser.purge-preview/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
        expect(screen.queryByText('Scanning the library...')).not.toBeInTheDocument();
        expect(screen.getByText('Composition')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Purge/i })).toBeDisabled();
    });
});
