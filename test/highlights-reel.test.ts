import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadFixture } from '../src/core/data/fixture.js';
import type { Contributions } from '../src/core/data/contributions.js';
import type { Highlights } from '../src/core/data/highlights.js';
import { parseOptions, renderBanner } from '../src/core/pipeline.js';
import { createRng, hashSeed } from '../src/core/prng.js';
import { registerFonts } from '../src/core/fonts.js';
import { renderFrames } from '../src/core/render/render.js';
import { highlightsReel } from '../src/styles/highlights-reel/index.js';
import { ACCENTS, THEMES } from '../src/styles/highlights-reel/options.js';
import { paletteOf } from '../src/styles/highlights-reel/palette.js';
import {
  buildReel,
  FRAMES,
  languageColor,
  longestStreak,
} from '../src/styles/highlights-reel/reel.js';

const FIXTURE = 'fixtures/arifszn.highlights.json';
const DEFAULTS = parseOptions(highlightsReel);
const DAY_MS = 86_400_000;

/** Weeks of day counts, starting Sunday 2025-12-07. */
function contributions(weeks: number[][]): Contributions {
  let day = Date.UTC(2025, 11, 7);
  return {
    from: '2025-12-07',
    to: '2026-09-19',
    total: weeks.flat().reduce((a, b) => a + b, 0),
    weeks: weeks.map((counts) =>
      counts.map((count) => {
        const date = new Date(day).toISOString().slice(0, 10);
        const weekday = new Date(day).getUTCDay();
        day += DAY_MS;
        return { date, weekday, count };
      }),
    ),
  };
}

function highlights(partial: Partial<Highlights> = {}): Highlights {
  return {
    contributions: contributions([
      [1, 2, 3],
      [4, 5, 6, 7, 8, 9, 10],
    ]),
    topRepo: {
      name: 'repo',
      stars: 10,
      forks: 2,
      language: { name: 'TypeScript', color: '#3178c6' },
    },
    totalStars: 14,
    starredRepos: [
      { name: 'repo', stars: 10, color: '#3178c6' },
      { name: 'other', stars: 4, color: null },
    ],
    mergedPullRequests: 5,
    languages: [
      { name: 'TypeScript', color: '#3178c6', count: 3 },
      { name: 'Go', color: '#00ADD8', count: 2 },
    ],
    ...partial,
  };
}

const reel = (data: Highlights, raw: Record<string, string> = {}) =>
  buildReel(data, createRng(1), parseOptions(highlightsReel, raw));

describe('longestStreak', () => {
  it('counts consecutive active days, across week edges', () => {
    expect(
      longestStreak(
        contributions([
          [0, 1, 1],
          [1, 0, 1, 1, 1],
        ]),
      ),
    ).toBe(3);
    expect(
      longestStreak(
        contributions([
          [1, 1],
          [1, 1],
        ]),
      ),
    ).toBe(4);
    expect(
      longestStreak(
        contributions([
          [0, 0],
          [0, 0],
        ]),
      ),
    ).toBe(0);
  });
});

describe('buildReel', () => {
  it('films the cards in play order, with the busiest week opened', () => {
    const { cards, plan } = reel(highlights());
    expect(cards.map((c) => c.kind)).toEqual([
      'contributions',
      'top_repo',
      'pull_requests',
      'languages',
    ]);
    const contributionsCard = cards[0]!;
    if (contributionsCard.kind !== 'contributions') throw new Error('unreachable');
    expect(contributionsCard.busiest).toBe(1);
    expect(contributionsCard.busiestLabel).toBe('Dec 10 to 16');
    expect(contributionsCard.streak).toBe(10);
    // The loop starts and ends on the opening hold.
    const first = plan.keys[0]!;
    const last = plan.keys[plan.keys.length - 1]!;
    expect(last.frame).toBe(FRAMES);
    expect(last.x).toBe(first.x);
    expect(last.y).toBe(first.y);
    expect(last.z).toBe(first.z);
  });

  it('shows total stars, then pushes into the top repo', () => {
    const { cards, plan } = reel(highlights());
    const card = cards[1]!;
    if (card.kind !== 'top_repo') throw new Error('no top repo card');
    expect(card.totalStars).toBe(14);
    expect(card.plates.map((p) => p.name)).toEqual(['repo', 'other']);
    // The second push-in frames the pseudo card as a whole card is framed at the hold.
    expect(Math.max(...plan.keys.map((k) => k.z))).toBeCloseTo(0.62 / 0.2);
    expect(plan.focus.end).toBeGreaterThan(plan.focus.start);
    expect(plan.focus.start).toBeGreaterThan(plan.builds[1]!.start);
  });

  it('leaves zero cards out, except Contributions', () => {
    const { cards, plan } = reel(
      highlights({
        topRepo: null,
        mergedPullRequests: 0,
        languages: [],
        contributions: contributions([
          [0, 0],
          [0, 0, 0],
        ]),
      }),
    );
    expect(cards.map((c) => c.kind)).toEqual(['contributions']);
    // No busiest week, so the empty state holds one card with drift only.
    expect(plan.keys).toHaveLength(2);
  });

  it('darkens language colors for the white card', () => {
    const card = reel(highlights()).cards.find((c) => c.kind === 'languages');
    if (card?.kind !== 'languages') throw new Error('no languages card');
    expect(card.languages.map((l) => l.name)).toEqual(['TypeScript', 'Go']);
    expect(card.languages[0]!.color).toEqual(languageColor('#3178c6'));
  });

  it('carries the palette for the chosen theme and accent', () => {
    const dark = reel(highlights(), { theme: 'dark', accent: 'green' });
    expect(dark.palette).toEqual(paletteOf({ theme: 'dark', accent: 'green' }));
    const card = dark.cards.find((c) => c.kind === 'languages');
    if (card?.kind !== 'languages') throw new Error('no languages card');
    expect(card.languages[0]!.color).toEqual(languageColor('#3178c6', 'dark'));
  });
});

