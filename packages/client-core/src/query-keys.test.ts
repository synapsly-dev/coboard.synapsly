import { describe, expect, it } from 'vitest';
import { affectedQueryKeys, queryKeys } from './query-keys.js';

describe('affectedQueryKeys', () => {
  it('maps task changes to project, detail, stats and workbench caches', () => {
    const keys = affectedQueryKeys({
      entity: 'task',
      type: 'updated',
      projectId: 'project-1',
      payload: { taskId: 'task-1' },
    });

    expect(keys).toContainEqual(queryKeys.board('project-1'));
    expect(keys).toContainEqual(queryKeys.task('task-1'));
    expect(keys).toContainEqual(queryKeys.prefixes.stats());
    expect(keys).toContainEqual(queryKeys.prefixes.workbench());
  });
});
