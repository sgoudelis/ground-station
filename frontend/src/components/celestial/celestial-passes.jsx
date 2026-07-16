import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Box,
    Button,
    Checkbox,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    FormControl,
    FormControlLabel,
    FormGroup,
    IconButton,
    InputLabel,
    MenuItem,
    Select,
    Tooltip,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import { alpha, darken, lighten, styled } from '@mui/material/styles';
import {
    DataGrid,
    GridPagination,
    gridClasses,
    gridPageCountSelector,
    gridPageSelector,
    gridRowSelectionCountSelector,
    useGridApiContext,
    useGridSelector,
} from '@mui/x-data-grid';
import AccessTimeFilledIcon from '@mui/icons-material/AccessTimeFilled';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import RadioButtonCheckedIcon from '@mui/icons-material/RadioButtonChecked';
import RefreshIcon from '@mui/icons-material/Refresh';
import SettingsIcon from '@mui/icons-material/Settings';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
    resetCelestialPassesTableSettings,
    setCelestialPassesTableColumnVisibility,
    setCelestialPassesTablePageSize,
    setCelestialPassesTableSortModel,
} from './celestial-slice.jsx';
import { getClassNamesBasedOnGridEditing, islandTitleBarCompactSx, TitleBar } from '../common/common.jsx';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { toRowSelectionModel, toSelectedIds } from '../../utils/datagrid-selection.js';
import ProgressFormatter from '../earthview/progressbar-widget.jsx';
import TargetNumberIcon from '../common/target-number-icon.jsx';
import CelestialContextMenu from '../target/celestialcontextmenu.jsx';
import { useSocket } from '../common/socket.jsx';
import { useTargetRotatorSelectionDialog } from '../target/use-target-rotator-selection-dialog.jsx';
import { setRotator, setTrackerId, setTrackingStateInBackend } from '../target/target-slice.jsx';
import { toast } from '../../utils/toast-with-timestamp.jsx';
import TransmittersDialog from '../satellites/transmitters-dialog.jsx';
import ElevationDisplay from '../common/elevation-display.jsx';
import {
    calculateElevationTrend,
    pruneElevationHistory,
    updateElevationHistory,
} from '../../utils/elevationtrend.js';

const getPassBackgroundColor = (color, theme, coefficient) => ({
    backgroundColor: darken(color, coefficient),
    ...theme.applyStyles('light', {
        backgroundColor: lighten(color, coefficient),
    }),
});

const StyledDataGrid = styled(DataGrid)(({ theme }) => ({
    '& .MuiDataGrid-row': {
        borderLeft: '3px solid transparent',
    },
    '& .passes-row-live': {
        backgroundColor: alpha(theme.palette.success.main, 0.2),
        borderLeftColor: alpha(theme.palette.success.main, 0.95),
        ...theme.applyStyles('light', {
            backgroundColor: alpha(theme.palette.success.main, 0.1),
            borderLeftColor: alpha(theme.palette.success.main, 0.65),
        }),
        '&:hover': {
            backgroundColor: alpha(theme.palette.success.main, 0.27),
            ...theme.applyStyles('light', {
                backgroundColor: alpha(theme.palette.success.main, 0.14),
            }),
        },
    },
    '& .passes-row-upcoming-soon': {
        backgroundColor: alpha(theme.palette.warning.main, 0.14),
        borderLeftColor: alpha(theme.palette.warning.main, 0.9),
        ...theme.applyStyles('light', {
            backgroundColor: alpha(theme.palette.warning.main, 0.08),
            borderLeftColor: alpha(theme.palette.warning.main, 0.6),
        }),
    },
    '& .passes-row-passed': {
        '& .MuiDataGrid-cell': {
            color: theme.palette.text.secondary,
        },
        '& .passes-time-absolute': {
            opacity: 0.8,
        },
    },
    '& .passes-row-dead': {
        backgroundColor: alpha(theme.palette.error.main, 0.24),
        borderLeftColor: alpha(theme.palette.error.main, 0.9),
        ...theme.applyStyles('light', {
            backgroundColor: alpha(theme.palette.error.main, 0.1),
            borderLeftColor: alpha(theme.palette.error.main, 0.65),
        }),
    },
    '& .passes-cell-passing': {
        ...getPassBackgroundColor(theme.palette.success.main, theme, 0.7),
    },
    '& .passes-cell-passed': {
        backgroundColor: alpha(theme.palette.info.main, 0.28),
        borderLeft: `2px solid ${alpha(theme.palette.info.main, 0.85)}`,
        ...theme.applyStyles('light', {
            backgroundColor: alpha(theme.palette.info.main, 0.14),
            borderLeft: `2px solid ${alpha(theme.palette.info.main, 0.55)}`,
        }),
    },
    '& .passes-cell-warning': {
        color: theme.palette.error.main,
        textDecoration: 'line-through',
    },
    '& .passes-cell-success': {
        color: theme.palette.success.main,
        fontWeight: 'bold',
        textDecoration: 'underline',
    },
    '& .passes-cell-status': {
        alignItems: 'center',
        paddingTop: 0,
        paddingBottom: 0,
    },
}));
const DIALOG_PAPER_SX = {
    bgcolor: 'background.paper',
    border: (theme) => `1px solid ${theme.palette.divider}`,
    borderRadius: 2,
};
const DIALOG_TITLE_SX = {
    bgcolor: (theme) => (theme.palette.mode === 'dark' ? 'grey.900' : 'grey.100'),
    borderBottom: (theme) => `1px solid ${theme.palette.divider}`,
    fontSize: '1.125rem',
    fontWeight: 'bold',
    py: 2.2,
};
const DIALOG_CONTENT_SX = {
    px: 2,
    pt: 2,
    pb: 1.5,
};
const DIALOG_ACTIONS_SX = {
    px: 2,
    py: 1.5,
    bgcolor: 'background.paper',
    borderTop: (theme) => `1px solid ${theme.palette.divider}`,
};
const FOOTER_ACTION_ROW_SX = {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 1,
    overflowX: 'auto',
    msOverflowStyle: 'none',
    scrollbarWidth: 'none',
    '&::-webkit-scrollbar': { display: 'none' },
    '& > *': {
        flexShrink: 0,
        whiteSpace: 'nowrap',
    },
};

