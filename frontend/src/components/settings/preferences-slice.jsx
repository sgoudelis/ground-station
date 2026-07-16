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

import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';

const USER_DEFAULT_PREFERENCES = [
    { id: null, name: 'language', value: 'en_US' },
    { id: null, name: 'theme', value: 'auto' },
    { id: null, name: 'timezone', value: 'Europe/Athens' },
    { id: null, name: 'locale', value: 'browser' },
    { id: null, name: 'toast_position', value: 'bottom-center' },
    { id: null, name: 'stadia_maps_api_key', value: '' },
    { id: null, name: 'gemini_api_key', value: '' },
    { id: null, name: 'deepgram_api_key', value: '' },
    { id: null, name: 'google_translate_api_key', value: '' },
];

const SYSTEM_DEFAULT_PREFERENCES = [];

const USER_KEYS = new Set(USER_DEFAULT_PREFERENCES.map((preference) => preference.name));
const SYSTEM_KEYS = new Set(SYSTEM_DEFAULT_PREFERENCES.map((preference) => preference.name));

const clonePreferences = (preferences) => preferences.map((preference) => ({ ...preference }));

const mergeByName = (basePreferences, incomingPreferences) => {
    const merged = clonePreferences(basePreferences);
    const indexByName = new Map(merged.map((preference, index) => [preference.name, index]));

    (Array.isArray(incomingPreferences) ? incomingPreferences : []).forEach((incomingPreference) => {
        const name = String(incomingPreference?.name || '').trim();
        if (!name) {
            return;
        }

        const nextPreference = {
            id: incomingPreference?.id ?? null,
            name,
            value: incomingPreference?.value ?? '',
        };
        const existingIndex = indexByName.get(name);

        if (existingIndex === undefined) {
            indexByName.set(name, merged.length);
            merged.push(nextPreference);
            return;
        }

        merged[existingIndex] = {
            ...merged[existingIndex],
            ...nextPreference,
        };
    });

    return merged;
};

const combinePreferences = (userPreferences, systemPreferences) => [
    ...clonePreferences(userPreferences),
    ...clonePreferences(systemPreferences),
];

const updatePreferenceValue = (preferences, name, value) => {
    const existing = preferences.find((preference) => preference.name === name);
    if (existing) {
        existing.value = value;
        return;
    }
    preferences.push({ id: null, name, value });
};

export const fetchPreferences = createAsyncThunk(
    'preferences/fetchPreferences',
    async ({ socket }, { rejectWithValue }) =>
        new Promise((resolve, reject) => {
            socket.emit(
                'api.call',
                {
                    cmd: 'fetch-preferences',
                    data: null,
                },
                (response) => {
                    if (response?.success) {
                        resolve(response.data);
                        return;
                    }
                    reject(rejectWithValue('Could not fetch preferences'));
                }
            );
        })
);

export const updatePreferences = createAsyncThunk(
    'preferences/updatePreferences',
    async ({ socket }, { getState, rejectWithValue }) =>
        new Promise((resolve, reject) => {
            const userPreferences = getState().preferences.userPreferences;
            socket.emit(
                'api.call',
                {
                    cmd: 'update-preferences',
                    data: [...userPreferences],
                },
                (response) => {
                    if (response?.success) {
                        resolve(response.data);
                        return;
                    }
                    reject(rejectWithValue('Failed to set preferences'));
                }
            );
        })
);

export const fetchSystemPreferences = createAsyncThunk(
    'preferences/fetchSystemPreferences',
    async ({ socket }, { rejectWithValue }) =>
        new Promise((resolve, reject) => {
            socket.emit(
                'api.call',
                {
                    cmd: 'fetch-system-preferences',
                    data: null,
                },
                (response) => {
                    if (response?.success) {
                        resolve(response.data);
                        return;
                    }
                    reject(rejectWithValue('Could not fetch system preferences'));
                }
            );
        })
);

