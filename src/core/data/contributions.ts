import { z } from 'zod';
import type { GraphQLClient } from './graphql.js';

const QUERY = /* GraphQL */ `
  query Contributions($login: String!, $from: DateTime!, $to: DateTime!) {
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
    }
  }
`;

interface ContributionsResponse {
  user: {
    contributionsCollection: {
      contributionCalendar: {
        totalContributions: number;
        weeks: {
          contributionDays: { date: string; weekday: number; contributionCount: number }[];
        }[];
      };
    };
  };
}

const daySchema = z.object({
  /** YYYY-MM-DD */
  date: z.iso.date(),
  /** 0 = Sunday ... 6 = Saturday */
  weekday: z.number().int().min(0).max(6),
  count: z.number().int().min(0),
});

export const contributionsSchema = z.object({
  /** First and last day of the window, YYYY-MM-DD, inclusive. */
  from: z.iso.date(),
  to: z.iso.date(),
  total: z.number().int().min(0),
  /** Calendar columns, oldest first. First and last weeks may be partial. */
  weeks: z.array(z.array(daySchema)),
});

export type ContributionDay = z.infer<typeof daySchema>;
export type Contributions = z.infer<typeof contributionsSchema>;

const DAY_MS = 86_400_000;

/**
 * The 365 days ending on `now` (UTC), matching GitHub's profile calendar.
 * GitHub rejects spans over one year, so the window is 364 days back plus today.
 */
export function contributionWindow(now: Date): { from: string; to: string } {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return {
    from: new Date(today - 364 * DAY_MS).toISOString().slice(0, 10),
    to: new Date(today).toISOString().slice(0, 10),
  };
}

export async function fetchContributions(
  client: GraphQLClient,
  login: string,
  now: Date,
): Promise<Contributions> {
  const { from, to } = contributionWindow(now);
  const { user } = await client<ContributionsResponse>(QUERY, {
    login,
    from: `${from}T00:00:00Z`,
    to: `${to}T23:59:59Z`,
  });
  const calendar = user.contributionsCollection.contributionCalendar;
  return {
    from,
    to,
    total: calendar.totalContributions,
    weeks: calendar.weeks.map((week) =>
      week.contributionDays
        .map((d) => ({ date: d.date, weekday: d.weekday, count: d.contributionCount }))
        .sort((a, b) => a.date.localeCompare(b.date)),
    ),
  };
}
