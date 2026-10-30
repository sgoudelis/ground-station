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

const callLibrary = (socket, cmd, data) => new Promise((resolve, reject) => {
    if (!socket?.connected) {
        reject(new Error('Not connected to server'));
        return;
    }
    socket.emit('api.call', { cmd, data }, (result) => {
        if (result?.success) {
            resolve(result.data);
        } else {
            reject(new Error(result?.error || 'Library request failed'));
        }
    });
});

// The backend owns filtering, sorting and pagination.  This keeps the browser
// response bounded even when the storage library contains many artifacts.
export const fetchFiles = createAsyncThunk(
    'filebrowser/fetchFiles',
    async ({ socket, filters, search = '', sortBy = 'captured_at', sortOrder = 'desc', page = 1, pageSize = 25, reconcile = false }, { rejectWithValue }) => {
        try {
            // An explicit refresh must discover files copied outside the app;
            // ordinary paging and sorting can keep using the cached inventory.
            if (reconcile) await callLibrary(socket, 'filebrowser.reconcile', {});
            return await callLibrary(socket, 'filebrowser.query', {
                filters,
                search,
                sortBy,
                sortOrder,
                page,
                pageSize,
            });
        } catch (error) {
            return rejectWithValue(error.message || 'Failed to fetch files');
        }
    }
);

// The sidebar notification must inspect the newest library item independently
// of the user's current File Browser filters, sort order, and page.
export const checkForNewFiles = createAsyncThunk(
    'filebrowser/checkForNewFiles',
    async ({ socket }, { rejectWithValue }) => {
        try {
            return await callLibrary(socket, 'filebrowser.query', {
                sortBy: 'created',
                sortOrder: 'desc',
                page: 1,
                pageSize: 1,
            });
        } catch (error) {
            return rejectWithValue(error.message || 'Failed to check for new files');
        }
    }
);

export const fetchFileDetails = createAsyncThunk(
    'filebrowser/fetchFileDetails',
    async ({ socket, id }, { rejectWithValue }) => {
        try {
            return await callLibrary(socket, 'filebrowser.item', { id });
        } catch (error) {
            return rejectWithValue(error.message || 'Failed to fetch file details');
        }
    }
);

// SigMF playback must not depend on the File Browser's currently enabled
// filters. It has its own complete recording inventory for the SDR selector.
export const fetchPlaybackRecordings = createAsyncThunk(
    'filebrowser/fetchPlaybackRecordings',
    async ({ socket }, { rejectWithValue }) => {
        try {
            socket.emit("api.call", {
  cmd: "filebrowser.list-recordings",
  data: {}
});
            return { pending: true };
        } catch (error) {
            return rejectWithValue(error.message || 'Failed to fetch playback recordings');
        }
    }
);

// Async thunk to delete a recording
// Note: This now uses pub/sub model - response comes via 'file_browser_state' event
export const deleteRecording = createAsyncThunk(
    'filebrowser/deleteRecording',
    async ({ socket, name }, { rejectWithValue }) => {
        try {
            // Emit request without callback - response will come via 'file_browser_state' event
            socket.emit("api.call", {
  cmd: "filebrowser.delete-recording",
  data: {
    name
  }
});

            // Return the name for optimistic updates if needed
            return { name, pending: true };
        } catch (error) {
            return rejectWithValue(error.message || 'Failed to delete recording');
        }
    }
);

// Async thunk to delete a snapshot
// Note: This now uses pub/sub model - response comes via 'file_browser_state' event
export const deleteSnapshot = createAsyncThunk(
    'filebrowser/deleteSnapshot',
    async ({ socket, filename }, { rejectWithValue }) => {
        try {
            // Emit request without callback - response will come via 'file_browser_state' event
            socket.emit("api.call", {
  cmd: "filebrowser.delete-snapshot",
  data: {
    filename
  }
});

            // Return the filename for optimistic updates if needed
            return { filename, pending: true };
        } catch (error) {
            return rejectWithValue(error.message || 'Failed to delete snapshot');
        }
    }
);

