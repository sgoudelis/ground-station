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

import PublicIcon from '@mui/icons-material/Public';
import GpsFixedIcon from '@mui/icons-material/GpsFixed';
import EngineeringIcon from '@mui/icons-material/Engineering';
import {Satellite03Icon} from "hugeicons-react";
import MemoryIcon from '@mui/icons-material/Memory';
import InfoIcon from '@mui/icons-material/Info';
import GroupWorkIcon from '@mui/icons-material/GroupWork';
import WavesIcon from '@mui/icons-material/Waves';
import FolderIcon from '@mui/icons-material/Folder';
import SettingsApplicationsIcon from '@mui/icons-material/SettingsApplications';
import LocationOnIcon from '@mui/icons-material/LocationOn';
import GroupIcon from '@mui/icons-material/Group';
import i18n from '../i18n/config.js';
import { CelestialSolarIcon, TleIcon } from '../components/common/custom-icons.jsx';
import { Box, CircularProgress } from '@mui/material';
import SyncIcon from '@mui/icons-material/Sync';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import FiberNewIcon from '@mui/icons-material/FiberNew';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import EventNoteIcon from '@mui/icons-material/EventNote';
import { useSelector } from 'react-redux';
import { useLocation } from 'react-router-dom';

// Helper component to wrap icons with overlay indicators
const IconWithOverlay = ({ children, showOverlay = false, overlayType = 'spinner', showLeftOverlay = false, leftOverlayType = null }) => {
    return (
        <Box sx={{ position: 'relative', display: 'inline-flex' }}>
            {children}
            {/* Left overlay (e.g., recording indicator) */}
            {showLeftOverlay && leftOverlayType && (
                <Box
                    sx={{
                        position: 'absolute',
                        top: -4,
                        left: -4,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    {leftOverlayType === 'recording' && (
                        <Box
                            sx={{
                                backgroundColor: 'rgba(244, 67, 54, 0.3) !important',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '3px',
                            }}
                        >
                            <FiberManualRecordIcon
                                sx={{
                                    fontSize: 10,
                                    color: '#F44336 !important',
                                    fill: '#F44336 !important',
                                    animation: 'pulse 1.5s ease-in-out infinite',
                                    '@keyframes pulse': {
                                        '0%, 100%': { opacity: 1 },
                                        '50%': { opacity: 0.4 },
                                    }
                                }}
                            />
                        </Box>
                    )}
                </Box>
            )}
            {/* Right overlay (e.g., streaming, sync indicators) */}
            {showOverlay && (
                <Box
                    sx={{
                        position: 'absolute',
                        top: -4,
                        right: -4,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                    }}
                >
                    {overlayType === 'spinner' ? (
                        <Box
                            sx={{
                                backgroundColor: 'rgba(33, 150, 243, 0.3) !important',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '2px',
                            }}
                        >
                            <CircularProgress
                                size={12}
                                thickness={6}
                                sx={{
                                    color: '#2196F3 !important',
                                    '& .MuiCircularProgress-circle': {
                                        stroke: '#2196F3 !important',
                                    }
                                }}
                            />
                        </Box>
                    ) : overlayType === 'sync' ? (
                        <Box
                            sx={{
                                backgroundColor: 'rgba(255, 152, 0, 0.3) !important',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '2px',
                            }}
                        >
                            <SyncIcon
                                sx={{
                                    fontSize: 12,
                                    color: '#FF9800 !important',
                                    fill: '#FF9800 !important',
                                    animation: 'spin 1s linear infinite',
                                    '@keyframes spin': {
                                        '0%': { transform: 'rotate(0deg)' },
                                        '100%': { transform: 'rotate(360deg)' },
                                    }
                                }}
                            />
                        </Box>
                    ) : overlayType === 'play' ? (
                        <Box
                            sx={{
                                backgroundColor: 'rgba(76, 175, 80, 0.3) !important',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '2px',
                            }}
                        >
                            <PlayArrowIcon
                                sx={{
                                    fontSize: 12,
                                    color: '#4CAF50 !important',
                                    fill: '#4CAF50 !important',
                                }}
                            />
                        </Box>
                    ) : overlayType === 'new' ? (
                        <Box
                            sx={{
                                backgroundColor: 'rgba(244, 67, 54, 0.3) !important',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '3px',
                            }}
                        >
                            <FiberManualRecordIcon
                                sx={{
                                    fontSize: 10,
                                    color: '#F44336 !important',
                                    fill: '#F44336 !important',
                                }}
                            />
                        </Box>
                    ) : overlayType === 'error' ? (
                        <Box
                            sx={{
                                backgroundColor: 'rgba(244, 67, 54, 0.3) !important',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: '3px',
                            }}
                        >
                            <FiberManualRecordIcon
                                sx={{
                                    fontSize: 10,
                                    color: '#F44336 !important',
                                    fill: '#F44336 !important',
                                    animation: 'pulse 1.5s ease-in-out infinite',
                                    '@keyframes pulse': {
                                        '0%, 100%': { opacity: 1 },
                                        '50%': { opacity: 0.4 },
                                    }
                                }}
                            />
                        </Box>
                    ) : null}
                </Box>
            )}
        </Box>
    );
};

// Wrapper component for WavesIcon that reads Redux state
const WaterfallIconWithStatus = () => {
    const isStreaming = useSelector((state) => state.waterfall?.isStreaming);
    const isRecording = useSelector((state) => state.waterfall?.isRecording);

    return (
        <IconWithOverlay
            showOverlay={isStreaming}
            overlayType="play"
            showLeftOverlay={isRecording}
            leftOverlayType="recording"
        >
            <WavesIcon />
        </IconWithOverlay>
    );
};

// Wrapper component for orbital sources icon that reads Redux state
const OrbitalSourcesIconWithStatus = () => {
    const isSynchronizing = useSelector((state) => state.syncSatellite?.synchronizing);
    const syncState = useSelector((state) => state.syncSatellite?.syncState);
    const normalizedStatus = String(syncState?.status || '').toLowerCase();
    const hasSyncErrors = Array.isArray(syncState?.errors) && syncState.errors.length > 0;
    // Show a persistent red LED when the latest completed sync reported errors.
    const hasCompletedWithErrors = normalizedStatus === 'complete' && hasSyncErrors && !isSynchronizing;
    const showOverlay = isSynchronizing || hasCompletedWithErrors;
    const overlayType = isSynchronizing ? 'sync' : 'error';

    return (
        <IconWithOverlay showOverlay={showOverlay} overlayType={overlayType}>
            <TleIcon />
        </IconWithOverlay>
    );
};

// Wrapper component for celestial icon that reads Redux state
const CelestialIconWithStatus = () => {
    const solarLoading = useSelector((state) => state.celestial?.solarLoading);
    const tracksLoading = useSelector((state) => state.celestial?.tracksLoading);
    const showOverlay = Boolean(solarLoading || tracksLoading);

    return (
        <IconWithOverlay showOverlay={showOverlay} overlayType="sync">
            <CelestialSolarIcon />
        </IconWithOverlay>
    );
};

// Wrapper component for earth view icon that reads Redux state
const EarthViewIconWithStatus = () => {
    const loadingSatellites = useSelector((state) => state.earthViewTrack?.loadingSatellites);
    const passesLoading = useSelector((state) => state.earthViewTrack?.passesLoading);
    const selectedSatGroupId = useSelector((state) => state.earthViewTrack?.selectedSatGroupId);
    const normalizedSelectedSatGroupId = String(selectedSatGroupId || '').trim();
    // Ignore initial/default state before any valid group is selected to avoid persistent false-positive spinner.
    const hasSelectedSatGroup = Boolean(
        normalizedSelectedSatGroupId && normalizedSelectedSatGroupId !== 'none'
    );
    const showOverlay = Boolean(hasSelectedSatGroup && (loadingSatellites || passesLoading));

    return (
        <IconWithOverlay showOverlay={showOverlay} overlayType="sync">
            <PublicIcon />
        </IconWithOverlay>
    );
};

// Wrapper component for FolderIcon that reads Redux state
const FileBrowserIconWithStatus = () => {
    const hasNewFiles = useSelector((state) => state.filebrowser?.hasNewFiles);
    const location = useLocation();

    // Only show notification if NOT currently on the file browser page
    const isOnFileBrowserPage = location.pathname === '/files' || location.pathname === '/filebrowser';
    const showNotification = hasNewFiles && !isOnFileBrowserPage;

    return (
        <IconWithOverlay showOverlay={showNotification} overlayType="new">
            <FolderIcon />
        </IconWithOverlay>
    );
};

// Wrapper component for EventNoteIcon that reads Redux state
const SchedulerIconWithStatus = () => {
    const observations = useSelector((state) => state.scheduler?.observations || []);

    // Check if any observation has status "running"
    const hasActiveObservation = observations.some(obs => obs.status === 'running');

    return (
        <IconWithOverlay showOverlay={hasActiveObservation} overlayType="play">
            <EventNoteIcon />
        </IconWithOverlay>
    );
};

export const getNavigation = ({ isAdmin = false } = {}) => {
    const operationsSection = [
        {
            kind: 'header',
            title: i18n.t('operations', { ns: 'navigation', defaultValue: 'Operations' }),
        },
        {
            segment: 'solarsystem',
            title: i18n.t('solar_system', { ns: 'navigation', defaultValue: 'Solar System' }),
            icon: <CelestialIconWithStatus />,
        },
        {
            segment: 'earthview',
            title: i18n.t('earthview', { ns: 'navigation', defaultValue: 'Earth view' }),
            icon: <EarthViewIconWithStatus />,
        },
        {
            segment: 'tracking',
            title: i18n.t('live_tracking', { ns: 'navigation', defaultValue: 'Live Tracking' }),
            icon: <GpsFixedIcon/>,
        },
        {
            segment: 'waterfall',
            title: i18n.t('waterfall_view', { ns: 'navigation' }),
            icon: <WaterfallIconWithStatus />,
        },
        {
            segment: 'files',
            title: i18n.t('files', { ns: 'navigation', defaultValue: 'Files' }),
            icon: <FileBrowserIconWithStatus />,
        },
        {
            segment: 'scheduler',
            title: i18n.t('scheduler', { ns: 'navigation', defaultValue: 'Scheduler' }),
            icon: <SchedulerIconWithStatus />,
            dynamicTooltip: true, // Flag to indicate this item needs dynamic tooltip
        },
    ];

    const administrationSection = [
        {kind: 'divider'},
        {
            kind: 'header',
            title: i18n.t('satellites', { ns: 'navigation' }),
        },
        {
            segment: 'admin/satellites/sources',
            title: i18n.t('orbital_sources', { ns: 'navigation', defaultValue: 'Orbital Data' }),
            icon: <OrbitalSourcesIconWithStatus />,
        },
        {
            segment: 'admin/satellites/catalog',
            title: i18n.t('catalog', { ns: 'navigation', defaultValue: 'Catalog' }),
            icon: <Satellite03Icon/>,
        },
        {
            segment: 'admin/satellites/groups',
            title: i18n.t('groups', { ns: 'navigation' }),
            icon: <GroupWorkIcon/>,
        },
        {kind: 'divider'},
        {
            kind: 'header',
            title: i18n.t('system', { ns: 'navigation', defaultValue: 'System' }),
        },
        {
            segment: 'admin/system/general',
            title: i18n.t('general', { ns: 'navigation', defaultValue: 'General' }),
            icon: <SettingsApplicationsIcon/>,
        },
        {
            segment: 'admin/system/location',
            title: i18n.t('location', { ns: 'navigation' }),
            icon: <LocationOnIcon/>,
        },
        {
            segment: 'admin/system/users',
            title: i18n.t('users', { ns: 'navigation', defaultValue: 'Users' }),
            icon: <GroupIcon />,
        },
        {
            segment: 'admin/system/hardware',
            title: i18n.t('hardware', { ns: 'navigation' }),
            icon: <MemoryIcon/>,
        },
        {
            segment: 'admin/system/maintenance',
            title: i18n.t('maintenance', { ns: 'navigation' }),
            icon: <EngineeringIcon/>,
        },
        {
            segment: 'admin/system/about',
            title: i18n.t('about', { ns: 'navigation' }),
            icon: <InfoIcon/>,
        },
    ];

    if (!isAdmin) {
        return [...operationsSection];
    }

    return [...operationsSection, ...administrationSection];
};

// Keep NAVIGATION for backward compatibility but make it dynamic
export const NAVIGATION = getNavigation();
