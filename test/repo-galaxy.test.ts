import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadFixture } from '../src/core/data/fixture.js';
import type { Repo, Repos } from '../src/core/data/repos.js';
import { parseOptions, renderBanner } from '../src/core/pipeline.js';
import { createRng, hashSeed } from '../src/core/prng.js';
import { registerFonts } from '../src/core/fonts.js';
import { renderFrames } from '../src/core/render/render.js';
import {
  buildGalaxy,
  planetColor,
  ringFor,
  selectRepos,
} from '../src/styles/repo-galaxy/galaxy.js';
import { repoGalaxy } from '../src/styles/repo-galaxy/index.js';

const FIXTURE = 'fixtures/arifszn.repos.json';
const DEFAULTS = parseOptions(repoGalaxy);

function repo(name: string, stars: number, extra: Partial<Repo> = {}): Repo {
  return {
    name,
    fork: false,
    stars,
    language: { name: 'TypeScript', color: '#3178c6' },
    pushedAt: '2026-09-01',
    ...extra,
  };
}

const data = (repos: Repo[]): Repos => ({ asOf: '2026-09-19', repos });

describe('ringFor', () => {
  it('places repos by days since the last push', () => {
    expect(ringFor('2026-09-19', '2026-09-19')).toBe(0);
    expect(ringFor('2026-08-20', '2026-09-19')).toBe(0);
    expect(ringFor('2026-08-19', '2026-09-19')).toBe(1);
    expect(ringFor('2025-09-19', '2026-09-19')).toBe(2);
    expect(ringFor('2020-01-01', '2026-09-19')).toBe(3);
  });
});

describe('selectRepos', () => {
  const repos = data([repo('a', 1), repo('f', 50, { fork: true }), repo('b', 9), repo('c', 9)]);

  it('drops forks unless included, and keeps the most starred', () => {
    const pick = (o: Record<string, string>) =>
      selectRepos(repos, parseOptions(repoGalaxy, o)).map((r) => r.name);
    expect(pick({})).toEqual(['b', 'c', 'a']);
    expect(pick({ include_forks: 'true' })).toEqual(['f', 'b', 'c', 'a']);
    expect(selectRepos(repos, { max_repos: 2, include_forks: false }).map((r) => r.name)).toEqual([
      'b',
      'c',
    ]);
  });
});

describe('planetColor', () => {
  it('lifts dark linguist colors and falls back to neutral', () => {
    const [r, g, b] = planetColor('#101f1f');
    expect(Math.max(r, g, b)).toBeGreaterThan(120);
    expect(planetColor('#ffffff')).toEqual([255, 255, 255]);
    expect(planetColor(null)).toEqual(planetColor(undefined));
  });
});

describe('buildGalaxy', () => {
  it('sizes planets by stars, labels the top three and counts languages', () => {
    const galaxy = buildGalaxy(
      data([
        repo('big', 1000),
        repo('mid', 10, { language: { name: 'Go', color: '#00ADD8' } }),
        repo('small', 1, { language: { name: 'Go', color: '#00ADD8' } }),
        repo('none', 0, { language: null }),
      ]),
      createRng(1),
      DEFAULTS,
    );
    const [big, mid, small, none] = galaxy.planets;
    expect(big!.r).toBeGreaterThan(mid!.r);
    expect(mid!.r).toBeGreaterThan(small!.r);
    expect(galaxy.planets.map((p) => p.label)).toEqual([true, true, true, false]);
    expect(none!.label).toBe(false);
    expect(galaxy.totalStars).toBe(1011);
    expect(galaxy.languages.map((l) => [l.name, l.count])).toEqual([
      ['Go', 2],
      ['TypeScript', 1],
    ]);
  });

  it('labels only repos with stars', () => {
    const galaxy = buildGalaxy(data([repo('a', 2), repo('b', 0)]), createRng(1), DEFAULTS);
    expect(galaxy.planets.map((p) => p.label)).toEqual([true, false]);
  });

  it('hides labels with labels: none', () => {
    const galaxy = buildGalaxy(
      data([repo('a', 3)]),
      createRng(1),
      parseOptions(repoGalaxy, { labels: 'none' }),
    );
    expect(galaxy.planets[0]!.label).toBe(false);
  });
});

describe('options', () => {
  it('has defaults and parses strings', () => {
    expect(DEFAULTS).toEqual({ max_repos: 20, include_forks: false, labels: 'top3' });
    expect(parseOptions(repoGalaxy, { max_repos: '5', include_forks: 'true' })).toMatchObject({
      max_repos: 5,
      include_forks: true,
    });
  });

  it('rejects out-of-range and unknown values', () => {
    expect(() => parseOptions(repoGalaxy, { max_repos: '31' })).toThrow(/max_repos/);
    expect(() => parseOptions(repoGalaxy, { include_forks: 'maybe' })).toThrow(/include_forks/);
    expect(() => parseOptions(repoGalaxy, { labels: 'all' })).toThrow(/labels/);
    expect(() => parseOptions(repoGalaxy, { orbit: '2' })).toThrow(/orbit/);
  });
});

describe('repo-galaxy banner', () => {
  it('renders the same bytes for the same data', { timeout: 60_000 }, async () => {
    const { profile, data } = await loadFixture(FIXTURE, repoGalaxy.data.schema);
    const input = {
      login: profile.login,
      data,
      identity: { name: profile.name, tagline: 'Tagline', website: 'https://example.com' },
    };
    const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
    const a = await renderBanner(repoGalaxy, input);
    const b = await renderBanner(repoGalaxy, input);
    expect(hash(a)).toBe(hash(b));
    expect(Buffer.from(a.subarray(0, 6)).toString('ascii')).toBe('GIF89a');
  });

  it(
    'loops seamlessly: phase 1 draws the same pixels as phase 0',
    { timeout: 60_000 },
    async () => {
      const { profile, data } = await loadFixture(FIXTURE, repoGalaxy.data.schema);
      registerFonts();
      const sketch = repoGalaxy.createSketch({
        login: profile.login,
        data,
        options: DEFAULTS,
        identity: { name: profile.name },
        rng: createRng(hashSeed(`${profile.login}:${repoGalaxy.id}`)),
      });
      // Two frames, drawn at phase 0 and phase 1.
      const [first, wrapped] = await renderFrames(
        { ...sketch, draw: (p, frame) => sketch.draw(p, frame, frame) },
        { width: 1280, height: 400, frames: 2 },
      );
      expect(Buffer.compare(Buffer.from(first!), Buffer.from(wrapped!))).toBe(0);
    },
  );

  it('renders an account without repositories', { timeout: 60_000 }, async () => {
    const gif = await renderBanner(repoGalaxy, {
      login: 'new-user',
      data: data([]),
      identity: { name: 'new-user' },
    });
    expect(gif.length).toBeGreaterThan(0);
  });
});
