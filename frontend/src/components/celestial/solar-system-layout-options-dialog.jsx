import React, { useEffect, useMemo, useState } from 'react';
import {
    Box,
    Button,
    Dialog,
    DialogContent,
    DialogTitle,
    FormControlLabel,
    FormControl,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    Stack,
    Switch,
    Typography,
} from '@mui/material';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
    DEFAULT_PLANETARIUM_DISPLAY_OPTIONS,
    DEFAULT_SOLAR_SYSTEM_DISPLAY_OPTIONS,
    setPlanetariumDisplayOption,
    setSolarSystemDisplayOption,
} from './celestial-display-slice.jsx';

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

const DIALOG_CONTENT_SX = {
    p: 0,
    height: '72vh',
    maxHeight: '72vh',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
};
const FOOTER_ACTION_ROW_SX = {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 1,
    overflowX: 'auto',
    msOverflowStyle: 'none',
    scrollbarWidth: 'none',
    '&::-webkit-scrollbar': { display: 'none' },
    '& > *': {
        flexShrink: 0,
        whiteSpace: 'nowrap',
    },
};

const SOLAR_SETTING_KEYS = Object.keys(DEFAULT_SOLAR_SYSTEM_DISPLAY_OPTIONS);
const PLANETARIUM_SETTING_KEYS = Object.keys(DEFAULT_PLANETARIUM_DISPLAY_OPTIONS);
const VIEW_MODE_SOLAR_SYSTEM = 'solar-system';
const VIEW_MODE_PLANETARIUM = 'planetarium';
const normalizeViewMode = (value) => (
    value === VIEW_MODE_PLANETARIUM ? VIEW_MODE_PLANETARIUM : VIEW_MODE_SOLAR_SYSTEM
);

const SOLAR_SYSTEM_SECTION_DEFS = [
    {
        titleKey: 'layout_options.sections.solar_scene_elements.title',
        subtitleKey: 'layout_options.sections.solar_scene_elements.subtitle',
        options: [
            {
                key: 'showGrid',
                labelKey: 'layout_options.options.show_grid.label',
                descriptionKey: 'layout_options.options.show_grid.description',
            },
            {
                key: 'showPlanets',
                labelKey: 'layout_options.options.show_planets.label',
                descriptionKey: 'layout_options.options.show_planets.description',
            },
            {
                key: 'showPlanetLabels',
                labelKey: 'layout_options.options.show_planet_labels.label',
                descriptionKey: 'layout_options.options.show_planet_labels.description',
            },
            {
                key: 'showPlanetOrbits',
                labelKey: 'layout_options.options.show_planet_orbits.label',
                descriptionKey: 'layout_options.options.show_planet_orbits.description',
            },
        ],
    },
    {
        titleKey: 'layout_options.sections.solar_tracked_targets.title',
        subtitleKey: 'layout_options.sections.solar_tracked_targets.subtitle',
        options: [
            {
                key: 'showTrackedObjects',
                labelKey: 'layout_options.options.show_tracked_objects.label',
                descriptionKey: 'layout_options.options.show_tracked_objects.description',
            },
            {
                key: 'showTrackedOrbits',
                labelKey: 'layout_options.options.show_tracked_orbits.label',
                descriptionKey: 'layout_options.options.show_tracked_orbits.description',
            },
            {
                key: 'showTrackedLabels',
                labelKey: 'layout_options.options.show_tracked_labels.label',
                descriptionKey: 'layout_options.options.show_tracked_labels.description',
            },
        ],
    },
    {
        titleKey: 'layout_options.sections.solar_astronomy_background.title',
        subtitleKey: 'layout_options.sections.solar_astronomy_background.subtitle',
        options: [
            {
                key: 'showStarfieldBackground',
                labelKey: 'layout_options.options.show_bright_star_field.label',
                descriptionKey: 'layout_options.options.show_bright_star_field.description',
            },
        ],
    },
    {
        titleKey: 'layout_options.sections.solar_guides_and_metadata.title',
        subtitleKey: 'layout_options.sections.solar_guides_and_metadata.subtitle',
        options: [
            {
                key: 'showAsteroidZones',
                labelKey: 'layout_options.options.show_asteroid_zones.label',
                descriptionKey: 'layout_options.options.show_asteroid_zones.description',
            },
            {
                key: 'showZoneLabels',
                labelKey: 'layout_options.options.show_asteroid_zone_labels.label',
                descriptionKey: 'layout_options.options.show_asteroid_zone_labels.description',
            },
            {
                key: 'showResonanceMarkers',
                labelKey: 'layout_options.options.show_resonance_markers.label',
                descriptionKey: 'layout_options.options.show_resonance_markers.description',
            },
            {
                key: 'showTimestamp',
                labelKey: 'layout_options.options.show_epoch_label.label',
                descriptionKey: 'layout_options.options.show_epoch_label.description',
            },
            {
                key: 'showScaleIndicator',
                labelKey: 'layout_options.options.show_scale_label.label',
                descriptionKey: 'layout_options.options.show_scale_label.description',
            },
            {
                key: 'showGestureHint',
                labelKey: 'layout_options.options.show_gesture_hint.label',
                descriptionKey: 'layout_options.options.show_gesture_hint.description',
            },
        ],
    },
];

