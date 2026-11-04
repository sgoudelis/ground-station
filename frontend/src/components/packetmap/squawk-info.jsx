/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {memo, useId, useState} from 'react';
import {Box, IconButton, Link, Popover, Tooltip, Typography} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CloseIcon from '@mui/icons-material/Close';
import {useTranslation} from 'react-i18next';
import {squawkCodeListing, squawkInfo} from '../../utils/squawk-codes.js';

const SquawkInfo = memo(function SquawkInfo({code}) {
    const {t} = useTranslation('navigation');
    const [anchor, setAnchor] = useState(null);
    const id = useId();
    const info = squawkInfo(code);
    if (!info) return null;
    const label = (key, fallback, options = {}) => t(`packet_map.squawk.${key}`, {defaultValue: fallback, ...options});
    const about = label('about', 'About squawk {{code}}', {code: info.code});
    const meaningKey = info.known ? `codes.${info.code}` : 'unlisted';
    return <>
        <Tooltip title={about}>
            <IconButton size="small" aria-label={about} aria-haspopup="dialog" aria-expanded={Boolean(anchor)}
                aria-controls={anchor ? id : undefined} onClick={(event) => setAnchor(event.currentTarget)}
                sx={{p: '2px', ml: 0.5, color: 'text.secondary', verticalAlign: 'middle'}}>
                <InfoOutlinedIcon sx={{fontSize: 14}} />
            </IconButton>
        </Tooltip>
        <Popover id={id} open={Boolean(anchor)} anchorEl={anchor} onClose={() => setAnchor(null)}
            anchorOrigin={{vertical: 'bottom', horizontal: 'left'}}
            slotProps={{paper: {role: 'dialog', 'aria-labelledby': `${id}-title`, sx: {width: 340, maxWidth: 'calc(100vw - 32px)', p: 2}}}}>
            <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 1}}>
                <Typography id={`${id}-title`} component="h3" variant="subtitle2" fontWeight={700}>
                    {label('title', 'Squawk {{code}}', {code: info.code})}
                </Typography>
                <IconButton size="small" aria-label={label('close', 'Close squawk information')} onClick={() => setAnchor(null)} sx={{p: '2px'}}>
                    <CloseIcon sx={{fontSize: 16}} />
                </IconButton>
            </Box>
            <Typography variant="body2" fontWeight={600}>{label(`${meaningKey}.title`, info.title)}</Typography>
            {info.scope && <Typography variant="caption" color="text.secondary">
                {label(`${meaningKey}.scope`, info.scope)}
            </Typography>}
            <Typography variant="body2" sx={{mt: 1}}>{label(`${meaningKey}.description`, info.description)}</Typography>
            <Typography variant="caption" color="text.secondary" sx={{display: 'block', mt: 1}}>
                {label('regional_note', 'Regional assignments depend on the airspace, not the aircraft’s registration. The same code can have other uses elsewhere.')}
            </Typography>
            <Box sx={{display: 'flex', gap: 2, mt: 1.5, fontSize: '0.75rem'}}>
                {info.source && <Link href={info.source.url} target="_blank" rel="noopener noreferrer">{info.source.label}</Link>}
                <Link href={squawkCodeListing} target="_blank" rel="noopener noreferrer">{label('listing', 'Code listing')}</Link>
            </Box>
        </Popover>
    </>;
});

export default SquawkInfo;
