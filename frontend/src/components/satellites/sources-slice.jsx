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

const defaultTLESource = {
    id: null,
    name: '',
    url: '',
    format: '3le',
    query_mode: 'url',
    group_id: null,
    norad_ids: [],
    provider: 'generic_http',
    adapter: 'http_3le',
    enabled: true,
    show_on_earth_view: true,
    priority: 100,
    central_body: 'earth',
    auth_type: 'none',
    username: '',
    password: '',
};

const normalizeProvider = (provider) => {
    const normalized = String(provider ?? defaultTLESource.provider).toLowerCase();
    return normalized;
};

const normalizeTLESourceRecord = (source) => ({
    ...defaultTLESource,
    ...source,
    format: String(source?.format ?? defaultTLESource.format).toLowerCase(),
    query_mode: String(source?.query_mode ?? defaultTLESource.query_mode).toLowerCase(),
    group_id: source?.group_id ?? null,
    norad_ids: Array.isArray(source?.norad_ids)
        ? source.norad_ids
            .map((item) => Number(item))
            .filter((item) => Number.isInteger(item) && item > 0)
        : [],
    provider: normalizeProvider(source?.provider),
    adapter: String(source?.adapter ?? defaultTLESource.adapter).toLowerCase(),
    enabled: source?.enabled === undefined ? defaultTLESource.enabled : Boolean(source.enabled),
    priority: Number.isFinite(Number(source?.priority))
        ? Number(source.priority)
        : defaultTLESource.priority,
    central_body: String(source?.central_body ?? defaultTLESource.central_body).toLowerCase(),
    auth_type: String(source?.auth_type ?? defaultTLESource.auth_type).toLowerCase(),
    username: source?.username ?? '',
    password: source?.password ?? '',
});

export const fetchOrbitalSources = createAsyncThunk(
    'orbitalSources/fetchAll',
    async ({ socket }, { rejectWithValue }) => {
        try {
            // Wrap socket in a Promise for async behavior
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'get-orbital-sources',
  data: null
}, res => {
  if (res.success) {
    resolve(res.data);
  } else {
    reject(new Error('Failed to fetch orbital sources'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const deleteOrbitalSources = createAsyncThunk(
    'orbitalSources/deleteOrbitalSources',
    async ({ socket, selectedIds }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'delete-orbital-sources',
  data: selectedIds
}, response => {
  if (response.success) {
    resolve({
      data: response.data,
      message: response.message,
      summary: response.summary
    });
  } else {
    reject(new Error('Failed to delete orbital sources'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const submitOrEditOrbitalSource = createAsyncThunk(
    'orbitalSources/submitOrEdit',
    async ({ socket, formValues }, { rejectWithValue }) => {
        const action = formValues.id ? 'edit-orbital-source' : 'submit-orbital-sources';
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: action,
  data: formValues
}, response => {
  if (response.success) {
    resolve(response.data);
  } else {
    reject(new Error(
      response.error || `Failed to ${action === 'edit-orbital-source' ? 'edit' : 'add'} orbital source`
    ));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

// Create the slice, mirroring rig-slice structure:
const sourcesSlice = createSlice({
    name: 'orbitalSources',
    initialState: {
        tleSources: [],
        status: 'idle',    // 'idle' | 'loading' | 'succeeded' | 'failed'
        error: null,
        openDeleteConfirm: false,
        openAddDialog: false,
        selected: [],
        loading: false,
        pageSize: 10,
        formValues: defaultTLESource,
    },
    reducers: {
        clearSourceSession: (state) => {
            // Credentials from an admin session must not survive a user or role change.
            state.tleSources = [];
            state.formValues = defaultTLESource;
            state.openAddDialog = false;
            state.openDeleteConfirm = false;
            state.selected = [];
            state.status = 'idle';
            state.loading = false;
            state.error = null;
        },
        setTleSources: (state, action) => {
            state.tleSources = action.payload;
        },
        setLoading: (state, action) => {
            state.loading = action.payload;
        },
        setPageSize: (state, action) => {
            state.pageSize = action.payload;
        },
        setOpenDeleteConfirm: (state, action) => {
            state.openDeleteConfirm = action.payload;
        },
        setOpenAddDialog: (state, action) => {
            state.openAddDialog = action.payload;
        },
        setSelected: (state, action) => {
            state.selected = action.payload;
        },
        setFormValues: (state, action) => {
            state.formValues = {
                ...state.formValues,
                ...action.payload,
            };
        },
        resetFormValues: (state) => {
            state.formValues = defaultTLESource;
        },
        setError: (state, action) => {
            state.error = action.payload;
        },
        setStatus: (state, action) => {
            state.status = action.payload;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchOrbitalSources.pending, (state) => {
                state.status = 'loading';
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchOrbitalSources.fulfilled, (state, action) => {
                state.status = 'succeeded';
                state.loading = false;
                state.tleSources = (action.payload || []).map(normalizeTLESourceRecord);
            })
            .addCase(fetchOrbitalSources.rejected, (state, action) => {
                state.status = 'failed';
                state.loading = false;
                state.error = action.error?.message;
            })
            .addCase(deleteOrbitalSources.pending, (state) => {
                state.loading = true;
            })
            .addCase(deleteOrbitalSources.fulfilled, (state, action) => {
                state.tleSources = (action.payload.data || []).map(normalizeTLESourceRecord);
                state.openDeleteConfirm = false;
                state.loading = false;
            })
            .addCase(deleteOrbitalSources.rejected, (state, action) => {
                state.loading = false;
                state.error = action.error?.message;
            })
            .addCase(submitOrEditOrbitalSource.pending, (state) => {
                state.loading = true;
            })
            .addCase(submitOrEditOrbitalSource.fulfilled, (state, action) => {
                state.tleSources = (action.payload || []).map(normalizeTLESourceRecord);
                state.loading = false;
            })
            .addCase(submitOrEditOrbitalSource.rejected, (state, action) => {
                state.loading = false;
                state.error = action.error?.message;
            });
    },
});

// Export the slice’s reducer and actions
export const {
    clearSourceSession,
    setTleSources,
    setLoading,
    setPageSize,
    setOpenDeleteConfirm,
    setOpenAddDialog,
    setSelected,
    setFormValues,
    resetFormValues,
    setError,
    setStatus,
} = sourcesSlice.actions;

// Backward-compatible action/thunk aliases.
export const fetchTLESources = fetchOrbitalSources;
export const deleteTLESources = deleteOrbitalSources;
export const submitOrEditTLESource = submitOrEditOrbitalSource;

export default sourcesSlice.reducer;
