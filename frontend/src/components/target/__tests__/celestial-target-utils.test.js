import { describe, expect, it } from 'vitest';
import {
  buildTargetKeyFromCelestialRow,
  buildTargetSlotNumberByTargetKey,
  parseTargetSlotNumber,
} from '../celestial-target-utils';

describe('parseTargetSlotNumber', () => {
  it('parses target slot numbers from target tracker IDs', () => {
    expect(parseTargetSlotNumber('target-1')).toBe(1);
    expect(parseTargetSlotNumber(' target-27 ')).toBe(27);
  });

  it('returns null for non-target tracker IDs', () => {
    expect(parseTargetSlotNumber('obs-1')).toBeNull();
    expect(parseTargetSlotNumber('default')).toBeNull();
    expect(parseTargetSlotNumber('target-0')).toBeNull();
  });
});

describe('buildTargetKeyFromCelestialRow', () => {
  it('prefers explicit target keys when available', () => {
    expect(buildTargetKeyFromCelestialRow({ target_key: 'mission:Voyager 1' })).toBe('mission:Voyager 1');
    expect(buildTargetKeyFromCelestialRow({ targetKey: 'body:rhea' })).toBe('body:rhea');
  });

  it('derives mission/body keys when explicit key is missing', () => {
    expect(buildTargetKeyFromCelestialRow({ target_type: 'mission', mission_id: 'voyager-1' })).toBe('mission:voyager-1');
    expect(buildTargetKeyFromCelestialRow({ target_type: 'mission', command: 'Voyager 1' })).toBe('missioncmd:Voyager 1');
    expect(buildTargetKeyFromCelestialRow({ targetType: 'body', bodyId: 'Rhea' })).toBe('body:rhea');
    expect(buildTargetKeyFromCelestialRow({ command: 'Cassini' })).toBe('missioncmd:Cassini');
  });
});

describe('buildTargetSlotNumberByTargetKey', () => {
  it('maps mission/body targets to their slot number and ignores non-target trackers', () => {
    const mapping = buildTargetSlotNumberByTargetKey([
      {
        tracker_id: 'target-3',
        tracking_state: {
          target_type: 'mission',
          mission_id: 'voyager-1',
        },
      },
      {
        tracker_id: 'target-2',
        tracking_state: {
          target_type: 'body',
          body_id: 'rhea',
        },
      },
      {
        tracker_id: 'obs-1',
        tracking_state: {
          target_type: 'mission',
          command: 'Ignored',
        },
      },
      {
        tracker_id: 'target-9',
        tracking_state: {
          target_type: 'satellite',
          norad_id: 25544,
        },
      },
    ]);

    expect(mapping).toEqual({
      'mission:voyager-1': 3,
      'body:rhea': 2,
    });
  });

  it('keeps the lowest slot number when duplicate assignments exist', () => {
    const mapping = buildTargetSlotNumberByTargetKey([
      {
        tracker_id: 'target-8',
        tracking_state: {
          target_type: 'mission',
          mission_id: 'voyager-1',
        },
      },
      {
        tracker_id: 'target-1',
        tracking_state: {
          target_type: 'mission',
          mission_id: 'voyager-1',
        },
      },
      {
        tracker_id: 'target-5',
        tracking_state: {
          target_type: 'mission',
          mission_id: 'voyager-1',
        },
      },
    ]);

    expect(mapping['mission:voyager-1']).toBe(1);
  });
});
