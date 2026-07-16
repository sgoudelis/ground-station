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

import React, { useState, useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Typography,
    Box,
    Stack,
    TextField,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Checkbox,
    FormControlLabel,
    Chip,
    Divider,
    IconButton,
    ListSubheader,
    CircularProgress,
    Backdrop,
    Menu,
    List,
    ListItemButton,
    ListItemText,
    Tabs,
    Tab,
    Switch,
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon, ExpandMore as ExpandMoreIcon, ErrorOutline as ErrorOutlineIcon } from '@mui/icons-material';
import {
    setMonitoredSatelliteDialogOpen,
    createMonitoredSatellite,
    updateMonitoredSatelliteAsync,
    setSatelliteId,
    setGroupId,
    setGroupOfSats,
    setSelectedFromSearch,
    fetchSDRParameters,
} from './scheduler-slice.jsx';
import { useSocket } from '../common/socket.jsx';
import { SatelliteSelector } from './satellite-selector.jsx';
import { SATDUMP_PIPELINES, getDecoderParameters, getDecoderDefaultParameters } from '../waterfall/decoder-parameters.js';
import { DecoderConfigSuggestion } from './decoder-config-suggestion.jsx';

const DECODER_TYPES = [
    { value: 'none', labelKey: 'decoder_type_none' },
    { value: 'fsk', labelKey: 'decoder_type_fsk' },
    { value: 'gmsk', labelKey: 'decoder_type_gmsk' },
    { value: 'gfsk', labelKey: 'decoder_type_gfsk' },
    { value: 'bpsk', labelKey: 'decoder_type_bpsk' },
    { value: 'sstv', labelKey: 'decoder_type_sstv' },
];

const SSTV_DEFAULT_BANDWIDTH = 12500;

const DEMODULATOR_TYPES = [
    { value: 'fm', labelKey: 'demodulator_fm' },
    { value: 'am', labelKey: 'demodulator_am' },
    { value: 'usb', labelKey: 'demodulator_usb' },
    { value: 'lsb', labelKey: 'demodulator_lsb' },
    { value: 'cw', labelKey: 'demodulator_cw' },
];

const MODULATION_TYPES = [
    { value: 'fm', labelKey: 'modulation_fm' },
    { value: 'am', labelKey: 'modulation_am' },
    { value: 'ssb', labelKey: 'modulation_ssb' },
    { value: 'cw', labelKey: 'modulation_cw' },
    { value: 'fsk', labelKey: 'modulation_fsk' },
    { value: 'psk', labelKey: 'modulation_psk' },
];

const BAND_ORDER = ['hf', 'vhf', 'uhf', 'l_band', 's_band', 'c_band', 'x_band', 'other'];

const SAMPLE_RATES = [
    { value: 500000, label: '500 kHz' },
    { value: 1000000, label: '1 MHz' },
    { value: 2000000, label: '2 MHz' },
    { value: 2400000, label: '2.4 MHz' },
    { value: 3000000, label: '3 MHz' },
    { value: 4000000, label: '4 MHz' },
    { value: 5000000, label: '5 MHz' },
    { value: 6000000, label: '6 MHz' },
    { value: 8000000, label: '8 MHz' },
    { value: 10000000, label: '10 MHz' },
    { value: 12000000, label: '12 MHz' },
    { value: 16000000, label: '16 MHz' },
];

const TRANSCRIPTION_LANGUAGE_OPTIONS = [
    { value: 'en', icon: '🇬🇧', labelKey: 'language_english' },
    { value: 'el', icon: '🇬🇷', labelKey: 'language_greek' },
    { value: 'es', icon: '🇪🇸', labelKey: 'language_spanish' },
    { value: 'fr', icon: '🇫🇷', labelKey: 'language_french' },
    { value: 'de', icon: '🇩🇪', labelKey: 'language_german' },
    { value: 'it', icon: '🇮🇹', labelKey: 'language_italian' },
    { value: 'pt', icon: '🇵🇹', labelKey: 'language_portuguese' },
    { value: 'pt-BR', icon: '🇧🇷', labelKey: 'language_portuguese_brazil' },
    { value: 'ru', icon: '🇷🇺', labelKey: 'language_russian' },
    { value: 'uk', icon: '🇺🇦', labelKey: 'language_ukrainian' },
    { value: 'ja', icon: '🇯🇵', labelKey: 'language_japanese' },
    { value: 'zh', icon: '🇨🇳', labelKey: 'language_chinese' },
    { value: 'ar', icon: '🇸🇦', labelKey: 'language_arabic' },
    { value: 'tl', icon: '🇵🇭', labelKey: 'language_filipino' },
    { value: 'tr', icon: '🇹🇷', labelKey: 'language_turkish' },
    { value: 'sk', icon: '🇸🇰', labelKey: 'language_slovak' },
    { value: 'hr', icon: '🇭🇷', labelKey: 'language_croatian' },
];

const SOURCE_LANGUAGE_OPTIONS = [
    { value: 'auto', icon: '🌐', labelKey: 'language_auto_detect' },
    ...TRANSCRIPTION_LANGUAGE_OPTIONS,
];

const TRANSLATION_TARGET_OPTIONS = [
    { value: 'none', icon: '⭕', labelKey: 'no_translation' },
    ...TRANSCRIPTION_LANGUAGE_OPTIONS,
];

const TRANSCRIPTION_PROVIDER_OPTIONS = [
    { value: 'gemini', labelKey: 'provider_gemini' },
    { value: 'deepgram', labelKey: 'provider_deepgram' },
];

const createEmptySession = () => ({
    sdr: {
        id: '',
        name: '',
        sample_rate: 1000000,
        gain: '',
        antenna_port: '',
        center_frequency: 0,
        auto_center_frequency: true,
        bias_t: false,
    },
    tasks: [],
});

const formatSampleRate = (rate) => {
    if (!rate) return '';
    if (rate >= 1000000) {
        const decimals = rate % 1000000 === 0 ? 0 : 1;
        return `${(rate / 1000000).toFixed(decimals)} MHz`;
    }
    return `${(rate / 1000).toFixed(0)} kHz`;
};

const getDecimationOptions = (sampleRate) => {
    if (!sampleRate || sampleRate <= 0) return [1];
    const maxFactor = Math.min(40, Math.floor(sampleRate / 1000));
    const options = [];
    for (let factor = 1; factor <= maxFactor; factor += 1) {
        if (sampleRate % factor === 0) {
            options.push(factor);
        }
    }
    return options.length > 0 ? options : [1];
};

const getDefaultSatdumpPipeline = () => {
    const group = Object.values(SATDUMP_PIPELINES).find((entry) => entry?.pipelines?.length);
    return group?.pipelines?.[0]?.value || '';
};

// Helper function to determine band from frequency in Hz
const getBand = (frequencyHz) => {
    const freqMHz = frequencyHz / 1000000;
    if (freqMHz >= 30 && freqMHz < 300) return 'vhf';
    if (freqMHz >= 300 && freqMHz < 1000) return 'uhf';
    if (freqMHz >= 1000 && freqMHz < 2000) return 'l_band';
    if (freqMHz >= 2000 && freqMHz < 4000) return 's_band';
    if (freqMHz >= 4000 && freqMHz < 8000) return 'c_band';
    if (freqMHz >= 8000 && freqMHz < 12000) return 'x_band';
    if (freqMHz < 30) return 'hf';
    return 'other';
};

// Helper function to group transmitters by band
const groupTransmittersByBand = (transmitters) => {
    const grouped = {};

    transmitters.forEach(transmitter => {
        const band = getBand(transmitter.downlink_low || 0);
        if (!grouped[band]) {
            grouped[band] = [];
        }
        grouped[band].push(transmitter);
    });

    // Sort transmitters within each band by frequency
    Object.keys(grouped).forEach(band => {
        grouped[band].sort((a, b) => (a.downlink_low || 0) - (b.downlink_low || 0));
    });

    // Return bands in order
    return BAND_ORDER
        .filter(band => grouped[band])
        .map(band => ({ band, transmitters: grouped[band] }));
};

