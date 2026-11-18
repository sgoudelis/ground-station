/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import {
    Alert,
    AlertTitle,
    Box,
    Button,
    Chip,
    CircularProgress,
    Divider,
    Grid,
    IconButton,
    Link,
    Paper,
    Stack,
    Tooltip,
    Typography,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RefreshIcon from '@mui/icons-material/Refresh';
import SystemUpdateAltIcon from '@mui/icons-material/SystemUpdateAlt';
import { useTranslation } from 'react-i18next';
import CapsButton from '../../common/capsbutton.jsx';
import { fetchUpdateCheck } from '../../dashboard/update-slice.jsx';
import { useSocket } from '../../common/socket.jsx';
import { useUserTimeSettings } from '../../../hooks/useUserTimeSettings.jsx';
import { formatDateTime } from '../../../utils/date-time.js';

const RELEASES_URL = 'https://github.com/sgoudelis/ground-station/releases';
const IMAGE_NAME = 'ghcr.io/sgoudelis/ground-station';

const CodeBlock = ({ children }) => {
    const { t } = useTranslation('settings');
    const [copyState, setCopyState] = useState('idle');
    const command = String(children);
    const copyLabel = t('maintenance.updates.copy_command', { defaultValue: 'Copy command' });
    const tooltip = copyState === 'copied'
        ? t('maintenance.updates.copied', { defaultValue: 'Copied' })
        : copyState === 'failed'
            ? t('maintenance.updates.copy_failed', { defaultValue: 'Copy failed' })
            : copyLabel;

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(command);
            setCopyState('copied');
        } catch {
            setCopyState('failed');
        }
        window.setTimeout(() => setCopyState('idle'), 1500);
    };

    return (
        <Box sx={{ position: 'relative', mt: 1 }}>
            <Box
                component="pre"
                sx={{
                    m: 0,
                    p: 1.5,
                    pr: 6,
                    overflowX: 'auto',
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                    backgroundColor: (theme) => theme.palette.action.hover,
                    color: 'text.primary',
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                }}
            >
                {command}
            </Box>
            <Tooltip title={tooltip} arrow>
                <IconButton
                    size="small"
                    aria-label={copyLabel}
                    onClick={handleCopy}
                    color={copyState === 'copied' ? 'success' : 'default'}
                    sx={{
                        position: 'absolute',
                        top: 6,
                        right: 6,
                        backgroundColor: 'background.paper',
                        border: '1px solid',
                        borderColor: 'divider',
                        '&:hover': { backgroundColor: 'action.hover' },
                    }}
                >
                    {copyState === 'copied'
                        ? <CheckIcon fontSize="small" />
                        : <ContentCopyIcon fontSize="small" />}
                </IconButton>
            </Tooltip>
        </Box>
    );
};

const Detail = ({ label, value, mono = false }) => (
    <Box>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
            {label}
        </Typography>
        <Typography variant="body2" sx={{ fontFamily: mono ? 'monospace' : 'inherit' }}>
            {value || '—'}
        </Typography>
    </Box>
);

