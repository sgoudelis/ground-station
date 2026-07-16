import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { useUserTimeSettings } from '../../hooks/useUserTimeSettings.jsx';
import { buildTargetKeyFromCelestialRow } from '../target/celestial-target-utils.js';

const PLANET_COLORS = {
    mercury: '#c2b280',
    venus: '#d6b57d',
    earth: '#4f8cff',
    moon: '#cfd8dc',
    mars: '#c04f3d',
    ceres: '#b8b6b0',
    jupiter: '#d2a679',
    io: '#f4e6b3',
    europa: '#d8d8cf',
    ganymede: '#bfae95',
    callisto: '#a89f91',
    saturn: '#d9c188',
    enceladus: '#dbe9f4',
    rhea: '#c9c1b6',
    titan: '#d8b078',
    iapetus: '#b8b0a2',
    uranus: '#76c7c0',
    neptune: '#5a7bd8',
    pluto: '#b79876',
    haumea: '#d8d6e8',
    makemake: '#c88764',
    eris: '#d5e1ef',
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const MIN_ZOOM = 1;
const MAX_ZOOM = 60000;
const WHEEL_COMMIT_DELAY_MS = 180;
const FOCUS_ANIMATION_DURATION_MS = 420;
const DEFAULT_VIEWPORT = { zoom: 18, panX: 0, panY: 0 };
const OFFSCREEN_TARGET_EDGE_INSET_PX = 6;
const OFFSCREEN_TARGET_VISIBILITY_PADDING_PX = 4;
const OFFSCREEN_TARGET_ARROW_LENGTH_PX = 14;
const OFFSCREEN_TARGET_LABEL_GAP_PX = 18;
const OFFSCREEN_TARGET_STAGGER_PX = 14;
const OFFSCREEN_TARGET_LABEL_DEPTH_STEP_PX = 9;
const OFFSCREEN_TARGET_LABEL_SEARCH_STEPS = 7;
const OFFSCREEN_TARGET_LABEL_SAFE_MARGIN_PX = 2;
const OFFSCREEN_TARGET_NORTH_LABEL_BIAS_PX = 8;
const OFFSCREEN_TARGET_NORTH_ARROW_BIAS_PX = 20;
const LABEL_EDGE_CENTER_OFFSET_PX = 40;
const MAX_BACKGROUND_RING_RADIUS_PX = 12000;
const MAX_ZONE_LABEL_RADIUS_PX = 3600;
const AU_IN_KM = 149597870.7;
const KM_TO_MI = 0.621371192;
const GALACTIC_CENTER_ECLIPTIC_LONGITUDE_DEG = 266.85;
const GALACTIC_CENTER_DIRECTION_DISTANCE_PX = 10000;
const GALACTIC_CENTER_COLOR_DARK = '#D97AA8';
const GALACTIC_CENTER_COLOR_LIGHT = '#A84E78';
const STARFIELD_MIN_ALPHA = 0.035;
const STARFIELD_MAX_ALPHA = 0.42;
const STARFIELD_ALPHA_MULTIPLIER = 1.8;
const STARFIELD_COLOR_STOPS = [
    { bv: -0.35, rgb: [170, 205, 255] },
    { bv: 0, rgb: [215, 228, 255] },
    { bv: 0.45, rgb: [255, 244, 214] },
    { bv: 0.9, rgb: [255, 216, 174] },
    { bv: 1.6, rgb: [255, 176, 124] },
];
const ASSET_BASE_URL = import.meta.env.BASE_URL || '/';
const NORMALIZED_ASSET_BASE_URL = ASSET_BASE_URL.endsWith('/') ? ASSET_BASE_URL : `${ASSET_BASE_URL}/`;
const STARFIELD_CATALOG_URL = `${NORMALIZED_ASSET_BASE_URL}assets/astronomy/stars-bright-v1.json`;
const IMPERIAL_DISTANCE_REGIONS = new Set(['US', 'LR', 'MM']);
const TARGET_SLOT_BADGE_SCALE = 0.81;
const TARGET_SLOT_BADGE_HORIZONTAL_PADDING_PX = 2.5;
const TARGET_SLOT_BADGE_FONT_HEIGHT_RATIO = 0.8;
const DEFAULT_DISPLAY_OPTIONS = {
    showGrid: true,
    showPlanets: true,
    showPlanetLabels: true,
    showPlanetOrbits: true,
    showTrackedObjects: true,
    showTrackedOrbits: true,
    showTrackedLabels: true,
    showStarfieldBackground: true,
    showAsteroidZones: true,
    showZoneLabels: true,
    showResonanceMarkers: true,
    showTimestamp: true,
    showScaleIndicator: true,
    showGestureHint: true,
};
const normalizeViewport = (viewport) => ({
    zoom: clamp(Number(viewport?.zoom ?? DEFAULT_VIEWPORT.zoom), MIN_ZOOM, MAX_ZOOM),
    panX: Number(viewport?.panX ?? DEFAULT_VIEWPORT.panX) || 0,
    panY: Number(viewport?.panY ?? DEFAULT_VIEWPORT.panY) || 0,
});
const formatAu = (value) => {
    if (value >= 1) return `${value.toFixed(value >= 10 ? 0 : 1)} AU`;
    return `${value.toFixed(2)} AU`;
};
const resolveGridStepAu = (zoom) => (
    zoom > 80 ? 0.5 : zoom > 30 ? 1 : zoom > 12 ? 2 : 5
);
const resolveLocaleRegion = (localeTag) => {
    const normalized = String(localeTag || '').trim();
    if (!normalized) return '';

    try {
        if (typeof Intl !== 'undefined' && Intl.Locale) {
            const locale = new Intl.Locale(normalized);
            const expanded = locale.maximize();
            return String(expanded?.region || locale?.region || '').toUpperCase();
        }
    } catch {
        // Fallback parsing handles malformed/unsupported locale tags.
    }

    const [, regionPart = ''] = normalized.replace('_', '-').split('-');
    return String(regionPart || '').toUpperCase();
};
const resolveDistanceUnitFromLocale = (localeTag) => {
    const region = resolveLocaleRegion(localeTag);
    return IMPERIAL_DISTANCE_REGIONS.has(region) ? 'mi' : 'km';
};
const hexToRgba = (hex, alpha) => {
    const value = String(hex || '').trim().replace('#', '');
    if (!/^[0-9a-fA-F]{6}$/.test(value)) return `rgba(120,150,190,${alpha})`;
    const r = Number.parseInt(value.slice(0, 2), 16);
    const g = Number.parseInt(value.slice(2, 4), 16);
    const b = Number.parseInt(value.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
};
const resolveStarRgba = (bv, alpha) => {
    const normalizedBv = Number.isFinite(Number(bv)) ? Number(bv) : 0.65;
    const stops = STARFIELD_COLOR_STOPS;
    let lower = stops[0];
    let upper = stops[stops.length - 1];

    for (let index = 0; index < stops.length - 1; index += 1) {
        if (normalizedBv >= stops[index].bv && normalizedBv <= stops[index + 1].bv) {
            lower = stops[index];
            upper = stops[index + 1];
            break;
        }
    }

    if (normalizedBv <= stops[0].bv) {
        lower = stops[0];
        upper = stops[0];
    } else if (normalizedBv >= stops[stops.length - 1].bv) {
        lower = stops[stops.length - 1];
        upper = stops[stops.length - 1];
    }

    const span = upper.bv - lower.bv;
    const fraction = span > 0 ? clamp((normalizedBv - lower.bv) / span, 0, 1) : 0;
    const rgb = lower.rgb.map((channel, index) => Math.round(
        channel + (upper.rgb[index] - channel) * fraction,
    ));
    return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
};
const resolveTrackedColor = (body, fallbackHex) => {
    const value = String(body?.color || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(value)) {
        return value;
    }
    return fallbackHex;
};
const ASTEROID_ZONE_FALLBACK_COLORS = {
    imb: '#4F8CFF',
    mmb: '#4FC3A1',
    omb: '#E0A458',
    tjn: '#D97AA8',
    kuiper: '#5EC8E5',
    scattered: '#8BA6FF',
};
const resolveAsteroidZoneColor = (zone) => {
    if (zone?.color_hex) return zone.color_hex;

    const normalizedId = String(zone?.id || '').trim().toLowerCase();
    if (ASTEROID_ZONE_FALLBACK_COLORS[normalizedId]) {
        return ASTEROID_ZONE_FALLBACK_COLORS[normalizedId];
    }

    const normalizedClass = String(zone?.class_code || '').trim().toLowerCase();
    if (ASTEROID_ZONE_FALLBACK_COLORS[normalizedClass]) {
        return ASTEROID_ZONE_FALLBACK_COLORS[normalizedClass];
    }

    const normalizedName = String(zone?.name || '').trim().toLowerCase();
    if (normalizedName.includes('inner')) return ASTEROID_ZONE_FALLBACK_COLORS.imb;
    if (normalizedName.includes('middle')) return ASTEROID_ZONE_FALLBACK_COLORS.mmb;
    if (normalizedName.includes('outer')) return ASTEROID_ZONE_FALLBACK_COLORS.omb;
    if (normalizedName.includes('trojan')) return ASTEROID_ZONE_FALLBACK_COLORS.tjn;
    if (normalizedName.includes('kuiper')) return ASTEROID_ZONE_FALLBACK_COLORS.kuiper;
    if (normalizedName.includes('scattered')) return ASTEROID_ZONE_FALLBACK_COLORS.scattered;
    return '#7F9CB8';
};
const getTwoPointerGesture = (pointerMap) => {
    if (pointerMap.size < 2) return null;
    const points = Array.from(pointerMap.values());
    const p1 = points[0];
    const p2 = points[1];
    const centerX = (p1.x + p2.x) / 2;
    const centerY = (p1.y + p2.y) / 2;
    const distance = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    return {
        centerX,
        centerY,
        distance,
    };
};
const hasFiniteXYZ = (position) =>
    Array.isArray(position)
    && position.length >= 3
    && Number.isFinite(Number(position[0]))
    && Number.isFinite(Number(position[1]))
    && Number.isFinite(Number(position[2]));

const normalizeBodyId = (value) => String(value || '').trim().toLowerCase();

const computeMedian = (values) => {
    const sorted = values
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[middle];
    return (sorted[middle - 1] + sorted[middle]) / 2;
};

const computeParentRelativeRadiusAu = (moon, parent) => {
    if (!hasFiniteXYZ(moon?.position_xyz_au) || !hasFiniteXYZ(parent?.position_xyz_au)) {
        return null;
    }

    const radii = [];
    const moonSamples = Array.isArray(moon?.orbit_samples_xyz_au) ? moon.orbit_samples_xyz_au : [];
    const parentSamples = Array.isArray(parent?.orbit_samples_xyz_au) ? parent.orbit_samples_xyz_au : [];
    const moonTimes = Array.isArray(moon?.orbit_sample_times_utc) ? moon.orbit_sample_times_utc : [];
    const parentTimes = Array.isArray(parent?.orbit_sample_times_utc) ? parent.orbit_sample_times_utc : [];

    if (moonSamples.length >= 2 && parentSamples.length >= 2) {
        if (moonTimes.length && parentTimes.length) {
            const parentSampleByTime = new Map();
            parentTimes.forEach((time, index) => {
                if (hasFiniteXYZ(parentSamples[index])) {
                    parentSampleByTime.set(String(time), parentSamples[index]);
                }
            });
            moonTimes.forEach((time, index) => {
                const moonSample = moonSamples[index];
                const parentSample = parentSampleByTime.get(String(time));
                if (!hasFiniteXYZ(moonSample) || !hasFiniteXYZ(parentSample)) return;
                radii.push(Math.hypot(
                    Number(moonSample[0]) - Number(parentSample[0]),
                    Number(moonSample[1]) - Number(parentSample[1]),
                ));
            });
        } else if (moonSamples.length === parentSamples.length) {
            moonSamples.forEach((moonSample, index) => {
                const parentSample = parentSamples[index];
                if (!hasFiniteXYZ(moonSample) || !hasFiniteXYZ(parentSample)) return;
                radii.push(Math.hypot(
                    Number(moonSample[0]) - Number(parentSample[0]),
                    Number(moonSample[1]) - Number(parentSample[1]),
                ));
            });
        }
    }

    const sampledRadius = computeMedian(radii.filter((radius) => radius > 0));
    if (Number.isFinite(sampledRadius) && sampledRadius > 0) {
        return sampledRadius;
    }

    const currentRadius = Math.hypot(
        Number(moon.position_xyz_au[0]) - Number(parent.position_xyz_au[0]),
        Number(moon.position_xyz_au[1]) - Number(parent.position_xyz_au[1]),
    );
    return Number.isFinite(currentRadius) && currentRadius > 0 ? currentRadius : null;
};

const HELIOCENTRIC_ORIGIN_EPSILON_AU = 1e-9;
const SUN_LABEL_SINGLE_MODE_OFFSET_PX = 5;
const isNearHeliocentricOriginXYZ = (position) => {
    if (!hasFiniteXYZ(position)) return false;
    return (
        Math.abs(Number(position[0])) <= HELIOCENTRIC_ORIGIN_EPSILON_AU
        && Math.abs(Number(position[1])) <= HELIOCENTRIC_ORIGIN_EPSILON_AU
        && Math.abs(Number(position[2])) <= HELIOCENTRIC_ORIGIN_EPSILON_AU
    );
};

const isRenderableSolarBody = (body) => {
    const id = String(body?.id || '').trim().toLowerCase();
    if (id === 'sun') return true;
    const position = body?.position_xyz_au;
    return hasFiniteXYZ(position) && !isNearHeliocentricOriginXYZ(position);
};
const isSunLabelTarget = (body) => {
    const id = String(body?.id || '').trim().toLowerCase();
    const bodyId = String(body?.body_id || '').trim().toLowerCase();
    const command = String(body?.command || '').trim().toLowerCase();
    const name = String(body?.name || '').trim().toLowerCase();
    return id === 'sun' || bodyId === 'sun' || command === 'sun' || name === 'sun';
};

const hasFiniteXY = (position) =>
    Array.isArray(position)
    && position.length >= 2
    && Number.isFinite(Number(position[0]))
    && Number.isFinite(Number(position[1]));

const resolveTargetKey = (body) => {
    return buildTargetKeyFromCelestialRow(body);
};

const resolvePastSegmentEndIndex = (samples, sampleTimesUtc, sceneTimestampUtc) => {
    if (!Array.isArray(samples) || samples.length < 2) return -1;
    if (!Array.isArray(sampleTimesUtc) || sampleTimesUtc.length < 2) return -1;

    const epochMs = Date.parse(String(sceneTimestampUtc || ''));
    if (!Number.isFinite(epochMs)) return -1;

    const limit = Math.min(samples.length, sampleTimesUtc.length);
    let lastPastIndex = -1;
    for (let index = 0; index < limit; index += 1) {
        const sampleTimeMs = Date.parse(String(sampleTimesUtc[index] || ''));
        if (!Number.isFinite(sampleTimeMs)) continue;
        if (sampleTimeMs <= epochMs) {
            lastPastIndex = index;
        } else {
            break;
        }
    }

    return lastPastIndex >= 1 ? lastPastIndex : -1;
};

const formatSignedTimeOffset = (deltaMs) => {
    if (!Number.isFinite(deltaMs)) return '';

    const sign = deltaMs >= 0 ? '+' : '-';
    const absoluteMs = Math.abs(deltaMs);
    const absoluteMinutes = absoluteMs / (60 * 1000);
    if (absoluteMinutes < 90) {
        return `${sign}${Math.round(absoluteMinutes)}m`;
    }

    const absoluteHours = absoluteMs / (60 * 60 * 1000);
    if (absoluteHours < 72) {
        return `${sign}${Math.round(absoluteHours)}h`;
    }

    const absoluteDays = absoluteMs / (24 * 60 * 60 * 1000);
    const dayPrecision = absoluteDays < 10 ? 1 : 0;
    return `${sign}${absoluteDays.toFixed(dayPrecision)}d`;
};

const computeSelectedPathTimeCallouts = ({
    selectedTargetKeySet,
    tracked,
    renderablePlanets,
    sceneTimestampUtc,
    themeMode,
}) => {
    if (!(selectedTargetKeySet instanceof Set) || selectedTargetKeySet.size !== 1) return null;
    const selectedTargetKey = Array.from(selectedTargetKeySet)[0];
    const normalizedSelectedTargetKey = String(selectedTargetKey || '').trim().toLowerCase();
    if (normalizedSelectedTargetKey === 'body:sun' || normalizedSelectedTargetKey === 'mission:sun') {
        return null;
    }
    const epochMs = Date.parse(String(sceneTimestampUtc || ''));
    if (!Number.isFinite(epochMs)) return null;

    let selectedPath = null;
    const selectedTracked = (Array.isArray(tracked) ? tracked : [])
        .find((body) => resolveTargetKey(body) === selectedTargetKey);
    if (selectedTracked) {
        if (isSunLabelTarget(selectedTracked)) return null;
        const trackedSamples = Array.isArray(selectedTracked.orbit_samples_xyz_au)
            ? selectedTracked.orbit_samples_xyz_au
            : [];
        if (trackedSamples.length >= 2) {
            const trackedHexColor = resolveTrackedColor(
                selectedTracked,
                selectedTracked?.stale ? '#EF476F' : '#06D6A0',
            );
            selectedPath = {
                source: 'tracked',
                samples: trackedSamples,
                sampleTimesUtc: Array.isArray(selectedTracked.orbit_sample_times_utc)
                    ? selectedTracked.orbit_sample_times_utc
                    : [],
                color: hexToRgba(trackedHexColor, 0.88),
            };
        }
    }

    if (!selectedPath && String(selectedTargetKey).startsWith('body:')) {
        const selectedBodyId = String(selectedTargetKey).slice('body:'.length).trim().toLowerCase();
        if (selectedBodyId === 'sun') return null;
        const selectedBody = (Array.isArray(renderablePlanets) ? renderablePlanets : [])
            .find((body) => String(body?.id || '').trim().toLowerCase() === selectedBodyId);
        const bodySamples = Array.isArray(selectedBody?.orbit_samples_xyz_au)
            ? selectedBody.orbit_samples_xyz_au
            : [];
        if (selectedBody && bodySamples.length >= 2) {
            const bodyHex = PLANET_COLORS[selectedBodyId] || '#bcbcc7';
            selectedPath = {
                source: 'planet',
                samples: bodySamples,
                sampleTimesUtc: Array.isArray(selectedBody.orbit_sample_times_utc)
                    ? selectedBody.orbit_sample_times_utc
                    : [],
                color: hexToRgba(bodyHex, themeMode === 'dark' ? 0.76 : 0.84),
            };
        }
    }

    if (!selectedPath) return null;
    const { source, samples, sampleTimesUtc, color } = selectedPath;
    if (!Array.isArray(sampleTimesUtc) || sampleTimesUtc.length < 2) return null;

    const pastSegmentEndIndex = resolvePastSegmentEndIndex(samples, sampleTimesUtc, sceneTimestampUtc);
    const lastSampleIndex = samples.length - 1;
    const callouts = [];

    if (pastSegmentEndIndex >= 1) {
        const pastStartTimeMs = Date.parse(String(sampleTimesUtc[0] || ''));
        if (Number.isFinite(pastStartTimeMs)) {
            callouts.push({
                sampleIndex: 0,
                text: formatSignedTimeOffset(pastStartTimeMs - epochMs),
                sideHint: 'past',
            });
        }
    }

    const futureStartIndex = pastSegmentEndIndex >= 1 ? pastSegmentEndIndex + 1 : 0;
    if (lastSampleIndex >= futureStartIndex) {
        const futureEndTimeMs = Date.parse(String(sampleTimesUtc[lastSampleIndex] || ''));
        if (Number.isFinite(futureEndTimeMs)) {
            callouts.push({
                sampleIndex: lastSampleIndex,
                text: formatSignedTimeOffset(futureEndTimeMs - epochMs),
                sideHint: 'future',
            });
        }
    }

    if (!callouts.length) return null;
    return { source, samples, color, callouts };
};

const drawArrowHead = (ctx, fromX, fromY, toX, toY, color) => {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const length = Math.hypot(dx, dy);
    if (length < 0.01) return;

    const ux = dx / length;
    const uy = dy / length;
    const arrowLength = 8;
    const arrowWidth = 5;
    const baseX = toX - ux * arrowLength;
    const baseY = toY - uy * arrowLength;
    const perpX = -uy;
    const perpY = ux;

    ctx.beginPath();
    ctx.moveTo(toX, toY);
    ctx.lineTo(baseX + perpX * arrowWidth, baseY + perpY * arrowWidth);
    ctx.lineTo(baseX - perpX * arrowWidth, baseY - perpY * arrowWidth);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
};
const drawTextOnArc = (ctx, text, cx, cy, radius, centerAngle, style = {}) => {
    const value = String(text || '');
    if (!value || radius <= 0) return;

    const {
        font = '10px monospace',
        color = 'rgba(220,230,240,0.42)',
        clockwise = true,
    } = style;

    ctx.save();
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const chars = Array.from(value);
    const charWidths = chars.map((char) => Math.max(1, ctx.measureText(char).width));
    const totalArc = charWidths.reduce((sum, width) => sum + (width / radius), 0);
    let angle = centerAngle - totalArc / 2;

    chars.forEach((char, index) => {
        const charArc = charWidths[index] / radius;
        const charAngle = angle + charArc / 2;
        const x = cx + radius * Math.cos(charAngle);
        const y = cy + radius * Math.sin(charAngle);

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(charAngle + (clockwise ? Math.PI / 2 : -Math.PI / 2));
        ctx.fillText(char, 0, 0);
        ctx.restore();

        angle += charArc;
    });

    ctx.restore();
};
const isPointInsideViewport = (x, y, width, height, padding = 0) => (
    x >= padding
    && x <= (width - padding)
    && y >= padding
    && y <= (height - padding)
);
const projectToViewportEdge = ({
    fromX,
    fromY,
    toX,
    toY,
    minX,
    minY,
    maxX,
    maxY,
}) => {
    const dx = toX - fromX;
    const dy = toY - fromY;
    if (Math.abs(dx) < 0.0001 && Math.abs(dy) < 0.0001) return null;

    const tx = Math.abs(dx) < 0.0001 ? Infinity : (dx > 0 ? (maxX - fromX) / dx : (minX - fromX) / dx);
    const ty = Math.abs(dy) < 0.0001 ? Infinity : (dy > 0 ? (maxY - fromY) / dy : (minY - fromY) / dy);
    const t = Math.min(tx, ty);
    if (!Number.isFinite(t) || t <= 0) return null;

    return {
        x: fromX + dx * t,
        y: fromY + dy * t,
    };
};

const SolarSystemCanvas = ({
    scene,
    selectedTargetKeys = [],
    targetNumberByTargetKey = {},
    fitAllSignal = 0,
    focusTargetSignal = 0,
    focusTargetKey = '',
    instantFocus = false,
    zoomInSignal = 0,
    zoomOutSignal = 0,
    resetZoomSignal = 0,
    centerSunSignal = 0,
    initialViewport = null,
    enableMapDragging = true,
    enableMapZooming = true,
    onViewportCommit = null,
    onStatusBarInfoChange = null,
    displayOptions = DEFAULT_DISPLAY_OPTIONS,
}) => {
    const theme = useTheme();
    const { i18n, t } = useTranslation('celestial');
    const { locale } = useUserTimeSettings();
    const containerRef = useRef(null);
    const canvasRef = useRef(null);
    const wheelCommitTimeoutRef = useRef(null);
    const viewportAnimationRef = useRef(null);
    const lastFitSignalRef = useRef(fitAllSignal);
    const lastFocusTargetSignalRef = useRef(focusTargetSignal);
    const lastZoomInSignalRef = useRef(zoomInSignal);
    const lastZoomOutSignalRef = useRef(zoomOutSignal);
    const lastResetZoomSignalRef = useRef(resetZoomSignal);
    const lastCenterSunSignalRef = useRef(centerSunSignal);
    const hasPersistentViewportRef = useRef(!!initialViewport);
    const viewportRef = useRef(DEFAULT_VIEWPORT);
    const activePointersRef = useRef(new Map());
    const gestureRef = useRef({
        mode: null,
        lastCenterX: 0,
        lastCenterY: 0,
        lastDistance: 0,
    });
    const touchGestureRef = useRef({
        active: false,
        lastCenterX: 0,
        lastCenterY: 0,
        lastDistance: 0,
    });

    const [viewport, setViewport] = useState(() => normalizeViewport(initialViewport || DEFAULT_VIEWPORT));
    const [starCatalog, setStarCatalog] = useState(null);
    const [starCatalogLoadFailed, setStarCatalogLoadFailed] = useState(false);
    const isDragInteractionEnabled = Boolean(enableMapDragging);
    const isZoomInteractionEnabled = Boolean(enableMapZooming);
    const effectiveLocale = useMemo(
        () => locale || (typeof navigator !== 'undefined' ? navigator.language : undefined),
        [locale],
    );
    const distanceUnit = useMemo(
        () => resolveDistanceUnitFromLocale(effectiveLocale),
        [effectiveLocale],
    );
    const compactLanguageLocale = useMemo(
        () => i18n?.resolvedLanguage || i18n?.language || effectiveLocale,
        [i18n?.language, i18n?.resolvedLanguage, effectiveLocale],
    );
    const formatDistanceLabel = useMemo(() => {
        const compactOptions = {
            notation: 'compact',
            compactDisplay: 'short',
            maximumFractionDigits: 1,
        };
        const standardOptions = {
            maximumFractionDigits: 1,
        };

        const buildNumberFormatter = (options) => {
            try {
                return new Intl.NumberFormat(effectiveLocale, options);
            } catch {
                return new Intl.NumberFormat(undefined, options);
            }
        };

        const compactFormatter = (() => {
            try {
                return new Intl.NumberFormat(compactLanguageLocale, compactOptions);
            } catch {
                return buildNumberFormatter(compactOptions);
            }
        })();
        const standardFormatter = buildNumberFormatter(standardOptions);
        return (distanceKm) => {
            const normalizedDistanceKm = Number(distanceKm);
            if (!Number.isFinite(normalizedDistanceKm)) return '';
            const converted = Math.max(0, normalizedDistanceKm) * (distanceUnit === 'mi' ? KM_TO_MI : 1);
            const numberText = converted >= 10000
                ? compactFormatter.format(converted)
                : standardFormatter.format(converted);
            return `${numberText} ${distanceUnit}`;
        };
    }, [compactLanguageLocale, distanceUnit, effectiveLocale]);

    const planets = scene?.planets || [];
    const renderablePlanets = useMemo(
        () => (Array.isArray(planets) ? planets.filter((body) => isRenderableSolarBody(body)) : []),
        [planets],
    );
    const tracked = scene?.celestial || [];
    const hasTrackedRows = Array.isArray(tracked) && tracked.length > 0;
    const selectedTargetKeySet = useMemo(
        () => new Set((selectedTargetKeys || []).map((value) => String(value || '').trim()).filter(Boolean)),
        [selectedTargetKeys],
    );
    const hasTrackedSelection = selectedTargetKeySet.size > 0;
    const isSingleTrackedMode = (hasTrackedSelection && selectedTargetKeySet.size === 1)
        || (Array.isArray(tracked) && tracked.length === 1);
    const asteroidZones = scene?.asteroid_zones || [];
    const asteroidResonanceGaps = scene?.asteroid_resonance_gaps || [];
    const moonOrbitRings = useMemo(() => {
        if (!Array.isArray(renderablePlanets) || renderablePlanets.length === 0) return [];

        const bodyById = new Map();
        renderablePlanets.forEach((body) => {
            const bodyId = normalizeBodyId(body?.id);
            if (!bodyId) return;
            bodyById.set(bodyId, body);
        });

        const rings = renderablePlanets
            .filter((body) => normalizeBodyId(body?.body_type) === 'moon')
            .map((moon) => {
                const moonId = normalizeBodyId(moon?.id);
                const parentId = normalizeBodyId(moon?.parent_id || moon?.parent_body_id);
                if (!moonId || !parentId) return null;

                const parent = bodyById.get(parentId);
                if (!parent || !hasFiniteXYZ(parent.position_xyz_au)) return null;

                const radiusAu = computeParentRelativeRadiusAu(moon, parent);
                if (!Number.isFinite(radiusAu) || radiusAu <= 0) return null;

                return {
                    key: `${parentId}:${moonId}`,
                    parentId,
                    moonId,
                    parentPositionXyAu: [
                        Number(parent.position_xyz_au[0]),
                        Number(parent.position_xyz_au[1]),
                    ],
                    radiusAu,
                    color: PLANET_COLORS[moonId] || PLANET_COLORS.moon || '#cfd8dc',
                };
            })
            .filter(Boolean);

        rings.sort((a, b) => {
            if (a.parentId === b.parentId) return a.radiusAu - b.radiusAu;
            return a.parentId.localeCompare(b.parentId);
        });
        return rings;
    }, [renderablePlanets]);
    const effectiveDisplayOptions = {
        ...DEFAULT_DISPLAY_OPTIONS,
        ...(displayOptions || {}),
    };

    useEffect(() => {
        if (!effectiveDisplayOptions.showStarfieldBackground || starCatalog || starCatalogLoadFailed) return undefined;

        const controller = new AbortController();
        fetch(STARFIELD_CATALOG_URL, { signal: controller.signal })
            .then((response) => {
                if (!response.ok) {
                    throw new Error(`Failed to load star catalog: ${response.status}`);
                }
                return response.json();
            })
            .then((payload) => {
                if (!Array.isArray(payload?.stars)) {
                    throw new Error('Star catalog payload is missing a stars array');
                }
                setStarCatalog(payload);
            })
            .catch((error) => {
                if (error?.name !== 'AbortError') {
                    setStarCatalogLoadFailed(true);
                }
            });

        return () => controller.abort();
    }, [effectiveDisplayOptions.showStarfieldBackground, starCatalog, starCatalogLoadFailed]);

    const commitViewport = useCallback((nextViewport) => {
        hasPersistentViewportRef.current = true;
        if (onViewportCommit) {
            onViewportCommit(normalizeViewport(nextViewport));
        }
    }, [onViewportCommit]);

    const cancelViewportAnimation = useCallback(() => {
        if (viewportAnimationRef.current !== null) {
            window.cancelAnimationFrame(viewportAnimationRef.current);
            viewportAnimationRef.current = null;
        }
    }, []);

    const animateViewportTo = useCallback((nextViewport, durationMs = FOCUS_ANIMATION_DURATION_MS) => {
        cancelViewportAnimation();
        const target = normalizeViewport(nextViewport);
        const start = viewportRef.current;
        const duration = Math.max(80, Number(durationMs) || FOCUS_ANIMATION_DURATION_MS);
        const startedAt = performance.now();
        const easeInOutCubic = (t) =>
            t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;

        const tick = (now) => {
            const elapsed = now - startedAt;
            const progress = Math.min(1, elapsed / duration);
            const eased = easeInOutCubic(progress);
            const interpolated = {
                zoom: start.zoom + (target.zoom - start.zoom) * eased,
                panX: start.panX + (target.panX - start.panX) * eased,
                panY: start.panY + (target.panY - start.panY) * eased,
            };
            viewportRef.current = interpolated;
            setViewport(interpolated);

            if (progress < 1) {
                viewportAnimationRef.current = window.requestAnimationFrame(tick);
                return;
            }

            viewportAnimationRef.current = null;
            viewportRef.current = target;
            setViewport(target);
            commitViewport(target);
        };

        viewportAnimationRef.current = window.requestAnimationFrame(tick);
    }, [cancelViewportAnimation, commitViewport]);

    const fitAll = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const points = [];
        renderablePlanets.forEach((planet) => {
            if (Array.isArray(planet.position_xyz_au)) {
                points.push(planet.position_xyz_au);
            }
            const samples = planet.orbit_samples_xyz_au || [];
            samples.forEach((sample) => {
                if (Array.isArray(sample)) points.push(sample);
            });
        });
        tracked.forEach((body) => {
            if (hasFiniteXYZ(body.position_xyz_au)) {
                points.push(body.position_xyz_au);
            }
            const samples = body.orbit_samples_xyz_au || [];
            samples.forEach((sample) => {
                if (hasFiniteXY(sample)) points.push(sample);
            });
        });

        if (!points.length) {
            const fallbackViewport = normalizeViewport(DEFAULT_VIEWPORT);
            setViewport(fallbackViewport);
            commitViewport(fallbackViewport);
            return;
        }

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        points.forEach((p) => {
            const x = Number(p[0] || 0);
            const y = Number(p[1] || 0);
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        });

        const spanX = Math.max(0.1, maxX - minX);
        const spanY = Math.max(0.1, maxY - minY);
        const padding = 0.88;
        const zoomX = (rect.width * padding) / spanX;
        const zoomY = (rect.height * padding) / spanY;
        const nextZoom = clamp(Math.min(zoomX, zoomY), MIN_ZOOM, MAX_ZOOM);

        const worldCenterX = (minX + maxX) / 2;
        const worldCenterY = (minY + maxY) / 2;

        const nextViewport = {
            zoom: nextZoom,
            panX: -worldCenterX * nextZoom,
            panY: worldCenterY * nextZoom,
        };
        setViewport(nextViewport);
        commitViewport(nextViewport);
    }, [renderablePlanets, tracked, commitViewport]);

    const fitTarget = useCallback((targetKey) => {
        const key = String(targetKey || '').trim();
        if (!key) return;
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const selectedBody = tracked.find((body) => resolveTargetKey(body) === key);
        if (!selectedBody) return;

        const points = [];
        if (hasFiniteXYZ(selectedBody.position_xyz_au)) {
            points.push(selectedBody.position_xyz_au);
        }
        const samples = Array.isArray(selectedBody.orbit_samples_xyz_au)
            ? selectedBody.orbit_samples_xyz_au
            : [];
        samples.forEach((sample) => {
            if (hasFiniteXY(sample)) points.push(sample);
        });
        if (!points.length) return;

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        points.forEach((point) => {
            const x = Number(point[0] || 0);
            const y = Number(point[1] || 0);
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        });

        const spanX = Math.max(0.02, maxX - minX);
        const spanY = Math.max(0.02, maxY - minY);
        const padding = 0.78;
        const zoomX = (rect.width * padding) / spanX;
        const zoomY = (rect.height * padding) / spanY;
        const nextZoom = clamp(Math.min(zoomX, zoomY), MIN_ZOOM, MAX_ZOOM);

        const worldCenterX = (minX + maxX) / 2;
        const worldCenterY = (minY + maxY) / 2;
        const nextViewport = {
            zoom: nextZoom,
            panX: -worldCenterX * nextZoom,
            panY: worldCenterY * nextZoom,
        };
        if (instantFocus) {
            cancelViewportAnimation();
            viewportRef.current = nextViewport;
            setViewport(nextViewport);
            commitViewport(nextViewport);
            return;
        }
        animateViewportTo(nextViewport, FOCUS_ANIMATION_DURATION_MS);
    }, [tracked, animateViewportTo, cancelViewportAnimation, commitViewport, instantFocus]);

    const applyZoomAtScreenPoint = useCallback((zoomFactor, anchorX, anchorY) => {
        const container = containerRef.current;
        if (!container || !Number.isFinite(zoomFactor) || zoomFactor <= 0) return null;

        const rect = container.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        if (width <= 0 || height <= 0) return null;

        const prev = viewportRef.current;
        const nextZoom = clamp(prev.zoom * zoomFactor, MIN_ZOOM, MAX_ZOOM);
        const prevCx = width / 2 + prev.panX;
        const prevCy = height / 2 + prev.panY;

        const worldX = (anchorX - prevCx) / prev.zoom;
        const worldY = (prevCy - anchorY) / prev.zoom;
        const nextCx = anchorX - worldX * nextZoom;
        const nextCy = anchorY + worldY * nextZoom;

        const next = {
            zoom: nextZoom,
            panX: nextCx - width / 2,
            panY: nextCy - height / 2,
        };
        viewportRef.current = next;
        setViewport(next);
        return next;
    }, []);

    const drawScene = useCallback(() => {
        const container = containerRef.current;
        const canvas = canvasRef.current;
        if (!container || !canvas) return;

        const rect = container.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;

        const dpr = window.devicePixelRatio || 1;
        const width = Math.floor(rect.width);
        const height = Math.floor(rect.height);

        if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
            canvas.width = Math.floor(width * dpr);
            canvas.height = Math.floor(height * dpr);
            canvas.style.width = `${width}px`;
            canvas.style.height = `${height}px`;
        }

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        // Background.
        ctx.fillStyle = theme.palette.background.default;
        ctx.fillRect(0, 0, width, height);

        const cx = width / 2 + viewport.panX;
        const cy = height / 2 + viewport.panY;
        const scale = viewport.zoom;
        const gridStepAu = resolveGridStepAu(scale);
        const viewportCenterWorldXAu = (width / 2 - cx) / scale;
        const viewportCenterWorldYAu = (cy - height / 2) / scale;
        const distanceKmFromViewportCenter = (worldXAu, worldYAu) => {
            const dx = Number(worldXAu) - viewportCenterWorldXAu;
            const dy = Number(worldYAu) - viewportCenterWorldYAu;
            const distanceAu = Math.hypot(dx, dy);
            return distanceAu * AU_IN_KM;
        };
        const nearestViewportX = clamp(cx, 0, width);
        const nearestViewportY = clamp(cy, 0, height);
        const minDistanceToViewportPx = Math.hypot(nearestViewportX - cx, nearestViewportY - cy);
        const maxDistanceX = Math.max(Math.abs(cx), Math.abs(width - cx));
        const maxDistanceY = Math.max(Math.abs(cy), Math.abs(height - cy));
        const maxDistanceToViewportPx = Math.hypot(maxDistanceX, maxDistanceY);

        const toScreen = (position) => {
            const x = cx + (position?.[0] || 0) * scale;
            const y = cy - (position?.[1] || 0) * scale;
            return [x, y];
        };
        const sceneTimestampUtc = scene?.timestamp_utc || '';
        const solarBodyIds = new Set(
            (Array.isArray(renderablePlanets) ? renderablePlanets : [])
                .map((body) => String(body?.id || '').trim().toLowerCase())
                .filter(Boolean),
        );
        const normalizeSolarBodyId = (value) => String(value || '').trim().toLowerCase();
        const targetSlotNumberByBodyId = new Map();
        const registerTargetSlotNumberForBodyId = (bodyIdValue, slotNumberValue) => {
            const bodyId = normalizeSolarBodyId(bodyIdValue);
            const slotNumber = Number(slotNumberValue);
            if (!bodyId || !solarBodyIds.has(bodyId)) return;
            if (!Number.isFinite(slotNumber) || slotNumber <= 0) return;
            const existing = targetSlotNumberByBodyId.get(bodyId);
            if (!Number.isFinite(existing) || slotNumber < existing) {
                targetSlotNumberByBodyId.set(bodyId, slotNumber);
            }
        };
        const targetSlotEntries = Object.entries(targetNumberByTargetKey || {});
        targetSlotEntries.forEach(([targetKey, slotNumber]) => {
            const normalizedTargetKey = String(targetKey || '').trim();
            if (normalizedTargetKey.startsWith('body:')) {
                registerTargetSlotNumberForBodyId(normalizedTargetKey.slice('body:'.length), slotNumber);
            }
        });
        (Array.isArray(tracked) ? tracked : []).forEach((body) => {
            const targetKey = resolveTargetKey(body);
            const slotNumber = Number(targetNumberByTargetKey?.[targetKey]);
            if (!Number.isFinite(slotNumber) || slotNumber <= 0) return;
            registerTargetSlotNumberForBodyId(body?.body_id, slotNumber);
            registerTargetSlotNumberForBodyId(body?.command, slotNumber);
            registerTargetSlotNumberForBodyId(body?.name, slotNumber);
        });
        const resolveTargetSlotNumber = (body, targetKey) => {
            const directSlotNumber = Number(targetNumberByTargetKey?.[targetKey]);
            if (Number.isFinite(directSlotNumber) && directSlotNumber > 0) return directSlotNumber;
            const normalizedTargetKey = String(targetKey || '').trim();
            if (normalizedTargetKey.startsWith('body:')) {
                const bodyIdFromKey = normalizeSolarBodyId(normalizedTargetKey.slice('body:'.length));
                const mappedSlotNumber = Number(targetSlotNumberByBodyId.get(bodyIdFromKey));
                if (Number.isFinite(mappedSlotNumber) && mappedSlotNumber > 0) return mappedSlotNumber;
            }
            const mappedBodySlot = Number(targetSlotNumberByBodyId.get(normalizeSolarBodyId(body?.body_id)));
            if (Number.isFinite(mappedBodySlot) && mappedBodySlot > 0) return mappedBodySlot;
            const mappedCommandSlot = Number(targetSlotNumberByBodyId.get(normalizeSolarBodyId(body?.command)));
            if (Number.isFinite(mappedCommandSlot) && mappedCommandSlot > 0) return mappedCommandSlot;
            const mappedNameSlot = Number(targetSlotNumberByBodyId.get(normalizeSolarBodyId(body?.name)));
            if (Number.isFinite(mappedNameSlot) && mappedNameSlot > 0) return mappedNameSlot;
            return NaN;
        };
        const shouldHideTrackedLabelAsDuplicate = (body) => {
            const bodyId = String(body?.body_id || '').trim().toLowerCase();
            if (bodyId && solarBodyIds.has(bodyId)) return true;
            const command = String(body?.command || '').trim().toLowerCase();
            if (command && solarBodyIds.has(command)) return true;
            const name = String(body?.name || '').trim().toLowerCase();
            if (name && solarBodyIds.has(name)) return true;
            return false;
        };

        const placedLabelBoxes = [];
        const LABEL_FONT = '11px monospace';
        const LABEL_LINE_HEIGHT = 10;
        const LABEL_ROW_STEP = 8;
        const LABEL_PADDING = 1;

        const boxesOverlap = (a, b) => !(
            (a.x + a.w) < b.x
            || (b.x + b.w) < a.x
            || (a.y + a.h) < b.y
            || (b.y + b.h) < a.y
        );

        const placeLabel = (text, baseX, baseY) => {
            const label = String(text || '');
            if (!label) return null;

            ctx.save();
            ctx.font = LABEL_FONT;
            const width = Math.max(4, ctx.measureText(label).width);
            ctx.restore();

            const maxRows = 10;
            for (let row = 0; row <= maxRows; row += 1) {
                const y = baseY + row * LABEL_ROW_STEP;
                const x = baseX;
                const box = {
                    x: x - LABEL_PADDING,
                    y: y - LABEL_PADDING,
                    w: width + LABEL_PADDING * 2,
                    h: LABEL_LINE_HEIGHT + LABEL_PADDING * 2,
                };
                if (!placedLabelBoxes.some((existing) => boxesOverlap(existing, box))) {
                    return { x, y, row, box };
                }
            }

            const y = baseY + maxRows * LABEL_ROW_STEP;
            const x = baseX;
            return {
                x,
                y,
                row: maxRows,
                box: {
                    x: x - LABEL_PADDING,
                    y: y - LABEL_PADDING,
                    w: width + LABEL_PADDING * 2,
                    h: LABEL_LINE_HEIGHT + LABEL_PADDING * 2,
                },
            };
        };

        const drawLabelWithAutoOffset = (text, anchorX, anchorY, color, options = {}) => {
            const label = String(text || '');
            if (!label) return;
            const labelOffsetX = Number(options?.offsetX);
            const labelOffsetY = Number(options?.offsetY);
            const offsetX = Number.isFinite(labelOffsetX) ? labelOffsetX : 6;
            const offsetY = Number.isFinite(labelOffsetY) ? labelOffsetY : -6;

            const placement = placeLabel(label, anchorX + offsetX, anchorY + offsetY);
            if (!placement) return;
            const adjustedPlacement = {
                ...placement,
                box: { ...placement.box },
            };
            // Keep at least LABEL_EDGE_CENTER_OFFSET_PX from left/right edges.
            if (adjustedPlacement.box.x <= 0) {
                const delta = LABEL_EDGE_CENTER_OFFSET_PX - adjustedPlacement.box.x;
                adjustedPlacement.x += delta;
                adjustedPlacement.box.x += delta;
            } else if ((adjustedPlacement.box.x + adjustedPlacement.box.w) >= width) {
                const delta = (width - LABEL_EDGE_CENTER_OFFSET_PX)
                    - (adjustedPlacement.box.x + adjustedPlacement.box.w);
                adjustedPlacement.x += delta;
                adjustedPlacement.box.x += delta;
            }

            ctx.save();
            ctx.font = LABEL_FONT;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            ctx.fillStyle = color;
            ctx.fillText(label, adjustedPlacement.x, adjustedPlacement.y);
            ctx.restore();

            placedLabelBoxes.push(adjustedPlacement.box);
        };
        const drawLinkedTimeCallout = ({ anchorX, anchorY, text, strokeColor, sideHint }) => {
            const value = String(text || '').trim();
            if (!value) return;
            if (!isPointInsideViewport(anchorX, anchorY, width, height, 4)) return;

            ctx.save();
            ctx.font = '10px monospace';
            const textWidth = Math.max(10, ctx.measureText(value).width);
            const paddingX = 5;
            const paddingY = 3;
            const boxWidth = textWidth + paddingX * 2;
            const boxHeight = 16;

            const horizontalBias = sideHint === 'past' ? -1 : 1;
            // Keep endpoint time labels noticeably farther from path endpoints.
            const primaryOffsetX = 28;
            const secondaryOffsetX = 34;
            const primaryOffsetY = 24;
            const alternateOffsetY = 28;
            const candidates = [
                {
                    centerX: anchorX + horizontalBias * primaryOffsetX,
                    centerY: anchorY - primaryOffsetY,
                },
                {
                    centerX: anchorX + horizontalBias * secondaryOffsetX,
                    centerY: anchorY + primaryOffsetY,
                },
                {
                    centerX: anchorX - horizontalBias * primaryOffsetX,
                    centerY: anchorY - alternateOffsetY,
                },
                {
                    centerX: anchorX + horizontalBias * (secondaryOffsetX + 6),
                    centerY: anchorY - 6,
                },
            ];

            const minCenterX = LABEL_EDGE_CENTER_OFFSET_PX + boxWidth / 2;
            const maxCenterX = width - LABEL_EDGE_CENTER_OFFSET_PX - boxWidth / 2;
            const minCenterY = OFFSCREEN_TARGET_EDGE_INSET_PX + boxHeight / 2;
            const maxCenterY = height - OFFSCREEN_TARGET_EDGE_INSET_PX - boxHeight / 2;

            let placement = null;
            for (const candidate of candidates) {
                const centerX = clamp(candidate.centerX, minCenterX, maxCenterX);
                const centerY = clamp(candidate.centerY, minCenterY, maxCenterY);
                const box = {
                    x: centerX - boxWidth / 2,
                    y: centerY - boxHeight / 2,
                    w: boxWidth,
                    h: boxHeight,
                };
                if (!placedLabelBoxes.some((existing) => boxesOverlap(existing, box))) {
                    placement = { centerX, centerY, box };
                    break;
                }
            }
            if (!placement) {
                ctx.restore();
                return;
            }

            const connectorEndX = placement.centerX;
            const connectorEndY = placement.centerY;
            ctx.strokeStyle = hexToRgba(strokeColor, theme.palette.mode === 'dark' ? 0.58 : 0.52);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(anchorX, anchorY);
            ctx.lineTo(connectorEndX, connectorEndY);
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(anchorX, anchorY, 2.2, 0, Math.PI * 2);
            ctx.fillStyle = strokeColor;
            ctx.fill();

            ctx.fillStyle = theme.palette.mode === 'dark' ? 'rgba(10,12,16,0.78)' : 'rgba(255,255,255,0.86)';
            ctx.fillRect(placement.box.x, placement.box.y, placement.box.w, placement.box.h);
            ctx.strokeStyle = hexToRgba(strokeColor, 0.7);
            ctx.lineWidth = 1;
            ctx.strokeRect(placement.box.x, placement.box.y, placement.box.w, placement.box.h);

            ctx.fillStyle = strokeColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(value, placement.centerX, placement.centerY + 0.5);
            placedLabelBoxes.push(placement.box);
            ctx.restore();
        };
        const findOffscreenLabelPlacement = ({
            baseX,
            baseY,
            ux,
            uy,
            perpX,
            perpY,
            textWidth,
            textHeight,
            baseSideShift = 0,
            verticalBias = 0,
        }) => {
            const bgPadX = 4;
            const bgPadY = 2;
            const sideCandidates = [baseSideShift];

            for (let step = 1; step <= OFFSCREEN_TARGET_LABEL_SEARCH_STEPS; step += 1) {
                const delta = step * OFFSCREEN_TARGET_STAGGER_PX;
                sideCandidates.push(baseSideShift + delta);
                sideCandidates.push(baseSideShift - delta);
            }

            const minLabelX = LABEL_EDGE_CENTER_OFFSET_PX + textWidth / 2 + OFFSCREEN_TARGET_LABEL_SAFE_MARGIN_PX;
            const maxLabelX = width - LABEL_EDGE_CENTER_OFFSET_PX - textWidth / 2 - OFFSCREEN_TARGET_LABEL_SAFE_MARGIN_PX;
            const minLabelY = OFFSCREEN_TARGET_EDGE_INSET_PX + textHeight / 2 + OFFSCREEN_TARGET_LABEL_SAFE_MARGIN_PX;
            const maxLabelY = height - OFFSCREEN_TARGET_EDGE_INSET_PX - textHeight / 2 - OFFSCREEN_TARGET_LABEL_SAFE_MARGIN_PX;

            // Probe outward from the preferred spot until we find a free label box.
            for (let depthStep = 0; depthStep <= OFFSCREEN_TARGET_LABEL_SEARCH_STEPS; depthStep += 1) {
                const inwardDistance = OFFSCREEN_TARGET_LABEL_GAP_PX + depthStep * OFFSCREEN_TARGET_LABEL_DEPTH_STEP_PX;
                for (const sideShift of sideCandidates) {
                    const rawX = baseX - ux * inwardDistance + perpX * sideShift;
                    const rawY = baseY - uy * inwardDistance + perpY * sideShift + verticalBias;
                    const centerX = clamp(rawX, minLabelX, maxLabelX);
                    const centerY = clamp(rawY, minLabelY, maxLabelY);
                    const box = {
                        x: centerX - textWidth / 2 - bgPadX,
                        y: centerY - textHeight / 2 - bgPadY,
                        w: textWidth + bgPadX * 2,
                        h: textHeight + bgPadY * 2,
                    };

                    if (!placedLabelBoxes.some((existing) => boxesOverlap(existing, box))) {
                        return { centerX, centerY, box };
                    }
                }
            }

            return null;
        };

        const drawStarfieldBackground = () => {
            const stars = Array.isArray(starCatalog?.stars) ? starCatalog.stars : [];
            if (!stars.length) return;

            // Orthographic ecliptic-sphere projection in screen space. Catalog
            // stars are directions at effectively infinite distance, so they
            // must not pan or zoom with AU-scale solar-system geometry.
            const skyCenterX = width / 2;
            const skyCenterY = height / 2;
            const skyRadiusPx = Math.hypot(width, height) * 0.56;
            const alphaScale = theme.palette.mode === 'dark' ? 1 : 0.72;

            ctx.save();
            stars.forEach((star) => {
                const lambdaDeg = Number(star?.lambdaDeg);
                const betaDeg = Number(star?.betaDeg);
                const magnitude = Number(star?.mag);
                if (!Number.isFinite(lambdaDeg) || !Number.isFinite(betaDeg) || !Number.isFinite(magnitude)) return;

                const lambdaRad = lambdaDeg * Math.PI / 180;
                const betaRad = betaDeg * Math.PI / 180;
                const projectedRadius = Math.max(0, Math.cos(betaRad)) * skyRadiusPx;
                const sx = skyCenterX + Math.cos(lambdaRad) * projectedRadius;
                const sy = skyCenterY - Math.sin(lambdaRad) * projectedRadius;
                if (!isPointInsideViewport(sx, sy, width, height, -3)) return;

                const brightness = clamp((6.55 - magnitude) / 8.05, 0, 1);
                const alpha = clamp(
                    (
                        STARFIELD_MIN_ALPHA
                        + (brightness ** 1.75) * (STARFIELD_MAX_ALPHA - STARFIELD_MIN_ALPHA)
                    ) * alphaScale * STARFIELD_ALPHA_MULTIPLIER,
                    0,
                    1,
                );
                const radius = magnitude <= 0
                    ? 1.8
                    : magnitude <= 1.5
                        ? 1.35
                        : 0.45 + brightness * 0.85;

                if (magnitude <= 1.5) {
                    ctx.beginPath();
                    ctx.arc(sx, sy, radius + 1.1, 0, Math.PI * 2);
                    ctx.fillStyle = resolveStarRgba(star?.bv, alpha * 0.18);
                    ctx.fill();
                }

                ctx.beginPath();
                ctx.arc(sx, sy, radius, 0, Math.PI * 2);
                ctx.fillStyle = resolveStarRgba(star?.bv, alpha);
                ctx.fill();
            });
            ctx.restore();
        };

        if (effectiveDisplayOptions.showStarfieldBackground) {
            drawStarfieldBackground();
        }

        // World-space grid (moves with pan/zoom).
        if (effectiveDisplayOptions.showGrid) {
            const worldMinX = (0 - cx) / scale;
            const worldMaxX = (width - cx) / scale;
            const worldMaxY = (cy - 0) / scale;
            const worldMinY = (cy - height) / scale;
            const startGridX = Math.floor(worldMinX / gridStepAu) * gridStepAu;
            const startGridY = Math.floor(worldMinY / gridStepAu) * gridStepAu;

            ctx.strokeStyle = theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
            ctx.lineWidth = 1;

            for (let gx = startGridX; gx <= worldMaxX; gx += gridStepAu) {
                const sx = cx + gx * scale;
                ctx.beginPath();
                ctx.moveTo(sx, 0);
                ctx.lineTo(sx, height);
                ctx.stroke();
            }
            for (let gy = startGridY; gy <= worldMaxY; gy += gridStepAu) {
                const sy = cy - gy * scale;
                ctx.beginPath();
                ctx.moveTo(0, sy);
                ctx.lineTo(width, sy);
                ctx.stroke();
            }
        }

        // Static asteroid zone annuli (subtle background guides).
        if (effectiveDisplayOptions.showAsteroidZones && Array.isArray(asteroidZones) && asteroidZones.length) {
            asteroidZones.forEach((zone) => {
                const innerAu = Math.max(0, Number(zone?.a_min_au) || 0);
                const outerAu = Math.max(innerAu, Number(zone?.a_max_au) || innerAu);
                const innerPx = innerAu * scale;
                const outerPx = outerAu * scale;
                if (outerPx <= 2) return;
                // Avoid expensive giant-radius arcs at high zoom and skip rings
                // that cannot intersect the viewport.
                if (outerPx > MAX_BACKGROUND_RING_RADIUS_PX) return;
                if (outerPx < (minDistanceToViewportPx - 1)) return;
                if (innerPx > (maxDistanceToViewportPx + 1)) return;

                ctx.beginPath();
                ctx.arc(cx, cy, outerPx, 0, Math.PI * 2);
                ctx.arc(cx, cy, innerPx, 0, Math.PI * 2, true);
                ctx.closePath();
                ctx.fillStyle = hexToRgba(resolveAsteroidZoneColor(zone), theme.palette.mode === 'dark' ? 0.14 : 0.1);
                ctx.fill();

                const midRadiusPx = ((innerAu + outerAu) / 2) * scale;
                if (
                    effectiveDisplayOptions.showZoneLabels
                    && midRadiusPx > 55
                    && midRadiusPx <= MAX_ZONE_LABEL_RADIUS_PX
                ) {
                    drawTextOnArc(
                        ctx,
                        zone?.name || '',
                        cx,
                        cy,
                        midRadiusPx,
                        -Math.PI / 4,
                        {
                            font: '10px monospace',
                            color: theme.palette.mode === 'dark'
                                ? 'rgba(220,230,240,0.42)'
                                : 'rgba(55,70,90,0.38)',
                            clockwise: true,
                        },
                    );
                }
            });
        }

        // Kirkwood gap markers (subtle dashed annuli).
        if (effectiveDisplayOptions.showResonanceMarkers && Array.isArray(asteroidResonanceGaps) && asteroidResonanceGaps.length) {
            ctx.setLineDash([5, 6]);
            ctx.lineWidth = 1;
            asteroidResonanceGaps.forEach((gap) => {
                const radiusPx = (Number(gap?.a_au) || 0) * scale;
                if (radiusPx <= 3) return;
                if (radiusPx > MAX_BACKGROUND_RING_RADIUS_PX) return;
                if (radiusPx < (minDistanceToViewportPx - 1)) return;
                if (radiusPx > (maxDistanceToViewportPx + 1)) return;
                ctx.beginPath();
                ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
                ctx.strokeStyle = theme.palette.mode === 'dark'
                    ? 'rgba(245,200,120,0.28)'
                    : 'rgba(158,116,40,0.2)';
                ctx.stroke();
            });
            ctx.setLineDash([]);
        }

        // Sun.
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.fillStyle = '#f9c74f';
        ctx.fill();
        ctx.strokeStyle = '#f4a261';
        ctx.stroke();

        if (effectiveDisplayOptions.showPlanets && effectiveDisplayOptions.showPlanetOrbits) {
            // Parent-centered moon orbit rings are derived from Horizons-backed
            // moon and parent vectors already present in the scene payload.
            if (moonOrbitRings.length > 0) {
                ctx.save();
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);

                moonOrbitRings.forEach((ring) => {
                    const [parentX, parentY] = toScreen(ring.parentPositionXyAu);
                    const radiusPx = ring.radiusAu * scale;
                    if (!Number.isFinite(radiusPx) || radiusPx <= 0.75) return;
                    if (radiusPx > MAX_BACKGROUND_RING_RADIUS_PX) return;

                    const nearestX = clamp(parentX, 0, width);
                    const nearestY = clamp(parentY, 0, height);
                    const minDistanceToViewportEdgePx = Math.hypot(nearestX - parentX, nearestY - parentY);
                    const maxDistanceX = Math.max(Math.abs(parentX), Math.abs(width - parentX));
                    const maxDistanceY = Math.max(Math.abs(parentY), Math.abs(height - parentY));
                    const maxDistanceToViewportEdgePx = Math.hypot(maxDistanceX, maxDistanceY);
                    if (radiusPx < (minDistanceToViewportEdgePx - 1)) return;
                    if (radiusPx > (maxDistanceToViewportEdgePx + 1)) return;

                    ctx.beginPath();
                    ctx.arc(parentX, parentY, radiusPx, 0, Math.PI * 2);
                    ctx.strokeStyle = hexToRgba(ring.color, theme.palette.mode === 'dark' ? 0.28 : 0.2);
                    ctx.stroke();
                });

                ctx.setLineDash([]);
                ctx.restore();
            }

            // Planet orbits (sampled paths).
            ctx.lineWidth = 1;
            renderablePlanets.forEach((planet) => {
                if (normalizeBodyId(planet?.body_type) === 'moon') return;
                const samples = planet.orbit_samples_xyz_au || [];
                if (!samples.length) return;
                const sampleTimesUtc = planet.orbit_sample_times_utc || [];
                const orbitStrokeColor = theme.palette.mode === 'dark'
                    ? 'rgba(180,180,200,0.35)'
                    : 'rgba(90,90,120,0.3)';
                ctx.strokeStyle = orbitStrokeColor;
                const pastEndIndex = resolvePastSegmentEndIndex(
                    samples,
                    sampleTimesUtc,
                    sceneTimestampUtc,
                );
                const lastSampleIndex = samples.length - 1;
                const drawOrbitSegment = (startIndex, endIndex, lineDashPattern) => {
                    if (endIndex - startIndex < 1) return;
                    ctx.beginPath();
                    for (let sampleIndex = startIndex; sampleIndex <= endIndex; sampleIndex += 1) {
                        const [sx, sy] = toScreen(samples[sampleIndex]);
                        if (sampleIndex === startIndex) ctx.moveTo(sx, sy);
                        else ctx.lineTo(sx, sy);
                    }
                    // Keep paths open so we do not draw a synthetic end-to-start chord.
                    ctx.setLineDash(lineDashPattern);
                    ctx.stroke();
                };
                if (pastEndIndex >= 1) {
                    drawOrbitSegment(0, pastEndIndex, []);
                }
                const futureSegmentStartIndex = pastEndIndex >= 1 ? pastEndIndex : 0;
                drawOrbitSegment(futureSegmentStartIndex, lastSampleIndex, [3, 4]);
                ctx.setLineDash([]);

                // Show forward direction for body trajectories.
                if (samples.length >= 2) {
                    const [endPrevX, endPrevY] = toScreen(samples[samples.length - 2]);
                    const [endX, endY] = toScreen(samples[samples.length - 1]);
                    drawArrowHead(ctx, endPrevX, endPrevY, endX, endY, orbitStrokeColor);
                }

            });
        }

        if (effectiveDisplayOptions.showPlanets) {
            // When only the solar-system body layer is visible (no tracked rows),
            // keep body labels on so the scene remains legible.
            const shouldShowBodyLabels = effectiveDisplayOptions.showPlanetLabels || !hasTrackedRows;
            // Planets.
            renderablePlanets.forEach((planet) => {
                const id = String(planet.id || '').toLowerCase();
                const color = PLANET_COLORS[id] || '#bbbbbb';
                const [sx, sy] = toScreen(planet.position_xyz_au);

                ctx.beginPath();
                ctx.arc(sx, sy, 4, 0, Math.PI * 2);
                ctx.fillStyle = color;
                ctx.fill();

                if (shouldShowBodyLabels) {
                    const isMoon = normalizeBodyId(planet?.body_type) === 'moon';
                    // Keep moon labels readable by only drawing them once each grid square
                    // represents 1 AU or less (higher zoom levels).
                    if (isMoon && gridStepAu > 1) return;
                    // Keep the Sun label clear of the larger center icon.
                    const labelAnchorX = id === 'sun' ? sx + 12 : sx;
                    const bodyTargetKey = `body:${id}`;
                    const bodyTargetSlotNumber = resolveTargetSlotNumber(
                        { body_id: id, command: id, name: planet?.name || id },
                        bodyTargetKey
                    );
                    const hasBodyTargetSlotNumber = Number.isFinite(bodyTargetSlotNumber) && bodyTargetSlotNumber > 0;
                    let labelOptions;
                    if (hasBodyTargetSlotNumber) {
                        // Mirror tracked-marker badge geometry so body labels do not start underneath T# badges.
                        const bodyTargetSlotLabel = `T${Math.round(bodyTargetSlotNumber)}`;
                        const isBodySelected = hasTrackedSelection && selectedTargetKeySet.has(bodyTargetKey);
                        const targetBadgeHeight = (isBodySelected ? 17 : 15) * TARGET_SLOT_BADGE_SCALE;
                        const targetBadgeHorizontalPadding = TARGET_SLOT_BADGE_HORIZONTAL_PADDING_PX
                            * TARGET_SLOT_BADGE_SCALE;
                        const targetLabelRenderFontSize = Math.max(
                            Math.round(11 * TARGET_SLOT_BADGE_SCALE),
                            Math.round(targetBadgeHeight * TARGET_SLOT_BADGE_FONT_HEIGHT_RATIO)
                        );
                        const targetLabelFontFamily = theme.typography?.fontFamily || 'Arial';
                        ctx.save();
                        ctx.font = `900 ${targetLabelRenderFontSize}px ${targetLabelFontFamily}`;
                        const textWidth = Math.ceil(Math.max(6, ctx.measureText(bodyTargetSlotLabel).width));
                        ctx.restore();
                        const badgeWidth = Math.max(
                            Math.round(targetBadgeHeight * 1.05),
                            textWidth + (targetBadgeHorizontalPadding * 2)
                        );
                        labelOptions = {
                            offsetX: Math.max(8, Math.ceil(badgeWidth / 2) + 4),
                            offsetY: isBodySelected ? -4 : -6,
                        };
                    }
                    drawLabelWithAutoOffset(
                        planet.name || id,
                        labelAnchorX,
                        sy,
                        theme.palette.text.secondary,
                        labelOptions
                    );
                }
            });
        }

        // Tracked objects from Horizons.
        if (effectiveDisplayOptions.showTrackedObjects) tracked.forEach((body) => {
            if (!hasFiniteXYZ(body.position_xyz_au)) return;
            const samples = body.orbit_samples_xyz_au || [];
            if (!samples.length || !effectiveDisplayOptions.showTrackedOrbits) return;
            const targetKey = resolveTargetKey(body);
            const isSelected = hasTrackedSelection && selectedTargetKeySet.has(targetKey);
            const isDimmed = hasTrackedSelection && !isSelected;

            const trackedHexColor = resolveTrackedColor(body, body.stale ? '#EF476F' : '#06D6A0');
            const trackedStrokeColor = isSelected
                ? hexToRgba(trackedHexColor, 0.95)
                : isDimmed
                    ? hexToRgba(trackedHexColor, 0.16)
                    : hexToRgba(trackedHexColor, body.stale ? 0.35 : 0.45);
            ctx.strokeStyle = trackedStrokeColor;
            ctx.lineWidth = isSelected ? 2.2 : 1;
            const sampleTimesUtc = body.orbit_sample_times_utc || [];
            const pastSegmentEndIndex = resolvePastSegmentEndIndex(samples, sampleTimesUtc, sceneTimestampUtc);
            const lastSampleIndex = samples.length - 1;
            const drawOrbitSegment = (startIndex, endIndex, lineDashPattern) => {
                if (endIndex - startIndex < 1) return;
                ctx.beginPath();
                for (let sampleIndex = startIndex; sampleIndex <= endIndex; sampleIndex += 1) {
                    const [sx, sy] = toScreen(samples[sampleIndex]);
                    if (sampleIndex === startIndex) ctx.moveTo(sx, sy);
                    else ctx.lineTo(sx, sy);
                }
                ctx.setLineDash(lineDashPattern);
                ctx.stroke();
            };
            // Keep the timeline split clear in the UI: past samples are solid, future samples are dotted.
            if (pastSegmentEndIndex >= 1) {
                drawOrbitSegment(0, pastSegmentEndIndex, []);
            }
            const futureSegmentStartIndex = pastSegmentEndIndex >= 1 ? pastSegmentEndIndex : 0;
            drawOrbitSegment(futureSegmentStartIndex, lastSampleIndex, [3, 4]);
            ctx.setLineDash([]);

            // Direction arrow at the latest endpoint in forward time direction.
            if (samples.length >= 2) {
                const lastIndex = samples.length - 1;
                const [endPrevX, endPrevY] = toScreen(samples[lastIndex - 1]);
                const [endX, endY] = toScreen(samples[lastIndex]);
                // Keep the arrowhead tip anchored on the exact path-end endpoint.
                drawArrowHead(ctx, endPrevX, endPrevY, endX, endY, trackedStrokeColor);
            }

        });

        // Endpoint time offsets for the currently selected path only.
        const selectedPathCallouts = computeSelectedPathTimeCallouts({
            selectedTargetKeySet,
            tracked,
            renderablePlanets,
            sceneTimestampUtc,
            themeMode: theme.palette.mode,
        });
        const isSelectedPathVisible = selectedPathCallouts
            && (
                (selectedPathCallouts.source === 'tracked'
                    && effectiveDisplayOptions.showTrackedObjects
                    && effectiveDisplayOptions.showTrackedOrbits)
                || (selectedPathCallouts.source === 'planet'
                    && effectiveDisplayOptions.showPlanets
                    && effectiveDisplayOptions.showPlanetOrbits)
            );
        if (isSelectedPathVisible && selectedPathCallouts) {
            selectedPathCallouts.callouts.forEach((callout) => {
                const sample = selectedPathCallouts.samples[callout.sampleIndex];
                if (!hasFiniteXY(sample)) return;
                const [anchorX, anchorY] = toScreen(sample);
                drawLinkedTimeCallout({
                    anchorX,
                    anchorY,
                    text: callout.text,
                    strokeColor: selectedPathCallouts.color,
                    sideHint: callout.sideHint,
                });
            });
        }

        // Tracked object markers from Horizons.
        const pendingTargetSlotBadges = [];
        if (effectiveDisplayOptions.showTrackedObjects) {
            tracked.forEach((body) => {
                if (!hasFiniteXYZ(body.position_xyz_au)) return;
                const [sx, sy] = toScreen(body.position_xyz_au);
                const targetKey = resolveTargetKey(body);
                const isSelected = hasTrackedSelection && selectedTargetKeySet.has(targetKey);
                const isDimmed = hasTrackedSelection && !isSelected;
                const trackedHexColor = resolveTrackedColor(body, body.stale ? '#EF476F' : '#06D6A0');
                const targetSlotNumber = resolveTargetSlotNumber(body, targetKey);
                const hasTargetSlotNumber = Number.isFinite(targetSlotNumber) && targetSlotNumber > 0;
                const targetSlotLabel = hasTargetSlotNumber ? `T${Math.round(targetSlotNumber)}` : '';
                const targetSlotBadgePalette = theme.palette.badge?.targetSlot || {};

                ctx.fillStyle = isDimmed ? hexToRgba(trackedHexColor, 0.28) : trackedHexColor;
                let markerSize = isSelected ? 8 : 6;
                let targetSlotBadgeSpec = null;
                // Keep the target-slot badge in the Solar System canvas slightly more compact.
                const targetBadgeHeight = (isSelected ? 17 : 15) * TARGET_SLOT_BADGE_SCALE;
                const targetBadgeHorizontalPadding = TARGET_SLOT_BADGE_HORIZONTAL_PADDING_PX
                    * TARGET_SLOT_BADGE_SCALE;
                const targetLabelRenderFontSize = Math.max(
                    Math.round(11 * TARGET_SLOT_BADGE_SCALE),
                    Math.round(targetBadgeHeight * TARGET_SLOT_BADGE_FONT_HEIGHT_RATIO)
                );
                const targetLabelFontFamily = theme.typography?.fontFamily || 'Arial';
                if (hasTargetSlotNumber) {
                    ctx.save();
                    ctx.font = `900 ${targetLabelRenderFontSize}px ${targetLabelFontFamily}`;
                    const textWidth = Math.ceil(Math.max(6, ctx.measureText(targetSlotLabel).width));
                    ctx.restore();
                    const badgeWidth = Math.max(
                        Math.round(targetBadgeHeight * 1.05),
                        textWidth + (targetBadgeHorizontalPadding * 2)
                    );
                    targetSlotBadgeSpec = {
                        sx,
                        sy,
                        badgeWidth,
                        targetBadgeHeight,
                        badgeRadius: 3 * TARGET_SLOT_BADGE_SCALE,
                        targetSlotLabel,
                        targetSlotBadgePalette,
                        isDimmed,
                        targetLabelRenderFontSize,
                        targetLabelFontFamily,
                    };
                    markerSize = Math.max(
                        markerSize,
                        badgeWidth + (2 * TARGET_SLOT_BADGE_SCALE),
                        targetBadgeHeight + (2 * TARGET_SLOT_BADGE_SCALE)
                    );
                }
                // Keep the classic square marker only for non-slot targets.
                // When we have a target slot badge (T#), render just the badge itself.
                if (!hasTargetSlotNumber) {
                    ctx.fillRect(sx - markerSize / 2, sy - markerSize / 2, markerSize, markerSize);
                    if (isSelected) {
                        ctx.strokeStyle = hexToRgba('#ffffff', theme.palette.mode === 'dark' ? 0.9 : 0.75);
                        ctx.lineWidth = 1.25;
                        ctx.strokeRect(sx - markerSize / 2 - 1, sy - markerSize / 2 - 1, markerSize + 2, markerSize + 2);
                    }
                }
                if (targetSlotBadgeSpec) pendingTargetSlotBadges.push(targetSlotBadgeSpec);

                if (effectiveDisplayOptions.showTrackedLabels) {
                    if (shouldHideTrackedLabelAsDuplicate(body)) return;
                    const labelColor = isSelected
                        ? theme.palette.text.primary
                        : isDimmed
                            ? hexToRgba(theme.palette.text.secondary, 0.45)
                            : theme.palette.text.secondary;
                    const labelAnchorX = (isSingleTrackedMode && isSunLabelTarget(body))
                        ? sx + SUN_LABEL_SINGLE_MODE_OFFSET_PX
                        : sx;
                    const labelOffsetX = hasTargetSlotNumber
                        ? Math.max(8, Math.ceil(markerSize / 2) + 4)
                        : undefined;
                    const labelOptions = labelOffsetX != null
                        ? { offsetX: labelOffsetX, offsetY: isSelected ? -4 : -6 }
                        : (isSelected ? { offsetX: 8, offsetY: -4 } : undefined);
                    drawLabelWithAutoOffset(
                        body.name || body.command || 'object',
                        labelAnchorX,
                        sy,
                        labelColor,
                        labelOptions,
                    );
                }
            });
        }

        const drawOffscreenDirectionIndicator = (target, offsetIndex = 0) => {
            const screenX = Number(target?.x);
            const screenY = Number(target?.y);
            if (!Number.isFinite(screenX) || !Number.isFinite(screenY)) return;

            if (isPointInsideViewport(
                screenX,
                screenY,
                width,
                height,
                OFFSCREEN_TARGET_VISIBILITY_PADDING_PX,
            )) {
                return;
            }

            const centerX = width / 2;
            const centerY = height / 2;
            const edgePoint = projectToViewportEdge({
                fromX: centerX,
                fromY: centerY,
                toX: screenX,
                toY: screenY,
                minX: OFFSCREEN_TARGET_EDGE_INSET_PX,
                minY: OFFSCREEN_TARGET_EDGE_INSET_PX,
                maxX: width - OFFSCREEN_TARGET_EDGE_INSET_PX,
                maxY: height - OFFSCREEN_TARGET_EDGE_INSET_PX,
            });
            if (!edgePoint) return;

            const dx = screenX - centerX;
            const dy = screenY - centerY;
            const distance = Math.hypot(dx, dy);
            if (distance < 0.001) return;

            const ux = dx / distance;
            const uy = dy / distance;
            const perpX = -uy;
            const perpY = ux;
            const stagger = offsetIndex * OFFSCREEN_TARGET_STAGGER_PX;
            // Keep top-pointing indicators clear of persistent overlays.
            const northArrowBias = uy < 0 ? (-uy) * OFFSCREEN_TARGET_NORTH_ARROW_BIAS_PX : 0;
            const verticalArrowBias = northArrowBias;

            const tipX = clamp(
                edgePoint.x,
                OFFSCREEN_TARGET_EDGE_INSET_PX,
                width - OFFSCREEN_TARGET_EDGE_INSET_PX,
            );
            const tipY = clamp(
                edgePoint.y + verticalArrowBias,
                OFFSCREEN_TARGET_EDGE_INSET_PX,
                height - OFFSCREEN_TARGET_EDGE_INSET_PX,
            );
            const baseX = tipX - ux * OFFSCREEN_TARGET_ARROW_LENGTH_PX;
            const baseY = tipY - uy * OFFSCREEN_TARGET_ARROW_LENGTH_PX;

            ctx.save();
            ctx.strokeStyle = target.color;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(baseX, baseY);
            ctx.lineTo(tipX, tipY);
            ctx.stroke();
            drawArrowHead(ctx, baseX, baseY, tipX, tipY, target.color);

            const baseLabel = String(target.label || '').trim();
            const distanceText = formatDistanceLabel(target.distanceKm);
            const text = baseLabel && distanceText
                ? `${baseLabel} | ${distanceText}`
                : (baseLabel || distanceText);
            if (text) {
                ctx.font = '11px monospace';
                const textWidth = Math.max(8, ctx.measureText(text).width);
                const textHeight = 10;
                // Keep labels away from top overlays based on arrow direction.
                const northBias = uy < 0 ? (-uy) * OFFSCREEN_TARGET_NORTH_LABEL_BIAS_PX : 0;
                const verticalLabelBias = northBias;
                const labelPlacement = findOffscreenLabelPlacement({
                    baseX,
                    baseY,
                    ux,
                    uy,
                    perpX,
                    perpY,
                    textWidth,
                    textHeight,
                    baseSideShift: stagger,
                    verticalBias: verticalLabelBias,
                });
                if (!labelPlacement) {
                    ctx.restore();
                    return;
                }
                const boxX = labelPlacement.box.x;
                const boxY = labelPlacement.box.y;
                const boxWidth = labelPlacement.box.w;
                const boxHeight = labelPlacement.box.h;

                ctx.fillStyle = theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.52)' : 'rgba(255,255,255,0.76)';
                ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
                ctx.strokeStyle = hexToRgba(target.color, 0.62);
                ctx.lineWidth = 1;
                ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);

                ctx.fillStyle = target.color;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText(text, labelPlacement.centerX, labelPlacement.centerY + 0.5);

                placedLabelBoxes.push(labelPlacement.box);
            }
            ctx.restore();
        };

        const offscreenAnchors = [];
        offscreenAnchors.push({
            label: t('canvas.solar.anchor_sun'),
            color: '#f9c74f',
            x: cx,
            y: cy,
            distanceKm: distanceKmFromViewportCenter(0, 0),
        });
        const earthPlanet = renderablePlanets.find(
            (planet) => String(planet?.id || '').trim().toLowerCase() === 'earth',
        );
        if (earthPlanet && hasFiniteXYZ(earthPlanet.position_xyz_au)) {
            const [earthX, earthY] = toScreen(earthPlanet.position_xyz_au);
            const earthWorldXAu = Number(earthPlanet.position_xyz_au[0]);
            const earthWorldYAu = Number(earthPlanet.position_xyz_au[1]);
            offscreenAnchors.push({
                label: t('canvas.solar.anchor_earth'),
                color: PLANET_COLORS.earth,
                x: earthX,
                y: earthY,
                distanceKm: distanceKmFromViewportCenter(earthWorldXAu, earthWorldYAu),
            });
        }
        const galacticCenterLongitudeRad = GALACTIC_CENTER_ECLIPTIC_LONGITUDE_DEG * Math.PI / 180;
        const galacticCenterDirectionX = Math.cos(galacticCenterLongitudeRad);
        const galacticCenterDirectionY = -Math.sin(galacticCenterLongitudeRad);
        // Galactic Center is a sky direction, so keep it fixed to the starfield projection.
        offscreenAnchors.push({
            label: width < 300
                ? t('canvas.solar.anchor_galactic_center_short')
                : t('canvas.solar.anchor_galactic_center'),
            color: theme.palette.mode === 'dark' ? GALACTIC_CENTER_COLOR_DARK : GALACTIC_CENTER_COLOR_LIGHT,
            x: width / 2 + galacticCenterDirectionX * GALACTIC_CENTER_DIRECTION_DISTANCE_PX,
            y: height / 2 + galacticCenterDirectionY * GALACTIC_CENTER_DIRECTION_DISTANCE_PX,
        });

        const hiddenAnchors = offscreenAnchors.filter((target) => !isPointInsideViewport(
            target.x,
            target.y,
            width,
            height,
            OFFSCREEN_TARGET_VISIBILITY_PADDING_PX,
        ));

        // Keep labels readable when multiple offscreen indicators share the same edge.
        hiddenAnchors.forEach((target, index) => {
            const offsetIndex = index - (hiddenAnchors.length - 1) / 2;
            drawOffscreenDirectionIndicator(target, offsetIndex);
        });

        // Render all target-slot badges last so they always stay topmost in the canvas stack.
        pendingTargetSlotBadges.forEach((badge) => {
            const badgeLeft = badge.sx - (badge.badgeWidth / 2);
            const badgeTop = badge.sy - (badge.targetBadgeHeight / 2);

            ctx.save();
            ctx.font = `900 ${badge.targetLabelRenderFontSize}px ${badge.targetLabelFontFamily}`;
            ctx.beginPath();
            ctx.roundRect(
                badgeLeft,
                badgeTop,
                badge.badgeWidth,
                badge.targetBadgeHeight,
                badge.badgeRadius
            );
            ctx.fillStyle = badge.targetSlotBadgePalette.background || theme.palette.warning.main;
            ctx.globalAlpha = badge.isDimmed ? 0.7 : 1.0;
            ctx.shadowColor = badge.targetSlotBadgePalette.shadow || 'rgba(0, 0, 0, 0.2)';
            ctx.shadowBlur = 3;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 1;
            ctx.fill();

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillStyle = badge.targetSlotBadgePalette.text || theme.palette.common.black;
            ctx.globalAlpha = badge.isDimmed ? 0.9 : 1.0;
            ctx.fillText(badge.targetSlotLabel, badge.sx, badge.sy + 0.35);
            ctx.restore();
        });
    }, [
        asteroidResonanceGaps,
        asteroidZones,
        displayOptions,
        renderablePlanets,
        starCatalog,
        tracked,
        hasTrackedRows,
        moonOrbitRings,
        selectedTargetKeySet,
        targetNumberByTargetKey,
        hasTrackedSelection,
        isSingleTrackedMode,
        theme.palette.background.default,
        theme.palette.mode,
        theme.palette.text.primary,
        theme.palette.text.secondary,
        formatDistanceLabel,
        t,
        viewport.panX,
        viewport.panY,
        viewport.zoom,
    ]);

    useEffect(() => {
        drawScene();
    }, [drawScene]);

    useEffect(() => {
        viewportRef.current = viewport;
    }, [viewport]);

    useEffect(() => {
        if (fitAllSignal === lastFitSignalRef.current) return;
        lastFitSignalRef.current = fitAllSignal;
        fitAll();
    }, [fitAllSignal, fitAll]);

    useEffect(() => {
        if (focusTargetSignal === lastFocusTargetSignalRef.current) return;
        lastFocusTargetSignalRef.current = focusTargetSignal;
        fitTarget(focusTargetKey);
    }, [focusTargetSignal, focusTargetKey, fitTarget]);

    useEffect(() => {
        if (zoomInSignal === lastZoomInSignalRef.current) return;
        lastZoomInSignalRef.current = zoomInSignal;
        hasPersistentViewportRef.current = true;

        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const next = applyZoomAtScreenPoint(1.08, rect.width / 2, rect.height / 2);
        if (next) commitViewport(next);
    }, [zoomInSignal, applyZoomAtScreenPoint, commitViewport]);

    useEffect(() => {
        if (zoomOutSignal === lastZoomOutSignalRef.current) return;
        lastZoomOutSignalRef.current = zoomOutSignal;
        hasPersistentViewportRef.current = true;

        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const next = applyZoomAtScreenPoint(0.92, rect.width / 2, rect.height / 2);
        if (next) commitViewport(next);
    }, [zoomOutSignal, applyZoomAtScreenPoint, commitViewport]);

    useEffect(() => {
        if (resetZoomSignal === lastResetZoomSignalRef.current) return;
        lastResetZoomSignalRef.current = resetZoomSignal;
        hasPersistentViewportRef.current = true;

        const next = {
            ...viewportRef.current,
            zoom: DEFAULT_VIEWPORT.zoom,
        };
        viewportRef.current = next;
        setViewport(next);
        commitViewport(next);
    }, [resetZoomSignal, commitViewport]);

    useEffect(() => {
        if (centerSunSignal === lastCenterSunSignalRef.current) return;
        lastCenterSunSignalRef.current = centerSunSignal;
        hasPersistentViewportRef.current = true;

        // The heliocentric origin is the Sun; recenter by clearing pan offsets.
        const next = {
            ...viewportRef.current,
            panX: 0,
            panY: 0,
        };
        viewportRef.current = next;
        setViewport(next);
        commitViewport(next);
    }, [centerSunSignal, commitViewport]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const observer = new ResizeObserver(() => {
            drawScene();
        });
        observer.observe(container);
        return () => observer.disconnect();
    }, [drawScene]);

    useEffect(() => {
        return () => {
            cancelViewportAnimation();
            if (wheelCommitTimeoutRef.current) {
                window.clearTimeout(wheelCommitTimeoutRef.current);
            }
        };
    }, [cancelViewportAnimation]);

    const handlePointerDown = (event) => {
        if (!isDragInteractionEnabled && !isZoomInteractionEnabled) return;
        if (event.pointerType === 'touch') return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        hasPersistentViewportRef.current = true;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        activePointersRef.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
        });

        const activeCount = activePointersRef.current.size;
        if (activeCount === 1) {
            if (!isDragInteractionEnabled) return;
            gestureRef.current.mode = 'pan';
            gestureRef.current.lastCenterX = event.clientX;
            gestureRef.current.lastCenterY = event.clientY;
            gestureRef.current.lastDistance = 0;
            return;
        }

        if (activeCount >= 2) {
            const gesture = getTwoPointerGesture(activePointersRef.current);
            if (!gesture) return;
            gestureRef.current.mode = 'pinch';
            gestureRef.current.lastCenterX = gesture.centerX;
            gestureRef.current.lastCenterY = gesture.centerY;
            gestureRef.current.lastDistance = gesture.distance;
        }
    };

    const handlePointerMove = (event) => {
        if (!isDragInteractionEnabled && !isZoomInteractionEnabled) return;
        if (!activePointersRef.current.has(event.pointerId)) return;
        activePointersRef.current.set(event.pointerId, {
            x: event.clientX,
            y: event.clientY,
        });

        if (isDragInteractionEnabled && activePointersRef.current.size === 1 && gestureRef.current.mode === 'pan') {
            const dx = event.clientX - gestureRef.current.lastCenterX;
            const dy = event.clientY - gestureRef.current.lastCenterY;
            gestureRef.current.lastCenterX = event.clientX;
            gestureRef.current.lastCenterY = event.clientY;
            setViewport((prev) => {
                const next = {
                    ...prev,
                    panX: prev.panX + dx,
                    panY: prev.panY + dy,
                };
                viewportRef.current = next;
                return next;
            });
            return;
        }

        if (activePointersRef.current.size >= 2) {
            const gesture = getTwoPointerGesture(activePointersRef.current);
            const container = containerRef.current;
            if (!gesture || !container || gestureRef.current.lastDistance <= 0) return;

            const rect = container.getBoundingClientRect();
            const width = rect.width;
            const height = rect.height;
            const zoomRatio = isZoomInteractionEnabled ? (gesture.distance / gestureRef.current.lastDistance) : 1;
            const anchorX = gestureRef.current.lastCenterX - rect.left;
            const anchorY = gestureRef.current.lastCenterY - rect.top;
            const nextCenterX = isDragInteractionEnabled ? (gesture.centerX - rect.left) : anchorX;
            const nextCenterY = isDragInteractionEnabled ? (gesture.centerY - rect.top) : anchorY;

            setViewport((prev) => {
                const nextZoom = clamp(prev.zoom * zoomRatio, MIN_ZOOM, MAX_ZOOM);
                const prevCx = width / 2 + prev.panX;
                const prevCy = height / 2 + prev.panY;
                const worldX = (anchorX - prevCx) / prev.zoom;
                const worldY = (prevCy - anchorY) / prev.zoom;
                const nextCx = nextCenterX - worldX * nextZoom;
                const nextCy = nextCenterY + worldY * nextZoom;

                const next = {
                    zoom: nextZoom,
                    panX: nextCx - width / 2,
                    panY: nextCy - height / 2,
                };
                viewportRef.current = next;
                return next;
            });

            gestureRef.current.lastCenterX = gesture.centerX;
            gestureRef.current.lastCenterY = gesture.centerY;
            gestureRef.current.lastDistance = Math.max(gesture.distance, 0.0001);
        }
    };

    const handlePointerUp = (event) => {
        if (!isDragInteractionEnabled && !isZoomInteractionEnabled) return;
        activePointersRef.current.delete(event.pointerId);

        if (!activePointersRef.current.size) {
            if (gestureRef.current.mode) {
                commitViewport(viewportRef.current);
            }
            gestureRef.current.mode = null;
            gestureRef.current.lastCenterX = 0;
            gestureRef.current.lastCenterY = 0;
            gestureRef.current.lastDistance = 0;
            return;
        }

        if (activePointersRef.current.size === 1) {
            const remainingPointer = Array.from(activePointersRef.current.values())[0];
            gestureRef.current.mode = 'pan';
            gestureRef.current.lastCenterX = remainingPointer.x;
            gestureRef.current.lastCenterY = remainingPointer.y;
            gestureRef.current.lastDistance = 0;
            return;
        }

        const gesture = getTwoPointerGesture(activePointersRef.current);
        if (gesture) {
            gestureRef.current.mode = 'pinch';
            gestureRef.current.lastCenterX = gesture.centerX;
            gestureRef.current.lastCenterY = gesture.centerY;
            gestureRef.current.lastDistance = gesture.distance;
        }
    };

    const handleTouchStart = (event) => {
        if (!isDragInteractionEnabled && !isZoomInteractionEnabled) return;
        if (event.touches.length < 2) return;
        hasPersistentViewportRef.current = true;
        const touch1 = event.touches[0];
        const touch2 = event.touches[1];
        touchGestureRef.current.active = true;
        touchGestureRef.current.lastCenterX = (touch1.clientX + touch2.clientX) / 2;
        touchGestureRef.current.lastCenterY = (touch1.clientY + touch2.clientY) / 2;
        touchGestureRef.current.lastDistance = Math.max(
            Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY),
            0.0001,
        );
        event.preventDefault();
    };

    const handleTouchMove = (event) => {
        if (!isDragInteractionEnabled && !isZoomInteractionEnabled) return;
        if (event.touches.length < 2 || !touchGestureRef.current.active) return;
        const container = containerRef.current;
        if (!container) return;

        const touch1 = event.touches[0];
        const touch2 = event.touches[1];
        const centerX = (touch1.clientX + touch2.clientX) / 2;
        const centerY = (touch1.clientY + touch2.clientY) / 2;
        const distance = Math.max(Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY), 0.0001);
        const rect = container.getBoundingClientRect();
        const width = rect.width;
        const height = rect.height;
        const zoomRatio = isZoomInteractionEnabled ? (distance / touchGestureRef.current.lastDistance) : 1;
        const anchorX = touchGestureRef.current.lastCenterX - rect.left;
        const anchorY = touchGestureRef.current.lastCenterY - rect.top;
        const nextCenterX = isDragInteractionEnabled ? (centerX - rect.left) : anchorX;
        const nextCenterY = isDragInteractionEnabled ? (centerY - rect.top) : anchorY;

        setViewport((prev) => {
            const nextZoom = clamp(prev.zoom * zoomRatio, MIN_ZOOM, MAX_ZOOM);
            const prevCx = width / 2 + prev.panX;
            const prevCy = height / 2 + prev.panY;
            const worldX = (anchorX - prevCx) / prev.zoom;
            const worldY = (prevCy - anchorY) / prev.zoom;
            const nextCx = nextCenterX - worldX * nextZoom;
            const nextCy = nextCenterY + worldY * nextZoom;

            const next = {
                zoom: nextZoom,
                panX: nextCx - width / 2,
                panY: nextCy - height / 2,
            };
            viewportRef.current = next;
            return next;
        });

        touchGestureRef.current.lastCenterX = centerX;
        touchGestureRef.current.lastCenterY = centerY;
        touchGestureRef.current.lastDistance = distance;
        event.preventDefault();
    };

    const handleTouchEnd = (event) => {
        if (!isDragInteractionEnabled && !isZoomInteractionEnabled) return;
        if (event.touches.length >= 2) {
            const touch1 = event.touches[0];
            const touch2 = event.touches[1];
            touchGestureRef.current.active = true;
            touchGestureRef.current.lastCenterX = (touch1.clientX + touch2.clientX) / 2;
            touchGestureRef.current.lastCenterY = (touch1.clientY + touch2.clientY) / 2;
            touchGestureRef.current.lastDistance = Math.max(
                Math.hypot(touch2.clientX - touch1.clientX, touch2.clientY - touch1.clientY),
                0.0001,
            );
            return;
        }

        if (touchGestureRef.current.active) {
            touchGestureRef.current.active = false;
            touchGestureRef.current.lastCenterX = 0;
            touchGestureRef.current.lastCenterY = 0;
            touchGestureRef.current.lastDistance = 0;
            commitViewport(viewportRef.current);
        }
    };

    const handleWheel = (event) => {
        if (!isZoomInteractionEnabled) {
            return;
        }
        event.preventDefault();
        hasPersistentViewportRef.current = true;
        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        const zoomFactor = event.deltaY > 0 ? 0.92 : 1.08;
        applyZoomAtScreenPoint(zoomFactor, mouseX, mouseY);

        if (wheelCommitTimeoutRef.current) {
            window.clearTimeout(wheelCommitTimeoutRef.current);
        }
        wheelCommitTimeoutRef.current = window.setTimeout(() => {
            commitViewport(viewportRef.current);
        }, WHEEL_COMMIT_DELAY_MS);
    };

    const timestampText = useMemo(() => {
        if (!scene?.timestamp_utc) return t('canvas.solar.no_epoch');
        return t('canvas.solar.epoch', { timestamp: scene.timestamp_utc });
    }, [scene?.timestamp_utc, t]);

    const scaleIndicator = useMemo(() => {
        const zoom = viewport.zoom;
        const gridStepAu = resolveGridStepAu(zoom);
        const pixels = gridStepAu * zoom;
        return {
            label: t('canvas.solar.scale', { value: formatAu(gridStepAu) }),
            barWidthPx: clamp(pixels, 40, 180),
        };
    }, [viewport.zoom, t]);
    const gestureHintText = useMemo(() => {
        if (!isDragInteractionEnabled && !isZoomInteractionEnabled) {
            return t('canvas.solar.gesture_disabled');
        }

        let touchLabel = '';
        if (isDragInteractionEnabled && isZoomInteractionEnabled) {
            touchLabel = t('canvas.solar.touch_pan_zoom');
        } else if (isDragInteractionEnabled) {
            touchLabel = t('canvas.solar.touch_pan');
        } else if (isZoomInteractionEnabled) {
            touchLabel = t('canvas.solar.touch_pinch_zoom');
        }

        let mouseLabel = '';
        if (isDragInteractionEnabled && isZoomInteractionEnabled) {
            mouseLabel = t('canvas.solar.mouse_drag_plus_wheel');
        } else if (isDragInteractionEnabled) {
            mouseLabel = t('canvas.solar.mouse_drag');
        } else if (isZoomInteractionEnabled) {
            mouseLabel = t('canvas.solar.mouse_wheel');
        }

        return t('canvas.solar.gesture_hint', {
            touch: touchLabel,
            mouse: mouseLabel,
        });
    }, [isDragInteractionEnabled, isZoomInteractionEnabled, t]);

    useEffect(() => {
        if (!onStatusBarInfoChange) return;
        // Keep status-bar text in sync with the same toggles used by canvas overlays.
        onStatusBarInfoChange({
            gestureHintText: effectiveDisplayOptions.showGestureHint ? gestureHintText : '',
            scaleLabel: effectiveDisplayOptions.showScaleIndicator ? scaleIndicator.label : '',
        });
    }, [
        onStatusBarInfoChange,
        effectiveDisplayOptions.showGestureHint,
        effectiveDisplayOptions.showScaleIndicator,
        gestureHintText,
        scaleIndicator.label,
    ]);

    return (
        <Box sx={{ width: '100%', height: '100%', position: 'relative' }}>
            <Box
                ref={containerRef}
                sx={{
                    width: '100%',
                    height: '100%',
                    cursor: isDragInteractionEnabled ? 'grab' : 'default',
                    touchAction: (isDragInteractionEnabled || isZoomInteractionEnabled) ? 'pan-x pan-y' : 'auto',
                }}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onWheel={handleWheel}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchEnd}
            >
                <canvas ref={canvasRef} style={{ display: 'block', width: '100%', height: '100%' }} />
            </Box>
            {effectiveDisplayOptions.showTimestamp ? (
                <Typography
                    variant="caption"
                    sx={{
                        position: 'absolute',
                        left: 10,
                        top: 8,
                        color: 'text.secondary',
                        backgroundColor: theme.palette.mode === 'dark' ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.6)',
                        px: 0.8,
                        py: 0.3,
                        borderRadius: 0.5,
                        fontFamily: 'monospace',
                    }}
                >
                    {timestampText}
                </Typography>
            ) : null}
        </Box>
    );
};

export default React.memo(SolarSystemCanvas);
