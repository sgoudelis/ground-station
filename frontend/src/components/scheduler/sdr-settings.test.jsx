import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n/config.js';
import schedulerReducer from './scheduler-slice.jsx';
import ObservationFormDialog from './observation-form-dialog.jsx';
import MonitoredSatelliteDialog from './monitored-satellite-dialog.jsx';

const socket = vi.hoisted(() => ({ emit: vi.fn() }));
vi.mock('../common/socket.jsx', () => ({ useSocket: () => ({ socket }) }));

const devices = [
    { id: 'radio', name: 'RSPduo', type: 'soapysdrremote', driver: 'sdrplay', antenna_labels: { rx: { RX: 'VHF antenna' } } },
    { id: 'other', name: 'RTL receiver', type: 'rtlsdrusbv4' },
    { id: 'sigmf-playback', name: 'SigMF Playback', type: 'sigmfplayback' },
];
const parameters = {
    gain_values: [0, 30], sample_rate_values: [1024000, 1536000, 2048000, 4000000],
    antennas: { rx: ['RX'] }, has_bias_t: true, has_tuner_agc: true,
    has_soapy_agc: true, has_rtl_agc: true,
    capabilities: {
        gain_elements: { rx: ['RFGR', 'IFGR'] },
        gain_ranges: { rx: { RFGR: { min: 0, max: 9, step: 0 }, IFGR: { min: 20, max: 59, step: 1 } } },
        bandwidths: { rx: [200000, 1536000, 5000000] },
        clock_sources: ['internal', 'external', 'none'], time_sources: ['internal', 'external', 'none'],
        settings: [{ key: 'bitpack', value: false }],
    },
};
const initialSettings = {
    gains: { RFGR: 2, IFGR: 25 }, bandwidth: 'driver', clockSource: 'internal', timeSource: 'internal', bitpack: false,
};
const initialSdr = {
    id: 'radio', name: 'RSPduo', sample_rate: 4000000, gain: 30, antenna_port: 'RX',
    center_frequency: 145000000, auto_center_frequency: false, sdr_settings: initialSettings,
};

function renderDialog(kind, { status = 'scheduled', sessions = [{ sdr: initialSdr, tasks: [] }] } = {}) {
    const writes = [];
    const item = {
        id: 'item-1', name: 'Test pass', enabled: true, status,
        satellite: { norad_id: 25544, name: 'ISS' },
        pass: { id: 'pass-1', event_start: '2026-11-06T12:00:00Z', event_end: '2026-11-06T12:10:00Z' },
        sessions, rotator: { id: null }, rig: { id: null },
        min_elevation: 20, task_start_elevation: 10, lookahead_hours: 24,
    };
    socket.emit.mockImplementation((_event, request, acknowledge) => {
        if (!request || typeof acknowledge !== 'function') return;
        if (['update-scheduled-observation', 'update-monitored-satellite'].includes(request.cmd)) {
            writes.push(request.data);
            return;
        }
        if (request.cmd === 'get-sdr-parameters') {
            acknowledge({ success: true, data: request.data === 'radio' ? parameters : {
                gain_values: [0, 30], sample_rate_values: [1024000], antennas: { rx: ['RX'] },
            } });
            return;
        }
        const responses = {
            'get-libretranslate-capabilities': { configured: false, languages: [] },
            'get-satellites': [item.satellite], 'fetch-next-passes': [item.pass],
        };
        acknowledge({ success: true, data: responses[request.cmd] ?? [] });
    });
    const hardware = { sdrs: devices, rotators: [], rigs: [], instances: [] };
    const store = configureStore({
        reducer: {
            scheduler: schedulerReducer, sdrs: () => hardware,
            rotators: () => hardware, rigs: () => hardware, trackerInstances: () => hardware,
        },
        preloadedState: { scheduler: {
            ...schedulerReducer(undefined, { type: '@@INIT' }),
            dialogOpen: kind === 'observation', monitoredSatelliteDialogOpen: kind === 'monitored',
            selectedObservation: kind === 'observation' ? item : null,
            selectedMonitoredSatellite: kind === 'monitored' ? item : null,
        } },
    });
    render(<Provider store={store}>
        {kind === 'observation' ? <ObservationFormDialog /> : <MonitoredSatelliteDialog />}
    </Provider>);
    return { writes, store, save: screen.getByRole('button', { name: kind === 'observation' ? 'Update' : 'Save and Generate' }) };
}

function select(label, option) {
    const field = screen.getByText(label, { selector: 'label' }).parentElement;
    fireEvent.mouseDown(within(field).getByRole('combobox'));
    fireEvent.click(screen.getByRole('option', { name: option }));
}

