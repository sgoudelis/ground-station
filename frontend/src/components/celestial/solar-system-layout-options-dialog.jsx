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

const SOLAR_SETTING_KEYS = Object.keys(DEFAULT_SOLAR_SYSTEM_DISPLAY_OPTIONS);
const PLANETARIUM_SETTING_KEYS = Object.keys(DEFAULT_PLANETARIUM_DISPLAY_OPTIONS);
const VIEW_MODE_SOLAR_SYSTEM = 'solar-system';
const VIEW_MODE_PLANETARIUM = 'planetarium';
const normalizeViewMode = (value) => (
    value === VIEW_MODE_PLANETARIUM ? VIEW_MODE_PLANETARIUM : VIEW_MODE_SOLAR_SYSTEM
);

const SOLAR_SYSTEM_SECTION_DEFS = [
    {
        title: 'Scene Elements',
        subtitle: 'Primary solar system layers and labels.',
        options: [
            {
                key: 'showGrid',
                label: 'Show grid',
                description: 'Display a reference grid for quick spatial orientation.',
            },
            {
                key: 'showPlanets',
                label: 'Show planets',
                description: 'Render planets and major solar-system bodies in the viewport.',
            },
            {
                key: 'showPlanetLabels',
                label: 'Show planet labels',
                description: 'Show body names next to visible planets.',
            },
            {
                key: 'showPlanetOrbits',
                label: 'Show planet orbits',
                description: 'Draw orbital rings/paths for planetary motion context.',
            },
        ],
    },
    {
        title: 'Tracked Targets',
        subtitle: 'Tracked objects and their orbit/label overlays.',
        options: [
            {
                key: 'showTrackedObjects',
                label: 'Show tracked objects',
                description: 'Display currently tracked mission/body markers.',
            },
            {
                key: 'showTrackedOrbits',
                label: 'Show tracked orbits',
                description: 'Overlay sampled trajectory paths for tracked targets.',
            },
            {
                key: 'showTrackedLabels',
                label: 'Show tracked labels',
                description: 'Show labels and telemetry context for tracked targets.',
            },
        ],
    },
    {
        title: 'Astronomy Background',
        subtitle: 'Reference layers behind the map.',
        options: [
            {
                key: 'showStarfieldBackground',
                label: 'Show bright-star field',
                description: 'Render a vector ecliptic projection from the Bright Star Catalogue.',
            },
        ],
    },
    {
        title: 'Guides and Metadata',
        subtitle: 'Contextual markers, labels, and scene metadata.',
        options: [
            {
                key: 'showAsteroidZones',
                label: 'Show asteroid zones',
                description: 'Display major asteroid-belt region overlays.',
            },
            {
                key: 'showZoneLabels',
                label: 'Show asteroid zone labels',
                description: 'Annotate asteroid regions with zone names.',
            },
            {
                key: 'showResonanceMarkers',
                label: 'Show resonance markers',
                description: 'Render key orbital resonance reference markers.',
            },
            {
                key: 'showTimestamp',
                label: 'Show epoch label',
                description: 'Show the scene timestamp used for current positions.',
            },
            {
                key: 'showScaleIndicator',
                label: 'Show scale label',
                description: 'Show the current viewport distance scale reference.',
            },
            {
                key: 'showGestureHint',
                label: 'Show gesture hint',
                description: 'Show a short help hint for map interaction controls.',
            },
        ],
    },
];

