import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  fetchReceipt,
  receiptSchema,
  selectItems,
  WINDOW_DAYS,
  type Receipt,
} from '../src/core/data/receipt.js';
import { bestDay, currentStreak, longestStreak } from '../src/core/streaks.js';
import { loadFixture } from '../src/core/data/fixture.js';
import { parseOptions, renderBanner } from '../src/core/pipeline.js';
import { createRng, hashSeed } from '../src/core/prng.js';
import { registerFonts } from '../src/core/fonts.js';
import { renderFrames } from '../src/core/render/render.js';
import { receipt } from '../src/styles/receipt/index.js';
import { ACCENTS, THEMES } from '../src/styles/receipt/options.js';
import { paletteOf } from '../src/styles/receipt/palette.js';
import {
  barcodeWidths,
  buildReceipt,
  feedAt,
  PAPER,
  printDate,
  type Line,
} from '../src/styles/receipt/receipt.js';
import { canvasMeasure } from '../src/core/text.js';

const FIXTURE = 'fixtures/arifszn.receipt.json';
const DAY_MS = 86_400_000;
const measure = canvasMeasure('JetBrains Mono', PAPER.size);

function data(partial: Partial<Receipt> = {}): Receipt {
  return {
    asOf: '2026-09-19',
    from: '2025-09-20',
    to: '2026-09-19',
    total: 100,
    commits: 60,
    pullRequests: 20,
    reviews: 10,
    issues: 5,
    newRepos: 3,
    restricted: 2,
    items: [
      { name: 'seemore', language: { name: 'TypeScript', color: '#3178c6' }, commits: 40 },
      { name: 'headreel', language: null, commits: 20 },
    ],
    privateCommits: 0,
    days: Array.from({ length: WINDOW_DAYS }, (_, i) => (i < 7 ? 1 : 0)),
    ...partial,
  };
}

function model(d: Receipt = data(), raw: Record<string, string> = {}) {
  const options = parseOptions(receipt, raw);
  return buildReceipt(
    d,
    'arifszn',
    { name: 'Ariful Alam' },
    options,
    paletteOf(options),
    createRng(1),
  );
}

const text = (lines: Line[], part: string): Line | undefined =>
  lines.find((l) => l.left?.includes(part) || l.center?.includes(part) || l.right?.includes(part));

describe('streaks', () => {
  it('counts the longest run across the whole window', () => {
    expect(longestStreak([1, 1, 0, 1, 1, 1])).toBe(3);
    expect(longestStreak([0, 0, 0])).toBe(0);
    expect(longestStreak([])).toBe(0);
  });

  it('counts the current streak ending on the run date, or the day before', () => {
    expect(currentStreak([0, 1, 1, 1])).toBe(3);
    // The run date has no contributions yet; yesterday's streak stands.
    expect(currentStreak([0, 1, 1, 0])).toBe(2);
    expect(currentStreak([1, 1, 0, 0])).toBe(0);
    expect(currentStreak([0, 0, 0, 1])).toBe(1);
  });

  it('picks the best day, ties to the latest', () => {
    expect(bestDay([0, 5, 3, 5])).toEqual({ index: 3, count: 5 });
    expect(bestDay([0, 0, 0])).toBeNull();
  });
});

describe('selectItems', () => {
  const entry = (name: string, commits: number, extra: Record<string, unknown> = {}) => ({
    repository: {
      name,
      owner: { login: 'arifszn' },
      isPrivate: false,
      primaryLanguage: null,
      ...extra,
    },
    contributions: { totalCount: commits },
  });

  it('ranks by commits, ties by name, caps at 5', () => {
    const { items } = selectItems(
      [
        entry('zeta', 5),
        entry('alpha', 9),
        entry('mid', 9),
        entry('low', 1),
        ...['a', 'b', 'c'].map((n) => entry(n, 3)),
      ],
      'arifszn',
    );
    expect(items.map((i) => i.name)).toEqual(['alpha', 'mid', 'zeta', 'a', 'b']);
  });

  it('drops private repositories before ranking and sums their commits', () => {
    const { items, privateCommits } = selectItems(
      [entry('secret', 100, { isPrivate: true }), entry('public', 1)],
      'arifszn',
    );
    expect(items.map((i) => i.name)).toEqual(['public']);
    expect(privateCommits).toBe(100);
  });

  it('prints a repository the user does not own as owner/name', () => {
    const { items } = selectItems(
      [
        entry('panel', 2, {
          owner: { login: 'acme' },
          primaryLanguage: { name: 'Go', color: '#00ADD8' },
        }),
      ],
      'arifszn',
    );
    expect(items[0]).toMatchObject({ name: 'acme/panel', language: { name: 'Go' } });
  });
});

