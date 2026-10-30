import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/config.js';
import schedulerReducer from './scheduler-slice.jsx';
import MonitoredSatelliteDialog from './monitored-satellite-dialog.jsx';

const socket = vi.hoisted(() => ({ emit: vi.fn() }));
vi.mock('../common/socket.jsx', () => ({ useSocket: () => ({ socket }) }));
vi.mock('./satellite-selector.jsx', () => ({
    SatelliteSelector: ({ onSatelliteSelect }) => (
        <button onClick={() => onSatelliteSelect({ norad_id: 12345, name: 'Test satellite' })}>
            Choose satellite
        </button>
    ),
}));

const satellite = {
    id: 'monitored-1',
    enabled: true,
    satellite: { norad_id: 12345, name: 'Test satellite', group_id: '' },
    sessions: [{
        sdr: {
            id: 'sdr-1', name: 'Test SDR', sample_rate: 1000000,
            gain: 10, antenna_port: 'RX', auto_center_frequency: true,
        },
        tasks: [],
    }],
    min_elevation: 20,
    task_start_elevation: 10,
    lookahead_hours: 24,
};
let requests;

beforeEach(() => {
    requests = [];
    socket.emit.mockReset();
    socket.emit.mockImplementation((_event, request, acknowledge) => {
        if (request.cmd === 'get-sdr-parameters') {
            acknowledge({ success: true, data: { gain_values: [10], antennas: { rx: ['RX'] } } });
        } else if (request.cmd === 'get-libretranslate-capabilities') {
            acknowledge({ success: true, data: { configured: false, languages: [] } });
        } else {
            requests.push({ ...request, acknowledge });
        }
    });
});

function renderDialog(editing = true, selectedSatellite = satellite) {
    const initialState = schedulerReducer(undefined, { type: '@@INIT' });
    const sdrState = { sdrs: [{ id: 'sdr-1', name: 'Test SDR', type: 'test' }] };
    const rotatorState = { rotators: [] };
    const rigState = { rigs: [] };
    const trackerState = { instances: [] };
    const store = configureStore({
        reducer: {
            scheduler: schedulerReducer,
            sdrs: () => sdrState,
            rotators: () => rotatorState,
            rigs: () => rigState,
            trackerInstances: () => trackerState,
        },
        preloadedState: {
            scheduler: {
                ...initialState,
                monitoredSatelliteDialogOpen: true,
                selectedMonitoredSatellite: editing ? selectedSatellite : null,
                monitoredSatellites: editing ? [selectedSatellite] : [],
            },
        },
    });
    render(<Provider store={store}><MonitoredSatelliteDialog /></Provider>);
    return store;
}

async function acknowledge(request, response = { success: true, data: request.data }) {
    await act(async () => request.acknowledge(response));
}

function selectOption(label, option) {
    const control = screen.getByText(label, { selector: 'label' }).parentElement;
    fireEvent.mouseDown(within(control).getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: option }));
}

