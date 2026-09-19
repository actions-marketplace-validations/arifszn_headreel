// Records live GitHub data into fixtures/<login>.<data>.json for a style.
// Usage: pnpm tsx scripts/record-fixture.ts <login> [style]
import { writeFile } from 'node:fs/promises';
import { createGraphQLClient } from '../src/core/data/graphql.js';
import { fetchProfile } from '../src/core/data/profile.js';
import { resolveToken } from '../src/core/data/token.js';
import { styles } from '../src/styles/index.js';

const [login, styleId = 'contribution-city'] = process.argv.slice(2);
const style = styles[styleId];
if (!login || !style) {
  console.error(
    `Usage: pnpm tsx scripts/record-fixture.ts <login> [${Object.keys(styles).join('|')}]`,
  );
  process.exit(1);
}

const client = createGraphQLClient({ token: resolveToken() });
const [profile, data] = await Promise.all([
  fetchProfile(client, login),
  // Default options, so the fixture matches what a run without options fetches.
  style.data.fetch(client, login, new Date(), style.options.parse({})),
]);

const path = `fixtures/${login}.${style.data.name}.json`;
await writeFile(path, `${JSON.stringify({ profile, data }, null, 2)}\n`);
console.log(`Wrote ${path}`);
