/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useEffect, useState} from 'react';
import {Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, LinearProgress, MenuItem,
    Pagination, Paper, TextField, Typography} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import HistoryIcon from '@mui/icons-material/History';
import {useDispatch} from 'react-redux';
import {useTranslation} from 'react-i18next';
import RadioIcon from '@mui/icons-material/Radio';
import {fetchFileDetails} from './filebrowser-slice.jsx';
import {useUserTimeSettings} from '../../hooks/useUserTimeSettings.jsx';
import {formatDateTime} from '../../utils/date-time.js';
import {Values} from './telemetry-fields.jsx';
import AprsPacketTable from './aprs-packet-table.jsx';
import FlightPathMap from './flight-path-map.jsx';
import {formatCaptureRunLabel} from './capture-run-label.js';
import FileDialogDetails from './file-dialog-details.jsx';
import {
    fileDialogActionsSx,
    fileDialogContentSx,
    fileDialogPaperSx,
    fileDialogSectionHeaderSx,
    fileDialogSectionSx,
    fileDialogTitleSx,
} from './file-dialog-styles.js';

const PAGE_SIZE = 50;

export default function AprsFolderDialog({folder, socket, onClose, onOpenPacket, onDelete}) {
    const dispatch = useDispatch();
    const {t} = useTranslation('filebrowser');
    const settings = useUserTimeSettings();
    const timezone = settings.timezone || 'UTC';
    const text = (key, fallback, options = {}) => t(`aprs_folder.${key}`, {defaultValue: fallback, ...options});
    const date = value => value ? formatDateTime(value, settings) : '—';
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
    const latest = detail.latest || {};
    const packets = detail.packets || [];
    const total = detail.total || 0;
    const firstShown = packets.length ? (page - 1) * PAGE_SIZE + 1 : 0;
    const lastShown = firstShown ? firstShown + packets.length - 1 : 0;
    return <Dialog open onClose={onClose} maxWidth="lg" fullWidth slotProps={{paper: {sx: fileDialogPaperSx}}}>
        <DialogTitle sx={fileDialogTitleSx}>
            <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, minWidth: 0}}>
                <Box sx={{display: 'flex', alignItems: 'center', gap: 1, flex: '1 1 auto', minWidth: 0}}>
                    <RadioIcon color="primary" />
                    <Typography component="span" variant="h6" noWrap sx={{minWidth: 0}}>
                        {text('title', 'APRS · {{name}}', {name: detail.name})}
                    </Typography>
                </Box>
                <Box sx={{display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0}}>
                    <Box sx={{display: 'flex', gap: 0.5, overflow: 'hidden', maxWidth: {xs: '35vw', sm: 'none'}}}>
                        <Chip size="small" color="info" label={text('packet_count', '{{count}} packets', {count: detail.packet_count})} />
                        <Chip size="small" variant="outlined" label={text('run_count', '{{count}} runs', {count: detail.run_count})} />
                    </Box>
                    <IconButton size="small" onClick={onClose} aria-label={text('close_folder', 'Close APRS folder')}>
                        <CloseIcon fontSize="small" />
                    </IconButton>
                </Box>
            </Box>
        </DialogTitle>
        <DialogContent sx={fileDialogContentSx}>
            <FileDialogDetails title={text('details', 'Station details')} details={[
                {label: text('source_callsign', 'Callsign and SSID'), value: detail.source_callsign || '—', mono: true},
                {label: `${text('first_received', 'First received')} (${timezone})`, value: date(detail.captured_at)},
                {label: `${text('last_received', 'Last received')} (${timezone})`, value: date(detail.last_packet_at)},
                ...(latest.comment ? [{label: text('comment', 'Latest comment'), value: latest.comment.value}] : []),
            ]} />
            {['status', 'message', 'weather', 'telemetry'].map(key => latest[key] && <Paper key={key} variant="outlined" sx={fileDialogSectionSx}>
                <Box sx={fileDialogSectionHeaderSx}>
                    <Typography variant="subtitle2" fontWeight={700}>{text(`latest_${key}`, `Latest ${key}`)}</Typography>
                    <Typography variant="caption" color="text.secondary">{date(latest[key].captured_at)} ({timezone})</Typography>
                </Box>
                <Box sx={{p: 2.25}}>
                    {typeof latest[key].value === 'object'
                        ? <Values values={latest[key].value} locale={settings.locale} />
                        : <Typography variant="body2" sx={{whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{latest[key].value}</Typography>}
                </Box>
            </Paper>)}
            <FlightPathMap socket={socket} folderId={folder.id} run={run} runs={detail.runs} settings={settings} kind="aprs"
                filter={<TextField select size="small" label={text('run', 'Capture run')} value={run} sx={{width: {xs: '100%', sm: 300}, flexShrink: 0}}
                    slotProps={{select: {displayEmpty: true}, inputLabel: {shrink: true}}}
                    onChange={event => {setRun(event.target.value); setPage(1);}}>
                    <MenuItem value="">{text('all_runs', 'All runs')}</MenuItem>
                    {(detail.runs || []).map(item => <MenuItem key={item.name} value={item.name}>
                        {formatCaptureRunLabel(item, settings, item.name === 'legacy' ? text('legacy', 'Legacy packets') : item.name)}
                        {` (${item.packet_count})`}
                    </MenuItem>)}
                </TextField>} />
            <Paper component="section" aria-label={text('history', 'Packet history')} variant="outlined" sx={fileDialogSectionSx}>
                <Box sx={{...fileDialogSectionHeaderSx, px: {xs: 2, sm: 2.5}, bgcolor: 'background.paper'}}>
                    <Box sx={{display: 'flex', alignItems: 'center', gap: 1.25}}>
                        <HistoryIcon sx={{fontSize: 20, color: 'text.secondary'}} />
                        <Box>
                            <Typography component="h3" variant="subtitle2" fontWeight={600}>{text('history', 'Packet history')}</Typography>
                            <Typography variant="caption" color="text.secondary">{text('history_hint', 'Recorded APRS packets · Newest first')}</Typography>
                        </Box>
                    </Box>
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
                <AprsPacketTable packets={packets} loading={loading} error={error} settings={settings} onOpenPacket={onOpenPacket} />
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
            {onDelete && <Button color="error" variant="outlined" startIcon={<DeleteIcon />} onClick={() => onDelete(detail)}>{text('delete', 'Delete station captures')}</Button>}
            <Button component="a" variant="outlined" href={detail.download_url} startIcon={<DownloadIcon />}>{text('download', 'Download all captures')}</Button>
            <Button variant="outlined" onClick={onClose}>{text('close', 'Close')}</Button>
        </DialogActions>
    </Dialog>;
}
