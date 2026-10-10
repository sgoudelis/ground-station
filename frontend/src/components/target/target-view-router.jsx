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

import {useSelector} from "react-redux";
import {Box, Typography} from '@mui/material';
import {normalizeMapEngine} from "../common/tile-layers.jsx";
import {normalizeTargetType} from './celestial-target-utils.js';
import TargetMapCompositeView from './target-map-composite-view.jsx';
import TargetEarthMapLibreView from './target-earth-maplibre-view.jsx';
import TargetSkyPlanetariumView from './target-sky-planetarium-view.jsx';
import { useTranslation } from 'react-i18next';

const MAP_ENGINE_MAPLIBRE_GLOBE = 'maplibre-globe';
const MAP_ENGINE_PLANETARIUM = 'planetarium';

export const resolveEffectiveMapEngine = ({
    mapEngine,
    autoSwitchPlanetariumByVisibility,
    targetType,
    targetElevation,
}) => {
    // Auto switching is satellite-specific because globe/earth renderers are satellite-target oriented.
    if (!autoSwitchPlanetariumByVisibility || targetType !== 'satellite') {
        return mapEngine;
    }
    const hasElevation = (
        targetElevation !== null
        && targetElevation !== undefined
        && String(targetElevation).trim() !== ''
    );
    if (!hasElevation) {
        return mapEngine;
    }
    const elevation = Number(targetElevation);
    if (!Number.isFinite(elevation)) {
        return mapEngine;
    }
    return elevation > 0 ? MAP_ENGINE_PLANETARIUM : MAP_ENGINE_MAPLIBRE_GLOBE;
};

export const shouldRenderNoTargetView = ({hasTargets, effectiveMapEngine}) => (
    !hasTargets
    && (effectiveMapEngine === MAP_ENGINE_PLANETARIUM || effectiveMapEngine === MAP_ENGINE_MAPLIBRE_GLOBE)
);

const NoTargetMapView = () => {
    const { t } = useTranslation('target');

    return (
        <Box
            sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 0.75,
                p: 3,
                textAlign: 'center',
            }}
        >
            <Typography variant="subtitle2" sx={{fontWeight: 700}}>
                {t('target_view_router.no_targets_configured', { defaultValue: 'No targets configured' })}
            </Typography>
            <Typography variant="body2" color="text.secondary">
                {t('target_view_router.add_a_target_to_view_the_planetarium_or_globe', { defaultValue: 'Add a target to view the planetarium or globe.' })}
            </Typography>
        </Box>
    );
};

const TargetViewRouter = () => {
    const mapEngine = useSelector((state) => state.targetSatTrack?.mapEngine);
    const autoSwitchPlanetariumByVisibility = useSelector(
        (state) => state.targetSatTrack?.autoSwitchPlanetariumByVisibility ?? false
    );
    const targetElevation = useSelector(
        (state) => state.targetSatTrack?.satelliteData?.position?.el
    );
    const trackingState = useSelector((state) => state.targetSatTrack?.trackingState || {});
    const hasTargets = useSelector((state) => (state.trackerInstances?.instances || []).length > 0);
    const targetType = normalizeTargetType(trackingState);
    const effectiveMapEngine = resolveEffectiveMapEngine({
        mapEngine,
        autoSwitchPlanetariumByVisibility,
        targetType,
        targetElevation,
    });
    const normalizedMapEngine = normalizeMapEngine(effectiveMapEngine);

    // A deleted final slot can leave stale target telemetry in Redux briefly.
    // Slot inventory is the authoritative source for whether a target view exists.
    if (shouldRenderNoTargetView({hasTargets, effectiveMapEngine})) {
        return <NoTargetMapView/>;
    }

    if (effectiveMapEngine === MAP_ENGINE_PLANETARIUM) {
        return <TargetSkyPlanetariumView/>;
    }

    // Globe renderer is intentionally satellite-target-only on the Target page.
    if (effectiveMapEngine === MAP_ENGINE_MAPLIBRE_GLOBE && targetType === 'satellite') {
        // Keep the MapLibre view mounted while changing projection. Replacing it
        // with the globe wrapper briefly creates a new map at its default camera
        // before the target-follow effect can position it.
        return <TargetEarthMapLibreView projection="globe" effectiveMapEngine={effectiveMapEngine}/>;
    }

    if (normalizedMapEngine === 'maplibre' && targetType === 'satellite') {
        return <TargetEarthMapLibreView/>;
    }

    return <TargetMapCompositeView/>;
};

export default TargetViewRouter;
