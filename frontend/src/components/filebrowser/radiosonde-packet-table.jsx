/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React from 'react';
import {Box, Button, IconButton, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography} from '@mui/material';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import DownloadIcon from '@mui/icons-material/Download';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import {useTranslation} from 'react-i18next';
import {formatDateTime} from '../../utils/date-time.js';
import {fileDialogPacketTableSx} from './file-dialog-styles.js';

const columns = [210, 110, 440, 190];
const columnTotal = columns.reduce((total, width) => total + width, 0);

export default function RadiosondePacketTable({packets, loading, error, settings, onOpenPacket}) {
    const {t} = useTranslation('filebrowser');
    const frameFormat = new Intl.NumberFormat(settings.locale, {maximumFractionDigits: 0});
    return <TableContainer sx={{maxHeight: 480, scrollbarWidth: 'thin', scrollbarGutter: 'stable'}}>
        <Table stickyHeader size="small" aria-label={t('radiosonde_folder.packet_table', 'Radiosonde packets')} aria-busy={loading}
            sx={(theme) => ({...fileDialogPacketTableSx(theme), minWidth: 720})}>
            <colgroup>{columns.map((width, index) => <col key={index} style={{width: `${width / columnTotal * 100}%`}} />)}</colgroup>
            <TableHead><TableRow>
                <TableCell aria-label={t('radiosonde_folder.received_timezone', 'Received ({{timezone}})', {timezone: settings.timezone || 'UTC'})}>
                    {t('radiosonde_folder.received', 'Received')}
                    <Typography component="span" variant="caption" sx={{display: 'block', mt: 0.25, fontSize: '0.68rem', color: 'text.secondary'}}>
                        {settings.timezone || 'UTC'}
                    </Typography>
                </TableCell>
                <TableCell align="right">{t('radiosonde_folder.frame', 'Frame')}</TableCell>
                <TableCell>{t('radiosonde_folder.file', 'File')}</TableCell>
                <TableCell align="right">{t('radiosonde_folder.actions', 'Actions')}</TableCell>
            </TableRow></TableHead>
            <TableBody>{packets.map((packet) => {
                const received = packet.captured_at ? formatDateTime(packet.captured_at, settings) || '—' : '—';
                return <TableRow hover key={packet.path}>
                    <TableCell className="packet-received" title={received} sx={{whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{received}</TableCell>
                    <TableCell align="right" sx={{fontFamily: 'monospace', fontWeight: 600}}>
                        {Number.isFinite(packet.frame) ? frameFormat.format(packet.frame) : packet.frame ?? '—'}
                    </TableCell>
                    <TableCell>
                        <Box sx={{display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0}}>
                            <DescriptionOutlinedIcon sx={{fontSize: 16, flexShrink: 0, color: 'text.disabled'}} />
                            <Typography variant="body2" noWrap title={packet.filename} sx={{fontFamily: 'monospace', fontSize: '0.75rem', color: 'text.secondary'}}>
                                {packet.filename}
                            </Typography>
                        </Box>
                    </TableCell>
                    <TableCell align="right" sx={{whiteSpace: 'nowrap'}}>
                        <Button size="small" disabled={loading} onClick={() => onOpenPacket(packet)} startIcon={<VisibilityOutlinedIcon />}
                            sx={{minWidth: 0, px: 1, mr: 0.5, textTransform: 'none', fontSize: '0.75rem', '& .MuiButton-startIcon > svg': {fontSize: 16}}}>
                            {t('radiosonde_folder.view', 'View')}
                        </Button>
                        <IconButton size="small" href={packet.url} download={packet.filename}
                            aria-label={t('radiosonde_folder.download_packet', 'Download {{filename}}', {filename: packet.filename})}>
                            <DownloadIcon fontSize="small" />
                        </IconButton>
                    </TableCell>
                </TableRow>;
            })}
            {!packets.length && <TableRow><TableCell className="packet-empty" colSpan={columns.length} sx={{textAlign: 'center', color: 'text.secondary'}}>
                {loading ? t('radiosonde_folder.loading', 'Loading packets') : error
                    ? t('radiosonde_folder.unavailable', 'Packets are unavailable.') : t('radiosonde_folder.empty', 'No packets in this flight.')}
            </TableCell></TableRow>}
            </TableBody>
        </Table>
    </TableContainer>;
}
