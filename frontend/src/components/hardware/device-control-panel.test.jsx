import React from 'react';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {ThemeProvider} from '@mui/material/styles';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
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
function setup({snapshots = [snapshot()], config = [mount], receivedAt, loaded = true, loadError = null, kind = 'rotator'} = {}) {
    const payload = {epoch: 'boot', server_time: Date.now() / 1000, commands: [], devices: snapshots};
    let state = hardware(undefined, fetchHardwareState.fulfilled(payload));
    if (receivedAt !== undefined) state = {...state, devices: Object.fromEntries(
        Object.entries(state.devices).map(([key, row]) => [key, {...row, receivedAt}]),
    )};
    state = {...state, loaded, error: loadError};
    const store = configureStore({reducer: {
        hardwareControl: hardware, rotators: () => ({rotators: config}), rigs: () => ({rigs: config}),
    }, preloadedState: {hardwareControl: state}});
    const requests = [];
    socket.emit.mockImplementation((_event, request, ack) => {
        if (request.cmd === 'get-hardware-state') return ack({success: true, data: payload});
        requests.push(request);
        ack({success: true, data: {command: {
            ...request.data, tracker_id: `manual:${kind}:mount`, device_ids: {[kind]: request.data.device_id},
            status: 'submitted', revision: 1, submitted_at: Date.now() / 1000,
        }}});
    });
    render(<Provider store={store}><ThemeProvider theme={setupTheme()}><DeviceControlPanel kind={kind} /></ThemeProvider></Provider>);
    return {store, requests};
}
const openMenu = () => fireEvent.click(screen.getByRole('button', {name: 'Parking actions for S.A.T.'}));

beforeEach(() => {vi.clearAllMocks(); socket.connected = true;});

