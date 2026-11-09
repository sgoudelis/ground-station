import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Box, Button, Divider, IconButton, Popover, Stack, Tooltip, Typography } from '@mui/material';
import DynamicFeedOutlinedIcon from '@mui/icons-material/DynamicFeedOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import { useDispatch, useSelector } from 'react-redux';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useSocket } from '../common/socket.jsx';
import { setObservedSessionIds } from '../decoders/decoders-slice.jsx';
import { joinSdr } from '../waterfall/sdr-join.js';
import { toast } from '../../utils/toast-with-timestamp.jsx';
import { setDialogOpen, setSelectedObservation } from '../scheduler/scheduler-slice.jsx';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { formatDateTime, formatRelativeTime } from '../../utils/date-time.js';

const EMPTY_SESSIONS = {};
const EMPTY_OBSERVATIONS = [];

const cardSx = {
    p: 1.25,
    border: '1px solid',
    borderColor: 'divider',
    borderLeft: '3px solid',
    borderRadius: 1,
    bgcolor: 'action.hover',
    minWidth: 0,
    overflowWrap: 'anywhere',
};

const statusSx = {
    display: 'block',
    mt: 0.5,
    fontWeight: 600,
    '&::before': {
        content: '""',
        display: 'inline-block',
        width: 5,
        height: 5,
        mr: 0.75,
        mb: '2px',
        borderRadius: '50%',
        bgcolor: 'currentColor',
    },
};

function ObservationSection({ title, children }) {
    return (
        <Stack component="section" spacing={0.75}>
            <Typography component="h3" variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
                {title}
            </Typography>
            {children}
        </Stack>
    );
}

function ObservationAction({ children, onClick, disabled }) {
    return (
        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 1, pt: 0.75, borderTop: '1px solid', borderColor: 'divider' }}>
            <Button onClick={onClick} disabled={disabled} size="small" endIcon={<ChevronRightIcon />}
                sx={{ py: 0.25 }}>
                {children}
            </Button>
        </Box>
    );
}

function RemainingTime({ observation, now, t }) {
    const end = observation.task_end || observation.pass?.event_end;
    const remaining = end ? new Date(end).getTime() - now : NaN;
    if (!Number.isFinite(remaining)) return null;
    if (remaining <= 0) return <> · {t('observations.ending_soon')}</>;

    const seconds = Math.ceil(remaining / 1000);
    const minutes = Math.floor(seconds / 60);
    const duration = minutes >= 60
        ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
        : minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
    return <> · {t('observations.time_remaining', { duration })}</>;
}

