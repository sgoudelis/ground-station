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
    useTheme,
} from '@mui/material';
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
                {value ?? '-'}
            </Typography>
        </Box>
    );
}

export default function OverviewTab({ metadata, file, telemetry, packet, ax25 }) {
    const { t } = useTranslation('filebrowser');
    const { timezone, locale } = useUserTimeSettings();

    // Format timestamp
    const formatTimestamp = (ts) => {
        if (ts == null) return '-';
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
    const protocol = telemetry.protocol || metadata.parse_context?.protocol || payloadProtocol || 'unknown';
    const isGeoscan = framing === 'geoscan' && protocol === 'proprietary';
    const isLora = protocol === 'lora' || decoder.type === ModulationType.LORA;
    const hasEncapsulatedAx25 = Boolean(frame.source && frame.destination);
    const headers = telemetry.headers?.csp || telemetry.headers?.ccsds_primary || {};



    return (
        <Box>
            {/* Two Column Layout for remaining sections */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 3 }}>
                {/* Left Column */}
                <Box>
                    {/* Link-layer / Frame Information */}
                    {isLora ? (
                        <InfoSection title={t('telemetry_overview_tab.lora_frame_information', { defaultValue: 'LoRa Frame Information' })}>
                            <InfoRow label={t('telemetry_overview_tab.protocol', { defaultValue: 'Protocol' })} value="LoRa" />
                            <InfoRow label={t('telemetry_overview_tab.parser', { defaultValue: 'Parser' })} value={telemetryParser || 'lora'} />
                            <InfoRow label={t('telemetry_overview_tab.delivered_payload_length', { defaultValue: 'Delivered Payload Length' })}
                                value={`${telemetry.raw?.payload_length ?? packet.length_bytes ?? '-'} bytes`} />
                        </InfoSection>
                    ) : isGeoscan ? (
                        <InfoSection title={t('telemetry_overview_tab.geoscan_frame_information', { defaultValue: 'GEOSCAN Frame Information' })}>
                            <InfoRow label={t('telemetry_overview_tab.framing', { defaultValue: 'Framing' })} value={framing || 'geoscan'} />
                            <InfoRow label={t('telemetry_overview_tab.protocol', { defaultValue: 'Protocol' })} value={payloadProtocol || 'proprietary'} />
                            <InfoRow
                                label={t('telemetry_overview_tab.configured_frame_size', { defaultValue: 'Configured Frame Size' })}
                                value={`${geoscan.frame_size || framingParams.frame_size || 66} bytes`}
                            />
                            <InfoRow
                                label={t('telemetry_overview_tab.delivered_payload_length', { defaultValue: 'Delivered Payload Length' })}
                                value={`${telemetry.raw?.payload_length ?? packet.length_bytes ?? '-'} bytes`}
                            />
                            <InfoRow
                                label={t('telemetry_overview_tab.pn9_descrambler', { defaultValue: 'PN9 Descrambler' })}
                                value={geoscan.pn9_descrambled == null ? 'Unknown' : geoscan.pn9_descrambled ? 'Yes' : 'No'}
                            />
                            <InfoRow
                                label={t('telemetry_overview_tab.cc11xx_crc', { defaultValue: 'CC11xx CRC' })}
                                value={(geoscan.cc11xx_crc || 'Unknown').toUpperCase()}
                            />
                            <InfoRow
                                label={t('telemetry_overview_tab.syncword_threshold', { defaultValue: 'Syncword Threshold' })}
                                value={`${geoscan.syncword_threshold ?? framingParams.syncword_threshold ?? 4}`}
                            />
                            <InfoRow label={t('telemetry_overview_tab.parser', { defaultValue: 'Parser' })} value={telemetryParser || 'proprietary'} />
                        </InfoSection>
                    ) : protocol !== 'ax25' ? (
                        <InfoSection title={`${protocol === 'unknown' ? t('telemetry_overview_tab.unknown_protocol', {defaultValue: 'Unknown protocol'}) : protocol.toUpperCase()} ${t('telemetry_overview_tab.header_information', {defaultValue: 'Header Information'})}`}>
                            <InfoRow label={t('telemetry_overview_tab.parser', {defaultValue: 'Parser'})} value={telemetry.parser_id || telemetryParser} />
                            {Object.entries(headers).map(([key, value]) => <InfoRow key={key} label={key.replaceAll('_', ' ')} value={value} />)}
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
                            value={`${packet.length_bytes ?? packet.length ?? '-'} bytes`}
                        />
                        <InfoRow
                            label={t('telemetry_overview_tab.payload_length', { defaultValue: 'Payload Length' })}
                            value={`${telemetry.raw?.payload_length ?? '-'} bytes`}
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

            <InfoSection title={t('telemetry_overview_tab.validation', {defaultValue: 'Validation'})}>
                <InfoRow label={t('telemetry_overview_tab.envelope_status', {defaultValue: 'Packet structure'})}
                    value={t(`telemetry_overview_tab.statuses.${telemetry.envelope_status}`, {defaultValue: telemetry.envelope_status || 'Unknown'})} />
                <InfoRow label={t('telemetry_overview_tab.payload_status', {defaultValue: 'Packet contents'})}
                    value={t(`telemetry_overview_tab.statuses.${telemetry.payload_status}`, {defaultValue: telemetry.payload_status || 'Unknown'})} />
                {isLora && <InfoRow label="CRC" value={decoder.crc_valid === true
                    ? t('telemetry_overview_tab.crc_valid', {defaultValue: 'Valid'})
                    : t('telemetry_overview_tab.crc_unchecked', {defaultValue: 'Unchecked or unavailable'})} />}
                {isGeoscan && <InfoRow label="CC11xx CRC" value={geoscan.cc11xx_crc || t('telemetry_overview_tab.unknown', {defaultValue: 'Unknown'})} />}
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
