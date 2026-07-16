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

import {Box, Typography, Dialog, DialogTitle, DialogContent, DialogActions, Tooltip, Stack, IconButton} from "@mui/material";
import Button from "@mui/material/Button";
import * as React from "react";
import {useState, useEffect, useMemo, useCallback} from "react";
import { createPortal } from "react-dom";
import {
    DataGrid,
    gridClasses,
} from "@mui/x-data-grid";
import EditIcon from '@mui/icons-material/Edit';
import {useDispatch} from "react-redux";
import { deleteTransmitter, fetchTransmitters } from "./satellite-slice.jsx";
import { setTargetTransmitters } from "../target/target-slice.jsx";
import {useSocket} from "../common/socket.jsx";
import TransmitterModal from "./transmitter-modal.jsx";
import { useTranslation } from 'react-i18next';
import {toSelectedIds} from '../../utils/datagrid-selection.js';

// Frequency formatting function
const formatFrequency = (frequency) => {
    if (!frequency || frequency === "-" || isNaN(parseFloat(frequency))) {
        return "-";
    }

    const freq = parseFloat(frequency);

    if (freq >= 1000000000) {
        // GHz range
        const ghz = (freq / 1000000000).toFixed(3);
        return (
            <Tooltip title={`${freq.toLocaleString()} Hz`} arrow>
                <span>{ghz} GHz</span>
            </Tooltip>
        );
    } else if (freq >= 1000000) {
        // MHz range
        const mhz = (freq / 1000000).toFixed(3);
        return (
            <Tooltip title={`${freq.toLocaleString()} Hz`} arrow>
                <span>{mhz} MHz</span>
            </Tooltip>
        );
    } else if (freq >= 1000) {
        // kHz range
        const khz = (freq / 1000).toFixed(3);
        return (
            <Tooltip title={`${freq.toLocaleString()} Hz`} arrow>
                <span>{khz} kHz</span>
            </Tooltip>
        );
    } else {
        // Hz range
        return (
            <Tooltip title={`${freq.toLocaleString()} Hz`} arrow>
                <span>{freq} Hz</span>
            </Tooltip>
        );
    }
};

const displayValue = (value) => (value === null || value === undefined || value === "" ? "-" : value);

const paginationModel = {page: 0, pageSize: 10};

const resolveTransmitterOwner = (ownerData = {}) => {
    const targetKey = String(ownerData?.target_key || ownerData?.targetKey || '').trim();
    if (targetKey) {
        return { targetKey };
    }
    const satelliteId = ownerData?.norad_id ?? ownerData?.details?.norad_id;
    if (satelliteId != null && String(satelliteId).trim() !== '') {
        return { satelliteId };
    }
    return null;
};

const mapTransmittersToRows = (transmitters = []) => (
    transmitters.map((transmitter, index) => ({
        id: transmitter.id || `existing-${index}`,
        description: displayValue(transmitter.description),
        source: displayValue(transmitter.source),
        type: displayValue(transmitter.type),
        status: displayValue(transmitter.status),
        alive: displayValue(transmitter.alive),
        uplinkLow: displayValue(transmitter.uplink_low),
        uplinkHigh: displayValue(transmitter.uplink_high),
        uplinkDrift: displayValue(transmitter.uplink_drift),
        downlinkLow: displayValue(transmitter.downlink_low),
        downlinkHigh: displayValue(transmitter.downlink_high),
        downlinkDrift: displayValue(transmitter.downlink_drift),
        mode: displayValue(transmitter.mode),
        uplinkMode: displayValue(transmitter.uplink_mode),
        invert: displayValue(transmitter.invert),
        baud: displayValue(transmitter.baud),
        _original: transmitter,
    }))
);

