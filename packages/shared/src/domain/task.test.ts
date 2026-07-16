import { describe, expect, it } from 'vitest';
import { activeTaskStatus } from './task.js';

describe('activeTaskStatus', () => {
  it('keeps a task open below the claimant minimum', () => {
    expect(activeTaskStatus(1, 2)).toBe('open');
  });

  it('moves a task in progress at the claimant minimum', () => {
    expect(activeTaskStatus(2, 2)).toBe('in_progress');
  });
});
