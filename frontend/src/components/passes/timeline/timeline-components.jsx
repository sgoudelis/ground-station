import React, { useRef, useEffect } from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { Y_AXIS_WIDTH, X_AXIS_HEIGHT, Y_AXIS_TOP_MARGIN, elevationToYPercent } from './timeline-constants.jsx';
import TargetNumberIcon from '../../common/target-number-icon.jsx';

const normalizeHexColor = (value) => {
  const text = String(value || '').trim();
  return /^#[0-9A-Fa-f]{6}$/.test(text) ? text.toUpperCase() : '';
};

/**
 * PassCurve component - Renders a single satellite pass as an SVG path
 */
export const PassCurve = ({
  pass,
  startTime,
  endTime,
  labelType = false,
  suppressCurveLabels = false,
  labelVerticalOffset = 150,
  geoIndex = null,
  totalGeoSats = null,
  highlightActivePasses = false,
  isTargetSelectionActive = false,
  usePassAssignedColor = false,
}) => {
  const theme = useTheme();
  const stateTokens = theme.palette.timelinePass || {
    estimatedStroke: theme.palette.mode === 'dark' ? '#9aa3b2' : '#7b8794',
    estimatedFill: theme.palette.mode === 'dark' ? 'rgba(154,163,178,0.10)' : 'rgba(123,135,148,0.07)',
    lowStroke: theme.palette.error.main,
    mediumStroke: theme.palette.grey[500],
    highStroke: theme.palette.success.main,
    activeStroke: theme.palette.success.main,
  };

  const hasElevationCurve = pass.elevation_curve && pass.elevation_curve.length > 0;
  const totalDuration = endTime.getTime() - startTime.getTime();
  const chartStartMs = startTime.getTime();
  const chartEndMs = endTime.getTime();
  const isSelectedTarget = Boolean(pass?.isSelectedTarget);
  const shouldFadeForSelection = isTargetSelectionActive && !isSelectedTarget;
  const shouldEmphasizeForSelection = isTargetSelectionActive && isSelectedTarget;
  const shouldForceSelectedLabel = shouldEmphasizeForSelection;
  const shouldRenderLabel = !suppressCurveLabels && (Boolean(labelType) || shouldForceSelectedLabel);
  const normalizedTargetNumber = Number(pass?.targetNumber);
  const hasTargetNumber = Number.isFinite(normalizedTargetNumber) && normalizedTargetNumber > 0;
  // Celestial passes carry an assigned mission/body color in `pass.color`; use it when enabled by parent.
  const assignedPassColor = usePassAssignedColor ? normalizeHexColor(pass?.color) : '';

  const passColor = (() => {
    if (assignedPassColor) return assignedPassColor;
    if (pass.isCurrent) return stateTokens.activeStroke;
    if (pass.peak_altitude < 10) return stateTokens.lowStroke;
    if (pass.peak_altitude <= 45) return stateTokens.mediumStroke;
    return stateTokens.highStroke;
  })();
  const estimatedStrokeColor = assignedPassColor || stateTokens.estimatedStroke;
  const estimatedFillColor = assignedPassColor || stateTokens.estimatedFill;

  // Split computed curve into positive-elevation segments.
  const computedPathDataSegments = [];
  if (hasElevationCurve) {
    let beforePoint = null;
    let afterPoint = null;
    const pointsInWindow = [];

    pass.elevation_curve.forEach((point) => {
      const pointTime = new Date(point.time).getTime();
      if (pointTime < chartStartMs) {
        beforePoint = point;
      } else if (pointTime > chartEndMs) {
        if (!afterPoint) afterPoint = point;
      } else {
        pointsInWindow.push(point);
      }
    });

    const allPoints = [
      ...(beforePoint ? [beforePoint] : []),
      ...pointsInWindow,
      ...(afterPoint ? [afterPoint] : []),
    ];

    const curveSegments = [];
    let currentSegment = [];
    allPoints.forEach((point) => {
      if (point.elevation >= 0) {
        currentSegment.push(point);
      } else if (currentSegment.length > 0) {
        curveSegments.push(currentSegment);
        currentSegment = [];
      }
    });
    if (currentSegment.length > 0) curveSegments.push(currentSegment);

    curveSegments.forEach((segment) => {
      const segmentPath = segment.map((point) => {
        const pointTime = new Date(point.time).getTime();
        const clampedPointTime = Math.max(chartStartMs, Math.min(pointTime, chartEndMs));
        const x = ((clampedPointTime - chartStartMs) / totalDuration) * 100;
        const y = elevationToYPercent(point.elevation);
        return `${x},${y}`;
      });
      if (segmentPath.length >= 2) computedPathDataSegments.push(segmentPath);
    });
  }

  // Always build an estimated placeholder shape from pass bounds + peak.
  const passStartTime = new Date(pass.event_start).getTime();
  const passEndTime = new Date(pass.event_end).getTime();
  const clampedStart = Math.max(passStartTime, chartStartMs);
  const clampedEnd = Math.min(passEndTime, chartEndMs);
  const estimatedPathData = clampedEnd > clampedStart
    ? (() => {
      const startX = ((clampedStart - chartStartMs) / totalDuration) * 100;
      const endX = ((clampedEnd - chartStartMs) / totalDuration) * 100;
      const midpointX = (startX + endX) / 2;
      const peakY = elevationToYPercent(pass.peak_altitude || 0);
      const linePath = `M ${startX} 100 Q ${midpointX} ${peakY} ${endX} 100`;
      const fillPath = `${linePath} L ${startX} 100 Z`;
      return { linePath, fillPath };
    })()
    : null;

  if (!estimatedPathData && computedPathDataSegments.length === 0) {
    return null;
  }

  // Find the peak point (highest elevation) for the label
  let peakPoint = null;
  let peakElevation = pass.peak_altitude || -Infinity;

  if (hasElevationCurve) {
    pass.elevation_curve.forEach((point) => {
      const pointTime = new Date(point.time).getTime();
      if (pointTime >= chartStartMs && pointTime <= chartEndMs) {
        if (point.elevation > peakElevation) {
          peakElevation = point.elevation;
          peakPoint = point;
        }
      }
    });
  }

  // Calculate peak position in chart coordinates
  let peakX = null;
  let peakY = null;

  // For geostationary satellites with horizontal distribution
  // Check if this pass was identified as geostationary (geoIndex will be non-null)
  if (geoIndex !== null && totalGeoSats !== null && totalGeoSats > 1) {
    // Distribute horizontally across the timeline, avoiding edges
    // Use 20% margins on each side = 60% usable space
    // Distribute satellites evenly within that space, with additional padding from the margins
    const marginPercent = 20;
    const usableSpacePercent = 60;
    const spacing = usableSpacePercent / (totalGeoSats + 1);
    peakX = marginPercent + (spacing * (geoIndex + 1));
    peakY = elevationToYPercent(peakElevation);
  } else if (geoIndex !== null && totalGeoSats === 1) {
    // Single geostationary satellite - place at center
    peakX = 50;
    peakY = elevationToYPercent(peakElevation);
  } else if (peakPoint) {
    const pointTime = new Date(peakPoint.time).getTime();
    peakX = ((pointTime - chartStartMs) / totalDuration) * 100;
    peakY = elevationToYPercent(peakPoint.elevation);
  } else {
    // Fallback: use middle of pass with peak_altitude
    const passMidpoint = (passStartTime + passEndTime) / 2;
    peakX = ((passMidpoint - chartStartMs) / totalDuration) * 100;
    peakY = elevationToYPercent(pass.peak_altitude || 0);
  }

  return (
    <>
      <svg
        style={{
          position: 'absolute',
          top: `${Y_AXIS_TOP_MARGIN}px`,
          left: `${Y_AXIS_WIDTH}px`,
          width: `calc(100% - ${Y_AXIS_WIDTH}px)`,
          height: `calc(100% - ${X_AXIS_HEIGHT + Y_AXIS_TOP_MARGIN}px)`,
          pointerEvents: 'none',
        }}
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {estimatedPathData && (
          <g
            style={{
              opacity: hasElevationCurve ? 0 : (shouldFadeForSelection ? 0.35 : 1),
              transition: 'opacity 260ms ease-out',
            }}
          >
            <path
              d={estimatedPathData.fillPath}
              fill={estimatedFillColor}
              fillOpacity={
                assignedPassColor
                  ? (
                    isTargetSelectionActive
                      ? (isSelectedTarget ? 0.16 : 0.03)
                      : (highlightActivePasses ? (pass.isCurrent ? 0.14 : 0.08) : 0.12)
                  )
                  : 1
              }
              stroke="none"
              style={{ pointerEvents: 'none' }}
            />
            <path
              d={estimatedPathData.linePath}
              stroke={estimatedStrokeColor}
              strokeWidth="0.7"
              strokeDasharray="2.2,2.2"
              fill="none"
              opacity={
                isTargetSelectionActive
                  ? (isSelectedTarget ? 0.95 : 0.35)
                  : (highlightActivePasses ? (pass.isCurrent ? 0.95 : 0.75) : 0.85)
              }
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: 'none' }}
            />
          </g>
        )}

        {computedPathDataSegments.map((pathData, segmentIndex) => {
          // Create SVG path from points
          const pathString = pathData.map((point, i) => {
            const [x, y] = point.split(',');
            return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
          }).join(' ');

          // Get first and last X coordinates for closing the fill path
          const firstX = pathData[0].split(',')[0];
          const lastX = pathData[pathData.length - 1].split(',')[0];
          const bottomY = 100; // 0° elevation at bottom

          // Create closed path for fill area
          const fillPath = `${pathString} L ${lastX} ${bottomY} L ${firstX} ${bottomY} Z`;

          return (
            <g
              key={segmentIndex}
              style={{
                opacity: hasElevationCurve ? 1 : 0,
                transition: 'opacity 260ms ease-in',
              }}
            >
              {/* Fill area */}
              <path
                d={fillPath}
                fill={passColor}
                fillOpacity={
                  hasElevationCurve
                    ? (
                      isTargetSelectionActive
                        ? (isSelectedTarget ? 0.2 : 0.035)
                        : (highlightActivePasses ? (pass.isCurrent ? 0.16 : 0.09) : 0.14)
                    )
                    : 0
                }
                stroke="none"
                style={{ pointerEvents: 'none' }}
              />
              {/* Stroke line */}
              <path
                d={pathString}
                stroke={passColor}
                strokeWidth={
                  shouldEmphasizeForSelection
                    ? (pass.isCurrent ? '0.95' : '0.8')
                    : (pass.isCurrent ? '0.7' : '0.55')
                }
                strokeDasharray={
                  isTargetSelectionActive
                    ? (isSelectedTarget ? '0' : '2.5,2.5')
                    : (highlightActivePasses ? (pass.isCurrent ? '0' : '2,2') : '0')
                }
                fill="none"
                opacity={
                  isTargetSelectionActive
                    ? (isSelectedTarget ? 1 : 0.3)
                    : (highlightActivePasses ? (pass.isCurrent ? 1 : 0.8) : (pass.isCurrent ? 1 : 0.8))
                }
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: 'none' }}
              />
            </g>
          );
        })}
      </svg>

      {/* Label at peak - force a label for selected target even when labelType is disabled */}
      {shouldRenderLabel && peakX !== null && peakY !== null && (peakElevation >= 0 || shouldForceSelectedLabel) && (() => {
        // Defer dense labels until computed curve is available.
        if (!hasElevationCurve && labelType === 'name' && !shouldForceSelectedLabel) return null;

        // Determine if we should show the label based on elevation threshold
        if (!shouldForceSelectedLabel) {
          if (labelType === 'name' && peakElevation < 25) return null; // Don't show name labels below 25°
          if (labelType === 'peak' && peakElevation < 10) return null; // Don't show peak labels below 10°
        }

        // Determine label content
        let labelContent = '';
        if (labelType === 'name') {
          labelContent = pass.name;
        } else if (labelType === 'peak') {
          labelContent = `${hasElevationCurve ? '' : '~'}${peakElevation.toFixed(0)}°`;
        } else if (shouldForceSelectedLabel) {
          labelContent =
            String(pass?.name || '').trim()
            || String(pass?.target_key || '').trim()
            || String(pass?.command || '').trim()
            || String(pass?.body_id || '').trim()
            || 'Selected target';
        }

        if (!labelContent) return null;

        // Determine label size based on elevation (for 'name' labels)
        let fontSize = '0.7rem';
        if (labelType === 'name' && peakElevation < 45) {
          fontSize = '0.6rem'; // Smaller font for low elevation passes (30-45°)
        }
        const effectiveLabelVerticalOffset = shouldForceSelectedLabel
          ? Math.min(labelVerticalOffset, 112)
          : labelVerticalOffset;

        return (
          <Box
            sx={{
              position: 'absolute',
              left: `calc(${Y_AXIS_WIDTH}px + (100% - ${Y_AXIS_WIDTH}px) * ${peakX / 100})`,
              top: `calc(${Y_AXIS_TOP_MARGIN}px + (100% - ${Y_AXIS_TOP_MARGIN}px - ${X_AXIS_HEIGHT}px) * ${peakY / 100})`,
              transform: `translate(-50%, -${effectiveLabelVerticalOffset}%)`,
              fontSize: fontSize,
              fontWeight: 'bold',
              color: hasElevationCurve ? passColor : estimatedStrokeColor,
              backgroundColor: theme.palette.background.paper,
              padding: '2px',
              borderRadius: '3px',
              border: (pass.isCurrent || shouldEmphasizeForSelection)
                ? `1px solid ${hasElevationCurve ? passColor : estimatedStrokeColor}`
                : 'none',
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
              zIndex: 25,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              opacity: (
                isTargetSelectionActive
                  ? (isSelectedTarget ? 0.95 : 0.32)
                  : (hasElevationCurve ? (highlightActivePasses ? (pass.isCurrent ? 0.9 : 0.5) : 0.9) : 0.7)
              ),
              boxShadow: theme.shadows[1],
              transition: 'opacity 260ms ease-out, color 260ms ease-out, border-color 260ms ease-out',
            }}
          >
            {hasTargetNumber ? (
              <TargetNumberIcon
                targetNumber={normalizedTargetNumber}
                prefix="T"
                size={13}
                sx={{ flexShrink: 0 }}
              />
            ) : null}
            <Box component="span">{labelContent}</Box>
          </Box>
        );
      })()}
    </>
  );
};

