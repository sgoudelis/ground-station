/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import {DivIcon} from 'leaflet';
import fixedPin from './icons/aprs/fixed.png';
import mobilePin from './icons/aprs/mobile.png';
import portablePin from './icons/aprs/portable.png';
import marinePin from './icons/aprs/marine.png';
import airbornePin from './icons/aprs/airborne.png';
import weatherPin from './icons/aprs/weather.png';
import telemetryPin from './icons/aprs/telemetry.png';
import digipeaterPin from './icons/aprs/digipeater.png';
import igatePin from './icons/aprs/igate.png';
import objectPin from './icons/aprs/object.png';
import {createRadiosondeIcon} from './radiosonde-marker.js';
import './aprs-marker.css';

// APRS symbol pairs: https://www.aprs.org/symbols/symbolsX.txt
// The table matters: the same code can describe completely different things.
const primarySymbols = {
    '#': ['Digipeater', digipeaterPin],
    '&': ['Gateway', igatePin],
    "'": ['Aircraft', airbornePin],
    '(': ['Mobile satellite station', igatePin],
    '-': ['House', fixedPin],
    ';': ['Portable station', portablePin],
    '<': ['Motorcycle', mobilePin],
    '>': ['Car', mobilePin],
    F: ['Farm vehicle', mobilePin],
    L: ['Computer station', telemetryPin],
    O: ['Balloon', null],
    R: ['Recreational vehicle', mobilePin],
    U: ['Bus', mobilePin],
    W: ['Weather service', weatherPin],
    X: ['Helicopter', airbornePin],
    Y: ['Sailboat', marinePin],
    '[': ['Person', portablePin],
    '^': ['Aircraft', airbornePin],
    _: ['Weather station', weatherPin],
    '`': ['Dish antenna', fixedPin],
    a: ['Ambulance', mobilePin],
    b: ['Bicycle', mobilePin],
    g: ['Glider', airbornePin],
    h: ['Hospital', objectPin],
    j: ['Jeep', mobilePin],
    k: ['Truck', mobilePin],
    l: ['Laptop', telemetryPin],
    m: ['Repeater', digipeaterPin],
    r: ['Repeater', digipeaterPin],
    s: ['Ship', marinePin],
    u: ['Truck', mobilePin],
    v: ['Van', mobilePin],
    y: ['Home antenna', fixedPin],
};

const alternateSymbols = {
    '!': ['Emergency', objectPin],
    '#': ['Digipeater', digipeaterPin],
    '&': ['Gateway', igatePin],
    '(': ['Cloud', weatherPin],
    '-': ['House', fixedPin],
    ';': ['Portable station', portablePin],
    '>': ['Vehicle', mobilePin],
    O: ['Rocket', airbornePin],
    S: ['Satellite', airbornePin],
    W: ['Weather service', weatherPin],
    '[': ['Wall cloud', weatherPin],
    '^': ['Aircraft', airbornePin],
    _: ['Weather station', weatherPin],
    k: ['Special vehicle', mobilePin],
    s: ['Ship', marinePin],
    u: ['Truck', mobilePin],
    v: ['Van', mobilePin],
    z: ['Shelter', fixedPin],
};

export function getAprsSymbol(position) {
    const table = position?.symbol_table;
    const code = position?.symbol_code;
    if (typeof table !== 'string' || typeof code !== 'string' || code.length !== 1) return null;
    // Compressed reports encode numeric overlays 0–9 as a–j.
    const overlay = /^[0-9A-Z]$/.test(table) ? table
        : /^[a-j]$/.test(table) ? String(table.charCodeAt(0) - 97) : '';
    const symbols = table === '/' ? primarySymbols : table === '\\' || overlay ? alternateSymbols : null;
    let symbol = symbols?.[code];
    // These overlay families change the base symbol's meaning.
    if (code === '[' && /^[BRHS]$/.test(overlay)) symbol = ['Person', portablePin];
    if (code === 'O' && /^[BMTCRW]$/.test(overlay)) symbol = ['Balloon', null];
    if (!symbol) return null;
    const [label, image] = symbol;
    return {label, image, overlay, balloon: label === 'Balloon'};
}

export function createAprsIcon({position, report, phase, altitude, name}) {
    let symbol = getAprsSymbol(position);
    // A packet's category can identify a pin when its symbol is unknown.
    // Recognized per-fix symbols still take precedence during playback.
    if (!symbol) {
        if (report?.object || report?.item) symbol = {label: 'Object/item', image: objectPin};
        else if (report?.telemetry) symbol = {label: 'Telemetry', image: telemetryPin};
        else if (report?.weather) symbol = {label: 'Weather station', image: weatherPin};
    }
    // Unclassified positions retain the map's generic APRS circle.
    if (!symbol) return null;
    if (symbol.balloon) return createRadiosondeIcon({phase, altitude, name});

    // Received station names are untrusted text, never HTML.
    const label = document.createElement('span');
    label.className = 'packet-aprs-label';
    label.textContent = name ?? '';
    const image = document.createElement('img');
    image.src = symbol.image;
    image.alt = '';
    image.draggable = false;
    return new DivIcon({
        className: 'packet-aprs-marker',
        // Anchor the tip of each pin to the received position, rather than its center.
        iconSize: [40, 45],
        iconAnchor: [20, 45],
        html: `${label.outerHTML}<span class="packet-aprs-symbol" role="img" aria-label="${symbol.label}">${image.outerHTML}</span>`
            + (symbol.overlay ? `<span class="packet-aprs-overlay">${symbol.overlay}</span>` : ''),
    });
}
