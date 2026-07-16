
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


import * as React from 'react';
import {useMemo} from 'react';
import {DataGrid, gridClasses} from '@mui/x-data-grid';
import { tabsClasses } from '@mui/material/Tabs';
import {
    Box,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    Stack, Select, MenuItem, FormControl, InputLabel, Typography, FormControlLabel, Switch,
    IconButton,
    FormHelperText,
    Accordion,
    AccordionSummary,
    AccordionDetails,
} from "@mui/material";
import { alpha } from '@mui/material/styles';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { useTranslation } from 'react-i18next';
import {useDispatch, useSelector} from 'react-redux';
import {
    submitOrEditOrbitalSource,
    deleteOrbitalSources,
} from './sources-slice.jsx';
import {betterDateTimes} from "../common/common.jsx";
import { toast } from '../../utils/toast-with-timestamp.jsx';
import {useSocket} from "../common/socket.jsx";
import {setFormValues, setOpenAddDialog, setOpenDeleteConfirm, setSelected} from "./sources-slice.jsx"
import SynchronizeOrbitalDataCard from "./synchronize-orbital-data-card.jsx";
import {toRowSelectionModel, toSelectedIds} from '../../utils/datagrid-selection.js';
import { AntTab, AntTabs } from '../common/common.jsx';

const paginationModel = {page: 0, pageSize: 10};

const PROVIDER_OPTIONS = ['generic_http', 'space_track'];
const ADAPTER_OPTIONS = ['http_3le', 'http_omm', 'space_track_gp'];
const FORMAT_OPTIONS = ['3le', 'omm'];
const CENTRAL_BODY_OPTIONS = ['earth', 'moon', 'mars'];
const AUTH_TYPE_OPTIONS = ['none', 'basic', 'token'];
const SPACE_TRACK_GP_BASE_URL = 'https://www.space-track.org/basicspacedata/query/class/gp';

const getOrbitalSourcesTabsSx = (theme) => {
    const isDark = theme.palette.mode === 'dark';
    const fallbackDetailRow = isDark
        ? { background: '#24292f', selected: '#323942' }
        : { background: '#edf2f8', selected: '#ffffff' };

    const detailRow = theme.palette.settingsTabs?.detailRow || {};
    const borderColor = theme.palette.settingsTabs?.border
        || (isDark ? '#50565f' : '#c5cfdd');

    return {
        backgroundColor: detailRow.background || fallbackDetailRow.background,
        borderBottom: `1px solid ${borderColor}`,
        '& .MuiTabs-indicator': {
            display: 'none',
        },
        '& .MuiTab-root': {
            color: theme.palette.text.secondary,
            minHeight: 48,
            padding: '12px 16px',
            transition: 'background-color 140ms ease, color 140ms ease',
        },
        '& .MuiTab-root.Mui-selected': {
            backgroundColor: detailRow.selected || fallbackDetailRow.selected,
            color: theme.palette.text.primary,
        },
        [`& .${tabsClasses.scrollButtons}`]: {
            '&.Mui-disabled': { opacity: 0.3 },
        },
    };
};

const normalizeProvider = (provider) => {
    const normalized = String(provider || 'generic_http').toLowerCase();
    return normalized === 'celestrak' ? 'generic_http' : normalized;
};

const getProviderLabel = (provider, t) => {
    const normalizedProvider = normalizeProvider(provider);
    return t(`orbital_sources.providers.${normalizedProvider}`, {defaultValue: normalizedProvider});
};

const getProviderOptionLabel = (provider, t) => {
    const normalizedProvider = normalizeProvider(provider);
    return t(`orbital_sources.provider_option_${normalizedProvider}`, {
        defaultValue: getProviderLabel(normalizedProvider, t),
    });
};

const buildSuggestedSourceName = (formValues, t) => {
    const provider = normalizeProvider(formValues.provider);
    if (provider === 'space_track') {
        return t('orbital_sources.default_names.space_track_norad', {
            defaultValue: 'Space-Track - NORAD IDs',
        });
    }

    return t(`orbital_sources.default_names.${provider}`, {
        defaultValue: `${getProviderLabel(provider, t)} Source`,
    });
};

