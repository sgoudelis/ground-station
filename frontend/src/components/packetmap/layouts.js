/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import {gridLayoutStoreName, readStored} from './storage.js';

export const LAYOUT_VERSION = 2;
export const columns = {lg: 48, md: 40, sm: 24, xs: 8, xxs: 8};
const handles = ['s', 'sw', 'w', 'se', 'nw', 'ne', 'e'];
const windows = ['packet-map', 'transmitter-types', 'transmitters'];

export function defaultLayouts() {
    return Object.fromEntries(Object.entries(columns).map(([breakpoint, width]) => {
        const stacked = width === 8;
        const sidebar = stacked ? width : Math.floor(width / 4);
        return [breakpoint, [
            {i: 'packet-map', x: 0, y: 0, w: stacked ? width : width - sidebar, h: 36, minW: Math.min(width, 8), minH: 16, resizeHandles: handles},
            {i: 'transmitter-types', x: stacked ? 0 : width - sidebar, y: stacked ? 36 : 0,
                w: sidebar, h: stacked ? 12 : 36, minW: Math.min(sidebar, 6), minH: 8, resizeHandles: handles},
            {i: 'transmitters', x: 0, y: stacked ? 48 : 36, w: width, h: 24, minW: Math.min(width, 8), minH: 14, resizeHandles: handles},
        ]];
    }));
}

export function loadLayouts() {
    const saved = readStored(gridLayoutStoreName);
    // The new schema reserves space for all three windows. Map navigation is
    // stored separately and survives this change from the single-window layout.
    if (saved?.version !== LAYOUT_VERSION || !saved.layouts || Array.isArray(saved.layouts)) return defaultLayouts();
    const valid = Object.keys(columns).every((breakpoint) => {
        const items = saved.layouts[breakpoint];
        return Array.isArray(items) && items.length === windows.length
            && windows.every((id) => items.filter((item) => item?.i === id).length === 1)
            && items.every((item) => ['x', 'y', 'w', 'h'].every((key) => Number.isFinite(item[key]))
                && item.x >= 0 && item.y >= 0 && item.w > 0 && item.h > 0);
    });
    return valid ? saved.layouts : defaultLayouts();
}
