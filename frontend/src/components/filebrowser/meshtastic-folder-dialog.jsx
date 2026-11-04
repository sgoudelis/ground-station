/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useEffect, useId, useState} from 'react';
import {Alert, Box, Button, Dialog, DialogActions, DialogContent, LinearProgress, MenuItem,
    Pagination, Paper, TextField, Typography} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import HistoryIcon from '@mui/icons-material/History';
import PlaceOutlinedIcon from '@mui/icons-material/PlaceOutlined';
import {useDispatch} from 'react-redux';
import {useTranslation} from 'react-i18next';
import {fetchFileDetails} from './filebrowser-slice.jsx';
import {useUserTimeSettings} from '../../hooks/useUserTimeSettings.jsx';
import {formatDateTime} from '../../utils/date-time.js';
import TelemetryPositionMap from './telemetry-position-map.jsx';
import MeshtasticOverview, {MeshtasticOverviewHeader} from './meshtastic-overview.jsx';
import MeshtasticTelemetry from './meshtastic-telemetry.jsx';
import MeshtasticPacketTable from './meshtastic-packet-table.jsx';
import {formatCaptureRunLabel} from './capture-run-label.js';
import {
    fileDialogActionsSx,
    fileDialogContentSx,
    fileDialogPaperSx,
    fileDialogSectionHeaderSx,
    fileDialogSectionSx,
} from './file-dialog-styles.js';

const PAGE_SIZE = 50;

