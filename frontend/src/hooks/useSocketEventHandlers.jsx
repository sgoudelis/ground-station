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
import { useDispatch } from 'react-redux';
import { toast } from '../utils/toast-with-timestamp.jsx';
import CableIcon from '@mui/icons-material/Cable';
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
import { setSatelliteData, setUITrackerValues, setTrackerCommandStatus } from '../components/target/target-slice.jsx';
import { setTrackerInstances } from '../components/target/tracker-instances-slice.jsx';
import { setSynchronizing } from '../components/satellites/synchronize-slice.jsx';
import { initializeAppData } from '../services/data-sync.js';
import {
    setIsRecording,
    setRecordingDuration,
    setRecordingStartTime,
    setCenterFrequency,
    setSampleRate,
    setGain,
    setFFTSize,
    setFFTWindow,
    setFFTAveraging,
    updateSDRConfig,
    setIsStreaming,
    setErrorMessage,
    setErrorDialogOpen,
    setStartStreamingLoading,
} from '../components/waterfall/waterfall-slice.jsx';
import {
    resetGnssFixLifecycle,
    updateGnssFixLifecycleFromStatus,
    updateGnssFixLifecycleFromOutput,
} from '../components/waterfall/gnss-slice.jsx';
import { updateAllVFOStates, setVFOProperty } from '../components/waterfall/vfo-marker/vfo-slice.jsx';
import { fetchFiles } from '../components/filebrowser/filebrowser-slice.jsx';
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
    setTaskList,
} from '../components/tasks/tasks-slice.jsx';
import {
    setCelestialSceneLive,
    setCelestialTracksLive,
    setSolarSceneLive,
    upsertCelestialTrackRowLive,
} from '../components/celestial/celestial-slice.jsx';

/**
 * Custom hook to handle all socket event listeners
 * @param {Object} socket - Socket.IO connection instance
 * @param {boolean} enabled - whether event handlers should be active
 */
