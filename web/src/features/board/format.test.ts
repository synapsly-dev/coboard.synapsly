import { describe, expect, it } from 'vitest';
import { completedOnTime, statusTimeInfo } from './format';

/**
 * 板块时间 helpers: which lifecycle timestamp a card shows per status, and the
 * 已完成-vs-DDL verdict. Datetimes here are offset-less ISO strings, which
 * date-fns parses as LOCAL wall-clock time — keeping the formatted expectations
 * deterministic regardless of the runner's timezone.
 */

const base = {
  createdAt: '2026-06-15T09:30:00',
  deliveredAt: null as string | null,
  completedAt: null as string | null,
};

describe('statusTimeInfo', () => {
  it('待认领 / 进行中 show 发布时间 (createdAt)', () => {
    expect(statusTimeInfo({ ...base, status: 'open' })).toEqual({
      prefix: '发布',
      text: '06-15 09:30',
    });
    expect(statusTimeInfo({ ...base, status: 'in_progress' })).toEqual({
      prefix: '发布',
      text: '06-15 09:30',
    });
  });

  it('待审阅 shows 提交时间 (deliveredAt); null → no chip', () => {
    expect(
      statusTimeInfo({ ...base, status: 'pending_review', deliveredAt: '2026-06-18T14:05:00' }),
    ).toEqual({ prefix: '提交', text: '06-18 14:05' });
    expect(statusTimeInfo({ ...base, status: 'pending_review' })).toBeNull();
  });

  it('已完成 shows 完成时间 (completedAt); null → no chip', () => {
    expect(
      statusTimeInfo({ ...base, status: 'done', completedAt: '2026-06-19T18:00:00' }),
    ).toEqual({ prefix: '完成', text: '06-19 18:00' });
    expect(statusTimeInfo({ ...base, status: 'done' })).toBeNull();
  });
});

describe('completedOnTime', () => {
  it('true when completed before or on the due day (date-only DDL)', () => {
    expect(completedOnTime('2026-06-18T10:00:00', '2026-06-20')).toBe(true);
    // Any time on the due day itself still counts as on time.
    expect(completedOnTime('2026-06-20T23:00:00', '2026-06-20')).toBe(true);
  });

  it('false when completed after the due day', () => {
    expect(completedOnTime('2026-06-21T00:30:00', '2026-06-20')).toBe(false);
    expect(completedOnTime('2026-07-01T10:00:00', '2026-06-20')).toBe(false);
  });

  it('null (no verdict) when either side is missing or invalid', () => {
    expect(completedOnTime(null, '2026-06-20')).toBeNull();
    expect(completedOnTime('2026-06-18T10:00:00', null)).toBeNull();
    expect(completedOnTime('not-a-date', '2026-06-20')).toBeNull();
  });
});
