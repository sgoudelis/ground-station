/** Copyright (c) 2026 Efstratios Goudelis. SPDX-License-Identifier: GPL-3.0-or-later */
import React, { useId, useState } from 'react';
import { Box, Checkbox, IconButton, Stack, Typography } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useTranslation } from 'react-i18next';

export default function UsageChoice({ enabled, onChange, disabled = false, showDetails = true, showInfo = false }) {
    const { t } = useTranslation('settings');
    const help = useId();
    const info = useId();
    const choice = useId();
    const [infoOpen, setInfoOpen] = useState(false);
    const descriptionIds = [showDetails && help, showInfo && infoOpen && info].filter(Boolean).join(' ') || undefined;
    return (
        <Stack spacing={1}>
            {/* Inline text shares a baseline even when the explanation uses a smaller font. */}
            <Box sx={{ typography: 'body1' }}>
                <Checkbox
                    id={choice}
                    edge="start"
                    checked={enabled}
                    onChange={(event) => onChange(event.target.checked)}
                    disabled={disabled}
                    slotProps={{ input: { 'aria-describedby': descriptionIds } }}
                    sx={{ verticalAlign: 'middle' }}
                />
                <Typography
                    component="label"
                    htmlFor={choice}
                    variant="body1"
                    sx={{ cursor: disabled ? 'default' : 'pointer', color: disabled ? 'text.disabled' : 'text.primary' }}
                >
                    {t('usage.choice')}
                </Typography>
                {showInfo && (
                    <>
                        <IconButton
                            size="small"
                            aria-label={t('usage.info_label')}
                            aria-expanded={infoOpen}
                            aria-controls={infoOpen ? info : undefined}
                            onClick={() => setInfoOpen((open) => !open)}
                            sx={{ color: 'text.secondary', verticalAlign: 'middle', mx: 1 }}
                        >
                            <InfoOutlinedIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                        {infoOpen && (
                            <Typography id={info} component="span" variant="caption" color="text.secondary">
                                {t('usage.info')}
                            </Typography>
                        )}
                    </>
                )}
            </Box>
            {showDetails && <>
                <Typography id={help} variant="body2" color="text.secondary">{t('usage.help')}</Typography>
                <Typography variant="body2" color="text.secondary">{t('usage.privacy')}</Typography>
            </>}
        </Stack>
    );
}
