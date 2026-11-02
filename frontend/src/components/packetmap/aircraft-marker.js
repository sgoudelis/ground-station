import {DivIcon} from 'leaflet';
import './aircraft-marker.css';
import {aircraftCountry} from '../../utils/aircraft-country.js';

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
    // Reuse the exact rendered symbol for both layers, so future silhouettes
    // and heading updates cannot leave a different aircraft shape on the ground.
    const symbol = `<svg width="28" height="28" viewBox="-14 -14 28 28" style="transform:rotate(${angle}deg)" aria-hidden="true">
        <path d="M0-12 2-3 11 3 11 5 2 2 2 8 5 10 5 12 0 10-5 12-5 10-2 8-2 2-11 5-11 3-2-3Z"
            fill="${color}" stroke="#17211a" stroke-width="1"/></svg>`;
    return new AircraftIcon({
        className: `packet-aircraft-marker${stale ? ' packet-marker-stale' : ''}`,
        iconSize: [28, 28], iconAnchor: [14, 14],
        shadowSize: [28, 28], shadowAnchor: [14, 14],
        html: `<div class="packet-aircraft-content">${label.outerHTML}<span class="packet-aircraft-symbol">${symbol}</span></div>`,
        shadowHtml: `<span class="packet-aircraft-shadow">${symbol}</span>`,
    });
}
