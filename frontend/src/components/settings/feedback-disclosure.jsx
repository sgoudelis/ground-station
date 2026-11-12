/** Copyright (c) 2026 Efstratios Goudelis. SPDX-License-Identifier: GPL-3.0-or-later */

import React from 'react';
import {
    Alert, Box, FormControlLabel, MenuItem, Stack, Switch, TextField, Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { SettingsSection } from './shared/index.js';

export const CENSUS_NOTICE_VERSION = 'census-2';

// Reuse the same consent notice in onboarding and Settings so the promise does
// not drift between the two places where administrators make their choice.
export default function FeedbackDisclosure({ enabled, onChange, environment, onEnvironmentChange, disabled = false, actions = null }) {
    const { t } = useTranslation('settings');

    return (
        <Stack spacing={2}>
            <Stack spacing={1}>
                <Typography variant="h6" component="h2">{t('feedback.title')}</Typography>
                <Typography>{t('feedback.introduction')}</Typography>
                <Typography variant="body2" color="text.secondary">{t('feedback.optional')}</Typography>
            </Stack>

            <SettingsSection title={t('feedback.choices')}>
                <FormControlLabel
                    control={<Switch checked={enabled} onChange={(event) => onChange(event.target.checked)} disabled={disabled} />}
                    label={t('feedback.census_switch')}
                />
                <Typography variant="body2" color="text.secondary">{t('feedback.census_help')}</Typography>
                <TextField
                    select
                    label={t('feedback.environment')}
                    value={environment}
                    onChange={(event) => onEnvironmentChange(event.target.value)}
                    disabled={disabled}
                    helperText={t('feedback.environment_help')}
                    size="small"
                    fullWidth
                >
                    {['unknown', 'production', 'development', 'test'].map((value) => (
                        <MenuItem key={value} value={value}>{t(`feedback.environments.${value}`)}</MenuItem>
                    ))}
                </TextField>
                <FormControlLabel control={<Switch checked={false} disabled />} label={t('feedback.performance_switch')} />
                <Typography variant="body2" color="text.secondary">{t('feedback.performance_help')}</Typography>
                {actions}
            </SettingsSection>

            <SettingsSection title={t('feedback.disclosure_title')} description={t('feedback.disclosure_version', { version: CENSUS_NOTICE_VERSION })}>
                <Box component="ul" sx={{ m: 0, pl: 2.5, '& li': { mb: 0.75 } }}>
                    {['identity', 'application', 'os', 'cpu', 'gpu', 'memory', 'ip', 'country', 'activity'].map((key) => (
                        <Typography key={key} component="li" variant="body2">{t(`feedback.fields.${key}`)}</Typography>
                    ))}
                </Box>
                <Alert severity="info">{t('feedback.privacy')}</Alert>
                <Typography variant="body2">{t('feedback.excluded')}</Typography>
            </SettingsSection>

            <SettingsSection title={t('feedback.delivery_title')}>
                <Typography variant="body2">{t('feedback.delivery')}</Typography>
                <Typography variant="body2">{t('feedback.retention')}</Typography>
                <Typography variant="body2">{t('feedback.withdrawal')}</Typography>
            </SettingsSection>
        </Stack>
    );
}