const TransmittersTable = ({ satelliteData, inDialog = false, actionsPortalTarget = null }) => {
    const { t } = useTranslation('satellites');
    const [editModalOpen, setEditModalOpen] = useState(false);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [editingTransmitter, setEditingTransmitter] = useState(null);
    const [isNewTransmitter, setIsNewTransmitter] = useState(false);
    const [selected, setSelected] = useState([]);
    const [rows, setRows] = useState([]);
    const [dialogColumnWidths, setDialogColumnWidths] = useState({});
    const dispatch = useDispatch();
    const {socket} = useSocket();
    const transmitterOwner = React.useMemo(() => resolveTransmitterOwner(satelliteData), [satelliteData]);

    // Seed rows from incoming props for quick first render while the explicit owner fetch runs.
    useEffect(() => {
        const incomingTransmitters = Array.isArray(satelliteData?.transmitters)
            ? satelliteData.transmitters
            : [];
        if (incomingTransmitters.length > 0) {
            setRows(mapTransmittersToRows(incomingTransmitters));
            return;
        }
        setRows((currentRows) => (currentRows.length > 0 ? currentRows : []));
    }, [satelliteData?.transmitters]);

    useEffect(() => {
        if (!socket || !transmitterOwner) {
            return;
        }

        let active = true;
        dispatch(fetchTransmitters({
            socket,
            satelliteId: transmitterOwner?.satelliteId,
            targetKey: transmitterOwner?.targetKey,
        }))
            .unwrap()
            .then((result) => {
                if (!active || !Array.isArray(result)) {
                    return;
                }
                setRows(mapTransmittersToRows(result));
                dispatch(
                    setTargetTransmitters({
                        noradId: transmitterOwner?.satelliteId,
                        targetKey: transmitterOwner?.targetKey,
                        transmitters: result,
                        updatedAtMs: Date.now(),
                        lockDurationMs: 5000,
                    })
                );
            })
            .catch((error) => {
                console.error('Failed to fetch transmitters:', error);
            });

        return () => {
            active = false;
        };
    }, [dispatch, socket, transmitterOwner?.satelliteId, transmitterOwner?.targetKey]);

    const handleAddClick = () => {
        setEditingTransmitter(null);
        setIsNewTransmitter(true);
        setEditModalOpen(true);
    };

    const openTransmitterForEdit = useCallback((transmitter) => {
        if (!transmitter) return;
        setEditingTransmitter(transmitter);
        setIsNewTransmitter(false);
        setEditModalOpen(true);
    }, []);

    const handleEditClick = () => {
        const singleRowId = selected[0];
        openTransmitterForEdit(rows.find((row) => row.id === singleRowId));
    };

    const openTransmitterForDuplicate = (rowId) => {
        const transmitter = rows.find(row => row.id === rowId);
        if (!transmitter) return;
        // Keep the selected values, but open the modal in "new" mode so a new record is created.
        setEditingTransmitter(transmitter);
        setIsNewTransmitter(true);
        setEditModalOpen(true);
    };

    const handleDuplicateClick = () => {
        const singleRowId = selected[0];
        openTransmitterForDuplicate(singleRowId);
    };

    const handleDeleteClick = () => {
        setDeleteConfirmOpen(true);
    };

    const handleDeleteConfirm = async () => {
        try {
            let latestTransmitters = null;
            // Delete all selected transmitters
            for (const selectedId of selected) {
                const transmitter = rows.find(row => row.id === selectedId);
                if (transmitter && transmitter._original?.id) {
                    const result = await dispatch(deleteTransmitter({
                        socket,
                        transmitterId: transmitter._original.id,
                        satelliteId: transmitterOwner?.satelliteId,
                        targetKey: transmitterOwner?.targetKey,
                    })).unwrap();
                    if (Array.isArray(result)) {
                        latestTransmitters = result;
                    }
                }
            }

            // Refresh the transmitters list
            if (latestTransmitters) {
                dispatch(
                    setTargetTransmitters({
                        noradId: transmitterOwner?.satelliteId,
                        targetKey: transmitterOwner?.targetKey,
                        transmitters: latestTransmitters,
                        updatedAtMs: Date.now(),
                        lockDurationMs: 5000,
                    })
                );
                setRows(mapTransmittersToRows(latestTransmitters));
            } else {
                const updatedTransmitters = rows.filter(row => !selected.includes(row.id));
                setRows(updatedTransmitters);
            }
            setSelected([]);

            console.log('Transmitters deleted successfully');
        } catch (error) {
            console.error('Failed to delete transmitters:', error);
        }

        // Close the dialog regardless of success/failure
        setDeleteConfirmOpen(false);
    };

    const handleModalClose = () => {
        setEditModalOpen(false);
        setEditingTransmitter(null);
        setIsNewTransmitter(false);
    };

    const handleModalSaved = React.useCallback((latestTransmitters) => {
        if (!Array.isArray(latestTransmitters)) {
            return;
        }
        setRows(mapTransmittersToRows(latestTransmitters));
        setSelected([]);
    }, []);

    const columns = useMemo(() => [
        {field: "description", headerName: t('satellite_info.transmitters.columns.description'), flex: 1.2, minWidth: 150},
        {field: "type", headerName: t('satellite_info.transmitters.columns.type'), flex: 0.8, minWidth: 80},
        {field: "status", headerName: t('satellite_info.transmitters.columns.status'), flex: 0.8, minWidth: 80},
        {field: "alive", headerName: t('satellite_info.transmitters.columns.alive'), flex: 0.8, minWidth: 80},
        {
            field: "uplinkLow",
            headerName: t('satellite_info.transmitters.columns.uplink_low'),
            flex: 1,
            minWidth: 120,
            renderCell: (params) => formatFrequency(params.value)
        },
        {
            field: "uplinkHigh",
            headerName: t('satellite_info.transmitters.columns.uplink_high'),
            flex: 1,
            minWidth: 120,
            renderCell: (params) => formatFrequency(params.value)
        },
        {
            field: "uplinkDrift",
            headerName: t('satellite_info.transmitters.columns.uplink_drift'),
            flex: 1,
            minWidth: 120,
            renderCell: (params) => formatFrequency(params.value)
        },
        {
            field: "downlinkLow",
            headerName: t('satellite_info.transmitters.columns.downlink_low'),
            flex: 1,
            minWidth: 120,
            renderCell: (params) => formatFrequency(params.value)
        },
        {
            field: "downlinkHigh",
            headerName: t('satellite_info.transmitters.columns.downlink_high'),
            flex: 1,
            minWidth: 120,
            renderCell: (params) => formatFrequency(params.value)
        },
        {
            field: "downlinkDrift",
            headerName: t('satellite_info.transmitters.columns.downlink_drift'),
            flex: 1,
            minWidth: 120,
            renderCell: (params) => formatFrequency(params.value)
        },
        {field: "mode", headerName: t('satellite_info.transmitters.columns.mode'), flex: 0.7, minWidth: 82},
        {field: "uplinkMode", headerName: t('satellite_info.transmitters.columns.uplink_mode'), flex: 0.75, minWidth: 92},
        {field: "invert", headerName: t('satellite_info.transmitters.columns.invert'), flex: 0.6, minWidth: 70},
        {field: "baud", headerName: t('satellite_info.transmitters.columns.baud'), flex: 0.8, minWidth: 80},
        {
            field: "actions",
            headerName: "",
            width: 40,
            minWidth: 40,
            maxWidth: 40,
            sortable: false,
            filterable: false,
            disableColumnMenu: true,
            renderCell: (params) => (
                <IconButton
                    size="small"
                    aria-label="Edit transmitter"
                    sx={{ p: 0.25 }}
                    onClick={(event) => {
                        event.stopPropagation();
                        openTransmitterForEdit(params.row);
                    }}
                >
                    <EditIcon fontSize="small" />
                </IconButton>
            )
        },
    ], [t, openTransmitterForEdit]);

    // Keep user-resized widths stable while the dialog rerenders from live sat updates.
    const gridColumns = useMemo(() => {
        if (!inDialog) {
            return columns;
        }

        return columns.map((column) => ({
            ...column,
            width: dialogColumnWidths[column.field] ?? column.width ?? column.minWidth ?? 120,
            flex: undefined,
        }));
    }, [inDialog, columns, dialogColumnWidths]);

    const handleColumnWidthChange = useCallback((params) => {
        if (!inDialog || !params?.colDef?.field || typeof params.width !== 'number') {
            return;
        }

        const field = params.colDef.field;
        setDialogColumnWidths((current) => {
            if (current[field] === params.width) {
                return current;
            }
            return {
                ...current,
                [field]: params.width,
            };
        });
    }, [inDialog]);

    if (!satelliteData || !transmitterOwner) {
        return (
            <Box sx={{flexShrink: 0}}>
                <Typography variant="h6" component="h3" sx={{mb: 2}}>
                    {t('satellite_info.transmitters.title')}
                </Typography>
                <div style={{textAlign: 'center'}}>
                    <span>{t('satellite_info.transmitters.no_data')}</span>
                </div>
            </Box>
        );
    }

    return (
        <Box sx={{flexShrink: 0}}>
            {!inDialog && (
                <Typography variant="h6" component="h3" sx={{mb: 2}}>
                    {t('satellite_info.transmitters.title')}
                </Typography>
            )}
            {satelliteData.transmitters ? (
                <Box sx={{width: '100%'}}>
                    <DataGrid
                        rows={rows}
                        columns={gridColumns}
                        initialState={{pagination: {paginationModel}}}
                        pageSizeOptions={[5, 10]}
                        checkboxSelection={true}
                        onColumnWidthChange={handleColumnWidthChange}
                        onRowSelectionModelChange={(newSelected) => {
                            setSelected(toSelectedIds(newSelected));
                        }}
                        sx={{
                            border: 'none',
                            backgroundColor: 'background.paper',
                            color: 'text.primary',
                            height: inDialog ? '500px' : '100%',
                            minHeight: inDialog ? '500px' : 'auto',
                            [`& .${gridClasses.cell}:focus, & .${gridClasses.cell}:focus-within`]: {
                                outline: 'none',
                            },
                            [`& .${gridClasses.columnHeader}:focus, & .${gridClasses.columnHeader}:focus-within`]:
                                {
                                    outline: 'none',
                                },
                            '& .MuiDataGrid-columnHeaders': {
                                backgroundColor: 'background.elevated',
                                color: 'text.primary',
                                fontSize: '14px',
                                fontWeight: 'bold',
                                borderBottom: '1px solid',
                                borderColor: 'border.main',
                            },
                            '& .MuiDataGrid-cell': {
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                borderBottom: '1px solid',
                                borderColor: (theme) => theme.palette.border.main,
                            },
                            '& .MuiDataGrid-row': {
                                '&:nth-of-type(odd)': {
                                    backgroundColor: (theme) => theme.palette.overlay.light,
                                },
                                '&:hover': {
                                    backgroundColor: (theme) => theme.palette.overlay.medium,
                                },
                            },
                            '& .MuiDataGrid-footerContainer': {
                                backgroundColor: (theme) => theme.palette.background.default,
                                color: (theme) => theme.palette.text.primary,
                            },
                            '& .MuiDataGrid-selectedRowCount': {
                                color: (theme) => theme.palette.text.primary,
                            },
                            '& .MuiDataGrid-cellContent': {
                                color: (theme) => theme.palette.text.primary,
                            },
                        }}
                    />
                    {actionsPortalTarget
                        ? createPortal(
                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                <Button variant="contained" size="small" onClick={handleAddClick}>
                                    {t('satellite_info.transmitters.add')}
                                </Button>
                                <Button variant="contained" size="small" disabled={selected.length !== 1} onClick={handleEditClick}>
                                    {t('satellite_info.transmitters.edit')}
                                </Button>
                                <Button variant="contained" size="small" disabled={selected.length !== 1} onClick={handleDuplicateClick}>
                                    {t('satellite_info.transmitters.duplicate')}
                                </Button>
                                <Button
                                    variant="contained"
                                    size="small"
                                    color="error"
                                    disabled={selected.length < 1}
                                    onClick={handleDeleteClick}
                                >
                                    {t('satellite_info.transmitters.delete')}
                                </Button>
                            </Stack>,
                            actionsPortalTarget
                        )
                        : (
                            <Stack direction="row" spacing={2} sx={{ marginTop: 2 }}>
                                <Button variant="contained" onClick={handleAddClick}>
                                    {t('satellite_info.transmitters.add')}
                                </Button>
                                <Button variant="contained" disabled={selected.length !== 1} onClick={handleEditClick}>
                                    {t('satellite_info.transmitters.edit')}
                                </Button>
                                <Button variant="contained" disabled={selected.length !== 1} onClick={handleDuplicateClick}>
                                    {t('satellite_info.transmitters.duplicate')}
                                </Button>
                                <Button variant="contained" color="error" disabled={selected.length < 1}
                                        onClick={handleDeleteClick}>
                                    {t('satellite_info.transmitters.delete')}
                                </Button>
                            </Stack>
                        )
                    }
                    <Dialog
                        open={deleteConfirmOpen}
                        onClose={() => setDeleteConfirmOpen(false)}
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
                            {t('satellite_info.transmitters.delete_confirm_title')}
                        </DialogTitle>
                        <DialogContent sx={{ px: 3, pt: 3, pb: 3 }}>
                            <Typography variant="body1" sx={{ mt: 2, mb: 2, color: 'text.primary' }}>
                                {t('satellite_info.transmitters.delete_confirm_message')}
                            </Typography>
                            <Typography variant="body2" sx={{ mb: 2, fontWeight: 600, color: 'text.secondary' }}>
                                {selected.length === 1 ? 'Transmitter to be deleted:' : `${selected.length} Transmitters to be deleted:`}
                            </Typography>
                            <Box sx={{
                                maxHeight: 300,
                                overflowY: 'auto',
                                bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
                                borderRadius: 1,
                                border: (theme) => `1px solid ${theme.palette.divider}`,
                            }}>
                                {selected.map((id, index) => {
                                    const transmitter = rows.find(row => row.id === id);
                                    if (!transmitter) return null;
                                    return (
                                        <Box
                                            key={id}
                                            sx={{
                                                p: 2,
                                                borderBottom: index < selected.length - 1 ? (theme) => `1px solid ${theme.palette.divider}` : 'none',
                                            }}
                                        >
                                            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: 'text.primary' }}>
                                                {transmitter.description !== '-' ? transmitter.description : 'Unnamed Transmitter'}
                                            </Typography>
                                            <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 1, columnGap: 2 }}>
                                                {transmitter.type !== '-' && (
                                                    <>
                                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                                            Type:
                                                        </Typography>
                                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                                            {transmitter.type}
                                                        </Typography>
                                                    </>
                                                )}

                                                {transmitter.mode !== '-' && (
                                                    <>
                                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                                            Mode:
                                                        </Typography>
                                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                                            {transmitter.mode}
                                                        </Typography>
                                                    </>
                                                )}

                                                {transmitter.downlinkLow !== '-' && (
                                                    <>
                                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                                            Downlink:
                                                        </Typography>
                                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                                            {transmitter.downlinkLow === transmitter.downlinkHigh || transmitter.downlinkHigh === '-'
                                                                ? formatFrequency(transmitter.downlinkLow)
                                                                : `${formatFrequency(transmitter.downlinkLow)} - ${formatFrequency(transmitter.downlinkHigh)}`
                                                            }
                                                        </Typography>
                                                    </>
                                                )}

                                                {transmitter.uplinkLow !== '-' && (
                                                    <>
                                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                                            Uplink:
                                                        </Typography>
                                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                                            {transmitter.uplinkLow === transmitter.uplinkHigh || transmitter.uplinkHigh === '-'
                                                                ? formatFrequency(transmitter.uplinkLow)
                                                                : `${formatFrequency(transmitter.uplinkLow)} - ${formatFrequency(transmitter.uplinkHigh)}`
                                                            }
                                                        </Typography>
                                                    </>
                                                )}

                                                {transmitter.status !== '-' && (
                                                    <>
                                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                                            Status:
                                                        </Typography>
                                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                                            {transmitter.status}
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
                                onClick={() => setDeleteConfirmOpen(false)}
                                variant="outlined"
                                color="inherit"
                                sx={{
                                    minWidth: 100,
                                    textTransform: 'none',
                                    fontWeight: 500,
                                }}
                            >
                                {t('satellite_info.transmitters.cancel')}
                            </Button>
                            <Button
                                variant="contained"
                                color="error"
                                onClick={handleDeleteConfirm}
                                sx={{
                                    minWidth: 100,
                                    textTransform: 'none',
                                    fontWeight: 600,
                                }}
                            >
                                {t('satellite_info.transmitters.delete')}
                            </Button>
                        </DialogActions>
                    </Dialog>
                </Box>
            ) : (
                <div style={{textAlign: 'center'}}>
                    <span>{t('satellite_info.transmitters.no_data')}</span>
                </div>
            )}

            {/* Edit/Add Transmitter Modal */}
            <TransmitterModal
                open={editModalOpen}
                onClose={handleModalClose}
                onSavedTransmitters={handleModalSaved}
                transmitter={editingTransmitter}
                satelliteId={transmitterOwner?.satelliteId}
                targetKey={transmitterOwner?.targetKey}
                isNew={isNewTransmitter}
            />
        </Box>
    );
};

export default TransmittersTable;