const CustomPagination = () => {
    const apiRef = useGridApiContext();
    const page = useGridSelector(apiRef, gridPageSelector);
    const pageCount = useGridSelector(apiRef, gridPageCountSelector);
    const selectedRowCount = useGridSelector(apiRef, gridRowSelectionCountSelector);
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const isTablet = useMediaQuery(theme.breakpoints.down('md'));
    const isMedium = useMediaQuery(theme.breakpoints.down('lg'));

    const handlePageChange = (newPage) => {
        apiRef.current.setPage(newPage);
    };

    const getPageNumbers = () => {
        const maxButtons = isMobile ? 5 : isTablet ? 8 : 12;
        const pages = [];

        if (pageCount <= maxButtons) {
            for (let index = 0; index < pageCount; index += 1) {
                pages.push(index);
            }
            return pages;
        }

        const halfWindow = Math.floor(maxButtons / 2);
        let start = Math.max(0, page - halfWindow);
        let end = Math.min(pageCount - 1, start + maxButtons - 1);
        if (end - start < maxButtons - 1) {
            start = Math.max(0, end - maxButtons + 1);
        }
        for (let index = start; index <= end; index += 1) {
            pages.push(index);
        }
        return pages;
    };

    const pageNumbers = getPageNumbers();

    return (
        <Box sx={{
            display: 'flex',
            alignItems: 'center',
            width: '100%',
            p: 1,
            gap: 2,
            height: '52px',
            minHeight: '52px',
            maxHeight: '52px',
            position: 'relative',
            overflow: 'hidden',
        }}>
            <Box sx={{ flex: '1 1 0', display: 'flex', justifyContent: 'flex-start', minWidth: 0, alignItems: 'center', height: '100%' }}>
                {selectedRowCount > 0 && (
                    <Typography variant="body2" sx={{ whiteSpace: 'nowrap', lineHeight: 1 }}>
                        {selectedRowCount} pass{selectedRowCount !== 1 ? 'es' : ''} selected
                    </Typography>
                )}
            </Box>
            <Box sx={{
                position: 'absolute',
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                gap: 0.5,
                flexWrap: 'nowrap',
                justifyContent: 'center',
                overflow: 'hidden',
                alignItems: 'center',
                height: '100%',
            }}>
                {pageNumbers.map((pageNum) => (
                    <Button
                        key={pageNum}
                        size="small"
                        variant={page === pageNum ? 'contained' : 'outlined'}
                        onClick={() => handlePageChange(pageNum)}
                        sx={{
                            minWidth: isMobile ? '32px' : '40px',
                            px: isMobile ? 0.5 : 1,
                            py: 0.5,
                            height: '32px',
                        }}
                    >
                        {pageNum + 1}
                    </Button>
                ))}
            </Box>
            <Box sx={{ flex: '1 1 0', display: isMedium ? 'none' : 'flex', justifyContent: 'flex-end', minWidth: 0, alignItems: 'center', height: '100%', overflow: 'hidden' }}>
                <Box sx={{ transform: 'scale(0.9)', transformOrigin: 'right center' }}>
                    <GridPagination />
                </Box>
            </Box>
        </Box>
    );
};

const getPassStatus = (row, now) => {
    const startMs = Number(row?.eventStartMs);
    const endMs = Number(row?.eventEndMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        return 'upcoming';
    }
    if (startMs <= now && endMs >= now) return 'live';
    if (endMs < now) return 'passed';
    return 'upcoming';
};

const getStatusPriority = (status) => {
    if (status === 'live') return 0;
    if (status === 'upcoming') return 1;
    if (status === 'passed') return 2;
    return 3;
};

const formatRelativeTime = (isoValue, nowMs, t) => {
    const parsed = new Date(isoValue).getTime();
    if (!Number.isFinite(parsed)) return '-';
    const deltaSec = Math.round((parsed - nowMs) / 1000);
    const absSec = Math.abs(deltaSec);

    if (absSec < 60) return deltaSec >= 0 ? t('time.relative.in_less_than_minute') : t('time.relative.less_than_minute_ago');
    if (absSec < 3600) {
        const minutes = Math.floor(absSec / 60);
        return deltaSec >= 0
            ? t('time.relative.in_minutes', { count: minutes })
            : t('time.relative.minutes_ago', { count: minutes });
    }
    if (absSec < 86400) {
        const hours = Math.floor(absSec / 3600);
        return deltaSec >= 0
            ? t('time.relative.in_hours', { count: hours })
            : t('time.relative.hours_ago', { count: hours });
    }
    const days = Math.floor(absSec / 86400);
    return deltaSec >= 0
        ? t('time.relative.in_days', { count: days })
        : t('time.relative.days_ago', { count: days });
};

const formatAbsoluteTime = (isoValue, timezone, locale) => {
    const parsed = new Date(isoValue);
    if (Number.isNaN(parsed.getTime())) return '-';
    const options = timezone ? { timeZone: timezone } : undefined;
    return parsed.toLocaleString(locale, options);
};

const formatDuration = (seconds, t) => {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value < 0) return '-';
    const whole = Math.round(value);
    const minutes = Math.floor(whole / 60);
    const remainder = whole % 60;
    return t('time.duration.minutes_seconds', { minutes, seconds: String(remainder).padStart(2, '0') });
};

const formatAngle = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return '-';
    return `${numeric.toFixed(2)}°`;
};

const buildTrackingTargetKey = (trackingState = {}) => {
    const targetType = String(
        trackingState?.target_type
        || (trackingState?.command ? 'mission' : (trackingState?.body_id ? 'body' : 'satellite')),
    ).toLowerCase();
    if (targetType === 'body') {
        const bodyId = String(trackingState?.body_id || '').trim().toLowerCase();
        return bodyId ? `body:${bodyId}` : '';
    }
    if (targetType === 'mission') {
        const command = String(trackingState?.command || '').trim();
        return command ? `mission:${command}` : '';
    }
    return '';
};

