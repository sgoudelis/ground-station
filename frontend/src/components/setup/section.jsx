/** Copyright (c) 2026 Efstratios Goudelis. SPDX-License-Identifier: GPL-3.0-or-later */

import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';

// Keep wizard cards consistent without changing the regular settings pages.
export default function WizardSection({ title, description, icon: Icon, children, sx }) {
    return (
        <Box
            sx={[
                (theme) => ({
                    minWidth: 0,
                    width: '100%',
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    p: { xs: 2, sm: 3 },
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 2.5,
                    bgcolor: 'background.paper',
                    boxShadow: `0 2px 8px ${alpha(theme.palette.common.black, theme.palette.mode === 'dark' ? 0.12 : 0.03)}`,
                }),
                ...(Array.isArray(sx) ? sx : [sx]),
            ]}
        >
            <Stack spacing={2.75} sx={{ flex: 1 }}>
                {(title || description) && (
                    <Stack direction="row" spacing={1.75} alignItems="flex-start" sx={{ flexShrink: 0 }}>
                        {Icon && (
                            <Box
                                sx={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    width: 42,
                                    height: 42,
                                    flexShrink: 0,
                                    borderRadius: 1.5,
                                    bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1),
                                    color: 'primary.main',
                                }}
                            >
                                <Icon fontSize="small" />
                            </Box>
                        )}
                        <Stack spacing={0.75} sx={{ minWidth: 0 }}>
                            {title && (
                                <Typography component="h2" variant="h6" sx={{ fontSize: '1.05rem', fontWeight: 650, lineHeight: 1.4 }}>
                                    {title}
                                </Typography>
                            )}
                            {description && (
                                <Typography variant="body2" color="text.secondary" sx={{ maxWidth: '76ch', lineHeight: 1.7 }}>
                                    {description}
                                </Typography>
                            )}
                        </Stack>
                    </Stack>
                )}
                {children}
            </Stack>
        </Box>
    );
}