describe('device actions and status', () => {
    it('allows disconnecting unowned hardware with uncertain motion and keeps the warning', async () => {
        const {store, requests} = setup({snapshots: [snapshot({data: {connected: true, motion_unconfirmed: true}})]});
        expect(screen.getByRole('alert')).toHaveTextContent('Waiting for stationary position readings');
        fireEvent.click(within(screen.getByRole('alert')).getByRole('button', {name: 'Close'}));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        act(() => store.dispatch(receiveDeviceSnapshot(snapshot({sequence: 2, data: {connected: true, motion_unconfirmed: true}}))));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Pause tracking'})).toBeEnabled();
        expect(screen.getByRole('button', {name: 'Take manual control'})).toBeDisabled();
        const disconnect = screen.getByRole('button', {name: 'Disconnect'});
        expect(disconnect).toBeEnabled();
        await act(async () => fireEvent.click(disconnect));
        expect(requests[0].data.action).toBe('disconnect');
        act(() => store.dispatch(receiveDeviceSnapshot(snapshot({sequence: 3, data: {connected: false, motion_unconfirmed: true}}))));
        expect(screen.getByRole('alert')).toHaveTextContent('Disconnected; antenna motion is unconfirmed');
    });

    it('can take control of a disconnected device held by an old tracker', async () => {
        const {requests} = setup({snapshots: [snapshot({owner: {type: 'tracker', id: 'target-1'},
            data: {connected: false, error: true, motion_unconfirmed: true}})]});
        expect(screen.getByRole('button', {name: 'Connect'})).toBeDisabled();
        await act(async () => fireEvent.click(screen.getByRole('button', {name: 'Take manual control'})));
        expect(requests[0].data).toMatchObject({action: 'take-control', device_id: 'mount', generation: 'lease'});
    });

    it.each(['rotator', 'rig'].flatMap((kind) => [false, true].map((wrapped) => ({kind, wrapped}))))(
        'shows one $kind connection error when the command reason is wrapped: $wrapped', async ({kind, wrapped}) => {
        const {store, requests} = setup({kind, snapshots: []});
        const reason = `${kind === 'rotator' ? 'Rotator' : 'Rig'} did not respond to ping`;
        const hardwareError = `Error connecting to ${kind}: ${reason}`;
        await act(async () => fireEvent.click(screen.getByRole('button', {name: 'Connect'})));
        expect(screen.getByRole('status')).toHaveTextContent('Connecting…');
        expect(screen.getByRole('button', {name: 'Connect'})).toBeDisabled();
        act(() => {
            store.dispatch(receiveDeviceSnapshot(snapshot({kind, data: {
                connected: false, error: true, error_message: hardwareError,
            }})));
            store.dispatch(receiveDeviceCommand({command_id: requests[0].data.command_id,
                status: 'failed', revision: 2, reason: wrapped ? hardwareError : reason}));
        });
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(screen.queryByText('Connection failed')).not.toBeInTheDocument();
        expect(screen.getByRole('alert').textContent).toBe(reason);
        expect(screen.getAllByText(reason, {exact: true})).toHaveLength(1);
        expect(screen.getByRole('button', {name: 'Connect'})).toBeEnabled();
        fireEvent.click(within(screen.getByRole('alert')).getByRole('button', {name: 'Close'}));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(screen.queryByText('Connection failed')).not.toBeInTheDocument();
    });

    it('preserves different device and command errors in the alert', async () => {
        const {store, requests} = setup({snapshots: []});
        await act(async () => fireEvent.click(screen.getByRole('button', {name: 'Connect'})));
        act(() => {
            store.dispatch(receiveDeviceSnapshot(snapshot({data: {
                connected: false, error: true, error_message: 'Controller connection lost',
            }})));
            store.dispatch(receiveDeviceCommand({command_id: requests[0].data.command_id,
                status: 'failed', revision: 2, reason: 'Device is reserved by a scheduled observation'}));
        });
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(screen.getByRole('alert').textContent).toBe(
            'Controller connection lost\nDevice is reserved by a scheduled observation',
        );
    });

    it.each(['rotator', 'rig'])('shows a dismissible rejected %s request and refreshes the hardware state', async (kind) => {
        setup({kind, snapshots: []});
        socket.emit.mockImplementation((_event, request, ack) => ack(request.cmd === 'control-hardware'
            ? {success: false, error: 'Device is reserved by a scheduled observation'}
            : {success: true, data: {epoch: 'boot', server_time: Date.now() / 1000, devices: [], commands: []}}));
        await act(async () => fireEvent.click(screen.getByRole('button', {name: 'Connect'})));
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
        expect(screen.getByRole('alert')).toHaveTextContent('Device is reserved by a scheduled observation');
        expect(socket.emit).toHaveBeenLastCalledWith('api.call', expect.objectContaining({cmd: 'get-hardware-state'}), expect.any(Function));
        const header = within(screen.getByRole('region')).getByRole('button', {expanded: true});
        fireEvent.click(within(screen.getByRole('alert')).getByRole('button', {name: 'Close'}));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        expect(header).toHaveAttribute('aria-expanded', 'true');
        expect(screen.queryByRole('status')).not.toBeInTheDocument();
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
        expect(screen.getByRole('button', {name: 'Manual movement…'})).toBeDisabled();
        expect(screen.getByRole('button', {name: 'Pause tracking'})).toBeEnabled();
    });

    it('offers park and release only for manually owned hardware', async () => {
        const {requests} = setup({snapshots: [snapshot({owner: {type: 'manual', id: 'manual:rotator:mount'}})]});
        expect(screen.getByRole('button', {name: 'Release control'})).toBeEnabled();
        openMenu();
        expect(screen.getByRole('menuitem', {name: 'Unpark'})).toHaveAttribute('aria-disabled', 'true');
        await act(async () => fireEvent.click(screen.getByRole('menuitem', {name: 'Park'})));
        expect(requests[0].data.action).toBe('park');
    });

    it('shows an empty state without target rows when no devices are configured', () => {
        setup({config: [], snapshots: []});
        expect(screen.getByText('No rotators configured')).toBeInTheDocument();
        expect(screen.queryByRole('region')).not.toBeInTheDocument();
    });

    it.each(['rotator', 'rig'])('keeps %s action positions through connection and ownership changes', async (kind) => {
        const {store, requests} = setup({kind, config: [{...mount, stop_supported: true}],
            snapshots: [snapshot({kind, data: {connected: false}})]});
        const stopLabel = kind === 'rotator' ? 'Stop' : 'Pause tracking';
        const labels = ['Take manual control', 'Release control', 'Connect', 'Disconnect', stopLabel,
            ...(kind === 'rotator' ? ['Manual movement…', 'Parking actions for S.A.T.'] : [])];
        const buttons = labels.map((name) => screen.getByRole('button', {name}));
        expect(screen.getByRole('button', {name: 'Connect'})).toBeEnabled();
        expect(screen.getByRole('button', {name: 'Disconnect'})).toBeDisabled();
        expect(screen.getByRole('button', {name: stopLabel})).toBeDisabled();
        for (const [sequence, type] of [[2, 'manual'], [3, 'tracker'], [4, 'observation']]) {
            act(() => store.dispatch(receiveDeviceSnapshot(snapshot({kind, sequence,
                owner: {type, id: `${type}-owner`}, data: {connected: true},
            }))));
            expect(labels.map((name) => screen.getByRole('button', {name}))).toEqual(buttons);
            expect(screen.getByRole('button', {name: 'Connect'})).toBeDisabled();
            expect(screen.getByRole('button', {name: 'Disconnect'})).toBeEnabled();
            expect(screen.getByRole('button', {name: stopLabel})).toBeEnabled();
            expect(screen.getByRole('button', {name: 'Take manual control'}).disabled).toBe(type !== 'tracker');
            expect(screen.getByRole('button', {name: 'Release control'}).disabled).toBe(type !== 'manual');
        }
        act(() => store.dispatch(receiveDeviceSnapshot(snapshot({kind, sequence: 5, data: {connected: false}}))));
        expect(labels.map((name) => screen.getByRole('button', {name}))).toEqual(buttons);
        expect(screen.getByRole('button', {name: 'Connect'})).toBeEnabled();
        fireEvent.click(within(screen.getByRole('region')).getByRole('button', {expanded: true}));
        await waitFor(() => expect(screen.queryByRole('button', {name: 'Take manual control'})).not.toBeInTheDocument());
        expect(screen.getByRole('button', {name: 'Connect'})).toBeEnabled();
        expect(screen.getByRole('button', {name: 'Disconnect'})).toBeDisabled();
        expect(screen.getByRole('button', {name: stopLabel})).toBeDisabled();
        expect(requests).toEqual([]);
    });

    it.each(['rotator', 'rig'])('places %s command feedback first in the collapsible body', async (kind) => {
        const {store} = setup({kind, snapshots: [snapshot({kind})]});
        const header = within(screen.getByRole('region')).getByRole('button', {expanded: true});
        const status = screen.getByRole('status');
        expect(within(header).queryByRole('status')).not.toBeInTheDocument();
        expect(within(document.getElementById(header.getAttribute('aria-controls'))).getByRole('status')).toBe(status);
        expect(status).toHaveTextContent('Ready');
        expect(status.compareDocumentPosition(screen.getByText('Control:')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        act(() => store.dispatch(receiveDeviceCommand({tracker_id: `manual:${kind}:mount`, command_id: 'pending',
            device_ids: {[kind]: 'mount'}, action: 'connect', status: 'started', revision: 1,
        })));
        expect(screen.getByRole('status')).toBe(status);
        expect(status).toHaveTextContent('Connecting…');
        expect(screen.getByRole('button', {name: 'Disconnect'})).toBeEnabled();
        expect(screen.getByRole('button', {name: 'Pause tracking'})).toBeEnabled();
        fireEvent.click(header);
        await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
        fireEvent.click(header);
        expect(screen.getByRole('status')).toHaveTextContent('Connecting…');
    });

    it('keeps both parking choices visible as the rotator parks', () => {
        const {store} = setup({snapshots: [snapshot({owner: {type: 'manual', id: 'manual:rotator:mount'}})]});
        openMenu();
        expect(screen.getByRole('menuitem', {name: 'Park'})).toHaveFocus();
        expect(screen.getByRole('menuitem', {name: 'Park'})).not.toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByRole('menuitem', {name: 'Unpark'})).toHaveAttribute('aria-disabled', 'true');
        act(() => store.dispatch(receiveDeviceSnapshot(snapshot({sequence: 2,
            owner: {type: 'manual', id: 'manual:rotator:mount'}, data: {connected: true, parked: true},
        }))));
        expect(screen.getByRole('menuitem', {name: 'Park'})).toHaveAttribute('aria-disabled', 'true');
        expect(screen.getByRole('menuitem', {name: 'Unpark'})).not.toHaveAttribute('aria-disabled', 'true');
    });

    it('explains unavailable actions on keyboard focus', async () => {
        setup({snapshots: [snapshot({owner: {type: 'tracker', id: 'target-1'}})]});
        const move = screen.getByRole('button', {name: 'Manual movement…'});
        expect(move).toBeDisabled();
        fireEvent.keyDown(document, {key: 'Tab'});
        act(() => move.parentElement.focus());
        expect(await screen.findByRole('tooltip')).toHaveTextContent('Take manual control first');
    });
});
