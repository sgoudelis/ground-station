/** Copyright (c) 2026 Efstratios Goudelis, GPL-3.0-or-later */
import React, {useEffect, useId, useState} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import {useTranslation} from 'react-i18next';
import {
    Alert, Box, Button, ButtonBase, CircularProgress, Collapse, Divider,
    IconButton, Menu, MenuItem, Stack, Tooltip, Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PauseIcon from '@mui/icons-material/Pause';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import OpenWithIcon from '@mui/icons-material/OpenWith';
import LocalParkingIcon from '@mui/icons-material/LocalParking';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import StopIcon from '@mui/icons-material/Stop';
import HardwareStatusIndicator, {HardwareDeviceIcon} from '../common/hardware-status-indicator.jsx';
import {resolveHardwareStatus, resolveHardwareConnectionStatus} from '../common/hardware-status.js';
import {operationalButtonSx, resolveHardwarePresentation} from '../common/hardware-status-presentation.jsx';
import {useSocket} from '../common/socket.jsx';
import ManualRotatorDialog from '../dashboard/manual-rotator-dialog.jsx';
import {deviceKey, fetchHardwareState, isDeviceCommandActive, sendDeviceCommand} from './control-slice.js';
import {
    deviceStatus, EMPTY_LIST, EMPTY_OBJECT, latestDeviceCommand, resolveDeviceOwner, summarizeDevices,
} from './device-control-state.js';

const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const degrees = (value) => finite(value) ? `${Number(value).toFixed(1)}°` : '—';
const frequency = (value) => finite(value) && Number(value) > 0 ? `${(Number(value) / 1e6).toFixed(6)} MHz` : '—';
// Device telemetry and command results can wrap the same connection error
// differently. Remove that shared context before comparing their details.
const detailText = (value) => String(value).trim().replace(/^Error connecting to (?:rotator|rig):\s*/i, '');

function useNow() {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);
    return Math.max(now, Date.now());
}

