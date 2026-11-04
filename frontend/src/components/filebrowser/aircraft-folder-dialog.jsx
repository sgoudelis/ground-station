import React, {useEffect, useId, useState} from 'react';
import {Alert, Box, Button, Dialog, DialogActions, DialogContent, MenuItem, Paper, TextField, Typography} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import DeleteIcon from '@mui/icons-material/Delete';
import DownloadIcon from '@mui/icons-material/Download';
import HistoryIcon from '@mui/icons-material/History';
import LastPageIcon from '@mui/icons-material/LastPage';
import {useTranslation} from 'react-i18next';
import {callLibrary} from '../packetmap/use-packet-positions.js';
import {useUserTimeSettings} from '../../hooks/useUserTimeSettings.jsx';
import AircraftOverview, {AircraftOverviewHeader} from './aircraft-overview.jsx';
import AircraftHistoryTable from './aircraft-history-table.jsx';
import FlightPathMap from './flight-path-map.jsx';
import {formatCaptureRunLabel} from './capture-run-label.js';
import {
    fileDialogActionsSx,
    fileDialogContentSx,
    fileDialogPaperSx,
    fileDialogSectionHeaderSx,
    fileDialogSectionSx,
} from './file-dialog-styles.js';

export default function AircraftFolderDialog({folder, socket, onClose, onDelete}) {
    const {t} = useTranslation('filebrowser');
    const timeSettings = useUserTimeSettings();
    const titleId = useId();
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
                // Reloading a page or replacing a log invalidates its selected snapshot.
                if (initial || data.reset) setSelected(null);
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
    const shownCount = records.length + (selected && !records.includes(selected) ? 1 : 0);
    const showLatest = () => {setSelected(null); setPageStart(null);};
    return <Dialog open onClose={onClose} aria-labelledby={titleId} maxWidth="lg" fullWidth slotProps={{paper: {sx: fileDialogPaperSx}}}>
        <AircraftOverviewHeader detail={detail} titleId={titleId} onClose={onClose} />
        <DialogContent sx={fileDialogContentSx}>
            <AircraftOverview detail={detail} timeSettings={timeSettings} />
            <FlightPathMap socket={socket} folderId={folder.id} run={run} runs={detail.runs} settings={timeSettings}
                filter={<TextField select size="small" label={t('adsb.run', 'Capture run')} value={run} sx={{width: {xs: '100%', sm: 280}, flexShrink: 0}}
                    slotProps={{select: {displayEmpty: true}, inputLabel: {shrink: true}}}
                    onChange={(event) => {setRun(event.target.value); setPageStart(null); setSelected(null);}}>
                    <MenuItem value="">{t('adsb.all_runs', 'All runs')}</MenuItem>
                    {(detail.runs || []).map((item) => <MenuItem key={item.name} value={item.name}>
                        {formatCaptureRunLabel(item, timeSettings)}
                    </MenuItem>)}
                </TextField>} />
            <Paper variant="outlined" sx={fileDialogSectionSx}>
                <Box sx={{...fileDialogSectionHeaderSx, px: {xs: 2, sm: 2.5}, bgcolor: 'background.paper',
                    flexDirection: {xs: 'column', sm: 'row'}, alignItems: {xs: 'stretch', sm: 'center'}}}>
                    <Box sx={{display: 'flex', alignItems: 'center', gap: 1.25}}>
                        <HistoryIcon sx={{fontSize: 20, color: 'text.secondary'}} />
                        <Box>
                            <Typography component="h3" variant="subtitle2" fontWeight={600}>{t('adsb.history', 'Aircraft history')}</Typography>
                            <Typography variant="caption" color="text.secondary">{t('adsb.history_hint', 'Recorded ADS-B updates · Newest first')}</Typography>
                        </Box>
                    </Box>
                </Box>
                <Box sx={{px: {xs: 2, sm: 2.5}, py: 1, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', columnGap: 2,
                    rowGap: 0.5, borderBottom: '1px solid', borderColor: 'divider'}}>
                    <Typography variant="caption" color="text.secondary">
                        {t('adsb.window', 'Each capture run covers 12 hours from its first received update.')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{fontVariantNumeric: 'tabular-nums'}}>
                        {t('adsb.shown_updates', '{{count}} updates shown', {count: shownCount})}
                    </Typography>
                </Box>
                {error && <Alert severity="error" sx={{mx: 2.5, my: 1.5}}>{error}</Alert>}
                <AircraftHistoryTable records={records} selected={selected}
                    onSelect={(record) => setSelected((current) => current === record ? null : record)} timeSettings={timeSettings} />
                <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, flexWrap: 'wrap',
                    px: {xs: 2, sm: 2.5}, py: 1.5, borderTop: '1px solid', borderColor: 'divider'}}>
                    <Typography variant="caption" color="text.secondary">{t('adsb.select_update_hint', 'Select a row to view update details.')}</Typography>
                    <Box sx={{display: 'flex', gap: 1, flexWrap: 'wrap'}}>
                        <Button size="small" variant="outlined" startIcon={<ChevronLeftIcon />} disabled={start === 0}
                            onClick={() => {setSelected(null); setPageStart(Math.max(0, start - 50));}}>{t('adsb.older_updates', 'Older updates')}</Button>
                        <Button size="small" variant="outlined" endIcon={<LastPageIcon />} onClick={showLatest}>{t('adsb.latest_updates', 'Latest updates')}</Button>
                    </Box>
                </Box>
            </Paper>
        </DialogContent>
        <DialogActions disableSpacing sx={fileDialogActionsSx}>
            <Button color="error" variant="outlined" startIcon={<DeleteIcon />} onClick={() => onDelete(detail)}>{t('adsb.delete', 'Delete aircraft captures')}</Button>
            <Button component="a" variant="outlined" href={detail.download_url} startIcon={<DownloadIcon />}>{t('adsb.download', 'Download captures')}</Button>
            <Button variant="outlined" onClick={onClose}>{t('adsb.close', 'Close')}</Button>
        </DialogActions>
    </Dialog>;
}
