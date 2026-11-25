import React from 'react';
import { Box, Checkbox, FormControlLabel, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';

export default function IqRetentionFields({ config, onChange, disabled = false }) {
    const { t } = useTranslation('common');
    return (
        <Box sx={{ mt: 2 }}>
            <FormControlLabel
                control={
                    <Checkbox
                        checked={config.delete_after_waterfall === true}
                        onChange={(event) => onChange(event.target.checked)}
                        disabled={disabled || Boolean(config.enable_post_processing)}
                    />
                }
                label={t('scheduler_dialogs.shared.delete_iq_after_waterfall_label')}
            />
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4 }}>
                {t('scheduler_dialogs.shared.delete_iq_after_waterfall_help')}
            </Typography>
        </Box>
    );
}
