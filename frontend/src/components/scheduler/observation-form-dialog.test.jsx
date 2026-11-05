import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/config.js';
import schedulerReducer, { setDialogOpen } from './scheduler-slice.jsx';
import ObservationFormDialog from './observation-form-dialog.jsx';

const socket = vi.hoisted(() => ({ emit: vi.fn() }));
vi.mock('../common/socket.jsx', () => ({ useSocket: () => ({ socket }) }));

const pass = {
    id: 'pass-1', event_start: '2026-11-06T12:00:00Z',
    event_end: '2026-11-06T12:10:00Z', peak_altitude: 45,
};
const satellite = { norad_id: 25544, name: 'ISS' };
const sdr = {
    id: 'sdr-1', name: 'Receiver', gain: 0, antenna_port: 'RX', sample_rate: 2000000,
    center_frequency: 145000000, auto_center_frequency: false,
};

function renderForm({ editing = false, passSelected = true, availablePasses = [pass], overrides = {} } = {}) {
    const observation = {
        ...(editing ? { id: 'obs-1' } : {}), name: 'My observation', enabled: true,
        status: 'scheduled', satellite, pass: passSelected ? pass : null,
        sessions: [{ sdr, tasks: [] }], rotator: { id: null }, rig: { id: null },
        ...overrides,
    };
    const pendingSaves = [];
    socket.emit.mockImplementation((_event, request, acknowledge) => {
        if (['create-scheduled-observation', 'update-scheduled-observation'].includes(request.cmd)) {
            pendingSaves.push({ request, acknowledge });
            return;
        }
        const responses = {
            'get-sdr-parameters': { gain_values: [0], antennas: { rx: ['RX'] } },
            'get-libretranslate-capabilities': { configured: false, languages: [] },
            'get-satellites': [satellite], 'get-transmitters': [],
            'fetch-next-passes': availablePasses,
        };
        acknowledge({ success: true, data: responses[request.cmd] ?? [] });
    });
    const hardwareState = { sdrs: [sdr], rotators: [], rigs: [], instances: [] };
    const store = configureStore({
        reducer: {
            scheduler: schedulerReducer, sdrs: () => hardwareState,
            rotators: () => hardwareState, rigs: () => hardwareState,
            trackerInstances: () => hardwareState,
        },
        preloadedState: { scheduler: {
            ...schedulerReducer(undefined, { type: '@@INIT' }), dialogOpen: true,
            selectedObservation: observation, observations: editing ? [observation] : [],
        } },
    });
    render(<Provider store={store}><ObservationFormDialog /></Provider>);
    return { store, pendingSaves, save: screen.getByRole('button', { name: editing ? 'Update' : 'Create' }) };
}

describe('observation form validation and save errors', () => {
    beforeEach(() => {
        socket.emit.mockReset();
    });

    it('blocks saving without a pass, explains why, and allows saving after selecting one', async () => {
        const { save, pendingSaves } = renderForm({ passSelected: false });
        const label = await screen.findByText('Select Pass', { selector: 'label' });
        expect(save).toBeDisabled();
        expect(screen.getByRole('alert')).toHaveTextContent('Select an available pass');
        fireEvent.click(save);
        expect(pendingSaves).toHaveLength(0);

        fireEvent.mouseDown(within(label.parentElement).getByRole('combobox'));
        fireEvent.click(screen.getByRole('option'));
        await waitFor(() => expect(save).toBeEnabled());
        await act(async () => fireEvent.click(save));
        expect(pendingSaves).toHaveLength(1);
        expect(pendingSaves[0].request.data.pass).toMatchObject({
            event_start: pass.event_start, event_end: pass.event_end,
        });
    });

    it('reports an empty pass list and keeps saving blocked', async () => {
        const { save, pendingSaves } = renderForm({ passSelected: false, availablePasses: [] });
        await screen.findByText('No passes found in the next 24 hours');
        expect(save).toBeDisabled();
        expect(screen.queryByText('Fetching satellite passes...')).not.toBeInTheDocument();
        expect(pendingSaves).toHaveLength(0);
    });

    it('explains missing required inputs instead of silently disabling save', async () => {
        const { save } = renderForm({
            overrides: { name: '  ', sessions: [{ sdr: { ...sdr, gain: null, antenna_port: '', sample_rate: 0 }, tasks: [] }] },
        });
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Enter an observation name.'));
        expect(screen.getByRole('alert')).toHaveTextContent('SDR session 1: select an SDR, gain, antenna port, and a positive sample rate.');
        expect(save).toBeDisabled();
    });

    it.each([false, true])('shows server failures, preserves inputs, and supports retry (editing=%s)', async (editing) => {
        const { store, save, pendingSaves } = renderForm({ editing });
        await waitFor(() => expect(save).toBeEnabled());
        await act(async () => fireEvent.click(save));
        expect(store.getState().scheduler.isSavingObservation).toBe(true);
        await act(async () => pendingSaves[0].acknowledge({ success: false, error: 'Receiver unavailable' }));

        expect(screen.getByRole('alert')).toHaveTextContent('Unable to save observation');
        expect(screen.getByRole('alert')).toHaveTextContent('Receiver unavailable');
        expect(store.getState().scheduler.dialogOpen).toBe(true);
        expect(screen.getByDisplayValue('My observation')).toBeInTheDocument();
        expect(save).toBeEnabled();

        await act(async () => fireEvent.click(save));
        expect(screen.queryByText('Receiver unavailable')).not.toBeInTheDocument();
        await act(async () => pendingSaves[1].acknowledge({
            success: true, data: { ...pendingSaves[1].request.data, id: 'obs-1' },
        }));
        expect(store.getState().scheduler.dialogOpen).toBe(false);
        expect(store.getState().scheduler.observationError).toBeNull();
    });

    it('clears previous save errors when the form is reopened', async () => {
        const { store, save, pendingSaves } = renderForm();
        await waitFor(() => expect(save).toBeEnabled());
        await act(async () => fireEvent.click(save));
        await act(async () => pendingSaves[0].acknowledge({ success: false, error: 'Save failed' }));
        expect(screen.getByRole('alert')).toHaveTextContent('Save failed');

        await act(async () => store.dispatch(setDialogOpen(false)));
        await act(async () => store.dispatch(setDialogOpen(true)));
        expect(store.getState().scheduler.observationError).toBeNull();
        expect(screen.queryByText('Save failed')).not.toBeInTheDocument();
    });
});
