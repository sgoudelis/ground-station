import { getSessions } from './session-utils.js';

// Match the generator's window in backend/observations/constants.py.
const CONFLICT_TOLERANCE_MS = 5 * 60 * 1000;

const normalizeResourceId = (value) => {
    const id = String(value ?? '').trim();
    return !id || ['none', '__none__'].includes(id.toLowerCase()) ? null : id;
};

const getResources = (observation) => ({
    sdrs: new Set(getSessions(observation)
        .map((session) => normalizeResourceId(session?.sdr?.id))
        .filter(Boolean)),
    rig: normalizeResourceId(observation?.rig?.id),
    rotator: normalizeResourceId(observation?.rotator?.id),
});

export const getObservationForPass = (observation, pass) => {
    const samePass = pass && observation?.pass
        && new Date(pass.event_start).getTime() === new Date(observation.pass.event_start).getTime()
        && new Date(pass.event_end).getTime() === new Date(observation.pass.event_end).getTime();
    return {
        ...observation,
        pass,
        // Elevation-based task times belong to one pass, not every dropdown option.
        task_start: samePass ? observation.task_start : null,
        task_end: samePass ? observation.task_end : null,
    };
};

export const findObservationConflict = (candidate, observations) => {
    if (!candidate?.pass || candidate.enabled === false) return null;
    const start = new Date(candidate.task_start || candidate.pass.event_start).getTime();
    const end = new Date(candidate.task_end || candidate.pass.event_end).getTime();
    const resources = getResources(candidate);

    return observations.find((observation) => {
        // Only observations that can still occupy hardware are blockers.
        if (candidate.id && observation.id === candidate.id) return false;
        if (!observation.enabled || !['scheduled', 'running'].includes(String(observation.status).toLowerCase())) {
            return false;
        }
        const otherStart = new Date(observation.task_start || observation.pass?.event_start).getTime();
        const otherEnd = new Date(observation.task_end || observation.pass?.event_end).getTime();
        if (!(start - CONFLICT_TOLERANCE_MS < otherEnd && end + CONFLICT_TOLERANCE_MS > otherStart)) {
            return false;
        }
        const other = getResources(observation);
        return [...resources.sdrs].some((id) => other.sdrs.has(id))
            || Boolean(resources.rig && resources.rig === other.rig)
            || Boolean(resources.rotator && resources.rotator === other.rotator);
    }) || null;
};
