import {configureStore} from '@reduxjs/toolkit';
import { describe, expect, it, vi } from 'vitest';

import satelliteReducer, {
    DEFAULT_CATALOG_SORT_MODEL,
    fetchSatellite,
    fetchSatelliteCatalogStats,
    fetchSatelliteGroups,
    searchSatellites,
    setCatalogSortModel,
    submitOrEditSatellite,
} from './satellite-slice.jsx';
import groupsReducer, {
    AddOrEditSatelliteGroup,
    deleteSatelliteGroups,
    setDeleteConfirmDialogOpen,
} from './groups-slice.jsx';
import sourcesReducer, {
    deleteOrbitalSources,
    fetchOrbitalSources,
    setFormValues,
} from './sources-slice.jsx';

describe('satellite state slices', () => {
    it('keeps catalog controls loading until the search settles despite group responses', () => {
        let state = satelliteReducer(undefined, { type: '@@INIT' });
        expect(state.catalogLoading).toBe(true);

        state = satelliteReducer(state, fetchSatelliteGroups.fulfilled([], 'groups'));
        expect(state.catalogLoading).toBe(true);

        state = satelliteReducer(state, searchSatellites.pending('catalog'));
        state = satelliteReducer(state, fetchSatelliteGroups.fulfilled([], 'groups-refresh'));
        expect(state.catalogLoading).toBe(true);

        state = satelliteReducer(state, searchSatellites.fulfilled({items: [], total: 0}, 'catalog'));
        expect(state.catalogLoading).toBe(false);

        // A failed refresh must also release the controls so the operator can recover.
        state = satelliteReducer(state, searchSatellites.pending('refresh'));
        expect(state.catalogLoading).toBe(true);
        state = satelliteReducer(state, searchSatellites.rejected(new Error('Offline'), 'refresh'));
        expect(state.catalogLoading).toBe(false);
    });

    it('defaults catalog sorting to bands and stores user sort changes', () => {
        let state = satelliteReducer(undefined, { type: '@@INIT' });
        expect(state.catalogSortModel).toEqual(DEFAULT_CATALOG_SORT_MODEL);

        state = satelliteReducer(state, setCatalogSortModel([{field: 'name', sort: 'asc'}]));

        expect(state.catalogSortModel).toEqual([{field: 'name', sort: 'asc'}]);
    });

    it('loads a satellite with its transmitters and replaces saved satellite rows', () => {
        let state = satelliteReducer(undefined, { type: '@@INIT' });
        state = satelliteReducer(state, fetchSatellite.pending('request'));
        state = satelliteReducer(state, fetchSatellite.fulfilled({
            details: { id: 'sat-1', name: 'NOAA 19' },
            position: { lat: 12.5 },
            transmitters: [{ id: 'tx-1', frequency: 137100000 }],
        }, 'request'));
        state = satelliteReducer(state, submitOrEditSatellite.fulfilled([
            { id: 'sat-1', name: 'NOAA 19' },
        ], 'request'));
        state = satelliteReducer(state, fetchSatelliteCatalogStats.rejected(null, 'request'));

        expect(state).toMatchObject({
            status: 'succeeded',
            loading: false,
            catalogStats: null,
            satellites: [{ id: 'sat-1', name: 'NOAA 19' }],
            clickedSatellite: {
                name: 'NOAA 19',
                position: { lat: 12.5 },
                transmitters: [{ id: 'tx-1', frequency: 137100000 }],
            },
        });
    });

    it('keeps the newest catalog search result when responses arrive out of order', () => {
        let state = satelliteReducer(undefined, { type: '@@INIT' });
        state = satelliteReducer(state, searchSatellites.pending('older-request'));
        state = satelliteReducer(state, searchSatellites.pending('newer-request'));
        state = satelliteReducer(state, searchSatellites.fulfilled(
            [{norad_id: 1, name: 'Stale result'}],
            'older-request',
        ));
        expect(state.catalogLoading).toBe(true);
        state = satelliteReducer(state, searchSatellites.fulfilled(
            [{norad_id: 2, name: 'Current result'}],
            'newer-request',
        ));

        expect(state.satellites).toEqual([{norad_id: 2, name: 'Current result'}]);
        expect(state.loading).toBe(false);
    });

    it('stores a server-paginated catalog page and its total row count', () => {
        let state = satelliteReducer(undefined, { type: '@@INIT' });
        state = satelliteReducer(state, searchSatellites.pending('page-request'));
        state = satelliteReducer(state, searchSatellites.fulfilled({
            items: [{norad_id: 44003, name: 'Paged satellite'}],
            total: 14000,
            page: 2,
            pageSize: 10,
        }, 'page-request'));

        expect(state.satellites).toEqual([{norad_id: 44003, name: 'Paged satellite'}]);
        expect(state.catalogTotal).toBe(14000);
        expect(state.loading).toBe(false);
    });

    it('preserves pagination metadata returned by the catalog socket request', async () => {
        const page = [{norad_id: 44003, name: 'Paged satellite'}];
        const socket = {
            emit: vi.fn((_event, _request, acknowledge) => acknowledge({
                success: true,
                data: page,
                total: 14000,
                page: 2,
                page_size: 10,
            })),
        };
        const store = configureStore({reducer: satelliteReducer});

        const result = await store.dispatch(searchSatellites({
            socket,
            filters: {page: 2, page_size: 10},
        }));

        expect(result.payload).toEqual({
            items: page,
            total: 14000,
            page: 2,
            pageSize: 10,
        });
        expect(store.getState()).toMatchObject({
            satellites: page,
            catalogTotal: 14000,
            loading: false,
        });
    });

    it('normalizes source data returned from the orbital-source API and closes deletion confirmation', () => {
        let state = sourcesReducer(undefined, { type: '@@INIT' });
        state = sourcesReducer(state, setFormValues({ name: 'Weather TLEs', priority: '25' }));
        state = sourcesReducer(state, fetchOrbitalSources.fulfilled([{
            id: 'source-1',
            format: 'TLE',
            query_mode: 'URL',
            norad_ids: ['25338', 'invalid', 0],
            provider: 'CELESTRAK',
            enabled: 0,
            priority: '25',
            central_body: 'EARTH',
        }], 'request'));

        expect(state.tleSources).toEqual([expect.objectContaining({
            id: 'source-1',
            format: 'tle',
            query_mode: 'url',
            norad_ids: [25338],
            provider: 'celestrak',
            enabled: false,
            priority: 25,
            central_body: 'earth',
        })]);

        state = sourcesReducer(state, deleteOrbitalSources.fulfilled({ data: [] }, 'request'));

        expect(state).toMatchObject({
            loading: false,
            status: 'succeeded',
            formValues: { name: 'Weather TLEs', priority: '25' },
            tleSources: [],
            openDeleteConfirm: false,
        });
    });

    it('tracks group operation state for deletion and upsert outcomes', () => {
        let state = groupsReducer(undefined, { type: '@@INIT' });
        state = groupsReducer(state, setDeleteConfirmDialogOpen(true));
        state = groupsReducer(state, deleteSatelliteGroups.pending('request'));
        state = groupsReducer(state, deleteSatelliteGroups.fulfilled([{ id: 'group-2' }], 'request'));
        state = groupsReducer(state, AddOrEditSatelliteGroup.rejected(
            null,
            'request',
            undefined,
            'Group name already exists',
        ));

        expect(state).toMatchObject({
            loading: false,
            error: 'Group name already exists',
            groups: [{ id: 'group-2' }],
            deleteConfirmDialogOpen: true,
        });
    });
});
