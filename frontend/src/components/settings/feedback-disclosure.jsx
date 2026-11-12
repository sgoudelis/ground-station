/** Copyright (c) 2026 Efstratios Goudelis. SPDX-License-Identifier: GPL-3.0-or-later */

import React, { useId } from 'react';
import {
    Alert, Box, FormControlLabel, Stack, Switch, Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import InsightsOutlinedIcon from '@mui/icons-material/InsightsOutlined';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined';
import SendOutlinedIcon from '@mui/icons-material/SendOutlined';
import { Trans, useTranslation } from 'react-i18next';
import { SettingsSection } from './shared/index.js';

export const CENSUS_NOTICE_VERSION = 'census-2';

export function FeedbackIntroduction({ actions = null }) {
    const { t } = useTranslation('settings');

    return (
        <Stack spacing={2}>
            <Stack
                direction={{ xs: 'column', sm: 'row' }}
                justifyContent="space-between"
                alignItems={{ xs: 'flex-start', sm: 'center' }}
                gap={2}
            >
                <Stack direction="row" spacing={1.5} alignItems="center">
                    <Box sx={{
                        display: 'flex', p: 1.25, borderRadius: 1.5,
                        color: 'primary.main',
                        bgcolor: (theme) => alpha(theme.palette.primary.main, 0.1),
                    }}>
                        <InsightsOutlinedIcon />
                    </Box>
                    <Typography variant="h6" component="h2" fontWeight={600}>
                        {t('feedback.title')}
                    </Typography>
                </Stack>
                {actions}
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: '100ch', lineHeight: 1.75 }}>
                {t('feedback.introduction')}
            </Typography>
            <Stack direction="row" spacing={1.25} sx={{
                p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: 1.5,
                bgcolor: 'action.hover', alignItems: 'flex-start',
            }}>
                <ShieldOutlinedIcon fontSize="small" sx={{ color: 'text.secondary', mt: 0.25 }} />
                <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
                    {t('feedback.optional')}
                </Typography>
            </Stack>
        </Stack>
    );
}

export function FeedbackChoices({ enabled, onChange, disabled = false, actions = null }) {
    const { t } = useTranslation('settings');
    const censusHelpId = useId();

    return (
        <SettingsSection title={t('feedback.choices')} sx={{ borderRadius: 1.5 }}>
            <Stack spacing={1} sx={{
                p: 1.5, border: '1px solid', borderRadius: 1,
                borderColor: enabled ? 'primary.main' : 'divider',
                bgcolor: (theme) => enabled ? alpha(theme.palette.primary.main, 0.06) : 'transparent',
            }}>
                <FormControlLabel
                    control={<Switch
                        checked={enabled}
                        onChange={(event) => onChange(event.target.checked)}
                        disabled={disabled}
                        // Custom input slot props replace MUI's default switch role.
                        slotProps={{ input: { role: 'switch', 'aria-describedby': censusHelpId } }}
                    />}
                    label={t('feedback.census_switch')}
                    labelPlacement="start"
                    sx={{ m: 0, justifyContent: 'space-between', gap: 1, '& .MuiFormControlLabel-label': { fontSize: '0.875rem', fontWeight: 600 } }}
                />
                <Typography id={censusHelpId} variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
                    {t('feedback.census_help')}
                </Typography>
            </Stack>
            {actions && <Box sx={{ pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>{actions}</Box>}
        </SettingsSection>
    );
}

export function CensusDisclosure() {
    const { t } = useTranslation('settings');
    const headingId = useId();
    const columns = [
        {
            key: 'reported', title: 'reported_title', help: 'reported_help', prefix: 'fields', tone: 'primary',
            icon: <SendOutlinedIcon fontSize="small" color="primary" />,
            fields: ['identity', 'application', 'os', 'cpu', 'gpu', 'memory', 'ip', 'country', 'activity'],
        },
        {
            key: 'excluded', title: 'excluded_title', help: 'excluded_help', prefix: 'excluded_fields', tone: 'success',
            icon: <ShieldOutlinedIcon fontSize="small" color="success" />,
            fields: ['identity', 'location', 'accounts', 'network', 'hardware', 'radio', 'targets', 'recordings', 'files', 'browser'],
        },
    ];

    return (
        <SettingsSection
            title={<Stack component="span" direction="row" spacing={1} alignItems="center"><FactCheckOutlinedIcon fontSize="small" color="primary" /><span>{t('feedback.disclosure_title')}</span></Stack>}
            sx={{ borderRadius: 1.5 }}
        >
            <Box sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
                gap: 2,
            }}>
                {columns.map((column) => (
                    <Stack
                        key={column.key}
                        component="section"
                        aria-labelledby={`${headingId}-${column.key}`}
                        spacing={2}
                        sx={{
                            minWidth: 0, p: { xs: 1.5, sm: 2 }, border: '1px solid', borderRadius: 1.5,
                            borderColor: (theme) => alpha(theme.palette[column.tone].main, 0.3),
                            bgcolor: (theme) => alpha(theme.palette[column.tone].main, 0.035),
                        }}
                    >
                        <Stack spacing={0.75}>
                            <Stack direction="row" spacing={1} alignItems="center">
                                {column.icon}
                                <Typography component="h3" id={`${headingId}-${column.key}`} variant="subtitle1" fontWeight={600}>
                                    {t(`feedback.${column.title}`)}
                                </Typography>
                            </Stack>
                            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.7 }}>
                                {t(`feedback.${column.help}`)}
                            </Typography>
                        </Stack>
                        <Box component="ul" aria-labelledby={`${headingId}-${column.key}`} sx={{
                            m: 0, pl: 2.5, listStyleType: 'disc',
                            '& li': { pl: 0.75, mb: 2, lineHeight: 1.75, color: 'text.secondary' },
                            '& li::marker': { color: `${column.tone}.main`, fontSize: '1.25rem' },
                            '& li:last-of-type': { mb: 0 },
                        }}>
                            {column.fields.map((key) => (
                                <Typography key={key} component="li" variant="body2">
                                    <Trans
                                        ns="settings"
                                        i18nKey={`feedback.${column.prefix}.${key}`}
                                        components={{ strong: <Box component="strong" sx={{ display: 'block', mb: 0.5, fontWeight: 600, color: 'text.primary' }} /> }}
                                    />
                                </Typography>
                            ))}
                        </Box>
                    </Stack>
                ))}
            </Box>
            <Alert severity="info" variant="outlined" sx={{ borderRadius: 1, '& .MuiAlert-message': { lineHeight: 1.7 } }}>
                {t('feedback.privacy')}
            </Alert>
        </SettingsSection>
    );
}

export function FeedbackDelivery() {
    const { t } = useTranslation('settings');

    return (
        <SettingsSection
            title={<Stack component="span" direction="row" spacing={1} alignItems="center"><SendOutlinedIcon fontSize="small" color="primary" /><span>{t('feedback.delivery_title')}</span></Stack>}
            sx={{ borderRadius: 1.5 }}
        >
            {['delivery', 'retention', 'withdrawal'].map((key) => (
                <Typography key={key} variant="body2" color="text.secondary" sx={{ lineHeight: 1.75 }}>{t(`feedback.${key}`)}</Typography>
            ))}
        </SettingsSection>
    );
}

// Compose the same notice in setup and Settings, keeping the consent wording
// identical while letting Settings arrange the sections around delivery status.
export default function FeedbackDisclosure(props) {
    return (
        <Stack spacing={2}>
            <FeedbackIntroduction />
            <FeedbackChoices {...props} />
            <CensusDisclosure />
            <FeedbackDelivery />
        </Stack>
    );
}
