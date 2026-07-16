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

// get-local-soapy-sdr-devices
export const fetchLocalSoapySDRDevices = createAsyncThunk(
    'sdrs/fetchLocalSoapySDRDevices',
    async ({socket}, {rejectWithValue}) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'get-local-soapy-sdr-devices',
  data: null
}, res => {
  if (res.success) {
    resolve(res.data);
  } else {
    reject(new Error('Failed to fetch local SoapySDR devices'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);


export const fetchLocalRtlSdrDevices = createAsyncThunk(
    'sdrs/fetchLocalRtlSdrDevices',
    async ({socket}, {rejectWithValue}) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'get-local-rtl-sdr-devices',
  data: null
}, res => {
  if (res.success) {
    resolve(res.data);
  } else {
    reject(new Error('Failed to fetch local RTL-SDR devices'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);


export const fetchLocalUhdDevices = createAsyncThunk(
    'sdrs/fetchLocalUhdDevices',
    async ({socket}, {rejectWithValue}) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'get-local-uhd-devices',
  data: null
}, res => {
  if (res.success) {
    resolve(res.data);
  } else {
    reject(new Error('Failed to fetch local UHD devices'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const fetchLocalAirspyDevices = createAsyncThunk(
    'sdrs/fetchLocalAirspyDevices',
    async ({socket}, {rejectWithValue}) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'get-local-airspy-devices',
  data: null
}, res => {
  if (res.success) {
    resolve(res.data);
  } else {
    reject(new Error('Failed to fetch local Airspy devices'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);


export const fetchSoapySDRServers = createAsyncThunk(
    'sdrs/fetchSoapySDRServers',
    async ({socket}, {rejectWithValue}) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'get-soapy-servers',
  data: null
}, res => {
  if (res.success) {
    resolve(res.data);
  } else {
    reject(new Error('Failed to fetch SoapySDR servers'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const startSoapySDRDiscovery = createAsyncThunk(
    'sdrs/startSoapySDRDiscovery',
    async ({ socket, mode = 'single', refresh_interval = 120 }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: "background-task.start",
  data: {
    task_name: 'soapysdr_discovery',
    args: [],
    kwargs: {
      mode,
      refresh_interval
    },
    name: 'SoapySDR Discovery'
  }
}, res => {
  if (res?.success) {
    resolve(res);
  } else {
    reject(new Error(res?.error || 'Failed to start SoapySDR discovery'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);


export const fetchSDRs = createAsyncThunk(
    'sdrs/fetchAll',
    async ({ socket }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'get-sdrs',
  data: null
}, res => {
  if (res.success) {
    resolve(res.data);
  } else {
    reject(new Error('Failed to fetch SDRs'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const deleteSDRs = createAsyncThunk(
    'sdrs/deleteSDRs',
    async ({ socket, selectedIds }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'delete-sdr',
  data: selectedIds
}, response => {
  if (response.success) {
    resolve(response.data);
  } else {
    reject(new Error('Failed to delete SDRs'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const submitOrEditSDR = createAsyncThunk(
    'sdrs/submitOrEdit',
    async ({socket, formValues}, {rejectWithValue, dispatch}) => {
        const action = formValues.id ? 'edit-sdr' : 'submit-sdr';
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
    reject(new Error(`Failed to ${action === 'edit-sdr' ? 'edit' : 'add'} SDR`));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

const defaultSDR = {
    id: null,
    name: '',
    host: '127.0.0.1',
    port: 1234,
    type: '',
    serial: '',
    driver: '',
    antenna_labels: {},
    frequency_min: 24,
    frequency_max: 1800,
};

const sdrsSlice = createSlice({
    name: 'sdrs',
    initialState: {
        selectedSDR: defaultSDR,
        selectedSDRId: "",
        sdrs: [],
        status: 'idle', // 'idle' | 'loading' | 'succeeded' | 'failed'
        error: null,
        openDeleteConfirm: false,
        openAddDialog: false,
        selected: [],
        loading: false,
        loadingLocalSDRs: false,
        loadingLocalRtlSDRs: false,
        loadingLocalUhdSDRs: false,
        loadingLocalAirspySDRs: false,
        pageSize: 10,
        formValues: defaultSDR,
        soapyServers: {},
        selectedSdrDevice: "",
        localSoapyDevices: [],
        localRtlDevices: [],
        localUhdDevices: [],
        localAirspyDevices: [],
    },
    reducers: {
        setSDRs: (state, action) => {
            state.sdrs = action.payload;
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
            state.formValues = defaultSDR;
        },
        setError: (state, action) => {
            state.error = action.payload;
        },
        setStatus: (state, action) => {
            state.status = action.payload;
        },
        setSelectedSDRId: (state, action) => {
            state.selectedSDRId = action.payload;
            state.selectedSDR = state.sdrs.find(sdr => sdr.id === action.payload);
        },
        setSelectedSdrDevice: (state, action) => {
            state.selectedSdrDevice = action.payload;
        },
        setLoadingLocalSDRs: (state, action) => {
            state.loadingLocalSDRs = action.payload;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchSDRs.pending, (state) => {
                state.status = 'loading';
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchSDRs.fulfilled, (state, action) => {
                state.status = 'succeeded';
                state.loading = false;
                state.sdrs = action.payload; // the data returned by the thunk
            })
            .addCase(fetchSDRs.rejected, (state, action) => {
                state.status = 'failed';
                state.loading = false;
                state.error = action.payload;
            })
            .addCase(deleteSDRs.pending, (state) => {
                state.loading = true;
                state.error = null;
                state.status = 'loading';
            })
            .addCase(deleteSDRs.fulfilled, (state, action) => {
                state.loading = false;
                state.status = 'succeeded';
                state.sdrs = action.payload; // Updated SDR list from server
                state.openDeleteConfirm = false;
            })
            .addCase(deleteSDRs.rejected, (state, action) => {
                state.loading = false;
                state.status = 'failed';
                state.error = action.payload;
            })
            .addCase(submitOrEditSDR.pending, (state) => {
                state.loading = true;
                state.error = null;
                state.status = 'loading';
            })
            .addCase(submitOrEditSDR.fulfilled, (state, action) => {
                state.loading = false;
                state.status = 'succeeded';
                state.sdrs = action.payload;
                state.formValues = defaultSDR;
            })
            .addCase(submitOrEditSDR.rejected, (state, action) => {
                state.loading = false;
                state.status = 'failed';
                state.error = action.payload;
            })
            .addCase(fetchSoapySDRServers.pending, (state) => {
                state.loading = true;
                state.error = null;
                state.status = 'loading';
            })
            .addCase(fetchSoapySDRServers.fulfilled, (state, action) => {
                state.loading = false;
                state.status = 'succeeded';
                state.soapyServers = action.payload;
            })
            .addCase(fetchSoapySDRServers.rejected, (state, action) => {
                state.loading = false;
                state.status = 'failed';
                state.error = action.payload;
            })
            .addCase(startSoapySDRDiscovery.pending, (state) => {
                state.loading = true;
                state.error = null;
                state.status = 'loading';
            })
            .addCase(startSoapySDRDiscovery.fulfilled, (state) => {
                state.loading = false;
                state.status = 'succeeded';
            })
            .addCase(startSoapySDRDiscovery.rejected, (state, action) => {
                state.loading = false;
                state.status = 'failed';
                state.error = action.payload;
            })
            .addCase(fetchLocalSoapySDRDevices.pending, (state) => {
                state.loadingLocalSDRs = true;
                state.error = null;
                state.status = 'loading';
            })
            .addCase(fetchLocalSoapySDRDevices.fulfilled, (state, action) => {
                state.loadingLocalSDRs = false;
                state.status = 'succeeded';
                state.localSoapyDevices = action.payload;
            })
            .addCase(fetchLocalSoapySDRDevices.rejected, (state, action) => {
                state.loadingLocalSDRs = false;
                state.status = 'failed';
                state.error = action.payload;
            })
            .addCase(fetchLocalRtlSdrDevices.pending, (state) => {
                state.loadingLocalRtlSDRs = true;
                state.error = null;
                state.status = 'loading';
            })
            .addCase(fetchLocalRtlSdrDevices.fulfilled, (state, action) => {
                state.loadingLocalRtlSDRs = false;
                state.status = 'succeeded';
                state.localRtlDevices = action.payload;
            })
            .addCase(fetchLocalRtlSdrDevices.rejected, (state, action) => {
                state.loadingLocalRtlSDRs = false;
                state.status = 'failed';
                state.error = action.payload;
            })
            .addCase(fetchLocalUhdDevices.pending, (state) => {
                state.loadingLocalUhdSDRs = true;
                state.error = null;
                state.status = 'loading';
            })
            .addCase(fetchLocalUhdDevices.fulfilled, (state, action) => {
                state.loadingLocalUhdSDRs = false;
                state.status = 'succeeded';
                state.localUhdDevices = action.payload;
            })
            .addCase(fetchLocalUhdDevices.rejected, (state, action) => {
                state.loadingLocalUhdSDRs = false;
                state.status = 'failed';
                state.error = action.payload;
            })
            .addCase(fetchLocalAirspyDevices.pending, (state) => {
                state.loadingLocalAirspySDRs = true;
                state.error = null;
                state.status = 'loading';
            })
            .addCase(fetchLocalAirspyDevices.fulfilled, (state, action) => {
                state.loadingLocalAirspySDRs = false;
                state.status = 'succeeded';
                state.localAirspyDevices = action.payload;
            })
            .addCase(fetchLocalAirspyDevices.rejected, (state, action) => {
                state.loadingLocalAirspySDRs = false;
                state.status = 'failed';
                state.error = action.payload;
            });
    },
});

export const {
    setSDRs,
    setLoading,
    setPageSize,
    setOpenDeleteConfirm,
    setOpenAddDialog,
    setSelected,
    setFormValues,
    resetFormValues,
    setError,
    setStatus,
    setSelectedSDRId,
    setSelectedSdrDevice,
} = sdrsSlice.actions;

export default sdrsSlice.reducer;
