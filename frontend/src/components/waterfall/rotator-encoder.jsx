
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { Box, Typography, useTheme } from '@mui/material';
import { setVFOProperty } from './vfo-marker/vfo-slice.jsx';
import { selectRunningRigTransmitters } from '../target/transmitter-selectors.js';
import { useTranslation } from 'react-i18next';

const sameIdentifier = (left, right) => {
    if (left == null || right == null) {
        return false;
    }
    return String(left) === String(right);
};

const areVfoConfigurationsEqualExceptFrequency = (previous, next) => {
    if (previous === next) {
        return true;
    }
    if (!previous || !next) {
        return false;
    }
    const previousProperties = Object.keys(previous).filter((property) => property !== 'frequency');
    const nextProperties = Object.keys(next).filter((property) => property !== 'frequency');
    return previousProperties.length === nextProperties.length
        && previousProperties.every((property) => previous[property] === next[property]);
};

const areRotaryVfoStatesEqual = (previous, next) => (
    previous.isVFOActive === next.isVFOActive
    && areVfoConfigurationsEqualExceptFrequency(previous.currentVFO, next.currentVFO)
);

// This readout is optional. Keeping the live transmitter subscription here
// means the rotary control itself stays idle while a hidden readout is not in
// use, instead of rerendering along with every doppler sample.
const RotaryFrequencyReadout = ({ vfoNumber, vfo, theme }) => {
    const { t } = useTranslation('waterfall');
    const frequency = useSelector((state) => state.vfo.vfoMarkers?.[vfoNumber]?.frequency || 0);
    const transmitters = useSelector(selectRunningRigTransmitters);
    const lockedTransmitter = vfo?.lockedTransmitterId && vfo.lockedTransmitterId !== 'none'
        ? transmitters.find((tx) => (
            sameIdentifier(tx.id, vfo.lockedTransmitterId)
            && (!vfo.lockedTransmitterTrackerId || sameIdentifier(tx.trackerId, vfo.lockedTransmitterTrackerId))
        ))
        : null;
    const correctedFrequency = Number.isFinite(Number(lockedTransmitter?.downlink_observed_freq))
        ? Number(lockedTransmitter.downlink_observed_freq)
        : 0;
    const formatFrequency = (value) => {
        if (value >= 1e6) return `${(value / 1e6).toFixed(3)} MHz`;
        if (value >= 1e3) return `${(value / 1e3).toFixed(1)} kHz`;
        return `${value} Hz`;
    };

    return (
        <Box sx={{ mb: 1, textAlign: 'center' }}>
            <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>
                VFO {vfoNumber} {t('rotator_encoder.step', { defaultValue: '- Step:' })} {vfo.stepSize >= 1000 ? `${vfo.stepSize / 1000}kHz` : `${vfo.stepSize}Hz`}
            </Typography>
            <Typography variant="h6" sx={{ fontFamily: 'monospace', color: vfo.color }}>
                {formatFrequency(frequency)}
            </Typography>
            {lockedTransmitter && (
                <Box sx={{ mt: 0.5 }}>
                    <Typography variant="caption" sx={{ color: theme.palette.warning.main, fontWeight: 600, display: 'block' }}>
                        {t('rotator_encoder.offset_mode', { defaultValue: '🔒 OFFSET MODE' })}
                    </Typography>
                    <Typography variant="caption" sx={{ color: theme.palette.text.secondary, fontSize: '0.7rem' }}>
                        {t('rotator_encoder.corrected', { defaultValue: 'Corrected:' })} {formatFrequency(correctedFrequency)}
                    </Typography>
                    <Typography
                        variant="caption"
                        sx={{
                            color: (vfo.frequencyOffset || 0) >= 0 ? theme.palette.success.main : theme.palette.error.main,
                            fontWeight: 600,
                            display: 'block',
                            fontSize: '0.75rem',
                        }}
                    >
                        {t('rotator_encoder.offset', { defaultValue: 'Offset:' })} {(vfo.frequencyOffset || 0) >= 0 ? '+' : ''}{vfo.frequencyOffset || 0} Hz
                    </Typography>
                </Box>
            )}
        </Box>
    );
};

