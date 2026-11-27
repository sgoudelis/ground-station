/** Copyright (c) 2026 Efstratios Goudelis. SPDX-License-Identifier: GPL-3.0-or-later */

import React from 'react';
import { Box, MenuItem, TextField } from '@mui/material';
import LanguageOutlinedIcon from '@mui/icons-material/LanguageOutlined';
import { useTranslation } from 'react-i18next';
import { languageOptions } from '../../i18n/languages.js';
import { getAvailableThemesWithMetadata } from '../../themes/theme-configs.js';
import WizardSection from './section.jsx';

export default function LanguageStep({ value, onChange, themeValue, onThemeChange }) {
    const { t } = useTranslation('settings');
    const themes = getAvailableThemesWithMetadata();

    return (
        <WizardSection
            icon={LanguageOutlinedIcon}
            title={t('location.wizard_language_title')}
            description={t('location.wizard_language_help')}
        >
            <Box sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                gap: 3,
                pt: 0.5,
            }}>
                <TextField
                    id="setup-language"
                    select
                    fullWidth
                    label={t('preferences.language')}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                >
                    {languageOptions.map((option) => (
                        <MenuItem key={option.value} value={option.value} lang={option.value.split('_')[0]}>
                            {option.name}
                        </MenuItem>
                    ))}
                </TextField>
                <TextField
                    id="setup-theme"
                    select
                    fullWidth
                    label={t('preferences.theme')}
                    value={themes.some((option) => option.id === themeValue) ? themeValue : 'dark'}
                    onChange={(event) => onThemeChange(event.target.value)}
                >
                    {themes.map((option) => (
                        <MenuItem key={option.id} value={option.id}>
                            {option.name}
                        </MenuItem>
                    ))}
                </TextField>
            </Box>
        </WizardSection>
    );
}
