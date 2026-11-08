import { configureStore } from '@reduxjs/toolkit';
import { afterEach, describe, expect, it } from 'vitest';
import reducer, {
    applySDRConfigParameters, getSDRConfigParameters, setSelectedSDRId, updateSDRConfig,
} from '../waterfall-slice.jsx';

const parameters = (antenna) => ({
    gain_values: [0, 10, 20], sample_rate_values: [2000000],
    antennas: { tx: [], rx: [antenna] },
});

describe('SDR capability requests', () => {
    afterEach(() => localStorage.removeItem('ground-station.waterfall.sdr-params.v1'));

    it('uses backend capabilities even when a browser has an old cached response', async () => {
        localStorage.setItem('ground-station.waterfall.sdr-params.v1', JSON.stringify({
            version: 1,
            items: { 'sdr-a': { gain_values: [1] } },
        }));
        const calls = [];
        const socket = {
            emit: (_event, request, callback) => {
                calls.push(request.cmd);
                callback({ success: true, data: { gain_values: [0, 10, 20] } });
            },
        };
        const store = configureStore({ reducer: { waterfall: reducer } });
        store.dispatch(setSelectedSDRId('sdr-a'));

        await store.dispatch(getSDRConfigParameters({ socket, selectedSDRId: 'sdr-a' })).unwrap();

        expect(calls).toEqual(['get-sdr-parameters']);
        expect(store.getState().waterfall.gainValues).toEqual([0, 10, 20]);
    });

    it('clears the previous device choices and antenna when selecting another SDR', () => {
        const store = configureStore({ reducer: { waterfall: reducer } });
        store.dispatch(setSelectedSDRId('sdr-a'));
        store.dispatch(applySDRConfigParameters({ selectedSDRId: 'sdr-a', data: parameters('ANT-A') }));
        store.dispatch(updateSDRConfig({ sdr_id: 'sdr-a', antenna: 'ANT-A' }));

        // Reselecting the same device preserves its current controls.
        store.dispatch(setSelectedSDRId('sdr-a'));
        expect(store.getState().waterfall.selectedAntenna).toBe('ANT-A');

        store.dispatch(setSelectedSDRId('sdr-b'));
        expect(store.getState().waterfall.antennasList.rx).toEqual([]);
        expect(store.getState().waterfall.selectedAntenna).toBe('none');
        expect(store.getState().waterfall.gainValues).toEqual([]);
    });

    it('keeps probed antenna choices when a configuration echoes a previous device antenna', () => {
        const store = configureStore({ reducer: { waterfall: reducer } });
        store.dispatch(setSelectedSDRId('sdr-a'));
        store.dispatch(applySDRConfigParameters({ selectedSDRId: 'sdr-a', data: parameters('ANT-A') }));
        store.dispatch(updateSDRConfig({ sdr_id: 'sdr-a', antenna: 'ANT-A' }));
        store.dispatch(setSelectedSDRId('sdr-b'));
        store.dispatch(applySDRConfigParameters({ selectedSDRId: 'sdr-b', data: parameters('ANT-B') }));

        // Older clients/configurations can carry an antenna that this SDR never advertised.
        store.dispatch(updateSDRConfig({ sdr_id: 'sdr-b', antenna: 'ANT-A' }));
        expect(store.getState().waterfall.antennasList.rx).toEqual(['ANT-B']);
    });

    it.each([true, false])('ignores a previous SDR request completing after a switch (success: %s)', async (success) => {
        const callbacks = {};
        const socket = { emit: (_event, request, callback) => { callbacks[request.data] = callback; } };
        const store = configureStore({ reducer: { waterfall: reducer } });
        store.dispatch(setSelectedSDRId('sdr-a'));
        const first = store.dispatch(getSDRConfigParameters({ socket, selectedSDRId: 'sdr-a' }));
        store.dispatch(setSelectedSDRId('sdr-b'));
        const second = store.dispatch(getSDRConfigParameters({ socket, selectedSDRId: 'sdr-b' }));

        callbacks['sdr-a']({ success, data: parameters('ANT-A'), error: 'Old SDR unavailable' });
        await first;
        expect(store.getState().waterfall.gettingSDRParameters).toBe(true);
        expect(store.getState().waterfall.antennasList.rx).toEqual([]);
        expect(store.getState().waterfall.errorMessage).toBeNull();

        callbacks['sdr-b']({ success: true, data: parameters('ANT-B') });
        await second;
        expect(store.getState().waterfall.antennasList.rx).toEqual(['ANT-B']);
        expect(store.getState().waterfall.gettingSDRParameters).toBe(false);
    });
});
