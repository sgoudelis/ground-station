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

import {useEffect, useRef} from 'react';
import {useMap} from 'react-leaflet';
import L from 'leaflet';

const ZOOM_HANDLER_KEYS = ['scrollWheelZoom', 'doubleClickZoom', 'touchZoom', 'boxZoom'];

function setHandlerEnabled(handler, enabled) {
    if (!handler) {
        return;
    }
    if (enabled) {
        handler.enable();
    } else {
        handler.disable();
    }
}

/**
 * Applies map drag/zoom gesture flags at runtime. When gesture zoom is disabled,
 * Leaflet +/- buttons are shown instead (same as arrow pan when dragging is disabled).
 */
export function MapInteractionSync({
    enableDragging,
    enableZooming,
    showZoomButtons,
    onUserInteraction,
}) {
    const map = useMap();
    const zoomControlRef = useRef(null);
    const shouldShowZoomButtons = showZoomButtons ?? !enableZooming;

    useEffect(() => {
        setHandlerEnabled(map.dragging, enableDragging);
        requestAnimationFrame(() => {
            map.invalidateSize();
        });
    }, [map, enableDragging]);

    useEffect(() => {
        ZOOM_HANDLER_KEYS.forEach((key) => setHandlerEnabled(map[key], enableZooming));

        if (shouldShowZoomButtons) {
            if (!zoomControlRef.current) {
                if (map.zoomControl) {
                    map.removeControl(map.zoomControl);
                }
                const control = L.control.zoom({position: 'topleft'});
                control.addTo(map);
                zoomControlRef.current = control;
            }
        } else if (zoomControlRef.current) {
            map.removeControl(zoomControlRef.current);
            zoomControlRef.current = null;
        }

        requestAnimationFrame(() => {
            map.invalidateSize();
        });
    }, [map, enableZooming, shouldShowZoomButtons]);

    useEffect(() => {
        return () => {
            if (zoomControlRef.current) {
                map.removeControl(zoomControlRef.current);
                zoomControlRef.current = null;
            }
        };
    }, [map]);

    useEffect(() => {
        if (!onUserInteraction) {
            return undefined;
        }

        const handleDragStart = () => onUserInteraction();
        const handleZoomStart = (event) => {
            if (event?.originalEvent) {
                onUserInteraction();
            }
        };

        map.on('dragstart', handleDragStart);
        map.on('zoomstart', handleZoomStart);

        return () => {
            map.off('dragstart', handleDragStart);
            map.off('zoomstart', handleZoomStart);
        };
    }, [map, onUserInteraction]);

    return null;
}
