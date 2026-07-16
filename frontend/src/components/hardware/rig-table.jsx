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
import {
    Alert,
    AlertTitle,
    Button,
    FormControl,
    FormHelperText,
    IconButton,
    InputLabel,
    MenuItem,
    Select,
    TextField,
    Typography
} from "@mui/material";
import { useTranslation } from 'react-i18next';
import Stack from "@mui/material/Stack";
import DialogTitle from "@mui/material/DialogTitle";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import { alpha } from '@mui/material/styles';
import {useSocket} from "../common/socket.jsx";
import {useDispatch, useSelector} from 'react-redux';
import {
    fetchRigs,
    deleteRigs,
    setSelected,
    submitOrEditRig,
    setOpenDeleteConfirm,
    setFormValues,
    setOpenAddDialog,
} from './rig-slice.jsx';
import { toast } from '../../utils/toast-with-timestamp.jsx';
import {DataGrid, gridClasses} from "@mui/x-data-grid";
import Paper from "@mui/material/Paper";
import {toRowSelectionModel, toSelectedIds} from '../../utils/datagrid-selection.js';
import SelectionActionBar from './selection-action-bar.jsx';
import { useLocation, useNavigate } from 'react-router-dom';
import RigEditDialog from './rig-edit-dialog.jsx';
import { DEFAULT_RIG, validateRigForm } from './rig-edit-logic.js';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';