describe('languageColor', () => {
  it('darkens pale linguist colors for the white card', () => {
    const [, , b] = languageColor('#f1e05a');
    expect(b).toBeLessThan(120);
    expect(languageColor('#3178c6')).toEqual(languageColor('#3178c6'));
    expect(languageColor(null)).toEqual(languageColor(undefined));
  });

  it('lightens dark linguist colors for the dark card', () => {
    const lum = ([r, g, b]: readonly number[]) => r! + g! + b!;
    expect(lum(languageColor('#4F5D95', 'dark'))).toBeGreaterThan(lum(languageColor('#4F5D95')));
    expect(languageColor(null, 'dark')).not.toEqual(languageColor(null, 'light'));
  });
});

describe('palette', () => {
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

  it('keeps every accent readable as small type on both themes', () => {
    for (const theme of THEMES) {
      for (const accent of ACCENTS) {
        const p = paletteOf({ theme, accent });
        expect(contrast(p.accent, p.desk), `${theme}/${accent}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.onAccent, p.accent), `${theme}/${accent}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.ink, p.card)).toBeGreaterThanOrEqual(7);
        expect(contrast(p.soft, p.card)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});

describe('options', () => {
  it('defaults to the light theme with the cobalt accent', () => {
    expect(DEFAULTS).toEqual({ theme: 'light', accent: 'cobalt' });
    expect(parseOptions(highlightsReel, { theme: 'dark', accent: 'pink' })).toEqual({
      theme: 'dark',
      accent: 'pink',
    });
  });

  it('rejects unknown themes, accents and the dropped cards option', () => {
    expect(() => parseOptions(highlightsReel, { theme: 'sepia' })).toThrow(/theme/);
    expect(() => parseOptions(highlightsReel, { accent: '#ff0000' })).toThrow(/accent/);
    expect(() => parseOptions(highlightsReel, { cards: 'languages' })).toThrow();
  });
});

describe('highlights-reel banner', () => {
  it('renders the same bytes for the same data', { timeout: 120_000 }, async () => {
    const { profile, data } = await loadFixture(FIXTURE, highlightsReel.data.schema);
    const input = {
      login: profile.login,
      data,
      identity: { name: profile.name, tagline: 'Tagline', website: 'https://example.com' },
    };
    const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
    const a = await renderBanner(highlightsReel, input);
    const b = await renderBanner(highlightsReel, input);
    expect(hash(a)).toBe(hash(b));
    expect(Buffer.from(a.subarray(0, 6)).toString('ascii')).toBe('GIF89a');
  });

  it('loops seamlessly: phase 1 draws the same pixels as phase 0', async () => {
    const { profile, data } = await loadFixture(FIXTURE, highlightsReel.data.schema);
    registerFonts();
    const sketch = highlightsReel.createSketch({
      login: profile.login,
      data,
      options: DEFAULTS,
      identity: { name: profile.name },
      rng: createRng(hashSeed(`${profile.login}:${highlightsReel.id}`)),
    });
    // Two frames, drawn at phase 0 and phase 1.
    const [first, wrapped] = await renderFrames(
      { ...sketch, draw: (p, frame) => sketch.draw(p, frame, frame) },
      { width: 1280, height: 400, frames: 2 },
    );
    expect(Buffer.compare(Buffer.from(first!), Buffer.from(wrapped!))).toBe(0);
  });

  it('renders an empty account', { timeout: 120_000 }, async () => {
    const gif = await renderBanner(highlightsReel, {
      login: 'new-user',
      data: highlights({
        topRepo: null,
        mergedPullRequests: 0,
        languages: [],
        contributions: contributions([
          [0, 0],
          [0, 0, 0],
        ]),
      }),
      identity: { name: 'new-user' },
    });
    expect(gif.length).toBeGreaterThan(0);
  });
});
