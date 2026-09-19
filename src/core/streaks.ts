/**
 * Streaks and peaks over a flat array of daily contribution counts, oldest
 * first. Shared by Highlights Reel and Receipt.
 */

/** Longest run of consecutive days with at least one contribution. */
export function longestStreak(days: readonly number[]): number {
  let best = 0;
  let run = 0;
  for (const count of days) {
    run = count > 0 ? run + 1 : 0;
    if (run > best) best = run;
  }
  return best;
}

/**
 * Consecutive active days ending on the last day, or on the day before it
 * when the last day is still empty: a scheduled run often happens before the
 * day's work.
 */
export function currentStreak(days: readonly number[]): number {
  let end = days.length - 1;
  if (days[end]! <= 0) end--;
  let run = 0;
  for (let i = end; i >= 0 && days[i]! > 0; i--) run++;
  return run;
}

export interface BestDay {
  /** Index into the days array. Ties go to the latest day. */
  index: number;
  count: number;
}

/** The day with the highest count, or null when every day is empty. */
export function bestDay(days: readonly number[]): BestDay | null {
  let best: BestDay | null = null;
  days.forEach((count, index) => {
    if (count > 0 && (best === null || count >= best.count)) best = { index, count };
  });
  return best;
}
