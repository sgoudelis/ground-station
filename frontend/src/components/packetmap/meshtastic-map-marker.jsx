/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useEffect, useMemo} from 'react';
import {useMap} from 'react-map-gl/maplibre';

export default React.memo(function MeshtasticMapMarker({id, latitude, longitude, name, selected = false, renderer, onSelectTransmitter}) {
    const {current} = useMap();
    const map = current?.getMap();
    // Keep the registration stable through telemetry, position and selection updates.
    const marker = useMemo(() => ({}), []);
    useEffect(() => {
        if (!map) return;
        renderer.add(marker, map);
        return () => renderer.remove(marker);
    }, [marker, renderer, map]);

    useEffect(() => {
        Object.assign(marker, {latitude, longitude, name, selected, onSelect: () => onSelectTransmitter?.(id)});
        map?.triggerRepaint();
    }, [marker, map, latitude, longitude, name, selected, id, onSelectTransmitter]);
    return null;
});
