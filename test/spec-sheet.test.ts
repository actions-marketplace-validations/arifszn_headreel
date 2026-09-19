import { createHash } from 'node:crypto';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AVATAR_GRID,
  fetchSpecSheet,
  normalizeAvatar,
  REPO_PAGES_MAX,
  specSheetSchema,
  type SpecSheet,
} from '../src/core/data/spec-sheet.js';
import { createGraphQLClient } from '../src/core/data/graphql.js';
import { loadFixture } from '../src/core/data/fixture.js';
import { parseOptions, renderBanner } from '../src/core/pipeline.js';
import { createRng } from '../src/core/prng.js';
import { registerFonts } from '../src/core/fonts.js';
import { renderFrames } from '../src/core/render/render.js';
import { canvasMeasure } from '../src/core/text.js';
import { specSheet } from '../src/styles/spec-sheet/index.js';
import { ACCENTS } from '../src/styles/spec-sheet/options.js';
import { paletteOf, pinnedOf } from '../src/styles/spec-sheet/palette.js';
import {
  dotRadius,
  BUILD,
  DISSOLVE,
  dotScale,
  DOT_MIN,
  halftoneDots,
  PITCH,
  sampleLuma,
  sphereLuma,
} from '../src/styles/spec-sheet/halftone.js';
import {
  asOfText,
  buildSheet,
  FRAMES,
  LAYOUT,
  typedChars,
} from '../src/styles/spec-sheet/sheet.js';

const FIXTURE = 'fixtures/arifszn.specsheet.json';

function mockFetch(body: unknown, init: ResponseInit = {}) {
  return vi.fn<typeof fetch>(async () => Response.json(body, init));
}

function client(fetchFn: typeof fetch) {
  return createGraphQLClient({ token: 't0k', fetch: fetchFn });
}

/** A one-page query response with the given stars per repo. */
function page(stars: number[], opts: { more?: boolean; cursor?: string; avatar?: string } = {}) {
  return {
    data: {
      user: {
        avatarUrl: opts.avatar ?? 'https://avatars.example/u.png',
        createdAt: '2018-11-15T00:00:00Z',
        followers: { totalCount: 837 },
        repositories: {
          totalCount: stars.length,
          pageInfo: { hasNextPage: opts.more ?? false, endCursor: opts.cursor ?? 'c1' },
          nodes: stars.map((s) => ({ stargazerCount: s })),
        },
        contributionsCollection: {
          contributionCalendar: { totalContributions: 2705 },
        },
      },
    },
  };
}

/** A 64x64 luma grid, one value. */
const flatLuma = (v: number): SpecSheet['avatar'] => ({
  size: AVATAR_GRID,
  luma: Buffer.alloc(64 * 64, v).toString('base64'),
});

const SAMPLE = {
  asOf: '2026-09-19',
  createdAt: '2018-11-15',
  followers: 837,
  stars: 3307,
  repos: 29,
  contributions: 2705,
  avatar: flatLuma(128),
};

