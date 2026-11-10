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



import {useSocket} from "../common/socket.jsx";
import {Fragment, useCallback, useEffect, useMemo, useRef, useState} from "react";
import * as React from "react";
import { toast } from '../../utils/toast-with-timestamp.jsx';
import {Box, Button, Switch, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, IconButton, TextField} from "@mui/material";
import {DataGrid} from "@mui/x-data-grid";
import Autocomplete from "@mui/material/Autocomplete";
import CircularProgress from "@mui/material/CircularProgress";
import CloseIcon from '@mui/icons-material/Close';
import {toRowSelectionModel, toSelectedIds} from '../../utils/datagrid-selection.js';
import {useDispatch} from 'react-redux';
import {useTranslation} from 'react-i18next';
import {AddOrEditSatelliteGroup, fetchSatelliteGroups} from './groups-slice.jsx';


export function AutocompleteAsync({setSelectedSatelliteCallback}) {
    const {socket} = useSocket();
    const {t} = useTranslation('satellites');
    const [open, setOpen] = React.useState(false);
    const [options, setOptions] = React.useState([]);
    const [loading, setLoading] = React.useState(false);
    const searchTimer = useRef(null);
    const requestNumber = useRef(0);

    useEffect(() => () => clearTimeout(searchTimer.current), []);

    const search = (keyword) => {
        const currentRequest = ++requestNumber.current;
        setLoading(true);
        socket.emit("api.call", {
            cmd: "get-satellite-search",
            data: keyword,
        }, response => {
            // Ignore replies for an older input value.
            if (currentRequest !== requestNumber.current) return;
            if (response.success) {
                setOptions(response.data);
            } else {
                console.error(response.error);
                toast.error(`${t('groups.search_error')}: ${response.error}`, {autoClose: 5000});
                setOptions([]);
            }
            setLoading(false);
        });
    };

    const handleOpen = () => {
        setOpen(true);
    };

    const handleClose = () => {
        setOpen(false);
        requestNumber.current += 1;
        setOptions([]);
        setLoading(false);
    };

    const handleInputChange = (event, newInputValue) => {
        clearTimeout(searchTimer.current);
        if (newInputValue.length <= 2) {
            requestNumber.current += 1;
            setOptions([]);
            setLoading(false);
            return;
        }
        searchTimer.current = setTimeout(() => search(newInputValue), 250);
    };

    const handleOptionSelect = (event, newValue) => {
        if (newValue !== null) {
            setSelectedSatelliteCallback(newValue);
        }
    };

    return (
        <Autocomplete
            sx={{ minWidth: 200 }}
            open={open}
            fullWidth={true}
            onOpen={handleOpen}
            onClose={handleClose}
            onInputChange={handleInputChange}
            onChange={handleOptionSelect}
            isOptionEqualToValue={(option, value) => option.name === value.name}
            getOptionLabel={(option) => {
                return `${option['norad_id']} - ${option['name']}`;
            }}
            options={options}
            loading={loading}
            renderInput={(params) => (
                <TextField
                    fullWidth={true}
                    {...params}
                    label={t('groups.add_satellites')}
                    slotProps={{
                        input: {
                            ...params.InputProps,
                            endAdornment: (
                                <Fragment>
                                    {loading ? <CircularProgress color="inherit" size={20} /> : null}
                                    {params.InputProps.endAdornment}
                                </Fragment>
                            ),
                        },
                    }}
                />
            )}
        />
    );
}

