/** Copyright (c) 2026 Efstratios Goudelis — GPL-3.0-or-later */

import React from 'react';
import {Box, Button, Chip, IconButton, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Typography} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import {useTranslation} from 'react-i18next';
import {formatDateTime} from '../../utils/date-time.js';
import {fileDialogPacketTableSx} from './file-dialog-styles.js';

const columns = [200, 180, 160, 330, 190];
const columnTotal = columns.reduce((total, width) => total + width, 0);

export default function MeshtasticPacketTable({packets, loading, error, settings, onOpenPacket}) {
    const {t} = useTranslation('filebrowser');
    const statuses = {
        decoded: {label: t('meshtastic_folder.status_decoded', 'Decoded'), color: 'success'},
        unsupported: {label: t('meshtastic_folder.status_unsupported', 'Unsupported'), color: 'default'},
        malformed: {label: t('meshtastic_folder.status_malformed', 'Malformed'), color: 'error'},
    };
    return <TableContainer sx={{maxHeight: 480, scrollbarWidth: 'thin', scrollbarGutter: 'stable'}}>
        <Table stickyHeader size="small" aria-label={t('meshtastic_folder.packets', 'Meshtastic packets')} aria-busy={loading}
            sx={(theme) => ({...fileDialogPacketTableSx(theme), minWidth: 800})}>
            <colgroup>{columns.map((width, index) => <col key={index} style={{width: `${width / columnTotal * 100}%`}} />)}</colgroup>
            <TableHead><TableRow>
                <TableCell aria-label={t('meshtastic_folder.received_timezone', 'Received ({{timezone}})', {timezone: settings.timezone || 'UTC'})}>
                    {t('meshtastic_folder.received', 'Received')}
                    <Typography component="span" variant="caption" sx={{display: 'block', mt: 0.25, fontSize: '0.68rem', color: 'text.secondary'}}>
                        {settings.timezone || 'UTC'}
                    </Typography>
                </TableCell>
                <TableCell>{t('meshtastic_folder.application', 'Application')}</TableCell>
                <TableCell>{t('meshtastic_folder.status', 'Status')}</TableCell>
                <TableCell>{t('meshtastic_folder.file', 'File')}</TableCell>
                <TableCell align="right">{t('meshtastic_folder.actions', 'Actions')}</TableCell>
            </TableRow></TableHead>
            <TableBody>{packets.map((packet) => {
                const status = statuses[packet.payload_status] || {
                    label: packet.payload_status || t('meshtastic_folder.status_unknown', 'Unknown'), color: 'default',
                };
                const received = packet.captured_at ? formatDateTime(packet.captured_at, settings) || '—' : '—';
                return <TableRow hover key={packet.path}>
                    <TableCell className="packet-received" title={received} sx={{whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'}}>{received}</TableCell>
                    <TableCell><Typography variant="body2" sx={{fontSize: '0.8rem', fontWeight: 600, overflowWrap: 'anywhere'}}>{packet.application || '—'}</Typography></TableCell>
                    <TableCell><Chip size="small" variant="outlined" color={status.color} label={status.label}
                        sx={{height: 23, maxWidth: '100%', fontSize: '0.7rem', borderRadius: 1}} /></TableCell>
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
                            {t('meshtastic_folder.view', 'View')}
                        </Button>
                        <IconButton size="small" href={packet.url} download={packet.filename}
                            aria-label={t('meshtastic_folder.download_packet', 'Download {{filename}}', {filename: packet.filename})}>
                            <DownloadIcon fontSize="small" />
                        </IconButton>
                    </TableCell>
                </TableRow>;
            })}
            {!packets.length && <TableRow><TableCell className="packet-empty" colSpan={columns.length} sx={{textAlign: 'center', color: 'text.secondary'}}>
                {loading ? t('meshtastic_folder.loading', 'Loading packets…') : error
                    ? t('meshtastic_folder.unavailable', 'Packets are unavailable.') : t('meshtastic_folder.empty', 'No packets in this run.')}
            </TableCell></TableRow>}
            </TableBody>
        </Table>
    </TableContainer>;
}
