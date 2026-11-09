import React, { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, expect, it, vi } from 'vitest';
import '../../../i18n/config.js';
import { setupTheme } from '../../../theme.js';
import WaterfallSettings from '../settings-column.jsx';
import reducer, { applySDRConfigParameters, setContinuousObservation, updateSDRConfig } from '../waterfall-slice.jsx';
import vfoReducer from '../vfo-marker/vfo-slice.jsx';
import decodersReducer from '../../decoders/decoders-slice.jsx';

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
        } else {
            callback({ success: true, data: {} });
        }
    });
});

function receiver() {
    const initial = reducer(undefined, { type: '@@INIT' });
    const store = configureStore({
        reducer: {
            waterfall: reducer, vfo: vfoReducer, decoders: decodersReducer,
            sdrs: () => ({ sdrs: ['a', 'b', 'c'].map((id) => ({ id: `sdr-${id}`, name: `SDR ${id}`, type: 'rtlsdr' })) }),
            preferences: () => ({ preferences: [] }),
            filebrowser: () => ({ playbackRecordings: [] }),
            targetSatTrack: () => ({}), trackerInstances: () => ({ instances: [] }),
        },
        preloadedState: { waterfall: { ...initial, selectedSDRId: 'sdr-a', isStreaming: true } },
    });
    store.dispatch(applySDRConfigParameters({ selectedSDRId: 'sdr-a', data: parameters('ANT-A') }));
    store.dispatch(updateSDRConfig({ sdr_id: 'sdr-a', gain: 20, sample_rate: 2000000, antenna: 'ANT-A' }));
    const ref = createRef();
    render(<Provider store={store}><ThemeProvider theme={setupTheme()}>
        <WaterfallSettings ref={ref} />
    </ThemeProvider></Provider>);
    return { store, ref };
}

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