describe('monitored satellite dialog', () => {
    it('blocks invalid preambles and saves a custom integer in decoder tasks', async () => {
        const selectedSatellite = structuredClone(satellite);
        selectedSatellite.sessions[0].tasks = [{
            id: 'lora-task', type: 'decoder',
            config: { decoder_type: 'lora', transmitter_id: '', parameters: { lora_preamble_len: 15 } },
        }];
        renderDialog(true, selectedSatellite);
        fireEvent.click(screen.getByRole('button', { name: /Decoder.*LoRa/ }));

        const input = await screen.findByRole('spinbutton', { name: 'Preamble Length' });
        const save = screen.getByRole('button', { name: 'Save and Generate' });
        expect(input).toHaveValue(15);
        fireEvent.change(input, { target: { value: '17.5' } });
        expect(input).toHaveAttribute('aria-invalid', 'true');
        expect(save).toBeDisabled();

        fireEvent.change(input, { target: { value: '17' } });
        await waitFor(() => expect(save).toBeEnabled());
        fireEvent.click(save);
        expect(requests[0].data.sessions[0].tasks[0].config.parameters.lora_preamble_len).toBe(17);
    });

    // This full-form creation and retry flow needs extra time with coverage on CI runners.
    it('saves before generating, stays busy until acknowledgement, and retries without duplicating a new definition', async () => {
        const store = renderDialog(false);
        expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Choose satellite' }));
        selectOption('SDR', /Test SDR/);
        await waitFor(() => expect(store.getState().scheduler.sdrParametersLoading).toBe(false));
        selectOption('Gain', '10 dB');
        selectOption('Antenna Port', 'RX');

        const saveButton = screen.getByRole('button', { name: 'Save and Generate' });
        expect(saveButton).toBeEnabled();
        fireEvent.click(saveButton);
        expect(requests.map((request) => request.cmd)).toEqual(['create-monitored-satellite']);
        expect(screen.getByRole('button', { name: 'Saving...' })).toBeDisabled();
        expect(saveButton).toContainElement(screen.getByRole('progressbar'));
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();

        const createdId = requests[0].data.id;
        await acknowledge(requests[0]);
        expect(store.getState().scheduler.monitoredSatelliteDialogOpen).toBe(true);
        expect(requests[1]).toMatchObject({
            cmd: 'regenerate-observations',
            data: { monitored_satellite_id: createdId, dry_run: false },
        });
        expect(screen.getByRole('button', { name: 'Generating schedule...' })).toBeDisabled();
        expect(saveButton).toContainElement(screen.getByRole('progressbar'));
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape', keyCode: 27 });
        expect(store.getState().scheduler.monitoredSatelliteDialogOpen).toBe(true);

        await acknowledge(requests[1], { success: false, error: 'Generator unavailable' });
        expect(screen.getByRole('alert')).toHaveTextContent('was saved, but schedule generation failed: Generator unavailable');
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Save and Generate' }));
        expect(requests[2]).toMatchObject({ cmd: 'update-monitored-satellite', data: { id: createdId } });
        await acknowledge(requests[2]);
        await acknowledge(requests[3]);
        expect(store.getState().scheduler.monitoredSatelliteDialogOpen).toBe(false);
        expect(store.getState().scheduler.monitoredSatellites).toHaveLength(1);
    }, 15000);

    it('generates only the edited satellite after saving its updated criteria', async () => {
        const store = renderDialog();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Save and Generate' })).toBeEnabled());
        fireEvent.change(screen.getByRole('spinbutton', { name: 'Lookahead Window (hours)' }), { target: { value: '48' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save and Generate' }));
        expect(requests[0]).toMatchObject({ cmd: 'update-monitored-satellite', data: { id: satellite.id, lookahead_hours: 48 } });
        await acknowledge(requests[0]);
        expect(requests[1]).toMatchObject({ cmd: 'regenerate-observations', data: { monitored_satellite_id: satellite.id } });
        expect(screen.getByRole('button', { name: 'Delete' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Disable' })).toBeDisabled();
        await acknowledge(requests[1]);
        expect(store.getState().scheduler.monitoredSatelliteDialogOpen).toBe(false);
        expect(store.getState().scheduler.monitoredSatellites[0].lookahead_hours).toBe(48);
    });

    it('does not generate after a failed save and allows another save', async () => {
        const store = renderDialog();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Save and Generate' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Save and Generate' }));
        await acknowledge(requests[0], { success: false, error: 'Could not save definition' });
        expect(requests).toHaveLength(1);
        expect(screen.getByRole('alert')).toHaveTextContent('Could not save definition');
        expect(screen.getByRole('button', { name: 'Save and Generate' })).toBeEnabled();
        expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
        expect(store.getState().scheduler.monitoredSatelliteDialogOpen).toBe(true);
    });

    it('persists enable/disable changes while preserving unsaved edits and reports failures', async () => {
        const store = renderDialog();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Disable' })).toBeEnabled());
        const lookahead = screen.getByRole('spinbutton', { name: 'Lookahead Window (hours)' });
        fireEvent.change(lookahead, { target: { value: '48' } });
        expect(screen.getByRole('button', { name: 'Enable' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
        expect(requests[0]).toMatchObject({ cmd: 'toggle-monitored-satellite-enabled', data: { id: satellite.id, enabled: false } });
        expect(screen.getByRole('button', { name: 'Disable' })).toContainElement(screen.getByRole('progressbar'));
        await acknowledge(requests[0], { success: false });
        expect(screen.getByRole('alert')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Disable' })).toBeEnabled();
        expect(store.getState().scheduler.monitoredSatellites[0].enabled).toBe(true);

        fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
        await acknowledge(requests[1]);
        expect(store.getState().scheduler.monitoredSatellites[0].enabled).toBe(false);
        expect(screen.getByRole('button', { name: 'Disable' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Enable' })).toBeEnabled();
        expect(lookahead).toHaveValue(48);
        fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
        await acknowledge(requests[2]);
        expect(store.getState().scheduler.monitoredSatellites[0].enabled).toBe(true);
        expect(lookahead).toHaveValue(48);
    });

    it.each([false, true])('confirms deletion with deleteObservations=%s and waits for the backend', async (deleteObservations) => {
        const store = renderDialog();
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        const confirmation = screen.getByRole('dialog', { name: 'Confirm Deletion' });
        expect(requests).toHaveLength(0);
        if (deleteObservations) fireEvent.click(within(confirmation).getByRole('checkbox'));
        const deleteButton = within(confirmation).getByRole('button', { name: 'Delete' });
        fireEvent.click(deleteButton);
        expect(requests[0]).toMatchObject({
            cmd: 'delete-monitored-satellites', data: { ids: [satellite.id], deleteObservations },
        });
        expect(deleteButton).toBeDisabled();
        expect(deleteButton).toContainElement(screen.getByRole('progressbar'));
        expect(within(confirmation).getByRole('button', { name: 'Cancel' })).toBeDisabled();
        expect(store.getState().scheduler.monitoredSatelliteDialogOpen).toBe(true);
        await acknowledge(requests[0]);
        expect(store.getState().scheduler.monitoredSatellites).toHaveLength(0);
        expect(store.getState().scheduler.monitoredSatelliteDialogOpen).toBe(false);
    });

    it('keeps the edit dialog open when deletion fails', async () => {
        const store = renderDialog();
        fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
        const confirmation = screen.getByRole('dialog', { name: 'Confirm Deletion' });
        fireEvent.click(within(confirmation).getByRole('button', { name: 'Delete' }));
        await acknowledge(requests[0], { success: false });
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Failed to delete monitored satellites'));
        expect(store.getState().scheduler.monitoredSatellites).toHaveLength(1);
        expect(store.getState().scheduler.monitoredSatelliteDialogOpen).toBe(true);
        expect(screen.getByRole('button', { name: 'Delete' })).toBeEnabled();
    });
});
