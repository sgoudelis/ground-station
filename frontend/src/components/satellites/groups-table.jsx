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



import React, { useEffect, useCallback, useState, useRef, useMemo } from 'react';
import {
    Box,
    Button,
    Alert,
    AlertTitle,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Stack,
    DialogContentText,
    Chip,
    Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { DataGrid, gridClasses } from '@mui/x-data-grid';
import { toast } from '../../utils/toast-with-timestamp.jsx';
import { useSocket } from '../common/socket.jsx';
import { betterDateTimes } from '../common/common.jsx';
import { AddEditDialog } from './groups-dialog.jsx';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
    fetchSatelliteGroups,
    deleteSatelliteGroups,
    setSelected,
    setSatGroup,
    setFormDialogOpen,
    setFormErrorStatus,
    setGroups,
    setDeleteConfirmDialogOpen,
} from './groups-slice.jsx';
import { useTranslation } from 'react-i18next';
import {toRowSelectionModel, toSelectedIds} from '../../utils/datagrid-selection.js';


const SatelliteChipsCell = ({ value, navigate }) => {
    const containerRef = useRef(null);
    const [visibleCount, setVisibleCount] = useState(null);

    const ids = value ? (Array.isArray(value)
        ? value
        : value.split(',').map(id => id.trim()).filter(Boolean)) : [];

    useEffect(() => {
        if (!containerRef.current || ids.length === 0) return;

        const calculateVisibleChips = () => {
            const containerWidth = containerRef.current.offsetWidth;
            // Rough estimate: ~55px per chip (varies by content) + 4px gap
            const avgChipWidth = 59;
            const moreChipWidth = 75; // "+X more" chip is wider

            const maxChips = Math.floor((containerWidth - moreChipWidth) / avgChipWidth);
            setVisibleCount(Math.max(1, Math.min(maxChips, ids.length)));
        };

        calculateVisibleChips();
        window.addEventListener('resize', calculateVisibleChips);
        return () => window.removeEventListener('resize', calculateVisibleChips);
    }, [ids.length]);

    if (!value) return null;

    const displayCount = visibleCount || 3; // fallback to 3 while calculating
    const visibleIds = ids.slice(0, displayCount);
    const remaining = ids.length - displayCount;

    return (
        <Box ref={containerRef} sx={{ display: 'flex', flexWrap: 'nowrap', gap: 0.5, py: 1, overflow: 'hidden' }}>
            {visibleIds.map((id, index) => (
                <Chip
                    key={index}
                    label={id}
                    variant="outlined"
                    clickable
                    onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/satellites/${id}`);
                    }}
                />
            ))}
            {remaining > 0 && (
                <Chip
                    label={`+${remaining} more`}
                    variant="filled"
                    color="default"
                />
            )}
        </Box>
    );
};

const GroupsTable = () => {
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const { t } = useTranslation('satellites');
    const navigate = useNavigate();

    // Get timezone preference
    const timezone = useSelector((state) => {
        const tzPref = state.preferences?.preferences?.find(p => p.name === 'timezone');
        return tzPref?.value || 'UTC';
    });

    // Redux state
    const {
        groups,
        selected,
        formDialogOpen,
        deleteConfirmDialogOpen,
        satGroup,
        formErrorStatus,
        loading,
        error,
    } = useSelector((state) => state.satelliteGroups);
    const rowSelectionModel = useMemo(() => toRowSelectionModel(selected), [selected]);

    const columns = [
        {
            field: 'name',
            headerName: t('groups.name'),
            width: 150,
            flex: 1,
        },
        {
            field: 'satellite_ids',
            headerName: t('groups.satellites'),
            width: 300,
            flex: 5,
            renderCell: (params) => <SatelliteChipsCell value={params.value} navigate={navigate} />,
        },
        {
            field: 'added',
            headerName: t('groups.added'),
            width: 200,
            flex: 1,
            align: 'right',
            headerAlign: 'right',
            renderCell: (params) => betterDateTimes(params.value, timezone),
        },
        {
            field: 'updated',
            headerName: t('groups.updated'),
            width: 200,
            flex: 1,
            align: 'right',
            headerAlign: 'right',
            renderCell: (params) => betterDateTimes(params.value, timezone),
        },
    ];

    // // Fetch data
    // useEffect(() => {
    //     dispatch(fetchSatelliteGroups({ socket }));
    // }, [dispatch, socket]);

    // Handle Add
    const handleAddClick = () => {
        dispatch(setSatGroup({})); // if you want to clear previous selections
        dispatch(setFormDialogOpen(true));
    };

    // Handle Edit
    const handleEditGroup = () => {
        if (selected.length !== 1) return;
        const singleRowId = selected[0];
        const rowData = groups.find((row) => row.id === singleRowId);
        if (rowData) {
            dispatch(setSatGroup(rowData));
            dispatch(setFormDialogOpen(true));
        }
    };

    const handleDeleteGroup = () => {
        dispatch(deleteSatelliteGroups({socket, groupIds: selected}))
            .unwrap()
            .then(()=>{
                dispatch(setDeleteConfirmDialogOpen(false));
                toast.success(t('groups.deleted_success'));
            })
            .catch((err) => {
                toast.error(t('groups.failed_delete'));
            });
    };

    const paginationModel = { page: 0, pageSize: 10 };

    const handleRowsCallback = useCallback((groups) => {
        dispatch(setGroups(groups));
    }, []);

    const handleDialogOpenCallback = useCallback((value) => {
        dispatch(setFormDialogOpen(value));
    }, []);

    return (
        <Box sx={{ width: '100%', marginTop: 0 }}>
            <DataGrid
                rows={groups}
                columns={columns}
                loading={loading}
                initialState={{ pagination: { paginationModel } }}
                pageSizeOptions={[5, 10]}
                checkboxSelection
                onRowSelectionModelChange={(ids) => {
                    dispatch(setSelected(toSelectedIds(ids)));
                }}
                rowSelectionModel={rowSelectionModel}
                localeText={{
                    noRowsLabel: t('groups.no_groups')
                }}
                sx={{
                    border: 0,
                    marginTop: 0,
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
                }}
            />
            <Stack spacing={2} direction="row" sx={{ my: 2 }}>
                <Button variant="contained" onClick={handleAddClick}>
                    {t('groups.add')}
                </Button>
                <Button
                    variant="contained"
                    onClick={handleEditGroup}
                    disabled={selected.length !== 1}
                >
                    {t('groups.edit')}
                </Button>
                <Button
                    variant="contained"
                    color="error"
                    onClick={() => dispatch(setDeleteConfirmDialogOpen(true))}
                    disabled={selected.length === 0}
                >
                    {t('groups.delete')}
                </Button>
            </Stack>
            <Alert severity="info" sx={{ mt: 2 }}>
                <AlertTitle>{t('groups.title')}</AlertTitle>
                {t('groups.subtitle')}
            </Alert>
            {error && (
                <Alert severity="error" sx={{ mt: 2 }}>
                    {error}
                </Alert>
            )}
            {formErrorStatus && (
                <Alert severity="error" sx={{ mt: 2 }}>
                    {t('groups.error_message')}
                </Alert>
            )}

            {/* Example usage of Dialog */}
            {formDialogOpen && (
                <Dialog
                    open={formDialogOpen}
                    onClose={() => dispatch(setFormDialogOpen(false))}
                >
                    <DialogTitle>{satGroup.id ? t('groups.dialog_title_edit') : t('groups.dialog_title_add')}</DialogTitle>
                    <DialogContent>
                        <AddEditDialog
                            formDialogOpen={formDialogOpen}
                            handleRowsCallback={handleRowsCallback}
                            handleDialogOpenCallback={handleDialogOpenCallback}
                            satGroup={satGroup}
                        />
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => dispatch(setFormDialogOpen(false))}>
                            {t('groups.close')}
                        </Button>
                    </DialogActions>
                </Dialog>
            )}

            <Dialog
                open={deleteConfirmDialogOpen}
                onClose={() => dispatch(setDeleteConfirmDialogOpen(false))}
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
                    {t('groups.confirm_deletion')}
                </DialogTitle>
                <DialogContent sx={{ px: 3, pt: 3, pb: 3 }}>
                    <Typography variant="body1" sx={{ mt: 2, mb: 2, color: 'text.primary' }}>
                        {t('groups.confirm_delete_message')}
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 2, fontWeight: 600, color: 'text.secondary' }}>
                        {selected.length === 1 ? 'Group to be deleted:' : `${selected.length} Groups to be deleted:`}
                    </Typography>
                    <Box sx={{
                        maxHeight: 300,
                        overflowY: 'auto',
                        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
                        borderRadius: 1,
                        border: (theme) => `1px solid ${theme.palette.divider}`,
                    }}>
                        {selected.map((id, index) => {
                            const group = groups.find(g => g.id === id);
                            if (!group) return null;
                            const satelliteIds = group.satellite_ids
                                ? (Array.isArray(group.satellite_ids)
                                    ? group.satellite_ids
                                    : group.satellite_ids.split(',').map(id => id.trim()).filter(Boolean))
                                : [];
                            return (
                                <Box
                                    key={id}
                                    sx={{
                                        p: 2,
                                        borderBottom: index < selected.length - 1 ? (theme) => `1px solid ${theme.palette.divider}` : 'none',
                                    }}
                                >
                                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: 'text.primary' }}>
                                        {group.name}
                                    </Typography>
                                    <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 1, columnGap: 2 }}>
                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                            Satellites:
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                            {satelliteIds.length > 0 ? `${satelliteIds.length} satellite(s)` : 'No satellites'}
                                        </Typography>

                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                            Added:
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                            {betterDateTimes(group.added, timezone)}
                                        </Typography>

                                        {group.updated && (
                                            <>
                                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                                    Updated:
                                                </Typography>
                                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                                    {betterDateTimes(group.updated, timezone)}
                                                </Typography>
                                            </>
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
                        onClick={() => dispatch(setDeleteConfirmDialogOpen(false))}
                        variant="outlined"
                        color="inherit"
                        sx={{
                            minWidth: 100,
                            textTransform: 'none',
                            fontWeight: 500,
                        }}
                    >
                        {t('groups.cancel')}
                    </Button>
                    <Button
                        variant="contained"
                        onClick={() => {
                            handleDeleteGroup();
                        }}
                        color="error"
                        sx={{
                            minWidth: 100,
                            textTransform: 'none',
                            fontWeight: 600,
                        }}
                    >
                        {t('groups.delete')}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};

export default React.memo(GroupsTable);
