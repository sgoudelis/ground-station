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

import React, {useEffect, useMemo, useRef, useState} from 'react';
import {
    Box,
    Button,
    Chip,
    FormControl,
    FormControlLabel,
    InputLabel,
    MenuItem,
    Paper,
    Select,
    Stack,
    Switch,
    TextField,
    Typography,
} from '@mui/material';
import {
    getTileLayerById,
    getTileLayersForEngine,
    mapEngineOptions,
    normalizeMapEngine as defaultNormalizeMapEngine,
    resolveCompatibleTileLayerId,
} from './tile-layers.jsx';
import { useTranslation } from 'react-i18next';

const SETTINGS_KEYS = [
    'enableMapDragging',
    'enableMapZooming',
    'autoSwitchPlanetariumByVisibility',
    'showPastOrbitPath',
    'showFutureOrbitPath',
    'showSatelliteCoverage',
    'showSunIcon',
    'showMoonIcon',
    'showTerminatorLine',
    'showTooltip',
    'showGrid',
    'pastOrbitLineColor',
    'futureOrbitLineColor',
    'satelliteCoverageColor',
    'orbitProjectionDuration',
    'tileLayerID',
    'mapEngine',
];

const isHexColor = (value) => /^#[0-9A-Fa-f]{6}$/.test(String(value || ''));

const normalizeHexColor = (value, fallback) => {
    if (isHexColor(value)) {
        return String(value).toUpperCase();
    }
    return String(fallback || '#FFFFFF').toUpperCase();
};

const normalizeProjectionLabel = (projection) => {
    if (projection === 'EPSG4326') {
        return 'EPSG:4326';
    }
    return 'EPSG:3857';
};

const buildSettings = ({
    initialLockOnTarget,
    initialEnableMapDragging,
    initialEnableMapZooming,
    initialAutoSwitchPlanetariumByVisibility,
    initialShowPastOrbitPath,
    initialShowFutureOrbitPath,
    initialShowSatelliteCoverage,
    initialShowSunIcon,
    initialShowMoonIcon,
    initialShowTerminatorLine,
    initialSatelliteCoverageColor,
    initialPastOrbitLineColor,
    initialFutureOrbitLineColor,
    initialOrbitProjectionDuration,
    initialTileLayerID,
    initialMapEngine,
    initialShowTooltip,
    initialShowGrid,
    normalizeMapEngineValue = defaultNormalizeMapEngine,
}) => {
    const mapEngine = normalizeMapEngineValue(initialMapEngine);
    const tileLayerID = resolveCompatibleTileLayerId(initialTileLayerID, mapEngine);
    return {
        lockOnTarget: Boolean(initialLockOnTarget),
        enableMapDragging: Boolean(initialEnableMapDragging),
        enableMapZooming: Boolean(initialEnableMapZooming),
        autoSwitchPlanetariumByVisibility: Boolean(initialAutoSwitchPlanetariumByVisibility),
        showPastOrbitPath: Boolean(initialShowPastOrbitPath),
        showFutureOrbitPath: Boolean(initialShowFutureOrbitPath),
        showSatelliteCoverage: Boolean(initialShowSatelliteCoverage),
        showSunIcon: Boolean(initialShowSunIcon),
        showMoonIcon: Boolean(initialShowMoonIcon),
        showTerminatorLine: Boolean(initialShowTerminatorLine),
        showTooltip: Boolean(initialShowTooltip),
        showGrid: Boolean(initialShowGrid),
        pastOrbitLineColor: normalizeHexColor(initialPastOrbitLineColor, '#33C833'),
        futureOrbitLineColor: normalizeHexColor(initialFutureOrbitLineColor, '#E4971E'),
        satelliteCoverageColor: normalizeHexColor(initialSatelliteCoverageColor, '#FFFFFF'),
        orbitProjectionDuration: Number(initialOrbitProjectionDuration) || 240,
        tileLayerID,
        mapEngine,
    };
};

const settingsEqual = (left, right, keys = SETTINGS_KEYS) => keys.every((key) => left[key] === right[key]);

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
        control={<Switch size="small" checked={checked} onChange={(e) => onChange(e.target.checked)} />}
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

