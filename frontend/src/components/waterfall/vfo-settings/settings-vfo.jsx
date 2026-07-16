/**
 * VFO Settings Accordion Component (Refactored)
 *
 * Main orchestrator for VFO settings panel
 */

import React from 'react';
import { Accordion, AccordionSummary, AccordionDetails } from '../settings-elements.jsx';
import Typography from '@mui/material/Typography';
import { Box, Tabs, Tab } from "@mui/material";
import LockIcon from '@mui/icons-material/Lock';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import VolumeMuteIcon from '@mui/icons-material/VolumeMute';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import { useTranslation } from 'react-i18next';
import { VfoTabPanel } from './vfo-tab-panel.jsx';
import { TranscriptionParamsDialog } from './vfo-dialogs.jsx';
import DecoderParamsDialog from '../decoder-params-dialog.jsx';
import { resolveVfoAudioStatus, VFO_AUDIO_STATUS } from '../vfo-audio-status.js';
import {
    useVfoAudioState,
    useVfoDecoderInfo,
    useVfoWheelHandlers,
    useVfoSatelliteData,
    useVfoSquelchState,
    useVfoStreamingState
} from './vfo-hooks.js';

const VfoAccordion = ({
    expanded,
    onAccordionChange,
    selectedVFOTab,
    onVFOTabChange,
    vfoColors,
    vfoMarkers,
    vfoActive,
    onVFOActiveChange,
    onVFOPropertyChange,
    onTranscriptionToggle,
    geminiConfigured,
    deepgramConfigured,
    centerFrequency,
    sampleRate,
    onCenterFrequencyChange,
}) => {
    const { t } = useTranslation('waterfall');

    // Use custom hooks for state management
    const {
        vfoMuted,
        handleVfoMuteToggle
    } = useVfoAudioState();

    const { getVFODecoderInfo } = useVfoDecoderInfo();

    const {
        transmitters
    } = useVfoSatelliteData();

    const { streamingVFOs, vfoMutedRedux } = useVfoStreamingState();
    const { vfoSquelchOpen } = useVfoSquelchState();

    // Set up wheel event handlers for sliders
    useVfoWheelHandlers(vfoMarkers, vfoActive, onVFOPropertyChange);

    // Dialog state management
    const [decoderParamsDialogOpen, setDecoderParamsDialogOpen] = React.useState(false);
    const [decoderParamsVfoIndex, setDecoderParamsVfoIndex] = React.useState(null);
    const [transcriptionParamsDialogOpen, setTranscriptionParamsDialogOpen] = React.useState(false);
    const [transcriptionParamsVfoIndex, setTranscriptionParamsVfoIndex] = React.useState(null);

    // Dialog handlers
    const handleOpenDecoderParams = React.useCallback((vfoIndex) => {
        setDecoderParamsVfoIndex(vfoIndex);
        setDecoderParamsDialogOpen(true);
    }, []);

    const handleOpenTranscriptionParams = React.useCallback((vfoIndex) => {
        setTranscriptionParamsVfoIndex(vfoIndex);
        setTranscriptionParamsDialogOpen(true);
    }, []);

    return (
        <Accordion expanded={expanded} onChange={onAccordionChange}>
            <AccordionSummary
                sx={{
                    boxShadow: '-1px 4px 7px #00000059',
                }}
                aria-controls="vfo-content" id="vfo-header">
                <Typography component="span">{t('vfo.title')}</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{
                backgroundColor: 'background.elevated',
            }}>
                {/* VFO Tabs */}
                <Tabs
                    value={selectedVFOTab}
                    onChange={(event, newValue) => onVFOTabChange(newValue)}
                    sx={{
                        minHeight: '32px',
                        '& .MuiTab-root': {
                            minHeight: '32px',
                            padding: '6px 12px'
                        },
                        '& .MuiTabs-indicator': {
                            backgroundColor: '#ffffffcc',
                        }
                    }}
                >
                    {[0, 1, 2, 3].map((index) => {
                        const vfoNumber = index + 1;
                        const isStreaming = streamingVFOs.includes(vfoNumber);
                        const isMuted = Boolean(vfoMutedRedux[vfoNumber]);
                        const audioStatus = resolveVfoAudioStatus({
                            isStreaming,
                            isMuted,
                            isSquelchOpen: vfoSquelchOpen[vfoNumber],
                        });

                        return (
                            <Tab
                            key={index}
                            label={
                                <Box sx={{ position: 'relative', width: '100%', height: '100%' }}>
                                    {vfoNumber}
                                    {vfoMarkers[vfoNumber]?.lockedTransmitterId && vfoMarkers[vfoNumber]?.lockedTransmitterId !== 'none' && (
                                        <LockIcon
                                            sx={{
                                                position: 'absolute',
                                                top: -4,
                                                right: -8,
                                                fontSize: '0.75rem',
                                                pointerEvents: 'none',
                                            }}
                                        />
                                    )}
                                    {audioStatus === VFO_AUDIO_STATUS.NO_AUDIO && (
                                        <VolumeMuteIcon
                                            sx={{
                                                position: 'absolute',
                                                bottom: -2,
                                                right: -6,
                                                fontSize: '0.75rem',
                                                pointerEvents: 'none',
                                                color: '#888888',
                                            }}
                                        />
                                    )}
                                    {audioStatus === VFO_AUDIO_STATUS.MUTED && (
                                        <VolumeMuteIcon
                                            sx={{
                                                position: 'absolute',
                                                bottom: -2,
                                                right: -6,
                                                fontSize: '0.75rem',
                                                pointerEvents: 'none',
                                                color: '#00ff00',
                                            }}
                                        />
                                    )}
                                    {audioStatus === VFO_AUDIO_STATUS.SQUELCHED && (
                                        <VolumeOffIcon
                                            sx={{
                                                position: 'absolute',
                                                bottom: -2,
                                                right: -6,
                                                fontSize: '0.75rem',
                                                pointerEvents: 'none',
                                                color: 'warning.main',
                                            }}
                                        />
                                    )}
                                    {audioStatus === VFO_AUDIO_STATUS.PLAYING && (
                                        <VolumeUpIcon
                                            sx={{
                                                position: 'absolute',
                                                bottom: -2,
                                                right: -6,
                                                fontSize: '0.75rem',
                                                pointerEvents: 'none',
                                                color: '#00ff00',
                                            }}
                                        />
                                    )}
                                    {vfoActive[vfoNumber] && (
                                        <Box
                                            aria-label={`VFO ${vfoNumber} active`}
                                            sx={{
                                                position: 'absolute',
                                                top: -4,
                                                left: -8,
                                                width: 8,
                                                height: 8,
                                                borderRadius: '50%',
                                                bgcolor: 'success.main',
                                                boxShadow: 1,
                                            }}
                                        />
                                    )}
                                </Box>
                            }
                            sx={{
                                minWidth: '25%',
                                backgroundColor: `${vfoColors[index]}40`,
                                '&.Mui-selected': {
                                    fontWeight: 'bold',
                                    borderBottom: 'none',
                                    color: 'text.primary',
                                },
                            }}
                        />
                        );
                    })}
                </Tabs>

                {/* VFO Tab Panel (render only active tab for performance) */}
                <VfoTabPanel
                    key={selectedVFOTab + 1}
                    vfoIndex={selectedVFOTab + 1}
                    visible={true}
                    vfoMarkers={vfoMarkers}
                    vfoActive={vfoActive}
                    vfoMuted={vfoMuted}
                    transmitters={transmitters}
                    geminiConfigured={geminiConfigured}
                    deepgramConfigured={deepgramConfigured}
                    onVFOActiveChange={onVFOActiveChange}
                    onVFOPropertyChange={onVFOPropertyChange}
                    onMuteToggle={handleVfoMuteToggle}
                    onTranscriptionToggle={onTranscriptionToggle}
                    onOpenDecoderParamsDialog={handleOpenDecoderParams}
                    onOpenTranscriptionParamsDialog={handleOpenTranscriptionParams}
                    getVFODecoderInfo={getVFODecoderInfo}
                    centerFrequency={centerFrequency}
                    sampleRate={sampleRate}
                    onCenterFrequencyChange={onCenterFrequencyChange}
                />
            </AccordionDetails>

            {/* Decoder Parameters Dialog */}
            <DecoderParamsDialog
                open={decoderParamsDialogOpen}
                onClose={() => setDecoderParamsDialogOpen(false)}
                vfoIndex={decoderParamsVfoIndex}
                vfoMarkers={vfoMarkers}
                vfoActive={vfoActive}
                onVFOPropertyChange={onVFOPropertyChange}
            />

            {/* Transcription Parameters Dialog */}
            <TranscriptionParamsDialog
                open={transcriptionParamsDialogOpen}
                onClose={() => setTranscriptionParamsDialogOpen(false)}
                vfoIndex={transcriptionParamsVfoIndex}
                vfoMarkers={vfoMarkers}
                geminiConfigured={geminiConfigured}
                onVFOPropertyChange={onVFOPropertyChange}
                getVFODecoderInfo={getVFODecoderInfo}
            />
        </Accordion>
    );
};

function areVfoAccordionPropsEqual(prevProps, nextProps) {
    return (
        prevProps.expanded === nextProps.expanded &&
        prevProps.onAccordionChange === nextProps.onAccordionChange &&
        prevProps.selectedVFOTab === nextProps.selectedVFOTab &&
        prevProps.onVFOTabChange === nextProps.onVFOTabChange &&
        prevProps.vfoColors === nextProps.vfoColors &&
        prevProps.vfoMarkers === nextProps.vfoMarkers &&
        prevProps.vfoActive === nextProps.vfoActive &&
        prevProps.onVFOActiveChange === nextProps.onVFOActiveChange &&
        prevProps.onVFOPropertyChange === nextProps.onVFOPropertyChange &&
        prevProps.onTranscriptionToggle === nextProps.onTranscriptionToggle &&
        prevProps.geminiConfigured === nextProps.geminiConfigured &&
        prevProps.deepgramConfigured === nextProps.deepgramConfigured &&
        prevProps.centerFrequency === nextProps.centerFrequency &&
        prevProps.sampleRate === nextProps.sampleRate &&
        prevProps.onCenterFrequencyChange === nextProps.onCenterFrequencyChange
    );
}

export default React.memo(VfoAccordion, areVfoAccordionPropsEqual);
