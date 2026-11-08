// Copyright (c) 2026 Efstratios Goudelis
// SPDX-License-Identifier: GPL-3.0-or-later

import { alpha } from '@mui/material/styles';
import { gridClasses } from '@mui/x-data-grid';

// Keep the scheduler grids consistent while allowing table-specific cell styles.
export const schedulerTableSx = {
    border: 0,
    width: '100%',
    '& .MuiDataGrid-main': { overflowX: 'auto' },
    '& .MuiDataGrid-virtualScroller': {
        overflowX: 'auto',
        touchAction: 'pan-x pan-y',
    },
    [`& .${gridClasses.cell}:focus, & .${gridClasses.cell}:focus-within`]: { outline: 'none' },
    [`& .${gridClasses.columnHeader}:focus, & .${gridClasses.columnHeader}:focus-within`]: { outline: 'none' },
    '& .MuiDataGrid-columnHeaders': {
        backgroundColor: (theme) => alpha(
            theme.palette.primary.main,
            theme.palette.mode === 'dark' ? 0.18 : 0.10,
        ),
        borderBottom: (theme) => `2px solid ${alpha(theme.palette.primary.main, 0.45)}`,
    },
    '& .MuiDataGrid-columnHeader': { backgroundColor: 'transparent' },
    '& .MuiDataGrid-columnHeaderTitle': {
        fontSize: '0.8125rem',
        fontWeight: 700,
        letterSpacing: '0.02em',
    },
    '& .MuiDataGrid-overlay': {
        fontSize: '0.875rem',
        fontStyle: 'italic',
        color: 'text.secondary',
    },
    '& .MuiDataGrid-cell': { display: 'flex', alignItems: 'center' },
};