const PassStatusCell = ({ status, targetNumber = null, t }) => {
    const hasTargetNumber = Number.isFinite(Number(targetNumber)) && Number(targetNumber) > 0;
    const markerSize = 16;
    let statusChip = null;
    if (status === 'live') {
        statusChip = (
            <Chip
                icon={<RadioButtonCheckedIcon sx={{ fontSize: '0.85rem' }} />}
                size="small"
                color="success"
                label={t('passes.status.visible')}
                variant="filled"
                sx={{ fontWeight: 700, minWidth: 85 }}
            />
        );
    } else if (status === 'passed') {
        statusChip = (
            <Chip
                icon={<DoneAllIcon sx={{ fontSize: '0.85rem' }} />}
                size="small"
                color="info"
                label={t('passes.status.passed')}
                variant="filled"
                sx={{ fontWeight: 700, minWidth: 85 }}
            />
        );
    } else {
        statusChip = (
            <Chip
                icon={<AccessTimeFilledIcon sx={{ fontSize: '0.85rem' }} />}
                size="small"
                color="warning"
                label={t('passes.status.upcoming')}
                variant="outlined"
                sx={{ fontWeight: 700, minWidth: 85 }}
            />
        );
    }

    return (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 0.6, width: '100%' }}>
            {statusChip}
            <Box sx={{ minWidth: markerSize + 6, display: 'inline-flex', justifyContent: 'center', alignItems: 'center', flexShrink: 0 }}>
                {hasTargetNumber ? (
                    <TargetNumberIcon
                        targetNumber={targetNumber}
                        prefix="T"
                        size={markerSize}
                        sx={{ filter: 'brightness(1.12)' }}
                    />
                ) : null}
            </Box>
        </Box>
    );
};

