import { execFileSync } from 'node:child_process';
import { DataError } from './errors.js';

export interface TokenSources {
  flag?: string | undefined;
  env?: NodeJS.ProcessEnv;
  /** Injectable for tests. Returns the gh CLI token, or undefined. */
  ghToken?: () => string | undefined;
}

/**
 * Resolves a GitHub token: --token, then GITHUB_TOKEN, then `gh auth token`.
 * GitHub's GraphQL API requires authentication, so no token is an error.
 */
export function resolveToken({
  flag,
  env = process.env,
  ghToken = readGhToken,
}: TokenSources = {}): string {
  const token = flag?.trim() || env.GITHUB_TOKEN?.trim() || ghToken();
  if (!token) {
    throw new DataError(
      'auth',
      'No GitHub token found. Pass --token, set GITHUB_TOKEN, or log in with `gh auth login`.',
    );
  }
  return token;
}

function readGhToken(): string | undefined {
  try {
    const out = execFileSync('gh', ['auth', 'token'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}
