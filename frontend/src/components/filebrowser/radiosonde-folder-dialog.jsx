/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React, { useEffect, useId, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
    Alert, Box, Button, Dialog, DialogActions, DialogContent, LinearProgress,
    MenuItem, Pagination, Paper, TextField, Typography,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteIcon from '@mui/icons-material/Delete';
import HistoryIcon from '@mui/icons-material/History';
import { fetchFileDetails } from './filebrowser-slice.jsx';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import RadiosondeOverview, {RadiosondeOverviewHeader} from './radiosonde-overview.jsx';
import RadiosondePacketTable from './radiosonde-packet-table.jsx';
import FlightPathMap from './flight-path-map.jsx';
import { formatCaptureRunLabel } from './capture-run-label.js';
import {
    fileDialogActionsSx,
    fileDialogContentSx,
    fileDialogPaperSx,
    fileDialogSectionHeaderSx,
    fileDialogSectionSx,
} from './file-dialog-styles.js';

const PAGE_SIZE = 50;

export default function RadiosondeFolderDialog({ folder, socket, onClose, onOpenPacket, onDelete }) {
    const dispatch = useDispatch();
    const { t } = useTranslation('filebrowser');
    const settings = useUserTimeSettings();
    const titleId = useId();
    const [detail, setDetail] = useState(folder);
    const [page, setPage] = useState(1);
    const [run, setRun] = useState('');
    const [revision, setRevision] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let active = true;
        setLoading(true);
        dispatch(fetchFileDetails({ socket, id: folder.id, page, pageSize: PAGE_SIZE, run }))
            .unwrap().then((result) => {
                if (!active) return;
                setDetail(result);
                setPage(result.page);
                setError(null);
            }).catch((failure) => {
                if (active) setError(String(failure));
            }).finally(() => {
                if (active) setLoading(false);
            });
        return () => { active = false; };
    }, [dispatch, socket, folder.id, page, run, revision]);

    useEffect(() => {
        if (!socket) return;
        let timer;
        // Coalesce storage notifications without reloading on every frame.
        const refresh = () => {
            if (!timer) timer = setTimeout(() => { timer = null; setRevision(value => value + 1); }, 500);
        };
        socket.on('library.changed', refresh);
        return () => { socket.off('library.changed', refresh); clearTimeout(timer); };
    }, [socket]);

    const packets = detail.packets || [];
    const total = detail.total || 0;
    const firstShown = packets.length ? (page - 1) * PAGE_SIZE + 1 : 0;
    const lastShown = firstShown ? firstShown + packets.length - 1 : 0;
    return (
        <Dialog open onClose={onClose} aria-labelledby={titleId} fullWidth maxWidth="lg" slotProps={{paper: {sx: fileDialogPaperSx}}}>
            <RadiosondeOverviewHeader detail={detail} titleId={titleId} onClose={onClose} />
            <DialogContent sx={fileDialogContentSx}>
                <RadiosondeOverview detail={detail} settings={settings} />
                <FlightPathMap socket={socket} folderId={folder.id} run={run} runs={detail.runs} settings={settings}
                    filter={<TextField select size="small" value={run} sx={{width: {xs: '100%', sm: 300}, flexShrink: 0}}
                        label={t('radiosonde_folder.flight', 'Flight')}
                        slotProps={{select: {displayEmpty: true}, inputLabel: {shrink: true}}}
                        onChange={(event) => {setRun(event.target.value); setPage(1);}}>
                        <MenuItem value="">{t('radiosonde_folder.all_flights', 'All flights')}</MenuItem>
                        {(detail.runs || []).map(item => <MenuItem key={item.name} value={item.name}>
                            {formatCaptureRunLabel(item, settings,
                                item.name === 'legacy' ? t('radiosonde_folder.legacy', 'Legacy packets') : item.name)}
                            {` (${item.packet_count})`}
                        </MenuItem>)}
                    </TextField>} />
                <Paper component="section" aria-label={t('radiosonde_folder.history', 'Packet history')} variant="outlined" sx={fileDialogSectionSx}>
                    <Box sx={{...fileDialogSectionHeaderSx, px: {xs: 2, sm: 2.5}, bgcolor: 'background.paper',
                        flexDirection: {xs: 'column', sm: 'row'}, alignItems: {xs: 'stretch', sm: 'center'}}}>
                        <Box sx={{display: 'flex', alignItems: 'center', gap: 1.25}}>
                            <HistoryIcon sx={{fontSize: 20, color: 'text.secondary'}} />
                            <Box>
                                <Typography component="h3" variant="subtitle2" fontWeight={600}>{t('radiosonde_folder.history', 'Packet history')}</Typography>
                                <Typography variant="caption" color="text.secondary">{t('radiosonde_folder.history_hint', 'Recorded radiosonde packets · Newest first')}</Typography>
                            </Box>
                        </Box>
                    </Box>
                    <Box sx={{px: {xs: 2, sm: 2.5}, py: 1, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', columnGap: 2,
                        rowGap: 0.5, borderBottom: '1px solid', borderColor: 'divider'}}>
                        <Typography variant="caption" color="text.secondary">{t('radiosonde_folder.window', 'Each flight covers 12 hours from its first received packet.')}</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{fontVariantNumeric: 'tabular-nums'}}>
                            {t('radiosonde_folder.shown_packets', '{{count}} packets shown', {count: packets.length})}
                        </Typography>
                    </Box>
                    {error && <Alert severity="error" sx={{mx: 2.5, my: 1.5}}>{error}</Alert>}
                    <Box sx={{height: 2}}>
                        {loading && <LinearProgress aria-label={t('radiosonde_folder.loading', 'Loading packets')} sx={{height: 2}} />}
                    </Box>
                    <RadiosondePacketTable packets={packets} loading={loading} error={error} settings={settings} onOpenPacket={onOpenPacket} />
                    <Box sx={{px: {xs: 2, sm: 2.5}, py: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        flexWrap: 'wrap', columnGap: 2, rowGap: 1, borderTop: '1px solid', borderColor: 'divider'}}>
                        <Typography variant="caption" color="text.secondary" sx={{fontVariantNumeric: 'tabular-nums'}}>
                            {t('radiosonde_folder.packet_range', '{{first}}–{{last}} of {{count}} packets', {first: firstShown, last: lastShown, count: total})}
                        </Typography>
                        <Pagination size="small" shape="rounded" page={page} count={Math.max(1, Math.ceil(total / PAGE_SIZE))}
                            disabled={loading} onChange={(_event, value) => setPage(value)} />
                    </Box>
                </Paper>
            </DialogContent>
            <DialogActions disableSpacing sx={fileDialogActionsSx}>
                {onDelete && <Button color="error" variant="outlined" startIcon={<DeleteIcon />} onClick={() => onDelete(detail)}>{t('radiosonde_folder.delete', 'Delete sonde captures')}</Button>}
                <Button component="a" variant="outlined" href={detail.download_url} startIcon={<DownloadIcon />}>
                    {t('radiosonde_folder.download', 'Download all captures')}
                </Button>
                <Button variant="outlined" onClick={onClose}>{t('radiosonde_folder.close_button', 'Close')}</Button>
            </DialogActions>
        </Dialog>
    );
}
