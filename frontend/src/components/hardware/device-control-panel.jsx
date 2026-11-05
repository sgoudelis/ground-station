/** Copyright (c) 2026 Efstratios Goudelis, GPL-3.0-or-later */
import React, {useEffect, useId, useState} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import {useTranslation} from 'react-i18next';
import {
    Alert, Box, Button, ButtonBase, Chip, CircularProgress, Collapse, Divider,
    IconButton, Menu, MenuItem, Stack, Tooltip, Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SettingsOutlinedIcon from '@mui/icons-material/SettingsOutlined';
import StopCircleOutlinedIcon from '@mui/icons-material/StopCircleOutlined';
import {useSocket} from '../common/socket.jsx';
import ManualRotatorDialog from '../dashboard/manual-rotator-dialog.jsx';
import {deviceKey, fetchHardwareState, isDeviceCommandActive, sendDeviceCommand} from './control-slice.js';
import {
    deviceStatus, EMPTY_LIST, EMPTY_OBJECT, latestDeviceCommand, resolveDeviceOwner, summarizeDevices,
} from './device-control-state.js';

const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const degrees = (value) => finite(value) ? `${Number(value).toFixed(1)}°` : '—';
const frequency = (value) => finite(value) && Number(value) > 0 ? `${(Number(value) / 1e6).toFixed(6)} MHz` : '—';

function useNow() {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);
    return now;
}

