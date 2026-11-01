/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React from 'react';
import {Box, IconButton, List, ListItem, ListItemText, Tooltip, Typography} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import {useTranslation} from 'react-i18next';
import {getClassNamesBasedOnGridEditing, islandTitleBarCompactSx, TitleBar} from '../common/common.jsx';
import {TRANSMITTER_TYPES, typeColor, typeLabel} from './transmitters.js';

export default function TransmitterTypes({rows, positions, hiddenTypes, onToggle, gridEditable}) {
    const {t} = useTranslation('navigation');
    const kinds = [...new Set([...Object.keys(TRANSMITTER_TYPES), ...rows.map((row) => row.kind)])];
    return <Box sx={{height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0}}>
        <TitleBar className={getClassNamesBasedOnGridEditing(gridEditable, ['window-title-bar'])}
            sx={{...islandTitleBarCompactSx, flexShrink: 0}}>
            <Typography variant="subtitle2" noWrap sx={{fontWeight: 'bold'}}>
                {t('packet_map.types', {defaultValue: 'Transmitter types'})}
            </Typography>
        </TitleBar>
        <List dense disablePadding sx={{overflowY: 'auto', flex: 1}}>
            {kinds.map((kind) => {
                const visible = !hiddenTypes.includes(kind);
                const count = rows.filter((row) => row.kind === kind).length;
                const packets = positions.filter((point) => point.kind === kind).length;
                const label = t(visible ? 'packet_map.hide_type' : 'packet_map.show_type', {
                    defaultValue: visible ? 'Hide {{type}}' : 'Show {{type}}', type: typeLabel(kind),
                });
                return <ListItem key={kind} divider sx={{gap: 1, px: 1.5, opacity: visible ? 1 : 0.55}}>
                    <Box sx={{width: 9, height: 9, borderRadius: '50%', flexShrink: 0, bgcolor: typeColor(kind)}} />
                    <ListItemText primary={typeLabel(kind)} slotProps={{primary: {variant: 'body2'}, secondary: {variant: 'caption'}}}
                        secondary={`${t('packet_map.transmitter_count', {defaultValue: '{{count}} transmitters', count})} · ${t('packet_map.packet_count', {defaultValue: '{{count}} positions', count: packets})}`} />
                    <Tooltip title={label}>
                        <IconButton size="small" aria-label={label} aria-pressed={visible} onClick={() => onToggle(kind)}>
                            {visible ? <VisibilityIcon fontSize="small" /> : <VisibilityOffIcon fontSize="small" />}
                        </IconButton>
                    </Tooltip>
                </ListItem>;
            })}
        </List>
    </Box>;
}
