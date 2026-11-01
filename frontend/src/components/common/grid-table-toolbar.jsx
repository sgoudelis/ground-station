/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React from 'react';
import {createPortal} from 'react-dom';
import {Box, IconButton, Tooltip} from '@mui/material';
import ViewColumnIcon from '@mui/icons-material/ViewColumn';
import FilterListIcon from '@mui/icons-material/FilterList';
import {ColumnsPanelTrigger, FilterPanelTrigger} from '@mui/x-data-grid';
import {useTranslation} from 'react-i18next';

export default function GridTableToolbar({container}) {
    const {t} = useTranslation('navigation');
    if (!container) return null;

    // Keep the grid's panel context and anchors while placing controls in its title bar.
    // Stop pointer starts here so using the controls does not drag an editable island.
    return createPortal(
        <Box sx={{display: 'flex', alignItems: 'center', gap: 0.5}}
            onMouseDown={(event) => event.stopPropagation()}
            onTouchStart={(event) => event.stopPropagation()}>
            <Tooltip title={t('packet_map.columns', {defaultValue: 'Columns'})}>
                <ColumnsPanelTrigger render={<IconButton size="small" sx={{p: '2px'}}
                    aria-label={t('packet_map.columns', {defaultValue: 'Columns'})} />}>
                    <ViewColumnIcon fontSize="small" />
                </ColumnsPanelTrigger>
            </Tooltip>
            <Tooltip title={t('packet_map.filters', {defaultValue: 'Filters'})}>
                <FilterPanelTrigger render={<IconButton size="small" sx={{p: '2px'}}
                    aria-label={t('packet_map.filters', {defaultValue: 'Filters'})} />}>
                    <FilterListIcon fontSize="small" />
                </FilterPanelTrigger>
            </Tooltip>
        </Box>,
        container,
    );
}
