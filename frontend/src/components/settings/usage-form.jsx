/** Copyright (c) 2026 Efstratios Goudelis. SPDX-License-Identifier: GPL-3.0-or-later */
import React from 'react';
import { Alert, Box, Stack } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { SettingsSection } from './shared/index.js';
import UsageChoice from './usage-choice.jsx';

export default function UsageForm({ enabled, onChange, disabled, error, storageError }) {
    const { t } = useTranslation('settings');
    return (
        <SettingsSection title={t('usage.title')} description={t('usage.info')}>
            <Stack spacing={1.5}>
                {error && <Alert severity="error">{error}</Alert>}
                {storageError && <Alert severity="error">{t('usage.storage_error')}</Alert>}
                <Box sx={{
                    p: 1.5,
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    backgroundColor: (theme) => theme.palette.mode === 'dark'
                        ? alpha(theme.palette.grey[700], 0.18)
                        : alpha(theme.palette.grey[100], 0.9),
                }}>
                    <UsageChoice enabled={enabled} onChange={onChange} disabled={disabled} showDetails={false} />
                </Box>
            </Stack>
        </SettingsSection>
    );
}