const ColorSetting = ({ label, value, disabled = false, onChange }) => {
    const colorInputRef = useRef(null);
    const safeSwatchColor = isHexColor(value) ? value : '#FFFFFF';

    return (
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
            <Typography variant="body2" color={disabled ? 'text.disabled' : 'text.primary'}>
                {label}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
                <Box
                    role="button"
                    tabIndex={disabled ? -1 : 0}
                    aria-label={label}
                    onClick={() => {
                        if (!disabled && colorInputRef.current) {
                            colorInputRef.current.click();
                        }
                    }}
                    onKeyDown={(event) => {
                        if (!disabled && (event.key === 'Enter' || event.key === ' ')) {
                            event.preventDefault();
                            colorInputRef.current?.click();
                        }
                    }}
                    sx={{
                        width: 26,
                        height: 26,
                        borderRadius: 1,
                        border: '1px solid',
                        borderColor: disabled ? 'divider' : 'border.main',
                        bgcolor: safeSwatchColor,
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        opacity: disabled ? 0.45 : 1,
                    }}
                />
                <input
                    ref={colorInputRef}
                    type="color"
                    value={safeSwatchColor}
                    onChange={(e) => onChange(String(e.target.value || '').toUpperCase())}
                    disabled={disabled}
                    style={{ display: 'none' }}
                />
                <TextField
                    size="small"
                    value={String(value || '')}
                    disabled={disabled}
                    onChange={(e) => {
                        const nextValue = String(e.target.value || '').toUpperCase();
                        if (/^#?[0-9A-F]{0,6}$/.test(nextValue)) {
                            onChange(nextValue.startsWith('#') ? nextValue : `#${nextValue}`);
                        }
                    }}
                    onBlur={() => {
                        if (!isHexColor(value)) {
                            onChange(safeSwatchColor);
                        }
                    }}
                    sx={{ width: 108 }}
                    inputProps={{ maxLength: 7 }}
                />
            </Stack>
        </Stack>
    );
};

