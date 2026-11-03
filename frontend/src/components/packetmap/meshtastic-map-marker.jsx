/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useEffect, useMemo} from 'react';
import {useMap} from 'react-leaflet';
import {MeshtasticMarker} from './meshtastic-marker.js';
import {typeColor} from './transmitters.js';

export default React.memo(function MeshtasticMapMarker({id, latitude, longitude, name, selected = false, renderer, onSelectTransmitter}) {
    const map = useMap();
    // Position updates move the same layer; telemetry/selection never reloads its image.
    const marker = useMemo(() => new MeshtasticMarker([latitude, longitude], {
        renderer, radius: 5.985, color: typeColor('meshtastic'), fillOpacity: 0.85, weight: 2, label: name ?? '', selected,
    }), [renderer]);

    useEffect(() => {
        marker.addTo(map);
        return () => marker.remove();
    }, [marker, map]);

    useEffect(() => {
        marker.setLatLng([latitude, longitude]);
    }, [marker, latitude, longitude]);

    useEffect(() => {
        marker.setLabel(name, selected);
    }, [marker, name, selected]);

    useEffect(() => {
        const select = () => onSelectTransmitter?.(id);
        marker.on('click', select);
        return () => marker.off('click', select);
    }, [marker, id, onSelectTransmitter]);

    return null;
});
