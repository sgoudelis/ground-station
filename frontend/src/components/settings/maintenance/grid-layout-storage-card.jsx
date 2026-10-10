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

import React, {useMemo, useState} from 'react';
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
    CircularProgress,
    Stack,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import {useTranslation} from 'react-i18next';
import {gridLayoutStoreName as earthViewGridLayoutName} from "../../earthview/main-layout.jsx";
import {gridLayoutStoreName as targetGridLayoutName} from "../../target/main-layout.jsx";
import {gridLayoutStoreName as waterfallGridLayoutName} from "../../waterfall/main-layout.jsx";
import {gridLayoutStoreName as celestialGridLayoutName} from "../../celestial/main-layout.jsx";
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import {toast} from '../../../utils/toast-with-timestamp.jsx';

// Factory (instead of a module-level constant) so labels/descriptions can use
// the component's `t`; the module scope has no translator in scope.
const createPageLayouts = (t) => [
    {
        key: earthViewGridLayoutName,
        label: t('grid_layout_storage_card.earth_view', { defaultValue: 'Earth view' }),
        description: t('grid_layout_storage_card.resets_the_widget_layout_on_the_earth_view_page', { defaultValue: 'Resets the widget layout on the Earth view page' }),
    },
    {
        key: targetGridLayoutName,
        label: 'Target',
        description: t('grid_layout_storage_card.resets_the_widget_layout_on_the_target_page', { defaultValue: 'Resets the widget layout on the Target page' }),
    },
    {
        key: waterfallGridLayoutName,
        label: 'Waterfall',
        description: t('grid_layout_storage_card.resets_the_widget_layout_on_the_waterfall_page', { defaultValue: 'Resets the widget layout on the Waterfall page' }),
    },
    {
        key: celestialGridLayoutName,
        label: 'Celestial',
        description: t('grid_layout_storage_card.resets_the_widget_layout_on_the_celestial_page', { defaultValue: 'Resets the widget layout on the Celestial page' }),
    },
];

