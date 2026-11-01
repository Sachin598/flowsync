import { describe, expect, it } from 'vitest';
import { checklistProgress } from './utils';

describe('checklistProgress', () => {
  it('handles empty and undefined', () => {
    expect(checklistProgress(undefined)).toEqual({ done: 0, total: 0, pct: 0 });
    expect(checklistProgress([])).toEqual({ done: 0, total: 0, pct: 0 });
  });
  it('computes done count and percentage', () => {
    expect(checklistProgress([{ done: true }, { done: false }, { done: true }, { done: false }])).toEqual({ done: 2, total: 4, pct: 50 });
    expect(checklistProgress([{ done: true }])).toEqual({ done: 1, total: 1, pct: 100 });
  });
});
