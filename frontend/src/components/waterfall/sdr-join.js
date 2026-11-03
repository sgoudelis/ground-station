import {
    applySDRConfigParameters,
    setIsStreaming,
    setSelectedPlaybackRecording,
    selectSdrForJoin,
    setJoinedSdrId,
    updateSDRConfig,
    setReceivingSession,
    setIsRecording,
    setRecordingStartTime,
    setRecordingDuration,
} from './waterfall-slice.jsx';
import { restoreReceivingSession } from './vfo-marker/vfo-slice.jsx';
import { setCurrentSessionId, setObservedSessionIds, decoderStatusChanged } from '../decoders/decoders-slice.jsx';

export const callSdrApi = (socket, command, selectedSDRId) => new Promise((resolve) => {
    if (!socket || socket.connected === false) {
        resolve({ success: false, error: 'Socket is not connected' });
        return;
    }
    const timer = setTimeout(() => resolve({ success: false, error: 'SDR request timed out' }), 10000);
    socket.emit('api.call', {
        cmd: `sdr.${command}`,
        data: { selectedSDRId },
    }, (response) => {
        clearTimeout(timer);
        resolve(response || { success: false, error: 'No response from server' });
    });
});

export const liveConfigToUpdates = (config) => {
    if (!config) return {};
    const mapping = {
        center_freq: 'centerFrequency',
        sample_rate: 'sampleRate',
        fft_size: 'fftSize',
        fft_window: 'fftWindow',
        fft_averaging: 'fftAveraging',
        fft_overlap_percent: 'fftOverlapPercent',
        fft_overlap_depth: 'fftOverlapDepth',
        bias_t: 'biasT',
        tuner_agc: 'tunerAgc',
        rtl_agc: 'rtlAgc',
        soapy_agc: 'soapyAgc',
        offset_freq: 'offsetFrequency',
        antenna: 'antenna',
        sdr_settings: 'sdrSettings',
        recording_path: 'recordingPath',
    };
    const updates = {};
    for (const [backendKey, frontendKey] of Object.entries(mapping)) {
        if (config[backendKey] !== undefined) updates[frontendKey] = config[backendKey];
    }
    if (config.gain !== undefined) updates.gain = config.gain;
    return updates;
};

export const joinSdr = async (socket, dispatch, selectedSDRId, command = 'join-sdr') => {
    const response = await callSdrApi(socket, command, selectedSDRId);
    if (response?.success) {
        const config = response.data?.config;
        dispatch(selectSdrForJoin(selectedSDRId));
        if (response.data?.parameters) {
            // Capability choices come from the pre-stream probe; the worker's
            // current config below remains authoritative for selected values.
            dispatch(applySDRConfigParameters({
                selectedSDRId,
                data: response.data.parameters,
            }));
        }
        if (selectedSDRId === 'sigmf-playback') dispatch(setSelectedPlaybackRecording(null));
        if (config) dispatch(updateSDRConfig({ ...config, force_live: true }));
        const observation = response.data?.observation;
        const backgrounds = response.data?.background_observations || [];
        dispatch(setObservedSessionIds(backgrounds.map((receiving) => receiving.session_id)));
        dispatch(setJoinedSdrId(observation ? null : selectedSDRId));
        dispatch(setReceivingSession(observation || (response.data?.session_id
            ? { session_id: response.data.session_id, enabled: false } : null)));
        dispatch(setCurrentSessionId(observation?.session_id || response.data?.session_id || socket.id));
        if (observation) {
            dispatch(restoreReceivingSession(observation));
            dispatch(setIsRecording(Boolean(observation.is_recording)));
            dispatch(setRecordingStartTime(observation.recording_start_time || null));
            dispatch(setRecordingDuration(observation.recording_start_time
                ? Math.max(0, Math.floor((Date.now() - new Date(observation.recording_start_time).getTime()) / 1000)) : 0));
            for (const status of observation.decoder_statuses || []) dispatch(decoderStatusChanged(status));
        }
        for (const receiving of backgrounds) {
            for (const status of receiving.decoder_statuses || []) dispatch(decoderStatusChanged(status));
        }
        dispatch({ ...setIsStreaming(true), meta: { preserveVfos: Boolean(observation) } });
    }
    return response;
};

export const leaveSdr = async (socket, dispatch, selectedSDRId) => {
    const response = await callSdrApi(socket, 'leave-sdr', selectedSDRId);
    if (response?.success) {
        dispatch(setJoinedSdrId(null));
        dispatch(setIsStreaming(false));
        dispatch(setCurrentSessionId(socket.id));
        dispatch(setObservedSessionIds([]));
    }
    return response;
};
