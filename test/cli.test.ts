import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCommand, parseOptionLines } from '../src/cli/args.js';
import { run } from '../src/cli/run.js';

async function settings(argv: string[]) {
  const cmd = await parseCommand(argv);
  if (cmd.kind !== 'render') throw new Error(`expected render, got ${cmd.kind}`);
  return cmd.settings;
}

describe('parseOptionLines', () => {
  it('parses key: value lines, skipping blanks and comments', () => {
    expect(parseOptionLines('beacons: 5\n\n# note\n  other : a:b  ')).toEqual({
      beacons: '5',
      other: 'a:b',
    });
  });

  it('rejects lines without a key', () => {
    expect(() => parseOptionLines('beacons 5')).toThrow(/line 1/);
  });
});

describe('parseCommand', () => {
  it('applies defaults and treats empty values as unset', async () => {
    expect(await settings(['--style', 's', '--user', 'u', '--tagline', '  '])).toEqual({
      style: 's',
      user: 'u',
      out: 'headreel.gif',
      options: {},
    });
  });

  it('lets flags override the config file, and --option override --options', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'headreel-'));
    const config = join(dir, 'headreel.json');
    await writeFile(
      config,
      JSON.stringify({
        style: 's',
        user: 'from-config',
        website: 'a.dev',
        options: { beacons: 2 },
      }),
    );
    expect(
      await settings([
        '--config',
        config,
        '--user',
        'from-flag',
        '--options',
        'beacons: 4\nextra: x',
        '--option',
        'beacons=6',
      ]),
    ).toEqual({
      style: 's',
      user: 'from-flag',
      website: 'a.dev',
      out: 'headreel.gif',
      options: { beacons: '6', extra: 'x' },
    });
  });

  it('requires a style and a user or fixture', async () => {
    await expect(parseCommand(['--user', 'u'])).rejects.toThrow(/--style/);
    await expect(parseCommand(['--style', 's'])).rejects.toThrow(/--user/);
    expect((await settings(['--style', 's', '--fixture', 'f.json'])).fixture).toBe('f.json');
  });

  it('rejects unknown config keys', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'headreel-'));
    const config = join(dir, 'bad.json');
    await writeFile(config, JSON.stringify({ style: 's', colour: 'red' }));
    await expect(parseCommand(['--config', config])).rejects.toThrow(/colour/);
  });
});

describe('run', () => {
  function io() {
    const out: string[] = [];
    const err: string[] = [];
    return {
      out,
      err,
      io: {
        log: (l: string) => out.push(l),
        warn: (l: string) => err.push(l),
        now: () => new Date('2026-09-19T00:00:00Z'),
      },
    };
  }

  it('prints the package version', async () => {
    const t = io();
    const pkg = JSON.parse(await readFile('package.json', 'utf8')) as { version: string };
    expect(await run(['--version'], t.io)).toBe(0);
    expect(t.out).toEqual([pkg.version]);
  });

  it('fails with a message on invalid input, before any API call', async () => {
    const t = io();
    expect(await run(['--style', 'nope', '--user', 'u'], t.io)).toBe(1);
    expect(t.err[0]).toMatch(/Unknown style "nope"/);

    const t2 = io();
    const argv = ['--style', 'contribution-city', '--user', 'u', '--option', 'beacons=99'];
    expect(await run(argv, t2.io)).toBe(1);
    expect(t2.err[0]).toMatch(/beacons/);
  });

  it('renders from a fixture', { timeout: 60_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'headreel-'));
    const out = join(dir, 'nested', 'banner.gif');
    const t = io();
    const argv = [
      '--style',
      'contribution-city',
      '--fixture',
      'fixtures/arifszn.contributions.json',
      '--out',
      out,
    ];
    expect(await run(argv, t.io)).toBe(0);
    expect((await readFile(out)).subarray(0, 6).toString('ascii')).toBe('GIF89a');
  });
});
