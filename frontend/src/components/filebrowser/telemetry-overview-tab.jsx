/**
 * @license
 * Copyright (c) 2025 Efstratios Goudelis
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 */

import React from 'react';
import {
    Box,
    Typography,
    Divider,
    Chip,
    Stack,
    useTheme,
} from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { getDecoderDisplay, ModulationType } from '../../constants/modulations';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { formatDateTime } from '../../utils/date-time.js';
import { useTranslation } from 'react-i18next';

function InfoSection({ title, children }) {
    const theme = useTheme();
    return (
        <Box sx={{ mb: 3 }}>
            <Typography
                variant="subtitle2"
                sx={{
                    mb: 1.5,
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    color: theme.palette.text.secondary,
                    fontSize: '0.75rem',
                    letterSpacing: 1,
                }}
            >
                {title}
            </Typography>
            <Divider sx={{ mb: 2 }} />
            {children}
        </Box>
    );
}

function InfoRow({ label, value, mono = false }) {
    return (
        <Box sx={{
            display: 'flex',
            justifyContent: 'space-between',
            py: 0.75,
            alignItems: 'center',
        }}>
            <Typography variant="body2" color="text.secondary">
                {label}
            </Typography>
            <Typography
                variant="body2"
                sx={{
                    fontFamily: mono ? 'monospace' : 'inherit',
                    fontWeight: 500,
                }}
            >
                {value || '-'}
            </Typography>
        </Box>
    );
}

