/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useLayoutEffect, useRef} from 'react';
import {Marker} from 'react-map-gl/maplibre';

function Artwork({icon, shadow = false}) {
    const element = useRef(null);
    useLayoutEffect(() => {
        if (shadow) icon.createShadow(element.current);
        else icon.createIcon(element.current);
    }, [icon, shadow]);
    return <div ref={element} />;
}

export default React.memo(function ArtworkMapMarker({latitude, longitude, icon, title, onClick, interactive = true}) {
    const {iconAnchor, shadowAnchor = iconAnchor, shadowHtml} = icon.options;
    return <>
        {shadowHtml && <Marker latitude={latitude} longitude={longitude} anchor="top-left"
            offset={shadowAnchor.map((value) => -value)} style={{pointerEvents: 'none', zIndex: 1}}>
            <Artwork icon={icon} shadow />
        </Marker>}
        <Marker latitude={latitude} longitude={longitude} anchor="top-left"
            offset={iconAnchor.map((value) => -value)}
            style={{pointerEvents: interactive ? 'auto' : 'none', zIndex: interactive ? 3 : 4}}
            onClick={(event) => { event.originalEvent.stopPropagation(); onClick?.(); }}>
            <div title={title} style={{cursor: interactive ? 'pointer' : undefined}}><Artwork icon={icon} /></div>
        </Marker>
    </>;
});
