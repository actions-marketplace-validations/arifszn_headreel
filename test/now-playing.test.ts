import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  fetchNowPlaying,
  lyricsFromHistory,
  nowPlayingSchema,
  nowPlayingWindow,
  pickRepo,
  WINDOW_DAYS,
  type Candidate,
} from '../src/core/data/now-playing.js';
import { loadFixture } from '../src/core/data/fixture.js';
import { parseOptions, renderBanner } from '../src/core/pipeline.js';
import { createRng, hashSeed } from '../src/core/prng.js';
import { registerFonts } from '../src/core/fonts.js';
import { renderFrames } from '../src/core/render/render.js';
import { nowPlaying } from '../src/styles/now-playing/index.js';
import { ACCENTS, THEMES } from '../src/styles/now-playing/options.js';
import { ACCENT_VALUES, paletteOf } from '../src/styles/now-playing/palette.js';
import { languageBandColor, meterBars } from '../src/styles/now-playing/deck.js';
import {
  IDENTITY_COLUMN,
  lyricLayout,
  promptFor,
  TAPE_NAME_WIDTH,
  tapeLabel,
} from '../src/styles/now-playing/sketch.js';
import { canvasMeasure } from '../src/core/text.js';
import type { NowPlaying } from '../src/core/data/now-playing.js';

const FIXTURE = 'fixtures/arifszn.nowplaying.json';
const DEFAULTS = parseOptions(nowPlaying);
const DAY_MS = 86_400_000;

function candidate(partial: Partial<Candidate>): Candidate {
  return {
    owner: 'arifszn',
    name: 'repo',
    commits: 1,
    days: Array.from({ length: WINDOW_DAYS }, () => 0),
    language: null,
    ...partial,
  };
}

function data(partial: Partial<NowPlaying> = {}): NowPlaying {
  return {
    asOf: '2026-09-19',
    status: 'playing',
    repo: { owner: 'arifszn', name: 'seemore', language: { name: 'TypeScript', color: '#3178c6' } },
    commits: 42,
    share: 0.5,
    days: [0, 3, 12, 0, 1, ...Array.from({ length: WINDOW_DAYS - 5 }, () => 0)],
    lyrics: ['feat: one', 'fix: two'],
    ...partial,
  };
}

describe('nowPlayingWindow', () => {
  it('covers 30 days ending on the run date, UTC', () => {
    expect(nowPlayingWindow(new Date('2026-09-19T23:30:00-05:00'))).toEqual({
      from: '2026-08-22',
      to: '2026-09-20',
      asOf: '2026-09-20',
    });
    expect(nowPlayingWindow(new Date('2026-09-19T12:00:00Z'))).toEqual({
      from: '2026-08-21',
      to: '2026-09-19',
      asOf: '2026-09-19',
    });
    const { from, to } = nowPlayingWindow(new Date('2026-01-01T12:00:00Z'));
    expect(Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)).toBe(
      (WINDOW_DAYS - 1) * DAY_MS,
    );
  });
});

describe('pickRepo', () => {
  it('picks the most commits in the window', () => {
    const picked = pickRepo([
      candidate({ name: 'quiet', commits: 3 }),
      candidate({ name: 'busy', commits: 9 }),
      candidate({ name: 'mid', commits: 5 }),
    ]);
    expect(picked?.name).toBe('busy');
  });

  it('breaks ties by latest active day, then name', () => {
    const days = (active: number) => {
      const d = Array.from({ length: WINDOW_DAYS }, () => 0);
      d[active] = 1;
      return d;
    };
    const picked = pickRepo([
      candidate({ name: 'older', commits: 9, days: days(4) }),
      candidate({ name: 'newer', commits: 9, days: days(7) }),
    ]);
    expect(picked?.name).toBe('newer');
    expect(
      pickRepo([candidate({ name: 'zeta', commits: 9 }), candidate({ name: 'alpha', commits: 9 })])
        ?.name,
    ).toBe('alpha');
  });

  it('drops private repositories before picking', () => {
    // The fetch filters privates; the picker only sees the survivors.
    expect(pickRepo([candidate({ name: 'public', commits: 1 })])?.name).toBe('public');
  });

  it('never picks an excluded repository, bare name or owner/name', () => {
    const repos = [
      candidate({ name: 'arifszn', commits: 30 }),
      candidate({ owner: 'vercel', name: 'next.js', commits: 20 }),
      candidate({ name: 'seemore', commits: 10 }),
    ];
    expect(pickRepo(repos, ['arifszn'])?.name).toBe('next.js');
    expect(pickRepo(repos, ['arifszn', 'vercel/next.js'])?.name).toBe('seemore');
    // Matching is trimmed and case-insensitive.
    expect(pickRepo(repos, ['ARIFSZN', ' seemore '])?.name).toBe('next.js');
    expect(pickRepo(repos, ['arifszn', 'vercel/next.js', 'seemore'])).toBeNull();
  });
});

