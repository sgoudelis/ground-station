import React, {useEffect, useState} from 'react';
import {Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem,
    Paper, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import FlightIcon from '@mui/icons-material/Flight';
import {useTranslation} from 'react-i18next';
import {callLibrary} from '../packetmap/use-packet-positions.js';
import {useUserTimeSettings} from '../../hooks/useUserTimeSettings.jsx';
import {formatDateTime} from '../../utils/date-time.js';
import {AIRCRAFT_FIELDS, aircraftLabel, aircraftValue} from '../../utils/aircraft-metadata.js';
import FileDialogDetails from './file-dialog-details.jsx';
import {formatCaptureRunLabel} from './capture-run-label.js';
import {
    fileDialogActionsSx,
    fileDialogContentSx,
    fileDialogPaperSx,
    fileDialogSectionHeaderSx,
    fileDialogSectionSx,
    fileDialogTitleSx,
} from './file-dialog-styles.js';

export default function AircraftFolderDialog({folder, socket, onClose, onDelete}) {
    const {t} = useTranslation('filebrowser');
    const {t: aircraftT} = useTranslation('common');
    const timeSettings = useUserTimeSettings();
    const [detail, setDetail] = useState(folder);
    const [run, setRun] = useState('');
    const [records, setRecords] = useState([]);
    const [pageStart, setPageStart] = useState(null);
    const [start, setStart] = useState(0);
    const [selected, setSelected] = useState(null);
    const [error, setError] = useState('');
    const date = (value) => value ? formatDateTime(value, timeSettings) : '—';
    useEffect(() => {
        let active = true;
        let inFlight = false;
        let pending = false;
        let cursor = null;
        const load = async (initial = false) => {
            if (!active) return;
            if (inFlight) { pending = true; return; }
            inFlight = true;
            try {
                const data = await callLibrary(socket, 'adsb.history', {
                    id: folder.id, ...(run && {run}), limit: 50,
                    cursor: initial ? pageStart : cursor,
                });
                if (!active) return;
                cursor = data.cursor;
                if (initial) setStart(data.start);
                setRecords((previous) => initial || data.reset ? data.records : [...previous, ...data.records].slice(-50));
                if (data.summary) setDetail(data.summary);
                if (!initial) setStart(Math.max(0, data.cursor.offset - 50));
                setError('');
                // A slow connection catches up in bounded pages, without
                // overlapping requests or loading the complete log.
                pending = data.has_more;
            } catch (failure) {
                if (active) setError(failure.message);
            } finally {
                inFlight = false;
                if (active && pending && pageStart === null) {
                    pending = false;
                    void load();
                }
            }
        };
        const changed = (event) => {
            if (pageStart !== null) return; // Browsing older pages stays stable.
            if (event?.changes?.some((change) => change.id === folder.id || change.id === '*')) void load();
        };
        const reconnect = () => {cursor = null; void load(true);};
        socket?.on('library.changed', changed);
        socket?.on('connect', reconnect);
        void callLibrary(socket, 'filebrowser.item', {id: folder.id}).then((data) => {
            if (active) setDetail(data);
        }).catch(() => {});
        void load(true);
        return () => {
            active = false;
            socket?.off('library.changed', changed);
            socket?.off('connect', reconnect);
        };
    }, [socket, folder.id, run, pageStart]);
    const aircraft = (selected || records.at(-1))?.aircraft || detail.aircraft;
    return <Dialog open onClose={onClose} maxWidth="lg" fullWidth slotProps={{paper: {sx: fileDialogPaperSx}}}>
        <DialogTitle sx={fileDialogTitleSx}>
            <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, minWidth: 0}}>
                <Box sx={{display: 'flex', alignItems: 'center', gap: 1, flex: '1 1 auto', minWidth: 0}}>
                    <FlightIcon color="info" />
                    <Typography component="span" variant="h6" noWrap sx={{minWidth: 0}}>
                        {t('adsb.title', 'Aircraft {{icao}}', {icao: detail.icao?.toUpperCase() || detail.name})}
                    </Typography>
                </Box>
                <Box sx={{display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0}}>
                    <Box sx={{display: 'flex', gap: 0.5, overflow: 'hidden', maxWidth: {xs: '35vw', sm: 'none'}}}>
                        <Chip size="small" color="info" label={t('adsb.states', '{{count}} states', {count: detail.packet_count})} />
                        <Chip size="small" variant="outlined" label={t('adsb.runs', '{{count}} runs', {count: detail.run_count})} />
                    </Box>
                    <IconButton size="small" onClick={onClose} aria-label={t('adsb.close_folder', 'Close aircraft folder')}>
                        <CloseIcon fontSize="small" />
                    </IconButton>
                </Box>
            </Box>
        </DialogTitle>
        <DialogContent sx={fileDialogContentSx}>
            <FileDialogDetails title={t('adsb.capture_details', 'Capture details')} details={[
                {label: t('adsb.icao', 'ICAO address'), value: detail.icao?.toUpperCase() || '—', mono: true},
                {label: t('adsb.first_received', 'First received'), value: date(detail.captured_at)},
                {label: t('adsb.last_received', 'Last received'), value: date(detail.last_packet_at)},
            ]} />
            {aircraft && <Box component="section" aria-label={aircraftT('aircraft.details', 'Aircraft details')}>
                <FileDialogDetails title={aircraftT('aircraft.details', 'Aircraft details')}
                    details={Object.keys(AIRCRAFT_FIELDS).map((key) => ({
                        label: aircraftLabel(key, aircraftT), value: aircraftValue(aircraft, key, aircraftT),
                    }))} />
            </Box>}
            <Paper variant="outlined" sx={fileDialogSectionSx}>
                <Box sx={fileDialogSectionHeaderSx}>
                    <Typography variant="subtitle2" fontWeight={700}>{t('adsb.state_table', 'Aircraft states')}</Typography>
                </Box>
                <Box sx={{p: 2.25}}>
                    <TextField select fullWidth size="small" label={t('adsb.run', 'Capture run')} value={run} sx={{mb: 2}}
                        slotProps={{select: {displayEmpty: true}, inputLabel: {shrink: true}}}
                        helperText={t('adsb.window', 'Each capture run covers 12 hours from its first received state.')}
                        onChange={(event) => {setRun(event.target.value); setPageStart(null); setSelected(null);}}>
                        <MenuItem value="">{t('adsb.all_runs', 'All runs')}</MenuItem>
                        {(detail.runs || []).map((item) => <MenuItem key={item.name} value={item.name}>
                            {formatCaptureRunLabel(item, timeSettings)}
                        </MenuItem>)}
                    </TextField>
                    {error && <Alert severity="error">{error}</Alert>}
                    <TableContainer>
                        <Table size="small" sx={{minWidth: 1000}} aria-label={t('adsb.state_table', 'Aircraft states')}>
                            <TableHead><TableRow>
                                {['Received', 'Callsign', 'Baro altitude (m)', 'Speed (m/s)', 'Squawk', 'Position'].map((label) => <TableCell key={label}>{label}</TableCell>)}
                                {['registration', 'type_code', 'classification'].map((key) => <TableCell key={key}>
                                    {aircraftLabel(key, aircraftT)}
                                </TableCell>)}
                            </TableRow></TableHead>
                            <TableBody>{[...records].reverse().map((record, index) => <TableRow hover key={`${record.receiver_id}:${record.timestamp}:${index}`}
                                selected={selected === record} onClick={() => setSelected(record)} sx={{cursor: 'pointer'}}>
                                <TableCell sx={{whiteSpace: 'nowrap'}}>{date(record.captured_at)}</TableCell>
                                <TableCell>{record.callsign || '—'}</TableCell>
                                <TableCell>{record.altitude_baro_m == null ? '—' : Math.round(record.altitude_baro_m)}</TableCell>
                                <TableCell>{record.groundspeed_mps?.toFixed(1) ?? '—'}</TableCell>
                                <TableCell>{record.squawk || '—'}</TableCell>
                                <TableCell sx={{whiteSpace: 'nowrap'}}>{record.latitude == null ? '—' : `${record.latitude}, ${record.longitude}`}</TableCell>
                                {['registration', 'type_code', 'classification'].map((key) => <TableCell key={key}>
                                    {aircraftValue(record.aircraft, key, aircraftT)}
                                </TableCell>)}
                            </TableRow>)}</TableBody>
                        </Table>
                    </TableContainer>
                    <Box sx={{display: 'flex', gap: 1, mt: 2, flexWrap: 'wrap'}}>
                        <Button size="small" variant="outlined" disabled={start === 0} onClick={() => setPageStart(Math.max(0, start - 50))}>{t('adsb.older', 'Older states')}</Button>
                        <Button size="small" variant="outlined" onClick={() => setPageStart(null)}>{t('adsb.latest', 'Latest states')}</Button>
                    </Box>
                </Box>
            </Paper>
            {selected && <Paper variant="outlined" sx={fileDialogSectionSx}>
                <Box sx={fileDialogSectionHeaderSx}>
                    <Typography variant="subtitle2" fontWeight={700}>{t('adsb.selected_state', 'Selected state')}</Typography>
                </Box>
                <Box component="pre" sx={{m: 0, p: 2.25, maxHeight: 300, overflow: 'auto', fontSize: 12}}>{JSON.stringify(selected, null, 2)}</Box>
            </Paper>}
        </DialogContent>
        <DialogActions disableSpacing sx={fileDialogActionsSx}>
            <Button color="error" variant="outlined" startIcon={<DeleteIcon />} onClick={() => onDelete(detail)}>{t('adsb.delete', 'Delete aircraft captures')}</Button>
            <Button component="a" variant="outlined" href={detail.download_url} startIcon={<DownloadIcon />}>{t('adsb.download', 'Download captures')}</Button>
            <Button variant="outlined" onClick={onClose}>{t('adsb.close', 'Close')}</Button>
        </DialogActions>
    </Dialog>;
}
