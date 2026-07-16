/**
 * VFO Tab Panel Component
 *
 * Complete settings panel for a single VFO, composed of all sub-components
 */

import React from 'react';
import { Box } from '@mui/material';
import { VfoActivateButton, VfoMuteButton, VfoFrequencyDisplay } from './vfo-controls.jsx';
import VFOAudioRecorderButton from './vfo-audio-recorder-button.jsx';
import { VfoLiveMeters } from './vfo-meters.jsx';
import { SquelchSlider, VolumeSlider } from './vfo-sliders.jsx';
import { DecoderStatusDisplay } from './vfo-decoder-status.jsx';
import { TransmitterLockSelect, LockedTransmitterAlert } from './vfo-transmitter-lock.jsx';
import {
    StepSizeSelector,
    AudioDemodSelector,
    TranscriptionSelector,
    DataDecoderSelector,
    BandwidthSelector
} from './vfo-mode-selectors.jsx';
import RotaryEncoder from '../rotator-encoder.jsx';

/**
 * Complete VFO Tab Panel Component
 * Combines all VFO controls and displays for a single VFO
 */
const VfoTabPanelComponent = ({
    vfoIndex,
    visible,
    vfoMarkers,
    vfoActive,
    vfoMuted,
    transmitters,
    geminiConfigured,
    deepgramConfigured,
    onVFOActiveChange,
    onVFOPropertyChange,
    onMuteToggle,
    onTranscriptionToggle,
    onOpenDecoderParamsDialog,
    onOpenTranscriptionParamsDialog,
    getVFODecoderInfo,
    centerFrequency,
    sampleRate,
    onCenterFrequencyChange
}) => {
    const vfo = vfoMarkers[vfoIndex];
    const decoderInfo = getVFODecoderInfo(vfoIndex);

    return (
        <Box hidden={!visible}>
            <Box sx={{ display: 'flex', gap: 1, flexDirection: 'column' }}>
                {/* Activate, Mute, and Record Buttons */}
                <Box sx={{ display: 'flex', gap: 0.5, mt: 1, alignItems: 'center' }}>
                    <VfoActivateButton
                        vfoIndex={vfoIndex}
                        vfoActive={vfoActive[vfoIndex]}
                        onVFOActiveChange={onVFOActiveChange}
                    />
                    <VfoMuteButton
                        vfoIndex={vfoIndex}
                        vfoActive={vfoActive[vfoIndex]}
                        vfoMuted={vfoMuted[vfoIndex]}
                        onMuteToggle={onMuteToggle}
                    />
                    <VFOAudioRecorderButton vfoNumber={vfoIndex} />
                </Box>

                {/* Frequency Display */}
                <VfoFrequencyDisplay frequency={vfo?.frequency || 0} />

                {/* Meters */}
                <VfoLiveMeters
                    vfoIndex={vfoIndex}
                    vfoActive={vfoActive[vfoIndex]}
                />

                {/* Sliders */}
                <SquelchSlider
                    vfoIndex={vfoIndex}
                    vfoActive={vfoActive[vfoIndex]}
                    mode={vfo?.mode}
                    squelch={vfo?.squelch ?? -150}
                    squelchMode={vfo?.squelchMode ?? 'carrier'}
                    vadSensitivity={vfo?.vadSensitivity ?? 'medium'}
                    vadCloseDelayMs={vfo?.vadCloseDelayMs ?? 300}
                    onVFOPropertyChange={onVFOPropertyChange}
                />
                <VolumeSlider
                    vfoIndex={vfoIndex}
                    vfoActive={vfoActive[vfoIndex]}
                    volume={vfo?.volume ?? 50}
                    muted={vfoMuted[vfoIndex]}
                    onVFOPropertyChange={onVFOPropertyChange}
                    onMuteToggle={onMuteToggle}
                />

                {/* Decoder Status */}
                <DecoderStatusDisplay
                    vfo={vfo}
                    decoderInfo={decoderInfo}
                />
            </Box>

            {/* Transmitter Lock */}
            <TransmitterLockSelect
                vfoIndex={vfoIndex}
                vfoActive={vfoActive[vfoIndex]}
                lockedTransmitterId={vfo?.lockedTransmitterId}
                lockedTransmitterTrackerId={vfo?.lockedTransmitterTrackerId}
                transmitters={transmitters}
                onVFOPropertyChange={onVFOPropertyChange}
                centerFrequency={centerFrequency}
                sampleRate={sampleRate}
                onCenterFrequencyChange={onCenterFrequencyChange}
            />

            {/* Locked Transmitter Alert */}
            <LockedTransmitterAlert lockedTransmitterId={vfo?.lockedTransmitterId} />

            {/* Rotary Encoder */}
            <Box sx={{ mt: 1 }}>
                <RotaryEncoder vfoNumber={vfoIndex} />
            </Box>

            {/* Step Size */}
            <StepSizeSelector
                vfoIndex={vfoIndex}
                vfoActive={vfoActive[vfoIndex]}
                stepSize={vfo?.stepSize}
                onVFOPropertyChange={onVFOPropertyChange}
            />

            {/* Audio Demodulation */}
            <AudioDemodSelector
                vfoIndex={vfoIndex}
                vfoActive={vfoActive[vfoIndex]}
                mode={vfo?.mode}
                onVFOPropertyChange={onVFOPropertyChange}
            />

            {/* Transcription */}
            <TranscriptionSelector
                vfoIndex={vfoIndex}
                vfoActive={vfoActive[vfoIndex]}
                vfoMarkers={vfoMarkers}
                geminiConfigured={geminiConfigured}
                deepgramConfigured={deepgramConfigured}
                onTranscriptionToggle={onTranscriptionToggle}
                onOpenParamsDialog={() => onOpenTranscriptionParamsDialog(vfoIndex)}
            />

            {/* Data Decoders */}
            <DataDecoderSelector
                vfoIndex={vfoIndex}
                vfoActive={vfoActive[vfoIndex]}
                vfoMarkers={vfoMarkers}
                decoder={vfo?.decoder}
                transmitters={transmitters}
                onVFOPropertyChange={onVFOPropertyChange}
                onTranscriptionToggle={onTranscriptionToggle}
                onOpenParamsDialog={() => onOpenDecoderParamsDialog(vfoIndex)}
            />

            {/* Bandwidth */}
            <BandwidthSelector
                vfoIndex={vfoIndex}
                vfoActive={vfoActive[vfoIndex]}
                bandwidth={vfo?.bandwidth}
                mode={vfo?.mode}
                decoder={vfo?.decoder}
                onVFOPropertyChange={onVFOPropertyChange}
            />
        </Box>
    );
};