describe('fetchReceipt', () => {
  const now = new Date('2026-09-19T12:00:00Z');

  function clientMock(response: unknown) {
    const calls: { query: string; variables: Record<string, unknown> }[] = [];
    const client = vi.fn(async (query: string, variables: Record<string, unknown> = {}) => {
      calls.push({ query, variables });
      return response;
    });
    return { client: client as never, calls };
  }

  function calendarResponse(from: string, to: string) {
    // Days padded a little outside the window on both ends, as GitHub returns:
    // in-window days count 1, padded days 99 so a leak shows up loudly.
    const days: { date: string; contributionCount: number }[] = [];
    for (
      let t = Date.parse(`${from}T00:00:00Z`) - 2 * DAY_MS;
      t <= Date.parse(`${to}T00:00:00Z`) + 3 * DAY_MS;
      t += DAY_MS
    ) {
      const inside = t >= Date.parse(`${from}T00:00:00Z`) && t <= Date.parse(`${to}T00:00:00Z`);
      days.push({
        date: new Date(t).toISOString().slice(0, 10),
        contributionCount: inside ? 1 : 99,
      });
    }
    const weeks: { contributionDays: typeof days }[] = [];
    for (let i = 0; i < days.length; i += 7) weeks.push({ contributionDays: days.slice(i, i + 7) });
    return weeks;
  }

  it('covers the 365 days ending on the run date and drops padded days', async () => {
    const from = '2025-09-20';
    const to = '2026-09-19';
    const { client, calls } = clientMock({
      user: {
        contributionsCollection: {
          contributionCalendar: { totalContributions: 365, weeks: calendarResponse(from, to) },
          totalCommitContributions: 6,
          totalPullRequestContributions: 2,
          totalPullRequestReviewContributions: 2,
          totalIssueContributions: 1,
          totalRepositoryContributions: 1,
          restrictedContributionsCount: 0,
          commitContributionsByRepository: [
            entryOf('seemore', 5),
            entryOf('secret', 9, { isPrivate: true }),
          ],
        },
      },
    });
    const result = await fetchReceipt(client, 'arifszn', now);
    expect(result).toMatchObject({
      asOf: to,
      from,
      to,
      total: 365,
      commits: 6,
      pullRequests: 2,
      reviews: 2,
      issues: 1,
      newRepos: 1,
      restricted: 0,
      privateCommits: 9,
    });
    expect(result.days).toHaveLength(WINDOW_DAYS);
    expect(result.days.every((d) => d === 1)).toBe(true);
    expect(result.days.reduce((s, d) => s + d, 0)).toBe(WINDOW_DAYS);
    expect(result.items).toEqual([{ name: 'seemore', language: null, commits: 5 }]);
    expect(calls[0]!.variables).toMatchObject({ login: 'arifszn', from: `${from}T00:00:00Z` });
  });

  function entryOf(name: string, commits: number, extra: Record<string, unknown> = {}) {
    return {
      repository: {
        name,
        owner: { login: 'arifszn' },
        isPrivate: false,
        primaryLanguage: null,
        ...extra,
      },
      contributions: { totalCount: commits },
    };
  }

  it('works across a leap-day boundary', async () => {
    const leapNow = new Date('2024-03-01T00:00:00Z');
    const { client } = clientMock({
      user: {
        contributionsCollection: {
          contributionCalendar: {
            totalContributions: 365,
            weeks: calendarResponse('2023-03-03', '2024-03-01'),
          },
          totalCommitContributions: 0,
          totalPullRequestContributions: 0,
          totalPullRequestReviewContributions: 0,
          totalIssueContributions: 0,
          totalRepositoryContributions: 0,
          restrictedContributionsCount: 0,
          commitContributionsByRepository: [],
        },
      },
    });
    const result = await fetchReceipt(client, 'arifszn', leapNow);
    expect(result.from).toBe('2023-03-03');
    expect(result.to).toBe('2024-03-01');
    expect(result.days).toHaveLength(WINDOW_DAYS);
    expect(result.days.every((d) => d === 1)).toBe(true);
  });
});

