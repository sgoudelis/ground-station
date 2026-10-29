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

import React, { startTransition, useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { Box, Typography, Chip, Tooltip, Link, CircularProgress, useTheme, IconButton, Dialog, DialogTitle, DialogContent, DialogActions, Button, Alert } from '@mui/material';
import { DataGrid, gridClasses } from '@mui/x-data-grid';
import { useSelector, useDispatch, useStore } from 'react-redux';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import DeleteIcon from '@mui/icons-material/Delete';
import CloseIcon from '@mui/icons-material/Close';
import CheckIcon from '@mui/icons-material/Check';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { alpha, darken, lighten } from '@mui/material/styles';
import { setPacketsDrawerOpen, setPacketsDrawerHeight } from './waterfall-slice';
import { getDecoderDisplay, getModulationDisplay, ModulationType } from '../../constants/modulations';
import TelemetryViewerDialog from '../filebrowser/telemetry-viewer-dialog.jsx';
import ImageViewerDialog from '../common/image-viewer-dialog.jsx';
import { deleteDecoded } from '../filebrowser/filebrowser-slice';
import { deleteOutputByFilename } from '../decoders/decoders-slice';
import { useSocket } from '../common/socket.jsx';
import { humanizeBytes } from '../common/common.jsx';
import { toast } from 'react-toastify';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { formatTime } from '../../utils/date-time.js';
import { useTranslation } from 'react-i18next';
import { SatelliteInfoDialog } from '../satellites/satellite-info-page.jsx';
import { fetchSatellite } from '../satellites/satellite-slice.jsx';

// Time formatter component that updates without causing re-renders
const TimeFormatter = React.memo(function TimeFormatter({ value, nowMs, timezone, locale }) {
    const { t } = useTranslation('waterfall');
    const timeString = formatTime(value, {
        timezone,
        locale,
        options: { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' },
    });
    // Guard against slight server/client clock skew that can make fresh packets appear in the "future".
    const diffInSeconds = Math.max(0, Math.floor((nowMs - value) / 1000));

    if (diffInSeconds < 60) {
        return <span>{diffInSeconds}{t('decoded_packets_drawer.s_ago', { defaultValue: 's ago (' })}{timeString})</span>;
    }
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    const remainingSeconds = diffInSeconds % 60;
    if (diffInMinutes < 60) {
        return <span>{diffInMinutes}m {remainingSeconds}{t('decoded_packets_drawer.s_ago', { defaultValue: 's ago (' })}{timeString})</span>;
    }
    const diffInHours = Math.floor(diffInMinutes / 60);
    const remainingMinutes = diffInMinutes % 60;
    if (diffInHours < 24) {
        return <span>{diffInHours}h {remainingMinutes}{t('decoded_packets_drawer.m_ago', { defaultValue: 'm ago (' })}{timeString})</span>;
    }
    const diffInDays = Math.floor(diffInHours / 24);
    const remainingHours = diffInHours % 24;
    return <span>{diffInDays}d {remainingHours}{t('decoded_packets_drawer.h_ago', { defaultValue: 'h ago (' })}{timeString})</span>;
});

// humanizeBytes now provided by common.jsx and imported above

// DataGrid reconciliation is considerably more expensive than appending a
// decoded packet to Redux. Half-second batches keep the live packet view
// responsive while avoiding five complete table updates per second.
const LIVE_DRAWER_REFRESH_MS = 500;
const LIVE_DRAWER_ROW_LIMIT = 50;
const DEFAULT_DRAWER_ROW_LIMIT = 100;
const EMPTY_VFO_COLORS = Object.freeze([]);

const formatLoraParameters = (output = {}) => {
    const config = output.decoder_config || {};
    const summary = String(output.parameters || '').trim();
    const parts = summary ? [summary.replace(/,\s*/g, ' · ')] : [];
    if (!summary) {
        if (config.sf != null) parts.push(`SF${config.sf}`);
        const bandwidth = Number(config.bw);
        if (Number.isFinite(bandwidth) && bandwidth > 0) parts.push(`BW ${bandwidth / 1000} kHz`);
    }

    // LoRa's configured CR is an offset (1–4); older profiles may store the denominator (5–8).
    const codingRate = Number(config.cr);
    if (Number.isInteger(codingRate) && codingRate >= 1 && codingRate <= 8) {
        parts.push(`CR 4/${codingRate <= 4 ? codingRate + 4 : codingRate}`);
    }

    const syncWord = config.sync_word;
    if (Array.isArray(syncWord) && syncWord.length > 0) {
        const syncLabel = syncWord.length === 2
            ? (syncWord.every((value) => Number(value) === 0) ? 'any' : syncWord.join('/'))
            : `0x${Number(syncWord[0]).toString(16).padStart(2, '0').toUpperCase()}`;
        parts.push(`Sync ${syncLabel}`);
    } else if (syncWord != null && syncWord !== '') {
        parts.push(`Sync ${syncWord}`);
    }

    if (config.implicit_header != null) parts.push(config.implicit_header ? 'Implicit header' : 'Explicit header');
    if (config.has_crc != null) parts.push(`CRC cfg ${config.has_crc ? 'on' : 'off'}`);
    if (config.ldro_mode != null) {
        const ldroMode = { 0: 'off', 1: 'on', 2: 'auto' }[config.ldro_mode];
        if (ldroMode) parts.push(`LDRO ${ldroMode}`);
    }
    if (config.invert_iq) parts.push('IQ inverted');
    return parts.join(' · ') || '-';
};