export default function MeshtasticFolderDialog({folder, socket, onClose, onOpenPacket, onDelete}) {
    const dispatch = useDispatch();
    const {t} = useTranslation('filebrowser');
    const settings = useUserTimeSettings();
    const titleId = useId();
    const text = (key, fallback, options = {}) => t(`meshtastic_folder.${key}`, {defaultValue: fallback, ...options});
    const date = value => value ? formatDateTime(value, settings) || '—' : '—';
    const [detail, setDetail] = useState(folder);
    const [page, setPage] = useState(1);
    const [run, setRun] = useState('');
    const [revision, setRevision] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    useEffect(() => {
        let active = true;
        setLoading(true);
        dispatch(fetchFileDetails({socket, id: folder.id, page, pageSize: PAGE_SIZE, run})).unwrap()
            .then(data => {
                if (!active) return;
                setDetail(data); setPage(data.page); setError('');
            }).catch(failure => {if (active) setError(String(failure));})
            .finally(() => {if (active) setLoading(false);});
        return () => {active = false;};
    }, [dispatch, socket, folder.id, page, run, revision]);
    useEffect(() => {
        let timer;
        const refresh = () => {
            // Group save notifications so packet bursts leave the controls usable.
            if (timer === undefined) timer = setTimeout(() => {timer = undefined; setRevision(value => value + 1);}, 500);
        };
        socket?.on('library.changed', refresh);
        socket?.on('connect', refresh);
        return () => {
            clearTimeout(timer);
            socket?.off('library.changed', refresh);
            socket?.off('connect', refresh);
        };
    }, [socket]);
    const position = detail.latest_position;
    const telemetry = detail.latest_telemetry;
    const packets = detail.packets || [];
    const total = detail.total || 0;
    const firstShown = packets.length ? (page - 1) * PAGE_SIZE + 1 : 0;
    const lastShown = firstShown ? firstShown + packets.length - 1 : 0;
    return <Dialog open onClose={onClose} aria-labelledby={titleId} maxWidth="lg" fullWidth slotProps={{paper: {sx: fileDialogPaperSx}}}>
        <MeshtasticOverviewHeader detail={detail} titleId={titleId} onClose={onClose} />
        <DialogContent sx={fileDialogContentSx}>
            <MeshtasticOverview detail={detail} settings={settings} />
            {position && <Paper component="section" aria-label={text('position', 'Latest position')} variant="outlined" sx={fileDialogSectionSx}>
                <Box sx={{...fileDialogSectionHeaderSx, px: {xs: 2, sm: 2.5}, bgcolor: 'background.paper', flexWrap: 'wrap', gap: 1}}>
                    <Box sx={{display: 'flex', alignItems: 'center', gap: 1}}>
                        <PlaceOutlinedIcon sx={{fontSize: 20, color: 'text.secondary'}} />
                        <Typography component="h3" variant="subtitle2" fontWeight={600}>{text('position', 'Latest position')}</Typography>
                    </Box>
                    <Typography variant="caption" color="text.secondary">{text('received_date', 'Received {{date}} ({{timezone}})', {
                        date: date(position.captured_at), timezone: settings.timezone || 'UTC',
                    })}</Typography>
                </Box>
                <Box sx={{p: {xs: 2, sm: 2.5}}}>
                    <TelemetryPositionMap position={{...position, altitude_meters: position.altitude}}
                        source={detail.node_id} label="Meshtastic" title={text('node_location', 'Node location')} />
                </Box>
            </Paper>}
            {telemetry && <MeshtasticTelemetry telemetry={telemetry} settings={settings} />}
            <Paper component="section" aria-label={text('packet_history', 'Packet history')} variant="outlined" sx={fileDialogSectionSx}>
                <Box sx={{...fileDialogSectionHeaderSx, px: {xs: 2, sm: 2.5}, bgcolor: 'background.paper',
                    flexDirection: {xs: 'column', sm: 'row'}, alignItems: {xs: 'stretch', sm: 'center'}}}>
                    <Box sx={{display: 'flex', alignItems: 'center', gap: 1.25}}>
                        <HistoryIcon sx={{fontSize: 20, color: 'text.secondary'}} />
                        <Box>
                            <Typography component="h3" variant="subtitle2" fontWeight={600}>{text('packet_history', 'Packet history')}</Typography>
                            <Typography variant="caption" color="text.secondary">{text('history_hint', 'Recorded Meshtastic packets · Newest first')}</Typography>
                        </Box>
                    </Box>
                    <TextField select size="small" label={text('run', 'Capture run')} value={run} sx={{width: {xs: '100%', sm: 300}, flexShrink: 0}}
                        slotProps={{select: {displayEmpty: true}, inputLabel: {shrink: true}}}
                        onChange={event => {setRun(event.target.value); setPage(1);}}>
                        <MenuItem value="">{text('all_runs', 'All runs')}</MenuItem>
                        {(detail.runs || []).map(item => <MenuItem key={item.name} value={item.name}>
                            {formatCaptureRunLabel(item, settings)} ({item.packet_count})
                        </MenuItem>)}
                    </TextField>
                </Box>
                <Box sx={{px: {xs: 2, sm: 2.5}, py: 1, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', columnGap: 2,
                    rowGap: 0.5, borderBottom: '1px solid', borderColor: 'divider'}}>
                    <Typography variant="caption" color="text.secondary">{text('window', 'Each capture run covers 12 hours from its first received packet.')}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{fontVariantNumeric: 'tabular-nums'}}>
                        {text('shown_packets', '{{count}} packets shown', {count: packets.length})}
                    </Typography>
                </Box>
                {error && <Alert severity="error" sx={{mx: 2.5, my: 1.5}}>{error}</Alert>}
                <Box sx={{height: 2}}>
                    {loading && <LinearProgress aria-label={text('loading', 'Loading packets…')} sx={{height: 2}} />}
                </Box>
                <MeshtasticPacketTable packets={packets} loading={loading} error={error} settings={settings} onOpenPacket={onOpenPacket} />
                <Box sx={{px: {xs: 2, sm: 2.5}, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    flexWrap: 'wrap', columnGap: 2, rowGap: 1, borderTop: '1px solid', borderColor: 'divider'}}>
                    <Typography variant="caption" color="text.secondary" sx={{fontVariantNumeric: 'tabular-nums'}}>
                        {text('packet_range', '{{first}}–{{last}} of {{count}} packets', {first: firstShown, last: lastShown, count: total})}
                    </Typography>
                    <Pagination size="small" shape="rounded" page={page} count={Math.max(1, Math.ceil(total / PAGE_SIZE))}
                        disabled={loading} onChange={(_event, value) => setPage(value)} />
                </Box>
            </Paper>
        </DialogContent>
        <DialogActions disableSpacing sx={fileDialogActionsSx}>
            <Button color="error" variant="outlined" startIcon={<DeleteIcon />} onClick={() => onDelete(detail)}>{text('delete', 'Delete node captures')}</Button>
            <Button component="a" variant="outlined" href={detail.download_url} startIcon={<DownloadIcon />}>{text('download', 'Download all captures')}</Button>
            <Button variant="outlined" onClick={onClose}>{text('close', 'Close')}</Button>
        </DialogActions>
    </Dialog>;
}
