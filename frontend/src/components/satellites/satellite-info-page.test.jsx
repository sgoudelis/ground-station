/**
 * @license
 * Copyright (c) 2026 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTheme } from '../../theme.js';
import '../../i18n/config.js';
import { SatelliteInfoDialog } from './satellite-info-page.jsx';

const { testSocket, testSetAsTarget } = vi.hoisted(() => ({
    testSocket: { emit: vi.fn() },
    testSetAsTarget: vi.fn(),
}));

vi.mock('../common/socket.jsx', () => ({ useSocket: () => ({ socket: testSocket }) }));
vi.mock('../target/use-satellite-target-action.jsx', () => ({
    useSatelliteTargetAction: () => ({
        setAsTarget: testSetAsTarget,
        isCurrentlyTargeted: false,
        dialog: null,
    }),
}));
vi.mock('../../hooks/liveorbit.js', () => ({
    useSatelliteLiveOrbit: (satelliteData) => ({
        available: Boolean((satelliteData?.tle1 && satelliteData?.tle2) || satelliteData?.orbit_payload),
        source: satelliteData?.orbit_payload ? 'omm' : (satelliteData?.tle1 && satelliteData?.tle2 ? 'tle' : null),
        position: satelliteData?.position || null,
        generatedAt: '2026-01-02T00:00:00.000Z',
        error: '',
    }),
}));
vi.mock('./satellite-map.jsx', () => ({ default: () => <div data-testid="satellite-map" /> }));
vi.mock('./satellite-edit-dialog.jsx', () => ({
    default: ({ open, onClose, onSaved }) => open && (
        <div role="dialog" aria-label="Satellite editor">
            <button type="button" onClick={() => { onSaved(); onClose(); }}>Save satellite</button>
        </div>
    ),
}));
vi.mock('./transmitters-dialog.jsx', () => ({
    default: ({ open, onClose }) => open && (
        <div role="dialog" aria-label="Transmitter manager">
            <button type="button" onClick={onClose}>Close transmitter manager</button>
        </div>
    ),
}));

const renderDialog = (satelliteData, onUpdated = undefined, open = true, livePosition = null) => {
    const store = configureStore({
        reducer: {
            preferences: () => ({ preferences: [] }),
            targetSatTrack: () => ({ nextPassesHours: 24 }),
        },
    });
    render(
        <ThemeProvider theme={setupTheme()}>
            <Provider store={store}>
                <MemoryRouter>
                    <SatelliteInfoDialog
                        open={open}
                        onClose={vi.fn()}
                        satelliteData={satelliteData}
                        livePosition={livePosition}
                        onUpdated={onUpdated}
                    />
                </MemoryRouter>
            </Provider>
        </ThemeProvider>
    );
};

describe('SatelliteInfoDialog overview', () => {
    beforeEach(() => {
        testSocket.emit.mockReset();
        testSetAsTarget.mockReset();
    });

    it('mounts safely before a satellite is selected', () => {
        renderDialog(null, undefined, false);
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('shows the tracking-style map beside mission details without expanded page sections', () => {
        renderDialog({
            norad_id: 12345,
            name: 'TestSat',
            status: 'alive',
            name_other: 'Earlier name',
            source: 'celestrak',
            sat_id: 'satnogs-12345',
            associated_satellites: 'CompanionSat',
            website: 'https://example.com/satellite',
            image: 'https://example.com/satellite.png',
            deployed: '2026-01-01T00:00:00Z',
            orbit_model_kind: 'tle',
            orbit_central_body: 'earth',
            is_geostationary: false,
            is_frequency_violator: true,
            orbit_source_object_id: 'orbit-record-12345',
            orbit_epoch: '2026-01-02T00:00:00Z',
            orbit_fetched_at: '2026-01-03T00:00:00Z',
            position: { lat: 0, lon: -20.1234, alt: 500000, vel: 7.5, az: 0, el: -5 },
            tle1: 'TLE line one',
            tle2: 'TLE line two',
            transmitters: [
                { uplink_low: 145800000, downlink_low: 435000000 },
                { downlink_low: 436000000 },
            ],
        });

        const heading = screen.getByRole('heading', { name: 'TestSat' });
        expect(heading.closest('.MuiDialogTitle-root')).toBeInTheDocument();
        expect(screen.getAllByRole('heading', { name: 'TestSat' })).toHaveLength(1);
        expect(screen.getByRole('img', { name: 'TestSat' }).closest('.MuiDialogTitle-root')).toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: 'TestSat' })).toBeInTheDocument();
        expect(heading.closest('.MuiDialogTitle-root')).toHaveTextContent('NORAD 12345 · Also known as Earlier name');
        expect(screen.getByTestId('satellite-map')).toBeInTheDocument();
        expect(screen.getByText('Coverage map')).toBeInTheDocument();
        expect(screen.getByText('Mission and orbit')).toBeInTheDocument();
        const mapColumn = screen.getByTestId('satellite-coverage-map-region').closest('.MuiGrid-root');
        const missionColumn = screen.getByText('Mission and orbit').closest('.MuiGrid-root');
        expect(mapColumn?.parentElement).toBe(missionColumn?.parentElement);
        expect(screen.queryByRole('heading', { name: 'Transmitters' })).not.toBeInTheDocument();
        expect(screen.queryByText('2 transmitters')).not.toBeInTheDocument();
        expect(screen.getByText('CompanionSat')).toBeInTheDocument();
        expect(screen.getByText('Central body')).toBeInTheDocument();
        expect(screen.getByText('Geostationary')).toBeInTheDocument();
        expect(screen.getByText('Frequency violator')).toBeInTheDocument();
        expect(screen.queryByText('Image reference')).not.toBeInTheDocument();
        expect(screen.getByText('orbit-record-12345')).toBeInTheDocument();
        expect(screen.getByText('0.0000° N')).toBeInTheDocument();
        expect(screen.getByText('20.1234° W')).toBeInTheDocument();
        expect(screen.getByText('500.0 km')).toBeInTheDocument();
        expect(screen.getByText('7.50 km/s')).toBeInTheDocument();
        expect(screen.getByText('0.0°')).toBeInTheDocument();
        expect(screen.getByText('Below horizon')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'https://example.com/satellite' })).toBeInTheDocument();
        expect(screen.queryByText(/TLE line one/)).not.toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Orbital elements' })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'OMM data' })).not.toBeInTheDocument();
        expect(screen.queryByTestId('transmitters-table')).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'SET AS TARGET' }));
        expect(testSetAsTarget).toHaveBeenCalledOnce();
        expect(screen.getByRole('button', { name: 'Edit Satellite' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Manage transmitters' })).toBeInTheDocument();
    });

    it('shows an OMM-backed map without the raw OMM data section', () => {
        renderDialog({
            norad_id: 123456,
            name: 'OMM Satellite',
            orbit_model_kind: 'omm',
            orbit_payload: { MEAN_MOTION: 15.2 },
            transmitters: [],
        });

        expect(screen.getByTestId('satellite-map')).toBeInTheDocument();
        expect(screen.queryByText(/No usable Earth orbit/)).not.toBeInTheDocument();
        expect(screen.queryByText('0 transmitters')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'OMM data' })).not.toBeInTheDocument();
        expect(screen.queryByText(/MEAN_MOTION/)).not.toBeInTheDocument();
    });

    it('uses live Earth View angles when they are available', () => {
        renderDialog(
            { norad_id: 12345, name: 'TestSat', position: { az: 45, el: -5 } },
            undefined,
            true,
            { az: 90, el: 12.5 },
        );

        expect(screen.getByText('90.0°')).toBeInTheDocument();
        expect(screen.getByText('12.5°')).toBeInTheDocument();
        expect(screen.getByText('Above horizon')).toBeInTheDocument();
        expect(screen.queryByText('Below horizon')).not.toBeInTheDocument();
    });

    it('loads future passes locally for the dialog satellite and can force a refresh', async () => {
        testSocket.emit.mockImplementation((_event, request, callback) => {
            if (request.cmd !== 'fetch-next-passes') return;
            callback({
                success: true,
                data: [{
                    id: 1,
                    norad_id: 12345,
                    event_start: '2026-10-08T10:00:00Z',
                    event_end: '2026-10-08T10:10:00Z',
                    peak_altitude: 42.5,
                    start_azimuth: 125.2,
                    end_azimuth: 278.8,
                    distance_at_peak: 512.4,
                    is_geostationary: false,
                    is_geosynchronous: false,
                }],
            });
        });

        renderDialog({norad_id: 12345, name: 'TestSat', transmitters: []});

        expect(await screen.findByRole('table', {name: 'Future satellite passes'})).toBeInTheDocument();
        expect(screen.getByText('Future passes · next 24 hours')).toBeInTheDocument();
        expect(screen.getByRole('cell', { name: 'Oct 8, 2026, 10:00:00 AM' })).toBeInTheDocument();
        expect(screen.getByText('42.50°')).toBeInTheDocument();
        expect(screen.queryByRole('columnheader', { name: 'Current Elevation' })).not.toBeInTheDocument();
        expect(screen.queryByRole('columnheader', { name: 'Current Azimuth' })).not.toBeInTheDocument();
        expect(screen.queryByRole('columnheader', { name: 'Progress' })).not.toBeInTheDocument();
        expect(screen.getByText('512.40 km')).toBeInTheDocument();
        expect(testSocket.emit).toHaveBeenCalledWith('api.call', {
            cmd: 'fetch-next-passes',
            data: {
                norad_id: 12345,
                hours: 24,
                force_recalculate: false,
            },
        }, expect.any(Function));

        fireEvent.click(screen.getByRole('button', {name: 'Refresh passes'}));
        await waitFor(() => expect(testSocket.emit).toHaveBeenCalledWith('api.call', {
            cmd: 'fetch-next-passes',
            data: {
                norad_id: 12345,
                hours: 24,
                force_recalculate: true,
            },
        }, expect.any(Function)));
    });

    it('opens each shared editor and refreshes the information after changes', async () => {
        const satellite = {
            norad_id: 12345,
            name: 'Before edit',
            transmitters: [{ downlink_low: 435000000 }],
        };
        testSocket.emit.mockImplementation((_event, request, callback) => {
            if (request.cmd === 'fetch-next-passes') {
                callback({success: true, data: []});
                return;
            }
            expect(request.cmd).toBe('get-satellite');
            callback({
                success: true,
                data: {
                    details: { ...satellite, name: 'After edit' },
                    transmitters: [{ downlink_low: 145800000 }, { downlink_low: 145900000 }],
                },
            });
        });
        const onUpdated = vi.fn();
        renderDialog(satellite, onUpdated);

        fireEvent.click(screen.getByRole('button', { name: 'Edit Satellite' }));
        expect(screen.getByRole('dialog', { name: 'Before edit', hidden: true })).toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: 'Satellite editor', hidden: true })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Save satellite', hidden: true }));
        await waitFor(() => expect(screen.getByRole('heading', { name: 'After edit' })).toBeInTheDocument());

        fireEvent.click(screen.getByRole('button', { name: 'Manage transmitters' }));
        expect(screen.getByRole('dialog', { name: 'After edit', hidden: true })).toBeInTheDocument();
        expect(screen.getByRole('dialog', { name: 'Transmitter manager', hidden: true })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Close transmitter manager', hidden: true }));
        await waitFor(() => expect(testSocket.emit).toHaveBeenCalledTimes(3));
        expect(onUpdated).toHaveBeenCalledTimes(2);
        expect(screen.queryByRole('heading', { name: 'Transmitters' })).not.toBeInTheDocument();
    });
});
