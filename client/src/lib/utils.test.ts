import { describe, expect, it } from 'vitest';
import { isOverdue, localToday, positionAt } from './utils';

describe('positionAt', () => {
  it('places items between neighbours', () => {
    expect(positionAt([], 0)).toBe(1000);
    expect(positionAt([1000, 2000], 1)).toBe(1500);
    expect(positionAt([1000, 2000], 5)).toBe(3000);
  });
});

describe('isOverdue (calendar days, not instants)', () => {
  const TODAY = '2026-10-29';
  it('a task due today is NOT overdue; yesterday is', () => {
    expect(isOverdue('2026-10-29T00:00:00.000Z', 'todo', TODAY)).toBe(false);
    expect(isOverdue('2026-10-28T00:00:00.000Z', 'todo', TODAY)).toBe(true);
    expect(isOverdue('2026-10-30T00:00:00.000Z', 'todo', TODAY)).toBe(false);
  });
  it('finished or undated tasks are never overdue', () => {
    expect(isOverdue('2000-01-01', 'done', TODAY)).toBe(false);
    expect(isOverdue(undefined, 'todo', TODAY)).toBe(false);
  });
  it('defaults to the user\'s local today', () => {
    expect(localToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(isOverdue('2000-01-01', 'todo')).toBe(true);
    expect(isOverdue(`${localToday()}T00:00:00.000Z`, 'todo')).toBe(false);
  });
});
