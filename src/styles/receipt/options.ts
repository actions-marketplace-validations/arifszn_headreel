import { z } from 'zod';
import { MAX_ITEMS } from '../../core/data/receipt.js';

export const THEMES = ['dark', 'light'] as const;
export const ACCENTS = ['cobalt', 'green', 'violet', 'orange', 'pink'] as const;

export type Theme = (typeof THEMES)[number];
export type Accent = (typeof ACCENTS)[number];

export const options = z
  .object({
    /** The counter and the printer: dark slate, or the light desk. */
    theme: z.enum(THEMES).default('dark'),
    /** Prompt, cursor, tagline, website and the printer LED, as Highlights Reel. */
    accent: z.enum(ACCENTS).default('cobalt'),
    /** Line items printed, most commits first. 0 prints the totals only. */
    items: z.coerce.number().int().min(0).max(MAX_ITEMS).default(MAX_ITEMS),
  })
  .strict();

export type Options = z.infer<typeof options>;
