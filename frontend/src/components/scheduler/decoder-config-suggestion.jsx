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

import React, { useEffect, useState } from 'react';
import { Box, Typography, CircularProgress, Alert, Link, Button } from '@mui/material';
import { Lightbulb as LightbulbIcon, Info as InfoIcon } from '@mui/icons-material';
import { useSocket } from '../common/socket.jsx';
import { useTranslation } from 'react-i18next';

/**
 * DecoderConfigSuggestion component
 *
 * Displays suggested decoder configuration retrieved from gr-satellites database
 * when a transmitter is selected. Shows a summary of the recommended parameters
 * with attribution to Daniel Estévez's gr-satellites project.
 *
 * @param {Object} props
 * @param {string} props.decoderType - The decoder type (gmsk, bpsk, aprs, etc.)
 * @param {Object} props.satellite - Satellite object with norad_id and name
 * @param {Object} props.transmitter - Transmitter object with baud, mode, description, etc.
 * @param {boolean} props.show - Whether to show the suggestion (when transmitter is selected)
 * @param {Function} props.onApply - Callback function to apply the configuration to the form
 */
export const DecoderConfigSuggestion = ({ decoderType, satellite, transmitter, show, onApply }) => {
    const { t } = useTranslation('common');
    const { socket } = useSocket();
    const [loading, setLoading] = useState(false);
    const [config, setConfig] = useState(null);
    const [error, setError] = useState(null);

    // Use stable IDs instead of full objects in dependencies
    const satelliteId = satellite?.norad_id;
    const transmitterId = transmitter?.id;

    useEffect(() => {
        // Only fetch if we should show and have required data
        if (!show || !decoderType || !transmitter || decoderType === 'none') {
            setConfig(null);
            setError(null);
            return;
        }

        const fetchConfig = () => {
            setLoading(true);
            setError(null);

            socket.emit("api.call", {
  cmd: 'get-decoder-config',
  data: {
    decoder_type: decoderType,
    satellite: satellite || undefined,
    transmitter: transmitter || undefined
  }
}, response => {
  console.log('[DecoderConfigSuggestion] Backend response:', response);
  setLoading(false);
  if (response.success) {
    console.log('[DecoderConfigSuggestion] Config data:', response.data);
    setConfig(response.data);
  } else {
    console.error('[DecoderConfigSuggestion] Error:', response.error);
    setError(response.error || 'Failed to fetch decoder configuration');
  }
});
        };

        fetchConfig();
    }, [socket, decoderType, satelliteId, transmitterId, show]);

    const handleApply = () => {
        if (config && onApply) {
            onApply(config);
        }
    };

    // Don't render if we shouldn't show or decoder type is 'none'
    if (!show || decoderType === 'none') {
        return null;
    }

    // Don't render if there's an error (e.g., invalid decoder type)
    if (error) {
        return null;
    }

    // Loading state
    if (loading) {
        return (
            <Box
                sx={{
                    p: 2,
                    bgcolor: (theme) => theme.palette.mode === 'dark' ? 'grey.800' : 'grey.100',
                    borderRadius: 1,
                    border: '1px solid',
                    borderColor: 'divider',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                }}
            >
                <CircularProgress size={16} />
                <Typography variant="body2" color="text.secondary">
                    {t('decoder_config_suggestion.loading_decoder_configuration', { defaultValue: 'Loading decoder configuration...' })}
                </Typography>
            </Box>
        );
    }

    // No config loaded yet
    if (!config) {
        return null;
    }

    // Format configuration summary based on decoder type and available parameters
    const formatConfigSummary = () => {
        const parts = [];

        // Baudrate (common to most decoders)
        if (config.baudrate) {
            parts.push(`${config.baudrate} baud`);
        }

        // Framing protocol (common to most decoders)
        if (config.framing) {
            parts.push(`${config.framing.toUpperCase()} framing`);

            // Add framing-specific parameters (e.g., GEOSCAN frame_size)
            if (config.framing === 'geoscan' && config.framing_params?.frame_size) {
                parts.push(`${config.framing_params.frame_size} byte frames`);
            }
        }

        // Deviation (FSK, GMSK, GFSK, APRS Bell 202 tones)
        if (config.deviation !== null && config.deviation !== undefined) {
            parts.push(`${config.deviation} Hz deviation`);
        }

        // AF carrier (APRS Bell 202 specific)
        if (config.af_carrier) {
            parts.push(`${config.af_carrier} Hz carrier`);
        }

        // Differential mode (BPSK specific)
        if (config.differential) {
            parts.push('Differential');
        }

        // LoRa specific
        if (config.sf) {
            parts.push(`SF${config.sf}`);
        }
        if (config.bw) {
            parts.push(`BW${config.bw / 1000}k`);
        }
        if (config.cr) {
            parts.push(`CR4/${config.cr + 4}`);
        }

        return parts.join(' • ');
    };

    // Determine source label for attribution
    const getSourceLabel = () => {
        switch (config.config_source) {
            case 'satellite_config':
                return 'Configuration from satellite database';
            case 'transmitter_metadata':
                return 'Configuration detected from transmitter metadata (mode, description, baud rate)';
            case 'smart_default':
                return 'Configuration estimated using smart defaults based on decoder type and baud rate';
            case 'manual':
                return 'Manual configuration specified by user';
            default:
                return 'Configuration source unknown';
        }
    };

    const configSummary = formatConfigSummary();

    return (
        <Box
            sx={{
                p: 2,
                mb: 2,
                bgcolor: (theme) =>
                    config.config_source === 'satellite_config'
                        ? theme.palette.mode === 'dark'
                            ? 'rgba(46, 125, 50, 0.15)'
                            : 'rgba(46, 125, 50, 0.08)'
                        : theme.palette.mode === 'dark'
                        ? 'rgba(2, 136, 209, 0.15)'
                        : 'rgba(2, 136, 209, 0.08)',
                borderRadius: 2,
                border: '1px solid',
                borderColor: (theme) =>
                    config.config_source === 'satellite_config'
                        ? theme.palette.mode === 'dark'
                            ? 'rgba(46, 125, 50, 0.4)'
                            : 'rgba(46, 125, 50, 0.3)'
                        : theme.palette.mode === 'dark'
                        ? 'rgba(2, 136, 209, 0.4)'
                        : 'rgba(2, 136, 209, 0.3)',
                boxShadow: (theme) =>
                    theme.palette.mode === 'dark'
                        ? '0 2px 8px rgba(0, 0, 0, 0.4)'
                        : '0 2px 8px rgba(0, 0, 0, 0.05)',
            }}
        >
            {/* Configuration Summary */}
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, mb: 1 }}>
                <LightbulbIcon
                    sx={{
                        fontSize: 20,
                        color: (theme) =>
                            config.config_source === 'satellite_config'
                                ? theme.palette.mode === 'dark'
                                    ? '#66bb6a'
                                    : '#2e7d32'
                                : theme.palette.mode === 'dark'
                                ? '#42a5f5'
                                : '#0288d1',
                        mt: 0.2,
                    }}
                />
                <Box sx={{ flex: 1 }}>
                    <Typography
                        variant="body2"
                        sx={{
                            fontWeight: 600,
                            color: 'text.primary',
                        }}
                    >
                        {t('decoder_config_suggestion.suggested_configuration_for_this_satellite', { defaultValue: 'Suggested configuration for this satellite' })}
                        {config.transmitter?.mode && ` (${config.transmitter.mode})`}
                    </Typography>
                    <Typography
                        variant="body2"
                        sx={{
                            color: 'text.secondary',
                            fontFamily: 'monospace',
                            fontSize: '0.875rem',
                        }}
                    >
                        {configSummary || 'No specific parameters available'}
                    </Typography>
                </Box>
                {onApply && (
                    <Button
                        size="small"
                        variant="contained"
                        onClick={handleApply}
                        sx={{
                            minWidth: 80,
                            bgcolor: (theme) =>
                                config.config_source === 'satellite_config'
                                    ? 'success.main'
                                    : 'info.main',
                            color: (theme) =>
                                config.config_source === 'satellite_config'
                                    ? 'success.contrastText'
                                    : 'info.contrastText',
                            '&:hover': {
                                bgcolor: (theme) =>
                                    config.config_source === 'satellite_config'
                                        ? 'success.dark'
                                        : 'info.dark',
                            },
                        }}
                    >
                        {t('decoder_config_suggestion.apply', { defaultValue: 'Apply' })}
                    </Button>
                )}
            </Box>

            {/* Attribution */}
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
                <InfoIcon
                    sx={{
                        fontSize: 16,
                        color: 'text.secondary',
                        opacity: 0.7,
                        mt: 0.3,
                    }}
                />
                <Typography
                    variant="caption"
                    sx={{
                        color: 'text.secondary',
                        opacity: 0.85,
                    }}
                >
                    {config.config_source === 'satellite_config' ? (
                        <>
                            {getSourceLabel()}{' '}
                            <Link
                                href="https://github.com/daniestevez/gr-satellites"
                                target="_blank"
                                rel="noopener noreferrer"
                                sx={{
                                    color: 'inherit',
                                    fontWeight: 600,
                                    textDecoration: 'underline',
                                    '&:hover': {
                                        opacity: 0.8,
                                    },
                                }}
                            >
                                gr-satellites
                            </Link>{' '}
                            by{' '}
                            <Link
                                href="https://destevez.net"
                                target="_blank"
                                rel="noopener noreferrer"
                                sx={{
                                    color: 'inherit',
                                    fontWeight: 600,
                                    textDecoration: 'underline',
                                    '&:hover': {
                                        opacity: 0.8,
                                    },
                                }}
                            >
                                {t('decoder_config_suggestion.daniel_est_vez', { defaultValue: 'Daniel Estévez' })}
                            </Link>
                        </>
                    ) : (
                        getSourceLabel()
                    )}
                </Typography>
            </Box>
        </Box>
    );
};
