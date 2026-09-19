import { z } from 'zod';

export const THEMES = ['dark', 'light'] as const;
export const ACCENTS = ['cyan', 'green', 'orange'] as const;

export type Theme = (typeof THEMES)[number];
export type Accent = (typeof ACCENTS)[number];

export const options = z
  .object({
    /** The deck and the room: graphite on dark, or a silver deck on light. */
    theme: z.enum(THEMES).default('dark'),
    /** Display phosphor, level meter, play LED, prompt and links. Real VFD colors only. */
    accent: z.enum(ACCENTS).default('cyan'),
    /** Comma-separated repositories never picked, e.g. the profile repo itself. */
    exclude: z
      .string()
      .default('')
      .transform((v) =>
        v
          .split(',')
          .map((n) => n.trim())
          .filter(Boolean),
      ),
  })
  .strict();

export type Options = z.infer<typeof options>;
