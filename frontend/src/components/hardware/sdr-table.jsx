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
    Chip,
    CircularProgress,
    Divider,
    FormControl,
    IconButton,
    InputAdornment,
    InputLabel,
    LinearProgress,
    MenuItem,
    Select,
    ToggleButton,
    ToggleButtonGroup,
    TextField,
    Tooltip,
    Typography
} from "@mui/material";
import { alpha } from '@mui/material/styles';
import {useEffect, useMemo, useRef, useState} from "react";
import { useTranslation } from 'react-i18next';
import DialogTitle from "@mui/material/DialogTitle";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import {useSocket} from "../common/socket.jsx";
import { toast } from '../../utils/toast-with-timestamp.jsx';
import { useDispatch, useSelector } from 'react-redux';
import {
    deleteSDRs,
    fetchSDRs,
    submitOrEditSDR,
    setOpenDeleteConfirm,
    setOpenAddDialog,
    setFormValues,
    resetFormValues,
    fetchSoapySDRServers,
    setSelectedSdrDevice,
    fetchLocalSoapySDRDevices,
    startSoapySDRDiscovery,
    fetchLocalRtlSdrDevices,
    fetchLocalUhdDevices,
    fetchLocalAirspyDevices,
} from './sdr-slice.jsx';
import Paper from "@mui/material/Paper";
import MemoryIcon from '@mui/icons-material/Memory';
import DnsIcon from '@mui/icons-material/Dns';
import RefreshIcon from '@mui/icons-material/Refresh';
import PendingActionsIcon from '@mui/icons-material/PendingActions';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import CancelIcon from '@mui/icons-material/Cancel';
import EditOutlinedIcon from '@mui/icons-material/EditOutlined';
import {toRowSelectionModel, toSelectedIds} from '../../utils/datagrid-selection.js';
import SelectionActionBar from './selection-action-bar.jsx';

// SDR type field configurations with default values
const sdrTypeFields = {
    rtlsdrusbv3: {
        excludeFields: ['host', 'port', 'driver'],
        fields: ['name', 'frequency_min', 'frequency_max', 'serial'],
        defaults: {
            name: 'USB SDR v3',
            frequency_min: 24,
            frequency_max: 1700,
            serial: ''
        }
    },
    rtlsdrtcpv3: {
        excludeFields: ['serial', 'driver'],
        fields: ['host', 'port', 'name', 'frequency_min', 'frequency_max'],
        defaults: {
            host: '127.0.0.1',
            port: 1234,
            name: 'TCP SDR v3',
            frequency_min: 24,
            frequency_max: 1700,
            serial: ''
        }
    },
    rtlsdrusbv4: {
        excludeFields: ['host', 'port', 'driver'],
        fields: ['name', 'frequency_min', 'frequency_max', 'serial'],
        defaults: {
            name: 'USB SDR v4',
            frequency_min: 24,
            frequency_max: 1800,
            serial: ''
        }
    },
    rtlsdrtcpv4: {
        excludeFields: ['serial', 'driver'],
        fields: ['host', 'port', 'name', 'frequency_min', 'frequency_max'],
        defaults: {
            host: '127.0.0.1',
            port: 1234,
            name: 'TCP SDR v4',
            frequency_min: 24,
            frequency_max: 1800,
            serial: ''
        }
    },
    soapysdrremote: {
        excludeFields: [],
        fields: ['host', 'port', 'name', 'frequency_min', 'frequency_max', 'driver', 'serial'],
        defaults: {
            host: '',
            port: 55132,
            name: 'SoapySDR Remote',
            frequency_min: 24,
            frequency_max: 1800,
            driver: '',
            serial: ''
        }
    },
    soapysdrlocal: {
        excludeFields: ['host', 'port'],
        fields: ['name', 'frequency_min', 'frequency_max', 'driver', 'serial'],
        defaults: {
            name: 'SoapySDR USB',
            frequency_min: 24,
            frequency_max: 1800,
            driver: '',
            serial: ''
        }
    },
    uhd: {
        excludeFields: ['host', 'port', 'driver'],
        fields: ['name', 'frequency_min', 'frequency_max', 'serial'],
        defaults: {
            name: 'UHD Device',
            frequency_min: 10,
            frequency_max: 6000,
            serial: ''
        }
    },
    airspy: {
        excludeFields: ['host', 'port'],
        fields: ['name', 'frequency_min', 'frequency_max', 'driver', 'serial'],
        defaults: {
            name: 'Airspy',
            frequency_min: 24,
            frequency_max: 1750,
            driver: 'airspy',
            serial: ''
        }
    },
    airspyhf: {
        excludeFields: ['host', 'port'],
        fields: ['name', 'frequency_min', 'frequency_max', 'driver', 'serial'],
        defaults: {
            name: 'Airspy HF+',
            frequency_min: 0.009,
            frequency_max: 260,
            driver: 'airspyhf',
            serial: ''
        }
    }
};

const rtlUsbTypes = new Set(['rtlsdrusbv3', 'rtlsdrusbv4']);
const rtlTcpTypes = new Set(['rtlsdrtcpv3', 'rtlsdrtcpv4']);

const getRtlGroup = (type) => {
    if (rtlUsbTypes.has(type)) return 'usb';
    if (rtlTcpTypes.has(type)) return 'tcp';
    return null;
};

const getMergedRtlValue = (type) => {
    const group = getRtlGroup(type);
    return group ? `rtlsdr${group}` : type;
};

const isMergedRtlValue = (value) => value === 'rtlsdrusb' || value === 'rtlsdrtcp';
const MAX_ANTENNA_LABEL_LENGTH = 64;

const isSoapyDiscoveryTask = (task) => {
    if (!task) return false;
    const name = String(task.name || '').toLowerCase();
    const command = String(task.command || '').toLowerCase();
    return (
        command.includes('soapysdr_discovery') ||
        command.includes('soapysdr_quick_refresh') ||
        name.includes('soapysdr discovery') ||
        name.includes('soapysdr refresh')
    );
};

const normalizeAntennaPorts = (ports) => {
    if (!Array.isArray(ports)) return [];
    const normalized = [];
    ports.forEach((port) => {
        const portName = String(port || '').trim();
        if (portName && !normalized.includes(portName)) {
            normalized.push(portName);
        }
    });
    return normalized;
};

const normalizeAntennaInfo = (antennas) => ({
    rx: normalizeAntennaPorts(antennas?.rx),
    tx: normalizeAntennaPorts(antennas?.tx),
});

const mergeAntennaPortLists = (...lists) => {
    const merged = [];
    lists.forEach((list) => {
        if (!Array.isArray(list)) return;
        list.forEach((port) => {
            const portName = String(port || '').trim();
            if (!portName || merged.includes(portName)) return;
            merged.push(portName);
        });
    });
    return merged;
};

const normalizeAntennaLabels = (labels) => {
    if (!labels || typeof labels !== 'object') return {};

    const normalized = {};
    ['rx', 'tx'].forEach((direction) => {
        const directionLabels = labels[direction];
        if (!directionLabels || typeof directionLabels !== 'object') return;

        const cleanEntries = {};
        Object.entries(directionLabels).forEach(([internalName, userLabel]) => {
            const key = String(internalName || '').trim();
            const value = String(userLabel ?? '');
            if (!key) return;
            // Keep empty labels so we can persist the full known port map.
            cleanEntries[key] = value.slice(0, MAX_ANTENNA_LABEL_LENGTH);
        });

        if (Object.keys(cleanEntries).length > 0) {
            normalized[direction] = cleanEntries;
        }
    });

    return normalized;
};

const toDisplayServerName = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';

    const stripped = raw
        .replace(/\._soapy\._tcp\.local\.?$/i, '')
        .replace(/\.local\.?$/i, '')
        .trim();
    return stripped || raw;
};

const toTaskTimestampMs = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    return numeric > 1e12 ? numeric : numeric * 1000;
};

const toTaskDurationMs = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    // Backend durations are in seconds; keep a defensive path for ms values.
    return numeric > 1_000_000 ? numeric : numeric * 1000;
};

