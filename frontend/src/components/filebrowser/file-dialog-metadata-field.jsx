/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React from 'react';
import {Box, Typography} from '@mui/material';

export default function FileDialogMetadataField({label, value, mono = false, inline = false, title}) {
    return <Box sx={{minWidth: 0, ...(inline && {
        display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', alignItems: 'baseline', gap: 1.5, py: 0.75,
        borderBottom: '1px solid', borderColor: 'divider', '&:last-child': {borderBottom: 0, pb: 0},
    })}}>
        <Typography component="dt" variant="caption" color="text.secondary" sx={{lineHeight: 1.5, overflowWrap: 'anywhere'}}>
            {label}
        </Typography>
        <Typography component="dd" variant="body2" title={title} sx={{
            m: 0, mt: inline ? 0 : 0.5, fontWeight: inline ? 500 : 600, overflowWrap: 'anywhere',
            fontFamily: mono ? 'monospace' : 'inherit', fontVariantNumeric: 'tabular-nums',
            ...(mono && {letterSpacing: '0.02em'}), ...(inline && {textAlign: 'right'}),
        }}>
            {value}
        </Typography>
    </Box>;
}

