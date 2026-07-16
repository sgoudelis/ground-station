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


import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { toast } from '../../utils/toast-with-timestamp.jsx';
import SatelliteAltIcon from "@mui/icons-material/SatelliteAlt";

export const startSatelliteSync = createAsyncThunk(
    'syncSatellite/start',
    async ({ socket }, { rejectWithValue }) => {
        try {
            toast.info('Orbital data synchronization started...', {
                icon: () => <SatelliteAltIcon />,
            });
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'sync-satellite-data',
  data: null
}, response => {
  if (response.success === true) {
    resolve('Satellite data synchronization initiated');
  } else {
    reject(response.error);
  }
});
            });
        } catch (error) {
            return rejectWithValue(error);
        }
    }
);


export const fetchSyncState = createAsyncThunk(
    'syncSatellite/fetchState',
    async ({socket}, {rejectWithValue}) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'fetch-sync-state',
  data: null
}, response => {
  if (response.success === true) {
    resolve(response.data);
  } else {
    reject(response.error);
  }
});
            });
        } catch (error) {
            return rejectWithValue(error);
        }
    }
);


const syncSatelliteSlice = createSlice({
    name: 'syncSatellite',
    initialState: {
        status: 'idle',
        error: null,
        loading: false,
        synchronizing: false,
        syncState: {
            progress: -1,
            newly_added: 0,
            modified: 0,
            removed: 0,
        }
    },
    reducers: {
        setSyncState: (state, action) => {
            state.syncState = action.payload;
        },
        setLoading: (state, action) => {
            state.loading = action.payload;
        },
        setSynchronizing: (state, action) => {
            state.synchronizing = action.payload;
        },
        setError: (state, action) => {
            state.error = action.payload;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(startSatelliteSync.pending, (state) => {
                state.status = 'loading';
                state.synchronizing = true;
                state.error = null;
                // Immediately reflect a running sync in the UI, even before the first backend progress event arrives.
                state.syncState = {
                    ...state.syncState,
                    status: 'inprogress',
                    progress: 0,
                    success: null,
                    message: state.syncState?.message || 'Starting orbital data synchronization...',
                };
            })
            .addCase(startSatelliteSync.fulfilled, (state, action) => {
                state.status = 'succeeded';
            })
            .addCase(startSatelliteSync.rejected, (state, action) => {
                state.status = 'failed';
                state.synchronizing = false;
                state.error = action.payload || 'Failed to synchronize satellites';
            })
            .addCase(fetchSyncState.pending, (state) => {
                state.status = 'loading';
                state.error = null;
            })
            .addCase(fetchSyncState.fulfilled, (state, action) => {
                state.status = 'succeeded';
                state.syncState = action.payload;
            })
            .addCase(fetchSyncState.rejected, (state, action) => {
                state.status = 'failed';
                state.error = action.payload || 'Failed to fetch sync state';
            });
    },
});

export const {
    setSyncState,
    setSynchronizing,
} = syncSatelliteSlice.actions;

export default syncSatelliteSlice.reducer;