const RotaryEncoder = ({
                           vfoNumber,
                           size = 200,
                           sensitivity = 1.0,
                           showFrequency = false,
                           style = {}
                       }) => {
                           const { t } = useTranslation('waterfall');
    const theme = useTheme();
    const dispatch = useDispatch();
    const { currentVFO, isVFOActive } = useSelector((state) => ({
        currentVFO: state.vfo.vfoMarkers?.[vfoNumber] || null,
        isVFOActive: Boolean(state.vfo.vfoActive?.[vfoNumber]),
    }), areRotaryVfoStatesEqual);

    const [isDragging, setIsDragging] = useState(false);
    const [rotation, setRotation] = useState(0);
    const [lastAngle, setLastAngle] = useState(0);
    const containerRef = useRef(null);
    const lastTouchRef = useRef({ x: 0, y: 0 });
    const lastMouseRef = useRef({ x: 0, y: 0 });
    const rotationAccumulator = useRef(0);

    // Get current VFO data based on the provided vfoNumber
    const stepSize = currentVFO?.stepSize || 1000; // Default 1kHz step
    const currentFrequency = currentVFO?.frequency || 0;
    const isLocked = currentVFO?.lockedTransmitterId && currentVFO?.lockedTransmitterId !== 'none';
    const currentOffset = currentVFO?.frequencyOffset || 0;

    // Format offset for display (always in Hz)
    const formatOffset = (offset) => {
        return `${offset >= 0 ? '+' : ''}${offset} Hz`;
    };

    // Calculate angle from center point
    const calculateAngle = useCallback((x, y, centerX, centerY) => {
        const deltaX = x - centerX;
        const deltaY = y - centerY;
        return Math.atan2(deltaY, deltaX) * (180 / Math.PI);
    }, []);

    // Get center coordinates of the container
    const getCenter = useCallback(() => {
        if (!containerRef.current) return { x: size / 2, y: size / 2 };
        const rect = containerRef.current.getBoundingClientRect();
        return {
            x: rect.width / 2,
            y: rect.height / 2
        };
    }, [size]);

    // Check if a point is within the thumb pit area
    const isPointInThumbPit = useCallback((x, y) => {
        const center = getCenter();

        // Calculate the thumb pit position based on current rotation
        const thumbPitDistance = size * 0.25; // Distance from center to thumb pit center
        const rotationRad = (rotation * Math.PI) / 180;

        const thumbPitCenterX = center.x + Math.sin(rotationRad) * thumbPitDistance;
        const thumbPitCenterY = center.y - Math.cos(rotationRad) * thumbPitDistance;

        // Check if the point is within the thumb pit radius
        const thumbPitRadius = size * 0.12; // Radius of the thumb pit
        const distance = Math.sqrt(
            Math.pow(x - thumbPitCenterX, 2) + Math.pow(y - thumbPitCenterY, 2)
        );

        return distance <= thumbPitRadius;
    }, [size, rotation, getCenter]);

    // Handle frequency change based on rotation
    const handleFrequencyChange = useCallback((angleDelta) => {
        if (!currentVFO || !vfoNumber || !isVFOActive) return;

        // Accumulate small rotations to prevent loss of precision
        rotationAccumulator.current += angleDelta;

        // Only apply changes when we've accumulated enough rotation
        const threshold = 5; // degrees
        if (Math.abs(rotationAccumulator.current) >= threshold) {
            const steps = Math.round(rotationAccumulator.current / threshold);
            const frequencyChange = steps * stepSize * sensitivity;

            if (isLocked) {
                // When locked, adjust the frequency offset instead of absolute frequency
                const newOffset = Math.round(currentOffset + frequencyChange);

                dispatch(setVFOProperty({
                    vfoNumber: vfoNumber,
                    updates: { frequencyOffset: newOffset }
                }));
            } else {
                // When unlocked, adjust absolute frequency as before
                const newFrequency = Math.round(currentFrequency + frequencyChange);

                dispatch(setVFOProperty({
                    vfoNumber: vfoNumber,
                    updates: { frequency: newFrequency }
                }));
            }

            // Reset accumulator after applying change
            rotationAccumulator.current = 0;
        }
    }, [currentVFO, vfoNumber, isVFOActive, stepSize, sensitivity, currentFrequency, currentOffset, isLocked, dispatch]);

    // Mouse event handlers
    const handleMouseDown = useCallback((e) => {
        if (!isVFOActive) return; // Don't allow interaction if VFO is not active

        const rect = containerRef.current.getBoundingClientRect();
        const center = getCenter();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Check if the click is within the thumb pit area
        if (!isPointInThumbPit(x, y)) {
            return; // Ignore clicks outside the thumb pit
        }

        e.preventDefault();
        setIsDragging(true);
        setLastAngle(calculateAngle(x, y, center.x, center.y));
        lastMouseRef.current = { x, y };
    }, [isVFOActive, getCenter, calculateAngle, isPointInThumbPit]);

    const handleMouseMove = useCallback((e) => {
        if (!isDragging) return;

        e.preventDefault();
        const rect = containerRef.current.getBoundingClientRect();
        const center = getCenter();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const currentAngle = calculateAngle(x, y, center.x, center.y);
        let angleDelta = currentAngle - lastAngle;

        // Handle angle wraparound
        if (angleDelta > 180) angleDelta -= 360;
        if (angleDelta < -180) angleDelta += 360;

        setRotation(prev => prev + angleDelta);
        handleFrequencyChange(angleDelta);
        setLastAngle(currentAngle);
    }, [isDragging, getCenter, calculateAngle, lastAngle, handleFrequencyChange]);

    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
        rotationAccumulator.current = 0;
    }, []);

    // Touch event handlers
    const handleTouchStart = useCallback((e) => {
        if (!isVFOActive) return; // Don't allow interaction if VFO is not active

        if (e.touches.length !== 1) return;

        const touch = e.touches[0];
        const rect = containerRef.current.getBoundingClientRect();
        const center = getCenter();
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;

        // Check if the touch is within the thumb pit area
        if (!isPointInThumbPit(x, y)) {
            return; // Allow touch event to propagate for scrolling
        }

        // Only prevent default if we're handling the touch in the thumb pit
        e.preventDefault();
        setIsDragging(true);
        setLastAngle(calculateAngle(x, y, center.x, center.y));
        lastTouchRef.current = { x, y };
    }, [isVFOActive, getCenter, calculateAngle, isPointInThumbPit]);

    const handleTouchMove = useCallback((e) => {
        if (!isDragging || e.touches.length !== 1) return;

        e.preventDefault();
        const touch = e.touches[0];
        const rect = containerRef.current.getBoundingClientRect();
        const center = getCenter();
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;

        const currentAngle = calculateAngle(x, y, center.x, center.y);
        let angleDelta = currentAngle - lastAngle;

        // Handle angle wraparound
        if (angleDelta > 180) angleDelta -= 360;
        if (angleDelta < -180) angleDelta += 360;

        setRotation(prev => prev + angleDelta);
        handleFrequencyChange(angleDelta);
        setLastAngle(currentAngle);
    }, [isDragging, getCenter, calculateAngle, lastAngle, handleFrequencyChange]);

    const handleTouchEnd = useCallback((e) => {
        if (isDragging) {
            e.preventDefault();
        }
        setIsDragging(false);
        rotationAccumulator.current = 0;
    }, [isDragging]);

    // Global event listeners for drag operations
    useEffect(() => {
        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
            document.addEventListener('touchmove', handleTouchMove, { passive: false });
            document.addEventListener('touchend', handleTouchEnd);

            return () => {
                document.removeEventListener('mousemove', handleMouseMove);
                document.removeEventListener('mouseup', handleMouseUp);
                document.removeEventListener('touchmove', handleTouchMove);
                document.removeEventListener('touchend', handleTouchEnd);
            };
        }
    }, [isDragging, handleMouseMove, handleMouseUp, handleTouchMove, handleTouchEnd]);

    // Show visual feedback when VFO is inactive
    const isDisabled = !currentVFO || !isVFOActive;

    return (
        <Box
            elevation={1}
            sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                color: theme.palette.text.primary,
                opacity: isDisabled ? 0.5 : 1,
                ...style
            }}
        >
            {showFrequency && currentVFO && (
                <RotaryFrequencyReadout vfoNumber={vfoNumber} vfo={currentVFO} theme={theme} />
            )}

            <Box
                ref={containerRef}
                sx={{
                    position: 'relative',
                    width: size,
                    height: size,
                    cursor: isDisabled ? 'not-allowed' : (isDragging ? 'grabbing' : 'grab'),
                    userSelect: 'none',
                    // Remove touchAction: 'none' to allow scrolling on non-thumb-pit areas
                }}
                onMouseDown={handleMouseDown}
                onTouchStart={handleTouchStart}
            >
                {/* Outer ring */}
                <svg
                    width={size}
                    height={size}
                    style={{
                        position: 'absolute',
                        top: 0,
                        left: 0
                    }}
                >
                    {/* Inner dial face */}
                    <circle
                        cx={size / 2}
                        cy={size / 2}
                        r={size * 0.48}
                        fill={isDisabled ? theme.palette.background.default : theme.palette.background.paper}
                        stroke={isDisabled ? theme.palette.border.dark : (isLocked ? theme.palette.warning.main : theme.palette.border.main)}
                        strokeWidth={isLocked ? "3" : "2"}
                    />

                    {/* Offset mode indicator ring */}
                    {isLocked && !isDisabled && (
                        <circle
                            cx={size / 2}
                            cy={size / 2}
                            r={size * 0.46}
                            fill="none"
                            stroke={theme.palette.warning.main}
                            strokeWidth="1"
                            strokeDasharray="4,4"
                            opacity="0.6"
                        />
                    )}

                    {/* Offset value overlay - centered on dial */}
                    {isLocked && !isDisabled && (
                        <g>
                            <text
                                x={size / 2}
                                y={size / 2 - 5}
                                textAnchor="middle"
                                fontSize={size * 0.08}
                                fontWeight="bold"
                                fill={currentOffset >= 0 ? theme.palette.success.main : theme.palette.error.main}
                                fontFamily="monospace"
                            >
                                {formatOffset(currentOffset)}
                            </text>
                            <text
                                x={size / 2}
                                y={size / 2 + 10}
                                textAnchor="middle"
                                fontSize={size * 0.06}
                                fill={theme.palette.warning.main}
                                fontFamily="sans-serif"
                            >
                                {t('rotator_encoder.offset', { defaultValue: 'OFFSET' })}
                            </text>
                        </g>
                    )}

                    {/* Larger thumb pit indicator - moved closer to edge */}
                    <g transform={`rotate(${rotation}  ${size / 2} ${size / 2})`}>
                        {/* Thumb pit - positioned closer to edge */}
                        <circle
                            cx={size / 2}
                            cy={size * 0.25}
                            r={size * 0.12}
                            fill={isDisabled ? theme.palette.background.default : theme.palette.background.elevated}
                            stroke={isDisabled ? theme.palette.border.dark : (isLocked ? theme.palette.warning.main : theme.palette.border.light)}
                            strokeWidth={isLocked ? "2" : "1"}
                            style={{ cursor: isDisabled ? 'not-allowed' : 'pointer' }}
                        />
                        {/* Inner shadow effect for the pit */}
                        <circle
                            cx={size / 2}
                            cy={size * 0.25}
                            r={size * 0.08}
                            fill={theme.palette.background.default}
                            style={{ cursor: isDisabled ? 'not-allowed' : 'pointer' }}
                        />
                        {/* Innermost darker area */}
                        <circle
                            cx={size / 2}
                            cy={size * 0.25}
                            r={size * 0.06}
                            fill={theme.palette.overlay.dark}
                            style={{ cursor: isDisabled ? 'not-allowed' : 'pointer' }}
                        />
                    </g>
                </svg>

                {/* Knurled edge effect */}
                <Box
                    sx={{
                        position: 'relative',
                        top: '4%',
                        left: '4%',
                        width: '92%',
                        height: '92%',
                        borderRadius: '50%',
                        background: `
                            radial-gradient(circle at center,
                                ${theme.palette.overlay.medium} 0%,
                                ${theme.palette.overlay.light} 40%,
                                ${theme.palette.overlay.dark} 100%
                            )
                        `,
                        pointerEvents: 'none'
                    }}
                />
            </Box>

            {!currentVFO && (
                <Typography variant="caption" sx={{ mt: 1, color: theme.palette.text.disabled, textAlign: 'center' }}>
                    VFO {vfoNumber} {t('rotator_encoder.not_configured', { defaultValue: 'not configured' })}
                </Typography>
            )}

        </Box>
    );
};

export default RotaryEncoder;
