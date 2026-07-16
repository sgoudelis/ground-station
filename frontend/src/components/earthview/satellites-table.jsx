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

import React, { useRef, useState, useEffect, useCallback } from "react";
import { useStore } from 'react-redux';
import { useDispatch, useSelector } from "react-redux";
import { DataGrid, gridClasses } from "@mui/x-data-grid";
import { useGridApiRef } from '@mui/x-data-grid';
import { alpha, styled } from '@mui/material/styles';
import {Typography, Tooltip, Box, Button, useMediaQuery, useTheme} from "@mui/material";
import {
    getClassNamesBasedOnGridEditing,
    humanizeDate,
    islandTitleBarCompactSx,
    renderCountryFlagsCSV,
    TitleBar
} from "../common/common.jsx";
import ElevationDisplay from "../common/elevation-display.jsx";
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { formatDate as formatDateHelper } from '../../utils/date-time.js';
import RowContextMenu from "./rowcontextmenu.jsx";
import {
    EARTHVIEW_SATELLITES_DEFAULT_SORT_MODEL,
    setSelectedSatelliteId,
    setSatellitesTableColumnVisibility,
    setSatellitesTablePageSize,
    setSatellitesTableSortModel,
    setSelectedSatGroupId,
    fetchSatellitesByGroupId,
    fetchSatelliteGroups,
    setOpenSatellitesTableSettingsDialog,
} from './earthview-slice.jsx';
import { useTranslation } from 'react-i18next';
import { enUS, elGR } from '@mui/x-data-grid/locales';
import SettingsIcon from '@mui/icons-material/Settings';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import VisibilityIcon from '@mui/icons-material/Visibility';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import SettingsInputAntennaIcon from '@mui/icons-material/SettingsInputAntenna';
import BlockIcon from '@mui/icons-material/Block';
import {useSocket} from "../common/socket.jsx";
import { toast } from '../../utils/toast-with-timestamp.jsx';
import SatellitesTableSettingsDialog from './satellites-table-settings-dialog.jsx';
import IconButton from '@mui/material/IconButton';
import TargetNumberIcon from '../common/target-number-icon.jsx';
import { setRotator, setTrackerId, setTrackingStateInBackend } from "../target/target-slice.jsx";
import { useTargetRotatorSelectionDialog } from "../target/use-target-rotator-selection-dialog.jsx";
import SatelliteEditDialog from "../satellites/satellite-edit-dialog.jsx";
import TransmittersDialog from "../satellites/transmitters-dialog.jsx";
import { fetchSatellite } from "../satellites/satellite-slice.jsx";
import {
    setDialogOpen,
    setMonitoredSatelliteDialogOpen,
    setSelectedMonitoredSatellite,
    setSelectedObservation
} from "../scheduler/scheduler-slice.jsx";

const getVisibilityState = (elevation) => {
    if (elevation == null) return 'unknown';
    return elevation > 0 ? 'visible' : 'below';
};

const StyledDataGrid = styled(DataGrid)(({ theme }) => ({
    '& .MuiDataGrid-row': {
        borderLeft: '3px solid transparent',
    },
    '& .satellite-row-visible': {
        backgroundColor: alpha(theme.palette.success.main, 0.15),
        borderLeftColor: alpha(theme.palette.success.main, 0.9),
        ...theme.applyStyles('light', {
            backgroundColor: alpha(theme.palette.success.main, 0.08),
            borderLeftColor: alpha(theme.palette.success.main, 0.6),
        }),
        '&:hover': {
            backgroundColor: alpha(theme.palette.success.main, 0.2),
            ...theme.applyStyles('light', {
                backgroundColor: alpha(theme.palette.success.main, 0.12),
            }),
        },
    },
    '& .satellite-row-below': {
        backgroundColor: alpha(theme.palette.info.main, 0.1),
        borderLeftColor: alpha(theme.palette.info.main, 0.75),
        ...theme.applyStyles('light', {
            backgroundColor: alpha(theme.palette.info.main, 0.05),
            borderLeftColor: alpha(theme.palette.info.main, 0.5),
        }),
    },
    '& .satellite-row-dead': {
        backgroundColor: alpha(theme.palette.error.main, 0.18),
        borderLeftColor: alpha(theme.palette.error.main, 0.9),
        ...theme.applyStyles('light', {
            backgroundColor: alpha(theme.palette.error.main, 0.1),
            borderLeftColor: alpha(theme.palette.error.main, 0.65),
        }),
        '& .MuiDataGrid-cell': {
            color: theme.palette.text.secondary,
        },
    },
    '& .satellite-row-unknown': {
        borderLeftColor: alpha(theme.palette.text.secondary, 0.55),
    },
    '& .satellite-row-selected': {
        backgroundColor: alpha(theme.palette.secondary.main, 0.25),
        borderLeftColor: alpha(theme.palette.secondary.main, 0.95),
        fontWeight: 'bold',
        ...theme.applyStyles('light', {
            backgroundColor: alpha(theme.palette.secondary.main, 0.12),
            borderLeftColor: alpha(theme.palette.secondary.main, 0.75),
        }),
        '&:hover': {
            backgroundColor: alpha(theme.palette.secondary.main, 0.3),
            ...theme.applyStyles('light', {
                backgroundColor: alpha(theme.palette.secondary.main, 0.16),
            }),
        },
    }
}));

