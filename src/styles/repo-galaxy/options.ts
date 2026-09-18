import { z } from 'zod';
import { MAX_REPOS } from '../../core/data/repos.js';

export const options = z
  .object({
    /** Number of repositories shown, most starred first. */
    max_repos: z.coerce.number().int().min(5).max(MAX_REPOS).default(20),
    /** Include forked repositories. */
    include_forks: z.stringbool().default(false),
    /** Name the three most starred repositories. */
    labels: z.enum(['top3', 'none']).default('top3'),
  })
  .strict();

export type Options = z.infer<typeof options>;
