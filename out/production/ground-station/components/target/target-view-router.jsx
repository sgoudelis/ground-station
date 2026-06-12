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
import {normalizeMapEngine} from "../common/tile-layers.jsx";
import {normalizeTargetType} from './celestial-target-utils.js';
import TargetMapCompositeView from './target-map-composite-view.jsx';
import TargetEarthMapLibreView from './target-earth-maplibre-view.jsx';
import TargetEarthMapLibreGlobeView from './target-earth-maplibre-globe-view.jsx';
import TargetSkyPlanetariumView from './target-sky-planetarium-view.jsx';

const MAP_ENGINE_MAPLIBRE_GLOBE = 'maplibre-globe';
const MAP_ENGINE_PLANETARIUM = 'planetarium';

const TargetViewRouter = () => {
    const mapEngine = useSelector((state) => state.targetSatTrack?.mapEngine);
    const trackingState = useSelector((state) => state.targetSatTrack?.trackingState || {});
    const normalizedMapEngine = normalizeMapEngine(mapEngine);
    const targetType = normalizeTargetType(trackingState);

    if (mapEngine === MAP_ENGINE_PLANETARIUM) {
        return <TargetSkyPlanetariumView/>;
    }

    // Globe renderer is intentionally satellite-target-only on the Target page.
    if (mapEngine === MAP_ENGINE_MAPLIBRE_GLOBE && targetType === 'satellite') {
        return <TargetEarthMapLibreGlobeView/>;
    }

    if (normalizedMapEngine === 'maplibre' && targetType === 'satellite') {
        return <TargetEarthMapLibreView/>;
    }

    return <TargetMapCompositeView/>;
};

export default TargetViewRouter;
