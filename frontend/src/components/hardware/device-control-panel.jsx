/** Copyright (c) 2026 Efstratios Goudelis, GPL-3.0-or-later */
import React, {useEffect, useState} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import {Alert, Box, Button, Chip, Stack, Typography} from '@mui/material';
import {useSocket} from '../common/socket.jsx';
import ManualRotatorDialog from '../dashboard/manual-rotator-dialog.jsx';
import {deviceKey, isDeviceCommandActive, sendDeviceCommand} from './control-slice.js';

const EMPTY = {};

export default function DeviceControlPanel({kind}) {
    const dispatch = useDispatch();
    const {socket} = useSocket();
    const config = useSelector((state) => kind === 'rotator' ? state.rotators?.rotators : state.rigs?.rigs) || [];
    const control = useSelector((state) => state.hardwareControl) || EMPTY;
    const [manualId, setManualId] = useState(null);
    const [error, setError] = useState('');
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, []);

    const commandFor = (id) => Object.values(control.commands || EMPTY)
        .filter((command) => command.device_ids?.[kind] === String(id))
        .sort((a, b) => b.clientSubmittedAt - a.clientSubmittedAt)[0];
    const submit = async (id, action, position) => {
        setError('');
        try { await dispatch(sendDeviceCommand({socket, kind, deviceId: id, action, position})).unwrap(); }
        catch (reason) { setError(String(reason)); }
    };
    const selected = config.find((row) => String(row.id) === manualId);
    const selectedSnapshot = control.devices?.[deviceKey(kind, manualId)];
    const selectedData = selectedSnapshot?.data || EMPTY;
    const selectedCommand = commandFor(manualId);
    const selectedBusy = isDeviceCommandActive(selectedCommand);
    const isFresh = (snapshot) => snapshot && now - snapshot.receivedAt < 15000;

    return <Box sx={{p: 1.5}}>
        <Typography variant="subtitle2" sx={{mb: 1}}>Devices</Typography>
        {error && <Alert severity="error" sx={{mb: 1}}>{error}</Alert>}
        {config.length === 0 && <Typography color="text.secondary">No devices configured</Typography>}
        <Stack spacing={1}>
            {config.map((device) => {
                const id = String(device.id);
                const snapshot = control.devices?.[deviceKey(kind, id)];
                const data = snapshot?.data || EMPTY;
                const command = commandFor(id);
                const busy = isDeviceCommandActive(command);
                const manual = snapshot?.owner?.type === 'manual';
                const observation = snapshot?.owner?.type === 'observation';
                const ready = socket?.connected && control.loaded && (!snapshot || isFresh(snapshot));
                return <Box key={id} sx={{p: 1, border: 1, borderColor: 'divider', borderRadius: 1}}>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{mb: 1}}>
                        <Typography sx={{flex: 1}}>{device.name}</Typography>
                        <Chip size="small" label={!isFresh(snapshot) && snapshot ? 'Status unavailable' : data.connected ? 'Connected' : 'Disconnected'} />
                        <Typography variant="caption" color="text.secondary">
                            {manual ? 'Manual control' : snapshot?.owner?.id || 'Available'}
                        </Typography>
                    </Stack>
                    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
                        {!data.connected && (!snapshot?.owner || manual) && <Button size="small" disabled={!ready || busy} onClick={() => submit(id, 'connect')}>Connect</Button>}
                        {!manual && (data.connected || snapshot?.owner) && <Button size="small" disabled={!ready || busy || observation || data.connected && data.motion_unconfirmed}
                            onClick={() => submit(id, 'take-control')}>Take manual control</Button>}
                        {data.connected && <>
                            {manual && <>
                                <Button size="small" disabled={!ready || busy} onClick={() => submit(id, 'release')}>Release control</Button>
                                <Button size="small" disabled={!ready || busy} onClick={() => submit(id, 'disconnect')}>Disconnect</Button>
                                {kind === 'rotator' && <>
                                    <Button size="small" disabled={!ready || busy || data.motion_unconfirmed || data.parked}
                                        onClick={() => setManualId(id)}>Manual movement</Button>
                                    <Button size="small" disabled={!ready || busy || data.motion_unconfirmed}
                                        onClick={() => submit(id, data.parked ? 'unpark' : 'park')}>{data.parked ? 'Unpark' : 'Park'}</Button>
                                </>}
                            </>}
                            <Button size="small" color="warning" disabled={!socket?.connected || command?.action === 'stop' && busy}
                                onClick={() => submit(id, 'stop')}>Stop</Button>
                        </>}
                    </Stack>
                    {data.motion_unconfirmed && <Typography variant="caption" color="warning.main">Waiting for stationary position readings</Typography>}
                    {data.error && <Alert severity="error">{data.error_message || 'Device communication failed'}</Alert>}
                    {command && <Typography variant="caption" color={['failed', 'unknown'].includes(command.status) ? 'error.main' : 'text.secondary'}>
                        {command.action}: {command.status}{command.reason ? ` — ${command.reason}` : ''}
                    </Typography>}
                </Box>;
            })}
        </Stack>
        <ManualRotatorDialog open={Boolean(selected)} onClose={() => setManualId(null)} rotator={selected}
            rotatorStatus={{value: selectedData.motion_unconfirmed ? 'Motion unconfirmed' : selectedData.slewing ? 'Slewing' : selectedData.connected ? 'Connected' : 'Disconnected'}}
            currentAz={selected?.azimuth_mode === '0_450' && Number.isFinite(selectedData.az) ? ((selectedData.az % 360) + 360) % 360 : selectedData.az}
            currentEl={selectedData.el}
            minAz={selected?.minaz ?? 0} maxAz={selected?.azimuth_mode === '0_450' ? Math.min(selected?.maxaz ?? 360, 360) : selected?.maxaz ?? 360}
            minEl={selected?.minel ?? 0} maxEl={selected?.maxel ?? 90}
            disabled={!socket?.connected || !isFresh(selectedSnapshot) || selectedSnapshot?.owner?.type !== 'manual' || Boolean(selectedData.motion_unconfirmed)}
            command={selectedCommand} busy={selectedBusy} stopping={selectedCommand?.action === 'stop' && selectedBusy}
            canStop={socket?.connected && selectedData.connected}
            onMove={(az, el) => submit(manualId, 'move', {az, el})} onStop={() => submit(manualId, 'stop')}
        />
    </Box>;
}
