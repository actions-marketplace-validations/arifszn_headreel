import { z } from 'zod';

export const ACCENTS = ['gray', 'teal', 'cobalt', 'violet', 'sienna'] as const;

export type Accent = (typeof ACCENTS)[number];

export const options = z
  .object({
    /** Color of the eyebrow, tagline, website and cursor. */
    accent: z.enum(ACCENTS).default('gray'),
  })
  .strict();

export type Options = z.infer<typeof options>;