describe('barcodeWidths', () => {
  // 2025-09-21 is a Sunday, so days chunk straight into weeks of 7.
  const from = '2025-09-21';
  const weeks = (...totals: number[]): number[] =>
    totals.flatMap((t) => Array.from({ length: 7 }, () => t));

  it('encodes quartiles of the non-zero weeks, zero weeks leave a gap', () => {
    // Active totals sorted [2, 4, 6, 8, 16, 24]: q1 4, q2 6, q3 8.
    expect(barcodeWidths(weeks(4, 8, 0, 16, 6, 24, 2), from)).toEqual([2, 4, 0, 4, 3, 4, 1]);
    expect(barcodeWidths(weeks(0, 0), from)).toEqual([0, 0]);
  });

  it('prints the only active week wide, and all-equal weeks equally', () => {
    expect(barcodeWidths(weeks(0, 9, 0), from)).toEqual([0, 4, 0]);
    expect(barcodeWidths(weeks(5, 5, 5), from)).toEqual([4, 4, 4]);
  });

  it('chunks by calendar weeks from Sunday', () => {
    // 2025-09-20 is a Saturday, so the first calendar week holds that one day
    // alone: week totals [9, 35, 14], not [39, 17, 2].
    expect(barcodeWidths([9, ...weeks(5), ...weeks(2)], '2025-09-20')).toEqual([2, 4, 4]);
  });
});

