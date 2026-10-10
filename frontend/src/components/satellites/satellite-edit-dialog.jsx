import * as React from 'react';
import {
    Alert,
    AlertTitle,
    Box,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    MenuItem,
    Stack,
    Tab,
    Tabs,
    TextField,
} from '@mui/material';
import Button from '@mui/material/Button';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { submitOrEditSatellite } from './satellite-slice.jsx';
import { useSocket } from '../common/socket.jsx';

export const normalizeSatelliteFormValues = (satelliteData) => {
    if (!satelliteData) {
        return {
            id: null,
            name: '',
            norad_id: '',
            sat_id: '',
            status: '',
            tle1: '',
            tle2: '',
            is_frequency_violator: false,
            countries: '',
            operator: '',
            name_other: '',
            alternative_name: '',
            website: '',
            image: '',
            orbit_epoch: '',
            orbit_fetched_at: '',
            orbit_first_seen_at: '',
            orbit_changed_at: '',
        };
    }

    const details = satelliteData.details ?? satelliteData;
    const noradId = details.norad_id ?? satelliteData.norad_id ?? '';
    const orbitModelKind = String(
        details.orbit_model_kind
        ?? details.orbit_format
        ?? satelliteData.orbit_model_kind
        ?? satelliteData.orbit_format
        ?? 'tle',
    ).trim().toLowerCase() || 'tle';
    const orbitCentralBody = String(
        details.orbit_central_body
        ?? details.central_body
        ?? satelliteData.orbit_central_body
        ?? satelliteData.central_body
        ?? 'earth',
    ).trim().toLowerCase() || 'earth';
    const orbitEpoch = String(
        details.orbit_epoch
        ?? details.epoch
        ?? satelliteData.orbit_epoch
        ?? satelliteData.epoch
        ?? '',
    ).trim();
    const rawOmmPayload = details.orbit_payload
        ?? details.omm_payload
        ?? satelliteData.orbit_payload
        ?? satelliteData.omm_payload
        ?? null;
    const orbitOmmPayload = typeof rawOmmPayload === 'string'
        ? rawOmmPayload
        : (rawOmmPayload && typeof rawOmmPayload === 'object'
            ? JSON.stringify(rawOmmPayload, null, 2)
            : '');

    return {
        id: noradId || null,
        name: details.name ?? satelliteData.name ?? '',
        norad_id: noradId,
        sat_id: details.sat_id ?? satelliteData.sat_id ?? '',
        status: details.status ?? satelliteData.status ?? '',
        tle1: details.tle1 ?? satelliteData.tle1 ?? '',
        tle2: details.tle2 ?? satelliteData.tle2 ?? '',
        is_frequency_violator: Boolean(details.is_frequency_violator ?? satelliteData.is_frequency_violator),
        countries: details.countries ?? satelliteData.countries ?? '',
        operator: details.operator ?? satelliteData.operator ?? '',
        name_other: details.name_other ?? satelliteData.name_other ?? '',
        alternative_name: details.alternative_name ?? satelliteData.alternative_name ?? '',
        website: details.website ?? satelliteData.website ?? '',
        image: details.image ?? satelliteData.image ?? '',
        orbit_model_kind: orbitModelKind,
        orbit_central_body: orbitCentralBody,
        orbit_epoch: orbitEpoch,
        orbit_fetched_at: String(
            details.orbit_fetched_at ?? satelliteData.orbit_fetched_at ?? '',
        ).trim(),
        orbit_first_seen_at: String(
            details.orbit_first_seen_at ?? satelliteData.orbit_first_seen_at ?? '',
        ).trim(),
        orbit_changed_at: String(
            details.orbit_changed_at ?? satelliteData.orbit_changed_at ?? '',
        ).trim(),
        orbit_omm_payload: orbitOmmPayload,
    };
};

