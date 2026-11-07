import React from 'react';
import {
    Accordion,
    AccordionSummary,
    AccordionDetails,
    LoadingOverlay,
} from './settings-elements.jsx';
import Typography from '@mui/material/Typography';
import {
    Box,
    Button,
    Chip,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    FormControl,
    FormHelperText,
    IconButton,
    InputLabel,
    ListSubheader,
    MenuItem,
    Select,
    Tooltip,
} from "@mui/material";
import RefreshIcon from '@mui/icons-material/Refresh';
import UsbIcon from '@mui/icons-material/Usb';
import CloudQueueIcon from '@mui/icons-material/CloudQueue';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import MemoryIcon from '@mui/icons-material/Memory';
import RadioButtonUncheckedIcon from '@mui/icons-material/RadioButtonUnchecked';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import AutorenewIcon from '@mui/icons-material/Autorenew';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { useTranslation } from 'react-i18next';
import BackgroundStreamControl from './background-stream-control.jsx';
import SdrParameterFields from '../common/sdr-parameter-fields.jsx';
import ReceiverStatus from './receiver-status.jsx';

// Factory (rather than a module-level constant) so the labels are translated with the
// translator of the rendering component and follow runtime language changes.
const getSdrTypeGroups = (t) => [
    {
        key: 'rtlsdr',
        label: 'RTL-SDR',
        matches: (type) => type.startsWith('rtlsdr'),
    },
    {
        key: 'airspy',
        label: 'Airspy',
        matches: (type) => type === 'airspy' || type === 'airspyhf',
    },
    {
        key: 'uhd',
        label: 'UHD',
        matches: (type) => type === 'uhd',
    },
    {
        key: 'soapysdrlocal',
        label: t('settings_sdr.soapysdr_local', { defaultValue: 'SoapySDR (Local)' }),
        matches: (type) => type === 'soapysdrlocal',
    },
    {
        key: 'soapysdrremote',
        label: t('settings_sdr.soapysdr_remote', { defaultValue: 'SoapySDR (Remote)' }),
        matches: (type) => type === 'soapysdrremote',
    },
    {
        key: 'sigmfplayback',
        label: t('settings_sdr.sigmf_playback', { defaultValue: 'SigMF Playback' }),
        matches: (type) => type === 'sigmfplayback',
    },
];

