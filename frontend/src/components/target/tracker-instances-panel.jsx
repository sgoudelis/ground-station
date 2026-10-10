import * as React from 'react';
import { Box, Chip, Stack, Tooltip, Typography } from '@mui/material';
import CircleIcon from '@mui/icons-material/Circle';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';

const TrackerInstancesPanel = React.memo(function TrackerInstancesPanel() {
    const { t } = useTranslation('target');
    const instances = useSelector((state) => state.trackerInstances?.instances || []);
    const activeTrackerId = useSelector((state) => state.targetSatTrack?.trackerId || '');

    if (!instances.length) {
        return null;
    }

    return (
        <Box
            sx={{
                px: 1.5,
                py: 0.8,
                borderBottom: '1px solid',
                borderColor: 'divider',
                backgroundColor: 'background.default',
            }}
        >
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                <Typography variant="caption" sx={{ fontWeight: 700 }}>
                    {t('tracker_instances_panel.trackers', { defaultValue: 'Trackers' })}
                </Typography>
                {instances.map((instance, index) => {
                    const trackerId = instance?.tracker_id || 'unknown';
                    const targetNumber = Number(instance?.target_number || (index + 1));
                    const rotatorId = instance?.rotator_id || 'none';
                    const noradId = instance?.tracking_state?.norad_id ?? 'none';
                    const isAlive = Boolean(instance?.is_alive);
                    const isActive = trackerId === activeTrackerId;

                    return (
                        <Tooltip
                            key={trackerId}
                            title={`Target ${targetNumber || '?'} | tracker=${trackerId} rotator=${rotatorId} sat=${noradId} ${isAlive ? 'alive' : 'stopped'}`}
                        >
                            <Chip
                                size="small"
                                color={isActive ? 'primary' : 'default'}
                                variant={isActive ? 'filled' : 'outlined'}
                                icon={<CircleIcon sx={{ fontSize: '0.7rem !important', color: isAlive ? '#22c55e' : '#ef4444' }} />}
                                label={`Target ${targetNumber || '?'} · rot:${rotatorId} · sat:${noradId}`}
                            />
                        </Tooltip>
                    );
                })}
            </Stack>
        </Box>
    );
});

export default TrackerInstancesPanel;
