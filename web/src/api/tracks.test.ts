import { describe, expect, it } from 'vitest';
import type { Track, TrackMember } from 'shared';
import { managedActiveTracks } from './tracks';

/**
 * Unit coverage for the manager-scoped track picker behind 「新建项目」 on the
 * 项目 page (spec 2026-07-11 §2): a 赛道运营经理 may only file new projects under
 * non-archived tracks they manage.
 */

function member(userId: string, role: TrackMember['role']): TrackMember {
  return {
    userId,
    displayName: `用户 ${userId}`,
    avatarColor: '#3b82f6',
    hasAvatar: false,
    role,
  };
}

function makeTrack(overrides: Partial<Track> & Pick<Track, 'id'>): Track {
  return {
    name: `赛道 ${overrides.id}`,
    key: 'TRK',
    description: null,
    weeklyGoal: null,
    archived: false,
    rank: 'a0',
    managers: [],
    members: [],
    projectCount: 0,
    createdBy: 'admin-1',
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

const TRACKS: Track[] = [
  makeTrack({ id: 't1', managers: [member('u1', 'manager')] }),
  makeTrack({ id: 't2', managers: [member('u2', 'manager')], members: [member('u1', 'member')] }),
  makeTrack({ id: 't3', managers: [member('u1', 'manager')], archived: true }),
];

describe('managedActiveTracks', () => {
  it('returns only the non-archived tracks the user manages', () => {
    expect(managedActiveTracks(TRACKS, 'u1').map((t) => t.id)).toEqual(['t1']);
  });

  it('does not count plain track membership as managing', () => {
    expect(managedActiveTracks(TRACKS, 'u2').map((t) => t.id)).toEqual(['t2']);
  });

  it('is empty for non-managers and when inputs are missing', () => {
    expect(managedActiveTracks(TRACKS, 'u3')).toEqual([]);
    expect(managedActiveTracks(undefined, 'u1')).toEqual([]);
    expect(managedActiveTracks(TRACKS, undefined)).toEqual([]);
  });
});
