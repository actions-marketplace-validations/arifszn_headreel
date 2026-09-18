import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Contributions } from '../src/core/data/contributions.js';
import { loadFixture } from '../src/core/data/fixture.js';
import { parseOptions, renderBanner } from '../src/core/pipeline.js';
import { createRng } from '../src/core/prng.js';
import { buildCity, monthLabels } from '../src/styles/contribution-city/city.js';
import { contributionCity } from '../src/styles/contribution-city/index.js';

const FIXTURE = 'fixtures/arifszn.contributions.json';

function calendar(counts: number[][], firstSunday = '2025-09-21'): Contributions {
  const start = Date.parse(`${firstSunday}T00:00:00Z`);
  const weeks = counts.map((week, w) =>
    week.map((count, d) => ({
      date: new Date(start + (w * 7 + d) * 86_400_000).toISOString().slice(0, 10),
      weekday: d,
      count,
    })),
  );
  const total = counts.flat().reduce((a, b) => a + b, 0);
  return { from: weeks[0]![0]!.date, to: weeks.at(-1)!.at(-1)!.date, total, weeks };
}

describe('buildCity', () => {
  it('marks the busiest days with beacons, ties broken chronologically', () => {
    const data = calendar([
      [0, 5, 9, 1, 0, 9, 0],
      [3, 0, 0, 2, 7, 0, 0],
    ]);
    const city = buildCity(data, createRng(1), 3);
    const beacons = city.buildings.filter((b) => b.beacon).map((b) => [b.w, b.d]);
    expect(beacons.sort()).toEqual([
      [0, 2],
      [0, 5],
      [1, 4],
    ]);
    expect(city.maxCount).toBe(9);
  });

  it('draws back rows first, then left to right', () => {
    const city = buildCity(
      calendar([
        [1, 1, 1, 1, 1, 1, 1],
        [1, 1, 1, 1, 1, 1, 1],
      ]),
      createRng(1),
      0,
    );
    const order = city.buildings.map((b) => `${b.d}:${b.w}`);
    expect(order.slice(0, 4)).toEqual(['0:0', '0:1', '1:0', '1:1']);
  });

  it('builds an empty city without beacons or arcs', () => {
    const city = buildCity(calendar([[0, 0, 0, 0, 0, 0, 0]]), createRng(1), 8);
    expect(city.maxCount).toBe(0);
    expect(city.buildings.every((b) => b.h === 0 && !b.beacon)).toBe(true);
    expect(city.arcs).toEqual([]);
  });
});

describe('monthLabels', () => {
  it('labels the first week of each month and drops a crowded partial first month', () => {
    // Starts 2025-09-21: September's label would sit one week before October's.
    const data = calendar(Array.from({ length: 10 }, () => [1, 1, 1, 1, 1, 1, 1]));
    expect(monthLabels(data)).toEqual([
      { w: 2, label: 'Oct' },
      { w: 6, label: 'Nov' },
    ]);
  });
});

describe('options', () => {
  it('defaults to 8 beacons and coerces strings', () => {
    expect(parseOptions(contributionCity)).toEqual({ beacons: 8 });
    expect(parseOptions(contributionCity, { beacons: '3' })).toEqual({ beacons: 3 });
  });

  it('rejects unknown keys and out-of-range values', () => {
    expect(() => parseOptions(contributionCity, { beacons: '11' })).toThrow(/beacons/);
    expect(() => parseOptions(contributionCity, { colour: 'red' })).toThrow(/colour/);
  });
});

describe('contribution-city banner', () => {
  it('renders the same bytes for the same data', { timeout: 60_000 }, async () => {
    const { profile, data } = await loadFixture(FIXTURE, contributionCity.data.schema);
    const input = {
      login: profile.login,
      data,
      identity: { name: profile.name, tagline: 'Tagline', website: 'https://example.com' },
    };
    const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
    const a = await renderBanner(contributionCity, input);
    const b = await renderBanner(contributionCity, input);
    expect(hash(a)).toBe(hash(b));
    expect(Buffer.from(a.subarray(0, 6)).toString('ascii')).toBe('GIF89a');
  });

  it('renders an empty calendar', { timeout: 60_000 }, async () => {
    const data = calendar(Array.from({ length: 53 }, () => [0, 0, 0, 0, 0, 0, 0]));
    const gif = await renderBanner(contributionCity, {
      login: 'new-user',
      data,
      identity: { name: 'new-user' },
    });
    expect(gif.length).toBeGreaterThan(0);
  });
});
