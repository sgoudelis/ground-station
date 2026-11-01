/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import {gridClasses} from '@mui/x-data-grid';

// Keep the decoded packet and aircraft tables visually consistent across themes.
export const decodedTableSx = {
    border: 0,
    backgroundColor: 'background.paper',
    [`& .${gridClasses.cell}:focus, & .${gridClasses.cell}:focus-within`]: {
        outline: 'none',
    },
    [`& .${gridClasses.columnHeader}`]: {
        backgroundColor: 'background.default',
        '&:focus, &:focus-within': {
            outline: 'none',
        },
    },
    '& .MuiDataGrid-overlay': {
        fontSize: '0.875rem',
        fontStyle: 'italic',
        color: 'text.secondary',
    },
};
