import React, { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
    Alert, Box, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent,
    DialogTitle, IconButton, MenuItem, Pagination, Paper, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, TextField, Typography,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import DownloadIcon from '@mui/icons-material/Download';
import DeleteIcon from '@mui/icons-material/Delete';
import SensorsIcon from '@mui/icons-material/Sensors';
import { fetchFileDetails } from './filebrowser-slice.jsx';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { formatDateTime } from '../../utils/date-time.js';
import FileDialogDetails from './file-dialog-details.jsx';
import { formatCaptureRunLabel } from './capture-run-label.js';
import {
    fileDialogActionsSx,
    fileDialogContentSx,
    fileDialogPaperSx,
    fileDialogSectionHeaderSx,
    fileDialogSectionSx,
    fileDialogTitleSx,
} from './file-dialog-styles.js';

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
        <Dialog open onClose={onClose} fullWidth maxWidth="lg" slotProps={{ paper: { sx: fileDialogPaperSx } }}>
            <DialogTitle sx={fileDialogTitleSx}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: '1 1 auto', minWidth: 0 }}>
                        <SensorsIcon color="primary" />
                        <Typography component="span" variant="h6" noWrap sx={{ minWidth: 0 }}>{folder.name}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                        <Box sx={{ display: 'flex', gap: 0.5, overflow: 'hidden', maxWidth: { xs: '35vw', sm: 'none' } }}>
                            <Chip size="small" color="info" label={t('radiosonde_folder.packets', '{{count}} packets', { count: detail.packet_count })} />
                            <Chip size="small" variant="outlined" label={t('radiosonde_folder.flights', '{{count}} flights', { count: detail.run_count })} />
                        </Box>
                        <IconButton size="small" onClick={onClose} aria-label={t('radiosonde_folder.close', 'Close radiosonde folder')}>
                            <CloseIcon fontSize="small" />
                        </IconButton>
                    </Box>
                </Box>
            </DialogTitle>
            <DialogContent sx={fileDialogContentSx}>
                <FileDialogDetails title={t('radiosonde_folder.details', 'Radiosonde details')} details={[
                    { label: t('radiosonde_folder.model_label', 'Model'), value: detail.model || '—' },
                    { label: t('radiosonde_folder.serial_label', 'Serial'), value: detail.serial || '—', mono: true },
                    { label: t('radiosonde_folder.first_received', 'First received'), value: date(detail.captured_at) },
                    { label: t('radiosonde_folder.last_received', 'Last received'), value: date(detail.last_packet_at) },
                ]} />
                <Paper variant="outlined" sx={fileDialogSectionSx}>
                    <Box sx={fileDialogSectionHeaderSx}>
                        <Typography variant="subtitle2" fontWeight={700}>{t('radiosonde_folder.packet_table', 'Radiosonde packets')}</Typography>
                    </Box>
                    <Box sx={{ p: 2.25 }}>
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
                                {formatCaptureRunLabel(item, { timezone, locale },
                                    item.name === 'legacy' ? t('radiosonde_folder.legacy', 'Legacy packets') : item.name)}
                                {` (${item.packet_count})`}
                            </MenuItem>)}
                        </TextField>
                        {error && <Alert severity="error">{error}</Alert>}
                        {loading && <Box role="status" aria-label={t('radiosonde_folder.loading', 'Loading packets')}><CircularProgress size={22} /></Box>}
                        <TableContainer>
                            <Table size="small" sx={{ minWidth: 640 }} aria-label={t('radiosonde_folder.packet_table', 'Radiosonde packets')}>
                                <TableHead><TableRow>
                                    <TableCell>{t('radiosonde_folder.received', 'Received')}</TableCell>
                                    <TableCell>{t('radiosonde_folder.frame', 'Frame')}</TableCell>
                                    <TableCell>{t('radiosonde_folder.file', 'File')}</TableCell>
                                    <TableCell align="right">{t('radiosonde_folder.actions', 'Actions')}</TableCell>
                                </TableRow></TableHead>
                                <TableBody>{(detail.packets || []).map(packet => <TableRow hover key={packet.path}>
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
                    </Box>
                </Paper>
            </DialogContent>
            <DialogActions disableSpacing sx={fileDialogActionsSx}>
                <Button color="error" variant="outlined" startIcon={<DeleteIcon />} onClick={() => onDelete(detail)}>{t('radiosonde_folder.delete', 'Delete sonde captures')}</Button>
                <Button component="a" variant="outlined" href={detail.download_url} startIcon={<DownloadIcon />}>
                    {t('radiosonde_folder.download', 'Download all captures')}
                </Button>
                <Button variant="outlined" onClick={onClose}>{t('radiosonde_folder.close_button', 'Close')}</Button>
            </DialogActions>
        </Dialog>
    );
}
