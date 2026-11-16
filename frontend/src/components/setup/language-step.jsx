/** Copyright (c) 2026 Efstratios Goudelis. SPDX-License-Identifier: GPL-3.0-or-later */

import React from 'react';
import { Box, MenuItem, TextField } from '@mui/material';
import LanguageOutlinedIcon from '@mui/icons-material/LanguageOutlined';
import { useTranslation } from 'react-i18next';
import { languageOptions } from '../../i18n/languages.js';
import WizardSection from './section.jsx';

export default function LanguageStep({ value, onChange }) {
    const { t } = useTranslation('settings');

    return (
        <WizardSection
            icon={LanguageOutlinedIcon}
            title={t('location.wizard_language_title')}
            description={t('location.wizard_language_help')}
        >
            <Box sx={{ maxWidth: 480, pt: 0.5 }}>
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
            </Box>
        </WizardSection>
    );
}
