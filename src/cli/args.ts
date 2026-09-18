import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { z } from 'zod';

export const USAGE = `Usage: headreel --style <style> --user <login> [options]

Renders an animated GitHub profile banner.

Options:
  --style <id>          Banner style (required). Available: {styles}
  --user <login>        GitHub login (required unless --fixture is used)
  --out <file>          Output GIF path (default: headreel.gif)
  --tagline <text>      One line under your name
  --website <url>       Website shown on the banner
  --handle <text>       Handle shown on the banner, if the style uses it
  --option <key=value>  Style option; repeat for more than one
  --options <text>      Style options as "key: value" lines
  --config <file>       JSON file with any of the settings above
  --token <token>       GitHub token (default: GITHUB_TOKEN, then \`gh auth token\`)
  --fixture <file>      Render from a saved data file instead of the GitHub API
  -h, --help            Show this help
  -v, --version         Show the version`;

export interface Settings {
  style: string;
  user?: string;
  out: string;
  tagline?: string;
  website?: string;
  handle?: string;
  token?: string;
  fixture?: string;
  options: Record<string, string>;
}

export type Command =
  { kind: 'help' } | { kind: 'version' } | { kind: 'render'; settings: Settings };

const configSchema = z
  .object({
    style: z.string(),
    user: z.string(),
    out: z.string(),
    tagline: z.string(),
    website: z.string(),
    handle: z.string(),
    fixture: z.string(),
    options: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  })
  .partial()
  .strict();

/** Parses "key: value" lines. Blank lines and lines starting with # are ignored. */
export function parseOptionLines(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [i, raw] of text.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const sep = line.indexOf(':');
    if (sep <= 0) throw new Error(`Invalid option on line ${i + 1}: "${line}". Use "key: value".`);
    out[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
  }
  return out;
}

function parseOptionPairs(pairs: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of pairs) {
    const sep = pair.indexOf('=');
    if (sep <= 0) throw new Error(`Invalid --option "${pair}". Use key=value.`);
    out[pair.slice(0, sep).trim()] = pair.slice(sep + 1).trim();
  }
  return out;
}

async function readConfig(path: string): Promise<z.infer<typeof configSchema>> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    throw new Error(`Cannot read config ${path}: ${(err as Error).message}`);
  }
  const parsed = configSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`Invalid config ${path}:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** Treats empty strings as unset, so empty Action inputs fall through to defaults. */
function value(v: string | undefined): string | undefined {
  const trimmed = v?.trim();
  return trimmed ? trimmed : undefined;
}

/** Resolves flags and the optional config file. Flags override config values. */
export async function parseCommand(argv: string[]): Promise<Command> {
  const { values } = parseArgs({
    args: argv,
    options: {
      style: { type: 'string' },
      user: { type: 'string' },
      out: { type: 'string' },
      tagline: { type: 'string' },
      website: { type: 'string' },
      handle: { type: 'string' },
      option: { type: 'string', multiple: true },
      options: { type: 'string' },
      config: { type: 'string' },
      token: { type: 'string' },
      fixture: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
    },
    strict: true,
    allowPositionals: false,
  });

  if (values.help) return { kind: 'help' };
  if (values.version) return { kind: 'version' };

  const configPath = value(values.config);
  const config = configPath ? await readConfig(configPath) : {};
  const configOptions = Object.fromEntries(
    Object.entries(config.options ?? {}).map(([k, v]) => [k, String(v)]),
  );

  const style = value(values.style) ?? config.style;
  if (!style) throw new Error('Missing --style.');

  const settings: Settings = {
    style,
    out: value(values.out) ?? config.out ?? 'headreel.gif',
    options: {
      ...configOptions,
      ...parseOptionLines(values.options ?? ''),
      ...parseOptionPairs(values.option ?? []),
    },
  };
  const optional = {
    user: value(values.user) ?? config.user,
    tagline: value(values.tagline) ?? config.tagline,
    website: value(values.website) ?? config.website,
    handle: value(values.handle) ?? config.handle,
    token: value(values.token),
    fixture: value(values.fixture) ?? config.fixture,
  };
  for (const [key, v] of Object.entries(optional)) {
    if (v) (settings as unknown as Record<string, string>)[key] = v;
  }
  if (!settings.user && !settings.fixture) throw new Error('Missing --user.');
  return { kind: 'render', settings };
}
