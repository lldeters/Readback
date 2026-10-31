import { describe, expect, it } from 'vitest';
import { MAX_REPORTED_LENGTH, describeError, truncate } from '../src/text';

describe('truncate', () => {
  it('keeps short text', () => {
    expect(truncate('short')).toBe('short');
    expect(truncate('x'.repeat(MAX_REPORTED_LENGTH))).toHaveLength(MAX_REPORTED_LENGTH);
  });

  it('cuts long text to the limit and marks the cut', () => {
    const result = truncate('x'.repeat(MAX_REPORTED_LENGTH + 1));
    expect(result).toHaveLength(MAX_REPORTED_LENGTH);
    expect(result.endsWith('…')).toBe(true);
  });

  it('never splits a surrogate pair', () => {
    // '😀' is two UTF-16 code units; the cut would fall between them.
    const result = truncate(`abc😀def`, 5);
    expect(result).toBe('abc…');
    expect(truncate(`ab😀def`, 5)).toBe('ab😀…');
  });
});

describe('describeError', () => {
  it('describes errors with name and message', () => {
    expect(describeError(new TypeError('x is undefined'))).toBe('TypeError: x is undefined');
    expect(describeError(new RangeError())).toBe('RangeError');
  });

  it.each([
    ['a string', 'plain', 'plain'],
    ['a number', 42, '42'],
    ['undefined', undefined, 'undefined'],
    ['a symbol', Symbol('s'), 'Symbol(s)'],
    ['a bigint', 10n, '10'],
    ['null', null, 'null'],
    ['an object', { code: 7 }, '{"code":7}'],
    ['a function', () => 1, 'Unknown error'],
  ])('describes %s', (_name, value, expected) => {
    expect(describeError(value)).toBe(expected);
  });

  it('survives values that cannot be serialized', () => {
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(describeError(cyclic)).toBe('Unknown error');
  });
});
