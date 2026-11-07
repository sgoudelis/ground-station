/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */


import {createSlice, createAsyncThunk} from '@reduxjs/toolkit';

const rigsSlice = createSlice({
    name: 'dashboard',
    initialState: {
        isEditing: false,
        connecting: true,
        connected: false,
        connectedAt: null,
        disconnected: false,
        reconnecting: false,
        reConnectAttempt: 0,
        connectionError: null,
        initialDataLoading: false,
        initialDataProgress: {
            completed: 0,
            total: 0,
        },
        showLocationSetupDialog: false,
        manualRotatorDialogPosition: {x: 0, y: 0},
    },
    reducers: {
        setIsEditing: (state, action) => {
            state.isEditing = action.payload;
        },
        setConnecting: (state, action) => {
            state.connecting = action.payload;
        },
        setConnected: {
            reducer: (state, action) => {
                if (action.payload && (!state.connected || !state.connectedAt)) state.connectedAt = action.meta.connectedAt;
                if (!action.payload) state.connectedAt = null;
                state.connected = action.payload;
            },
            prepare: (connected) => ({ payload: connected, meta: { connectedAt: Date.now() } }),
        },
        setDisconnected: (state, action) => {
            state.disconnected = action.payload;
        },
        setReconnecting: (state, action) => {
            state.reconnecting = action.payload;
        },
        setReConnectAttempt: (state, action) => {
            state.reConnectAttempt = action.payload;
        },
        setConnectionError: (state, action) => {
            state.connectionError = action.payload;
        },
        setInitialDataLoading: (state, action) => {
            state.initialDataLoading = action.payload;
        },
        setInitialDataProgress: (state, action) => {
            state.initialDataProgress = action.payload;
        },
        setShowLocationSetupDialog: (state, action) => {
            state.showLocationSetupDialog = action.payload;
        },
        setManualRotatorDialogPosition: (state, action) => {
            const {x, y} = action.payload;
            if (Number.isFinite(x) && Number.isFinite(y)) {
                state.manualRotatorDialogPosition = {x, y};
            }
        },
        resetRuntimeSessionState: (state) => {
            // Force a clean runtime bootstrap for each authenticated session.
            // Without this reset, logout/login cycles can briefly reuse stale
            // "connected + data loaded" flags from the previous session.
            state.connecting = true;
            state.connected = false;
            state.connectedAt = null;
            state.disconnected = false;
            state.reconnecting = false;
            state.reConnectAttempt = 0;
            state.connectionError = null;
            state.initialDataLoading = true;
            state.initialDataProgress = {
                completed: 0,
                total: 0,
            };
        },
    },
});

export const {
    setIsEditing,
    setConnecting,
    setConnected,
    setDisconnected,
    setReconnecting,
    setReConnectAttempt,
    setConnectionError,
    setInitialDataLoading,
    setInitialDataProgress,
    setShowLocationSetupDialog,
    setManualRotatorDialogPosition,
    resetRuntimeSessionState,
} = rigsSlice.actions;

export default rigsSlice.reducer;
