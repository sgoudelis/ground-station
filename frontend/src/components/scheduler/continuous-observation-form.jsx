// Copyright (c) 2026 Efstratios Goudelis
// SPDX-License-Identifier: GPL-3.0-or-later

import React, { useCallback, useEffect, useId, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
    Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Checkbox, Chip, CircularProgress,
    Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControl, FormControlLabel,
    FormHelperText, FormLabel, IconButton, InputLabel, MenuItem, Select, Stack, Switch, TextField, Tooltip, Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Add, Close, DeleteOutline, ExpandMore, GraphicEq, LockOutlined, SaveOutlined, Tune } from '@mui/icons-material';
import { useSocket } from '../common/socket.jsx';
import { mobileFullScreenPaperSx } from '../common/dialog-layout.js';
import { getDecoderParameters } from '../waterfall/decoder-parameters.js';
import { DecoderNumberField } from '../waterfall/decoder-number-field.jsx';
import LoraProfileSelect from '../waterfall/lora-profile-select.jsx';
import FrequencyDisplay from '../waterfall/frequency-dial.jsx';
import { DEFAULT_VFO_COLORS } from '../waterfall/vfo-marker/vfo-config.js';
import { fetchSDRParameters } from './scheduler-slice.jsx';
import SdrSessionFields from './sdr-session-fields.jsx';
import ContinuousBandPreview from './continuous-band-preview.jsx';
import TransmitterFrequencySearch from './transmitter-frequency-search.jsx';
import { applyContinuousTransmitter } from './continuous-transmitter-preset.js';
import {
    CONTINUOUS_DECODERS, CONTINUOUS_MODULATIONS, CONTINUOUS_VFO_LIMIT, calculateContinuousCenterFrequency,
    createContinuousVfo, getContinuousCapture, getContinuousFrequencySpan,
    hasContinuousErrors, normalizeContinuousVfo, setContinuousDecoder, setContinuousModulation, validateContinuousObservation,
} from './continuous-observation-utils.js';

const EMPTY_DEVICES = [];
const noOtherSession = () => false;
const fieldGrid = { display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 };

function ParameterSelect({ label, value, onChange, children, disabled, help }) {
    const id = useId();
    return <FormControl fullWidth size="small" disabled={disabled}>
        <InputLabel id={`${id}-label`}>{label}</InputLabel>
        <Select labelId={`${id}-label`} label={label} value={value} onChange={(event) => onChange(event.target.value)}>
            {children}
        </Select>
        {help && <FormHelperText>{help}</FormHelperText>}
    </FormControl>;
}

function DecoderParameters({ vfo, onChange, disabled }) {
    const { t } = useTranslation('waterfall');
    const definitions = getDecoderParameters(vfo.decoder, t);
    return Object.entries(definitions).map(([key, definition]) => {
        if (definition.visibleWhen && !definition.visibleWhen(vfo.decoder_parameters)) return null;
        const value = vfo.decoder_parameters[key] ?? definition.default;
        const change = (next) => onChange({ ...vfo.decoder_parameters, [key]: next });
        if (definition.type === 'select') {
            const currentIsListed = definition.options.some((option) => definition.compare
                ? definition.compare(option.value, value) : option.value === value);
            // JSON preserves array-valued LoRa choices and null/automatic settings.
            return <ParameterSelect key={key} label={definition.label} value={JSON.stringify(value)}
                disabled={disabled} onChange={(next) => change(JSON.parse(next))} help={definition.description}>
                {definition.options.map((option) => <MenuItem key={JSON.stringify(option.value)} value={JSON.stringify(option.value)}>
                    {option.label}
                </MenuItem>)}
                {!currentIsListed && <MenuItem value={JSON.stringify(value)}>{String(value)}</MenuItem>}
            </ParameterSelect>;
        }
        if (definition.type === 'number') return <DecoderNumberField key={key}
            definition={definition} value={value} onChange={change} disabled={disabled} />;
        if (definition.type === 'switch') return <FormControlLabel key={key} control={
            <Checkbox checked={Boolean(value)} disabled={disabled} onChange={(event) => change(event.target.checked)} />
        } label={<Box><Typography variant="body2">{definition.label}</Typography>
            {definition.description && <Typography variant="caption" color="text.secondary">{definition.description}</Typography>}
        </Box>} />;
        return null;
    });
}

