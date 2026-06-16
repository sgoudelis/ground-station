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

const AUTH_API_BASE = '/api/auth';

const parseErrorMessage = async (response, fallbackMessage = 'Request failed.') => {
    try {
        const payload = await response.json();
        return payload?.detail || payload?.error || fallbackMessage;
    } catch {
        return fallbackMessage;
    }
};

const buildHeaders = (token, hasJsonBody = false) => {
    const headers = {};
    if (hasJsonBody) {
        headers['Content-Type'] = 'application/json';
    }
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    return headers;
};

export const loadAuthStatus = createAsyncThunk(
    'auth/loadStatus',
    async (_unused, { getState, rejectWithValue }) => {
        const token = getState()?.auth?.token || null;
        try {
            const response = await fetch(`${AUTH_API_BASE}/status`, {
                method: 'GET',
                headers: buildHeaders(token, false),
            });
            if (!response.ok) {
                return rejectWithValue(await parseErrorMessage(response, 'Failed to get auth status.'));
            }
            return await response.json();
        } catch (error) {
            return rejectWithValue(error?.message || 'Failed to get auth status.');
        }
    }
);

export const loginUser = createAsyncThunk(
    'auth/login',
    async ({ username, password, keepSessionActive = false }, { rejectWithValue }) => {
        try {
            const response = await fetch(`${AUTH_API_BASE}/login`, {
                method: 'POST',
                headers: buildHeaders(null, true),
                body: JSON.stringify({
                    username,
                    password,
                    keep_session_active: Boolean(keepSessionActive),
                }),
            });
            if (!response.ok) {
                return rejectWithValue(await parseErrorMessage(response, 'Login failed.'));
            }
            return await response.json();
        } catch (error) {
            return rejectWithValue(error?.message || 'Login failed.');
        }
    }
);

export const setupAdmin = createAsyncThunk(
    'auth/setupAdmin',
    async ({ username, password }, { rejectWithValue }) => {
        try {
            const response = await fetch(`${AUTH_API_BASE}/setup-admin`, {
                method: 'POST',
                headers: buildHeaders(null, true),
                body: JSON.stringify({ username, password }),
            });
            if (!response.ok) {
                return rejectWithValue(
                    await parseErrorMessage(response, 'Failed to create initial admin account.')
                );
            }
            return await response.json();
        } catch (error) {
            return rejectWithValue(error?.message || 'Failed to create initial admin account.');
        }
    }
);

export const logoutUser = createAsyncThunk(
    'auth/logout',
    async (_unused, { getState }) => {
        const token = getState()?.auth?.token || null;
        if (!token) {
            return { success: true };
        }

        try {
            await fetch(`${AUTH_API_BASE}/logout`, {
                method: 'POST',
                headers: buildHeaders(token, false),
            });
        } catch {
            // Logout should still clear local auth state even when network request fails.
        }
        return { success: true };
    }
);

export const fetchUsers = createAsyncThunk(
    'auth/fetchUsers',
    async (_unused, { getState, rejectWithValue }) => {
        const token = getState()?.auth?.token || null;
        try {
            const response = await fetch(`${AUTH_API_BASE}/users`, {
                method: 'GET',
                headers: buildHeaders(token, false),
            });
            if (!response.ok) {
                return rejectWithValue(await parseErrorMessage(response, 'Failed to fetch users.'));
            }
            const payload = await response.json();
            return Array.isArray(payload?.data) ? payload.data : [];
        } catch (error) {
            return rejectWithValue(error?.message || 'Failed to fetch users.');
        }
    }
);

export const createUser = createAsyncThunk(
    'auth/createUser',
    async ({ username, password, role }, { getState, rejectWithValue }) => {
        const token = getState()?.auth?.token || null;
        try {
            const response = await fetch(`${AUTH_API_BASE}/users`, {
                method: 'POST',
                headers: buildHeaders(token, true),
                body: JSON.stringify({ username, password, role }),
            });
            if (!response.ok) {
                return rejectWithValue(await parseErrorMessage(response, 'Failed to create user.'));
            }
            const payload = await response.json();
            return payload?.data || null;
        } catch (error) {
            return rejectWithValue(error?.message || 'Failed to create user.');
        }
    }
);

