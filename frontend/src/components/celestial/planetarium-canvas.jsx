import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';

const ASSET_BASE_URL = import.meta.env.BASE_URL || '/';
const NORMALIZED_ASSET_BASE_URL = ASSET_BASE_URL.endsWith('/') ? ASSET_BASE_URL : `${ASSET_BASE_URL}/`;
const STARFIELD_CATALOG_URL = `${NORMALIZED_ASSET_BASE_URL}assets/astronomy/stars-bright-v1.json`;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const J2000_OBLIQUITY_DEG = 23.4392911;
const DEFAULT_FOV_DEG = 95;
const MIN_FOV_DEG = 4;
const MAX_FOV_DEG = 160;
const NAMED_STAR_MAG_LIMIT = 4.2;
const CONSTELLATION_LABEL_MAG_LIMIT = 4.2;
const HORIZON_TICKS = [
    { az: 0, labelKey: 'north', degree: '0' },
    { az: 30, degree: '30' },
    { az: 60, degree: '60' },
    { az: 90, labelKey: 'east', degree: '90' },
    { az: 120, degree: '120' },
    { az: 150, degree: '150' },
    { az: 180, labelKey: 'south', degree: '180' },
    { az: 210, degree: '210' },
    { az: 240, degree: '240' },
    { az: 270, labelKey: 'west', degree: '270' },
    { az: 300, degree: '300' },
    { az: 330, degree: '330' },
];
const CONSTELLATION_ABBREVIATIONS = new Set([
    'AND', 'ANT', 'APS', 'AQL', 'AQR', 'ARA', 'ARI', 'AUR', 'BOO', 'CAE', 'CAM', 'CAP', 'CAR',
    'CAS', 'CEN', 'CEP', 'CET', 'CHA', 'CIR', 'CMA', 'CMI', 'CNC', 'COL', 'COM', 'CRA', 'CRB',
    'CRT', 'CRU', 'CRV', 'CVN', 'CYG', 'DEL', 'DOR', 'DRA', 'EQU', 'ERI', 'FOR', 'GEM', 'GRU',
    'HER', 'HOR', 'HYA', 'HYI', 'IND', 'LAC', 'LEO', 'LEP', 'LIB', 'LMI', 'LUP', 'LYN', 'LYR',
    'MEN', 'MIC', 'MON', 'MUS', 'NOR', 'OCT', 'OPH', 'ORI', 'PAV', 'PEG', 'PER', 'PHE', 'PIC',
    'PSA', 'PSC', 'PUP', 'PYX', 'RET', 'SCL', 'SCO', 'SCT', 'SER', 'SEX', 'SGE', 'SGR', 'TAU',
    'TEL', 'TRA', 'TRI', 'TUC', 'UMA', 'UMI', 'VEL', 'VIR', 'VOL', 'VUL',
]);

const CONSTELLATION_NAMES = {
    AND: 'Andromeda', ANT: 'Antlia', APS: 'Apus', AQL: 'Aquila', AQR: 'Aquarius', ARA: 'Ara',
    ARI: 'Aries', AUR: 'Auriga', BOO: 'Bootes', CAE: 'Caelum', CAM: 'Camelopardalis',
    CAP: 'Capricornus', CAR: 'Carina', CAS: 'Cassiopeia', CEN: 'Centaurus', CEP: 'Cepheus',
    CET: 'Cetus', CHA: 'Chamaeleon', CIR: 'Circinus', CMA: 'Canis Major', CMI: 'Canis Minor',
    CNC: 'Cancer', COL: 'Columba', COM: 'Coma Berenices', CRA: 'Corona Australis',
    CRB: 'Corona Borealis', CRT: 'Crater', CRU: 'Crux', CRV: 'Corvus', CVN: 'Canes Venatici',
    CYG: 'Cygnus', DEL: 'Delphinus', DOR: 'Dorado', DRA: 'Draco', EQU: 'Equuleus',
    ERI: 'Eridanus', FOR: 'Fornax', GEM: 'Gemini', GRU: 'Grus', HER: 'Hercules',
    HOR: 'Horologium', HYA: 'Hydra', HYI: 'Hydrus', IND: 'Indus', LAC: 'Lacerta', LEO: 'Leo',
    LEP: 'Lepus', LIB: 'Libra', LMI: 'Leo Minor', LUP: 'Lupus', LYN: 'Lynx', LYR: 'Lyra',
    MEN: 'Mensa', MIC: 'Microscopium', MON: 'Monoceros', MUS: 'Musca', NOR: 'Norma',
    OCT: 'Octans', OPH: 'Ophiuchus', ORI: 'Orion', PAV: 'Pavo', PEG: 'Pegasus', PER: 'Perseus',
    PHE: 'Phoenix', PIC: 'Pictor', PSA: 'Piscis Austrinus', PSC: 'Pisces', PUP: 'Puppis',
    PYX: 'Pyxis', RET: 'Reticulum', SCL: 'Sculptor', SCO: 'Scorpius', SCT: 'Scutum',
    SER: 'Serpens', SEX: 'Sextans', SGE: 'Sagitta', SGR: 'Sagittarius', TAU: 'Taurus',
    TEL: 'Telescopium', TRA: 'Triangulum Australe', TRI: 'Triangulum', TUC: 'Tucana',
    UMA: 'Ursa Major', UMI: 'Ursa Minor', VEL: 'Vela', VIR: 'Virgo', VOL: 'Volans',
    VUL: 'Vulpecula',
};

