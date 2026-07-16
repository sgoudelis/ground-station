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
    Button,
    Paper,
    Typography,
    Alert,
    AlertTitle,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    FormControlLabel,
    Checkbox,
} from '@mui/material';
import {
    Delete as DeleteIcon,
    Edit as EditIcon,
    Add as AddIcon,
    Refresh as RefreshIcon,
    CheckCircle as EnableIcon,
    Cancel as DisableIcon,
} from '@mui/icons-material';
import { alpha } from '@mui/material/styles';
import { useSocket } from '../common/socket.jsx';
import {
    setSelectedMonitoredSatellite,
    setMonitoredSatelliteDialogOpen,
    deleteMonitoredSatellitesAsync,
    toggleMonitoredSatelliteEnabledAsync,
    fetchMonitoredSatellites,
} from './scheduler-slice.jsx';
import RegenerationPreviewDialog from './regeneration-preview-dialog.jsx';
import { toRowSelectionModel, toSelectedIds } from '../../utils/datagrid-selection.js';
import { getFlattenedTasks, getSessionSdrs } from './session-utils.js';

const MonitoredSatellitesTable = () => {
    const dispatch = useDispatch();
    const { t } = useTranslation('common');
    const { socket } = useSocket();
    const [selectedIds, setSelectedIds] = useState([]);
    const [openDeleteConfirm, setOpenDeleteConfirm] = useState(false);
    const [deleteObservations, setDeleteObservations] = useState(false);
    const [openRegenerateConfirm, setOpenRegenerateConfirm] = useState(false);
    const [openPreviewDialog, setOpenPreviewDialog] = useState(false);
    const [previewData, setPreviewData] = useState(null);
    const [isLoadingPreview, setIsLoadingPreview] = useState(false);
    const [regenerationTargetId, setRegenerationTargetId] = useState(null);
    const [openNoEnabledDialog, setOpenNoEnabledDialog] = useState(false);

    const monitoredSatellites = useSelector((state) => state.scheduler?.monitoredSatellites || []);
    const loading = useSelector((state) => state.scheduler?.monitoredSatellitesLoading || false);
    const rotators = useSelector((state) => state.rotators?.rotators || []);
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

    useEffect(() => {
        if (socket) {
            dispatch(fetchMonitoredSatellites({ socket }));
        }
    }, [socket, dispatch]);

    const handleDelete = () => {
        if (selectedIds.length > 0 && socket) {
            dispatch(deleteMonitoredSatellitesAsync({ socket, ids: selectedIds, deleteObservations }));
            setSelectedIds([]);
            setOpenDeleteConfirm(false);
            setDeleteObservations(false);
        }
    };

    const handleEdit = (monitoredSatellite) => {
        dispatch(setSelectedMonitoredSatellite(monitoredSatellite));
        dispatch(setMonitoredSatelliteDialogOpen(true));
    };

    const handleAdd = () => {
        dispatch(setSelectedMonitoredSatellite(null));
        dispatch(setMonitoredSatelliteDialogOpen(true));
    };

    const handleToggleEnabled = (id, currentEnabled) => {
        if (socket) {
            dispatch(toggleMonitoredSatelliteEnabledAsync({ socket, id, enabled: !currentEnabled }));
        }
    };

    const handleBulkEnable = () => {
        if (selectedIds.length > 0 && socket) {
            selectedIds.forEach(id => {
                dispatch(toggleMonitoredSatelliteEnabledAsync({ socket, id, enabled: true }));
            });
        }
    };

    const handleBulkDisable = () => {
        if (selectedIds.length > 0 && socket) {
            selectedIds.forEach(id => {
                dispatch(toggleMonitoredSatelliteEnabledAsync({ socket, id, enabled: false }));
            });
        }
    };

    const triggerRegenerationPreview = (monitoredSatelliteId) => {
        if (socket) {
            setIsLoadingPreview(true);
            setRegenerationTargetId(monitoredSatelliteId);

            socket.emit("api.call", {
  cmd: 'regenerate-observations',
  data: {
    monitored_satellite_id: monitoredSatelliteId,
    dry_run: true
  }
}, response => {
  setIsLoadingPreview(false);
  if (response.success && response.dry_run) {
    setPreviewData(response);
    setOpenPreviewDialog(true);
  } else {
    console.error('Dry-run failed:', response.error);
  }
});
        }
    };

    const handleRegenerateSelectedClick = () => {
        if (selectedIds.length === 1) {
            triggerRegenerationPreview(selectedIds[0]);
        }
    };

    const handleRegenerateAllEnabledClick = () => {
        const hasEnabled = monitoredSatellites.some((sat) => sat.enabled);
        if (!hasEnabled) {
            setOpenNoEnabledDialog(true);
            return;
        }
        triggerRegenerationPreview(null);
    };

    const handlePreviewConfirm = (conflictChoices) => {
        if (socket) {
            socket.emit("api.call", {
  cmd: 'regenerate-observations',
  data: {
    monitored_satellite_id: regenerationTargetId,
    dry_run: false,
    user_conflict_overrides: conflictChoices
  }
}, response => {
  if (response.success) {
    console.log('Regeneration successful:', response.data);
    setOpenPreviewDialog(false);
    setPreviewData(null);
    setRegenerationTargetId(null);
  } else {
    console.error('Regeneration failed:', response.error);
  }
});
        }
    };

    const getTaskLabel = (task) => {
        if (task.type === 'decoder') {
            const decoderType = task.config.decoder_type || 'unknown';
            const typeMap = {
                lora: t('scheduler_tables.shared.tasks.lora'),
                none: t('scheduler_tables.shared.tasks.no_decoder'),
            };
            return typeMap[decoderType] || decoderType.toUpperCase();
        }
        if (task.type === 'audio_recording') return t('scheduler_tables.shared.tasks.audio');
        if (task.type === 'transcription') return t('scheduler_tables.shared.tasks.transcription');
        if (task.type === 'iq_recording') return t('scheduler_tables.shared.tasks.iq');
        return '';
    };

    const columns = [
        {
            field: 'enabled',
            headerName: t('scheduler_tables.shared.columns.enabled'),
            width: 90,
            renderCell: (params) => (
                <Switch
                    checked={params.value}
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => handleToggleEnabled(params.row.id, params.value)}
                    size="small"
                />
            ),
        },
        {
            field: 'satellite',
            headerName: t('scheduler_tables.shared.columns.satellite'),
            flex: 1,
            minWidth: 150,
            valueGetter: (value, row) => row.satellite?.name || '-',
        },
        {
            field: 'min_elevation',
            headerName: t('scheduler_tables.monitored.columns.peak_el'),
            width: 90,
            renderCell: (params) => (
                <Typography variant="body2">{params.value}°</Typography>
            ),
        },
        {
            field: 'task_start_elevation',
            headerName: t('scheduler_tables.monitored.columns.start_el'),
            width: 90,
            renderCell: (params) => (
                <Typography variant="body2">{params.value !== undefined ? `${params.value}°` : '-'}</Typography>
            ),
        },
        {
            field: 'lookahead_hours',
            headerName: t('scheduler_tables.monitored.columns.lookahead'),
            width: 110,
            renderCell: (params) => (
                <Typography variant="body2">{t('scheduler_tables.monitored.lookahead_hours_value', { value: params.value })}</Typography>
            ),
        },
        {
            field: 'sdr',
            headerName: t('scheduler_tables.shared.columns.sdr'),
            flex: 1.5,
            minWidth: 200,
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
            field: 'rotator',
            headerName: t('scheduler_tables.shared.columns.rotator'),
            minWidth: 180,
            flex: 1,
            cellClassName: 'target-rotator-nowrap-cell',
            headerClassName: 'target-rotator-nowrap-header',
            renderCell: (params) => {
                const rotator = params.value || {};
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
            flex: 1,
            minWidth: 180,
            renderCell: (params) => {
                const tasks = getFlattenedTasks(params.row);
                if (!tasks.length) return '-';
                return (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ py: 0.5 }}>
                        {tasks.map((task, idx) => {
                            let label = getTaskLabel(task);
                            let color = 'default';
                            if (task.type === 'decoder') color = 'primary';
                            else if (task.type === 'audio_recording') color = 'secondary';
                            else if (task.type === 'transcription') color = 'info';

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
            field: 'actions',
            headerName: t('scheduler_tables.shared.columns.actions'),
            width: 80,
            align: 'center',
            headerAlign: 'center',
            sortable: false,
            filterable: false,
            renderCell: (params) => (
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
            ),
        },
    ];

    return (
        <Paper elevation={3} sx={{ p: 2, display: 'flex', flexDirection: 'column' }}>
            <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
                {t('scheduler_tables.monitored.title')}
            </Typography>

            <Alert severity="success" sx={{ mb: 2, flexShrink: 0 }}>
                <AlertTitle>{t('scheduler_tables.monitored.auto_generation_title')}</AlertTitle>
                {t('scheduler_tables.monitored.auto_generation_body')}
            </Alert>

            <Box sx={{ width: '100%', minWidth: 0, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                <DataGrid
                    autoHeight
                    rows={monitoredSatellites}
                    columns={columns}
                    loading={loading}
                    checkboxSelection
                    disableRowSelectionExcludeModel
                    rowSelectionModel={rowSelectionModel}
                    onRowSelectionModelChange={(newSelection) => {
                        setSelectedIds(toSelectedIds(newSelection));
                    }}
                    initialState={{
                        pagination: {
                            paginationModel: { pageSize: 25 },
                        },
                        sorting: {
                            sortModel: [{ field: 'satellite', sort: 'asc' }],
                        },
                    }}
                    pageSizeOptions={[10, 25, 50, {value: -1, label: t('scheduler_tables.shared.all')}]}
                    localeText={{
                        noRowsLabel: t('scheduler_tables.monitored.no_rows')
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
                        '& .target-rotator-nowrap-cell': {
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                        },
                        '& .target-rotator-nowrap-header .MuiDataGrid-columnHeaderTitle': {
                            whiteSpace: 'nowrap',
                        },
                    }}
                />
            </Box>

            {/* Actions below table */}
            <Stack direction="row" spacing={1} sx={{ marginTop: '15px', flexShrink: 0, flexWrap: 'wrap', width: '100%' }}>
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
                            const monitoredSatellite = monitoredSatellites.find(ms => ms.id === selectedIds[0]);
                            if (monitoredSatellite) handleEdit(monitoredSatellite);
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
                    color="success"
                    onClick={handleBulkEnable}
                    disabled={selectedIds.length === 0}
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
                    disabled={selectedIds.length === 0}
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
                <Tooltip
                    title={
                        selectedIds.length === 1
                            ? t('scheduler_tables.monitored.regenerate_selected_tooltip')
                            : t('scheduler_tables.monitored.regenerate_select_one_tooltip')
                    }
                    arrow
                >
                    <span>
                        <Button
                            variant="contained"
                            color="warning"
                            onClick={handleRegenerateSelectedClick}
                            disabled={selectedIds.length !== 1 || isLoadingPreview}
                            sx={{
                                minWidth: 'auto',
                                px: { xs: 1, md: 2 }
                            }}
                        >
                            <RefreshIcon sx={{ display: { xs: 'block', md: 'none' } }} />
                            <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center' }}>
                                <RefreshIcon sx={{ mr: 1 }} />
                                {isLoadingPreview ? t('scheduler_tables.monitored.loading_preview') : t('scheduler_tables.monitored.regenerate')}
                            </Box>
                        </Button>
                    </span>
                </Tooltip>
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
                <Box sx={{ flexGrow: 1 }} />
                <Box sx={{ display: 'flex' }}>
                    <Tooltip
                        title={t('scheduler_tables.monitored.regenerate_all_enabled_tooltip')}
                        arrow
                    >
                        <span>
                            <Button
                                variant="contained"
                                color="warning"
                                onClick={handleRegenerateAllEnabledClick}
                                disabled={isLoadingPreview}
                                sx={{
                                    minWidth: 'auto',
                                    px: { xs: 1, md: 2 }
                                }}
                            >
                                <RefreshIcon sx={{ display: { xs: 'block', md: 'none' } }} />
                                <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center' }}>
                                    <RefreshIcon sx={{ mr: 1 }} />
                                    {t('scheduler_tables.monitored.regenerate_all_enabled')}
                                </Box>
                            </Button>
                        </span>
                    </Tooltip>
                </Box>
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
                        {t('scheduler_tables.monitored.delete_confirm_message', { count: selectedIds.length })}
                    </Typography>
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={deleteObservations}
                                onChange={(e) => setDeleteObservations(e.target.checked)}
                                color="error"
                            />
                        }
                        label={t('scheduler_tables.monitored.delete_observations_checkbox')}
                        sx={{ mb: 2 }}
                    />
                    <Typography variant="body2" sx={{ mb: 2, fontWeight: 600, color: 'text.secondary' }}>
                        {t('scheduler_tables.monitored.delete_list_title', { count: selectedIds.length })}
                    </Typography>
                    <Box sx={{
                        maxHeight: 300,
                        overflowY: 'auto',
                        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
                        borderRadius: 1,
                        border: (theme) => `1px solid ${theme.palette.divider}`,
                    }}>
                        {selectedIds.map((id, index) => {
                            const monSat = monitoredSatellites.find(ms => ms.id === id);
                            if (!monSat) return null;
                            return (
                                <Box
                                    key={id}
                                    sx={{
                                        p: 2,
                                        borderBottom: index < selectedIds.length - 1 ? (theme) => `1px solid ${theme.palette.divider}` : 'none',
                                    }}
                                >
                                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: 'text.primary' }}>
                                        {monSat.satellite?.name || t('scheduler_tables.monitored.unknown_satellite')}
                                    </Typography>
                                    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary' }}>
                                            {t('scheduler_tables.monitored.norad_id_label')}: <Typography component="span" sx={{ fontSize: '0.813rem', color: 'text.primary', fontWeight: 500 }}>{monSat.satellite?.norad_id || t('not_available')}</Typography>
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary' }}>
                                            {t('scheduler_tables.shared.columns.status')}: <Typography component="span" sx={{ fontSize: '0.813rem', color: 'text.primary', fontWeight: 500 }}>{monSat.enabled ? t('scheduler_tables.shared.enable') : t('scheduler_tables.shared.disable')}</Typography>
                                        </Typography>
                                        {monSat.min_elevation != null && (
                                            <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary' }}>
                                                {t('scheduler_tables.monitored.min_elevation_label')}: <Typography component="span" sx={{ fontSize: '0.813rem', color: 'text.primary', fontWeight: 500 }}>{monSat.min_elevation}°</Typography>
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
                        onClick={() => {
                            setOpenDeleteConfirm(false);
                            setDeleteObservations(false);
                        }}
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

            {/* Regeneration Preview Dialog */}
            <RegenerationPreviewDialog
                open={openPreviewDialog}
                onClose={() => {
                    setOpenPreviewDialog(false);
                    setPreviewData(null);
                    setRegenerationTargetId(null);
                }}
                previewData={previewData}
                onConfirm={handlePreviewConfirm}
            />

            {/* No Enabled Monitors Dialog */}
            <Dialog
                open={openNoEnabledDialog}
                onClose={() => setOpenNoEnabledDialog(false)}
                maxWidth="xs"
                fullWidth
            >
                <DialogTitle>{t('scheduler_tables.monitored.no_enabled_title')}</DialogTitle>
                <DialogContent
                    sx={{
                        bgcolor: (theme) => (
                            theme.palette.mode === 'dark'
                                ? theme.palette.background.elevated
                                : theme.palette.background.paper
                        ),
                    }}
                >
                    <Typography variant="body2">
                        {t('scheduler_tables.monitored.no_enabled_message')}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpenNoEnabledDialog(false)} variant="contained">
                        {t('scheduler_tables.shared.ok')}
                    </Button>
                </DialogActions>
            </Dialog>
        </Paper>
    );
};

export default MonitoredSatellitesTable;
