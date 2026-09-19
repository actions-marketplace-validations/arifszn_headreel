import { describe, expect, it, vi } from 'vitest';
import {
  contributionWindow,
  contributionsSchema,
  fetchContributions,
} from '../src/core/data/contributions.js';
import { DataError } from '../src/core/data/errors.js';
import { createGraphQLClient } from '../src/core/data/graphql.js';
import { fetchHighlights, highlightsSchema } from '../src/core/data/highlights.js';
import { fetchProfile } from '../src/core/data/profile.js';
import { fetchRepos, reposSchema } from '../src/core/data/repos.js';
import { resolveToken } from '../src/core/data/token.js';

function mockFetch(body: unknown, init: ResponseInit = {}) {
  return vi.fn<typeof fetch>(async () => Response.json(body, init));
}

function client(fetchFn: typeof fetch) {
  return createGraphQLClient({ token: 't0k', fetch: fetchFn });
}

async function expectDataError(p: Promise<unknown>, code: DataError['code']) {
  const err = await p.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(DataError);
  expect((err as DataError).code).toBe(code);
  return err as DataError;
}

describe('contributionWindow', () => {
  it('covers 365 days ending on the run date, UTC', () => {
    expect(contributionWindow(new Date('2026-09-18T23:30:00-05:00'))).toEqual({
      from: '2025-09-20',
      to: '2026-09-19',
    });
  });
});

describe('graphql client', () => {
  it('sends the token and query', async () => {
    const fetchFn = mockFetch({ data: { ok: true } });
    await client(fetchFn)('query { ok }', { a: 1 });
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://api.github.com/graphql');
    expect((init!.headers as Record<string, string>).authorization).toBe('bearer t0k');
    expect(JSON.parse(init!.body as string)).toEqual({
      query: 'query { ok }',
      variables: { a: 1 },
    });
  });

  it('maps 401 to auth', async () => {
    await expectDataError(client(mockFetch({}, { status: 401 }))('q'), 'auth');
  });

  it('maps NOT_FOUND to not_found', async () => {
    const body = {
      data: { user: null },
      errors: [
        { type: 'NOT_FOUND', message: "Could not resolve to a User with the login of 'x'." },
      ],
    };
    await expectDataError(client(mockFetch(body))('q'), 'not_found');
  });

  it('maps other GraphQL errors to api', async () => {
    const body = { data: null, errors: [{ type: 'VALIDATION', message: 'bad span' }] };
    const err = await expectDataError(client(mockFetch(body))('q'), 'api');
    expect(err.message).toContain('bad span');
  });

  it('detects an exhausted primary rate limit', async () => {
    const fetchFn = mockFetch(
      { data: {} },
      { headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '1790000000' } },
    );
    const err = await expectDataError(client(fetchFn)('q'), 'rate_limited');
    expect(err.retryAt?.getTime()).toBe(1790000000 * 1000);
  });

  it('detects a secondary rate limit', async () => {
    const fetchFn = mockFetch({}, { status: 403, headers: { 'retry-after': '60' } });
    await expectDataError(client(fetchFn)('q'), 'rate_limited');
  });

  it('maps network failures to api', async () => {
    const fetchFn = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed');
    });
    await expectDataError(client(fetchFn)('q'), 'api');
  });
});

describe('fetchProfile', () => {
  it('falls back to login when name is unset', async () => {
    const fetchFn = mockFetch({ data: { user: { login: 'octo', name: null } } });
    expect(await fetchProfile(client(fetchFn), 'octo')).toEqual({ login: 'octo', name: 'octo' });
  });

  it('uses the profile name', async () => {
    const fetchFn = mockFetch({ data: { user: { login: 'octo', name: ' Octo Cat ' } } });
    expect((await fetchProfile(client(fetchFn), 'octo')).name).toBe('Octo Cat');
  });
});

describe('fetchContributions', () => {
  it('normalizes the calendar and requests the window', async () => {
    const fetchFn = mockFetch({
      data: {
        user: {
          contributionsCollection: {
            contributionCalendar: {
              totalContributions: 7,
              weeks: [
                {
                  contributionDays: [{ date: '2025-09-20', weekday: 6, contributionCount: 3 }],
                },
                {
                  contributionDays: [
                    { date: '2025-09-22', weekday: 1, contributionCount: 4 },
                    { date: '2025-09-21', weekday: 0, contributionCount: 0 },
                  ],
                },
              ],
            },
          },
        },
      },
    });
    const data = await fetchContributions(
      client(fetchFn),
      'octo',
      new Date('2026-09-19T12:00:00Z'),
    );

    const vars = JSON.parse(fetchFn.mock.calls[0]![1]!.body as string).variables;
    expect(vars).toEqual({
      login: 'octo',
      from: '2025-09-20T00:00:00Z',
      to: '2026-09-19T23:59:59Z',
    });
    expect(data).toEqual({
      from: '2025-09-20',
      to: '2026-09-19',
      total: 7,
      weeks: [
        [{ date: '2025-09-20', weekday: 6, count: 3 }],
        [
          { date: '2025-09-21', weekday: 0, count: 0 },
          { date: '2025-09-22', weekday: 1, count: 4 },
        ],
      ],
    });
    expect(contributionsSchema.safeParse(data).success).toBe(true);
  });
});

