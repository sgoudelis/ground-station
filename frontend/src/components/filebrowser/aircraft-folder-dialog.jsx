import React, {useEffect, useState} from 'react';
import {Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem,
    Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography} from '@mui/material';
import {useTranslation} from 'react-i18next';
import {callLibrary} from '../packetmap/use-packet-positions.js';
import {useUserTimeSettings} from '../../hooks/useUserTimeSettings.jsx';
import {formatDateTime} from '../../utils/date-time.js';
import AircraftDetails from '../common/aircraft-details.jsx';
import {aircraftValue} from '../../utils/aircraft-metadata.js';

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
    return <Dialog open onClose={onClose} maxWidth="lg" fullWidth>
        <DialogTitle>{t('adsb.title', 'Aircraft {{icao}}', {icao: detail.icao?.toUpperCase() || detail.name})}</DialogTitle>
        <DialogContent dividers>
            <Typography variant="body2" sx={{mb: 2}}>
                {t('adsb.summary', '{{count}} saved states · {{runs}} capture runs', {count: detail.packet_count, runs: detail.run_count})}
            </Typography>
            <TextField select size="small" label={t('adsb.run', 'Capture run')} value={run}
                onChange={(event) => {setRun(event.target.value); setPageStart(null); setSelected(null);}}
                sx={{minWidth: 300, mb: 2}}>
                <MenuItem value="">{t('adsb.all_runs', 'All runs')}</MenuItem>
                {(detail.runs || []).map((item) => <MenuItem key={item.name} value={item.name}>{item.name}</MenuItem>)}
            </TextField>
            {error && <Alert severity="error">{error}</Alert>}
            <AircraftDetails aircraft={(selected || records.at(-1))?.aircraft || detail.aircraft} />
            <Box sx={{overflow: 'auto'}}>
                <Table size="small">
                    <TableHead><TableRow>
                        {['Received', 'Callsign', 'Baro altitude (m)', 'Speed (m/s)', 'Squawk', 'Position'].map((label) => <TableCell key={label}>{label}</TableCell>)}
                        {['registration', 'type_code', 'military_status'].map((key) => <TableCell key={key}>
                            {aircraftT(`aircraft.fields.${key}`, {registration: 'Registration', type_code: 'Aircraft type', military_status: 'Military status'}[key])}
                        </TableCell>)}
                    </TableRow></TableHead>
                    <TableBody>{[...records].reverse().map((record, index) => <TableRow hover key={`${record.receiver_id}:${record.timestamp}:${index}`}
                        onClick={() => setSelected(record)} sx={{cursor: 'pointer'}}>
                        <TableCell>{formatDateTime(record.captured_at, timeSettings)}</TableCell>
                        <TableCell>{record.callsign || '—'}</TableCell>
                        <TableCell>{record.altitude_baro_m == null ? '—' : Math.round(record.altitude_baro_m)}</TableCell>
                        <TableCell>{record.groundspeed_mps?.toFixed(1) ?? '—'}</TableCell>
                        <TableCell>{record.squawk || '—'}</TableCell>
                        <TableCell>{record.latitude == null ? '—' : `${record.latitude}, ${record.longitude}`}</TableCell>
                        {['registration', 'type_code', 'military_status'].map((key) => <TableCell key={key}>
                            {aircraftValue(record.aircraft, key, aircraftT)}
                        </TableCell>)}
                    </TableRow>)}</TableBody>
                </Table>
            </Box>
            <Box sx={{display: 'flex', gap: 1, mt: 1}}>
                <Button disabled={start === 0} onClick={() => setPageStart(Math.max(0, start - 50))}>{t('adsb.older', 'Older states')}</Button>
                <Button onClick={() => setPageStart(null)}>{t('adsb.latest', 'Latest states')}</Button>
            </Box>
            {selected && <Box component="pre" sx={{maxHeight: 300, overflow: 'auto', fontSize: 12}}>{JSON.stringify(selected, null, 2)}</Box>}
        </DialogContent>
        <DialogActions>
            <Button color="error" onClick={() => onDelete(detail)}>{t('adsb.delete', 'Delete aircraft captures')}</Button>
            <Button component="a" href={detail.download_url}>{t('adsb.download', 'Download captures')}</Button>
            <Button onClick={onClose}>{t('adsb.close', 'Close')}</Button>
        </DialogActions>
    </Dialog>;
}
