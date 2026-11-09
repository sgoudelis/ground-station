/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useMemo} from 'react';
import {useTheme} from '@mui/material/styles';
import ArtworkMapMarker from './artwork-map-marker.jsx';
import {createAircraftIcon} from './aircraft-marker.js';

// Scalar appearance props keep fresh telemetry objects and another aircraft's
// selection from rebuilding this icon. Position changes only move the marker.
export default React.memo(function AircraftMapMarker({id, latitude, longitude, track, altitude, onGround, name, icao,
    shapeName, shapeScale, squawk, emergency, stale, selected, onSelectTransmitter}) {
    // Match the aircraft dialog's accent in the active theme.
    const normalColor = useTheme().palette.info.main;
    const icon = useMemo(() => createAircraftIcon({track, altitude, onGround, name, icao, shape: {name: shapeName, scale: shapeScale},
        squawk, emergency, stale, selected, normalColor,
    }), [track, altitude, onGround, name, icao, shapeName, shapeScale, squawk, emergency, stale, selected, normalColor]);
    return <ArtworkMapMarker latitude={latitude} longitude={longitude} title={name || icao || id} icon={icon}
        onClick={() => onSelectTransmitter?.(id)} />;
});