const PLANETARIUM_SECTION_DEFS = [
    {
        titleKey: 'layout_options.sections.planetarium_sky_layers.title',
        subtitleKey: 'layout_options.sections.planetarium_sky_layers.subtitle',
        options: [
            {
                key: 'showGrid',
                labelKey: 'layout_options.options.show_sky_grid.label',
                descriptionKey: 'layout_options.options.show_sky_grid.description',
            },
            {
                key: 'showHorizonCompass',
                labelKey: 'layout_options.options.show_horizon_compass.label',
                descriptionKey: 'layout_options.options.show_horizon_compass.description',
            },
            {
                key: 'showStarField',
                labelKey: 'layout_options.options.show_star_field.label',
                descriptionKey: 'layout_options.options.show_star_field.description',
            },
            {
                key: 'showStarNames',
                labelKey: 'layout_options.options.show_star_names.label',
                descriptionKey: 'layout_options.options.show_star_names.description',
            },
            {
                key: 'showConstellationLabels',
                labelKey: 'layout_options.options.show_constellation_labels.label',
                descriptionKey: 'layout_options.options.show_constellation_labels.description',
            },
        ],
    },
    {
        titleKey: 'layout_options.sections.planetarium_target_overlays.title',
        subtitleKey: 'layout_options.sections.planetarium_target_overlays.subtitle',
        options: [
            {
                key: 'showPassCurves',
                labelKey: 'layout_options.options.show_pass_curves.label',
                descriptionKey: 'layout_options.options.show_pass_curves.description',
            },
            {
                key: 'showPlanetLabels',
                labelKey: 'layout_options.options.show_planet_labels.label',
                descriptionKey: 'layout_options.options.show_planet_labels_for_planetarium.description',
            },
            {
                key: 'showTargetLabels',
                labelKey: 'layout_options.options.show_target_labels.label',
                descriptionKey: 'layout_options.options.show_target_labels.description',
            },
            {
                key: 'showRotatorCrosshair',
                labelKey: 'layout_options.options.show_rotator_crosshair.label',
                descriptionKey: 'layout_options.options.show_rotator_crosshair.description',
            },
            {
                key: 'showHud',
                labelKey: 'layout_options.options.show_hud_labels.label',
                descriptionKey: 'layout_options.options.show_hud_labels.description',
            },
        ],
    },
];

const buildSettings = (initialOptions, defaults, settingKeys) => {
    const settings = {};
    settingKeys.forEach((key) => {
        settings[key] = Boolean(initialOptions?.[key] ?? defaults[key]);
    });
    return settings;
};

const settingsEqual = (left, right, settingKeys) => settingKeys.every((key) => left[key] === right[key]);

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

const normalizeInteractionSettings = (settings) => ({
    enableMapDragging: Boolean(settings?.enableMapDragging),
    enableMapZooming: Boolean(settings?.enableMapZooming),
});