const SdrAccordion = ({
                          expanded,
                          onAccordionChange,
                          gettingSDRParameters,
                          isStreaming,
                          joinedSdrId,
                          sdrs,
                          selectedSDRId,
                          onSDRChange,
                          onRefreshParameters,
                          gainValues,
                          localGain,
                          onGainChange,
                          sampleRateValues,
                          localSampleRate,
                          onSampleRateChange,
                          antennasList,
                          selectedAntenna,
                          onAntennaChange,
                          sdrCapabilities,
                          sdrSettings,
                          bandwidthStatus,
                          receiverStatus,
                          onBandwidthChange,
                          hasBiasT,
                          biasT,
                          onBiasTChange,
                          onBitpackChange,
                          onClockSourceChange,
                          onTimeSourceChange,
                          hasTunerAgc,
                          tunerAgc,
                          onTunerAgcChange,
                          hasSoapyAgc,
                          soapyAgc,
                          onSoapyAgcChange,
                          hasRtlAgc,
                          rtlAgc,
                          onRtlAgcChange,
                          sdrUsageByOtherSessions,
                          onGainElementChange,
                          isRecording,
                          startStreamValidationErrors,
                          playbackRecordings,
                          playbackRecordingsLoading,
                          selectedPlaybackRecordingName,
                          onPlaybackRecordingChange,
}) => {
    const { t } = useTranslation('waterfall');
    const controlId = React.useId();
    const [biasTConfirmationOpen, setBiasTConfirmationOpen] = React.useState(false);

    React.useEffect(() => {
        // A pending confirmation only applies to the receiver that opened it.
        setBiasTConfirmationOpen(false);
    }, [selectedSDRId]);

    const handleBiasTChange = (enabled) => {
        if (enabled) {
            // Keep Bias-T off until the voltage warning is explicitly accepted.
            setBiasTConfirmationOpen(true);
            return;
        }
        onBiasTChange?.(false);
    };

    const getSdrOptionIcon = React.useCallback((type) => {
        const normalizedType = String(type || '').trim().toLowerCase();
        if (normalizedType.startsWith('rtlsdr')) return UsbIcon;
        if (normalizedType === 'soapysdrlocal') return UsbIcon;
        if (normalizedType === 'airspy' || normalizedType === 'airspyhf') return UsbIcon;
        if (normalizedType === 'uhd') return UsbIcon;
        if (normalizedType === 'soapysdrremote') return CloudQueueIcon;
        if (normalizedType === 'sigmfplayback') return PlayCircleOutlineIcon;
        return MemoryIcon;
    }, []);

    const renderSdrOption = React.useCallback((sdr) => {
        const OptionIcon = getSdrOptionIcon(sdr?.type);
        const sdrId = String(sdr?.id ?? '');
        const usageCount = Number(sdrUsageByOtherSessions?.[sdrId] || 0);
        return (
            <Box
                sx={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1,
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                    <OptionIcon sx={{ fontSize: '1rem', opacity: 0.9 }} />
                    <Typography variant="body2" sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {sdr?.name}
                    </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    {usageCount > 0 && (
                        <Chip
                            size="small"
                            color="warning"
                            label={t('sdr.in_use_badge', { defaultValue: 'in use' })}
                            sx={{ height: 20, borderRadius: '999px' }}
                        />
                    )}
                    <Chip
                        size="small"
                        label={String(sdr?.type || '').trim() || 'unknown'}
                        sx={{ height: 20, borderRadius: '999px' }}
                    />
                </Box>
            </Box>
        );
    }, [getSdrOptionIcon, sdrUsageByOtherSessions, t]);
    const renderSelectedSdrValue = React.useCallback((value) => {
        const selectedValue = String(value ?? 'none');
        if (selectedValue === 'none') {
            return (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <RadioButtonUncheckedIcon sx={{ fontSize: '1rem', opacity: 0.8 }} />
                    {t('sdr.no_sdr_selected')}
                </Box>
            );
        }

        const selectedSdr = sdrs.find((sdr) => String(sdr?.id) === selectedValue);
        if (!selectedSdr) {
            return selectedValue;
        }

        const OptionIcon = getSdrOptionIcon(selectedSdr?.type);
        const usageCount = Number(sdrUsageByOtherSessions?.[selectedValue] || 0);

        return (
            <Box
                sx={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1,
                    minWidth: 0,
                }}
            >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                    <OptionIcon sx={{ fontSize: '1rem', opacity: 0.9, flexShrink: 0 }} />
                    <Typography
                        variant="body2"
                        sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                        {selectedSdr?.name}
                    </Typography>
                </Box>
                {usageCount > 0 && (
                    <Chip
                        size="small"
                        color="warning"
                        label={t('sdr.in_use_badge', { defaultValue: 'in use' })}
                        sx={{ height: 20, borderRadius: '999px', flexShrink: 0 }}
                    />
                )}
            </Box>
        );
    }, [sdrs, getSdrOptionIcon, sdrUsageByOtherSessions, t]);

    const sdrOptionsByGroup = React.useMemo(() => {
        const typedGroups = getSdrTypeGroups(t).map((group) => ({
            ...group,
            items: [],
        }));
        const otherGroup = {
            key: 'other',
            label: t('sdr.other_sdrs'),
            items: [],
        };

        sdrs.forEach((sdr) => {
            const normalizedType = String(sdr?.type || '').trim().toLowerCase();
            const matchingGroup = typedGroups.find((group) => group.matches(normalizedType));
            if (matchingGroup) {
                matchingGroup.items.push(sdr);
                return;
            }
            otherGroup.items.push(sdr);
        });

        return [...typedGroups, otherGroup].filter((group) => group.items.length > 0);
    }, [sdrs, t]);
    const sdrMenuItems = React.useMemo(() => {
        const items = [];
        sdrOptionsByGroup.forEach((group) => {
            items.push(
                <ListSubheader
                    key={`header-${group.key}`}
                    sx={{
                        minHeight: 24,
                        lineHeight: '24px',
                        py: 0,
                        px: 1.5,
                        fontSize: '0.7rem',
                        fontWeight: 600,
                    }}
                >
                    {group.label}
                </ListSubheader>
            );
            group.items.forEach((sdr) => {
                items.push(
                    <MenuItem value={String(sdr.id)} key={String(sdr.id)}>
                        {renderSdrOption(sdr)}
                    </MenuItem>
                );
            });
        });
        return items;
    }, [sdrOptionsByGroup, renderSdrOption]);

    const selectedSdrRecord = React.useMemo(
        () => sdrs.find((sdr) => String(sdr?.id) === String(selectedSDRId)),
        [sdrs, selectedSDRId]
    );
    const selectedCapabilities = sdrCapabilities?.[selectedSDRId] || null;
    const playbackRecordingOptions = Array.isArray(playbackRecordings) ? playbackRecordings : [];

    const refLockValue = selectedCapabilities?.sensor_values?.ref_locked;
    const hasRefLockSensor =
        refLockValue !== undefined ||
        (Array.isArray(selectedCapabilities?.sensors) &&
            selectedCapabilities.sensors.includes('ref_locked'));
    const temperatureEntries = selectedCapabilities?.sensor_values
        ? Object.entries(selectedCapabilities.sensor_values).filter(([key]) =>
            key.toLowerCase().includes('temp')
        )
        : [];

    const sdrRequiredError = Boolean(startStreamValidationErrors?.sdr);
    const isSigmfPlaybackSelected = selectedSDRId === 'sigmf-playback';
    const formatRecordingTimestamp = (recording) => {
        const raw = recording?.modified || recording?.created || null;
        if (!raw) {
            return t('sdr.unknown_date', { defaultValue: 'Unknown date' });
        }
        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) {
            return t('sdr.unknown_date', { defaultValue: 'Unknown date' });
        }
        return parsed.toLocaleString();
    };

    return (
        <Accordion expanded={expanded} onChange={onAccordionChange}>
            <AccordionSummary
                sx={{
                    boxShadow: '-1px 4px 7px #00000059',
                }}
                aria-controls="panel3d-content" id="panel3d-header">
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                    <Typography component="span">{t('sdr.title')}</Typography>
                    <Tooltip title={t('sdr.refresh_params')}>
                        <span>
                            <IconButton
                                component="span"
                                size="small"
                                aria-label={t('sdr.refresh_params')}
                                onClick={(event) => {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    onRefreshParameters?.();
                                }}
                                disabled={gettingSDRParameters || selectedSDRId === 'none' || Boolean(joinedSdrId)}
                                sx={{ opacity: 0.7, p: 0.5, mr: 0.5 }}
                            >
                                <RefreshIcon sx={{ fontSize: '1rem' }} />
                            </IconButton>
                        </span>
                    </Tooltip>
                </Box>
            </AccordionSummary>
            <AccordionDetails sx={{
                backgroundColor: 'background.elevated',
            }}>
                <LoadingOverlay loading={gettingSDRParameters}>
                    <Box sx={{mb: 2}}>

                        <FormControl disabled={isStreaming} error={sdrRequiredError} margin="normal"
                                     sx={{minWidth: 200, marginTop: 0, marginBottom: 1}} fullWidth
                                     variant="outlined"
                                     size="small">
                            <InputLabel id={`${controlId}-sdr-label`} htmlFor="sdr-select">{t('sdr.sdr_label')}</InputLabel>
                            <Select
                                id="sdr-select"
                                labelId={`${controlId}-sdr-label`}
                                aria-describedby={sdrRequiredError ? `${controlId}-sdr-help` : undefined}
                                value={sdrs.length > 0 ? String(selectedSDRId ?? "none") : "none"}
                                onChange={onSDRChange}
                                size="small"
                                renderValue={renderSelectedSdrValue}
                                label={t('sdr.sdr_label')}>
                                <MenuItem value="none" disabled={isStreaming}>
                                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                        <RadioButtonUncheckedIcon sx={{ fontSize: '1rem', opacity: 0.8 }} />
                                        {t('sdr.no_sdr_selected')}
                                    </Box>
                                </MenuItem>
                                {sdrMenuItems}
                            </Select>
                            {sdrRequiredError && (
                                <FormHelperText id={`${controlId}-sdr-help`}>
                                    {t('sdr.sdr_required', { defaultValue: 'Select an SDR before starting stream' })}
                                </FormHelperText>
                            )}
                        </FormControl>
                        {isSigmfPlaybackSelected && (
                            <FormControl
                                disabled={gettingSDRParameters || isStreaming}
                                sx={{minWidth: 200, marginTop: 0, marginBottom: 1}}
                                fullWidth
                                variant="outlined"
                                size="small"
                            >
                                <InputLabel id={`${controlId}-recording-label`}>{t('sdr.playback_recording', { defaultValue: 'IQ Recording' })}</InputLabel>
                                <Select
                                    labelId={`${controlId}-recording-label`}
                                    aria-describedby={!playbackRecordingsLoading && playbackRecordingOptions.length === 0
                                        ? `${controlId}-recording-help` : undefined}
                                    size="small"
                                    value={selectedPlaybackRecordingName || 'none'}
                                    label={t('sdr.playback_recording', { defaultValue: 'IQ Recording' })}
                                    onChange={(e) => onPlaybackRecordingChange?.(e.target.value)}
                                >
                                    <MenuItem value="none" disabled={isStreaming}>
                                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                            <DescriptionOutlinedIcon sx={{ fontSize: '1rem', opacity: 0.8 }} />
                                            {t('sdr.no_playback_recording_selected', { defaultValue: '[no recording selected]' })}
                                        </Box>
                                    </MenuItem>
                                    {playbackRecordingsLoading && playbackRecordingOptions.length === 0 && (
                                        <MenuItem value="loading" disabled>
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                                <AutorenewIcon sx={{ fontSize: '1rem', opacity: 0.8 }} />
                                                {t('sdr.loading_recordings', { defaultValue: 'Loading recordings...' })}
                                            </Box>
                                        </MenuItem>
                                    )}
                                    {playbackRecordingOptions.map((recording) => (
                                        <MenuItem
                                            key={recording.playback_path || recording.name}
                                            value={recording.playback_path || recording.name}
                                        >
                                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                                                <DescriptionOutlinedIcon sx={{ fontSize: '1rem', opacity: 0.9 }} />
                                                <Typography
                                                    variant="body2"
                                                    sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
                                                >
                                                    {recording.display_name || recording.name} - {formatRecordingTimestamp(recording)}
                                                </Typography>
                                            </Box>
                                        </MenuItem>
                                    ))}
                                </Select>
                                {!playbackRecordingsLoading && playbackRecordingOptions.length === 0 && (
                                    <FormHelperText id={`${controlId}-recording-help`}>
                                        {t('sdr.no_playback_recordings', { defaultValue: 'No IQ recordings found' })}
                                    </FormHelperText>
                                )}
                            </FormControl>
                        )}

                        <SdrParameterFields
                            device={selectedSdrRecord}
                            parameters={{
                                gain_values: gainValues,
                                sample_rate_values: sampleRateValues,
                                antennas: antennasList,
                                capabilities: selectedCapabilities,
                                has_bias_t: hasBiasT,
                                has_tuner_agc: hasTunerAgc,
                                has_soapy_agc: hasSoapyAgc,
                                has_rtl_agc: hasRtlAgc,
                            }}
                            value={{
                                gain: localGain,
                                sample_rate: localSampleRate,
                                antenna_port: selectedAntenna,
                                bias_t: biasT,
                                tuner_agc: tunerAgc,
                                soapy_agc: soapyAgc,
                                rtl_agc: rtlAgc,
                                sdr_settings: sdrSettings,
                            }}
                            onChange={(name, value) => ({
                                gain: onGainChange,
                                sample_rate: onSampleRateChange,
                                antenna_port: onAntennaChange,
                                bias_t: handleBiasTChange,
                                tuner_agc: onTunerAgcChange,
                                soapy_agc: onSoapyAgcChange,
                                rtl_agc: onRtlAgcChange,
                            })[name]?.(value)}
                            onSettingChange={(name, value) => {
                                if (name === 'gains') {
                                    // The live API changes one gain stage at a time.
                                    Object.entries(value).forEach(([stage, gain]) => {
                                        if (gain !== sdrSettings?.gains?.[stage]) onGainElementChange?.(stage, gain);
                                    });
                                    return;
                                }
                                ({
                                    bandwidth: onBandwidthChange,
                                    bitpack: onBitpackChange,
                                    clockSource: onClockSourceChange,
                                    timeSource: onTimeSourceChange,
                                })[name]?.(value);
                            }}
                            disabled={gettingSDRParameters}
                            fixedDisabled={isSigmfPlaybackSelected && isStreaming}
                            gainDisabled={isSigmfPlaybackSelected && isStreaming}
                            isStreaming={isStreaming}
                            isRecording={isRecording}
                            bandwidthStatus={bandwidthStatus}
                            validationErrors={startStreamValidationErrors}
                        />
                        {isStreaming && <ReceiverStatus status={receiverStatus}
                            device={selectedSdrRecord} gain={localGain} sampleRate={localSampleRate}
                            antenna={selectedAntenna} settings={sdrSettings} />}
                    </Box>

                    <BackgroundStreamControl />

                    {selectedCapabilities && (
                        <Box sx={{mt: 2}}>
                            <Box
                                sx={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                                    gap: 0.5,
                                }}
                            >
                                {hasRefLockSensor && (
                                    <Box
                                        sx={{
                                            px: 0.75,
                                            py: 0.25,
                                            borderRadius: 1,
                                            bgcolor: 'transparent',
                                        }}
                                    >
                                        <Box sx={{display: 'flex', justifyContent: 'space-between', gap: 1}}>
                                            <Typography variant="caption" color="text.secondary">
                                                {t('settings_sdr.ref_clock_lock', { defaultValue: 'Ref Clock Lock' })}
                                            </Typography>
                                            <Box
                                                sx={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: 0.5,
                                                    fontFamily: 'monospace',
                                                }}
                                            >
                                                <Box
                                                    sx={{
                                                        width: 8,
                                                        height: 8,
                                                        borderRadius: '50%',
                                                        bgcolor:
                                                            refLockValue === true
                                                                ? 'success.main'
                                                                : refLockValue === false
                                                                    ? 'error.main'
                                                                    : 'text.disabled',
                                                        boxShadow:
                                                            refLockValue === true
                                                                ? '0 0 6px rgba(76, 175, 80, 0.6)'
                                                                : refLockValue === false
                                                                    ? '0 0 6px rgba(244, 67, 54, 0.6)'
                                                                    : 'none',
                                                    }}
                                                />
                                                <Typography variant="caption" sx={{fontFamily: 'monospace'}}>
                                                    {refLockValue === true
                                                        ? 'Locked'
                                                        : refLockValue === false
                                                            ? 'Unlocked'
                                                            : '—'}
                                                </Typography>
                                            </Box>
                                        </Box>
                                    </Box>
                                )}
                                {temperatureEntries.length > 0 && (
                                    <Box
                                        sx={{
                                            px: 0.75,
                                            py: 0.25,
                                            borderRadius: 1,
                                            bgcolor: 'transparent',
                                            border: '1px solid',
                                            borderColor: 'divider',
                                        }}
                                    >
                                        <Box sx={{display: 'flex', justifyContent: 'space-between', gap: 1}}>
                                            <Typography variant="caption" color="text.secondary">
                                                {t('settings_sdr.temperature', { defaultValue: 'Temperature' })}
                                            </Typography>
                                            <Typography
                                                variant="caption"
                                                sx={{fontFamily: 'monospace'}}
                                            >
                                                {(() => {
                                                    const [, value] = temperatureEntries[0];
                                                    const numeric = typeof value === 'number'
                                                        ? value
                                                        : parseFloat(value);
                                                    if (Number.isFinite(numeric)) {
                                                        return numeric.toFixed(1);
                                                    }
                                                    return value ?? '—';
                                                })()}
                                            </Typography>
                                        </Box>
                                    </Box>
                                )}
                            </Box>

                        </Box>
                    )}
                </LoadingOverlay>
                <Dialog
                    open={biasTConfirmationOpen}
                    onClose={() => setBiasTConfirmationOpen(false)}
                    aria-labelledby={`${controlId}-bias-t-title`}
                    aria-describedby={`${controlId}-bias-t-warning`}
                    maxWidth="sm"
                    fullWidth
                >
                    <DialogTitle id={`${controlId}-bias-t-title`} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <WarningAmberIcon color="warning" />
                        {t('sdr.bias_t_confirm_title')}
                    </DialogTitle>
                    <DialogContent dividers sx={{ p: 3 }}>
                        <DialogContentText id={`${controlId}-bias-t-warning`}>
                            {t('sdr.bias_t_confirm_warning')}
                        </DialogContentText>
                    </DialogContent>
                    <DialogActions>
                        <Button autoFocus onClick={() => setBiasTConfirmationOpen(false)}>
                            {t('common:cancel')}
                        </Button>
                        <Button
                            color="warning"
                            variant="contained"
                            onClick={() => {
                                setBiasTConfirmationOpen(false);
                                onBiasTChange?.(true);
                            }}
                        >
                            {t('sdr.bias_t_confirm_enable')}
                        </Button>
                    </DialogActions>
                </Dialog>
            </AccordionDetails>
        </Accordion>
    );
};