// Async thunk to delete a decoded file or folder
// Note: This now uses pub/sub model - response comes via 'file_browser_state' event
export const deleteDecoded = createAsyncThunk(
    'filebrowser/deleteDecoded',
    async ({ socket, filename, foldername, is_folder }, { rejectWithValue }) => {
        try {
            // Emit request without callback - response will come via 'file_browser_state' event
            socket.emit("api.call", {
  cmd: "filebrowser.delete-decoded",
  data: {
    filename,
    foldername,
    is_folder
  }
});

            // Return the identifier for optimistic updates if needed
            return { filename, foldername, is_folder, pending: true };
        } catch (error) {
            return rejectWithValue(error.message || 'Failed to delete decoded file/folder');
        }
    }
);

// Async thunk to delete one complete automated-observation bundle.
export const deleteObservationBundle = createAsyncThunk(
    'filebrowser/deleteObservationBundle',
    async ({ socket, foldername }, { rejectWithValue }) => {
        try {
            socket.emit("api.call", {
                cmd: "filebrowser.delete-observation-bundle",
                data: { foldername }
            });
            return { foldername, pending: true };
        } catch (error) {
            return rejectWithValue(error.message || 'Failed to delete observation bundle');
        }
    }
);

// Async thunk to delete an audio file
// Note: This now uses pub/sub model - response comes via 'file_browser_state' event
export const deleteAudio = createAsyncThunk(
    'filebrowser/deleteAudio',
    async ({ socket, filename }, { rejectWithValue }) => {
        try {
            // Emit request without callback - response will come via 'file_browser_state' event
            socket.emit("api.call", {
  cmd: "filebrowser.delete-audio",
  data: {
    filename
  }
});

            // Return the filename for optimistic updates if needed
            return { filename, pending: true };
        } catch (error) {
            return rejectWithValue(error.message || 'Failed to delete audio file');
        }
    }
);

// Async thunk to delete a transcription file
// Note: This now uses pub/sub model - response comes via 'file_browser_state' event
export const deleteTranscription = createAsyncThunk(
    'filebrowser/deleteTranscription',
    async ({ socket, filename }, { rejectWithValue }) => {
        try {
            // Emit request without callback - response will come via 'file_browser_state' event
            socket.emit("api.call", {
  cmd: "filebrowser.delete-transcription",
  data: {
    filename
  }
});

            // Return the filename for optimistic updates if needed
            return { filename, pending: true };
        } catch (error) {
            return rejectWithValue(error.message || 'Failed to delete transcription file');
        }
    }
);

// Async thunk to delete multiple items (batch delete)
export const deleteBatch = createAsyncThunk(
    'filebrowser/deleteBatch',
    async ({ socket, items }, { rejectWithValue }) => {
        try {
            // Emit request without callback - response will come via 'file_browser_state' event
            socket.emit("api.call", {
  cmd: "filebrowser.delete-batch",
  data: {
    items
  }
});

            // Return the items for optimistic updates if needed
            return { items, pending: true };
        } catch (error) {
            return rejectWithValue(error.message || 'Failed to delete items');
        }
    }
);

// Mutations use the command acknowledgement, rather than a later broadcast,
// so failed deletions cannot disappear from the initiating browser.
export const deleteLibraryItems = createAsyncThunk(
    'filebrowser/deleteLibraryItems',
    async ({ socket, ids }, { rejectWithValue }) => {
        try {
            const result = await callLibrary(socket, 'filebrowser.delete', { ids });
            const failures = result.results?.filter((entry) => !entry.success) || [];
            if (failures.length) {
                throw new Error(failures.map((entry) => entry.error || entry.id).join(', '));
            }
            return result;
        } catch (error) {
            return rejectWithValue(error.message || 'Failed to delete library items');
        }
    }
);

