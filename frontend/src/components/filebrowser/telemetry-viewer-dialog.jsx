/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import React, { useState, useEffect } from 'react';
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
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import OverviewTab from './telemetry-overview-tab';
import HexAsciiTab from './telemetry-hex-ascii-tab';
import Float32Tab from './telemetry-float32-tab';
import IntegersTab from './telemetry-integers-tab';
import StringsTab from './telemetry-strings-tab';
import AnalysisTab from './telemetry-analysis-tab';
import TelemetryValuesTab from './telemetry-values-tab';

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

export default function TelemetryViewerDialog({ open, onClose, file, metadata }) {
    const [activeTab, setActiveTab] = useState(0);

    // Reset tab when dialog opens
    useEffect(() => {
        if (open) {
            setActiveTab(0);
        }
    }, [open]);

    const handleTabChange = (event, newValue) => {
        setActiveTab(newValue);
    };

    if (!file || !metadata) {
        return null;
    }

    const telemetry = metadata.telemetry || {};
    const packet = metadata.packet || {};
    const ax25 = metadata.ax25 || {};

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
                        Telemetry Packet Viewer
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
                    <Tab label="Overview" id="telemetry-tab-0" />
                    <Tab label="Telemetry" id="telemetry-tab-6" />
                    <Tab label="Hex + ASCII" id="telemetry-tab-1" />
                    <Tab label="As Float32" id="telemetry-tab-2" />
                    <Tab label="As Integers" id="telemetry-tab-3" />
                    <Tab label="As Strings" id="telemetry-tab-4" />
                    <Tab label="Analysis" id="telemetry-tab-5" />
                </Tabs>
            </Box>

            <DialogContent
                sx={{
                    p: 0,
                    bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.36)' : 'grey.100'),
                }}
            >
                <TabPanel value={activeTab} index={0}>
                    <Box sx={{ px: 3, pb: 2 }}>
                        <OverviewTab
                            metadata={metadata}
                            file={file}
                            telemetry={telemetry}
                            packet={packet}
                            ax25={ax25}
                        />
                    </Box>
                </TabPanel>

                <TabPanel value={activeTab} index={1}>
                    <Box sx={{ px: 3, pb: 2 }}>
                        <TelemetryValuesTab telemetry={telemetry} />
                    </Box>
                </TabPanel>

                <TabPanel value={activeTab} index={2}>
                    <Box sx={{ px: 3, pb: 2 }}>
                        <HexAsciiTab
                            packet={packet}
                            telemetry={telemetry}
                        />
                    </Box>
                </TabPanel>

                <TabPanel value={activeTab} index={3}>
                    <Box sx={{ px: 3, pb: 2 }}>
                        <Float32Tab
                            packet={packet}
                            telemetry={telemetry}
                        />
                    </Box>
                </TabPanel>

                <TabPanel value={activeTab} index={4}>
                    <Box sx={{ px: 3, pb: 2 }}>
                        <IntegersTab
                            packet={packet}
                            telemetry={telemetry}
                        />
                    </Box>
                </TabPanel>

                <TabPanel value={activeTab} index={5}>
                    <Box sx={{ px: 3, pb: 2 }}>
                        <StringsTab
                            packet={packet}
                            telemetry={telemetry}
                        />
                    </Box>
                </TabPanel>

                <TabPanel value={activeTab} index={6}>
                    <Box sx={{ px: 3, pb: 2 }}>
                        <AnalysisTab
                            packet={packet}
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
                <Button
                    startIcon={<DownloadIcon />}
                    href={file.url}
                    download={file.filename}
                    component="a"
                    variant="outlined"
                >
                    Download Binary
                </Button>
                <Button
                    startIcon={<DownloadIcon />}
                    href={file.url.replace('.bin', '.json')}
                    download={file.filename?.replace('.bin', '.json')}
                    component="a"
                    variant="outlined"
                >
                    Download Metadata
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
                    Close
                </Button>
            </DialogActions>
        </Dialog>
    );
}
