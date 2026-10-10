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

import React, {useState} from 'react';
import {
    Typography,
    Divider,
    Button,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Alert,
    AlertTitle,
    Backdrop,
    Box,
    CircularProgress
} from '@mui/material';
import Grid from '@mui/material/Grid';
import {useTranslation} from 'react-i18next';

const ReduxPersistentSettingsCard = () => {
    const {t} = useTranslation('settings');
    const [confirmClearReduxOpen, setConfirmClearReduxOpen] = useState(false);
    const [confirmIndividualAction, setConfirmIndividualAction] = useState(null);
    const [isReloading, setIsReloading] = useState(false);

    const clearReduxPersistentState = () => {
        setConfirmClearReduxOpen(false);
        // Clear all Redux persist keys
        const persistKeys = [
            'persist:waterfall',
            'persist:vfo',
            'persist:rigs',
            'persist:rotators',
            'persist:tleSources',
            'persist:satellites',
            'persist:satelliteGroups',
            'persist:location',
            'persist:synchronize',
            'persist:preferences',
            'persist:targetSatTrack',
            'persist:earthViewTrack',
            'persist:dashboard',
            'persist:weather',
            'persist:sdr',
            'persist:version',
            'persist:filebrowser',
            'persist:celestial',
            'persist:celestialMonitored',
            'persist:celestialDisplay',
            'persist:root'
        ];

        persistKeys.forEach(key => {
            localStorage.removeItem(key);
        });

        // Show reload spinner and reload after 1 second
        setIsReloading(true);
        setTimeout(() => {
            window.location.reload();
        }, 1000);
    };

    const clearFileBrowserPersist = () => {
        localStorage.removeItem('persist:filebrowser');
    };

    const clearWaterfallPersist = () => {
        localStorage.removeItem('persist:waterfall');
    };

    const clearVfoPersist = () => {
        localStorage.removeItem('persist:vfo');
    };

    const clearPreferencesPersist = () => {
        localStorage.removeItem('persist:preferences');
    };

    const clearEarthViewTrackPersist = () => {
        localStorage.removeItem('persist:earthViewTrack');
    };

    const clearCelestialPersist = () => {
        localStorage.removeItem('persist:celestial');
        localStorage.removeItem('persist:celestialMonitored');
        localStorage.removeItem('persist:celestialDisplay');
    };

    const openIndividualConfirmDialog = (title, description, confirmLabel, onConfirm) => {
        setConfirmIndividualAction({
            title,
            description,
            confirmLabel,
            onConfirm,
        });
    };

    const handleConfirmIndividualAction = () => {
        if (!confirmIndividualAction?.onConfirm) return;
        const action = confirmIndividualAction.onConfirm;
        setConfirmIndividualAction(null);
        action();
    };

    return (
        <>
            <Typography variant="h6" gutterBottom>
                {t('redux_persistent_settings_card.redux_persistent_settings', { defaultValue: 'Redux Persistent Settings' })}
            </Typography>
            <Divider sx={{mb: 2}}/>

            <Grid container spacing={2} columns={16}>
                <Grid size={16}>
                    <Alert severity="warning" sx={{mb: 2}}>
                        <AlertTitle>{t('redux_persistent_settings_card.clear_all_redux_settings', { defaultValue: 'Clear All Redux Settings' })}</AlertTitle>
                        {t('redux_persistent_settings_card.this_will_reset_all_application_settings_below_to_their_', { defaultValue: 'This will reset all application settings below to their defaults. Use individual buttons to\n                        clear specific settings only.' })}
                    </Alert>
                </Grid>

                <Grid size={10}>
                    {t('maintenance.clear_redux')}
                    <Typography variant="body2" color="text.secondary">
                        {t('redux_persistent_settings_card.clears_all_redux_persistent_data_all_settings_below', { defaultValue: 'Clears all Redux persistent data (all settings below)' })}
                    </Typography>
                </Grid>
                <Grid size={6}>
                    <Button
                        variant="contained"
                        color="error"
                        onClick={() => setConfirmClearReduxOpen(true)}
                        fullWidth
                        size="small"
                    >
                        {t('maintenance.clear_redux_button')}
                    </Button>
                </Grid>

                <Grid size={16}>
                    <Divider sx={{my: 2}}/>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                        {t('redux_persistent_settings_card.or_clear_individual_settings', { defaultValue: 'Or clear individual settings:' })}
                    </Typography>
                </Grid>

                <Grid size={10}>
                    {t('redux_persistent_settings_card.clear_file_browser_settings', { defaultValue: 'Clear File Browser Settings' })}
                    <Typography variant="body2" color="text.secondary">
                        {t('redux_persistent_settings_card.resets_page_size_sorting_filters_and_view_mode', { defaultValue: 'Resets page size, sorting, filters, and view mode' })}
                    </Typography>
                </Grid>
                <Grid size={6}>
                    <Button
                        variant="outlined"
                        color="warning"
                        onClick={() => openIndividualConfirmDialog(
                            'Clear File Browser Settings?',
                            'This will reset page size, sorting, filters, and view mode for the File Browser.',
                            'Clear File Browser',
                            clearFileBrowserPersist,
                        )}
                        fullWidth
                        size="small"
                    >
                        {t('redux_persistent_settings_card.clear', { defaultValue: 'Clear' })}
                    </Button>
                </Grid>

                <Grid size={10}>
                    {t('redux_persistent_settings_card.clear_waterfall_settings', { defaultValue: 'Clear Waterfall Settings' })}
                    <Typography variant="body2" color="text.secondary">
                        {t('redux_persistent_settings_card.resets_frequency_gain_sample_rate_colormap_fft_settings', { defaultValue: 'Resets frequency, gain, sample rate, colormap, FFT settings' })}
                    </Typography>
                </Grid>
                <Grid size={6}>
                    <Button
                        variant="outlined"
                        color="warning"
                        onClick={() => openIndividualConfirmDialog(
                            'Clear Waterfall Settings?',
                            'This will reset frequency, gain, sample rate, colormap, and FFT settings.',
                            'Clear Waterfall',
                            clearWaterfallPersist,
                        )}
                        fullWidth
                        size="small"
                    >
                        {t('redux_persistent_settings_card.clear', { defaultValue: 'Clear' })}
                    </Button>
                </Grid>

                <Grid size={10}>
                    {t('redux_persistent_settings_card.clear_vfo_settings', { defaultValue: 'Clear VFO Settings' })}
                    <Typography variant="body2" color="text.secondary">
                        {t('redux_persistent_settings_card.resets_all_vfo_markers_frequencies_modes_and_active_stat', { defaultValue: 'Resets all VFO markers, frequencies, modes, and active states' })}
                    </Typography>
                </Grid>
                <Grid size={6}>
                    <Button
                        variant="outlined"
                        color="warning"
                        onClick={() => openIndividualConfirmDialog(
                            'Clear VFO Settings?',
                            'This will reset all VFO markers, frequencies, modes, and active states.',
                            'Clear VFO',
                            clearVfoPersist,
                        )}
                        fullWidth
                        size="small"
                    >
                        {t('redux_persistent_settings_card.clear', { defaultValue: 'Clear' })}
                    </Button>
                </Grid>

                <Grid size={10}>
                    {t('redux_persistent_settings_card.clear_preferences', { defaultValue: 'Clear Preferences' })}
                    <Typography variant="body2" color="text.secondary">
                        {t('redux_persistent_settings_card.resets_all_user_preferences_like_timezone_theme_etc', { defaultValue: 'Resets all user preferences like timezone, theme, etc.' })}
                    </Typography>
                </Grid>
                <Grid size={6}>
                    <Button
                        variant="outlined"
                        color="warning"
                        onClick={() => openIndividualConfirmDialog(
                            'Clear Preferences?',
                            'This will reset user preferences such as timezone and theme.',
                            'Clear Preferences',
                            clearPreferencesPersist,
                        )}
                        fullWidth
                        size="small"
                    >
                        {t('redux_persistent_settings_card.clear', { defaultValue: 'Clear' })}
                    </Button>
                </Grid>

                <Grid size={10}>
                    {t('redux_persistent_settings_card.clear_earth_view_satellite_selection', { defaultValue: 'Clear Earth view Satellite Selection' })}
                    <Typography variant="body2" color="text.secondary">
                        {t('redux_persistent_settings_card.resets_selected_satellite_group_and_satellite_in_earth_v', { defaultValue: 'Resets selected satellite group and satellite in earth view page' })}
                    </Typography>
                </Grid>
                <Grid size={6}>
                    <Button
                        variant="outlined"
                        color="warning"
                        onClick={() => openIndividualConfirmDialog(
                            'Clear Earth view Satellite Selection?',
                            'This will reset selected satellite group and satellite on the Earth view page.',
                            'Clear Selection',
                            clearEarthViewTrackPersist,
                        )}
                        fullWidth
                        size="small"
                    >
                        {t('redux_persistent_settings_card.clear', { defaultValue: 'Clear' })}
                    </Button>
                </Grid>

                <Grid size={10}>
                    {t('redux_persistent_settings_card.clear_celestial_settings', { defaultValue: 'Clear Celestial Settings' })}
                    <Typography variant="body2" color="text.secondary">
                        {t('redux_persistent_settings_card.resets_map_settings_monitored_table_state_and_solar_syst', { defaultValue: 'Resets map settings, monitored table state, and solar system display options' })}
                    </Typography>
                </Grid>
                <Grid size={6}>
                    <Button
                        variant="outlined"
                        color="warning"
                        onClick={() => openIndividualConfirmDialog(
                            'Clear Celestial Settings?',
                            'This will reset map settings, monitored table state, and solar system display options.',
                            'Clear Celestial',
                            clearCelestialPersist,
                        )}
                        fullWidth
                        size="small"
                    >
                        {t('redux_persistent_settings_card.clear', { defaultValue: 'Clear' })}
                    </Button>
                </Grid>
            </Grid>

            {/* Clear Redux Persist Confirmation Dialog */}
            <Dialog
                open={confirmClearReduxOpen}
                onClose={() => setConfirmClearReduxOpen(false)}
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
                    {t('redux_persistent_settings_card.clear_all_redux_persistent_state', { defaultValue: 'Clear All Redux Persistent State?' })}
                </DialogTitle>
                <DialogContent sx={{ px: 3, pt: 3, pb: 3 }}>
                    <Alert severity="info" sx={{ mt: 2, mb: 2 }}>
                        <AlertTitle>{t('redux_persistent_settings_card.local_browser_cache_only', { defaultValue: 'Local Browser Cache Only' })}</AlertTitle>
                        {t('redux_persistent_settings_card.this_will_only_clear_application_settings_stored_in_your', { defaultValue: 'This will only clear application settings stored in your browser\'s local storage. No backend\n                        data (satellites, rigs, rotators, recordings, etc.) will be deleted.' })}
                    </Alert>
                    <Typography variant="body1" sx={{ mb: 2, color: 'text.primary' }}>
                        {t('redux_persistent_settings_card.this_action_will_reset_all_local_application_settings_to', { defaultValue: 'This action will reset ALL local application settings to their defaults!' })}
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 2, fontWeight: 600, color: 'text.secondary' }}>
                        {t('redux_persistent_settings_card.settings_to_be_cleared', { defaultValue: 'Settings to be cleared:' })}
                    </Typography>
                    <Box sx={{
                        maxHeight: 300,
                        overflowY: 'auto',
                        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
                        borderRadius: 1,
                        border: (theme) => `1px solid ${theme.palette.divider}`,
                        p: 2,
                    }}>
                        <Typography component="div" variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                            <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
                                <li>{t('redux_persistent_settings_card.waterfall_settings_frequency_gain_sample_rate_colormap_f', { defaultValue: 'Waterfall settings (frequency, gain, sample rate, colormap, FFT)' })}</li>
                                <li>{t('redux_persistent_settings_card.vfo_settings_markers_frequencies_modes_active_states', { defaultValue: 'VFO settings (markers, frequencies, modes, active states)' })}</li>
                                <li>{t('redux_persistent_settings_card.cached_rig_configurations', { defaultValue: 'Cached rig configurations' })}</li>
                                <li>{t('redux_persistent_settings_card.cached_rotator_configurations', { defaultValue: 'Cached rotator configurations' })}</li>
                                <li>{t('redux_persistent_settings_card.cached_orbital_sources', { defaultValue: 'Cached orbital sources' })}</li>
                                <li>{t('redux_persistent_settings_card.cached_satellite_and_group_data', { defaultValue: 'Cached satellite and group data' })}</li>
                                <li>{t('redux_persistent_settings_card.location_settings', { defaultValue: 'Location settings' })}</li>
                                <li>{t('redux_persistent_settings_card.user_preferences_timezone_theme', { defaultValue: 'User preferences (timezone, theme)' })}</li>
                                <li>{t('redux_persistent_settings_card.dashboard_settings', { defaultValue: 'Dashboard settings' })}</li>
                                <li>{t('redux_persistent_settings_card.weather_settings', { defaultValue: 'Weather settings' })}</li>
                                <li>{t('redux_persistent_settings_card.sdr_settings', { defaultValue: 'SDR settings' })}</li>
                                <li>{t('redux_persistent_settings_card.file_browser_settings', { defaultValue: 'File browser settings' })}</li>
                                <li>{t('redux_persistent_settings_card.celestial_settings_map_monitored_table_display_options', { defaultValue: 'Celestial settings (map, monitored table, display options)' })}</li>
                            </ul>
                        </Typography>
                    </Box>
                    <Alert severity="warning" sx={{ mt: 2 }}>
                        <AlertTitle>{t('redux_persistent_settings_card.page_refresh_required', { defaultValue: 'Page Refresh Required' })}</AlertTitle>
                        {t('redux_persistent_settings_card.you_will_need_to_refresh_the_page_after_clearing_the_app', { defaultValue: 'You will need to refresh the page after clearing. The application will re-fetch all configuration data from the backend.' })}
                    </Alert>
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
                        onClick={() => setConfirmClearReduxOpen(false)}
                        variant="outlined"
                        color="inherit"
                        sx={{
                            minWidth: 100,
                            textTransform: 'none',
                            fontWeight: 500,
                        }}
                    >
                        {t('redux_persistent_settings_card.cancel', { defaultValue: 'Cancel' })}
                    </Button>
                    <Button
                        onClick={clearReduxPersistentState}
                        color="error"
                        variant="contained"
                        sx={{
                            minWidth: 100,
                            textTransform: 'none',
                            fontWeight: 600,
                        }}
                    >
                        {t('redux_persistent_settings_card.clear_all_settings', { defaultValue: 'Clear All Settings' })}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Individual Clear Action Confirmation Dialog */}
            <Dialog
                open={Boolean(confirmIndividualAction)}
                onClose={() => setConfirmIndividualAction(null)}
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
                    {confirmIndividualAction?.title || 'Confirm Clear Action'}
                </DialogTitle>
                <DialogContent sx={{ px: 3, pt: 3, pb: 3 }}>
                    <Alert severity="info" sx={{ mt: 2, mb: 2 }}>
                        <AlertTitle>{t('redux_persistent_settings_card.local_browser_cache_only', { defaultValue: 'Local Browser Cache Only' })}</AlertTitle>
                        {t('redux_persistent_settings_card.this_only_clears_settings_stored_in_your_browser_s_local', { defaultValue: 'This only clears settings stored in your browser\'s local storage.' })}
                    </Alert>
                    <Typography variant="body1" sx={{ mb: 2, color: 'text.primary' }}>
                        {confirmIndividualAction?.description}
                    </Typography>
                    <Alert severity="warning" sx={{ mt: 2 }}>
                        <AlertTitle>{t('redux_persistent_settings_card.reload_may_be_required', { defaultValue: 'Reload May Be Required' })}</AlertTitle>
                        {t('redux_persistent_settings_card.refresh_the_page_if_you_do_not_immediately_see_the_updat', { defaultValue: 'Refresh the page if you do not immediately see the updated defaults.' })}
                    </Alert>
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
                        onClick={() => setConfirmIndividualAction(null)}
                        variant="outlined"
                        color="inherit"
                        sx={{
                            minWidth: 100,
                            textTransform: 'none',
                            fontWeight: 500,
                        }}
                    >
                        {t('redux_persistent_settings_card.cancel', { defaultValue: 'Cancel' })}
                    </Button>
                    <Button
                        onClick={handleConfirmIndividualAction}
                        color="error"
                        variant="contained"
                        sx={{
                            minWidth: 100,
                            textTransform: 'none',
                            fontWeight: 600,
                        }}
                    >
                        {confirmIndividualAction?.confirmLabel || 'Clear'}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Reload Spinner Overlay */}
            <Backdrop
                sx={{color: '#fff', zIndex: (theme) => theme.zIndex.modal + 1}}
                open={isReloading}
            >
                <Box sx={{textAlign: 'center'}}>
                    <CircularProgress color="inherit" size={60}/>
                    <Typography variant="h6" sx={{mt: 2}}>
                        {t('redux_persistent_settings_card.reloading', { defaultValue: 'Reloading...' })}
                    </Typography>
                </Box>
            </Backdrop>
        </>
    );
};

export default ReduxPersistentSettingsCard;
