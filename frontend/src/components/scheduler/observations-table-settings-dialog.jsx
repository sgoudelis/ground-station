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
import { useTranslation } from 'react-i18next';
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
} from '@mui/material';
import { useDispatch, useSelector } from 'react-redux';
import { setColumnVisibility } from './scheduler-slice.jsx';

const ObservationsTableSettingsDialog = ({ open, onClose }) => {
    const dispatch = useDispatch();
    const { t } = useTranslation('common');
    const columnVisibility = useSelector(state => state.scheduler.columnVisibility);

    const handleColumnToggle = (columnName) => {
        dispatch(setColumnVisibility({
            [columnName]: !columnVisibility[columnName]
        }));
    };

    const columns = [
        { name: 'enabled', labelKey: 'enabled', category: 'basic', alwaysVisible: true },
        { name: 'satellite', labelKey: 'satellite', category: 'basic', alwaysVisible: true },
        { name: 'peak_elevation', labelKey: 'peak_elevation', category: 'pass_info' },
        { name: 'pass_start', labelKey: 'aos', category: 'timing' },
        { name: 'task_start', labelKey: 'task_start', category: 'timing' },
        { name: 'task_end', labelKey: 'task_end', category: 'timing' },
        { name: 'pass_end', labelKey: 'los', category: 'timing' },
        { name: 'sdr', labelKey: 'sdr', category: 'equipment' },
        { name: 'tasks', labelKey: 'tasks', category: 'configuration' },
        { name: 'status', labelKey: 'status', category: 'basic' },
        { name: 'actions', labelKey: 'actions', category: 'basic', alwaysVisible: true },
    ];

    const categories = {
        basic: t('scheduler_tables.settings.categories.basic'),
        pass_info: t('scheduler_tables.settings.categories.pass_info'),
        timing: t('scheduler_tables.settings.categories.timing'),
        equipment: t('scheduler_tables.settings.categories.equipment'),
        configuration: t('scheduler_tables.settings.categories.configuration'),
    };

    const columnsByCategory = {
        basic: columns.filter(col => col.category === 'basic'),
        pass_info: columns.filter(col => col.category === 'pass_info'),
        timing: columns.filter(col => col.category === 'timing'),
        equipment: columns.filter(col => col.category === 'equipment'),
        configuration: columns.filter(col => col.category === 'configuration'),
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle>{t('scheduler_tables.settings.title')}</DialogTitle>
            <DialogContent
                sx={{
                    bgcolor: (theme) => (
                        theme.palette.mode === 'dark'
                            ? theme.palette.background.elevated
                            : theme.palette.background.paper
                    ),
                }}
            >
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    {t('scheduler_tables.settings.subtitle')}
                </Typography>

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
                                            {column.label || t(`scheduler_tables.shared.columns.${column.labelKey}`)}
                                            {column.alwaysVisible && (
                                                <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                                                    ({t('scheduler_tables.settings.always_visible')})
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
                    {t('close')}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default ObservationsTableSettingsDialog;