describe('lyricsFromHistory', () => {
  it('drops merge commits and empty headlines, keeps the newest 8', () => {
    const nodes = [
      { messageHeadline: 'eighth', parents: { totalCount: 1 } },
      { messageHeadline: 'merge', parents: { totalCount: 3 } },
      { messageHeadline: '  ', parents: { totalCount: 1 } },
      { messageHeadline: 'seventh', parents: { totalCount: 1 } },
      ...Array.from({ length: 9 }, (_, i) => ({
        messageHeadline: `c${8 - i}`,
        parents: { totalCount: 1 },
      })),
    ];
    const lyrics = lyricsFromHistory(nodes);
    expect(lyrics).toHaveLength(8);
    expect(lyrics[0]).toBe('eighth');
    expect(lyrics[7]).toBe('c3');
    expect(lyrics).not.toContain('merge');
  });
});

describe('lyricLayout', () => {
  // Lines visible at `t`, keyed by lyric index and row, so frames compare.
  const visible = (n: number, t: number) =>
    lyricLayout(n, t)
      .filter((l) => l.alpha > 0.05)
      .map((l) => ({ index: l.index, base: Math.round(l.base), alpha: +l.alpha.toFixed(2) }))
      .sort((a, b) => a.base - b.base);

  it('moves no line in place across segment boundaries and the seam', () => {
    for (let n = 2; n <= 8; n++) {
      for (let k = 1; k <= n; k++) {
        expect(visible(n, k / n - 1e-9)).toEqual(visible(n, (k % n) / n));
      }
    }
  });

  it('shows each line once with two lyrics', () => {
    for (const t of [0, 0.3, 0.45, 0.9]) {
      const indexes = lyricLayout(2, t)
        .filter((l) => l.alpha > 0.4)
        .map((l) => l.index);
      expect(new Set(indexes).size).toBe(indexes.length);
    }
  });

  it('holds one line still and draws nothing without lyrics', () => {
    expect(lyricLayout(1, 0.5)).toEqual(lyricLayout(1, 0));
    expect(lyricLayout(0, 0.5)).toEqual([]);
  });
});

describe('promptFor', () => {
  it('fits the identity column with its cursor', () => {
    const measure = canvasMeasure('JetBrains Mono', 400);
    for (const status of ['playing', 'last-played', 'empty'] as const) {
      expect(measure(promptFor(status), 13) + 11).toBeLessThanOrEqual(IDENTITY_COLUMN);
    }
  });
});

describe('tapeLabel', () => {
  const measure = canvasMeasure('Caveat', 400);

  it('writes owner/name on one line when it fits', () => {
    expect(tapeLabel('arifszn', 'seemore', measure).map((l) => l.text)).toEqual([
      'arifszn/seemore',
    ]);
  });

  it('splits a long name over two lines that stay on the label', () => {
    const lines = tapeLabel('monstar-lab-oss', 'laravel-mongo-auto-sync-extended', measure);
    expect(lines.map((l) => l.text)).toEqual([
      'monstar-lab-oss/',
      'laravel-mongo-auto-sync-extended',
    ]);
    const cut = tapeLabel('o'.repeat(39), 'r'.repeat(100), measure);
    for (const line of [...lines, ...cut]) {
      expect(measure(line.text, line.size)).toBeLessThanOrEqual(TAPE_NAME_WIDTH);
    }
    expect(cut[1]!.text.endsWith('…')).toBe(true);
  });
});

