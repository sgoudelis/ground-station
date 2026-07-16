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
import {
    Alert,
    AlertTitle,
    Box,
    Button,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    OutlinedInput,
    InputAdornment,
    IconButton,
    InputLabel,
    ListSubheader,
    MenuItem,
    Select,
    Stack,
    TextField,
    Tooltip,
    Typography,
} from "@mui/material";
import { alpha } from '@mui/material/styles';
import {useEffect, useState, useCallback} from "react";
import {useDispatch, useSelector} from "react-redux";
import { toast } from '../../utils/toast-with-timestamp.jsx';
import {
    DataGrid,
    gridPageCountSelector,
    GridPagination,
    useGridApiContext,
    useGridSelector,
    gridClasses
} from '@mui/x-data-grid';
import MuiPagination from '@mui/material/Pagination';
import {
    betterDateTimes,
    betterStatusValue,
    renderCountryFlagsCSV,
    getFrequencyBand, getBandColor
} from '../common/common.jsx';
import {
    fetchSatellite,
    fetchSatelliteCatalogStats,
    fetchSatelliteGroups,
    fetchSatellites,
    searchSatellites,
    deleteSatellite,
    setSatGroupId,
    setSearchKeyword,
    setSelected,
    setOpenDeleteConfirm,
    setOpenAddDialog,
    setClickedSatellite,
} from "./satellite-slice.jsx";
import {useSocket} from "../common/socket.jsx";
import { useTranslation } from 'react-i18next';
import {toSelectedIds} from '../../utils/datagrid-selection.js';
import SearchIcon from '@mui/icons-material/Search';
import ClearIcon from '@mui/icons-material/Clear';
import { useNavigate } from "react-router-dom";
import TransmittersDialog from "./transmitters-dialog.jsx";
import EditIcon from '@mui/icons-material/Edit';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import FolderSharedOutlinedIcon from '@mui/icons-material/FolderSharedOutlined';
import SatelliteEditDialog from "./satellite-edit-dialog.jsx";

function Pagination({page, onPageChange, className}) {
    const apiRef = useGridApiContext();
    const pageCount = useGridSelector(apiRef, gridPageCountSelector);

    return (
        <MuiPagination
            color="primary"
            className={className}
            count={pageCount}
            page={page + 1}
            onChange={(event, newPage) => {
                onPageChange(event, newPage - 1);
            }}
        />
    );
}

function CustomPagination(props) {
    return <GridPagination ActionsComponent={Pagination} {...props} />;
}

