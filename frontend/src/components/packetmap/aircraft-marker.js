import {DivIcon} from 'leaflet';
import './aircraft-marker.css';
import {aircraftCountry} from '../../utils/aircraft-country.js';
import {renderAircraftSymbol, selectAircraftShape} from './aircraft-symbol.js';
import {aircraftEmergency, aircraftEmergencyLabel} from '../../utils/aircraft-emergency.js';

// Raise the reticle with the plane, outside the silhouette's rotation and stale filters.
const selectionCrosshair = `<svg class="packet-aircraft-crosshair" viewBox="0 0 52 52" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1">
    <rect x="6" y="6" width="40" height="40" />
    <path d="M26 1V11 M26 41V51 M1 26H11 M41 26H51" />
</svg>`;

class AircraftIcon extends DivIcon {
    // Let Leaflet move, replace and remove the ground shadow in its shadow pane.
    createShadow(oldShadow) {
        const shadow = oldShadow?.tagName === 'DIV' ? oldShadow : document.createElement('div');
        shadow.innerHTML = this.options.shadowHtml;
        shadow.setAttribute('aria-hidden', 'true');
        this._setIconStyles(shadow, 'shadow');
        return shadow;
    }
}

export function createAircraftIcon({track = 0, name = '', icao, aircraft, squawk, emergency, stale = false, selected = false} = {}) {
    const angle = Number.isFinite(track) ? track : 0;
    const status = aircraftEmergency({squawk, emergency});
    const color = stale ? '#9e9e9e' : status?.color ?? '#66bb6a';
    // Callsigns come from received messages. Escape them before using Leaflet's
    // HTML icon, and keep the label outside the rotating aircraft symbol.
    const label = document.createElement('span');
    label.className = 'packet-aircraft-label';
    const country = aircraftCountry(icao);
    label.textContent = country ? `${country.flag} ${name}` : name;
    if (country) label.title = country.name;
    if (status) {
        const code = status.emergencySquawk ? status.squawk : 'Alert';
        label.textContent += ` · ${code}`;
        label.title = `${stale ? 'Last reported status' : 'Reported status'}: ${aircraftEmergencyLabel(status)}`;
    }
    // Reuse the exact rendered symbol for both layers, so future silhouettes
    // and heading updates cannot leave a different aircraft shape on the ground.
    const symbol = renderAircraftSymbol(selectAircraftShape(aircraft), {angle, color});
    return new AircraftIcon({
        className: `packet-aircraft-marker${stale ? ' packet-marker-stale' : ''}`,
        iconSize: [28, 28], iconAnchor: [14, 14],
        shadowSize: [28, 28], shadowAnchor: [14, 14],
        html: `<div class="packet-aircraft-content${selected ? ' packet-aircraft-selected' : ''}">${label.outerHTML}<span class="packet-aircraft-symbol">${symbol}</span>${selected ? selectionCrosshair : ''}</div>`,
        shadowHtml: `<span class="packet-aircraft-shadow">${symbol}</span>`,
    });
}
