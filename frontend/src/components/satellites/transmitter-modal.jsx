
import {Box, Typography, Dialog, DialogTitle, DialogContent, DialogActions, TextField, InputLabel, Tooltip} from "@mui/material";
import Button from "@mui/material/Button";
import * as React from "react";
import {useEffect, useState, useCallback} from "react";
import Grid from "@mui/material/Grid";
import {
    DataGrid,
    GridActionsCellItem,
    GridToolbarContainer,
} from "@mui/x-data-grid";
import AddIcon from "@mui/icons-material/Add";
import EditIcon from "@mui/icons-material/Edit";
import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import {useDispatch, useSelector} from "react-redux";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import FormHelperText from "@mui/material/FormHelperText";
import {
    submitTransmitter,
    editTransmitter,
    setClickedSatelliteTransmitters,
} from "./satellite-slice.jsx";
import { setTargetTransmitters } from "../target/target-slice.jsx";
import {useSocket} from "../common/socket.jsx";
import { useTranslation } from 'react-i18next';
import {getLoraParameters, isDecoderParameterValid} from '../waterfall/decoder-parameters.js';
import {DecoderNumberField} from '../waterfall/decoder-number-field.jsx';


// Define the dropdown options
const STATUS_OPTIONS = [
    {name: "active", value: "active"},
    {name: "inactive", value: "inactive"},
    {name: "dead", value: "dead"},
    {name: "alive", value: "alive"}
];
const TYPE_OPTIONS = [
    {name: "Telemetry", value: "Telemetry"},
    {name: "Transmitter", value: "Transmitter"},
    {name: "Transceiver", value: "Transceiver"},
    {name: "Beacon", value: "Beacon"},
    {name: "Transponder", value: "Transponder"}
];
const ALIVE_OPTIONS = [
    {name: "true", value: true},
    {name: "false", value: false}
];
const INVERT_OPTIONS = [
    {name: "true", value: true},
    {name: "false", value: false},
];
const MODE_OPTIONS = [
    {name: "4FSK", value: "4FSK"},
    {name: "AFSK", value: "AFSK"},
    {name: "AFSK TUBiX10", value: "AFSK TUBiX10"},
    {name: "AHRPT", value: "AHRPT"},
    {name: "AM", value: "AM"},
    {name: "APT", value: "APT"},
    {name: "BPSK", value: "BPSK"},
    {name: "BPSK PMT-A3", value: "BPSK PMT-A3"},
    {name: "CERTO", value: "CERTO"},
    {name: "CW", value: "CW"},
    {name: "DBPSK", value: "DBPSK"},
    {name: "DOKA", value: "DOKA"},
    {name: "DPSK", value: "DPSK"},
    {name: "DQPSK", value: "DQPSK"},
    {name: "DSB", value: "DSB"},
    {name: "DSTAR", value: "DSTAR"},
    {name: "DUV", value: "DUV"},
    {name: "DVB-S2", value: "DVB-S2"},
    {name: "FFSK", value: "FFSK"},
    {name: "FM", value: "FM"},
    {name: "FMN", value: "FMN"},
    {name: "FSK", value: "FSK"},
    {name: "FSK AX.100 Mode 5", value: "FSK AX.100 Mode 5"},
    {name: "FSK AX.25 G3RUH", value: "FSK AX.25 G3RUH"},
    {name: "GFSK", value: "GFSK"},
    {name: "GMSK", value: "GMSK"},
    {name: "GMSK USP", value: "GMSK USP"},
    {name: "HRPT", value: "HRPT"},
    {name: "LRPT", value: "LRPT"},
    {name: "LSB", value: "LSB"},
    {name: "LoRa", value: "LoRa"},
    {name: "MSK", value: "MSK"},
    {name: "MSK AX.100 Mode 5", value: "MSK AX.100 Mode 5"},
    {name: "OFDM", value: "OFDM"},
    {name: "OQPSK", value: "OQPSK"},
    {name: "PSK", value: "PSK"},
    {name: "QPSK", value: "QPSK"},
    {name: "QPSK31", value: "QPSK31"},
    {name: "SQPSK", value: "SQPSK"},
    {name: "SSTV", value: "SSTV"},
    {name: "USB", value: "USB"},
    {name: "WSJT", value: "WSJT"},
    {name: "GGAK", value: "GGAK"},
    {name: "PGS", value: "PGS"},
];
const FSK_FRAMING_OPTIONS = [
    {value: 'ax25', label: 'AX.25 (G3RUH)'},
    {value: 'usp', label: 'USP'},
    {value: 'geoscan', label: 'GEOSCAN'},
    {value: 'doka', label: 'DOKA (CCSDS)'},
    {value: 'ax100_asm', label: 'AX100 (ASM + Golay)'},
    {value: 'ax100_rs', label: 'AX100 (Reed-Solomon)'},
];


