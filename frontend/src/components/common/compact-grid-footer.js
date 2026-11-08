/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

// Compact both numbered pagination and the native arrows used on narrow tables.
export const compactGridFooterSx = {
    '& .MuiDataGrid-footerContainer': {
        // Include the border in a fixed height shared by all compact tables.
        boxSizing: 'border-box',
        height: 36,
        minHeight: 36,
        flexShrink: 0,
        '& .MuiTablePagination-root': {
            height: '100%',
        },
        '& .MuiTablePagination-toolbar': {
            height: '100%',
            minHeight: 0,
            py: 0,
        },
        '& .MuiTablePagination-selectLabel, & .MuiTablePagination-displayedRows': {
            my: 0,
        },
        '& .MuiTablePagination-select': {
            py: 0.25,
        },
        '& .MuiPaginationItem-root': {
            height: 28,
            minWidth: 28,
        },
        '& .MuiTablePagination-actions .MuiIconButton-root': {
            p: 0.5,
        },
    },
};