describe('fetchSpecSheet', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sums stars over pages and reads the connection counts', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    fetchFn
      .mockResolvedValueOnce(Response.json(page([100, 23], { more: true, cursor: 'c2' })))
      .mockResolvedValueOnce(Response.json(page([7, 40], { cursor: 'c3' })));
    // The avatar fetch: a 64x64 grey PNG.
    const img = createCanvas(64, 64);
    const ictx = img.getContext('2d');
    ictx.fillStyle = '#808080';
    ictx.fillRect(0, 0, 64, 64);
    fetchFn.mockResolvedValueOnce(new Response(new Uint8Array(img.toBuffer('image/png'))));
    vi.stubGlobal('fetch', fetchFn);

    const data = await fetchSpecSheet(client(fetchFn), 'octo', new Date('2026-09-19T12:00:00Z'));
    // The GraphQL client shares the global fetch mock: 2 pages + 1 avatar.
    expect(fetchFn.mock.calls[0]![1]!.body).toContain('"after":null');
    expect(fetchFn.mock.calls[1]![1]!.body).toContain('"after":"c2"');
    expect(data.stars).toBe(170);
    expect(data.repos).toBe(2);
    expect(data.followers).toBe(837);
    expect(data.contributions).toBe(2705);
    expect(data.createdAt).toBe('2018-11-15');
    expect(data.asOf).toBe('2026-09-19');
    expect(data.avatar).toEqual(flatLuma(128));
  });

  it(`stops at ${REPO_PAGES_MAX} pages`, async () => {
    const fetchFn = mockFetch(page([1], { more: true }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.stubGlobal('fetch', fetchFn);
    const data = await fetchSpecSheet(client(fetchFn), 'octo', new Date('2026-09-19T12:00:00Z'));
    // 10 query pages, then one avatar attempt (which fails to the sphere).
    expect(fetchFn).toHaveBeenCalledTimes(REPO_PAGES_MAX + 1);
    expect(data.stars).toBe(REPO_PAGES_MAX);
    warn.mockRestore();
  });

  it('keeps the run alive when the avatar cannot be fetched', async () => {
    const fetchFn = vi.fn<typeof fetch>();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchFn.mockResolvedValueOnce(Response.json(page([5]))); // the query
    fetchFn.mockRejectedValueOnce(new TypeError('fetch failed')); // the avatar
    vi.stubGlobal('fetch', fetchFn);
    const data = await fetchSpecSheet(client(fetchFn), 'octo', new Date('2026-09-19T12:00:00Z'));
    expect(data.avatar).toBeNull();
    expect(data.stars).toBe(5);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('rejects a luma grid of the wrong length', () => {
    const bad = {
      ...SAMPLE,
      avatar: { size: AVATAR_GRID, luma: Buffer.alloc(10).toString('base64') },
    };
    expect(specSheetSchema.safeParse(bad).success).toBe(false);
    expect(specSheetSchema.safeParse(SAMPLE).success).toBe(true);
  });
});

describe('avatar normalization', () => {
  it('flattens transparency on white and averages each cell', async () => {
    // One 64x64 PNG: transparent left half, mid-grey right half.
    const img = createCanvas(64, 64);
    const ictx = img.getContext('2d');
    ictx.fillStyle = '#808080';
    ictx.fillRect(32, 0, 32, 64);
    const luma = normalizeAvatar(await loadImage(img.toBuffer('image/png')));
    expect(luma).toHaveLength(64 * 64);
    // Transparent -> white paper (no dot); grey -> its own luma.
    expect(luma[0]).toBe(255);
    expect(luma[63]).toBeCloseTo(128, 0);
  });

  it('area-averages a larger source into the 64x64 grid', async () => {
    // A 128x128 image, each quadrant a flat color; every cell spans 2x2 px.
    const img = createCanvas(128, 128);
    const ictx = img.getContext('2d');
    ictx.fillStyle = '#000000';
    ictx.fillRect(0, 0, 128, 128);
    const luma = normalizeAvatar(await loadImage(img.toBuffer('image/png')));
    expect(luma.every((v) => v === 0)).toBe(true);
  });
});

describe('halftone', () => {
  it('grows dots with ink and drops the pale and the rim', () => {
    expect(dotRadius(0, 0)).toBeCloseTo(PITCH * 0.55, 9);
    expect(dotRadius(255, 0)).toBeLessThan(DOT_MIN);
    // The outer 12% of the disc fades to nothing at the edge.
    expect(dotRadius(0, 0.99)).toBeLessThan(DOT_MIN);
    expect(dotRadius(0, 0.8)).toBeCloseTo(PITCH * 0.55, 9);
  });

  it('paces the sweep by ink: rim first, fronts spread over 0..1', () => {
    const black = Array.from({ length: 64 * 64 }, () => 0);
    const dots = halftoneDots(black, 1086, 200, 140, createRng(1));
    const byRim = [...dots].sort((a, b) => b.rim - a.rim);
    for (let i = 1; i < byRim.length; i++) {
      expect(byRim[i]!.front).toBeGreaterThanOrEqual(byRim[i - 1]!.front);
    }
    expect(byRim[0]!.front).toBeLessThan(0.01);
    expect(byRim.at(-1)!.front).toBeGreaterThan(0.99);
    // Half the ink sits outside the median front's radius, not half the dots.
    const inkOut = byRim.filter((d) => d.front < 0.5).reduce((s, d) => s + d.r * d.r, 0);
    const inkAll = dots.reduce((s, d) => s + d.r * d.r, 0);
    expect(inkOut / inkAll).toBeCloseTo(0.5, 1);
  });

  it('screens the disc on a 45-degree lattice', () => {
    const black = Array.from({ length: 64 * 64 }, () => 0);
    const dots = halftoneDots(black, 1086, 200, 140, createRng(1));
    // About 1,300 intersections inside the disc.
    expect(dots.length).toBeGreaterThan(1100);
    expect(dots.length).toBeLessThan(1600);
    for (const a of dots) {
      for (const b of dots) {
        if (a === b) continue;
        // Neighbouring centres sit PITCH apart at 45 degrees.
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < PITCH - 0.01) throw new Error('dots overlap');
      }
    }
  });

  it('samples the grid bilinearly', () => {
    const grid = Array.from({ length: 64 * 64 }, (_, i) => (i % 64 < 32 ? 0 : 255));
    expect(sampleLuma(grid, 0, 0)).toBe(0);
    expect(sampleLuma(grid, 1, 0)).toBe(255);
    expect(sampleLuma(grid, 0.5, 0)).toBeCloseTo(127.5, 3);
  });

  it('shades the fallback sphere with the seeded light', () => {
    const a = sphereLuma(createRng(1));
    const b = sphereLuma(createRng(1));
    const c = sphereLuma(createRng(2));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a).toHaveLength(64 * 64);
  });

  it('holds 1, dissolves to 0 and rebuilds as the dissolve reversed', () => {
    const dot = { x: 0, y: 0, r: 3, rim: 0.5, jitter: 0.5, front: 0.5 };
    expect(dotScale(dot, 0)).toBe(1);
    expect(dotScale(dot, DISSOLVE[0] - 1e-9)).toBe(1);
    expect(dotScale(dot, 0.5)).toBeLessThan(1);
    expect(dotScale(dot, BUILD[0])).toBe(0);
    for (let t = 0; t < 1; t += 0.001) {
      expect(dotScale(dot, t)).toBeLessThanOrEqual(1);
      // Mirror: the build at DISSOLVE[1] + d equals the dissolve at DISSOLVE[1] - d.
      if (t > DISSOLVE[0] && t < DISSOLVE[1]) {
        expect(dotScale(dot, BUILD[0] + (DISSOLVE[1] - t))).toBeCloseTo(dotScale(dot, t), 9);
      }
    }
    expect(dotScale(dot, BUILD[1])).toBe(1);
    expect(dotScale(dot, 1)).toBe(1);
  });

  it('dissolves every dot, rim to centre, within its phase', () => {
    const rims = [0, 0.25, 0.5, 0.75, 1];
    for (const jitter of [0, 1]) {
      const dots = rims.map((rim) => ({ x: 0, y: 0, r: 3, rim, jitter, front: 1 - rim }));
      for (const dot of dots) expect(dotScale(dot, BUILD[0] - 1e-9)).toBeLessThan(1e-6);
      const mid = dots.map((dot) => dotScale(dot, (DISSOLVE[0] + DISSOLVE[1]) / 2));
      for (let i = 1; i < mid.length; i++) expect(mid[i]!).toBeLessThanOrEqual(mid[i - 1]!);
    }
  });
});