// Transmitter Edit/Add Modal Component
const TransmitterModal = ({
    open,
    onClose,
    onSavedTransmitters,
    transmitter,
    satelliteId,
    targetKey,
    isNew = false,
}) => {
    const { t } = useTranslation('satellites');
    const dispatch = useDispatch();
    const {socket} = useSocket();
    const { loading, error } = useSelector(state => state.satellites);
    const loraParameters = React.useMemo(() => getLoraParameters(), []);

    const [formData, setFormData] = useState({
        description: "",
        type: "",
        status: "",
        alive: "",
        uplinkLow: "",
        uplinkHigh: "",
        uplinkDrift: "",
        downlinkLow: "",
        downlinkHigh: "",
        downlinkDrift: "",
        mode: "",
        uplinkMode: "",
        invert: "",
        baud: "",
        deviation: "",
        framing: "",
        loraConfig: {},
    });

    const [validationErrors, setValidationErrors] = useState({});
    const normalizedTargetKey = String(targetKey || '').trim();
    const hasSatelliteOwner = satelliteId != null && String(satelliteId).trim() !== '';

    const fromNullableField = useCallback((value) => {
        if (value === "-" || value === null || value === undefined) {
            return "";
        }
        return value;
    }, []);

    const hasValue = useCallback((value) => {
        return !(value === "" || value === null || value === undefined);
    }, []);

    const toNullableField = useCallback((value) => {
        if (value === null || value === undefined) {
            return null;
        }
        if (typeof value === "string" && value.trim() === "") {
            return null;
        }
        return value;
    }, []);

    useEffect(() => {
        if (transmitter) {
            setFormData({
                description: fromNullableField(transmitter.description),
                type: fromNullableField(transmitter.type),
                status: fromNullableField(transmitter.status),
                alive: fromNullableField(transmitter.alive),
                uplinkLow: fromNullableField(transmitter.uplinkLow),
                uplinkHigh: fromNullableField(transmitter.uplinkHigh),
                uplinkDrift: fromNullableField(transmitter.uplinkDrift),
                downlinkLow: fromNullableField(transmitter.downlinkLow),
                downlinkHigh: fromNullableField(transmitter.downlinkHigh),
                downlinkDrift: fromNullableField(transmitter.downlinkDrift),
                mode: fromNullableField(transmitter.mode),
                uplinkMode: fromNullableField(transmitter.uplinkMode),
                invert: fromNullableField(transmitter.invert),
                baud: fromNullableField(transmitter.baud),
                deviation: fromNullableField(transmitter.deviation),
                framing: fromNullableField(transmitter.framing),
                loraConfig: {...(transmitter._original?.lora_config || transmitter.lora_config || {})},
            });
        } else {
            // Reset form for new transmitter
            setFormData({
                description: "",
                type: "",
                status: "",
                alive: "",
                uplinkLow: "",
                uplinkHigh: "",
                uplinkDrift: "",
                downlinkLow: "",
                downlinkHigh: "",
                downlinkDrift: "",
                mode: "",
                uplinkMode: "",
                invert: "",
                baud: "",
                deviation: "",
                framing: "",
                loraConfig: {},
            });
        }
        // Clear validation errors when modal opens/closes
        setValidationErrors({});
    }, [transmitter, open, fromNullableField]);

    const handleChange = (field) => (event) => {
        setFormData(prev => ({
            ...prev,
            [field]: event.target.value
        }));

        // Clear validation error for this field when user starts typing
        if (validationErrors[field]) {
            setValidationErrors(prev => ({
                ...prev,
                [field]: false
            }));
        }
    };

    const handleLoraChange = (key, value) => {
        setFormData((current) => {
            const loraConfig = {...current.loraConfig};
            if (value === null) {
                delete loraConfig[key];
            } else {
                loraConfig[key] = value;
            }
            return {...current, loraConfig};
        });
    };

    const hasInvalidLoraParameters = String(formData.mode).toLowerCase() === 'lora'
        && Object.entries(loraParameters).some(([parameterKey, definition]) => {
            const value = formData.loraConfig[parameterKey.slice('lora_'.length)];
            return value != null && !isDecoderParameterValid(definition, value);
        });

    const validateForm = () => {
        const errors = {};

        // Required fields
        if (!formData.description.trim()) {
            errors.description = true;
        }
        if (!formData.type) {
            errors.type = true;
        }
        if (!formData.status) {
            errors.status = true;
        }
        if (formData.alive === "" || formData.alive === null || formData.alive === undefined) {
            errors.alive = true;
        }

        // At least one uplink or downlink value must be provided
        const hasUplink = hasValue(formData.uplinkLow) || hasValue(formData.uplinkHigh);
        const hasDownlink = hasValue(formData.downlinkLow) || hasValue(formData.downlinkHigh);

        if (!hasUplink && !hasDownlink) {
            errors.uplinkLow = true;
            errors.uplinkHigh = true;
            errors.downlinkLow = true;
            errors.downlinkHigh = true;
        }

        if (hasValue(formData.deviation) &&
            (!Number.isFinite(Number(formData.deviation)) || Number(formData.deviation) === 0)) {
            errors.deviation = true;
        }

        setValidationErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleSave = async () => {
        if (hasInvalidLoraParameters || !validateForm()) {
            return;
        }

        const {loraConfig, ...otherFormData} = formData;
        const processedData = {
            ...otherFormData,
            // Convert empty UI values to null for backend normalization.
            description: toNullableField(formData.description),
            type: toNullableField(formData.type),
            status: toNullableField(formData.status),
            alive: toNullableField(formData.alive),
            uplinkLow: toNullableField(formData.uplinkLow),
            uplinkHigh: toNullableField(formData.uplinkHigh),
            uplinkDrift: toNullableField(formData.uplinkDrift),
            downlinkLow: toNullableField(formData.downlinkLow),
            downlinkHigh: toNullableField(formData.downlinkHigh),
            downlinkDrift: toNullableField(formData.downlinkDrift),
            mode: toNullableField(formData.mode),
            uplinkMode: toNullableField(formData.uplinkMode),
            invert: formData.invert === "" ? null : formData.invert,
            baud: toNullableField(formData.baud),
            deviation: toNullableField(formData.deviation),
            framing: toNullableField(formData.framing),
            lora_config: String(formData.mode).toLowerCase() === 'lora' && Object.keys(loraConfig).length
                ? loraConfig
                : null,
        };

        // Keep satellite payloads unchanged while enabling mission/body ownership via target_key.
        const ownerPayload = normalizedTargetKey
            ? { target_key: normalizedTargetKey }
            : (hasSatelliteOwner ? { satelliteId } : null);
        if (!ownerPayload) {
            console.error('Missing transmitter owner. Expected satelliteId or target_key.');
            return;
        }

        const transmitterData = {
            ...processedData,
            ...ownerPayload,
            ...(isNew ? {} : { id: transmitter.id })
        };

        try {
            if (isNew) {
                const result = await dispatch(submitTransmitter({
                    socket,
                    transmitterData
                })).unwrap();

                // Update the transmitters with the response
                if (!normalizedTargetKey) {
                    dispatch(setClickedSatelliteTransmitters(result));
                }
                dispatch(
                    setTargetTransmitters({
                        noradId: hasSatelliteOwner ? satelliteId : null,
                        targetKey: normalizedTargetKey || null,
                        transmitters: result,
                        updatedAtMs: Date.now(),
                        lockDurationMs: 5000,
                    })
                );
                onSavedTransmitters?.(result);
            } else {
                const result = await dispatch(editTransmitter({
                    socket,
                    transmitterData
                })).unwrap();

                // Update the transmitters with the response
                if (!normalizedTargetKey) {
                    dispatch(setClickedSatelliteTransmitters(result));
                }
                dispatch(
                    setTargetTransmitters({
                        noradId: hasSatelliteOwner ? satelliteId : null,
                        targetKey: normalizedTargetKey || null,
                        transmitters: result,
                        updatedAtMs: Date.now(),
                        lockDurationMs: 5000,
                    })
                );
                onSavedTransmitters?.(result);
            }

            // Close modal on successful submission
            onClose();

        } catch (error) {
            // Error is handled by Redux state, modal stays open for user to retry
            console.error('Failed to submit transmitter:', error);
        }
    };

    const getFieldSx = (fieldName) => ({
        mb: 2.5
    });

    const getSelectSx = (fieldName) => ({
        // Select styling handled by theme
    });

    const getInputLabelSx = (fieldName) => ({
        // Label styling handled by theme
    });

    const hasFrequencyErrors = validationErrors.uplinkLow || validationErrors.uplinkHigh ||
        validationErrors.downlinkLow || validationErrors.downlinkHigh;
    const sourceValue = transmitter?._original?.source ?? transmitter?.source ?? "-";

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="sm"
            fullWidth
            PaperProps={{
                sx: {
                    bgcolor: 'background.paper',
                    border: (theme) => `1px solid ${theme.palette.divider}`,
                    borderRadius: 2,
                    minHeight: '600px'
                }
            }}
        >
            <DialogTitle
                sx={{
                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100',
                    borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                    fontSize: '1.25rem',
                    fontWeight: 'bold',
                    py: 2.5
                }}
            >
                {isNew ? 'Add New Transmitter' : 'Edit Transmitter'}
            </DialogTitle>
            <DialogContent sx={{ px: 3, py: 3 }}>
                <Box sx={{ mt: 2 }}>
                {error && (
                    <Box sx={{
                        mb: 2,
                        p: 2,
                        bgcolor: 'error.main',
                        borderRadius: 1,
                        color: 'error.contrastText'
                    }}>
                        <Typography variant="body2">
                            {t('transmitter_modal.error', { defaultValue: 'Error:' })} {error}
                        </Typography>
                    </Box>
                )}

                {Object.keys(validationErrors).length > 0 && (
                    <Box sx={{
                        mt: 2,
                        mb: 2,
                        p: 2,
                        bgcolor: 'error.main',
                        borderRadius: 1,
                        color: 'error.contrastText'
                    }}>
                        <Typography variant="body2">
                            {t('transmitter_modal.please_fill_in_all_required_fields', { defaultValue: 'Please fill in all required fields.' })} {hasFrequencyErrors && 'At least one uplink or downlink frequency must be provided.'}
                        </Typography>
                    </Box>
                )}

                <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 0 }}>

                    {/* Basic Information Section */}
                    <Typography variant="h6" sx={{ color: 'primary.main', mb: 2, fontWeight: 'bold' }}>
                        {t('transmitter_modal.basic_information', { defaultValue: 'Basic Information' })}
                    </Typography>

                    <TextField
                        size="small"
                        fullWidth
                        label={t('transmitter_modal.description', { defaultValue: 'Description' })}
                        value={formData.description}
                        onChange={handleChange('description')}
                        placeholder={t('transmitter_modal.enter_transmitter_description', { defaultValue: 'Enter transmitter description' })}
                        sx={getFieldSx('description')}
                        disabled={loading}
                        error={validationErrors.description}
                        helperText={t('transmitter_modal.help.description')}
                        required
                    />

                    {!isNew && (
                        <TextField
                            size="small"
                            fullWidth
                            label={t('transmitter_modal.source', { defaultValue: 'Source' })}
                            value={sourceValue}
                            sx={getFieldSx('source')}
                            disabled
                            helperText={t('transmitter_modal.help.source')}
                        />
                    )}

                    <Box sx={{ display: 'flex', gap: 2, mb: 2.5 }}>
                        <FormControl fullWidth variant="outlined" error={validationErrors.type} size="small">
                            <InputLabel sx={getInputLabelSx('type')}>{t('transmitter_modal.type', { defaultValue: 'Type *' })}</InputLabel>
                            <Select
                                value={formData.type}
                                onChange={handleChange('type')}
                                label={t('transmitter_modal.type', { defaultValue: 'Type *' })}
                                disabled={loading}
                                sx={getSelectSx('type')}
                                required>
                                {TYPE_OPTIONS.map((option) => (
                                    <MenuItem key={option.value} value={option.value}>{option.name}</MenuItem>
                                ))}
                            </Select>
                            <FormHelperText>{t('transmitter_modal.help.type')}</FormHelperText>
                        </FormControl>

                        <FormControl fullWidth variant="outlined" error={validationErrors.status} size="small">
                            <InputLabel sx={getInputLabelSx('status')}>{t('transmitter_modal.status', { defaultValue: 'Status *' })}</InputLabel>
                            <Select
                                value={formData.status}
                                onChange={handleChange('status')}
                                label={t('transmitter_modal.status', { defaultValue: 'Status *' })}
                                disabled={loading}
                                sx={getSelectSx('status')}
                                required>
                                {STATUS_OPTIONS.map((option) => (
                                    <MenuItem key={option.value} value={option.value}>{option.name}</MenuItem>
                                ))}
                            </Select>
                            <FormHelperText>{t('transmitter_modal.help.status')}</FormHelperText>
                        </FormControl>
                    </Box>

                    <FormControl fullWidth variant="outlined" sx={{ mb: 3 }} error={validationErrors.alive} size="small">
                        <InputLabel sx={getInputLabelSx('alive')}>{t('transmitter_modal.alive', { defaultValue: 'Alive *' })}</InputLabel>
                        <Select
                            value={formData.alive}
                            onChange={handleChange('alive')}
                            label={t('transmitter_modal.alive', { defaultValue: 'Alive *' })}
                            disabled={loading}
                            sx={getSelectSx('alive')}
                            required>
                            {ALIVE_OPTIONS.map((option) => (
                                <MenuItem key={option.value} value={option.value}>{option.name}</MenuItem>
                            ))}
                        </Select>
                        <FormHelperText>{t('transmitter_modal.help.alive')}</FormHelperText>
                    </FormControl>

                    {/* Uplink Frequencies Section */}
                    <Typography variant="h6" sx={{ color: 'primary.main', mb: 2, fontWeight: 'bold' }}>
                        {t('transmitter_modal.uplink_frequencies', { defaultValue: 'Uplink Frequencies' })}
                    </Typography>

                    <TextField
                        size="small"
                        fullWidth
                        label={t('transmitter_modal.uplink_low_hz', { defaultValue: 'Uplink Low (Hz)' })}
                        value={formData.uplinkLow}
                        onChange={handleChange('uplinkLow')}
                        type="number"
                        placeholder="e.g., 435000000"
                        sx={getFieldSx('uplinkLow')}
                        disabled={loading}
                        error={validationErrors.uplinkLow}
                        helperText={t('transmitter_modal.help.uplink_low')}
                    />

                    <TextField
                        size="small"
                        fullWidth
                        label={t('transmitter_modal.uplink_high_hz', { defaultValue: 'Uplink High (Hz)' })}
                        value={formData.uplinkHigh}
                        onChange={handleChange('uplinkHigh')}
                        type="number"
                        placeholder="e.g., 438000000"
                        sx={getFieldSx('uplinkHigh')}
                        disabled={loading}
                        error={validationErrors.uplinkHigh}
                        helperText={t('transmitter_modal.help.uplink_high')}
                    />

                    <TextField
                        size="small"
                        fullWidth
                        label={t('transmitter_modal.uplink_drift_hz', { defaultValue: 'Uplink Drift (Hz)' })}
                        value={formData.uplinkDrift}
                        onChange={handleChange('uplinkDrift')}
                        type="number"
                        placeholder="e.g., 1000"
                        sx={{ ...getFieldSx('uplinkDrift'), mb: 3 }}
                        disabled={loading}
                        helperText={t('transmitter_modal.help.uplink_drift')}
                    />

                    {/* Downlink Frequencies Section */}
                    <Typography variant="h6" sx={{ color: 'primary.main', mb: 2, fontWeight: 'bold' }}>
                        {t('transmitter_modal.downlink_frequencies', { defaultValue: 'Downlink Frequencies' })}
                    </Typography>

                    <TextField
                        size="small"
                        fullWidth
                        label={t('transmitter_modal.downlink_low_hz', { defaultValue: 'Downlink Low (Hz)' })}
                        value={formData.downlinkLow}
                        onChange={handleChange('downlinkLow')}
                        type="number"
                        placeholder="e.g., 145800000"
                        sx={getFieldSx('downlinkLow')}
                        disabled={loading}
                        error={validationErrors.downlinkLow}
                        helperText={t('transmitter_modal.help.downlink_low')}
                    />

                    <TextField
                        size="small"
                        fullWidth
                        label={t('transmitter_modal.downlink_high_hz', { defaultValue: 'Downlink High (Hz)' })}
                        value={formData.downlinkHigh}
                        onChange={handleChange('downlinkHigh')}
                        type="number"
                        placeholder="e.g., 145900000"
                        sx={getFieldSx('downlinkHigh')}
                        disabled={loading}
                        error={validationErrors.downlinkHigh}
                        helperText={t('transmitter_modal.help.downlink_high')}
                    />

                    <TextField
                        size="small"
                        fullWidth
                        label={t('transmitter_modal.downlink_drift_hz', { defaultValue: 'Downlink Drift (Hz)' })}
                        value={formData.downlinkDrift}
                        onChange={handleChange('downlinkDrift')}
                        type="number"
                        placeholder="e.g., 500"
                        sx={{ ...getFieldSx('downlinkDrift'), mb: 3 }}
                        disabled={loading}
                        helperText={t('transmitter_modal.help.downlink_drift')}
                    />

                    {/* Transmission Settings Section */}
                    <Typography variant="h6" sx={{ color: 'primary.main', mb: 2, fontWeight: 'bold' }}>
                        {t('transmitter_modal.transmission_settings', { defaultValue: 'Transmission Settings' })}
                    </Typography>

                    <Box sx={{ display: 'flex', gap: 2, mb: 2.5 }}>
                        <FormControl fullWidth variant="outlined" size="small">
                            <InputLabel sx={getInputLabelSx('mode')}>{t('transmitter_modal.downlink_mode', { defaultValue: 'Downlink mode' })}</InputLabel>
                            <Select
                                value={formData.mode}
                                onChange={handleChange('mode')}
                                label={t('transmitter_modal.downlink_mode', { defaultValue: 'Downlink mode' })}
                                disabled={loading}
                                sx={getSelectSx('mode')}
                            >
                                {MODE_OPTIONS.map((option) => (
                                    <MenuItem key={option.value} value={option.value}>{option.name}</MenuItem>
                                ))}
                            </Select>
                            <FormHelperText>{t('transmitter_modal.help.downlink_mode')}</FormHelperText>
                        </FormControl>

                        <FormControl fullWidth variant="outlined" size="small">
                            <InputLabel sx={getInputLabelSx('uplinkMode')}>{t('transmitter_modal.uplink_mode', { defaultValue: 'Uplink mode' })}</InputLabel>
                            <Select
                                value={formData.uplinkMode}
                                onChange={handleChange('uplinkMode')}
                                label={t('transmitter_modal.uplink_mode', { defaultValue: 'Uplink mode' })}
                                disabled={loading}
                                sx={getSelectSx('uplinkMode')}
                            >
                                {MODE_OPTIONS.map((option) => (
                                    <MenuItem key={option.value} value={option.value}>{option.name}</MenuItem>
                                ))}
                            </Select>
                            <FormHelperText>{t('transmitter_modal.help.uplink_mode')}</FormHelperText>
                        </FormControl>
                    </Box>

                    <Box sx={{ display: 'flex', gap: 2, mb: 0 }}>
                        <FormControl fullWidth variant="outlined" size="small">
                            <InputLabel sx={getInputLabelSx('invert')}>{t('transmitter_modal.invert', { defaultValue: 'Invert' })}</InputLabel>
                            <Select
                                value={formData.invert}
                                onChange={handleChange('invert')}
                                label={t('transmitter_modal.invert', { defaultValue: 'Invert' })}
                                disabled={loading}
                                sx={getSelectSx('invert')}
                            >
                                {INVERT_OPTIONS.map((option) => (
                                    <MenuItem key={option.value} value={option.value}>{option.name}</MenuItem>
                                ))}
                            </Select>
                            <FormHelperText>{t('transmitter_modal.help.invert')}</FormHelperText>
                        </FormControl>

                        <TextField
                            size="small"
                            fullWidth
                            label={t('transmitter_modal.baud_rate', { defaultValue: 'Baud Rate' })}
                            value={formData.baud}
                            onChange={handleChange('baud')}
                            type="number"
                            placeholder="e.g., 9600"
                            disabled={loading}
                            helperText={t('transmitter_modal.help.baud')}
                        />
                    </Box>
                    <Box sx={{ display: 'flex', gap: 2, mt: 2.5 }}>
                        <TextField
                            size="small"
                            fullWidth
                            label={t('transmitter_modal.deviation_hz', { defaultValue: 'FSK deviation (Hz)' })}
                            value={formData.deviation}
                            onChange={handleChange('deviation')}
                            type="number"
                            inputProps={{ step: 'any' }}
                            placeholder="e.g., 562.5"
                            helperText={t('transmitter_modal.deviation_help', { defaultValue: 'Half the spacing between FSK tones; a negative value reverses polarity.' })}
                            disabled={loading}
                            error={validationErrors.deviation}
                        />
                        <FormControl fullWidth variant="outlined" size="small">
                            <InputLabel>{t('transmitter_modal.framing', { defaultValue: 'FSK framing' })}</InputLabel>
                            <Select
                                value={formData.framing}
                                onChange={handleChange('framing')}
                                label={t('transmitter_modal.framing', { defaultValue: 'FSK framing' })}
                                disabled={loading}
                            >
                                <MenuItem value="">{t('transmitter_modal.framing_auto', { defaultValue: 'Auto' })}</MenuItem>
                                {FSK_FRAMING_OPTIONS.map((option) => (
                                    <MenuItem key={option.value} value={option.value}>{option.label}</MenuItem>
                                ))}
                            </Select>
                            <FormHelperText>{t('transmitter_modal.help.framing')}</FormHelperText>
                        </FormControl>
                    </Box>

                    {String(formData.mode).toLowerCase() === 'lora' && (
                        <Box sx={{mt: 3}}>
                            <Typography variant="h6" sx={{color: 'primary.main', mb: 1, fontWeight: 'bold'}}>
                                {t('transmitter_modal.lora_profile', {defaultValue: 'LoRa receiver profile'})}
                            </Typography>
                            <Typography variant="body2" color="text.secondary" sx={{mb: 2}}>
                                {t('transmitter_modal.lora_profile_help', {
                                    defaultValue: 'Only specified values are stored; unspecified values use decoder defaults.',
                                })}
                            </Typography>
                            <Box sx={{display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 2}}>
                                {Object.entries(loraParameters).map(([parameterKey, definition]) => {
                                    const key = parameterKey.slice('lora_'.length);
                                    const currentValue = formData.loraConfig[key];
                                    // Numeric definitions have bounds instead of dropdown options.
                                    if (definition.type === 'number') {
                                        return <DecoderNumberField
                                            key={key}
                                            definition={definition}
                                            value={currentValue ?? ''}
                                            optional
                                            disabled={loading}
                                            onChange={(value) => handleLoraChange(key, value === '' ? null : value)}
                                        />;
                                    }
                                    const options = definition.type === 'switch'
                                        ? [{value: true, label: 'On'}, {value: false, label: 'Off'}]
                                        : definition.options;
                                    const hasListedValue = options.some((option) =>
                                        JSON.stringify(option.value) === JSON.stringify(currentValue));
                                    return (
                                        <FormControl key={key} fullWidth size="small">
                                            <InputLabel>{definition.label}</InputLabel>
                                            <Select
                                                value={JSON.stringify(formData.loraConfig[key] ?? null)}
                                                onChange={(event) => handleLoraChange(key, JSON.parse(event.target.value))}
                                                label={definition.label}
                                                disabled={loading}
                                            >
                                                <MenuItem value="null">Unspecified</MenuItem>
                                                {currentValue != null && !hasListedValue && (
                                                    <MenuItem value={JSON.stringify(currentValue)}>
                                                        {Array.isArray(currentValue)
                                                            ? currentValue.join(', ')
                                                            : String(currentValue)} (current)
                                                    </MenuItem>
                                                )}
                                                {options.map((option) => (
                                                    <MenuItem key={JSON.stringify(option.value)} value={JSON.stringify(option.value)}>
                                                        {option.label}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                            {definition.description && (
                                                <Typography variant="caption" color="text.secondary" sx={{mt: 0.5}}>
                                                    {definition.description}
                                                </Typography>
                                            )}
                                        </FormControl>
                                    );
                                })}
                            </Box>
                        </Box>
                    )}
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
                    onClick={onClose}
                    variant="outlined"
                    disabled={loading}
                    sx={{
                        borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.700' : 'grey.400',
                        '&:hover': {
                            borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.600' : 'grey.500',
                            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.200',
                        },
                    }}
                >
                    {t('transmitter_modal.cancel', { defaultValue: 'Cancel' })}
                </Button>
                <Button
                    onClick={handleSave}
                    variant="contained"
                    disabled={loading || hasInvalidLoraParameters}
                    sx={{
                        '&.Mui-disabled': {
                            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.400',
                            color: (theme) => theme.palette.mode === 'dark' ? 'grey.600' : 'grey.600',
                        },
                    }}
                >
                    {loading ?
                        (isNew ? 'Adding...' : 'Saving...') :
                        (isNew ? 'Add Transmitter' : 'Save Changes')
                    }
                </Button>
            </DialogActions>
        </Dialog>
    );
};

// Delete Confirmation Dialog Component
export const DeleteConfirmDialog = ({ open, onClose, onConfirm, transmitterName }) => {
    const { t } = useTranslation('satellites');
    return (
        <Dialog
            open={open}
            onClose={onClose}
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
                }}
            >
                {t('transmitter_modal.confirm_delete', { defaultValue: 'Confirm Delete' })}
            </DialogTitle>
            <DialogContent sx={{ px: 3, py: 3, mt: 2 }}>
                <Typography>
                    {t('transmitter_modal.are_you_sure_you_want_to_delete_the_transmitter', { defaultValue: 'Are you sure you want to delete the transmitter "' })}{transmitterName}"?
                </Typography>
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
                    onClick={onClose}
                    variant="outlined"
                    sx={{
                        borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.700' : 'grey.400',
                        '&:hover': {
                            borderColor: (theme) => theme.palette.mode === 'dark' ? 'grey.600' : 'grey.500',
                            bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.200',
                        },
                    }}
                >
                    {t('transmitter_modal.cancel', { defaultValue: 'Cancel' })}
                </Button>
                <Button onClick={onConfirm} variant="contained" color="error">
                    {t('transmitter_modal.delete', { defaultValue: 'Delete' })}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default TransmitterModal;
