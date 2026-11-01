import { describe, expect, it } from 'vitest';
import { formatMinutes, parseDuration } from './utils';

describe('parseDuration', () => {
  it('understands common formats', () => {
    expect(parseDuration('90')).toBe(90);
    expect(parseDuration('45m')).toBe(45);
    expect(parseDuration('2h')).toBe(120);
    expect(parseDuration('1h30m')).toBe(90);
    expect(parseDuration('1h 30m')).toBe(90);
    expect(parseDuration('1.5h')).toBe(90);
    expect(parseDuration('1:30')).toBe(90);
  });
  it('rejects nonsense', () => {
    for (const bad of ['', 'abc', 'h', '1:75', '-5', '1h30']) expect(parseDuration(bad), bad).toBeNull();
  });
});

describe('formatMinutes', () => {
  it('formats hours and minutes', () => {
    expect(formatMinutes(0)).toBe('0m');
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(60)).toBe('1h');
    expect(formatMinutes(135)).toBe('2h 15m');
  });
});
