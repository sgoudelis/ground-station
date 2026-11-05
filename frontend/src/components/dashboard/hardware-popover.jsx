/** Copyright (c) 2026 Efstratios Goudelis, GPL-3.0-or-later */
import React, {useEffect, useState} from 'react';
import {Badge, Box, IconButton, Popover, Stack, Tooltip} from '@mui/material';
import RadioIcon from '@mui/icons-material/Radio';
import {SatelliteIcon} from 'hugeicons-react';
import {useDispatch, useSelector} from 'react-redux';
import {useNavigate} from 'react-router-dom';
import {useTranslation} from 'react-i18next';
import {useSocket} from '../common/socket.jsx';
import DeviceControlPanel, {DeviceManualRotatorDialog} from '../hardware/device-control-panel.jsx';
import {fetchHardwareState} from '../hardware/control-slice.js';
import {EMPTY_LIST, EMPTY_OBJECT, summarizeDevices} from '../hardware/device-control-state.js';
import {setTrackerId} from '../target/target-slice.jsx';
import {setDialogOpen, setSelectedObservation} from '../scheduler/scheduler-slice.jsx';
import RotatorQuickEditDialog from './rotator-quick-edit-dialog.jsx';
import RigQuickEditDialog from './rig-quick-edit-dialog.jsx';

function HardwareSettingsPopover() {
    const {socket} = useSocket();
    const dispatch = useDispatch();
    const navigate = useNavigate();
    const {t} = useTranslation('dashboard');
    const [anchorEl, setAnchorEl] = useState(null);
    const [kind, setKind] = useState('rotator');
    const [manualId, setManualId] = useState(null);
    const [editedDevice, setEditedDevice] = useState(null);
    const [now, setNow] = useState(Date.now);
    const rotators = useSelector((state) => state.rotators?.rotators) || EMPTY_LIST;
    const rigs = useSelector((state) => state.rigs?.rigs) || EMPTY_LIST;
    const control = useSelector((state) => state.hardwareControl) || EMPTY_OBJECT;
    const observations = useSelector((state) => state.scheduler?.observations) || EMPTY_LIST;
    const open = Boolean(anchorEl);

    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        if (open && socket?.connected) dispatch(fetchHardwareState({socket}));
    }, [dispatch, open, socket]);

    const close = () => setAnchorEl(null);
    const manage = () => {
        close();
        navigate(`/admin/system/hardware/${kind === 'rotator' ? 'rotators' : 'rigs'}`);
    };
    const viewOwner = (owner) => {
        close();
        const observation = observations.find((row) => row.id === owner.id);
        if (owner.type === 'observation' && observation) {
            dispatch(setSelectedObservation(observation));
            dispatch(setDialogOpen(true));
        } else {
            dispatch(setTrackerId(owner.id));
            navigate('/tracking');
        }
    };

    return <>
        <Stack direction="row" spacing={0}>
            {[['rotator', rotators], ['rig', rigs]].map(([deviceKind, devices]) => {
                // Counts reflect physical device telemetry, including manual and
                // unowned connections. Target selections never imply a connection.
                const summary = summarizeDevices(devices.map((row) => ({...row, kind: deviceKind})),
                    control, socket?.connected, now);
                const label = t(`hardware_popover.${deviceKind}_controls`);
                const color = !socket?.connected ? 'text.disabled' : summary.attention || summary.slewing
                    ? 'warning.main' : summary.connected ? 'success.main' : 'text.secondary';
                return <Tooltip key={deviceKind} title={socket?.connected
                    ? t('hardware_popover.fleet_summary', {label, connected: summary.connected, count: devices.length})
                    : t('hardware_popover.station_offline')}>
                    <IconButton aria-label={label} aria-haspopup="dialog"
                        aria-expanded={open && kind === deviceKind}
                        aria-controls={open && kind === deviceKind ? 'hardware-popover' : undefined}
                        size="small" sx={{width: 40, color}}
                        onClick={(event) => {setKind(deviceKind); setAnchorEl(event.currentTarget);}}>
                        <Badge badgeContent={summary.connected} invisible={!summary.connected} max={99}
                            anchorOrigin={{vertical: 'top', horizontal: 'right'}}
                            sx={{'& .MuiBadge-badge': {
                                minWidth: 14, height: 14, px: 0.4, bgcolor: 'background.paper',
                                color: 'text.secondary', border: '1px solid', borderColor: 'divider',
                                fontSize: '0.55rem', fontWeight: 700,
                            }}}>
                            {deviceKind === 'rotator' ? <SatelliteIcon style={{width: 22, height: 22}} />
                                : <RadioIcon sx={{fontSize: 22}} />}
                        </Badge>
                    </IconButton>
                </Tooltip>;
            })}
        </Stack>
        <Popover open={open} anchorEl={anchorEl} onClose={close}
            anchorOrigin={{vertical: 'bottom', horizontal: 'right'}}
            transformOrigin={{vertical: 'top', horizontal: 'right'}}
            slotProps={{paper: {sx: {
                mt: 0.5, border: '1px solid', borderColor: 'divider', borderRadius: 1.5,
                overflow: 'hidden', maxWidth: 'calc(100vw - 24px)',
            }}}}>
            <Box id="hardware-popover" role="dialog" aria-label={t(`hardware_popover.${kind}_controls`)}
                sx={{width: 420, maxWidth: 'calc(100vw - 24px)', bgcolor: 'background.paper'}}>
                <DeviceControlPanel key={kind} kind={kind} onManage={manage} onViewOwner={viewOwner}
                    onEdit={(device) => {setEditedDevice({kind, device}); close();}}
                    onManualControl={(id) => {setManualId(id); close();}} />
            </Box>
        </Popover>
        {/* The movement dialog survives the popover's exit and stays on the
            current page. Opening it never changes the active target. */}
        <DeviceManualRotatorDialog deviceId={manualId} onClose={() => setManualId(null)} />
        {/* Editing survives the popover closing and keeps the current page open. */}
        {editedDevice?.kind === 'rotator' && <RotatorQuickEditDialog open
            rotator={editedDevice.device} onClose={() => setEditedDevice(null)} />}
        {editedDevice?.kind === 'rig' && <RigQuickEditDialog open
            rig={editedDevice.device} onClose={() => setEditedDevice(null)} />}
    </>;
}

export default React.memo(HardwareSettingsPopover);
