/** Copyright (c) 2026 Efstratios Goudelis, GPL-3.0-or-later */
import { Box } from '@mui/material';
import ManageHistoryIcon from '@mui/icons-material/ManageHistory';
import { useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import StatusOverlay from '../components/common/status-overlay.jsx';
import { useUserTimeSettings } from '../hooks/useUserTimeSettings.jsx';
import { formatTime } from '../utils/date-time.js';

const EMPTY_OBSERVATIONS = [];
const DISPLAY_STATUSES = ['failed', 'starting', 'running', 'stopping'];

const useSchedulerObservations = () => ({
    scheduled: useSelector((state) => state.scheduler?.observations || EMPTY_OBSERVATIONS),
    continuous: useSelector((state) => state.continuousObservations?.definitions || EMPTY_OBSERVATIONS),
});

const countStatuses = (observations, continuous = false) => {
    const counts = {};
    for (const observation of observations) {
        // Startup preferences and retained resources are independent of reception status.
        const status = continuous ? observation.runtime?.status : observation.status;
        counts[status] = (counts[status] || 0) + 1;
    }
    return counts;
};

const overlayType = (counts, runningType) => {
    // Surface faults first, including failed continuous runs that still hold a receiver.
    if (counts.failed) return 'error';
    if (counts.starting || counts.stopping) return 'spinner';
    return counts.running ? runningType : null;
};

export const SchedulerIconWithStatus = () => {
    const { scheduled, continuous } = useSchedulerObservations();
    const scheduledOverlay = overlayType(countStatuses(scheduled), 'play');
    const continuousOverlay = overlayType(countStatuses(continuous, true), 'continuous');

    return (
        <Box sx={{ position: 'relative', display: 'inline-flex' }}>
            <ManageHistoryIcon />
            {continuousOverlay && <StatusOverlay type={continuousOverlay} side="left" />}
            {scheduledOverlay && <StatusOverlay type={scheduledOverlay} />}
        </Box>
    );
};

const formatTimeUntil = (targetDate) => {
    const minutes = Math.max(0, Math.floor((new Date(targetDate) - Date.now()) / 60000));
    const hours = Math.floor(minutes / 60);
    if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    return `${minutes}m`;
};

export const SchedulerStatusTooltip = () => {
    const { t } = useTranslation('navigation');
    const { scheduled, continuous } = useSchedulerObservations();
    const { timezone, locale } = useUserTimeSettings();
    const lines = [];

    for (const [kind, observations] of [['scheduled', scheduled], ['continuous', continuous]]) {
        const counts = countStatuses(observations, kind === 'continuous');
        for (const status of DISPLAY_STATUSES) {
            if (counts[status]) {
                lines.push(t(`scheduler_status.${kind}_${status}`, { count: counts[status] }));
            }
        }
    }

    const running = scheduled.filter((observation) => observation.status === 'running');
    const primary = running[0];
    const endTime = primary?.task_end || primary?.pass?.event_end;
    const timeLabel = (time) => formatTime(time, {
        timezone, locale, options: { hour: '2-digit', minute: '2-digit', hour12: false },
    });
    if (primary) {
        lines.push(t('scheduler_status.active', {
            name: `${primary.satellite?.name || 'Unknown'}${running.length > 1 ? ` +${running.length - 1}` : ''}`,
            remaining: endTime ? formatTimeUntil(endTime) : 'N/A',
            end: endTime ? timeLabel(endTime) : 'N/A',
        }));
    }

    const next = scheduled
        .filter((observation) => observation.enabled && observation.status === 'scheduled')
        .map((observation) => ({
            ...observation, startTime: new Date(observation.task_start || observation.pass?.event_start),
        }))
        .filter((observation) => observation.startTime > Date.now())
        .sort((a, b) => a.startTime - b.startTime)[0];
    if (next) {
        lines.push(t('scheduler_status.next', {
            name: next.satellite?.name || 'Unknown',
            remaining: formatTimeUntil(next.startTime),
            start: timeLabel(next.startTime),
        }));
    }

    return (
        <Box>
            <Box>{t('scheduler')}</Box>
            {lines.map((line, index) => <Box key={index}>{line}</Box>)}
        </Box>
    );
};
