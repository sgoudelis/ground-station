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

import * as React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useSocket } from "../common/socket.jsx";
import { betterDateTimes } from "../common/common.jsx";
import { useTranslation } from 'react-i18next';
import { removeTask, stopBackgroundTask } from './tasks-slice.jsx';
import {
    Badge,
    Box,
    CircularProgress,
    Divider,
    IconButton,
    Popover,
    Typography,
    List,
    ListItem,
    Chip,
    LinearProgress,
    Button,
    Stack,
    Paper,
    Tooltip,
} from "@mui/material";
import PendingActionsIcon from '@mui/icons-material/PendingActions';
import StopIcon from '@mui/icons-material/Stop';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import CancelIcon from '@mui/icons-material/Cancel';
import ClearAllIcon from '@mui/icons-material/ClearAll';
import PlayDisabledIcon from '@mui/icons-material/PlayDisabled';

// Terminal output component with auto-scroll
const TaskOutputTerminal = ({ task, compact = false, onToggleCompact }) => {
    const terminalRef = useRef(null);

    // Auto-scroll to bottom when new output arrives
    useEffect(() => {
        if (terminalRef.current && !compact) {
            terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
        }
    }, [task.output_lines, compact]);

    const outputLines = compact
        ? task.output_lines.slice(-1)
        : task.output_lines.slice(-1000);

    return (
        <Paper
            ref={terminalRef}
            variant="outlined"
            onClick={compact ? onToggleCompact : undefined}
            sx={{
                p: 1,
                maxHeight: compact ? 32 : 140,
                overflow: compact ? 'hidden' : 'auto',
                bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.35)' : 'rgba(0, 0, 0, 0.2)'),
                borderColor: 'divider',
                borderRadius: 1,
                fontSize: '0.72rem',
                lineHeight: compact ? 1.1 : 1.35,
                fontFamily: 'monospace',
                whiteSpace: compact ? 'nowrap' : 'normal',
                display: compact ? 'flex' : 'block',
                alignItems: compact ? 'center' : 'stretch',
                cursor: compact ? 'pointer' : 'default',
            }}
        >
            {outputLines.map((line, idx) => {
                const parts = parseAnsiColors(line.output);
                return (
                    <Typography
                        key={idx}
                        variant="caption"
                        component="div"
                        sx={{
                            fontFamily: 'monospace',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            lineHeight: compact ? 1.1 : 1.35,
                        }}
                    >
                        {parts.map((part, partIdx) => (
                            <span
                                key={partIdx}
                                style={{
                                    color: part.color || 'inherit',
                                    fontWeight: part.bold ? 'bold' : 'normal',
                                }}
                            >
                                {part.text}
                            </span>
                        ))}
                    </Typography>
                );
            })}
        </Paper>
    );
};

