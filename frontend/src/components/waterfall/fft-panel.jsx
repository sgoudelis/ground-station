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

import React, {useState, useEffect} from 'react';
import {useDispatch, useSelector} from 'react-redux';
import {Accordion, AccordionSummary, AccordionDetails, LoadingOverlay} from './panel-helpers.jsx';
import {Box, FormControl, InputLabel, MenuItem, Select, Typography} from '@mui/material';
import {setColorMap, setFFTSize, setFFTWindow, setFFTAveraging} from './waterfall-slice.jsx';

const FFTPanel = ({expanded, onChange, sendSDRConfigToBackend}) => {
    const dispatch = useDispatch();
    const {
        fftSize,
        fftSizeValues,
        fftWindow,
        fftWindowValues,
        colorMap,
        colorMaps,
        gettingSDRParameters,
        fftAveraging,
    } = useSelector((state) => state.waterfall);

    const [localFFTSize, setLocalFFTSize] = useState(fftSize);
    const [localColorMap, setLocalColorMap] = useState(colorMap);

    useEffect(() => {
        setLocalFFTSize(fftSize);
        setLocalColorMap(colorMap);
    }, [fftSize, colorMap]);

    const updateFFTSize = (size) => {
        dispatch(setFFTSize(size));
        sendSDRConfigToBackend({fftSize: size});
    };

    const updateFFTWindow = (window) => {
        dispatch(setFFTWindow(window));
        sendSDRConfigToBackend({fftWindow: window});
    };

    const updateFFTAveraging = (value) => {
        dispatch(setFFTAveraging(value));
        sendSDRConfigToBackend({fftAveraging: value});
    };

    return (
        <Accordion expanded={expanded} onChange={onChange}>
            <AccordionSummary
                sx={{
                    boxShadow: '-1px 4px 7px #00000059',
                }}
                aria-controls="panel2d-content" id="panel2d-header">
                <Typography component="span">FFT</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{
                backgroundColor: 'rgb(34,34,34)',
            }}>
                <LoadingOverlay loading={gettingSDRParameters}>
                    <Box sx={{mb: 2}}>
                        <FormControl disabled={gettingSDRParameters}
                                     margin="normal" sx={{minWidth: 200, marginTop: 0, marginBottom: 1}}
                                     fullWidth={true} variant="filled"
                                     size="small">
                            <InputLabel>FFT Size</InputLabel>
                            <Select
                                disabled={gettingSDRParameters}
                                size={'small'}
                                value={fftSizeValues.length ? localFFTSize : ''}
                                onChange={(e) => {
                                    setLocalFFTSize(e.target.value);
                                    updateFFTSize(e.target.value);
                                }}
                                variant={'filled'}>
                                {fftSizeValues.map(size => (
                                    <MenuItem key={size} value={size}>{size}</MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <FormControl disabled={gettingSDRParameters}
                                     sx={{minWidth: 200, marginTop: 0, marginBottom: 1}} fullWidth={true}
                                     variant="filled" size="small">
                            <InputLabel>FFT Window</InputLabel>
                            <Select
                                disabled={gettingSDRParameters}
                                size={'small'}
                                value={fftWindowValues.length ? fftWindow : ''}
                                onChange={(e) => {
                                    updateFFTWindow(e.target.value);
                                }}
                                variant={'filled'}>
                                {fftWindowValues.map(window => (
                                    <MenuItem key={window} value={window}>
                                        {window.charAt(0).toUpperCase() + window.slice(1)}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>

                        <FormControl disabled={gettingSDRParameters}
                                     sx={{minWidth: 200, marginTop: 0, marginBottom: 1}} fullWidth={true}
                                     variant="filled" size="small">
                            <InputLabel>FFT Averaging</InputLabel>
                            <Select
                                disabled={gettingSDRParameters}
                                size={'small'}
                                value={fftAveraging}
                                onChange={(e) => {
                                    updateFFTAveraging(e.target.value);
                                }}
                                variant={'filled'}>
                                <MenuItem value={1}>None</MenuItem>
                                <MenuItem value={2}>2 samples</MenuItem>
                                <MenuItem value={3}>3 samples</MenuItem>
                                <MenuItem value={4}>4 samples</MenuItem>
                                <MenuItem value={6}>6 samples</MenuItem>
                                <MenuItem value={8}>8 samples</MenuItem>
                                <MenuItem value={10}>10 samples</MenuItem>
                                <MenuItem value={12}>12 samples</MenuItem>
                                <MenuItem value={16}>16 samples</MenuItem>
                                <MenuItem value={18}>18 samples</MenuItem>
                                <MenuItem value={20}>20 samples</MenuItem>
                                <MenuItem value={24}>24 samples</MenuItem>
                            </Select>
                        </FormControl>
                        <FormControl disabled={gettingSDRParameters}
                                     sx={{minWidth: 200, marginTop: 0, marginBottom: 1}} fullWidth={true}
                                     variant="filled"
                                     size="small">
                            <InputLabel>Color Map</InputLabel>
                            <Select
                                disabled={gettingSDRParameters}
                                size={'small'}
                                value={localColorMap}
                                onChange={(e) => {
                                    setLocalColorMap(e.target.value);
                                    dispatch(setColorMap(e.target.value));
                                }}
                                label="Color Map"
                                variant={'filled'}>
                                {colorMaps.map(map => (
                                    <MenuItem key={map} value={map}>
                                        {map.charAt(0).toUpperCase() + map.slice(1)}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Box>
                </LoadingOverlay>
            </AccordionDetails>
        </Accordion>
    );
};

export default FFTPanel;
