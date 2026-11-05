import React from 'react';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {ThemeProvider} from '@mui/material/styles';
import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import '../../i18n/config.js';
import {setupTheme} from '../../theme.js';
import hardware, {fetchHardwareState, receiveDeviceCommand, receiveDeviceSnapshot} from './control-slice.js';
import DeviceControlPanel from './device-control-panel.jsx';

const {socket} = vi.hoisted(() => ({socket: {connected: true, emit: vi.fn()}}));
vi.mock('../common/socket.jsx', () => ({useSocket: () => ({socket})}));

const mount = {id: 'mount', name: 'S.A.T.', host: 'localhost', port: 4533, stop_supported: false};
const snapshot = (extra = {}) => ({
    kind: 'rotator', device_id: 'mount', epoch: 'boot', generation: 'lease',
    worker_generation: 'worker', worker_started_at: 1, sequence: 1, owner: null,
    data: {connected: true, az: 120, el: 25}, ...extra,
});
function setup({snapshots = [snapshot()], config = [mount], receivedAt, loaded = true, loadError = null} = {}) {
    const payload = {epoch: 'boot', server_time: Date.now() / 1000, commands: [], devices: snapshots};
    let state = hardware(undefined, fetchHardwareState.fulfilled(payload));
    if (receivedAt !== undefined) state = {...state, devices: Object.fromEntries(
        Object.entries(state.devices).map(([key, row]) => [key, {...row, receivedAt}]),
    )};
    state = {...state, loaded, error: loadError};
    const store = configureStore({reducer: {
        hardwareControl: hardware, rotators: () => ({rotators: config}),
    }, preloadedState: {hardwareControl: state}});
    const requests = [];
    socket.emit.mockImplementation((_event, request, ack) => {
        if (request.cmd === 'get-hardware-state') return ack({success: true, data: payload});
        requests.push(request);
        ack({success: true, data: {command: {
            ...request.data, tracker_id: 'manual:rotator:mount', device_ids: {rotator: request.data.device_id},
            status: 'submitted', revision: 1, submitted_at: Date.now() / 1000,
        }}});
    });
    render(<Provider store={store}><ThemeProvider theme={setupTheme()}><DeviceControlPanel kind="rotator" /></ThemeProvider></Provider>);
    return {store, requests};
}
const openMenu = () => fireEvent.click(screen.getByRole('button', {name: 'More actions for S.A.T.'}));

beforeEach(() => {vi.clearAllMocks(); socket.connected = true;});