export const updateUser = createAsyncThunk(
    'auth/updateUser',
    async ({ userId, role, isActive }, { getState, rejectWithValue }) => {
        const token = getState()?.auth?.token || null;
        try {
            const response = await fetch(`${AUTH_API_BASE}/users/${userId}`, {
                method: 'PATCH',
                headers: buildHeaders(token, true),
                body: JSON.stringify({ role, is_active: isActive }),
            });
            if (!response.ok) {
                return rejectWithValue(await parseErrorMessage(response, 'Failed to update user.'));
            }
            const payload = await response.json();
            return payload?.data || null;
        } catch (error) {
            return rejectWithValue(error?.message || 'Failed to update user.');
        }
    }
);

export const resetUserPassword = createAsyncThunk(
    'auth/resetUserPassword',
    async ({ userId, password }, { getState, rejectWithValue }) => {
        const token = getState()?.auth?.token || null;
        try {
            const response = await fetch(`${AUTH_API_BASE}/users/${userId}/reset-password`, {
                method: 'POST',
                headers: buildHeaders(token, true),
                body: JSON.stringify({ password }),
            });
            if (!response.ok) {
                return rejectWithValue(
                    await parseErrorMessage(response, 'Failed to reset user password.')
                );
            }
            const payload = await response.json();
            return payload?.data || null;
        } catch (error) {
            return rejectWithValue(error?.message || 'Failed to reset user password.');
        }
    }
);

export const deleteUser = createAsyncThunk(
    'auth/deleteUser',
    async ({ userId }, { getState, rejectWithValue }) => {
        const token = getState()?.auth?.token || null;
        try {
            const response = await fetch(`${AUTH_API_BASE}/users/${userId}`, {
                method: 'DELETE',
                headers: buildHeaders(token, false),
            });
            if (!response.ok) {
                return rejectWithValue(await parseErrorMessage(response, 'Failed to delete user.'));
            }
            const payload = await response.json();
            return payload?.data || { id: userId };
        } catch (error) {
            return rejectWithValue(error?.message || 'Failed to delete user.');
        }
    }
);

