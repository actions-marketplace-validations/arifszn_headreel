import { readFile } from 'node:fs/promises';
import { z } from 'zod';

/**
 * Loads offline data for `--fixture`. The file holds the style's normalized
 * data (not a raw API response) plus the profile, validated against `schema`.
 */
export async function loadFixture<S extends z.ZodType>(
  path: string,
  schema: S,
): Promise<{ profile: { login: string; name: string }; data: z.infer<S> }> {
  const raw: unknown = JSON.parse(await readFile(path, 'utf8'));
  const fixtureSchema = z.object({
    profile: z.object({ login: z.string().min(1), name: z.string().min(1) }),
    data: schema,
  });
  const parsed = fixtureSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Invalid fixture ${path}:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data as { profile: { login: string; name: string }; data: z.infer<S> };
}
