import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Box, Button, Divider, IconButton, Popover, Stack, Tooltip, Typography } from '@mui/material';
import DynamicFeedOutlinedIcon from '@mui/icons-material/DynamicFeedOutlined';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import { useSocket } from '../common/socket.jsx';
import { setObservedSessionIds } from '../decoders/decoders-slice.jsx';
import { joinSdr } from '../waterfall/sdr-join.js';
import { toast } from '../../utils/toast-with-timestamp.jsx';

const EMPTY_SESSIONS = {};

export default function BackgroundObservationsPopover() {
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const { t } = useTranslation('waterfall');
    const { isStreaming, selectedSDRId, joinedSdrId } = useSelector((state) => state.waterfall);
    const sessions = useSelector((state) => state.sessions?.runtimeSnapshot?.data?.sessions || EMPTY_SESSIONS);
    const sdrs = useSelector((state) => state.sessions?.runtimeSnapshot?.data?.sdrs || EMPTY_SESSIONS);
    const previousSessions = useRef(sessions);
    const [busy, setBusy] = useState(false);
    const [anchor, setAnchor] = useState(null);
    // The dashboard indicator lists every SDR, even outside the waterfall page.
    const observations = useMemo(() => Object.entries(sessions).filter(([, session]) => (
        session.sdr_id && session.background?.enabled
    )), [sessions]);
    const open = Boolean(anchor) && observations.length > 0;
    const label = t('background.observations', { defaultValue: 'Background observations' });

    useEffect(() => {
        // JOIN already hydrated the current observations. An older runtime
        // snapshot must not erase them while the next snapshot is in flight.
        if (previousSessions.current === sessions) return;
        previousSessions.current = sessions;
        dispatch(setObservedSessionIds(observations
            .filter(([, session]) => isStreaming && session.sdr_id === selectedSDRId)
            .map(([id]) => id)));
    }, [dispatch, sessions, observations, isStreaming, selectedSDRId]);

    useEffect(() => {
        // Drop the anchor when the last observation disappears with its icon.
        if (observations.length === 0) setAnchor(null);
    }, [observations.length]);

    const takeControl = async (sdrId) => {
        setBusy(true);
        try {
            const response = await joinSdr(socket, dispatch, sdrId, 'claim-sdr');
            if (!response?.success) throw new Error(response?.error || 'Could not take control');
            setAnchor(null);
        } catch (error) {
            toast.error(error.message);
        } finally {
            setBusy(false);
        }
    };

    if (observations.length === 0) return null;

    return (
        <>
            <Tooltip title={label}>
                <IconButton aria-label={label} aria-haspopup="dialog" aria-expanded={open}
                    aria-controls={open ? 'background-observations-popover' : undefined}
                    size="small" onClick={(event) => setAnchor(event.currentTarget)}
                    sx={{ width: 40, color: 'success.main', '&:hover': { backgroundColor: 'overlay.light' } }}>
                    <Badge badgeContent={observations.length} max={99}
                        anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                        sx={{
                            '& .MuiBadge-badge': {
                                minWidth: 14,
                                height: 14,
                                px: 0.4,
                                bgcolor: 'background.paper',
                                color: 'text.secondary',
                                border: '1px solid',
                                borderColor: 'divider',
                                fontSize: '0.55rem',
                                fontWeight: 700,
                            },
                        }}>
                        <DynamicFeedOutlinedIcon />
                    </Badge>
                </IconButton>
            </Tooltip>
            <Popover id="background-observations-popover" open={open} anchorEl={anchor} onClose={() => setAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                slotProps={{ paper: {
                    role: 'dialog', 'aria-labelledby': 'background-observations-title',
                    sx: {
                        mt: 0.5,
                        width: 360,
                        maxWidth: 'calc(100vw - 24px)',
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1.25,
                        overflow: 'hidden',
                        bgcolor: 'background.paper',
                    },
                } }}>
                <Stack direction="row" alignItems="baseline" spacing={0.5} sx={{ px: 1.25, py: 0.75 }}>
                    <Typography id="background-observations-title" variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                        {label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">• {observations.length}</Typography>
                </Stack>
                <Divider />
                <Stack spacing={0.75} sx={{ px: 1.25, py: 1, maxHeight: '60vh', overflowY: 'auto' }}>
                    {observations.map(([id, observation]) => (
                        <Box key={id} sx={{
                            px: 1,
                            py: 0.9,
                            border: '1px solid',
                            borderColor: 'divider',
                            borderLeft: '3px solid',
                            borderLeftColor: observation.background.controller_connected ? 'success.main' : 'info.main',
                            borderRadius: 1,
                            bgcolor: 'action.hover',
                        }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2, overflowWrap: 'anywhere' }}>
                                {observation.metadata?.username || t('background.observation', { defaultValue: 'Observation' })}
                            </Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35, overflowWrap: 'anywhere' }}>
                                {sdrs[observation.sdr_id]?.device?.name || observation.sdr_id}
                            </Typography>
                            <Typography variant="caption" sx={{
                                display: 'block',
                                color: observation.background.controller_connected ? 'success.main' : 'info.main',
                                fontWeight: 600,
                                mb: 0.5,
                            }}>
                                {observation.background.controller_connected
                                    ? t('background.controlled', { defaultValue: 'Controller connected' })
                                    : t('background.unattended', { defaultValue: 'Unattended · frequencies held' })}
                            </Typography>
                            {Object.entries(observation.vfos || {}).filter(([, vfo]) => vfo.active).map(([number, vfo]) => (
                                <Typography key={number} component="div" variant="caption" sx={{ fontFamily: 'monospace', lineHeight: 1.6 }}>
                                    VFO {number}: {(vfo.center_freq / 1e6).toFixed(6)} MHz · {vfo.decoder !== 'none' ? vfo.decoder : vfo.modulation}
                                </Typography>
                            ))}
                            {isStreaming && joinedSdrId === observation.sdr_id && !observation.background.controller_connected && (
                                <Box sx={{ mt: 1 }}>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                                        {t('background.adopt_description', { defaultValue: 'Adopt the running observation and replace your current VFOs.' })}
                                    </Typography>
                                    <Button disabled={busy} onClick={() => takeControl(observation.sdr_id)} variant="outlined" size="small">
                                        {t('background.take_control', { defaultValue: 'Take control' })}
                                    </Button>
                                </Box>
                            )}
                        </Box>
                    ))}
                </Stack>
            </Popover>
        </>
    );
}