const PassesTableSettingsDialog = ({ open, onClose }) => {
    const dispatch = useDispatch();
    const { t } = useTranslation('celestial');
    const columnVisibility = useSelector((state) => state.celestial?.passesTableColumnVisibility || {});
    const pageSize = useSelector((state) => state.celestial?.passesTablePageSize || 10);
    const handleResetValues = useCallback(() => {
        dispatch(resetCelestialPassesTableSettings());
    }, [dispatch]);

    const columns = [
        { name: 'status', label: t('passes.columns.status'), category: 'basic', alwaysVisible: true },
        { name: 'name', label: t('passes.columns.name'), category: 'basic', alwaysVisible: true },
        { name: 'targetType', label: t('passes.columns.type'), category: 'basic' },
        { name: 'peakElevationDeg', label: t('passes.columns.peak_elevation'), category: 'metrics' },
        { name: 'currentElevationDeg', label: t('passes.columns.current_elevation', { defaultValue: 'Current Elevation' }), category: 'metrics' },
        { name: 'progress', label: t('passes.columns.progress'), category: 'basic' },
        { name: 'duration', label: t('passes.columns.duration'), category: 'basic' },
        { name: 'eventStart', label: t('passes.columns.start'), category: 'time' },
        { name: 'eventEnd', label: t('passes.columns.end'), category: 'time' },
        { name: 'startAzimuthDeg', label: t('passes.columns.start_azimuth'), category: 'metrics' },
        { name: 'endAzimuthDeg', label: t('passes.columns.end_azimuth'), category: 'metrics' },
        { name: 'peakAzimuthDeg', label: t('passes.columns.peak_azimuth'), category: 'metrics' },
        { name: 'cacheStatus', label: t('passes.columns.cache'), category: 'source' },
        { name: 'stale', label: t('passes.columns.stale'), category: 'source' },
        { name: 'source', label: t('passes.columns.source'), category: 'source' },
    ];

    const categories = {
        basic: t('passes.settings.categories.basic'),
        time: t('passes.settings.categories.time'),
        metrics: t('passes.settings.categories.metrics'),
        source: t('passes.settings.categories.source'),
    };

    const columnsByCategory = {
        basic: columns.filter((column) => column.category === 'basic'),
        time: columns.filter((column) => column.category === 'time'),
        metrics: columns.filter((column) => column.category === 'metrics'),
        source: columns.filter((column) => column.category === 'source'),
    };

    return (
        <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth PaperProps={{ sx: DIALOG_PAPER_SX }}>
            <DialogTitle sx={DIALOG_TITLE_SX}>{t('passes.settings.title')}</DialogTitle>
            <DialogContent sx={DIALOG_CONTENT_SX}>
                <Box sx={{ mb: 2 }}>
                    <FormControl fullWidth size="small" sx={{ mt: 1 }}>
                        <InputLabel id="celestial-passes-rows-label">{t('passes.settings.rows_per_page')}</InputLabel>
                        <Select
                            labelId="celestial-passes-rows-label"
                            label={t('passes.settings.rows_per_page')}
                            value={pageSize}
                            onChange={(event) => dispatch(setCelestialPassesTablePageSize(event.target.value))}
                        >
                            {[5, 10, 15, 20, 25].map((option) => (
                                <MenuItem key={option} value={option}>
                                    {option}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <Divider sx={{ mt: 2 }} />
                </Box>
                {Object.entries(columnsByCategory).map(([category, items]) => (
                    <Box key={category} sx={{ mb: 2 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1 }}>
                            {categories[category]}
                        </Typography>
                        <FormGroup>
                            {items.map((column) => (
                                <FormControlLabel
                                    key={column.name}
                                    control={(
                                        <Checkbox
                                            checked={column.alwaysVisible || columnVisibility[column.name] !== false}
                                            disabled={column.alwaysVisible}
                                            onChange={() =>
                                                dispatch(
                                                    setCelestialPassesTableColumnVisibility({
                                                        ...columnVisibility,
                                                        [column.name]: columnVisibility[column.name] === false,
                                                    }),
                                                )
                                            }
                                        />
                                    )}
                                    label={column.label}
                                />
                            ))}
                        </FormGroup>
                        <Divider sx={{ mt: 1 }} />
                    </Box>
                ))}
            </DialogContent>
            <DialogActions sx={DIALOG_ACTIONS_SX}>
                <Box sx={FOOTER_ACTION_ROW_SX}>
                    <Button onClick={handleResetValues} variant="outlined">
                        {t('passes.settings.reset_values')}
                    </Button>
                    <Box sx={{ flex: 1, minWidth: 8 }} />
                    <Button onClick={onClose} variant="contained">
                        {t('passes.settings.close')}
                    </Button>
                </Box>
            </DialogActions>
        </Dialog>
    );
};

const CelestialPasses = ({
    passes = [],
    tracks = [],
    loading = false,
    gridEditable = false,
    targetNumberByTargetKey = {},
    onTargetSelected = null,
    onRefresh = null,
    refreshDisabled = false,
}) => {
    const { t } = useTranslation('earthview');
    const { t: tCelestial } = useTranslation('celestial');
    const { t: tSat } = useTranslation('satellites');
    const { socket } = useSocket();
    const dispatch = useDispatch();
    const { requestRotatorForTarget, dialog: rotatorSelectionDialog } = useTargetRotatorSelectionDialog();
    const theme = useTheme();
    const isCompactHeader = useMediaQuery(theme.breakpoints.down('lg'));
    const isTightHeader = useMediaQuery(theme.breakpoints.down('md'));
    const { timezone, locale } = useUserTimeSettings();
    const trackerInstances = useSelector((state) => state.trackerInstances?.instances || []);
    const { trackingState, trackerViews } = useSelector((state) => state.targetSatTrack || {});
    const [quickFilterPreset, setQuickFilterPreset] = useState('all');
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [nowMs, setNowMs] = useState(() => Date.now());
    const [page, setPage] = useState(0);
    const [selectedIds, setSelectedIds] = useState([]);
    const [rowContextMenu, setRowContextMenu] = useState(null);
    const [transmittersDialogOpen, setTransmittersDialogOpen] = useState(false);
    const [transmittersDialogData, setTransmittersDialogData] = useState(null);
    const elevationHistoryByTargetKeyRef = useRef({});
    const columnVisibility = useSelector((state) => state.celestial?.passesTableColumnVisibility || {});
    const pageSize = useSelector((state) => state.celestial?.passesTablePageSize || 10);
    const sortModel = useSelector((state) => state.celestial?.passesTableSortModel || []);
    const rowSelectionModel = useMemo(() => toRowSelectionModel(selectedIds), [selectedIds]);
    const currentlyTrackedTargetKey = useMemo(() => buildTrackingTargetKey(trackingState), [trackingState]);

    useEffect(() => {
        const interval = setInterval(() => setNowMs(Date.now()), 1000);
        return () => clearInterval(interval);
    }, []);

    const trackByTargetKey = useMemo(() => {
        const entries = Array.isArray(tracks) ? tracks : [];
        return entries.reduce((acc, track) => {
            const key = String(track?.target_key || track?.targetKey || '').trim();
            if (key) acc[key] = track;
            return acc;
        }, {});
    }, [tracks]);

    const elevationTrendByTargetKey = useMemo(() => {
        const historyByTargetKey = elevationHistoryByTargetKeyRef.current;
        const nextTrendByTargetKey = {};
        const activeTargetKeys = new Set();
        const entries = Array.isArray(tracks) ? tracks : [];

        entries.forEach((track) => {
            const targetKey = String(track?.target_key || track?.targetKey || '').trim();
            if (!targetKey) return;
            activeTargetKeys.add(targetKey);

            const elevationDeg = Number(track?.sky_position?.el_deg);
            if (!Number.isFinite(elevationDeg)) return;

            const history = updateElevationHistory(historyByTargetKey, targetKey, elevationDeg);
            nextTrendByTargetKey[targetKey] = calculateElevationTrend(history, elevationDeg);
        });

        pruneElevationHistory(historyByTargetKey, activeTargetKeys);
        return nextTrendByTargetKey;
    }, [tracks]);

    const rows = useMemo(() => (passes || []).map((pass) => {
        const eventStartMs = new Date(pass.event_start).getTime();
        const eventEndMs = new Date(pass.event_end).getTime();
        const status = getPassStatus({ eventStartMs, eventEndMs }, nowMs);
        const targetTypeKey = String(pass.target_type || 'mission').toLowerCase() === 'body' ? 'body' : 'mission';
        const normalizedTargetKey = String(pass.target_key || '').trim();
        const track = trackByTargetKey[normalizedTargetKey] || {};
        const derivedIdentifierFromKey = (() => {
            if (!normalizedTargetKey) return '';
            if (normalizedTargetKey.startsWith('body:')) return normalizedTargetKey.slice('body:'.length);
            if (normalizedTargetKey.startsWith('missioncmd:')) return normalizedTargetKey.slice('missioncmd:'.length);
            if (normalizedTargetKey.startsWith('mission:')) return normalizedTargetKey.slice('mission:'.length);
            return '';
        })();
        const missionCommand = String(
            pass.command
            || track.command
            || (normalizedTargetKey.startsWith('missioncmd:') ? normalizedTargetKey.slice('missioncmd:'.length) : '')
            || ''
        ).trim();
        const missionId = String(pass.mission_id || pass.missionId || track.mission_id || track.missionId || '').trim().toLowerCase();
        const bodyId = String(pass.body_id || pass.bodyId || track.body_id || track.bodyId || '').trim().toLowerCase();
        const targetIdentifier = targetTypeKey === 'body'
            ? String(bodyId || pass.target_identifier || derivedIdentifierFromKey || '').trim().toLowerCase()
            : String(
                missionCommand
                || pass.target_identifier
                || missionId
                || derivedIdentifierFromKey
                || ''
            ).trim();
        const rawCurrentElevationDeg = Number(track?.sky_position?.el_deg);
        const currentElevationDeg = Number.isFinite(rawCurrentElevationDeg) ? rawCurrentElevationDeg : null;
        const elevationTrend = elevationTrendByTargetKey[normalizedTargetKey] || {};
        const peakTimeMs = new Date(pass.peak_time).getTime();
        const timeToPeakSeconds = Number.isFinite(peakTimeMs) && peakTimeMs > nowMs
            ? Math.floor((peakTimeMs - nowMs) / 1000)
            : null;
        return {
            id: pass.id || `${pass.target_key || 'target'}_${pass.event_start || ''}`,
            status,
            name: pass.name || '-',
            targetType: targetTypeKey === 'body' ? tCelestial('common.body') : tCelestial('common.mission'),
            targetTypeKey,
            targetKey: pass.target_key || '',
            targetIdentifier,
            command: missionCommand,
            missionId,
            bodyId,
            transmitters: Array.isArray(pass?.transmitters)
                ? pass.transmitters
                : (Array.isArray(track?.transmitters) ? track.transmitters : []),
            peakElevationDeg: Number(pass.peak_elevation_deg),
            currentElevationDeg,
            elevationTrend: elevationTrend.trend || null,
            elevationRate: Number.isFinite(elevationTrend.elRate) ? elevationTrend.elRate : null,
            timeToPeakSeconds,
            eventStart: pass.event_start,
            eventEnd: pass.event_end,
            event_start: pass.event_start,
            event_end: pass.event_end,
            peak_time: pass.peak_time,
            eventStartMs,
            eventEndMs,
            durationSeconds: Number(pass.duration_seconds),
            startAzimuthDeg: Number(pass.start_azimuth_deg),
            endAzimuthDeg: Number(pass.end_azimuth_deg),
            peakAzimuthDeg: Number(pass.peak_azimuth_deg),
            cacheStatus: pass.cache || '-',
            stale: pass.stale ? tCelestial('common.yes') : tCelestial('common.no'),
            source: pass.source || '-',
        };
    }), [passes, nowMs, trackByTargetKey, elevationTrendByTargetKey, tCelestial]);

    const filteredRows = useMemo(() => {
        if (quickFilterPreset === 'live') {
            return rows.filter((row) => row.status === 'live');
        }
        if (quickFilterPreset === 'next30') {
            return rows.filter((row) => {
                if (row.status === 'live') return true;
                if (row.status !== 'upcoming') return false;
                return (row.eventStartMs - nowMs) <= 30 * 60 * 1000;
            });
        }
        if (quickFilterPreset === 'highEl') {
            return [...rows]
                .filter((row) => Number.isFinite(row.peakElevationDeg) && row.peakElevationDeg >= 20)
                .sort((a, b) => b.peakElevationDeg - a.peakElevationDeg);
        }
        return rows;
    }, [rows, quickFilterPreset, nowMs]);

    useEffect(() => {
        const selectedId = selectedIds[0];
        if (!selectedId) return;
        const exists = filteredRows.some((row) => row.id === selectedId);
        if (!exists) {
            setSelectedIds([]);
        }
    }, [filteredRows, selectedIds]);

    const handlePaginationModelChange = useCallback((model) => {
        setPage(model.page);
        if (model.pageSize !== pageSize) {
            dispatch(setCelestialPassesTablePageSize(model.pageSize));
        }
    }, [dispatch, pageSize]);

    const columns = useMemo(() => [
        {
            field: 'status',
            headerName: tCelestial('passes.columns.status'),
            width: 150,
            minWidth: 150,
            align: 'center',
            headerAlign: 'center',
            cellClassName: 'passes-cell-status',
            sortComparator: (v1, v2) => getStatusPriority(v1) - getStatusPriority(v2),
            renderCell: (params) => (
                <Box
                    sx={{
                        width: '100%',
                        height: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    <PassStatusCell
                        status={params.value}
                        t={tCelestial}
                        targetNumber={targetNumberByTargetKey?.[String(params.row?.targetKey || '').trim()] ?? null}
                    />
                </Box>
            ),
        },
        {
            field: 'name',
            headerName: tCelestial('passes.columns.name'),
            minWidth: 150,
            flex: 1.2,
            renderCell: (params) => (
                <Typography
                    component="span"
                    variant="body2"
                    sx={{
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        lineHeight: 1.2,
                    }}
                >
                    {params?.value || '-'}
                </Typography>
            ),
        },
        { field: 'targetType', headerName: tCelestial('passes.columns.type'), minWidth: 90, flex: 0.8 },
        {
            field: 'peakElevationDeg',
            headerName: tCelestial('passes.columns.peak_elevation'),
            width: 90,
            minWidth: 90,
            valueFormatter: (value) => formatAngle(value),
            cellClassName: (params) => {
                const value = Number(params?.value);
                if (!Number.isFinite(value)) return '';
                if (value < 10.0) return 'passes-cell-warning';
                if (value > 45.0) return 'passes-cell-success';
                return '';
            },
        },
        {
            field: 'currentElevationDeg',
            headerName: tCelestial('passes.columns.current_elevation', { defaultValue: 'Current Elevation' }),
            width: 120,
            minWidth: 120,
            align: 'center',
            headerAlign: 'center',
            sortable: false,
            renderCell: (params) => {
                if (params.row?.status !== 'live') {
                    return <span>-</span>;
                }
                return (
                    <ElevationDisplay
                        elevation={params.row?.currentElevationDeg}
                        trend={params.row?.elevationTrend}
                        elRate={params.row?.elevationRate}
                        timeToMaxEl={params.row?.timeToPeakSeconds}
                    />
                );
            },
        },
        {
            field: 'progress',
            headerName: tCelestial('passes.columns.progress'),
            minWidth: 150,
            sortable: false,
            renderCell: (params) => {
                return <ProgressFormatter row={params.row} nowMs={nowMs} />;
            },
        },
        {
            field: 'duration',
            headerName: tCelestial('passes.columns.duration'),
            minWidth: 100,
            valueGetter: (_value, row) => formatDuration(row.durationSeconds, tCelestial),
        },
        {
            field: 'eventStart',
            headerName: tCelestial('passes.columns.start'),
            minWidth: 180,
            renderCell: (params) => (
                <Box sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <Typography component="span" variant="caption" sx={{ fontWeight: 700, color: 'text.primary' }}>
                        {formatRelativeTime(params.value, nowMs, tCelestial)}
                    </Typography>
                    <Typography component="span" className="passes-time-absolute" variant="caption" sx={{ color: 'text.secondary', ml: 0.5 }}>
                        · {formatAbsoluteTime(params.value, timezone, locale)}
                    </Typography>
                </Box>
            ),
        },
        {
            field: 'eventEnd',
            headerName: tCelestial('passes.columns.end'),
            minWidth: 180,
            renderCell: (params) => (
                <Box sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    <Typography component="span" variant="caption" sx={{ fontWeight: 700, color: 'text.primary' }}>
                        {formatRelativeTime(params.value, nowMs, tCelestial)}
                    </Typography>
                    <Typography component="span" className="passes-time-absolute" variant="caption" sx={{ color: 'text.secondary', ml: 0.5 }}>
                        · {formatAbsoluteTime(params.value, timezone, locale)}
                    </Typography>
                </Box>
            ),
        },
        { field: 'startAzimuthDeg', headerName: tCelestial('passes.columns.start_azimuth'), width: 90, minWidth: 90, valueFormatter: (value) => formatAngle(value) },
        { field: 'endAzimuthDeg', headerName: tCelestial('passes.columns.end_azimuth'), width: 90, minWidth: 90, valueFormatter: (value) => formatAngle(value) },
        { field: 'peakAzimuthDeg', headerName: tCelestial('passes.columns.peak_azimuth'), minWidth: 120, valueFormatter: (value) => formatAngle(value) },
        { field: 'cacheStatus', headerName: tCelestial('passes.columns.cache'), width: 90, minWidth: 90 },
        { field: 'stale', headerName: tCelestial('passes.columns.stale'), width: 80, minWidth: 80 },
        { field: 'source', headerName: tCelestial('passes.columns.source'), width: 110, minWidth: 110 },
    ], [nowMs, timezone, locale, targetNumberByTargetKey, tCelestial]);

    const handleQuickPreset = useCallback((preset) => {
        setQuickFilterPreset(preset);
        if (preset === 'highEl') {
            dispatch(setCelestialPassesTableSortModel([
                { field: 'peakElevationDeg', sort: 'desc' },
                { field: 'eventStart', sort: 'asc' },
            ]));
            return;
        }
        dispatch(setCelestialPassesTableSortModel([
            { field: 'status', sort: 'asc' },
            { field: 'eventStart', sort: 'asc' },
        ]));
    }, [dispatch]);

    useEffect(() => {
        const handleKeyboardShortcuts = (event) => {
            if (!event.altKey) return;
            if (event.key === '1') handleQuickPreset('all');
            else if (event.key === '2') handleQuickPreset('live');
            else if (event.key === '3') handleQuickPreset('next30');
            else if (event.key === '4') handleQuickPreset('highEl');
            else return;
            event.preventDefault();
        };
        window.addEventListener('keydown', handleKeyboardShortcuts);
        return () => window.removeEventListener('keydown', handleKeyboardShortcuts);
    }, [handleQuickPreset]);

    const useIconQuickFilters = isCompactHeader;
    const quickFilterButtonSx = useMemo(() => ({
        minHeight: isTightHeader ? 20 : (isCompactHeader ? 22 : 24),
        height: isTightHeader ? 20 : (isCompactHeader ? 22 : 24),
        py: 0,
        px: isTightHeader ? 0.7 : (isCompactHeader ? 0.85 : 1),
        lineHeight: 1.05,
        fontSize: isTightHeader ? '0.64rem' : (isCompactHeader ? '0.68rem' : '0.72rem'),
        minWidth: useIconQuickFilters ? 30 : 'auto',
    }), [isCompactHeader, isTightHeader, useIconQuickFilters]);
    const titleIconButtonSx = useMemo(
        () => ({ p: isTightHeader ? '1px' : '2px' }),
        [isTightHeader]
    );

    const getRowClassName = (params) => {
        const classes = ['pointer-cursor'];
        if (params.row.status === 'live') classes.push('passes-row-live');
        else if (params.row.status === 'passed') classes.push('passes-row-passed');
        if (
            params.row.status === 'upcoming'
            && Number.isFinite(params.row.eventStartMs)
            && (params.row.eventStartMs - nowMs) <= 30 * 60 * 1000
        ) {
            classes.push('passes-row-upcoming-soon');
        }
        return classes.join(' ');
    };

    const copyTextToClipboard = useCallback(async (text) => {
        if (navigator?.clipboard?.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.setAttribute('readonly', '');
        textArea.style.position = 'absolute';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
    }, []);

    const handleCloseRowContextMenu = useCallback(() => {
        setRowContextMenu(null);
    }, []);

    const handleSuppressNativeContextMenu = useCallback((event) => {
        event.preventDefault();
        if (typeof event.stopPropagation === 'function') {
            event.stopPropagation();
        }
        setRowContextMenu(null);
    }, []);

    // Bind context-menu directly on rows for stable behavior across browsers.
    const handleRowContextMenu = useCallback((event) => {
        const rowId = event.currentTarget?.getAttribute?.('data-id');
        if (!rowId) return;
        const row = filteredRows.find((entry) => String(entry?.id) === String(rowId));
        if (!row) return;
        event.preventDefault();
        event.stopPropagation();
        // Match earth-view behavior: a second right-click closes the open menu.
        if (rowContextMenu) {
            setRowContextMenu(null);
            return;
        }
        setSelectedIds([row.id]);
        if (row?.targetKey && onTargetSelected) {
            onTargetSelected(row.targetKey);
        }
        setRowContextMenu({
            mouseX: event.clientX + 2,
            mouseY: event.clientY - 6,
            row,
        });
    }, [filteredRows, onTargetSelected, rowContextMenu]);

    const handleRowMenuAction = useCallback(async (action) => {
        const row = rowContextMenu?.row;
        if (!row) return;
        try {
            if (action === 'set-target') {
                const targetType = row.targetTypeKey === 'body' ? 'body' : 'mission';
                const missionCommand = String(row.command || row.targetIdentifier || '').trim();
                const missionId = String(row.missionId || '').trim().toLowerCase();
                const bodyId = String(row.bodyId || row.targetIdentifier || '').trim().toLowerCase();
                const isTargetable = targetType === 'body' ? Boolean(bodyId) : Boolean(missionCommand);
                if (!socket || !isTargetable) {
                    return;
                }
                const selectedAssignment = await requestRotatorForTarget(row.name || row.targetIdentifier || row.targetKey);
                if (!selectedAssignment) {
                    return;
                }
                const assignmentAction = String(selectedAssignment?.action || 'retarget_current_slot');
                const isCreateNewSlot = assignmentAction === 'create_new_slot';
                const trackerId = String(selectedAssignment?.trackerId || '');
                const rotatorId = String(selectedAssignment?.rotatorId || 'none');
                const assignmentRigId = String(selectedAssignment?.rigId || 'none');
                if (!trackerId) {
                    return;
                }
                const selectedTrackerInstance = trackerInstances.find(
                    (instance) => String(instance?.tracker_id || '') === trackerId
                );
                const selectedTrackerView = trackerViews?.[trackerId] || {};
                const selectedTrackerState = selectedTrackerView?.trackingState || selectedTrackerInstance?.tracking_state || {};
                const nextRigId = isCreateNewSlot
                    ? assignmentRigId
                    : String(
                        selectedTrackerView?.selectedRadioRig
                        ?? selectedTrackerState?.rig_id
                        ?? assignmentRigId
                        ?? 'none'
                    );
                const nextRotatorId = isCreateNewSlot ? 'none' : rotatorId;
                const nextTransmitterId = isCreateNewSlot
                    ? 'none'
                    : String(selectedTrackerState?.transmitter_id || 'none');

                dispatch(setTrackerId(trackerId));
                dispatch(setRotator({ value: nextRotatorId, trackerId }));

                const targetPatch = targetType === 'body'
                    ? {
                        target_type: 'body',
                        target_name: row.name || bodyId,
                        body_id: bodyId,
                        mission_id: null,
                        command: null,
                    }
                    : {
                        target_type: 'mission',
                        target_name: row.name || missionCommand,
                        mission_id: missionId || null,
                        command: missionCommand,
                        body_id: null,
                    };

                const newTrackingState = isCreateNewSlot
                    ? {
                        tracker_id: trackerId,
                        ...targetPatch,
                        norad_id: null,
                        group_id: null,
                        rig_id: nextRigId,
                        rotator_id: nextRotatorId,
                        transmitter_id: 'none',
                        rig_state: 'disconnected',
                        rotator_state: 'disconnected',
                        rig_vfo: 'none',
                        vfo1: 'uplink',
                        vfo2: 'downlink',
                    }
                    : {
                        ...selectedTrackerState,
                        tracker_id: trackerId,
                        ...targetPatch,
                        norad_id: null,
                        group_id: null,
                        rig_id: nextRigId,
                        rotator_id: nextRotatorId,
                        transmitter_id: nextTransmitterId,
                    };

                await dispatch(setTrackingStateInBackend({ socket, data: newTrackingState })).unwrap();
                return;
            }
            if (action === 'edit-transmitters') {
                setTransmittersDialogData({
                    name: row.name || row.targetIdentifier || row.targetKey || '',
                    target_key: row.targetKey || '',
                    transmitters: Array.isArray(row.transmitters) ? row.transmitters : [],
                });
                setTransmittersDialogOpen(true);
                return;
            }
            if (action === 'copy-identifier') {
                await copyTextToClipboard(row.targetIdentifier || '-');
                return;
            }
            if (action === 'copy-target-key') {
                await copyTextToClipboard(row.targetKey || '-');
                return;
            }
            if (action === 'copy-summary') {
                const summary = [
                    row.name || '-',
                    row.targetTypeKey === 'body'
                        ? `${tCelestial('common.body')} ${row.targetIdentifier || '-'}`
                        : `${tCelestial('common.mission')} ${row.targetIdentifier || '-'}`,
                    `${tCelestial('passes.summary.start')} ${row.eventStart || '-'}`,
                    `${tCelestial('passes.summary.end')} ${row.eventEnd || '-'}`,
                ].join(' | ');
                await copyTextToClipboard(summary);
            }
        } catch (error) {
            toast.error(`${t('satellite_info.failed_tracking')}: ${error?.message || error?.error || tCelestial('errors.unknown_error')}`);
        } finally {
            setRowContextMenu(null);
        }
    }, [
        copyTextToClipboard,
        dispatch,
        onTargetSelected,
        requestRotatorForTarget,
        rowContextMenu?.row,
        socket,
        t,
        tCelestial,
        trackerInstances,
        trackerViews,
    ]);

    const rowContextMenuItems = useMemo(() => {
        const row = rowContextMenu?.row;
        if (!row) return [];
        const targetType = row.targetTypeKey === 'body' ? 'body' : 'mission';
        const missionCommand = String(row.command || row.targetIdentifier || '').trim();
        const bodyId = String(row.bodyId || row.targetIdentifier || '').trim().toLowerCase();
        const isTargetable = targetType === 'body' ? Boolean(bodyId) : Boolean(missionCommand);
        const isCurrentlyTargeted = Boolean(row.targetKey) && String(row.targetKey).trim() === currentlyTrackedTargetKey;
        return [
            {
                key: 'set-target',
                label: t('satellites_table.context_menu.set_as_target'),
                disabled: !socket || !isTargetable || isCurrentlyTargeted,
                onClick: () => handleRowMenuAction('set-target'),
            },
            {
                key: 'edit-transmitters',
                label: t('satellites_table.context_menu.edit_transmitters'),
                disabled: !row?.targetKey,
                onClick: () => handleRowMenuAction('edit-transmitters'),
            },
            { type: 'divider', key: 'divider-copy' },
            {
                key: 'copy-identifier',
                label: row.targetTypeKey === 'body'
                    ? tCelestial('context.copy_body_id')
                    : tCelestial('context.copy_mission_command'),
                onClick: () => handleRowMenuAction('copy-identifier'),
            },
            {
                key: 'copy-target-key',
                label: tCelestial('context.copy_target_key'),
                onClick: () => handleRowMenuAction('copy-target-key'),
            },
            {
                key: 'copy-summary',
                label: tCelestial('context.copy_pass_summary'),
                onClick: () => handleRowMenuAction('copy-summary'),
            },
        ];
    }, [currentlyTrackedTargetKey, handleRowMenuAction, rowContextMenu?.row, socket, t, tCelestial]);

    return (
        <>
            {rotatorSelectionDialog}
            <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <TitleBar
                className={getClassNamesBasedOnGridEditing(gridEditable, ['window-title-bar'])}
                sx={islandTitleBarCompactSx}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', height: '100%' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: 1 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 700, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {tCelestial('passes.title')}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                            ({rows.length} {rows.length === 1
                                ? tCelestial('passes.count_label_single')
                                : tCelestial('passes.count_label_plural')})
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                        <Tooltip title={tCelestial('passes.quick_filters.all_tooltip')}>
                            <span>
                                <Button
                                    size="small"
                                    variant={quickFilterPreset === 'all' ? 'contained' : 'outlined'}
                                    onClick={() => handleQuickPreset('all')}
                                    sx={quickFilterButtonSx}
                                    aria-label={tCelestial('passes.quick_filters.all_aria')}
                                >
                                    {useIconQuickFilters ? <DoneAllIcon sx={{ fontSize: isTightHeader ? '0.82rem' : '0.9rem' }} /> : tCelestial('passes.quick_filters.all_short')}
                                </Button>
                            </span>
                        </Tooltip>
                        <Tooltip title={tCelestial('passes.quick_filters.live_tooltip')}>
                            <span>
                                <Button
                                    size="small"
                                    variant={quickFilterPreset === 'live' ? 'contained' : 'outlined'}
                                    onClick={() => handleQuickPreset('live')}
                                    sx={quickFilterButtonSx}
                                    aria-label={tCelestial('passes.quick_filters.live_aria')}
                                >
                                    {useIconQuickFilters ? <RadioButtonCheckedIcon sx={{ fontSize: isTightHeader ? '0.82rem' : '0.9rem' }} /> : tCelestial('passes.quick_filters.live_short')}
                                </Button>
                            </span>
                        </Tooltip>
                        <Tooltip title={tCelestial('passes.quick_filters.next_30_tooltip')}>
                            <span>
                                <Button
                                    size="small"
                                    variant={quickFilterPreset === 'next30' ? 'contained' : 'outlined'}
                                    onClick={() => handleQuickPreset('next30')}
                                    sx={quickFilterButtonSx}
                                    aria-label={tCelestial('passes.quick_filters.next_30_aria')}
                                >
                                    {useIconQuickFilters ? <AccessTimeFilledIcon sx={{ fontSize: isTightHeader ? '0.82rem' : '0.9rem' }} /> : tCelestial('passes.quick_filters.next_30_short')}
                                </Button>
                            </span>
                        </Tooltip>
                        <Tooltip title={tCelestial('passes.quick_filters.highest_elevation_tooltip')}>
                            <span>
                                <Button
                                    size="small"
                                    variant={quickFilterPreset === 'highEl' ? 'contained' : 'outlined'}
                                    onClick={() => handleQuickPreset('highEl')}
                                    sx={quickFilterButtonSx}
                                    aria-label={tCelestial('passes.quick_filters.highest_elevation_aria')}
                                >
                                    {useIconQuickFilters ? <ArrowUpwardRoundedIcon sx={{ fontSize: isTightHeader ? '0.82rem' : '0.9rem' }} /> : tCelestial('passes.quick_filters.high_el_short')}
                                </Button>
                            </span>
                        </Tooltip>
                        <Tooltip title={tCelestial('passes.table_settings')}>
                            <span>
                                <IconButton size="small" onClick={() => setSettingsOpen(true)} sx={titleIconButtonSx}>
                                    <SettingsIcon fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>
                        <Tooltip title={tCelestial('passes.refresh')}>
                            <span>
                                <IconButton
                                    size="small"
                                    onClick={onRefresh}
                                    disabled={refreshDisabled || !onRefresh}
                                    sx={titleIconButtonSx}
                                >
                                    <RefreshIcon fontSize="small" />
                                </IconButton>
                            </span>
                        </Tooltip>
                    </Box>
                </Box>
            </TitleBar>
            <Box sx={{ flex: 1, minHeight: 0 }}>
                <StyledDataGrid
                    rows={filteredRows}
                    columns={columns}
                    loading={loading}
                    slotProps={{
                        row: {
                            onContextMenu: handleRowContextMenu,
                        },
                    }}
                    disableMultipleRowSelection
                    pageSizeOptions={[5, 10, 15, 20, 25]}
                    paginationModel={{ pageSize, page }}
                    onPaginationModelChange={handlePaginationModelChange}
                    rowSelectionModel={rowSelectionModel}
                    onRowSelectionModelChange={(model) => {
                        const ids = toSelectedIds(model);
                        const selectedId = ids.length ? ids[0] : null;
                        setSelectedIds(selectedId ? [selectedId] : []);
                        if (!selectedId || !onTargetSelected) return;
                        const selectedRow = filteredRows.find((row) => row.id === selectedId);
                        if (selectedRow?.targetKey) {
                            onTargetSelected(selectedRow.targetKey);
                        }
                    }}
                    sortModel={sortModel}
                    onSortModelChange={(model) => dispatch(setCelestialPassesTableSortModel(model))}
                    columnVisibilityModel={columnVisibility}
                    onColumnVisibilityModelChange={(model) => dispatch(setCelestialPassesTableColumnVisibility(model))}
                    getRowClassName={getRowClassName}
                    slots={{
                        pagination: CustomPagination,
                    }}
                    density="compact"
                    sx={{
                        border: 0,
                        marginTop: 0,
                        [`& .${gridClasses.cell}:focus, & .${gridClasses.cell}:focus-within`]: {
                            outline: 'none',
                        },
                        [`& .${gridClasses.columnHeader}:focus, & .${gridClasses.columnHeader}:focus-within`]: {
                            outline: 'none',
                        },
                        '& .MuiDataGrid-overlay': {
                            fontSize: '0.875rem',
                            fontStyle: 'italic',
                            color: 'text.secondary',
                        },
                        '& .MuiDataGrid-selectedRowCount': {
                            visibility: 'hidden',
                            position: 'absolute',
                        },
                    }}
                />
            </Box>
            <CelestialContextMenu
                open={Boolean(rowContextMenu)}
                onClose={handleCloseRowContextMenu}
                onSuppressNativeContextMenu={handleSuppressNativeContextMenu}
                anchorPosition={
                    rowContextMenu
                        ? { top: rowContextMenu.mouseY, left: rowContextMenu.mouseX }
                        : undefined
                }
                title={rowContextMenu?.row?.name || '-'}
                targetType={rowContextMenu?.row?.targetTypeKey || 'mission'}
                targetIdentifier={rowContextMenu?.row?.targetIdentifier || '-'}
                items={rowContextMenuItems}
            />
            <TransmittersDialog
                open={transmittersDialogOpen}
                onClose={() => setTransmittersDialogOpen(false)}
                title={tSat('satellite_database.edit_transmitters_title', {
                    name: transmittersDialogData?.name || rowContextMenu?.row?.name || '',
                })}
                satelliteData={transmittersDialogData}
                variant="paper"
                widthOffsetPx={20}
            />
            <PassesTableSettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
            </Box>
        </>
    );
};

export default React.memo(CelestialPasses);
