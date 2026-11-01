/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import {DivIcon} from 'leaflet';
import balloon from './icons/balloon.png';
import parachute from './icons/parachute.png';
import './radiosonde-marker.css';

const minimumClimbRate = 0.3;
const markerSize = 80;
const minimumLift = 4;
const liftRange = 18;

class RadiosondeIcon extends DivIcon {
    // Use Leaflet's shadow lifecycle to keep the ground shadow in its own pane
    // while moving, zooming, replacing icons, and removing markers.
    createShadow(oldShadow) {
        const shadow = oldShadow?.tagName === 'DIV' ? oldShadow : document.createElement('div');
        shadow.innerHTML = this.options.shadowHtml;
        shadow.setAttribute('aria-hidden', 'true');
        this._setIconStyles(shadow, 'shadow');
        return shadow;
    }
}

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
    return minimumLift + liftRange * Math.sqrt(fraction);
}

export function createRadiosondeIcon({phase, altitude, name}) {
    const lift = markerLift(altitude);
    // Keep shadow changes normalized when adjusting the lift's pixel range.
    const height = (lift - minimumLift) / liftRange;
    const image = phase === 'descending' ? parachute : balloon;
    // Treat received names as text before inserting them into Leaflet's HTML.
    const label = document.createElement('span');
    label.className = 'packet-radiosonde-label';
    label.textContent = name ?? '';
    return new RadiosondeIcon({
        className: 'packet-radiosonde-marker',
        // The anchor is the shadow's center, so paths always end underneath
        // the floating symbol without changing the received map coordinates.
        iconSize: [markerSize, markerSize],
        iconAnchor: [markerSize / 2, markerSize / 2],
        shadowSize: [markerSize, markerSize],
        shadowAnchor: [markerSize / 2, markerSize / 2],
        popupAnchor: [0, -lift - markerSize],
        html: `<div class="packet-radiosonde-content" data-flight-phase="${phase}" style="--sonde-lift:${lift}px;">
            ${label.outerHTML}
            <span class="packet-radiosonde-symbol" aria-hidden="true"><img src="${image}" width="${markerSize}" height="${markerSize}" alt="" draggable="false" /></span>
        </div>`,
        shadowHtml: `<div class="packet-radiosonde-content" style="--sonde-shadow-opacity:${0.55 + height * 0.2};--sonde-shadow-blur:${0.4 + height * 0.2}px;--sonde-shadow-scale:${1 - height * 0.08}">
            <span class="packet-radiosonde-shadow"></span>
        </div>`,
    });
}
