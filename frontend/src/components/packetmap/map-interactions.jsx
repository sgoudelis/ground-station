/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useEffect, useState} from 'react';
import {useMap} from 'react-leaflet';
import {MapArrowControls} from '../common/common.jsx';

export default function MapInteractions({enableMapDragging, enableMapZooming}) {
    const map = useMap();
    const [arrowOffset, setArrowOffset] = useState(25);
    useEffect(() => {
        // Leaflet only reads MapContainer options on creation. Toggle the live
        // handlers so changing gestures preserves the current center and zoom.
        map.dragging[enableMapDragging ? 'enable' : 'disable']();
        for (const handler of [map.scrollWheelZoom, map.doubleClickZoom, map.touchZoom, map.boxZoom]) {
            handler[enableMapZooming ? 'enable' : 'disable']();
        }
    }, [map, enableMapDragging, enableMapZooming]);

    useEffect(() => {
        const attribution = map.attributionControl?.getContainer();
        if (!attribution) return;
        // Tile credits wrap on phones. Keep every pan button above them.
        const updateOffset = () => setArrowOffset(Math.max(25, attribution.getBoundingClientRect().height + 8));
        updateOffset();
        const observer = new ResizeObserver(updateOffset);
        observer.observe(attribution);
        return () => observer.disconnect();
    }, [map]);

    // Match Earth view: button-based panning remains available when dragging
    // is disabled and touch gestures can scroll the surrounding page.
    return !enableMapDragging && <div onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()}>
        <MapArrowControls mapObject={map} verticalOffset={arrowOffset} />
    </div>;
}