export default function RigTable() {
    const dispatch = useDispatch();
    const {socket} = useSocket();
    const location = useLocation();
    const navigate = useNavigate();
    const [deleteConfirmText, setDeleteConfirmText] = React.useState('');
    const {rigs, loading, selected, openDeleteConfirm, formValues, openAddDialog} = useSelector((state) => state.rigs);
    const rowSelectionModel = React.useMemo(() => toRowSelectionModel(selected), [selected]);
    const requiresDeleteConfirmationText = selected.length > 1;
    const canConfirmDelete = !requiresDeleteConfirmationText || deleteConfirmText.trim() === 'DELETE';
    const { t } = useTranslation('hardware');
    const isEditing = Boolean(formValues.id);

    const [pageSize, setPageSize] = React.useState(10);
    const autoEditRigId = location.state?.autoEditRigId || null;

    React.useEffect(() => {
        if (!autoEditRigId) {
            return;
        }
        const rigToEdit = rigs.find((rig) => String(rig.id) === String(autoEditRigId));
        if (!rigToEdit) {
            return;
        }

        dispatch(setFormValues(rigToEdit));
        dispatch(setOpenAddDialog(true));

        const nextState = { ...(location.state || {}) };
        delete nextState.autoEditRigId;
        if (Object.keys(nextState).length > 0) {
            navigate(location.pathname, { replace: true, state: nextState });
        } else {
            navigate(location.pathname, { replace: true });
        }
    }, [autoEditRigId, dispatch, location.pathname, location.state, navigate, rigs]);

    const columns = [
        {field: 'name', headerName: t('rig.name'), flex: 1, minWidth: 150},
        {field: 'host', headerName: t('rig.host'), flex: 1, minWidth: 150},
        {
            field: 'port',
            headerName: t('rig.port'),
            type: 'number',
            flex: 1,
            minWidth: 80,
            align: 'right',
            headerAlign: 'right',
            valueFormatter: (value) => {
                return value;
            }
        },
        {field: 'radio_mode', headerName: t('rig.radio_mode'), flex: 1, minWidth: 150},
        {field: 'tx_control_mode', headerName: t('rig.tx_control_mode'), flex: 1, minWidth: 150},
        {
            field: 'retune_interval_ms',
            headerName: t('rig.retune_interval_ms'),
            flex: 1,
            minWidth: 140,
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
                    aria-label={t('rig.edit')}
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
    //     dispatch(fetchRigs({socket}));
    // }, [dispatch]);

    function handleFormSubmit() {
        if (formValues.id) {
            dispatch(submitOrEditRig({socket, formValues}))
                .unwrap()
                .then(() => {
                    toast.success(t('rig.edited_success'), {autoClose: 5000});
                })
                .catch((error) => {
                    toast.error(t('rig.error_editing'), {autoClose: 5000})
                });
        } else {
            dispatch(submitOrEditRig({socket, formValues}))
                .unwrap()
                .then(() => {
                    toast.success(t('rig.added_success'), {autoClose: 5000});
                })
                .catch((error) => {
                    toast.error(`${t('rig.error_adding')}: ${error}`, {autoClose: 5000})
                });
        }
        dispatch(setOpenAddDialog(false));
    }

    function handleDelete() {
        dispatch(deleteRigs({socket, selectedIds: selected}))
            .unwrap()
            .then(() => {
                dispatch(setSelected([]));
                dispatch(setOpenDeleteConfirm(false));
                toast.success(t('rig.deleted_success'), {autoClose: 5000});
            })
            .catch((error) => {
                toast.error(t('rig.error_deleting'), {autoClose: 5000});
            });
    }

    const handleChange = (e) => {
        const {name, value} = e.target;
        if (e.target.type === "number") {
            dispatch(setFormValues({...formValues, [name]: parseInt(value)}));
        } else {
            dispatch(setFormValues({...formValues, [name]: value}));
        }

    };

    const validationErrors = validateRigForm(formValues, t);
    const hasValidationErrors = Object.keys(validationErrors).length > 0;

    return (
        <Paper elevation={3} sx={{ px: 2, pb: 2, pt: 1, marginTop: 0, borderRadius: 0 }}>
            <Box component="form">
                <Box sx={{width: '100%'}}>
                    <DataGrid
                        loading={loading}
                        rows={rigs}
                        columns={columns}
                        checkboxSelection
                        disableRowSelectionExcludeModel
                        rowSelectionModel={rowSelectionModel}
                        onRowSelectionModelChange={(selected) => {
                            dispatch(setSelected(toSelectedIds(selected)));
                        }}
                        initialState={{
                            pagination: {paginationModel: {pageSize: 5}},
                            sorting: {
                                sortModel: [{field: 'name', sort: 'desc'}],
                            },
                        }}
                        pageSize={pageSize}
                        pageSizeOptions={[5, 10, 25, {value: -1, label: t('shared.all')}]}
                        onPageSizeChange={(newPageSize) => setPageSize(newPageSize)}
                        rowsPerPageOptions={[5, 10, 25]}
                        getRowId={(row) => row.id}
                        localeText={{
                            noRowsLabel: t('rig.no_rigs')
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
                        onClearSelection={() => dispatch(setSelected([]))}
                        primaryActions={
                            <>
                                <Button
                                    variant="contained"
                                    onClick={() => {
                                        dispatch(setFormValues(DEFAULT_RIG));
                                        dispatch(setOpenAddDialog(true));
                                    }}
                                    disabled={loading}
                                >
                                    {t('rig.add')}
                                </Button>
                                <Button
                                    variant="contained"
                                    disabled={selected.length !== 1 || loading}
                                    onClick={() => {
                                        const selectedRow = rigs.find(row => row.id === selected[0]);
                                        if (selectedRow) {
                                            dispatch(setFormValues(selectedRow));
                                            dispatch(setOpenAddDialog(true));
                                        }
                                    }}
                                >
                                    {t('rig.edit')}
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
                                    {t('rig.delete')}
                                </Button>
                            </>
                        }
                    />
                    <RigEditDialog
                        open={openAddDialog}
                        onClose={() => dispatch(setOpenAddDialog(false))}
                        isEditing={isEditing}
                        formValues={formValues}
                        validationErrors={validationErrors}
                        hasValidationErrors={hasValidationErrors}
                        loading={loading}
                        onChange={handleChange}
                        onSubmit={handleFormSubmit}
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
                            {t('rig.confirm_deletion')}
                        </DialogTitle>
                        <DialogContent sx={{ px: 3, pt: 3, pb: 3 }}>
                            <Typography variant="body1" sx={{ mt: 2, mb: 2, color: 'text.primary' }}>
                                {t('rig.confirm_delete_message')}
                            </Typography>
                            <Typography variant="body2" sx={{ mb: 2, fontWeight: 600, color: 'text.secondary' }}>
                                {selected.length === 1
                                    ? t('rig.delete_list_single')
                                    : t('rig.delete_list_plural', { count: selected.length })}
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
                                    const rig = rigs.find(r => r.id === id);
                                    if (!rig) return null;
                                    return (
                                        <Box
                                            key={id}
                                            sx={{
                                                p: 2,
                                                borderBottom: index < selected.length - 1 ? (theme) => `1px solid ${theme.palette.divider}` : 'none',
                                            }}
                                        >
                                            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: 'text.primary' }}>
                                                {rig.name}
                                            </Typography>
                                            <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 1, columnGap: 2 }}>
                                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                                    {t('rig.host')}:
                                                </Typography>
                                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                                    {rig.host}:{rig.port}
                                                </Typography>

                                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                                    {t('rig.radio_mode')}:
                                                </Typography>
                                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                                    {rig.radio_mode || 'duplex'}
                                                </Typography>

                                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                                    {t('rig.tx_control_mode')}:
                                                </Typography>
                                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                                    {rig.tx_control_mode || 'auto'}
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
                                {t('rig.cancel')}
                            </Button>
                            <Button
                                variant="contained"
                                onClick={() => {
                                    handleDelete();
                                }}
                                color="error"
                                disabled={!canConfirmDelete || loading}
                                sx={{
                                    minWidth: 100,
                                    textTransform: 'none',
                                    fontWeight: 600,
                                }}
                            >
                                {t('rig.delete')}
                            </Button>
                        </DialogActions>
                    </Dialog>
                </Box>
            </Box>
            <Alert severity="info" sx={{ mt: 2 }}>
                <AlertTitle>{t('rig.title')}</AlertTitle>
                {t('rig.subtitle')}
            </Alert>
        </Paper>
    );
}