describe('device actions and status', () => {
    it('allows disconnecting unowned hardware with uncertain motion and keeps the warning', async () => {
        const {store, requests} = setup({snapshots: [snapshot({data: {connected: true, motion_unconfirmed: true}})]});
        expect(screen.getByRole('button', {name: 'Pause tracking'})).toBeEnabled();
        expect(screen.getByRole('button', {name: 'Take manual control'})).toBeDisabled();
        const disconnect = screen.getByRole('button', {name: 'Disconnect'});
        expect(disconnect).toBeEnabled();
        await act(async () => fireEvent.click(disconnect));
        expect(requests[0].data.action).toBe('disconnect');
        act(() => store.dispatch(receiveDeviceSnapshot(snapshot({sequence: 2, data: {connected: false, motion_unconfirmed: true}}))));
        expect(screen.getByText('Disconnected; antenna motion is unconfirmed')).toBeInTheDocument();
    });

    it('can take control of a disconnected device held by an old tracker', async () => {
        const {requests} = setup({snapshots: [snapshot({owner: {type: 'tracker', id: 'target-1'},
            data: {connected: false, error: true, motion_unconfirmed: true}})]});
        expect(screen.queryByRole('button', {name: 'Connect'})).not.toBeInTheDocument();
        await act(async () => fireEvent.click(screen.getByRole('button', {name: 'Take manual control'})));
        expect(requests[0].data).toMatchObject({action: 'take-control', device_id: 'mount', generation: 'lease'});
    });

    it('shows server command failures inline for the affected device', async () => {
        const {store, requests} = setup({snapshots: []});
        await act(async () => fireEvent.click(screen.getByRole('button', {name: 'Connect'})));
        expect(screen.getByRole('status')).toHaveTextContent('Connecting…');
        expect(screen.getByRole('button', {name: 'Connect'})).toBeDisabled();
        act(() => store.dispatch(receiveDeviceCommand({command_id: requests[0].data.command_id,
            status: 'failed', revision: 2, reason: 'Connection refused'})));
        expect(screen.getByRole('status')).toHaveTextContent('Command failed — Connection refused');
        expect(screen.getByRole('button', {name: 'Connect'})).toBeEnabled();
    });

    it('shows a rejected request and refreshes the hardware state', async () => {
        setup({snapshots: []});
        socket.emit.mockImplementation((_event, request, ack) => ack(request.cmd === 'control-hardware'
            ? {success: false, error: 'Device is reserved by a scheduled observation'}
            : {success: true, data: {epoch: 'boot', server_time: Date.now() / 1000, devices: [], commands: []}}));
        await act(async () => fireEvent.click(screen.getByRole('button', {name: 'Connect'})));
        expect(screen.getByRole('alert')).toHaveTextContent('Device is reserved by a scheduled observation');
        expect(socket.emit).toHaveBeenLastCalledWith('api.call', expect.objectContaining({cmd: 'get-hardware-state'}), expect.any(Function));
    });

    it('keeps device order and expansion stable when connections change', () => {
        const {store} = setup({config: [{...mount, id: 'spare', name: 'Spare mount'}, mount]});
        expect(screen.getAllByRole('region').map((row) => row.getAttribute('aria-label'))).toEqual(['S.A.T.', 'Spare mount']);
        act(() => {
            store.dispatch(receiveDeviceSnapshot(snapshot({sequence: 2, data: {connected: false}})));
            store.dispatch(receiveDeviceSnapshot(snapshot({device_id: 'spare', data: {connected: true}})));
        });
        expect(screen.getAllByRole('region').map((row) => row.getAttribute('aria-label'))).toEqual(['S.A.T.', 'Spare mount']);
        expect(within(screen.getByRole('region', {name: 'S.A.T.'})).getByRole('button', {expanded: true})).toBeInTheDocument();
    });

    it('withholds stale telemetry and ordinary commands while allowing Stop', () => {
        setup({receivedAt: Date.now() - 16000});
        expect(screen.queryByText('120.0°')).not.toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Take manual control'})).toBeDisabled();
        expect(screen.getByRole('button', {name: 'Pause tracking'})).toBeEnabled();
        expect(screen.getByRole('button', {name: 'Disconnect'})).toBeEnabled();
    });

    it('retries failed initial status loading', async () => {
        setup({snapshots: [], loaded: false, loadError: 'Network failed'});
        expect(screen.getByRole('alert')).toHaveTextContent('Could not refresh hardware status');
        expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Connect'})).toBeDisabled();
        await act(async () => fireEvent.click(screen.getByRole('button', {name: 'Retry'})));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Connect'})).toBeEnabled();
    });

    it.each([
        ['parked', {parked: true}], ['uncertain motion', {motion_unconfirmed: true}], ['tracking', {tracking: true}],
    ])('disables manual movement for %s', (_label, data) => {
        setup({snapshots: [snapshot({owner: {type: 'manual', id: 'manual:rotator:mount'}, data: {connected: true, ...data}})]});
        expect(screen.getByRole('button', {name: 'Manual'})).toBeDisabled();
        expect(screen.getByRole('button', {name: 'Pause tracking'})).toBeEnabled();
    });

    it('offers park and release only for manually owned hardware', async () => {
        const {requests} = setup({snapshots: [snapshot({owner: {type: 'manual', id: 'manual:rotator:mount'}})]});
        openMenu();
        expect(screen.getByRole('menuitem', {name: 'Release control'})).toBeInTheDocument();
        await act(async () => fireEvent.click(screen.getByRole('menuitem', {name: 'Park'})));
        expect(requests[0].data.action).toBe('park');
    });

    it('shows an empty state without target rows when no devices are configured', () => {
        setup({config: [], snapshots: []});
        expect(screen.getByText('No rotators configured')).toBeInTheDocument();
        expect(screen.queryByRole('region')).not.toBeInTheDocument();
    });
});
