import {divIcon} from 'leaflet';
import './aircraft-marker.css';
import {aircraftCountry} from '../../utils/aircraft-country.js';

export function createAircraftIcon({track = 0, name = '', icao, stale = false} = {}) {
    const angle = Number.isFinite(track) ? track : 0;
    const color = stale ? '#9e9e9e' : '#66bb6a';
    // Callsigns come from received messages. Escape them before using Leaflet's
    // HTML icon, and keep the label outside the rotating aircraft symbol.
    const label = document.createElement('span');
    label.className = 'packet-aircraft-label';
    const country = aircraftCountry(icao);
    label.textContent = country ? `${country.flag} ${name}` : name;
    if (country) label.title = country.name;
    return divIcon({
        className: `packet-aircraft-marker${stale ? ' packet-marker-stale' : ''}`,
        iconSize: [28, 28], iconAnchor: [14, 14],
        html: `${label.outerHTML}<svg width="28" height="28" viewBox="-14 -14 28 28" style="transform:rotate(${angle}deg)" aria-hidden="true">
            <path d="M0-12 2-3 11 3 11 5 2 2 2 8 5 10 5 12 0 10-5 12-5 10-2 8-2 2-11 5-11 3-2-3Z"
                fill="${color}" stroke="#17211a" stroke-width="1"/></svg>`,
    });
}
