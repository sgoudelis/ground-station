/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

import React from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    FormGroup,
    FormControlLabel,
    Checkbox,
    Typography,
    Box,
    Divider,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import {
    resetPassesTableSettings,
    setPassesTableColumnVisibility,
    setPassesTablePageSize,
} from './earthview-slice.jsx';
const DIALOG_PAPER_SX = {
    bgcolor: 'background.paper',
    border: (theme) => `1px solid ${theme.palette.divider}`,
    borderRadius: 2,
};
const DIALOG_TITLE_SX = {
    bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100'),
    borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
    fontSize: '1.125rem',
    fontWeight: 'bold',
    py: 2.2,
};
const DIALOG_CONTENT_SX = {
    px: 2,
    pt: 2,
    pb: 1.5,
};
const DIALOG_ACTIONS_SX = {
    px: 2,
    py: 1.5,
    bgcolor: 'background.paper',
    borderTop: (theme) => `1px solid ${theme.palette.divider}`,
};
const FOOTER_ACTION_ROW_SX = {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 1,
    overflowX: 'auto',
    msOverflowStyle: 'none',
    scrollbarWidth: 'none',
    '&::-webkit-scrollbar': { display: 'none' },
    '& > *': {
        flexShrink: 0,
        whiteSpace: 'nowrap',
    },
};

const PassesTableSettingsDialog = ({ open, onClose }) => {
    const { t } = useTranslation('earthview');
    const dispatch = useDispatch();
    const columnVisibility = useSelector(state => state.earthViewTrack.passesTableColumnVisibility);
    const passesTablePageSize = useSelector(state => state.earthViewTrack.passesTablePageSize);

    const rowsPerPageOptions = [5, 10, 15, 20];

    const handleColumnToggle = (columnName) => {
        dispatch(setPassesTableColumnVisibility({
            ...columnVisibility,
            [columnName]: !columnVisibility[columnName]
        }));
    };

    const handleRowsPerPageChange = (event) => {
        dispatch(setPassesTablePageSize(event.target.value));
    };

    const handleResetValues = () => {
        dispatch(resetPassesTableSettings());
    };

    const columns = [
        { name: 'status', label: 'Status', category: 'basic', alwaysVisible: true },
        { name: 'name', label: t('passes_table.name'), category: 'basic', alwaysVisible: true },
        { name: 'alternative_name', label: t('passes_table.alternative_name'), category: 'names' },
        { name: 'name_other', label: t('passes_table.name_other'), category: 'names' },
        { name: 'peak_altitude', label: t('passes_table.peak_elevation'), category: 'basic' },
        { name: 'elevation', label: t('passes_table.current_elevation'), category: 'basic' },
        { name: 'pass_tags', label: t('passes_table.pass_types', { defaultValue: 'Pass Types' }), category: 'basic' },
        { name: 'progress', label: t('passes_table.progress'), category: 'basic', alwaysVisible: true },
        { name: 'duration', label: t('passes_table.duration'), category: 'basic' },
        { name: 'transmitter_links', label: t('passes_table.transmitter_links', { defaultValue: 'Links' }), category: 'basic' },
        { name: 'event_start', label: t('passes_table.start'), category: 'time' },
        { name: 'event_end', label: t('passes_table.end'), category: 'time' },
        { name: 'distance_at_start', label: t('passes_table.distance_aos'), category: 'distance' },
        { name: 'distance_at_end', label: t('passes_table.distance_los'), category: 'distance' },
        { name: 'distance_at_peak', label: t('passes_table.distance_peak'), category: 'distance' },
        { name: 'is_geostationary', label: t('passes_table.geo_stat'), category: 'orbital' },
        { name: 'is_geosynchronous', label: t('passes_table.geo_sync'), category: 'orbital' },
    ];

    const categories = {
        basic: t('passes_table_settings.category_basic'),
        names: t('passes_table_settings.category_names'),
        time: t('passes_table_settings.category_time'),
        distance: t('passes_table_settings.category_distance'),
        orbital: t('passes_table_settings.category_orbital'),
    };

    const columnsByCategory = {
        basic: columns.filter(col => col.category === 'basic'),
        names: columns.filter(col => col.category === 'names'),
        time: columns.filter(col => col.category === 'time'),
        distance: columns.filter(col => col.category === 'distance'),
        orbital: columns.filter(col => col.category === 'orbital'),
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: DIALOG_PAPER_SX }}>
            <DialogTitle sx={DIALOG_TITLE_SX}>{t('passes_table_settings.title')}</DialogTitle>
            <DialogContent sx={DIALOG_CONTENT_SX}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {t('passes_table_settings.description')}
                </Typography>

                <Box sx={{ mb: 2 }}>
                    <FormControl fullWidth size="small">
                        <InputLabel id="passes-table-rows-per-page-label">
                            {t('passes_table_settings.rows_per_page')}
                        </InputLabel>
                        <Select
                            labelId="passes-table-rows-per-page-label"
                            value={passesTablePageSize}
                            label={t('passes_table_settings.rows_per_page')}
                            onChange={handleRowsPerPageChange}
                        >
                            {rowsPerPageOptions.map((option) => (
                                <MenuItem key={option} value={option}>
                                    {option}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <Divider sx={{ mt: 2 }} />
                </Box>

                {Object.entries(columnsByCategory).map(([category, cols]) => (
                    <Box key={category} sx={{ mb: 2 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
                            {categories[category]}
                        </Typography>
                        <FormGroup>
                            {cols.map(column => (
                                <FormControlLabel
                                    key={column.name}
                                    control={
                                        <Checkbox
                                            checked={column.alwaysVisible || columnVisibility[column.name] !== false}
                                            onChange={() => handleColumnToggle(column.name)}
                                            disabled={column.alwaysVisible}
                                        />
                                    }
                                    label={
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                            {column.label}
                                            {column.alwaysVisible && (
                                                <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                                                    ({t('passes_table_settings.always_visible')})
                                                </Typography>
                                            )}
                                        </Box>
                                    }
                                />
                            ))}
                        </FormGroup>
                        <Divider sx={{ mt: 1 }} />
                    </Box>
                ))}
            </DialogContent>
            <DialogActions sx={DIALOG_ACTIONS_SX}>
                <Box sx={FOOTER_ACTION_ROW_SX}>
                    <Button onClick={handleResetValues} variant="outlined">
                        Reset Values
                    </Button>
                    <Box sx={{ flex: 1, minWidth: 8 }} />
                    <Button onClick={onClose} variant="contained">
                        {t('passes_table_settings.close')}
                    </Button>
                </Box>
            </DialogActions>
        </Dialog>
    );
};

export default PassesTableSettingsDialog;
