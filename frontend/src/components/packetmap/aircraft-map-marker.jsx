/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useMemo} from 'react';
import {Marker} from 'react-leaflet';
import {createAircraftIcon} from './aircraft-marker.js';

// Scalar appearance props keep fresh telemetry objects and another aircraft's
// selection from rebuilding this icon. Position changes only move the marker.
export default React.memo(function AircraftMapMarker({id, latitude, longitude, track, name, icao,
    shapeName, shapeScale, squawk, emergency, stale, selected, onSelectTransmitter}) {
    const icon = useMemo(() => createAircraftIcon({track, name, icao, shape: {name: shapeName, scale: shapeScale},
        squawk, emergency, stale, selected,
    }), [track, name, icao, shapeName, shapeScale, squawk, emergency, stale, selected]);
    const position = useMemo(() => [latitude, longitude], [latitude, longitude]);
    const eventHandlers = useMemo(() => ({click: () => onSelectTransmitter?.(id)}), [id, onSelectTransmitter]);
    return <Marker position={position} title={name || icao || id} icon={icon} eventHandlers={eventHandlers} />;
});
