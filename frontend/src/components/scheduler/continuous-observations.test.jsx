import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { Provider } from 'react-redux';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/config.js';
import ContinuousObservations from './continuous-observations.jsx';
import continuousReducer, { continuousObservationsInitialState } from './continuous-observations-slice.js';
import schedulerReducer from './scheduler-slice.jsx';
import { createContinuousObservation, createContinuousVfo } from './continuous-observation-utils.js';

const joinSdr = vi.hoisted(() => vi.fn());
vi.mock('../waterfall/sdr-join.js', () => ({ joinSdr }));
const socket = vi.hoisted(() => ({ connected: true, emit: vi.fn() }));
vi.mock('../common/socket.jsx', () => ({ useSocket: () => ({ socket }) }));

const device = { id: 'radio', name: 'VHF receiver', type: 'rtlsdr', frequency_min: 24, frequency_max: 1766 };
const parameters = { gain_values: [0, 20], sample_rate_values: [1000000, 2000000], antennas: { rx: ['RX'] } };
function savedDefinition() {
    const draft = createContinuousObservation();
    return { ...draft, name: 'VHF monitoring', created_at: '2026-11-08T10:00:00Z', updated_at: '2026-11-08T10:00:00Z',
        sdr: { ...draft.sdr, id: device.id, name: device.name, gain: 0, antenna_port: 'RX', auto_center_frequency: false } };
}
function renderPage(definitions = [], { cachedParameters = true, drafts = [], loaded = true, apiOverride } = {}) {
    let records = structuredClone(definitions);
    const searchHandler = socket.emit.getMockImplementation();
    socket.emit.mockImplementation((event, payload, callback) => {
        if (!payload.cmd.startsWith('continuous-observations.')) return searchHandler?.(event, payload, callback);
        const overridden = apiOverride?.(payload.cmd, payload.data);
        if (overridden) return callback(overridden);
        const { cmd, data } = payload;
        let result;
        if (cmd.endsWith('.list')) result = structuredClone(records);
        else if (cmd.endsWith('.start') || cmd.endsWith('.stop')) {
            const runtime = { status: cmd.endsWith('.start') ? 'running' : 'stopped', started_at: '2026-11-08T11:00:00Z' };
            records = records.map((row) => row.id === data.id ? { ...row, runtime } : row);
            result = { id: data.id, runtime };
        } else if (cmd.endsWith('.delete')) {
            records = records.filter((row) => row.id !== data.id);
            result = { id: data.id };
        } else {
            const { expected_updated_at: _expected, ...definition } = data;
            const existing = records.find((row) => row.id === data.id);
            result = { ...structuredClone(definition), created_at: existing?.created_at || '2026-11-08T10:00:00Z',
                updated_at: '2026-11-08T11:00:00Z' };
            records = [...records.filter((row) => row.id !== data.id), result];
        }
        callback({ success: true, data: result });
    });
    const store = configureStore({
        reducer: { continuousObservations: continuousReducer, scheduler: schedulerReducer, sdrs: () => ({ sdrs: [device] }) },
        preloadedState: {
            continuousObservations: { ...continuousObservationsInitialState, definitions, drafts, loaded },
            scheduler: { ...schedulerReducer(undefined, { type: '@@INIT' }), sdrParameters: cachedParameters ? { radio: parameters } : {} },
        },
    });
    render(<Provider store={store}><MemoryRouter><ContinuousObservations /></MemoryRouter></Provider>);
    return store;
}
function select(name, option) {
    fireEvent.mouseDown(screen.getByRole('combobox', { name }));
    fireEvent.click(screen.getByRole('option', { name: option }));
}
function centerDisplay() {
    return screen.getByRole('group', { name: 'Center frequency' });
}
function expectCenterFrequency(frequencyMHz) {
    expect(within(centerDisplay()).getByRole('group', { name: `${Math.round(frequencyMHz * 1e6)} Hz` })).toBeVisible();
}
function toggleRow(name) {
    const row = screen.getByRole('button', { name, exact: true }).closest('[role="row"]');
    fireEvent.click(within(row).getByRole('checkbox'));
}

