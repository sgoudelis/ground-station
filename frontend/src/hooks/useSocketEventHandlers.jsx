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

import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from '../utils/toast-with-timestamp.jsx';
import { Box } from '@mui/material';
import { useTranslation } from 'react-i18next';

// Toast message component with title and body
const ToastMessage = ({ title, body }) => (
    <div>
        <div style={{ fontWeight: 600, marginBottom: '4px' }}>{title}</div>
        {body && <div style={{ fontSize: '13px', opacity: 0.9 }}>{body}</div>}
    </div>
);

import SyncIcon from '@mui/icons-material/Sync';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';
import SettingsInputAntennaIcon from '@mui/icons-material/SettingsInputAntenna';
import RadioIcon from '@mui/icons-material/Radio';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ExploreIcon from '@mui/icons-material/Explore';
import { store } from '../components/common/store.jsx';
import { setSyncState } from '../components/satellites/synchronize-slice.jsx';
import { setSatelliteData, setSatelliteContext, setUITrackerValues, setTrackerCommandStatus, setHardwareSnapshot, fetchTrackerCommands, markTrackerCommandsUnknown } from '../components/target/target-slice.jsx';
import {isCommandOutstanding} from '../components/target/tracker-command-state.js';
import { setObserverSkyBodies, setTargetCelestialLivePointing } from '../components/celestial/celestial-slice.jsx';
import { buildTargetKeyFromTrackingState } from '../components/target/celestial-target-utils.js';
import { setTrackerInstances } from '../components/target/tracker-instances-slice.jsx';
import { setSynchronizing } from '../components/satellites/synchronize-slice.jsx';
import { initializeAppData } from '../services/data-sync.js';
import { fetchVersionInfo } from '../components/dashboard/version-slice.jsx';
import {
    setIsRecording,
    setRecordingDuration,
    setRecordingStartTime,
    updateSDRConfig,
    setIsStreaming,
    setJoinedSdrId,
    setErrorMessage,
    setErrorDialogOpen,
    setStartStreamingLoading,
} from '../components/waterfall/waterfall-slice.jsx';
import {
    resetGnssFixLifecycle,
    updateGnssFixLifecycleFromStatus,
    updateGnssFixLifecycleFromOutput,
} from '../components/waterfall/gnss-slice.jsx';
import { checkForNewFiles, fetchFiles, setPlaybackRecordings, purgeProgressUpdated, purgeFinished } from '../components/filebrowser/filebrowser-slice.jsx';
import {
    setConnected,
    setConnecting,
    setConnectionError,
    setDisconnected,
    setInitialDataLoading,
    setInitialDataProgress,
    setReConnectAttempt,
} from '../components/dashboard/dashboard-slice.jsx';
import {
    decoderStatusChanged,
    isStaleDecoderStatus,
    decoderProgressUpdated,
    decoderOutputReceived,
    clearGnssOutputsForDecoder,
    setCurrentSessionId,
    cleanupStaleDecoders,
} from '../components/decoders/decoders-slice.jsx';
import { updateMetrics } from '../components/performance/performance-slice.jsx';
import { setSystemInfo } from '../components/settings/system-info-slice.jsx';
import { setRuntimeSnapshot } from '../components/settings/sessions-slice.jsx';
import { loadAuthStatus } from '../components/auth/auth-slice.jsx';
import { fetchSatelliteGroups } from '../components/earthview/earthview-slice.jsx';
import { addTranscription } from '../components/waterfall/transcription-slice.jsx';
import { fetchSoapySDRServers } from '../components/hardware/sdr-slice.jsx';
import ImageIcon from '@mui/icons-material/Image';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import { observationStatusUpdated, fetchScheduledObservations } from '../components/scheduler/scheduler-slice.jsx';
import {
    taskStarted,
    taskProgress,
    taskCompleted,
    taskStopped,
    taskError,
    reconcileTaskSnapshot,
} from '../components/tasks/tasks-slice.jsx';
import {
    setCelestialSceneLive,
    setCelestialEphemerisStatus,
    setCelestialTracksLive,
    applyCelestialTracksLiveDelta,
    setSolarSceneLive,
    upsertCelestialTrackRowsLive,
    upsertSolarSystemBodiesLive,
} from '../components/celestial/celestial-slice.jsx';

const CELESTIAL_LIVE_UPDATE_BATCH_MS = 200;

/**
 * Custom hook to handle all socket event listeners
 * @param {Object} socket - Socket.IO connection instance
 * @param {boolean} enabled - whether event handlers should be active
 */
