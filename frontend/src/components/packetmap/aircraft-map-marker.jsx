/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useMemo} from 'react';
import ArtworkMapMarker from './artwork-map-marker.jsx';
import {createAircraftIcon} from './aircraft-marker.js';

// Scalar appearance props keep fresh telemetry objects and another aircraft's
// selection from rebuilding this icon. Position changes only move the marker.
export default React.memo(function AircraftMapMarker({id, latitude, longitude, track, name, icao,
    shapeName, shapeScale, squawk, emergency, stale, selected, onSelectTransmitter}) {
    const icon = useMemo(() => createAircraftIcon({track, name, icao, shape: {name: shapeName, scale: shapeScale},
        squawk, emergency, stale, selected,
    }), [track, name, icao, shapeName, shapeScale, squawk, emergency, stale, selected]);
    return <ArtworkMapMarker latitude={latitude} longitude={longitude} title={name || icao || id} icon={icon}
        onClick={() => onSelectTransmitter?.(id)} />;
});
