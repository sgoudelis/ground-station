/** Copyright (c) 2026 Efstratios Goudelis, GPL-3.0-or-later */
import {Box, Grid, Typography} from '@mui/material';
import {useTranslation} from 'react-i18next';
import {TrackerCommandHeaderStatus} from '../target/tracker-command-feedback.jsx';
import HardwareStatusIndicator, {HardwareDeviceIcon} from '../common/hardware-status-indicator.jsx';

export default function HardwareControlHeader({kind, device, emptyLabel, status, connectionStatus, command, lastUpdateAge}) {
    const {t} = useTranslation('common');
    const activityStatus = status === 'connected' ? 'idle' : status;
    const showActivity = !['none', 'disconnected', 'unknown'].includes(status) && activityStatus !== connectionStatus;
    return <Grid size={{xs: 12}} sx={{px: 1.5, py: 1, bgcolor: 'action.hover', borderBottom: '1px solid', borderColor: 'divider'}}>
        <Box sx={{display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, flexWrap: 'nowrap'}}>
            <HardwareDeviceIcon kind={kind} sx={{color: 'text.secondary'}} />
            <Typography variant="caption" noWrap title={device ? `${device.name} (${device.host}:${device.port})` : emptyLabel}
                sx={{fontWeight: 700, fontSize: '0.75rem', flex: 1, minWidth: 0}}>
                {device ? device.name : emptyLabel}
            </Typography>
            {/* Feedback stays inline and truncates before it can grow the header. */}
            <TrackerCommandHeaderStatus kind={kind} command={command} hardwareStatus=""
                sx={{minWidth: 0, maxWidth: '30%'}} showIcon />
            <Box sx={{display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0}}>
                {/* Keep status badges icon-only even when there is no activity badge. */}
                <HardwareStatusIndicator kind={kind} status={connectionStatus} compact />
                {showActivity && <HardwareStatusIndicator kind={kind} status={activityStatus} compact />}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{fontSize: '0.62rem', fontVariantNumeric: 'tabular-nums', flexShrink: 0}}
                title={t('hardware_status.last_update', {defaultValue: 'Time since last hardware update'})}>
                {connectionStatus === 'unknown' || status === 'none' ? '—' : `${lastUpdateAge}s`}
            </Typography>
        </Box>
    </Grid>;
}