const authSlice = createSlice({
    name: 'auth',
    initialState: {
        token: null,
        user: null,
        station: null,
        authenticated: false,
        showLogoutConfirmation: true,
        setupRequired: false,
        statusInitialized: false,
        loadingStatus: true,
        loadingAction: false,
        users: [],
        usersLoading: false,
        error: null,
    },
    reducers: {
        clearAuthState: (state) => {
            state.token = null;
            state.user = null;
            state.authenticated = false;
            state.error = null;
        },
        setShowLogoutConfirmation: (state, action) => {
            state.showLogoutConfirmation = Boolean(action.payload);
        },
    },
    extraReducers: (builder) => {
        builder
            .addCase(loadAuthStatus.pending, (state) => {
                // Only the very first auth status bootstrap should block the app shell.
                if (!state.statusInitialized) {
                    state.loadingStatus = true;
                }
                state.error = null;
            })
            .addCase(loadAuthStatus.fulfilled, (state, action) => {
                const payload = action.payload || {};
                state.loadingStatus = false;
                state.statusInitialized = true;
                state.setupRequired = Boolean(payload.setup_required);
                state.authenticated = Boolean(payload.authenticated);
                state.user = payload.user || null;
                state.station = payload.station || null;

                if (!state.authenticated) {
                    state.token = null;
                }
            })
            .addCase(loadAuthStatus.rejected, (state, action) => {
                state.loadingStatus = false;
                state.statusInitialized = true;
                state.authenticated = false;
                state.user = null;
                state.station = null;
                state.token = null;
                state.error = action.payload || action.error?.message || 'Failed to load auth status.';
            })
            .addCase(loginUser.pending, (state) => {
                state.loadingAction = true;
                state.error = null;
            })
            .addCase(loginUser.fulfilled, (state, action) => {
                state.loadingAction = false;
                state.setupRequired = false;
                state.authenticated = true;
                state.token = action.payload?.token || null;
                state.user = action.payload?.user || null;
            })
            .addCase(loginUser.rejected, (state, action) => {
                state.loadingAction = false;
                state.error = action.payload || action.error?.message || 'Login failed.';
            })
            .addCase(setupAdmin.pending, (state) => {
                state.loadingAction = true;
                state.error = null;
            })
            .addCase(setupAdmin.fulfilled, (state, action) => {
                state.loadingAction = false;
                state.setupRequired = false;
                state.authenticated = true;
                state.token = action.payload?.token || null;
                state.user = action.payload?.user || null;
            })
            .addCase(setupAdmin.rejected, (state, action) => {
                state.loadingAction = false;
                state.error =
                    action.payload || action.error?.message || 'Failed to create initial admin account.';
            })
            .addCase(logoutUser.pending, (state) => {
                state.loadingAction = true;
            })
            .addCase(logoutUser.fulfilled, (state) => {
                state.loadingAction = false;
                state.authenticated = false;
                state.token = null;
                state.user = null;
            })
            .addCase(logoutUser.rejected, (state) => {
                state.loadingAction = false;
                state.authenticated = false;
                state.token = null;
                state.user = null;
            })
            .addCase(fetchUsers.pending, (state) => {
                state.usersLoading = true;
                state.error = null;
            })
            .addCase(fetchUsers.fulfilled, (state, action) => {
                state.usersLoading = false;
                state.users = Array.isArray(action.payload) ? action.payload : [];
            })
            .addCase(fetchUsers.rejected, (state, action) => {
                state.usersLoading = false;
                state.error = action.payload || action.error?.message || 'Failed to fetch users.';
            })
            .addCase(createUser.fulfilled, (state, action) => {
                const created = action.payload;
                if (!created) return;
                state.users = [...state.users, created];
            })
            .addCase(updateUser.fulfilled, (state, action) => {
                const updated = action.payload;
                if (!updated) return;
                state.users = state.users.map((user) => (user.id === updated.id ? updated : user));
            })
            .addCase(resetUserPassword.fulfilled, (state, action) => {
                const updated = action.payload;
                if (!updated) return;
                state.users = state.users.map((user) => (user.id === updated.id ? updated : user));
            })
            .addCase(deleteUser.fulfilled, (state, action) => {
                const deleted = action.payload;
                if (!deleted?.id) return;
                state.users = state.users.filter((user) => user.id !== deleted.id);
            })
            .addMatcher(
                (action) =>
                    action.type === createUser.pending.type ||
                    action.type === updateUser.pending.type ||
                    action.type === resetUserPassword.pending.type ||
                    action.type === deleteUser.pending.type,
                (state) => {
                    // Keep the users table and dialogs in sync with in-flight user-management requests.
                    state.loadingAction = true;
                    state.error = null;
                }
            )
            .addMatcher(
                (action) =>
                    action.type === createUser.fulfilled.type ||
                    action.type === updateUser.fulfilled.type ||
                    action.type === resetUserPassword.fulfilled.type ||
                    action.type === deleteUser.fulfilled.type,
                (state) => {
                    state.loadingAction = false;
                    state.error = null;
                }
            )
            .addMatcher(
                (action) =>
                    action.type === createUser.rejected.type ||
                    action.type === updateUser.rejected.type ||
                    action.type === resetUserPassword.rejected.type ||
                    action.type === deleteUser.rejected.type,
                (state, action) => {
                    state.loadingAction = false;
                    state.error = action.payload || action.error?.message || 'Auth operation failed.';
                }
            );
    },
});

export const { clearAuthState, setShowLogoutConfirmation } = authSlice.actions;
export default authSlice.reducer;