export function AddEditDialog({formDialogOpen, handleRowsCallback, handleDialogOpenCallback, satGroup}) {
    const { socket } = useSocket();
    const dispatch = useDispatch();
    const {t} = useTranslation('satellites');
    const defaultFormValues = {
        id: '',
        name: '',
        satellite_ids: [],
        show_on_earth_view: true,
    };
    const [formDialogValues, setFormDialogValues] = useState(defaultFormValues);
    const [selectionModel, setSelectionModel] = useState([]);
    const rowSelectionModel = useMemo(() => toRowSelectionModel(selectionModel), [selectionModel]);
    const paginationModel = {page: 0, pageSize: 10};
    const [satellites, setSatellites] = useState([]);
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const originalSatelliteIds = Array.isArray(satGroup?.satellite_ids) ? satGroup.satellite_ids : [];
    const sameSatelliteIds = (first, second) => (
        first.length === second.length
        && new Set(first.map(String)).size === new Set(second.map(String)).size
        && first.every(id => second.map(String).includes(String(id)))
    );
    const hasFormChanges = formDialogValues.id
        ? formDialogValues.name.trim() !== (satGroup?.name || '').trim()
            || !sameSatelliteIds(selectionModel, originalSatelliteIds)
            || formDialogValues.show_on_earth_view !== (satGroup?.show_on_earth_view ?? true)
        : formDialogValues.name.trim().length > 0;
    const canSubmit = formDialogValues.name.trim().length > 0 && hasFormChanges;

    const handleDialogClose = () => {
        handleDialogOpenCallback(false);
    };

    useEffect(() => {
        if (!formDialogOpen) {
            setSatellites([]);
            setLoading(false);
            return undefined;
        }

        const group = satGroup?.id ? satGroup : null;
        const satelliteIds = Array.isArray(group?.satellite_ids) ? group.satellite_ids : [];
        let cancelled = false;

        setFormDialogValues(group ? {
            id: group.id,
            name: group.name || '',
            satellite_ids: satelliteIds,
            show_on_earth_view: group.show_on_earth_view ?? true,
        } : defaultFormValues);
        setSelectionModel([...satelliteIds]);
        setSatellites([]);
        setSubmitting(false);

        if (!group || satelliteIds.length === 0) {
            setLoading(false);
            return () => { cancelled = true; };
        }

        setLoading(true);
        socket.emit("api.call", {
            cmd: "get-satellites",
            data: satelliteIds,
        }, response => {
            if (cancelled) return;
            if (response.success) {
                setSatellites(response.data);
            } else {
                console.error(response.error);
            }
            setLoading(false);
        });

        return () => { cancelled = true; };
    }, [formDialogOpen, satGroup, socket]);

    const handleFormSubmit = (event) => {
        event.preventDefault();

        const newRow = {
            ...(formDialogValues.id ? {id: formDialogValues.id} : {}),
            name: formDialogValues.name.trim(),
            satellite_ids: [...new Set(selectionModel)],
            show_on_earth_view: formDialogValues.show_on_earth_view,
        };
        setSubmitting(true);
        dispatch(AddOrEditSatelliteGroup({socket, groupData: newRow}))
            .unwrap()
            .then(() => dispatch(fetchSatelliteGroups({socket})).unwrap())
            .then((groups) => {
                handleRowsCallback(groups);
                handleDialogOpenCallback(false);
                toast.success(t(formDialogValues.id ? 'groups.edited_success' : 'groups.added_success'), {autoClose: 5000});
            })
            .catch((error) => {
                toast.error(`${t(formDialogValues.id ? 'groups.failed_edit' : 'groups.failed_add')}: ${error.message || error}`, {autoClose: 5000});
            })
            .finally(() => setSubmitting(false));
    };

    const setSelectedSatelliteCallback = useCallback((satellite) => {
        const satelliteId = satellite.norad_id;
        setSatellites(prevSatellites => prevSatellites.some(item => item.norad_id === satelliteId)
            ? prevSatellites
            : [...prevSatellites, {...satellite, id: satelliteId}]);
        setSelectionModel(prevSelectionModel => prevSelectionModel.includes(satelliteId)
            ? prevSelectionModel
            : [...prevSelectionModel, satelliteId]);

    }, []);

    return (
        <Dialog
            open={formDialogOpen}
            onClose={handleDialogClose}
            maxWidth="md"
            fullWidth
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
                    display: 'flex',
                    alignItems: 'center',
                }}
            >
                <Box component="span" sx={{flexGrow: 1}}>
                    {t(formDialogValues.id ? 'groups.dialog_title_edit' : 'groups.dialog_title_add')}
                </Box>
                <IconButton
                    aria-label={t('groups.close')}
                    onClick={handleDialogClose}
                    size="small"
                    sx={{color: 'inherit'}}
                >
                    <CloseIcon fontSize="small" />
                </IconButton>
            </DialogTitle>
            <form onSubmit={handleFormSubmit}>
                <DialogContent sx={{ px: 3, pt: 3, pb: 0 }}>
                    <Box sx={{ mt: 0 }}>
                        <FormControlLabel
                            sx={{ mb: 2 }}
                            control={
                                <Switch
                                    name="show_on_earth_view"
                                    checked={formDialogValues.show_on_earth_view}
                                    onChange={(event) => setFormDialogValues(previous => ({
                                        ...previous,
                                        show_on_earth_view: event.target.checked,
                                    }))}
                                />
                            }
                            label={t('groups.show_on_earth_view')}
                        />
                        <TextField
                            autoComplete="new-password"
                            autoFocus
                            id="name"
                            name="name"
                            label={t('groups.name')}
                            fullWidth
                            value={formDialogValues.name || ''}
                            onChange={(e) => setFormDialogValues(prevValues => ({...prevValues, name: e.target.value}))}
                            required
                        />
                        <Box sx={{marginTop: 2}}>
                            <AutocompleteAsync setSelectedSatelliteCallback={setSelectedSatelliteCallback}/>
                            <DataGrid
                                loading={loading}
                                getRowId={(row) => row['norad_id']}
                                rows={satellites}
                                columns={[
                                    {field: 'norad_id', headerName: t('groups.norad_id'), width: 150},
                                    {field: 'name', headerName: t('groups.name'), width: 300},
                                ]}
                                initialState={{pagination: {paginationModel}}}
                                pageSizeOptions={[5, 10]}
                                localeText={{noRowsLabel: t('groups.no_selected_satellites')}}
                                sx={{
                                    height: {xs: 240, sm: 320, md: 400},
                                    marginTop: 2,
                                    marginBottom: 0,
                                    border: '1px solid rgba(0, 0, 0, 0.12)',
                                }}
                                checkboxSelection
                                // Keep the controlled selection state as explicit IDs.
                                disableRowSelectionExcludeModel
                                rowSelectionModel={rowSelectionModel}
                                onRowSelectionModelChange={(newModel) => setSelectionModel(toSelectedIds(newModel))}
                            />
                        </Box>
                    </Box>
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
                        onClick={handleDialogClose}
                        variant="outlined"
                        sx={{
                            borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.700' : 'grey.400',
                            '&:hover': {
                                borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.600' : 'grey.500',
                                bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.200',
                            },
                        }}
                    >
                        {t('groups.cancel')}
                    </Button>
                    <Button type="submit" variant="contained" disabled={submitting || !canSubmit}>
                        {t(submitting
                            ? (formDialogValues.id ? 'groups.saving' : 'groups.adding')
                            : (formDialogValues.id ? 'groups.save' : 'groups.submit'))}
                    </Button>
                </DialogActions>
            </form>
        </Dialog>
    );
}
