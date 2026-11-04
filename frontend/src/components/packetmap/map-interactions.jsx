/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useEffect} from 'react';
import {useMap} from 'react-map-gl/maplibre';
import {MapArrowControls} from '../common/common.jsx';

export default function MapInteractions({enableMapDragging}) {
    const {current} = useMap();
    const map = current?.getMap();
    useEffect(() => {
        // Keep this map north-up, including pinch zooms on touch screens.
        map?.touchZoomRotate.disableRotation();
    }, [map]);
    // MapLibre applies gesture props to the live map. Button-based panning is
    // still available when dragging is disabled, as in Earth View.
    return !enableMapDragging && current && <div onClick={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()}>
        <MapArrowControls mapObject={current} verticalOffset={2} />
    </div>;
}
