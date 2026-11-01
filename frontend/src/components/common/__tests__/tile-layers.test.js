import {beforeEach, describe, expect, it, vi} from 'vitest';
import {store} from '../store.jsx';
import {getMapLibreTileURL, getTileLayerById} from '../tile-layers.jsx';

vi.mock('../store.jsx', () => ({store: {getState: vi.fn()}}));

const t = (_key, options) => options.defaultValue;
const cartoPreferences = (value) => [{name: 'carto_maps_api_key', value}];

describe('CARTO tile credentials', () => {
    beforeEach(() => {
        store.getState.mockReturnValue({preferences: {preferences: []}});
    });

    it.each([
        ['cartodark', 'dark_all'],
        ['cartodbvoyager', 'rastertiles/voyager'],
    ])('uses the CARTO key parameter for %s in both map engines and encodes the key', (id, path) => {
        const options = {t, preferences: cartoPreferences('  key+/=&?  ')};
        expect(getTileLayerById(id, options).url).toBe(
            `https://{s}.basemaps.cartocdn.com/${path}/{z}/{x}/{y}{r}.png?key=key%2B%2F%3D%26%3F`
        );
        expect(getMapLibreTileURL(id, {...options, mapEngine: 'maplibre'})).toBe(
            `https://a.basemaps.cartocdn.com/${path}/{z}/{x}/{y}.png?key=key%2B%2F%3D%26%3F`
        );
    });

    it.each([
        {preferences: []},
        {preferences: cartoPreferences('')},
        {preferences: cartoPreferences('   ')},
    ])(
        'keeps public URLs when the key is absent or blank: $preferences',
        ({preferences}) => {
            expect(getTileLayerById('cartodark', {t, preferences}).url).toBe(
                'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
            );
            expect(getMapLibreTileURL('cartodbvoyager', {t, preferences})).toBe(
                'https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png'
            );
        }
    );

    it('uses saved preferences and drops credentials after the key is cleared', () => {
        store.getState.mockReturnValue({preferences: {preferences: cartoPreferences('saved-key')}});
        expect(getTileLayerById('cartodark', {t}).url).toContain('?key=saved-key');
        store.getState.mockReturnValue({preferences: {preferences: cartoPreferences('')}});
        expect(getTileLayerById('cartodark', {t}).url).not.toContain('?');
    });

    it('keeps the CARTO key separate from Stadia and other providers', () => {
        const preferences = [...cartoPreferences('carto-key'), {name: 'stadia_maps_api_key', value: 'stadia-key'}];
        expect(getTileLayerById('stadiadark', {t, preferences}).url).toContain('?api_key=stadia-key');
        expect(getTileLayerById('osm', {t, preferences}).url).toBe(
            'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
        );
    });
});