export default function MonitoredSatelliteDialog() {
    const dispatch = useDispatch();
    const { t } = useTranslation('common');
    const { socket } = useSocket();
    const open = useSelector((state) => state.scheduler?.monitoredSatelliteDialogOpen || false);
    const selectedMonitoredSatellite = useSelector((state) => state.scheduler?.selectedMonitoredSatellite);
    const isEditingMonitoredSatellite = Boolean(selectedMonitoredSatellite?.id);
    const sdrs = useSelector((state) => state.sdrs?.sdrs || []);
    const selectedSatelliteId = useSelector((state) => state.scheduler?.satelliteSelection?.satelliteId);
    const selectedGroupId = useSelector((state) => state.scheduler?.satelliteSelection?.groupId);
    const groupOfSats = useSelector((state) => state.scheduler?.satelliteSelection?.groupOfSats || []);
    const rotators = useSelector((state) => state.rotators?.rotators || []);
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
    const satGroups = useSelector((state) => state.scheduler?.satelliteSelection?.satGroups || []);
    const sdrParameters = useSelector((state) => state.scheduler?.sdrParameters || {});
    const sdrParametersLoading = useSelector((state) => state.scheduler?.sdrParametersLoading || false);
    const sdrParametersError = useSelector((state) => state.scheduler?.sdrParametersError || {});
    const isSaving = useSelector((state) => state.scheduler?.isSavingMonitoredSatellite || false);
    const saveError = useSelector((state) => state.scheduler?.monitoredSatelliteError);

    const [activeSessionIndex, setActiveSessionIndex] = useState(0);
    const trackerInfoByRotatorId = useMemo(() => {
        const mapping = {};
        trackerInstances.forEach((instance) => {
            const rotatorId = instance?.rotator_id;
            if (!rotatorId) return;
            mapping[String(rotatorId)] = {
                targetNumber: Number(instance?.target_number || 0),
            };
        });
        return mapping;
    }, [trackerInstances]);
    const [formData, setFormData] = useState(() => {
        const initialSession = createEmptySession();
        return {
            enabled: true,
            satellite: { norad_id: '', name: '', group_id: '' },
            sdr: initialSession.sdr,
            tasks: initialSession.tasks,
            sessions: [initialSession],
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
        };
    });

    const [expandedTasks, setExpandedTasks] = useState({});
    const [transmitterMenuAnchor, setTransmitterMenuAnchor] = useState(null);
    const [pendingRemoveSessionIndex, setPendingRemoveSessionIndex] = useState(null);
    const [openRemoveSessionConfirm, setOpenRemoveSessionConfirm] = useState(false);
    const sdrParamsForSelected = formData.sdr.id ? sdrParameters?.[formData.sdr.id] : null;
    const biasTSupported = Boolean(sdrParamsForSelected?.has_bias_t || sdrParamsForSelected?.capabilities?.bias_t?.supported);
    const selectedSdrRecord = useMemo(
        () => sdrs.find((sdr) => String(sdr?.id) === String(formData.sdr.id)),
        [sdrs, formData.sdr.id]
    );
    const selectedSdrRxAntennaLabels = useMemo(() => {
        const rawLabels = selectedSdrRecord?.antenna_labels;
        const rxLabels =
            rawLabels && typeof rawLabels === 'object' && rawLabels.rx && typeof rawLabels.rx === 'object'
                ? rawLabels.rx
                : {};

        const normalized = {};
        Object.entries(rxLabels).forEach(([portName, userLabel]) => {
            const key = String(portName || '').trim();
            const value = String(userLabel || '').trim();
            if (!key || !value) return;
            normalized[key] = value;
        });
        return normalized;
    }, [selectedSdrRecord]);
    const formatAntennaPortOptionLabel = (port) => {
        const key = String(port || '').trim();
        if (!key) return String(port || '');
        const userLabel = selectedSdrRxAntennaLabels[key];
        return userLabel ? `${userLabel} (${key})` : key;
    };

    const selectedSatellite = groupOfSats.find(sat => sat.norad_id === selectedSatelliteId);
    const availableTransmitters = selectedSatellite?.transmitters || [];

    // Helper to get safe transmitter value (returns empty string if transmitter not in available list)
    const getSafeTransmitterValue = (transmitterId) => {
        if (!transmitterId) return '';
        return availableTransmitters.find(t => t.id === transmitterId) ? transmitterId : '';
    };

    // Sync selectedGroupId from Redux into formData.satellite.group_id
    useEffect(() => {
        if (selectedGroupId) {
            setFormData((prev) => ({
                ...prev,
                satellite: {
                    ...prev.satellite,
                    group_id: selectedGroupId,
                },
            }));
        }
    }, [selectedGroupId]);

    // Fetch SDR parameters when SDR is selected
    useEffect(() => {
        if (socket && formData.sdr.id) {
            dispatch(fetchSDRParameters({ socket, sdrId: formData.sdr.id }));
        }
    }, [socket, formData.sdr.id, dispatch]);

    useEffect(() => {
        setFormData((prev) => {
            const options = getDecimationOptions(prev.sdr.sample_rate);
            let updated = false;
            const newTasks = prev.tasks.map((task) => {
                if (task.type !== 'iq_recording') return task;
                const current = task.config.decimation_factor || 1;
                if (!options.includes(current)) {
                    updated = true;
                    return {
                        ...task,
                        config: {
                            ...task.config,
                            decimation_factor: 1,
                        },
                    };
                }
                return task;
            });
            if (!updated) {
                return prev;
            }
            return {
                ...prev,
                tasks: newTasks,
            };
        });
    }, [formData.sdr.sample_rate]);

    // Calculate center frequency when tasks or sample rate changes (only if auto mode enabled)
    useEffect(() => {
        // Only auto-calculate if auto mode is enabled
        if (!formData.sdr.auto_center_frequency) return;

        const sampleRate = formData.sdr.sample_rate;
        if (!sampleRate) return;

        // Collect all transmitter frequencies from tasks
        const frequencies = [];
        formData.tasks.forEach((task) => {
            if (task.config.transmitter_id) {
                const transmitter = availableTransmitters.find(t => t.id === task.config.transmitter_id);
                if (transmitter && transmitter.downlink_low) {
                    frequencies.push(transmitter.downlink_low);
                }
            }
        });

        if (frequencies.length === 0) {
            setFormData((prev) => {
                if (prev.sdr.center_frequency !== 0) {
                    return {
                        ...prev,
                        sdr: {
                            ...prev.sdr,
                            center_frequency: 0,
                        },
                    };
                }
                return prev;
            });
            return;
        }

        // Calculate center frequency avoiding DC spike
        const minFreq = Math.min(...frequencies);
        const maxFreq = Math.max(...frequencies);
        const naiveCenter = (minFreq + maxFreq) / 2;

        // Offset by 1/4 of sample rate to avoid DC spike at center
        const dcOffset = sampleRate / 4;
        const centerFreq = Math.round(naiveCenter + dcOffset);

        setFormData((prev) => {
            if (prev.sdr.center_frequency !== centerFreq) {
                return {
                    ...prev,
                    sdr: {
                        ...prev.sdr,
                        center_frequency: centerFreq,
                    },
                };
            }
            return prev;
        });
    }, [formData.tasks, formData.sdr.sample_rate, formData.sdr.auto_center_frequency, availableTransmitters]);

    useEffect(() => {
        setFormData((prev) => {
            const sessions = Array.isArray(prev.sessions) ? [...prev.sessions] : [];
            const current = sessions[activeSessionIndex] || createEmptySession();
            if (current.sdr === prev.sdr && current.tasks === prev.tasks) {
                return prev;
            }
            sessions[activeSessionIndex] = {
                ...current,
                sdr: prev.sdr,
                tasks: prev.tasks,
            };
            return { ...prev, sessions };
        });
    }, [formData.sdr, formData.tasks, activeSessionIndex]);

    useEffect(() => {
        if (selectedMonitoredSatellite) {
            const sessions = Array.isArray(selectedMonitoredSatellite.sessions) && selectedMonitoredSatellite.sessions.length
                ? selectedMonitoredSatellite.sessions
                : [createEmptySession()];
            const normalizedSessions = sessions.map((session) => ({
                ...session,
                sdr: {
                    ...session.sdr,
                    auto_center_frequency: session.sdr?.auto_center_frequency ?? true,
                    bias_t: session.sdr?.bias_t ?? false,
                },
                tasks: session.tasks || [],
            }));
            const primarySession = normalizedSessions[0] || createEmptySession();
            const normalizedRotator = {
                id: selectedMonitoredSatellite?.rotator?.id ?? null,
                tracking_enabled: Boolean(selectedMonitoredSatellite?.rotator?.tracking_enabled),
                unpark_before_tracking: Boolean(
                    selectedMonitoredSatellite?.rotator?.unpark_before_tracking
                ),
                park_after_observation: Boolean(
                    selectedMonitoredSatellite?.rotator?.park_after_observation
                ),
            };
            setFormData({
                ...selectedMonitoredSatellite,
                sessions: normalizedSessions,
                sdr: primarySession.sdr,
                tasks: primarySession.tasks,
                rotator: normalizedRotator,
            });
            setActiveSessionIndex(0);
        } else {
            const initialSession = createEmptySession();
            setFormData({
                enabled: true,
                satellite: { norad_id: '', name: '', group_id: '' },
                sdr: initialSession.sdr,
                tasks: initialSession.tasks,
                sessions: [initialSession],
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
            });
            setActiveSessionIndex(0);
            setExpandedTasks({});
        }
    }, [selectedMonitoredSatellite, open, trackerInfoByRotatorId]);

    // Clear satellite selection state when opening dialog
    useEffect(() => {
        if (open) {
            // Always clear satellite selection state to allow fresh initialization
            // The SatelliteSelector will reinitialize from initialSatellite prop
            dispatch(setSatelliteId(''));
            dispatch(setGroupId(''));
            dispatch(setGroupOfSats([]));
            dispatch(setSelectedFromSearch(false));
        }
    }, [open, dispatch]);

    const handleClose = () => {
        dispatch(setMonitoredSatelliteDialogOpen(false));
    };

    const handleSatelliteSelect = (satellite) => {
        setFormData((prev) => ({
            ...prev,
            satellite: {
                norad_id: satellite.norad_id,
                name: satellite.name,
                group_id: satellite.group_id || selectedGroupId || '',
            },
        }));
    };

    const handleSelectSession = (index) => {
        setActiveSessionIndex(index);
        setFormData((prev) => {
            const session = prev.sessions?.[index] || createEmptySession();
            return {
                ...prev,
                sdr: session.sdr || createEmptySession().sdr,
                tasks: session.tasks || [],
            };
        });
        setExpandedTasks({});
    };

    const handleAddSession = () => {
        const newSession = createEmptySession();
        setFormData((prev) => ({
            ...prev,
            sessions: [...(prev.sessions || []), newSession],
            sdr: newSession.sdr,
            tasks: newSession.tasks,
        }));
        setActiveSessionIndex((prev) => prev + 1);
        setExpandedTasks({});
    };

    const handleRemoveSession = (index) => {
        setFormData((prev) => {
            const sessions = [...(prev.sessions || [])];
            if (sessions.length <= 1) return prev;
            sessions.splice(index, 1);
            const nextIndex = Math.max(0, index - 1);
            const nextSession = sessions[nextIndex] || createEmptySession();
            setActiveSessionIndex(nextIndex);
            setExpandedTasks({});
            return {
                ...prev,
                sessions,
                sdr: nextSession.sdr,
                tasks: nextSession.tasks || [],
            };
        });
    };

    const requestRemoveSession = (index) => {
        setPendingRemoveSessionIndex(index);
        setOpenRemoveSessionConfirm(true);
    };

    const handleRemoveSessionConfirm = () => {
        if (pendingRemoveSessionIndex == null) return;
        handleRemoveSession(pendingRemoveSessionIndex);
        setOpenRemoveSessionConfirm(false);
        setPendingRemoveSessionIndex(null);
    };

    const handleAddTask = (taskType) => {
        let newTask;
        switch (taskType) {
            case 'decoder': {
                const defaultDecoderType = 'none';
                newTask = {
                    type: 'decoder',
                    config: {
                        decoder_type: defaultDecoderType,
                        transmitter_id: '',
                        parameters: {}
                    },
                };
                break;
            }
            case 'audio_recording':
                newTask = {
                    type: 'audio_recording',
                    config: {
                        transmitter_id: '',
                        demodulator: 'fm',
                    },
                };
                break;
            case 'iq_recording':
                newTask = {
                    type: 'iq_recording',
                    config: {
                        transmitter_id: '',
                        enable_frequency_shift: false,
                        auto_fill_target_freq: false,
                        target_center_freq: '',
                        decimation_factor: 1,
                        enable_post_processing: false,
                        post_process_pipeline: getDefaultSatdumpPipeline(),
                        delete_after_post_processing: false,
                    },
                };
                break;
            case 'transcription':
                newTask = {
                    type: 'transcription',
                    config: {
                        transmitter_id: '',
                        modulation: 'fm',
                        provider: 'gemini',
                        language: 'auto',
                        translate_to: 'none',
                    },
                };
                break;
            default:
                return;
        }
        setFormData((prev) => {
            const newTasks = [...prev.tasks, newTask];
            const taskKey = `${activeSessionIndex}-${newTasks.length - 1}`;
            setExpandedTasks((prevExpanded) => ({
                ...prevExpanded,
                [taskKey]: false
            }));
            return {
                ...prev,
                tasks: newTasks,
            };
        });
    };

    const handleRemoveTask = (index) => {
        setFormData((prev) => ({
            ...prev,
            tasks: prev.tasks.filter((_, i) => i !== index),
        }));
    };

    const handleTaskConfigChange = (index, field, value) => {
        setFormData((prev) => {
            const newTasks = [...prev.tasks];
            const currentTask = newTasks[index];

            if (field === 'decoder_type' && currentTask.type === 'decoder') {
                const nextBandwidth = value === 'sstv'
                    ? (currentTask.config.bandwidth ?? SSTV_DEFAULT_BANDWIDTH)
                    : undefined;
                newTasks[index] = {
                    ...currentTask,
                    config: {
                        ...currentTask.config,
                        decoder_type: value,
                        parameters: getDecoderDefaultParameters(value),
                        bandwidth: nextBandwidth,
                    },
                };
            } else {
                newTasks[index] = {
                    ...currentTask,
                    config: {
                        ...currentTask.config,
                        [field]: value,
                    },
                };
            }
            return { ...prev, tasks: newTasks };
        });
    };

    const handleDecoderParameterChange = (taskIndex, paramKey, value) => {
        setFormData((prev) => {
            const newTasks = [...prev.tasks];
            newTasks[taskIndex] = {
                ...newTasks[taskIndex],
                config: {
                    ...newTasks[taskIndex].config,
                    parameters: {
                        ...newTasks[taskIndex].config.parameters,
                        [paramKey]: value,
                    },
                },
            };
            return { ...prev, tasks: newTasks };
        });
    };

    const toggleTaskExpanded = (index) => {
        const taskKey = `${activeSessionIndex}-${index}`;
        setExpandedTasks((prev) => ({
            ...prev,
            [taskKey]: !prev[taskKey]
        }));
    };

    const renderDecoderParameter = (taskIndex, paramKey, paramDef, currentParams) => {
        if (paramDef.visibleWhen && !paramDef.visibleWhen(currentParams)) {
            return null;
        }

        const currentValue = currentParams[paramKey] ?? paramDef.default;

        if (paramDef.type === 'select') {
            // For null values, use a special string key that won't conflict with actual values
            const displayValue = currentValue === null ? '__auto__' : currentValue;
            
            return (
                <FormControl fullWidth size="small" key={paramKey}>
                    <InputLabel>{paramDef.label}</InputLabel>
                    <Select
                        value={displayValue}
                        onChange={(e) => {
                            const newValue = e.target.value === '__auto__' ? null : e.target.value;
                            handleDecoderParameterChange(taskIndex, paramKey, newValue);
                        }}
                        label={paramDef.label}
                    >
                        {paramDef.options.map((option) => (
                            <MenuItem
                                key={JSON.stringify(option.value)}
                                value={option.value === null ? '__auto__' : option.value}
                            >
                                {option.label}
                            </MenuItem>
                        ))}
                    </Select>
                </FormControl>
            );
        } else if (paramDef.type === 'switch') {
            return (
                <FormControlLabel
                    key={paramKey}
                    control={
                        <Checkbox
                            checked={currentValue}
                            onChange={(e) => handleDecoderParameterChange(taskIndex, paramKey, e.target.checked)}
                        />
                    }
                    label={<Typography variant="body2">{paramDef.label}</Typography>}
                />
            );
        }

        return null;
    };

    const getTaskSummaryOptionLabel = (options, value, fallback = value) => {
        const option = options.find((item) => item.value === value);
        if (!option) return fallback;
        return t(`scheduler_dialogs.shared.${option.labelKey}`);
    };

    const getTranscriptionLanguageSummary = (sourceLanguage, targetLanguage) => {
        const sourceLabel = getTaskSummaryOptionLabel(SOURCE_LANGUAGE_OPTIONS, sourceLanguage || 'auto', sourceLanguage || 'auto');
        if (targetLanguage && targetLanguage !== 'none') {
            const targetLabel = getTaskSummaryOptionLabel(TRANSLATION_TARGET_OPTIONS, targetLanguage, targetLanguage);
            return t('scheduler_dialogs.shared.language_pair_summary', { source: sourceLabel, target: targetLabel });
        }
        return sourceLabel;
    };

    const getProviderSummaryLabel = (provider) => {
        const normalized = provider || 'gemini';
        return t(`scheduler_dialogs.shared.provider_${normalized}`, { defaultValue: normalized });
    };

    const getTaskSummary = (task) => {
        if (task.type === 'decoder') {
            const transmitter = availableTransmitters.find(t => t.id === task.config.transmitter_id);
            const transmitterName = transmitter?.description || t('scheduler_dialogs.shared.no_transmitter');
            const freqMHz = transmitter?.downlink_low ? `${(transmitter.downlink_low / 1000000).toFixed(3)} MHz` : '';
            const decoderType = getTaskSummaryOptionLabel(DECODER_TYPES, task.config.decoder_type, task.config.decoder_type);

            if (task.config.decoder_type === 'none') {
                const parts = [transmitterName, freqMHz, t('scheduler_dialogs.shared.no_decoder')].filter(Boolean);
                return parts.join(' • ');
            }

            const parts = [transmitterName, freqMHz, decoderType].filter(Boolean);
            return parts.join(' • ');
        } else if (task.type === 'audio_recording') {
            const transmitter = availableTransmitters.find(t => t.id === task.config.transmitter_id);
            const transmitterName = transmitter?.description || t('scheduler_dialogs.shared.no_transmitter');
            const freqMHz = transmitter?.downlink_low ? `${(transmitter.downlink_low / 1000000).toFixed(3)} MHz` : '';
            const demodType = getTaskSummaryOptionLabel(DEMODULATOR_TYPES, task.config.demodulator, task.config.demodulator?.toUpperCase());

            const parts = [transmitterName, freqMHz, demodType, t('scheduler_dialogs.shared.audio_format_wav')].filter(Boolean);
            return parts.join(' • ');
        } else if (task.type === 'transcription') {
            const transmitter = availableTransmitters.find(t => t.id === task.config.transmitter_id);
            const transmitterName = transmitter?.description || t('scheduler_dialogs.shared.no_transmitter');
            const freqMHz = transmitter?.downlink_low ? `${(transmitter.downlink_low / 1000000).toFixed(3)} MHz` : '';
            const modType = getTaskSummaryOptionLabel(MODULATION_TYPES, task.config.modulation, task.config.modulation?.toUpperCase());
            const provider = getProviderSummaryLabel(task.config.provider);
            const languageSummary = getTranscriptionLanguageSummary(task.config.language, task.config.translate_to);

            const parts = [transmitterName, freqMHz, modType, provider, languageSummary, t('scheduler_dialogs.shared.task_transcription')].filter(Boolean);
            return parts.join(' • ');
        } else if (task.type === 'iq_recording') {
            const transmitter = availableTransmitters.find(t => t.id === task.config.transmitter_id);
            const transmitterName = transmitter?.description || t('scheduler_dialogs.shared.no_transmitter');
            const freqMHz = transmitter?.downlink_low ? `${(transmitter.downlink_low / 1000000).toFixed(3)} MHz` : '';
            const extraInfo = [];
            if (task.config.enable_frequency_shift && task.config.target_center_freq) {
                const targetMHz = (task.config.target_center_freq / 1000000).toFixed(3);
                extraInfo.push(t('scheduler_dialogs.shared.centered_at_mhz', { value: targetMHz }));
            }
            const decimationFactor = task.config.decimation_factor || 1;
            if (decimationFactor > 1 && formData.sdr.sample_rate) {
                extraInfo.push(
                    t('scheduler_dialogs.shared.decimation_summary', {
                        factor: decimationFactor,
                        rate: formatSampleRate(formData.sdr.sample_rate / decimationFactor),
                    })
                );
            }
            const parts = [transmitterName, freqMHz, ...extraInfo, t('scheduler_dialogs.shared.iq_format_sigmf')].filter(Boolean);
            return parts.join(' • ');
        }
        return '';
    };

    const validateTasksWithinBandwidth = (session) => {
        const sampleRate = session?.sdr?.sample_rate;
        const sessionTasks = session?.tasks || [];
        if (!sampleRate) return { valid: true, message: '', details: [] };

        // Collect all transmitter frequencies from tasks
        const frequencies = [];
        const details = [];

        sessionTasks.forEach((task, index) => {
            if (task.config.transmitter_id) {
                const transmitter = availableTransmitters.find(t => t.id === task.config.transmitter_id);
                if (transmitter && transmitter.downlink_low) {
                    const bandwidth = transmitter.downlink_high && transmitter.downlink_low
                        ? transmitter.downlink_high - transmitter.downlink_low
                        : 0;

                    frequencies.push({
                        freq: transmitter.downlink_low,
                        bandwidth: bandwidth,
                        transmitter: transmitter
                    });

                    details.push({
                        taskIndex: index,
                        name: transmitter.description || t('unknown'),
                        freq: transmitter.downlink_low,
                        bandwidth: bandwidth
                    });
                }
            }
        });

        if (frequencies.length === 0) {
            return { valid: true, message: '', details: [] };
        }

        // Find min and max frequencies including their bandwidths
        const minFreq = Math.min(...frequencies.map(f => f.freq - f.bandwidth / 2));
        const maxFreq = Math.max(...frequencies.map(f => f.freq + f.bandwidth / 2));
        const requiredBandwidth = maxFreq - minFreq;

        const valid = requiredBandwidth <= sampleRate;

        return {
            valid,
            message: valid
                ? ''
                : t('scheduler_dialogs.shared.bandwidth_validation_error', {
                    required: (requiredBandwidth / 1000000).toFixed(2),
                    sampleRate: (sampleRate / 1000000).toFixed(2),
                }),
            requiredBandwidth,
            sampleRate,
            minFreq,
            maxFreq,
            details
        };
    };

    const bandwidthValidation = validateTasksWithinBandwidth({
        sdr: formData.sdr,
        tasks: formData.tasks,
    });

    const isFormValid = () => {
        const sessions = Array.isArray(formData.sessions) && formData.sessions.length
            ? formData.sessions
            : [{ sdr: formData.sdr, tasks: formData.tasks }];
        const sessionsValid = sessions.every((session) => {
            const sdr = session?.sdr || {};
            return (
                sdr.id &&
                sdr.gain !== '' &&
                sdr.antenna_port !== '' &&
                validateTasksWithinBandwidth(session).valid
            );
        });
        return (
            formData.satellite.norad_id !== '' &&
            sessionsValid &&
            formData.min_elevation >= 0 &&
            formData.task_start_elevation >= 0 &&
            formData.task_start_elevation <= formData.min_elevation &&
            formData.lookahead_hours > 0 &&
            bandwidthValidation.valid
        );
    };

    const handleSubmit = () => {
        if (!isFormValid()) return;
        const sessions = Array.isArray(formData.sessions) && formData.sessions.length
            ? formData.sessions
            : [{ sdr: formData.sdr, tasks: formData.tasks }];

        if (isEditingMonitoredSatellite) {
            // Update existing monitored satellite
            dispatch(updateMonitoredSatelliteAsync({
                socket,
                id: selectedMonitoredSatellite.id,
                satellite: {
                    ...formData,
                    sessions,
                },
            }));
        } else {
            // Add new monitored satellite
            const newSatellite = {
                ...formData,
                sessions,
                id: `monitored-${Date.now()}`,
            };
            dispatch(createMonitoredSatellite({
                socket,
                satellite: newSatellite,
            }));
        }

        // Dialog will be closed automatically by the fulfilled reducer
    };

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            maxWidth="md"
            fullWidth
            PaperProps={{
                sx: {
                    bgcolor: 'background.paper',
                    border: (theme) => `1px solid ${theme.palette.divider}`,
                    borderRadius: 2,
                },
            }}
        >

            <DialogTitle
                sx={{
                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
                    borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                    py: 2.5,
                }}
            >
                <Box>
                    <Typography variant="h6" sx={{ fontWeight: 'bold', lineHeight: 1.2 }}>
                        {isEditingMonitoredSatellite
                            ? t('scheduler_dialogs.monitored.edit_title')
                            : t('scheduler_dialogs.monitored.new_title')}
                    </Typography>
                    {!isEditingMonitoredSatellite && (
                        <Typography
                            variant="body2"
                            sx={{
                                mt: 0.65,
                                color: 'text.secondary',
                                fontWeight: 400,
                                lineHeight: 1.35,
                            }}
                        >
                            {t('scheduler_dialogs.monitored.new_subtitle')}
                        </Typography>
                    )}
                </Box>
            </DialogTitle>

            <DialogContent
                dividers
                sx={{
                    bgcolor: (theme) => (
                        theme.palette.mode === 'dark'
                            ? theme.palette.background.elevated
                            : theme.palette.background.paper
                    ),
                    px: 3,
                    py: 3,
                }}
            >
                <Stack spacing={3}>
                    {/* Error Alert */}
                    {saveError && (
                        <Box
                            sx={{
                                p: 2,
                                borderRadius: 1,
                                bgcolor: 'error.main',
                                color: 'error.contrastText',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 1,
                            }}
                        >
                            <ErrorOutlineIcon />
                            <Typography variant="body2">
                                {saveError}
                            </Typography>
                        </Box>
                    )}

                    {/* Enabled Checkbox */}
                    <Box>
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={formData.enabled}
                                    onChange={(e) =>
                                        setFormData((prev) => ({
                                            ...prev,
                                            enabled: e.target.checked,
                                        }))
                                    }
                                />
                            }
                            label={
                                <Box>
                                    <Typography variant="body2">{t('scheduler_dialogs.shared.enabled_label')}</Typography>
                                    <Typography variant="caption" color="text.secondary">
                                        {t('scheduler_dialogs.monitored.enabled_help')}
                                    </Typography>
                                </Box>
                            }
                        />
                    </Box>

                    <Divider />

                    {/* Satellite Selection */}
                    <Box>
                        <Typography variant="subtitle2" gutterBottom sx={{ color: 'primary.main', fontWeight: 'bold' }}>
                            {t('scheduler_dialogs.shared.satellite_title')}
                        </Typography>
                        <SatelliteSelector 
                            onSatelliteSelect={handleSatelliteSelect} 
                            showPassSelector={false}
                            initialSatellite={selectedMonitoredSatellite?.satellite}
                        />
                    </Box>

                    <Divider />

                    {/* Monitoring Criteria */}
                    <Box>
                        <Typography variant="subtitle2" gutterBottom sx={{ color: 'primary.main', fontWeight: 'bold' }}>
                            {t('scheduler_dialogs.monitored.monitoring_criteria_title')}
                        </Typography>
                        <Stack spacing={2}>
                            <Box>
                                <TextField
                                    label={t('scheduler_dialogs.monitored.minimum_peak_elevation_label')}
                                    type="number"
                                    fullWidth
                                    size="small"
                                    value={formData.min_elevation}
                                    onChange={(e) =>
                                        setFormData((prev) => ({
                                            ...prev,
                                            min_elevation: parseInt(e.target.value) || 0,
                                        }))
                                    }
                                    required
                                />
                                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                                    {t('scheduler_dialogs.monitored.minimum_peak_elevation_help')}
                                </Typography>
                            </Box>
                            <Box>
                                <TextField
                                    label={t('scheduler_dialogs.monitored.task_start_elevation_label')}
                                    type="number"
                                    fullWidth
                                    size="small"
                                    value={formData.task_start_elevation}
                                    onChange={(e) =>
                                        setFormData((prev) => ({
                                            ...prev,
                                            task_start_elevation: parseInt(e.target.value) || 0,
                                        }))
                                    }
                                    required
                                    error={formData.task_start_elevation > formData.min_elevation}
                                    helperText={
                                        formData.task_start_elevation > formData.min_elevation
                                            ? t('scheduler_dialogs.monitored.task_start_elevation_error')
                                            : ''
                                    }
                                />
                                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                                    {t('scheduler_dialogs.monitored.task_start_elevation_help')}
                                </Typography>
                            </Box>
                            <Box>
                                <TextField
                                    label={t('scheduler_dialogs.monitored.lookahead_window_label')}
                                    type="number"
                                    fullWidth
                                    size="small"
                                    value={formData.lookahead_hours}
                                    onChange={(e) =>
                                        setFormData((prev) => ({
                                            ...prev,
                                            lookahead_hours: parseInt(e.target.value) || 0,
                                        }))
                                    }
                                    required
                                />
                                <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                                    {t('scheduler_dialogs.monitored.lookahead_window_help')}
                                </Typography>
                            </Box>
                        </Stack>
                    </Box>

                    <Divider />

                    {/* Rotator Selection */}
                    <Box>
                        <Typography variant="subtitle2" gutterBottom sx={{ color: 'primary.main', fontWeight: 'bold' }}>
                            {t('scheduler_dialogs.shared.rotator_title')}
                        </Typography>
                        <Stack spacing={2}>
                            <FormControl fullWidth size="small">
                                <InputLabel>{t('scheduler_dialogs.shared.rotator_label')}</InputLabel>
                                <Select
                                    value={formData.rotator.id || '__none__'}
                                    onChange={(e) => {
                                        const value = e.target.value === '__none__' ? null : e.target.value;
                                        setFormData((prev) => ({
                                            ...prev,
                                            rotator: {
                                                id: value,
                                                tracking_enabled: value ? true : false,
                                                unpark_before_tracking:
                                                    value
                                                        ? Boolean(prev.rotator?.unpark_before_tracking)
                                                        : false,
                                                park_after_observation:
                                                    value
                                                        ? Boolean(prev.rotator?.park_after_observation)
                                                        : false,
                                            },
                                            rig: {
                                                ...prev.rig,
                                                doppler_correction: value ? true : false,
                                            },
                                        }));
                                    }}
                                    label={t('scheduler_dialogs.shared.rotator_label')}
                                >
                                    <MenuItem value="__none__">
                                        <em>{t('scheduler_dialogs.shared.none')}</em>
                                    </MenuItem>
                                    {rotators.map((rotator) => (
                                        <MenuItem key={rotator.id} value={rotator.id}>
                                            <Box>
                                                <Typography variant="body2">
                                                    {rotator.name}{rotator.type ? ` (${rotator.type})` : ''}
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary">
                                                    {[
                                                        rotator.host ? `${rotator.host}:${rotator.port}` : null,
                                                        (() => {
                                                            const trackerInfo = trackerInfoByRotatorId[String(rotator.id)];
                                                            if (trackerInfo?.targetNumber) {
                                                                return `Target ${trackerInfo.targetNumber}`;
                                                            }
                                                            return t('scheduler_dialogs.shared.target_resolved_runtime');
                                                        })(),
                                                        rotator.min_azimuth != null && rotator.max_azimuth != null ? `Az: ${rotator.min_azimuth}° - ${rotator.max_azimuth}°` : null,
                                                        rotator.min_elevation != null && rotator.max_elevation != null ? `El: ${rotator.min_elevation}° - ${rotator.max_elevation}°` : null,
                                                    ].filter(Boolean).join(' • ') || t('scheduler_dialogs.shared.no_additional_details')}
                                                </Typography>
                                            </Box>
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <Typography variant="caption" color="text.secondary">
                                {t('scheduler_dialogs.shared.rotator_assignment_runtime')}
                            </Typography>
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={Boolean(formData.rotator?.unpark_before_tracking)}
                                        onChange={(e) =>
                                            setFormData((prev) => ({
                                                ...prev,
                                                rotator: {
                                                    ...prev.rotator,
                                                    unpark_before_tracking: e.target.checked,
                                                },
                                            }))
                                        }
                                        disabled={!formData.rotator?.id}
                                    />
                                }
                                label={t('scheduler_dialogs.shared.unpark_before_observation')}
                            />
                            <FormControlLabel
                                control={
                                    <Checkbox
                                        checked={Boolean(formData.rotator?.park_after_observation)}
                                        onChange={(e) =>
                                            setFormData((prev) => ({
                                                ...prev,
                                                rotator: {
                                                    ...prev.rotator,
                                                    park_after_observation: e.target.checked,
                                                },
                                            }))
                                        }
                                        disabled={!formData.rotator?.id}
                                    />
                                }
                                label={t('scheduler_dialogs.shared.park_after_observation')}
                            />
                        </Stack>
                    </Box>

                    <Divider />

                    {/* Sessions */}
                    <Box>
                        <Typography variant="subtitle2" gutterBottom sx={{ color: 'primary.main', fontWeight: 'bold' }}>
                            {t('scheduler_dialogs.shared.sdr_sessions_title')}
                        </Typography>
                        <Stack direction="row" spacing={2} alignItems="center">
                            <Tabs
                                value={activeSessionIndex}
                                onChange={(event, value) => handleSelectSession(value)}
                                variant="scrollable"
                                scrollButtons="auto"
                                sx={{ flex: 1 }}
                            >
                                {(formData.sessions || []).map((session, index) => (
                                    <Tab
                                        key={index}
                                        label={
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                                <Typography variant="body2">
                                                    {session?.sdr?.name || `SDR ${index + 1}`}
                                                </Typography>
                                                <IconButton
                                                    size="small"
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        requestRemoveSession(index);
                                                    }}
                                                    disabled={(formData.sessions || []).length <= 1}
                                                >
                                                    <DeleteIcon fontSize="small" />
                                                </IconButton>
                                            </Box>
                                        }
                                        value={index}
                                    />
                                ))}
                            </Tabs>
                            <Button
                                size="small"
                                variant="outlined"
                                startIcon={<AddIcon />}
                                onClick={handleAddSession}
                            >
                                {t('scheduler_dialogs.shared.add_sdr')}
                            </Button>
                        </Stack>
                    </Box>

                    <Divider />

                    {/* SDR Configuration */}
                    <Box sx={{ position: 'relative' }}>
                        <Typography variant="subtitle2" gutterBottom sx={{ color: 'primary.main', fontWeight: 'bold' }}>
                            {t('scheduler_dialogs.shared.sdr_configuration_title')}
                        </Typography>
                        {sdrParametersLoading && (
                            <Box
                                sx={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    right: 0,
                                    bottom: 0,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    zIndex: 1,
                                    borderRadius: 1,
                                }}
                            >
                                <CircularProgress />
                            </Box>
                        )}
                        <Stack spacing={2}>
                            {sdrParametersError[formData.sdr.id] && (
                                <Box
                                    sx={{
                                        p: 1.5,
                                        bgcolor: 'error.main',
                                        color: 'error.contrastText',
                                        borderRadius: 1,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 1,
                                    }}
                                >
                                    <Typography variant="body2">
                                        ⚠ {sdrParametersError[formData.sdr.id]}
                                    </Typography>
                                </Box>
                            )}
                            <FormControl fullWidth size="small" required error={!!sdrParametersError[formData.sdr.id]}>
                                <InputLabel>{t('scheduler_dialogs.shared.sdr_label')}</InputLabel>
                                <Select
                                    value={formData.sdr.id}
                                    onChange={(e) => {
                                        const selectedSdr = sdrs.find((s) => s.id === e.target.value);
                                        setFormData((prev) => ({
                                            ...prev,
                                            sdr: {
                                                ...prev.sdr,
                                                id: e.target.value,
                                                name: selectedSdr?.name || '',
                                                gain: '',
                                                antenna_port: '',
                                            },
                                        }));
                                    }}
                                    label={t('scheduler_dialogs.shared.sdr_label')}
                                >
                                    {sdrs.filter(sdr => sdr.id !== 'sigmf-playback').map((sdr) => (
                                        <MenuItem key={sdr.id} value={sdr.id}>
                                            <Box>
                                                <Typography variant="body2">
                                                    {sdr.name} ({sdr.type})
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary">
                                                    {[
                                                        sdr.driver ? `Driver: ${sdr.driver}` : null,
                                                        sdr.serial ? `Serial: ${sdr.serial}` : null,
                                                    ].filter(Boolean).join(' • ') || t('scheduler_dialogs.shared.no_additional_details')}
                                                </Typography>
                                            </Box>
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>

                            <FormControl fullWidth size="small" required error={!bandwidthValidation.valid} disabled={!formData.sdr.id || sdrParametersLoading}>
                                <InputLabel>{t('scheduler_dialogs.shared.sample_rate_label')}</InputLabel>
                                <Select
                                    value={formData.sdr.sample_rate}
                                    onChange={(e) => {
                                        setFormData((prev) => ({
                                            ...prev,
                                            sdr: {
                                                ...prev.sdr,
                                                sample_rate: e.target.value,
                                            },
                                        }));
                                    }}
                                    label={t('scheduler_dialogs.shared.sample_rate_label')}
                                >
                                    {(sdrParameters[formData.sdr.id]?.sample_rate_values || SAMPLE_RATES.map(r => r.value)).map((rate) => {
                                        const rateValue = typeof rate === 'number' ? rate : rate.value;
                                        const rateLabel = rateValue >= 1000000
                                            ? `${(rateValue / 1000000).toFixed(rateValue % 1000000 === 0 ? 0 : 1)} MHz`
                                            : `${(rateValue / 1000).toFixed(0)} kHz`;
                                        return (
                                            <MenuItem key={rateValue} value={rateValue}>
                                                {rateLabel}
                                            </MenuItem>
                                        );
                                    })}
                                </Select>
                                {!bandwidthValidation.valid && bandwidthValidation.details.length > 0 && (
                                    <Box sx={{ mt: 0.5 }}>
                                        <Typography variant="caption" color="error">
                                            {bandwidthValidation.message}
                                        </Typography>
                                        <Typography variant="caption" display="block" sx={{ fontFamily: 'monospace', mt: 0.5 }}>
                                            ({(bandwidthValidation.maxFreq / 1000000).toFixed(3)} MHz - {(bandwidthValidation.minFreq / 1000000).toFixed(3)} MHz = {(bandwidthValidation.requiredBandwidth / 1000000).toFixed(2)} MHz)
                                        </Typography>
                                    </Box>
                                )}
                                {bandwidthValidation.valid && bandwidthValidation.requiredBandwidth > 0 && (
                                    <Typography variant="caption" color="success.main" sx={{ mt: 0.5 }}>
                                        {t('scheduler_dialogs.shared.all_tasks_fit_within_bandwidth')}
                                    </Typography>
                                )}
                            </FormControl>

                            <FormControl fullWidth size="small" required disabled={!formData.sdr.id || sdrParametersLoading} error={!!sdrParametersError[formData.sdr.id]}>
                                <InputLabel>{t('scheduler_dialogs.shared.gain_label')}</InputLabel>
                                <Select
                                    value={
                                        formData.sdr.id && sdrParameters[formData.sdr.id]?.gain_values?.includes(formData.sdr.gain)
                                            ? formData.sdr.gain
                                            : ''
                                    }
                                    onChange={(e) => {
                                        setFormData((prev) => ({
                                            ...prev,
                                            sdr: {
                                                ...prev.sdr,
                                                gain: e.target.value,
                                            },
                                        }));
                                    }}
                                    label={t('scheduler_dialogs.shared.gain_label')}
                                >
                                    {sdrParameters[formData.sdr.id]?.gain_values?.map((gain) => (
                                        <MenuItem key={gain} value={gain}>
                                            {gain} dB
                                        </MenuItem>
                                    )) || []}
                                </Select>
                            </FormControl>

                            <FormControl fullWidth size="small" required disabled={!formData.sdr.id || sdrParametersLoading} error={!!sdrParametersError[formData.sdr.id]}>
                                <InputLabel>{t('scheduler_dialogs.shared.antenna_port_label')}</InputLabel>
                                <Select
                                    value={
                                        formData.sdr.id && sdrParameters[formData.sdr.id]?.antennas?.rx?.includes(formData.sdr.antenna_port)
                                            ? formData.sdr.antenna_port
                                            : ''
                                    }
                                    onChange={(e) => {
                                        setFormData((prev) => ({
                                            ...prev,
                                            sdr: {
                                                ...prev.sdr,
                                                antenna_port: e.target.value,
                                            },
                                        }));
                                    }}
                                    label={t('scheduler_dialogs.shared.antenna_port_label')}
                                >
                                    {sdrParameters[formData.sdr.id]?.antennas?.rx?.map((port) => (
                                        <MenuItem key={port} value={port}>
                                            {formatAntennaPortOptionLabel(port)}
                                        </MenuItem>
                                    )) || []}
                                </Select>
                            </FormControl>

                            {biasTSupported && (
                                <FormControlLabel
                                    control={
                                        <Switch
                                            checked={Boolean(formData.sdr.bias_t)}
                                            onChange={(e) =>
                                                setFormData((prev) => ({
                                                    ...prev,
                                                    sdr: {
                                                        ...prev.sdr,
                                                        bias_t: e.target.checked,
                                                    },
                                                }))
                                            }
                                            disabled={!formData.sdr.id || sdrParametersLoading}
                                            size="small"
                                        />
                                    }
                                    label={
                                        <Box>
                                            <Typography variant="body2">{t('scheduler_dialogs.shared.enable_bias_t')}</Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {t('scheduler_dialogs.shared.enable_bias_t_help')}
                                            </Typography>
                                        </Box>
                                    }
                                />
                            )}

                            <Box>
                                <FormControlLabel
                                    control={
                                        <Checkbox
                                            checked={formData.sdr.auto_center_frequency}
                                            onChange={(e) =>
                                                setFormData((prev) => ({
                                                    ...prev,
                                                    sdr: {
                                                        ...prev.sdr,
                                                        auto_center_frequency: e.target.checked,
                                                    },
                                                }))
                                            }
                                        />
                                    }
                                    label={
                                        <Box>
                                            <Typography variant="body2">{t('scheduler_dialogs.shared.auto_center_frequency')}</Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {t('scheduler_dialogs.shared.auto_center_frequency_help')}
                                            </Typography>
                                        </Box>
                                    }
                                />
                            </Box>

                            <Box sx={{ display: 'flex', gap: 2 }}>
                                <TextField
                                    size="small"
                                    label={t('scheduler_dialogs.shared.center_frequency_hz')}
                                    type="number"
                                    value={formData.sdr.center_frequency || ''}
                                    onChange={(e) => {
                                        const value = parseFloat(e.target.value) || 0;
                                        setFormData((prev) => ({
                                            ...prev,
                                            sdr: {
                                                ...prev.sdr,
                                                center_frequency: value,
                                            },
                                        }));
                                    }}
                                    disabled={formData.sdr.auto_center_frequency}
                                    helperText={
                                        formData.sdr.auto_center_frequency
                                            ? t('scheduler_dialogs.shared.auto_calculated_center', {
                                                value: formData.sdr.center_frequency ? `${(formData.sdr.center_frequency / 1000000).toFixed(6)} MHz` : t('not_available'),
                                            })
                                            : t('scheduler_dialogs.shared.enter_center_frequency_hz')
                                    }
                                    sx={{ flex: '1' }}
                                />

                                <Box sx={{ display: 'flex', flexDirection: 'column', flex: '1' }}>
                                    <Button
                                        variant="outlined"
                                        size="small"
                                        onClick={(e) => setTransmitterMenuAnchor(e.currentTarget)}
                                        disabled={formData.sdr.auto_center_frequency || availableTransmitters.length === 0}
                                        sx={{
                                            height: '40px',
                                            textTransform: 'none',
                                            justifyContent: 'flex-start',
                                            px: 2,
                                            borderColor: 'primary.main',
                                            color: 'primary.main',
                                            bgcolor: (theme) => theme.palette.mode === 'dark'
                                                ? 'rgba(144, 202, 249, 0.08)'
                                                : 'rgba(25, 118, 210, 0.04)',
                                            '&:hover': {
                                                bgcolor: (theme) => theme.palette.mode === 'dark'
                                                    ? 'rgba(144, 202, 249, 0.15)'
                                                    : 'rgba(25, 118, 210, 0.08)',
                                            }
                                        }}
                                    >
                                        {t('scheduler_dialogs.shared.select_from_transmitter_list')}
                                    </Button>
                                    <Menu
                                        anchorEl={transmitterMenuAnchor}
                                        open={Boolean(transmitterMenuAnchor)}
                                        onClose={() => setTransmitterMenuAnchor(null)}
                                        PaperProps={{
                                            sx: {
                                                maxHeight: 400,
                                                minWidth: 300,
                                            }
                                        }}
                                    >
                                        {availableTransmitters.length === 0 ? (
                                            <MenuItem disabled>
                                                {t('scheduler_dialogs.shared.no_transmitters_available')}
                                            </MenuItem>
                                        ) : (
                                            groupTransmittersByBand(availableTransmitters).map(({ band, transmitters }) => [
                                                <ListSubheader key={`header-${band}`}>{t(`scheduler_dialogs.shared.band_${band}`)}</ListSubheader>,
                                                ...transmitters.map((transmitter) => {
                                                    const freqMHz = transmitter.downlink_low
                                                        ? (transmitter.downlink_low / 1000000).toFixed(3)
                                                        : 'N/A';
                                                    return (
                                                        <MenuItem
                                                            key={transmitter.id}
                                                            onClick={() => {
                                                                if (transmitter?.downlink_low) {
                                                                    setFormData((prev) => ({
                                                                        ...prev,
                                                                        sdr: {
                                                                            ...prev.sdr,
                                                                            center_frequency: transmitter.downlink_low,
                                                                        },
                                                                    }));
                                                                    setTransmitterMenuAnchor(null);
                                                                }
                                                            }}
                                                        >
                                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                                                <Box
                                                                    sx={{
                                                                        width: 8,
                                                                        height: 8,
                                                                        borderRadius: '50%',
                                                                        backgroundColor: transmitter.alive ? '#4caf50' : '#f44336',
                                                                        boxShadow: transmitter.alive
                                                                            ? '0 0 6px rgba(76, 175, 80, 0.6)'
                                                                            : '0 0 6px rgba(244, 67, 54, 0.6)',
                                                                        flexShrink: 0,
                                                                    }}
                                                                />
                                                                <Box sx={{ flexGrow: 1 }}>
                                                                    <Typography variant="body2">
                                                                        {transmitter.description || t('unknown')}
                                                                    </Typography>
                                                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                                                        {t('scheduler_dialogs.shared.source_with_frequency', {
                                                                            source: transmitter.source || t('unknown'),
                                                                            frequency: freqMHz,
                                                                        })}
                                                                    </Typography>
                                                                </Box>
                                                            </Box>
                                                        </MenuItem>
                                                    );
                                                })
                                            ])
                                        )}
                                    </Menu>
                                </Box>
                            </Box>
                        </Stack>
                    </Box>

                    <Divider />

                    {/* Tasks */}
                    <Box>
                        <Box display="flex" justifyContent="space-between" alignItems="center" mb={2}>
                            <Typography variant="subtitle2" sx={{ color: 'primary.main', fontWeight: 'bold' }}>
                                {t('scheduler_dialogs.shared.tasks_title')}
                            </Typography>
                            <Stack direction="row" spacing={1}>
                                <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={<AddIcon />}
                                    onClick={() => handleAddTask('decoder')}
                                >
                                    {t('scheduler_dialogs.shared.task_decoder')}
                                </Button>
                                <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={<AddIcon />}
                                    onClick={() => handleAddTask('audio_recording')}
                                >
                                    {t('scheduler_dialogs.shared.task_audio_recording')}
                                </Button>
                                <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={<AddIcon />}
                                    onClick={() => handleAddTask('transcription')}
                                >
                                    {t('scheduler_dialogs.shared.task_transcription')}
                                </Button>
                                <Button
                                    size="small"
                                    variant="outlined"
                                    startIcon={<AddIcon />}
                                    onClick={() => handleAddTask('iq_recording')}
                                >
                                    {t('scheduler_dialogs.shared.task_iq_recording')}
                                </Button>
                            </Stack>
                        </Box>

                        {formData.tasks.length === 0 ? (
                            <Typography variant="body2" color="text.secondary">
                                {t('scheduler_dialogs.monitored.no_tasks_added')}
                            </Typography>
                        ) : (
                            <Stack spacing={2}>
                                {formData.tasks.map((task, index) => {
                                    const taskKey = `${activeSessionIndex}-${index}`;
                                    return (
                                        <Box
                                            key={index}
                                            sx={{
                                                p: 2,
                                                border: '1px solid',
                                                borderColor: 'divider',
                                                borderRadius: 1,
                                                bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
                                                transition: 'background-color 0.2s',
                                                cursor: !expandedTasks[taskKey] ? 'pointer' : 'default',
                                                ...(!expandedTasks[taskKey] && {
                                                    '&:hover': {
                                                        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.100',
                                                    },
                                                }),
                                            }}
                                            onClick={(e) => {
                                                if (!expandedTasks[taskKey] && !e.target.closest('button')) {
                                                    toggleTaskExpanded(index);
                                                }
                                            }}
                                        >
                                            <Box>
                                                <Box
                                                    display="flex"
                                                    justifyContent="space-between"
                                                    alignItems="center"
                                                    mb={expandedTasks[taskKey] ? 2 : 0}
                                                >
                                                    <Box
                                                        display="flex"
                                                        alignItems="center"
                                                        gap={1}
                                                        sx={{ flex: 1 }}
                                                        onClick={() => expandedTasks[taskKey] && toggleTaskExpanded(index)}
                                                    >
                                                        <IconButton
                                                            size="small"
                                                            sx={{
                                                                transform: expandedTasks[taskKey] ? 'rotate(180deg)' : 'rotate(0deg)',
                                                                transition: 'transform 0.2s'
                                                            }}
                                                        >
                                                            <ExpandMoreIcon fontSize="small" />
                                                        </IconButton>
                                                    <Chip
                                                        label={
                                                            task.type === 'decoder' ? 'Decoder' :
                                                            task.type === 'audio_recording' ? 'Audio Recording' :
                                                            task.type === 'transcription' ? 'Transcription' :
                                                            'IQ Recording'
                                                        }
                                                        size="small"
                                                        color={
                                                            task.type === 'decoder' ? 'primary' :
                                                            task.type === 'audio_recording' ? 'secondary' :
                                                            task.type === 'transcription' ? 'info' :
                                                            'default'
                                                        }
                                                        variant="filled"
                                                        sx={{ minWidth: 130 }}
                                                    />
                                                    {!expandedTasks[taskKey] && (
                                                        <Typography
                                                            variant="body2"
                                                            color="text.secondary"
                                                            sx={{ ml: 1 }}
                                                        >
                                                            {getTaskSummary(task)}
                                                        </Typography>
                                                    )}
                                                </Box>
                                                <IconButton
                                                    size="small"
                                                    onClick={() => handleRemoveTask(index)}
                                                >
                                                    <DeleteIcon fontSize="small" />
                                                </IconButton>
                                            </Box>
                                            {expandedTasks[taskKey] && (
                                                <Stack spacing={2}>
                                                    {task.type === 'decoder' && (() => {
                                                        const decoderType = task.config.decoder_type;
                                                        const decoderParams = getDecoderParameters(decoderType);
                                                        const currentParams = task.config.parameters || {};

                                                        return (
                                                            <>
                                                                <FormControl fullWidth size="small">
                                                                    <InputLabel>{t('scheduler_dialogs.shared.transmitter_label')}</InputLabel>
                                                                    <Select
                                                                        value={getSafeTransmitterValue(task.config.transmitter_id)}
                                                                        onChange={(e) =>
                                                                            handleTaskConfigChange(
                                                                                index,
                                                                                'transmitter_id',
                                                                                e.target.value
                                                                            )
                                                                        }
                                                                        label={t('scheduler_dialogs.shared.transmitter_label')}
                                                                        disabled={availableTransmitters.length === 0}
                                                                    >
                                                                        {availableTransmitters.length === 0 ? (
                                                                            <MenuItem disabled value="">
                                                                                {t('scheduler_dialogs.shared.no_transmitters_available')}
                                                                            </MenuItem>
                                                                        ) : (
                                                                            groupTransmittersByBand(availableTransmitters).map(({ band, transmitters }) => [
                                                                                <ListSubheader key={`header-${band}`}>{t(`scheduler_dialogs.shared.band_${band}`)}</ListSubheader>,
                                                                                ...transmitters.map((transmitter) => {
                                                                                    const freqMHz = transmitter.downlink_low
                                                                                        ? (transmitter.downlink_low / 1000000).toFixed(3)
                                                                                        : 'N/A';
                                                                                    return (
                                                                                        <MenuItem key={transmitter.id} value={transmitter.id}>
                                                                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                                                                                <Box
                                                                                                    sx={{
                                                                                                        width: 8,
                                                                                                        height: 8,
                                                                                                        borderRadius: '50%',
                                                                                                        backgroundColor: transmitter.alive ? '#4caf50' : '#f44336',
                                                                                                        boxShadow: transmitter.alive
                                                                                                            ? '0 0 6px rgba(76, 175, 80, 0.6)'
                                                                                                            : '0 0 6px rgba(244, 67, 54, 0.6)',
                                                                                                        flexShrink: 0,
                                                                                                    }}
                                                                                                />
                                                                                                <Box sx={{ flexGrow: 1 }}>
                                                                                                    <Typography variant="body2">
                                                                                                        {transmitter.description || t('unknown')} - {freqMHz} MHz
                                                                                                    </Typography>
                                                                                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                                                                                        {[
                                                                                                            t('scheduler_dialogs.shared.source_value', { value: transmitter.source || t('unknown') }),
                                                                                                            transmitter.mode ? t('scheduler_dialogs.shared.mode_value', { value: transmitter.mode }) : null,
                                                                                                            transmitter.baud ? t('scheduler_dialogs.shared.baud_value', { value: transmitter.baud }) : null,
                                                                                                            transmitter.baudrate ? t('scheduler_dialogs.shared.baudrate_value', { value: transmitter.baudrate }) : null,
                                                                                                            transmitter.drift != null ? t('scheduler_dialogs.shared.drift_hz_value', { value: transmitter.drift }) : null,
                                                                                                        ].filter(Boolean).join(' • ') || t('scheduler_dialogs.shared.no_additional_details')}
                                                                                                    </Typography>
                                                                                                </Box>
                                                                                            </Box>
                                                                                        </MenuItem>
                                                                                    );
                                                                                })
                                                                            ])
                                                                        )}
                                                                    </Select>
                                                                </FormControl>

                                                                <FormControl fullWidth size="small">
                                                                    <InputLabel>{t('scheduler_dialogs.shared.decoder_type_label')}</InputLabel>
                                                                    <Select
                                                                        value={decoderType}
                                                                        onChange={(e) =>
                                                                            handleTaskConfigChange(
                                                                                index,
                                                                                'decoder_type',
                                                                                e.target.value
                                                                            )
                                                                        }
                                                                        label={t('scheduler_dialogs.shared.decoder_type_label')}
                                                                    >
                                                                        {DECODER_TYPES.map((type) => (
                                                                            <MenuItem key={type.value} value={type.value}>
                                                                                {t(`scheduler_dialogs.shared.${type.labelKey}`)}
                                                                            </MenuItem>
                                                                        ))}
                                                                    </Select>
                                                                </FormControl>

                                                                {/* Decoder Configuration Suggestion */}
                                                                <DecoderConfigSuggestion
                                                                    decoderType={decoderType}
                                                                    satellite={formData.satellite.norad_id ? formData.satellite : null}
                                                                    transmitter={
                                                                        task.config.transmitter_id
                                                                            ? availableTransmitters.find(t => t.id === task.config.transmitter_id)
                                                                            : null
                                                                    }
                                                                    show={!!task.config.transmitter_id && decoderType !== 'none'}
                                                                    onApply={(config) => {
                                                                        // Apply the configuration to the decoder parameters
                                                                        const newParams = { ...currentParams };
                                                                        const prefix = decoderType;

                                                                        // Map config fields to parameter keys based on decoder type
                                                                        if (['gmsk', 'gfsk', 'fsk'].includes(decoderType)) {
                                                                            if (config.baudrate) newParams[`${prefix}_baudrate`] = config.baudrate;
                                                                            if (config.framing) newParams[`${prefix}_framing`] = config.framing;
                                                                            if (config.deviation !== null && config.deviation !== undefined) {
                                                                                newParams[`${prefix}_deviation`] = config.deviation;
                                                                            }
                                                                            // Apply framing-specific parameters (e.g., GEOSCAN frame_size)
                                                                            if (config.framing === 'geoscan' && config.framing_params?.frame_size) {
                                                                                newParams[`${prefix}_geoscan_frame_size`] = config.framing_params.frame_size;
                                                                            }
                                                                        } else if (decoderType === 'bpsk') {
                                                                            if (config.baudrate) newParams.bpsk_baudrate = config.baudrate;
                                                                            if (config.framing) newParams.bpsk_framing = config.framing;
                                                                            if (config.differential !== null && config.differential !== undefined) {
                                                                                newParams.bpsk_differential = config.differential;
                                                                            }
                                                                            // Apply framing-specific parameters (e.g., GEOSCAN frame_size)
                                                                            if (config.framing === 'geoscan' && config.framing_params?.frame_size) {
                                                                                newParams.bpsk_geoscan_frame_size = config.framing_params.frame_size;
                                                                            }
                                                                        } else if (decoderType === 'afsk') {
                                                                            if (config.baudrate) newParams.afsk_baudrate = config.baudrate;
                                                                            if (config.framing) newParams.afsk_framing = config.framing;
                                                                            if (config.deviation !== null && config.deviation !== undefined) {
                                                                                newParams.afsk_deviation = config.deviation;
                                                                            }
                                                                            if (config.af_carrier) newParams.afsk_af_carrier = config.af_carrier;
                                                                        } else if (decoderType === 'lora') {
                                                                            if (config.sf) newParams.lora_sf = config.sf;
                                                                            if (config.bw) newParams.lora_bw = config.bw;
                                                                            if (config.cr) newParams.lora_cr = config.cr;
                                                                        }

                                                                        // Update the task parameters
                                                                        setFormData((prev) => {
                                                                            const newTasks = [...prev.tasks];
                                                                            newTasks[index] = {
                                                                                ...newTasks[index],
                                                                                config: {
                                                                                    ...newTasks[index].config,
                                                                                    parameters: newParams,
                                                                                },
                                                                            };
                                                                            return { ...prev, tasks: newTasks };
                                                                        });
                                                                    }}
                                                                />

                                                                {Object.keys(decoderParams).length > 0 && (
                                                                    <>
                                                                        <Divider sx={{ my: 1 }}>
                                                                            <Chip label={t('scheduler_dialogs.shared.decoder_parameters_label')} size="small" />
                                                                        </Divider>
                                                                        {Object.entries(decoderParams).map(([paramKey, paramDef]) =>
                                                                            renderDecoderParameter(index, paramKey, paramDef, currentParams)
                                                                        )}
                                                                    </>
                                                                )}
                                                            </>
                                                        );
                                                    })()}

                                                    {task.type === 'audio_recording' && (
                                                        <>
                                                            <FormControl fullWidth size="small">
                                                                <InputLabel>{t('scheduler_dialogs.shared.transmitter_label')}</InputLabel>
                                                                <Select
                                                                    value={getSafeTransmitterValue(task.config.transmitter_id)}
                                                                    onChange={(e) =>
                                                                        handleTaskConfigChange(
                                                                            index,
                                                                            'transmitter_id',
                                                                            e.target.value
                                                                        )
                                                                    }
                                                                    label={t('scheduler_dialogs.shared.transmitter_label')}
                                                                    disabled={availableTransmitters.length === 0}
                                                                >
                                                                    {availableTransmitters.length === 0 ? (
                                                                        <MenuItem disabled value="">
                                                                            {t('scheduler_dialogs.shared.no_transmitters_available')}
                                                                        </MenuItem>
                                                                    ) : (
                                                                        groupTransmittersByBand(availableTransmitters).map(({ band, transmitters }) => [
                                                                            <ListSubheader key={`header-${band}`}>{t(`scheduler_dialogs.shared.band_${band}`)}</ListSubheader>,
                                                                            ...transmitters.map((transmitter) => {
                                                                                const freqMHz = transmitter.downlink_low
                                                                                    ? (transmitter.downlink_low / 1000000).toFixed(3)
                                                                                    : 'N/A';
                                                                                return (
                                                                                    <MenuItem key={transmitter.id} value={transmitter.id}>
                                                                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                                                                            <Box
                                                                                                sx={{
                                                                                                    width: 8,
                                                                                                    height: 8,
                                                                                                    borderRadius: '50%',
                                                                                                    backgroundColor: transmitter.alive ? '#4caf50' : '#f44336',
                                                                                                    boxShadow: transmitter.alive
                                                                                                        ? '0 0 6px rgba(76, 175, 80, 0.6)'
                                                                                                        : '0 0 6px rgba(244, 67, 54, 0.6)',
                                                                                                    flexShrink: 0,
                                                                                                }}
                                                                                            />
                                                                                                <Box sx={{ flexGrow: 1 }}>
                                                                                                    <Typography variant="body2">
                                                                                                        {transmitter.description || t('unknown')} - {freqMHz} MHz
                                                                                                    </Typography>
                                                                                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                                                                                        {[
                                                                                                            t('scheduler_dialogs.shared.source_value', { value: transmitter.source || t('unknown') }),
                                                                                                            transmitter.mode ? t('scheduler_dialogs.shared.mode_value', { value: transmitter.mode }) : null,
                                                                                                            transmitter.baud ? t('scheduler_dialogs.shared.baud_value', { value: transmitter.baud }) : null,
                                                                                                            transmitter.drift != null ? t('scheduler_dialogs.shared.drift_hz_value', { value: transmitter.drift }) : null,
                                                                                                        ].filter(Boolean).join(' • ') || t('scheduler_dialogs.shared.no_additional_details')}
                                                                                                    </Typography>
                                                                                                </Box>
                                                                                            </Box>
                                                                                    </MenuItem>
                                                                                );
                                                                            })
                                                                        ])
                                                                    )}
                                                                </Select>
                                                            </FormControl>

                                                            <FormControl fullWidth size="small">
                                                                <InputLabel>{t('scheduler_dialogs.shared.demodulator_label')}</InputLabel>
                                                                <Select
                                                                    value={task.config.demodulator || 'fm'}
                                                                    onChange={(e) =>
                                                                        handleTaskConfigChange(
                                                                            index,
                                                                            'demodulator',
                                                                            e.target.value
                                                                        )
                                                                    }
                                                                    label={t('scheduler_dialogs.shared.demodulator_label')}
                                                                >
                                                                    {DEMODULATOR_TYPES.map((type) => (
                                                                        <MenuItem key={type.value} value={type.value}>
                                                                            {t(`scheduler_dialogs.shared.${type.labelKey}`)}
                                                                        </MenuItem>
                                                                    ))}
                                                                </Select>
                                                            </FormControl>

                                                            <Typography variant="caption" color="text.secondary">
                                                                {t('scheduler_dialogs.shared.audio_recording_help')}
                                                            </Typography>
                                                        </>
                                                    )}

                                                    {task.type === 'transcription' && (
                                                        <>
                                                            <FormControl fullWidth size="small">
                                                                <InputLabel>{t('scheduler_dialogs.shared.transmitter_label')}</InputLabel>
                                                                <Select
                                                                    value={getSafeTransmitterValue(task.config.transmitter_id)}
                                                                    onChange={(e) =>
                                                                        handleTaskConfigChange(
                                                                            index,
                                                                            'transmitter_id',
                                                                            e.target.value
                                                                        )
                                                                    }
                                                                    label={t('scheduler_dialogs.shared.transmitter_label')}
                                                                    disabled={availableTransmitters.length === 0}
                                                                >
                                                                    {availableTransmitters.length === 0 ? (
                                                                        <MenuItem disabled value="">
                                                                            {t('scheduler_dialogs.shared.no_transmitters_available')}
                                                                        </MenuItem>
                                                                    ) : (
                                                                        groupTransmittersByBand(availableTransmitters).map(({ band, transmitters }) => [
                                                                            <ListSubheader key={`header-${band}`}>{t(`scheduler_dialogs.shared.band_${band}`)}</ListSubheader>,
                                                                            ...transmitters.map((transmitter) => {
                                                                                const freqMHz = transmitter.downlink_low
                                                                                    ? (transmitter.downlink_low / 1000000).toFixed(3)
                                                                                    : 'N/A';
                                                                                return (
                                                                                    <MenuItem key={transmitter.id} value={transmitter.id}>
                                                                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                                                                            <Box
                                                                                                sx={{
                                                                                                    width: 8,
                                                                                                    height: 8,
                                                                                                    borderRadius: '50%',
                                                                                                    backgroundColor: transmitter.alive ? '#4caf50' : '#f44336',
                                                                                                    boxShadow: transmitter.alive
                                                                                                        ? '0 0 6px rgba(76, 175, 80, 0.6)'
                                                                                                        : '0 0 6px rgba(244, 67, 54, 0.6)',
                                                                                                    flexShrink: 0,
                                                                                                }}
                                                                                            />
                                                                                            <Box sx={{ flexGrow: 1 }}>
                                                                                            <Typography variant="body2">
                                                                                                {transmitter.description || t('unknown')} - {freqMHz} MHz
                                                                                            </Typography>
                                                                                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                                                                                {[
                                                                                                    t('scheduler_dialogs.shared.source_value', { value: transmitter.source || t('unknown') }),
                                                                                                    transmitter.mode ? t('scheduler_dialogs.shared.mode_value', { value: transmitter.mode }) : null,
                                                                                                    transmitter.baud ? t('scheduler_dialogs.shared.baud_value', { value: transmitter.baud }) : null,
                                                                                                    transmitter.drift != null ? t('scheduler_dialogs.shared.drift_hz_value', { value: transmitter.drift }) : null,
                                                                                                ].filter(Boolean).join(' • ') || t('scheduler_dialogs.shared.no_additional_details')}
                                                                                            </Typography>
                                                                                        </Box>
                                                                                    </Box>
                                                                                </MenuItem>
                                                                            );
                                                                            })
                                                                        ])
                                                                    )}
                                                                </Select>
                                                            </FormControl>

                                                            <FormControl fullWidth size="small">
                                                                <InputLabel>{t('scheduler_dialogs.shared.modulation_label')}</InputLabel>
                                                                <Select
                                                                    value={task.config.modulation || 'fm'}
                                                                    onChange={(e) =>
                                                                        handleTaskConfigChange(
                                                                            index,
                                                                            'modulation',
                                                                            e.target.value
                                                                        )
                                                                    }
                                                                    label={t('scheduler_dialogs.shared.modulation_label')}
                                                                >
                                                                    {MODULATION_TYPES.map((type) => (
                                                                        <MenuItem key={type.value} value={type.value}>
                                                                            {t(`scheduler_dialogs.shared.${type.labelKey}`)}
                                                                        </MenuItem>
                                                                    ))}
                                                                </Select>
                                                            </FormControl>

                                                            <FormControl fullWidth size="small">
                                                                <InputLabel>{t('scheduler_dialogs.shared.provider_label')}</InputLabel>
                                                                <Select
                                                                    value={task.config.provider || 'gemini'}
                                                                    onChange={(e) =>
                                                                        handleTaskConfigChange(
                                                                            index,
                                                                            'provider',
                                                                            e.target.value
                                                                        )
                                                                    }
                                                                    label={t('scheduler_dialogs.shared.provider_label')}
                                                                >
                                                                    {TRANSCRIPTION_PROVIDER_OPTIONS.map((option) => (
                                                                        <MenuItem key={option.value} value={option.value}>
                                                                            {t(`scheduler_dialogs.shared.${option.labelKey}`)}
                                                                        </MenuItem>
                                                                    ))}
                                                                </Select>
                                                            </FormControl>

                                                            <FormControl fullWidth size="small">
                                                                <InputLabel>{t('scheduler_dialogs.shared.source_language_label')}</InputLabel>
                                                                <Select
                                                                    value={task.config.language || 'auto'}
                                                                    onChange={(e) =>
                                                                        handleTaskConfigChange(
                                                                            index,
                                                                            'language',
                                                                            e.target.value
                                                                        )
                                                                    }
                                                                    label={t('scheduler_dialogs.shared.source_language_label')}
                                                                >
                                                                    {SOURCE_LANGUAGE_OPTIONS.map((option) => (
                                                                        <MenuItem key={option.value} value={option.value}>
                                                                            {`${option.icon} ${t(`scheduler_dialogs.shared.${option.labelKey}`)}`}
                                                                        </MenuItem>
                                                                    ))}
                                                                </Select>
                                                            </FormControl>

                                                            <FormControl fullWidth size="small">
                                                                <InputLabel>{t('scheduler_dialogs.shared.translate_to_label')}</InputLabel>
                                                                <Select
                                                                    value={task.config.translate_to || 'none'}
                                                                    onChange={(e) =>
                                                                        handleTaskConfigChange(
                                                                            index,
                                                                            'translate_to',
                                                                            e.target.value
                                                                        )
                                                                    }
                                                                    label={t('scheduler_dialogs.shared.translate_to_label')}
                                                                >
                                                                    {TRANSLATION_TARGET_OPTIONS.map((option) => (
                                                                        <MenuItem key={option.value} value={option.value}>
                                                                            {`${option.icon} ${t(`scheduler_dialogs.shared.${option.labelKey}`)}`}
                                                                        </MenuItem>
                                                                    ))}
                                                                </Select>
                                                            </FormControl>

                                                            <Typography variant="caption" color="text.secondary">
                                                                {t('scheduler_dialogs.shared.transcription_help')}
                                                            </Typography>
                                                        </>
                                                    )}

                                                    {task.type === 'iq_recording' && (
                                                        <>
                                                            <FormControl fullWidth size="small">
                                                                <InputLabel>{t('scheduler_dialogs.shared.transmitter_label')}</InputLabel>
                                                                <Select
                                                                    value={getSafeTransmitterValue(task.config.transmitter_id)}
                                                                    onChange={(e) => {
                                                                        const transmitterId = e.target.value;
                                                                        handleTaskConfigChange(index, 'transmitter_id', transmitterId);

                                                                        // Auto-fill target frequency if checkbox is enabled
                                                                        if (task.config.auto_fill_target_freq && transmitterId) {
                                                                            const transmitter = availableTransmitters.find(t => t.id === transmitterId);
                                                                            if (transmitter?.downlink_low) {
                                                                                handleTaskConfigChange(index, 'target_center_freq', transmitter.downlink_low);
                                                                            }
                                                                        }
                                                                    }}
                                                                    label={t('scheduler_dialogs.shared.transmitter_label')}
                                                                    disabled={availableTransmitters.length === 0}
                                                                >
                                                                    {availableTransmitters.length === 0 ? (
                                                                        <MenuItem disabled value="">
                                                                            {t('scheduler_dialogs.shared.no_transmitters_available')}
                                                                        </MenuItem>
                                                                    ) : (
                                                                        groupTransmittersByBand(availableTransmitters).map(({ band, transmitters }) => [
                                                                            <ListSubheader key={`header-${band}`}>{t(`scheduler_dialogs.shared.band_${band}`)}</ListSubheader>,
                                                                            ...transmitters.map((transmitter) => {
                                                                                const freqMHz = transmitter.downlink_low
                                                                                    ? (transmitter.downlink_low / 1000000).toFixed(3)
                                                                                    : 'N/A';
                                                                                return (
                                                                                    <MenuItem key={transmitter.id} value={transmitter.id}>
                                                                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                                                                            <Box
                                                                                                sx={{
                                                                                                    width: 8,
                                                                                                    height: 8,
                                                                                                    borderRadius: '50%',
                                                                                                    backgroundColor: transmitter.alive ? '#4caf50' : '#f44336',
                                                                                                    boxShadow: transmitter.alive
                                                                                                        ? '0 0 6px rgba(76, 175, 80, 0.6)'
                                                                                                        : '0 0 6px rgba(244, 67, 54, 0.6)',
                                                                                                    flexShrink: 0,
                                                                                                }}
                                                                                            />
                                                                                            <Box sx={{ flexGrow: 1 }}>
                                                                                                <Typography variant="body2">
                                                                                                    {transmitter.description || t('unknown')} - {freqMHz} MHz
                                                                                                </Typography>
                                                                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                                                                                    {[
                                                                                                        t('scheduler_dialogs.shared.source_value', { value: transmitter.source || t('unknown') }),
                                                                                                        transmitter.mode ? t('scheduler_dialogs.shared.mode_value', { value: transmitter.mode }) : null,
                                                                                                        transmitter.baud ? t('scheduler_dialogs.shared.baud_value', { value: transmitter.baud }) : null,
                                                                                                        transmitter.drift != null ? t('scheduler_dialogs.shared.drift_hz_value', { value: transmitter.drift }) : null,
                                                                                                    ].filter(Boolean).join(' • ') || t('scheduler_dialogs.shared.no_additional_details')}
                                                                                                </Typography>
                                                                                            </Box>
                                                                                        </Box>
                                                                                    </MenuItem>
                                                                                );
                                                                            })
                                                                        ])
                                                                    )}
                                                                </Select>
                                                            </FormControl>

                                                            <Box>
                                                                <FormControlLabel
                                                                    control={
                                                                        <Checkbox
                                                                            checked={task.config.enable_frequency_shift || false}
                                                                            onChange={(e) => {
                                                                                handleTaskConfigChange(index, 'enable_frequency_shift', e.target.checked);
                                                                                // Reset related fields when disabling
                                                                                if (!e.target.checked) {
                                                                                    handleTaskConfigChange(index, 'auto_fill_target_freq', false);
                                                                                    handleTaskConfigChange(index, 'target_center_freq', '');
                                                                                }
                                                                            }}
                                                                        />
                                                                    }
                                                                    label={t('scheduler_dialogs.shared.enable_frequency_shift_label')}
                                                                />
                                                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4, mt: -0.5 }}>
                                                                    {t('scheduler_dialogs.shared.enable_frequency_shift_help')}
                                                                </Typography>
                                                            </Box>

                                                            <>
                                                                <FormControlLabel
                                                                    control={
                                                                        <Checkbox
                                                                            checked={task.config.auto_fill_target_freq || false}
                                                                            onChange={(e) => {
                                                                                const autoFill = e.target.checked;
                                                                                handleTaskConfigChange(index, 'auto_fill_target_freq', autoFill);

                                                                                // Auto-fill immediately if enabled and transmitter is selected
                                                                                if (autoFill && task.config.transmitter_id) {
                                                                                    const transmitter = availableTransmitters.find(t => t.id === task.config.transmitter_id);
                                                                                    if (transmitter?.downlink_low) {
                                                                                        handleTaskConfigChange(index, 'target_center_freq', transmitter.downlink_low);
                                                                                    }
                                                                                }
                                                                            }}
                                                                            disabled={!task.config.enable_frequency_shift}
                                                                        />
                                                                    }
                                                                    label={t('scheduler_dialogs.shared.auto_fill_from_transmitter_frequency_label')}
                                                                />

                                                                <TextField
                                                                    fullWidth
                                                                    size="small"
                                                                    label={t('scheduler_dialogs.shared.target_center_frequency_hz_label')}
                                                                    type="number"
                                                                    value={task.config.target_center_freq || ''}
                                                                    onChange={(e) =>
                                                                        handleTaskConfigChange(index, 'target_center_freq', parseFloat(e.target.value) || '')
                                                                    }
                                                                    disabled={!task.config.enable_frequency_shift || task.config.auto_fill_target_freq}
                                                                />
                                                            </>

                                                            <Typography variant="caption" color="text.secondary">
                                                                {t('scheduler_dialogs.shared.iq_recording_help')}
                                                                {task.config.enable_frequency_shift
                                                                    ? ` ${t('scheduler_dialogs.shared.iq_recording_help_shifted')}`
                                                                    : ` ${t('scheduler_dialogs.shared.iq_recording_help_sample_rate')}`}
                                                                {formData.sdr.sample_rate && (task.config.decimation_factor || 1) > 1
                                                                    ? ` Decimated to ${formatSampleRate(formData.sdr.sample_rate / (task.config.decimation_factor || 1))}.`
                                                                    : ''}
                                                            </Typography>
                                                            {(() => {
                                                                const decimationOptions = getDecimationOptions(formData.sdr.sample_rate);
                                                                const decimationFactor = task.config.decimation_factor || 1;
                                                                const outputRate = formData.sdr.sample_rate
                                                                    ? formData.sdr.sample_rate / decimationFactor
                                                                    : null;

                                                                return (
                                                                    <FormControl fullWidth size="small" disabled={!formData.sdr.sample_rate}>
                                                                        <InputLabel>{t('scheduler_dialogs.shared.decimation_label')}</InputLabel>
                                                                        <Select
                                                                            value={decimationFactor}
                                                                            onChange={(e) =>
                                                                                handleTaskConfigChange(
                                                                                    index,
                                                                                    'decimation_factor',
                                                                                    parseInt(e.target.value, 10)
                                                                                )
                                                                            }
                                                                            label={t('scheduler_dialogs.shared.decimation_label')}
                                                                        >
                                                                            {decimationOptions.map((factor) => (
                                                                                <MenuItem key={factor} value={factor}>
                                                                                    {factor === 1
                                                                                        ? `None (${formatSampleRate(formData.sdr.sample_rate)})`
                                                                                        : `x${factor} (${formatSampleRate(formData.sdr.sample_rate / factor)})`}
                                                                                </MenuItem>
                                                                            ))}
                                                                        </Select>
                                                                        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                                                                            {t('scheduler_dialogs.shared.output_sample_rate_line', {
                                                                                rate: outputRate ? formatSampleRate(outputRate) : t('not_available'),
                                                                            })}
                                                                        </Typography>
                                                                        <Typography variant="caption" color="warning.main" sx={{ mt: 0.5, display: 'block' }}>
                                                                            {t('scheduler_dialogs.shared.decimation_center_hint')}
                                                                        </Typography>
                                                                    </FormControl>
                                                                );
                                                            })()}
                                                            <Box sx={{ mt: 2 }}>
                                                                <FormControlLabel
                                                                    control={
                                                                        <Checkbox
                                                                            checked={task.config.enable_post_processing || false}
                                                                            onChange={(e) => {
                                                                                const enabled = e.target.checked;
                                                                                handleTaskConfigChange(index, 'enable_post_processing', enabled);
                                                                                if (enabled && !task.config.post_process_pipeline) {
                                                                                    handleTaskConfigChange(index, 'post_process_pipeline', getDefaultSatdumpPipeline());
                                                                                }
                                                                                if (!enabled) {
                                                                                    handleTaskConfigChange(index, 'delete_after_post_processing', false);
                                                                                }
                                                                            }}
                                                                        />
                                                                    }
                                                                    label={t('scheduler_dialogs.shared.run_satdump_post_processing_label')}
                                                                />
                                                                <FormControl
                                                                    fullWidth
                                                                    size="small"
                                                                    disabled={!task.config.enable_post_processing}
                                                                    sx={{ mt: 1 }}
                                                                >
                                                                    <InputLabel>{t('scheduler_dialogs.shared.satdump_pipeline_label')}</InputLabel>
                                                                    <Select
                                                                        value={task.config.post_process_pipeline || getDefaultSatdumpPipeline()}
                                                                        onChange={(e) =>
                                                                            handleTaskConfigChange(index, 'post_process_pipeline', e.target.value)
                                                                        }
                                                                        label={t('scheduler_dialogs.shared.satdump_pipeline_label')}
                                                                    >
                                                                        {Object.entries(SATDUMP_PIPELINES).map(([key, group]) => {
                                                                            const pipelines = group?.pipelines || [];
                                                                            if (pipelines.length === 0) return null;
                                                                            const label = group.label || key;
                                                                            return [
                                                                                <MenuItem key={`satdump-header-${key}`} disabled sx={{ fontWeight: 'bold', fontSize: '0.875rem' }}>
                                                                                    {label}
                                                                                </MenuItem>,
                                                                                ...pipelines.map((pipeline) => (
                                                                                    <MenuItem key={pipeline.value} value={pipeline.value} sx={{ pl: 4 }}>
                                                                                        {pipeline.label} ({pipeline.value})
                                                                                    </MenuItem>
                                                                                ))
                                                                            ];
                                                                        })}
                                                                    </Select>
                                                                </FormControl>
                                                                <FormControlLabel
                                                                    control={
                                                                        <Checkbox
                                                                            checked={task.config.delete_after_post_processing || false}
                                                                            onChange={(e) =>
                                                                                handleTaskConfigChange(index, 'delete_after_post_processing', e.target.checked)
                                                                            }
                                                                            disabled={
                                                                                !task.config.enable_post_processing ||
                                                                                !task.config.post_process_pipeline
                                                                            }
                                                                        />
                                                                    }
                                                                    label={t('scheduler_dialogs.shared.delete_iq_after_satdump_label')}
                                                                />
                                                            </Box>
                                                        </>
                                                    )}
                                                </Stack>
                                            )}
                                        </Box>
                                    </Box>
                                    );
                                })}
                            </Stack>
                        )}
                    </Box>

                </Stack>
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
                    onClick={handleClose}
                    variant="outlined"
                    sx={{
                        borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.700' : 'grey.400',
                        '&:hover': {
                            borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.600' : 'grey.500',
                            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.200',
                        },
                    }}
                >
                    {t('cancel')}
                </Button>
                <Button
                    variant="contained"
                    onClick={handleSubmit}
                    disabled={!isFormValid() || isSaving}
                    startIcon={isSaving && <CircularProgress size={20} color="inherit" />}
                    sx={{
                        '&.Mui-disabled': {
                            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.400',
                            color: (theme) => theme.palette.mode === 'dark' ? 'grey.600' : 'grey.600',
                        },
                    }}
                >
                    {isSaving
                        ? t('scheduler_dialogs.shared.saving')
                        : (isEditingMonitoredSatellite ? t('scheduler_dialogs.shared.update_button') : t('save'))}
                </Button>
            </DialogActions>

            {/* Remove Session Confirmation Dialog */}
            <Dialog open={openRemoveSessionConfirm} onClose={() => setOpenRemoveSessionConfirm(false)}>
                <DialogTitle>{t('scheduler_dialogs.shared.remove_sdr_session_title')}</DialogTitle>
                <DialogContent
                    sx={{
                        bgcolor: (theme) => (
                            theme.palette.mode === 'dark'
                                ? theme.palette.background.elevated
                                : theme.palette.background.paper
                        ),
                    }}
                >
                    {t('scheduler_dialogs.shared.remove_sdr_session_confirm')}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setOpenRemoveSessionConfirm(false)} variant="outlined">
                        {t('cancel')}
                    </Button>
                    <Button onClick={handleRemoveSessionConfirm} variant="contained" color="error">
                        {t('scheduler_dialogs.shared.remove_button')}
                    </Button>
                </DialogActions>
            </Dialog>
        </Dialog>
    );
}
