/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useId, useState} from 'react';
import {Box, Button, Checkbox, FormControlLabel, FormGroup, Popover, Typography} from '@mui/material';
import ViewColumnIcon from '@mui/icons-material/ViewColumn';
import {useTranslation} from 'react-i18next';
import ResponsiveActionButton from '../common/responsive-action-button.jsx';
import {FILE_TABLE_COLUMNS, getFileTableColumnLabel, useFileTableColumns} from './file-table-columns.js';

export default function FileColumnSelector({visibility = {}, onChange, sortBy, compactQuery}) {
    const {t} = useTranslation('filebrowser');
    const columns = useFileTableColumns(visibility);
    const [anchorEl, setAnchorEl] = useState(null);
    const id = useId();
    const open = Boolean(anchorEl);
    const label = t('file_table_view.columns');

    return <>
        <ResponsiveActionButton
            variant="outlined" size="small" startIcon={<ViewColumnIcon />}
            label={label} compactQuery={compactQuery}
            aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
            onClick={event => setAnchorEl(event.currentTarget)}
        />
        <Popover
            id={id} open={open} anchorEl={anchorEl} onClose={() => setAnchorEl(null)}
            anchorOrigin={{vertical: 'bottom', horizontal: 'right'}}
            transformOrigin={{vertical: 'top', horizontal: 'right'}}
            slotProps={{paper: {role: 'dialog', 'aria-label': label, sx: {width: 270, p: 1}}}}
        >
            <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 1}}>
                <Typography variant="subtitle2">{label}</Typography>
                <Button size="small" onClick={() => onChange({})}>{t('file_table_view.reset_columns')}</Button>
            </Box>
            <FormGroup>
                {/* Names and row actions stay available even when every optional column is hidden. */}
                <FormControlLabel disabled control={<Checkbox size="small" checked />} label={t('file_table_view.name')} sx={{m: 0, px: 1}} />
                {FILE_TABLE_COLUMNS.map(column => <FormControlLabel
                    key={column.key}
                    control={<Checkbox size="small" checked={columns[column.key]} onChange={(_, checked) => onChange({...visibility, [column.key]: checked})} />}
                    label={getFileTableColumnLabel(column, sortBy, t)}
                    sx={{m: 0, px: 1, borderRadius: 1, '&:hover': {bgcolor: 'action.hover'}}}
                />)}
                <FormControlLabel disabled control={<Checkbox size="small" checked />} label={t('file_table_view.actions')} sx={{m: 0, px: 1}} />
            </FormGroup>
        </Popover>
    </>;
}
