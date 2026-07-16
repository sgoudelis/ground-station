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
import Box from '@mui/material/Box';
import {DataGrid, gridClasses} from "@mui/x-data-grid";
import Stack from "@mui/material/Stack";
import {
    Alert,
    AlertTitle,
    Button,
    Checkbox,
    FormControlLabel,
    IconButton,
    InputAdornment,
    MenuItem,
    TextField,
    Typography
} from "@mui/material";
import {useEffect, useMemo, useState} from "react";
import { useTranslation } from 'react-i18next';
import DialogTitle from "@mui/material/DialogTitle";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import { alpha } from '@mui/material/styles';
import {useSocket} from "../common/socket.jsx";
import { toast } from '../../utils/toast-with-timestamp.jsx';
import {useDispatch, useSelector} from 'react-redux';
import {
    deleteRotators,
    fetchRotators,
    submitOrEditRotator,
    setOpenDeleteConfirm,
    setOpenAddDialog,
    setFormValues,
    resetFormValues,
} from './rotator-slice.jsx';
import Paper from "@mui/material/Paper";
import {toRowSelectionModel, toSelectedIds} from '../../utils/datagrid-selection.js';
import SelectionActionBar from './selection-action-bar.jsx';
import { useLocation, useNavigate } from 'react-router-dom';
import RotatorEditDialog from './rotator-edit-dialog.jsx';
import {
    applyAzimuthModeDefaults,
    DEFAULT_ROTATOR,
    prepareRotatorPayload,
    validateRotatorForm,
} from './rotator-edit-logic.js';


