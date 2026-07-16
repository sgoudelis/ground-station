import React, { useMemo, useEffect, useCallback, useState } from 'react';
import {
    Autocomplete,
    Box,
    Button,
    Chip,
    FormControl,
    FormHelperText,
    InputLabel,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    MenuItem,
    Select,
    Paper,
    IconButton,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableRow,
    TableContainer,
    TextField,
    Tooltip,
    Typography,
    useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import ListAltIcon from '@mui/icons-material/ListAlt';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ToggleOnIcon from '@mui/icons-material/ToggleOn';
import ToggleOffIcon from '@mui/icons-material/ToggleOff';
import { useDispatch, useSelector } from 'react-redux';
import { useSocket } from '../common/socket.jsx';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import {
    closeAddDialog,
    closeManageDialog,
    createMonitoredCelestial,
    deleteMonitoredCelestial,
    fetchMonitoredCelestial,
    openAddDialog,
    openManageDialog,
    setMonitoredFormError,
    setMonitoredFormField,
    toggleMonitoredCelestialEnabled,
    updateMonitoredCelestial,
} from './monitored-slice.jsx';
import { refreshMonitoredCelestialNow } from './celestial-slice.jsx';

const STALE_MS = 5 * 60 * 1000;
const HEX_COLOR_PATTERN = /^#[0-9A-F]{6}$/;
const MAX_PROJECTION_HOURS = 4320;
const HOUR_OPTIONS = [
    { value: 6, label: '6h' },
    { value: 12, label: '12h' },
    { value: 24, label: '1d' },
    { value: 72, label: '3d' },
    { value: 168, label: '7d' },
    { value: 336, label: '14d' },
    { value: 720, label: '1mo' },
    { value: 2160, label: '3mo' },
    { value: 4320, label: '6mo' },
];
const PAST_HOUR_OPTIONS = [{ value: 0, label: '0h' }, ...HOUR_OPTIONS];
const coercePastHours = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) return 0;
    return Math.min(parsed, MAX_PROJECTION_HOURS);
};
const coerceFutureHours = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return 24;
    return Math.min(parsed, MAX_PROJECTION_HOURS);
};
const DIALOG_PAPER_SX = {
    bgcolor: 'background.paper',
    border: (theme) => `1px solid ${theme.palette.divider}`,
    borderRadius: 2,
};
const DIALOG_TITLE_SX = {
    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
    borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
    fontSize: '1.25rem',
    fontWeight: 'bold',
    py: 2.5,
};
const DIALOG_CONTENT_SX = {
    px: 3,
    py: 3,
};
const DIALOG_ACTIONS_SX = {
    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
    borderTop: (theme) => `1px solid ${theme.palette.divider}`,
    px: 3,
    py: 2.5,
    gap: 2,
};
const DIALOG_CANCEL_BUTTON_SX = {
    borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.700' : 'grey.400',
    '&:hover': {
        borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.600' : 'grey.500',
        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.200',
    },
};

const getStatusMeta = (entry, t) => {
    if (entry?.lastError) {
        return { label: t('common.error'), color: 'error' };
    }

    if (!entry?.lastRefreshAt) {
        return { label: t('common.stale'), color: 'warning' };
    }

    const ageMs = Date.now() - new Date(entry.lastRefreshAt).getTime();
    if (Number.isNaN(ageMs) || ageMs > STALE_MS) {
        return { label: t('common.stale'), color: 'warning' };
    }

    return { label: t('common.ok'), color: 'success' };
};

const formatLastRefresh = (value, timezone, locale, t) => {
    if (!value) {
        return t('common.never');
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return t('common.unknown');
    }

    const options = timezone ? { timeZone: timezone } : undefined;
    return date.toLocaleString(locale, options);
};

const normalizeHexColor = (value) => {
    const text = String(value || '').trim();
    if (!text) {
        return '';
    }

    const prefixed = text.startsWith('#') ? text : `#${text}`;
    return prefixed.toUpperCase();
};

const getMissionStatusMeta = (status, statusLabel = '', t) => {
    const normalized = String(status || 'unknown').trim().toLowerCase();
    if (normalized === 'active') return { label: statusLabel || t('topbar.mission_status.active'), color: 'success' };
    if (normalized === 'completed') return { label: statusLabel || t('topbar.mission_status.completed'), color: 'default' };
    if (normalized === 'failed') return { label: statusLabel || t('topbar.mission_status.failed'), color: 'error' };
    return { label: statusLabel || t('common.unknown'), color: 'warning' };
};

