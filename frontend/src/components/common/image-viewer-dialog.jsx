/**
 * @license
 * Copyright (c) 2026 Efstratios Goudelis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import React, { useId } from 'react';
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { useTranslation } from 'react-i18next';
import ZoomableImage from './zoomable-image.jsx';
import { formatDateTime } from '../../utils/date-time.js';

// Observation artifacts, standalone files and live decoder output all use
// this viewer so sizing and image interactions stay consistent.
export default function ImageViewerDialog({
    open,
    onClose,
    src,
    title,
    metadata,
    imageWidth,
    imageHeight,
    sizeLabel,
    details = [],
    onDownload,
    timezone = 'UTC',
    locale,
}) {
    const { t } = useTranslation('filebrowser');
    const titleId = useId();
    const width = imageWidth || metadata?.image?.width;
    const height = imageHeight || metadata?.image?.height;
    // SSTV filenames identify decoder images even when their metadata is missing.
    const isSstv = metadata?.decoder?.type?.toLowerCase() === 'sstv' || /^sstv_/i.test(title || '');
    const rows = [
        { label: t('filebrowser_main.decoder_type', { defaultValue: 'Decoder Type' }), value: metadata?.decoder?.type?.toUpperCase() },
        { label: t('filebrowser_main.sstv_mode', { defaultValue: 'SSTV Mode' }), value: metadata?.decoder?.mode },
        {
            label: t('filebrowser_main.tuned_frequency', { defaultValue: 'Tuned frequency' }),
            value: metadata?.signal?.frequency_mhz != null ? `${Number(metadata.signal.frequency_mhz).toFixed(6)} MHz` : null,
        },
        {
            label: t('filebrowser_main.audio_sample_rate', { defaultValue: 'Audio sample rate' }),
            value: metadata?.signal?.sample_rate_hz != null ? `${metadata.signal.sample_rate_hz} Hz` : null,
        },
        {
            label: t('filebrowser_main.vfo_bandwidth', { defaultValue: 'VFO Bandwidth' }),
            value: metadata?.vfo?.bandwidth_khz != null ? `${Number(metadata.vfo.bandwidth_khz).toFixed(1)} kHz` : null,
        },
        {
            label: t('filebrowser_main.decoded', { defaultValue: 'Decoded' }),
            // Match Created/Modified using the user's locale and timezone.
            value: formatDateTime(metadata?.image?.timestamp_iso
                || (metadata?.image?.timestamp != null ? metadata.image.timestamp * 1000 : null), { timezone, locale }),
        },
        ...details,
    ].filter(({ value }) => value !== null && value !== undefined && value !== '');
    const downlinkHz = metadata?.transmitter?.center_frequency ?? metadata?.transmitter?.downlink_low;
    const sourceRows = [
        { label: t('filebrowser_main.satellite', { defaultValue: 'Satellite' }), value: metadata?.satellite?.name },
        { label: t('filebrowser_main.norad_id', { defaultValue: 'NORAD ID' }), value: metadata?.satellite?.norad_id },
        { label: t('filebrowser_main.transmitter', { defaultValue: 'Transmitter' }), value: metadata?.transmitter?.description },
        {
            label: t('filebrowser_main.nominal_downlink', { defaultValue: 'Nominal downlink' }),
            value: downlinkHz != null ? `${(Number(downlinkHz) / 1e6).toFixed(6)} MHz` : null,
        },
        { label: t('filebrowser_main.vfo', { defaultValue: 'VFO' }), value: metadata?.vfo?.id },
    ].filter(({ value }) => value !== null && value !== undefined && value !== '');
    const columns = [rows, sourceRows].filter((column) => column.length > 0);

    return (
        <Dialog
            open={open}
            onClose={onClose}
            aria-labelledby={titleId}
            maxWidth={false}
            slotProps={{
                paper: {
                    sx: {
                        bgcolor: 'background.paper',
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 2,
                        width: '1152px',
                        maxWidth: '96vw',
                        my: 1,
                        height: '90dvh',
                        maxHeight: 'calc(100dvh - 16px)',
                    },
                },
            }}
        >
            <DialogTitle id={titleId} sx={{ borderBottom: '1px solid', borderColor: 'divider', px: 3, py: 2 }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
                    <Typography component="span" variant="h6" sx={{ overflowWrap: 'anywhere' }}>{title}</Typography>
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {metadata?.decoder?.mode && <Chip label={metadata.decoder.mode} size="small" color="success" />}
                        {width && height && <Chip label={`${width}×${height}`} size="small" />}
                        {sizeLabel && <Chip label={sizeLabel} size="small" />}
                    </Box>
                </Box>
            </DialogTitle>
            <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 3, '&.MuiDialogContent-root': { pt: 3 } }}>
                {/* Let the image use spare vertical space; short screens scroll
                    the content while the title and close button remain visible. */}
                <ZoomableImage
                    src={src}
                    alt={title}
                    resetKey={`${open}-${src}`}
                    initialFit={isSstv ? 'original' : 'contain'}
                    showFitControls
                    minZoom={0.1}
                    containerSx={{ flex: { xs: '1 0 200px', sm: '1 0 300px' }, minHeight: 0, p: 2 }}
                />
                {columns.length > 0 && (
                    <Box sx={{ flexShrink: 0 }}>
                        <Typography variant="subtitle2" gutterBottom>
                            {metadata
                                ? t('filebrowser_main.metadata', { defaultValue: 'Metadata' })
                                : t('filebrowser_main.details', { defaultValue: 'Details' })}
                        </Typography>
                        {/* Keep source details alongside reception details on wide screens. */}
                        <Box sx={{ p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, display: 'grid', gridTemplateColumns: { xs: '1fr', md: `repeat(${columns.length}, minmax(0, 1fr))` }, gap: { xs: 1, md: 4 } }}>
                            {columns.map((column, index) => (
                                <Box key={index}>
                                    {column.map(({ label, value }) => (
                                        <Box key={label} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '160px minmax(0, 1fr)' }, gap: { xs: 0.5, sm: 2 }, py: 0.5 }}>
                                            <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase' }}>{label}</Typography>
                                            <Typography variant="body2" sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{value}</Typography>
                                        </Box>
                                    ))}
                                </Box>
                            ))}
                        </Box>
                    </Box>
                )}
            </DialogContent>
            <DialogActions sx={{ borderTop: '1px solid', borderColor: 'divider', px: 3, py: 2 }}>
                {onDownload && (
                    <Button onClick={onDownload} startIcon={<DownloadIcon />} variant="outlined">
                        {t('filebrowser_main.download', { defaultValue: 'Download' })}
                    </Button>
                )}
                <Button onClick={onClose} variant="outlined">{t('filebrowser_main.close', { defaultValue: 'Close' })}</Button>
            </DialogActions>
        </Dialog>
    );
}
