import React from 'react';
import {act, fireEvent, render, screen, waitFor, within} from '@testing-library/react';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {MemoryRouter, useLocation} from 'react-router-dom';
import {ThemeProvider} from '@mui/material/styles';
import {beforeEach, describe, expect, it, vi} from 'vitest';
import '../../i18n/config.js';
import {setupTheme} from '../../theme.js';
import HardwareSettingsPopover from './hardware-popover.jsx';
import tracking from '../target/target-slice.jsx';
import scheduler from '../scheduler/scheduler-slice.jsx';
import hardware, {fetchHardwareState, receiveDeviceCommand, receiveDeviceSnapshot} from '../hardware/control-slice.js';

const {socket} = vi.hoisted(() => ({socket: {connected: true, emit: vi.fn()}}));
vi.mock('../common/socket.jsx', () => ({useSocket: () => ({socket})}));

function CurrentPage() {
    return <div data-testid="current-page">{useLocation().pathname}</div>;
}

function setup({data = {}, owner = {type: 'manual', id: 'manual:rotator:mount'}, devices,
    observations = [], kind = 'rotator', stopSupported = true} = {}) {
    const snapshot = {
        kind, device_id: 'mount', epoch: 'boot', generation: 'lease',
        worker_generation: 'worker', worker_started_at: 1, sequence: 1, owner,
        data: {connected: true, tracking: false, az: 410, el: 25, ...data},
    };
    const config = {id: 'mount', name: 'Station mount', host: 'localhost', port: 4533,
        azimuth_mode: '0_450', minaz: 0, maxaz: 450, minel: 0, maxel: 90, stop_supported: stopSupported};
    const initial = tracking(undefined, {type: '@@init'});
    const store = configureStore({
        reducer: {
            hardwareControl: hardware, targetSatTrack: tracking, scheduler,
            trackerInstances: () => ({instances: [
                {tracker_id: 'target-1', target_number: 1},
                {tracker_id: 'target-2', target_number: 2, tracking_state: {target_name: 'ISS'}},
            ]}),
            rotators: () => ({rotators: kind === 'rotator' ? [config] : []}),
            rigs: () => ({rigs: kind === 'rig' ? [config] : []}),
        },
        preloadedState: {
            targetSatTrack: {...initial, trackerId: 'target-1'},
            scheduler: {...scheduler(undefined, {type: '@@init'}), observations},
        },
    });
    const payload = {epoch: 'boot', server_time: Date.now() / 1000, devices: devices ?? [snapshot], commands: []};
    store.dispatch(fetchHardwareState.fulfilled(payload));
    const requests = [];
    socket.emit.mockImplementation((_event, request, ack) => {
        if (request.cmd === 'get-hardware-state') return ack({success: true, data: payload});
        requests.push(request);
        ack({success: true, data: {command: {
            ...request.data, tracker_id: `manual:${kind}:mount`, device_ids: {[kind]: 'mount'},
            status: 'submitted', revision: 1, submitted_at: Date.now() / 1000,
        }}});
    });
    render(<Provider store={store}><ThemeProvider theme={setupTheme()}>
        <MemoryRouter initialEntries={['/hardware']}><CurrentPage /><HardwareSettingsPopover /></MemoryRouter>
    </ThemeProvider></Provider>);
    const open = async () => {
        await act(async () => fireEvent.click(screen.getByRole('button', {name: kind === 'rotator' ? 'Rotator controls' : 'Rig controls'})));
        return screen.getByRole('dialog', {name: kind === 'rotator' ? 'Rotator controls' : 'Rig controls'});
    };
    return {store, requests, snapshot, open};
}

beforeEach(() => {vi.clearAllMocks(); socket.connected = true;});