export default function ContinuousObservationForm({ observation, readOnly = false, saving = false, saveError = null, connected = true, onClose, onSave }) {
    const { t } = useTranslation('common');
    const { t: waterfallText } = useTranslation('waterfall');
    const dispatch = useDispatch();
    const { socket } = useSocket();
    // The parent mounts a fresh form for each definition, so cancelled edits
    // never mutate a saved definition or leak into the next observation.
    const [draft, setDraft] = useState(() => structuredClone({ ...observation, vfos: observation.vfos.map(normalizeContinuousVfo) }));
    const [submitted, setSubmitted] = useState(false);
    const centerHelpId = useId();
    const devices = useSelector((state) => state.sdrs?.sdrs || EMPTY_DEVICES);
    const parameters = useSelector((state) => state.scheduler?.sdrParameters?.[draft.sdr.id]);
    const loading = useSelector((state) => Boolean(state.scheduler?.sdrParametersLoading));
    const parameterError = useSelector((state) => state.scheduler?.sdrParametersError?.[draft.sdr.id]);
    const colors = useSelector((state) => state.vfo?.vfoColors?.length ? state.vfo.vfoColors : DEFAULT_VFO_COLORS);
    const device = devices.find((entry) => String(entry.id) === String(draft.sdr.id));
    // A saved definition can be inspected before any capability request has
    // completed. Preserve its selected gain/antenna in that read-only view.
    const displayedParameters = parameters || (readOnly ? {
        gain_values: [draft.sdr.gain], sample_rate_values: [draft.sdr.sample_rate],
        antennas: { rx: [draft.sdr.antenna_port] },
    } : undefined);
    const errors = validateContinuousObservation(draft, devices, parameters);
    const capture = getContinuousCapture(draft, device, parameters);
    const frequencySpan = getContinuousFrequencySpan(draft);
    const automaticCenter = calculateContinuousCenterFrequency(draft, device, parameters);
    const label = (key, options) => t(`continuous_observations.${key}`, options);
    const centerFrequency = Number.isFinite(draft.sdr.center_frequency) ? draft.sdr.center_frequency : 0;
    const centerHelp = submitted && errors.center ? label('center_required') : draft.sdr.auto_center_frequency
        ? label(automaticCenter > 0 ? 'auto_center_calculated' : 'auto_center_waiting') : undefined;
    const changeSdr = useCallback((updates) => setDraft((previous) => ({
        ...previous, sdr: { ...previous.sdr, ...updates },
    })), []);
    const changeCenterFrequency = useCallback((frequencyKHz) => {
        if (readOnly || saving || loading || draft.sdr.auto_center_frequency) return;
        // Reuse the waterfall dial's kHz interface; definitions store integer Hz.
        changeSdr({ center_frequency: Math.round(frequencyKHz * 1000) });
    }, [changeSdr, readOnly, saving, loading, draft.sdr.auto_center_frequency]);
    const changeVfo = (id, updates) => setDraft((previous) => ({ ...previous,
        vfos: previous.vfos.map((vfo) => vfo.id === id ? { ...vfo, ...updates } : vfo),
    }));
    const refresh = () => {
        if (socket?.connected !== false && socket && draft.sdr.id) {
            dispatch(fetchSDRParameters({ socket, sdrId: draft.sdr.id }));
        }
    };

    useEffect(() => {
        // Capability reads reuse the existing SDR API; no continuous receiver
        // commands are sent while editing a definition.
        if (!readOnly && draft.sdr.id && !parameters && socket?.connected !== false && socket) {
            dispatch(fetchSDRParameters({ socket, sdrId: draft.sdr.id }));
        }
    }, [dispatch, draft.sdr.id, socket, readOnly]);

    useEffect(() => {
        if (readOnly || saving || loading || !draft.sdr.auto_center_frequency || !(automaticCenter > 0)) return;
        // Keep the resolved value in the draft: disabling auto mode freezes it,
        // and saving persists the same center shown in the receiver preview.
        setDraft((previous) => previous.sdr.center_frequency === automaticCenter ? previous : {
            ...previous, sdr: { ...previous.sdr, center_frequency: automaticCenter },
        });
    }, [automaticCenter, draft.sdr.auto_center_frequency, loading, readOnly, saving]);

    const save = (event) => {
        event.preventDefault();
        setSubmitted(true);
        if (readOnly || saving || loading || hasContinuousErrors(errors)) return;
        if (!connected) return;
        onSave({ ...draft, name: draft.name.trim() });
    };

    return <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth="md" aria-labelledby="continuous-form-title"
        slotProps={{ paper: { sx: mobileFullScreenPaperSx } }}>
        <Box component="form" onSubmit={save} noValidate sx={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
            <DialogTitle id="continuous-form-title" sx={{ pr: 7 }}>
                {readOnly ? draft.name : label(draft.created_at ? 'edit_title' : 'create_title')}
                <IconButton aria-label={label('close')} disabled={saving} onClick={onClose} sx={{ position: 'absolute', right: 12, top: 12 }}><Close /></IconButton>
            </DialogTitle>
            <DialogContent dividers>
                <Stack spacing={3}>
                    {readOnly ? <Alert severity="info" icon={<LockOutlined />}>
                        {label('readonly_description')}
                    </Alert> : <Typography variant="body2" color="text.secondary">{label('form_description')}</Typography>}
                    <Stack spacing={1}>
                        <TextField autoFocus={!readOnly} fullWidth required size="small" label={label('name')}
                            disabled={readOnly || saving} value={draft.name} error={submitted && errors.name}
                            helperText={submitted && errors.name ? label('name_required') : undefined}
                            onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                        <FormControlLabel control={<Switch checked={draft.auto_start} disabled={readOnly || saving}
                            onChange={(event) => setDraft({ ...draft, auto_start: event.target.checked })} />}
                            label={label('auto_start')} />
                        <Typography variant="caption" color="text.secondary">{label('auto_start_help')}</Typography>
                    </Stack>
                    <Divider />
                    <Stack spacing={2}>
                        <Typography variant="h6">{label('receiver')}</Typography>
                        {devices.length === 0 && <Alert severity="info">{label('no_receivers')}</Alert>}
                        <Box aria-busy={!readOnly && loading} sx={{ position: 'relative' }}>
                            {!readOnly && loading && <Box sx={{
                                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
                                justifyContent: 'center', zIndex: 1, borderRadius: 1,
                            }}>
                                <CircularProgress aria-label={label('loading_parameters')} />
                            </Box>}
                            <Stack spacing={2}>
                                <SdrSessionFields sdr={draft.sdr} sdrs={devices} parameters={displayedParameters}
                                    parameterColumns={2}
                                    loading={!readOnly && loading} error={parameterError} disabled={readOnly || loading || saving}
                                    isSdrUsedByAnotherSession={noOtherSession} onChange={changeSdr} onRefresh={refresh}
                                    validationErrors={submitted ? errors : {}} />
                                {parameterError && <Alert severity="error">{parameterError}</Alert>}
                                <Stack spacing={0.5}>
                                    <FormControlLabel control={<Switch checked={Boolean(draft.sdr.auto_center_frequency)}
                                        disabled={readOnly || loading || saving}
                                        onChange={(event) => changeSdr({ auto_center_frequency: event.target.checked })} />}
                                        label={label('auto_center')} />
                                    <Typography variant="caption" color="text.secondary">{label('auto_center_help')}</Typography>
                                </Stack>
                                <FormControl component="fieldset" fullWidth error={submitted && errors.center}
                                    disabled={readOnly || loading || saving} aria-describedby={centerHelp ? centerHelpId : undefined}
                                    sx={{ minWidth: 0, m: 0, p: 0, border: 0 }}>
                                    <FormLabel component="legend">{label('center_frequency')}</FormLabel>
                                    <Box sx={{ overflowX: 'auto', maxWidth: '100%' }}>
                                        <Box sx={{ minWidth: 'max-content' }}>
                                            <FrequencyDisplay initialFrequency={centerFrequency / 1000}
                                                onChange={changeCenterFrequency} size="small" integerDigits={6}
                                                aria-label={`${centerFrequency} Hz`}
                                                disabled={readOnly || loading || saving} readOnly={Boolean(draft.sdr.auto_center_frequency)} />
                                        </Box>
                                    </Box>
                                    {centerHelp && <FormHelperText id={centerHelpId} sx={{ mx: 0 }}>{centerHelp}</FormHelperText>}
                                </FormControl>
                                {errors.vfoSpan && <Alert severity="error">{label('insufficient_bandwidth', {
                                    required: `${(frequencySpan.requiredBandwidth / 1e6).toFixed(6)} MHz`,
                                    available: `${(capture.bandwidth / 1e6).toFixed(6)} MHz`,
                                })}</Alert>}
                                <ContinuousBandPreview capture={capture} vfos={draft.vfos} center={draft.sdr.center_frequency} />
                            </Stack>
                        </Box>
                    </Stack>
                    <Stack spacing={1.5}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                            <Typography variant="h6">{label('vfos')}</Typography>
                            <Chip size="small" variant="outlined" label={`${draft.vfos.length} / ${CONTINUOUS_VFO_LIMIT}`} />
                        </Stack>
                        <Typography variant="body2" color="text.secondary">{label('vfos_help')}</Typography>
                        {draft.vfos.map((vfo, index) => {
                            const error = errors.vfos[index];
                            const outside = error.outsideCapture;
                            const definitions = getDecoderParameters(vfo.decoder);
                            const color = colors[index % colors.length];
                            const mode = vfo.decoder === 'none' ? (vfo.modulation === 'none' ? label('no_modulation') : vfo.modulation.toUpperCase())
                                : CONTINUOUS_DECODERS.find(([value]) => value === vfo.decoder)?.[1] || vfo.decoder.toUpperCase();
                            const frequency = Number.isFinite(vfo.frequency) && vfo.frequency > 0
                                ? `${(vfo.frequency / 1e6).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 6 })} MHz` : '—';
                            return <Box key={vfo.id} component="section" aria-label={label('vfo_number', { number: index + 1 })}
                                sx={(theme) => ({
                                    border: '1px solid', borderRadius: 1.5, overflow: 'hidden',
                                    borderColor: outside ? theme.palette.error.main
                                        : alpha(color, theme.palette.mode === 'dark' ? 0.25 : 0.18),
                                    backgroundColor: alpha(color, theme.palette.mode === 'dark' ? 0.04 : 0.025),
                                })}>
                                <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.5}
                                    sx={(theme) => ({
                                        px: { xs: 1.5, sm: 2 }, py: 1.25,
                                        borderBottom: '1px solid', borderColor: alpha(color, 0.12),
                                        backgroundColor: alpha(color, theme.palette.mode === 'dark' ? 0.035 : 0.02),
                                        boxShadow: `inset 3px 0 0 ${alpha(color, 0.65)}`,
                                    })}>
                                    <Stack direction="row" alignItems="center" spacing={1.25} sx={{ minWidth: 0 }}>
                                        <Box sx={{
                                            display: 'grid', placeItems: 'center', width: 34, height: 34, flexShrink: 0,
                                            borderRadius: 1, border: '1px solid', borderColor: alpha(color, 0.2),
                                            bgcolor: alpha(color, 0.08),
                                        }}>
                                            <GraphicEq sx={{ fontSize: 20, color }} />
                                        </Box>
                                        <Box sx={{ minWidth: 0 }}>
                                            <Stack direction="row" alignItems="center" gap={1} useFlexGap flexWrap="wrap">
                                                <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                                                    {label('vfo_number', { number: index + 1 })}
                                                </Typography>
                                                <Chip size="small" variant="outlined" label={mode} sx={{
                                                    height: 20, fontSize: '0.65rem', fontWeight: 600,
                                                    borderColor: 'divider', color: 'text.secondary', bgcolor: 'background.paper',
                                                    '& .MuiChip-label': { px: 0.75 },
                                                }} />
                                            </Stack>
                                            <Typography variant="caption" color="text.secondary" noWrap sx={{
                                                display: 'block', mt: 0.25, fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums',
                                            }}>{frequency}</Typography>
                                        </Box>
                                    </Stack>
                                    {!readOnly && <Tooltip title={label('remove_vfo')}><span>
                                        <IconButton size="small" aria-label={label('remove_vfo_number', { number: index + 1 })}
                                            disabled={saving || draft.vfos.length === 1}
                                            sx={(theme) => ({
                                                border: '1px solid', borderColor: 'divider', borderRadius: 1,
                                                color: 'text.secondary', bgcolor: 'background.paper',
                                                '&:hover': { color: 'error.main', borderColor: alpha(theme.palette.error.main, 0.3),
                                                    bgcolor: alpha(theme.palette.error.main, 0.06) },
                                            })}
                                            onClick={() => setDraft({ ...draft, vfos: draft.vfos.filter((entry) => entry.id !== vfo.id) })}>
                                            <DeleteOutline sx={{ fontSize: 18 }} />
                                        </IconButton>
                                    </span></Tooltip>}
                                </Stack>
                                <Stack spacing={2} sx={{ p: { xs: 1.5, sm: 2 }, minWidth: 0 }}>
                                    {!readOnly && <TransmitterFrequencySearch disabled={saving}
                                        onTransmitterSelect={(transmitter) => setDraft((previous) => ({ ...previous,
                                            vfos: previous.vfos.map((entry) => entry.id === vfo.id
                                                ? applyContinuousTransmitter(entry, transmitter) : entry),
                                        }))} />}
                                    <Box sx={fieldGrid}>
                                        <TextField required size="small" type="number" label={label('frequency')} disabled={readOnly || saving}
                                            value={vfo.frequency === '' ? '' : vfo.frequency / 1e6}
                                            error={Boolean((submitted && error.frequency) || outside)}
                                            slotProps={{ htmlInput: { min: 0, step: 'any' } }}
                                            onChange={(event) => changeVfo(vfo.id, { frequency: event.target.value === '' ? '' : Math.round(Number(event.target.value) * 1e6) })} />
                                        <TextField required size="small" type="number" label={label('bandwidth')} disabled={readOnly || saving}
                                            value={vfo.bandwidth === '' ? '' : vfo.bandwidth / 1000}
                                            error={Boolean((submitted && error.bandwidth) || outside)}
                                            slotProps={{ htmlInput: { min: 0, step: 'any' } }}
                                            onChange={(event) => changeVfo(vfo.id, { bandwidth: event.target.value === '' ? '' : Math.round(Number(event.target.value) * 1000) })} />
                                        <ParameterSelect label={label('modulation')} value={vfo.modulation} disabled={readOnly || saving}
                                            onChange={(modulation) => changeVfo(vfo.id, setContinuousModulation(vfo, modulation))}>
                                            {CONTINUOUS_MODULATIONS.map((value) => <MenuItem key={value} value={value}>{value === 'none' ? label('no_modulation') : value.toUpperCase()}</MenuItem>)}
                                        </ParameterSelect>
                                        <ParameterSelect label={label('decoder')} value={vfo.decoder} disabled={readOnly || saving}
                                            onChange={(decoder) => changeVfo(vfo.id, setContinuousDecoder(vfo, decoder))}>
                                            {CONTINUOUS_DECODERS.map(([value, name]) => <MenuItem key={value} value={value}>
                                                {value === 'none' ? label('no_decoder') : name}
                                            </MenuItem>)}
                                        </ParameterSelect>
                                    </Box>
                                    <Typography variant="caption" color="text.secondary">{label('exclusive_mode_help')}</Typography>
                                    {outside && <Alert severity="error">{label('outside_capture')}</Alert>}
                                    {Object.keys(definitions).length > 0 && <Accordion disableGutters elevation={0}
                                        sx={{ border: '1px solid', borderColor: 'divider', bgcolor: 'transparent',
                                            '&:before': { display: 'none' } }}>
                                        <AccordionSummary expandIcon={<ExpandMore sx={{ fontSize: 20 }} />}
                                            sx={{ minHeight: 42, px: 1.5, '& .MuiAccordionSummary-content': { my: 1, gap: 1, alignItems: 'center' } }}>
                                            <Tune sx={{ fontSize: 17, color: 'text.secondary' }} />
                                            <Typography variant="body2">{label('decoder_parameters')}</Typography>
                                        </AccordionSummary>
                                        <AccordionDetails sx={{ px: 1.5, pt: 1 }}>
                                            {vfo.decoder === 'lora' && <LoraProfileSelect
                                                vfoIndex={`continuous-${vfo.id}`}
                                                parameters={vfo.decoder_parameters} disabled={readOnly || saving}
                                                helperText={waterfallText('lora_profiles.observation_help')}
                                                onSelect={(parameters) => {
                                                    // Apply the full preset to this VFO's draft so switching
                                                    // profiles also clears incompatible hidden overrides.
                                                    changeVfo(vfo.id, { decoder_parameters: { ...vfo.decoder_parameters, ...parameters } });
                                                }} />}
                                            <Box sx={fieldGrid}>
                                                <DecoderParameters vfo={vfo} disabled={readOnly || saving}
                                                    onChange={(decoder_parameters) => changeVfo(vfo.id, { decoder_parameters })} />
                                            </Box>
                                        </AccordionDetails>
                                    </Accordion>}
                                </Stack>
                            </Box>;
                        })}
                        {!readOnly && <Button startIcon={<Add />} variant="outlined" sx={{ alignSelf: 'flex-start' }}
                            disabled={saving || draft.vfos.length >= CONTINUOUS_VFO_LIMIT}
                            onClick={() => setDraft({ ...draft, vfos: [...draft.vfos, createContinuousVfo(draft.sdr.center_frequency)] })}>
                            {label('add_vfo')}
                        </Button>}
                    </Stack>
                    {saveError && <Alert severity="error">{saveError}</Alert>}
                    {!connected && <Alert severity="warning">{label('offline')}</Alert>}
                    {submitted && hasContinuousErrors(errors) && <Alert severity="error">{label('validation_error')}</Alert>}
                </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2 }}>
                <Button disabled={saving} onClick={onClose}>{label(readOnly ? 'close' : 'cancel')}</Button>
                {!readOnly && <Button type="submit" variant="contained" startIcon={<SaveOutlined />} disabled={loading || saving || !connected}>
                    {saving ? <CircularProgress size={18} /> : label(draft.created_at ? 'save_changes' : 'save_definition')}
                </Button>}
            </DialogActions>
        </Box>
    </Dialog>;
}