describe('buildReceipt', () => {
  it('prints the header, items with languages, and the private repos line', () => {
    const lines = model(data({ privateCommits: 88 })).lines;
    expect(text(lines, 'ARIFUL ALAM')?.double).toBe(true);
    expect(text(lines, 'github.com/arifszn')).toBeDefined();
    expect(text(lines, 'TXN')?.right).toBe('REG 01');
    expect(text(lines, '20 SEP 2025')).toBeDefined();
    expect(text(lines, 'seemore')?.right).toBe('40');
    expect(text(lines, '@ TypeScript')?.faded).toBe(true);
    // headreel has no language: one @ line in total, for seemore only.
    expect(lines.filter((l) => l.left?.startsWith('  @ '))).toHaveLength(1);
    expect(text(lines, 'private repos')?.right).toBe('88');
  });

  it('leaves zero-count lines out and prints TOTAL as the calendar total', () => {
    const lines = model(data({ issues: 0, newRepos: 0, restricted: 0, reviews: 0 })).lines;
    expect(text(lines, 'ISSUES')).toBeUndefined();
    expect(text(lines, 'REVIEWS')).toBeUndefined();
    expect(text(lines, 'TOTAL')?.right).toBe('100');
    // 60 + 20 = 80, so OTHER carries the difference.
    expect(text(lines, 'OTHER')?.right).toBe('20');
  });

  it('leaves OTHER out when the counts add up, and out when they exceed', () => {
    expect(text(model(data({ total: 100 })).lines, 'OTHER')).toBeUndefined();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(text(model(data({ total: 90 })).lines, 'OTHER')).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('prints streaks and the best day with its date', () => {
    const days = Array.from({ length: WINDOW_DAYS }, () => 0);
    days[3] = 1;
    days[4] = 1;
    days[5] = 1;
    days[100] = 9;
    days[WINDOW_DAYS - 1] = 1;
    const lines = model(data({ days })).lines;
    expect(text(lines, 'LONGEST STREAK')?.right).toBe('3 DAYS');
    expect(text(lines, 'CURRENT STREAK')?.right).toBe('1 DAYS');
    // 2025-09-20 + 100 days.
    expect(text(lines, `BEST DAY ${printDate('2025-12-29')}`)?.right).toBe('9');
  });

  it('prints no more than the items option, and totals only at 0', () => {
    const extra = data({
      items: [
        { name: 'a', language: null, commits: 5 },
        { name: 'b', language: null, commits: 4 },
      ],
    });
    expect(model(extra, { items: '1' }).lines.filter((l) => l.left === 'a')).toHaveLength(1);
    expect(model(extra, { items: '1' }).lines.filter((l) => l.left === 'b')).toHaveLength(0);
    const none = model(extra, { items: '0' }).lines;
    expect(text(none, 'ITEM')).toBeUndefined();
    expect(none.some((l) => l.left === 'a' || l.left === 'b')).toBe(false);
    expect(text(none, 'TOTAL')).toBeDefined();
  });

  it('cuts names against the QTY column and the header at the paper width', () => {
    const lines = model(
      data({ items: [{ name: 'r'.repeat(60), language: null, commits: 12345 }] }),
    ).lines;
    const item = lines.find((l) => l.right === '12345');
    expect(item?.left?.endsWith('…')).toBe(true);
    expect(
      measure(item!.left!, PAPER.size) + measure('12345', PAPER.size) + 12,
    ).toBeLessThanOrEqual(PAPER.text);
    expect(measure('ARIFUL ALAM', PAPER.size)).toBeLessThanOrEqual(PAPER.text);
  });

  it('prints the empty state: no items, no streaks, quiet barcode zone', () => {
    const empty = model(
      data({
        total: 0,
        commits: 0,
        pullRequests: 0,
        reviews: 0,
        issues: 0,
        newRepos: 0,
        restricted: 0,
        items: [],
        privateCommits: 0,
        days: Array.from({ length: WINDOW_DAYS }, () => 0),
      }),
    );
    expect(text(empty.lines, 'NO ITEMS')).toBeDefined();
    expect(text(empty.lines, 'TOTAL')?.right).toBe('0');
    expect(text(empty.lines, 'LONGEST STREAK')).toBeUndefined();
    expect(empty.barcode.every((w) => w === 0)).toBe(true);
    expect(empty.footer).toBe('ARIFSZN-2026');
  });
});

describe('feed plan', () => {
  it('feeds exactly one receipt per loop, wrapping at the seam', () => {
    const plan = model().feed;
    expect(plan.length).toBeGreaterThan(0);
    expect(feedAt(plan, 0).offset).toBe(0);
    expect(feedAt(plan, 1).offset).toBe(0);
    for (let i = 0; i <= 40; i++) {
      const { offset } = feedAt(plan, i / 40);
      expect(offset).toBeGreaterThanOrEqual(0);
      expect(offset).toBeLessThan(plan.length);
    }
  });

  it('blinks the LED on steps and keeps it lit while feeding and holding', () => {
    const plan = model().feed;
    const kind = (t: number) => plan.segments.find((s) => t * 400 < s.end)?.kind;
    expect(kind(0)).toBe('hold');
    expect(feedAt(plan, 0).led).toBe(true);
    const firstPause = plan.segments.find((s) => s.kind === 'pause')!;
    expect(feedAt(plan, (firstPause.start + firstPause.end) / 2 / 400).led).toBe(false);
    const feed = plan.segments.find((s) => s.kind === 'feed')!;
    expect(feedAt(plan, (feed.start + feed.end) / 2 / 400).led).toBe(true);
  });

  it('normalizes step, pause and hold weights to the loop', () => {
    const plan = model().feed;
    const last = plan.segments.at(-1)!;
    expect(Math.round(last.end)).toBe(400);
    const dist = plan.segments.reduce((s, g) => s + g.dist, 0);
    expect(dist).toBe(plan.length);
  });
});

describe('options', () => {
  it('defaults to the dark theme, cobalt accent and five items', () => {
    expect(parseOptions(receipt)).toEqual({ theme: 'dark', accent: 'cobalt', items: 5 });
    expect(parseOptions(receipt, { items: '0' })).toEqual({
      theme: 'dark',
      accent: 'cobalt',
      items: 0,
    });
  });

  it('rejects unknown keys, themes, accents and item counts', () => {
    expect(() => parseOptions(receipt, { theme: 'sepia' })).toThrow(/theme/);
    expect(() => parseOptions(receipt, { accent: 'cyan' })).toThrow(/accent/);
    expect(() => parseOptions(receipt, { items: '6' })).toThrow(/items/);
    expect(() => parseOptions(receipt, { labels: 'none' })).toThrow();
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

  it('keeps every text readable on its background, both themes and accents', () => {
    for (const theme of THEMES) {
      for (const accent of ACCENTS) {
        const p = paletteOf({ theme, accent });
        const at = `${theme}/${accent}`;
        expect(contrast(p.accent, p.counter), at).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.identityInk, p.counter), at).toBeGreaterThanOrEqual(7);
        expect(contrast(p.identityMuted, p.counter), at).toBeGreaterThanOrEqual(4.5);
        // The paper does not change with the theme.
        expect(contrast(p.ink, p.paper), at).toBeGreaterThanOrEqual(7);
        expect(contrast(p.fadedInk, p.paper), at).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('pins the flat colors the encoder keeps exact', () => {
    const p = paletteOf({ theme: 'light', accent: 'green' });
    expect(p.paper).toEqual(paletteOf({ theme: 'dark', accent: 'pink' }).paper);
  });
});

describe('receipt banner', () => {
  it('renders the same bytes for the same data', { timeout: 120_000 }, async () => {
    const { profile, data: fixture } = await loadFixture(FIXTURE, receipt.data.schema);
    const input = {
      login: profile.login,
      data: fixture,
      identity: { name: profile.name, tagline: 'Tagline', website: 'https://example.com' },
    };
    const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
    const a = await renderBanner(receipt, input);
    const b = await renderBanner(receipt, input);
    expect(hash(a)).toBe(hash(b));
    expect(Buffer.from(a.subarray(0, 6)).toString('ascii')).toBe('GIF89a');
  });

  it('loops seamlessly: phase 1 draws the same pixels as phase 0', async () => {
    const { profile, data: fixture } = await loadFixture(FIXTURE, receipt.data.schema);
    registerFonts();
    const sketch = receipt.createSketch({
      login: profile.login,
      data: fixture,
      options: parseOptions(receipt),
      identity: { name: profile.name },
      rng: createRng(hashSeed(`${profile.login}:${receipt.id}`)),
    });
    const [first, wrapped] = await renderFrames(
      { ...sketch, draw: (p, frame) => sketch.draw(p, frame, frame) },
      { width: 1280, height: 400, frames: 2 },
    );
    expect(Buffer.compare(Buffer.from(first!), Buffer.from(wrapped!))).toBe(0);
  });

  it('renders the empty state', { timeout: 120_000 }, async () => {
    const empty = await renderBanner(receipt, {
      login: 'new-user',
      data: data({
        total: 0,
        commits: 0,
        pullRequests: 0,
        reviews: 0,
        issues: 0,
        newRepos: 0,
        restricted: 0,
        items: [],
        days: Array.from({ length: WINDOW_DAYS }, () => 0),
      }),
      identity: { name: 'new-user' },
    });
    expect(empty.length).toBeGreaterThan(0);
  });

  it('validates against its schema', () => {
    expect(receiptSchema.safeParse(data()).success).toBe(true);
    expect(receiptSchema.safeParse(data({ days: [1, 2, 3] })).success).toBe(false);
    expect(
      receiptSchema.safeParse(
        data({
          items: Array.from({ length: 6 }, (_, i) => ({
            name: `r${i}`,
            language: null,
            commits: 1,
          })),
        }),
      ).success,
    ).toBe(false);
    expect(receiptSchema.safeParse(data({ total: -1 })).success).toBe(false);
  });
});
