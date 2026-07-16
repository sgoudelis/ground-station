import React from 'react';
import { Stack, Typography } from '@mui/material';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

const SyncTerminal = ({ syncState }) => {
    const { t } = useTranslation('satellites');
    const message = syncState['message'] || (
        syncState['progress'] === 0
            ? t('synchronize.terminal.ready')
            : syncState['progress'] === 100
                ? t('synchronize.terminal.complete')
                : t('synchronize.terminal.syncing')
    );

    return (
        <Stack direction="row" spacing={0.75} alignItems="baseline" sx={{ mb: 0.5 }}>
            <Typography variant="caption" color="text.disabled" sx={{ fontWeight: 600, flexShrink: 0 }}>
                {t('synchronize.terminal.output_label', { defaultValue: 'Output:' })}
            </Typography>
            <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                    fontFamily: 'monospace',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                }}
                title={message}
            >
                {message}
            </Typography>
        </Stack>
    );
};

SyncTerminal.propTypes = {
    syncState: PropTypes.object.isRequired,
};

export default SyncTerminal;
