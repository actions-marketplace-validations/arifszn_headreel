import { z } from 'zod';
import { contributionWindow, contributionsSchema, normalizeCalendar } from './contributions.js';
import { MAX_REPOS } from './repos.js';
import type { GraphQLClient } from './graphql.js';

// One query for the whole reel: the same 365-day window as Contribution City,
// the most starred owned public repos (the first is the top repo, the set
// counts the top languages and the total stars), and all-time merged pull
// requests.
const QUERY = /* GraphQL */ `
  query Highlights($login: String!, $first: Int!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              weekday
              contributionCount
            }
          }
        }
      }
      repos: repositories(
        first: $first
        ownerAffiliations: OWNER
        privacy: PUBLIC
        isFork: false
        orderBy: { field: STARGAZERS, direction: DESC }
      ) {
        nodes {
          name
          stargazerCount
          forkCount
          primaryLanguage {
            name
            color
          }
        }
      }
      pullRequests(states: MERGED) {
        totalCount
      }
    }
  }
`;

interface RepoNode {
  name: string;
  stargazerCount: number;
  forkCount: number;
  primaryLanguage: { name: string; color: string | null } | null;
}

interface HighlightsResponse {
  user: {
    contributionsCollection: {
      contributionCalendar: {
        totalContributions: number;
        weeks: {
          contributionDays: { date: string; weekday: number; contributionCount: number }[];
        }[];
      };
    };
    repos: { nodes: RepoNode[] };
    pullRequests: { totalCount: number };
  };
}

const topRepoSchema = z.object({
  name: z.string().min(1),
  stars: z.number().int().min(0),
  forks: z.number().int().min(0),
  language: z
    .object({
      name: z.string().min(1),
      /** Linguist color; null when the repo has no language or color. */
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .nullable(),
    })
    .nullable(),
});

/** Repos shown as pseudo cards around the top repo, most starred first. */
export const STARRED_REPOS = 6;

export const highlightsSchema = z.object({
  contributions: contributionsSchema,
  topRepo: topRepoSchema.nullable(),
  /** Stars summed over the fetched repos. */
  totalStars: z.number().int().min(0),
  /** The most starred repos, top repo first, for the pseudo cards. */
  starredRepos: z
    .array(
      z.object({
        name: z.string().min(1),
        stars: z.number().int().min(0),
        /** Linguist color of the primary language; null when none. */
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .nullable(),
      }),
    )
    .max(STARRED_REPOS),
  mergedPullRequests: z.number().int().min(0),
  /** Top three languages by repo count over the fetched repos, most first. */
  languages: z
    .array(
      z.object({
        name: z.string().min(1),
        /** Linguist color; null when no repo sets one. */
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .nullable(),
        count: z.number().int().min(1),
      }),
    )
    .max(3),
});

export type TopRepo = z.infer<typeof topRepoSchema>;
export type Highlights = z.infer<typeof highlightsSchema>;

export async function fetchHighlights(
  client: GraphQLClient,
  login: string,
  now: Date,
): Promise<Highlights> {
  const { from, to } = contributionWindow(now);
  const { user } = await client<HighlightsResponse>(QUERY, {
    login,
    first: MAX_REPOS,
    from: `${from}T00:00:00Z`,
    to: `${to}T23:59:59Z`,
  });

  const nodes = user.repos.nodes;
  // Languages by repo count, ties by name; repos without a language are skipped.
  const counts = new Map<string, { color: string | null; count: number }>();
  for (const n of nodes) {
    if (!n.primaryLanguage) continue;
    const entry = counts.get(n.primaryLanguage.name) ?? {
      color: n.primaryLanguage.color,
      count: 0,
    };
    entry.count++;
    counts.set(n.primaryLanguage.name, entry);
  }
  const languages = [...counts.entries()]
    .sort((a, b) => b[1].count - a[1].count || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([name, { color, count }]) => ({ name, color, count }));

  const top = nodes[0];
  return {
    contributions: normalizeCalendar(user.contributionsCollection.contributionCalendar, from, to),
    topRepo: top
      ? {
          name: top.name,
          stars: top.stargazerCount,
          forks: top.forkCount,
          language: top.primaryLanguage
            ? { name: top.primaryLanguage.name, color: top.primaryLanguage.color }
            : null,
        }
      : null,
    totalStars: nodes.reduce((sum, n) => sum + n.stargazerCount, 0),
    starredRepos: nodes.slice(0, STARRED_REPOS).map((n) => ({
      name: n.name,
      stars: n.stargazerCount,
      color: n.primaryLanguage?.color ?? null,
    })),
    mergedPullRequests: user.pullRequests.totalCount,
    languages,
  };
}
