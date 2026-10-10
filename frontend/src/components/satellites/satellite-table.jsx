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
    Checkbox,
    Chip,
    Collapse,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    FormControl,
    FormControlLabel,
    OutlinedInput,
    InputAdornment,
    IconButton,
    InputLabel,
    ListSubheader,
    MenuItem,
    Paper,
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
    useGridApiContext,
    useGridSelector,
    gridClasses
} from '@mui/x-data-grid';
import MuiPagination from '@mui/material/Pagination';
import {
    betterDateTimes,
    betterStatusValue,
    renderCountryFlagsCSV,
    getFrequencyBand
} from '../common/common.jsx';
import PassTransmitterLinksCell from '../common/pass-transmitter-links-cell.jsx';
import {formatAlternativeSatelliteNames} from '../common/satellite-names.js';
import {
    fetchSatellite,
    fetchSatelliteCatalogStats,
    fetchSatelliteGroups,
    DEFAULT_CATALOG_SORT_MODEL,
    searchSatellites,
    deleteSatellite,
    setSatGroupId,
    setSearchKeyword,
    setCatalogSortModel,
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
import SettingsInputAntennaIcon from '@mui/icons-material/SettingsInputAntenna';
import VisibilityIcon from '@mui/icons-material/Visibility';
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined';
import FolderSharedOutlinedIcon from '@mui/icons-material/FolderSharedOutlined';
import TuneRoundedIcon from '@mui/icons-material/TuneRounded';
import ExpandLessRoundedIcon from '@mui/icons-material/ExpandLessRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import SatelliteEditDialog from "./satellite-edit-dialog.jsx";

const FREQUENCY_BANDS = [
    'ELF', 'SLF', 'ULF', 'VLF', 'LF', 'MF', 'HF', 'VHF', 'UHF', 'L-band', 'S-band', 'C-band',
    'X-band', 'Ku-band', 'K-band', 'Ka-band', 'V-band', 'W-band', 'mm-band',
];

const FREQUENCY_UNITS = {
    kHz: 1_000,
    MHz: 1_000_000,
    GHz: 1_000_000_000,
};

const MODE_OPTIONS = [
    'FM', 'FMN', 'FSK', 'AFSK', 'GFSK', 'GMSK', 'BPSK', 'QPSK', 'PSK', 'CW', 'USB', 'SSTV',
    'LoRa', 'LRPT', 'HRPT', 'AHRPT', 'DVB-S2',
];

const TRANSMITTER_TYPE_OPTIONS = ['Transmitter', 'Transceiver', 'Transponder'];
export const DEFAULT_CATALOG_COLUMN_VISIBILITY = {
    alternative_names: false,
    deployed: false,
    orbit_first_seen_at: false,
    orbit_changed_at: false,
};
const TRANSMITTER_DEPENDENT_FILTERS = new Set([
    'bands', 'frequencyMin', 'frequencyMax', 'modes', 'transmitterTypes', 'services',
    'baudMin', 'baudMax', 'unconfirmed',
]);
// Built per render: the labels follow the active language, so this cannot live
// at module scope (no i18n `t` there).
const getServiceOptions = (t) => [
    'Amateur', 'Meteorological', t('satellite_table.space_research', { defaultValue: 'Space Research' }), t('satellite_table.space_operation', { defaultValue: 'Space Operation' }), 'Inter-satellite',
    'Radionavigational', 'Radiolocation', 'Mobile', 'Maritime', 'Aeronautical',
    t('satellite_table.earth_exploration', { defaultValue: 'Earth Exploration' }), 'Broadcasting', 'Unknown',
];

const EMPTY_CATALOG_FILTERS = {
    bands: [],
    direction: 'downlink',
    frequencyMin: '',
    frequencyMax: '',
    frequencyUnit: 'MHz',
    status: '',
    country: '',
    source: '',
    launchedFrom: '',
    launchedTo: '',
    transmitterState: '',
    modes: [],
    transmitterTypes: [],
    services: [],
    baudMin: '',
    baudMax: '',
    frequencyViolation: false,
    unconfirmed: false,
};

const mergeCatalogOptions = (defaults, catalogValues, selectedValues = []) => {
    const selected = Array.isArray(selectedValues) ? selectedValues : [selectedValues];
    return [...new Set([...defaults, ...(catalogValues || []), ...selected].filter(Boolean))]
        .sort((left, right) => left.localeCompare(right));
};

const frequencyBounds = (filters) => {
    const multiplier = FREQUENCY_UNITS[filters.frequencyUnit] || FREQUENCY_UNITS.MHz;
    const enteredMinimum = filters.frequencyMin === '' ? null : Number(filters.frequencyMin) * multiplier;
    const enteredMaximum = filters.frequencyMax === '' ? null : Number(filters.frequencyMax) * multiplier;
    if (enteredMinimum != null && enteredMaximum != null) {
        return {
            minimum: Math.min(enteredMinimum, enteredMaximum),
            maximum: Math.max(enteredMinimum, enteredMaximum),
        };
    }
    return {minimum: enteredMinimum, maximum: enteredMaximum};
};

const frequencyRangeMatches = (low, high, minimum, maximum) => (
    low <= (maximum ?? Number.POSITIVE_INFINITY)
    && high >= (minimum ?? Number.NEGATIVE_INFINITY)
);

const frequencyForDirection = (transmitter, direction) => {
    if (direction === 'uplink') return transmitter.uplink_low;
    if (direction === 'either') return transmitter.downlink_low ?? transmitter.uplink_low;
    return transmitter.downlink_low;
};

const frequencyRangesForDirection = (transmitter, direction) => {
    const ranges = [];
    if (direction !== 'uplink' && transmitter.downlink_low != null) {
        ranges.push([transmitter.downlink_low, transmitter.downlink_high ?? transmitter.downlink_low]);
    }
    if (direction !== 'downlink' && transmitter.uplink_low != null) {
        ranges.push([transmitter.uplink_low, transmitter.uplink_high ?? transmitter.uplink_low]);
    }
    return ranges;
};

const transmitterMatchesUiFilters = (transmitter, filters, keyword = '') => {
    if (!transmitter) return false;
    const directionRanges = frequencyRangesForDirection(transmitter, filters.direction);
    if (filters.bands.length && !directionRanges.some(([low, high]) => (
        filters.bands.includes(getFrequencyBand(low)) || filters.bands.includes(getFrequencyBand(high))
    ))) {
        return false;
    }

    const {minimum, maximum} = frequencyBounds(filters);
    if ((minimum != null || maximum != null) && !directionRanges.some(([low, high]) => (
        frequencyRangeMatches(low, high, minimum, maximum)
    ))) {
        return false;
    }
    if (filters.modes.length && !filters.modes.some(mode => mode.toLowerCase() === String(transmitter.mode || '').toLowerCase())) return false;
    if (filters.transmitterTypes.length && !filters.transmitterTypes.some(type => type.toLowerCase() === String(transmitter.type || '').toLowerCase())) return false;
    if (filters.services.length && !filters.services.some(service => service.toLowerCase() === String(transmitter.service || '').toLowerCase())) return false;
    if (filters.transmitterState === 'active' && transmitter.alive !== true) return false;
    if (filters.transmitterState === 'inactive' && transmitter.alive !== false) return false;
    if (filters.unconfirmed && transmitter.unconfirmed !== true) return false;

    const normalizedKeyword = keyword.trim().toLowerCase();
    if (normalizedKeyword) {
        const searchable = [
            transmitter.id,
            transmitter.source_transmitter_id,
            transmitter.description,
            transmitter.mode,
            transmitter.type,
            transmitter.service,
        ].filter(Boolean).join(' ').toLowerCase();
        const keywordTokens = normalizedKeyword.match(/[a-z0-9]+/g) || [];
        if (!searchable.includes(normalizedKeyword) && !keywordTokens.every(token => searchable.includes(token))) {
            return false;
        }
    }
    return true;
};

const matchingFrequencyForFilters = (transmitter, filters) => {
    const ranges = frequencyRangesForDirection(transmitter, filters.direction);
    const {minimum, maximum} = frequencyBounds(filters);
    const matchingRange = ranges.find(([low, high]) => {
        const matchesBand = !filters.bands.length
            || filters.bands.includes(getFrequencyBand(low))
            || filters.bands.includes(getFrequencyBand(high));
        const matchesRange = minimum == null && maximum == null
            ? true
            : frequencyRangeMatches(low, high, minimum, maximum);
        return matchesBand && matchesRange;
    });
    return matchingRange?.[0] ?? frequencyForDirection(transmitter, filters.direction);
};

const formatFrequency = (frequency) => {
    if (frequency == null) return '';
    if (frequency >= 1_000_000_000) return `${(frequency / 1_000_000_000).toFixed(3)} GHz`;
    if (frequency >= 1_000_000) return `${(frequency / 1_000_000).toFixed(3)} MHz`;
    return `${(frequency / 1_000).toFixed(3)} kHz`;
};

function Pagination({page, onPageChange, className}) {
    const apiRef = useGridApiContext();
    const pageCount = useGridSelector(apiRef, gridPageCountSelector);
    const [gridWidth, setGridWidth] = useState(0);

    useEffect(() => {
        const gridElement = apiRef.current.rootElementRef?.current;
        if (!gridElement) return undefined;

        const updateWidth = () => setGridWidth(gridElement.clientWidth);
        updateWidth();

        if (typeof ResizeObserver === 'undefined') return undefined;
        const observer = new ResizeObserver(updateWidth);
        observer.observe(gridElement);
        return () => observer.disconnect();
    }, [apiRef]);

    // Keep the page controls inside the footer while showing more nearby
    // destinations whenever the table has room for them.
    const boundaryCount = gridWidth > 0 && gridWidth < 650 ? 0 : 1;
    const siblingCount = gridWidth >= 1200 ? 2 : gridWidth >= 900 ? 1 : 0;

    return (
        <MuiPagination
            color="primary"
            className={className}
            count={pageCount}
            page={page + 1}
            boundaryCount={boundaryCount}
            siblingCount={siblingCount}
            size={gridWidth > 0 && gridWidth < 850 ? 'small' : 'medium'}
            onChange={(event, newPage) => {
                onPageChange(event, newPage - 1);
            }}
        />
    );
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
        selected,
        loading,
        openDeleteConfirm,
        openAddDialog,
        clickedSatellite,
        catalogStats,
        catalogTotal,
        catalogSortModel,
    } = useSelector((state) => state.satellites);

    const [localSearchValue, setLocalSearchValue] = useState('');
    const [transmittersDialogOpen, setTransmittersDialogOpen] = useState(false);
    const [editingSatellite, setEditingSatellite] = useState(null);
    const [catalogFilters, setCatalogFilters] = useState(EMPTY_CATALOG_FILTERS);
    const [filtersExpanded, setFiltersExpanded] = useState(false);
    const [paginationModel, setPaginationModel] = useState({page: 0, pageSize: 10});
    const immediateSearchRef = React.useRef(false);
    const sortModel = Array.isArray(catalogSortModel)
        ? catalogSortModel
        : DEFAULT_CATALOG_SORT_MODEL;

    const updateCatalogFilter = useCallback((name, value) => {
        setCatalogFilters(current => {
            if (name === 'transmitterState' && value === 'none') {
                return {
                    ...current,
                    bands: [],
                    frequencyMin: '',
                    frequencyMax: '',
                    modes: [],
                    transmitterTypes: [],
                    services: [],
                    baudMin: '',
                    baudMax: '',
                    unconfirmed: false,
                    transmitterState: 'none',
                };
            }
            const transmitterState = TRANSMITTER_DEPENDENT_FILTERS.has(name)
                && current.transmitterState === 'none'
                ? ''
                : current.transmitterState;
            return {...current, transmitterState, [name]: value};
        });
    }, []);

    const searchPayload = React.useMemo(() => {
        const multiplier = FREQUENCY_UNITS[catalogFilters.frequencyUnit] || FREQUENCY_UNITS.MHz;
        const rawMinimum = catalogFilters.frequencyMin === ''
            ? null
            : Math.round(Number(catalogFilters.frequencyMin) * multiplier);
        const rawMaximum = catalogFilters.frequencyMax === ''
            ? null
            : Math.round(Number(catalogFilters.frequencyMax) * multiplier);
        const hasBothFrequencies = rawMinimum != null && rawMaximum != null;
        return {
            keyword: localSearchValue.trim(),
            group_id: satGroupId,
            bands: catalogFilters.bands,
            direction: catalogFilters.direction,
            frequency_min_hz: hasBothFrequencies ? Math.min(rawMinimum, rawMaximum) : rawMinimum,
            frequency_max_hz: hasBothFrequencies ? Math.max(rawMinimum, rawMaximum) : rawMaximum,
            status: catalogFilters.status,
            country: catalogFilters.country,
            source: catalogFilters.source,
            launched_from: catalogFilters.launchedFrom,
            launched_to: catalogFilters.launchedTo,
            transmitter_state: catalogFilters.transmitterState,
            modes: catalogFilters.modes,
            transmitter_types: catalogFilters.transmitterTypes,
            services: catalogFilters.services,
            baud_min: catalogFilters.baudMin,
            baud_max: catalogFilters.baudMax,
            frequency_violation: catalogFilters.frequencyViolation,
            unconfirmed: catalogFilters.unconfirmed,
            page: paginationModel.page,
            page_size: paginationModel.pageSize,
            sort_field: sortModel[0]?.field || 'name',
            sort_direction: sortModel[0]?.sort || 'asc',
        };
    }, [catalogFilters, localSearchValue, paginationModel, satGroupId, sortModel]);

    const activeFilterCount = React.useMemo(() => {
        let count = satGroupId ? 1 : 0;
        if (catalogFilters.bands.length) count += 1;
        if (catalogFilters.frequencyMin !== '' || catalogFilters.frequencyMax !== '') count += 1;
        if (catalogFilters.status) count += 1;
        if (catalogFilters.country) count += 1;
        if (catalogFilters.source) count += 1;
        if (catalogFilters.launchedFrom || catalogFilters.launchedTo) count += 1;
        if (catalogFilters.transmitterState) count += 1;
        if (catalogFilters.modes.length) count += 1;
        if (catalogFilters.transmitterTypes.length) count += 1;
        if (catalogFilters.services.length) count += 1;
        if (catalogFilters.baudMin !== '' || catalogFilters.baudMax !== '') count += 1;
        if (catalogFilters.frequencyViolation) count += 1;
        if (catalogFilters.unconfirmed) count += 1;
        return count;
    }, [catalogFilters, satGroupId]);

    const countryOptions = React.useMemo(
        () => mergeCatalogOptions([], catalogStats?.countries, catalogFilters.country),
        [catalogFilters.country, catalogStats?.countries],
    );
    const sourceOptions = React.useMemo(
        () => mergeCatalogOptions([], catalogStats?.sources, catalogFilters.source),
        [catalogFilters.source, catalogStats?.sources],
    );
    const statusOptions = React.useMemo(
        () => mergeCatalogOptions(['in orbit', 're-entered'], catalogStats?.statuses, catalogFilters.status),
        [catalogFilters.status, catalogStats?.statuses],
    );
    const modeOptions = React.useMemo(
        () => mergeCatalogOptions(MODE_OPTIONS, catalogStats?.modes, catalogFilters.modes),
        [catalogFilters.modes, catalogStats?.modes],
    );
    const transmitterTypeOptions = React.useMemo(
        () => mergeCatalogOptions(
            TRANSMITTER_TYPE_OPTIONS,
            catalogStats?.transmitter_types,
            catalogFilters.transmitterTypes,
        ),
        [catalogFilters.transmitterTypes, catalogStats?.transmitter_types],
    );
    const serviceOptions = React.useMemo(
        () => mergeCatalogOptions(getServiceOptions(t), catalogStats?.services, catalogFilters.services),
        [t, catalogFilters.services, catalogStats?.services],
    );

    const clearAllFilters = useCallback(() => {
        setLocalSearchValue('');
        dispatch(setSearchKeyword(''));
        dispatch(setSatGroupId(''));
        setCatalogFilters(EMPTY_CATALOG_FILTERS);
    }, [dispatch]);

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
            width: 200,
            minWidth: 160,
            renderCell: (params) => {
                const hasExplicitTransmitterCriteria = Boolean(
                    catalogFilters.bands.length
                    || catalogFilters.frequencyMin !== ''
                    || catalogFilters.frequencyMax !== ''
                    || catalogFilters.modes.length
                    || catalogFilters.transmitterTypes.length
                    || catalogFilters.services.length
                    || catalogFilters.transmitterState
                    || catalogFilters.unconfirmed
                );
                const hasTransmitterCriteria = Boolean(
                    localSearchValue.trim() || hasExplicitTransmitterCriteria
                );
                const matchingTransmitter = hasTransmitterCriteria
                    ? (params.row.transmitters || []).find(transmitter => (
                        transmitterMatchesUiFilters(
                            transmitter,
                            catalogFilters,
                            hasExplicitTransmitterCriteria ? '' : localSearchValue,
                        )
                    ))
                    : null;
                const matchingFrequency = matchingTransmitter
                    ? matchingFrequencyForFilters(matchingTransmitter, catalogFilters)
                    : null;
                return (
                    <Box sx={{py: 0.75, minWidth: 0}}>
                        <Typography variant="body2" fontWeight={600} noWrap>{params.value}</Typography>
                        {matchingTransmitter && (
                            <Typography variant="caption" color="text.secondary" noWrap sx={{display: 'block'}}>
                                {[matchingTransmitter.description, matchingTransmitter.mode, formatFrequency(matchingFrequency)]
                                    .filter(Boolean)
                                    .join(' · ')}
                            </Typography>
                        )}
                    </Box>
                );
            },
        },
        {
            field: 'alternative_names',
            headerName: t('satellite_database.alternative_names'),
            width: 170,
            minWidth: 140,
            valueGetter: (_value, row) => (
                formatAlternativeSatelliteNames(row.alternative_name, row.name_other) || '-'
            ),
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
            width: 80,
            headerAlign: 'center',
            align: 'center',
            renderCell: (params) => {
                return renderCountryFlagsCSV(params.value);
            },
        },
        {
            field: 'operator',
            headerName: t('satellite_database.operator'),
            width: 90,
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
            minWidth: 280,
            flex: 1,
            align: 'center',
            headerAlign: 'center',
            headerName: t('satellite_database.bands'),
            sortComparator: (v1, v2) => {
                // Get total transmitter count for comparison
                const count1 = v1 ? v1.length : 0;
                const count2 = v2 ? v2.length : 0;
                return count1 - count2;
            },
            renderCell: (params) => <PassTransmitterLinksCell
                transmitters={params.value}
                noDataText={t('satellite_database.no_data')}
                t={t}
                translationPrefix="satellite_database"
            />,
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
            width: 130,
            renderCell: (params) => {
                return betterDateTimes(params.value, timezone);
            },
        },
        {
            field: 'deployed',
            headerName: t('satellite_database.deployed'),
            width: 125,
            renderCell: (params) => {
                return betterDateTimes(params.value, timezone);
            },
        },
        {
            field: 'orbit_epoch',
            headerName: t('satellite_database.orbit_epoch_short'),
            width: 120,
            renderCell: (params) => betterDateTimes(params.value, timezone),
        },
        {
            field: 'orbit_fetched_at',
            headerName: t('satellite_database.orbit_fetched'),
            width: 120,
            renderCell: (params) => betterDateTimes(params.value, timezone),
        },
        {
            field: 'orbit_first_seen_at',
            headerName: t('satellite_database.orbit_first_seen'),
            width: 120,
            renderCell: (params) => betterDateTimes(params.value, timezone),
        },
        {
            field: 'orbit_changed_at',
            headerName: t('satellite_database.orbit_changed'),
            width: 135,
            renderCell: (params) => betterDateTimes(params.value, timezone),
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
                        <Tooltip title={t('satellite_database.edit_transmitters')}>
                            <IconButton
                                size="small"
                                onClick={(event) => {
                                    event.stopPropagation();
                                    handleOpenTransmitters(satellite);
                                }}
                            >
                                <SettingsInputAntennaIcon fontSize="small" />
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

    useEffect(() => {
        setPaginationModel(current => (
            current.page === 0 ? current : {...current, page: 0}
        ));
    }, [catalogFilters, localSearchValue, satGroupId]);

    // All controls feed one server-side query. This keeps group selection,
    // text search, and transmitter constraints composable.
    useEffect(() => {
        const normalizedKeyword = localSearchValue.trim();
        // A one-character keyword is intentionally ignored, while the rest of
        // the active filters continue to update the table.
        const effectivePayload = normalizedKeyword.length === 1
            ? {...searchPayload, keyword: ''}
            : searchPayload;
        // Paging and sorting are discrete actions, so start their request at
        // once. Text and filter input retain the debounce that combines edits.
        const delay = immediateSearchRef.current ? 0 : 350;
        immediateSearchRef.current = false;
        const timeoutId = setTimeout(() => {
            dispatch(setSearchKeyword(effectivePayload.keyword));
            dispatch(searchSatellites({socket, filters: effectivePayload}));
        }, delay);
        return () => clearTimeout(timeoutId);
    }, [dispatch, localSearchValue, searchPayload, socket]);

    const handlePaginationModelChange = useCallback((model) => {
        immediateSearchRef.current = true;
        setPaginationModel(model);
    }, []);

    const handleOnGroupChange = (event) => {
        dispatch(setSatGroupId(event.target.value));
    };

    const handleSearchChange = (event) => {
        setLocalSearchValue(event.target.value);
    };

    const handleClearSearch = () => {
        setLocalSearchValue('');
        dispatch(setSearchKeyword(''));
    };

    const refreshSatellites = useCallback(() => {
        dispatch(searchSatellites({socket, filters: searchPayload}));
    }, [dispatch, searchPayload, socket]);

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

    const frequencyFilterValue = catalogFilters.frequencyMin !== '' && catalogFilters.frequencyMax !== ''
        ? `${catalogFilters.frequencyMin}–${catalogFilters.frequencyMax}`
        : catalogFilters.frequencyMin !== ''
            ? `≥ ${catalogFilters.frequencyMin}`
            : `≤ ${catalogFilters.frequencyMax}`;
    const transmitterStateTranslationKey = {
        any: 'has_transmitters',
        active: 'active_transmitters',
        inactive: 'inactive_transmitters',
        none: 'no_transmitters',
    }[catalogFilters.transmitterState];

    const activeFilterChips = [
        satGroupId && {
            key: 'group',
            label: `${t('satellite_database.filter_group', {defaultValue: 'Group'})}: ${satellitesGroups.find(group => group.id === satGroupId)?.name || satGroupId}`,
            onDelete: () => dispatch(setSatGroupId('')),
        },
        catalogFilters.bands.length > 0 && {
            key: 'bands',
            label: `${catalogFilters.direction === 'uplink' ? '↑' : catalogFilters.direction === 'either' ? '↕' : '↓'} ${catalogFilters.bands.join(', ')}`,
            onDelete: () => updateCatalogFilter('bands', []),
        },
        (catalogFilters.frequencyMin !== '' || catalogFilters.frequencyMax !== '') && {
            key: 'frequency',
            label: `${catalogFilters.direction === 'uplink' ? '↑' : catalogFilters.direction === 'either' ? '↕' : '↓'} ${frequencyFilterValue} ${catalogFilters.frequencyUnit}`,
            onDelete: () => setCatalogFilters(current => ({...current, frequencyMin: '', frequencyMax: ''})),
        },
        catalogFilters.status && {key: 'status', label: catalogFilters.status, onDelete: () => updateCatalogFilter('status', '')},
        catalogFilters.transmitterState && {key: 'transmitter-state', label: t(`satellite_database.${transmitterStateTranslationKey}`), onDelete: () => updateCatalogFilter('transmitterState', '')},
        catalogFilters.modes.length > 0 && {key: 'modes', label: t('satellite_database.filter_mode', {value: catalogFilters.modes.join(', ')}), onDelete: () => updateCatalogFilter('modes', [])},
        catalogFilters.transmitterTypes.length > 0 && {key: 'types', label: catalogFilters.transmitterTypes.join(', '), onDelete: () => updateCatalogFilter('transmitterTypes', [])},
        catalogFilters.services.length > 0 && {key: 'services', label: t('satellite_database.filter_service', {value: catalogFilters.services.join(', ')}), onDelete: () => updateCatalogFilter('services', [])},
        catalogFilters.country && {key: 'country', label: t('satellite_database.filter_country', {value: catalogFilters.country}), onDelete: () => updateCatalogFilter('country', '')},
        catalogFilters.source && {key: 'source', label: t('satellite_database.filter_source', {value: catalogFilters.source}), onDelete: () => updateCatalogFilter('source', '')},
        (catalogFilters.launchedFrom || catalogFilters.launchedTo) && {key: 'launched', label: t('satellite_database.filter_launch', {from: catalogFilters.launchedFrom || '…', to: catalogFilters.launchedTo || '…'}), onDelete: () => setCatalogFilters(current => ({...current, launchedFrom: '', launchedTo: ''}))},
        (catalogFilters.baudMin !== '' || catalogFilters.baudMax !== '') && {key: 'baud', label: t('satellite_database.filter_baud', {from: catalogFilters.baudMin || '0', to: catalogFilters.baudMax || '…'}), onDelete: () => setCatalogFilters(current => ({...current, baudMin: '', baudMax: ''}))},
        catalogFilters.frequencyViolation && {key: 'violation', label: t('satellite_database.frequency_violation'), onDelete: () => updateCatalogFilter('frequencyViolation', false)},
        catalogFilters.unconfirmed && {key: 'unconfirmed', label: t('satellite_database.unconfirmed_transmitter'), onDelete: () => updateCatalogFilter('unconfirmed', false)},
    ].filter(Boolean);

    return (
        <Box elevation={3} sx={{width: '100%', marginTop: 0}}>
            <Paper
                variant="outlined"
                sx={{
                    p: {xs: 1.5, md: 2},
                    borderRadius: 2,
                    backgroundColor: (theme) => (
                        theme.palette.mode === 'dark'
                            ? alpha(theme.palette.grey[700], 0.18)
                            : alpha(theme.palette.grey[100], 0.9)
                    ),
                }}
            >
                <TextField
                    fullWidth
                    size="small"
                    sx={filterFieldSx}
                    variant="outlined"
                    label={t('satellite_database.search_satellites')}
                    value={localSearchValue}
                    onChange={handleSearchChange}
                    placeholder={t('satellite_database.catalog_search_placeholder', {
                        defaultValue: 'Search satellite, NORAD ID, transmitter, mode, or service…',
                    })}
                    InputProps={{
                        startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment>,
                        endAdornment: localSearchValue ? (
                            <InputAdornment position="end">
                                <IconButton aria-label={t('satellite_database.clear_search')} onClick={handleClearSearch} edge="end" size="small">
                                    <ClearIcon />
                                </IconButton>
                            </InputAdornment>
                        ) : null,
                    }}
                />

                <Box sx={{
                    display: 'grid',
                    gridTemplateColumns: {xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: '1.35fr 1.2fr 1fr 1fr 1fr auto'},
                    gap: 1.25,
                    mt: 1.5,
                }}>
                    <FormControl size="small" sx={filterFieldSx} variant="outlined">
                    <InputLabel id="sat-group-select-label">{t('satellite_database.filter_group', {defaultValue: 'Group'})}</InputLabel>
                    <Select
                        value={satGroupId}
                        id="grouped-select"
                        labelId="sat-group-select-label"
                        input={<OutlinedInput label={t('satellite_database.filter_group', {defaultValue: 'Group'})} />}
                        onChange={handleOnGroupChange}
                    >
                        <MenuItem value="">{t('satellite_database.all_groups', {defaultValue: 'All groups'})}</MenuItem>
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

                    <FormControl size="small" sx={filterFieldSx}>
                        <InputLabel id="catalog-band-label">{t('satellite_database.filter_bands', {defaultValue: 'Bands'})}</InputLabel>
                        <Select
                            multiple
                            labelId="catalog-band-label"
                            value={catalogFilters.bands}
                            input={<OutlinedInput label={t('satellite_database.filter_bands', {defaultValue: 'Bands'})} />}
                            renderValue={(selectedBands) => selectedBands.join(', ')}
                            onChange={(event) => updateCatalogFilter('bands', event.target.value)}
                        >
                            {FREQUENCY_BANDS.map(band => (
                                <MenuItem key={band} value={band}>
                                    <Checkbox checked={catalogFilters.bands.includes(band)} size="small" />
                                    {band}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    <TextField
                        size="small"
                        type="number"
                        sx={filterFieldSx}
                        label={`${t('satellite_database.filter_minimum_frequency')} (${catalogFilters.frequencyUnit})`}
                        value={catalogFilters.frequencyMin}
                        onChange={(event) => updateCatalogFilter('frequencyMin', event.target.value)}
                        inputProps={{min: 0, step: 'any'}}
                    />

                    <FormControl size="small" sx={filterFieldSx}>
                        <InputLabel id="catalog-status-label">{t('satellite_database.status')}</InputLabel>
                        <Select
                            labelId="catalog-status-label"
                            value={catalogFilters.status}
                            label={t('satellite_database.status')}
                            onChange={(event) => updateCatalogFilter('status', event.target.value)}
                        >
                            <MenuItem value="">{t('satellite_database.any', {defaultValue: 'Any status'})}</MenuItem>
                            {statusOptions.map(status => (
                                <MenuItem key={status} value={status}>{status}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    <FormControl size="small" sx={filterFieldSx}>
                        <InputLabel id="catalog-transmitter-state-label">{t('satellite_database.transmitter_filters')}</InputLabel>
                        <Select
                            labelId="catalog-transmitter-state-label"
                            value={catalogFilters.transmitterState}
                            label={t('satellite_database.transmitter_filters')}
                            onChange={(event) => updateCatalogFilter('transmitterState', event.target.value)}
                        >
                            <MenuItem value="">{t('satellite_database.any_transmitter')}</MenuItem>
                            <MenuItem value="any">{t('satellite_database.has_transmitters')}</MenuItem>
                            <MenuItem value="active">{t('satellite_database.active_transmitters')}</MenuItem>
                            <MenuItem value="inactive">{t('satellite_database.inactive_transmitters')}</MenuItem>
                            <MenuItem value="none">{t('satellite_database.no_transmitters')}</MenuItem>
                        </Select>
                    </FormControl>

                    <Button
                        variant={activeFilterCount ? 'contained' : 'outlined'}
                        startIcon={<TuneRoundedIcon />}
                        endIcon={filtersExpanded ? <ExpandLessRoundedIcon /> : <ExpandMoreRoundedIcon />}
                        onClick={() => setFiltersExpanded(expanded => !expanded)}
                        sx={{whiteSpace: 'nowrap', minHeight: 40}}
                    >
                        {t('satellite_database.filters', {defaultValue: 'Filters'})}{activeFilterCount ? ` (${activeFilterCount})` : ''}
                    </Button>
                </Box>

                <Collapse in={filtersExpanded}>
                    <Divider sx={{my: 2}} />
                    <Box sx={{
                        display: 'grid',
                        gridTemplateColumns: {xs: '1fr', md: 'repeat(3, minmax(0, 1fr))'},
                        gap: 3,
                        ...filterFieldSx,
                    }}>
                        <Stack spacing={1.25}>
                            <Typography variant="subtitle2">{t('satellite_database.satellite_filters', {defaultValue: 'Satellite'})}</Typography>
                            <FormControl size="small" sx={filterFieldSx}><InputLabel>{t('satellite_database.country')}</InputLabel><Select value={catalogFilters.country} label={t('satellite_database.country')} onChange={(event) => updateCatalogFilter('country', event.target.value)}><MenuItem value="">{t('satellite_database.any_country')}</MenuItem>{countryOptions.map(country => <MenuItem key={country} value={country}>{country}</MenuItem>)}</Select></FormControl>
                            <FormControl size="small" sx={filterFieldSx}><InputLabel>{t('satellite_database.source')}</InputLabel><Select value={catalogFilters.source} label={t('satellite_database.source')} onChange={(event) => updateCatalogFilter('source', event.target.value)}><MenuItem value="">{t('satellite_database.any_source')}</MenuItem>{sourceOptions.map(source => <MenuItem key={source} value={source}>{source}</MenuItem>)}</Select></FormControl>
                            <Stack direction={{xs: 'column', sm: 'row'}} spacing={1}>
                                <TextField fullWidth size="small" sx={filterFieldSx} type="date" label={t('satellite_database.launched_from')} value={catalogFilters.launchedFrom} onChange={(event) => updateCatalogFilter('launchedFrom', event.target.value)} InputLabelProps={{shrink: true}} />
                                <TextField fullWidth size="small" sx={filterFieldSx} type="date" label={t('satellite_database.launched_to')} value={catalogFilters.launchedTo} onChange={(event) => updateCatalogFilter('launchedTo', event.target.value)} InputLabelProps={{shrink: true}} />
                            </Stack>
                        </Stack>

                        <Stack spacing={1.25}>
                            <Typography variant="subtitle2">{t('satellite_database.spectrum_filters', {defaultValue: 'Radio spectrum'})}</Typography>
                            <FormControl size="small" sx={filterFieldSx}><InputLabel>{t('satellite_database.direction')}</InputLabel><Select value={catalogFilters.direction} label={t('satellite_database.direction')} onChange={(event) => updateCatalogFilter('direction', event.target.value)}><MenuItem value="downlink">{t('satellite_database.downlink')}</MenuItem><MenuItem value="uplink">{t('satellite_database.uplink')}</MenuItem><MenuItem value="either">{t('satellite_database.either_direction')}</MenuItem></Select></FormControl>
                            <Stack direction="row" spacing={1}>
                                <TextField fullWidth size="small" sx={filterFieldSx} type="number" label={t('satellite_database.minimum')} value={catalogFilters.frequencyMin} onChange={(event) => updateCatalogFilter('frequencyMin', event.target.value)} inputProps={{min: 0, step: 'any'}} />
                                <TextField fullWidth size="small" sx={filterFieldSx} type="number" label={t('satellite_database.maximum')} value={catalogFilters.frequencyMax} onChange={(event) => updateCatalogFilter('frequencyMax', event.target.value)} inputProps={{min: 0, step: 'any'}} />
                                <FormControl size="small" sx={{...filterFieldSx, minWidth: 90}}><InputLabel>{t('satellite_database.unit')}</InputLabel><Select value={catalogFilters.frequencyUnit} label={t('satellite_database.unit')} onChange={(event) => updateCatalogFilter('frequencyUnit', event.target.value)}>{Object.keys(FREQUENCY_UNITS).map(unit => <MenuItem key={unit} value={unit}>{unit}</MenuItem>)}</Select></FormControl>
                            </Stack>
                            <FormControl size="small" sx={filterFieldSx}><InputLabel>{t('satellite_database.service')}</InputLabel><Select multiple value={catalogFilters.services} label={t('satellite_database.service')} renderValue={(values) => values.join(', ')} onChange={(event) => updateCatalogFilter('services', event.target.value)}>{serviceOptions.map(service => <MenuItem key={service} value={service}><Checkbox checked={catalogFilters.services.includes(service)} size="small" />{service}</MenuItem>)}</Select></FormControl>
                        </Stack>

                        <Stack spacing={1.25}>
                            <Typography variant="subtitle2">{t('satellite_database.transmitter_filters', {defaultValue: 'Transmitter'})}</Typography>
                            <FormControl size="small" sx={filterFieldSx}><InputLabel>{t('satellite_database.state')}</InputLabel><Select value={catalogFilters.transmitterState} label={t('satellite_database.state')} onChange={(event) => updateCatalogFilter('transmitterState', event.target.value)}><MenuItem value="">{t('satellite_database.any_state')}</MenuItem><MenuItem value="any">{t('satellite_database.has_transmitters')}</MenuItem><MenuItem value="active">{t('satellite_database.active')}</MenuItem><MenuItem value="inactive">{t('satellite_database.inactive')}</MenuItem><MenuItem value="none">{t('satellite_database.no_transmitters')}</MenuItem></Select></FormControl>
                            <FormControl size="small" sx={filterFieldSx}><InputLabel>{t('satellite_database.mode')}</InputLabel><Select multiple value={catalogFilters.modes} label={t('satellite_database.mode')} renderValue={(values) => values.join(', ')} onChange={(event) => updateCatalogFilter('modes', event.target.value)}>{modeOptions.map(mode => <MenuItem key={mode} value={mode}><Checkbox checked={catalogFilters.modes.includes(mode)} size="small" />{mode}</MenuItem>)}</Select></FormControl>
                            <FormControl size="small" sx={filterFieldSx}><InputLabel>{t('satellite_database.type')}</InputLabel><Select multiple value={catalogFilters.transmitterTypes} label={t('satellite_database.type')} renderValue={(values) => values.join(', ')} onChange={(event) => updateCatalogFilter('transmitterTypes', event.target.value)}>{transmitterTypeOptions.map(type => <MenuItem key={type} value={type}><Checkbox checked={catalogFilters.transmitterTypes.includes(type)} size="small" />{type}</MenuItem>)}</Select></FormControl>
                            <Stack direction="row" spacing={1}><TextField fullWidth size="small" sx={filterFieldSx} type="number" label={t('satellite_database.minimum_baud')} value={catalogFilters.baudMin} onChange={(event) => updateCatalogFilter('baudMin', event.target.value)} inputProps={{min: 0}} /><TextField fullWidth size="small" sx={filterFieldSx} type="number" label={t('satellite_database.maximum_baud')} value={catalogFilters.baudMax} onChange={(event) => updateCatalogFilter('baudMax', event.target.value)} inputProps={{min: 0}} /></Stack>
                        </Stack>
                    </Box>
                    <Divider sx={{my: 2}} />
                    <Stack direction={{xs: 'column', sm: 'row'}} spacing={1} alignItems={{sm: 'center'}} justifyContent="space-between">
                        <Stack direction={{xs: 'column', sm: 'row'}} spacing={{sm: 2}}>
                            <FormControlLabel control={<Checkbox size="small" checked={catalogFilters.frequencyViolation} onChange={(event) => updateCatalogFilter('frequencyViolation', event.target.checked)} />} label={t('satellite_database.frequency_violation')} />
                            <FormControlLabel control={<Checkbox size="small" checked={catalogFilters.unconfirmed} onChange={(event) => updateCatalogFilter('unconfirmed', event.target.checked)} />} label={t('satellite_database.unconfirmed_transmitter')} />
                        </Stack>
                        <Button size="small" onClick={clearAllFilters}>{t('satellite_database.clear_all')}</Button>
                    </Stack>
                </Collapse>

                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{mt: 1.5, height: 32}}>
                    <Stack
                        direction="row"
                        spacing={0.75}
                        alignItems="center"
                        sx={{
                            flex: 1,
                            minWidth: 0,
                            height: 32,
                            overflowX: 'auto',
                            overflowY: 'hidden',
                            scrollbarWidth: 'none',
                            '&::-webkit-scrollbar': {display: 'none'},
                        }}
                    >
                        {activeFilterChips.length === 0 && (
                            <Stack
                                direction="row"
                                spacing={0.5}
                                alignItems="center"
                                sx={{color: 'text.disabled', flexShrink: 0}}
                            >
                                <TuneRoundedIcon sx={{fontSize: 16}} />
                                <Typography variant="caption" color="inherit">
                                    {t('satellite_database.no_filters_applied')}
                                </Typography>
                            </Stack>
                        )}
                        {activeFilterChips.map(filter => <Chip key={filter.key} label={filter.label} onDelete={filter.onDelete} size="small" sx={{flexShrink: 0}} />)}
                        {activeFilterChips.length > 1 && <Button size="small" onClick={clearAllFilters} sx={{flexShrink: 0}}>{t('satellite_database.clear_all')}</Button>}
                    </Stack>
                    <Typography variant="body2" color="text.secondary" sx={{whiteSpace: 'nowrap', flexShrink: 0}}>
                        {localSearchValue.trim().length === 1
                            ? t('satellite_database.catalog_search_min_chars', {defaultValue: 'Type at least 2 characters to search'})
                            : loading
                                ? t('satellite_database.searching')
                                : t('satellite_database.results_count', {count: catalogTotal})}
                    </Typography>
                </Stack>
            </Paper>
            <div>
                <DataGrid
                    getRowId={(satellite) => {
                        return satellite['norad_id'];
                    }}
                    loading={loading}
                    rows={satellites}
                    columns={columns}
                    rowHeight={52}
                    columnHeaderHeight={52}
                    pageSizeOptions={[5, 10, 20, 50, 100]}
                    paginationMode="server"
                    sortingMode="server"
                    rowCount={catalogTotal}
                    paginationModel={paginationModel}
                    onPaginationModelChange={handlePaginationModelChange}
                    sortModel={sortModel}
                    initialState={{
                        columns: {
                            columnVisibilityModel: DEFAULT_CATALOG_COLUMN_VISIBILITY,
                        },
                    }}
                    onSortModelChange={(model) => {
                        immediateSearchRef.current = true;
                        dispatch(setCatalogSortModel(model));
                        setPaginationModel(current => ({...current, page: 0}));
                    }}
                    checkboxSelection={true}
                    slotProps={{
                        basePagination: {
                            ActionsComponent: Pagination,
                        },
                        loadingOverlay: {
                            variant: 'linear-progress',
                            noRowsVariant: 'linear-progress',
                        },
                    }}
                    onRowSelectionModelChange={(selection) => {
                        const normalized = toSelectedIds(selection).map((value) => Number(value));
                        dispatch(setSelected(normalized));
                    }}
                    localeText={{
                        noRowsLabel: t('satellite_database.catalog_no_results', {defaultValue: 'No satellites match these filters.'})
                    }}
                    sx={{
                        border: 0,
                        marginTop: 2,
                        minHeight: '429px',
                        width: '100%',
                        [`& .${gridClasses.cell}:focus, & .${gridClasses.cell}:focus-within`]: {
                            outline: 'none',
                        },
                        [`& .${gridClasses.cell}`]: {
                            display: 'flex',
                            alignItems: 'center',
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
                            minHeight: '52px !important',
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