function TelemetryValue({label, value}) {
    return <Box sx={{minWidth: 0}}>
        <Typography variant="caption" noWrap color="text.secondary" sx={{display: 'block'}}>{label}</Typography>
        <Typography variant="body2" noWrap title={value} sx={{fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', fontWeight: 600}}>
            {value}
        </Typography>
    </Box>;
}

function DeviceAction({reason, children, sx, ...props}) {
    return <Button fullWidth size="small" variant="outlined" disabled={Boolean(reason)}
        sx={[{minWidth: 0, minHeight: 34, px: 1, lineHeight: 1.3}, ...(Array.isArray(sx) ? sx : [sx])]} {...props}>{children}</Button>;
}

function DeviceFeedback({message, severity, pending}) {
    return <Tooltip title={message}>
        <Stack component="span" direction="row" spacing={0.5} alignItems="center"
            sx={{minWidth: 0, maxWidth: '100%'}}>
            {pending ? <CircularProgress size={13} sx={{color: 'operational.busy.main'}} /> : severity === 'success'
                ? <CheckCircleOutlineIcon sx={{fontSize: 15, color: 'operational.active.main'}} />
                : <ErrorOutlineIcon sx={{fontSize: 15, color: severity === 'error' ? 'operational.fault.main' : 'operational.attention.main'}} />}
            <Typography component="span" role="status" aria-live="polite" variant="caption" noWrap
                sx={{minWidth: 0, color: severity === 'success' ? 'text.secondary' : `operational.${({error: 'fault', warning: 'attention', info: 'busy'})[severity]}.main`}}>
                {message}
            </Typography>
        </Stack>
    </Tooltip>;
}

function DeviceDetails({message, severity}) {
    const {t} = useTranslation('common');
    const [dismissed, setDismissed] = useState(false);
    if (dismissed) return null;

    const tone = ({success: 'busy', info: 'busy', warning: 'attention', error: 'fault'})[severity];
    return <Alert severity={severity === 'success' ? 'info' : severity}
        onClose={() => setDismissed(true)} closeText={t('close')}
        sx={{borderRadius: 0, py: 0, overflowWrap: 'anywhere', whiteSpace: 'pre-line',
            bgcolor: `operational.${tone}.background`, color: `operational.${tone}.main`,
            '& .MuiAlert-icon': {color: 'inherit'},
        }}>
        {message}
    </Alert>;
}

function DeviceRow({device, kind, snapshot, status, command, owner, expanded, now, error,
    onToggle, onSubmit, onManualControl, onViewOwner, onEdit, socketConnected, loaded}) {
    const {t} = useTranslation('dashboard');
    const contentId = useId();
    const menuId = useId();
    const [menuAnchor, setMenuAnchor] = useState(null);
    const data = snapshot?.data || EMPTY_OBJECT;
    const manual = owner.type === 'manual';
    const observation = owner.type === 'observation';
    const owned = Boolean(owner.type);
    const busy = isDeviceCommandActive(command);
    const canDisconnect = Boolean(data.connected || data.error || owned || busy);
    const ready = socketConnected && loaded && status.known;
    const stopUnsupported = kind === 'rotator' && device.stop_supported === false;
    const connectionStatus = status.key === 'loading' ? 'loading' : resolveHardwareConnectionStatus({
        deviceId: device.id, data: {connected: false, ...data}, available: status.known,
    });
    const hardwareStatus = resolveHardwareStatus({kind, deviceId: device.id, data, available: status.known});
    const activityStatus = hardwareStatus === 'connected' ? 'idle' : hardwareStatus;
    const activityLabel = resolveHardwarePresentation({source: kind, status: activityStatus, t}).label;
    const ownerName = owner.name || (observation ? t('hardware_popover.observation')
        : t('hardware_popover.target', {number: owner.number || ''}).trim());
    const ownerLabel = owned ? manual ? t('hardware_popover.manual_control')
        : `${t(`hardware_popover.${observation ? 'observation' : 'target_label'}`)} · ${ownerName}`
        : t(`hardware_popover.${data.connected ? 'available' : 'not_connected'}`);
    const submitting = ['sending', 'submitted', 'started'].includes(command?.status);
    const feedbackVisible = command && (submitting || ['failed', 'unknown', 'cancelled'].includes(command.status)
        || command.status === 'succeeded' && now - command.updated_at * 1000 < 3000);
    const progressKey = ({connect: 'connecting', disconnect: 'disconnecting', 'take-control': 'transferring',
        release: 'releasing', pause: 'pausing', stop: kind === 'rig' ? 'pausing' : 'stopping', move: 'moving',
        park: 'parking', unpark: 'unparking'})[command?.action] || 'applying';
    const feedback = submitting ? t(`hardware_popover.${progressKey}`)
        : t(`hardware_popover.${command?.status === 'failed' && command.action === 'connect'
            ? 'connection_failed' : `command_${command?.status}`}`);
    const motionWarning = data.motion_unconfirmed
        ? t(`hardware_popover.${data.connected ? 'waiting_stationary' : 'disconnected_motion_unconfirmed'}`) : '';
    const hardwareError = error || (data.error ? data.error_message || t('hardware_popover.communication_failed') : '');
    const unavailable = !socketConnected ? t('hardware_popover.station_offline')
        : !loaded || !status.known ? t(`hardware_popover.status_${status.key}`) : '';
    // Keep the summary short; the dismissible alert is the only full explanation.
    const message = unavailable || (submitting && feedback)
        || (hardwareError && (command?.status === 'failed' ? feedback : t('hardware_popover.device_error')))
        || (motionWarning && t('hardware_popover.motion_unconfirmed'))
        || (data.stop_warning && t('hardware_popover.attention_required'))
        || (feedbackVisible && feedback) || t('hardware_popover.ready');
    const severity = unavailable ? 'warning' : submitting ? 'info' : hardwareError || command?.status === 'failed'
        ? 'error' : motionWarning || data.stop_warning || ['unknown', 'cancelled'].includes(command?.status)
            ? 'warning' : 'success';
    const details = [...new Set([hardwareError, motionWarning, data.stop_warning,
        feedbackVisible && command.reason].filter(Boolean).map(detailText))].join('\n');

    const commandReason = unavailable || (busy ? t('hardware_popover.command_in_progress') : '');
    const connectReason = commandReason || (data.connected ? t('hardware_popover.already_connected')
        : owned && !manual ? t('hardware_popover.manual_control_required') : '');
    const takeControlReason = commandReason || (observation ? t('hardware_popover.controlled_by_observation')
        : manual ? t('hardware_popover.already_manual_control')
            : !data.connected && !owned ? t('hardware_popover.connect_first')
                : data.connected && data.motion_unconfirmed ? motionWarning : '');
    const releaseReason = commandReason || (!manual ? t('hardware_popover.manual_control_required') : '');
    const movementReason = commandReason || (!data.connected ? t('hardware_popover.connect_first')
        : !manual ? t('hardware_popover.manual_control_required') : motionWarning);
    const moveReason = movementReason || (data.parked ? t('hardware_popover.unpark_first')
        : data.tracking ? t('hardware_popover.pause_first') : '');
    // Operator Pause/Stop/Disconnect remain available during other commands and with
    // stale telemetry, including when an observation owns the device.
    const operatorReason = !socketConnected ? t('hardware_popover.station_offline')
        : !loaded ? t(`hardware_popover.status_${status.key}`) : '';
    const pauseReason = operatorReason || (!data.connected ? t('hardware_popover.connect_first')
        : command?.action === 'pause' && busy ? t('hardware_popover.command_in_progress') : '');
    const stopReason = operatorReason || (stopUnsupported ? t('hardware_popover.stop_unsupported')
        : !data.connected ? t('hardware_popover.connect_first')
        : command?.action === 'stop' && busy ? t('hardware_popover.command_in_progress') : '');
    const disconnectReason = operatorReason || (!canDisconnect ? t('hardware_popover.already_disconnected')
        : command?.action === 'disconnect' && busy ? t('hardware_popover.command_in_progress') : '');
    const openOwnerLabel = t(`hardware_popover.${observation ? 'view_observation' : 'open_target'}`);
    const menuAction = (action) => {
        setMenuAnchor(null);
        onSubmit(action);
    };
    const actionGrid = {display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 0.75};

    return <Box component="section" aria-label={device.name}
        sx={{containerType: 'inline-size', border: '1px solid', borderColor: expanded ? 'primary.main' : 'divider', borderRadius: 1.25, overflow: 'hidden'}}>
        <ButtonBase onClick={onToggle} aria-expanded={expanded} aria-controls={contentId}
            sx={{display: 'flex', width: '100%', minWidth: 0, px: 1.25, py: 1, gap: 1, textAlign: 'left',
                bgcolor: expanded ? 'action.hover' : 'transparent', '&:hover': {bgcolor: 'action.hover'}}}>
            <Box sx={{flex: 1, minWidth: 0}}>
                <Typography variant="body2" noWrap title={device.name} sx={{fontWeight: 700}}>{device.name}</Typography>
                <Typography variant="caption" noWrap title={`${device.host}:${device.port}`} color="text.secondary" sx={{display: 'block'}}>
                    {device.host}:{device.port}
                </Typography>
            </Box>
            <Stack spacing={0.4} alignItems="flex-end">
                <HardwareStatusIndicator kind={kind} status={connectionStatus} />
                {data.connected && status.known && <HardwareStatusIndicator kind={kind} status={activityStatus} />}
                {!data.connected && status.known && hardwareStatus === 'motion_unconfirmed' &&
                    <HardwareStatusIndicator kind={kind} status={hardwareStatus} />}
            </Stack>
            <ExpandMoreIcon sx={{fontSize: 19, color: 'text.secondary', transform: expanded ? 'rotate(180deg)' : 'none'}} />
        </ButtonBase>
        {/* Only new or recurring messages reset dismissal; telemetry updates
            must not bring back a message the operator has already closed. */}
        {details && <DeviceDetails key={details} message={details} severity={severity} />}
        <Collapse in={expanded} unmountOnExit>
            <Box id={contentId} sx={{px: 1.25, pt: 0.5, pb: 1.25}}>
                {/* A detailed alert replaces the summary, so each issue uses one row. */}
                {!details && <Box sx={{display: 'flex', alignItems: 'center', minHeight: 24, mb: 0.5}}>
                    <DeviceFeedback message={message} severity={severity} pending={submitting && !unavailable} />
                </Box>}
                <Stack direction="row" spacing={0.75} alignItems="center" sx={{minHeight: 32, mb: 0.75}}>
                    <Typography variant="caption" color="text.secondary">{t('hardware_popover.control_label')}</Typography>
                    <Typography variant="body2" noWrap sx={{flex: 1, minWidth: 0, fontWeight: 600}}
                        title={ready ? ownerLabel : t('hardware_popover.status_unavailable')}>
                        {ready ? ownerLabel : '—'}
                    </Typography>
                    <IconButton size="small" aria-label={openOwnerLabel}
                        disabled={!ready || !owned || manual || !onViewOwner} onClick={() => onViewOwner(owner)}>
                        <OpenInNewIcon sx={{fontSize: 16}} />
                    </IconButton>
                    <IconButton size="small" disabled={!onEdit} aria-label={t('hardware_popover.device_settings')}
                        onClick={() => onEdit(device)}><SettingsOutlinedIcon sx={{fontSize: 18}} /></IconButton>
                </Stack>
                <Box sx={{display: 'grid', gridTemplateColumns: kind === 'rotator' ? '1fr 1fr 1fr' : '2fr 1fr', gap: 1.25, mb: 1.25}}>
                    {kind === 'rotator' ? <>
                        <TelemetryValue label={t('hardware_popover.azimuth')} value={ready && data.connected ? degrees(data.az) : '—'} />
                        <TelemetryValue label={t('hardware_popover.elevation')} value={ready && data.connected ? degrees(data.el) : '—'} />
                    </> : <TelemetryValue label={t('hardware_popover.frequency')}
                        value={ready && data.connected ? frequency(data.frequency) : '—'} />}
                    <TelemetryValue label={t('hardware_popover.activity')}
                        value={ready && data.connected ? activityLabel : '—'} />
                </Box>
                {kind === 'rig' && <Box sx={{display: 'grid', gridTemplateColumns: '1fr', gap: 1.25, mb: 1.25,
                    '@container (min-width: 340px)': {gridTemplateColumns: '1fr 1fr'}}}>
                    {/* Keep VFO slots reserved while samples arrive or disappear. */}
                    <TelemetryValue label={t('hardware_popover.vfo_1_frequency')}
                        value={ready && data.connected ? frequency(data.vfo1?.frequency) : '—'} />
                    <TelemetryValue label={t('hardware_popover.vfo_2_frequency')}
                        value={ready && data.connected ? frequency(data.vfo2?.frequency) : '—'} />
                </Box>}
                <Box sx={actionGrid}>
                    <DeviceAction reason={takeControlReason} onClick={() => onSubmit('take-control')}>
                        {t('hardware_popover.take_manual_control')}
                    </DeviceAction>
                    <DeviceAction reason={releaseReason} onClick={() => onSubmit('release')}>
                        {t('hardware_popover.release_control')}
                    </DeviceAction>
                </Box>
                {kind === 'rotator' && <Box sx={{...actionGrid, mt: 0.75}}>
                    <DeviceAction reason={moveReason} variant="contained" startIcon={<OpenWithIcon />} onClick={() => onManualControl(String(device.id))}>
                        {t('hardware_popover.manual_movement')}
                    </DeviceAction>
                    <DeviceAction aria-label={t('hardware_popover.parking_actions', {name: device.name})}
                        aria-haspopup="menu" aria-controls={menuAnchor ? menuId : undefined}
                        aria-expanded={Boolean(menuAnchor)} startIcon={<LocalParkingIcon />} endIcon={<ExpandMoreIcon />}
                        onClick={(event) => setMenuAnchor(event.currentTarget)}>{t('hardware_popover.parking_actions_label')}</DeviceAction>
                </Box>}
            </Box>
        </Collapse>
        <Divider />
        {/* Keep actions in fixed positions. Four icon+label buttons need a
            wider container than the popover, so narrow panels use two rows. */}
        <Box sx={{display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 0.75, p: 1.25,
            '& > :last-child': {gridColumn: kind === 'rig' ? '1 / -1' : 'auto'},
            [`@container (min-width: ${kind === 'rotator' ? 540 : 340}px)`]: {gridTemplateColumns: kind === 'rotator'
                ? '1fr 1.3fr 1fr 1fr' : 'repeat(3, minmax(0, 1fr))',
                '& > :last-child': {gridColumn: 'auto'}}}}>
            <DeviceAction reason={connectReason} startIcon={<LinkIcon />} onClick={() => onSubmit('connect')}>{t('hardware_popover.connect')}</DeviceAction>
            <DeviceAction reason={disconnectReason} color="inherit" startIcon={<LinkOffIcon />} onClick={() => onSubmit('disconnect')}>
                {t('hardware_popover.disconnect')}
            </DeviceAction>
            <DeviceAction reason={pauseReason}
                color="inherit" startIcon={<PauseIcon sx={{fontSize: '16px !important'}} />}
                onClick={() => onSubmit('pause')}>{t('hardware_popover.pause_tracking')}</DeviceAction>
            {kind === 'rotator' && <DeviceAction reason={stopReason} color="error" variant="contained" sx={operationalButtonSx('fault')}
                startIcon={<StopIcon sx={{fontSize: '16px !important'}} />}
                onClick={() => onSubmit('stop')}>{t('hardware_popover.stop')}</DeviceAction>}
        </Box>
        <Menu id={menuId} anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
            {['park', 'unpark'].map((action) => {
                const reason = movementReason || (action === 'park' && data.parked ? t('hardware_popover.already_parked')
                    : action === 'unpark' && !data.parked ? t('hardware_popover.not_parked') : '');
                // Direct MenuItem children preserve arrow-key navigation. Show
                // disabled prerequisites inline so they are easy to discover.
                return <MenuItem key={action} disabled={Boolean(reason)} aria-label={t(`hardware_popover.${action}`)}
                    onClick={() => menuAction(action)} sx={{display: 'block', maxWidth: 300}}>
                    <Typography variant="body2">{t(`hardware_popover.${action}`)}</Typography>
                    {reason && <Typography variant="caption" component="span"
                        sx={{display: 'block', whiteSpace: 'normal'}}>{reason}</Typography>}
                </MenuItem>;
            })}
        </Menu>
    </Box>;
}

export default function DeviceControlPanel({kind, onManage, onViewOwner, onManualControl, onEdit}) {
    const dispatch = useDispatch();
    const {socket} = useSocket();
    const {t} = useTranslation('dashboard');
    const config = useSelector((state) => kind === 'rotator' ? state.rotators?.rotators : state.rigs?.rigs) || EMPTY_LIST;
    const control = useSelector((state) => state.hardwareControl) || EMPTY_OBJECT;
    const instances = useSelector((state) => state.trackerInstances?.instances) || EMPTY_LIST;
    const views = useSelector((state) => state.targetSatTrack?.trackerViews) || EMPTY_OBJECT;
    const observations = useSelector((state) => state.scheduler?.observations) || EMPTY_LIST;
    const [manualId, setManualId] = useState(null);
    const [errors, setErrors] = useState({});
    const now = useNow();
    // Rank once per popover opening. Live changes update rows in place so the
    // user's pointer and expanded device never jump to a different device.
    const [order] = useState(() => [...config].sort((a, b) => {
        const priority = (row) => {
            const data = control.devices?.[deviceKey(kind, row.id)]?.data;
            return data?.error ? 2 : data?.connected ? 1 : 0;
        };
        return priority(b) - priority(a);
    }).map((row) => String(row.id)));
    const [expandedId, setExpandedId] = useState(() => order.find((id) => {
        const data = control.devices?.[deviceKey(kind, id)]?.data;
        return data?.connected || data?.error;
    }) || (config.length === 1 ? String(config[0].id) : null));
    const devices = [...config].sort((a, b) => {
        const rank = (id) => {const index = order.indexOf(String(id)); return index < 0 ? order.length : index;};
        return rank(a.id) - rank(b.id);
    });
    const summary = summarizeDevices(config.map((row) => ({...row, kind})), control, socket?.connected, now);
    const submit = async (id, action, position) => {
        setErrors((previous) => ({...previous, [id]: ''}));
        try { await dispatch(sendDeviceCommand({socket, kind, deviceId: id, action, position})).unwrap(); }
        catch (reason) { setErrors((previous) => ({...previous, [id]: String(reason)})); }
    };

    return <Box sx={{display: 'flex', flexDirection: 'column', maxHeight: 'min(680px, calc(100dvh - 100px))'}}>
        <Stack direction="row" alignItems="baseline" justifyContent="space-between" sx={{px: 1.5, py: 1.25}}>
            <Typography variant="subtitle2" sx={{fontWeight: 700, display: 'flex', alignItems: 'center', gap: 0.75}}><HardwareDeviceIcon kind={kind} />{t(`hardware_popover.${kind === 'rotator' ? 'rotators' : 'rigs'}`)}</Typography>
            <Typography variant="caption" color="text.secondary">{t('hardware_popover.connected_count', {count: summary.connected})}</Typography>
        </Stack>
        <Divider />
        <Box sx={{overflowY: 'auto', p: 1.25, minHeight: 0}}>
            {!socket?.connected && <Alert severity="warning" sx={{mb: 1}}>{t('hardware_popover.station_offline')}</Alert>}
            {control.error && <Alert severity="error" sx={{mb: 1}}
                action={<Button size="small" disabled={!socket?.connected || control.loading}
                    onClick={() => dispatch(fetchHardwareState({socket}))}>{t('hardware_popover.retry')}</Button>}>
                {t('hardware_popover.status_load_failed')}
            </Alert>}
            {config.length === 0 && <Box sx={{py: 2, px: 1, textAlign: 'center'}}>
                <Typography variant="body2" color="text.secondary">{t(`hardware_popover.${kind === 'rotator' ? 'no_rotators' : 'no_rigs'}`)}</Typography>
            </Box>}
            <Stack spacing={1}>
                {devices.map((device) => {
                    const id = String(device.id);
                    const snapshot = control.devices?.[deviceKey(kind, id)];
                    return <DeviceRow key={id} device={device} kind={kind} snapshot={snapshot} now={now}
                        status={deviceStatus(snapshot, control.loaded, socket?.connected, now, control.error)}
                        command={latestDeviceCommand(control.commands, kind, id)} error={errors[id]}
                        owner={resolveDeviceOwner(snapshot?.owner, instances, views, observations)}
                        socketConnected={socket?.connected} loaded={control.loaded} expanded={expandedId === id}
                        onToggle={() => setExpandedId((previous) => previous === id ? null : id)}
                        onSubmit={(action) => submit(id, action)} onManualControl={onManualControl || setManualId}
                        onViewOwner={onViewOwner} onEdit={onEdit} />;
                })}
            </Stack>
        </Box>
        <Divider />
        <Button size="small" startIcon={<SettingsOutlinedIcon />} endIcon={<OpenInNewIcon />}
            disabled={!onManage} onClick={onManage} sx={{justifyContent: 'flex-start', px: 1.5, py: 1}}>
            {t(`hardware_popover.${kind === 'rotator' ? 'manage_rotators' : 'manage_rigs'}`)}
        </Button>
        {!onManualControl && <DeviceManualRotatorDialog deviceId={manualId} onClose={() => setManualId(null)} />}
    </Box>;
}

export function DeviceManualRotatorDialog({deviceId, onClose}) {
    const dispatch = useDispatch();
    const {socket} = useSocket();
    const {t} = useTranslation('dashboard');
    const config = useSelector((state) => state.rotators?.rotators) || EMPTY_LIST;
    const control = useSelector((state) => state.hardwareControl) || EMPTY_OBJECT;
    const now = useNow();
    const selected = config.find((row) => String(row.id) === deviceId);
    const snapshot = control.devices?.[deviceKey('rotator', deviceId)];
    const data = snapshot?.data || EMPTY_OBJECT;
    const command = latestDeviceCommand(control.commands, 'rotator', deviceId);
    const status = deviceStatus(snapshot, control.loaded, socket?.connected, now, control.error);
    const pauseOnly = selected?.stop_supported === false;
    const stopLabel = pauseOnly ? t('hardware_popover.pause_tracking') : undefined;
    const submit = (action, position) => dispatch(sendDeviceCommand({socket, kind: 'rotator', deviceId, action, position})).unwrap();

    return <ManualRotatorDialog open={Boolean(selected)} onClose={onClose} rotator={selected}
        rotatorStatus={{key: resolveHardwareStatus({kind: 'rotator', deviceId, data, available: status.known})}}
        currentAz={selected?.azimuth_mode === '0_450' && finite(data.az) ? ((Number(data.az) % 360) + 360) % 360 : data.az}
        currentEl={data.el} minAz={selected?.minaz ?? 0}
        maxAz={selected?.azimuth_mode === '0_450' ? Math.min(selected?.maxaz ?? 360, 360) : selected?.maxaz ?? 360}
        minEl={selected?.minel ?? 0} maxEl={selected?.maxel ?? 90}
        disabled={status.key !== 'connected' || snapshot?.owner?.type !== 'manual' || Boolean(data.motion_unconfirmed) || Boolean(data.parked) || Boolean(data.tracking)}
        command={command} canStop={socket?.connected && control.loaded && data.connected} stopLabel={stopLabel}
        onMove={(az, el) => submit('move', {az, el})} onStop={() => submit(pauseOnly ? 'pause' : 'stop')} />;
}