const shouldApplySuggestedSourceName = (formValues, t) => {
    const currentName = String(formValues.name || '').trim();
    if (!currentName) {
        return true;
    }
    return currentName === buildSuggestedSourceName(formValues, t);
};

const getAdapterForProviderAndFormat = (provider, format) => {
    if (normalizeProvider(provider) === 'space_track') {
        return 'space_track_gp';
    }
    return format === 'omm' ? 'http_omm' : 'http_3le';
};

const getFormatOptionLabel = (format, provider) => {
    const normalizedProvider = normalizeProvider(provider);
    if (normalizedProvider !== 'generic_http') {
        return format.toUpperCase();
    }
    if (format === '3le') {
        return '3LE (TLE/3LE)';
    }
    if (format === 'omm') {
        return 'OMM (OMM-XML, JSON, JSON-PP, CSV)';
    }
    return format.toUpperCase();
};

const normalizeNoradIds = (rawValue) => {
    if (Array.isArray(rawValue)) {
        return [...new Set(
            rawValue
                .map((item) => Number(item))
                .filter((item) => Number.isInteger(item) && item > 0)
        )];
    }
    const text = String(rawValue || '').trim();
    if (!text) {
        return [];
    }
    const tokens = text.split(/[\s,]+/).filter(Boolean);
    return [...new Set(
        tokens
            .map((item) => Number(item))
            .filter((item) => Number.isInteger(item) && item > 0)
    )];
};

const defaultFormValues = {
    id: null,
    name: '',
    url: '',
    format: '3le',
    query_mode: 'url',
    group_id: '',
    norad_ids: '',
    provider: 'generic_http',
    adapter: 'http_3le',
    enabled: true,
    priority: '100',
    central_body: 'earth',
    auth_type: 'none',
    username: '',
    password: '',
};

export function toFormValues(source) {
    if (!source) {
        return {...defaultFormValues};
    }

    return {
        id: source.id ?? null,
        name: source.name ?? '',
        url: source.url ?? '',
        format: String(source.format ?? defaultFormValues.format).toLowerCase(),
        query_mode: String(source.query_mode ?? defaultFormValues.query_mode).toLowerCase(),
        group_id: source.group_id ?? '',
        norad_ids: Array.isArray(source.norad_ids)
            ? source.norad_ids.join(', ')
            : (typeof source.norad_ids === 'string' ? source.norad_ids : ''),
        provider: normalizeProvider(source.provider ?? defaultFormValues.provider),
        adapter: String(source.adapter ?? defaultFormValues.adapter).toLowerCase(),
        enabled: source.enabled === undefined ? true : Boolean(source.enabled),
        priority: String(source.priority ?? '100'),
        central_body: String(source.central_body ?? defaultFormValues.central_body).toLowerCase(),
        auth_type: String(source.auth_type ?? defaultFormValues.auth_type).toLowerCase(),
        username: source.username ?? '',
        password: source.password ?? '',
    };
}

