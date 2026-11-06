import React from 'react';
import {Box, Tooltip, Typography} from '@mui/material';
import {commandLabel, isCommandOutstanding, isCommandSpinning} from './tracker-command-state.js';

import AutorenewIcon from '@mui/icons-material/Autorenew';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';

const COMPLETION_DISPLAY_MS = 3000;

export function TrackerCommandHeaderStatus({kind = 'rotator', command, hardwareStatus, hardwareIcon, stale = false, sx = {}, showIcon = false}) {
    const [, refresh] = React.useReducer(value => value + 1, 0);
    const completedAt = command?.updatedAt ?? (command?.updated_at * 1000);
    const completionDeadline = completedAt + COMPLETION_DISPLAY_MS;
    React.useEffect(() => {
        if (command?.status !== 'succeeded') return;
        const remaining = completionDeadline - Date.now();
        if (!(remaining > 0)) return;
        // Expire from the recorded result time, so telemetry updates and
        // reopening the dialog cannot restart an old completion message.
        const timer = window.setTimeout(refresh, remaining);
        return () => window.clearTimeout(timer);
    }, [command?.status, completionDeadline]);

    // The rig's backend "stop" action pauses frequency updates; only a rotator
    // Stop requests a physical halt. Keep that distinction in progress/results.
    const rigPause = kind === 'rig' && command?.action === 'stop';
    const feedback = rigPause && command.status === 'started' ? 'Pausing tracking…'
        : rigPause && command.status === 'succeeded' ? 'Tracking paused'
        : rigPause && command.status === 'unknown' ? command.reason || 'Pause unconfirmed' : commandLabel(command);
    const hardwareLabel = stale ? 'Hardware status unavailable' : hardwareStatus;
    const actionName = rigPause ? 'Pause' : ({move: 'Move', stop: 'Stop', park: 'Park', connect: 'Connect',
        disconnect: 'Disconnect', track: 'Tracking'})[command?.action] || 'Command';
    const unresolved = command?.status === 'unknown' && !command.reconciled;
    const unconfirmedStop = !rigPause && command?.status === 'unknown' && command.action === 'stop';
    let label = hardwareLabel;
    if (command?.status === 'failed') label = `${actionName} failed`;
    else if (unconfirmedStop) label = 'Stop unconfirmed';
    else if (unresolved) label = rigPause ? 'Pause unconfirmed' : 'Status unknown';
    else if (command?.status === 'cancelled') label = `${actionName} cancelled`;
    else if (isCommandSpinning(command)) label = feedback;
    else if (!stale && command?.status === 'succeeded' && Date.now() < completionDeadline) label = feedback;

    const details = [hardwareLabel && `Hardware: ${hardwareLabel}`, feedback && `Last command: ${feedback}`,
        command?.reason && command.reason !== feedback ? command.reason : null].filter(Boolean).join(' · ');
    const color = command?.status === 'failed' ? 'operational.fault.main'
        : stale || unresolved || unconfirmedStop ? 'operational.attention.main'
        : isCommandOutstanding(command) ? 'operational.busy.main' : 'text.secondary';

    if (!label) return null;
    const spinning = isCommandSpinning(command);
    // When command feedback expires, restore the hardware state's own icon too.
    const Icon = spinning ? AutorenewIcon
        : label === hardwareLabel && hardwareIcon ? hardwareIcon
        : command?.status === 'succeeded' ? CheckCircleOutlineIcon : ErrorOutlineIcon;

    // Reuse the existing status line. Long errors stay accessible without
    // wrapping or changing the controls' height.
    return <Tooltip title={details} describeChild enterTouchDelay={0}>
        <Typography variant="caption" noWrap tabIndex={0} role="status" aria-atomic="true"
            sx={{display: 'flex', alignItems: 'center', gap: 0.5, color, fontSize: '0.62rem', lineHeight: 1.1, ...sx}}>
            {showIcon && <Icon sx={{fontSize: 13, flexShrink: 0,
                animation: spinning ? 'command-feedback-spin 1s linear infinite' : 'none',
                '@keyframes command-feedback-spin': {to: {transform: 'rotate(360deg)'}},
                '@media (prefers-reduced-motion: reduce)': {animation: 'none'},
            }} />}
            <Box component="span" sx={{overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'}}>{label}</Box>
        </Typography>
    </Tooltip>;
}
