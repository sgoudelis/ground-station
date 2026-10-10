import React from 'react';
import {describe, expect, it, vi} from 'vitest';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {ThemeProvider} from '@mui/material/styles';
import {setupTheme} from '../../../theme.js';
import {useSocket} from '../../common/socket.jsx';
import RotatorControl from '../../dashboard/rotator-control.jsx';
import reducer from '../target-slice.jsx';

vi.mock('../../common/socket.jsx', () => ({useSocket: vi.fn()}));
vi.mock('react-i18next', async importOriginal => ({
    ...await importOriginal(), useTranslation: () => ({t: (key, options) => options?.defaultValue ?? key}),
}));

function setup() {
    const initial = reducer(undefined, {type: '@@init'});
    const trackingState = {
        rotator_id: 'original',
        rotator_state: 'disconnected',
        target_type: 'satellite',
        norad_id: 25544,
        rig_id: 'none',
        transmitter_id: 'none',
    };
    const view = {
        trackingState,
        confirmedTrackingState: trackingState,
        selectedRotator: 'original',
        satelliteId: 25544,
        rotatorData: {connected: false, az: 0, el: 0},
        hardwareObservedAt: Date.now(),
        hardwareReceivedAt: Date.now(),
    };
    const store = configureStore({
        reducer: {
            targetSatTrack: reducer,
            trackerInstances: () => ({
                instances: [{tracker_id: 'target-1', rotator_id: 'original', tracking_state: trackingState}],
            }),
            rotators: () => ({
                rotators: [
                    {id: 'original', name: 'Original', host: 'localhost', port: 4534},
                    {id: 'hamlib', name: 'S.A.T. (Hamlib)', host: 'localhost', port: 4533},
                ],
            }),
            celestial: () => ({}),
        },
        preloadedState: {
            targetSatTrack: {
                ...initial,
                trackerId: 'target-1',
                trackerViews: {'target-1': view},
            },
        },
        middleware: getDefault => getDefault({serializableCheck: false}),
    });
    const requests = [];
    useSocket.mockReturnValue({
        socket: {
            connected: true,
            on: vi.fn(),
            off: vi.fn(),
            timeout: () => ({emit: (_event, request, ack) => requests.push({request, ack})}),
        },
    });
    render(
        <Provider store={store}>
            <ThemeProvider theme={setupTheme()}>
                <RotatorControl />
            </ThemeProvider>
        </Provider>
    );
    return {store, requests};
}

describe('rotator selection errors', () => {
    it('shows the backend rejection and restores the previous selection', async () => {
        const {store, requests} = setup();
        fireEvent.mouseDown(document.getElementById('rotator-select'));
        fireEvent.click(screen.getByRole('option', {name: /S\.A\.T\. \(Hamlib\)/}));

        expect(requests).toHaveLength(1);
        expect(store.getState().targetSatTrack.trackerViews['target-1'].selectedRotator).toBe('hamlib');

        await act(async () => requests[0].ack(null, {
            success: false,
            error: 'rotator_in_use',
            message: "Rotator 'hamlib' is already assigned to tracker 'obs-finished-pass'.",
        }));

        expect(screen.getByRole('dialog')).toHaveTextContent(
            "Rotator 'hamlib' is already assigned to tracker 'obs-finished-pass'."
        );
        expect(store.getState().targetSatTrack.trackerViews['target-1'].selectedRotator).toBe('original');

        fireEvent.click(screen.getByRole('button', {name: 'close'}));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    });
});
