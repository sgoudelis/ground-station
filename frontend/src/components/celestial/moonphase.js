import SunCalc from 'suncalc';

const MOON_PHASES = Object.freeze([
    { limit: 0.03, key: 'canvas.moon_phase.new_moon', fallback: 'New Moon' },
    { limit: 0.22, key: 'canvas.moon_phase.waxing_crescent', fallback: 'Waxing Crescent' },
    { limit: 0.28, key: 'canvas.moon_phase.first_quarter', fallback: 'First Quarter' },
    { limit: 0.47, key: 'canvas.moon_phase.waxing_gibbous', fallback: 'Waxing Gibbous' },
    { limit: 0.53, key: 'canvas.moon_phase.full_moon', fallback: 'Full Moon' },
    { limit: 0.72, key: 'canvas.moon_phase.waning_gibbous', fallback: 'Waning Gibbous' },
    { limit: 0.78, key: 'canvas.moon_phase.last_quarter', fallback: 'Last Quarter' },
    { limit: 0.97, key: 'canvas.moon_phase.waning_crescent', fallback: 'Waning Crescent' },
    { limit: 1.01, key: 'canvas.moon_phase.new_moon', fallback: 'New Moon' },
]);

export const normalizePhase = (phase) => {
    const numericPhase = Number(phase);
    if (!Number.isFinite(numericPhase)) return 0;
    return ((numericPhase % 1) + 1) % 1;
};

const resolveTranslation = (translate, key, fallback, options = undefined) => {
    if (typeof translate !== 'function') {
        return fallback;
    }
    return translate(key, {
        defaultValue: fallback,
        ...(options || {}),
    });
};

export const getMoonPhaseLabel = (phase, translate = null) => {
    const normalizedPhase = normalizePhase(phase);
    const phaseEntry = MOON_PHASES.find((entry) => normalizedPhase < entry.limit);
    if (!phaseEntry) {
        return resolveTranslation(translate, 'canvas.moon_phase.fallback', 'Moon Phase');
    }
    return resolveTranslation(translate, phaseEntry.key, phaseEntry.fallback);
};

export const getMoonIllumination = (date = new Date(), translate = null) => {
    const illumination = SunCalc.getMoonIllumination(date);
    const phase = normalizePhase(illumination?.phase);
    const fraction = Math.max(0, Math.min(1, Number(illumination?.fraction) || 0));
    const label = getMoonPhaseLabel(phase, translate);
    const percent = Math.round(fraction * 100);
    return {
        phase,
        fraction,
        label,
        description: resolveTranslation(
            translate,
            'canvas.moon_phase.description',
            `${label}, ${percent}% illuminated`,
            { label, percent },
        ),
    };
};

export const buildMoonShadowPath = (phase) => {
    const normalizedPhase = normalizePhase(phase);

    if (normalizedPhase >= 0.485 && normalizedPhase <= 0.515) {
        return '';
    }

    if (normalizedPhase <= 0.015 || normalizedPhase >= 0.985) {
        return 'M50,0 A50,50 0 1 1 49.99,0 Z';
    }

    if (normalizedPhase < 0.5) {
        const curveX = 100 - (normalizedPhase * 200);
        return `M50,0 A50,50 0 0,0 50,100 Q${curveX.toFixed(2)},50 50,0 Z`;
    }

    const curveX = 200 - (normalizedPhase * 200);
    return `M50,0 A50,50 0 0,1 50,100 Q${curveX.toFixed(2)},50 50,0 Z`;
};
