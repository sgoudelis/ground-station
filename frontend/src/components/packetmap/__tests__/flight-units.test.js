import {waitFor} from '@testing-library/react';
import {expect, it} from 'vitest';
import {setFlightUnits} from '../packet-map-slice.jsx';

it('persists flight units with the application Redux Persist configuration and restores them on reload', async () => {
    localStorage.clear();
    const {store, persistor} = await import('../../common/store.jsx');
    try {
        await waitFor(() => expect(persistor.getState().bootstrapped).toBe(true));
        store.dispatch(setFlightUnits('kmh'));
        await persistor.flush();

        const persisted = JSON.parse(localStorage.getItem('persist:packetMap'));
        expect(JSON.parse(persisted.flightUnits)).toBe('kmh');

        store.dispatch(setFlightUnits('aviation'));
        store.dispatch({type: 'persist/REHYDRATE', key: 'packetMap', payload: Object.fromEntries(
            Object.entries(persisted).map(([key, value]) => [key, JSON.parse(value)]),
        )});
        expect(store.getState().packetMap.flightUnits).toBe('kmh');
    } finally {
        persistor.pause();
    }
});
