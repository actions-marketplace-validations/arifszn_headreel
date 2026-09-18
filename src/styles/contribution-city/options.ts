import { z } from 'zod';

export const options = z
  .object({
    /** Number of busiest days marked with a beacon. */
    beacons: z.coerce.number().int().min(0).max(10).default(8),
  })
  .strict();

export type Options = z.infer<typeof options>;
