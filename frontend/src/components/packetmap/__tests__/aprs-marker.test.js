import {describe, expect, it} from 'vitest';
import {createAprsIcon, getAprsSymbol} from '../aprs-marker.js';
import {createRadiosondeIcon} from '../radiosonde-marker.js';

const position = (symbol_table, symbol_code) => ({symbol_table, symbol_code});

describe('APRS station symbols', () => {
    it.each([
        ['>', 'Car', 'mobile'], ['[', 'Person', 'portable'], ['-', 'House', 'fixed'], ['k', 'Truck', 'mobile'],
        ['<', 'Motorcycle', 'mobile'], ['^', 'Aircraft', 'airborne'], ['_', 'Weather station', 'weather'],
        ['s', 'Ship', 'marine'], ['#', 'Digipeater', 'digipeater'], ['&', 'Gateway', 'igate'],
        ['L', 'Computer station', 'telemetry'], ['h', 'Hospital', 'object'],
    ])('renders the primary %s symbol as %s with its supplied PNG', (code, label, image) => {
        const marker = createAprsIcon({position: position('/', code), name: 'TEST-1'});
        const icon = marker.createIcon();
        expect(icon.querySelector('[role="img"]').getAttribute('aria-label')).toBe(label);
        expect(icon.querySelector('img').getAttribute('src')).toContain(`/aprs/${image}.png`);
        expect(marker.options.iconAnchor).toEqual([marker.options.iconSize[0] / 2, marker.options.iconSize[1]]);
        expect(icon.querySelector('.packet-aprs-label').textContent).toBe('TEST-1');
    });

    it('distinguishes primary symbols, alternate symbols and overlays', () => {
        expect(getAprsSymbol(position('/', '[')).label).toBe('Person');
        expect(getAprsSymbol(position('\\', '[')).label).toBe('Wall cloud');
        expect(getAprsSymbol(position('H', '['))).toMatchObject({label: 'Person', overlay: 'H'});
        expect(getAprsSymbol(position('\\', 'O'))).toMatchObject({label: 'Rocket', balloon: false});
        expect(getAprsSymbol(position('W', 'O'))).toMatchObject({label: 'Balloon', balloon: true});
        expect(getAprsSymbol(position('\\', 'b'))).toBeNull();
        expect(getAprsSymbol(position('/', 'b')).label).toBe('Bicycle');
        const icon = createAprsIcon({position: position('3', '>')}).createIcon();
        expect(icon.querySelector('.packet-aprs-overlay').textContent).toBe('3');
        expect(getAprsSymbol(position('d', '>'))).toMatchObject({label: 'Vehicle', overlay: '3'});
    });

    it('reuses the weather balloon marker, including the descent phase', () => {
        for (const phase of ['ascending', 'descending', 'unknown']) {
            const options = {name: 'BALLOON', altitude: 12000, phase};
            expect(createAprsIcon({...options, position: position('/', 'O')}).options)
                .toEqual(createRadiosondeIcon(options).options);
        }
    });

    it('leaves missing, unsupported and malformed symbols as generic markers', () => {
        for (const value of [undefined, {}, position('/', 'z'), position('/', '<img>'), position('<', '>')]) {
            expect(createAprsIcon({position: value})).toBeNull();
        }
    });

    it.each([
        [{object: {name: 'EVENT'}}, 'object'],
        [{item: {name: 'ASSET'}}, 'object'],
        [{telemetry: {channels: [1, 2]}}, 'telemetry'],
        [{weather: {temperature_fahrenheit: 70}}, 'weather'],
    ])('uses report metadata for an unrecognized symbol: %j', (report, image) => {
        const icon = createAprsIcon({position: position('/', 'z'), report}).createIcon();
        expect(icon.querySelector('img').getAttribute('src')).toContain(`/aprs/${image}.png`);
        // Latest report metadata must not replace an explicit historical position symbol.
        const recognized = createAprsIcon({position: position('/', '>'), report}).createIcon();
        expect(recognized.querySelector('img').getAttribute('src')).toContain('/aprs/mobile.png');
    });

    it('keeps received names as text in marker HTML', () => {
        const name = '<img src=x onerror="alert(1)">';
        const icon = createAprsIcon({position: position('/', '>'), name}).createIcon();
        expect(icon.querySelectorAll('img')).toHaveLength(1);
        expect(icon.querySelector('img').getAttribute('src')).toContain('/aprs/mobile.png');
        expect(icon.querySelector('img')).not.toHaveAttribute('onerror');
        expect(icon.querySelector('.packet-aprs-label').textContent).toBe(name);
    });
});
