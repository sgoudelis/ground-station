import React, { useMemo, useState, useRef } from 'react';
import { Box, Typography, Tooltip, useTheme, IconButton, CircularProgress } from '@mui/material';
import { TitleBar, getClassNamesBasedOnGridEditing } from '../../common/common.jsx';
import { useTranslation } from 'react-i18next';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import RefreshIcon from '@mui/icons-material/Refresh';
import SatelliteAltIcon from '@mui/icons-material/SatelliteAlt';
import SunCalc from 'suncalc';

// Import from extracted modules
import { Y_AXIS_WIDTH, X_AXIS_HEIGHT, Y_AXIS_TOP_MARGIN, ZOOM_FACTOR, elevationToYPercent } from './timeline-constants.jsx';
import { TimelineContainer, TimelineContent, TimelineCanvas, TimelineAxis, ElevationAxis, ElevationLabel, TimeLabel } from './timeline-styles.jsx';
import { PassCurve, CurrentTimeMarker } from './timeline-components.jsx';
import { useTimelineEvents } from './timeline-events.jsx';

const buildPassTargetKey = (pass) => {
  return String(pass?.target_key || '').trim();
};

const PassTimelineComponent = ({
  timeWindowHours: initialTimeWindowHours = 8,
  pastOffsetHours = 0.1, // Hours to offset into the past on initial render (30 minutes)
  showSunShading = true,
  showSunMarkers = true,
  satelliteName = null,
  singlePassMode = false, // New prop: if true, show only the active pass
  passId = null, // New prop: specific pass ID to show (optional, used with singlePassMode)
  showTitleBar = true, // New prop: if false, hide the title bar
  minLabelInterval = null, // New prop: minimum interval between labels in hours (null = auto-calculate)
  passes = [],
  activePass = null,
  gridEditable = false,
  labelType = false, // New prop: 'name' for satellite name, 'peak' for elevation value, false for no labels
  cachedOverride = null, // New prop: override cached flag (for overview page)
  labelVerticalOffset = 150, // New prop: percentage offset for label positioning (higher = further above peak)
  loading = false, // New prop: show loading overlay
  nextPassesHours = null, // New prop: forecast window in hours (null = use initialTimeWindowHours)
  onRefresh = null, // New prop: callback for refresh button
  showHoverElevation = true, // New prop: if true, show elevation label on hover line (false for overview page)
  showGeoToggle = false, // New prop: if true, show toggle button for geostationary satellites (overview only)
  showGeostationarySatellites = true, // New prop: if true, show geostationary satellites
  onToggleGeostationary = null, // New prop: callback for geostationary toggle
  highlightActivePasses = false, // New prop: if true, make active passes solid and inactive passes dashed/less opaque
  highlightTargetKey = '', // New prop: highlight pass curves for one mission/body target key
  highlightSatelliteId = null, // New prop: highlight pass curves for one satellite NORAD id
  usePassAssignedColor = false, // New prop: use pass.color for stroke/fill when available
  forceTimeWindowStart = null, // New prop: force timeline window start (ISO datetime string)
  forceTimeWindowEnd = null, // New prop: force timeline window end (ISO datetime string)
  groundStationLocation = null,
  timezone = 'UTC',
  noTargetsConfigured = false,
}) => {
  const theme = useTheme();
  const { t } = useTranslation('target');
  const normalizedHighlightTargetKey = String(highlightTargetKey || '').trim();
  const hasHighlightedTarget = normalizedHighlightTargetKey.length > 0;
  const normalizedHighlightSatelliteId = String(highlightSatelliteId ?? '').trim();
  const hasHighlightedSatellite = normalizedHighlightSatelliteId.length > 0;
  const hasHighlightedSelection = hasHighlightedTarget || hasHighlightedSatellite;

  // Zoom state: time window configuration
  // If forced time window is provided, use it; otherwise use initialTimeWindowHours
  const [timeWindowHours, setTimeWindowHours] = useState(() => {
    if (forceTimeWindowStart && forceTimeWindowEnd) {
      const forcedStart = new Date(forceTimeWindowStart).getTime();
      const forcedEnd = new Date(forceTimeWindowEnd).getTime();
      const hours = (forcedEnd - forcedStart) / (60 * 60 * 1000);
      return hours;
    }
    return initialTimeWindowHours;
  });

  // Initialize with forced time window start if provided, otherwise use past offset
  const [timeWindowStart, setTimeWindowStart] = useState(() => {
    if (forceTimeWindowStart) {
      const start = new Date(forceTimeWindowStart).getTime();
      return start;
    }
    const now = new Date();
    const start = now.getTime() - (pastOffsetHours * 60 * 60 * 1000);
    return start;
  });

  // Track the actual initial time window hours after adjustment
  const actualInitialTimeWindowHours = useRef(
    forceTimeWindowStart && forceTimeWindowEnd
      ? (new Date(forceTimeWindowEnd).getTime() - new Date(forceTimeWindowStart).getTime()) / (60 * 60 * 1000)
      : initialTimeWindowHours
  );

  // Refs to hold current values for event handlers (to avoid recreating handlers on every change)
  const timeWindowHoursRef = useRef(timeWindowHours);
  const timeWindowStartRef = useRef(timeWindowStart);

  // Update refs when state changes
  React.useEffect(() => {
    timeWindowHoursRef.current = timeWindowHours;
  }, [timeWindowHours]);

  React.useEffect(() => {
    timeWindowStartRef.current = timeWindowStart;
  }, [timeWindowStart]);

  // Update time window when forced values change
  React.useEffect(() => {
    if (forceTimeWindowStart && forceTimeWindowEnd) {
      const forcedStart = new Date(forceTimeWindowStart).getTime();
      const forcedEnd = new Date(forceTimeWindowEnd).getTime();
      const forcedWindowHours = (forcedEnd - forcedStart) / (60 * 60 * 1000);

      setTimeWindowHours(forcedWindowHours);
      setTimeWindowStart(forcedStart);
      actualInitialTimeWindowHours.current = forcedWindowHours;

      // Reset layout stability so ResizeObserver will recalculate with correct forced window values
      isLayoutStableRef.current = false;
      setContainerWidth(null); // Force re-initialization of ResizeObserver
    }
  }, [forceTimeWindowStart, forceTimeWindowEnd]);

  // Mouse hover state
  const [hoverPosition, setHoverPosition] = useState(null);
  const [hoverTime, setHoverTime] = useState(null);

  // Current time state - update periodically to trigger re-renders for active pass highlighting
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Update current time every 30 seconds to refresh active pass highlighting
  React.useEffect(() => {
    if (!highlightActivePasses) return; // Only run if highlighting is enabled

    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 30000); // Update every 30 seconds

    return () => clearInterval(interval);
  }, [highlightActivePasses]);

  // Pan state - use refs to avoid re-renders during panning
  const [isPanning, setIsPanning] = useState(false);
  const panStartXRef = useRef(null);
  const panStartTimeRef = useRef(null);

  // Touch state - use refs to avoid re-renders during touch gestures
  const lastTouchDistanceRef = useRef(null);
  const touchStartTimeRef = useRef(null);
  const touchStartZoomLevelRef = useRef(null);

  // Ref for canvas to attach non-passive touch listeners
  const canvasRef = useRef(null);

  // Track container width to maintain pixels-per-hour ratio on resize
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(null);
  const TARGET_PIXELS_PER_HOUR = 200; // Target scale: 100 pixels per hour
  const pixelsPerHourRef = useRef(TARGET_PIXELS_PER_HOUR);
  const isLayoutStableRef = useRef(false); // Track if layout has stabilized

  // Observe container width changes
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Debounce timer to detect when layout has stabilized
    let stabilizeTimer = null;

    const resizeObserver = new ResizeObserver((entries) => {
      const newWidth = entries[0].contentRect.width;

      // On first measurement, just store the width
      if (containerWidth === null) {
        setContainerWidth(newWidth);

        // Wait for layout to stabilize before locking in the pixels-per-hour ratio
        clearTimeout(stabilizeTimer);
        stabilizeTimer = setTimeout(() => {
          const finalWidth = container.getBoundingClientRect().width;
          // Use current timeWindowHours (which might be from forced window) instead of initialTimeWindowHours
          pixelsPerHourRef.current = finalWidth / timeWindowHours;
          isLayoutStableRef.current = true;
        }, 150); // Wait 150ms for layout to settle
      } else if (isLayoutStableRef.current) {
        // Only adjust time window after layout has stabilized
        // BUT: Don't adjust if forced window is set - just track width changes
        if (forceTimeWindowStart && forceTimeWindowEnd) {
          setContainerWidth(newWidth);
        } else {
          const targetPixelsPerHour = pixelsPerHourRef.current;
          const newTimeWindowHours = newWidth / targetPixelsPerHour;

          // Update time window to maintain the same scale
          setTimeWindowHours(newTimeWindowHours);
          setContainerWidth(newWidth);
        }
      } else {
        // Layout still settling, just update width tracking
        setContainerWidth(newWidth);
      }
    });

    resizeObserver.observe(container);

    return () => {
      clearTimeout(stabilizeTimer);
      resizeObserver.disconnect();
    };
  }, [containerWidth, timeWindowHours]); // Depend on containerWidth and timeWindowHours

  const satellitePasses = Array.isArray(passes) ? passes : [];

  // Adjust initial time window based on actual pass data (only once on mount)
  // Skip this adjustment if nextPassesHours is explicitly provided (e.g., from overview page)
  // Also skip if forced time window is provided
  const [hasAdjustedInitialWindow, setHasAdjustedInitialWindow] = useState(false);
  const lastRequestedTimeWindowHoursRef = useRef(
    nextPassesHours !== null ? Number(nextPassesHours) : Number(initialTimeWindowHours),
  );
  const lastRequestedPastOffsetHoursRef = useRef(Number(pastOffsetHours));

  // Keep internal timeline window state in sync with parent period changes.
  // This is required for celestial period switches (e.g. 6m -> 7d), while preserving
  // forced window behavior used by overview timeline.
  React.useEffect(() => {
    if (forceTimeWindowStart && forceTimeWindowEnd) {
      // Force a re-sync when we later exit forced-window mode.
      lastRequestedTimeWindowHoursRef.current = Number.NaN;
      lastRequestedPastOffsetHoursRef.current = Number.NaN;
      return;
    }

    const requestedWindowHours = nextPassesHours !== null
      ? Number(nextPassesHours)
      : Number(initialTimeWindowHours);
    if (!Number.isFinite(requestedWindowHours) || requestedWindowHours <= 0) {
      return;
    }

    const previousWindowHours = Number(lastRequestedTimeWindowHoursRef.current);
    const requestedPastOffsetHours = Number(pastOffsetHours);
    const previousPastOffsetHours = Number(lastRequestedPastOffsetHoursRef.current);
    if (
      Math.abs(previousWindowHours - requestedWindowHours) < 1e-6
      && Math.abs(previousPastOffsetHours - requestedPastOffsetHours) < 1e-6
    ) {
      return;
    }
    lastRequestedTimeWindowHoursRef.current = requestedWindowHours;
    lastRequestedPastOffsetHoursRef.current = requestedPastOffsetHours;

    const now = Date.now();
    const nextStart = now - (pastOffsetHours * 60 * 60 * 1000);
    setTimeWindowHours(requestedWindowHours);
    setTimeWindowStart(nextStart);
    actualInitialTimeWindowHours.current = requestedWindowHours;
    // Reset resize stabilization so the new period is laid out immediately.
    isLayoutStableRef.current = false;
    setContainerWidth(null);

    // For explicit parent-controlled windows, no one-time auto-adjustment is needed.
    if (nextPassesHours !== null) {
      setHasAdjustedInitialWindow(true);
      return;
    }
    setHasAdjustedInitialWindow(false);
  }, [
    initialTimeWindowHours,
    nextPassesHours,
    pastOffsetHours,
    forceTimeWindowStart,
    forceTimeWindowEnd,
  ]);

  React.useEffect(() => {
    // ALWAYS skip if forced time window is provided (check this first, every time)
    if (forceTimeWindowStart && forceTimeWindowEnd) {
      setHasAdjustedInitialWindow(true);
      return;
    }

    // Don't adjust if nextPassesHours is explicitly provided (overview page scenario)
    if (nextPassesHours !== null) {
      actualInitialTimeWindowHours.current = initialTimeWindowHours;
      setHasAdjustedInitialWindow(true);
      return;
    }

    if (hasAdjustedInitialWindow || !satellitePasses || satellitePasses.length === 0) {
      return;
    }

    // Find the latest pass end time from the data
    const now = Date.now();
    const latestPassEnd = Math.max(...satellitePasses.map(pass => new Date(pass.event_end).getTime()));

    // Start time: now - pastOffsetHours (same as current timeWindowStart)
    const startTime = now - (pastOffsetHours * 60 * 60 * 1000);

    // Calculate hours based on actual data range
    const calculatedHours = (latestPassEnd - startTime) / (60 * 60 * 1000);

    // If calculated hours is less than current timeWindowHours, adjust it to fit data
    if (calculatedHours < timeWindowHours) {
      setTimeWindowHours(calculatedHours);
      actualInitialTimeWindowHours.current = calculatedHours; // Store the adjusted value
    }

    setHasAdjustedInitialWindow(true);
  }, [satellitePasses, pastOffsetHours, timeWindowHours, hasAdjustedInitialWindow, nextPassesHours, initialTimeWindowHours, forceTimeWindowStart, forceTimeWindowEnd]);

  const { timelineData, timeLabels, startTime, endTime, sunData, activePassObj, geoIndices } = useMemo(() => {
    const now = new Date();

    // In single-pass mode, determine the active pass and set time window accordingly
    let activePassObj = null;
    let startTime, endTime;

    if (singlePassMode && satellitePasses && satellitePasses.length > 0) {
      // Find the active pass (either specified by passId or determine current pass)
      if (passId) {
        activePassObj = satellitePasses.find(pass => pass.id === passId);
      } else {
        // Determine current active pass based on current time
        activePassObj = satellitePasses.find(pass => {
          const passStart = new Date(pass.event_start);
          const passEnd = new Date(pass.event_end);
          return now >= passStart && now <= passEnd;
        });
      }

      // If we found an active pass, set time window based on elevation curve time range
      if (activePassObj) {
        // Use elevation curve times if available (includes the 30-minute extension for first pass)
        if (activePassObj.elevation_curve && activePassObj.elevation_curve.length > 0) {
          startTime = new Date(activePassObj.elevation_curve[0].time);
          endTime = new Date(activePassObj.elevation_curve[activePassObj.elevation_curve.length - 1].time);
        } else {
          // Fallback to event times
          startTime = new Date(activePassObj.event_start);
          endTime = new Date(activePassObj.event_end);
        }
      } else {
        // No active pass found, fall back to normal mode
        startTime = timeWindowStart ? new Date(timeWindowStart) : new Date(now);
        endTime = new Date(startTime.getTime() + timeWindowHours * 60 * 60 * 1000);
      }
    } else {
      // Normal mode: use time window configuration
      startTime = timeWindowStart ? new Date(timeWindowStart) : new Date(now);
      endTime = new Date(startTime.getTime() + timeWindowHours * 60 * 60 * 1000);
    }

    // Calculate sun times for the timeline window
    let sunData = { nightPeriods: [], sunEvents: [] };
    if (groundStationLocation && (showSunShading || showSunMarkers)) {
      const { lat, lon } = groundStationLocation;

      const nightPeriods = [];
      const sunEvents = [];

      // Calculate for each day in the timeline window
      // Start from 1 day before to catch night periods that started before the window
      const startDate = new Date(startTime);
      startDate.setDate(startDate.getDate() - 1);
      startDate.setHours(0, 0, 0, 0);

      const endDate = new Date(endTime);
      endDate.setDate(endDate.getDate() + 1);
      endDate.setHours(23, 59, 59, 999);

      let currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        // SunCalc returns times in local timezone
        const sunTimes = SunCalc.getTimes(currentDate, lat, lon);
        const sunrise = sunTimes.sunrise;
        const sunset = sunTimes.sunset;

        // Check if sunrise is valid and within window
        if (sunrise && !isNaN(sunrise.getTime()) && sunrise >= startTime && sunrise <= endTime) {
          sunEvents.push({ time: sunrise.getTime(), type: 'sunrise' });
        }

        // Check if sunset is valid and within window
        if (sunset && !isNaN(sunset.getTime()) && sunset >= startTime && sunset <= endTime) {
          sunEvents.push({ time: sunset.getTime(), type: 'sunset' });
        }

        // Move to next day
        currentDate.setDate(currentDate.getDate() + 1);
      }

      // Sort events by time
      sunEvents.sort((a, b) => a.time - b.time);

      // Build night periods from events
      // Start by checking if we're in night at the start of the timeline
      const firstDayTimes = SunCalc.getTimes(new Date(startTime), lat, lon);
      const isNightAtStart = startTime < firstDayTimes.sunrise || startTime > firstDayTimes.sunset;

      if (isNightAtStart) {
        // Find first sunrise
        const firstSunrise = sunEvents.find(e => e.type === 'sunrise');
        if (firstSunrise) {
          nightPeriods.push({
            start: startTime.getTime(),
            end: firstSunrise.time
          });
        } else {
          // Entire window is night
          nightPeriods.push({
            start: startTime.getTime(),
            end: endTime.getTime()
          });
        }
      }

      // Create night periods between sunset and sunrise events
      for (let i = 0; i < sunEvents.length; i++) {
        if (sunEvents[i].type === 'sunset') {
          // Find next sunrise
          const nextSunrise = sunEvents.slice(i + 1).find(e => e.type === 'sunrise');
          if (nextSunrise) {
            nightPeriods.push({
              start: sunEvents[i].time,
              end: nextSunrise.time
            });
          } else {
            // No more sunrises, night until end of timeline
            nightPeriods.push({
              start: sunEvents[i].time,
              end: endTime.getTime()
            });
          }
        }
      }

      sunData = { nightPeriods, sunEvents };
    }

    if (!satellitePasses || satellitePasses.length === 0) {
      return { timelineData: [], timeLabels: [], startTime, endTime, sunData };
    }

    const totalDuration = endTime.getTime() - startTime.getTime();
    const actualTimeWindowHours = totalDuration / (1000 * 60 * 60); // Convert ms to hours

    // Generate time labels with dynamic interval based on zoom level
    const labels = [];

    if (singlePassMode) {
      // In single-pass mode, calculate label count to prevent overlap
      // Assume average label width is ~70px (for HH:MM format), plus ~30px spacing for safety
      const estimatedLabelWidth = 100; // px - generous spacing to prevent any overlap
      const chartWidthPixels = window.innerWidth * 0.35; // Estimate based on typical popover width (~35% of viewport)
      const availableChartWidth = chartWidthPixels - Y_AXIS_WIDTH; // Subtract Y-axis width
      const maxLabelsByWidth = Math.floor(availableChartWidth / estimatedLabelWidth);

      // Also calculate based on time duration (prefer ~3-5 minute intervals for readability)
      let targetIntervalMinutes;
      if (actualTimeWindowHours <= 0.25) { // <= 15 minutes
        targetIntervalMinutes = 3;
      } else if (actualTimeWindowHours <= 0.5) { // <= 30 minutes
        targetIntervalMinutes = 5;
      } else { // > 30 minutes
        targetIntervalMinutes = 10;
      }
      const targetIntervalHours = targetIntervalMinutes / 60;
      const labelCountByTime = Math.max(3, Math.ceil(actualTimeWindowHours / targetIntervalHours) + 1);

      // Use the minimum of the two calculations to prevent overlap
      const labelCount = Math.max(3, Math.min(maxLabelsByWidth, labelCountByTime, 8)); // Min 3, max 8

      for (let i = 0; i < labelCount; i++) {
        const fraction = i / (labelCount - 1); // 0 to 1
        const time = new Date(startTime.getTime() + fraction * totalDuration);
        const position = fraction * 100;
        labels.push({
          text: time.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            timeZone: timezone
          }),
          position: position
        });
      }
    } else {
      // Normal mode: use dynamic interval based on zoom level
      let labelInterval;

      // If minLabelInterval is specified, use it directly
      if (minLabelInterval !== null) {
        labelInterval = minLabelInterval;
      } else {
        // Auto-calculate based on time window
        if (timeWindowHours <= 0.5) {
          labelInterval = 0.05; // 3 minutes
        } else if (timeWindowHours <= 1) {
          labelInterval = 0.1; // 6 minutes
        } else if (timeWindowHours <= 2) {
          labelInterval = 0.167; // 10 minutes
        } else if (timeWindowHours <= 4) {
          labelInterval = 0.25; // 15 minutes
        } else if (timeWindowHours <= 8) {
          labelInterval = 0.5; // 30 minutes
        } else if (timeWindowHours <= 16) {
          labelInterval = 1; // 1 hour
        } else if (timeWindowHours <= 24) {
          labelInterval = 2; // 2 hours
        } else if (timeWindowHours <= 48) {
          labelInterval = 4; // 4 hours
        } else {
          labelInterval = 6; // 6 hours
        }
      }

      // Calculate container width to determine label format and culling
      const estimatedContainerWidth = containerWidth || window.innerWidth;
      const isMobile = estimatedContainerWidth < 600;
      const minLabelSpacing = isMobile ? 45 : 35; // Minimum pixels between labels (denser on desktop)

      // Determine time format based on screen size (24-hour format)
      const timeFormatOptions = isMobile
        ? { hour: 'numeric', minute: '2-digit', hour12: false, timeZone: timezone } // Compact: "13:00"
        : { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone }; // Full: "13:00"

      // Generate all potential labels
      const potentialLabels = [];
      for (let i = 0; i <= timeWindowHours; i += labelInterval) {
        const time = new Date(startTime.getTime() + i * 60 * 60 * 1000);
        const position = (i / timeWindowHours) * 100; // Position as percentage
        potentialLabels.push({
          text: time.toLocaleTimeString('en-US', timeFormatOptions),
          position: position,
          positionPixels: (position / 100) * estimatedContainerWidth
        });
      }

      // Cull overlapping labels
      let lastLabelPosition = -Infinity;
      for (const label of potentialLabels) {
        if (label.positionPixels - lastLabelPosition >= minLabelSpacing) {
          labels.push(label);
          lastLabelPosition = label.positionPixels;
        }
      }
    }

    // Process passes
    let passesToProcess = satellitePasses;

    // In single-pass mode, only show the active pass
    if (singlePassMode && activePassObj) {
      passesToProcess = [activePassObj];
    }

    const passes = passesToProcess
      .map((pass) => {
        const passStart = new Date(pass.event_start);
        const passEnd = new Date(pass.event_end);

        // Skip passes outside the time window
        if (passEnd < startTime || passStart > endTime) {
          return null;
        }

        // Calculate position and width
        const clampedStart = Math.max(passStart.getTime(), startTime.getTime());
        const clampedEnd = Math.min(passEnd.getTime(), endTime.getTime());

        const left = ((clampedStart - startTime.getTime()) / totalDuration) * 100;
        const width = ((clampedEnd - clampedStart) / totalDuration) * 100;

        // Check if pass is currently active:
        // 1. First check Redux activePass (for single satellite tracking page)
        // 2. Fall back to time-based check: current time is between event_start and event_end
        const nowTime = now.getTime();
        const isCurrent = (activePass && pass.id === activePass.id) ||
                         (nowTime >= passStart.getTime() && nowTime <= passEnd.getTime());
        const passTargetKey = buildPassTargetKey(pass);
        const passNoradId = String(pass?.norad_id ?? '').trim();
        const isSelectedTarget = (
          (hasHighlightedTarget && passTargetKey === normalizedHighlightTargetKey)
          || (hasHighlightedSatellite && passNoradId === normalizedHighlightSatelliteId)
        );

        return {
          ...pass,
          left,
          width,
          isCurrent,
          isSelectedTarget,
        };
      })
      .filter(Boolean);

    // Detect geostationary/geosynchronous satellites
    // These satellites stay above the horizon continuously (first and last points are positive)
    const geoIndices = new Map();
    let geoCounter = 0;

    passes.forEach((pass) => {
      if (pass.elevation_curve && pass.elevation_curve.length > 0) {
        // Check if first and last points in the elevation curve are above horizon
        const firstPoint = pass.elevation_curve[0];
        const lastPoint = pass.elevation_curve[pass.elevation_curve.length - 1];

        if (firstPoint.elevation > 0 && lastPoint.elevation > 0) {
          geoIndices.set(pass.id, geoCounter);
          geoCounter++;
        }
      }
    });

    return {
      timelineData: passes,
      timeLabels: labels,
      startTime,
      endTime,
      sunData,
      activePassObj,
      geoIndices,
    };
  }, [
    satellitePasses,
    activePass,
    timeWindowHours,
    timeWindowStart,
    timezone,
    groundStationLocation,
    showSunShading,
    showSunMarkers,
    singlePassMode,
    passId,
    minLabelInterval,
    currentTime,
    hasHighlightedTarget,
    normalizedHighlightTargetKey,
    hasHighlightedSatellite,
    normalizedHighlightSatelliteId,
  ]);

  // Event handlers
  const {
    handleMouseMove,
    handleMouseLeave,
    handleMouseDown,
    handleMouseUp,
    handleWheel,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    formatHoverTime,
    handleZoomIn,
    handleZoomOut,
    handleResetZoom,
  } = useTimelineEvents({
    isPanning,
    setIsPanning,
    timeWindowHours,
    setTimeWindowHours,
    timeWindowStart,
    setTimeWindowStart,
    timeWindowHoursRef,
    timeWindowStartRef,
    timelineData,
    setHoverPosition,
    setHoverTime,
    initialTimeWindowHours: actualInitialTimeWindowHours.current,
    panStartXRef,
    panStartTimeRef,
    lastTouchDistanceRef,
    touchStartTimeRef,
    touchStartZoomLevelRef,
    timezone,
    startTime,
    endTime,
    pastOffsetHours,
    nextPassesHours: nextPassesHours !== null ? nextPassesHours : actualInitialTimeWindowHours.current,
    forceTimeWindowStart,
    forceTimeWindowEnd,
  });

  // Store handlers in refs that can be updated without recreating listeners
  const handlersRef = useRef({ handleTouchStart, handleTouchMove, handleTouchEnd });

  // Update handlers ref when they change
  React.useEffect(() => {
    handlersRef.current = { handleTouchStart, handleTouchMove, handleTouchEnd };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  // Calculate filtered passes count for display
  const filteredPassesCount = React.useMemo(() => {
    return timelineData.filter((pass) => {
      if (!geoIndices) return true;
      const isGeo = geoIndices.has(pass.id);
      if (isGeo && !showGeostationarySatellites) {
        return false;
      }
      return true;
    }).length;
  }, [timelineData, geoIndices, showGeostationarySatellites]);

  const LONG_WINDOW_MAX_HOURS = 24 * 30;
  const suppressCurveLabels = React.useMemo(
    () => {
      const durationHours = (endTime.getTime() - startTime.getTime()) / (1000 * 60 * 60);
      return Number.isFinite(durationHours) && durationHours > LONG_WINDOW_MAX_HOURS;
    },
    [startTime, endTime],
  );
  const suppressSunEventMarkers = suppressCurveLabels;
  const useCompactSunLabels = React.useMemo(() => {
    if (!showSunMarkers || suppressSunEventMarkers) return false;
    const events = sunData?.sunEvents || [];
    if (events.length < 2) return false;

    const totalDurationMs = endTime.getTime() - startTime.getTime();
    if (!Number.isFinite(totalDurationMs) || totalDurationMs <= 0) return false;

    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
    const availableChartWidthPx = Math.max(0, (containerWidth || viewportWidth) - Y_AXIS_WIDTH);
    if (availableChartWidthPx <= 0) return false;

    // Estimate the rendered width of translated labels and collapse to icon-only when neighbors collide.
    const sunriseLabel = `☀ ${t('timeline.sunrise')}`;
    const sunsetLabel = `☾ ${t('timeline.sunset')}`;
    const averageCharacterWidthPx = 6;
    const labelChromeWidthPx = 14; // label padding + border + small safety margin
    const labelWidthPx = Math.max(sunriseLabel.length, sunsetLabel.length) * averageCharacterWidthPx + labelChromeWidthPx;
    const minSpacingPx = labelWidthPx + 8;

    for (let i = 1; i < events.length; i++) {
      const eventDeltaMs = events[i].time - events[i - 1].time;
      const eventGapPx = (eventDeltaMs / totalDurationMs) * availableChartWidthPx;
      if (eventGapPx < minSpacingPx) {
        return true;
      }
    }

    return false;
  }, [showSunMarkers, suppressSunEventMarkers, sunData, startTime, endTime, containerWidth, t]);

  // Attach non-passive touch event listeners ONCE (stable wrapper functions)
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Wrapper functions that call the latest handlers from ref
    const wrappedTouchStart = (e) => handlersRef.current.handleTouchStart(e);
    const wrappedTouchMove = (e) => handlersRef.current.handleTouchMove(e);
    const wrappedTouchEnd = (e) => handlersRef.current.handleTouchEnd(e);

    // Add touch listeners with { passive: false } to allow preventDefault()
    canvas.addEventListener('touchstart', wrappedTouchStart, { passive: false });
    canvas.addEventListener('touchmove', wrappedTouchMove, { passive: false });
    canvas.addEventListener('touchend', wrappedTouchEnd, { passive: false });

    return () => {
      canvas.removeEventListener('touchstart', wrappedTouchStart);
      canvas.removeEventListener('touchmove', wrappedTouchMove);
      canvas.removeEventListener('touchend', wrappedTouchEnd);
    };
  }, []); // Empty deps - only run once

  return (
    <TimelineContainer>
      {showTitleBar && (
        <TitleBar
          className={getClassNamesBasedOnGridEditing(gridEditable, ["window-title-bar"])}
          sx={{
            bgcolor: 'background.titleBar',
            borderBottom: '1px solid',
            borderColor: 'border.main',
            backdropFilter: 'blur(10px)'
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', height: '100%' }}>
            <Box sx={{display: 'flex', alignItems: 'center', gap: 1, minWidth: 0, flex: 1}}>
              <Typography variant="subtitle2" sx={{
                fontWeight: 'bold',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0
              }}>
                {satelliteName
                  ? `${satelliteName} - passes for the next ${initialTimeWindowHours.toFixed(0)} hours`
                  : `Passes for the next ${initialTimeWindowHours.toFixed(0)} hours`
                }
              </Typography>
              <Typography variant="caption" sx={{
                fontStyle: 'italic',
                color: 'text.secondary',
                opacity: 0.7,
                whiteSpace: 'nowrap',
                flexShrink: 0
              }}>
                ({filteredPassesCount} {filteredPassesCount === 1 ? 'pass' : 'passes'}{cachedOverride ? ', cached' : ''})
              </Typography>
              <Typography variant="caption" sx={{
                fontStyle: 'italic',
                color: 'text.secondary',
                opacity: 0.6,
                whiteSpace: 'nowrap',
                flexShrink: 0
              }}>
                [{startTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone })} - {endTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timezone })}]
              </Typography>
            </Box>
            {!singlePassMode && (
              <Box sx={{ display: 'flex', gap: 0.5 }}>
                {showGeoToggle && geoIndices && geoIndices.size > 0 && (
                  <Tooltip title={showGeostationarySatellites ? "Hide geostationary satellites" : "Show geostationary satellites"}>
                    <span>
                      <IconButton
                        size="small"
                        onClick={onToggleGeostationary}
                        disabled={loading}
                        sx={{
                          padding: '2px',
                          color: showGeostationarySatellites ? theme.palette.primary.main : theme.palette.text.secondary,
                        }}
                      >
                        <SatelliteAltIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                )}
                {onRefresh && (
                  <Tooltip title={t('pass_timeline.refresh_passes_force_recalculate', { defaultValue: 'Refresh passes (force recalculate)' })}>
                    <span>
                      <IconButton
                        size="small"
                        onClick={onRefresh}
                        disabled={loading}
                        sx={{ padding: '2px' }}
                      >
                        <RefreshIcon fontSize="small" />
                      </IconButton>
                    </span>
                  </Tooltip>
                )}
                <Tooltip title={t('timeline.zoomIn')}>
                  <span>
                    <IconButton
                      size="small"
                      onClick={handleZoomIn}
                      disabled={timeWindowHours <= 0.5}
                      sx={{ padding: '2px' }}
                    >
                      <ZoomInIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={t('timeline.zoomOut')}>
                  <span>
                    <IconButton
                      size="small"
                      onClick={handleZoomOut}
                      disabled={
                        forceTimeWindowStart && forceTimeWindowEnd
                          ? timeWindowHours >= ((new Date(forceTimeWindowEnd).getTime() - new Date(forceTimeWindowStart).getTime()) / (60 * 60 * 1000))
                          : timeWindowHours >= actualInitialTimeWindowHours.current
                      }
                      sx={{ padding: '2px' }}
                    >
                      <ZoomOutIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Tooltip title={t('timeline.resetZoom')}>
                  <span>
                    <IconButton
                      size="small"
                      onClick={handleResetZoom}
                      disabled={
                        forceTimeWindowStart && forceTimeWindowEnd
                          ? (
                              timeWindowHours === ((new Date(forceTimeWindowEnd).getTime() - new Date(forceTimeWindowStart).getTime()) / (60 * 60 * 1000)) &&
                              timeWindowStart !== null &&
                              Math.abs(timeWindowStart - new Date(forceTimeWindowStart).getTime()) < 60000
                            )
                          : (
                              timeWindowHours === actualInitialTimeWindowHours.current &&
                              timeWindowStart !== null &&
                              Math.abs(timeWindowStart - (Date.now() - (pastOffsetHours * 60 * 60 * 1000))) < 60000
                            )
                      }
                      sx={{ padding: '2px' }}
                    >
                      <RestartAltIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            )}
          </Box>
        </TitleBar>
      )}
      <TimelineContent ref={containerRef}>
        <TimelineCanvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          sx={{
            cursor: isPanning ? 'grabbing' : 'grab',
            touchAction: 'pan-y', // Allow vertical scrolling, prevent horizontal
          }}
        >
          {/* Container for grid lines - matches chart area only */}
          <Box
            sx={{
              position: 'absolute',
              left: `${Y_AXIS_WIDTH}px`,
              right: 0,
              top: `${Y_AXIS_TOP_MARGIN}px`,
              bottom: `${X_AXIS_HEIGHT}px`,
              pointerEvents: 'none',
              zIndex: 1,
            }}
          >
            {/* Horizontal grid lines at degree positions - using UNIFIED COORDINATE SYSTEM */}
            {[75, 60, 45, 30, 15].map((degree, index) => {
              // Use UNIFIED COORDINATE SYSTEM: elevationToYPercent
              const yPercent = elevationToYPercent(degree);
              // Increasing brightness from 0.1 to 0.3
              const opacity = 0.1 + (index * 0.05);

              return (
                <Box
                  key={degree}
                  sx={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: `${yPercent}%`,
                    height: '0px',
                    borderTop: `1px solid ${theme.palette.grey[500]}`,
                    opacity: opacity,
                    pointerEvents: 'none',
                  }}
                />
              );
            })}
          </Box>

          {/* Sun shading - night periods */}
          {showSunShading && sunData.nightPeriods.map((period, index) => {
            const totalDuration = endTime.getTime() - startTime.getTime();
            const leftPercent = ((period.start - startTime.getTime()) / totalDuration) * 100;
            const widthPercent = ((period.end - period.start) / totalDuration) * 100;

            return (
              <Box
                key={`night-${index}`}
                sx={{
                  position: 'absolute',
                  left: `calc(${Y_AXIS_WIDTH}px + (100% - ${Y_AXIS_WIDTH}px) * ${leftPercent / 100})`,
                  width: `calc((100% - ${Y_AXIS_WIDTH}px) * ${widthPercent / 100})`,
                  top: 0,
                  bottom: `${X_AXIS_HEIGHT}px`,
                  backgroundColor: theme.palette.mode === 'dark' ? 'rgba(0, 0, 0, 0.3)' : 'rgba(0, 0, 0, 0.15)',
                  pointerEvents: 'none',
                  zIndex: 2,
                }}
              />
            );
          })}

          {/* Sun event markers - sunrise/sunset lines */}
          {showSunMarkers && !suppressSunEventMarkers && sunData.sunEvents.map((event, index) => {
            const totalDuration = endTime.getTime() - startTime.getTime();
            const position = ((event.time - startTime.getTime()) / totalDuration) * 100;
            const leftPosition = `calc(${Y_AXIS_WIDTH}px + (100% - ${Y_AXIS_WIDTH}px) * ${position / 100})`;
            const isSunrise = event.type === 'sunrise';
            const color = isSunrise ? '#6b5110' : '#2a5070'; // Very muted dark gold for sunrise, very muted dark steel blue for sunset
            const labelText = useCompactSunLabels
              ? (isSunrise ? '☀' : '☾')
              : (isSunrise ? `☀ ${t('timeline.sunrise')}` : `☾ ${t('timeline.sunset')}`);

            // Always center labels on their vertical lines
            const labelTransform = 'translateX(-50%)';

            return (
              <React.Fragment key={`sun-${index}`}>
                {/* Vertical line */}
                <Box
                  sx={{
                    position: 'absolute',
                    left: leftPosition,
                    top: `${Y_AXIS_TOP_MARGIN}px`,
                    bottom: `${X_AXIS_HEIGHT}px`,
                    width: '2px',
                    backgroundColor: color,
                    opacity: 0.8,
                    pointerEvents: 'none',
                    zIndex: 3,
                  }}
                />
                {/* Label at top */}
                <Box
                  sx={{
                    position: 'absolute',
                    left: leftPosition,
                    top: `${Y_AXIS_TOP_MARGIN - 18}px`,
                    transform: labelTransform,
                    fontSize: '0.65rem',
                    fontWeight: 'bold',
                    color: color,
                    backgroundColor: theme.palette.background.paper,
                    padding: useCompactSunLabels ? '2px 3px' : '2px 4px',
                    borderRadius: '2px',
                    border: `1px solid ${color}`,
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    zIndex: 3,
                    minWidth: useCompactSunLabels ? 'auto' : '60px',
                    textAlign: 'center',
                    opacity: 0.8,
                  }}
                >
                  {labelText}
                </Box>
              </React.Fragment>
            );
          })}

          {/* No data message */}
          {(!satellitePasses || satellitePasses.length === 0 || timelineData.length === 0) && (
            <Box
              sx={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                textAlign: 'center',
                pointerEvents: 'none',
              }}
            >
              <Typography variant="body2" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                {noTargetsConfigured
                  ? 'No targets configured'
                  : (!satellitePasses || satellitePasses.length === 0
                  ? t('timeline.noPassesAvailable')
                  : t('timeline.noPassesForSelected', { hours: timeWindowHours.toFixed(1) }))}
              </Typography>
            </Box>
          )}

          {/* Pass curves */}
          {timelineData
            .filter((pass) => {
              // Filter out geostationary satellites if toggle is off
              if (!geoIndices) return true;
              const isGeo = geoIndices.has(pass.id);
              if (isGeo && !showGeostationarySatellites) {
                return false;
              }
              return true;
            })
            .map((pass) => {
              const geoIndex = geoIndices && geoIndices.has(pass.id) ? geoIndices.get(pass.id) : null;
              const totalGeoSats = geoIndices ? geoIndices.size : 0;

              return (
                <Box
                  key={pass.id}
                  sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    pointerEvents: 'none',
                    zIndex: pass.isSelectedTarget ? 5 : (pass.isCurrent ? 4 : 3),
                  }}
                >
                  <PassCurve
                    pass={pass}
                    startTime={startTime}
                    endTime={endTime}
                    labelType={labelType}
                    suppressCurveLabels={suppressCurveLabels}
                    labelVerticalOffset={labelVerticalOffset}
                    geoIndex={geoIndex}
                    totalGeoSats={totalGeoSats}
                    highlightActivePasses={highlightActivePasses}
                    isTargetSelectionActive={hasHighlightedSelection}
                    usePassAssignedColor={usePassAssignedColor}
                  />
                </Box>
              );
            })}

          {/* Current time marker - only show when satellite passes exist */}
          {satellitePasses && satellitePasses.length > 0 && (
            <CurrentTimeMarker startTime={startTime} endTime={endTime} />
          )}

          {/* Hover indicator */}
          {hoverPosition !== null && (() => {
            const hoverLeft = `calc(${Y_AXIS_WIDTH}px + (100% - ${Y_AXIS_WIDTH}px) * ${hoverPosition.x / 100})`;

            // Calculate Y position for elevation marker on curve
            const elevationYPercent = hoverPosition.elevation !== null
              ? elevationToYPercent(hoverPosition.elevation)
              : null;

            return (
              <>
                {/* Vertical line */}
                <Box
                  sx={{
                    position: 'absolute',
                    left: hoverLeft,
                    top: `${Y_AXIS_TOP_MARGIN}px`,
                    bottom: `${X_AXIS_HEIGHT}px`,
                    width: '1px',
                    borderLeft: `1px solid ${theme.palette.text.secondary}`,
                    opacity: 0.7,
                    pointerEvents: 'none',
                    zIndex: 15,
                  }}
                />
                {/* Time tooltip */}
                <Box
                  sx={{
                    position: 'absolute',
                    left: hoverLeft,
                    top: '5px',
                    transform: 'translateX(-50%)',
                    backgroundColor: theme.palette.background.paper,
                    border: `1px solid ${theme.palette.divider}`,
                    borderRadius: '4px',
                    padding: '4px 8px',
                    fontSize: '0.75rem',
                    fontWeight: 'bold',
                    color: theme.palette.text.primary,
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    zIndex: 25,
                    boxShadow: theme.shadows[2],
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <span>{formatHoverTime(hoverTime)}</span>
                  </Box>
                  {hoverPosition.passName && (
                    <Typography
                      component="div"
                      sx={{
                        fontSize: '0.62rem',
                        lineHeight: 1.1,
                        opacity: 0.8,
                        mt: 0.35,
                      }}
                    >
                      {hoverPosition.passName}
                    </Typography>
                  )}
                </Box>
                {/* Elevation marker on curve */}
                {showHoverElevation && hoverPosition.elevation !== null && elevationYPercent !== null && (
                  <Box
                    sx={{
                      position: 'absolute',
                      left: hoverLeft,
                      top: `calc(${Y_AXIS_TOP_MARGIN}px + (100% - ${Y_AXIS_TOP_MARGIN}px - ${X_AXIS_HEIGHT}px) * ${elevationYPercent / 100})`,
                      transform: 'translate(-50%, -50%)',
                      backgroundColor: theme.palette.background.paper,
                      border: `1px solid ${theme.palette.divider}`,
                      borderRadius: '4px',
                      padding: '4px 8px',
                      fontSize: '0.75rem',
                      fontWeight: 'bold',
                      color: theme.palette.text.primary,
                      whiteSpace: 'nowrap',
                      pointerEvents: 'none',
                      zIndex: 25,
                      boxShadow: theme.shadows[2],
                    }}
                  >
                    {`${hoverPosition.elevation.toFixed(1)}°`}
                  </Box>
                )}
              </>
            );
          })()}

          {/* Elevation axis (Y-axis on left) - using UNIFIED COORDINATE SYSTEM */}
          <ElevationAxis>
            {[90, 75, 60, 45, 30, 15, 0].map((degree) => {
              // Use UNIFIED COORDINATE SYSTEM for positioning
              const yPercent = elevationToYPercent(degree);
              return (
                <ElevationLabel key={degree} sx={{ top: `${yPercent}%` }}>
                  {degree}°
                </ElevationLabel>
              );
            })}
          </ElevationAxis>

          {/* Top corner box (fills gap at top of Y-axis) */}
          <Box
            sx={{
              position: 'absolute',
              left: 0,
              top: 0,
              width: `${Y_AXIS_WIDTH}px`,
              height: `${Y_AXIS_TOP_MARGIN}px`,
              backgroundColor: theme.palette.background.default,
              borderRight: `1px solid ${theme.palette.divider}`,
            }}
          />

          {/* Bottom corner box (fills gap between axes) */}
          <Box
            sx={{
              position: 'absolute',
              left: 0,
              bottom: 0,
              width: `${Y_AXIS_WIDTH}px`,
              height: `${X_AXIS_HEIGHT}px`,
              backgroundColor: theme.palette.background.default,
              borderRight: `1px solid ${theme.palette.divider}`,
            }}
          />

          {/* Time axis */}
          <TimelineAxis sx={{ left: `${Y_AXIS_WIDTH}px`, width: `calc(100% - ${Y_AXIS_WIDTH}px)` }}>
            {timeLabels.map((label, index) => (
              <TimeLabel key={index} sx={{ left: `${label.position}%` }}>
                {label.text}
              </TimeLabel>
            ))}
          </TimelineAxis>
          {/* Loading overlay (timeline canvas only) */}
          {loading && (
            <Box
              sx={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
              }}
            >
              <CircularProgress size={40} thickness={4} />
            </Box>
          )}
        </TimelineCanvas>
      </TimelineContent>
    </TimelineContainer>
  );
};

// Wrap component in React.memo to prevent re-renders from parent when props haven't changed
// This prevents the 2-second satellite position updates from causing timeline re-renders
export const PassTimeline = React.memo(PassTimelineComponent);

export default PassTimeline;
