// Copyright (c) 2026 Efstratios Goudelis
// SPDX-License-Identifier: GPL-3.0-or-later

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { joinSdr } from '../waterfall/sdr-join.js';
import { useTranslation } from 'react-i18next';
import {
    Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText,
    DialogTitle, IconButton, Paper, Stack, Tooltip, Typography,
} from '@mui/material';
import { DataGrid } from '@mui/x-data-grid';
import {
    Add, Cancel, CheckCircle, ContentCopy, DeleteOutline, EditOutlined, MemoryOutlined,
    PlayArrow, Stop, VisibilityOutlined,
} from '@mui/icons-material';
import { v4 as uuidv4 } from 'uuid';
import { useSocket } from '../common/socket.jsx';
import { fetchSDRs } from '../hardware/sdr-slice.jsx';
import ContinuousObservationForm from './continuous-observation-form.jsx';
import { createContinuousObservation } from './continuous-observation-utils.js';
import { controlContinuousObservation, deleteContinuousObservation, fetchContinuousObservations, saveContinuousObservation } from './continuous-observations-slice.js';
import { schedulerTableSx } from './scheduler-table-styles.js';
import { toRowSelectionModel, toSelectedIds } from '../../utils/datagrid-selection.js';

const EMPTY = [];

const isActive = (row) => row.runtime?.active || ['starting', 'running', 'stopping'].includes(row.runtime?.status);

