
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
import {
    submitTransmitter,
    editTransmitter,
    setClickedSatelliteTransmitters,
} from "./satellite-slice.jsx";
import { setTargetTransmitters } from "../target/target-slice.jsx";
import {useSocket} from "../common/socket.jsx";


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
    const dispatch = useDispatch();
    const {socket} = useSocket();
    const { loading, error } = useSelector(state => state.satellites);

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

        setValidationErrors(errors);
        return Object.keys(errors).length === 0;
    };

    const handleSave = async () => {
        if (!validateForm()) {
            return;
        }

        const processedData = {
            ...formData,
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
                            Error: {error}
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
                            Please fill in all required fields. {hasFrequencyErrors && 'At least one uplink or downlink frequency must be provided.'}
                        </Typography>
                    </Box>
                )}

                <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 0 }}>

                    {/* Basic Information Section */}
                    <Typography variant="h6" sx={{ color: 'primary.main', mb: 2, fontWeight: 'bold' }}>
                        Basic Information
                    </Typography>

                    <TextField
                        size="small"
                        fullWidth
                        label="Description"
                        value={formData.description}
                        onChange={handleChange('description')}
                        placeholder="Enter transmitter description"
                        sx={getFieldSx('description')}
                        disabled={loading}
                        error={validationErrors.description}
                        required
                    />

                    {!isNew && (
                        <TextField
                            size="small"
                            fullWidth
                            label="Source"
                            value={sourceValue}
                            sx={getFieldSx('source')}
                            disabled
                        />
                    )}

                    <Box sx={{ display: 'flex', gap: 2, mb: 2.5 }}>
                        <FormControl fullWidth variant="outlined" error={validationErrors.type} size="small">
                            <InputLabel sx={getInputLabelSx('type')}>Type *</InputLabel>
                            <Select
                                value={formData.type}
                                onChange={handleChange('type')}
                                label="Type *"
                                disabled={loading}
                                sx={getSelectSx('type')}
                                required>
                                {TYPE_OPTIONS.map((option) => (
                                    <MenuItem key={option.value} value={option.value}>{option.name}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <FormControl fullWidth variant="outlined" error={validationErrors.status} size="small">
                            <InputLabel sx={getInputLabelSx('status')}>Status *</InputLabel>
                            <Select
                                value={formData.status}
                                onChange={handleChange('status')}
                                label="Status *"
                                disabled={loading}
                                sx={getSelectSx('status')}
                                required>
                                {STATUS_OPTIONS.map((option) => (
                                    <MenuItem key={option.value} value={option.value}>{option.name}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Box>

                    <FormControl fullWidth variant="outlined" sx={{ mb: 3 }} error={validationErrors.alive} size="small">
                        <InputLabel sx={getInputLabelSx('alive')}>Alive *</InputLabel>
                        <Select
                            value={formData.alive}
                            onChange={handleChange('alive')}
                            label="Alive *"
                            disabled={loading}
                            sx={getSelectSx('alive')}
                            required>
                            {ALIVE_OPTIONS.map((option) => (
                                <MenuItem key={option.value} value={option.value}>{option.name}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    {/* Uplink Frequencies Section */}
                    <Typography variant="h6" sx={{ color: 'primary.main', mb: 2, fontWeight: 'bold' }}>
                        Uplink Frequencies
                    </Typography>

                    <TextField
                        size="small"
                        fullWidth
                        label="Uplink Low (Hz)"
                        value={formData.uplinkLow}
                        onChange={handleChange('uplinkLow')}
                        type="number"
                        placeholder="e.g., 435000000"
                        sx={getFieldSx('uplinkLow')}
                        disabled={loading}
                        error={validationErrors.uplinkLow}
                    />

                    <TextField
                        size="small"
                        fullWidth
                        label="Uplink High (Hz)"
                        value={formData.uplinkHigh}
                        onChange={handleChange('uplinkHigh')}
                        type="number"
                        placeholder="e.g., 438000000"
                        sx={getFieldSx('uplinkHigh')}
                        disabled={loading}
                        error={validationErrors.uplinkHigh}
                    />

                    <TextField
                        size="small"
                        fullWidth
                        label="Uplink Drift (Hz)"
                        value={formData.uplinkDrift}
                        onChange={handleChange('uplinkDrift')}
                        type="number"
                        placeholder="e.g., 1000"
                        sx={{ ...getFieldSx('uplinkDrift'), mb: 3 }}
                        disabled={loading}
                    />

                    {/* Downlink Frequencies Section */}
                    <Typography variant="h6" sx={{ color: 'primary.main', mb: 2, fontWeight: 'bold' }}>
                        Downlink Frequencies
                    </Typography>

                    <TextField
                        size="small"
                        fullWidth
                        label="Downlink Low (Hz)"
                        value={formData.downlinkLow}
                        onChange={handleChange('downlinkLow')}
                        type="number"
                        placeholder="e.g., 145800000"
                        sx={getFieldSx('downlinkLow')}
                        disabled={loading}
                        error={validationErrors.downlinkLow}
                    />

                    <TextField
                        size="small"
                        fullWidth
                        label="Downlink High (Hz)"
                        value={formData.downlinkHigh}
                        onChange={handleChange('downlinkHigh')}
                        type="number"
                        placeholder="e.g., 145900000"
                        sx={getFieldSx('downlinkHigh')}
                        disabled={loading}
                        error={validationErrors.downlinkHigh}
                    />

                    <TextField
                        size="small"
                        fullWidth
                        label="Downlink Drift (Hz)"
                        value={formData.downlinkDrift}
                        onChange={handleChange('downlinkDrift')}
                        type="number"
                        placeholder="e.g., 500"
                        sx={{ ...getFieldSx('downlinkDrift'), mb: 3 }}
                        disabled={loading}
                    />

                    {/* Transmission Settings Section */}
                    <Typography variant="h6" sx={{ color: 'primary.main', mb: 2, fontWeight: 'bold' }}>
                        Transmission Settings
                    </Typography>

                    <Box sx={{ display: 'flex', gap: 2, mb: 2.5 }}>
                        <FormControl fullWidth variant="outlined" size="small">
                            <InputLabel sx={getInputLabelSx('mode')}>Downlink mode</InputLabel>
                            <Select
                                value={formData.mode}
                                onChange={handleChange('mode')}
                                label="Downlink mode"
                                disabled={loading}
                                sx={getSelectSx('mode')}
                            >
                                {MODE_OPTIONS.map((option) => (
                                    <MenuItem key={option.value} value={option.value}>{option.name}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <FormControl fullWidth variant="outlined" size="small">
                            <InputLabel sx={getInputLabelSx('uplinkMode')}>Uplink mode</InputLabel>
                            <Select
                                value={formData.uplinkMode}
                                onChange={handleChange('uplinkMode')}
                                label="Uplink mode"
                                disabled={loading}
                                sx={getSelectSx('uplinkMode')}
                            >
                                {MODE_OPTIONS.map((option) => (
                                    <MenuItem key={option.value} value={option.value}>{option.name}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Box>

                    <Box sx={{ display: 'flex', gap: 2, mb: 0 }}>
                        <FormControl fullWidth variant="outlined" size="small">
                            <InputLabel sx={getInputLabelSx('invert')}>Invert</InputLabel>
                            <Select
                                value={formData.invert}
                                onChange={handleChange('invert')}
                                label="Invert"
                                disabled={loading}
                                sx={getSelectSx('invert')}
                            >
                                {INVERT_OPTIONS.map((option) => (
                                    <MenuItem key={option.value} value={option.value}>{option.name}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <TextField
                            size="small"
                            fullWidth
                            label="Baud Rate"
                            value={formData.baud}
                            onChange={handleChange('baud')}
                            type="number"
                            placeholder="e.g., 9600"
                            disabled={loading}
                        />
                    </Box>
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
                    Cancel
                </Button>
                <Button
                    onClick={handleSave}
                    variant="contained"
                    disabled={loading}
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
                Confirm Delete
            </DialogTitle>
            <DialogContent sx={{ px: 3, py: 3, mt: 2 }}>
                <Typography>
                    Are you sure you want to delete the transmitter "{transmitterName}"?
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
                    Cancel
                </Button>
                <Button onClick={onConfirm} variant="contained" color="error">
                    Delete
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default TransmitterModal;
