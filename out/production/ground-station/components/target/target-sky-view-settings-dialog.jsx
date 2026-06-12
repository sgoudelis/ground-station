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
import {
    Box,
    Button,
    Chip,
    Dialog,
    DialogContent,
    DialogTitle,
    FormControl,
    FormControlLabel,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    Stack,
    Switch,
    Typography,
} from '@mui/material';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
    setOpenMapSettingsDialog,
    setTargetViewEnableDragging,
    setTargetViewEnableZooming,
    setTargetViewMode,
    TARGET_VIEW_MODE_OPTIONS,
    TARGET_VIEW_MODE_PLANETARIUM,
    TARGET_VIEW_MODE_SOLAR_SYSTEM,
} from './target-slice.jsx';

const DIALOG_PAPER_SX = {
    bgcolor: 'background.paper',
    border: (theme) => `1px solid ${theme.palette.divider}`,
    borderRadius: 2,
};

const DIALOG_TITLE_SX = {
    bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100'),
    borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
    fontSize: '1.125rem',
    fontWeight: 'bold',
    py: 2.2,
};

const normalizeTargetViewMode = (value) => (
    value === TARGET_VIEW_MODE_PLANETARIUM ? TARGET_VIEW_MODE_PLANETARIUM : TARGET_VIEW_MODE_SOLAR_SYSTEM
);

const SectionBlock = ({ title, subtitle, children }) => (
    <Paper
        variant="outlined"
        sx={{
            borderColor: 'divider',
            borderRadius: 1.5,
            p: 1.5,
            bgcolor: 'background.paper',
        }}
    >
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
            {title}
        </Typography>
        {subtitle ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.4, mb: 1.25 }}>
                {subtitle}
            </Typography>
        ) : null}
        <Stack spacing={1.1}>{children}</Stack>
    </Paper>
);

const ToggleRow = ({ label, checked, onChange }) => (
    <FormControlLabel
        control={<Switch size="small" checked={checked} onChange={(event) => onChange(event.target.checked)} />}
        label={label}
        sx={{ ml: 0.2 }}
    />
);

const ToggleRowWithDescription = ({ label, description, checked, onChange }) => (
    <Box>
        <ToggleRow label={label} checked={checked} onChange={onChange} />
        {description ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4.6, mt: -0.25 }}>
                {description}
            </Typography>
        ) : null}
    </Box>
);