describe('meterBars', () => {
  it('scales by the busiest day, zero stays zero', () => {
    const bars = meterBars([0, 9, 1, 0]);
    expect(bars[1]).toBe(1);
    expect(bars[2]).toBeCloseTo(Math.sqrt(1 / 9));
    expect(bars[0]).toBe(0);
    expect(meterBars(Array.from({ length: WINDOW_DAYS }, () => 0))).toEqual(
      Array.from({ length: WINDOW_DAYS }, () => 0),
    );
  });
});

describe('languageBandColor', () => {
  it('darkens pale linguist colors for white captions', () => {
    const [, , b] = languageBandColor('#f1e05a');
    expect(b).toBeLessThan(150);
    // Dark colors keep their hue.
    expect(languageBandColor('#4F5D95')).not.toEqual(languageBandColor('#f1e05a'));
    expect(languageBandColor(null)).toEqual(languageBandColor(undefined));
  });
});

describe('fetchNowPlaying', () => {
  const now = new Date('2026-09-19T12:00:00Z');

  function clientMock(responses: Record<string, unknown>) {
    const calls: { query: string; variables: Record<string, unknown> }[] = [];
    // Longest key first: 'query NowPlaying' would also match the fallback query.
    const keys = Object.keys(responses).sort((a, b) => b.length - a.length);
    const client = vi.fn(async (query: string, variables: Record<string, unknown> = {}) => {
      calls.push({ query, variables });
      for (const key of keys) {
        if (query.includes(key)) return responses[key];
      }
      throw new Error(`unexpected query: ${query}`);
    });
    return { client: client as never, calls };
  }

  it('picks the busiest public repository and fetches its lyrics', async () => {
    const { client, calls } = clientMock({
      'query NowPlaying': {
        user: {
          id: 'u1',
          contributionsCollection: {
            commitContributionsByRepository: [
              {
                repository: {
                  name: 'quiet',
                  owner: { login: 'arifszn' },
                  isPrivate: true,
                  primaryLanguage: { name: 'Go', color: '#00ADD8' },
                },
                contributions: { totalCount: 100, nodes: [] },
              },
              {
                repository: {
                  name: 'seemore',
                  owner: { login: 'arifszn' },
                  isPrivate: false,
                  primaryLanguage: { name: 'TypeScript', color: '#3178c6' },
                },
                contributions: {
                  totalCount: 7,
                  nodes: [
                    { occurredAt: '2026-09-19T10:00:00Z', commitCount: 4 },
                    { occurredAt: '2026-08-21T10:00:00Z', commitCount: 3 },
                  ],
                },
              },
            ],
          },
        },
      },
      'query NowPlayingCommits': {
        repository: {
          defaultBranchRef: {
            target: {
              history: {
                edges: [
                  { node: { messageHeadline: 'newest', parents: { totalCount: 1 } } },
                  { node: { messageHeadline: 'merge', parents: { totalCount: 2 } } },
                ],
              },
            },
          },
        },
      },
    });

    const result = await fetchNowPlaying(client, 'arifszn', now);
    expect(result).toMatchObject({
      asOf: '2026-09-19',
      status: 'playing',
      repo: {
        owner: 'arifszn',
        name: 'seemore',
        language: { name: 'TypeScript', color: '#3178c6' },
      },
      commits: 7,
      share: 1,
      lyrics: ['newest'],
    });
    expect(result.days[0]).toBe(3);
    expect(result.days[WINDOW_DAYS - 1]).toBe(4);
    expect(result.days.filter((d) => d > 0)).toHaveLength(2);

    // Two queries: the calendar, then the playing repository's commits since the window start.
    expect(calls).toHaveLength(2);
    expect(calls[1]!.variables).toMatchObject({
      owner: 'arifszn',
      name: 'seemore',
      id: 'u1',
      since: '2026-08-21T00:00:00Z',
    });
  });

  it('shows a repository owned by someone else as owner/name', async () => {
    const { client } = clientMock({
      'query NowPlaying': {
        user: {
          id: 'u1',
          contributionsCollection: {
            commitContributionsByRepository: [
              {
                repository: {
                  name: 'panel',
                  owner: { login: 'acme' },
                  isPrivate: false,
                  primaryLanguage: null,
                },
                contributions: { totalCount: 2, nodes: [] },
              },
            ],
          },
        },
      },
      'query NowPlayingCommits': { repository: { defaultBranchRef: null } },
    });
    const result = await fetchNowPlaying(client, 'arifszn', now);
    expect(result.repo).toMatchObject({ owner: 'acme', name: 'panel' });
    expect(result.lyrics).toEqual([]);
  });

  it('falls back to the most recently pushed repository when nothing is playing', async () => {
    const { client, calls } = clientMock({
      'query NowPlaying': {
        user: {
          id: 'u1',
          contributionsCollection: { commitContributionsByRepository: [] },
        },
      },
      'query NowPlayingFallback': {
        user: {
          repositories: {
            nodes: [
              {
                name: 'quiet',
                owner: { login: 'arifszn' },
                primaryLanguage: { name: 'Go', color: '#00ADD8' },
                defaultBranchRef: {
                  target: {
                    history: {
                      edges: [{ node: { messageHeadline: 'last', parents: { totalCount: 1 } } }],
                    },
                  },
                },
              },
            ],
          },
        },
      },
    });
    const result = await fetchNowPlaying(client, 'arifszn', now);
    expect(result).toMatchObject({
      status: 'last-played',
      repo: { name: 'quiet', language: { name: 'Go' } },
      commits: 0,
      share: 0,
      lyrics: ['last'],
    });
    expect(result.days.every((d) => d === 0)).toBe(true);
    expect(calls).toHaveLength(2);
  });

  it('renders an empty account with no cassette', async () => {
    const { client } = clientMock({
      'query NowPlaying': {
        user: {
          id: 'u1',
          contributionsCollection: { commitContributionsByRepository: [] },
        },
      },
      'query NowPlayingFallback': { user: { repositories: { nodes: [] } } },
    });
    const result = await fetchNowPlaying(client, 'arifszn', now);
    expect(result).toMatchObject({ status: 'empty', repo: null, commits: 0, lyrics: [] });
  });

  it('honors exclude, falling back when every candidate is excluded', async () => {
    const { client } = clientMock({
      'query NowPlaying': {
        user: {
          id: 'u1',
          contributionsCollection: {
            commitContributionsByRepository: [
              {
                repository: {
                  name: 'arifszn',
                  owner: { login: 'arifszn' },
                  isPrivate: false,
                  primaryLanguage: null,
                },
                contributions: { totalCount: 9, nodes: [] },
              },
            ],
          },
        },
      },
      'query NowPlayingFallback': { user: { repositories: { nodes: [] } } },
    });
    const result = await fetchNowPlaying(client, 'arifszn', now, { exclude: ['arifszn'] });
    expect(result.status).toBe('empty');
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

  it('keeps every accent readable on the display glass and the room', () => {
    for (const theme of THEMES) {
      for (const accent of ACCENTS) {
        const p = paletteOf({ theme, accent });
        const at = `${theme}/${accent}`;
        expect(ACCENT_VALUES[accent]).toEqual(p.accent);
        expect(contrast(p.accent, p.glass), at).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.identityAccent, p.bg), at).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.identityInk, p.bg), at).toBeGreaterThanOrEqual(7);
        expect(contrast(p.identityMuted, p.bg), at).toBeGreaterThanOrEqual(4.5);
        expect(contrast(p.plateInk, p.faceplate), at).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('keeps the dark theme accent the phosphor color', () => {
    const p = paletteOf({ theme: 'dark', accent: 'green' });
    expect(p.identityAccent).toEqual(p.accent);
  });
});

describe('options', () => {
  it('defaults to the dark theme, cyan accent and no exclusions', () => {
    expect(DEFAULTS).toEqual({ theme: 'dark', accent: 'cyan', exclude: [] });
    expect(
      parseOptions(nowPlaying, { theme: 'light', accent: 'orange', exclude: 'a, b ,,c' }),
    ).toEqual({
      theme: 'light',
      accent: 'orange',
      exclude: ['a', 'b', 'c'],
    });
  });

  it('rejects unknown themes, accents and keys', () => {
    expect(() => parseOptions(nowPlaying, { accent: 'pink' })).toThrow(/accent/);
    expect(() => parseOptions(nowPlaying, { theme: 'sepia' })).toThrow(/theme/);
    expect(() => parseOptions(nowPlaying, { labels: 'none' })).toThrow();
  });
});

describe('now-playing banner', () => {
  it('renders the same bytes for the same data', { timeout: 120_000 }, async () => {
    const { profile, data: fixture } = await loadFixture(FIXTURE, nowPlaying.data.schema);
    const input = {
      login: profile.login,
      data: fixture,
      identity: { name: profile.name, tagline: 'Tagline', website: 'https://example.com' },
    };
    const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
    const a = await renderBanner(nowPlaying, input);
    const b = await renderBanner(nowPlaying, input);
    expect(hash(a)).toBe(hash(b));
    expect(Buffer.from(a.subarray(0, 6)).toString('ascii')).toBe('GIF89a');
  });

  it('loops seamlessly: phase 1 draws the same pixels as phase 0', async () => {
    const { profile, data: fixture } = await loadFixture(FIXTURE, nowPlaying.data.schema);
    registerFonts();
    const sketch = nowPlaying.createSketch({
      login: profile.login,
      data: fixture,
      options: DEFAULTS,
      identity: { name: profile.name },
      rng: createRng(hashSeed(`${profile.login}:${nowPlaying.id}`)),
    });
    const [first, wrapped] = await renderFrames(
      { ...sketch, draw: (p, frame) => sketch.draw(p, frame, frame) },
      { width: 1280, height: 400, frames: 2 },
    );
    expect(Buffer.compare(Buffer.from(first!), Buffer.from(wrapped!))).toBe(0);
  });

  it('renders the empty state and the fallback state', { timeout: 120_000 }, async () => {
    const empty = await renderBanner(nowPlaying, {
      login: 'new-user',
      data: data({
        status: 'empty',
        repo: null,
        commits: 0,
        share: 0,
        days: Array.from({ length: WINDOW_DAYS }, () => 0),
        lyrics: [],
      }),
      identity: { name: 'new-user' },
    });
    expect(empty.length).toBeGreaterThan(0);
    const lastPlayed = await renderBanner(nowPlaying, {
      login: 'new-user',
      data: data({
        status: 'last-played',
        repo: { owner: 'new-user', name: 'old-repo', language: { name: 'Go', color: '#00ADD8' } },
        commits: 0,
        share: 0,
        days: Array.from({ length: WINDOW_DAYS }, () => 0),
        lyrics: ['chore: last commit'],
      }),
      identity: { name: 'new-user' },
    });
    expect(lastPlayed.length).toBeGreaterThan(0);
  });

  it('validates against its schema', () => {
    expect(nowPlayingSchema.safeParse(data()).success).toBe(true);
    expect(nowPlayingSchema.safeParse(data({ days: [1, 2, 3] })).success).toBe(false);
    expect(nowPlayingSchema.safeParse(data({ status: 'paused' as never })).success).toBe(false);
    expect(
      nowPlayingSchema.safeParse(data({ lyrics: Array.from({ length: 9 }, (_, i) => `c${i}`) }))
        .success,
    ).toBe(false);
  });
});
