import React from 'react';
import { Box, Paper, Tooltip, Typography } from '@mui/material';
import {
    fileDialogDetailLabelSx,
    fileDialogDetailSx,
    fileDialogDetailsGridSx,
    fileDialogSectionHeaderSx,
    fileDialogSectionSx,
} from './file-dialog-styles.js';

export default function FileDialogDetails({ title, details, action }) {
    return (
        <Paper variant="outlined" sx={fileDialogSectionSx}>
            <Box sx={fileDialogSectionHeaderSx}>
                <Typography variant="subtitle2" fontWeight={700}>{title}</Typography>
                {action}
            </Box>
            <Box sx={fileDialogDetailsGridSx}>
                {details.map((detail) => (
                    <Box key={detail.label} sx={(theme) => ({
                        ...fileDialogDetailSx,
                        borderBottom: { xs: `1px solid ${theme.palette.border?.main || theme.palette.divider}`, md: 0 },
                        '&:last-child': { borderBottom: 0 },
                        ...(detail.multiline && { gridColumn: '1 / -1' }),
                    })}>
                        <Typography variant="caption" color="text.secondary" sx={fileDialogDetailLabelSx}>
                            {detail.label}
                        </Typography>
                        <Tooltip title={String(detail.value)} placement="top-start">
                            <Typography
                                variant="body2"
                                noWrap={!detail.multiline}
                                sx={{
                                    fontFamily: detail.mono ? 'monospace' : 'inherit',
                                    fontWeight: 600,
                                    ...(detail.multiline && { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }),
                                }}
                            >
                                {detail.value}
                            </Typography>
                        </Tooltip>
                    </Box>
                ))}
            </Box>
        </Paper>
    );
}
