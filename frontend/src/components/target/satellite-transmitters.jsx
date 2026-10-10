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

import React from "react";
import { useSelector } from "react-redux";
import { useTranslation } from 'react-i18next';
import {
    getClassNamesBasedOnGridEditing,
    islandTitleBarSx,
    TitleBar,
    getFrequencyBand,
    getBandColor
} from "../common/common.jsx";
import {
    Box,
    Typography,
    Chip
} from '@mui/material';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';

const TargetSatelliteTransmittersIsland = () => {
    const { t } = useTranslation('target');
    const { satelliteData, gridEditable } = useSelector((state) => state.targetSatTrack);
    const transmitters = satelliteData?.transmitters || [];

    const totalTransmitters = transmitters.length;
    const activeTransmitters = transmitters.filter((tx) => tx?.alive && tx?.status === 'active').length;
    const inactiveTransmitters = totalTransmitters - activeTransmitters;
    const uniqueBands = [...new Set(
        transmitters
            .map((tx) => tx?.downlink_low ? getFrequencyBand(tx.downlink_low) : null)
            .filter(Boolean)
    )];

    const formatFrequency = (hz) => (hz ? `${(hz / 1e6).toFixed(3)} MHz` : t('satellite_info.values.na'));

    const formatFrequencyRange = (lowHz, highHz) => {
        if (!lowHz && !highHz) return t('satellite_info.values.na');
        if (lowHz && highHz) return `${(lowHz / 1e6).toFixed(3)} - ${(highHz / 1e6).toFixed(3)} MHz`;
        return formatFrequency(lowHz || highHz);
    };

    const formatDrift = (driftHz) => {
        if (!driftHz) return 'Δ N/A';
        const sign = driftHz > 0 ? '+' : '';
        return `Δ ${sign}${(driftHz / 1e3).toFixed(1)} kHz`;
    };

    const formatViolationText = () => {
        let text = t('satellite_transmitters.messages.frequency_violation').trim();

        while (text.length > 0) {
            const firstCodePoint = text.codePointAt(0);

            if (firstCodePoint === 0x26A0 || firstCodePoint === 0xFE0F || firstCodePoint === 0x21) {
                text = text.slice(firstCodePoint > 0xFFFF ? 2 : 1).trim();
                continue;
            }

            break;
        }

        return text;
    };

    const BandBadge = ({ band }) => {
        return (
            <Box sx={{
                px: 1,
                py: 0.35,
                bgcolor: getBandColor(band) || 'primary.main',
                borderRadius: 99,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 42
            }}>
                <Typography variant="caption" sx={{
                    color: '#ffffff',
                    fontSize: '0.66rem',
                    fontWeight: 700,
                    letterSpacing: '0.35px'
                }}>
                    {band}
                </Typography>
            </Box>
        );
    };

    const StatChip = ({ label, value, color = 'default' }) => (
        <Chip
            size="small"
            color={color}
            label={`${label}: ${value}`}
            sx={{
                height: 21,
                borderRadius: 1,
                fontSize: '0.68rem',
                fontWeight: 700,
                '& .MuiChip-label': { px: 0.9 }
            }}
        />
    );

    const TransmitterRow = ({ transmitter }) => {
        const { t } = useTranslation('target');
        const band = transmitter.downlink_low ? getFrequencyBand(transmitter.downlink_low) : 'N/A';
        const isActive = transmitter.alive && transmitter.status === 'active';

        return (
            <Box sx={{
                p: 1,
                mb: 0.75,
                bgcolor: 'overlay.light',
                borderRadius: 1.25,
                border: '1px solid',
                borderColor: isActive ? 'success.dark' : 'border.main',
                boxShadow: isActive ? '0 3px 14px rgba(76, 175, 80, 0.12)' : '0 2px 10px rgba(0, 0, 0, 0.12)',
                transition: 'all 0.22s ease'
            }}>
                <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 0.75, mb: 0.75 }}>
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography
                            variant="subtitle2"
                            sx={{
                                fontWeight: 600,
                                color: 'text.primary',
                                letterSpacing: '0.1px',
                                lineHeight: 1.25,
                                mb: 0.2,
                                fontSize: '0.82rem'
                            }}
                        >
                            {transmitter.description || 'Unknown transmitter'}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.66rem' }}>
                            {(transmitter.source || 'Unknown source').toUpperCase()}
                        </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.45, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <Chip
                            label={isActive ? 'ACTIVE' : (transmitter.status || 'INACTIVE').toUpperCase()}
                            size="small"
                            color={isActive ? 'success' : 'default'}
                            sx={{ height: 18, fontSize: '0.58rem', fontWeight: 700 }}
                        />
                        <BandBadge band={band} />
                    </Box>
                </Box>

                <Box sx={{
                    display: 'grid',
                    gap: 0.65,
                    gridTemplateColumns: {
                        xs: '1fr',
                        sm: 'repeat(2, minmax(0, 1fr))'
                    },
                    mb: 0.75
                }}>
                    <Box sx={{
                        px: 0.65,
                        pb: 0.65,
                        pt: 0,
                        borderRadius: 0.85,
                        border: '1px solid',
                        borderColor: 'border.main',
                        bgcolor: 'background.paper'
                    }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.45px' }}>
                            {t('satellite_transmitters.labels.downlink')}
                        </Typography>
                        <Typography sx={{ mt: 0.15, fontWeight: 700, color: 'primary.main', fontFamily: 'monospace', fontSize: '0.76rem' }}>
                            {formatFrequencyRange(transmitter.downlink_low, transmitter.downlink_high)}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'warning.light', fontFamily: 'monospace', mt: 0.15, display: 'block', fontSize: '0.62rem' }}>
                            {formatDrift(transmitter.downlink_drift)}
                        </Typography>
                    </Box>

                    <Box sx={{
                        px: 0.65,
                        pb: 0.65,
                        pt: 0,
                        borderRadius: 0.85,
                        border: '1px solid',
                        borderColor: 'border.main',
                        bgcolor: 'background.paper'
                    }}>
                        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.62rem', textTransform: 'uppercase', letterSpacing: '0.45px' }}>
                            {t('satellite_transmitters.uplink', { defaultValue: 'Uplink' })}
                        </Typography>
                        <Typography sx={{ mt: 0.15, fontWeight: 700, color: 'secondary.main', fontFamily: 'monospace', fontSize: '0.76rem' }}>
                            {formatFrequencyRange(transmitter.uplink_low, transmitter.uplink_high)}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'warning.light', fontFamily: 'monospace', mt: 0.15, display: 'block', fontSize: '0.62rem' }}>
                            {formatDrift(transmitter.uplink_drift)}
                        </Typography>
                    </Box>
                </Box>

                <Box sx={{ display: 'flex', gap: 0.45, flexWrap: 'wrap', alignItems: 'center' }}>
                    <Chip
                        label={`${t('satellite_transmitters.labels.mode')}: ${transmitter.mode || t('satellite_info.values.na')}`}
                        size="small"
                        variant="outlined"
                        sx={{ height: 19, fontSize: '0.6rem', fontWeight: 600 }}
                    />
                    <Chip
                        label={`${t('satellite_transmitters.labels.baud')}: ${transmitter.baud ? `${transmitter.baud} bps` : t('satellite_info.values.na')}`}
                        size="small"
                        variant="outlined"
                        sx={{ height: 19, fontSize: '0.6rem', fontWeight: 600 }}
                    />
                    <Chip
                        label={`Service: ${transmitter.service || t('satellite_info.values.na')}`}
                        size="small"
                        variant="outlined"
                        sx={{ height: 19, fontSize: '0.6rem', fontWeight: 600 }}
                    />
                    <Chip
                        label={`Type: ${transmitter.type || t('satellite_info.values.na')}`}
                        size="small"
                        variant="outlined"
                        sx={{ height: 19, fontSize: '0.6rem', fontWeight: 600 }}
                    />
                </Box>

                {(transmitter.invert || transmitter.unconfirmed) && (
                    <Box sx={{ mt: 0.55, display: 'flex', gap: 0.4, flexWrap: 'wrap' }}>
                        {transmitter.invert && (
                            <Chip
                                label={t('satellite_transmitters.inverted', { defaultValue: 'Inverted' })}
                                size="small"
                                sx={{ height: 16, fontSize: '0.55rem', bgcolor: 'warning.main', color: 'warning.contrastText' }}
                            />
                        )}
                        {transmitter.unconfirmed && (
                            <Chip
                                label={t('satellite_transmitters.unconfirmed', { defaultValue: 'Unconfirmed' })}
                                size="small"
                                sx={{ height: 16, fontSize: '0.55rem', bgcolor: 'info.main', color: 'info.contrastText' }}
                            />
                        )}
                    </Box>
                )}

                {transmitter.frequency_violation && (
                    <Box sx={{
                        mt: 0.55,
                        px: 0.6,
                        py: 0.45,
                        bgcolor: 'error.dark',
                        borderRadius: 0.7,
                        border: '1px solid',
                        borderColor: 'error.main',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.45
                    }}>
                        <WarningAmberRoundedIcon sx={{ color: 'error.contrastText', fontSize: 13 }} />
                        <Typography variant="caption" sx={{ color: 'error.contrastText', fontWeight: 800, fontSize: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.3px', lineHeight: 1.1 }}>
                            {formatViolationText()}
                        </Typography>
                    </Box>
                )}
            </Box>
        );
    };

    return (
        <Box sx={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            bgcolor: 'background.paper',
            backdropFilter: 'blur(10px)',
            backgroundImage: 'linear-gradient(rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.05))'
        }}>
            <TitleBar
                className={getClassNamesBasedOnGridEditing(gridEditable, ["window-title-bar"])}
                sx={{
                    ...islandTitleBarSx,
                    height: 30,
                    minHeight: 30,
                }}
            >
                <Box sx={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 1, minWidth: 0}}>
                    <Box sx={{display: 'flex', alignItems: 'center', minWidth: 0, flex: 1}}>
                        <Typography
                            variant="subtitle2"
                            noWrap
                            sx={{
                                fontWeight: 800,
                                letterSpacing: '0.2px',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                            }}
                        >
                            {t('satellite_transmitters.title')}
                        </Typography>
                    </Box>
                    <Typography
                        variant="caption"
                        noWrap
                        sx={{color: 'text.secondary', fontWeight: 700, flexShrink: 0, whiteSpace: 'nowrap'}}
                    >
                        {t('satellite_transmitters.count')}: {totalTransmitters}
                    </Typography>
                </Box>
            </TitleBar>

            {transmitters.length > 0 ? (
                <Box sx={{ pr: 1.5, pl: 1.5, pt: 1.2, pb: 1, flex: 1, overflow: 'auto' }}>
                    <Box sx={{ mb: 1.1, display: 'flex', flexWrap: 'wrap', gap: 0.7 }}>
                        <StatChip label={t('satellite_transmitters.labels.total')} value={totalTransmitters} />
                        <StatChip label={t('satellite_transmitters.labels.active')} value={activeTransmitters} color="success" />
                        <StatChip label={t('satellite_transmitters.labels.inactive')} value={inactiveTransmitters} />
                        <StatChip label={t('satellite_transmitters.labels.frequency_bands')} value={uniqueBands.length} color="primary" />
                    </Box>

                    {transmitters.map((transmitter, index) => (
                        <TransmitterRow key={transmitter.id || index} transmitter={transmitter} />
                    ))}
                </Box>
            ) : (
                <Box sx={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    flex: 1,
                    py: 4,
                    px: 2,
                    textAlign: 'center'
                }}>
                    <Box>
                        <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic', mb: 0.4 }}>
                            {t('satellite_transmitters.messages.no_transmitters')}
                        </Typography>
                        <Typography variant="caption" sx={{ color: 'text.disabled' }}>
                            {t('satellite_transmitters.messages.no_transmitters_desc')}
                        </Typography>
                    </Box>
                </Box>
            )}
        </Box>
    );
}

export default TargetSatelliteTransmittersIsland;
