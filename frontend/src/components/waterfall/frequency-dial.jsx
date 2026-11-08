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


import React, { useState, useEffect } from 'react';
import { Box, Typography, IconButton } from '@mui/material';
import { useTranslation } from 'react-i18next';
import ArrowDropUpIcon from '@mui/icons-material/ArrowDropUp';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';

const FrequencyDisplay = ({
                              initialFrequency = 1000.0,
                              onChange,
                              integerDigits = 8, // prop to configure the number of integer digits
                              decimalDigits = 3, // prop to configure decimal digits
                              size = 'medium', // prop to control size - can be 'small', 'medium', 'large' or a number
                              hideHzDigits = false, // new prop to show disabled zeros instead of Hz digits
                              disabled = false, // prop to disable the entire component
                              readOnly = false,
                              'aria-label': ariaLabel,
                          }) => {
    const { t } = useTranslation('waterfall');
    const [frequency, setFrequency] = useState(initialFrequency);

    // Update local state if prop changes
    useEffect(() => {
        setFrequency(initialFrequency);
    }, [initialFrequency]);

    // Size mapping for predefined sizes
    const sizeMap = {
        small: 0.8,
        medium: 1,
        large: 1.4
    };
    
    // Determine the scale factor based on size prop
    const scaleFactor = typeof size === 'number' 
        ? size 
        : sizeMap[size] || sizeMap.medium;
    
    // Calculate dynamic sizes based on scale factor
    const fontSizes = {
        digits: `${1.5 * scaleFactor}rem`,
        unit: `${1.2 * scaleFactor}rem`,
        label: `${0.875 * scaleFactor}rem`,
        unitLabel: `${1.2 * scaleFactor}rem`
    };
    
    const iconSize = scaleFactor <= 0.8 ? 'small' : 'medium';
    const iconSx = {
        fontSize: `${24 * scaleFactor}px`
    };
    
    const spacing = {
        mx: 0.2 * scaleFactor
    };

    // Handle digit adjustment
    const adjustDigit = (position, increment) => {
        if (disabled || readOnly) return;
        // Calculate the power of 10 for this position
        const multiplier = 10 ** position;

        // Calculate the new frequency
        let newFrequency = frequency + (increment * multiplier);

        // Handle edge cases
        if (newFrequency < 0) newFrequency = 0;

        // Round to prevent floating point errors
        newFrequency = Math.round(newFrequency * (10 ** decimalDigits)) / (10 ** decimalDigits);

        // Update state
        setFrequency(newFrequency);

        // Call the onChange callback if provided
        if (onChange) {
            onChange(newFrequency);
        }
    };

    // Create a single digit with controls
    const renderDigit = (digit, position, index, digitDisabled = false) => {
        const isDisabled = disabled || readOnly || digitDisabled;
        // The dial works in kHz; announce each digit's tuning step in Hz.
        const step = Math.round(10 ** position * 1000);
        return (
            <Box
                key={`digit-${index}`}
                sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    ...spacing
                }}
            >
                <IconButton
                    size={iconSize}
                    aria-label={t('frequency.increase_by_hz', { step })}
                    onClick={() => !isDisabled && adjustDigit(position, 1)}
                    disabled={isDisabled}
                    sx={{
                        p: 0,
                        visibility: isDisabled ? 'hidden' : 'visible'
                    }}
                >
                    <ArrowDropUpIcon sx={iconSx} />
                </IconButton>
                <Typography
                    sx={{
                        fontFamily: 'monospace',
                        fontSize: fontSizes.digits,
                        color: disabled || digitDisabled ? 'text.disabled' : 'text.primary'
                    }}
                >
                    {digit}
                </Typography>
                <IconButton
                    size={iconSize}
                    aria-label={t('frequency.decrease_by_hz', { step })}
                    onClick={() => !isDisabled && adjustDigit(position, -1)}
                    disabled={isDisabled}
                    sx={{
                        p: 0,
                        visibility: isDisabled ? 'hidden' : 'visible'
                    }}
                >
                    <ArrowDropDownIcon sx={iconSx} />
                </IconButton>
            </Box>
        );
    };

    // Render a separator (comma or decimal point)
    const renderSeparator = (separator, index) => {
        return (
            <Box
                key={`separator-${index}`}
                sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    ...spacing
                }}
            >
                <Box sx={{ height: 24 * scaleFactor }}></Box>
                <Typography
                    sx={{
                        fontFamily: 'monospace',
                        fontSize: fontSizes.digits,
                        color: disabled ? 'text.disabled' : 'text.primary'
                    }}
                >
                    {separator}
                </Typography>
                <Box sx={{ height: 24 * scaleFactor }}></Box>
            </Box>
        );
    };

    // Create digit components with their controls
    const renderDigitControls = () => {
        // Convert frequency to string with fixed decimal places
        const frequencyString = frequency.toFixed(decimalDigits);
        
        const parts = frequencyString.split('.');
        let integerPart = parts[0];
        const decimalPart = parts[1] || '0'.repeat(decimalDigits);

        // Pad the integer part with zeros to match the desired length
        integerPart = integerPart.padStart(integerDigits, '0');
        
        // Create array of positions (power of 10) for each digit
        const positions = [];
        for (let i = integerPart.length - 1; i >= 0; i--) {
            positions.unshift(integerPart.length - 1 - i);
        }
        
        // Add decimal positions
        for (let i = 0; i < decimalPart.length; i++) {
            positions.push(-(i + 1));
        }

        // Group the integer part into groups of 3 digits
        const groups = [];
        
        // Process the integer part in groups of 3, starting from the right
        for (let i = integerPart.length - 1; i >= 0; i -= 3) {
            const startIndex = Math.max(0, i - 2);
            const group = [];
            
            // Get the digits for this group (up to 3)
            for (let j = startIndex; j <= i; j++) {
                const digit = integerPart[j];
                const position = positions[j];
                group.push({ digit, position, index: j });
            }
            
            // Determine label for this group
            let label;
            if (i === integerPart.length - 1) {
                label = 'kHz'; // rightmost group (units)
            } else if (i === integerPart.length - 4) {
                label = 'MHz'; // second group from right (thousands)
            } else if (i === integerPart.length - 7) {
                label = 'GHz'; // third group from right (millions)
            } else {
                label = '';
            }
            
            // Add the group and label
            groups.unshift({ digits: group, label });
        }

        // Handle the decimal part as a separate group
        if (decimalDigits > 0) {
            const decimalGroup = [];
            const numDigits = hideHzDigits ? 1 : decimalDigits;
            for (let i = 0; i < numDigits; i++) {
                const digit = hideHzDigits ? '0' : decimalPart[i];
                const position = -(i + 1);
                decimalGroup.push({ digit, position, index: integerPart.length + 1 + i, disabled: hideHzDigits });
            }
            groups.push({ digits: decimalGroup, label: 'Hz' });
        }

        return (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <Box sx={{ display: 'flex', justifyContent: 'center'}}>
                    {groups.map((group, groupIndex) => (
                        <React.Fragment key={`group-${groupIndex}`}>
                            {/* Render each digit group as a column with a label underneath */}
                            <Box 
                                sx={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',

                                }}
                            >
                                {/* Digits row */}
                                <Box sx={{ display: 'flex' }}>
                                    {group.digits.map((digitObj, digitIndex) => 
                                        renderDigit(digitObj.digit, digitObj.position, digitObj.index, digitObj.disabled)
                                    )}
                                </Box>
                                
                                {/* Label underneath */}
                                <Typography
                                    sx={{
                                        fontSize: fontSizes.unitLabel,
                                        color: disabled ? 'text.disabled' : 'text.secondary',
                                        mt: 0.5 * scaleFactor,
                                        mb: 1 * scaleFactor,
                                        fontFamily: 'monospace'
                                    }}
                                >
                                    {group.label}
                                </Typography>
                            </Box>
                            
                            {/* Add comma between integer groups */}
                            {groupIndex < groups.length - 1 && 
                             !(groupIndex === groups.length - 2 && decimalPart.length > 0) && 
                                renderSeparator(',', `comma-${groupIndex}`)}
                            
                            {/* Add decimal point between the integer and decimal groups */}
                            {groupIndex === groups.length - 2 && decimalPart.length > 0 && 
                                renderSeparator('.', 'decimal')}
                        </React.Fragment>
                    ))}
                </Box>
            </Box>
        );
    };

    return (
        <Box role={ariaLabel ? 'group' : undefined} aria-label={ariaLabel} sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            my: 0,
            width: '100%',
            opacity: disabled ? 0.5 : 1,
            pointerEvents: disabled || readOnly ? 'none' : 'auto',
            transition: 'opacity 0.3s ease'
        }}>
            <Box sx={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                width: '100%',
                p: 0,
            }}>
                {renderDigitControls()}
            </Box>
        </Box>
    );
};

// The surrounding settings panel also receives live SDR and VFO updates. The
// dial is expensive to construct, so skip its MUI tree unless a dial prop moves.
export default React.memo(FrequencyDisplay);
