import React from 'react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '../../i18n/config.js';
import schedulerReducer from './scheduler-slice.jsx';
import MonitoredSatelliteDialog from './monitored-satellite-dialog.jsx';

const socket = vi.hoisted(() => ({ emit: vi.fn() }));
vi.mock('../common/socket.jsx', () => ({ useSocket: () => ({ socket }) }));

describe('monitored satellite transmitters', () => {
    it('loads the saved IQ transmitter even when the satellite is outside the name search result limit', async () => {
        const transmitters = [{
            id: 'Qc2PqaS7n9WYtne3U9EmKJ', description: 'LRPT IQ recording usage',
            downlink_low: 137900000, alive: true, source: 'satnogs',
        }, {
            id: 'FBDizt5ERyKtZFgv7zjHLB', description: 'LRPT IQ recording usage',
            downlink_low: 137100000, alive: true, source: 'satnogs',
        }];
        const satellite = { norad_id: 57166, name: 'METEOR-M2 3' };
        const monitored = {
            id: 'monitored-meteor', enabled: true, satellite,
            sessions: [{
                sdr: {
                    id: 'sdr-1', name: 'Airspy', sample_rate: 3000000,
                    gain: 13, antenna_port: 'RX', center_frequency: 137900000,
                    auto_center_frequency: false,
                },
                tasks: [{ type: 'iq_recording', config: { transmitter_id: transmitters[0].id } }],
            }],
            min_elevation: 40, task_start_elevation: 0, lookahead_hours: 24,
        };
        socket.emit.mockReset();
        socket.emit.mockImplementation((_event, request, acknowledge) => {
            const responses = {
                'get-sdr-parameters': { gain_values: [13], antennas: { rx: ['RX'] } },
                'get-libretranslate-capabilities': { configured: false, languages: [] },
                'get-satellites': [satellite],
                'get-transmitters': transmitters,
                // Broad searches can fill the autocomplete limit before reaching Meteor.
                'get-satellite-search': Array.from({ length: 20 }, (_, index) => ({
                    norad_id: index + 10000, name: `Other weather satellite ${index}`, transmitters: [],
                })),
            };
            acknowledge({ success: true, data: responses[request.cmd] ?? [] });
        });
        const initialState = schedulerReducer(undefined, { type: '@@INIT' });
        const sdrState = { sdrs: [{ id: 'sdr-1', name: 'Airspy' }] };
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
                    ...initialState, monitoredSatelliteDialogOpen: true,
                    selectedMonitoredSatellite: monitored,
                },
            },
        });
        render(<Provider store={store}><MonitoredSatelliteDialog /></Provider>);
        fireEvent.click(screen.getByRole('button', { name: /IQ Recording/, expanded: false }));

        const control = screen.getByText('Transmitter', { selector: 'label' }).parentElement;
        const dropdown = within(control).getByRole('combobox');
        await waitFor(() => expect(dropdown).not.toHaveAttribute('aria-disabled', 'true'));
        expect(dropdown).toHaveTextContent('LRPT IQ recording usage - 137.900 MHz');
        fireEvent.mouseDown(dropdown);
        expect(screen.getByRole('option', { name: /137.100 MHz/ })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: /137.900 MHz/ })).toHaveAttribute('aria-selected', 'true');
    });
});
