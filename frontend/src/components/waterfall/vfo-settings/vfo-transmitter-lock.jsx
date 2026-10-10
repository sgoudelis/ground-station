/**
 * VFO Transmitter Lock Components
 *
 * Components for locking VFO to doppler-corrected transmitters
 */

import React, { useState, useMemo } from 'react';
import { useStore } from 'react-redux';
import {
    Box,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    Alert,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogContentText,
    DialogActions,
    Button,
    ListSubheader
} from '@mui/material';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import TuneIcon from '@mui/icons-material/Tune';
import { useTranslation } from 'react-i18next';
import { getFrequencyBand } from '../../common/common.jsx';
import { selectRunningRigTransmitters } from '../../target/transmitter-selectors.js';

const sameIdentifier = (left, right) => {
    if (left == null || right == null) {
        return false;
    }
    return String(left) === String(right);
};

/**
 * Transmitter Lock Select Component
 */
export const TransmitterLockSelect = ({
    vfoIndex,
    vfoActive,
    lockedTransmitterId,
    lockedTransmitterTrackerId,
    transmitters,
    onVFOPropertyChange,
    centerFrequency,
    sampleRate,
    onCenterFrequencyChange
}) => {
    const { t } = useTranslation('waterfall');
    const store = useStore();
    const [retuneDialogOpen, setRetuneDialogOpen] = useState(false);
    const [pendingTransmitter, setPendingTransmitter] = useState(null);

    const handleChange = (e) => {
        const transmitterId = e.target.value === 'none' ? 'none' : e.target.value;

        if (transmitterId !== 'none') {
            // Locking to a transmitter - set frequency and lock, but don't change mode
            // Menu data is intentionally stable during tracking. Resolve the
            // current observed frequency when the user locks a VFO so doppler
            // correction and the retune decision always use live data.
            const transmitter = selectRunningRigTransmitters(store.getState()).find((tx) => (
                sameIdentifier(tx.id, transmitterId)
            )) || transmitters.find((tx) => sameIdentifier(tx.id, transmitterId));
            if (transmitter) {
                const txFrequency = transmitter.downlink_observed_freq;
                const parsedSampleRate = typeof sampleRate === 'number' ? sampleRate : Number(sampleRate);
                const safeSampleRate = Number.isFinite(parsedSampleRate) ? parsedSampleRate : 0;

                // Check if transmitter frequency is within current SDR bandwidth
                const bandwidthStart = centerFrequency - (safeSampleRate / 2);
                const bandwidthEnd = centerFrequency + (safeSampleRate / 2);
                const isOutsideBandwidth = txFrequency < bandwidthStart || txFrequency > bandwidthEnd;

                if (isOutsideBandwidth && onCenterFrequencyChange) {
                    // Show dialog asking user if they want to retune
                    setPendingTransmitter({ transmitter, transmitterId });
                    setRetuneDialogOpen(true);
                } else {
                    // Lock VFO to transmitter (frequency is within bandwidth)
                    onVFOPropertyChange(vfoIndex, {
                        lockedTransmitterId: transmitterId,
                        lockedTransmitterTrackerId: transmitter.trackerId || null,
                        frequency: txFrequency,
                        frequencyOffset: 0
                    });
                }
            }
        } else {
            // Unlocking - just clear the lock and reset offset
            onVFOPropertyChange(vfoIndex, {
                lockedTransmitterId: 'none',
                lockedTransmitterTrackerId: null,
                frequencyOffset: 0
            });
        }
    };

    const handleRetuneConfirm = async () => {
        if (pendingTransmitter) {
            const { transmitter, transmitterId } = pendingTransmitter;
            const txFrequency = transmitter.downlink_observed_freq;
            const parsedSampleRate = typeof sampleRate === 'number' ? sampleRate : Number(sampleRate);
            const safeSampleRate = Number.isFinite(parsedSampleRate) ? parsedSampleRate : 0;

            // Calculate offset to avoid DC spike at center
            // Offset by 25% of sample rate to move target signal away from center
            const offsetHz = safeSampleRate * 0.25;
            const newCenterFrequency = txFrequency + offsetHz;
            const response = await onCenterFrequencyChange(newCenterFrequency);

            // If takeover was canceled, keep the VFO within the live IQ band.
            if (response?.success !== false) {
                onVFOPropertyChange(vfoIndex, {
                    lockedTransmitterId: transmitterId,
                    lockedTransmitterTrackerId: transmitter.trackerId || null,
                    frequency: txFrequency,
                    frequencyOffset: 0
                });
            }
        }
        setRetuneDialogOpen(false);
        setPendingTransmitter(null);
    };

    const handleRetuneCancel = () => {
        // Don't lock, just close dialog
        setRetuneDialogOpen(false);
        setPendingTransmitter(null);
    };

    const currentValue = (() => {
        if (!lockedTransmitterId || lockedTransmitterId === 'none') return 'none';
        // Check if the current value exists in the transmitters list
        const exists = transmitters.some((tx) => {
            if (!sameIdentifier(tx.id, lockedTransmitterId)) {
                return false;
            }
            if (!lockedTransmitterTrackerId) {
                return true;
            }
            return sameIdentifier(tx.trackerId, lockedTransmitterTrackerId);
        });
        return exists ? lockedTransmitterId : 'none';
    })();

    const isLocked = lockedTransmitterId && lockedTransmitterId !== 'none';

    // Group transmitters by band
    const groupedTransmitters = useMemo(() => {
        const groups = {};
        transmitters.forEach(tx => {
            const band = getFrequencyBand(tx.downlink_low);
            if (!groups[band]) {
                groups[band] = [];
            }
            groups[band].push(tx);
        });

        // Sort bands by frequency (using first transmitter in each band)
        const bandOrder = ['VHF', 'UHF', 'L-band', 'S-band', 'C-band', 'X-band', 'Ku-band', 'K-band', 'Ka-band'];
        const sortedBands = Object.keys(groups).sort((a, b) => {
            const aIndex = bandOrder.indexOf(a);
            const bIndex = bandOrder.indexOf(b);
            if (aIndex !== -1 && bIndex !== -1) return aIndex - bIndex;
            if (aIndex !== -1) return -1;
            if (bIndex !== -1) return 1;
            return a.localeCompare(b);
        });

        return sortedBands.map(band => ({ band, transmitters: groups[band] }));
    }, [transmitters]);

    return (
        <>
            <Box sx={{ mt: 2 }}>
                <FormControl fullWidth size="small" disabled={!vfoActive} variant="outlined">
                    <InputLabel
                        id={`vfo-${vfoIndex}-lock-transmitter-label`}
                        sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
                    >
                        {isLocked ? <LockIcon fontSize="small" /> : <LockOpenIcon fontSize="small" />}
                        {t('vfo.lock_to_transmitter', 'Lock to Transmitter')}
                    </InputLabel>
                    <Select
                        size="small"
                        labelId={`vfo-${vfoIndex}-lock-transmitter-label`}
                        value={currentValue}
                        label={`\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0${t('vfo.lock_to_transmitter', 'Lock to Transmitter')}`}
                        onChange={handleChange}
                        sx={{ fontSize: '0.875rem' }}
                    >
                        <MenuItem value="none" sx={{ fontSize: '0.875rem' }}>
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                <LockOpenIcon fontSize="small" />
                                {t('vfo.none', 'None')}
                            </Box>
                        </MenuItem>
                        {groupedTransmitters.map(({ band, transmitters: groupTx }) => [
                            <ListSubheader key={`header-${band}`} sx={{ fontSize: '0.75rem', fontWeight: 'bold', lineHeight: '32px' }}>
                                {band}
                            </ListSubheader>,
                            ...groupTx.map((tx) => (
                                <MenuItem key={tx.uiId || tx.id} value={tx.id} sx={{ fontSize: '0.875rem', pl: 3 }}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                                        <Box
                                            sx={{
                                                width: 8,
                                                height: 8,
                                                borderRadius: '50%',
                                                backgroundColor: tx.alive ? 'success.main' : 'error.main',
                                                boxShadow: (theme) => tx.alive
                                                    ? `0 0 6px ${theme.palette.success.main}99`
                                                    : `0 0 6px ${theme.palette.error.main}99`,
                                                flexShrink: 0,
                                            }}
                                        />
                                        <Box sx={{ flex: 1 }}>
                                            <Box sx={{ fontWeight: 600 }}>{tx.description}</Box>
                                            <Box sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>
                                                {[
                                                    tx.trackerLabel || null,
                                                    `Source: ${tx.source || 'Unknown'}`,
                                                    `${(tx.downlink_low / 1e6).toFixed(6)} MHz (${tx.mode})`,
                                                ].filter(Boolean).join(' • ')}
                                            </Box>
                                        </Box>
                                    </Box>
                                </MenuItem>
                            ))
                        ])}
                    </Select>
                </FormControl>
            </Box>

            {/* Retune Confirmation Dialog */}
            <Dialog
                open={retuneDialogOpen}
                onClose={handleRetuneCancel}
                maxWidth="sm"
                fullWidth
            >
                <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <TuneIcon />
                    {t('vfo_transmitter_lock.retune_sdr', { defaultValue: 'Retune SDR?' })}
                </DialogTitle>
                <DialogContent>
                    <DialogContentText>
                        {t('vfo_transmitter_lock.the_transmitter_frequency', { defaultValue: 'The transmitter frequency' })}{' '}
                        <strong>
                            {pendingTransmitter?.transmitter?.downlink_observed_freq
                                ? `${(pendingTransmitter.transmitter.downlink_observed_freq / 1e6).toFixed(6)} MHz`
                                : ''}
                        </strong>
                        {' '}{t('vfo_transmitter_lock.is_outside_the_current_sdr_bandwidth', { defaultValue: 'is outside the current SDR bandwidth.' })}
                        <br /><br />
                        {t('vfo_transmitter_lock.would_you_like_to_retune_the_sdr_center_frequency_to_rec', { defaultValue: 'Would you like to retune the SDR center frequency to receive this transmitter?' })}
                        <br /><br />
                        <em style={{ fontSize: '0.875rem', color: 'gray' }}>
                            {t('vfo_transmitter_lock.note_the_sdr_will_be_offset_by_25_of_the_sample_rate_to_', { defaultValue: 'Note: The SDR will be offset by 25% of the sample rate to avoid DC spike artifacts.' })}
                        </em>
                    </DialogContentText>
                </DialogContent>
                <DialogActions>
                    <Button onClick={handleRetuneCancel} color="inherit">
                        {t('vfo_transmitter_lock.cancel', { defaultValue: 'Cancel' })}
                    </Button>
                    <Button onClick={handleRetuneConfirm} variant="contained" color="primary" autoFocus>
                        {t('vfo_transmitter_lock.retune_sdr_2', { defaultValue: 'Retune SDR' })}
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
};

/**
 * Locked Transmitter Alert Component
 */
export const LockedTransmitterAlert = ({ lockedTransmitterId }) => {
    const { t } = useTranslation('waterfall');

    if (!lockedTransmitterId || lockedTransmitterId === 'none') return null;

    return (
        <Alert
            severity="info"
            icon={<LockIcon fontSize="small" />}
            sx={{
                mt: 1,
                mb: 1,
                py: 0.5,
                fontSize: '0.875rem',
                '& .MuiAlert-icon': {
                    fontSize: '1rem'
                }
            }}
        >
            {t('vfo.locked_to_transmitter_info', 'Tracking doppler-corrected frequency')}
        </Alert>
    );
};
