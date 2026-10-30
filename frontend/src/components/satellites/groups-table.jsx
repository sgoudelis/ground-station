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
    Chip,
    Typography,
    IconButton,
    Tooltip,
    CircularProgress,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { DataGrid, gridClasses } from '@mui/x-data-grid';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ContentCopyOutlinedIcon from '@mui/icons-material/ContentCopyOutlined';
import { toast } from '../../utils/toast-with-timestamp.jsx';
import { useSocket } from '../common/socket.jsx';
import { betterDateTimes } from '../common/common.jsx';
import { AddEditDialog } from './groups-dialog.jsx';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import {
    deleteSatelliteGroups,
    setSelected,
    setSatGroup,
    setFormDialogOpen,
    setGroups,
    setDeleteConfirmDialogOpen,
} from './groups-slice.jsx';
import { useTranslation } from 'react-i18next';
import {toRowSelectionModel, toSelectedIds} from '../../utils/datagrid-selection.js';


const normalizeSatelliteIds = (value) => value ? (Array.isArray(value)
    ? value
    : value.split(',').map(id => id.trim()).filter(Boolean)) : [];

const SatelliteChipsCell = ({ value, navigate, satelliteNames }) => {
    const containerRef = useRef(null);
    const [visibleCount, setVisibleCount] = useState(null);

    const ids = normalizeSatelliteIds(value);

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
            {visibleIds.map((id) => (
                <Tooltip key={id} title={`NORAD ID: ${id}`}>
                    <Chip
                        label={satelliteNames[String(id)] || id}
                        variant="outlined"
                        clickable
                        onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/satellites/${id}`);
                        }}
                        sx={{maxWidth: 180}}
                    />
                </Tooltip>
            ))}
            {remaining > 0 && (
                <Tooltip title={ids.slice(displayCount).map(id => `NORAD ID: ${id}`).join(', ')}>
                    <Chip label={`+${remaining} more`} variant="filled" color="default" />
                </Tooltip>
            )}
        </Box>
    );
};

const GroupsTable = () => {
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const { t } = useTranslation('satellites');
    const navigate = useNavigate();
    const [satelliteNames, setSatelliteNames] = useState({});

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
        loading,
        error,
    } = useSelector((state) => state.satelliteGroups);
    const rowSelectionModel = useMemo(() => toRowSelectionModel(selected), [selected]);

    useEffect(() => {
        const satelliteIds = [...new Set(groups.flatMap(group => normalizeSatelliteIds(group.satellite_ids)))];
        if (!socket || satelliteIds.length === 0) {
            setSatelliteNames({});
            return undefined;
        }

        let cancelled = false;
        socket.emit('api.call', {cmd: 'get-satellites', data: satelliteIds}, response => {
            if (cancelled || !response.success) return;
            setSatelliteNames(Object.fromEntries(
                response.data.map(satellite => [String(satellite.norad_id), satellite.name])
            ));
        });

        return () => { cancelled = true; };
    }, [groups, socket]);

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
            renderCell: (params) => (
                <SatelliteChipsCell
                    value={params.value}
                    navigate={navigate}
                    satelliteNames={satelliteNames}
                />
            ),
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
        {
            field: 'actions',
            headerName: t('groups.actions'),
            width: 148,
            align: 'center',
            headerAlign: 'center',
            sortable: false,
            filterable: false,
            disableColumnMenu: true,
            renderCell: (params) => (
                <Stack
                    direction="row"
                    spacing={0.5}
                    justifyContent="center"
                    alignItems="center"
                    sx={{width: '100%', height: '100%'}}
                >
                    <Tooltip title={t('groups.edit')}>
                        <IconButton
                            size="small"
                            aria-label={t('groups.edit')}
                            onClick={(event) => {
                                event.stopPropagation();
                                handleEditGroup(params.row);
                            }}
                        >
                            <EditOutlinedIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={t('groups.delete')}>
                        <IconButton
                            size="small"
                            color="error"
                            aria-label={t('groups.delete')}
                            onClick={(event) => {
                                event.stopPropagation();
                                dispatch(setSelected([params.row.id]));
                                dispatch(setDeleteConfirmDialogOpen(true));
                            }}
                        >
                            <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={t('groups.copy_norad_ids')}>
                        <IconButton
                            size="small"
                            aria-label={t('groups.copy_norad_ids')}
                            onClick={(event) => {
                                event.stopPropagation();
                                handleCopyNoradIds(params.row);
                            }}
                        >
                            <ContentCopyOutlinedIcon fontSize="small" />
                        </IconButton>
                    </Tooltip>
                </Stack>
            ),
        },
    ];

    // Handle Add
    const handleAddClick = () => {
        dispatch(setSatGroup({})); // if you want to clear previous selections
        dispatch(setFormDialogOpen(true));
    };

    // Handle Edit
    const handleEditGroup = (rowData = null) => {
        const singleRowId = rowData?.id || selected[0];
        if (!singleRowId || (rowData === null && selected.length !== 1)) return;
        const group = rowData || groups.find((row) => row.id === singleRowId);
        if (group) {
            dispatch(setSatGroup(group));
            dispatch(setFormDialogOpen(true));
        }
    };

    const handleDeleteGroup = () => {
        dispatch(deleteSatelliteGroups({socket, groupIds: selected}))
            .unwrap()
            .then(()=>{
                dispatch(setDeleteConfirmDialogOpen(false));
                dispatch(setSelected([]));
                toast.success(t('groups.deleted_success'));
            })
            .catch((err) => {
                toast.error(t('groups.failed_delete'));
            });
    };

    const handleCopyNoradIds = async (group) => {
        const csv = normalizeSatelliteIds(group.satellite_ids).join(',');
        try {
            await navigator.clipboard.writeText(csv);
            toast.success(t('groups.copied_norad_ids'));
        } catch (copyError) {
            console.error(copyError);
            toast.error(t('groups.copy_norad_ids_failed'));
        }
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
                // Keep the controlled selection state as explicit selected IDs so
                // bulk actions do not receive MUI's empty "exclude" select-all model.
                disableRowSelectionExcludeModel
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
                        // Keep the separator inside MUI's measured header height to avoid wheel-catching overflow.
                        borderBottom: 0,
                        boxShadow: (theme) => `inset 0 -2px 0 ${alpha(theme.palette.primary.main, 0.45)}`,
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
            <Stack
                spacing={2}
                direction={{xs: 'column', sm: 'row'}}
                alignItems={{xs: 'stretch', sm: 'center'}}
                sx={{my: 2}}
            >
                <Button variant="contained" onClick={handleAddClick}>
                    {t('groups.add')}
                </Button>
                <Button
                    variant="contained"
                    onClick={() => handleEditGroup()}
                    disabled={selected.length !== 1}
                >
                    {t('groups.edit_selected')}
                </Button>
                <Button
                    variant="contained"
                    color="error"
                    onClick={() => dispatch(setDeleteConfirmDialogOpen(true))}
                    disabled={selected.length === 0}
                >
                    {t('groups.delete_selected')}
                </Button>
                {selected.length > 0 && (
                    <Chip
                        size="small"
                        color="primary"
                        variant="outlined"
                        label={t(selected.length === 1 ? 'groups.selected_count_one' : 'groups.selected_count_other', {
                            count: selected.length,
                        })}
                    />
                )}
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
            <AddEditDialog
                formDialogOpen={formDialogOpen}
                handleRowsCallback={handleRowsCallback}
                handleDialogOpenCallback={handleDialogOpenCallback}
                satGroup={satGroup}
            />

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
                        {selected.length === 1
                            ? t('groups.delete_one_label')
                            : t('groups.delete_many_label', {count: selected.length})}
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
                                            {t('groups.satellites')}:
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                            {satelliteIds.length > 0
                                                ? t(satelliteIds.length === 1
                                                    ? 'groups.satellite_count_one'
                                                    : 'groups.satellite_count_other', {count: satelliteIds.length})
                                                : t('groups.no_satellites')}
                                        </Typography>

                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                            {t('groups.added')}:
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                            {betterDateTimes(group.added, timezone)}
                                        </Typography>

                                        {group.updated && (
                                            <>
                                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                                    {t('groups.updated')}:
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
                        disabled={loading}
                        startIcon={loading ? <CircularProgress size={16} color="inherit" /> : undefined}
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