const SatelliteEditDialog = ({ open, onClose, satelliteData, onSaved }) => {
    const { t } = useTranslation('satellites');
    const dispatch = useDispatch();
    const { socket } = useSocket();

    const [formValues, setFormValues] = useState(() => normalizeSatelliteFormValues(satelliteData));
    const [submitError, setSubmitError] = useState('');
    const [submitErrorFields, setSubmitErrorFields] = useState({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [hasLocalEdits, setHasLocalEdits] = useState(false);
    const [activeTab, setActiveTab] = useState(0);
    const initializedSatelliteIdRef = useRef(null);

    useEffect(() => {
        if (!open) {
            initializedSatelliteIdRef.current = null;
            setHasLocalEdits(false);
            setActiveTab(0);
            return;
        }

        const normalized = normalizeSatelliteFormValues(satelliteData);
        const incomingSatelliteId = normalized.id ?? normalized.norad_id ?? null;
        const isDifferentSatellite = initializedSatelliteIdRef.current !== incomingSatelliteId;

        // Keep form synced until the user starts typing; after that, only resync if editing another satellite.
        if (!hasLocalEdits || isDifferentSatellite) {
            setFormValues(normalized);
            setSubmitError('');
            setSubmitErrorFields({});
            initializedSatelliteIdRef.current = incomingSatelliteId;
            setHasLocalEdits(false);
            // Preserve the currently selected tab while live satellite updates stream in.
            // Reset to General only when the dialog switches to a different satellite.
            if (isDifferentSatellite) {
                setActiveTab(0);
            }
        }
    }, [open, satelliteData, hasLocalEdits]);

    const normalizedModelKind = String(formValues.orbit_model_kind || 'tle').trim().toLowerCase();
    const normalizedCentralBody = String(formValues.orbit_central_body || 'earth').trim().toLowerCase();
    const requiresOmmPayload = normalizedModelKind === 'omm';
    const supportedModelKinds = ['tle', 'omm'];
    const supportedCentralBodies = ['earth', 'moon', 'mars'];
    const tle1Trimmed = String(formValues.tle1 || '').trim();
    const tle2Trimmed = String(formValues.tle2 || '').trim();
    const monospaceInputSx = {
        '& .MuiInputBase-input': {
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        },
    };

    const parsedOmmPayload = useMemo(() => {
        if (!requiresOmmPayload) {
            return { value: null, error: null };
        }
        const raw = String(formValues.orbit_omm_payload || '').trim();
        if (!raw) {
            return { value: null, error: 'missing' };
        }
        try {
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return { value: null, error: 'invalid' };
            }
            return { value: parsed, error: null };
        } catch (_error) {
            return { value: null, error: 'invalid' };
        }
    }, [formValues.orbit_omm_payload, requiresOmmPayload]);

    const validationErrors = useMemo(() => ({
        name: !String(formValues.name || '').trim(),
        norad_id: !formValues.id
            && (formValues.norad_id === '' || formValues.norad_id === null || formValues.norad_id === undefined),
        tle1: !tle1Trimmed,
        tle2: !tle2Trimmed,
        orbit_model_kind: !supportedModelKinds.includes(normalizedModelKind),
        orbit_central_body: !supportedCentralBodies.includes(normalizedCentralBody),
        orbit_omm_payload: requiresOmmPayload ? Boolean(parsedOmmPayload.error) : false,
    }), [
        formValues,
        normalizedModelKind,
        normalizedCentralBody,
        parsedOmmPayload.error,
        requiresOmmPayload,
        tle1Trimmed,
        tle2Trimmed,
    ]);

    const isSubmitDisabled = Object.values(validationErrors).some(Boolean);

    const handleInputChange = (event) => {
        const { name, value } = event.target;
        if (submitError) {
            setSubmitError('');
            setSubmitErrorFields({});
        }
        setHasLocalEdits(true);
        setFormValues((prev) => ({ ...prev, [name]: value }));
    };

    const handleCheckboxChange = (event) => {
        const { name, checked } = event.target;
        setHasLocalEdits(true);
        setFormValues((prev) => ({ ...prev, [name]: checked }));
    };

    const handleClose = () => {
        if (isSubmitting) return;
        onClose();
    };

    const handleSubmit = () => {
        if (isSubmitDisabled || isSubmitting) {
            return;
        }
        setIsSubmitting(true);
        setSubmitError('');
        setSubmitErrorFields({});

        const orbitPayload = {
            central_body: normalizedCentralBody,
            model_kind: normalizedModelKind,
            tle1: tle1Trimmed,
            tle2: tle2Trimmed,
            epoch: String(formValues.orbit_epoch || '').trim() || null,
            omm_payload: requiresOmmPayload ? parsedOmmPayload.value : null,
        };

        const payload = {
            id: formValues.id,
            name: formValues.name,
            norad_id: formValues.norad_id === '' ? '' : Number(formValues.norad_id),
            sat_id: formValues.sat_id,
            status: formValues.status,
            tle1: tle1Trimmed,
            tle2: tle2Trimmed,
            is_frequency_violator: Boolean(formValues.is_frequency_violator),
            countries: formValues.countries,
            operator: formValues.operator,
            name_other: formValues.name_other,
            alternative_name: formValues.alternative_name,
            website: formValues.website,
            image: formValues.image,
            orbit: orbitPayload,
        };

        dispatch(submitOrEditSatellite({ socket, formValues: payload }))
            .unwrap()
            .then((saved) => {
                if (typeof onSaved === 'function') {
                    onSaved(saved);
                }
                onClose();
            })
            .catch((error) => {
                const rawMessage = typeof error === 'string' ? error : (error?.message || String(error));
                setSubmitError(rawMessage);
                const requiredMatch = rawMessage.match(/Missing required field:\s*([a-zA-Z0-9_.]+)/i);
                if (requiredMatch) {
                    const normalizedField = String(requiredMatch[1] || '').replace(/^orbit\./, '');
                    setSubmitErrorFields({ [normalizedField]: true });
                } else if (/norad/i.test(rawMessage)) {
                    setSubmitErrorFields({ norad_id: true });
                } else if (/omm_payload/i.test(rawMessage)) {
                    setSubmitErrorFields({ orbit_omm_payload: true });
                } else if (/model_kind/i.test(rawMessage)) {
                    setSubmitErrorFields({ orbit_model_kind: true });
                } else if (/central_body/i.test(rawMessage)) {
                    setSubmitErrorFields({ orbit_central_body: true });
                }
            })
            .finally(() => {
                setIsSubmitting(false);
            });
    };

    return (
        <Dialog
            open={open}
            onClose={handleClose}
            fullWidth
            maxWidth="md"
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
                    fontSize: '1.25rem',
                    fontWeight: 'bold',
                    py: 2.5,
                }}
            >
                {formValues.id
                    ? t('satellite_database.dialog_title_edit_name', {
                        name: formValues.name || formValues.norad_id || '',
                    })
                    : t('satellite_database.dialog_title_add')}
            </DialogTitle>
            <DialogContent
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
                <Tabs
                    value={activeTab}
                    onChange={(_event, value) => setActiveTab(value)}
                    aria-label={t('satellite_edit_dialog.satellite_edit_tabs', { defaultValue: 'satellite edit tabs' })}
                    sx={{ mt: 1.5, borderBottom: (theme) => `1px solid ${theme.palette.divider}` }}
                >
                    <Tab label={t('satellite_database.tab_general', { defaultValue: 'General' })} />
                    <Tab label={t('satellite_database.tab_orbital', { defaultValue: 'Orbital' })} />
                </Tabs>
                <Stack spacing={2} sx={{ mt: 2.5 }}>
                    {submitError ? (
                        <Alert severity="error">
                            <AlertTitle>
                                {formValues.id ? t('satellite_database.failed_update') : t('satellite_database.failed_add')}
                            </AlertTitle>
                            {submitError}
                        </Alert>
                    ) : null}
                    {activeTab === 0 && (
                        <Box sx={{ display: 'grid', gap: 2 }}>
                            <TextField
                                label={t('satellite_database.name')}
                                name="name"
                                value={formValues.name || ''}
                                onChange={handleInputChange}
                                fullWidth
                                required
                                size="small"
                                error={Boolean(validationErrors.name || submitErrorFields.name)}
                                disabled={isSubmitting}
                            />
                            <TextField
                                label={t('satellite_database.norad_id')}
                                name="norad_id"
                                value={formValues.norad_id || ''}
                                onChange={handleInputChange}
                                fullWidth
                                required
                                type="number"
                                disabled={Boolean(formValues.id) || isSubmitting}
                                size="small"
                                error={Boolean(validationErrors.norad_id || submitErrorFields.norad_id)}
                            />
                            <TextField
                                label={t('satellite_database.sat_id')}
                                name="sat_id"
                                value={formValues.sat_id || ''}
                                onChange={handleInputChange}
                                fullWidth
                                size="small"
                                disabled={isSubmitting}
                            />
                            <TextField
                                label={t('satellite_database.status')}
                                name="status"
                                value={formValues.status || ''}
                                onChange={handleInputChange}
                                fullWidth
                                size="small"
                                disabled={isSubmitting}
                            />
                            <FormControlLabel
                                control={(
                                    <Checkbox
                                        checked={Boolean(formValues.is_frequency_violator)}
                                        onChange={handleCheckboxChange}
                                        name="is_frequency_violator"
                                        size="small"
                                        disabled={isSubmitting}
                                    />
                                )}
                                label={t('satellite_database.is_frequency_violator')}
                            />
                            <TextField
                                label={t('satellite_database.operator')}
                                name="operator"
                                value={formValues.operator || ''}
                                onChange={handleInputChange}
                                fullWidth
                                size="small"
                                disabled={isSubmitting}
                            />
                            <TextField
                                label={t('satellite_database.countries')}
                                name="countries"
                                value={formValues.countries || ''}
                                onChange={handleInputChange}
                                fullWidth
                                size="small"
                                disabled={isSubmitting}
                            />
                            <TextField
                                label={t('satellite_database.name_other')}
                                name="name_other"
                                value={formValues.name_other || ''}
                                onChange={handleInputChange}
                                fullWidth
                                size="small"
                                disabled={isSubmitting}
                            />
                            <TextField
                                label={t('satellite_database.alternative_name')}
                                name="alternative_name"
                                value={formValues.alternative_name || ''}
                                onChange={handleInputChange}
                                fullWidth
                                size="small"
                                disabled={isSubmitting}
                            />
                            <TextField
                                label={t('satellite_database.website')}
                                name="website"
                                value={formValues.website || ''}
                                onChange={handleInputChange}
                                fullWidth
                                size="small"
                                disabled={isSubmitting}
                            />
                            <TextField
                                label={t('satellite_database.image')}
                                name="image"
                                value={formValues.image || ''}
                                onChange={handleInputChange}
                                fullWidth
                                size="small"
                                disabled={isSubmitting}
                            />
                        </Box>
                    )}
                    {activeTab === 1 && (
                        <Box sx={{ display: 'grid', gap: 2 }}>
                            <TextField
                                select
                                label={t('satellite_database.orbit_model_kind', { defaultValue: 'Orbit Model' })}
                                name="orbit_model_kind"
                                value={formValues.orbit_model_kind || 'tle'}
                                onChange={handleInputChange}
                                fullWidth
                                size="small"
                                error={Boolean(validationErrors.orbit_model_kind || submitErrorFields.orbit_model_kind)}
                                disabled={isSubmitting}
                            >
                                <MenuItem value="tle">TLE</MenuItem>
                                <MenuItem value="omm">OMM</MenuItem>
                            </TextField>
                            <TextField
                                select
                                label={t('orbital_sources.central_body')}
                                name="orbit_central_body"
                                value={formValues.orbit_central_body || 'earth'}
                                onChange={handleInputChange}
                                fullWidth
                                size="small"
                                error={Boolean(validationErrors.orbit_central_body || submitErrorFields.orbit_central_body)}
                                disabled={isSubmitting}
                            >
                                <MenuItem value="earth">earth</MenuItem>
                                <MenuItem value="moon">moon</MenuItem>
                                <MenuItem value="mars">mars</MenuItem>
                            </TextField>
                            <TextField
                                label={t('satellite_database.tle1')}
                                name="tle1"
                                value={formValues.tle1 || ''}
                                onChange={handleInputChange}
                                fullWidth
                                required
                                multiline
                                minRows={2}
                                size="small"
                                error={Boolean(validationErrors.tle1 || submitErrorFields.tle1)}
                                disabled={isSubmitting}
                                sx={monospaceInputSx}
                            />
                            <TextField
                                label={t('satellite_database.tle2')}
                                name="tle2"
                                value={formValues.tle2 || ''}
                                onChange={handleInputChange}
                                fullWidth
                                required
                                multiline
                                minRows={2}
                                size="small"
                                error={Boolean(validationErrors.tle2 || submitErrorFields.tle2)}
                                disabled={isSubmitting}
                                sx={monospaceInputSx}
                            />
                            <TextField
                                label={t('satellite_database.orbit_epoch', { defaultValue: 'Orbit Epoch (ISO 8601)' })}
                                name="orbit_epoch"
                                value={formValues.orbit_epoch || ''}
                                onChange={handleInputChange}
                                fullWidth
                                size="small"
                                disabled={isSubmitting}
                                placeholder="2026-05-09T12:34:56Z"
                                InputProps={formValues.id ? { readOnly: true } : undefined}
                                sx={monospaceInputSx}
                            />
                            {formValues.id && (
                                <>
                                    <TextField
                                        label={t('satellite_database.orbit_fetched')}
                                        value={formValues.orbit_fetched_at || ''}
                                        fullWidth
                                        size="small"
                                        InputProps={{ readOnly: true }}
                                        sx={monospaceInputSx}
                                    />
                                    <TextField
                                        label={t('satellite_database.orbit_first_seen')}
                                        value={formValues.orbit_first_seen_at || ''}
                                        fullWidth
                                        size="small"
                                        InputProps={{ readOnly: true }}
                                        sx={monospaceInputSx}
                                    />
                                    <TextField
                                        label={t('satellite_database.orbit_changed')}
                                        value={formValues.orbit_changed_at || ''}
                                        fullWidth
                                        size="small"
                                        InputProps={{ readOnly: true }}
                                        sx={monospaceInputSx}
                                    />
                                </>
                            )}
                            {requiresOmmPayload && (
                                <TextField
                                    label={t('satellite_database.omm_payload', { defaultValue: 'OMM Payload (JSON object)' })}
                                    name="orbit_omm_payload"
                                    value={formValues.orbit_omm_payload || ''}
                                    onChange={handleInputChange}
                                    fullWidth
                                    required
                                    multiline
                                    minRows={6}
                                    size="small"
                                    error={Boolean(validationErrors.orbit_omm_payload || submitErrorFields.orbit_omm_payload)}
                                    disabled={isSubmitting}
                                    sx={monospaceInputSx}
                                />
                            )}
                        </Box>
                    )}
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
                <Button onClick={handleClose} variant="outlined" disabled={isSubmitting}>
                    {t('satellite_database.cancel')}
                </Button>
                <Button
                    variant="contained"
                    onClick={handleSubmit}
                    color="success"
                    disabled={isSubmitDisabled || isSubmitting}
                >
                    {formValues.id ? t('satellite_database.edit') : t('satellite_database.submit')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default SatelliteEditDialog;
