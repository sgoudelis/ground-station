import {MarkerArtwork} from './marker-artwork.js';
import './aircraft-marker.css';
import {aircraftCountry} from '../../utils/aircraft-country.js';
import {aircraftSymbolRotation, renderAircraftSymbol, selectAircraftShape} from './aircraft-symbol.js';
import {aircraftColor, aircraftEmergency, aircraftEmergencyLabel} from '../../utils/aircraft-emergency.js';
import {aircraftSelectionCrosshair as selectionCrosshair} from './selection-crosshair.js';

const maximumLift = 24;
const maximumLiftAltitude = 12000;

class AircraftIcon extends MarkerArtwork {
    updateSymbol(holder) {
        // Heading updates only rotate the existing SVG. Reparse artwork only
        // when the silhouette, scale or status color actually changes.
        if (holder.dataset.symbolKey !== this.options.symbolKey) {
            holder.innerHTML = this.options.symbolHtml;
            holder.dataset.symbolKey = this.options.symbolKey;
        } else if (holder.firstElementChild.style.transform !== this.options.rotation) {
            holder.firstElementChild.style.transform = this.options.rotation;
        }
    }

    createIcon(oldIcon) {
        const content = oldIcon?.querySelector('.packet-aircraft-content');
        if (!content) {
            const icon = super.createIcon(oldIcon);
            icon.querySelector('.packet-aircraft-symbol').dataset.symbolKey = this.options.symbolKey;
            return icon;
        }

        // Keep the previous label and SVG nodes for each received fix.
        content.style.setProperty('--aircraft-lift', `${this.options.lift}px`);
        const label = content.querySelector('.packet-aircraft-label');
        if (label.textContent !== this.options.labelText) label.textContent = this.options.labelText;
        if (label.title !== this.options.labelTitle) label.title = this.options.labelTitle;
        this.updateSymbol(content.querySelector('.packet-aircraft-symbol'));
        content.classList.toggle('packet-aircraft-selected', this.options.selected);
        const crosshair = content.querySelector('.packet-aircraft-crosshair');
        if (this.options.selected && !crosshair) content.insertAdjacentHTML('beforeend', selectionCrosshair);
        else if (!this.options.selected && crosshair) crosshair.remove();
        this.styleElement(oldIcon, 'icon');
        return oldIcon;
    }

    // Update the shadow artwork independently from the raised symbol.
    createShadow(oldShadow) {
        const shadow = oldShadow?.tagName === 'DIV' ? oldShadow : document.createElement('div');
        if (!shadow.firstElementChild?.classList.contains('packet-aircraft-shadow')) {
            shadow.innerHTML = this.options.shadowHtml;
            shadow.firstElementChild.dataset.symbolKey = this.options.symbolKey;
        }
        this.updateSymbol(shadow.firstElementChild);
        shadow.setAttribute('aria-hidden', 'true');
        this.styleElement(shadow, 'shadow');
        return shadow;
    }
}

export function createAircraftIcon({track = 0, altitude, onGround, name = '', icao, aircraft, shape = selectAircraftShape(aircraft), squawk, emergency, stale = false, selected = false, normalColor} = {}) {
    const angle = Number.isFinite(track) ? track : 0;
    // Emphasize low-altitude changes while keeping the symbol near its ground
    // position. Explicit ground status overrides altitude above sea level.
    const lift = onGround === true ? 0 : Number.isFinite(altitude)
        ? maximumLift * Math.sqrt(Math.min(1, Math.max(0, altitude) / maximumLiftAltitude)) : 12;
    const status = aircraftEmergency({squawk, emergency});
    const color = aircraftColor(status, stale, normalColor);
    // Callsigns come from received messages. Escape them before using the
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
    const symbol = renderAircraftSymbol(shape, {angle, color});
    return new AircraftIcon({
        className: `packet-aircraft-marker${stale ? ' packet-marker-stale' : ''}`,
        iconSize: [28, 28], iconAnchor: [14, 14],
        shadowSize: [28, 28], shadowAnchor: [14, 14],
        symbolKey: JSON.stringify([shape.name, shape.scale, color]),
        symbolHtml: symbol,
        rotation: aircraftSymbolRotation(shape, angle),
        labelText: label.textContent,
        labelTitle: label.title,
        selected,
        lift,
        html: `<div class="packet-aircraft-content${selected ? ' packet-aircraft-selected' : ''}" style="--aircraft-lift:${lift}px;">${label.outerHTML}<span class="packet-aircraft-symbol">${symbol}</span>${selected ? selectionCrosshair : ''}</div>`,
        shadowHtml: `<span class="packet-aircraft-shadow">${symbol}</span>`,
    });
}
