import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '../../i18n/config.js';
import schedulerReducer from './scheduler-slice.jsx';
import ObservationFormDialog from './observation-form-dialog.jsx';

const socket = vi.hoisted(() => ({ emit: vi.fn() }));
vi.mock('../common/socket.jsx', () => ({ useSocket: () => ({ socket }) }));

function selectOption(label, name) {
    const control = screen.getByText(label, { selector: 'label' }).parentElement;
    fireEvent.mouseDown(within(control).getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name }));
}

describe('observation hardware conflicts', () => {
    it('allows the Meteor/UMKA overlap and updates both pass options and saving when hardware changes', async () => {
        const pass = {
            id: 'meteor-pass', event_start: '2026-10-30T18:39:32Z',
            event_end: '2026-10-30T18:54:42Z', peak_altitude: 61.77,
        };
        const satellite = { norad_id: 57166, name: 'METEOR-M2 3' };
        const airspy = {
            id: 'b52bb47b-3d17-4828-bd92-08b65cf49b2f', name: 'Airspy',
            sample_rate: 3000000, gain: 13, antenna_port: 'RX',
            center_frequency: 137900000, auto_center_frequency: false,
        };
        const b210 = { ...airspy, id: '9ad7183f-1223-4678-bdec-9292aa35e185', name: 'B210' };
        const meteor = {
            id: 'meteor', name: 'METEOR-M2 3 - 2026-10-30 18:39 UTC',
            enabled: true, status: 'scheduled', satellite, pass,
            task_start: pass.event_start, task_end: pass.event_end,
            sessions: [{ sdr: airspy, tasks: [] }],
            rotator: { id: null }, rig: { id: null },
        };
        const umka = {
            id: 'umka', name: 'UMKA 1 (RS40S) - 2026-10-30 18:38 UTC',
            enabled: true, status: 'scheduled',
            pass: { event_start: '2026-10-30T18:38:46Z', event_end: '2026-10-30T18:49:06Z' },
            task_start: '2026-10-30T18:40:04.730159Z', task_end: '2026-10-30T18:47:47.269841Z',
            sessions: [{ sdr: b210, tasks: [] }],
            rotator: { id: 'umka-rotator' }, rig: { id: null },
        };
        socket.emit.mockReset();
        socket.emit.mockImplementation((_event, request, acknowledge) => {
            const responses = {
                'get-sdr-parameters': { gain_values: [13], antennas: { rx: ['RX'] } },
                'get-libretranslate-capabilities': { configured: false, languages: [] },
                'get-satellites': [satellite],
                'get-satellite-search': [{ ...satellite, transmitters: [] }],
                'fetch-next-passes': [pass],
            };
            acknowledge({ success: true, data: request.cmd === 'update-scheduled-observation'
                ? request.data : responses[request.cmd] ?? [] });
        });
        const sdrState = { sdrs: [airspy, b210] };
        const rotatorState = { rotators: [] };
        const rigState = { rigs: [] };
        const trackerState = { instances: [] };
        const initialState = schedulerReducer(undefined, { type: '@@INIT' });
        const store = configureStore({
            reducer: {
                scheduler: schedulerReducer, sdrs: () => sdrState,
                rotators: () => rotatorState, rigs: () => rigState,
                trackerInstances: () => trackerState,
            },
            preloadedState: { scheduler: {
                ...initialState, dialogOpen: true, selectedObservation: meteor,
                observations: [meteor, umka],
            } },
        });
        render(<Provider store={store}><ObservationFormDialog /></Provider>);

        const save = screen.getByRole('button', { name: 'Update' });
        await waitFor(() => expect(save).toBeEnabled());
        const passesControl = screen.getByText('Select Pass', { selector: 'label' }).parentElement;
        const passesDropdown = within(passesControl).getByRole('combobox');
        fireEvent.mouseDown(passesDropdown);
        expect(screen.getByRole('option', { selected: true })).not.toHaveAttribute('aria-disabled', 'true');
        expect(screen.queryByText(/Conflicts with:/)).not.toBeInTheDocument();
        fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });

        selectOption('SDR', /B210/);
        await waitFor(() => expect(store.getState().scheduler.sdrParametersLoading).toBe(false));
        selectOption('Gain', '13 dB');
        selectOption('Antenna Port', 'RX');
        await waitFor(() => expect(save).toBeDisabled());
        fireEvent.mouseDown(passesDropdown);
        expect(screen.getByRole('option', { selected: true })).toHaveAttribute('aria-disabled', 'true');
        expect(within(screen.getByRole('option', { selected: true })).getByText(/Conflicts with:.*UMKA/))
            .toBeInTheDocument();
        fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });

        selectOption('SDR', /Airspy/);
        await waitFor(() => expect(store.getState().scheduler.sdrParametersLoading).toBe(false));
        selectOption('Gain', '13 dB');
        selectOption('Antenna Port', 'RX');
        await waitFor(() => expect(save).toBeEnabled());
        await act(async () => fireEvent.click(save));
        const update = socket.emit.mock.calls.find(([, request]) => request.cmd === 'update-scheduled-observation');
        expect(update[1].data).toMatchObject({
            id: meteor.id, task_start: meteor.task_start, task_end: meteor.task_end,
            sessions: [{ sdr: { id: airspy.id } }],
        });
    }, 15000);
});