const MemoizedStyledDataGrid = React.memo(({
                                               apiRef,
                                               satellites,
                                               quickFilterPreset,
                                               onRowClick,
                                               onRowDoubleClick,
                                               onRowContextMenu,
                                               selectedSatelliteId,
                                               trackedSatelliteNoradIds = [],
                                               loadingSatellites,
                                               columnVisibility,
                                               onColumnVisibilityChange,
                                               selectedSatellitePositionsRef,
                                               pageSize = 50,
                                               onPageSizeChange,
                                               sortModel,
                                               onSortModelChange,
                                               targetNumberByNorad = {},
                                            }) => {
    const { t, i18n } = useTranslation('earthview');
    const currentLanguage = i18n.language;
    const dataGridLocale = currentLanguage === 'el' ? elGR : enUS;
    const theme = useTheme();
    const isCompactView = useMediaQuery(theme.breakpoints.down('md'));
    const [page, setPage] = useState(0);
    const { timezone, locale } = useUserTimeSettings();
    const [positionTick, setPositionTick] = useState(0);
    const trackedIdsSet = React.useMemo(
        () => new Set((trackedSatelliteNoradIds || []).map((id) => String(id))),
        [trackedSatelliteNoradIds]
    );

    const formatDate = useCallback((dateString) => {
        if (!dateString) return t('satellites_table.na');
        try {
            return formatDateHelper(dateString, {
                timezone,
                locale,
                options: { year: 'numeric', month: 'short', day: 'numeric' },
            });
        } catch (e) {
            return t('satellites_table.invalid_date');
        }
    }, [locale, t, timezone]);

    useEffect(() => {
        const intervalId = setInterval(() => {
            setPositionTick((v) => v + 1);
        }, 2000);
        return () => clearInterval(intervalId);
    }, []);

    const dynamicRows = React.useMemo(() => {
        const positions = selectedSatellitePositionsRef.current();
        return (satellites || []).map((satellite) => ({
            ...satellite,
            elevation: positions?.[satellite.norad_id]?.el ?? null,
            trend: positions?.[satellite.norad_id]?.trend ?? null,
            visibility: getVisibilityState(positions?.[satellite.norad_id]?.el ?? null),
            active_tx_count: (satellite.transmitters || []).filter((tx) => tx.alive).length,
        }));
    }, [satellites, selectedSatellitePositionsRef, positionTick]);

    const filteredSatellites = React.useMemo(() => {
        if (quickFilterPreset === 'visible') {
            return dynamicRows.filter((row) => row.visibility === 'visible');
        }
        if (quickFilterPreset === 'rising') {
            return dynamicRows.filter((row) => row.visibility === 'visible' && (row.trend === 'rising_slow' || row.trend === 'rising_fast'));
        }
        if (quickFilterPreset === 'activeTx') {
            return dynamicRows.filter((row) => (row.active_tx_count || 0) > 0);
        }
        if (quickFilterPreset === 'decayed') {
            return dynamicRows.filter((row) => !!row.decayed || row.status === 'dead' || row.status === 're-entered');
        }
        return dynamicRows;
    }, [dynamicRows, quickFilterPreset]);

    const columns = React.useMemo(() => [
        {
            field: 'name',
            minWidth: 100,
            headerName: t('satellites_table.satellite_name'),
            flex: 2,
            renderCell: (params) => {
                if (!params || !params.row) return <Typography>-</Typography>;
                const isTracked = trackedIdsSet.has(String(params.row.norad_id));
                const targetNumber = targetNumberByNorad[String(params.row.norad_id)];
                return (
                    <Box sx={{ display: 'flex', alignItems: 'center', height: '100%', width: '100%', minWidth: 0 }}>
                        {isTracked && (
                            <TargetNumberIcon
                                targetNumber={targetNumber}
                                prefix="T"
                                size={18}
                                sx={{ mr: 0.7, verticalAlign: 'middle', flexShrink: 0 }}
                            />
                        )}
                        <Typography
                            component="span"
                            variant="body2"
                            sx={{
                                fontWeight: 700,
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                lineHeight: 1.2,
                            }}
                        >
                            {params.value || '-'}
                        </Typography>
                    </Box>
                );
            }
        },
        {
            field: 'alternative_name',
            minWidth: 100,
            headerName: t('satellites_table.alternative_name'),
            flex: 2,
            renderCell: (params) => {
                if (!params || !params.row) return <Typography>-</Typography>;
                return <span>{params.value || '-'}</span>;
            }
        },
        {
            field: 'norad_id',
            minWidth: 70,
            headerName: t('satellites_table.norad'),
            align: 'center',
            headerAlign: 'center',
            flex: 1
        },
        {
            field: 'elevation',
            minWidth: 70,
            headerName: t('satellites_table.elevation'),
            align: 'center',
            headerAlign: 'center',
            flex: 1,
            renderCell: (params) => {
                const noradId = params.row.norad_id;
                const selectedSatellitePositions = selectedSatellitePositionsRef.current();
                const position = selectedSatellitePositions?.[noradId];

                return (
                    <ElevationDisplay
                        elevation={position?.el}
                        trend={position?.trend}
                        timeToMaxEl={position?.timeToMaxEl}
                        elRate={position?.elRate}
                    />
                );
            }
        },
        {
            field: 'visibility',
            minWidth: 100,
            headerName: t('satellites_table.visibility', { defaultValue: 'Visibility' }),
            align: 'center',
            headerAlign: 'center',
            flex: 1,
            sortComparator: (v1, v2) => {
                const rank = { visible: 2, unknown: 1, below: 0 };
                return (rank[v1] ?? 0) - (rank[v2] ?? 0);
            },
            renderCell: (params) => {
                const visibility = params.value || 'unknown';
                if (visibility === 'visible') {
                    return <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 700 }}>{t('satellites_table.visible', { defaultValue: 'Visible' })}</Typography>;
                }
                if (visibility === 'below') {
                    return <Typography variant="caption" sx={{ color: 'info.main', fontWeight: 700 }}>{t('satellites_table.below_horizon', { defaultValue: 'Below Horizon' })}</Typography>;
                }
                return <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>{t('satellites_table.status_unknown')}</Typography>;
            }
        },
        {
            field: 'status',
            minWidth: 90,
            headerName: t('satellites_table.status'),
            align: 'center',
            headerAlign: 'center',
            flex: 1,
            renderCell: (params) => {
                if (!params || !params.value) {
                    return <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>{t('satellites_table.status_unknown')}</Typography>;
                }

                const status = params.value;
                let color = 'default';
                let label = t('satellites_table.status_unknown');

                switch (status) {
                    case 'alive':
                        color = 'success';
                        label = t('satellites_table.status_active');
                        break;
                    case 'dead':
                        color = 'error';
                        label = t('satellites_table.status_inactive');
                        break;
                    case 're-entered':
                        color = 'warning';
                        label = t('satellites_table.status_reentered');
                        break;
                    default:
                        color = 'default';
                        label = t('satellites_table.status_unknown');
                }

                const textColor = color === 'success'
                    ? 'success.main'
                    : color === 'error'
                        ? 'error.main'
                        : color === 'warning'
                            ? 'warning.main'
                            : 'text.secondary';
                return <Typography variant="caption" sx={{ color: textColor, fontWeight: 700 }}>{label}</Typography>;
            }
        },
        {
            field: 'transmitters',
            minWidth: 90,
            headerName: t('satellites_table.transmitters'),
            align: 'center',
            headerAlign: 'center',
            flex: 1.2,
            renderCell: (params) => {
                if (!params?.row?.transmitters) return <span>0</span>;

                const transmitters = params.row.transmitters;
                const aliveCount = transmitters.filter(t => t.alive).length;
                const total = transmitters.length;
                const hasNoActive = aliveCount === 0;
                return (
                    <Typography variant="caption" sx={{ color: hasNoActive ? 'error.main' : 'success.main', fontWeight: 700 }}>
                        {aliveCount}/{total}
                    </Typography>
                );
            }
        },
        {
            field: 'active_tx_count',
            minWidth: 70,
            headerName: 'Active TX',
            type: 'number',
            hide: true,
        },
        {
            field: 'countries',
            minWidth: 120,
            headerName: t('satellites_table.countries'),
            align: 'center',
            headerAlign: 'center',
            flex: 1.5,
            renderCell: (params) => {
                if (!params?.value) {
                    return <span>-</span>;
                }
                return renderCountryFlagsCSV(params.value);
            }
        },
        {
            field: 'decayed',
            minWidth: 140,
            headerName: t('satellites_table.decayed'),
            align: 'center',
            headerAlign: 'center',
            flex: 1.5,
            renderCell: (params) => {
                if (!params || !params.value) return <span>-</span>;
                return <span>{formatDate(params.value)}</span>;
            }
        },
        {
            field: 'updated',
            minWidth: 140,
            headerName: t('satellites_table.updated'),
            align: 'center',
            headerAlign: 'center',
            flex: 1.5,
            renderCell: (params) => {
                if (!params || !params.value) return <span>{t('satellites_table.na')}</span>;
                try {
                    const date = new Date(params.value);
                    return <span>{humanizeDate(date)}</span>;
                } catch (e) {
                    return <span>{t('satellites_table.invalid_date')}</span>;
                }
            }
        },
        {
            field: 'launched',
            minWidth: 140,
            headerName: t('satellites_table.launched'),
            align: 'center',
            headerAlign: 'center',
            flex: 1.5,
            renderCell: (params) => {
                if (!params || !params.value) return <span>{t('satellites_table.na')}</span>;
                return <span>{formatDate(params.value)}</span>;
            }
        }
    ], [formatDate, trackedIdsSet, t, targetNumberByNorad]);

    const effectiveColumnVisibility = React.useMemo(() => {
        const base = {
            visibility: true,
            active_tx_count: false,
            ...columnVisibility,
        };
        if (!isCompactView) return base;
        return {
            ...base,
            alternative_name: false,
            countries: false,
            decayed: false,
            updated: false,
            launched: false,
        };
    }, [columnVisibility, isCompactView]);

    // Memoize the row class name function to prevent unnecessary rerenders
    const getSatelliteRowStyles = useCallback((params) => {
        if (!params.row) return "pointer-cursor";

        if (selectedSatelliteId === params.row.norad_id) {
            return "satellite-row-selected pointer-cursor";
        }

        const status = params.row.status;
        if (status === 'dead' || status === 're-entered') return "satellite-row-dead pointer-cursor";

        const visibility = getVisibilityState(params.row.elevation);
        if (visibility === 'visible') return "satellite-row-visible pointer-cursor";
        if (visibility === 'below') return "satellite-row-below pointer-cursor";
        if (visibility === 'unknown') return "satellite-row-unknown pointer-cursor";

        return "pointer-cursor";
    }, [selectedSatelliteId, positionTick]);

    const getRowId = useCallback((params) => params.norad_id, []);

    const handlePaginationModelChange = useCallback((model) => {
        setPage(model.page);
        if (onPageSizeChange && model.pageSize !== pageSize) {
            onPageSizeChange(model.pageSize);
        }
    }, [onPageSizeChange, pageSize]);

    // Bind context-menu directly on each row through slot props for consistent
    // behavior across browsers (including Firefox).
    const handleRowContextMenu = useCallback((event) => {
        if (typeof onRowContextMenu !== 'function') {
            return;
        }

        const rowId = event.currentTarget?.getAttribute?.('data-id');
        if (!rowId) return;
        const row = apiRef?.current?.getRow?.(rowId);
        if (!row) return;

        // Keep DataGrid's row selection in sync with right-click context actions.
        // This ensures visual selection updates even when no left-click occurred.
        if (typeof apiRef?.current?.selectRow === 'function') {
            apiRef.current.selectRow(row.norad_id, true, true);
        } else if (typeof apiRef?.current?.setRowSelectionModel === 'function') {
            apiRef.current.setRowSelectionModel({ type: 'include', ids: new Set([row.norad_id]) });
        }

        onRowContextMenu({ id: rowId, row }, event);
    }, [apiRef, onRowContextMenu]);

    return (
        <StyledDataGrid
            loading={loadingSatellites}
            slotProps={{
                loadingOverlay: {
                    variant: 'linear-progress',
                    noRowsVariant: 'linear-progress',
                },
                row: {
                    onContextMenu: handleRowContextMenu,
                },
            }}
            apiRef={apiRef}
            pageSizeOptions={[5, 10, 15, 20, 50]}
            fullWidth={true}
            getRowClassName={getSatelliteRowStyles}
            onRowClick={onRowClick}
            onRowDoubleClick={onRowDoubleClick}
            getRowId={getRowId}
            localeText={dataGridLocale.components.MuiDataGrid.defaultProps.localeText}
            columnVisibilityModel={effectiveColumnVisibility}
            onColumnVisibilityModelChange={onColumnVisibilityChange}
            sx={{
                border: 0,
                marginTop: 0,
                [`& .${gridClasses.cell}:focus, & .${gridClasses.cell}:focus-within`]: {
                    outline: 'none',
                },
                [`& .${gridClasses.columnHeader}:focus, & .${gridClasses.columnHeader}:focus-within`]: {
                    outline: 'none',
                },
            }}
            density={"compact"}
            rows={filteredSatellites}
            paginationModel={{
                pageSize: pageSize,
                page: page,
            }}
            onPaginationModelChange={handlePaginationModelChange}
            sortModel={sortModel}
            onSortModelChange={onSortModelChange}
            columns={columns}
            pinnedColumns={isCompactView ? { left: ['name'], right: [] } : { left: ['name'], right: ['elevation'] }}
        />
    );
});

