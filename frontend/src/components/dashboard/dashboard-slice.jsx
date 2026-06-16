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
    },
    reducers: {
        setIsEditing: (state, action) => {
            state.isEditing = action.payload;
        },
        setConnecting: (state, action) => {
            state.connecting = action.payload;
        },
        setConnected: (state, action) => {
            state.connected = action.payload;
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
        resetRuntimeSessionState: (state) => {
            // Force a clean runtime bootstrap for each authenticated session.
            // Without this reset, logout/login cycles can briefly reuse stale
            // "connected + data loaded" flags from the previous session.
            state.connecting = true;
            state.connected = false;
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
    resetRuntimeSessionState,
} = rigsSlice.actions;

export default rigsSlice.reducer;
