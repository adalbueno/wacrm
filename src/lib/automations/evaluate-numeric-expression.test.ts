import { describe, expect, it } from 'vitest';
import { evaluateNumericExpression } from './evaluate-numeric-expression';

describe('evaluateNumericExpression', () => {
  it('evaluates a bare number', () => {
    expect(evaluateNumericExpression('49.90')).toBe(49.9);
    expect(evaluateNumericExpression('8473')).toBe(8473);
  });

  it('divides — the "webhook sends cents" case', () => {
    expect(evaluateNumericExpression('8473 / 100')).toBeCloseTo(84.73);
  });

  it('supports +, -, *, / with standard precedence', () => {
    expect(evaluateNumericExpression('2 + 3 * 4')).toBe(14);
    expect(evaluateNumericExpression('(2 + 3) * 4')).toBe(20);
    expect(evaluateNumericExpression('10 - 2 - 3')).toBe(5);
    expect(evaluateNumericExpression('100 / 10 / 2')).toBe(5);
  });

  it('supports unary minus and plus', () => {
    expect(evaluateNumericExpression('-5')).toBe(-5);
    expect(evaluateNumericExpression('3 - -2')).toBe(5);
    expect(evaluateNumericExpression('+5')).toBe(5);
  });

  it('tolerates surrounding whitespace', () => {
    expect(evaluateNumericExpression('  8473 / 100  ')).toBeCloseTo(84.73);
  });

  it('returns null for division by zero', () => {
    expect(evaluateNumericExpression('10 / 0')).toBeNull();
  });

  it('returns null for empty or whitespace-only input', () => {
    expect(evaluateNumericExpression('')).toBeNull();
    expect(evaluateNumericExpression('   ')).toBeNull();
  });

  it('returns null for malformed input rather than throwing', () => {
    expect(evaluateNumericExpression('not a number')).toBeNull();
    expect(evaluateNumericExpression('8473 / ')).toBeNull();
    expect(evaluateNumericExpression('(8473 / 100')).toBeNull();
    expect(evaluateNumericExpression('8473 100')).toBeNull(); // trailing garbage
    expect(evaluateNumericExpression('1.2.3')).toBeNull();
  });

  it('returns null when a webhook field failed to interpolate (unresolved placeholder text)', () => {
    // interpolate() resolves an unmatched {{...}} to '', so this is
    // what a genuinely missing field looks like after interpolation —
    // must not silently become 0 via some clever coercion.
    expect(evaluateNumericExpression(' / 100')).toBeNull();
  });
});
