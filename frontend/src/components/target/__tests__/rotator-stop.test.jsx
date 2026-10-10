import React from 'react';
import {describe, expect, it, vi} from 'vitest';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {act, fireEvent, render, screen} from '@testing-library/react';
import {ThemeProvider} from '@mui/material/styles';
import {setupTheme} from '../../../theme.js';
import {useSocket} from '../../common/socket.jsx';
import RotatorControl from '../../dashboard/rotator-control.jsx';
import reducer, {setHardwareSnapshot} from '../target-slice.jsx';
import {resolveRotatorLedStatus} from '../../common/hardware-status.js';

vi.mock('../../common/socket.jsx', () => ({useSocket: vi.fn()}));
vi.mock('react-i18next', async importOriginal => ({
    ...await importOriginal(), useTranslation: () => ({t: (key, options) => options?.defaultValue ?? key}),
}));

describe('rotator Stop recovery', () => {
    it('derives waterfall events from sequenced hardware snapshots', () => {
        const initial = reducer(undefined, {type: '@@init'});
        const trackingState = {rotator_id: 'mount', rotator_state: 'tracking'};

        const tracking = reducer(
            {...initial, trackerId: 'target-1'},
            setHardwareSnapshot({
                tracker_id: 'target-1',
                sequence: 1,
                worker_generation: 'worker',
                worker_started_at: 1,
                observed_at: Date.now() / 1000,
                tracking_state: trackingState,
                rotator_data: {connected: true, tracking: true},
            })
        );
        expect(tracking.lastRotatorEvent).toBe('TRK');

        const stopped = reducer(
            tracking,
            setHardwareSnapshot({
                tracker_id: 'target-1',
                sequence: 2,
                worker_generation: 'worker',
                worker_started_at: 1,
                observed_at: Date.now() / 1000,
                tracking_state: {...trackingState, rotator_state: 'stopped'},
                rotator_data: {connected: true, stopped: true},
            })
        );
        expect(stopped.lastRotatorEvent).toBe('STOP');
    });

    it('keeps Stop and Disconnect available and releases movement only after fresh stationary observations', async () => {
        const initial = reducer(undefined, {type: '@@init'});
        const trackingState = {rotator_id: 'mount', rotator_state: 'stopped', target_type: 'satellite', norad_id: 25544};
        const rotatorData = {connected: true, motion_unconfirmed: true, stopped: false, az: 123, el: 45};
        const view = {trackingState, confirmedTrackingState: trackingState, selectedRotator: 'mount', satelliteId: 25544,
            hardwareObservedAt: Date.now(), hardwareReceivedAt: Date.now(), rotatorData};
        const store = configureStore({reducer: {
            targetSatTrack: reducer,
            trackerInstances: () => ({instances: [{tracker_id: 'target-1'}]}),
            rotators: () => ({rotators: [{id: 'mount', name: 'Mount', host: 'localhost', port: 4533}]}),
        }, preloadedState: {targetSatTrack: {...initial, trackerId: 'target-1', trackerViews: {'target-1': view},
            trackerCommandsById: {stop: {commandId: 'stop', trackerId: 'target-1', scopes: ['rotator'],
                action: 'stop', status: 'unknown', reconciled: true, submittedAt: Date.now() - 1000}}}},
        middleware: getDefault => getDefault({serializableCheck: false})});
        const requests = [];
        useSocket.mockReturnValue({socket: {connected: true, on: vi.fn(), off: vi.fn(),
            timeout: () => ({emit: (_event, request, ack) => requests.push({request, ack})})}});
        render(<Provider store={store}><ThemeProvider theme={setupTheme()}><RotatorControl /></ThemeProvider></Provider>);
        expect(screen.getByRole('status')).toHaveTextContent('Stop unconfirmed');
        expect(screen.getByRole('button', {name: 'rotator_control.stop'})).toBeEnabled();
        expect(screen.getByRole('button', {name: 'rotator_control.disconnect'})).toBeEnabled();
        expect(screen.getByRole('button', {name: 'rotator_control.track'})).toBeDisabled();
        expect(screen.getByRole('button', {name: 'rotator_control.park'})).toBeDisabled();
        expect(resolveRotatorLedStatus({rotatorId: 'mount', rotatorData, trackingState})).toBe('motion_unconfirmed');
        act(() => store.dispatch(setHardwareSnapshot({tracker_id: 'target-1', sequence: 1,
            worker_generation: 'worker', observed_at: Date.now() / 1000, tracking_state: trackingState,
            rotator_data: {...rotatorData, motion_unconfirmed: false, stopped: true}})));
        expect(screen.getByRole('button', {name: 'rotator_control.track'})).toBeEnabled();
        expect(screen.getByRole('button', {name: 'rotator_control.park'})).toBeEnabled();
        // Stationarity resolves the movement lock, not the missing S acknowledgement.
        expect(screen.getByRole('status')).toHaveTextContent('Stop unconfirmed');
        fireEvent.click(screen.getByRole('button', {name: 'rotator_control.stop'}));
        expect(requests).toHaveLength(1);
        expect(screen.getByRole('button', {name: 'rotator_control.stop'})).toBeDisabled();
        await act(async () => requests[0].ack(null, {success: true, data: {}}));
    });
});
