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

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {Alert,AlertTitle,Box,Chip,CircularProgress,FormControlLabel,IconButton,InputAdornment,MenuItem,Stack,Switch,TextField,Typography,} from '@mui/material';
import Grid from '@mui/material/Grid';
import { alpha } from '@mui/material/styles';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import CapsButton from '../common/capsbutton.jsx';
import { useSocket } from '../common/socket.jsx';
import { useUsageSettings } from '../../hooks/useUsageSettings.js';
import UsageForm from './usage-form.jsx';
import { toast } from '../../utils/toast-with-timestamp.jsx';
import {
    SettingsActionFooter,
    SettingsBanner,
    SettingsMetaRow,
    SettingsSection,
    SettingsSurface,
    SettingsSurfaceHeader,
} from './shared/index.js';

const SOURCE_LABELS = {
    cli: 'CLI Override',
    file: 'Config File',
    default: 'Default',
};

const SETTINGS_GROUP_DEFS = [
    {
        key: 'network',
        titleKey: 'app_settings.group_network',
        titleDefault: 'Network',
        descriptionKey: 'app_settings.group_network_help',
        descriptionDefault: 'Backend host and listener port configuration.',
        fieldKeys: ['host', 'port'],
    },
    {
        key: 'storage',
        titleKey: 'app_settings.group_storage',
        titleDefault: 'Storage',
        descriptionKey: 'app_settings.group_storage_help',
        descriptionDefault: 'Database path and persistence mode.',
        fieldKeys: ['db', 'temp_db'],
    },
    {
        key: 'logging',
        titleKey: 'app_settings.group_logging',
        titleDefault: 'Logging',
        descriptionKey: 'app_settings.group_logging_help',
        descriptionDefault: 'Log level and logging configuration path.',
        fieldKeys: ['log_level', 'log_config'],
    },
    {
        key: 'tracking',
        titleKey: 'app_settings.group_tracking',
        titleDefault: 'Tracking',
        descriptionKey: 'app_settings.group_tracking_help',
        descriptionDefault: 'Tracker cadence and target slot limits.',
        fieldKeys: ['track_interval_ms', 'max_tracker_targets'],
    },
    {
        key: 'transcription',
        titleKey: 'app_settings.group_transcription',
        titleDefault: 'Transcription',
        descriptionKey: 'app_settings.group_transcription_help',
        descriptionDefault: 'Shared transcription service endpoints.',
        fieldKeys: ['parakeet_url', 'libretranslate_url'],
    },
    {
        key: 'orbital_sync',
        titleKey: 'app_settings.group_orbital_sync',
        titleDefault: 'Orbital Sync Sources',
        descriptionKey: 'app_settings.group_orbital_sync_help',
        descriptionDefault: 'Satellite and transmitter metadata endpoints used during orbital synchronization.',
        fieldKeys: ['orbital_sync_satellite_metadata_urls', 'orbital_sync_transmitter_urls'],
    },
    {
        key: 'celestial_sync',
        titleKey: 'app_settings.group_celestial_sync',
        titleDefault: 'Celestial Sync',
        descriptionKey: 'app_settings.group_celestial_sync_help',
        descriptionDefault: 'Monitored celestial periodic synchronization settings.',
        fieldKeys: [
            'celestial_periodic_sync_enabled',
            'celestial_periodic_sync_interval_minutes',
            'celestial_sync_past_hours',
        ],
    },
];

const getSettingCardBackground = (applyMode, theme) => {
    void applyMode;
    return theme.palette.mode === 'dark'
        ? alpha(theme.palette.grey[700], 0.18)
        : alpha(theme.palette.grey[100], 0.9);
};

const formatFieldName = (key) =>
    String(key || '')
        .split('_')
        .filter(Boolean)
        .map((part) => {
            const normalized = part.toLowerCase();
            if (normalized === 'db') {
                return 'DB';
            }
            return part.charAt(0).toUpperCase() + part.slice(1);
        })
        .join(' ');