describe('continuous observation frontend', () => {
    beforeEach(() => { socket.connected = true; socket.emit.mockReset(); });

    it('saves a backend definition without sending runtime commands and offers Start without starting the receiver', async () => {
        const store = renderPage();
        fireEvent.click(screen.getByRole('button', { name: 'ADD', exact: true }));
        expect(screen.getByRole('switch', { name: 'Auto center from VFOs' })).toBeChecked();
        fireEvent.change(screen.getByRole('textbox', { name: /Observation name/ }), { target: { value: '  Backend APRS  ' } });
        select(/^SDR/, /VHF receiver/);
        select(/^Gain/, '0 dB');
        select(/^Antenna Port/, 'RX');
        select('Decoder', 'APRS');
        fireEvent.click(screen.getByRole('button', { name: /^Save (definition|changes)$/ }));

        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(store.getState().continuousObservations.definitions[0]).toMatchObject({
            name: 'Backend APRS', auto_start: true,
            sdr: { id: 'radio', gain: 0, center_frequency: 146300000, auto_center_frequency: true },
            vfos: [{ decoder: 'aprs', modulation: 'none', frequency: 145800000, decoder_parameters: { aprs_baudrate: 1200 } }],
        });
        expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Join' })).toBeDisabled();
        expect(screen.getByText('Not started')).toBeVisible();
        expect(socket.emit.mock.calls.every(([, payload]) => payload.cmd.startsWith('continuous-observations.'))).toBe(true);
    }, 15000);

    it('starts and stops a saved run and locks configuration while running', async () => {
        const saved = savedDefinition();
        renderPage([saved]);
        fireEvent.click(screen.getByRole('button', { name: 'Start', exact: true }));
        await waitFor(() => expect(screen.getByText('Running')).toBeVisible());
        expect(screen.getByRole('button', { name: 'Join', exact: true })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Edit VHF monitoring' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Delete VHF monitoring' })).toBeDisabled();
        toggleRow('VHF monitoring');
        expect(screen.getByRole('button', { name: 'Disable', exact: true })).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: 'Stop', exact: true }));
        await waitFor(() => expect(screen.getByText('Stopped')).toBeVisible());
        expect(screen.getByRole('button', { name: 'Edit VHF monitoring' })).toBeEnabled();
        const calls = socket.emit.mock.calls.map(([, request]) => request);
        expect(calls.find((request) => request.cmd.endsWith('.start')).data).toEqual({ id: saved.id, expected_updated_at: saved.updated_at });
        expect(calls.find((request) => request.cmd.endsWith('.stop')).data).toEqual({ id: saved.id });
    }, 15000);

    it('offers Stop again when failed cleanup still owns receiver resources', async () => {
        renderPage([{ ...savedDefinition(), runtime: { status: 'failed', active: true, error: 'Temporary cleanup failure' } }]);
        expect(screen.getByText('Failed')).toBeVisible();
        expect(screen.queryByRole('button', { name: 'Start', exact: true })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Edit VHF monitoring' })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Stop', exact: true }));
        await waitFor(() => expect(screen.getByText('Stopped')).toBeVisible());
    });

    it('joins only the expected continuous run as a viewer', async () => {
        const saved = { ...savedDefinition(), runtime: { status: 'running' } };
        joinSdr.mockResolvedValueOnce({ success: true });
        renderPage([saved]);
        fireEvent.click(screen.getByRole('button', { name: 'Join', exact: true }));
        await waitFor(() => expect(joinSdr).toHaveBeenCalledWith(socket, expect.any(Function), 'radio', 'watch-sdr', { continuousObservationId: saved.id }));
    });

    it('clears the opposite selector and decoder parameters, and persists the final exclusive choice', async () => {
        const store = renderPage([savedDefinition()]);
        fireEvent.click(screen.getByRole('button', { name: 'Edit VHF monitoring' }));
        const modulation = screen.getByRole('combobox', { name: 'Modulation' });
        const decoder = screen.getByRole('combobox', { name: 'Decoder' });
        expect(modulation).toHaveTextContent('FM');
        expect(decoder).toHaveTextContent('None');
        select('Decoder', 'APRS');
        expect(modulation).toHaveTextContent(/^None$/);
        expect(decoder).toHaveTextContent('APRS');
        expect(screen.getByRole('button', { name: 'Decoder parameters' })).toBeVisible();
        select('Modulation', 'AM');
        expect(modulation).toHaveTextContent('AM');
        expect(decoder).toHaveTextContent(/^None$/);
        expect(screen.queryByRole('button', { name: 'Decoder parameters' })).not.toBeInTheDocument();
        select('Decoder', 'APRS');
        expect(modulation).toHaveTextContent(/^None$/);
        select('Decoder', 'None');
        expect(modulation).toHaveTextContent(/^None$/);
        select('Modulation', 'USB');
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(store.getState().continuousObservations.definitions[0].vfos[0]).toMatchObject({
            modulation: 'usb', decoder: 'none', decoder_parameters: {},
        });
    }, 15000);

    it('shows legacy decoder definitions exclusively in the read-only view', () => {
        const original = savedDefinition();
        original.vfos[0] = { ...original.vfos[0], modulation: 'fm', decoder: 'aprs', decoder_parameters: { aprs_baudrate: 1200 } };
        renderPage([original]);
        fireEvent.click(screen.getByRole('button', { name: 'View configuration VHF monitoring' }));
        expect(screen.getByRole('combobox', { name: 'Modulation' })).toHaveTextContent(/^None$/);
        expect(screen.getByRole('combobox', { name: 'Decoder' })).toHaveTextContent('APRS');
        expect(original.vfos[0].modulation).toBe('fm');
    });

    it('loads the waterfall LoRa profiles into a new definition and saves their typed parameters', async () => {
        const store = renderPage();
        fireEvent.click(screen.getByRole('button', { name: 'ADD', exact: true }));
        fireEvent.change(screen.getByRole('textbox', { name: /Observation name/ }), { target: { value: 'LoRa monitoring' } });
        select(/^SDR/, /VHF receiver/);
        select(/^Gain/, '0 dB');
        select(/^Antenna Port/, 'RX');
        select('Decoder', 'LoRa');
        fireEvent.click(screen.getByRole('button', { name: 'Decoder parameters' }));
        expect(screen.getByRole('combobox', { name: 'LoRa profile' })).toHaveTextContent('Generic LoRa (defaults)');
        expect(screen.getByText(/before saving the observation/)).toBeVisible();

        select('LoRa profile', 'Meshtastic — Long Fast');
        expect(screen.getByRole('combobox', { name: 'Spreading Factor' })).toHaveTextContent('SF11');
        expect(screen.getByRole('combobox', { name: 'Bandwidth', exact: true })).toHaveTextContent('250 kHz');
        expect(screen.getByRole('spinbutton', { name: 'Preamble Length' })).toHaveValue(16);
        expect(store.getState().continuousObservations.definitions).toHaveLength(0);

        fireEvent.click(screen.getByRole('button', { name: 'Save definition' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(store.getState().continuousObservations.definitions[0].vfos[0]).toMatchObject({
            decoder: 'lora', modulation: 'none', frequency: 145800000, bandwidth: 500000,
            decoder_parameters: {
                lora_sf: 11, lora_bw: 250000, lora_cr: 1, lora_sync_word: [0x2B],
                lora_preamble_len: 16, lora_ldro_mode: 2, lora_invert_iq: false,
                lora_implicit_header: false, lora_payload_length: 255, lora_has_crc: true,
            },
        });
        expect(socket.emit.mock.calls.some(([, request]) => request.cmd.endsWith('.start'))).toBe(false);
    }, 15000);

    it('applies a LoRa profile only to the selected VFO and clears incompatible overrides', async () => {
        const original = savedDefinition();
        original.vfos[0] = { ...original.vfos[0], modulation: 'none', decoder: 'lora', bandwidth: 500000,
            decoder_parameters: { lora_implicit_header: true, lora_payload_length: 42, lora_has_crc: false, lora_invert_iq: true } };
        original.vfos.push({ ...createContinuousVfo(145900000), modulation: 'none', decoder: 'lora', bandwidth: 500000,
            decoder_parameters: { lora_sf: 9 } });
        const store = renderPage([original]);
        fireEvent.click(screen.getByRole('button', { name: 'Edit VHF monitoring' }));
        const first = within(screen.getByRole('region', { name: 'VFO 1' }));
        const second = within(screen.getByRole('region', { name: 'VFO 2' }));
        fireEvent.click(first.getByRole('button', { name: 'Decoder parameters' }));
        fireEvent.click(second.getByRole('button', { name: 'Decoder parameters' }));
        const firstProfile = first.getByRole('combobox', { name: 'LoRa profile' });
        const secondProfile = second.getByRole('combobox', { name: 'LoRa profile' });
        expect(firstProfile.getAttribute('aria-labelledby')).not.toBe(secondProfile.getAttribute('aria-labelledby'));
        fireEvent.mouseDown(firstProfile);
        fireEvent.click(screen.getByRole('option', { name: 'MeshCore — EU/UK Narrow' }));
        expect(first.getByRole('spinbutton', { name: 'Preamble Length' })).toHaveValue(32);
        expect(first.getByRole('checkbox', { name: /^Implicit Header/ })).not.toBeChecked();
        expect(first.getByRole('checkbox', { name: /^Invert IQ/ })).not.toBeChecked();
        expect(second.getByRole('combobox', { name: 'Spreading Factor' })).toHaveTextContent('SF9');

        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        const saved = store.getState().continuousObservations.definitions[0];
        expect(saved.vfos[0]).toMatchObject({
            frequency: original.vfos[0].frequency, bandwidth: original.vfos[0].bandwidth,
            decoder_parameters: { lora_sf: 8, lora_bw: 62500, lora_cr: 4, lora_sync_word: [0x12],
                lora_preamble_len: 32, lora_implicit_header: false, lora_payload_length: 255, lora_has_crc: true, lora_invert_iq: false },
        });
        expect(saved.vfos[1]).toEqual(original.vfos[1]);
        expect(saved.sdr).toEqual(original.sdr);
    }, 15000);

    it('allows custom edits after choosing a LoRa profile and discards them on Cancel', () => {
        const original = savedDefinition();
        const store = renderPage([original]);
        fireEvent.click(screen.getByRole('button', { name: 'Edit VHF monitoring' }));
        select('Decoder', 'LoRa');
        fireEvent.click(screen.getByRole('button', { name: 'Decoder parameters' }));
        select('LoRa profile', 'Reticulum / RNode (example)');
        expect(screen.getByRole('spinbutton', { name: 'Preamble Length' })).toHaveValue(18);
        fireEvent.change(screen.getByRole('spinbutton', { name: 'Preamble Length' }), { target: { value: '24' } });
        expect(screen.getByRole('combobox', { name: 'LoRa profile' })).toHaveTextContent('Custom');
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(store.getState().continuousObservations.definitions[0]).toEqual(original);
        expect(socket.emit.mock.calls.some(([, request]) => request.cmd.endsWith('.update'))).toBe(false);
    }, 15000);

    it('disables the LoRa profile selector when inspecting a saved configuration', () => {
        const original = savedDefinition();
        original.vfos[0] = { ...original.vfos[0], modulation: 'none', decoder: 'lora', decoder_parameters: {} };
        renderPage([original]);
        fireEvent.click(screen.getByRole('button', { name: 'View configuration VHF monitoring' }));
        fireEvent.click(screen.getByRole('button', { name: 'Decoder parameters' }));
        expect(screen.getByRole('combobox', { name: 'LoRa profile' })).toHaveAttribute('aria-disabled', 'true');
    });

    // Allow CI coverage runs time to render and update the MUI dialogs in these workflows.
    it('blocks saving a VFO whose channel extends outside reception, then allows a corrected draft', async () => {
        const store = renderPage([savedDefinition()]);
        fireEvent.click(screen.getByRole('button', { name: 'Edit VHF monitoring' }));
        fireEvent.change(screen.getByRole('spinbutton', { name: /Frequency \(MHz\)/ }), { target: { value: '146.8' } });
        expect(screen.getByText(/This VFO extends outside/)).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: /^Save (definition|changes)$/ }));
        expect(screen.getByRole('dialog')).toBeVisible();
        expect(store.getState().continuousObservations.definitions[0].vfos[0].frequency).toBe(145800000);

        fireEvent.change(screen.getByRole('spinbutton', { name: /Frequency \(MHz\)/ }), { target: { value: '146.7' } });
        fireEvent.click(screen.getByRole('button', { name: /^Save (definition|changes)$/ }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(store.getState().continuousObservations.definitions[0].vfos[0].frequency).toBe(146700000);
    }, 15000);

    it('keeps configuration inspection read-only even before SDR capabilities have loaded', () => {
        const original = savedDefinition();
        original.sdr.auto_center_frequency = true;
        renderPage([original], { cachedParameters: false });
        fireEvent.click(screen.getByRole('button', { name: 'View configuration VHF monitoring' }));
        const dialog = within(screen.getByRole('dialog'));
        expect(dialog.getByRole('textbox', { name: /Observation name/ })).toBeDisabled();
        expect(dialog.getByRole('combobox', { name: /^Gain/ })).toHaveTextContent('0 dB');
        expect(dialog.getByRole('combobox', { name: /^Antenna Port/ })).toHaveTextContent('RX');
        expect(dialog.getByRole('spinbutton', { name: /Frequency \(MHz\)/ })).toBeDisabled();
        expect(dialog.getByRole('switch', { name: 'Auto center from VFOs' })).toBeDisabled();
        expect(dialog.getByRole('switch', { name: 'Auto center from VFOs' })).toBeChecked();
        expectCenterFrequency(145.8);
        within(centerDisplay()).getAllByRole('button', { hidden: true }).forEach((button) => expect(button).toBeDisabled());
        expect(dialog.queryByRole('button', { name: /^Save (definition|changes)$/ })).not.toBeInTheDocument();
        expect(dialog.queryByRole('combobox', { name: 'Find transmitter (optional)' })).not.toBeInTheDocument();
        expect(socket.emit.mock.calls.every(([, payload]) => payload.cmd.startsWith('continuous-observations.'))).toBe(true);
    });

    it('recalculates from VFO and receiver edits, freezes when disabled, and persists the resolved mode and center', async () => {
        const store = renderPage([savedDefinition()]);
        fireEvent.click(screen.getByRole('button', { name: 'Edit VHF monitoring' }));
        const toggle = screen.getByRole('switch', { name: 'Auto center from VFOs' });
        const center = centerDisplay();
        fireEvent.click(toggle);
        expect(within(center).queryByRole('button')).not.toBeInTheDocument();
        expectCenterFrequency(146.3);
        fireEvent.change(screen.getByRole('spinbutton', { name: /Frequency \(MHz\)/ }), { target: { value: '145.9' } });
        expectCenterFrequency(146.4);
        fireEvent.change(screen.getByRole('spinbutton', { name: /Frequency \(MHz\)/ }), { target: { value: '' } });
        expectCenterFrequency(146.4);
        expect(screen.getByText('Enter a valid VFO frequency and bandwidth to calculate the center.')).toBeVisible();
        fireEvent.change(screen.getByRole('spinbutton', { name: /Frequency \(MHz\)/ }), { target: { value: '145.9' } });
        fireEvent.change(screen.getByRole('spinbutton', { name: /Bandwidth \(kHz\)/ }), { target: { value: '2000' } });
        expectCenterFrequency(145.9);
        fireEvent.change(screen.getByRole('spinbutton', { name: /Bandwidth \(kHz\)/ }), { target: { value: '12.5' } });
        fireEvent.click(screen.getByRole('button', { name: 'Add VFO' }));
        expectCenterFrequency(146.65);
        fireEvent.click(screen.getByRole('button', { name: 'Remove VFO 2' }));
        expectCenterFrequency(146.4);
        select(/^Sample Rate/, '1 MHz');
        expectCenterFrequency(146.15);
        fireEvent.click(toggle);
        expectCenterFrequency(146.15);
        fireEvent.click(within(center).getByRole('button', { name: 'Increase by 100000 Hz' }));
        fireEvent.change(screen.getByRole('spinbutton', { name: /Frequency \(MHz\)/ }), { target: { value: '145.95' } });
        expectCenterFrequency(146.25);
        fireEvent.click(toggle);
        expectCenterFrequency(146.2);
        fireEvent.click(screen.getByRole('button', { name: /^Save (definition|changes)$/ }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(store.getState().continuousObservations.definitions[0]).toMatchObject({
            sdr: { center_frequency: 146200000, auto_center_frequency: true, sample_rate: 1000000 },
            vfos: [{ frequency: 145950000, bandwidth: 12500 }],
        });
        fireEvent.click(screen.getByRole('button', { name: 'Edit VHF monitoring' }));
        expect(screen.getByRole('switch', { name: 'Auto center from VFOs' })).toBeChecked();
        expectCenterFrequency(146.2);
        expect(socket.emit.mock.calls.every(([, payload]) => payload.cmd.startsWith('continuous-observations.'))).toBe(true);
    }, 20000);

    it('tunes with the waterfall dial and preserves individual Hz when saving and reopening', async () => {
        const store = renderPage([savedDefinition()]);
        fireEvent.click(screen.getByRole('button', { name: 'Edit VHF monitoring' }));
        const center = within(centerDisplay());
        fireEvent.click(center.getByRole('button', { name: 'Increase by 1 Hz' }));
        expectCenterFrequency(145.800001);
        fireEvent.click(center.getByRole('button', { name: 'Decrease by 10 Hz' }));
        expectCenterFrequency(145.799991);
        fireEvent.click(screen.getByRole('button', { name: /^Save (definition|changes)$/ }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(store.getState().continuousObservations.definitions[0].sdr.center_frequency).toBe(145799991);
        fireEvent.click(screen.getByRole('button', { name: 'Edit VHF monitoring' }));
        expectCenterFrequency(145.799991);
        expect(socket.emit.mock.calls.every(([, payload]) => payload.cmd.startsWith('continuous-observations.'))).toBe(true);
    }, 15000);

    it('reports the required bandwidth and refuses to save VFOs that cannot fit', async () => {
        const original = savedDefinition();
        original.vfos.push(createContinuousVfo(148000000));
        const store = renderPage([original]);
        fireEvent.click(screen.getByRole('button', { name: 'Edit VHF monitoring' }));
        fireEvent.click(screen.getByRole('switch', { name: 'Auto center from VFOs' }));
        expect(screen.getByText(/These VFOs need 2.212500 MHz.*2.000000 MHz/)).toBeVisible();
        fireEvent.click(screen.getByRole('button', { name: /^Save (definition|changes)$/ }));
        expect(screen.getByRole('dialog')).toBeVisible();
        expect(store.getState().continuousObservations.definitions[0]).toEqual(original);
        const second = within(screen.getByRole('region', { name: 'VFO 2' }));
        fireEvent.change(second.getByRole('spinbutton', { name: /Frequency \(MHz\)/ }), { target: { value: '146' } });
        expect(screen.queryByText(/These VFOs need/)).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /^Save (definition|changes)$/ }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        const saved = store.getState().continuousObservations.definitions[0];
        expect(saved.sdr.sample_rate).toBe(2000000);
        expect(saved.vfos[0]).toEqual(original.vfos[0]);
        expect(saved.vfos[1]).toEqual({ ...original.vfos[1], frequency: 146000000 });
    }, 15000);

    it('auto-centers after using the transmitter helper without retaining an association or changing VFO settings', async () => {
        const original = savedDefinition();
        socket.emit.mockImplementation((_event, _payload, acknowledge) => acknowledge({
            success: true, total: 1, has_more: false,
            data: [{ id: 'tx', owner_name: 'Satellite', description: 'Telemetry', downlink_low: 437800000 }],
        }));
        const store = renderPage([original]);
        fireEvent.click(screen.getByRole('button', { name: 'Edit VHF monitoring' }));
        fireEvent.click(screen.getByRole('switch', { name: 'Auto center from VFOs' }));
        fireEvent.change(screen.getByRole('combobox', { name: 'Find transmitter (optional)' }), { target: { value: 'Telemetry' } });
        fireEvent.click(await screen.findByRole('option', { name: /Satellite · Telemetry/ }));
        expectCenterFrequency(438.3);
        fireEvent.click(screen.getByRole('button', { name: /^Save (definition|changes)$/ }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        const saved = store.getState().continuousObservations.definitions[0];
        expect(saved.vfos[0]).toEqual({ ...original.vfos[0], frequency: 437800000 });
        expect(saved.sdr).toEqual({ ...original.sdr, center_frequency: 438300000, auto_center_frequency: true });
    }, 15000);

    it('copies known analog modulation to the chosen VFO, clears decoding, and allows manual overrides', async () => {
        const original = savedDefinition();
        original.vfos.push({ ...createContinuousVfo(145900000), modulation: 'am', bandwidth: 25000,
            decoder: 'aprs', decoder_parameters: { aprs_baudrate: 1240 } });
        socket.emit.mockImplementation((_event, _payload, acknowledge) => acknowledge({
            success: true, total: 1, has_more: false,
            data: [{ id: 'satellite-link', owner_name: 'Example satellite', description: 'Telemetry',
                downlink_low: 437800000, mode: 'FM', baud: 1200 }],
        }));
        const store = renderPage([original]);
        fireEvent.click(screen.getByRole('button', { name: 'Edit VHF monitoring' }));
        const vfo = within(screen.getByRole('region', { name: 'VFO 2' }));
        fireEvent.change(vfo.getByRole('combobox', { name: 'Find transmitter (optional)' }), { target: { value: 'Telemetry' } });
        fireEvent.click(await screen.findByRole('option', { name: /Example satellite · Telemetry/ }));
        expect(vfo.getByRole('spinbutton', { name: /Frequency \(MHz\)/ })).toHaveValue(437.8);
        expect(vfo.getByText(/This VFO extends outside/)).toBeVisible();
        expectCenterFrequency(145.8);
        fireEvent.click(screen.getByRole('button', { name: /^Save (definition|changes)$/ }));
        expect(screen.getByRole('dialog')).toBeVisible();
        fireEvent.change(vfo.getByRole('spinbutton', { name: /Frequency \(MHz\)/ }), { target: { value: '145.925' } });
        fireEvent.click(screen.getByRole('button', { name: /^Save (definition|changes)$/ }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        const saved = store.getState().continuousObservations.definitions[0];
        expect(saved.sdr).toEqual(original.sdr);
        expect(saved.vfos[0]).toEqual(original.vfos[0]);
        expect(saved.vfos[1]).toEqual({ ...original.vfos[1], frequency: 145925000, modulation: 'fm', decoder: 'none', decoder_parameters: {} });
        expect(socket.emit.mock.calls.filter(([, payload]) => payload.cmd === 'get-transmitter-search')).toHaveLength(1);
        expect(socket.emit.mock.calls.some(([, payload]) => payload.cmd === 'continuous-observations.update')).toBe(true);
    }, 15000);

    it('prefills a supported decoder and custom catalog values, then permits manual parameter edits', async () => {
        const original = savedDefinition();
        socket.emit.mockImplementation((_event, _payload, acknowledge) => acknowledge({
            success: true, total: 1, has_more: false,
            data: [{ id: 'tx-profile', owner_name: 'Satellite', description: 'FSK telemetry',
                downlink_low: 437800000, mode: 'FSK', baud: 1234, framing: 'geoscan', deviation: 563.5 }],
        }));
        const store = renderPage([original]);
        fireEvent.click(screen.getByRole('button', { name: 'Edit VHF monitoring' }));
        fireEvent.click(screen.getByRole('switch', { name: 'Auto center from VFOs' }));
        fireEvent.change(screen.getByRole('combobox', { name: 'Find transmitter (optional)' }), { target: { value: 'Telemetry' } });
        fireEvent.click(await screen.findByRole('option', { name: /Satellite · FSK telemetry/ }));
        expect(screen.getByRole('combobox', { name: 'Decoder' })).toHaveTextContent('FSK');
        expect(screen.getByRole('combobox', { name: 'Modulation' })).toHaveTextContent(/^None$/);
        expect(screen.getByRole('spinbutton', { name: /Bandwidth \(kHz\)/ })).toHaveValue(3.702);
        expectCenterFrequency(438.3);
        fireEvent.click(screen.getByRole('button', { name: 'Decoder parameters' }));
        expect(screen.getByRole('combobox', { name: 'Baud Rate' })).toHaveTextContent('1234');
        expect(screen.getByRole('combobox', { name: 'Frequency Deviation' })).toHaveTextContent('563.5');
        expect(screen.getByRole('combobox', { name: 'Framing Protocol' })).toHaveTextContent('GEOSCAN');
        select('Baud Rate', '1200 baud');
        fireEvent.click(screen.getByRole('button', { name: /^Save (definition|changes)$/ }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        const saved = store.getState().continuousObservations.definitions[0];
        expect(saved.vfos[0]).toMatchObject({ id: original.vfos[0].id, frequency: 437800000,
            bandwidth: 3702, decoder: 'fsk', decoder_parameters: {
                fsk_baudrate: 1200, fsk_deviation: 563.5, fsk_framing: 'geoscan',
            } });
        expect(saved.vfos[0]).not.toHaveProperty('transmitter_id');
        expect(saved.vfos[0]).not.toHaveProperty('lockedTransmitterId');
        expect(socket.emit.mock.calls.filter(([, payload]) => payload.cmd === 'get-transmitter-search')).toHaveLength(1);
    }, 15000);

    it('discards cancelled edits and gives duplicate definitions independent identities', async () => {
        const original = savedDefinition();
        const store = renderPage([original]);
        fireEvent.click(screen.getByRole('button', { name: 'Edit VHF monitoring' }));
        fireEvent.change(screen.getByRole('textbox', { name: /Observation name/ }), { target: { value: 'Unsaved name' } });
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(store.getState().continuousObservations.definitions[0].name).toBe('VHF monitoring');

        fireEvent.click(screen.getByRole('button', { name: 'Duplicate VHF monitoring' }));
        expect(screen.getByRole('switch', { name: 'Start automatically with backend' })).not.toBeChecked();
        fireEvent.click(screen.getByRole('button', { name: /^Save (definition|changes)$/ }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        const [first, copy] = store.getState().continuousObservations.definitions;
        expect(first).toEqual(original);
        expect(copy.name).toBe('VHF monitoring (copy)');
        expect(copy.id).not.toBe(first.id);
        expect(copy.vfos[0].id).not.toBe(first.vfos[0].id);
    }, 15000);

    it('requires confirmation to delete a definition', async () => {
        const store = renderPage([savedDefinition()]);
        fireEvent.click(screen.getByRole('button', { name: 'Delete VHF monitoring' }));
        expect(store.getState().continuousObservations.definitions).toHaveLength(1);
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
        await waitFor(() => expect(store.getState().continuousObservations.definitions).toHaveLength(0));
        expect(screen.getByText('Continuous reception starts here')).toBeVisible();
    });

    it('edits one checked row, disables editing multiple rows, and cancels batch deletion without writes', async () => {
        const first = savedDefinition();
        const second = { ...savedDefinition(), name: 'UHF monitoring' };
        const store = renderPage([first, second]);
        expect(screen.getByRole('button', { name: 'Edit', exact: true })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
        toggleRow(first.name);
        fireEvent.click(screen.getByRole('button', { name: 'Edit', exact: true }));
        expect(screen.getByRole('textbox', { name: /Observation name/ })).toHaveValue(first.name);
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

        toggleRow(second.name);
        expect(screen.getByRole('button', { name: 'Edit', exact: true })).toBeDisabled();
        fireEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }));
        const dialog = within(screen.getByRole('dialog', { name: /Confirm Deletion/ }));
        expect(dialog.getByText(first.name, { exact: true })).toBeVisible();
        expect(dialog.getByText(second.name, { exact: true })).toBeVisible();
        expect(dialog.getByText(/Delete these 2 saved continuous observation definitions/)).toBeVisible();
        fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(store.getState().continuousObservations.definitions).toEqual([first, second]);
        expect(socket.emit.mock.calls.some(([, payload]) => payload.cmd.endsWith('.delete'))).toBe(false);
    }, 15000);

    it('selects a clicked row and checks its checkbox while keeping configuration actions separate', async () => {
        renderPage([savedDefinition()]);
        const row = screen.getByRole('button', { name: 'VHF monitoring', exact: true }).closest('[role="row"]');
        const checkbox = within(row).getByRole('checkbox');
        expect(checkbox).not.toBeChecked();
        fireEvent.click(within(row).getByText('VHF receiver', { exact: true }));
        expect(checkbox).toBeChecked();
        expect(screen.getByRole('button', { name: 'Edit', exact: true })).toBeEnabled();
        fireEvent.click(screen.getByRole('button', { name: 'View configuration VHF monitoring' }));
        fireEvent.click(screen.getAllByRole('button', { name: 'Close', exact: true })[0]);
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(checkbox).toBeChecked();
    });

    it('saves startup preferences for selected definitions and skips rows already in the requested state', async () => {
        const first = savedDefinition();
        const second = { ...savedDefinition(), name: 'UHF monitoring', auto_start: false };
        const store = renderPage([first, second]);
        const enable = screen.getByRole('button', { name: 'Enable', exact: true });
        const disable = screen.getByRole('button', { name: 'Disable', exact: true });
        expect(enable).toBeDisabled();
        expect(disable).toBeDisabled();
        toggleRow(first.name);
        expect(enable).toBeDisabled();
        expect(disable).toBeEnabled();
        toggleRow(second.name);
        expect(enable).toBeEnabled();
        fireEvent.click(disable);
        await waitFor(() => expect(store.getState().continuousObservations.definitions.every((row) => !row.auto_start)).toBe(true));
        await waitFor(() => expect(enable).toBeEnabled());
        expect(disable).toBeDisabled();
        expect(screen.getAllByText('Disabled', { exact: true })).toHaveLength(2);
        let updates = socket.emit.mock.calls.filter(([, payload]) => payload.cmd.endsWith('.update'));
        expect(updates).toHaveLength(1);
        expect(updates[0][1].data).toMatchObject({
            id: first.id, auto_start: false, sdr: first.sdr, vfos: first.vfos, expected_updated_at: first.updated_at,
        });

        fireEvent.click(enable);
        await waitFor(() => expect(store.getState().continuousObservations.definitions.every((row) => row.auto_start)).toBe(true));
        await waitFor(() => expect(disable).toBeEnabled());
        expect(enable).toBeDisabled();
        expect(screen.getAllByText('Enabled', { exact: true })).toHaveLength(2);
        updates = socket.emit.mock.calls.filter(([, payload]) => payload.cmd.endsWith('.update'));
        expect(updates).toHaveLength(3);
        expect(updates.slice(1).map(([, payload]) => payload.data.id)).toEqual(expect.arrayContaining([first.id, second.id]));
        const enabledFirst = updates.slice(1).find(([, payload]) => payload.data.id === first.id)[1].data;
        const enabledSecond = updates.slice(1).find(([, payload]) => payload.data.id === second.id)[1].data;
        expect(enabledFirst.expected_updated_at).toBe('2026-11-08T11:00:00Z');
        expect(enabledSecond).toMatchObject({ auto_start: true, sdr: second.sdr, vfos: second.vfos });
        fireEvent.click(screen.getByRole('button', { name: 'Edit VHF monitoring' }));
        expect(screen.getByRole('switch', { name: 'Start automatically with backend' })).toBeChecked();
        expect(socket.emit.mock.calls.every(([, payload]) => payload.cmd.startsWith('continuous-observations.'))).toBe(true);
    }, 15000);

    it('keeps failed startup updates unchanged and retries only rows still needing a change', async () => {
        const first = savedDefinition();
        const second = { ...savedDefinition(), name: 'UHF monitoring' };
        let fail = true;
        const store = renderPage([first, second], { apiOverride: (cmd, data) =>
            cmd.endsWith('.update') && data.id === first.id && fail
                ? { success: false, error: 'Changed by another editor', code: 'conflict' } : undefined });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
        fireEvent.click(screen.getByRole('button', { name: 'Disable', exact: true }));
        expect(await screen.findByText('VHF monitoring: Changed by another editor')).toBeVisible();
        expect(store.getState().continuousObservations.definitions).toEqual([
            first, { ...second, auto_start: false, updated_at: '2026-11-08T11:00:00Z' },
        ]);
        const updates = () => socket.emit.mock.calls.filter(([, payload]) => payload.cmd.endsWith('.update'));
        expect(updates().map(([, payload]) => payload.data.id)).toEqual([first.id, second.id]);
        fail = false;
        fireEvent.click(screen.getByRole('button', { name: 'Disable', exact: true }));
        await waitFor(() => expect(store.getState().continuousObservations.definitions.every((row) => !row.auto_start)).toBe(true));
        expect(screen.queryByText('VHF monitoring: Changed by another editor')).not.toBeInTheDocument();
        expect(updates().map(([, payload]) => payload.data.id)).toEqual([first.id, second.id, first.id]);
    });

    it('selects all rows and deletes their reviewed versions after confirmation', async () => {
        const first = savedDefinition();
        const second = { ...savedDefinition(), name: 'UHF monitoring' };
        const store = renderPage([first, second]);
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }));
        const dialog = within(screen.getByRole('dialog'));
        expect(dialog.getByText(first.name, { exact: true })).toBeVisible();
        expect(dialog.getByText(second.name, { exact: true })).toBeVisible();
        fireEvent.click(dialog.getByRole('button', { name: 'Delete', exact: true }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(store.getState().continuousObservations.definitions).toEqual([]);
        expect(screen.getByRole('button', { name: 'Edit', exact: true })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled();
        const deletes = socket.emit.mock.calls.filter(([, payload]) => payload.cmd.endsWith('.delete'));
        expect(deletes.map(([, payload]) => payload.data)).toEqual([
            { id: first.id, expected_updated_at: first.updated_at },
            { id: second.id, expected_updated_at: second.updated_at },
        ]);
    });

    it('retains failed batch deletions for retry without resubmitting successful deletions', async () => {
        const first = savedDefinition();
        const second = { ...savedDefinition(), name: 'UHF monitoring' };
        let fail = true;
        const store = renderPage([first, second], { apiOverride: (cmd, data) =>
            cmd.endsWith('.delete') && data.id === second.id && fail
                ? { success: false, error: 'Receiver is busy', code: 'conflict' } : undefined });
        fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
        fireEvent.click(screen.getByRole('button', { name: 'Delete', exact: true }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete', exact: true }));
        expect(await screen.findByText('UHF monitoring: Receiver is busy')).toBeVisible();
        expect(store.getState().continuousObservations.definitions).toEqual([second]);
        const dialog = within(screen.getByRole('dialog'));
        expect(dialog.queryByText(first.name, { exact: true })).not.toBeInTheDocument();
        expect(dialog.getByText(second.name, { exact: true })).toBeVisible();
        fail = false;
        fireEvent.click(dialog.getByRole('button', { name: 'Delete', exact: true }));
        await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
        expect(store.getState().continuousObservations.definitions).toEqual([]);
        const deletedIds = socket.emit.mock.calls.filter(([, payload]) => payload.cmd.endsWith('.delete'))
            .map(([, payload]) => payload.data.id);
        expect(deletedIds).toEqual([first.id, second.id, second.id]);
    });
    it('keeps unsaved edits after a backend failure and prevents closing or submitting twice while saving', async () => {
        renderPage([savedDefinition()]);
        const api = socket.emit.getMockImplementation();
        let reply;
        socket.emit.mockImplementation((event, payload, callback) => {
            if (payload.cmd.endsWith('.update')) reply = callback;
            else api(event, payload, callback);
        });
        fireEvent.click(screen.getByRole('button', { name: 'Edit VHF monitoring' }));
        fireEvent.change(screen.getByRole('textbox', { name: /Observation name/ }), { target: { value: 'Keep my edits' } });
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
        expect(screen.getByRole('textbox', { name: /Observation name/ })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
        fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
        expect(screen.getByRole('dialog')).toBeVisible();
        reply({ success: false, error: 'Changed by another editor. Reopen before saving.', code: 'conflict' });
        expect(await screen.findByText('Changed by another editor. Reopen before saving.')).toBeVisible();
        expect(screen.getByRole('textbox', { name: /Observation name/ })).toHaveValue('Keep my edits');
        expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
        expect(socket.emit.mock.calls.filter(([, payload]) => payload.cmd.endsWith('.update'))).toHaveLength(1);
    }, 15000);

    it('keeps the delete dialog and saved row when deletion fails', async () => {
        const store = renderPage([savedDefinition()], { apiOverride: (cmd) => cmd.endsWith('.delete')
            ? { success: false, error: 'The definition changed. Refresh first.', code: 'conflict' } : undefined });
        fireEvent.click(screen.getByRole('button', { name: 'Delete VHF monitoring' }));
        fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete' }));
        expect(await screen.findByText('The definition changed. Refresh first.')).toBeVisible();
        expect(screen.getByRole('dialog')).toBeVisible();
        expect(store.getState().continuousObservations.definitions).toHaveLength(1);
    });

    it('imports browser drafts individually and preserves failures for another attempt', async () => {
        const first = savedDefinition();
        const second = { ...savedDefinition(), name: 'Missing receiver' };
        const store = renderPage([], { drafts: [first, second], apiOverride: (cmd, data) =>
            cmd.endsWith('.create') && data.id === second.id ? { success: false, error: 'Receiver missing' } : undefined });
        fireEvent.click(screen.getByRole('button', { name: 'Import browser drafts' }));
        expect(await screen.findByText('Missing receiver: Receiver missing')).toBeVisible();
        expect(store.getState().continuousObservations.definitions).toHaveLength(1);
        expect(store.getState().continuousObservations.drafts).toEqual([second]);
        const creates = socket.emit.mock.calls.filter(([, payload]) => payload.cmd.endsWith('.create'));
        expect(creates).toHaveLength(2);
        expect(creates[0][1].data).not.toHaveProperty('expected_updated_at');
    });

    it('shows a load failure with retry instead of an empty collection', async () => {
        let failed = true;
        renderPage([savedDefinition()], { loaded: false, apiOverride: (cmd) => cmd.endsWith('.list') && failed
            ? { success: false, error: 'Backend unavailable' } : undefined });
        expect(await screen.findByText('Backend unavailable')).toBeVisible();
        expect(screen.queryByText('Continuous reception starts here')).not.toBeInTheDocument();
        failed = false;
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
        expect(await screen.findByRole('button', { name: 'VHF monitoring', exact: true })).toBeVisible();
    });

});