/**
 * CurrentTimeMarker component - Renders the NOW marker showing current time
 * Uses CSS transforms and requestAnimationFrame for smooth movement without re-renders
 */
export const CurrentTimeMarker = ({ startTime, endTime }) => {
  const theme = useTheme();
  const { t } = useTranslation('target');

  const markerRef = useRef(null);
  const labelRef = useRef(null);
  const bottomLabelRef = useRef(null);
  const animationFrameRef = useRef(null);

  useEffect(() => {
    const updateMarkerPosition = () => {
      if (!markerRef.current) return;

      const now = Date.now();
      const totalDuration = endTime.getTime() - startTime.getTime();
      const position = ((now - startTime.getTime()) / totalDuration) * 100;

      // Don't render if position is negative (past the left edge)
      if (position < 0) {
        markerRef.current.style.display = 'none';
        if (labelRef.current) labelRef.current.style.display = 'none';
        if (bottomLabelRef.current) bottomLabelRef.current.style.display = 'none';
        animationFrameRef.current = requestAnimationFrame(updateMarkerPosition);
        return;
      }

      markerRef.current.style.display = 'block';
      if (labelRef.current) labelRef.current.style.display = 'block';
      if (bottomLabelRef.current) bottomLabelRef.current.style.display = 'block';

      // Calculate the translateX value to move the marker
      // Base position is Y_AXIS_WIDTH, then add percentage of remaining width
      const translateX = `calc(${Y_AXIS_WIDTH}px + (100% - ${Y_AXIS_WIDTH}px) * ${position / 100})`;

      // Update all elements
      if (markerRef.current) {
        markerRef.current.style.left = translateX;
      }
      if (labelRef.current) {
        labelRef.current.style.left = translateX;
      }
      if (bottomLabelRef.current) {
        bottomLabelRef.current.style.left = translateX;
      }

      // Continue animation
      animationFrameRef.current = requestAnimationFrame(updateMarkerPosition);
    };

    // Start animation loop
    animationFrameRef.current = requestAnimationFrame(updateMarkerPosition);

    // Cleanup
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [startTime, endTime]);

  return (
    <>
      {/* Vertical NOW line */}
      <Box
        ref={markerRef}
        sx={{
          position: 'absolute',
          left: 0, // Will be set by JS
          top: `${Y_AXIS_TOP_MARGIN}px`,
          bottom: `${X_AXIS_HEIGHT}px`,
          width: '1px',
          backgroundColor: theme.palette.error.main,
          zIndex: 20,
          boxShadow: `0 0 8px ${theme.palette.error.main}40`,
          willChange: 'left',
        }}
      />

      {/* NOW label at top, centered on line */}
      <Box
        ref={labelRef}
        sx={{
          position: 'absolute',
          left: 0, // Will be set by JS
          top: `${Y_AXIS_TOP_MARGIN + 3}px`,
          transform: 'translate(-50%, -100%)',
          fontSize: '0.65rem',
          fontWeight: 'bold',
          color: theme.palette.error.main,
          backgroundColor: theme.palette.background.paper,
          padding: '2px 6px',
          borderRadius: '2px',
          border: `1px solid ${theme.palette.error.main}`,
          whiteSpace: 'nowrap',
          zIndex: 20,
          willChange: 'left',
        }}
      >
        {t('timeline.now')}
      </Box>

      {/* Arrow at bottom pointing down */}
      <Box
        ref={bottomLabelRef}
        sx={{
          position: 'absolute',
          left: 0, // Will be set by JS
          bottom: `${X_AXIS_HEIGHT}px`,
          transform: 'translateX(-50%)',
          width: '0',
          height: '0',
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderTop: `8px solid ${theme.palette.error.main}`,
          zIndex: 20,
          filter: `drop-shadow(0 0 4px ${theme.palette.error.main}80)`,
          willChange: 'left',
        }}
      />
    </>
  );
};

/**
 * PassTooltipContent component - Renders tooltip content for a satellite pass
 */
export const PassTooltipContent = ({ pass, isCurrent, timezone = 'UTC' }) => {
  const { t } = useTranslation('target');

  const formatTime = (isoString) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: timezone
    });
  };

  const formatDuration = (durationStr) => {
    const match = durationStr.match(/0:(\d{2}):(\d{2})/);
    if (match) {
      return `${match[1]}m ${match[2]}s`;
    }
    return durationStr;
  };

  return (
    <Box sx={{ p: 1 }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 'bold', mb: 1 }}>
        {pass.name} {isCurrent ? `(${t('timeline.active')})` : ''}
      </Typography>
      <Typography variant="body2">
        {t('timeline.start')}: {formatTime(pass.event_start)}
      </Typography>
      <Typography variant="body2">
        {t('timeline.end')}: {formatTime(pass.event_end)}
      </Typography>
      <Typography variant="body2">
        {t('timeline.duration')}: {formatDuration(pass.duration)}
      </Typography>
      <Typography variant="body2" sx={{ mt: 1 }}>
        {t('timeline.maxElevation')}: {pass.peak_altitude.toFixed(1)}°
      </Typography>
      <Typography variant="body2">
        {t('timeline.minDistance')}: {pass.distance_at_peak.toFixed(0)} km
      </Typography>
    </Box>
  );
};
