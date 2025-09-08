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
 */

import React from 'react';
import {useDispatch, useSelector} from 'react-redux';
import {Accordion, AccordionSummary, AccordionDetails} from './panel-helpers.jsx';
import {Box, FormControl, InputLabel, MenuItem, Select, TextField, Typography} from '@mui/material';
import FrequencyDisplay from './frequency-dial.jsx';
import {humanizeFrequency} from '../common/common.jsx';
import {setCenterFrequency, setSelectedTransmitterId, setSelectedOffsetMode, setSelectedOffsetValue} from './waterfall-slice.jsx';

const FrequencyControlPanel = ({expanded, onChange, sendSDRConfigToBackend}) => {
    const dispatch = useDispatch();
    const {centerFrequency, selectedOffsetMode, selectedOffsetValue, selectedTransmitterId} = useSelector((state) => state.waterfall);
    const {availableTransmitters} = useSelector((state) => state.targetSatTrack);

    const updateCenterFrequency = (newFrequency) => {
        let freq = newFrequency * 1000.0;
        dispatch(setCenterFrequency(freq));
        sendSDRConfigToBackend({centerFrequency: freq});
    };

    function handleTransmitterChange(event) {
        dispatch(setSelectedTransmitterId(event.target.value));
        const selectedTransmitterMetadata = availableTransmitters.find(t => t.id === event.target.value);
        const newFrequency = selectedTransmitterMetadata['downlink_low'] || 0;
        dispatch(setCenterFrequency(newFrequency));
        sendSDRConfigToBackend({centerFrequency: newFrequency});
    }

    function handleOffsetModeChange(event) {
        const offsetValue = event.target.value;
        if (offsetValue === 'none') {
            dispatch(setSelectedOffsetMode(offsetValue));
            dispatch(setSelectedOffsetValue(0));
            sendSDRConfigToBackend({offsetFrequency: 0});
        } else if (offsetValue === 'manual') {
            dispatch(setSelectedOffsetMode(offsetValue));
            sendSDRConfigToBackend({offsetFrequency: parseInt(selectedOffsetValue)});
        } else {
            dispatch(setSelectedOffsetValue(offsetValue));
            dispatch(setSelectedOffsetMode(offsetValue));
            sendSDRConfigToBackend({offsetFrequency: parseInt(offsetValue)});
        }
    }

    function handleOffsetValueChange(param) {
        const offsetValue = param.target.value;
        dispatch(setSelectedOffsetValue(offsetValue));
        sendSDRConfigToBackend({offsetFrequency: parseInt(offsetValue)});
    }

    function getProperTransmitterId() {
        if (availableTransmitters.length > 0 && selectedTransmitterId) {
            if (availableTransmitters.find(t => t.id === selectedTransmitterId)) {
                return selectedTransmitterId;
            } else {
                return 'none';
            }
        } else {
            return 'none';
        }
    }

    return (
        <Accordion expanded={expanded} onChange={onChange}>
            <AccordionSummary
                sx={{
                    boxShadow: '-1px 4px 7px #00000059',
                }}
                aria-controls="freq-content" id="freq-header">
                <Typography component="span">Frequency control</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{
                backgroundColor: 'rgb(34,34,34)',
            }}>
                <Box sx={{mb: 0, width: '100%'}}>
                    <FrequencyDisplay
                        initialFrequency={centerFrequency / 1000.0}
                        onChange={(newFrequency) => {
                            updateCenterFrequency(newFrequency);
                        }}
                        size={'small'}
                        hideHzDigits={true}
                    />
                </Box>

                <FormControl disabled={false}
                             sx={{minWidth: 200, marginTop: 1, marginBottom: 0}} fullWidth variant="filled"
                             size="small">
                    <InputLabel htmlFor="transmitter-select">Go to transmitter</InputLabel>
                    <Select
                        id="transmitter-select"
                        value={getProperTransmitterId()}
                        onChange={(event) => {
                            handleTransmitterChange(event);
                        }}
                        variant={'filled'}>
                        <MenuItem value="none">
                            [no frequency selected]
                        </MenuItem>
                        <MenuItem value="" disabled>
                            <em>select a transmitter</em>
                        </MenuItem>
                        {availableTransmitters.map((transmitter, index) => {
                            return <MenuItem value={transmitter.id} key={transmitter.id}>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Box
                                        sx={{
                                            width: 8,
                                            height: 8,
                                            borderRadius: '50%',
                                            backgroundColor: transmitter.alive ? '#4caf50' : '#f44336',
                                            boxShadow: transmitter.alive
                                                ? '0 0 6px rgba(76, 175, 80, 0.6)'
                                                : '0 0 6px rgba(244, 67, 54, 0.6)',
                                        }}
                                    />
                                    <span>
                                        {transmitter['description']} ({humanizeFrequency(transmitter['downlink_low'])})
                                    </span>
                                </Box>
                            </MenuItem>;
                        })}
                    </Select>
                </FormControl>

                <FormControl
                    disabled={false}
                    sx={{minWidth: 200, marginTop: 1, marginBottom: 0}}
                    fullWidth
                    variant="filled"
                    size="small">
                    <InputLabel htmlFor="frequency-offset-select">Frequency Offset</InputLabel>
                    <Select
                        id="frequency-offset-select"
                        value={selectedOffsetMode || 'none'}
                        onChange={(event) => {
                            handleOffsetModeChange(event);
                        }}
                        variant={'filled'}>
                        <MenuItem value="none">
                            [no frequency offset]
                        </MenuItem>
                        <MenuItem value="manual">Manual</MenuItem>
                        <MenuItem value="" disabled>
                            <em>select an offset</em>
                        </MenuItem>
                        <MenuItem value="-6800000000">DK5AV X-Band (-6800MHz)</MenuItem>
                        <MenuItem value="125000000">Ham-it-Up (+125MHz)</MenuItem>
                        <MenuItem value="-10700000000">Ku LNB (-10700MHz)</MenuItem>
                        <MenuItem value="-9750000000">Ku LNB (-9750MHz)</MenuItem>
                        <MenuItem value="-1998000000">MMDS S-Band (-1998MHz)</MenuItem>
                        <MenuItem value="120000000">SpyVerter (+120MHz)</MenuItem>
                    </Select>
                </FormControl>

                <FormControl disabled={selectedOffsetMode !== 'manual'} sx={{minWidth: 200, marginTop: 1}}
                             fullWidth variant="filled"
                             size="small">
                    <TextField
                        disabled={selectedOffsetMode !== 'manual'}
                        label="Manual Offset (Hz)"
                        value={selectedOffsetValue}
                        variant="filled"
                        size="small"
                        type="number"
                        onChange={(e) => {
                            const offset = parseFloat(e.target.value);
                            if (!isNaN(offset)) {
                                handleOffsetValueChange({target: {value: offset.toString()}});
                            }
                        }}
                    />
                </FormControl>

            </AccordionDetails>
        </Accordion>
    );
};

export default FrequencyControlPanel;

