// Renders a style from a fixture, for development and gallery samples.
// Usage: pnpm tsx scripts/render-fixture.ts <style> <fixture> <out.gif> [tagline] [website]
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { loadFixture } from '../src/core/data/fixture.js';
import { renderBanner } from '../src/core/pipeline.js';
import { styles } from '../src/styles/index.js';

const [styleId, fixturePath, out, tagline, website] = process.argv.slice(2);
const style = styleId ? styles[styleId] : undefined;
if (!style || !fixturePath || !out) {
  console.error(
    `Usage: pnpm tsx scripts/render-fixture.ts <${Object.keys(styles).join('|')}> <fixture> <out.gif> [tagline] [website]`,
  );
  process.exit(1);
}

const { profile, data } = await loadFixture(fixturePath, style.data.schema);
const start = performance.now();
const gif = await renderBanner(style, {
  login: profile.login,
  data,
  identity: {
    name: profile.name,
    ...(tagline ? { tagline } : {}),
    ...(website ? { website } : {}),
  },
});
await writeFile(out, gif);
const seconds = ((performance.now() - start) / 1000).toFixed(1);
console.log(`${out}: ${(gif.length / 1e6).toFixed(2)} MB in ${seconds}s`);
