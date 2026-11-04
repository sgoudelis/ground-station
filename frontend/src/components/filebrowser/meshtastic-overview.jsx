/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React from 'react';
import {Box, Chip, DialogTitle, IconButton, Paper, Typography} from '@mui/material';
import {alpha} from '@mui/material/styles';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import CloseIcon from '@mui/icons-material/Close';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import {useTranslation} from 'react-i18next';
import {MeshtasticIcon} from '../common/custom-icons.jsx';
import {formatDateTime} from '../../utils/date-time.js';
import MetadataField from './file-dialog-metadata-field.jsx';
import {fileDialogSectionSx, fileDialogTitleSx} from './file-dialog-styles.js';

function nodeName(detail) {
    if (detail.long_name || detail.short_name) return detail.long_name || detail.short_name;
    // Older summaries include the node ID in their display name already.
    const suffix = ` (${detail.node_id})`;
    return detail.name?.endsWith(suffix) ? detail.name.slice(0, -suffix.length) : detail.name || detail.node_id;
}

export function MeshtasticOverviewHeader({detail, titleId, onClose}) {
    const {t} = useTranslation('filebrowser');
    const name = nodeName(detail);
    return <DialogTitle id={`${titleId}-header`} component="div" sx={(theme) => ({
        ...fileDialogTitleSx, px: {xs: 2, sm: 3}, py: 1.5, flexShrink: 0,
        background: `linear-gradient(120deg, ${alpha(theme.palette.success.main, 0.12)}, ${alpha(theme.palette.success.main, 0.02)})`,
        display: 'grid', alignItems: 'center', columnGap: 1.25, rowGap: 0.75,
        gridTemplateColumns: {xs: '36px minmax(0, 1fr) 28px', sm: '40px minmax(0, 1fr) auto 28px'},
        gridTemplateAreas: {xs: '"icon identity close" ". counts counts"', sm: '"icon identity counts close"'},
    })}>
        <Box sx={(theme) => ({gridArea: 'icon', display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: {xs: 36, sm: 40}, height: {xs: 36, sm: 40}, borderRadius: 2, bgcolor: alpha(theme.palette.success.main, 0.12)})}>
            <MeshtasticIcon sx={{fontSize: 28}} />
        </Box>
        <Box sx={{gridArea: 'identity', minWidth: 0}}>
            <Box sx={{display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1, rowGap: 0.5}}>
                <Typography id={titleId} component="h2" variant="h6" sx={{fontWeight: 700, lineHeight: 1.25, overflowWrap: 'anywhere'}}>
                    {name || t('meshtastic_folder.node', 'Meshtastic node')}
                </Typography>
                {detail.short_name && detail.short_name !== name && <Chip size="small" variant="outlined" label={detail.short_name} />}
            </Box>
            <Box sx={{display: 'flex', flexWrap: 'wrap', columnGap: 1.5, mt: 0.5}}>
                <Typography variant="caption" color="text.secondary">Meshtastic</Typography>
                {detail.node_id && detail.node_id !== name && <Typography variant="caption" color="text.secondary" sx={{fontFamily: 'monospace'}}>
                    {detail.node_id}
                </Typography>}
            </Box>
        </Box>
        <Box sx={{gridArea: 'counts', display: 'flex', flexWrap: 'wrap', gap: 0.5}}>
            <Chip size="small" color="success" label={t('meshtastic_folder.packet_count', '{{count}} packets', {count: detail.packet_count || 0})} />
            <Chip size="small" variant="outlined" label={t('meshtastic_folder.run_count', '{{count}} runs', {count: detail.run_count || 0})} />
        </Box>
        <IconButton size="small" onClick={onClose} aria-label={t('meshtastic_folder.close_folder', 'Close Meshtastic folder')}
            sx={{gridArea: 'close', alignSelf: 'start'}}><CloseIcon fontSize="small" /></IconButton>
    </DialogTitle>;
}

export default function MeshtasticOverview({detail, settings}) {
    const {t} = useTranslation('filebrowser');
    const timezone = settings.timezone || 'UTC';
    const fields = [
        {label: t('meshtastic_folder.node_id', 'Node ID'), value: detail.node_id || '—', mono: true},
        ...(detail.short_name ? [{label: t('meshtastic_folder.short_name', 'Short name'), value: detail.short_name}] : []),
        // Zero is a valid transmitted model or role code.
        ...(detail.hw_model != null ? [{label: t('meshtastic_folder.hardware', 'Hardware model code'), value: detail.hw_model, mono: true}] : []),
        ...(detail.role != null ? [{label: t('meshtastic_folder.role', 'Device role code'), value: detail.role, mono: true}] : []),
    ];
    return <Paper component="section" aria-label={t('meshtastic_folder.details', 'Node details')} variant="outlined" sx={fileDialogSectionSx}>
        <Box sx={{px: {xs: 2, sm: 2.5}, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexWrap: 'wrap', columnGap: 2, rowGap: 0.5, borderBottom: '1px solid', borderColor: 'divider'}}>
            <Box sx={{display: 'flex', alignItems: 'center', gap: 1}}>
                <InfoOutlinedIcon sx={{fontSize: 18, color: 'text.secondary'}} />
                <Typography component="h3" variant="subtitle2" fontWeight={600}>{t('meshtastic_folder.details', 'Node details')}</Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">{t('meshtastic_folder.details_hint', 'Latest recorded node information')}</Typography>
        </Box>
        <Box sx={{px: {xs: 2, sm: 2.5}, py: 2}}>
            <Box component="dl" sx={{display: 'grid', gridTemplateColumns: {xs: 'repeat(2, minmax(0, 1fr))', md: `repeat(${fields.length}, minmax(0, 1fr))`},
                columnGap: 3, rowGap: 2, m: 0}}>
                {fields.map((field) => <MetadataField key={field.label} {...field} />)}
            </Box>
            <Box sx={{display: 'flex', alignItems: 'flex-start', gap: 1.25, mt: 2, pt: 1.5, borderTop: '1px solid', borderColor: 'divider'}}>
                <AccessTimeIcon sx={{fontSize: 18, color: 'text.secondary', mt: 0.125, flexShrink: 0}} />
                <Box component="dl" sx={{display: 'grid', gridTemplateColumns: {xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))'},
                    columnGap: 3, rowGap: 1.5, flex: 1, minWidth: 0, m: 0}}>
                    {[
                        {label: t('meshtastic_folder.first_received', 'First received'), value: detail.captured_at},
                        {label: t('meshtastic_folder.last_received', 'Last received'), value: detail.last_packet_at},
                    ].map((field) => <MetadataField key={field.label} label={`${field.label} (${timezone})`}
                        value={field.value ? formatDateTime(field.value, settings) || '—' : '—'} />)}
                </Box>
            </Box>
        </Box>
    </Paper>;
}