// Aggregate what a date-based purge would remove, without deleting anything.
export const fetchPurgePreview = createAsyncThunk(
    'filebrowser/fetchPurgePreview',
    async ({ socket, cutoff }, { rejectWithValue }) => {
        try {
            return await callLibrary(socket, 'filebrowser.purge-preview', { cutoff });
        } catch (error) {
            return rejectWithValue(error.message || 'Failed to compute purge preview');
        }
    }
);

// Start a date-based purge; execution streams via library_purge_* events.
export const startLibraryPurge = createAsyncThunk(
    'filebrowser/startLibraryPurge',
    async ({ socket, cutoff }, { rejectWithValue }) => {
        try {
            return await callLibrary(socket, 'filebrowser.purge', { cutoff });
        } catch (error) {
            return rejectWithValue(error.message || 'Failed to start purge');
        }
    }
);

// Async thunk to start a background task via Socket.IO
export const startBackgroundTask = createAsyncThunk(
    'filebrowser/startBackgroundTask',
    async ({ socket, task_name, args = [], kwargs = {}, name, task_id }, { rejectWithValue }) => {
        try {
            const response = await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: "background-task.start",
  data: {
    task_name,
    args,
    kwargs,
    name,
    task_id
  }
}, result => {
  if (result?.success) {
    resolve(result);
  } else {
    reject(new Error(result?.error || 'Unknown error'));
  }
});
            });
            return response;
        } catch (error) {
            return rejectWithValue(error.message || 'Failed to start background task');
        }
    }
);

const initialState = {
    // All library items, including observation bundles.
    files: [],
    filesLoading: false,
    filesError: null,
    filesRequestId: null,
    playbackRecordings: [],
    playbackRecordingsLoading: false,
    playbackRecordingsError: null,
    page: 1,
    pageSize: 10,
    total: 0,
    // Retained while navigating within the app, without hiding files after a reload.
    search: '',
    sortBy: 'captured_at',
    sortOrder: 'desc',
    filters: {
        showRecordings: true,
        showSnapshots: true,
        showDecoded: true,
        showObservations: true,
        showAudio: true,
        showTranscriptions: true,
    },
    diskUsage: {
        total: 0,
        used: 0,
        available: 0,
    },
    // Multi-select state
    selectedItems: [], // Array of item keys (recording names or snapshot/decoded/audio/transcription filenames)
    selectionMode: false, // Toggle for selection mode
    // New files indicator
    lastVisitedTimestamp: new Date().toISOString(), // ISO timestamp - initialized to app start time
    hasNewFiles: false, // Flag indicating if new files were added since last visit
    // View mode
    viewMode: 'table', // 'card' or 'table'
    // Date-based purge dialog state
    purge: {
        preview: null, // latest aggregate from filebrowser.purge-preview
        previewLoading: false,
        previewError: null,
        previewRequestId: null,
        running: false, // a purge sweep is currently in flight
        progress: null, // latest library_purge_progress event
        done: null, // latest library_purge_done event
    },
};

export function reconcileFileBrowserPersistedState(inboundState, currentState) {
    if (!inboundState) return currentState;
    const savedFilters = inboundState.filters || {};
    return {
        ...currentState,
        ...inboundState,
        // Move the former default to portable capture chronology on upgrade.
        sortBy: inboundState.sortBy === 'created' ? 'captured_at'
            : inboundState.sortBy || currentState.sortBy,
        filters: {
            ...currentState.filters,
            ...savedFilters,
            // Before Observations had its own switch, the Decoded switch
            // controlled both. Preserve that choice on first rehydration.
            showObservations: savedFilters.showObservations
                ?? savedFilters.showDecoded
                ?? currentState.filters.showObservations,
        },
    };
}

