import { describe, expect, it } from 'vitest';
import { csvExportUrl } from './ExportMenu';

/**
 * The CSV export links (P3 §2) must carry the page's current time window exactly
 * and omit unset bounds (全部时间 exports all history server-side).
 */
describe('csvExportUrl', () => {
  it('carries both bounds when set', () => {
    expect(
      csvExportUrl('scores', {
        from: '2026-07-06T00:00:00.000Z',
        to: '2026-07-12T23:59:59.999Z',
      }),
    ).toBe(
      '/api/export/scores.csv?from=2026-07-06T00%3A00%3A00.000Z&to=2026-07-12T23%3A59%3A59.999Z',
    );
  });

  it('omits unset bounds entirely (全部时间)', () => {
    expect(csvExportUrl('tasks', { from: undefined, to: undefined })).toBe(
      '/api/export/tasks.csv',
    );
    expect(csvExportUrl('tasks', { from: '2026-07-01T00:00:00.000Z', to: undefined })).toBe(
      '/api/export/tasks.csv?from=2026-07-01T00%3A00%3A00.000Z',
    );
  });
});
