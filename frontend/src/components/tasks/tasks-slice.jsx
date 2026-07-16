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

const normalizeTaskStatus = (status) => {
    const normalized = String(status || '').toLowerCase();
    if (['running', 'completed', 'failed', 'stopped'].includes(normalized)) {
        return normalized;
    }
    return 'completed';
};

export const stopBackgroundTask = createAsyncThunk(
    'backgroundTasks/stopBackgroundTask',
    async ({ socket, task_id, timeout = 5.0 }, { rejectWithValue }) => {
        try {
            const response = await new Promise((resolve, reject) => {
                socket.emit("api.call", {
  cmd: "background-task.stop",
  data: {
    task_id,
    timeout
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
            return rejectWithValue(error.message || 'Failed to stop background task');
        }
    }
);

const initialState = {
    tasks: {}, // { task_id: TaskInfo }
    runningTaskIds: [], // Array of running task IDs
    completedTaskIds: [], // Array of recently completed task IDs
};

const tasksSlice = createSlice({
    name: 'backgroundTasks',
    initialState,
    reducers: {
        taskStarted: (state, action) => {
            const { task_id, name, command, args, pid, start_time } = action.payload;
            state.tasks[task_id] = {
                task_id,
                name,
                command,
                args,
                pid,
                start_time,
                status: 'running',
                output_lines: [],
                progress: 0,
                end_time: null,
                return_code: null,
            };
            if (!state.runningTaskIds.includes(task_id)) {
                state.runningTaskIds.push(task_id);
            }
            // Remove from completed if it was there
            state.completedTaskIds = state.completedTaskIds.filter(id => id !== task_id);
        },

        taskProgress: (state, action) => {
            const { task_id, stream, output, progress } = action.payload;
            if (state.tasks[task_id]) {
                // Initialize output_lines if it doesn't exist
                if (!state.tasks[task_id].output_lines) {
                    state.tasks[task_id].output_lines = [];
                }
                state.tasks[task_id].output_lines.push({ stream, output, timestamp: Date.now() });
                // Keep only last 1000 lines to avoid memory issues
                if (state.tasks[task_id].output_lines.length > 1000) {
                    state.tasks[task_id].output_lines.shift();
                }
                // Update progress if provided
                if (progress !== undefined && progress !== null) {
                    state.tasks[task_id].progress = progress;
                }
            }
        },

        taskCompleted: (state, action) => {
            const { task_id, status, return_code, duration } = action.payload;
            if (!state.tasks[task_id]) {
                state.tasks[task_id] = {
                    task_id,
                    name: action.payload?.name || task_id,
                    command: '',
                    args: [],
                    pid: null,
                    start_time: Date.now() / 1000,
                    status: 'completed',
                    output_lines: [],
                    progress: 100,
                    end_time: Date.now(),
                    return_code,
                    duration,
                };
            } else {
                state.tasks[task_id].status = status;
                state.tasks[task_id].return_code = return_code;
                state.tasks[task_id].end_time = Date.now();
                state.tasks[task_id].duration = duration;
            }

            // Move from running to completed, even if task entry arrived out-of-order.
            state.runningTaskIds = state.runningTaskIds.filter(id => id !== task_id);
            if (!state.completedTaskIds.includes(task_id)) {
                state.completedTaskIds.unshift(task_id);
                // Keep only last 20 completed tasks
                if (state.completedTaskIds.length > 20) {
                    const removed = state.completedTaskIds.pop();
                    delete state.tasks[removed];
                }
            }
        },

        taskStopped: (state, action) => {
            const { task_id, duration } = action.payload;
            if (!state.tasks[task_id]) {
                state.tasks[task_id] = {
                    task_id,
                    name: action.payload?.name || task_id,
                    command: '',
                    args: [],
                    pid: null,
                    start_time: Date.now() / 1000,
                    status: 'stopped',
                    output_lines: [],
                    progress: 100,
                    end_time: Date.now(),
                    return_code: null,
                    duration,
                };
            } else {
                state.tasks[task_id].status = 'stopped';
                state.tasks[task_id].end_time = Date.now();
                state.tasks[task_id].duration = duration;
            }

            // Move from running to completed, even if task entry arrived out-of-order.
            state.runningTaskIds = state.runningTaskIds.filter(id => id !== task_id);
            if (!state.completedTaskIds.includes(task_id)) {
                state.completedTaskIds.unshift(task_id);
                // Keep only last 20 completed tasks
                if (state.completedTaskIds.length > 20) {
                    const removed = state.completedTaskIds.pop();
                    delete state.tasks[removed];
                }
            }
        },

        taskError: (state, action) => {
            const { task_id, error } = action.payload;
            if (!state.tasks[task_id]) {
                state.tasks[task_id] = {
                    task_id,
                    name: action.payload?.name || task_id,
                    command: '',
                    args: [],
                    pid: null,
                    start_time: Date.now() / 1000,
                    status: 'failed',
                    output_lines: [],
                    progress: 100,
                    end_time: Date.now(),
                    return_code: null,
                    duration: null,
                    error,
                };
            } else {
                state.tasks[task_id].error = error;
                state.tasks[task_id].status = 'failed';
                state.tasks[task_id].end_time = state.tasks[task_id].end_time || Date.now();
                state.tasks[task_id].progress = state.tasks[task_id].progress ?? 100;
            }

            state.runningTaskIds = state.runningTaskIds.filter(id => id !== task_id);
            if (!state.completedTaskIds.includes(task_id)) {
                state.completedTaskIds.unshift(task_id);
                if (state.completedTaskIds.length > 20) {
                    const removed = state.completedTaskIds.pop();
                    delete state.tasks[removed];
                }
            }
        },

        reconcileTaskSnapshot: (state, action) => {
            const incomingTasks = Array.isArray(action.payload?.tasks)
                ? action.payload.tasks
                : Array.isArray(action.payload)
                    ? action.payload
                    : [];
            const incomingById = {};
            const incomingRunningIds = new Set();

            incomingTasks.forEach((task) => {
                if (!task || !task.task_id) return;
                const normalizedStatus = normalizeTaskStatus(task.status);
                const normalizedTask = {
                    ...task,
                    status: normalizedStatus,
                };
                incomingById[task.task_id] = normalizedTask;
                if (normalizedStatus === 'running') {
                    incomingRunningIds.add(task.task_id);
                }
            });

            // Rehydrate all running tasks from backend so reconnects can restore visibility.
            Object.values(incomingById).forEach((incomingTask) => {
                const existingTask = state.tasks[incomingTask.task_id];
                const shouldHydrate = incomingTask.status === 'running' || Boolean(existingTask);
                if (!shouldHydrate) return;

                state.tasks[incomingTask.task_id] = {
                    task_id: incomingTask.task_id,
                    name: incomingTask.name || existingTask?.name || incomingTask.task_id,
                    command: incomingTask.command || existingTask?.command || '',
                    args: incomingTask.args || existingTask?.args || [],
                    pid: incomingTask.pid ?? existingTask?.pid ?? null,
                    start_time: incomingTask.start_time ?? existingTask?.start_time ?? Date.now() / 1000,
                    status: incomingTask.status,
                    output_lines: existingTask?.output_lines || [],
                    progress: incomingTask.progress ?? existingTask?.progress ?? 0,
                    end_time: incomingTask.end_time ?? existingTask?.end_time ?? null,
                    return_code: incomingTask.return_code ?? existingTask?.return_code ?? null,
                    duration: incomingTask.duration ?? existingTask?.duration,
                    error: existingTask?.error,
                };
            });

            // If a previously running task is no longer reported as running by backend,
            // force it out of running state to avoid stale stop controls in the UI.
            state.runningTaskIds.forEach((task_id) => {
                if (incomingRunningIds.has(task_id)) return;

                const incomingTask = incomingById[task_id];
                if (incomingTask && state.tasks[task_id]) {
                    state.tasks[task_id] = {
                        ...state.tasks[task_id],
                        ...incomingTask,
                        status: incomingTask.status,
                        output_lines: state.tasks[task_id].output_lines || [],
                        progress: incomingTask.progress ?? state.tasks[task_id].progress ?? 100,
                    };
                    return;
                }

                if (state.tasks[task_id]) {
                    state.tasks[task_id].status = 'completed';
                    state.tasks[task_id].end_time = state.tasks[task_id].end_time ?? Date.now() / 1000;
                    state.tasks[task_id].progress = state.tasks[task_id].progress ?? 100;
                }
            });

            const runningTaskIds = [];
            const completedTaskIds = [];

            Object.entries(state.tasks).forEach(([task_id, task]) => {
                if (!task) return;
                task.status = normalizeTaskStatus(task.status);
                if (task.status === 'running') {
                    runningTaskIds.push(task_id);
                } else {
                    completedTaskIds.push(task_id);
                }
            });

            completedTaskIds.sort((a, b) => {
                const aTime = Number(state.tasks[a]?.end_time || state.tasks[a]?.start_time || 0);
                const bTime = Number(state.tasks[b]?.end_time || state.tasks[b]?.start_time || 0);
                return bTime - aTime;
            });

            if (completedTaskIds.length > 20) {
                completedTaskIds.slice(20).forEach((task_id) => {
                    delete state.tasks[task_id];
                });
            }

            state.runningTaskIds = runningTaskIds;
            state.completedTaskIds = completedTaskIds.slice(0, 20);
        },

        setTaskList: (state, action) => {
            const { tasks } = action.payload;
            // Merge incoming task list with existing tasks
            tasks.forEach(task => {
                state.tasks[task.task_id] = task;
                if (task.status === 'running' && !state.runningTaskIds.includes(task.task_id)) {
                    state.runningTaskIds.push(task.task_id);
                }
            });
        },

        clearCompletedTasks: (state) => {
            state.completedTaskIds.forEach(task_id => {
                delete state.tasks[task_id];
            });
            state.completedTaskIds = [];
        },

        removeTask: (state, action) => {
            const task_id = action.payload;
            delete state.tasks[task_id];
            state.runningTaskIds = state.runningTaskIds.filter(id => id !== task_id);
            state.completedTaskIds = state.completedTaskIds.filter(id => id !== task_id);
        },
    },
});

export const {
    taskStarted,
    taskProgress,
    taskCompleted,
    taskStopped,
    taskError,
    reconcileTaskSnapshot,
    setTaskList,
    clearCompletedTasks,
    removeTask,
} = tasksSlice.actions;

export default tasksSlice.reducer;
