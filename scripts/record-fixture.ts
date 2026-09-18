// Records live GitHub data into fixtures/<login>.contributions.json.
// Usage: pnpm tsx scripts/record-fixture.ts <login>
import { writeFile } from 'node:fs/promises';
import { fetchContributions } from '../src/core/data/contributions.js';
import { createGraphQLClient } from '../src/core/data/graphql.js';
import { fetchProfile } from '../src/core/data/profile.js';
import { resolveToken } from '../src/core/data/token.js';

const login = process.argv[2];
if (!login) {
  console.error('Usage: pnpm tsx scripts/record-fixture.ts <login>');
  process.exit(1);
}

const client = createGraphQLClient({ token: resolveToken() });
const [profile, data] = await Promise.all([
  fetchProfile(client, login),
  fetchContributions(client, login, new Date()),
]);

const path = `fixtures/${login}.contributions.json`;
await writeFile(path, `${JSON.stringify({ profile, data }, null, 2)}\n`);
console.log(
  `${path}: ${data.total} contributions, ${data.weeks.length} weeks, ${data.from}..${data.to}`,
);
