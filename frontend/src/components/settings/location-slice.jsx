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
import { toast } from '../../utils/toast-with-timestamp.jsx';
import {getMaidenhead} from '../common/common.jsx';

const STATION_TYPE_STATIONARY = 'stationary';
const STATION_TYPE_MOBILE = 'mobile';

const normalizeStationType = (value) => (
    String(value || '').trim().toLowerCase() === STATION_TYPE_MOBILE
        ? STATION_TYPE_MOBILE
        : STATION_TYPE_STATIONARY
);

const normalizeHorizonMask = (value) => {
    const parsed = Number.parseFloat(String(value ?? 0));
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(90, parsed));
};

const normalizeLocationPayload = (payload) => ({
    ...payload,
    station_type: normalizeStationType(payload?.station_type),
    horizon_mask: normalizeHorizonMask(payload?.horizon_mask),
});


export const fetchLocationForUserId = createAsyncThunk(
    'location/fetchLocationForUser',
    async ({socket, suppressNotFoundWarning = false}, {rejectWithValue}) => {
        return new Promise((resolve, reject) => {
            socket.emit("api.call", {
  cmd: 'get-locations',
  data: null
}, response => {
  if (response.success) {
    if (response.data && response.data.length > 0) {
      // Return the first location from the list
      resolve(response.data[0]);
    } else {
      if (!suppressNotFoundWarning) {
        toast.warning('No location found in the backend, please set one');
      }
      resolve(null); // or resolve({}) if no data
    }
  } else {
    toast.error('Failed to get location from backend');
    reject(rejectWithValue('Failed to get location'));
  }
});
        });
    }
);


export const storeLocation = createAsyncThunk(
    'location/handleSetLocation',
    async ({socket, location, altitude, locationId}, {rejectWithValue}) => {
        return new Promise((resolve, reject) => {
            const command = locationId ? 'edit-location' : 'submit-location';
            const normalizedName = String(location?.name || '').trim() || 'home';
            const normalizedCallsign = String(location?.callsign || '').trim().toUpperCase();
            const data = {
                ...location,
                alt: altitude,
                name: normalizedName,
                callsign: normalizedCallsign || null,
                station_type: normalizeStationType(location?.station_type),
                horizon_mask: normalizeHorizonMask(location?.horizon_mask),
            };
            if (locationId) {
                data.id = locationId;
            }

            socket.emit("api.call", {
  cmd: command,
  data: data
	}, response => {
	  if (response['success']) {
	    if (response.data && response.data.id) {
	      toast.success('Location set successfully');
	      resolve(response.data);
	      return;
	    }

	    // Defensive fallback for older backend replies that omit the saved row.
	    socket.emit("api.call", {
	  cmd: 'get-locations',
	  data: null
	}, fetchResponse => {
	  if (fetchResponse.success && fetchResponse.data && fetchResponse.data.length > 0) {
	    toast.success('Location set successfully');
	    resolve(fetchResponse.data[0]);
	  } else {
	    toast.error('Failed to set location');
	    reject(rejectWithValue('Failed to set location'));
	  }
	});
	  } else {
	    toast.error('Failed to set location');
	    reject(rejectWithValue('Failed to set location'));
	  }
	});
        });
    }
);


const locationSlice = createSlice({
    name: 'location',
    initialState: {
        locationSaving: false,
        locationLoading: false,
        location: null,
        altitude: 0,
        locationId: null,
        qth: '',
        polylines: [],
        error: null,
    },
    reducers: {
        setLocation: (state, action) => {
            state.location = action.payload;
        },
        setLocationId: (state, action) => {
            state.locationId = action.payload;
        },
        setQth: (state, action) => {
            state.qth = action.payload;
        },
        setPolylines: (state, action) => {
            state.polylines = action.payload;
        },
        setLocationLoading: (state, action) => {
            state.locationLoading = action.payload;
        },
        setLocationSaving: (state, action) => {
            state.locationSaving = action.payload;
        },
        setAltitude: (state, action) => {
            state.altitude = action.payload;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchLocationForUserId.pending, (state) => {
                state.locationLoading = true;
                state.error = null;
            })
            .addCase(fetchLocationForUserId.fulfilled, (state, action) => {
                state.locationLoading = false;
                if (action.payload) {
                    const payload = normalizeLocationPayload(action.payload);
                    state.location = payload;
                    state.locationId = payload.id;
                    state.altitude = payload.alt || 0;
                    state.qth = getMaidenhead(parseFloat(payload.lat), parseFloat(payload.lon));
                } else {
                    // If no location from backend, clear persisted location data
                    state.location = null;
                    state.locationId = null;
                    state.altitude = 0;
                    state.qth = '';
                }
            })
            .addCase(fetchLocationForUserId.rejected, (state, action) => {
                state.locationLoading = false;
                state.error = action.payload;
            })
            .addCase(storeLocation.pending, (state) => {
                state.error = null;
                state.locationSaving = true;
            })
            .addCase(storeLocation.fulfilled, (state, action) => {
                state.locationLoading = false;
                if (action.payload) {
                    const payload = normalizeLocationPayload(action.payload);
                    state.location = payload;
                    state.locationId = payload.id;
                    state.altitude = payload.alt || state.altitude;
                    state.qth = getMaidenhead(parseFloat(payload.lat), parseFloat(payload.lon));
                    state.locationSaving = false;
                }
            })
            .addCase(storeLocation.rejected, (state, action) => {
                state.locationLoading = false;
                state.error = action.payload;
                state.locationSaving = false;
            });
    },
});

export const {
    setLocation,
    setLocationId,
    setQth,
    setPolylines,
    setLocationLoading,
    setAltitude,
} = locationSlice.actions;

export default locationSlice.reducer;
