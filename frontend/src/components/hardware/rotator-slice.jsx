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

export const fetchRotators = createAsyncThunk(
    'rotators/fetchAll',
    async ({ socket }, { rejectWithValue }) => {
        try {
            // Example: you could wrap socket events with a Promise
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'get-rotators',
  data: null
}, res => {
  if (res.success) {
    resolve(res.data);
  } else {
    reject(new Error('Failed to fetch rotators'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const deleteRotators = createAsyncThunk(
    'rotators/deleteRotators',
    async ({ socket, selectedIds }, { rejectWithValue }) => {
        try {
            // Wrap your socket call in a Promise
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'delete-rotator',
  data: selectedIds
}, response => {
  if (response.success) {
    resolve(response.data);
  } else {
    reject(new Error('Failed to delete rotators'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const submitOrEditRotator = createAsyncThunk(
    'rotators/submitOrEdit',
    async ({socket, formValues}, {rejectWithValue, dispatch}) => {
        const action = formValues.id ? 'edit-rotator' : 'submit-rotator';
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: action,
  data: formValues
}, response => {
  if (response.success) {
    dispatch(setOpenAddDialog(false));
    resolve(response.data);
  } else {
    reject(new Error(`Failed to ${action === 'edit-rotator' ? 'edit' : 'add'} rotator`));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const updateRotatorTrackingLead = createAsyncThunk(
    'rotators/updateTrackingLead',
    async ({socket, rotatorId, trackingLeadSeconds}, {rejectWithValue}) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
                    cmd: 'edit-rotator',
                    data: {id: rotatorId, tracking_lead_seconds: trackingLeadSeconds},
                }, response => {
                    if (response.success) {
                        resolve(response.data);
                    } else {
                        reject(new Error(response.message || 'Failed to update tracking lead'));
                    }
                });
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

const defaultRotator = {
    id: null,
    name: '',
    host: 'localhost',
    port: 4533,
    minaz: 0,
    maxaz: 360,
    azimuth_mode: '0_360',
    minel: 0,
    maxel: 90,
    parkaz: null,
    parkel: null,
    aztolerance: 2.0,
    eltolerance: 2.0,
    tracking_lead_seconds: 2.0,
    stop_supported: true,
};

const rotatorsSlice = createSlice({
    name: 'rotators',
    initialState: {
        rotators: [],
        status: 'idle', // 'idle' | 'loading' | 'succeeded' | 'failed'
        error: null,
        openDeleteConfirm: false,
        openAddDialog: false,
        selected: [],
        loading: false,
        pageSize: 10,
        formValues: defaultRotator,
    },
    reducers: {
        setRotators: (state, action) => {
            state.rotators = action.payload;
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
            state.formValues = defaultRotator;
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
            // When the thunk is pending, mark status/loading states
            .addCase(fetchRotators.pending, (state) => {
                state.status = 'loading';
                state.loading = true;
                state.error = null;
            })
            // When the thunk completes successfully
            .addCase(fetchRotators.fulfilled, (state, action) => {
                state.status = 'succeeded';
                state.loading = false;
                state.rotators = action.payload; // the data returned by the thunk
            })
            // If the thunk fails
            .addCase(fetchRotators.rejected, (state, action) => {
                state.status = 'failed';
                state.loading = false;
                state.error = action.payload;
            })
            // Pending: set loading, clear errors as needed
            .addCase(deleteRotators.pending, (state) => {
                state.loading = true;
                state.error = null;
                state.status = 'loading';
            })
            // Fulfilled: update the state with the new data from the server
            .addCase(deleteRotators.fulfilled, (state, action) => {
                state.loading = false;
                state.status = 'succeeded';
                state.rotators = action.payload; // Updated rotator list from server
                state.openDeleteConfirm = false;
            })
            // Rejected: store the error
            .addCase(deleteRotators.rejected, (state, action) => {
                state.loading = false;
                state.status = 'failed';
                state.error = action.payload;
            })
            // Pending: set loading state and clear errors as needed
            .addCase(submitOrEditRotator.pending, (state) => {
                state.loading = true;
                state.error = null;
                state.status = 'loading';
            })
            // Fulfilled: update the state and reset formValues
            .addCase(submitOrEditRotator.fulfilled, (state, action) => {
                state.loading = false;
                state.status = 'succeeded';
                state.rotators = action.payload; // Add a new rotator or update existing
                state.formValues = defaultRotator; // Reset the form values
            })
            // Rejected: store the error message
            .addCase(submitOrEditRotator.rejected, (state, action) => {
                state.loading = false;
                state.status = 'failed';
                state.error = action.payload;
            })
            .addCase(updateRotatorTrackingLead.fulfilled, (state, action) => {
                state.rotators = action.payload;
            })
    },
});

export const {
    setRotators,
    setLoading,
    setPageSize,
    setOpenDeleteConfirm,
    setOpenAddDialog,
    setSelected,
    setFormValues,
    resetFormValues,
    setError,
    setStatus,
} = rotatorsSlice.actions;

export default rotatorsSlice.reducer;
