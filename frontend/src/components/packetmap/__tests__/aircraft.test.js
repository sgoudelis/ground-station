import {expect, it} from 'vitest';
import {mergeAircraftHistory} from '../aircraft.js';
import {createAircraftIcon} from '../aircraft-marker.js';

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

it('merges new aircraft fixes without duplicating saved coordinates or changing other protocols', () => {
    const stamp = Date.parse('2026-11-01T12:00:00Z');
    const point = {id: 'saved', kind: 'adsb', transmitter_id: 'adsb:406b90', captured_at: new Date(stamp).toISOString()};
    const sonde = {id: 'sonde', kind: 'radiosonde'};
    const record = {icao: '406b90', timestamp: stamp / 1000, position_timestamp: stamp / 1000,
        latitude: 40, longitude: 23, altitude_baro_m: 1000, callsign: 'TEST'};
    const merged = mergeAircraftHistory([point, sonde], [], {aircraft: [record], positions: [record]},
        {start: '2026-11-01T00:00:00Z', end: null});
    expect(merged.positions).toHaveLength(2);
    expect(merged.positions[0]).toBe(sonde);
    expect(merged.transmitters[0]).toMatchObject({id: 'adsb:406b90', name: 'TEST', altitude: 1000});
});

it('historical playback never receives live positions', () => {
    const positions = [];
    const merged = mergeAircraftHistory(positions, [], {aircraft: [{}], positions: [{}]}, {end: '2026-11-01T00:00:00Z'});
    expect(merged.positions).toBe(positions);
});