const fileBrowserSlice = createSlice({
    name: 'filebrowser',
    initialState,
    reducers: {
        setSearch: (state, action) => {
            const search = action.payload.trim().replace(/\s+/g, ' ');
            if (state.search === search) return;
            state.search = search;
            state.page = 1;
            state.selectedItems = [];
            // Invalidate immediately, before the effect starts the next request.
            // An older query on page 1 must not replace the new search results.
            state.filesRequestId = null;
        },
        setSortBy: (state, action) => {
            state.sortBy = action.payload;
            state.page = 1; // Reset to first page when sort changes
        },
        toggleSortOrder: (state) => {
            state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
            state.page = 1; // Reset to first page when sort order changes
        },
        setPage: (state, action) => {
            state.page = action.payload;
        },
        setPageSize: (state, action) => {
            const size = Number(action.payload);
            if (Number.isFinite(size) && size > 0 && state.pageSize !== size) {
                state.pageSize = size;
                state.page = 1;
            }
        },
        setFilter: (state, action) => {
            const { filter, value } = action.payload;
            state.filters[filter] = value;
            state.page = 1; // Reset to first page when filter changes
        },
        toggleFilter: (state, action) => {
            const filter = action.payload;
            state.filters[filter] = !state.filters[filter];
            state.page = 1; // Reset to first page when filter changes
        },
        setAllFilters: (state, action) => {
            const enabled = Boolean(action.payload);
            Object.keys(state.filters).forEach((filter) => {
                state.filters[filter] = enabled;
            });
            state.page = 1;
        },
        // Legacy action for backward compatibility - triggers refetch
        handleFileChange: (state, action) => {
            // This is called when backend emits file change events
            // The actual refetch is handled in component useEffect
        },
        // Multi-select actions
        toggleItemSelection: (state, action) => {
            const key = action.payload;
            const index = state.selectedItems.indexOf(key);
            if (index >= 0) {
                state.selectedItems.splice(index, 1);
            } else {
                state.selectedItems.push(key);
            }
        },
        selectAllItems: (state, action) => {
            // Payload contains all current displayable item keys
            state.selectedItems = action.payload;
        },
        clearSelection: (state) => {
            state.selectedItems = [];
        },
        toggleSelectionMode: (state) => {
            state.selectionMode = !state.selectionMode;
            if (!state.selectionMode) {
                state.selectedItems = [];
            }
        },
        // Mark file browser as visited - clears new files indicator
        markFileBrowserVisited: (state) => {
            state.lastVisitedTimestamp = new Date().toISOString();
            state.hasNewFiles = false;
        },
        // Keep this action available for direct notification updates.
        setHasNewFiles: (state, action) => {
            state.hasNewFiles = action.payload;
        },
        // View mode actions
        setViewMode: (state, action) => {
            state.viewMode = action.payload;
        },
        setPlaybackRecordings: (state, action) => {
            state.playbackRecordings = action.payload || [];
            state.playbackRecordingsLoading = false;
            state.playbackRecordingsError = null;
        },
        // Streamed purge progress from socket broadcasts (see useSocketEventHandlers)
        purgeProgressUpdated: (state, action) => {
            state.purge.progress = action.payload;
            state.purge.running = true;
            state.purge.done = null;
        },
        purgeFinished: (state, action) => {
            state.purge.running = false;
            state.purge.progress = null;
            state.purge.done = action.payload;
            // The completed sweep invalidates both the visible preview and
            // any earlier preview reply still in flight.
            state.purge.preview = null;
            state.purge.previewLoading = false;
            state.purge.previewError = null;
            state.purge.previewRequestId = null;
        },
        clearPurgeState: (state) => {
            state.purge.preview = null;
            state.purge.previewLoading = false;
            state.purge.previewError = null;
            state.purge.previewRequestId = null;
            // Reopening the dialog must not erase a sweep already in flight.
            if (!state.purge.running) {
                state.purge.progress = null;
                state.purge.done = null;
            }
        },
    },
    extraReducers: (builder) => {
        // Server-side paged query
        builder.addCase(fetchFiles.pending, (state, action) => {
            state.filesRequestId = action.meta.requestId;
            state.filesLoading = true;
            state.filesError = null;
        });
        builder.addCase(fetchFiles.fulfilled, (state, action) => {
            // Page requests may finish out of order, or after a new page was
            // selected but before its request starts. Ignore either stale reply.
            if (state.filesRequestId !== action.meta.requestId || state.page !== action.meta.arg.page
                || state.search !== (action.meta.arg.search || '')) return;
            state.filesRequestId = null;
            state.filesLoading = false;
            state.files = action.payload.items || [];
            state.total = action.payload.total || 0;
            state.page = action.payload.page || state.page;
            state.diskUsage = action.payload.diskUsage || { total: 0, used: 0, available: 0 };
        });
        builder.addCase(checkForNewFiles.fulfilled, (state, action) => {
            const newest = action.payload?.items?.[0];
            const createdAt = Date.parse(newest?.created || newest?.start_time || '');
            const lastVisitedAt = Date.parse(state.lastVisitedTimestamp || '');
            // Only a confirmed newer item may turn the badge on. Older or
            // delayed checks must not clear a pending notification.
            if (Number.isFinite(createdAt) && Number.isFinite(lastVisitedAt)
                && createdAt > lastVisitedAt) {
                state.hasNewFiles = true;
            }
        });
        builder.addCase(fetchFiles.rejected, (state, action) => {
            if (state.filesRequestId !== action.meta.requestId || state.page !== action.meta.arg.page
                || state.search !== (action.meta.arg.search || '')) return;
            state.filesRequestId = null;
            state.filesLoading = false;
            state.filesError = action.payload || 'Failed to fetch files';
        });
        builder.addCase(fetchPlaybackRecordings.pending, (state) => {
            state.playbackRecordingsLoading = true;
            state.playbackRecordingsError = null;
        });
        builder.addCase(fetchPlaybackRecordings.rejected, (state, action) => {
            state.playbackRecordingsLoading = false;
            state.playbackRecordingsError = action.payload || 'Failed to fetch playback recordings';
        });

        builder.addCase(deleteLibraryItems.fulfilled, (state, action) => {
            const deletedIds = new Set(
                (action.payload.results || [])
                    .filter((entry) => entry.success)
                    .map((entry) => entry.id)
            );
            state.files = state.files.filter((file) => !deletedIds.has(file.id));
            state.total = Math.max(0, state.total - deletedIds.size);
            state.selectedItems = state.selectedItems.filter((id) => !deletedIds.has(id));
        });

        builder.addCase(fetchPurgePreview.pending, (state, action) => {
            state.purge.previewLoading = true;
            state.purge.previewError = null;
            state.purge.previewRequestId = action.meta.requestId;
        });
        builder.addCase(fetchPurgePreview.fulfilled, (state, action) => {
            if (state.purge.previewRequestId !== action.meta.requestId) return;
            state.purge.previewLoading = false;
            state.purge.preview = action.payload;
            state.purge.previewRequestId = null;
        });
        builder.addCase(fetchPurgePreview.rejected, (state, action) => {
            if (state.purge.previewRequestId !== action.meta.requestId) return;
            state.purge.previewLoading = false;
            state.purge.previewError = action.payload || 'Failed to compute purge preview';
            state.purge.previewRequestId = null;
        });

        builder.addCase(startLibraryPurge.pending, (state) => {
            state.purge.running = true;
            state.purge.progress = null;
            state.purge.done = null;
        });
        builder.addCase(startLibraryPurge.fulfilled, (state) => {
            // The acknowledgement only confirms the sweep started; terminal
            // event may have arrived before it for a very short sweep.
            if (!state.purge.done) state.purge.running = true;
        });
        builder.addCase(startLibraryPurge.rejected, (state) => {
            // The initiating dialog surfaces the rejection toast itself.
            state.purge.running = false;
        });

        // Delete recording - optimistic update
        builder.addCase(deleteRecording.fulfilled, (state, action) => {
            // Remove from files list
            state.files = state.files.filter(f => !(f.type === 'recording' && f.name === action.payload.name));
            // Update total count
            state.total = Math.max(0, state.total - 1);
        });

        // Delete snapshot - optimistic update
        builder.addCase(deleteSnapshot.fulfilled, (state, action) => {
            // Remove from files list
            state.files = state.files.filter(f => !(f.type === 'snapshot' && f.filename === action.payload.filename));
            // Update total count
            state.total = Math.max(0, state.total - 1);
        });

        // Delete decoded - optimistic update
        builder.addCase(deleteDecoded.fulfilled, (state, action) => {
            // Remove from files list (handle both files and folders)
            if (action.payload.is_folder) {
                state.files = state.files.filter(f => !(f.type === 'decoded_folder' && f.foldername === action.payload.foldername));
            } else {
                state.files = state.files.filter(f => !(f.type === 'decoded' && f.filename === action.payload.filename));
            }
            // Update total count
            state.total = Math.max(0, state.total - 1);
        });

        builder.addCase(deleteObservationBundle.fulfilled, (state, action) => {
            state.files = state.files.filter(f => !(
                f.type === 'decoded_folder'
                && f.folder_kind === 'observation'
                && f.foldername === action.payload.foldername
            ));
            state.total = Math.max(0, state.total - 1);
        });

        // Delete audio - optimistic update
        builder.addCase(deleteAudio.fulfilled, (state, action) => {
            // Remove from files list
            state.files = state.files.filter(f => !(f.type === 'audio' && f.filename === action.payload.filename));
            // Update total count
            state.total = Math.max(0, state.total - 1);
        });

        // Delete transcription - optimistic update
        builder.addCase(deleteTranscription.fulfilled, (state, action) => {
            // Remove from files list
            state.files = state.files.filter(f => !(f.type === 'transcription' && f.filename === action.payload.filename));
            // Update total count
            state.total = Math.max(0, state.total - 1);
        });

        // Delete batch - optimistic update
        builder.addCase(deleteBatch.fulfilled, (state, action) => {
            const itemsToDelete = action.payload.items;
            // Remove all items in the batch
            state.files = state.files.filter(f => {
                const key = f.type === 'recording'
                    ? f.name
                    : (f.type === 'decoded_folder' ? f.foldername : f.filename);
                return !itemsToDelete.find(item =>
                    (item.type === f.type || (item.type === 'observation_bundle' && f.folder_kind === 'observation')) && (
                        (item.type === 'recording' && item.name === key) ||
                        (item.type === 'snapshot' && item.filename === key) ||
                        (item.type === 'decoded' && item.filename === key) ||
                        (item.type === 'decoded_folder' && item.foldername === key) ||
                        (item.type === 'observation_bundle' && item.foldername === key) ||
                        (item.type === 'audio' && item.filename === key) ||
                        (item.type === 'transcription' && item.filename === key)
                    )
                );
            });
            // Update total count
            state.total = Math.max(0, state.total - itemsToDelete.length);
            // Clear selection after batch delete
            state.selectedItems = [];
        });
    },
});

export const {
    setSearch,
    setSortBy,
    toggleSortOrder,
    setPage,
    setPageSize,
    setFilter,
    toggleFilter,
    setAllFilters,
    handleFileChange,
    toggleItemSelection,
    selectAllItems,
    clearSelection,
    toggleSelectionMode,
    markFileBrowserVisited,
    setHasNewFiles,
    setViewMode,
    setPlaybackRecordings,
    purgeProgressUpdated,
    purgeFinished,
    clearPurgeState,
} = fileBrowserSlice.actions;

export default fileBrowserSlice.reducer;
