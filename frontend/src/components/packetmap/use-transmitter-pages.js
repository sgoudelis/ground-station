/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import {useMemo, useState} from 'react';
import {filterTransmitterList, sortTransmitterList} from './transmitter-list-data.js';

export const transmitterPageSizes = [50, 100, 250];

export default function useTransmitterPages(rows, search, excludedTypes, sort, pageSize, selectedId) {
    const query = JSON.stringify([search, excludedTypes, sort]);
    const matches = useMemo(() => filterTransmitterList(rows, search, excludedTypes), [rows, search, excludedTypes]);
    const byId = useMemo(() => new Map(matches.map((row) => [row.id, row])), [matches]);
    const orderedIds = () => sortTransmitterList(matches, sort).map((row) => row.id);
    const [listing, setListing] = useState(() => ({query, ids: orderedIds(), page: 0, pageSize, selection: null}));
    const retainedIds = useMemo(() => listing.ids.every((id) => byId.has(id)) ? listing.ids
        : listing.ids.filter((id) => byId.has(id)), [listing.ids, byId]);

    // Measurements update in place. Rebuild the order for new arrivals so they
    // appear immediately in the selected sort without resetting the current page.
    let next = listing;
    if (listing.query !== query) {
        next = {...listing, query, ids: orderedIds(), page: 0};
    } else if (matches.length > retainedIds.length) {
        next = {...listing, ids: orderedIds()};
    } else if (retainedIds !== listing.ids) {
        // Expired/deleted nodes leave immediately as well.
        next = {...listing, ids: retainedIds};
    }
    if (listing.pageSize !== pageSize) next = {...next, pageSize, page: 0};
    if (selectedId !== listing.selection && (selectedId === null || byId.has(selectedId))) {
        const index = next.ids.indexOf(selectedId);
        next = {...next, selection: selectedId, page: selectedId === null ? next.page : Math.floor(index / pageSize)};
    }
    const pageCount = Math.max(1, Math.ceil(next.ids.length / pageSize));
    if (next.page >= pageCount) next = {...next, page: pageCount - 1};
    // Reconcile before children commit, preventing a stale page from flashing
    // when filters, page size, selection, or the available ID set changes.
    if (next !== listing) setListing(next);

    const offset = next.page * pageSize;
    const pageRows = useMemo(() => next.ids.slice(offset, offset + pageSize).map((id) => byId.get(id)),
        [next.ids, offset, pageSize, byId]);
    const changePage = (page) => setListing((previous) => ({...previous,
        page: Math.max(0, Math.min(pageCount - 1, page)),
    }));
    return {pageRows, ids: next.ids, page: next.page, pageCount, offset, total: next.ids.length,
        selectedIndex: next.ids.indexOf(selectedId), query, changePage};
}
