import React from 'react';
import { Box, Typography } from '@mui/material';
import LinearProgress from '@mui/material/LinearProgress';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

const SyncProgressBar = ({ syncState }) => {
    const { t } = useTranslation('satellites');
    const progress = Number(syncState?.progress || 0);
    const normalizedProgress = Number.isFinite(progress)
        ? Math.max(0, Math.min(100, progress))
        : 0;

    return (
        <>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.75 }}>
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500 }}>
                    {t('synchronize.progress.title')}
                </Typography>
                <Typography variant="caption" color="text.disabled" sx={{ fontFamily: 'monospace' }}>
                    {`${Math.round(normalizedProgress)}%`}
                </Typography>
            </Box>

            <LinearProgress
                variant="determinate"
                value={normalizedProgress}
                sx={{ height: 3, borderRadius: 999, mb: 0.75 }}
            />
        </>
    );
};

SyncProgressBar.propTypes = {
    syncState: PropTypes.object.isRequired,
};

export default SyncProgressBar;
