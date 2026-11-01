/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import {gridClasses} from '@mui/x-data-grid';

// Use one opaque surface so the selected tab joins the header across all themes.
const decodedHeaderBackground = (theme) => (
    theme.palette.background.elevated ?? theme.palette.background.default
);

export const decodedTabsSx = {
    px: 1,
    minHeight: 30,
    borderBottom: 0,
    backgroundColor: 'background.paper',
    '& .MuiTabs-flexContainer': {
        justifyContent: 'flex-start',
        alignItems: 'flex-end',
        gap: 0.5,
    },
    '& .MuiTabs-indicator': {
        display: 'none',
    },
    '& .MuiTab-root.MuiTab-root': {
        minHeight: 30,
        height: 30,
        minWidth: 0,
        px: 1.25,
        py: 0.25,
        fontSize: '0.68rem',
        color: 'text.secondary',
        border: '1px solid transparent',
        borderTopWidth: 2,
        borderBottom: 0,
        borderRadius: '5px 5px 0 0',
        '&:hover': {
            color: 'text.primary',
            backgroundColor: 'action.hover',
        },
        '&.Mui-selected': {
            color: 'text.primary',
            fontWeight: 600,
            backgroundColor: decodedHeaderBackground,
            borderColor: 'divider',
            borderTopColor: 'primary.main',
        },
        '&.Mui-focusVisible': {
            outline: '2px solid',
            outlineColor: 'primary.main',
            outlineOffset: -3,
        },
    },
};

// Keep packet, aircraft and GNSS headers consistent, including unused header space.
export const decodedTableSx = {
    border: 0,
    backgroundColor: 'background.paper',
    '--DataGrid-containerBackground': decodedHeaderBackground,
    '& .MuiDataGrid-columnHeaders': {
        backgroundColor: decodedHeaderBackground,
    },
    [`& .${gridClasses.cell}:focus, & .${gridClasses.cell}:focus-within`]: {
        outline: 'none',
    },
    [`& .${gridClasses.columnHeader}`]: {
        backgroundColor: decodedHeaderBackground,
        '&:focus, &:focus-within': {
            outline: 'none',
        },
    },
    '& .MuiDataGrid-columnHeaderTitle': {
        fontWeight: 600,
    },
    '& .MuiDataGrid-overlay': {
        fontSize: '0.875rem',
        fontStyle: 'italic',
        color: 'text.secondary',
    },
};
