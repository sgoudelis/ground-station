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

import React, { useEffect, useMemo, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { updatePreferences, setPreference } from './preferences-slice.jsx';
import { tz } from 'moment-timezone';
import { useTranslation } from 'react-i18next';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Backdrop,
    Box,
    Button,
    Chip,
    CircularProgress,
    FormControl,
    FormHelperText,
    IconButton,
    InputAdornment,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    TextField,
    Typography,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import { alpha } from '@mui/material/styles';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { useSocket } from '../common/socket.jsx';
import { toast } from '../../utils/toast-with-timestamp.jsx';
import { getAvailableThemesWithMetadata } from '../../themes/theme-configs.js';
import {
    SettingsActionFooter,
    SettingsBanner,
    SettingsMetaRow,
    SettingsSection,
    SettingsSurface,
    SettingsSurfaceHeader,
} from './shared/index.js';

const EDITABLE_KEYS = [
    'timezone',
    'locale',
    'language',
    'theme',
    'celestial_enabled',
    'toast_position',
    'stadia_maps_api_key',
    'gemini_api_key',
    'deepgram_api_key',
    'google_translate_api_key',
];

const languageOptions = [
    { name: 'English', value: 'en_US' },
    { name: 'Eλληνικά', value: 'el_GR' },
    { name: 'Français', value: 'fr_FR' },
    { name: 'Español', value: 'es_ES' },
    { name: 'Deutsch', value: 'de_DE' },
    { name: 'Italiano', value: 'it_IT' },
    { name: 'Nederlands', value: 'nl_NL' },
    { name: '简体中文', value: 'zh_CN' },
];

const localeOptions = [
    { name: 'Browser Default', value: 'browser' },
    { name: 'English (United States)', value: 'en-US' },
    { name: 'English (United Kingdom)', value: 'en-GB' },
    { name: 'Eλληνικά (Greek)', value: 'el-GR' },
    { name: 'Deutsch (German)', value: 'de-DE' },
    { name: 'Français (French)', value: 'fr-FR' },
    { name: 'Español (Spanish)', value: 'es-ES' },
    { name: 'Italiano (Italian)', value: 'it-IT' },
    { name: 'Nederlands (Dutch)', value: 'nl-NL' },
    { name: 'Portugues (Portuguese)', value: 'pt-PT' },
    { name: 'Pyccкий (Russian)', value: 'ru-RU' },
    { name: '日本語 (Japanese)', value: 'ja-JP' },
    { name: '中文 (Chinese Simplified)', value: 'zh-CN' },
];

const getPreferenceCardBackground = (theme) => (
    theme.palette.mode === 'dark'
        ? alpha(theme.palette.grey[700], 0.18)
        : alpha(theme.palette.grey[100], 0.9)
);

const preferenceCardSx = {
    p: 1.5,
    border: '1px solid',
    borderColor: 'divider',
    borderRadius: 1,
    backgroundColor: (theme) => getPreferenceCardBackground(theme),
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
};

const preferenceFieldHeadingSx = {
    fontSize: { xs: '0.7rem', sm: '0.78rem', md: '0.82rem' },
    lineHeight: 1.2,
    mb: 0.75,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    minWidth: 0,
};

const integrationStatusChipSx = {
    height: 16,
    '& .MuiChip-label': {
        px: 0.6,
        fontSize: '0.62rem',
        lineHeight: 1.1,
        fontWeight: 400,
    },
};

const PreferenceFieldHeading = ({ title, subtitle }) => (
    <Typography variant="body2" title={`${title} ${subtitle || ''}`.trim()} sx={preferenceFieldHeadingSx}>
        <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
            {title}
        </Box>
        {subtitle ? (
            <Box component="span" sx={{ ml: 0.75, color: 'text.secondary' }}>
                {subtitle}
            </Box>
        ) : null}
    </Typography>
);

const normalizePreferences = (preferences) => {
    const result = Object.fromEntries(EDITABLE_KEYS.map((key) => [key, '']));

    preferences.forEach((pref) => {
        if (EDITABLE_KEYS.includes(pref.name)) {
            result[pref.name] = pref.value ?? '';
        }
    });

    if (!result.locale) {
        result.locale = 'browser';
    }

    return result;
};

const SecretsField = ({
    fieldKey,
    label,
    value,
    placeholder,
    helperText,
    statusLabel,
    visible,
    onToggleVisibility,
    onChange,
    disabled,
}) => {
    const helperId = `${fieldKey}-helper`;

    return (
        <Stack spacing={1}>
            <SettingsMetaRow sx={{ justifyContent: 'space-between' }}>
                <Typography variant="subtitle2">{label}</Typography>
                <Chip
                    size="small"
                    color={value ? 'success' : 'default'}
                    label={statusLabel}
                    variant={value ? 'filled' : 'outlined'}
                    sx={integrationStatusChipSx}
                />
            </SettingsMetaRow>
            <TextField
                fullWidth
                size="small"
                type={visible ? 'text' : 'password'}
                value={value}
                placeholder={placeholder}
                autoComplete="off"
                onChange={(event) => onChange(event.target.value)}
                aria-describedby={helperId}
                inputProps={{
                    autoComplete: 'off',
                    'data-form-type': 'other',
                    'data-lpignore': 'true',
                }}
                InputProps={{
                    endAdornment: (
                        <InputAdornment position="end">
                            <IconButton
                                edge="end"
                                size="small"
                                onClick={onToggleVisibility}
                                aria-label={visible ? 'Hide API key' : 'Show API key'}
                            >
                                {visible ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                            </IconButton>
                        </InputAdornment>
                    ),
                }}
                disabled={disabled}
            />
            <FormHelperText id={helperId}>{helperText}</FormHelperText>
        </Stack>
    );
};

const PreferencesForm = ({ mode = 'preferences' }) => {
    const { socket } = useSocket();
    const dispatch = useDispatch();
    const { preferences, status } = useSelector((state) => state.preferences);
    const isLoading = status === 'loading';
    const { t, i18n } = useTranslation('settings');

    const [draft, setDraft] = useState(() => normalizePreferences(preferences));
    const [savedSnapshot, setSavedSnapshot] = useState(() => normalizePreferences(preferences));
    const [initialized, setInitialized] = useState(false);
    const [reloading, setReloading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const [visibleSecrets, setVisibleSecrets] = useState({
        stadia_maps_api_key: false,
        gemini_api_key: false,
        deepgram_api_key: false,
        google_translate_api_key: false,
    });
    const isIntegrationsMode = mode === 'integrations';

    const timezoneOptions = useMemo(
        () => tz.names().map((zone) => ({ name: zone.replace('_', ' '), value: zone })),
        []
    );

    const themesOptions = useMemo(() => getAvailableThemesWithMetadata(), []);

    const toastPositionOptions = useMemo(
        () => [
            { name: t('preferences.toast_position_top_left'), value: 'top-left' },
            { name: t('preferences.toast_position_top_center'), value: 'top-center' },
            { name: t('preferences.toast_position_top_right'), value: 'top-right' },
            { name: t('preferences.toast_position_bottom_left'), value: 'bottom-left' },
            { name: t('preferences.toast_position_bottom_center'), value: 'bottom-center' },
            { name: t('preferences.toast_position_bottom_right'), value: 'bottom-right' },
        ],
        [t]
    );

    const isDirty = useMemo(() => {
        return EDITABLE_KEYS.some((key) => (draft[key] ?? '') !== (savedSnapshot[key] ?? ''));
    }, [draft, savedSnapshot]);

    const themeChanged = (draft.theme ?? '') !== (savedSnapshot.theme ?? '');

    useEffect(() => {
        const normalized = normalizePreferences(preferences);

        if (!initialized) {
            setDraft(normalized);
            setSavedSnapshot(normalized);
            setInitialized(true);
            return;
        }

        if (!isDirty && !isSaving) {
            setDraft(normalized);
            setSavedSnapshot(normalized);
        }
    }, [preferences, initialized, isDirty, isSaving]);

    const handleDraftChange = (name, value) => {
        setDraft((prev) => ({ ...prev, [name]: value }));
    };

    const toggleSecretVisibility = (key) => {
        setVisibleSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    const handleReset = () => {
        setDraft(savedSnapshot);
        setVisibleSecrets({
            stadia_maps_api_key: false,
            gemini_api_key: false,
            deepgram_api_key: false,
            google_translate_api_key: false,
        });
    };

    const handleSavePreferences = async () => {
        if (!isDirty || isSaving || isLoading) return;

        setIsSaving(true);

        try {
            EDITABLE_KEYS.forEach((key) => {
                dispatch(setPreference({ name: key, value: draft[key] ?? '' }));
            });

            await dispatch(updatePreferences({ socket })).unwrap();
            setSavedSnapshot(draft);

            const languageCode = (draft.language || 'en_US').split('_')[0];
            if (i18n.language !== languageCode) {
                await i18n.changeLanguage(languageCode);
            }

            toast.success(t('preferences.save_success'));

            if (themeChanged) {
                setReloading(true);
                setTimeout(() => {
                    window.location.reload();
                }, 900);
            }
        } catch {
            toast.error(t('preferences.save_error'));
        } finally {
            setIsSaving(false);
        }
    };

    const saveStatusText = isSaving || isLoading
        ? t('preferences.saving_button', { defaultValue: 'Saving...' })
        : isDirty
            ? t('app_settings.unsaved', { defaultValue: 'Unsaved changes' })
            : t('app_settings.saved', { defaultValue: 'Saved' });

    const headerStatusText = isSaving || isLoading
        ? t('preferences.saving_button', { defaultValue: 'Saving...' })
        : isDirty
            ? t('app_settings.unsaved', { defaultValue: 'Unsaved changes' })
            : t('app_settings.saved', { defaultValue: 'Saved' });

    const headerStatusColor = isSaving || isLoading ? 'info' : (isDirty ? 'warning' : 'success');

    return (
        <>
            <Backdrop
                sx={{
                    color: '#fff',
                    zIndex: (theme) => theme.zIndex.drawer + 1,
                    backdropFilter: 'blur(4px)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2,
                }}
                open={reloading}
            >
                <CircularProgress color="inherit" />
                <Typography variant="h6">{t('preferences.reloading', { defaultValue: 'Reloading...' })}</Typography>
            </Backdrop>

            <SettingsSurface>
                <Box component="form">
                    <Stack spacing={2}>
                        <SettingsSurfaceHeader
                            title={isIntegrationsMode
                                ? t('preferences.integration_tab_title', { defaultValue: 'Integrations' })
                                : t('preferences.title', { defaultValue: 'User Preferences' })}
                            subtitle={isIntegrationsMode
                                ? t('preferences.integration_tab_subtitle', { defaultValue: 'Manage API keys and external service integrations.' })
                                : t('preferences.preferences_tab_subtitle', { defaultValue: 'Configure regional, appearance, and experimental behavior.' })}
                            status={{ label: headerStatusText, color: headerStatusColor }}
                        />

                        {!isIntegrationsMode ? (
                            <>
                                <SettingsSection
                                    title={t('preferences.group_regional_language', { defaultValue: 'Regional & Language' })}
                                    description={t('preferences.group_regional_language_help', {
                                        defaultValue: 'Controls language, timezone, and regional formatting used across the UI.',
                                    })}
                                >
                            <Grid container spacing={2} columns={12}>
                                <Grid size={{ xs: 12, md: 6 }}>
                                    <Box sx={preferenceCardSx}>
                                        <PreferenceFieldHeading
                                            title={t('preferences.timezone')}
                                            subtitle={t('preferences.timezone_help', { defaultValue: 'Used for satellite pass times and scheduling displays.' })}
                                        />
                                        <FormControl fullWidth size="small" disabled={isSaving || isLoading}>
                                            <InputLabel>{t('preferences.timezone')}</InputLabel>
                                            <Select
                                                value={draft.timezone || ''}
                                                label={t('preferences.timezone')}
                                                onChange={(event) => handleDraftChange('timezone', event.target.value)}
                                            >
                                                {timezoneOptions.map((option) => (
                                                    <MenuItem key={option.value} value={option.value}>
                                                        {option.name}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>
                                    </Box>
                                </Grid>

                                <Grid size={{ xs: 12, md: 6 }}>
                                    <Box sx={preferenceCardSx}>
                                        <PreferenceFieldHeading
                                            title={t('preferences.locale_formatting', { defaultValue: 'Locale (Formatting)' })}
                                            subtitle={t('preferences.locale_help', { defaultValue: 'Controls date and number formatting in the UI.' })}
                                        />
                                        <FormControl fullWidth size="small" disabled={isSaving || isLoading}>
                                            <InputLabel>{t('preferences.locale_formatting', { defaultValue: 'Locale (Formatting)' })}</InputLabel>
                                            <Select
                                                value={draft.locale || 'browser'}
                                                label={t('preferences.locale_formatting', { defaultValue: 'Locale (Formatting)' })}
                                                onChange={(event) => handleDraftChange('locale', event.target.value)}
                                            >
                                                {localeOptions.map((option) => (
                                                    <MenuItem key={option.value} value={option.value}>
                                                        {option.value === 'browser'
                                                            ? `${t('preferences.browser_default', { defaultValue: 'Browser Default' })} (${navigator.language})`
                                                            : option.name}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>
                                    </Box>
                                </Grid>

                                <Grid size={{ xs: 12, md: 6 }}>
                                    <Box sx={preferenceCardSx}>
                                        <PreferenceFieldHeading
                                            title={t('preferences.language')}
                                            subtitle={t('preferences.language_help', { defaultValue: 'Changes interface language after saving.' })}
                                        />
                                        <FormControl fullWidth size="small" disabled={isSaving || isLoading}>
                                            <InputLabel>{t('preferences.language')}</InputLabel>
                                            <Select
                                                value={draft.language || 'en_US'}
                                                label={t('preferences.language')}
                                                onChange={(event) => handleDraftChange('language', event.target.value)}
                                            >
                                                {languageOptions.map((option) => (
                                                    <MenuItem key={option.value} value={option.value}>
                                                        {option.name}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>
                                    </Box>
                                </Grid>
                            </Grid>
                                </SettingsSection>

                                <SettingsSection
                                    title={t('preferences.group_appearance_notifications', { defaultValue: 'Appearance & Notifications' })}
                                    description={t('preferences.group_appearance_notifications_help', {
                                        defaultValue: 'Visual theme selection and notification placement.',
                                    })}
                                >
                            <Grid container spacing={2} columns={12}>
                                <Grid size={{ xs: 12, md: 6 }}>
                                    <Box sx={preferenceCardSx}>
                                        <PreferenceFieldHeading
                                            title={t('preferences.theme')}
                                            subtitle={t('preferences.theme_help', { defaultValue: 'Theme change is applied after saving and page reload.' })}
                                        />
                                        <FormControl fullWidth size="small" disabled={isSaving || isLoading}>
                                            <InputLabel htmlFor="theme-selector">{t('preferences.theme')}</InputLabel>
                                            <Select
                                                id="theme-selector"
                                                value={draft.theme || 'auto'}
                                                label={t('preferences.theme')}
                                                onChange={(event) => handleDraftChange('theme', event.target.value)}
                                            >
                                                {themesOptions.map((option) => (
                                                    <MenuItem key={option.id} value={option.id}>
                                                        {option.name}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>
                                        {themeChanged && (
                                            <SettingsBanner severity="info" sx={{ mt: 1 }}>
                                                {t('preferences.theme_reload_required', { defaultValue: 'Theme will be applied after saving and reloading.' })}
                                            </SettingsBanner>
                                        )}
                                    </Box>
                                </Grid>

                                <Grid size={{ xs: 12, md: 6 }}>
                                    <Box sx={preferenceCardSx}>
                                        <PreferenceFieldHeading
                                            title={t('preferences.toast_position')}
                                            subtitle={t('preferences.toast_position_help', { defaultValue: 'Choose where system notifications appear.' })}
                                        />
                                        <FormControl fullWidth size="small" disabled={isSaving || isLoading}>
                                            <InputLabel>{t('preferences.toast_position')}</InputLabel>
                                            <Select
                                                value={draft.toast_position || 'bottom-center'}
                                                label={t('preferences.toast_position')}
                                                onChange={(event) => handleDraftChange('toast_position', event.target.value)}
                                            >
                                                {toastPositionOptions.map((option) => (
                                                    <MenuItem key={option.value} value={option.value}>
                                                        {option.name}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>
                                    </Box>
                                </Grid>
                            </Grid>
                                </SettingsSection>

                                <SettingsSection
                                    title={t('preferences.group_experimental', { defaultValue: 'Experimental' })}
                                    description={t('preferences.group_experimental_help', {
                                        defaultValue: 'Feature flags for pages and flows that are still under active development.',
                                    })}
                                >
                            <Grid container spacing={2} columns={12}>
                                <Grid size={{ xs: 12, md: 6 }}>
                                    <Box sx={preferenceCardSx}>
                                        <PreferenceFieldHeading
                                            title={t('preferences.celestial_page')}
                                            subtitle={t('preferences.celestial_page_help', { defaultValue: 'Show or hide the Solar System page while it is under development.' })}
                                        />
                                        <FormControl fullWidth size="small" disabled={isSaving || isLoading}>
                                            <InputLabel>{t('preferences.celestial_page')}</InputLabel>
                                            <Select
                                                value={draft.celestial_enabled || 'false'}
                                                label={t('preferences.celestial_page')}
                                                onChange={(event) => handleDraftChange('celestial_enabled', event.target.value)}
                                            >
                                                <MenuItem value="false">
                                                    {t('preferences.celestial_hidden', { defaultValue: 'Hidden (default)' })}
                                                </MenuItem>
                                                <MenuItem value="true">
                                                    {t('preferences.celestial_visible', { defaultValue: 'Visible' })}
                                                </MenuItem>
                                            </Select>
                                        </FormControl>
                                    </Box>
                                </Grid>
                            </Grid>
                                </SettingsSection>
                            </>
                        ) : null}

                        {isIntegrationsMode ? (
                            <SettingsSection
                                title={t('preferences.integration_section_title', { defaultValue: 'Integration' })}
                                description={t('preferences.integration_section_help', {
                                    defaultValue: 'Manage API keys for map providers, transcription, and translation services.',
                                })}
                            >
                                <Grid container spacing={2} columns={12}>
                                    <Grid size={{ xs: 12, md: 6 }}>
                                        <Box sx={preferenceCardSx}>
                                            <SecretsField
                                                fieldKey="stadia_maps_api_key"
                                                label={t('preferences.stadia_maps_api_key')}
                                                value={draft.stadia_maps_api_key || ''}
                                                placeholder={t('preferences.api_key_placeholder', { defaultValue: 'Paste API key' })}
                                                helperText={t('preferences.stadia_api_help', { defaultValue: 'Used for map tile providers that require an API token.' })}
                                                statusLabel={draft.stadia_maps_api_key
                                                    ? t('preferences.configured', { defaultValue: 'Configured' })
                                                    : t('preferences.not_configured', { defaultValue: 'Not configured' })}
                                                visible={visibleSecrets.stadia_maps_api_key}
                                                onToggleVisibility={() => toggleSecretVisibility('stadia_maps_api_key')}
                                                onChange={(value) => handleDraftChange('stadia_maps_api_key', value)}
                                                disabled={isSaving || isLoading}
                                            />
                                        </Box>
                                    </Grid>
                                    <Grid size={{ xs: 12, md: 6 }}>
                                        <Stack spacing={1.25}>
                                        <Accordion
                                            disableGutters
                                            sx={{
                                                border: '1px solid',
                                                borderColor: 'divider',
                                                borderRadius: 1,
                                                backgroundColor: (theme) => getPreferenceCardBackground(theme),
                                                overflow: 'hidden',
                                                '&:before': { display: 'none' },
                                            }}
                                        >
                                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                                <SettingsMetaRow>
                                                    <Typography fontWeight={600}>{t('preferences.gemini_api_key', { defaultValue: 'Gemini API Key' })}</Typography>
                                                    <Chip
                                                        size="small"
                                                        color={draft.gemini_api_key ? 'success' : 'default'}
                                                        label={draft.gemini_api_key
                                                            ? t('preferences.configured', { defaultValue: 'Configured' })
                                                            : t('preferences.not_configured', { defaultValue: 'Not configured' })}
                                                        sx={integrationStatusChipSx}
                                                    />
                                                </SettingsMetaRow>
                                            </AccordionSummary>
                                            <AccordionDetails>
                                                <Stack spacing={1.5}>
                                                    <SecretsField
                                                        fieldKey="gemini_api_key"
                                                        label={t('preferences.gemini_api_key', { defaultValue: 'Gemini API Key' })}
                                                        value={draft.gemini_api_key || ''}
                                                        placeholder="AIza..."
                                                        helperText={t('preferences.gemini_api_key_help', { defaultValue: 'Google Gemini API key for audio transcription. Get yours at ai.google.dev.' })}
                                                        statusLabel={draft.gemini_api_key
                                                            ? t('preferences.configured', { defaultValue: 'Configured' })
                                                            : t('preferences.not_configured', { defaultValue: 'Not configured' })}
                                                        visible={visibleSecrets.gemini_api_key}
                                                        onToggleVisibility={() => toggleSecretVisibility('gemini_api_key')}
                                                        onChange={(value) => handleDraftChange('gemini_api_key', value)}
                                                        disabled={isSaving || isLoading}
                                                    />
                                                    <Typography variant="caption" color="text.secondary">
                                                        {t('preferences.gemini_privacy_text', { defaultValue: 'When enabled, audio is sent to Google servers. You are responsible for associated usage costs.' })}
                                                    </Typography>
                                                    <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                                                        <a
                                                            href="https://ai.google.dev/gemini-api/terms"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            aria-label={t('preferences.gemini_terms_link_aria', { defaultValue: 'Open Gemini Terms in a new tab' })}
                                                        >
                                                            {t('preferences.gemini_terms_link', { defaultValue: 'Gemini Terms' })}
                                                        </a>
                                                        <a
                                                            href="https://github.com/sgoudelis/ground-station/blob/main/TRANSCRIPTION_PRIVACY.md"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            aria-label={t('preferences.privacy_notice_link_aria', { defaultValue: 'Open privacy notice in a new tab' })}
                                                        >
                                                            {t('preferences.privacy_notice_link', { defaultValue: 'Privacy Notice' })}
                                                        </a>
                                                    </Stack>
                                                </Stack>
                                            </AccordionDetails>
                                        </Accordion>

                                        <Accordion
                                            disableGutters
                                            sx={{
                                                border: '1px solid',
                                                borderColor: 'divider',
                                                borderRadius: 1,
                                                backgroundColor: (theme) => getPreferenceCardBackground(theme),
                                                overflow: 'hidden',
                                                '&:before': { display: 'none' },
                                            }}
                                        >
                                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                                <SettingsMetaRow>
                                                    <Typography fontWeight={600}>{t('preferences.deepgram_api_key', { defaultValue: 'Deepgram API Key' })}</Typography>
                                                    <Chip
                                                        size="small"
                                                        color={draft.deepgram_api_key ? 'success' : 'default'}
                                                        label={draft.deepgram_api_key
                                                            ? t('preferences.configured', { defaultValue: 'Configured' })
                                                            : t('preferences.not_configured', { defaultValue: 'Not configured' })}
                                                        sx={integrationStatusChipSx}
                                                    />
                                                </SettingsMetaRow>
                                            </AccordionSummary>
                                            <AccordionDetails>
                                                <Stack spacing={1.5}>
                                                    <SecretsField
                                                        fieldKey="deepgram_api_key"
                                                        label={t('preferences.deepgram_api_key', { defaultValue: 'Deepgram API Key' })}
                                                        value={draft.deepgram_api_key || ''}
                                                        placeholder={t('preferences.api_key_placeholder', { defaultValue: 'Paste API key' })}
                                                        helperText={t('preferences.deepgram_api_key_help', { defaultValue: 'Deepgram API key for audio transcription. Get yours at deepgram.com.' })}
                                                        statusLabel={draft.deepgram_api_key
                                                            ? t('preferences.configured', { defaultValue: 'Configured' })
                                                            : t('preferences.not_configured', { defaultValue: 'Not configured' })}
                                                        visible={visibleSecrets.deepgram_api_key}
                                                        onToggleVisibility={() => toggleSecretVisibility('deepgram_api_key')}
                                                        onChange={(value) => handleDraftChange('deepgram_api_key', value)}
                                                        disabled={isSaving || isLoading}
                                                    />
                                                    <Typography variant="caption" color="text.secondary">
                                                        {t('preferences.deepgram_privacy_text', { defaultValue: 'When enabled, audio is sent to Deepgram servers. You are responsible for associated usage costs.' })}
                                                    </Typography>
                                                    <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                                                        <a
                                                            href="https://deepgram.com/pricing"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            aria-label={t('preferences.deepgram_pricing_link_aria', { defaultValue: 'Open Deepgram pricing in a new tab' })}
                                                        >
                                                            {t('preferences.deepgram_pricing_link', { defaultValue: 'Deepgram Pricing' })}
                                                        </a>
                                                        <a
                                                            href="https://github.com/sgoudelis/ground-station/blob/main/TRANSCRIPTION_PRIVACY.md"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            aria-label={t('preferences.privacy_notice_link_aria', { defaultValue: 'Open privacy notice in a new tab' })}
                                                        >
                                                            {t('preferences.privacy_notice_link', { defaultValue: 'Privacy Notice' })}
                                                        </a>
                                                    </Stack>
                                                </Stack>
                                            </AccordionDetails>
                                        </Accordion>

                                        <Accordion
                                            disableGutters
                                            sx={{
                                                border: '1px solid',
                                                borderColor: 'divider',
                                                borderRadius: 1,
                                                backgroundColor: (theme) => getPreferenceCardBackground(theme),
                                                overflow: 'hidden',
                                                '&:before': { display: 'none' },
                                            }}
                                        >
                                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                                                <SettingsMetaRow>
                                                    <Typography fontWeight={600}>{t('preferences.google_translate_api_key', { defaultValue: 'Google Translate API Key' })}</Typography>
                                                    <Chip
                                                        size="small"
                                                        color={draft.google_translate_api_key ? 'success' : 'default'}
                                                        label={draft.google_translate_api_key
                                                            ? t('preferences.configured', { defaultValue: 'Configured' })
                                                            : t('preferences.not_configured', { defaultValue: 'Not configured' })}
                                                        sx={integrationStatusChipSx}
                                                    />
                                                </SettingsMetaRow>
                                            </AccordionSummary>
                                            <AccordionDetails>
                                                <Stack spacing={1.5}>
                                                    <SecretsField
                                                        fieldKey="google_translate_api_key"
                                                        label={t('preferences.google_translate_api_key', { defaultValue: 'Google Translate API Key' })}
                                                        value={draft.google_translate_api_key || ''}
                                                        placeholder="AIza..."
                                                        helperText={t('preferences.google_translate_api_key_help', { defaultValue: 'Google Cloud Translation API key for translating Deepgram transcriptions.' })}
                                                        statusLabel={draft.google_translate_api_key
                                                            ? t('preferences.configured', { defaultValue: 'Configured' })
                                                            : t('preferences.not_configured', { defaultValue: 'Not configured' })}
                                                        visible={visibleSecrets.google_translate_api_key}
                                                        onToggleVisibility={() => toggleSecretVisibility('google_translate_api_key')}
                                                        onChange={(value) => handleDraftChange('google_translate_api_key', value)}
                                                        disabled={isSaving || isLoading}
                                                    />
                                                    <Typography variant="caption" color="text.secondary">
                                                        {t('preferences.google_translate_privacy_text', { defaultValue: 'Used for translation of transcript text through Google Cloud Translation.' })}
                                                    </Typography>
                                                    <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                                                        <a
                                                            href="https://cloud.google.com/translate/pricing"
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            aria-label={t('preferences.google_translate_pricing_link_aria', { defaultValue: 'Open Google Translate pricing in a new tab' })}
                                                        >
                                                            {t('preferences.google_translate_pricing_link', { defaultValue: 'Google Translate Pricing' })}
                                                        </a>
                                                    </Stack>
                                                </Stack>
                                            </AccordionDetails>
                                        </Accordion>
                                        </Stack>
                                    </Grid>
                                </Grid>
                            </SettingsSection>
                        ) : null}

                        <SettingsActionFooter
                            statusText={saveStatusText}
                            sticky
                            mobileInline
                            sx={{
                                mt: 1,
                                backgroundColor: (theme) => getPreferenceCardBackground(theme),
                            }}
                        >
                            <Button
                                variant="outlined"
                                color="inherit"
                                disabled={!isDirty || isSaving || isLoading}
                                onClick={handleReset}
                            >
                                {t('preferences.reset_changes', { defaultValue: 'Reset' })}
                            </Button>
                            <Button
                                variant="contained"
                                color="primary"
                                disabled={!isDirty || isSaving || isLoading}
                                onClick={handleSavePreferences}
                                data-testid="preferences-save-button"
                            >
                                {isSaving || isLoading
                                    ? t('preferences.saving_button', { defaultValue: 'Saving...' })
                                    : t('preferences.save_preferences')}
                            </Button>
                        </SettingsActionFooter>
                    </Stack>
                </Box>
            </SettingsSurface>
        </>
    );
};

export default PreferencesForm;
