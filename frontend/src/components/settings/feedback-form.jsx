/** Copyright (c) 2026 Efstratios Goudelis. SPDX-License-Identifier: GPL-3.0-or-later */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Chip,
    CircularProgress, Stack, Typography,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import RefreshIcon from '@mui/icons-material/Refresh';
import SaveOutlinedIcon from '@mui/icons-material/SaveOutlined';
import ScheduleOutlinedIcon from '@mui/icons-material/ScheduleOutlined';
import CodeOutlinedIcon from '@mui/icons-material/CodeOutlined';
import { useTranslation } from 'react-i18next';
import { useSocket } from '../common/socket.jsx';
import {
    CensusDisclosure, CENSUS_NOTICE_VERSION, FeedbackChoices, FeedbackDelivery, FeedbackIntroduction,
} from './feedback-disclosure.jsx';
import { SettingsSection, SettingsSurface } from './shared/index.js';

export default function FeedbackForm() {
    const { socket } = useSocket();
    const { t } = useTranslation('settings');
    const [status, setStatus] = useState(null);
    const [enabled, setEnabled] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const request = useRef(0);

    const call = useCallback(async (cmd, data) => {
        if (!socket?.connected) throw new Error(t('feedback.connection_required'));
        const reply = await socket.timeout(45000).emitWithAck('api.call', { cmd, data });
        if (!reply?.success) throw new Error(reply?.error || t('feedback.request_failed'));
        return reply.data;
    }, [socket, t]);

    const load = useCallback(async () => {
        const id = ++request.current;
        setBusy(true);
        setError('');
        try {
            const result = await call('feedback.get');
            if (id !== request.current) return;
            setStatus(result);
            setEnabled(result.enabled);
        } catch (failure) {
            if (id === request.current) setError(failure.message);
        } finally {
            if (id === request.current) setBusy(false);
        }
    }, [call]);

    useEffect(() => {
        load();
        // A reconnect reloads server consent, including changes by another admin.
        socket?.on('connect', load);
        return () => { request.current += 1; socket?.off('connect', load); };
    }, [socket, load]);

    const save = async () => {
        setBusy(true);
        setError('');
        try {
            const result = await call('feedback.update', {
                enabled,
                consent_notice_version: CENSUS_NOTICE_VERSION,
            });
            // Replace the draft only after persistence succeeds. The update
            // reply deliberately contains no credential or unsent hardware data.
            setStatus({ ...result, sample: status?.sample });
            setEnabled(result.enabled);
        } catch (failure) {
            setError(failure.message);
        } finally {
            setBusy(false);
        }
    };

    const dirty = status && enabled !== status.enabled;
    const sample = status?.sample ? {
        ...status.sample,
        consent_notice_version: status.enabled ? status.accepted_notice_version : CENSUS_NOTICE_VERSION,
        installation_id: status.installation_id || status.sample.installation_id,
    } : null;

    return (
        <SettingsSurface sx={{ p: { xs: 2, md: 3 } }}>
            <Stack spacing={3}>
                <FeedbackIntroduction actions={(
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
                        {status && <Chip
                            size="small"
                            variant="outlined"
                            label={t(status.enabled ? 'feedback.enabled' : 'feedback.disabled')}
                            color={status.enabled ? 'success' : 'default'}
                            aria-live="polite"
                        />}
                        <Button
                            size="small"
                            variant="outlined"
                            onClick={load}
                            disabled={busy}
                            startIcon={busy ? <CircularProgress size={16} color="inherit" aria-label={t('feedback.loading')} /> : <RefreshIcon />}
                        >
                            {t('feedback.refresh')}
                        </Button>
                    </Stack>
                )} />
                {error && <Alert severity="error">{error}</Alert>}
                {status?.storage_error && <Alert severity="error">{t('feedback.storage_error')}</Alert>}
                {status?.blocked && <Alert severity="warning">{t('feedback.blocked')}</Alert>}
                {status?.error && <Alert severity="warning">{status.error}</Alert>}
                {status?.preview_error && <Alert severity="warning">{status.preview_error}</Alert>}

                <Stack spacing={3}>
                    <Box sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))',
                        gap: 2.5,
                        minWidth: 0,
                    }}>
                        <FeedbackChoices
                            enabled={enabled}
                            onChange={setEnabled}
                            disabled={busy || !status || status.storage_error}
                            actions={(
                                <Stack spacing={1.5}>
                                    {dirty && <Typography variant="body2" color="warning.main" role="status">{t('feedback.unsaved')}</Typography>}
                                    <Button
                                        fullWidth
                                        variant="contained"
                                        disableElevation
                                        startIcon={<SaveOutlinedIcon />}
                                        onClick={save}
                                        disabled={busy || !status || status.storage_error || (!dirty && !status.blocked && !status.needs_consent_review)}
                                    >
                                        {t('feedback.save')}
                                    </Button>
                                </Stack>
                            )}
                        />
                        {status && (
                            <SettingsSection
                                title={<Stack component="span" direction="row" spacing={1} alignItems="center"><ScheduleOutlinedIcon fontSize="small" color="primary" /><span>{t('feedback.status_title')}</span></Stack>}
                                sx={{ borderRadius: 1.5 }}
                            >
                                <Stack component="dl" spacing={2} sx={{ m: 0 }}>
                                    <Box>
                                        <Typography component="dt" variant="body2" color="text.secondary">{t('feedback.last_report_label')}</Typography>
                                        <Typography component="dd" variant="body2" sx={{ m: 0, mt: 0.5, fontWeight: 600 }}>
                                            {status.last_success_at ? new Date(status.last_success_at).toLocaleString() : t('feedback.never')}
                                        </Typography>
                                    </Box>
                                    {status.enabled && !status.blocked && <Box>
                                        <Typography component="dt" variant="body2" color="text.secondary">{t('feedback.next_report_label')}</Typography>
                                        <Typography component="dd" variant="body2" sx={{ m: 0, mt: 0.5, fontWeight: 600 }}>
                                            {status.next_attempt_at ? new Date(status.next_attempt_at * 1000).toLocaleString() : t('feedback.soon')}
                                        </Typography>
                                    </Box>}
                                </Stack>
                                <Typography variant="body2" color="text.secondary" sx={{ pt: 1.5, borderTop: '1px solid', borderColor: 'divider', lineHeight: 1.7 }}>
                                    {t('feedback.refresh_help')}
                                </Typography>
                            </SettingsSection>
                        )}
                    </Box>
                    <Stack spacing={2.5} sx={{ minWidth: 0 }}>
                        <CensusDisclosure />
                        <FeedbackDelivery />
                        {sample && (
                            <Accordion disableGutters elevation={0} sx={{
                                border: '1px solid', borderColor: 'divider', borderRadius: '6px !important',
                                minWidth: 0, '&::before': { display: 'none' },
                            }}>
                                <AccordionSummary expandIcon={<ExpandMoreIcon />} aria-controls="feedback-preview-content" id="feedback-preview-heading" sx={{ px: { xs: 1.5, sm: 2 }, py: 0.5 }}>
                                    <Stack direction="row" spacing={1.25} alignItems="center">
                                        <CodeOutlinedIcon fontSize="small" color="primary" />
                                        <Box>
                                            <Typography variant="subtitle2">{t('feedback.preview_title')}</Typography>
                                            <Typography variant="caption" color="text.secondary">
                                                {t('feedback.preview_format')}
                                            </Typography>
                                        </Box>
                                    </Stack>
                                </AccordionSummary>
                                <AccordionDetails sx={{ px: { xs: 1.5, sm: 2 }, pb: 2 }}>
                                    <Typography variant="body2" color="text.secondary" sx={{ mb: 2, lineHeight: 1.7 }}>{t('feedback.preview_help')}</Typography>
                                    <Box component="pre" tabIndex={0} aria-label={t('feedback.preview_title')} sx={{
                                        m: 0, p: 2, bgcolor: 'background.default', border: '1px solid', borderColor: 'divider',
                                        borderRadius: 1, overflow: 'auto', maxHeight: 420, fontSize: '0.75rem', lineHeight: 1.7,
                                        fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
                                    }}>{JSON.stringify(sample, null, 2)}</Box>
                                </AccordionDetails>
                            </Accordion>
                        )}
                    </Stack>
                </Stack>
            </Stack>
        </SettingsSurface>
    );
}