function SolarSystemLayoutOptionsDialog({
    open,
    initialSolarSystemOptions,
    initialPlanetariumOptions,
    initialInteractionSettings,
    initialViewMode,
    onApplyInteractionSettings,
    onApplyViewMode,
    onClose,
}) {
    const dispatch = useDispatch();
    const { t } = useTranslation('celestial');
    const { t: tCommon } = useTranslation('common');

    const initialSolarSettings = useMemo(
        () => buildSettings(initialSolarSystemOptions, DEFAULT_SOLAR_SYSTEM_DISPLAY_OPTIONS, SOLAR_SETTING_KEYS),
        [initialSolarSystemOptions],
    );
    const initialPlanetariumSettings = useMemo(
        () => buildSettings(initialPlanetariumOptions, DEFAULT_PLANETARIUM_DISPLAY_OPTIONS, PLANETARIUM_SETTING_KEYS),
        [initialPlanetariumOptions],
    );
    const initialInteraction = useMemo(
        () => normalizeInteractionSettings(initialInteractionSettings),
        [initialInteractionSettings]
    );
    const normalizedInitialViewMode = useMemo(
        () => normalizeViewMode(initialViewMode),
        [initialViewMode],
    );
    const [draftSolarSettings, setDraftSolarSettings] = useState(initialSolarSettings);
    const [draftPlanetariumSettings, setDraftPlanetariumSettings] = useState(initialPlanetariumSettings);
    const [draftInteraction, setDraftInteraction] = useState(initialInteraction);
    const [draftViewMode, setDraftViewMode] = useState(normalizedInitialViewMode);

    useEffect(() => {
        if (open) {
            setDraftSolarSettings(initialSolarSettings);
            setDraftPlanetariumSettings(initialPlanetariumSettings);
            setDraftInteraction(initialInteraction);
            setDraftViewMode(normalizedInitialViewMode);
        }
    }, [open, initialInteraction, initialPlanetariumSettings, initialSolarSettings, normalizedInitialViewMode]);

    const isSolarDisplayDirty = !settingsEqual(draftSolarSettings, initialSolarSettings, SOLAR_SETTING_KEYS);
    const isPlanetariumDisplayDirty = !settingsEqual(
        draftPlanetariumSettings,
        initialPlanetariumSettings,
        PLANETARIUM_SETTING_KEYS,
    );
    const isDisplayDirty = isSolarDisplayDirty || isPlanetariumDisplayDirty;
    const isInteractionDirty = (
        draftInteraction.enableMapDragging !== initialInteraction.enableMapDragging
        || draftInteraction.enableMapZooming !== initialInteraction.enableMapZooming
    );
    const isViewModeDirty = draftViewMode !== normalizedInitialViewMode;
    const isDirty = isDisplayDirty || isInteractionDirty || isViewModeDirty;
    const isSolarSystemViewMode = draftViewMode === VIEW_MODE_SOLAR_SYSTEM;
    const activeSectionDefs = isSolarSystemViewMode ? SOLAR_SYSTEM_SECTION_DEFS : PLANETARIUM_SECTION_DEFS;
    const activeDraftSettings = isSolarSystemViewMode ? draftSolarSettings : draftPlanetariumSettings;
    const setActiveDraftSettings = isSolarSystemViewMode ? setDraftSolarSettings : setDraftPlanetariumSettings;

    const handleCancel = () => {
        setDraftSolarSettings(initialSolarSettings);
        setDraftPlanetariumSettings(initialPlanetariumSettings);
        setDraftInteraction(initialInteraction);
        setDraftViewMode(normalizedInitialViewMode);
        onClose?.();
    };

    const handleApply = () => {
        // Commit only changed keys to keep Redux updates focused and predictable.
        SOLAR_SETTING_KEYS.forEach((key) => {
            if (draftSolarSettings[key] === initialSolarSettings[key]) return;
            dispatch(
                setSolarSystemDisplayOption({
                    key,
                    value: draftSolarSettings[key],
                }),
            );
        });
        PLANETARIUM_SETTING_KEYS.forEach((key) => {
            if (draftPlanetariumSettings[key] === initialPlanetariumSettings[key]) return;
            dispatch(
                setPlanetariumDisplayOption({
                    key,
                    value: draftPlanetariumSettings[key],
                }),
            );
        });
        if (isInteractionDirty) {
            onApplyInteractionSettings?.(draftInteraction);
        }
        if (isViewModeDirty) {
            onApplyViewMode?.(draftViewMode);
        }
        onClose?.();
    };

    return (
        <Dialog
            open={open}
            onClose={handleCancel}
            fullWidth
            maxWidth="sm"
            PaperProps={{ sx: DIALOG_PAPER_SX }}
        >
            <DialogTitle sx={DIALOG_TITLE_SX}>
                {t('layout_options.title')}
            </DialogTitle>
            <DialogContent sx={DIALOG_CONTENT_SX}>
                <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                    <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, pt: 2, pb: 1.5 }}>
                        <Stack spacing={1.5}>
                            <SectionBlock
                                title={t('layout_options.view_mode.title')}
                                subtitle={t('layout_options.view_mode.subtitle')}
                            >
                                <FormControl fullWidth size="small">
                                    <InputLabel id="celestial-view-mode-label">{t('layout_options.view_mode.label')}</InputLabel>
                                    <Select
                                        labelId="celestial-view-mode-label"
                                        value={draftViewMode}
                                        label={t('layout_options.view_mode.label')}
                                        onChange={(event) => setDraftViewMode(normalizeViewMode(event.target.value))}
                                    >
                                        <MenuItem value={VIEW_MODE_SOLAR_SYSTEM}>{t('layout_options.view_mode.solar_system')}</MenuItem>
                                        <MenuItem value={VIEW_MODE_PLANETARIUM}>{t('layout_options.view_mode.planetarium')}</MenuItem>
                                    </Select>
                                </FormControl>
                            </SectionBlock>
                            <SectionBlock
                                title={t('layout_options.map_interaction.title')}
                                subtitle={
                                    isSolarSystemViewMode
                                        ? t('layout_options.map_interaction.solar_subtitle')
                                        : t('layout_options.map_interaction.planetarium_subtitle')
                                }
                            >
                                <ToggleRowWithDescription
                                    label={t('layout_options.options.enable_map_dragging.label')}
                                    description={t('layout_options.options.enable_map_dragging.description')}
                                    checked={draftInteraction.enableMapDragging}
                                    onChange={(value) => {
                                        setDraftInteraction((current) => ({
                                            ...current,
                                            enableMapDragging: value,
                                        }));
                                    }}
                                />
                                <ToggleRowWithDescription
                                    label={t('layout_options.options.enable_map_zooming.label')}
                                    description={t('layout_options.options.enable_map_zooming.description')}
                                    checked={draftInteraction.enableMapZooming}
                                    onChange={(value) => {
                                        setDraftInteraction((current) => ({
                                            ...current,
                                            enableMapZooming: value,
                                        }));
                                    }}
                                />
                            </SectionBlock>
                            {activeSectionDefs.map((section) => (
                                <SectionBlock
                                    key={section.titleKey}
                                    title={t(section.titleKey)}
                                    subtitle={t(section.subtitleKey)}
                                >
                                    {section.options.map((option) => (
                                        <ToggleRowWithDescription
                                            key={option.key}
                                            label={t(option.labelKey)}
                                            description={t(option.descriptionKey)}
                                            checked={Boolean(activeDraftSettings[option.key])}
                                            onChange={(value) => {
                                                setActiveDraftSettings((current) => ({
                                                    ...current,
                                                    [option.key]: value,
                                                }));
                                            }}
                                        />
                                    ))}
                                </SectionBlock>
                            ))}
                        </Stack>
                    </Box>

                    <Box
                        sx={{
                            flexShrink: 0,
                            px: 2,
                            py: 1.5,
                            bgcolor: 'background.paper',
                            borderTop: '1px solid',
                            borderColor: 'divider',
                        }}
                    >
                        <Box sx={FOOTER_ACTION_ROW_SX}>
                            <Button
                                variant="outlined"
                                onClick={() => {
                                    setDraftSolarSettings({ ...DEFAULT_SOLAR_SYSTEM_DISPLAY_OPTIONS });
                                    setDraftPlanetariumSettings({ ...DEFAULT_PLANETARIUM_DISPLAY_OPTIONS });
                                    setDraftInteraction({ enableMapDragging: false, enableMapZooming: false });
                                    setDraftViewMode(VIEW_MODE_SOLAR_SYSTEM);
                                }}
                            >
                                {t('layout_options.reset_defaults')}
                            </Button>

                            <Box sx={{ flex: 1, minWidth: 8 }} />
                            <Button variant="outlined" onClick={handleCancel}>
                                {tCommon('close')}
                            </Button>
                            <Button variant="contained" onClick={handleApply} disabled={!isDirty}>
                                {t('layout_options.apply')}
                            </Button>
                        </Box>
                    </Box>
                </Box>
            </DialogContent>
        </Dialog>
    );
}

export default SolarSystemLayoutOptionsDialog;