describe('device popovers', () => {
    it('shows physical device telemetry and a connected count without a target list', async () => {
        const {open} = setup();
        const popover = await open();
        expect(within(popover).getAllByRole('region')).toHaveLength(1);
        expect(within(popover).getByText('1 connected')).toBeInTheDocument();
        expect(within(popover).getByText('410.0°')).toBeInTheDocument();
        expect(within(popover).getByText('25.0°')).toBeInTheDocument();
        expect(within(popover).getByText('Manual control')).toBeInTheDocument();
        expect(screen.queryByText(/Quick Actions/)).not.toBeInTheDocument();
        expect(screen.queryByText('ISS')).not.toBeInTheDocument();
    });

    it('opens manual movement over the current page and sends device-scoped Move and Stop', async () => {
        const {store, requests, open} = setup();
        await open();
        fireEvent.click(screen.getByRole('button', {name: 'Manual movement'}));
        await waitFor(() => expect(screen.queryByRole('dialog', {name: 'Rotator controls'})).not.toBeInTheDocument());
        const dialog = screen.getByRole('dialog');
        const azimuth = within(dialog).getByRole('slider', {name: /azimuth dial/i});
        expect(azimuth).toHaveAttribute('aria-valuenow', '50');
        expect(azimuth).toHaveAttribute('aria-valuemax', '360');
        await act(async () => fireEvent.click(within(dialog).getByRole('button', {name: /^move$/i})));
        expect(requests[0]).toMatchObject({cmd: 'control-hardware', data: {
            kind: 'rotator', device_id: 'mount', generation: 'lease', action: 'move', position: {az: 50, el: 25},
        }});
        expect(requests[0].data.tracker_id).toBeUndefined();
        expect(within(dialog).getByRole('button', {name: /^move$/i})).toBeDisabled();
        await act(async () => fireEvent.click(within(dialog).getByRole('button', {name: /^stop$/i})));
        expect(requests[1].data.action).toBe('stop');
        expect(store.getState().targetSatTrack.trackerId).toBe('target-1');
        expect(screen.getByTestId('current-page')).toHaveTextContent('/hardware');
        fireEvent.click(within(dialog).getByRole('button', {name: /close/i}));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it('connects a saved rotator without assigning a target', async () => {
        const {open, requests, store, snapshot} = setup({devices: [], owner: null});
        await open();
        await act(async () => fireEvent.click(screen.getByRole('button', {name: 'Connect'})));
        expect(requests[0].data).toMatchObject({action: 'connect', device_id: 'mount'});
        expect(screen.getByRole('status')).toHaveTextContent('Connecting…');
        act(() => {
            store.dispatch(receiveDeviceCommand({command_id: requests[0].data.command_id, status: 'succeeded', revision: 2}));
            store.dispatch(receiveDeviceSnapshot({...snapshot, owner: {type: 'manual', id: 'manual:rotator:mount'}}));
        });
        expect(screen.getByRole('button', {name: 'Manual movement'})).toBeEnabled();
        expect(store.getState().targetSatTrack.trackerId).toBe('target-1');
    });

    it('shows the owner name and only changes targets through Open target', async () => {
        const {store, open, requests} = setup({owner: {type: 'tracker', id: 'target-2'}, data: {tracking: true}});
        await open();
        expect(screen.getByRole('region', {name: 'Station mount'})).toHaveTextContent('ISS');
        expect(screen.getByRole('button', {name: 'Take manual control'})).toBeEnabled();
        expect(store.getState().targetSatTrack.trackerId).toBe('target-1');
        fireEvent.click(screen.getByRole('button', {name: 'Open target'}));
        expect(store.getState().targetSatTrack.trackerId).toBe('target-2');
        expect(screen.getByTestId('current-page')).toHaveTextContent('/tracking');
        expect(requests).toEqual([]);
    });

    it('opens the owning observation and prevents manual takeover', async () => {
        const observation = {id: 'obs-pass', satellite: {name: 'NOAA 19'}};
        const {store, open} = setup({owner: {type: 'observation', id: 'obs-pass'}, observations: [observation]});
        await open();
        expect(screen.getByRole('region', {name: 'Station mount'})).toHaveTextContent('NOAA 19');
        expect(screen.queryByRole('button', {name: 'Take manual control'})).not.toBeInTheDocument();
        expect(screen.queryByRole('button', {name: 'Manual movement'})).not.toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Stop'})).toBeEnabled();
        fireEvent.click(screen.getByRole('button', {name: 'View observation'}));
        expect(store.getState().scheduler.selectedObservation.id).toBe('obs-pass');
        expect(store.getState().scheduler.dialogOpen).toBe(true);
        expect(store.getState().targetSatTrack.trackerId).toBe('target-1');
    });

    it.each(['rotator', 'rig'])('links to %s management', async (kind) => {
        const {open} = setup({kind});
        await open();
        fireEvent.click(screen.getByRole('button', {name: kind === 'rotator' ? 'Manage rotators' : 'Manage rigs'}));
        expect(screen.getByTestId('current-page')).toHaveTextContent(`/admin/system/hardware/${kind === 'rotator' ? 'rotators' : 'rigs'}`);
    });

    it('shows rig frequencies and Pause tracking', async () => {
        const {open} = setup({kind: 'rig', owner: {type: 'tracker', id: 'target-2'}, data: {
            frequency: 145800000, vfo1: {frequency: 435000000}, vfo2: {frequency: 145800000}, tracking: true,
        }});
        await open();
        expect(screen.getByText('435.000000 MHz')).toBeInTheDocument();
        expect(screen.getAllByText('145.800000 MHz')).toHaveLength(2);
        expect(screen.getByRole('button', {name: 'Pause tracking'})).toBeEnabled();
    });

    it('keeps Stop visible on a collapsed device row', async () => {
        const {open, requests} = setup();
        await open();
        fireEvent.click(within(screen.getByRole('region', {name: 'Station mount'})).getByRole('button', {expanded: true}));
        expect(screen.queryByRole('button', {name: 'Manual movement'})).not.toBeInTheDocument();
        await act(async () => fireEvent.click(screen.getByRole('button', {name: 'Stop'})));
        expect(requests[0].data.action).toBe('stop');
    });

    it('labels unsupported physical Stop as Pause tracking', async () => {
        const {open} = setup({stopSupported: false});
        await open();
        expect(screen.getByRole('button', {name: 'Pause tracking'})).toBeEnabled();
        expect(screen.queryByRole('button', {name: 'Stop'})).not.toBeInTheDocument();
    });

    it('allows inspecting hardware while offline and disables commands', async () => {
        socket.connected = false;
        const {open} = setup();
        await open();
        expect(screen.getByText('Connection to station lost')).toBeInTheDocument();
        expect(screen.getByRole('button', {name: 'Manual movement'})).toBeDisabled();
        expect(screen.getByRole('button', {name: 'Stop'})).toBeDisabled();
        expect(screen.queryByText('410.0°')).not.toBeInTheDocument();
        expect(socket.emit).not.toHaveBeenCalled();
    });

    it('disables an open movement dialog when device ownership changes', async () => {
        const {open, store, snapshot} = setup();
        await open();
        fireEvent.click(screen.getByRole('button', {name: 'Manual movement'}));
        await waitFor(() => expect(screen.queryByRole('dialog', {name: 'Rotator controls'})).not.toBeInTheDocument());
        act(() => store.dispatch(receiveDeviceSnapshot({...snapshot, sequence: 2,
            owner: {type: 'observation', id: 'obs-new'}, data: {...snapshot.data, tracking: true},
        })));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByRole('button', {name: /^move$/i})).toBeDisabled();
        expect(within(dialog).getByRole('button', {name: /^stop$/i})).toBeEnabled();
    });
});