describe.each(['observation', 'monitored'])('%s SDR settings', (kind) => {
    beforeEach(() => socket.emit.mockReset());

    it('saves advanced controls and precise rates without changing their numeric values', async () => {
        const { save, writes } = renderDialog(kind);
        await screen.findByRole('combobox', { name: 'LNA attenuation state (RFGR)' });
        fireEvent.mouseDown(screen.getByRole('combobox', { name: /Sample Rate/ }));
        expect(screen.getByRole('option', { name: '1.024 MHz' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: '1.536 MHz' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('option', { name: '2.048 MHz' }));
        select('LNA attenuation state (RFGR)', '4');
        select('IF gain reduction (IFGR)', '35 dB');
        select('IF filter bandwidth', '1.536 MHz');
        select('Clock Source', 'external');
        select('Time Source', 'external');
        for (const label of ['Enable Bias T', 'Bit Packing', 'Enable tuner AGC', 'Enable AGC', 'Enable RTL AGC']) {
            fireEvent.click(screen.getByRole('switch', { name: label }));
        }
        expect(screen.getByRole('combobox', { name: /Antenna Port/ })).toHaveTextContent('VHF antenna (RX)');
        await waitFor(() => expect(save).toBeEnabled());
        fireEvent.click(save);
        expect(writes).toHaveLength(1);
        expect(writes[0].sessions[0].sdr).toMatchObject({
            sample_rate: 2048000, bias_t: true, tuner_agc: true, soapy_agc: true, rtl_agc: true,
            sdr_settings: {
                gains: { RFGR: 4, IFGR: 35 }, bandwidth: 1536000,
                clockSource: 'external', timeSource: 'external', bitpack: true,
            },
        });
    }, 30000);

    it('refreshes capabilities, excludes playback, and resets device-specific settings when changing radio', async () => {
        const { save, writes, store } = renderDialog(kind);
        await screen.findByRole('combobox', { name: 'LNA attenuation state (RFGR)' });
        const before = socket.emit.mock.calls.filter(([, request]) => request?.cmd === 'get-sdr-parameters').length;
        fireEvent.click(screen.getByRole('button', { name: /Reload SDR parameters/ }));
        await waitFor(() => expect(socket.emit.mock.calls.filter(([, request]) => request?.cmd === 'get-sdr-parameters')).toHaveLength(before + 1));
        const field = screen.getByText('SDR', { selector: 'label' }).parentElement;
        fireEvent.mouseDown(within(field).getByRole('combobox'));
        expect(screen.queryByRole('option', { name: /SigMF/ })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('option', { name: /RTL receiver/ }));
        await waitFor(() => expect(store.getState().scheduler.sdrParametersLoading).toBe(false));
        expect(screen.queryByRole('combobox', { name: 'LNA attenuation state (RFGR)' })).not.toBeInTheDocument();
        select('Gain', '0 dB');
        select('Antenna Port', 'RX');
        await waitFor(() => expect(save).toBeEnabled());
        fireEvent.click(save);
        expect(writes[0].sessions[0].sdr).toMatchObject({
            id: 'other', sample_rate: 1024000, bias_t: false, tuner_agc: false,
            soapy_agc: false, rtl_agc: false, sdr_settings: {},
        });
    }, 30000);

    it('keeps advanced settings separate when switching SDR sessions', async () => {
        const { save, writes } = renderDialog(kind, { sessions: [
            { sdr: initialSdr, tasks: [] },
            { sdr: { ...initialSdr, id: 'other', name: 'RTL receiver', sample_rate: 1024000, sdr_settings: {} }, tasks: [] },
        ] });
        await screen.findByRole('combobox', { name: 'LNA attenuation state (RFGR)' });
        select('IF gain reduction (IFGR)', '40 dB');
        fireEvent.click(screen.getByRole('tab', { name: 'RTL receiver' }));
        await waitFor(() => expect(screen.queryByRole('combobox', { name: 'IF gain reduction (IFGR)' })).not.toBeInTheDocument());
        fireEvent.click(screen.getByRole('tab', { name: 'RSPduo' }));
        expect(await screen.findByRole('combobox', { name: 'IF gain reduction (IFGR)' })).toHaveTextContent('40 dB');
        await waitFor(() => expect(save).toBeEnabled());
        fireEvent.click(save);
        expect(writes[0].sessions.map((session) => session.sdr.sdr_settings)).toEqual([
            { ...initialSettings, gains: { RFGR: 2, IFGR: 40 } }, {},
        ]);
    }, 20000);
});

it('disables the shared advanced controls for running observations', async () => {
    renderDialog('observation', { status: 'running' });
    const field = await screen.findByRole('combobox', { name: 'IF gain reduction (IFGR)' });
    expect(field).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('combobox', { name: 'IF filter bandwidth' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('switch', { name: 'Bit Packing' })).toBeDisabled();
}, 10000);