export default function AntennaRotatorTable() {
    const {socket} = useSocket();
    const dispatch = useDispatch();
    const location = useLocation();
    const navigate = useNavigate();
    const [selected, setSelected] = useState([]);
    const [pageSize, setPageSize] = useState(10);
    const [deleteConfirmText, setDeleteConfirmText] = useState('');
    const { t } = useTranslation('hardware');
    const {
        loading,
        rotators,
        status,
        error,
        openAddDialog,
        openDeleteConfirm,
        formValues
    } = useSelector((state) => state.rotators);
    const rowSelectionModel = useMemo(() => toRowSelectionModel(selected), [selected]);
    const isEditing = Boolean(formValues.id);
    const requiresDeleteConfirmationText = selected.length > 1;
    const canConfirmDelete = !requiresDeleteConfirmationText || deleteConfirmText.trim() === 'DELETE';
    const formatDegrees = (value) => (value === null || value === undefined || value === '' ? '' : `${value}°`);
    const formatParkDegrees = (value) =>
        (value === null || value === undefined || value === '' ? '-' : `${value}°`);
    const autoEditRotatorId = location.state?.autoEditRotatorId || null;

    useEffect(() => {
        if (!autoEditRotatorId) {
            return;
        }
        const rotatorToEdit = rotators.find((rotator) => String(rotator.id) === String(autoEditRotatorId));
        if (!rotatorToEdit) {
            return;
        }

        dispatch(setFormValues(rotatorToEdit));
        dispatch(setOpenAddDialog(true));

        const nextState = { ...(location.state || {}) };
        delete nextState.autoEditRotatorId;
        if (Object.keys(nextState).length > 0) {
            navigate(location.pathname, { replace: true, state: nextState });
        } else {
            navigate(location.pathname, { replace: true });
        }
    }, [autoEditRotatorId, dispatch, location.pathname, location.state, navigate, rotators]);

    const columns = [
        {field: 'name', headerName: t('rotator.name'), flex: 1, minWidth: 150},
        {field: 'host', headerName: t('rotator.host'), flex: 1, minWidth: 150},
        {
            field: 'port',
            headerName: t('rotator.port'),
            type: 'number',
            flex: 1,
            minWidth: 80,
            align: 'right',
            headerAlign: 'right',
            valueFormatter: (value) => {
                return value;
            }
        },
        {
            field: 'minaz',
            headerName: t('rotator.min_az'),
            type: 'number',
            flex: 1,
            minWidth: 80,
            valueFormatter: (value) => formatDegrees(value)
        },
        {
            field: 'maxaz',
            headerName: t('rotator.max_az'),
            type: 'number',
            flex: 1,
            minWidth: 80,
            valueFormatter: (value) => formatDegrees(value)
        },
        {
            field: 'azimuth_mode',
            headerName: t('rotator.azimuth_range'),
            flex: 1,
            minWidth: 140,
            valueFormatter: (value) =>
                value === '0_450'
                    ? t('rotator.azimuth_mode_0_450')
                    : value === '-180_180'
                    ? t('rotator.azimuth_mode_neg180_180')
                    : t('rotator.azimuth_mode_0_360')
        },
        {
            field: 'minel',
            headerName: t('rotator.min_el'),
            type: 'number',
            flex: 1,
            minWidth: 80,
            valueFormatter: (value) => formatDegrees(value)
        },
        {
            field: 'maxel',
            headerName: t('rotator.max_el'),
            type: 'number',
            flex: 1,
            minWidth: 80,
            valueFormatter: (value) => formatDegrees(value)
        },
        {
            field: 'parkaz',
            headerName: t('rotator.park_az'),
            type: 'number',
            flex: 1,
            minWidth: 100,
            valueFormatter: (value) => formatParkDegrees(value)
        },
        {
            field: 'parkel',
            headerName: t('rotator.park_el'),
            type: 'number',
            flex: 1,
            minWidth: 100,
            valueFormatter: (value) => formatParkDegrees(value)
        },
        {
            field: 'aztolerance',
            headerName: t('rotator.az_tolerance'),
            type: 'number',
            flex: 1,
            minWidth: 110,
            valueFormatter: (value) => formatDegrees(value)
        },
        {
            field: 'eltolerance',
            headerName: t('rotator.el_tolerance'),
            type: 'number',
            flex: 1,
            minWidth: 110,
            valueFormatter: (value) => formatDegrees(value)
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
                    aria-label={t('rotator.edit')}
                    onClick={(event) => {
                        event.stopPropagation();
                        dispatch(setFormValues(params.row));
                        dispatch(setOpenAddDialog(true));
                    }}
                >
                    <EditOutlinedIcon fontSize="small" />
                </IconButton>
            ),
        },
    ];

    // useEffect(() => {
    //     // Only dispatch if the socket is ready
    //     if (socket) {
    //         dispatch(fetchRotators({socket}));
    //     }
    // }, [dispatch, socket]);

    const handleChange = (e) => {
        const {name, value} = e.target;
        if (name === 'azimuth_mode') {
            dispatch(setFormValues(applyAzimuthModeDefaults(formValues, value)));
            return;
        }
        dispatch(setFormValues({...formValues, [name]: value}));
    };

    const handleSubmit = () => {
        dispatch(submitOrEditRotator({socket, formValues: prepareRotatorPayload(formValues)}))
            .unwrap()
            .then(() => {
                toast.success(t('rotator.saved_success'));
                setOpenAddDialog(false);
            })
            .catch((err) => {
                toast.error(err.message);
            });
    }

    const validationErrors = validateRotatorForm(formValues, t);
    const hasValidationErrors = Object.keys(validationErrors).length > 0;

    const handleDelete = () => {
        dispatch(deleteRotators({socket, selectedIds: selected}))
            .unwrap()
            .then(() => {
                toast.success(t('rotator.deleted_success'));
                dispatch(setOpenDeleteConfirm(false));
            })
            .catch((err) => {
                toast.error(err.message);
            });
    };

    return (
        <Paper elevation={3} sx={{ px: 2, pb: 2, pt: 1, marginTop: 0, borderRadius: 0 }}>
            <Box component="form">
                <Box sx={{width: '100%'}}>
                    <DataGrid
                        loading={loading}
                        rows={rotators}
                        columns={columns}
                        checkboxSelection
                        disableRowSelectionExcludeModel
                        onRowSelectionModelChange={(selected) => {
                            setSelected(toSelectedIds(selected));
                        }}
                        initialState={{
                            pagination: {paginationModel: {pageSize: 5}},
                            sorting: {
                                sortModel: [{field: 'name', sort: 'desc'}],
                            },
                        }}
                        rowSelectionModel={rowSelectionModel}
                        pageSize={pageSize}
                        pageSizeOptions={[5, 10, 25, {value: -1, label: t('shared.all')}]}
                        onPageSizeChange={(newPageSize) => setPageSize(newPageSize)}
                        rowsPerPageOptions={[5, 10, 25]}
                        getRowId={(row) => row.id}
                        localeText={{
                            noRowsLabel: t('rotator.no_rotators')
                        }}
                        sx={{
                            border: 0,
                            marginTop: 1,
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
                    <SelectionActionBar
                        selectedCount={selected.length}
                        onClearSelection={() => setSelected([])}
                        primaryActions={
                            <>
                                <Button
                                    variant="contained"
                                    onClick={() => {
                                        dispatch(resetFormValues());
                                        dispatch(setOpenAddDialog(true));
                                    }}
                                    disabled={loading}
                                >
                                    {t('rotator.add')}
                                </Button>
                                <Button
                                    variant="contained"
                                    disabled={selected.length !== 1 || loading}
                                    onClick={() => {
                                        const selectedRow = rotators.find(row => row.id === selected[0]);
                                        if (selectedRow) {
                                            dispatch(setFormValues(selectedRow));
                                            dispatch(setOpenAddDialog(true));
                                        }
                                    }}
                                >
                                    {t('rotator.edit')}
                                </Button>
                                <Button
                                    variant="contained"
                                    disabled={selected.length < 1 || loading}
                                    color="error"
                                    onClick={() => {
                                        setDeleteConfirmText('');
                                        dispatch(setOpenDeleteConfirm(true));
                                    }}
                                >
                                    {t('rotator.delete')}
                                </Button>
                            </>
                        }
                    />
                    <Stack direction="row" spacing={2} style={{marginTop: 15}}>
                        <RotatorEditDialog
                            open={openAddDialog}
                            onClose={() => dispatch(setOpenAddDialog(false))}
                            isEditing={isEditing}
                            formValues={formValues}
                            validationErrors={validationErrors}
                            hasValidationErrors={hasValidationErrors}
                            loading={loading}
                            onChange={handleChange}
                            onSubmit={handleSubmit}
                            onPatchValues={(patch) => dispatch(setFormValues(patch))}
                        />
                        <Dialog
                            open={openDeleteConfirm}
                            onClose={() => {
                                setDeleteConfirmText('');
                                dispatch(setOpenDeleteConfirm(false));
                            }}
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
                                {t('rotator.confirm_deletion')}
                            </DialogTitle>
                            <DialogContent sx={{ px: 3, pt: 3, pb: 3 }}>
                                <Typography variant="body1" sx={{ mt: 2, mb: 2, color: 'text.primary' }}>
                                    {t('rotator.confirm_delete_message')}
                                </Typography>
                                <Typography variant="body2" sx={{ mb: 2, fontWeight: 600, color: 'text.secondary' }}>
                                    {selected.length === 1
                                        ? t('rotator.delete_list_single')
                                        : t('rotator.delete_list_plural', { count: selected.length })}
                                </Typography>
                                {requiresDeleteConfirmationText && (
                                    <TextField
                                        fullWidth
                                        size="small"
                                        label={t('common.type_delete_to_confirm', 'Type DELETE to confirm')}
                                        value={deleteConfirmText}
                                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                                        sx={{ mb: 2 }}
                                    />
                                )}
                                <Box sx={{
                                    maxHeight: 300,
                                    overflowY: 'auto',
                                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
                                    borderRadius: 1,
                                    border: (theme) => `1px solid ${theme.palette.divider}`,
                                }}>
                                    {selected.map((id, index) => {
                                        const rotator = rotators.find(r => r.id === id);
                                        if (!rotator) return null;
                                        return (
                                            <Box
                                                key={id}
                                                sx={{
                                                    p: 2,
                                                    borderBottom: index < selected.length - 1 ? (theme) => `1px solid ${theme.palette.divider}` : 'none',
                                                }}
                                            >
                                                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: 'text.primary' }}>
                                                    {rotator.name}
                                                </Typography>
                                                <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 1, columnGap: 2 }}>
                                                    <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                                        {t('rotator.host')}:
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                                        {rotator.host}:{rotator.port}
                                                    </Typography>

                                                    <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                                        {t('rotator.azimuth_range')}:
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                                        {rotator.minaz}° - {rotator.maxaz}°
                                                    </Typography>

                                                    <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                                        {t('rotator.elevation_range')}:
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                                        {rotator.minel}° - {rotator.maxel}°
                                                    </Typography>
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
                                    onClick={() => dispatch(setOpenDeleteConfirm(false))}
                                    variant="outlined"
                                    color="inherit"
                                    sx={{
                                        minWidth: 100,
                                        textTransform: 'none',
                                        fontWeight: 500,
                                    }}
                                >
                                    {t('rotator.cancel')}
                                </Button>
                                <Button
                                    variant="contained"
                                    onClick={handleDelete}
                                    color="error"
                                    disabled={!canConfirmDelete || loading}
                                    sx={{
                                        minWidth: 100,
                                        textTransform: 'none',
                                        fontWeight: 600,
                                    }}
                                >
                                    {t('rotator.delete')}
                                </Button>
                            </DialogActions>
                        </Dialog>
                    </Stack>
                </Box>
            </Box>
            <Alert severity="info" sx={{ mt: 2 }}>
                <AlertTitle>{t('rotator.title')}</AlertTitle>
                {t('rotator.subtitle')}
            </Alert>
        </Paper>

    );
}
