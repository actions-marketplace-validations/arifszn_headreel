import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadFixture } from '../src/core/data/fixture.js';
import type { Contributions } from '../src/core/data/contributions.js';
import { parseOptions, renderBanner } from '../src/core/pipeline.js';
import { createRng } from '../src/core/prng.js';
import { registerFonts } from '../src/core/fonts.js';
import { renderFrames } from '../src/core/render/render.js';
import { trailProfile } from '../src/styles/trail-profile/index.js';
import { ACCENTS } from '../src/styles/trail-profile/options.js';
import { paletteOf } from '../src/styles/trail-profile/palette.js';
import {
  buildProfile,
  contourInterval,
  GROUND_Y,
  MAX_LEVELS,
  SUMMIT_Y,
} from '../src/styles/trail-profile/profile.js';
import {
  altimeterLine,
  buildTrail,
  FRAMES,
  LAYOUT,
  markerAt,
  summitDates,
  walkDistance,
} from '../src/styles/trail-profile/trail.js';

const DAY_MS = 86_400_000;
const FIXTURE = 'fixtures/arifszn.contributions.json';

/** Weeks of totals, each week's count on its Thursday, from a Sunday. */
function data(totals: number[], from = '2025-09-21'): Contributions {
  const start = Date.parse(`${from}T00:00:00Z`);
  const weeks = totals.map((total, w) =>
    Array.from({ length: 7 }, (_, d) => ({
      date: new Date(start + (w * 7 + d) * DAY_MS).toISOString().slice(0, 10),
      weekday: d,
      count: d === 3 ? total : 0,
    })),
  );
  return {
    from,
    to: weeks.at(-1)!.at(-1)!.date,
    total: totals.reduce((s, t) => s + t, 0),
    weeks,
  };
}

function model(totals: number[]) {
  return buildTrail(data(totals), { name: 'Ariful Alam' }, paletteOf({ accent: 'sienna' }));
}

describe('contour interval', () => {
  it('picks the smallest 1-2-5 step that keeps at most 8 levels', () => {
    expect(contourInterval(166)).toBe(20); // floor(166/20) = 8
    expect(contourInterval(9)).toBe(2); // 9 levels at 1
    expect(contourInterval(1)).toBe(1);
    expect(contourInterval(0)).toBe(1); // never below 1 contribution
  });
});

