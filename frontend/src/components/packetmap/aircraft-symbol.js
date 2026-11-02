// Artwork and ICAO mappings: tar1090 (GPL-2.0-or-later; C130: CC BY 4.0,
// Peter Lowden) and Tabler (MIT, Paweł Kuna). See /aircraft-icon-preview/NOTICE.md.
import collection from './icons/aircraft.json';

const normalized = (value) => typeof value === 'string' ? value.trim().toUpperCase() : '';
const lookup = (table, key) => Object.hasOwn(table, key) ? table[key] : null;
const descriptionIcons = {
    ...collection.typeDescriptions,
    // A single jet engine does not establish that an aircraft is a fighter.
    L1J: ['jet_nonswept', 1],
};
const classIcons = {
    H: 'helicopter', G: 'gyrocopter', T: 'v22_slow', V: 'v22_slow',
    B: 'balloon', D: 'uav', P: 'para',
};
const categoryIcons = {
    A1: 'cessna', A2: 'jet_swept', A3: 'airliner', A4: 'airliner',
    A5: 'heavy_2e', A6: 'hi_perf', A7: 'helicopter',
    B1: 'glider', B2: 'balloon', B3: 'cessna', B4: 'tabler-parachute',
    B6: 'uav', B7: 'tabler-rocket',
    C0: 'ground_unknown', C1: 'ground_emergency', C2: 'ground_service',
    C3: 'ground_fixed', C4: 'ground_fixed', C5: 'ground_fixed',
};
const supplementalShapes = Object.fromEntries(collection.supplemental.map(({name, svg}) => [
    `tabler-${name}`, {w: 24, h: 24, svg, noRotate: true, outline: true},
]));

/** Prefer a known ICAO model, then database class/engines, then broadcast category. */
export function selectAircraftShape(aircraft) {
    const metadata = aircraft && typeof aircraft === 'object' ? aircraft : {};
    let match = lookup(collection.typeDesignators, normalized(metadata.type_code));
    if (match) return {name: match[0], scale: match[1]};

    const description = normalized(metadata.type_description);
    const aircraftClass = normalized(metadata.aircraft_class) || description.charAt(0);
    const classIcon = lookup(classIcons, aircraftClass);
    if (classIcon) return {name: classIcon, scale: 1};

    const category = normalized(metadata.category);
    const wake = normalized(metadata.wake_category);
    // Seaplanes share the corresponding engine-based silhouette; the collection
    // has no floatplane artwork. Keep amphibian-specific mappings where present.
    const planeDescription = description.replace(/^S/, 'L');
    if (planeDescription === 'L2J' && wake === 'M' && category === 'A2') {
        return {name: 'jet_swept', scale: 1};
    }
    match = lookup(descriptionIcons, `${planeDescription}-${wake}`) || lookup(descriptionIcons, planeDescription);
    if (match) return {name: match[0], scale: match[1]};

    const engines = Number.isInteger(metadata.engine_count) ? metadata.engine_count
        : /^[LSA][0-9][A-Z-]$/.test(description) ? Number(description[1]) : null;
    const engineType = normalized(metadata.engine_type) || description.charAt(2);
    if (engines > 0 && engines <= 8) {
        if (engineType === 'J') {
            return {name: engines >= 4 ? 'heavy_4e' : engines === 3 ? 'md11' : 'jet_nonswept', scale: 1};
        }
        if (engineType === 'P' || engineType === 'T' || engineType === 'E') {
            return {name: engines === 1 ? (engineType === 'T' ? 'single_turbo' : 'cessna')
                : engines === 2 && engineType !== 'T' ? 'twin_small' : 'twin_large', scale: 1};
        }
    }
    if (engines === 0 && ['L', 'S', 'A'].includes(aircraftClass)) return {name: 'glider', scale: 1};
    // Neither military flags, callsigns nor registrations identify an airframe.
    return {name: lookup(categoryIcons, category) || 'unknown', scale: 1};
}

const namespace = 'http://www.w3.org/2000/svg';
function svgElement(tag, attributes) {
    const element = document.createElementNS(namespace, tag);
    Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
    return element;
}

/** Render only locally bundled artwork. Received metadata never becomes SVG markup. */
export function renderAircraftSymbol({name, scale}, {angle, color}) {
    const shape = lookup(collection.shapes, name) || lookup(supplementalShapes, name) || collection.shapes.unknown;
    const strokeWidth = 0.65 * (shape.strokeScale || 1);
    let artwork;
    if (shape.svg) {
        const source = shape.svg.replaceAll('SIZE', `width="${shape.w}" height="${shape.h}"`)
            .replaceAll('fillColor', color).replaceAll('strokeColor', '#17211a').replaceAll('strokeWidth', strokeWidth);
        artwork = new DOMParser().parseFromString(source, 'image/svg+xml').documentElement;
        // Ground-vehicle templates contain generic class names. Inline their
        // rules to prevent one marker's SVG styles from recoloring other icons.
        for (const style of artwork.querySelectorAll('style')) {
            for (const rule of style.textContent.matchAll(/([^{}]+)\{([^{}]+)\}/g)) {
                for (const element of artwork.querySelectorAll(rule[1].trim())) element.setAttribute('style', rule[2]);
            }
            style.remove();
        }
        for (const element of artwork.querySelectorAll('[id]')) element.removeAttribute('id');
        if (shape.outline) artwork.setAttribute('stroke', color);
    } else {
        artwork = svgElement('svg', {viewBox: shape.viewBox});
        if (shape.noAspect) artwork.setAttribute('preserveAspectRatio', 'none');
        const group = svgElement('g', shape.transform ? {transform: shape.transform} : {});
        for (const path of shape.path ? [shape.path].flat() : []) {
            group.append(svgElement('path', {d: path, fill: color, stroke: '#17211a',
                'stroke-width': strokeWidth * 2, 'paint-order': 'stroke'}));
        }
        for (const path of shape.accent ? [shape.accent].flat() : []) {
            group.append(svgElement('path', {d: path, fill: 'none', stroke: '#17211a',
                'stroke-width': strokeWidth * 0.6 * (shape.accentMult || 1)}));
        }
        artwork.append(group);
    }
    // Center every source aspect ratio in the same Leaflet box, and rotate the
    // whole box so tall, wide and transformed silhouettes share a stable anchor.
    const factor = 28 * scale / Math.max(shape.w, shape.h);
    const width = shape.w * factor;
    const height = shape.h * factor;
    const symbol = svgElement('svg', {width: 28, height: 28, viewBox: '0 0 28 28',
        'aria-hidden': 'true', 'data-aircraft-shape': name});
    symbol.style.transform = `rotate(${shape.noRotate ? 0 : angle}deg)`;
    symbol.style.overflow = 'visible';
    for (const [key, value] of Object.entries({width, height, x: (28 - width) / 2, y: (28 - height) / 2})) {
        artwork.setAttribute(key, value);
    }
    symbol.append(artwork);
    return symbol.outerHTML;
}