const PLANETARIUM_SECTION_DEFS = [
    {
        title: 'Sky Layers',
        subtitle: 'Primary overlays for the planetarium viewport.',
        options: [
            {
                key: 'showGrid',
                label: 'Show sky grid',
                description: 'Draw azimuth/elevation guide lines.',
            },
            {
                key: 'showHorizonCompass',
                label: 'Show horizon compass',
                description: 'Draw the horizon line with N/E/S/W ticks.',
            },
            {
                key: 'showStarField',
                label: 'Show star field',
                description: 'Render bright stars from the loaded sky catalog.',
            },
            {
                key: 'showStarNames',
                label: 'Show star names',
                description: 'Label bright named stars when zoom allows.',
            },
            {
                key: 'showConstellationLabels',
                label: 'Show constellation labels',
                description: 'Render constellation names in the sky background.',
            },
        ],
    },
    {
        title: 'Target Overlays',
        subtitle: 'Tracking overlays and labels for planets and targets.',
        options: [
            {
                key: 'showPassCurves',
                label: 'Show pass curves',
                description: 'Draw predicted pass arcs for visible targets.',
            },
            {
                key: 'showPlanetLabels',
                label: 'Show planet labels',
                description: 'Show labels for planetary bodies.',
            },
            {
                key: 'showTargetLabels',
                label: 'Show target labels',
                description: 'Show labels for tracked targets.',
            },
            {
                key: 'showRotatorCrosshair',
                label: 'Show rotator crosshair',
                description: 'Render the live rotator crosshair when available.',
            },
            {
                key: 'showHud',
                label: 'Show HUD labels',
                description: 'Show viewport and observer/timestamp readouts.',
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
    const { t } = useTranslation('common');

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
                {t('map_settings.solar_system_layout_options_title', { defaultValue: 'Solar System Layout Options' })}
            </DialogTitle>
            <DialogContent sx={DIALOG_CONTENT_SX}>
                <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
                    <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, pt: 2, pb: 1.5 }}>
                        <Stack spacing={1.5}>
                            <SectionBlock
                                title="View Mode"
                                subtitle="Choose the primary celestial visualization for this island."
                            >
                                <FormControl fullWidth size="small">
                                    <InputLabel id="celestial-view-mode-label">View</InputLabel>
                                    <Select
                                        labelId="celestial-view-mode-label"
                                        value={draftViewMode}
                                        label="View"
                                        onChange={(event) => setDraftViewMode(normalizeViewMode(event.target.value))}
                                    >
                                        <MenuItem value={VIEW_MODE_SOLAR_SYSTEM}>Solar System</MenuItem>
                                        <MenuItem value={VIEW_MODE_PLANETARIUM}>Planetarium</MenuItem>
                                    </Select>
                                </FormControl>
                            </SectionBlock>
                            <SectionBlock
                                title="Map Interaction"
                                subtitle={
                                    isSolarSystemViewMode
                                        ? 'Enable gesture-driven panning and zooming on the solar-system map.'
                                        : 'Enable gesture-driven panning and zooming in the planetarium viewport.'
                                }
                            >
                                <ToggleRowWithDescription
                                    label={t('map_settings.enable_map_dragging', { defaultValue: 'Enable map dragging' })}
                                    description={t('map_settings.enable_map_dragging_desc', {
                                        defaultValue: 'Allow click-and-drag panning on the map. When off, use controls.',
                                    })}
                                    checked={draftInteraction.enableMapDragging}
                                    onChange={(value) => {
                                        setDraftInteraction((current) => ({
                                            ...current,
                                            enableMapDragging: value,
                                        }));
                                    }}
                                />
                                <ToggleRowWithDescription
                                    label={t('map_settings.enable_map_zooming', { defaultValue: 'Enable map zooming' })}
                                    description={t('map_settings.enable_map_zooming_desc', {
                                        defaultValue: 'Allow wheel and pinch zoom gestures. When off, use zoom buttons.',
                                    })}
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
                                <SectionBlock key={section.title} title={section.title} subtitle={section.subtitle}>
                                    {section.options.map((option) => (
                                        <ToggleRowWithDescription
                                            key={option.key}
                                            label={option.label}
                                            description={option.description}
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
                        <Stack
                            direction={{ xs: 'column', sm: 'row' }}
                            spacing={1}
                            alignItems={{ xs: 'stretch', sm: 'center' }}
                            justifyContent="space-between"
                        >
                            <Button
                                variant="text"
                                onClick={() => {
                                    setDraftSolarSettings({ ...DEFAULT_SOLAR_SYSTEM_DISPLAY_OPTIONS });
                                    setDraftPlanetariumSettings({ ...DEFAULT_PLANETARIUM_DISPLAY_OPTIONS });
                                    setDraftInteraction({ enableMapDragging: false, enableMapZooming: false });
                                    setDraftViewMode(VIEW_MODE_SOLAR_SYSTEM);
                                }}
                            >
                                {t('map_settings.reset_defaults', { defaultValue: 'Reset Defaults' })}
                            </Button>

                            <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">
                                <Button variant="outlined" onClick={handleCancel}>
                                    {t('close', { defaultValue: 'Close' })}
                                </Button>
                                <Button variant="contained" onClick={handleApply} disabled={!isDirty}>
                                    {t('map_settings.apply', { defaultValue: 'Apply' })}
                                </Button>
                            </Stack>
                        </Stack>
                    </Box>
                </Box>
            </DialogContent>
        </Dialog>
    );
}

export default SolarSystemLayoutOptionsDialog;
