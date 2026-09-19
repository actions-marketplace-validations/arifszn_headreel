import { z } from 'zod';

export const ACCENTS = ['cyan', 'cobalt', 'green', 'violet', 'pink'] as const;

export type Accent = (typeof ACCENTS)[number];

export const options = z
  .object({
    /** Color of the roofs, windows, glow, lines, scan beam and links. */
    accent: z.enum(ACCENTS).default('cyan'),
  })
  .strict();

export type Options = z.infer<typeof options>;
