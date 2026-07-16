import * as React from "react";
import {
    Alert,
    Box,
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    InputAdornment,
    MenuItem,
    Stack,
    TextField,
} from "@mui/material";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import { useTranslation } from "react-i18next";
import { isEmptyRotatorValue } from "./rotator-edit-logic.js";

export default function RotatorEditDialog({
    open,
    onClose,
    isEditing,
    formValues,
    validationErrors,
    hasValidationErrors,
    loading,
    onChange,
    onSubmit,
    onPatchValues,
}) {
    const { t } = useTranslation("hardware");
    const [parkPositionEnabled, setParkPositionEnabled] = React.useState(false);

    React.useEffect(() => {
        if (!open) return;
        const hasParkValues = !isEmptyRotatorValue(formValues.parkaz) || !isEmptyRotatorValue(formValues.parkel);
        setParkPositionEnabled(hasParkValues);
    }, [open, formValues.parkaz, formValues.parkel]);

    return (
        <Dialog
            fullWidth
            open={open}
            onClose={onClose}
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
                {isEditing ? t("rotator.edit_dialog_title") : t("rotator.add_dialog_title")}
            </DialogTitle>
            <DialogContent sx={{ px: 3, py: 3, pt: "1em" }}>
                <Stack spacing={2} sx={{ mt: 3 }}>
                    <TextField name="name" label={t("rotator.name")} fullWidth size="small" onChange={onChange} value={formValues.name} error={Boolean(validationErrors.name)} required />
                    <TextField name="host" label={t("rotator.host")} fullWidth size="small" onChange={onChange} value={formValues.host} error={Boolean(validationErrors.host)} required />
                    <TextField name="port" label={t("rotator.port")} type="number" fullWidth size="small" onChange={onChange} value={formValues.port} error={Boolean(validationErrors.port)} required />
                    <TextField
                        name="azimuth_mode"
                        label={t("rotator.azimuth_range")}
                        select
                        fullWidth
                        size="small"
                        onChange={onChange}
                        value={formValues.azimuth_mode ?? "0_360"}
                        error={Boolean(validationErrors.azimuth_mode)}
                        helperText={
                            validationErrors.azimuth_mode
                            || (
                                (formValues.azimuth_mode ?? "0_360") === "-180_180"
                                    ? t("rotator.azimuth_mode_help_neg180_180")
                                    : (formValues.azimuth_mode ?? "0_360") === "0_450"
                                        ? t("rotator.azimuth_mode_help_0_450")
                                        : t("rotator.azimuth_mode_help_0_360")
                            )
                        }
                        required
                    >
                        <MenuItem value="0_360">{t("rotator.azimuth_mode_0_360")}</MenuItem>
                        <MenuItem value="-180_180">{t("rotator.azimuth_mode_neg180_180")}</MenuItem>
                        <MenuItem value="0_450">{t("rotator.azimuth_mode_0_450")}</MenuItem>
                    </TextField>
                    <TextField name="minaz" label={t("rotator.min_az")} type="number" fullWidth size="small" onChange={onChange} value={formValues.minaz} error={Boolean(validationErrors.minaz)} required InputProps={{ endAdornment: <InputAdornment position="end">°</InputAdornment> }} />
                    <TextField name="maxaz" label={t("rotator.max_az")} type="number" fullWidth size="small" onChange={onChange} value={formValues.maxaz} error={Boolean(validationErrors.maxaz)} required InputProps={{ endAdornment: <InputAdornment position="end">°</InputAdornment> }} />
                    <TextField name="minel" label={t("rotator.min_el")} type="number" fullWidth size="small" onChange={onChange} value={formValues.minel} error={Boolean(validationErrors.minel)} required InputProps={{ endAdornment: <InputAdornment position="end">°</InputAdornment> }} />
                    <TextField name="maxel" label={t("rotator.max_el")} type="number" fullWidth size="small" onChange={onChange} value={formValues.maxel} error={Boolean(validationErrors.maxel)} required InputProps={{ endAdornment: <InputAdornment position="end">°</InputAdornment> }} />
                    <Alert severity="warning">{t("rotator.tolerance_warning")}</Alert>
                    <TextField
                        name="aztolerance"
                        label={t("rotator.az_tolerance")}
                        type="number"
                        fullWidth
                        size="small"
                        onChange={onChange}
                        value={formValues.aztolerance}
                        error={Boolean(validationErrors.aztolerance)}
                        helperText={validationErrors.aztolerance ? validationErrors.aztolerance : t("rotator.tolerance_helper")}
                        required
                        InputProps={{
                            endAdornment: (
                                <InputAdornment position="end">
                                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                                        <WarningAmberOutlinedIcon fontSize="small" color="warning" sx={{ opacity: 0.7 }} />
                                        <span>°</span>
                                    </Box>
                                </InputAdornment>
                            ),
                        }}
                    />
                    <TextField
                        name="eltolerance"
                        label={t("rotator.el_tolerance")}
                        type="number"
                        fullWidth
                        size="small"
                        onChange={onChange}
                        value={formValues.eltolerance}
                        error={Boolean(validationErrors.eltolerance)}
                        helperText={validationErrors.eltolerance ? validationErrors.eltolerance : t("rotator.tolerance_helper")}
                        required
                        InputProps={{
                            endAdornment: (
                                <InputAdornment position="end">
                                    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                                        <WarningAmberOutlinedIcon fontSize="small" color="warning" sx={{ opacity: 0.7 }} />
                                        <span>°</span>
                                    </Box>
                                </InputAdornment>
                            ),
                        }}
                    />
                    <Alert severity="warning">{t("rotator.park_override_warning")}</Alert>
                    <FormControlLabel
                        control={
                            <Checkbox
                                checked={parkPositionEnabled}
                                onChange={(event) => {
                                    const enabled = event.target.checked;
                                    setParkPositionEnabled(enabled);
                                    if (!enabled && typeof onPatchValues === "function") {
                                        onPatchValues({ parkaz: null, parkel: null });
                                    }
                                }}
                            />
                        }
                        label={t("rotator.enable_park_override")}
                    />
                    <TextField
                        name="parkaz"
                        label={t("rotator.park_az")}
                        type="number"
                        fullWidth
                        size="small"
                        onChange={onChange}
                        value={formValues.parkaz ?? ""}
                        error={Boolean(validationErrors.parkaz)}
                        helperText={validationErrors.parkaz || t("rotator.park_position_helper")}
                        disabled={!parkPositionEnabled}
                        InputProps={{ endAdornment: <InputAdornment position="end">°</InputAdornment> }}
                    />
                    <TextField
                        name="parkel"
                        label={t("rotator.park_el")}
                        type="number"
                        fullWidth
                        size="small"
                        onChange={onChange}
                        value={formValues.parkel ?? ""}
                        error={Boolean(validationErrors.parkel)}
                        helperText={validationErrors.parkel || t("rotator.park_position_helper")}
                        disabled={!parkPositionEnabled}
                        InputProps={{ endAdornment: <InputAdornment position="end">°</InputAdornment> }}
                    />
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
                <Button
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
                    {t("rotator.cancel")}
                </Button>
                <Button color="success" variant="contained" onClick={onSubmit} disabled={hasValidationErrors || loading}>
                    {t("rotator.submit")}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
