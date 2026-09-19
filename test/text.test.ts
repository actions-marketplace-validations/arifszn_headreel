import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadFixture } from '../src/core/data/fixture.js';
import { renderBanner } from '../src/core/pipeline.js';
import { canvasMeasure, fitIdentity, fitLine, IDENTITY_TYPE } from '../src/core/text.js';
import { contributionCity } from '../src/styles/contribution-city/index.js';
import { highlightsReel } from '../src/styles/highlights-reel/index.js';
import { repoGalaxy } from '../src/styles/repo-galaxy/index.js';

const LONG = {
  name: 'Maximilian Alexander Konstantinopoulos-Wetherby of the Northern Isles',
  tagline:
    'Principal engineer building distributed systems and developer tooling at a very large scale',
  website: 'https://a-really-long-personal-domain-name.example.com/portfolio/and/more',
};

/** One px per character per 10 px of size: easy to reason about. */
const fake = (text: string, size: number) => (text.length * size) / 10;

describe('fitLine', () => {
  it('leaves text that fits unchanged', () => {
    expect(fitLine('short', 100, 50, 30, fake)).toEqual({ text: 'short', size: 50 });
  });

  it('shrinks before it cuts', () => {
    // 10 characters: 50 px at size 50, 40 px at size 40.
    expect(fitLine('abcdefghij', 40, 50, 30, fake)).toEqual({ text: 'abcdefghij', size: 40 });
  });

  it('cuts with an ellipsis at the minimum size', () => {
    const line = fitLine('abcdefghijklmnopqrst', 30, 50, 30, fake);
    expect(line.size).toBe(30);
    expect(line.text).toBe('abcdefghi…');
    expect(fake(line.text, line.size)).toBeLessThanOrEqual(30);
  });

  it('cuts without shrinking when the minimum is the size', () => {
    expect(fitLine('abcdefghij', 16, 17, 17, fake)).toEqual({ text: 'abcdefgh…', size: 17 });
  });

  it('never returns a line wider than the column, even a tiny one', () => {
    expect(fitLine('abc', 0, 20, 20, fake)).toEqual({ text: '', size: 20 });
  });
});

describe('fitIdentity', () => {
  it('keeps every line inside its column in the real fonts', () => {
    const { name, tagline, website } = IDENTITY_TYPE;
    const fitted = fitIdentity(
      { name: LONG.name.toUpperCase(), tagline: LONG.tagline, website: LONG.website },
      392,
      192,
    );
    expect(fitted.name.size).toBe(name.minSize);
    expect(fitted.name.text.endsWith('…')).toBe(true);
    const width = (family: string, weight: number, tracking = 0) =>
      canvasMeasure(family, weight, tracking);
    expect(
      width(name.family, name.weight, name.tracking)(fitted.name.text, fitted.name.size),
    ).toBeLessThanOrEqual(392);
    expect(
      width(tagline.family, tagline.weight)(fitted.tagline!.text, fitted.tagline!.size),
    ).toBeLessThanOrEqual(392);
    expect(
      width(website.family, website.weight)(fitted.website!.text, fitted.website!.size),
    ).toBeLessThanOrEqual(192);
  });

  it('leaves a normal name at full size and hides empty fields', () => {
    const fitted = fitIdentity({ name: 'ARIFUL ALAM' }, 392);
    expect(fitted.name).toEqual({ text: 'ARIFUL ALAM', size: IDENTITY_TYPE.name.size });
    expect(fitted.tagline).toBeNull();
    expect(fitted.website).toBeNull();
  });
});

describe('long identity text', () => {
  const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
  const cases = [
    { style: contributionCity, fixture: 'fixtures/arifszn.contributions.json' },
    { style: repoGalaxy, fixture: 'fixtures/arifszn.repos.json' },
    { style: highlightsReel, fixture: 'fixtures/arifszn.highlights.json' },
  ] as const;

  for (const { style, fixture } of cases) {
    it(
      `${style.id} renders a very long name, tagline and website`,
      { timeout: 120_000 },
      async () => {
        const { profile, data } = await loadFixture(fixture, style.data.schema as never);
        const long = await renderBanner(style as never, {
          login: profile.login,
          data,
          identity: LONG,
        });
        const plain = await renderBanner(style as never, {
          login: profile.login,
          data,
          identity: { name: profile.name },
        });
        expect(long.length).toBeGreaterThan(0);
        expect(hash(long)).not.toBe(hash(plain));
      },
    );
  }
});