export const useSocketEventHandlers = (socket, enabled = true) => {
    const { t } = useTranslation('common');
    const dispatch = useDispatch();

    // Track which observations have been notified to prevent duplicate notifications
    const notifiedVisibility = useRef(new Set());

    useEffect(() => {
        if (!socket || !enabled) return;
        let lastBootstrappedSocketId = null;

        const handleConnect = async () => {
            // Avoid duplicate bootstrap for the same socket session when listeners
            // attach after the socket is already connected.
            if (socket.id && socket.id === lastBootstrappedSocketId) {
                return;
            }
            lastBootstrappedSocketId = socket.id || null;

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

            // Update current session ID and clean up stale decoders from previous sessions
            store.dispatch(setCurrentSessionId(socket.id));

            // Clean up any stale decoder entries that survived persistence
            // This handles the case where Redux persisted state has decoders from old sessions
            setTimeout(() => {
                store.dispatch(cleanupStaleDecoders());
            }, 1000);

            // Request current background tasks list (in case tasks started before we connected)
            socket.emit("api.call", {
  cmd: "background-task.list",
  data: {
    filter: 'all'
  }
});

            // toast.success(
            //     <ToastMessage
            //         title={t('notifications.connection.connected_to_backend')}
            //         body={`${socket.io.opts.secure ? 'wss://' : 'ws://'}${socket.io.opts.hostname}:${socket.io.opts.port}${socket.io.opts.path}`}
            //     />,
            //     {
            //         icon: () => <CableIcon/>,
            //     }
            // );
            await initializeAppData(socket);
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

        // Session runtime snapshot stream
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
            dispatch(setConnectionError(error?.message || 'Unable to connect to backend'));
        });

        socket.on('reconnect_error', (error) => {
            dispatch(setConnecting(true));
            dispatch(setConnected(false));
            dispatch(setDisconnected(true));
            dispatch(setConnectionError(error?.message || 'Reconnection failed'));
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
                // Refresh satellite groups in Redux store so all components get updated
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
        });

        socket.on("tracker-instances", (data) => {
            store.dispatch(setTrackerInstances(data));
        });

        // File browser state updates (pub/sub model)
        socket.on("file_browser_state", (state) => {

            switch (state.action) {
                case 'list-files':
                    // Manually dispatch fulfilled action with actual data (not pending)
                    // Backend now returns all files, frontend handles pagination
                    store.dispatch({
                        type: 'filebrowser/fetchFiles/fulfilled',
                        payload: {
                            items: state.items,
                            diskUsage: state.diskUsage,
                            pending: false,
                        },
                    });
                    break;

                case 'delete-recording':
                case 'delete-snapshot':
                case 'delete-decoded':
                    // No toast notification for deletions
                    break;

                case 'recording-started':
                case 'recording-stopped':
                case 'snapshot-saved':
                case 'audio-recording-started':
                case 'audio-recording-stopped':
                case 'transcription-started':
                case 'transcription-stopped':
                case 'decoded-saved':
                case 'waterfall-generated':
                case 'satdump-completed':
                    // Trigger global file list refresh
                    store.dispatch(fetchFiles({
                        socket,
                        showRecordings: store.getState().filebrowser.filters.showRecordings,
                        showSnapshots: store.getState().filebrowser.filters.showSnapshots,
                        showDecoded: store.getState().filebrowser.filters.showDecoded,
                        showAudio: store.getState().filebrowser.filters.showAudio,
                        showTranscriptions: store.getState().filebrowser.filters.showTranscriptions,
                    }));
                    break;

                default:
                    console.warn('Unknown file browser action:', state.action);
            }
        });

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
            toast.error(`Failed to configure SDR: ${error.message}`);
        });

        // SDR error events
        socket.on('sdr-error', (error) => {
            store.dispatch(setErrorMessage(error.message));
            store.dispatch(setErrorDialogOpen(true));
            store.dispatch(setStartStreamingLoading(false));
            // Stop streaming on error - waterfall component will handle animation cleanup
            store.dispatch(setIsStreaming(false));
        });

        // SDR configuration updates
        socket.on('sdr-config', (data) => {
            const currentSdrId = store.getState()?.waterfall?.selectedSDRId;
            store.dispatch(updateSDRConfig({ ...data, sdr_id: currentSdrId }));
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
                store.dispatch(setStartStreamingLoading(false));
            }
        });

        // Satellite tracking events
        socket.on("satellite-tracking", (message) => {
            store.dispatch(setSatelliteData(message));
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
                        const satelliteData = message['data']?.['satellite_data'];
                        const satName = satelliteData?.details?.name || 'Unknown';
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
                        const satelliteData = message['data']?.['satellite_data'];
                        const satName = satelliteData?.details?.name || 'Unknown';
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
                        const satelliteData = message['data']?.['satellite_data'];
                        const satName = satelliteData?.details?.name || 'Unknown';
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
                        const satelliteData = message['data']?.['satellite_data'];
                        const satName = satelliteData?.details?.name || 'Unknown';
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
                    title={`${errorIcon} Transcription Error`}
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
                const satName = observation.satellite?.name || 'Unknown';
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
                        `Satellite: ${satName}`,
                        duration ? `Duration: ${duration}` : null,
                        observation.tasks?.length > 0 ? `Completed ${observation.tasks.length} task${observation.tasks.length > 1 ? 's' : ''}` : null,
                    ].filter(Boolean).join('\n');

                    toast.success(
                        <ToastMessage
                            title={`Observation Completed: ${obsName}`}
                            body={details}
                        />,
                        {
                            icon: () => <CheckCircleIcon />,
                            autoClose: 8000,
                            position: 'top-center',
                        }
                    );
                } else if (data.status === 'failed') {
                    // Observation failed
                    toast.error(
                        <ToastMessage
                            title={`Observation Failed: ${obsName}`}
                            body={`Satellite: ${satName}`}
                        />,
                        {
                            icon: () => <ErrorOutlineIcon />,
                            autoClose: 10000,
                            position: 'top-center',
                        }
                    );
                } else if (data.status === 'cancelled') {
                    // Observation cancelled
                    toast.warning(
                        <ToastMessage
                            title={`Observation Cancelled: ${obsName}`}
                            body={`Satellite: ${satName}`}
                        />,
                        {
                            icon: () => <CancelIcon />,
                            autoClose: 6000,
                            position: 'top-center',
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

                const satName = obs.satellite?.name || 'Unknown';
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
                    const peakElevation = obs.pass.peak_altitude ? `${obs.pass.peak_altitude.toFixed(0)}°` : 'N/A';

                    const details = [
                        `Peak elevation: ${peakElevation}`,
                        minutesUntilStart > 0 ? `Observation starts in ${minutesUntilStart} minute${minutesUntilStart !== 1 ? 's' : ''}` : 'Observation starting now',
                        obs.sdr?.name ? `SDR: ${obs.sdr.name}` : null,
                    ].filter(Boolean).join('\n');

                    toast.info(
                        <ToastMessage
                            title={`Satellite Visible: ${satName}`}
                            body={details}
                        />,
                        {
                            icon: () => <VisibilityIcon />,
                            autoClose: 8000,
                            position: 'top-center',
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

        // Decoder data events (SSTV, AFSK, Morse, GMSK, Transcription, etc.)
        socket.on('decoder-data', (data) => {
            // Some backends/bridges can emit an empty decoder payload transiently.
            // Guarding here avoids crashing the app shell on malformed events.
            if (!data || typeof data !== 'object' || typeof data.type !== 'string') {
                return;
            }

            switch (data.type) {
                case 'decoder-status':
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
                        vfo: data.vfo,
                        timestamp: data.timestamp,
                        progress: data.progress,
                        info: data.info  // Include decoder configuration info (baudrate, framing, etc.)
                    }));
                    break;

                case 'decoder-progress':
                    store.dispatch(decoderProgressUpdated({
                        session_id: data.session_id,
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

                    // Show toast notification only for SSTV (image output)
                    // Morse and other text-based decoders are too frequent for toasts
                    if (data.decoder_type === 'sstv' && data.output.image_data) {
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
                    title={`Task stopped: ${data.name}`}
                    body={`Duration: ${Math.floor(data.duration / 1000)}s`}
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
                    title={`Task error: ${data.name}`}
                    body={data.error}
                />,
                {
                    icon: () => <ErrorOutlineIcon />,
                    autoClose: 8000,
                }
            );
        });

        socket.on('background_task:list', (data) => {
            dispatch(setTaskList(data));
        });

        socket.on('celestial-scene-update', (data) => {
            dispatch(setCelestialSceneLive(data));
        });
        socket.on('solar-system-scene-update', (data) => {
            dispatch(setSolarSceneLive(data));
        });
        socket.on('celestial-tracks-update', (data) => {
            dispatch(setCelestialTracksLive(data));
        });
        socket.on('celestial-track-row-update', (data) => {
            dispatch(upsertCelestialTrackRowLive(data));
        });

        // SoapySDR discovery events
        socket.on('soapysdr:discovery_started', (data) => {
            console.log('SoapySDR discovery started:', data);
            // Show notification that discovery is running
            toast.info(
                <ToastMessage
                    title="SoapySDR Discovery Started"
                    body={`Searching for servers (${data.duration}s)...`}
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

            const sdrCount = data.sdr_count ?? data.active_count ?? 0;

            // Show notification
            toast.success(
                <ToastMessage
                    title="SoapySDR Discovery Complete"
                    body={`Found ${data.server_count} server(s), ${sdrCount} SDR(s) active`}
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
        });

        socket.on('soapysdr:discovery_error', (data) => {
            console.error('SoapySDR discovery error:', data);
            toast.error(
                <ToastMessage
                    title="SoapySDR Discovery Error"
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
            socket.off("ui-tracker-state");
            socket.off("tracker-command-status");
            socket.off("tracker-instances");
            socket.off("file_browser_state");
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
            socket.off("celestial-track-row-update");
            socket.off("observation-status-update");
            socket.off("scheduled-observations-changed");
            socket.off("soapysdr:discovery_started");
            socket.off("soapysdr:discovery_complete");
            socket.off("soapysdr:refresh_complete");
            socket.off("soapysdr:discovery_error");
        };
    }, [socket, enabled, dispatch, t]);
};