describe('profile', () => {
  // Summit week 9 (90); empty runs 2-4, 6-8, 10-13 and 15-19; peaks at weeks
  // 1, 5 and 14 for the spot heights.
  const totals = [0, 60, 0, 0, 0, 30, 0, 0, 0, 90, 0, 0, 0, 0, 45, 0, 0, 0, 0, 0];
  const profile = buildProfile(data(totals));

  it('peaks at the summit height at the busiest week, ties to the latest', () => {
    expect(profile.summit).toMatchObject({ week: 9, total: 90 });
    expect(profile.profileY(profile.weekX(9))).toBeCloseTo(SUMMIT_Y, 6);
    expect(profile.profileY(profile.weekX(1))).toBeCloseTo(GROUND_Y - 60 * (780 / 90), 6);
    // A tie at weeks 3 and 7: the flag goes to the later week.
    const tied = buildProfile(data([10, 60, 0, 90, 0, 30, 0, 90, 0, 45, 0, 0, 0]));
    expect(tied.summit).toMatchObject({ week: 7, total: 90 });
  });

  it('never rises past the summit and lies on the ground across empty weeks and margins', () => {
    for (let x = 0; x <= profile.world.w; x += 12) {
      expect(profile.profileY(x), `x=${x}`).toBeGreaterThanOrEqual(SUMMIT_Y - 1e-6);
      expect(profile.profileY(x), `x=${x}`).toBeLessThanOrEqual(GROUND_Y + 1e-6);
    }
    // Middle of empty runs, flanked by empty weeks on both sides.
    for (const w of [3, 17]) {
      expect(profile.profileY(profile.weekX(w))).toBe(GROUND_Y);
    }
    expect(profile.profileY(0)).toBe(GROUND_Y);
    expect(profile.profileY(profile.world.w)).toBe(GROUND_Y);
  });

  it('draws levels at the interval, every 5th an index, strata under the line', () => {
    const big = buildProfile(data([0, 0, 166, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
    expect(big.interval).toBe(20);
    expect(big.levels.map((l) => l.height)).toEqual([20, 40, 60, 80, 100, 120, 140, 160]);
    expect(big.levels.map((l) => l.kind)).toEqual([
      'intermediate',
      'intermediate',
      'intermediate',
      'intermediate',
      'index',
      'intermediate',
      'intermediate',
      'intermediate',
    ]);
    expect(big.levels.length).toBeLessThanOrEqual(MAX_LEVELS);
    // One hill: each level is one span, inside it the trail is above the level
    // and just outside it is below.
    for (const level of big.levels) {
      expect(level.spans.length).toBe(1);
      const [a, b] = level.spans[0]!;
      expect(big.profileY((a + b) / 2)).toBeLessThanOrEqual(level.y + 1e-6);
      expect(big.profileY(a - 4)).toBeGreaterThan(level.y);
      expect(big.profileY(b + 4)).toBeGreaterThan(level.y);
    }
  });

  it('takes spot heights from the next busiest local maxima, spaced 4 weeks apart', () => {
    expect(profile.spots.map((s) => s.total)).toEqual([60, 45, 30]);
    const taken = [profile.summit!.week, ...profile.spots.map((s) => s.week)];
    profile.spots.forEach((s, i) => {
      taken.slice(0, i + 1).forEach((w) => expect(Math.abs(s.week - w)).toBeGreaterThanOrEqual(4));
    });
  });
});

describe('summit label', () => {
  it('spells dates inside one month, and both months across a boundary', () => {
    expect(summitDates('2026-03-12', '2026-03-18')).toBe('MAR 12 TO 18');
    expect(summitDates('2026-03-28', '2026-04-03')).toBe('MAR 28 TO APR 3');
  });
});

describe('walk pacing', () => {
  it('ramps in, cruises at one speed and ramps out', () => {
    const [n, ramp, length] = [100, 20, 800];
    expect(walkDistance(0, n, ramp, length)).toBe(0);
    expect(walkDistance(n, n, ramp, length)).toBe(length);
    const v = length / (n - ramp);
    for (let f = ramp; f < n - ramp; f++) {
      expect(walkDistance(f + 1, n, ramp, length) - walkDistance(f, n, ramp, length)).toBeCloseTo(
        v,
        9,
      );
    }
    for (let f = 0; f < n; f++) {
      const step = walkDistance(f + 1, n, ramp, length) - walkDistance(f, n, ramp, length);
      expect(step, `frame ${f}`).toBeGreaterThanOrEqual(0);
      expect(step, `frame ${f}`).toBeLessThanOrEqual(v + 1e-9);
    }
  });
});

describe('marker and altimeter', () => {
  const totals = [0, 60, 0, 20, 0, 30, 0, 20, 0, 90, 0, 0, 0, 0, 45, 0, 0, 0, 0, 0];
  const { profile, plan } = model(totals);

  it('walks on the profile to the summit at a steady screen speed', () => {
    const { walk, path } = plan;
    expect(path.length).toBe(walk.end - walk.start + 1);
    expect(path[0]).toBe(profile.weekX(0));
    expect(path.at(-1)).toBe(profile.summit!.x);
    for (let f = walk.start; f < walk.end; f++) {
      const m = markerAt(profile, plan, f)!;
      expect(m.walking, `frame ${f}`).toBe(true);
      expect(m.y).toBeCloseTo(profile.profileY(m.x), 9);
      // Along the trail, the walker never outruns the cruise speed.
      const next = markerAt(profile, plan, f + 1)!;
      const step = Math.hypot(next.x - m.x, next.y - m.y) * LAYOUT.walk.z;
      expect(step, `frame ${f}`).toBeLessThanOrEqual(LAYOUT.walk.speed + 0.2);
    }
    expect(markerAt(profile, plan, walk.end)!.x).toBe(profile.summit!.x);
  });

  it('starts a trail too long for the walk that far before the summit', () => {
    const long = model(Array.from({ length: 53 }, (_, i) => (i === 50 ? 100 : (i * 37) % 90)));
    expect(long.plan.walk.end - long.plan.walk.start).toBe(LAYOUT.walk.max);
    expect(long.plan.path[0]).toBeGreaterThan(long.profile.weekX(0));
    expect(long.plan.path.at(-1)).toBe(long.profile.summit!.x);
  });

  it('fades in on the descend and out on the summit arrival', () => {
    const { fadeIn, fadeOut } = plan;
    expect(markerAt(profile, plan, 0)!.alpha).toBe(0);
    expect(markerAt(profile, plan, fadeIn.start)!.alpha).toBe(0);
    expect(markerAt(profile, plan, (fadeIn.start + fadeIn.end) / 2)!.alpha).toBeCloseTo(0.5, 6);
    expect(markerAt(profile, plan, fadeIn.end)!.alpha).toBe(1);
    expect(markerAt(profile, plan, (fadeOut.start + fadeOut.end) / 2)!.alpha).toBeCloseTo(0.5, 6);
    expect(markerAt(profile, plan, fadeOut.end)!.alpha).toBe(0);
    expect(markerAt(profile, plan, 479)!.alpha).toBe(0);
  });

  it('reads the summit at rest and the week under the walker while it walks', () => {
    const s = profile.summit!;
    const summit = `SUMMIT ${s.total} · ${summitDates(s.from, s.to)}`;
    expect(altimeterLine(profile, plan, 10)).toBe(summit);
    const mid = Math.floor((plan.walk.start + plan.walk.end) / 2);
    const week = profile.weeks[profile.weekAt(markerAt(profile, plan, mid)!.x)]!;
    expect(altimeterLine(profile, plan, mid)).toBe(
      `ALT ${week.total} · ${summitDates(week.from, week.to)}`,
    );
    expect(altimeterLine(profile, plan, plan.walk.end)).toBe(summit);
    const empty = model([0, 0, 0]);
    expect(altimeterLine(empty.profile, empty.plan, 170)).toBeNull();
  });
});

describe('camera plan', () => {
  const totals = [0, 60, 0, 20, 0, 30, 0, 20, 0, 90, 0, 0, 0, 0, 45, 0, 0, 0, 0, 0];
  const { plan, profile } = model(totals);

  it('holds the summit on the busiest week and closes the loop on the wide shot', () => {
    const hold = plan.keys.find((k) => k.z === LAYOUT.summitZ)!;
    expect(hold.x).toBe(profile.summit!.x);
    expect(hold.y).toBe(profile.summit!.y + 30);
    const { frame: _a, ...last } = plan.keys.at(-1)!;
    const { frame: _b, ...first } = plan.keys[0]!;
    expect(last).toEqual(first);
    expect(plan.summitHold.end).toBe(FRAMES - LAYOUT.segments.pullBack);
  });

  it('gives a short walk spare frames to the holds, keeping the loop length', () => {
    const walkFrames = plan.walk.end - plan.walk.start;
    expect(walkFrames).toBeLessThan(LAYOUT.walk.max);
    const spare = LAYOUT.walk.max - walkFrames;
    expect(plan.fadeIn.start).toBe(LAYOUT.segments.wideHold + Math.floor(spare / 2));
    expect(plan.summitHold.end - plan.summitHold.start).toBe(
      LAYOUT.segments.summitHold + Math.ceil(spare / 2),
    );
  });

  it('walks at one key per frame, the camera only panning and the walker in frame', () => {
    const walk = plan.keys.filter((k) => k.frame >= plan.walk.start && k.frame <= plan.walk.end);
    expect(walk.length).toBe(plan.walk.end - plan.walk.start + 1);
    const { cx, cy } = LAYOUT.viewport;
    walk.forEach((k, i) => {
      expect(k.z).toBe(LAYOUT.walk.z);
      expect(k.y).toBe(LAYOUT.walk.y);
      if (i > 0) expect(k.x).toBeGreaterThanOrEqual(walk[i - 1]!.x);
      const m = markerAt(profile, plan, k.frame)!;
      const sx = cx + (m.x - k.x) * k.z;
      const sy = cy + (m.y - k.y) * k.z;
      expect(sx, `frame ${k.frame}`).toBeGreaterThan(LAYOUT.viewport.left);
      expect(sx, `frame ${k.frame}`).toBeLessThan(LAYOUT.width);
      expect(sy, `frame ${k.frame}`).toBeGreaterThan(20);
      expect(sy, `frame ${k.frame}`).toBeLessThan(LAYOUT.height - 12);
    });
  });

  it('frames the whole elevation band at the walk zoom', () => {
    const half = LAYOUT.height / 2 / LAYOUT.walk.z;
    expect(LAYOUT.walk.y - half).toBeLessThan(SUMMIT_Y - 88);
    expect(LAYOUT.walk.y + half).toBeGreaterThan(GROUND_Y + 30);
  });

  it('adds its segments up to the loop', () => {
    const s = LAYOUT.segments;
    expect(s.wideHold + s.descend + LAYOUT.walk.max + s.arrive + s.summitHold + s.pullBack).toBe(
      FRAMES,
    );
  });

  it('holds the wide shot for the whole loop when there is no summit', () => {
    const empty = model([0, 0, 0]);
    expect(empty.plan.keys).toHaveLength(2);
    const { frame: _a, ...end } = empty.plan.keys[1]!;
    const { frame: _b, ...start } = empty.plan.keys[0]!;
    expect(end).toEqual(start);
    expect(empty.plan.summitHold).toEqual({ start: 0, end: 0 });
    expect(empty.plan.walk).toEqual({ start: 0, end: 0 });
    expect(markerAt(empty.profile, empty.plan, 100)).toBeNull();
  });
});

describe('collar', () => {
  it('prints the summit line, contour interval and total', () => {
    const m = model([0, 0, 166, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(m.collar.summitLine).toBe('SUMMIT 166 · OCT 5 TO 11');
    expect(m.collar.intervalText).toBe('CONTOUR INTERVAL 20 CONTRIBUTIONS');
    expect(m.collar.total).toBe('166');
  });

  it('hides the summit and interval lines in the empty state', () => {
    const m = model([0, 0, 0]);
    expect(m.collar.summitLine).toBeNull();
    expect(m.collar.intervalText).toBeNull();
    expect(m.collar.total).toBe('0');
  });
});

describe('options and palette', () => {
  const lum = (c: readonly number[]) => {
    const [r, g, b] = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const contrast = (a: readonly number[], b: readonly number[]) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  };

  it('defaults to the sienna accent and rejects unknown keys', () => {
    expect(parseOptions(trailProfile)).toEqual({ accent: 'sienna' });
    expect(parseOptions(trailProfile, { accent: 'cobalt' })).toEqual({ accent: 'cobalt' });
    expect(() => parseOptions(trailProfile, { accent: 'cyan' })).toThrow(/accent/);
    expect(() => parseOptions(trailProfile, { theme: 'dark' })).toThrow();
  });

  it('keeps every text color readable on the paper, every accent', () => {
    for (const accent of ACCENTS) {
      const p = paletteOf({ accent });
      expect(contrast(p.ink, p.paper), accent).toBeGreaterThanOrEqual(7);
      expect(contrast(p.muted, p.paper), accent).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.accent, p.paper), accent).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('pins the flat colors the encoder keeps exact', () => {
    const p = paletteOf({ accent: 'green' });
    expect(p.strata).toEqual([
      Math.round(31 * 0.6 + 243 * 0.4),
      Math.round(107 * 0.6 + 239 * 0.4),
      Math.round(58 * 0.6 + 227 * 0.4),
    ]);
    expect(p.grid).toEqual([
      Math.round(43 * 0.15 + 243 * 0.85),
      Math.round(38 * 0.15 + 239 * 0.85),
      Math.round(32 * 0.15 + 227 * 0.85),
    ]);
    expect(p.grid[0]!).toBeGreaterThan(p.stipple[0]!);
  });
});

describe('trail-profile banner', () => {
  it('renders the same bytes for the same data', { timeout: 120_000 }, async () => {
    const { profile, data: fixture } = await loadFixture(FIXTURE, trailProfile.data.schema);
    const input = {
      login: profile.login,
      data: fixture,
      identity: { name: profile.name, tagline: 'Tagline', website: 'https://example.com' },
    };
    const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
    const a = await renderBanner(trailProfile, input);
    const b = await renderBanner(trailProfile, input);
    expect(hash(a)).toBe(hash(b));
    expect(Buffer.from(a.subarray(0, 6)).toString('ascii')).toBe('GIF89a');
  });

  it('loops seamlessly: phase 1 draws the same pixels as phase 0', async () => {
    const { profile, data: fixture } = await loadFixture(FIXTURE, trailProfile.data.schema);
    registerFonts();
    const sketch = trailProfile.createSketch({
      login: profile.login,
      data: fixture,
      options: parseOptions(trailProfile),
      identity: { name: profile.name },
      rng: createRng(1),
    });
    const [first, wrapped] = await renderFrames(
      { ...sketch, draw: (p, frame) => sketch.draw(p, frame, frame) },
      { width: 1280, height: 400, frames: 2 },
    );
    expect(Buffer.compare(Buffer.from(first!), Buffer.from(wrapped!))).toBe(0);
  });

  it('renders the empty state', { timeout: 120_000 }, async () => {
    const empty = await renderBanner(trailProfile, {
      login: 'new-user',
      data: data([0, 0, 0]),
      identity: { name: 'new-user' },
    });
    expect(empty.length).toBeGreaterThan(0);
  });
});
