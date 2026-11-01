/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import {createSlice} from '@reduxjs/toolkit';

const packetMapSlice = createSlice({
    name: 'packetMap',
    // Start first-time visitors in LIVE with the last day of packets.
    initialState: () => ({
        range: {start: new Date(Date.now() - 86400000).toISOString(), end: null},
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
