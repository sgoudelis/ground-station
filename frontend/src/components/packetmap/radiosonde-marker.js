/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import {divIcon} from 'leaflet';
import balloon from './icons/balloon.svg?raw';
import parachute from './icons/parachute.svg?raw';
import './radiosonde-marker.css';

const minimumClimbRate = 0.3;

export function getFlightPhase(points, verticalSpeed) {
    if (Number.isFinite(verticalSpeed) && Math.abs(verticalSpeed) > minimumClimbRate) {
        return verticalSpeed > 0 ? 'ascending' : 'descending';
    }
    // Scan backward to retain the latest meaningful direction through noisy
    // or level fixes. Missing altitudes must not be mistaken for sea level.
    let later;
    for (let index = points.length - 1; index >= 0; index -= 1) {
        const point = points[index];
        const time = Date.parse(point.captured_at);
        if (!Number.isFinite(point.altitude) || !Number.isFinite(time)) continue;
        if (later) {
            const elapsed = (later.time - time) / 1000;
            if (elapsed <= 0) continue;
            const rate = (later.altitude - point.altitude) / elapsed;
            if (Math.abs(rate) > minimumClimbRate) {
                return rate > 0 ? 'ascending' : 'descending';
            }
        }
        later = {time, altitude: point.altitude};
    }
    return 'unknown';
}

export function markerLift(altitude) {
    const fraction = Number.isFinite(altitude) ? Math.min(1, Math.max(0, altitude) / 35000) : 0;
    return 8 + 36 * Math.sqrt(fraction);
}

export function createRadiosondeIcon({phase, altitude, color}) {
    const lift = markerLift(altitude);
    const height = (lift - 8) / 36;
    const svg = phase === 'descending' ? parachute : balloon;
    return divIcon({
        className: 'packet-radiosonde-marker',
        // The anchor is the shadow's center, so paths always end underneath
        // the floating symbol without changing the received map coordinates.
        iconSize: [40, 40],
        iconAnchor: [20, 20],
        popupAnchor: [0, -lift - 40],
        tooltipAnchor: [0, -lift - 20],
        html: `<div class="packet-radiosonde-content" data-flight-phase="${phase}" style="color:${color};--sonde-lift:${lift}px;--sonde-shadow-opacity:${0.3 + height * 0.22};--sonde-shadow-blur:${1.6 + height * 0.8}px;--sonde-shadow-scale:${1 - height * 0.08}">
            <span class="packet-radiosonde-shadow" aria-hidden="true"></span>
            <span class="packet-radiosonde-symbol" aria-hidden="true">${svg}</span>
        </div>`,
    });
}
