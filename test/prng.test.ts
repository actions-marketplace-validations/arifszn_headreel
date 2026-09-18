import { describe, expect, it } from 'vitest';
import { createRng, hashSeed } from '../src/core/prng.js';

describe('prng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(hashSeed('arifszn:contribution-city'));
    const b = createRng(hashSeed('arifszn:contribution-city'));
    expect(Array.from({ length: 5 }, a)).toEqual(Array.from({ length: 5 }, b));
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(hashSeed('a'));
    const b = createRng(hashSeed('b'));
    expect(a()).not.toEqual(b());
  });

  it('stays in [0, 1)', () => {
    const rng = createRng(1);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});