const GridLayoutStorageCard = () => {
    const {t} = useTranslation('settings');
    const pageLayouts = useMemo(() => createPageLayouts(t), [t]);
    const [confirmClearLayoutOpen, setConfirmClearLayoutOpen] = useState(false);
    const [confirmSingleClearLayoutOpen, setConfirmSingleClearLayoutOpen] = useState(false);
    const [pendingSingleClearLayout, setPendingSingleClearLayout] = useState(null);
    const [isReloading, setIsReloading] = useState(false);

    const clearSingleLayout = (layoutLabel, storageKey) => {
        localStorage.removeItem(storageKey);
        toast.success(`${layoutLabel} layout has been cleared. Refresh the page to apply defaults.`);
    };

    const copyTextToClipboard = async (text) => {
        // Keep a fallback for environments where navigator.clipboard is blocked or unavailable.
        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }

        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.setAttribute('readonly', '');
        textArea.style.position = 'absolute';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
    };

    const exportLayoutToClipboard = async (layoutLabel, storageKey) => {
        try {
            const rawValue = localStorage.getItem(storageKey);
            if (!rawValue) {
                await copyTextToClipboard('null');
                toast.warning(`${layoutLabel} layout has no saved local value. Copied "null" to clipboard.`);
                return;
            }

            try {
                const parsedValue = JSON.parse(rawValue);
                await copyTextToClipboard(JSON.stringify(parsedValue, null, 2));
                toast.success(`${layoutLabel} layout JSON copied to clipboard.`);
            } catch {
                await copyTextToClipboard(rawValue);
                toast.warning(`${layoutLabel} layout value is not valid JSON. Raw value copied to clipboard.`);
            }
        } catch (error) {
            toast.error(`Failed to copy ${layoutLabel} layout JSON: ${error?.message || 'Unknown error'}`);
        }
    };

    const clearLayoutLocalStorage = () => {
        setConfirmClearLayoutOpen(false);
        pageLayouts.forEach(({key}) => localStorage.removeItem(key));

        // Show reload spinner and reload after 1 second
        setIsReloading(true);
        setTimeout(() => {
            window.location.reload();
        }, 1000);
    };

    const openSingleClearDialog = (layout) => {
        setPendingSingleClearLayout(layout);
        setConfirmSingleClearLayoutOpen(true);
    };

    const closeSingleClearDialog = () => {
        setConfirmSingleClearLayoutOpen(false);
        setPendingSingleClearLayout(null);
    };

    const confirmSingleClearLayout = () => {
        if (!pendingSingleClearLayout) {
            closeSingleClearDialog();
            return;
        }

        clearSingleLayout(pendingSingleClearLayout.label, pendingSingleClearLayout.key);
        closeSingleClearDialog();
    };

    return (
        <>
            <Typography variant="h6" gutterBottom>
                {t('grid_layout_storage_card.grid_layout_storage', { defaultValue: 'Grid Layout Storage' })}
            </Typography>
            <Divider sx={{mb: 2}}/>

            <Grid container spacing={2} columns={16}>
                <Grid size={16}>
                    <Alert severity="warning" sx={{mb: 2}}>
                        <AlertTitle>{t('grid_layout_storage_card.clear_all_grid_layouts', { defaultValue: 'Clear All Grid Layouts' })}</AlertTitle>
                        {t('grid_layout_storage_card.this_will_reset_all_grid_layouts_below_to_their_defaults', { defaultValue: 'This will reset all grid layouts below to their defaults. Use individual buttons to clear\n                        specific layouts only.' })}
                    </Alert>
                </Grid>

                <Grid size={10}>
                    {t('maintenance.clear_layout')}
                    <Typography variant="body2" color="text.secondary">
                        {t('grid_layout_storage_card.clears_all_grid_layouts_all_layouts_below', { defaultValue: 'Clears all grid layouts (all layouts below)' })}
                    </Typography>
                </Grid>
                <Grid size={6}>
                    <Button
                        variant="contained"
                        color="error"
                        onClick={() => setConfirmClearLayoutOpen(true)}
                        fullWidth
                        size="small"
                    >
                        {t('maintenance.clear_layout_button')}
                    </Button>
                </Grid>

                <Grid size={16}>
                    <Divider sx={{my: 2}}/>
                    <Typography variant="body2" color="text.secondary" gutterBottom>
                        {t('grid_layout_storage_card.or_clear_and_export_individual_layouts', { defaultValue: 'Or clear and export individual layouts:' })}
                    </Typography>
                </Grid>

                {pageLayouts.map((layout) => (
                    <React.Fragment key={layout.key}>
                        <Grid size={10}>
                            {`Clear ${layout.label} Grid Layout`}
                            <Typography variant="body2" color="text.secondary">
                                {layout.description}
                            </Typography>
                        </Grid>
                        <Grid size={6}>
                            <Stack direction={{xs: 'column', xl: 'row'}} spacing={1}>
                                <Button
                                    variant="outlined"
                                    color="warning"
                                    onClick={() => openSingleClearDialog(layout)}
                                    fullWidth
                                    size="small"
                                >
                                    {t('grid_layout_storage_card.clear', { defaultValue: 'Clear' })}
                                </Button>
                                <Button
                                    variant="outlined"
                                    color="info"
                                    startIcon={<ContentCopyIcon fontSize="small"/>}
                                    onClick={() => exportLayoutToClipboard(layout.label, layout.key)}
                                    fullWidth
                                    size="small"
                                >
                                    {t('grid_layout_storage_card.export_json', { defaultValue: 'Export JSON' })}
                                </Button>
                            </Stack>
                        </Grid>
                    </React.Fragment>
                ))}
            </Grid>

            {/* Clear Layout Confirmation Dialog */}
            <Dialog
                open={confirmClearLayoutOpen}
                onClose={() => setConfirmClearLayoutOpen(false)}
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
                    {t('grid_layout_storage_card.clear_all_grid_layouts', { defaultValue: 'Clear All Grid Layouts?' })}
                </DialogTitle>
                <DialogContent sx={{ px: 3, pt: '32px !important', pb: 3 }}>
                    <Alert severity="info" sx={{ mb: 2 }}>
                        <AlertTitle>{t('grid_layout_storage_card.local_browser_cache_only', { defaultValue: 'Local Browser Cache Only' })}</AlertTitle>
                        {t('grid_layout_storage_card.this_will_only_clear_layout_preferences_stored_in_your_b', { defaultValue: 'This will only clear layout preferences stored in your browser\'s local storage. No backend data\n                        will be affected.' })}
                    </Alert>
                    <Typography variant="body1" sx={{ mb: 2, color: 'text.primary' }}>
                        {t('grid_layout_storage_card.this_will_reset_all_widget_layouts_to_their_defaults_on_', { defaultValue: 'This will reset all widget layouts to their defaults on the following pages:' })}
                    </Typography>
                    <Box sx={{
                        p: 2,
                        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
                        borderRadius: 1,
                        border: (theme) => `1px solid ${theme.palette.divider}`,
                    }}>
                        <Typography component="div" variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                            <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
                                <li>{t('grid_layout_storage_card.earth_view_page', { defaultValue: 'Earth view page' })}</li>
                                <li>{t('grid_layout_storage_card.target_page', { defaultValue: 'Target page' })}</li>
                                <li>{t('grid_layout_storage_card.waterfall_page', { defaultValue: 'Waterfall page' })}</li>
                                <li>{t('grid_layout_storage_card.celestial_page', { defaultValue: 'Celestial page' })}</li>
                            </ul>
                        </Typography>
                    </Box>
                    <Alert severity="warning" sx={{ mt: 2 }}>
                        <AlertTitle>{t('grid_layout_storage_card.page_refresh_required', { defaultValue: 'Page Refresh Required' })}</AlertTitle>
                        {t('grid_layout_storage_card.you_will_need_to_refresh_the_page_to_see_the_changes', { defaultValue: 'You will need to refresh the page to see the changes.' })}
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
                        onClick={() => setConfirmClearLayoutOpen(false)}
                        variant="outlined"
                        color="inherit"
                        sx={{
                            minWidth: 100,
                            textTransform: 'none',
                            fontWeight: 500,
                        }}
                    >
                        {t('grid_layout_storage_card.cancel', { defaultValue: 'Cancel' })}
                    </Button>
                    <Button
                        onClick={clearLayoutLocalStorage}
                        color="error"
                        variant="contained"
                        sx={{
                            minWidth: 100,
                            textTransform: 'none',
                            fontWeight: 600,
                        }}
                    >
                        {t('grid_layout_storage_card.clear_layouts', { defaultValue: 'Clear Layouts' })}
                    </Button>
                </DialogActions>
            </Dialog>

            {/* Single Layout Confirmation Dialog */}
            <Dialog
                open={confirmSingleClearLayoutOpen}
                onClose={closeSingleClearDialog}
                maxWidth="xs"
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
                        bgcolor: 'warning.main',
                        color: 'warning.contrastText',
                        fontSize: '1rem',
                        fontWeight: 600,
                        py: 2,
                    }}
                >
                    {`Clear ${pendingSingleClearLayout?.label || ''} Layout?`}
                </DialogTitle>
                <DialogContent sx={{ px: 3, pt: '32px !important', pb: 2 }}>
                    <Alert severity="warning" sx={{ mb: 2 }}>
                        <AlertTitle>{t('grid_layout_storage_card.local_browser_cache_only', { defaultValue: 'Local Browser Cache Only' })}</AlertTitle>
                        {t('grid_layout_storage_card.this_only_clears_the_saved_layout_in_this_browser', { defaultValue: 'This only clears the saved layout in this browser.' })}
                    </Alert>
                    <Typography variant="body2" color="text.secondary">
                        {t('grid_layout_storage_card.refresh_the_page_after_clearing_to_load_the_default_layo', { defaultValue: 'Refresh the page after clearing to load the default layout.' })}
                    </Typography>
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
                        onClick={closeSingleClearDialog}
                        variant="outlined"
                        color="inherit"
                        sx={{
                            minWidth: 100,
                            textTransform: 'none',
                            fontWeight: 500,
                        }}
                    >
                        {t('grid_layout_storage_card.cancel', { defaultValue: 'Cancel' })}
                    </Button>
                    <Button
                        onClick={confirmSingleClearLayout}
                        color="warning"
                        variant="contained"
                        sx={{
                            minWidth: 100,
                            textTransform: 'none',
                            fontWeight: 600,
                        }}
                    >
                        {t('grid_layout_storage_card.clear', { defaultValue: 'Clear' })}
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
                        {t('grid_layout_storage_card.reloading', { defaultValue: 'Reloading...' })}
                    </Typography>
                </Box>
            </Backdrop>
        </>
    );
};

export default GridLayoutStorageCard;