const ParametersCell = React.memo(function ParametersCell({ value, isLora }) {
    const content = (
        <Typography
            variant="caption"
            sx={{
                fontFamily: 'monospace',
                fontSize: '0.65rem',
                lineHeight: 1.2,
                color: isLora ? 'text.secondary' : 'text.disabled',
                ...(isLora ? {
                    display: '-webkit-box',
                    minWidth: 0,
                    width: '100%',
                    whiteSpace: 'normal',
                    WebkitBoxOrient: 'vertical',
                    WebkitLineClamp: 2,
                    overflow: 'hidden',
                    overflowWrap: 'anywhere',
                } : null),
            }}
        >
            {value || '-'}
        </Typography>
    );
    return isLora ? <Tooltip title={value || '-'}>{content}</Tooltip> : content;
});

const encodeAssetPath = (path) => path
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/');

export const resolveDecodedAssetUrl = (filepath, fallbackFilename) => {
    const normalizedPath = typeof filepath === 'string'
        ? `/${filepath.replace(/\\/g, '/').replace(/^\/+/, '')}`
        : '';

    // Scheduled decoders write inside their observation bundle, which is
    // exposed by a different static route than manually decoded files.
    const observationMarker = '/data/observations/';
    const observationIndex = normalizedPath.lastIndexOf(observationMarker);
    if (observationIndex !== -1) {
        const relativePath = normalizedPath.slice(observationIndex + observationMarker.length);
        return `/observations/${encodeAssetPath(relativePath)}`;
    }

    const decodedMarker = '/data/decoded/';
    const decodedIndex = normalizedPath.lastIndexOf(decodedMarker);
    if (decodedIndex !== -1) {
        const relativePath = normalizedPath.slice(decodedIndex + decodedMarker.length);
        return `/decoded/${encodeAssetPath(relativePath)}`;
    }

    return fallbackFilename
        ? `/decoded/${encodeAssetPath(fallbackFilename)}`
        : null;
};

// Decoder output is stored newest-first. Keep that ordering when selecting the
// bounded live window so new packets are never displaced by older history.
export const mapOutputsToRows = (outputs, rowLimit = DEFAULT_DRAWER_ROW_LIMIT) => {
    return outputs
        .filter(output =>
            output.type === 'decoder-output' &&
            String(output.decoder_type || '').toLowerCase() !== 'gnss'
        )
        .slice(0, rowLimit)
        .map(output => {
            const isSstv = output.decoder_type === 'sstv';
            const isImage = isSstv || output.decoder_type === 'geoscanimage';
            const isLora = output.decoder_type === ModulationType.LORA;

            // Use identified NORAD ID from backend lookup, then configured satellite
            const noradId = output.output.callsigns?.identified_norad_id || output.output.satellite?.norad_id;
            const satelliteName = output.output.callsigns?.identified_satellite || output.output.satellite?.name || '-';

            // A LoRa payload has no callsign. Show the satellite associated with
            // the locked transmitter as a hint, rather than a decoded identity.
            const decodedFrom = output.output.callsigns?.from;
            const lockedSatelliteName = output.output.satellite?.name?.trim();
            const fromCallsign = isImage ? '-'
                : (decodedFrom || (isLora && lockedSatelliteName ? `(${lockedSatelliteName})` : '-'));
            const toCallsign = isImage ? '-' : (output.output.callsigns?.to || '-');
            const fromIsSatelliteHint = Boolean(isLora && !decodedFrom && lockedSatelliteName);
            const fromSatelliteNoradId = fromIsSatelliteHint
                ? output.output.satellite?.norad_id
                : null;

            // Image modes have their own label; LoRa rows expand the live decoder configuration.
            const parameters = isImage
                ? output.output.mode
                : (isLora ? formatLoraParameters(output.output) : output.output.parameters);

            // File size from output
            const fileSize = output.output.filesize || output.output.packet_length;

            return {
                id: output.id,
                timestamp: output.timestamp * 1000,
                satelliteName: satelliteName,
                noradId: noradId,
                from: fromCallsign,
                fromIsSatelliteHint,
                fromSatelliteNoradId,
                to: toCallsign,
                decoderType: output.decoder_type,
                parser: output.output.telemetry?.parser || '-',
                packetLength: fileSize,
                vfo: output.vfo,
                hasTelemetry: !!output.output.telemetry,
                telemetry: output.output.telemetry,
                parameters: parameters,
                framing: output.output.decoder_config?.framing || '-',
                payloadProtocol: output.output.decoder_config?.payload_protocol || '-',
                configSource: output.output.decoder_config?.source || '-',
                mode: output.output.mode,
                width: output.output.width,
                height: output.output.height,
                filename: output.output.filename,
                filepath: output.output.filepath,
                metadataFilename: output.output.metadata_filename,
                metadataFilepath: output.output.metadata_filepath,
                output: output.output,
            };
        })
        .reverse();
};

