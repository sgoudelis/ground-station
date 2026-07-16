import React from 'react';
import { Box, Typography, Button, Chip, Stack } from '@mui/material';
import { alpha } from '@mui/material/styles';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import SyncIcon from '@mui/icons-material/Sync';
import PendingActionsIcon from '@mui/icons-material/PendingActions';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { humanizeDate, humanizeFutureDateInMinutes } from '../common/common.jsx';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { formatDateTime } from '../../utils/date-time.js';
import PropTypes from 'prop-types';
import { useTranslation } from 'react-i18next';

const SyncCardHeader = ({ syncState, onSynchronize }) => {
    const { t } = useTranslation('satellites');
    const { timezone, locale } = useUserTimeSettings();
    const normalizedStatus = String(syncState?.status || '').toLowerCase();
    const progress = Number(syncState?.progress || 0);
    const isSyncing = ['inprogress', 'in_progress', 'started', 'running'].includes(normalizedStatus)
        || (progress > 0 && progress < 100);
    const isCompleted = normalizedStatus === 'complete' && syncState?.success !== false;
    const lastUpdateText = t('synchronize.header.last_update', { date: humanizeDate(syncState.last_update) });
    const nextScheduledSyncRelative = syncState?.next_scheduled_sync_at
        ? humanizeFutureDateInMinutes(syncState.next_scheduled_sync_at)
        : '';
    const formattedNextScheduledSync = formatDateTime(syncState?.next_scheduled_sync_at, {
        timezone,
        locale,
    });
    const nextScheduledSyncText = nextScheduledSyncRelative
        ? t('synchronize.header.next_scheduled_sync', {
            defaultValue: 'Next scheduled sync: {{when}}',
            when: nextScheduledSyncRelative,
        })
        : t('synchronize.header.next_scheduled_sync_unknown', {
            defaultValue: 'Next scheduled sync: Not available',
        });
    const nextScheduledSyncTooltipText = formattedNextScheduledSync
        ? t('synchronize.header.next_scheduled_sync_exact', {
            defaultValue: 'Next scheduled sync: {{date}}',
            date: formattedNextScheduledSync,
        })
        : nextScheduledSyncText;

    return (
        <>
            <Box
                sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 1.5,
                }}
            >
                <Stack direction="row" spacing={1.5} alignItems="center">
                    <Box
                        sx={{
                            width: 36,
                            height: 36,
                            borderRadius: 1.5,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'primary.main',
                            backgroundColor: (theme) =>
                                theme.palette.mode === 'dark'
                                    ? alpha(theme.palette.primary.main, 0.22)
                                    : alpha(theme.palette.primary.main, 0.12),
                            flexShrink: 0,
                        }}
                    >
                        <SatelliteAltIcon sx={{ fontSize: 20 }} />
                    </Box>
                    <Box>
                        <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
                            {t('synchronize.header.title')}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ lineHeight: 1.4 }}>
                            {t('synchronize.header.subtitle')}
                        </Typography>
                    </Box>
                </Stack>

                <Button
                    disabled={isSyncing}
                    variant="contained"
                    color="primary"
                    onClick={onSynchronize}
                    size="small"
                    startIcon={<SyncIcon fontSize="small" />}
                    sx={{ flexShrink: 0 }}
                >
                    {isSyncing
                        ? t('synchronize.header.syncing_button', { defaultValue: 'Synchronizing...' })
                        : t('synchronize.header.button')}
                </Button>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1 }}>
                <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500, flexShrink: 0 }}>
                    {t('synchronize.header.status', { defaultValue: 'Status' })}
                </Typography>
                {isSyncing ? (
                    <Chip
                        size="small"
                        color="info"
                        icon={<PendingActionsIcon />}
                        label={t('synchronize.header.status_running', { defaultValue: 'Running' })}
                    />
                ) : isCompleted ? (
                    <Chip
                        size="small"
                        color="success"
                        icon={<CheckCircleOutlineIcon />}
                        label={t('synchronize.header.status_completed', { defaultValue: 'Completed' })}
                    />
                ) : (
                    <Chip
                        size="small"
                        variant="outlined"
                        label={t('synchronize.header.status_idle', { defaultValue: 'Idle' })}
                    />
                )}
                <Box
                    sx={{
                        ml: 'auto',
                        minWidth: 0,
                    }}
                >
                    <Typography
                        variant="caption"
                        color="text.disabled"
                        sx={{
                            display: 'block',
                            fontFamily: 'monospace',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            textAlign: 'right',
                        }}
                        title={lastUpdateText}
                    >
                        {lastUpdateText}
                    </Typography>
                    <Typography
                        variant="caption"
                        color="text.disabled"
                        sx={{
                            display: 'block',
                            fontFamily: 'monospace',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            textAlign: 'right',
                        }}
                        title={nextScheduledSyncTooltipText}
                    >
                        {nextScheduledSyncText}
                    </Typography>
                </Box>
            </Box>
        </>
    );
};

SyncCardHeader.propTypes = {
    syncState: PropTypes.object.isRequired,
    onSynchronize: PropTypes.func.isRequired,
};

export default SyncCardHeader;
