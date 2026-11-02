import {DivIcon} from 'leaflet';
import './aircraft-marker.css';
import {aircraftCountry} from '../../utils/aircraft-country.js';
import {renderAircraftSymbol, selectAircraftShape} from './aircraft-symbol.js';
import {aircraftEmergency, aircraftEmergencyLabel} from '../../utils/aircraft-emergency.js';

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

export function createAircraftIcon({track = 0, name = '', icao, aircraft, squawk, emergency, stale = false} = {}) {
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
        html: `<div class="packet-aircraft-content">${label.outerHTML}<span class="packet-aircraft-symbol">${symbol}</span></div>`,
        shadowHtml: `<span class="packet-aircraft-shadow">${symbol}</span>`,
    });
}