const DecodedPacketsDrawer = React.memo(function DecodedPacketsDrawer({ embedded = false }) {
    const { t } = useTranslation('waterfall');
    const { t: satellitesT } = useTranslation('satellites');
    const theme = useTheme();
    const dispatch = useDispatch();
    const store = useStore();
    const { socket } = useSocket();
    const { packetsDrawerOpen, packetsDrawerHeight, isStreaming } = useSelector((state) => state.waterfall);
    const vfoColors = useSelector((state) => state.vfo?.vfoColors || EMPTY_VFO_COLORS);
    const { timezone, locale } = useUserTimeSettings();

    const [isDragging, setIsDragging] = useState(false);
    const [dragStartY, setDragStartY] = useState(0);
    const [dragStartHeight, setDragStartHeight] = useState(packetsDrawerHeight);
    const [hasDragged, setHasDragged] = useState(false); // Track if user actually dragged
    const drawerRef = useRef(null);

    // Telemetry viewer state
    const [telemetryDialogOpen, setTelemetryDialogOpen] = useState(false);
    const [telemetryFile, setTelemetryFile] = useState(null);
    const [telemetryMetadata, setTelemetryMetadata] = useState(null);

    // Satellite details use the NORAD ID saved with the packet, so a later
    // change to the VFO lock cannot redirect an earlier packet's link.
    const [satelliteInfo, setSatelliteInfo] = useState(null);
    const [loadingNoradId, setLoadingNoradId] = useState(null);
    const latestSatelliteRequestRef = useRef(0);

    // SSTV image viewer state
    const [sstvDialogOpen, setSstvDialogOpen] = useState(false);
    const [sstvImage, setSstvImage] = useState(null);
    const [sstvMetadata, setSstvMetadata] = useState(null);

    // Delete confirmation state
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [packetToDelete, setPacketToDelete] = useState(null);

    const minHeight = 150;
    const maxHeight = 600;

    const effectiveDrawerOpen = embedded ? true : packetsDrawerOpen;
    const liveMode = isStreaming && effectiveDrawerOpen;
    const rowLimit = liveMode ? LIVE_DRAWER_ROW_LIMIT : DEFAULT_DRAWER_ROW_LIMIT;
    const rowLimitRef = useRef(rowLimit);
    const liveModeRef = useRef(liveMode);
    const latestRowsRef = useRef(mapOutputsToRows(store.getState().decoders.outputs, rowLimit));
    const [rows, setRows] = useState(latestRowsRef.current);
    const [timeNowMs, setTimeNowMs] = useState(() => Date.now());

    useEffect(() => {
        rowLimitRef.current = rowLimit;
        liveModeRef.current = liveMode;
        const nextRows = mapOutputsToRows(store.getState().decoders.outputs, rowLimit);
        latestRowsRef.current = nextRows;
        if (!liveMode) {
            setRows(nextRows);
        }
    }, [liveMode, rowLimit, store]);

    useEffect(() => {
        let previousOutputs = store.getState().decoders.outputs;

        // Decoder output can arrive several times per second. Retain the newest
        // rows outside React and let the live refresh interval publish a batch.
        // This avoids reconciling the entire DataGrid for every packet.
        return store.subscribe(() => {
            const outputs = store.getState().decoders.outputs;
            if (outputs === previousOutputs) {
                return;
            }
            previousOutputs = outputs;
            const nextRows = mapOutputsToRows(outputs, rowLimitRef.current);
            latestRowsRef.current = nextRows;
            if (!liveModeRef.current) {
                startTransition(() => {
                    setRows(nextRows);
                });
            }
        });
    }, [store]);

    useEffect(() => {
        if (!liveMode) return;
        const timer = setInterval(() => {
            // A packet-table refresh must never delay receiver interaction or
            // waterfall rendering. React may coalesce this work when the main
            // thread is busy with a newer packet batch.
            startTransition(() => {
                setRows(latestRowsRef.current);
            });
        }, LIVE_DRAWER_REFRESH_MS);

        return () => clearInterval(timer);
    }, [liveMode]);

    useEffect(() => {
        const timer = setInterval(() => {
            setTimeNowMs(Date.now());
        }, 5000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => () => {
        latestSatelliteRequestRef.current += 1;
    }, []);

    const handleOpenSatelliteInfo = useCallback(async (noradId) => {
        const parsedNoradId = Number(noradId);
        if (!socket || !Number.isInteger(parsedNoradId) || parsedNoradId <= 0) return;

        // A slower lookup must not replace the details from a later click.
        const requestId = ++latestSatelliteRequestRef.current;
        setLoadingNoradId(parsedNoradId);
        setSatelliteInfo(null);
        try {
            const response = await dispatch(fetchSatellite({ socket, noradId: parsedNoradId })).unwrap();
            if (latestSatelliteRequestRef.current !== requestId) return;
            if (Number(response?.details?.norad_id) !== parsedNoradId) {
                throw new Error('Satellite details unavailable');
            }
            setSatelliteInfo({
                ...response.details,
                position: response.position || null,
                transmitters: response.transmitters || [],
            });
        } catch {
            if (latestSatelliteRequestRef.current === requestId) {
                toast.error(satellitesT('satellite_database.failed_load'));
            }
        } finally {
            if (latestSatelliteRequestRef.current === requestId) setLoadingNoradId(null);
        }
    }, [dispatch, satellitesT, socket]);

    const handleCloseSatelliteInfo = useCallback(() => {
        latestSatelliteRequestRef.current += 1;
        setSatelliteInfo(null);
        setLoadingNoradId(null);
    }, []);

    // Handler to open telemetry viewer
    const handleOpenTelemetry = useCallback(async (row) => {
        try {
            console.log('Opening telemetry for row:', row);

            // Image decoder metadata is already in the output.
            const isSstv = row.decoderType === 'sstv';
            const isImage = isSstv || row.decoderType === 'geoscanimage';

            if (isImage) {
                // Image decoders have inline base64 data and metadata filepath.
                let metadataFilename = row.output?.metadata_filename;

                if (!metadataFilename) {
                    const imageFilename = row.filename || row.output?.filename;
                    console.log('Deriving metadata filename from image:', imageFilename);

                    if (!imageFilename || typeof imageFilename !== 'string') {
                        console.error('Invalid filename:', imageFilename);
                        throw new Error('Filename not found in output or invalid');
                    }
                    metadataFilename = imageFilename.replace(/\.(png|jpe?g)$/i, '.json');
                }

                const metadataUrl = resolveDecodedAssetUrl(row.metadataFilepath, metadataFilename);
                console.log('Fetching metadata from:', metadataUrl);

                const response = await fetch(metadataUrl);

                if (!response.ok) {
                    throw new Error(`Failed to fetch metadata: ${response.status} ${response.statusText}`);
                }

                const metadata = await response.json();

                // For SSTV, open SSTV image viewer instead
                setSstvImage({
                    filename: row.filename || row.output?.filename,
                    imageData: row.output?.image_data,
                    format: row.output?.format || 'image/png',
                });
                setSstvMetadata(metadata);
                setSstvDialogOpen(true);
            } else {
                // For other decoded files (.bin), fetch both file and metadata
                const filename = row.filename;

                if (!filename || typeof filename !== 'string') {
                    console.error('Invalid filename:', filename);
                    throw new Error('Filename not found or invalid');
                }

                const metadataFilename = row.metadataFilename || filename.replace(/\.bin$/i, '.json');
                const fileUrl = resolveDecodedAssetUrl(row.filepath, filename);
                const metadataUrl = resolveDecodedAssetUrl(row.metadataFilepath, metadataFilename);

                // Fetch metadata from the metadata URL
                const response = await fetch(metadataUrl);

                if (!response.ok) {
                    throw new Error(`Failed to fetch metadata: ${response.status} ${response.statusText}`);
                }

                const metadata = await response.json();

                // Set state to open dialog
                setTelemetryFile({
                    filename: filename,
                    url: fileUrl,
                    type: 'decoded'
                });
                setTelemetryMetadata(metadata);
                setTelemetryDialogOpen(true);
            }
        } catch (error) {
            console.error('Error opening telemetry:', error);
            toast.error(`Failed to load telemetry: ${error.message}`);
        }
    }, []);

    // Handler to delete packet file
    const handleDeletePacket = useCallback((row) => {
        setPacketToDelete(row);
        setDeleteDialogOpen(true);
    }, []);

    // Confirm delete and dispatch socket event
    const confirmDeletePacket = async () => {
        if (!packetToDelete || !socket) return;

        try {
            await dispatch(deleteDecoded({ socket, filename: packetToDelete.filename })).unwrap();
            // Success toast will be shown by socket event listener
            setDeleteDialogOpen(false);
            setPacketToDelete(null);
        } catch (error) {
            toast.error(`Failed to delete file: ${error.message}`);
        }
    };

    const renderVfoCell = useCallback((params) => {
        const vfoNumber = Number(params.value);
        if (!Number.isInteger(vfoNumber) || vfoNumber <= 0) return '-';
        const vfoColor = vfoColors[vfoNumber - 1] || theme.palette.info.main;
        return (
            <Chip
                label={`VFO${vfoNumber}`}
                size="small"
                sx={{
                    height: 22,
                    borderRadius: 1,
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    color: theme.palette.mode === 'dark' ? lighten(vfoColor, 0.45) : darken(vfoColor, 0.2),
                    backgroundColor: alpha(vfoColor, theme.palette.mode === 'dark' ? 0.2 : 0.13),
                    border: `1px solid ${alpha(vfoColor, 0.55)}`,
                    '& .MuiChip-label': { px: 0.8 },
                }}
            />
        );
    }, [theme, vfoColors]);

    const renderFromCell = useCallback((params, compact) => {
        const noradId = Number(params.row.fromSatelliteNoradId);
        const hasSatelliteLink = Number.isInteger(noradId) && noradId > 0;
        const fromLabel = hasSatelliteLink ? (
            <Link
                component="button"
                type="button"
                variant={compact ? 'caption' : 'body2'}
                underline="hover"
                aria-busy={loadingNoradId === noradId}
                onClick={(event) => {
                    event.stopPropagation();
                    void handleOpenSatelliteInfo(noradId);
                }}
                sx={{ fontWeight: compact ? 600 : undefined, textAlign: 'left', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
                {params.value}
                {loadingNoradId === noradId && <CircularProgress size={10} sx={{ ml: 0.5 }} />}
            </Link>
        ) : compact ? (
            <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {params.value}
            </Typography>
        ) : (
            <span style={{ color: theme.palette.primary.main, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{params.value}</span>
        );

        if (!params.row.fromIsSatelliteHint) return fromLabel;

        const tooltipText = t('decoded_packets_drawer.inferred_satellite_identity', {
            defaultValue: 'Satellite identity was inferred from the locked transmitter you selected because this packet has no callsign.',
        });
        return (
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minWidth: 0, maxWidth: '100%' }}>
                {fromLabel}
                <Tooltip title={tooltipText}>
                    <Box component="span" tabIndex={0} aria-label={tooltipText} sx={{ display: 'inline-flex', flexShrink: 0, color: 'text.disabled', cursor: 'help' }}>
                        <InfoOutlinedIcon sx={{ fontSize: 13 }} />
                    </Box>
                </Tooltip>
            </Box>
        );
    }, [handleOpenSatelliteInfo, loadingNoradId, t, theme]);

    const columns = useMemo(() => ([
        {
            field: 'timestamp',
            headerName: 'Time',
            minWidth: 150,
            flex: 1.1,
            renderCell: (params) => <TimeFormatter value={params.value} nowMs={timeNowMs} timezone={timezone} locale={locale} />
        },
        {
            field: 'from',
            headerName: 'From',
            minWidth: 100,
            flex: 1,
            renderCell: (params) => renderFromCell(params, false)
        },
        {
            field: 'to',
            headerName: 'To',
            minWidth: 100,
            flex: 1,
            renderCell: (params) => (
                <span style={{ color: theme.palette.secondary.main }}>
                    {params.value}
                </span>
            )
        },
        {
            field: 'decoderType',
            headerName: 'Decoder',
            minWidth: 72,
            flex: 0.65,
            align: 'center',
            headerAlign: 'center',
            renderCell: (params) => (
                <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 700 }}>
                    {getDecoderDisplay(params.value)}
                </Typography>
            )
        },
        {
            field: 'framing',
            headerName: 'Framing',
            minWidth: 76,
            flex: 0.65,
            align: 'center',
            headerAlign: 'center',
            renderCell: (params) => (
                <Typography variant="caption" sx={{ color: 'warning.main', fontWeight: 700 }}>
                    {getModulationDisplay(params.value)}
                </Typography>
            )
        },
        {
            field: 'payloadProtocol',
            headerName: 'Payload',
            minWidth: 76,
            flex: 0.65,
            align: 'center',
            headerAlign: 'center',
            renderCell: (params) => (
                <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 700 }}>
                    {getModulationDisplay(params.value)}
                </Typography>
            )
        },
        {
            field: 'parser',
            headerName: 'Parser',
            minWidth: 76,
            flex: 0.65,
            align: 'center',
            headerAlign: 'center',
            renderCell: (params) => (
                <Typography variant="caption" sx={{ color: 'secondary.main', textTransform: 'uppercase', fontWeight: 700 }}>
                    {params.value}
                </Typography>
            )
        },
        {
            field: 'packetLength',
            headerName: 'Size',
            minWidth: 70,
            flex: 0.6,
            align: 'center',
            headerAlign: 'center',
            valueFormatter: (value) => humanizeBytes(value)
        },
        {
            field: 'vfo',
            headerName: 'VFO',
            minWidth: 60,
            flex: 0.5,
            align: 'center',
            headerAlign: 'center',
            renderCell: renderVfoCell
        },
        {
            field: 'hasTelemetry',
            headerName: 'TLM',
            minWidth: 60,
            flex: 0.5,
            align: 'center',
            headerAlign: 'center',
            renderCell: (params) => params.value ? (
                <CheckIcon sx={{ color: 'success.main', fontSize: '1.1rem' }} />
            ) : (
                <CloseIcon sx={{ color: 'text.disabled', fontSize: '1.1rem' }} />
            )
        },
        {
            field: 'parameters',
            headerName: 'Parameters',
            minWidth: 250,
            flex: 2.6,
            renderCell: (params) => <ParametersCell value={params.value} isLora={params.row.decoderType === ModulationType.LORA} />
        },
        {
            field: 'actions',
            headerName: 'Actions',
            width: 120,
            sortable: false,
            align: 'right',
            headerAlign: 'right',
            renderCell: (params) => (
                <>
                    <IconButton
                        size={"large"}
                        onClick={() => handleOpenTelemetry(params.row)}
                        sx={{
                            padding: 0,
                            '&:hover': {
                                backgroundColor: alpha(theme.palette.primary.main, 0.1),
                            }
                        }}
                    >
                        <FolderOpenIcon sx={{ fontSize: '1.3rem' }} />
                    </IconButton>
                    <IconButton
                        size={"large"}
                        onClick={() => handleDeletePacket(params.row)}
                        sx={{
                            padding: 0,
                            '&:hover': {
                                backgroundColor: alpha(theme.palette.error.main, 0.1),
                            }
                        }}
                    >
                        <DeleteIcon sx={{ fontSize: '1.3rem', color: 'error.main' }} />
                    </IconButton>
                </>
            )
        },
    ]), [theme, handleOpenTelemetry, handleDeletePacket, renderVfoCell, renderFromCell, timeNowMs, timezone, locale]);

    const liveColumns = useMemo(() => ([
        {
            field: 'timestamp',
            headerName: 'Time',
            minWidth: 150,
            flex: 1.1,
            renderCell: (params) => <TimeFormatter value={params.value} nowMs={timeNowMs} timezone={timezone} locale={locale} />
        },
        {
            field: 'from',
            headerName: 'From',
            minWidth: 100,
            flex: 1,
            renderCell: (params) => renderFromCell(params, true)
        },
        {
            field: 'to',
            headerName: 'To',
            minWidth: 100,
            flex: 1,
            renderCell: (params) => (
                <Typography variant="caption" sx={{ color: 'secondary.main', fontWeight: 600 }}>
                    {params.value}
                </Typography>
            )
        },
        {
            field: 'decoderType',
            headerName: 'Decoder',
            minWidth: 72,
            flex: 0.65,
            align: 'center',
            headerAlign: 'center',
            renderCell: (params) => (
                <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 700 }}>
                    {getDecoderDisplay(params.value)}
                </Typography>
            )
        },
        {
            field: 'framing',
            headerName: 'Framing',
            minWidth: 76,
            flex: 0.65,
            align: 'center',
            headerAlign: 'center',
            renderCell: (params) => (
                <Typography variant="caption" sx={{ color: 'warning.main', fontWeight: 700 }}>
                    {getModulationDisplay(params.value)}
                </Typography>
            )
        },
        {
            field: 'payloadProtocol',
            headerName: 'Payload',
            minWidth: 76,
            flex: 0.65,
            align: 'center',
            headerAlign: 'center',
            renderCell: (params) => (
                <Typography variant="caption" sx={{ color: 'success.main', fontWeight: 700 }}>
                    {getModulationDisplay(params.value)}
                </Typography>
            )
        },
        {
            field: 'parser',
            headerName: 'Parser',
            minWidth: 76,
            flex: 0.65,
            align: 'center',
            headerAlign: 'center',
            renderCell: (params) => (
                <Typography variant="caption" sx={{ color: 'secondary.main', textTransform: 'uppercase', fontWeight: 700 }}>
                    {params.value}
                </Typography>
            )
        },
        {
            field: 'packetLength',
            headerName: 'Size',
            minWidth: 70,
            flex: 0.6,
            align: 'center',
            headerAlign: 'center',
            valueFormatter: (value) => humanizeBytes(value)
        },
        {
            field: 'vfo',
            headerName: 'VFO',
            minWidth: 60,
            flex: 0.5,
            align: 'center',
            headerAlign: 'center',
            renderCell: renderVfoCell
        },
        {
            field: 'hasTelemetry',
            headerName: 'TLM',
            minWidth: 60,
            flex: 0.5,
            align: 'center',
            headerAlign: 'center',
            renderCell: (params) => params.value ? (
                <CheckIcon sx={{ color: 'success.main', fontSize: '1.1rem' }} />
            ) : (
                <CloseIcon sx={{ color: 'text.disabled', fontSize: '1.1rem' }} />
            )
        },
        {
            field: 'parameters',
            headerName: 'Parameters',
            minWidth: 250,
            flex: 2.6,
            renderCell: (params) => <ParametersCell value={params.value} isLora={params.row.decoderType === ModulationType.LORA} />
        },
        {
            field: 'actions',
            headerName: 'Actions',
            width: 120,
            sortable: false,
            align: 'right',
            headerAlign: 'right',
            renderCell: (params) => (
                <>
                    <IconButton
                        size={"large"}
                        onClick={() => handleOpenTelemetry(params.row)}
                        sx={{ padding: 0 }}
                    >
                        <FolderOpenIcon sx={{ fontSize: '1.2rem' }} />
                    </IconButton>
                    <IconButton
                        size={"large"}
                        onClick={() => handleDeletePacket(params.row)}
                        sx={{ padding: 0 }}
                    >
                        <DeleteIcon sx={{ fontSize: '1.2rem', color: 'error.main' }} />
                    </IconButton>
                </>
            )
        },
    ]), [handleOpenTelemetry, handleDeletePacket, renderVfoCell, renderFromCell, timeNowMs, timezone, locale]);

    const displayedColumns = liveMode ? liveColumns : columns;

    const handleToggle = () => {
        if (embedded) {
            return;
        }
        // Only toggle if user didn't drag
        if (!hasDragged) {
            dispatch(setPacketsDrawerOpen(!packetsDrawerOpen));
        }
    };

    // Mouse/touch down on handle to start dragging
    const handleMouseDown = (e) => {
        if (embedded) {
            return;
        }
        if (packetsDrawerOpen) {
            setIsDragging(true);
            setHasDragged(false); // Reset drag flag
            const clientY = e.type === 'touchstart' ? e.touches[0].clientY : e.clientY;
            setDragStartY(clientY);
            setDragStartHeight(packetsDrawerHeight);
            e.preventDefault();
        }
    };

    // Mouse/touch move while dragging
    useEffect(() => {
        const handleMouseMove = (e) => {
            if (isDragging) {
                const clientY = e.type === 'touchmove' ? e.touches[0].clientY : e.clientY;
                const deltaY = dragStartY - clientY; // Inverted because drawer grows upward
                const newHeight = Math.min(maxHeight, Math.max(minHeight, dragStartHeight + deltaY));

                // If moved more than 5px, consider it a drag
                if (Math.abs(deltaY) > 5) {
                    setHasDragged(true);
                }

                dispatch(setPacketsDrawerHeight(newHeight));
            }
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            // Reset hasDragged after a short delay to allow onClick to check it
            setTimeout(() => setHasDragged(false), 100);
        };

        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            document.addEventListener('touchmove', handleMouseMove, { passive: false });
            document.addEventListener('touchend', handleMouseUp);
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            document.removeEventListener('touchmove', handleMouseMove);
            document.removeEventListener('touchend', handleMouseUp);
        };
    }, [isDragging, dragStartY, dragStartHeight, dispatch]);

    // Listen for file deletion events to clean up outputs from decoders slice
    useEffect(() => {
        if (!socket) return;

        const handleFileBrowserState = (state) => {
            // When a decoded file is successfully deleted, remove from outputs
            if (state.action === 'delete-decoded') {
                const deletedFilename = state.filename;

                if (deletedFilename) {
                    dispatch(deleteOutputByFilename({ filename: deletedFilename }));
                }
            }
        };

        socket.on('file_browser_state', handleFileBrowserState);

        return () => {
            socket.off('file_browser_state', handleFileBrowserState);
        };
    }, [socket, dispatch]);

    return (
        <Box
            ref={drawerRef}
            className="decoded-packets-drawer-container"
            sx={{
                position: 'relative',
                width: '100%',
                height: embedded ? '100%' : 'auto',
                borderTop: embedded ? 'none' : `1px solid ${theme.palette.border.main}`,
                backgroundColor: theme.palette.background.paper,
                minHeight: embedded ? 0 : '32px',
            }}
        >
            {!embedded && (
                <Box
                    className="decoded-packets-drawer-handle"
                    onMouseDown={handleMouseDown}
                    onTouchStart={handleMouseDown}
                    onClick={handleToggle}
                    sx={{
                        height: '32px',
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 1,
                        backgroundColor: theme.palette.background.paper,
                        borderBottom: packetsDrawerOpen ? `1px solid ${theme.palette.border.main}` : 'none',
                        cursor: packetsDrawerOpen ? 'ns-resize' : 'pointer',
                        userSelect: 'none',
                        transition: 'background-color 0.2s',
                        '&:hover': {
                            backgroundColor: alpha(theme.palette.primary.main, 0.08),
                        },
                    }}
                >
                    <DragIndicatorIcon sx={{ fontSize: '1rem', color: 'text.disabled' }} />
                    {packetsDrawerOpen ? (
                        <KeyboardArrowDownIcon sx={{ fontSize: '1.2rem', color: 'text.secondary' }} />
                    ) : (
                        <KeyboardArrowUpIcon sx={{ fontSize: '1.2rem', color: 'text.secondary' }} />
                    )}
                    <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.7rem', letterSpacing: '0.5px' }}>
                        {t('decoded_packets_drawer.packets', { defaultValue: 'PACKETS' })}
                    </Typography>
                    {packetsDrawerOpen ? (
                        <KeyboardArrowDownIcon sx={{ fontSize: '1.2rem', color: 'text.secondary' }} />
                    ) : (
                        <KeyboardArrowUpIcon sx={{ fontSize: '1.2rem', color: 'text.secondary' }} />
                    )}
                    <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.7rem', color: 'text.disabled', ml: 0.5 }}>
                        ({rows.length})
                    </Typography>
                </Box>
            )}

            {/* Drawer content */}
            {effectiveDrawerOpen && (
                <Box
                    sx={{
                        height: embedded ? '100%' : `${packetsDrawerHeight}px`,
                        overflow: 'hidden',
                        backgroundColor: theme.palette.background.paper,
                    }}
                >
                    <DataGrid
                            rows={rows}
                            columns={displayedColumns}
                            density="compact"
                            disableRowSelectionOnClick
                            hideFooter
                            disableColumnFilter={liveMode}
                            disableColumnSelector={liveMode}
                            disableColumnMenu={liveMode}
                            initialState={{
                                sorting: {
                                    sortModel: [{ field: 'timestamp', sort: 'desc' }],
                                },
                            }}
                            localeText={{
                                noRowsLabel: 'No decoded packets yet',
                            }}
                            sx={{
                                height: '100%',
                                border: 0,
                                backgroundColor: theme.palette.background.paper,
                                [`& .${gridClasses.cell}:focus, & .${gridClasses.cell}:focus-within`]: {
                                    outline: 'none',
                                },
                                [`& .${gridClasses.cell}[data-field="parameters"]`]: {
                                    display: 'flex',
                                    alignItems: 'center',
                                },
                                [`& .${gridClasses.columnHeader}`]: {
                                    backgroundColor: theme.palette.background.default,
                                    '&:focus, &:focus-within': {
                                        outline: 'none',
                                    },
                                },
                                '& .MuiDataGrid-overlay': {
                                    fontSize: '0.875rem',
                                    fontStyle: 'italic',
                                    color: 'text.secondary',
                                },
                            }}
                        />
                </Box>
            )}

            {/* Telemetry Viewer Dialog */}
            <TelemetryViewerDialog
                open={telemetryDialogOpen}
                onClose={() => setTelemetryDialogOpen(false)}
                file={telemetryFile}
                metadata={telemetryMetadata}
                socket={socket}
                onMetadataChange={setTelemetryMetadata}
            />

            <SatelliteInfoDialog
                open={Boolean(satelliteInfo)}
                onClose={handleCloseSatelliteInfo}
                satelliteData={satelliteInfo}
            />

            {/* Use the same image viewer as observation folders and the library. */}
            <ImageViewerDialog
                open={sstvDialogOpen}
                onClose={() => setSstvDialogOpen(false)}
                src={sstvImage ? `data:${sstvImage.format};base64,${sstvImage.imageData}` : undefined}
                title={sstvImage?.filename}
                metadata={sstvMetadata}
                timezone={timezone}
                locale={locale}
            />

            {/* Delete Confirmation Dialog */}
            <Dialog
                open={deleteDialogOpen}
                onClose={() => setDeleteDialogOpen(false)}
                maxWidth="sm"
                fullWidth
                PaperProps={{
                    sx: {
                        bgcolor: 'background.paper',
                        borderRadius: 2,
                    }
                }}
            >
                <DialogTitle
                    sx={{
                        bgcolor: 'error.main',
                        color: 'error.contrastText',
                        fontSize: '1.125rem',
                        fontWeight: 600,
                        py: 2,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1.5,
                    }}
                >
                    <Box
                        component="span"
                        sx={{
                            width: 24,
                            height: 24,
                            borderRadius: '50%',
                            bgcolor: 'error.contrastText',
                            color: 'error.main',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 'bold',
                            fontSize: '1rem',
                        }}
                    >
                        !
                    </Box>
                    {t('decoded_packets_drawer.delete_decoded_file', { defaultValue: 'Delete Decoded File' })}
                </DialogTitle>
                <DialogContent sx={{ px: 3, pt: 3, pb: 3 }}>
                    <Typography variant="body1" sx={{ mt: 2, mb: 2, color: 'text.primary' }}>
                        {t('decoded_packets_drawer.are_you_sure_you_want_to_delete_this_decoded_packet_file', { defaultValue: 'Are you sure you want to delete this decoded packet file?' })}
                    </Typography>
                    <Typography variant="body2" sx={{ mb: 2, fontWeight: 600, color: 'text.secondary' }}>
                        {t('decoded_packets_drawer.file_to_be_deleted', { defaultValue: 'File to be deleted:' })}
                    </Typography>
                    <Box sx={{
                        maxHeight: 300,
                        overflowY: 'auto',
                        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
                        borderRadius: 1,
                        border: (theme) => `1px solid ${theme.palette.divider}`,
                    }}>
                        <Box sx={{ p: 2 }}>
                            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1, color: 'text.primary' }}>
                                {packetToDelete?.filename}
                            </Typography>
                            <Box sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 1, columnGap: 2 }}>
                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                    {t('decoded_packets_drawer.decoder', { defaultValue: 'Decoder:' })}
                                </Typography>
                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                    {getDecoderDisplay(packetToDelete?.decoderType)}
                                </Typography>

                                {packetToDelete?.from && packetToDelete?.from !== '-' && (
                                    <>
                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                            {t('decoded_packets_drawer.from', { defaultValue: 'From:' })}
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                            {packetToDelete.from}
                                        </Typography>
                                    </>
                                )}

                                {packetToDelete?.to && packetToDelete?.to !== '-' && (
                                    <>
                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                            {t('decoded_packets_drawer.to', { defaultValue: 'To:' })}
                                        </Typography>
                                        <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                            {packetToDelete.to}
                                        </Typography>
                                    </>
                                )}

                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.secondary', fontWeight: 500 }}>
                                    {t('decoded_packets_drawer.size', { defaultValue: 'Size:' })}
                                </Typography>
                                <Typography variant="body2" sx={{ fontSize: '0.813rem', color: 'text.primary' }}>
                                    {humanizeBytes(packetToDelete?.packetLength)}
                                </Typography>
                            </Box>
                        </Box>
                    </Box>
                    <Alert severity="warning" sx={{ mt: 2 }}>
                        {t('decoded_packets_drawer.this_action_cannot_be_undone_the_file_will_be_permanentl', { defaultValue: 'This action cannot be undone! The file will be permanently deleted from the filesystem.' })}
                    </Alert>
                </DialogContent>
                <DialogActions
                    sx={{
                        bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.900' : 'grey.50',
                        borderTop: (theme) => `1px solid ${theme.palette.divider}`,
                        px: 3,
                        py: 2,
                        gap: 1.5,
                    }}
                >
                    <Button
                        onClick={() => setDeleteDialogOpen(false)}
                        variant="outlined"
                        color="inherit"
                        sx={{
                            minWidth: 100,
                            textTransform: 'none',
                            fontWeight: 500,
                        }}
                    >
                        {t('decoded_packets_drawer.cancel', { defaultValue: 'Cancel' })}
                    </Button>
                    <Button
                        variant="contained"
                        onClick={confirmDeletePacket}
                        color="error"
                        sx={{
                            minWidth: 100,
                            textTransform: 'none',
                            fontWeight: 600,
                        }}
                    >
                        {t('decoded_packets_drawer.delete', { defaultValue: 'Delete' })}
                    </Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
});

export default DecodedPacketsDrawer;
