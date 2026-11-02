import {expect, it} from 'vitest';
import {mergeAircraftHistory} from '../aircraft.js';
import {createAircraftIcon} from '../aircraft-marker.js';
import {renderAircraftSymbol, selectAircraftShape} from '../aircraft-symbol.js';
import collection from '../icons/aircraft.json';

it.each([
    ['A320', 'a320'], ['A21N', 'a321'], ['B738', 'b738'], ['B77W', 'heavy_2e'],
    ['C130', 'c130'], ['F16', 'hi_perf'], ['F35', 'f35'], ['H60', 'blackhawk'],
    ['H47', 'chinook'], ['V22', 'v22_slow'], ['SR22', 'cirrus_sr22'], ['GLID', 'glider'],
])('selects the mapped silhouette for ICAO model %s', (type_code, shape) => {
    // A model match wins even when a broad broadcast category disagrees.
    expect(selectAircraftShape({type_code, category: 'A1'}).name).toBe(shape);
});

it.each([
    [{type_code: 'C172', type_description: 'L1P'}, 'cessna'],
    [{type_description: 'L1T'}, 'single_turbo'],
    [{type_description: 'L2P'}, 'twin_small'],
    [{type_description: 'S2P'}, 'twin_small'],
    [{type_description: 'L2J', wake_category: 'L'}, 'jet_nonswept'],
    [{type_description: 'L2J', wake_category: 'M'}, 'airliner'],
    [{type_description: 'L2J', wake_category: 'H'}, 'heavy_2e'],
    [{type_description: 'L2J', wake_category: 'M', category: 'A2'}, 'jet_swept'],
    [{engine_count: 2, engine_type: 'T'}, 'twin_large'],
    [{aircraft_class: 'H'}, 'helicopter'], [{aircraft_class: 'G'}, 'gyrocopter'],
    [{aircraft_class: 'T'}, 'v22_slow'], [{aircraft_class: 'B'}, 'balloon'],
    [{aircraft_class: 'D'}, 'uav'], [{aircraft_class: 'P'}, 'para'],
    [{category: 'B1'}, 'glider'], [{category: 'B2'}, 'balloon'],
    [{category: 'B3'}, 'cessna'], [{category: 'B4'}, 'tabler-parachute'],
    [{category: 'B6'}, 'uav'], [{category: 'B7'}, 'tabler-rocket'],
    [{category: 'C1'}, 'ground_emergency'], [{category: 'C2'}, 'ground_service'],
    [{category: 'C3'}, 'ground_fixed'], [{category: 'A7'}, 'helicopter'],
])('falls back to available database or broadcast metadata: %j', (metadata, shape) => {
    expect(selectAircraftShape({type_code: 'UNKN', ...metadata}).name).toBe(shape);
});

it('normalizes codes, tolerates missing metadata and never infers a fighter from military flags', () => {
    expect(selectAircraftShape({type_code: ' a20n '}).name).toBe('a320');
    expect(selectAircraftShape({type_description: 'L1J', military_status: 'military'}).name).toBe('jet_nonswept');
    for (const metadata of [null, undefined, {}, {military_status: 'military'},
        {type_code: '<svg onload=alert(1)>', category: 'reserved'},
        {type_code: {}, type_description: [], engine_count: Infinity, category: '__proto__'}]) {
        expect(selectAircraftShape(metadata).name).toBe('unknown');
    }
});

it('renders the whole bundled collection without leaked SVG styles, ids or broken geometry', () => {
    const shapes = [...Object.keys(collection.shapes), ...collection.supplemental.map(({name}) => `tabler-${name}`)];
    for (const name of shapes) {
        const holder = document.createElement('div');
        holder.innerHTML = renderAircraftSymbol({name, scale: 1}, {angle: 90, color: '#66bb6a'});
        expect(holder.querySelector('parsererror'), name).toBeNull();
        expect(holder.querySelector('style, [id]'), name).toBeNull();
        expect(holder.querySelector('path, circle, rect, line, polygon, polyline, ellipse'), name).not.toBeNull();
        expect(holder.innerHTML, name).not.toMatch(/NaN|Infinity|fillColor|strokeColor|strokeWidth|SIZE/);
    }
});

