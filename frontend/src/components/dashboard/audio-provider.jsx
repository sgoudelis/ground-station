import React, { createContext, useContext, useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from '../../utils/toast-with-timestamp.jsx';
import { registerFlushCallback, unregisterFlushCallback } from './audio-service.js';
import { setVfoMuted } from '../waterfall/vfo-marker/vfo-slice.jsx';
import {
    AUDIO_JITTER_BUFFER_SECONDS,
    AUDIO_MAX_BUFFER_SECONDS,
} from './audio-buffer-config.js';
import { clampAndMeasureRms, toFloat32Samples } from './audio-samples.js';

const AudioContext = createContext({
    audioEnabled: false,
    volume: 0.5,
    initializeAudio: () => {},
    playAudioSamples: () => {},
    setAudioVolume: () => {},
    setVfoMute: () => {},
    setVfoVolume: () => {},
    stopAudio: () => {},
    getAudioState: () => {},
    flushAudioBuffers: () => {},
    getAudioBufferLength: () => {},
    getVfoAudioLevel: () => {},
    getVfoRfPower: () => {},
    getVfoSquelchDebug: () => null
});

export const useAudio = () => {
    const context = useContext(AudioContext);
    if (!context) {
        throw new Error('useAudio must be used within an AudioProvider');
    }
    return context;
};

const VFO_NUMBERS = [1, 2, 3, 4];

export const AudioProvider = ({ children }) => {
    const dispatch = useDispatch();

    // Get persisted mute state from Redux
    const vfoMutedRedux = useSelector(state => state.vfo.vfoMuted || {
        1: false,
        2: false,
        3: false,
        4: false
    });

    // Audio context for Web Audio API (must stay in main thread)
    const audioContextRef = useRef(null);
    const [audioEnabled, setAudioEnabled] = useState(false);
    const [volume, setVolume] = useState(0.5);

    // Per-VFO state (supports 4 VFOs: 1-4)
    const vfoGainNodesRef = useRef({}); // { 1: GainNode, 2: GainNode, ... }
    const vfoNextPlayTimeRef = useRef({}); // { 1: time, 2: time, ... } - end of the last scheduled chunk
    const vfoScheduledSourcesRef = useRef({}); // { 1: Set<AudioBufferSourceNode>, ... } - not yet finished
    const vfoMutedRef = useRef({}); // { 1: false, 2: false, ... }
    const vfoVolumeRef = useRef({}); // { 1: 1.0, 2: 1.0, ... } - individual VFO volumes
    const vfoAudioLevelRef = useRef({}); // { 1: 0.0, 2: 0.0, ... } - RMS audio levels
    const vfoRfPowerRef = useRef({}); // { 1: -100, 2: -100, ... } - RF power in dB
    const vfoSquelchDebugRef = useRef({}); // { 1: {...}, 2: {...}, ... } - squelch diagnostics
    const vfoStatsRef = useRef({}); // { 1: { underruns, skipped }, ... } - diagnostics

    // Initialize audio context
    const initializeAudio = useCallback(async () => {
        try {
            await new Promise(resolve => {
                if (window.requestIdleCallback) {
                    window.requestIdleCallback(resolve);
                } else {
                    setTimeout(resolve, 0);
                }
            });

            // Configure AudioContext for low latency
            const contextOptions = {
                latencyHint: 'interactive', // Request lowest latency
                sampleRate: 44100
            };

            audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)(contextOptions);

            // Create separate GainNode for each VFO (4 VFOs: 1-4)
            for (const vfoNumber of VFO_NUMBERS) {
                const gainNode = audioContextRef.current.createGain();
                gainNode.connect(audioContextRef.current.destination);

                // Initialize per-VFO state from Redux (for mute) or defaults
                const isMuted = vfoMutedRedux[vfoNumber] || false;
                vfoMutedRef.current[vfoNumber] = isMuted;
                vfoVolumeRef.current[vfoNumber] = 1.0;

                // Set gain based on mute state
                gainNode.gain.value = isMuted ? 0 : volume;
                vfoGainNodesRef.current[vfoNumber] = gainNode;

                // A past time forces the first chunk to re-prime the jitter buffer
                vfoNextPlayTimeRef.current[vfoNumber] = 0;
                vfoScheduledSourcesRef.current[vfoNumber] = new Set();
                vfoAudioLevelRef.current[vfoNumber] = 0.0;
                vfoStatsRef.current[vfoNumber] = { underruns: 0, skipped: 0 };
            }

            if (audioContextRef.current.state === 'suspended') {
                await audioContextRef.current.resume();
            }

            setAudioEnabled(true);

            console.log(`Audio initialized - Base latency: ${audioContextRef.current.baseLatency}s, Output latency: ${audioContextRef.current.outputLatency}s`);

        } catch (error) {
            console.error('Failed to initialize audio:', error);
            toast.error(`Failed to initialize audio: ${error.message}`);
        }
    }, [volume, vfoMutedRedux]);

    // Schedule one chunk of float32 PCM on the given VFO's output chain.
    // Called directly from the socket handler: decoding an ArrayBuffer and
    // copying 1024 samples is far cheaper than a worker round trip would be.
    const scheduleChunk = useCallback((samples, sampleRate, channels, vfoNumber) => {
        const ctx = audioContextRef.current;
        const gainNode = vfoGainNodesRef.current[vfoNumber];
        if (!ctx || !gainNode) return;

        // Note: Don't return early if muted - let audio flow through GainNode with gain=0
        // This allows instant mute/unmute without audio gaps

        try {
            const now = ctx.currentTime;
            let startAt = vfoNextPlayTimeRef.current[vfoNumber] ?? 0;

            // Trim latency: after a long stall the backlog arrives in a burst and
            // would otherwise stay scheduled far ahead forever. Skipping chunks
            // while over the limit walks the lead back without overlapping audio.
            if (startAt - now > AUDIO_MAX_BUFFER_SECONDS) {
                vfoStatsRef.current[vfoNumber].skipped += 1;
                return;
            }

            // Underrun (or first chunk): the previous chunk already finished, so
            // re-prime with the jitter lead instead of playing right at `now`.
            if (startAt < now) {
                if (vfoNextPlayTimeRef.current[vfoNumber] > 0) {
                    vfoStatsRef.current[vfoNumber].underruns += 1;
                }
                startAt = now + AUDIO_JITTER_BUFFER_SECONDS;
            }

            // Calculate number of frames (samples per channel)
            const numFrames = channels === 2 ? samples.length / 2 : samples.length;
            const audioBuffer = ctx.createBuffer(channels, numFrames, sampleRate);

            if (channels === 1) {
                audioBuffer.copyToChannel(samples, 0);
            } else {
                // Stereo: de-interleave [L0, R0, L1, R1, ...]
                const leftChannel = audioBuffer.getChannelData(0);
                const rightChannel = audioBuffer.getChannelData(1);
                for (let i = 0; i < numFrames; i++) {
                    leftChannel[i] = samples[i * 2];
                    rightChannel[i] = samples[i * 2 + 1];
                }
            }

            const source = ctx.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(gainNode);

            // Track live sources so an explicit flush can silence them
            const scheduled = vfoScheduledSourcesRef.current[vfoNumber];
            scheduled.add(source);
            source.onended = () => {
                scheduled.delete(source);
                source.disconnect();
            };

            source.start(startAt);

            // Next chunk starts exactly when this one ends (no gap)
            vfoNextPlayTimeRef.current[vfoNumber] = startAt + audioBuffer.duration;

        } catch (error) {
            console.error(`Error playing audio for VFO ${vfoNumber}:`, error);
        }
    }, []);

    // Play audio samples - route to correct VFO
    const playAudioSamples = useCallback((audioData) => {
        if (!audioContextRef.current) return;

        if (audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume().then(() => {
                playAudioSamples(audioData);
            }).catch(err => {
                console.error('Failed to resume AudioContext:', err);
            });
            return;
        }

        if (!audioEnabled) {
            setAudioEnabled(true);
        }

        // Extract VFO number from audio data (backend sends 1-4)
        const vfoNumber = audioData.vfo?.vfo_number;
        if (vfoNumber === undefined || vfoNumber < 1 || vfoNumber > 4) {
            console.warn('Invalid or missing vfo_number in audio data:', audioData);
            return;
        }

        // Extract and store RF power measurement if present
        if (audioData.rf_power_db !== undefined && audioData.rf_power_db !== null) {
            vfoRfPowerRef.current[vfoNumber] = audioData.rf_power_db;
        }
        if (audioData.squelch_debug !== undefined && audioData.squelch_debug !== null) {
            vfoSquelchDebugRef.current[vfoNumber] = audioData.squelch_debug;
        }

        const samples = toFloat32Samples(audioData.samples);
        if (!samples || samples.length === 0) return;

        // RMS feeds the VU meter; clamping guards against demodulator overshoot
        vfoAudioLevelRef.current[vfoNumber] = clampAndMeasureRms(samples);

        scheduleChunk(samples, audioData.sample_rate || 44100, audioData.channels || 1, vfoNumber);
    }, [audioEnabled, scheduleChunk]);

    // Set master volume (affects all VFOs)
    const setAudioVolume = useCallback((newVolume) => {
        setVolume(newVolume);
        // Apply to all VFO gain nodes
        for (const vfoNumber of VFO_NUMBERS) {
            const gainNode = vfoGainNodesRef.current[vfoNumber];
            if (gainNode && !vfoMutedRef.current[vfoNumber]) {
                gainNode.gain.value = newVolume * (vfoVolumeRef.current[vfoNumber] || 1.0);
            }
        }
    }, []);

    // Set individual VFO volume
    const setVfoVolume = useCallback((vfoNumber, vfoVolume) => {
        if (vfoNumber < 1 || vfoNumber > 4) return;

        vfoVolumeRef.current[vfoNumber] = vfoVolume;
        const gainNode = vfoGainNodesRef.current[vfoNumber];

        if (gainNode && !vfoMutedRef.current[vfoNumber]) {
            gainNode.gain.value = volume * vfoVolume;
        }
    }, [volume]);

    // Stop everything scheduled for a VFO; the next chunk re-primes the lead
    const flushVfo = useCallback((vfoNumber) => {
        const scheduled = vfoScheduledSourcesRef.current[vfoNumber];
        if (scheduled) {
            scheduled.forEach((source) => {
                try {
                    source.onended = null;
                    source.stop();
                    source.disconnect();
                } catch {
                    // Already stopped/ended
                }
            });
            scheduled.clear();
        }
        vfoNextPlayTimeRef.current[vfoNumber] = 0;
    }, []);

    // Flush audio buffers (silence scheduled audio and reset scheduling)
    const flushAudioBuffers = useCallback((vfoNumber = null) => {
        if (vfoNumber !== null) {
            flushVfo(vfoNumber);
        } else {
            VFO_NUMBERS.forEach(flushVfo);
        }
    }, [flushVfo]);

    // Mute/unmute individual VFO
    // VFO numbers are 1-4 (from UI/backend), matching audio routing
    const setVfoMute = useCallback((vfoNumber, muted) => {
        if (vfoNumber < 1 || vfoNumber > 4) return;

        vfoMutedRef.current[vfoNumber] = muted;
        const gainNode = vfoGainNodesRef.current[vfoNumber];

        if (gainNode) {
            gainNode.gain.value = muted ? 0 : volume * (vfoVolumeRef.current[vfoNumber] || 1.0);
        }

        // Update Redux state so UI can reflect mute status
        dispatch(setVfoMuted({ vfoNumber, muted }));

        // Flush the audio buffer for this VFO when muting/unmuting
        flushAudioBuffers(vfoNumber);
    }, [volume, flushAudioBuffers, dispatch]);

    // Stop audio - tear down the context
    const stopAudio = useCallback(() => {
        VFO_NUMBERS.forEach(flushVfo);

        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }

        vfoGainNodesRef.current = {};
        vfoNextPlayTimeRef.current = {};
        vfoScheduledSourcesRef.current = {};
        vfoMutedRef.current = {};
        vfoVolumeRef.current = {};

        setAudioEnabled(false);
    }, [flushVfo]);

    // Get audio context state
    const getAudioState = useCallback(() => {
        return {
            enabled: audioEnabled,
            volume: volume,
            contextState: audioContextRef.current?.state || 'closed',
            vfoMuted: { ...vfoMutedRef.current },
            vfoVolumes: { ...vfoVolumeRef.current },
            vfoStats: { ...vfoStatsRef.current }
        };
    }, [audioEnabled, volume]);

    // Get browser audio buffer length in seconds (per VFO or max across all)
    const getAudioBufferLength = useCallback((vfoNumber = null) => {
        if (!audioContextRef.current) {
            return 0;
        }
        const currentTime = audioContextRef.current.currentTime;

        if (vfoNumber !== null) {
            // Get buffer length for specific VFO
            return Math.max(0, (vfoNextPlayTimeRef.current[vfoNumber] || 0) - currentTime);
        }
        // Get max buffer length across all VFOs
        let maxBufferLength = 0;
        for (const i of VFO_NUMBERS) {
            const bufferLength = Math.max(0, (vfoNextPlayTimeRef.current[i] || 0) - currentTime);
            maxBufferLength = Math.max(maxBufferLength, bufferLength);
        }
        return maxBufferLength;
    }, []);

    // Get VFO audio level (RMS of the most recent chunk, range 0.0 to 1.0)
    const getVfoAudioLevel = useCallback((vfoNumber) => {
        if (vfoNumber < 1 || vfoNumber > 4) return 0;
        return vfoAudioLevelRef.current[vfoNumber] || 0;
    }, []);

    // Get VFO RF power in dB
    const getVfoRfPower = useCallback((vfoNumber) => {
        if (vfoNumber < 1 || vfoNumber > 4) return null;
        return vfoRfPowerRef.current[vfoNumber] || null;
    }, []);

    // Get VFO squelch diagnostics
    const getVfoSquelchDebug = useCallback((vfoNumber) => {
        if (vfoNumber < 1 || vfoNumber > 4) return null;
        return vfoSquelchDebugRef.current[vfoNumber] || null;
    }, []);

    // Register flush callback for use by middleware
    useEffect(() => {
        registerFlushCallback(flushAudioBuffers);
        return () => {
            unregisterFlushCallback();
        };
    }, [flushAudioBuffers]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (audioContextRef.current) {
                audioContextRef.current.close();
            }
        };
    }, []);

    const value = useMemo(() => ({
        audioEnabled,
        volume,
        initializeAudio,
        playAudioSamples,
        setAudioVolume,
        setVfoMute,
        setVfoVolume,
        stopAudio,
        getAudioState,
        flushAudioBuffers,
        getAudioBufferLength,
        getVfoAudioLevel,
        getVfoRfPower,
        getVfoSquelchDebug
    }), [audioEnabled, volume, initializeAudio, playAudioSamples, setAudioVolume, setVfoMute, setVfoVolume, stopAudio, getAudioState, flushAudioBuffers, getAudioBufferLength, getVfoAudioLevel, getVfoRfPower, getVfoSquelchDebug]);

    return (
        <AudioContext.Provider value={value}>
            {children}
        </AudioContext.Provider>
    );
};