function areSdrAccordionPropsEqual(prevProps, nextProps) {
    return (
        prevProps.expanded === nextProps.expanded &&
        prevProps.onAccordionChange === nextProps.onAccordionChange &&
        prevProps.gettingSDRParameters === nextProps.gettingSDRParameters &&
        prevProps.isStreaming === nextProps.isStreaming &&
        prevProps.sdrs === nextProps.sdrs &&
        prevProps.selectedSDRId === nextProps.selectedSDRId &&
        prevProps.onSDRChange === nextProps.onSDRChange &&
        prevProps.onRefreshParameters === nextProps.onRefreshParameters &&
        prevProps.gainValues === nextProps.gainValues &&
        prevProps.localGain === nextProps.localGain &&
        prevProps.onGainChange === nextProps.onGainChange &&
        prevProps.sampleRateValues === nextProps.sampleRateValues &&
        prevProps.localSampleRate === nextProps.localSampleRate &&
        prevProps.onSampleRateChange === nextProps.onSampleRateChange &&
        prevProps.antennasList === nextProps.antennasList &&
        prevProps.selectedAntenna === nextProps.selectedAntenna &&
        prevProps.onAntennaChange === nextProps.onAntennaChange &&
        prevProps.sdrCapabilities === nextProps.sdrCapabilities &&
        prevProps.sdrSettings === nextProps.sdrSettings &&
        prevProps.bandwidthStatus === nextProps.bandwidthStatus &&
        prevProps.receiverStatus === nextProps.receiverStatus &&
        prevProps.onBandwidthChange === nextProps.onBandwidthChange &&
        prevProps.hasBiasT === nextProps.hasBiasT &&
        prevProps.biasT === nextProps.biasT &&
        prevProps.onBiasTChange === nextProps.onBiasTChange &&
        prevProps.onBitpackChange === nextProps.onBitpackChange &&
        prevProps.onClockSourceChange === nextProps.onClockSourceChange &&
        prevProps.onTimeSourceChange === nextProps.onTimeSourceChange &&
        prevProps.hasTunerAgc === nextProps.hasTunerAgc &&
        prevProps.tunerAgc === nextProps.tunerAgc &&
        prevProps.onTunerAgcChange === nextProps.onTunerAgcChange &&
        prevProps.hasSoapyAgc === nextProps.hasSoapyAgc &&
        prevProps.soapyAgc === nextProps.soapyAgc &&
        prevProps.onSoapyAgcChange === nextProps.onSoapyAgcChange &&
        prevProps.hasRtlAgc === nextProps.hasRtlAgc &&
        prevProps.rtlAgc === nextProps.rtlAgc &&
        prevProps.onRtlAgcChange === nextProps.onRtlAgcChange &&
        prevProps.sdrUsageByOtherSessions === nextProps.sdrUsageByOtherSessions &&
        prevProps.onGainElementChange === nextProps.onGainElementChange &&
        prevProps.isRecording === nextProps.isRecording &&
        prevProps.startStreamValidationErrors === nextProps.startStreamValidationErrors &&
        prevProps.playbackRecordings === nextProps.playbackRecordings &&
        prevProps.playbackRecordingsLoading === nextProps.playbackRecordingsLoading &&
        prevProps.selectedPlaybackRecordingName === nextProps.selectedPlaybackRecordingName &&
        prevProps.onPlaybackRecordingChange === nextProps.onPlaybackRecordingChange
    );
}

export default React.memo(SdrAccordion, areSdrAccordionPropsEqual);
