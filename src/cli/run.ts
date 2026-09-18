import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, extname } from 'node:path';
import { createGraphQLClient } from '../core/data/graphql.js';
import { loadFixture } from '../core/data/fixture.js';
import { fetchProfile } from '../core/data/profile.js';
import { resolveToken } from '../core/data/token.js';
import { parseOptions, renderBanner } from '../core/pipeline.js';
import { styles } from '../styles/index.js';
import type { Identity } from '../styles/types.js';
import { parseCommand, USAGE, type Settings } from './args.js';

const MiB = 1024 * 1024;
/** GitHub warns on pushed files over 50 MiB and blocks files over 100 MiB. */
const WARN_BYTES = 50 * MiB;
const MAX_BYTES = 100 * MiB;

export interface Io {
  log: (line: string) => void;
  warn: (line: string) => void;
  now: () => Date;
}

async function version(): Promise<string> {
  const pkg = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { version: string };
  return pkg.version;
}

async function render(settings: Settings, io: Io): Promise<void> {
  const style = styles[settings.style];
  if (!style) {
    throw new Error(
      `Unknown style "${settings.style}". Available: ${Object.keys(styles).join(', ')}.`,
    );
  }
  if (extname(settings.out).toLowerCase() !== '.gif') {
    throw new Error(`Output must be a .gif file, got "${settings.out}".`);
  }
  // Fail on bad options before any API call.
  parseOptions(style, settings.options);

  let login: string;
  let name: string;
  let data: unknown;
  if (settings.fixture) {
    const fixture = await loadFixture(settings.fixture, style.data.schema);
    ({ login, name } = fixture.profile);
    data = fixture.data;
  } else {
    const client = createGraphQLClient({ token: resolveToken({ flag: settings.token }) });
    const user = settings.user!;
    const [profile, fetched] = await Promise.all([
      fetchProfile(client, user),
      style.data.fetch(client, user, io.now()),
    ]);
    ({ login, name } = profile);
    data = fetched;
  }

  const identity: Identity = { name };
  if (settings.tagline) identity.tagline = settings.tagline;
  if (settings.website) identity.website = settings.website;
  if (settings.handle) identity.handle = settings.handle;

  const gif = await renderBanner(style, { login, data, identity, options: settings.options });
  if (gif.length > MAX_BYTES) {
    throw new Error(
      `Banner is ${(gif.length / MiB).toFixed(1)} MiB; GitHub rejects files over 100 MiB.`,
    );
  }
  if (gif.length > WARN_BYTES) {
    io.warn(`Banner is ${(gif.length / MiB).toFixed(1)} MiB; GitHub warns on files over 50 MiB.`);
  }

  await mkdir(dirname(settings.out), { recursive: true });
  await writeFile(settings.out, gif);
  io.log(`Wrote ${settings.out} (${(gif.length / MiB).toFixed(2)} MiB) for @${login}.`);
}

/** Runs the CLI and returns the process exit code. */
export async function run(argv: string[], io: Io): Promise<number> {
  try {
    const command = await parseCommand(argv);
    if (command.kind === 'help') {
      io.log(USAGE.replace('{styles}', Object.keys(styles).join(', ')));
    } else if (command.kind === 'version') {
      io.log(await version());
    } else {
      await render(command.settings, io);
    }
    return 0;
  } catch (err) {
    io.warn(`headreel: ${(err as Error).message}`);
    return 1;
  }
}
