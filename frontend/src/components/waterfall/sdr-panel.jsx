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

import React, {useState, useEffect, useImperativeHandle, forwardRef, useRef, useCallback} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import {Accordion, AccordionSummary, AccordionDetails, LoadingOverlay} from './panel-helpers.jsx';
import {Box, FormControl, InputLabel, MenuItem, Select, ListSubheader, FormControlLabel, Switch, Typography} from '@mui/material';
import {
    getSDRConfigParameters,
    setBiasT,
    setGain,
    setSampleRate,
    setSelectedAntenna,
    setSelectedSDRId,
    setErrorDialogOpen,
    setErrorMessage,
    setIsStreaming,
    setTunerAgc,
    setRtlAgc,
    setSoapyAgc
} from './waterfall-slice.jsx';
import {useSocket} from "../common/socket.jsx";

const SDRPanel = forwardRef(({expanded, onChange}, ref) => {
    const dispatch = useDispatch();
    const {socket} = useSocket();

    const {
        gain,
        sampleRate,
        selectedSDRId,
        gettingSDRParameters,
        gainValues,
        sampleRateValues,
        hasBiasT,
        hasTunerAgc,
        hasRtlAgc,
        antennasList,
        selectedAntenna,
        hasSoapyAgc,
        soapyAgc,
        tunerAgc,
        rtlAgc,
        isStreaming,
    } = useSelector((state) => state.waterfall);

    const {sdrs} = useSelector((state) => state.sdrs);

    const [localGain, setLocalGain] = useState(gain);
    const [localSampleRate, setLocalSampleRate] = useState(sampleRate);
    const hasInitializedRef = useRef(false);

    useEffect(() => {
        setLocalGain(gain);
        setLocalSampleRate(sampleRate);
    }, [gain, sampleRate]);

    const sendSDRConfigToBackend = useCallback((updates = {}) => {
        if (selectedSDRId !== 'none' && selectedSDRId !== '') {
            let SDRSettings = {
                selectedSDRId: selectedSDRId,
                gain: gain,
                sampleRate: sampleRate,
                biasT: hasBiasT ? hasBiasT && updates.biasT !== undefined ? updates.biasT : biasT : biasT,
                tunerAgc: hasTunerAgc ? hasTunerAgc && updates.tunerAgc !== undefined ? updates.tunerAgc : tunerAgc : tunerAgc,
                rtlAgc: hasRtlAgc ? hasRtlAgc && updates.rtlAgc !== undefined ? updates.rtlAgc : rtlAgc : rtlAgc,
                antenna: selectedAntenna,
                soapyAgc: hasSoapyAgc ? hasSoapyAgc && updates.soapyAgc !== undefined ? updates.soapyAgc : soapyAgc : soapyAgc,
                ...updates,
            };
            socket.emit('sdr_data', 'configure-sdr', SDRSettings);
        } else {
            console.warn('No SDR selected, not sending SDR settings to backend');
        }
    }, [selectedSDRId, gain, sampleRate, biasT, tunerAgc, rtlAgc, socket, selectedAntenna, soapyAgc, hasBiasT, hasTunerAgc, hasRtlAgc, hasSoapyAgc]);

    const handleSDRChange = useCallback((event) => {
        const selectedValue = typeof event === 'object' ? event.target.value : event;
        dispatch(setSelectedSDRId(selectedValue));
        if (selectedValue === 'none') {
            dispatch(setSampleRate('none'));
            dispatch(setGain('none'));
        } else {
            dispatch(getSDRConfigParameters({socket, selectedSDRId: selectedValue}))
                .unwrap()
                .then(() => {})
                .catch(error => {
                    dispatch(setErrorMessage(error));
                    dispatch(setIsStreaming(false));
                    dispatch(setErrorDialogOpen(true));
                });
        }
    }, [dispatch, socket]);

    useImperativeHandle(ref, () => ({sendSDRConfigToBackend, handleSDRChange}));

    useEffect(() => {
        if (selectedSDRId && !hasInitializedRef.current) {
            hasInitializedRef.current = true;
            handleSDRChange({target: {value: selectedSDRId}});
        }
    }, [handleSDRChange, selectedSDRId]);

    const updateSDRGain = (value) => {
        dispatch(setGain(value));
        sendSDRConfigToBackend({gain: value});
    };

    const updateSampleRate = (value) => {
        dispatch(setSampleRate(value));
        sendSDRConfigToBackend({sampleRate: value});
    };

    const updateBiasT = (enabled) => {
        dispatch(setBiasT(enabled));
        sendSDRConfigToBackend({biasT: enabled});
    };

    const updateTunerAgc = (enabled) => {
        dispatch(setTunerAgc(enabled));
        sendSDRConfigToBackend({tunerAgc: enabled});
    };

    const updateRtlAgc = (enabled) => {
        dispatch(setRtlAgc(enabled));
        sendSDRConfigToBackend({rtlAgc: enabled});
    };

    const updateSelectedAntenna = (antenna) => {
        dispatch(setSelectedAntenna(antenna));
        sendSDRConfigToBackend({antenna});
    };

    const updateSoapyAgc = (enabled) => {
        dispatch(setSoapyAgc(enabled));
        sendSDRConfigToBackend({soapyAgc: enabled});
    };

    return (
        <Accordion expanded={expanded} onChange={onChange}>
            <AccordionSummary
                sx={{
                    boxShadow: '-1px 4px 7px #00000059',
                }}
                aria-controls="panel3d-content" id="panel3d-header">
                <Typography component="span">SDR</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{
                backgroundColor: 'rgb(34,34,34)',
            }}>
                <LoadingOverlay loading={gettingSDRParameters}>
                    <Box sx={{mb: 2}}>

                        <FormControl disabled={isStreaming} margin="normal"
                                     sx={{minWidth: 200, marginTop: 0, marginBottom: 1}} fullWidth
                                     variant="filled"
                                     size="small">
                            <InputLabel htmlFor="sdr-select">SDR</InputLabel>
                            <Select
                                id="sdr-select"
                                value={sdrs.length > 0 ? selectedSDRId : 'none'}
                                onChange={(event) => {
                                    handleSDRChange(event);
                                }}
                                variant={'filled'}>
                                <MenuItem value="none">
                                    [no SDR selected]
                                </MenuItem>
                                {sdrs.filter(sdr => sdr.type.toLowerCase().includes('local')).length > 0 && (
                                    <ListSubheader>Local SDRs</ListSubheader>
                                )}
                                {sdrs
                                    .filter(sdr => sdr.type.toLowerCase().includes('local'))
                                    .map((sdr, index) => {
                                        return <MenuItem value={sdr.id} key={`local-${index}`}>
                                            {sdr.name} ({sdr.type})
                                        </MenuItem>;
                                    })
                                }
                                {sdrs.filter(sdr => sdr.type.toLowerCase().includes('remote')).length > 0 && (
                                    <ListSubheader>Remote SDRs</ListSubheader>
                                )}
                                {sdrs
                                    .filter(sdr => sdr.type.toLowerCase().includes('remote'))
                                    .map((sdr, index) => {
                                        return <MenuItem value={sdr.id} key={`remote-${index}`}>
                                            {sdr.name} ({sdr.type})
                                        </MenuItem>;
                                    })
                                }
                                {sdrs.filter(sdr => !sdr.type.toLowerCase().includes('local') && !sdr.type.toLowerCase().includes('remote')).length > 0 && (
                                    <ListSubheader>Other SDRs</ListSubheader>
                                )}
                                {sdrs
                                    .filter(sdr => !sdr.type.toLowerCase().includes('local') && !sdr.type.toLowerCase().includes('remote'))
                                    .map((sdr, index) => {
                                        return <MenuItem value={sdr.id} key={`other-${index}`}>
                                            {sdr.name} ({sdr.type})
                                        </MenuItem>;
                                    })
                                }
                            </Select>
                        </FormControl>

                        <FormControl disabled={gettingSDRParameters}
                                     sx={{minWidth: 200, marginTop: 0, marginBottom: 1}}
                                     fullWidth={true}
                                     variant="filled" size="small">
                            <InputLabel>Gain (dB)</InputLabel>
                            <Select
                                disabled={gettingSDRParameters}
                                size={'small'}
                                value={gainValues.length ? localGain : 'none'}
                                onChange={(e) => {
                                    setLocalGain(e.target.value);
                                    updateSDRGain(e.target.value);
                                }}
                                variant={'filled'}>
                                <MenuItem value="none">
                                    [no gain selected]
                                </MenuItem>
                                {gainValues.map(gain => (
                                    <MenuItem key={gain} value={gain}>
                                        {gain} dB
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <FormControl disabled={gettingSDRParameters}
                                     sx={{minWidth: 200, marginTop: 0, marginBottom: 1}}
                                     fullWidth={true}
                                     variant="filled" size="small">
                            <InputLabel>Sample Rate</InputLabel>
                            <Select
                                disabled={gettingSDRParameters}
                                size={'small'}
                                value={sampleRateValues.includes(localSampleRate) ? localSampleRate : 'none'}
                                onChange={(e) => {
                                    setLocalSampleRate(e.target.value);
                                    updateSampleRate(e.target.value);
                                }}
                                variant={'filled'}>
                                <MenuItem value="none">
                                    [no rate selected]
                                </MenuItem>
                                {sampleRateValues.map(rate => {
                                    let displayValue;
                                    if (rate >= 1000000) {
                                        displayValue = `${(rate / 1000000).toFixed(rate % 1000000 === 0 ? 0 : 3)} MHz`;
                                    } else {
                                        displayValue = `${(rate / 1000).toFixed(rate % 1000 === 0 ? 0 : 3)} kHz`;
                                    }
                                    return (
                                        <MenuItem key={rate} value={rate}>
                                            {displayValue}
                                        </MenuItem>
                                    );
                                })}
                            </Select>
                        </FormControl>
                        <FormControl disabled={gettingSDRParameters}
                                     sx={{minWidth: 200, marginTop: 0, marginBottom: 1}}
                                     fullWidth={true}
                                     variant="filled" size="small">
                            <InputLabel>Antenna</InputLabel>
                            <Select
                                disabled={gettingSDRParameters}
                                size={'small'}
                                value={antennasList.rx.includes(selectedAntenna) ? selectedAntenna : 'none'}
                                onChange={(e) => {
                                    updateSelectedAntenna(e.target.value);
                                }}
                                variant={'filled'}>
                                <MenuItem value="none">
                                    [no antenna selected]
                                </MenuItem>
                                {antennasList.rx && antennasList.rx.map(antenna => (
                                    <MenuItem key={antenna} value={antenna}>
                                        {antenna}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Box>

                    <Box sx={{mb: 0, ml: 1.5}}>
                        {hasBiasT && (
                            <FormControlLabel
                                control={
                                    <Switch
                                        disabled={gettingSDRParameters}
                                        size={'small'}
                                        checked={biasT}
                                        onChange={(e) => {
                                            updateBiasT(e.target.checked);
                                        }}
                                    />
                                }
                                label="Enable Bias T"
                            />
                        )}
                        {hasTunerAgc && (
                            <FormControlLabel
                                control={
                                    <Switch
                                        disabled={gettingSDRParameters}
                                        size={'small'}
                                        checked={tunerAgc}
                                        onChange={(e) => {
                                            updateTunerAgc(e.target.checked);
                                        }}
                                    />
                                }
                                label="Enable tuner AGC"
                            />
                        )}
                        {hasSoapyAgc && (
                            <FormControlLabel
                                control={
                                    <Switch
                                        disabled={gettingSDRParameters}
                                        size={'small'}
                                        checked={soapyAgc}
                                        onChange={(e) => {
                                            updateSoapyAgc(e.target.checked);
                                        }}
                                    />
                                }
                                label="Enable AGC"
                            />
                        )}
                        {hasRtlAgc && (
                            <FormControlLabel
                                control={
                                    <Switch
                                        disabled={gettingSDRParameters}
                                        size={'small'}
                                        checked={rtlAgc}
                                        onChange={(e) => {
                                            updateRtlAgc(e.target.checked);
                                        }}
                                    />
                                }
                                label="Enable RTL AGC"
                            />
                        )}
                    </Box>
                </LoadingOverlay>
            </AccordionDetails>
        </Accordion>
    );
});

export default SDRPanel;
