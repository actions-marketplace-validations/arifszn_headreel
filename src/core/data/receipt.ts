import { z } from 'zod';
import { contributionWindow } from './contributions.js';
import type { GraphQLClient } from './graphql.js';

// One query for the whole receipt: the 365-day calendar (TOTAL, the streaks,
// the best day and the barcode), the per-type contribution counts, and the
// repositories the user committed to (the line items). Field names checked
// against the live GraphQL schema (2026-09-19).
const QUERY = /* GraphQL */ `
  query Receipt($login: String!, $from: DateTime!, $to: DateTime!) {
    user(login: $login) {
      contributionsCollection(from: $from, to: $to) {
        contributionCalendar {
          totalContributions
          weeks {
            contributionDays {
              date
              contributionCount
            }
          }
        }
        totalCommitContributions
        totalPullRequestContributions
        totalPullRequestReviewContributions
        totalIssueContributions
        totalRepositoryContributions
        restrictedContributionsCount
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
          contributions {
            totalCount
          }
        }
      }
    }
  }
`;

interface RepoEntry {
  repository: {
    name: string;
    owner: { login: string };
    isPrivate: boolean;
    primaryLanguage: { name: string; color: string | null } | null;
  };
  contributions: { totalCount: number };
}

interface ReceiptResponse {
  user: {
    contributionsCollection: {
      contributionCalendar: {
        totalContributions: number;
        weeks: { contributionDays: { date: string; contributionCount: number }[] }[];
      };
      totalCommitContributions: number;
      totalPullRequestContributions: number;
      totalPullRequestReviewContributions: number;
      totalIssueContributions: number;
      totalRepositoryContributions: number;
      restrictedContributionsCount: number;
      commitContributionsByRepository: RepoEntry[];
    };
  };
}

/** Line items printed, at most. */
export const MAX_ITEMS = 5;

/** Days in the contribution window: 364 back plus the run date. */
export const WINDOW_DAYS = 365;

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

export const receiptSchema = z.object({
  /** Fetch date (= window end), YYYY-MM-DD (UTC). */
  asOf: z.iso.date(),
  from: z.iso.date(),
  to: z.iso.date(),
  /** The calendar's total, the number the profile shows. */
  total: z.number().int().min(0),
  commits: z.number().int().min(0),
  pullRequests: z.number().int().min(0),
  reviews: z.number().int().min(0),
  issues: z.number().int().min(0),
  newRepos: z.number().int().min(0),
  /** Private contributions the token could see, without any repository named. */
  restricted: z.number().int().min(0),
  /** Public repositories committed to, most commits first. */
  items: z
    .array(
      z.object({
        /** A repository the user does not own prints as `owner/name`. */
        name: z.string().min(1),
        language: languageSchema,
        commits: z.number().int().min(1),
      }),
    )
    .max(MAX_ITEMS),
  /** Commits summed over the private repositories, never named. */
  privateCommits: z.number().int().min(0),
  /** Daily counts over the window, oldest first. */
  days: z.array(z.number().int().min(0)).length(WINDOW_DAYS),
});

export type Receipt = z.infer<typeof receiptSchema>;
export type ReceiptItem = Receipt['items'][number];

/**
 * The line items: public repositories by commits in the window, ties by name.
 * Private repositories are dropped here, before ranking; their commits are
 * summed into `privateCommits` and never named.
 */
export function selectItems(
  entries: RepoEntry[],
  login: string,
  cap: number = MAX_ITEMS,
): { items: ReceiptItem[]; privateCommits: number } {
  const items: ReceiptItem[] = [];
  let privateCommits = 0;
  for (const entry of entries) {
    const { repository } = entry;
    if (repository.isPrivate) {
      privateCommits += entry.contributions.totalCount;
      continue;
    }
    items.push({
      name:
        repository.owner.login === login
          ? repository.name
          : `${repository.owner.login}/${repository.name}`,
      language: repository.primaryLanguage
        ? { name: repository.primaryLanguage.name, color: repository.primaryLanguage.color }
        : null,
      commits: entry.contributions.totalCount,
    });
  }
  items.sort((a, b) => b.commits - a.commits || a.name.localeCompare(b.name));
  return { items: items.slice(0, cap), privateCommits };
}

export async function fetchReceipt(
  client: GraphQLClient,
  login: string,
  now: Date,
): Promise<Receipt> {
  const { from, to } = contributionWindow(now);
  const { user } = await client<ReceiptResponse>(QUERY, {
    login,
    from: `${from}T00:00:00Z`,
    to: `${to}T23:59:59Z`,
  });
  const cc = user.contributionsCollection;

  // Calendar weeks are padded to full weeks; keep only the window's days.
  const days = cc.contributionCalendar.weeks
    .flatMap((week) => week.contributionDays)
    .filter((day) => day.date >= from && day.date <= to)
    .map((day) => day.contributionCount);

  const { items, privateCommits } = selectItems(cc.commitContributionsByRepository, login);
  return {
    asOf: to,
    from,
    to,
    total: cc.contributionCalendar.totalContributions,
    commits: cc.totalCommitContributions,
    pullRequests: cc.totalPullRequestContributions,
    reviews: cc.totalPullRequestReviewContributions,
    issues: cc.totalIssueContributions,
    newRepos: cc.totalRepositoryContributions,
    restricted: cc.restrictedContributionsCount,
    items,
    privateCommits,
    days,
  };
}
