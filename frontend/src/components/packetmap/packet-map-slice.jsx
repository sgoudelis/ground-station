/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import {createSlice} from '@reduxjs/toolkit';
import {liveRangeAt} from './live.js';
import {aircraftUnitsStoreName, readStored} from './storage.js';

export const FLIGHT_UNIT_SYSTEMS = ['aviation', 'metric', 'kmh'];

const packetMapSlice = createSlice({
    name: 'packetMap',
    // LIVE always follows a bounded recent window, including after rehydration.
    initialState: () => {
        // Preserve the choice made before flight units moved into Redux Persist.
        const savedUnits = readStored(aircraftUnitsStoreName);
        return {
            range: liveRangeAt(),
            transmitterList: {excludedTypes: [], sort: 'first_seen', pageSize: 100},
            // Until a choice is made, aircraft and radiosondes retain their own defaults.
            flightUnits: FLIGHT_UNIT_SYSTEMS.includes(savedUnits) ? savedUnits : null,
        };
    },
    reducers: {
        setPacketMapRange(state, action) {
            // A null end is the persisted LIVE selection. Keep historical endpoints exact.
            state.range = {start: action.payload.start, end: action.payload.end};
        },
        setTransmitterListSettings(state, action) {
            state.transmitterList = action.payload;
        },
        setFlightUnits(state, action) {
            if (FLIGHT_UNIT_SYSTEMS.includes(action.payload)) state.flightUnits = action.payload;
        },
    },
});

export const {setPacketMapRange, setTransmitterListSettings, setFlightUnits} = packetMapSlice.actions;
export default packetMapSlice.reducer;
