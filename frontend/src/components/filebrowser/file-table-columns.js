/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import {useMediaQuery, useTheme} from '@mui/material';
import {getFileBrowserDateField} from './filebrowser-display-item.js';

export const FILE_TABLE_COLUMNS = [
    {key: 'type', labelKey: 'file_table_view.type', width: 130, breakpoint: 'md'},
    {key: 'source', labelKey: 'file_table_view.source', width: 160, breakpoint: 'sm'},
    {key: 'frequency', labelKey: 'file_table_view.frequency', width: 140, breakpoint: 'lg'},
    {key: 'sampleRate', labelKey: 'file_table_view.sample_rate', width: 120, breakpoint: 'lg'},
    {key: 'summary', labelKey: 'file_table_view.summary', width: 140, breakpoint: 'lg'},
    {key: 'size', labelKey: 'file_table_view.size', width: 100, breakpoint: 'lg', align: 'right'},
    {key: 'time', labelKey: 'sort.latest_activity', width: 125, breakpoint: 'sm'},
];

export function getFileTableColumnLabel(column, sortBy, t) {
    return t(column.key === 'time' ? 'sort.' + getFileBrowserDateField(sortBy) : column.labelKey);
}

export function useFileTableColumns(visibility = {}) {
    const theme = useTheme();
    const sm = useMediaQuery(theme.breakpoints.up('sm'));
    const md = useMediaQuery(theme.breakpoints.up('md'));
    const lg = useMediaQuery(theme.breakpoints.up('lg'));
    const breakpoints = {sm, md, lg};
    // Only explicit choices are saved. Unconfigured columns keep adapting to the viewport.
    return Object.fromEntries(FILE_TABLE_COLUMNS.map(({key, breakpoint}) => [
        key, visibility[key] ?? breakpoints[breakpoint],
    ]));
}