// Parse ANSI color codes and convert to styled spans
const parseAnsiColors = (text) => {
    // Remove replacement characters (�) and other invalid UTF-8
    text = text.replace(/\uFFFD/g, '');
    // Normalize ANSI escape sequences by stripping ESC so "[...m" can be parsed.
    text = text.replaceAll('\u001b', '');

    const ansiRegex = /\[(\d*(?:;\d+)*)m/g;
    const parts = [];
    let lastIndex = 0;
    let currentColor = null;
    let currentBold = false;

    const matches = [...text.matchAll(ansiRegex)];

    for (const match of matches) {
        // Add text before this code
        if (match.index > lastIndex) {
            const textPart = text.substring(lastIndex, match.index);
            parts.push({
                text: textPart,
                color: currentColor,
                bold: currentBold,
            });
        }

        // Parse color code
        const codeString = match[1];
        const codes = codeString ? codeString.split(';') : ['0'];
        for (const code of codes) {
            if (code === '0') {
                // Reset
                currentColor = null;
                currentBold = false;
            } else if (code === '1') {
                currentBold = true;
            } else if (code === '22') {
                currentBold = false;
            } else if (code === '30') currentColor = '#000000';
            else if (code === '31') currentColor = '#ff4444';
            else if (code === '32') currentColor = '#44ff44';
            else if (code === '33') currentColor = '#ffff44';
            else if (code === '34') currentColor = '#4444ff';
            else if (code === '35') currentColor = '#ff44ff';
            else if (code === '36') currentColor = '#44ffff';
            else if (code === '37') currentColor = '#ffffff';
            else if (code === '90') currentColor = '#666666';
            else if (code === '91') currentColor = '#ff6666';
            else if (code === '92') currentColor = '#66ff66';
            else if (code === '93') currentColor = '#ffff66';
            else if (code === '94') currentColor = '#6666ff';
            else if (code === '95') currentColor = '#ff66ff';
            else if (code === '96') currentColor = '#66ffff';
            else if (code === '97') currentColor = '#ffffff';
        }

        lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < text.length) {
        parts.push({
            text: text.substring(lastIndex),
            color: currentColor,
            bold: currentBold,
        });
    }

    return parts;
};

const BackgroundTasksPopover = () => {
    const { t, i18n } = useTranslation('dashboard');
    const { socket } = useSocket();
    const dispatch = useDispatch();
    const buttonRef = useRef(null);
    const [anchorEl, setAnchorEl] = useState(null);
    const [connected, setConnected] = useState(false);
    const [expandedOutputs, setExpandedOutputs] = useState({});
    const [expandedTasks, setExpandedTasks] = useState({});
    const previousStatusesRef = useRef({});

    // Get tasks from Redux store
    const { tasks, runningTaskIds, completedTaskIds } = useSelector(state => state.backgroundTasks);
    const taskCount = runningTaskIds.length + completedTaskIds.length;
    const timezone = useSelector((state) => {
        const timezonePreference = state.preferences?.preferences?.find((preference) => preference.name === 'timezone');
        return timezonePreference?.value || 'UTC';
    });

    // Check if there are any failed or stopped tasks
    const hasFailedTasks = completedTaskIds.some(taskId => {
        const task = tasks[taskId];
        return task && task.status === 'failed';
    });

    const hasStoppedTasks = completedTaskIds.some(taskId => {
        const task = tasks[taskId];
        return task && task.status === 'stopped';
    });

    // Socket connection event handlers
    useEffect(() => {
        if (!socket) return;

        // Initialize from current socket state in case the component mounts after connect.
        setConnected(Boolean(socket.connected));

        const handleConnect = () => {
            setConnected(true);
        };

        const handleDisconnect = () => {
            setConnected(false);
        };

        socket.on('connect', handleConnect);
        socket.on('disconnect', handleDisconnect);

        return () => {
            socket.off('connect', handleConnect);
            socket.off('disconnect', handleDisconnect);
        };
    }, [socket]);

    // Collapse output when tasks finish and default completed outputs to collapsed
    useEffect(() => {
        const previousStatuses = previousStatusesRef.current;
        let hasUpdates = false;

        setExpandedOutputs((current) => {
            const next = { ...current };
            Object.entries(tasks).forEach(([taskId, task]) => {
                const prevStatus = previousStatuses[taskId];
                if (prevStatus === 'running' && task.status !== 'running' && next[taskId]) {
                    next[taskId] = false;
                    hasUpdates = true;
                }
                if (task.status !== 'running' && next[taskId] === undefined) {
                    next[taskId] = false;
                    hasUpdates = true;
                }
            });
            return hasUpdates ? next : current;
        });

        setExpandedTasks((current) => {
            const next = { ...current };
            Object.entries(tasks).forEach(([taskId, task]) => {
                const prevStatus = previousStatuses[taskId];
                if (prevStatus === 'running' && task.status !== 'running' && next[taskId]) {
                    next[taskId] = false;
                    hasUpdates = true;
                }
                if (task.status !== 'running' && next[taskId] === undefined) {
                    next[taskId] = false;
                    hasUpdates = true;
                }
            });
            return hasUpdates ? next : current;
        });

        previousStatusesRef.current = Object.fromEntries(
            Object.entries(tasks).map(([taskId, task]) => [taskId, task.status])
        );
    }, [tasks]);

    const handleClick = (event) => {
        setAnchorEl(event.currentTarget);
    };

    const handleClose = () => {
        setAnchorEl(null);
    };

    const handleStopTask = useCallback((taskId) => {
        if (!socket) return;
        dispatch(stopBackgroundTask({ socket, task_id: taskId, timeout: 5.0 }))
            .unwrap()
            .catch((error) => {
                console.error('Failed to stop task:', error);
            });
    }, [socket, dispatch]);

    const handleClearCompleted = useCallback(() => {
        // Remove all completed tasks (completed, failed, stopped)
        completedTaskIds.forEach(taskId => {
            dispatch(removeTask(taskId));
        });

        // If no running tasks remain after clearing, close popover
        if (runningTaskIds.length === 0) {
            setAnchorEl(null);
        }
    }, [completedTaskIds, runningTaskIds, dispatch]);

    const handleToggleOutput = useCallback((taskId) => {
        setExpandedOutputs((current) => ({
            ...current,
            [taskId]: !current[taskId],
        }));
    }, []);

    const handleToggleTask = useCallback((taskId) => {
        setExpandedTasks((current) => ({
            ...current,
            [taskId]: !current[taskId],
        }));
    }, []);

    const open = Boolean(anchorEl);

    // Determine icon color based on task states
    const getIconColor = () => {
        if (!connected) return 'text.disabled';
        if (hasFailedTasks) return 'error.main';
        if (runningTaskIds.length > 0) return 'info.main';
        if (hasStoppedTasks) return 'warning.main';
        if (completedTaskIds.length > 0) return 'success.main';
        return 'text.secondary';
    };

    const getTooltip = () => {
        if (!connected) return t('tasks_popover.socket_disconnected', 'Socket Disconnected');
        const runningCount = runningTaskIds.length;
        const failedCount = completedTaskIds.filter(taskId => tasks[taskId]?.status === 'failed').length;

        if (hasFailedTasks && runningCount > 0) {
            return t('tasks_popover.running_and_failed', { running: runningCount, failed: failedCount }, `${runningCount} running, ${failedCount} failed`);
        }
        if (hasFailedTasks) {
            return t('tasks_popover.failed_tasks', { count: failedCount }, `${failedCount} task(s) failed`);
        }
        if (runningCount > 0) {
            return t('tasks_popover.running_tasks', { count: runningCount }, `${runningCount} task(s) running`);
        }
        return t('tasks_popover.no_tasks', 'No background tasks');
    };

    const getSummaryText = () => {
        const runningCount = runningTaskIds.length;
        const failedCount = completedTaskIds.filter(taskId => tasks[taskId]?.status === 'failed').length;
        const stoppedCount = completedTaskIds.filter(taskId => tasks[taskId]?.status === 'stopped').length;
        const completedCount = completedTaskIds.length;
        const parts = [];

        if (runningCount > 0) parts.push(`${runningCount} running`);
        if (completedCount > 0) parts.push(`${completedCount} completed`);
        if (failedCount > 0) parts.push(`${failedCount} failed`);
        if (stoppedCount > 0) parts.push(`${stoppedCount} stopped`);

        if (parts.length === 0) return t('tasks_popover.summary_empty', 'No tasks');
        return parts.join(' • ');
    };

    const getStatusChip = (status) => {
        switch (status) {
            case 'running':
                return <Chip label={t('tasks_popover.running', { defaultValue: 'Running' })} size="small" color="info" icon={<PendingActionsIcon />} />;
            case 'completed':
                return <Chip label={t('tasks_popover.completed', { defaultValue: 'Completed' })} size="small" color="success" icon={<CheckCircleIcon />} />;
            case 'failed':
                return <Chip label={t('tasks_popover.failed', { defaultValue: 'Failed' })} size="small" color="error" icon={<ErrorIcon />} />;
            case 'stopped':
                return <Chip label={t('tasks_popover.stopped', { defaultValue: 'Stopped' })} size="small" color="warning" icon={<CancelIcon />} />;
            default:
                return <Chip label={status} size="small" />;
        }
    };

    const formatDuration = (ms) => {
        if (!ms) return '';
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    };

    const renderTaskItem = (taskId) => {
        const task = tasks[taskId];
        if (!task) return null;

        const isRunning = task.status === 'running';
        // Backend timestamps use epoch seconds. Accept milliseconds as well so task rows
        // created by older frontend state remain safe during hot reloads.
        const toEpochMilliseconds = (timestamp) => {
            const numericTimestamp = Number(timestamp);
            if (!Number.isFinite(numericTimestamp) || numericTimestamp <= 0) return null;
            return numericTimestamp < 1_000_000_000_000
                ? numericTimestamp * 1000
                : numericTimestamp;
        };
        const startTimeMs = toEpochMilliseconds(task.start_time);
        const endTimeMs = toEpochMilliseconds(task.end_time);

        const duration = endTimeMs
            ? (task.duration ? task.duration * 1000 : endTimeMs - startTimeMs)
            : Date.now() - startTimeMs;

        const taskCommandLine = [task.command, ...(task.args || [])].filter(Boolean).join(' ');
        const taskCommandPreview = taskCommandLine.length > 48
            ? `${taskCommandLine.slice(0, 48)}...`
            : taskCommandLine;
        const isOutputExpanded = expandedOutputs[taskId] ?? false;
        const isExpanded = isRunning || expandedTasks[taskId];
        const statusAccent = {
            running: 'info.main',
            completed: 'success.main',
            failed: 'error.main',
            stopped: 'warning.main',
        }[task.status] || 'divider';

        return (
            <ListItem
                key={taskId}
                sx={{
                    px: 1,
                    py: 0.9,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderLeft: '3px solid',
                    borderLeftColor: statusAccent,
                    borderRadius: 1,
                    mb: 1,
                    backgroundColor: 'action.hover',
                    '&:last-child': {
                        mb: 0,
                    },
                }}
            >
                <Stack direction="column" spacing={0.8} sx={{ width: '100%' }}>
                    <Stack
                        direction="row"
                        justifyContent="space-between"
                        alignItems="center"
                        spacing={2}
                        onClick={!isRunning ? () => handleToggleTask(taskId) : undefined}
                        sx={{
                            cursor: !isRunning ? 'pointer' : 'default',
                            '&:hover': !isRunning ? { color: 'text.primary' } : undefined,
                        }}
                    >
                        <Box sx={{ minWidth: 0, flex: 1 }}>
                            <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ minWidth: 0 }}>
                                <Typography
                                    variant="subtitle2"
                                    fontWeight={700}
                                    noWrap
                                    sx={{ textOverflow: 'ellipsis', overflow: 'hidden', flex: 1, minWidth: 0 }}
                                >
                                    {task.name}
                                </Typography>
                                {getStatusChip(task.status)}
                            </Stack>
                        </Box>
                    </Stack>

                    {!isRunning && endTimeMs && (
                        <Typography variant="caption" color="text.secondary">
                            {t('tasks_popover.finished', 'Finished')}{' '}
                            {betterDateTimes(endTimeMs, timezone, i18n.language)}
                        </Typography>
                    )}

                    {isExpanded && (
                        <Typography
                            variant="caption"
                            color="text.secondary"
                            noWrap
                            title={taskCommandLine}
                            sx={{ fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis' }}
                        >
                            {taskCommandPreview}
                        </Typography>
                    )}

                    {isRunning && (
                        <>
                            {task.progress !== undefined && task.progress !== null ? (
                                <Box>
                                    <LinearProgress variant="determinate" value={task.progress} sx={{ height: 6, borderRadius: 999 }} />
                                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.35, display: 'block' }}>
                                        {Math.round(task.progress)}{t('tasks_popover.complete', { defaultValue: '% complete' })}
                                    </Typography>
                                </Box>
                            ) : (
                                <LinearProgress sx={{ height: 6, borderRadius: 999 }} />
                            )}
                            <Stack direction="row" justifyContent="space-between" alignItems="center">
                                <Typography variant="caption" color="text.secondary">
                                    {t('tasks_popover.duration', { defaultValue: 'Duration:' })} {formatDuration(duration)}
                                </Typography>
                                <Button
                                    size="small"
                                    color="error"
                                    variant="outlined"
                                    startIcon={<StopIcon />}
                                    onClick={() => handleStopTask(taskId)}
                                >
                                    {t('tasks_popover.stop', { defaultValue: 'Stop' })}
                                </Button>
                            </Stack>
                        </>
                    )}

                    {!isRunning && isExpanded && (
                        <Typography variant="caption" color="text.secondary">
                            {t('tasks_popover.duration', { defaultValue: 'Duration:' })} {formatDuration(duration)}
                            {task.return_code !== null && ` | Exit code: ${task.return_code}`}
                        </Typography>
                    )}

                    {isExpanded && task.output_lines && task.output_lines.length > 0 && (
                        <>
                            <Box
                                onClick={() => handleToggleOutput(taskId)}
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1,
                                    cursor: 'pointer',
                                    color: 'text.secondary',
                                    fontSize: '0.7rem',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.08em',
                                    fontWeight: 700,
                                    userSelect: 'none',
                                    '&:hover': {
                                        color: 'text.primary',
                                    },
                                }}
                            >
                                <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: 'text.disabled' }} />
                                {isOutputExpanded
                                    ? t('tasks_popover.show_last_line', 'Show last line')
                                    : t('tasks_popover.show_full_output', 'Show full output')}
                            </Box>
                            <TaskOutputTerminal
                                task={task}
                                compact={!isOutputExpanded}
                                onToggleCompact={() => handleToggleOutput(taskId)}
                            />
                        </>
                    )}
                </Stack>
            </ListItem>
        );
    };

    return (
        <>
            <Tooltip title={getTooltip()}>
                <IconButton
                    ref={buttonRef}
                    onClick={handleClick}
                    sx={{
                        color: getIconColor(),
                        position: 'relative',
                    }}
                >
                    {runningTaskIds.length > 0 && (
                        <CircularProgress
                            size={28}
                            thickness={5}
                            color="inherit"
                            sx={{
                                position: 'absolute',
                                opacity: 0.7,
                            }}
                        />
                    )}
                    <Badge
                        badgeContent={taskCount}
                        invisible={!connected || taskCount === 0}
                        max={99}
                        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                        sx={{
                            '& .MuiBadge-badge': {
                                minWidth: 14,
                                height: 14,
                                px: 0.4,
                                bgcolor: 'background.paper',
                                color: 'text.secondary',
                                border: '1px solid',
                                borderColor: 'divider',
                                fontSize: '0.55rem',
                                fontWeight: 700,
                            },
                        }}
                    >
                        <PendingActionsIcon />
                    </Badge>
                </IconButton>
            </Tooltip>

            <Popover
                open={open}
                anchorEl={anchorEl}
                onClose={handleClose}
                anchorOrigin={{
                    vertical: 'bottom',
                    horizontal: 'right',
                }}
                transformOrigin={{
                    vertical: 'top',
                    horizontal: 'right',
                }}
                PaperProps={{
                    sx: (theme) => ({
                        mt: 0.5,
                        borderRadius: 1.25,
                        border: '1px solid',
                        borderColor: 'divider',
                        overflow: 'hidden',
                        backgroundColor: 'background.paper',
                        width: { xs: 420, sm: 440, md: 460 },
                        maxWidth: '90vw',
                        [theme.breakpoints.down('sm')]: {
                            left: '16px !important',
                            right: '16px !important',
                            width: 'auto',
                            maxWidth: 'calc(100vw - 32px)',
                            transform: 'none',
                        },
                    }),
                }}
            >
                <Box sx={{ width: '100%', maxHeight: 600, display: 'flex', flexDirection: 'column' }}>
                    <Box
                        sx={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            px: 1.25,
                            py: 0.75,
                        }}
                    >
                        <Stack direction="row" alignItems="baseline" spacing={0.5}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                                {t('tasks_popover.title', 'Background tasks')}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                • {getSummaryText()}
                            </Typography>
                        </Stack>
                        <Tooltip title={t('tasks_popover.clear_completed', 'Clear completed tasks')}>
                            <span>
                                <IconButton
                                    aria-label={t('tasks_popover.clear_completed', 'Clear completed tasks')}
                                    onClick={handleClearCompleted}
                                    size="small"
                                    disabled={completedTaskIds.length === 0}
                                    sx={{ color: 'text.secondary' }}
                                >
                                    <ClearAllIcon fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>
                    </Box>
                    <Divider />
                    {/* Scrollable Body */}
                    <Box sx={{ overflow: 'auto', flex: 1, bgcolor: 'background.paper' }}>
                        <Box sx={{ px: 1.25, pt: 1, pb: 1.25 }}>
                            {runningTaskIds.length === 0 && completedTaskIds.length === 0 && (
                                <List disablePadding>
                                    <ListItem
                                        sx={{
                                            px: 1,
                                            py: 2.5,
                                            bgcolor: 'action.hover',
                                            border: '1px dashed',
                                            borderColor: 'divider',
                                            borderRadius: 1,
                                        }}
                                    >
                                        <Stack direction="column" spacing={0.5} alignItems="center" justifyContent="center" sx={{ width: '100%' }}>
                                            <PlayDisabledIcon sx={{ color: 'text.disabled' }} />
                                            <Typography variant="subtitle2" color="text.secondary">
                                                {t('tasks_popover.no_tasks_message', 'No tasks running')}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary" align="center">
                                                {t('tasks_popover.no_tasks_description', 'Background work will appear here while it is running.')}
                                            </Typography>
                                        </Stack>
                                    </ListItem>
                                </List>
                            )}

                            {runningTaskIds.length > 0 && (
                                <List disablePadding>
                                    {runningTaskIds.map(taskId => renderTaskItem(taskId))}
                                </List>
                            )}

                            {completedTaskIds.length > 0 && (
                                <List disablePadding sx={{ mt: runningTaskIds.length > 0 ? 1 : 0 }}>
                                    {completedTaskIds.slice(0, 10).map(taskId => renderTaskItem(taskId))}
                                </List>
                            )}
                        </Box>
                    </Box>
                </Box>
            </Popover>
        </>
    );
};

export default BackgroundTasksPopover;
