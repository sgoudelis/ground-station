/**
 * Copyright (c) 2026 Efstratios Goudelis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {useTranslation} from 'react-i18next';
import {
    Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip,
    CircularProgress, Divider, Paper, Stack, Typography,
} from '@mui/material';
import DnsOutlinedIcon from '@mui/icons-material/DnsOutlined';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import RefreshIcon from '@mui/icons-material/Refresh';
import AddIcon from '@mui/icons-material/Add';
import {getSoapyServerKey} from './sdr-slice.jsx';

const isConfigured = (sdrs, server, radio) => sdrs.some((sdr) =>
    sdr.type === 'soapysdrremote'
    && getSoapyServerKey(sdr.host, sdr.port) === getSoapyServerKey(server.ip, server.port)
    && String(sdr.driver || '').trim() === String(radio['remote:driver'] || radio.driver || '').trim()
    && String(sdr.serial || '').trim() === String(radio.serial || '').trim());

export default function SoapyServersPanel({
    servers, manualServers, sdrs, discovering, disabled, task, elapsed, lastScanAt,
    onDiscover, onManual, onAddDevice,
}) {
    const {t} = useTranslation('hardware');
    const entries = Object.entries(servers);
    const radioCount = entries.reduce((count, [, server]) => count + (server.sdrs?.length || 0), 0);
    const failed = task?.status === 'failed';
    const stopped = task?.status === 'stopped';
    const scanned = task?.status === 'completed';

    return (
        <Paper variant="outlined" component="section" aria-label={t('sdr.remote_servers')}
               sx={{mt: 3, borderRadius: 2, overflow: 'hidden'}}>
            <Stack direction={{xs: 'column', sm: 'row'}} spacing={2}
                   sx={{px: 2.5, pt: 2.5, pb: 1.5, alignItems: {sm: 'center'}, justifyContent: 'space-between'}}>
                <Stack direction="row" spacing={1.25} alignItems="center">
                    <DnsOutlinedIcon color="primary"/>
                    <Box>
                        <Typography variant="subtitle1" component="h2" sx={{fontWeight: 700}}>
                            {t('sdr.remote_servers')}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            {t('sdr.remote_servers_help')}
                        </Typography>
                    </Box>
                </Stack>
                <Stack direction={{xs: 'column', sm: 'row'}} spacing={1} sx={{flexShrink: 0}}>
                    <Button variant="outlined" size="small" onClick={onDiscover}
                            disabled={disabled || discovering}
                            startIcon={discovering ? <CircularProgress size={15}/> : <RefreshIcon/>}>
                        {discovering ? t('sdr.scanning_network') : t('sdr.scan_network')}
                    </Button>
                    <Button size="small" onClick={onManual} disabled={disabled || discovering}>
                        {t('sdr.enter_server_manually')}
                    </Button>
                </Stack>
            </Stack>

            <Stack direction="row" spacing={1} alignItems="center" aria-live="polite"
                   sx={{px: 2.5, pb: 2, minHeight: 24}}>
                {discovering ? (
                    <Typography variant="caption" color="primary.main">
                        {t('sdr.scanning_network')}{elapsed ? ` · ${elapsed}` : ''}
                    </Typography>
                ) : (
                    <Typography variant="caption" color="text.secondary">
                        {t('sdr.server_count', {count: entries.length})} · {t('sdr.server_device_count', {count: radioCount})}
                        {lastScanAt ? ` · ${t('sdr.last_scanned', {
                            time: new Date(lastScanAt).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}),
                        })}` : ''}
                    </Typography>
                )}
            </Stack>

            {(failed || stopped) && !discovering && (
                <Alert severity={failed ? 'error' : 'warning'} sx={{mx: 2.5, mb: 2}}>
                    {t(failed ? 'sdr.network_scan_failed' : 'sdr.network_scan_stopped')}
                </Alert>
            )}

            {entries.length > 0 ? entries.map(([key, server]) => {
                const radios = Array.isArray(server.sdrs) ? server.sdrs : [];
                const serverName = String(server.name || server.ip)
                    .replace(/\._soapy\._tcp\.local\.?$/i, '').replace(/\.local\.?$/i, '');
                return (
                    <Accordion key={key} disableGutters elevation={0} defaultExpanded={entries.length === 1}
                               sx={{borderTop: '1px solid', borderColor: 'divider', '&:before': {display: 'none'}}}>
                        <AccordionSummary expandIcon={<ExpandMoreIcon/>}
                                          sx={{px: 2.5, '& .MuiAccordionSummary-content': {minWidth: 0, gap: 1.5, alignItems: 'center'}}}>
                            <Box sx={{flex: 1, minWidth: 0}}>
                                <Typography variant="body2" sx={{fontWeight: 600, overflowWrap: 'anywhere'}}>
                                    {serverName}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{overflowWrap: 'anywhere'}}>
                                    {server.ip}:{server.port}
                                </Typography>
                            </Box>
                            <Stack direction="row" spacing={0.75} sx={{flexShrink: 0}}>
                                {manualServers[key] && <Chip size="small" variant="outlined" label={t('sdr.manual_server')}/>}
                                <Chip size="small" label={t('sdr.server_device_count', {count: radios.length})}/>
                            </Stack>
                        </AccordionSummary>
                        <AccordionDetails sx={{px: {xs: 2, sm: 3}, pt: 0, pb: 1.5}}>
                            {radios.length ? (
                                <Stack divider={<Divider/>}>
                                    {radios.map((radio, index) => (
                                        <Stack key={index} direction={{xs: 'column', sm: 'row'}} spacing={1}
                                               sx={{py: 1.25, pl: {sm: 2}, alignItems: {sm: 'center'}, justifyContent: 'space-between'}}>
                                            <Box sx={{minWidth: 0}}>
                                                <Typography variant="body2" sx={{fontWeight: 500, overflowWrap: 'anywhere'}}>
                                                    {radio.label || radio['remote:driver'] || radio.driver || t('sdr.sdr_device')}
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary" sx={{overflowWrap: 'anywhere'}}>
                                                    {radio['remote:driver'] || radio.driver}
                                                    {radio.serial ? ` · ${radio.serial}` : ''}
                                                </Typography>
                                            </Box>
                                            <Box sx={{flexShrink: 0}}>
                                                {isConfigured(sdrs, server, radio) ? (
                                                    <Chip size="small" color="success" variant="outlined" label={t('sdr.configured')}/>
                                                ) : (
                                                    <Button size="small" startIcon={<AddIcon/>}
                                                            aria-label={t('sdr.add_named', {name: radio.label || radio['remote:driver'] || radio.driver || t('sdr.sdr_device')})}
                                                            disabled={disabled || discovering}
                                                            onClick={() => onAddDevice(server, radio, index)}>
                                                        {t('sdr.add_sdr')}
                                                    </Button>
                                                )}
                                            </Box>
                                        </Stack>
                                    ))}
                                </Stack>
                            ) : (
                                <Typography variant="body2" color="text.secondary" sx={{py: 1}}>
                                    {t(server.status && server.status !== 'active'
                                        ? 'sdr.server_devices_unavailable' : 'sdr.no_remote_sdr_devices')}
                                </Typography>
                            )}
                        </AccordionDetails>
                    </Accordion>
                );
            }) : (
                <Box sx={{mx: 2.5, mb: 2.5, p: 3, border: '1px dashed', borderColor: 'divider', borderRadius: 1.5, textAlign: 'center'}}>
                    <DnsOutlinedIcon sx={{color: 'text.disabled', mb: 0.75}}/>
                    <Typography variant="body2" sx={{fontWeight: 500}}>
                        {t(discovering ? 'sdr.network_scan_searching' : scanned ? 'sdr.no_servers_found' : 'sdr.find_remote_servers')}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        {t('sdr.manual_server_hint')}
                    </Typography>
                </Box>
            )}

            {task && (
                <Accordion disableGutters elevation={0}
                           sx={{borderTop: '1px solid', borderColor: 'divider', '&:before': {display: 'none'}}}>
                    <AccordionSummary expandIcon={<ExpandMoreIcon/>} sx={{px: 2.5, minHeight: 40}}>
                        <Typography variant="caption" color="text.secondary">{t('sdr.scan_details')}</Typography>
                    </AccordionSummary>
                    <AccordionDetails sx={{px: 2.5, pt: 0}}>
                        <Typography variant="caption" color="text.secondary" component="div" sx={{mb: 1}}>
                            {t('sdr.scan_task_summary', {status: t(`sdr.scan_status_${task.status}`), duration: elapsed || '—'})}
                        </Typography>
                        <Box component="pre" sx={{m: 0, maxHeight: 160, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: '0.75rem', color: 'text.secondary'}}>
                            {(task.output_lines || []).map((line) => line.output).join('\n') || t('sdr.no_scan_output')}
                        </Box>
                    </AccordionDetails>
                </Accordion>
            )}
        </Paper>
    );
}
