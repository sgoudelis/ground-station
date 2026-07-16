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
    resetSatellitesTableSettings,
    setSatellitesTableColumnVisibility,
    setSatellitesTablePageSize,
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

const SatellitesTableSettingsDialog = ({ open, onClose }) => {
    const { t } = useTranslation('earthview');
    const dispatch = useDispatch();
    const columnVisibility = useSelector(state => state.earthViewTrack.satellitesTableColumnVisibility);
    const satellitesTablePageSize = useSelector(state => state.earthViewTrack.satellitesTablePageSize);

    const rowsPerPageOptions = [5, 10, 15, 20, 50];

    const handleColumnToggle = (columnName) => {
        dispatch(setSatellitesTableColumnVisibility({
            ...columnVisibility,
            [columnName]: !columnVisibility[columnName]
        }));
    };

    const handleRowsPerPageChange = (event) => {
        dispatch(setSatellitesTablePageSize(event.target.value));
    };

    const handleResetValues = () => {
        dispatch(resetSatellitesTableSettings());
    };

    const columns = [
        { name: 'name', label: t('satellites_table.satellite_name'), category: 'basic', alwaysVisible: true },
        { name: 'alternative_name', label: t('satellites_table.alternative_name'), category: 'names' },
        { name: 'norad_id', label: t('satellites_table.norad'), category: 'basic', alwaysVisible: true },
        { name: 'elevation', label: t('satellites_table.elevation'), category: 'basic', alwaysVisible: true },
        { name: 'visibility', label: t('satellites_table.visibility', { defaultValue: 'Visibility' }), category: 'basic', alwaysVisible: true },
        { name: 'status', label: t('satellites_table.status'), category: 'basic' },
        { name: 'transmitters', label: t('satellites_table.transmitters'), category: 'basic' },
        { name: 'countries', label: t('satellites_table.countries'), category: 'metadata' },
        { name: 'decayed', label: t('satellites_table.decayed'), category: 'metadata' },
        { name: 'updated', label: t('satellites_table.updated'), category: 'metadata' },
        { name: 'launched', label: t('satellites_table.launched'), category: 'metadata' },
    ];

    const categories = {
        basic: t('satellites_table_settings.category_basic'),
        names: t('satellites_table_settings.category_names'),
        metadata: t('satellites_table_settings.category_metadata'),
    };

    const columnsByCategory = {
        basic: columns.filter(col => col.category === 'basic'),
        names: columns.filter(col => col.category === 'names'),
        metadata: columns.filter(col => col.category === 'metadata'),
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: DIALOG_PAPER_SX }}>
            <DialogTitle sx={DIALOG_TITLE_SX}>{t('satellites_table_settings.title')}</DialogTitle>
            <DialogContent sx={DIALOG_CONTENT_SX}>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {t('satellites_table_settings.description')}
                </Typography>

                <Box sx={{ mb: 2 }}>
                    <FormControl fullWidth size="small">
                        <InputLabel id="satellites-table-rows-per-page-label">
                            {t('satellites_table_settings.rows_per_page')}
                        </InputLabel>
                        <Select
                            labelId="satellites-table-rows-per-page-label"
                            value={satellitesTablePageSize}
                            label={t('satellites_table_settings.rows_per_page')}
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
                                                    ({t('satellites_table_settings.always_visible')})
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
                        {t('satellites_table_settings.close')}
                    </Button>
                </Box>
            </DialogActions>
        </Dialog>
    );
};

export default SatellitesTableSettingsDialog;
