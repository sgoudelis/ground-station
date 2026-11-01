import React, { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
    Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
    DialogTitle, IconButton, MenuItem, Pagination, Stack, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import { fetchFileDetails } from './filebrowser-slice.jsx';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { formatDateTime } from '../../utils/date-time.js';
import { compactDialogTitleSx, mobileFullScreenPaperSx } from '../common/dialog-layout.js';

const PAGE_SIZE = 50;

export default function RadiosondeFolderDialog({ folder, socket, onClose, onOpenPacket, onDelete }) {
    const dispatch = useDispatch();
    const { t } = useTranslation('filebrowser');
    const { timezone, locale } = useUserTimeSettings();
    const [detail, setDetail] = useState(folder);
    const [page, setPage] = useState(1);
    const [run, setRun] = useState('');
    const [revision, setRevision] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const date = (value) => value ? formatDateTime(value, { timezone, locale }) : '—';

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

    return (
        <Dialog open onClose={onClose} fullWidth maxWidth="lg" slotProps={{ paper: { sx: mobileFullScreenPaperSx } }}>
            <DialogTitle sx={compactDialogTitleSx}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                    <Typography component="span" variant="h6">{folder.name}</Typography>
                    <IconButton onClick={onClose} aria-label={t('radiosonde_folder.close', 'Close radiosonde folder')}><CloseIcon /></IconButton>
                </Box>
            </DialogTitle>
            <DialogContent dividers>
                <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 2 }}>
                    <Chip label={t('radiosonde_folder.model', 'Model: {{model}}', { model: detail.model })} />
                    <Chip label={t('radiosonde_folder.serial', 'Serial: {{serial}}', { serial: detail.serial })} />
                    <Chip label={t('radiosonde_folder.packets', '{{count}} packets', { count: detail.packet_count })} />
                    <Chip label={t('radiosonde_folder.flights', '{{count}} flights', { count: detail.run_count })} />
                </Stack>
                <Typography variant="body2" sx={{ mb: 2 }}>
                    {t('radiosonde_folder.capture_range', 'Received: {{first}} – {{last}}', {
                        first: date(detail.captured_at), last: date(detail.last_packet_at),
                    })}
                </Typography>
                <TextField select fullWidth size="small" value={run} sx={{ mb: 2 }}
                    label={t('radiosonde_folder.flight', 'Flight')}
                    slotProps={{
                        // The empty filter still has an option label to display.
                        select: { displayEmpty: true },
                        inputLabel: { shrink: true },
                    }}
                    helperText={t('radiosonde_folder.window', 'Each flight covers 12 hours from its first received packet.')}
                    onChange={(event) => { setRun(event.target.value); setPage(1); }}>
                    <MenuItem value="">{t('radiosonde_folder.all_flights', 'All flights')}</MenuItem>
                    {(detail.runs || []).map(item => <MenuItem key={item.name} value={item.name}>
                        {item.name === 'legacy' ? t('radiosonde_folder.legacy', 'Legacy packets') : item.name}
                        {` (${item.packet_count})`}
                    </MenuItem>)}
                </TextField>
                {error && <Alert severity="error">{error}</Alert>}
                {loading && <Box role="status" aria-label={t('radiosonde_folder.loading', 'Loading packets')}><CircularProgress size={22} /></Box>}
                <TableContainer>
                    <Table size="small" aria-label={t('radiosonde_folder.packet_table', 'Radiosonde packets')}>
                        <TableHead><TableRow>
                            <TableCell>{t('radiosonde_folder.received', 'Received')}</TableCell>
                            <TableCell>{t('radiosonde_folder.frame', 'Frame')}</TableCell>
                            <TableCell>{t('radiosonde_folder.file', 'File')}</TableCell>
                            <TableCell align="right">{t('radiosonde_folder.actions', 'Actions')}</TableCell>
                        </TableRow></TableHead>
                        <TableBody>{(detail.packets || []).map(packet => <TableRow key={packet.path}>
                            <TableCell sx={{ whiteSpace: 'nowrap' }}>{date(packet.captured_at)}</TableCell>
                            <TableCell>{packet.frame ?? '—'}</TableCell>
                            <TableCell sx={{ overflowWrap: 'anywhere' }}>{packet.filename}</TableCell>
                            <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                                <Button size="small" onClick={() => onOpenPacket(packet)} disabled={loading}>
                                    {t('radiosonde_folder.view', 'View')}
                                </Button>
                                <IconButton size="small" href={packet.url} download={packet.filename}
                                    aria-label={t('radiosonde_folder.download_packet', 'Download {{filename}}', { filename: packet.filename })}>
                                    <DownloadIcon fontSize="small" />
                                </IconButton>
                            </TableCell>
                        </TableRow>)}</TableBody>
                    </Table>
                </TableContainer>
                {!loading && !error && !detail.total && <Typography sx={{ mt: 2 }}>{t('radiosonde_folder.empty', 'No packets in this flight.')}</Typography>}
                <Pagination sx={{ mt: 2 }} page={page} count={Math.max(1, Math.ceil((detail.total || 0) / PAGE_SIZE))}
                    disabled={loading} onChange={(_event, value) => setPage(value)} />
            </DialogContent>
            <DialogActions>
                <Button color="error" onClick={() => onDelete(detail)}>{t('radiosonde_folder.delete', 'Delete sonde captures')}</Button>
                <Button component="a" href={detail.download_url} startIcon={<DownloadIcon />}>
                    {t('radiosonde_folder.download', 'Download all captures')}
                </Button>
                <Button onClick={onClose}>{t('radiosonde_folder.close_button', 'Close')}</Button>
            </DialogActions>
        </Dialog>
    );
}
