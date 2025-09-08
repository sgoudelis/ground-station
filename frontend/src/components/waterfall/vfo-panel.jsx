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
import {
    Box,
    FormControlLabel,
    Switch,
    Tabs,
    Tab,
    Typography,
    ToggleButtonGroup,
    ToggleButton,
    Slider,
    Stack
} from '@mui/material';
import VolumeDown from '@mui/icons-material/VolumeDown';
import VolumeUp from '@mui/icons-material/VolumeUp';
import LCDFrequencyDisplay from '../common/lcd-frequency-display.jsx';
import RotaryEncoder from './rotaty-encoder.jsx';
import {SquelchIcon} from '../common/icons.jsx';
import {
    setSelectedVFOTab,
    setVFOProperty,
    setVfoActive,
    setVfoInactive
} from './waterfall-slice.jsx';

const BANDWIDTHS = {
    "3300": "3.3 kHz",
    "5000": "5 kHz",
    "10000": "10 kHz",
    "12500": "12.5 kHz",
    "15000": "15 kHz",
    "20000": "20 kHz"
};

const VFOPanel = ({expanded, onChange}) => {
    const dispatch = useDispatch();
    const {
        selectedVFOTab,
        vfoMarkers,
        vfoActive,
        vfoColors,
    } = useSelector((state) => state.waterfall);

    return (
        <Accordion expanded={expanded} onChange={onChange}>
            <AccordionSummary
                sx={{
                    boxShadow: '-1px 4px 7px #00000059',
                }}
                aria-controls="vfo-content" id="vfo-header">
                <Typography component="span">VFO Controls</Typography>
            </AccordionSummary>
            <AccordionDetails sx={{
                backgroundColor: 'rgb(34,34,34)',
            }}>
                <Tabs
                    value={selectedVFOTab}
                    onChange={(event, newValue) => {
                        dispatch(setSelectedVFOTab(newValue));
                    }}
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
                    {[0, 1, 2, 3].map((index) => (
                        <Tab key={index} label={`VFO ${index + 1}`} sx={{
                            minWidth: '25%',
                            backgroundColor: `${vfoColors[index]}40`,
                            '&.Mui-selected': {
                                fontWeight: 'bold',
                                borderBottom: 'none',
                                color: '#ffffff',
                            },
                        }}/>
                    ))}

                </Tabs>
                {[1, 2, 3, 4].map((vfoIndex) => (
                    <Box key={vfoIndex} hidden={(selectedVFOTab + 1) !== vfoIndex}>
                        <Box sx={{
                            mt: 2,
                            mb: 0,
                            typography: 'body1',
                            fontWeight: 'medium',
                            alignItems: 'center'
                        }}>
                            <Box
                                sx={{
                                    fontFamily: 'Monospace',
                                    color: '#2196f3',
                                    alignItems: 'center',
                                    textAlign: 'center',
                                    justifyContent: 'center'
                                }}>
                                <LCDFrequencyDisplay
                                    frequency={vfoMarkers[vfoIndex]?.frequency || 0}
                                    size={'large'}/>
                            </Box>
                        </Box>

                        <RotaryEncoder vfoNumber={vfoIndex} />

                        <FormControlLabel
                            control={
                                <Switch
                                    checked={vfoActive[vfoIndex] || false}
                                    onChange={(e) => {
                                        if (e.target.checked) {
                                            dispatch(setVfoActive(vfoIndex));
                                        } else {
                                            dispatch(setVfoInactive(vfoIndex));
                                        }
                                    }}
                                />
                            }
                            label="Active"
                            sx={{mt: 0, ml: 0}}
                        />

                        <Box sx={{ mt: 1 }}>
                            <Typography variant="body2" sx={{ mb: 1, color: 'text.secondary' }}>
                                Step Size
                            </Typography>
                            <ToggleButtonGroup
                                value={vfoMarkers[vfoIndex]?.stepSize || 1000}
                                exclusive
                                onChange={(event, newValue) => {
                                    if (newValue !== null) {
                                        dispatch(setVFOProperty({
                                            vfoNumber: vfoIndex,
                                            updates: { stepSize: newValue }
                                        }));
                                    }
                                }}
                                sx={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: 0.5,
                                    '& .MuiToggleButton-root': {
                                        width: '60px',
                                        height: '28px',
                                        minWidth: '70px',
                                        maxWidth: '60px',
                                        padding: '4px 6px',
                                        fontSize: '0.8rem',
                                        border: '1px solid rgba(255, 255, 255, 0.23)',
                                        borderRadius: '4px',
                                        color: 'text.secondary',
                                        textAlign: 'center',
                                        textTransform: 'none',
                                        '&.Mui-selected': {
                                            backgroundColor: 'primary.main',
                                            color: 'primary.contrastText',
                                            '&:hover': {
                                                backgroundColor: 'primary.dark',
                                            }
                                        },
                                        '&:hover': {
                                            backgroundColor: 'rgba(255, 255, 255, 0.08)',
                                        }
                                    }
                                }}
                            >
                                <ToggleButton value={100}>100</ToggleButton>
                                <ToggleButton value={1000}>1k</ToggleButton>
                                <ToggleButton value={10000}>10k</ToggleButton>
                            </ToggleButtonGroup>
                        </Box>

                        <Box sx={{ mt: 2 }}>
                            <Typography variant="body2" sx={{ mb: 1, color: 'text.secondary' }}>
                                Mode
                            </Typography>
                            <ToggleButtonGroup
                                value={vfoMarkers[vfoIndex]?.mode || 'none'}
                                exclusive
                                onChange={(event, newValue) => {
                                    if (newValue !== null) {
                                        dispatch(setVFOProperty({
                                            vfoNumber: vfoIndex,
                                            updates: { mode: newValue }
                                        }));
                                    }
                                }}
                                sx={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: 0.5,
                                    '& .MuiToggleButton-root': {
                                        width: '50px',
                                        height: '28px',
                                        minWidth: '50px',
                                        maxWidth: '50px',
                                        padding: '4px 6px',
                                        fontSize: '0.8rem',
                                        border: '1px solid rgba(255, 255, 255, 0.23)',
                                        borderRadius: '4px',
                                        color: 'text.secondary',
                                        textAlign: 'center',
                                        textTransform: 'none',
                                        '&.Mui-selected': {
                                            backgroundColor: 'primary.main',
                                            color: 'primary.contrastText',
                                            '&:hover': {
                                                backgroundColor: 'primary.dark',
                                            }
                                        },
                                        '&:hover': {
                                            backgroundColor: 'rgba(255, 255, 255, 0.08)',
                                        }
                                    }
                                }}
                            >
                                <ToggleButton value="none">None</ToggleButton>
                                <ToggleButton value="am">AM</ToggleButton>
                                <ToggleButton value="fm">FM</ToggleButton>
                                <ToggleButton value="lsb">LSB</ToggleButton>
                                <ToggleButton value="usb">USB</ToggleButton>
                            </ToggleButtonGroup>
                        </Box>

                        <Box sx={{ mt: 2 }}>
                            <Typography variant="body2" sx={{ mb: 1, color: 'text.secondary' }}>
                                Bandwidth
                            </Typography>
                            <ToggleButtonGroup
                                value={BANDWIDTHS.hasOwnProperty(vfoMarkers[vfoIndex]?.bandwidth) ? vfoMarkers[vfoIndex]?.bandwidth.toString() : 'custom'}
                                exclusive
                                onChange={(event, newValue) => {
                                    if (newValue !== null) {
                                        if (newValue === 'custom') {
                                            return;
                                        } else {
                                            dispatch(setVFOProperty({
                                                vfoNumber: vfoIndex,
                                                updates: { bandwidth: parseInt(newValue) }
                                            }));
                                        }
                                    }
                                }}
                                sx={{
                                    display: 'flex',
                                    flexWrap: 'wrap',
                                    gap: 0.5,
                                    '& .MuiToggleButton-root': {
                                        width: '65px',
                                        height: '28px',
                                        minWidth: '65px',
                                        maxWidth: '65px',
                                        padding: '4px 6px',
                                        fontSize: '0.8rem',
                                        border: '1px solid rgba(255, 255, 255, 0.23)',
                                        borderRadius: '4px',
                                        color: 'text.secondary',
                                        textAlign: 'center',
                                        textTransform: 'none',
                                        '&.Mui-selected': {
                                            backgroundColor: 'primary.main',
                                            color: 'primary.contrastText',
                                            '&:hover': {
                                                backgroundColor: 'primary.dark',
                                            }
                                        },
                                        '&:hover': {
                                            backgroundColor: 'rgba(255, 255, 255, 0.08)',
                                        }
                                    }
                                }}
                            >
                                <ToggleButton value="custom">Custom</ToggleButton>
                                {Object.entries(BANDWIDTHS).map(([value, label]) => (
                                    <ToggleButton key={value} value={value}>
                                        {label}
                                    </ToggleButton>
                                ))}
                            </ToggleButtonGroup>
                        </Box>

                        <Stack spacing={2} direction="row" alignItems="center" sx={{mt: 2}}>
                            <Box sx={{textAlign: 'left'}}><SquelchIcon size={24}/></Box>
                            <Slider
                                value={vfoMarkers[vfoIndex]?.squelch || -150}
                                min={-150}
                                max={0}
                                onChange={(e, val) => dispatch(setVFOProperty({
                                    vfoNumber: vfoIndex,
                                    updates: {squelch: val}
                                }))}
                            />
                            <Box sx={{minWidth: 60}}>{vfoMarkers[vfoIndex]?.squelch || -150} dB</Box>
                        </Stack>

                        <Stack spacing={2} direction="row" alignItems="center" sx={{mt: 2}}>
                            <VolumeDown/>
                            <Slider
                                value={vfoMarkers[vfoIndex]?.volume || 50}
                                onChange={(e, val) => dispatch(setVFOProperty({
                                    vfoNumber: vfoIndex,
                                    updates: {volume: val}
                                }))}
                            />
                            <VolumeUp/>
                        </Stack>
                    </Box>
                ))}
            </AccordionDetails>
        </Accordion>
    );
};

export default VFOPanel;