export const updateSystemPreferences = createAsyncThunk(
    'preferences/updateSystemPreferences',
    async ({ socket }, { getState, rejectWithValue }) =>
        new Promise((resolve, reject) => {
            const systemPreferences = getState().preferences.systemPreferences;
            socket.emit(
                'api.call',
                {
                    cmd: 'update-system-preferences',
                    data: [...systemPreferences],
                },
                (response) => {
                    if (response?.success) {
                        resolve(response.data);
                        return;
                    }
                    reject(rejectWithValue('Failed to set system preferences'));
                }
            );
        })
);

const initialUserPreferences = clonePreferences(USER_DEFAULT_PREFERENCES);
const initialSystemPreferences = clonePreferences(SYSTEM_DEFAULT_PREFERENCES);

const preferencesSlice = createSlice({
    name: 'preferences',
    initialState: {
        loading: false,
        userPreferences: initialUserPreferences,
        systemPreferences: initialSystemPreferences,
        preferences: combinePreferences(initialUserPreferences, initialSystemPreferences),
        status: 'idle',
        systemStatus: 'idle',
        error: null,
        systemError: null,
    },
    reducers: {
        setPreference: (state, action) => {
            const { name, value } = action.payload;
            if (!name) {
                return;
            }

            if (USER_KEYS.has(name)) {
                updatePreferenceValue(state.userPreferences, name, value);
            }
            if (SYSTEM_KEYS.has(name)) {
                updatePreferenceValue(state.systemPreferences, name, value);
            }
            state.preferences = combinePreferences(state.userPreferences, state.systemPreferences);
        },
        setLoading: (state, action) => {
            state.loading = action.payload;
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchPreferences.pending, (state) => {
                state.status = 'loading';
                state.error = null;
            })
            .addCase(fetchPreferences.fulfilled, (state, action) => {
                state.status = 'succeeded';
                state.userPreferences = mergeByName(USER_DEFAULT_PREFERENCES, action.payload);
                state.preferences = combinePreferences(state.userPreferences, state.systemPreferences);
            })
            .addCase(fetchPreferences.rejected, (state, action) => {
                state.status = 'failed';
                state.error = action.payload;
            })
            .addCase(updatePreferences.pending, (state) => {
                state.status = 'loading';
                state.error = null;
            })
            .addCase(updatePreferences.fulfilled, (state, action) => {
                state.status = 'succeeded';
                state.userPreferences = mergeByName(USER_DEFAULT_PREFERENCES, action.payload);
                state.preferences = combinePreferences(state.userPreferences, state.systemPreferences);
            })
            .addCase(updatePreferences.rejected, (state, action) => {
                state.status = 'failed';
                state.error = action.payload;
            })
            .addCase(fetchSystemPreferences.pending, (state) => {
                state.systemStatus = 'loading';
                state.systemError = null;
            })
            .addCase(fetchSystemPreferences.fulfilled, (state, action) => {
                state.systemStatus = 'succeeded';
                state.systemPreferences = mergeByName(SYSTEM_DEFAULT_PREFERENCES, action.payload);
                state.preferences = combinePreferences(state.userPreferences, state.systemPreferences);
            })
            .addCase(fetchSystemPreferences.rejected, (state, action) => {
                state.systemStatus = 'failed';
                state.systemError = action.payload;
            })
            .addCase(updateSystemPreferences.pending, (state) => {
                state.systemStatus = 'loading';
                state.systemError = null;
            })
            .addCase(updateSystemPreferences.fulfilled, (state, action) => {
                state.systemStatus = 'succeeded';
                state.systemPreferences = mergeByName(SYSTEM_DEFAULT_PREFERENCES, action.payload);
                state.preferences = combinePreferences(state.userPreferences, state.systemPreferences);
            })
            .addCase(updateSystemPreferences.rejected, (state, action) => {
                state.systemStatus = 'failed';
                state.systemError = action.payload;
            });
    },
});

export const {
    setPreference,
} = preferencesSlice.actions;

export default preferencesSlice.reducer;