export default function OverviewTab({ metadata, file, telemetry, packet, ax25 }) {
    const { t } = useTranslation('filebrowser');
    const theme = useTheme();
    const { timezone, locale } = useUserTimeSettings();

    // Format timestamp
    const formatTimestamp = (ts) => {
        if (!ts) return '-';
        try {
            const dateValue = typeof ts === 'number' ? ts * 1000 : ts;
            return formatDateTime(dateValue, { timezone, locale });
        } catch {
            return String(ts);
        }
    };

    // Get frame info from telemetry
    const frame = telemetry.frame || {};
    const signal = metadata.signal || {};
    const vfo = metadata.vfo || {};
    const decoder = metadata.decoder || {};

    const decoderConfig = metadata.decoder_config || {};
    const framing = decoderConfig.framing;
    const payloadProtocol = decoderConfig.payload_protocol;
    const geoscan = decoderConfig.geoscan || {};
    const framingParams = decoderConfig.framing_params || {};
    const telemetryParser = telemetry.parser || '';

    const isGeoscan = framing === 'geoscan' || payloadProtocol === 'proprietary';
    // Encapsulated AX.25 detection: show AX.25 frame whenever telemetry.frame carries
    // source/destination, regardless of which payload parser produced values.
    const hasEncapsulatedAx25 = Boolean((telemetry?.frame && telemetry.frame.source && telemetry.frame.destination));


    return (
        <Box>
            {/* Two Column Layout for remaining sections */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
                {/* Left Column */}
                <Box>
                    {/* Link-layer / Frame Information */}
                    {isGeoscan ? (
                        <InfoSection title={t('telemetry_overview_tab.geoscan_frame_information', { defaultValue: 'GEOSCAN Frame Information' })}>
                            <InfoRow label={t('telemetry_overview_tab.framing', { defaultValue: 'Framing' })} value={framing || 'geoscan'} />
                            <InfoRow label={t('telemetry_overview_tab.protocol', { defaultValue: 'Protocol' })} value={payloadProtocol || 'proprietary'} />
                            <InfoRow
                                label={t('telemetry_overview_tab.configured_frame_size', { defaultValue: 'Configured Frame Size' })}
                                value={`${geoscan.frame_size || framingParams.frame_size || 66} bytes`}
                            />
                            <InfoRow
                                label={t('telemetry_overview_tab.delivered_payload_length', { defaultValue: 'Delivered Payload Length' })}
                                value={`${telemetry.raw?.payload_length || packet.length_bytes || '-'} bytes`}
                            />
                            <InfoRow
                                label={t('telemetry_overview_tab.pn9_descrambler', { defaultValue: 'PN9 Descrambler' })}
                                value={geoscan.pn9_descrambled === false ? 'No' : 'Yes'}
                            />
                            <InfoRow
                                label={t('telemetry_overview_tab.cc11xx_crc', { defaultValue: 'CC11xx CRC' })}
                                value={(geoscan.cc11xx_crc || 'ok').toUpperCase()}
                            />
                            <InfoRow
                                label={t('telemetry_overview_tab.syncword_threshold', { defaultValue: 'Syncword Threshold' })}
                                value={`${geoscan.syncword_threshold ?? framingParams.syncword_threshold ?? 4}`}
                            />
                            <InfoRow label={t('telemetry_overview_tab.parser', { defaultValue: 'Parser' })} value={telemetryParser || 'proprietary'} />
                        </InfoSection>
                    ) : (
                        <InfoSection title={t('telemetry_overview_tab.ax_25_frame_information', { defaultValue: 'AX.25 Frame Information' })}>
                            <InfoRow
                                label={t('telemetry_overview_tab.source', { defaultValue: 'Source' })}
                                value={frame.source || ax25.from_callsign}
                                mono
                            />
                            <InfoRow
                                label={t('telemetry_overview_tab.destination', { defaultValue: 'Destination' })}
                                value={frame.destination || ax25.to_callsign}
                                mono
                            />
                            <InfoRow
                                label={t('telemetry_overview_tab.control', { defaultValue: 'Control' })}
                                value={frame.control}
                                mono
                            />
                            <InfoRow
                                label={t('telemetry_overview_tab.pid', { defaultValue: 'PID' })}
                                value={frame.pid}
                                mono
                            />
                            <InfoRow
                                label={t('telemetry_overview_tab.parser', { defaultValue: 'Parser' })}
                                value={telemetryParser || 'ax25'}
                            />
                        </InfoSection>
                    )}

                    {/* Encapsulated AX.25 (when GEOSCAN carries an inner AX.25) */}
                    {isGeoscan && hasEncapsulatedAx25 && (
                        <InfoSection title={t('telemetry_overview_tab.encapsulated_ax_25_frame', { defaultValue: 'Encapsulated AX.25 Frame' })}>
                            <InfoRow label={t('telemetry_overview_tab.source', { defaultValue: 'Source' })} value={frame.source || ax25.from_callsign} mono />
                            <InfoRow label={t('telemetry_overview_tab.destination', { defaultValue: 'Destination' })} value={frame.destination || ax25.to_callsign} mono />
                            <InfoRow label={t('telemetry_overview_tab.control', { defaultValue: 'Control' })} value={frame.control} mono />
                            <InfoRow label={t('telemetry_overview_tab.pid', { defaultValue: 'PID' })} value={frame.pid} mono />
                        </InfoSection>
                    )}

                    {/* Packet Metadata */}
                    <InfoSection title={t('telemetry_overview_tab.packet_metadata', { defaultValue: 'Packet Metadata' })}>
                        <InfoRow
                            label={t('telemetry_overview_tab.packet_number', { defaultValue: 'Packet Number' })}
                            value={`#${packet.number || metadata.packet_number || '-'}`}
                        />
                        <InfoRow
                            label={t('telemetry_overview_tab.timestamp', { defaultValue: 'Timestamp' })}
                            value={formatTimestamp(packet.timestamp || metadata.timestamp)}
                        />
                        <InfoRow
                            label={t('telemetry_overview_tab.total_length', { defaultValue: 'Total Length' })}
                            value={`${packet.length_bytes || packet.length || '-'} bytes`}
                        />
                        <InfoRow
                            label={t('telemetry_overview_tab.payload_length', { defaultValue: 'Payload Length' })}
                            value={`${telemetry.raw?.payload_length || '-'} bytes`}
                        />
                        <InfoRow
                            label={t('telemetry_overview_tab.session_id', { defaultValue: 'Session ID' })}
                            value={decoder.session_id}
                            mono
                        />
                        <InfoRow
                            label={t('telemetry_overview_tab.vfo', { defaultValue: 'VFO' })}
                            value={vfo.id}
                        />
                    </InfoSection>
                </Box>

                {/* Right Column */}
                <Box>
                    {/* Signal Information */}
                    <InfoSection title={t('telemetry_overview_tab.signal_information', { defaultValue: 'Signal Information' })}>
                        <InfoRow
                            label={t('telemetry_overview_tab.frequency', { defaultValue: 'Frequency' })}
                            value={signal.frequency_mhz ? `${signal.frequency_mhz} MHz` : '-'}
                        />
                        <InfoRow
                            label={t('telemetry_overview_tab.baudrate', { defaultValue: 'Baudrate' })}
                            value={decoder.baudrate ? `${decoder.baudrate} baud` : '-'}
                        />
                        <InfoRow
                            label={t('telemetry_overview_tab.sdr_center', { defaultValue: 'SDR Center' })}
                            value={signal.sdr_center_freq_mhz ? `${signal.sdr_center_freq_mhz} MHz` : '-'}
                        />
                        <InfoRow
                            label={t('telemetry_overview_tab.vfo_center', { defaultValue: 'VFO Center' })}
                            value={vfo.center_freq_mhz ? `${vfo.center_freq_mhz} MHz` : '-'}
                        />
                        <InfoRow
                            label={t('telemetry_overview_tab.vfo_bandwidth', { defaultValue: 'VFO Bandwidth' })}
                            value={vfo.bandwidth_khz ? `${vfo.bandwidth_khz} kHz` : '-'}
                        />
                        <InfoRow
                            label={t('telemetry_overview_tab.sample_rate', { defaultValue: 'Sample Rate' })}
                            value={signal.sample_rate_hz ? `${(signal.sample_rate_hz / 1000).toFixed(2)} kS/s` : '-'}
                        />
                    </InfoSection>

                    {/* Signal Power */}
                    {signal.signal_power_dbfs !== undefined && (
                        <InfoSection title={t('telemetry_overview_tab.signal_power', { defaultValue: 'Signal Power' })}>
                            <InfoRow
                                label={t('telemetry_overview_tab.signal_power', { defaultValue: 'Signal Power' })}
                                value={`${signal.signal_power_dbfs.toFixed(1)} dBFS`}
                            />
                            {signal.signal_power_avg_dbfs !== undefined && (
                                <InfoRow
                                    label={t('telemetry_overview_tab.avg_power', { defaultValue: 'Avg Power' })}
                                    value={`${signal.signal_power_avg_dbfs.toFixed(1)} dBFS`}
                                />
                            )}
                            {signal.signal_power_max_dbfs !== undefined && (
                                <InfoRow
                                    label={t('telemetry_overview_tab.peak_power', { defaultValue: 'Peak Power' })}
                                    value={`${signal.signal_power_max_dbfs.toFixed(1)} dBFS`}
                                />
                            )}
                            {signal.signal_power_min_dbfs !== undefined && (
                                <InfoRow
                                    label={t('telemetry_overview_tab.min_power', { defaultValue: 'Min Power' })}
                                    value={`${signal.signal_power_min_dbfs.toFixed(1)} dBFS`}
                                />
                            )}
                        </InfoSection>
                    )}
                </Box>
            </Box>

            {/* Validation Status - Full Width */}
            <InfoSection title={t('telemetry_overview_tab.validation', { defaultValue: 'Validation' })}>
                <Stack spacing={1}>
                    {/* Show validation info based on decoder type */}
                    {decoder.type === ModulationType.LORA ? (
                        <>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <CheckCircleIcon sx={{ color: theme.palette.success.main, fontSize: 20 }} />
                                <Typography variant="body2">
                                    {t('telemetry_overview_tab.lora_crc_validated_by_phy_layer', { defaultValue: 'LoRa CRC validated by PHY layer' })}
                                </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <CheckCircleIcon sx={{ color: theme.palette.success.main, fontSize: 20 }} />
                                <Typography variant="body2">
                                    {t('telemetry_overview_tab.spreading_factor_sf', { defaultValue: 'Spreading Factor: SF' })}{decoder.spreading_factor || metadata.demodulator_parameters?.spreading_factor}
                                </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <CheckCircleIcon sx={{ color: theme.palette.success.main, fontSize: 20 }} />
                                <Typography variant="body2">
                                    {t('telemetry_overview_tab.forward_error_correction_cr', { defaultValue: 'Forward Error Correction: CR' })} {decoder.coding_rate || metadata.decoder?.coding_rate || '4/5'}
                                </Typography>
                            </Box>
                            {telemetry.success && telemetry.parser === 'ax25' ? (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <CheckCircleIcon sx={{ color: theme.palette.success.main, fontSize: 20 }} />
                                    <Typography variant="body2">
                                        {t('telemetry_overview_tab.ax_25_frame_decoded_successfully', { defaultValue: 'AX.25 frame decoded successfully' })}
                                    </Typography>
                                </Box>
                            ) : null}
                        </>
                    ) : isGeoscan ? (
                        <>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <CheckCircleIcon sx={{ color: theme.palette.success.main, fontSize: 20 }} />
                                <Typography variant="body2">
                                    {t('telemetry_overview_tab.cc11xx_crc_validated_by_geoscan_deframer', { defaultValue: 'CC11xx CRC validated by GEOSCAN deframer' })}
                                </Typography>
                            </Box>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <CheckCircleIcon sx={{ color: theme.palette.success.main, fontSize: 20 }} />
                                <Typography variant="body2">
                                    {t('telemetry_overview_tab.pn9_descrambling_applied', { defaultValue: 'PN9 descrambling applied' })}
                                </Typography>
                            </Box>
                            {hasEncapsulatedAx25 && (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <CheckCircleIcon sx={{ color: theme.palette.success.main, fontSize: 20 }} />
                                    <Typography variant="body2">
                                        {t('telemetry_overview_tab.encapsulated_ax_25_frame_decoded_successfully', { defaultValue: 'Encapsulated AX.25 frame decoded successfully' })}
                                    </Typography>
                                </Box>
                            )}
                        </>
                    ) : (
                        <>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <CheckCircleIcon sx={{ color: theme.palette.success.main, fontSize: 20 }} />
                                <Typography variant="body2">
                                    {t('telemetry_overview_tab.crc_16_validated_by_hdlc_deframer', { defaultValue: 'CRC-16 validated by HDLC deframer' })}
                                </Typography>
                            </Box>
                            {telemetry.success && telemetry.parser === 'ax25' ? (
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <CheckCircleIcon sx={{ color: theme.palette.success.main, fontSize: 20 }} />
                                    <Typography variant="body2">
                                        {t('telemetry_overview_tab.ax_25_callsigns_decoded_correctly', { defaultValue: 'AX.25 callsigns decoded correctly' })}
                                    </Typography>
                                </Box>
                            ) : null}
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <CheckCircleIcon sx={{ color: theme.palette.success.main, fontSize: 20 }} />
                                <Typography variant="body2">
                                    {t('telemetry_overview_tab.packet_integrity_confirmed', { defaultValue: 'Packet integrity confirmed' })}
                                </Typography>
                            </Box>
                        </>
                    )}
                </Stack>

                <Box sx={{ mt: 2, p: 1.5, bgcolor: theme.palette.info.main + '30', borderRadius: 1, border: `1px solid ${theme.palette.info.main}60` }}>
                    <Typography variant="caption" sx={{ color: theme.palette.info.light, fontWeight: 500 }}>
                        {decoder.type === ModulationType.LORA ? (
                            <>ℹ️ {getDecoderDisplay(decoder.type)} {t('telemetry_overview_tab.packets_include_phy_layer_crc_validation_and_forward_err', { defaultValue: 'packets include PHY-layer CRC validation and Forward Error Correction (FEC). Invalid packets are automatically discarded by the' })} {getDecoderDisplay(decoder.type)} {t('telemetry_overview_tab.decoder', { defaultValue: 'decoder.' })}</>
                        ) : isGeoscan ? (
                            <>{t('telemetry_overview_tab.geoscan_frames_include_ti_cc11xx_crc_and_pn9_scrambling_', { defaultValue: 'ℹ️ GEOSCAN frames include TI CC11xx CRC and PN9 scrambling. The configured frame size typically includes a 2-byte CC11xx CRC that is removed after validation.' })}</>
                        ) : (
                            <>{t('telemetry_overview_tab.all_decoded_packets_have_passed_crc_16_ccitt_validation_', { defaultValue: 'ℹ️ All decoded packets have passed CRC-16-CCITT validation. Invalid packets are automatically discarded by the HDLC deframer.' })}</>
                        )}
                    </Typography>
                </Box>
            </InfoSection>

            {/* File Information - Full Width */}
            <InfoSection title={t('telemetry_overview_tab.file_information', { defaultValue: 'File Information' })}>
                <InfoRow
                    label={t('telemetry_overview_tab.binary_file', { defaultValue: 'Binary File' })}
                    value={metadata.file?.binary || file.filename}
                    mono
                />
                <InfoRow
                    label={t('telemetry_overview_tab.metadata_file', { defaultValue: 'Metadata File' })}
                    value={metadata.file?.binary?.replace('.bin', '.json')}
                    mono
                />
                <InfoRow
                    label={t('telemetry_overview_tab.file_size', { defaultValue: 'File Size' })}
                    value={file.size ? `${file.size} bytes` : '-'}
                />
            </InfoSection>
        </Box>
    );
}