const SatelliteDetailsTable = React.memo(function SatelliteDetailsTable() {
    const dispatch = useDispatch();
    const { t } = useTranslation('earthview');
    const { socket } = useSocket();
    const theme = useTheme();
    const isCompactHeader = useMediaQuery(theme.breakpoints.down('lg'));
    const isTightHeader = useMediaQuery(theme.breakpoints.down('md'));
    const containerRef = useRef(null);
    const [containerHeight, setContainerHeight] = useState(0);
    const apiRef = useGridApiRef();
    const store = useStore();

    // Use ref-based selector to prevent re-renders from position updates
    const selectedSatellitePositionsRef = useRef(() => {
        const state = store.getState();
        return state.earthViewTrack.selectedSatellitePositions;
    });

    // Use memoized selectors to prevent unnecessary rerenders
    const selectedSatellites = useSelector(state => state.earthViewTrack.selectedSatellites);
    const gridEditable = useSelector(state => state.earthViewTrack.gridEditable);
    const loadingSatellites = useSelector(state => state.earthViewTrack.loadingSatellites);
    const selectedSatelliteId = useSelector(state => state.targetSatTrack?.satelliteData?.details?.norad_id);
    const selectedSatGroupId = useSelector(state => state.earthViewTrack.selectedSatGroupId);
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
    const trackingState = useSelector((state) => state.targetSatTrack?.trackingState || {});
    const trackerViews = useSelector((state) => state.targetSatTrack?.trackerViews || {});
    const columnVisibility = useSelector(state => state.earthViewTrack.satellitesTableColumnVisibility);
    const satellitesTablePageSize = useSelector(state => state.earthViewTrack.satellitesTablePageSize);
    const satellitesTableSortModel = useSelector(state => state.earthViewTrack.satellitesTableSortModel);
    const openSatellitesTableSettingsDialog = useSelector(state => state.earthViewTrack.openSatellitesTableSettingsDialog);
    const { requestRotatorForTarget, dialog: rotatorSelectionDialog } = useTargetRotatorSelectionDialog();
    const trackedSatelliteNoradIds = React.useMemo(() => {
        return trackerInstances
            .filter((instance) => {
                const groupId = instance?.tracking_state?.group_id;
                if (!selectedSatGroupId || !groupId) return true;
                return String(groupId) === String(selectedSatGroupId);
            })
            .map((instance) => instance?.tracking_state?.norad_id)
            .filter((noradId) => noradId != null);
    }, [trackerInstances, selectedSatGroupId]);
    const targetNumberByNorad = React.useMemo(() => {
        const mapping = {};
        trackerInstances.forEach((instance, index) => {
            const groupId = instance?.tracking_state?.group_id;
            if (selectedSatGroupId && groupId && String(groupId) !== String(selectedSatGroupId)) {
                return;
            }
            const noradId = instance?.tracking_state?.norad_id;
            if (noradId == null) {
                return;
            }
            const key = String(noradId);
            const targetNumber = Number(instance?.target_number || (index + 1));
            if (mapping[key] == null || targetNumber < mapping[key]) {
                mapping[key] = targetNumber;
            }
        });
        return mapping;
    }, [trackerInstances, selectedSatGroupId]);

    const minHeight = 200;
    const hasLoadedFromStorageRef = useRef(false);
    const isLoadingRef = useRef(false);
    const [quickFilterPreset, setQuickFilterPreset] = useState('all');
    // Keep row context menu state local so actions always target the currently right-clicked row.
    const [satelliteContextMenu, setSatelliteContextMenu] = useState(null);
    const [satelliteEditDialogOpen, setSatelliteEditDialogOpen] = useState(false);
    const [transmittersDialogOpen, setTransmittersDialogOpen] = useState(false);
    const [contextSatelliteForDialogs, setContextSatelliteForDialogs] = useState(null);
    const latestDialogSatelliteRequestRef = useRef(0);

    // Load column visibility from localStorage on mount
    useEffect(() => {
        // Prevent double loading (React StrictMode or component remounting)
        if (isLoadingRef.current || hasLoadedFromStorageRef.current) {
            return;
        }

        isLoadingRef.current = true;

        const loadColumnVisibility = () => {
            try {
                const stored = localStorage.getItem('satellites-table-column-visibility');
                if (stored) {
                    const parsedVisibility = JSON.parse(stored);
                    dispatch(setSatellitesTableColumnVisibility(parsedVisibility));
                }
            } catch (e) {
                console.error('Failed to load satellites table column visibility:', e);
            } finally {
                hasLoadedFromStorageRef.current = true;
                isLoadingRef.current = false;
            }
        };
        loadColumnVisibility();
    }, []); // Empty deps - only run once on mount

    // Persist column visibility to localStorage whenever it changes (but not on initial load)
    useEffect(() => {
        if (columnVisibility && hasLoadedFromStorageRef.current) {
            try {
                localStorage.setItem('satellites-table-column-visibility', JSON.stringify(columnVisibility));
            } catch (e) {
                console.error('Failed to save satellites table column visibility:', e);
            }
        }
    }, [columnVisibility]);

    useEffect(() => {
        dispatch(fetchSatelliteGroups({socket}))
            .unwrap()
            .then((data) => {
                if (data && selectedSatGroupId !== "" && selectedSatGroupId !== "none") {
                    // Verify the group ID exists in the loaded groups before fetching satellites
                    const groupExists = data.some(group => group.id === selectedSatGroupId);
                    if (groupExists) {
                        dispatch(fetchSatellitesByGroupId({socket: socket, satGroupId: selectedSatGroupId}));
                    } else {
                        console.warn(`Satellite group ${selectedSatGroupId} not found in loaded groups. Clearing selection.`);
                        dispatch(setSelectedSatGroupId(""));
                    }
                }
            })
            .catch((err) => {
                toast.error(t('satellite_selector.failed_load_groups') + ": " + err.message)
            });
    }, []);

    useEffect(() => {
        const target = containerRef.current;
        const observer = new ResizeObserver((entries) => {
            setContainerHeight(entries[0].contentRect.height);
        });
        if (target) {
            observer.observe(target);
        }
        return () => {
            observer.disconnect();
        };
    }, [containerRef]);

    const handleOnRowClick = useCallback((params) => {
        dispatch(setSelectedSatelliteId(params.row.norad_id));
    }, [dispatch]);

    const handleOnRowDoubleClick = useCallback((params) => {
        dispatch(setSelectedSatelliteId(params.row.norad_id));
    }, [dispatch]);

    const handleColumnVisibilityChange = useCallback((newModel) => {
        dispatch(setSatellitesTableColumnVisibility(newModel));
    }, [dispatch]);

    const handlePageSizeChange = useCallback((newPageSize) => {
        dispatch(setSatellitesTablePageSize(newPageSize));
    }, [dispatch]);

    const handleSortModelChange = useCallback((newSortModel) => {
        dispatch(setSatellitesTableSortModel(newSortModel));
    }, [dispatch]);

    const handleOpenSettings = useCallback(() => {
        dispatch(setOpenSatellitesTableSettingsDialog(true));
    }, [dispatch]);

    const handleCloseSettings = useCallback(() => {
        dispatch(setOpenSatellitesTableSettingsDialog(false));
    }, [dispatch]);

    const applyDefaultSort = useCallback(() => {
        dispatch(setSatellitesTableSortModel([...EARTHVIEW_SATELLITES_DEFAULT_SORT_MODEL]));
    }, [dispatch]);

    const handleQuickPreset = useCallback((preset) => {
        setQuickFilterPreset(preset);
        if (preset === 'all') {
            applyDefaultSort();
        } else if (preset === 'visible' || preset === 'rising') {
            dispatch(setSatellitesTableSortModel([
                { field: 'elevation', sort: 'desc' },
                { field: 'name', sort: 'asc' },
            ]));
        } else if (preset === 'activeTx') {
            dispatch(setSatellitesTableSortModel([
                { field: 'active_tx_count', sort: 'desc' },
                { field: 'name', sort: 'asc' },
            ]));
        } else if (preset === 'decayed') {
            dispatch(setSatellitesTableSortModel([
                { field: 'decayed', sort: 'desc' },
                { field: 'name', sort: 'asc' },
            ]));
        }
    }, [dispatch, applyDefaultSort]);

    const copyTextToClipboard = useCallback(async (text) => {
        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }

        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.setAttribute('readonly', '');
        textArea.style.position = 'absolute';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
    }, []);

    const handleCloseSatelliteContextMenu = useCallback(() => {
        setSatelliteContextMenu(null);
    }, []);

    const handleSuppressNativeContextMenu = useCallback((event) => {
        event.preventDefault();
        if (typeof event.stopPropagation === 'function') {
            event.stopPropagation();
        }
        setSatelliteContextMenu(null);
    }, []);

    const handleSatelliteRowContextMenu = useCallback((params, event) => {
        if (!params?.row) {
            return;
        }
        event.preventDefault();
        if (typeof event.stopPropagation === 'function') {
            event.stopPropagation();
        }
        // UX preference: the next right click closes the currently open menu.
        if (satelliteContextMenu) {
            setSatelliteContextMenu(null);
            return;
        }
        dispatch(setSelectedSatelliteId(params.row.norad_id));
        setSatelliteContextMenu({
            mouseX: event.clientX + 2,
            mouseY: event.clientY - 6,
            row: params.row,
        });
    }, [dispatch, satelliteContextMenu]);

    const hydrateSatelliteForDialogs = useCallback((satelliteRow) => {
        if (!satelliteRow) {
            return;
        }

        setContextSatelliteForDialogs(satelliteRow);
        const parsedNoradId = Number(satelliteRow.norad_id);
        if (Number.isNaN(parsedNoradId) || !socket) {
            return;
        }

        const requestId = latestDialogSatelliteRequestRef.current + 1;
        latestDialogSatelliteRequestRef.current = requestId;
        dispatch(fetchSatellite({ socket, noradId: parsedNoradId }))
            .unwrap()
            .then((response) => {
                if (latestDialogSatelliteRequestRef.current !== requestId) {
                    return;
                }
                const details = response?.details || {};
                const transmitters = Array.isArray(response?.transmitters)
                    ? response.transmitters
                    : (satelliteRow?.transmitters || []);
                setContextSatelliteForDialogs({
                    ...satelliteRow,
                    ...details,
                    transmitters,
                });
            })
            .catch(() => {
                // Keep using the row payload if fetching richer details fails.
            });
    }, [dispatch, socket]);

    const buildSchedulerSatellitePayload = useCallback((row) => {
        return {
            norad_id: row?.norad_id ?? '',
            name: row?.name || `NORAD ${row?.norad_id ?? ''}`,
            group_id: row?.group_id || selectedSatGroupId || '',
        };
    }, [selectedSatGroupId]);

    const handleSetTrackingOnBackend = useCallback(async (row) => {
        if (!row?.norad_id) {
            return;
        }

        dispatch(setSelectedSatelliteId(row.norad_id));
        const selectedAssignment = await requestRotatorForTarget(row?.name || String(row.norad_id));
        if (!selectedAssignment) {
            return;
        }

        const assignmentAction = String(selectedAssignment?.action || 'retarget_current_slot');
        const isCreateNewSlot = assignmentAction === 'create_new_slot';
        const trackerId = String(selectedAssignment?.trackerId || '');
        const rotatorId = String(selectedAssignment?.rotatorId || 'none');
        const assignmentRigId = String(selectedAssignment?.rigId || 'none');
        if (!trackerId) {
            return;
        }

        const selectedTrackerInstance = trackerInstances.find(
            (instance) => String(instance?.tracker_id || '') === trackerId
        );
        const selectedTrackerView = trackerViews?.[trackerId] || {};
        const selectedTrackerState = selectedTrackerView?.trackingState || selectedTrackerInstance?.tracking_state || {};
        const nextRigId = isCreateNewSlot
            ? assignmentRigId
            : String(
                selectedTrackerView?.selectedRadioRig
                ?? selectedTrackerState?.rig_id
                ?? assignmentRigId
                ?? 'none'
            );
        const nextRotatorId = isCreateNewSlot ? 'none' : rotatorId;
        const nextTransmitterId = isCreateNewSlot
            ? 'none'
            : String(selectedTrackerState?.transmitter_id || 'none');
        const nextGroupId = selectedSatGroupId || selectedTrackerState?.group_id || trackingState?.group_id || '';

        dispatch(setTrackerId(trackerId));
        dispatch(setRotator({ value: nextRotatorId, trackerId }));

        const normalizedTargetName = String(row?.name || row?.norad_id || '').trim();
        const satelliteTargetPatch = {
            target_type: 'satellite',
            target_name: normalizedTargetName || String(row?.norad_id || '').trim(),
            command: null,
            body_id: null,
        };

        const newTrackingState = isCreateNewSlot
            ? {
                tracker_id: trackerId,
                norad_id: row.norad_id,
                group_id: nextGroupId,
                ...satelliteTargetPatch,
                rig_id: nextRigId,
                rotator_id: nextRotatorId,
                transmitter_id: 'none',
                rig_state: 'disconnected',
                rotator_state: 'disconnected',
                rig_vfo: 'none',
                vfo1: 'uplink',
                vfo2: 'downlink',
            }
            : {
                ...selectedTrackerState,
                tracker_id: trackerId,
                norad_id: row.norad_id,
                group_id: nextGroupId,
                ...satelliteTargetPatch,
                rig_id: nextRigId,
                rotator_id: nextRotatorId,
                transmitter_id: nextTransmitterId,
            };

        await dispatch(setTrackingStateInBackend({ socket, data: newTrackingState })).unwrap();
    }, [
        dispatch,
        requestRotatorForTarget,
        selectedSatGroupId,
        socket,
        trackerInstances,
        trackerViews,
        trackingState?.group_id,
    ]);

    const handleOpenSatelliteEditDialog = useCallback((row) => {
        if (!row) {
            return;
        }
        setSatelliteEditDialogOpen(true);
        hydrateSatelliteForDialogs(row);
    }, [hydrateSatelliteForDialogs]);

    const handleOpenTransmittersDialog = useCallback((row) => {
        if (!row) {
            return;
        }
        setTransmittersDialogOpen(true);
        hydrateSatelliteForDialogs(row);
    }, [hydrateSatelliteForDialogs]);

    const handleScheduleObservation = useCallback((row) => {
        const satellite = buildSchedulerSatellitePayload(row);
        dispatch(setSelectedMonitoredSatellite(null));
        dispatch(setMonitoredSatelliteDialogOpen(false));
        dispatch(setSelectedObservation({
            name: `${satellite.name} observation`,
            enabled: true,
            satellite,
            pass: null,
            sessions: [],
            rotator: {
                id: null,
                tracking_enabled: false,
                unpark_before_tracking: false,
                park_after_observation: false,
            },
            rig: { id: null, doppler_correction: false, vfo: 'VFO_A' },
        }));
        dispatch(setDialogOpen(true));
    }, [buildSchedulerSatellitePayload, dispatch]);

    const handleMonitorSatellite = useCallback((row) => {
        const satellite = buildSchedulerSatellitePayload(row);
        dispatch(setSelectedObservation(null));
        dispatch(setDialogOpen(false));
        dispatch(setSelectedMonitoredSatellite({
            enabled: true,
            satellite,
            sessions: [],
            rotator: {
                id: null,
                tracking_enabled: false,
                unpark_before_tracking: false,
                park_after_observation: false,
            },
            rig: { id: null, doppler_correction: false, vfo: 'VFO_A' },
            min_elevation: 20,
            task_start_elevation: 10,
            lookahead_hours: 24,
        }));
        dispatch(setMonitoredSatelliteDialogOpen(true));
    }, [buildSchedulerSatellitePayload, dispatch]);

    const handleSatelliteSaved = useCallback(() => {
        if (!selectedSatGroupId || selectedSatGroupId === 'none' || !socket) {
            return;
        }
        dispatch(fetchSatellitesByGroupId({ socket, satGroupId: selectedSatGroupId }));
    }, [dispatch, selectedSatGroupId, socket]);

    const handleSatelliteMenuAction = useCallback(async (action) => {
        const row = satelliteContextMenu?.row;
        if (!row) {
            return;
        }

        try {
            if (action === 'set-target') {
                await handleSetTrackingOnBackend(row);
                return;
            }

            if (action === 'edit-properties') {
                handleOpenSatelliteEditDialog(row);
                return;
            }

            if (action === 'edit-transmitters') {
                handleOpenTransmittersDialog(row);
                return;
            }

            if (action === 'schedule-observation') {
                handleScheduleObservation(row);
                return;
            }

            if (action === 'monitor-satellite') {
                handleMonitorSatellite(row);
                return;
            }

            if (action === 'copy-norad') {
                await copyTextToClipboard(String(row.norad_id ?? ''));
                toast.success('NORAD ID copied to clipboard');
                return;
            }

            if (action === 'copy-summary') {
                const totalTx = Array.isArray(row.transmitters) ? row.transmitters.length : 0;
                const activeTx = Array.isArray(row.transmitters) ? row.transmitters.filter((tx) => tx.alive).length : 0;
                const summary = `${row.name || '-'} | NORAD ${row.norad_id ?? '-'} | Status ${row.status || 'unknown'} | TX ${activeTx}/${totalTx}`;
                await copyTextToClipboard(summary);
                toast.success('Satellite summary copied to clipboard');
            }
        } catch (error) {
            toast.error(`Failed to process menu action: ${error?.message || 'Unknown error'}`);
        } finally {
            setSatelliteContextMenu(null);
        }
    }, [
        copyTextToClipboard,
        handleMonitorSatellite,
        handleOpenSatelliteEditDialog,
        handleOpenTransmittersDialog,
        handleScheduleObservation,
        handleSetTrackingOnBackend,
        satelliteContextMenu,
    ]);

    useEffect(() => {
        const handleKeyboardShortcuts = (event) => {
            if (!event.altKey) return;
            if (event.key === '1') handleQuickPreset('all');
            else if (event.key === '2') handleQuickPreset('visible');
            else if (event.key === '3') handleQuickPreset('rising');
            else if (event.key === '4') handleQuickPreset('activeTx');
            else if (event.key === '5') handleQuickPreset('decayed');
            else return;
            event.preventDefault();
        };
        window.addEventListener('keydown', handleKeyboardShortcuts);
        return () => window.removeEventListener('keydown', handleKeyboardShortcuts);
    }, [handleQuickPreset]);

    const quickFilterButtonSx = React.useMemo(() => ({
        minHeight: isTightHeader ? 20 : (isCompactHeader ? 22 : 24),
        height: isTightHeader ? 20 : (isCompactHeader ? 22 : 24),
        py: 0,
        px: isTightHeader ? 0.7 : (isCompactHeader ? 0.85 : 1),
        lineHeight: 1.05,
        fontSize: isTightHeader ? '0.64rem' : (isCompactHeader ? '0.68rem' : '0.72rem'),
        minWidth: isTightHeader ? 30 : 'auto',
        whiteSpace: 'nowrap',
    }), [isCompactHeader, isTightHeader]);
    const titleIconButtonSx = React.useMemo(
        () => ({ padding: isTightHeader ? '1px' : '2px' }),
        [isTightHeader]
    );
    const satelliteContextMenuItems = React.useMemo(() => ([
        { key: 'set-target', label: t('satellites_table.context_menu.set_as_target'), onClick: () => handleSatelliteMenuAction('set-target') },
        { key: 'edit-properties', label: t('satellites_table.context_menu.edit_properties'), onClick: () => handleSatelliteMenuAction('edit-properties') },
        { key: 'edit-transmitters', label: t('satellites_table.context_menu.edit_transmitters'), onClick: () => handleSatelliteMenuAction('edit-transmitters') },
        { key: 'schedule-observation', label: t('satellites_table.context_menu.schedule_observation'), onClick: () => handleSatelliteMenuAction('schedule-observation') },
        { key: 'monitor-satellite', label: t('satellites_table.context_menu.monitor_satellite'), onClick: () => handleSatelliteMenuAction('monitor-satellite') },
        { type: 'divider', key: 'divider-copy' },
        { key: 'copy-norad', label: t('satellites_table.context_menu.copy_norad'), onClick: () => handleSatelliteMenuAction('copy-norad') },
        { key: 'copy-summary', label: t('satellites_table.context_menu.copy_summary'), onClick: () => handleSatelliteMenuAction('copy-summary') },
    ]), [handleSatelliteMenuAction, t]);

    return (
        <>
            {rotatorSelectionDialog}
            <TitleBar
                className={getClassNamesBasedOnGridEditing(gridEditable, ["window-title-bar"])}
                sx={islandTitleBarCompactSx}
            >
                <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', height: '100%'}}>
                    <Box sx={{display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, pr: 1}}>
                        <Typography
                            variant="subtitle2"
                            sx={{
                                fontWeight: 'bold',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                            }}
                        >
                            {t('satellites_table.group_title')}
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', flexShrink: 0 }}>
                        <Tooltip title="All satellites (Alt+1)">
                            <span>
                                <Button
                                    size="small"
                                    variant={quickFilterPreset === 'all' ? 'contained' : 'outlined'}
                                    onClick={() => handleQuickPreset('all')}
                                    sx={quickFilterButtonSx}
                                    aria-label="All satellites"
                                >
                                    {isTightHeader ? <DoneAllIcon sx={{ fontSize: '0.82rem' }} /> : 'All'}
                                </Button>
                            </span>
                        </Tooltip>
                        <Tooltip title="Visible satellites (Alt+2)">
                            <span>
                                <Button
                                    size="small"
                                    variant={quickFilterPreset === 'visible' ? 'contained' : 'outlined'}
                                    onClick={() => handleQuickPreset('visible')}
                                    sx={quickFilterButtonSx}
                                    aria-label="Visible satellites"
                                >
                                    {isTightHeader ? <VisibilityIcon sx={{ fontSize: '0.82rem' }} /> : 'Visible'}
                                </Button>
                            </span>
                        </Tooltip>
                        <Tooltip title="Rising satellites (Alt+3)">
                            <span>
                                <Button
                                    size="small"
                                    variant={quickFilterPreset === 'rising' ? 'contained' : 'outlined'}
                                    onClick={() => handleQuickPreset('rising')}
                                    sx={quickFilterButtonSx}
                                    aria-label="Rising satellites"
                                >
                                    {isTightHeader ? <TrendingUpIcon sx={{ fontSize: '0.82rem' }} /> : 'Rising'}
                                </Button>
                            </span>
                        </Tooltip>
                        <Tooltip title="Satellites with active transmitters (Alt+4)">
                            <span>
                                <Button
                                    size="small"
                                    variant={quickFilterPreset === 'activeTx' ? 'contained' : 'outlined'}
                                    onClick={() => handleQuickPreset('activeTx')}
                                    sx={quickFilterButtonSx}
                                    aria-label="Satellites with active transmitters"
                                >
                                    {isTightHeader ? <SettingsInputAntennaIcon sx={{ fontSize: '0.82rem' }} /> : 'Active TX'}
                                </Button>
                            </span>
                        </Tooltip>
                        <Tooltip title="Decayed satellites (Alt+5)">
                            <span>
                                <Button
                                    size="small"
                                    variant={quickFilterPreset === 'decayed' ? 'contained' : 'outlined'}
                                    onClick={() => handleQuickPreset('decayed')}
                                    sx={quickFilterButtonSx}
                                    aria-label="Decayed satellites"
                                >
                                    {isTightHeader ? <BlockIcon sx={{ fontSize: '0.82rem' }} /> : 'Decayed'}
                                </Button>
                            </span>
                        </Tooltip>
                        <Tooltip title={t('satellites_table_settings.title')}>
                            <span>
                                <IconButton
                                    size="small"
                                    onClick={handleOpenSettings}
                                    sx={titleIconButtonSx}
                                >
                                    <SettingsIcon fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>
                    </Box>
                </Box>
            </TitleBar>
            <div style={{ position: 'relative', display: 'block', height: '100%' }} ref={containerRef}>
                <div style={{
                    padding: '0rem 0rem 0rem 0rem',
                    display: 'flex',
                    flexDirection: 'column',
                    height: containerHeight - 25,
                    minHeight,
                }}>
                    {!selectedSatGroupId ? (
                        <Box
                            sx={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                height: '100%',
                            }}
                        >
                            <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
                                {t('satellites_table.no_group_selected')}
                            </Typography>
                        </Box>
                    ) : (
                        <MemoizedStyledDataGrid
                            apiRef={apiRef}
                            satellites={selectedSatellites}
                            quickFilterPreset={quickFilterPreset}
                            onRowClick={handleOnRowClick}
                            onRowDoubleClick={handleOnRowDoubleClick}
                            onRowContextMenu={handleSatelliteRowContextMenu}
                            selectedSatelliteId={selectedSatelliteId}
                            trackedSatelliteNoradIds={trackedSatelliteNoradIds}
                            loadingSatellites={loadingSatellites}
                            columnVisibility={columnVisibility}
                            onColumnVisibilityChange={handleColumnVisibilityChange}
                            selectedSatellitePositionsRef={selectedSatellitePositionsRef}
                            pageSize={satellitesTablePageSize}
                            onPageSizeChange={handlePageSizeChange}
                            sortModel={satellitesTableSortModel}
                            onSortModelChange={handleSortModelChange}
                            targetNumberByNorad={targetNumberByNorad}
                        />
                    )}
                </div>
            </div>
            <RowContextMenu
                open={Boolean(satelliteContextMenu)}
                onClose={handleCloseSatelliteContextMenu}
                onSuppressNativeContextMenu={handleSuppressNativeContextMenu}
                anchorPosition={
                    satelliteContextMenu
                        ? { top: satelliteContextMenu.mouseY, left: satelliteContextMenu.mouseX }
                        : undefined
                }
                title={satelliteContextMenu?.row?.name || `NORAD ${satelliteContextMenu?.row?.norad_id ?? '-'}`}
                noradId={satelliteContextMenu?.row?.norad_id}
                items={satelliteContextMenuItems}
            />
            <SatellitesTableSettingsDialog
                open={openSatellitesTableSettingsDialog}
                onClose={handleCloseSettings}
            />
            <SatelliteEditDialog
                open={satelliteEditDialogOpen}
                onClose={() => setSatelliteEditDialogOpen(false)}
                satelliteData={contextSatelliteForDialogs}
                onSaved={handleSatelliteSaved}
            />
            <TransmittersDialog
                open={transmittersDialogOpen}
                onClose={() => setTransmittersDialogOpen(false)}
                title={t('satellites_table.context_menu.edit_transmitters_title', {
                    name: contextSatelliteForDialogs?.name || contextSatelliteForDialogs?.norad_id || '',
                })}
                satelliteData={contextSatelliteForDialogs}
                variant="paper"
                widthOffsetPx={20}
            />
        </>
    );
});

export default SatelliteDetailsTable;