function TelemetryValue({label, value}) {
    return <Box sx={{minWidth: 0}}>
        <Typography variant="caption" color="text.secondary" sx={{display: 'block'}}>{label}</Typography>
        <Typography variant="body2" sx={{fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', fontWeight: 600}}>
            {value}
        </Typography>
    </Box>;
}

function DeviceRow({device, kind, snapshot, status, command, owner, expanded, now, error,
    onToggle, onSubmit, onManualControl, onViewOwner, onManage, socketConnected, loaded}) {
    const {t} = useTranslation('dashboard');
    const contentId = useId();
    const [menuAnchor, setMenuAnchor] = useState(null);
    const data = snapshot?.data || EMPTY_OBJECT;
    const manual = owner.type === 'manual';
    const observation = owner.type === 'observation';
    const owned = Boolean(owner.type);
    const busy = isDeviceCommandActive(command);
    const canDisconnect = Boolean(data.connected || data.error || owned || busy);
    const ready = socketConnected && loaded && status.known;
    const stopUnsupported = kind === 'rotator' && device.stop_supported === false;
    const stopLabel = t(`hardware_popover.${stopUnsupported || kind === 'rig' ? 'pause_tracking' : 'stop'}`);
    const activityKey = data.motion_unconfirmed ? 'motion_unconfirmed' : data.parked ? 'parked'
        : data.slewing ? 'slewing' : data.tracking ? 'tracking' : 'idle';
    const ownerName = owner.name || (observation ? t('hardware_popover.observation')
        : t('hardware_popover.target', {number: owner.number || ''}).trim());
    const ownerLabel = owned ? manual ? t('hardware_popover.manual_control')
        : `${t(`hardware_popover.${observation ? 'observation' : 'target_label'}`)} · ${ownerName}`
        : t(`hardware_popover.${data.connected ? 'available' : 'not_connected'}`);
    const submitting = ['sending', 'submitted', 'started'].includes(command?.status);
    const feedbackVisible = command && (submitting || ['failed', 'unknown', 'cancelled'].includes(command.status)
        || command.status === 'succeeded' && now - command.updated_at * 1000 < 3000);
    const progressKey = command?.action === 'stop' && stopUnsupported ? 'pausing'
        : ({connect: 'connecting', disconnect: 'disconnecting', 'take-control': 'transferring',
            release: 'releasing', stop: kind === 'rig' ? 'pausing' : 'stopping', move: 'moving',
            park: 'parking', unpark: 'unparking'})[command?.action] || 'applying';
    const feedback = submitting ? t(`hardware_popover.${progressKey}`)
        : t(`hardware_popover.command_${command?.status}`);

    let primary = null;
    if (!data.connected && (!owned || manual)) {
        primary = {label: t('hardware_popover.connect'), action: 'connect'};
    } else if (observation) {
        primary = {label: t('hardware_popover.view_observation'), owner: true};
    } else if (!manual && (data.connected || owned)) {
        primary = {label: t('hardware_popover.take_manual_control'), action: 'take-control',
            blocked: data.connected && data.motion_unconfirmed};
    } else if (manual && data.connected) {
        primary = kind === 'rotator'
            ? {label: t('hardware_popover.manual_movement'), movement: true, blocked: data.motion_unconfirmed || data.parked || data.tracking}
            : {label: t('hardware_popover.release_control'), action: 'release'};
    }
    const menuAction = (action) => {
        setMenuAnchor(null);
        onSubmit(action);
    };

    return <Box component="section" aria-label={device.name}
        sx={{border: '1px solid', borderColor: expanded ? 'primary.main' : 'divider', borderRadius: 1.25, overflow: 'hidden'}}>
        <ButtonBase onClick={onToggle} aria-expanded={expanded} aria-controls={contentId}
            sx={{display: 'flex', width: '100%', px: 1.25, py: 1.1, gap: 1, textAlign: 'left',
                bgcolor: expanded ? 'action.hover' : 'transparent', '&:hover': {bgcolor: 'action.hover'}}}>
            <Box sx={{flex: 1, minWidth: 0}}>
                <Typography variant="body2" noWrap sx={{fontWeight: 700}}>{device.name}</Typography>
                <Typography variant="caption" noWrap color="text.secondary" sx={{display: 'block'}}>
                    {status.known ? ownerLabel : t('hardware_popover.status_unavailable')}
                </Typography>
            </Box>
            <Chip size="small" variant="outlined" color={status.color}
                label={t(`hardware_popover.status_${status.key}`)} sx={{height: 23, fontSize: '0.68rem'}} />
            <ExpandMoreIcon sx={{fontSize: 19, color: 'text.secondary', transform: expanded ? 'rotate(180deg)' : 'none'}} />
        </ButtonBase>
        <Collapse in={expanded} unmountOnExit>
            <Box id={contentId} sx={{px: 1.25, pt: 1, pb: 0.5}}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{mb: 1}}>
                    <Typography variant="caption" color="text.secondary" sx={{overflowWrap: 'anywhere'}}>
                        {device.host}:{device.port}
                    </Typography>
                    {status.known && data.connected && <Chip size="small" variant="outlined"
                        color={data.motion_unconfirmed ? 'warning' : 'default'}
                        label={t(`hardware_popover.${activityKey}`)} sx={{height: 21, fontSize: '0.65rem'}} />}
                </Stack>
                {owned && !manual && <Box sx={{mb: 1}}>
                    <Typography variant="caption" color="text.secondary" sx={{display: 'block'}}>
                        {t(`hardware_popover.${observation ? 'controlled_by_observation' : 'controlled_by_target'}`)}
                    </Typography>
                    <Typography variant="body2" sx={{fontWeight: 600, overflowWrap: 'anywhere'}}>{ownerName}</Typography>
                    {!observation && onViewOwner && <Button size="small" endIcon={<OpenInNewIcon />}
                        onClick={() => onViewOwner(owner)} sx={{px: 0, minWidth: 0}}>{t('hardware_popover.open_target')}</Button>}
                </Box>}
                <Box sx={{display: 'grid', gridTemplateColumns: kind === 'rotator' ? '1fr 1fr' : '1fr', gap: 1.25, mb: 0.5}}>
                    {kind === 'rotator' ? <>
                        <TelemetryValue label={t('hardware_popover.azimuth')} value={status.known && data.connected ? degrees(data.az) : '—'} />
                        <TelemetryValue label={t('hardware_popover.elevation')} value={status.known && data.connected ? degrees(data.el) : '—'} />
                    </> : <>
                        <TelemetryValue label={t('hardware_popover.frequency')} value={status.known && data.connected ? frequency(data.frequency) : '—'} />
                        {status.known && data.connected && (finite(data.vfo1?.frequency) || finite(data.vfo2?.frequency)) &&
                            <Box sx={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1}}>
                                {finite(data.vfo1?.frequency) && <TelemetryValue label={t('hardware_popover.vfo_1_frequency', {defaultValue: 'VFO 1'})} value={frequency(data.vfo1.frequency)} />}
                                {finite(data.vfo2?.frequency) && <TelemetryValue label={t('hardware_popover.vfo_2_frequency', {defaultValue: 'VFO 2'})} value={frequency(data.vfo2.frequency)} />}
                            </Box>}
                    </>}
                </Box>
            </Box>
        </Collapse>
        {(expanded || canDisconnect) && <Stack direction="row" alignItems="center" spacing={0.5}
            sx={{px: 1.25, py: 1, flexWrap: 'nowrap', '& .MuiButton-root': {minWidth: 0, px: 1, whiteSpace: 'nowrap'}}}>
            {expanded && primary && <Button size="small" variant={primary.movement || primary.action === 'connect' ? 'contained' : 'outlined'}
                title={primary.label} sx={{overflow: 'hidden'}}
                disabled={primary.owner ? !onViewOwner : !ready || busy || Boolean(primary.blocked)}
                onClick={() => primary.owner ? onViewOwner(owner) : primary.movement ? onManualControl(String(device.id)) : onSubmit(primary.action)}>
                <Box component="span" sx={{overflow: 'hidden', textOverflow: 'ellipsis'}}>{primary.label}</Box>
            </Button>}
            <Box sx={{flex: 1, minWidth: 0}} />
            {data.connected && <Button size="small" color="warning" variant="outlined" sx={{flexShrink: 0}}
                startIcon={<StopCircleOutlinedIcon sx={{fontSize: '16px !important'}} />}
                disabled={!socketConnected || !loaded || command?.action === 'stop' && busy}
                onClick={() => onSubmit('stop')}>{stopLabel}</Button>}
            {/* An operator can disconnect any owner, including an observation,
                and can interrupt pending movement without taking manual control. */}
            <Button size="small" color="error" variant="outlined" sx={{flexShrink: 0}}
                disabled={!socketConnected || !loaded || !canDisconnect || command?.action === 'disconnect' && busy}
                onClick={() => onSubmit('disconnect')}>{t('hardware_popover.disconnect')}</Button>
            {expanded && <Tooltip title={t('hardware_popover.more_actions', {name: device.name})}>
                <IconButton size="small" sx={{flexShrink: 0}} aria-label={t('hardware_popover.more_actions', {name: device.name})}
                    aria-haspopup="menu" aria-expanded={Boolean(menuAnchor)} onClick={(event) => setMenuAnchor(event.currentTarget)}>
                    <MoreHorizIcon fontSize="small" />
                </IconButton>
            </Tooltip>}
        </Stack>}
        <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={() => setMenuAnchor(null)}>
            {manual && data.connected && kind === 'rotator' && <MenuItem disabled={!ready || busy || data.motion_unconfirmed}
                onClick={() => menuAction(data.parked ? 'unpark' : 'park')}>{t(`hardware_popover.${data.parked ? 'unpark' : 'park'}`)}</MenuItem>}
            {manual && data.connected && kind === 'rotator' && <MenuItem disabled={!ready || busy}
                onClick={() => menuAction('release')}>{t('hardware_popover.release_control')}</MenuItem>}
            <MenuItem disabled={!onManage} onClick={() => {setMenuAnchor(null); onManage();}}>{t('hardware_popover.device_settings')}</MenuItem>
        </Menu>
        {data.motion_unconfirmed && <Alert severity="warning" sx={{borderRadius: 0, py: 0}}>
            {t(`hardware_popover.${data.connected ? 'waiting_stationary' : 'disconnected_motion_unconfirmed'}`)}
        </Alert>}
        {data.stop_warning && <Typography variant="caption" color="warning.main" sx={{display: 'block', px: 1.25, pb: 0.75, overflowWrap: 'anywhere'}}>{data.stop_warning}</Typography>}
        {(error || data.error) && <Alert severity="error" sx={{borderRadius: 0, py: 0}}>
            {error || data.error_message || t('hardware_popover.communication_failed')}
        </Alert>}
        {feedbackVisible && <Stack role="status" direction="row" spacing={0.75} alignItems="center" sx={{px: 1.25, pb: 1}}>
            {submitting && <CircularProgress size={12} />}
            <Typography variant="caption" color={['failed', 'unknown'].includes(command.status) ? 'warning.main' : 'text.secondary'}
                sx={{overflowWrap: 'anywhere'}}>{feedback}{command.reason ? ` — ${command.reason}` : ''}</Typography>
        </Stack>}
    </Box>;
}