export default function ContinuousObservations() {
    const { t } = useTranslation('common');
    const label = (key, options) => t(`continuous_observations.${key}`, options);
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { socket } = useSocket();
    const { definitions = EMPTY, drafts = EMPTY, loading, loaded, error, epoch } = useSelector((state) => state.continuousObservations);
    const connected = Boolean(socket && socket.connected !== false);
    const [busy, setBusy] = useState(false);
    const writing = useRef(false);
    const activeEpoch = useRef(epoch);
    useEffect(() => {
        activeEpoch.current = epoch;
        return () => { activeEpoch.current = null; };
    }, [epoch]);
    const [runtimeError, setRuntimeError] = useState(null);
    const [saveError, setSaveError] = useState(null);
    const [deleteError, setDeleteError] = useState(null);
    const [importError, setImportError] = useState(null);
    const [startupError, setStartupError] = useState(null);
    const devices = useSelector((state) => state.sdrs?.sdrs || EMPTY);
    const [form, setForm] = useState(null);
    const [deleting, setDeleting] = useState(null);
    const [selectedIds, setSelectedIds] = useState([]);
    const rowSelectionModel = useMemo(() => toRowSelectionModel(selectedIds), [selectedIds]);
    const rows = definitions;
    // Ignore selected definitions removed by a backend refresh.
    const selectedRows = useMemo(() => rows.filter((entry) => rowSelectionModel.ids.has(entry.id)), [rows, rowSelectionModel]);

    useEffect(() => {
        setSelectedIds([]);
        setDeleting(null);
        setDeleteError(null);
        setStartupError(null);
        setRuntimeError(null);
    }, [epoch]);

    useEffect(() => {
        if (socket && socket.connected !== false && !devices.length) dispatch(fetchSDRs({ socket }));
    }, [socket, dispatch]);

    useEffect(() => {
        if (connected) dispatch(fetchContinuousObservations({ socket }));
    }, [socket, connected, dispatch]);

    const mutate = async (operation, close, showError) => {
        if (writing.current) return;
        writing.current = true;
        setBusy(true);
        showError(null);
        try {
            await dispatch(operation).unwrap();
            if (activeEpoch.current === epoch) {
                close();
                dispatch(fetchContinuousObservations({ socket }));
            }
        } catch (failure) {
            showError(failure.message || label('request_failed'));
        } finally {
            writing.current = false;
            setBusy(false);
        }
    };
    const control = (observation, command) => mutate(
        controlContinuousObservation({ socket, observation, command }), () => {}, setRuntimeError,
    );
    const join = async (observation) => {
        if (writing.current) return;
        writing.current = true;
        setBusy(true);
        setRuntimeError(null);
        try {
            const response = await joinSdr(socket, dispatch, observation.sdr.id, 'watch-sdr', { continuousObservationId: observation.id });
            if (activeEpoch.current !== epoch) return;
            if (response?.success) navigate('/waterfall');
            else setRuntimeError(response?.error || label('request_failed'));
        } finally {
            writing.current = false;
            setBusy(false);
        }
    };
    const save = (observation) => mutate(saveContinuousObservation({ socket, observation }), () => setForm(null), setSaveError);
    const openForm = (next) => { setSaveError(null); setForm(next); };
    const setStartupEnabled = async (autoStart) => {
        const targets = selectedRows.filter((observation) => observation.auto_start !== autoStart);
        if (writing.current || !connected || !targets.length) return;
        writing.current = true;
        setBusy(true);
        setStartupError(null);
        const failures = [];
        try {
            for (const observation of targets) {
                if (activeEpoch.current !== epoch) break;
                try {
                    // Save the startup preference with the reviewed version, so a
                    // concurrent editor's receiver or VFO changes cannot be overwritten.
                    await dispatch(saveContinuousObservation({
                        socket, observation: { ...observation, auto_start: autoStart }, create: false,
                    })).unwrap();
                } catch (failure) {
                    failures.push(`${observation.name}: ${failure.message || label('request_failed')}`);
                }
            }
            if (activeEpoch.current === epoch) {
                if (failures.length) setStartupError(failures.join('\n'));
                dispatch(fetchContinuousObservations({ socket }));
            }
        } finally {
            writing.current = false;
            setBusy(false);
        }
    };
    const confirmDelete = (observations) => {
        setDeleteError(null);
        // Freeze the reviewed definitions, including their concurrency timestamps.
        setDeleting([...observations]);
    };
    const deleteConfirmed = async () => {
        if (writing.current || !connected || !deleting?.length) return;
        writing.current = true;
        setBusy(true);
        setDeleteError(null);
        const failures = [];
        const deletedIds = new Set();
        try {
            for (const observation of deleting) {
                // Stop issuing writes if logout or navigation ended this session.
                if (activeEpoch.current !== epoch) break;
                try {
                    await dispatch(deleteContinuousObservation({ socket, observation })).unwrap();
                    deletedIds.add(observation.id);
                } catch (failure) {
                    failures.push({ observation, message: failure.message || label('request_failed') });
                }
            }
            if (activeEpoch.current === epoch) {
                // Successful deletions leave immediately; retries target only failures.
                setSelectedIds((ids) => ids.filter((id) => !deletedIds.has(id)));
                setDeleting(failures.length ? failures.map(({ observation }) => observation) : null);
                if (failures.length) setDeleteError(failures.map(({ observation, message }) =>
                    deleting.length === 1 ? message : `${observation.name}: ${message}`).join('\n'));
                dispatch(fetchContinuousObservations({ socket }));
            }
        } finally {
            writing.current = false;
            setBusy(false);
        }
    };
    const importDrafts = async () => {
        if (writing.current) return;
        writing.current = true;
        setBusy(true);
        setImportError(null);
        const failures = [];
        // Each successful draft is removed only after its durable acknowledgement.
        // Failed drafts remain in browser storage, including across reloads.
        for (const observation of drafts) {
            // Stop the batch if logout or navigation ended this editing session.
            if (activeEpoch.current !== epoch) break;
            try {
                await dispatch(saveContinuousObservation({ socket, observation, create: true })).unwrap();
            } catch (failure) {
                failures.push(`${observation.name}: ${failure.message || label('request_failed')}`);
            }
        }
        if (activeEpoch.current === epoch) {
            if (failures.length) setImportError(failures.join(' · '));
            dispatch(fetchContinuousObservations({ socket }));
        }
        writing.current = false;
        setBusy(false);
    };
    const duplicate = (observation) => {
        const copy = structuredClone(observation);
        copy.id = uuidv4();
        copy.name = label('copy_name', { name: observation.name });
        copy.auto_start = false;
        delete copy.created_at;
        delete copy.updated_at;
        copy.vfos = copy.vfos.map((vfo) => ({ ...vfo, id: uuidv4() }));
        // Duplicates remain unsaved until reviewed, especially the receiver
        // selection: two continuous observations cannot reserve the same SDR.
        openForm({ observation: copy, readOnly: false });
    };

    const columns = [
        {
            field: 'name', headerName: label('name'), flex: 1, minWidth: 180,
            renderCell: ({ row }) => <Button size="small" color="inherit" title={row.name}
                sx={{ p: 0, minWidth: 0, maxWidth: '100%', justifyContent: 'flex-start', textTransform: 'none', fontWeight: 600 }}
                disabled={busy} onClick={(event) => { event.stopPropagation(); openForm({ observation: row, readOnly: true }); }}>
                <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.name}</Box>
            </Button>,
        },
        {
            field: 'receiver', headerName: label('receiver'), flex: 1.4, minWidth: 230,
            valueGetter: (_value, row) => devices.find((device) => device.id === row.sdr.id)?.name || row.sdr.name,
            // Stack both lines explicitly to avoid the grid's single-line cell leading.
            renderCell: ({ row, value }) => <Stack spacing={0.25} sx={{ minWidth: 0, width: '100%' }}>
                <Typography variant="body2" noWrap sx={{ fontSize: '0.8125rem', lineHeight: 1.4 }} title={value}>{value}</Typography>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ lineHeight: 1.4 }}>
                    {(row.sdr.center_frequency / 1e6).toFixed(4)} MHz · {(row.sdr.sample_rate / 1e6).toFixed(3)} MS/s
                </Typography>
            </Stack>,
        },
        {
            field: 'channels', headerName: label('channels'), width: 120, type: 'number', align: 'left', headerAlign: 'left',
            valueGetter: (_value, row) => row.vfos.length,
            renderCell: ({ row, value }) => <Stack spacing={0.25} sx={{ minWidth: 0, width: '100%' }}>
                <Typography variant="body2" noWrap sx={{ fontSize: '0.8125rem', lineHeight: 1.4 }}>{label('vfo_count', { count: value })}</Typography>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ lineHeight: 1.4 }}>
                    {label('decoder_count', { count: row.vfos.filter((vfo) => vfo.decoder !== 'none').length })}
                </Typography>
            </Stack>,
        },
        {
            field: 'status', headerName: label('status'), width: 120, sortable: false, filterable: false,
            renderCell: ({ row }) => <Tooltip title={row.runtime?.error || ''}><Chip size="small" variant="outlined"
                color={row.runtime?.status === 'running' ? 'success' : row.runtime?.status === 'failed' ? 'error' : 'default'}
                label={label(row.runtime?.status || 'not_started')} /></Tooltip>,
        },
        {
            field: 'auto_start', headerName: label('startup'), width: 110,
            description: label('startup_help'),
            valueGetter: (_value, row) => label(row.auto_start ? 'startup_enabled' : 'startup_disabled'),
            renderCell: ({ row, value }) => <Chip size="small" color={row.auto_start ? 'success' : 'default'}
                variant="outlined" label={value} />,
        },
        {
            field: 'running_since', headerName: label('running_since'), width: 140, sortable: false, filterable: false,
            renderCell: ({ row }) => <Typography variant="body2" color="text.secondary">
                {row.runtime?.started_at ? new Date(row.runtime.started_at).toLocaleString() : '—'}
            </Typography>,
        },
        {
            field: 'actions', headerName: label('actions'), width: 300, align: 'right', headerAlign: 'right',
            sortable: false, filterable: false, disableColumnMenu: true,
            renderCell: ({ row: observation }) => <Stack direction="row" spacing={0.25} alignItems="center">
                <Button size="small" startIcon={isActive(observation) ? <Stop /> : <PlayArrow />}
                    disabled={busy || !connected || ['starting', 'stopping'].includes(observation.runtime?.status)}
                    onClick={(event) => { event.stopPropagation(); control(observation, isActive(observation) ? 'stop' : 'start'); }}>
                    {label(isActive(observation) ? 'stop' : 'start')}
                </Button>
                <Button size="small" disabled={busy || !connected || observation.runtime?.status !== 'running'}
                    onClick={(event) => { event.stopPropagation(); join(observation); }}>{label('join')}</Button>
                {[
                    ['details', VisibilityOutlined, () => openForm({ observation, readOnly: true })],
                    ['edit', EditOutlined, () => openForm({ observation, readOnly: false })],
                    ['duplicate', ContentCopy, () => duplicate(observation)],
                    ['delete', DeleteOutline, () => confirmDelete([observation])],
                ].map(([key, Icon, action]) => <Tooltip key={key} title={label(key)}>
                    <IconButton size="small" aria-label={label('action_name', { action: label(key), name: observation.name })} disabled={busy || (['edit', 'delete'].includes(key) && isActive(observation))}
                        onClick={(event) => { event.stopPropagation(); action(); }}><Icon fontSize="small" /></IconButton>
                </Tooltip>)}
            </Stack>,
        },
    ];

    return <Paper elevation={3} sx={{ p: 2, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
            <Typography variant="h6" component="h2" sx={{ fontWeight: 700, color: 'text.primary' }}>{label('title')}</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2, maxWidth: 720 }}>
            {label('description')}
        </Typography>
        <Stack spacing={2} sx={{ mb: 2 }}>
            {!connected && <Alert severity="warning">{label('offline')}</Alert>}
            {error && <Alert severity="error" action={<Button color="inherit" disabled={!connected || loading} onClick={() => dispatch(fetchContinuousObservations({ socket }))}>{label('retry')}</Button>}>{error}</Alert>}
            {runtimeError && <Alert severity="error" onClose={() => setRuntimeError(null)}>{runtimeError}</Alert>}
            {startupError && <Alert severity="error" onClose={() => setStartupError(null)} sx={{ whiteSpace: 'pre-line' }}>{startupError}</Alert>}
            {drafts.length > 0 && <Alert severity="info" action={<Button color="inherit" disabled={busy || !connected} onClick={importDrafts}>
                {busy ? <CircularProgress size={18} /> : label('import_drafts')}
            </Button>}>{label('legacy_drafts', { count: drafts.length })}</Alert>}
            {importError && <Alert severity="error">{importError}</Alert>}
            {drafts.length > 0 && <Stack direction="row" gap={1} useFlexGap flexWrap="wrap">
                {drafts.map((draft) => <Button key={draft.id} size="small" startIcon={<EditOutlined />} disabled={busy || !connected}
                    onClick={() => {
                        const copy = structuredClone(draft);
                        delete copy.created_at;
                        delete copy.updated_at;
                        openForm({ observation: copy, readOnly: false });
                    }}>{label('review_draft', { name: draft.name })}</Button>)}
            </Stack>}
        </Stack>
        {!loaded ? <Stack alignItems="center" spacing={1} sx={{ py: 6 }}>
            {loading ? <CircularProgress aria-label={label('loading')} /> : <Typography color="text.secondary">{label('not_loaded')}</Typography>}
        </Stack> : definitions.length === 0 ? <Stack alignItems="center" spacing={1.5} sx={{ py: 7, px: 3, textAlign: 'center', borderTop: '1px solid', borderColor: 'divider' }}>
            <MemoryOutlined sx={{ fontSize: 44, color: 'text.disabled' }} />
            <Typography variant="subtitle1">{label('empty_title')}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 480 }}>{label('empty_description')}</Typography>
            <Button startIcon={<Add />} disabled={busy || !connected} onClick={() => openForm({ observation: createContinuousObservation(), readOnly: false })}>
                {label('create_first')}
            </Button>
        </Stack> : <Box sx={{ width: '100%', minWidth: 0, overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <DataGrid
                autoHeight
                aria-label={label('title')}
                rows={rows}
                columns={columns}
                loading={loading}
                checkboxSelection
                disableRowSelectionExcludeModel
                rowSelectionModel={rowSelectionModel}
                onRowSelectionModelChange={(selection) => setSelectedIds(toSelectedIds(selection))}
                initialState={{
                    pagination: { paginationModel: { pageSize: 25 } },
                    sorting: { sortModel: [{ field: 'name', sort: 'asc' }] },
                }}
                pageSizeOptions={[10, 25, 50, { value: -1, label: t('scheduler_tables.shared.all') }]}
                localeText={{ noRowsLabel: label('no_matches') }}
                sx={schedulerTableSx}
            />
        </Box>}
        <Stack direction="row" spacing={1} sx={{ mt: '15px', flexShrink: 0, flexWrap: 'wrap' }}>
            <Button variant="contained" startIcon={<Add />} sx={{ minWidth: 'auto', px: { xs: 1, md: 2 } }}
                disabled={busy || !connected} onClick={() => openForm({ observation: createContinuousObservation(), readOnly: false })}>
                {label('create')}
            </Button>
            <Button variant="contained" startIcon={<EditOutlined />} sx={{ minWidth: 'auto', px: { xs: 1, md: 2 } }}
                disabled={busy || !connected || selectedRows.length !== 1 || selectedRows.some(isActive)}
                onClick={() => openForm({ observation: selectedRows[0], readOnly: false })}>
                {label('edit')}
            </Button>
            <Tooltip title={label('enable_startup_help')}>
                <span>
                    <Button variant="contained" color="success" startIcon={<CheckCircle />} sx={{ minWidth: 'auto', px: { xs: 1, md: 2 } }}
                        disabled={busy || !connected || !selectedRows.some((observation) => !observation.auto_start)}
                        onClick={() => setStartupEnabled(true)}>
                        {t('scheduler_tables.shared.enable')}
                    </Button>
                </span>
            </Tooltip>
            <Tooltip title={label('disable_startup_help')}>
                <span>
                    <Button variant="contained" color="secondary" startIcon={<Cancel />} sx={{ minWidth: 'auto', px: { xs: 1, md: 2 } }}
                        disabled={busy || !connected || !selectedRows.some((observation) => observation.auto_start)}
                        onClick={() => setStartupEnabled(false)}>
                        {t('scheduler_tables.shared.disable')}
                    </Button>
                </span>
            </Tooltip>
            <Button variant="contained" color="error" startIcon={<DeleteOutline />} sx={{ minWidth: 'auto', px: { xs: 1, md: 2 } }}
                disabled={busy || !connected || selectedRows.length === 0 || selectedRows.some(isActive)} onClick={() => confirmDelete(selectedRows)}>
                {label('delete')}
            </Button>
        </Stack>
        {form && <ContinuousObservationForm key={form.observation.id} {...form} saving={busy} saveError={saveError} connected={connected} onClose={() => setForm(null)} onSave={save} />}
        <Dialog open={Boolean(deleting?.length)} onClose={() => { if (!busy) setDeleting(null); }} maxWidth="sm" fullWidth
            aria-labelledby="continuous-delete-title" aria-describedby="continuous-delete-description"
            slotProps={{ paper: { sx: { bgcolor: 'background.paper', borderRadius: 2 } } }}>
            <DialogTitle id="continuous-delete-title" sx={{
                bgcolor: 'error.main', color: 'error.contrastText', fontSize: '1.125rem', fontWeight: 600,
                py: 2, display: 'flex', alignItems: 'center', gap: 1.5,
            }}>
                <Box component="span" sx={{
                    width: 24, height: 24, borderRadius: '50%', bgcolor: 'error.contrastText', color: 'error.main',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '1rem',
                }}>!</Box>
                {t('scheduler_tables.shared.confirm_deletion')}
            </DialogTitle>
            <DialogContent sx={{
                bgcolor: (theme) => theme.palette.mode === 'dark' ? theme.palette.background.elevated : theme.palette.background.paper,
                px: 3, pt: 3, pb: 3,
            }}>
                <DialogContentText id="continuous-delete-description" sx={{ mt: 2, mb: 2, color: 'text.primary' }}>
                    {deleting?.length === 1 ? label('delete_description', { name: deleting[0].name })
                        : label('delete_multiple_description', { count: deleting?.length || 0 })}
                </DialogContentText>
                <Box sx={{
                    maxHeight: 300, overflowY: 'auto', borderRadius: 1, border: '1px solid', borderColor: 'divider',
                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
                }}>
                    {deleting?.map((observation, index) => <Box key={observation.id} sx={{
                        p: 2, borderBottom: index < deleting.length - 1 ? '1px solid' : 'none', borderColor: 'divider',
                    }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>{observation.name}</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.8125rem' }}>
                            {observation.sdr.name} · {(observation.sdr.center_frequency / 1e6).toFixed(4)} MHz
                            {' · '}{label('vfo_count', { count: observation.vfos.length })}
                        </Typography>
                    </Box>)}
                </Box>
                {deleteError && <Alert severity="error" sx={{ mt: 2, whiteSpace: 'pre-line' }}>{deleteError}</Alert>}
            </DialogContent>
            <DialogActions sx={{
                bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
                borderTop: '1px solid', borderColor: 'divider', px: 3, py: 2, gap: 1.5,
            }}>
                <Button variant="outlined" color="inherit" sx={{ minWidth: 100, textTransform: 'none', fontWeight: 500 }}
                    disabled={busy} onClick={() => setDeleting(null)}>{label('cancel')}</Button>
                <Button color="error" variant="contained" sx={{ minWidth: 100, textTransform: 'none', fontWeight: 600 }}
                    disabled={busy || !connected} onClick={deleteConfirmed}>
                    {busy ? <CircularProgress size={18} color="inherit" /> : label('delete')}
                </Button>
            </DialogActions>
        </Dialog>
    </Paper>;
}