export function validateSourceForm(formValues, t) {
    const errors = {};

    const provider = normalizeProvider(String(formValues.provider || '').trim().toLowerCase());
    const format = String(formValues.format || '').trim().toLowerCase();
    const queryMode = 'url';
    const name = String(formValues.name || '').trim();
    const rawUrl = String(formValues.url || '').trim();
    const url = provider === 'space_track' ? SPACE_TRACK_GP_BASE_URL : rawUrl;
    const requestedAdapter = String(formValues.adapter || '').trim().toLowerCase();
    const adapter = provider === 'space_track' || requestedAdapter === 'space_track_gp'
        ? getAdapterForProviderAndFormat(provider, format)
        : requestedAdapter || getAdapterForProviderAndFormat(provider, format);
    const centralBody = String(formValues.central_body || '').trim().toLowerCase();
    const authType = provider === 'space_track'
        ? 'basic'
        : String(formValues.auth_type || '').trim().toLowerCase();
    const username = String(formValues.username || '').trim();
    const password = String(formValues.password || '').trim();
    const priorityRaw = String(formValues.priority ?? '').trim();
    const noradIds = provider === 'space_track' ? normalizeNoradIds(formValues.norad_ids) : [];

    if (!name) {
        errors.name = t('orbital_sources.validation.required');
    }

    if (provider !== 'space_track' && !url) {
        errors.url = t('orbital_sources.validation.required');
    } else if (provider !== 'space_track') {
        try {
            const parsedUrl = new URL(url);
            if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
                errors.url = t('orbital_sources.validation.url_http_https');
            }
        } catch {
            errors.url = t('orbital_sources.validation.url_invalid');
        }
    }

    if (!PROVIDER_OPTIONS.includes(provider)) {
        errors.provider = t('orbital_sources.validation.invalid_option');
    }
    if (!ADAPTER_OPTIONS.includes(adapter)) {
        errors.adapter = t('orbital_sources.validation.invalid_option');
    }
    if (!FORMAT_OPTIONS.includes(format)) {
        errors.format = t('orbital_sources.validation.invalid_option');
    }
    if (!CENTRAL_BODY_OPTIONS.includes(centralBody)) {
        errors.central_body = t('orbital_sources.validation.invalid_option');
    }
    if (!AUTH_TYPE_OPTIONS.includes(authType)) {
        errors.auth_type = t('orbital_sources.validation.invalid_option');
    }

    const priority = Number(priorityRaw);
    if (!Number.isInteger(priority) || priority < 0) {
        errors.priority = t('orbital_sources.validation.priority');
    }

    if (authType === 'basic') {
        if (!username) {
            errors.username = t('orbital_sources.validation.required');
        }
        if (!password) {
            errors.password = t('orbital_sources.validation.required');
        }
    }
    if (authType === 'token' && !password) {
        errors.password = t('orbital_sources.validation.required');
    }

    if (provider === 'space_track' && noradIds.length === 0) {
        errors.norad_ids = t('orbital_sources.validation.norad_ids_required');
    }

    if (adapter === 'space_track_gp') {
        if (provider !== 'space_track') {
            errors.provider = t('orbital_sources.validation.space_track_provider');
        }
        if (authType !== 'basic') {
            errors.auth_type = t('orbital_sources.validation.space_track_auth');
        }
        if (!username || !password) {
            errors.username = t('orbital_sources.validation.space_track_creds');
            errors.password = t('orbital_sources.validation.space_track_creds');
        }
    }

    return {
        errors,
        payload: {
            id: formValues.id ?? null,
            name,
            url,
            format,
            query_mode: queryMode,
            group_id: null,
            norad_ids: provider === 'space_track' ? noradIds : null,
            provider,
            adapter,
            enabled: Boolean(formValues.enabled),
            priority,
            central_body: centralBody,
            auth_type: authType,
            username: authType === 'none' || authType === 'token' ? null : username || null,
            password: authType === 'none' ? null : password || null,
        },
    };
}