export default function DeviceControlPanel({kind, onManage, onViewOwner, onManualControl}) {
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
            <Typography variant="subtitle2" sx={{fontWeight: 700}}>{t(`hardware_popover.${kind === 'rotator' ? 'rotators' : 'rigs'}`)}</Typography>
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
                        onViewOwner={onViewOwner} onManage={onManage} />;
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
    const stopLabel = selected?.stop_supported === false ? t('hardware_popover.pause_tracking') : undefined;
    const submit = (action, position) => dispatch(sendDeviceCommand({socket, kind: 'rotator', deviceId, action, position})).unwrap();

    return <ManualRotatorDialog open={Boolean(selected)} onClose={onClose} rotator={selected}
        rotatorStatus={{value: data.motion_unconfirmed ? t('hardware_popover.motion_unconfirmed')
            : data.slewing ? t('hardware_popover.slewing') : t(`hardware_popover.status_${status.key}`)}}
        currentAz={selected?.azimuth_mode === '0_450' && finite(data.az) ? ((Number(data.az) % 360) + 360) % 360 : data.az}
        currentEl={data.el} minAz={selected?.minaz ?? 0}
        maxAz={selected?.azimuth_mode === '0_450' ? Math.min(selected?.maxaz ?? 360, 360) : selected?.maxaz ?? 360}
        minEl={selected?.minel ?? 0} maxEl={selected?.maxel ?? 90}
        disabled={status.key !== 'connected' || snapshot?.owner?.type !== 'manual' || Boolean(data.motion_unconfirmed) || Boolean(data.parked) || Boolean(data.tracking)}
        command={command} canStop={socket?.connected && control.loaded && data.connected} stopLabel={stopLabel}
        onMove={(az, el) => submit('move', {az, el})} onStop={() => submit('stop')} />;
}
