/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React from 'react';
import {Box, Button, Checkbox, FormControlLabel} from '@mui/material';
import {GridColumnsManagement, gridColumnDefinitionsSelector, gridColumnVisibilityModelSelector,
    useGridApiContext, useGridSelector} from '@mui/x-data-grid';

export default function TransmitterColumnsManagement({resetDisabled, onReset}) {
    const apiRef = useGridApiContext();
    const columns = useGridSelector(apiRef, gridColumnDefinitionsSelector);
    const visibility = useGridSelector(apiRef, gridColumnVisibilityModelSelector);
    const hideable = columns.filter((column) => column.hideable !== false);
    const allVisible = hideable.every((column) => visibility[column.field] !== false);
    const allHidden = hideable.every((column) => visibility[column.field] === false);
    const toggleAll = () => {
        const model = {...visibility};
        // Explicit true values override decoded columns hidden by default.
        for (const column of hideable) model[column.field] = !allVisible;
        apiRef.current.setColumnVisibilityModel(model);
    };

    // Keep the native search and column list. Its reset baseline changes when
    // live reports rebuild columns, so the footer uses the table's defaults.
    return <>
        <GridColumnsManagement disableResetButton disableShowHideToggle />
        <Box sx={{px: 1.5, py: 1, borderTop: 1, borderColor: 'divider', display: 'flex',
            alignItems: 'center', justifyContent: 'space-between'}}>
            <FormControlLabel sx={{m: 0, '& .MuiFormControlLabel-label': {fontSize: '0.875rem'}}}
                control={<Checkbox size="small" sx={{p: 0.5}} disabled={!hideable.length}
                    checked={allVisible} indeterminate={!allVisible && !allHidden} onChange={toggleAll} />}
                label={apiRef.current.getLocaleText('columnsManagementShowHideAllText')} />
            <Button size="small" disabled={resetDisabled} onClick={onReset}>
                {apiRef.current.getLocaleText('columnsManagementReset')}
            </Button>
        </Box>
    </>;
}
