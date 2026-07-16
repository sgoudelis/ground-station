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
    setPassesTableColumnVisibility,
    setPassesTablePageSize,
} from './target-slice.jsx';

const TargetPassesTableSettingsDialog = ({ open, onClose }) => {
    const { t } = useTranslation('target');
    const dispatch = useDispatch();
    const columnVisibility = useSelector(state => state.targetSatTrack.passesTableColumnVisibility);
    const passesTablePageSize = useSelector(state => state.targetSatTrack.passesTablePageSize);

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

    const columns = [
        { name: 'status', label: 'Status', category: 'basic', alwaysVisible: true },
        { name: 'event_start', label: t('next_passes.start'), category: 'time', alwaysVisible: true },
        { name: 'event_end', label: t('next_passes.end'), category: 'time', alwaysVisible: true },
        { name: 'duration', label: t('next_passes.duration'), category: 'basic', alwaysVisible: true },
        { name: 'progress', label: t('next_passes.progress'), category: 'basic', alwaysVisible: true },
        { name: 'pass_tags', label: t('next_passes.pass_types', { defaultValue: 'Pass Types' }), category: 'basic' },
        { name: 'peak_altitude', label: t('next_passes.max_el'), category: 'basic' },
        { name: 'distance_at_start', label: t('next_passes.distance_aos'), category: 'distance' },
        { name: 'distance_at_end', label: t('next_passes.distance_los'), category: 'distance' },
        { name: 'distance_at_peak', label: t('next_passes.distance_peak'), category: 'distance' },
        { name: 'is_geostationary', label: t('next_passes.geo_stat'), category: 'orbital' },
        { name: 'is_geosynchronous', label: t('next_passes.geo_sync'), category: 'orbital' },
    ];

    const categories = {
        time: t('passes_table_settings.category_time'),
        basic: t('passes_table_settings.category_basic'),
        distance: t('passes_table_settings.category_distance'),
        orbital: t('passes_table_settings.category_orbital'),
    };

    const columnsByCategory = {
        time: columns.filter(col => col.category === 'time'),
        basic: columns.filter(col => col.category === 'basic'),
        distance: columns.filter(col => col.category === 'distance'),
        orbital: columns.filter(col => col.category === 'orbital'),
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>{t('passes_table_settings.title')}</DialogTitle>
            <DialogContent>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {t('passes_table_settings.description')}
                </Typography>

                <Box sx={{ mb: 2 }}>
                    <FormControl fullWidth size="small">
                        <InputLabel id="target-passes-table-rows-per-page-label">
                            {t('passes_table_settings.rows_per_page')}
                        </InputLabel>
                        <Select
                            labelId="target-passes-table-rows-per-page-label"
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
            <DialogActions>
                <Button onClick={onClose} variant="contained">
                    {t('passes_table_settings.close')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default TargetPassesTableSettingsDialog;
