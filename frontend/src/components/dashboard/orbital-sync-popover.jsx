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

import * as React from "react";
import {
    Box,
    IconButton,
    Popover,
    Typography,
    LinearProgress,
    Stack,
    Chip,
    List,
    ListItem,
    ListItemText,
    Divider,
    CircularProgress,
} from "@mui/material";
import { useRef, useState } from "react";
import { useSelector } from "react-redux";
import Tooltip from "@mui/material/Tooltip";
import { useTranslation } from 'react-i18next';

// Import overlay icons
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import SyncIcon from '@mui/icons-material/Sync';

const OrbitalSyncPopover = () => {
    const { t } = useTranslation('dashboard');
    const buttonRef = useRef(null);
    const [anchorEl, setAnchorEl] = useState(null);

    // Get sync data from the Redux store
    const { syncState, synchronizing, status, error } = useSelector(
        (state) => state.syncSatellite
    );

    // Get timezone preference
    const timezone = useSelector((state) => {
        const tzPref = state.preferences?.preferences?.find(p => p.name === 'timezone');
        return tzPref?.value || 'UTC';
    });

    const handleClick = (event) => {
        setAnchorEl(event.currentTarget);
    };

    const handleClose = () => {
        setAnchorEl(null);
    };

    const open = Boolean(anchorEl);

    // Determine colors based on sync status
    const getProgressColor = () => {
        if (syncState?.status === 'complete' && syncState?.success === false) return 'error';
        if (syncState?.errors && syncState.errors.length > 0) return 'error';
        if (syncState?.status === 'inprogress') return 'primary';
        if (syncState?.status === 'complete' && syncState?.success === true) return 'success';
        return 'inherit';
    };

    const getTooltip = () => {
        if (syncState?.status === 'inprogress') return t('orbital_sync_popover.syncing', { progress: syncState?.progress || 0 });
        if (syncState?.status === 'complete' && syncState?.success === false) return t('orbital_sync_popover.sync_failed', { error: syncState.errors?.[0] || 'Unknown error' });
        if (syncState?.status === 'complete' && syncState?.success === true) {
            const date = new Date(syncState.last_update);
            return t('orbital_sync_popover.last_sync', { date: date.toLocaleString('en-US', { timeZone: timezone }) });
        }
        return t('orbital_sync_popover.satellite_orbital_sync');
    };

    // Format date nicely with user's timezone
    const formatDate = (dateString) => {
        if (!dateString) return t('orbital_sync_popover.na');
        const date = new Date(dateString);
        return date.toLocaleString('en-US', { timeZone: timezone });
    };

    // Show icon only when in progress or when complete with success === false
    const shouldShowIcon = syncState?.status === 'inprogress' || 
                           (syncState?.status === 'complete' && syncState?.success === false);

    return (
        <>
            {shouldShowIcon && (
                <Tooltip title={getTooltip()}>
                    <IconButton
                        ref={buttonRef}
                        onClick={handleClick}
                        size="small"
                        sx={{
                            width: 40,
                            height: 40,
                            '&:hover': {
                                backgroundColor: 'overlay.light',
                            },
                            position: 'relative',
                        }}
                    >
                        {/* Background circle for incomplete progress */}
                        <CircularProgress
                            variant="determinate"
                            value={100}
                            size={32}
                            thickness={5}
                            sx={{
                                position: 'absolute',
                                color: 'border.main', // Dark grey background
                            }}
                        />
                        {/* Foreground progress circle */}
                        <CircularProgress
                            variant="determinate"
                            value={syncState?.status === 'inprogress' ? syncState?.progress || 0 : 100}
                            size={32}
                            thickness={5}
                            color={getProgressColor()}
                            sx={{
                                position: 'absolute',
                            }}
                        />
                        <Box
                            sx={{
                                position: 'absolute',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            {syncState?.status === 'inprogress' ? (
                                <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 'bold' }}>
                                    {syncState?.progress || 0}
                                </Typography>
                            ) : (
                                <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 'bold' }}>
                                    {t('orbital_sync_popover.orb', { defaultValue: 'ORB' })}
                                </Typography>
                            )}
                        </Box>
                    </IconButton>
                </Tooltip>
            )}
            <Popover
                sx={{
                    '& .MuiPaper-root': {
                        borderRadius: 0,
                    },
                }}
                open={open}
                anchorEl={anchorEl}
                onClose={handleClose}
                anchorOrigin={{
                    vertical: 'bottom',
                    horizontal: 'right',
                }}
                transformOrigin={{
                    vertical: 'top',
                    horizontal: 'right',
                }}
            >
                <Box
                    sx={{
                        borderRadius: 0,
                        border: '1px solid',
                        borderColor: 'border.main',
                        p: 2,
                        minWidth: 350,
                        maxWidth: 400,
                        backgroundColor: 'background.paper',
                    }}
                >
                    {/* Header */}
                    <Typography variant="h6" sx={{ mb: 2, color: 'text.primary' }}>
                        {t('orbital_sync_popover.orbital_sync_status')}
                    </Typography>

                    {/* Status */}
                    <Stack spacing={2}>
                        <Box>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                                {t('orbital_sync_popover.status')}
                            </Typography>
                            <Chip
                                label={syncState?.status || t('orbital_sync_popover.idle')}
                                color={
                                    syncState?.status === 'complete' && syncState?.success === true
                                        ? 'success'
                                        : syncState?.status === 'complete' && syncState?.success === false
                                        ? 'error'
                                        : syncState?.status === 'inprogress'
                                            ? 'info'
                                            : 'default'
                                }
                                size="small"
                                icon={
                                    syncState?.status === 'complete' && syncState?.success === true ? (
                                        <CloudDoneIcon />
                                    ) : syncState?.status === 'complete' && syncState?.success === false ? (
                                        <CloudOffIcon />
                                    ) : syncState?.status === 'inprogress' ? (
                                        <SyncIcon />
                                    ) : (
                                        <CloudOffIcon />
                                    )
                                }
                            />
                        </Box>

                        {/* Progress */}
                        {syncState?.status === 'inprogress' && (
                            <Box>
                                <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                                    {t('orbital_sync_popover.progress', { progress: syncState?.progress || 0 })}
                                </Typography>
                                <LinearProgress
                                    variant="determinate"
                                    value={syncState?.progress || 0}
                                    sx={{ height: 8, borderRadius: 1 }}
                                />
                            </Box>
                        )}

                        {/* Last Update */}
                        <Box>
                            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                                {t('orbital_sync_popover.last_update')}
                            </Typography>
                            <Typography variant="body2" sx={{ color: 'text.primary' }}>
                                {formatDate(syncState?.last_update)}
                            </Typography>
                        </Box>

                        <Divider sx={{ borderColor: 'border.main' }} />

                        {/* Statistics */}
                        {syncState?.stats && (
                            <Box>
                                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                    {t('orbital_sync_popover.statistics')}
                                </Typography>
                                <Stack direction="row" spacing={1} flexWrap="wrap">
                                    <Chip
                                        label={t('orbital_sync_popover.satellites', { count: syncState.stats.satellites_processed || 0 })}
                                        size="small"
                                        variant="outlined"
                                    />
                                    <Chip
                                        label={t('orbital_sync_popover.transmitters', { count: syncState.stats.transmitters_processed || 0 })}
                                        size="small"
                                        variant="outlined"
                                    />
                                    <Chip
                                        label={t('orbital_sync_popover.groups', { count: syncState.stats.groups_processed || 0 })}
                                        size="small"
                                        variant="outlined"
                                    />
                                </Stack>
                            </Box>
                        )}

                        {/* Errors */}
                        {syncState?.errors && syncState.errors.length > 0 && (
                            <Box>
                                <Typography variant="body2" color="error" sx={{ mb: 1 }}>
                                    {t('orbital_sync_popover.errors', { count: syncState.errors.length })}
                                </Typography>
                                <List dense sx={{ maxHeight: 120, overflow: 'auto' }}>
                                    {syncState.errors.map((error, index) => (
                                        <ListItem key={index} sx={{ px: 0 }}>
                                            <ListItemText
                                                primary={error}
                                                primaryTypographyProps={{
                                                    variant: 'body2',
                                                    color: 'error',
                                                }}
                                            />
                                        </ListItem>
                                    ))}
                                </List>
                            </Box>
                        )}
                    </Stack>
                </Box>
            </Popover>
        </>
    );
};

export default OrbitalSyncPopover;