describe('fetchRepos', () => {
  it('merges own and fork lists, sorted by stars then name', async () => {
    const node = (name: string, stars: number, isFork = false) => ({
      name,
      isFork,
      stargazerCount: stars,
      pushedAt: '2026-08-01T10:00:00Z',
      primaryLanguage: { name: 'Go', color: '#00ADD8' },
    });
    const fetchFn = mockFetch({
      data: {
        user: {
          own: { nodes: [node('b', 5), node('a', 5)] },
          all: {
            nodes: [
              node('fork', 9, true),
              node('b', 5),
              { ...node('a', 5), pushedAt: null, primaryLanguage: null },
            ],
          },
        },
      },
    });
    const data = await fetchRepos(client(fetchFn), 'octo', new Date('2026-09-19T12:00:00Z'));

    const vars = JSON.parse(fetchFn.mock.calls[0]![1]!.body as string).variables;
    expect(vars).toEqual({ login: 'octo', first: 30 });
    expect(data.asOf).toBe('2026-09-19');
    expect(data.repos.map((r) => [r.name, r.fork])).toEqual([
      ['fork', true],
      ['a', false],
      ['b', false],
    ]);
    expect(data.repos[1]).toEqual({
      name: 'a',
      fork: false,
      stars: 5,
      language: null,
      pushedAt: '1970-01-01',
    });
    expect(reposSchema.safeParse(data).success).toBe(true);
  });
});

describe('fetchHighlights', () => {
  it('takes the top repo and ranks languages by repo count, then name', async () => {
    const node = (name: string, language: { name: string; color: string } | null) => ({
      name,
      stargazerCount: 5,
      forkCount: 1,
      primaryLanguage: language,
    });
    const fetchFn = mockFetch({
      data: {
        user: {
          contributionsCollection: {
            contributionCalendar: {
              totalContributions: 9,
              weeks: [
                { contributionDays: [{ date: '2025-09-20', weekday: 6, contributionCount: 9 }] },
              ],
            },
          },
          repos: {
            nodes: [
              node('a', { name: 'TypeScript', color: '#3178c6' }),
              node('b', { name: 'Go', color: '#00ADD8' }),
              node('c', { name: 'TypeScript', color: '#3178c6' }),
              node('d', { name: 'Rust', color: '#dea584' }),
              node('e', { name: 'Go', color: '#00ADD8' }),
              node('f', { name: 'Zig', color: '#ec915c' }),
              node('g', null),
            ],
          },
          pullRequests: { totalCount: 685 },
        },
      },
    });
    const data = await fetchHighlights(client(fetchFn), 'octo', new Date('2026-09-19T12:00:00Z'));

    const vars = JSON.parse(fetchFn.mock.calls[0]![1]!.body as string).variables;
    expect(vars.login).toBe('octo');
    expect(vars.first).toBe(30);
    expect(data.topRepo).toEqual({
      name: 'a',
      stars: 5,
      forks: 1,
      language: { name: 'TypeScript', color: '#3178c6' },
    });
    expect(data.mergedPullRequests).toBe(685);
    expect(data.contributions.total).toBe(9);
    // Stars sum over every fetched repo; the pseudo cards keep the first six.
    expect(data.totalStars).toBe(35);
    expect(data.starredRepos.map((r) => r.name)).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(data.starredRepos[0]).toEqual({ name: 'a', stars: 5, color: '#3178c6' });
    // The fourth language is dropped; repos without a language are skipped.
    expect(data.languages).toEqual([
      { name: 'Go', color: '#00ADD8', count: 2 },
      { name: 'TypeScript', color: '#3178c6', count: 2 },
      { name: 'Rust', color: '#dea584', count: 1 },
    ]);
    expect(highlightsSchema.safeParse(data).success).toBe(true);
  });

  it('has no top repo when the account has none', async () => {
    const fetchFn = mockFetch({
      data: {
        user: {
          contributionsCollection: {
            contributionCalendar: { totalContributions: 0, weeks: [] },
          },
          repos: { nodes: [] },
          pullRequests: { totalCount: 0 },
        },
      },
    });
    const data = await fetchHighlights(client(fetchFn), 'octo', new Date('2026-09-19T12:00:00Z'));
    expect(data.topRepo).toBeNull();
    expect(data.languages).toEqual([]);
  });
});

describe('resolveToken', () => {
  const noGh = () => undefined;

  it('prefers the flag, then GITHUB_TOKEN, then gh', () => {
    expect(resolveToken({ flag: 'a', env: { GITHUB_TOKEN: 'b' }, ghToken: () => 'c' })).toBe('a');
    expect(resolveToken({ env: { GITHUB_TOKEN: 'b' }, ghToken: () => 'c' })).toBe('b');
    expect(resolveToken({ env: {}, ghToken: () => 'c' })).toBe('c');
  });

  it('fails without a token', () => {
    expect(() => resolveToken({ env: {}, ghToken: noGh })).toThrow(DataError);
  });
});