const STAR_COLOR_STOPS = [
    { bv: -0.35, rgb: [170, 205, 255] },
    { bv: 0, rgb: [215, 228, 255] },
    { bv: 0.45, rgb: [255, 244, 214] },
    { bv: 0.9, rgb: [255, 216, 174] },
    { bv: 1.6, rgb: [255, 176, 124] },
];
const DEFAULT_DISPLAY_OPTIONS = {
    showGrid: true,
    showHorizonCompass: true,
    showStarField: true,
    showStarNames: true,
    showConstellationLabels: true,
    showPassCurves: true,
    showPlanetLabels: true,
    showTargetLabels: true,
    showRotatorCrosshair: true,
    showHud: true,
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const normalizeDegrees = (value) => ((Number(value) % 360) + 360) % 360;
const normalizeSignedDegrees = (value) => {
    const normalized = normalizeDegrees(value);
    return normalized > 180 ? normalized - 360 : normalized;
};
const toFiniteNumber = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};
const normalizeColor = (value, fallback) => {
    const text = String(value || '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(text) ? text : fallback;
};

const resolveStarRgba = (bv, alpha) => {
    const normalizedBv = Number.isFinite(Number(bv)) ? Number(bv) : 0.65;
    let lower = STAR_COLOR_STOPS[0];
    let upper = STAR_COLOR_STOPS[STAR_COLOR_STOPS.length - 1];

    for (let index = 0; index < STAR_COLOR_STOPS.length - 1; index += 1) {
        if (normalizedBv >= STAR_COLOR_STOPS[index].bv && normalizedBv <= STAR_COLOR_STOPS[index + 1].bv) {
            lower = STAR_COLOR_STOPS[index];
            upper = STAR_COLOR_STOPS[index + 1];
            break;
        }
    }

    if (normalizedBv <= STAR_COLOR_STOPS[0].bv) {
        lower = STAR_COLOR_STOPS[0];
        upper = STAR_COLOR_STOPS[0];
    } else if (normalizedBv >= STAR_COLOR_STOPS[STAR_COLOR_STOPS.length - 1].bv) {
        lower = STAR_COLOR_STOPS[STAR_COLOR_STOPS.length - 1];
        upper = STAR_COLOR_STOPS[STAR_COLOR_STOPS.length - 1];
    }

    const span = upper.bv - lower.bv;
    const fraction = span > 0 ? clamp((normalizedBv - lower.bv) / span, 0, 1) : 0;
    const rgb = lower.rgb.map((channel, index) => Math.round(channel + (upper.rgb[index] - channel) * fraction));
    return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`;
};

const buildTargetKey = (entry = {}) => {
    const explicit = String(entry.target_key || entry.targetKey || '').trim();
    if (explicit) return explicit;

    const type = String(entry.target_type || entry.targetType || 'mission').toLowerCase();
    if (type === 'body') {
        const bodyId = String(entry.body_id || entry.bodyId || entry.id || entry.command || '').trim().toLowerCase();
        return bodyId ? `body:${bodyId}` : '';
    }

    const command = String(entry.command || '').trim();
    return command ? `mission:${command}` : '';
};

const resolveName = (entry = {}, fallbackLabel = 'Target') => {
    const name = String(
        entry.display_name
        || entry.displayName
        || entry.name
        || entry.body_id
        || entry.bodyId
        || entry.command
        || entry.id
        || '',
    ).trim();
    return name || fallbackLabel;
};

const resolveCanvasSize = (node) => {
    if (!node) return { width: 0, height: 0 };
    const rect = node.getBoundingClientRect();
    return {
        width: Math.max(0, Math.floor(rect.width)),
        height: Math.max(0, Math.floor(rect.height)),
    };
};

const eclipticToEquatorial = (lambdaDeg, betaDeg) => {
    const lambda = Number(lambdaDeg) * DEG_TO_RAD;
    const beta = Number(betaDeg) * DEG_TO_RAD;
    const epsilon = J2000_OBLIQUITY_DEG * DEG_TO_RAD;
    const xEcl = Math.cos(beta) * Math.cos(lambda);
    const yEcl = Math.cos(beta) * Math.sin(lambda);
    const zEcl = Math.sin(beta);
    const xEq = xEcl;
    const yEq = yEcl * Math.cos(epsilon) - zEcl * Math.sin(epsilon);
    const zEq = yEcl * Math.sin(epsilon) + zEcl * Math.cos(epsilon);
    const raDeg = normalizeDegrees(Math.atan2(yEq, xEq) * RAD_TO_DEG);
    const decDeg = Math.asin(clamp(zEq, -1, 1)) * RAD_TO_DEG;
    return { raDeg, decDeg };
};

const gmstDeg = (date) => {
    const jd = date.getTime() / 86400000 + 2440587.5;
    const d = jd - 2451545.0;
    const t = d / 36525.0;
    return normalizeDegrees(280.46061837 + 360.98564736629 * d + 0.000387933 * t * t - (t * t * t) / 38710000);
};

const equatorialToAltAz = ({ raDeg, decDeg }, observer, date) => {
    const latDeg = toFiniteNumber(observer?.lat);
    const lonDeg = toFiniteNumber(observer?.lon);
    if (latDeg == null || lonDeg == null) return null;

    const lstDeg = normalizeDegrees(gmstDeg(date) + lonDeg);
    const hourAngleDeg = normalizeSignedDegrees(lstDeg - Number(raDeg));
    const ha = hourAngleDeg * DEG_TO_RAD;
    const dec = Number(decDeg) * DEG_TO_RAD;
    const lat = latDeg * DEG_TO_RAD;
    const sinAlt = Math.sin(dec) * Math.sin(lat) + Math.cos(dec) * Math.cos(lat) * Math.cos(ha);
    const alt = Math.asin(clamp(sinAlt, -1, 1));
    const y = -Math.sin(ha) * Math.cos(dec);
    const x = Math.sin(dec) * Math.cos(lat) - Math.cos(dec) * Math.sin(lat) * Math.cos(ha);
    const azDeg = normalizeDegrees(Math.atan2(y, x) * RAD_TO_DEG);
    return {
        az: azDeg,
        el: alt * RAD_TO_DEG,
    };
};

const normalizeSkyObject = (entry, kind, fallbackLabel = 'Target') => {
    const sky = entry?.sky_position || {};
    const az = toFiniteNumber(sky.az_deg);
    const el = toFiniteNumber(sky.el_deg);
    if (az == null || el == null) return null;

    const key = buildTargetKey(entry) || `${kind}:${resolveName(entry, fallbackLabel).toLowerCase()}`;
    const visible = typeof entry?.visibility?.visible === 'boolean'
        ? entry.visibility.visible
        : el > 0;

    return {
        key,
        kind,
        name: resolveName(entry, fallbackLabel),
        az: normalizeDegrees(az),
        el,
        visible,
        color: normalizeColor(entry?.color || entry?.color_hex, kind === 'planet' ? '#7aa7ff' : '#ffb84d'),
    };
};

const buildSkyObjects = (scene = {}, fallbackLabel = 'Target') => {
    const targetObjects = (Array.isArray(scene.celestial) ? scene.celestial : [])
        .map((entry) => normalizeSkyObject(entry, 'target', fallbackLabel))
        .filter(Boolean);
    const existingTargetKeys = new Set(targetObjects.map((item) => item.key));
    const planetObjects = (Array.isArray(scene.planets) ? scene.planets : [])
        .map((entry) => normalizeSkyObject(entry, 'planet', fallbackLabel))
        .filter((item) => item && !existingTargetKeys.has(item.key));

    return [...planetObjects, ...targetObjects];
};

const buildPassCurves = (scene = {}) => {
    const passes = Array.isArray(scene.celestial_passes) ? scene.celestial_passes : [];
    return passes
        .map((pass) => {
            const points = Array.isArray(pass?.elevation_curve) ? pass.elevation_curve : [];
            const normalizedPoints = points
                .map((point) => ({
                    az: toFiniteNumber(point.azimuth ?? point.az_deg),
                    el: toFiniteNumber(point.elevation ?? point.el_deg),
                }))
                .filter((point) => point.az != null && point.el != null)
                .map((point) => ({ az: normalizeDegrees(point.az), el: point.el }));
            const startMs = new Date(pass?.event_start || '').getTime();
            const endMs = new Date(pass?.event_end || '').getTime();
            return {
                key: String(pass?.target_key || '').trim(),
                points: normalizedPoints,
                startMs: Number.isFinite(startMs) ? startMs : null,
                endMs: Number.isFinite(endMs) ? endMs : null,
            };
        })
        .filter((curve) => curve.key && curve.points.length >= 2);
};

const getPassCurveIntensity = (curve, nowMs, maxFutureLeadMs) => {
    if (!curve || !Number.isFinite(nowMs)) return 0.55;
    const startMs = Number(curve.startMs);
    const endMs = Number(curve.endMs);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 0.55;

    // Active pass should remain fully emphasized.
    if (nowMs >= startMs && nowMs <= endMs) return 1;

    // Future passes fade gradually as their start time gets farther from now.
    if (nowMs < startMs) {
        const leadMs = startMs - nowMs;
        const normalizedLead = clamp(leadMs / Math.max(1, maxFutureLeadMs), 0, 1);
        return 1 - normalizedLead * 0.75;
    }

    // Past curves are still visible but de-emphasized.
    const ageMs = nowMs - endMs;
    const fadeWindowMs = 2 * 60 * 60 * 1000;
    const normalizedAge = clamp(ageMs / fadeWindowMs, 0, 1);
    return 0.5 - normalizedAge * 0.3;
};

const extractConstellationAbbreviation = (name) => {
    const compact = String(name || '').replace(/\s+/g, '').toUpperCase();
    for (const abbreviation of CONSTELLATION_ABBREVIATIONS) {
        if (compact.endsWith(abbreviation)) return abbreviation;
    }
    return '';
};

const buildConstellationLabels = (stars) => {
    const groups = new Map();
    stars.forEach((star) => {
        if (!star.constellation || star.mag > CONSTELLATION_LABEL_MAG_LIMIT) return;
        const group = groups.get(star.constellation) || {
            abbreviation: star.constellation,
            totalWeight: 0,
            x: 0,
            y: 0,
            z: 0,
        };
        const weight = Math.max(0.1, CONSTELLATION_LABEL_MAG_LIMIT + 0.5 - star.mag);
        const ra = star.raDeg * DEG_TO_RAD;
        const dec = star.decDeg * DEG_TO_RAD;
        group.totalWeight += weight;
        group.x += Math.cos(dec) * Math.cos(ra) * weight;
        group.y += Math.cos(dec) * Math.sin(ra) * weight;
        group.z += Math.sin(dec) * weight;
        groups.set(star.constellation, group);
    });

    return Array.from(groups.values())
        .map((group) => {
            const length = Math.hypot(group.x, group.y, group.z);
            if (!length) return null;
            return {
                key: `constellation:${group.abbreviation}`,
                name: CONSTELLATION_NAMES[group.abbreviation] || group.abbreviation,
                raDeg: normalizeDegrees(Math.atan2(group.y / length, group.x / length) * RAD_TO_DEG),
                decDeg: Math.asin(clamp(group.z / length, -1, 1)) * RAD_TO_DEG,
            };
        })
        .filter(Boolean);
};

const buildStarCatalog = (payload) => {
    const stars = Array.isArray(payload?.stars) ? payload.stars : [];
    return stars
        .map((star) => {
            const lambdaDeg = toFiniteNumber(star?.lambdaDeg);
            const betaDeg = toFiniteNumber(star?.betaDeg);
            const mag = toFiniteNumber(star?.mag);
            if (lambdaDeg == null || betaDeg == null || mag == null) return null;
            const equatorial = eclipticToEquatorial(lambdaDeg, betaDeg);
            const constellation = extractConstellationAbbreviation(star?.name);
            return {
                id: star?.id || `${lambdaDeg}:${betaDeg}`,
                name: String(star?.name || '').trim(),
                mag,
                bv: star?.bv,
                constellation,
                ...equatorial,
            };
        })
        .filter(Boolean);
};

const resolveSceneDate = (scene) => {
    const parsed = new Date(scene?.timestamp_utc || Date.now());
    return Number.isFinite(parsed.getTime()) ? parsed : new Date();
};

const projectSkyPoint = ({ az, el }, view, size) => {
    const centerAz = Number(view.centerAz);
    const centerEl = Number(view.centerEl);
    const fov = Number(view.fov);
    const scale = Math.min(size.width, size.height) / (2 * Math.tan((fov * DEG_TO_RAD) / 2));
    const azRad = normalizeSignedDegrees(Number(az) - centerAz) * DEG_TO_RAD;
    const elRad = Number(el) * DEG_TO_RAD;
    const centerElRad = centerEl * DEG_TO_RAD;
    const cosC = Math.sin(centerElRad) * Math.sin(elRad)
        + Math.cos(centerElRad) * Math.cos(elRad) * Math.cos(azRad);

    // Gnomonic projection gives the familiar zoomable planetarium feel.
    if (cosC <= 0.02) return null;

    const x = scale * (Math.cos(elRad) * Math.sin(azRad)) / cosC;
    const y = -scale * (
        Math.cos(centerElRad) * Math.sin(elRad)
        - Math.sin(centerElRad) * Math.cos(elRad) * Math.cos(azRad)
    ) / cosC;

    return {
        x: size.width / 2 + x,
        y: size.height / 2 + y,
        behind: false,
    };
};

const drawText = (ctx, text, x, y, options = {}) => {
    ctx.save();
    ctx.font = options.font || '12px sans-serif';
    ctx.fillStyle = options.color || '#fff';
    ctx.textAlign = options.align || 'center';
    ctx.textBaseline = options.baseline || 'middle';
    ctx.fillText(text, x, y);
    ctx.restore();
};

function PlanetariumCanvas({
    scene,
    selectedTargetKeys = [],
    focusTargetKey = '',
    rotatorCrosshair = null,
    rotatorMinElevation = null,
    enableMapDragging = true,
    enableMapZooming = true,
    fitAllSignal = 0,
    zoomInSignal = 0,
    zoomOutSignal = 0,
    resetZoomSignal = 0,
    centerSunSignal = 0,
    displayOptions = DEFAULT_DISPLAY_OPTIONS,
}) {
    const theme = useTheme();
    const { t } = useTranslation('celestial');
    const containerRef = useRef(null);
    const canvasRef = useRef(null);
    const dragRef = useRef(null);
    const lastFitAllSignalRef = useRef(fitAllSignal);
    const lastZoomInSignalRef = useRef(zoomInSignal);
    const lastZoomOutSignalRef = useRef(zoomOutSignal);
    const lastResetZoomSignalRef = useRef(resetZoomSignal);
    const lastCenterSunSignalRef = useRef(centerSunSignal);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [starCatalog, setStarCatalog] = useState([]);
    const [starCatalogLoadFailed, setStarCatalogLoadFailed] = useState(false);
    const [view, setView] = useState({ centerAz: 180, centerEl: 35, fov: DEFAULT_FOV_DEG });
    const selectedKeys = useMemo(
        () => new Set((selectedTargetKeys || []).map((key) => String(key || '').trim()).filter(Boolean)),
        [selectedTargetKeys],
    );
    const focusedKey = String(focusTargetKey || '').trim();
    const fallbackTargetLabel = t('canvas.planetarium.fallback_target');
    const skyObjects = useMemo(
        () => buildSkyObjects(scene, fallbackTargetLabel),
        [scene, fallbackTargetLabel],
    );
    const passCurves = useMemo(() => buildPassCurves(scene), [scene]);
    const normalizedRotatorCrosshair = useMemo(() => {
        if (!rotatorCrosshair || rotatorCrosshair.visible === false) return null;
        const az = toFiniteNumber(rotatorCrosshair.az);
        const el = toFiniteNumber(rotatorCrosshair.el);
        if (az == null || el == null) return null;
        return {
            az: normalizeDegrees(az),
            el,
        };
    }, [rotatorCrosshair]);
    const normalizedRotatorMinElevation = useMemo(() => {
        const minElevation = toFiniteNumber(rotatorMinElevation);
        if (minElevation == null) return null;
        // Horizon already defines 0°, so only render explicit positive hardware limits.
        if (minElevation <= 0 || minElevation > 90) return null;
        return minElevation;
    }, [rotatorMinElevation]);
    const observerLocation = scene?.meta?.observer_location || null;
    const sceneDate = useMemo(() => resolveSceneDate(scene), [scene]);
    const observerName = String(observerLocation?.name || '').trim();
    const timestamp = String(scene?.timestamp_utc || '').trim();
    const effectiveDisplayOptions = useMemo(
        () => ({
            ...DEFAULT_DISPLAY_OPTIONS,
            ...(displayOptions || {}),
        }),
        [displayOptions],
    );
    const shouldRenderStarCatalog = effectiveDisplayOptions.showStarField || effectiveDisplayOptions.showConstellationLabels;

    const starObjects = useMemo(() => {
        if (!observerLocation || !starCatalog.length) return [];
        return starCatalog
            .map((star) => {
                const altAz = equatorialToAltAz(star, observerLocation, sceneDate);
                if (!altAz) return null;
                return { ...star, ...altAz };
            })
            .filter(Boolean);
    }, [observerLocation, sceneDate, starCatalog]);

    const constellationLabels = useMemo(() => {
        if (!observerLocation || !starCatalog.length) return [];
        return buildConstellationLabels(starCatalog)
            .map((label) => {
                const altAz = equatorialToAltAz(label, observerLocation, sceneDate);
                if (!altAz) return null;
                return { ...label, ...altAz };
            })
            .filter(Boolean);
    }, [observerLocation, sceneDate, starCatalog]);

    useEffect(() => {
        const node = containerRef.current;
        if (!node) return undefined;

        const updateSize = () => setSize(resolveCanvasSize(node));
        updateSize();

        const observer = new ResizeObserver(updateSize);
        observer.observe(node);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!shouldRenderStarCatalog) return undefined;
        if (starCatalog.length || starCatalogLoadFailed) return undefined;
        const controller = new AbortController();
        fetch(STARFIELD_CATALOG_URL, { signal: controller.signal })
            .then((response) => {
                if (!response.ok) throw new Error(`Failed to load star catalog: ${response.status}`);
                return response.json();
            })
            .then((payload) => setStarCatalog(buildStarCatalog(payload)))
            .catch((error) => {
                if (error?.name === 'AbortError') return;
                setStarCatalogLoadFailed(true);
            });
        return () => controller.abort();
    }, [shouldRenderStarCatalog, starCatalog.length, starCatalogLoadFailed]);

    useEffect(() => {
        if (!focusedKey) return;
        const focusedObject = skyObjects.find((object) => object.key === focusedKey);
        if (!focusedObject) return;
        setView((current) => ({
            ...current,
            centerAz: focusedObject.az,
            centerEl: clamp(focusedObject.el, -45, 85),
            fov: Math.min(current.fov, 75),
        }));
    }, [focusedKey, skyObjects]);

    useEffect(() => {
        if (fitAllSignal === lastFitAllSignalRef.current) return;
        lastFitAllSignalRef.current = fitAllSignal;
        setView({
            centerAz: 180,
            centerEl: 35,
            fov: DEFAULT_FOV_DEG,
        });
    }, [fitAllSignal]);

    const handlePointerDown = useCallback((event) => {
        if (!enableMapDragging) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        dragRef.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            view,
        };
    }, [enableMapDragging, view]);

    const handlePointerMove = useCallback((event) => {
        if (!enableMapDragging) return;
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;

        const dx = event.clientX - drag.x;
        const dy = event.clientY - drag.y;
        const degreesPerPixel = drag.view.fov / Math.max(1, Math.min(size.width, size.height));
        setView({
            ...drag.view,
            centerAz: normalizeDegrees(drag.view.centerAz - dx * degreesPerPixel),
            centerEl: clamp(drag.view.centerEl + dy * degreesPerPixel, -45, 88),
        });
    }, [enableMapDragging, size.height, size.width]);

    const handlePointerUp = useCallback((event) => {
        if (dragRef.current?.pointerId === event.pointerId) {
            dragRef.current = null;
        }
    }, []);

    const handleWheel = useCallback((event) => {
        if (!enableMapZooming) return;
        event.preventDefault();
        const factor = event.deltaY > 0 ? 1.08 : 0.92;
        setView((current) => ({
            ...current,
            fov: clamp(current.fov * factor, MIN_FOV_DEG, MAX_FOV_DEG),
        }));
    }, [enableMapZooming]);

    useEffect(() => {
        if (zoomInSignal === lastZoomInSignalRef.current) return;
        lastZoomInSignalRef.current = zoomInSignal;
        setView((current) => ({
            ...current,
            fov: clamp(current.fov * 0.86, MIN_FOV_DEG, MAX_FOV_DEG),
        }));
    }, [zoomInSignal]);

    useEffect(() => {
        if (zoomOutSignal === lastZoomOutSignalRef.current) return;
        lastZoomOutSignalRef.current = zoomOutSignal;
        setView((current) => ({
            ...current,
            fov: clamp(current.fov * 1.16, MIN_FOV_DEG, MAX_FOV_DEG),
        }));
    }, [zoomOutSignal]);

    useEffect(() => {
        if (resetZoomSignal === lastResetZoomSignalRef.current) return;
        lastResetZoomSignalRef.current = resetZoomSignal;
        setView((current) => ({
            ...current,
            fov: DEFAULT_FOV_DEG,
        }));
    }, [resetZoomSignal]);

    useEffect(() => {
        if (centerSunSignal === lastCenterSunSignalRef.current) return;
        lastCenterSunSignalRef.current = centerSunSignal;

        // Prefer selected/focused target; otherwise center on the Sun fallback target.
        const centerCandidate = (
            skyObjects.find((object) => object.key === focusedKey)
            || skyObjects.find((object) => String(object.name || '').trim().toLowerCase() === 'sun')
        );
        if (!centerCandidate) return;
        setView((current) => ({
            ...current,
            centerAz: centerCandidate.az,
            centerEl: clamp(centerCandidate.el, -45, 85),
        }));
    }, [centerSunSignal, focusedKey, skyObjects]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || size.width <= 0 || size.height <= 0) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(size.width * dpr);
        canvas.height = Math.floor(size.height * dpr);
        canvas.style.width = `${size.width}px`;
        canvas.style.height = `${size.height}px`;

        const ctx = canvas.getContext('2d');
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, size.width, size.height);

        const background = theme.palette.mode === 'dark' ? '#05070d' : '#f5f7fc';
        const textColor = theme.palette.text.primary;
        const mutedTextColor = theme.palette.text.secondary;
        const gridColor = theme.palette.mode === 'dark' ? 'rgba(160, 190, 255, 0.15)' : 'rgba(45, 65, 105, 0.15)';
        const horizonColor = theme.palette.mode === 'dark' ? 'rgba(120, 210, 190, 0.55)' : 'rgba(35, 120, 105, 0.45)';
        const rotatorLimitColor = theme.palette.mode === 'dark' ? 'rgba(255, 181, 71, 0.85)' : 'rgba(176, 92, 0, 0.82)';
        const skyGradient = ctx.createRadialGradient(
            size.width / 2,
            size.height / 2,
            0,
            size.width / 2,
            size.height / 2,
            Math.max(size.width, size.height) * 0.72,
        );
        if (theme.palette.mode === 'dark') {
            skyGradient.addColorStop(0, '#101827');
            skyGradient.addColorStop(1, background);
        } else {
            skyGradient.addColorStop(0, '#dfe9ff');
            skyGradient.addColorStop(1, background);
        }
        ctx.fillStyle = skyGradient;
        ctx.fillRect(0, 0, size.width, size.height);

        const drawPolyline = (points, color, width, dash = []) => {
            let started = false;
            let previous = null;
            ctx.save();
            ctx.strokeStyle = color;
            ctx.lineWidth = width;
            ctx.setLineDash(dash);
            ctx.beginPath();
            points.forEach((point) => {
                const projected = projectSkyPoint(point, view, size);
                if (!projected) {
                    started = false;
                    previous = null;
                    return;
                }
                const distance = previous ? Math.hypot(projected.x - previous.x, projected.y - previous.y) : 0;
                if (!started || distance > Math.max(size.width, size.height) * 0.45) {
                    ctx.moveTo(projected.x, projected.y);
                    started = true;
                } else {
                    ctx.lineTo(projected.x, projected.y);
                }
                previous = projected;
            });
            ctx.stroke();
            ctx.restore();
        };

        const drawHorizonTicks = () => {
            ctx.save();
            ctx.strokeStyle = horizonColor;
            ctx.fillStyle = mutedTextColor;
            ctx.lineWidth = 1;
            HORIZON_TICKS.forEach((tick) => {
                const projected = projectSkyPoint({ az: tick.az, el: 0 }, view, size);
                if (!projected) return;
                if (projected.x < -12 || projected.x > size.width + 12 || projected.y < -12 || projected.y > size.height + 12) {
                    return;
                }

                ctx.beginPath();
                ctx.moveTo(projected.x, projected.y - 5);
                ctx.lineTo(projected.x, projected.y + 5);
                ctx.stroke();

                if (tick.labelKey) {
                    drawText(ctx, t(`canvas.planetarium.cardinal.${tick.labelKey}`), projected.x, projected.y - 17, {
                        color: textColor,
                        font: '700 13px sans-serif',
                    });
                }
                drawText(ctx, tick.degree, projected.x, projected.y + 17, {
                    color: mutedTextColor,
                    font: '10px monospace',
                });
            });
            ctx.restore();
        };

        if (effectiveDisplayOptions.showGrid) {
            for (let az = 0; az < 360; az += 30) {
                const points = [];
                for (let el = -10; el <= 90; el += 2) points.push({ az, el });
                drawPolyline(points, gridColor, 1);
            }

            for (let el = -30; el <= 75; el += 15) {
                if (el === 0) continue;
                const points = [];
                for (let az = 0; az <= 360; az += 2) points.push({ az, el });
                drawPolyline(points, gridColor, 1);
            }
        }
        if (effectiveDisplayOptions.showHorizonCompass) {
            const horizonPoints = [];
            for (let az = 0; az <= 360; az += 2) horizonPoints.push({ az, el: 0 });
            drawPolyline(horizonPoints, horizonColor, 1.6);
            drawHorizonTicks();
        }
        if (normalizedRotatorMinElevation != null) {
            const minElevationPoints = [];
            for (let az = 0; az <= 360; az += 2) minElevationPoints.push({ az, el: normalizedRotatorMinElevation });
            drawPolyline(minElevationPoints, rotatorLimitColor, 1.5, [6, 4]);

            const labelAzCandidates = [
                normalizeDegrees(view.centerAz),
                0,
                90,
                180,
                270,
            ];
            const labelPoint = labelAzCandidates
                .map((az) => projectSkyPoint({ az, el: normalizedRotatorMinElevation }, view, size))
                .find((point) => (
                    point
                    && point.x >= 10
                    && point.x <= size.width - 10
                    && point.y >= 10
                    && point.y <= size.height - 10
                ));
            if (labelPoint) {
                drawText(ctx, `Min EL ${Math.round(normalizedRotatorMinElevation)}${String.fromCharCode(176)}`, labelPoint.x + 8, labelPoint.y - 8, {
                    color: rotatorLimitColor,
                    font: '700 11px sans-serif',
                    align: 'left',
                });
            }
        }

        if (effectiveDisplayOptions.showStarField) {
            starObjects.forEach((star) => {
                if (star.el < -12) return;
                const projected = projectSkyPoint(star, view, size);
                if (!projected) return;
                if (projected.x < -20 || projected.x > size.width + 20 || projected.y < -20 || projected.y > size.height + 20) return;

                const visibleAlpha = star.el >= 0 ? 1 : 0.22;
                const magFactor = clamp((6.7 - star.mag) / 7.8, 0.08, 1);
                const radius = star.mag <= 0 ? 2.6 : (star.mag <= 2 ? 1.9 : 0.65 + magFactor * 1.35);
                ctx.beginPath();
                ctx.arc(projected.x, projected.y, radius, 0, Math.PI * 2);
                ctx.fillStyle = resolveStarRgba(star.bv, visibleAlpha * clamp(magFactor + 0.25, 0.25, 1));
                ctx.fill();

                if (
                    effectiveDisplayOptions.showStarNames
                    && star.name
                    && star.mag <= NAMED_STAR_MAG_LIMIT
                    && view.fov <= 55
                    && star.el >= -4
                ) {
                    drawText(ctx, star.name, projected.x + 5, projected.y - 7, {
                        color: mutedTextColor,
                        font: '10px sans-serif',
                        align: 'left',
                    });
                }
            });
        }

        if (effectiveDisplayOptions.showConstellationLabels && view.fov <= 80) {
            constellationLabels.forEach((label) => {
                if (label.el < -10) return;
                const projected = projectSkyPoint(label, view, size);
                if (!projected) return;
                if (projected.x < 0 || projected.x > size.width || projected.y < 0 || projected.y > size.height) return;
                drawText(ctx, label.name, projected.x, projected.y, {
                    color: theme.palette.mode === 'dark' ? 'rgba(180, 205, 255, 0.38)' : 'rgba(50, 70, 120, 0.4)',
                    font: '700 11px sans-serif',
                });
            });
        }

        if (effectiveDisplayOptions.showPassCurves) {
            const nowMs = sceneDate.getTime();
            const maxFutureLeadMs = passCurves.reduce((maxLeadMs, curve) => {
                if (!Number.isFinite(curve?.startMs) || curve.startMs <= nowMs) return maxLeadMs;
                return Math.max(maxLeadMs, curve.startMs - nowMs);
            }, 0);
            passCurves.forEach((curve) => {
                const isSelected = selectedKeys.has(curve.key) || curve.key === focusedKey;
                const intensity = getPassCurveIntensity(curve, nowMs, maxFutureLeadMs);
                const selectedColor = alpha(theme.palette.warning.main, clamp(0.28 + intensity * 0.72, 0, 1));
                const unselectedColor = alpha(
                    theme.palette.mode === 'dark' ? '#8fb0ff' : '#3e6cc5',
                    clamp(0.12 + intensity * 0.46, 0, 1),
                );
                drawPolyline(
                    curve.points,
                    isSelected ? selectedColor : unselectedColor,
                    isSelected ? 2 : 1,
                    isSelected ? [] : [4, 5],
                );
            });
        }

        skyObjects.forEach((object) => {
            const isSelected = selectedKeys.has(object.key) || object.key === focusedKey;
            const isBelowHorizon = object.el < 0;
            // Keep ordinary below-horizon objects hidden, but preserve the focused target as a ghost marker.
            if (object.el < -25 && !isSelected) return;
            const projected = projectSkyPoint(object, view, size);
            if (!projected) return;
            if (projected.x < -30 || projected.x > size.width + 30 || projected.y < -30 || projected.y > size.height + 30) return;

            const markerRadius = isSelected ? 7 : (object.kind === 'target' ? 5 : 4);
            const belowHorizonColor = theme.palette.mode === 'dark' ? '#9aa3b2' : '#687386';
            const markerColor = isSelected && isBelowHorizon ? belowHorizonColor : object.color;
            const outlineColor = isSelected && isBelowHorizon ? belowHorizonColor : (isSelected ? theme.palette.warning.main : textColor);
            ctx.save();
            ctx.globalAlpha = isSelected && isBelowHorizon ? 0.52 : (object.visible ? 1 : 0.34);
            ctx.fillStyle = markerColor;
            ctx.strokeStyle = outlineColor;
            ctx.lineWidth = isSelected ? 2.6 : 1.4;
            if (isSelected && isBelowHorizon) {
                const arm = markerRadius + 4;
                ctx.lineWidth = 1.8;
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(projected.x - arm, projected.y);
                ctx.lineTo(projected.x - 3, projected.y);
                ctx.moveTo(projected.x + 3, projected.y);
                ctx.lineTo(projected.x + arm, projected.y);
                ctx.moveTo(projected.x, projected.y - arm);
                ctx.lineTo(projected.x, projected.y - 3);
                ctx.moveTo(projected.x, projected.y + 3);
                ctx.lineTo(projected.x, projected.y + arm);
                ctx.stroke();
                ctx.beginPath();
                ctx.arc(projected.x, projected.y, 2.2, 0, Math.PI * 2);
                ctx.fill();
            } else {
                ctx.beginPath();
                ctx.arc(projected.x, projected.y, markerRadius, 0, Math.PI * 2);
                ctx.fill();
                ctx.stroke();
            }
            ctx.restore();

            const shouldShowObjectLabel = object.kind === 'planet'
                ? effectiveDisplayOptions.showPlanetLabels
                : effectiveDisplayOptions.showTargetLabels;
            if (shouldShowObjectLabel) {
                const labelX = clamp(projected.x + markerRadius + 8, 8, size.width - 8);
                const labelY = isSelected && isBelowHorizon
                    ? clamp(projected.y - 7, 12, size.height - 22)
                    : clamp(projected.y - markerRadius - 4, 10, size.height - 10);
                drawText(ctx, object.name, labelX, labelY, {
                    color: outlineColor,
                    font: isSelected ? '700 12px sans-serif' : '11px sans-serif',
                    align: 'left',
                });
                if (isSelected && isBelowHorizon && object.kind === 'target') {
                    drawText(ctx, t('canvas.planetarium.target_below_horizon'), labelX, labelY + 13, {
                        color: belowHorizonColor,
                        font: '700 10px sans-serif',
                        align: 'left',
                    });
                }
            }
        });

        if (effectiveDisplayOptions.showRotatorCrosshair && normalizedRotatorCrosshair) {
            const projected = projectSkyPoint(normalizedRotatorCrosshair, view, size);
            if (
                projected
                && projected.x >= -40
                && projected.x <= size.width + 40
                && projected.y >= -40
                && projected.y <= size.height + 40
            ) {
                const crosshairColor = theme.palette.error.main;
                const contrastColor = theme.palette.mode === 'dark'
                    ? 'rgba(246, 249, 255, 0.92)'
                    : 'rgba(14, 19, 31, 0.88)';
                const arm = 12;
                const gap = 4;

                ctx.save();
                ctx.lineCap = 'round';
                ctx.lineWidth = 3.8;
                ctx.strokeStyle = contrastColor;
                ctx.beginPath();
                ctx.moveTo(projected.x - arm, projected.y);
                ctx.lineTo(projected.x - gap, projected.y);
                ctx.moveTo(projected.x + gap, projected.y);
                ctx.lineTo(projected.x + arm, projected.y);
                ctx.moveTo(projected.x, projected.y - arm);
                ctx.lineTo(projected.x, projected.y - gap);
                ctx.moveTo(projected.x, projected.y + gap);
                ctx.lineTo(projected.x, projected.y + arm);
                ctx.stroke();

                ctx.lineWidth = 1.8;
                ctx.strokeStyle = crosshairColor;
                ctx.beginPath();
                ctx.moveTo(projected.x - arm, projected.y);
                ctx.lineTo(projected.x - gap, projected.y);
                ctx.moveTo(projected.x + gap, projected.y);
                ctx.lineTo(projected.x + arm, projected.y);
                ctx.moveTo(projected.x, projected.y - arm);
                ctx.lineTo(projected.x, projected.y - gap);
                ctx.moveTo(projected.x, projected.y + gap);
                ctx.lineTo(projected.x, projected.y + arm);
                ctx.stroke();

                ctx.fillStyle = crosshairColor;
                ctx.beginPath();
                ctx.arc(projected.x, projected.y, 2.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        }

        if (effectiveDisplayOptions.showHud) {
            const viewLabel = t('canvas.planetarium.hud_view_label', {
                az: Math.round(view.centerAz),
                el: Math.round(view.centerEl),
                fov: Math.round(view.fov),
            });
            drawText(ctx, viewLabel, 10, 14, {
                color: mutedTextColor,
                font: '10px monospace',
                align: 'left',
            });

            if (observerName || timestamp) {
                const label = [observerName, timestamp].filter(Boolean).join(' - ');
                drawText(ctx, label, 10, size.height - 12, {
                    color: mutedTextColor,
                    font: '10px monospace',
                    align: 'left',
                });
            }
        }
    }, [
        effectiveDisplayOptions,
        constellationLabels,
        focusedKey,
        observerName,
        passCurves,
        selectedKeys,
        size,
        skyObjects,
        starObjects,
        normalizedRotatorCrosshair,
        normalizedRotatorMinElevation,
        t,
        theme,
        timestamp,
        view,
    ]);

    return (
        <Box
            ref={containerRef}
            sx={{
                width: '100%',
                height: '100%',
                position: 'relative',
                overflow: 'hidden',
                touchAction: enableMapDragging || enableMapZooming ? 'none' : 'auto',
                cursor: enableMapDragging ? 'grab' : 'default',
                '&:active': { cursor: enableMapDragging ? 'grabbing' : 'default' },
            }}
        >
            <canvas
                ref={canvasRef}
                aria-label={t('canvas.planetarium.aria_label')}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onWheel={handleWheel}
            />
            {!observerLocation ? (
                <Box
                    sx={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        p: 2,
                        pointerEvents: 'none',
                    }}
                >
                    <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
                        {t('canvas.planetarium.configure_location')}
                    </Typography>
                </Box>
            ) : null}
        </Box>
    );
}

export default React.memo(PlanetariumCanvas);
