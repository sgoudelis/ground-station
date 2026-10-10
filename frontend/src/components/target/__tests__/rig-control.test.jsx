import React from 'react';
import {describe, expect, it, vi} from 'vitest';
import {configureStore} from '@reduxjs/toolkit';
import {Provider} from 'react-redux';
import {act, fireEvent, render, screen} from '@testing-library/react';
import {ThemeProvider} from '@mui/material/styles';
import {setupTheme} from '../../../theme.js';
import {useSocket} from '../../common/socket.jsx';
import RigControl from '../../dashboard/rig-control.jsx';
import reducer from '../target-slice.jsx';

vi.mock('../../common/socket.jsx', () => ({useSocket: vi.fn()}));
vi.mock('react-i18next', async importOriginal => ({
    ...await importOriginal(), useTranslation: () => ({t: (key, options) => options?.defaultValue ?? key}),
}));

function setup() {
    const initial = reducer(undefined, {type: '@@init'});
    const trackingState = {rig_id: 'radio', rig_state: 'connected', transmitter_id: 'tx',
        rig_vfo: 'none', vfo1: 'uplink', vfo2: 'downlink',
        rotator_id: 'mount', rotator_state: 'tracking', target_type: 'satellite', norad_id: 25544};
    const view = {trackingState, selectedRadioRig: 'staged-radio', selectedRigVFO: 'none',
        selectedVFO1: 'uplink', selectedVFO2: 'downlink', selectedTransmitter: 'tx',
        availableTransmitters: [{id: 'tx', description: 'Transmitter', downlink_low: 145800000}],
        hardwareObservedAt: Date.now(), hardwareReceivedAt: Date.now(), rigData: {connected: false}};
    const store = configureStore({reducer: {
        targetSatTrack: reducer,
        trackerInstances: () => ({instances: [{tracker_id: 'target-2'}]}),
        rigs: () => ({rigs: [{id: 'staged-radio', name: 'Radio', host: 'localhost', port: 4532}]}),
        sdrs: () => ({sdrs: []}),
    }, preloadedState: {targetSatTrack: {...initial, trackerId: 'target-1', trackerViews: {'target-2': view}}},
    middleware: getDefault => getDefault({serializableCheck: false})});
    const requests = [];
    const socket = {connected: true, on: vi.fn(), off: vi.fn(),
        timeout: () => ({emit: (_event, request, ack) => requests.push({request, ack})})};
    useSocket.mockReturnValue({socket});
    render(<Provider store={store}><ThemeProvider theme={setupTheme()}>
        <RigControl trackerId="target-2" />
    </ThemeProvider></Provider>);
    return {store, requests};
}

describe('rig control submissions', () => {
    it.each([
        ['vfo1-select', 'Downlink', {vfo1: 'downlink'}],
        ['vfo2-select', 'Uplink', {vfo2: 'uplink'}],
        ['transmitter-select', /no_frequency_control/, {transmitter_id: 'none'}],
        [null, null, {vfo1: 'downlink', vfo2: 'uplink'}],
    ])('keeps %s changes scoped to the rig and includes staged selections', async (selectId, option, changes) => {
        const {store, requests} = setup();
        if (selectId) {
            fireEvent.mouseDown(document.getElementById(selectId));
            fireEvent.click(screen.getByRole('option', {name: option}));
        } else {
            fireEvent.click(screen.getByRole('button', {name: 'Swap VFO 1 and VFO 2'}));
        }
        expect(requests).toHaveLength(1);
        expect(requests[0].request.data.tracker_id).toBe('target-2');
        expect(requests[0].request.data.value).toEqual({rig_id: 'staged-radio', ...changes});
        expect(requests[0].request.data.operation.scopes).toEqual(['rig']);
        const view = store.getState().targetSatTrack.trackerViews['target-2'];
        if (changes.vfo1) expect(view.selectedVFO1).toBe(changes.vfo1);
        if (changes.vfo2) expect(view.selectedVFO2).toBe(changes.vfo2);
        if (changes.transmitter_id) expect(view.selectedTransmitter).toBe(changes.transmitter_id);
        expect(view.trackingState.rotator_state).toBe('tracking');
        await act(async () => requests[0].ack(null, {success: true, data: {}}));
    });

    it('keeps an explicit Connect retry even when desired state already says connected', async () => {
        const {requests} = setup();
        fireEvent.click(screen.getByRole('button', {name: 'rig_control.connect'}));
        expect(requests[0].request.data.value).toEqual({rig_id: 'staged-radio', rig_state: 'connected'});
        expect(screen.getByRole('button', {name: 'rig_control.connect'})).toBeDisabled();
        expect(screen.getByRole('status')).toHaveTextContent('Sending…');
        expect(screen.getByRole('button', {name: 'rig_control.stop'})).toBeEnabled();
        await act(async () => requests[0].ack(null, {success: true, data: {}}));
    });
});