function AutomatedObservation({ observation, now, onView, t, sdrs }) {
    return (
        <Box sx={{ ...cardSx, borderLeftColor: 'success.main' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}>
                {observation.satellite?.name || observation.name || t('observations.unknown_satellite')}
            </Typography>
            {observation.name && observation.name !== observation.satellite?.name && (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                    {observation.name}
                </Typography>
            )}
            <Typography variant="caption" color="success.main" sx={statusSx}>
                {t('observations.running')}
                <RemainingTime observation={observation} now={now} t={t} />
            </Typography>
            <Stack spacing={0.75} sx={{ mt: 1 }}>
                {(observation.sessions || []).map((session, index) => {
                    // These are the observation's configured tasks. Do not present
                    // them as individual worker health checks.
                    const tasks = (session.tasks || []).map((task) => {
                        if (task.type === 'decoder') {
                            return t('observations.decoder', { name: (task.config?.decoder_type || '').toUpperCase() });
                        }
                        return t(`observations.task_${task.type}`, { defaultValue: task.type });
                    });
                    return (
                        <Box key={session.id || index}>
                            <Typography variant="caption" sx={{ display: 'block', fontWeight: 600, overflowWrap: 'anywhere' }}>
                                {sdrs[session.sdr?.id]?.device?.name || session.sdr?.name || session.sdr?.id || t('observations.receiver', { number: index + 1 })}
                            </Typography>
                            {tasks.length > 0 && (
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                    {t('observations.tasks', { tasks: tasks.join(' · ') })}
                                </Typography>
                            )}
                        </Box>
                    );
                })}
            </Stack>
            <ObservationAction onClick={() => onView(observation)}>
                {t('observations.view_observation')}
            </ObservationAction>
        </Box>
    );
}

export default function ObservationsPopover({ anchorEl, buttonRef, onOpen, onClose }) {
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const { socket } = useSocket();
    const { t } = useTranslation('dashboard');
    const { t: waterfallText } = useTranslation('waterfall');
    const { timezone, locale } = useUserTimeSettings();
    const { isStreaming, selectedSDRId, joinedSdrId } = useSelector((state) => state.waterfall);
    const sessions = useSelector((state) => state.sessions?.runtimeSnapshot?.data?.sessions || EMPTY_SESSIONS);
    const sdrs = useSelector((state) => state.sessions?.runtimeSnapshot?.data?.sdrs || EMPTY_SESSIONS);
    const scheduled = useSelector((state) => state.scheduler?.observations || EMPTY_OBSERVATIONS);
    const previousSessions = useRef(sessions);
    const [busy, setBusy] = useState(false);
    const [now, setNow] = useState(() => Date.now());
    // The dashboard indicator lists every SDR, even outside the waterfall page.
    const manual = useMemo(() => Object.entries(sessions).filter(([id, session]) => (
        session.sdr_id && session.background?.enabled
        && !session.is_internal && !session.metadata?.observation_id && !id.startsWith('internal:')
    )), [sessions]);
    // Discover backend-owned runs from the live snapshot, including before the
    // scheduler page has been opened. Browser viewers must not count as runs.
    const continuous = useMemo(() => Object.entries(sessions).filter(([, session]) => (
        session.is_internal && session.metadata?.continuous_observation_id
        && session.sdr_id && sdrs[session.sdr_id]?.alive
    )), [sessions, sdrs]);
    // Count scheduler observations, rather than their SDR sessions, so a
    // multi-receiver observation appears exactly once in the badge and list.
    const automated = useMemo(() => scheduled.filter((observation) => observation.status === 'running'), [scheduled]);
    const next = useMemo(() => scheduled
        .filter((observation) => observation.enabled && observation.status === 'scheduled')
        .map((observation) => ({ observation, start: new Date(observation.task_start || observation.pass?.event_start).getTime() }))
        .filter(({ start }) => start > now)
        .sort((a, b) => a.start - b.start)[0]?.observation, [scheduled, now]);
    const activeCount = automated.length + manual.length + continuous.length;
    const open = Boolean(anchorEl) && activeCount > 0;
    const label = t('observations.title');

    useEffect(() => {
        // Clear the shared anchor when activity ends so a later run starts closed.
        if (activeCount === 0 && anchorEl) onClose();
    }, [activeCount, anchorEl, onClose]);

    useEffect(() => {
        // Countdown updates only while the popover is visible.
        if (!open) return undefined;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [open]);

    useEffect(() => {
        // JOIN already hydrated the current observations. An older runtime
        // snapshot must not erase them while the next snapshot is in flight.
        if (previousSessions.current === sessions) return;
        previousSessions.current = sessions;
        dispatch(setObservedSessionIds([...manual, ...continuous]
            .filter(([, session]) => isStreaming && session.sdr_id === selectedSDRId)
            .map(([id]) => id)));
    }, [dispatch, sessions, manual, continuous, isStreaming, selectedSDRId]);

    const takeControl = async (sdrId) => {
        setBusy(true);
        try {
            const response = await joinSdr(socket, dispatch, sdrId, 'claim-sdr');
            if (!response?.success) throw new Error(response?.error || 'Could not take control');
            onClose();
        } catch (error) {
            toast.error(error.message);
        } finally {
            setBusy(false);
        }
    };

    const joinContinuous = async (session) => {
        setBusy(true);
        try {
            // Identify the definition as well as the receiver so a stale card
            // cannot attach the user to a different run on the same hardware.
            const response = await joinSdr(socket, dispatch, session.sdr_id, 'watch-sdr', {
                continuousObservationId: session.metadata.continuous_observation_id,
            });
            if (!response?.success) throw new Error(response?.error || t('observations.join_failed'));
            onClose();
            navigate('/waterfall');
        } catch (error) {
            toast.error(error.message);
        } finally {
            setBusy(false);
        }
    };

    const viewObservation = (observation) => {
        onClose();
        dispatch(setSelectedObservation(observation));
        dispatch(setDialogOpen(true));
    };

    const openScheduler = () => {
        onClose();
        navigate('/scheduler');
    };

    // Keep the session synchronization effects mounted while the icon is hidden.
    if (activeCount === 0) return null;

    return (
        <>
            <Tooltip title={t('observations.active_count', { count: activeCount })}>
                <IconButton ref={buttonRef} aria-label={label} aria-haspopup="dialog" aria-expanded={open}
                    aria-controls={open ? 'observations-popover' : undefined}
                    size="small" onClick={onOpen}
                    sx={{ width: 40, color: 'success.main', '&:hover': { backgroundColor: 'overlay.light' } }}>
                    <Badge badgeContent={activeCount} max={99}
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
            <Popover id="observations-popover" open={open} anchorEl={anchorEl} onClose={onClose}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                slotProps={{ paper: {
                    role: 'dialog', 'aria-labelledby': 'observations-title',
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
                <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ px: 1.25, py: 1 }}>
                    <Typography id="observations-title" variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                        {label}
                    </Typography>
                    <Typography variant="caption" color="success.main" sx={{ fontWeight: 600 }}>
                        {t('observations.active_count', { count: activeCount })}
                    </Typography>
                </Stack>
                <Divider />
                <Stack spacing={1.5} sx={{ px: 1.25, py: 1.25, maxHeight: '60vh', overflowY: 'auto' }}>
                    {automated.length > 0 && (
                        <ObservationSection title={t('observations.automated')}>
                            {automated.map((observation) => (
                                <AutomatedObservation key={observation.id} observation={observation} now={now}
                                    onView={viewObservation} t={t} sdrs={sdrs} />
                            ))}
                        </ObservationSection>
                    )}
                    {continuous.length > 0 && (
                        <ObservationSection title={t('observations.continuous')}>
                            {continuous.map(([id, session]) => (
                                <Box key={id} sx={{ ...cardSx, borderLeftColor: 'success.main' }}>
                                    <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2, overflowWrap: 'anywhere' }}>
                                        {session.metadata.name || t('observations.continuous_observation')}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35, overflowWrap: 'anywhere' }}>
                                        {sdrs[session.sdr_id]?.device?.name || session.sdr_id}
                                    </Typography>
                                    <Typography variant="caption" color="success.main" sx={{ ...statusSx, mb: 0.75 }}>
                                        {t('observations.view_only')}
                                    </Typography>
                                    {Object.entries(session.vfos || {}).filter(([, vfo]) => vfo.active).map(([number, vfo]) => (
                                        <Typography key={number} component="div" variant="caption" sx={{ fontFamily: 'monospace', lineHeight: 1.6 }}>
                                            VFO {number}: {(vfo.center_freq / 1e6).toFixed(6)} MHz · {vfo.decoder && vfo.decoder !== 'none' ? vfo.decoder : vfo.modulation}
                                        </Typography>
                                    ))}
                                    <ObservationAction disabled={busy || !socket || socket.connected === false}
                                        onClick={() => joinContinuous(session)}>
                                        {t('observations.join')}
                                    </ObservationAction>
                                </Box>
                            ))}
                        </ObservationSection>
                    )}
                    {manual.length > 0 && (
                        <ObservationSection title={t('observations.manual_background')}>
                            {manual.map(([id, observation]) => (
                                <Box key={id} sx={{
                                    ...cardSx,
                                    borderLeftColor: observation.background.controller_connected ? 'success.main' : 'info.main',
                                }}>
                                    <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2, overflowWrap: 'anywhere' }}>
                                        {observation.metadata?.username || waterfallText('background.observation', { defaultValue: 'Observation' })}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.35, overflowWrap: 'anywhere' }}>
                                        {sdrs[observation.sdr_id]?.device?.name || observation.sdr_id}
                                    </Typography>
                                    <Typography variant="caption" sx={{
                                        ...statusSx,
                                        color: observation.background.controller_connected ? 'success.main' : 'info.main',
                                        mb: 0.75,
                                    }}>
                                        {observation.background.controller_connected
                                            ? waterfallText('background.controlled', { defaultValue: 'Controller connected' })
                                            : waterfallText('background.unattended', { defaultValue: 'Unattended · frequencies held' })}
                                    </Typography>
                                    {Object.entries(observation.vfos || {}).filter(([, vfo]) => vfo.active).map(([number, vfo]) => (
                                        <Typography key={number} component="div" variant="caption" sx={{ fontFamily: 'monospace', lineHeight: 1.6 }}>
                                            VFO {number}: {(vfo.center_freq / 1e6).toFixed(6)} MHz · {vfo.decoder !== 'none' ? vfo.decoder : vfo.modulation}
                                        </Typography>
                                    ))}
                                    {isStreaming && joinedSdrId === observation.sdr_id && !observation.background.controller_connected && (
                                        <Box sx={{ mt: 1 }}>
                                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                                                {waterfallText('background.adopt_description', { defaultValue: 'Adopt the running observation and replace your current VFOs.' })}
                                            </Typography>
                                            <Button disabled={busy} onClick={() => takeControl(observation.sdr_id)} variant="outlined" size="small">
                                                {waterfallText('background.take_control', { defaultValue: 'Take control' })}
                                            </Button>
                                        </Box>
                                    )}
                                </Box>
                            ))}
                        </ObservationSection>
                    )}
                    {next && (
                        <>
                            <Divider />
                            <ObservationSection title={t('observations.next_scheduled')}>
                                <Box sx={{ ...cardSx, borderLeftColor: 'divider' }}>
                                    <Stack direction="row" spacing={1} alignItems="flex-start">
                                        <ScheduleOutlinedIcon sx={{ fontSize: 18, color: 'text.secondary', mt: 0.25 }} />
                                        <Box sx={{ minWidth: 0 }}>
                                            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                                {next.satellite?.name || next.name || t('observations.unknown_satellite')}
                                            </Typography>
                                            <Typography variant="body2" sx={{ mt: 0.5 }}>
                                                {t('observations.starts_at', { time: formatRelativeTime(next.task_start || next.pass?.event_start, { now, locale }) })}
                                            </Typography>
                                            <Typography component="time" dateTime={next.task_start || next.pass?.event_start}
                                                variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }}>
                                                {formatDateTime(next.task_start || next.pass?.event_start, {
                                                    timezone, locale,
                                                    options: { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' },
                                                })}
                                            </Typography>
                                        </Box>
                                    </Stack>
                                    <ObservationAction onClick={() => viewObservation(next)}>
                                        {t('observations.view_observation')}
                                    </ObservationAction>
                                </Box>
                            </ObservationSection>
                        </>
                    )}
                </Stack>
                <Divider />
                <Box sx={{ px: 1.25, py: 0.75 }}>
                    <Button fullWidth size="small" onClick={openScheduler} endIcon={<ChevronRightIcon />}
                        sx={{ justifyContent: 'space-between', px: 0.75 }}>
                        {t('observations.open_scheduler')}
                    </Button>
                </Box>
            </Popover>
        </>
    );
}
