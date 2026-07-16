/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 *
 */

import React, { useState, useEffect } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
    Typography,
    Tabs,
    Tab,
    Grid,
    Card,
    CardMedia,
    CardContent,
    Chip,
    Paper,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableRow,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import ImageIcon from '@mui/icons-material/Image';
import FolderIcon from '@mui/icons-material/Folder';
import ZoomableImage from '../common/zoomable-image.jsx';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { formatDateTime } from '../../utils/date-time.js';

function TabPanel({ children, value, index }) {
    return (
        <div hidden={value !== index}>
            {value === index && <Box sx={{ pt: 2 }}>{children}</Box>}
        </div>
    );
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

function getImageTitle(filename) {
    const baseName = filename.replace(/\.png$/i, '');
    const rawChannelMatch = baseName.match(/^MSU-MR-(\d)$/);
    if (rawChannelMatch) {
        return `Raw Channel ${rawChannelMatch[1]}`;
    }

    const isCorrected = baseName.includes('_corrected');
    const isMap = baseName.includes('_map');
    let label = baseName.replace(/_corrected/g, '').replace(/_map/g, '');

    if (label.includes('3.9_um')) {
        label = 'Shortwave IR 3.9um';
    } else if (label.startsWith('msu_mr_rgb_')) {
        label = label.replace(/^msu_mr_rgb_/, '').replace(/_/g, ' ');
        if (!/false color/i.test(label)) {
            label = `${label} Composite`;
        }
    } else {
        label = label.replace(/_/g, ' ');
    }

    const suffixParts = [];
    if (isCorrected) suffixParts.push('Corrected');
    if (isMap) suffixParts.push('Map');

    return suffixParts.length > 0 ? `${label} (${suffixParts.join(' ')})` : label;
}

export default function MeteorM2xLrptFolderDialog({ open, onClose, folder }) {
    const { timezone, locale } = useUserTimeSettings();
    const [activeTab, setActiveTab] = useState(0);
    const [selectedImage, setSelectedImage] = useState(null);

    // Reset activeTab when folder changes or dialog opens
    useEffect(() => {
        if (open) {
            setActiveTab(0);
            setSelectedImage(null);
        }
    }, [open, folder?.foldername]);

    if (!folder) return null;

    // Categorize images by type
    const rawChannels = folder.images?.filter(img => /MSU-MR-\d\.png$/.test(img.filename)) || [];
    const rgbComposites = folder.images?.filter(img =>
        img.filename.includes('rgb_') &&
        !img.filename.includes('_map') &&
        !img.filename.includes('_corrected')
    ) || [];
    const irImages = folder.images?.filter(img => img.filename.includes('3.9_um')) || [];
    const mapProjections = folder.images?.filter(img => img.filename.endsWith('_map.png')) || [];
    const corrected = folder.images?.filter(img =>
        img.filename.includes('_corrected') &&
        !img.filename.includes('_map')
    ) || [];

    const categories = [
        { label: 'RGB Composites', images: rgbComposites },
        { label: 'Map Projections', images: mapProjections },
        { label: 'Corrected', images: corrected },
        { label: 'IR Images', images: irImages },
        { label: 'Raw Channels', images: rawChannels },
        { label: 'All Images', images: folder.images || [] },
        { label: 'Metadata', images: null, isMetadata: true },
    ].filter(cat => cat.isMetadata || (cat.images && cat.images.length > 0));

    const handleDownloadFolder = () => {
        const downloadUrl = `/api/decoded/${encodeURIComponent(folder.foldername)}/download`;
        window.open(downloadUrl, '_blank');
    };

    return (
        <>
            <Dialog
                open={open}
                onClose={onClose}
                maxWidth="xl"
                fullWidth
                PaperProps={{
                    sx: {
                        bgcolor: 'background.paper',
                        border: (theme) => `1px solid ${theme.palette.divider}`,
                        borderRadius: 2,
                        height: '90vh',
                        maxHeight: '90vh',
                    }
                }}
            >
                <DialogTitle
                    sx={{
                        bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100'),
                        borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                        py: 2.5,
                        px: 3,
                    }}
                >
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <SatelliteAltIcon color="primary" />
                                <Typography variant="h6">
                                    {folder.satellite_name || 'METEOR Satellite'}
                                </Typography>
                            </Box>
                            <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
                                {folder.foldername}
                            </Typography>
                        </Box>
                        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                            <Chip
                                label={`${folder.image_count} images`}
                                icon={<ImageIcon />}
                                color="success"
                                size="small"
                            />
                            {folder.pipeline && (
                                <Chip
                                    label={folder.pipeline.toUpperCase()}
                                    color="info"
                                    size="small"
                                />
                            )}
                            <Chip
                                label={formatBytes(folder.size)}
                                size="small"
                                variant="outlined"
                            />
                        </Box>
                    </Box>
                </DialogTitle>

                {categories.length > 0 && (
                    <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 2 }}>
                        <Tabs
                            value={activeTab}
                            onChange={(e, v) => setActiveTab(v)}
                            variant="scrollable"
                            scrollButtons="auto"
                        >
                            {categories.map((cat, idx) => (
                                <Tab key={idx} label={cat.isMetadata ? cat.label : `${cat.label} (${cat.images.length})`} />
                            ))}
                        </Tabs>
                    </Box>
                )}

                <DialogContent
                    sx={{
                        bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.36)' : 'grey.100'),
                        overflow: 'auto',
                        flex: 1,
                        px: 3,
                        py: 3,
                    }}
                >
                    {categories.length === 0 ? (
                        <Box sx={{ textAlign: 'center', py: 8 }}>
                            <FolderIcon sx={{ fontSize: 80, color: 'text.disabled', mb: 2 }} />
                            <Typography variant="h6" color="text.secondary">
                                No images found in this folder
                            </Typography>
                        </Box>
                    ) : (
                        categories.map((category, catIdx) => (
                            <TabPanel key={catIdx} value={activeTab} index={catIdx}>
                                {category.isMetadata ? (
                                    <Box sx={{ px: 2 }}>
                                        {/* Dataset Information */}
                                        <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <SatelliteAltIcon color="primary" />
                                            Dataset Information
                                        </Typography>
                                        <TableContainer component={Paper} sx={{ mb: 3 }}>
                                            <Table size="small">
                                                <TableBody>
                                                    <TableRow>
                                                        <TableCell sx={{ fontWeight: 600 }}>Satellite</TableCell>
                                                        <TableCell>{folder.metadata?.satellite || folder.satellite_name || 'Unknown'}</TableCell>
                                                    </TableRow>
                                                    <TableRow>
                                                        <TableCell sx={{ fontWeight: 600 }}>Timestamp</TableCell>
                                                        <TableCell>
                                                            {folder.metadata?.timestamp
                                                                ? formatDateTime(folder.metadata.timestamp * 1000, { timezone, locale })
                                                                : folder.timestamp || 'N/A'}
                                                        </TableCell>
                                                    </TableRow>
                                                    <TableRow>
                                                        <TableCell sx={{ fontWeight: 600 }}>Products</TableCell>
                                                        <TableCell>{folder.products?.join(', ') || 'N/A'}</TableCell>
                                                    </TableRow>
                                                    <TableRow>
                                                        <TableCell sx={{ fontWeight: 600 }}>Pipeline</TableCell>
                                                        <TableCell>{folder.pipeline || 'N/A'}</TableCell>
                                                    </TableRow>
                                                    <TableRow>
                                                        <TableCell sx={{ fontWeight: 600 }}>Total Images</TableCell>
                                                        <TableCell>{folder.image_count}</TableCell>
                                                    </TableRow>
                                                    <TableRow>
                                                        <TableCell sx={{ fontWeight: 600 }}>Total Size</TableCell>
                                                        <TableCell>{formatBytes(folder.size)}</TableCell>
                                                    </TableRow>
                                                    <TableRow>
                                                        <TableCell sx={{ fontWeight: 600 }}>CADU Data</TableCell>
                                                        <TableCell>{folder.has_cadu ? 'Yes' : 'No'}</TableCell>
                                                    </TableRow>
                                                    <TableRow>
                                                        <TableCell sx={{ fontWeight: 600 }}>Created</TableCell>
                                                        <TableCell>{formatDateTime(folder.created, { timezone, locale })}</TableCell>
                                                    </TableRow>
                                                </TableBody>
                                            </Table>
                                        </TableContainer>

                                        {/* Telemetry Section */}
                                        {folder.telemetry && (
                                            <>
                                                <Typography variant="h6" sx={{ mb: 2, mt: 3, display: 'flex', alignItems: 'center', gap: 1 }}>
                                                    <ImageIcon color="success" />
                                                    Telemetry Data
                                                </Typography>
                                                <TableContainer component={Paper}>
                                                    <Table size="small">
                                                        <TableBody>
                                                            {folder.telemetry.msu_mr_id !== undefined && (
                                                                <TableRow>
                                                                    <TableCell sx={{ fontWeight: 600 }}>MSU-MR ID</TableCell>
                                                                    <TableCell>{folder.telemetry.msu_mr_id}</TableCell>
                                                                </TableRow>
                                                            )}
                                                            {folder.telemetry.msu_mr_set && (
                                                                <TableRow>
                                                                    <TableCell sx={{ fontWeight: 600 }}>MSU-MR Set</TableCell>
                                                                    <TableCell>{folder.telemetry.msu_mr_set}</TableCell>
                                                                </TableRow>
                                                            )}
                                                            {folder.telemetry.digital_tlm && Object.entries(folder.telemetry.digital_tlm).map(([key, value]) => (
                                                                <TableRow key={key}>
                                                                    <TableCell sx={{ fontWeight: 600, textTransform: 'capitalize' }}>
                                                                        {key.replace(/_/g, ' ')}
                                                                    </TableCell>
                                                                    <TableCell>{String(value)}</TableCell>
                                                                </TableRow>
                                                            ))}
                                                        </TableBody>
                                                    </Table>
                                                </TableContainer>
                                            </>
                                        )}
                                    </Box>
                                ) : (
                                    <Grid container spacing={2}>
                                        {category.images.map((image, imgIdx) => {
                                            const title = getImageTitle(image.filename);

                                            return (
                                                <Grid item xs={12} sm={6} md={4} lg={3} key={imgIdx}>
                                                    <Card
                                                        sx={{
                                                            cursor: 'pointer',
                                                            '&:hover': { boxShadow: 4 },
                                                            height: '100%',
                                                            display: 'flex',
                                                            flexDirection: 'column',
                                                        }}
                                                        onClick={() => setSelectedImage(image)}
                                                    >
                                                        <CardMedia
                                                            component="img"
                                                            height="200"
                                                            image={image.url}
                                                            alt={image.filename}
                                                            sx={{ objectFit: 'cover' }}
                                                        />
                                                        <CardContent sx={{ pb: 1, flexGrow: 1 }}>
                                                            <Typography
                                                                variant="subtitle2"
                                                                noWrap
                                                                title={title}
                                                            >
                                                                {title}
                                                            </Typography>
                                                            <Typography
                                                                variant="body2"
                                                                noWrap
                                                                title={image.filename}
                                                                sx={{ fontFamily: 'monospace', fontSize: '0.75rem' }}
                                                            >
                                                                {image.filename}
                                                            </Typography>
                                                            <Box sx={{ display: 'flex', gap: 0.5, mt: 1, flexWrap: 'wrap' }}>
                                                                {image.width && image.height && (
                                                                    <Chip
                                                                        label={`${image.width}×${image.height}`}
                                                                        size="small"
                                                                        variant="outlined"
                                                                        sx={{ height: '18px', fontSize: '0.65rem' }}
                                                                    />
                                                                )}
                                                                <Chip
                                                                    label={formatBytes(image.size)}
                                                                    size="small"
                                                                    variant="outlined"
                                                                    sx={{ height: '18px', fontSize: '0.65rem' }}
                                                                />
                                                            </Box>
                                                        </CardContent>
                                                    </Card>
                                                </Grid>
                                            );
                                        })}
                                    </Grid>
                                )}
                            </TabPanel>
                        ))
                    )}
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
                    {folder.images && folder.images.length > 0 && (
                        <Button onClick={handleDownloadFolder} startIcon={<DownloadIcon />} variant="outlined">
                            DOWNLOAD ZIP ({folder.image_count})
                        </Button>
                    )}
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

            {/* Full-size image preview dialog */}
            {selectedImage && (
                <Dialog
                    open={!!selectedImage}
                    onClose={() => setSelectedImage(null)}
                    maxWidth="lg"
                    fullWidth
                    PaperProps={{
                        sx: {
                            bgcolor: 'background.paper',
                            border: (theme) => `1px solid ${theme.palette.divider}`,
                            borderRadius: 2,
                        },
                    }}
                >
                    <DialogTitle
                        sx={{
                            bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100'),
                            borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
                            py: 2.5,
                            px: 3,
                        }}
                    >
                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <Typography variant="h6" sx={{ fontFamily: 'monospace', fontSize: '0.9rem' }}>
                                {selectedImage.filename}
                            </Typography>
                            <Box sx={{ display: 'flex', gap: 1 }}>
                                {selectedImage.width && selectedImage.height && (
                                    <Chip
                                        label={`${selectedImage.width}×${selectedImage.height}`}
                                        size="small"
                                        variant="outlined"
                                    />
                                )}
                                <Chip
                                    label={formatBytes(selectedImage.size)}
                                    size="small"
                                    variant="outlined"
                                />
                            </Box>
                        </Box>
                    </DialogTitle>
                    <DialogContent
                        sx={{
                            textAlign: 'center',
                            overflow: 'hidden',
                            backgroundColor: 'black',
                            p: 0,
                            minHeight: 400,
                            height: '70vh',
                        }}
                    >
                        <ZoomableImage
                            src={selectedImage.url}
                            alt={selectedImage.filename}
                            resetKey={`${selectedImage.filename}-${selectedImage.url}`}
                            maxZoom={6}
                            constrainPan={false}
                            showHint={false}
                            showZoomBadge={false}
                            containerSx={{
                                width: '100%',
                                height: '100%',
                                border: 'none',
                                borderRadius: 0,
                                bgcolor: 'transparent',
                            }}
                        />
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
                            onClick={() => window.open(selectedImage.url, '_blank')}
                            startIcon={<DownloadIcon />}
                            variant="outlined"
                        >
                            Download
                        </Button>
                        <Button
                            onClick={() => setSelectedImage(null)}
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
            )}
        </>
    );
}