const parseStringList = (value) => {
    if (Array.isArray(value)) {
        return value.map((item) => String(item).trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
        return value
            .replace(/,/g, '\n')
            .split('\n')
            .map((item) => item.trim())
            .filter(Boolean);
    }
    return [];
};

const toDraftValue = (field, value) => {
    if (field.value_type === 'boolean') {
        return Boolean(value);
    }
    if (field.value_type === 'integer') {
        return value == null ? '' : String(value);
    }
    if (field.value_type === 'string_list') {
        return parseStringList(value).join('\n');
    }
    return value == null ? '' : String(value);
};

const normalizeDraftForCompare = (field, value) => {
    if (field.value_type === 'boolean') {
        return Boolean(value);
    }
    if (field.value_type === 'integer') {
        return typeof value === 'string' ? value.trim() : String(value ?? '');
    }
    if (field.value_type === 'string_list') {
        return parseStringList(value);
    }
    return String(value ?? '');
};

const toSubmitValue = (field, value) => {
    if (field.value_type === 'boolean') {
        return Boolean(value);
    }
    if (field.value_type === 'integer') {
        return typeof value === 'string' ? value.trim() : value;
    }
    if (field.value_type === 'string_list') {
        return parseStringList(value);
    }
    return String(value ?? '').trim();
};

const buildDraftFromPayload = (payload) => {
    const fields = Array.isArray(payload?.fields) ? payload.fields : [];
    const values = payload?.values || {};
    const nextDraft = {};

    fields.forEach((field) => {
        const rawValue = Object.prototype.hasOwnProperty.call(values, field.key)
            ? values[field.key]
            : field.default;
        nextDraft[field.key] = toDraftValue(field, rawValue);
    });

    return nextDraft;
};

const getApplyModeMeta = (applyMode, t) => {
    if (applyMode === 'hot') {
        return {
            label: t('app_settings.apply_mode_hot', { defaultValue: 'Hot Apply' }),
            color: 'success',
        };
    }
    if (applyMode === 'restart_required') {
        return {
            label: t('app_settings.apply_mode_restart', { defaultValue: 'Restart Required' }),
            color: 'warning',
        };
    }
    return {
        label: t('app_settings.apply_mode_other', { defaultValue: 'Other' }),
        color: 'default',
    };
};

const AppSettingsForm = () => {
    const { socket } = useSocket();
    const usage = useUsageSettings(socket);
    const { t } = useTranslation('settings');

    // Field descriptions come from the backend schema as plain English strings with no
    // i18n field. Derive a locale key from the field key and fall back to the backend
    // text, so no backend change is needed and other locales keep working.
    const fieldDescription = (field) =>
        t(`app_settings.field_${field.key}`, { defaultValue: field.description });
    const navigate = useNavigate();

    const [payload, setPayload] = useState(null);
    const [draft, setDraft] = useState({});
    const [savedDraft, setSavedDraft] = useState({});
    const [visibleSensitive, setVisibleSensitive] = useState({});
    const [validationErrors, setValidationErrors] = useState({});
    const [loadError, setLoadError] = useState('');
    const [saveResult, setSaveResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const fields = Array.isArray(payload?.fields) ? payload.fields : [];

    const changedKeys = useMemo(() => {
        return fields
            .filter((field) => {
                if (payload?.locked?.[field.key]) {
                    return false;
                }
                const current = normalizeDraftForCompare(field, draft[field.key]);
                const baseline = normalizeDraftForCompare(field, savedDraft[field.key]);
                return JSON.stringify(current) !== JSON.stringify(baseline);
            })
            .map((field) => field.key);
    }, [draft, fields, payload?.locked, savedDraft]);

    const isDirty = changedKeys.length > 0 || usage.dirty;
    const isLoading = loading || usage.loading;

    const groupedFields = useMemo(() => {
        const fieldsByKey = new Map(fields.map((field) => [field.key, field]));
        const claimed = new Set();

        const groups = SETTINGS_GROUP_DEFS.map((def) => {
            const groupFields = def.fieldKeys
                .map((fieldKey) => fieldsByKey.get(fieldKey))
                .filter(Boolean);
            groupFields.forEach((field) => claimed.add(field.key));
            return {
                key: def.key,
                title: t(def.titleKey, { defaultValue: def.titleDefault }),
                description: t(def.descriptionKey, { defaultValue: def.descriptionDefault }),
                fields: groupFields,
            };
        }).filter((group) => group.fields.length > 0);

        const otherFields = fields.filter((field) => !claimed.has(field.key));
        if (otherFields.length > 0) {
            groups.push({
                key: 'other',
                title: t('app_settings.group_other', { defaultValue: 'Other Settings' }),
                description: t('app_settings.group_other_help', {
                    defaultValue: 'Additional runtime settings that do not match a specific subsystem group.',
                }),
                fields: otherFields,
            });
        }

        return groups;
    }, [fields, t]);

    const statusLabel = saving
        ? t('app_settings.saving', { defaultValue: 'Saving...' })
        : isLoading
            ? t('app_settings.loading_state', { defaultValue: 'Loading' })
        : isDirty
            ? t('app_settings.unsaved', { defaultValue: 'Unsaved changes' })
            : t('app_settings.saved', { defaultValue: 'Saved' });

    const statusColor = saving || isLoading ? 'info' : (isDirty ? 'warning' : 'success');

    const footerStatusText = isLoading && fields.length === 0
        ? t('app_settings.loading', { defaultValue: 'Loading application settings...' })
        : statusLabel;

    const settingsCountLabel = `${fields.length} ${t('app_settings.settings_count_suffix', { defaultValue: 'settings' })}`;

    const loadConfig = useCallback(() => {
        if (!socket) {
            return;
        }

        setLoading(true);
        setLoadError('');

        socket.emit("api.call", {
  cmd: 'get-app-config',
  data: null
}, response => {
  if (!response?.success) {
    const errorMessage = response?.error || 'Failed to load application settings';
    setLoadError(errorMessage);
    setLoading(false);
    return;
  }
  const nextPayload = response.data || {};
  const nextDraft = buildDraftFromPayload(nextPayload);
  const nextSensitive = {};
  (nextPayload.fields || []).forEach(field => {
    if (field.sensitive) {
      nextSensitive[field.key] = false;
    }
  });
  setPayload(nextPayload);
  setDraft(nextDraft);
  setSavedDraft(nextDraft);
  setVisibleSensitive(nextSensitive);
  setValidationErrors({});
  setSaveResult(null);
  setLoadError('');
  setLoading(false);
});
    }, [socket]);

    useEffect(() => {
        loadConfig();
    }, [loadConfig]);

    const handleFieldChange = (key, value) => {
        setDraft((prev) => ({ ...prev, [key]: value }));
        setValidationErrors((prev) => {
            if (!prev[key]) return prev;
            const copy = { ...prev };
            delete copy[key];
            return copy;
        });
    };

    const handleReset = () => {
        setDraft(savedDraft);
        usage.reset();
        setValidationErrors({});
        setSaveResult(null);
    };

    const handleReload = () => {
        loadConfig();
        void usage.reload();
    };

    const handleToggleSensitive = (key) => {
        setVisibleSensitive((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    const handleSave = async () => {
        if (!socket || saving || isLoading || !isDirty) {
            return;
        }

        const updates = {};
        fields.forEach((field) => {
            if (changedKeys.includes(field.key)) {
                updates[field.key] = toSubmitValue(field, draft[field.key]);
            }
        });

        setSaving(true);
        setValidationErrors({});

        try {
            // Only schema-backed fields belong in app_config.json. A usage-only
            // save must not rewrite the runtime configuration at all.
            if (changedKeys.length > 0) {
                setSaveResult(null);
                const response = await new Promise((resolve) => {
                    socket.emit('api.call', {
                        cmd: 'update-app-config', data: { values: updates },
                    }, resolve);
                });
                if (!response?.success) {
                    setValidationErrors(response?.data?.validation_errors || {});
                    toast.error(response?.error || t('app_settings.save_failed'));
                    return;
                }

                const nextPayload = response.data || {};
                const nextDraft = buildDraftFromPayload(nextPayload);
                setPayload(nextPayload);
                setDraft(nextDraft);
                setSavedDraft(nextDraft);
                setSaveResult({
                    changedKeys: nextPayload.changed_keys || [],
                    changedHotKeys: nextPayload.changed_hot_keys || [],
                    changedRestartKeys: nextPayload.changed_restart_keys || [],
                    restartRequired: Boolean(nextPayload.restart_required),
                });
            }

            // The two stores are independent. If activity saving fails after
            // config saving succeeds, retry only the still-unsaved activity choice.
            if (!await usage.save()) return;
            toast.success(t('app_settings.save_success', {
                defaultValue: 'Application settings were saved.',
            }));
        } catch (failure) {
            toast.error(failure.message || t('app_settings.save_failed'));
        } finally {
            setSaving(false);
        }
    };

    const renderFieldControl = (field, locked) => {
        const fieldKey = field.key;
        const value = draft[fieldKey];
        const validationMessage = validationErrors[fieldKey];
        const hasChoices = Array.isArray(field.choices) && field.choices.length > 0;
        const helperTextSx = {
            backgroundColor: 'transparent !important',
            color: (theme) => `${theme.palette.text.primary} !important`,
            opacity: 0.84,
            m: 0,
            mt: 0.5,
            px: 0,
            py: 0,
            '&.Mui-error': {
                color: (theme) => `${theme.palette.error.main} !important`,
                opacity: 1,
            },
            '&.Mui-disabled': {
                opacity: 0.6,
            },
        };
        const rangeHelper = field.minimum != null || field.maximum != null
            ? `Range: ${field.minimum ?? '-inf'} .. ${field.maximum ?? '+inf'}`
            : '';
        const listHelper = field.value_type === 'string_list'
            ? t('app_settings.one_per_line', { defaultValue: 'One value per line.' })
            : '';
        const helperText = [rangeHelper, listHelper].filter(Boolean).join(' ');

        if (field.value_type === 'boolean') {
            return (
                <Stack spacing={1.5}>
                    <FormControlLabel
                        control={
                            <Switch
                                checked={Boolean(value)}
                                onChange={(event) => handleFieldChange(fieldKey, event.target.checked)}
                                disabled={loading || saving || locked}
                            />
                        }
                        label={
                            <Stack spacing={0.25} sx={{ pr: 1 }}>
                                <Typography variant="body2" color="text.secondary">
                                    {fieldDescription(field)}
                                </Typography>
                            </Stack>
                        }
                        sx={{ m: 0 }}
                    />
                    {validationMessage && (
                        <Alert severity="error" sx={{ py: 0 }}>
                            {validationMessage}
                        </Alert>
                    )}
                </Stack>
            );
        }

        if (field.value_type === 'string_list') {
            return (
                <TextField
                    fullWidth
                    multiline
                    minRows={2}
                    maxRows={10}
                    size="small"
                    label={formatFieldName(fieldKey)}
                    value={value ?? ''}
                    onChange={(event) => handleFieldChange(fieldKey, event.target.value)}
                    helperText={validationMessage || helperText}
                    error={Boolean(validationMessage)}
                    disabled={loading || saving || locked}
                    FormHelperTextProps={{ sx: helperTextSx }}
                />
            );
        }

        if (hasChoices) {
            return (
                <TextField
                    fullWidth
                    select
                    size="small"
                    label={formatFieldName(fieldKey)}
                    value={value ?? ''}
                    onChange={(event) => handleFieldChange(fieldKey, event.target.value)}
                    helperText={validationMessage || helperText}
                    error={Boolean(validationMessage)}
                    disabled={loading || saving || locked}
                    FormHelperTextProps={{ sx: helperTextSx }}
                >
                    {field.choices.map((choice) => (
                        <MenuItem key={`${fieldKey}-${choice}`} value={String(choice)}>
                            {String(choice)}
                        </MenuItem>
                    ))}
                </TextField>
            );
        }

        const isSensitive = Boolean(field.sensitive);
        const isVisible = Boolean(visibleSensitive[fieldKey]);
        const isInteger = field.value_type === 'integer';

        return (
            <TextField
                fullWidth
                size="small"
                type={isSensitive && !isVisible ? 'password' : (isInteger ? 'number' : 'text')}
                label={formatFieldName(fieldKey)}
                value={value ?? ''}
                onChange={(event) => handleFieldChange(fieldKey, event.target.value)}
                helperText={validationMessage || helperText}
                error={Boolean(validationMessage)}
                disabled={loading || saving || locked}
                FormHelperTextProps={{ sx: helperTextSx }}
                inputProps={isInteger ? { min: field.minimum, max: field.maximum, step: 1 } : undefined}
                InputProps={
                    isSensitive
                        ? {
                            endAdornment: (
                                <InputAdornment position="end">
                                    <IconButton
                                        edge="end"
                                        size="small"
                                        onClick={() => handleToggleSensitive(fieldKey)}
                                        aria-label={isVisible ? 'Hide value' : 'Show value'}
                                    >
                                        {isVisible ? (
                                            <VisibilityOffIcon fontSize="small" />
                                        ) : (
                                            <VisibilityIcon fontSize="small" />
                                        )}
                                    </IconButton>
                                </InputAdornment>
                            ),
                        }
                        : undefined
                }
            />
        );
    };

    if (!socket) {
        return (
            <SettingsSurface>
                <SettingsBanner severity="warning">
                    {t('app_settings.no_socket', {
                        defaultValue: 'No active backend connection.',
                    })}
                </SettingsBanner>
            </SettingsSurface>
        );
    }

    return (
        <SettingsSurface>
            <Stack spacing={2}>
                <SettingsSurfaceHeader
                    title={t('app_settings.title', { defaultValue: 'Application Settings' })}
                    subtitle={t('app_settings.subtitle', {
                        defaultValue: 'Manage backend runtime configuration by subsystem.',
                    })}
                    status={{ label: statusLabel, color: statusColor }}
                    onReload={handleReload}
                    reloadLabel={t('app_settings.reload', { defaultValue: 'Reload' })}
                    reloadDisabled={isLoading || saving}
                />

                <SettingsMetaRow sx={{ justifyContent: 'space-between' }}>
                    {payload?.config_path ? (
                        <Typography variant="body2" color="text.secondary">
                            {t('app_settings.config_path', {
                                defaultValue: 'Config file: {{path}}',
                                path: payload.config_path,
                            })}
                        </Typography>
                    ) : (
                        <Box />
                    )}
                    <Typography variant="body2" color="text.secondary">
                        {settingsCountLabel}
                    </Typography>
                </SettingsMetaRow>

                {loadError && (
                    <SettingsBanner severity="error">
                        <AlertTitle>{t('app_settings.load_failed', { defaultValue: 'Load failed' })}</AlertTitle>
                        {loadError}
                    </SettingsBanner>
                )}

                {saveResult?.changedKeys?.length > 0 && (
                    <SettingsBanner severity={saveResult.restartRequired ? 'warning' : 'success'}>
                        <AlertTitle>
                            {saveResult.restartRequired
                                ? t('app_settings.restart_needed_title', { defaultValue: 'Restart Required' })
                                : t('app_settings.save_complete_title', { defaultValue: 'Save Complete' })}
                        </AlertTitle>
                        <Typography variant="body2">
                            {t('app_settings.updated_keys', {
                                defaultValue: 'Updated: {{keys}}',
                                keys: saveResult.changedKeys.join(', '),
                            })}
                        </Typography>
                        {saveResult.restartRequired && (
                            <CapsButton
                                size="small"
                                sx={{ mt: 1 }}
                                onClick={() => navigate('/admin/system/maintenance/system')}
                            >
                                {t('app_settings.open_restart', { defaultValue: 'Open Maintenance' })}
                            </CapsButton>
                        )}
                    </SettingsBanner>
                )}

                {loading && fields.length === 0 && (
                    <SettingsBanner severity="info">
                        <Stack direction="row" spacing={1} alignItems="center">
                            <CircularProgress size={18} />
                            <Typography variant="body2">
                                {t('app_settings.loading', { defaultValue: 'Loading application settings...' })}
                            </Typography>
                        </Stack>
                    </SettingsBanner>
                )}

                {groupedFields.map((group) => (
                    <SettingsSection
                        key={group.key}
                        title={group.title}
                        description={group.description || null}
                    >
                        <Grid container spacing={1.25} columns={12}>
                            {group.fields.map((field) => {
                                const source = payload?.source?.[field.key] || 'default';
                                const locked = Boolean(payload?.locked?.[field.key]);
                                const definedInFile = Boolean(payload?.defined_in_file?.[field.key]);
                                const forceFullWidth = field.value_type === 'string_list' || field.value_type === 'boolean';
                                const applyModeMeta = getApplyModeMeta(field.apply_mode, t);
                                const applyModeChipSx = (field.apply_mode === 'restart_required' || field.apply_mode === 'hot')
                                    ? {
                                        height: 16,
                                        '& .MuiChip-label': {
                                            px: 0.6,
                                            fontSize: '0.6rem',
                                            lineHeight: 1.1,
                                            fontWeight: 400,
                                        },
                                    }
                                    : undefined;
                                return (
                                    <Grid
                                        key={field.key}
                                        size={{ xs: 12, md: forceFullWidth ? 12 : 6 }}
                                    >
                                        <Box
                                            sx={{
                                                p: 1.5,
                                                border: '1px solid',
                                                borderColor: 'divider',
                                                borderRadius: 1,
                                                backgroundColor: (theme) => getSettingCardBackground(field.apply_mode, theme),
                                                height: '100%',
                                                display: 'flex',
                                                flexDirection: 'column',
                                                gap: 1,
                                            }}
                                        >
                                            <Typography
                                                variant="body2"
                                                title={`${formatFieldName(field.key)} (${field.key}) ${fieldDescription(field)}`}
                                                sx={{
                                                    fontSize: { xs: '0.68rem', sm: '0.78rem', md: '0.82rem' },
                                                    lineHeight: 1.2,
                                                    whiteSpace: 'nowrap',
                                                    overflow: 'hidden',
                                                    textOverflow: 'ellipsis',
                                                    minWidth: 0,
                                                }}
                                            >
                                                <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
                                                    {formatFieldName(field.key)}
                                                </Box>
                                                <Box component="span" sx={{ ml: 0.5, color: 'text.disabled' }}>
                                                    ({field.key})
                                                </Box>
                                                <Box component="span" sx={{ ml: 0.75, color: 'text.secondary' }}>
                                                    {fieldDescription(field)}
                                                </Box>
                                            </Typography>

                                            <SettingsMetaRow>
                                                <Chip
                                                    size="small"
                                                    color={applyModeMeta.color}
                                                    label={applyModeMeta.label}
                                                    variant="outlined"
                                                    sx={applyModeChipSx}
                                                />
                                                <Typography variant="caption" color="text.secondary">
                                                    {t('app_settings.source_text', {
                                                        defaultValue: 'Source: {{source}}',
                                                        source: SOURCE_LABELS[source] || source,
                                                    })}
                                                </Typography>
                                                {locked && (
                                                    <Typography variant="caption" color="warning.main" sx={{ fontWeight: 600 }}>
                                                        {t('app_settings.locked', { defaultValue: 'Set by startup command (read-only)' })}
                                                    </Typography>
                                                )}
                                                {!definedInFile && (
                                                    <Typography variant="caption" color="text.secondary">
                                                        {t('app_settings.not_in_file', { defaultValue: 'Not in file' })}
                                                    </Typography>
                                                )}
                                            </SettingsMetaRow>
                                            {renderFieldControl(field, locked)}
                                        </Box>
                                    </Grid>
                                );
                            })}
                        </Grid>
                    </SettingsSection>
                ))}

                <UsageForm
                    enabled={usage.enabled}
                    onChange={usage.onChange}
                    disabled={saving || usage.loading || !usage.status || usage.status.storage_error}
                    error={usage.error}
                    storageError={usage.status?.storage_error}
                />

                <SettingsActionFooter
                    statusText={footerStatusText}
                    sticky
                    mobileInline
                    sx={{
                        bgcolor: 'surface.raised',
                        boxShadow: (theme) => theme.palette.mode === 'dark'
                            ? '0 0 12px rgba(0, 0, 0, 0.45)'
                            : '0 0 12px rgba(0, 0, 0, 0.16)',
                    }}
                >
                    <CapsButton variant="outlined" onClick={handleReset} disabled={saving || isLoading || !isDirty}>
                        {t('app_settings.reset', { defaultValue: 'Reset' })}
                    </CapsButton>
                    <CapsButton variant="contained" onClick={handleSave} disabled={saving || isLoading || !isDirty}>
                        {saving
                            ? t('app_settings.saving', { defaultValue: 'Saving...' })
                            : t('app_settings.save', { defaultValue: 'Save Settings' })}
                    </CapsButton>
                </SettingsActionFooter>
            </Stack>
        </SettingsSurface>
    );
};

export default AppSettingsForm;
