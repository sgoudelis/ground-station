/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, {useEffect, useState} from 'react';
import {Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem,
    Pagination, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
    TextField, Typography} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import {useDispatch} from 'react-redux';
import {useTranslation} from 'react-i18next';
import {MeshtasticIcon} from '../common/custom-icons.jsx';
import {fetchFileDetails} from './filebrowser-slice.jsx';
import {useUserTimeSettings} from '../../hooks/useUserTimeSettings.jsx';
import {formatDateTime} from '../../utils/date-time.js';
import {Values} from './telemetry-fields.jsx';
import TelemetryPositionMap from './telemetry-position-map.jsx';
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

export default function MeshtasticFolderDialog({folder, socket, onClose, onOpenPacket, onDelete}) {
    const dispatch = useDispatch();
    const {t} = useTranslation('filebrowser');
    const settings = useUserTimeSettings();
    const text = (key, fallback, options = {}) => t(`meshtastic_folder.${key}`, {defaultValue: fallback, ...options});
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
    const position = detail.latest_position;
    const telemetry = detail.latest_telemetry;
    return <Dialog open onClose={onClose} maxWidth="lg" fullWidth slotProps={{paper: {sx: fileDialogPaperSx}}}>
        <DialogTitle sx={fileDialogTitleSx}>
            <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, minWidth: 0}}>
                <Box sx={{display: 'flex', alignItems: 'center', gap: 1, flex: '1 1 auto', minWidth: 0}}>
                    <MeshtasticIcon color="success" />
                    <Typography component="span" variant="h6" noWrap sx={{minWidth: 0}}>
                        {text('title', 'Meshtastic · {{name}}', {name: detail.name})}
                    </Typography>
                </Box>
                <Box sx={{display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0}}>
                    <Box sx={{display: 'flex', gap: 0.5, overflow: 'hidden', maxWidth: {xs: '35vw', sm: 'none'}}}>
                        <Chip size="small" color="info" label={text('packet_count', '{{count}} packets', {count: detail.packet_count})} />
                        <Chip size="small" variant="outlined" label={text('run_count', '{{count}} runs', {count: detail.run_count})} />
                    </Box>
                    <IconButton size="small" onClick={onClose} aria-label={text('close_folder', 'Close Meshtastic folder')}>
                        <CloseIcon fontSize="small" />
                    </IconButton>
                </Box>
            </Box>
        </DialogTitle>
        <DialogContent sx={fileDialogContentSx}>
            <FileDialogDetails title={text('details', 'Node details')} details={[
                {label: text('node_id', 'Node ID'), value: detail.node_id || '—', mono: true},
                {label: text('first_received', 'First received'), value: date(detail.captured_at)},
                {label: text('last_received', 'Last received'), value: date(detail.last_packet_at)},
                ...(detail.hw_model != null ? [{label: text('hardware', 'Hardware model code'), value: detail.hw_model}] : []),
                ...(detail.role != null ? [{label: text('role', 'Device role code'), value: detail.role}] : []),
            ]} />
            {position && <Paper variant="outlined" sx={fileDialogSectionSx}>
                <Box sx={{p: 2.25}}>
                    <Typography variant="caption" color="text.secondary" sx={{display: 'block', mb: 1}}>
                        {text('position_received', 'Position received: {{date}}', {date: date(position.captured_at)})}
                    </Typography>
                    <TelemetryPositionMap position={{...position, altitude_meters: position.altitude}}
                        source={detail.node_id} label="Meshtastic" title={text('position', 'Latest position')} />
                </Box>
            </Paper>}
            {telemetry && <Paper variant="outlined" sx={fileDialogSectionSx}>
                <Box sx={fileDialogSectionHeaderSx}>
                    <Typography variant="subtitle2" fontWeight={700}>{text('telemetry', 'Latest telemetry packet')}</Typography>
                    <Typography variant="caption" color="text.secondary">{date(telemetry.captured_at)}</Typography>
                </Box>
                <Box sx={{p: 2.25}}>
                    <Values values={telemetry.values} fieldInfo={telemetry.field_info} locale={settings.locale} />
                </Box>
            </Paper>}
            <Paper variant="outlined" sx={fileDialogSectionSx}>
                <Box sx={fileDialogSectionHeaderSx}>
                    <Typography variant="subtitle2" fontWeight={700}>{text('packets', 'Meshtastic packets')}</Typography>
                </Box>
                <Box sx={{p: 2.25}}>
                    <TextField select size="small" fullWidth label={text('run', 'Capture run')} value={run} sx={{mb: 2}}
                        helperText={text('window', 'Each capture run covers 12 hours from its first received packet.')}
                        slotProps={{select: {displayEmpty: true}, inputLabel: {shrink: true}}}
                        onChange={event => {setRun(event.target.value); setPage(1);}}>
                        <MenuItem value="">{text('all_runs', 'All runs')}</MenuItem>
                        {(detail.runs || []).map(item => <MenuItem key={item.name} value={item.name}>
                            {item.name} ({item.packet_count})
                        </MenuItem>)}
                    </TextField>
                    {error && <Alert severity="error">{error}</Alert>}
                    {loading && <Box role="status" aria-label={text('loading', 'Loading packets…')}><CircularProgress size={22} /></Box>}
                    <TableContainer><Table size="small" sx={{minWidth: 760}} aria-label={text('packets', 'Meshtastic packets')}>
                        <TableHead><TableRow>
                            {[text('received', 'Received'), text('application', 'Application'), text('status', 'Status'),
                                text('file', 'File')].map(label => <TableCell key={label}>{label}</TableCell>)}
                            <TableCell align="right">{text('actions', 'Actions')}</TableCell>
                        </TableRow></TableHead>
                        <TableBody>{(detail.packets || []).map(packet => <TableRow hover key={packet.path}>
                            <TableCell sx={{whiteSpace: 'nowrap'}}>{date(packet.captured_at)}</TableCell>
                            <TableCell>{packet.application}</TableCell><TableCell>{packet.payload_status}</TableCell>
                            <TableCell sx={{overflowWrap: 'anywhere'}}>{packet.filename}</TableCell>
                            <TableCell align="right" sx={{whiteSpace: 'nowrap'}}>
                                <Button size="small" disabled={loading} onClick={() => onOpenPacket(packet)}>{text('view', 'View')}</Button>
                                <IconButton size="small" href={packet.url} download={packet.filename}
                                    aria-label={text('download_packet', 'Download {{filename}}', {filename: packet.filename})}>
                                    <DownloadIcon fontSize="small" />
                                </IconButton>
                            </TableCell>
                        </TableRow>)}</TableBody>
                    </Table></TableContainer>
                    {!loading && !error && !detail.total && <Typography sx={{mt: 2}}>{text('empty', 'No packets in this run.')}</Typography>}
                    <Pagination sx={{mt: 2}} page={page} count={Math.max(1, Math.ceil((detail.total || 0) / PAGE_SIZE))}
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