it('keeps fixed artwork upright and preserves model-specific transforms and accents', () => {
    const marker = document.createElement('div');
    marker.innerHTML = createAircraftIcon({track: 90, aircraft: {category: 'B2'}}).options.html;
    expect(marker.querySelector('svg').style.transform).toBe('rotate(0deg)');
    marker.innerHTML = createAircraftIcon({track: 90, aircraft: {category: 'B7'}}).options.html;
    expect(marker.querySelector('svg').style.transform).toBe('rotate(0deg)');
    marker.innerHTML = createAircraftIcon({track: 90, aircraft: {type_code: 'C2'}}).options.html;
    expect(marker.querySelector('g').getAttribute('transform')).toBe(collection.shapes.c2.transform);
    marker.innerHTML = createAircraftIcon({track: 90, aircraft: {type_code: 'C130'}}).options.html;
    expect(marker.querySelector('svg svg')).toHaveAttribute('preserveAspectRatio', 'none');
    marker.innerHTML = createAircraftIcon({track: 90, aircraft: {type_code: 'SHIP'}}).options.html;
    expect(marker.querySelector('path[fill="none"]')).not.toBeNull();
});

it('treats received aircraft labels as text and keeps unknown headings finite', () => {
    const icon = createAircraftIcon({name: '<img src=x onerror=alert(1)>', track: NaN});
    const marker = document.createElement('div');
    marker.innerHTML = icon.options.html;
    expect(marker.querySelector('.packet-aircraft-label').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(marker.querySelector('img')).toBeNull();
    expect(icon.options.html).toContain('rotate(0deg)');
});

it('adds country flags to aircraft labels using ICAO addresses rather than callsigns', () => {
    const marker = document.createElement('div');
    marker.innerHTML = createAircraftIcon({name: 'EWG46A', icao: '4d2406'}).options.html;
    expect(marker.querySelector('.packet-aircraft-label')).toHaveTextContent('🇲🇹 EWG46A');
    expect(marker.querySelector('.packet-aircraft-label').title).toBe('Malta');
    marker.innerHTML = createAircraftIcon({name: '4d2406', icao: '~4d2406'}).options.html;
    expect(marker.querySelector('.packet-aircraft-label').textContent).toBe('4d2406');
});

it('anchors a matching aircraft shadow and updates it when Leaflet replaces the icon', () => {
    const icon = createAircraftIcon({track: 90, name: 'TEST', aircraft: {type_code: 'A320'}});
    const marker = icon.createIcon();
    const shadow = icon.createShadow();
    expect(icon.options.shadowAnchor).toEqual(icon.options.iconAnchor);
    expect(icon.options.shadowSize).toEqual(icon.options.iconSize);
    expect(shadow).toHaveAttribute('aria-hidden', 'true');
    expect(shadow.querySelector('.packet-aircraft-label')).toBeNull();
    expect(marker.querySelector('.packet-aircraft-shadow')).toBeNull();
    expect(shadow.querySelector('svg').outerHTML).toBe(marker.querySelector('svg').outerHTML);

    const next = createAircraftIcon({track: 245, stale: true, aircraft: {type_code: 'H60'}});
    expect(next.createShadow(shadow)).toBe(shadow);
    expect(shadow.querySelectorAll('[data-aircraft-shape]')).toHaveLength(1);
    expect(shadow.querySelector('svg')).toHaveAttribute('data-aircraft-shape', 'blackhawk');
    expect(shadow.querySelector('svg').style.transform).toBe('rotate(245deg)');
    expect(shadow.querySelector('svg').outerHTML).toBe(next.createIcon().querySelector('svg').outerHTML);
    expect(shadow).toHaveClass('packet-marker-stale');
    expect(shadow.querySelector('path[fill]')).toHaveAttribute('fill', '#9e9e9e');
});

it('merges new aircraft fixes without duplicating saved coordinates or changing other protocols', () => {
    const stamp = Date.parse('2026-11-01T12:00:00Z');
    const point = {id: 'saved', kind: 'adsb', transmitter_id: 'adsb:406b90', captured_at: new Date(stamp).toISOString()};
    const sonde = {id: 'sonde', kind: 'radiosonde'};
    const record = {icao: '406b90', timestamp: stamp / 1000, position_timestamp: stamp / 1000,
        latitude: 40, longitude: 23, altitude_baro_m: 1000, callsign: 'TEST', aircraft: {type_code: 'A320'}};
    const merged = mergeAircraftHistory([point, sonde], [], {aircraft: [record], positions: [record]},
        {start: '2026-11-01T00:00:00Z', end: null});
    expect(merged.positions).toHaveLength(2);
    expect(merged.positions[0]).toBe(sonde);
    expect(merged.transmitters[0]).toMatchObject({id: 'adsb:406b90', name: 'TEST', altitude: 1000});
    expect(merged.positions[1].aircraft).toEqual({type_code: 'A320'});
});

it('historical playback never receives live positions', () => {
    const positions = [];
    const merged = mergeAircraftHistory(positions, [], {aircraft: [{}], positions: [{}]}, {end: '2026-11-01T00:00:00Z'});
    expect(merged.positions).toBe(positions);
});
