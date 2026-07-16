import * as React from "react";
import { useDispatch } from "react-redux";
import { useSocket } from "../common/socket.jsx";
import { submitOrEditRotator } from "../hardware/rotator-slice.jsx";
import { toast } from "../../utils/toast-with-timestamp.jsx";
import { useTranslation } from "react-i18next";
import RotatorEditDialog from "../hardware/rotator-edit-dialog.jsx";
import {
    applyAzimuthModeDefaults,
    DEFAULT_ROTATOR,
    prepareRotatorPayload,
    validateRotatorForm,
} from "../hardware/rotator-edit-logic.js";

export default function RotatorQuickEditDialog({ open, onClose, rotator }) {
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const { t } = useTranslation("hardware");
    const [formValues, setFormValues] = React.useState(DEFAULT_ROTATOR);
    const [saving, setSaving] = React.useState(false);

    React.useEffect(() => {
        if (!open) return;
        setFormValues({
            ...DEFAULT_ROTATOR,
            ...(rotator || {}),
        });
    }, [open, rotator]);

    const handleChange = React.useCallback((event) => {
        const { name, value } = event.target;
        setFormValues((previous) => ({
            ...(name === "azimuth_mode"
                ? applyAzimuthModeDefaults(previous, value)
                : { ...previous, [name]: value }),
        }));
    }, []);

    const validationErrors = React.useMemo(() => validateRotatorForm(formValues, t), [formValues, t]);
    const hasValidationErrors = Object.keys(validationErrors).length > 0;

    const handleSubmit = React.useCallback(async () => {
        if (!socket || !formValues?.id) {
            return;
        }
        setSaving(true);
        try {
            await dispatch(submitOrEditRotator({ socket, formValues: prepareRotatorPayload(formValues) })).unwrap();
            toast.success(t("rotator.saved_success"), { autoClose: 5000 });
            onClose();
        } catch (error) {
            toast.error(error?.message || t("rotator.error_saving"), { autoClose: 5000 });
        } finally {
            setSaving(false);
        }
    }, [dispatch, formValues, onClose, socket, t]);

    return (
        <RotatorEditDialog
            open={open}
            onClose={onClose}
            isEditing
            formValues={formValues}
            validationErrors={validationErrors}
            hasValidationErrors={hasValidationErrors}
            loading={saving}
            onChange={handleChange}
            onSubmit={handleSubmit}
            onPatchValues={(patch) => setFormValues((previous) => ({ ...previous, ...patch }))}
        />
    );
}