const UpdateCard = () => {
    const dispatch = useDispatch();
    const { socket } = useSocket();
    const { t } = useTranslation('settings');
    const { timezone, locale } = useUserTimeSettings();
    const {
        data,
        loading,
        error,
        lastChecked,
        lastAttempted,
    } = useSelector((state) => state.updateCheck);
    const shouldCheckOnMount = !lastAttempted;

    useEffect(() => {
        if (!shouldCheckOnMount || !socket) return;
        const checkForUpdate = () => dispatch(fetchUpdateCheck({ socket }));
        if (socket.connected) checkForUpdate();
        else socket.on('connect', checkForUpdate);
        return () => socket.off('connect', checkForUpdate);
    }, [dispatch, shouldCheckOnMount, socket]);

    const latestVersion = data?.latestVersion || null;
    const imageVersion = latestVersion || '<version>';
    const releaseUrl = data?.latestUrl || RELEASES_URL;
    const checkedAt = data?.checkedAt || lastChecked;
    const statusColor = error
        ? 'error'
        : data?.isUpdateAvailable
            ? 'warning'
            : lastChecked
                ? 'success'
                : 'default';
    const statusLabel = error
        ? t('maintenance.updates.status_failed', { defaultValue: 'Check failed' })
        : data?.isUpdateAvailable
            ? t('maintenance.updates.status_available', { defaultValue: 'Update available' })
            : lastChecked
                ? t('maintenance.updates.status_current', { defaultValue: 'Up to date' })
                : t('maintenance.updates.status_pending', { defaultValue: 'Not checked' });

    return (
        <Stack spacing={2}>
            <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1.5}
                alignItems={{ xs: 'stretch', sm: 'center' }}
                justifyContent="space-between"
            >
                <Stack direction="row" spacing={1} alignItems="center">
                    <SystemUpdateAltIcon color="primary" />
                    <Box>
                        <Typography variant="h6">
                            {t('maintenance.updates.title', { defaultValue: 'Software Updates' })}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            {t('maintenance.updates.subtitle', {
                                defaultValue: 'Checks the latest published Ground Station release on GitHub.',
                            })}
                        </Typography>
                    </Box>
                </Stack>
                <CapsButton
                    variant="outlined"
                    size="small"
                    startIcon={loading ? <CircularProgress size={16} /> : <RefreshIcon />}
                    onClick={() => dispatch(fetchUpdateCheck({ socket, force: true }))}
                    disabled={loading || !socket?.connected}
                >
                    {loading
                        ? t('maintenance.updates.checking', { defaultValue: 'Checking…' })
                        : t('maintenance.updates.check_now', { defaultValue: 'Check now' })}
                </CapsButton>
            </Stack>

            <Divider />

            {error && (
                <Alert severity="error">
                    <AlertTitle>
                        {t('maintenance.updates.error_title', {
                            defaultValue: 'GitHub release check failed',
                        })}
                    </AlertTitle>
                    {error}
                    {lastAttempted && (
                        <Typography variant="caption" display="block" sx={{ mt: 0.5 }}>
                            {t('maintenance.updates.attempted_at', {
                                defaultValue: 'Attempted: {{time}}',
                                time: formatDateTime(lastAttempted, { timezone, locale }),
                            })}
                        </Typography>
                    )}
                </Alert>
            )}

            {!error && data?.isUpdateAvailable && (
                <Alert severity="warning">
                    <AlertTitle>
                        {t('maintenance.updates.available_title', {
                            defaultValue: 'A newer release is available',
                        })}
                    </AlertTitle>
                    {t('maintenance.updates.available_body', {
                        defaultValue: 'Version {{latest}} is available. This installation is running version {{current}}.',
                        latest: data.latestVersion,
                        current: data.currentVersion,
                    })}
                </Alert>
            )}

            {!error && lastChecked && !data?.isUpdateAvailable && (
                <Alert severity="success">
                    <AlertTitle>
                        {t('maintenance.updates.current_title', { defaultValue: 'Ground Station is up to date' })}
                    </AlertTitle>
                    {t('maintenance.updates.current_body', {
                        defaultValue: 'The running version matches the latest published GitHub release.',
                    })}
                </Alert>
            )}

            {!error && !lastChecked && (
                <Alert severity="info">
                    {loading
                        ? t('maintenance.updates.loading_body', {
                            defaultValue: 'Contacting GitHub Releases…',
                        })
                        : t('maintenance.updates.pending_body', {
                            defaultValue: 'The release check has not completed yet.',
                        })}
                </Alert>
            )}

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.5 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        {t('maintenance.updates.status_title', { defaultValue: 'Release status' })}
                    </Typography>
                    <Chip size="small" color={statusColor} label={statusLabel} />
                </Stack>
                <Grid container spacing={2}>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                        <Detail
                            label={t('maintenance.updates.current_version', { defaultValue: 'Current version' })}
                            value={data?.currentVersion}
                            mono
                        />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                        <Detail
                            label={t('maintenance.updates.latest_release', { defaultValue: 'Latest release' })}
                            value={data?.latestTag || data?.latestVersion}
                            mono
                        />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                        <Detail
                            label={t('maintenance.updates.published_at', { defaultValue: 'Published' })}
                            value={data?.publishedAt
                                ? formatDateTime(data.publishedAt, { timezone, locale })
                                : null}
                        />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                        <Detail
                            label={t('maintenance.updates.checked_at', { defaultValue: 'Last successful check' })}
                            value={checkedAt ? formatDateTime(checkedAt, { timezone, locale }) : null}
                        />
                    </Grid>
                </Grid>
                <Button
                    component={Link}
                    href={releaseUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    endIcon={<OpenInNewIcon fontSize="small" />}
                    size="small"
                    sx={{ mt: 2 }}
                >
                    {t('maintenance.updates.release_notes', { defaultValue: 'Open release notes' })}
                </Button>
            </Paper>

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 1.5 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                    {t('maintenance.updates.instructions_title', {
                        defaultValue: 'Update the Docker image',
                    })}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
                    {t('maintenance.updates.instructions_intro', {
                        defaultValue: 'The GitHub release workflow publishes one multi-architecture image for AMD64 and ARM64. Docker selects the correct image automatically.',
                    })}
                </Typography>

                <Box component="ol" sx={{ m: 0, pl: 2.5, '& > li': { mb: 2 } }}>
                    <li>
                        <Typography variant="body2">
                            {t('maintenance.updates.step_review', {
                                defaultValue: 'Review the release notes and record the options used to start the current container.',
                            })}
                        </Typography>
                    </li>
                    <li>
                        <Typography variant="body2">
                            {t('maintenance.updates.step_backup', {
                                defaultValue: 'Back up the host directory mounted at /app/backend/data. This directory contains the database and station data.',
                            })}
                        </Typography>
                    </li>
                    <li>
                        <Typography variant="body2">
                            {t('maintenance.updates.step_pull', {
                                defaultValue: 'Pull the exact released image:',
                            })}
                        </Typography>
                        <CodeBlock>{`docker pull ${IMAGE_NAME}:${imageVersion}`}</CodeBlock>
                    </li>
                    <li>
                        <Typography variant="body2">
                            {t('maintenance.updates.step_replace', {
                                defaultValue: 'Stop and remove the existing container:',
                            })}
                        </Typography>
                        <CodeBlock>{`docker stop ground-station\ndocker rm ground-station`}</CodeBlock>
                    </li>
                    <li>
                        <Typography variant="body2">
                            {t('maintenance.updates.step_restart', {
                                defaultValue: 'Start the new container with the command for your architecture and networking mode. Replace /path/to/data with the same host data directory used by the previous container.',
                                version: imageVersion,
                            })}
                        </Typography>
                        <Typography variant="subtitle2" sx={{ mt: 1.5 }}>
                            {t('maintenance.updates.host_network_title', {
                                defaultValue: 'Host networking (recommended for SoapySDR Remote discovery)',
                            })}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            {t('maintenance.updates.amd64_label', { defaultValue: 'AMD64' })}
                        </Typography>
                        <CodeBlock>{`docker run -d \\
  --platform linux/amd64 \\
  --network host \\
  -e GS_HTTP_PORT=7000 \\
  --name ground-station \\
  --restart unless-stopped \\
  --device=/dev/bus/usb \\
  --privileged \\
  -v /path/to/data:/app/backend/data \\
  ${IMAGE_NAME}:${imageVersion}`}</CodeBlock>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                            {t('maintenance.updates.arm64_label', {
                                defaultValue: 'ARM64 (Raspberry Pi and similar systems)',
                            })}
                        </Typography>
                        <CodeBlock>{`docker run -d \\
  --platform linux/arm64 \\
  --network host \\
  -e GS_HTTP_PORT=7000 \\
  --name ground-station \\
  --restart unless-stopped \\
  -v /dev:/dev \\
  --privileged \\
  -v /path/to/data:/app/backend/data \\
  ${IMAGE_NAME}:${imageVersion}`}</CodeBlock>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                            {t('maintenance.updates.host_network_port_note', {
                                defaultValue: 'For a different HTTP port with host networking, change GS_HTTP_PORT=7000 to your chosen port. Docker ignores -p in this mode. The backend remains on port 7001.',
                            })}
                        </Typography>

                        <Typography variant="subtitle2" sx={{ mt: 2 }}>
                            {t('maintenance.updates.bridge_network_title', {
                                defaultValue: 'Bridge networking (no SoapySDR Remote discovery)',
                            })}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            {t('maintenance.updates.amd64_label', { defaultValue: 'AMD64' })}
                        </Typography>
                        <CodeBlock>{`docker run -d \\
  --platform linux/amd64 \\
  -p 7000:7000 \\
  --name ground-station \\
  --restart unless-stopped \\
  --device=/dev/bus/usb \\
  --privileged \\
  -v /path/to/data:/app/backend/data \\
  ${IMAGE_NAME}:${imageVersion}`}</CodeBlock>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                            {t('maintenance.updates.arm64_label', {
                                defaultValue: 'ARM64 (Raspberry Pi and similar systems)',
                            })}
                        </Typography>
                        <CodeBlock>{`docker run -d \\
  --platform linux/arm64 \\
  -p 7000:7000 \\
  --name ground-station \\
  --restart unless-stopped \\
  -v /dev:/dev \\
  --privileged \\
  -v /path/to/data:/app/backend/data \\
  ${IMAGE_NAME}:${imageVersion}`}</CodeBlock>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                            {t('maintenance.updates.bridge_network_port_note', {
                                defaultValue: 'For a different HTTP port with bridge networking, change the host side of -p 7000:7000, for example to -p 8080:7000.',
                            })}
                        </Typography>
                    </li>
                </Box>

                <Alert severity="info" sx={{ mt: 1 }}>
                    {t('maintenance.updates.persistence_note', {
                        defaultValue: 'Keep the existing /app/backend/data volume mapping. Removing a container does not remove a bind-mounted host directory, but starting without the same mapping will make the new container use a different data directory.',
                    })}
                </Alert>
            </Paper>
        </Stack>
    );
};

export default UpdateCard;
