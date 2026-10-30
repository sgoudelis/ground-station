/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
    Tabs,
    Tab,
    Typography,
    Alert,
    CircularProgress,
    ToggleButton,
    ToggleButtonGroup,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import OverviewTab from './telemetry-overview-tab';
import HexAsciiTab from './telemetry-hex-ascii-tab';
import Float32Tab from './telemetry-float32-tab';
import IntegersTab from './telemetry-integers-tab';
import StringsTab from './telemetry-strings-tab';
import AnalysisTab from './telemetry-analysis-tab';
import TelemetryValuesTab from './telemetry-values-tab';
import APRSTab from './telemetry-aprs-tab.jsx';
import { useTranslation } from 'react-i18next';

function TabPanel({ children, value, index, ...other }) {
    return (
        <div
            role="tabpanel"
            hidden={value !== index}
            id={`telemetry-tabpanel-${index}`}
            aria-labelledby={`telemetry-tab-${index}`}
            {...other}
        >
            {value === index && (
                <Box sx={{ pt: 2 }}>
                    {children}
                </Box>
            )}
        </div>
    );
}

export default function TelemetryViewerDialog({ open, onClose, file, metadata, socket, onMetadataChange }) {
    const { t } = useTranslation('filebrowser');
    const [activeTab, setActiveTab] = useState(0);
    const [byteSource, setByteSource] = useState('packet');
    const [reparsing, setReparsing] = useState(false);
    const [reparseError, setReparseError] = useState(null);
    const [preview, setPreview] = useState(null);
    const reparseSequence = useRef(0);

    // Unsupported captures may gain a parser without changing the metadata schema.
    // Every entry point shares this read-only request; saved files stay untouched.
    const needsPreview = metadata?.telemetry?.schema_version !== 1
        || metadata.telemetry.payload_status === 'unsupported';

    useEffect(() => {
        if (!open || !needsPreview || !file?.url?.endsWith('.bin') || !socket?.connected) {
            setPreview(null);
            return;
        }
        let cancelled = false;
        const source = metadata;
        const url = file.url;
        setPreview({source, url, loading: true});
        // Normalize saved results and try the current parser for unsupported
        // captures. Saving always remains an explicit Reparse action.
        socket.timeout(30000).emit('api.call', {
            cmd: 'filebrowser.view-telemetry', data: {url},
        }, (error, result) => {
            if (cancelled) return;
            if (error || !result?.success || !result.data?.telemetry) {
                setPreview({source, url, failed: true, error: result?.error});
                return;
            }
            setPreview({source, url, data: result.data});
        });
        // Switching packets, closing, or saving new metadata invalidates any
        // pending preview, so a late reply cannot replace the current packet.
        return () => { cancelled = true; };
    }, [open, needsPreview, file?.url, metadata, socket, socket?.connected]);

    const activePreview = preview?.source === metadata && preview?.url === file?.url ? preview : null;
    const displayedMetadata = activePreview?.data || metadata;

    useEffect(() => {
        // Ignore replies belonging to a previously opened packet.
        reparseSequence.current += 1;
        setReparsing(false);
        setReparseError(null);
        return () => { reparseSequence.current += 1; };
    }, [open, file?.url]);

    const handleReparse = () => {
        const sequence = ++reparseSequence.current;
        setReparsing(true);
        setReparseError(null);
        socket.timeout(30000).emit('api.call', {
            cmd: 'filebrowser.reparse-telemetry', data: { url: file.url },
        }, (error, result) => {
            if (sequence !== reparseSequence.current) return;
            setReparsing(false);
            if (error || !result?.success) {
                setReparseError(result?.error || t('telemetry_viewer_dialog.reparse_failed', { defaultValue: 'Could not reparse this packet.' }));
                return;
            }
            onMetadataChange(result.data);
        });
    };

    // Reset tab when dialog opens
    useEffect(() => {
        if (open) {
            setActiveTab(0);
            setByteSource('packet');
        }
    }, [open, file?.url]);

    const handleTabChange = (event, newValue) => {
        setActiveTab(newValue);
    };

    if (!file || !metadata) {
        return null;
    }

    const telemetry = displayedMetadata.telemetry || {};
    const packet = displayedMetadata.packet || {};
    const ax25 = displayedMetadata.ax25 || {};
    const isAprs = telemetry.schema_version === 1 && telemetry.payload?.kind === 'aprs';
    const inspectionPacket = {...packet, hex: byteSource === 'payload'
        ? telemetry.raw?.payload_hex || '' : packet.hex || telemetry.raw?.packet_hex || ''};

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="lg"
            fullWidth
            PaperProps={{
                sx: {
                    bgcolor: 'background.paper',
                    border: (theme) => `1px solid ${theme.palette.divider}`,
                    borderRadius: 2,
                    minHeight: '80vh',
                    maxHeight: '90vh',
                }
            }}
        >
            <DialogTitle sx={{
                bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100'),
                borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                py: 2.5,
                px: 3,
            }}>
                <Box>
                    <Typography variant="h6">
                        {t('telemetry_viewer_dialog.telemetry_packet_viewer', { defaultValue: 'Telemetry Packet Viewer' })}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        {file.filename || file.name}
                    </Typography>
                </Box>
            </DialogTitle>

            <Box sx={{
                borderBottom: 1,
                borderColor: 'divider',
                backgroundColor: 'background.paper',
            }}>
                <Tabs
                    value={activeTab}
                    onChange={handleTabChange}
                    variant="scrollable"
                    scrollButtons="auto"
                    sx={{ px: 2 }}
                >
                    <Tab label={t('telemetry_viewer_dialog.overview', { defaultValue: 'Overview' })} id="telemetry-tab-0" aria-controls="telemetry-tabpanel-0" />
                    <Tab label={isAprs ? 'APRS' : 'Telemetry'} id="telemetry-tab-1" aria-controls="telemetry-tabpanel-1" />
                    <Tab label={t('telemetry_viewer_dialog.hex_ascii', { defaultValue: 'Hex + ASCII' })} id="telemetry-tab-2" aria-controls="telemetry-tabpanel-2" />
                    <Tab label={t('telemetry_viewer_dialog.as_float32', { defaultValue: 'As Float32' })} id="telemetry-tab-3" aria-controls="telemetry-tabpanel-3" />
                    <Tab label={t('telemetry_viewer_dialog.as_integers', { defaultValue: 'As Integers' })} id="telemetry-tab-4" aria-controls="telemetry-tabpanel-4" />
                    <Tab label={t('telemetry_viewer_dialog.as_strings', { defaultValue: 'As Strings' })} id="telemetry-tab-5" aria-controls="telemetry-tabpanel-5" />
                    <Tab label={t('telemetry_viewer_dialog.analysis', { defaultValue: 'Analysis' })} id="telemetry-tab-6" aria-controls="telemetry-tabpanel-6" />
                </Tabs>
            </Box>

            <DialogContent
                sx={{
                    p: 0,
                    bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.36)' : 'grey.100'),
                }}
            >
                {reparseError && <Alert severity="error" sx={{ m: 3 }}>{reparseError}</Alert>}
                {activeTab >= 2 && <Box sx={{px: 3, pt: 2}}>
                    <ToggleButtonGroup size="small" exclusive value={byteSource}
                        aria-label="Bytes to inspect" onChange={(_, value) => value && setByteSource(value)}>
                        <ToggleButton value="packet">{t('telemetry_viewer_dialog.packet_bytes', {defaultValue: 'Complete packet'})}</ToggleButton>
                        <ToggleButton value="payload" disabled={!telemetry.raw?.payload_hex}>
                            {t('telemetry_viewer_dialog.payload_bytes', {defaultValue: 'Payload only'})}
                        </ToggleButton>
                    </ToggleButtonGroup>
                </Box>}

                <TabPanel value={activeTab} index={0}>
                    <Box sx={{ px: 3, pb: 2 }}>
                        <OverviewTab
                            metadata={displayedMetadata}
                            file={file}
                            telemetry={telemetry}
                            packet={packet}
                            ax25={ax25}
                        />
                    </Box>
                </TabPanel>

                <TabPanel value={activeTab} index={1}>
                    <Box sx={{ px: 3, pb: 2 }}>
                        {activePreview?.loading ? (
                            <Box role="status" sx={{display: 'flex', alignItems: 'center', gap: 1}}>
                                <CircularProgress size={20} />
                                {t('telemetry_viewer_dialog.preview_loading', {defaultValue: 'Preparing saved telemetry…'})}
                            </Box>
                        ) : isAprs ? (
                            <APRSTab metadata={displayedMetadata} />
                        ) : (
                            <>
                                {activePreview?.failed && <Alert severity="warning" sx={{mb: 2}}>
                                    {activePreview.error || t('telemetry_viewer_dialog.preview_failed', {
                                        defaultValue: 'Could not prepare this saved telemetry. Try Reparse telemetry.',
                                    })}
                                </Alert>}
                                <TelemetryValuesTab telemetry={telemetry} satellite={displayedMetadata.satellite?.name}
                                    captureTime={packet.timestamp ?? displayedMetadata.timestamp} />
                            </>
                        )}
                    </Box>
                </TabPanel>

                <TabPanel value={activeTab} index={2}>
                    <Box sx={{ px: 3, pb: 2 }}>
                        <HexAsciiTab
                            packet={inspectionPacket}
                            telemetry={telemetry}
                        />
                    </Box>
                </TabPanel>

                <TabPanel value={activeTab} index={3}>
                    <Box sx={{ px: 3, pb: 2 }}>
                        <Float32Tab
                            packet={inspectionPacket}
                            telemetry={telemetry}
                        />
                    </Box>
                </TabPanel>

                <TabPanel value={activeTab} index={4}>
                    <Box sx={{ px: 3, pb: 2 }}>
                        <IntegersTab
                            packet={inspectionPacket}
                            telemetry={telemetry}
                        />
                    </Box>
                </TabPanel>

                <TabPanel value={activeTab} index={5}>
                    <Box sx={{ px: 3, pb: 2 }}>
                        <StringsTab
                            packet={inspectionPacket}
                            telemetry={telemetry}
                        />
                    </Box>
                </TabPanel>

                <TabPanel value={activeTab} index={6}>
                    <Box sx={{ px: 3, pb: 2 }}>
                        <AnalysisTab
                            packet={inspectionPacket}
                            telemetry={telemetry}
                        />
                    </Box>
                </TabPanel>
            </DialogContent>

            <DialogActions
                disableSpacing
                sx={{
                    bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100'),
                    borderTop: (theme) => `1px solid ${theme.palette.divider}`,
                    px: 3,
                    py: 2.5,
                    gap: 1,
                    flexDirection: { xs: 'column', sm: 'row' },
                    alignItems: { xs: 'stretch', sm: 'center' },
                    justifyContent: { xs: 'stretch', sm: 'flex-end' },
                    '& .MuiButton-root': {
                        width: { xs: '100%', sm: 'auto' },
                    },
                }}
            >
                {onMetadataChange && file.url.endsWith('.bin') && (
                    <Button startIcon={<RefreshIcon />} onClick={handleReparse}
                        disabled={reparsing || activePreview?.loading || !socket?.connected} variant="outlined">
                        {reparsing
                            ? t('telemetry_viewer_dialog.reparsing', { defaultValue: 'Reparsing…' })
                            : t('telemetry_viewer_dialog.reparse', { defaultValue: 'Reparse telemetry' })}
                    </Button>
                )}
                <Button
                    startIcon={<DownloadIcon />}
                    href={file.url}
                    download={file.filename}
                    component="a"
                    variant="outlined"
                >
                    {t('telemetry_viewer_dialog.download_binary', { defaultValue: 'Download Binary' })}
                </Button>
                <Button
                    startIcon={<DownloadIcon />}
                    href={file.url.replace('.bin', '.json')}
                    download={file.filename?.replace('.bin', '.json')}
                    component="a"
                    variant="outlined"
                >
                    {t('telemetry_viewer_dialog.download_metadata', { defaultValue: 'Download Metadata' })}
                </Button>
                <Button
                    onClick={onClose}
                    variant="outlined"
                    sx={{
                        borderColor: (theme) => (theme.palette.mode === 'dark' ? 'grey.700' : 'grey.400'),
                        '&:hover': {
                            borderColor: (theme) => (theme.palette.mode === 'dark' ? 'grey.600' : 'grey.500'),
                            bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.800' : 'grey.200'),
                        },
                    }}
                >
                    {t('telemetry_viewer_dialog.close', { defaultValue: 'Close' })}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
