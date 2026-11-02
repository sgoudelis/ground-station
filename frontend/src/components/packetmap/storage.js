/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

export const gridLayoutStoreName = 'packet-map-layouts';
export const mapViewStoreName = 'packet-map-view';
export const hiddenTypesStoreName = 'packet-map-hidden-types';
export const mapSettingsStoreName = 'packet-map-settings';
export const aircraftUnitsStoreName = 'packet-map-aircraft-units';

export const defaultMapSettings = {
    enableMapDragging: false,
    enableMapZooming: false,
    showTracks: true,
    tileLayerId: 'esridarkcanvas',
};

export function readMapSettings() {
    const saved = readStored(mapSettingsStoreName);
    return {
        enableMapDragging: saved?.enableMapDragging === true,
        enableMapZooming: saved?.enableMapZooming === true,
        showTracks: saved?.showTracks !== false,
        tileLayerId: ['osm', 'satellite', 'hybrid', 'topo', 'cartodark', 'esridarkcanvas', 'stadiadark'].includes(saved?.tileLayerId)
            ? saved.tileLayerId : defaultMapSettings.tileLayerId,
    };
}

export function readStored(key) {
    try {
        return JSON.parse(localStorage.getItem(key));
    } catch {
        return null;
    }
}

export function writeStored(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch {
        // Map navigation still works when browser storage is unavailable.
    }
}

export function readMapView() {
    const view = readStored(mapViewStoreName);
    return Array.isArray(view?.center) && view.center.length === 2
        && view.center.every(Number.isFinite) && Math.abs(view.center[0]) <= 90
        && Number.isFinite(view.zoom) && view.zoom >= 0 && view.zoom <= 22 ? view : null;
}