describe('sheet model', () => {
  const identity = {
    name: 'Ariful Alam',
    tagline: 'builds things for the web',
    website: 'https://www.arifszn.com/',
    handle: '@arifszn',
  };
  const model = buildSheet(SAMPLE, identity, paletteOf({ accent: 'teal' }), createRng(1));

  it('prints the card copy', () => {
    expect(model.sinceText).toBe('SINCE 2018');
    expect(model.eyebrow).toBe('// GITHUB PROFILE · 19 SEP 2026');
    expect(model.stats.map((s) => s.value)).toEqual(['837', '3,307', '29', '2,705']);
    expect(asOfText('2026-09-19')).toBe('19 SEP 2026');
  });

  it('fits the name and the footer into their columns', () => {
    const measure = canvasMeasure('Space Grotesk', 700, 2);
    expect(measure(model.name.text, model.name.size)).toBeLessThanOrEqual(LAYOUT.nameColumn);
    const long = buildSheet(
      { ...SAMPLE, followers: 1234567 },
      { ...identity, name: ' Maximiliana Konstantinopoulos-Von Neumann ' },
      paletteOf({ accent: 'teal' }),
      createRng(1),
    );
    expect(long.name.size).toBeLessThan(56);
    const mono = canvasMeasure('JetBrains Mono', 400, 2);
    const site = model.footer.website!;
    expect(model.footer.websiteX + mono(site.text, site.size)).toBeLessThanOrEqual(560);
  });

  it('lays a 7-digit value out clear of its label', () => {
    const big = buildSheet(
      { ...SAMPLE, followers: 9999999, stars: 1234567 },
      identity,
      paletteOf({ accent: 'teal' }),
      createRng(1),
    );
    const mono = canvasMeasure('JetBrains Mono', 400, 1);
    const label = mono('CONTRIBUTIONS', 12);
    const value = canvasMeasure('JetBrains Mono', 400)(big.stats[3]!.value, 16);
    const left = LAYOUT.panel.right - LAYOUT.panel.pad;
    expect(LAYOUT.panel.left + LAYOUT.panel.pad + 22 + label).toBeLessThan(left - value - 8);
  });

  it('deletes rows bottom first, retypes them top first, complete at the holds', () => {
    const value = '2,705';
    const row = (r: number, t: number) => typedChars(value, r, 4, t);
    const f = (n: number) => n / FRAMES;
    expect(row(3, 0)).toEqual({ text: value, cursor: false });
    // Dissolve: row 3 deletes over its first 12 frames while row 0 still waits.
    expect(row(3, DISSOLVE[0] + f(6)).cursor).toBe(true);
    expect(row(0, DISSOLVE[0] + f(6))).toEqual({ text: value, cursor: false });
    expect(row(3, DISSOLVE[0] + f(12))).toEqual({ text: '', cursor: false });
    expect(row(0, BUILD[0] - f(1))).toEqual({ text: '', cursor: false });
    // Build: row 0 types first, row 3 last.
    const half = row(0, BUILD[0] + f(6));
    expect(half.cursor).toBe(true);
    expect(half.text.length).toBeGreaterThan(0);
    expect(half.text.length).toBeLessThan(value.length);
    expect(row(3, BUILD[0] + f(6))).toEqual({ text: '', cursor: false });
    expect(row(3, BUILD[0] + f(48))).toEqual({ text: value, cursor: false });
    expect(row(3, BUILD[1])).toEqual({ text: value, cursor: false });
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

  it('defaults to the gray accent and rejects unknown keys', () => {
    expect(parseOptions(specSheet)).toEqual({ accent: 'gray' });
    expect(parseOptions(specSheet, { accent: 'sienna' })).toEqual({ accent: 'sienna' });
    expect(() => parseOptions(specSheet, { accent: 'cyan' })).toThrow(/accent/);
    expect(() => parseOptions(specSheet, { theme: 'dark' })).toThrow();
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
    const p = paletteOf({ accent: 'teal' });
    expect(p.grid).toEqual([
      Math.round(22 * 0.06 + 245 * 0.94),
      Math.round(22 * 0.06 + 245 * 0.94),
      Math.round(26 * 0.06 + 242 * 0.94),
    ]);
    expect(p.accent).toEqual([30, 122, 94]);
    expect(pinnedOf(p)).toHaveLength(5);
  });

  it('prints monochrome with the gray accent, pinning the grey once', () => {
    const p = paletteOf({ accent: 'gray' });
    expect(p.accent).toEqual(p.muted);
    expect(pinnedOf(p)).toEqual([p.paper, p.ink, p.muted, p.grid]);
  });
});

describe('spec-sheet banner', () => {
  it('renders the same bytes for the same data', { timeout: 120_000 }, async () => {
    const { profile, data: fixture } = await loadFixture(FIXTURE, specSheet.data.schema);
    const input = {
      login: profile.login,
      data: fixture,
      identity: { name: profile.name, tagline: 'Tagline', website: 'https://example.com' },
    };
    const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
    const a = await renderBanner(specSheet, input);
    const b = await renderBanner(specSheet, input);
    expect(hash(a)).toBe(hash(b));
    expect(Buffer.from(a.subarray(0, 6)).toString('ascii')).toBe('GIF89a');
  });

  it('loops seamlessly: phase 1 draws the same pixels as phase 0', async () => {
    const { profile, data: fixture } = await loadFixture(FIXTURE, specSheet.data.schema);
    registerFonts();
    const sketch = specSheet.createSketch({
      login: profile.login,
      data: fixture,
      options: parseOptions(specSheet),
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
    const gif = await renderBanner(specSheet, {
      login: 'new-user',
      data: { ...SAMPLE, followers: 0, stars: 0, repos: 0, contributions: 0, avatar: null },
      identity: { name: 'new-user' },
    });
    expect(gif.length).toBeGreaterThan(0);
  });
});