function TargetSkyViewSettingsDialog({ updateBackend }) {
    const dispatch = useDispatch();
    const { t } = useTranslation('target');
    const {
        openMapSettingsDialog,
        targetViewMode,
        targetViewEnableDragging,
        targetViewEnableZooming,
    } = useSelector((state) => state.targetSatTrack);
    const normalizedInitialViewMode = useMemo(
        () => normalizeTargetViewMode(targetViewMode),
        [targetViewMode],
    );
    const initialInteraction = useMemo(
        () => ({
            enableDragging: targetViewEnableDragging ?? true,
            enableZooming: targetViewEnableZooming ?? true,
        }),
        [targetViewEnableDragging, targetViewEnableZooming],
    );
    const [draftViewMode, setDraftViewMode] = useState(normalizedInitialViewMode);
    const [draftInteraction, setDraftInteraction] = useState(initialInteraction);
    const [saveState, setSaveState] = useState('idle');

    useEffect(() => {
        if (openMapSettingsDialog) {
            setDraftViewMode(normalizedInitialViewMode);
            setDraftInteraction(initialInteraction);
            setSaveState('idle');
        }
    }, [initialInteraction, openMapSettingsDialog, normalizedInitialViewMode]);

    useEffect(() => {
        setSaveState((current) => ((current === 'saved' || current === 'error') ? 'idle' : current));
    }, [draftInteraction, draftViewMode]);

    const isDirty = (
        draftViewMode !== normalizedInitialViewMode
        || draftInteraction.enableDragging !== initialInteraction.enableDragging
        || draftInteraction.enableZooming !== initialInteraction.enableZooming
    );

    const handleClose = () => {
        setDraftViewMode(normalizedInitialViewMode);
        setDraftInteraction(initialInteraction);
        setSaveState('idle');
        dispatch(setOpenMapSettingsDialog(false));
    };

    const handleApply = async () => {
        setSaveState('saving');
        try {
            dispatch(setTargetViewMode(draftViewMode));
            dispatch(setTargetViewEnableDragging(draftInteraction.enableDragging));
            dispatch(setTargetViewEnableZooming(draftInteraction.enableZooming));
            await Promise.resolve(updateBackend?.({
                targetViewMode: draftViewMode,
                targetViewEnableDragging: draftInteraction.enableDragging,
                targetViewEnableZooming: draftInteraction.enableZooming,
            }));
            setSaveState('saved');
        } catch {
            setSaveState('error');
        }
    };

    const handleReset = () => {
        setDraftViewMode(TARGET_VIEW_MODE_SOLAR_SYSTEM);
        setDraftInteraction({
            enableDragging: true,
            enableZooming: true,
        });
        setSaveState('idle');
    };

    const saveFeedbackLabel = {
        saving: t('map_settings.saving', { defaultValue: 'Saving…' }),
        saved: t('map_settings.saved', { defaultValue: 'Saved' }),
        error: t('map_settings.save_failed', { defaultValue: 'Save failed' }),
    }[saveState];

    return (
        <Dialog
            open={openMapSettingsDialog}
            onClose={handleClose}
            fullWidth
            maxWidth="sm"
            PaperProps={{ sx: DIALOG_PAPER_SX }}
        >
            <DialogTitle sx={DIALOG_TITLE_SX}>
                {t('map_settings.target_view_options_title', { defaultValue: 'Target View Options' })}
            </DialogTitle>
            <DialogContent sx={{ p: 0 }}>
                <Stack spacing={1.5} sx={{ px: 2, pt: 2, pb: 1.5 }}>
                    <SectionBlock
                        title="View Mode"
                        subtitle="Choose the celestial visualization used for mission and body targets."
                    >
                        <FormControl fullWidth size="small">
                            <InputLabel id="target-celestial-view-mode-label">View</InputLabel>
                            <Select
                                labelId="target-celestial-view-mode-label"
                                value={draftViewMode}
                                label="View"
                                onChange={(event) => setDraftViewMode(normalizeTargetViewMode(event.target.value))}
                            >
                                {TARGET_VIEW_MODE_OPTIONS.map((option) => (
                                    <MenuItem key={option.id} value={option.id}>
                                        {option.name}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </SectionBlock>
                    <SectionBlock
                        title="View Interaction"
                        subtitle="Control direct pointer interaction inside the celestial viewport."
                    >
                        <ToggleRowWithDescription
                            label={t('map_settings.enable_map_dragging', { defaultValue: 'Enable map dragging' })}
                            description={t('map_settings.enable_map_dragging_desc', {
                                defaultValue: 'Allow click-and-drag panning directly in the view.',
                            })}
                            checked={draftInteraction.enableDragging}
                            onChange={(value) => {
                                setDraftInteraction((current) => ({
                                    ...current,
                                    enableDragging: value,
                                }));
                            }}
                        />
                        <ToggleRowWithDescription
                            label={t('map_settings.enable_map_zooming', { defaultValue: 'Enable map zooming' })}
                            description={t('map_settings.enable_map_zooming_desc', {
                                defaultValue: 'Allow wheel and pinch zoom gestures in the view.',
                            })}
                            checked={draftInteraction.enableZooming}
                            onChange={(value) => {
                                setDraftInteraction((current) => ({
                                    ...current,
                                    enableZooming: value,
                                }));
                            }}
                        />
                    </SectionBlock>
                </Stack>

                <Box
                    sx={{
                        px: 2,
                        py: 1.5,
                        bgcolor: 'background.paper',
                        borderTop: '1px solid',
                        borderColor: 'divider',
                    }}
                >
                    <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={1}
                        alignItems={{ xs: 'stretch', sm: 'center' }}
                        justifyContent="space-between"
                    >
                        <Button variant="text" onClick={handleReset}>
                            {t('map_settings.reset_defaults', { defaultValue: 'Reset Defaults' })}
                        </Button>
                        <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center">
                            {saveFeedbackLabel ? (
                                <Chip
                                    size="small"
                                    color={saveState === 'error' ? 'error' : saveState === 'saved' ? 'success' : 'default'}
                                    label={saveFeedbackLabel}
                                />
                            ) : null}
                            <Button variant="outlined" onClick={handleClose}>
                                {t('close', { defaultValue: 'Close' })}
                            </Button>
                            <Button
                                variant="contained"
                                onClick={handleApply}
                                disabled={!isDirty || saveState === 'saving'}
                            >
                                {t('map_settings.apply', { defaultValue: 'Apply' })}
                            </Button>
                        </Stack>
                    </Stack>
                </Box>
            </DialogContent>
        </Dialog>
    );
}

export default TargetSkyViewSettingsDialog;
