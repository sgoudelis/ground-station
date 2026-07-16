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

import React, { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { DataGrid, gridClasses } from '@mui/x-data-grid';
import {
    Box,
    Chip,
    IconButton,
    Tooltip,
    Switch,
    Stack,
    Typography,
    Paper,
    Alert,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
} from '@mui/material';
import {
    Delete as DeleteIcon,
    Edit as EditIcon,
    Stop as StopIcon,
    Add as AddIcon,
    ContentCopy as ContentCopyIcon,
    CheckCircle as EnableIcon,
    Cancel as DisableIcon,
    Settings as SettingsIcon,
    Folder as FolderIcon,
} from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import { useSocket } from '../common/socket.jsx';
import {
    fetchScheduledObservations,
    deleteScheduledObservations,
    toggleObservationEnabled,
    cancelRunningObservation,
    setSelectedObservation,
    setDialogOpen,
    toggleStatusFilter,
    setSelectedObservationIds,
    setOpenObservationsTableSettingsDialog,
    setObservationsTableColumnVisibility,
    setOpenObservationDataDialog,
    setSelectedObservationForData,
} from './scheduler-slice.jsx';
import { getTimeFromISO, humanizeFutureDateInMinutes } from '../common/common.jsx';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { formatDateTime } from '../../utils/date-time.js';
import { toRowSelectionModel, toSelectedIds } from '../../utils/datagrid-selection.js';
import Button from '@mui/material/Button';
import ObservationsTimeline from './observations-timeline-svg.jsx';
import { getFlattenedTasks, getSessionSdrs } from './session-utils.js';
import ObservationsTableSettingsDialog from './observations-table-settings-dialog.jsx';
import ObservationDataDialog from './observation-data-dialog.jsx';

const getStatusColor = (status) => {
    switch (status) {
        case 'scheduled':
            return 'info';
        case 'running':
            return 'success';
        case 'completed':
            return 'default';
        case 'failed':
            return 'error';
        case 'cancelled':
            return 'warning';
        default:
            return 'default';
    }
};

// Terminal observations should look visually completed in the grid.
const isTerminalStatus = (status) => ['completed', 'failed', 'cancelled', 'missed'].includes(status);

// Time formatter component that updates every second
const TimeFormatter = React.memo(function TimeFormatter({ value }) {
    const [, setForceUpdate] = useState(0);
    const { timezone, locale } = useUserTimeSettings();

    // Force component to update every second
    useEffect(() => {
        const interval = setInterval(() => {
            setForceUpdate(prev => prev + 1);
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    if (!value || value === '-') {
        return '-';
    }

    return `${getTimeFromISO(value, timezone, locale)} (${humanizeFutureDateInMinutes(value)})`;
});

const ObservationsTable = () => {
    const dispatch = useDispatch();
    const { t } = useTranslation('common');
    const { socket } = useSocket();
    const [openDeleteConfirm, setOpenDeleteConfirm] = useState(false);
    const [openStopConfirm, setOpenStopConfirm] = useState(false);

    const allObservations = useSelector((state) => state.scheduler?.observations || []);
    const loading = useSelector((state) => state.scheduler?.loading || false);
    const error = useSelector((state) => state.scheduler?.error);
    const columnVisibility = useSelector((state) => state.scheduler?.columnVisibility || {});
    const statusFilters = useSelector((state) => state.scheduler?.statusFilters || {});
    const selectedIds = useSelector((state) => state.scheduler?.selectedObservationIds || []);
    const openSettingsDialog = useSelector((state) => state.scheduler?.openObservationsTableSettingsDialog || false);
    const openDataDialog = useSelector((state) => state.scheduler?.openObservationDataDialog || false);
    const selectedObservationForData = useSelector((state) => state.scheduler?.selectedObservationForData || null);
    const rotators = useSelector((state) => state.rotators?.rotators || []);
    const { timezone, locale } = useUserTimeSettings();
    const rowSelectionModel = useMemo(() => toRowSelectionModel(selectedIds), [selectedIds]);
    const rotatorNameById = useMemo(() => {
        const mapping = {};
        rotators.forEach((rotator) => {
            const rotatorId = rotator?.id;
            if (!rotatorId) return;
            mapping[String(rotatorId)] = rotator?.name || '';
        });
        return mapping;
    }, [rotators]);

    // Filter observations based on status filters
    const observations = allObservations.filter(obs => statusFilters[obs.status]);

    useEffect(() => {
        if (socket) {
            dispatch(fetchScheduledObservations({ socket }));
        }
    }, [socket, dispatch]);

    // Load column visibility from localStorage on mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem('observations-table-column-visibility');
            if (stored) {
                const parsedVisibility = JSON.parse(stored);
                dispatch(setObservationsTableColumnVisibility(parsedVisibility));
            }
        } catch (e) {
            console.error('Failed to load observations table column visibility:', e);
        }
    }, [dispatch]);

    // Persist column visibility to localStorage whenever it changes
    useEffect(() => {
        if (columnVisibility) {
            try {
                localStorage.setItem('observations-table-column-visibility', JSON.stringify(columnVisibility));
            } catch (e) {
                console.error('Failed to save observations table column visibility:', e);
            }
        }
    }, [columnVisibility]);

    const handleDelete = () => {
        if (selectedIds.length > 0 && socket) {
            dispatch(deleteScheduledObservations({ socket, ids: selectedIds }));
            dispatch(setSelectedObservationIds([]));
            setOpenDeleteConfirm(false);
        }
    };

    const handleStop = () => {
        if (selectedIds.length > 0 && socket) {
            // Stop all selected observations
            selectedIds.forEach(id => {
                handleCancel(id);
            });
            setOpenStopConfirm(false);
        }
    };

    const handleEdit = (observation) => {
        dispatch(setSelectedObservation(observation));
        dispatch(setDialogOpen(true));
    };

    const handleClone = (observation) => {
        // Create a copy of the observation without id to treat it as new
        const { id, created_at, updated_at, status, ...observationData } = observation;
        const clonedObservation = {
            ...observationData,
            name: `${observation.name} (${t('scheduler_tables.shared.copy_suffix')})`,
        };
        dispatch(setSelectedObservation(clonedObservation));
        dispatch(setDialogOpen(true));
    };

    const handleAdd = () => {
        dispatch(setSelectedObservation(null));
        dispatch(setDialogOpen(true));
    };

    const handleToggleEnabled = (id, currentEnabled) => {
        if (socket) {
            dispatch(toggleObservationEnabled({ socket, id, enabled: !currentEnabled }));
        }
    };

    const handleBulkEnable = () => {
        if (selectedIds.length > 0 && socket) {
            selectedIds.forEach(id => {
                const observation = allObservations.find(obs => obs.id === id);
                // Only enable if not running
                if (observation && observation.status !== 'running') {
                    dispatch(toggleObservationEnabled({ socket, id, enabled: true }));
                }
            });
        }
    };

    const handleBulkDisable = () => {
        if (selectedIds.length > 0 && socket) {
            selectedIds.forEach(id => {
                const observation = allObservations.find(obs => obs.id === id);
                // Only disable if not running
                if (observation && observation.status !== 'running') {
                    dispatch(toggleObservationEnabled({ socket, id, enabled: false }));
                }
            });
        }
    };

    const handleCancel = (id) => {
        if (socket) {
            dispatch(cancelRunningObservation({ socket, id }));
        }
    };

    const handleOpenSettings = () => {
        dispatch(setOpenObservationsTableSettingsDialog(true));
    };

    const handleCloseSettings = () => {
        dispatch(setOpenObservationsTableSettingsDialog(false));
    };

    const handleViewData = (observation) => {
        dispatch(setSelectedObservationForData(observation));
        dispatch(setOpenObservationDataDialog(true));
    };

    const handleCloseDataDialog = () => {
        dispatch(setOpenObservationDataDialog(false));
        dispatch(setSelectedObservationForData(null));
    };

    const handleShowAllStatuses = () => {
        Object.entries(statusFilters).forEach(([status, enabled]) => {
            if (!enabled) {
                dispatch(toggleStatusFilter(status));
            }
        });
    };

    const getStatusLabel = (status) => (
        t(`scheduler_tables.shared.statuses.${status}`, { defaultValue: status })
    );

    const columns = [
        {
            field: 'enabled',
            headerName: t('scheduler_tables.shared.columns.enabled'),
            width: 80,
            renderCell: (params) => (
                <Switch
                    checked={params.value}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => handleToggleEnabled(params.row.id, params.value)}
                    disabled={params.row.status === 'running'}
                    size="small"
                />
            ),
        },
        {
            field: 'satellite',
            headerName: t('scheduler_tables.shared.columns.satellite'),
            flex: 1.1,
            minWidth: 150,
            valueGetter: (value, row) => row.satellite?.name || '-',
        },
        {
            field: 'peak_elevation',
            headerName: t('scheduler_tables.shared.columns.peak_elevation'),
            width: 120,
            align: 'center',
            headerAlign: 'center',
            valueGetter: (value, row) => row.pass?.peak_altitude || '-',
            valueFormatter: (value) => {
                if (value === '-') return '-';
                return `${parseFloat(value).toFixed(2)}°`;
            },
        },
        {
            field: 'pass_start',
            headerName: t('scheduler_tables.shared.columns.aos'),
            flex: 1.2,
            minWidth: 180,
            valueGetter: (value, row) => row.pass?.event_start || '-',
            renderCell: (params) => {
                if (!params.row.pass) return t('scheduler_tables.observations.geostationary');
                return <TimeFormatter value={params.value} />;
            },
        },
        {
            field: 'task_start',
            headerName: t('scheduler_tables.shared.columns.task_start'),
            flex: 1.2,
            minWidth: 180,
            valueGetter: (value, row) => row.task_start || row.pass?.event_start || '-',
            renderCell: (params) => {
                if (!params.row.pass) return '-';
                return <TimeFormatter value={params.value} />;
            },
        },
        {
            field: 'task_end',
            headerName: t('scheduler_tables.shared.columns.task_end'),
            flex: 1.2,
            minWidth: 180,
            valueGetter: (value, row) => row.task_end || row.pass?.event_end || '-',
            renderCell: (params) => {
                if (!params.row.pass) return '-';
                return <TimeFormatter value={params.value} />;
            },
        },
        {
            field: 'pass_end',
            headerName: t('scheduler_tables.shared.columns.los'),
            flex: 1.2,
            minWidth: 180,
            valueGetter: (value, row) => row.pass?.event_end || '-',
            renderCell: (params) => {
                if (!params.row.pass) return t('scheduler_tables.observations.always_visible');
                return <TimeFormatter value={params.value} />;
            },
        },
        {
            field: 'sdr',
            headerName: t('scheduler_tables.shared.columns.sdr'),
            flex: 1.8,
            minWidth: 220,
            renderCell: (params) => {
                const sdrs = getSessionSdrs(params.row);
                if (!sdrs.length) return '-';

                const formatSdr = (sdr) => {
                    const freqMHz = sdr.center_frequency ? (sdr.center_frequency / 1000000).toFixed(2) : '?';
                    const gain = (sdr.gain !== undefined && sdr.gain !== null && sdr.gain !== '') ? sdr.gain : '?';
                    const antenna = sdr.antenna_port || '?';
                    return `${sdr.name || t('scheduler_tables.shared.sdr_default_name')} • ${freqMHz}MHz • ${gain}dB • ${antenna}`;
                };

                if (sdrs.length === 1) {
                    return (
                        <Typography variant="body2" sx={{ fontSize: '0.8125rem' }}>
                            {formatSdr(sdrs[0])}
                        </Typography>
                    );
                }

                return (
                    <Stack spacing={0.5} sx={{ py: 0.5 }}>
                        {sdrs.map((sdr, idx) => (
                            <Typography key={idx} variant="body2" sx={{ fontSize: '0.75rem' }}>
                                {formatSdr(sdr)}
                            </Typography>
                        ))}
                    </Stack>
                );
            },
        },
        {
            field: 'tracker_assignment',
            headerName: t('scheduler_tables.shared.columns.rotator'),
            minWidth: 190,
            flex: 1.2,
            sortable: false,
            filterable: false,
            renderCell: (params) => {
                const rotator = params.row?.rotator || {};
                const rotatorId = rotator?.id || '';
                const rotatorName = rotator?.name || (rotatorId ? rotatorNameById[String(rotatorId)] : '');
                const primaryLabel = rotatorName || (
                    rotatorId
                        ? t('scheduler_tables.shared.rotator_configured')
                        : t('scheduler_tables.shared.rotator_none')
                );
                const secondaryLabel = rotatorId
                    ? (
                        rotator?.tracking_enabled
                            ? t('scheduler_tables.shared.tracking_enabled')
                            : t('scheduler_tables.shared.tracking_disabled')
                    )
                    : t('scheduler_tables.shared.not_configured');
                return (
                    <Stack
                        direction="row"
                        spacing={0.8}
                        alignItems="center"
                        sx={{ py: 0.5, width: '100%', whiteSpace: 'nowrap', overflow: 'hidden' }}
                    >
                        <Chip
                            size="small"
                            color={rotatorId ? 'primary' : 'default'}
                            variant={rotatorId ? 'filled' : 'outlined'}
                            label={primaryLabel}
                            sx={{ flexShrink: 0 }}
                        />
                        <Typography variant="caption" color="text.secondary" noWrap>
                            {secondaryLabel}
                        </Typography>
                    </Stack>
                );
            },
        },
        {
            field: 'tasks',
            headerName: t('scheduler_tables.shared.columns.tasks'),
            flex: 1.2,
            minWidth: 180,
            renderCell: (params) => {
                const tasks = getFlattenedTasks(params.row);
                if (tasks.length === 0) return '-';
                return (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ py: 0.5 }}>
                        {tasks.map((task, idx) => {
                            let label = '';
                            let color = 'default';

                            if (task.type === 'decoder') {
                                const decoderType = task.config.decoder_type || 'unknown';
                                const typeMap = {
                                    lora: t('scheduler_tables.shared.tasks.lora'),
                                    none: t('scheduler_tables.shared.tasks.no_decoder'),
                                };
                                label = typeMap[decoderType] || decoderType.toUpperCase();
                                color = 'primary';
                            } else if (task.type === 'audio_recording') {
                                label = t('scheduler_tables.shared.tasks.audio');
                                color = 'secondary';
                            } else if (task.type === 'transcription') {
                                label = t('scheduler_tables.shared.tasks.transcription');
                                color = 'info';
                            } else if (task.type === 'iq_recording') {
                                label = t('scheduler_tables.shared.tasks.iq');
                                color = 'default';
                            }

                            return (
                                <Chip
                                    key={idx}
                                    label={label}
                                    size="small"
                                    color={color}
                                    variant="filled"
                                />
                            );
                        })}
                    </Stack>
                );
            },
        },
        {
            field: 'status',
            headerName: t('scheduler_tables.shared.columns.status'),
            width: 120,
            renderCell: (params) => (
                <Chip
                    label={getStatusLabel(params.value)}
                    color={getStatusColor(params.value)}
                    size="small"
                />
            ),
        },
        {
            field: 'actions',
            headerName: t('scheduler_tables.shared.columns.actions'),
            width: 120,
            align: 'right',
            headerAlign: 'right',
            sortable: false,
            filterable: false,
            renderCell: (params) => (
                <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                    <Tooltip title={t('edit')}>
                        <IconButton
                            size="small"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleEdit(params.row);
                            }}
                        >
                            <EditIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={t('scheduler_tables.observations.view_downloaded_data')}>
                        <IconButton
                            size="small"
                            onClick={(e) => {
                                e.stopPropagation();
                                handleViewData(params.row);
                            }}
                        >
                            <FolderIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Stack>
            ),
        },
    ];

    return (
        <Paper elevation={3} sx={{ p: 2, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            {/* Timeline View */}
            <Box sx={{ flexShrink: 0 }}>
                <ObservationsTimeline />
            </Box>

            {/* Title and Status Filters */}
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 2, mb: 2, flexWrap: 'wrap', gap: 1 }}>
                <Typography variant="h6" sx={{ fontWeight: 700, color: 'text.primary' }}>
                    {t('scheduler_tables.observations.title')}
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
                    <Tooltip title={t('scheduler_tables.observations.table_settings')}>
                        <IconButton
                            size="small"
                            onClick={handleOpenSettings}
                            sx={{ padding: '4px' }}
                        >
                            <SettingsIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    {Object.entries(statusFilters).map(([status, enabled]) => (
                        <Chip
                            key={status}
                            label={getStatusLabel(status)}
                            color={enabled ? getStatusColor(status) : 'default'}
                            variant={enabled ? 'filled' : 'outlined'}
                            onClick={() => dispatch(toggleStatusFilter(status))}
                            size="small"
                            sx={{
                                cursor: 'pointer',
                                opacity: enabled ? 1 : 0.5,
                            }}
                        />
                    ))}
                </Stack>
            </Stack>

            {error && (
                <Alert
                    severity="error"
                    sx={{ mb: 2, flexShrink: 0 }}
                    action={
                        <Button color="inherit" size="small" onClick={() => socket && dispatch(fetchScheduledObservations({ socket }))}>
                            {t('scheduler_tables.shared.retry')}
                        </Button>
                    }
                >
                    {t('scheduler_tables.observations.load_error')}
                </Alert>
            )}

            {!loading && !error && allObservations.length > 0 && observations.length === 0 && (
                <Alert
                    severity="info"
                    sx={{ mb: 2, flexShrink: 0 }}
                    action={
                        <Button color="inherit" size="small" onClick={handleShowAllStatuses}>
                            {t('scheduler_tables.shared.show_all')}
                        </Button>
                    }
                >
                    {t('scheduler_tables.observations.all_rows_hidden')}
                </Alert>
            )}

            <Box sx={{ flexGrow: 1, width: '100%', minHeight: 0, minWidth: 0, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <DataGrid
                    rows={observations}
                    columns={columns}
                    loading={loading}
                    getRowClassName={(params) => (isTerminalStatus(params.row?.status) ? 'observation-row-terminal' : '')}
                    checkboxSelection
                    disableRowSelectionExcludeModel
                    rowSelectionModel={rowSelectionModel}
                    onRowSelectionModelChange={(newSelection) => {
                        dispatch(
                            setSelectedObservationIds(toSelectedIds(newSelection))
                        );
                    }}
                    columnVisibilityModel={columnVisibility}
                    initialState={{
                        pagination: {
                            paginationModel: { pageSize: 25 },
                        },
                        sorting: {
                            sortModel: [{ field: 'pass_start', sort: 'asc' }],
                        },
                    }}
                    pageSizeOptions={[10, 25, 50, {value: -1, label: t('scheduler_tables.shared.all')} ]}
                    localeText={{
                        noRowsLabel: t('scheduler_tables.observations.no_rows')
                    }}
                    sx={{
                        border: 0,
                        width: '100%',
                        '& .MuiDataGrid-main': {
                            overflowX: 'auto',
                        },
                        '& .MuiDataGrid-virtualScroller': {
                            overflowX: 'auto',
                            touchAction: 'pan-x pan-y',
                        },
                        [`& .${gridClasses.cell}:focus, & .${gridClasses.cell}:focus-within`]: {
                            outline: 'none',
                        },
                        [`& .${gridClasses.columnHeader}:focus, & .${gridClasses.columnHeader}:focus-within`]: {
                            outline: 'none',
                        },
                        '& .MuiDataGrid-columnHeaders': {
                            backgroundColor: (theme) => alpha(
                                theme.palette.primary.main,
                                theme.palette.mode === 'dark' ? 0.18 : 0.10
                            ),
                            borderBottom: (theme) => `2px solid ${alpha(theme.palette.primary.main, 0.45)}`,
                        },
                        '& .MuiDataGrid-columnHeader': {
                            backgroundColor: 'transparent',
                        },
                        '& .MuiDataGrid-columnHeaderTitle': {
                            fontSize: '0.8125rem',
                            fontWeight: 700,
                            letterSpacing: '0.02em',
                        },
                        '& .MuiDataGrid-overlay': {
                            fontSize: '0.875rem',
                            fontStyle: 'italic',
                            color: 'text.secondary',
                        },
                        '& .MuiDataGrid-cell': {
                            display: 'flex',
                            alignItems: 'center',
                        },
                        '& .observation-row-terminal .MuiDataGrid-cell': {
                            textDecoration: 'line-through',
                            textDecorationThickness: '1px',
                            textDecorationColor: 'currentColor',
                            color: 'text.secondary',
                        },
                    }}
                />
            </Box>

            {/* Actions below table */}
            <Stack direction="row" spacing={1} sx={{ marginTop: '15px', flexShrink: 0, flexWrap: 'wrap' }}>
                <Button
                    variant="contained"
                    onClick={handleAdd}
                    sx={{
                        minWidth: 'auto',
                        px: { xs: 1, md: 2 }
                    }}
                >
                    <AddIcon sx={{ display: { xs: 'block', md: 'none' } }} />
                    <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center' }}>
                        <AddIcon sx={{ mr: 1 }} />
                        {t('add')}
                    </Box>
                </Button>
                <Button
                    variant="contained"
                    onClick={() => {
                        if (selectedIds.length === 1) {
                            const observation = allObservations.find(obs => obs.id === selectedIds[0]);
                            if (observation) handleEdit(observation);
                        }
                    }}
                    disabled={selectedIds.length !== 1}
                    sx={{
                        minWidth: 'auto',
                        px: { xs: 1, md: 2 }
                    }}
                >
                    <EditIcon sx={{ display: { xs: 'block', md: 'none' } }} />
                    <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center' }}>
                        <EditIcon sx={{ mr: 1 }} />
                        {t('edit')}
                    </Box>
                </Button>
                <Button
                    variant="contained"
                    color="secondary"
                    onClick={() => {
                        if (selectedIds.length === 1) {
                            const observation = allObservations.find(obs => obs.id === selectedIds[0]);
                            if (observation) handleClone(observation);
                        }
                    }}
                    disabled={selectedIds.length !== 1}
                    sx={{
                        minWidth: 'auto',
                        px: { xs: 1, md: 2 }
                    }}
                >
                    <ContentCopyIcon sx={{ display: { xs: 'block', md: 'none' } }} />
                    <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center' }}>
                        <ContentCopyIcon sx={{ mr: 1 }} />
                        {t('scheduler_tables.shared.duplicate')}
                    </Box>
                </Button>
                <Button
                    variant="contained"
                    color="success"
                    onClick={handleBulkEnable}
                    disabled={
                        selectedIds.length === 0 ||
                        selectedIds.every(id =>
                            allObservations.find(obs => obs.id === id && obs.status === 'running')
                        )
                    }
                    sx={{
                        minWidth: 'auto',
                        px: { xs: 1, md: 2 }
                    }}
                >
                    <EnableIcon sx={{ display: { xs: 'block', md: 'none' } }} />
                    <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center' }}>
                        <EnableIcon sx={{ mr: 1 }} />
                        {t('scheduler_tables.shared.enable')}
                    </Box>
                </Button>
                <Button
                    variant="contained"
                    color="secondary"
                    onClick={handleBulkDisable}
                    disabled={
                        selectedIds.length === 0 ||
                        selectedIds.every(id =>
                            allObservations.find(obs => obs.id === id && obs.status === 'running')
                        )
                    }
                    sx={{
                        minWidth: 'auto',
                        px: { xs: 1, md: 2 }
                    }}
                >
                    <DisableIcon sx={{ display: { xs: 'block', md: 'none' } }} />
                    <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center' }}>
                        <DisableIcon sx={{ mr: 1 }} />
                        {t('scheduler_tables.shared.disable')}
                    </Box>
                </Button>
                <Button
                    variant="contained"
                    color="warning"
                    onClick={() => setOpenStopConfirm(true)}
                    disabled={
                        selectedIds.length === 0 ||
                        !selectedIds.some(id =>
                            allObservations.find(obs =>
                                obs.id === id &&
                                (obs.status === 'running' || obs.status === 'scheduled')
                            )
                        )
                    }
                    sx={{
                        minWidth: 'auto',
                        px: { xs: 1, md: 2 }
                    }}
                >
                    <StopIcon sx={{ display: { xs: 'block', md: 'none' } }} />
                    <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center' }}>
                        <StopIcon sx={{ mr: 1 }} />
                        {t('cancel')}
                    </Box>
                </Button>
                <Button
                    variant="contained"
                    color="error"
                    onClick={() => setOpenDeleteConfirm(true)}
                    disabled={selectedIds.length === 0}
                    sx={{
                        minWidth: 'auto',
                        px: { xs: 1, md: 2 }
                    }}
                >
                    <DeleteIcon sx={{ display: { xs: 'block', md: 'none' } }} />
                    <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center' }}>
                        <DeleteIcon sx={{ mr: 1 }} />
                        {t('delete')}
                    </Box>
                </Button>
            </Stack>

            {/* Delete Confirmation Dialog */}
            <Dialog
                open={openDeleteConfirm}
                onClose={() => setOpenDeleteConfirm(false)}
                maxWidth="sm"
                fullWidth
                PaperProps={{
                    sx: {
                        bgcolor: 'background.paper',
                        borderRadius: 2,
                    }
                }}
            >
                <DialogTitle
                    sx={{
                        bgcolor: 'error.main',
                        color: 'error.contrastText',
                        fontSize: '1.125rem',
                        fontWeight: 600,
                        py: 2,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                    }}
                >
                    <Box
                        component="span"
                        sx={{
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            bgcolor: 'error.contrastText',
                            color: 'error.main',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 'bold',
                            fontSize: '1rem',
                        }}
                    >
                        !
                    </Box>
                    {t('scheduler_tables.shared.confirm_deletion')}
                </DialogTitle>
                <DialogContent
                    sx={{
                        bgcolor: (theme) => (
                            theme.palette.mode === 'dark'
                                ? theme.palette.background.elevated
                                : theme.palette.background.paper
                        ),
                        px: 3,
                        pt: 3,
                        pb: 3,
                    }}
                >
                    <Typography variant="body1" sx={{ mt: 2, mb: 2, color: 'text.primary' }}>
                        {t('scheduler_tables.observations.delete_confirm_message', { count: selectedIds.length })}
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 2, fontWeight: 600, color: 'text.secondary' }}>
                        {t('scheduler_tables.observations.delete_list_title', { count: selectedIds.length })}
                    </Typography>
                    <Box sx={{
                        maxHeight: 300,
                        overflowY: 'auto',
                        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
                        borderRadius: 1,
                        border: (theme) => `1px solid ${theme.palette.divider}`,
                    }}>
                        {selectedIds.map((id, index) => {
                            const obs = observations.find(o => o.id === id);
                            if (!obs) return null;
                            return (
                                <Box
                                    key={id}
                                    sx={{
                                        p: 2,
                                        borderBottom: index < selectedIds.length - 1 ? (theme) => `1px solid ${theme.palette.divider}` : 'none',
                                    }}
                                >
                                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: 'text.primary' }}>
                                        {obs.satellite?.name || obs.satellite_name}
                                    </Typography>
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary' }}>
                                            {t('scheduler_tables.shared.columns.satellite')}: <Typography component="span" sx={{ fontSize: '0.813rem', color: 'text.primary', fontWeight: 500 }}>{obs.satellite?.name || obs.satellite_name}</Typography>
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary' }}>
                                            {t('scheduler_tables.observations.start_label')}: <Typography component="span" sx={{ fontSize: '0.813rem', color: 'text.primary', fontWeight: 500 }}>{obs.pass?.event_start ? formatDateTime(obs.pass.event_start, { timezone, locale }) : t('not_available')}</Typography>
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary' }}>
                                            {t('scheduler_tables.observations.end_label')}: <Typography component="span" sx={{ fontSize: '0.813rem', color: 'text.primary', fontWeight: 500 }}>{obs.pass?.event_end ? formatDateTime(obs.pass.event_end, { timezone, locale }) : t('not_available')}</Typography>
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary' }}>
                                            {t('scheduler_tables.shared.columns.status')}: <Typography component="span" sx={{ fontSize: '0.813rem', color: 'text.primary', fontWeight: 500 }}>{getStatusLabel(obs.status)}</Typography>
                                        </Typography>
                                        {obs.pass?.peak_altitude && (
                                            <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary' }}>
                                                {t('scheduler_tables.observations.max_elevation_label')}: <Typography component="span" sx={{ fontSize: '0.813rem', color: 'text.primary', fontWeight: 500 }}>{Math.round(obs.pass.peak_altitude)}°</Typography>
                                            </Typography>
                                        )}
                                    </Box>
                                </Box>
                            );
                        })}
                    </Box>
                </DialogContent>
                <DialogActions
                    sx={{
                        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
                        borderTop: (theme) => `1px solid ${theme.palette.divider}`,
                        px: 3,
                        py: 2,
                        gap: 1.5,
                    }}
                >
                    <Button
                        onClick={() => setOpenDeleteConfirm(false)}
                        variant="outlined"
                        color="inherit"
                        sx={{
                            minWidth: 100,
                            textTransform: 'none',
                            fontWeight: 500,
                        }}
                    >
                        {t('cancel')}
                    </Button>
                    <Button
                        variant="contained"
                        onClick={handleDelete}
                        color="error"
                        sx={{
                            minWidth: 100,
                            textTransform: 'none',
                            fontWeight: 600,
                        }}
                    >
                        {t('delete')}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Cancel Confirmation Dialog */}
            <Dialog open={openStopConfirm} onClose={() => setOpenStopConfirm(false)}>
                <DialogTitle>{t('scheduler_tables.observations.cancel_title', { count: selectedIds.length })}</DialogTitle>
                <DialogContent
                    sx={{
                        bgcolor: (theme) => (
                            theme.palette.mode === 'dark'
                                ? theme.palette.background.elevated
                                : theme.palette.background.paper
                        ),
                    }}
                >
                    {selectedIds.length === 1 ? (
                        (() => {
                            const obs = allObservations.find(o => o.id === selectedIds[0]);
                            return obs ? (
                                <>
                                    {t('scheduler_tables.observations.cancel_single_question', {
                                        name: obs.satellite?.name || t('unknown'),
                                    })}
                                    <br /><br />
                                    {t('scheduler_tables.observations.cancel_single_warning')}
                                </>
                            ) : null;
                        })()
                    ) : (
                        <>
                            {t('scheduler_tables.observations.cancel_multiple_question', { count: selectedIds.length })}
                            <br /><br />
                            {t('scheduler_tables.observations.cancel_multiple_warning')}
                        </>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpenStopConfirm(false)} variant="outlined">
                        {t('close')}
                    </Button>
                    <Button variant="contained" onClick={handleStop} color="warning">
                        {t('cancel')}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Table Settings Dialog */}
            <ObservationsTableSettingsDialog
                open={openSettingsDialog}
                onClose={handleCloseSettings}
            />

            {/* Observation Data Dialog */}
            <ObservationDataDialog
                open={openDataDialog}
                onClose={handleCloseDataDialog}
                observation={selectedObservationForData}
            />

        </Paper>
    );
};

export default ObservationsTable;