export default function SourcesTable() {
    const dispatch = useDispatch();
    const {socket} = useSocket();
    const { t } = useTranslation('satellites');
    const {tleSources, loading, formValues, openDeleteConfirm, openAddDialog, selected} = useSelector((state) => state.tleSources);
    const rowSelectionModel = useMemo(() => toRowSelectionModel(selected), [selected]);
    const [activeTab, setActiveTab] = React.useState('sync_now');

    // Get timezone preference
    const timezone = useSelector((state) => {
        const tzPref = state.preferences?.preferences?.find(p => p.name === 'timezone');
        return tzPref?.value || 'UTC';
    });

    const columns = [
        {field: 'name', headerName: t('orbital_sources.name'), minWidth: 170, flex: 1},
        {field: 'url', headerName: t('orbital_sources.url'), minWidth: 260, flex: 2},
        {
            field: 'provider',
            headerName: t('orbital_sources.provider'),
            width: 150,
            renderCell: (params) => getProviderLabel(params.value, t),
        },
        {field: 'format', headerName: t('orbital_sources.format'), width: 90},
        {field: 'auth_type', headerName: t('orbital_sources.auth_type'), width: 110},
        {
            field: 'enabled',
            headerName: t('orbital_sources.enabled'),
            width: 90,
            renderCell: (params) => (params.value ? t('orbital_sources.enabled_yes') : t('orbital_sources.enabled_no')),
        },
        {
            field: 'added',
            headerName: t('orbital_sources.added'),
            flex: 1,
            align: 'right',
            headerAlign: 'right',
            width: 100,
            renderCell: (params) => {
                return betterDateTimes(params.value, timezone);
            }
        },
        {
            field: 'updated',
            headerName: t('orbital_sources.updated'),
            flex: 1,
            width: 100,
            align: 'right',
            headerAlign: 'right',
            renderCell: (params) => {
                return betterDateTimes(params.value, timezone);
            }
        },
        {
            field: 'row_actions',
            headerName: '',
            width: 56,
            sortable: false,
            filterable: false,
            disableColumnMenu: true,
            align: 'center',
            headerAlign: 'center',
            renderCell: (params) => (
                <IconButton
                    size="small"
                    aria-label={t('orbital_sources.edit')}
                    onClick={(event) => {
                        event.stopPropagation();
                        dispatch(setFormValues(toFormValues(params.row)));
                        dispatch(setOpenAddDialog(true));
                    }}
                >
                    <EditOutlinedIcon fontSize="small" />
                </IconButton>
            ),
        },
    ];

    const handleAddClick = () => {
        dispatch(setFormValues(defaultFormValues));
        dispatch(setOpenAddDialog(true));
    };

    const handleClose = () => {
        dispatch(setOpenAddDialog(false));
    };

    const handleInputChange = (e) => {
        const {name, value, type, checked} = e.target;
        const nextValue = type === 'checkbox' ? checked : value;
        const nextValues = {...formValues, [name]: nextValue};

        if (name === 'provider' && value === 'space_track') {
            nextValues.query_mode = 'url';
            nextValues.adapter = 'space_track_gp';
            nextValues.format = 'omm';
            nextValues.auth_type = 'basic';
            nextValues.url = SPACE_TRACK_GP_BASE_URL;
        }
        if (name === 'provider' && value !== 'space_track') {
            nextValues.query_mode = 'url';
            nextValues.auth_type = 'none';
            nextValues.username = '';
            nextValues.password = '';
            nextValues.norad_ids = '';
            nextValues.adapter = getAdapterForProviderAndFormat(value, nextValues.format);
            if (nextValues.url === SPACE_TRACK_GP_BASE_URL) {
                nextValues.url = '';
            }
        }
        if (name === 'format' && nextValues.provider !== 'space_track') {
            nextValues.adapter = getAdapterForProviderAndFormat(nextValues.provider, value);
        }
        // Keep Space-Track defaults coherent when selecting the dedicated adapter.
        if (name === 'adapter' && value === 'space_track_gp') {
            nextValues.provider = 'space_track';
            nextValues.auth_type = 'basic';
            nextValues.format = nextValues.format || 'omm';
            nextValues.url = SPACE_TRACK_GP_BASE_URL;
        }
        if (
            ['provider'].includes(name)
            && shouldApplySuggestedSourceName(formValues, t)
        ) {
            nextValues.name = buildSuggestedSourceName(nextValues, t);
        }
        dispatch(setFormValues(nextValues));
    };

    const handleEditClick = () => {
        const singleRowId = selected[0];
        const selectedSource = tleSources.find(r => r.id === singleRowId);
        dispatch(setFormValues(toFormValues(selectedSource)));
        dispatch(setOpenAddDialog(true));
    };

    const handleDeleteClick = () => {
        dispatch(deleteOrbitalSources({socket, selectedIds: selected}))
            .unwrap()
            .then((data) => {
                toast.success(data.message, {
                    autoClose: 4000,
                })
            })
            .catch((error) => {
                toast.error(t('orbital_sources.failed_delete') + ": " + error, {
                    autoClose: 5000,
                })
            })
        dispatch(setOpenDeleteConfirm(false));
    };

    const handleSubmit = () => {
        if (hasValidationErrors) {
            return;
        }
        const submitPayload = validationResult.payload;
        if (formValues.id === null) {
            dispatch(submitOrEditOrbitalSource({socket, formValues: submitPayload}))
                .unwrap()
                .then(() => {
                    toast.success(t('orbital_sources.added_success'), {
                        autoClose: 4000,
                    })
                })
                .catch((error) => {
                    toast.error(t('orbital_sources.failed_add') + ": " + error)
                });
        } else {
            dispatch(submitOrEditOrbitalSource({socket, formValues: submitPayload}))
                .unwrap()
                .then(() => {
                    toast.success(t('orbital_sources.updated_success'), {
                        autoClose: 4000,
                    })
                })
                .catch((error) => {
                    toast.error(t('orbital_sources.failed_update') + ": " + error)
                });
        }
        dispatch(setOpenAddDialog(false));
    };

    const normalizedFormValues = toFormValues(formValues);
    const isSpaceTrackSource = normalizedFormValues.provider === 'space_track';
    const validationResult = validateSourceForm(normalizedFormValues, t);
    const validationErrors = validationResult.errors;
    const hasValidationErrors = Object.keys(validationErrors).length > 0;

    return (
        <Box sx={{width: '100%', marginTop: 0}}>
            <AntTabs
                value={activeTab}
                onChange={(_event, nextTab) => setActiveTab(nextTab)}
                variant="scrollable"
                scrollButtons
                allowScrollButtonsMobile
                data-testid="orbital-data-tabs"
                aria-label={t('orbital_sources.tabs.aria', { defaultValue: 'orbital source tabs' })}
                sx={getOrbitalSourcesTabsSx}
            >
                <AntTab
                    value="sync_now"
                    data-testid="orbital-data-tab-sync-now"
                    label={t('orbital_sources.tabs.sync_now', { defaultValue: 'Sync Now' })}
                />
                <AntTab
                    value="sources"
                    data-testid="orbital-data-tab-sources"
                    label={t('orbital_sources.tabs.sources', { defaultValue: 'Sources' })}
                />
            </AntTabs>

            {activeTab === 'sources' ? (
            <Box sx={{ pt: 2, px: 2 }}>
            <Box>
                <DataGrid
                    loading={loading}
                    rows={tleSources}
                    columns={columns}
                    initialState={{pagination: {paginationModel}}}
                    pageSizeOptions={[5, 10, 25, 50, 100]}
                    checkboxSelection={true}
                    disableRowSelectionOnClick
                    onRowSelectionModelChange={(selected) => {
                        dispatch(setSelected(toSelectedIds(selected)));
                    }}
                    rowSelectionModel={rowSelectionModel}
                    sx={{
                        border: 0,
                        marginTop: 0,
                        [`& .${gridClasses.cell}:focus, & .${gridClasses.cell}:focus-within`]: {
                            outline: 'none',
                        },
                        [`& .${gridClasses.columnHeader}:focus, & .${gridClasses.columnHeader}:focus-within`]:
                            {
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
                    }}
                />
                <Stack direction="row" spacing={2} sx={{marginTop: 2}}>
                    <Button variant="contained" onClick={handleAddClick}>
                        {t('orbital_sources.add')}
                    </Button>
                    <Button variant="contained" disabled={selected.length !== 1} onClick={handleEditClick}>
                        {t('orbital_sources.edit')}
                    </Button>
                    <Button variant="contained" color="error" disabled={selected.length < 1}
                            onClick={() => dispatch(setOpenDeleteConfirm(true))}>
                        {t('orbital_sources.delete')}
                    </Button>
                    <Dialog
                        open={openDeleteConfirm}
                        onClose={() => dispatch(setOpenDeleteConfirm(false))}
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
                            {t('orbital_sources.confirm_deletion')}
                        </DialogTitle>
                        <DialogContent sx={{ px: 3, pt: 3, pb: 3 }}>
                            <Typography variant="body1" sx={{ mt: 2, mb: 2, color: 'text.primary' }}>
                                {t('orbital_sources.confirm_delete_intro')}
                            </Typography>
                            <Typography variant="body2" sx={{ mb: 2, fontWeight: 600, color: 'text.secondary' }}>
                                {selected.length === 1 ? 'Orbital source to be deleted:' : `${selected.length} orbital sources to be deleted:`}
                            </Typography>
                            <Box sx={{
                                maxHeight: 300,
                                overflowY: 'auto',
                                bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
                                borderRadius: 1,
                                border: (theme) => `1px solid ${theme.palette.divider}`,
                            }}>
                                {selected.map((id, index) => {
                                    const source = tleSources.find(s => s.id === id);
                                    if (!source) return null;
                                    return (
                                        <Box
                                            key={id}
                                            sx={{
                                                p: 2,
                                                borderBottom: index < selected.length - 1 ? (theme) => `1px solid ${theme.palette.divider}` : 'none',
                                            }}
                                        >
                                            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: 'text.primary' }}>
                                                {source.name}
                                            </Typography>
                                            <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 1, columnGap: 2 }}>
                                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                                    URL:
                                                </Typography>
                                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary', wordBreak: 'break-all' }}>
                                                    {source.url}
                                                </Typography>

                                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                                    Format:
                                                </Typography>
                                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                                    {source.format}
                                                </Typography>

                                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                                    Provider:
                                                </Typography>
                                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                                    {getProviderLabel(source.provider, t)}
                                                </Typography>

                                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                                    Added:
                                                </Typography>
                                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                                    {betterDateTimes(source.added, timezone)}
                                                </Typography>
                                            </Box>
                                        </Box>
                                    );
                                })}
                            </Box>
                            <Box sx={{ mt: 2, p: 2, bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50', borderRadius: 1 }}>
                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'warning.main', fontWeight: 500, mb: 1 }}>
                                    {t('orbital_sources.cannot_undo')}
                                </Typography>
                                <Typography component="div" variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary' }}>
                                    <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
                                        <li>{t('orbital_sources.delete_item_1')}</li>
                                        <li>{t('orbital_sources.delete_item_2')}</li>
                                        <li>{t('orbital_sources.delete_item_3')}</li>
                                    </ul>
                                </Typography>
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
                                onClick={() => dispatch(setOpenDeleteConfirm(false))}
                                variant="outlined"
                                color="inherit"
                                sx={{
                                    minWidth: 100,
                                    textTransform: 'none',
                                    fontWeight: 500,
                                }}
                            >
                                {t('orbital_sources.cancel')}
                            </Button>
                            <Button
                                variant="contained"
                                color="error"
                                onClick={handleDeleteClick}
                                sx={{
                                    minWidth: 100,
                                    textTransform: 'none',
                                    fontWeight: 600,
                                }}
                            >
                                {t('orbital_sources.delete')}
                            </Button>
                        </DialogActions>
                    </Dialog>
                </Stack>
                <Dialog
                    open={openAddDialog}
                    onClose={handleClose}
                    fullWidth
                    maxWidth="sm"
                    PaperProps={{
                        sx: {
                            bgcolor: 'background.paper',
                            border: (theme) => `1px solid ${theme.palette.divider}`,
                            borderRadius: 2,
                        }
                    }}
                >
                    <DialogTitle
                        sx={{
                            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
                            borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                            fontSize: '1.25rem',
                            fontWeight: 'bold',
                            py: 2.5,
                        }}
                    >
                        {formValues.id ? t('orbital_sources.dialog_title_edit') : t('orbital_sources.dialog_title_add')}
                    </DialogTitle>
                    <DialogContent sx={{ px: 3, py: 3 }}>
                        <Stack spacing={2} sx={{ mt: 3 }}>
                            <FormControl fullWidth size="small" error={Boolean(validationErrors.provider)}>
                                <InputLabel id="provider-label">{t('orbital_sources.provider')}</InputLabel>
                                <Select
                                    label={t('orbital_sources.provider')}
                                    name="provider"
                                    value={normalizedFormValues.provider}
                                    onChange={handleInputChange}
                                    size="small"
                                >
                                    {PROVIDER_OPTIONS.map((provider) => (
                                        <MenuItem key={provider} value={provider}>
                                            {getProviderOptionLabel(provider, t)}
                                        </MenuItem>
                                    ))}
                                </Select>
                                {validationErrors.provider && (
                                    <FormHelperText>{validationErrors.provider}</FormHelperText>
                                )}
                            </FormControl>
                            <TextField
                                label={t('orbital_sources.name')}
                                name="name"
                                value={normalizedFormValues.name}
                                onChange={handleInputChange}
                                size="small"
                                fullWidth
                                error={Boolean(validationErrors.name)}
                                helperText={validationErrors.name || ' '}
                            />
                            <Box
                                sx={(theme) => ({
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    gap: 1,
                                    px: 1.25,
                                    py: 1,
                                    borderRadius: 1,
                                    border: `1px solid ${theme.palette.divider}`,
                                    bgcolor: alpha(
                                        theme.palette.primary.main,
                                        theme.palette.mode === 'dark' ? 0.14 : 0.06
                                    ),
                                })}
                            >
                                <InfoOutlinedIcon sx={{ fontSize: 16, color: 'text.secondary', mt: '1px' }} />
                                <Typography variant="caption" color="text.secondary">
                                    {t('orbital_sources.system_group_notice')}
                                </Typography>
                            </Box>

                            {!isSpaceTrackSource && (
                                <TextField
                                    label={t('orbital_sources.url')}
                                    name="url"
                                    value={normalizedFormValues.url}
                                    onChange={handleInputChange}
                                    size="small"
                                    fullWidth
                                    error={Boolean(validationErrors.url)}
                                    helperText={validationErrors.url || ' '}
                                />
                            )}

                            {isSpaceTrackSource && (
                                <TextField
                                    label={t('orbital_sources.norad_ids')}
                                    name="norad_ids"
                                    value={normalizedFormValues.norad_ids}
                                    onChange={handleInputChange}
                                    placeholder={t('orbital_sources.norad_ids_placeholder')}
                                    size="small"
                                    fullWidth
                                    multiline
                                    minRows={2}
                                    error={Boolean(validationErrors.norad_ids)}
                                    helperText={validationErrors.norad_ids || t('orbital_sources.norad_ids_hint')}
                                />
                            )}

                            {!isSpaceTrackSource && (
                                <FormControl fullWidth size="small" error={Boolean(validationErrors.format)}>
                                    <InputLabel id="format-label">{t('orbital_sources.format')}</InputLabel>
                                    <Select
                                        label={t('orbital_sources.format')}
                                        name="format"
                                        value={normalizedFormValues.format}
                                        onChange={handleInputChange}
                                        size="small"
                                    >
                                        {FORMAT_OPTIONS.map((format) => (
                                            <MenuItem key={format} value={format}>
                                                {getFormatOptionLabel(format, normalizedFormValues.provider)}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                    {validationErrors.format && (
                                        <FormHelperText>{validationErrors.format}</FormHelperText>
                                    )}
                                    <FormHelperText>{t('orbital_sources.format_hint')}</FormHelperText>
                                </FormControl>
                            )}

                            {isSpaceTrackSource && (
                                <>
                                    <TextField
                                        label={t('orbital_sources.username')}
                                        name="username"
                                        value={normalizedFormValues.username}
                                        onChange={handleInputChange}
                                        size="small"
                                        fullWidth
                                        error={Boolean(validationErrors.username)}
                                        helperText={validationErrors.username || ' '}
                                    />
                                    <TextField
                                        label={t('orbital_sources.password')}
                                        name="password"
                                        type="password"
                                        value={normalizedFormValues.password}
                                        onChange={handleInputChange}
                                        size="small"
                                        fullWidth
                                        error={Boolean(validationErrors.password)}
                                        helperText={validationErrors.password || ' '}
                                    />
                                </>
                            )}

                            <Stack
                                direction={{ xs: 'column', sm: 'row' }}
                                spacing={2}
                                alignItems={{ xs: 'stretch', sm: 'flex-start' }}
                            >
                                <TextField
                                    label={t('orbital_sources.priority')}
                                    name="priority"
                                    type="number"
                                    value={normalizedFormValues.priority}
                                    onChange={handleInputChange}
                                    size="small"
                                    fullWidth
                                    error={Boolean(validationErrors.priority)}
                                    helperText={
                                        validationErrors.priority || t('orbital_sources.priority_hint')
                                    }
                                    inputProps={{min: 0, step: 1}}
                                />
                                <FormControlLabel
                                    sx={{ minHeight: 40, alignItems: 'center' }}
                                    control={
                                        <Switch
                                            name="enabled"
                                            checked={Boolean(normalizedFormValues.enabled)}
                                            onChange={handleInputChange}
                                        />
                                    }
                                    label={t('orbital_sources.enabled')}
                                />
                            </Stack>

                            <Accordion disableGutters>
                                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                    <Typography variant="subtitle2">
                                        {t('orbital_sources.advanced_settings')}
                                    </Typography>
                                </AccordionSummary>
                                <AccordionDetails>
                                    <Stack spacing={2}>
                                        {isSpaceTrackSource && (
                                            <FormControl fullWidth size="small" error={Boolean(validationErrors.format)}>
                                                <InputLabel id="format-label-advanced">{t('orbital_sources.format')}</InputLabel>
                                                <Select
                                                    label={t('orbital_sources.format')}
                                                    name="format"
                                                    value={normalizedFormValues.format}
                                                    onChange={handleInputChange}
                                                    size="small"
                                                >
                                                    {FORMAT_OPTIONS.map((format) => (
                                                        <MenuItem key={format} value={format}>
                                                            {getFormatOptionLabel(format, normalizedFormValues.provider)}
                                                        </MenuItem>
                                                    ))}
                                                </Select>
                                                {validationErrors.format && (
                                                    <FormHelperText>{validationErrors.format}</FormHelperText>
                                                )}
                                                <FormHelperText>{t('orbital_sources.format_hint')}</FormHelperText>
                                            </FormControl>
                                        )}
                                        <FormControl fullWidth size="small" error={Boolean(validationErrors.central_body)}>
                                            <InputLabel id="central-body-label">{t('orbital_sources.central_body')}</InputLabel>
                                            <Select
                                                label={t('orbital_sources.central_body')}
                                                name="central_body"
                                                value={normalizedFormValues.central_body}
                                                onChange={handleInputChange}
                                                size="small"
                                            >
                                                {CENTRAL_BODY_OPTIONS.map((body) => (
                                                    <MenuItem key={body} value={body}>
                                                        {body}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                            {validationErrors.central_body && (
                                                <FormHelperText>{validationErrors.central_body}</FormHelperText>
                                            )}
                                        </FormControl>
                                        {!isSpaceTrackSource && (
                                            <FormControl fullWidth size="small" error={Boolean(validationErrors.auth_type)}>
                                                <InputLabel id="auth-type-label">{t('orbital_sources.auth_type')}</InputLabel>
                                                <Select
                                                    label={t('orbital_sources.auth_type')}
                                                    name="auth_type"
                                                    value={normalizedFormValues.auth_type}
                                                    onChange={handleInputChange}
                                                    size="small"
                                                >
                                                    {AUTH_TYPE_OPTIONS.map((authType) => (
                                                        <MenuItem key={authType} value={authType}>
                                                            {authType}
                                                        </MenuItem>
                                                    ))}
                                                </Select>
                                                {validationErrors.auth_type && (
                                                    <FormHelperText>{validationErrors.auth_type}</FormHelperText>
                                                )}
                                            </FormControl>
                                        )}
                                        {!isSpaceTrackSource && normalizedFormValues.auth_type !== 'none' && (
                                            <>
                                                <TextField
                                                    label={t('orbital_sources.username')}
                                                    name="username"
                                                    value={normalizedFormValues.username}
                                                    onChange={handleInputChange}
                                                    size="small"
                                                    fullWidth
                                                    error={Boolean(validationErrors.username)}
                                                    helperText={validationErrors.username || ' '}
                                                />
                                                <TextField
                                                    label={t('orbital_sources.password')}
                                                    name="password"
                                                    type="password"
                                                    value={normalizedFormValues.password}
                                                    onChange={handleInputChange}
                                                    size="small"
                                                    fullWidth
                                                    error={Boolean(validationErrors.password)}
                                                    helperText={validationErrors.password || ' '}
                                                />
                                            </>
                                        )}
                                    </Stack>
                                </AccordionDetails>
                            </Accordion>
                        </Stack>
                    </DialogContent>
                    <DialogActions
                        sx={{
                            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
                            borderTop: (theme) => `1px solid ${theme.palette.divider}`,
                            px: 3,
                            py: 2.5,
                            gap: 2,
                        }}
                    >
                        <Button
                            onClick={handleClose}
                            variant="outlined"
                            sx={{
                                borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.700' : 'grey.400',
                                '&:hover': {
                                    borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.600' : 'grey.500',
                                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.200',
                                },
                            }}
                        >
                            {t('orbital_sources.cancel')}
                        </Button>
                        <Button
                            variant="contained"
                            onClick={handleSubmit}
                            disabled={hasValidationErrors}
                                color="success">{formValues.id ? t('orbital_sources.edit') : t('orbital_sources.submit')}</Button>
                    </DialogActions>
                </Dialog>
            </Box>
            </Box>
            ) : null}

            {activeTab === 'sync_now' ? (
                <Box sx={{ pt: 2, px: 2 }}>
                    <SynchronizeOrbitalDataCard/>
                </Box>
            ) : null}
        </Box>
    );
}
