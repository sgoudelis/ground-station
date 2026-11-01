import {useSyncExternalStore} from 'react';
import {createAircraftStore} from './aircraft-store.js';

const stores = new WeakMap();
const empty = createAircraftStore(null);
const noSubscribe = () => () => {};

export default function useAircraft(socket, enabled = true) {
    if (socket && !stores.has(socket)) stores.set(socket, createAircraftStore(socket));
    const store = socket ? stores.get(socket) : empty;
    return useSyncExternalStore(enabled ? store.subscribe : noSubscribe, store.getSnapshot, empty.getSnapshot);
}
