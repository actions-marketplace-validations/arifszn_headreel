import { z } from 'zod';

export const THEMES = ['light', 'dark'] as const;
export const ACCENTS = ['cobalt', 'green', 'violet', 'orange', 'pink'] as const;

export type Theme = (typeof THEMES)[number];
export type Accent = (typeof ACCENTS)[number];

export const options = z
  .object({
    /** Desk, cards and type. `dark` suits profiles viewed in GitHub dark mode. */
    theme: z.enum(THEMES).default('light'),
    /** Bars, counting digits, prompt and links. Presets only, each contrast-checked. */
    accent: z.enum(ACCENTS).default('cobalt'),
  })
  .strict();

export type Options = z.infer<typeof options>;