const MapSettingsIsland = ({ initialLockOnTarget, initialEnableMapDragging, initialEnableMapZooming,
                            initialAutoSwitchPlanetariumByVisibility,
                            initialShowPastOrbitPath, initialShowFutureOrbitPath, initialShowSatelliteCoverage,
                            initialShowSunIcon, initialShowMoonIcon, initialShowTerminatorLine,
                            initialSatelliteCoverageColor, initialPastOrbitLineColor, initialFutureOrbitLineColor,
                            initialOrbitProjectionDuration, initialTileLayerID, initialMapEngine, initialShowTooltip, initialShowGrid,
                               handleLockOnTarget, handleEnableMapDragging, handleEnableMapZooming,
                               handleAutoSwitchPlanetariumByVisibility,
                               handleShowFutureOrbitPath, handleShowPastOrbitPath,
                            handleShowSatelliteCoverage, handleSetShowSunIcon, handleSetShowMoonIcon,
                            handleShowTerminatorLine, handleFutureOrbitLineColor, handlePastOrbitLineColor,
                            handleSatelliteCoverageColor, handleOrbitProjectionDuration, handleShowTooltip,
                               handleTileLayerID, handleMapEngine, handleShowGrid, updateBackend, onCancel, defaultSettings, open,
                               mapEngineOptions: allowedMapEngineOptions = mapEngineOptions,
                               normalizeMapEngineValue = defaultNormalizeMapEngine}) => {

    const { t } = useTranslation('common');

    const timeOptions = [
        {value: 60,  label: t('map_settings.time_options.1_hour')},
        {value: 120, label: t('map_settings.time_options.2_hours')},
        {value: 240, label: t('map_settings.time_options.4_hours')},
        {value: 480, label: t('map_settings.time_options.8_hours')},
        {value: 720, label: t('map_settings.time_options.12_hours')},
        {value: 1440, label: t('map_settings.time_options.24_hours')},
    ];

    const supportsLockOnTarget = useMemo(
        () => (
            typeof initialLockOnTarget === 'boolean'
            || typeof defaultSettings?.lockOnTarget === 'boolean'
            || typeof handleLockOnTarget === 'function'
        ),
        [defaultSettings?.lockOnTarget, handleLockOnTarget, initialLockOnTarget]
    );
    const supportsAutoSwitchPlanetariumByVisibility = useMemo(
        () => (
            typeof initialAutoSwitchPlanetariumByVisibility === 'boolean'
            || typeof defaultSettings?.autoSwitchPlanetariumByVisibility === 'boolean'
            || typeof handleAutoSwitchPlanetariumByVisibility === 'function'
        ),
        [
            defaultSettings?.autoSwitchPlanetariumByVisibility,
            handleAutoSwitchPlanetariumByVisibility,
            initialAutoSwitchPlanetariumByVisibility,
        ]
    );
    const settingsKeys = useMemo(
        () => {
            const keys = supportsLockOnTarget ? [...SETTINGS_KEYS, 'lockOnTarget'] : [...SETTINGS_KEYS];
            if (!supportsAutoSwitchPlanetariumByVisibility) {
                return keys.filter((key) => key !== 'autoSwitchPlanetariumByVisibility');
            }
            return keys;
        },
        [supportsAutoSwitchPlanetariumByVisibility, supportsLockOnTarget]
    );

    const initialSettings = useMemo(
        () => buildSettings({
            initialLockOnTarget,
            initialEnableMapDragging,
            initialEnableMapZooming,
            initialAutoSwitchPlanetariumByVisibility,
            initialShowPastOrbitPath,
            initialShowFutureOrbitPath,
            initialShowSatelliteCoverage,
            initialShowSunIcon,
            initialShowMoonIcon,
            initialShowTerminatorLine,
            initialSatelliteCoverageColor,
            initialPastOrbitLineColor,
            initialFutureOrbitLineColor,
            initialOrbitProjectionDuration,
            initialTileLayerID,
            initialMapEngine,
            initialShowTooltip,
            initialShowGrid,
            normalizeMapEngineValue,
        }),
        [
            initialLockOnTarget,
            initialEnableMapDragging,
            initialEnableMapZooming,
            initialAutoSwitchPlanetariumByVisibility,
            initialShowPastOrbitPath,
            initialShowFutureOrbitPath,
            initialShowSatelliteCoverage,
            initialShowSunIcon,
            initialShowMoonIcon,
            initialShowTerminatorLine,
            initialSatelliteCoverageColor,
            initialPastOrbitLineColor,
            initialFutureOrbitLineColor,
            initialOrbitProjectionDuration,
            initialTileLayerID,
            initialMapEngine,
            initialShowTooltip,
            initialShowGrid,
            normalizeMapEngineValue,
        ]
    );

    const defaults = useMemo(
        () => buildSettings({
            initialLockOnTarget: defaultSettings?.lockOnTarget,
            initialEnableMapDragging: defaultSettings?.enableMapDragging,
            initialEnableMapZooming: defaultSettings?.enableMapZooming,
            initialAutoSwitchPlanetariumByVisibility: defaultSettings?.autoSwitchPlanetariumByVisibility,
            initialShowPastOrbitPath: defaultSettings?.showPastOrbitPath,
            initialShowFutureOrbitPath: defaultSettings?.showFutureOrbitPath,
            initialShowSatelliteCoverage: defaultSettings?.showSatelliteCoverage,
            initialShowSunIcon: defaultSettings?.showSunIcon,
            initialShowMoonIcon: defaultSettings?.showMoonIcon,
            initialShowTerminatorLine: defaultSettings?.showTerminatorLine,
            initialSatelliteCoverageColor: defaultSettings?.satelliteCoverageColor,
            initialPastOrbitLineColor: defaultSettings?.pastOrbitLineColor,
            initialFutureOrbitLineColor: defaultSettings?.futureOrbitLineColor,
            initialOrbitProjectionDuration: defaultSettings?.orbitProjectionDuration,
            initialTileLayerID: defaultSettings?.tileLayerID,
            initialMapEngine: defaultSettings?.mapEngine,
            initialShowTooltip: defaultSettings?.showTooltip,
            initialShowGrid: defaultSettings?.showGrid,
            normalizeMapEngineValue,
        }),
        [defaultSettings, normalizeMapEngineValue]
    );

    const [draftSettings, setDraftSettings] = useState(initialSettings);
    const [saveState, setSaveState] = useState('idle');

    useEffect(() => {
        if (open) {
            setDraftSettings(initialSettings);
            setSaveState('idle');
        }
    }, [open, initialSettings]);

    useEffect(() => {
        setSaveState((current) => ((current === 'saved' || current === 'error') ? 'idle' : current));
    }, [draftSettings]);

    const selectedLayer = useMemo(
        () => getTileLayerById(draftSettings.tileLayerID, { mapEngine: draftSettings.mapEngine }),
        [draftSettings.mapEngine, draftSettings.tileLayerID]
    );
    const isPlanetariumEngine = draftSettings.mapEngine === 'planetarium';

    const availableTileLayers = useMemo(
        () => getTileLayersForEngine(draftSettings.mapEngine),
        [draftSettings.mapEngine]
    );

    const initialLayer = useMemo(
        () => getTileLayerById(initialSettings.tileLayerID, { mapEngine: initialSettings.mapEngine }),
        [initialSettings.mapEngine, initialSettings.tileLayerID]
    );

    useEffect(() => {
        const compatibleLayerId = resolveCompatibleTileLayerId(draftSettings.tileLayerID, draftSettings.mapEngine);
        if (compatibleLayerId !== draftSettings.tileLayerID) {
            setDraftSettings((prev) => ({ ...prev, tileLayerID: compatibleLayerId }));
        }
    }, [draftSettings.mapEngine, draftSettings.tileLayerID]);

    const projectionChanged = (selectedLayer.projection || 'EPSG3857') !== (initialLayer.projection || 'EPSG3857');
    const mapEngineChanged = draftSettings.mapEngine !== initialSettings.mapEngine;
    const isDirty = !settingsEqual(draftSettings, initialSettings, settingsKeys);

    const applySettings = async () => {
        const mapEngine = normalizeMapEngineValue(draftSettings.mapEngine);
        const tileLayerID = resolveCompatibleTileLayerId(draftSettings.tileLayerID, mapEngine);
        const sanitizedSettings = {
            ...draftSettings,
            pastOrbitLineColor: normalizeHexColor(draftSettings.pastOrbitLineColor, initialSettings.pastOrbitLineColor),
            futureOrbitLineColor: normalizeHexColor(draftSettings.futureOrbitLineColor, initialSettings.futureOrbitLineColor),
            satelliteCoverageColor: normalizeHexColor(draftSettings.satelliteCoverageColor, initialSettings.satelliteCoverageColor),
            mapEngine,
            tileLayerID,
        };

        handleEnableMapDragging?.(sanitizedSettings.enableMapDragging);
        handleEnableMapZooming?.(sanitizedSettings.enableMapZooming);
        if (supportsAutoSwitchPlanetariumByVisibility) {
            handleAutoSwitchPlanetariumByVisibility?.(sanitizedSettings.autoSwitchPlanetariumByVisibility);
        }
        handleShowPastOrbitPath(sanitizedSettings.showPastOrbitPath);
        handleShowFutureOrbitPath(sanitizedSettings.showFutureOrbitPath);
        handleShowSatelliteCoverage(sanitizedSettings.showSatelliteCoverage);
        handleSetShowSunIcon(sanitizedSettings.showSunIcon);
        handleSetShowMoonIcon(sanitizedSettings.showMoonIcon);
        handleShowTerminatorLine(sanitizedSettings.showTerminatorLine);
        handleShowTooltip(sanitizedSettings.showTooltip);
        handleShowGrid(sanitizedSettings.showGrid);
        if (supportsLockOnTarget) {
            handleLockOnTarget?.(sanitizedSettings.lockOnTarget);
        }
        handlePastOrbitLineColor(sanitizedSettings.pastOrbitLineColor);
        handleFutureOrbitLineColor(sanitizedSettings.futureOrbitLineColor);
        handleSatelliteCoverageColor(sanitizedSettings.satelliteCoverageColor);
        handleOrbitProjectionDuration(sanitizedSettings.orbitProjectionDuration);
        handleMapEngine?.(sanitizedSettings.mapEngine);
        handleTileLayerID(sanitizedSettings.tileLayerID);
        setDraftSettings(sanitizedSettings);

        setSaveState('saving');
        try {
            await Promise.resolve(updateBackend?.(sanitizedSettings));
            setSaveState('saved');
        } catch {
            setSaveState('error');
        }
    };

    const cancelChanges = () => {
        setDraftSettings(initialSettings);
        setSaveState('idle');
        onCancel?.();
    };

    const saveFeedbackLabel = {
        saving: t('map_settings.saving', { defaultValue: 'Saving…' }),
        saved: t('map_settings.saved', { defaultValue: 'Saved' }),
        error: t('map_settings.save_failed', { defaultValue: 'Save failed' }),
    }[saveState];

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
            <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', px: 2, pt: 2, pb: 1.5 }}>
                <Stack spacing={1.5}>
                <SectionBlock
                    title={t('map_settings.section_base_map', { defaultValue: 'Base Map' })}
                    subtitle={
                        isPlanetariumEngine
                            ? t('map_settings.section_base_map_planetarium_desc', {
                                defaultValue: 'Select the active rendering engine and pointer interaction behavior.',
                            })
                            : t('map_settings.section_base_map_desc', { defaultValue: 'Choose a basemap and projection.' })
                    }
                >
                    <FormControl fullWidth size="small" variant="outlined">
                        <InputLabel id="map-engine-label">{t('map_settings.map_engine', { defaultValue: 'Map Engine' })}</InputLabel>
                        <Select
                            labelId="map-engine-label"
                            value={draftSettings.mapEngine}
                            label={t('map_settings.map_engine', { defaultValue: 'Map Engine' })}
                            onChange={(e) => {
                                const nextMapEngine = normalizeMapEngineValue(e.target.value);
                                setDraftSettings((prev) => ({
                                    ...prev,
                                    mapEngine: nextMapEngine,
                                    tileLayerID: resolveCompatibleTileLayerId(prev.tileLayerID, nextMapEngine),
                                }));
                            }}
                        >
                            {allowedMapEngineOptions.map((engine) => (
                                <MenuItem key={engine.id} value={engine.id}>
                                    <Typography variant="body2">{engine.name}</Typography>
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>

                    {!isPlanetariumEngine ? (
                        <FormControl fullWidth size="small" variant="outlined">
                            <InputLabel id="tile-layer-label">{t('map_settings.tile_layer')}</InputLabel>
                            <Select
                                labelId="tile-layer-label"
                                value={draftSettings.tileLayerID}
                                label={t('map_settings.tile_layer')}
                                onChange={(e) => setDraftSettings((prev) => ({ ...prev, tileLayerID: e.target.value }))}
                                renderValue={(value) => {
                                    const layer = getTileLayerById(value, { mapEngine: draftSettings.mapEngine });
                                    return (
                                        <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                                            <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {layer.name}
                                            </Typography>
                                            <Chip size="small" label={normalizeProjectionLabel(layer.projection)} />
                                        </Stack>
                                    );
                                }}
                            >
                                {availableTileLayers.map((layer) => (
                                    <MenuItem key={layer.id} value={layer.id}>
                                        <Stack direction="row" alignItems="center" spacing={1} sx={{ width: '100%', minWidth: 0 }}>
                                            <Box sx={{ minWidth: 0, flexGrow: 1 }}>
                                                <Typography variant="body2">{layer.name}</Typography>
                                                {layer.description ? (
                                                    <Typography variant="caption" color="text.secondary">
                                                        {layer.description}
                                                    </Typography>
                                                ) : null}
                                            </Box>
                                            <Chip size="small" label={normalizeProjectionLabel(layer.projection)} />
                                        </Stack>
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    ) : null}

                    {!isPlanetariumEngine ? (
                        <Typography
                            variant="caption"
                            color={projectionChanged || mapEngineChanged ? 'warning.main' : 'text.secondary'}
                            sx={{ display: 'block' }}
                        >
                            {t('map_settings.projection_note', {
                                defaultValue: 'Switching map engine or projection rebuilds the map canvas and may recenter the view.',
                            })}
                        </Typography>
                    ) : null}

                    {supportsAutoSwitchPlanetariumByVisibility ? (
                        <ToggleRowWithDescription
                            label={t('map_settings.auto_switch_planetarium_visibility', {
                                defaultValue: 'Auto-switch planetarium when target is visible',
                            })}
                            description={t('map_settings.auto_switch_planetarium_visibility_desc', {
                                defaultValue: 'For satellite targets: use planetarium above horizon and switch back to globe below horizon.',
                            })}
                            checked={draftSettings.autoSwitchPlanetariumByVisibility}
                            onChange={(value) => setDraftSettings((prev) => ({
                                ...prev,
                                autoSwitchPlanetariumByVisibility: value,
                            }))}
                        />
                    ) : null}

                    <ToggleRowWithDescription
                        label={t('map_settings.enable_map_dragging', { defaultValue: 'Enable map dragging' })}
                        description={t('map_settings.enable_map_dragging_desc', {
                            defaultValue: 'Allow click-and-drag panning directly on the map.',
                        })}
                        checked={draftSettings.enableMapDragging}
                        onChange={(value) => setDraftSettings((prev) => ({ ...prev, enableMapDragging: value }))}
                    />
                    <ToggleRowWithDescription
                        label={t('map_settings.enable_map_zooming', { defaultValue: 'Enable map zooming' })}
                        description={t('map_settings.enable_map_zooming_desc', {
                            defaultValue: 'Allow mouse wheel, pinch, and double-click zoom gestures.',
                        })}
                        checked={draftSettings.enableMapZooming}
                        onChange={(value) => setDraftSettings((prev) => ({ ...prev, enableMapZooming: value }))}
                    />
                </SectionBlock>

                {!isPlanetariumEngine ? (
                <SectionBlock
                    title={t('map_settings.section_satellite_overlays', { defaultValue: 'Satellite Overlays' })}
                >
                    {supportsLockOnTarget ? (
                        <ToggleRowWithDescription
                            label={t('map_settings.lock_on_target', { defaultValue: 'Lock map on selected target' })}
                            description={t('map_settings.lock_on_target_desc', {
                                defaultValue: 'Keep the active target centered while tracking updates.',
                            })}
                            checked={draftSettings.lockOnTarget}
                            onChange={(value) => setDraftSettings((prev) => ({ ...prev, lockOnTarget: value }))}
                        />
                    ) : null}
                    <ToggleRowWithDescription
                        label={t('map_settings.satellite_coverage')}
                        description={t('map_settings.satellite_coverage_desc', {
                            defaultValue: 'Show the current ground footprint coverage area for tracked satellites.',
                        })}
                        checked={draftSettings.showSatelliteCoverage}
                        onChange={(value) => setDraftSettings((prev) => ({ ...prev, showSatelliteCoverage: value }))}
                    />
                    <ToggleRowWithDescription
                        label={t('map_settings.show_sun')}
                        description={t('map_settings.show_sun_desc', {
                            defaultValue: 'Display the subsolar point marker on the map.',
                        })}
                        checked={draftSettings.showSunIcon}
                        onChange={(value) => setDraftSettings((prev) => ({ ...prev, showSunIcon: value }))}
                    />
                    <ToggleRowWithDescription
                        label={t('map_settings.show_moon')}
                        description={t('map_settings.show_moon_desc', {
                            defaultValue: 'Display the sublunar point marker on the map.',
                        })}
                        checked={draftSettings.showMoonIcon}
                        onChange={(value) => setDraftSettings((prev) => ({ ...prev, showMoonIcon: value }))}
                    />
                    <ToggleRowWithDescription
                        label={t('map_settings.day_night_separator')}
                        description={t('map_settings.day_night_separator_desc', {
                            defaultValue: 'Draw the day-night boundary overlay.',
                        })}
                        checked={draftSettings.showTerminatorLine}
                        onChange={(value) => setDraftSettings((prev) => ({ ...prev, showTerminatorLine: value }))}
                    />
                    <ToggleRowWithDescription
                        label={t('map_settings.satellite_tooltip')}
                        description={t('map_settings.satellite_tooltip_desc', {
                            defaultValue: 'Show satellite name and telemetry tooltip labels.',
                        })}
                        checked={draftSettings.showTooltip}
                        onChange={(value) => setDraftSettings((prev) => ({ ...prev, showTooltip: value }))}
                    />
                    <ToggleRowWithDescription
                        label={t('map_settings.coordinate_grid')}
                        description={t('map_settings.coordinate_grid_desc', {
                            defaultValue: 'Overlay latitude and longitude grid lines.',
                        })}
                        checked={draftSettings.showGrid}
                        onChange={(value) => setDraftSettings((prev) => ({ ...prev, showGrid: value }))}
                    />
                </SectionBlock>
                ) : null}

                {!isPlanetariumEngine ? (
                <SectionBlock
                    title={t('map_settings.section_orbital_paths', { defaultValue: 'Orbital Paths' })}
                >
                    <ToggleRowWithDescription
                        label={t('map_settings.past_orbit_path')}
                        description={t('map_settings.past_orbit_path_desc', {
                            defaultValue: 'Plot the satellite path for elapsed time before now.',
                        })}
                        checked={draftSettings.showPastOrbitPath}
                        onChange={(value) => setDraftSettings((prev) => ({ ...prev, showPastOrbitPath: value }))}
                    />
                    <ToggleRowWithDescription
                        label={t('map_settings.future_orbit_path')}
                        description={t('map_settings.future_orbit_path_desc', {
                            defaultValue: 'Plot the projected orbit path ahead of the current time.',
                        })}
                        checked={draftSettings.showFutureOrbitPath}
                        onChange={(value) => setDraftSettings((prev) => ({ ...prev, showFutureOrbitPath: value }))}
                    />

                    <FormControl fullWidth size="small" variant="outlined">
                        <InputLabel id="orbit-time-label">{t('map_settings.orbit_projection_time')}</InputLabel>
                        <Select
                            labelId="orbit-time-label"
                            value={draftSettings.orbitProjectionDuration}
                            label={t('map_settings.orbit_projection_time')}
                            onChange={(e) => setDraftSettings((prev) => ({ ...prev, orbitProjectionDuration: Number(e.target.value) }))}
                        >
                            {timeOptions.map((option) => (
                                <MenuItem key={option.value} value={option.value}>
                                    {option.label}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </SectionBlock>
                ) : null}

                {!isPlanetariumEngine ? (
                <SectionBlock
                    title={t('map_settings.section_visual_styling', { defaultValue: 'Visual Styling' })}
                    subtitle={t('map_settings.section_visual_styling_desc', {
                        defaultValue: 'Only enabled overlays expose their color controls.',
                    })}
                >
                    <ColorSetting
                        label={t('map_settings.footprint_color')}
                        value={draftSettings.satelliteCoverageColor}
                        disabled={!draftSettings.showSatelliteCoverage}
                        onChange={(value) => setDraftSettings((prev) => ({ ...prev, satelliteCoverageColor: value }))}
                    />
                    <ColorSetting
                        label={t('map_settings.past_orbit_color')}
                        value={draftSettings.pastOrbitLineColor}
                        disabled={!draftSettings.showPastOrbitPath}
                        onChange={(value) => setDraftSettings((prev) => ({ ...prev, pastOrbitLineColor: value }))}
                    />
                    <ColorSetting
                        label={t('map_settings.future_orbit_color')}
                        value={draftSettings.futureOrbitLineColor}
                        disabled={!draftSettings.showFutureOrbitPath}
                        onChange={(value) => setDraftSettings((prev) => ({ ...prev, futureOrbitLineColor: value }))}
                    />
                </SectionBlock>
                ) : null}
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
                            setDraftSettings(defaults);
                            setSaveState('idle');
                        }}
                    >
                        {t('map_settings.reset_defaults', { defaultValue: 'Reset Defaults' })}
                    </Button>

                    <Box sx={{ flex: 1, minWidth: 8 }} />
                    {saveFeedbackLabel ? (
                        <Chip
                            size="small"
                            color={saveState === 'error' ? 'error' : saveState === 'saved' ? 'success' : 'default'}
                            label={saveFeedbackLabel}
                        />
                    ) : null}
                    <Button variant="outlined" onClick={cancelChanges}>
                        {t('close', { defaultValue: 'Close' })}
                    </Button>
                    <Button
                        variant="contained"
                        onClick={applySettings}
                        disabled={!isDirty || saveState === 'saving'}
                    >
                        {t('map_settings.apply', { defaultValue: 'Apply' })}
                    </Button>
                </Box>
            </Box>
        </Box>
    );
};

export default MapSettingsIsland;
