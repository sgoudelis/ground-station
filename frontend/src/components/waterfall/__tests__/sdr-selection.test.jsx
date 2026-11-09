import React, { createRef } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, expect, it, vi } from 'vitest';
import '../../../i18n/config.js';
import { setupTheme } from '../../../theme.js';
import WaterfallSettings from '../settings-column.jsx';
import reducer, { applySDRConfigParameters, setCenterFrequency, setContinuousObservation, updateSDRConfig } from '../waterfall-slice.jsx';
import vfoReducer from '../vfo-marker/vfo-slice.jsx';
import decodersReducer from '../../decoders/decoders-slice.jsx';
import continuousReducer from '../../scheduler/continuous-observations-slice.js';
import schedulerReducer from '../../scheduler/scheduler-slice.jsx';

const { socket } = vi.hoisted(() => ({ socket: { id: 'browser', connected: true, emit: vi.fn() } }));

vi.mock('../../common/socket.jsx', () => ({ useSocket: () => ({ socket }) }));
vi.mock('../../common/common.jsx', () => ({
    TitleBar: ({ children }) => children,
    getClassNamesBasedOnGridEditing: () => '',
}));
vi.mock('../background-stream-control.jsx', () => ({ default: () => null }));
vi.mock('../settings-frequency.jsx', () => ({ default: ({ readOnly }) => <input aria-label="Frequency" disabled={readOnly} /> }));
vi.mock('../settings-fft.jsx', () => ({ default: () => null }));
vi.mock('../vfo-settings/settings-vfo.jsx', () => ({ default: () => <div>VFO controls</div> }));
vi.mock('../settings-recording.jsx', () => ({ default: () => null }));
vi.mock('../settings-playback.jsx', () => ({ default: () => null }));
vi.mock('../../../utils/toast-with-timestamp.jsx', () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const parameters = (antenna) => ({
    gain_values: [0, 20], sample_rate_values: [2000000],
    fft_size_values: [16384], fft_window_values: ['hanning'],
    antennas: { tx: [], rx: [antenna] }, capabilities: {},
});

beforeEach(() => {
    socket.emit.mockReset();
    socket.emit.mockImplementation((_event, request, callback) => {
        if (request.cmd === 'get-sdr-parameters') {
            callback({ success: true, data: parameters(`ANT-${request.data.slice(-1).toUpperCase()}`) });
        } else if (request.cmd === 'sdr.configure-sdr') {
            // Echo the requested antenna as the real backend configuration does.
            callback({ success: true, data: { config: {
                sdr_id: request.data.selectedSDRId, antenna: request.data.antenna,
            } } });
        } else if (request.cmd === 'continuous-observations.create') {
            callback({ success: true, data: { ...request.data, created_at: '2026-11-09T10:00:00Z', updated_at: '2026-11-09T10:00:00Z' } });
        } else {
            callback({ success: true, data: {} });
        }
    });
});

function receiver(state = {}) {
    const initial = reducer(undefined, { type: '@@INIT' });
    const capabilities = state.parameters || parameters('ANT-A');
    const devices = state.devices || ['a', 'b', 'c'].map((id) => ({ id: `sdr-${id}`, name: `SDR ${id}`, type: 'rtlsdr' }));
    const store = configureStore({
        reducer: {
            waterfall: reducer, vfo: vfoReducer, decoders: decodersReducer,
            continuousObservations: continuousReducer, scheduler: schedulerReducer,
            sdrs: () => ({ sdrs: devices }),
            preferences: () => ({ preferences: [] }),
            filebrowser: () => ({ playbackRecordings: [] }),
            targetSatTrack: () => ({}), trackerInstances: () => ({ instances: [] }),
        },
        preloadedState: {
            waterfall: { ...initial, selectedSDRId: 'sdr-a', isStreaming: true, ...state.waterfall },
            vfo: { ...vfoReducer(undefined, { type: '@@INIT' }), ...state.vfo },
            scheduler: { ...schedulerReducer(undefined, { type: '@@INIT' }), sdrParameters: { 'sdr-a': capabilities } },
        },
    });
    store.dispatch(applySDRConfigParameters({ selectedSDRId: 'sdr-a', data: capabilities }));
    store.dispatch(updateSDRConfig({ sdr_id: 'sdr-a', gain: 20, sample_rate: 2000000, antenna: 'ANT-A', ...state.config }));
    const ref = createRef();
    render(<Provider store={store}><ThemeProvider theme={setupTheme()}>
        <WaterfallSettings ref={ref} />
    </ThemeProvider></Provider>);
    return { store, ref };
}

const loraSession = () => ({
    waterfall: { centerFrequency: 869750000 },
    vfo: { vfoActive: { 1: true, 2: false, 3: false, 4: false }, vfoMarkers: {
        ...vfoReducer(undefined, { type: '@@INIT' }).vfoMarkers,
        1: { frequency: 869525000, bandwidth: 500000, mode: 'FM', decoder: 'lora',
            parameters: { lora_sf: 11, lora_bw: 250000, lora_cr: 1, lora_sync_word: [43], lora_preamble_len: 16 } },
    } },
});

it('opens a prefilled continuous observation from the live session and cancels without changing the stream', async () => {
    const { store } = receiver(loraSession());
    const live = store.getState().waterfall;
    const vfos = store.getState().vfo;
    fireEvent.click(screen.getByRole('button', { name: 'Create continuous observation' }));
    const dialog = within(screen.getByRole('dialog', { name: 'Create continuous observation' }));
    // Labels identify these fields directly without checking every select's visibility.
    const field = (name) => dialog.getByLabelText(name, { selector: '[role="combobox"]' });
    expect(dialog.getByLabelText(/Observation name/)).toHaveValue('SDR a · 869.750 MHz');
    expect(field(/^SDR/)).toHaveTextContent('SDR a');
    expect(field(/^Gain/)).toHaveTextContent('20 dB');
    expect(field(/^Sample Rate/)).toHaveTextContent('2 MHz');
    expect(field(/Antenna Port/)).toHaveTextContent('ANT-A');
    expect(dialog.getByRole('switch', { name: 'Auto center from VFOs' })).not.toBeChecked();
    expect(dialog.getByLabelText('869750000 Hz')).toBeVisible();
    expect(field('Decoder')).toHaveTextContent('LoRa');
    expect(field('Modulation')).toHaveTextContent('None');
    fireEvent.click(dialog.getByRole('button', { name: 'Decoder parameters' }));
    expect(field('LoRa profile')).toHaveTextContent('Meshtastic — Long Fast');
    expect(field('Spreading Factor')).toHaveTextContent('SF11');
    expect(field('Bandwidth')).toHaveTextContent('250 kHz');

    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(store.getState().waterfall).toBe(live);
    expect(store.getState().vfo).toBe(vfos);
    expect(socket.emit).not.toHaveBeenCalled();
});

it('uses the latest live frequency when reopening a cancelled continuous observation draft', async () => {
    const { store } = receiver(loraSession());
    fireEvent.click(screen.getByRole('button', { name: 'Create continuous observation' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    act(() => store.dispatch(setCenterFrequency(869500000)));
    fireEvent.click(screen.getByRole('button', { name: 'Create continuous observation' }));
    expect(within(screen.getByRole('dialog')).getByLabelText('869500000 Hz')).toBeVisible();
});

it('saves the reviewed definition while leaving the live receiver and VFOs running', async () => {
    const { store } = receiver(loraSession());
    const live = store.getState().waterfall;
    const vfos = store.getState().vfo;
    fireEvent.click(screen.getByRole('button', { name: 'Create continuous observation' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Observation name/ }), { target: { value: '  Meshtastic monitor  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save definition' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(store.getState().continuousObservations.definitions).toHaveLength(1);
    expect(store.getState().continuousObservations.definitions[0]).toMatchObject({
        name: 'Meshtastic monitor', sdr: { id: 'sdr-a', center_frequency: 869750000,
            auto_center_frequency: false, gain: 20, antenna_port: 'ANT-A', sample_rate: 2000000 },
        vfos: [{ frequency: 869525000, bandwidth: 500000, decoder: 'lora', modulation: 'none',
            decoder_parameters: { lora_bw: 250000, lora_sf: 11, lora_sync_word: [43] } }],
    });
    expect(store.getState().waterfall).toBe(live);
    expect(store.getState().vfo).toBe(vfos);
    expect(socket.emit.mock.calls.map(([, request]) => request.cmd)).toEqual(['continuous-observations.create']);
});

it('prefills and saves the live overall gain and stage selections even when cached options or echoes omit them', async () => {
    const session = loraSession();
    const { store } = receiver({
        ...session,
        devices: [{ id: 'sdr-a', name: 'RSPduo', type: 'soapysdrremote', driver: 'sdrplay' }],
        parameters: { ...parameters('ANT-A'), capabilities: {
            gain_elements: { rx: ['RFGR', 'IFGR'] },
            gain_ranges: { rx: { RFGR: { min: 0, max: 9, step: 0 }, IFGR: { min: 20, max: 59, step: 1 } } },
        } },
        config: { gain: 25.4 },
        waterfall: { ...session.waterfall, sdrSettingsById: { 'sdr-a': {
            draft: { gains: { RFGR: 0, IFGR: 35 } }, applied: { gains: {} },
        } } },
    });
    expect(screen.getByRole('combobox', { name: 'Gain (dB)' })).toHaveTextContent('25.4 dB');
    expect(screen.getByRole('combobox', { name: 'LNA attenuation state (RFGR)' })).toHaveTextContent('0');
    expect(screen.getByRole('combobox', { name: 'IF gain reduction (IFGR)' })).toHaveTextContent('35 dB');
    const live = store.getState().waterfall;

    fireEvent.click(screen.getByRole('button', { name: 'Create continuous observation' }));
    const dialog = within(screen.getByRole('dialog'));
    expect(dialog.getByRole('combobox', { name: /^Gain/ })).toHaveTextContent('25.4 dB');
    expect(dialog.getByRole('combobox', { name: 'LNA attenuation state (RFGR)' })).toHaveTextContent('0');
    expect(dialog.getByRole('combobox', { name: 'IF gain reduction (IFGR)' })).toHaveTextContent('35 dB');
    fireEvent.click(dialog.getByRole('button', { name: 'Save definition' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(store.getState().continuousObservations.definitions[0].sdr).toMatchObject({
        gain: 25.4, sdr_settings: { gains: { RFGR: 0, IFGR: 35 } },
    });
    expect(store.getState().waterfall).toBe(live);
    expect(socket.emit.mock.calls.map(([, request]) => request.cmd)).toEqual(['continuous-observations.create']);
});

it('keeps the draft open after a failed save and allows retrying', async () => {
    const { store } = receiver(loraSession());
    fireEvent.click(screen.getByRole('button', { name: 'Create continuous observation' }));
    const emit = socket.emit.getMockImplementation();
    socket.emit.mockImplementationOnce((_event, _request, reply) => reply({ success: false, error: 'Cannot save now' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save definition' }));
    await waitFor(() => expect(screen.getByText('Cannot save now')).toBeVisible());
    expect(store.getState().continuousObservations.definitions).toEqual([]);
    expect(store.getState().waterfall.isStreaming).toBe(true);
    socket.emit.mockImplementation(emit);
    fireEvent.click(screen.getByRole('button', { name: 'Save definition' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(store.getState().continuousObservations.definitions).toHaveLength(1);
});

it.each([
    { isStreaming: false },
    { selectedSDRId: 'sigmf-playback' },
    { continuousObservation: { id: 'already-continuous', vfos: {} } },
])('disables copying unavailable or continuous sessions: %j', (waterfall) => {
    receiver({ waterfall });
    expect(screen.getByRole('button', { name: 'Create continuous observation' })).toBeDisabled();
});

it('locks frequency controls and hides VFO settings while viewing a continuous observation', () => {
    const { store } = receiver();
    expect(screen.getByLabelText('Frequency')).toBeEnabled();
    expect(screen.getByText('VFO controls')).toBeInTheDocument();

    act(() => store.dispatch(setContinuousObservation({
        name: 'Meshtastic', session_id: 'continuous-owner',
        vfos: { 1: { center_freq: 869525000, bandwidth: 250000, modulation: 'none', decoder: 'lora' } },
    })));
    expect(screen.getByLabelText('Frequency')).toBeDisabled();
    expect(screen.queryByText('VFO controls')).not.toBeInTheDocument();
    expect(screen.queryByText(/Viewing a continuous observation/)).not.toBeInTheDocument();
    expect(screen.queryByText(/VFO 1/)).not.toBeInTheDocument();

    act(() => store.dispatch(setContinuousObservation(null)));
    expect(screen.getByLabelText('Frequency')).toBeEnabled();
    expect(screen.getByText('VFO controls')).toBeInTheDocument();
});

it('sends an unset antenna when switching devices and offers only the new SDR ports', async () => {
    const { store, ref } = receiver();
    expect(screen.getByRole('combobox', { name: 'Antenna' })).toHaveTextContent('ANT-A');

    await act(async () => { await ref.current.handleSDRChange('sdr-b'); });

    const configuration = socket.emit.mock.calls.find(([, request]) => request.cmd === 'sdr.configure-sdr')[1];
    expect(configuration.data).toMatchObject({ selectedSDRId: 'sdr-b', antenna: 'none' });
    expect(store.getState().waterfall.selectedAntenna).toBe('none');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Antenna' }));
    expect(screen.getByRole('option', { name: 'ANT-B' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'ANT-A' })).not.toBeInTheDocument();
});

it('preserves a supported antenna when reloading parameters for the selected SDR', async () => {
    const { store } = receiver();
    await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Reload SDR parameters (uses cached capabilities when available)' }));
    });

    const configuration = socket.emit.mock.calls.find(([, request]) => request.cmd === 'sdr.configure-sdr')[1];
    expect(configuration.data).toMatchObject({ selectedSDRId: 'sdr-a', antenna: 'ANT-A' });
    expect(store.getState().waterfall.selectedAntenna).toBe('ANT-A');
});

it.each([true, false])('does not configure or restore an older selection when its probe completes late (success: %s)', async (success) => {
    const emit = socket.emit.getMockImplementation();
    let acknowledge;
    socket.emit.mockImplementation((event, request, callback) => {
        if (request.cmd === 'get-sdr-parameters' && request.data === 'sdr-b') acknowledge = callback;
        else emit(event, request, callback);
    });
    const { store, ref } = receiver();
    let previousSelection;
    await act(async () => { previousSelection = ref.current.handleSDRChange('sdr-b'); });
    await act(async () => { await ref.current.handleSDRChange('sdr-c'); });
    await act(async () => {
        acknowledge({ success, data: parameters('ANT-B'), error: 'Old SDR unavailable' });
        await previousSelection;
    });

    expect(store.getState().waterfall.selectedSDRId).toBe('sdr-c');
    expect(store.getState().waterfall.antennasList.rx).toEqual(['ANT-C']);
    expect(store.getState().waterfall.errorMessage).toBeNull();
    const configuredIds = socket.emit.mock.calls
        .filter(([, request]) => request.cmd === 'sdr.configure-sdr')
        .map(([, request]) => request.data.selectedSDRId);
    expect(configuredIds).toEqual(['sdr-c']);
});
