import { z } from 'zod';
import type { GraphQLClient } from './graphql.js';

// The tape is the user's most active public repository of the last 30 days.
// Two queries when something is playing; a third one finds the fallback.
// Query 1: every repository the user committed to in the window, with its
// daily commit counts. The user's id feeds the author filter of query 2.
const QUERY = /* GraphQL */ `
  query NowPlaying($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      id
      contributionsCollection(from: $from, to: $to) {
        commitContributionsByRepository(maxRepositories: 25) {
          repository {
            name
            owner {
              login
            }
            isPrivate
            primaryLanguage {
              name
              color
            }
          }
          contributions(first: 31) {
            totalCount
            nodes {
              occurredAt
              commitCount
            }
          }
        }
      }
    }
  }
`;

// Query 2: the playing repository's default-branch commits authored by the
// user since the window started. GitHub counts commit contributions on the
// default branch (or gh-pages) only, the same source as query 1.
const COMMIT_HISTORY = /* GraphQL */ `
  edges {
    node {
      messageHeadline
      parents {
        totalCount
      }
    }
  }
`;

const COMMITS_QUERY = /* GraphQL */ `
  query NowPlayingCommits($owner: String!, $name: String!, $id: ID!, $since: GitTimestamp!) {
    repository(owner: $owner, name: $name) {
      defaultBranchRef {
        target {
          ... on Commit {
            history(author: { id: $id }, since: $since, first: 30) {
              ${COMMIT_HISTORY}
            }
          }
        }
      }
    }
  }
`;

// Fallback: the most recently pushed owned public repository and the user's
// latest commits on it, without `since`. The history rides on every node, so
// one query covers whichever repository the picker lands on.
const FALLBACK_QUERY = /* GraphQL */ `
  query NowPlayingFallback($login: String!, $id: ID!, $first: Int!) {
    user(login: $login) {
      repositories(
        first: $first
        ownerAffiliations: OWNER
        privacy: PUBLIC
        isFork: false
        orderBy: { field: PUSHED_AT, direction: DESC }
      ) {
        nodes {
          name
          owner {
            login
          }
          primaryLanguage {
            name
            color
          }
          defaultBranchRef {
            target {
              ... on Commit {
                history(author: { id: $id }, first: 30) {
                  ${COMMIT_HISTORY}
                }
              }
            }
          }
        }
      }
    }
  }
`;

interface RepoContributions {
  totalCount: number;
  nodes: { occurredAt: string; commitCount: number }[] | null;
}

interface Query1Response {
  user: {
    id: string;
    contributionsCollection: {
      commitContributionsByRepository: {
        repository: {
          name: string;
          owner: { login: string };
          isPrivate: boolean;
          primaryLanguage: { name: string; color: string | null } | null;
        };
        contributions: RepoContributions;
      }[];
    };
  };
}

interface HistoryNode {
  messageHeadline: string;
  parents: { totalCount: number };
}

interface Query2Response {
  repository: {
    defaultBranchRef: {
      target: { history: { edges: { node: HistoryNode }[] } | null } | null;
    } | null;
  } | null;
}

interface Query3Response {
  user: {
    repositories: {
      nodes: {
        name: string;
        owner: { login: string };
        primaryLanguage: { name: string; color: string | null } | null;
        defaultBranchRef: {
          target: { history: { edges: { node: HistoryNode }[] } | null } | null;
        } | null;
      }[];
    };
  };
}

export const WINDOW_DAYS = 30;

export const statusSchema = z.enum(['playing', 'last-played', 'empty']);

const languageSchema = z
  .object({
    name: z.string().min(1),
    /** Linguist color; null when the repo has no language or color. */
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .nullable(),
  })
  .nullable();

export const nowPlayingSchema = z.object({
  /** Fetch date, YYYY-MM-DD (UTC). */
  asOf: z.iso.date(),
  status: statusSchema,
  repo: z
    .object({
      /** Not always the user: contributions to another user's project show as owner/name. */
      owner: z.string().min(1),
      name: z.string().min(1),
      language: languageSchema,
    })
    .nullable(),
  /** The playing repo's commits in the window; 0 on fallback. */
  commits: z.number().int().min(0),
  /** Its part of all public commits in the window, 0..1. */
  share: z.number().min(0).max(1),
  /** The playing repo's daily commits in the window, oldest first. */
  days: z.array(z.number().int().min(0)).length(WINDOW_DAYS),
  /** The repo's default-branch commit headlines, newest first, merges dropped. */
  lyrics: z.array(z.string().min(1)).max(8),
});

export type NowPlaying = z.infer<typeof nowPlayingSchema>;
export type NowPlayingStatus = z.infer<typeof statusSchema>;
export type NowPlayingRepo = NonNullable<NowPlaying['repo']>;

const DAY_MS = 86_400_000;

/**
 * The 30 days ending on `now` (UTC): `from` is 29 days back at midnight, `to`
 * is today, matching the run date the banner is rendered on.
 */
export function nowPlayingWindow(now: Date): { from: string; to: string; asOf: string } {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    from: new Date(today - (WINDOW_DAYS - 1) * DAY_MS).toISOString().slice(0, 10),
    to: new Date(today).toISOString().slice(0, 10),
    asOf: new Date(today).toISOString().slice(0, 10),
  };
}

