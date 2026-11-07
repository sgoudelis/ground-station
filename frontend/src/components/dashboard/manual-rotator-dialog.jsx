/**
 * @license
 * Copyright (c) 2026 Efstratios Goudelis
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import * as React from 'react';
import {useDispatch, useSelector} from 'react-redux';
import { useTranslation } from 'react-i18next';
import {
    Box,
    Button,
    DialogActions,
    DialogContent,
    DialogTitle,
    Grid,
    IconButton,
    Paper,
    Portal,
    Typography,
} from '@mui/material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import ArrowDropUpIcon from '@mui/icons-material/ArrowDropUp';
import {resolveHardwarePresentation} from '../common/hardware-status-presentation.jsx';
import {isCommandOutstanding} from '../target/tracker-command-state.js';
import {TrackerCommandHeaderStatus} from '../target/tracker-command-feedback.jsx';
import CloseIcon from '@mui/icons-material/Close';
import {setManualRotatorDialogPosition} from './dashboard-slice.jsx';

const CENTERED_POSITION = {x: 0, y: 0};
const VIEWPORT_MARGIN = 16;

const DIAL_SIZE = 184;
const DIAL_CENTER = DIAL_SIZE / 2;
const DIAL_RADIUS = 67;
const AZIMUTH_ARC_RADIUS = DIAL_RADIUS + 16;
const ARC_WIDTH = 16;
const ELEVATION_CENTER_X = 32;
const ELEVATION_CENTER_Y = 152;
const ELEVATION_RADIUS = 108;
const ELEVATION_POINTER_RADIUS = 90;

const finiteNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const formatDegrees = (value) => {
    const parsed = finiteNumber(value);
    return parsed === null ? '' : String(Math.round(parsed * 10) / 10);
};

const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

const rangeValue = (ratio, min, max) => min + clamp(ratio, 0, 1) * (max - min);
const valueRatio = (value, min, max) => (max > min ? clamp((value - min) / (max - min), 0, 1) : 0);

function CoordinateReadout({axis, current, requested}) {
    const {t} = useTranslation('target');
    const degrees = (value) => {
        // Missing telemetry must stay visibly unknown rather than looking like 0°.
        if (value === null || value === undefined || value === '') return '—';
        const parsed = finiteNumber(value);
        return parsed === null ? '—' : `${parsed.toFixed(1)}°`;
    };

    return <Box component="dl" role="group" aria-label={t('manual_rotator_dialog.readout_label', {axis})}
        sx={{display: 'grid', gridTemplateColumns: '1fr auto', columnGap: 1, rowGap: 0.25, m: 0, mt: 0.5, px: 1}}>
        <Typography component="dt" variant="caption" color="text.secondary">{t('manual_rotator_dialog.current')}</Typography>
        <Typography component="dd" variant="body2" sx={{m: 0, fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums'}}>
            {degrees(current)}
        </Typography>
        <Typography component="dt" variant="caption" color="text.secondary">{t('manual_rotator_dialog.requested')}</Typography>
        <Typography component="dd" variant="body2" sx={{m: 0, fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', fontWeight: 700}}>
            {degrees(requested)}
        </Typography>
    </Box>;
}

function CoordinateStepper({ label, value, min, max, disabled, onChange }) {
    const numericValue = finiteNumber(value);
    const displayValue = numericValue === null ? min : clamp(numericValue, min, max);
    const integerDigits = Math.max(String(Math.floor(Math.max(Math.abs(min), Math.abs(max)))).length, 1);
    const [integerPart, decimalPart] = Math.abs(displayValue).toFixed(1).split('.');
    const digits = `${integerPart.padStart(integerDigits, '0')}${decimalPart}`.split('');
    const positions = Array.from({ length: integerDigits + 1 }, (_, index) => (
        index < integerDigits ? integerDigits - index - 1 : -1
    ));

    const adjustDigit = (position, direction) => {
        const nextValue = clamp(
            Math.round((displayValue + direction * (10 ** position)) * 10) / 10,
            min,
            max,
        );
        onChange(nextValue);
    };

    return (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 0 }}>
            <Typography sx={{ fontFamily: 'monospace', fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.12em', mb: 0.15 }}>
                {label}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', border: 2, borderColor: 'divider', borderRadius: 1, bgcolor: 'action.hover', px: 0.25 }}>
                {displayValue < 0 && <Typography sx={{ fontFamily: 'monospace', fontSize: '1.3rem', fontWeight: 800, pr: 0.1 }}>−</Typography>}
                {digits.map((digit, index) => (
                    <React.Fragment key={`${label}-${index}`}>
                        {index === integerDigits && <Typography sx={{ fontFamily: 'monospace', fontSize: '1.35rem', fontWeight: 800, px: 0.05 }}>.</Typography>}
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            <IconButton
                                aria-label={`Increase ${label} digit`}
                                disabled={disabled}
                                onClick={() => adjustDigit(positions[index], 1)}
                                sx={{ p: 0, minWidth: 28, minHeight: 24 }}
                            >
                                <ArrowDropUpIcon fontSize="small" />
                            </IconButton>
                            <Typography sx={{ minWidth: 20, fontFamily: 'monospace', fontSize: '1.45rem', fontWeight: 800, lineHeight: 1, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                                {digit}
                            </Typography>
                            <IconButton
                                aria-label={`Decrease ${label} digit`}
                                disabled={disabled}
                                onClick={() => adjustDigit(positions[index], -1)}
                                sx={{ p: 0, minWidth: 28, minHeight: 24 }}
                            >
                                <ArrowDropDownIcon fontSize="small" />
                            </IconButton>
                        </Box>
                    </React.Fragment>
                ))}
                <Typography sx={{ fontFamily: 'monospace', fontSize: '1.1rem', fontWeight: 800, pl: 0.3 }}>°</Typography>
            </Box>
        </Box>
    );
}

function AzimuthDial({ value, currentValue, min, max, disabled, onChange }) {
    const { t } = useTranslation('target');
    const updateFromPointer = React.useCallback((event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left - rect.width / 2;
        const y = event.clientY - rect.top - rect.height / 2;
        // 0° is north and values increase clockwise, matching antenna azimuth.
        const radians = Math.atan2(x, -y);
        const ratio = (radians < 0 ? radians + (2 * Math.PI) : radians) / (2 * Math.PI);
        onChange(rangeValue(ratio, min, max));
    }, [max, min, onChange]);

    const numericValue = finiteNumber(value);
    const numericCurrentValue = finiteNumber(currentValue);
    const ratio = numericValue === null ? 0 : valueRatio(numericValue, min, max);
    const radians = ratio * 2 * Math.PI;
    const pointerX = DIAL_CENTER + DIAL_RADIUS * Math.sin(radians);
    const pointerY = DIAL_CENTER - DIAL_RADIUS * Math.cos(radians);
    const currentRatio = numericCurrentValue === null ? null : valueRatio(numericCurrentValue, min, max);
    const currentRadians = currentRatio === null ? null : currentRatio * 2 * Math.PI;
    const currentPointerX = currentRadians === null ? null : DIAL_CENTER + AZIMUTH_ARC_RADIUS * Math.sin(currentRadians);
    const currentPointerY = currentRadians === null ? null : DIAL_CENTER - AZIMUTH_ARC_RADIUS * Math.cos(currentRadians);

    return (
        <Box sx={{ textAlign: 'center' }}>
            <svg
                aria-label={t('manual_rotator_dialog.azimuth_dial', { defaultValue: 'Azimuth dial' })}
                aria-valuemin={min}
                aria-valuemax={max}
                aria-valuenow={numericValue ?? undefined}
                role="slider"
                tabIndex={disabled ? -1 : 0}
                viewBox={`0 0 ${DIAL_SIZE} ${DIAL_SIZE}`}
                width="100%"
                height="184"
                onKeyDown={(event) => {
                    if (disabled) return;
                    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') onChange(clamp((numericValue ?? min) + 1, min, max));
                    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') onChange(clamp((numericValue ?? min) - 1, min, max));
                }}
                onPointerDown={(event) => {
                    if (disabled) return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    updateFromPointer(event);
                }}
                onPointerMove={(event) => {
                    if (!disabled && event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event);
                }}
                onPointerUp={(event) => event.currentTarget.releasePointerCapture?.(event.pointerId)}
                style={{ cursor: disabled ? 'not-allowed' : 'crosshair', outline: 'none', touchAction: 'none' }}
            >
                <circle cx={DIAL_CENTER} cy={DIAL_CENTER} r={AZIMUTH_ARC_RADIUS} fill="none" stroke="currentColor" opacity="0.2" strokeWidth={ARC_WIDTH} />
                <line x1={DIAL_CENTER} y1={DIAL_CENTER} x2={DIAL_CENTER} y2={DIAL_CENTER - AZIMUTH_ARC_RADIUS} stroke="currentColor" strokeWidth="1" strokeDasharray="2 4" opacity="0.35" />
                <line x1={DIAL_CENTER} y1={DIAL_CENTER} x2={DIAL_CENTER + AZIMUTH_ARC_RADIUS} y2={DIAL_CENTER} stroke="currentColor" strokeWidth="1" strokeDasharray="2 4" opacity="0.35" />
                <line x1={DIAL_CENTER} y1={DIAL_CENTER} x2={DIAL_CENTER} y2={DIAL_CENTER + AZIMUTH_ARC_RADIUS} stroke="currentColor" strokeWidth="1" strokeDasharray="2 4" opacity="0.35" />
                <line x1={DIAL_CENTER} y1={DIAL_CENTER} x2={DIAL_CENTER - AZIMUTH_ARC_RADIUS} y2={DIAL_CENTER} stroke="currentColor" strokeWidth="1" strokeDasharray="2 4" opacity="0.35" />
                {currentPointerX !== null && <line x1={DIAL_CENTER} y1={DIAL_CENTER} x2={currentPointerX} y2={currentPointerY} stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" opacity="0.55" />}
                {currentRatio !== null && <rect x={DIAL_CENTER - 1} y={DIAL_CENTER - AZIMUTH_ARC_RADIUS - ARC_WIDTH / 2} width="2" height={ARC_WIDTH} fill="#fff" transform={`rotate(${currentRatio * 360} ${DIAL_CENTER} ${DIAL_CENTER})`} />}
                <line x1={DIAL_CENTER} y1={DIAL_CENTER} x2={pointerX} y2={pointerY} stroke="var(--mui-palette-operational-busy-main, currentColor)" strokeWidth="5" strokeLinecap="round" />
                <circle cx={DIAL_CENTER} cy={DIAL_CENTER} r="7" fill="var(--mui-palette-operational-busy-main, currentColor)" />
                <text x={DIAL_CENTER} y="9" textAnchor="middle" dominantBaseline="middle" fill="currentColor" fontSize="11">N</text>
                <text x="175" y={DIAL_CENTER} textAnchor="middle" dominantBaseline="middle" fill="currentColor" fontSize="11">E</text>
                <text x={DIAL_CENTER} y="175" textAnchor="middle" dominantBaseline="middle" fill="currentColor" fontSize="11">S</text>
                <text x="9" y={DIAL_CENTER} textAnchor="middle" dominantBaseline="middle" fill="currentColor" fontSize="11">W</text>
            </svg>
        </Box>
    );
}

function ElevationDial({ value, currentValue, min, max, disabled, onChange }) {
    const { t } = useTranslation('target');
    const updateFromPointer = React.useCallback((event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left - rect.width * (ELEVATION_CENTER_X / DIAL_SIZE);
        const y = rect.top + rect.height * (ELEVATION_CENTER_Y / DIAL_SIZE) - event.clientY;
        // Elevation sweeps one quarter turn from the horizon to zenith.
        const ratio = clamp(Math.atan2(y, x) / (Math.PI / 2), 0, 1);
        onChange(rangeValue(ratio, min, max));
    }, [max, min, onChange]);

    const numericValue = finiteNumber(value);
    const numericCurrentValue = finiteNumber(currentValue);
    const ratio = numericValue === null ? 0 : valueRatio(numericValue, min, max);
    const theta = ratio * (Math.PI / 2);
    const pointerX = ELEVATION_CENTER_X + ELEVATION_POINTER_RADIUS * Math.cos(theta);
    const pointerY = ELEVATION_CENTER_Y - ELEVATION_POINTER_RADIUS * Math.sin(theta);
    const currentRatio = numericCurrentValue === null ? null : valueRatio(numericCurrentValue, min, max);
    const currentTheta = currentRatio === null ? null : currentRatio * (Math.PI / 2);
    const currentPointerX = currentTheta === null ? null : ELEVATION_CENTER_X + ELEVATION_RADIUS * Math.cos(currentTheta);
    const currentPointerY = currentTheta === null ? null : ELEVATION_CENTER_Y - ELEVATION_RADIUS * Math.sin(currentTheta);

    return (
        <Box sx={{ textAlign: 'center' }}>
            <svg
                aria-label={t('manual_rotator_dialog.elevation_dial', { defaultValue: 'Elevation dial' })}
                aria-valuemin={min}
                aria-valuemax={max}
                aria-valuenow={numericValue ?? undefined}
                role="slider"
                tabIndex={disabled ? -1 : 0}
                viewBox="12 28 144 144"
                width="100%"
                height="184"
                onKeyDown={(event) => {
                    if (disabled) return;
                    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') onChange(clamp((numericValue ?? min) + 1, min, max));
                    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') onChange(clamp((numericValue ?? min) - 1, min, max));
                }}
                onPointerDown={(event) => {
                    if (disabled) return;
                    event.currentTarget.setPointerCapture(event.pointerId);
                    updateFromPointer(event);
                }}
                onPointerMove={(event) => {
                    if (!disabled && event.currentTarget.hasPointerCapture(event.pointerId)) updateFromPointer(event);
                }}
                onPointerUp={(event) => event.currentTarget.releasePointerCapture?.(event.pointerId)}
                style={{ cursor: disabled ? 'not-allowed' : 'crosshair', outline: 'none', touchAction: 'none' }}
            >
                <path d="M 139.7 159.5 A 108 108 0 0 0 24.5 44.3" fill="none" stroke="currentColor" opacity="0.2" strokeWidth={ARC_WIDTH} />
                <line x1={ELEVATION_CENTER_X} y1={ELEVATION_CENTER_Y} x2={ELEVATION_CENTER_X + ELEVATION_RADIUS} y2={ELEVATION_CENTER_Y} stroke="currentColor" strokeWidth="1" strokeDasharray="2 4" opacity="0.35" />
                <line x1={ELEVATION_CENTER_X} y1={ELEVATION_CENTER_Y} x2={ELEVATION_CENTER_X} y2={ELEVATION_CENTER_Y - ELEVATION_RADIUS} stroke="currentColor" strokeWidth="1" strokeDasharray="2 4" opacity="0.35" />
                {currentPointerX !== null && <line x1={ELEVATION_CENTER_X} y1={ELEVATION_CENTER_Y} x2={currentPointerX} y2={currentPointerY} stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" opacity="0.55" />}
                {currentTheta !== null && <rect x={ELEVATION_CENTER_X + ELEVATION_RADIUS - ARC_WIDTH / 2} y={ELEVATION_CENTER_Y - 1} width={ARC_WIDTH} height="2" fill="#fff" transform={`rotate(${-currentTheta * 180 / Math.PI} ${ELEVATION_CENTER_X} ${ELEVATION_CENTER_Y})`} />}
                <line x1={ELEVATION_CENTER_X} y1={ELEVATION_CENTER_Y} x2={pointerX} y2={pointerY} stroke="var(--mui-palette-operational-busy-main, currentColor)" strokeWidth="5" strokeLinecap="round" />
                <circle cx={ELEVATION_CENTER_X} cy={ELEVATION_CENTER_Y} r="7" fill="var(--mui-palette-operational-busy-main, currentColor)" />
                <text x="140" y="152" textAnchor="middle" dominantBaseline="middle" fill="currentColor" fontSize="11">{formatDegrees(min)}°</text>
                <text x="108" y="76" textAnchor="middle" dominantBaseline="middle" fill="currentColor" fontSize="11">{formatDegrees((min + max) / 2)}°</text>
                <text x="35" y="45" textAnchor="middle" dominantBaseline="middle" fill="currentColor" fontSize="11">{formatDegrees(max)}°</text>
            </svg>
        </Box>
    );
}

export default function ManualRotatorDialog({
    open,
    onClose,
    onMove,
    onStop,
    rotator,
    rotatorStatus,
    currentAz,
    currentEl,
    minAz,
    maxAz,
    minEl,
    maxEl,
    disabled,
    command,
    canStop,
    stopLabel,
}) {
    const { t } = useTranslation('target');
    const dispatch = useDispatch();
    const savedPosition = useSelector((state) => state.dashboard?.manualRotatorDialogPosition) || CENTERED_POSITION;
    const [position, setPosition] = React.useState(savedPosition);
    const positionRef = React.useRef(savedPosition);
    const [paper, setPaper] = React.useState(null);
    const [dragging, setDragging] = React.useState(false);
    const drag = React.useRef(null);
    const titleId = React.useId();
    const [az, setAz] = React.useState('');
    const [el, setEl] = React.useState('');
    const busy = isCommandOutstanding(command);
    const moving = busy && !['pause', 'stop'].includes(command.action);
    const stopping = busy && ['pause', 'stop'].includes(command.action);
    const hardwareStatus = resolveHardwarePresentation({source: 'rotator', status: rotatorStatus?.key || 'unknown', t});
    const wasOpen = React.useRef(false);

    const updatePosition = React.useCallback((next) => {
        positionRef.current = next;
        setPosition(next);
    }, []);

    const boundPosition = React.useCallback((next) => {
        if (!paper) return next;
        const {width, height} = paper.getBoundingClientRect();
        // Store offsets from the normal centered position. Keep the whole dialog
        // reachable when restoring it on a smaller screen or resizing the window.
        const maxX = Math.max(0, (window.innerWidth - width) / 2 - VIEWPORT_MARGIN);
        const maxY = Math.max(0, (window.innerHeight - height) / 2 - VIEWPORT_MARGIN);
        return {x: clamp(next.x, -maxX, maxX), y: clamp(next.y, -maxY, maxY)};
    }, [paper]);

    React.useLayoutEffect(() => {
        if (!open) {
            // Closing during a drag must not leave the next opening grabbed.
            drag.current = null;
            setDragging(false);
            return;
        }
        if (!paper) return;
        updatePosition(boundPosition(savedPosition));
        const keepInView = () => updatePosition(boundPosition(positionRef.current));
        const observer = new ResizeObserver(keepInView);
        observer.observe(paper);
        window.addEventListener('resize', keepInView);
        return () => {
            observer.disconnect();
            window.removeEventListener('resize', keepInView);
        };
    }, [boundPosition, open, paper, savedPosition, updatePosition]);

    const startDrag = (event) => {
        // The close button and the antenna controls retain their normal behavior.
        if (drag.current || event.isPrimary === false || event.button !== 0 || event.target.closest('button')) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {pointerId: event.pointerId, x: event.clientX, y: event.clientY, position: positionRef.current};
        setDragging(true);
    };

    const moveDialog = (event) => {
        const start = drag.current;
        if (!start || start.pointerId !== event.pointerId) return;
        updatePosition(boundPosition({
            x: start.position.x + event.clientX - start.x,
            y: start.position.y + event.clientY - start.y,
        }));
    };

    const finishDrag = (event) => {
        if (!drag.current || drag.current.pointerId !== event.pointerId) return;
        drag.current = null;
        setDragging(false);
        // Persist only the completed drag; pointer movement stays local to the dialog.
        dispatch(setManualRotatorDialogPosition(positionRef.current));
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    };

    React.useEffect(() => {
        if (open && !wasOpen.current) {
            setAz(formatDegrees(currentAz));
            setEl(formatDegrees(currentEl));
        }
        wasOpen.current = open;
    }, [currentAz, currentEl, open]);

    const numericAz = finiteNumber(az);
    const numericEl = finiteNumber(el);
    const rotatorAddress = rotator?.host && rotator?.port ? `${rotator.host}:${rotator.port}` : null;
    const rotatorDetails = [
        rotatorAddress,
        `AZ ${minAz}°–${maxAz}°`,
        `EL ${minEl}°–${maxEl}°`,
    ].filter(Boolean).join('  •  ');
    const validPosition = numericAz !== null
        && numericEl !== null
        && numericAz >= minAz && numericAz <= maxAz
        && numericEl >= minEl && numericEl <= maxEl;

    const submit = async () => {
        if (!validPosition || busy || disabled) return;
        try { await onMove(numericAz, numericEl); }
        catch { /* Failure remains visible in the shared operation record. */ }
    };
    const stop = async () => {
        if (!canStop || (stopping && command?.status !== 'unknown')) return;
        try { await onStop(); }
        catch { /* Failure remains visible in the shared operation record. */ }
    };

    if (!open) return null;

    return (
        <Portal>
            {/* A floating paper avoids modal focus traps, scroll locks and hidden
                background content so waterfall controls remain usable. */}
            <Box sx={{position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                bgcolor: 'transparent', backdropFilter: 'none', pointerEvents: 'none', zIndex: (theme) => theme.zIndex.modal - 1}}>
                <Paper ref={setPaper} role="dialog" aria-modal="false" aria-labelledby={titleId} elevation={24}
                    onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                            event.stopPropagation();
                            onClose();
                        }
                    }}
                    style={{translate: `${position.x}px ${position.y}px`}}
                    sx={{pointerEvents: 'auto', display: 'flex', flexDirection: 'column', position: 'relative',
                        m: 4, width: 'calc(100% - 64px)', maxWidth: 444, maxHeight: 'calc(100% - 64px)', overflowY: 'auto',
                        border: '1px solid', borderColor: 'divider'}}>
                    <DialogTitle id={titleId} onPointerDown={startDrag} onPointerMove={moveDialog} onPointerUp={finishDrag}
                        onPointerCancel={finishDrag} onLostPointerCapture={finishDrag}
                        sx={{ pb: 1, pr: 6, position: 'relative', cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none', userSelect: 'none' }}>
                        <IconButton aria-label={t('rotator_control.close')} onClick={onClose} size="small"
                            sx={{ position: 'absolute', top: 8, right: 8, color: 'text.secondary' }}>
                            <CloseIcon fontSize="small" />
                        </IconButton>
                        <Typography component="span" noWrap variant="subtitle1" sx={{ display: 'block', fontWeight: 800, lineHeight: 1.2 }}>
                            {rotator?.name || 'Rotator'}
                        </Typography>
                        <Typography noWrap color="text.secondary" variant="caption" sx={{ display: 'block', fontFamily: 'monospace', mt: 0.35 }}>
                            {rotatorDetails}
                        </Typography>
                    </DialogTitle>
                    <DialogContent dividers sx={{ px: 1 }}>
                        {/* Command progress replaces the hardware label in one stable row. */}
                        <TrackerCommandHeaderStatus command={command} hardwareStatus={hardwareStatus.label}
                            hardwareIcon={hardwareStatus.Icon} showIcon
                            sx={{mx: 1, mb: 1.75, px: 1.25, py: 0.75, minHeight: 34, minWidth: 0,
                                border: '1px solid', borderColor: 'divider', borderRadius: 1.25, bgcolor: 'action.hover',
                                fontSize: '0.8rem', fontWeight: 600, lineHeight: 1.4, gap: 0.75,
                                '& .MuiSvgIcon-root': {fontSize: 16}}} />
                        <Grid container spacing={2}>
                            <Grid size={{ xs: 6, sm: 6 }}>
                                <CoordinateStepper
                                    label={t('manual_rotator_dialog.az', { defaultValue: 'AZ' })}
                                    value={az}
                                    min={minAz}
                                    max={maxAz}
                                    disabled={disabled || moving || stopping}
                                    onChange={(next) => setAz(formatDegrees(next))}
                                />
                            </Grid>
                            <Grid size={{ xs: 6, sm: 6 }}>
                                <CoordinateStepper
                                    label={t('manual_rotator_dialog.el', { defaultValue: 'EL' })}
                                    value={el}
                                    min={minEl}
                                    max={maxEl}
                                    disabled={disabled || moving || stopping}
                                    onChange={(next) => setEl(formatDegrees(next))}
                                />
                            </Grid>
                            <Grid size={{ xs: 6, sm: 6 }}>
                                <AzimuthDial value={numericAz} currentValue={currentAz} min={minAz} max={maxAz} disabled={disabled || moving || stopping} onChange={(next) => setAz(formatDegrees(next))} />
                                <CoordinateReadout axis={t('manual_rotator_dialog.az', {defaultValue: 'AZ'})} current={currentAz} requested={az} />
                            </Grid>
                            <Grid size={{ xs: 6, sm: 6 }}>
                                <ElevationDial value={numericEl} currentValue={currentEl} min={minEl} max={maxEl} disabled={disabled || moving || stopping} onChange={(next) => setEl(formatDegrees(next))} />
                                <CoordinateReadout axis={t('manual_rotator_dialog.el', {defaultValue: 'EL'})} current={currentEl} requested={el} />
                            </Grid>
                        </Grid>
                    </DialogContent>
                    <DialogActions sx={{ p: 2 }}>
                        <Button color="error" disabled={!canStop || (stopping && command?.status !== 'unknown')} loading={stopping && command?.status !== 'unknown'} variant="contained" onClick={stop}>{stopLabel || t('rotator_control.stop')}</Button>
                        <Button disabled={disabled || !validPosition || moving || stopping} loading={moving && command?.status !== 'unknown'} variant="contained" onClick={submit}>{t('rotator_control.move')}</Button>
                    </DialogActions>
                </Paper>
            </Box>
        </Portal>
    );
}
