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
import reducer, {setHardwareSnapshot} from '../target/target-slice.jsx';

const {socket} = vi.hoisted(() => ({socket: {
    connected: true, on: vi.fn(), off: vi.fn(), timeout: vi.fn(),
}}));
vi.mock('../common/socket.jsx', () => ({useSocket: () => ({socket})}));

function CurrentPage() {
    return <div data-testid="current-page">{useLocation().pathname}</div>;
}

function setup({rotatorData = {}, trackingState = {}, confirmedTrackingState = {}, receivedAt = Date.now()} = {}) {
    const initial = reducer(undefined, {type: '@@init'});
    const tracking = {norad_id: 25544, rotator_id: 'mount-2', rotator_state: 'connected', ...trackingState};
    const view = {
        trackingState: tracking,
        confirmedTrackingState: {...tracking, ...confirmedTrackingState},
        selectedRotator: tracking.rotator_id,
        rotatorData: {connected: true, tracking: false, az: 410, el: 25, ...rotatorData},
        hardwareObservedAt: Date.now(), hardwareReceivedAt: receivedAt,
        satelliteData: {details: {name: 'Second satellite', norad_id: 25544}},
    };
    const store = configureStore({
        reducer: {
            targetSatTrack: reducer,
            trackerInstances: () => ({instances: [
                {tracker_id: 'target-1', target_number: 1, tracking_state: {norad_id: 123, rotator_id: 'none'}},
                {tracker_id: 'target-2', target_number: 2, rotator_id: tracking.rotator_id, tracking_state: tracking},
            ]}),
            rotators: () => ({rotators: [{id: 'mount-2', name: 'Second mount', host: 'localhost', port: 4533,
                azimuth_mode: '0_450', minaz: 0, maxaz: 450, minel: 0, maxel: 90}]}),
            rigs: () => ({rigs: []}),
        },
        preloadedState: {targetSatTrack: {...initial, trackerId: 'target-1', trackerServerEpoch: 'test-epoch',
            trackerViews: {'target-2': view}}},
        middleware: getDefault => getDefault({serializableCheck: false}),
    });
    const requests = [];
    socket.timeout.mockReturnValue({emit: (_event, request, ack) => requests.push({request, ack})});
    render(
        <Provider store={store}>
            <ThemeProvider theme={setupTheme()}>
                <MemoryRouter initialEntries={['/hardware']}>
                    <CurrentPage />
                    <HardwareSettingsPopover />
                </MemoryRouter>
            </ThemeProvider>
        </Provider>
    );
    fireEvent.click(screen.getByRole('button', {name: /rotator fleet:/i}));
    return {store, requests, view};
}

const manualButtons = () => screen.getAllByRole('button', {name: /manual control/i});

describe('top-bar manual rotator control', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        socket.connected = true;
    });

    it('opens the chosen rotator over the current page and uses its manual limits', async () => {
        const {store} = setup();
        expect(manualButtons()[0]).toBeDisabled();
        fireEvent.click(manualButtons()[1]);

        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByText('Second mount')).toBeInTheDocument();
        expect(within(dialog).getByRole('slider', {name: /azimuth dial/i})).toHaveAttribute('aria-valuenow', '50');
        expect(within(dialog).getByRole('slider', {name: /azimuth dial/i})).toHaveAttribute('aria-valuemax', '360');
        expect(store.getState().targetSatTrack.trackerId).toBe('target-1');
        expect(screen.getByTestId('current-page')).toHaveTextContent('/hardware');
        // The menu unmounts after its exit transition; the global dialog stays open.
        await waitFor(() => expect(screen.queryByText('Rotator Quick Actions')).not.toBeInTheDocument());
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        fireEvent.click(within(dialog).getByRole('button', {name: /close/i}));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });

    it.each([
        ['disconnected', {rotatorData: {connected: false}}],
        ['tracking telemetry', {rotatorData: {tracking: true}}],
        ['tracking state', {trackingState: {rotator_state: 'tracking'}}],
        ['confirmed tracking', {confirmedTrackingState: {rotator_state: 'tracking'}}],
        ['parked telemetry', {rotatorData: {parked: true}}],
        ['parked state', {trackingState: {rotator_state: 'parked'}}],
        ['unconfirmed motion', {rotatorData: {motion_unconfirmed: true}}],
        ['stale hardware', {receivedAt: Date.now() - 16000}],
        ['no assigned rotator', {trackingState: {rotator_id: 'none'}}],
    ])('disables manual control with %s', (_label, options) => {
        setup(options);
        expect(manualButtons()[1]).toBeDisabled();
    });

    it('sends Move and Stop to the chosen row without changing the active tracker', async () => {
        const {store, requests} = setup();
        fireEvent.click(manualButtons()[1]);
        const dialog = screen.getByRole('dialog');
        fireEvent.click(within(dialog).getByRole('button', {name: /^move$/i}));

        expect(requests[0].request).toMatchObject({cmd: 'move-rotator', data: {
            tracker_id: 'target-2', device_ids: {rotator: 'mount-2'}, az: 50, el: 25,
        }});
        expect(within(dialog).getByRole('button', {name: /^move$/i})).toBeDisabled();
        expect(within(dialog).getByRole('button', {name: /^stop$/i})).toBeEnabled();
        fireEvent.click(within(dialog).getByRole('button', {name: /^stop$/i}));
        expect(requests[1].request).toMatchObject({cmd: 'stop-rotator', data: {
            tracker_id: 'target-2', device_ids: {rotator: 'mount-2'},
        }});
        expect(store.getState().targetSatTrack.trackerId).toBe('target-1');
        await act(async () => requests.forEach(({ack}) => ack(null, {success: true, data: {}})));
    });

    it('disables movement when tracking starts while the dialog is open', () => {
        const {store, view} = setup();
        fireEvent.click(manualButtons()[1]);
        expect(within(screen.getByRole('dialog')).getByRole('button', {name: /^move$/i})).toBeEnabled();
        act(() => store.dispatch(setHardwareSnapshot({
            tracker_id: 'target-2', sequence: 1, worker_generation: 'worker', observed_at: Date.now() / 1000,
            tracking_state: {...view.trackingState, rotator_state: 'tracking'},
            rotator_data: {...view.rotatorData, tracking: true},
        })));
        const dialog = screen.getByRole('dialog');
        expect(within(dialog).getByRole('button', {name: /^move$/i})).toBeDisabled();
        expect(within(dialog).getByRole('button', {name: /^stop$/i})).toBeEnabled();
    });
});