function areVfoTabPanelPropsEqual(prevProps, nextProps) {
    if (prevProps.visible !== nextProps.visible) return false;
    if (!prevProps.visible && !nextProps.visible) return true;
    if (prevProps.vfoIndex !== nextProps.vfoIndex) return false;

    const idx = nextProps.vfoIndex;
    const prevVfo = prevProps.vfoMarkers[idx];
    const nextVfo = nextProps.vfoMarkers[idx];

    return (
        prevVfo === nextVfo &&
        prevProps.vfoActive[idx] === nextProps.vfoActive[idx] &&
        prevProps.vfoMuted[idx] === nextProps.vfoMuted[idx] &&
        prevProps.transmitters === nextProps.transmitters &&
        prevProps.geminiConfigured === nextProps.geminiConfigured &&
        prevProps.deepgramConfigured === nextProps.deepgramConfigured &&
        prevProps.onVFOActiveChange === nextProps.onVFOActiveChange &&
        prevProps.onVFOPropertyChange === nextProps.onVFOPropertyChange &&
        prevProps.onMuteToggle === nextProps.onMuteToggle &&
        prevProps.onTranscriptionToggle === nextProps.onTranscriptionToggle &&
        prevProps.onOpenDecoderParamsDialog === nextProps.onOpenDecoderParamsDialog &&
        prevProps.onOpenTranscriptionParamsDialog === nextProps.onOpenTranscriptionParamsDialog &&
        prevProps.getVFODecoderInfo === nextProps.getVFODecoderInfo &&
        prevProps.centerFrequency === nextProps.centerFrequency &&
        prevProps.sampleRate === nextProps.sampleRate &&
        prevProps.onCenterFrequencyChange === nextProps.onCenterFrequencyChange
    );
}

export const VfoTabPanel = React.memo(VfoTabPanelComponent, areVfoTabPanelPropsEqual);
