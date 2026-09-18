import { DataError } from './errors.js';

const ENDPOINT = 'https://api.github.com/graphql';

export interface GraphQLClientOptions {
  token: string;
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

interface GraphQLErrorItem {
  type?: string;
  message: string;
}

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: GraphQLErrorItem[];
}

export type GraphQLClient = <T>(query: string, variables?: Record<string, unknown>) => Promise<T>;

/**
 * Creates a GitHub GraphQL client. Does not retry: a failed run keeps the
 * existing banner, and the next scheduled run tries again.
 */
export function createGraphQLClient({
  token,
  fetch: fetchFn = fetch,
}: GraphQLClientOptions): GraphQLClient {
  return async <T>(query: string, variables: Record<string, unknown> = {}): Promise<T> => {
    let res: Response;
    try {
      res = await fetchFn(ENDPOINT, {
        method: 'POST',
        headers: {
          authorization: `bearer ${token}`,
          'content-type': 'application/json',
          'user-agent': 'headreel',
        },
        body: JSON.stringify({ query, variables }),
      });
    } catch (err) {
      throw new DataError('api', `GitHub API request failed: ${(err as Error).message}`);
    }

    const rateLimit = rateLimitError(res);
    if (rateLimit) throw rateLimit;
    if (res.status === 401) {
      throw new DataError('auth', 'GitHub rejected the token (401). Check that it is valid.');
    }
    if (!res.ok) {
      throw new DataError('api', `GitHub API returned ${res.status} ${res.statusText}`);
    }

    const body = (await res.json()) as GraphQLResponse<T>;
    const first = body.errors?.[0];
    if (first) {
      if (first.type === 'NOT_FOUND') throw new DataError('not_found', first.message);
      if (first.type === 'RATE_LIMITED') throw new DataError('rate_limited', first.message);
      throw new DataError('api', `GitHub API error: ${first.message}`);
    }
    if (!body.data) throw new DataError('api', 'GitHub API returned no data');
    return body.data;
  };
}

/** Primary limit: remaining is 0. Secondary limit: 403/429, possibly with retry-after. */
function rateLimitError(res: Response): DataError | undefined {
  const remaining = res.headers.get('x-ratelimit-remaining');
  const reset = res.headers.get('x-ratelimit-reset');
  const retryAfter = res.headers.get('retry-after');

  if (retryAfter !== null && (res.status === 403 || res.status === 429)) {
    const at = new Date(Date.now() + Number(retryAfter) * 1000);
    return new DataError(
      'rate_limited',
      `GitHub secondary rate limit hit; retry after ${retryAfter}s`,
      at,
    );
  }
  if (remaining === '0') {
    const at = reset !== null ? new Date(Number(reset) * 1000) : undefined;
    const when = at ? ` until ${at.toISOString()}` : '';
    return new DataError('rate_limited', `GitHub rate limit exhausted${when}`, at);
  }
  if (res.status === 429) {
    return new DataError('rate_limited', 'GitHub rate limit hit (429)');
  }
  return undefined;
}
