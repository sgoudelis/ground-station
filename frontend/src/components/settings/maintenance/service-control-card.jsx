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

import React, { useEffect, useRef, useState } from 'react';
import {Alert,AlertTitle,Box,Chip,CircularProgress,Dialog,DialogActions,DialogContent,DialogTitle,Divider,Stack,Typography,} from '@mui/material';
import Grid from '@mui/material/Grid';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import { useSocket } from '../../common/socket.jsx';
import { useTranslation } from 'react-i18next';
import CapsButton from '../../common/capsbutton.jsx';

const RESTART_COUNTDOWN_SECONDS = 15;

const ServiceControlCard = () => {
    const { socket } = useSocket();
    const { t } = useTranslation('settings');

    const [confirmRestartOpen, setConfirmRestartOpen] = useState(false);
    const [restartState, setRestartState] = useState('idle');
    const [statusMessage, setStatusMessage] = useState('');
    const [countdown, setCountdown] = useState(RESTART_COUNTDOWN_SECONDS);
    const [requestedAt, setRequestedAt] = useState(null);

    const countdownIntervalRef = useRef(null);

    const isRestarting = restartState === 'requesting' || restartState === 'countdown';

    useEffect(() => {
        return () => {
            if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current);
                countdownIntervalRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (restartState !== 'countdown') {
            return undefined;
        }

        if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
        }

        countdownIntervalRef.current = setInterval(() => {
            setCountdown((current) => {
                if (current <= 1) {
                    if (countdownIntervalRef.current) {
                        clearInterval(countdownIntervalRef.current);
                        countdownIntervalRef.current = null;
                    }
                    setRestartState('reloading');
                    setStatusMessage(t('maintenance.restart_reloading_now', { defaultValue: 'Reloading now to reconnect to service...' }));
                    window.location.reload();
                    return 0;
                }
                return current - 1;
            });
        }, 1000);

        return () => {
            if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current);
                countdownIntervalRef.current = null;
            }
        };
    }, [restartState, t]);

    const handleServiceRestart = () => {
        if (!socket) {
            setRestartState('error');
            setStatusMessage(t('maintenance.restart_no_socket', { defaultValue: 'No active socket connection. Please reconnect and try again.' }));
            return;
        }

        setConfirmRestartOpen(false);
        setRestartState('requesting');
        setStatusMessage(t('maintenance.restart_requesting', { defaultValue: 'Sending restart request to backend service...' }));

        const now = new Date();
        setRequestedAt(now);

        socket.emit("api.call", {
  cmd: "service.restart_service",
  data: null
}, response => {
  if (response?.success) {
    setCountdown(RESTART_COUNTDOWN_SECONDS);
    setRestartState('countdown');
    setStatusMessage(t('maintenance.restart_accepted', {
      defaultValue: 'Restart accepted. Existing connections will terminate. Auto-reload starts in {{seconds}} seconds.',
      seconds: RESTART_COUNTDOWN_SECONDS
    }));
    return;
  }
  setRestartState('error');
  setStatusMessage(t('maintenance.restart_failed', {
    defaultValue: 'Failed to restart service: {{error}}',
    error: response?.error || t('maintenance.unknown_error', {
      defaultValue: 'unknown error'
    })
  }));
});
    };

    const statusSeverity = restartState === 'error' ? 'error' : 'warning';

    const statusText = restartState === 'countdown'
        ? t('maintenance.restart_countdown_message', {
            defaultValue: 'Service restarting. Page reload in {{seconds}} seconds.',
            seconds: countdown,
        })
        : statusMessage;

    return (
        <>
            <Typography variant="h6" gutterBottom>
                {t('maintenance.service_control_header', { defaultValue: 'Service Control' })}
            </Typography>
            <Divider sx={{ mb: 2 }} />

            <Alert severity={statusSeverity} sx={{ mb: 2 }} role="status" aria-live="polite">
                <AlertTitle>{t('maintenance.service_control_title')}</AlertTitle>
                {t('maintenance.service_control_subtitle')}
                {statusText && (
                    <Typography variant="body2" sx={{ mt: 0.75, fontWeight: 600 }}>
                        {statusText}
                    </Typography>
                )}
            </Alert>

            <Grid container spacing={2} columns={12}>
                <Grid size={{ xs: 12, md: 8 }}>
                    <Stack spacing={0.75}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                            {t('maintenance.restart_service')}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            {t('maintenance.restart_service_description')}
                        </Typography>
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                            <Chip
                                size="small"
                                color={socket?.connected ? 'success' : 'default'}
                                label={socket?.connected
                                    ? t('maintenance.socket_connected', { defaultValue: 'Socket connected' })
                                    : t('maintenance.socket_disconnected', { defaultValue: 'Socket disconnected' })}
                            />
                            {requestedAt && (
                                <Chip
                                    size="small"
                                    variant="outlined"
                                    label={t('maintenance.requested_at', {
                                        defaultValue: 'Requested at: {{time}}',
                                        time: requestedAt.toLocaleTimeString(),
                                    })}
                                />
                            )}
                        </Stack>
                    </Stack>
                </Grid>

                <Grid size={{ xs: 12, md: 4 }} sx={{ display: 'flex', alignItems: 'center' }}>
                    <CapsButton
                        variant="contained"
                        color="error"
                        startIcon={isRestarting ? <CircularProgress size={20} color="inherit" /> : <RestartAltIcon />}
                        onClick={() => setConfirmRestartOpen(true)}
                        disabled={isRestarting}
                        fullWidth
                    >
                        {isRestarting ? t('maintenance.restarting') : t('maintenance.restart_service_button')}
                    </CapsButton>
                </Grid>

            </Grid>

            <Dialog
                open={confirmRestartOpen}
                onClose={() => !isRestarting && setConfirmRestartOpen(false)}
                fullWidth
                maxWidth="sm"
            >
                <DialogTitle>{t('maintenance.confirm_restart_title')}</DialogTitle>
                <DialogContent sx={{ pt: '24px !important' }}>
                    <Stack spacing={1.5}>
                        <Typography variant="body2">
                            {t('maintenance.confirm_restart_message')}
                        </Typography>

                        <Box>
                            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
                                {t('maintenance.impact_title', { defaultValue: 'What will happen' })}
                            </Typography>
                            <Box component="ul" sx={{ mt: 0.5, mb: 0, pl: 2 }}>
                                <li>{t('maintenance.restart_item_1')}</li>
                                <li>{t('maintenance.restart_item_2')}</li>
                                <li>{t('maintenance.restart_item_3')}</li>
                                <li>{t('maintenance.restart_item_4')}</li>
                                <li>{t('maintenance.restart_item_5')}</li>
                                <li>{t('maintenance.restart_item_6')}</li>
                            </Box>
                        </Box>

                        <Box
                            sx={{
                                border: '1px solid',
                                borderColor: 'info.main',
                                borderRadius: 1,
                                p: 1.5,
                                backgroundColor: 'action.hover',
                            }}
                        >
                            <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.75 }}>
                                {t('maintenance.deployment_note')}
                            </Typography>
                            <Typography variant="body2" sx={{ mb: 0.5 }}>
                                <strong>{t('maintenance.deployment_docker_label', { defaultValue: 'Docker deployment:' })}</strong>{' '}
                                {t('maintenance.deployment_docker')}
                            </Typography>
                            <Typography variant="body2">
                                <strong>{t('maintenance.deployment_standalone_label', { defaultValue: 'Standalone/Development deployment:' })}</strong>{' '}
                                {t('maintenance.deployment_standalone')}
                            </Typography>
                        </Box>

                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {t('maintenance.confirm_restart_question')}
                        </Typography>
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <CapsButton
                        onClick={() => setConfirmRestartOpen(false)}
                        disabled={isRestarting}
                    >
                        {t('maintenance.cancel')}
                    </CapsButton>
                    <CapsButton
                        onClick={handleServiceRestart}
                        color="error"
                        variant="contained"
                        disabled={isRestarting}
                        startIcon={isRestarting ? <CircularProgress size={18} color="inherit" /> : null}
                    >
                        {t('maintenance.yes_restart')}
                    </CapsButton>
                </DialogActions>
            </Dialog>
        </>
    );
};

export default ServiceControlCard;
