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
import {
    Box,
    Dialog,
    DialogTitle,
    DialogContent,
    IconButton,
    Typography,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Switch,
    FormControlLabel,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useSelector } from 'react-redux';
import { getDecoderParameters } from './vfo-marker/vfo-config.js';
import { DecoderConfigSuggestion } from '../scheduler/decoder-config-suggestion.jsx';
import { selectRunningRigTransmitters } from '../target/transmitter-selectors.js';
import { useTranslation } from 'react-i18next';

const normalizeTrackerId = (value) => {
    if (typeof value !== 'string') {
        return '';
    }
    const normalized = value.trim();
    return normalized && normalized.toLowerCase() !== 'none' ? normalized : '';
};

const sameIdentifier = (left, right) => {
    if (left == null || right == null) {
        return false;
    }
    return String(left) === String(right);
};

const DecoderParamsDialog = ({
    open,
    onClose,
    vfoIndex,
    vfoMarkers,
    vfoActive,
    onVFOPropertyChange,
}) => {
    const { t } = useTranslation('waterfall');
    // Get satellite and transmitter data from Redux
    const activeSatelliteDetails = useSelector(state => state.targetSatTrack.satelliteData?.details || null);
    const trackerViews = useSelector(state => state.targetSatTrack?.trackerViews || {});
    const transmitters = useSelector(selectRunningRigTransmitters);

    if (!vfoIndex || !vfoMarkers[vfoIndex]) {
        return null;
    }

    const vfo = vfoMarkers[vfoIndex];
    const decoder = vfo.decoder;

    if (!decoder || decoder === 'none') {
        return null;
    }

    // Pass the component translator so parameter labels/tooltips stay localized.
    const decoderParams = getDecoderParameters(decoder, t);
    const parametersEnabled = vfo.parametersEnabled ?? false; // Default to disabled

    // Get locked transmitter if available
    const lockedTransmitterId = vfo.lockedTransmitterId;
    const lockedTransmitterTrackerId = normalizeTrackerId(vfo.lockedTransmitterTrackerId);
    const isLocked = lockedTransmitterId && lockedTransmitterId !== 'none';
    const lockedTransmitter = isLocked
        ? transmitters.find((tx) => {
            if (!sameIdentifier(tx.id, lockedTransmitterId)) {
                return false;
            }
            if (!lockedTransmitterTrackerId) {
                return true;
            }
            return sameIdentifier(tx.trackerId, lockedTransmitterTrackerId);
        })
        : null;
    const lockTrackerSatelliteDetails = lockedTransmitterTrackerId
        ? trackerViews?.[lockedTransmitterTrackerId]?.satelliteData?.details
        : null;
    const suggestionSatellite = lockTrackerSatelliteDetails || activeSatelliteDetails;

    const handleApplySuggestedConfig = (config) => {
        const parameters = { ...vfo.parameters };

        // Keep this mapping aligned with scheduler tasks so a suggested
        // configuration produces the same decoder settings in either workflow.
        if (['gmsk', 'gfsk', 'fsk'].includes(decoder)) {
            if (config.baudrate) parameters[`${decoder}_baudrate`] = config.baudrate;
            if (config.framing) parameters[`${decoder}_framing`] = config.framing;
            if (config.deviation !== null && config.deviation !== undefined) {
                parameters[`${decoder}_deviation`] = config.deviation;
            }
            if (config.framing === 'geoscan' && config.framing_params?.frame_size) {
                parameters[`${decoder}_geoscan_frame_size`] = config.framing_params.frame_size;
            }
        } else if (decoder === 'bpsk') {
            if (config.baudrate) parameters.bpsk_baudrate = config.baudrate;
            if (config.framing) parameters.bpsk_framing = config.framing;
            if (config.differential !== null && config.differential !== undefined) {
                parameters.bpsk_differential = config.differential;
            }
            if (config.framing === 'geoscan' && config.framing_params?.frame_size) {
                parameters.bpsk_geoscan_frame_size = config.framing_params.frame_size;
            }
        } else if (decoder === 'geoscanimage') {
            if (config.baudrate) parameters.geoscanimage_baudrate = config.baudrate;
            if (config.deviation !== null && config.deviation !== undefined) parameters.geoscanimage_deviation = config.deviation;
            if (config.framing_params?.frame_size) parameters.geoscanimage_frame_size = config.framing_params.frame_size;
            if (config.framing_params?.syncword_threshold !== undefined) parameters.geoscanimage_syncword_threshold = config.framing_params.syncword_threshold;
            if (config.framing_params?.satellite_id !== undefined) parameters.geoscanimage_satellite_id = config.framing_params.satellite_id;
        } else if (decoder === 'aprs') {
            if (config.baudrate) parameters.aprs_baudrate = config.baudrate;
            if (config.deviation !== null && config.deviation !== undefined) parameters.aprs_deviation = config.deviation;
            if (config.af_carrier) parameters.aprs_af_carrier = config.af_carrier;
        } else if (decoder === 'lora') {
            if (config.sf) parameters.lora_sf = config.sf;
            if (config.bw) parameters.lora_bw = config.bw;
            if (config.cr) parameters.lora_cr = config.cr;
        }

        // Suggested values must be active for the decoder to consume them.
        onVFOPropertyChange(vfoIndex, { parameters, parametersEnabled: true });
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            maxWidth="sm"
            fullWidth
            PaperProps={{
                sx: {
                    backgroundColor: 'background.elevated',
                }
            }}
        >
            <DialogTitle sx={{ backgroundColor: 'background.elevated', color: 'text.primary' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Typography variant="h6">
                        VFO {vfoIndex} - {decoder.toUpperCase()} {t('decoder_params_dialog.parameters', { defaultValue: 'Parameters' })}
                    </Typography>
                    <IconButton onClick={onClose} size="small">
                        <CloseIcon />
                    </IconButton>
                </Box>
            </DialogTitle>
            <DialogContent dividers sx={{ p: 3 }}>
                <Box>
                    {/* Decoder Configuration Suggestion */}
                    <DecoderConfigSuggestion
                        decoderType={decoder}
                        satellite={suggestionSatellite?.norad_id ? suggestionSatellite : null}
                        transmitter={lockedTransmitter}
                        show={isLocked && !!lockedTransmitter}
                        onApply={handleApplySuggestedConfig}
                    />

                    {/* Master Enable/Disable Checkbox */}
                    <Box sx={{ mb: 3, pb: 2, borderBottom: '1px solid', borderColor: 'divider', mt: isLocked && lockedTransmitter ? 0 : 0 }}>
                        <FormControlLabel
                            control={
                                <Switch
                                    checked={parametersEnabled}
                                    disabled={!vfoActive[vfoIndex]}
                                    onChange={(e) => {
                                        onVFOPropertyChange(vfoIndex, {
                                            parametersEnabled: e.target.checked
                                        });
                                    }}
                                />
                            }
                            label={
                                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                    {t('decoder_params_dialog.enable_parameter_overrides', { defaultValue: 'Enable Parameter Overrides' })}
                                </Typography>
                            }
                        />
                        <Typography variant="caption" sx={{ display: 'block', color: 'text.disabled', fontSize: '0.75rem', mt: 0.5 }}>
                            {parametersEnabled
                                ? 'Parameter overrides are active. The decoder will use your configured values.'
                                : 'Parameter overrides are disabled. The decoder will use default values.'}
                        </Typography>
                    </Box>

                    {Object.entries(decoderParams).map(([paramKey, paramDef]) => {
                        const currentValue = vfo.parameters?.[paramKey] ?? paramDef.default;

                        // Handle conditional visibility
                        if (paramDef.visibleWhen && !paramDef.visibleWhen(vfo.parameters || {})) {
                            return null;
                        }

                        return (
                            <Box key={paramKey} sx={{ mb: 2.5 }}>
                                {paramDef.type === 'select' && (
                                    <FormControl fullWidth size="small" variant="outlined">
                                        <InputLabel>{paramDef.label}</InputLabel>
                                        <Select
                                            value={JSON.stringify(currentValue)}
                                            label={paramDef.label}
                                            size="small"
                                            disabled={!vfoActive[vfoIndex] || !parametersEnabled}
                                            onChange={(e) => {
                                                // Parse the JSON string back to the original value
                                                const selectedValue = JSON.parse(e.target.value);
                                                onVFOPropertyChange(vfoIndex, {
                                                    parameters: {
                                                        ...vfo.parameters,
                                                        [paramKey]: selectedValue
                                                    }
                                                });
                                            }}
                                            sx={{ fontSize: '0.875rem' }}
                                        >
                                            {paramDef.options.map((opt, idx) => (
                                                <MenuItem
                                                    key={JSON.stringify(opt.value)}
                                                    value={JSON.stringify(opt.value)}
                                                    sx={{ fontSize: '0.875rem' }}
                                                >
                                                    {opt.label}
                                                </MenuItem>
                                            ))}
                                        </Select>
                                        {paramDef.description && (
                                            <Typography variant="caption" sx={{ mt: 0.5, display: 'block', color: 'text.disabled', fontSize: '0.75rem' }}>
                                                {paramDef.description}
                                            </Typography>
                                        )}
                                    </FormControl>
                                )}

                                {paramDef.type === 'switch' && (
                                    <Box>
                                        <FormControlLabel
                                            control={
                                                <Switch
                                                    checked={currentValue}
                                                    disabled={!vfoActive[vfoIndex] || !parametersEnabled}
                                                    onChange={(e) => {
                                                        onVFOPropertyChange(vfoIndex, {
                                                            parameters: {
                                                                ...vfo.parameters,
                                                                [paramKey]: e.target.checked
                                                            }
                                                        });
                                                    }}
                                                />
                                            }
                                            label={
                                                <Typography variant="body2" sx={{ fontWeight: 500 }}>
                                                    {paramDef.label}
                                                </Typography>
                                            }
                                            sx={{ mt: 0, ml: 0 }}
                                        />
                                        {paramDef.description && (
                                            <Typography variant="caption" sx={{ ml: 0, display: 'block', color: 'text.disabled', fontSize: '0.75rem' }}>
                                                {paramDef.description}
                                            </Typography>
                                        )}
                                    </Box>
                                )}
                            </Box>
                        );
                    })}
                </Box>
            </DialogContent>
        </Dialog>
    );
};

export default DecoderParamsDialog;