const CelestialTopBar = ({
    projectionPastHours = 0,
    projectionFutureHours = 24,
    onProjectionPastHoursChange,
    onProjectionFutureHoursChange,
}) => {
    const dispatch = useDispatch();
    const theme = useTheme();
    const { t: tCelestial } = useTranslation('celestial');
    const { t: tCommon } = useTranslation('common');
    const { socket } = useSocket();
    const { timezone, locale } = useUserTimeSettings();
    const monitoredState = useSelector((state) => state.celestialMonitored);
    const celestialLoading = useSelector((state) => state.celestial?.tracksLoading);
    const {
        monitored = [],
        addDialogOpen,
        manageDialogOpen,
        form: rawForm,
        formError,
        saveLoading,
    } = monitoredState || {};
    const compactActionButtons = useMediaQuery(theme.breakpoints.down('md'));
    const form = {
        targetType: String(rawForm?.targetType || 'mission'),
        displayName: String(rawForm?.displayName || ''),
        command: String(rawForm?.command || ''),
        bodyId: String(rawForm?.bodyId || ''),
    };

    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [editError, setEditError] = useState('');
    const [editForm, setEditForm] = useState({
        id: '',
        targetType: 'mission',
        displayName: '',
        command: '',
        bodyId: '',
        color: '',
        enabled: true,
    });
    const [catalogLoading, setCatalogLoading] = useState(false);
    const [catalogError, setCatalogError] = useState('');
    const [catalogEntries, setCatalogEntries] = useState([]);
    const [bodyCatalogLoading, setBodyCatalogLoading] = useState(false);
    const [bodyCatalogError, setBodyCatalogError] = useState('');
    const [bodyCatalogEntries, setBodyCatalogEntries] = useState([]);
    const [selectedCatalogEntry, setSelectedCatalogEntry] = useState(null);
    const [targetInputValue, setTargetInputValue] = useState('');
    const [addFeedback, setAddFeedback] = useState('');
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [deleteCandidate, setDeleteCandidate] = useState(null);
    const safeSelectedCatalogEntry =
        selectedCatalogEntry && typeof selectedCatalogEntry === 'object' ? selectedCatalogEntry : null;
    const safeTargetInputValue = String(targetInputValue || '');
    const safeCatalogEntries = useMemo(
        () => (Array.isArray(catalogEntries) ? catalogEntries : [])
            .filter((entry) => entry && typeof entry === 'object')
            .map((entry) => ({
                ...entry,
                id: entry.id || entry.command || `${entry.display_name || tCelestial('topbar.fallback.target')}`,
                display_name: entry.display_name || entry.command || tCelestial('common.unknown'),
                command: entry.command || '',
            })),
        [catalogEntries, tCelestial],
    );
    const safeBodyCatalogEntries = useMemo(
        () => (Array.isArray(bodyCatalogEntries) ? bodyCatalogEntries : [])
            .filter((entry) => entry && typeof entry === 'object')
            .map((entry) => ({
                ...entry,
                body_id: String(entry.body_id || '').toLowerCase(),
                name: entry.name || entry.body_id || tCelestial('common.unknown'),
            }))
            .filter((entry) => entry.body_id),
        [bodyCatalogEntries, tCelestial],
    );

    const enabledCount = useMemo(
        () => monitored.filter((entry) => entry.enabled).length,
        [monitored],
    );

    useEffect(() => {
        if (!socket) {
            return;
        }
        let active = true;
        socket.emit("api.call", {
  cmd: 'get-spacecraft-index',
  data: {
    limit: 1000
  }
}, response => {
  if (!active) return;
  if (response?.success) {
    setCatalogEntries(response.data || []);
  }
});
        return () => {
            active = false;
        };
    }, [socket]);

    useEffect(() => {
        if (!socket) {
            return;
        }
        let active = true;
        socket.emit("api.call", {
  cmd: 'get-celestial-body-catalog',
  data: null
}, response => {
  if (!active) return;
  if (response?.success) {
    setBodyCatalogEntries(response.data || []);
  }
});
        return () => {
            active = false;
        };
    }, [socket]);

    useEffect(() => {
        if (!addDialogOpen || !socket) {
            return;
        }

        let active = true;
        setCatalogLoading(true);
        setCatalogError('');
        socket.emit("api.call", {
  cmd: 'get-spacecraft-index',
  data: {
    limit: 1000
  }
}, response => {
  if (!active) {
    return;
  }
  if (response?.success) {
    setCatalogEntries(response.data || []);
  } else {
    setCatalogEntries([]);
    setCatalogError(response?.error || tCelestial('topbar.errors.failed_load_spacecraft_catalog'));
  }
  setCatalogLoading(false);
});

        return () => {
            active = false;
        };
    }, [addDialogOpen, socket, tCelestial]);

    useEffect(() => {
        if (!addDialogOpen || !socket) {
            return;
        }

        let active = true;
        setBodyCatalogLoading(true);
        setBodyCatalogError('');
        socket.emit("api.call", {
  cmd: 'get-celestial-body-catalog',
  data: null
}, response => {
  if (!active) {
    return;
  }
  if (response?.success) {
    setBodyCatalogEntries(response.data || []);
  } else {
    setBodyCatalogEntries([]);
    setBodyCatalogError(response?.error || tCelestial('topbar.errors.failed_load_body_catalog'));
  }
  setBodyCatalogLoading(false);
});

        return () => {
            active = false;
        };
    }, [addDialogOpen, socket, tCelestial]);

    useEffect(() => {
        if (addDialogOpen) {
            setAddFeedback('');
            setTargetInputValue(form.command || '');
            return;
        }
        setSelectedCatalogEntry(null);
        setTargetInputValue('');
        setCatalogError('');
        setBodyCatalogError('');
        setAddFeedback('');
    }, [addDialogOpen, form.command]);

    const inferredSourceMode = useMemo(() => {
        if (form.targetType === 'body') {
            return 'static-body';
        }
        const command = String(form.command || '').trim().toLowerCase();
        const catalogCommand = String(selectedCatalogEntry?.command || '').trim().toLowerCase();
        if (selectedCatalogEntry && command && command === catalogCommand) {
            return 'catalog';
        }
        return 'exact';
    }, [form.command, form.targetType, selectedCatalogEntry]);

    const catalogByCommand = useMemo(() => {
        const map = {};
        safeCatalogEntries.forEach((entry) => {
            const key = String(entry?.command || '').trim().toLowerCase();
            if (key) {
                map[key] = entry;
            }
        });
        return map;
    }, [safeCatalogEntries]);

    const monitoredCommands = useMemo(
        () =>
            new Set(
                (monitored || [])
                    .filter((entry) => (entry.targetType || 'mission') === 'mission')
                    .map((entry) => String(entry?.command || '').trim().toLowerCase())
                    .filter(Boolean),
            ),
        [monitored],
    );
    const monitoredBodies = useMemo(
        () =>
            new Set(
                (monitored || [])
                    .filter((entry) => (entry.targetType || 'mission') === 'body')
                    .map((entry) => String(entry?.bodyId || '').trim().toLowerCase())
                    .filter(Boolean),
            ),
        [monitored],
    );

    const handleAdd = async () => {
        setAddFeedback('');
        if (!socket) {
            dispatch(setMonitoredFormError(tCelestial('topbar.errors.socket_unavailable')));
            return;
        }

        const targetType = form.targetType || 'mission';
        const name = form.displayName.trim();
        const cmd = form.command.trim();
        const bodyId = String(form.bodyId || '').trim().toLowerCase();

        if (targetType === 'mission') {
            if (!name || !cmd) {
                dispatch(setMonitoredFormError(tCelestial('topbar.errors.display_name_command_required')));
                return;
            }
            const exists = monitored.some(
                (entry) =>
                    (entry.targetType || 'mission') === 'mission'
                    && String(entry.command || '').toLowerCase() === cmd.toLowerCase(),
            );
            if (exists) {
                dispatch(setMonitoredFormError(tCelestial('topbar.errors.command_already_monitored')));
                return;
            }
        } else {
            if (!bodyId) {
                dispatch(setMonitoredFormError(tCelestial('topbar.errors.select_body_target')));
                return;
            }
            const exists = monitored.some(
                (entry) =>
                    (entry.targetType || 'mission') === 'body'
                    && String(entry.bodyId || '').toLowerCase() === bodyId,
            );
            if (exists) {
                dispatch(setMonitoredFormError(tCelestial('topbar.errors.body_already_monitored')));
                return;
            }
        }

        const result = await dispatch(
            createMonitoredCelestial({
                socket,
                entry: {
                    targetType,
                    displayName: name,
                    command: targetType === 'mission' ? cmd : '',
                    bodyId: targetType === 'body' ? bodyId : '',
                    enabled: true,
                    sourceMode: inferredSourceMode,
                },
            }),
        );
        if (result.meta.requestStatus === 'fulfilled') {
            const createdId = String(result?.payload?.id || '').trim();
            setAddFeedback(
                targetType === 'mission'
                    ? tCelestial('topbar.feedback.added_mission', { name, command: cmd })
                    : tCelestial('topbar.feedback.added_body', { name }),
            );
            setSelectedCatalogEntry(null);

            if (createdId) {
                await dispatch(
                    refreshMonitoredCelestialNow({
                        socket,
                        ids: [createdId],
                        payload: {
                            past_hours: coercePastHours(projectionPastHours),
                            future_hours: coerceFutureHours(projectionFutureHours),
                            step_minutes: 60,
                        },
                    }),
                );
                await dispatch(fetchMonitoredCelestial({ socket }));
            }
        }
    };

    const handleRefreshAll = useCallback(async () => {
        if (!socket || celestialLoading) {
            return;
        }

        await dispatch(
            refreshMonitoredCelestialNow({
                socket,
                ids: [],
                payload: {
                    past_hours: coercePastHours(projectionPastHours),
                    future_hours: coerceFutureHours(projectionFutureHours),
                    step_minutes: 60,
                },
            }),
        );
        await dispatch(fetchMonitoredCelestial({ socket }));
    }, [
        socket,
        celestialLoading,
        dispatch,
        projectionPastHours,
        projectionFutureHours,
    ]);

    const handleOpenEdit = (entry) => {
        setEditForm({
            id: entry.id,
            targetType: entry.targetType || 'mission',
            displayName: entry.displayName,
            command: entry.command,
            bodyId: entry.bodyId || '',
            color: entry.color || '',
            enabled: entry.enabled,
        });
        setEditError('');
        setEditDialogOpen(true);
    };

    const handleSaveEdit = async () => {
        if (!socket) {
            setEditError(tCelestial('topbar.errors.socket_unavailable'));
            return;
        }

        const name = editForm.displayName.trim();
        const cmd = editForm.command.trim();
        const bodyId = String(editForm.bodyId || '').trim().toLowerCase();
        const targetType = editForm.targetType || 'mission';
        const normalizedColor = normalizeHexColor(editForm.color);
        if (!name) {
            setEditError(tCelestial('topbar.errors.display_name_required'));
            return;
        }
        if (targetType === 'mission' && !cmd) {
            setEditError(tCelestial('topbar.errors.command_required_for_mission'));
            return;
        }
        if (targetType === 'body' && !bodyId) {
            setEditError(tCelestial('topbar.errors.body_required_for_body_target'));
            return;
        }
        if (normalizedColor && !HEX_COLOR_PATTERN.test(normalizedColor)) {
            setEditError(tCelestial('topbar.errors.invalid_hex_color'));
            return;
        }

        const exists = monitored.some(
            (entry) => {
                if (entry.id === editForm.id) return false;
                if ((entry.targetType || 'mission') !== targetType) return false;
                if (targetType === 'body') {
                    return String(entry.bodyId || '').toLowerCase() === bodyId;
                }
                return String(entry.command || '').toLowerCase() === cmd.toLowerCase();
            },
        );
        if (exists) {
            setEditError(
                targetType === 'mission'
                    ? tCelestial('topbar.errors.command_already_monitored')
                    : tCelestial('topbar.errors.body_already_monitored')
            );
            return;
        }

        const result = await dispatch(
            updateMonitoredCelestial({
                socket,
                entry: {
                    id: editForm.id,
                    targetType,
                    displayName: name,
                    command: targetType === 'mission' ? cmd : '',
                    bodyId: targetType === 'body' ? bodyId : '',
                    color: normalizedColor || null,
                    enabled: editForm.enabled,
                },
            }),
        );

        if (result.meta.requestStatus === 'fulfilled') {
            setEditDialogOpen(false);
            setEditError('');
            return;
        }

        setEditError(result.payload || result.error?.message || tCelestial('topbar.errors.failed_update_target'));
    };

    const handleRequestDelete = (entry) => {
        setDeleteCandidate(entry || null);
        setDeleteDialogOpen(true);
    };

    const handleConfirmDelete = async () => {
        if (!socket || !deleteCandidate?.id || celestialLoading) {
            return;
        }

        await dispatch(
            deleteMonitoredCelestial({
                socket,
                ids: [deleteCandidate.id],
            }),
        );

        setDeleteDialogOpen(false);
        setDeleteCandidate(null);
    };

    return (
        <>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.5,
                    px: 1.5,
                    py: 1,
                    bgcolor: 'background.paper',
                    borderBottom: '1px solid',
                    borderColor: 'border.main',
                    minHeight: '64px',
                }}
            >
                <Stack direction="row" spacing={1} alignItems="center">
                    <Stack direction="row" spacing={0.5} alignItems="center">
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                            {tCelestial('topbar.projection.past')}
                        </Typography>
                        <FormControl size="small" sx={{ minWidth: 72 }}>
                            <Select
                                size="small"
                                value={projectionPastHours}
                                onChange={(event) => onProjectionPastHoursChange?.(Number(event.target.value))}
                                disabled={!socket || celestialLoading}
                                sx={{
                                    '& .MuiSelect-select': {
                                        py: 0.5,
                                        pl: 1,
                                        pr: 3,
                                    },
                                }}
                            >
                                {PAST_HOUR_OPTIONS.map((option) => (
                                    <MenuItem key={`past-${option.value}`} value={option.value}>
                                        {option.label}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Stack>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                            {tCelestial('topbar.projection.future')}
                        </Typography>
                        <FormControl size="small" sx={{ minWidth: 72 }}>
                            <Select
                                size="small"
                                value={projectionFutureHours}
                                onChange={(event) => onProjectionFutureHoursChange?.(Number(event.target.value))}
                                disabled={!socket || celestialLoading}
                                sx={{
                                    '& .MuiSelect-select': {
                                        py: 0.5,
                                        pl: 1,
                                        pr: 3,
                                    },
                                }}
                            >
                                {HOUR_OPTIONS.map((option) => (
                                    <MenuItem key={`future-${option.value}`} value={option.value}>
                                        {option.label}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Stack>
                </Stack>

                <Stack direction="row" spacing={0.5} sx={{ ml: 'auto' }}>
                    <Tooltip title={tCommon('add')}>
                        <span>
                            {compactActionButtons ? (
                                <IconButton
                                    size="small"
                                    onClick={() => dispatch(openAddDialog())}
                                    disabled={!socket || celestialLoading}
                                    aria-label={tCommon('add')}
                                >
                                    <AddIcon fontSize="small" />
                                </IconButton>
                            ) : (
                                <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={<AddIcon />}
                                    onClick={() => dispatch(openAddDialog())}
                                    disabled={!socket || celestialLoading}
                                >
                                    {tCommon('add')}
                                </Button>
                            )}
                        </span>
                    </Tooltip>
                    <Tooltip title={tCelestial('topbar.actions.manage')}>
                        <span>
                            {compactActionButtons ? (
                                <IconButton
                                    size="small"
                                    onClick={() => dispatch(openManageDialog())}
                                    aria-label={tCelestial('topbar.actions.manage')}
                                >
                                    <ListAltIcon fontSize="small" />
                                </IconButton>
                            ) : (
                                <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={<ListAltIcon />}
                                    onClick={() => dispatch(openManageDialog())}
                                >
                                    {tCelestial('topbar.actions.manage')}
                                </Button>
                            )}
                        </span>
                    </Tooltip>
                    <Tooltip title={tCelestial('topbar.actions.refresh_all')}>
                        <span>
                            {compactActionButtons ? (
                                <IconButton
                                    size="small"
                                    disabled={!socket || celestialLoading || enabledCount === 0}
                                    onClick={handleRefreshAll}
                                    aria-label={tCelestial('topbar.actions.refresh_all')}
                                >
                                    <RefreshIcon fontSize="small" />
                                </IconButton>
                            ) : (
                                <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={<RefreshIcon />}
                                    disabled={!socket || celestialLoading || enabledCount === 0}
                                    onClick={handleRefreshAll}
                                >
                                    {tCelestial('topbar.actions.refresh_all')}
                                </Button>
                            )}
                        </span>
                    </Tooltip>
                </Stack>
            </Box>

            <Dialog
                open={addDialogOpen}
                onClose={() => dispatch(closeAddDialog())}
                maxWidth="sm"
                fullWidth
                PaperProps={{ sx: DIALOG_PAPER_SX }}
            >
                <DialogTitle sx={DIALOG_TITLE_SX}>{tCelestial('topbar.dialogs.add_title')}</DialogTitle>
                <DialogContent sx={DIALOG_CONTENT_SX}>
                    <Stack spacing={2} sx={{ pt: 3 }}>
                        <FormControl size="small" fullWidth>
                            <InputLabel id="add-target-type-label">{tCelestial('topbar.fields.target_type')}</InputLabel>
                            <Select
                                labelId="add-target-type-label"
                                label={tCelestial('topbar.fields.target_type')}
                                value={form.targetType || 'mission'}
                                onChange={(event) => {
                                    const nextType = event.target.value;
                                    dispatch(setMonitoredFormField({ field: 'targetType', value: nextType }));
                                    dispatch(setMonitoredFormField({ field: 'displayName', value: '' }));
                                    dispatch(setMonitoredFormField({ field: 'command', value: '' }));
                                    dispatch(setMonitoredFormField({ field: 'bodyId', value: '' }));
                                    setSelectedCatalogEntry(null);
                                    setTargetInputValue('');
                                    setAddFeedback('');
                                    dispatch(setMonitoredFormError(''));
                                }}
                            >
                                <MenuItem value="mission">{tCelestial('topbar.fields.mission_spacecraft')}</MenuItem>
                                <MenuItem value="body">{tCelestial('topbar.fields.solar_body')}</MenuItem>
                            </Select>
                        </FormControl>

                        {(form.targetType || 'mission') === 'mission' ? (
                            <>
                                <Box>
                                    <Autocomplete
                                        freeSolo
                                        options={safeCatalogEntries}
                                        loading={catalogLoading}
                                        sx={{
                                            bgcolor: 'transparent',
                                            '& .MuiInputBase-root': {
                                                bgcolor: 'background.paper',
                                            },
                                        }}
                                        value={safeSelectedCatalogEntry}
                                        inputValue={safeTargetInputValue}
                                        isOptionEqualToValue={(option, value) =>
                                            String(option?.id || option?.command || '') === String(value?.id || value?.command || '')
                                        }
                                        getOptionDisabled={(option) =>
                                            monitoredCommands.has(String(option?.command || '').trim().toLowerCase())
                                        }
                                        getOptionLabel={(option) => {
                                            if (typeof option === 'string') {
                                                return option;
                                            }
                                            return option?.display_name || option?.command || '';
                                        }}
                                        onInputChange={(event, value, reason) => {
                                            setTargetInputValue(value);
                                            if (reason === 'clear') {
                                                setSelectedCatalogEntry(null);
                                                dispatch(setMonitoredFormField({ field: 'displayName', value: '' }));
                                                dispatch(setMonitoredFormField({ field: 'command', value: '' }));
                                                dispatch(setMonitoredFormError(''));
                                                setAddFeedback('');
                                                return;
                                            }
                                            if (reason === 'input') {
                                                const typed = String(value || '');
                                                setSelectedCatalogEntry(null);
                                                dispatch(setMonitoredFormField({ field: 'displayName', value: typed }));
                                                dispatch(setMonitoredFormField({ field: 'command', value: typed }));
                                                dispatch(setMonitoredFormError(''));
                                                setAddFeedback('');
                                            }
                                        }}
                                        onChange={(event, value) => {
                                            setAddFeedback('');
                                            dispatch(setMonitoredFormError(''));

                                            if (!value) {
                                                setSelectedCatalogEntry(null);
                                                return;
                                            }

                                            if (typeof value === 'string') {
                                                setSelectedCatalogEntry(null);
                                                setTargetInputValue(value);
                                                dispatch(setMonitoredFormField({ field: 'displayName', value }));
                                                dispatch(setMonitoredFormField({ field: 'command', value }));
                                                return;
                                            }

                                            setSelectedCatalogEntry(value);
                                            setTargetInputValue(value.display_name || value.command || '');
                                            dispatch(setMonitoredFormField({ field: 'displayName', value: value.display_name || '' }));
                                            dispatch(setMonitoredFormField({ field: 'command', value: value.command || '' }));
                                        }}
                                        renderOption={(props, option) => (
                                            <Box component="li" {...props} key={option?.id || option?.command || 'target'}>
                                                <Stack spacing={0.35} sx={{ width: '100%' }}>
                                                    <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                                                        <Typography variant="body2">{option?.display_name || option?.command || tCelestial('common.unknown')}</Typography>
                                                        <Stack direction="row" spacing={0.75} alignItems="center">
                                                            {monitoredCommands.has(String(option?.command || '').trim().toLowerCase()) ? (
                                                                <Chip
                                                                    size="small"
                                                                    variant="outlined"
                                                                    color="default"
                                                                    label={tCelestial('topbar.labels.already_monitored')}
                                                                />
                                                            ) : null}
                                                            <Chip
                                                                size="small"
                                                                variant="outlined"
                                                                color={getMissionStatusMeta(option?.mission_status, option?.status_label, tCelestial).color}
                                                                label={getMissionStatusMeta(option?.mission_status, option?.status_label, tCelestial).label}
                                                            />
                                                        </Stack>
                                                    </Stack>
                                                    <FormHelperText sx={{ m: 0, mt: 0.15 }}>
                                                        {option?.command}{option?.agency ? ` · ${option.agency}` : ''}
                                                    </FormHelperText>
                                                </Stack>
                                            </Box>
                                        )}
                                        renderInput={(params) => (
                                            <TextField
                                                {...params}
                                                label={tCelestial('topbar.fields.target')}
                                                placeholder={tCelestial('topbar.fields.target_placeholder')}
                                                size="small"
                                                helperText={
                                                    inferredSourceMode === 'catalog'
                                                        ? tCelestial('topbar.helper.using_static_catalog')
                                                        : tCelestial('topbar.helper.using_exact_command')
                                                }
                                            />
                                        )}
                                    />
                                </Box>
                                {selectedCatalogEntry && String(selectedCatalogEntry?.mission_status || '').toLowerCase() !== 'active' ? (
                                    <Typography variant="caption" color="warning.main">
                                        {tCelestial('topbar.helper.selected_mission_not_active')}
                                    </Typography>
                                ) : null}
                                {catalogLoading ? (
                                    <Typography variant="caption" color="text.secondary">
                                        {tCelestial('topbar.helper.loading_spacecraft_catalog')}
                                    </Typography>
                                ) : null}
                                <TextField
                                    label={tCelestial('topbar.fields.horizons_command')}
                                    value={form.command}
                                    onChange={(event) =>
                                        {
                                            const nextValue = event.target.value;
                                            dispatch(setMonitoredFormField({ field: 'command', value: nextValue }));
                                            if (!form.displayName || form.displayName === form.command) {
                                                dispatch(setMonitoredFormField({ field: 'displayName', value: nextValue }));
                                            }
                                            setSelectedCatalogEntry(null);
                                            setTargetInputValue(nextValue);
                                        }
                                    }
                                    fullWidth
                                    size="small"
                                />
                            </>
                        ) : (
                            <>
                                <FormControl size="small" fullWidth sx={{ mt: 0.5 }}>
                                    <InputLabel id="body-target-label">{tCelestial('topbar.fields.target_body')}</InputLabel>
                                    <Select
                                        labelId="body-target-label"
                                        label={tCelestial('topbar.fields.target_body')}
                                        value={form.bodyId || ''}
                                        onChange={(event) => {
                                            const bodyId = String(event.target.value || '').toLowerCase();
                                            const selectedBody = safeBodyCatalogEntries.find(
                                                (entry) => String(entry?.body_id || '').toLowerCase() === bodyId,
                                            );
                                            dispatch(setMonitoredFormField({ field: 'bodyId', value: bodyId }));
                                            dispatch(setMonitoredFormField({ field: 'displayName', value: selectedBody?.name || bodyId }));
                                            dispatch(setMonitoredFormError(''));
                                            setAddFeedback('');
                                        }}
                                    >
                                        {safeBodyCatalogEntries.map((entry) => {
                                            const value = String(entry?.body_id || '').toLowerCase();
                                            const isDisabled = monitoredBodies.has(value);
                                            return (
                                                <MenuItem key={value} value={value} disabled={isDisabled}>
                                                    {entry?.name || value}
                                                    {entry?.body_type ? ` (${entry.body_type})` : ''}
                                                    {entry?.parent_body_id ? ` · ${entry.parent_body_id}` : ''}
                                                </MenuItem>
                                            );
                                        })}
                                    </Select>
                                </FormControl>
                                {bodyCatalogLoading ? (
                                    <Typography variant="caption" color="text.secondary">
                                        {tCelestial('topbar.helper.loading_body_catalog')}
                                    </Typography>
                                ) : null}
                                {bodyCatalogError ? (
                                    <Typography variant="body2" color="error">
                                        {bodyCatalogError}
                                    </Typography>
                                ) : null}
                            </>
                        )}

                        <TextField
                            label={tCelestial('topbar.fields.display_name')}
                            value={form.displayName}
                            onChange={(event) =>
                                dispatch(setMonitoredFormField({ field: 'displayName', value: event.target.value }))
                            }
                            fullWidth
                            size="small"
                        />
                        {(form.targetType || 'mission') === 'mission' && catalogError ? (
                            <Typography variant="body2" color="error">
                                {catalogError}
                            </Typography>
                        ) : null}
                        {formError ? (
                            <Typography variant="body2" color="error">
                                {formError}
                            </Typography>
                        ) : null}
                        {addFeedback ? (
                            <Typography variant="body2" color="success.main">
                                {addFeedback}
                            </Typography>
                        ) : null}
                    </Stack>
                </DialogContent>
                <DialogActions sx={DIALOG_ACTIONS_SX}>
                    <Button
                        onClick={() => dispatch(closeAddDialog())}
                        variant="outlined"
                        sx={DIALOG_CANCEL_BUTTON_SX}
                    >
                        {tCommon('cancel')}
                    </Button>
                    <Button onClick={handleAdd} color="success" variant="contained" disabled={saveLoading || !socket || celestialLoading}>
                        {tCommon('add')}
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={manageDialogOpen}
                onClose={() => dispatch(closeManageDialog())}
                maxWidth="lg"
                fullWidth
                PaperProps={{ sx: DIALOG_PAPER_SX }}
            >
                <DialogTitle sx={DIALOG_TITLE_SX}>{tCelestial('topbar.dialogs.manage_title')}</DialogTitle>
                <DialogContent sx={DIALOG_CONTENT_SX}>
                    <TableContainer
                        component={Paper}
                        sx={{
                            borderRadius: 0,
                            mt: 2.5,
                            maxHeight: 460,
                        }}
                    >
                        <Table size="small" stickyHeader>
                            <TableHead>
                                <TableRow>
                                    <TableCell sx={{ fontWeight: 700, bgcolor: 'background.paper' }}>{tCommon('name')}</TableCell>
                                    <TableCell sx={{ fontWeight: 700, bgcolor: 'background.paper' }}>{tCelestial('topbar.table.type')}</TableCell>
                                    <TableCell sx={{ fontWeight: 700, bgcolor: 'background.paper' }}>{tCelestial('topbar.table.mission')}</TableCell>
                                    <TableCell sx={{ fontWeight: 700, bgcolor: 'background.paper' }}>{tCommon('status')}</TableCell>
                                    <TableCell sx={{ fontWeight: 700, bgcolor: 'background.paper' }}>{tCelestial('topbar.table.last_refresh')}</TableCell>
                                    <TableCell sx={{ fontWeight: 700, bgcolor: 'background.paper' }}>{tCommon('actions')}</TableCell>
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {monitored.length ? (
                                    monitored.map((entry) => {
                                        const statusMeta = getStatusMeta(entry, tCelestial);
                                        const targetType = entry.targetType || 'mission';
                                        const mission = targetType === 'mission'
                                            ? (catalogByCommand[String(entry.command || '').toLowerCase()] || null)
                                            : null;
                                        const missionStatusMeta = getMissionStatusMeta(
                                            mission?.mission_status,
                                            mission?.status_label,
                                            tCelestial,
                                        );
                                        return (
                                            <TableRow
                                                key={entry.id}
                                                sx={{
                                                    '&:nth-of-type(odd)': { bgcolor: 'action.hover' },
                                                    '& td': { py: 1.15 },
                                                }}
                                            >
                                                <TableCell>
                                                    <Typography variant="body2">{entry.displayName}</Typography>
                                                    <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                                                        {targetType === 'body' ? entry.bodyId : entry.command}
                                                    </Typography>
                                                </TableCell>
                                                <TableCell>
                                                    <Chip
                                                        size="small"
                                                        variant="outlined"
                                                        label={targetType === 'body' ? tCelestial('common.body') : tCelestial('common.mission')}
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <Chip
                                                        size="small"
                                                        variant="outlined"
                                                        color={targetType === 'body' ? 'info' : missionStatusMeta.color}
                                                        label={targetType === 'body' ? tCelestial('topbar.labels.static_body') : missionStatusMeta.label}
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <Chip
                                                        size="small"
                                                        color={statusMeta.color}
                                                        label={statusMeta.label}
                                                        variant="outlined"
                                                    />
                                                </TableCell>
                                                <TableCell>
                                                    <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                                                        {formatLastRefresh(entry.lastRefreshAt, timezone, locale, tCelestial)}
                                                    </Typography>
                                                    {entry.lastError ? (
                                                        <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.25 }}>
                                                            {entry.lastError}
                                                        </Typography>
                                                    ) : null}
                                                </TableCell>
                                                <TableCell>
                                                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                                                        <Tooltip title={entry.enabled ? tCelestial('topbar.actions.disable_target') : tCelestial('topbar.actions.enable_target')}>
                                                            <span>
                                                                <IconButton
                                                                    size="small"
                                                                    color={entry.enabled ? 'success' : 'default'}
                                                                    onClick={() =>
                                                                        socket && dispatch(toggleMonitoredCelestialEnabled({
                                                                            socket,
                                                                            id: entry.id,
                                                                            enabled: !entry.enabled,
                                                                        }))
                                                                    }
                                                                    disabled={!socket || celestialLoading}
                                                                >
                                                                    {entry.enabled ? <ToggleOnIcon /> : <ToggleOffIcon />}
                                                                </IconButton>
                                                            </span>
                                                        </Tooltip>
                                                        <Tooltip title={tCommon('edit')}>
                                                            <span>
                                                                <IconButton
                                                                    size="small"
                                                                    onClick={() => handleOpenEdit(entry)}
                                                                    disabled={!socket || celestialLoading}
                                                                >
                                                                    <EditIcon />
                                                                </IconButton>
                                                            </span>
                                                        </Tooltip>
                                                        <Tooltip title={tCommon('delete')}>
                                                            <span>
                                                                <IconButton
                                                                    size="small"
                                                                    color="error"
                                                                    onClick={() => handleRequestDelete(entry)}
                                                                    disabled={!socket || celestialLoading}
                                                                >
                                                                    <DeleteOutlineIcon />
                                                                </IconButton>
                                                            </span>
                                                        </Tooltip>
                                                    </Stack>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={6} sx={{ py: 4 }}>
                                            <Typography variant="body2" color="text.secondary" textAlign="center">
                                                {tCelestial('topbar.empty.no_targets')}
                                            </Typography>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </TableContainer>
                </DialogContent>
                <DialogActions sx={DIALOG_ACTIONS_SX}>
                    <Button
                        onClick={handleRefreshAll}
                        variant="outlined"
                        startIcon={<RefreshIcon />}
                        disabled={!socket || celestialLoading || enabledCount === 0}
                        sx={DIALOG_CANCEL_BUTTON_SX}
                    >
                        {tCelestial('topbar.actions.refresh')}
                    </Button>
                    <Button
                        onClick={() => {
                            dispatch(openAddDialog());
                        }}
                        color="success"
                        variant="contained"
                        startIcon={<AddIcon />}
                        disabled={!socket || celestialLoading}
                    >
                        {tCommon('add')}
                    </Button>
                    <Button
                        onClick={() => dispatch(closeManageDialog())}
                        variant="outlined"
                        sx={DIALOG_CANCEL_BUTTON_SX}
                    >
                        {tCommon('close')}
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={deleteDialogOpen}
                onClose={() => {
                    if (celestialLoading) return;
                    setDeleteDialogOpen(false);
                    setDeleteCandidate(null);
                }}
                maxWidth="xs"
                fullWidth
                PaperProps={{ sx: DIALOG_PAPER_SX }}
            >
                <DialogTitle sx={DIALOG_TITLE_SX}>{tCelestial('topbar.dialogs.delete_title')}</DialogTitle>
                <DialogContent sx={DIALOG_CONTENT_SX}>
                    <Box sx={{ pt: 2 }}>
                        <Typography variant="body2" sx={{ mb: 1 }}>
                            {tCelestial('topbar.delete.confirm')}
                        </Typography>
                        <Typography variant="subtitle2">
                            {deleteCandidate?.displayName || tCelestial('topbar.delete.unknown_target')}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                            {String(deleteCandidate?.targetType || 'mission').toLowerCase() === 'body'
                                ? (deleteCandidate?.bodyId || '-')
                                : (deleteCandidate?.command || '-')}
                        </Typography>
                    </Box>
                </DialogContent>
                <DialogActions sx={DIALOG_ACTIONS_SX}>
                    <Button
                        onClick={() => {
                            setDeleteDialogOpen(false);
                            setDeleteCandidate(null);
                        }}
                        variant="outlined"
                        sx={DIALOG_CANCEL_BUTTON_SX}
                        disabled={celestialLoading}
                    >
                        {tCommon('cancel')}
                    </Button>
                    <Button
                        onClick={handleConfirmDelete}
                        color="error"
                        variant="contained"
                        disabled={!socket || celestialLoading || !deleteCandidate?.id}
                    >
                        {tCommon('delete')}
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={editDialogOpen}
                onClose={() => setEditDialogOpen(false)}
                maxWidth="sm"
                fullWidth
                PaperProps={{ sx: DIALOG_PAPER_SX }}
            >
                <DialogTitle sx={DIALOG_TITLE_SX}>{tCelestial('topbar.dialogs.edit_title')}</DialogTitle>
                <DialogContent sx={DIALOG_CONTENT_SX}>
                    <Stack spacing={2} sx={{ pt: 3 }}>
                        <FormControl size="small" fullWidth>
                            <InputLabel id="edit-target-type-label">{tCelestial('topbar.fields.target_type')}</InputLabel>
                            <Select
                                labelId="edit-target-type-label"
                                label={tCelestial('topbar.fields.target_type')}
                                value={editForm.targetType || 'mission'}
                                onChange={(event) =>
                                    setEditForm((prev) => ({
                                        ...prev,
                                        targetType: event.target.value,
                                        command: event.target.value === 'mission' ? prev.command : '',
                                        bodyId: event.target.value === 'body' ? prev.bodyId : '',
                                    }))
                                }
                            >
                                <MenuItem value="mission">{tCelestial('topbar.fields.mission_spacecraft')}</MenuItem>
                                <MenuItem value="body">{tCelestial('topbar.fields.solar_body')}</MenuItem>
                            </Select>
                        </FormControl>
                        <TextField
                            label={tCelestial('topbar.fields.display_name')}
                            value={editForm.displayName}
                            onChange={(event) =>
                                setEditForm((prev) => ({ ...prev, displayName: event.target.value }))
                            }
                            fullWidth
                            size="small"
                        />
                        {(editForm.targetType || 'mission') === 'mission' ? (
                            <TextField
                                label={tCelestial('topbar.fields.horizons_command')}
                                value={editForm.command}
                                onChange={(event) =>
                                    setEditForm((prev) => ({ ...prev, command: event.target.value }))
                                }
                                fullWidth
                                size="small"
                            />
                        ) : (
                            <FormControl size="small" fullWidth>
                                <InputLabel id="edit-body-target-label">{tCelestial('topbar.fields.target_body')}</InputLabel>
                                <Select
                                    labelId="edit-body-target-label"
                                    label={tCelestial('topbar.fields.target_body')}
                                    value={editForm.bodyId || ''}
                                    onChange={(event) => {
                                        const bodyId = String(event.target.value || '').toLowerCase();
                                        const selectedBody = safeBodyCatalogEntries.find(
                                            (entry) => String(entry?.body_id || '').toLowerCase() === bodyId,
                                        );
                                        setEditForm((prev) => ({
                                            ...prev,
                                            bodyId,
                                            displayName: prev.displayName || selectedBody?.name || bodyId,
                                        }));
                                    }}
                                >
                                    {safeBodyCatalogEntries.map((entry) => {
                                        const value = String(entry?.body_id || '').toLowerCase();
                                        return (
                                            <MenuItem key={value} value={value}>
                                                {entry?.name || value}
                                                {entry?.body_type ? ` (${entry.body_type})` : ''}
                                                {entry?.parent_body_id ? ` · ${entry.parent_body_id}` : ''}
                                            </MenuItem>
                                        );
                                    })}
                                </Select>
                            </FormControl>
                        )}
                        <Stack direction="row" spacing={1.5} alignItems="center">
                            <TextField
                                label={tCelestial('topbar.fields.color')}
                                value={editForm.color}
                                onChange={(event) =>
                                    setEditForm((prev) => ({ ...prev, color: normalizeHexColor(event.target.value) }))
                                }
                                placeholder={tCelestial('topbar.fields.color_placeholder')}
                                fullWidth
                                size="small"
                            />
                            <input
                                type="color"
                                aria-label={tCelestial('topbar.fields.pick_color')}
                                value={HEX_COLOR_PATTERN.test(normalizeHexColor(editForm.color)) ? normalizeHexColor(editForm.color) : '#06D6A0'}
                                onChange={(event) =>
                                    setEditForm((prev) => ({ ...prev, color: normalizeHexColor(event.target.value) }))
                                }
                                style={{
                                    width: 46,
                                    height: 36,
                                    border: '1px solid rgba(120,120,120,0.35)',
                                    borderRadius: 6,
                                    padding: 2,
                                    background: 'transparent',
                                }}
                            />
                            <Button
                                size="small"
                                onClick={() => setEditForm((prev) => ({ ...prev, color: '' }))}
                            >
                                {tCelestial('topbar.actions.clear_color')}
                            </Button>
                        </Stack>
                        {editError ? (
                            <Typography variant="body2" color="error">
                                {editError}
                            </Typography>
                        ) : null}
                    </Stack>
                </DialogContent>
                <DialogActions sx={DIALOG_ACTIONS_SX}>
                    <Button
                        onClick={() => setEditDialogOpen(false)}
                        variant="outlined"
                        sx={DIALOG_CANCEL_BUTTON_SX}
                    >
                        {tCommon('cancel')}
                    </Button>
                    <Button
                        onClick={handleSaveEdit}
                        color="success"
                        variant="contained"
                        disabled={saveLoading || !socket || celestialLoading}
                    >
                        {tCommon('save')}
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};

export default React.memo(CelestialTopBar);
