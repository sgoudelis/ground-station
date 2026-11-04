/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useEffect, useId, useMemo, useState} from 'react';
import {useMap} from 'react-map-gl/maplibre';

export default function VisibilityCircle({center, radius, label, pathOptions}) {
    const {current} = useMap();
    const map = current?.getMap();
    const pathId = `packet-visibility-${useId()}`;
    const [path, setPath] = useState('');
    const [latitude, longitude] = center;
    const coordinates = useMemo(() => {
        const lat = latitude * Math.PI / 180;
        const distance = radius / 6371000;
        // Begin at the west side and trace the lower half left-to-right, so
        // the label at 25% follows the ring upright in the Mercator projection.
        return Array.from({length: 129}, (_, index) => {
            const bearing = (270 - index * 360 / 128) * Math.PI / 180;
            const nextLat = Math.asin(Math.sin(lat) * Math.cos(distance)
                + Math.cos(lat) * Math.sin(distance) * Math.cos(bearing));
            const nextLon = longitude + Math.atan2(Math.sin(bearing) * Math.sin(distance) * Math.cos(lat),
                Math.cos(distance) - Math.sin(lat) * Math.sin(nextLat)) * 180 / Math.PI;
            return [nextLon, Math.max(-85.051129, Math.min(85.051129, nextLat * 180 / Math.PI))];
        });
    }, [latitude, longitude, radius]);

    useEffect(() => {
        if (!map) return;
        const update = () => setPath(coordinates.map((coordinate, index) => {
            const {x, y} = map.project(coordinate);
            return `${index ? 'L' : 'M'}${x},${y}`;
        }).join(' ') + ' Z');
        update();
        map.on('move', update);
        map.on('resize', update);
        return () => {map.off('move', update); map.off('resize', update);};
    }, [map, coordinates]);

    return <svg aria-hidden="true" data-center={JSON.stringify(center)} data-radius={radius} style={{position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none'}}>
        <path id={pathId} d={path} fill="none" stroke={pathOptions.color} strokeWidth={pathOptions.weight}
            strokeOpacity={pathOptions.opacity} strokeDasharray={pathOptions.dashArray} />
        <text className="packet-visibility-label" dy="-5">
            <textPath href={`#${pathId}`} startOffset="25%" textAnchor="middle">{label}</textPath>
        </text>
    </svg>;
}