export const useSocketEventHandlers = (socket, enabled = true) => {
    const { t } = useTranslation('common');
    const dispatch = useDispatch();
    const hasVersionChanged = useSelector((state) => state.version.hasVersionChanged);
    const pendingSyncRef = useRef(null);
    const bootstrapGenerationRef = useRef(0);

    // Track which observations have been notified to prevent duplicate notifications
    const notifiedVisibility = useRef(new Set());

    // Dismissing the update dialog allows the existing page to finish loading.
    // Reload leaves the flag set, so no old-client data requests are started.
    useEffect(() => {
        if (hasVersionChanged || !pendingSyncRef.current) return;
        const resume = pendingSyncRef.current;
        pendingSyncRef.current = null;
        void resume();
    }, [hasVersionChanged]);

    useEffect(() => {
        if (!socket || !enabled) return;
        let lastBootstrappedSocketId = null;
        const isCurrentSession = (generation, socketId) =>
            bootstrapGenerationRef.current === generation
            && socket.connected
            && socket.id === socketId;

        const syncBackgroundTaskSnapshot = async () => {
            try {
                const taskListReply = await socket.emitWithAck("api.call", {
                    cmd: "background-task.list",
                    data: {
                        only_running: false,
                    },
                });
                if (taskListReply?.success) {
                    dispatch(reconcileTaskSnapshot({ tasks: taskListReply.tasks || [] }));
                } else {
                    console.warn('Failed to fetch background task snapshot:', taskListReply?.error);
                }
            } catch (error) {
                console.warn('Error fetching background task snapshot:', error);
            }
        };

        const continueBootstrap = async (generation, socketId) => {
            if (!isCurrentSession(generation, socketId)) return;

            // Reconnect bootstrap pulls wait for the version decision, including
            // task reconciliation and the tracker command snapshot.
            store.dispatch(setCurrentSessionId(socketId));
            setTimeout(() => {
                if (isCurrentSession(generation, socketId)) {
                    store.dispatch(cleanupStaleDecoders());
                }
            }, 1000);

            await syncBackgroundTaskSnapshot();
            if (!isCurrentSession(generation, socketId)) return;
            await initializeAppData(socket);
            if (!isCurrentSession(generation, socketId)) return;
            store.dispatch(checkForNewFiles({ socket }));
            await dispatch(fetchTrackerCommands({socket}));
        };

        const handleConnect = async () => {
            // Avoid duplicate bootstrap for the same socket session when listeners
            // attach after the socket is already connected.
            if (socket.id && socket.id === lastBootstrappedSocketId) {
                return;
            }
            lastBootstrappedSocketId = socket.id || null;
            const generation = ++bootstrapGenerationRef.current;
            const socketId = socket.id;
            pendingSyncRef.current = null;

            console.log('Socket connected with ID:', socket.id, socket);

            // Update connection state
            dispatch(setConnecting(false));
            dispatch(setConnected(true));
            dispatch(setDisconnected(false));
            dispatch(setConnectionError(null));
            dispatch(setReConnectAttempt(0));
            dispatch(setInitialDataLoading(true));
            dispatch(setInitialDataProgress({ completed: 0, total: 0 }));

            // Re-validate auth/setup state after each reconnect.
            // This prevents stale runtime UI when backend setup state changed
            // (for example, reconnecting against a fresh temp DB).
            try {
                const authStatus = await dispatch(loadAuthStatus()).unwrap();
                if (authStatus?.setup_required || !authStatus?.authenticated) {
                    dispatch(setInitialDataLoading(false));
                    dispatch(setInitialDataProgress({ completed: 0, total: 0 }));
                    return;
                }
            } catch {
                // If status refresh fails, continue with runtime bootstrap path.
            }

            if (!isCurrentSession(generation, socketId)) return;

            // Version detection must finish before any bulk sync. A failed check
            // still permits loading so a transient error cannot strand the UI.
            await dispatch(fetchVersionInfo({ socket }));
            if (!isCurrentSession(generation, socketId)) return;
            if (store.getState().version.hasVersionChanged) {
                pendingSyncRef.current = () => continueBootstrap(generation, socketId);
                dispatch(setInitialDataLoading(false));
                dispatch(setInitialDataProgress({ completed: 0, total: 0 }));
                return;
            }

            // toast.success(
            //     <ToastMessage
            //         title={t('notifications.connection.connected_to_backend')}
            //         body={`${socket.io.opts.secure ? 'wss://' : 'ws://'}${socket.io.opts.hostname}:${socket.io.opts.port}${socket.io.opts.path}`}
            //     />,
            //     {
            //         icon: () => <CableIcon/>,
            //     }
            // );
            await continueBootstrap(generation, socketId);
        };

        // Connection event
        socket.on('connect', handleConnect);
        if (socket.connected) {
            void handleConnect();
        }

        // Reconnection attempt event
        socket.on("reconnect_attempt", (attempt) => {
            dispatch(setReConnectAttempt(attempt));
            dispatch(setConnecting(true));
            dispatch(setDisconnected(false));
            dispatch(setConnectionError(null));
            toast.info(
                <ToastMessage
                    title={t('notifications.connection.reconnecting_to_backend')}
                    body={t('notifications.connection.attempt', { attempt })}
                />,
                {
                    icon: () => <SyncIcon />,
                }
            );
        });

        // Live system info stream
        socket.on('system-info', (payload) => {
            try {
                store.dispatch(setSystemInfo(payload));
            } catch (e) {
                console.error('Failed to update system info from socket:', e);
            }
        });

        // Authenticated-only runtime snapshot stream.
        socket.on('session-runtime-snapshot', (snapshot) => {
            try {
                store.dispatch(setRuntimeSnapshot(snapshot));
            } catch (e) {
                console.error('Failed to update session runtime snapshot from socket:', e);
            }
        });

        // Error event
        socket.on("error", (error) => {
            dispatch(setConnectionError(typeof error === 'string' ? error : JSON.stringify(error)));
            toast.error(
                <ToastMessage
                    title={t('notifications.connection.connection_error')}
                    body={error}
                />,
                {
                    icon: () => <ErrorOutlineIcon />,
                }
            );
        });

        // Disconnect event
        socket.on('disconnect', () => {
            ++bootstrapGenerationRef.current;
            pendingSyncRef.current = null;
            dispatch(markTrackerCommandsUnknown());
            // Update connection state
            dispatch(setConnecting(true));
            dispatch(setConnected(false));
            dispatch(setDisconnected(true));
            dispatch(setInitialDataLoading(false));
        });

        socket.on('connect_error', (error) => {
            dispatch(setConnecting(false));
            dispatch(setConnected(false));
            dispatch(setDisconnected(true));
            dispatch(setConnectionError(error?.message || t('notifications.connection.unable_to_connect_backend')));
        });

        socket.on('reconnect_error', (error) => {
            dispatch(setConnecting(true));
            dispatch(setConnected(false));
            dispatch(setDisconnected(true));
            dispatch(setConnectionError(error?.message || t('notifications.connection.reconnection_failed')));
        });

        // Satellite sync events
        socket.on("sat-sync-events", (data) => {
            store.dispatch(setSyncState(data));

            // Keep synchronizing flag aligned to backend status, including cancellation/error transitions.
            const isSyncRunning = data.status === 'in_progress'
                || data.status === 'inprogress'
                || data.status === 'started';
            store.dispatch(setSynchronizing(isSyncRunning));

            if (data.status === 'complete' && data.success) {
                // Refresh satellite groups in Redux store so all components get updated.
                if (socket && socket.connected) {
                    store.dispatch(fetchSatelliteGroups({ socket }));
                }
            }
        });

        // UI tracker state event
        socket.on("ui-tracker-state", (data) => {
            store.dispatch(setUITrackerValues(data));
        });

        socket.on("tracker-command-status", (data) => {
            store.dispatch(setTrackerCommandStatus(data));
            if (data.snapshot) store.dispatch(setHardwareSnapshot(data.snapshot));
        });

        socket.on('tracker-hardware-state', data => store.dispatch(setHardwareSnapshot(data)));
        let reconcilingCommands = false;
        const commandTimer = window.setInterval(async () => {
            if (!socket.connected || reconcilingCommands) return;
            const commands = Object.values(store.getState().targetSatTrack.trackerCommandsById || {});
            if (!commands.some(isCommandOutstanding)) return;
            reconcilingCommands = true;
            try { await store.dispatch(fetchTrackerCommands({socket})); }
            finally { reconcilingCommands = false; }
        }, 5000);

        socket.on("tracker-instances", (data) => {
            store.dispatch(setTrackerInstances(data));
        });

        const refreshLibraryPage = () => {
            const browser = store.getState().filebrowser;
            store.dispatch(fetchFiles({
                socket,
                filters: browser.filters,
                search: browser.search,
                sortBy: browser.sortBy,
                sortOrder: browser.sortOrder,
                page: browser.page,
                pageSize: browser.pageSize,
            }));
            store.dispatch(checkForNewFiles({ socket }));
        };

        // Legacy producer events still announce that storage changed.  Listing
        // itself is now an acknowledged request, not a broadcast payload.
        const handleFileBrowserState = (state) => {
            switch (state.action) {
                case 'list-recordings':
                    // SigMF playback owns an unfiltered recording list. Do not
                    // let File Browser filter changes empty the SDR selector.
                    store.dispatch(setPlaybackRecordings(state.items || []));
                    break;

                case 'delete-recording':
                case 'delete-snapshot':
                case 'delete-decoded':
                case 'delete-observation-bundle':
                    // No toast notification for deletions
                    break;

                case 'recording-started':
                case 'recording-stopped':
                case 'snapshot-saved':
                case 'audio-recording-started':
                case 'audio-recording-stopped':
                case 'transcription-started':
                case 'transcription-file-created':
                case 'transcription-stopped':
                case 'decoded-saved':
                case 'waterfall-generated':
                case 'satdump-completed':
                case 'observation-bundle-created':
                case 'observation-bundle-finalized':
                    // The producer has also emitted a compact library.changed
                    // event after updating the shared in-memory catalogue.
                    break;

                default:
                    console.warn('Unknown file browser action:', state.action);
            }
        };
        socket.on("file_browser_state", handleFileBrowserState);

        // A library mutation is compact and includes stable IDs; refetching
        // just the current server-side page also handles sort-position moves.
        socket.on("library.changed", refreshLibraryPage);

        // Date-based purge sweeps stream coarse-grained progress and a single
        // terminal event; the purge dialog renders them from the store.
        const handlePurgeProgress = (data) => store.dispatch(purgeProgressUpdated(data));
        const handlePurgeDone = (data) => store.dispatch(purgeFinished(data));
        socket.on("library_purge_progress", handlePurgeProgress);
        socket.on("library_purge_done", handlePurgeDone);

        // File browser errors
        socket.on("file_browser_error", (errorData) => {
            console.error('File browser error:', errorData);
            toast.error(errorData.error || t('notifications.file_browser.error'));
        });

        // Recording state updates (pub/sub model)
        socket.on("recording_state", (state) => {
            console.log('Recording state received:', state);

            switch (state.action) {
                case 'started':
                    if (state.success) {
                        store.dispatch(setIsRecording(true));
                        store.dispatch(setRecordingDuration(0));
                        store.dispatch(setRecordingStartTime(new Date().toISOString()));
                        toast.success(t('notifications.recording.started'));
                    }
                    break;

                case 'stopped':
                    if (state.success) {
                        store.dispatch(setIsRecording(false));
                        store.dispatch(setRecordingDuration(0));
                        store.dispatch(setRecordingStartTime(null));
                        toast.success(t('notifications.recording.stopped'));
                    }
                    break;

                case 'start-failed':
                    toast.error(t('notifications.recording.start_failed', { error: state.error }));
                    break;

                case 'stop-failed':
                    toast.error(t('notifications.recording.stop_failed', { error: state.error }));
                    break;
            }
        });

        // VFO states are now managed entirely in the UI
        // Backend no longer sends vfo-states or vfo-frequency-update events

        // SDR configuration error events
        socket.on('sdr-config-error', (error) => {
            store.dispatch(setErrorMessage(error.message));
            store.dispatch(setErrorDialogOpen(true));
            store.dispatch(setStartStreamingLoading(false));
        });

        // SDR error events
        socket.on('sdr-error', (error) => {
            store.dispatch(setErrorMessage(error.message));
            store.dispatch(setErrorDialogOpen(true));
            store.dispatch(setStartStreamingLoading(false));
            // Stop streaming on error - waterfall component will handle animation cleanup
            // A failed control request must not detach a joined participant.
            if (!store.getState()?.waterfall?.joinedSdrId) {
                store.dispatch(setIsStreaming(false));
            }
        });

        // SDR configuration updates
        socket.on('sdr-config', (data) => {
            const currentSdrId = store.getState()?.waterfall?.selectedSDRId;
            if (data?.sdr_id && data.sdr_id !== currentSdrId) return;
            store.dispatch(updateSDRConfig({ ...data, sdr_id: data?.sdr_id || currentSdrId }));
        });

        // SDR streaming status
        socket.on('sdr-status', (data) => {
            if (data['streaming'] === true) {
                const wasStreaming = Boolean(store.getState()?.waterfall?.isStreaming);
                if (!wasStreaming) {
                    // Start of a new stream session: clear stale GNSS fix lifecycle status.
                    store.dispatch(resetGnssFixLifecycle());
                }
                store.dispatch(setIsStreaming(true));
                store.dispatch(setStartStreamingLoading(false));
            } else if (data['streaming'] === false) {
                store.dispatch(setIsStreaming(false));
                store.dispatch(setJoinedSdrId(null));
                store.dispatch(setStartStreamingLoading(false));
            }
        });

        // Satellite tracking events
        socket.on("satellite-tracking", (message) => {
            store.dispatch(setSatelliteData(message));
            const trackingState = message?.tracking_state || {};
            const targetKey = buildTargetKeyFromTrackingState(trackingState);
            const azDeg = Number(message?.satellite_data?.position?.az);
            const elDeg = Number(message?.satellite_data?.position?.el);
            if (targetKey && Number.isFinite(azDeg) && Number.isFinite(elDeg)) {
                // The tracker already calculates the active target's live sky
                // position. Overlay it onto any cached target scene instead of
                // repeatedly fetching the same ephemeris/pass forecast.
                store.dispatch(setTargetCelestialLivePointing({
                    targetKey,
                    azDeg,
                    elDeg,
                    timestampUtc: new Date().toISOString(),
                }));
            }
            if (message['events']) {
                message['events'].forEach(event => {
                    if (event.name === 'rotator_connected') {
                        // Intentionally silent: suppress rotator connect toast.
                    } else if (event.name === 'rotator_disconnected') {
                        // Intentionally silent: suppress rotator disconnect toast.
                    } else if (event.name === 'rig_connected') {
                        // Intentionally silent: suppress rig connect toast.
                    } else if (event.name === 'rig_disconnected') {
                        // Intentionally silent: suppress rig disconnect toast.
                    } else if (event.name === 'min_elevation_out_of_bounds') {
                        const satelliteData = message?.satellite_data;
                        const satName = satelliteData?.details?.name || t('unknown');
                        const noradId = satelliteData?.details?.norad_id || '';
                        toast.error(
                            <ToastMessage
                                title={t('notifications.tracking.below_min_elevation')}
                                body={t('notifications.tracking.satellite_info', { name: satName, noradId })}
                            />,
                            {
                                icon: () => <ArrowDownwardIcon />,
                            }
                        );
                    } else if (event.name === 'max_elevation_out_of_bounds') {
                        const satelliteData = message?.satellite_data;
                        const satName = satelliteData?.details?.name || t('unknown');
                        const noradId = satelliteData?.details?.norad_id || '';
                        toast.error(
                            <ToastMessage
                                title={t('notifications.tracking.above_max_elevation')}
                                body={t('notifications.tracking.satellite_info', { name: satName, noradId })}
                            />,
                            {
                                icon: () => <ArrowUpwardIcon />,
                            }
                        );
                    } else if (event.name === 'min_azimuth_out_of_bounds') {
                        const satelliteData = message?.satellite_data;
                        const satName = satelliteData?.details?.name || t('unknown');
                        const noradId = satelliteData?.details?.norad_id || '';
                        toast.error(
                            <ToastMessage
                                title={t('notifications.tracking.below_min_azimuth')}
                                body={t('notifications.tracking.satellite_info', { name: satName, noradId })}
                            />,
                            {
                                icon: () => <ExploreIcon />,
                            }
                        );
                    } else if (event.name === 'max_azimuth_out_of_bounds') {
                        const satelliteData = message?.satellite_data;
                        const satName = satelliteData?.details?.name || t('unknown');
                        const noradId = satelliteData?.details?.norad_id || '';
                        toast.error(
                            <ToastMessage
                                title={t('notifications.tracking.above_max_azimuth')}
                                body={t('notifications.tracking.satellite_info', { name: satName, noradId })}
                            />,
                            {
                                icon: () => <ExploreIcon />,
                            }
                        );
                    } else if (event.name === 'norad_id_change') {
                        // Intentionally silent: suppress target change toast.
                    } else if (event.name === 'rotator_error') {
                        const rotatorData = message['rotator_data'];
                        toast.error(
                            <ToastMessage
                                title={event.error}
                                body={`${rotatorData.host}:${rotatorData.port}`}
                            />,
                            {
                                icon: () => <SettingsInputAntennaIcon />,
                            }
                        );
                    } else if (event.name === 'rig_error') {
                        const rigData = message['rig_data'];
                        toast.error(
                            <ToastMessage
                                title={event.error}
                                body={`${rigData.host}:${rigData.port}`}
                            />,
                            {
                                icon: () => <RadioIcon />,
                            }
                        );
                    }
                });
            }
        });

        socket.on('satellite-tracking-context', (message) => {
            store.dispatch(setSatelliteContext(message));
        });

        socket.on('observer-sky-update', (message) => {
            if (Array.isArray(message?.observer_bodies) && message.observer_bodies.length > 0) {
                store.dispatch(setObserverSkyBodies(message.observer_bodies));
            }
        });

        // Performance metrics events
        socket.on('performance-metrics', (data) => {
            store.dispatch(updateMetrics(data));
        });

        // Transcription data from Google Gemini API
        socket.on('transcription-data', (data) => {
            // data = { text, session_id, vfo_number, language, is_final }
            console.log('[Transcription] Received:', data);
            store.dispatch(addTranscription({
                text: data.text,
                sessionId: data.session_id,
                vfoNumber: data.vfo_number,
                language: data.language,
                detectedLanguage: data.detected_language,
                is_final: data.is_final || false
            }));
        });

        // Transcription errors from Google Gemini API
        socket.on('transcription-error', (data) => {
            // data = { error_type, message, details, session_id }
            const errorIcon = data.error_type === 'quota_exceeded' ? '💰' :
                            data.error_type === 'invalid_api_key' ? '🔑' :
                            data.error_type === 'rate_limit' ? '⏱️' :
                            data.error_type === 'network_error' ? '🌐' : '⚠️';

            toast.error(
                <ToastMessage
                    title={t('notifications.transcription.error_title', { icon: errorIcon })}
                    body={data.message}
                />,
                {
                    autoClose: data.error_type === 'rate_limit' ? 5000 : 10000,
                }
            );
        });

        // Scheduler observation status updates
        socket.on('observation-status-update', (data) => {
            store.dispatch(observationStatusUpdated(data));

            // Show toast notification for observation status changes
            const state = store.getState();
            const observation = state.scheduler.observations.find(obs => obs.id === data.id);

            if (observation && observation.enabled) {
                const satName = observation.satellite?.name || t('unknown');
                const obsName = observation.name || satName;

                if (data.status === 'running') {
                    // Running state is surfaced in the top-bar banner.
                    // Keep notifications quieter by not showing an additional start toast here.
                } else if (data.status === 'completed') {
                    // Observation completed successfully
                    const startTime = observation.task_start || observation.pass?.event_start;
                    const endTime = observation.task_end || observation.pass?.event_end;
                    let duration = '';
                    if (startTime && endTime) {
                        const durationMs = new Date(endTime) - new Date(startTime);
                        const minutes = Math.floor(durationMs / 60000);
                        const seconds = Math.floor((durationMs % 60000) / 1000);
                        duration = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
                    }

                    const details = [
                        t('notifications.observation.satellite_line', { name: satName }),
                        duration ? t('notifications.observation.duration_line', { duration }) : null,
                        observation.tasks?.length > 0
                            ? t('notifications.observation.tasks_completed', { count: observation.tasks.length })
                            : null,
                    ].filter(Boolean).join('\n');

                    toast.success(
                        <ToastMessage
                            title={t('notifications.observation.completed_title', { name: obsName })}
                            body={details}
                        />,
                        {
                            icon: () => <CheckCircleIcon />,
                            autoClose: 8000,
                        }
                    );
                } else if (data.status === 'failed') {
                    // Observation failed
                    toast.error(
                        <ToastMessage
                            title={t('notifications.observation.failed_title', { name: obsName })}
                            body={t('notifications.observation.satellite_line', { name: satName })}
                        />,
                        {
                            icon: () => <ErrorOutlineIcon />,
                            autoClose: 10000,
                        }
                    );
                } else if (data.status === 'cancelled') {
                    // Observation cancelled
                    toast.warning(
                        <ToastMessage
                            title={t('notifications.observation.cancelled_title', { name: obsName })}
                            body={t('notifications.observation.satellite_line', { name: satName })}
                        />,
                        {
                            icon: () => <CancelIcon />,
                            autoClose: 6000,
                        }
                    );
                }
            }
        });

        // Scheduler observations changed (refetch all)
        socket.on('scheduled-observations-changed', () => {
            store.dispatch(fetchScheduledObservations({ socket }));
        });

        // Monitor observation timing events (satellite visibility)
        const checkObservationTiming = () => {
            const state = store.getState();
            const observations = state.scheduler?.observations || [];
            const now = new Date();

            observations.forEach(obs => {
                if (!obs.enabled || obs.status !== 'scheduled' || !obs.pass) return;

                const satName = obs.satellite?.name || t('unknown');
                const eventStart = new Date(obs.pass.event_start); // AOS
                const taskStart = new Date(obs.task_start || obs.pass.event_start);

                // Check if event_start and task_start are the same (within 1 second tolerance)
                const eventAndTaskSame = Math.abs(eventStart - taskStart) < 1000;

                // Check for satellite visibility (AOS reached but task not started)
                const timeUntilAOS = eventStart - now;
                const timeUntilStart = taskStart - now;

                // Only notify about satellite visibility if event_start and task_start are different
                if (!eventAndTaskSame && timeUntilAOS > -30000 && timeUntilAOS <= 0 && !notifiedVisibility.current.has(obs.id)) {
                    notifiedVisibility.current.add(obs.id);

                    const minutesUntilStart = Math.ceil(timeUntilStart / 60000);
                    const peakElevation = obs.pass.peak_altitude ? `${obs.pass.peak_altitude.toFixed(0)}°` : t('not_available');

                    const details = [
                        t('notifications.observation.peak_elevation_line', { peakElevation }),
                        minutesUntilStart > 0
                            ? t('notifications.observation.starts_in', { count: minutesUntilStart })
                            : t('notifications.observation.starts_now'),
                        obs.sdr?.name ? `SDR: ${obs.sdr.name}` : null,
                    ].filter(Boolean).join('\n');

                    toast.info(
                        <ToastMessage
                            title={t('notifications.observation.visible_title', { name: satName })}
                            body={details}
                        />,
                        {
                            icon: () => <VisibilityIcon />,
                            autoClose: 8000,
                        }
                    );

                    // Clean up notification tracking after observation would have ended
                    const endTime = new Date(obs.task_end || obs.pass.event_end);
                    const cleanupDelay = endTime - now + 60000; // 1 minute after end
                    setTimeout(() => {
                        notifiedVisibility.current.delete(obs.id);
                    }, Math.max(0, cleanupDelay));
                }
            });
        };

        // Check observation timing every 5 seconds
        const timingInterval = setInterval(checkObservationTiming, 5000);
        // Run immediately on mount
        checkObservationTiming();

        // Decoder data events (SSTV, APRS, Morse, GMSK, Transcription, etc.)
        socket.on('decoder-data', (data) => {
            // Some backends/bridges can emit an empty decoder payload transiently.
            // Guarding here avoids crashing the app shell on malformed events.
            if (!data || typeof data !== 'object' || typeof data.type !== 'string') {
                return;
            }

            switch (data.type) {
                case 'decoder-status':
                    // Filter before GNSS lifecycle side effects as well as the
                    // decoder label update, so old instances cannot reset a new run.
                    if (isStaleDecoderStatus(
                        store.getState().decoders.active[data.vfo ? `${data.session_id}_vfo${data.vfo}` : data.session_id],
                        data
                    )) {
                        break;
                    }
                    // GNSS decoder restart: clear GNSS table/fix timeline so UI reflects a fresh session.
                    if (data.decoder_type === 'gnss') {
                        dispatch(updateGnssFixLifecycleFromStatus(data));
                    }
                    if (data.decoder_type === 'gnss' && String(data.status || '').toLowerCase() === 'starting') {
                        store.dispatch(clearGnssOutputsForDecoder({
                            session_id: data.session_id,
                            vfo: data.vfo,
                        }));
                    }
                    store.dispatch(decoderStatusChanged({
                        session_id: data.session_id,
                        status: data.status,
                        mode: data.mode,
                        decoder_type: data.decoder_type,
                        decoder_id: data.decoder_id,  // Track decoder instance ID for restart handling
                        worker_started_at: data.worker_started_at,
                        vfo: data.vfo,
                        timestamp: data.timestamp,
                        progress: data.progress,
                        info: data.info  // Include decoder configuration info (baudrate, framing, etc.)
                    }));
                    break;

                case 'decoder-progress':
                    store.dispatch(decoderProgressUpdated({
                        session_id: data.session_id,
                        decoder_id: data.decoder_id,
                        vfo: data.vfo,
                        progress: data.progress,
                        timestamp: data.timestamp,
                        info: data.info
                    }));
                    break;

                case 'decoder-output': {
                    // Keep a persisted GNSS fix lifecycle timeline updated from live decoder output.
                    if (data.decoder_type === 'gnss') {
                        dispatch(updateGnssFixLifecycleFromOutput(data));
                    }
                    store.dispatch(decoderOutputReceived(data));

                    // SSTV images appear in the decoded output UI without interrupting the user.
                    // Keep the image toast for GeoScan output; text decoders are too frequent for toasts.
                    if (data.decoder_type === 'geoscanimage' && data.output.image_data) {
                        const outputType = data.output.format;
                        const fileName = data.output.filename;
                        const imageData = data.output.image_data;

                        toast.success(
                            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                                <ToastMessage
                                    title={t('notifications.decoder.output_received')}
                                    body={`${data.decoder_type.toUpperCase()}: ${fileName}`}
                                />
                                <Box
                                    component="img"
                                    src={`data:${outputType};base64,${imageData}`}
                                    alt={fileName}
                                    sx={{
                                        maxWidth: '100%',
                                        maxHeight: '200px',
                                        objectFit: 'contain',
                                        borderRadius: '4px',
                                        marginTop: '8px'
                                    }}
                                />
                            </Box>,
                            {
                                icon: () => <ImageIcon />,
                                autoClose: 10000,
                            }
                        );
                    }
                    break;
                }

                default:
                    console.warn('Unknown decoder event type:', data.type);
            }
        });

        // Background task event handlers
        socket.on('background_task:started', (data) => {
            dispatch(taskStarted(data));
        });

        socket.on('background_task:progress', (data) => {
            dispatch(taskProgress(data));
        });

        socket.on('background_task:completed', (data) => {
            dispatch(taskCompleted(data));
        });

        socket.on('background_task:stopped', (data) => {
            dispatch(taskStopped(data));
            toast.warning(
                <ToastMessage
                    title={t('notifications.tasks.stopped_title', { name: data.name })}
                    body={t('notifications.tasks.duration_seconds', { seconds: Math.floor(data.duration / 1000) })}
                />,
                {
                    icon: () => <CancelIcon />,
                    autoClose: 5000,
                }
            );
        });

        socket.on('background_task:error', (data) => {
            dispatch(taskError(data));
            toast.error(
                <ToastMessage
                    title={t('notifications.tasks.error_title', { name: data.name })}
                    body={data.error}
                />,
                {
                    icon: () => <ErrorOutlineIcon />,
                    autoClose: 8000,
                }
            );
        });

        socket.on('background_task:list', (data) => {
            dispatch(reconcileTaskSnapshot(data));
        });

        const pendingCelestialTrackRows = [];
        const pendingSolarSystemBodies = [];
        let celestialLiveUpdateTimer = null;
        const flushCelestialLiveUpdates = () => {
            if (celestialLiveUpdateTimer != null) {
                window.clearTimeout(celestialLiveUpdateTimer);
            }
            celestialLiveUpdateTimer = null;
            if (pendingCelestialTrackRows.length) {
                dispatch(upsertCelestialTrackRowsLive({
                    updates: pendingCelestialTrackRows.splice(0),
                }));
            }
            if (pendingSolarSystemBodies.length) {
                dispatch(upsertSolarSystemBodiesLive({
                    updates: pendingSolarSystemBodies.splice(0),
                }));
            }
        };
        const scheduleCelestialLiveUpdateFlush = () => {
            if (celestialLiveUpdateTimer != null) return;
            celestialLiveUpdateTimer = window.setTimeout(
                flushCelestialLiveUpdates,
                CELESTIAL_LIVE_UPDATE_BATCH_MS,
            );
        };
        const handleCelestialTrackRowUpdate = (data) => {
            pendingCelestialTrackRows.push(data);
            scheduleCelestialLiveUpdateFlush();
        };
        const handleSolarSystemBodyUpdate = (data) => {
            pendingSolarSystemBodies.push(data);
            scheduleCelestialLiveUpdateFlush();
        };

        socket.on('celestial-scene-update', (data) => {
            flushCelestialLiveUpdates();
            dispatch(setCelestialSceneLive(data));
        });
        socket.on('solar-system-scene-update', (data) => {
            flushCelestialLiveUpdates();
            dispatch(setSolarSceneLive(data));
        });
        socket.on('celestial-tracks-update', (data) => {
            flushCelestialLiveUpdates();
            dispatch(setCelestialTracksLive(data));
        });
        socket.on('celestial-tracks-live-update', (data) => {
            dispatch(applyCelestialTracksLiveDelta(data));
        });
        socket.on('celestial-track-row-update', handleCelestialTrackRowUpdate);
        socket.on('solar-system-body-update', handleSolarSystemBodyUpdate);
        socket.on('celestial-ephemeris-status-update', (response) => {
            if (response?.success && response.data) {
                dispatch(setCelestialEphemerisStatus(response.data));
            }
        });

        // SoapySDR discovery events
        socket.on('soapysdr:discovery_started', (data) => {
            console.log('SoapySDR discovery started:', data);
            // Show notification that discovery is running
            toast.info(
                <ToastMessage
                    title={t('notifications.soapysdr.discovery_started_title')}
                    body={t('notifications.soapysdr.discovery_started_body', { duration: data.duration })}
                />,
                {
                    icon: () => <RadioIcon />,
                    autoClose: 3000,
                }
            );
        });

        socket.on('soapysdr:discovery_complete', (data) => {
            console.log('SoapySDR discovery completed:', data);
            // Refresh the server list in Redux store
            dispatch(fetchSoapySDRServers({ socket }));
            void syncBackgroundTaskSnapshot();

            const sdrCount = data.sdr_count ?? data.active_count ?? 0;

            // Show notification
            toast.success(
                <ToastMessage
                    title={t('notifications.soapysdr.discovery_complete_title')}
                    body={t('notifications.soapysdr.discovery_complete_body', {
                        servers: data.server_count,
                        sdrs: sdrCount,
                    })}
                />,
                {
                    icon: () => <RadioIcon />,
                    autoClose: 5000,
                }
            );
        });

        socket.on('soapysdr:refresh_complete', (data) => {
            console.log('SoapySDR refresh completed:', data);
            // Refresh the server list in Redux store
            dispatch(fetchSoapySDRServers({ socket }));
            void syncBackgroundTaskSnapshot();
        });

        socket.on('soapysdr:discovery_error', (data) => {
            console.error('SoapySDR discovery error:', data);
            void syncBackgroundTaskSnapshot();
            toast.error(
                <ToastMessage
                    title={t('notifications.soapysdr.discovery_error_title')}
                    body={data.error}
                />,
                {
                    icon: () => <ErrorOutlineIcon />,
                    autoClose: 8000,
                }
            );
        });

        // Cleanup function
        return () => {
            ++bootstrapGenerationRef.current;
            pendingSyncRef.current = null;
            if (celestialLiveUpdateTimer != null) {
                window.clearTimeout(celestialLiveUpdateTimer);
            }
            clearInterval(timingInterval);
            socket.off('connect', handleConnect);
            socket.off('reconnect_attempt');
            socket.off('connect_error');
            socket.off('reconnect_error');
            socket.off('error');
            socket.off('disconnect');
            socket.off('system-info');
            socket.off('session-runtime-snapshot');
            socket.off("sat-sync-events");
            socket.off("satellite-tracking");
            socket.off("satellite-tracking-context");
            socket.off("observer-sky-update");
            socket.off("ui-tracker-state");
            socket.off("tracker-command-status");
            socket.off('tracker-hardware-state');
            window.clearInterval(commandTimer);
            socket.off("tracker-instances");
            socket.off("file_browser_state", handleFileBrowserState);
            socket.off("library.changed", refreshLibraryPage);
            socket.off("library_purge_progress", handlePurgeProgress);
            socket.off("library_purge_done", handlePurgeDone);
            socket.off("file_browser_error");
            socket.off("recording_state");
            socket.off("vfo-states");
            socket.off("vfo-frequency-update");
            socket.off("sdr-config-error");
            socket.off("sdr-error");
            socket.off("sdr-config");
            socket.off("sdr-status");
            socket.off("performance-metrics");
            socket.off("transcription-data");
            socket.off("transcription-error");
            socket.off("decoder-data");
            socket.off("background_task:started");
            socket.off("background_task:progress");
            socket.off("background_task:completed");
            socket.off("background_task:stopped");
            socket.off("background_task:error");
            socket.off("background_task:list");
            socket.off("celestial-scene-update");
            socket.off("solar-system-scene-update");
            socket.off("celestial-tracks-update");
            socket.off("celestial-tracks-live-update");
            socket.off("celestial-track-row-update");
            socket.off("solar-system-body-update");
            socket.off("celestial-ephemeris-status-update");
            socket.off("observation-status-update");
            socket.off("scheduled-observations-changed");
            socket.off("soapysdr:discovery_started");
            socket.off("soapysdr:discovery_complete");
            socket.off("soapysdr:refresh_complete");
            socket.off("soapysdr:discovery_error");
        };
    }, [socket, enabled, dispatch, t]);
};
