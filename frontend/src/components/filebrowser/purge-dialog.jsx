/**
 * @license
 * Copyright (c) 2026 Efstratios Goudelis
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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    Box,
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    InputLabel,
    LinearProgress,
    MenuItem,
    Select,
    Stack,
    Tooltip,
    Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useTranslation } from 'react-i18next';
import moment from 'moment-timezone';
import { toast } from 'react-toastify';
import { fetchPurgePreview, startLibraryPurge, clearPurgeState } from './filebrowser-slice.jsx';
import PurgeSlider from './purge-slider.jsx';
import { FILE_TYPES } from './file-types.js';

// Stable per-category colors shared between the stacked bar and the legend.
const PURGE_CATEGORIES = [
    { key: 'observation', color: '#7e57c2' },
    { key: 'decoded_folder', color: '#26a69a' },
    { key: 'recording', color: '#42a5f5' },
    { key: 'snapshot', color: '#ec407a' },
    { key: 'decoded', color: '#ffa726' },
    { key: 'audio', color: '#66bb6a' },
    { key: 'transcription', color: '#8d6e63' },
];

function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return `${Math.round(bytes / Math.pow(k, i) * 100) / 100} ${sizes[i]}`;
}

const PurgeDialog = ({ open, onClose, socket }) => {
    const dispatch = useDispatch();
    const { t } = useTranslation('filebrowser');
    const purge = useSelector((state) => state.filebrowser.purge);
    // Cutoff lives as local epoch ms; null until the first preview reports the
    // real age span of the library.
    const [cutoff, setCutoff] = useState(null);
    // Keep thumb movement local until release; previews use the committed cutoff.
    const [draftCutoff, setDraftCutoff] = useState(null);
    const adjustingCutoff = draftCutoff !== null;
    const sliderCutoff = draftCutoff ?? cutoff;
    const [itemType, setItemType] = useState('all');
    const [confirmOpen, setConfirmOpen] = useState(false);
    // Bumped on every socket 'connect' so an open dialog that was opened
    // while the socket was still reconnecting fetches as soon as it is live.
    const [connectEpoch, setConnectEpoch] = useState(0);
    const debouncedPreview = useRef(null);
    // A result retained from a previous visit is history, not a new completion.
    const lastDone = useRef(purge.done);
    const lastPreviewDone = useRef(purge.done);
    // Render the same slider footprint before a real library age range arrives.
    const fallbackDomain = useRef({
        min: Date.now() - 365 * 86400000,
        max: Date.now(),
    });

    useEffect(() => {
        if (!socket) return undefined;
        const onConnect = () => setConnectEpoch((epoch) => epoch + 1);
        socket.on('connect', onConnect);
        return () => socket.off('connect', onConnect);
    }, [socket]);

    // Refresh the date range when opening, changing type, or reconnecting.
    useEffect(() => {
        if (!open) return undefined;
        if (socket && !socket.connected) return undefined;
        setCutoff(null);
        setDraftCutoff(null);
        setConfirmOpen(false);
        dispatch(clearPurgeState());
        dispatch(fetchPurgePreview({ socket, cutoff: new Date().toISOString(), itemType }));
        return undefined;
    }, [open, socket, connectEpoch, itemType, dispatch]);

    // Never use the previous type's totals or date range while a new preview loads.
    const selectedPreview = (purge.preview?.itemType || 'all') === itemType ? purge.preview : null;

    const domain = useMemo(() => {
        const oldestRaw = selectedPreview?.oldest;
        if (!oldestRaw) return null;
        const oldest = new Date(oldestRaw).getTime();
        if (!Number.isFinite(oldest)) return null;
        const newest = selectedPreview?.newest ? new Date(selectedPreview.newest).getTime() : Date.now();
        return { min: oldest, max: Math.max(Number.isFinite(newest) ? newest : Date.now(), Date.now()) };
    }, [selectedPreview]);

    // The oldest cutoff is the slider's rightmost edge. Use it on opening and
    // when a completed sweep changes the library's available date range.
    useEffect(() => {
        if (domain && (cutoff === null || cutoff < domain.min || cutoff > domain.max)) {
            setCutoff(domain.min);
        }
    }, [cutoff, domain]);

    // Preview only a released value, even if the user pauses mid-drag.
    useEffect(() => {
        if (!open || cutoff === null || adjustingCutoff || purge.running || !socket?.connected) return undefined;
        if (debouncedPreview.current) clearTimeout(debouncedPreview.current);
        debouncedPreview.current = setTimeout(() => {
            dispatch(fetchPurgePreview({ socket, cutoff: new Date(cutoff).toISOString(), itemType }));
        }, 250);
        return () => {
            if (debouncedPreview.current) clearTimeout(debouncedPreview.current);
        };
    }, [open, cutoff, adjustingCutoff, itemType, purge.running, socket, dispatch]);

    const cutoffIso = cutoff !== null ? new Date(cutoff).toISOString() : null;
    // Ignore the bootstrap preview (cutoff = now) until the slider settles.
    const usablePreview = !purge.previewError && selectedPreview && cutoff !== null
        && new Date(selectedPreview.cutoff).getTime() === cutoff
        ? selectedPreview
        : null;
    const running = purge.running;
    const done = purge.done;
    const progress = purge.progress;
    const previewError = purge.previewError;
    // Opening needs a domain preview followed by the selected-cutoff preview.
    // Keep the overlay mounted between those requests so it does not flash twice.
    const busy = running || (!adjustingCutoff && (purge.previewLoading
        || (socket?.connected && !!domain && !usablePreview && !previewError)));

    const retryPreview = () => {
        if (!socket?.connected) return;
        dispatch(fetchPurgePreview({ socket, cutoff: cutoffIso || new Date().toISOString(), itemType }));
    };

    const previewErrorBlock = (
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Typography variant="body2" color="error.main">
                {previewError || t('purge_dialog.failed', { defaultValue: 'Purge failed' })}
            </Typography>
            <Button size="small" onClick={retryPreview}>
                {t('purge_dialog.retry', { defaultValue: 'Retry' })}
            </Button>
        </Stack>
    );

    // One terminal toast per purge, including sweeps that finish while this
    // dialog sits closed or another client started the purge.
    useEffect(() => {
        if (done === lastDone.current) return;
        lastDone.current = done;
        if (!done) return;
        if (done.success) {
            if (done.deleted > 0) {
                toast.success(t('purge_dialog.result_toast', {
                    count: done.deleted,
                    bytes: formatBytes(done.bytesFreed),
                    defaultValue: 'Purged {{count}} items, freed {{bytes}}',
                }));
            }
        } else {
            toast.error(done.error || t('purge_dialog.failed', { defaultValue: 'Purge failed' }));
        }
    }, [done, t]);

    // A finished sweep changes the available date range. Start a fresh preview
    // so the same open dialog can select and purge the remaining files.
    useEffect(() => {
        const previousDone = lastPreviewDone.current;
        lastPreviewDone.current = done;
        // Opening and type changes already request a preview. Only a new
        // completion should trigger this additional refresh.
        if (!open || !done || done === previousDone || !socket?.connected) return;
        setCutoff(null);
        setDraftCutoff(null);
        dispatch(fetchPurgePreview({ socket, cutoff: new Date().toISOString(), itemType }));
    }, [open, done, socket, itemType, dispatch]);

    const startPurge = async () => {
        if (!usablePreview || busy || adjustingCutoff || totalItems === 0) return;
        setConfirmOpen(false);
        try {
            await dispatch(startLibraryPurge({ socket, cutoff: cutoffIso, itemType })).unwrap();
        } catch (error) {
            toast.error(String(error?.message || error));
        }
    };

    const totalItems = usablePreview?.items ?? 0;
    const totalBytes = usablePreview?.bytes ?? 0;
    // An empty library has no age domain but does have a real zero-valued preview.
    const summaryPreview = previewError
        ? null
        : usablePreview || (!domain && selectedPreview?.items === 0 ? selectedPreview : null);
    const selectedType = FILE_TYPES.find((type) => type.itemType === itemType);
    const typeLabel = selectedType
        ? t(selectedType.label, selectedType.fallback)
        : t('purge_dialog.all_types', { defaultValue: 'All' });
    const displayItems = summaryPreview?.items;
    const displayFiles = summaryPreview?.files;
    const displayBytes = summaryPreview?.bytes;
    const distribution = PURGE_CATEGORIES.map((category) => ({
        ...category,
        items: summaryPreview?.categories?.[category.key]?.items ?? (summaryPreview ? 0 : null),
        bytes: summaryPreview?.categories?.[category.key]?.bytes ?? (summaryPreview ? 0 : null),
    }));
    const activeDistribution = distribution.filter((category) => category.items > 0);
    const sliderDomain = domain || fallbackDomain.current;
    const protectionText = !summaryPreview
        ? '—'
        : summaryPreview.skippedInProgress > 0
            ? t('purge_dialog.protected', {
                count: summaryPreview.skippedInProgress,
                defaultValue: '{{count}} in-progress items are protected from deletion.',
            })
            : t('purge_dialog.none_protected', {
                defaultValue: 'No in-progress items in the selected date range.',
            });
    const resultText = done?.success
        ? t('purge_dialog.result_message', {
            count: done.deleted,
            files: done.files,
            bytes: formatBytes(done.bytesFreed),
            defaultValue: 'Deleted {{count}} items ({{files}} files, including metadata files), freed {{bytes}}.',
        })
        : done ? done.error || t('purge_dialog.failed', { defaultValue: 'Purge failed' }) : '—';
    const failedText = done?.failed?.length > 0 ? t('purge_dialog.failed_count', {
        count: done.failed.length,
        defaultValue: '{{count}} items could not be deleted.',
    }) : '';
    const statusText = running
        ? [
            `${progress?.done ?? 0} / ${progress?.total ?? 0}`,
            t('purge_dialog.freed_so_far', {
                bytes: formatBytes(progress?.bytesFreed ?? 0),
                defaultValue: '{{bytes}} freed so far',
            }),
            progress?.current ? t('purge_dialog.removing', {
                name: progress.current,
                defaultValue: 'Removing {{name}}...',
            }) : null,
        ].filter(Boolean).join(' · ')
        : done ? [resultText, failedText].filter(Boolean).join(' ') : '—';

    return (
        <>
            <Dialog
                open={open}
                onClose={running ? undefined : onClose}
                maxWidth="sm"
                fullWidth
                slotProps={{ paper: { sx: { position: 'relative' } } }}
            >
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <DeleteForeverIcon fontSize="small" color="action" />
                    {t('purge_dialog.title', { defaultValue: 'Purge old files' })}
                </DialogTitle>
                <DialogContent dividers>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                        {t('purge_dialog.description', {
                            defaultValue: 'Choose an item type and drag the marker to a date. Matching items last used before it are permanently removed from disk. Observation bundles and multi-file decoded products each count as a single item.',
                        })}
                    </Typography>

                    <Stack spacing={2}>
                        <FormControl size="small" fullWidth disabled={running}>
                            <InputLabel id="purge-item-type-label">
                                {t('purge_dialog.item_type', { defaultValue: 'Item type' })}
                            </InputLabel>
                            <Select
                                labelId="purge-item-type-label"
                                value={itemType}
                                label={t('purge_dialog.item_type', { defaultValue: 'Item type' })}
                                onChange={(event) => setItemType(event.target.value)}
                            >
                                <MenuItem value="all">{t('purge_dialog.all_types', { defaultValue: 'All' })}</MenuItem>
                                {FILE_TYPES.map((type) => (
                                    <MenuItem key={type.itemType} value={type.itemType}>
                                        {t(type.label, type.fallback)}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <PurgeSlider
                            value={domain && sliderCutoff !== null && sliderCutoff >= domain.min && sliderCutoff <= domain.max
                                ? sliderCutoff
                                : sliderDomain.min}
                            min={sliderDomain.min}
                            max={sliderDomain.max}
                            olderLabel={t('purge_dialog.delete_before', { defaultValue: 'Delete before' })}
                            nowLabel={t('purge_dialog.now', { defaultValue: 'now' })}
                            cutoffText={sliderCutoff !== null ? moment(sliderCutoff).format('D MMM YYYY HH:mm') : '--'}
                            showDates={!!domain}
                            disabled={!domain || running || !!previewError}
                            onChange={setDraftCutoff}
                            onChangeCommitted={(next) => {
                                setDraftCutoff(null);
                                setCutoff(next);
                            }}
                        />
                        <Stack direction="row" alignItems="baseline" spacing={1} flexWrap="wrap">
                            <Typography variant="h5" color="error.main" fontWeight={700}>
                                {displayItems == null ? '—' : displayItems.toLocaleString()}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                                {t('purge_dialog.items_files', {
                                    files: displayFiles == null ? '—' : displayFiles.toLocaleString(),
                                    defaultValue: 'items will be deleted ({{files}} files, including metadata files)',
                                })}
                            </Typography>
                            <Box sx={{ flexGrow: 1 }} />
                            <Tooltip title={t('purge_dialog.frees', { defaultValue: 'Space freed' })}>
                                <Typography variant="body2" fontFamily="monospace" fontWeight={700}>
                                    {displayBytes == null ? '—' : formatBytes(displayBytes)}
                                </Typography>
                            </Tooltip>
                        </Stack>
                        <Box>
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                {t('purge_dialog.distribution', { defaultValue: 'Composition' })}
                            </Typography>
                            <Box
                                sx={{
                                    display: 'flex',
                                    height: 10,
                                    borderRadius: 1,
                                    overflow: 'hidden',
                                    bgcolor: (theme) => alpha(theme.palette.text.primary, 0.08),
                                }}
                            >
                                {activeDistribution.map((category) => (
                                    <Tooltip
                                        key={category.key}
                                        title={`${t(`purge_dialog.categories.${category.key}`, { defaultValue: category.key })}: ${category.items} (${formatBytes(category.bytes)})`}
                                    >
                                        <Box
                                            sx={{
                                                width: `${(category.items / displayItems) * 100}%`,
                                                bgcolor: category.color,
                                            }}
                                        />
                                    </Tooltip>
                                ))}
                            </Box>
                            <Stack direction="row" flexWrap="wrap" sx={{ mt: 1, columnGap: 2, rowGap: 0.5 }}>
                                {distribution.map((category) => (
                                    <Stack
                                        key={`legend-${category.key}`}
                                        direction="row"
                                        spacing={0.5}
                                        alignItems="center"
                                        sx={{
                                            position: 'relative',
                                            '&:not(:last-child)::after': {
                                                content: '""',
                                                position: 'absolute',
                                                right: '-8px',
                                                top: '50%',
                                                transform: 'translateY(-50%)',
                                                width: '1px',
                                                height: 12,
                                                bgcolor: 'divider',
                                            },
                                        }}
                                    >
                                        <Box sx={{
                                            width: 12,
                                            height: 12,
                                            bgcolor: category.color,
                                            flexShrink: 0,
                                            transform: 'translateY(-1px)',
                                        }} />
                                        <Typography variant="caption" color="text.secondary">
                                            {t(`purge_dialog.categories.${category.key}`, { defaultValue: category.key })}
                                            {' '}
                                            <Box component="span" sx={{ fontFamily: 'monospace', fontWeight: 700 }}>
                                                {category.items == null ? '—' : category.items}
                                            </Box>
                                        </Typography>
                                    </Stack>
                                ))}
                            </Stack>
                        </Box>
                        <Typography
                            variant="caption"
                            color={summaryPreview?.skippedInProgress > 0 ? 'warning.main' : 'text.secondary'}
                            noWrap
                            title={protectionText}
                            sx={{ height: 20, lineHeight: '20px' }}
                        >
                            {protectionText}
                        </Typography>
                        {previewError && previewErrorBlock}
                        {/* Keep one status line in place as the sweep starts and finishes. */}
                        <Stack spacing={0.75} sx={{ mt: 0.5, opacity: running || done ? 1 : 0.5 }} aria-disabled={!running && !done}>
                            <LinearProgress
                                variant="determinate"
                                value={done ? 100 : progress && progress.total
                                    ? Math.round((progress.done / progress.total) * 100) : 0}
                                aria-label={t('purge_dialog.progress', { defaultValue: 'Deletion progress' })}
                            />
                            <Typography
                                variant="body2"
                                color={done && !done.success ? 'error.main' : failedText ? 'warning.main' : 'text.secondary'}
                                title={statusText}
                                sx={{
                                    height: 40,
                                    lineHeight: '20px',
                                    display: '-webkit-box',
                                    WebkitBoxOrient: 'vertical',
                                    WebkitLineClamp: 2,
                                    overflow: 'hidden',
                                }}
                            >
                                {statusText}
                            </Typography>
                        </Stack>
                    </Stack>
                </DialogContent>
                <DialogActions sx={{ px: 3, py: 2 }}>
                    <Button onClick={onClose} color="inherit" disabled={running}>
                        {done ? t('purge_dialog.close', { defaultValue: 'Close' }) : t('common:cancel', { defaultValue: 'Cancel' })}
                    </Button>
                    <Button
                        variant="contained"
                        color="error"
                        startIcon={<DeleteForeverIcon />}
                        disabled={!usablePreview || totalItems === 0 || busy || adjustingCutoff}
                        onClick={() => setConfirmOpen(true)}
                    >
                        {t('purge_dialog.purge', { defaultValue: 'Purge' })}
                    </Button>
                </DialogActions>
                {busy && (
                    <Box
                        sx={{
                            position: 'absolute',
                            inset: 0,
                            zIndex: 1,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            borderRadius: 'inherit',
                            bgcolor: (theme) => alpha(theme.palette.background.paper, 0.72),
                            pointerEvents: running ? 'auto' : 'none',
                        }}
                    >
                        <CircularProgress
                            color="error"
                            aria-label={running
                                ? t('purge_dialog.purge', { defaultValue: 'Purge' })
                                : t('purge_dialog.loading', { defaultValue: 'Scanning the library...' })}
                        />
                    </Box>
                )}
            </Dialog>

            <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle
                    sx={{
                        bgcolor: 'error.main',
                        color: 'error.contrastText',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        fontWeight: 700,
                    }}
                >
                    <WarningAmberIcon fontSize="small" />
                    {t('purge_dialog.confirm_title', {
                        count: totalItems,
                        defaultValue: 'Purge {{count}} items?',
                    })}
                </DialogTitle>
                <DialogContent dividers>
                    <Typography variant="body2">
                        {t('purge_dialog.confirm_message', {
                            type: typeLabel,
                            date: cutoff !== null ? moment(cutoff).format('D MMM YYYY HH:mm') : '',
                            bytes: formatBytes(totalBytes),
                            defaultValue: 'Item type: {{type}}. Matching items last used before {{date}} will be deleted from disk, freeing about {{bytes}}. This cannot be undone.',
                        })}
                    </Typography>
                </DialogContent>
                <DialogActions sx={{ px: 3, py: 2 }}>
                    <Button onClick={() => setConfirmOpen(false)} color="inherit">
                        {t('common:cancel', { defaultValue: 'Cancel' })}
                    </Button>
                    <Button variant="contained" color="error" onClick={startPurge} disabled={!usablePreview || totalItems === 0 || busy || adjustingCutoff}>
                        {t('common:delete', { defaultValue: 'Delete' })}
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};

export default PurgeDialog;
