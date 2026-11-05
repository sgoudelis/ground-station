import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import '../../../i18n/config.js';
import BackgroundStreamControl from '../background-stream-control.jsx';
import ObservationsPopover from '../../dashboard/observations-popover.jsx';
import waterfallReducer from '../waterfall-slice.jsx';
import vfoReducer from '../vfo-marker/vfo-slice.jsx';
import decodersReducer from '../../decoders/decoders-slice.jsx';
import sessionsReducer, { setRuntimeSnapshot } from '../../settings/sessions-slice.jsx';
import { joinSdr } from '../sdr-join.js';

const socket = { connected: true, timeout: vi.fn(), emitWithAck: vi.fn(), emit: vi.fn() };
vi.mock('../../common/socket.jsx', () => ({ useSocket: () => ({ socket }) }));
vi.mock('../../../utils/toast-with-timestamp.jsx', () => ({ toast: { error: vi.fn() } }));

beforeEach(() => {
    vi.clearAllMocks();
    socket.timeout.mockReturnValue(socket);
});

function Controls() {
    const [anchor, setAnchor] = React.useState(null);
    return <><BackgroundStreamControl />
        <ObservationsPopover anchorEl={anchor} onOpen={(event) => setAnchor(event.currentTarget)}
            onClose={() => setAnchor(null)} /></>;
}

function show(overrides = {}, sessions = {}) {
    const store = configureStore({
        reducer: { waterfall: waterfallReducer, vfo: vfoReducer, decoders: decodersReducer, sessions: sessionsReducer },
        preloadedState: {
            waterfall: { ...waterfallReducer(undefined, { type: '@@INIT' }), selectedSDRId: 'radio', isStreaming: true, ...overrides },
            sessions: { ...sessionsReducer(undefined, { type: '@@INIT' }), runtimeSnapshot: { data: { sessions } } },
        },
    });
    render(<Provider store={store}><MemoryRouter><Controls /></MemoryRouter></Provider>);
    return store;
}

test('enables background receiving only after the backend acknowledges it', async () => {
    let acknowledge;
    socket.emitWithAck.mockReturnValue(new Promise((resolve) => { acknowledge = resolve; }));
    const store = show();
    expect(screen.queryByRole('button', { name: 'Observations' })).not.toBeInTheDocument();
    const control = screen.getByRole('switch', { name: /Keep receiving in background/i });
    fireEvent.click(control);
    expect(control).not.toBeChecked();
    expect(control).toBeDisabled();
    expect(socket.emitWithAck).toHaveBeenCalledWith('api.call', {
        cmd: 'sdr.set-background', data: { selectedSDRId: 'radio', enabled: true },
    });
    await act(async () => acknowledge({ success: true, data: { session_id: 'original', enabled: true } }));
    expect(control).toBeChecked();
    expect(store.getState().waterfall.receivingSessionId).toBe('original');
});

test('a failed background request leaves the switch disabled in backend state', async () => {
    socket.emitWithAck.mockRejectedValue(new Error('operation timed out'));
    const store = show();
    await act(async () => fireEvent.click(screen.getByRole('switch')));
    expect(store.getState().waterfall.backgroundStreaming).toBe(false);
    expect(screen.getByRole('switch')).not.toBeChecked();
    expect(screen.getByRole('switch')).not.toBeDisabled();
});

test('viewers see fixed VFOs and can explicitly adopt an unattended observation', async () => {
    socket.emit.mockImplementation((_event, request, callback) => callback({ success: true, data: {
        config: { sdr_id: 'radio', center_freq: 145_800_000, sample_rate: 2_048_000 },
        observation: { session_id: 'original', enabled: true, vfos: { 1: { active: true, center_freq: 145_810_000 } } },
    } }));
    const store = show({ joinedSdrId: 'radio' }, {
        original: { sdr_id: 'radio', metadata: { username: 'Observer' },
            background: { enabled: true, controller_connected: false },
            vfos: { 1: { active: true, center_freq: 145_810_000, decoder: 'fsk' } } },
    });
    expect(screen.getByRole('switch')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Observations' }));
    expect(screen.getByText('VFO 1: 145.810000 MHz · fsk')).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Take control' })));
    expect(socket.emit.mock.calls[0][1].cmd).toBe('sdr.claim-sdr');
    expect(store.getState().waterfall.joinedSdrId).toBeNull();
    expect(store.getState().waterfall.receivingSessionId).toBe('original');
    expect(screen.getByRole('switch')).not.toBeDisabled();
});

test('a connected controller is shown without a takeover button', () => {
    const store = show({ isStreaming: false, selectedSDRId: 'other-radio' }, {
        original: { sdr_id: 'radio', background: { enabled: true, controller_connected: true } },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Observations' }));
    expect(screen.getByText('Controller connected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take control' })).not.toBeInTheDocument();
    act(() => store.dispatch(setRuntimeSnapshot({ sessions: {}, sdrs: {} })));
    expect(screen.queryByRole('button', { name: 'Observations', hidden: true })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Observations' })).not.toBeInTheDocument();
});

test('preserves JOIN status against an old runtime snapshot and prunes it on a fresh snapshot', async () => {
    socket.emit.mockImplementation((_event, _request, callback) => callback({ success: true, data: {
        config: { sdr_id: 'radio', center_freq: 145_800_000, sample_rate: 2_048_000 },
        background_observations: [{ session_id: 'original', decoder_statuses: [
            { session_id: 'original', vfo: 1, decoder_type: 'fsk', status: 'decoding' },
        ] }],
    } }));
    const store = show({ isStreaming: false });
    await act(async () => joinSdr(socket, store.dispatch, 'radio'));
    expect(store.getState().decoders.active.original_vfo1).toBeDefined();
    act(() => store.dispatch(setRuntimeSnapshot({ sessions: {}, sdrs: {} })));
    expect(store.getState().decoders.active.original_vfo1).toBeUndefined();
});
