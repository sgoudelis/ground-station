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

import React from 'react';
import { Button, IconButton, Tooltip } from '@mui/material';
import FiberManualRecordIcon from '@mui/icons-material/FiberManualRecord';
import StopIcon from '@mui/icons-material/Stop';
import { useDispatch, useSelector } from 'react-redux';
import { startAudioRecording, stopAudioRecording } from '../vfo-marker/vfo-slice';
import { useSocket } from '../../common/socket';
import { useTranslation } from 'react-i18next';

const VFOAudioRecorderButton = ({ vfoNumber, compact = false }) => {
    const { t } = useTranslation('waterfall');
    const dispatch = useDispatch();
    const { socket } = useSocket();

    const { selectedSDRId, centerFrequency } = useSelector(state => state.waterfall);
    const vfoMarker = useSelector(state => state.vfo.vfoMarkers[vfoNumber]);
    const audioRecording = useSelector(state => state.vfo.audioRecording[vfoNumber]);
    const isActive = useSelector(state => state.vfo.vfoActive[vfoNumber]);

    const isRecording = audioRecording?.isRecording || false;
    const canRecord = isActive && vfoMarker?.mode && vfoMarker?.mode !== 'none' && selectedSDRId !== 'none' && selectedSDRId !== 'sigmf-playback';

    const handleToggle = () => {
        if (isRecording) {
            // Stop recording
            dispatch(stopAudioRecording({ socket, vfoNumber, selectedSDRId }))
                .unwrap()
                .catch(err => {
                    console.error('Stop recording error:', err);
                });
        } else {
            // Start recording
            const recordingName = `${vfoMarker.mode}_audio`;
            dispatch(startAudioRecording({
                socket,
                vfoNumber,
                recordingName,
                selectedSDRId,
                centerFrequency,
                vfoFrequency: vfoMarker.frequency,
                demodulatorType: vfoMarker.mode
            }))
                .unwrap()
                .catch(err => {
                    console.error('Start recording error:', err);
                });
        }
    };

    const tooltip = isRecording ? "Stop Audio Recording" : "Start Audio Recording";

    if (compact) {
        return (
            <Tooltip title={tooltip}>
                <span>
                    <IconButton
                        aria-label={tooltip}
                        onClick={handleToggle}
                        disabled={!canRecord && !isRecording}
                        size="small"
                        sx={{
                            color: isRecording ? 'error.main' : 'text.secondary',
                            backgroundColor: isRecording ? 'rgba(244, 67, 54, 0.1)' : 'transparent',
                            animation: isRecording ? 'pulse 2s ease-in-out infinite' : 'none',
                            '@keyframes pulse': {
                                '0%, 100%': { opacity: 1 },
                                '50%': { opacity: 0.5 }
                            },
                        }}
                    >
                        {isRecording ? <StopIcon fontSize="small" /> : <FiberManualRecordIcon fontSize="small" />}
                    </IconButton>
                </span>
            </Tooltip>
        );
    }

    return (
        <Tooltip title={tooltip}>
            <span>
                <Button
                    size="small"
                    variant="outlined"
                    onClick={handleToggle}
                    disabled={!canRecord && !isRecording}
                    startIcon={isRecording ? <StopIcon fontSize="small" /> : <FiberManualRecordIcon fontSize="small" />}
                    sx={{
                        minWidth: 'auto',
                        height: '32px',
                        fontSize: '0.75rem',
                        px: 1,
                        border: '1px solid',
                        borderColor: isRecording ? 'error.main' : 'rgba(255, 255, 255, 0.23)',
                        color: isRecording ? 'error.main' : 'text.secondary',
                        backgroundColor: isRecording ? 'rgba(244, 67, 54, 0.1)' : 'rgba(255, 255, 255, 0.05)',
                        animation: isRecording ? 'pulse 2s ease-in-out infinite' : 'none',
                        '@keyframes pulse': {
                            '0%, 100%': { opacity: 1 },
                            '50%': { opacity: 0.5 }
                        },
                        '&:hover': {
                            backgroundColor: isRecording ? 'rgba(244, 67, 54, 0.2)' : 'rgba(255, 255, 255, 0.1)',
                            borderColor: isRecording ? 'error.main' : 'rgba(255, 255, 255, 0.4)',
                        },
                        '&.Mui-disabled': {
                            backgroundColor: 'rgba(255, 255, 255, 0.02)',
                            borderColor: 'rgba(255, 255, 255, 0.08)',
                            color: 'rgba(255, 255, 255, 0.3)',
                            opacity: 0.5,
                        }
                    }}
                >
                    {t('vfo_audio_recorder_button.rec', { defaultValue: 'REC' })}
                </Button>
            </span>
        </Tooltip>
    );
};

export default VFOAudioRecorderButton;
