/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React from 'react';
import {Box} from '@mui/material';
import {GridFooterContainer, GridPagination} from '@mui/x-data-grid';

export default function DecodedTableFooter({children}) {
    return <GridFooterContainer sx={(theme) => ({
        height: 30, minHeight: 30, px: 1, gap: 1, overflow: 'hidden',
        backgroundColor: 'background.paper',
        borderTop: `1px solid ${theme.palette.border?.main ?? theme.palette.divider}`,
        // GridPagination does not forward sx; style its rendered controls from the footer.
        '& .MuiTablePagination-root': {
            ml: 'auto', flex: '0 0 auto', height: 28, maxHeight: 'none', overflow: 'hidden',
        },
        '& .MuiTablePagination-toolbar': {height: 28, minHeight: 28, px: 0},
        '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': {my: 0, fontSize: '0.65rem'},
        '& .MuiTablePagination-input': {mr: 1, ml: 0.5, fontSize: '0.65rem'},
        '& .MuiTablePagination-select': {py: 0.25},
        '& .MuiTablePagination-actions': {
            ml: 0.5,
            '& .MuiIconButton-root': {p: 0.25},
            '& .MuiSvgIcon-root': {fontSize: '1rem'},
        },
    })}>
        <Box sx={{flex: '1 1 auto', minWidth: 0, overflow: 'hidden'}}>{children}</Box>
        <GridPagination />
    </GridFooterContainer>;
}
