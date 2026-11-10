/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React from 'react';
import {Button, IconButton, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import {useTranslation} from 'react-i18next';
import {formatDateTime} from '../../utils/date-time.js';
import {getAprsDataTypeLabel} from './aprs-utils.js';
import {fileDialogPacketTableSx} from './file-dialog-styles.js';

const columns = [210, 180, 120, 360, 160];
const columnTotal = columns.reduce((total, width) => total + width, 0);

export default function AprsPacketTable({packets, loading, error, settings, onOpenPacket}) {
    const {t} = useTranslation('filebrowser');
    const text = (key, fallback, options = {}) => t(`aprs_folder.${key}`, {defaultValue: fallback, ...options});
    const timezone = settings.timezone || 'UTC';
    return <TableContainer sx={{maxHeight: 480, scrollbarWidth: 'thin', scrollbarGutter: 'stable'}}>
        <Table stickyHeader size="small" aria-label={text('packets', 'APRS packets')} aria-busy={loading}
            sx={theme => ({...fileDialogPacketTableSx(theme), minWidth: 900})}>
            <colgroup>{columns.map((width, index) => <col key={index} style={{width: `${width / columnTotal * 100}%`}} />)}</colgroup>
            <TableHead><TableRow>
                <TableCell aria-label={text('received_timezone', 'Received ({{timezone}})', {timezone})}>
                    {text('received', 'Received')}
                    <Typography component="span" variant="caption" sx={{display: 'block', mt: 0.25, fontSize: '0.68rem', color: 'text.secondary'}}>
                        {timezone}
                    </Typography>
                </TableCell>
                <TableCell>{text('packet_type', 'Packet type')}</TableCell>
                <TableCell>{text('status', 'Status')}</TableCell>
                <TableCell>{text('file', 'File')}</TableCell>
                <TableCell align="right">{text('actions', 'Actions')}</TableCell>
            </TableRow></TableHead>
            <TableBody>{packets.map(packet => {
                const received = packet.captured_at ? formatDateTime(packet.captured_at, settings) || '—' : '—';
                return <TableRow hover key={packet.path}>
                    <TableCell className="packet-received" title={received} sx={{whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>
                        {received}
                    </TableCell>
                    <TableCell sx={{overflowWrap: 'anywhere'}}>{getAprsDataTypeLabel(packet)}</TableCell>
                    <TableCell sx={{overflowWrap: 'anywhere'}}>{packet.payload_status || '—'}</TableCell>
                    <TableCell>
                        <Typography variant="body2" noWrap title={packet.filename} sx={{fontFamily: 'monospace', fontSize: '0.75rem', color: 'text.secondary'}}>
                            {packet.filename}
                        </Typography>
                    </TableCell>
                    <TableCell align="right" sx={{whiteSpace: 'nowrap'}}>
                        <Button size="small" disabled={loading} onClick={() => onOpenPacket(packet)}>{text('view', 'View')}</Button>
                        <IconButton size="small" href={packet.url} download={packet.filename}
                            aria-label={text('download_packet', 'Download {{filename}}', {filename: packet.filename})}>
                            <DownloadIcon fontSize="small" />
                        </IconButton>
                    </TableCell>
                </TableRow>;
            })}
            {!packets.length && <TableRow><TableCell className="packet-empty" colSpan={columns.length} sx={{textAlign: 'center', color: 'text.secondary'}}>
                {loading ? text('loading', 'Loading packets…') : error
                    ? text('unavailable', 'Packets are unavailable.') : text('empty', 'No packets in this run.')}
            </TableCell></TableRow>}
            </TableBody>
        </Table>
    </TableContainer>;
}
