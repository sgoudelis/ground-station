import { configureStore } from '@reduxjs/toolkit';
import { describe, expect, it, vi } from 'vitest';

import reducer, {
    addMonitoredSatellite,
    addObservation,
    deleteObservations,
    createMonitoredSatellite,
    fetchSatelliteWithTransmitters,
    fetchSDRParameters,
    observationStatusUpdated,
    setMonitoredSatelliteDialogOpen,
    toggleMonitoredSatelliteEnabled,
    toggleObservationEnabledLocal,
    toggleStatusFilter,
    updateMonitoredSatellite,
} from './scheduler-slice.jsx';

describe('scheduler slice', () => {
    it('loads the current satellite name and an empty transmitter list by NORAD ID', async () => {
        const satellite = { norad_id: 57166, name: 'Updated catalog name' };
        const socket = { emit: vi.fn((_event, request, acknowledge) => {
            acknowledge({ success: true, data: request.cmd === 'get-satellites' ? [satellite] : [] });
        }) };
        const store = configureStore({ reducer });

        const result = await store.dispatch(fetchSatelliteWithTransmitters({ socket, noradId: '57166' })).unwrap();

        expect(result).toEqual({ ...satellite, transmitters: [] });
        expect(socket.emit.mock.calls.map(([, request]) => request)).toEqual([
            { cmd: 'get-satellites', data: '57166' },
            { cmd: 'get-transmitters', data: { norad_cat_id: '57166' } },
        ]);
    });

    it.each(['get-satellites', 'get-transmitters'])('rejects a failed %s lookup', async (failedCommand) => {
        const socket = { emit: (_event, request, acknowledge) => {
            acknowledge(request.cmd === failedCommand
                ? { success: false, error: 'Lookup unavailable' }
                : { success: true, data: [{ norad_id: 57166 }] });
        } };
        const store = configureStore({ reducer });

        await expect(store.dispatch(fetchSatelliteWithTransmitters({ socket, noradId: 57166 })).unwrap())
            .rejects.toBe('Lookup unavailable');
    });

    it('rejects a missing saved satellite instead of selecting another satellite', async () => {
        const socket = { emit: (_event, _request, acknowledge) => {
            acknowledge({ success: true, data: [{ norad_id: 59051 }] });
        } };
        const store = configureStore({ reducer });

        await expect(store.dispatch(fetchSatelliteWithTransmitters({ socket, noradId: 57166 })).unwrap())
            .rejects.toBe('Satellite not found');
    });

    it('maintains observation state for socket and local updates', () => {
        let state = reducer(undefined, { type: '@@INIT' });
        state = reducer(state, addObservation({ id: 'obs-1', enabled: true, status: 'scheduled' }));
        state = reducer(state, toggleObservationEnabledLocal({ id: 'obs-1', enabled: false }));
        state = reducer(state, observationStatusUpdated({ id: 'obs-1', status: 'running' }));
        state = reducer(state, deleteObservations(['obs-1']));

        expect(state.observations).toEqual([]);
    });

    it('creates, updates, toggles, and clears monitored-satellite dialog errors', () => {
        let state = reducer(undefined, { type: '@@INIT' });
        state = reducer(state, createMonitoredSatellite.rejected('previous save failure', 'request'));
        state = reducer(state, setMonitoredSatelliteDialogOpen(true));
        state = reducer(state, addMonitoredSatellite({ id: 'sat-1', enabled: true, name: 'NOAA 19' }));
        state = reducer(state, toggleMonitoredSatelliteEnabled({ id: 'sat-1', enabled: false }));
        state = reducer(state, updateMonitoredSatellite({ id: 'sat-1', enabled: false, name: 'NOAA 19 updated' }));

        expect(state.monitoredSatelliteError).toBeNull();
        expect(state.monitoredSatellites).toEqual([
            { id: 'sat-1', enabled: false, name: 'NOAA 19 updated' },
        ]);
    });

    it('tracks SDR parameter request lifecycle and persists status filters', () => {
        let state = reducer(undefined, { type: '@@INIT' });
        state = reducer(state, fetchSDRParameters.rejected(
            { sdrId: 'sdr-1', error: 'old error' },
            'request',
            { sdrId: 'sdr-1' },
        ));
        state = reducer(state, fetchSDRParameters.pending('request', { sdrId: 'sdr-1' }));
        state = reducer(state, fetchSDRParameters.fulfilled(
            { sdrId: 'sdr-1', parameters: { gain: [10, 20] } },
            'request',
            { sdrId: 'sdr-1' },
        ));
        state = reducer(state, toggleStatusFilter('completed'));

        expect(state.sdrParametersLoading).toBe(false);
        expect(state.sdrParameters['sdr-1']).toEqual({ gain: [10, 20] });
        expect(state.sdrParametersError['sdr-1']).toBeUndefined();
        expect(state.statusFilters.completed).toBe(false);
        expect(JSON.parse(localStorage.getItem('scheduler_statusFilters'))).toMatchObject({ completed: false });
    });
});