const formatTaskDuration = (durationMs) => {
    if (!durationMs || durationMs < 0) return '-';
    const totalSeconds = Math.floor(durationMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
};


export default function SDRsPage() {
    const { socket } = useSocket();
    const dispatch = useDispatch();
    const [selected, setSelected] = useState([]);
    const [pageSize, setPageSize] = useState(10);
    const [selectedRtlDevice, setSelectedRtlDevice] = useState('');
    const [selectedUhdDevice, setSelectedUhdDevice] = useState('');
    const [selectedAirspyDevice, setSelectedAirspyDevice] = useState('');
    const [deleteConfirmText, setDeleteConfirmText] = useState('');
    const [discovering, setDiscovering] = useState(false);
    const [stickyAntennaPorts, setStickyAntennaPorts] = useState({ rx: [], tx: [] });
    const hasInitialized = useRef(false);
    const rtlProbeRequested = useRef(false);
    const uhdProbeRequested = useRef(false);
    const airspyProbeRequested = useRef(false);
    const { t } = useTranslation('hardware');

    const {
        loading,
        sdrs,
        status,
        error,
        openAddDialog,
        openDeleteConfirm,
        formValues,
        soapyServers,
        selectedSdrDevice,
        localSoapyDevices,
        loadingLocalSDRs,
        localRtlDevices,
        loadingLocalRtlSDRs,
        localUhdDevices,
        loadingLocalUhdSDRs,
        localAirspyDevices,
        loadingLocalAirspySDRs,
    } = useSelector((state) => state.sdrs);
    const { tasks: backgroundTasks = {} } = useSelector((state) => state.backgroundTasks);
    const rowSelectionModel = useMemo(() => toRowSelectionModel(selected), [selected]);
    const isEditing = Boolean(formValues.id);
    const isLocalSoapyProbeLoading = formValues.type === 'soapysdrlocal' && loadingLocalSDRs;
    const isDialogFormInputsDisabled =
        loading ||
        loadingLocalRtlSDRs ||
        loadingLocalUhdSDRs ||
        loadingLocalAirspySDRs ||
        isLocalSoapyProbeLoading;
    const isSoapyServerDiscoveryRunning = useMemo(
        () =>
            Object.values(backgroundTasks).some(
                (task) => task?.status === 'running' && isSoapyDiscoveryTask(task)
            ),
        [backgroundTasks]
    );
    const showSoapyDiscoveryOverlay = openAddDialog && isSoapyServerDiscoveryRunning;
    const [taskDurationTick, setTaskDurationTick] = useState(() => Date.now());
    const requiresDeleteConfirmationText = selected.length > 1;
    const canConfirmDelete = !requiresDeleteConfirmationText || deleteConfirmText.trim() === 'DELETE';
    const soapyDiscoveryTasks = useMemo(
        () => Object.values(backgroundTasks).filter((task) => isSoapyDiscoveryTask(task)),
        [backgroundTasks]
    );
    const runningSoapyDiscoveryTask = useMemo(
        () => soapyDiscoveryTasks.find((task) => task?.status === 'running') || null,
        [soapyDiscoveryTasks]
    );
    const latestSoapyDiscoveryTask = useMemo(() => {
        if (soapyDiscoveryTasks.length === 0) return null;
        return [...soapyDiscoveryTasks].sort((a, b) => {
            const aTs = toTaskTimestampMs(a?.end_time) ?? toTaskTimestampMs(a?.start_time) ?? 0;
            const bTs = toTaskTimestampMs(b?.end_time) ?? toTaskTimestampMs(b?.start_time) ?? 0;
            return bTs - aTs;
        })[0];
    }, [soapyDiscoveryTasks]);
    const activeSoapyDiscoveryTask = runningSoapyDiscoveryTask || latestSoapyDiscoveryTask;
    const soapyServerEntries = useMemo(
        () => (soapyServers && typeof soapyServers === 'object' ? Object.entries(soapyServers) : []),
        [soapyServers]
    );
    const hasDiscoveredSoapyServers = soapyServerEntries.length > 0;
    const discoveryTaskDurationMs = useMemo(() => {
        if (!activeSoapyDiscoveryTask) return null;
        const fromTask = toTaskDurationMs(activeSoapyDiscoveryTask.duration);
        if (fromTask) return fromTask;

        const startMs = toTaskTimestampMs(activeSoapyDiscoveryTask.start_time);
        if (!startMs) return null;
        const endMs = activeSoapyDiscoveryTask.status === 'running'
            ? taskDurationTick
            : (toTaskTimestampMs(activeSoapyDiscoveryTask.end_time) || taskDurationTick);
        return Math.max(0, endMs - startMs);
    }, [activeSoapyDiscoveryTask, taskDurationTick]);
    const discoveryTaskLastOutput = useMemo(() => {
        const lines = activeSoapyDiscoveryTask?.output_lines;
        if (!Array.isArray(lines) || lines.length === 0) return '';
        const lastLine = lines[lines.length - 1];
        const text = String(lastLine?.output || '').replace(/\s+/g, ' ').trim();
        return text;
    }, [activeSoapyDiscoveryTask]);

    useEffect(() => {
        if (!runningSoapyDiscoveryTask) return undefined;
        const timerId = window.setInterval(() => {
            setTaskDurationTick(Date.now());
        }, 1000);
        return () => window.clearInterval(timerId);
    }, [runningSoapyDiscoveryTask]);

    useEffect(() => {
        if (!hasInitialized.current) {
            hasInitialized.current = true;
            dispatch(fetchSoapySDRServers({ socket }));
        }
    }, [dispatch, socket]);

    useEffect(() => {
        if (openAddDialog) {
            setSelectedRtlDevice('');
            setSelectedUhdDevice('');
            setSelectedAirspyDevice('');
        } else {
            rtlProbeRequested.current = false;
            uhdProbeRequested.current = false;
            airspyProbeRequested.current = false;
            setStickyAntennaPorts({ rx: [], tx: [] });
        }
    }, [openAddDialog]);

    useEffect(() => {
        if (!openAddDialog) return;
        // Reset row visibility cache when the selected device context changes.
        setStickyAntennaPorts({ rx: [], tx: [] });
    }, [
        openAddDialog,
        formValues.id,
        formValues.type,
        formValues.host,
        selectedRtlDevice,
        selectedUhdDevice,
        selectedAirspyDevice,
        selectedSdrDevice
    ]);

    useEffect(() => {
        const isRtlUsb = rtlUsbTypes.has(formValues.type);
        if (openAddDialog && isRtlUsb && !loadingLocalRtlSDRs && !rtlProbeRequested.current) {
            rtlProbeRequested.current = true;
            dispatch(fetchLocalRtlSdrDevices({ socket }));
        }
    }, [dispatch, formValues.type, loadingLocalRtlSDRs, openAddDialog, socket]);

    useEffect(() => {
        const isUhd = formValues.type === 'uhd';
        if (openAddDialog && isUhd && !loadingLocalUhdSDRs && !uhdProbeRequested.current) {
            uhdProbeRequested.current = true;
            dispatch(fetchLocalUhdDevices({ socket }));
        }
    }, [dispatch, formValues.type, loadingLocalUhdSDRs, openAddDialog, socket]);

    useEffect(() => {
        const isNativeAirspy = formValues.type === 'airspy' || formValues.type === 'airspyhf';
        if (
            openAddDialog &&
            isNativeAirspy &&
            !loadingLocalAirspySDRs &&
            !airspyProbeRequested.current
        ) {
            airspyProbeRequested.current = true;
            dispatch(fetchLocalAirspyDevices({ socket }));
        }
    }, [dispatch, formValues.type, loadingLocalAirspySDRs, openAddDialog, socket]);

    const handleStartSoapyDiscovery = async () => {
        if (!socket) return;
        setDiscovering(true);
        try {
            await dispatch(startSoapySDRDiscovery({ socket })).unwrap();
        } catch (error) {
            console.error('Failed to start SoapySDR discovery:', error);
            toast.error(t('sdr.discovery_failed', 'Failed to start SoapySDR discovery'));
        } finally {
            setDiscovering(false);
        }
    };

    const getTypeLabel = (type) => {
        if (rtlUsbTypes.has(type)) return t('sdr.rtlsdr_usb', 'RTL-SDR USB');
        if (rtlTcpTypes.has(type)) return t('sdr.rtlsdr_tcp', 'RTL-SDR TCP');

        switch (type) {
            case 'soapysdrremote':
                return t('sdr.soapysdr_remote');
            case 'soapysdrlocal':
                return t('sdr.soapysdr_usb');
            case 'uhd':
                return t('sdr.uhd');
            case 'airspy':
                return t('sdr.airspy', 'Airspy');
            case 'airspyhf':
                return t('sdr.airspy_hf', 'Airspy HF+');
            default:
                return type || '-';
        }
    };

    const columns = [
        {
            field: 'name', headerName: t('sdr.name'), flex: 1, minWidth: 150
        },
        {
            field: 'type',
            headerName: t('sdr.type'),
            flex: 1,
            minWidth: 100,
            renderCell: (params) => {
                if (!params.row) {
                    return "-";
                }
                return getTypeLabel(params.row.type);
            }
        },
        {
            field: 'host',
            headerName: t('sdr.host'),
            flex: 1,
            minWidth: 150,
            renderCell: (params) => {
                if (!params.row) {
                    return "-";
                }
                return params.row.host || '-';
            }
        },
        {
            field: 'port',
            headerName: t('sdr.port'),
            flex: 1,
            minWidth: 100,
            renderCell: (params) => {
                if (!params.row) {
                    return "-";
                }
                return params.row.port || '-';
            }
        },
        {
            field: 'frequency_min',
            headerName: t('sdr.frequency_range'),
            flex: 1,
            minWidth: 200,
            renderCell: (params) => {
                if (!params.row) {
                    return "-";
                }
                return `${params.row.frequency_min || 0} MHz - ${params.row.frequency_max || 0} MHz`;
            }
        },
        {
            field: 'driver', headerName: t('sdr.driver'), flex: 1, minWidth: 100
        },
        {
            field: 'serial',
            headerName: t('sdr.serial'),
            flex: 1,
            minWidth: 150,
            renderCell: (params) => {
                if (!params.row) {
                    return "-";
                }
                return params.row.serial || '-';
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
                    aria-label={t('sdr.edit')}
                    onClick={(event) => {
                        event.stopPropagation();
                        dispatch(setFormValues({
                            ...params.row,
                            antenna_labels: normalizeAntennaLabels(params.row.antenna_labels),
                        }));
                        dispatch(setOpenAddDialog(true));
                    }}
                >
                    <EditOutlinedIcon fontSize="small" />
                </IconButton>
            ),
        },
    ];

    const getSelectedSoapyServerInfo = () => {
        if (!formValues.host || !soapyServers) return null;
        const selectedServerEntry = Object.entries(soapyServers).find(
            ([_, server]) => server.ip === formValues.host
        );
        return selectedServerEntry ? selectedServerEntry[1] : null;
    };

    const getSelectedRemoteSdr = () => {
        const selectedServerInfo = getSelectedSoapyServerInfo();
        if (!selectedServerInfo || selectedSdrDevice === '') return null;

        const selectedIndex = Number(selectedSdrDevice);
        if (Number.isNaN(selectedIndex)) return null;

        return selectedServerInfo?.sdrs?.[selectedIndex] || null;
    };

    const getCurrentProbeAntennaInfo = () => {
        if (rtlUsbTypes.has(formValues.type)) {
            if (selectedRtlDevice === '') return { rx: [], tx: [] };
            return normalizeAntennaInfo(localRtlDevices?.[Number(selectedRtlDevice)]?.antennas);
        }

        if (formValues.type === 'soapysdrlocal') {
            if (selectedSdrDevice === '') return { rx: [], tx: [] };
            return normalizeAntennaInfo(localSoapyDevices?.[Number(selectedSdrDevice)]?.antennas);
        }

        if (formValues.type === 'soapysdrremote') {
            return normalizeAntennaInfo(getSelectedRemoteSdr()?.antennas);
        }

        if (formValues.type === 'uhd') {
            if (selectedUhdDevice === '') return { rx: [], tx: [] };
            return normalizeAntennaInfo(localUhdDevices?.[Number(selectedUhdDevice)]?.antennas);
        }

        if (formValues.type === 'airspy' || formValues.type === 'airspyhf') {
            if (selectedAirspyDevice === '') return { rx: [], tx: [] };
            return normalizeAntennaInfo(localAirspyDevices?.[Number(selectedAirspyDevice)]?.antennas);
        }

        return { rx: [], tx: [] };
    };

    const getVisibleAntennaInfo = () => {
        const probeInfo = getCurrentProbeAntennaInfo();
        const merged = {
            rx: [...stickyAntennaPorts.rx],
            tx: [...stickyAntennaPorts.tx],
        };

        // In edit mode (or when probes are not active), keep previously saved antenna
        // keys visible so labels remain editable.
        const persistedLabels = normalizeAntennaLabels(formValues.antenna_labels);
        ['rx', 'tx'].forEach((direction) => {
            const keys = Object.keys(persistedLabels?.[direction] || {});
            keys.forEach((key) => {
                const portName = String(key || '').trim();
                if (!portName || merged[direction].includes(portName)) return;
                merged[direction].push(portName);
            });
        });

        merged.rx = mergeAntennaPortLists(merged.rx, probeInfo.rx);
        merged.tx = mergeAntennaPortLists(merged.tx, probeInfo.tx);

        return merged;
    };

    useEffect(() => {
        if (!openAddDialog) return;

        const probeInfo = getCurrentProbeAntennaInfo();
        const persistedLabels = normalizeAntennaLabels(formValues.antenna_labels);
        const nextRx = mergeAntennaPortLists(
            stickyAntennaPorts.rx,
            probeInfo.rx,
            Object.keys(persistedLabels?.rx || {})
        );
        const nextTx = mergeAntennaPortLists(
            stickyAntennaPorts.tx,
            probeInfo.tx,
            Object.keys(persistedLabels?.tx || {})
        );

        if (
            nextRx.length === stickyAntennaPorts.rx.length &&
            nextTx.length === stickyAntennaPorts.tx.length &&
            nextRx.every((port, idx) => port === stickyAntennaPorts.rx[idx]) &&
            nextTx.every((port, idx) => port === stickyAntennaPorts.tx[idx])
        ) {
            return;
        }

        setStickyAntennaPorts({ rx: nextRx, tx: nextTx });
    }, [
        openAddDialog,
        formValues.antenna_labels,
        formValues.type,
        formValues.host,
        localRtlDevices,
        localUhdDevices,
        localAirspyDevices,
        localSoapyDevices,
        selectedRtlDevice,
        selectedUhdDevice,
        selectedAirspyDevice,
        selectedSdrDevice,
        soapyServers,
        stickyAntennaPorts.rx,
        stickyAntennaPorts.tx,
    ]);

    const handleAntennaLabelChange = (direction, internalPortName, rawLabel) => {
        const portName = String(internalPortName || '').trim();
        if (!portName) return;

        const normalizedLabels = normalizeAntennaLabels(formValues.antenna_labels);
        const nextLabels = { ...normalizedLabels };
        const directionLabels = { ...(nextLabels[direction] || {}) };
        // Keep user spacing while editing.
        const label = String(rawLabel || '').slice(0, MAX_ANTENNA_LABEL_LENGTH);
        directionLabels[portName] = label;

        if (Object.keys(directionLabels).length === 0) {
            delete nextLabels[direction];
        } else {
            nextLabels[direction] = directionLabels;
        }

        dispatch(setFormValues({
            ...formValues,
            antenna_labels: nextLabels,
        }));
    };

    const getPersistedAntennaLabels = () => {
        const normalizedLabels = normalizeAntennaLabels(formValues.antenna_labels);
        const visiblePorts = getVisibleAntennaInfo();
        const persisted = { ...normalizedLabels };

        ['rx', 'tx'].forEach((direction) => {
            const nextDirectionLabels = { ...(persisted[direction] || {}) };
            const ports = Array.isArray(visiblePorts?.[direction]) ? visiblePorts[direction] : [];

            ports.forEach((portNameRaw) => {
                const portName = String(portNameRaw || '').trim();
                if (!portName) return;
                if (!(portName in nextDirectionLabels)) {
                    nextDirectionLabels[portName] = '';
                } else {
                    nextDirectionLabels[portName] = String(nextDirectionLabels[portName] ?? '').slice(
                        0,
                        MAX_ANTENNA_LABEL_LENGTH
                    );
                }
            });

            if (Object.keys(nextDirectionLabels).length > 0) {
                persisted[direction] = nextDirectionLabels;
            } else {
                delete persisted[direction];
            }
        });

        return persisted;
    };

    const handleChange = (e) => {
        const {name, value} = e.target;

        // If changing the SDR type, apply default values for that type
        if (name === 'type') {
            const newType = value;
            const typeConfig = sdrTypeFields[newType];

            if (typeConfig && typeConfig.defaults) {
                // Set excluded fields to null and apply defaults
                const nullifiedExcluded = typeConfig.excludeFields.reduce((acc, field) => {
                    acc[field] = null;
                    return acc;
                }, {});

                dispatch(setFormValues({
                    ...typeConfig.defaults,
                    ...nullifiedExcluded,
                    type: newType,
                    antenna_labels: {},
                }));
            } else {
                // Just update the type if no defaults are defined
                dispatch(setFormValues({...formValues, type: newType, antenna_labels: {}}));
            }

            // Probe local Soapy devices only when the user explicitly selects the local Soapy type.
            if (newType === 'soapysdrlocal') {
                dispatch(fetchLocalSoapySDRDevices({ socket }));
            }
            if (newType === 'airspy' || newType === 'airspyhf') {
                dispatch(fetchLocalAirspyDevices({ socket }));
            }
        } else {
            // Normal field update
            dispatch(setFormValues({...formValues, [name]: value}));
        }

    };

    const handleSubmit = () => {
        const payload = {
            ...formValues,
            antenna_labels: getPersistedAntennaLabels(),
        };

        dispatch(submitOrEditSDR({socket, formValues: payload}))
            .unwrap()
            .then(() => {
                toast.success(t('sdr.saved_success'));
                dispatch(setOpenAddDialog(false));
            })
            .catch((err) => {
                toast.error(err);
            });
    }

    const handleDelete = () => {
        dispatch(deleteSDRs({ socket, selectedIds: selected }))
            .unwrap()
            .then(() => {
                toast.success(t('sdr.deleted_success'));
                dispatch(setOpenDeleteConfirm(false));
            })
            .catch((err) => {
                toast.error(err);
            });
    };

    // Get the field value or its default from the SDR type configuration
    const getFieldValue = (fieldName) => {
        const selectedType = formValues.type;

        // If we have a value in formValues, use it
        if (formValues[fieldName] !== undefined) {
            return formValues[fieldName];
        }

        // Otherwise check for default in the type configuration
        if (selectedType &&
            sdrTypeFields[selectedType] &&
            sdrTypeFields[selectedType].defaults &&
            sdrTypeFields[selectedType].defaults[fieldName] !== undefined) {
            return sdrTypeFields[selectedType].defaults[fieldName];
        }

        // Fallback to empty string/value
        return '';
    };

    const getValidationErrors = () => {
        const errors = {};
        const selectedType = formValues.type || '';
        const config = selectedType ? sdrTypeFields[selectedType] : null;

        if (!selectedType || !config) {
            errors.type = t('shared.required');
            return errors;
        }

        const nameValue = getFieldValue('name');
        if (!String(nameValue || '').trim()) errors.name = t('shared.required');

        if (!config.excludeFields.includes('host')) {
            const hostValue = getFieldValue('host');
            if (!String(hostValue || '').trim()) errors.host = t('shared.required');
        }

        if (!config.excludeFields.includes('port')) {
            const portValue = getFieldValue('port');
            if (portValue === '' || portValue === null || portValue === undefined) {
                errors.port = t('shared.required');
            } else if (Number(portValue) <= 0 || Number(portValue) > 65535) {
                errors.port = t('shared.port_range');
            }
        }
        if (!config.excludeFields.includes('serial')) {
            const serialValue = getFieldValue('serial');
            if (!String(serialValue || '').trim()) errors.serial = t('shared.required');
        }

        const minFreq = getFieldValue('frequency_min');
        const maxFreq = getFieldValue('frequency_max');
        if (minFreq !== '' && Number.isNaN(Number(minFreq))) errors.frequency_min = t('shared.must_be_number');
        if (maxFreq !== '' && Number.isNaN(Number(maxFreq))) errors.frequency_max = t('shared.must_be_number');
        if (minFreq !== '' && maxFreq !== '' && Number(minFreq) > Number(maxFreq)) {
            errors.frequency_min = t('shared.min_lte_max');
            errors.frequency_max = t('shared.min_lte_max');
        }

        return errors;
    };

    const validationErrors = getValidationErrors();
    const hasValidationErrors = Object.keys(validationErrors).length > 0;

    const renderFormFields = () => {
        const selectedType = formValues.type || '';
        const mergedRtlValue = getMergedRtlValue(selectedType);
        const typeSelectValue = mergedRtlValue;
        const rtlGroup = getRtlGroup(selectedType);
        const showRtlVersion = !isEditing && (Boolean(rtlGroup) || isMergedRtlValue(typeSelectValue));
        const rtlVersion = selectedType.endsWith('v3') ? 'v3' : 'v4';
        const antennaPorts = getVisibleAntennaInfo();
        const antennaLabels = normalizeAntennaLabels(formValues.antenna_labels);

        // Define common fields that all SDR types have
        const fields = [];

        if (!isEditing) {
            fields.push(
                <FormControl key="type-select" fullWidth size="small" error={Boolean(validationErrors.type)}>
                    <InputLabel id="sdr-type-label">{t('sdr.sdr_type')}</InputLabel>
                    <Select
                        name="type"
                        labelId="sdr-type-label"
                        label={t('sdr.sdr_type')}
                        size="small"
                        value={typeSelectValue || ''}
                        onChange={(e) => {
                            const nextValue = e.target.value;
                            if (isMergedRtlValue(nextValue)) {
                                const mappedType = nextValue === 'rtlsdrusb' ? 'rtlsdrusbv4' : 'rtlsdrtcpv4';
                                handleChange({target: {name: "type", value: mappedType}});
                            } else {
                                handleChange({target: {name: "type", value: nextValue}});
                            }
                            dispatch(setSelectedSdrDevice('')); // Reset selected SDR when type changes
                            setSelectedRtlDevice('');
                            setSelectedUhdDevice('');
                            setSelectedAirspyDevice('');
                        }}
                    >
                        <MenuItem value="" disabled>{t('sdr.select_sdr_type', 'Select SDR type')}</MenuItem>
                        <MenuItem key="rtlsdrusb" value="rtlsdrusb">{t('sdr.rtlsdr_usb', 'RTL-SDR USB')}</MenuItem>
                        <MenuItem key="rtlsdrtcp" value="rtlsdrtcp">{t('sdr.rtlsdr_tcp', 'RTL-SDR TCP')}</MenuItem>
                        <MenuItem value="soapysdrremote">{t('sdr.soapysdr_remote')}</MenuItem>
                        <MenuItem value="soapysdrlocal">{t('sdr.soapysdr_usb')}</MenuItem>
                        <MenuItem value="uhd">{t('sdr.uhd')}</MenuItem>
                        <MenuItem value="airspy">{t('sdr.airspy', 'Airspy')}</MenuItem>
                        <MenuItem value="airspyhf">{t('sdr.airspy_hf', 'Airspy HF+')}</MenuItem>
                    </Select>
                </FormControl>
            );
        }

        // If a valid SDR type is selected, add the corresponding fields
        if (selectedType && sdrTypeFields[selectedType]) {
            const config = sdrTypeFields[selectedType];
            let renderedPortUnderServerSelect = false;

            if (rtlUsbTypes.has(selectedType) && !isEditing) {
                if (loadingLocalRtlSDRs) {
                    fields.push(
                        <Alert
                            key="loading-rtl-devices"
                            severity="info"
                            sx={{
                                mt: 1,
                                display: 'flex',
                                alignItems: 'center',
                                '& .MuiAlert-message': {
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1
                                }
                            }}
                        >
                            <Box
                                sx={{
                                    display: 'inline-block',
                                    width: '16px',
                                    height: '16px',
                                    border: '2px solid #e3f2fd',
                                    borderTop: '2px solid #1976d2',
                                    borderRadius: '50%',
                                    animation: 'spin 1s linear infinite',
                                    '@keyframes spin': {
                                        '0%': { transform: 'rotate(0deg)' },
                                        '100%': { transform: 'rotate(360deg)' }
                                    }
                                }}
                            />
                            <Typography variant="body2" component="span">
                                {t('sdr.probing_rtl', 'Probing for local RTL-SDR devices...')}
                            </Typography>
                        </Alert>
                    );
                } else {
                    fields.push(
                        <Box key="rtl-controls-row" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <FormControl fullWidth size="small">
                                <InputLabel id="rtl-device-label">{t('sdr.select_rtl_device', 'RTL-SDR Device')}</InputLabel>
                                <Select
                                    labelId="rtl-device-label"
                                    label={t('sdr.select_rtl_device', 'RTL-SDR Device')}
                                    size="small"
                                    value={selectedRtlDevice}
                                    disabled={!localRtlDevices || localRtlDevices.length === 0}
                                    onChange={(e) => {
                                        const selectedIndex = e.target.value;
                                        setSelectedRtlDevice(selectedIndex);

                                        if (selectedIndex !== '') {
                                            const selectedDevice = localRtlDevices[selectedIndex];
                                            if (selectedDevice) {
                                                const newValues = {
                                                    ...formValues,
                                                    name: selectedDevice.label || 'RTL-SDR',
                                                    serial: selectedDevice.serial || ''
                                                };
                                                dispatch(setFormValues(newValues));
                                            }
                                        }
                                    }}
                                >
                                    <MenuItem value="" disabled>{t('sdr.select_sdr')}</MenuItem>
                                    {(localRtlDevices || []).map((device, index) => (
                                        <MenuItem key={index} value={index}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                <MemoryIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                                                <Box component="span">
                                                    {device.label || `RTL-SDR ${index}`}
                                                    {device.serial ? ` :: ${device.serial}` : ''}
                                                </Box>
                                            </Box>
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <Tooltip title={t('sdr.refresh_rtl_devices', 'Refresh RTL-SDR devices')}>
                                <IconButton
                                    size="small"
                                    color="primary"
                                    aria-label={t('sdr.refresh_rtl_devices', 'Refresh RTL-SDR devices')}
                                    onClick={() => dispatch(fetchLocalRtlSdrDevices({ socket }))}
                                >
                                    <RefreshIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    );

                    if (!localRtlDevices || localRtlDevices.length === 0) {
                        fields.push(
                            <Alert key="no-rtl-devices" severity="info" sx={{ mt: 1 }}>
                                {t('sdr.no_rtl_devices', 'No local RTL-SDR devices detected. Please connect a device and refresh.')}
                            </Alert>
                        );
                    }
                }
            }

            // Add a dropdown to select local Soapy USB devices
            if (selectedType === 'soapysdrlocal' && !isEditing) {
                if (loadingLocalSDRs) {
                    fields.push(
                        <Alert
                            key="loading-local-devices"
                            severity="info"
                            sx={{
                                mt: 1,
                                display: 'flex',
                                alignItems: 'center',
                                '& .MuiAlert-message': {
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1
                                }
                            }}
                        >
                            <Box
                                sx={{
                                    display: 'inline-block',
                                    width: '16px',
                                    height: '16px',
                                    border: '2px solid #e3f2fd',
                                    borderTop: '2px solid #1976d2',
                                    borderRadius: '50%',
                                    animation: 'spin 1s linear infinite',
                                    '@keyframes spin': {
                                        '0%': { transform: 'rotate(0deg)' },
                                        '100%': { transform: 'rotate(360deg)' }
                                    }
                                }}
                            />
                            <Typography variant="body2" component="span">
                                {t('sdr.probing_local')}
                            </Typography>
                        </Alert>
                    );
                } else {
                    fields.push(
                        <Box
                            key="local-sdr-controls-row"
                            sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                        >
                            <FormControl fullWidth size="small">
                                <InputLabel id="local-sdr-device-label">{t('sdr.local_sdr_device')}</InputLabel>
                                <Select
                                    labelId="local-sdr-device-label"
                                    label={t('sdr.local_sdr_device')}
                                    size="small"
                                    value={selectedSdrDevice}
                                    disabled={!localSoapyDevices || localSoapyDevices.length === 0}
                                    onChange={(e) => {
                                        const selectedSdrIndex = e.target.value;
                                        dispatch(setSelectedSdrDevice(selectedSdrIndex));

                                        if (selectedSdrIndex !== '') {
                                            const selectedSdr = localSoapyDevices[selectedSdrIndex];

                                            if (selectedSdr) {
                                                // Prepare new form values with SDR device information
                                                const newValues = {
                                                    ...formValues,
                                                    name: selectedSdr.label || 'SoapySDR USB Device',
                                                    driver: selectedSdr.driver || '',
                                                    serial: selectedSdr.serial || ''
                                                };

                                                dispatch(setFormValues(newValues));
                                            }
                                        }
                                    }}
                                >
                                    <MenuItem value="" disabled>{t('sdr.select_sdr')}</MenuItem>
                                    {(localSoapyDevices || []).map((sdr, index) => (
                                        <MenuItem key={index} value={index}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                <MemoryIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                                                <Box component="span">
                                                    {sdr.label || sdr.driver || `SDR Device ${index}`}
                                                    {sdr.serial ? ` :: ${sdr.serial}` : ''}
                                                </Box>
                                            </Box>
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <Tooltip title={t('sdr.refresh_soapy_devices', 'Refresh SoapySDR devices')}>
                                <IconButton
                                    size="small"
                                    color="primary"
                                    aria-label={t('sdr.refresh_soapy_devices', 'Refresh SoapySDR devices')}
                                    onClick={() => dispatch(fetchLocalSoapySDRDevices({ socket }))}
                                >
                                    <RefreshIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    );

                    if (!localSoapyDevices || localSoapyDevices.length === 0) {
                        fields.push(
                            <Alert key="no-local-devices" severity="info" sx={{ mt: 1 }}>
                                {t('sdr.no_soapy_devices')}
                            </Alert>
                        );
                    }
                }
            }

            if (selectedType === 'uhd' && !isEditing) {
                if (loadingLocalUhdSDRs) {
                    fields.push(
                        <Alert
                            key="loading-uhd-devices"
                            severity="info"
                            sx={{
                                mt: 1,
                                display: 'flex',
                                alignItems: 'center',
                                '& .MuiAlert-message': {
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1
                                }
                            }}
                        >
                            <Box
                                sx={{
                                    display: 'inline-block',
                                    width: '16px',
                                    height: '16px',
                                    border: '2px solid #e3f2fd',
                                    borderTop: '2px solid #1976d2',
                                    borderRadius: '50%',
                                    animation: 'spin 1s linear infinite',
                                    '@keyframes spin': {
                                        '0%': { transform: 'rotate(0deg)' },
                                        '100%': { transform: 'rotate(360deg)' }
                                    }
                                }}
                            />
                            <Typography variant="body2" component="span">
                                {t('sdr.probing_uhd', 'Probing for local UHD/USRP devices...')}
                            </Typography>
                        </Alert>
                    );
                } else {
                    fields.push(
                        <Box
                            key="local-uhd-controls-row"
                            sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                        >
                            <FormControl fullWidth size="small">
                                <InputLabel id="local-uhd-device-label">
                                    {t('sdr.select_uhd_device', 'UHD/USRP Device')}
                                </InputLabel>
                                <Select
                                    labelId="local-uhd-device-label"
                                    label={t('sdr.select_uhd_device', 'UHD/USRP Device')}
                                    size="small"
                                    value={selectedUhdDevice}
                                    disabled={!localUhdDevices || localUhdDevices.length === 0}
                                    onChange={(e) => {
                                        const selectedUhdIndex = e.target.value;
                                        setSelectedUhdDevice(selectedUhdIndex);

                                        if (selectedUhdIndex !== '') {
                                            const selectedDevice = localUhdDevices[selectedUhdIndex];

                                            if (selectedDevice) {
                                                const rxRange = selectedDevice?.frequency_ranges?.rx || {};
                                                const parsedMin = Number(rxRange?.min);
                                                const parsedMax = Number(rxRange?.max);

                                                // Keep device-probed metadata in sync with add-dialog form defaults.
                                                const newValues = {
                                                    ...formValues,
                                                    name: selectedDevice.label || 'UHD Device',
                                                    serial: selectedDevice.serial || '',
                                                    frequency_min: Number.isFinite(parsedMin) ? parsedMin : formValues.frequency_min,
                                                    frequency_max: Number.isFinite(parsedMax) ? parsedMax : formValues.frequency_max,
                                                };

                                                dispatch(setFormValues(newValues));
                                            }
                                        }
                                    }}
                                >
                                    <MenuItem value="" disabled>{t('sdr.select_sdr')}</MenuItem>
                                    {(localUhdDevices || []).map((device, index) => (
                                        <MenuItem key={index} value={index}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                <MemoryIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                                                <Box component="span">
                                                    {device.label || `UHD Device ${index}`}
                                                    {device.serial ? ` :: ${device.serial}` : ''}
                                                </Box>
                                            </Box>
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <Tooltip title={t('sdr.refresh_uhd_devices', 'Refresh UHD/USRP devices')}>
                                <IconButton
                                    size="small"
                                    color="primary"
                                    aria-label={t('sdr.refresh_uhd_devices', 'Refresh UHD/USRP devices')}
                                    onClick={() => dispatch(fetchLocalUhdDevices({ socket }))}
                                >
                                    <RefreshIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    );

                    if (!localUhdDevices || localUhdDevices.length === 0) {
                        fields.push(
                            <Alert key="no-uhd-devices" severity="info" sx={{ mt: 1 }}>
                                {t('sdr.no_uhd_devices', 'No local UHD/USRP devices detected. Please connect a device and refresh.')}
                            </Alert>
                        );
                    }
                }
            }

            if ((selectedType === 'airspy' || selectedType === 'airspyhf') && !isEditing) {
                const driverFilter = selectedType === 'airspyhf' ? 'airspyhf' : 'airspy';
                const filteredAirspyDevices = (localAirspyDevices || []).filter((device) =>
                    String(device?.driver || '').toLowerCase() === driverFilter
                );

                if (loadingLocalAirspySDRs) {
                    fields.push(
                        <Alert
                            key="loading-airspy-devices"
                            severity="info"
                            sx={{
                                mt: 1,
                                display: 'flex',
                                alignItems: 'center',
                                '& .MuiAlert-message': {
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1
                                }
                            }}
                        >
                            <Box
                                sx={{
                                    display: 'inline-block',
                                    width: '16px',
                                    height: '16px',
                                    border: '2px solid #e3f2fd',
                                    borderTop: '2px solid #1976d2',
                                    borderRadius: '50%',
                                    animation: 'spin 1s linear infinite',
                                    '@keyframes spin': {
                                        '0%': { transform: 'rotate(0deg)' },
                                        '100%': { transform: 'rotate(360deg)' }
                                    }
                                }}
                            />
                            <Typography variant="body2" component="span">
                                {t('sdr.probing_airspy', 'Probing for local Airspy devices...')}
                            </Typography>
                        </Alert>
                    );
                } else {
                    fields.push(
                        <Box
                            key="local-airspy-controls-row"
                            sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
                        >
                            <FormControl fullWidth size="small">
                                <InputLabel id="local-airspy-device-label">
                                    {t('sdr.select_airspy_device', 'Airspy Device')}
                                </InputLabel>
                                <Select
                                    labelId="local-airspy-device-label"
                                    label={t('sdr.select_airspy_device', 'Airspy Device')}
                                    size="small"
                                    value={selectedAirspyDevice}
                                    disabled={filteredAirspyDevices.length === 0}
                                    onChange={(e) => {
                                        const selectedAirspyIndex = e.target.value;
                                        setSelectedAirspyDevice(selectedAirspyIndex);

                                        if (selectedAirspyIndex !== '') {
                                            const selectedDevice = filteredAirspyDevices[selectedAirspyIndex];
                                            if (selectedDevice) {
                                                const rxRange = selectedDevice?.frequency_ranges?.rx || {};
                                                const parsedMin = Number(rxRange?.min);
                                                const parsedMax = Number(rxRange?.max);
                                                const newValues = {
                                                    ...formValues,
                                                    name: selectedDevice.label || (selectedType === 'airspyhf' ? 'Airspy HF+' : 'Airspy'),
                                                    serial: selectedDevice.serial || '',
                                                    driver: selectedDevice.driver || driverFilter,
                                                    frequency_min: Number.isFinite(parsedMin) ? parsedMin : formValues.frequency_min,
                                                    frequency_max: Number.isFinite(parsedMax) ? parsedMax : formValues.frequency_max,
                                                };
                                                dispatch(setFormValues(newValues));
                                            }
                                        }
                                    }}
                                >
                                    <MenuItem value="" disabled>{t('sdr.select_sdr')}</MenuItem>
                                    {filteredAirspyDevices.map((device, index) => (
                                        <MenuItem key={index} value={index}>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                <MemoryIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                                                <Box component="span">
                                                    {device.label || device.driver || `Airspy ${index}`}
                                                    {device.serial ? ` :: ${device.serial}` : ''}
                                                </Box>
                                            </Box>
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <Tooltip title={t('sdr.refresh_airspy_devices', 'Refresh Airspy devices')}>
                                <IconButton
                                    size="small"
                                    color="primary"
                                    aria-label={t('sdr.refresh_airspy_devices', 'Refresh Airspy devices')}
                                    onClick={() => dispatch(fetchLocalAirspyDevices({ socket }))}
                                >
                                    <RefreshIcon fontSize="small" />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    );

                    if (filteredAirspyDevices.length === 0) {
                        fields.push(
                            <Alert key="no-airspy-devices" severity="info" sx={{ mt: 1 }}>
                                {t(
                                    'sdr.no_airspy_devices',
                                    'No local Airspy devices detected. Please connect a device and refresh.'
                                )}
                            </Alert>
                        );
                    }
                }
            }

            // Host field - only show for types that don't exclude it
            if (!config.excludeFields.includes('host')) {
                if (selectedType === 'soapysdrremote' && isEditing) {
                    const selectedServerInfo = getSelectedSoapyServerInfo();
                    const hostIp = String(formValues.host || '');
                    const portValue = formValues.port ?? '';
                    const endpointLabel = hostIp && portValue !== '' ? `${hostIp}:${portValue}` : hostIp;
                    const serverDisplayName = toDisplayServerName(selectedServerInfo?.name || '');
                    const hostDisplayValue = serverDisplayName
                        ? `${serverDisplayName}/${endpointLabel}`
                        : endpointLabel;

                    fields.push(
                        <TextField
                            key="host-readonly"
                            name="host"
                            label={t('sdr.soapysdr_server')}
                            fullWidth
                            size="small"
                            value={hostDisplayValue}
                            disabled
                        />
                    );
                } else if (selectedType === 'soapysdrremote' && soapyServers && Object.keys(soapyServers).length > 0) {
                    // For SoapySDRRemote, create a dropdown of available servers
                    fields.push(
                        <FormControl key="host-select" fullWidth size="small">
                            <InputLabel id="host-label">{t('sdr.soapysdr_server')}</InputLabel>
                            <Select
                                name="host"
                                labelId="host-label"
                                label={t('sdr.soapysdr_server')}
                                size="small"
                                value={formValues.host || ''}
                                onChange={(e) => {
                                    const serverIp = e.target.value;
                                    const selectedServerEntry = Object.entries(soapyServers).find(([_, server]) => server.ip === serverIp);
                                    const serverInfo = selectedServerEntry ? selectedServerEntry[1] : {};
                                    
                                    // Reset selected SDR when server changes
                                    dispatch(setSelectedSdrDevice(''));

                                    // Use a single dispatch call with all values that need to be updated
                                    dispatch(setFormValues({
                                        ...formValues,
                                        host: serverInfo.ip || '',
                                        port: serverInfo.port || 1234
                                    }));
                                }}
            >
                                {Object.entries(soapyServers).map(([key, server]) => {
                                    const hostLabel = toDisplayServerName(server?.name || key || 'server');
                                    const endpointLabel = `${server?.ip || ''}:${server?.port || ''}`;
                                    const displayKey = toDisplayServerName(key);
                                    const extraDetails = [
                                        displayKey && displayKey !== hostLabel ? displayKey : null,
                                        server?.status ? `status=${server.status}` : null,
                                        `${Array.isArray(server?.sdrs) ? server.sdrs.length : 0} SDRs`,
                                    ]
                                        .filter(Boolean)
                                        .join(' | ');

                                    return (
                                    <MenuItem key={key} value={server.ip}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <DnsIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                                            <Box component="span">
                                                {`${hostLabel}/${endpointLabel} (${extraDetails})`}
                                            </Box>
                                        </Box>
                                    </MenuItem>
                                    );
                                })}
                            </Select>
                        </FormControl>
                    );

                    // Keep the remote port directly under the server selector so endpoint fields stay grouped.
                    fields.push(
                        <TextField
                            key="remote-port-under-server-select"
                            name="port"
                            label={t('sdr.port')}
                            fullWidth
                            size="small"
                            type="number"
                            onChange={handleChange}
                            value={getFieldValue('port')}
                            error={Boolean(validationErrors.port)}
                            required
                        />
                    );
                    renderedPortUnderServerSelect = true;

                    // If a server is selected, add a dropdown to select SDR devices from that server
                    if (formValues.host && !isEditing) {
                        const selectedServerInfo = getSelectedSoapyServerInfo();
                        
                        if (selectedServerInfo && selectedServerInfo.sdrs && selectedServerInfo.sdrs.length > 0) {
                            fields.push(
                                <FormControl key="sdr-device-select" fullWidth size="small">
                                    <InputLabel id="sdr-device-label">{t('sdr.sdr_device')}</InputLabel>
                                    <Select
                                        labelId="sdr-device-label"
                                        label={t('sdr.sdr_device')}
                                        size="small"
                                        value={selectedSdrDevice}
                                        onChange={(e) => {
                                            const selectedSdrIndex = e.target.value;
                                            dispatch(setSelectedSdrDevice(selectedSdrIndex));
                                            
                                            if (selectedSdrIndex !== '') {
                                                const selectedSdr = selectedServerInfo.sdrs[selectedSdrIndex];
                                                
                                                if (selectedSdr) {
                                                    // Prepare new form values with SDR device information
                                                    const newValues = {
                                                        ...formValues,
                                                        name: selectedSdr.label || 'SoapySDR Device',
                                                        driver: selectedSdr['remote:driver'] || selectedSdr.driver || '',
                                                        serial: selectedSdr.serial || ''
                                                    };
                                                    
                                                    dispatch(setFormValues(newValues));
                                                }
                                            }
                                        }}
                    >
                                        <MenuItem value="" disabled>{t('sdr.select_sdr')}</MenuItem>
                                        {selectedServerInfo.sdrs.map((sdr, index) => (
                                            <MenuItem key={index} value={index}>
                                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                    <MemoryIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                                                    <Box component="span">
                                                        {sdr.label || sdr.driver || `SDR Device ${index}`}
                                                        {sdr.serial ? ` :: ${sdr.serial}` : ''}
                                                    </Box>
                                                </Box>
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                            );
                        }
                    }
                } else {
                    fields.push(
                        <TextField
                            key="host"
                            name="host"
                            label={t('sdr.host')}
                            fullWidth
                            size="small"
                            onChange={handleChange}
                            value={getFieldValue('host')}
                            error={Boolean(validationErrors.host)}
                            required
                        />
                    );
                }
            }

            // Port field - only show for types that don't exclude it
            if (!config.excludeFields.includes('port') && !renderedPortUnderServerSelect) {
                fields.push(
                    <TextField
                        key="port"
                        name="port"
                        label={t('sdr.port')}
                        fullWidth
                        size="small"
                        type="number"
                        onChange={handleChange}
                        value={getFieldValue('port')}
                        error={Boolean(validationErrors.port)}
                        disabled={isEditing && selectedType === 'soapysdrremote'}
                        required
                    />
                );
            }

            // Add the common fields that all types have
            fields.push(
                <TextField
                    key="name"
                    name="name"
                    label={t('sdr.name')}
                    fullWidth
                    size="small"
                    onChange={handleChange}
                    value={getFieldValue('name')}
                    error={Boolean(validationErrors.name)}
                    required
                />
            );

            if (showRtlVersion) {
                fields.push(
                    <Box
                        key="rtl-version-toggle"
                        sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.25 }}
                    >
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                            {t('sdr.rtlsdr_version', 'RTL-SDR Version')}
                        </Typography>
                        <ToggleButtonGroup
                            exclusive
                            size="small"
                            value={rtlVersion}
                            onChange={(_, value) => {
                                if (!value) return;
                                const group = rtlGroup || (typeSelectValue === 'rtlsdrtcp' ? 'tcp' : 'usb');
                                const mappedType = group === 'tcp'
                                    ? (value === 'v3' ? 'rtlsdrtcpv3' : 'rtlsdrtcpv4')
                                    : (value === 'v3' ? 'rtlsdrusbv3' : 'rtlsdrusbv4');
                                handleChange({target: {name: "type", value: mappedType}});
                            }}
                            sx={{
                                '& .MuiToggleButton-root': {
                                    minWidth: 64,
                                    px: 2,
                                    textTransform: 'none',
                                    fontWeight: 600,
                                    borderColor: 'divider',
                                },
                            }}
                        >
                            <ToggleButton value="v3">v3</ToggleButton>
                            <ToggleButton value="v4">v4</ToggleButton>
                        </ToggleButtonGroup>
                    </Box>
                );
            }

            fields.push(
                <Box
                    key="frequency-row"
                    sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                        gap: 1.5,
                    }}
                >
                    <TextField
                        name="frequency_min"
                        label={t('sdr.min_frequency_mhz')}
                        fullWidth
                        size="small"
                        type="number"
                        onChange={handleChange}
                        value={getFieldValue('frequency_min')}
                        error={Boolean(validationErrors.frequency_min)}
                        InputProps={{ endAdornment: <InputAdornment position="end">MHz</InputAdornment> }}
                    />
                    <TextField
                        name="frequency_max"
                        label={t('sdr.max_frequency_mhz')}
                        fullWidth
                        size="small"
                        type="number"
                        onChange={handleChange}
                        value={getFieldValue('frequency_max')}
                        error={Boolean(validationErrors.frequency_max)}
                        InputProps={{ endAdornment: <InputAdornment position="end">MHz</InputAdornment> }}
                    />
                </Box>
            );

            // Driver field - only show for types that don't exclude it
            if (!config.excludeFields.includes('driver')) {
                fields.push(
                    <TextField
                        key="driver"
                        name="driver"
                        label={t('sdr.driver')}
                        fullWidth
                        size="small"
                        onChange={handleChange}
                        value={getFieldValue('driver')}
                    />
                );
            }

            // Serial field - only show for types that don't exclude it
            if (!config.excludeFields.includes('serial')) {
                fields.push(
                    <TextField
                        key="serial"
                        name="serial"
                    label={t('sdr.serial')}
                    fullWidth
                    size="small"
                    onChange={handleChange}
                    value={getFieldValue('serial')}
                    error={Boolean(validationErrors.serial)}
                    required
                />
                );
            }

            const hasProbeAntennaPorts = antennaPorts.rx.length > 0 || antennaPorts.tx.length > 0;
            const hasSelectedProbedDevice =
                (rtlUsbTypes.has(selectedType) && selectedRtlDevice !== '') ||
                (selectedType === 'uhd' && selectedUhdDevice !== '') ||
                ((selectedType === 'airspy' || selectedType === 'airspyhf') && selectedAirspyDevice !== '') ||
                ((selectedType === 'soapysdrlocal' || selectedType === 'soapysdrremote') &&
                    selectedSdrDevice !== '');
            if (hasSelectedProbedDevice && !hasProbeAntennaPorts) {
                fields.push(
                    <Alert key="no-antenna-ports" severity="warning" sx={{ mt: 1 }}>
                        {t(
                            'sdr.no_antenna_ports_found',
                            'No antenna ports were returned by the selected device.'
                        )}
                    </Alert>
                );
            }

            if (hasProbeAntennaPorts) {
                const directions = [
                    { key: 'rx', label: t('sdr.rx_antenna_ports', 'RX Antenna Ports') },
                    { key: 'tx', label: t('sdr.tx_antenna_ports', 'TX Antenna Ports') },
                ];

                fields.push(
                    <Box
                        key="antenna-labels-section"
                        sx={{
                            border: (theme) => `1px solid ${theme.palette.divider}`,
                            borderRadius: 1.25,
                            p: 2,
                            backgroundColor: (theme) =>
                                theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.015)',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 1.75,
                        }}
                    >
                        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                            {t('sdr.antenna_labels_title', 'Antenna Port Labels')}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: -0.5 }}>
                            {t(
                                'sdr.antenna_labels_subtitle',
                                'Internal port names are probed from hardware. Labels are your own reminders.'
                            )}
                        </Typography>
                        {directions.map((direction) => {
                            const ports = antennaPorts[direction.key] || [];
                            if (ports.length === 0) return null;

                            return (
                                <Box
                                    key={`antenna-labels-${direction.key}`}
                                    sx={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 1,
                                        border: (theme) => `1px solid ${theme.palette.divider}`,
                                        borderRadius: 1,
                                        p: 1.25,
                                        backgroundColor: 'background.paper',
                                    }}
                                >
                                    <Typography
                                        variant="caption"
                                        sx={{ color: 'text.secondary', fontWeight: 700, letterSpacing: '0.02em' }}
                                    >
                                        {direction.label}
                                    </Typography>
                                    {ports.map((portName) => (
                                        <Box
                                            key={`${direction.key}-${portName}`}
                                            sx={{
                                                display: 'grid',
                                                gridTemplateColumns: 'minmax(150px, 220px) 1fr',
                                                gap: 1.5,
                                                alignItems: 'center',
                                            }}
                                        >
                                            <Box
                                                sx={{
                                                    fontFamily: 'monospace',
                                                    fontSize: '0.8125rem',
                                                    color: 'text.secondary',
                                                    border: (theme) => `1px solid ${theme.palette.divider}`,
                                                    borderRadius: 0.75,
                                                    px: 1,
                                                    py: 0.75,
                                                    backgroundColor: (theme) =>
                                                        theme.palette.mode === 'dark'
                                                            ? 'rgba(255,255,255,0.03)'
                                                            : 'rgba(0,0,0,0.02)',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap',
                                                }}
                                                title={portName}
                                            >
                                                {portName}
                                            </Box>
                                            <TextField
                                                size="small"
                                                label={t('sdr.antenna_label', 'Label')}
                                                placeholder={portName}
                                                value={antennaLabels?.[direction.key]?.[portName] ?? ''}
                                                onChange={(e) =>
                                                    handleAntennaLabelChange(
                                                        direction.key,
                                                        portName,
                                                        e.target.value
                                                    )
                                                }
                                                inputProps={{ maxLength: MAX_ANTENNA_LABEL_LENGTH }}
                                            />
                                        </Box>
                                    ))}
                                </Box>
                            );
                        })}
                    </Box>
                );
            }


        }

        return fields;
    };
    return (
        <Paper
            elevation={3}
            sx={{
                px: 2,
                pb: 2,
                pt: 2,
                marginTop: 0,
                borderRadius: 0,
                display: 'flex',
                flexDirection: 'column',
            }}
        >
            <Paper
                variant="outlined"
                sx={{
                    mt: 2,
                    borderRadius: 2,
                    borderColor: 'divider',
                    overflow: 'hidden',
                    order: 2,
                }}
            >
                {/* Card Header */}
                <Box
                    sx={{
                        px: { xs: 2, md: 2.5 },
                        py: 1.75,
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        backgroundColor: (theme) =>
                            theme.palette.mode === 'dark'
                                ? alpha(theme.palette.primary.main, 0.07)
                                : alpha(theme.palette.primary.main, 0.04),
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexWrap: 'wrap',
                        gap: 1.5,
                    }}
                >
                    <Stack direction="row" spacing={1.5} alignItems="center">
                        <Box
                            sx={{
                                width: 36,
                                height: 36,
                                borderRadius: 1.5,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: 'primary.main',
                                backgroundColor: (theme) =>
                                    theme.palette.mode === 'dark'
                                        ? alpha(theme.palette.primary.main, 0.22)
                                        : alpha(theme.palette.primary.main, 0.12),
                                flexShrink: 0,
                            }}
                        >
                            <DnsIcon sx={{ fontSize: 20 }} />
                        </Box>
                        <Box>
                            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
                                {t('sdr.soapy_discovery_title', 'SoapySDR Discovery')}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>
                                {t(
                                    'sdr.soapy_discovery_subtitle',
                                    'Discover SoapySDR servers and monitor discovery task status.'
                                )}
                            </Typography>
                        </Box>
                    </Stack>
                    <Button
                        variant="contained"
                        color="primary"
                        size="small"
                        startIcon={<RefreshIcon fontSize="small" />}
                        disabled={discovering || isSoapyServerDiscoveryRunning || loading}
                        onClick={handleStartSoapyDiscovery}
                        sx={{ flexShrink: 0 }}
                    >
                        {(discovering || isSoapyServerDiscoveryRunning)
                            ? t('sdr.discovering_servers', 'Discovering...')
                            : t('sdr.discover_servers', 'Discover SoapySDR Servers')}
                    </Button>
                </Box>

                {/* Card Body */}
                <Box sx={{ px: { xs: 2, md: 2.5 }, pt: 1.75, pb: 2 }}>

                    {/* Status row */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.75 }}>
                        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500, flexShrink: 0 }}>
                            {t('sdr.discovery_status_label', 'Status')}
                        </Typography>
                        {activeSoapyDiscoveryTask ? (
                            activeSoapyDiscoveryTask.status === 'running' ? (
                                <Chip size="small" color="info" icon={<PendingActionsIcon />} label={t('sdr.task_running', 'Running')} />
                            ) : activeSoapyDiscoveryTask.status === 'completed' ? (
                                <Chip size="small" color="success" icon={<CheckCircleOutlineIcon />} label={t('sdr.task_completed', 'Completed')} />
                            ) : activeSoapyDiscoveryTask.status === 'failed' ? (
                                <Chip size="small" color="error" icon={<ErrorOutlineIcon />} label={t('sdr.task_failed', 'Failed')} />
                            ) : (
                                <Chip size="small" color="warning" icon={<CancelIcon />} label={t('sdr.task_stopped', 'Stopped')} />
                            )
                        ) : (
                            <Chip size="small" variant="outlined" label={t('sdr.task_idle', 'Idle')} />
                        )}
                        {activeSoapyDiscoveryTask && (
                            <Typography variant="caption" color="text.disabled" sx={{ fontFamily: 'monospace', ml: 'auto' }}>
                                {formatTaskDuration(discoveryTaskDurationMs)}
                            </Typography>
                        )}
                    </Box>

                    {/* Progress bar */}
                    {activeSoapyDiscoveryTask?.status === 'running' && (
                        activeSoapyDiscoveryTask.progress !== undefined && activeSoapyDiscoveryTask.progress !== null ? (
                            <LinearProgress variant="determinate" value={activeSoapyDiscoveryTask.progress} sx={{ height: 3, borderRadius: 999, mb: 0.75 }} />
                        ) : (
                            <LinearProgress sx={{ height: 3, borderRadius: 999, mb: 0.75 }} />
                        )
                    )}

                    {/* Last output or idle hint */}
                    {activeSoapyDiscoveryTask ? (
                        discoveryTaskLastOutput ? (
                            <Stack direction="row" spacing={0.75} alignItems="baseline" sx={{ mb: 0.5 }}>
                                <Typography variant="caption" color="text.disabled" sx={{ fontWeight: 600, flexShrink: 0 }}>
                                    {t('sdr.last_output_label', 'Output:')}
                                </Typography>
                                <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    sx={{ fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
                                    title={discoveryTaskLastOutput}
                                >
                                    {discoveryTaskLastOutput}
                                </Typography>
                            </Stack>
                        ) : null
                    ) : (
                        <Typography variant="caption" color="text.disabled" sx={{ mb: 0.5, display: 'block' }}>
                            {t('sdr.discovery_not_started', 'No discovery task has run yet in this session.')}
                        </Typography>
                    )}

                    <Divider sx={{ my: 1.75 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.6 }}>
                                {t('sdr.discovered_servers')}
                            </Typography>
                            {hasDiscoveredSoapyServers && (
                                <Chip size="small" color="primary" variant="outlined" label={soapyServerEntries.length} sx={{ height: 18, fontSize: '0.7rem', minWidth: 28 }} />
                            )}
                        </Box>
                    </Divider>

                    {/* Server list */}
                    {hasDiscoveredSoapyServers ? (
                        <Stack spacing={0} divider={<Divider />}>
                            {soapyServerEntries.map(([key, server]) => {
                                const name = toDisplayServerName(server?.name || key);
                                const ip = server?.ip || '-';
                                const port = server?.port || '-';
                                const sdrCount = Array.isArray(server?.sdrs) ? server.sdrs.length : 0;
                                return (
                                    <Box
                                        key={key}
                                        sx={{
                                            py: 0.9,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'space-between',
                                            gap: 1.5,
                                        }}
                                    >
                                        <Box sx={{ minWidth: 0 }}>
                                            <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                                                {name}
                                            </Typography>
                                            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }} noWrap>
                                                {`${ip}:${port}`}
                                            </Typography>
                                        </Box>
                                        <Chip
                                            size="small"
                                            color={sdrCount > 0 ? 'primary' : 'default'}
                                            variant="outlined"
                                            label={t('sdr.server_device_count', '{{count}} SDR(s)', { count: sdrCount })}
                                            sx={{ flexShrink: 0 }}
                                        />
                                    </Box>
                                );
                            })}
                        </Stack>
                    ) : (
                        <Typography variant="caption" color="text.disabled">
                            {t('sdr.no_discovered_servers_hint', 'No SoapySDR servers discovered yet. Run discovery to populate this list.')}
                        </Typography>
                    )}

                </Box>
            </Paper>
            <Box component="form" sx={{ mt: 0, order: 1 }}>
                <Box sx={{width: '100%'}}>
                    <DataGrid
                        loading={loading}
                        rows={sdrs
                            .filter(row => row.type !== 'sigmfplayback')}
                        columns={columns}
                        checkboxSelection
                        disableRowSelectionExcludeModel
                        onRowSelectionModelChange={(selected) => {
                            setSelected(toSelectedIds(selected));
                        }}
                        initialState={{
                            pagination: {paginationModel: {pageSize: 10}},
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
                            noRowsLabel: t('sdr.no_sdrs')
                        }}
                        sx={{
                            border: 0,
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
                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                                <Button
                                    variant="contained"
                                    onClick={() => {
                                        dispatch(resetFormValues());
                                        dispatch(setSelectedSdrDevice(''));
                                        dispatch(setOpenAddDialog(true));
                                    }}
                                    disabled={loading}
                                >
                                    {t('sdr.add')}
                                </Button>
                                <Button
                                    variant="contained"
                                    disabled={selected.length !== 1 || loading}
                                    onClick={() => {
                                        const selectedRow = sdrs.find(row => row.id === selected[0]);
                                        if (selectedRow) {
                                            dispatch(setFormValues({
                                                ...selectedRow,
                                                antenna_labels: normalizeAntennaLabels(selectedRow.antenna_labels),
                                            }));
                                            dispatch(setOpenAddDialog(true));
                                        }
                                    }}
                                >
                                    {t('sdr.edit')}
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
                                    {t('sdr.delete')}
                                </Button>
                            </Stack>
                        }
                    />
                    <Alert severity="info" sx={{ mt: 2 }}>
                        <AlertTitle>{t('sdr.title')}</AlertTitle>
                        {t('sdr.subtitle')}
                    </Alert>
                    <Stack direction="row" spacing={2} style={{marginTop: 15}}>
                        <Dialog
                            fullWidth={true}
                            open={openAddDialog}
                            onClose={() => dispatch(setOpenAddDialog(false))}
                            PaperProps={{
                                sx: {
                                    position: 'relative',
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
                                {isEditing ? t('sdr.edit_dialog_title') : t('sdr.add_dialog_title')}
                            </DialogTitle>
                            <DialogContent sx={{ px: 3, py: 3 }}>
                                <Box
                                    component="fieldset"
                                    disabled={isDialogFormInputsDisabled}
                                    sx={{
                                        border: 0,
                                        padding: 0,
                                        margin: 0,
                                        minWidth: 0,
                                    }}
                                >
                                    <Stack spacing={2} sx={{ mt: 3 }}>
                                        {renderFormFields()}
                                    </Stack>
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
                                    onClick={() => dispatch(setOpenAddDialog(false))}
                                    variant="outlined"
                                    sx={{
                                        borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.700' : 'grey.400',
                                        '&:hover': {
                                            borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.600' : 'grey.500',
                                            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.200',
                                        },
                                    }}
                                >
                                    {t('sdr.cancel')}
                                </Button>
                                <Button
                                    color="success"
                                    variant="contained"
                                    onClick={handleSubmit}
                                    disabled={hasValidationErrors || loading}
                                >
                                    {t('sdr.submit')}
                                </Button>
                            </DialogActions>
                            {showSoapyDiscoveryOverlay && (
                                <Box
                                    sx={{
                                        position: 'absolute',
                                        inset: 0,
                                        zIndex: 2,
                                        backgroundColor: (theme) =>
                                            theme.palette.mode === 'dark'
                                                ? 'rgba(0, 0, 0, 0.65)'
                                                : 'rgba(255, 255, 255, 0.65)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                                        <CircularProgress size={40} />
                                        <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                            {t(
                                                'sdr.waiting_for_soapy_discovery',
                                                'Waiting for SoapySDR server discovery to complete...'
                                            )}
                                        </Typography>
                                    </Box>
                                </Box>
                            )}
                        </Dialog>
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
                                {t('sdr.confirm_deletion')}
                            </DialogTitle>
                            <DialogContent sx={{ px: 3, pt: 3, pb: 3 }}>
                                <Typography variant="body1" sx={{ mt: 2, mb: 2, color: 'text.primary' }}>
                                    {t('sdr.confirm_delete_message')}
                                </Typography>
                                <Typography variant="body2" sx={{ mb: 2, fontWeight: 600, color: 'text.secondary' }}>
                                    {selected.length === 1
                                        ? t('sdr.delete_list_single')
                                        : t('sdr.delete_list_plural', { count: selected.length })}
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
                                        const sdr = sdrs.find(s => s.id === id);
                                        if (!sdr) return null;
                                        return (
                                            <Box
                                                key={id}
                                                sx={{
                                                    p: 2,
                                                    borderBottom: index < selected.length - 1 ? (theme) => `1px solid ${theme.palette.divider}` : 'none',
                                                }}
                                            >
                                                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: 'text.primary' }}>
                                                    {sdr.name}
                                                </Typography>
                                                <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 1, columnGap: 2 }}>
                                                    <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                                        {t('sdr.type')}:
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                                        {getTypeLabel(sdr.type)}
                                                    </Typography>

                                                    {sdr.host && sdr.host !== '-' && (
                                                        <>
                                                            <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                                                {t('sdr.host')}:
                                                            </Typography>
                                                            <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                                                {sdr.host}{sdr.port && sdr.port !== '-' ? `:${sdr.port}` : ''}
                                                            </Typography>
                                                        </>
                                                    )}

                                                    {sdr.serial && sdr.serial !== '-' && (
                                                        <>
                                                            <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                                                {t('sdr.serial')}:
                                                            </Typography>
                                                            <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                                                {sdr.serial}
                                                            </Typography>
                                                        </>
                                                    )}

                                                    <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                                        {t('sdr.frequency_range')}:
                                                    </Typography>
                                                    <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                                        {sdr.frequency_min} - {sdr.frequency_max} MHz
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
                                    {t('sdr.cancel')}
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
                                    {t('sdr.delete')}
                                </Button>
                            </DialogActions>
                        </Dialog>
                    </Stack>
                </Box>
            </Box>
        </Paper>
    );
}