/**
 * The daily commit counts of one repository across the window, oldest first.
 * `occurredAt` days outside the window are dropped.
 */
export function windowDays(contributions: RepoContributions, from: string, to: string): number[] {
  const counts = new Map<string, number>();
  for (const node of contributions.nodes ?? []) {
    counts.set(
      node.occurredAt.slice(0, 10),
      (counts.get(node.occurredAt.slice(0, 10)) ?? 0) + node.commitCount,
    );
  }
  const days: number[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY_MS) {
    days.push(counts.get(new Date(t).toISOString().slice(0, 10)) ?? 0);
  }
  return days;
}

/** Index of the last day with a commit, -1 when the repository had none. */
function lastActiveIndex(days: number[]): number {
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i]! > 0) return i;
  }
  return -1;
}

export interface Candidate {
  owner: string;
  name: string;
  commits: number;
  /** Daily commits across the window, oldest first. */
  days: number[];
  language: { name: string; color: string | null } | null;
}

function excludedBy(exclude: readonly string[]): (owner: string, name: string) => boolean {
  const names = new Set(exclude.map((n) => n.trim().toLowerCase()));
  return (owner: string, name: string) =>
    names.has(name.toLowerCase()) || names.has(`${owner}/${name}`.toLowerCase());
}

/**
 * Drops excluded names, then picks the playing one: most commits in the
 * window, ties to the latest active day, then name.
 */
export function pickRepo(
  candidates: Candidate[],
  exclude: readonly string[] = [],
): Candidate | null {
  const isExcluded = excludedBy(exclude);
  let best: Candidate | null = null;
  for (const c of candidates) {
    if (isExcluded(c.owner, c.name)) continue;
    if (!best || better(c, best)) best = c;
  }
  return best;
}

function better(a: Candidate, b: Candidate): boolean {
  if (a.commits !== b.commits) return a.commits > b.commits;
  const ai = lastActiveIndex(a.days);
  const bi = lastActiveIndex(b.days);
  if (ai !== bi) return ai > bi;
  return a.name.localeCompare(b.name) < 0;
}

/** Merges (more than one parent) and empty headlines never become lyrics. */
export function lyricsFromHistory(nodes: HistoryNode[]): string[] {
  return nodes
    .filter((n) => n.parents.totalCount <= 1 && n.messageHeadline.trim().length > 0)
    .map((n) => n.messageHeadline.trim())
    .slice(0, 8);
}

const ZEROS = Array.from<number>({ length: WINDOW_DAYS }).fill(0);

export async function fetchNowPlaying(
  client: GraphQLClient,
  login: string,
  now: Date,
  options: { exclude?: string[] } = {},
): Promise<NowPlaying> {
  const { from, to, asOf } = nowPlayingWindow(now);
  const since = `${from}T00:00:00Z`;

  const { user } = await client<Query1Response>(QUERY, {
    login,
    from: since,
    to: `${to}T23:59:59Z`,
  });

  // Private repositories are dropped before anything is picked: repo names
  // and commit messages of private repos never reach the banner.
  const candidates: Candidate[] = user.contributionsCollection.commitContributionsByRepository
    .filter((entry) => !entry.repository.isPrivate)
    .map((entry) => ({
      owner: entry.repository.owner.login,
      name: entry.repository.name,
      commits: entry.contributions.totalCount,
      days: windowDays(entry.contributions, from, to),
      language: entry.repository.primaryLanguage
        ? {
            name: entry.repository.primaryLanguage.name,
            color: entry.repository.primaryLanguage.color,
          }
        : null,
    }));

  const picked = pickRepo(candidates, options.exclude ?? []);

  if (picked) {
    const all = candidates.reduce((sum, c) => sum + c.commits, 0);
    const { repository } = await client<Query2Response>(COMMITS_QUERY, {
      owner: picked.owner,
      name: picked.name,
      id: user.id,
      since,
    });
    return {
      asOf,
      status: 'playing',
      repo: { owner: picked.owner, name: picked.name, language: picked.language },
      commits: picked.commits,
      share: all > 0 ? picked.commits / all : 0,
      days: picked.days,
      lyrics: lyricsFromHistory(
        repository?.defaultBranchRef?.target?.history?.edges.map((e) => e.node) ?? [],
      ),
    };
  }

  // Nothing playing: the most recently pushed owned public repository, whose
  // latest default-branch commits become the lyrics without a window.
  const fallback = await client<Query3Response>(FALLBACK_QUERY, {
    login,
    id: user.id,
    first: 25,
  });
  const isExcluded = excludedBy(options.exclude ?? []);
  const repo = fallback.user.repositories.nodes.find((n) => !isExcluded(n.owner.login, n.name));
  if (!repo) {
    return {
      asOf,
      status: 'empty',
      repo: null,
      commits: 0,
      share: 0,
      days: [...ZEROS],
      lyrics: [],
    };
  }

  return {
    asOf,
    status: 'last-played',
    repo: {
      owner: repo.owner.login,
      name: repo.name,
      language: repo.primaryLanguage
        ? { name: repo.primaryLanguage.name, color: repo.primaryLanguage.color }
        : null,
    },
    commits: 0,
    share: 0,
    days: [...ZEROS],
    lyrics: lyricsFromHistory(
      repo.defaultBranchRef?.target?.history?.edges.map((e) => e.node) ?? [],
    ),
  };
}
