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

import React, { useState } from 'react';
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Alert,
    AlertTitle,
    Box,
    Typography,
    Radio,
    RadioGroup,
    FormControlLabel,
    Divider,
    Chip,
    Stack,
} from '@mui/material';
import { Warning as WarningIcon, CheckCircle as CheckCircleIcon } from '@mui/icons-material';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { formatTime } from '../../utils/date-time.js';
import { useTranslation } from 'react-i18next';

const RegenerationPreviewDialog = ({ open, onClose, previewData, onConfirm }) => {
    const { t } = useTranslation('common');
    const [conflictChoices, setConflictChoices] = useState({});
    const { timezone, locale } = useUserTimeSettings();

    if (!previewData) return null;

    const conflicts = previewData.conflicting_passes || previewData.conflicts || [];
    const noConflicts = previewData.no_conflict_passes || previewData.no_conflicts || [];
    const { current_strategy = 'priority' } = previewData;

    const handleConflictChoice = (conflictId, action) => {
        setConflictChoices(prev => ({
            ...prev,
            [conflictId]: action
        }));
    };

    const handleApplyStrategy = () => {
        // Reset to strategy defaults
        setConflictChoices({});
    };

    const handleConfirm = () => {
        onConfirm(conflictChoices);
    };
    const timeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false };
    const formatRange = (start, end) => {
        return `${formatTime(start, { timezone, locale, options: timeFormatOptions })} - ${formatTime(end, { timezone, locale, options: timeFormatOptions })}`;
    };

    const getStrategyDescription = () => {
        switch (current_strategy) {
            case 'priority':
                return 'Highest elevation passes are kept';
            case 'skip':
                return 'All resource-conflicting passes are skipped';
            case 'force':
                return 'All passes are scheduled (allows overlaps)';
            default:
                return 'Unknown strategy';
        }
    };

    const hasConflicts = conflicts.length > 0;
    const totalPasses = conflicts.length + noConflicts.length;

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="md"
            fullWidth
        >
            <DialogTitle sx={!hasConflicts ? {
                bgcolor: (theme) => theme.palette.mode === 'dark'
                    ? 'rgba(46, 125, 50, 0.08)'
                    : 'rgba(46, 125, 50, 0.04)',
            } : {}}>
                {t('regeneration_preview_dialog.regeneration_preview', { defaultValue: 'Regeneration Preview' })}
            </DialogTitle>

            <DialogContent
                sx={{
                    bgcolor: (theme) => (
                        theme.palette.mode === 'dark'
                            ? theme.palette.background.elevated
                            : theme.palette.background.paper
                    ),
                }}
            >
                <Alert severity={!hasConflicts ? "success" : "info"} sx={{ mb: 2 }}>
                    <AlertTitle>
                        {!hasConflicts ? "No Conflicts - Ready to Generate" : `Auto-generation Strategy: ${current_strategy.toUpperCase()}`}
                    </AlertTitle>
                    {!hasConflicts ? (
                        <>{t('regeneration_preview_dialog.all_passes_can_be_scheduled_without_conflicts_click_conf', { defaultValue: 'All passes can be scheduled without conflicts. Click "Confirm & Generate" to proceed.' })}</>
                    ) : (
                        <>
                            {getStrategyDescription()}
                            <br />
                            <strong>{t('regeneration_preview_dialog.changes_here_apply_only_to_this_regeneration', { defaultValue: 'Changes here apply ONLY to this regeneration.' })}</strong>
                        </>
                    )}
                </Alert>

                {/* Summary */}
                <Box sx={{ mb: 3 }}>
                    <Typography variant="h6" gutterBottom>
                        {t('regeneration_preview_dialog.summary', { defaultValue: 'Summary' })}
                    </Typography>
                    <Stack direction="row" spacing={2}>
                        <Chip
                            label={`${totalPasses} Total Passes`}
                            color="primary"
                            variant="outlined"
                        />
                        {hasConflicts && (
                            <Chip
                                label={`${conflicts.length} Conflicts`}
                                color="warning"
                                icon={<WarningIcon />}
                            />
                        )}
                        {noConflicts.length > 0 && (
                            <Chip
                                label={`${noConflicts.length} No Conflicts`}
                                color="success"
                                icon={<CheckCircleIcon />}
                            />
                        )}
                    </Stack>
                </Box>

                {/* No Conflicts Section */}
                {noConflicts.length > 0 && (
                    <Box sx={{ mb: 3 }}>
                        <Typography variant="h6" gutterBottom>
                            {t('regeneration_preview_dialog.passes_without_conflicts', { defaultValue: 'Passes Without Conflicts (' })}{noConflicts.length})
                        </Typography>
                        <Box sx={{
                            maxHeight: 150,
                            overflowY: 'auto',
                            border: '1px solid',
                            borderColor: 'success.main',
                            borderRadius: 1,
                            bgcolor: (theme) => theme.palette.mode === 'dark'
                                ? 'rgba(46, 125, 50, 0.08)'
                                : 'rgba(46, 125, 50, 0.04)',
                        }}>
                            <Box sx={{
                                display: 'grid',
                                gridTemplateColumns: '2fr 1fr 2fr',
                                gap: 1,
                                p: 1,
                                borderBottom: '1px solid',
                                borderColor: 'divider',
                                bgcolor: (theme) => theme.palette.mode === 'dark'
                                    ? 'rgba(0, 0, 0, 0.2)'
                                    : 'rgba(0, 0, 0, 0.05)',
                            }}>
                                <Typography variant="caption" fontWeight="bold">{t('regeneration_preview_dialog.satellite', { defaultValue: 'Satellite' })}</Typography>
                                <Typography variant="caption" fontWeight="bold">{t('regeneration_preview_dialog.elevation', { defaultValue: 'Elevation' })}</Typography>
                                <Typography variant="caption" fontWeight="bold">{t('regeneration_preview_dialog.time', { defaultValue: 'Time' })}</Typography>
                            </Box>
                            {noConflicts.map((pass, idx) => (
                                <Box
                                    key={idx}
                                    sx={{
                                        display: 'grid',
                                        gridTemplateColumns: '2fr 1fr 2fr',
                                        gap: 1,
                                        p: 1,
                                        borderBottom: idx < noConflicts.length - 1 ? '1px solid' : 'none',
                                        borderColor: 'divider',
                                        '&:hover': {
                                            bgcolor: (theme) => theme.palette.mode === 'dark'
                                                ? 'rgba(255, 255, 255, 0.05)'
                                                : 'rgba(0, 0, 0, 0.02)',
                                        }
                                    }}
                                >
                                    <Typography variant="body2" color="text.secondary">
                                        {pass.satellite}
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {pass.elevation.toFixed(1)}°
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {pass.time_window}
                                    </Typography>
                                </Box>
                            ))}
                        </Box>
                    </Box>
                )}

                {/* Conflicts Section */}
                {hasConflicts && (
                    <Box>
                        <Typography variant="h6" gutterBottom>
                            {t('regeneration_preview_dialog.conflicts_detected', { defaultValue: 'Conflicts Detected (' })}{conflicts.length})
                        </Typography>

                        {conflicts.map((conflict, idx) => {
                            const passId = conflict.pass_id;
                            const userChoice = conflictChoices[passId];
                            const effectiveAction = userChoice || conflict.strategy_action;
                            const blockers = conflict.blockers || [];
                            const conflictReasons = Array.from(
                                new Set(blockers.flatMap((blocker) => blocker.reasons || []))
                            );
                            const isReplace = effectiveAction === 'replace_blockers';

                            return (
                                <Box
                                    key={idx}
                                    sx={{
                                        mb: 2,
                                        p: 2,
                                        border: '1px solid',
                                        borderColor: 'warning.main',
                                        borderRadius: 1,
                                        bgcolor: 'background.paper',
                                    }}
                                >
                                    <Stack
                                        direction={{ xs: 'column', sm: 'row' }}
                                        spacing={1}
                                        sx={{ mb: 1.2 }}
                                        alignItems={{ xs: 'flex-start', sm: 'center' }}
                                    >
                                        <Chip
                                            size="small"
                                            color="warning"
                                            icon={<WarningIcon />}
                                            label={`Conflict ${idx + 1}`}
                                        />
                                        <Typography variant="subtitle2" color="text.secondary">
                                            {conflict.time_window}
                                        </Typography>
                                        <Chip
                                            size="small"
                                            label={`${blockers.length} existing pass${blockers.length === 1 ? '' : 'es'}`}
                                            variant="outlined"
                                        />
                                    </Stack>

                                    {conflictReasons.length > 0 && (
                                        <Box sx={{ mb: 1.3 }}>
                                            <Typography variant="caption" color="text.secondary">
                                                {t('regeneration_preview_dialog.conflict_reason', { defaultValue: 'Conflict reason:' })}
                                            </Typography>
                                            <Stack direction="row" spacing={0.7} sx={{ mt: 0.4, flexWrap: 'wrap' }}>
                                                {conflictReasons.map((reason) => (
                                                    <Chip
                                                        key={`${passId}-${reason}`}
                                                        size="small"
                                                        label={reason.toUpperCase()}
                                                        color="warning"
                                                        variant="outlined"
                                                    />
                                                ))}
                                            </Stack>
                                        </Box>
                                    )}

                                    <Box
                                        sx={{
                                            display: 'grid',
                                            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
                                            gap: 1.2,
                                            mb: 1.4,
                                        }}
                                    >
                                        <Box
                                            sx={{
                                                p: 1.2,
                                                border: '1px solid',
                                                borderColor: 'primary.main',
                                                borderRadius: 1,
                                                bgcolor: (theme) => theme.palette.mode === 'dark'
                                                    ? 'rgba(25, 118, 210, 0.12)'
                                                    : 'rgba(25, 118, 210, 0.05)',
                                            }}
                                        >
                                            <Typography variant="caption" color="text.secondary">
                                                {t('regeneration_preview_dialog.candidate_pass', { defaultValue: 'Candidate Pass' })}
                                            </Typography>
                                            <Typography variant="subtitle2" sx={{ mt: 0.3 }}>
                                                {conflict.new_pass.satellite}
                                            </Typography>
                                            <Stack direction="row" spacing={0.7} sx={{ mt: 0.6 }} alignItems="center">
                                                <Chip
                                                    size="small"
                                                    label={`${conflict.new_pass.elevation.toFixed(1)}°`}
                                                    color="primary"
                                                    variant="outlined"
                                                />
                                                <Typography variant="body2" color="text.secondary">
                                                    {formatRange(conflict.new_pass.start, conflict.new_pass.end)}
                                                </Typography>
                                            </Stack>
                                        </Box>

                                        <Box
                                            sx={{
                                                p: 1.2,
                                                border: '1px solid',
                                                borderColor: 'warning.main',
                                                borderRadius: 1,
                                                bgcolor: (theme) => theme.palette.mode === 'dark'
                                                    ? 'rgba(237, 108, 2, 0.12)'
                                                    : 'rgba(237, 108, 2, 0.06)',
                                            }}
                                        >
                                            <Typography variant="caption" color="text.secondary">
                                                {t('regeneration_preview_dialog.conflicts_with_existing', { defaultValue: 'Conflicts With Existing' })}
                                            </Typography>
                                            <Stack spacing={0.8} sx={{ mt: 0.5 }}>
                                                {blockers.map((blocker) => (
                                                    <Box key={blocker.id}>
                                                        <Typography variant="subtitle2">
                                                            {blocker.satellite}
                                                        </Typography>
                                                        <Stack direction="row" spacing={0.7} alignItems="center" sx={{ mt: 0.3, flexWrap: 'wrap' }}>
                                                            <Chip
                                                                size="small"
                                                                label={`${Number(blocker.elevation || 0).toFixed(1)}°`}
                                                                variant="outlined"
                                                            />
                                                            <Typography variant="body2" color="text.secondary">
                                                                {formatRange(blocker.start, blocker.end)}
                                                            </Typography>
                                                        </Stack>
                                                    </Box>
                                                ))}
                                            </Stack>
                                        </Box>
                                    </Box>

                                    <Divider sx={{ my: 1.2 }} />

                                    <Typography variant="subtitle2" sx={{ mb: 0.8 }}>
                                        {t('regeneration_preview_dialog.resolution', { defaultValue: 'Resolution' })}
                                    </Typography>
                                    <RadioGroup value={effectiveAction} onChange={(e) => handleConflictChoice(passId, e.target.value)}>
                                        <FormControlLabel
                                            value="keep_existing"
                                            control={<Radio size="small" />}
                                            label={
                                                <Typography variant="body2" component="span">
                                                    <strong>{t('regeneration_preview_dialog.keep_existing_pass_es', { defaultValue: 'Keep Existing Pass(es)' })}</strong> {t('regeneration_preview_dialog.and_skip_candidate_pass', { defaultValue: 'and skip candidate pass' })}
                                                    {effectiveAction === 'keep_existing' && conflict.strategy_action === 'keep_existing' && (
                                                        <Chip
                                                            label={t('regeneration_preview_dialog.strategy_default', { defaultValue: 'Strategy Default' })}
                                                            size="small"
                                                            color="info"
                                                            sx={{ ml: 1 }}
                                                        />
                                                    )}
                                                </Typography>
                                            }
                                        />
                                        <FormControlLabel
                                            value="replace_blockers"
                                            control={<Radio size="small" />}
                                            label={
                                                <Typography variant="body2" component="span">
                                                    <strong>{t('regeneration_preview_dialog.schedule_new_pass', { defaultValue: 'Schedule New Pass' })}</strong> {t('regeneration_preview_dialog.and_replace_conflicting_existing_passes', { defaultValue: 'and replace conflicting existing passes' })}
                                                    {effectiveAction === 'replace_blockers' && conflict.strategy_action === 'replace_blockers' && (
                                                        <Chip
                                                            label={t('regeneration_preview_dialog.strategy_default', { defaultValue: 'Strategy Default' })}
                                                            size="small"
                                                            color="info"
                                                            sx={{ ml: 1 }}
                                                        />
                                                    )}
                                                </Typography>
                                            }
                                        />
                                    </RadioGroup>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.8 }}>
                                        {isReplace
                                            ? `Will schedule candidate pass and replace ${blockers.length} existing pass${blockers.length === 1 ? '' : 'es'}.`
                                            : `Will keep ${blockers.length} existing pass${blockers.length === 1 ? '' : 'es'} and skip candidate pass.`
                                        }
                                    </Typography>

                                    {idx < conflicts.length - 1 && <Divider sx={{ mt: 2 }} />}
                                </Box>
                            );
                        })}
                    </Box>
                )}
            </DialogContent>

            <DialogActions>
                <Button onClick={onClose} variant="outlined">
                    {t('regeneration_preview_dialog.cancel', { defaultValue: 'Cancel' })}
                </Button>
                {hasConflicts && (
                    <Button onClick={handleApplyStrategy} variant="outlined" color="info">
                        {t('regeneration_preview_dialog.reset_to_strategy_defaults', { defaultValue: 'Reset to Strategy Defaults' })}
                    </Button>
                )}
                <Button onClick={handleConfirm} variant="contained" color="primary">
                    {t('regeneration_preview_dialog.confirm_generate', { defaultValue: 'Confirm & Generate' })}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default RegenerationPreviewDialog;
