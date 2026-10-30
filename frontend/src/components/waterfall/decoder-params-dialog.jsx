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
    DialogActions,
    Button,
    IconButton,
    Typography,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Switch,
    FormControlLabel,
    Alert,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import { useSelector } from 'react-redux';
import { getDecoderParameters } from './vfo-marker/vfo-config.js';
import { areDecoderParametersValid } from './decoder-parameters.js';
import { DecoderNumberField } from './decoder-number-field.jsx';
import { DecoderConfigSuggestion } from '../scheduler/decoder-config-suggestion.jsx';
import { selectRunningRigTransmitters } from '../target/transmitter-selectors.js';
import { useTranslation } from 'react-i18next';
import {
    formatGnssFrequency,
    formatGnssRate,
    getGnssTuningAdvice,
    getSupportedGnssRate,
} from './gnss-tuning.js';

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

// A few decoder values are arrays (for example LoRa sync words).
const sameParameterValue = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const DecoderParamsDialog = ({
    open,
    onClose,
    vfoIndex,
    vfoMarkers,
    vfoActive,
    onVFOPropertyChange,
    centerFrequency,
    sampleRate,
    sampleRateValues,
    onCenterFrequencyChange,
    onSampleRateChange,
}) => {
    const { t } = useTranslation('waterfall');
    // Get satellite and transmitter data from Redux
    const activeSatelliteDetails = useSelector(state => state.targetSatTrack.satelliteData?.details || null);
    const trackerViews = useSelector(state => state.targetSatTrack?.trackerViews || {});
    const transmitters = useSelector(selectRunningRigTransmitters);
    const liveVfoFrequency = useSelector(state => state.vfo?.vfoMarkers?.[vfoIndex]?.frequency);
    const selectedSDRId = useSelector(state => state.waterfall?.selectedSDRId);
    const vfo = vfoMarkers?.[vfoIndex];
    // The parent mounts this dialog only while open; keep edits out of Redux until Apply.
    const [draft, setDraft] = React.useState(() => ({
        parametersEnabled: vfo?.parametersEnabled ?? false,
        parameters: { ...(vfo?.parameters || {}) },
    }));
    const [initialDraft] = React.useState(draft);
    const [hardwareBusy, setHardwareBusy] = React.useState(false);
    const [hardwareError, setHardwareError] = React.useState('');
    const changedParameters = Object.entries(draft.parameters).filter(
        ([key, value]) => !sameParameterValue(value, initialDraft.parameters[key])
    );
    const hasChanges = draft.parametersEnabled !== initialDraft.parametersEnabled || changedParameters.length > 0;

    if (!vfoIndex || !vfo) {
        return null;
    }

    const decoder = vfo.decoder;

    if (!decoder || decoder === 'none') {
        return null;
    }

    // Pass the component translator so parameter labels/tooltips stay localized.
    const decoderParams = getDecoderParameters(decoder, t);
    const parametersEnabled = draft.parametersEnabled; // Default to disabled
    const parametersValid = !parametersEnabled || areDecoderParametersValid(decoder, draft.parameters);
    const gnssAdvice = decoder === 'gnss' ? getGnssTuningAdvice({
        parameters: draft.parameters,
        parametersEnabled,
        vfoFrequency: liveVfoFrequency ?? vfo.frequency,
        sdrCenterFrequency: centerFrequency,
        sdrSampleRate: sampleRate,
    }) : null;
    const suggestedRate = gnssAdvice && (gnssAdvice.rateBelowRecommendation || !gnssAdvice.hasSampleRate)
        ? getSupportedGnssRate(gnssAdvice.recommendedRateHz, sampleRateValues)
        : null;
    const canConfigureReceiver = Boolean(selectedSDRId && selectedSDRId !== 'none' && selectedSDRId !== 'sigmf-playback');

    // Get locked transmitter if available
    const lockedTransmitterId = vfo.lockedTransmitterId;
    const lockedTransmitterTrackerId = normalizeTrackerId(vfo.lockedTransmitterTrackerId);
    const isLocked = lockedTransmitterId && lockedTransmitterId !== 'none';
    const canTuneReceiver = canConfigureReceiver && !isLocked;
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
        setDraft((current) => {
            const parameters = { ...current.parameters };

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
                for (const key of ['sf', 'bw', 'cr', 'sync_word', 'preamble_len', 'ldro_mode', 'implicit_header', 'payload_length', 'has_crc', 'invert_iq']) {
                    if (config[key] !== null && config[key] !== undefined) {
                        parameters[`lora_${key}`] = config[key];
                    }
                }
            }

            // Suggested values must be active for the decoder to consume them.
            return { parameters, parametersEnabled: true };
        });
    };

    const commitDraft = (extraUpdates = {}) => {
        if (!parametersValid) return;
        const updates = { ...extraUpdates };
        if (draft.parametersEnabled !== initialDraft.parametersEnabled) {
            updates.parametersEnabled = draft.parametersEnabled;
        }
        if (changedParameters.length > 0) {
            // Preserve unrelated parameter changes that arrived while the dialog was open.
            updates.parameters = {
                ...(vfo.parameters || {}),
                ...Object.fromEntries(changedParameters),
            };
        }
        if (Object.keys(updates).length > 0) {
            onVFOPropertyChange(vfoIndex, updates);
        }
        onClose();
    };

    const handleApplyAndTune = async () => {
        if (!gnssAdvice?.band || !canTuneReceiver || hardwareBusy) return;
        setHardwareError('');
        setHardwareBusy(true);
        try {
            const target = gnssAdvice.band.centerHz;
            // Change the shared SDR center first. If it fails or takeover is
            // declined, leave the VFO and decoder draft untouched.
            if (Math.abs(Number(centerFrequency) - target) > 10_000) {
                const response = await onCenterFrequencyChange(target);
                if (!response?.success) {
                    setHardwareError(response?.error || 'Could not tune the SDR receiver.');
                    return;
                }
            }
            commitDraft({ frequency: target });
        } catch (error) {
            setHardwareError(error?.message || 'Could not tune the SDR receiver.');
        } finally {
            setHardwareBusy(false);
        }
    };

    const handleSetSuggestedRate = async () => {
        if (!suggestedRate || !canConfigureReceiver || hardwareBusy) return;
        setHardwareError('');
        setHardwareBusy(true);
        try {
            const response = await onSampleRateChange(suggestedRate);
            if (!response?.success) {
                setHardwareError(response?.error || 'Could not change the SDR capture rate.');
            }
        } catch (error) {
            setHardwareError(error?.message || 'Could not change the SDR capture rate.');
        } finally {
            setHardwareBusy(false);
        }
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
                    <IconButton onClick={onClose} size="small" aria-label={t('common:close', { defaultValue: 'Close' })}>
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
                        applyLabel={t('decoder_params_dialog.use_suggestion', { defaultValue: 'Use suggestion' })}
                    />

                    {/* Master Enable/Disable Checkbox */}
                    <Box sx={{ mb: 3, pb: 2, borderBottom: '1px solid', borderColor: 'divider', mt: isLocked && lockedTransmitter ? 0 : 0 }}>
                        <FormControlLabel
                            control={
                                <Switch
                                    checked={parametersEnabled}
                                    disabled={!vfoActive[vfoIndex]}
                                    onChange={(e) => setDraft((current) => ({ ...current, parametersEnabled: e.target.checked }))}
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

                    {gnssAdvice && (
                        <Box sx={{ mb: 3, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1 }}>
                            <Typography variant="subtitle2" sx={{ mb: 1 }}>GNSS receiver setup</Typography>
                            <Typography variant="body2">
                                Selected signals: {gnssAdvice.selectedSignals.join(', ') || 'none'}
                            </Typography>
                            {gnssAdvice.band && (
                                <Typography variant="body2">Target RF band: {gnssAdvice.band.label}</Typography>
                            )}
                            <Typography variant="body2">
                                Current VFO: {Number(liveVfoFrequency ?? vfo.frequency) > 0
                                    ? formatGnssFrequency(Number(liveVfoFrequency ?? vfo.frequency)) : 'unknown'}
                                {' · '}SDR center: {Number(centerFrequency) > 0
                                    ? formatGnssFrequency(Number(centerFrequency)) : 'unknown'}
                            </Typography>
                            <Typography variant="body2">
                                SDR capture rate: {Number(sampleRate) > 0 ? formatGnssRate(Number(sampleRate)) : 'unknown'}
                            </Typography>
                            <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>
                                GNSS Processing Rate below is a decoder target; it cannot restore bandwidth missing from the SDR capture.
                            </Typography>
                            {gnssAdvice.bandCount === 0 && (
                                <Alert severity="error" sx={{ mt: 1 }}>Select at least one GNSS constellation.</Alert>
                            )}
                            {gnssAdvice.bandCount > 1 && (
                                <Alert severity="warning" sx={{ mt: 1 }}>
                                    These signals use different RF bands. Select signals from one band to tune and decode them together.
                                </Alert>
                            )}
                            {gnssAdvice.band?.centerHz === 1_602_000_000 && (
                                <Alert severity="info" sx={{ mt: 1 }}>
                                    GLONASS satellites use channels around 1602 MHz. A narrow capture contains only some channels.
                                </Alert>
                            )}
                            {gnssAdvice.needsTune && (
                                <Alert severity="warning" sx={{ mt: 1 }}>
                                    Center the SDR and VFO on {gnssAdvice.band.label} to avoid clipping the GNSS signal.
                                </Alert>
                            )}
                            {gnssAdvice.recommendedRateHz && (
                                <Typography variant="body2" sx={{ mt: 1 }}>
                                    Recommended SDR capture rate: at least {formatGnssRate(gnssAdvice.recommendedRateHz)}.
                                </Typography>
                            )}
                            {!canConfigureReceiver && (
                                <Alert severity="info" sx={{ mt: 1 }}>
                                    Select a live SDR to change its tuning or capture rate here.
                                </Alert>
                            )}
                            {isLocked && (
                                <Alert severity="info" sx={{ mt: 1 }}>
                                    Unlock transmitter tracking before tuning this VFO for GNSS.
                                </Alert>
                            )}
                            {(gnssAdvice.rateBelowRecommendation || !gnssAdvice.hasSampleRate) && canConfigureReceiver && (
                                suggestedRate ? (
                                    <Button size="small" sx={{ mt: 1 }} disabled={hardwareBusy} onClick={handleSetSuggestedRate}>
                                        Set SDR capture to {formatGnssRate(suggestedRate)}
                                    </Button>
                                ) : (
                                    <Alert severity="info" sx={{ mt: 1 }}>
                                        No suitable higher capture rate is available from the selected SDR. You can still try this rate.
                                    </Alert>
                                )
                            )}
                            {hardwareError && <Alert severity="error" sx={{ mt: 1 }}>{hardwareError}</Alert>}
                        </Box>
                    )}

                    {Object.entries(decoderParams).map(([paramKey, paramDef]) => {
                        const currentValue = draft.parameters[paramKey] ?? paramDef.default;

                        // Handle conditional visibility
                        if (paramDef.visibleWhen && !paramDef.visibleWhen(draft.parameters)) {
                            return null;
                        }

                        return (
                            <Box key={paramKey} sx={{ mb: 2.5 }}>
                                {paramDef.type === 'number' && (
                                    <DecoderNumberField
                                        definition={paramDef}
                                        value={currentValue}
                                        disabled={!vfoActive[vfoIndex] || !parametersEnabled}
                                        onChange={(value) => setDraft((current) => ({
                                            ...current,
                                            parameters: { ...current.parameters, [paramKey]: value },
                                        }))}
                                    />
                                )}
                                {paramDef.type === 'select' && (
                                    <FormControl fullWidth size="small" variant="outlined">
                                        <InputLabel id={`vfo-${vfoIndex}-${paramKey}-label`}>{paramDef.label}</InputLabel>
                                        <Select
                                            labelId={`vfo-${vfoIndex}-${paramKey}-label`}
                                            value={JSON.stringify(currentValue)}
                                            label={paramDef.label}
                                            size="small"
                                            disabled={!vfoActive[vfoIndex] || !parametersEnabled}
                                            onChange={(e) => {
                                                // Parse the JSON string back to the original value
                                                const selectedValue = JSON.parse(e.target.value);
                                                setDraft((current) => ({
                                                    ...current,
                                                    parameters: { ...current.parameters, [paramKey]: selectedValue },
                                                }));
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
                                                        setDraft((current) => ({
                                                            ...current,
                                                            parameters: { ...current.parameters, [paramKey]: e.target.checked },
                                                        }));
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
            <DialogActions>
                <Button onClick={onClose}>{t('common:cancel', { defaultValue: 'Cancel' })}</Button>
                {gnssAdvice?.band && canTuneReceiver && gnssAdvice.needsTune && (
                    <Button variant="outlined" onClick={handleApplyAndTune} disabled={hardwareBusy || !parametersValid}>
                        Apply and tune receiver
                    </Button>
                )}
                <Button variant="contained" onClick={() => commitDraft()} disabled={!hasChanges || !parametersValid || hardwareBusy || gnssAdvice?.bandCount === 0}>
                    {t('common:apply', { defaultValue: 'Apply' })}
                </Button>
            </DialogActions>
        </Dialog>
    );
};

export default DecoderParamsDialog;
