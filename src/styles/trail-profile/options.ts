import { z } from 'zod';

export const ACCENTS = ['sienna', 'cobalt', 'green', 'violet'] as const;

export type Accent = (typeof ACCENTS)[number];

export const options = z
  .object({
    /** Color of the profile line, strata, tagline and website. */
    accent: z.enum(ACCENTS).default('sienna'),
  })
  .strict();

export type Options = z.infer<typeof options>;
