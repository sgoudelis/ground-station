/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import {gridLayoutStoreName, readStored} from './storage.js';

// Bump when changing default geometry or islands so saved grids use the new defaults.
export const LAYOUT_SCHEMA_VERSION = 5;
export const columns = {lg: 48, md: 40, sm: 24, xs: 8, xxs: 8};
const handles = ['s', 'sw', 'w', 'se', 'nw', 'ne', 'e'];
const windows = ['packet-map', 'transmitter-info', 'transmitters'];

export function defaultLayouts() {
    return Object.fromEntries(Object.entries(columns).map(([breakpoint, width]) => {
        // Desktop keeps all three windows side by side at the same height.
        if (breakpoint === 'lg') return [breakpoint, [
            {i: 'packet-map', x: 14, y: 0, w: 24, h: 59, minW: 8, minH: 16, resizeHandles: handles},
            {i: 'transmitter-info', x: 38, y: 0, w: 10, h: 59, minW: 6, minH: 8, resizeHandles: handles},
            {i: 'transmitters', x: 0, y: 0, w: 14, h: 59, minW: 8, minH: 14, resizeHandles: handles},
        ]];
        const stacked = width === 8;
        const sidebar = stacked ? width : Math.floor(width / 4);
        return [breakpoint, [
            {i: 'packet-map', x: 0, y: 0, w: stacked ? width : width - sidebar, h: 36, minW: Math.min(width, 8), minH: 16, resizeHandles: handles},
            {i: 'transmitter-info', x: stacked ? 0 : width - sidebar, y: stacked ? 36 : 0,
                w: sidebar, h: stacked ? 24 : 36, minW: Math.min(sidebar, 6), minH: 8, resizeHandles: handles},
            {i: 'transmitters', x: 0, y: stacked ? 60 : 36, w: width, h: 18, minW: Math.min(width, 8), minH: 14, resizeHandles: handles},
        ]];
    }));
}

export function loadLayouts() {
    const saved = readStored(gridLayoutStoreName);
    // Match the other pages: reject legacy/unversioned grids when defaults change.
    // Map navigation is stored separately and survives a layout reset.
    if (saved?.version !== LAYOUT_SCHEMA_VERSION || !saved.layouts || Array.isArray(saved.layouts)) return defaultLayouts();
    const layouts = saved.layouts;
    const valid = Object.keys(columns).every((breakpoint) => {
        const items = layouts[breakpoint];
        return Array.isArray(items) && items.length === windows.length
            && windows.every((id) => items.filter((item) => item?.i === id).length === 1)
            && items.every((item) => ['x', 'y', 'w', 'h'].every((key) => Number.isFinite(item[key]))
                && item.x >= 0 && item.y >= 0 && item.w > 0 && item.h > 0);
    });
    return valid ? layouts : defaultLayouts();
}
