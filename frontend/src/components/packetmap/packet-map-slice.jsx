/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import {createSlice} from '@reduxjs/toolkit';
import {liveRangeAt} from './live.js';

const packetMapSlice = createSlice({
    name: 'packetMap',
    // LIVE always follows a bounded recent window, including after rehydration.
    initialState: () => ({
        range: liveRangeAt(),
        transmitterTableColumnVisibility: {},
    }),
    reducers: {
        setPacketMapRange(state, action) {
            // A null end is the persisted LIVE selection. Keep historical endpoints exact.
            state.range = {start: action.payload.start, end: action.payload.end};
        },
        setTransmitterTableColumnVisibility(state, action) {
            state.transmitterTableColumnVisibility = action.payload;
        },
    },
});

export const {setPacketMapRange, setTransmitterTableColumnVisibility} = packetMapSlice.actions;
export default packetMapSlice.reducer;
