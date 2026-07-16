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

// Example default Satellite object:
const defaultSatellite = {
    id: null,
    name: '',
    norad_id: '',
    sat_id: '',
    status: '',
    tle1: '',
    tle2: '',
    is_frequency_violator: false,
    countries: '',
    operator: '',
    name_other: '',
    alternative_name: '',
    website: '',
    image: '',
    transmitters: [],
    decayed: null,
    launched: null,
    deployed: null,
    updated: null,
};

export const deleteSatellite = createAsyncThunk(
    'satellites/deleteSatellite',
    async ({socket, noradId}, {rejectWithValue}) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'delete-satellite',
  data: noradId
}, response => {
  if (response.success) {
    resolve(response.data);
  } else {
    reject(new Error('Failed to delete satellite'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const fetchSatellite = createAsyncThunk(
    'satellites/fetchSatellite',
    async ({ socket, noradId }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'get-satellite',
  data: noradId
}, response => {
  if (response.success) {
    resolve(response.data);
  } else {
    reject(new Error('Failed to fetch satellites'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const submitTransmitter = createAsyncThunk(
    'satellites/submitTransmitter',
    async ({socket, transmitterData}, {rejectWithValue}) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'submit-transmitter',
  data: transmitterData
}, res => {
  if (res.success) {
    resolve(res.data);
  } else {
    reject(new Error('Failed to submit transmitter'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const fetchTransmitters = createAsyncThunk(
    'satellites/fetchTransmitters',
    async ({socket, satelliteId, targetKey}, {rejectWithValue}) => {
        try {
            return await new Promise((resolve, reject) => {
                const data = targetKey
                    ? { target_key: targetKey }
                    : { norad_cat_id: satelliteId };
                socket.emit("api.call", {
  cmd: 'get-transmitters',
  data: data
}, res => {
  if (res.success) {
    resolve(res.data);
  } else {
    reject(new Error('Failed to fetch transmitters'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const editTransmitter = createAsyncThunk(
    'satellites/editTransmitter',
    async ({socket, transmitterData}, {rejectWithValue}) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'edit-transmitter',
  data: transmitterData
}, res => {
  if (res.success) {
    resolve(res.data);
  } else {
    reject(new Error('Failed to submit transmitter'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const deleteTransmitter = createAsyncThunk(
    'satellites/deleteTransmitter',
    async ({socket, satelliteId, targetKey, transmitterId}, {rejectWithValue}) => {
        try {
            return await new Promise((resolve, reject) => {
                const data = {'transmitter_id': transmitterId};
                if (targetKey) {
                    data.target_key = targetKey;
                } else {
                    data.norad_cat_id = satelliteId;
                }
                socket.emit("api.call", {
  cmd: 'delete-transmitter',
  data: data
}, res => {
  if (res.success) {
    resolve(res.data);
  } else {
    reject(new Error('Failed to delete transmitter'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const fetchSatellites = createAsyncThunk(
    'satellites/fetchAll',
    async ({ socket, satGroupId }, { rejectWithValue }) => {
        if (typeof satGroupId !== 'string' || satGroupId.trim() === '') {
            return rejectWithValue('Missing group id for satellites fetch');
        }
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'get-satellites-for-group-id',
  data: satGroupId
}, res => {
  if (res.success) {
    resolve(res.data);
  } else {
    reject(new Error('Failed to fetch satellites'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const fetchSatelliteGroups = createAsyncThunk(
    'satellites/fetchGroups',
    async ({socket}, {rejectWithValue}) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'get-satellite-groups',
  data: null
}, res => {
  if (res.success) {
    resolve(res.data);
  } else {
    reject(new Error('Failed to fetch satellite groups'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const fetchSatelliteCatalogStats = createAsyncThunk(
    'satellites/fetchCatalogStats',
    async ({socket}, {rejectWithValue}) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'get-satellite-catalog-stats',
  data: null
}, res => {
  if (res.success) {
    resolve(res.data);
  } else {
    reject(new Error(res.error || 'Failed to fetch satellite catalog stats'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const searchSatellites = createAsyncThunk(
    'satellites/search',
    async ({ socket, keyword }, { rejectWithValue }) => {
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: 'get-satellite-search',
  data: keyword
}, res => {
  if (res.success) {
    resolve(res.data);
  } else {
    reject(new Error('Failed to search satellites'));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

export const submitOrEditSatellite = createAsyncThunk(
    'satellites/submitOrEdit',
    async ({ socket, formValues }, { rejectWithValue }) => {
        const action = formValues.id ? 'edit-satellite' : 'submit-satellite';
        const payload = {...formValues};
        delete payload.id;
        try {
            return await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: action,
  data: payload
}, response => {
  if (response.success) {
    resolve(response.data);
  } else {
    reject(new Error(response.error || `Failed to ${action === 'edit-satellite' ? 'edit' : 'add'} satellite`));
  }
});
            });
        } catch (error) {
            return rejectWithValue(error.message);
        }
    }
);

const satellitesSlice = createSlice({
    name: 'satellites',
    initialState: {
        satellites: [],
        satellitesGroups: [],
        satGroupId: "",
        searchKeyword: "",
        status: 'idle', // or 'loading', 'succeeded', 'failed'
        error: null,
        selected: [],
        loading: false,
        pageSize: 10,
        formValues: defaultSatellite,
        openSatelliteInfoDialog: false,
        openDeleteConfirm: false,
        openAddDialog: false,
        clickedSatellite: defaultSatellite,
        catalogStats: null,
    },
    reducers: {
        setSatellites: (state, action) => {
            state.satellites = action.payload;
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
        setOpenSatelliteInfoDialog: (state, action) => {
            state.openSatelliteInfoDialog = action.payload;
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
            state.formValues = defaultSatellite;
        },
        setError: (state, action) => {
            state.error = action.payload;
        },
        setStatus: (state, action) => {
            state.status = action.payload;
        },
        setSatGroupId: (state, action) => {
            state.satGroupId = action.payload;
        },
        setSearchKeyword: (state, action) => {
            state.searchKeyword = action.payload;
        },
        setClickedSatellite: (state, action) => {
            state.clickedSatellite = action.payload;
        },
        setClickedSatelliteTransmitters: (state, action) => {
            state.clickedSatellite.transmitters = action.payload;
        }
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchSatellites.pending, (state) => {
                state.status = 'loading';
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchSatellites.fulfilled, (state, action) => {
                state.status = 'succeeded';
                state.loading = false;
                state.satellites = action.payload;
            })
            .addCase(fetchSatellites.rejected, (state, action) => {
                state.status = 'failed';
                state.loading = false;
                state.error = action.error?.message;
            })
            .addCase(fetchSatelliteGroups.pending, (state) => {
                state.status = 'loading';
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchSatelliteGroups.fulfilled, (state, action) => {
                state.status = 'succeeded';
                state.loading = false;
                state.satellitesGroups = action.payload;
            })
            .addCase(fetchSatelliteGroups.rejected, (state, action) => {
                state.status = 'failed';
                state.loading = false;
                state.error = action.error?.message;
            })
            .addCase(fetchSatelliteCatalogStats.fulfilled, (state, action) => {
                state.catalogStats = action.payload || null;
            })
            .addCase(fetchSatelliteCatalogStats.rejected, (state) => {
                state.catalogStats = null;
            })
            .addCase(submitTransmitter.pending, (state) => {
                state.status = 'loading';
                state.loading = true;
                state.error = null;
            })
            .addCase(submitTransmitter.fulfilled, (state, action) => {
                state.status = 'succeeded';
                state.loading = false;
                if (Array.isArray(action.payload)) {
                    state.clickedSatellite.transmitters = action.payload;
                }
            })
            .addCase(submitTransmitter.rejected, (state, action) => {
                state.status = 'failed';
                state.loading = false;
                state.error = action.error?.message;
            })
            .addCase(deleteTransmitter.pending, (state) => {
                state.status = 'loading';
                state.loading = true;
                state.error = null;
            })
            .addCase(deleteTransmitter.fulfilled, (state, action) => {
                state.status = 'succeeded';
                state.loading = false;
                if (Array.isArray(action.payload)) {
                    state.clickedSatellite.transmitters = action.payload;
                }
            })
            .addCase(editTransmitter.pending, (state) => {
                state.status = 'loading';
                state.loading = true;
                state.error = null;
            })
            .addCase(editTransmitter.fulfilled, (state, action) => {
                state.status = 'succeeded';
                state.loading = false;
                if (Array.isArray(action.payload)) {
                    state.clickedSatellite.transmitters = action.payload;
                }
            })
            .addCase(editTransmitter.rejected, (state, action) => {
                state.status = 'failed';
                state.loading = false;
                state.error = action.error?.message;
            })
            .addCase(deleteTransmitter.rejected, (state, action) => {
                state.status = 'failed';
                state.loading = false;
                state.error = action.error?.message;
            })
            .addCase(fetchSatellite.pending, (state) => {
                state.status = 'loading';
                state.loading = true;
                state.error = null;
            })
            .addCase(fetchSatellite.fulfilled, (state, action) => {
                state.status = 'succeeded';
                state.loading = false;
                state.clickedSatellite = {...action.payload['details'], transmitters: action.payload['transmitters']};
            })
            .addCase(fetchSatellite.rejected, (state, action) => {
                state.status = 'failed';
                state.loading = false;
                state.error = action.error?.message;
            })
            .addCase(deleteSatellite.pending, (state) => {
                state.status = 'loading';
                state.loading = true;
                state.error = null;
            })
            .addCase(deleteSatellite.fulfilled, (state, action) => {
                state.status = 'succeeded';
                state.loading = false;
            })
            .addCase(deleteSatellite.rejected, (state, action) => {
                state.status = 'failed';
                state.loading = false;
                state.error = action.error?.message;
            })
            .addCase(searchSatellites.pending, (state) => {
                state.status = 'loading';
                state.loading = true;
                state.error = null;
            })
            .addCase(searchSatellites.fulfilled, (state, action) => {
                state.status = 'succeeded';
                state.loading = false;
                state.satellites = action.payload;
            })
            .addCase(searchSatellites.rejected, (state, action) => {
                state.status = 'failed';
                state.loading = false;
                state.error = action.error?.message;
            })
            .addCase(submitOrEditSatellite.pending, (state) => {
                state.status = 'loading';
                state.loading = true;
                state.error = null;
            })
            .addCase(submitOrEditSatellite.fulfilled, (state, action) => {
                state.status = 'succeeded';
                state.loading = false;
                state.satellites = action.payload;
            })
            .addCase(submitOrEditSatellite.rejected, (state, action) => {
                state.status = 'failed';
                state.loading = false;
                state.error = action.error?.message;
            });
    },
});

export const {
    setSatellites,
    setLoading,
    setSatGroupId,
    setSearchKeyword,
    setPageSize,
    setOpenDeleteConfirm,
    setOpenSatelliteInfoDialog,
    setOpenAddDialog,
    setClickedSatellite,
    setSelected,
    setFormValues,
    resetFormValues,
    setError,
    setStatus,
    setClickedSatelliteTransmitters,
} = satellitesSlice.actions;

export default satellitesSlice.reducer;
