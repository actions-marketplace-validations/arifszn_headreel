import { z } from 'zod';
import type { GraphQLClient } from './graphql.js';

/** Most repos any style shows; each list below fetches this many. */
export const MAX_REPOS = 30;

const REPO_FIELDS = /* GraphQL */ `
  nodes {
    name
    isFork
    stargazerCount
    pushedAt
    primaryLanguage {
      name
      color
    }
  }
`;

// Two lists in one query: top own repos, and top repos including forks. Their
// union holds the top MAX_REPOS for either `include_forks` setting.
const QUERY = /* GraphQL */ `
  query Repos($login: String!, $first: Int!) {
    user(login: $login) {
      own: repositories(
        first: $first
        ownerAffiliations: OWNER
        privacy: PUBLIC
        isFork: false
        orderBy: { field: STARGAZERS, direction: DESC }
      ) {
        ${REPO_FIELDS}
      }
      all: repositories(
        first: $first
        ownerAffiliations: OWNER
        privacy: PUBLIC
        orderBy: { field: STARGAZERS, direction: DESC }
      ) {
        ${REPO_FIELDS}
      }
    }
  }
`;

interface RepoNode {
  name: string;
  isFork: boolean;
  stargazerCount: number;
  pushedAt: string | null;
  primaryLanguage: { name: string; color: string | null } | null;
}

interface ReposResponse {
  user: { own: { nodes: RepoNode[] }; all: { nodes: RepoNode[] } };
}

const repoSchema = z.object({
  name: z.string().min(1),
  fork: z.boolean(),
  stars: z.number().int().min(0),
  /** Primary language; `color` is the linguist color, null when it has none. */
  language: z
    .object({
      name: z.string().min(1),
      color: z
        .string()
        .regex(/^#[0-9a-fA-F]{6}$/)
        .nullable(),
    })
    .nullable(),
  /** Last push, YYYY-MM-DD. */
  pushedAt: z.iso.date(),
});

export const reposSchema = z.object({
  /** Fetch date, YYYY-MM-DD (UTC). Repo ages are measured from here, so renders stay stable. */
  asOf: z.iso.date(),
  /** Most starred first, ties by name. */
  repos: z.array(repoSchema),
});

export type Repo = z.infer<typeof repoSchema>;
export type Repos = z.infer<typeof reposSchema>;

/** Stars descending, then name, so ties never depend on API order. */
export function compareRepos(a: Repo, b: Repo): number {
  return b.stars - a.stars || a.name.localeCompare(b.name);
}

export async function fetchRepos(client: GraphQLClient, login: string, now: Date): Promise<Repos> {
  const { user } = await client<ReposResponse>(QUERY, { login, first: MAX_REPOS });
  const byName = new Map<string, Repo>();
  for (const n of [...user.own.nodes, ...user.all.nodes]) {
    byName.set(n.name, {
      name: n.name,
      fork: n.isFork,
      stars: n.stargazerCount,
      language: n.primaryLanguage
        ? { name: n.primaryLanguage.name, color: n.primaryLanguage.color }
        : null,
      // A repo never pushed to has no pushedAt; it counts as the oldest.
      pushedAt: (n.pushedAt ?? '1970-01-01').slice(0, 10),
    });
  }
  return {
    asOf: now.toISOString().slice(0, 10),
    repos: [...byName.values()].sort(compareRepos),
  };
}
