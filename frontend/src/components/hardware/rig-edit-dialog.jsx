import * as React from "react";
import {
    Box,
    Button,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    FormHelperText,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    TextField,
} from "@mui/material";
import { useTranslation } from "react-i18next";
import CapsButton from '../common/capsbutton.jsx';

export default function RigEditDialog({
    open,
    onClose,
    isEditing,
    formValues,
    validationErrors,
    hasValidationErrors,
    loading,
    onChange,
    onSubmit,
}) {
    const { t } = useTranslation("hardware");
    const selectedRadioMode = formValues.radio_mode || "duplex";
    const radioModeHelpKey = `rig.radio_mode_help_${selectedRadioMode}`;
    const selectedTxControlMode = formValues.tx_control_mode || "auto";
    const txControlModeHelpKey = `rig.tx_mode_help_${selectedTxControlMode}`;

    return (
        <Dialog
            open={open}
            onClose={onClose}
            fullWidth
            maxWidth="sm"
            PaperProps={{
                sx: {
                    bgcolor: "background.paper",
                    border: (theme) => `1px solid ${theme.palette.divider}`,
                    borderRadius: 2,
                },
            }}
        >
            <DialogTitle
                sx={{
                    bgcolor: (theme) => theme.palette.mode === "dark" ? "grey.900" : "grey.100",
                    borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                    fontSize: "1.25rem",
                    fontWeight: "bold",
                    py: 2.5,
                }}
            >
                {isEditing ? t("rig.edit_dialog_title") : t("rig.add_dialog_title")}
            </DialogTitle>
            <DialogContent sx={{ px: 3, py: 3 }}>
                <Stack spacing={2} sx={{ mt: 3 }}>
                    <TextField
                        autoFocus
                        name="name"
                        label={t("rig.name")}
                        type="text"
                        fullWidth
                        size="small"
                        value={formValues.name}
                        onChange={onChange}
                        error={Boolean(validationErrors.name)}
                        required
                    />
                    <TextField
                        name="host"
                        label={t("rig.host")}
                        type="text"
                        fullWidth
                        size="small"
                        value={formValues.host}
                        onChange={onChange}
                        error={Boolean(validationErrors.host)}
                        required
                    />
                    <TextField
                        name="port"
                        label={t("rig.port")}
                        type="number"
                        fullWidth
                        size="small"
                        value={formValues.port}
                        onChange={onChange}
                        error={Boolean(validationErrors.port)}
                        required
                    />
                    <FormControl fullWidth size="small">
                        <InputLabel>{t("rig.radio_mode")}</InputLabel>
                        <Select
                            name="radio_mode"
                            label={t("rig.radio_mode")}
                            size="small"
                            value={formValues.radio_mode || "duplex"}
                            onChange={onChange}
                        >
                            <MenuItem value="monitor">{t("rig.radio_mode_monitor")}</MenuItem>
                            <MenuItem value="uplink_only">{t("rig.radio_mode_uplink_only")}</MenuItem>
                            <MenuItem value="simplex">{t("rig.radio_mode_simplex")}</MenuItem>
                            <MenuItem value="duplex">{t("rig.radio_mode_duplex")}</MenuItem>
                            <MenuItem value="ptt_guarded">{t("rig.radio_mode_ptt_guarded")}</MenuItem>
                        </Select>
                        <FormHelperText>{t(radioModeHelpKey)}</FormHelperText>
                    </FormControl>
                    <FormControl fullWidth size="small">
                        <InputLabel>{t("rig.tx_control_mode")}</InputLabel>
                        <Select
                            name="tx_control_mode"
                            label={t("rig.tx_control_mode")}
                            size="small"
                            value={formValues.tx_control_mode || "auto"}
                            onChange={onChange}
                        >
                            <MenuItem value="auto">{t("rig.tx_mode_auto")}</MenuItem>
                            <MenuItem value="vfo_switch">
                                {t("rig.tx_mode_vfo_switch")}
                            </MenuItem>
                            <MenuItem value="split_tx_cmd">
                                {t("rig.tx_mode_split_tx_cmd")}
                            </MenuItem>
                            <MenuItem value="vfo_explicit">
                                {t("rig.tx_mode_vfo_explicit")}
                            </MenuItem>
                        </Select>
                        <FormHelperText>{t(txControlModeHelpKey)}</FormHelperText>
                    </FormControl>
                    <Box>
                        <TextField
                            name="retune_interval_ms"
                            label={t("rig.retune_interval_ms")}
                            type="number"
                            fullWidth
                            size="small"
                            value={formValues.retune_interval_ms ?? 2000}
                            onChange={onChange}
                            error={Boolean(validationErrors.retune_interval_ms)}
                            required
                        />
                        <FormHelperText sx={{ mt: 0.5 }}>{t("rig.retune_interval_help")}</FormHelperText>
                    </Box>
                </Stack>
            </DialogContent>
            <DialogActions
                sx={{
                    bgcolor: (theme) => theme.palette.mode === "dark" ? "grey.900" : "grey.100",
                    borderTop: (theme) => `1px solid ${theme.palette.divider}`,
                    px: 3,
                    py: 2.5,
                    gap: 2,
                }}
            >
                <CapsButton
                    onClick={onClose}
                    variant="outlined"
                    sx={{
                        borderColor: (theme) => theme.palette.mode === "dark" ? "grey.700" : "grey.400",
                        "&:hover": {
                            borderColor: (theme) => theme.palette.mode === "dark" ? "grey.600" : "grey.500",
                            bgcolor: (theme) => theme.palette.mode === "dark" ? "grey.800" : "grey.200",
                        },
                    }}
                >
                    {t("rig.cancel")}
                </CapsButton>
                <CapsButton onClick={onSubmit} color="success" variant="contained" disabled={hasValidationErrors || loading}>
                    {t("rig.submit")}
                </CapsButton>
            </DialogActions>
        </Dialog>
    );
}
