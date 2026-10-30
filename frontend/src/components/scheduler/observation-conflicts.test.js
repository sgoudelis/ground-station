import { describe, expect, it } from 'vitest';
import { findObservationConflict, getObservationForPass } from './observation-conflicts.js';

const pass = { event_start: '2026-10-30T18:39:32Z', event_end: '2026-10-30T18:54:42Z' };
const candidate = {
    id: 'meteor', enabled: true, pass,
    sessions: [{ sdr: { id: 'airspy' } }],
};
const blocker = {
    id: 'umka', enabled: true, status: 'scheduled', pass,
    sessions: [{ sdr: { id: 'b210' } }],
    rotator: { id: 'rotator-1' }, rig: { id: 'rig-1' },
};

describe('observation conflict detection', () => {
    it('allows simultaneous observations with separate hardware', () => {
        expect(findObservationConflict(candidate, [blocker])).toBeNull();
        expect(findObservationConflict({ ...candidate, sessions: [] }, [{ ...blocker, sessions: [] }])).toBeNull();
    });

    it('checks SDRs in every session', () => {
        const multipleSdrs = { ...candidate, sessions: [...candidate.sessions, { sdr: { id: 'b210' } }] };
        expect(findObservationConflict(multipleSdrs, [blocker])).toBe(blocker);
        const other = { ...blocker, sessions: [...blocker.sessions, { sdr: { id: 'airspy' } }] };
        expect(findObservationConflict(candidate, [other])).toBe(other);
    });

    it.each(['rig', 'rotator'])('blocks a shared %s even when SDRs differ', (resource) => {
        expect(findObservationConflict({ ...candidate, [resource]: blocker[resource] }, [blocker])).toBe(blocker);
    });

    it.each([null, '', 'none', 'None', '__none__'])('does not reserve unassigned hardware (%s)', (id) => {
        const unassigned = { sessions: [], rig: { id }, rotator: { id } };
        expect(findObservationConflict({ ...candidate, ...unassigned }, [{ ...blocker, ...unassigned }])).toBeNull();
    });

    it('excludes itself, disabled observations, and terminal statuses', () => {
        const shared = { ...blocker, sessions: candidate.sessions };
        const ignored = [
            { ...shared, id: candidate.id }, { ...shared, enabled: false },
            ...['completed', 'cancelled', 'failed', 'missed'].map((status) => ({ ...shared, status })),
        ];
        expect(findObservationConflict(candidate, ignored)).toBeNull();
        expect(findObservationConflict({ ...candidate, enabled: false }, [shared])).toBeNull();
        expect(findObservationConflict(candidate, [...ignored, shared])).toBe(shared);
        const running = { ...shared, status: 'RUNNING' };
        expect(findObservationConflict(candidate, [running])).toBe(running);
    });

    it('uses task execution windows on both sides, falling back to pass times', () => {
        const draft = { ...candidate, task_start: '2026-10-30T18:40:00Z', task_end: '2026-10-30T18:42:00Z' };
        const other = {
            ...blocker, sessions: candidate.sessions,
            task_start: '2026-10-30T18:48:00Z', task_end: '2026-10-30T18:50:00Z',
        };
        expect(findObservationConflict(draft, [other])).toBeNull();
        expect(findObservationConflict(candidate, [other])).toBe(other);
        expect(findObservationConflict(draft, [{ ...other, task_start: null, task_end: null }])).not.toBeNull();
    });

    it('applies the same five-minute scheduling margin as the generator', () => {
        const other = {
            ...blocker, sessions: candidate.sessions,
            pass: { event_start: '2026-10-30T18:59:41Z', event_end: '2026-10-30T19:10:00Z' },
        };
        expect(findObservationConflict(candidate, [other])).toBe(other);
        const outsideMargin = { ...other, pass: { ...other.pass, event_start: '2026-10-30T18:59:42Z' } };
        expect(findObservationConflict(candidate, [outsideMargin])).toBeNull();
    });

    it('keeps task times for the saved pass and clears them when a different pass is selected', () => {
        const draft = { ...candidate, task_start: '2026-10-30T18:40:00Z', task_end: '2026-10-30T18:50:00Z' };
        const samePass = getObservationForPass(draft, { ...pass, event_start: '2026-10-30T20:39:32+02:00' });
        expect(samePass.task_start).toBe(draft.task_start);
        expect(samePass.task_end).toBe(draft.task_end);
        const nextPass = { event_start: '2026-10-30T20:00:00Z', event_end: '2026-10-30T20:10:00Z' };
        expect(getObservationForPass(draft, nextPass)).toMatchObject({ pass: nextPass, task_start: null, task_end: null });
        expect(getObservationForPass(draft, null)).toMatchObject({ pass: null, task_start: null, task_end: null });
    });
});