const SatelliteTable = React.memo(function SatelliteTable() {
    const dispatch = useDispatch();
    const {socket} = useSocket();
    const navigate = useNavigate();
    const { t } = useTranslation('satellites');
    const {
        satellites,
        satellitesGroups,
        satGroupId,
        searchKeyword,
        selected,
        loading,
        openDeleteConfirm,
        openAddDialog,
        clickedSatellite,
        catalogStats,
    } = useSelector((state) => state.satellites);

    const [localSearchValue, setLocalSearchValue] = useState('');
    const [transmittersDialogOpen, setTransmittersDialogOpen] = useState(false);
    const [editingSatellite, setEditingSatellite] = useState(null);

    const getGroupOptionIcon = (groupType) => {
        const normalizedType = String(groupType || '').toLowerCase();
        if (normalizedType === 'user') {
            return <FolderSharedOutlinedIcon fontSize="small" sx={{ color: 'primary.main' }} />;
        }
        return <FolderOutlinedIcon fontSize="small" sx={{ color: 'text.secondary' }} />;
    };

    // Get timezone preference
    const timezone = useSelector((state) => {
        const tzPref = state.preferences?.preferences?.find(p => p.name === 'timezone');
        return tzPref?.value || 'UTC';
    });

    const latestEditRequestRef = React.useRef(0);

    const hydrateSatelliteForEdit = useCallback((noradId, fallbackSatellite = null) => {
        const parsedNoradId = Number(noradId);
        if (Number.isNaN(parsedNoradId)) {
            return;
        }
        const requestId = latestEditRequestRef.current + 1;
        latestEditRequestRef.current = requestId;
        dispatch(fetchSatellite({ socket, noradId: parsedNoradId }))
            .unwrap()
            .then((response) => {
                if (latestEditRequestRef.current !== requestId) {
                    return;
                }
                const details = response?.details || {};
                const transmitters = Array.isArray(response?.transmitters)
                    ? response.transmitters
                    : (fallbackSatellite?.transmitters || []);
                setEditingSatellite({
                    ...fallbackSatellite,
                    ...details,
                    transmitters,
                });
            })
            .catch(() => {
                // Keep the optimistic row payload if fetch fails; dialog can still open.
            });
    }, [dispatch, socket]);

    const handleEditRow = useCallback((satellite) => {
        if (!satellite) {
            return;
        }
        setEditingSatellite(satellite);
        dispatch(setOpenAddDialog(true));
        hydrateSatelliteForEdit(satellite.norad_id, satellite);
    }, [dispatch, hydrateSatelliteForEdit]);

    const handleViewSatellite = (noradId) => {
        if (!noradId) {
            return;
        }
        navigate(`/satellites/${noradId}`);
    };

    const handleOpenTransmitters = (satellite) => {
        if (!satellite) {
            return;
        }
        dispatch(setClickedSatellite(satellite));
        setTransmittersDialogOpen(true);
    };

    const handleCloseTransmitters = () => {
        setTransmittersDialogOpen(false);
        dispatch(fetchSatelliteCatalogStats({socket}));
    };

    const columns = [
        {
            field: 'name',
            headerName: t('satellite_database.name'),
            flex: 1,
            minWidth: 200,
        },
        {
            field: 'norad_id',
            headerName: t('satellite_database.norad_id'),
            width: 100,
        },
        {
            field: 'status',
            headerName: t('satellite_database.status'),
            width: 100,
            headerAlign: 'center',
            align: 'center',
            renderCell: (params) => {
                return betterStatusValue(params.value);
            },
        },
        {
            field: 'countries',
            headerName: t('satellite_database.countries'),
            width: 100,
            headerAlign: 'center',
            align: 'center',
            renderCell: (params) => {
                return renderCountryFlagsCSV(params.value);
            },
        },
        {
            field: 'operator',
            headerName: t('satellite_database.operator'),
            width: 100,
            headerAlign: 'center',
            align: 'center',
            renderCell: (params) => {
                if (params.value !== "None") {
                    return params.value;
                } else {
                    return "-";
                }
            },
        },

        {
            field: 'transmitters',
            minWidth: 220,
            align: 'center',
            headerAlign: 'center',
            headerName: t('satellite_database.bands'),
            sortComparator: (v1, v2) => {
                // Get total transmitter count for comparison
                const count1 = v1 ? v1.length : 0;
                const count2 = v2 ? v2.length : 0;
                return count1 - count2;
            },
            renderCell: (params) => {
                const transmitters = params.value;
                if (!transmitters) {
                    return t('satellite_database.no_data');
                }

                // Aggregate count and direction markers per band.
                const bandDetails = transmitters.reduce((acc, transmitter) => {
                    const upBand = transmitter['uplink_low'] != null
                        ? getFrequencyBand(transmitter['uplink_low'])
                        : null;
                    const downBand = transmitter['downlink_low'] != null
                        ? getFrequencyBand(transmitter['downlink_low'])
                        : null;

                    // Count each transmitter once per band (avoid double count if up/down same band).
                    const uniqueBands = new Set([upBand, downBand].filter(Boolean));
                    uniqueBands.forEach((band) => {
                        if (!acc[band]) {
                            acc[band] = { count: 0, uplink: false, downlink: false };
                        }
                        acc[band].count += 1;
                    });

                    if (upBand) {
                        if (!acc[upBand]) acc[upBand] = { count: 0, uplink: false, downlink: false };
                        acc[upBand].uplink = true;
                    }

                    if (downBand) {
                        if (!acc[downBand]) acc[downBand] = { count: 0, uplink: false, downlink: false };
                        acc[downBand].downlink = true;
                    }

                    return acc;
                }, {});

                const bands = Object.keys(bandDetails);

                return (
                    <div style={{
                        display: 'flex',
                        gap: 4,
                        flexWrap: 'wrap',
                        justifyContent: 'center',
                        alignItems: 'center'
                    }}>
                        {bands.map((band, index) => (
                            <div key={index} style={{display: 'flex', alignItems: 'center', gap: 2}}>
                                <Chip
                                    label={
                                        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.35 }}>
                                            <Box component="span">{band}</Box>
                                            {bandDetails[band].uplink && <ArrowUpwardRoundedIcon sx={{ fontSize: '0.85rem' }} />}
                                            {bandDetails[band].downlink && <ArrowDownwardRoundedIcon sx={{ fontSize: '0.85rem' }} />}
                                        </Box>
                                    }
                                    size="small"
                                    sx={{
                                        height: '18px',
                                        fontSize: '0.65rem',
                                        fontWeight: 'bold',
                                        backgroundColor: getBandColor(band),
                                        color: '#ffffff',
                                        '& .MuiChip-label': {
                                            px: 0.75
                                        },
                                        '&:hover': {
                                            filter: 'brightness(90%)',
                                        }
                                    }}
                                />
                                <span>x {bandDetails[band].count}</span>
                            </div>
                        ))}
                    </div>
                );
            }
        },

        {
            field: 'decayed',
            headerName: t('satellite_database.decayed'),
            width: 150,
            renderCell: (params) => {
                return betterDateTimes(params.value, timezone);
            },
        },
        {
            field: 'launched',
            headerName: t('satellite_database.launched'),
            width: 150,
            renderCell: (params) => {
                return betterDateTimes(params.value, timezone);
            },
        },
        {
            field: 'deployed',
            headerName: t('satellite_database.deployed'),
            width: 150,
            renderCell: (params) => {
                return betterDateTimes(params.value, timezone);
            },
        },
        {
            field: 'updated',
            headerName: t('satellite_database.updated'),
            width: 150,
            renderCell: (params) => {
                return betterDateTimes(params.value, timezone);
            },
        },
        {
            field: 'actions',
            headerName: t('satellite_database.actions'),
            width: 120,
            sortable: false,
            filterable: false,
            headerAlign: 'center',
            align: 'center',
            renderCell: (params) => {
                const satellite = params.row;
                return (
                    <Stack
                        direction="row"
                        spacing={0.5}
                        sx={{
                            width: '100%',
                            height: '100%',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <Tooltip title={t('satellite_database.edit')}>
                            <IconButton
                                size="small"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    handleEditRow(satellite);
                                }}
                            >
                                <EditIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                        <Tooltip title={t('satellite_database.view')}>
                            <IconButton
                                size="small"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    handleViewSatellite(satellite.norad_id);
                                }}
                            >
                                <VisibilityIcon fontSize="small" />
                            </IconButton>
                        </Tooltip>
                    </Stack>
                );
            },
        },
    ];

    useEffect(() => {
        dispatch(fetchSatelliteGroups({socket}));
    }, [dispatch, socket]);

    useEffect(() => {
        dispatch(fetchSatelliteCatalogStats({socket}));
    }, [dispatch, socket]);

    // Debounced search effect
    useEffect(() => {
        if (localSearchValue.length >= 3) {
            const timeoutId = setTimeout(() => {
                // Only search if the keyword actually changed
                if (localSearchValue !== searchKeyword) {
                    dispatch(setSearchKeyword(localSearchValue));
                    dispatch(searchSatellites({socket, keyword: localSearchValue}));
                }
            }, 500); // 500ms debounce delay

            return () => clearTimeout(timeoutId);
        } else if (localSearchValue.length === 0 && searchKeyword !== '') {
            // Clear search when input is empty
            dispatch(setSearchKeyword(''));
            dispatch(setSatGroupId(''));
        }
    }, [localSearchValue, dispatch, socket, searchKeyword, t]);

    const handleOnGroupChange = (event) => {
        const groupId = event.target.value;
        dispatch(setSatGroupId(groupId));
        // Clear search when selecting a group
        setLocalSearchValue('');
        dispatch(setSearchKeyword(''));

        if (groupId !== null) {
            dispatch(fetchSatellites({socket, satGroupId: groupId}))
                .unwrap()
                .then((data) => {
                    toast.success(t('satellite_database.loaded_success', { count: data.length }));
                })
                .catch((err) => {
                    toast.error(t('satellite_database.failed_load') + ": " + err.message)
                });
        }
    };

    const handleSearchChange = (event) => {
        setLocalSearchValue(event.target.value);
    };

    const handleClearSearch = () => {
        setLocalSearchValue('');
        dispatch(setSearchKeyword(''));
        dispatch(setSatGroupId(''));
    };


    const refreshSatellites = useCallback(() => {
        if (searchKeyword && searchKeyword.length >= 3) {
            dispatch(searchSatellites({socket, keyword: searchKeyword}));
            return;
        }
        if (satGroupId) {
            dispatch(fetchSatellites({socket, satGroupId}));
        }
    }, [dispatch, satGroupId, searchKeyword, socket]);

    const refreshCatalogStats = useCallback(() => {
        dispatch(fetchSatelliteCatalogStats({socket}));
    }, [dispatch, socket]);

    const handleAddClick = () => {
        latestEditRequestRef.current += 1;
        setEditingSatellite(null);
        dispatch(setOpenAddDialog(true));
    };

    const handleEditClick = () => {
        const selectedId = Number(selected[0]);
        if (Number.isNaN(selectedId)) {
            return;
        }
        const satellite = satellites.find((row) => row.norad_id === selectedId);
        if (!satellite) {
            return;
        }
        handleEditRow(satellite);
    };

    const handleCloseDialog = () => {
        latestEditRequestRef.current += 1;
        setEditingSatellite(null);
        dispatch(setOpenAddDialog(false));
    };

    const handleSatelliteSaved = useCallback(() => {
        dispatch(setOpenAddDialog(false));
        setEditingSatellite(null);
        refreshSatellites();
        refreshCatalogStats();
    }, [dispatch, refreshCatalogStats, refreshSatellites]);

    const handleDeleteClick = () => {
        const deleteRequests = selected
            .map((noradId) => Number(noradId))
            .filter((noradId) => !Number.isNaN(noradId))
            .map((noradId) => dispatch(deleteSatellite({socket, noradId})).unwrap());
        Promise.all(deleteRequests)
            .then(() => {
                toast.success(t('satellite_database.deleted_success'), {autoClose: 4000});
                dispatch(setSelected([]));
                dispatch(setOpenDeleteConfirm(false));
                refreshSatellites();
                refreshCatalogStats();
            })
            .catch((error) => {
                toast.error(`${t('satellite_database.failed_delete')}: ${error}`, {autoClose: 5000});
            });
    };

    const catalogStatsSuffix = React.useMemo(() => {
        if (!catalogStats) {
            return '';
        }

        return ` ${t('satellite_database.catalog_stats_summary', {
            satellites: Number(catalogStats.satellites || 0),
            groups: Number(catalogStats.groups || 0),
            userGroups: Number(catalogStats.user_groups || 0),
            systemGroups: Number(catalogStats.system_groups || 0),
            transmitters: Number(catalogStats.satellite_transmitters || 0),
            defaultValue: 'Current DB stats: {{satellites}} satellites, {{groups}} groups ({{userGroups}} user, {{systemGroups}} system), {{transmitters}} satellite transmitters.',
        })}`;
    }, [catalogStats, t]);

    const filterFieldSx = {
        '& .MuiOutlinedInput-root': {
            backgroundColor: (theme) =>
                theme.palette.mode === 'dark' ? '#121212' : 'background.paper',
        },
    };

    return (
        <Box elevation={3} sx={{width: '100%', marginTop: 0}}>
            <Box sx={{ display: 'flex', gap: 2, marginTop: 0, marginBottom: 1 }}>
                <FormControl sx={{minWidth: 200, flex: 1, ...filterFieldSx}} variant={"outlined"}>
                    <InputLabel id="sat-group-select-label">{t('satellite_database.select_group')}</InputLabel>
                    <Select
                        disabled={loading}
                        value={satGroupId}
                        id="grouped-select"
                        labelId="sat-group-select-label"
                        input={<OutlinedInput label={t('satellite_database.select_group')} />}
                        variant={"outlined"}
                        MenuProps={{
                            PaperProps: {
                                sx: {
                                    backgroundColor: (theme) =>
                                        theme.palette.mode === 'dark' ? '#121212' : 'background.paper',
                                },
                            },
                        }}
                        onChange={handleOnGroupChange}
                    >
                        <ListSubheader>{t('satellite_database.user_groups')}</ListSubheader>
                        {satellitesGroups.filter(group => group.type === "user").length === 0 ? (
                            <MenuItem disabled value="">
                                {t('satellite_database.none_defined')}
                            </MenuItem>
                        ) : (
                            satellitesGroups.map((group, index) => {
                                if (group.type === "user") {
                                    return (
                                        <MenuItem value={group.id} key={index}>
                                            <Stack direction="row" spacing={1} alignItems="center">
                                                {getGroupOptionIcon(group.type)}
                                                <span>{group.name} ({group.satellite_ids.length})</span>
                                            </Stack>
                                        </MenuItem>
                                    );
                                }
                            })
                        )}
                        <ListSubheader>{t('satellite_database.builtin_groups')}</ListSubheader>
                        {satellitesGroups.filter(group => group.type === "system").length === 0 ? (
                            <MenuItem disabled value="">
                                {t('satellite_database.none_defined')}
                            </MenuItem>
                        ) : (
                            satellitesGroups.map((group, index) => {
                                if (group.type === "system") {
                                    return (
                                        <MenuItem value={group.id} key={index}>
                                            <Stack direction="row" spacing={1} alignItems="center">
                                                {getGroupOptionIcon(group.type)}
                                                <span>{group.name} ({group.satellite_ids.length})</span>
                                            </Stack>
                                        </MenuItem>
                                    );
                                }
                            })
                        )}
                    </Select>
                </FormControl>
                <TextField
                    sx={{ minWidth: 200, flex: 1, ...filterFieldSx }}
                    variant="outlined"
                    label={t('satellite_database.search_satellites')}
                    value={localSearchValue}
                    onChange={handleSearchChange}
                    disabled={loading}
                    placeholder={t('satellite_database.search_placeholder')}
                    helperText={localSearchValue.length > 0 && localSearchValue.length < 3 ? t('satellite_database.search_min_chars') : ''}
                    InputProps={{
                        startAdornment: (
                            <InputAdornment position="start">
                                <SearchIcon />
                            </InputAdornment>
                        ),
                        endAdornment: localSearchValue && (
                            <InputAdornment position="end">
                                <IconButton
                                    aria-label="clear search"
                                    onClick={handleClearSearch}
                                    edge="end"
                                    size="small"
                                >
                                    <ClearIcon />
                                </IconButton>
                            </InputAdornment>
                        ),
                    }}
                />
            </Box>
            <div>
                <DataGrid
                    getRowId={(satellite) => {
                        return satellite['norad_id'];
                    }}
                    loading={loading}
                    rows={satellites}
                    columns={columns}
                    pageSizeOptions={[5, 10, 20, 50, 100]}
                    checkboxSelection={true}
                    initialState={{
                        pagination: {paginationModel: {pageSize: 10}},
                        sorting: {
                            sortModel: [{field: 'transmitters', sort: 'desc'}],
                        },
                    }}
                    slots={{
                        pagination: CustomPagination,
                    }}
                    onRowSelectionModelChange={(selection) => {
                        const normalized = toSelectedIds(selection).map((value) => Number(value));
                        dispatch(setSelected(normalized));
                    }}
                    localeText={{
                        noRowsLabel: t('satellite_database.no_satellites')
                    }}
                    sx={{
                        border: 0,
                        marginTop: 2,
                        minHeight: '429px',
                        width: '100%',
                        '& .MuiDataGrid-virtualScroller': {
                            overflowX: 'auto',
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
                        [`& .MuiDataGrid-row`]: {
                            cursor: 'pointer',
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
                        {t('satellite_database.add')}
                    </Button>
                    <Button variant="contained" disabled={selected.length !== 1} onClick={handleEditClick}>
                        {t('satellite_database.edit')}
                    </Button>
                    <Button
                        variant="contained"
                        disabled={selected.length !== 1}
                        onClick={() => {
                            const selectedId = Number(selected[0]);
                            if (Number.isNaN(selectedId)) {
                                return;
                            }
                            const satellite = satellites.find((row) => row.norad_id === selectedId);
                            if (!satellite) {
                                return;
                            }
                            handleOpenTransmitters(satellite);
                        }}
                    >
                        {t('satellite_database.edit_transmitters')}
                    </Button>
                    <Button
                        variant="contained"
                        color="error"
                        disabled={selected.length < 1}
                        onClick={() => dispatch(setOpenDeleteConfirm(true))}
                    >
                        {t('satellite_database.delete')}
                    </Button>
                </Stack>
            </div>
            <Alert severity="info" sx={{ mt: 2 }}>
                <AlertTitle>{t('satellite_database.title')}</AlertTitle>
                {t('satellite_database.subtitle')}
                {catalogStatsSuffix}
            </Alert>
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
                    {t('satellite_database.confirm_deletion')}
                </DialogTitle>
                <DialogContent sx={{ px: 3, pt: 3, pb: 3 }}>
                    <Typography variant="body1" sx={{ mt: 2, mb: 2, color: 'text.primary' }}>
                        {t('satellite_database.confirm_delete_intro')}
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 2, fontWeight: 600, color: 'text.secondary' }}>
                        {selected.length === 1
                            ? t('satellite_database.delete_single_label')
                            : t('satellite_database.delete_multiple_label', {count: selected.length})}
                    </Typography>
                    <Box sx={{
                        maxHeight: 300,
                        overflowY: 'auto',
                        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
                        borderRadius: 1,
                        border: (theme) => `1px solid ${theme.palette.divider}`,
                    }}>
                        {selected.map((id, index) => {
                            const satellite = satellites.find((row) => row.norad_id === Number(id));
                            if (!satellite) return null;
                            return (
                                <Box
                                    key={id}
                                    sx={{
                                        p: 2,
                                        borderBottom: index < selected.length - 1 ? (theme) => `1px solid ${theme.palette.divider}` : 'none',
                                    }}
                                >
                                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: 'text.primary' }}>
                                        {satellite.name}
                                    </Typography>
                                    <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 1, columnGap: 2 }}>
                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                            {t('satellite_database.norad_id')}:
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                            {satellite.norad_id}
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                            {t('satellite_database.status')}:
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                            {satellite.status || '-'}
                                        </Typography>
                                    </Box>
                                </Box>
                            );
                        })}
                    </Box>
                    <Box sx={{ mt: 2, p: 2, bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50', borderRadius: 1 }}>
                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'warning.main', fontWeight: 500, mb: 1 }}>
                            {t('satellite_database.cannot_undo')}
                        </Typography>
                        <Typography component="div" variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary' }}>
                            <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
                                <li>{t('satellite_database.delete_item_1')}</li>
                                <li>{t('satellite_database.delete_item_2')}</li>
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
                        {t('satellite_database.cancel')}
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
                        {t('satellite_database.delete')}
                    </Button>
                </DialogActions>
            </Dialog>
            <SatelliteEditDialog
                open={openAddDialog}
                onClose={handleCloseDialog}
                satelliteData={editingSatellite}
                onSaved={handleSatelliteSaved}
            />
            <TransmittersDialog
                open={transmittersDialogOpen}
                onClose={handleCloseTransmitters}
                title={t('satellite_database.edit_transmitters_title', {
                    name: clickedSatellite?.name || clickedSatellite?.norad_id || '',
                })}
                satelliteData={clickedSatellite}
                variant="paper"
                widthOffsetPx={20}
            />
        </Box>
    );
});

export default SatelliteTable;
