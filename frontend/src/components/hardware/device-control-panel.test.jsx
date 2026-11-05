import React from 'react';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {ThemeProvider} from '@mui/material/styles';
import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {describe, expect, it, vi} from 'vitest';
import '../../i18n/config.js';
import {setupTheme} from '../../theme.js';
import HardwareSettingsPopover from '../dashboard/hardware-popover.jsx';
import tracking from '../target/target-slice.jsx';
import hardware, {fetchHardwareState, receiveDeviceCommand, receiveDeviceSnapshot} from './control-slice.js';
import DeviceControlPanel from './device-control-panel.jsx';

const {socket} = vi.hoisted(() => ({socket: {connected: true, emit: vi.fn(), on: vi.fn(), off: vi.fn()}}));
vi.mock('../common/socket.jsx', () => ({useSocket: () => ({socket})}));

describe('hardware without targets', () => {
    it('can take control of a disconnected device held by an old tracker', async () => {
        socket.emit.mockImplementation((_event, request, ack) => ack({success: true, data: {command: {
            ...request.data, tracker_id: 'manual:rotator:mount', device_ids: {rotator: 'mount'},
            status: 'submitted', revision: 1, submitted_at: Date.now() / 1000,
        }}}));
        const store = configureStore({reducer: {
            hardwareControl: hardware,
            rotators: () => ({rotators: [{id: 'mount', name: 'Station mount'}]}),
        }});
        store.dispatch(fetchHardwareState.fulfilled({epoch: 'boot', server_time: Date.now() / 1000, commands: [], devices: [{
            kind: 'rotator', device_id: 'mount', epoch: 'boot', generation: 'old-lease',
            worker_generation: 'worker', worker_started_at: 1, sequence: 1,
            owner: {type: 'tracker', id: 'target-1'}, data: {connected: false, error: true, motion_unconfirmed: true},
        }]}));
        render(<Provider store={store}><ThemeProvider theme={setupTheme()}><DeviceControlPanel kind="rotator" /></ThemeProvider></Provider>);
        expect(screen.queryByRole('button', {name: 'Connect'})).not.toBeInTheDocument();
        const takeover = screen.getByRole('button', {name: 'Take manual control'});
        expect(takeover).toBeEnabled();
        await act(async () => fireEvent.click(takeover));
        expect(socket.emit).toHaveBeenLastCalledWith('api.call', expect.objectContaining({data: expect.objectContaining({
            action: 'take-control', device_id: 'mount', generation: 'old-lease',
        })}), expect.any(Function));
    });

    it('connects and opens manual movement using only device identity', async () => {
        const requests = [];
        socket.emit.mockImplementation((_event, request, ack) => {
            requests.push(request);
            ack({success: true, data: {command: {
                ...request.data, tracker_id: 'manual:rotator:mount', device_ids: {rotator: 'mount'},
                status: 'submitted', revision: 1, submitted_at: Date.now() / 1000,
            }}});
        });
        const store = configureStore({reducer: {
            targetSatTrack: tracking, hardwareControl: hardware,
            trackerInstances: () => ({instances: []}),
            rigs: () => ({rigs: []}),
            rotators: () => ({rotators: [{id: 'mount', name: 'Station mount', host: 'localhost', port: 4533,
                minaz: 0, maxaz: 450, minel: 0, maxel: 90, azimuth_mode: '0_450'}]}),
        }});
        store.dispatch(fetchHardwareState.fulfilled({epoch: 'boot', server_time: Date.now() / 1000, devices: [], commands: []}));
        render(<Provider store={store}><ThemeProvider theme={setupTheme()}><HardwareSettingsPopover /></ThemeProvider></Provider>);
        fireEvent.click(screen.getByRole('button', {name: 'Rotator controls'}));
        await act(async () => fireEvent.click(screen.getByRole('button', {name: 'Connect'})));
        expect(requests[0]).toMatchObject({cmd: 'control-hardware', data: {kind: 'rotator', device_id: 'mount', action: 'connect'}});
        expect(requests[0].data.tracker_id).toBeUndefined();
        act(() => {
            store.dispatch(receiveDeviceCommand({
                command_id: requests[0].data.command_id, status: 'succeeded', revision: 2,
            }));
            store.dispatch(receiveDeviceSnapshot({
                kind: 'rotator', device_id: 'mount', epoch: 'boot', generation: 'lease',
                worker_generation: 'worker', worker_started_at: 1, sequence: 1,
                owner: {type: 'manual', id: 'manual:rotator:mount'}, data: {connected: true, az: 410, el: 25},
            }));
        });
        fireEvent.click(screen.getByRole('button', {name: 'Manual movement'}));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByRole('slider', {name: /azimuth dial/i})).toHaveAttribute('aria-valuenow', '50');
        expect(within(dialog).getByRole('button', {name: /^move$/i})).toBeEnabled();
        await act(async () => fireEvent.click(within(dialog).getByRole('button', {name: /^move$/i})));
        expect(requests[1]).toMatchObject({cmd: 'control-hardware', data: {
            kind: 'rotator', device_id: 'mount', generation: 'lease', action: 'move', position: {az: 50, el: 25},
        }});
        expect(store.getState().trackerInstances.instances).toEqual([]);
    });
});
