/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React from 'react';
import {Box, Chip, DialogTitle, IconButton, Paper, Typography} from '@mui/material';
import {alpha} from '@mui/material/styles';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import CloseIcon from '@mui/icons-material/Close';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import {useTranslation} from 'react-i18next';
import {WeatherBalloonIcon} from '../common/custom-icons.jsx';
import {formatDateTime} from '../../utils/date-time.js';
import MetadataField from './file-dialog-metadata-field.jsx';
import {fileDialogSectionSx, fileDialogTitleSx} from './file-dialog-styles.js';

export function RadiosondeOverviewHeader({detail, titleId, onClose}) {
    const {t} = useTranslation('filebrowser');
    const identity = detail.serial || detail.name || detail.model || t('radiosonde_folder.sonde', 'Radiosonde');
    return <DialogTitle id={`${titleId}-header`} component="div" sx={(theme) => ({
        ...fileDialogTitleSx, px: {xs: 2, sm: 3}, py: 1.5, flexShrink: 0,
        background: `linear-gradient(120deg, ${alpha(theme.palette.warning.main, 0.12)}, ${alpha(theme.palette.warning.main, 0.02)})`,
        display: 'grid', alignItems: 'center', columnGap: 1.25, rowGap: 0.75,
        gridTemplateColumns: {xs: '36px minmax(0, 1fr) 28px', sm: '40px minmax(0, 1fr) auto 28px'},
        gridTemplateAreas: {xs: '"icon identity close" ". counts counts"', sm: '"icon identity counts close"'},
    })}>
        <Box sx={(theme) => ({gridArea: 'icon', display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: {xs: 36, sm: 40}, height: {xs: 36, sm: 40}, borderRadius: 2,
            color: 'warning.main', bgcolor: alpha(theme.palette.warning.main, 0.12)})}>
            <WeatherBalloonIcon sx={{fontSize: 28}} />
        </Box>
        <Box sx={{gridArea: 'identity', minWidth: 0}}>
            <Box sx={{display: 'flex', alignItems: 'center', flexWrap: 'wrap', columnGap: 1, rowGap: 0.5}}>
                <Typography id={titleId} component="h2" variant="h6" sx={{fontWeight: 700, lineHeight: 1.25, overflowWrap: 'anywhere'}}>
                    {identity}
                </Typography>
                {detail.model && detail.model !== identity && <Chip size="small" variant="outlined" label={detail.model} />}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{display: 'block', mt: 0.5}}>
                {t('radiosonde_folder.capture_label', 'Radiosonde captures')}
            </Typography>
        </Box>
        <Box sx={{gridArea: 'counts', display: 'flex', flexWrap: 'wrap', gap: 0.5}}>
            <Chip size="small" color="warning" label={t('radiosonde_folder.packets', '{{count}} packets', {count: detail.packet_count || 0})} />
            <Chip size="small" variant="outlined" label={t('radiosonde_folder.flights', '{{count}} flights', {count: detail.run_count || 0})} />
        </Box>
        <IconButton size="small" onClick={onClose} aria-label={t('radiosonde_folder.close', 'Close radiosonde folder')}
            sx={{gridArea: 'close', alignSelf: 'start'}}><CloseIcon fontSize="small" /></IconButton>
    </DialogTitle>;
}

export default function RadiosondeOverview({detail, settings}) {
    const {t} = useTranslation('filebrowser');
    const timezone = settings.timezone || 'UTC';
    return <Paper component="section" aria-label={t('radiosonde_folder.details', 'Radiosonde details')} variant="outlined" sx={fileDialogSectionSx}>
        <Box sx={{px: {xs: 2, sm: 2.5}, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexWrap: 'wrap', columnGap: 2, rowGap: 0.5, borderBottom: '1px solid', borderColor: 'divider'}}>
            <Box sx={{display: 'flex', alignItems: 'center', gap: 1}}>
                <InfoOutlinedIcon sx={{fontSize: 18, color: 'text.secondary'}} />
                <Typography component="h3" variant="subtitle2" fontWeight={600}>{t('radiosonde_folder.details', 'Radiosonde details')}</Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">{t('radiosonde_folder.details_hint', 'Capture summary · All flights')}</Typography>
        </Box>
        <Box sx={{px: {xs: 2, sm: 2.5}, py: 2}}>
            <Box component="dl" sx={{display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', columnGap: 3, rowGap: 2, m: 0}}>
                <MetadataField label={t('radiosonde_folder.model_label', 'Model')} value={detail.model || '—'} />
                <MetadataField label={t('radiosonde_folder.serial_label', 'Serial')} value={detail.serial || '—'} mono />
            </Box>
            <Box sx={{display: 'flex', alignItems: 'flex-start', gap: 1.25, mt: 2, pt: 1.5, borderTop: '1px solid', borderColor: 'divider'}}>
                <AccessTimeIcon sx={{fontSize: 18, color: 'text.secondary', mt: 0.125, flexShrink: 0}} />
                <Box component="dl" sx={{display: 'grid', gridTemplateColumns: {xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))'},
                    columnGap: 3, rowGap: 1.5, flex: 1, minWidth: 0, m: 0}}>
                    {[
                        {label: t('radiosonde_folder.first_received', 'First received'), value: detail.captured_at},
                        {label: t('radiosonde_folder.last_received', 'Last received'), value: detail.last_packet_at},
                    ].map((field) => <MetadataField key={field.label} label={`${field.label} (${timezone})`}
                        value={field.value ? formatDateTime(field.value, settings) || '—' : '—'} />)}
                </Box>
            </Box>
        </Box>
    </Paper>;
}
